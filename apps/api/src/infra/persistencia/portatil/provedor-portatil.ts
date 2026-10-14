// =====================================================================
// Persistência PORTÁTIL (arquivos JSON em disco) — para validação em PCs sem SQL Server.
// Mesmo formato de arquivos do servidor .NET (Persistencia/Portatil/ProvedorPortatil.cs: propriedades
// em PascalCase, datas ISO 8601): os dois servidores podem usar a mesma pasta Dados/BancoPortatil.
// Gravações atômicas (arquivo temporário + troca) e uma operação de escrita por vez.
// =====================================================================
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { comoTexto, dataIso } from '../../../comum/formatos';
import { hex } from '../../../comum/json-estado';
import { Trava, esperar } from '../../../comum/trava';
import type {
  Anexo,
  BackupEstado,
  ColecaoArmazenada,
  ColecaoRecebida,
  DocumentoEquipamento,
  PassaportePublicado,
  RegistroAuditoria,
  ResultadoGravacaoEstado,
  ResumoEstado,
  SessaoAutenticacao,
  Usuario,
} from '../../../dominio/entidades';
import type {
  ProvedorPersistencia,
  RepositorioAnexos,
  RepositorioAuditoria,
  RepositorioBackups,
  RepositorioDocumentos,
  RepositorioEstado,
  RepositorioKv,
  RepositorioPassaportes,
  RepositorioSegredos,
  RepositorioSessoes,
  RepositorioUsuarios,
} from '../../../dominio/repositorios';

type Json = Record<string, unknown>;

const data = (v: unknown): Date => (typeof v === 'string' && v ? new Date(v) : new Date(0));
const dataOuNulo = (v: unknown): Date | null => (typeof v === 'string' && v ? new Date(v) : null);
const texto = (v: unknown): string => comoTexto(v);
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : comoTexto(v));
const numero = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const guid = (v: unknown): string | null => (typeof v === 'string' && v ? v.toLowerCase() : null);

export async function gravarAtomico(caminho: string, conteudo: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(caminho), { recursive: true });
  const tmp = `${caminho}.${randomUUID().replace(/-/g, '')}.tmp`;
  const arquivo = await fs.open(tmp, 'wx');
  try {
    await arquivo.writeFile(conteudo);
    await arquivo.sync();
  } finally {
    await arquivo.close();
  }
  for (let tentativa = 1; ; tentativa++) {
    try {
      await fs.rename(tmp, caminho);
      return;
    } catch (e) {
      // Windows: antivírus/indexador pode segurar o arquivo de destino por alguns milissegundos.
      const codigo = (e as NodeJS.ErrnoException).code;
      if (tentativa >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(codigo ?? '')) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw e;
      }
      await esperar(50 * tentativa);
    }
  }
}

export class ContextoPortatil {
  readonly trava = new Trava();
  constructor(readonly raiz: string) {}

  caminho(...partes: string[]): string {
    return path.join(this.raiz, ...partes);
  }

  async ler<T>(arquivo: string, padrao: () => T): Promise<T> {
    let conteudo: string;
    try {
      conteudo = await fs.readFile(this.caminho(arquivo), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return padrao();
      throw e;
    }
    if (conteudo.charCodeAt(0) === 0xfeff) conteudo = conteudo.slice(1);
    if (!conteudo.trim()) return padrao();
    return (JSON.parse(conteudo) as T) ?? padrao();
  }

  salvar(arquivo: string, valor: unknown): Promise<void> {
    return gravarAtomico(this.caminho(arquivo), JSON.stringify(valor, null, 2));
  }
}

// --------------------------------------------------------------------- estado
interface ItemIndice {
  Nome: string;
  Ordem: number;
  Hash: string;
  Arquivo: string;
  Bytes: number;
  Itens: number | null;
  AtualizadoEm: string;
}

interface IndiceEstado {
  Versao: number;
  AtualizadoEm: string | null;
  AtualizadoPor: string | null;
  Colecoes: ItemIndice[];
}

const ARQUIVO_INDICE = 'estado/indice.json';

class EstadoPortatil implements RepositorioEstado {
  constructor(private readonly ctx: ContextoPortatil) {}

