# MES LION — versão Microsoft Azure / SQL Server

Nova arquitetura do **MES LION 1.0 PGSQL** para o ecossistema Microsoft, preservando integralmente
as regras de cálculo, as telas e as correlações de dados do sistema original.

| Camada | Antes (MES LION 1.0 PGSQL) | Agora (MES LION 1.0 AZURE) |
|---|---|---|
| Frontend | HTML/CSS/JavaScript (app.js + patches) | **O mesmo**, byte a byte (ver `MANIFESTO_FRONTEND.txt`) |
| Servidor | PowerShell (`MES_LION_SERVER.ps1`) + `psql.exe` | **ASP.NET Core .NET 10 (C#)** — mesmo contrato HTTP |
| Banco | PostgreSQL (estado em `app_state.payload` jsonb) | **SQL Server / Azure SQL** (estado por coleção + camada relacional `rel.*`) |
| Arquivos | `server/uploads` | **Azure Blob Storage** (ou pasta local) |
| Login | usuários locais (bcrypt/pgcrypto) | usuários locais (senhas antigas preservadas) + **Microsoft Entra ID** opcional |
| Hospedagem | PC/VM com PowerShell | **Azure App Service** (Bicep em `infra/`) ou PC/servidor Windows (.exe autocontido) |

## Estrutura

```
src/MesLion.Server/        Servidor ASP.NET Core (C#) + frontend em wwwroot + scripts T-SQL embutidos (Sql/)
  Api/                     Rotas HTTP (mesmo contrato do servidor PowerShell)
  Estado/                  Persistência do estado do MES (divisão por coleção, sem reserializar)
  Persistencia/SqlServer/  SQL Server / Azure SQL (ADO.NET + Microsoft.Data.SqlClient)
  Persistencia/Portatil/   Modo portátil (arquivos) para validação sem SQL Server
  Arquivos/                Pasta local ou Azure Blob Storage
  Seguranca/               Senhas (PBKDF2 / bcrypt herdado), Entra ID (App Service Authentication)
  Relacional/              Views rel.<coleção> geradas e sincronização das tabelas normalizadas
  Migracao/                Importação do pacote exportado do PostgreSQL
infra/                     Bicep (App Service, Azure SQL, Storage, App Insights) e script de implantação
ferramentas/               EXPORTAR_DADOS_POSTGRESQL.ps1 (migração a partir do MES antigo)
database/postgresql_original/  Scripts e servidor originais (referência do mapeamento)
tests/                     Testes de unidade, API, navegador (Playwright), A/B de telas, migração e SQL Server
.github/workflows/ci.yml   Build e testes automáticos (SQL Server 2022, PostgreSQL 16, Windows/LocalDB)
docs/                      Arquitetura, validação, Azure, migração e evidências de teste
```

## Compilar e executar

Requisitos: .NET 10 SDK.

```powershell
dotnet run --project src/MesLion.Server -- --urls http://127.0.0.1:8765      # modo Portátil ou LocalDB detectado
dotnet publish src/MesLion.Server -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o publicar/app
dotnet run -c Release --project tests/MesLion.Testes                         # testes de unidade
```

Os scripts T-SQL (`src/MesLion.Server/Sql/001…005`) são aplicados automaticamente na inicialização
(ou manualmente pela TI). Veja `docs/` para os guias completos.
