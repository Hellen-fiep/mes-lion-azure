/* =====================================================================
   MES LION — SQL Server / Azure SQL Database
   004 — CAMADA RELACIONAL (schema rel) — consultas, Power BI e integrações
   - rel.relacionamentos: catálogo das correlações entre as coleções do MES
     (as mesmas chaves usadas pelas regras do frontend).
   - rel.fn_num: leitura numérica idêntica à função num() do frontend.
   - rel.vw_*: views de correlação sempre sincronizadas com o estado gravado.
   - Views rel.<coleção> (uma por coleção, com todos os campos) são geradas
     automaticamente pela aplicação (registro em rel.views_geradas).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'rel.relacionamentos', N'U') IS NULL
CREATE TABLE rel.relacionamentos (
    id                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_rel_relacionamentos PRIMARY KEY,
    colecao_origem    NVARCHAR(100) NOT NULL,
    campo_origem      NVARCHAR(200) NOT NULL,
    colecao_destino   NVARCHAR(100) NOT NULL,
    campo_destino     NVARCHAR(200) NOT NULL,
    cardinalidade     NVARCHAR(10)  NOT NULL,
    descricao         NVARCHAR(400) NOT NULL,
    CONSTRAINT UQ_rel_relacionamentos UNIQUE (colecao_origem, campo_origem, colecao_destino, campo_destino)
);
GO

IF OBJECT_ID(N'rel.views_geradas', N'U') IS NULL
CREATE TABLE rel.views_geradas (
    colecao     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_rel_views_geradas PRIMARY KEY,
    nome_view   NVARCHAR(300) NOT NULL,
    assinatura  CHAR(64) NOT NULL,
    colunas     INT NOT NULL,
    gerada_em   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_rel_views_geradas_em DEFAULT SYSDATETIMEOFFSET(),
    definicao   NVARCHAR(MAX) NOT NULL
);
GO

IF OBJECT_ID(N'rel.sincronizacao_status', N'U') IS NULL
CREATE TABLE rel.sincronizacao_status (
    id             INT NOT NULL CONSTRAINT PK_rel_sincronizacao_status PRIMARY KEY CONSTRAINT CK_rel_sincronizacao_status_id CHECK (id = 1),
    versao_estado  BIGINT NULL,
    iniciado_em    DATETIMEOFFSET(3) NULL,
    concluido_em   DATETIMEOFFSET(3) NULL,
    sucesso        BIT NULL,
    mensagem       NVARCHAR(MAX) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM rel.sincronizacao_status WHERE id = 1)
    INSERT INTO rel.sincronizacao_status (id) VALUES (1);
GO

IF OBJECT_ID(N'rel.qualidade_dados', N'U') IS NULL
CREATE TABLE rel.qualidade_dados (
    id             BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_rel_qualidade_dados PRIMARY KEY,
    versao_estado  BIGINT NULL,
    tabela         NVARCHAR(100) NOT NULL,
    tipo           NVARCHAR(40)  NOT NULL,   -- DUPLICADO | ORFAO | SEM_CHAVE
    chave          NVARCHAR(400) NULL,
    detalhe        NVARCHAR(1000) NULL,
    registrado_em  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_rel_qualidade_dados_em DEFAULT SYSDATETIMEOFFSET()
);
GO

/* ---------------------------------------------------------------------
   Catálogo de correlações (chaves usadas pelo frontend para ligar as coleções)
   --------------------------------------------------------------------- */
