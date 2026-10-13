using System.Text;
using System.Text.Json;
using MesLion.Server.Persistencia;

namespace MesLion.Server.Estado;

/// <summary>Estado montado (objeto "data" completo) mantido em cache por versão.</summary>
public sealed record EstadoMontado(long Versao, byte[] Json, int Colecoes)
{
    public bool Vazio => Colecoes == 0;
}

/// <summary>
/// Regras de persistência do estado do MES (equivalente às rotas /api/bootstrap e
/// PUT /api/storage/MES_LION_DATA do servidor PowerShell original).
/// </summary>
public sealed class ServicoEstado(ProvedorPersistencia provedor, ILogger<ServicoEstado> log)
{
    private readonly SemaphoreSlim _travaCache = new(1, 1);
    private readonly SemaphoreSlim _travaGravacao = new(1, 1);
    private volatile EstadoMontado? _cache;

    /// <summary>Disparado após cada gravação bem-sucedida (usado pela camada relacional).</summary>
    public event Action<ResultadoGravacaoEstado>? EstadoGravado;

    public async Task<EstadoMontado> ObterAsync(CancellationToken ct)
    {
        long versao = await provedor.Estado.ObterVersaoAsync(ct);
        var atual = _cache;
        if (atual is not null && atual.Versao == versao) return atual;

        await _travaCache.WaitAsync(ct);
        try
        {
            atual = _cache;
            if (atual is not null && atual.Versao == versao) return atual;
            var (v, colecoes) = await provedor.Estado.CarregarAsync(ct);
            var json = JsonEstado.Montar(colecoes.OrderBy(c => c.Ordem).ThenBy(c => c.Nome, StringComparer.Ordinal)
                .Select(c => (c.Nome, (ReadOnlyMemory<byte>)c.ConteudoUtf8)));
            var montado = new EstadoMontado(v, json, colecoes.Count);
            _cache = montado;
            return montado;
        }
        finally { _travaCache.Release(); }
    }

    /// <summary>Grava o estado completo enviado pelo navegador (corpo do PUT).</summary>
    public async Task<ResultadoGravacaoEstado> GravarAsync(ReadOnlyMemory<byte> json, Usuario? usuario, CancellationToken ct)
    {
        var colecoes = JsonEstado.Dividir(json);
        await _travaGravacao.WaitAsync(ct);
        try
        {
            var r = await provedor.Estado.GravarAsync(colecoes, usuario, ct);
            // O cache é reconstruído a partir do próprio envio (mesmo conteúdo que foi persistido).
            var montado = JsonEstado.Montar(colecoes.Select(c => (c.Nome, c.ConteudoUtf8)));
            _cache = new EstadoMontado(r.Versao, montado, colecoes.Count);
            try { EstadoGravado?.Invoke(r); } catch (Exception ex) { log.LogWarning(ex, "Falha ao notificar gravação do estado."); }
            return r;
        }
        finally { _travaGravacao.Release(); }
    }

    public void InvalidarCache() => _cache = null;

    /// <summary>Exporta no formato de banco do MES (compatível com Dados/MES_LION_DATA.json).</summary>
    public async Task<byte[]> ExportarAsync(CancellationToken ct)
    {
        var estado = await ObterAsync(ct);
        var kv = await provedor.Kv.ListarAsync(ct);
        using var ms = new MemoryStream(estado.Json.Length + 4096);
        using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Encoder = JsonEstado.Codificador, Indented = false }))
        {
            w.WriteStartObject();
            w.WriteNumber("schemaVersion", 39);
            w.WriteString("format", "MES_LION_JSON_DATABASE");
            w.WriteString("updatedAt", DateTimeOffset.Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz"));
            w.WriteString("exportedBy", "MES LION Azure (.NET)");
            w.WriteStartObject("appStorage");
            foreach (var (k, v) in kv) w.WriteString(k, v);
            w.WriteEndObject();
            w.WritePropertyName("data");
            w.WriteRawValue(estado.Json, skipInputValidation: true); // estado vazio = "{}"
            w.WriteEndObject();
        }
        return ms.ToArray();
    }

    /// <summary>Importa um arquivo de banco (formato MES_LION_JSON_DATABASE ou objeto de estado).</summary>
    public async Task<(ResultadoGravacaoEstado Resultado, int ChavesKv, string Formato)> ImportarAsync(byte[] conteudo, Usuario? usuario, CancellationToken ct)
    {
        var (estado, kv, formato) = JsonEstado.LerArquivoBanco(conteudo);
        var r = await GravarAsync(estado, usuario, ct);
        if (kv is not null) await provedor.Kv.SubstituirTudoAsync(kv, ct);
        return (r, kv?.Count ?? 0, formato);
    }

    public static string DescreverAlteracoes(ResultadoGravacaoEstado r)
    {
        var sb = new StringBuilder();
        sb.Append("{\"colecoes_alteradas\":").Append(JsonSerializer.Serialize(r.Alteradas))
          .Append(",\"colecoes_removidas\":").Append(JsonSerializer.Serialize(r.Removidas))
          .Append(",\"bytes_gravados\":").Append(r.BytesGravados)
          .Append(",\"versao\":").Append(r.Versao).Append('}');
        return sb.ToString();
    }
}
