// =====================================================================
// Persistência oficial: SQL Server, Azure SQL Database (Prisma ORM + @prisma/adapter-mssql).
// Mesmas tabelas e regras do servidor .NET (Persistencia/SqlServer/ProvedorSqlServer.cs): estado por
// coleção com trava de aplicação (sp_getapplock) para várias instâncias, gravação só do que mudou,
// retentativa em falhas transitórias do Azure SQL.
// =====================================================================
import { Logger } from '@nestjs/common';
import { PrismaMssql } from '@prisma/adapter-mssql';
import sql from 'mssql';
import { esperar } from '../../../comum/trava';
import { lerGuid } from '../../../comum/formatos';
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
import { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { ehErroTransitorio, ehViolacaoUnicidade, type InformacoesConexao } from './conexao-sql';
import { aplicarScripts, garantirBanco, lerScripts, pastasScripts } from './scripts-sql';

type Tx = Prisma.TransactionClient;

const bytes = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
const buffer = (b: Uint8Array): Buffer => Buffer.from(b);
const num = (v: bigint | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const cortar = (s: string | null, n: number): string | null => (s === null || s.length <= n ? s : s.slice(0, n));

/** Executor com retentativa (falhas transitórias do Azure SQL). A operação deve ser idempotente ou transacional. */
export class ExecutorSql {
  private readonly log = new Logger('MesLion.Sql');
  constructor(
    readonly prisma: PrismaClient,
    readonly timeoutMs: number,
  ) {}

  async executar<T>(operacao: (p: PrismaClient) => Promise<T>, tentativas = 5): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await operacao(this.prisma);
      } catch (e) {
        if (i >= tentativas || !ehErroTransitorio(e)) throw e;
        const espera = Math.min(8000, 400 * 2 ** (i - 1));
        this.log.warn(
          `Falha transitória no SQL Server (tentativa ${i}/${tentativas}): ${(e as Error).message}. Nova tentativa em ${espera} ms.`,
        );
        await esperar(espera);
      }
    }
  }

  transacao<T>(operacao: (tx: Tx) => Promise<T>): Promise<T> {
    return this.executar((p) =>
      p.$transaction(operacao, {
        maxWait: 120_000,
        timeout: this.timeoutMs,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }),
    );
  }
}

async function travaEstado(tx: Tx, modo: 'Shared' | 'Exclusive'): Promise<void> {
  await tx.$executeRawUnsafe(
    `DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'mes_estado', @LockMode = N'${modo}', @LockOwner = N'Transaction', @LockTimeout = 120000;
IF @r < 0 THROW 50001, N'Tempo esgotado aguardando a trava do estado do MES (mes_estado).', 1;`,
  );
}

// ===================================================================== estado
class EstadoSql implements RepositorioEstado {
  constructor(private readonly x: ExecutorSql) {}

  obterVersao(): Promise<number> {
    return this.x.executar(async (p) =>
      num((await p.estadoApp.findUnique({ where: { id: 1 }, select: { version: true } }))?.version),
    );
  }

  carregar(): Promise<{ versao: number; colecoes: ColecaoArmazenada[] }> {
    return this.x.transacao(async (tx) => {
      await travaEstado(tx, 'Shared');
      const cab = await tx.estadoApp.findUnique({ where: { id: 1 }, select: { version: true } });
      const linhas = await tx.colecaoEstado.findMany({
        select: { name: true, ordinal: true, content: true, contentHash: true },
        orderBy: [{ ordinal: 'asc' }, { name: 'asc' }],
      });
      return {
        versao: num(cab?.version),
        colecoes: linhas.map((l) => ({
          nome: l.name,
          ordem: l.ordinal,
          conteudo: Buffer.from(l.content, 'utf8'),
          hash: buffer(l.contentHash),
        })),
      };
    });
  }

