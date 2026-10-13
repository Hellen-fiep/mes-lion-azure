# Migração dos dados — MES LION 1.0 PGSQL → MES LION 1.0 AZURE

A migração copia **tudo** o que o MES antigo guardava no PostgreSQL, sem alterar o banco antigo
(a exportação é somente leitura):

| Origem (PostgreSQL / pasta do MES antigo) | Destino (SQL Server / Azure SQL / Portátil) |
|---|---|
| `app_state.payload` — estado inteiro do MES (OPs, roteiros, materiais, ACV, passaportes…) | `dbo.app_state` + `dbo.app_state_collection` (uma linha por coleção), conteúdo idêntico |
| `app_storage` — preferências do frontend | `dbo.app_storage` |
| `users` — usuários e senhas (bcrypt do pgcrypto) | `dbo.users` — **mesmas senhas**; convertidas para PBKDF2 no primeiro login |
| `audit_log` — histórico de modificações | `dbo.audit_log` (autores ligados aos usuários migrados) |
| `equipment_documents` + `server\uploads\` | `dbo.equipment_documents` + pasta local ou Azure Blob Storage, **com os mesmos IDs** (as OPs referenciam documentos pelo ID) |

## 1. Migração no PC (assistida)

Pré-requisitos: o PostgreSQL do MES antigo acessível neste PC (o cliente `psql` vem com a instalação do PostgreSQL)
e a senha do usuário `postgres`.

1. Feche o MES antigo e o MES novo.
2. (Opcional) Escolha o banco de destino com **`CONFIGURAR_BANCO.bat`**. Sem configuração, o destino é o
   LocalDB (se existir) ou o modo Portátil.
3. Rode **`MIGRAR_DO_POSTGRESQL.bat`**:
   * informe a **pasta do MES antigo** (onde fica o `INICIAR_MES.bat` da versão PostgreSQL) — de lá são copiados
     os arquivos de `server\uploads`;
   * responda se pode **substituir** dados já gravados no banco novo (**S/N**). Um backup é criado antes;
   * informe a **senha do PostgreSQL** quando pedida (não é gravada).
4. Ao final aparece o relatório, também salvo em `migracao\pacote_postgresql\relatorio_importacao_*.txt`.
5. Inicie com **`INICIAR_MES.bat`** e entre com os usuários e senhas de sempre.

Exemplo de relatório:

```
Usuários: 6 importados, 0 atualizados (senhas preservadas — hash bcrypt do PostgreSQL).
Estado do MES: formato ESTADO, 74 coleções gravadas, 0 removidas, 33.412.118 bytes. Versão 2.
app_storage: 3 chaves.
Histórico de modificações (audit_log): 1.284 registros.
Documentos de equipamentos: 41 importados, 0 já existentes, 0 sem arquivo.
Importação concluída.
```

### Regras de segurança da importação

* Banco novo **vazio** ou só com a base inicial (nunca gravada por um usuário): a importação substitui sem perguntar.
* Banco novo **já usado** (versão > 1 ou gravado por alguém): só substitui com **S** no `.bat`
  (ou `--sobrescrever` na linha de comando). Um **backup** do estado atual é criado antes (Banco ▾ → backups).
* Usuários com o mesmo `username` são atualizados (nome, perfil, senha); os demais são criados com o mesmo ID.
* Documentos já importados (mesmo ID) não são duplicados — a importação pode ser repetida.

## 2. Migração manual (TI / servidores separados)

Quando o PostgreSQL está em outro servidor, ou o destino é o Azure:

```powershell
# 1) No computador com acesso ao PostgreSQL (somente leitura):
powershell -ExecutionPolicy Bypass -File ferramentas\EXPORTAR_DADOS_POSTGRESQL.ps1 `
    -Servidor servidor-pg -Porta 5432 -Banco mes_lion -Usuario postgres `
    -PastaMesAntigo "D:\MES_LION_1.0_PGSQL" -Saida "D:\pacote_mes"

# 2) No computador com o MES novo configurado para o banco de destino (CONFIGURAR_BANCO.bat):
cd app
MesLion.Server.exe --importar-migracao "D:\pacote_mes"            # banco novo vazio
MesLion.Server.exe --importar-migracao "D:\pacote_mes" --sobrescrever  # substitui (com backup antes)
```

O pacote contém `estado.json`, `app_storage.json`, `usuarios.json`, `auditoria.json`, `documentos.json`,
`uploads\` e `manifesto.json` (contagens e SHA-256 para conferência). **Ele contém dados reais e hashes de senha:**
guarde-o em local protegido e apague-o após a migração.

### Destino Azure SQL + Blob Storage

1. Implante a infraestrutura (`docs/AZURE.md`).
2. Num PC liberado no firewall do Azure SQL (parâmetro `ipsLiberadosSql` do Bicep), crie `app\appsettings.Local.json`:

```json
{
  "ConnectionStrings": {
    "MesLion": "Server=tcp:<servidor>.database.windows.net,1433;Database=meslion;Authentication=Active Directory Interactive;Encrypt=True"
  },
  "MesLion": {
    "Banco": { "Provedor": "SqlServer" },
    "Arquivos": {
      "Provedor": "AzureBlob",
      "AzureBlob": { "ConnectionString": "<connection string da conta de armazenamento>", "Container": "meslion" }
    }
  }
}
```

3. Rode `MesLion.Server.exe --importar-migracao "D:\pacote_mes"` — os documentos vão para o Blob Storage e o estado
   para o Azure SQL. Depois, apague o `appsettings.Local.json` (contém a chave da conta).

## 3. Conferência pós-migração

* Banco ▾ / Histórico de Modificações: o histórico antigo aparece com os autores originais.
* Cadastro de Recursos → documentos dos equipamentos: abrir alguns PDFs.
* OPs, roteiros, ACV/LCC e passaportes: comparar 2 ou 3 registros com o MES antigo.
* No SQL Server: `SELECT * FROM rel.vw_colecoes ORDER BY ordem;` mostra cada coleção e o tamanho;
  `manifesto.json` do pacote traz as contagens de origem.
* O MES antigo continua intacto: em caso de dúvida, ele pode ser usado em paralelo até a validação final.

## 4. Problemas comuns

| Mensagem | Solução |
|---|---|
| `psql não encontrado` | rode no computador onde o PostgreSQL do MES antigo está instalado (o `psql` vem com ele) |
| `password authentication failed` | confira a senha do usuário `postgres` (a mesma pedida pelo `INICIAR_MES.bat` antigo) |
| "a execução de scripts foi desabilitada" / política de execução | a TI bloqueou scripts PowerShell por política de grupo; peça a liberação do `ferramentas\EXPORTAR_DADOS_POSTGRESQL.ps1` ou rode a exportação em outro computador com acesso ao PostgreSQL (seção 2) |
| `O banco de destino já possui dados gravados pelo MES` | rode de novo e responda **S** (ou use `--sobrescrever`); um backup é criado antes |
| `AVISO: pasta de uploads não encontrada` | a pasta informada não é a do MES antigo; os dados migram, mas os PDFs dos equipamentos não — rode de novo com a pasta correta |

## 5. Voltar atrás

* Banco ▾ → **Importar banco** aceita o `.json` exportado por **Exportar banco** (formato `MES_LION_JSON_DATABASE`).
* Cada importação cria um backup antes (pasta `Dados\Arquivos\backups` ou container `meslion/backups` no Azure).
* Linha de comando: `MesLion.Server.exe --exportar C:\copia\mes.json` exporta o banco atual.
