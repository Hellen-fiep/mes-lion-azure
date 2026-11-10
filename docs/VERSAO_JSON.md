# MES LION 1.0 JSON — o MES sem PostgreSQL

Versão para quem não tem PostgreSQL instalado: o **mesmo MES PowerShell** do pacote
`MES_LION_PGSQL_CAPACIDADE_CARGA_V1`, com os dados em **arquivos JSON** na pasta `Dados`.
Não precisa de instalação nem de privilégio de administrador: só o **Windows PowerShell 5.1** (já vem no Windows)
e um navegador.

| | MES LION 1.0 PGSQL | MES LION 1.0 JSON |
|---|---|---|
| Frontend (`index.html`, `style.css`, `js/`, `assets/`) | original | **o mesmo, byte a byte** (conferido contra `MANIFESTO_FRONTEND.txt`) |
| Servidor | `server/MES_LION_SERVER.ps1` + `psql.exe` | `server/MES_LION_SERVER_JSON.ps1` (sem `psql`) |
| Dados | PostgreSQL (`app_state`, `users`, `audit_log`…) | `Dados/*.json` + `Dados/auditoria.jsonl` |
| Senhas | bcrypt (pgcrypto) | PBKDF2 V3 (mesmo formato do MES AZURE); bcrypt antigo aceito e convertido no 1º login |
| Abrir | `INICIAR_MES.bat` + senha do postgres | `INICIAR_MES.bat` |

## Arquivos (`versao_json/`)

```
INICIAR_MES.bat                       servidor local (127.0.0.1:8765) e abre o navegador
INICIAR_MES_REDE.bat                  servidor para a rede (0.0.0.0:8765)
IMPORTAR_DADOS_DO_POSTGRESQL.bat      traz do PostgreSQL: dados, usuários (mesmas senhas), histórico e documentos
GERAR_PACOTE_PARA_OUTROS_USUARIOS.bat .zip desta pasta já com os dados (sem backups/logs)
REDEFINIR_SENHA.bat                   nova senha para um usuário (e reativa)
LEIA-ME_VERSAO_JSON.txt               instruções para o usuário
server/MES_LION_SERVER_JSON.ps1       servidor HTTP (TcpListener + Socket.Select), rotas, senhas, backups
server/adaptador_frontend.js          correções do frontend que o servidor inclui no index.html ao entregar a página
server/adaptador_passaporte.js        passaporte da bateria e biblioteca de fatores ambientais (incluído depois do anterior)
server/IMPORTAR_POSTGRESQL.ps1        importador (somente leitura no PostgreSQL)
server/GERAR_PACOTE.ps1               gerador do pacote para distribuir
montar_pacote.py                      monta o pacote: frontend original conferido + server + .bat + LEIA-ME + Dados
```

## Pasta `Dados`

| Arquivo | Conteúdo | No PostgreSQL |
|---|---|---|
| `MES_LION_DATA.json` | estado do MES, gravado **exatamente** como o navegador envia (troca atômica) | `app_state.payload` |
| `app_storage.json` | demais chaves do `localStorage` | `app_storage` |
| `usuarios.json` | usuários (`id, username, full_name, password_hash, role, active, created_at, updated_at`) | `users` |
| `auditoria.jsonl` | Histórico de Modificações, um registro por linha, no formato do `GET /api/audit` | `audit_log` |
| `documentos_equipamentos.json` + `arquivos/documentos/` | documentos dos equipamentos | `equipment_documents` + `server/uploads` |
| `anexos.json` + `arquivos/anexos/` | anexos de cadastros (`/api/attachments`) | — (não existia) |
| `passaportes_publicados.json` + `arquivos/passaportes/` | páginas públicas dos passaportes (QR) | — (não existia) |
| `backups/` | `.zip` com o banco no formato `MES_LION_JSON_DATABASE` (manual, diário automático, antes de importar) | — |
| `servidor_em_execucao.json` | trava: impede dois servidores na mesma pasta (PID + início do processo; batimento a cada 60 s) | — |

Se `MES_LION_DATA.json` estiver no formato de exportação (envelope `MES_LION_JSON_DATABASE`, como o arquivo inicial
do pacote PostgreSQL), o servidor o desembrulha na primeira vez que abre e guarda o original em `Dados/backups`.

## Contrato HTTP

As mesmas rotas e respostas do `MES_LION_SERVER.ps1`: `/api/auth/login|logout|me`, `/api/bootstrap`,
`/api/storage[/chave]`, `/api/users[/id]`, `/api/audit`, `/api/equipment/{código}/documents`, `/api/documents/{id}`.
Também as rotas que o frontend já chamava e o servidor PowerShell não tinha (respondiam 404), com o mesmo contrato do
MES AZURE: `/api/backup`, `/api/backups`, `/api/export`, `/api/import`, `/api/open-data-folder`, `/api/info`,
`/api/attachments`, `/api/passport-publish` e `/passaporte/{id}.html`; e `/healthz`.

