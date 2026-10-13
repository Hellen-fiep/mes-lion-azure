using System.Buffers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using MesLion.Server.Persistencia;

namespace MesLion.Server.Estado;

public sealed class EstadoInvalidoException(string mensagem) : Exception(mensagem);

/// <summary>
/// Utilitários do documento de estado do MES (o objeto "data" do frontend).
/// O JSON é dividido por coleção de nível superior SEM reserializar os valores:
/// cada coleção é guardada exatamente com os bytes enviados pelo navegador.
/// </summary>
public static class JsonEstado
{
    public static readonly JavaScriptEncoder Codificador = JavaScriptEncoder.UnsafeRelaxedJsonEscaping;

    private static readonly JsonReaderOptions OpcoesLeitura = new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 2048,
    };

    /// <summary>Divide o objeto de estado em coleções (propriedades de nível superior).</summary>
    public static List<ColecaoRecebida> Dividir(ReadOnlyMemory<byte> json)
    {
        var span = json.Span;
        // Ignora BOM UTF-8, se houver.
        int inicio = span.Length >= 3 && span[0] == 0xEF && span[1] == 0xBB && span[2] == 0xBF ? 3 : 0;
        var dados = json[inicio..];
        var leitor = new Utf8JsonReader(dados.Span, OpcoesLeitura);
        try
        {
            if (!leitor.Read() || leitor.TokenType != JsonTokenType.StartObject)
                throw new EstadoInvalidoException("Estado inválido: era esperado um objeto JSON.");

            var ordem = new List<string>();
            var porNome = new Dictionary<string, (int Inicio, int Fim, int? Itens)>(StringComparer.Ordinal);
            while (true)
            {
                if (!leitor.Read()) throw new EstadoInvalidoException("Estado inválido: JSON incompleto.");
                if (leitor.TokenType == JsonTokenType.EndObject) break;
                if (leitor.TokenType != JsonTokenType.PropertyName)
                    throw new EstadoInvalidoException("Estado inválido: propriedade esperada.");
                string nome = leitor.GetString() ?? "";
                if (!leitor.Read()) throw new EstadoInvalidoException("Estado inválido: valor ausente.");
                int ini = (int)leitor.TokenStartIndex;
                int? itens = null;
                if (leitor.TokenType == JsonTokenType.StartArray)
                {
                    int profundidade = leitor.CurrentDepth;
                    int contagem = 0;
                    while (leitor.Read())
                    {
                        if (leitor.TokenType == JsonTokenType.EndArray && leitor.CurrentDepth == profundidade) break;
                        contagem++;
                        if (leitor.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray) leitor.Skip();
                    }
                    itens = contagem;
                }
                else if (leitor.TokenType == JsonTokenType.StartObject)
                {
                    leitor.Skip();
                }
                int fim = (int)leitor.BytesConsumed;
                if (!porNome.ContainsKey(nome)) ordem.Add(nome);
                porNome[nome] = (ini, fim, itens); // última ocorrência prevalece (semântica do JSON.parse)
            }
            if (leitor.Read())
                throw new EstadoInvalidoException("Estado inválido: conteúdo após o fim do objeto JSON.");

            var lista = new List<ColecaoRecebida>(ordem.Count);
            for (int i = 0; i < ordem.Count; i++)
            {
                var (ini, fim, itens) = porNome[ordem[i]];
                var bruto = dados.Slice(ini, fim - ini);
                lista.Add(new ColecaoRecebida(ordem[i], i, bruto, SHA256.HashData(bruto.Span), itens));
            }
            return lista;
        }
        catch (JsonException ex)
        {
            throw new EstadoInvalidoException("Estado inválido (JSON): " + ex.Message);
        }
    }

    /// <summary>Monta o objeto de estado a partir das coleções, na ordem informada.</summary>
    public static byte[] Montar(IEnumerable<(string Nome, ReadOnlyMemory<byte> Conteudo)> colecoes)
    {
        var buffer = new ArrayBufferWriter<byte>(1 << 16);
        using (var w = new Utf8JsonWriter(buffer, new JsonWriterOptions { Encoder = Codificador, SkipValidation = true }))
        {
            w.WriteStartObject();
            foreach (var (nome, conteudo) in colecoes)
            {
                w.WritePropertyName(nome);
                w.WriteRawValue(conteudo.Span, skipInputValidation: true);
            }
            w.WriteEndObject();
        }
        return buffer.WrittenSpan.ToArray();
    }

    public static string Hex(byte[] hash) => Convert.ToHexString(hash).ToLowerInvariant();

    /// <summary>Lê um arquivo de banco no formato do MES (V39: {format:'MES_LION_JSON_DATABASE', data, appStorage})
    /// ou um objeto de estado puro. Retorna o estado (bytes) e o appStorage (se existir).</summary>
    public static (byte[] Estado, Dictionary<string, string>? AppStorage, string Formato) LerArquivoBanco(byte[] conteudo)
    {
        int inicio = conteudo.Length >= 3 && conteudo[0] == 0xEF && conteudo[1] == 0xBB && conteudo[2] == 0xBF ? 3 : 0;
        var mem = conteudo.AsMemory(inicio);
        var partes = Dividir(mem);
        var formato = partes.FirstOrDefault(p => p.Nome == "format");
        bool envelope = formato is not null && Encoding.UTF8.GetString(formato.ConteudoUtf8.Span).Trim() == "\"MES_LION_JSON_DATABASE\"";
        if (!envelope)
            return (mem.ToArray(), null, "ESTADO");

        var dataParte = partes.FirstOrDefault(p => p.Nome == "data")
            ?? throw new EstadoInvalidoException("Arquivo MES_LION_JSON_DATABASE sem a propriedade 'data'.");
        Dictionary<string, string>? kv = null;
        var kvParte = partes.FirstOrDefault(p => p.Nome == "appStorage");
        if (kvParte is not null)
        {
            using var doc = JsonDocument.Parse(kvParte.ConteudoUtf8);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                kv = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var p in doc.RootElement.EnumerateObject())
                    kv[p.Name] = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() ?? "" : p.Value.GetRawText();
            }
        }
        return (dataParte.ConteudoUtf8.ToArray(), kv, "MES_LION_JSON_DATABASE");
    }
}
