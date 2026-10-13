using System.Reflection;
using MesLion.Server.Arquivos;
using MesLion.Server.Configuracao;
using MesLion.Server.Estado;
using MesLion.Server.Persistencia;
using MesLion.Server.Persistencia.Portatil;
using MesLion.Server.Persistencia.SqlServer;
using MesLion.Server.Seguranca;
using Microsoft.Extensions.Options;

namespace MesLion.Server.Infra;

/// <summary>Escolha do provedor, preparação do banco/arquivos e carga inicial (seed).</summary>
public sealed class Inicializacao(
    ProvedorPersistencia provedor, IArmazenamentoArquivos armazenamento, ServicoEstado estado, ServicoUsuarios usuarios,
    IOptions<MesOptions> opcoes, IHostEnvironment env, ILogger<Inicializacao> log)
{
    public static readonly DateTimeOffset IniciadoEm = DateTimeOffset.Now;
    public static string Versao { get; } =
        typeof(Inicializacao).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion?.Split('+')[0] ?? "1.0.0";
    public static string Plataforma => $".NET {Environment.Version.Major}.{Environment.Version.Minor} · ASP.NET Core";
    public static bool NoAzureAppService => !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"));

    public static bool EasyAuthConfiavel(MesOptions o) =>
        o.Autenticacao.EntraId.ConfiarCabecalhosForaDoAzure ||
        (NoAzureAppService && string.Equals(Environment.GetEnvironmentVariable("WEBSITE_AUTH_ENABLED"), "True", StringComparison.OrdinalIgnoreCase));

    public string NomeProvedor => provedor.Nome;
    public string DescricaoBancoCurta => provedor.Nome == "SqlServer" ? provedor.Descricao : "Portátil (arquivos locais — validação)";
    public string PastaDados => armazenamento is ArmazenamentoLocal l ? Path.GetDirectoryName(l.Raiz) ?? l.Raiz : env.ContentRootPath;

    public async Task ExecutarAsync(CancellationToken ct)
    {
        log.LogInformation("Banco de dados: {Banco}", provedor.Descricao);
        await provedor.Inicializador.InicializarAsync(ct);
        log.LogInformation("Arquivos: {Arquivos}", armazenamento.Descricao);
        await armazenamento.InicializarAsync(ct);
        await usuarios.GarantirAdministradorAsync(ct);
        await CarregarSeedSeVazioAsync(ct);
    }

    private async Task CarregarSeedSeVazioAsync(CancellationToken ct)
    {
        var resumo = await provedor.Estado.ResumoAsync(ct);
        if (resumo.Colecoes > 0 || resumo.Versao > 0) return;
        var arquivo = ResolverCaminho(env, opcoes.Value.Seed.ArquivoInicial);
        if (!File.Exists(arquivo))
        {
            var alternativo = Path.Combine(env.ContentRootPath, "Dados", "MES_LION_DATA.json");
            if (File.Exists(alternativo)) arquivo = alternativo;
            else
            {
                log.LogWarning("Banco vazio e arquivo inicial não encontrado ({Arquivo}). O frontend gravará os dados iniciais (js/data.js) no primeiro login.", arquivo);
                return;
            }
        }
        var bytes = await File.ReadAllBytesAsync(arquivo, ct);
        var (r, kv, formato) = await estado.ImportarAsync(bytes, null, ct);
        log.LogInformation("Banco vazio: dados iniciais carregados de {Arquivo} ({Formato}; {Colecoes} coleções; {Kv} chaves de appStorage).",
            arquivo, formato, r.Alteradas.Count, kv);
    }

    public static string ResolverCaminho(IHostEnvironment env, string caminho)
    {
        if (string.IsNullOrWhiteSpace(caminho)) return env.ContentRootPath;
        var expandido = Environment.ExpandEnvironmentVariables(caminho);
        return Path.GetFullPath(Path.IsPathRooted(expandido) ? expandido : Path.Combine(env.ContentRootPath, expandido));
    }

    /// <summary>Pasta base persistente: no Azure App Service usa %HOME%/data/MesLion.</summary>
    public static string ResolverPastaDados(IHostEnvironment env, string caminhoConfigurado, string subpasta)
    {
        if (NoAzureAppService && !Path.IsPathRooted(Environment.ExpandEnvironmentVariables(caminhoConfigurado)))
        {
            var home = Environment.GetEnvironmentVariable("HOME") ?? env.ContentRootPath;
            return Path.Combine(home, "data", "MesLion", subpasta);
        }
        return ResolverCaminho(env, caminhoConfigurado);
    }

    // ------------------------------------------------------------------ escolha do provedor
    public sealed record EscolhaProvedor(string Tipo, string? ConnectionString, string Motivo);

    public static EscolhaProvedor EscolherProvedor(IConfiguration cfg, MesOptions o)
    {
        string? cs = cfg.GetConnectionString(o.Banco.NomeConexao);
        string modo = (o.Banco.Provedor ?? "Auto").Trim().ToLowerInvariant();
        if (modo is "portatil" or "portátil" or "arquivos")
            return new("Portatil", null, "configurado como Portátil");
        if (!string.IsNullOrWhiteSpace(cs))
            return new("SqlServer", cs, "connection string ConnectionStrings:" + o.Banco.NomeConexao);
        if (o.Banco.DetectarLocalDb && OperatingSystem.IsWindows() && LocalDbInstalado())
            return new("SqlServer", $@"Server=(localdb)\MSSQLLocalDB;Database={o.Banco.NomeBancoLocalDb};Integrated Security=true;Encrypt=false;Connect Timeout=60",
                "SQL Server LocalDB detectado neste computador");
        if (modo == "sqlserver")
            throw new InvalidOperationException("MesLion:Banco:Provedor = SqlServer, mas nenhuma connection string foi informada (ConnectionStrings:" + o.Banco.NomeConexao + ").");
        return new("Portatil", null, "nenhum SQL Server configurado/detectado");
    }

    public static bool LocalDbInstalado()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            using var chave = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Microsoft SQL Server Local DB\Installed Versions");
            return chave is not null && chave.GetSubKeyNames().Length > 0;
        }
        catch { return false; }
    }

    public static ProvedorPersistencia CriarProvedor(EscolhaProvedor escolha, MesOptions o, IHostEnvironment env, ILoggerFactory lf, out ConexaoSql? conexao)
    {
        conexao = null;
        if (escolha.Tipo == "SqlServer")
        {
            conexao = new ConexaoSql(escolha.ConnectionString!, o.Banco.TimeoutComandoSegundos, lf.CreateLogger("MesLion.Sql"));
            return ProvedorSqlServer.Criar(conexao, o.Banco.CriarBancoSeNaoExistir && !NoAzureAppService, o.Banco.AplicarScriptsAutomaticamente, lf);
        }
        return ProvedorPortatil.Criar(ResolverPastaDados(env, o.Banco.PastaPortatil, "BancoPortatil"), lf);
    }

    public static IArmazenamentoArquivos CriarArmazenamento(MesOptions o, IHostEnvironment env, ILoggerFactory lf)
    {
        if (string.Equals(o.Arquivos.Provedor, "AzureBlob", StringComparison.OrdinalIgnoreCase))
            return new ArmazenamentoAzureBlob(o.Arquivos.AzureBlob, new HttpClient { Timeout = TimeSpan.FromMinutes(5) }, lf.CreateLogger("MesLion.AzureBlob"));
        return new ArmazenamentoLocal(ResolverPastaDados(env, o.Arquivos.PastaLocal, "Arquivos"));
    }
}
