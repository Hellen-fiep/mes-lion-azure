using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using MesLion.Server.Configuracao;
using MesLion.Server.Persistencia;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;

namespace MesLion.Server.Seguranca;

public static class Perfis
{
    public const string Admin = "ADMIN";
    public const string Usuario = "USER";
}

/// <summary>Usuários, login e sessões (cookie MESSESSION, como no servidor original).</summary>
public sealed class ServicoUsuarios(ProvedorPersistencia provedor, IOptions<MesOptions> opcoes, ILogger<ServicoUsuarios> log)
{
    public const string EsquemaCookie = CookieAuthenticationDefaults.AuthenticationScheme;
    public const string ClaimProvedor = "mes:provedor";
    public const string ClaimIdExterno = "mes:idexterno";
    private const string ChaveItemUsuario = "mes:usuario";

    private readonly ConcurrentDictionary<Guid, (Usuario Usuario, DateTime Expira)> _cache = new();
    private MesOptions O => opcoes.Value;

    public async Task GarantirAdministradorAsync(CancellationToken ct)
    {
        if (await provedor.Usuarios.ContarAsync(ct) > 0) return;
        var agora = DateTimeOffset.Now;
        var admin = new Usuario
        {
            Id = Guid.NewGuid(), Username = O.Seed.UsuarioAdmin, FullName = O.Seed.NomeAdmin,
            PasswordHash = SenhaHasher.Gerar(O.Seed.SenhaAdmin), Role = Perfis.Admin, Active = true,
            AuthProvider = "LOCAL", CreatedAt = agora, UpdatedAt = agora,
        };
        await provedor.Usuarios.InserirAsync(admin, ct);
        log.LogInformation("Usuário inicial criado: {Usuario}.", admin.Username);
    }

    public async Task<Usuario?> AutenticarAsync(string? username, string? senha, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(username) || senha is null) return null;
        var u = await provedor.Usuarios.PorUsernameAsync(username, ct);
        if (u is null || !u.Active) return null;
        var r = SenhaHasher.Verificar(senha, u.PasswordHash);
        if (r == SenhaHasher.ResultadoVerificacao.Falhou) return null;
        if (r == SenhaHasher.ResultadoVerificacao.SucessoRequerAtualizacao && O.Autenticacao.AtualizarHashLegado)
        {
            try
            {
                u.PasswordHash = SenhaHasher.Gerar(senha);
                u.UpdatedAt = DateTimeOffset.Now;
                await provedor.Usuarios.AtualizarAsync(u, ct);
                log.LogInformation("Hash de senha legado (bcrypt) do usuário {Usuario} atualizado para PBKDF2.", u.Username);
            }
            catch (Exception ex) { log.LogWarning(ex, "Não foi possível atualizar o hash legado do usuário {Usuario}.", u.Username); }
        }
        _cache.TryRemove(u.Id, out _);
        return u;
    }

    public async Task EntrarAsync(HttpContext ctx, Usuario u, string provedorLogin)
    {
        var identidade = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, u.Id.ToString()),
            new Claim(ClaimTypes.Name, u.Username),
            new Claim(ClaimTypes.Role, u.Role),
            new Claim(ClaimProvedor, provedorLogin),
            new Claim(ClaimIdExterno, u.ExternalId ?? ""),
        ], EsquemaCookie);
        var principal = new ClaimsPrincipal(identidade);
        await ctx.SignInAsync(EsquemaCookie, principal, new AuthenticationProperties { IsPersistent = false, AllowRefresh = true });
        ctx.User = principal;
        ctx.Items[ChaveItemUsuario] = u;
    }

    public Task SairAsync(HttpContext ctx) => ctx.SignOutAsync(EsquemaCookie);

    /// <summary>Usuário autenticado e ativo da requisição (ou null).</summary>
    public async Task<Usuario?> AtualAsync(HttpContext ctx)
    {
        if (ctx.Items.TryGetValue(ChaveItemUsuario, out var item) && item is Usuario cached) return cached;
        if (ctx.User?.Identity?.IsAuthenticated != true) return null;
        if (!Guid.TryParse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) return null;

        Usuario? u;
        if (_cache.TryGetValue(id, out var c) && c.Expira > DateTime.UtcNow) u = c.Usuario;
        else
        {
            u = await provedor.Usuarios.PorIdAsync(id, ctx.RequestAborted);
            if (u is not null) _cache[id] = (u, DateTime.UtcNow.AddSeconds(20));
        }
        if (u is null || !u.Active) return null;
        ctx.Items[ChaveItemUsuario] = u;
        return u;
    }

    public void Invalidar(Guid id) => _cache.TryRemove(id, out _);

    public static string Provedor(HttpContext ctx) => ctx.User?.FindFirstValue(ClaimProvedor) ?? "LOCAL";

    public static object Json(Usuario u, HttpContext? ctx = null) => new
    {
        id = u.Id.ToString(),
        username = u.Username,
        fullName = u.FullName,
        role = u.Role,
        provedor = ctx is null ? u.AuthProvider : Provedor(ctx),
    };

    // ------------------------------------------------------------------ Microsoft Entra ID (App Service Authentication)
    public async Task<Usuario?> ResolverEntraAsync(PrincipalEasyAuth p, CancellationToken ct)
    {
        var e = O.Autenticacao.EntraId;
        bool admin = !string.IsNullOrWhiteSpace(e.PapelAdmin) && p.Papeis.Contains(e.PapelAdmin, StringComparer.OrdinalIgnoreCase);
        var u = await provedor.Usuarios.PorIdExternoAsync(p.Id, ct);
        if (u is null && !string.IsNullOrWhiteSpace(p.Nome))
        {
            u = await provedor.Usuarios.PorUsernameAsync(p.Nome, ct);
            if (u is null)
                u = (await provedor.Usuarios.ListarAsync(ct)).FirstOrDefault(x => string.Equals(x.Username, p.Nome, StringComparison.OrdinalIgnoreCase));
        }

        var agora = DateTimeOffset.Now;
        if (u is null)
        {
            if (!e.ProvisionarAutomaticamente) return null;
            u = new Usuario
            {
                Id = Guid.NewGuid(), Username = Cortar(p.Nome, 80), FullName = Cortar(p.NomeCompleto ?? p.Nome, 180),
                PasswordHash = SenhaHasher.SemSenhaLocal, Role = admin ? Perfis.Admin : (e.PerfilPadrao == Perfis.Admin ? Perfis.Admin : Perfis.Usuario),
                Active = true, AuthProvider = "ENTRA", ExternalId = p.Id, CreatedAt = agora, UpdatedAt = agora,
            };
            if (!await provedor.Usuarios.InserirAsync(u, ct)) return await provedor.Usuarios.PorUsernameAsync(u.Username, ct);
            log.LogInformation("Usuário Microsoft Entra ID provisionado: {Usuario} ({Perfil}).", u.Username, u.Role);
            return u;
        }

        bool alterado = false;
        if (!string.Equals(u.ExternalId, p.Id, StringComparison.OrdinalIgnoreCase)) { u.ExternalId = p.Id; alterado = true; }
        if (e.SincronizarPerfil && admin && u.Role != Perfis.Admin) { u.Role = Perfis.Admin; alterado = true; }
        if (alterado) { u.UpdatedAt = agora; await provedor.Usuarios.AtualizarAsync(u, ct); _cache.TryRemove(u.Id, out _); }
        return u;
    }

    private static string Cortar(string s, int n) => s.Length <= n ? s : s[..n];
}

