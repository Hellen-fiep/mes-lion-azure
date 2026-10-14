// =====================================================================
// Gera uma view SQL por coleção do estado (rel.op, rel.materiais, rel.op_etapas…), com uma coluna por campo
// encontrado nos registros — porte do Relacional/GeradorViews.cs (mesmo SQL e mesma assinatura: views
// geradas por um servidor não são recriadas pelo outro). Coleções e campos novos do frontend aparecem
// sozinhos no SQL Server / Power BI, sem alterar o esquema.
// =====================================================================
import { createHash } from 'node:crypto';
import { analisarColecao } from '../../comum/json-estado';

export interface DefinicaoView {
  colecao: string;
  nomeView: string;
  assinatura: string;
  colunas: number;
  sql: string;
}

const NOMES_RESERVADOS = new Set(
  [
    'relacionamentos',
    'views_geradas',
    'sincronizacao_status',
    'qualidade_dados',
    'fn_num',
    'usp_sincronizar_modelo_relacional',
  ].map((n) => n.toUpperCase()),
);

const hashHex = (algoritmo: 'sha1' | 'sha256', texto: string) =>
  createHash(algoritmo).update(texto, 'utf8').digest('hex');

/** Maiúsculas caractere a caractere (StringComparer.OrdinalIgnoreCase do .NET). */
function chaveSemCaixa(s: string): string {
  let r = '';
  for (const ch of s) {
    const u = ch.toUpperCase();
    r += u.length === ch.length ? u : ch;
  }
  return r;
}

/** char.IsLetterOrDigit do .NET (por unidade UTF-16). */
const letraOuDigito = (ch: string) => /[\p{L}\p{Nd}]/u.test(ch);

export function nomeView(colecao: string): string {
  let nome = '';
  for (let i = 0; i < colecao.length; i++) {
    const ch = colecao[i];
    nome += letraOuDigito(ch) || ch === '_' ? ch : '_';
  }
  if (nome.length === 0) nome = 'colecao';
  if (
    NOMES_RESERVADOS.has(chaveSemCaixa(nome)) ||
    nome.toLowerCase().startsWith('vw_') ||
    /^[0-9]/.test(nome) ||
    /^\p{Nd}/u.test(nome)
  ) {
    nome = 'col_' + nome;
  }
  if (nome.length > 120) nome = nome.slice(0, 100) + '_' + hashHex('sha1', colecao).toUpperCase().slice(0, 8);
  return nome;
}

export const identificador = (nome: string) => '[' + nome.replace(/]/g, ']]') + ']';
export const literal = (s: string) => "N'" + s.replace(/'/g, "''") + "'";

/** Caminho JSON do SQL Server para uma chave qualquer: $."chave" (com escapes). */
export function caminhoJson(chave: string): string {
  let r = '$."';
  for (let i = 0; i < chave.length; i++) {
    const ch = chave[i];
    const c = ch.charCodeAt(0);
    if (ch === '"') r += '\\"';
    else if (ch === '\\') r += '\\\\';
    else if (c < 0x20) r += '\\u' + c.toString(16).padStart(4, '0');
    else r += ch;
  }
  return r + '"';
}

const comentario = (colecao: string) => colecao.replace(/\*\//g, '* /');

export function gerarView(colecao: string, conteudo: Buffer): DefinicaoView | null {
  let analise;
  try {
    analise = analisarColecao(conteudo);
  } catch {
    return null;
  }
  const view = nomeView(colecao);
  const fqn = 'rel.' + identificador(view);

  if (analise.tipo === 'objeto') {
    const sql = `CREATE OR ALTER VIEW ${fqn}
AS
/* Gerada automaticamente pelo MES LION a partir da coleção ${comentario(colecao)} (objeto chave/valor). */
SELECT r.[key] AS [chave], r.[value] AS [valor], r.[type] AS [tipo_json]
FROM dbo.app_state_collection c
CROSS APPLY OPENJSON(c.content) r
WHERE c.name = ${literal(colecao)};`;
    return { colecao, nomeView: view, assinatura: hashHex('sha256', `OBJ|${colecao}|${view}`), colunas: 3, sql };
  }
  if (analise.tipo !== 'lista') return null;

  if (analise.objetos === 0) {
    const sql = `CREATE OR ALTER VIEW ${fqn}
AS
/* Gerada automaticamente pelo MES LION a partir da coleção ${comentario(colecao)} (lista de valores). */
SELECT TRY_CAST(r.[key] AS INT) AS [_linha], r.[value] AS [valor], r.[type] AS [tipo_json]
FROM dbo.app_state_collection c
CROSS APPLY OPENJSON(c.content) r
WHERE c.name = ${literal(colecao)};`;
    return { colecao, nomeView: view, assinatura: hashHex('sha256', `VAL|${colecao}|${view}`), colunas: 3, sql };
  }

  // Nomes de coluna únicos (identificadores do SQL Server não diferenciam maiúsculas na collation padrão).
  const usados = new Set<string>([chaveSemCaixa('_linha')]);
  const colunas: { coluna: string; chave: string; comoJson: boolean }[] = [];
  for (const campo of analise.campos) {
    const chave = campo.chave;
    if (!chave.trim()) continue; // caminho JSON vazio não é suportado pelo SQL Server
    let base = chave.trim();
    if (base.length > 120) base = base.slice(0, 110) + '_' + hashHex('sha1', chave).toUpperCase().slice(0, 6);
    let nome = base;
    for (let i = 2; usados.has(chaveSemCaixa(nome)); i++) nome = `${base}_${i}`;
    usados.add(chaveSemCaixa(nome));
    colunas.push({ coluna: nome, chave, comoJson: campo.complexos > campo.escalares });
  }

  let sql =
    `CREATE OR ALTER VIEW ${fqn}\nAS\n` +
    `/* Gerada automaticamente pelo MES LION a partir da coleção ${comentario(colecao)}` +
    ` (${analise.objetos} registros, ${colunas.length} campos). Campos complexos (objetos/listas) vêm como JSON. */\n` +
    'SELECT TRY_CAST(r.[key] AS INT) AS [_linha], j.*\nFROM dbo.app_state_collection c\nCROSS APPLY OPENJSON(c.content) r\nCROSS APPLY OPENJSON(r.[value]) WITH (\n';
  colunas.forEach((c, i) => {
    sql += `    ${identificador(c.coluna)} NVARCHAR(MAX) ${literal(caminhoJson(c.chave))}${c.comoJson ? ' AS JSON' : ''}${i < colunas.length - 1 ? ',\n' : '\n'}`;
  });
  sql += `) j\nWHERE c.name = ${literal(colecao)} AND r.[type] = 5;`;

  const assinatura = hashHex(
    'sha256',
    `ARR|${colecao}|${view}|` + colunas.map((c) => `${c.coluna}=${c.chave}${c.comoJson ? ':J' : ''}`).join('|'),
  );
  return { colecao, nomeView: view, assinatura, colunas: colunas.length + 1, sql };
}
