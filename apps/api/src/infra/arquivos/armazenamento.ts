// =====================================================================
// Armazenamento de arquivos (documentos, anexos, passaportes, backups): pasta local ou Azure Blob Storage.
// Mesmas chaves do servidor .NET (documentos/<id>.pdf, anexos/<id>/<nome>, passaportes/<id>.html,
// backups/<arquivo>.json.gz), então os arquivos já gravados continuam acessíveis.
// =====================================================================
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { BlobServiceClient, ContainerClient } from '@azure/storage-blob';

// Carregados só quando o Azure Blob é usado (o modo local não paga o tempo de carga dos SDKs).
/* eslint-disable @typescript-eslint/no-require-imports */
const sdkBlob = () => require('@azure/storage-blob') as typeof import('@azure/storage-blob');
const sdkIdentidade = () => require('@azure/identity') as typeof import('@azure/identity');
/* eslint-enable @typescript-eslint/no-require-imports */

export interface ArquivoLido {
  conteudo: Readable;
  tamanho: number | null;
  tipoConteudo: string | null;
}

export interface ArmazenamentoArquivos {
  readonly descricao: string;
  /** Pasta raiz (somente armazenamento local). */
  readonly raizLocal: string | null;
  inicializar(): Promise<void>;
  salvar(chave: string, conteudo: Buffer | Readable, tipoConteudo: string | null): Promise<void>;
  abrir(chave: string): Promise<ArquivoLido | null>;
  existe(chave: string): Promise<boolean>;
}

export const ARMAZENAMENTO_ARQUIVOS = Symbol('ARMAZENAMENTO_ARQUIVOS');

/** Normaliza e valida uma chave relativa ("pasta/arquivo.ext"). */
export function normalizarChave(chave: string): string {
  const partes = chave.replace(/\\/g, '/').split('/').filter(Boolean);
  if (partes.length === 0 || partes.some((p) => p === '.' || p === '..' || p.includes(':'))) {
    throw new Error('Chave de arquivo inválida: ' + chave);
  }
  return partes.join('/');
}

/** Nome de arquivo seguro (mesma regra do frontend v4047FileNameSafe e do servidor .NET). */
export function nomeSeguro(nome: string | null | undefined, padrao = 'arquivo'): string {
  const s = !nome || !nome.trim() ? padrao : nome;
  let r = Array.from(s, (ch) => (ch.length === 1 && (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch)) ? '_' : ch))
    .join('')
    .trim();
  if (r.length > 120) r = r.slice(0, 120);
  return !r.trim() || r === '.' || r === '..' ? padrao : r;
}

/** Arquivos em pasta local (PC/servidor) ou no armazenamento persistente do App Service (%HOME%). */
export class ArmazenamentoLocal implements ArmazenamentoArquivos {
  readonly raizLocal: string;

  constructor(raiz: string) {
    this.raizLocal = path.resolve(raiz);
  }

  get descricao(): string {
    return 'Pasta local: ' + this.raizLocal;
  }

  async inicializar(): Promise<void> {
    await fs.mkdir(this.raizLocal, { recursive: true });
  }

  private caminho(chave: string): string {
    const c = path.resolve(this.raizLocal, ...normalizarChave(chave).split('/'));
    if (!c.startsWith(this.raizLocal + path.sep)) throw new Error('Chave de arquivo fora da pasta de dados.');
    return c;
  }