1.5.0 (Relatórios): `GET /api/audit?de=aaaa-mm-dd&ate=aaaa-mm-dd&limite=N` devolve só as alterações do período (dia de
`changed_at`, até `limite`, no máximo 200.000; parâmetros inválidos são ignorados e valem as últimas 500, como antes) e
`POST /api/relatorios/exportacao` (`relatorio`, `nome`, `arquivo`, `linhas`, `abas`, `filtros`; exige sessão) grava
no histórico módulo `relatorios`, ação `EXPORTAR` — o `.xlsx` é gerado no navegador.

1.6.0 (Importação de equipamentos): `POST /api/recursos/importacao` (`acao` = `IMPORTAR` ou `DESFAZER`, `idImportacao`
obrigatório, `arquivo`, `linhas`, `novos`, `atualizados`, `capacidades`, `ignorados`; exige sessão; outros campos são
ignorados) grava no histórico módulo `recursos`, ação `IMPORTAR` ou `DESFAZER_IMPORTACAO` — a planilha é lida e os
dados são gravados no navegador, pelo `/api/storage` como nas outras telas.

Diferenças em relação ao servidor PowerShell original (todas corrigem problemas do original):

* `Dados/`, `server/` e arquivos que não são do frontend **não são servidos** (o original entregava qualquer arquivo
  da pasta, inclusive o banco inicial).
* Upload de documentos sem perder bytes do fim do arquivo e com nome em UTF-8 (o original fazia `TrimEnd` de `\r\n-`
  e lia o nome em Latin-1; o importador corrige os nomes antigos).
* Conexões abertas antecipadamente pelo navegador (pré-conexão) não travam o servidor (`Socket.Select`).
* Estado inválido/incompleto é recusado com 400 sem alterar o arquivo; `DELETE /api/storage/MES_LION_DATA` nunca apaga
  o estado; não permite ficar sem administrador ativo.

## Adaptadores do frontend (`server/adaptador_*.js`)

O servidor lê os arquivos da lista `$ArquivosAdaptador` ao iniciar (a falta de um deles impede a abertura, com
mensagem) e os inclui no fim do `index.html` ao entregar a página, nessa ordem e cada um no seu `<script>`, depois de
todos os scripts originais — os arquivos do frontend continuam idênticos aos originais e a pasta `server/` nunca é
servida:

| Arquivo | `<script id>` | Versão |
|---|---|---|
| `adaptador_frontend.js` | `mes-adaptador-json` | 1.0.0 (calendário por máquina na 1.4.0) |
| `adaptador_passaporte.js` | `mes-adaptador-passaporte` | 1.1.0 |
| `adaptador_codigos_estoque.js` | `mes-adaptador-codigos-estoque` | 1.2.0 / 1.3.0 |
| `adaptador_estoque_ajustes.js` | `mes-adaptador-estoque-ajustes` | 1.3.0 |
| `adaptador_apontamento_pi.js` | `mes-adaptador-apontamento-pi` | 1.4.0 |
| `adaptador_relatorios.js` | `mes-adaptador-relatorios` | 1.5.0 |
| `adaptador_recursos_importacao.js` | `mes-adaptador-recursos-importacao` | 1.6.0 |
| `adaptador_helpdesk_assistente.js` | `mes-adaptador-helpdesk-assistente` | 1.6.0 |

Correções de `adaptador_frontend.js`:

1. **ACV/LCC**: recria as coleções que os módulos V1.0.19–V1.1.3 criam ao carregar a página e que se perdiam quando o
   estado do servidor substituía `data` (erro ao abrir ACV/LCC, salvar ICV, iniciar apontamento).
2. **Textos de plataforma** (PostgreSQL → versão JSON).
3. **Capacidade e Carga V1**: botões também no Cadastro de Recursos (o módulo só os mostrava com `current` = `cad_recursos`).
4. **"Editar dia"** (`mesCalendarDecorate`): a decoração original removia e recriava a faixa INDISPONIVEL e o botão de
   todos os dias a cada alteração da tela; o `MutationObserver` de `#content` a chamava de novo (≈1.900 alterações em
   1,5 s) e o botão era trocado entre o apertar e o soltar do mouse — o clique não chegava. A nova versão só altera o
   que mudou.
