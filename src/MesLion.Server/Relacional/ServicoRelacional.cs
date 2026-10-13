using System.Data;
using MesLion.Server.Configuracao;
using MesLion.Server.Estado;
using MesLion.Server.Persistencia;
using MesLion.Server.Persistencia.SqlServer;
using Microsoft.Extensions.Options;
using static MesLion.Server.Persistencia.SqlServer.ConexaoSql;

namespace MesLion.Server.Relacional;

/// <summary>
/// Mantém a camada relacional do SQL Server atualizada em segundo plano após as gravações:
/// (1) views rel.&lt;coleção&gt; geradas a partir dos campos reais; (2) tabelas normalizadas
/// (rel.usp_sincronizar_modelo_relacional). Falhas aqui nunca afetam a gravação do MES.
/// </summary>
public sealed class ServicoRelacional : BackgroundService
{
    private readonly ServicoEstado _estado;
    private readonly ConexaoSql? _sql;
    private readonly RelacionalOptions _o;
    private readonly ILogger<ServicoRelacional> _log;
    private readonly SemaphoreSlim _sinal = new(0, 1);
    private readonly Dictionary<string, string> _assinaturas = new(StringComparer.Ordinal);
    private volatile bool _pendente = true;
    private long _ultimaVersao;
    private DateTimeOffset? _ultimaExecucao;
    private string _ultimaMensagem = "Aguardando primeira sincronização.";
    private bool? _ultimoSucesso;

    public ServicoRelacional(ServicoEstado estado, ProvedorPersistencia provedor, IServiceProvider sp, IOptions<MesOptions> o, ILogger<ServicoRelacional> log)
    {
        _estado = estado;
        _o = o.Value.Relacional;
        _log = log;
        _sql = provedor.Nome == "SqlServer" ? sp.GetService<ConexaoSql>() : null;
        if (Ativo) _estado.EstadoGravado += _ => Sinalizar();
    }

    public bool Ativo => _sql is not null && _o.Habilitado;

    public void Sinalizar()
    {
        _pendente = true;
        if (_sinal.CurrentCount == 0) try { _sinal.Release(); } catch (SemaphoreFullException) { }
    }

