using System.Text.Json;
using System.Text.Json.Nodes;
using MesLion.Server.Persistencia.SqlServer;

namespace MesLion.Server.Infra;

/// <summary>Assistente de console (CONFIGURAR_BANCO.bat): grava appsettings.Local.json com o banco escolhido.</summary>
public static class AssistenteConfiguracao
{
    public static int Executar(string raiz, IConfiguration cfg)
    {
        Console.WriteLine();
        Console.WriteLine("=====================================================");
        Console.WriteLine(" MES LION — Configuração do banco de dados");
        Console.WriteLine("=====================================================");
        Console.WriteLine(" 1) Portátil — arquivos locais, sem SQL Server (validação rápida)");
        Console.WriteLine(" 2) SQL Server LocalDB — (localdb)\\MSSQLLocalDB" + (Inicializacao.LocalDbInstalado() ? "  [DETECTADO]" : ""));
        Console.WriteLine(" 3) SQL Server da empresa / SQL Express (servidor\\instância)");
        Console.WriteLine(" 4) Azure SQL Database");
        Console.WriteLine();
        string op = Perguntar("Escolha [1-4]", "1");

        string? cs = null;
        string provedor = "SqlServer";
        switch (op)
        {
            case "1": provedor = "Portatil"; break;
            case "2":
                cs = $@"Server=(localdb)\MSSQLLocalDB;Database={Perguntar("Nome do banco", "MesLion")};Integrated Security=true;Encrypt=false;Connect Timeout=60";
                break;
            case "3":
            {
                string servidor = Perguntar("Servidor (ex.: SERVIDOR\\SQLEXPRESS ou servidor,1433)", @".\SQLEXPRESS");
                string banco = Perguntar("Nome do banco", "MesLion");
                string auth = Perguntar("Autenticação: 1) Windows (integrada)  2) Usuário/senha SQL", "1");
                cs = auth == "2"
                    ? $"Server={servidor};Database={banco};User ID={Perguntar("Usuário SQL", "meslion")};Password={PerguntarSenha("Senha SQL")};Encrypt=true;TrustServerCertificate=true"
                    : $"Server={servidor};Database={banco};Integrated Security=true;Encrypt=true;TrustServerCertificate=true";
                break;
            }
            case "4":
            {
                string servidor = Perguntar("Servidor (ex.: meuservidor.database.windows.net)", "");
                if (!servidor.Contains('.')) servidor += ".database.windows.net";
                string banco = Perguntar("Nome do banco", "meslion");
                string auth = Perguntar("Autenticação: 1) Microsoft Entra ID interativo (abre o navegador)  2) Entra ID padrão (az login / Visual Studio)  3) Usuário/senha SQL", "1");
                string baseCs = $"Server=tcp:{servidor},1433;Database={banco};Encrypt=true;TrustServerCertificate=false;Connect Timeout=60";
                cs = auth switch
                {
                    "2" => baseCs + ";Authentication=Active Directory Default",
                    "3" => baseCs + $";User ID={Perguntar("Usuário SQL", "")};Password={PerguntarSenha("Senha SQL")}",
                    _ => baseCs + ";Authentication=Active Directory Interactive",
                };
                break;
            }
            default: Console.WriteLine("Opção inválida."); return 1;
        }

        string arquivo = Path.Combine(raiz, "appsettings.Local.json");
        JsonObject raizJson;
        try { raizJson = File.Exists(arquivo) ? JsonNode.Parse(File.ReadAllText(arquivo)) as JsonObject ?? new JsonObject() : new JsonObject(); }
        catch { raizJson = new JsonObject(); }
        var mes = raizJson["MesLion"] as JsonObject ?? new JsonObject();
        var banco2 = mes["Banco"] as JsonObject ?? new JsonObject();
        banco2["Provedor"] = provedor;
        mes["Banco"] = banco2;
        raizJson["MesLion"] = mes;
        var conexoes = raizJson["ConnectionStrings"] as JsonObject ?? new JsonObject();
        conexoes["MesLion"] = cs ?? "";
        raizJson["ConnectionStrings"] = conexoes;
        File.WriteAllText(arquivo, raizJson.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        Console.WriteLine();
        Console.WriteLine($"Configuração gravada em {arquivo}.");

        if (cs is not null)
        {
            Console.WriteLine("Testando conexão...");
            try
            {
                if (!ConexaoSql.ProvedorDisponivel) throw new InvalidOperationException("Microsoft.Data.SqlClient ausente nesta compilação.");
                var b = ConexaoSql.Fabrica.CreateConnectionStringBuilder()!;
                b.ConnectionString = cs;
                bool azure = cs.Contains("database.windows.net", StringComparison.OrdinalIgnoreCase);
                if (!azure) b["Initial Catalog"] = "master";
                using var c = ConexaoSql.Fabrica.CreateConnection()!;
                c.ConnectionString = b.ConnectionString;
                c.Open();
                using var cmd = c.CreateCommand();
                cmd.CommandText = "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) + N' — ' + CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100));";
                Console.WriteLine("Conexão OK: SQL Server " + cmd.ExecuteScalar());
                Console.WriteLine(azure ? "O esquema será criado na primeira inicialização do MES." : "O banco e o esquema serão criados na primeira inicialização do MES.");
            }
            catch (Exception ex)
            {
                Console.WriteLine("FALHA na conexão: " + ex.Message);
                Console.WriteLine("A configuração foi gravada mesmo assim; corrija e rode CONFIGURAR_BANCO.bat novamente se necessário.");
                return 1;
            }
        }
        return 0;
    }

    private static string Perguntar(string texto, string padrao)
    {
        Console.Write(string.IsNullOrEmpty(padrao) ? $"{texto}: " : $"{texto} [{padrao}]: ");
        var r = Console.ReadLine();
        return string.IsNullOrWhiteSpace(r) ? padrao : r.Trim();
    }

    private static string PerguntarSenha(string texto)
    {
        Console.Write(texto + ": ");
        var senha = new System.Text.StringBuilder();
        if (Console.IsInputRedirected) return Console.ReadLine() ?? "";
        while (true)
        {
            var k = Console.ReadKey(intercept: true);
            if (k.Key == ConsoleKey.Enter) break;
            if (k.Key == ConsoleKey.Backspace) { if (senha.Length > 0) senha.Length--; continue; }
            senha.Append(k.KeyChar);
        }
        Console.WriteLine();
        return senha.ToString();
    }
}
