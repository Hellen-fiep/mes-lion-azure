/* =====================================================================
   MES LION — SQL Server / Azure SQL Database
   002 — MODELO RELACIONAL (tradução 1:1 das tabelas do PostgreSQL)
   Origem: database/schema.sql + database/02_extensoes_planejamento_estoque.sql
   Mapeamento de tipos: uuid→UNIQUEIDENTIFIER, jsonb→NVARCHAR(MAX) (JSON),
   timestamptz→DATETIMEOFFSET, timestamp→DATETIME2, text→NVARCHAR, numeric→DECIMAL(38,10),
   boolean→BIT, bigserial→BIGINT IDENTITY.
   Colunas de código usam collation binária (comparação exata, como no PostgreSQL/JavaScript).
   As tabelas marcadas [SINCRONIZADA] são preenchidas automaticamente a partir do estado do
   MES pela procedure rel.usp_sincronizar_modelo_relacional (script 005).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* products  [SINCRONIZADA ← estrutura] */
IF OBJECT_ID(N'dbo.products', N'U') IS NULL
CREATE TABLE dbo.products (
    code          NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_products PRIMARY KEY,
    parent_code   NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    product_type  NVARCHAR(20)  NULL,
    description   NVARCHAR(MAX) NULL,
    unit          NVARCHAR(30)  NULL,
    payload       NVARCHAR(MAX) NOT NULL CONSTRAINT DF_products_payload DEFAULT N'{}',
    updated_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_products_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_products_updated_by REFERENCES dbo.users(id)
);
GO

/* materials  [SINCRONIZADA ← materiais] */
IF OBJECT_ID(N'dbo.materials', N'U') IS NULL
CREATE TABLE dbo.materials (
    code          NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_materials PRIMARY KEY,
    description   NVARCHAR(MAX) NULL,
    unit          NVARCHAR(30)  NULL,
    payload       NVARCHAR(MAX) NOT NULL CONSTRAINT DF_materials_payload DEFAULT N'{}',
    updated_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_materials_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_materials_updated_by REFERENCES dbo.users(id)
);
GO

/* suppliers  [SINCRONIZADA ← empresas] */
IF OBJECT_ID(N'dbo.suppliers', N'U') IS NULL
CREATE TABLE dbo.suppliers (
    code          NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_suppliers PRIMARY KEY,
    name          NVARCHAR(MAX) NULL,
    tax_id        NVARCHAR(40)  NULL,
    payload       NVARCHAR(MAX) NOT NULL CONSTRAINT DF_suppliers_payload DEFAULT N'{}',
    updated_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_suppliers_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_suppliers_updated_by REFERENCES dbo.users(id)
);
GO

/* equipment  [SINCRONIZADA ← cad_recursos + recursos; nunca excluída: inativada] */
IF OBJECT_ID(N'dbo.equipment', N'U') IS NULL
CREATE TABLE dbo.equipment (
    code          NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_equipment PRIMARY KEY,
    name          NVARCHAR(MAX) NULL,
    process       NVARCHAR(MAX) NULL,
    active        BIT           NOT NULL CONSTRAINT DF_equipment_active DEFAULT 1,
    payload       NVARCHAR(MAX) NOT NULL CONSTRAINT DF_equipment_payload DEFAULT N'{}',
    updated_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_equipment_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_equipment_updated_by REFERENCES dbo.users(id)
);
GO

