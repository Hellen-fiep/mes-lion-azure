# Fase 1 — API em NestJS + Prisma (padrão FIEP)

A fase 1 troca o **servidor** pelo padrão de backend da FIEP e não mexe no resto: o frontend é o mesmo, as rotas, o banco,
os scripts T-SQL e os arquivos também. A API nova fica em `apps/api`. O servidor .NET (`src/MesLion.Server`) continua no
repositório, inalterado, e os dois podem usar o **mesmo banco** e a **mesma pasta de arquivos**.

| Item do padrão FIEP | Como ficou |
|---|---|
| NestJS com módulos DDD (controller / service / DTO / entidade) | `apps/api/src/modulos/*`, com domínio em `src/dominio` (entidades e portas de repositório) |
| Prisma ORM | Prisma 7 com `@prisma/adapter-mssql` (SQL Server / Azure SQL); `prisma/schema.prisma` |
| class-validator | DTOs com `class-validator` + `class-transformer`, devolvendo as **mesmas mensagens de erro** do contrato original |
| JWT access + refresh | token de acesso (15 min) + refresh token rotativo (sessão deslizante de 12 h), revogável |
| Swagger | `/api/docs` (interface) e `/api/docs-json` (OpenAPI), gerados pelos decorators |
| Jest | 105 testes de unidade + 9 testes e2e (supertest); cobertura combinada de 70% das linhas |
| ESLint / Prettier / husky / lint-staged | `eslint.config.mjs` (typescript-eslint com verificação de tipos), `.prettierrc`, hook de pre-commit |
| Azure DevOps | `azure-pipelines.yml` (lint, testes, pacote, contrato HTTP com SQL Server, implantação opcional) |
| Sentry | `@sentry/nestjs`, ligado só quando há DSN; não envia corpos, cookies nem tokens |

Versões: Node.js 22 LTS, NestJS 11.2, TypeScript 5.9, Prisma 7.10, Jest 30, ESLint 10.

## 1. Estrutura

```
apps/api/
  src/
    main.ts                       linha de comando (mesmos argumentos do MesLion.Server) e inicialização
    instrument.ts                 Sentry (carregado antes de tudo)
    http.ts                       pipeline HTTP: segurança, compressão, frontend, cookies, corpo bruto, Swagger
    configuracao/                 appsettings.json < appsettings.Local.json < variáveis de ambiente < linha de comando
    dominio/                      entidades, portas de repositório (interfaces) e erros de domínio
    infra/
      persistencia/sqlserver/     Prisma (SQL Server / Azure SQL), scripts T-SQL, connection string ADO.NET → driver
      persistencia/portatil/      modo Portátil (arquivos JSON no MESMO formato do servidor .NET)
      arquivos/                   pasta local ou Azure Blob Storage (SDK oficial, identidade gerenciada)
      relacional/                 gerador das views rel.<coleção>
    modulos/
      autenticacao/               login, JWT + refresh, guarda global, Microsoft Entra ID (Easy Auth), senhas
      usuarios/  auditoria/       /api/users e /api/audit
      estado/                     /api/bootstrap e /api/storage (estado do MES gravado por coleção, sem reserializar)
      arquivos/                   documentos de equipamentos, anexos, passaporte publicado
      banco/                      backup, exportar, importar, /api/info, /healthz
      relacional/                 sincronização da camada relacional do SQL Server em segundo plano
      migracao/                   importação do pacote do PostgreSQL (--importar-migracao)
      plataforma/                 inicialização (esquema, administrador, seed) e filtro de erros
  prisma/schema.prisma            tabelas que a API usa (database-first, com @@map para os nomes do banco)
  sql/006_autenticacao_jwt.sql    tabelas novas: dbo.auth_sessions e dbo.app_secrets
  test/app.e2e-spec.ts            e2e com supertest
  scripts/montar-pacote.mjs       pacote de implantação (App Service Linux / Node 22)
```

## 2. O contrato HTTP não mudou

