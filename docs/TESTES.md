# Testes e evidências — MES LION 1.0 AZURE

Todos os testes rodam automaticamente no GitHub Actions a cada alteração (`.github/workflows/ci.yml`),
em máquinas limpas, com **SQL Server 2022 real**, **PostgreSQL 16 real**, **Windows Server 2022** e
**SQL Server LocalDB**. O executável entregue no pacote é o mesmo que passou por esses testes.

## Resultado da última execução

Repositório `Hellen-fiep/mes-lion-azure`, branch `main`, commit indicado em `evidencias/execucao.txt`.

| Suíte | Ambiente | Resultado |
|---|---|---|
| Testes de unidade (`tests/MesLion.Testes`) | Linux, .NET 10 | **42/42** |
| API — contrato HTTP completo (`tests/testes_api.py`) | Linux + **SQL Server 2022** | **95/95** |
| Banco SQL Server — esquema, camada relacional, views, FKs (`tests/verificar_sqlserver.py`) | SQL Server 2022 | **45/45** |
| Fluxos no navegador — Chromium/Playwright (`tests/e2e_fluxos.py`) | SQL Server 2022, acesso local e remoto | **25/25** |
| **Primeira tela após o login** — cada opção do menu aberta logo após o login e após F5 (`tests/primeira_tela.py`) | SQL Server 2022 | **32/32 sem erro JavaScript** (no MES antigo, ACV e LCC falhavam) |
| **A/B de telas** — servidor original × servidor novo (`tests/ab_comparar_telas.py`) | frontend original + contrato PowerShell × ASP.NET Core + SQL Server | **32/32**: 30 telas idênticas ao original; ACV e LCC idênticas ao original com as coleções inicializadas e sem erro |
| Migração PostgreSQL → SQL Server (`tests/teste_migracao.py`) | PostgreSQL 16 (schema original) → SQL Server 2022 | **25/25** |
| API com o **executável Windows**, modo Portátil | Windows Server 2022 | **95/95** |
| API com o **executável Windows**, **LocalDB detectado automaticamente** | Windows Server 2022 + LocalDB | **95/95**, camada relacional gerada no LocalDB |
| Fluxos no navegador com o **executável Windows** (inclui ACV e LCC) | Windows Server 2022, modo Portátil | **24/24** |
| Importação de pacote de migração com o **executável Windows** (`tests/teste_importacao_pacote.py`) | Windows Server 2022 | **7/7** |
| Frontend publicado × original (`MANIFESTO_FRONTEND.txt`) | executável Windows | **44 arquivos** conferidos byte a byte |

O executável Windows (`app\MesLion.Server.exe`, ~21 MB) é autocontido e enxuto: o .NET vai junto, com o código não
usado do .NET/ASP.NET Core removido na publicação (*trimming* parcial); o código do MES, o `Microsoft.Data.SqlClient` e as
bibliotecas de login Microsoft são mantidos inteiros. É exatamente esse arquivo que passou pelas suítes do Windows acima.

Arquivos de evidência (pasta `docs/evidencias` do pacote): `ab_resultado.json` (comparação tela a tela, com
hash do HTML de cada tela nos dois servidores) e os logs de cada suíte.

## O que cada suíte verifica

**API (95 verificações)** — login/logout/sessão (cookie `MESSESSION`), senhas bcrypt antigas, `/api/bootstrap`
devolvendo o estado **byte a byte** como gravado, gravação parcial (somente coleções alteradas) e auditoria
`SAVE_STATE`, `/api/storage` (chaves do localStorage), usuários (perfis, duplicidade, desativação imediata),
documentos de equipamentos (PDF/XLSX íntegros, nomes com acento, extensões permitidas), anexos, publicação do
passaporte (página pública), backup/exportação/importação (com backup automático), rotas desconhecidas,
compressão gzip/Brotli, limites de tamanho e acesso sem sessão.

**Banco SQL Server (45)** — 35 tabelas (todas as do PostgreSQL original + novas), scripts 001–005 registrados,
chaves estrangeiras, payload completo reconstruído pela `dbo.vw_app_state_payload` (= `app_state.payload` do
PostgreSQL), ordem das coleções, senha em PBKDF2, chaves de sessão no banco, sincronização das tabelas normalizadas
(produtos, materiais, fornecedores, equipamentos, roteiros, OPs, etapas, materiais da OP, passaportes) com as
contagens esperadas, campos acentuados, integridade OP → etapas, uma view `rel.<coleção>` por coleção com contagem
de linhas igual à coleção, todas as views de correlação (uma linha por registro da coleção principal), `rel.fn_num`
(vírgula decimal, milhar, "R$", negativos) e o catálogo `rel.relacionamentos`.

