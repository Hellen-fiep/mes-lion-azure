#!/usr/bin/env python3
"""
Teste completo da migração PostgreSQL (MES LION PowerShell) -> MES LION Azure:
 1) cria um banco PostgreSQL com o schema ORIGINAL (database/postgresql_original/schema.sql) e dados como o
    servidor PowerShell os grava (senhas com crypt()/bcrypt do pgcrypto, payload jsonb, uploads em server/uploads);
 2) executa ferramentas/EXPORTAR_DADOS_POSTGRESQL.ps1 (pwsh) — o mesmo script que o usuário roda no Windows;
 3) importa o pacote com "MesLion.Server --importar-migracao" no banco de destino (Portátil ou SQL Server);
 4) sobe o servidor novo e confere: login com as senhas ANTIGAS, estado idêntico, app_storage, histórico e
    documentos com os mesmos IDs e conteúdo byte a byte.

Uso: python teste_migracao.py <pasta_app_publicado> <arquivo_dados.json> [connection_string_sqlserver]
Variáveis: PGHOST, PGPORT, PGUSER, PGPASSWORD (padrão localhost/5432/postgres/postgres)
"""
import os, sys, json, uuid, shutil, subprocess, tempfile, time, base64, socket
import requests

APP = os.path.abspath(sys.argv[1])
DADOS = os.path.abspath(sys.argv[2])
SQLCS = sys.argv[3] if len(sys.argv) > 3 else None
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PG = dict(host=os.environ.get('PGHOST', 'localhost'), port=os.environ.get('PGPORT', '5432'),
          user=os.environ.get('PGUSER', 'postgres'), password=os.environ.get('PGPASSWORD', 'postgres'))
BANCO_PG = 'mes_lion_migracao_teste'
falhas, total = [], 0


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'))
    if not c: falhas.append(f'{nome}: {det}')