Todas as rotas usadas pelo frontend respondem como no servidor .NET (e no PowerShell original): mesmos caminhos,
mesmos corpos, mesmos códigos e mesmas mensagens (por exemplo, `401 {"error":"Não autenticado"}`, `"API não encontrada"`,
`"Usuário, nome e senha são obrigatórios"`). O estado do MES continua sendo gravado **exatamente como o navegador envia**,
dividido por coleção, com SHA-256 por coleção, trava de aplicação no SQL Server (`sp_getapplock`) e gravação só do que mudou.

A prova é a mesma bateria de testes de caixa-preta do servidor .NET, rodada contra a API nova (seção 7).

Rotas novas (não usadas pelo frontend atual; servem às próximas fases e a integrações):

| Rota | Para quê |
|---|---|
| `POST /api/auth/token` | login de clientes de API (Next.js, app Expo, integrações): devolve `accessToken` (Bearer) e `refreshToken` |
| `POST /api/auth/refresh` | troca o refresh token por um novo par (clientes Bearer) ou renova os cookies (navegador) |
| `GET /api/docs`, `GET /api/docs-json` | documentação Swagger / OpenAPI |

## 3. Login com JWT (acesso + refresh)

```
Navegador (frontend atual)                         Clientes de API (fases 2 e 3)
  POST /api/auth/login                               POST /api/auth/token
   └─ Set-Cookie MESSESSION = JWT de acesso           └─ { accessToken, refreshToken, expiresIn }
      (HttpOnly, SameSite=Lax, Path=/)                 Authorization: Bearer <accessToken>
   └─ Set-Cookie MESREFRESH = refresh token            POST /api/auth/refresh { refreshToken }
      (HttpOnly, SameSite=Strict, Path=/api)            └─ novo par (o refresh muda a cada uso)
  Qualquer rota /api com o acesso vencido:
   └─ renovação transparente com o MESREFRESH (novo MESSESSION na própria resposta)
```

* **Token de acesso**: JWT HS256 (emissor `mes-lion`, audiência `mes-lion-api`), válido por 15 min, com o usuário, o perfil
  e o id da sessão. A chave vem de `MesLion:Autenticacao:Jwt:Segredo` (ex.: Azure Key Vault) ou é gerada na primeira
  execução e guardada no banco (`dbo.app_secrets`), para valer entre reinícios e entre instâncias do App Service.
* **Refresh token**: opaco (256 bits), **nunca gravado** — o banco guarda só o SHA-256 (`dbo.auth_sessions`). A sessão tem
  expiração deslizante de 12 h sem uso (`MesLion:Autenticacao:SessaoHoras`), como o cookie do servidor .NET.
* **Rotação e reuso**: no navegador o refresh é trocado quando tem mais de 60 min; para clientes Bearer, a cada uso. O token
  anterior ainda vale por 60 s (requisições simultâneas do navegador); depois disso, reutilizá-lo **revoga a sessão**
  (indica token copiado).
* **Revogação**: logout revoga a sessão (o mesmo token de acesso deixa de valer); desativar um usuário revoga todas as
  sessões dele; mudanças de perfil valem em até 20 s (mesmo cache do servidor .NET).
* **Microsoft Entra ID**: com o login Microsoft do App Service (Easy Auth), a API cria a sessão do usuário do Entra a partir
  dos cabeçalhos `X-MS-CLIENT-PRINCIPAL*`, com provisionamento e papel `MES.Admin`, como no servidor .NET.
* **Senhas**: PBKDF2-SHA512 no formato do ASP.NET Core Identity V3 (as mesmas do servidor .NET) e os hashes bcrypt herdados
  do PostgreSQL, convertidos no primeiro login.

Configuração (`appsettings.json` ou variáveis `MesLion__Autenticacao__Jwt__*`): `Segredo`, `AcessoMinutos` (15),
`RotacaoMinutos` (60), `ToleranciaSegundos` (60), `Emissor`, `Audiencia`.

## 4. Banco de dados e Prisma

