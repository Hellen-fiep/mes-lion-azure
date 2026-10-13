using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MesLion.Server.Estado;
using Microsoft.AspNetCore.DataProtection.Repositories;

namespace MesLion.Server.Persistencia.Portatil;

/// <summary>
/// Persistência PORTÁTIL (arquivos JSON em disco) — para validação em PCs sem SQL Server.
/// Mesmas regras do provedor SQL Server; gravações atômicas (arquivo temporário + troca).
/// </summary>
public static class ProvedorPortatil
{
    public static ProvedorPersistencia Criar(string raiz, ILoggerFactory lf)
    {
        Directory.CreateDirectory(raiz);
        var ctx = new ContextoPortatil(raiz);
        var chaves = Path.Combine(raiz, "chaves-protecao");
        Directory.CreateDirectory(chaves);
        return new ProvedorPersistencia(
            "Portatil",
            $"Portátil (arquivos em {raiz})",
            new InicializadorPortatil(ctx),
            new EstadoPortatil(ctx),
            new KvPortatil(ctx),
            new UsuariosPortatil(ctx),
            new AuditoriaPortatil(ctx),
            new DocumentosPortatil(ctx),
            new AnexosPortatil(ctx),
            new PassaportesPortatil(ctx),
            new BackupsPortatil(ctx),
            new FileSystemXmlRepository(new DirectoryInfo(chaves), lf));
    }
}

internal sealed class ContextoPortatil(string raiz)
{
    public string Raiz { get; } = raiz;
    public SemaphoreSlim Trava { get; } = new(1, 1);
    public static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        Encoder = JsonEstado.Codificador,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public string Caminho(params string[] partes) => Path.Combine([Raiz, .. partes]);

    public static async Task GravarAtomicoAsync(string caminho, ReadOnlyMemory<byte> conteudo, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(caminho)!);
        string tmp = caminho + "." + Guid.NewGuid().ToString("N") + ".tmp";
        await using (var fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16, FileOptions.WriteThrough))
        {
            await fs.WriteAsync(conteudo, ct);
            await fs.FlushAsync(ct);
        }
        File.Move(tmp, caminho, overwrite: true);
    }

    public async Task<T> LerAsync<T>(string arquivo, Func<T> padrao, CancellationToken ct)
    {
        var c = Caminho(arquivo);
        if (!File.Exists(c)) return padrao();
        await using var fs = File.OpenRead(c);
        return await JsonSerializer.DeserializeAsync<T>(fs, Json, ct) ?? padrao();
    }

    public Task SalvarAsync<T>(string arquivo, T valor, CancellationToken ct) =>
        GravarAtomicoAsync(Caminho(arquivo), JsonSerializer.SerializeToUtf8Bytes(valor, Json), ct);

    public async Task<TR> ComTravaAsync<TR>(Func<Task<TR>> acao, CancellationToken ct)
    {
        await Trava.WaitAsync(ct);
        try { return await acao(); }
        finally { Trava.Release(); }
    }

    public async Task ComTravaAsync(Func<Task> acao, CancellationToken ct)
    {
        await Trava.WaitAsync(ct);
        try { await acao(); }
        finally { Trava.Release(); }
    }
}

internal sealed class InicializadorPortatil(ContextoPortatil ctx) : IInicializadorBanco
{
    public string Descricao => "Banco portátil em " + ctx.Raiz;
    public Task InicializarAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(ctx.Caminho("estado"));
        return Task.CompletedTask;
    }
}

// --------------------------------------------------------------------- estado
internal sealed class IndiceEstado
{
    public long Versao { get; set; }
    public DateTimeOffset? AtualizadoEm { get; set; }
    public string? AtualizadoPor { get; set; }
    public List<ItemIndice> Colecoes { get; set; } = [];
}

internal sealed class ItemIndice
{
    public string Nome { get; set; } = "";
    public int Ordem { get; set; }
    public string Hash { get; set; } = "";
    public string Arquivo { get; set; } = "";
    public long Bytes { get; set; }
    public int? Itens { get; set; }
    public DateTimeOffset AtualizadoEm { get; set; }
}

internal sealed class EstadoPortatil(ContextoPortatil ctx) : IRepositorioEstado
{
    private const string ArquivoIndice = "estado/indice.json";

