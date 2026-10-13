using System.IO.Compression;
using MesLion.Server.Arquivos;
using MesLion.Server.Estado;
using MesLion.Server.Persistencia;
using Microsoft.AspNetCore.StaticFiles;

namespace MesLion.Server.Infra;

/// <summary>Documentos de equipamentos, anexos, passaportes publicados e backups.</summary>
public sealed class ServicoArquivos(ProvedorPersistencia provedor, IArmazenamentoArquivos armazenamento, ServicoEstado estado, ILogger<ServicoArquivos> log)
{
    private static readonly FileExtensionContentTypeProvider Tipos = new();

    public static string TipoPorNome(string nome) => nome.ToLowerInvariant() switch
    {
        var n when n.EndsWith(".pdf") => "application/pdf",
        var n when n.EndsWith(".xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        var n when n.EndsWith(".xls") => "application/vnd.ms-excel",
        var n when n.EndsWith(".jpg") || n.EndsWith(".jpeg") => "image/jpeg",
        var n when n.EndsWith(".png") => "image/png",
        var n => Tipos.TryGetContentType(n, out var t) ? t : "application/octet-stream",
    };

    public IArmazenamentoArquivos Armazenamento => armazenamento;

    // ------------------------------------------------------------------ documentos de equipamentos
    public static readonly string[] ExtensoesDocumento = [".pdf", ".xlsx", ".xls"];

    public async Task<DocumentoEquipamento> SalvarDocumentoAsync(string codigoEquipamento, string nomeOriginal, Stream conteudo, long tamanho,
        string? tipoDocumento, string? revisao, Usuario u, CancellationToken ct)
    {
        string ext = Path.GetExtension(nomeOriginal).ToLowerInvariant();
        string armazenado = Guid.NewGuid() + ext;
        await armazenamento.SalvarAsync("documentos/" + armazenado, conteudo, TipoPorNome(nomeOriginal), ct);
        var d = new DocumentoEquipamento
        {
            Id = Guid.NewGuid(), EquipmentCode = codigoEquipamento, OriginalName = nomeOriginal, StoredName = armazenado,
            MimeType = TipoPorNome(nomeOriginal), FileSize = tamanho, DocumentType = Cortar(tipoDocumento, 80), Revision = Cortar(revisao, 40),
            Active = true, UploadedAt = DateTimeOffset.Now, UploadedBy = u.Id,
        };
        await provedor.Documentos.InserirAsync(d, ct);
        return d;
    }

    public async Task<(DocumentoEquipamento Doc, ArquivoLido Arquivo)?> AbrirDocumentoAsync(Guid id, CancellationToken ct)
    {
        var d = await provedor.Documentos.ObterAsync(id, ct);
        if (d is null || !d.Active) return null;
        var a = await armazenamento.AbrirAsync("documentos/" + d.StoredName, ct);
        return a is null ? null : (d, a);
    }

    // ------------------------------------------------------------------ anexos (/api/attachments)
    public async Task<Anexo> SalvarAnexoAsync(string escopo, string registro, string nome, string? mime, byte[] dados, Usuario u, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        string nomeSeguro = ChavesArquivo.NomeSeguro(nome);
        string chave = $"anexos/{id:N}/{nomeSeguro}";
        await armazenamento.SalvarAsync(chave, new MemoryStream(dados), string.IsNullOrWhiteSpace(mime) ? TipoPorNome(nomeSeguro) : mime, ct);
        var a = new Anexo
        {
            Id = id, Scope = Cortar(escopo, 100) ?? "", RecordId = Cortar(registro, 200) ?? "", OriginalName = nomeSeguro, StoredKey = chave,
            MimeType = string.IsNullOrWhiteSpace(mime) ? TipoPorNome(nomeSeguro) : Cortar(mime, 200), FileSize = dados.LongLength,
            UploadedAt = DateTimeOffset.Now, UploadedBy = u.Id,
        };
        await provedor.Anexos.InserirAsync(a, ct);
        return a;
    }

    public async Task<(Anexo Anexo, ArquivoLido Arquivo)?> AbrirAnexoAsync(Guid id, CancellationToken ct)
    {
        var a = await provedor.Anexos.ObterAsync(id, ct);
        if (a is null) return null;
        var f = await armazenamento.AbrirAsync(a.StoredKey, ct);
        return f is null ? null : (a, f);
    }

    // ------------------------------------------------------------------ passaporte publicado (/api/passport-publish)
    public static string IdPassaporteSeguro(string? id)
    {
        var s = new string((id ?? "").Trim().Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.' ? ch : '_').ToArray()).Trim('.');
        if (s.Length > 120) s = s[..120];
        return s;
    }

    public async Task<PassaportePublicado> PublicarPassaporteAsync(string id, string html, Usuario u, CancellationToken ct)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(html);
        string chave = $"passaportes/{id}.html";
        await armazenamento.SalvarAsync(chave, new MemoryStream(bytes), "text/html; charset=utf-8", ct);
        var p = new PassaportePublicado { Id = id, StoredKey = chave, SizeBytes = bytes.LongLength, PublishedAt = DateTimeOffset.Now, PublishedBy = u.Id };
        await provedor.Passaportes.SalvarAsync(p, ct);
        return p;
    }

    public async Task<ArquivoLido?> AbrirPassaporteAsync(string id, CancellationToken ct)
    {
        var p = await provedor.Passaportes.ObterAsync(id, ct);
        return p is null ? null : await armazenamento.AbrirAsync(p.StoredKey, ct);
    }

    // ------------------------------------------------------------------ backups (/api/backup)
    public async Task<(BackupEstado Backup, string Caminho)> CriarBackupAsync(string motivo, Usuario? u, CancellationToken ct)
    {
        var conteudo = await estado.ExportarAsync(ct);
        var versao = (await estado.ObterAsync(ct)).Versao;
        // Nome único mesmo com dois backups no mesmo segundo (ex.: backup manual seguido de importação).
        string nome = $"MES_LION_BACKUP_{DateTime.Now:yyyyMMdd_HHmmss_fff}_v{versao}_{Guid.NewGuid().ToString("N")[..6]}.json.gz";
        using var ms = new MemoryStream();
        await using (var gz = new GZipStream(ms, CompressionLevel.Optimal, leaveOpen: true))
            await gz.WriteAsync(conteudo, ct);
        ms.Position = 0;
        string chave = "backups/" + nome;
        await armazenamento.SalvarAsync(chave, ms, "application/gzip", ct);
        var b = new BackupEstado
        {
            StoredKey = chave, Reason = Cortar(motivo, 200) ?? "", SizeBytes = ms.Length, StateVersion = versao,
            CreatedAt = DateTimeOffset.Now, CreatedBy = u?.Id, CreatedByName = u?.Username,
        };
        b.Id = await provedor.Backups.InserirAsync(b, ct);
        string caminho = armazenamento is ArmazenamentoLocal local
            ? Path.Combine(local.Raiz, "backups", nome)
            : $"{armazenamento.Descricao}/backups/{nome}";
        log.LogInformation("Backup {Id} criado ({Motivo}): {Caminho}", b.Id, motivo, caminho);
        return (b, caminho);
    }

    private static string? Cortar(string? s, int n) => s is null || s.Length <= n ? s : s[..n];
}
