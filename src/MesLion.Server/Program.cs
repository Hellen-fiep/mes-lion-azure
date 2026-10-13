// =====================================================================
// MES LION — Servidor ASP.NET Core (.NET 10) para Microsoft Azure / SQL Server
// Substitui o servidor PowerShell (server/MES_LION_SERVER.ps1) mantendo o mesmo
// contrato HTTP do frontend; o frontend (wwwroot) é o mesmo do MES LION 1.0 PGSQL.
// =====================================================================
using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using MesLion.Server.Api;
using MesLion.Server.Arquivos;
using MesLion.Server.Configuracao;
using MesLion.Server.Estado;
using MesLion.Server.Infra;
using MesLion.Server.Migracao;
using MesLion.Server.Persistencia;
using MesLion.Server.Persistencia.SqlServer;
using MesLion.Server.Relacional;
using MesLion.Server.Seguranca;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;

Console.OutputEncoding = Encoding.UTF8;
var cli = LinhaDeComando.Ler(args);
if (cli.Ajuda) { LinhaDeComando.MostrarAjuda(); return 0; }

// Pasta de conteúdo: onde estão wwwroot e appsettings.json (funciona ao abrir o .exe de qualquer pasta).
string raizConteudo = Directory.Exists(Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"))
    ? Directory.GetCurrentDirectory()
    : AppContext.BaseDirectory;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = cli.ArgsAspNet,
    ContentRootPath = raizConteudo,
    WebRootPath = Path.Combine(raizConteudo, "wwwroot"),
});
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables();
builder.Configuration.AddCommandLine(cli.ArgsAspNet);

if (cli.Configurar)
{
    return AssistenteConfiguracao.Executar(raizConteudo, builder.Configuration);
}

var opcoes = builder.Configuration.GetSection(MesOptions.Secao).Get<MesOptions>() ?? new MesOptions();
if (cli.AbrirNavegador) opcoes.Servidor.AbrirNavegador = true;
builder.Services.Configure<MesOptions>(builder.Configuration.GetSection(MesOptions.Secao));
builder.Services.PostConfigure<MesOptions>(o => { if (cli.AbrirNavegador) o.Servidor.AbrirNavegador = true; });

builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss "; });
using var lfInicial = LoggerFactory.Create(b => b.AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss "; }));
var logInicial = lfInicial.CreateLogger("MesLion");

// ---------------------------------------------------------------- provedor de banco e arquivos
var escolha = Inicializacao.EscolherProvedor(builder.Configuration, opcoes);
if (escolha.Tipo == "SqlServer" && !ConexaoSql.ProvedorDisponivel)
{
    logInicial.LogWarning("SQL Server solicitado ({Motivo}), mas o Microsoft.Data.SqlClient não está nesta compilação. Usando o modo Portátil.", escolha.Motivo);
    escolha = new Inicializacao.EscolhaProvedor("Portatil", null, "provedor SQL indisponível nesta compilação");
}
var provedor = Inicializacao.CriarProvedor(escolha, opcoes, builder.Environment, lfInicial, out var conexaoSql);
var armazenamento = Inicializacao.CriarArmazenamento(opcoes, builder.Environment, lfInicial);
logInicial.LogInformation("Provedor de dados: {Provedor} — {Motivo}.", provedor.Descricao, escolha.Motivo);

builder.Services.AddSingleton(provedor);
builder.Services.AddSingleton(armazenamento);
if (conexaoSql is not null) builder.Services.AddSingleton(conexaoSql);
builder.Services.AddSingleton<ServicoEstado>();
builder.Services.AddSingleton<ServicoUsuarios>();
builder.Services.AddSingleton<ServicoAuditoria>();
builder.Services.AddSingleton<ServicoArquivos>();
builder.Services.AddSingleton<Inicializacao>();
builder.Services.AddSingleton<ImportadorPostgreSql>();
builder.Services.AddSingleton<ServicoRelacional>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<ServicoRelacional>());

