# Validação no PC corporativo — MES LION 1.0 AZURE

Roteiro para validar a nova arquitetura (ASP.NET Core .NET 10 + SQL Server/Azure SQL) no seu PC,
antes de levar para o Azure. Não precisa instalar nada: o executável já traz o .NET.

## 0. Requisitos

| Item | Necessário? |
|---|---|
| Windows 10/11 64 bits | sim |
| Direitos de administrador | **não** (só para liberar o firewall no modo rede, se a TI exigir) |
| .NET instalado | **não** (o executável é autocontido) |
| Edge ou Chrome | sim |
| Porta 8765 livre | sim (feche o MES antigo antes) |
| SQL Server | opcional: o MES detecta o **LocalDB** sozinho; sem SQL Server, usa o modo **Portátil** |

## 1. Preparar a pasta

1. Antes de extrair, clique com o botão direito no `.zip` → **Propriedades** → marque **Desbloquear** → OK.
   (Evita os avisos do Windows sobre arquivos baixados.)
2. Extraia para uma pasta local, por exemplo `C:\MES_LION_AZURE`.
   Evite pastas sincronizadas pelo OneDrive/SharePoint: o banco portátil grava arquivos o tempo todo.
3. Conteúdo:

```
INICIAR_MES.bat            abre o MES neste PC (http://localhost:8765)
INICIAR_MES_REDE.bat       abre o MES para outros PCs da rede (porta 8765)
CONFIGURAR_BANCO.bat       escolhe o banco: Portátil, LocalDB, SQL Server da empresa ou Azure SQL
MIGRAR_DO_POSTGRESQL.bat   traz os dados do MES antigo (PostgreSQL)
app\                       servidor (MesLion.Server.exe) + telas (wwwroot) + configuração
Dados\                     base inicial (MES_LION_DATA.json) e, no modo Portátil, o banco e os anexos
ferramentas\               script de exportação do PostgreSQL
azure\                     implantação no Azure (Bicep + script)
database\                  scripts T-SQL (SQL Server) e os scripts originais do PostgreSQL
docs\                      guias (este arquivo, Azure, migração, testes, arquitetura)
codigo-fonte\              solução completa (.NET 10)
```

## 2. Primeira execução

1. Dê dois cliques em **`INICIAR_MES.bat`**.
   * Se aparecer **"O Windows protegeu o computador"** (SmartScreen): **Mais informações → Executar assim mesmo**.
     O executável não é assinado digitalmente; em produção a TI pode assiná-lo ou publicar só no Azure.
2. A janela preta mostra o banco escolhido e o endereço. O navegador abre em `http://localhost:8765`.
3. Entre com **admin / meslion2026** (depois da migração, valem os usuários e senhas do MES antigo).
4. A tela de login mostra o servidor e o banco ativos (ex.: `Banco: Portátil` ou `Banco: SQL Server (...)`).

Qual banco é usado:

| Situação no PC | Banco usado automaticamente |
|---|---|
| Nada configurado e sem LocalDB | **Portátil** — arquivos em `Dados\BancoPortatil` |
| LocalDB instalado (Visual Studio / SQL Express LocalDB) | **SQL Server LocalDB** — banco `MesLion` em `(localdb)\MSSQLLocalDB` |
| `CONFIGURAR_BANCO.bat` executado | o banco escolhido no assistente (`app\appsettings.Local.json`) |

> Na primeira execução com LocalDB, o Windows pode levar até 1–2 minutos para criar a instância e o banco.

## 3. Roteiro de validação das telas

Sugestão: abra o MES antigo e o novo lado a lado com a mesma base. Os dois usam a porta 8765, então
inicie o novo em outra porta: abra um Prompt de Comando na pasta `app` e rode
`MesLion.Server.exe --urls http://127.0.0.1:8766` (o novo fica em `http://localhost:8766`).

Marque cada item (as 32 opções do menu foram comparadas automaticamente com o servidor original; veja `docs/TESTES.md`):

**Dashboard e Materiais**
- [ ] Dashboard: indicadores e gráficos iguais ao MES antigo
- [ ] Materiais: listar, filtrar, criar um material de teste com anexo de qualificação
- [ ] Empresas: cadastrar empresa com anexo
- [ ] Entrada de Materiais: registrar entrada (lote, NF, custo) e conferir o custo unitário
- [ ] Categorias de Materiais

**Engenharia**
- [ ] Estrutura do Produto (PA/PI), Regras Produto x Material, Processos, Formulações
- [ ] Recursos / Custos
- [ ] Cadastro de Recursos: abrir um equipamento, **enviar um PDF** e baixá-lo de volta

**Produção**
- [ ] Roteiro: abrir um roteiro e conferir etapas, recursos e materiais
- [ ] Ordens de Produção: gerar uma OP a partir do roteiro, conferir etapas/materiais criados
- [ ] OP - Etapas, OP - Materiais, Regras de OP
- [ ] Apontamento Produção e Perdas: apontar e conferir o reflexo na OP

**Planejamento**
- [ ] MRP, Plano de Produção, **Capacidade** (capacidade de carga), Calendário, Programação

**Projetos**
- [ ] Projetos, Simulações, Custos Industriais
- [ ] ACV — Ciclo de Vida: abrir sem erro; criar um estudo para uma OP, um cenário e calcular o AICV; salvar o ICV da OP
- [ ] LCC — Life Cycle Costing: criar um estudo, carregar o inventário de custos da OP, salvar um cenário e calcular
  (no MES antigo essas telas davam erro — corrigido nesta versão)
- [ ] Battery Passport: abrir um passaporte, gerar o dashboard/QR