MERGE rel.relacionamentos AS t
USING (VALUES
 (N'materiais',N'Categoria',N'categorias',N'Categoria',N'N:1',N'Categoria do material'),
 (N'materiais',N'CodigoFornecedor',N'empresas',N'CodigoEM',N'N:1',N'Fornecedor padrão do material'),
 (N'categorias',N'Processo',N'processos',N'Processo',N'N:1',N'Processo associado à categoria de material'),
 (N'entradas',N'CódigoMaterial',N'materiais',N'CódigoMaterial',N'N:1',N'Entrada (recebimento/lote) do material'),
 (N'entradas',N'CodigoFornecedor',N'empresas',N'CodigoEM',N'N:1',N'Fornecedor da entrada'),
 (N'entradas',N'CodigoProjeto',N'projetos',N'CodProjeto',N'N:1',N'Projeto da entrada'),
 (N'estrutura',N'Código Pai',N'estrutura',N'Código',N'N:1',N'Hierarquia PA → PI da estrutura do produto'),
 (N'regras_produto_producao',N'IdProcesso',N'processos',N'IdProcesso',N'N:1',N'Regra produto x material por processo'),
 (N'regras_op',N'PROCESSO',N'processos',N'Processo',N'N:1',N'Regra de OP por processo'),
 (N'recursos',N'CodEquipamento',N'cad_recursos',N'Código Equipamento',N'1:1',N'Recurso de custo ↔ cadastro do equipamento'),
 (N'roteiro',N'CodigoProduto',N'estrutura',N'Código',N'N:1',N'Produto (PA) do roteiro'),
 (N'roteiro',N'CodigoPI',N'estrutura',N'Código',N'N:1',N'PI do roteiro de PI isolado'),
 (N'roteiro',N'RoteiroOrigem',N'roteiro',N'CodRoteiro',N'N:1',N'Roteiro de origem (cópia)'),
 (N'roteiro_etapas',N'CodRoteiro',N'roteiro',N'CodRoteiro',N'N:1',N'Etapa do roteiro'),
 (N'roteiro_etapas',N'CodEquipamento',N'cad_recursos',N'Código Equipamento',N'N:1',N'Equipamento da etapa'),
 (N'roteiro_etapas',N'IdProcesso',N'processos',N'IdProcesso',N'N:1',N'Processo da etapa'),
 (N'roteiro_etapas',N'ProdutoGerado',N'estrutura',N'Código',N'N:1',N'PI/PA gerado pela etapa'),
 (N'roteiro_recursos',N'CodRoteiro',N'roteiro',N'CodRoteiro',N'N:1',N'Recurso (equipamento) da etapa do roteiro'),
 (N'roteiro_recursos',N'CodEquipamento',N'cad_recursos',N'Código Equipamento',N'N:1',N'Equipamento do recurso do roteiro'),
 (N'roteiro_materiais',N'CodRoteiro',N'roteiro',N'CodRoteiro',N'N:1',N'Material do roteiro'),
 (N'roteiro_materiais',N'IdRecursoRoteiro',N'roteiro_recursos',N'IdRecursoRoteiro',N'N:1',N'Material vinculado ao equipamento da etapa'),
 (N'roteiro_materiais',N'CodigoMaterial',N'materiais',N'CódigoMaterial',N'N:1',N'Material consumido'),
 (N'roteiro_materiais',N'CodigoPI',N'estrutura',N'Código',N'N:1',N'PI produzido na etapa'),
 (N'roteiro_produtos',N'CodRoteiro',N'roteiro',N'CodRoteiro',N'N:1',N'Produtos (PA/PI) do roteiro'),
 (N'roteiro_produtos',N'CodigoProduto',N'estrutura',N'Código',N'N:1',N'Produto do roteiro'),
 (N'formulacao_itens',N'CodFormula',N'formulacoes',N'CodFormula',N'N:1',N'Item da formulação'),
 (N'formulacao_itens',N'CodigoMaterial',N'materiais',N'CódigoMaterial',N'N:1',N'Material da formulação'),
 (N'op',N'CodRoteiro',N'roteiro',N'CodRoteiro',N'N:1',N'Roteiro usado na OP'),
 (N'op',N'CodigoProduto',N'estrutura',N'Código',N'N:1',N'Produto (PA/PI) da OP'),
 (N'op',N'OP_Pai',N'op',N'CodOP',N'N:1',N'OP pai (encadeamento PI → PA)'),
 (N'op',N'OP_Base',N'op',N'OP_Base',N'N:N',N'Família de OPs (mesma OP-base)'),
 (N'op',N'CodFormula',N'formulacoes',N'CodFormula',N'N:1',N'Formulação congelada na OP'),
 (N'op_etapas',N'CodOP',N'op',N'CodOP',N'N:1',N'Etapa da OP'),
 (N'op_etapas',N'CodEquipamento',N'cad_recursos',N'Código Equipamento',N'N:1',N'Equipamento da etapa da OP'),
 (N'op_etapas',N'IdRecursoRoteiro',N'roteiro_recursos',N'IdRecursoRoteiro',N'N:1',N'Recurso do roteiro de origem'),
 (N'op_etapas',N'IdProcesso',N'processos',N'IdProcesso',N'N:1',N'Processo da etapa da OP'),
 (N'op_etapas',N'ProdutoGerado',N'estrutura',N'Código',N'N:1',N'PI/PA gerado pela etapa da OP'),
 (N'op_materiais',N'CodOP',N'op',N'CodOP',N'N:1',N'Material planejado/consumido na OP'),
 (N'op_materiais',N'CodigoMaterial',N'materiais',N'CódigoMaterial',N'N:1',N'Material da OP'),
 (N'op_materiais',N'IdRecursoRoteiro',N'roteiro_recursos',N'IdRecursoRoteiro',N'N:1',N'Equipamento do roteiro que consome o material'),
 (N'op_materiais',N'CodFormula',N'formulacoes',N'CodFormula',N'N:1',N'Formulação aplicada ao material'),
 (N'op_materiais',N'EntradaMaterial',N'entradas',N'Entrada',N'N:1',N'Entrada/lote consumido'),
 (N'producao',N'CodOP',N'op',N'CodOP',N'N:1',N'Apontamento de produção da OP'),
 (N'producao',N'Produto',N'estrutura',N'Código',N'N:1',N'Produto apontado'),
 (N'perdas',N'CodOP',N'op',N'CodOP',N'N:1',N'Perda registrada na OP'),
 (N'perdas',N'CodigoMaterial',N'materiais',N'CódigoMaterial',N'N:1',N'Material perdido'),
 (N'consumos_materiais',N'CodOP',N'op',N'CodOP',N'N:1',N'Consumo real de material na OP'),
 (N'consumos_materiais',N'CodigoMaterial',N'materiais',N'CódigoMaterial',N'N:1',N'Material consumido'),
 (N'consumos_materiais',N'Entrada',N'entradas',N'Entrada',N'N:1',N'Lote/entrada de origem do consumo'),
 (N'apontamento_tempos',N'CodOP',N'op',N'CodOP',N'N:1',N'Apontamento de tempo da OP'),
 (N'pi_lotes',N'CodOPOrigem',N'op',N'CodOP',N'N:1',N'OP que produziu o lote de PI'),
 (N'pi_lotes',N'CodigoPI',N'estrutura',N'Código',N'N:1',N'PI do lote'),
 (N'op_pi_consumos',N'CodOPPA',N'op',N'CodOP',N'N:1',N'OP (PA) que consome o lote de PI'),
 (N'op_pi_consumos',N'CodOPOrigemPI',N'op',N'CodOP',N'N:1',N'OP de origem do PI consumido'),
 (N'op_pi_consumos',N'IdLotePI',N'pi_lotes',N'IdLotePI',N'N:1',N'Lote de PI consumido'),
 (N'custos_op',N'CodOP',N'op',N'CodOP',N'N:1',N'Custo fechado da OP'),
 (N'custos_op',N'ProdutoPA',N'estrutura',N'Código',N'N:1',N'PA do custo'),
 (N'sust_op',N'CodOP',N'op',N'CodOP',N'N:1',N'Resultado de sustentabilidade da OP'),
 (N'sust_lci',N'CodigoMaterial',N'materiais',N'CódigoMaterial',N'N:1',N'Fator de inventário (LCI) do material'),
 (N'sust_lci',N'UltimaEntrada',N'entradas',N'Entrada',N'N:1',N'Última entrada de referência'),
 (N'acv_fatores',N'CodigoMaterial',N'materiais',N'CódigoMaterial',N'N:1',N'Fator ambiental do material'),
 (N'acv_icv_salvos',N'CodOP',N'op',N'CodOP',N'N:1',N'ICV salvo da OP'),
 (N'acv_resultados',N'CodOP',N'op',N'CodOP',N'N:1',N'Resultado AICV da OP'),
 (N'simulacoes',N'CodOP',N'op',N'CodOP',N'N:1',N'Simulação de custo da família da OP'),
 (N'mrp_demandas',N'CodigoProduto',N'estrutura',N'Código',N'N:1',N'Item (PA/PI) demandado'),
 (N'mrp_demandas',N'CodRoteiroBase',N'roteiro',N'CodRoteiro',N'N:1',N'Roteiro-base da demanda'),
 (N'pcp_programacao',N'CodOP',N'op',N'CodOP',N'N:1',N'Operação programada da OP'),
 (N'pcp_programacao',N'Recurso',N'cad_recursos',N'Código Equipamento',N'N:1',N'Equipamento programado'),
 (N'pcp_resource_matrix',N'CodigoRecurso',N'cad_recursos',N'Código Equipamento',N'N:1',N'Matriz manual processo x recurso'),
 (N'pcp_caracterizacao',N'Recurso',N'cad_recursos',N'Código Equipamento',N'N:1',N'Reserva de teste de caracterização'),
 (N'mes_capacidades',N'Codigo',N'cad_recursos',N'Código Equipamento',N'1:1',N'Parâmetros de capacidade do equipamento'),
 (N'mes_capacidade_historico',N'Codigo',N'mes_capacidades',N'Codigo',N'N:1',N'Histórico de parâmetros de capacidade'),
 (N'bp',N'CodOrdemProducao',N'op',N'CodOP',N'N:1',N'OP do passaporte da bateria'),
 (N'bp',N'CodProduto',N'estrutura',N'Código',N'N:1',N'Produto do passaporte'),
 (N'bp',N'ClienteID',N'empresas',N'CodigoEM',N'N:1',N'Cliente do passaporte'),
 (N'bp',N'FornecedorID',N'empresas',N'CodigoEM',N'N:1',N'Fornecedor do passaporte')
) AS s (colecao_origem, campo_origem, colecao_destino, campo_destino, cardinalidade, descricao)
ON t.colecao_origem = s.colecao_origem AND t.campo_origem = s.campo_origem
   AND t.colecao_destino = s.colecao_destino AND t.campo_destino = s.campo_destino
