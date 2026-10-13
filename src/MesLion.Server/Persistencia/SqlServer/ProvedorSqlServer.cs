using System.Data;
using System.Data.Common;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using MesLion.Server.Estado;
using Microsoft.AspNetCore.DataProtection.Repositories;
using static MesLion.Server.Persistencia.SqlServer.ConexaoSql;

namespace MesLion.Server.Persistencia.SqlServer;

/// <summary>Persistência oficial: SQL Server, Azure SQL Database ou LocalDB.</summary>
public static class ProvedorSqlServer
{
    public static ProvedorPersistencia Criar(ConexaoSql sql, bool criarBanco, bool aplicarScripts, ILoggerFactory lf)
    {
        var b = sql.Construtor();
        string servidor = b.TryGetValue("Data Source", out var ds) ? ds?.ToString() ?? "" : b.TryGetValue("Server", out var sv) ? sv?.ToString() ?? "" : "";
        string banco = b.TryGetValue("Initial Catalog", out var ic) ? ic?.ToString() ?? "" : b.TryGetValue("Database", out var db) ? db?.ToString() ?? "" : "";
        return new ProvedorPersistencia(
            "SqlServer",
            $"SQL Server ({servidor} / {banco})",
            new InicializadorSql(sql, criarBanco, aplicarScripts, lf.CreateLogger("MesLion.Banco")),
            new EstadoSql(sql),
            new KvSql(sql),
            new UsuariosSql(sql),
            new AuditoriaSql(sql),
            new DocumentosSql(sql),
            new AnexosSql(sql),
            new PassaportesSql(sql),
            new BackupsSql(sql),
            new ChavesProtecaoSql(sql));
    }
}

// ===================================================================== inicialização / scripts
internal sealed class InicializadorSql(ConexaoSql sql, bool criarBanco, bool aplicarScripts, ILogger log) : IInicializadorBanco
{
    public string Descricao => "SQL Server";

    public async Task InicializarAsync(CancellationToken ct)
    {
        if (criarBanco) await GarantirBancoAsync(ct);
        if (aplicarScripts) await AplicarScriptsAsync(sql, log, ct);
    }

    private async Task GarantirBancoAsync(CancellationToken ct)
    {
        var b = sql.Construtor();
        string servidor = (b.TryGetValue("Data Source", out var ds) ? ds?.ToString() : null) ?? "";
        if (servidor.Contains("database.windows.net", StringComparison.OrdinalIgnoreCase)) return; // Azure SQL: banco criado pelo Bicep/TI
        string banco = (b.TryGetValue("Initial Catalog", out var ic) ? ic?.ToString() : null) ?? "";
        if (string.IsNullOrWhiteSpace(banco) || banco.Equals("master", StringComparison.OrdinalIgnoreCase)) return;

        b["Initial Catalog"] = "master";
        try
        {
            await using var c = await sql.AbrirAsync(ct, b.ConnectionString);
            await using var cmd = sql.Comando(c, "IF DB_ID(@n) IS NULL BEGIN DECLARE @s NVARCHAR(400) = N'CREATE DATABASE ' + QUOTENAME(@n); EXEC(@s); SELECT 1; END ELSE SELECT 0;");
            PTexto(cmd, "@n", banco, 128);
            var criado = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
            if (criado == 1) log.LogInformation("Banco de dados {Banco} criado em {Servidor}.", banco, servidor);
        }
        catch (Exception ex)
        {
            // Sem permissão em master: segue e tenta usar o banco diretamente.
            log.LogWarning("Não foi possível verificar/criar o banco {Banco} via master: {Erro}", banco, ex.Message);
        }
    }

