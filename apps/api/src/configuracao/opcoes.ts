// =====================================================================
// Configurações do MES LION — mesma seção "MesLion" do appsettings.json do servidor .NET
// (Configuracao/MesOptions.cs), com as mesmas variáveis de ambiente (MesLion__Banco__Provedor,
// ConnectionStrings__MesLion…). Seções novas da API: Autenticacao.Jwt, Api e Monitoramento.
// =====================================================================

export interface OpcoesBanco {
  /** Auto | SqlServer | Portatil. Auto: SQL Server se houver connection string; senão, modo Portátil. */
  provedor: string;
  nomeConexao: string;
  aplicarScriptsAutomaticamente: boolean;
  criarBancoSeNaoExistir: boolean;
  /** LocalDB usa named pipes e autenticação integrada, que o driver do Node (tedious) não suporta. */
  detectarLocalDb: boolean;
  nomeBancoLocalDb: string;
  timeoutComandoSegundos: number;
  pastaPortatil: string;
}

export interface OpcoesAzureBlob {
  connectionString: string;
  contaUrl: string;
  container: string;
  usarIdentidadeGerenciada: boolean;
  clientIdIdentidade: string;
}

export interface OpcoesArquivos {
  /** Local | AzureBlob */
  provedor: string;
  pastaLocal: string;
  azureBlob: OpcoesAzureBlob;
}

export interface OpcoesSeed {
  arquivoInicial: string;
  usuarioAdmin: string;
  senhaAdmin: string;
  nomeAdmin: string;
}

export interface OpcoesEntraId {
  habilitado: boolean;
  provisionarAutomaticamente: boolean;
  perfilPadrao: string;
  papelAdmin: string;
  sincronizarPerfil: boolean;
  provedor: string;
  /** SOMENTE TESTES: confia nos cabeçalhos X-MS-CLIENT-PRINCIPAL fora do Azure App Service. */
  confiarCabecalhosForaDoAzure: boolean;
}

export interface OpcoesJwt {
  /** Chave HMAC dos tokens (≥ 32 caracteres; base64 aceito). Vazio: gerada na primeira execução e guardada no banco. */
  segredo: string;
  /** Validade do token de acesso (cookie MESSESSION ou cabeçalho Bearer). */
  acessoMinutos: number;
  /** Idade mínima do refresh token para ser trocado por um novo na renovação (rotação). */
  rotacaoMinutos: number;
  /** Janela em que o refresh token anterior ainda é aceito após a rotação (requisições simultâneas). */
  toleranciaSegundos: number;
  emissor: string;
  audiencia: string;
}

export interface OpcoesAutenticacao {
  /** Validade da sessão sem uso (expiração deslizante do refresh token), como o cookie do .NET. */
  sessaoHoras: number;
  atualizarHashLegado: boolean;
  entraId: OpcoesEntraId;
  jwt: OpcoesJwt;
}

export interface OpcoesServidor {
  limiteRequisicaoMB: number;
  compressaoRespostas: boolean;
  aceitarUploadCompactado: boolean;
  abrirNavegador: boolean;
}

export interface OpcoesRelacional {
  habilitado: boolean;
  atrasoSegundos: number;
  gerarViewsDinamicas: boolean;
  sincronizarTabelasNormalizadas: boolean;
}

export interface OpcoesApi {
  /** Documentação Swagger/OpenAPI em /api/docs. */
  swagger: boolean;
}

export interface OpcoesMonitoramento {
  /** DSN do Sentry (vazio: desligado). A variável padrão SENTRY_DSN também é aceita. */
  sentryDsn: string;
  /** Ambiente informado ao Sentry (ex.: producao, homologacao). Vazio: "azure" no App Service, senão "local". */
  ambiente: string;
  /** Fração das requisições com rastreamento de desempenho (0 a 1). */
  amostragemTraces: number;
}

export interface OpcoesMes {
  banco: OpcoesBanco;
  arquivos: OpcoesArquivos;
  seed: OpcoesSeed;
  autenticacao: OpcoesAutenticacao;
  publicacao: { urlBasePublica: string };
  servidor: OpcoesServidor;
  relacional: OpcoesRelacional;
  api: OpcoesApi;
  monitoramento: OpcoesMonitoramento;
}

export function opcoesPadrao(): OpcoesMes {
  return {
    banco: {
      provedor: 'Auto',
      nomeConexao: 'MesLion',
      aplicarScriptsAutomaticamente: true,
      criarBancoSeNaoExistir: true,
      detectarLocalDb: true,
      nomeBancoLocalDb: 'MesLion',
      timeoutComandoSegundos: 300,
      pastaPortatil: '../Dados/BancoPortatil',
    },
    arquivos: {
      provedor: 'Local',
      pastaLocal: '../Dados/Arquivos',
      azureBlob: {
        connectionString: '',
        contaUrl: '',
        container: 'meslion',
        usarIdentidadeGerenciada: false,
        clientIdIdentidade: '',
      },
    },
    seed: {
      arquivoInicial: '../Dados/MES_LION_DATA.json',
      usuarioAdmin: 'admin',
      senhaAdmin: 'meslion2026',
      nomeAdmin: 'Administrador MES LION',
    },
    autenticacao: {
      sessaoHoras: 12,
      atualizarHashLegado: true,
      entraId: {
        habilitado: false,
        provisionarAutomaticamente: true,
        perfilPadrao: 'USER',
        papelAdmin: 'MES.Admin',
        sincronizarPerfil: true,
        provedor: 'aad',
        confiarCabecalhosForaDoAzure: false,
      },
      jwt: {
        segredo: '',
        acessoMinutos: 15,
        rotacaoMinutos: 60,
        toleranciaSegundos: 60,
        emissor: 'mes-lion',
        audiencia: 'mes-lion-api',
      },
    },
    publicacao: { urlBasePublica: '' },
    servidor: {
      limiteRequisicaoMB: 512,
      compressaoRespostas: true,
      aceitarUploadCompactado: true,
      abrirNavegador: false,
    },
    relacional: {
      habilitado: true,
      atrasoSegundos: 8,
      gerarViewsDinamicas: true,
      sincronizarTabelasNormalizadas: true,
    },
    api: { swagger: true },
    monitoramento: { sentryDsn: '', ambiente: '', amostragemTraces: 0 },
  };
}

/** Configuração completa carregada (appsettings*.json + variáveis de ambiente + linha de comando). */
export interface ConfiguracaoMes {
  /** Pasta de conteúdo: onde estão wwwroot, appsettings.json e sql/. */
  raizConteudo: string;
  opcoes: OpcoesMes;
  connectionStrings: Record<string, string>;
  /** Endereços em que o servidor escuta (ex.: http://127.0.0.1:8765). Vazio: padrão. */
  urls: string[];
  /** Arquivos de configuração efetivamente lidos (para o log de inicialização). */
  arquivosLidos: string[];
}

/** Token de injeção da configuração. */
export const CONFIGURACAO = Symbol('CONFIGURACAO_MES');
