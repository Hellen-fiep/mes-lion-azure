// =====================================================================
// Portas de persistência (DDD): implementadas por SQL Server/Azure SQL (Prisma) e pelo modo Portátil
// (arquivos JSON compatíveis com os do servidor .NET).
// =====================================================================
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
} from './entidades';

export interface RepositorioEstado {
  obterVersao(): Promise<number>;
  carregar(): Promise<{ versao: number; colecoes: ColecaoArmazenada[] }>;
  /** Grava o estado completo enviado pelo navegador: só as coleções alteradas são escritas e as ausentes
   * no envio são removidas (mesma semântica do UPDATE do payload no PostgreSQL original). */
  gravar(colecoes: ColecaoRecebida[], usuario: Usuario | null): Promise<ResultadoGravacaoEstado>;
  resumo(): Promise<ResumoEstado>;
}

export interface RepositorioKv {
  listar(): Promise<Record<string, string>>;
  definir(chave: string, valor: string): Promise<void>;
  remover(chave: string): Promise<void>;
  limpar(): Promise<void>;
  substituirTudo(valores: Record<string, string>): Promise<void>;
}

export interface RepositorioUsuarios {
  contar(): Promise<number>;
  porUsername(username: string): Promise<Usuario | null>;
  porId(id: string): Promise<Usuario | null>;
  porIdExterno(idExterno: string): Promise<Usuario | null>;
  listar(): Promise<Usuario[]>;
  /** Insere; retorna false se o username já existir. */
  inserir(usuario: Usuario): Promise<boolean>;
  atualizar(usuario: Usuario): Promise<void>;
}

export interface RepositorioAuditoria {
  registrar(registro: RegistroAuditoria): Promise<void>;
  listar(limite: number): Promise<RegistroAuditoria[]>;
  contar(): Promise<number>;
}

export interface RepositorioDocumentos {
  listarPorEquipamento(codigo: string): Promise<DocumentoEquipamento[]>;
  obter(id: string): Promise<DocumentoEquipamento | null>;
  inserir(documento: DocumentoEquipamento): Promise<void>;
  listarTodos(): Promise<DocumentoEquipamento[]>;
}

export interface RepositorioAnexos {
  inserir(anexo: Anexo): Promise<void>;
  obter(id: string): Promise<Anexo | null>;
}

export interface RepositorioPassaportes {
  salvar(passaporte: PassaportePublicado): Promise<void>;
  obter(id: string): Promise<PassaportePublicado | null>;
}

export interface RepositorioBackups {
  inserir(backup: Omit<BackupEstado, 'id'>): Promise<number>;
  listar(limite: number): Promise<BackupEstado[]>;
  obter(id: number): Promise<BackupEstado | null>;
}

export interface RepositorioSessoes {
  criar(sessao: SessaoAutenticacao): Promise<void>;
  obter(id: string): Promise<SessaoAutenticacao | null>;
  /** Procura pelo hash do refresh token atual ou do anterior (atual = false). */
  porHashRefresh(hash: Buffer): Promise<{ sessao: SessaoAutenticacao; atual: boolean } | null>;
  /** Troca o refresh token somente se o atual ainda for `hashEsperado` (outra requisição pode ter girado antes). */
  rotacionar(id: string, hashEsperado: Buffer, novoHash: Buffer, expiraEm: Date, agora: Date): Promise<boolean>;
  /** Estende a validade (expiração deslizante) sem trocar o token. */
  renovar(id: string, expiraEm: Date, agora: Date): Promise<void>;
  revogar(id: string, motivo: string, agora: Date): Promise<void>;
  revogarDoUsuario(userId: string, motivo: string, agora: Date): Promise<number>;
  /** Remove sessões expiradas ou revogadas antes de `antesDe`. */
  limpar(antesDe: Date): Promise<number>;
}

export interface RepositorioSegredos {
  obter(nome: string): Promise<string | null>;
  /** Grava se ainda não existir; retorna o valor efetivo (o já gravado, se outra instância gravou antes). */
  definirSeAusente(nome: string, valor: string): Promise<string>;
}

/** Agrupa os repositórios de um provedor (SQL Server ou Portátil). */
export interface ProvedorPersistencia {
  readonly nome: 'SqlServer' | 'Portatil';
  readonly descricao: string;
  inicializar(): Promise<void>;
  encerrar(): Promise<void>;
  readonly estado: RepositorioEstado;
  readonly kv: RepositorioKv;
  readonly usuarios: RepositorioUsuarios;
  readonly auditoria: RepositorioAuditoria;
  readonly documentos: RepositorioDocumentos;
  readonly anexos: RepositorioAnexos;
  readonly passaportes: RepositorioPassaportes;
  readonly backups: RepositorioBackups;
  readonly sessoes: RepositorioSessoes;
  readonly segredos: RepositorioSegredos;
}

/** Token de injeção do provedor de persistência ativo. */
export const PROVEDOR_PERSISTENCIA = Symbol('PROVEDOR_PERSISTENCIA');
