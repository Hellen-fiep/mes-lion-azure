using System.Data;
using System.Data.Common;
using System.Reflection;

namespace MesLion.Server.Persistencia.SqlServer;

/// <summary>
/// Acesso ADO.NET ao SQL Server / Azure SQL usando o provedor oficial Microsoft.Data.SqlClient.
/// O provedor é obtido pela fábrica ADO.NET (DbProviderFactory), o que mantém a camada de dados
/// independente de tipos específicos e com retentativa para falhas transitórias do Azure SQL.
/// </summary>
public sealed class ConexaoSql
{
    public const string NomeProvedor = "Microsoft.Data.SqlClient";
    private static readonly Lazy<DbProviderFactory?> FabricaLazy = new(CarregarFabrica);

    // Erros transitórios documentados para Azure SQL / SQL Server.
    private static readonly HashSet<int> ErrosTransitorios =
    [
        -2, 20, 64, 233, 1205, 4060, 4221, 10053, 10054, 10060, 10928, 10929, 11001,
        40143, 40197, 40501, 40540, 40613, 41301, 41302, 41305, 41325, 41839, 42108, 42109, 49918, 49919, 49920,
    ];

    public string ConnectionString { get; }
    public int TimeoutSegundos { get; }
    private readonly ILogger _log;

    public ConexaoSql(string connectionString, int timeoutSegundos, ILogger log)
    {
        ConnectionString = connectionString;
        TimeoutSegundos = timeoutSegundos;
        _log = log;
    }

    public static bool ProvedorDisponivel => FabricaLazy.Value is not null;

    public static DbProviderFactory Fabrica => FabricaLazy.Value
        ?? throw new InvalidOperationException(
            "O provedor Microsoft.Data.SqlClient não foi encontrado junto ao aplicativo. " +
            "Use a versão compilada oficial (dotnet publish) ou o modo Portátil.");

    private static DbProviderFactory? CarregarFabrica()
    {
        try
        {
            var tipo = Type.GetType("Microsoft.Data.SqlClient.SqlClientFactory, Microsoft.Data.SqlClient", throwOnError: false);
            var campo = tipo?.GetField("Instance", BindingFlags.Public | BindingFlags.Static);
            return campo?.GetValue(null) as DbProviderFactory;
        }
        catch { return null; }
    }

    public DbConnectionStringBuilder Construtor()
    {
        var b = Fabrica.CreateConnectionStringBuilder() ?? new DbConnectionStringBuilder();
        b.ConnectionString = ConnectionString;
        return b;
    }

    public async Task<DbConnection> AbrirAsync(CancellationToken ct, string? connectionString = null)
    {
        var c = Fabrica.CreateConnection()!;
        c.ConnectionString = connectionString ?? ConnectionString;
        await c.OpenAsync(ct);
        return c;
    }

    public DbCommand Comando(DbConnection c, string sql, DbTransaction? tx = null)
    {
        var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = TimeoutSegundos;
        cmd.Transaction = tx;
        return cmd;
    }

    public static DbParameter P(DbCommand cmd, string nome, object? valor, DbType tipo, int tamanho = 0)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = nome;
        p.DbType = tipo;
        if (tamanho != 0) p.Size = tamanho;
        p.Value = valor ?? DBNull.Value;
        cmd.Parameters.Add(p);
        return p;
    }

    public static DbParameter PTexto(DbCommand cmd, string nome, string? valor, int tamanho = -1) => P(cmd, nome, valor, DbType.String, tamanho);
    public static DbParameter PGuid(DbCommand cmd, string nome, Guid? valor) => P(cmd, nome, valor, DbType.Guid);
    public static DbParameter PData(DbCommand cmd, string nome, DateTimeOffset? valor) => P(cmd, nome, valor, DbType.DateTimeOffset);
    public static DbParameter PInteiro(DbCommand cmd, string nome, long? valor) => P(cmd, nome, valor, DbType.Int64);
    public static DbParameter PBool(DbCommand cmd, string nome, bool valor) => P(cmd, nome, valor, DbType.Boolean);
    public static DbParameter PBinario(DbCommand cmd, string nome, byte[]? valor, int tamanho = -1) => P(cmd, nome, valor, DbType.Binary, tamanho);

    /// <summary>Executa a operação com retentativa (falhas transitórias). A operação deve ser idempotente
    /// ou transacional (o rollback ocorre ao descartar a transação).</summary>
    public async Task<T> ExecutarAsync<T>(Func<DbConnection, Task<T>> operacao, CancellationToken ct, int tentativas = 5)
    {
        for (int i = 1; ; i++)
        {
            try
            {
                await using var c = await AbrirAsync(ct);
                return await operacao(c);
            }
            catch (Exception ex) when (i < tentativas && EhTransitorio(ex) && !ct.IsCancellationRequested)
            {
                var espera = TimeSpan.FromMilliseconds(Math.Min(8000, 400 * Math.Pow(2, i - 1)));
                _log.LogWarning("Falha transitória no SQL Server (tentativa {Tentativa}/{Total}): {Mensagem}. Nova tentativa em {Espera} ms.",
                    i, tentativas, ex.Message, espera.TotalMilliseconds);
                await Task.Delay(espera, ct);
            }
        }
    }

    public Task ExecutarAsync(Func<DbConnection, Task> operacao, CancellationToken ct) =>
        ExecutarAsync<bool>(async c => { await operacao(c); return true; }, ct);

    public static int? NumeroErro(Exception ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            if (e is DbException && e.GetType().GetProperty("Number")?.GetValue(e) is int n) return n;
        }
        return null;
    }

    public static bool EhTransitorio(Exception ex)
    {
        if (ex is DbException { IsTransient: true }) return true;
        var n = NumeroErro(ex);
        return n is not null && ErrosTransitorios.Contains(n.Value);
    }

    public static bool EhViolacaoUnicidade(Exception ex) => NumeroErro(ex) is 2627 or 2601;

    public static string? LerTexto(DbDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);
    public static Guid? LerGuid(DbDataReader r, int i) => r.IsDBNull(i) ? null : r.GetGuid(i);
    public static DateTimeOffset LerData(DbDataReader r, int i) => r.GetFieldValue<DateTimeOffset>(i);
}
