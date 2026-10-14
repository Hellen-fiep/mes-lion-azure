#!/usr/bin/env node
// =====================================================================
// Confere se o prisma/schema.prisma corresponde ao banco criado pelos scripts T-SQL (001–006).
// Entrada: a saída de
//   prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
// (o que o Prisma faria para deixar o banco igual ao schema). Ignora, de propósito:
//  - as tabelas que a API não modela (camada relacional mantida pela procedure rel.usp_sincronizar_modelo_relacional,
//    dbo.data_protection_keys do servidor .NET);
//  - a forma de escrever os padrões de texto (N'USER' no banco × 'USER' no Prisma), que não muda nada.
// Qualquer outra diferença nas tabelas da API (coluna, tipo, índice, chave) faz o CI falhar.
// Uso: node scripts/conferir-esquema-prisma.mjs <arquivo_diff.sql>
// =====================================================================
import { readFileSync } from 'node:fs';

const TABELAS_DA_API = new Set([
  'users',
  'app_state',
  'app_state_collection',
  'app_storage',
  'audit_log',
  'equipment',
  'equipment_documents',
  'attachments',
  'published_passports',
  'state_backups',
  'auth_sessions',
  'app_secrets',
  'schema_version',
]);

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Uso: node scripts/conferir-esquema-prisma.mjs <arquivo_diff.sql>');
  process.exit(2);
}
const texto = readFileSync(arquivo, 'utf8');
if (!/BEGIN TRY|empty migration/i.test(texto)) {
  console.error('A saída do "prisma migrate diff" não parece um script SQL:\n' + texto.slice(0, 2000));
  process.exit(1);
}

// Comandos SQL (sem comentários), separados por ";" no fim da linha.
const comandos = texto
  .split('\n')
  .filter((l) => !/^\s*--/.test(l))
  .join('\n')
  .split(/;\s*\n/)
  .map((c) => c.trim())
  .filter(Boolean);

/** Só troca de restrições DEFAULT (DF_...): DROP CONSTRAINT [DF_a], [DF_b] / ADD CONSTRAINT [DF_a] DEFAULT ... FOR [col]. */
function somentePadroes(comando) {
  const drop = /^ALTER TABLE \[dbo\]\.\[\w+\] DROP CONSTRAINT ((\[DF_\w+\]\s*,?\s*)+)$/s.test(comando);
  const add =
    /^ALTER TABLE \[dbo\]\.\[\w+\] ADD /s.test(comando) &&
    comando
      .replace(/^ALTER TABLE \[dbo\]\.\[\w+\] ADD /s, '')
      .split(/,\s*(?=CONSTRAINT )/)
      .every((p) => /^CONSTRAINT \[DF_\w+\] DEFAULT .+ FOR \[\w+\]$/s.test(p.trim()));
  return drop || add;
}

const relevantes = [];
let ignoradas = 0;
for (const c of comandos) {
  if (/^(BEGIN|COMMIT|END|IF|ROLLBACK|THROW)\b/i.test(c)) continue;
  const tabela = /\[dbo\]\.\[(\w+)\]/.exec(c)?.[1];
  if (!tabela || !TABELAS_DA_API.has(tabela)) {
    ignoradas++;
    continue;
  }
  if (somentePadroes(c)) {
    ignoradas++;
    continue;
  }
  relevantes.push(c);
}

if (relevantes.length) {
  console.error(`schema.prisma DIFERENTE do banco em ${relevantes.length} comando(s) nas tabelas da API:\n`);
  for (const c of relevantes) console.error('  ' + c.replace(/\n/g, '\n  ') + ';\n');
  process.exit(1);
}
console.log(
  `schema.prisma corresponde ao banco nas ${TABELAS_DA_API.size} tabelas da API ` +
    `(${ignoradas} diferença(s) ignorada(s): tabelas não modeladas e forma de escrever os padrões de texto).`,
);
