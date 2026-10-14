// =====================================================================
// Connection string do SQL Server / Azure SQL no formato ADO.NET (a mesma do servidor .NET e do
// CONFIGURAR_BANCO.bat) → configuração do driver mssql/tedious usado pelo Prisma.
// Suporta usuário/senha SQL e Microsoft Entra ID (identidade gerenciada, padrão do Azure, service principal).
// Não suportado pelo driver do Node: autenticação integrada do Windows e LocalDB (named pipes).
// =====================================================================
import type { config as ConfigMssql } from 'mssql';
import { ConfiguracaoError } from '../../../dominio/erros';

const SINONIMOS: Record<string, string> = {
  'data source': 'server',
  server: 'server',
  address: 'server',
  addr: 'server',
  'network address': 'server',
  'initial catalog': 'database',
  database: 'database',
  'user id': 'user',
  uid: 'user',
  user: 'user',
  username: 'user',
  'user name': 'user',
  password: 'password',
  pwd: 'password',
  'integrated security': 'integrated',
  trusted_connection: 'integrated',
  encrypt: 'encrypt',
  trustservercertificate: 'trust',
  'trust server certificate': 'trust',
  'connect timeout': 'connecttimeout',
  'connection timeout': 'connecttimeout',
  timeout: 'connecttimeout',
  'command timeout': 'commandtimeout',
  authentication: 'authentication',
  'application name': 'appname',
  app: 'appname',
  'max pool size': 'maxpool',
  'min pool size': 'minpool',
  multisubnetfailover: 'multisubnet',
  'multi subnet failover': 'multisubnet',
  applicationintent: 'intent',
  'application intent': 'intent',
  'tenant id': 'tenant',
  tenantid: 'tenant',
};