5. **Programação nos dias disponíveis** (calendário padrão: seg–sex 08–12/13–17; sábados, domingos e feriados
   indisponíveis; exceções de "Editar dia" em `data.meta.calendarioExcecoes`; indisponibilidades de equipamento em
   `data.pcp_calendarios`):
   * `syncPrograms()` do calendário V2.3.17 reconstrói os cartões a partir das OPs a cada exibição e só copiava
     `Inicio/Fim/Prazo/ConflitoPendente`: os trechos (`Segmentos`) gravados pela "Sugestão de programação" se perdiam e
     o cartão aparecia em todos os dias entre início e fim (sábados e domingos inclusive). O `saveLocal` passa a guardar
     os trechos também em `data.meta.pcpSegmentos` e a devolvê-los ao cartão quando `Inicio/Fim` não mudaram; cartões
     sem trechos (programados antes da correção) têm os trechos recalculados quando `Inicio/Fim` batem exatamente com
     o calendário de trabalho;
   * `pcpProgramarV238` (Plano > "Projetar sequência pelas datas já informadas") encadeava as etapas em tempo corrido;
     agora usa o calendário de trabalho (exceções da linha da operação + indisponibilidades do equipamento);
   * `pcpValidarConflitosV2315` usa os trechos (sem conflito falso em noites/fins de semana) e acusa operação em dia
     indisponível;
   * `pcpProgramarV235` (Programação > "Recalcular programação", dependia de `mrp_demandas` e dava erro) abre o
     Calendário com a "Sugestão de programação";
   * **histórico da programação**: o calendário V2.3.17 só monta cartões das OPs abertas — ao concluir a OP os cartões
     sumiam. O `saveLocal` congela (`Congelado = "Sim"`) cada operação com apontamento de tempo (horário real; sessão
     aberta = EM EXECUÇÃO), apontamento de produção (dia, expediente padrão) ou OP/etapa concluída (horário programado)
     e guarda em `data.pcp_historico` (uma entrada por cartão, com o horário programado antes da execução); as
     operações de OPs concluídas voltam à programação a partir do histórico. Cartões congelados ficam em cinza, sem
     arrastar; o duplo clique mostra o histórico; "Limpar datas", "Projetar sequência" e a sugestão não os alteram
     (a programação nova começa depois do último horário executado do equipamento); "Validar conflitos" não acusa
     conflito entre operações executadas.
6. **Carga × capacidade** (`mesCapCalcular`): o módulo V1 lia as datas da programação só como `dd/mm/aaaa hh:mm`, mas
   o PCP grava `dd/mm/aaaa, hh:mm` (com vírgula); a data caía no `new Date()` do navegador (leitura americana): dias 13
   a 31 ficavam de fora e dias 1 a 12 eram contados com dia e mês trocados. Mesmo cálculo e mesma tabela, com a data
   lida corretamente (usa os `Segmentos` quando existem).
7. **MRP > "Abrir OPs"**: chamava `render('ops')`, tela inexistente (abria um cadastro vazio "ops"); vai para `render('op')`.

Correções de `adaptador_passaporte.js`:

8. **Biblioteca de fatores GWP100**: a biblioteca da V1.1.3 era criada ao carregar a página e se perdia quando o estado
   do servidor substituía `data`. Depois do login (uma vez por base, marcada em `data.meta.bibliotecaFatoresGWP100`)
   entram 19 fatores (ecoinvent cut-off, IPCC 100a v1.3) em `data.acv_fatores` — os 15 da tabela GWP100 e os 4 que já
   estavam na biblioteca — e uma versão da Biblioteca de Dados Ambientais em `data.sust_lci` com os materiais do
   cadastro (lote `BIBLIOTECA-GWP100-MES`). Polypropylene granulate e os processos/energia ficam com códigos
   `PROC_*`/`ENERGIA_*` (não são materiais do cadastro). ACV > Fatores mostra a lista legível.
9. **Banco LCI** (`ensureLCIDatabaseFromEntradasV37`): o teste de existência procurava o cenário "Base / Brasil", mas a
   linha nova era gravada com o cenário do fator antigo — a cada cálculo (é chamada em todo `lciActiveFactorV37`)
   repetia linhas (54 mil linhas, 31 MB na base real). As linhas idênticas são removidas e a rotina não repete.
10. **Versão ativa vale nos cálculos** (`lciActiveFactorV37`): usava o primeiro fator preenchido do material e as
    versões importadas entram no fim da lista — a importação não mudava o cálculo de quem já tinha fator. Agora a
    versão ativa (`LibraryActive = "Sim"`) vem primeiro.
11. **Template e importação da Biblioteca de Dados Ambientais**: o template era uma tabela HTML com extensão `.xls`
    (o Excel avisa do formato e, salvo como `.xls` 97-2003, a importação não lia nada: "A planilha não possui registros
    válidos"). Agora é um `.xlsx` gerado no navegador (aba "Fatores" com 3 linhas de EXEMPLO fictícias válidas, uma
    linha por material, lista de indicadores; aba "Como preencher"). A importação lê `.xlsx` (inclusive compactado
    pelo Excel, com textos compartilhados, via `DecompressionStream`), CSV (`;`, `,` ou tabulação, com aspas, UTF-8
    ou ANSI) e o `.xls`-HTML antigo; localiza a linha de títulos; ignora linhas sem fator; confere código do material,
    número e indicador; pergunta antes de gravar linhas de EXEMPLO; explica o `.xls` binário.
