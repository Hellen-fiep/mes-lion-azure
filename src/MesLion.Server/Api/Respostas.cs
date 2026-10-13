using System.Text;
using System.Text.Json;
using MesLion.Server.Estado;

namespace MesLion.Server.Api;

/// <summary>Respostas HTTP no mesmo formato do servidor PowerShell original.</summary>
public static class Respostas
{
    public static readonly JsonSerializerOptions OpcoesJson = new()
    {
        Encoder = JsonEstado.Codificador,
        PropertyNamingPolicy = null,
    };

    public const string TipoJson = "application/json; charset=utf-8";
    public const string TipoTexto = "text/plain; charset=utf-8";

    public static IResult Json(object? o, int status = 200) => Results.Json(o, OpcoesJson, TipoJson, status);
    public static IResult Erro(int status, string mensagem) => Json(new { error = mensagem }, status);
    public static IResult NaoAutenticado() => Erro(401, "Não autenticado");
    public static IResult SomenteAdmin() => Erro(403, "Acesso administrativo necessário");
    public static IResult Texto(string texto, int status = 200) => Results.Text(texto, TipoTexto, Encoding.UTF8, status);
    public static IResult Ok() => Texto("OK");

    /// <summary>
    /// Trecho do caminho ORIGINAL da requisição (ainda codificado) após o prefixo, decodificado uma única vez
    /// — mesmo comportamento do [uri]::UnescapeDataString do servidor PowerShell (inclusive para %2F).
    /// </summary>
    public static string? TrechoCaminho(HttpContext ctx, string prefixo, string? sufixo = null)
    {
        string bruto = ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpRequestFeature>()?.RawTarget ?? ctx.Request.Path.Value ?? "";
        int q = bruto.IndexOf('?');
        if (q >= 0) bruto = bruto[..q];
        if (!bruto.StartsWith(prefixo, StringComparison.Ordinal)) return null;
        string resto = bruto[prefixo.Length..];
        if (sufixo is not null)
        {
            if (!resto.EndsWith(sufixo, StringComparison.Ordinal)) return null;
            resto = resto[..^sufixo.Length];
        }
        if (resto.Length == 0) return null;
        try { return Uri.UnescapeDataString(resto); } catch { return resto; }
    }

    /// <summary>Data no formato ISO 8601 com fuso (equivalente ao row_to_json do PostgreSQL).</summary>
    public static string Data(DateTimeOffset d) => d.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz");

    public static async Task<string> LerCorpoTextoAsync(HttpRequest req, CancellationToken ct)
    {
        using var r = new StreamReader(req.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return await r.ReadToEndAsync(ct);
    }

    public static async Task<byte[]> LerCorpoBytesAsync(HttpRequest req, CancellationToken ct)
    {
        using var ms = new MemoryStream(req.ContentLength is > 0 and < int.MaxValue ? (int)req.ContentLength.Value : 1 << 16);
        await req.Body.CopyToAsync(ms, ct);
        return ms.ToArray();
    }

    public static JsonElement? LerJson(string texto)
    {
        if (string.IsNullOrWhiteSpace(texto)) return null;
        try { using var doc = JsonDocument.Parse(texto); return doc.RootElement.Clone(); }
        catch (JsonException) { return null; }
    }

    public static string? Str(this JsonElement? e, string nome)
    {
        if (e is not { ValueKind: JsonValueKind.Object } o || !o.TryGetProperty(nome, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => v.GetRawText(),
        };
    }

    /// <summary>Equivalente ao teste "if($b.active)" do PowerShell (valor verdadeiro).</summary>
    public static bool Verdadeiro(this JsonElement? e, string nome)
    {
        if (e is not { ValueKind: JsonValueKind.Object } o || !o.TryGetProperty(nome, out var v)) return false;
        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.String => !string.IsNullOrEmpty(v.GetString()),
            JsonValueKind.Number => v.TryGetDouble(out var d) && d != 0,
            JsonValueKind.Object or JsonValueKind.Array => true,
            _ => false,
        };
    }
}