    public static IReadOnlyList<(string Nome, string Conteudo)> ScriptsEmbutidos()
    {
        var asm = Assembly.GetExecutingAssembly();
        return asm.GetManifestResourceNames()
            .Where(n => n.EndsWith(".sql", StringComparison.OrdinalIgnoreCase) && n.Contains(".Sql.", StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal)
            .Select(n =>
            {
                using var s = asm.GetManifestResourceStream(n)!;
                using var r = new StreamReader(s, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
                string nome = n[(n.IndexOf(".Sql.", StringComparison.Ordinal) + 5)..];
                return (nome, r.ReadToEnd());
            })
            .ToList();
    }

    public static IEnumerable<string> DividirLotes(string script)
    {
        var sb = new StringBuilder();
        foreach (var linha in script.Replace("\r\n", "\n").Split('\n'))
        {
            if (Regex.IsMatch(linha, @"^\s*GO\s*(--.*)?$", RegexOptions.IgnoreCase))
            {
                if (sb.ToString().Trim().Length > 0) yield return sb.ToString();
                sb.Clear();
            }
            else sb.Append(linha).Append('\n');
        }
        if (sb.ToString().Trim().Length > 0) yield return sb.ToString();
    }

    public static async Task AplicarScriptsAsync(ConexaoSql sql, ILogger log, CancellationToken ct)
    {
        var scripts = ScriptsEmbutidos();
        await using var c = await sql.AbrirAsync(ct);
        var aplicados = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        await using (var cmd = sql.Comando(c, "IF OBJECT_ID(N'dbo.schema_version', N'U') IS NOT NULL SELECT script, checksum FROM dbo.schema_version;"))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct)) aplicados[r.GetString(0)] = r.GetString(1).Trim();

        foreach (var (nome, conteudo) in scripts)
        {
            string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(conteudo))).ToLowerInvariant();
            if (aplicados.TryGetValue(nome, out var h) && h == hash) continue;
            log.LogInformation("Aplicando script SQL {Script}...", nome);
            foreach (var lote in DividirLotes(conteudo))
            {
                await using var cmd = sql.Comando(c, lote);
                await cmd.ExecuteNonQueryAsync(ct);
            }
            await using var reg = sql.Comando(c, @"
MERGE dbo.schema_version AS t USING (SELECT @s AS script, @h AS checksum) AS s ON t.script = s.script
WHEN MATCHED THEN UPDATE SET checksum = s.checksum, applied_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN INSERT (script, checksum) VALUES (s.script, s.checksum);");
            PTexto(reg, "@s", nome, 200);
            P(reg, "@h", hash, DbType.AnsiStringFixedLength, 64);
            await reg.ExecuteNonQueryAsync(ct);
        }
    }
}

