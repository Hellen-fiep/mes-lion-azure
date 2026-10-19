#!/usr/bin/env python3
"""
Teste da importação PostgreSQL -> MES LION 1.0 JSON (versao_json/server/IMPORTAR_POSTGRESQL.ps1):
 1) cria um banco PostgreSQL com o schema ORIGINAL e dados como o servidor PowerShell os grava (senhas com
    crypt()/bcrypt do pgcrypto, payload jsonb, histórico em audit_log, documentos com nomes gravados em Latin-1
    e arquivos em server/uploads do MES antigo);
 2) roda o importador (o mesmo .ps1 que o usuário executa pelo IMPORTAR_DADOS_DO_POSTGRESQL.bat);
 3) sobe o servidor JSON com a pasta Dados importada e confere: login com as senhas ANTIGAS, estado idêntico,
    app_storage, histórico completo, documentos com o mesmo ID e conteúdo byte a byte, cópia dos dados anteriores.

Uso: python teste_migracao_json.py <pasta_frontend_original> <arquivo_dados.json>
Variáveis: PGHOST, PGPORT, PGUSER, PGPASSWORD; MES_POWERSHELL (padrão: powershell no Windows, pwsh nos demais); PGBIN (opcional)
"""
import os, sys, json, uuid, shutil, subprocess, tempfile, time, base64, socket, zipfile, glob
import requests

# nenhum pedido HTTP fica esperando para sempre (servidor travado = falha rápida e clara)
_pedido_original = requests.Session.request
def _pedido_com_prazo(self, method, url, **kw):
    kw.setdefault('timeout', 180)
    return _pedido_original(self, method, url, **kw)
requests.Session.request = _pedido_com_prazo

FRONT = os.path.abspath(sys.argv[1])
DADOS_TESTE = os.path.abspath(sys.argv[2])
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PG = dict(host=os.environ.get('PGHOST', 'localhost'), port=os.environ.get('PGPORT', '5432'),
          user=os.environ.get('PGUSER', 'postgres'), password=os.environ.get('PGPASSWORD', 'postgres'))
SHELL = os.environ.get('MES_POWERSHELL') or ('powershell' if os.name == 'nt' else 'pwsh')
PSQL = os.path.join(os.environ['PGBIN'], 'psql.exe' if os.name == 'nt' else 'psql') if os.environ.get('PGBIN') else 'psql'
BANCO_PG = 'mes_lion_json_teste'
falhas, total = [], 0


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'), flush=True)
    if not c: falhas.append(f'{nome}: {det}')


