/* =====================================================================
   MES LION — permissões da identidade gerenciada do App Service no Azure SQL
   Executar UMA vez, conectado ao banco "meslion" como administrador Microsoft Entra ID
   (Portal do Azure > Banco SQL > Editor de consultas, SSMS ou sqlcmd).
   Substitua NOME_DO_APP pelo nome do App Service (saída "nomeAplicacao" do Bicep).
   ===================================================================== */
CREATE USER [NOME_DO_APP] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [NOME_DO_APP];
ALTER ROLE db_datawriter ADD MEMBER [NOME_DO_APP];
-- db_ddladmin: permite que o MES crie/atualize o esquema e gere as views relacionais (rel.*).
-- Se a TI preferir aplicar os scripts manualmente (database/sqlserver), remova esta linha e configure
-- MesLion__Banco__AplicarScriptsAutomaticamente=false e MesLion__Relacional__GerarViewsDinamicas=false.
ALTER ROLE db_ddladmin ADD MEMBER [NOME_DO_APP];
GRANT EXECUTE TO [NOME_DO_APP];

/* Opcional: leitura para Power BI / relatórios (usuário ou grupo do Entra ID) */
-- CREATE USER [Grupo-PowerBI-MES] FROM EXTERNAL PROVIDER;
-- ALTER ROLE db_datareader ADD MEMBER [Grupo-PowerBI-MES];
-- GRANT SELECT ON SCHEMA::rel TO [Grupo-PowerBI-MES];