// ===================================================================== estado
internal sealed class EstadoSql(ConexaoSql sql) : IRepositorioEstado
{
    public Task<long> ObterVersaoAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, "SELECT version FROM dbo.app_state WHERE id = 1;");
        var v = await cmd.ExecuteScalarAsync(ct);
        return v is null or DBNull ? 0L : Convert.ToInt64(v);
    }, ct);

    public Task<(long Versao, IReadOnlyList<ColecaoArmazenada> Colecoes)> CarregarAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await using (var trava = sql.Comando(c, "EXEC sp_getapplock @Resource = N'mes_estado', @LockMode = N'Shared', @LockOwner = N'Transaction', @LockTimeout = 120000;", tx))
            await trava.ExecuteNonQueryAsync(ct);
        long versao;
        await using (var cmd = sql.Comando(c, "SELECT version FROM dbo.app_state WHERE id = 1;", tx))
            versao = Convert.ToInt64(await cmd.ExecuteScalarAsync(ct) ?? 0L);
        var lista = new List<ColecaoArmazenada>();
        await using (var cmd = sql.Comando(c, "SELECT name, ordinal, content, content_hash FROM dbo.app_state_collection ORDER BY ordinal, name;", tx))
        await using (var r = await cmd.ExecuteReaderAsync(CommandBehavior.SequentialAccess, ct))
        {
            while (await r.ReadAsync(ct))
            {
                string nome = r.GetString(0);
                int ordem = r.GetInt32(1);
                string conteudo = r.GetString(2);
                byte[] hash = (byte[])r.GetValue(3);
                lista.Add(new ColecaoArmazenada(nome, ordem, Encoding.UTF8.GetBytes(conteudo), hash));
            }
        }
        await tx.CommitAsync(ct);
        return (versao, (IReadOnlyList<ColecaoArmazenada>)lista);
    }, ct);

    public Task<ResultadoGravacaoEstado> GravarAsync(IReadOnlyList<ColecaoRecebida> colecoes, Usuario? usuario, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await using (var trava = sql.Comando(c, "EXEC sp_getapplock @Resource = N'mes_estado', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 120000;", tx))
            await trava.ExecuteNonQueryAsync(ct);

        var atuais = new Dictionary<string, (byte[] Hash, int Ordem)>(StringComparer.Ordinal);
        await using (var cmd = sql.Comando(c, "SELECT name, content_hash, ordinal FROM dbo.app_state_collection;", tx))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct)) atuais[r.GetString(0)] = ((byte[])r.GetValue(1), r.GetInt32(2));

        var alteradas = new List<string>();
        long bytes = 0;
        Guid? uid = usuario?.Id;
        foreach (var col in colecoes)
        {
            if (atuais.TryGetValue(col.Nome, out var atual))
            {
                if (atual.Hash.AsSpan().SequenceEqual(col.Hash))
                {
                    if (atual.Ordem != col.Ordem)
                    {
                        await using var ord = sql.Comando(c, "UPDATE dbo.app_state_collection SET ordinal = @o WHERE name = @n;", tx);
                        P(ord, "@o", col.Ordem, DbType.Int32); PTexto(ord, "@n", col.Nome, 200);
                        await ord.ExecuteNonQueryAsync(ct);
                    }
                    continue;
                }
                await using var up = sql.Comando(c, @"UPDATE dbo.app_state_collection
   SET ordinal = @o, content = @c, content_hash = @h, item_count = @i, size_bytes = @s,
       updated_at = SYSDATETIMEOFFSET(), updated_by = @u
 WHERE name = @n;", tx);
                PreencherColecao(up, col, uid);
                await up.ExecuteNonQueryAsync(ct);
            }
            else
            {
                await using var ins = sql.Comando(c, @"INSERT INTO dbo.app_state_collection (name, ordinal, content, content_hash, item_count, size_bytes, updated_at, updated_by)
VALUES (@n, @o, @c, @h, @i, @s, SYSDATETIMEOFFSET(), @u);", tx);
                PreencherColecao(ins, col, uid);
                await ins.ExecuteNonQueryAsync(ct);
            }
            alteradas.Add(col.Nome);
            bytes += col.ConteudoUtf8.Length;
        }

        var nomes = colecoes.Select(x => x.Nome).ToHashSet(StringComparer.Ordinal);
        var removidas = atuais.Keys.Where(k => !nomes.Contains(k)).ToList();
        foreach (var nome in removidas)
        {
            await using var del = sql.Comando(c, "DELETE FROM dbo.app_state_collection WHERE name = @n;", tx);
            PTexto(del, "@n", nome, 200);
            await del.ExecuteNonQueryAsync(ct);
        }

        long versao;
        await using (var v = sql.Comando(c, @"UPDATE dbo.app_state SET version = version + 1, updated_at = SYSDATETIMEOFFSET(), updated_by = @u
OUTPUT inserted.version WHERE id = 1;", tx))
        {
            PGuid(v, "@u", uid);
            versao = Convert.ToInt64(await v.ExecuteScalarAsync(ct));
        }
        await tx.CommitAsync(ct);
        return new ResultadoGravacaoEstado(versao, alteradas, removidas, bytes);
    }, ct);

    private static void PreencherColecao(DbCommand cmd, ColecaoRecebida col, Guid? uid)
    {
        PTexto(cmd, "@n", col.Nome, 200);
        P(cmd, "@o", col.Ordem, DbType.Int32);
        PTexto(cmd, "@c", Encoding.UTF8.GetString(col.ConteudoUtf8.Span), -1);
        PBinario(cmd, "@h", col.Hash, 32);
        P(cmd, "@i", col.Itens, DbType.Int32);
        PInteiro(cmd, "@s", col.ConteudoUtf8.Length);
        PGuid(cmd, "@u", uid);
    }

    public Task<ResumoEstado> ResumoAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, @"SELECT s.version, s.updated_at, u.username,
  (SELECT COUNT(*) FROM dbo.app_state_collection), (SELECT ISNULL(SUM(size_bytes), 0) FROM dbo.app_state_collection)
FROM dbo.app_state s LEFT JOIN dbo.users u ON u.id = s.updated_by WHERE s.id = 1;");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return new ResumoEstado(0, 0, 0, null, null);
        return new ResumoEstado(r.GetInt64(0), r.GetInt32(3), Convert.ToInt64(r.GetValue(4)), LerData(r, 1), LerTexto(r, 2));
    }, ct);
}