12. **Passaporte da bateria**:
    * formulário: os blocos V1.1.1 ("UE") e V1.1.4 ("Guidance v2.0") repetiam os mesmos dados (fabricante, modelo,
      capacidade, tensões, peso, vida útil, resíduos…) e marcavam obrigatórios; viraram um catálogo único por
      assunto (chaves `BP_DP..`/`EU_..`; valores antigos aproveitados como reserva), sem obrigatório, com a marca
      "painel" em cada dado (desmarcados em `CamposOcultos`; padrão: dados de acesso restrito DP45–DP50 e cliente);
    * OP: lista OPs encerradas e, para rascunho, OPs de PA em andamento; `bpOPChange` não bloqueia OP aberta e
      preenche estrutura da célula (`data.estrutura` do PA), data de fabricação, composição detalhada, peso (massa
      útil quando todos os materiais têm conversão para kg) e pegada de carbono (por célula, por kWh, por kg) do AICV
      da OP (`data.acv_resultados`) ou da ACV da família (`calcSustFamiliaOPV33`), escolha gravada em `FonteACV`;
      campos alterados à mão são mantidos (`CamposAutomaticos` guarda o último valor puxado);
    * massas: `v4041ProcessMassRows` com a marca "Publicar" por material (`MassasExcluidas`; padrão: solventes por
      categoria, nome ou consumo "Adição ao processo"), valores por célula;
    * `saveBP`: rascunho salva sempre; outros status pedem confirmação com OP aberta ou inexistente; mantém as
      chaves antigas do registro;
    * `bpDashboardBody` (painel do cliente, HTML exportado e QR), `reportBPObj` (PDF interno com a coluna
      "No painel", massas úteis e fora, ACVs disponíveis) e `showBP` (tela interna).

Correções e funções de `adaptador_codigos_estoque.js` e `adaptador_estoque_ajustes.js` (1.2.0 e 1.3.0, recebidos no
pacote do usuário): códigos de barras Code 128 (material, entrada/lote, OP, passaporte) e leitura no apontamento;
localização dos lotes, Locais de Estoque e Inventário; Estoque / Rastreabilidade com saldo por entrada (entradas −
consumos apontados − perdas do lote − ajustes), reservado e em produção; Recursos / Máquinas em tela única; PIs
filhos pelos processos; estoque mínimo; MRP com o mesmo saldo; Ajuste de Estoque; Kanban do calendário de
caracterização.

`adaptador_apontamento_pi.js` (1.4.0):

13. **Motivos de perda** (`data.perdas_motivos`, tela `perdas_motivos`): categoria + motivo com chave sem acento,
    maiúscula e pontuação (duplicado bloqueado; parecido — Levenshtein ≤ 2 — pede confirmação); motivo usado só é
    desativado; renomear oferece atualizar as perdas; importação agrupando os textos digitados (com padronização
    opcional). No Registro de Perdas `#loss_tipo` e `#loss_motivo` viram listas do cadastro (o `registrarPerdaOP`
    original lê os mesmos ids; o código do motivo vai em `IdMotivo`).
14. **Tempo por máquina** (`data.apontamento_tempos` com `OrdemEtapa`, `IdRecursoRoteiro`, `CodEquipamento`,
    `DataFim`, `DuracaoMin`, `Origem`): iniciar/finalizar e intervalo informado por máquina de `op_etapas`; uma sessão
    aberta por OP+máquina; sem sobreposição na mesma OP+máquina. A soma finalizada vai para `op_etapas.TempoReal`
    da máquina (`TempoRealOrigem = APONTAMENTO_TEMPO_MAQUINA`), já usado por `opEnergyKWhV4014`, `opMODCostV4014`
    e `auditCostFamilyV4014` no lugar do planejado. Os controles por processo da V1.0.14 saem da tela. O histórico do
    calendário (`adaptador_frontend.js`, 5e) casa a sessão pela máquina e lê `DataFim`; com tempo por máquina, a
    produção sem horário não congela as outras máquinas.
15. **Fluxo de PIs no roteiro** (`data.roteiro_pi_entradas`: `CodRoteiro`, `OrdemEtapa` consumidora, `CodigoPI`,
    máquina opcional): quadro por operação e quadro de diagnóstico no editor (`renderRoteiroArvoreV382`); o PI deve
    ser produzido em operação anterior (ou vir de fora do roteiro); sugestão pela cadeia de papéis da V1.0.11
    (`v1011Role`/`v1011PrevRoles`); `copiarRoteiroV386` copia o fluxo; `excluirOperacaoV382` remove as entradas da
    operação. Estrutura do Produto: fluxo em níveis pelo roteiro.