// ---------------------------------------------------------------- sessão (cookie MESSESSION) e chaves
builder.Services.AddDataProtection().SetApplicationName("MesLion");
builder.Services.Configure<KeyManagementOptions>(o => o.XmlRepository = provedor.ChavesProtecao);
builder.Services.AddAuthentication(ServicoUsuarios.EsquemaCookie).AddCookie(ServicoUsuarios.EsquemaCookie, o =>
{
    o.Cookie.Name = "MESSESSION";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Lax;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.Cookie.Path = "/";
    o.ExpireTimeSpan = TimeSpan.FromHours(Math.Max(1, opcoes.Autenticacao.SessaoHoras));
    o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();

// ---------------------------------------------------------------- limites, compressão, proxies do Azure
long limite = Math.Max(32, opcoes.Servidor.LimiteRequisicaoMB) * 1024L * 1024L;
builder.WebHost.ConfigureKestrel(k => { k.Limits.MaxRequestBodySize = limite; k.AddServerHeader = false; });
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o => { o.MultipartBodyLengthLimit = limite; o.ValueLengthLimit = int.MaxValue; });
builder.Services.AddRequestDecompression();
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
    o.MimeTypes = ["application/json", "text/plain", "text/html", "text/css", "application/javascript", "text/javascript", "image/svg+xml"];
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

// Endereço padrão local (igual ao INICIAR_MES.bat original). No Azure, a plataforma define a porta.
bool urlsDefinidas = !string.IsNullOrEmpty(builder.Configuration["urls"]) || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS"))
                     || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS"));
if (!urlsDefinidas && !Inicializacao.NoAzureAppService) builder.WebHost.UseUrls("http://127.0.0.1:8765");

var app = builder.Build();

// ---------------------------------------------------------------- inicialização (esquema, arquivos, seed)
try
{
    await app.Services.GetRequiredService<Inicializacao>().ExecutarAsync(CancellationToken.None);
}
catch (Exception ex)
{
    logInicial.LogCritical(ex, "Falha ao preparar o banco de dados ({Banco}).", provedor.Descricao);
    Console.Error.WriteLine();
    Console.Error.WriteLine("ERRO: não foi possível preparar o banco de dados: " + ex.Message);
    Console.Error.WriteLine("Verifique a connection string (CONFIGURAR_BANCO.bat) ou use o modo Portátil.");
    return 3;
}

// ---------------------------------------------------------------- comandos de manutenção (linha de comando)
if (cli.ImportarMigracao is not null)
{
    try
    {
        var relatorio = await app.Services.GetRequiredService<ImportadorPostgreSql>().ImportarAsync(cli.ImportarMigracao, cli.Sobrescrever, CancellationToken.None);
        Console.WriteLine(); Console.WriteLine(relatorio);
        var rel = app.Services.GetRequiredService<ServicoRelacional>();
        if (rel.Ativo) Console.WriteLine(await rel.ExecutarAgoraAsync(CancellationToken.None));
        return 0;
    }
    catch (Exception ex) { Console.Error.WriteLine("ERRO na importação: " + ex.Message); return 4; }
}
if (cli.TestarConexao)
{
    var resumo = await provedor.Estado.ResumoAsync(CancellationToken.None);
    Console.WriteLine($"OK — {provedor.Descricao}. Estado: versão {resumo.Versao}, {resumo.Colecoes} coleções, {resumo.Bytes:N0} bytes.");
    return 0;
}
if (cli.AtualizarRelacional)
{
    var rel = app.Services.GetRequiredService<ServicoRelacional>();
    Console.WriteLine(rel.Ativo ? await rel.ExecutarAgoraAsync(CancellationToken.None) : "Camada relacional disponível somente com SQL Server.");
    return 0;
}
if (cli.Exportar is not null)
{
    var bytes = await app.Services.GetRequiredService<ServicoEstado>().ExportarAsync(CancellationToken.None);
    await File.WriteAllBytesAsync(cli.Exportar, bytes);
    Console.WriteLine($"Banco exportado para {Path.GetFullPath(cli.Exportar)} ({bytes.Length:N0} bytes).");
    return 0;
}

// ---------------------------------------------------------------- pipeline HTTP
// Limite de corpo por requisição (vale para Kestrel e para o IIS in-process do Azure App Service Windows).
app.Use(async (ctx, next) =>
{
    var recurso = ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
    if (recurso is { IsReadOnly: false }) recurso.MaxRequestBodySize = limite;
    await next();
});
if (Inicializacao.NoAzureAppService) app.UseForwardedHeaders();
app.UseExceptionHandler(e => e.Run(async ctx =>
{
    var erro = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    app.Logger.LogError(erro, "Erro na requisição {Metodo} {Caminho}", ctx.Request.Method, ctx.Request.Path);
    ctx.Response.StatusCode = 500;
    ctx.Response.ContentType = Respostas.TipoJson;
    await ctx.Response.WriteAsync(System.Text.Json.JsonSerializer.Serialize(new { error = erro?.Message ?? "Erro interno" }, Respostas.OpcoesJson));
}));
if (opcoes.Servidor.CompressaoRespostas) app.UseResponseCompression();
if (opcoes.Servidor.AceitarUploadCompactado) app.UseRequestDecompression();
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "same-origin";
    ctx.Response.Headers.XFrameOptions = "SAMEORIGIN";
    await next();
});