  gravar(colecoes: ColecaoRecebida[], usuario: Usuario | null): Promise<ResultadoGravacaoEstado> {
    const uid = usuario?.id ?? null;
    return this.x.transacao(async (tx) => {
      await travaEstado(tx, 'Exclusive');
      const atuais = new Map(
        (await tx.colecaoEstado.findMany({ select: { name: true, contentHash: true, ordinal: true } })).map((c) => [
          c.name,
          c,
        ]),
      );
      const alteradas: string[] = [];
      let bytesGravados = 0;
      const agora = new Date();
      for (const col of colecoes) {
        const atual = atuais.get(col.nome);
        if (atual && buffer(atual.contentHash).equals(col.hash)) {
          if (atual.ordinal !== col.ordem)
            await tx.colecaoEstado.updateMany({ where: { name: col.nome }, data: { ordinal: col.ordem } });
          continue;
        }
        const dados = {
          ordinal: col.ordem,
          content: col.conteudo.toString('utf8'),
          contentHash: bytes(col.hash),
          itemCount: col.itens,
          sizeBytes: BigInt(col.conteudo.length),
          updatedAt: agora,
          updatedBy: uid,
        };
        if (atual) await tx.colecaoEstado.updateMany({ where: { name: col.nome }, data: dados });
        else await tx.colecaoEstado.createMany({ data: [{ name: col.nome, ...dados }] });
        alteradas.push(col.nome);
        bytesGravados += col.conteudo.length;
      }
      const nomes = new Set(colecoes.map((c) => c.nome));
      const removidas = [...atuais.keys()].filter((k) => !nomes.has(k));
      for (let i = 0; i < removidas.length; i += 1000) {
        await tx.colecaoEstado.deleteMany({ where: { name: { in: removidas.slice(i, i + 1000) } } });
      }
      const cab = await tx.estadoApp.update({
        where: { id: 1 },
        data: { version: { increment: 1 }, updatedAt: agora, updatedBy: uid },
        select: { version: true },
      });
      return { versao: num(cab.version), alteradas, removidas, bytesGravados };
    });
  }

  resumo(): Promise<ResumoEstado> {
    return this.x.executar(async (p) => {
      const [cab, soma] = await Promise.all([
        p.estadoApp.findUnique({
          where: { id: 1 },
          select: { version: true, updatedAt: true, usuario: { select: { username: true } } },
        }),
        p.colecaoEstado.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
      ]);
      if (!cab) return { versao: 0, colecoes: 0, bytes: 0, atualizadoEm: null, atualizadoPor: null };
      return {
        versao: num(cab.version),
        colecoes: soma._count._all,
        bytes: num(soma._sum.sizeBytes),
        atualizadoEm: cab.updatedAt,
        atualizadoPor: cab.usuario?.username ?? null,
      };
    });
  }
}

// ===================================================================== app_storage
class KvSql implements RepositorioKv {
  constructor(private readonly x: ExecutorSql) {}

  listar(): Promise<Record<string, string>> {
    return this.x.executar(async (p) => {
      const linhas = await p.armazenamentoApp.findMany({ select: { key: true, value: true } });
      return Object.fromEntries(linhas.map((l) => [l.key, l.value ?? '']));
    });
  }

  definir(chave: string, valor: string): Promise<void> {
    return this.x.transacao(async (tx) => {
      await tx.$executeRaw`UPDATE dbo.app_storage WITH (UPDLOCK, SERIALIZABLE) SET [value] = ${valor}, updated_at = SYSDATETIMEOFFSET() WHERE [key] = ${chave};
IF @@ROWCOUNT = 0 INSERT INTO dbo.app_storage ([key], [value]) VALUES (${chave}, ${valor});`;
    });
  }

  remover(chave: string): Promise<void> {
    return this.x.executar(async (p) => void (await p.armazenamentoApp.deleteMany({ where: { key: chave } })));
  }

  limpar(): Promise<void> {
    return this.x.executar(async (p) => void (await p.armazenamentoApp.deleteMany({})));
  }

  substituirTudo(valores: Record<string, string>): Promise<void> {
    return this.x.transacao(async (tx) => {
      await tx.armazenamentoApp.deleteMany({});
      const dados = Object.entries(valores).map(([key, value]) => ({ key, value }));
      if (dados.length) await tx.armazenamentoApp.createMany({ data: dados });
    });
  }
}

