namespace MesLion.Server.Configuracao;

/// <summary>Configurações do MES LION (seção "MesLion" do appsettings.json / variáveis de ambiente).</summary>
public sealed class MesOptions
{
    public const string Secao = "MesLion";

    public BancoOptions Banco { get; set; } = new();
    public ArquivosOptions Arquivos { get; set; } = new();
    public SeedOptions Seed { get; set; } = new();
    public AutenticacaoOptions Autenticacao { get; set; } = new();
    public PublicacaoOptions Publicacao { get; set; } = new();
    public ServidorOptions Servidor { get; set; } = new();
    public RelacionalOptions Relacional { get; set; } = new();
}

public sealed class BancoOptions
{
    /// <summary>Auto | SqlServer | Portatil. "Auto": usa SQL Server se houver connection string
    /// (ou LocalDB detectado no Windows); caso contrário usa o modo portátil em arquivos.</summary>
    public string Provedor { get; set; } = "Auto";

    /// <summary>Nome da connection string em ConnectionStrings (padrão: "MesLion").</summary>
    public string NomeConexao { get; set; } = "MesLion";

    public bool AplicarScriptsAutomaticamente { get; set; } = true;
    public bool CriarBancoSeNaoExistir { get; set; } = true;
    public bool DetectarLocalDb { get; set; } = true;
    public string NomeBancoLocalDb { get; set; } = "MesLion";
    public int TimeoutComandoSegundos { get; set; } = 300;

    /// <summary>Pasta do banco portátil (relativa à pasta do aplicativo).</summary>
    public string PastaPortatil { get; set; } = "../Dados/BancoPortatil";
}

public sealed class ArquivosOptions
{
    /// <summary>Local | AzureBlob</summary>
    public string Provedor { get; set; } = "Local";
    public string PastaLocal { get; set; } = "../Dados/Arquivos";
    public AzureBlobOptions AzureBlob { get; set; } = new();
}

public sealed class AzureBlobOptions
{
    /// <summary>Connection string com AccountName/AccountKey (ou UseDevelopmentStorage=true).</summary>
    public string? ConnectionString { get; set; }
    /// <summary>URL da conta, ex.: https://minhaconta.blob.core.windows.net (com identidade gerenciada).</summary>
    public string? ContaUrl { get; set; }
    public string Container { get; set; } = "meslion";
    public bool UsarIdentidadeGerenciada { get; set; }
    /// <summary>Client ID de identidade gerenciada atribuída pelo usuário (opcional).</summary>
    public string? ClientIdIdentidade { get; set; }
}

public sealed class SeedOptions
{
    public string ArquivoInicial { get; set; } = "../Dados/MES_LION_DATA.json";
    public string UsuarioAdmin { get; set; } = "admin";
    public string SenhaAdmin { get; set; } = "meslion2026";
    public string NomeAdmin { get; set; } = "Administrador MES LION";
}

public sealed class AutenticacaoOptions
{
    public int SessaoHoras { get; set; } = 12;
    /// <summary>Converte hashes bcrypt herdados do PostgreSQL para PBKDF2 no primeiro login.</summary>
    public bool AtualizarHashLegado { get; set; } = true;
    public EntraIdOptions EntraId { get; set; } = new();
}

public sealed class EntraIdOptions
{
    /// <summary>Habilita login Microsoft Entra ID via autenticação do Azure App Service (Easy Auth).</summary>
    public bool Habilitado { get; set; }
    public bool ProvisionarAutomaticamente { get; set; } = true;
    public string PerfilPadrao { get; set; } = "USER";
    /// <summary>App role do Entra ID que concede perfil ADMIN no MES.</summary>
    public string PapelAdmin { get; set; } = "MES.Admin";
    public bool SincronizarPerfil { get; set; } = true;
    /// <summary>Provedor configurado no App Service (aad).</summary>
    public string Provedor { get; set; } = "aad";
    /// <summary>SOMENTE TESTES: confia nos cabeçalhos X-MS-CLIENT-PRINCIPAL fora do Azure App Service.</summary>
    public bool ConfiarCabecalhosForaDoAzure { get; set; }
}

public sealed class PublicacaoOptions
{
    /// <summary>URL base pública (ex.: https://meslion.azurewebsites.net). Vazio = detecta pela requisição.</summary>
    public string? UrlBasePublica { get; set; }
}

public sealed class ServidorOptions
{
    public int LimiteRequisicaoMB { get; set; } = 512;
    public bool CompressaoRespostas { get; set; } = true;
    public bool AceitarUploadCompactado { get; set; } = true;
    public bool AbrirNavegador { get; set; }
}

public sealed class RelacionalOptions
{
    /// <summary>Mantém a camada relacional (views rel.* e tabelas normalizadas) — somente SQL Server.</summary>
    public bool Habilitado { get; set; } = true;
    public int AtrasoSegundos { get; set; } = 8;
    public bool GerarViewsDinamicas { get; set; } = true;
    public bool SincronizarTabelasNormalizadas { get; set; } = true;
}