  async salvar(chave: string, conteudo: Buffer | Readable): Promise<void> {
    const destino = this.caminho(chave);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    const tmp = `${destino}.${randomUUID().replace(/-/g, '')}.tmp`;
    try {
      if (Buffer.isBuffer(conteudo)) await fs.writeFile(tmp, conteudo, { flag: 'wx' });
      else {
        const arquivo = await fs.open(tmp, 'wx');
        await pipeline(conteudo, arquivo.createWriteStream());
      }
      await fs.rename(tmp, destino);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }

  async abrir(chave: string): Promise<ArquivoLido | null> {
    const c = this.caminho(chave);
    try {
      const st = await fs.stat(c);
      if (!st.isFile()) return null;
      return { conteudo: createReadStream(c), tamanho: st.size, tipoConteudo: null };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async existe(chave: string): Promise<boolean> {
    try {
      return (await fs.stat(this.caminho(chave))).isFile();
    } catch {
      return false;
    }
  }
}

export interface OpcoesBlob {
  connectionString: string;
  contaUrl: string;
  container: string;
  usarIdentidadeGerenciada: boolean;
  clientIdIdentidade: string;
}

/** Azure Blob Storage (SDK oficial): chave da conta (connection string) ou identidade gerenciada / Entra ID. */
export class ArmazenamentoAzureBlob implements ArmazenamentoArquivos {
  readonly raizLocal = null;
  private readonly containerNome: string;
  private cliente: ContainerClient | null = null;
  private urlConta = '';

  constructor(private readonly o: OpcoesBlob) {
    this.containerNome = (o.container || 'meslion').trim().toLowerCase();
    if (!o.connectionString?.trim() && !o.contaUrl?.trim()) {
      throw new Error('Azure Blob: informe MesLion:Arquivos:AzureBlob:ConnectionString ou ContaUrl.');
    }
  }

  get descricao(): string {
    const id = !this.o.connectionString?.trim() || this.o.usarIdentidadeGerenciada ? ' (identidade gerenciada)' : '';
    if (!this.urlConta) {
      try {
        this.container(); // só monta o cliente (sem acesso à rede) para mostrar a URL da conta
      } catch {
        // configuração inválida: o erro aparece ao inicializar
      }
    }
    return `Azure Blob Storage: ${this.urlConta || this.o.contaUrl || 'conta'}/${this.containerNome}${id}`;
  }

  private container(): ContainerClient {
    if (this.cliente) return this.cliente;
    const blob = sdkBlob();
    let servico: BlobServiceClient;
    if (this.o.connectionString?.trim() && !this.o.usarIdentidadeGerenciada) {
      servico = blob.BlobServiceClient.fromConnectionString(this.o.connectionString.trim());
    } else {
      const identidade = sdkIdentidade();
      const url = (this.o.contaUrl || '').trim().replace(/\/+$/, '');
      if (!url) throw new Error('Azure Blob com identidade gerenciada: informe MesLion:Arquivos:AzureBlob:ContaUrl.');
      const credencial = this.o.clientIdIdentidade?.trim()
        ? new identidade.ManagedIdentityCredential({ clientId: this.o.clientIdIdentidade.trim() })
        : new identidade.DefaultAzureCredential();
      servico = new blob.BlobServiceClient(url, credencial);
    }
    this.urlConta = servico.url.replace(/\/+$/, '');
    this.cliente = servico.getContainerClient(this.containerNome);
    return this.cliente;
  }

  async inicializar(): Promise<void> {
    await this.container().createIfNotExists();
  }

  async salvar(chave: string, conteudo: Buffer | Readable, tipoConteudo: string | null): Promise<void> {
    const b = this.container().getBlockBlobClient(normalizarChave(chave));
    const cabecalhos = { blobHTTPHeaders: { blobContentType: tipoConteudo || 'application/octet-stream' } };
    if (Buffer.isBuffer(conteudo)) await b.uploadData(conteudo, cabecalhos);
    else await b.uploadStream(conteudo, 4 * 1024 * 1024, 4, cabecalhos);
  }

  async abrir(chave: string): Promise<ArquivoLido | null> {
    const b = this.container().getBlobClient(normalizarChave(chave));
    try {
      const r = await b.download();
      return {
        conteudo: r.readableStreamBody as Readable,
        tamanho: r.contentLength ?? null,
        tipoConteudo: r.contentType ?? null,
      };
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return null;
      throw e;
    }
  }

  async existe(chave: string): Promise<boolean> {
    return this.container().getBlobClient(normalizarChave(chave)).exists();
  }
}