    private Task<IndiceEstado> LerIndiceAsync(CancellationToken ct) => ctx.LerAsync(ArquivoIndice, () => new IndiceEstado(), ct);

    public async Task<long> ObterVersaoAsync(CancellationToken ct) => (await LerIndiceAsync(ct)).Versao;

    public Task<(long Versao, IReadOnlyList<ColecaoArmazenada> Colecoes)> CarregarAsync(CancellationToken ct) =>
        ctx.ComTravaAsync(async () =>
        {
            var idx = await LerIndiceAsync(ct);
            var lista = new List<ColecaoArmazenada>(idx.Colecoes.Count);
            foreach (var c in idx.Colecoes)
            {
                var bytes = await File.ReadAllBytesAsync(ctx.Caminho("estado", c.Arquivo), ct);
                lista.Add(new ColecaoArmazenada(c.Nome, c.Ordem, bytes, Convert.FromHexString(c.Hash)));
            }
            return (idx.Versao, (IReadOnlyList<ColecaoArmazenada>)lista);
        }, ct);

    public Task<ResultadoGravacaoEstado> GravarAsync(IReadOnlyList<ColecaoRecebida> colecoes, Usuario? usuario, CancellationToken ct) =>
        ctx.ComTravaAsync(async () =>
        {
            var idx = await LerIndiceAsync(ct);
            var atuais = idx.Colecoes.ToDictionary(c => c.Nome, StringComparer.Ordinal);
            var alteradas = new List<string>();
            long bytes = 0;
            var novo = new List<ItemIndice>(colecoes.Count);
            var agora = DateTimeOffset.Now;
            foreach (var c in colecoes)
            {
                string hash = JsonEstado.Hex(c.Hash);
                if (atuais.TryGetValue(c.Nome, out var existente) && existente.Hash == hash)
                {
                    existente.Ordem = c.Ordem;
                    novo.Add(existente);
                    continue;
                }
                string arquivo = $"c_{JsonEstado.Hex(SHA1.HashData(Encoding.UTF8.GetBytes(c.Nome)))[..16]}_{hash[..16]}.json";
                await ContextoPortatil.GravarAtomicoAsync(ctx.Caminho("estado", arquivo), c.ConteudoUtf8, ct);
                novo.Add(new ItemIndice { Nome = c.Nome, Ordem = c.Ordem, Hash = hash, Arquivo = arquivo, Bytes = c.ConteudoUtf8.Length, Itens = c.Itens, AtualizadoEm = agora });
                alteradas.Add(c.Nome);
                bytes += c.ConteudoUtf8.Length;
            }
            var nomesNovos = colecoes.Select(c => c.Nome).ToHashSet(StringComparer.Ordinal);
            var removidas = idx.Colecoes.Where(c => !nomesNovos.Contains(c.Nome)).Select(c => c.Nome).ToList();

            idx.Versao++;
            idx.AtualizadoEm = agora;
            idx.AtualizadoPor = usuario?.Username;
            idx.Colecoes = novo;
            await ctx.SalvarAsync(ArquivoIndice, idx, ct);

            // Limpeza de arquivos não referenciados (após o índice novo estar gravado).
            var referenciados = novo.Select(c => c.Arquivo).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var f in Directory.EnumerateFiles(ctx.Caminho("estado"), "c_*.json"))
                if (!referenciados.Contains(Path.GetFileName(f)))
                    try { File.Delete(f); } catch { /* arquivo em uso: removido na próxima gravação */ }

            return new ResultadoGravacaoEstado(idx.Versao, alteradas, removidas, bytes);
        }, ct);

    public async Task<ResumoEstado> ResumoAsync(CancellationToken ct)
    {
        var idx = await LerIndiceAsync(ct);
        return new ResumoEstado(idx.Versao, idx.Colecoes.Count, idx.Colecoes.Sum(c => c.Bytes), idx.AtualizadoEm, idx.AtualizadoPor);
    }
}

// --------------------------------------------------------------------- kv
internal sealed class KvPortatil(ContextoPortatil ctx) : IRepositorioKv
{
    private const string Arquivo = "app_storage.json";
    private Task<Dictionary<string, string>> LerAsync(CancellationToken ct) =>
        ctx.LerAsync(Arquivo, () => new Dictionary<string, string>(StringComparer.Ordinal), ct);