def psql(sql, banco=BANCO_PG, arquivo=None):
    env = dict(os.environ, PGPASSWORD=PG['password'], PGCLIENTENCODING='UTF8')
    args = [PSQL, '-h', PG['host'], '-p', PG['port'], '-U', PG['user'], '-d', banco, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
    args += ['-f', arquivo] if arquivo else ['-c', sql]
    r = subprocess.run(args, env=env, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0: raise RuntimeError(r.stderr)
    return r.stdout.strip()


def porta_livre():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


b64 = lambda s: base64.b64encode(s.encode('utf-8')).decode()
lit = lambda s: f"convert_from(decode('{b64(s)}','base64'),'UTF8')"

print('== 1) PostgreSQL de origem (schema original + dados no formato do servidor PowerShell)', flush=True)
psql(f'DROP DATABASE IF EXISTS {BANCO_PG};', banco='postgres')
psql(f"CREATE DATABASE {BANCO_PG} ENCODING 'UTF8' TEMPLATE template0;", banco='postgres')
psql(None, arquivo=os.path.join(RAIZ, 'database', 'postgresql_original', 'schema.sql'))
psql(None, arquivo=os.path.join(RAIZ, 'database', 'postgresql_original', '02_extensoes_planejamento_estoque.sql'))

seed = json.load(open(DADOS_TESTE, encoding='utf-8-sig'))
estado = seed['data'] if seed.get('format') == 'MES_LION_JSON_DATABASE' else seed
estado = json.loads(json.dumps(estado))
estado['mes_capacidade_historico'] = [{'Data': '2026-09-01', 'Recurso': '10', 'Alteracao': 'eficiência 85% → 90%', 'Usuario': 'operador'}]
kv = {k: str(v) for k, v in (seed.get('appStorage') or {}).items()}
kv['MES_LION_PREF ç'] = 'valor "com aspas" e acentuação'
tmp = tempfile.mkdtemp(prefix='migjson_')
senha_admin = 'Admin#PG 2026'
senha_operador = 'Operação@2026 ç'
carga = os.path.join(tmp, 'carga.sql')
with open(carga, 'w', encoding='utf-8') as f:
    f.write(f"INSERT INTO users(username,full_name,password_hash,role,created_at) VALUES('admin','Administrador MES LION',crypt({lit(senha_admin)},gen_salt('bf')),'ADMIN',now()-interval '200 days');\n")
    f.write(f"INSERT INTO users(username,full_name,password_hash,role,active,created_at) VALUES('operador',{lit('Operador de Produção')},crypt({lit(senha_operador)},gen_salt('bf')),'USER',TRUE,now()-interval '100 days');\n")
    f.write(f"INSERT INTO users(username,full_name,password_hash,role,active) VALUES('desligado',{lit('Usuário Inativo')},crypt('x',gen_salt('bf')),'USER',FALSE);\n")
    f.write(f"INSERT INTO app_state(id,payload) VALUES(1,{lit(json.dumps(estado, ensure_ascii=False))}::jsonb);\n")
    for k, v in kv.items():
        f.write(f"INSERT INTO app_storage(key,value) VALUES({lit(k)},{lit(v)});\n")
    f.write("INSERT INTO app_storage(key,value) VALUES('MES_CHAVE_NULA',NULL);\n")
    # histórico ao longo de vários meses (o mais antigo primeiro)
    f.write("INSERT INTO audit_log(user_id,username,module,action,record_key,details,changed_at) SELECT id,username,'auth','LOGIN',username,'{}'::jsonb,now()-interval '150 days' FROM users WHERE username='admin';\n")
    for i in range(300):
        f.write(f"INSERT INTO audit_log(user_id,username,module,action,record_key,details,changed_at) SELECT id,username,'app','SAVE_STATE','MES_LION_DATA',"
                f"{lit(json.dumps({'n': i, 'obs': 'gravação ç'}, ensure_ascii=False))}::jsonb,now()-interval '{140 - i * 0.4} days' FROM users WHERE username='operador';\n")
    f.write(f"INSERT INTO audit_log(user_id,username,module,action,record_key,changed_at) SELECT id,username,'usuarios','CREATE','operador',now()-interval '100 days' FROM users WHERE username='admin';\n")
    f.write("INSERT INTO equipment(code,name) VALUES('10','Misturador'),('14','Estufa Aging');\n")
    f.write("INSERT INTO planning_goals(scale,goal_date,description) VALUES('Piloto','2026-12-01','Meta extra que o servidor PowerShell não usava');\n")
psql(None, arquivo=carga)

pasta_antiga = os.path.join(tmp, 'MES_LION_1_0_PGSQL')
uploads = os.path.join(pasta_antiga, 'server', 'uploads'); os.makedirs(uploads)
open(os.path.join(pasta_antiga, 'server', 'MES_LION_SERVER.ps1'), 'w').write('# MES antigo')
docs = []
for i, (eq, nome, ext) in enumerate([('10', 'Instrução de operação.pdf', '.pdf'), ('14', 'Registro de temperatura.xlsx', '.xlsx'), ('14', 'Sem arquivo.pdf', '.pdf')]):
    did, stored = str(uuid.uuid4()), str(uuid.uuid4()) + ext
    conteudo = os.urandom(5000 + i) + b'\r\n--fim'
    if i < 2:
        open(os.path.join(uploads, stored), 'wb').write(conteudo)
    # o servidor PowerShell lia o multipart em Latin-1: nomes com acento ficavam assim no banco
    nome_banco = nome.encode('utf-8').decode('latin-1')
    psql(f"INSERT INTO equipment_documents(id,equipment_code,original_name,stored_name,mime_type,file_size,document_type,revision,uploaded_by,uploaded_at) "
         f"VALUES('{did}','{eq}',{lit(nome_banco)},'{stored}','application/octet-stream',{len(conteudo)},{lit('instrução'.encode('utf-8').decode('latin-1'))},'A',"
         f"(SELECT id FROM users WHERE username='admin'),now()-interval '{10 - i} days');")
    docs.append((did, eq, nome, conteudo, i < 2))
n_aud = int(psql('SELECT count(*) FROM audit_log;'))
print(f'   origem: {len(estado)} coleções, {len(kv) + 1} chaves, 3 usuários (bcrypt), {n_aud} registros de histórico, {len(docs)} documentos', flush=True)

print('== 2) Pacote da versão JSON (com dados anteriores, que devem ser guardados antes da importação)', flush=True)
pacote = os.path.join(tmp, 'MES_LION_1_0_JSON')
shutil.copytree(FRONT, pacote, ignore=shutil.ignore_patterns('Dados', 'server'))
os.makedirs(os.path.join(pacote, 'server'))
for arq in glob.glob(os.path.join(RAIZ, 'versao_json', 'server', '*.ps1')) + glob.glob(os.path.join(RAIZ, 'versao_json', 'server', '*.js')):
    shutil.copy(arq, os.path.join(pacote, 'server'))   # scripts + adaptador do frontend (o servidor não abre sem ele)
dados = os.path.join(pacote, 'Dados'); os.makedirs(dados)
anterior = json.dumps({'materiais': [{'Código': 'ANTERIOR'}]}).encode()
open(os.path.join(dados, 'MES_LION_DATA.json'), 'wb').write(anterior)
open(os.path.join(dados, 'usuarios.json'), 'w').write('[]')

print('== 3) Importação (IMPORTAR_POSTGRESQL.ps1)', flush=True)
env = dict(os.environ, PGPASSWORD=PG['password'])
t0 = time.time()
r = subprocess.run([SHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(pacote, 'server', 'IMPORTAR_POSTGRESQL.ps1'),
                    '-Servidor', PG['host'], '-Porta', PG['port'], '-Banco', BANCO_PG, '-Usuario', PG['user'],
                    '-PastaMesAntigo', pasta_antiga, '-SemConfirmacao'], env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
print('\n'.join('   | ' + l for l in r.stdout.strip().splitlines()[-24:]), flush=True)
ok(r.returncode == 0, f'importador executado ({time.time() - t0:.1f}s)', (r.stdout + r.stderr)[-1500:])
ok(json.load(open(os.path.join(dados, 'MES_LION_DATA.json'), encoding='utf-8')) == estado, 'Dados\\MES_LION_DATA.json = payload do PostgreSQL', '')
bks = glob.glob(os.path.join(dados, 'backups', 'ARQUIVOS_ANTES_DA_IMPORTACAO_POSTGRESQL_*.zip'))
ok(len(bks) == 1 and zipfile.ZipFile(bks[0]).read('MES_LION_DATA.json') == anterior, 'dados anteriores guardados em Dados\\backups antes de substituir', bks)
linhas = [l for l in open(os.path.join(dados, 'auditoria.jsonl'), encoding='utf-8').read().splitlines() if l.strip()]
ok(len(linhas) == n_aud + 1 and json.loads(linhas[-1])['action'] == 'IMPORT_POSTGRESQL', 'histórico completo + registro da importação', len(linhas))
man = json.load(open(glob.glob(os.path.join(dados, 'importacao_postgresql', 'importacao_*.json'))[0], encoding='utf-8-sig'))
ok(man['contagens']['historico'] == n_aud and man['contagens']['usuarios'] == 3 and man['arquivosDocumentosCopiados'] == 2 and len(man['arquivosDocumentosNaoEncontrados']) == 1,
   'manifesto da importação (contagens, arquivos não encontrados)', man.get('contagens'))
ok(os.path.exists(os.path.join(dados, 'importacao_postgresql')) and glob.glob(os.path.join(dados, 'importacao_postgresql', 'tabelas_extras_*', 'planning_goals.json')),
   'tabelas extras com linhas guardadas (planning_goals)', '')
ok(not glob.glob(os.path.join(dados, 'importacao_postgresql_tmp_*')), 'pasta temporária removida', '')

print('== 4) Servidor JSON com os dados importados', flush=True)
porta = porta_livre()
log = open(os.path.join(tmp, 'servidor.log'), 'w')
proc = subprocess.Popen([SHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(pacote, 'server', 'MES_LION_SERVER_JSON.ps1'),
                         '-Port', str(porta), '-NaoAbrirNavegador'], stdout=log, stderr=subprocess.STDOUT)
base = f'http://127.0.0.1:{porta}'
try:
    for _ in range(120):
        try:
            if requests.get(base + '/healthz', timeout=2).ok: break
        except Exception: pass
        time.sleep(0.5)
    s = requests.Session()
    r = s.post(base + '/api/auth/login', json={'username': 'operador', 'password': senha_operador})
    ok(r.status_code == 200 and r.json()['user']['fullName'] == 'Operador de Produção', 'login com a senha ANTIGA (bcrypt do PostgreSQL, com acentos)', r.text)
    ok(requests.post(base + '/api/auth/login', json={'username': 'operador', 'password': 'senha errada'}).status_code == 401, 'senha errada continua recusada', '')
    ok(requests.post(base + '/api/auth/login', json={'username': 'desligado', 'password': 'x'}).status_code == 401, 'usuário inativo continua sem acesso', '')
    sa = requests.Session()
    ok(sa.post(base + '/api/auth/login', json={'username': 'admin', 'password': senha_admin}).status_code == 200, 'admin entra com a senha do PostgreSQL (não a padrão)', '')
    ok(requests.post(base + '/api/auth/login', json={'username': 'admin', 'password': 'meslion2026'}).status_code == 401, 'senha padrão não vale para o admin migrado', '')
    us = json.load(open(os.path.join(dados, 'usuarios.json'), encoding='utf-8-sig'))
    h = next(u['password_hash'] for u in us if u['username'] == 'operador')
    ok(not h.startswith('$2'), 'hash bcrypt convertido para PBKDF2 no primeiro login', h[:10])
    b = s.get(base + '/api/bootstrap').json()
    ok(b['data'] == estado, 'estado idêntico ao do PostgreSQL (incluindo o histórico de capacidade)', '')
    ok(all(b['appStorage'].get(k) == v for k, v in kv.items()) and b['appStorage'].get('MES_CHAVE_NULA') == '', 'app_storage migrado (valor nulo vira texto vazio)', b['appStorage'])
    aud = s.get(base + '/api/audit').json()
    ok(len(aud) == min(500, n_aud + 3) and aud[0]['action'] == 'LOGIN', 'Histórico de Modificações (até 500, mais recentes primeiro)', (len(aud), aud[:2]))
    ok(any(a['action'] == 'IMPORT_POSTGRESQL' for a in aud) and any(a['action'] == 'SAVE_STATE' and a['details'].get('obs') == 'gravação ç' for a in aud),
       'histórico do PostgreSQL visível no MES JSON (detalhes preservados)', '')
    from datetime import datetime
    datas = [datetime.fromisoformat(a['changed_at']) for a in aud]
    ok(all(datas[i] >= datas[i + 1] for i in range(len(datas) - 1)), 'histórico em ordem cronológica', [a['changed_at'] for a in aud[:4]])
    lista = s.get(base + '/api/equipment/10/documents').json()
    ok(len(lista) == 1 and lista[0]['id'] == docs[0][0] and lista[0]['original_name'] == 'Instrução de operação.pdf' and lista[0]['document_type'] == 'instrução',
       'documento com o mesmo ID e acentos corrigidos', lista)
    for did, eq, nome, conteudo, tem in docs:
        rr = s.get(base + f'/api/documents/{did}')
        if tem:
            ok(rr.status_code == 200 and rr.content == conteudo, f'arquivo do documento "{nome}" idêntico byte a byte', rr.status_code)
        else:
            ok(rr.status_code == 404, f'documento sem arquivo no MES antigo -> 404 ("{nome}")', rr.status_code)
    ok(s.put(base + '/api/storage/MES_LION_DATA', data=json.dumps(estado, ensure_ascii=False).encode('utf-8')).status_code == 200, 'gravação após a migração', '')
finally:
    proc.terminate()
    try: proc.wait(10)
    except Exception: proc.kill()
    log.close()
    if falhas:
        print(open(os.path.join(tmp, 'servidor.log'), encoding='utf-8', errors='replace').read()[-3000:])

print()
print(f'== {total - len(falhas)}/{total} verificações OK')
if falhas:
    print('FALHAS:'); [print(' - ' + f) for f in falhas]
    sys.exit(1)
