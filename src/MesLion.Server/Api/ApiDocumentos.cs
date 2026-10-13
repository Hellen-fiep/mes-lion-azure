using MesLion.Server.Infra;
using MesLion.Server.Persistencia;
using MesLion.Server.Seguranca;
using Microsoft.Net.Http.Headers;
using static MesLion.Server.Api.Respostas;

namespace MesLion.Server.Api;

/// <summary>Documentos controlados dos equipamentos (PDF/XLS/XLSX) e anexos de cadastros.</summary>
public static class ApiDocumentos
{
    private static object Linha(DocumentoEquipamento d) => new
    {
        id = d.Id.ToString(),
        equipment_code = d.EquipmentCode,
        original_name = d.OriginalName,
        mime_type = d.MimeType,
        file_size = d.FileSize,
        document_type = d.DocumentType,
        revision = d.Revision,
        active = d.Active,
        uploaded_at = Data(d.UploadedAt),
    };

    public static void Mapear(WebApplication app)
    {
        // GET/POST /api/equipment/{codigo}/documents  (código decodificado uma vez, como no original)
        app.MapMethods("/api/equipment/{**resto}", ["GET", "POST"], async (HttpContext ctx, ServicoUsuarios usuarios, ProvedorPersistencia p,
            ServicoArquivos arquivos, ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            var codigo = TrechoCaminho(ctx, "/api/equipment/", "/documents");
            if (string.IsNullOrEmpty(codigo)) return Texto("API não encontrada", 404);

            if (HttpMethods.IsGet(ctx.Request.Method))
            {
                var docs = await p.Documentos.ListarPorEquipamentoAsync(codigo, ctx.RequestAborted);
                return Json(docs.Select(Linha).ToList());
            }

            if (codigo.Length > 100) return Erro(400, "Código de equipamento muito longo (máx. 100).");
            if (!ctx.Request.HasFormContentType) return Erro(400, "Arquivo obrigatório");
            var form = await ctx.Request.ReadFormAsync(ctx.RequestAborted);
            var arquivo = form.Files["file"];
            if (arquivo is null) return Erro(400, "Arquivo obrigatório");
            string nome = Path.GetFileName(arquivo.FileName.Replace('\\', '/'));
            if (!ServicoArquivos.ExtensoesDocumento.Contains(Path.GetExtension(nome).ToLowerInvariant()))
                return Erro(400, "Somente PDF/XLS/XLSX");
            await using var s = arquivo.OpenReadStream();
            var d = await arquivos.SalvarDocumentoAsync(codigo, nome, s, arquivo.Length, form["documentType"].ToString(), form["revision"].ToString(), u, ctx.RequestAborted);
            await auditoria.RegistrarAsync(u, "equipamentos", "UPLOAD_DOCUMENT", codigo);
            return Json(new { id = d.Id.ToString() });
        });

        app.Map("/api/documents/{id}", async (HttpContext ctx, string id, ServicoUsuarios usuarios, ServicoArquivos arquivos) =>
        {
            if (await usuarios.AtualAsync(ctx) is null) return NaoAutenticado();
            if (!Guid.TryParse(id, out var gid)) return Texto("API não encontrada", 404);
            var r = await arquivos.AbrirDocumentoAsync(gid, ctx.RequestAborted);
            if (r is null) return Texto("Não encontrado", 404);
            var (doc, arq) = r.Value;
            return Arquivo(ctx, arq.Conteudo, doc.MimeType ?? ServicoArquivos.TipoPorNome(doc.OriginalName), doc.OriginalName, arq.Tamanho);
        });

        // Anexos de cadastros (contrato do MES V40: {scope, recordId, name, mime, dataBase64} -> {url, path})
        app.MapPost("/api/attachments", async (HttpContext ctx, ServicoUsuarios usuarios, ServicoArquivos arquivos, ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            var b = LerJson(await LerCorpoTextoAsync(ctx.Request, ctx.RequestAborted));
            var base64 = b.Str("dataBase64");
            if (string.IsNullOrEmpty(base64)) return Erro(400, "Arquivo obrigatório (dataBase64).");
            byte[] dados;
            try { dados = Convert.FromBase64String(base64); }
            catch (FormatException) { return Erro(400, "Conteúdo do arquivo inválido (base64)."); }
            if (dados.Length > 50 * 1024 * 1024) return Erro(400, "Arquivo excede 50 MB.");
            var a = await arquivos.SalvarAnexoAsync(b.Str("scope") ?? "geral", b.Str("recordId") ?? "", b.Str("name") ?? "arquivo", b.Str("mime"), dados, u, ctx.RequestAborted);
            await auditoria.RegistrarAsync(u, "anexos", "UPLOAD_ATTACHMENT", $"{a.Scope}/{a.RecordId}/{a.OriginalName}");
            return Json(new
            {
                id = a.Id.ToString(),
                url = $"/api/attachments/{a.Id:N}/{Uri.EscapeDataString(a.OriginalName)}",
                path = $"{a.Scope}/{a.RecordId}/{a.OriginalName}",
                name = a.OriginalName,
                size = a.FileSize,
            });
        });

        app.MapGet("/api/attachments/{id}/{**nome}", async (HttpContext ctx, string id, ServicoUsuarios usuarios, ServicoArquivos arquivos) =>
        {
            if (await usuarios.AtualAsync(ctx) is null) return NaoAutenticado();
            if (!Guid.TryParse(id, out var gid)) return Texto("Não encontrado", 404);
            var r = await arquivos.AbrirAnexoAsync(gid, ctx.RequestAborted);
            if (r is null) return Texto("Não encontrado", 404);
            var (a, arq) = r.Value;
            return Arquivo(ctx, arq.Conteudo, a.MimeType ?? ServicoArquivos.TipoPorNome(a.OriginalName), a.OriginalName, arq.Tamanho);
        });
    }

    /// <summary>Envia o arquivo "inline" (abre no navegador), com nome UTF-8 correto (RFC 6266).</summary>
    public static IResult Arquivo(HttpContext ctx, Stream conteudo, string tipo, string nome, long? tamanho)
    {
        var cd = new ContentDispositionHeaderValue("inline");
        cd.SetHttpFileName(nome);
        ctx.Response.Headers[HeaderNames.ContentDisposition] = cd.ToString();
        ctx.Response.Headers.CacheControl = "no-store";
        if (tamanho is not null) ctx.Response.ContentLength = tamanho;
        return Results.Stream(conteudo, tipo, enableRangeProcessing: false);
    }
}