// ===================================================================== app_storage
internal sealed class KvSql(ConexaoSql sql) : IRepositorioKv
{
    public Task<IReadOnlyDictionary<string, string>> ListarAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        await using var cmd = sql.Comando(c, "SELECT [key], [value] FROM dbo.app_storage;");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) d[r.GetString(0)] = LerTexto(r, 1) ?? "";
        return (IReadOnlyDictionary<string, string>)d;
    }, ct);

    public Task DefinirAsync(string chave, string valor, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var tx = await c.BeginTransactionAsync(ct);
        await using var cmd = sql.Comando(c, @"UPDATE dbo.app_storage WITH (UPDLOCK, SERIALIZABLE) SET [value] = @v, updated_at = SYSDATETIMEOFFSET() WHERE [key] = @k;
IF @@ROWCOUNT = 0 INSERT INTO dbo.app_storage ([key], [value]) VALUES (@k, @v);", tx);
        PTexto(cmd, "@k", chave, 400); PTexto(cmd, "@v", valor, -1);
        await cmd.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }, ct);

    public Task RemoverAsync(string chave, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, "DELETE FROM dbo.app_storage WHERE [key] = @k;");
        PTexto(cmd, "@k", chave, 400);
        await cmd.ExecuteNonQueryAsync(ct);
    }, ct);

    public Task LimparAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, "DELETE FROM dbo.app_storage;");
        await cmd.ExecuteNonQueryAsync(ct);
    }, ct);

    public Task SubstituirTudoAsync(IReadOnlyDictionary<string, string> valores, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var tx = await c.BeginTransactionAsync(ct);
        await using (var del = sql.Comando(c, "DELETE FROM dbo.app_storage;", tx)) await del.ExecuteNonQueryAsync(ct);
        foreach (var (k, v) in valores)
        {
            await using var ins = sql.Comando(c, "INSERT INTO dbo.app_storage ([key], [value]) VALUES (@k, @v);", tx);
            PTexto(ins, "@k", k, 400); PTexto(ins, "@v", v, -1);
            await ins.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }, ct);
}

// ===================================================================== usuários
internal sealed class UsuariosSql(ConexaoSql sql) : IRepositorioUsuarios
{
    private const string Colunas = "id, username, full_name, password_hash, role, active, auth_provider, external_id, created_at, updated_at";

    private static Usuario Ler(DbDataReader r) => new()
    {
        Id = r.GetGuid(0), Username = r.GetString(1), FullName = r.GetString(2), PasswordHash = r.GetString(3),
        Role = r.GetString(4), Active = r.GetBoolean(5), AuthProvider = r.GetString(6), ExternalId = LerTexto(r, 7),
        CreatedAt = LerData(r, 8), UpdatedAt = LerData(r, 9),
    };