WHEN MATCHED THEN UPDATE SET cardinalidade = s.cardinalidade, descricao = s.descricao
WHEN NOT MATCHED BY TARGET THEN
    INSERT (colecao_origem, campo_origem, colecao_destino, campo_destino, cardinalidade, descricao)
    VALUES (s.colecao_origem, s.campo_origem, s.colecao_destino, s.campo_destino, s.cardinalidade, s.descricao);
GO

/* ---------------------------------------------------------------------
   rel.fn_num — mesma regra da função num() do frontend (app.js):
   remove "R$" e espaços; se houver vírgula e ponto, remove os pontos (milhar);
   troca a primeira vírgula por ponto; descarta caracteres não numéricos.
   Retorna NULL onde o frontend usaria 0 por valor vazio/inválido.
   --------------------------------------------------------------------- */
CREATE OR ALTER FUNCTION rel.fn_num (@v NVARCHAR(4000))
RETURNS DECIMAL(38,10)
AS
BEGIN
    IF @v IS NULL RETURN NULL;
    DECLARE @s NVARCHAR(4000) = REPLACE(@v, N'R$', N'');
    SET @s = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@s, N' ', N''), NCHAR(160), N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N''), NCHAR(8239), N'');
    IF @s = N'' RETURN NULL;
    IF CHARINDEX(N',', @s) > 0 AND CHARINDEX(N'.', @s) > 0
        SET @s = REPLACE(@s, N'.', N'');
    IF CHARINDEX(N',', @s) > 0
        SET @s = STUFF(@s, CHARINDEX(N',', @s), 1, N'.');
    DECLARE @i INT = PATINDEX(N'%[^0-9.-]%', @s COLLATE Latin1_General_100_BIN2);
    WHILE @i > 0
    BEGIN
        SET @s = STUFF(@s, @i, 1, N'');
        SET @i = PATINDEX(N'%[^0-9.-]%', @s COLLATE Latin1_General_100_BIN2);
    END;
    IF @s = N'' OR @s = N'-' OR @s = N'.' RETURN NULL;
    RETURN TRY_CONVERT(DECIMAL(38,10), @s);
END;
GO

