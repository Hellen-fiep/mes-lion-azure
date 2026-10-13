using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MesLion.Server.Configuracao;

namespace MesLion.Server.Arquivos;

/// <summary>
/// Azure Blob Storage via API REST oficial (x-ms-version 2021-12-02), sem dependências externas.
/// Autenticação: chave da conta (connection string) ou identidade gerenciada do Azure App Service.
/// </summary>
public sealed class ArmazenamentoAzureBlob : IArmazenamentoArquivos
{
    private const string VersaoApi = "2021-12-02";
    private readonly HttpClient _http;
    private readonly Uri _contaUrl;
    private readonly string _container;
    private readonly string? _contaNome;
    private readonly byte[]? _chaveConta;
    private readonly bool _identidadeGerenciada;
    private readonly string? _clientId;
    private readonly ILogger _log;
    private string? _token;
    private DateTimeOffset _tokenExpira;
    private readonly SemaphoreSlim _travaToken = new(1, 1);

    public string Descricao => $"Azure Blob Storage: {_contaUrl.GetLeftPart(UriPartial.Path).TrimEnd('/')}/{_container}" + (_identidadeGerenciada ? " (identidade gerenciada)" : "");

    public ArmazenamentoAzureBlob(AzureBlobOptions o, HttpClient http, ILogger log)
    {
        _http = http;
        _log = log;
        _container = string.IsNullOrWhiteSpace(o.Container) ? "meslion" : o.Container.Trim().ToLowerInvariant();
        _identidadeGerenciada = o.UsarIdentidadeGerenciada;
        _clientId = o.ClientIdIdentidade;

        if (!string.IsNullOrWhiteSpace(o.ConnectionString))
        {
            var partes = ParseConnectionString(o.ConnectionString);
            if (partes.TryGetValue("UseDevelopmentStorage", out var dev) && dev.Equals("true", StringComparison.OrdinalIgnoreCase))
            {
                partes["AccountName"] = "devstoreaccount1";
                partes["AccountKey"] = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
                partes["BlobEndpoint"] = "http://127.0.0.1:10000/devstoreaccount1";
            }
            _contaNome = partes.GetValueOrDefault("AccountName");
            var chave = partes.GetValueOrDefault("AccountKey");
            if (!string.IsNullOrEmpty(chave)) _chaveConta = Convert.FromBase64String(chave);
            string endpoint = partes.GetValueOrDefault("BlobEndpoint")
                ?? $"{partes.GetValueOrDefault("DefaultEndpointsProtocol") ?? "https"}://{_contaNome}.blob.{partes.GetValueOrDefault("EndpointSuffix") ?? "core.windows.net"}";
            _contaUrl = new Uri(endpoint.TrimEnd('/') + "/");
        }
        else if (!string.IsNullOrWhiteSpace(o.ContaUrl))
        {
            _contaUrl = new Uri(o.ContaUrl.TrimEnd('/') + "/");
            _contaNome = _contaUrl.Host.Split('.')[0];
            _identidadeGerenciada = true;
        }
        else throw new InvalidOperationException("Azure Blob: informe MesLion:Arquivos:AzureBlob:ConnectionString ou ContaUrl.");

        if (_chaveConta is null && !_identidadeGerenciada)
            throw new InvalidOperationException("Azure Blob: a connection string não tem AccountKey; habilite UsarIdentidadeGerenciada.");
    }

