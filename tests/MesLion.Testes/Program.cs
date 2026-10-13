using System.Text;
using System.Text.Json;
using MesLion.Server.Estado;
using MesLion.Server.Relacional;
using MesLion.Server.Seguranca;

int falhas = 0, total = 0;
void Ok(bool c, string nome, string det = "") { total++; Console.WriteLine((c ? "  [OK]    " : "  [FALHA] ") + nome + (c ? "" : " -> " + det)); if (!c) falhas++; }

Console.WriteLine("== bcrypt (hashes gerados pelo PostgreSQL pgcrypto: crypt(senha, gen_salt('bf')))");
var casos = new (string Senha, string Hash)[]
{
    ("meslion2026", "$2a$06$jrNrOzhcuEgHDuHkVvNZAuVmylJKYxUezTn3L3eNP7m6bhuFdvPtu"),
    ("Senh@ ção 🙂", "$2a$06$wB1xma/VF56ar.374fJrLOt8LEBtSitzQjZiT2dp2g/FIT1hWKPgu"),
    ("a", "$2a$04$6r0.gnc5dluRIJETGILbcerUpIk5zxCXuU.fqzC9OmX9lbHZiewo."),
    (new string('x', 80), "$2a$05$TO9kkRl7RptOVypPo3Xuu.CsSF9E59WemKYqf884iJnM6gm/KV6p."),
    ("", "$2a$06$Zs3IFINUqiuFeDGfdPkwaejNZlD5hKb7FmQiy29J2rPN1HDIxl18W"),
};
foreach (var (senha, hash) in casos)
{
    Ok(BCryptLegado.Verificar(senha, hash), $"verifica senha correta ({(senha.Length > 12 ? senha[..12] + "…" : senha)})");
    if (senha.Length < 72) Ok(!BCryptLegado.Verificar(senha + "x", hash), "rejeita senha errada");
}
// bcrypt usa só os 72 primeiros bytes (mesmo comportamento do pgcrypto, conferido no PostgreSQL 16)
Ok(BCryptLegado.Verificar(new string('x', 81), casos[3].Hash), "truncamento em 72 bytes igual ao pgcrypto");
Ok(!BCryptLegado.Verificar(new string('x', 71) + "y", casos[3].Hash), "diferença dentro dos 72 bytes é rejeitada");
// Vetores públicos do OpenBSD/jBCrypt
Ok(BCryptLegado.Verificar("U*U", "$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW"), "vetor OpenBSD U*U");
Ok(BCryptLegado.Verificar("", "$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s."), "vetor jBCrypt (senha vazia)");
Ok(BCryptLegado.Verificar("abcdefghijklmnopqrstuvwxyz", "$2a$06$.rCVZVOThsIa97pEDOxvGuRRgzG64bvtJ0938xuqzv18d3ZpQhstC"), "vetor jBCrypt (alfabeto)");
Ok(BCryptLegado.Verificar("~!@#$%^&*()      ~!@#$%^&*()PNBFRD", "$2a$06$fPIsBO8qRqkjj273rfaOI.HtSV9jLDpTbZn782DC6/t7qT67P6FfO"), "vetor jBCrypt (símbolos)");
var gerado = BCryptLegado.GerarParaTeste("teste123", 5);
Ok(BCryptLegado.Verificar("teste123", gerado), "gera/verifica hash próprio");

Console.WriteLine("== PBKDF2 (formato ASP.NET Core Identity V3)");
var h = SenhaHasher.Gerar("Senha Forte ç");
Ok(Convert.FromBase64String(h)[0] == 1 && Convert.FromBase64String(h).Length == 61, "formato V3 (61 bytes)");
Ok(SenhaHasher.Verificar("Senha Forte ç", h) == SenhaHasher.ResultadoVerificacao.Sucesso, "verifica PBKDF2");
Ok(SenhaHasher.Verificar("senha forte ç", h) == SenhaHasher.ResultadoVerificacao.Falhou, "rejeita PBKDF2 errado");
Ok(SenhaHasher.Verificar("meslion2026", casos[0].Hash) == SenhaHasher.ResultadoVerificacao.SucessoRequerAtualizacao, "bcrypt legado sinaliza atualização");
Ok(SenhaHasher.Verificar("x", SenhaHasher.SemSenhaLocal) == SenhaHasher.ResultadoVerificacao.Falhou, "usuário sem senha local não entra com senha");
Ok(SenhaHasher.Verificar("x", "lixo-que-nao-e-base64") == SenhaHasher.ResultadoVerificacao.Falhou, "hash corrompido não gera exceção");