/* ---------------------------------------------------------------------
   Inventário das coleções do estado
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_colecoes
AS
SELECT c.name AS colecao, c.ordinal AS ordem, c.item_count AS registros, c.size_bytes AS bytes,
       c.updated_at AS atualizado_em, u.username AS atualizado_por, CONVERT(CHAR(64), c.content_hash, 2) AS sha256
FROM dbo.app_state_collection c
LEFT JOIN dbo.users u ON u.id = c.updated_by;
GO

/* ---------------------------------------------------------------------
   Estrutura do produto (PA/PI) com o item pai
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_estrutura_produto
AS
WITH e AS (
    SELECT TRY_CAST(r.[key] AS INT) AS linha, j.*
    FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        codigo        NVARCHAR(200) N'$."Código"',
        descricao     NVARCHAR(MAX) N'$."Descrição"',
        tipo_produto  NVARCHAR(50)  N'$."Tipo Produto"',
        codigo_pai    NVARCHAR(200) N'$."Código Pai"',
        tipo_pi       NVARCHAR(200) N'$."Tipo PI"',
        celula        NVARCHAR(200) N'$."Célula"',
        composicao    NVARCHAR(200) N'$."Composição"',
        modelo        NVARCHAR(200) N'$."Modelo"',
        capacidade_ah NVARCHAR(100) N'$."Capacidade (Ah)"',
        energia_wh    NVARCHAR(100) N'$."Energia (Wh)"'
    ) j
    WHERE c.name = N'estrutura' AND r.[type] = 5
)
SELECT e.linha, e.codigo, e.descricao, e.tipo_produto, e.codigo_pai, p.descricao AS descricao_pai, p.tipo_produto AS tipo_pai,
       e.tipo_pi, e.celula, e.composicao, e.modelo, e.capacidade_ah, rel.fn_num(e.capacidade_ah) AS capacidade_ah_num,
       e.energia_wh, rel.fn_num(e.energia_wh) AS energia_wh_num
FROM e
LEFT JOIN e AS p ON p.codigo COLLATE Latin1_General_100_BIN2 = NULLIF(e.codigo_pai, N'') COLLATE Latin1_General_100_BIN2;
GO

/* ---------------------------------------------------------------------
   Roteiros: etapa → recurso (equipamento) → quantidade de materiais
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_roteiro_recursos
AS
WITH rot AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        CodRoteiro NVARCHAR(200) N'$.CodRoteiro', CodigoProduto NVARCHAR(200) N'$.CodigoProduto', CodigoPI NVARCHAR(200) N'$.CodigoPI',
        Tipo NVARCHAR(200) N'$.Tipo', EscalaProducao NVARCHAR(200) N'$.EscalaProducao', Versao NVARCHAR(50) N'$.Versao',
        StatusRoteiro NVARCHAR(100) N'$.StatusRoteiro', DescricaoRoteiro NVARCHAR(MAX) N'$.DescricaoRoteiro'
    ) j WHERE c.name = N'roteiro' AND r.[type] = 5
), rec AS (
    SELECT TRY_CAST(r.[key] AS INT) AS linha, j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        IdRecursoRoteiro NVARCHAR(200) N'$.IdRecursoRoteiro', CodRoteiro NVARCHAR(200) N'$.CodRoteiro', OrdemEtapa NVARCHAR(50) N'$.OrdemEtapa',
        CodEquipamento NVARCHAR(200) N'$.CodEquipamento', Equipamento NVARCHAR(MAX) N'$.Equipamento', Processo NVARCHAR(MAX) N'$.Processo',
        SubProcesso NVARCHAR(MAX) N'$.SubProcesso', TempoOperacaoMin NVARCHAR(100) N'$.TempoOperacaoMin', NPessoas NVARCHAR(50) N'$.NPessoas',
        PotenciaEquipamento NVARCHAR(100) N'$.PotenciaEquipamento'
    ) j WHERE c.name = N'roteiro_recursos' AND r.[type] = 5
), mat AS (
    SELECT j.IdRecursoRoteiro, COUNT(*) AS materiais FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (IdRecursoRoteiro NVARCHAR(200) N'$.IdRecursoRoteiro') j
    WHERE c.name = N'roteiro_materiais' AND r.[type] = 5
    GROUP BY j.IdRecursoRoteiro
)
SELECT rec.linha, rec.CodRoteiro AS cod_roteiro, rot.CodigoProduto AS codigo_produto, rot.CodigoPI AS codigo_pi, rot.Tipo AS tipo_celula,
       rot.EscalaProducao AS escala, rot.Versao AS versao, rot.StatusRoteiro AS status_roteiro,
       rec.OrdemEtapa AS ordem_etapa, rel.fn_num(rec.OrdemEtapa) AS ordem_etapa_num, rec.Processo AS processo, rec.SubProcesso AS subprocesso,
       rec.IdRecursoRoteiro AS id_recurso_roteiro, rec.CodEquipamento AS cod_equipamento, rec.Equipamento AS equipamento,
       rec.TempoOperacaoMin AS tempo_operacao_min, rel.fn_num(rec.TempoOperacaoMin) AS tempo_operacao_min_num,
       rec.NPessoas AS n_pessoas, rec.PotenciaEquipamento AS potencia_w, ISNULL(mat.materiais, 0) AS materiais_vinculados
FROM rec
LEFT JOIN rot ON rot.CodRoteiro COLLATE Latin1_General_100_BIN2 = rec.CodRoteiro COLLATE Latin1_General_100_BIN2
LEFT JOIN mat ON mat.IdRecursoRoteiro COLLATE Latin1_General_100_BIN2 = rec.IdRecursoRoteiro COLLATE Latin1_General_100_BIN2;
GO

/* ---------------------------------------------------------------------
   OP com produto, roteiro e OP pai (família PI → PA)
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_op_familia
AS
WITH op AS (
    SELECT TRY_CAST(r.[key] AS INT) AS linha, j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        CodOP NVARCHAR(200) N'$.CodOP', CodRoteiro NVARCHAR(200) N'$.CodRoteiro', CodigoProduto NVARCHAR(200) N'$.CodigoProduto',
        DescricaoProduto NVARCHAR(MAX) N'$.DescricaoProduto', TipoOP NVARCHAR(50) N'$.TipoOP', OP_Base NVARCHAR(200) N'$.OP_Base',
        OP_Pai NVARCHAR(200) N'$.OP_Pai', Status NVARCHAR(100) N'$.Status', QtdPlanejada NVARCHAR(100) N'$.QtdPlanejada',
        QtdProduzida NVARCHAR(100) N'$.QtdProduzida', UM NVARCHAR(30) N'$.UM', DataOP NVARCHAR(50) N'$.DataOP',
        DataEncerramento NVARCHAR(50) N'$.DataEncerramento', CodFormula NVARCHAR(100) N'$.CodFormula',
        CustoMateriaisProjetado NVARCHAR(100) N'$.CustoMateriaisProjetado', CustoMateriaisEfetivo NVARCHAR(100) N'$.CustoMateriaisEfetivo',
        Usuario NVARCHAR(80) N'$.Usuario'
    ) j WHERE c.name = N'op' AND r.[type] = 5
), est AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (Codigo NVARCHAR(200) N'$."Código"', Descricao NVARCHAR(MAX) N'$."Descrição"', TipoProduto NVARCHAR(50) N'$."Tipo Produto"') j
    WHERE c.name = N'estrutura' AND r.[type] = 5
), rot AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (CodRoteiro NVARCHAR(200) N'$.CodRoteiro', Tipo NVARCHAR(200) N'$.Tipo', EscalaProducao NVARCHAR(200) N'$.EscalaProducao') j
    WHERE c.name = N'roteiro' AND r.[type] = 5
)
SELECT op.linha, op.CodOP AS cod_op, op.TipoOP AS tipo_op, op.OP_Base AS op_base, op.OP_Pai AS op_pai, pai.TipoOP AS tipo_op_pai,
       op.Status AS status, op.CodigoProduto AS codigo_produto, ISNULL(est.Descricao, op.DescricaoProduto) AS descricao_produto,
       est.TipoProduto AS tipo_produto, op.CodRoteiro AS cod_roteiro, rot.Tipo AS tipo_celula, rot.EscalaProducao AS escala,
       op.QtdPlanejada AS qtd_planejada, rel.fn_num(op.QtdPlanejada) AS qtd_planejada_num,
       op.QtdProduzida AS qtd_produzida, rel.fn_num(op.QtdProduzida) AS qtd_produzida_num, op.UM AS um,
       op.DataOP AS data_op, op.DataEncerramento AS data_encerramento, op.CodFormula AS cod_formula,
       rel.fn_num(op.CustoMateriaisProjetado) AS custo_materiais_projetado, rel.fn_num(op.CustoMateriaisEfetivo) AS custo_materiais_efetivo,
       op.Usuario AS usuario
FROM op
LEFT JOIN est ON est.Codigo COLLATE Latin1_General_100_BIN2 = op.CodigoProduto COLLATE Latin1_General_100_BIN2
LEFT JOIN rot ON rot.CodRoteiro COLLATE Latin1_General_100_BIN2 = op.CodRoteiro COLLATE Latin1_General_100_BIN2
LEFT JOIN op AS pai ON pai.CodOP COLLATE Latin1_General_100_BIN2 = NULLIF(op.OP_Pai, N'') COLLATE Latin1_General_100_BIN2;
GO

/* ---------------------------------------------------------------------
   Etapas da OP com equipamento (Cadastro de Recursos) e situação
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_op_etapas_equipamento
AS
WITH et AS (
    SELECT TRY_CAST(r.[key] AS INT) AS linha, j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        CodOP NVARCHAR(200) N'$.CodOP', Ordem NVARCHAR(50) N'$.Ordem', Processo NVARCHAR(MAX) N'$.Processo', IdProcesso NVARCHAR(100) N'$.IdProcesso',
        ProdutoGerado NVARCHAR(200) N'$.ProdutoGerado', QtdPlanejadaProduto NVARCHAR(100) N'$.QtdPlanejadaProduto', UMProduto NVARCHAR(30) N'$.UMProduto',
        IdRecursoRoteiro NVARCHAR(200) N'$.IdRecursoRoteiro', SequenciaRecurso NVARCHAR(20) N'$.SequenciaRecurso',
        CodEquipamento NVARCHAR(200) N'$.CodEquipamento', Equipamento NVARCHAR(MAX) N'$.Equipamento',
        TempoPlanejado NVARCHAR(100) N'$.TempoPlanejado', PessoasPlanejado NVARCHAR(50) N'$.PessoasPlanejado', Status NVARCHAR(100) N'$.Status'
    ) j WHERE c.name = N'op_etapas' AND r.[type] = 5
), op AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (CodOP NVARCHAR(200) N'$.CodOP', Status NVARCHAR(100) N'$.Status', TipoOP NVARCHAR(50) N'$.TipoOP', OP_Base NVARCHAR(200) N'$.OP_Base') j
    WHERE c.name = N'op' AND r.[type] = 5
), eq AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        Codigo NVARCHAR(200) N'$."Código Equipamento"', Equipamento NVARCHAR(MAX) N'$.Equipamento', Processo NVARCHAR(MAX) N'$.Processo',
        Escala NVARCHAR(100) N'$.Escala', Ativo NVARCHAR(20) N'$.Ativo', Potencia NVARCHAR(100) N'$."PotenciaEquipamento (W)"'
    ) j WHERE c.name = N'cad_recursos' AND r.[type] = 5
)
SELECT et.linha, et.CodOP AS cod_op, op.TipoOP AS tipo_op, op.OP_Base AS op_base, op.Status AS status_op,
       et.Ordem AS ordem, rel.fn_num(et.Ordem) AS ordem_num, et.Processo AS processo, et.IdProcesso AS id_processo,
       et.ProdutoGerado AS produto_gerado, et.QtdPlanejadaProduto AS qtd_planejada_produto, rel.fn_num(et.QtdPlanejadaProduto) AS qtd_planejada_produto_num,
       et.UMProduto AS um_produto, et.IdRecursoRoteiro AS id_recurso_roteiro, et.SequenciaRecurso AS sequencia_recurso,
       et.CodEquipamento AS cod_equipamento, ISNULL(eq.Equipamento, et.Equipamento) AS equipamento, eq.Escala AS escala_equipamento,
       eq.Ativo AS equipamento_ativo, eq.Potencia AS potencia_w,
       et.TempoPlanejado AS tempo_planejado_min, rel.fn_num(et.TempoPlanejado) AS tempo_planejado_min_num,
       et.PessoasPlanejado AS pessoas_planejado, et.Status AS status_etapa
FROM et
LEFT JOIN op ON op.CodOP COLLATE Latin1_General_100_BIN2 = et.CodOP COLLATE Latin1_General_100_BIN2
LEFT JOIN eq ON eq.Codigo COLLATE Latin1_General_100_BIN2 = et.CodEquipamento COLLATE Latin1_General_100_BIN2;
GO

/* ---------------------------------------------------------------------
   Materiais da OP com cadastro do material (rastreabilidade de lote/custo)
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_op_materiais_rastreabilidade
AS
WITH om AS (
    SELECT TRY_CAST(r.[key] AS INT) AS linha, j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        CodOP NVARCHAR(200) N'$.CodOP', Ordem NVARCHAR(50) N'$.Ordem', OrdemEtapa NVARCHAR(50) N'$.OrdemEtapa', Processo NVARCHAR(MAX) N'$.Processo',
        IdRecursoRoteiro NVARCHAR(200) N'$.IdRecursoRoteiro', CodEquipamento NVARCHAR(200) N'$.CodEquipamento',
        CodigoMaterial NVARCHAR(200) N'$.CodigoMaterial', CodigoPI NVARCHAR(200) N'$.CodigoPI', DescricaoMaterial NVARCHAR(MAX) N'$.DescricaoMaterial',
        EntradaMaterial NVARCHAR(100) N'$.EntradaMaterial', Lote NVARCHAR(MAX) N'$.Lote', LotesConsumidos NVARCHAR(MAX) N'$.LotesConsumidos',
        QtdPlanejada NVARCHAR(100) N'$.QtdPlanejada', QtdConsumida NVARCHAR(100) N'$.QtdConsumida', UM NVARCHAR(30) N'$.UM',
        CustoProjetado NVARCHAR(100) N'$.CustoProjetado', CustoEfetivo NVARCHAR(100) N'$.CustoEfetivo', CodFormula NVARCHAR(100) N'$.CodFormula',
        PercentualFormula NVARCHAR(50) N'$.PercentualFormula', TipoConsumo NVARCHAR(200) N'$.TipoConsumo'
    ) j WHERE c.name = N'op_materiais' AND r.[type] = 5
), mat AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (Codigo NVARCHAR(200) N'$."CódigoMaterial"', Descricao NVARCHAR(MAX) N'$.DescricaoMateriais', Categoria NVARCHAR(200) N'$.Categoria', UM NVARCHAR(30) N'$.UM') j
    WHERE c.name = N'materiais' AND r.[type] = 5
), op AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (CodOP NVARCHAR(200) N'$.CodOP', CodigoProduto NVARCHAR(200) N'$.CodigoProduto', Status NVARCHAR(100) N'$.Status', OP_Base NVARCHAR(200) N'$.OP_Base') j
    WHERE c.name = N'op' AND r.[type] = 5
)
SELECT om.linha, om.CodOP AS cod_op, op.OP_Base AS op_base, op.CodigoProduto AS produto_op, op.Status AS status_op,
       ISNULL(NULLIF(om.Ordem, N''), om.OrdemEtapa) AS ordem_etapa, om.Processo AS processo, om.IdRecursoRoteiro AS id_recurso_roteiro,
       om.CodEquipamento AS cod_equipamento, ISNULL(NULLIF(om.CodigoMaterial, N''), om.CodigoPI) AS codigo_item,
       ISNULL(mat.Descricao, om.DescricaoMaterial) AS descricao_item, mat.Categoria AS categoria_material,
       om.EntradaMaterial AS entrada, ISNULL(NULLIF(om.LotesConsumidos, N''), om.Lote) AS lotes,
       om.QtdPlanejada AS qtd_planejada, rel.fn_num(om.QtdPlanejada) AS qtd_planejada_num,
       om.QtdConsumida AS qtd_consumida, rel.fn_num(om.QtdConsumida) AS qtd_consumida_num, om.UM AS um,
       rel.fn_num(om.CustoProjetado) AS custo_projetado, rel.fn_num(om.CustoEfetivo) AS custo_efetivo,
       om.CodFormula AS cod_formula, om.PercentualFormula AS percentual_formula, om.TipoConsumo AS tipo_consumo
FROM om
LEFT JOIN op ON op.CodOP COLLATE Latin1_General_100_BIN2 = om.CodOP COLLATE Latin1_General_100_BIN2
LEFT JOIN mat ON mat.Codigo COLLATE Latin1_General_100_BIN2 = NULLIF(om.CodigoMaterial, N'') COLLATE Latin1_General_100_BIN2;
GO

/* ---------------------------------------------------------------------
   Entradas de materiais com material, fornecedor e projeto
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_entradas_material
AS
WITH en AS (
    SELECT TRY_CAST(r.[key] AS INT) AS linha, j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        Entrada NVARCHAR(100) N'$.Entrada', CodigoMaterial NVARCHAR(200) N'$."CódigoMaterial"', DescricaoMaterial NVARCHAR(MAX) N'$.DescricaoMaterial',
        QtdAdquirida NVARCHAR(100) N'$.QtdAdquirida', UnidadeMedida NVARCHAR(30) N'$.UnidadeMedida', CustoTotal NVARCHAR(100) N'$."Custo R$"',
        ValorUnitario NVARCHAR(100) N'$."ValorUnitario (R$/UM)"', Lote NVARCHAR(MAX) N'$.Lote', NomeFornecedor NVARCHAR(MAX) N'$.NomeFornecedor',
        CNPJFornecedor NVARCHAR(40) N'$.CNPJFornecedor', CodigoFornecedor NVARCHAR(100) N'$.CodigoFornecedor', NotaFiscal NVARCHAR(100) N'$."N° NF"',
        DataCadastro NVARCHAR(50) N'$.DataCadatro', CodigoProjeto NVARCHAR(100) N'$.CodigoProjeto', Projeto NVARCHAR(MAX) N'$.Projeto'
    ) j WHERE c.name = N'entradas' AND r.[type] = 5
), mat AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (Codigo NVARCHAR(200) N'$."CódigoMaterial"', Descricao NVARCHAR(MAX) N'$.DescricaoMateriais', Categoria NVARCHAR(200) N'$.Categoria') j
    WHERE c.name = N'materiais' AND r.[type] = 5
), emp AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (CodigoEM NVARCHAR(100) N'$.CodigoEM', RazaoSocial NVARCHAR(MAX) N'$.RazaoSocial', CNPJ NVARCHAR(40) N'$.CNPJ') j
    WHERE c.name = N'empresas' AND r.[type] = 5
), prj AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (CodProjeto NVARCHAR(100) N'$.CodProjeto', NomeProjeto NVARCHAR(MAX) N'$."Nome Projeto"') j
    WHERE c.name = N'projetos' AND r.[type] = 5
)
SELECT en.linha, en.Entrada AS entrada, en.CodigoMaterial AS codigo_material, ISNULL(mat.Descricao, en.DescricaoMaterial) AS descricao_material,
       mat.Categoria AS categoria, en.QtdAdquirida AS qtd_adquirida, rel.fn_num(en.QtdAdquirida) AS qtd_adquirida_num, en.UnidadeMedida AS um,
       rel.fn_num(en.CustoTotal) AS custo_total, rel.fn_num(en.ValorUnitario) AS valor_unitario, en.Lote AS lote,
       en.CodigoFornecedor AS codigo_fornecedor, ISNULL(emp.RazaoSocial, en.NomeFornecedor) AS fornecedor, ISNULL(emp.CNPJ, en.CNPJFornecedor) AS cnpj_fornecedor,
       en.NotaFiscal AS nota_fiscal, en.DataCadastro AS data_cadastro, en.CodigoProjeto AS codigo_projeto, ISNULL(prj.NomeProjeto, en.Projeto) AS projeto
FROM en
LEFT JOIN mat ON mat.Codigo COLLATE Latin1_General_100_BIN2 = en.CodigoMaterial COLLATE Latin1_General_100_BIN2
LEFT JOIN emp ON emp.CodigoEM COLLATE Latin1_General_100_BIN2 = NULLIF(en.CodigoFornecedor, N'') COLLATE Latin1_General_100_BIN2
LEFT JOIN prj ON prj.CodProjeto COLLATE Latin1_General_100_BIN2 = NULLIF(en.CodigoProjeto, N'') COLLATE Latin1_General_100_BIN2;
GO

/* ---------------------------------------------------------------------
   Apontamentos (produção e perdas) por OP
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_apontamentos_op
AS
SELECT N'PRODUCAO' AS tipo, TRY_CAST(r.[key] AS INT) AS linha, j.NOP AS registro, j.CodOP AS cod_op, j.Produto AS item, j.Processo AS processo,
       COALESCE(NULLIF(j.QuantidadeProduzida, N''), j.QuantidadeProduzida2) AS quantidade,
       rel.fn_num(COALESCE(NULLIF(j.QuantidadeProduzida, N''), j.QuantidadeProduzida2)) AS quantidade_num,
       j.Unidade AS um, j.DataApontamento AS data_apontamento, j.Operador AS operador, CAST(NULL AS NVARCHAR(MAX)) AS motivo
FROM dbo.app_state_collection c
CROSS APPLY OPENJSON(c.content) r
CROSS APPLY OPENJSON(r.[value]) WITH (
    NOP NVARCHAR(100) N'$.NOP', CodOP NVARCHAR(200) N'$.CodOP', Produto NVARCHAR(200) N'$.Produto', Processo NVARCHAR(MAX) N'$.Processo',
    QuantidadeProduzida NVARCHAR(100) N'$.QuantidadeProduzida', QuantidadeProduzida2 NVARCHAR(100) N'$."Quantidade produzida"',
    Unidade NVARCHAR(30) N'$."Unidade de medida"', DataApontamento NVARCHAR(50) N'$.DataApontamento', Operador NVARCHAR(200) N'$.Operador'
) j
WHERE c.name = N'producao' AND r.[type] = 5
UNION ALL
SELECT N'PERDA', TRY_CAST(r.[key] AS INT), j.NOPP, j.CodOP, COALESCE(NULLIF(j.ItemPerdaCodigo, N''), j.CodigoMaterial, j.Produto), j.Processo,
       j.QuantidadePerdida, rel.fn_num(j.QuantidadePerdida), j.Unidade, j.DataApontamento, j.Operador, j.Motivo
FROM dbo.app_state_collection c
CROSS APPLY OPENJSON(c.content) r
CROSS APPLY OPENJSON(r.[value]) WITH (
    NOPP NVARCHAR(100) N'$.NOPP', CodOP NVARCHAR(200) N'$.CodOP', ItemPerdaCodigo NVARCHAR(200) N'$.ItemPerdaCodigo',
    CodigoMaterial NVARCHAR(200) N'$.CodigoMaterial', Produto NVARCHAR(200) N'$.Produto', Processo NVARCHAR(MAX) N'$.Processo',
    QuantidadePerdida NVARCHAR(100) N'$.QuantidadePerdida', Unidade NVARCHAR(30) N'$.Unidade', DataApontamento NVARCHAR(50) N'$.DataApontamento',
    Operador NVARCHAR(200) N'$.Operador', Motivo NVARCHAR(MAX) N'$.Motivo'
) j
WHERE c.name = N'perdas' AND r.[type] = 5;
GO

/* ---------------------------------------------------------------------
   Passaporte da bateria com OP, produto e empresas (cliente/fornecedor)
   --------------------------------------------------------------------- */