var tipos = new FileExtensionContentTypeProvider();
tipos.Mappings[".js"] = "application/javascript; charset=utf-8";
tipos.Mappings[".css"] = "text/css; charset=utf-8";
tipos.Mappings[".html"] = "text/html; charset=utf-8";
tipos.Mappings[".json"] = "application/json; charset=utf-8";
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = tipos,
    OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = "no-cache",
});

app.UseRouting(); // depois dos arquivos estáticos: as rotas de API/fallback não "capturam" o frontend
app.UseAuthentication();
app.Use(async (ctx, next) => // Microsoft Entra ID via Azure App Service Authentication (Easy Auth)
{
    var o = ctx.RequestServices.GetRequiredService<IOptions<MesOptions>>().Value;
    if (o.Autenticacao.EntraId.Habilitado && Inicializacao.EasyAuthConfiavel(o) && PrincipalEasyAuth.Ler(ctx.Request) is { } principal)
    {
        var usuarios = ctx.RequestServices.GetRequiredService<ServicoUsuarios>();
        var atual = await usuarios.AtualAsync(ctx);
        if (atual is null || !string.Equals(atual.ExternalId, principal.Id, StringComparison.OrdinalIgnoreCase))
        {
            var u = await usuarios.ResolverEntraAsync(principal, ctx.RequestAborted);
            if (u is { Active: true })
            {
                await usuarios.EntrarAsync(ctx, u, "ENTRA");
                if (atual is null)
                    await ctx.RequestServices.GetRequiredService<ServicoAuditoria>().RegistrarAsync(u, "auth", "LOGIN_ENTRA", u.Username);
            }
        }
    }
    await next();
});
app.UseAuthorization();

ApiAutenticacao.Mapear(app);
ApiEstado.Mapear(app);
ApiUsuarios.Mapear(app);
ApiDocumentos.Mapear(app);
ApiBanco.Mapear(app);

// Rotas /api desconhecidas: 401 sem sessão, 404 "API não encontrada" com sessão (como no servidor original).
app.Map("/api/{**resto}", async (HttpContext ctx, ServicoUsuarios usuarios) =>
    await usuarios.AtualAsync(ctx) is null ? Respostas.NaoAutenticado() : Respostas.Texto("API não encontrada", 404));
app.MapFallback("{**caminho}", () => Respostas.Texto("Não encontrado", 404)); // inclui caminhos com extensão

