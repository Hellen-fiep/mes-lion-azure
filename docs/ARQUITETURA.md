# MES LION 1.0 AZURE — Arquitetura

## 1. Princípio da migração

O MES LION concentra **todas as regras de cálculo, telas e correlações entre tabelas no frontend**
(`app.js` + 38 scripts de evolução). O servidor PowerShell original apenas autenticava, guardava o
estado do MES (um documento JSON no PostgreSQL) e servia arquivos.

Por isso a migração para o ecossistema Microsoft foi feita como **troca de plataforma sem troca de regras**:

* o **frontend é o mesmo**: os 42 arquivos originais continuam byte a byte idênticos, exceto o `index.html` (ver `MANIFESTO_FRONTEND.txt`);
* o **servidor** passou a ser **ASP.NET Core .NET 10 (C#)**, com **o mesmo contrato HTTP** do servidor PowerShell;
* o **banco** passou a ser **SQL Server / Azure SQL Database**, com uma camada relacional para consultas e Power BI;
* os **arquivos** (documentos, anexos, backups) vão para o **Azure Blob Storage** (ou pasta local);
* a **hospedagem** pode ser o **Azure App Service** ou um PC/servidor Windows (executável autocontido).

Arquivos do frontend alterados: apenas `index.html` (título da aba + inclusão de um script novo, carregado depois
de todos os originais): `js/mes_plataforma_azure.js` — adaptador de plataforma, sem regra de negócio, que também traz a
correção do erro herdado de **ACV e LCC** (seção 7), sem alterar registros nem cálculos.

## 2. Antes e depois

```
ANTES (MES LION 1.0 PGSQL)                           AGORA (MES LION 1.0 AZURE)
──────────────────────────                           ──────────────────────────
Navegador (Edge/Chrome)                              Navegador (Edge/Chrome)            ← mesmo frontend
  └─ HTML/CSS/JS (app.js + patches)                    └─ HTML/CSS/JS (app.js + patches) + adaptador
        │ HTTP (mesmas rotas)                                │ HTTP (mesmas rotas) + HTTPS no Azure
PowerShell TcpListener (MES_LION_SERVER.ps1)         ASP.NET Core .NET 10 (Kestrel / Azure App Service)
  └─ psql.exe (uma chamada por consulta)               ├─ Microsoft.Data.SqlClient → SQL Server / Azure SQL
PostgreSQL                                             ├─ Azure Blob Storage (ou pasta local)
  ├─ app_state.payload (jsonb, estado inteiro)         ├─ Microsoft Entra ID (App Service Authentication)
  ├─ users / audit_log / app_storage                   └─ Application Insights / Log Analytics
  └─ equipment_documents (+ server/uploads)
```

## 3. Componentes do servidor (`src/MesLion.Server`)

| Pasta | Responsabilidade |
|---|---|
| `Api/` | Rotas HTTP: autenticação, estado (`/api/bootstrap`, `/api/storage`), usuários, auditoria, documentos, anexos, backup/exportação/importação, passaporte público, `/healthz`. |
| `Estado/` | Divide o estado enviado pelo navegador por coleção (`op`, `materiais`, `sust_lci`…) **sem reserializar** os valores, grava só o que mudou e remonta o documento com a mesma ordem e o mesmo conteúdo. |
| `Persistencia/SqlServer/` | Repositórios ADO.NET para SQL Server / Azure SQL (provedor oficial `Microsoft.Data.SqlClient`, com retentativa para falhas transitórias do Azure SQL) e aplicação automática dos scripts T-SQL. |
| `Persistencia/Portatil/` | Mesmo contrato em arquivos JSON (gravação atômica) — para validação em PCs sem SQL Server. |
| `Arquivos/` | Pasta local ou Azure Blob Storage (API REST oficial; chave da conta ou identidade gerenciada). |
| `Seguranca/` | Senhas PBKDF2 no formato do ASP.NET Core Identity V3; verificação dos hashes **bcrypt do pgcrypto** (senhas antigas continuam válidas e são convertidas no primeiro login); login Microsoft Entra ID. |
| `Relacional/` | Gera uma view `rel.<coleção>` por coleção do estado e dispara a sincronização das tabelas normalizadas. |
| `Migracao/` | Importa o pacote gerado por `ferramentas/EXPORTAR_DADOS_POSTGRESQL.ps1`. |
| `Sql/` | Scripts T-SQL 001–005 (embutidos no executável; cópia em `database/sqlserver`). |

Sessão: cookie **`MESSESSION`** (HttpOnly, SameSite=Lax, Secure em HTTPS), como no original, agora
assinado pelo ASP.NET Core Data Protection. As chaves ficam no próprio banco (`dbo.data_protection_keys`),
então as sessões sobrevivem a reinícios e funcionam com mais de uma instância no Azure.

## 4. Contrato HTTP

| Rota | Servidor PowerShell | Servidor novo |
|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | sim | igual |
| `GET /api/bootstrap` → `{data, appStorage, user}` | sim (reserializava o JSON pelo PowerShell) | igual, devolvendo o JSON **exatamente** como foi gravado |
| `GET /api/storage`, `PUT /api/storage/{chave}` | sim | igual; grava somente as coleções alteradas |
| `DELETE /api/storage/{chave}` | 404 | remove a chave do localStorage (nunca apaga o estado) |
| `GET/POST /api/users`, `PUT /api/users/{id}` (ADMIN) | sim | igual |
| `GET /api/audit` (500 últimos) | sim | igual (detalhes da gravação: coleções alteradas) |
| `GET/POST /api/equipment/{código}/documents`, `GET /api/documents/{id}` | sim (*) | igual, sem corrupção de binários e com nome UTF-8 |
| `POST /api/backup`, `GET /api/export`, `POST /api/import` | **404** (botões do menu Banco falhavam) | **implementadas** (import restrito a ADMIN, com backup automático antes) |
| `POST /api/attachments` (anexos de empresas/materiais/entradas) | **404** | **implementada** |
| `POST /api/passport-publish` + `GET /passaporte/{id}.html` | **404** | **implementadas** (página pública para QR) |
| `GET /api/info`, `POST /api/open-data-folder` | **404** | implementadas |
| `GET /healthz` | — | verificação de saúde (Azure App Service) |

(*) No original, o upload exigia que o equipamento existisse na tabela `equipment` (que nunca era preenchida),
e o leitor multipart podia cortar os bytes finais de arquivos. O servidor novo garante a linha do equipamento
e lê o multipart corretamente.

## 5. Banco de dados: mapeamento PostgreSQL → SQL Server

Tipos: `uuid`→`UNIQUEIDENTIFIER`, `jsonb`→`NVARCHAR(MAX)` (JSON), `timestamptz`→`DATETIMEOFFSET(3)`,
`timestamp`→`DATETIME2(3)`, `text`→`NVARCHAR`, `numeric`→`DECIMAL(38,10)`, `boolean`→`BIT`,
`bigserial`→`BIGINT IDENTITY`, `crypt()/gen_salt('bf')`→PBKDF2 (bcrypt antigo aceito na leitura).
Colunas de código usam collation binária (comparação exata, como no PostgreSQL e no JavaScript).

| PostgreSQL (`schema.sql`, `02_extensoes…`) | SQL Server | Uso |
|---|---|---|
| `app_state` (payload jsonb) | `dbo.app_state` (versão/autor) + `dbo.app_state_collection` (uma linha por coleção) + view `dbo.vw_app_state_payload` (payload completo) | estado do MES |
| `app_storage` | `dbo.app_storage` | localStorage do frontend |
| `users` | `dbo.users` (+ `auth_provider`, `external_id` para Entra ID) | login |
| `audit_log` | `dbo.audit_log` | histórico |
| `equipment_documents`, `op_document_flags` | idem | documentos |
| `products`, `materials`, `suppliers`, `equipment`, `routes`, `route_steps`, `production_orders`, `op_steps`, `op_materials`, `battery_passports` | idem — **agora preenchidas automaticamente** a partir do estado | consultas/BI |
| `icv_snapshots`, `aicv_results`, `lcc_studies`, `equipment_scales`, `characterization_bookings`, `capacity_restrictions`, `planning_goals`, `setup_time_logs`, `stock_movements` | idem (reservadas, como no original) | — |
| — | `dbo.attachments`, `dbo.published_passports`, `dbo.state_backups`, `dbo.data_protection_keys`, `dbo.schema_version` | novas rotas e operação |
| — | schema `rel`: `relacionamentos`, `views_geradas`, `sincronizacao_status`, `qualidade_dados`, `fn_num`, views `vw_*` e `rel.<coleção>` | camada relacional |

### Camada relacional (`rel`)

* **`rel.<coleção>`** — uma view por coleção do estado (ex.: `rel.op`, `rel.op_etapas`, `rel.materiais`,
  `rel.sust_lci`), com uma coluna para cada campo do frontend. É gerada automaticamente e se atualiza quando
  novas versões do frontend criam coleções ou campos.
* **Views de correlação** — `rel.vw_op_familia` (OP + produto + roteiro + OP pai), `rel.vw_op_etapas_equipamento`,
  `rel.vw_op_materiais_rastreabilidade`, `rel.vw_roteiro_recursos`, `rel.vw_entradas_material`,
  `rel.vw_estrutura_produto`, `rel.vw_apontamentos_op`, `rel.vw_passaporte_op`, `rel.vw_colecoes`.
* **`rel.relacionamentos`** — catálogo com as ~80 chaves que o frontend usa para ligar as coleções
  (ex.: `op_etapas.CodOP → op.CodOP`, `roteiro_materiais.IdRecursoRoteiro → roteiro_recursos.IdRecursoRoteiro`).
* **Tabelas normalizadas com chaves estrangeiras** — sincronizadas pela procedure
  `rel.usp_sincronizar_modelo_relacional` em segundo plano após cada gravação. Registros sem pai ou com
  código duplicado são listados em `rel.qualidade_dados`; equipamentos nunca são excluídos (preserva documentos).
* **`rel.fn_num`** — leitura numérica igual à função `num()` do frontend (vírgula decimal, "R$", milhares).

A fonte de verdade continua sendo o estado do frontend; a camada relacional é uma projeção para consultas,
Power BI e integrações. Nenhum cálculo do MES foi reimplementado em SQL.

## 6. Modos de execução

| Modo | Quando | Configuração |
|---|---|---|
| **Portátil** | validação rápida em PC sem SQL Server | automático quando não há SQL Server; dados em `Dados/BancoPortatil` |
| **SQL Server LocalDB** | PC com Visual Studio / SQL Express LocalDB | **detectado automaticamente** no Windows (`(localdb)\MSSQLLocalDB`, banco `MesLion`) |
| **SQL Server** (empresa/Express) | servidor local ou VM | `CONFIGURAR_BANCO.bat` → opção 3 |
| **Azure SQL Database** | nuvem | `CONFIGURAR_BANCO.bat` → opção 4 (login Microsoft Entra ID) ou App Service (identidade gerenciada) |

Os scripts T-SQL são aplicados automaticamente na primeira execução (`dbo.schema_version`) e o banco vazio
recebe os dados iniciais de `Dados/MES_LION_DATA.json` — ou os dados migrados do PostgreSQL.

## 7. Melhorias de plataforma (sem mudar regras nem telas)

* Botões **Criar backup, Exportar banco e Importar banco** passaram a funcionar; **Restaurar dados iniciais**
  agora cria um backup antes de substituir o banco (no original o backup falhava e a substituição acontecia sem cópia).
* **Anexos** de empresas, materiais e entradas passaram a funcionar (`/api/attachments`).
* Gravação **somente das coleções alteradas**: uma alteração em uma OP grava poucos KB no banco, não o estado inteiro (~33 MB).
* Respostas **compactadas** (Brotli/gzip) e envio do estado **compactado** em acesso remoto (rede/Azure): ~30 MB → ~2 MB.
* Documentos binários sem corrupção e nomes de arquivo com acentos corretos.
* Sessões sobrevivem a reinícios; usuário desativado perde o acesso imediatamente.
* O servidor publica **somente** o frontend (o PowerShell servia qualquer arquivo da pasta, inclusive `Dados/` e scripts).
* Senhas: PBKDF2-SHA512 (100.000 iterações) no lugar do bcrypt custo 6 do pgcrypto.
* **ACV e LCC voltaram a funcionar.** No MES LION 1.0 PGSQL, os módulos V1.0.19–V1.1.3 criavam suas coleções vazias
  (`acv_estudos`, `acv_cenarios`, `acv_resultados`, `acv_icv_salvos`, `lcc_estudos`, `lcc_cenarios`, `lcc_resultados`,
  `apontamento_tempos`, `op_pi_consumos`, `pi_lotes`) ao carregar a página, mas o estado vindo do servidor substituía o
  objeto `data` logo depois (no login e ao recarregar) e essas coleções desapareciam. Resultado: erro ao abrir ACV e LCC,
  ao salvar estudos/ICV e ao iniciar um apontamento de tempo. O adaptador (`js/mes_plataforma_azure.js`) recria apenas as coleções
  ausentes, vazias, com a mesma regra dos módulos (`data.X = data.X || []`). Não executa as cargas de demonstração dos
  patches (OPs de validação, ICV/AICV de benchmark, dados de teste do WIP), que também nunca chegavam ao banco do PGSQL,
  para não alterar OPs nem resultados existentes. O teste A/B confirma: ACV e LCC ficam idênticas ao que o código original
  desenha quando as coleções existem, e as outras 30 telas continuam idênticas ao original.

## 8. Comportamentos herdados (mantidos de propósito)

* **Multiusuário**: como no original, a última gravação do estado prevalece (não há bloqueio por registro).
* O menu **Banco ▾** do cabeçalho fica oculto enquanto a página está em "modo dashboard" (abrir, por exemplo,
  Entrada de Materiais ou Processos o exibe), igual ao original.
* O QR da etiqueta do passaporte aponta para o GitHub Pages (regra da V40.4.5 do frontend); a publicação no próprio
  servidor (`/passaporte/{id}.html`) também está disponível.