    public object Status() => !Ativo
        ? new { ativo = false, mensagem = _sql is null ? "Não aplicável no modo portátil (somente SQL Server)." : "Desabilitada em MesLion:Relacional:Habilitado." }
        : new { ativo = true, ultimaExecucao = _ultimaExecucao?.ToString("yyyy-MM-dd'T'HH:mm:sszzz"), versaoEstado = _ultimaVersao, sucesso = _ultimoSucesso, mensagem = _ultimaMensagem };

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!Ativo) return;
        await Task.Delay(TimeSpan.FromSeconds(3), ct);
        while (!ct.IsCancellationRequested)
        {
            if (_pendente)
            {
                _pendente = false;
                try { await ExecutarAgoraAsync(ct); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                catch (Exception ex)
                {
                    _ultimoSucesso = false;
                    _ultimaMensagem = ex.Message;
                    _log.LogWarning(ex, "Camada relacional: falha na atualização (o MES continua operando normalmente).");
                }
            }
            try
            {
                await _sinal.WaitAsync(ct);
                await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, _o.AtrasoSegundos)), ct); // agrupa gravações seguidas
            }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>Executa a atualização imediatamente (também usado pela linha de comando --atualizar-relacional).</summary>
    public async Task<string> ExecutarAgoraAsync(CancellationToken ct)
    {
        if (_sql is null) return "Camada relacional disponível somente com SQL Server.";
        var montado = await _estado.ObterAsync(ct);
        var mensagens = new List<string>();
        if (_o.GerarViewsDinamicas) mensagens.Add(await GerarViewsAsync(montado, ct));
        if (_o.SincronizarTabelasNormalizadas)
        {
            string resumo = await _sql.ExecutarAsync(async c =>
            {
                await using var cmd = _sql.Comando(c, "EXEC rel.usp_sincronizar_modelo_relacional @versao_estado = @v;");
                PInteiro(cmd, "@v", montado.Versao);
                return Convert.ToString(await cmd.ExecuteScalarAsync(ct)) ?? "";
            }, ct);
            mensagens.Add("Tabelas: " + resumo);
        }
        _ultimaVersao = montado.Versao;
        _ultimaExecucao = DateTimeOffset.Now;
        _ultimoSucesso = true;
        _ultimaMensagem = string.Join(" | ", mensagens);
        _log.LogInformation("Camada relacional atualizada (versão {Versao}): {Mensagem}", montado.Versao, _ultimaMensagem);
        return _ultimaMensagem;
    }

    private async Task<string> GerarViewsAsync(EstadoMontado montado, CancellationToken ct)
    {
        var sql = _sql!;
        if (_assinaturas.Count == 0)
        {
            await sql.ExecutarAsync(async c =>
            {
                await using var cmd = sql.Comando(c, "SELECT colecao, assinatura FROM rel.views_geradas;");
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct)) _assinaturas[r.GetString(0)] = r.GetString(1).Trim();
            }, ct);
        }

        var colecoes = montado.Vazio ? [] : JsonEstado.Dividir(montado.Json);
        int criadas = 0, falhas = 0;
        var presentes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var col in colecoes)
        {
            presentes.Add(col.Nome);
            var def = GeradorViews.Gerar(col.Nome, col.ConteudoUtf8);
            if (def is null) continue;
            if (_assinaturas.TryGetValue(col.Nome, out var a) && a == def.Assinatura) continue;
            try
            {
                await sql.ExecutarAsync(async c =>
                {
                    await using (var cmd = sql.Comando(c, def.Sql)) await cmd.ExecuteNonQueryAsync(ct);
                    await using var reg = sql.Comando(c, @"MERGE rel.views_geradas AS t USING (SELECT @c AS colecao) AS s ON t.colecao = s.colecao
WHEN MATCHED THEN UPDATE SET nome_view = @v, assinatura = @a, colunas = @n, gerada_em = SYSDATETIMEOFFSET(), definicao = @d
WHEN NOT MATCHED THEN INSERT (colecao, nome_view, assinatura, colunas, definicao) VALUES (@c, @v, @a, @n, @d);");
                    PTexto(reg, "@c", def.Colecao, 200); PTexto(reg, "@v", "rel." + def.NomeView, 300);
                    P(reg, "@a", def.Assinatura, DbType.AnsiStringFixedLength, 64); P(reg, "@n", def.Colunas, DbType.Int32); PTexto(reg, "@d", def.Sql, -1);
                    await reg.ExecuteNonQueryAsync(ct);
                }, ct);
                _assinaturas[col.Nome] = def.Assinatura;
                criadas++;
            }
            catch (Exception ex)
            {
                falhas++;
                _log.LogWarning("Não foi possível gerar a view rel.{View}: {Erro}", def.NomeView, ex.Message);
            }
        }

        // Remove views de coleções que não existem mais.
        foreach (var antiga in _assinaturas.Keys.Where(k => !presentes.Contains(k)).ToList())
        {
            try
            {
                await sql.ExecutarAsync(async c =>
                {
                    await using var cmd = sql.Comando(c, @"DECLARE @v NVARCHAR(300) = (SELECT nome_view FROM rel.views_geradas WHERE colecao = @c);
IF @v IS NOT NULL AND OBJECT_ID(@v, N'V') IS NOT NULL BEGIN DECLARE @s NVARCHAR(400) = N'DROP VIEW ' + @v; EXEC(@s); END;
DELETE FROM rel.views_geradas WHERE colecao = @c;");
                    PTexto(cmd, "@c", antiga, 200);
                    await cmd.ExecuteNonQueryAsync(ct);
                }, ct);
                _assinaturas.Remove(antiga);
            }
            catch (Exception ex) { _log.LogWarning("Não foi possível remover a view da coleção {Colecao}: {Erro}", antiga, ex.Message); }
        }
        return $"Views: {criadas} atualizada(s), {falhas} falha(s), {_assinaturas.Count} no total";
    }
}