  private lerIndice(): Promise<IndiceEstado> {
    return this.ctx.ler<IndiceEstado>(ARQUIVO_INDICE, () => ({
      Versao: 0,
      AtualizadoEm: null,
      AtualizadoPor: null,
      Colecoes: [],
    }));
  }

  async obterVersao(): Promise<number> {
    return numero((await this.lerIndice()).Versao);
  }

  carregar(): Promise<{ versao: number; colecoes: ColecaoArmazenada[] }> {
    return this.ctx.trava.executar(async () => {
      const idx = await this.lerIndice();
      const colecoes: ColecaoArmazenada[] = [];
      for (const c of idx.Colecoes ?? []) {
        const conteudo = await fs.readFile(this.ctx.caminho('estado', c.Arquivo));
        colecoes.push({ nome: c.Nome, ordem: numero(c.Ordem), conteudo, hash: Buffer.from(c.Hash, 'hex') });
      }
      return { versao: numero(idx.Versao), colecoes };
    });
  }

  gravar(colecoes: ColecaoRecebida[], usuario: Usuario | null): Promise<ResultadoGravacaoEstado> {
    return this.ctx.trava.executar(async () => {
      const idx = await this.lerIndice();
      const atuais = new Map((idx.Colecoes ?? []).map((c) => [c.Nome, c]));
      const alteradas: string[] = [];
      let bytes = 0;
      const novo: ItemIndice[] = [];
      const agora = dataIso(new Date());
      for (const c of colecoes) {
        const hash = hex(c.hash);
        const existente = atuais.get(c.nome);
        if (existente && existente.Hash.toLowerCase() === hash) {
          existente.Ordem = c.ordem;
          novo.push(existente);
          continue;
        }
        const prefixoNome = createHash('sha1').update(c.nome, 'utf8').digest('hex').slice(0, 16);
        const arquivo = `c_${prefixoNome}_${hash.slice(0, 16)}.json`;
        await gravarAtomico(this.ctx.caminho('estado', arquivo), c.conteudo);
        novo.push({
          Nome: c.nome,
          Ordem: c.ordem,
          Hash: hash,
          Arquivo: arquivo,
          Bytes: c.conteudo.length,
          Itens: c.itens,
          AtualizadoEm: agora,
        });
        alteradas.push(c.nome);
        bytes += c.conteudo.length;
      }
      const nomesNovos = new Set(colecoes.map((c) => c.nome));
      const removidas = (idx.Colecoes ?? []).filter((c) => !nomesNovos.has(c.Nome)).map((c) => c.Nome);

      idx.Versao = numero(idx.Versao) + 1;
      idx.AtualizadoEm = agora;
      idx.AtualizadoPor = usuario?.username ?? null;
      idx.Colecoes = novo;
      await this.ctx.salvar(ARQUIVO_INDICE, idx);

      // Limpeza dos arquivos não referenciados (depois de o índice novo estar gravado).
      const referenciados = new Set(novo.map((c) => c.Arquivo.toLowerCase()));
      const pasta = this.ctx.caminho('estado');
      for (const nome of await fs.readdir(pasta)) {
        if (/^c_.*\.json$/i.test(nome) && !referenciados.has(nome.toLowerCase())) {
          await fs.rm(path.join(pasta, nome), { force: true }).catch(() => undefined); // em uso: fica para a próxima
        }
      }
      return { versao: idx.Versao, alteradas, removidas, bytesGravados: bytes };
    });
  }

  async resumo(): Promise<ResumoEstado> {
    const idx = await this.lerIndice();
    const colecoes = idx.Colecoes ?? [];
    return {
      versao: numero(idx.Versao),
      colecoes: colecoes.length,
      bytes: colecoes.reduce((s, c) => s + numero(c.Bytes), 0),
      atualizadoEm: dataOuNulo(idx.AtualizadoEm),
      atualizadoPor: idx.AtualizadoPor ?? null,
    };
  }
}

// --------------------------------------------------------------------- app_storage (localStorage)
class KvPortatil implements RepositorioKv {
  private static readonly ARQUIVO = 'app_storage.json';
  constructor(private readonly ctx: ContextoPortatil) {}

