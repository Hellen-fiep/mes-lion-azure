using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using MesLion.Server.Arquivos;
using MesLion.Server.Configuracao;
using MesLion.Server.Estado;
using MesLion.Server.Infra;
using MesLion.Server.Persistencia;
using MesLion.Server.Relacional;
using MesLion.Server.Seguranca;
using Microsoft.Extensions.Options;
using static MesLion.Server.Api.Respostas;

namespace MesLion.Server.Api;

/// <summary>
/// Menu "Banco" do cabeçalho (backup, exportar, importar, pasta de dados), /api/info, publicação do
/// passaporte para QR e /healthz. Estas rotas já eram chamadas pelo frontend, mas não existiam no
/// servidor PowerShell (respondiam 404); aqui foram implementadas.
/// </summary>
public static class ApiBanco
{
    public static void Mapear(WebApplication app)
    {
        app.MapPost("/api/backup", async (HttpContext ctx, ServicoUsuarios usuarios, ServicoArquivos arquivos, ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            var (b, caminho) = await arquivos.CriarBackupAsync("Backup manual (menu Banco)", u, ctx.RequestAborted);
            await auditoria.RegistrarAsync(u, "banco", "BACKUP", b.Id.ToString());
            return Json(new { ok = true, id = b.Id, path = caminho, createdAt = Data(b.CreatedAt), sizeBytes = b.SizeBytes, stateVersion = b.StateVersion });
        });

        app.MapGet("/api/export", async (HttpContext ctx, ServicoUsuarios usuarios, ServicoEstado estado, ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            var bytes = await estado.ExportarAsync(ctx.RequestAborted);
            await auditoria.RegistrarAsync(u, "banco", "EXPORT", $"{bytes.Length} bytes");
            var nome = $"MES_LION_BANCO_{DateTime.Now:yyyyMMdd_HHmmss}.json";
            return Results.File(bytes, TipoJson, nome);
        });

        app.MapPost("/api/import", async (HttpContext ctx, ServicoUsuarios usuarios, ServicoEstado estado, ServicoArquivos arquivos,
            ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            if (u.Role != Perfis.Admin) return SomenteAdmin();
            var corpo = await LerCorpoBytesAsync(ctx.Request, ctx.RequestAborted);
            try
            {
                JsonEstado.LerArquivoBanco(corpo); // valida antes de qualquer alteração
                var (backup, _) = await arquivos.CriarBackupAsync("Automático antes de importar banco", u, ctx.RequestAborted);
                var (r, kv, formato) = await estado.ImportarAsync(corpo, u, ctx.RequestAborted);
                await auditoria.RegistrarAsync(u, "banco", "IMPORT", formato,
                    ServicoAuditoria.Detalhes(new { backupAnterior = backup.Id, versao = r.Versao, colecoes = r.Alteradas.Count, removidas = r.Removidas, chavesAppStorage = kv }));
                return Json(new { ok = true, formato, versao = r.Versao, colecoesAlteradas = r.Alteradas.Count, colecoesRemovidas = r.Removidas.Count, backupAnterior = backup.Id });
            }
            catch (EstadoInvalidoException ex) { return Erro(400, ex.Message); }
        });

        app.MapPost("/api/open-data-folder", async (HttpContext ctx, ServicoUsuarios usuarios, IArmazenamentoArquivos armazenamento, Inicializacao ini) =>
        {
            if (await usuarios.AtualAsync(ctx) is null) return NaoAutenticado();
            string pasta = ini.PastaDados;
            bool local = ctx.Connection.RemoteIpAddress is { } ip && IPAddress.IsLoopback(ip);
            if (!OperatingSystem.IsWindows() || Inicializacao.NoAzureAppService || !local)
                return Erro(400, "Disponível somente no próprio computador servidor (Windows). Pasta de dados: " + pasta);
            Directory.CreateDirectory(pasta);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{pasta}\"") { UseShellExecute = true });
            return Json(new { ok = true, path = pasta });
        });

        app.MapGet("/api/info", async (HttpContext ctx, ServicoUsuarios usuarios, ProvedorPersistencia p, IArmazenamentoArquivos armazenamento,
            Inicializacao ini, ServicoRelacional relacional, IOptions<MesOptions> o) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            var resumo = await p.Estado.ResumoAsync(ctx.RequestAborted);
            return Json(new
            {
                app = "MES LION",
                versao = Inicializacao.Versao,
                plataforma = Inicializacao.Plataforma,
                ambiente = Inicializacao.NoAzureAppService ? "Azure App Service" : "Servidor local",
                servidor = Environment.MachineName,
                banco = new { provedor = p.Nome, descricao = ini.DescricaoBancoCurta },
                arquivos = armazenamento.Descricao,
                estado = new { versao = resumo.Versao, colecoes = resumo.Colecoes, bytes = resumo.Bytes, atualizadoEm = resumo.AtualizadoEm is { } d ? Data(d) : null, atualizadoPor = resumo.AtualizadoPor },
                camadaRelacional = relacional.Status(),
                entraId = o.Value.Autenticacao.EntraId.Habilitado,
                usuario = u.Username,
                iniciadoEm = Data(Inicializacao.IniciadoEm),
            });
        });

        app.MapGet("/api/backups", async (HttpContext ctx, ServicoUsuarios usuarios, ProvedorPersistencia p) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            if (u.Role != Perfis.Admin) return SomenteAdmin();
            var l = await p.Backups.ListarAsync(200, ctx.RequestAborted);
            return Json(l.Select(b => new { id = b.Id, motivo = b.Reason, criadoEm = Data(b.CreatedAt), criadoPor = b.CreatedByName, bytes = b.SizeBytes, versaoEstado = b.StateVersion, arquivo = b.StoredKey }).ToList());
        });

        app.MapGet("/api/backups/{id:long}", async (HttpContext ctx, long id, ServicoUsuarios usuarios, ProvedorPersistencia p, IArmazenamentoArquivos armazenamento) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            if (u.Role != Perfis.Admin) return SomenteAdmin();
            var b = await p.Backups.ObterAsync(id, ctx.RequestAborted);
            var f = b is null ? null : await armazenamento.AbrirAsync(b.StoredKey, ctx.RequestAborted);
            if (b is null || f is null) return Texto("Não encontrado", 404);
            return Results.Stream(f.Conteudo, "application/gzip", Path.GetFileName(b.StoredKey));
        });

        // Publicação do dashboard HTML do passaporte (contrato MES V40.4.4: {id, html} -> {url})
        app.MapPost("/api/passport-publish", async (HttpContext ctx, ServicoUsuarios usuarios, ServicoArquivos arquivos, ServicoAuditoria auditoria,
            IOptions<MesOptions> o) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            var b = LerJson(await LerCorpoTextoAsync(ctx.Request, ctx.RequestAborted));
            var id = ServicoArquivos.IdPassaporteSeguro(b.Str("id"));
            var html = b.Str("html");
            if (string.IsNullOrEmpty(id)) return Erro(400, "Passaporte sem ID.");
            if (string.IsNullOrEmpty(html)) return Erro(400, "HTML do dashboard ausente.");
            await arquivos.PublicarPassaporteAsync(id, html, u, ctx.RequestAborted);
            var url = $"{UrlBasePublica(ctx, o.Value)}/passaporte/{Uri.EscapeDataString(id)}.html";
            await auditoria.RegistrarAsync(u, "passaporte", "PUBLISH_HTML", id);
            return Json(new { ok = true, id, url });
        });

        // Página pública do passaporte (lida pelo QR code — sem login).
        app.MapGet("/passaporte/{arquivo}", async (HttpContext ctx, string arquivo, ServicoArquivos arquivos) =>
        {
            var id = ServicoArquivos.IdPassaporteSeguro(arquivo.EndsWith(".html", StringComparison.OrdinalIgnoreCase) ? arquivo[..^5] : arquivo);
            var f = string.IsNullOrEmpty(id) ? null : await arquivos.AbrirPassaporteAsync(id, ctx.RequestAborted);
            if (f is null) return Texto("Passaporte não publicado.", 404);
            ctx.Response.Headers.CacheControl = "no-cache";
            return Results.Stream(f.Conteudo, "text/html; charset=utf-8");
        });

        app.MapGet("/healthz", async (ProvedorPersistencia p, CancellationToken ct) =>
        {
            try
            {
                var v = await p.Estado.ObterVersaoAsync(ct);
                return Json(new { status = "ok", banco = p.Nome, versaoEstado = v });
            }
            catch (Exception ex)
            {
                return Json(new { status = "erro", banco = p.Nome, erro = ex.Message }, 503);
            }
        });
    }

    /// <summary>URL pública para o QR: configurada, ou a do pedido (trocando localhost pelo IP da rede local).</summary>
    public static string UrlBasePublica(HttpContext ctx, MesOptions o)
    {
        if (!string.IsNullOrWhiteSpace(o.Publicacao.UrlBasePublica)) return o.Publicacao.UrlBasePublica.TrimEnd('/');
        var host = ctx.Request.Host;
        string nome = host.Host;
        if (nome is "localhost" or "127.0.0.1" or "::1" or "[::1]")
        {
            var ip = IpRedeLocal();
            if (ip is not null) nome = ip;
        }
        return $"{ctx.Request.Scheme}://{nome}{(host.Port is { } porta ? ":" + porta : "")}";
    }

    public static string? IpRedeLocal()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses)
                .Select(a => a.Address)
                .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a))?.ToString();
        }
        catch { return null; }
    }
}
