/* =====================================================================
   MES LION — SQL Server / Azure SQL Database
   006 — AUTENTICAÇÃO JWT DA API NestJS (token de acesso + refresh token)
   Sessões de login revogáveis e segredos gerados pela aplicação.
   Script idempotente; não altera nenhuma tabela dos scripts 001–005
   (o servidor .NET continua funcionando no mesmo banco).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* Uma linha por login. O refresh token nunca é gravado: só o SHA-256 dele.
   A cada renovação o token muda (rotação); o anterior vale por alguns segundos
   (requisições simultâneas) e, depois disso, a reutilização revoga a sessão. */
IF OBJECT_ID(N'dbo.auth_sessions', N'U') IS NULL
CREATE TABLE dbo.auth_sessions (
    id                     UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_auth_sessions PRIMARY KEY,
    user_id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_auth_sessions_user REFERENCES dbo.users(id) ON DELETE CASCADE,
    refresh_hash           BINARY(32)    NOT NULL,
    previous_refresh_hash  BINARY(32)    NULL,
    provider               NVARCHAR(30)  NOT NULL CONSTRAINT DF_auth_sessions_provider DEFAULT N'LOCAL',   -- LOCAL | ENTRA
    channel                NVARCHAR(20)  NOT NULL CONSTRAINT DF_auth_sessions_channel DEFAULT N'COOKIE',  -- COOKIE (navegador) | TOKEN (Bearer)
    created_at             DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_auth_sessions_created_at DEFAULT SYSDATETIMEOFFSET(),
    rotated_at             DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_auth_sessions_rotated_at DEFAULT SYSDATETIMEOFFSET(),
    last_seen_at           DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_auth_sessions_last_seen_at DEFAULT SYSDATETIMEOFFSET(),
    expires_at             DATETIMEOFFSET(3) NOT NULL,
    revoked_at             DATETIMEOFFSET(3) NULL,
    revoked_reason         NVARCHAR(100) NULL,
    user_agent             NVARCHAR(400) NULL,
    ip_address             NVARCHAR(64)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_auth_sessions_refresh_hash' AND object_id = OBJECT_ID(N'dbo.auth_sessions'))
    CREATE UNIQUE INDEX UX_auth_sessions_refresh_hash ON dbo.auth_sessions(refresh_hash);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_auth_sessions_previous_refresh_hash' AND object_id = OBJECT_ID(N'dbo.auth_sessions'))
    CREATE INDEX IX_auth_sessions_previous_refresh_hash ON dbo.auth_sessions(previous_refresh_hash);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_auth_sessions_user' AND object_id = OBJECT_ID(N'dbo.auth_sessions'))
    CREATE INDEX IX_auth_sessions_user ON dbo.auth_sessions(user_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_auth_sessions_expires_at' AND object_id = OBJECT_ID(N'dbo.auth_sessions'))
    CREATE INDEX IX_auth_sessions_expires_at ON dbo.auth_sessions(expires_at);
GO

/* Segredos gerados pela aplicação na primeira execução (ex.: chave HMAC dos JWT), para que as sessões
   continuem válidas após reinícios e entre instâncias. Em produção a chave pode vir do Azure Key Vault
   (MesLion__Autenticacao__Jwt__Segredo); nesse caso esta tabela não é usada para ela. */
IF OBJECT_ID(N'dbo.app_secrets', N'U') IS NULL
CREATE TABLE dbo.app_secrets (
    name        NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_app_secrets PRIMARY KEY,
    value       NVARCHAR(4000) NOT NULL,
    created_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_app_secrets_created_at DEFAULT SYSDATETIMEOFFSET()
);
GO