CREATE OR ALTER VIEW rel.vw_passaporte_op
AS
WITH bp AS (
    SELECT TRY_CAST(r.[key] AS INT) AS linha, j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (
        BatteryPassportID NVARCHAR(200) N'$.BatteryPassportID', BatteryPassportGUID NVARCHAR(100) N'$.BatteryPassportGUID',
        CodProduto NVARCHAR(200) N'$.CodProduto', CodOrdemProducao NVARCHAR(200) N'$.CodOrdemProducao', IDLote NVARCHAR(200) N'$.IDLote',
        StatusPassaporte NVARCHAR(100) N'$.StatusPassaporte', VersaoPassaporte NVARCHAR(50) N'$.VersaoPassaporte',
        ClienteID NVARCHAR(100) N'$.ClienteID', FornecedorID NVARCHAR(100) N'$.FornecedorID', URLPassaporteWeb NVARCHAR(MAX) N'$.URLPassaporteWeb',
        DataCriacao NVARCHAR(50) N'$.DataCriacao', DataUltimaAlteracao NVARCHAR(50) N'$.DataUltimaAlteracao'
    ) j WHERE c.name = N'bp' AND r.[type] = 5
), emp AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (CodigoEM NVARCHAR(100) N'$.CodigoEM', RazaoSocial NVARCHAR(MAX) N'$.RazaoSocial', CNPJ NVARCHAR(40) N'$.CNPJ') j
    WHERE c.name = N'empresas' AND r.[type] = 5
), op AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (CodOP NVARCHAR(200) N'$.CodOP', Status NVARCHAR(100) N'$.Status', QtdPlanejada NVARCHAR(100) N'$.QtdPlanejada') j
    WHERE c.name = N'op' AND r.[type] = 5
), est AS (
    SELECT j.* FROM dbo.app_state_collection c
    CROSS APPLY OPENJSON(c.content) r
    CROSS APPLY OPENJSON(r.[value]) WITH (Codigo NVARCHAR(200) N'$."Código"', Descricao NVARCHAR(MAX) N'$."Descrição"', Modelo NVARCHAR(200) N'$.Modelo', Composicao NVARCHAR(200) N'$."Composição"') j
    WHERE c.name = N'estrutura' AND r.[type] = 5
)
SELECT bp.linha, bp.BatteryPassportID AS passaporte_id, bp.BatteryPassportGUID AS passaporte_guid, bp.StatusPassaporte AS status,
       bp.VersaoPassaporte AS versao, bp.CodProduto AS codigo_produto, est.Descricao AS descricao_produto, est.Modelo AS modelo, est.Composicao AS composicao,
       bp.CodOrdemProducao AS cod_op, op.Status AS status_op, bp.IDLote AS id_lote,
       bp.ClienteID AS cliente_id, cli.RazaoSocial AS cliente, cli.CNPJ AS cliente_cnpj,
       bp.FornecedorID AS fornecedor_id, forn.RazaoSocial AS fornecedor, forn.CNPJ AS fornecedor_cnpj,
       bp.URLPassaporteWeb AS url_publica, bp.DataCriacao AS data_criacao, bp.DataUltimaAlteracao AS data_ultima_alteracao
FROM bp
LEFT JOIN op ON op.CodOP COLLATE Latin1_General_100_BIN2 = bp.CodOrdemProducao COLLATE Latin1_General_100_BIN2
LEFT JOIN est ON est.Codigo COLLATE Latin1_General_100_BIN2 = bp.CodProduto COLLATE Latin1_General_100_BIN2
LEFT JOIN emp AS cli ON cli.CodigoEM COLLATE Latin1_General_100_BIN2 = NULLIF(bp.ClienteID, N'') COLLATE Latin1_General_100_BIN2
LEFT JOIN emp AS forn ON forn.CodigoEM COLLATE Latin1_General_100_BIN2 = NULLIF(bp.FornecedorID, N'') COLLATE Latin1_General_100_BIN2;
GO