16. **PI como insumo da OP**: OP aberta recebe a linha `PI intermediário` da etapa (`OrigemDados = FLUXO_PI_ROTEIRO`,
    `OPOrigemPI` = OP da família que produz o PI, `QtdPlanejada` = planejado dela), aproveitando linhas da cadeia
    V1.0.11; linhas de genealogia da OP de PA do mesmo PI ganham `FluxoPISubstituido = Sim` (ficam fora do consumo,
    da baixa automática e da lista de perdas, sem mudar os índices). Linhas de PI seguem fora de massa, custo de
    materiais, MRP e ACV.
17. **Consumo de PI** (`data.op_pi_consumos`, `Origem = APONTAMENTO_PI`): pela etiqueta/lote, retirado − devolvido =
    `QuantidadeConsumida`; perda na etapa vira registro em `perdas` com `OrigemPerda = DENTRO_DO_CONSUMO` ligado ao
    consumo; saldo insuficiente bloqueado; estorno (`Status = CANCELADO`). Consumo de outra família / PI isolado grava
    `CodOPPA` = OP de PA consumidora e herda custo/CO₂ pela regra da V40.3; da própria família, `CodOPPA` vazio (sem
    herança). O consumo planejado na geração da OP (V40.3/V1.0.11) do mesmo lote é substituído pelo apontado.
18. **Origem da perda** no Registro de Perdas (material e PI): `DENTRO_DO_CONSUMO` (limitada ao consumo apontado
    ainda sem perda) ou `RETIRADA_ADICIONAL` (baixa a etiqueta/lote do PI ou o lote do material via `EntradaMaterial`).
19. **Etiquetas** (`data.etiquetas_producao`, `ETnnnnnn`): no apontamento de produção (`un`: por unidade, aglutinada
    ou N por etiqueta; outras UMs: única); soma = quantidade apontada; impressão Code 128; cancelamento sem movimento;
    excluir o apontamento cancela as etiquetas (bloqueado com movimento).
20. **Estoque de PI e PA** (aba `pipa` do Estoque e rota `estoque_pi_pa`): livro por lote (`LPI-…` = lote da V40.3,
    `LPA-…`): produção − consumos − perdas por retirada − baixas (`data.estoque_pi_ajustes`); etiquetas recebem os
    movimentos sem etiqueta em ordem; reservado pelas OPs abertas; rastreio para trás/frente; conferência.
    `v403ConsumidoLote` passa a usar esse livro.
21. **Regras de cálculo**: `QtdProduzida` = soma de `producao` (o lançamento V3.x somava o último apontamento duas
    vezes; correção na primeira abertura registrada em `data.meta.mes140CorrecoesQtd`); `v102MaterialLossCost` e
    `perdasMateriaisOPV391` não somam perda dentro do consumo nem perda de PI da própria família; perda de PI externo
    por retirada herda custo/CO₂ fechados da origem; baixa automática do PI da família no encerramento da OP
    consumidora (`BAIXA_AUTOMATICA_ENCERRAMENTO`; uma vez para as OPs já encerradas: `BAIXA_LEGADO_1.4.0`,
    `data.meta.mes140BaixaLegadoPI`).

`adaptador_relatorios.js` (1.5.0) — menu **Relatórios** (`relatorios`, `relatorios_ver`, `relatorios_dossie`,
`relatorios_modelos`, grupo antes de Administração):

22. **Catálogo**: 38 relatórios em 11 módulos, cada um com `id`, regra de cálculo, colunas tipadas (`txt`, `int`,
    `num`, `qtd`, `moeda`, `pct`, `min`, `h`, `co2`, `data`, `datahora`) e o mapa dos filtros comuns para as suas
    colunas (período, projeto, produto/descrição, OP, máquina, situação; busca livre nas colunas visíveis; `ops` para
    o dossiê). As linhas saem das mesmas funções das telas: `mesLinhasEstoque`/`mesResumoMateriaisEstoque` (saldo e
    reservas), `mesApontamentoPI14.livro()` (PI/PA), `maquinasDaOP`/`duracaoMin` (tempo), `custosOP`,
    `calcCustoFamiliaOPV33(raiz, false)`, `calcSustFamiliaOPV33(raiz, false)` (+ `AuditoriaCO2JSON`),
    `v102MaterialLossCost`, `mesCapRelatorioDados` (exposto no `adaptador_frontend.js`), `mesBPVisao`/`mesBPCampos`
    (exposto no `adaptador_passaporte.js`) e a regra do MRP (`mesCalcMRPUnificado` não é chamado: grava
    `mrp_planos`).