**Navegador (25)** — login, título, cadastro de material com anexo (persistência após recarregar, anexo baixado
íntegro), upload de PDF em equipamento, **ACV** (dashboard, estudo, cenário, AICV, ICV salvo), **LCC** (estudo,
inventário de custos, cenário e cálculo), início de apontamento de tempo, gravação desses dados no servidor, criação de
usuário, Criar backup, Exportar banco, histórico, logout, perfil USER sem administração, Restaurar dados iniciais com
backup antes, **nenhum erro JavaScript** (sem exceções conhecidas) e, por acesso remoto (IP da máquina), envio do estado
compactado (gzip).

**Primeira tela após o login (32)** — para cada opção do menu, uma sessão nova do navegador faz login e abre essa
tela primeiro; depois recarrega a página (F5) e abre de novo. Nenhuma pode gerar erro JavaScript. É o cenário em que
ACV e LCC falhavam no MES LION 1.0 PGSQL (o mesmo teste aponta as duas falhas no servidor sem a correção).

**A/B de telas (32)** — o mesmo conjunto de dados é aberto no servidor de referência (contrato do
`MES_LION_SERVER.ps1` com o frontend original) e no servidor novo; o teste percorre **todas** as opções do menu e
compara título, subtítulo e o HTML renderizado de cada tela (normalizando apenas datas/horas e identificadores
gerados na hora). Resultado: as 30 telas sem correção são idênticas ao original. **ACV e LCC**, que no original davam erro
JavaScript, foram corrigidas (no adaptador `js/mes_plataforma_azure.js`); para elas a referência é o **mesmo frontend original**
servindo um estado que já contém as coleções vazias que o módulo cria (`tests/seed_com_colecoes.py`) — a tela nova é
idêntica a essa referência e não tem erro JavaScript.

**Migração (25)** — cria no PostgreSQL 16 o banco com o **schema original**, grava dados como o servidor PowerShell
grava (senhas `crypt()`/bcrypt com acentos, payload jsonb, uploads), executa o **mesmo script** de exportação que o
usuário roda (`ferramentas/EXPORTAR_DADOS_POSTGRESQL.ps1`), importa no SQL Server e confere: login com a senha
antiga, conversão do hash para PBKDF2, estado e app_storage idênticos, usuários, histórico, documentos com o mesmo
ID e conteúdo byte a byte, proteção contra sobrescrita e backup antes de reimportar.

## Como rodar localmente

> Os testes de API e de navegador **alteram os dados** (criam usuários, materiais, documentos e importam bancos).
> Rode-os sempre numa **cópia de teste** com a base anonimizada — nunca no banco em uso.

```powershell
dotnet run -c Release --project tests/MesLion.Testes                       # unidade

# servidor de teste numa pasta separada, modo Portátil, porta 8799, com a base de teste:
mkdir C:\MES_TESTE\Dados ; copy tests\dados_teste\MES_LION_DATA_TESTE.json C:\MES_TESTE\Dados\MES_LION_DATA.json
$env:MesLion__Banco__Provedor = 'Portatil'
$env:MesLion__Banco__PastaPortatil = 'C:\MES_TESTE\Dados\BancoPortatil'
$env:MesLion__Arquivos__PastaLocal = 'C:\MES_TESTE\Dados\Arquivos'
$env:MesLion__Seed__ArquivoInicial = 'C:\MES_TESTE\Dados\MES_LION_DATA.json'
dotnet run -c Release --project src/MesLion.Server -- --urls http://127.0.0.1:8799

# em outro terminal:
pip install requests playwright pymssql ; python -m playwright install chromium
python tests/testes_api.py http://127.0.0.1:8799 C:\MES_TESTE\Dados\MES_LION_DATA.json
python tests/e2e_fluxos.py http://127.0.0.1:8799
```

A base de teste (`tests/dados_teste/MES_LION_DATA_TESTE.json`) é anonimizada; a base real do MES não é enviada ao GitHub.
