namespace MesLion.Server.Persistencia;

// =====================================================================
// Modelos persistidos
// =====================================================================

/// <summary>Uma coleção de nível superior do estado do MES (ex.: "op", "materiais", "meta").</summary>
public sealed record ColecaoArmazenada(string Nome, int Ordem, byte[] ConteudoUtf8, byte[] Hash);

/// <summary>Coleção recebida do navegador, já validada, com o JSON bruto preservado.</summary>
public sealed record ColecaoRecebida(string Nome, int Ordem, ReadOnlyMemory<byte> ConteudoUtf8, byte[] Hash, int? Itens);

public sealed record AssinaturaColecao(string Nome, int Ordem, byte[] Hash);

public sealed record ResultadoGravacaoEstado(long Versao, IReadOnlyList<string> Alteradas, IReadOnlyList<string> Removidas, long BytesGravados);

public sealed record ResumoEstado(long Versao, int Colecoes, long Bytes, DateTimeOffset? AtualizadoEm, string? AtualizadoPor);

public sealed class Usuario
{
    public Guid Id { get; set; }
    public string Username { get; set; } = "";
    public string FullName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "USER";
    public bool Active { get; set; } = true;
    public string AuthProvider { get; set; } = "LOCAL";
    public string? ExternalId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed record RegistroAuditoria(
    Guid? UserId, string? Username, string Module, string Action, string? RecordKey,
    DateTimeOffset ChangedAt, string DetailsJson);

public sealed class DocumentoEquipamento
{
    public Guid Id { get; set; }
    public string EquipmentCode { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string StoredName { get; set; } = "";
    public string? MimeType { get; set; }
    public long FileSize { get; set; }
    public string? DocumentType { get; set; }
    public string? Revision { get; set; }
    public bool Active { get; set; } = true;
    public DateTimeOffset UploadedAt { get; set; }
    public Guid? UploadedBy { get; set; }
}

public sealed class Anexo
{
    public Guid Id { get; set; }
    public string Scope { get; set; } = "";
    public string RecordId { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string StoredKey { get; set; } = "";
    public string? MimeType { get; set; }
    public long FileSize { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
    public Guid? UploadedBy { get; set; }
}

public sealed class PassaportePublicado
{
    public string Id { get; set; } = "";
    public string StoredKey { get; set; } = "";
    public long SizeBytes { get; set; }
    public DateTimeOffset PublishedAt { get; set; }
    public Guid? PublishedBy { get; set; }
}

public sealed class BackupEstado
{
    public long Id { get; set; }
    public string StoredKey { get; set; } = "";
    public string Reason { get; set; } = "";
    public long SizeBytes { get; set; }
    public long StateVersion { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public Guid? CreatedBy { get; set; }
    public string? CreatedByName { get; set; }
}

// =====================================================================
// Repositórios — implementados por SQL Server (oficial) e Portátil (arquivos)
// =====================================================================

public interface IRepositorioEstado
{
    Task<long> ObterVersaoAsync(CancellationToken ct);
    Task<(long Versao, IReadOnlyList<ColecaoArmazenada> Colecoes)> CarregarAsync(CancellationToken ct);
    /// <summary>Grava o estado completo enviado pelo navegador. Somente coleções alteradas são escritas;
    /// coleções ausentes no envio são removidas (mesma semântica do UPDATE do payload original).</summary>
    Task<ResultadoGravacaoEstado> GravarAsync(IReadOnlyList<ColecaoRecebida> colecoes, Usuario? usuario, CancellationToken ct);
    Task<ResumoEstado> ResumoAsync(CancellationToken ct);
}

public interface IRepositorioKv
{
    Task<IReadOnlyDictionary<string, string>> ListarAsync(CancellationToken ct);
    Task DefinirAsync(string chave, string valor, CancellationToken ct);
    Task RemoverAsync(string chave, CancellationToken ct);
    Task LimparAsync(CancellationToken ct);
    Task SubstituirTudoAsync(IReadOnlyDictionary<string, string> valores, CancellationToken ct);
}

public interface IRepositorioUsuarios
{
    Task<int> ContarAsync(CancellationToken ct);
    Task<Usuario?> PorUsernameAsync(string username, CancellationToken ct);
    Task<Usuario?> PorIdAsync(Guid id, CancellationToken ct);
    Task<Usuario?> PorIdExternoAsync(string idExterno, CancellationToken ct);
    Task<IReadOnlyList<Usuario>> ListarAsync(CancellationToken ct);
    /// <summary>Insere; retorna false se o username já existir.</summary>
    Task<bool> InserirAsync(Usuario u, CancellationToken ct);
    Task AtualizarAsync(Usuario u, CancellationToken ct);
}

public interface IRepositorioAuditoria
{
    Task RegistrarAsync(RegistroAuditoria r, CancellationToken ct);
    Task<IReadOnlyList<RegistroAuditoria>> ListarAsync(int limite, CancellationToken ct);
    Task<long> ContarAsync(CancellationToken ct);
}

public interface IRepositorioDocumentos
{
    Task<IReadOnlyList<DocumentoEquipamento>> ListarPorEquipamentoAsync(string codigo, CancellationToken ct);
    Task<DocumentoEquipamento?> ObterAsync(Guid id, CancellationToken ct);
    Task InserirAsync(DocumentoEquipamento d, CancellationToken ct);
    Task<IReadOnlyList<DocumentoEquipamento>> ListarTodosAsync(CancellationToken ct);
}

public interface IRepositorioAnexos
{
    Task InserirAsync(Anexo a, CancellationToken ct);
    Task<Anexo?> ObterAsync(Guid id, CancellationToken ct);
}

public interface IRepositorioPassaportes
{
    Task SalvarAsync(PassaportePublicado p, CancellationToken ct);
    Task<PassaportePublicado?> ObterAsync(string id, CancellationToken ct);
}

public interface IRepositorioBackups
{
    Task<long> InserirAsync(BackupEstado b, CancellationToken ct);
    Task<IReadOnlyList<BackupEstado>> ListarAsync(int limite, CancellationToken ct);
    Task<BackupEstado?> ObterAsync(long id, CancellationToken ct);
}

/// <summary>Inicialização do banco: criação/atualização do esquema.</summary>
public interface IInicializadorBanco
{
    string Descricao { get; }
    Task InicializarAsync(CancellationToken ct);
}

/// <summary>Agrupa os repositórios de um provedor.</summary>
public sealed record ProvedorPersistencia(
    string Nome,
    string Descricao,
    IInicializadorBanco Inicializador,
    IRepositorioEstado Estado,
    IRepositorioKv Kv,
    IRepositorioUsuarios Usuarios,
    IRepositorioAuditoria Auditoria,
    IRepositorioDocumentos Documentos,
    IRepositorioAnexos Anexos,
    IRepositorioPassaportes Passaportes,
    IRepositorioBackups Backups,
    Microsoft.AspNetCore.DataProtection.Repositories.IXmlRepository ChavesProtecao);