23. **Sem efeito colateral**: cada relatório roda com `saveLocal` desligado e, ao terminar, as coleções de `data` que
    mudaram voltam ao estado anterior no mesmo objeto (as funções das telas regravam campos ao calcular — ex.:
    `recalcularCustosOPV3814` congela o custo projetado e refaz `QtdConsumida`). Coleções com mais de 5.000 linhas
    (`sust_lci`) não são copiadas.
24. **Excel**: gerador OOXML próprio (sem biblioteca externa; `CompressionStream('deflate-raw')` quando houver):
    números e datas tipados (data = número de série do Excel, hora local), formatos por tipo (`"R$" #,##0.00`,
    `0.0%`, `dd/mm/yyyy`, quantidade em Geral), unidade no cabeçalho (UM única das linhas vai para o nome da
    coluna), `autoFilter` + `_xlnm._FilterDatabase`, painel congelado, linha Total com `SUBTOTAL(109,…)` e valor em
    cache (quantidade só com uma UM; percentual e unitários nunca), aba `Parâmetros`.
25. **Modelos** (`data.relatorios_modelos`: `IdModelo`, `Nome`, `Relatorio`, `Filtros`, `Colunas`, `Ordem`,
    `CriadoPor/Em`, `AtualizadoPor/Em`): mesmo nome do mesmo usuário e relatório substitui; exclusão pelo autor ou
    ADMIN.
26. **Dossiê da OP**: OP sozinha ou família (`raizFamilia`): 15 abas — Resumo, Produção, Etiquetas, Saldo PI e PA,
    Materiais planejado × real, Lotes de material, Consumo de PIs, Tempo por máquina, Apontamentos de tempo, Perdas,
    Custo por OP, Custo e CO₂ da família, Contribuição no CO₂, Rastreabilidade (para trás: `consumos_materiais` com
    entrada/NF e `op_pi_consumos` subindo pela OP de origem do lote; para frente: consumos, perdas e baixas do lote
    no livro do Estoque PI/PA e passaportes da OP) e Parâmetros.
27. **API para testes**: `window.mesRelatoriosAPI` (`lista`, `modulos`, `executar`, `xlsx` em base64, `dossie`,
    `rastreabilidade`).

Correção no `adaptador_estoque_ajustes.js` (1.5.0): `N()` lia valores gravados com ponto e três casas como milhar
(`"0.001"` → 1, `"0.125"` → 125: MRP, saldo do lote no Ajuste de Estoque, estoque mínimo); agora usa o `num()` do app e
o ponto como milhar fica só em `numDigitado()` (texto digitado).

`adaptador_recursos_importacao.js` (1.6.0) — **Importação de equipamentos** (`recursos_importacao`, aberta pelo botão
"⬆ Importar planilha de equipamentos" de Recursos / Máquinas):

28. **Mesmas regras do formulário**: usa `window.mesRecursosAPI` (exposto no `adaptador_codigos_estoque.js`: código,
    `novoId`, `sincronizar`, `custos`, `conflitos`) e grava `data.recursos` + `data.cad_recursos` ligados pelo
    `IdRecurso` (um id novo por linha, sem repetir mesmo criando várias linhas no mesmo milissegundo), custos com
    `custosRecurso` e `data.mes_capacidades` + `data.mes_capacidade_historico` (validação da tela Capacidades).
29. **Modelo** (`mesXlsx` do `adaptador_codigos_estoque.js`, que ganhou `congelar` com N linhas, `mesclar`,
    `validacoes` do tipo lista e nomes definidos): abas Equipamentos (grupos mesclados, 31 colunas, listas suspensas
    ligadas a `ListaProcessos`, `ListaEscalas`, `ListaSimNao`, `ListaOperacao`, `ListaUnidades`, duas linhas de
    EXEMPLO), Instruções e Listas; com os cadastrados traz o ID interno. Leitura de `.xlsx` (aba "Equipamentos") e
    CSV, cabeçalho achado pelos nomes (aceita os nomes dos campos do cadastro), colunas desconhecidas avisadas.
30. **Validação** (o que cada linha faz: `NOVO`, `NOVO_PROCESSO`, `ATUALIZAR`, `SEM_MUDANCA`, `NAO_ATUALIZAR`,
    `EXEMPLO`, `ERRO`): casamento pelo ID interno ou por código + processo + subprocesso (sem acento/maiúsculas);
    código novo automático depois do maior número do cadastro e da planilha; célula vazia mantém o valor; o mesmo
    texto ou o mesmo número (`0,80` = `0.8`) não conta como mudança — a planilha com os cadastrados volta sem mudança;
    novo processo de equipamento existente herda nome, potência, patrimônio, NF, valor, fatores, capacidade, taxas e
    escala (como `mesRecursoUsarExistente`); chave código + processo + subprocesso única depois da importação (só
    para linhas novas ou que mudam a chave: duplicidades antigas não bloqueiam); equipamento sem código igual a um
    cadastrado é erro (não duplica ao subir de novo); capacidade por código, igual em todas as linhas e gravada uma
    vez. Custos recalculados só quando tempo, pessoas, potência ou taxas mudam.
