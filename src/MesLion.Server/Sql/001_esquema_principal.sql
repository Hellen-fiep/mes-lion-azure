/* =====================================================================
   MES LION — SQL Server / Azure SQL Database
   001 — ESQUEMA PRINCIPAL (equivalente ao database/schema.sql do PostgreSQL)
   Script idempotente: pode ser executado várias vezes sem apagar dados.
   Requisitos: SQL Server 2017+ / Azure SQL / LocalDB 2017+ (nível de compatibilidade >= 130).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF SCHEMA_ID(N'rel') IS NULL EXEC(N'CREATE SCHEMA rel AUTHORIZATION dbo;');
GO

/* Controle de versão dos scripts aplicados pela aplicação */
IF OBJECT_ID(N'dbo.schema_version', N'U') IS NULL
CREATE TABLE dbo.schema_version (
    script      NVARCHAR(200) NOT NULL CONSTRAINT PK_schema_version PRIMARY KEY,
    checksum    CHAR(64)      NOT NULL,
    applied_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_schema_version_applied_at DEFAULT SYSDATETIMEOFFSET()
);
GO

/* ---------------------------------------------------------------------
   users  (PostgreSQL: users)
   Senhas: PBKDF2 (formato ASP.NET Core Identity V3) ou bcrypt herdado do pgcrypto.
   username é sensível a maiúsculas/minúsculas, como no PostgreSQL.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
CREATE TABLE dbo.users (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_users PRIMARY KEY CONSTRAINT DF_users_id DEFAULT NEWID(),
    username       NVARCHAR(80) COLLATE Latin1_General_100_CS_AS NOT NULL CONSTRAINT UQ_users_username UNIQUE,
    full_name      NVARCHAR(180) NOT NULL,
    password_hash  NVARCHAR(400) NOT NULL,
    role           NVARCHAR(30)  NOT NULL CONSTRAINT DF_users_role DEFAULT N'USER',
    active         BIT           NOT NULL CONSTRAINT DF_users_active DEFAULT 1,
    auth_provider  NVARCHAR(30)  NOT NULL CONSTRAINT DF_users_auth_provider DEFAULT N'LOCAL',
    external_id    NVARCHAR(200) NULL,
    created_at     DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSDATETIMEOFFSET(),
    updated_at     DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_users_updated_at DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_users_external_id' AND object_id = OBJECT_ID(N'dbo.users'))
    CREATE INDEX IX_users_external_id ON dbo.users(external_id);
GO

/* ---------------------------------------------------------------------
   app_state  (PostgreSQL: app_state, linha única id=1)
   No PostgreSQL o estado inteiro ficava em payload jsonb. Aqui o cabeçalho
   guarda versão/autor e o conteúdo fica em app_state_collection (uma linha
   por coleção), o que permite gravar só o que mudou e consultar em SQL.
   O payload completo continua disponível na view dbo.vw_app_state_payload.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.app_state', N'U') IS NULL
CREATE TABLE dbo.app_state (
    id          SMALLINT NOT NULL CONSTRAINT PK_app_state PRIMARY KEY CONSTRAINT DF_app_state_id DEFAULT 1,
    version     BIGINT   NOT NULL CONSTRAINT DF_app_state_version DEFAULT 0,
    updated_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_app_state_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by  UNIQUEIDENTIFIER NULL CONSTRAINT FK_app_state_updated_by REFERENCES dbo.users(id),
    CONSTRAINT CK_app_state_id CHECK (id = 1)
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.app_state WHERE id = 1)
    INSERT INTO dbo.app_state (id, version) VALUES (1, 0);
GO

IF OBJECT_ID(N'dbo.app_state_collection', N'U') IS NULL
CREATE TABLE dbo.app_state_collection (
    name          NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_app_state_collection PRIMARY KEY,
    ordinal       INT            NOT NULL,
    content       NVARCHAR(MAX)  NOT NULL,   -- JSON exatamente como enviado pelo frontend
    content_hash  BINARY(32)     NOT NULL,   -- SHA-256 do conteúdo (UTF-8)
    item_count    INT            NULL,
    size_bytes    BIGINT         NOT NULL,
    updated_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_app_state_collection_updated_at DEFAULT SYSDATETIMEOFFSET(),
    updated_by    UNIQUEIDENTIFIER NULL
);
GO

/* ---------------------------------------------------------------------
   app_storage  (PostgreSQL: app_storage) — chaves do localStorage do frontend
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.app_storage', N'U') IS NULL
CREATE TABLE dbo.app_storage (
    [key]       NVARCHAR(400) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_app_storage PRIMARY KEY,
    [value]     NVARCHAR(MAX) NULL,
    updated_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_app_storage_updated_at DEFAULT SYSDATETIMEOFFSET()
);
GO

/* ---------------------------------------------------------------------
   audit_log  (PostgreSQL: audit_log)
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.audit_log', N'U') IS NULL
CREATE TABLE dbo.audit_log (
    id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_audit_log PRIMARY KEY,
    user_id     UNIQUEIDENTIFIER NULL CONSTRAINT FK_audit_log_user REFERENCES dbo.users(id),
    username    NVARCHAR(80)   NULL,
    module      NVARCHAR(80)   NULL,
    action      NVARCHAR(40)   NULL,
    record_key  NVARCHAR(1000) NULL,
    changed_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audit_log_changed_at DEFAULT SYSDATETIMEOFFSET(),
    details     NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_audit_log_details DEFAULT N'{}'
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_audit_changed_at' AND object_id = OBJECT_ID(N'dbo.audit_log'))
    CREATE INDEX IX_audit_changed_at ON dbo.audit_log(changed_at DESC);
GO

/* Payload completo (mesmo conteúdo do antigo app_state.payload), reconstruído das coleções */
CREATE OR ALTER VIEW dbo.vw_app_state_payload
AS
SELECT
    s.id,
    s.version,
    s.updated_at,
    s.updated_by,
    CAST(N'{' AS NVARCHAR(MAX))
      + ISNULL((SELECT STRING_AGG(CAST(N'"' + STRING_ESCAPE(c.name, 'json') + N'":' AS NVARCHAR(MAX)) + c.content, N',')
                       WITHIN GROUP (ORDER BY c.ordinal, c.name)
                FROM dbo.app_state_collection c), N'')
      + N'}' AS payload
FROM dbo.app_state s;
GO