  private async lerMapa(): Promise<Map<string, string>> {
    const o = await this.ctx.ler<Json>(KvPortatil.ARQUIVO, () => ({}));
    return new Map(Object.entries(o).map(([k, v]) => [k, texto(v)]));
  }

  private salvarMapa(m: Map<string, string>): Promise<void> {
    return this.ctx.salvar(KvPortatil.ARQUIVO, Object.fromEntries(m));
  }

  async listar(): Promise<Record<string, string>> {
    return Object.fromEntries(await this.lerMapa());
  }

  definir(chave: string, valor: string): Promise<void> {
    return this.ctx.trava.executar(async () => {
      const m = await this.lerMapa();
      m.set(chave, valor);
      await this.salvarMapa(m);
    });
  }

  remover(chave: string): Promise<void> {
    return this.ctx.trava.executar(async () => {
      const m = await this.lerMapa();
      if (m.delete(chave)) await this.salvarMapa(m);
    });
  }

  limpar(): Promise<void> {
    return this.ctx.trava.executar(() => this.salvarMapa(new Map()));
  }

  substituirTudo(valores: Record<string, string>): Promise<void> {
    return this.ctx.trava.executar(() => this.salvarMapa(new Map(Object.entries(valores))));
  }
}

// --------------------------------------------------------------------- usuários
const usuarioDeJson = (j: Json): Usuario => ({
  id: guid(j.Id) ?? '',
  username: texto(j.Username),
  fullName: texto(j.FullName),
  passwordHash: texto(j.PasswordHash),
  role: texto(j.Role) || 'USER',
  active: j.Active !== false,
  authProvider: texto(j.AuthProvider) || 'LOCAL',
  externalId: textoOuNulo(j.ExternalId),
  createdAt: data(j.CreatedAt),
  updatedAt: data(j.UpdatedAt),
});

const usuarioParaJson = (u: Usuario): Json => ({
  Id: u.id,
  Username: u.username,
  FullName: u.fullName,
  PasswordHash: u.passwordHash,
  Role: u.role,
  Active: u.active,
  AuthProvider: u.authProvider,
  ExternalId: u.externalId,
  CreatedAt: dataIso(u.createdAt),
  UpdatedAt: dataIso(u.updatedAt),
});

const colador = new Intl.Collator('pt-BR');

class UsuariosPortatil implements RepositorioUsuarios {
  private static readonly ARQUIVO = 'usuarios.json';
  constructor(private readonly ctx: ContextoPortatil) {}

  private async lerTodos(): Promise<Usuario[]> {
    return (await this.ctx.ler<Json[]>(UsuariosPortatil.ARQUIVO, () => [])).map(usuarioDeJson);
  }

  private salvarTodos(l: Usuario[]): Promise<void> {
    return this.ctx.salvar(UsuariosPortatil.ARQUIVO, l.map(usuarioParaJson));
  }

  async contar(): Promise<number> {
    return (await this.lerTodos()).length;
  }

  async porUsername(username: string): Promise<Usuario | null> {
    return (await this.lerTodos()).find((u) => u.username === username) ?? null;
  }

  async porId(id: string): Promise<Usuario | null> {
    const alvo = id.toLowerCase();
    return (await this.lerTodos()).find((u) => u.id === alvo) ?? null;
  }

  async porIdExterno(idExterno: string): Promise<Usuario | null> {
    const alvo = idExterno.toLowerCase();
    return (await this.lerTodos()).find((u) => u.externalId?.toLowerCase() === alvo) ?? null;
  }

  async listar(): Promise<Usuario[]> {
    return (await this.lerTodos()).sort((a, b) => colador.compare(a.fullName, b.fullName));
  }

  inserir(u: Usuario): Promise<boolean> {
    return this.ctx.trava.executar(async () => {
      const l = await this.lerTodos();
      if (l.some((x) => x.username === u.username)) return false;
      l.push(u);
      await this.salvarTodos(l);
      return true;
    });
  }