// ===================================================================== usuários
type LinhaUsuario = Prisma.UsuarioGetPayload<object>;
const usuarioDe = (u: LinhaUsuario): Usuario => ({
  id: u.id.toLowerCase(),
  username: u.username,
  fullName: u.fullName,
  passwordHash: u.passwordHash,
  role: u.role,
  active: u.active,
  authProvider: u.authProvider,
  externalId: u.externalId,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

class UsuariosSql implements RepositorioUsuarios {
  constructor(private readonly x: ExecutorSql) {}

  contar(): Promise<number> {
    return this.x.executar((p) => p.usuario.count());
  }

  porUsername(username: string): Promise<Usuario | null> {
    return this.x.executar(async (p) => {
      const u = await p.usuario.findUnique({ where: { username } });
      return u && u.username === username ? usuarioDe(u) : null;
    });
  }

  porId(id: string): Promise<Usuario | null> {
    const g = lerGuid(id);
    if (!g) return Promise.resolve(null);
    return this.x.executar(async (p) => {
      const u = await p.usuario.findUnique({ where: { id: g } });
      return u ? usuarioDe(u) : null;
    });
  }

  porIdExterno(idExterno: string): Promise<Usuario | null> {
    return this.x.executar(async (p) => {
      const u = await p.usuario.findFirst({ where: { externalId: idExterno } });
      return u ? usuarioDe(u) : null;
    });
  }

  listar(): Promise<Usuario[]> {
    return this.x.executar(async (p) => (await p.usuario.findMany({ orderBy: { fullName: 'asc' } })).map(usuarioDe));
  }

  async inserir(u: Usuario): Promise<boolean> {
    try {
      await this.x.executar((p) =>
        p.usuario.createMany({
          data: [
            {
              id: u.id,
              username: u.username,
              fullName: u.fullName,
              passwordHash: u.passwordHash,
              role: u.role,
              active: u.active,
              authProvider: u.authProvider,
              externalId: u.externalId,
              createdAt: u.createdAt,
              updatedAt: u.updatedAt,
            },
          ],
        }),
      );
      return true;
    } catch (e) {
      if (ehViolacaoUnicidade(e)) return false;
      throw e;
    }
  }

  atualizar(u: Usuario): Promise<void> {
    return this.x.executar(async (p) => {
      await p.usuario.updateMany({
        where: { id: u.id },
        data: {
          fullName: u.fullName,
          passwordHash: u.passwordHash,
          role: u.role,
          active: u.active,
          authProvider: u.authProvider,
          externalId: u.externalId,
          updatedAt: u.updatedAt,
        },
      });
    });
  }
}

// ===================================================================== auditoria
class AuditoriaSql implements RepositorioAuditoria {
  constructor(private readonly x: ExecutorSql) {}

  registrar(a: RegistroAuditoria): Promise<void> {
    return this.x.executar(async (p) => {
      await p.registroAuditoria.createMany({
        data: [
          {
            userId: a.userId,
            username: cortar(a.username, 80),
            module: cortar(a.module, 80),
            action: cortar(a.action, 40),
            recordKey: cortar(a.recordKey, 1000),
            changedAt: a.changedAt,
            details: a.detailsJson,
          },
        ],
      });
    });
  }

  listar(limite: number): Promise<RegistroAuditoria[]> {
    return this.x.executar(async (p) =>
      (await p.registroAuditoria.findMany({ take: limite, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }] })).map(
        (r) => ({
          userId: r.userId?.toLowerCase() ?? null,
          username: r.username,
          module: r.module ?? '',
          action: r.action ?? '',
          recordKey: r.recordKey,
          changedAt: r.changedAt,
          detailsJson: r.details ?? '{}',
        }),
      ),
    );
  }

  contar(): Promise<number> {
    return this.x.executar((p) => p.registroAuditoria.count());
  }
}

// ===================================================================== documentos de equipamento
type LinhaDocumento = Prisma.DocumentoEquipamentoGetPayload<object>;
const documentoDe = (d: LinhaDocumento): DocumentoEquipamento => ({
  id: d.id.toLowerCase(),
  equipmentCode: d.equipmentCode,
  originalName: d.originalName,
  storedName: d.storedName,
  mimeType: d.mimeType,
  fileSize: num(d.fileSize),
  documentType: d.documentType,
  revision: d.revision,
  active: d.active,
  uploadedAt: d.uploadedAt,
  uploadedBy: d.uploadedBy?.toLowerCase() ?? null,
});

class DocumentosSql implements RepositorioDocumentos {
  constructor(private readonly x: ExecutorSql) {}

  listarPorEquipamento(codigo: string): Promise<DocumentoEquipamento[]> {
    return this.x.executar(async (p) =>
      (
        await p.documentoEquipamento.findMany({
          where: { equipmentCode: codigo, active: true },
          orderBy: { uploadedAt: 'desc' },
        })
      )
        .filter((d) => d.equipmentCode === codigo)
        .map(documentoDe),
    );
  }