* O esquema continua versionado pelos scripts T-SQL **001–005** (os mesmos do servidor .NET) mais o **006**
  (`apps/api/sql`), aplicados na inicialização e registrados em `dbo.schema_version` com o SHA-256 de cada script. O
  servidor .NET reconhece os scripts aplicados pela API e vice-versa; o 006 só cria tabelas novas.
* O `prisma/schema.prisma` descreve as tabelas que a API lê e grava (modelo *database-first*, nomes do domínio com
  `@@map`/`@map`). A camada relacional (`rel.*`, tabelas normalizadas) continua mantida pela procedure
  `rel.usp_sincronizar_modelo_relacional`. A cada execução, o CI confere que o schema corresponde ao banco criado pelos
  scripts (`prisma migrate diff` + `apps/api/scripts/conferir-esquema-prisma.mjs`): qualquer diferença de coluna, tipo,
  índice ou chave nas tabelas da API reprova o build.
* Connection string: a **mesma** do servidor .NET (`ConnectionStrings__MesLion`, formato ADO.NET), convertida para o
  driver do Node. Suporta usuário/senha SQL e Microsoft Entra ID (`Active Directory Default`, `Managed Identity`,
  `Service Principal`). O driver SQL do Node (tedious) **não** suporta LocalDB nem autenticação integrada do Windows:
  nesses casos use um SQL Server com TCP e usuário SQL, o modo Portátil, ou o executável .NET.
* Modo Portátil: os mesmos arquivos do servidor .NET (`Dados/BancoPortatil`, propriedades em PascalCase); a mesma pasta
  pode ser aberta pelos dois servidores.

## 5. Rodar localmente

Requisitos: Node.js 22 LTS.

```bash
npm ci                                     # na raiz do repositório (workspaces) — instala também o hook do husky
npm run prisma:generate --workspace apps/api
npm run start:dev --workspace apps/api     # http://127.0.0.1:8765 (modo Portátil se não houver SQL Server)
```

Com SQL Server:

```bash
export ConnectionStrings__MesLion="Server=localhost,1433;Database=MesLion;User ID=sa;Password=...;Encrypt=true;TrustServerCertificate=true"
export MesLion__Banco__Provedor=SqlServer
npm run start:dev --workspace apps/api
```

A documentação da API fica em `http://127.0.0.1:8765/api/docs`. A linha de comando é a mesma do executável .NET:
`--urls`, `--importar-migracao <pasta> [--sobrescrever]`, `--exportar <arquivo>`, `--testar-conexao`,
`--atualizar-relacional`.

Pacote de implantação (o mesmo que o CI testa e publica como `MES_LION_API_NESTJS_app.zip`):

```bash
npm run build --workspace apps/api && npm run pacote --workspace apps/api   # gera apps/api/pacote/app
```

O pacote traz `MesLion.Server` (Linux) e `MesLion.Server.cmd` (Windows) com os mesmos argumentos do executável .NET,
o frontend (`wwwroot`), os scripts SQL e somente as dependências de produção.

## 6. Qualidade de código

* `npm run lint` (ESLint com verificação de tipos), `npm run typecheck`, `npm run format:check` (Prettier).
* Antes de cada commit, o **husky** roda o **lint-staged**: Prettier e ESLint (sem avisos) nos arquivos alterados da API.
* `npm test` (unidade), `npm run test:e2e` (supertest) e `npm run test:cov` (os dois, com cobertura combinada em
  `apps/api/coverage`: texto, lcov e Cobertura para o Azure DevOps). A cobertura do Jest é de 70% das linhas; o que fica
  de fora (SQL Server, Azure Blob, migração do PostgreSQL, camada relacional) é exercitado pelas suítes de caixa-preta
  do CI, com SQL Server, PostgreSQL e o emulador do Azure Storage reais.

Os testes de unidade reaproveitam os **mesmos vetores** dos testes do servidor .NET (hashes bcrypt gerados pelo pgcrypto,
vetores públicos OpenBSD/jBCrypt, divisão do estado, gerador de views) e hashes PBKDF2 gerados por outra implementação
(Python), garantindo que os dois servidores aceitam as mesmas senhas e geram os mesmos dados.

## 7. Validação