// ---------------------------------------------------------------- início
var vida = app.Services.GetRequiredService<IHostApplicationLifetime>();
vida.ApplicationStarted.Register(() =>
{
    var enderecos = app.Urls.ToList();
    Console.WriteLine();
    Console.WriteLine("================================================================");
    Console.WriteLine($" MES LION {Inicializacao.Versao} — {Inicializacao.Plataforma}");
    Console.WriteLine($" Banco: {provedor.Descricao}");
    Console.WriteLine($" Arquivos: {armazenamento.Descricao}");
    foreach (var e in enderecos)
    {
        Console.WriteLine($" Escutando em: {e}");
        if (e.Contains("0.0.0.0") || e.Contains("[::]") || e.Contains("+") || e.Contains("*"))
            Console.WriteLine($" MODO REDE: outros computadores acessam http://{ApiBanco.IpRedeLocal() ?? "IP-DESTE-PC"}:{new Uri(e.Replace("*", "localhost").Replace("+", "localhost").Replace("0.0.0.0", "localhost")).Port}");
    }
    Console.WriteLine(" Usuário inicial: admin  |  Senha inicial: meslion2026");
    Console.WriteLine(" Mantenha esta janela aberta. Ctrl+C encerra.");
    Console.WriteLine("================================================================");
    if (opcoes.Servidor.AbrirNavegador && OperatingSystem.IsWindows())
    {
        var porta = enderecos.Select(e => { try { return new Uri(e.Replace("0.0.0.0", "localhost").Replace("*", "localhost").Replace("+", "localhost")).Port; } catch { return 8765; } }).FirstOrDefault(8765);
        try { Process.Start(new ProcessStartInfo($"http://localhost:{porta}") { UseShellExecute = true }); } catch { }
    }
});

try
{
    await app.RunAsync();
    return 0;
}
catch (IOException ex) when (ex.InnerException is SocketException or AddressInUseException || ex.Message.Contains("address already in use", StringComparison.OrdinalIgnoreCase))
{
    Console.Error.WriteLine();
    Console.Error.WriteLine("ERRO: não foi possível abrir a porta do MES (provavelmente já está em uso).");
    Console.Error.WriteLine("Feche qualquer versão anterior do MES (inclusive a versão PowerShell) e tente novamente.");
    Console.Error.WriteLine(ex.Message);
    return 2;
}

/// <summary>Argumentos próprios do MES (os demais seguem para o ASP.NET Core, ex.: --urls).</summary>
internal sealed record LinhaDeComando(string[] ArgsAspNet, bool AbrirNavegador, bool Configurar, bool TestarConexao, bool AtualizarRelacional,
    string? ImportarMigracao, bool Sobrescrever, string? Exportar, bool Ajuda)
{
    public static LinhaDeComando Ler(string[] args)
    {
        var resto = new List<string>();
        bool abrir = false, configurar = false, testar = false, relacional = false, sobrescrever = false, ajuda = false;
        string? importar = null, exportar = null;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i].ToLowerInvariant())
            {
                case "--abrir-navegador": abrir = true; break;
                case "--configurar": configurar = true; break;
                case "--testar-conexao": testar = true; break;
                case "--atualizar-relacional": relacional = true; break;
                case "--sobrescrever": sobrescrever = true; break;
                case "--importar-migracao" when i + 1 < args.Length: importar = args[++i]; break;
                case "--exportar" when i + 1 < args.Length: exportar = args[++i]; break;
                case "--ajuda" or "-h" or "--help" or "/?": ajuda = true; break;
                default: resto.Add(args[i]); break;
            }
        }
        return new LinhaDeComando(resto.ToArray(), abrir, configurar, testar, relacional, importar, sobrescrever, exportar, ajuda);
    }

    public static void MostrarAjuda()
    {
        Console.WriteLine("""
            MES LION — servidor ASP.NET Core

              MesLion.Server [--urls http://127.0.0.1:8765] [--abrir-navegador]
              MesLion.Server --configurar                    Assistente de configuração do banco
              MesLion.Server --testar-conexao                Testa o banco configurado
              MesLion.Server --importar-migracao <pasta> [--sobrescrever]
                                                             Importa o pacote exportado do PostgreSQL
              MesLion.Server --atualizar-relacional          Atualiza views/tabelas relacionais (SQL Server)
              MesLion.Server --exportar <arquivo.json>       Exporta o banco no formato MES_LION_JSON_DATABASE
            """);
    }
}