  listarTodos(): Promise<DocumentoEquipamento[]> {
    return this.x.executar(async (p) =>
      (await p.documentoEquipamento.findMany({ orderBy: { uploadedAt: 'desc' } })).map(documentoDe),
    );
  }

  obter(id: string): Promise<DocumentoEquipamento | null> {
    const g = lerGuid(id);
    if (!g) return Promise.resolve(null);
    return this.x.executar(async (p) => {
      const d = await p.documentoEquipamento.findUnique({ where: { id: g } });
      return d ? documentoDe(d) : null;
    });
  }

  inserir(d: DocumentoEquipamento): Promise<void> {
    return this.x.transacao(async (tx) => {
      // A tabela equipment pode ainda não ter o código (sincronização assíncrona): garante a linha para a FK.
      await tx.$executeRaw`IF NOT EXISTS (SELECT 1 FROM dbo.equipment WITH (UPDLOCK, HOLDLOCK) WHERE code = ${d.equipmentCode})
    INSERT INTO dbo.equipment (code, active, payload) VALUES (${d.equipmentCode}, 1, N'{}');`;
      await tx.documentoEquipamento.createMany({
        data: [
          {
            id: d.id,
            equipmentCode: d.equipmentCode,
            originalName: d.originalName,
            storedName: d.storedName,
            mimeType: d.mimeType,
            fileSize: BigInt(d.fileSize),
            documentType: d.documentType,
            revision: d.revision,
            active: d.active,
            uploadedAt: d.uploadedAt,
            uploadedBy: d.uploadedBy,
          },
        ],
      });
    });
  }
}

// ===================================================================== anexos
class AnexosSql implements RepositorioAnexos {
  constructor(private readonly x: ExecutorSql) {}

  inserir(a: Anexo): Promise<void> {
    return this.x.executar(async (p) => {
      await p.anexo.createMany({
        data: [
          {
            id: a.id,
            scope: a.scope,
            recordId: a.recordId,
            originalName: a.originalName,
            storedKey: a.storedKey,
            mimeType: a.mimeType,
            fileSize: BigInt(a.fileSize),
            uploadedAt: a.uploadedAt,
            uploadedBy: a.uploadedBy,
          },
        ],
      });
    });
  }

  obter(id: string): Promise<Anexo | null> {
    const g = lerGuid(id);
    if (!g) return Promise.resolve(null);
    return this.x.executar(async (p) => {
      const a = await p.anexo.findUnique({ where: { id: g } });
      if (!a) return null;
      return {
        id: a.id.toLowerCase(),
        scope: a.scope,
        recordId: a.recordId,
        originalName: a.originalName,
        storedKey: a.storedKey,
        mimeType: a.mimeType,
        fileSize: num(a.fileSize),
        uploadedAt: a.uploadedAt,
        uploadedBy: a.uploadedBy?.toLowerCase() ?? null,
      };
    });
  }
}

// ===================================================================== passaportes publicados
class PassaportesSql implements RepositorioPassaportes {
  constructor(private readonly x: ExecutorSql) {}

  salvar(p: PassaportePublicado): Promise<void> {
    return this.x.transacao(async (tx) => {
      await tx.$executeRaw`UPDATE dbo.published_passports WITH (UPDLOCK, SERIALIZABLE)
   SET stored_key = ${p.storedKey}, size_bytes = ${p.sizeBytes}, published_at = ${p.publishedAt}, published_by = ${p.publishedBy} WHERE id = ${p.id};
IF @@ROWCOUNT = 0
    INSERT INTO dbo.published_passports (id, stored_key, size_bytes, published_at, published_by) VALUES (${p.id}, ${p.storedKey}, ${p.sizeBytes}, ${p.publishedAt}, ${p.publishedBy});`;
    });
  }

  obter(id: string): Promise<PassaportePublicado | null> {
    return this.x.executar(async (p) => {
      const r = await p.passaportePublicado.findUnique({ where: { id } });
      if (!r || r.id !== id) return null;
      return {
        id: r.id,
        storedKey: r.storedKey,
        sizeBytes: num(r.sizeBytes),
        publishedAt: r.publishedAt,
        publishedBy: r.publishedBy?.toLowerCase() ?? null,
      };
    });
  }
}

// ===================================================================== backups
type LinhaBackup = Prisma.BackupEstadoGetPayload<object>;
const backupDe = (b: LinhaBackup): BackupEstado => ({
  id: num(b.id),
  storedKey: b.storedKey,
  reason: b.reason,
  sizeBytes: num(b.sizeBytes),
  stateVersion: num(b.stateVersion),
  createdAt: b.createdAt,
  createdBy: b.createdBy?.toLowerCase() ?? null,
  createdByName: b.createdByName,
});

