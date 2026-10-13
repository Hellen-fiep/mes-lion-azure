#!/usr/bin/env python3
"""
Teste da importação de um pacote de migração (formato gerado por ferramentas/EXPORTAR_DADOS_POSTGRESQL.ps1)
com o EXECUTÁVEL entregue, sem precisar de PostgreSQL: monta o pacote (estado, app_storage, usuários com hash
bcrypt "$2a$" como o pgcrypto grava, histórico e documentos com arquivo), roda
"MesLion.Server --importar-migracao <pacote>" no modo Portátil e confere no servidor: login com a senha antiga,
estado e app_storage idênticos, histórico e documento com o mesmo ID e conteúdo byte a byte.

Uso: python teste_importacao_pacote.py <pasta_app> <arquivo_dados.json>
Requisitos: pip install requests bcrypt
"""
import os, sys, json, uuid, time, socket, subprocess, tempfile
import requests, bcrypt

APP = os.path.abspath(sys.argv[1])
DADOS = os.path.abspath(sys.argv[2])
EXE = os.path.join(APP, 'MesLion.Server.exe' if os.name == 'nt' else 'MesLion.Server')
falhas, total = [], 0


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'))
    if not c: falhas.append(f'{nome}: {det}')


def porta_livre():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


tmp = tempfile.mkdtemp(prefix='imp_')
pacote = os.path.join(tmp, 'pacote'); os.makedirs(os.path.join(pacote, 'uploads'))
seed = json.load(open(DADOS, encoding='utf-8-sig'))
estado = seed['data'] if seed.get('format') == 'MES_LION_JSON_DATABASE' else seed
kv = {k: str(v) for k, v in (seed.get('appStorage') or {'MES_LION_LEGACY_MIGRATIONS': 'done-v39.5'}).items()}
senha = 'Operação@2026 ç'
id_op, id_doc = str(uuid.uuid4()), str(uuid.uuid4())
pdf = b'%PDF-1.4\n' + os.urandom(4096) + b'\n%%EOF\n'
nome_arq = f'{uuid.uuid4().hex}_instrucao.pdf'
open(os.path.join(pacote, 'uploads', nome_arq), 'wb').write(pdf)
w = lambda n, o: json.dump(o, open(os.path.join(pacote, n), 'w', encoding='utf-8'), ensure_ascii=False)
w('estado.json', estado)
w('app_storage.json', kv)
w('usuarios.json', [
    {'id': str(uuid.uuid4()), 'username': 'admin', 'full_name': 'Administrador MES LION', 'role': 'ADMIN', 'active': True,
     'password_hash': bcrypt.hashpw(b'meslion2026', bcrypt.gensalt(rounds=6, prefix=b'2a')).decode(),
     'created_at': '2026-01-10T08:00:00-03:00', 'updated_at': '2026-01-10T08:00:00-03:00'},
    {'id': id_op, 'username': 'operador', 'full_name': 'Operador de Produção', 'role': 'USER', 'active': True,
     'password_hash': bcrypt.hashpw(senha.encode('utf-8'), bcrypt.gensalt(rounds=6, prefix=b'2a')).decode(),
     'created_at': '2026-02-01T09:30:00-03:00', 'updated_at': '2026-02-01T09:30:00-03:00'}])
w('auditoria.json', [{'user_id': id_op, 'username': 'operador', 'module': 'app', 'action': 'SAVE_STATE', 'record_key': 'MES_LION_DATA',
                      'changed_at': '2026-03-01T10:00:00-03:00', 'details': {'origem': 'postgresql'}}])
w('documentos.json', [{'id': id_doc, 'equipment_code': '10', 'original_name': 'Instrução de operação.pdf', 'stored_name': nome_arq,
                       'mime_type': 'application/pdf', 'file_size': len(pdf), 'document_type': 'Instrução', 'revision': 'R2',
                       'active': True, 'uploaded_at': '2026-03-02T11:00:00-03:00', 'uploaded_by': id_op}])
w('manifesto.json', {'formato': 'MES_LION_PGSQL_EXPORT', 'contagens': {'usuarios': 2, 'documentos': 1}})

env = dict(os.environ)
env['MesLion__Banco__Provedor'] = 'Portatil'
env['MesLion__Banco__PastaPortatil'] = os.path.join(tmp, 'BancoPortatil')
env['MesLion__Arquivos__PastaLocal'] = os.path.join(tmp, 'Arquivos')
env['MesLion__Seed__ArquivoInicial'] = os.path.join(tmp, 'sem_seed.json')

print('== importação com o executável:', EXE)
r = subprocess.run([EXE, '--importar-migracao', pacote], cwd=APP, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
print('\n'.join('   | ' + l for l in r.stdout.strip().splitlines()[-9:]))
ok(r.returncode == 0 and 'Importação concluída' in r.stdout, 'importação concluída', (r.returncode, (r.stdout + r.stderr)[-600:]))

porta = porta_livre(); base = f'http://127.0.0.1:{porta}'
proc = subprocess.Popen([EXE, '--urls', base], cwd=APP, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(120):
        try:
            if requests.get(base + '/healthz', timeout=2).ok: break
        except Exception: pass
        time.sleep(0.5)
    s = requests.Session()
    r = s.post(base + '/api/auth/login', json={'username': 'operador', 'password': senha})
    ok(r.status_code == 200, 'login com a senha antiga (bcrypt do PostgreSQL, com acentos)', r.text[:200])
    ok(requests.post(base + '/api/auth/login', json={'username': 'operador', 'password': 'errada'}).status_code == 401, 'senha errada recusada')
    sa = requests.Session(); sa.post(base + '/api/auth/login', json={'username': 'admin', 'password': 'meslion2026'})
    b = sa.get(base + '/api/bootstrap').json()
    ok(b['data'] == estado, 'estado do MES idêntico ao pacote')
    ok(b['appStorage'] == kv, 'app_storage idêntico ao pacote')
    aud = sa.get(base + '/api/audit').json()
    ok(any(a.get('details') == {'origem': 'postgresql'} for a in aud), 'histórico importado')
    r = sa.get(base + f'/api/documents/{id_doc}')
    ok(r.status_code == 200 and r.content == pdf, 'documento com o mesmo ID e conteúdo idêntico', r.status_code)
finally:
    proc.terminate()
    try: proc.wait(timeout=20)
    except Exception: proc.kill()

print(f'\n== {total - len(falhas)}/{total} verificações OK')
if falhas:
    print('FALHAS:'); [print(' - ' + f) for f in falhas]
    sys.exit(1)