/* equipment_documents  (usada pela aplicação: documentos PDF/Excel dos equipamentos) */
IF OBJECT_ID(N'dbo.equipment_documents', N'U') IS NULL
CREATE TABLE dbo.equipment_documents (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_equipment_documents PRIMARY KEY CONSTRAINT DF_equipment_documents_id DEFAULT NEWID(),
    equipment_code NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL
                   CONSTRAINT FK_equipment_documents_equipment REFERENCES dbo.equipment(code) ON DELETE CASCADE,
    original_name  NVARCHAR(400) NOT NULL,
    stored_name    NVARCHAR(400) NOT NULL,
    mime_type      NVARCHAR(200) NULL,
    file_size      BIGINT        NULL,
    document_type  NVARCHAR(80)  NULL,
    revision       NVARCHAR(40)  NULL,
    active         BIT           NOT NULL CONSTRAINT DF_equipment_documents_active DEFAULT 1,
    uploaded_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_equipment_documents_uploaded_at DEFAULT SYSDATETIMEOFFSET(),
    uploaded_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_equipment_documents_uploaded_by REFERENCES dbo.users(id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_docs_equipment' AND object_id = OBJECT_ID(N'dbo.equipment_documents'))
    CREATE INDEX idx_docs_equipment ON dbo.equipment_documents(equipment_code);
GO

/* routes  [SINCRONIZADA ← roteiro] */
IF OBJECT_ID(N'dbo.routes', N'U') IS NULL
CREATE TABLE dbo.routes (
    code          NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_routes PRIMARY KEY,
    product_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    version       NVARCHAR(50)  NULL,
    payload       NVARCHAR(MAX) NOT NULL CONSTRAINT DF_routes_payload DEFAULT N'{}',
    updated_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_routes_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_routes_updated_by REFERENCES dbo.users(id)
);
GO

/* route_steps  [SINCRONIZADA ← roteiro_etapas] */
IF OBJECT_ID(N'dbo.route_steps', N'U') IS NULL
CREATE TABLE dbo.route_steps (
    id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_route_steps PRIMARY KEY,
    route_code      NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL
                    CONSTRAINT FK_route_steps_route REFERENCES dbo.routes(code) ON DELETE CASCADE,
    step_order      DECIMAL(38,10) NULL,
    process         NVARCHAR(MAX) NULL,
    equipment_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    payload         NVARCHAR(MAX) NOT NULL CONSTRAINT DF_route_steps_payload DEFAULT N'{}'
);
GO

/* production_orders  [SINCRONIZADA ← op] */
IF OBJECT_ID(N'dbo.production_orders', N'U') IS NULL
CREATE TABLE dbo.production_orders (
    code          NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_production_orders PRIMARY KEY,
    product_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    parent_op     NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NULL,
    route_code    NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    status        NVARCHAR(50)  NULL,
    planned_qty   DECIMAL(38,10) NULL,
    unit          NVARCHAR(30)  NULL,
    payload       NVARCHAR(MAX) NOT NULL CONSTRAINT DF_production_orders_payload DEFAULT N'{}',
    updated_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_production_orders_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_production_orders_updated_by REFERENCES dbo.users(id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_op_parent' AND object_id = OBJECT_ID(N'dbo.production_orders'))
    CREATE INDEX idx_op_parent ON dbo.production_orders(parent_op);
GO

/* op_steps  [SINCRONIZADA ← op_etapas] */
IF OBJECT_ID(N'dbo.op_steps', N'U') IS NULL
CREATE TABLE dbo.op_steps (
    id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_op_steps PRIMARY KEY,
    op_code         NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NOT NULL
                    CONSTRAINT FK_op_steps_op REFERENCES dbo.production_orders(code) ON DELETE CASCADE,
    step_order      DECIMAL(38,10) NULL,
    process         NVARCHAR(MAX) NULL,
    equipment_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    payload         NVARCHAR(MAX) NOT NULL CONSTRAINT DF_op_steps_payload DEFAULT N'{}'
);
GO

/* op_materials  [SINCRONIZADA ← op_materiais] */
IF OBJECT_ID(N'dbo.op_materials', N'U') IS NULL
CREATE TABLE dbo.op_materials (
    id                BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_op_materials PRIMARY KEY,
    op_code           NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NOT NULL
                      CONSTRAINT FK_op_materials_op REFERENCES dbo.production_orders(code) ON DELETE CASCADE,
    material_code     NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    consumed_pi_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    step_order        DECIMAL(38,10) NULL,
    planned_qty       DECIMAL(38,10) NULL,
    unit              NVARCHAR(30)  NULL,
    lot               NVARCHAR(MAX) NULL,
    payload           NVARCHAR(MAX) NOT NULL CONSTRAINT DF_op_materials_payload DEFAULT N'{}'
);
GO

/* op_document_flags  (reservada — o frontend guarda as marcações na própria OP) */
IF OBJECT_ID(N'dbo.op_document_flags', N'U') IS NULL
CREATE TABLE dbo.op_document_flags (
    op_code        NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NOT NULL
                   CONSTRAINT FK_op_document_flags_op REFERENCES dbo.production_orders(code) ON DELETE CASCADE,
    document_id    UNIQUEIDENTIFIER NOT NULL
                   CONSTRAINT FK_op_document_flags_doc REFERENCES dbo.equipment_documents(id) ON DELETE CASCADE,
    include_print  BIT NOT NULL CONSTRAINT DF_op_document_flags_include DEFAULT 1,
    CONSTRAINT PK_op_document_flags PRIMARY KEY (op_code, document_id)
);
GO

/* icv_snapshots  (reservada) */
IF OBJECT_ID(N'dbo.icv_snapshots', N'U') IS NULL
CREATE TABLE dbo.icv_snapshots (
    id                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_icv_snapshots PRIMARY KEY CONSTRAINT DF_icv_snapshots_id DEFAULT NEWID(),
    op_code              NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NULL CONSTRAINT FK_icv_snapshots_op REFERENCES dbo.production_orders(code),
    scenario             NVARCHAR(MAX) NULL,
    payload              NVARCHAR(MAX) NOT NULL,
    active_for_passport  BIT NOT NULL CONSTRAINT DF_icv_snapshots_active DEFAULT 0,
    created_at           DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_icv_snapshots_created_at DEFAULT SYSDATETIMEOFFSET(),
    created_by           UNIQUEIDENTIFIER NULL CONSTRAINT FK_icv_snapshots_created_by REFERENCES dbo.users(id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_icv_op' AND object_id = OBJECT_ID(N'dbo.icv_snapshots'))
    CREATE INDEX idx_icv_op ON dbo.icv_snapshots(op_code);
GO

/* aicv_results  (reservada) */
IF OBJECT_ID(N'dbo.aicv_results', N'U') IS NULL
CREATE TABLE dbo.aicv_results (
    id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_aicv_results PRIMARY KEY CONSTRAINT DF_aicv_results_id DEFAULT NEWID(),
    icv_id     UNIQUEIDENTIFIER NULL CONSTRAINT FK_aicv_results_icv REFERENCES dbo.icv_snapshots(id) ON DELETE CASCADE,
    indicator  NVARCHAR(MAX) NULL,
    unit       NVARCHAR(MAX) NULL,
    value      DECIMAL(38,10) NULL,
    payload    NVARCHAR(MAX) NOT NULL CONSTRAINT DF_aicv_results_payload DEFAULT N'{}'
);
GO

/* lcc_studies  (reservada) */
IF OBJECT_ID(N'dbo.lcc_studies', N'U') IS NULL
CREATE TABLE dbo.lcc_studies (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_lcc_studies PRIMARY KEY CONSTRAINT DF_lcc_studies_id DEFAULT NEWID(),
    op_code     NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NULL CONSTRAINT FK_lcc_studies_op REFERENCES dbo.production_orders(code),
    scenario    NVARCHAR(MAX) NULL,
    payload     NVARCHAR(MAX) NOT NULL CONSTRAINT DF_lcc_studies_payload DEFAULT N'{}',
    created_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_lcc_studies_created_at DEFAULT SYSDATETIMEOFFSET(),
    created_by  UNIQUEIDENTIFIER NULL CONSTRAINT FK_lcc_studies_created_by REFERENCES dbo.users(id)
);
GO

/* battery_passports  [SINCRONIZADA ← bp] */
IF OBJECT_ID(N'dbo.battery_passports', N'U') IS NULL
CREATE TABLE dbo.battery_passports (
    id            NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_battery_passports PRIMARY KEY,
    op_code       NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NULL CONSTRAINT FK_battery_passports_op REFERENCES dbo.production_orders(code),
    product_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL,
    payload       NVARCHAR(MAX) NOT NULL CONSTRAINT DF_battery_passports_payload DEFAULT N'{}',
    updated_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_battery_passports_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_battery_passports_updated_by REFERENCES dbo.users(id)
);
GO

/* =====================================================================
   Extensões de planejamento e estoque (02_extensoes_planejamento_estoque.sql)
   Reservadas, como no PostgreSQL: o frontend mantém esses dados no estado.
   ===================================================================== */
IF OBJECT_ID(N'dbo.equipment_scales', N'U') IS NULL
CREATE TABLE dbo.equipment_scales (
    equipment_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT FK_equipment_scales_equipment REFERENCES dbo.equipment(code),
    scale           NVARCHAR(40) NOT NULL,
    cell_type       NVARCHAR(40) NOT NULL CONSTRAINT DF_equipment_scales_cell_type DEFAULT N'Geral',
    CONSTRAINT PK_equipment_scales PRIMARY KEY (equipment_code, scale, cell_type),
    CONSTRAINT CK_equipment_scales_scale CHECK (scale IN (N'Piloto', N'Industrial', N'Testes de Caracterização'))
);
GO

IF OBJECT_ID(N'dbo.characterization_bookings', N'U') IS NULL
CREATE TABLE dbo.characterization_bookings (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_characterization_bookings PRIMARY KEY CONSTRAINT DF_characterization_bookings_id DEFAULT NEWID(),
    equipment_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT FK_characterization_bookings_equipment REFERENCES dbo.equipment(code),
    starts_at       DATETIME2(3) NOT NULL,
    ends_at         DATETIME2(3) NOT NULL,
    description     NVARCHAR(MAX) NULL,
    created_at      DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_characterization_bookings_created_at DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_characterization_bookings_interval CHECK (ends_at > starts_at)
);
GO

IF OBJECT_ID(N'dbo.capacity_restrictions', N'U') IS NULL
CREATE TABLE dbo.capacity_restrictions (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_capacity_restrictions PRIMARY KEY CONSTRAINT DF_capacity_restrictions_id DEFAULT NEWID(),
    equipment_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL CONSTRAINT FK_capacity_restrictions_equipment REFERENCES dbo.equipment(code),
    scale           NVARCHAR(40) NOT NULL,
    starts_at       DATETIME2(3) NOT NULL,
    ends_at         DATETIME2(3) NOT NULL,
    reason          NVARCHAR(MAX) NOT NULL,
    source_batch    NVARCHAR(MAX) NULL,
    CONSTRAINT CK_capacity_restrictions_interval CHECK (ends_at > starts_at)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_capacity_scale_time' AND object_id = OBJECT_ID(N'dbo.capacity_restrictions'))
    CREATE INDEX idx_capacity_scale_time ON dbo.capacity_restrictions(scale, starts_at);
GO

IF OBJECT_ID(N'dbo.planning_goals', N'U') IS NULL
CREATE TABLE dbo.planning_goals (
    id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_planning_goals PRIMARY KEY CONSTRAINT DF_planning_goals_id DEFAULT NEWID(),
    scale        NVARCHAR(40) NOT NULL,
    goal_date    DATE NOT NULL,
    description  NVARCHAR(MAX) NOT NULL,
    status       NVARCHAR(30) NOT NULL CONSTRAINT DF_planning_goals_status DEFAULT N'PLANEJADA'
);
GO

IF OBJECT_ID(N'dbo.setup_time_logs', N'U') IS NULL
CREATE TABLE dbo.setup_time_logs (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_setup_time_logs PRIMARY KEY CONSTRAINT DF_setup_time_logs_id DEFAULT NEWID(),
    op_code         NVARCHAR(120) COLLATE Latin1_General_100_BIN2 NULL CONSTRAINT FK_setup_time_logs_op REFERENCES dbo.production_orders(code),
    equipment_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NULL CONSTRAINT FK_setup_time_logs_equipment REFERENCES dbo.equipment(code),
    minutes         DECIMAL(38,10) NOT NULL,
    logged_at       DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_setup_time_logs_logged_at DEFAULT SYSDATETIMEOFFSET(),
    notes           NVARCHAR(MAX) NULL,
    CONSTRAINT CK_setup_time_logs_minutes CHECK (minutes >= 0)
);
GO

IF OBJECT_ID(N'dbo.stock_movements', N'U') IS NULL
CREATE TABLE dbo.stock_movements (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_stock_movements PRIMARY KEY CONSTRAINT DF_stock_movements_id DEFAULT NEWID(),
    material_code  NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL,
    movement_type  NVARCHAR(30)  NOT NULL,
    quantity       DECIMAL(38,10) NOT NULL,
    unit           NVARCHAR(30)  NOT NULL,
    origin_type    NVARCHAR(40)  NOT NULL,
    origin_id      NVARCHAR(400) NOT NULL,
    lot            NVARCHAR(200) NULL,
    created_at     DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_stock_movements_created_at DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_stock_movements_quantity CHECK (quantity > 0)
);
GO
/* UNIQUE(origin_type,origin_id,material_code,movement_type,lot): no PostgreSQL linhas com lot NULL não conflitam;
   o índice filtrado reproduz essa semântica no SQL Server. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_stock_movements_origin' AND object_id = OBJECT_ID(N'dbo.stock_movements'))
    CREATE UNIQUE INDEX UX_stock_movements_origin ON dbo.stock_movements(origin_type, origin_id, material_code, movement_type, lot) WHERE lot IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_stock_material' AND object_id = OBJECT_ID(N'dbo.stock_movements'))
    CREATE INDEX idx_stock_material ON dbo.stock_movements(material_code, created_at);
GO
