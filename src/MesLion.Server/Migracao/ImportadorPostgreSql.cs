using System.Globalization;
using System.Text;
using System.Text.Json;
using MesLion.Server.Arquivos;
using MesLion.Server.Estado;
using MesLion.Server.Infra;
using MesLion.Server.Persistencia;

namespace MesLion.Server.Migracao;

/// <summary>
/// Importa o pacote gerado por ferramentas/EXPORTAR_DADOS_POSTGRESQL.ps1 (MES LION PowerShell/PostgreSQL):
/// estado (app_state), app_storage, usuários (com hash bcrypt), auditoria e documentos de equipamentos.
/// Preserva IDs de usuários e documentos (as OPs referenciam documentos pelo ID).
/// </summary>
public sealed class ImportadorPostgreSql(ProvedorPersistencia p, IArmazenamentoArquivos armazenamento, ServicoEstado estado,
    ServicoArquivos arquivos, ILogger<ImportadorPostgreSql> log)
{
    public async Task<string> ImportarAsync(string pasta, bool sobrescrever, CancellationToken ct)
    {
        pasta = Path.GetFullPath(pasta);
        var rel = new StringBuilder();
        void Linha(string s) { rel.AppendLine(s); log.LogInformation("{Linha}", s); }

        Linha($"MES LION — importação do pacote PostgreSQL ({DateTime.Now:dd/MM/yyyy HH:mm:ss})");
        Linha($"Pasta: {pasta}");
        Linha($"Destino: {p.Descricao} | Arquivos: {armazenamento.Descricao}");

        string arqEstado = Path.Combine(pasta, "estado.json");
        if (!File.Exists(arqEstado)) throw new FileNotFoundException("Arquivo estado.json não encontrado no pacote de migração.", arqEstado);

        var resumo = await p.Estado.ResumoAsync(ct);
        if (resumo.Colecoes > 0 && !sobrescrever)
        {
            // O banco já tem estado (por exemplo, o seed inicial carregado na primeira execução).
            // Só é seguro substituir se o conteúdo atual ainda é o seed (versão 1, sem gravações de usuários).
            if (resumo.Versao > 1 || resumo.AtualizadoPor is not null)
                throw new InvalidOperationException(
                    "O banco de destino já possui dados gravados pelo MES. Para substituir, execute novamente com --sobrescrever " +
                    "(um backup do estado atual será criado antes).");
        }
        if (resumo.Colecoes > 0)
        {
            var (b, caminho) = await arquivos.CriarBackupAsync("Automático antes da migração do PostgreSQL", null, ct);
            Linha($"Backup do estado anterior: #{b.Id} ({caminho})");
        }

        // ------------------------------------------------------------- usuários
        var mapaUsuarios = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        int uNovos = 0, uAtualizados = 0;
        foreach (var e in LerLista(Path.Combine(pasta, "usuarios.json")))
        {
            string? idPg = S(e, "id");
            string username = S(e, "username") ?? "";
            if (string.IsNullOrWhiteSpace(username)) continue;
            var existente = await p.Usuarios.PorUsernameAsync(username, ct);
            var u = existente ?? new Usuario { Id = Guid.TryParse(idPg, out var g) ? g : Guid.NewGuid() };
            u.Username = username;
            u.FullName = S(e, "full_name") ?? username;
            u.PasswordHash = S(e, "password_hash") ?? "";
            u.Role = S(e, "role") ?? "USER";
            u.Active = B(e, "active", true);
            u.AuthProvider = "LOCAL";
            u.CreatedAt = D(e, "created_at") ?? DateTimeOffset.Now;
            u.UpdatedAt = D(e, "updated_at") ?? DateTimeOffset.Now;
            if (existente is null)
            {
                if (await p.Usuarios.PorIdAsync(u.Id, ct) is not null) u.Id = Guid.NewGuid();
                await p.Usuarios.InserirAsync(u, ct); uNovos++;
            }
            else { await p.Usuarios.AtualizarAsync(u, ct); uAtualizados++; }
            if (idPg is not null) mapaUsuarios[idPg] = u.Id;
        }
        Linha($"Usuários: {uNovos} importados, {uAtualizados} atualizados (senhas preservadas — hash bcrypt do PostgreSQL).");

        // ------------------------------------------------------------- estado + app_storage
        var bytes = await File.ReadAllBytesAsync(arqEstado, ct);
        var (r, kvImportadas, formato) = await estado.ImportarAsync(bytes, null, ct);
        Linha($"Estado do MES: formato {formato}, {r.Alteradas.Count} coleções gravadas, {r.Removidas.Count} removidas, {bytes.Length:N0} bytes. Versão {r.Versao}.");

        string arqKv = Path.Combine(pasta, "app_storage.json");
        if (File.Exists(arqKv))
        {
            var kv = LerKv(arqKv);
            await p.Kv.SubstituirTudoAsync(kv, ct);
            Linha($"app_storage: {kv.Count} chaves.");
        }
        else if (kvImportadas > 0) Linha($"app_storage: {kvImportadas} chaves (do arquivo de estado).");

        // ------------------------------------------------------------- auditoria
        int aud = 0;
        foreach (var e in LerLista(Path.Combine(pasta, "auditoria.json")))
        {
            Guid? uid = S(e, "user_id") is { } id && mapaUsuarios.TryGetValue(id, out var g) ? g : null;
            string detalhes = e.TryGetProperty("details", out var d) ? (d.ValueKind == JsonValueKind.String ? d.GetString() ?? "{}" : d.GetRawText()) : "{}";
            await p.Auditoria.RegistrarAsync(new RegistroAuditoria(uid, S(e, "username"), S(e, "module") ?? "", S(e, "action") ?? "", S(e, "record_key"),
                D(e, "changed_at") ?? DateTimeOffset.Now, string.IsNullOrWhiteSpace(detalhes) ? "{}" : detalhes), ct);
            aud++;
        }
        Linha($"Histórico de modificações (audit_log): {aud} registros.");

        // ------------------------------------------------------------- documentos de equipamentos
        int docs = 0, semArquivo = 0, jaExistentes = 0;
        string pastaUploads = Path.Combine(pasta, "uploads");
        foreach (var e in LerLista(Path.Combine(pasta, "documentos.json")))
        {
            if (!Guid.TryParse(S(e, "id"), out var id)) continue;
            if (await p.Documentos.ObterAsync(id, ct) is not null) { jaExistentes++; continue; }
            string armazenado = S(e, "stored_name") ?? "";
            string origem = Path.Combine(pastaUploads, Path.GetFileName(armazenado));
            if (string.IsNullOrEmpty(armazenado) || !File.Exists(origem)) { semArquivo++; Linha($"  ! Documento {id} sem arquivo em uploads/ ({armazenado})."); continue; }
            await using (var fs = File.OpenRead(origem))
                await armazenamento.SalvarAsync("documentos/" + Path.GetFileName(armazenado), fs, S(e, "mime_type"), ct);
            Guid? por = S(e, "uploaded_by") is { } ub && mapaUsuarios.TryGetValue(ub, out var g) ? g : null;
            await p.Documentos.InserirAsync(new DocumentoEquipamento
            {
                Id = id, EquipmentCode = S(e, "equipment_code") ?? "", OriginalName = S(e, "original_name") ?? armazenado,
                StoredName = Path.GetFileName(armazenado), MimeType = S(e, "mime_type"), FileSize = (long)(N(e, "file_size") ?? new FileInfo(origem).Length),
                DocumentType = S(e, "document_type"), Revision = S(e, "revision"), Active = B(e, "active", true),
                UploadedAt = D(e, "uploaded_at") ?? DateTimeOffset.Now, UploadedBy = por,
            }, ct);
            docs++;
        }
        Linha($"Documentos de equipamentos: {docs} importados, {jaExistentes} já existentes, {semArquivo} sem arquivo.");
        Linha("Importação concluída.");

        var relatorio = rel.ToString();
        try { await File.WriteAllTextAsync(Path.Combine(pasta, $"relatorio_importacao_{DateTime.Now:yyyyMMdd_HHmmss}.txt"), relatorio, Encoding.UTF8, ct); }
        catch (Exception ex) { log.LogWarning("Não foi possível gravar o relatório na pasta do pacote: {Erro}", ex.Message); }
        return relatorio;
    }

    private static IEnumerable<JsonElement> LerLista(string arquivo)
    {
        if (!File.Exists(arquivo)) yield break;
        var texto = File.ReadAllText(arquivo, Encoding.UTF8).Trim();
        if (texto.Length == 0) yield break;
        using var doc = JsonDocument.Parse(texto);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) yield break;
        foreach (var e in doc.RootElement.EnumerateArray()) yield return e.Clone();
    }

    private static Dictionary<string, string> LerKv(string arquivo)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        var texto = File.ReadAllText(arquivo, Encoding.UTF8).Trim();
        if (texto.Length == 0) return d;
        using var doc = JsonDocument.Parse(texto);
        if (doc.RootElement.ValueKind == JsonValueKind.Object)
            foreach (var pr in doc.RootElement.EnumerateObject()) d[pr.Name] = pr.Value.ValueKind == JsonValueKind.String ? pr.Value.GetString() ?? "" : pr.Value.GetRawText();
        else if (doc.RootElement.ValueKind == JsonValueKind.Array)
            foreach (var e in doc.RootElement.EnumerateArray())
                if (S(e, "key") is { } k) d[k] = S(e, "value") ?? "";
        return d;
    }

    private static string? S(JsonElement e, string nome) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nome, out var v) && v.ValueKind != JsonValueKind.Null
            ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText()) : null;

    private static bool B(JsonElement e, string nome, bool padrao)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(nome, out var v)) return padrao;
        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => v.GetString() is "t" or "true" or "1" or "True",
            JsonValueKind.Number => v.GetDouble() != 0,
            _ => padrao,
        };
    }

    private static double? N(JsonElement e, string nome) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nome, out var v)
            ? v.ValueKind == JsonValueKind.Number ? v.GetDouble()
              : v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null
            : null;

    private static DateTimeOffset? D(JsonElement e, string nome) =>
        S(e, nome) is { } s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var d) ? d : null;
}
