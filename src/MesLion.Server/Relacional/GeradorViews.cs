using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MesLion.Server.Persistencia;

namespace MesLion.Server.Relacional;

/// <summary>Definição de uma view rel.&lt;coleção&gt; gerada a partir dos campos reais da coleção.</summary>
public sealed record DefinicaoView(string Colecao, string NomeView, string Assinatura, int Colunas, string Sql);

/// <summary>
/// Gera uma view SQL por coleção do estado (rel.op, rel.materiais, rel.op_etapas…), com uma coluna por campo
/// encontrado nos registros. Assim, coleções e campos criados por novas versões do frontend aparecem
/// automaticamente no SQL Server / Power BI, sem alterar o esquema.
/// </summary>
public static class GeradorViews
{
    private static readonly HashSet<string> NomesReservados = new(StringComparer.OrdinalIgnoreCase)
    {
        "relacionamentos", "views_geradas", "sincronizacao_status", "qualidade_dados", "fn_num", "usp_sincronizar_modelo_relacional",
    };

    private enum TipoCampo { Escalar = 1, Complexo = 2 }

    public static string NomeView(string colecao)
    {
        var nome = new string(colecao.Select(ch => char.IsLetterOrDigit(ch) || ch == '_' ? ch : '_').ToArray());
        if (nome.Length == 0) nome = "colecao";
        if (NomesReservados.Contains(nome) || nome.StartsWith("vw_", StringComparison.OrdinalIgnoreCase) || char.IsDigit(nome[0])) nome = "col_" + nome;
        if (nome.Length > 120) nome = nome[..100] + "_" + Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(colecao)))[..8];
        return nome;
    }

    public static string Identificador(string nome) => "[" + nome.Replace("]", "]]") + "]";
    public static string Literal(string s) => "N'" + s.Replace("'", "''") + "'";
    public static string CaminhoJson(string chave)
    {
        var sb = new StringBuilder("$.\"");
        foreach (var ch in chave)
        {
            if (ch == '"') sb.Append("\\\"");
            else if (ch == '\\') sb.Append("\\\\");
            else if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
            else sb.Append(ch);
        }
        return sb.Append('"').ToString();
    }

    public static DefinicaoView? Gerar(string colecao, ReadOnlyMemory<byte> conteudo)
    {
        var leitor = new Utf8JsonReader(conteudo.Span, new JsonReaderOptions { MaxDepth = 2048 });
        if (!leitor.Read()) return null;
        string view = NomeView(colecao);
        string fqn = "rel." + Identificador(view);

        if (leitor.TokenType == JsonTokenType.StartObject)
        {
            // Coleção-objeto (ex.: meta): pares chave/valor.
            string sqlObj = $@"CREATE OR ALTER VIEW {fqn}
AS
/* Gerada automaticamente pelo MES LION a partir da coleção {colecao.Replace("*/", "* /")} (objeto chave/valor). */
SELECT r.[key] AS [chave], r.[value] AS [valor], r.[type] AS [tipo_json]
FROM dbo.app_state_collection c
CROSS APPLY OPENJSON(c.content) r
WHERE c.name = {Literal(colecao)};";
            return new DefinicaoView(colecao, view, Hash("OBJ|" + colecao + "|" + view), 3, sqlObj);
        }
        if (leitor.TokenType != JsonTokenType.StartArray) return null;

        var campos = new List<string>();
        var tipos = new Dictionary<string, (int Escalares, int Complexos)>(StringComparer.Ordinal);
        int objetos = 0, outros = 0;
        int profundidadeArray = leitor.CurrentDepth;
        while (leitor.Read())
        {
            if (leitor.TokenType == JsonTokenType.EndArray && leitor.CurrentDepth == profundidadeArray) break;
            if (leitor.TokenType == JsonTokenType.StartObject)
            {
                objetos++;
                int prof = leitor.CurrentDepth;
                while (leitor.Read())
                {
                    if (leitor.TokenType == JsonTokenType.EndObject && leitor.CurrentDepth == prof) break;
                    if (leitor.TokenType != JsonTokenType.PropertyName) continue;
                    string chave = leitor.GetString() ?? "";
                    leitor.Read();
                    bool complexo = leitor.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray;
                    if (complexo) leitor.Skip();
                    bool nulo = leitor.TokenType == JsonTokenType.Null;
                    if (!tipos.TryGetValue(chave, out var t)) { campos.Add(chave); t = (0, 0); }
                    tipos[chave] = nulo ? t : complexo ? (t.Escalares, t.Complexos + 1) : (t.Escalares + 1, t.Complexos);
                }
            }
            else
            {
                outros++;
                if (leitor.TokenType == JsonTokenType.StartArray) leitor.Skip();
            }
        }

        if (objetos == 0)
        {
            string sqlVal = $@"CREATE OR ALTER VIEW {fqn}
AS
/* Gerada automaticamente pelo MES LION a partir da coleção {colecao.Replace("*/", "* /")} (lista de valores). */
SELECT TRY_CAST(r.[key] AS INT) AS [_linha], r.[value] AS [valor], r.[type] AS [tipo_json]
FROM dbo.app_state_collection c
CROSS APPLY OPENJSON(c.content) r
WHERE c.name = {Literal(colecao)};";
            return new DefinicaoView(colecao, view, Hash("VAL|" + colecao + "|" + view), 3, sqlVal);
        }

        // Nomes de coluna únicos (identificadores SQL Server não diferenciam maiúsculas na collation padrão).
        var usados = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "_linha" };
        var colunas = new List<(string Coluna, string Chave, bool ComoJson)>();
        foreach (var chave in campos)
        {
            if (string.IsNullOrWhiteSpace(chave)) continue; // caminho JSON vazio não é suportado pelo SQL Server
            string baseNome = chave.Trim();
            if (baseNome.Length > 120) baseNome = baseNome[..110] + "_" + Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(chave)))[..6];
            string nome = baseNome;
            for (int i = 2; !usados.Add(nome); i++) nome = $"{baseNome}_{i}";
            var t = tipos[chave];
            colunas.Add((nome, chave, t.Complexos > t.Escalares));
        }

        var sb = new StringBuilder();
        sb.Append("CREATE OR ALTER VIEW ").Append(fqn).Append("\nAS\n")
          .Append("/* Gerada automaticamente pelo MES LION a partir da coleção ").Append(colecao.Replace("*/", "* /"))
          .Append($" ({objetos} registros, {colunas.Count} campos). Campos complexos (objetos/listas) vêm como JSON. */\n")
          .Append("SELECT TRY_CAST(r.[key] AS INT) AS [_linha], j.*\nFROM dbo.app_state_collection c\nCROSS APPLY OPENJSON(c.content) r\nCROSS APPLY OPENJSON(r.[value]) WITH (\n");
        for (int i = 0; i < colunas.Count; i++)
        {
            var (col, chave, json) = colunas[i];
            sb.Append("    ").Append(Identificador(col)).Append(" NVARCHAR(MAX) ").Append(Literal(CaminhoJson(chave)));
            if (json) sb.Append(" AS JSON");
            sb.Append(i < colunas.Count - 1 ? ",\n" : "\n");
        }
        sb.Append(") j\nWHERE c.name = ").Append(Literal(colecao)).Append(" AND r.[type] = 5;");

        string assinatura = Hash("ARR|" + colecao + "|" + view + "|" + string.Join("|", colunas.Select(c => c.Coluna + "=" + c.Chave + (c.ComoJson ? ":J" : ""))));
        return new DefinicaoView(colecao, view, assinatura, colunas.Count + 1, sb.ToString());
    }

    private static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
}
