// Configuração do Prisma CLI (Prisma 7). A conexão em tempo de execução é feita pelo adaptador
// @prisma/adapter-mssql (src/infra/persistencia/sqlserver/provedor-sqlserver.ts), a partir da mesma
// connection string do servidor .NET (ConnectionStrings__MesLion).
// DATABASE_URL (formato do Prisma: sqlserver://host:1433;database=MesLion;user=...;password={...}) só é
// necessária para comandos de introspecção/comparação, ex.: `prisma db pull --print` ou
// `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
