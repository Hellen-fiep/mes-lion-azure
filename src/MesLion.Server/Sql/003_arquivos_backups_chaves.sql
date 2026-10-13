/* =====================================================================
   MES LION — SQL Server / Azure SQL Database
   003 — ANEXOS, PASSAPORTES PUBLICADOS, BACKUPS E CHAVES DE SESSÃO
   Os arquivos ficam no Azure Blob Storage (ou na pasta local); aqui ficam os metadados.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* Anexos de cadastros (rota /api/attachments — empresas, entradas, qualificação etc.) */
IF OBJECT_ID(N'dbo.attachments', N'U') IS NULL
CREATE TABLE dbo.attachments (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_attachments PRIMARY KEY,
    scope          NVARCHAR(100) NOT NULL,
    record_id      NVARCHAR(200) NOT NULL,
    original_name  NVARCHAR(400) NOT NULL,
    stored_key     NVARCHAR(800) NOT NULL,
    mime_type      NVARCHAR(200) NULL,
    file_size      BIGINT        NOT NULL,
    uploaded_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_attachments_uploaded_at DEFAULT SYSDATETIMEOFFSET(),
    uploaded_by    UNIQUEIDENTIFIER NULL CONSTRAINT FK_attachments_uploaded_by REFERENCES dbo.users(id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_attachments_scope_record' AND object_id = OBJECT_ID(N'dbo.attachments'))
    CREATE INDEX IX_attachments_scope_record ON dbo.attachments(scope, record_id);
GO

/* Dashboards HTML de passaporte publicados para o QR (rota /api/passport-publish) */
IF OBJECT_ID(N'dbo.published_passports', N'U') IS NULL
CREATE TABLE dbo.published_passports (
    id            NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_published_passports PRIMARY KEY,
    stored_key    NVARCHAR(800) NOT NULL,
    size_bytes    BIGINT NOT NULL,
    published_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_published_passports_published_at DEFAULT SYSDATETIMEOFFSET(),
    published_by  UNIQUEIDENTIFIER NULL CONSTRAINT FK_published_passports_published_by REFERENCES dbo.users(id)
);
GO

/* Backups do estado (rota /api/backup; também criados antes de cada importação) */
IF OBJECT_ID(N'dbo.state_backups', N'U') IS NULL
CREATE TABLE dbo.state_backups (
    id             BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_state_backups PRIMARY KEY,
    stored_key     NVARCHAR(800) NOT NULL,
    reason         NVARCHAR(200) NOT NULL,
    size_bytes     BIGINT NOT NULL,
    state_version  BIGINT NOT NULL,
    created_at     DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_state_backups_created_at DEFAULT SYSDATETIMEOFFSET(),
    created_by     UNIQUEIDENTIFIER NULL CONSTRAINT FK_state_backups_created_by REFERENCES dbo.users(id),
    created_by_name NVARCHAR(80) NULL
);
GO

/* Chaves do ASP.NET Core Data Protection (cookies de sessão válidos entre instâncias/reinícios) */
IF OBJECT_ID(N'dbo.data_protection_keys', N'U') IS NULL
CREATE TABLE dbo.data_protection_keys (
    id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_data_protection_keys PRIMARY KEY,
    friendly_name  NVARCHAR(200) NULL,
    xml            NVARCHAR(MAX) NOT NULL,
    created_at     DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_data_protection_keys_created_at DEFAULT SYSDATETIMEOFFSET()
);
GO
