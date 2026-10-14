// =====================================================================
// Scripts T-SQL versionados (001…005 do servidor .NET + 006 da API), aplicados na inicialização e
// registrados em dbo.schema_version com o SHA-256 do conteúdo — o mesmo controle do servidor .NET,
// que assim reconhece os scripts já aplicados pela API (e vice-versa).
// =====================================================================
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '@nestjs/common';
import sql from 'mssql';

export interface ScriptSql {
  nome: string;
  conteudo: string;
  checksum: string;
  arquivo: string;
}

/** Pastas onde procurar os scripts: o pacote (sql/) e, em desenvolvimento, o repositório. */
export function pastasScripts(raizConteudo: string): string[] {
  const raizApp = path.resolve(__dirname, '..', '..', '..', '..');
  const candidatas = [
    path.join(raizConteudo, 'sql'),
    path.join(raizApp, 'sql'),
    path.resolve(raizApp, '..', '..', 'src', 'MesLion.Server', 'Sql'),
  ];
  return [...new Set(candidatas)].filter((p) => existsSync(p));
}

/** Lê os scripts *.sql (sem repetir nomes), em ordem de nome. O checksum é o SHA-256 do texto sem BOM. */
export function lerScripts(pastas: string[]): ScriptSql[] {
  const porNome = new Map<string, ScriptSql>();
  for (const pasta of pastas) {
    for (const nome of readdirSync(pasta)) {
      if (!/^\d{3}_.+\.sql$/i.test(nome) || porNome.has(nome)) continue;
      const arquivo = path.join(pasta, nome);
      let bytes = readFileSync(arquivo);
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
      porNome.set(nome, {
        nome,
        conteudo: bytes.toString('utf8'),
        checksum: createHash('sha256').update(bytes).digest('hex'),
        arquivo,
      });
    }
  }
  return [...porNome.values()].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
}

/** Divide o script nos lotes separados por "GO" (como o sqlcmd / o servidor .NET). */
export function dividirLotes(script: string): string[] {
  const lotes: string[] = [];
  let atual: string[] = [];
  for (const linha of script.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*GO\s*(--.*)?$/i.test(linha)) {
      const texto = atual.join('\n');
      if (texto.trim()) lotes.push(texto + '\n');
      atual = [];
    } else atual.push(linha);
  }
  const texto = atual.join('\n');
  if (texto.trim()) lotes.push(texto + '\n');
  return lotes;
}

/** Cria o banco (se não existir) conectando no master. Sem permissão: segue e tenta usar o banco direto. */
export async function garantirBanco(config: sql.config, log: Logger): Promise<void> {
  const banco = config.database ?? '';
  if (!banco || banco.toLowerCase() === 'master') return;
  const pool = new sql.ConnectionPool({ ...config, database: 'master', pool: { max: 1, min: 0 } });
  try {
    await pool.connect();
    const r = await pool
      .request()
      .input('n', sql.NVarChar(128), banco)
      .query<{ criado: number }>(
        "IF DB_ID(@n) IS NULL BEGIN DECLARE @s NVARCHAR(400) = N'CREATE DATABASE ' + QUOTENAME(@n); EXEC(@s); SELECT 1 AS criado; END ELSE SELECT 0 AS criado;",
      );
    if (r.recordset[0]?.criado === 1) log.log(`Banco de dados ${banco} criado em ${config.server}.`);
  } catch (e) {
    log.warn(`Não foi possível verificar/criar o banco ${banco} via master: ${(e as Error).message}`);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

/** Aplica os scripts novos ou alterados. Retorna os nomes aplicados. */
export async function aplicarScripts(pool: sql.ConnectionPool, scripts: ScriptSql[], log: Logger): Promise<string[]> {
  const aplicados = new Map<string, string>();
  const existentes = await pool
    .request()
    .query<{ script: string; checksum: string }>(
      "IF OBJECT_ID(N'dbo.schema_version', N'U') IS NOT NULL SELECT script, checksum FROM dbo.schema_version;",
    );
  for (const r of existentes.recordset ?? []) aplicados.set(r.script.toLowerCase(), r.checksum.trim());

  const feitos: string[] = [];
  for (const s of scripts) {
    if (aplicados.get(s.nome.toLowerCase()) === s.checksum) continue;
    log.log(`Aplicando script SQL ${s.nome}...`);
    for (const lote of dividirLotes(s.conteudo)) await pool.request().batch(lote);
    await pool
      .request()
      .input('s', sql.NVarChar(200), s.nome)
      .input('h', sql.Char(64), s.checksum)
      .query(
        `MERGE dbo.schema_version AS t USING (SELECT @s AS script, @h AS checksum) AS s ON t.script = s.script
WHEN MATCHED THEN UPDATE SET checksum = s.checksum, applied_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN INSERT (script, checksum) VALUES (s.script, s.checksum);`,
      );
    feitos.push(s.nome);
  }
  return feitos;
}