class BackupsSql implements RepositorioBackups {
  constructor(private readonly x: ExecutorSql) {}

  inserir(b: Omit<BackupEstado, 'id'>): Promise<number> {
    return this.x.executar(async (p) => {
      const r = await p.backupEstado.create({
        data: {
          storedKey: b.storedKey,
          reason: b.reason,
          sizeBytes: BigInt(b.sizeBytes),
          stateVersion: BigInt(b.stateVersion),
          createdAt: b.createdAt,
          createdBy: b.createdBy,
          createdByName: cortar(b.createdByName, 80),
        },
        select: { id: true },
      });
      return num(r.id);
    });
  }

  listar(limite: number): Promise<BackupEstado[]> {
    return this.x.executar(async (p) =>
      (await p.backupEstado.findMany({ take: limite, orderBy: { id: 'desc' } })).map(backupDe),
    );
  }

  obter(id: number): Promise<BackupEstado | null> {
    return this.x.executar(async (p) => {
      const b = await p.backupEstado.findUnique({ where: { id: BigInt(id) } });
      return b ? backupDe(b) : null;
    });
  }
}

// ===================================================================== sessões JWT e segredos
type LinhaSessao = Prisma.SessaoAutenticacaoGetPayload<object>;
const sessaoDe = (s: LinhaSessao): SessaoAutenticacao => ({
  id: s.id.toLowerCase(),
  userId: s.userId.toLowerCase(),
  refreshHash: buffer(s.refreshHash),
  previousRefreshHash: s.previousRefreshHash ? buffer(s.previousRefreshHash) : null,
  provider: s.provider,
  channel: s.channel === 'TOKEN' ? 'TOKEN' : 'COOKIE',
  createdAt: s.createdAt,
  rotatedAt: s.rotatedAt,
  lastSeenAt: s.lastSeenAt,
  expiresAt: s.expiresAt,
  revokedAt: s.revokedAt,
  revokedReason: s.revokedReason,
  userAgent: s.userAgent,
  ipAddress: s.ipAddress,
});

class SessoesSql implements RepositorioSessoes {
  constructor(private readonly x: ExecutorSql) {}

  criar(s: SessaoAutenticacao): Promise<void> {
    return this.x.executar(async (p) => {
      await p.sessaoAutenticacao.createMany({
        data: [
          {
            id: s.id,
            userId: s.userId,
            refreshHash: bytes(s.refreshHash),
            previousRefreshHash: s.previousRefreshHash ? bytes(s.previousRefreshHash) : null,
            provider: s.provider,
            channel: s.channel,
            createdAt: s.createdAt,
            rotatedAt: s.rotatedAt,
            lastSeenAt: s.lastSeenAt,
            expiresAt: s.expiresAt,
            userAgent: cortar(s.userAgent, 400),
            ipAddress: cortar(s.ipAddress, 64),
          },
        ],
      });
    });
  }

  obter(id: string): Promise<SessaoAutenticacao | null> {
    const g = lerGuid(id);
    if (!g) return Promise.resolve(null);
    return this.x.executar(async (p) => {
      const s = await p.sessaoAutenticacao.findUnique({ where: { id: g } });
      return s ? sessaoDe(s) : null;
    });
  }

  porHashRefresh(hash: Buffer): Promise<{ sessao: SessaoAutenticacao; atual: boolean } | null> {
    return this.x.executar(async (p) => {
      const h = bytes(hash);
      const s = await p.sessaoAutenticacao.findFirst({
        where: { OR: [{ refreshHash: h }, { previousRefreshHash: h }] },
      });
      if (!s) return null;
      const sessao = sessaoDe(s);
      return { sessao, atual: sessao.refreshHash.equals(hash) };
    });
  }

  rotacionar(id: string, hashEsperado: Buffer, novoHash: Buffer, expiraEm: Date, agora: Date): Promise<boolean> {
    return this.x.executar(async (p) => {
      const r = await p.sessaoAutenticacao.updateMany({
        where: { id, refreshHash: bytes(hashEsperado), revokedAt: null },
        data: {
          previousRefreshHash: bytes(hashEsperado),
          refreshHash: bytes(novoHash),
          rotatedAt: agora,
          lastSeenAt: agora,
          expiresAt: expiraEm,
        },
      });
      return r.count === 1;
    });
  }