    public async Task<IReadOnlyDictionary<string, string>> ListarAsync(CancellationToken ct) => await LerAsync(ct);

    public Task DefinirAsync(string chave, string valor, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var d = await LerAsync(ct); d[chave] = valor; await ctx.SalvarAsync(Arquivo, d, ct);
    }, ct);

    public Task RemoverAsync(string chave, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var d = await LerAsync(ct); if (d.Remove(chave)) await ctx.SalvarAsync(Arquivo, d, ct);
    }, ct);

    public Task LimparAsync(CancellationToken ct) => ctx.ComTravaAsync(() =>
        ctx.SalvarAsync(Arquivo, new Dictionary<string, string>(), ct), ct);

    public Task SubstituirTudoAsync(IReadOnlyDictionary<string, string> valores, CancellationToken ct) => ctx.ComTravaAsync(() =>
        ctx.SalvarAsync(Arquivo, new Dictionary<string, string>(valores, StringComparer.Ordinal), ct), ct);
}

// --------------------------------------------------------------------- usuários
internal sealed class UsuariosPortatil(ContextoPortatil ctx) : IRepositorioUsuarios
{
    private const string Arquivo = "usuarios.json";
    private Task<List<Usuario>> LerAsync(CancellationToken ct) => ctx.LerAsync(Arquivo, () => new List<Usuario>(), ct);

    public async Task<int> ContarAsync(CancellationToken ct) => (await LerAsync(ct)).Count;
    public async Task<Usuario?> PorUsernameAsync(string username, CancellationToken ct) =>
        (await LerAsync(ct)).FirstOrDefault(u => string.Equals(u.Username, username, StringComparison.Ordinal));
    public async Task<Usuario?> PorIdAsync(Guid id, CancellationToken ct) => (await LerAsync(ct)).FirstOrDefault(u => u.Id == id);
    public async Task<Usuario?> PorIdExternoAsync(string idExterno, CancellationToken ct) =>
        (await LerAsync(ct)).FirstOrDefault(u => string.Equals(u.ExternalId, idExterno, StringComparison.OrdinalIgnoreCase));
    public async Task<IReadOnlyList<Usuario>> ListarAsync(CancellationToken ct) =>
        (await LerAsync(ct)).OrderBy(u => u.FullName, StringComparer.CurrentCulture).ToList();

    public Task<bool> InserirAsync(Usuario u, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var l = await LerAsync(ct);
        if (l.Any(x => string.Equals(x.Username, u.Username, StringComparison.Ordinal))) return false;
        l.Add(u); await ctx.SalvarAsync(Arquivo, l, ct); return true;
    }, ct);

    public Task AtualizarAsync(Usuario u, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var l = await LerAsync(ct);
        int i = l.FindIndex(x => x.Id == u.Id);
        if (i >= 0) { l[i] = u; await ctx.SalvarAsync(Arquivo, l, ct); }
    }, ct);
}

// --------------------------------------------------------------------- auditoria
internal sealed class AuditoriaPortatil(ContextoPortatil ctx) : IRepositorioAuditoria
{
    private string Arquivo => ctx.Caminho("auditoria.jsonl");

    public Task RegistrarAsync(RegistroAuditoria r, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var linha = JsonSerializer.Serialize(r, new JsonSerializerOptions { Encoder = JsonEstado.Codificador }) + "\n";
        await File.AppendAllTextAsync(Arquivo, linha, new UTF8Encoding(false), ct);
    }, ct);

    public async Task<IReadOnlyList<RegistroAuditoria>> ListarAsync(int limite, CancellationToken ct)
    {
        if (!File.Exists(Arquivo)) return [];
        var linhas = await File.ReadAllLinesAsync(Arquivo, ct);
        var lista = new List<RegistroAuditoria>(Math.Min(limite, linhas.Length));
        for (int i = linhas.Length - 1; i >= 0 && lista.Count < limite; i--)
        {
            if (string.IsNullOrWhiteSpace(linhas[i])) continue;
            try { if (JsonSerializer.Deserialize<RegistroAuditoria>(linhas[i]) is { } r) lista.Add(r); }
            catch (JsonException) { /* linha corrompida ignorada */ }
        }
        return lista;
    }

    public async Task<long> ContarAsync(CancellationToken ct) =>
        File.Exists(Arquivo) ? (await File.ReadAllLinesAsync(Arquivo, ct)).LongCount(l => !string.IsNullOrWhiteSpace(l)) : 0;
}