**Administração e menu Banco ▾**
- [ ] Usuários / Segurança: criar um usuário USER e entrar com ele (não deve ver a administração)
- [ ] Histórico de Modificações: as gravações aparecem como `SAVE_STATE`, com as coleções alteradas
- [ ] Banco ▾ → **Criar backup**, **Exportar banco** (baixa um `.json`), **Importar banco** (somente ADMIN)
- [ ] Recarregar a página (F5): continua logado e os dados permanecem

**Cálculos** — escolha 2 ou 3 OPs conhecidas e compare com o MES antigo: custo projetado/efetivo,
quantidades de materiais, tempos de etapa, resultados de ACV/LCC e dados do passaporte.
As regras de cálculo estão no frontend, que é o mesmo arquivo do MES antigo; diferenças indicam dados diferentes.

## 4. Migrar os dados reais do PostgreSQL

Veja `docs/MIGRACAO.md`. Em resumo: feche os dois MES, rode **`MIGRAR_DO_POSTGRESQL.bat`**, informe a pasta
do MES antigo e depois entre no MES novo com os mesmos usuários e senhas.

## 5. Validar com SQL Server

1. **LocalDB** (se instalado): nada a fazer — é detectado sozinho.
2. **SQL Server da empresa / SQL Express**: rode `CONFIGURAR_BANCO.bat` → opção **3** → servidor
   (ex.: `SERVIDOR\SQLEXPRESS`), banco `MesLion`, autenticação Windows ou usuário SQL.
   O assistente testa a conexão. Na primeira inicialização o MES cria o banco (se tiver permissão) e as tabelas.
3. **Azure SQL Database**: `CONFIGURAR_BANCO.bat` → opção **4** (login Microsoft Entra ID). Veja `docs/AZURE.md`.

Conferir no SQL Server Management Studio / Azure Data Studio:

```sql
SELECT * FROM rel.vw_colecoes ORDER BY ordem;            -- coleções do MES, tamanho e autor da última gravação
SELECT TOP 50 * FROM rel.vw_op_familia;                   -- OP + produto + roteiro + OP pai
SELECT TOP 50 * FROM rel.vw_op_materiais_rastreabilidade; -- materiais/lotes por OP
SELECT * FROM rel.relacionamentos ORDER BY colecao_origem; -- correlações entre as tabelas do MES
SELECT * FROM rel.sincronizacao_status;                   -- última atualização das tabelas normalizadas
SELECT * FROM rel.qualidade_dados;                         -- registros órfãos/duplicados encontrados
SELECT COUNT(*) FROM dbo.production_orders;               -- tabelas normalizadas (com chaves estrangeiras)
```

Cada coleção também vira uma view com todos os campos: `rel.op`, `rel.op_etapas`, `rel.materiais`, `rel.entradas`...
A camada relacional é atualizada alguns segundos depois de cada gravação.

## 6. Multiusuário na rede

1. No PC que será o servidor, rode **`INICIAR_MES_REDE.bat`**. A janela mostra o endereço para os outros PCs
   (ex.: `http://10.0.0.15:8765`).
2. Se o Windows perguntar sobre o firewall, permita em **redes privadas/domínio** (pode exigir administrador; se
   não aparecer o aviso e os outros PCs não conectarem, peça à TI para liberar a porta TCP 8765 de entrada).
3. Nos outros PCs, abra o endereço no navegador e entre com o próprio usuário.

Como no MES original, a última gravação prevalece se duas pessoas alterarem o mesmo cadastro ao mesmo tempo.

## 7. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| "O Windows protegeu o computador" | SmartScreen (executável sem assinatura) | **Mais informações → Executar assim mesmo**, ou desbloqueie o `.zip` antes de extrair |
| Antivírus remove ou bloqueia `MesLion.Server.exe` | política corporativa para executáveis novos | peça à TI para liberar a pasta / o arquivo (ou valide direto no Azure) |
| "não foi possível abrir a porta do MES" | outro MES (inclusive o PowerShell antigo) usando a porta 8765 | feche a outra janela do servidor; ou inicie em outra porta (`--urls http://127.0.0.1:8766`) |
| "não foi possível preparar o banco de dados" | SQL Server inacessível, sem permissão ou connection string errada | rode `CONFIGURAR_BANCO.bat` de novo; para validar sem SQL, escolha a opção 1 (Portátil) |
| Primeira abertura lenta com LocalDB | criação da instância e do banco | aguarde 1–2 minutos; as próximas aberturas são rápidas |
| Outros PCs não acessam no modo rede | firewall do Windows / rede corporativa | liberar TCP 8765 de entrada; confirme o IP mostrado na janela |
| Tela em branco ou com versão antiga | cache do navegador | **Ctrl+F5** |
| Quero recomeçar do zero (modo Portátil) | — | feche o MES e apague `Dados\BancoPortatil` e `Dados\Arquivos`; na próxima abertura a base inicial é recarregada |
| Quero recomeçar do zero (SQL Server) | — | apague o banco `MesLion` (ou use outro nome no `CONFIGURAR_BANCO.bat`) |

## 8. Comportamentos herdados do MES original (não são falhas da migração)

* **Multiusuário**: a última gravação prevalece se duas pessoas alterarem o mesmo cadastro ao mesmo tempo.
* O menu **Banco ▾** fica oculto enquanto a página está em "modo dashboard"; abra qualquer outra tela para vê-lo.
* O QR da etiqueta do passaporte aponta para o GitHub Pages (regra do frontend); a publicação no próprio servidor
  (`/passaporte/{id}.html`) também está disponível.

## 9. O que enviar de retorno

* A lista acima marcada (ou o que divergiu, com print da tela no MES antigo e no novo);
* o texto da janela preta do servidor, se algo falhar;
* qual banco foi usado (Portátil, LocalDB, SQL Server da empresa ou Azure SQL).
