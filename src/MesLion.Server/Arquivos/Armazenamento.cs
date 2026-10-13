namespace MesLion.Server.Arquivos;

public sealed record ArquivoLido(Stream Conteudo, long? Tamanho, string? TipoConteudo);

/// <summary>Armazenamento de arquivos (documentos, anexos, passaportes, backups): pasta local ou Azure Blob Storage.</summary>
public interface IArmazenamentoArquivos
{
    string Descricao { get; }
    Task InicializarAsync(CancellationToken ct);
    Task SalvarAsync(string chave, Stream conteudo, string? tipoConteudo, CancellationToken ct);
    Task<ArquivoLido?> AbrirAsync(string chave, CancellationToken ct);
    Task<bool> ExisteAsync(string chave, CancellationToken ct);
}

public static class ChavesArquivo
{
    /// <summary>Normaliza e valida uma chave relativa ("pasta/arquivo.ext").</summary>
    public static string Normalizar(string chave)
    {
        var partes = chave.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (partes.Length == 0 || partes.Any(p => p is "." or ".." || p.Contains(':')))
            throw new ArgumentException("Chave de arquivo inválida: " + chave);
        return string.Join('/', partes);
    }

    /// <summary>Nome de arquivo seguro (mesma regra do frontend v4047FileNameSafe).</summary>
    public static string NomeSeguro(string? nome, string padrao = "arquivo")
    {
        var s = string.IsNullOrWhiteSpace(nome) ? padrao : nome;
        var chars = s.Select(ch => ch < 32 || "<>:\"/\\|?*".Contains(ch) ? '_' : ch).ToArray();
        var r = new string(chars).Trim();
        if (r.Length > 120) r = r[..120];
        return string.IsNullOrWhiteSpace(r) || r is "." or ".." ? padrao : r;
    }
}

/// <summary>Arquivos em pasta local (PC/servidor) ou no armazenamento persistente do App Service (%HOME%).</summary>
public sealed class ArmazenamentoLocal(string raiz) : IArmazenamentoArquivos
{
    public string Raiz { get; } = Path.GetFullPath(raiz);
    public string Descricao => "Pasta local: " + Raiz;

    public Task InicializarAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(Raiz);
        return Task.CompletedTask;
    }

    private string Caminho(string chave)
    {
        var c = Path.GetFullPath(Path.Combine(Raiz, ChavesArquivo.Normalizar(chave).Replace('/', Path.DirectorySeparatorChar)));
        if (!c.StartsWith(Raiz, StringComparison.Ordinal)) throw new ArgumentException("Chave de arquivo fora da pasta de dados.");
        return c;
    }

    public async Task SalvarAsync(string chave, Stream conteudo, string? tipoConteudo, CancellationToken ct)
    {
        var destino = Caminho(chave);
        Directory.CreateDirectory(Path.GetDirectoryName(destino)!);
        var tmp = destino + "." + Guid.NewGuid().ToString("N") + ".tmp";
        await using (var fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16, true))
            await conteudo.CopyToAsync(fs, ct);
        File.Move(tmp, destino, overwrite: true);
    }

    public Task<ArquivoLido?> AbrirAsync(string chave, CancellationToken ct)
    {
        var c = Caminho(chave);
        if (!File.Exists(c)) return Task.FromResult<ArquivoLido?>(null);
        Stream s = new FileStream(c, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, true);
        return Task.FromResult<ArquivoLido?>(new ArquivoLido(s, s.Length, null));
    }

    public Task<bool> ExisteAsync(string chave, CancellationToken ct) => Task.FromResult(File.Exists(Caminho(chave)));
}