    private Task<Usuario?> UmAsync(string where, Action<DbCommand> parametros, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, $"SELECT TOP (1) {Colunas} FROM dbo.users WHERE {where};");
        parametros(cmd);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? Ler(r) : null;
    }, ct);

    public Task<int> ContarAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, "SELECT COUNT(*) FROM dbo.users;");
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }, ct);

    public Task<Usuario?> PorUsernameAsync(string username, CancellationToken ct) => UmAsync("username = @u", cmd => PTexto(cmd, "@u", username, 80), ct);
    public Task<Usuario?> PorIdAsync(Guid id, CancellationToken ct) => UmAsync("id = @id", cmd => PGuid(cmd, "@id", id), ct);
    public Task<Usuario?> PorIdExternoAsync(string idExterno, CancellationToken ct) => UmAsync("external_id = @e", cmd => PTexto(cmd, "@e", idExterno, 200), ct);

    public Task<IReadOnlyList<Usuario>> ListarAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        var l = new List<Usuario>();
        await using var cmd = sql.Comando(c, $"SELECT {Colunas} FROM dbo.users ORDER BY full_name;");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) l.Add(Ler(r));
        return (IReadOnlyList<Usuario>)l;
    }, ct);

    public async Task<bool> InserirAsync(Usuario u, CancellationToken ct)
    {
        try
        {
            await sql.ExecutarAsync(async c =>
            {
                await using var cmd = sql.Comando(c, @"INSERT INTO dbo.users (id, username, full_name, password_hash, role, active, auth_provider, external_id, created_at, updated_at)
VALUES (@id, @u, @n, @p, @r, @a, @ap, @e, @c, @m);");
                PGuid(cmd, "@id", u.Id); PTexto(cmd, "@u", u.Username, 80); PTexto(cmd, "@n", u.FullName, 180); PTexto(cmd, "@p", u.PasswordHash, 400);
                PTexto(cmd, "@r", u.Role, 30); PBool(cmd, "@a", u.Active); PTexto(cmd, "@ap", u.AuthProvider, 30); PTexto(cmd, "@e", u.ExternalId, 200);
                PData(cmd, "@c", u.CreatedAt); PData(cmd, "@m", u.UpdatedAt);
                await cmd.ExecuteNonQueryAsync(ct);
            }, ct);
            return true;
        }
        catch (DbException ex) when (EhViolacaoUnicidade(ex)) { return false; }
    }

    public Task AtualizarAsync(Usuario u, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, @"UPDATE dbo.users SET full_name = @n, password_hash = @p, role = @r, active = @a, auth_provider = @ap,
  external_id = @e, updated_at = @m WHERE id = @id;");
        PGuid(cmd, "@id", u.Id); PTexto(cmd, "@n", u.FullName, 180); PTexto(cmd, "@p", u.PasswordHash, 400); PTexto(cmd, "@r", u.Role, 30);
        PBool(cmd, "@a", u.Active); PTexto(cmd, "@ap", u.AuthProvider, 30); PTexto(cmd, "@e", u.ExternalId, 200); PData(cmd, "@m", u.UpdatedAt);
        await cmd.ExecuteNonQueryAsync(ct);
    }, ct);
}

