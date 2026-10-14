#!/usr/bin/env node
// =====================================================================
// Monta o pacote de implantação da API NestJS (Azure App Service Linux/Node 22, servidor Windows/Linux com Node):
//   pacote/app/
//     MesLion.Server, MesLion.Server.cmd   mesmos comandos do executável .NET (--urls, --importar-migracao, --exportar…)
//     dist/                                código compilado (inclui o cliente Prisma gerado)
//     wwwroot/                             frontend do MES (cópia byte a byte de src/MesLion.Server/wwwroot)
//     sql/                                 scripts T-SQL 001–006 (aplicados na inicialização)
//     appsettings.json, package.json
//     node_modules/                        somente dependências de produção, nas versões do package-lock.json
// Uso: npm run build && npm run pacote [-- <pasta_destino>]
// =====================================================================
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ = path.resolve(API, '..', '..');
const DESTINO = path.resolve(process.argv[2] ?? path.join(API, 'pacote', 'app'));

if (!existsSync(path.join(API, 'dist', 'main.js'))) {
  console.error('dist/main.js não encontrado: rode "npm run build" antes.');
  process.exit(1);
}

rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });

// 1) código compilado (sem o .tsbuildinfo)
cpSync(path.join(API, 'dist'), path.join(DESTINO, 'dist'), {
  recursive: true,
  filter: (origem) => !origem.endsWith('.tsbuildinfo'),
});

// 2) frontend idêntico ao do servidor .NET (sem conversões)
cpSync(path.join(RAIZ, 'src', 'MesLion.Server', 'wwwroot'), path.join(DESTINO, 'wwwroot'), { recursive: true });

// 3) scripts SQL: 001–005 (os mesmos do servidor .NET) + 006 (sessões JWT da API)
mkdirSync(path.join(DESTINO, 'sql'));
for (const pasta of [path.join(RAIZ, 'src', 'MesLion.Server', 'Sql'), path.join(API, 'sql')]) {
  for (const nome of readdirSync(pasta).filter((n) => /^\d{3}_.+\.sql$/i.test(n))) {
    cpSync(path.join(pasta, nome), path.join(DESTINO, 'sql', nome));
  }
}

// 4) configuração e package.json de produção
cpSync(path.join(API, 'appsettings.json'), path.join(DESTINO, 'appsettings.json'));
const pacote = JSON.parse(readFileSync(path.join(API, 'package.json'), 'utf8'));
writeFileSync(
  path.join(DESTINO, 'package.json'),
  JSON.stringify(
    {
      name: pacote.name,
      version: pacote.version,
      description: pacote.description,
      private: true,
      license: pacote.license,
      main: 'dist/main.js',
      engines: pacote.engines,
      scripts: { start: 'node dist/main.js' },
      dependencies: pacote.dependencies,
    },
    null,
    2,
  ) + '\n',
);

// 5) dependências de produção: fechamento pela resolução de módulos do Node, a partir das "dependencies"
//    (cópia das já instaladas no workspace: mesmas versões do package-lock.json). Ficam de fora as dependências
//    só de build: o CLI do Prisma e o TypeScript (peerDependencies do @prisma/client) e os plugins de bundler
//    do Sentry (@sentry/node/webpack|vite…, que o servidor não carrega).
const EXCLUIDOS = new Set(['prisma', 'typescript', '@sentry/bundler-plugins']);
const modulosRaiz = path.join(RAIZ, 'node_modules');

/** Pasta do pacote `nome` visível a partir de `pastaQuePede` (node_modules subindo até a raiz). */
function resolverPacote(nome, pastaQuePede) {
  for (let p = pastaQuePede; ; p = path.dirname(p)) {
    const c = path.join(p, 'node_modules', ...nome.split('/'));
    if (existsSync(path.join(c, 'package.json'))) return c;
    if (p === path.dirname(p) || p === RAIZ) return null;
  }
}

const incluidos = new Set();
const pendentes = Object.keys(pacote.dependencies).map((nome) => ({ nome, de: API, obrigatorio: true }));
while (pendentes.length) {
  const { nome, de, obrigatorio } = pendentes.pop();
  if (EXCLUIDOS.has(nome)) continue;
  const pasta = resolverPacote(nome, de);
  if (!pasta) {
    if (obrigatorio) throw new Error(`Dependência não instalada: ${nome} (pedida por ${de})`);
    continue;
  }
  const real = path.resolve(pasta);
  if (incluidos.has(real)) continue;
  incluidos.add(real);
  const pj = JSON.parse(readFileSync(path.join(real, 'package.json'), 'utf8'));
  for (const d of Object.keys(pj.dependencies ?? {})) pendentes.push({ nome: d, de: real, obrigatorio: true });
  for (const d of Object.keys(pj.optionalDependencies ?? {})) pendentes.push({ nome: d, de: real, obrigatorio: false });
  for (const d of Object.keys(pj.peerDependencies ?? {})) pendentes.push({ nome: d, de: real, obrigatorio: false });
}

// Arquivos que não são usados em execução (tipos, mapas de fontes, compiladores de consulta de outros bancos).
const descartar = (arquivo) => {
  const n = path.basename(arquivo);
  if (/\.(d\.ts|d\.mts|d\.cts|map|tsbuildinfo)$/i.test(n)) return true;
  if (arquivo.includes(path.join('@prisma', 'client', 'runtime'))) {
    if (/^query_compiler_/.test(n) && !/^query_compiler_fast_bg\.sqlserver\.(js|wasm-base64\.js)$/.test(n)) return true;
    if (/\.mjs$/.test(n)) return true;
  }
  return false;
};

let copiados = 0;
for (const real of [...incluidos].sort()) {
  if (!real.startsWith(modulosRaiz + path.sep)) throw new Error(`Dependência fora de node_modules: ${real}`);
  const alvo = path.join(DESTINO, 'node_modules', path.relative(modulosRaiz, real));
  cpSync(real, alvo, {
    recursive: true,
    dereference: true,
    // pacotes aninhados (node_modules internos) entram por conta própria, se forem necessários
    filter: (origem) => !path.relative(real, origem).split(path.sep).includes('node_modules') && !descartar(origem),
  });
  copiados++;
}

// 6) lançadores com o mesmo nome do executável .NET (scripts e testes existentes funcionam sem alteração)
writeFileSync(
  path.join(DESTINO, 'MesLion.Server'),
  '#!/bin/sh\n# MES LION — API NestJS (mesmos argumentos do executável .NET)\nDIR="$(cd "$(dirname "$0")" && pwd)"\nexec node "$DIR/dist/main.js" "$@"\n',
);
chmodSync(path.join(DESTINO, 'MesLion.Server'), 0o755);
writeFileSync(
  path.join(DESTINO, 'MesLion.Server.cmd'),
  '@echo off\r\nrem MES LION - API NestJS (mesmos argumentos do executavel .NET). Requer Node.js 22 LTS.\r\nnode "%~dp0dist\\main.js" %*\r\n',
);

const tamanho = (p) => {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((s, n) => s + tamanho(path.join(p, n)), 0);
};
console.log(`Pacote montado em ${DESTINO}`);
console.log(
  `  dependências de produção: ${copiados} pacotes, ${(tamanho(path.join(DESTINO, 'node_modules')) / 1048576).toFixed(1)} MB`,
);
console.log(`  total: ${(tamanho(DESTINO) / 1048576).toFixed(1)} MB`);
