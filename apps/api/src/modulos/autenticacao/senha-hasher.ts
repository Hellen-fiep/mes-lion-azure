// =====================================================================
// Hash de senhas compatível com o formato V3 do ASP.NET Core Identity (o mesmo do servidor .NET):
// PBKDF2-HMAC-SHA512, 100.000 iterações, sal de 128 bits, subchave de 256 bits — os dois servidores
// aceitam as mesmas senhas no mesmo banco. Também verifica hashes bcrypt ($2a$/$2b$/$2y$) herdados do
// PostgreSQL (pgcrypto), que são convertidos para PBKDF2 no primeiro login.
// =====================================================================
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';

const pbkdf2Async = promisify(pbkdf2);

/** Marcador de usuário sem senha local (ex.: autenticado só pelo Microsoft Entra ID). */
export const SEM_SENHA_LOCAL = '!SEM_SENHA_LOCAL';

const ITERACOES = 100_000;
const TAMANHO_SAL = 16;
const TAMANHO_SUBCHAVE = 32;
const ALGORITMOS: Record<number, string> = { 0: 'sha1', 1: 'sha256', 2: 'sha512' };

export type ResultadoVerificacao = 'falhou' | 'sucesso' | 'sucesso-requer-atualizacao';

export async function gerarHashSenha(senha: string): Promise<string> {
  const sal = randomBytes(TAMANHO_SAL);
  const subchave = await pbkdf2Async(Buffer.from(senha, 'utf8'), sal, ITERACOES, TAMANHO_SUBCHAVE, 'sha512');
  const saida = Buffer.alloc(13 + TAMANHO_SAL + TAMANHO_SUBCHAVE);
  saida[0] = 0x01; // formato V3
  saida.writeUInt32BE(2, 1); // HMACSHA512
  saida.writeUInt32BE(ITERACOES, 5);
  saida.writeUInt32BE(TAMANHO_SAL, 9);
  sal.copy(saida, 13);
  subchave.copy(saida, 13 + TAMANHO_SAL);
  return saida.toString('base64');
}

export function ehHashBcrypt(hash: string | null | undefined): hash is string {
  return !!hash && hash.length === 60 && hash[0] === '$' && hash[1] === '2' && hash[3] === '$' && hash[6] === '$';
}

export async function verificarSenha(senha: string, hash: string | null | undefined): Promise<ResultadoVerificacao> {
  if (!hash || hash.startsWith('!')) return 'falhou';
  if (ehHashBcrypt(hash)) {
    if (!['a', 'b', 'y'].includes(hash[2])) return 'falhou'; // $2x$ (modo do bug antigo) não é suportado
    try {
      return (await bcrypt.compare(senha, hash)) ? 'sucesso-requer-atualizacao' : 'falhou';
    } catch {
      return 'falhou';
    }
  }
  return (await verificarV3(senha, hash)) ? 'sucesso' : 'falhou';
}

async function verificarV3(senha: string, hash: string): Promise<boolean> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(hash) || hash.length % 4 !== 0) return false;
  const dados = Buffer.from(hash, 'base64');
  if (dados.length < 13 || dados[0] !== 0x01) return false;
  const prf = dados.readUInt32BE(1);
  const iteracoes = dados.readUInt32BE(5);
  const tamanhoSal = dados.readUInt32BE(9);
  if (tamanhoSal < 16 || iteracoes < 1 || iteracoes > 10_000_000 || 13 + tamanhoSal >= dados.length) return false;
  const algoritmo = ALGORITMOS[prf];
  if (!algoritmo) return false;
  const sal = dados.subarray(13, 13 + tamanhoSal);
  const esperado = dados.subarray(13 + tamanhoSal);
  if (esperado.length < 16) return false;
  const obtido = await pbkdf2Async(Buffer.from(senha, 'utf8'), sal, iteracoes, esperado.length, algoritmo);
  return timingSafeEqual(obtido, esperado);
}