// --------------------------------------------------------------------- documentos / anexos / passaportes / backups
internal sealed class DocumentosPortatil(ContextoPortatil ctx) : IRepositorioDocumentos
{
    private const string Arquivo = "documentos_equipamentos.json";
    private Task<List<DocumentoEquipamento>> LerAsync(CancellationToken ct) => ctx.LerAsync(Arquivo, () => new List<DocumentoEquipamento>(), ct);

    public async Task<IReadOnlyList<DocumentoEquipamento>> ListarPorEquipamentoAsync(string codigo, CancellationToken ct) =>
        (await LerAsync(ct)).Where(d => d.Active && string.Equals(d.EquipmentCode, codigo, StringComparison.Ordinal))
            .OrderByDescending(d => d.UploadedAt).ToList();
    public async Task<DocumentoEquipamento?> ObterAsync(Guid id, CancellationToken ct) => (await LerAsync(ct)).FirstOrDefault(d => d.Id == id);
    public Task InserirAsync(DocumentoEquipamento d, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var l = await LerAsync(ct); l.Add(d); await ctx.SalvarAsync(Arquivo, l, ct);
    }, ct);
    public async Task<IReadOnlyList<DocumentoEquipamento>> ListarTodosAsync(CancellationToken ct) => await LerAsync(ct);
}

internal sealed class AnexosPortatil(ContextoPortatil ctx) : IRepositorioAnexos
{
    private const string Arquivo = "anexos.json";
    private Task<List<Anexo>> LerAsync(CancellationToken ct) => ctx.LerAsync(Arquivo, () => new List<Anexo>(), ct);
    public Task InserirAsync(Anexo a, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var l = await LerAsync(ct); l.Add(a); await ctx.SalvarAsync(Arquivo, l, ct);
    }, ct);
    public async Task<Anexo?> ObterAsync(Guid id, CancellationToken ct) => (await LerAsync(ct)).FirstOrDefault(a => a.Id == id);
}

internal sealed class PassaportesPortatil(ContextoPortatil ctx) : IRepositorioPassaportes
{
    private const string Arquivo = "passaportes_publicados.json";
    private Task<List<PassaportePublicado>> LerAsync(CancellationToken ct) => ctx.LerAsync(Arquivo, () => new List<PassaportePublicado>(), ct);
    public Task SalvarAsync(PassaportePublicado p, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var l = await LerAsync(ct);
        l.RemoveAll(x => string.Equals(x.Id, p.Id, StringComparison.Ordinal));
        l.Add(p); await ctx.SalvarAsync(Arquivo, l, ct);
    }, ct);
    public async Task<PassaportePublicado?> ObterAsync(string id, CancellationToken ct) =>
        (await LerAsync(ct)).FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.Ordinal));
}

internal sealed class BackupsPortatil(ContextoPortatil ctx) : IRepositorioBackups
{
    private const string Arquivo = "backups.json";
    private Task<List<BackupEstado>> LerAsync(CancellationToken ct) => ctx.LerAsync(Arquivo, () => new List<BackupEstado>(), ct);
    public Task<long> InserirAsync(BackupEstado b, CancellationToken ct) => ctx.ComTravaAsync(async () =>
    {
        var l = await LerAsync(ct);
        b.Id = l.Count == 0 ? 1 : l.Max(x => x.Id) + 1;
        l.Add(b); await ctx.SalvarAsync(Arquivo, l, ct);
        return b.Id;
    }, ct);
    public async Task<IReadOnlyList<BackupEstado>> ListarAsync(int limite, CancellationToken ct) =>
        (await LerAsync(ct)).OrderByDescending(b => b.Id).Take(limite).ToList();
    public async Task<BackupEstado?> ObterAsync(long id, CancellationToken ct) => (await LerAsync(ct)).FirstOrDefault(b => b.Id == id);
}
