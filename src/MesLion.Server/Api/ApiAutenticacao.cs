using MesLion.Server.Configuracao;
using MesLion.Server.Infra;
using MesLion.Server.Seguranca;
using Microsoft.Extensions.Options;
using static MesLion.Server.Api.Respostas;

namespace MesLion.Server.Api;

/// <summary>/api/auth/* — login, logout, sessão atual e configuração da tela de login.</summary>
public static class ApiAutenticacao
{
    public static void Mapear(WebApplication app)
    {
        app.MapPost("/api/auth/login", async (HttpContext ctx, ServicoUsuarios usuarios, ServicoAuditoria auditoria) =>
        {
            var corpo = LerJson(await LerCorpoTextoAsync(ctx.Request, ctx.RequestAborted));
            var u = await usuarios.AutenticarAsync(corpo.Str("username"), corpo.Str("password"), ctx.RequestAborted);
            if (u is null) return Erro(401, "Usuário ou senha inválidos");
            await usuarios.EntrarAsync(ctx, u, "LOCAL");
            await auditoria.RegistrarAsync(u, "auth", "LOGIN", u.Username);
            return Json(new { user = ServicoUsuarios.Json(u, ctx) });
        });

        app.MapPost("/api/auth/logout", async (HttpContext ctx, ServicoUsuarios usuarios) =>
        {
            await usuarios.SairAsync(ctx);
            return Json(new { ok = true });
        });

        app.Map("/api/auth/me", async (HttpContext ctx, ServicoUsuarios usuarios) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            return u is null ? NaoAutenticado() : Json(new { user = ServicoUsuarios.Json(u, ctx) });
        });

        // Usado pelo adaptador de plataforma (js/mes_plataforma_azure.js) na tela de login.
        app.MapGet("/api/auth/config", (IOptions<MesOptions> o, Inicializacao ini) =>
        {
            var e = o.Value.Autenticacao.EntraId;
            bool entra = e.Habilitado && Inicializacao.EasyAuthConfiavel(o.Value);
            return Json(new
            {
                entraId = new
                {
                    habilitado = entra,
                    loginUrl = $"/.auth/login/{e.Provedor}?post_login_redirect_uri=%2F",
                    logoutUrl = "/.auth/logout?post_logout_redirect_uri=%2F",
                },
                plataforma = Inicializacao.Plataforma,
                versao = Inicializacao.Versao,
                banco = ini.NomeProvedor,
                bancoDescricao = ini.DescricaoBancoCurta,
                compressaoUpload = o.Value.Servidor.AceitarUploadCompactado,
            });
        });
    }
}