31. **Importar / desfazer**: valida de novo com os dados do momento, `mesEstoqueAPI.backup()`, grava, guarda em
    `data.recursos_importacoes` (`IdImportacao`, contagens, `Itens` com `RecAntes`/`CadAntes`/`RecDepois`/`CadDepois`,
    `CapItens`; os valores anteriores só das 20 mais recentes) e registra no servidor. Desfazer compara só os campos
    que a importação grava: linha alterada depois fica como está; linha criada já usada em `roteiro_recursos`,
    `roteiro_etapas`, `op_etapas` ou `pcp_programacao` não é apagada; sem nada para desfazer a importação continua
    aplicada.
32. **API para testes**: `window.mesRecursosImportacaoAPI` (`colunas`, `modelo` em base64, `validarArquivo`, `ultima`,
    `importarUltima`, `desfazer`).

`adaptador_helpdesk_assistente.js` (1.6.0) — **Assistente passo a passo** no Help Desk (`openHelpDeskV40` ganha as abas
"Assistente passo a passo" e "Fluxo de integração dos módulos"; o iframe original continua na segunda):

33. **Objetivos** (26, em 7 grupos): nós `pergunta` (texto, ajuda, checagem `chk`, `decide` = a checagem sugere a
    resposta, `sim`/`nao`), `passo` (tela = chave do `render`, botão a destacar, `ctx` = OP pré-selecionada, o que
    preencher, obrigatório, destino dos dados, erros comuns, `prox`) e `fim` (checklist, próximos objetivos).
    Destino `{ fluxo, volta }` faz antes outro objetivo e volta (pilha); `validar()` confere destinos, alcance, fim de
    todo caminho e se cada objetivo está numa trilha.
34. **Checagens** nos dados (`categorias`, `materiais`, `empresas`, `processos`, `equipamentos`, `pa`, `pi`,
    `roteiros`, `formulacoes`, `lotes_saldo` = `mesLinhasEstoque`, `pi_apontados`, `ops_abertas`, `ops_pa_fechadas`,
    `motivos`, `capacidades`, `custos`, `fatores`, `acv_calculados`, `admin`).
35. **Busca** sem acento por título, sinônimos, grupo e passos, com peso maior para palavras raras; Enter abre o
    primeiro resultado.
36. **Ir para a tela**: fecha o Help Desk, `render(tela)`, escolhe a OP no primeiro `select` que a tiver (ou no campo
    com lista), destaca o botão (classe `mha-alvo`) e mostra o assistente no canto (`#mhaDock`: feito → próximo passo,
    onde clicar, abrir o assistente, voltar, minimizar). Pergunta ou checklist reabre o Help Desk.
37. **Progresso**: `data.helpdesk_progresso` (um registro por usuário: `Usuario`, `Nome`, `Trilha`, `Fluxos` →
    `Concluido`, `Vezes`, `Checklist`; `Ultimo`, `Atualizado`), gravado ao escolher a trilha e ao concluir;
    `data.helpdesk_buscas` ("não encontrei": `Termo`, `Comentario`, `Caminho`, `Tela`, `Trilha`, até 2.000); posição
    atual no `localStorage` do navegador por usuário ("Continuar de onde parei"). Visão "Equipe" e Excel só para ADMIN.
38. **API para testes**: `window.mesHelpDeskAPI` (`fluxos`, `fluxo`, `trilhas`, `grupos`, `telas`, `validar`, `buscar`,
    `checar`, `destacar`, `estado`, `iniciar`, `responder`, `feito`, `progresso`, `sair`).

## Testes (CI: job `versao-json`, Windows PowerShell 5.1 real)

