using System.Text.Json;
using MesLion.Server.Estado;
using MesLion.Server.Persistencia;

namespace MesLion.Server.Infra;

/// <summary>Histórico de modificações (audit_log), com os mesmos módulos/ações do servidor original.</summary>
public sealed class ServicoAuditoria(ProvedorPersistencia provedor, ILogger<ServicoAuditoria> log)
{
    public async Task RegistrarAsync(Usuario? u, string modulo, string acao, string? chave = "", string? detalhesJson = "{}")
    {
        if (u is null) return; // mesmo comportamento do Audit() do PowerShell: sem usuário, sem registro
        try
        {
            await provedor.Auditoria.RegistrarAsync(new RegistroAuditoria(
                u.Id, u.Username, modulo, acao, chave ?? "", DateTimeOffset.Now, string.IsNullOrWhiteSpace(detalhesJson) ? "{}" : detalhesJson), CancellationToken.None);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Falha ao registrar auditoria {Modulo}/{Acao}.", modulo, acao);
        }
    }

    public static string Detalhes(object o) => JsonSerializer.Serialize(o, new JsonSerializerOptions { Encoder = JsonEstado.Codificador });
}
