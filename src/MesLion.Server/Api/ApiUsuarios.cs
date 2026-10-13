using MesLion.Server.Infra;
using MesLion.Server.Persistencia;
using MesLion.Server.Seguranca;
using static MesLion.Server.Api.Respostas;

namespace MesLion.Server.Api;

/// <summary>/api/users (somente ADMIN) e /api/audit — mesmo contrato do servidor original.</summary>
public static class ApiUsuarios
{
    private static object Linha(Usuario x) => new
    {
        id = x.Id.ToString(),
        username = x.Username,
        full_name = x.FullName,
        role = x.Role,
        active = x.Active,
        created_at = Data(x.CreatedAt),
        updated_at = Data(x.UpdatedAt),
    };

    public static void Mapear(WebApplication app)
    {
        app.MapGet("/api/users", async (HttpContext ctx, ServicoUsuarios usuarios, ProvedorPersistencia p) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            if (u.Role != Perfis.Admin) return SomenteAdmin();
            var lista = await p.Usuarios.ListarAsync(ctx.RequestAborted);
            return Json(lista.Select(Linha).ToList());
        });

        app.MapPost("/api/users", async (HttpContext ctx, ServicoUsuarios usuarios, ProvedorPersistencia p, ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            if (u.Role != Perfis.Admin) return SomenteAdmin();
            var b = LerJson(await LerCorpoTextoAsync(ctx.Request, ctx.RequestAborted));
            string username = b.Str("username") ?? "", nome = b.Str("fullName") ?? "", senha = b.Str("password") ?? "";
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(nome) || string.IsNullOrWhiteSpace(senha))
                return Erro(400, "Usuário, nome e senha são obrigatórios");
            if (username.Length > 80 || nome.Length > 180) return Erro(400, "Usuário (máx. 80) ou nome (máx. 180) muito longo");
            var agora = DateTimeOffset.Now;
            var novo = new Usuario
            {
                Id = Guid.NewGuid(), Username = username, FullName = nome, PasswordHash = SenhaHasher.Gerar(senha),
                Role = NormalizarPerfil(b.Str("role")), Active = b.Verdadeiro("active"), AuthProvider = "LOCAL", CreatedAt = agora, UpdatedAt = agora,
            };
            if (!await p.Usuarios.InserirAsync(novo, ctx.RequestAborted))
                return Erro(409, "Já existe um usuário com este login.");
            await auditoria.RegistrarAsync(u, "usuarios", "CREATE", username);
            return Json(new { id = novo.Id.ToString() });
        });

        app.MapPut("/api/users/{id}", async (HttpContext ctx, string id, ServicoUsuarios usuarios, ProvedorPersistencia p, ServicoAuditoria auditoria) =>
        {
            var u = await usuarios.AtualAsync(ctx);
            if (u is null) return NaoAutenticado();
            if (u.Role != Perfis.Admin) return SomenteAdmin();
            if (!Guid.TryParse(id, out var gid)) return Texto("API não encontrada", 404);
            var b = LerJson(await LerCorpoTextoAsync(ctx.Request, ctx.RequestAborted));
            var alvo = await p.Usuarios.PorIdAsync(gid, ctx.RequestAborted);
            if (alvo is not null)
            {
                string nome = b.Str("fullName") ?? "";
                if (nome.Length > 180) return Erro(400, "Nome muito longo (máx. 180)");
                alvo.FullName = nome;
                alvo.Role = NormalizarPerfil(b.Str("role"));
                alvo.Active = b.Verdadeiro("active");
                var senha = b.Str("password");
                if (!string.IsNullOrWhiteSpace(senha)) alvo.PasswordHash = SenhaHasher.Gerar(senha);
                alvo.UpdatedAt = DateTimeOffset.Now;
                await p.Usuarios.AtualizarAsync(alvo, ctx.RequestAborted);
                usuarios.Invalidar(alvo.Id);
            }
            await auditoria.RegistrarAsync(u, "usuarios", "UPDATE", id);
            return Json(new { ok = true });
        });

        app.Map("/api/audit", async (HttpContext ctx, ServicoUsuarios usuarios, ProvedorPersistencia p) =>
        {
            if (await usuarios.AtualAsync(ctx) is null) return NaoAutenticado();
            var lista = await p.Auditoria.ListarAsync(500, ctx.RequestAborted);
            return Json(lista.Select(a => new
            {
                username = a.Username,
                module = a.Module,
                action = a.Action,
                record_key = a.RecordKey,
                changed_at = Data(a.ChangedAt),
                details = LerJson(a.DetailsJson),
            }).ToList());
        });
    }

    private static string NormalizarPerfil(string? perfil)
    {
        var r = (perfil ?? "").Trim();
        if (r.Equals(Perfis.Admin, StringComparison.OrdinalIgnoreCase)) return Perfis.Admin;
        if (r.Length == 0 || r.Equals(Perfis.Usuario, StringComparison.OrdinalIgnoreCase)) return Perfis.Usuario;
        return r.Length > 30 ? r[..30] : r;
    }
}