  renovar(id: string, expiraEm: Date, agora: Date): Promise<void> {
    return this.x.executar(async (p) => {
      await p.sessaoAutenticacao.updateMany({
        where: { id, revokedAt: null },
        data: { lastSeenAt: agora, expiresAt: expiraEm },
      });
    });
  }

  revogar(id: string, motivo: string, agora: Date): Promise<void> {
    return this.x.executar(async (p) => {
      await p.sessaoAutenticacao.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: agora, revokedReason: cortar(motivo, 100) },
      });
    });
  }

  revogarDoUsuario(userId: string, motivo: string, agora: Date): Promise<number> {
    return this.x.executar(
      async (p) =>
        (
          await p.sessaoAutenticacao.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: agora, revokedReason: cortar(motivo, 100) },
          })
        ).count,
    );
  }

  limpar(antesDe: Date): Promise<number> {
    return this.x.executar(
      async (p) =>
        (
          await p.sessaoAutenticacao.deleteMany({
            where: { OR: [{ expiresAt: { lt: antesDe } }, { revokedAt: { lt: antesDe } }] },
          })
        ).count,
    );
  }
}

class SegredosSql implements RepositorioSegredos {
  constructor(private readonly x: ExecutorSql) {}

  obter(nome: string): Promise<string | null> {
    return this.x.executar(async (p) => (await p.segredoApp.findUnique({ where: { name: nome } }))?.value ?? null);
  }

  async definirSeAusente(nome: string, valor: string): Promise<string> {
    try {
      await this.x.executar((p) => p.segredoApp.createMany({ data: [{ name: nome, value: valor }] }));
      return valor;
    } catch (e) {
      if (!ehViolacaoUnicidade(e)) throw e;
      return (await this.obter(nome)) ?? valor;
    }
  }
}

// ===================================================================== provedor
export interface ProvedorSqlServer extends ProvedorPersistencia {
  readonly conexao: InformacoesConexao;
  /** Pool do driver mssql para tarefas de manutenção (scripts, camada relacional). */
  pool(): Promise<sql.ConnectionPool>;
  readonly prisma: PrismaClient;
}

export function criarProvedorSqlServer(
  conexao: InformacoesConexao,
  p: { criarBanco: boolean; aplicarScripts: boolean; raizConteudo: string; timeoutComandoSegundos: number },
): ProvedorSqlServer {
  const log = new Logger('MesLion.Banco');
  const prisma = new PrismaClient({ adapter: new PrismaMssql(conexao.config, { schema: 'dbo' }) });
  const executor = new ExecutorSql(prisma, Math.max(30, p.timeoutComandoSegundos) * 1000);
  let poolManutencao: Promise<sql.ConnectionPool> | null = null;
  const pool = () =>
    (poolManutencao ??= new sql.ConnectionPool({
      ...conexao.config,
      pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
    }).connect());

  return {
    nome: 'SqlServer',
    descricao: `SQL Server (${conexao.servidor} / ${conexao.banco})`,
    conexao,
    prisma,
    pool,
    async inicializar() {
      for (const aviso of conexao.avisos) log.warn(aviso);
      if (p.criarBanco && !conexao.azureSql) await garantirBanco(conexao.config, log);
      if (p.aplicarScripts) {
        const pastas = pastasScripts(p.raizConteudo);
        const scripts = lerScripts(pastas);
        if (scripts.length < 6)
          log.warn(
            `Scripts SQL encontrados: ${scripts.map((s) => s.nome).join(', ') || 'nenhum'} (pastas: ${pastas.join('; ')}).`,
          );
        await aplicarScripts(await pool(), scripts, log);
      }
      await prisma.$connect();
    },
    async encerrar() {
      await prisma.$disconnect().catch(() => undefined);
      if (poolManutencao) await (await poolManutencao).close().catch(() => undefined);
    },
    estado: new EstadoSql(executor),
    kv: new KvSql(executor),
    usuarios: new UsuariosSql(executor),
    auditoria: new AuditoriaSql(executor),
    documentos: new DocumentosSql(executor),
    anexos: new AnexosSql(executor),
    passaportes: new PassaportesSql(executor),
    backups: new BackupsSql(executor),
    sessoes: new SessoesSql(executor),
    segredos: new SegredosSql(executor),
  };
}
