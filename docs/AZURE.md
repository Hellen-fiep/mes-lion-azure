# MES LION no Microsoft Azure

Arquitetura de produção na nuvem, criada pelo Bicep em `infra/main.bicep` (pasta `azure\` do pacote):

```
Usuários (navegador) ──HTTPS──► Azure App Service (Linux, .NET 10)  ── identidade gerenciada ──┐
                                 │  MES LION (ASP.NET Core) + frontend                          │
                                 │  login local e/ou Microsoft Entra ID (App Service Auth)      │
                                 ├──► Azure SQL Database (somente autenticação Entra ID)  ◄────┤
                                 ├──► Azure Blob Storage (documentos, anexos, backups)    ◄────┘
                                 └──► Application Insights + Log Analytics (monitoramento)
Power BI / Excel ──────────────────► Azure SQL (schema rel: views e tabelas normalizadas)
```

| Recurso | Configuração padrão | Observação |
|---|---|---|
| App Service Plan | Linux **B1** | S1/P0v3/P1v3 para mais usuários; Always On ligado |
| App Service | `DOTNETCORE|10.0`, HTTPS obrigatório, TLS 1.2, FTP desligado, `/healthz` | identidade gerenciada (system-assigned) |
| Azure SQL Database | **S0** (DTU), collation `SQL_Latin1_General_CP1_CI_AS` | **somente Microsoft Entra ID** (sem senha SQL) |
| Storage Account | Standard LRS, Blob privado, exclusão reversível de 14 dias | container `meslion` (`documentos/`, `anexos/`, `passaportes/`, `backups/`) |
| Application Insights | Log Analytics, retenção de 30 dias | |

## 1. Pré-requisitos

* Assinatura do Azure e permissão de **Colaborador** (ou Proprietário, para a atribuição de papel do Storage) no grupo de recursos.
* **Azure CLI** (`az`) — https://aka.ms/installazurecliwindows — e, opcionalmente, o `sqlcmd` moderno (go-sqlcmd).
* O pacote `azure\MES_LION_AZURE_app-service.zip` (já compilado e testado pelo CI).

## 2. Implantação em um comando

```powershell
cd azure
.\implantar-azure.ps1 -GrupoRecursos rg-meslion -Regiao brazilsouth -Pacote .\MES_LION_AZURE_app-service.zip
```

O script:
1. faz login (`az login`) e usa **você** como administrador Entra ID do Azure SQL;
2. cria o grupo de recursos e implanta o Bicep (App Service, Azure SQL, Storage, Application Insights);
3. libera o seu IP público no firewall do Azure SQL (para a migração);
4. concede ao App Service o acesso ao banco (`permissoes_identidade_gerenciada.sql`) — se o `sqlcmd` não estiver
   instalado, rode esse script no **Portal → Banco SQL → Editor de consultas**, trocando `NOME_DO_APP` pelo nome do App Service;
5. publica o aplicativo (zip deploy).

Na primeira inicialização o MES cria o esquema no Azure SQL (scripts 001–005) e carrega a base inicial.
Confira em `https://<app>.azurewebsites.net/healthz` (deve responder `"status":"ok"` e `"banco":"SqlServer"`)
e entre com **admin / meslion2026** — **troque essa senha** em Usuários / Segurança.

**API NestJS (fase 1)** — a mesma infraestrutura serve para a API em NestJS + Prisma (Node.js 22): use
`-Servidor nestjs` e o pacote `MES_LION_API_NESTJS_app.zip` (release "build-mais-recente" do CI). O banco, os arquivos e o
frontend são os mesmos; o Bicep ajusta só o runtime do App Service (`servidorAplicacao=nestjs`). O pipeline do Azure
DevOps (`azure-pipelines.yml`) também publica esse pacote — veja `docs/FASE1_NESTJS.md`.

```powershell
.\implantar-azure.ps1 -GrupoRecursos rg-meslion -Regiao brazilsouth -Servidor nestjs -Pacote .\MES_LION_API_NESTJS_app.zip
```

Implantação manual equivalente (para a TI / pipelines):

```powershell
az group create -n rg-meslion -l brazilsouth
az deployment group create -g rg-meslion -f main.bicep -p main.parameters.json   # preencha adminEntraLogin/ObjectId
# (executar permissoes_identidade_gerenciada.sql no banco, como administrador Entra ID)
az webapp deploy -g rg-meslion -n <nomeAplicacao> --src-path MES_LION_AZURE_app-service.zip --type zip
```

## 3. Migração dos dados para o Azure

Use o pacote exportado do PostgreSQL (`docs/MIGRACAO.md`, seção "Destino Azure SQL + Blob Storage"): num PC liberado
no firewall do Azure SQL, aponte o MES para o Azure SQL e o Blob Storage e rode `--importar-migracao`.
Os usuários e senhas, o histórico e os documentos são preservados.

Alternativa sem PC intermediário: no MES em execução no Azure, **Banco ▾ → Importar banco** com o arquivo gerado por
**Exportar banco** no MES local (estado e preferências; usuários e documentos não vão neste formato).

## 4. Login Microsoft Entra ID (opcional)

O login local continua funcionando; o Entra ID adiciona o botão **"Entrar com Microsoft"** (single sign-on corporativo).

1. **Portal → Microsoft Entra ID → Registros de aplicativo → Novo registro**
   * Nome: `MES LION`; contas somente deste diretório;
   * URI de redirecionamento (Web): `https://<app>.azurewebsites.net/.auth/login/aad/callback`.
2. **Funções de aplicativo → Criar função**: nome de exibição `Administrador MES`, valor **`MES.Admin`**, membros: Usuários/Grupos.
3. **Aplicativos empresariais → MES LION → Usuários e grupos**: atribua a função `MES.Admin` a quem administra o MES
   (os demais entram como perfil USER).
4. **Certificados e segredos**: crie um segredo do cliente.
5. Reimplante com o login ligado:

```powershell
az deployment group create -g rg-meslion -f main.bicep -p main.parameters.json `
   -p habilitarLoginMicrosoft=true entraClientId=<Application (client) ID> entraClientSecret=<segredo>
#  exigirLoginMicrosoft=true  → todo o sistema exige login Microsoft (exceto /passaporte e /healthz)
```

Comportamento no MES:
* primeiro acesso com Microsoft cria o usuário automaticamente (`ProvisionarAutomaticamente`), com perfil USER,
  ou ADMIN se tiver a função `MES.Admin`;
* um usuário local cujo *username* seja igual ao e-mail (UPN) da conta Microsoft é vinculado a ela;
* desativar o usuário em Usuários / Segurança bloqueia o acesso imediatamente, inclusive pelo Entra ID;
* o histórico registra `LOGIN_ENTRA`.

## 5. Power BI e consultas

Conecte o Power BI Desktop ao Azure SQL (**Obter dados → Banco de dados SQL do Azure**, autenticação *Conta Microsoft*):

| Objeto | Conteúdo |
|---|---|
| `rel.vw_op_familia`, `rel.vw_op_etapas_equipamento`, `rel.vw_op_materiais_rastreabilidade` | OPs com produto, roteiro, OP pai, equipamentos, materiais/lotes e custos |
| `rel.vw_entradas_material`, `rel.vw_roteiro_recursos`, `rel.vw_estrutura_produto`, `rel.vw_apontamentos_op`, `rel.vw_passaporte_op` | cadastros e apontamentos correlacionados |
| `rel.<coleção>` (ex.: `rel.op`, `rel.sust_lci`, `rel.mes_capacidades`) | todas as coleções do MES, uma coluna por campo |
| `dbo.production_orders`, `dbo.op_steps`, `dbo.op_materials`, `dbo.materials`... | tabelas normalizadas com chaves estrangeiras |
| `rel.relacionamentos` | dicionário das correlações (útil para montar o modelo do Power BI) |

Valores numéricos aparecem como texto (como o frontend grava) e também convertidos nas colunas `*_num`
(função `rel.fn_num`, mesma regra do `num()` do frontend). Para dar acesso de leitura a um grupo, use o trecho
opcional de `permissoes_identidade_gerenciada.sql`.

## 6. Operação

| Tema | Como |
|---|---|
| Logs | Portal → App Service → **Fluxo de log**; Application Insights → Falhas/Desempenho |
| Saúde | `/healthz` (configurado como Health check do App Service) |
| Backup do banco | Azure SQL faz backup automático (restauração pontual de 7 dias no S0); o MES também guarda backups do estado no Blob (`backups/`) |
| Backup manual | **Banco ▾ → Criar backup** / **Exportar banco** |
| Atualizar o MES | `az webapp deploy ... --src-path <novo zip>`; os scripts SQL novos são aplicados na inicialização (`dbo.schema_version`) |
| Escalar | aumentar o plano (S1/P1v3) e o banco (S1/S2); sessões ficam no banco, então mais de uma instância funciona |
| Chave do Storage | após a migração, pode-se desligar `allowSharedKeyAccess` no Storage (o MES usa identidade gerenciada) |
| Esquema gerenciado pela TI | rode `database\sqlserver\001…005` manualmente e defina `MesLion__Banco__AplicarScriptsAutomaticamente=false` |

Configurações (App Service → Variáveis de ambiente), todas com prefixo `MesLion__`:
`Banco__Provedor`, `Banco__AplicarScriptsAutomaticamente`, `Arquivos__Provedor` (`AzureBlob`/`Local`),
`Arquivos__AzureBlob__ContaUrl`, `Arquivos__AzureBlob__Container`, `Autenticacao__EntraId__Habilitado`,
`Autenticacao__EntraId__PapelAdmin`, `Autenticacao__SessaoHoras`, `Publicacao__UrlBasePublica`,
`Relacional__Habilitado`, `Servidor__LimiteRequisicaoMB`. A connection string fica em *Cadeias de conexão* (`MesLion`).

## 7. Custos de referência

Plano B1 + Azure SQL S0 + Storage com poucos GB + Application Insights com baixo volume: ordem de grandeza de
algumas dezenas de dólares por mês. Consulte a calculadora oficial (https://azure.microsoft.com/pricing/calculator/)
com a região escolhida.