def psql(sql, banco=BANCO_PG, arquivo=None):
    env = dict(os.environ, PGPASSWORD=PG['password'], PGCLIENTENCODING='UTF8')
    args = ['psql', '-h', PG['host'], '-p', PG['port'], '-U', PG['user'], '-d', banco, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
    args += ['-f', arquivo] if arquivo else ['-c', sql]
    r = subprocess.run(args, env=env, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr)
    return r.stdout.strip()


def porta_livre():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


print('== 1) PostgreSQL de origem (schema original + dados no formato do servidor PowerShell)')
psql(f'DROP DATABASE IF EXISTS {BANCO_PG};', banco='postgres')
psql(f'CREATE DATABASE {BANCO_PG} ENCODING \'UTF8\';', banco='postgres')
psql(None, arquivo=os.path.join(RAIZ, 'database', 'postgresql_original', 'schema.sql'))
psql(None, arquivo=os.path.join(RAIZ, 'database', 'postgresql_original', '02_extensoes_planejamento_estoque.sql'))

seed = json.load(open(DADOS, encoding='utf-8-sig'))
estado = seed['data'] if seed.get('format') == 'MES_LION_JSON_DATABASE' else seed
kv = {k: str(v) for k, v in (seed.get('appStorage') or {'MES_LION_LEGACY_MIGRATIONS': 'done-v39.5'}).items()}
tmp = tempfile.mkdtemp(prefix='mig_')
senha_operador = 'Operação@2026 ç'
b64 = lambda s: base64.b64encode(s.encode('utf-8')).decode()
carga = os.path.join(tmp, 'carga.sql')
with open(carga, 'w', encoding='utf-8') as f:
    f.write("INSERT INTO users(username,full_name,password_hash,role) VALUES('admin','Administrador MES LION',crypt('meslion2026',gen_salt('bf')),'ADMIN');\n")
    f.write(f"INSERT INTO users(username,full_name,password_hash,role,active) VALUES(convert_from(decode('{b64('operador')}','base64'),'UTF8'),"
            f"convert_from(decode('{b64('Operador de Produção')}','base64'),'UTF8'),crypt(convert_from(decode('{b64(senha_operador)}','base64'),'UTF8'),gen_salt('bf')),'USER',TRUE);\n")
    f.write(f"INSERT INTO app_state(id,payload) VALUES(1,convert_from(decode('{base64.b64encode(json.dumps(estado, ensure_ascii=False).encode()).decode()}','base64'),'UTF8')::jsonb);\n")
    for k, v in kv.items():
        f.write(f"INSERT INTO app_storage(key,value) VALUES(convert_from(decode('{b64(k)}','base64'),'UTF8'),convert_from(decode('{b64(v)}','base64'),'UTF8'));\n")
    f.write("INSERT INTO audit_log(user_id,username,module,action,record_key,details) SELECT id,username,'auth','LOGIN',username,'{}'::jsonb FROM users;\n")
    f.write("INSERT INTO audit_log(user_id,username,module,action,record_key,details) SELECT id,username,'app','SAVE_STATE','MES_LION_DATA','{\"origem\":\"postgresql\"}'::jsonb FROM users WHERE username='admin';\n")
    f.write("INSERT INTO equipment(code,name) VALUES('10','Misturador'),('14','Estufa Aging');\n")
psql(None, arquivo=carga)

pasta_antiga = os.path.join(tmp, 'MES_LION_1_0_PGSQL')
uploads = os.path.join(pasta_antiga, 'server', 'uploads'); os.makedirs(uploads)
docs = []
for i, (eq, nome, ext) in enumerate([('10', 'Instrução de operação.pdf', '.pdf'), ('14', 'Registro de temperatura.xlsx', '.xlsx')]):
    did, stored = str(uuid.uuid4()), str(uuid.uuid4()) + ext
    conteudo = os.urandom(5000 + i) + b'\r\n--fim'
    open(os.path.join(uploads, stored), 'wb').write(conteudo)
    psql(f"INSERT INTO equipment_documents(id,equipment_code,original_name,stored_name,mime_type,file_size,document_type,revision,uploaded_by) "
         f"VALUES('{did}','{eq}',convert_from(decode('{b64(nome)}','base64'),'UTF8'),'{stored}','application/octet-stream',{len(conteudo)},'checklist','A',(SELECT id FROM users WHERE username='admin'));")
    docs.append((did, nome, conteudo))
n_aud = int(psql('SELECT count(*) FROM audit_log;'))
print(f'   origem: {len(estado)} coleções, {len(kv)} chaves, 2 usuários (bcrypt), {n_aud} auditorias, {len(docs)} documentos')

print('== 2) Exportação com ferramentas/EXPORTAR_DADOS_POSTGRESQL.ps1')
pacote = os.path.join(tmp, 'pacote')
env = dict(os.environ, PGPASSWORD=PG['password'])
r = subprocess.run(['pwsh', '-NoProfile', '-File', os.path.join(RAIZ, 'ferramentas', 'EXPORTAR_DADOS_POSTGRESQL.ps1'),
                    '-Servidor', PG['host'], '-Porta', PG['port'], '-Banco', BANCO_PG, '-Usuario', PG['user'],
                    '-PastaMesAntigo', pasta_antiga, '-Saida', pacote], env=env, capture_output=True, text=True)
print('\n'.join('   | ' + l for l in r.stdout.strip().splitlines()[-12:]))
ok(r.returncode == 0, 'script de exportação executado', r.stderr[-500:])
for arq in ['estado.json', 'app_storage.json', 'usuarios.json', 'auditoria.json', 'documentos.json', 'manifesto.json']:
    ok(os.path.exists(os.path.join(pacote, arq)), f'pacote contém {arq}', '')
man = json.load(open(os.path.join(pacote, 'manifesto.json'), encoding='utf-8-sig'))
ok(man['contagens']['usuarios'] == 2 and man['contagens']['documentos'] == 2 and man['arquivosCopiados'] == 2, 'manifesto com contagens corretas', man.get('contagens'))
ok(json.load(open(os.path.join(pacote, 'estado.json'), encoding='utf-8')) == estado, 'estado exportado idêntico ao payload do PostgreSQL', '')

print('== 3) Importação no destino (' + ('SQL Server' if SQLCS else 'Portátil') + ')')
destino = os.path.join(tmp, 'destino'); os.makedirs(destino)
envn = dict(os.environ)
envn['MesLion__Banco__PastaPortatil'] = os.path.join(destino, 'BancoPortatil')
envn['MesLion__Arquivos__PastaLocal'] = os.path.join(destino, 'Arquivos')
envn['MesLion__Seed__ArquivoInicial'] = os.path.join(destino, 'sem_seed.json')
if SQLCS:
    envn['ConnectionStrings__MesLion'] = SQLCS
    envn['MesLion__Banco__Provedor'] = 'SqlServer'
else:
    envn['MesLion__Banco__Provedor'] = 'Portatil'
exe = os.path.join(APP, 'MesLion.Server.exe' if os.name == 'nt' else 'MesLion.Server')
r = subprocess.run([exe, '--importar-migracao', pacote], cwd=APP, env=envn, capture_output=True, text=True)
print('\n'.join('   | ' + l for l in r.stdout.strip().splitlines()[-14:]))
ok(r.returncode == 0, 'importação concluída', (r.stdout + r.stderr)[-800:])
ok(any(n.startswith('relatorio_importacao_') for n in os.listdir(pacote)), 'relatório de importação gravado no pacote', '')

print('== 4) Servidor novo com os dados migrados')
porta = porta_livre()
proc = subprocess.Popen([exe, '--urls', f'http://127.0.0.1:{porta}'], cwd=APP, env=envn, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    r = requests.post(base + '/api/auth/login', json={'username': 'operador', 'password': 'senha errada'})
    ok(r.status_code == 401, 'senha errada continua recusada', r.status_code)
    ok(requests.Session().post(base + '/api/auth/login', json={'username': 'operador', 'password': senha_operador}).status_code == 200,
       'novo login após conversão do hash para PBKDF2', '')
    if not SQLCS:
        us = json.load(open(os.path.join(destino, 'BancoPortatil', 'usuarios.json'), encoding='utf-8'))
        h = next(u['PasswordHash'] for u in us if u['Username'] == 'operador')
        ok(not h.startswith('$2'), 'hash bcrypt convertido para PBKDF2 (ASP.NET Identity V3) no primeiro login', h[:10])
    sa = requests.Session(); sa.post(base + '/api/auth/login', json={'username': 'admin', 'password': 'meslion2026'})
    b = sa.get(base + '/api/bootstrap').json()
    ok(b['data'] == estado, 'estado do MES idêntico ao do PostgreSQL', '')
    ok(b['appStorage'] == kv, 'app_storage idêntico', '')
    nomes = {u['username'] for u in sa.get(base + '/api/users').json()}
    ok({'admin', 'operador'} <= nomes, 'usuários migrados', nomes)
    aud = sa.get(base + '/api/audit').json()
    ok(sum(1 for a in aud if a.get('details') == {'origem': 'postgresql'}) == 1 and len(aud) >= n_aud, 'histórico (audit_log) migrado', len(aud))
    for did, nome, conteudo in docs:
        r = sa.get(base + f'/api/documents/{did}')
        ok(r.status_code == 200 and r.content == conteudo, f'documento "{nome}" com o MESMO ID e conteúdo idêntico', r.status_code)
    eqd = sa.get(base + '/api/equipment/10/documents').json()
    ok(len(eqd) == 1 and eqd[0]['original_name'] == 'Instrução de operação.pdf', 'lista de documentos do equipamento 10', eqd)
    # uma gravação feita por usuário marca o banco como "em uso"
    ok(sa.put(base + '/api/storage/MES_LION_DATA', data=json.dumps(b['data'], ensure_ascii=False, separators=(',', ':')).encode('utf-8')).status_code == 200,
       'gravação do estado pelo usuário no banco migrado', '')
finally:
    proc.terminate(); proc.wait(timeout=20)
try:
    r = subprocess.run([exe, '--importar-migracao', pacote], cwd=APP, env=envn, capture_output=True, text=True)
    ok(r.returncode != 0 and 'sobrescrever' in (r.stdout + r.stderr), 'reimportação sobre banco em uso exige --sobrescrever', (r.returncode, (r.stdout + r.stderr)[-300:]))
    r = subprocess.run([exe, '--importar-migracao', pacote, '--sobrescrever'], cwd=APP, env=envn, capture_output=True, text=True)
    ok(r.returncode == 0 and 'Backup do estado anterior' in r.stdout, 'reimportação com --sobrescrever cria backup antes', (r.stdout + r.stderr)[-300:])
finally:
    psql(f'DROP DATABASE IF EXISTS {BANCO_PG};', banco='postgres')

print(f'\n== {total - len(falhas)}/{total} verificações OK')
if falhas:
    print('FALHAS:'); [print(' - ' + f) for f in falhas]
    sys.exit(1)