/** Divide "chave=valor;chave2='valor;com;ponto-e-vírgula'" (aspas simples, duplas ou chaves). */
export function dividirConnectionString(cs: string): Map<string, string> {
  const r = new Map<string, string>();
  let i = 0;
  const n = cs.length;
  while (i < n) {
    while (i < n && (cs[i] === ';' || /\s/.test(cs[i]))) i++;
    if (i >= n) break;
    let chave = '';
    while (i < n && cs[i] !== '=') {
      if (cs[i] === ';') break;
      chave += cs[i++];
    }
    if (i >= n || cs[i] !== '=') {
      if (chave.trim()) throw new ConfiguracaoError(`Connection string inválida perto de "${chave.trim()}".`);
      i++;
      continue;
    }
    i++; // '='
    while (i < n && (cs[i] === ' ' || cs[i] === '\t')) i++;
    let valor = '';
    const abre = cs[i];
    if (abre === '"' || abre === "'" || abre === '{') {
      const fecha = abre === '{' ? '}' : abre;
      i++;
      for (;;) {
        if (i >= n)
          throw new ConfiguracaoError(`Connection string inválida: valor de "${chave.trim()}" sem fechamento.`);
        if (cs[i] === fecha) {
          if (cs[i + 1] === fecha) {
            valor += fecha;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        valor += cs[i++];
      }
      while (i < n && cs[i] !== ';') i++;
    } else {
      while (i < n && cs[i] !== ';') valor += cs[i++];
      valor = valor.trim();
    }
    r.set(chave.trim().toLowerCase().replace(/\s+/g, ' '), valor);
  }
  return r;
}

const verdadeiro = (v: string | undefined) =>
  ['true', 'yes', 'sim', 'sspi', 'mandatory', 'strict', '1'].includes((v ?? '').trim().toLowerCase());

export interface InformacoesConexao {
  config: ConfigMssql;
  servidor: string;
  banco: string;
  azureSql: boolean;
  avisos: string[];
}

/** Converte a connection string ADO.NET (ou a URL sqlserver:// do Prisma) para a configuração do mssql. */
export function converterConnectionString(
  cs: string,
  timeoutComandoSegundos: number,
  ambiente: NodeJS.ProcessEnv = process.env,
): InformacoesConexao {
  if (/^\s*sqlserver:\/\//i.test(cs)) return converterUrlPrisma(cs, timeoutComandoSegundos);
  const bruto = dividirConnectionString(cs);
  const p = new Map<string, string>();
  for (const [k, v] of bruto) p.set(SINONIMOS[k] ?? k, v);
  const avisos: string[] = [];

  let servidor = (p.get('server') ?? '').trim();
  if (!servidor) throw new ConfiguracaoError('Connection string sem o servidor (Server=...).');
  const servidorOriginal = servidor;
  if (/^np:|^lpc:|^\(localdb\)/i.test(servidor)) {
    throw new ConfiguracaoError(
      `O servidor "${servidor}" usa named pipes/LocalDB, que o driver SQL do Node.js (tedious) não suporta. ` +
        'Use um SQL Server com TCP (ex.: Server=localhost,1433) ou o modo Portátil; o executável .NET continua atendendo o LocalDB.',
    );
  }
  servidor = servidor.replace(/^tcp:/i, '');
  let porta: number | undefined;
  let instancia: string | undefined;
  const virgula = servidor.lastIndexOf(',');
  if (virgula >= 0) {
    porta = Number(servidor.slice(virgula + 1).trim());
    if (!Number.isInteger(porta) || porta <= 0)
      throw new ConfiguracaoError(`Porta inválida no servidor "${servidorOriginal}".`);
    servidor = servidor.slice(0, virgula).trim();
  }
  const barra = servidor.indexOf('\\');
  if (barra >= 0) {
    instancia = servidor.slice(barra + 1).trim() || undefined;
    servidor = servidor.slice(0, barra).trim();
  }
  if (servidor === '.' || servidor.toLowerCase() === '(local)') servidor = 'localhost';

  const banco = (p.get('database') ?? '').trim();
  const azureSql = /\.database\.windows\.net$|\.database\.azure\.com$/i.test(servidor);
  const encryptTexto = (p.get('encrypt') ?? 'true').trim().toLowerCase();
  const encrypt: boolean | 'strict' =
    encryptTexto === 'strict' ? 'strict' : verdadeiro(encryptTexto) || encryptTexto === '';

  const config: ConfigMssql = {
    server: servidor,
    database: banco || undefined,
    port: porta,
    connectionTimeout: Math.max(1, Number(p.get('connecttimeout') ?? 30) || 30) * 1000,
    requestTimeout:
      Math.max(1, Number(p.get('commandtimeout') ?? timeoutComandoSegundos) || timeoutComandoSegundos) * 1000,
    pool: {
      max: Number(p.get('maxpool') ?? 10) || 10,
      min: Number(p.get('minpool') ?? 0) || 0,
      idleTimeoutMillis: 30_000,
    },
    options: {
      encrypt: encrypt as boolean,
      trustServerCertificate: verdadeiro(p.get('trust')),
      appName: p.get('appname') || 'MES LION API',
      instanceName: porta === undefined ? instancia : undefined,
      multiSubnetFailover: verdadeiro(p.get('multisubnet')),
      readOnlyIntent: (p.get('intent') ?? '').toLowerCase() === 'readonly',
      useUTC: true,
      enableArithAbort: true,
    },
  };

  if (verdadeiro(p.get('integrated'))) {
    throw new ConfiguracaoError(
      'Autenticação integrada do Windows (Integrated Security) não é suportada pelo driver SQL do Node.js. ' +
        'Use usuário/senha SQL (User ID/Password) ou Microsoft Entra ID (Authentication=Active Directory Default ou Managed Identity).',
    );
  }

  const usuario = p.get('user') ?? '';
  const senha = p.get('password') ?? '';
  const autenticacao = (p.get('authentication') ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const tenant = p.get('tenant') || ambiente.AZURE_TENANT_ID || '';
  switch (autenticacao) {
    case '':
    case 'sql password':
    case 'sqlpassword':
      config.authentication = { type: 'default', options: { userName: usuario, password: senha } };
      break;
    case 'active directory managed identity':
    case 'active directory msi':
    case 'activedirectorymanagedidentity':
    case 'activedirectorymsi':
      config.authentication = ambiente.IDENTITY_ENDPOINT
        ? { type: 'azure-active-directory-msi-app-service', options: { clientId: usuario || undefined } }
        : { type: 'azure-active-directory-msi-vm', options: { clientId: usuario || undefined } };
      break;
    case 'active directory service principal':
    case 'activedirectoryserviceprincipal':
      if (!usuario || !senha || !tenant) {
        throw new ConfiguracaoError(
          'Authentication=Active Directory Service Principal exige User ID (client id), Password (segredo) e Tenant Id (ou AZURE_TENANT_ID).',
        );
      }
      config.authentication = {
        type: 'azure-active-directory-service-principal-secret',
        options: { clientId: usuario, clientSecret: senha, tenantId: tenant },
      };
      break;
    case 'active directory default':
    case 'activedirectorydefault':
    case 'active directory workload identity':
    case 'active directory interactive':
    case 'active directory integrated':
    case 'active directory device code flow':
    case 'active directory password':
      if (autenticacao !== 'active directory default' && autenticacao !== 'activedirectorydefault') {
        avisos.push(
          `Authentication=${p.get('authentication')} não é suportado pelo driver do Node.js; usando "Active Directory Default" ` +
            '(identidade gerenciada no Azure, ou az login/variáveis AZURE_* em desenvolvimento).',
        );
      }
      config.authentication = { type: 'azure-active-directory-default', options: { clientId: usuario || undefined } };
      break;
    default:
      throw new ConfiguracaoError(`Authentication="${p.get('authentication')}" não suportado.`);
  }
  return { config, servidor: servidorOriginal, banco, azureSql, avisos };
}

/** URL no formato do Prisma (sqlserver://host:porta;database=...;user=...;password=...). */
function converterUrlPrisma(url: string, timeoutComandoSegundos: number): InformacoesConexao {
  const semPrefixo = url.trim().replace(/^sqlserver:\/\//i, '');
  const [hostPorta, ...resto] = semPrefixo.split(';');
  const [host, porta] = hostPorta.split(':');
  const ado = [`Server=${host}${porta ? ',' + porta : ''}`, ...resto.filter(Boolean)].join(';');
  return converterConnectionString(
    ado.replace(/(^|;)\s*trustServerCertificate=/i, '$1TrustServerCertificate='),
    timeoutComandoSegundos,
  );
}

// Erros transitórios documentados para Azure SQL / SQL Server (os mesmos do servidor .NET).
const ERROS_TRANSITORIOS = new Set([
  -2, 20, 64, 233, 1205, 4060, 4221, 10053, 10054, 10060, 10928, 10929, 11001, 40143, 40197, 40501, 40540, 40613, 41301,
  41302, 41305, 41325, 41839, 42108, 42109, 49918, 49919, 49920,
]);
const CODIGOS_TRANSITORIOS = new Set(['ETIMEOUT', 'ESOCKET', 'ECONNRESET', 'ECONNCLOSED', 'ECONNREFUSED', 'ENOTOPEN']);

/** Campos que os erros do driver mssql/tedious e do Prisma podem ter. */
interface ErroDriver {
  number?: unknown;
  code?: unknown;
  message?: unknown;
  meta?: { code?: unknown; driverAdapterError?: { cause?: { code?: unknown } } };
  cause?: unknown;
  originalError?: unknown;
  precedingErrors?: unknown;
}

/** O erro e os erros embrulhados nele (cause, originalError, precedingErrors[0]), até 6 níveis. */
function* cadeiaDeErros(e: unknown): Generator<ErroDriver> {
  let atual: unknown = e;
  for (let i = 0; typeof atual === 'object' && atual !== null && i < 6; i++) {
    const x = atual as ErroDriver;
    yield x;
    atual =
      x.cause ??
      x.originalError ??
      (Array.isArray(x.precedingErrors) ? (x.precedingErrors as unknown[])[0] : undefined);
  }
}

/** Número do erro do SQL Server (direto do driver ou embrulhado pelo Prisma). */
export function numeroErroSql(e: unknown): number | null {
  for (const x of cadeiaDeErros(e)) {
    if (typeof x.number === 'number') return x.number;
    const codigo = x.meta?.code ?? x.meta?.driverAdapterError?.cause?.code;
    if (typeof codigo === 'number') return codigo;
    if (typeof codigo === 'string' && /^\d+$/.test(codigo)) return Number(codigo);
  }
  const mensagem = typeof (e as ErroDriver)?.message === 'string' ? ((e as ErroDriver).message as string) : '';
  const m = /\b(?:error|erro)\s*(?:number|n[ºo°])?\s*[:=]?\s*(\d{3,5})\b/i.exec(mensagem);
  return m ? Number(m[1]) : null;
}

export function ehErroTransitorio(e: unknown): boolean {
  const n = numeroErroSql(e);
  if (n !== null && ERROS_TRANSITORIOS.has(n)) return true;
  for (const x of cadeiaDeErros(e)) {
    if (typeof x.code === 'string' && CODIGOS_TRANSITORIOS.has(x.code)) return true;
  }
  return false;
}

/** Violação de chave única (SQL Server 2627/2601; Prisma P2002). */
export function ehViolacaoUnicidade(e: unknown): boolean {
  if ((e as { code?: string })?.code === 'P2002') return true;
  const n = numeroErroSql(e);
  return n === 2627 || n === 2601;
}
