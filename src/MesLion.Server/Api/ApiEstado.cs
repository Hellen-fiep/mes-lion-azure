using System.Text;
using System.Text.Json;
using MesLion.Server.Estado;
using MesLion.Server.Infra;
using MesLion.Server.Persistencia;
using MesLion.Server.Seguranca;
using static MesLion.Server.Api.Respostas;

namespace MesLion.Server.Api;

/// <summary>
/// /api/bootstrap e /api/storage — persistência do estado do MES e do localStorage do frontend.
/// Contrato idêntico ao MES_LION_SERVER.ps1: {data, appStorage, user}; PUT /api/storage/MES_LION_DATA.
/// </summary>
public static class ApiEstado
{
    public const string ChaveEstado = "MES_LION_DATA";

    public static void Mapear(WebApplication app)
    {
        app.Map("/api/bootstrap", async (HttpContext ctx, ServicoUsuarios usuarios, ServicoEstado estado, ProvedorPersistencia p) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) { await NaoAutenticado().ExecuteAsync(ctx); return; }
            var montado = await estado.ObterAsync(ctx.RequestAborted);
            var kv = await p.Kv.ListarAsync(ctx.RequestAborted);

            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = TipoJson;
            ctx.Response.Headers.CacheControl = "no-store";
            var corpo = ctx.Response.Body;
            var ct = ctx.RequestAborted;
            // Estado vazio => data:null (o frontend inicializa com os dados iniciais de js/data.js e grava).
            await corpo.WriteAsync(Encoding.UTF8.GetBytes("{\"data\":"), ct);
            await corpo.WriteAsync(montado.Vazio ? Encoding.UTF8.GetBytes("null") : montado.Json, ct);
            await corpo.WriteAsync(Encoding.UTF8.GetBytes(",\"appStorage\":"), ct);
            await corpo.WriteAsync(JsonSerializer.SerializeToUtf8Bytes(kv, OpcoesJson), ct);
            await corpo.WriteAsync(Encoding.UTF8.GetBytes(",\"user\":"), ct);
            await corpo.WriteAsync(JsonSerializer.SerializeToUtf8Bytes(ServicoUsuarios.Json(u, ctx), OpcoesJson), ct);
            await corpo.WriteAsync(Encoding.UTF8.GetBytes("}"), ct);
        });

        app.MapGet("/api/storage", async (HttpContext ctx, ServicoUsuarios usuarios, ServicoEstado estado, ProvedorPersistencia p) =>
        {
            if (await usuarios.AtualAsync(ctx) is null) return NaoAutenticado();
            var o = new Dictionary<string, string>(await p.Kv.ListarAsync(ctx.RequestAborted), StringComparer.Ordinal);
            var montado = await estado.ObterAsync(ctx.RequestAborted);
            o[ChaveEstado] = montado.Vazio ? "{}" : Encoding.UTF8.GetString(montado.Json);
            return Json(o);
        });

        app.MapPut("/api/storage/{**chave}", async (HttpContext ctx, string chave, ServicoUsuarios usuarios, ServicoEstado estado,
            ProvedorPersistencia p, ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            chave = TrechoCaminho(ctx, "/api/storage/") ?? chave;
            if (chave == ChaveEstado)
            {
                var corpo = await LerCorpoBytesAsync(ctx.Request, ctx.RequestAborted);
                ResultadoGravacaoEstado r;
                try { r = await estado.GravarAsync(corpo, u, ctx.RequestAborted); }
                catch (EstadoInvalidoException ex) { return Erro(400, ex.Message); }
                await auditoria.RegistrarAsync(u, "app", "SAVE_STATE", ChaveEstado, ServicoEstado.DescreverAlteracoes(r));
                return Ok();
            }
            var texto = await LerCorpoTextoAsync(ctx.Request, ctx.RequestAborted);
            await p.Kv.DefinirAsync(chave, texto, ctx.RequestAborted);
            return Ok();
        });

        // O servidor PowerShell não implementava DELETE (404). Aqui: remove apenas chaves do localStorage;
        // o estado do MES (MES_LION_DATA) nunca é apagado por esta rota.
        app.MapDelete("/api/storage/{**chave}", async (HttpContext ctx, string chave, ServicoUsuarios usuarios, ProvedorPersistencia p) =>
        {
            if (await usuarios.AtualAsync(ctx) is null) return NaoAutenticado();
            chave = TrechoCaminho(ctx, "/api/storage/") ?? chave;
            if (chave != ChaveEstado) await p.Kv.RemoverAsync(chave, ctx.RequestAborted);
            return Ok();
        });

        app.MapDelete("/api/storage", async (HttpContext ctx, ServicoUsuarios usuarios, ProvedorPersistencia p, ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            await p.Kv.LimparAsync(ctx.RequestAborted);
            await auditoria.RegistrarAsync(u, "app", "CLEAR_STORAGE", "app_storage");
            return Ok();
        });
    }
}
