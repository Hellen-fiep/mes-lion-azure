// =====================================================================
// Carga da configuração com as mesmas fontes e prioridades do ASP.NET Core:
//   appsettings.json < appsettings.Local.json < variáveis de ambiente < linha de comando.
// Chaves sem diferença de maiúsculas/minúsculas; "__" separa seções nas variáveis de ambiente
// (MesLion__Banco__Provedor, ConnectionStrings__MesLion) e ":" na linha de comando.
// Connection strings do Azure App Service (SQLAZURECONNSTR_*, SQLCONNSTR_*, CUSTOMCONNSTR_*) também valem.
// =====================================================================
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { comoTexto } from '../comum/formatos';
import { ConfiguracaoError } from '../dominio/erros';
import { type ConfiguracaoMes, type OpcoesMes, opcoesPadrao } from './opcoes';

type No = Map<string, No | string>;

const PREFIXOS_CONEXAO = ['SQLAZURECONNSTR_', 'SQLCONNSTR_', 'MYSQLCONNSTR_', 'POSTGRESQLCONNSTR_', 'CUSTOMCONNSTR_'];

function definir(raiz: No, caminho: string[], valor: string): void {
  let no = raiz;
  for (let i = 0; i < caminho.length - 1; i++) {
    const k = caminho[i].toLowerCase();
    let filho = no.get(k);
    if (!(filho instanceof Map)) {
      filho = new Map();
      no.set(k, filho);
    }
    no = filho;
  }
  no.set(caminho[caminho.length - 1].toLowerCase(), valor);
}

function mesclarJson(raiz: No, valor: unknown, caminho: string[] = []): void {
  if (Array.isArray(valor)) valor.forEach((v, i) => mesclarJson(raiz, v, [...caminho, String(i)]));
  else if (typeof valor === 'object' && valor !== null) {
    for (const [k, v] of Object.entries(valor)) mesclarJson(raiz, v, [...caminho, k]);
  } else if (caminho.length > 0) definir(raiz, caminho, comoTexto(valor));
}

function lerArquivoJson(arquivo: string): unknown {
  let texto = readFileSync(arquivo, 'utf8');
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  // O ASP.NET aceita comentários e vírgulas sobrando no appsettings.json.
  const semComentarios = texto.replace(
    /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_m, str: string | undefined) => str ?? '',
  );
  const semVirgulas = semComentarios.replace(
    /("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g,
    (_m, str: string | undefined, fecha: string | undefined) => str ?? fecha ?? '',
  );
  try {
    return JSON.parse(semVirgulas) as unknown;
  } catch (e) {
    throw new ConfiguracaoError(`Arquivo de configuração inválido (${arquivo}): ${(e as Error).message}`);
  }
}

/** Variáveis de ambiente → árvore de configuração (como o EnvironmentVariablesConfigurationProvider). */
export function mesclarAmbiente(raiz: No, ambiente: NodeJS.ProcessEnv): void {
  for (const [nome, valor] of Object.entries(ambiente)) {
    if (valor === undefined) continue;
    const prefixo = PREFIXOS_CONEXAO.find((p) => nome.toUpperCase().startsWith(p));
    if (prefixo) {
      definir(raiz, ['ConnectionStrings', nome.slice(prefixo.length)], valor);
      continue;
    }
    definir(raiz, nome.split('__'), valor);
  }
}

/** Argumentos de configuração da linha de comando: --chave=valor, --chave valor, /chave=valor, chave=valor. */
export function mesclarArgumentos(raiz: No, args: string[]): void {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let chave: string;
    let valor: string | undefined;
    const prefixo = a.startsWith('--') ? 2 : a.startsWith('/') || a.startsWith('-') ? 1 : 0;
    const corpo = a.slice(prefixo);
    const igual = corpo.indexOf('=');
    if (igual >= 0) {
      chave = corpo.slice(0, igual);
      valor = corpo.slice(igual + 1);
    } else if (prefixo > 0 && i + 1 < args.length) {
      chave = corpo;
      valor = args[++i];
    } else continue;
    if (!chave) continue;
    definir(raiz, chave.split(/:|__/), valor);
  }
}

function filho(no: No | undefined, chave: string): No | string | undefined {
  return no?.get(chave.toLowerCase());
}

function converter(valor: string, padrao: unknown, caminho: string): unknown {
  if (typeof padrao === 'boolean') {
    const v = valor.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes' || v === 'sim') return true;
    if (v === 'false' || v === '0' || v === 'no' || v === 'nao' || v === 'não' || v === '') return false;
    throw new ConfiguracaoError(`Configuração ${caminho}: valor lógico inválido "${valor}" (use true ou false).`);
  }
  if (typeof padrao === 'number') {
    const n = Number(valor.trim());
    if (valor.trim() === '' || !Number.isFinite(n))
      throw new ConfiguracaoError(`Configuração ${caminho}: número inválido "${valor}".`);
    return n;
  }
  return valor;
}