| Suíte | O que confere |
|---|---|
| `tests/testes_api_json.py` | contrato HTTP completo, arquivos privados, estado grande (44 MB), gravações concorrentes, bcrypt do PostgreSQL, PBKDF2 do MES AZURE, histórico com linha cortada |
| `tests/e2e_fluxos.py` | navegador real: login, cadastro com anexo, documentos, ACV/LCC, apontamento, usuários, backup, exportação, histórico, restaurar dados iniciais |
| `tests/primeira_tela.py` | todas as opções do menu como primeira tela (e após F5) sem erro JavaScript |
| `tests/teste_migracao_json.py` | PostgreSQL real (schema original) → `IMPORTAR_POSTGRESQL.ps1` → servidor JSON: senhas antigas, estado idêntico, histórico completo, documentos byte a byte |
| `tests/teste_capacidade_json.py` | Capacidade e Carga V1 no navegador: botões no Cadastro de Recursos, capacidade e histórico gravados no servidor, relatório após F5 |
| `tests/teste_calendario_json.py` | Calendário de Produção: tela estável, "Editar dia" com clique real do mouse (liberar sábado, bloquear dia útil), sugestão de programação e "Projetar sequência" sem operações em dias indisponíveis, trechos gravados e mantidos após F5, programação da versão anterior, "Validar conflitos", "Recalcular programação", "Limpar datas", carga do relatório Carga × capacidade, MRP > "Abrir OPs", histórico (OP concluída e apontamentos de tempo em cinza, gravados no servidor, mantidos após "Limpar datas" e F5) |
| `tests/teste_passaporte_json.py` | biblioteca GWP100 e banco LCI sem repetição; versão ativa nos cálculos; template `.xlsx` com exemplo e importação (`.xlsx` do Excel, CSV, erros, `.xls` binário); passaporte: campos únicos sem obrigatório, marcas "painel", dados puxados da OP (estrutura, ACV da família e AICV, massas úteis), rascunho com OP aberta, painel do cliente e HTML do QR, alteração à mão mantida, passaporte antigo, F5, PDF interno |
| `tests/teste_apontamento_pi_json.py` | 1.4.0: correção da QtdProduzida e baixa única das famílias encerradas; motivos de perda (duplicado, parecido, lista, importação); fluxo de PIs no roteiro (validação, sugestão, cópia) e Estrutura em níveis; PI nas OPs abertas; etiquetas (kg, N por etiqueta, por unidade, aglutinada, impressão); consumo de PI pela etiqueta, perda na etapa, saldo insuficiente, estorno; origem da perda (PI e material com lote); custo/CO₂ sem dupla contagem; PI isolado com custo herdado; tempo por máquina (intervalo, iniciar/finalizar, sobreposição, energia) e calendário por máquina; baixa automática no encerramento; estoque PI/PA (saldos, etiquetas, rastreio, baixa/estorno, cancelamento, conferência); exclusão bloqueada; servidor e F5 |
| `tests/teste_relatorios_json.py` | 1.5.0: menu e catálogo (busca, módulo); todos os relatórios executam e abrem na tela; nenhum dado alterado nem gravado ao executar; números = funções das telas (saldo por lote e por material, livro PI/PA, produção, tempo planejado e tempo real gravado na etapa, Pareto, carga × capacidade, MRP, custo e CO₂ da família); saída e estorno do Ajuste de Estoque no relatório e no saldo do lote; filtros (período, OP, produto sem acento, situação, busca), colunas e ordem; `.xlsx` baixado pela tela conferido com openpyxl (tipos, formatos, unidade no cabeçalho, SUBTOTAL, filtro, painel, Parâmetros); histórico das exportações; modelos (salvar, substituir, abrir, exportar, excluir, servidor); dossiê (abas, resumo, custo/CO₂, rastreabilidade, só a OP) |
| `tests/teste_importacao_recursos_json.py` | 1.6.0: botão e tela; modelo em branco conferido com openpyxl (abas, grupos mesclados, painel, listas suspensas e nomes, Listas, exemplos tipados, Instruções); exemplos ignorados; validação (código automático, novo processo herdando do cadastro, atualização sem acento, listas, capacidade com padrões e uma vez por código); importação gravada no servidor (recursos + cadastro ligados, custos, capacidade e histórico, registro e auditoria); mesma planilha de novo sem duplicar; modelo com os cadastrados de volta sem mudança (códigos repetidos, `0,80`, espaço no fim); erros que bloqueiam e planilha de erros (e subir de novo); CSV com nomes dos campos; "Atualizar" desmarcado; troca de código e processo pelo ID; desfazer (exato, linha alterada depois, equipamento em roteiro) |
| `tests/teste_helpdesk_assistente_json.py` | 1.6.0: estrutura dos 26 objetivos e trilhas; todas as telas dos passos abrem e os botões destacados existem; abas do Help Desk (fluxo antigo preservado); "Nesta tela"; busca com sinônimos; "não encontrei" gravado; trilha e progresso por usuário; checagem e sugestão; desvio e volta; voltar; checklist; ir para a tela, destaque e assistente no canto; OP pré-selecionada; continuar depois de recarregar; equipe e Excel (ADMIN); usuário comum |
| `tests/teste_gerar_pacote_json.py` | `.zip` para outros usuários com dados, sem backups/logs |
| `tests/teste_redefinir_senha_json.py` | `REDEFINIR_SENHA.bat`: nova senha PBKDF2, reativação, senhas que não conferem |

Montar o pacote localmente:

```bash
python versao_json/montar_pacote.py --frontend <pasta com index.html, style.css, js/, assets/ originais> \
    --saida out/MES_LION_1_0_JSON --dados <MES_LION_DATA.json> --desembrulhar --zip out/MES_LION_1_0_JSON.zip
```