Console.WriteLine("== JsonEstado (divisão/montagem sem reserializar)");
var json = "{\"a\":[1,2,{\"x\":\"ç\"}],\"meta\":{\"v\":1},\"s\":\"texto \\\"aspas\\\"\",\"n\":1.50,\"nulo\":null,\"vazio\":[],\"a\":[9]}";
var partes = JsonEstado.Dividir(Encoding.UTF8.GetBytes(json));
Ok(partes.Select(p => p.Nome).SequenceEqual(new[] { "a", "meta", "s", "n", "nulo", "vazio" }), "ordem das coleções (duplicada: última vence na 1ª posição)", string.Join(",", partes.Select(p => p.Nome)));
Ok(Encoding.UTF8.GetString(partes[0].ConteudoUtf8.Span) == "[9]", "valor duplicado = último", Encoding.UTF8.GetString(partes[0].ConteudoUtf8.Span));
Ok(Encoding.UTF8.GetString(partes[3].ConteudoUtf8.Span) == "1.50", "número preservado byte a byte (1.50)");
Ok(partes[5].Itens == 0 && partes[0].Itens == 1, "contagem de itens");
var montado = JsonEstado.Montar(partes.Select(p => (p.Nome, p.ConteudoUtf8)));
using (var d1 = JsonDocument.Parse(montado)) Ok(d1.RootElement.GetProperty("s").GetString() == "texto \"aspas\"", "montagem válida");
foreach (var invalido in new[] { "", "[]", "{\"a\":", "{\"a\":1}x", "{a:1}", "{\"a\":1,}" })
{
    bool erro = false; try { JsonEstado.Dividir(Encoding.UTF8.GetBytes(invalido)); } catch (EstadoInvalidoException) { erro = true; }
    Ok(erro, $"rejeita JSON inválido: {invalido}");
}
var bom = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes("{\"x\":1}")).ToArray();
Ok(JsonEstado.Dividir(bom).Count == 1, "aceita BOM UTF-8");
var (est, kv, fmt) = JsonEstado.LerArquivoBanco(Encoding.UTF8.GetBytes("{\"schemaVersion\":39,\"format\":\"MES_LION_JSON_DATABASE\",\"appStorage\":{\"K\":\"V\",\"N\":1},\"data\":{\"op\":[]}}"));
Ok(fmt == "MES_LION_JSON_DATABASE" && Encoding.UTF8.GetString(est) == "{\"op\":[]}" && kv!["K"] == "V" && kv["N"] == "1", "lê formato MES_LION_JSON_DATABASE");

Console.WriteLine("== Gerador de views relacionais");
var col = Encoding.UTF8.GetBytes("[{\"CodOP\":\"OP1\",\"Status\":\"A\",\"status\":\"b\",\"Itens\":[1],\"Custo R$\":\"1,5\",\"Aspas\\\"x\":1,\"\":2},{\"CodOP\":\"OP2\",\"Novo\":null}]");
var v = GeradorViews.Gerar("op", col)!;
Console.WriteLine(v.Sql);
Ok(v.NomeView == "op" && v.Colunas == 8, "view rel.op com 7 campos + _linha", v.Colunas.ToString());
Ok(v.Sql.Contains("[status_2] NVARCHAR(MAX) N'$.\"status\"'"), "coluna duplicada (maiúsc./minúsc.) renomeada");
Ok(v.Sql.Contains("[Itens] NVARCHAR(MAX) N'$.\"Itens\"' AS JSON"), "campo complexo AS JSON");
Ok(v.Sql.Contains("N'$.\"Aspas\\\"x\"'"), "caminho JSON com aspas escapadas");
Ok(!v.Sql.Contains("N'$.\"\"'"), "campo de nome vazio ignorado");
Ok(GeradorViews.Gerar("meta", Encoding.UTF8.GetBytes("{\"versao\":\"1\"}"))!.Sql.Contains("r.[key] AS [chave]"), "coleção-objeto vira chave/valor");
Ok(GeradorViews.NomeView("relacionamentos") == "col_relacionamentos" && GeradorViews.NomeView("vw_x") == "col_vw_x", "nomes reservados prefixados");

Console.WriteLine($"\n== {total - falhas}/{total} verificações OK");
return falhas == 0 ? 0 : 1;