| Suíte | Ambiente | API NestJS |
|---|---|---|
| Jest — unidade | Node 22 | **105/105** |
| Jest — e2e (supertest) | Node 22, modo Portátil | **9/9** (cobertura combinada: 70% das linhas) |
| Contrato HTTP (`tests/testes_api.py`) | SQL Server 2022 | **95/95** |
| Contrato HTTP com arquivos no **Azure Blob Storage** (emulador Azurite) | SQL Server 2022 + Azurite | **95/95** |
| Banco SQL Server (`tests/verificar_sqlserver.py`) — esquema, camada relacional, sessões JWT | SQL Server 2022 | **46/46** |
| Navegador — fluxos completos (`tests/e2e_fluxos.py`) | SQL Server 2022, acesso local e remoto | **25/25** |
| Primeira tela após o login — todas as opções do menu (`tests/primeira_tela.py`) | SQL Server 2022 | **32/32** |
| A/B de telas contra o servidor original (`tests/ab_comparar_telas.py`) | SQL Server 2022 | **32/32** |
| Migração PostgreSQL 16 → SQL Server (`tests/teste_migracao.py`) | PostgreSQL 16 + SQL Server 2022 | **25/25** |
| Importação de pacote de migração (`tests/teste_importacao_pacote.py`) | modo Portátil | **7/7** |

Tudo roda no GitHub Actions a cada alteração (job "API NestJS + Prisma" de `.github/workflows/ci.yml`), em paralelo com o
servidor .NET.

## 8. CI/CD no Azure DevOps

`azure-pipelines.yml` (na raiz):

1. **Validar**: `npm ci` → Prisma → ESLint/TypeScript/Prettier → Jest unidade + e2e (resultados JUnit e cobertura
   Cobertura publicados no Azure DevOps)
   → build → pacote → API iniciada com **SQL Server 2022** (contêiner de serviço) → `tests/testes_api.py` → artefato
   `api-app-service`.
2. **Implantar** (opcional, só na `main`): publica o pacote no App Service e confere `/healthz`.

Para habilitar a implantação no Azure DevOps:

1. *Project settings → Service connections*: crie uma conexão **Azure Resource Manager** (nome padrão `mes-lion-azure`).
2. *Pipelines → Environments*: crie o ambiente `mes-lion-homologacao` (com aprovações, se quiser).
3. Crie a infraestrutura com o Bicep usando a API NestJS (seção 9) e anote o nome do App Service.
4. Rode o pipeline marcando **"Implantar no Azure App Service"** e informando a conexão e o nome do App Service.

## 9. Implantação no Azure

O mesmo `infra/main.bicep` cria o ambiente para qualquer um dos dois servidores:

```powershell
.\infra\implantar-azure.ps1 -GrupoRecursos rg-meslion -Servidor nestjs -Pacote .\MES_LION_API_NESTJS_app.zip
```

Com `servidorAplicacao=nestjs`, o App Service roda Node.js 22 (`node dist/main.js`), com as mesmas configurações:
Azure SQL com identidade gerenciada, Azure Blob Storage, Application Insights e, opcionalmente, login Microsoft. O
parâmetro `sentryDsn` liga o Sentry.

## 10. Monitoramento (Sentry)

Desligado por padrão. Para ligar, informe o DSN em `MesLion__Monitoramento__SentryDsn` (ou na variável padrão
`SENTRY_DSN`); opcionais: `MesLion__Monitoramento__Ambiente` e `MesLion__Monitoramento__AmostragemTraces` (0 a 1). Os erros
500 são enviados com a rota e a pilha; corpos de requisição, cookies, cabeçalhos de identidade e dados de consultas **não**
são enviados (senhas, tokens e dados de produção ficam fora).

## 11. Próximas fases

* **Fase 2** — frontend em Next.js (App Router, react-hook-form + zod, zustand, Design System com tokens e Storybook,
  WCAG 2.1), consumindo esta API com `/api/auth/token` e `/api/auth/refresh`.
* **Fase 3** — aplicativo Expo (expo-router) no mesmo monorepo, com o mesmo tema e a mesma API.
