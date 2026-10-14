// =====================================================================
// Entidades do domínio do MES LION (as mesmas do servidor .NET: Persistencia/Contratos.cs).
// Datas em Date (instante); identificadores GUID em texto minúsculo.
// =====================================================================

export const Perfis = {
  Admin: 'ADMIN',
  Usuario: 'USER',
} as const;

export interface Usuario {
  id: string;
  username: string;
  fullName: string;
  passwordHash: string;
  role: string;
  active: boolean;
  /** LOCAL (senha) ou ENTRA (Microsoft Entra ID). */
  authProvider: string;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Uma coleção de nível superior do estado do MES (ex.: "op", "materiais", "meta"), como gravada. */
export interface ColecaoArmazenada {
  nome: string;
  ordem: number;
  conteudo: Buffer;
  hash: Buffer;
}

/** Coleção recebida do navegador, já validada, com o JSON bruto preservado. */
export interface ColecaoRecebida extends ColecaoArmazenada {
  /** Quantidade de itens, quando a coleção é uma lista. */
  itens: number | null;
}

export interface ResultadoGravacaoEstado {
  versao: number;
  alteradas: string[];
  removidas: string[];
  bytesGravados: number;
}

export interface ResumoEstado {
  versao: number;
  colecoes: number;
  bytes: number;
  atualizadoEm: Date | null;
  atualizadoPor: string | null;
}

export interface RegistroAuditoria {
  userId: string | null;
  username: string | null;
  module: string;
  action: string;
  recordKey: string | null;
  changedAt: Date;
  /** JSON dos detalhes (texto). */
  detailsJson: string;
}

export interface DocumentoEquipamento {
  id: string;
  equipmentCode: string;
  originalName: string;
  storedName: string;
  mimeType: string | null;
  fileSize: number;
  documentType: string | null;
  revision: string | null;
  active: boolean;
  uploadedAt: Date;
  uploadedBy: string | null;
}

export interface Anexo {
  id: string;
  scope: string;
  recordId: string;
  originalName: string;
  storedKey: string;
  mimeType: string | null;
  fileSize: number;
  uploadedAt: Date;
  uploadedBy: string | null;
}

export interface PassaportePublicado {
  id: string;
  storedKey: string;
  sizeBytes: number;
  publishedAt: Date;
  publishedBy: string | null;
}

export interface BackupEstado {
  id: number;
  storedKey: string;
  reason: string;
  sizeBytes: number;
  stateVersion: number;
  createdAt: Date;
  createdBy: string | null;
  createdByName: string | null;
}

/** Sessão de login: o JWT de acesso referencia a sessão (sid); o refresh token é guardado só como SHA-256. */
export interface SessaoAutenticacao {
  id: string;
  userId: string;
  refreshHash: Buffer;
  previousRefreshHash: Buffer | null;
  /** LOCAL ou ENTRA. */
  provider: string;
  /** COOKIE (navegador) ou TOKEN (cliente com cabeçalho Bearer). */
  channel: 'COOKIE' | 'TOKEN';
  createdAt: Date;
  rotatedAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}
