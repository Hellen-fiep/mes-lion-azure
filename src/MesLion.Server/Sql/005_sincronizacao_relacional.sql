/* =====================================================================
   MES LION — SQL Server / Azure SQL Database
   005 — SINCRONIZAÇÃO DO MODELO RELACIONAL
   rel.usp_sincronizar_modelo_relacional preenche as tabelas normalizadas
   (products, materials, suppliers, equipment, routes, route_steps,
   production_orders, op_steps, op_materials, battery_passports) a partir do
   estado gravado pelo frontend. A fonte de verdade continua sendo o estado:
   as tabelas são uma projeção para consultas, BI e integrações.
   - Chaves duplicadas: prevalece o PRIMEIRO registro (mesma regra do frontend ao localizar: Array.find).
   - Registros-filho sem pai (órfãos) não entram nas tabelas com FK e são listados em rel.qualidade_dados.
   - Equipamentos nunca são excluídos (preserva documentos): ausentes ficam inativos.
   A aplicação chama a procedure em segundo plano após as gravações.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE rel.usp_sincronizar_modelo_relacional
    @versao_estado BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @inicio DATETIMEOFFSET(3) = SYSDATETIMEOFFSET();
    UPDATE rel.sincronizacao_status SET iniciado_em = @inicio, versao_estado = @versao_estado WHERE id = 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @lock INT;
        EXEC @lock = sp_getapplock @Resource = N'mes_sincronizacao_relacional', @LockMode = N'Exclusive',
                                   @LockOwner = N'Transaction', @LockTimeout = 120000;
        IF @lock < 0 THROW 50001, N'Não foi possível obter a trava da sincronização relacional.', 1;

        DECLARE @autor UNIQUEIDENTIFIER = (SELECT updated_by FROM dbo.app_state WHERE id = 1);
        DECLARE @agora DATETIMEOFFSET(3) = SYSDATETIMEOFFSET();

        DECLARE @estrutura NVARCHAR(MAX), @materiais NVARCHAR(MAX), @empresas NVARCHAR(MAX), @cad_recursos NVARCHAR(MAX),
                @recursos NVARCHAR(MAX), @roteiro NVARCHAR(MAX), @roteiro_etapas NVARCHAR(MAX), @op NVARCHAR(MAX),
                @op_etapas NVARCHAR(MAX), @op_materiais NVARCHAR(MAX), @bp NVARCHAR(MAX);

        SELECT
            @estrutura      = MAX(CASE WHEN name = N'estrutura'      THEN content END),
            @materiais      = MAX(CASE WHEN name = N'materiais'      THEN content END),
            @empresas       = MAX(CASE WHEN name = N'empresas'       THEN content END),
            @cad_recursos   = MAX(CASE WHEN name = N'cad_recursos'   THEN content END),
            @recursos       = MAX(CASE WHEN name = N'recursos'       THEN content END),
            @roteiro        = MAX(CASE WHEN name = N'roteiro'        THEN content END),
            @roteiro_etapas = MAX(CASE WHEN name = N'roteiro_etapas' THEN content END),
            @op             = MAX(CASE WHEN name = N'op'             THEN content END),
            @op_etapas      = MAX(CASE WHEN name = N'op_etapas'      THEN content END),
            @op_materiais   = MAX(CASE WHEN name = N'op_materiais'   THEN content END),
            @bp             = MAX(CASE WHEN name = N'bp'             THEN content END)
        FROM dbo.app_state_collection
        WHERE name IN (N'estrutura', N'materiais', N'empresas', N'cad_recursos', N'recursos', N'roteiro',
                       N'roteiro_etapas', N'op', N'op_etapas', N'op_materiais', N'bp');

        -- Coleções ausentes ou que não sejam JSON (objeto/array) são tratadas como vazias.
        IF ISJSON(@estrutura) = 0 OR @estrutura IS NULL SET @estrutura = N'[]';
        IF ISJSON(@materiais) = 0 OR @materiais IS NULL SET @materiais = N'[]';
        IF ISJSON(@empresas) = 0 OR @empresas IS NULL SET @empresas = N'[]';
        IF ISJSON(@cad_recursos) = 0 OR @cad_recursos IS NULL SET @cad_recursos = N'[]';
        IF ISJSON(@recursos) = 0 OR @recursos IS NULL SET @recursos = N'[]';
        IF ISJSON(@roteiro) = 0 OR @roteiro IS NULL SET @roteiro = N'[]';
        IF ISJSON(@roteiro_etapas) = 0 OR @roteiro_etapas IS NULL SET @roteiro_etapas = N'[]';
        IF ISJSON(@op) = 0 OR @op IS NULL SET @op = N'[]';
        IF ISJSON(@op_etapas) = 0 OR @op_etapas IS NULL SET @op_etapas = N'[]';
        IF ISJSON(@op_materiais) = 0 OR @op_materiais IS NULL SET @op_materiais = N'[]';
        IF ISJSON(@bp) = 0 OR @bp IS NULL SET @bp = N'[]';

        DELETE FROM rel.qualidade_dados;

        /* ================================================= products ← estrutura */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload,
               NULLIF(LTRIM(RTRIM(j.code)), N'') COLLATE Latin1_General_100_BIN2 AS code, NULLIF(LTRIM(RTRIM(j.parent_code)), N'') COLLATE Latin1_General_100_BIN2 AS parent_code,
               j.product_type, j.description, j.unit
        INTO #prod
        FROM OPENJSON(@estrutura) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            code NVARCHAR(400) N'$."Código"', parent_code NVARCHAR(400) N'$."Código Pai"', product_type NVARCHAR(100) N'$."Tipo Produto"',
            description NVARCHAR(MAX) N'$."Descrição"', unit NVARCHAR(100) N'$."Unidade de Produção"'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'products', N'SEM_CHAVE', NULL, N'estrutura[' + CAST(idx AS NVARCHAR(20)) + N'] sem "Código" válido'
        FROM #prod WHERE code IS NULL OR LEN(code) > 100;
        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'products', N'DUPLICADO', code, CAST(COUNT(*) AS NVARCHAR(20)) + N' registros com o mesmo código em estrutura'
        FROM #prod WHERE code IS NOT NULL AND LEN(code) <= 100 GROUP BY code HAVING COUNT(*) > 1;

        ;WITH s AS (
            SELECT code, LEFT(parent_code, 100) AS parent_code,
                   LEFT(product_type, 20) AS product_type, description, LEFT(unit, 30) AS unit, payload,
                   ROW_NUMBER() OVER (PARTITION BY code ORDER BY idx ASC) AS rn
            FROM #prod WHERE code IS NOT NULL AND LEN(code) <= 100
        )
        MERGE dbo.products AS t
        USING (SELECT * FROM s WHERE rn = 1) AS s ON t.code = s.code
        WHEN MATCHED AND t.payload COLLATE Latin1_General_100_BIN2 <> s.payload COLLATE Latin1_General_100_BIN2 THEN
            UPDATE SET parent_code = s.parent_code, product_type = s.product_type, description = s.description, unit = s.unit,
                       payload = s.payload, updated_at = @agora, updated_by = @autor
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (code, parent_code, product_type, description, unit, payload, updated_at, updated_by)
            VALUES (s.code, s.parent_code, s.product_type, s.description, s.unit, s.payload, @agora, @autor)
        WHEN NOT MATCHED BY SOURCE THEN DELETE;

        /* ================================================= materials ← materiais */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.code)), N'') COLLATE Latin1_General_100_BIN2 AS code, j.description, j.unit
        INTO #mat
        FROM OPENJSON(@materiais) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            code NVARCHAR(400) N'$."CódigoMaterial"', description NVARCHAR(MAX) N'$.DescricaoMateriais', unit NVARCHAR(100) N'$.UM'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'materials', N'SEM_CHAVE', NULL, N'materiais[' + CAST(idx AS NVARCHAR(20)) + N'] sem "CódigoMaterial" válido'
        FROM #mat WHERE code IS NULL OR LEN(code) > 100;
        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'materials', N'DUPLICADO', code, CAST(COUNT(*) AS NVARCHAR(20)) + N' registros com o mesmo código em materiais'
        FROM #mat WHERE code IS NOT NULL AND LEN(code) <= 100 GROUP BY code HAVING COUNT(*) > 1;

        ;WITH s AS (
            SELECT code, description, LEFT(unit, 30) AS unit, payload,
                   ROW_NUMBER() OVER (PARTITION BY code ORDER BY idx ASC) AS rn
            FROM #mat WHERE code IS NOT NULL AND LEN(code) <= 100
        )
        MERGE dbo.materials AS t
        USING (SELECT * FROM s WHERE rn = 1) AS s ON t.code = s.code
        WHEN MATCHED AND t.payload COLLATE Latin1_General_100_BIN2 <> s.payload COLLATE Latin1_General_100_BIN2 THEN
            UPDATE SET description = s.description, unit = s.unit, payload = s.payload, updated_at = @agora, updated_by = @autor
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (code, description, unit, payload, updated_at, updated_by) VALUES (s.code, s.description, s.unit, s.payload, @agora, @autor)
        WHEN NOT MATCHED BY SOURCE THEN DELETE;

        /* ================================================= suppliers ← empresas */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.code)), N'') COLLATE Latin1_General_100_BIN2 AS code, j.name, j.tax_id
        INTO #sup
        FROM OPENJSON(@empresas) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            code NVARCHAR(400) N'$.CodigoEM', name NVARCHAR(MAX) N'$.RazaoSocial', tax_id NVARCHAR(100) N'$.CNPJ'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'suppliers', N'SEM_CHAVE', NULL, N'empresas[' + CAST(idx AS NVARCHAR(20)) + N'] sem "CodigoEM" válido'
        FROM #sup WHERE code IS NULL OR LEN(code) > 100;

        ;WITH s AS (
            SELECT code, name, LEFT(tax_id, 40) AS tax_id, payload,
                   ROW_NUMBER() OVER (PARTITION BY code ORDER BY idx ASC) AS rn
            FROM #sup WHERE code IS NOT NULL AND LEN(code) <= 100
        )
        MERGE dbo.suppliers AS t
        USING (SELECT * FROM s WHERE rn = 1) AS s ON t.code = s.code
        WHEN MATCHED AND t.payload COLLATE Latin1_General_100_BIN2 <> s.payload COLLATE Latin1_General_100_BIN2 THEN
            UPDATE SET name = s.name, tax_id = s.tax_id, payload = s.payload, updated_at = @agora, updated_by = @autor
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (code, name, tax_id, payload, updated_at, updated_by) VALUES (s.code, s.name, s.tax_id, s.payload, @agora, @autor)
        WHEN NOT MATCHED BY SOURCE THEN DELETE;

        /* ================================================= equipment ← cad_recursos (+ recursos) */
        SELECT 1 AS prioridade, TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.code)), N'') COLLATE Latin1_General_100_BIN2 AS code,
               j.name, j.process,
               CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(j.ativo, N'')))) IN (N'NÃO', N'NAO', N'N', N'FALSE', N'0', N'INATIVO') THEN 0 ELSE 1 END AS active
        INTO #eq
        FROM OPENJSON(@cad_recursos) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            code NVARCHAR(400) N'$."Código Equipamento"', name NVARCHAR(MAX) N'$.Equipamento', process NVARCHAR(MAX) N'$.Processo', ativo NVARCHAR(50) N'$.Ativo'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO #eq (prioridade, idx, payload, code, name, process, active)
        SELECT 2, TRY_CAST(r.[key] AS INT), r.[value], NULLIF(LTRIM(RTRIM(j.code)), N''), j.name, j.process, 1
        FROM OPENJSON(@recursos) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            code NVARCHAR(400) N'$.CodEquipamento', name NVARCHAR(MAX) N'$.Equipamento', process NVARCHAR(MAX) N'$.Processo'
        ) j
        WHERE r.[type] = 5;

        ;WITH s AS (
            SELECT code, name, process, active, payload,
                   ROW_NUMBER() OVER (PARTITION BY code ORDER BY prioridade ASC, idx ASC) AS rn
            FROM #eq WHERE code IS NOT NULL AND LEN(code) <= 100
        )
        MERGE dbo.equipment AS t
        USING (SELECT * FROM s WHERE rn = 1) AS s ON t.code = s.code
        WHEN MATCHED AND (t.payload COLLATE Latin1_General_100_BIN2 <> s.payload COLLATE Latin1_General_100_BIN2 OR t.active <> s.active) THEN
            UPDATE SET name = s.name, process = s.process, active = s.active, payload = s.payload, updated_at = @agora, updated_by = @autor
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (code, name, process, active, payload, updated_at, updated_by) VALUES (s.code, s.name, s.process, s.active, s.payload, @agora, @autor)
        WHEN NOT MATCHED BY SOURCE AND t.active = 1 THEN
            UPDATE SET active = 0, updated_at = @agora;

        /* ================================================= routes ← roteiro */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.code)), N'') COLLATE Latin1_General_100_BIN2 AS code,
               COALESCE(NULLIF(LTRIM(RTRIM(j.produto)), N''), NULLIF(LTRIM(RTRIM(j.pi)), N'')) COLLATE Latin1_General_100_BIN2 AS product_code, j.version
        INTO #rot
        FROM OPENJSON(@roteiro) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            code NVARCHAR(400) N'$.CodRoteiro', produto NVARCHAR(400) N'$.CodigoProduto', pi NVARCHAR(400) N'$.CodigoPI', version NVARCHAR(100) N'$.Versao'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'routes', N'DUPLICADO', code, CAST(COUNT(*) AS NVARCHAR(20)) + N' roteiros com o mesmo CodRoteiro'
        FROM #rot WHERE code IS NOT NULL AND LEN(code) <= 100 GROUP BY code HAVING COUNT(*) > 1;

        ;WITH s AS (
            SELECT code, LEFT(product_code, 100) AS product_code,
                   LEFT(version, 50) AS version, payload,
                   ROW_NUMBER() OVER (PARTITION BY code ORDER BY idx ASC) AS rn
            FROM #rot WHERE code IS NOT NULL AND LEN(code) <= 100
        )
        MERGE dbo.routes AS t
        USING (SELECT * FROM s WHERE rn = 1) AS s ON t.code = s.code
        WHEN MATCHED AND t.payload COLLATE Latin1_General_100_BIN2 <> s.payload COLLATE Latin1_General_100_BIN2 THEN
            UPDATE SET product_code = s.product_code, version = s.version, payload = s.payload, updated_at = @agora, updated_by = @autor
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (code, product_code, version, payload, updated_at, updated_by) VALUES (s.code, s.product_code, s.version, s.payload, @agora, @autor)
        WHEN NOT MATCHED BY SOURCE THEN DELETE;

        /* ================================================= route_steps ← roteiro_etapas */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.route_code)), N'') COLLATE Latin1_General_100_BIN2 AS route_code,
               j.ordem, j.process, NULLIF(LTRIM(RTRIM(j.equipment_code)), N'') COLLATE Latin1_General_100_BIN2 AS equipment_code
        INTO #rstep
        FROM OPENJSON(@roteiro_etapas) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            route_code NVARCHAR(400) N'$.CodRoteiro', ordem NVARCHAR(100) N'$.Ordem', process NVARCHAR(MAX) N'$.Processo', equipment_code NVARCHAR(400) N'$.CodEquipamento'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'route_steps', N'ORFAO', s.route_code, N'roteiro_etapas[' + CAST(s.idx AS NVARCHAR(20)) + N'] referencia roteiro inexistente'
        FROM #rstep s
        WHERE NOT EXISTS (SELECT 1 FROM dbo.routes r WHERE r.code = s.route_code);

        DELETE FROM dbo.route_steps;
        INSERT INTO dbo.route_steps (route_code, step_order, process, equipment_code, payload)
        SELECT s.route_code, rel.fn_num(s.ordem), s.process, LEFT(s.equipment_code, 100), s.payload
        FROM #rstep s
        WHERE EXISTS (SELECT 1 FROM dbo.routes r WHERE r.code = s.route_code)
        ORDER BY s.idx;

        /* ================================================= production_orders ← op */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.code)), N'') COLLATE Latin1_General_100_BIN2 AS code,
               COALESCE(NULLIF(LTRIM(RTRIM(j.produto)), N''), NULLIF(LTRIM(RTRIM(j.pi)), N'')) COLLATE Latin1_General_100_BIN2 AS product_code,
               NULLIF(LTRIM(RTRIM(j.parent_op)), N'') COLLATE Latin1_General_100_BIN2 AS parent_op, NULLIF(LTRIM(RTRIM(j.route_code)), N'') COLLATE Latin1_General_100_BIN2 AS route_code,
               j.status, j.qtd, j.unit
        INTO #ops
        FROM OPENJSON(@op) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            code NVARCHAR(400) N'$.CodOP', produto NVARCHAR(400) N'$.CodigoProduto', pi NVARCHAR(400) N'$.CodigoPI',
            parent_op NVARCHAR(400) N'$.OP_Pai', route_code NVARCHAR(400) N'$.CodRoteiro', status NVARCHAR(200) N'$.Status',
            qtd NVARCHAR(100) N'$.QtdPlanejada', unit NVARCHAR(100) N'$.UM'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'production_orders', N'SEM_CHAVE', NULL, N'op[' + CAST(idx AS NVARCHAR(20)) + N'] sem "CodOP" válido'
        FROM #ops WHERE code IS NULL OR LEN(code) > 120;
        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'production_orders', N'DUPLICADO', code, CAST(COUNT(*) AS NVARCHAR(20)) + N' OPs com o mesmo CodOP'
        FROM #ops WHERE code IS NOT NULL AND LEN(code) <= 120 GROUP BY code HAVING COUNT(*) > 1;

        SELECT code, LEFT(product_code, 100) AS product_code,
               LEFT(parent_op, 120) AS parent_op, LEFT(route_code, 100) AS route_code,
               LEFT(status, 50) AS status, rel.fn_num(qtd) AS planned_qty, LEFT(unit, 30) AS unit, payload
        INTO #ops_final
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY code ORDER BY idx ASC) AS rn
            FROM #ops WHERE code IS NOT NULL AND LEN(code) <= 120
        ) x WHERE rn = 1;

        MERGE dbo.production_orders AS t
        USING #ops_final AS s ON t.code = s.code
        WHEN MATCHED AND t.payload COLLATE Latin1_General_100_BIN2 <> s.payload COLLATE Latin1_General_100_BIN2 THEN
            UPDATE SET product_code = s.product_code, parent_op = s.parent_op, route_code = s.route_code, status = s.status,
                       planned_qty = s.planned_qty, unit = s.unit, payload = s.payload, updated_at = @agora, updated_by = @autor
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (code, product_code, parent_op, route_code, status, planned_qty, unit, payload, updated_at, updated_by)
            VALUES (s.code, s.product_code, s.parent_op, s.route_code, s.status, s.planned_qty, s.unit, s.payload, @agora, @autor);

        /* ================================================= battery_passports ← bp (antes de remover OPs antigas) */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.id)), N'') COLLATE Latin1_General_100_BIN2 AS id,
               NULLIF(LTRIM(RTRIM(j.op_code)), N'') COLLATE Latin1_General_100_BIN2 AS op_code, NULLIF(LTRIM(RTRIM(j.product_code)), N'') COLLATE Latin1_General_100_BIN2 AS product_code
        INTO #bp
        FROM OPENJSON(@bp) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            id NVARCHAR(400) N'$.BatteryPassportID', op_code NVARCHAR(400) N'$.CodOrdemProducao', product_code NVARCHAR(400) N'$.CodProduto'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'battery_passports', N'ORFAO', b.op_code, N'bp ' + ISNULL(b.id, N'?') + N' referencia OP inexistente (op_code gravado como NULL)'
        FROM #bp b
        WHERE b.op_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #ops_final o WHERE o.code = b.op_code);

        ;WITH s AS (
            SELECT b.id,
                   CASE WHEN EXISTS (SELECT 1 FROM #ops_final o WHERE o.code = b.op_code)
                        THEN LEFT(b.op_code, 120) END AS op_code,
                   LEFT(b.product_code, 100) AS product_code, b.payload,
                   ROW_NUMBER() OVER (PARTITION BY b.id ORDER BY b.idx ASC) AS rn
            FROM #bp b WHERE b.id IS NOT NULL AND LEN(b.id) <= 200
        )
        MERGE dbo.battery_passports AS t
        USING (SELECT * FROM s WHERE rn = 1) AS s ON t.id = s.id
        WHEN MATCHED AND (t.payload COLLATE Latin1_General_100_BIN2 <> s.payload COLLATE Latin1_General_100_BIN2 OR ISNULL(t.op_code, N'') <> ISNULL(s.op_code, N'')) THEN
            UPDATE SET op_code = s.op_code, product_code = s.product_code, payload = s.payload, updated_at = @agora, updated_by = @autor
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (id, op_code, product_code, payload, updated_at, updated_by) VALUES (s.id, s.op_code, s.product_code, s.payload, @agora, @autor)
        WHEN NOT MATCHED BY SOURCE THEN DELETE;

        -- OPs que não existem mais no estado (etapas/materiais/flags são removidos em cascata).
        -- OPs referenciadas por tabelas reservadas preenchidas manualmente são preservadas.
        DELETE t FROM dbo.production_orders t
        WHERE NOT EXISTS (SELECT 1 FROM #ops_final s WHERE s.code = t.code)
          AND NOT EXISTS (SELECT 1 FROM dbo.battery_passports b WHERE b.op_code = t.code)
          AND NOT EXISTS (SELECT 1 FROM dbo.icv_snapshots i WHERE i.op_code = t.code)
          AND NOT EXISTS (SELECT 1 FROM dbo.lcc_studies l WHERE l.op_code = t.code)
          AND NOT EXISTS (SELECT 1 FROM dbo.setup_time_logs st WHERE st.op_code = t.code);

        /* ================================================= op_steps ← op_etapas */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.op_code)), N'') COLLATE Latin1_General_100_BIN2 AS op_code,
               j.ordem, j.process, NULLIF(LTRIM(RTRIM(j.equipment_code)), N'') COLLATE Latin1_General_100_BIN2 AS equipment_code
        INTO #ostep
        FROM OPENJSON(@op_etapas) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            op_code NVARCHAR(400) N'$.CodOP', ordem NVARCHAR(100) N'$.Ordem', process NVARCHAR(MAX) N'$.Processo', equipment_code NVARCHAR(400) N'$.CodEquipamento'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'op_steps', N'ORFAO', s.op_code, N'op_etapas[' + CAST(s.idx AS NVARCHAR(20)) + N'] referencia OP inexistente'
        FROM #ostep s
        WHERE NOT EXISTS (SELECT 1 FROM dbo.production_orders o WHERE o.code = s.op_code);

        DELETE FROM dbo.op_steps;
        INSERT INTO dbo.op_steps (op_code, step_order, process, equipment_code, payload)
        SELECT s.op_code, rel.fn_num(s.ordem), s.process, LEFT(s.equipment_code, 100), s.payload
        FROM #ostep s
        WHERE EXISTS (SELECT 1 FROM dbo.production_orders o WHERE o.code = s.op_code)
        ORDER BY s.idx;

        /* ================================================= op_materials ← op_materiais */
        SELECT TRY_CAST(r.[key] AS INT) AS idx, r.[value] AS payload, NULLIF(LTRIM(RTRIM(j.op_code)), N'') COLLATE Latin1_General_100_BIN2 AS op_code,
               NULLIF(LTRIM(RTRIM(j.material)), N'') COLLATE Latin1_General_100_BIN2 AS material, NULLIF(LTRIM(RTRIM(j.pi)), N'') COLLATE Latin1_General_100_BIN2 AS pi,
               COALESCE(NULLIF(j.ordem, N''), j.ordem_etapa) AS ordem, j.qtd, j.unit, COALESCE(NULLIF(j.lote, N''), j.lote_pi) AS lot
        INTO #omat
        FROM OPENJSON(@op_materiais) r
        CROSS APPLY OPENJSON(r.[value]) WITH (
            op_code NVARCHAR(400) N'$.CodOP', material NVARCHAR(400) N'$.CodigoMaterial', pi NVARCHAR(400) N'$.CodigoPI',
            ordem NVARCHAR(100) N'$.Ordem', ordem_etapa NVARCHAR(100) N'$.OrdemEtapa', qtd NVARCHAR(100) N'$.QtdPlanejada',
            unit NVARCHAR(100) N'$.UM', lote NVARCHAR(MAX) N'$.Lote', lote_pi NVARCHAR(MAX) N'$.IDLotePI'
        ) j
        WHERE r.[type] = 5;

        INSERT INTO rel.qualidade_dados (versao_estado, tabela, tipo, chave, detalhe)
        SELECT @versao_estado, N'op_materials', N'ORFAO', s.op_code, N'op_materiais[' + CAST(s.idx AS NVARCHAR(20)) + N'] referencia OP inexistente'
        FROM #omat s
        WHERE NOT EXISTS (SELECT 1 FROM dbo.production_orders o WHERE o.code = s.op_code);

        DELETE FROM dbo.op_materials;
        INSERT INTO dbo.op_materials (op_code, material_code, consumed_pi_code, step_order, planned_qty, unit, lot, payload)
        SELECT s.op_code, LEFT(s.material, 100),
               CASE WHEN s.material IS NULL THEN LEFT(s.pi, 100) END,
               rel.fn_num(s.ordem), rel.fn_num(s.qtd), LEFT(s.unit, 30), s.lot, s.payload
        FROM #omat s
        WHERE EXISTS (SELECT 1 FROM dbo.production_orders o WHERE o.code = s.op_code)
        ORDER BY s.idx;

        DECLARE @resumo NVARCHAR(MAX) = CONCAT(
            N'products=', (SELECT COUNT(*) FROM dbo.products),
            N'; materials=', (SELECT COUNT(*) FROM dbo.materials),
            N'; suppliers=', (SELECT COUNT(*) FROM dbo.suppliers),
            N'; equipment=', (SELECT COUNT(*) FROM dbo.equipment WHERE active = 1),
            N'; routes=', (SELECT COUNT(*) FROM dbo.routes),
            N'; route_steps=', (SELECT COUNT(*) FROM dbo.route_steps),
            N'; production_orders=', (SELECT COUNT(*) FROM dbo.production_orders),
            N'; op_steps=', (SELECT COUNT(*) FROM dbo.op_steps),
            N'; op_materials=', (SELECT COUNT(*) FROM dbo.op_materials),
            N'; battery_passports=', (SELECT COUNT(*) FROM dbo.battery_passports),
            N'; avisos_qualidade=', (SELECT COUNT(*) FROM rel.qualidade_dados));

        UPDATE rel.sincronizacao_status
           SET concluido_em = SYSDATETIMEOFFSET(), sucesso = 1, mensagem = @resumo, versao_estado = @versao_estado
         WHERE id = 1;

        COMMIT TRANSACTION;
        SELECT @resumo AS resumo;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        DECLARE @erro NVARCHAR(4000) = CONCAT(N'Erro ', ERROR_NUMBER(), N' (linha ', ERROR_LINE(), N'): ', ERROR_MESSAGE());
        UPDATE rel.sincronizacao_status SET concluido_em = SYSDATETIMEOFFSET(), sucesso = 0, mensagem = @erro WHERE id = 1;
        THROW;
    END CATCH
END;
GO