// ===================================================================== auditoria
internal sealed class AuditoriaSql(ConexaoSql sql) : IRepositorioAuditoria
{
    public Task RegistrarAsync(RegistroAuditoria a, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, @"INSERT INTO dbo.audit_log (user_id, username, module, action, record_key, changed_at, details)
VALUES (@uid, @u, @m, @a, @k, @t, @d);");
        PGuid(cmd, "@uid", a.UserId); PTexto(cmd, "@u", Cortar(a.Username, 80), 80); PTexto(cmd, "@m", Cortar(a.Module, 80), 80);
        PTexto(cmd, "@a", Cortar(a.Action, 40), 40); PTexto(cmd, "@k", Cortar(a.RecordKey, 1000), 1000); PData(cmd, "@t", a.ChangedAt);
        PTexto(cmd, "@d", a.DetailsJson, -1);
        await cmd.ExecuteNonQueryAsync(ct);
    }, ct);

    private static string? Cortar(string? s, int n) => s is null || s.Length <= n ? s : s[..n];

    public Task<IReadOnlyList<RegistroAuditoria>> ListarAsync(int limite, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        var l = new List<RegistroAuditoria>();
        await using var cmd = sql.Comando(c, "SELECT TOP (@n) user_id, username, module, action, record_key, changed_at, details FROM dbo.audit_log ORDER BY changed_at DESC, id DESC;");
        P(cmd, "@n", limite, DbType.Int32);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            l.Add(new RegistroAuditoria(LerGuid(r, 0), LerTexto(r, 1), LerTexto(r, 2) ?? "", LerTexto(r, 3) ?? "", LerTexto(r, 4), LerData(r, 5), LerTexto(r, 6) ?? "{}"));
        return (IReadOnlyList<RegistroAuditoria>)l;
    }, ct);

    public Task<long> ContarAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, "SELECT COUNT_BIG(*) FROM dbo.audit_log;");
        return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));
    }, ct);
}

// ===================================================================== documentos de equipamento
internal sealed class DocumentosSql(ConexaoSql sql) : IRepositorioDocumentos
{
    private const string Colunas = "id, equipment_code, original_name, stored_name, mime_type, file_size, document_type, revision, active, uploaded_at, uploaded_by";

    private static DocumentoEquipamento Ler(DbDataReader r) => new()
    {
        Id = r.GetGuid(0), EquipmentCode = r.GetString(1), OriginalName = r.GetString(2), StoredName = r.GetString(3),
        MimeType = LerTexto(r, 4), FileSize = r.IsDBNull(5) ? 0 : r.GetInt64(5), DocumentType = LerTexto(r, 6), Revision = LerTexto(r, 7),
        Active = r.GetBoolean(8), UploadedAt = LerData(r, 9), UploadedBy = LerGuid(r, 10),
    };