/** Preenche um objeto de opções (com os padrões) a partir da árvore, sem diferenciar maiúsculas. */
function vincular<T extends object>(padrao: T, no: No | undefined, caminho: string): T {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(padrao)) {
    const nomeSecao = k.charAt(0).toUpperCase() + k.slice(1);
    const f = filho(no, k);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      r[k] = vincular(v as object, f instanceof Map ? f : undefined, `${caminho}:${nomeSecao}`);
    } else {
      r[k] = typeof f === 'string' ? converter(f, v, `${caminho}:${nomeSecao}`) : v;
    }
  }
  return r as T;
}

/** Pasta do frontend: <raiz>/wwwroot (pacote) ou, em desenvolvimento, o wwwroot do servidor .NET no repositório. */
export function pastaFrontend(raizConteudo: string): string {
  const candidatas = [
    path.join(raizConteudo, 'wwwroot'),
    path.resolve(__dirname, '..', '..', '..', '..', 'src', 'MesLion.Server', 'wwwroot'),
  ];
  return candidatas.find((p) => existsSync(p)) ?? candidatas[0];
}

export function resolverRaizConteudo(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'wwwroot'))) return cwd;
  // dist/configuracao/carregar-configuracao.js → pasta do aplicativo (onde estão dist/, wwwroot/, sql/)
  return path.resolve(__dirname, '..', '..');
}

export interface ArgumentosConfiguracao {
  raizConteudo?: string;
  args?: string[];
  ambiente?: NodeJS.ProcessEnv;
}

export function carregarConfiguracao(p: ArgumentosConfiguracao = {}): ConfiguracaoMes {
  const raizConteudo = p.raizConteudo ?? resolverRaizConteudo();
  const ambiente = p.ambiente ?? process.env;
  const raiz: No = new Map();
  const arquivosLidos: string[] = [];
  for (const nome of ['appsettings.json', 'appsettings.Local.json']) {
    const arquivo = path.join(raizConteudo, nome);
    if (existsSync(arquivo)) {
      mesclarJson(raiz, lerArquivoJson(arquivo));
      arquivosLidos.push(arquivo);
    }
  }
  mesclarAmbiente(raiz, ambiente);
  mesclarArgumentos(raiz, p.args ?? []);

  const secaoMes = filho(raiz, 'MesLion');
  const opcoes: OpcoesMes = vincular(opcoesPadrao(), secaoMes instanceof Map ? secaoMes : undefined, 'MesLion');

  const connectionStrings: Record<string, string> = {};
  const secaoConexoes = filho(raiz, 'ConnectionStrings');
  if (secaoConexoes instanceof Map) {
    for (const [k, v] of secaoConexoes) if (typeof v === 'string') connectionStrings[k] = v;
  }

  const urls: string[] = [];
  const urlsConfig = filho(raiz, 'urls');
  const fonteUrls =
    (typeof urlsConfig === 'string' && urlsConfig) ||
    ambiente.ASPNETCORE_URLS ||
    (ambiente.ASPNETCORE_HTTP_PORTS
      ? ambiente.ASPNETCORE_HTTP_PORTS.split(/[;,]/)
          .map((pt) => `http://0.0.0.0:${pt.trim()}`)
          .join(';')
      : '') ||
    (ambiente.PORT ? `http://0.0.0.0:${ambiente.PORT}` : '');
  if (fonteUrls)
    urls.push(
      ...fonteUrls
        .split(';')
        .map((u) => u.trim())
        .filter(Boolean),
    );

  return { raizConteudo, opcoes, connectionStrings, urls, arquivosLidos };
}

/** Connection string pelo nome (sem diferenciar maiúsculas), como IConfiguration.GetConnectionString. */
export function obterConnectionString(cfg: ConfiguracaoMes, nome: string): string {
  return cfg.connectionStrings[nome.toLowerCase()] ?? '';
}

export const noAzureAppService = (ambiente: NodeJS.ProcessEnv = process.env) => !!ambiente.WEBSITE_SITE_NAME;

/** %VARIAVEL% → valor (Environment.ExpandEnvironmentVariables). */
export function expandirVariaveis(texto: string, ambiente: NodeJS.ProcessEnv = process.env): string {
  return texto.replace(/%([^%]+)%/g, (m, nome: string) => ambiente[nome] ?? m);
}

/** Caminho configurado → absoluto (relativo à pasta de conteúdo), como o Inicializacao.ResolverCaminho. */
export function resolverCaminho(raizConteudo: string, caminho: string): string {
  if (!caminho || !caminho.trim()) return raizConteudo;
  const expandido = expandirVariaveis(caminho);
  return path.resolve(path.isAbsolute(expandido) ? expandido : path.join(raizConteudo, expandido));
}

/** Pasta persistente: no Azure App Service, caminhos relativos vão para %HOME%/data/MesLion/<subpasta>. */
export function resolverPastaDados(raizConteudo: string, caminhoConfigurado: string, subpasta: string): string {
  if (noAzureAppService() && !path.isAbsolute(expandirVariaveis(caminhoConfigurado))) {
    return path.join(process.env.HOME ?? raizConteudo, 'data', 'MesLion', subpasta);
  }
  return resolverCaminho(raizConteudo, caminhoConfigurado);
}