  atualizar(u: Usuario): Promise<void> {
    return this.ctx.trava.executar(async () => {
      const l = await this.lerTodos();
      const i = l.findIndex((x) => x.id === u.id.toLowerCase());
      if (i >= 0) {
        l[i] = u;
        await this.salvarTodos(l);
      }
    });
  }
}

// --------------------------------------------------------------------- auditoria (uma linha JSON por registro)
class AuditoriaPortatil implements RepositorioAuditoria {
  constructor(private readonly ctx: ContextoPortatil) {}

  private get arquivo(): string {
    return this.ctx.caminho('auditoria.jsonl');
  }

  registrar(r: RegistroAuditoria): Promise<void> {
    return this.ctx.trava.executar(async () => {
      const linha = JSON.stringify({
        UserId: r.userId,
        Username: r.username,
        Module: r.module,
        Action: r.action,
        RecordKey: r.recordKey,
        ChangedAt: dataIso(r.changedAt),
        DetailsJson: r.detailsJson,
      });
      await fs.mkdir(this.ctx.raiz, { recursive: true });
      await fs.appendFile(this.arquivo, linha + '\n', 'utf8');
    });
  }

  private async linhas(): Promise<string[]> {
    try {
      return (await fs.readFile(this.arquivo, 'utf8')).split(/\r?\n/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async listar(limite: number): Promise<RegistroAuditoria[]> {
    const linhas = await this.linhas();
    const lista: RegistroAuditoria[] = [];
    for (let i = linhas.length - 1; i >= 0 && lista.length < limite; i--) {
      if (!linhas[i].trim()) continue;
      try {
        const j = JSON.parse(linhas[i]) as Json;
        lista.push({
          userId: guid(j.UserId),
          username: textoOuNulo(j.Username),
          module: texto(j.Module),
          action: texto(j.Action),
          recordKey: textoOuNulo(j.RecordKey),
          changedAt: data(j.ChangedAt),
          detailsJson: texto(j.DetailsJson) || '{}',
        });
      } catch {
        // linha corrompida ignorada
      }
    }
    return lista;
  }

  async contar(): Promise<number> {
    return (await this.linhas()).filter((l) => l.trim()).length;
  }
}

// --------------------------------------------------------------------- documentos / anexos / passaportes / backups
const documentoDeJson = (j: Json): DocumentoEquipamento => ({
  id: guid(j.Id) ?? '',
  equipmentCode: texto(j.EquipmentCode),
  originalName: texto(j.OriginalName),
  storedName: texto(j.StoredName),
  mimeType: textoOuNulo(j.MimeType),
  fileSize: numero(j.FileSize),
  documentType: textoOuNulo(j.DocumentType),
  revision: textoOuNulo(j.Revision),
  active: j.Active !== false,
  uploadedAt: data(j.UploadedAt),
  uploadedBy: guid(j.UploadedBy),
});

const documentoParaJson = (d: DocumentoEquipamento): Json => ({
  Id: d.id,
  EquipmentCode: d.equipmentCode,
  OriginalName: d.originalName,
  StoredName: d.storedName,
  MimeType: d.mimeType,
  FileSize: d.fileSize,
  DocumentType: d.documentType,
  Revision: d.revision,
  Active: d.active,
  UploadedAt: dataIso(d.uploadedAt),
  UploadedBy: d.uploadedBy,
});

class DocumentosPortatil implements RepositorioDocumentos {
  private static readonly ARQUIVO = 'documentos_equipamentos.json';
  constructor(private readonly ctx: ContextoPortatil) {}

  private async lerTodos(): Promise<DocumentoEquipamento[]> {
    return (await this.ctx.ler<Json[]>(DocumentosPortatil.ARQUIVO, () => [])).map(documentoDeJson);
  }

  async listarPorEquipamento(codigo: string): Promise<DocumentoEquipamento[]> {
    return (await this.lerTodos())
      .filter((d) => d.active && d.equipmentCode === codigo)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }

  async obter(id: string): Promise<DocumentoEquipamento | null> {
    const alvo = id.toLowerCase();
    return (await this.lerTodos()).find((d) => d.id === alvo) ?? null;
  }

  inserir(d: DocumentoEquipamento): Promise<void> {
    return this.ctx.trava.executar(async () => {
      const l = await this.lerTodos();
      l.push(d);
      await this.ctx.salvar(DocumentosPortatil.ARQUIVO, l.map(documentoParaJson));
    });
  }

  listarTodos(): Promise<DocumentoEquipamento[]> {
    return this.lerTodos();
  }
}

class AnexosPortatil implements RepositorioAnexos {
  private static readonly ARQUIVO = 'anexos.json';
  constructor(private readonly ctx: ContextoPortatil) {}

  inserir(a: Anexo): Promise<void> {
    return this.ctx.trava.executar(async () => {
      const l = await this.ctx.ler<Json[]>(AnexosPortatil.ARQUIVO, () => []);
      l.push({
        Id: a.id,
        Scope: a.scope,
        RecordId: a.recordId,
        OriginalName: a.originalName,
        StoredKey: a.storedKey,
        MimeType: a.mimeType,
        FileSize: a.fileSize,
        UploadedAt: dataIso(a.uploadedAt),
        UploadedBy: a.uploadedBy,
      });
      await this.ctx.salvar(AnexosPortatil.ARQUIVO, l);
    });
  }

  async obter(id: string): Promise<Anexo | null> {
    const alvo = id.toLowerCase();
    const j = (await this.ctx.ler<Json[]>(AnexosPortatil.ARQUIVO, () => [])).find((x) => guid(x.Id) === alvo);
    if (!j) return null;
    return {
      id: guid(j.Id) ?? '',
      scope: texto(j.Scope),
      recordId: texto(j.RecordId),
      originalName: texto(j.OriginalName),
      storedKey: texto(j.StoredKey),
      mimeType: textoOuNulo(j.MimeType),
      fileSize: numero(j.FileSize),
      uploadedAt: data(j.UploadedAt),
      uploadedBy: guid(j.UploadedBy),
    };
  }
}

class PassaportesPortatil implements RepositorioPassaportes {
  private static readonly ARQUIVO = 'passaportes_publicados.json';
  constructor(private readonly ctx: ContextoPortatil) {}

  salvar(p: PassaportePublicado): Promise<void> {
    return this.ctx.trava.executar(async () => {
      const l = (await this.ctx.ler<Json[]>(PassaportesPortatil.ARQUIVO, () => [])).filter((x) => x.Id !== p.id);
      l.push({
        Id: p.id,
        StoredKey: p.storedKey,
        SizeBytes: p.sizeBytes,
        PublishedAt: dataIso(p.publishedAt),
        PublishedBy: p.publishedBy,
      });
      await this.ctx.salvar(PassaportesPortatil.ARQUIVO, l);
    });
  }

  async obter(id: string): Promise<PassaportePublicado | null> {
    const j = (await this.ctx.ler<Json[]>(PassaportesPortatil.ARQUIVO, () => [])).find((x) => x.Id === id);
    if (!j) return null;
    return {
      id: texto(j.Id),
      storedKey: texto(j.StoredKey),
      sizeBytes: numero(j.SizeBytes),
      publishedAt: data(j.PublishedAt),
      publishedBy: guid(j.PublishedBy),
    };
  }
}

const backupDeJson = (j: Json): BackupEstado => ({
  id: numero(j.Id),
  storedKey: texto(j.StoredKey),
  reason: texto(j.Reason),
  sizeBytes: numero(j.SizeBytes),
  stateVersion: numero(j.StateVersion),
  createdAt: data(j.CreatedAt),
  createdBy: guid(j.CreatedBy),
  createdByName: textoOuNulo(j.CreatedByName),
});

class BackupsPortatil implements RepositorioBackups {
  private static readonly ARQUIVO = 'backups.json';
  constructor(private readonly ctx: ContextoPortatil) {}

  private async lerTodos(): Promise<BackupEstado[]> {
    return (await this.ctx.ler<Json[]>(BackupsPortatil.ARQUIVO, () => [])).map(backupDeJson);
  }

  inserir(b: Omit<BackupEstado, 'id'>): Promise<number> {
    return this.ctx.trava.executar(async () => {
      const l = await this.lerTodos();
      const id = l.length === 0 ? 1 : Math.max(...l.map((x) => x.id)) + 1;
      l.push({ ...b, id });
      await this.ctx.salvar(
        BackupsPortatil.ARQUIVO,
        l.map((x) => ({
          Id: x.id,
          StoredKey: x.storedKey,
          Reason: x.reason,
          SizeBytes: x.sizeBytes,
          StateVersion: x.stateVersion,
          CreatedAt: dataIso(x.createdAt),
          CreatedBy: x.createdBy,
          CreatedByName: x.createdByName,
        })),
      );
      return id;
    });
  }

  async listar(limite: number): Promise<BackupEstado[]> {
    return (await this.lerTodos()).sort((a, b) => b.id - a.id).slice(0, limite);
  }

  async obter(id: number): Promise<BackupEstado | null> {
    return (await this.lerTodos()).find((b) => b.id === id) ?? null;
  }
}

// --------------------------------------------------------------------- sessões JWT e segredos (novos na API NestJS)
const sessaoDeJson = (j: Json): SessaoAutenticacao => ({
  id: guid(j.Id) ?? '',
  userId: guid(j.UserId) ?? '',
  refreshHash: Buffer.from(texto(j.RefreshHash), 'hex'),
  previousRefreshHash: j.PreviousRefreshHash ? Buffer.from(texto(j.PreviousRefreshHash), 'hex') : null,
  provider: texto(j.Provider) || 'LOCAL',
  channel: j.Channel === 'TOKEN' ? 'TOKEN' : 'COOKIE',
  createdAt: data(j.CreatedAt),
  rotatedAt: data(j.RotatedAt),
  lastSeenAt: data(j.LastSeenAt),
  expiresAt: data(j.ExpiresAt),
  revokedAt: dataOuNulo(j.RevokedAt),
  revokedReason: textoOuNulo(j.RevokedReason),
  userAgent: textoOuNulo(j.UserAgent),
  ipAddress: textoOuNulo(j.IpAddress),
});

const sessaoParaJson = (s: SessaoAutenticacao): Json => ({
  Id: s.id,
  UserId: s.userId,
  RefreshHash: hex(s.refreshHash),
  PreviousRefreshHash: s.previousRefreshHash ? hex(s.previousRefreshHash) : null,
  Provider: s.provider,
  Channel: s.channel,
  CreatedAt: dataIso(s.createdAt),
  RotatedAt: dataIso(s.rotatedAt),
  LastSeenAt: dataIso(s.lastSeenAt),
  ExpiresAt: dataIso(s.expiresAt),
  RevokedAt: s.revokedAt ? dataIso(s.revokedAt) : null,
  RevokedReason: s.revokedReason,
  UserAgent: s.userAgent,
  IpAddress: s.ipAddress,
});

class SessoesPortatil implements RepositorioSessoes {
  private static readonly ARQUIVO = 'sessoes_autenticacao.json';
  constructor(private readonly ctx: ContextoPortatil) {}

  private async lerTodas(): Promise<SessaoAutenticacao[]> {
    return (await this.ctx.ler<Json[]>(SessoesPortatil.ARQUIVO, () => [])).map(sessaoDeJson);
  }

  private salvarTodas(l: SessaoAutenticacao[]): Promise<void> {
    return this.ctx.salvar(SessoesPortatil.ARQUIVO, l.map(sessaoParaJson));
  }

  private alterar<T>(acao: (l: SessaoAutenticacao[]) => T): Promise<T> {
    return this.ctx.trava.executar(async () => {
      const l = await this.lerTodas();
      const r = acao(l);
      await this.salvarTodas(l);
      return r;
    });
  }

  criar(s: SessaoAutenticacao): Promise<void> {
    return this.alterar((l) => void l.push(s));
  }

  async obter(id: string): Promise<SessaoAutenticacao | null> {
    const alvo = id.toLowerCase();
    return (await this.lerTodas()).find((s) => s.id === alvo) ?? null;
  }

  async porHashRefresh(hash: Buffer): Promise<{ sessao: SessaoAutenticacao; atual: boolean } | null> {
    for (const s of await this.lerTodas()) {
      if (s.refreshHash.equals(hash)) return { sessao: s, atual: true };
      if (s.previousRefreshHash?.equals(hash)) return { sessao: s, atual: false };
    }
    return null;
  }

  rotacionar(id: string, hashEsperado: Buffer, novoHash: Buffer, expiraEm: Date, agora: Date): Promise<boolean> {
    return this.alterar((l) => {
      const s = l.find((x) => x.id === id);
      if (!s || !s.refreshHash.equals(hashEsperado)) return false;
      s.previousRefreshHash = s.refreshHash;
      s.refreshHash = novoHash;
      s.rotatedAt = agora;
      s.lastSeenAt = agora;
      s.expiresAt = expiraEm;
      return true;
    });
  }

  renovar(id: string, expiraEm: Date, agora: Date): Promise<void> {
    return this.alterar((l) => {
      const s = l.find((x) => x.id === id);
      if (s && !s.revokedAt) {
        s.lastSeenAt = agora;
        s.expiresAt = expiraEm;
      }
    });
  }

  revogar(id: string, motivo: string, agora: Date): Promise<void> {
    return this.alterar((l) => {
      const s = l.find((x) => x.id === id);
      if (s && !s.revokedAt) {
        s.revokedAt = agora;
        s.revokedReason = motivo;
      }
    });
  }

  revogarDoUsuario(userId: string, motivo: string, agora: Date): Promise<number> {
    return this.alterar((l) => {
      let n = 0;
      for (const s of l) {
        if (s.userId === userId.toLowerCase() && !s.revokedAt) {
          s.revokedAt = agora;
          s.revokedReason = motivo;
          n++;
        }
      }
      return n;
    });
  }

  limpar(antesDe: Date): Promise<number> {
    return this.ctx.trava.executar(async () => {
      const l = await this.lerTodas();
      const ficam = l.filter((s) => s.expiresAt >= antesDe && !(s.revokedAt && s.revokedAt < antesDe));
      if (ficam.length !== l.length) await this.salvarTodas(ficam);
      return l.length - ficam.length;
    });
  }
}

class SegredosPortatil implements RepositorioSegredos {
  private static readonly ARQUIVO = 'segredos.json';
  constructor(private readonly ctx: ContextoPortatil) {}

  async obter(nome: string): Promise<string | null> {
    const v = (await this.ctx.ler<Json>(SegredosPortatil.ARQUIVO, () => ({})))[nome];
    return typeof v === 'string' ? v : null;
  }

  definirSeAusente(nome: string, valor: string): Promise<string> {
    return this.ctx.trava.executar(async () => {
      const o = await this.ctx.ler<Json>(SegredosPortatil.ARQUIVO, () => ({}));
      if (typeof o[nome] === 'string') return o[nome];
      o[nome] = valor;
      await this.ctx.salvar(SegredosPortatil.ARQUIVO, o);
      return valor;
    });
  }
}

export function criarProvedorPortatil(raiz: string): ProvedorPersistencia {
  const ctx = new ContextoPortatil(path.resolve(raiz));
  return {
    nome: 'Portatil',
    descricao: `Portátil (arquivos em ${ctx.raiz})`,
    inicializar: async () => {
      await fs.mkdir(ctx.caminho('estado'), { recursive: true });
    },
    encerrar: () => Promise.resolve(),
    estado: new EstadoPortatil(ctx),
    kv: new KvPortatil(ctx),
    usuarios: new UsuariosPortatil(ctx),
    auditoria: new AuditoriaPortatil(ctx),
    documentos: new DocumentosPortatil(ctx),
    anexos: new AnexosPortatil(ctx),
    passaportes: new PassaportesPortatil(ctx),
    backups: new BackupsPortatil(ctx),
    sessoes: new SessoesPortatil(ctx),
    segredos: new SegredosPortatil(ctx),
  };
}