    public Task<IReadOnlyList<DocumentoEquipamento>> ListarPorEquipamentoAsync(string codigo, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        var l = new List<DocumentoEquipamento>();
        await using var cmd = sql.Comando(c, $"SELECT {Colunas} FROM dbo.equipment_documents WHERE equipment_code = @c AND active = 1 ORDER BY uploaded_at DESC;");
        PTexto(cmd, "@c", codigo, 100);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) l.Add(Ler(r));
        return (IReadOnlyList<DocumentoEquipamento>)l;
    }, ct);

    public Task<IReadOnlyList<DocumentoEquipamento>> ListarTodosAsync(CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        var l = new List<DocumentoEquipamento>();
        await using var cmd = sql.Comando(c, $"SELECT {Colunas} FROM dbo.equipment_documents ORDER BY uploaded_at DESC;");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) l.Add(Ler(r));
        return (IReadOnlyList<DocumentoEquipamento>)l;
    }, ct);

    public Task<DocumentoEquipamento?> ObterAsync(Guid id, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, $"SELECT {Colunas} FROM dbo.equipment_documents WHERE id = @id;");
        PGuid(cmd, "@id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? Ler(r) : null;
    }, ct);

    public Task InserirAsync(DocumentoEquipamento d, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var tx = await c.BeginTransactionAsync(ct);
        // A tabela equipment pode ainda não ter o código (sincronização assíncrona): garante a linha para a FK.
        await using (var eq = sql.Comando(c, @"IF NOT EXISTS (SELECT 1 FROM dbo.equipment WITH (UPDLOCK, HOLDLOCK) WHERE code = @c)
    INSERT INTO dbo.equipment (code, active, payload) VALUES (@c, 1, N'{}');", tx))
        {
            PTexto(eq, "@c", d.EquipmentCode, 100);
            await eq.ExecuteNonQueryAsync(ct);
        }
        await using (var cmd = sql.Comando(c, @"INSERT INTO dbo.equipment_documents (id, equipment_code, original_name, stored_name, mime_type, file_size, document_type, revision, active, uploaded_at, uploaded_by)
VALUES (@id, @c, @on, @sn, @mt, @fs, @dt, @rv, 1, @ua, @ub);", tx))
        {
            PGuid(cmd, "@id", d.Id); PTexto(cmd, "@c", d.EquipmentCode, 100); PTexto(cmd, "@on", d.OriginalName, 400); PTexto(cmd, "@sn", d.StoredName, 400);
            PTexto(cmd, "@mt", d.MimeType, 200); PInteiro(cmd, "@fs", d.FileSize); PTexto(cmd, "@dt", d.DocumentType, 80); PTexto(cmd, "@rv", d.Revision, 40);
            PData(cmd, "@ua", d.UploadedAt); PGuid(cmd, "@ub", d.UploadedBy);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }, ct);
}

// ===================================================================== anexos
internal sealed class AnexosSql(ConexaoSql sql) : IRepositorioAnexos
{
    public Task InserirAsync(Anexo a, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, @"INSERT INTO dbo.attachments (id, scope, record_id, original_name, stored_key, mime_type, file_size, uploaded_at, uploaded_by)
VALUES (@id, @s, @r, @n, @k, @m, @f, @t, @u);");
        PGuid(cmd, "@id", a.Id); PTexto(cmd, "@s", a.Scope, 100); PTexto(cmd, "@r", a.RecordId, 200); PTexto(cmd, "@n", a.OriginalName, 400);
        PTexto(cmd, "@k", a.StoredKey, 800); PTexto(cmd, "@m", a.MimeType, 200); PInteiro(cmd, "@f", a.FileSize); PData(cmd, "@t", a.UploadedAt); PGuid(cmd, "@u", a.UploadedBy);
        await cmd.ExecuteNonQueryAsync(ct);
    }, ct);

    public Task<Anexo?> ObterAsync(Guid id, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, "SELECT id, scope, record_id, original_name, stored_key, mime_type, file_size, uploaded_at, uploaded_by FROM dbo.attachments WHERE id = @id;");
        PGuid(cmd, "@id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        return new Anexo
        {
            Id = r.GetGuid(0), Scope = r.GetString(1), RecordId = r.GetString(2), OriginalName = r.GetString(3), StoredKey = r.GetString(4),
            MimeType = LerTexto(r, 5), FileSize = r.GetInt64(6), UploadedAt = LerData(r, 7), UploadedBy = LerGuid(r, 8),
        };
    }, ct);
}

// ===================================================================== passaportes publicados
internal sealed class PassaportesSql(ConexaoSql sql) : IRepositorioPassaportes
{
    public Task SalvarAsync(PassaportePublicado p, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var tx = await c.BeginTransactionAsync(ct);
        await using var cmd = sql.Comando(c, @"UPDATE dbo.published_passports WITH (UPDLOCK, SERIALIZABLE)
   SET stored_key = @k, size_bytes = @s, published_at = @t, published_by = @u WHERE id = @id;
IF @@ROWCOUNT = 0
    INSERT INTO dbo.published_passports (id, stored_key, size_bytes, published_at, published_by) VALUES (@id, @k, @s, @t, @u);", tx);
        PTexto(cmd, "@id", p.Id, 200); PTexto(cmd, "@k", p.StoredKey, 800); PInteiro(cmd, "@s", p.SizeBytes); PData(cmd, "@t", p.PublishedAt); PGuid(cmd, "@u", p.PublishedBy);
        await cmd.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }, ct);

    public Task<PassaportePublicado?> ObterAsync(string id, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, "SELECT id, stored_key, size_bytes, published_at, published_by FROM dbo.published_passports WHERE id = @id;");
        PTexto(cmd, "@id", id, 200);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        return new PassaportePublicado { Id = r.GetString(0), StoredKey = r.GetString(1), SizeBytes = r.GetInt64(2), PublishedAt = LerData(r, 3), PublishedBy = LerGuid(r, 4) };
    }, ct);
}

