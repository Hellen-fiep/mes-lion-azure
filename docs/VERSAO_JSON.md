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
server/MES_LION_SERVER_JSON.ps1       servidor HTTP (TcpListener + Socket.Select), rotas, senhas, backups, adaptador do frontend
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

Diferenças em relação ao servidor PowerShell original (todas corrigem problemas do original):

* `Dados/`, `server/` e arquivos que não são do frontend **não são servidos** (o original entregava qualquer arquivo
  da pasta, inclusive o banco inicial).
* Upload de documentos sem perder bytes do fim do arquivo e com nome em UTF-8 (o original fazia `TrimEnd` de `\r\n-`
  e lia o nome em Latin-1; o importador corrige os nomes antigos).
* Conexões abertas antecipadamente pelo navegador (pré-conexão) não travam o servidor (`Socket.Select`).
* Estado inválido/incompleto é recusado com 400 sem alterar o arquivo; `DELETE /api/storage/MES_LION_DATA` nunca apaga
  o estado; não permite ficar sem administrador ativo.

O adaptador do frontend (correção de ACV/LCC e textos de plataforma) fica **dentro do servidor** e é incluído no
`index.html` ao entregar a página — os arquivos do frontend continuam idênticos aos originais.

## Testes (CI: job `versao-json`, Windows PowerShell 5.1 real)

| Suíte | O que confere |
|---|---|
| `tests/testes_api_json.py` | contrato HTTP completo, arquivos privados, estado grande (44 MB), gravações concorrentes, bcrypt do PostgreSQL, PBKDF2 do MES AZURE, histórico com linha cortada |
| `tests/e2e_fluxos.py` | navegador real: login, cadastro com anexo, documentos, ACV/LCC, apontamento, usuários, backup, exportação, histórico, restaurar dados iniciais |
| `tests/primeira_tela.py` | todas as opções do menu como primeira tela (e após F5) sem erro JavaScript |
| `tests/teste_migracao_json.py` | PostgreSQL real (schema original) → `IMPORTAR_POSTGRESQL.ps1` → servidor JSON: senhas antigas, estado idêntico, histórico completo, documentos byte a byte |
| `tests/teste_gerar_pacote_json.py` | `.zip` para outros usuários com dados, sem backups/logs |
| `tests/teste_redefinir_senha_json.py` | `REDEFINIR_SENHA.bat`: nova senha PBKDF2, reativação, senhas que não conferem |

Montar o pacote localmente:

```bash
python versao_json/montar_pacote.py --frontend <pasta com index.html, style.css, js/, assets/ originais> \
    --saida out/MES_LION_1_0_JSON --dados <MES_LION_DATA.json> --desembrulhar --zip out/MES_LION_1_0_JSON.zip
```