/// <summary>Usuário autenticado pelo Azure App Service Authentication (Easy Auth / Microsoft Entra ID).</summary>
public sealed record PrincipalEasyAuth(string Id, string Nome, string? NomeCompleto, IReadOnlyList<string> Papeis, string ProvedorIdentidade)
{
    public static PrincipalEasyAuth? Ler(HttpRequest req)
    {
        string? id = req.Headers["X-MS-CLIENT-PRINCIPAL-ID"];
        string? nome = req.Headers["X-MS-CLIENT-PRINCIPAL-NAME"];
        string idp = req.Headers["X-MS-CLIENT-PRINCIPAL-IDP"].ToString();
        string? principal = req.Headers["X-MS-CLIENT-PRINCIPAL"];
        string? nomeCompleto = null;
        var papeis = new List<string>();

        if (!string.IsNullOrEmpty(principal))
        {
            try
            {
                using var doc = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(principal)));
                var raiz = doc.RootElement;
                string tipoPapel = raiz.TryGetProperty("role_typ", out var rt) ? rt.GetString() ?? "roles" : "roles";
                if (raiz.TryGetProperty("auth_typ", out var at) && string.IsNullOrEmpty(idp)) idp = at.GetString() ?? "";
                if (raiz.TryGetProperty("claims", out var claims) && claims.ValueKind == JsonValueKind.Array)
                {
                    foreach (var c in claims.EnumerateArray())
                    {
                        string typ = c.TryGetProperty("typ", out var t) ? t.GetString() ?? "" : "";
                        string val = c.TryGetProperty("val", out var v) ? v.GetString() ?? "" : "";
                        if (typ == tipoPapel || typ is "roles" or ClaimTypes.Role) papeis.Add(val);
                        else if (typ == "name") nomeCompleto = val;
                        else if (string.IsNullOrEmpty(id) && typ is "http://schemas.microsoft.com/identity/claims/objectidentifier" or "oid") id = val;
                        else if (string.IsNullOrEmpty(nome) && typ is "preferred_username" or ClaimTypes.Email or ClaimTypes.Upn) nome = val;
                    }
                }
            }
            catch (FormatException) { }
            catch (JsonException) { }
        }
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(nome)) return null;
        return new PrincipalEasyAuth(id.Trim(), nome.Trim(), nomeCompleto, papeis, string.IsNullOrEmpty(idp) ? "aad" : idp);
    }
}