// ===================================================================== backups
internal sealed class BackupsSql(ConexaoSql sql) : IRepositorioBackups
{
    private static BackupEstado Ler(DbDataReader r) => new()
    {
        Id = r.GetInt64(0), StoredKey = r.GetString(1), Reason = r.GetString(2), SizeBytes = r.GetInt64(3), StateVersion = r.GetInt64(4),
        CreatedAt = LerData(r, 5), CreatedBy = LerGuid(r, 6), CreatedByName = LerTexto(r, 7),
    };

    public Task<long> InserirAsync(BackupEstado b, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, @"INSERT INTO dbo.state_backups (stored_key, reason, size_bytes, state_version, created_at, created_by, created_by_name)
OUTPUT inserted.id VALUES (@k, @r, @s, @v, @t, @u, @un);");
        PTexto(cmd, "@k", b.StoredKey, 800); PTexto(cmd, "@r", b.Reason, 200); PInteiro(cmd, "@s", b.SizeBytes); PInteiro(cmd, "@v", b.StateVersion);
        PData(cmd, "@t", b.CreatedAt); PGuid(cmd, "@u", b.CreatedBy); PTexto(cmd, "@un", b.CreatedByName, 80);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));
    }, ct);

    public Task<IReadOnlyList<BackupEstado>> ListarAsync(int limite, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        var l = new List<BackupEstado>();
        await using var cmd = sql.Comando(c, "SELECT TOP (@n) id, stored_key, reason, size_bytes, state_version, created_at, created_by, created_by_name FROM dbo.state_backups ORDER BY id DESC;");
        P(cmd, "@n", limite, DbType.Int32);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) l.Add(Ler(r));
        return (IReadOnlyList<BackupEstado>)l;
    }, ct);

    public Task<BackupEstado?> ObterAsync(long id, CancellationToken ct) => sql.ExecutarAsync(async c =>
    {
        await using var cmd = sql.Comando(c, "SELECT id, stored_key, reason, size_bytes, state_version, created_at, created_by, created_by_name FROM dbo.state_backups WHERE id = @id;");
        PInteiro(cmd, "@id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? Ler(r) : null;
    }, ct);
}

// ===================================================================== chaves do Data Protection
internal sealed class ChavesProtecaoSql(ConexaoSql sql) : IXmlRepository
{
    public IReadOnlyCollection<XElement> GetAllElements()
    {
        try
        {
            using var c = ConexaoSql.Fabrica.CreateConnection()!;
            c.ConnectionString = sql.ConnectionString;
            c.Open();
            using var cmd = sql.Comando(c, "IF OBJECT_ID(N'dbo.data_protection_keys', N'U') IS NOT NULL SELECT xml FROM dbo.data_protection_keys ORDER BY id;");
            using var r = cmd.ExecuteReader();
            var l = new List<XElement>();
            while (r.Read()) l.Add(XElement.Parse(r.GetString(0)));
            return l;
        }
        catch (Exception)
        {
            return [];
        }
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        using var c = ConexaoSql.Fabrica.CreateConnection()!;
        c.ConnectionString = sql.ConnectionString;
        c.Open();
        using var cmd = sql.Comando(c, "INSERT INTO dbo.data_protection_keys (friendly_name, xml) VALUES (@f, @x);");
        PTexto(cmd, "@f", friendlyName, 200);
        PTexto(cmd, "@x", element.ToString(SaveOptions.DisableFormatting), -1);
        cmd.ExecuteNonQuery();
    }
}