    private static Dictionary<string, string> ParseConnectionString(string cs)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var parte in cs.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            int i = parte.IndexOf('=');
            if (i > 0) d[parte[..i].Trim()] = parte[(i + 1)..].Trim();
        }
        return d;
    }

    private Uri UrlBlob(string chave)
    {
        var caminho = string.Join('/', ChavesArquivo.Normalizar(chave).Split('/').Select(Uri.EscapeDataString));
        return new Uri(_contaUrl, $"{_container}/{caminho}");
    }

    public async Task InicializarAsync(CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Put, new Uri(_contaUrl, $"{_container}?restype=container"));
        req.Content = new ByteArrayContent([]);
        using var resp = await EnviarAsync(req, ct);
        if (resp.StatusCode is HttpStatusCode.Created or HttpStatusCode.Conflict) return;
        throw new InvalidOperationException($"Azure Blob: não foi possível preparar o container '{_container}' ({(int)resp.StatusCode}): {await resp.Content.ReadAsStringAsync(ct)}");
    }

    public async Task SalvarAsync(string chave, Stream conteudo, string? tipoConteudo, CancellationToken ct)
    {
        byte[] dados;
        if (conteudo is MemoryStream ms && ms.Position == 0) dados = ms.ToArray();
        else { using var tmp = new MemoryStream(); await conteudo.CopyToAsync(tmp, ct); dados = tmp.ToArray(); }

        var req = new HttpRequestMessage(HttpMethod.Put, UrlBlob(chave)) { Content = new ByteArrayContent(dados) };
        req.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(string.IsNullOrWhiteSpace(tipoConteudo) ? "application/octet-stream" : tipoConteudo);
        req.Headers.Add("x-ms-blob-type", "BlockBlob");
        using var resp = await EnviarAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"Azure Blob: falha ao gravar '{chave}' ({(int)resp.StatusCode}): {await resp.Content.ReadAsStringAsync(ct)}");
    }

    public async Task<ArquivoLido?> AbrirAsync(string chave, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, UrlBlob(chave));
        var resp = await EnviarAsync(req, ct, HttpCompletionOption.ResponseHeadersRead);
        if (resp.StatusCode == HttpStatusCode.NotFound) { resp.Dispose(); return null; }
        if (!resp.IsSuccessStatusCode)
        {
            var erro = await resp.Content.ReadAsStringAsync(ct);
            resp.Dispose();
            throw new InvalidOperationException($"Azure Blob: falha ao ler '{chave}' ({(int)resp.StatusCode}): {erro}");
        }
        var s = await resp.Content.ReadAsStreamAsync(ct);
        return new ArquivoLido(new StreamComResposta(s, resp), resp.Content.Headers.ContentLength, resp.Content.Headers.ContentType?.ToString());
    }

    public async Task<bool> ExisteAsync(string chave, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Head, UrlBlob(chave));
        using var resp = await EnviarAsync(req, ct);
        return resp.IsSuccessStatusCode;
    }

    private async Task<HttpResponseMessage> EnviarAsync(HttpRequestMessage req, CancellationToken ct, HttpCompletionOption opcao = HttpCompletionOption.ResponseContentRead)
    {
        req.Headers.Add("x-ms-version", VersaoApi);
        req.Headers.Add("x-ms-date", DateTimeOffset.UtcNow.ToString("R", CultureInfo.InvariantCulture));
        if (_identidadeGerenciada && _chaveConta is null)
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await ObterTokenAsync(ct));
        else
            AssinarChaveCompartilhada(req);
        return await _http.SendAsync(req, opcao, ct);
    }

    /// <summary>Assinatura "Shared Key" do Blob Service (documentação oficial do Azure Storage).</summary>
    private void AssinarChaveCompartilhada(HttpRequestMessage req)
    {
        string Cab(string nome) => req.Content?.Headers.TryGetValues(nome, out var v) == true ? string.Join(",", v) : "";
        long? tamanho = req.Content?.Headers.ContentLength;
        if (req.Content is not null && tamanho is null) tamanho = 0;
        string contentLength = tamanho is null or 0 ? "" : tamanho.Value.ToString(CultureInfo.InvariantCulture);

        var xms = req.Headers
            .Where(h => h.Key.StartsWith("x-ms-", StringComparison.OrdinalIgnoreCase))
            .Select(h => (Nome: h.Key.ToLowerInvariant(), Valor: string.Join(",", h.Value).Trim()))
            .OrderBy(h => h.Nome, StringComparer.Ordinal);
        var cabecalhos = new StringBuilder();
        foreach (var (nome, valor) in xms) cabecalhos.Append(nome).Append(':').Append(valor).Append('\n');

        var uri = req.RequestUri!;
        var recurso = new StringBuilder().Append('/').Append(_contaNome).Append(uri.AbsolutePath);
        if (!string.IsNullOrEmpty(uri.Query))
        {
            var parametros = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(p => p.Split('=', 2))
                .GroupBy(p => Uri.UnescapeDataString(p[0]).ToLowerInvariant())
                .OrderBy(g => g.Key, StringComparer.Ordinal);
            foreach (var g in parametros)
                recurso.Append('\n').Append(g.Key).Append(':').Append(string.Join(",", g.Select(p => p.Length > 1 ? Uri.UnescapeDataString(p[1]) : "").OrderBy(x => x, StringComparer.Ordinal)));
        }

        string paraAssinar = string.Join("\n",
            req.Method.Method.ToUpperInvariant(),
            Cab("Content-Encoding"),
            Cab("Content-Language"),
            contentLength,
            Cab("Content-MD5"),
            Cab("Content-Type"),
            "", // Date (usa x-ms-date)
            req.Headers.IfModifiedSince?.ToString("R") ?? "",
            req.Headers.IfMatch.Count > 0 ? string.Join(",", req.Headers.IfMatch) : "",
            req.Headers.IfNoneMatch.Count > 0 ? string.Join(",", req.Headers.IfNoneMatch) : "",
            req.Headers.IfUnmodifiedSince?.ToString("R") ?? "",
            req.Headers.Range?.ToString() ?? "") + "\n" + cabecalhos + recurso;

        using var hmac = new HMACSHA256(_chaveConta!);
        string assinatura = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(paraAssinar)));
        req.Headers.Authorization = new AuthenticationHeaderValue("SharedKey", $"{_contaNome}:{assinatura}");
    }

    /// <summary>Token OAuth da identidade gerenciada (App Service: IDENTITY_ENDPOINT; VM/AKS: IMDS).</summary>
    private async Task<string> ObterTokenAsync(CancellationToken ct)
    {
        if (_token is not null && DateTimeOffset.UtcNow < _tokenExpira) return _token;
        await _travaToken.WaitAsync(ct);
        try
        {
            if (_token is not null && DateTimeOffset.UtcNow < _tokenExpira) return _token;
            const string recurso = "https://storage.azure.com/";
            string? endpoint = Environment.GetEnvironmentVariable("IDENTITY_ENDPOINT");
            string? segredo = Environment.GetEnvironmentVariable("IDENTITY_HEADER");
            HttpRequestMessage req;
            if (!string.IsNullOrEmpty(endpoint) && !string.IsNullOrEmpty(segredo))
            {
                var url = $"{endpoint}?resource={Uri.EscapeDataString(recurso)}&api-version=2019-08-01" + (string.IsNullOrEmpty(_clientId) ? "" : $"&client_id={Uri.EscapeDataString(_clientId)}");
                req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Add("X-IDENTITY-HEADER", segredo);
            }
            else
            {
                var url = $"http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource={Uri.EscapeDataString(recurso)}" + (string.IsNullOrEmpty(_clientId) ? "" : $"&client_id={Uri.EscapeDataString(_clientId)}");
                req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Add("Metadata", "true");
            }
            using var resp = await _http.SendAsync(req, ct);
            var corpo = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode) throw new InvalidOperationException($"Identidade gerenciada indisponível ({(int)resp.StatusCode}): {corpo}");
            using var doc = JsonDocument.Parse(corpo);
            _token = doc.RootElement.GetProperty("access_token").GetString();
            long expira = 0;
            if (doc.RootElement.TryGetProperty("expires_on", out var e))
                expira = e.ValueKind == JsonValueKind.Number ? e.GetInt64() : long.Parse(e.GetString() ?? "0", CultureInfo.InvariantCulture);
            _tokenExpira = expira > 0 ? DateTimeOffset.FromUnixTimeSeconds(expira).AddMinutes(-5) : DateTimeOffset.UtcNow.AddMinutes(30);
            _log.LogInformation("Token de identidade gerenciada obtido para o Azure Storage (expira {Expira:u}).", _tokenExpira);
            return _token!;
        }
        finally { _travaToken.Release(); }
    }

    /// <summary>Mantém a resposta HTTP viva enquanto o conteúdo é transmitido ao navegador.</summary>
    private sealed class StreamComResposta(Stream interno, HttpResponseMessage resposta) : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => interno.Read(buffer, offset, count);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) => interno.ReadAsync(buffer, ct);
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) => interno.ReadAsync(buffer, offset, count, ct);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            if (disposing) { interno.Dispose(); resposta.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
