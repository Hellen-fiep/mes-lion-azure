#!/usr/bin/env python3
"""
Testes de contrato do MES LION 1.0 JSON (servidor PowerShell sem PostgreSQL: versao_json/server/MES_LION_SERVER_JSON.ps1).
Mesmo contrato HTTP do servidor PowerShell original (MES_LION_SERVER.ps1), mais as rotas que o frontend já chamava e o
original não tinha (backup, exportar, importar, anexos, passaporte).

Uso: python testes_api_json.py <url_base> <arquivo_dados_iniciais.json> <pasta_Dados>
Requisitos: pip install requests bcrypt
"""
import sys, os, json, gzip, base64, time, uuid, threading, copy, hashlib, socket, zipfile, glob
import requests

# nenhum pedido HTTP fica esperando para sempre (servidor travado = falha rápida e clara)
_pedido_original = requests.Session.request
def _pedido_com_prazo(self, method, url, **kw):
    kw.setdefault('timeout', 180)
    return _pedido_original(self, method, url, **kw)
requests.Session.request = _pedido_com_prazo

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:8765'
SEED = sys.argv[2] if len(sys.argv) > 2 else None
DADOS = sys.argv[3] if len(sys.argv) > 3 else None
ADMIN = ('admin', 'meslion2026')
falhas, total = [], 0


def ok(cond, nome, detalhe=''):
    global total
    total += 1
    print(('  [OK]   ' if cond else '  [FALHA] ') + nome + ('' if cond else f' -> {detalhe}'), flush=True)
    if not cond:
        falhas.append(f'{nome}: {detalhe}')


def sessao(usuario=ADMIN):
    s = requests.Session()
    r = s.post(BASE + '/api/auth/login', json={'username': usuario[0], 'password': usuario[1]})
    assert r.status_code == 200, f'login {usuario[0]} falhou: {r.status_code} {r.text}'
    return s


def compacto(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def ultima_auditoria(s, acao=None):
    for a in s.get(BASE + '/api/audit').json():
        if acao is None or a['action'] == acao:
            return a
    return None


def ler_usuarios():
    return json.load(open(os.path.join(DADOS, 'usuarios.json'), encoding='utf-8-sig'))


def gravar_usuarios(lista):
    with open(os.path.join(DADOS, 'usuarios.json'), 'w', encoding='utf-8') as f:
        json.dump(lista, f, ensure_ascii=False, indent=2)


def pbkdf2_v3(senha, iteracoes=10000, prf=2):
    alg = {0: 'sha1', 1: 'sha256', 2: 'sha512'}[prf]
    sal = os.urandom(16)
    sub = hashlib.pbkdf2_hmac(alg, senha.encode('utf-8'), sal, iteracoes, 32)
    return base64.b64encode(bytes([1]) + prf.to_bytes(4, 'big') + iteracoes.to_bytes(4, 'big') + (16).to_bytes(4, 'big') + sal + sub).decode()


def verificar_pbkdf2_v3(senha, h):
    d = base64.b64decode(h)
    prf, it, ts = int.from_bytes(d[1:5], 'big'), int.from_bytes(d[5:9], 'big'), int.from_bytes(d[9:13], 'big')
    alg = {0: 'sha1', 1: 'sha256', 2: 'sha512'}[prf]
    sal, esp = d[13:13 + ts], d[13 + ts:]
    return d[0] == 1 and hashlib.pbkdf2_hmac(alg, senha.encode('utf-8'), sal, it, len(esp)) == esp


print(f'== MES LION 1.0 JSON — testes de API em {BASE}', flush=True)

# ---------------------------------------------------------------- sem sessão / arquivos públicos
anon = requests.Session()
for metodo, rota in [('GET', '/api/bootstrap'), ('GET', '/api/storage'), ('GET', '/api/users'), ('GET', '/api/audit'),
                     ('PUT', '/api/storage/MES_LION_DATA'), ('GET', '/api/info'), ('POST', '/api/backup'), ('GET', '/api/export'),
                     ('POST', '/api/import'), ('GET', '/api/rota-inexistente')]:
    r = anon.request(metodo, BASE + rota, data=b'{}')
    ok(r.status_code == 401 and r.json().get('error') == 'Não autenticado', f'sem sessão {metodo} {rota} -> 401', f'{r.status_code} {r.text[:80]}')
r = anon.get(BASE + '/api/auth/me'); ok(r.status_code == 401, '/api/auth/me sem sessão -> 401', r.status_code)
r = anon.get(BASE + '/')
ok(r.status_code == 200 and 'mes-adaptador-json' in r.text and 'mesGarantirColecoes' in r.text and '<title>MES LION 1.0 JSON</title>' in r.text
   and r.text.index('mes-adaptador-json') > r.text.index('mes_capacidade_carga_v1.js'), 'index.html com o adaptador incluído depois de todos os scripts', r.status_code)
ok('mes_plataforma_azure.js' not in r.text, 'index.html sem o adaptador do Azure', '')
r = anon.get(BASE + '/js/app.js?v=1.0.21'); ok(r.status_code == 200 and r.headers.get('content-type', '').startswith('application/javascript'), 'js/app.js servido (application/javascript)', r.headers.get('content-type'))
r = anon.get(BASE + '/assets/logo-mes.jpg'); ok(r.status_code == 200 and r.headers.get('content-type') == 'image/jpeg', 'imagem servida', r.status_code)
r = anon.get(BASE + '/arquivo-inexistente.txt'); ok(r.status_code == 404 and r.text == 'Não encontrado', 'arquivo inexistente -> 404 "Não encontrado"', f'{r.status_code} {r.text}')
for rota in ['/Dados/MES_LION_DATA.json', '/Dados/usuarios.json', '/dados/usuarios.json', '/Dados./usuarios.json', '/Dados%20/usuarios.json',
             '/server/MES_LION_SERVER_JSON.ps1', '/js/../Dados/usuarios.json', '/%2e%2e/etc/passwd', '/INICIAR_MES.bat', '/Dados/auditoria.jsonl']:
    r = anon.get(BASE + rota)
    ok(r.status_code == 404, f'arquivo privado bloqueado: {rota}', r.status_code)
r = anon.get(BASE + '/healthz'); ok(r.status_code == 200 and r.json()['status'] == 'ok' and r.json()['banco'] == 'JSON', '/healthz', r.text)

# Conexão aberta sem pedido (pré-conexão do navegador) não pode travar o servidor
ociosa = socket.create_connection(('127.0.0.1', int(BASE.rsplit(':', 1)[1].split('/')[0])))
t0 = time.time(); r = anon.get(BASE + '/healthz'); dt = time.time() - t0
ok(r.status_code == 200 and dt < 3, f'conexão ociosa não bloqueia os demais pedidos ({dt:.2f}s)', dt)
ociosa.close()

# ---------------------------------------------------------------- login
r = anon.post(BASE + '/api/auth/login', json={'username': 'admin', 'password': 'senha-errada'})
ok(r.status_code == 401 and r.json()['error'] == 'Usuário ou senha inválidos', 'login com senha errada -> 401', r.text)
r = anon.post(BASE + '/api/auth/login', json={'username': 'ADMIN', 'password': ADMIN[1]})
ok(r.status_code == 401, 'username diferencia maiúsculas (como no PostgreSQL)', r.status_code)
r = anon.post(BASE + '/api/auth/login', data=b'nao-e-json')
ok(r.status_code == 400, 'login com corpo inválido -> 400', r.status_code)
s = requests.Session()
t0 = time.time()
r = s.post(BASE + '/api/auth/login', json={'username': ADMIN[0], 'password': ADMIN[1]})
ok(r.status_code == 200 and r.json()['user']['username'] == 'admin' and r.json()['user']['role'] == 'ADMIN', f'login admin ({time.time() - t0:.2f}s)', r.text)
ck = r.headers.get('set-cookie', '')
ok('MESSESSION=' in ck and 'httponly' in ck.lower() and 'samesite=lax' in ck.lower() and 'path=/' in ck.lower(), 'cookie MESSESSION HttpOnly/SameSite=Lax/Path=/', ck[:150])
ok(set(r.json()['user'].keys()) == {'id', 'username', 'fullName', 'role'}, 'formato do usuário {id,username,fullName,role}', r.json()['user'])
r = s.get(BASE + '/api/auth/me'); ok(r.status_code == 200 and r.json()['user']['username'] == 'admin', '/api/auth/me', r.text)

# ---------------------------------------------------------------- bootstrap
r = s.get(BASE + '/api/bootstrap')
b = r.json()
ok(r.status_code == 200 and list(b.keys()) == ['data', 'appStorage', 'user'], 'bootstrap {data, appStorage, user}', list(b.keys()))
ok(isinstance(b['appStorage'], dict) and all(isinstance(v, str) for v in b['appStorage'].values()), 'appStorage é objeto de strings', type(b['appStorage']))
estado = b['data']
if SEED:
    seed = json.load(open(SEED, encoding='utf-8-sig'))
    seed_data = seed['data'] if seed.get('format') == 'MES_LION_JSON_DATABASE' else seed
    ok(estado == seed_data, 'estado inicial = dados do arquivo inicial (envelope MES_LION_JSON_DATABASE desembrulhado)', 'diferente')
    ok(list(estado.keys()) == list(seed_data.keys()), 'ordem das coleções preservada', list(estado.keys())[:5])
    if seed.get('appStorage'):
        ok(all(b['appStorage'].get(k) == str(v) for k, v in seed['appStorage'].items()), 'appStorage inicial carregado do envelope', b['appStorage'])
ok(isinstance(estado, dict) and len(estado) > 0, 'estado com coleções', len(estado or {}))
if DADOS:
    ok(len(glob.glob(os.path.join(DADOS, 'backups', 'MES_LION_DATA_original_*.json'))) == 1, 'arquivo original (envelope) guardado em Dados\\backups', '')

# ---------------------------------------------------------------- gravação do estado
corpo0 = compacto(estado)
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo0, headers={'Content-Type': 'text/plain; charset=utf-8'})
ok(r.status_code == 200 and r.text == 'OK', 'PUT estado -> "OK"', f'{r.status_code} {r.text}')
a = ultima_auditoria(s, 'SAVE_STATE')
ok(a and a['module'] == 'app' and a['record_key'] == 'MES_LION_DATA' and a['username'] == 'admin' and a['details'].get('bytes') == len(corpo0), 'auditoria SAVE_STATE', a)
if DADOS:
    ok(len(glob.glob(os.path.join(DADOS, 'backups', 'MES_LION_BACKUP_*_automatico_diario.zip'))) == 1, 'backup automático do dia criado na primeira gravação', os.listdir(os.path.join(DADOS, 'backups')))
    ok(open(os.path.join(DADOS, 'MES_LION_DATA.json'), 'rb').read() == corpo0, 'arquivo MES_LION_DATA.json = bytes enviados pelo navegador', '')

alterado = copy.deepcopy(estado)
col = next(k for k, v in alterado.items() if isinstance(v, list) and v and isinstance(v[0], dict))
alterado[col][0]['__teste_api'] = 'valor com acentuação ção ã é 🙂 "aspas" \\ barra   <tag> & \'apostrofo\''
alterado['__colecao_teste'] = [{'x': 1, 'y': None, 'z': [1, {'w': 'k'}], 'n': 1.5e-7, 'grande': 12345678901234567890, 'dec': 1.10}]
corpo1 = compacto(alterado)
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo1)
ok(r.status_code == 200, 'PUT estado alterado', r.status_code)
rb = s.get(BASE + '/api/bootstrap')
ok(rb.content.startswith(b'{"data":' + corpo1 + b',"appStorage":'), 'bootstrap devolve o estado byte a byte como foi gravado', rb.content[:60])
b2 = rb.json()['data']
ok(b2 == alterado and list(b2.keys()) == list(alterado.keys()), 'estado gravado íntegro (unicode, números, nulos, aninhados, ordem)', 'diferente')
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo0)
ok(s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'estado volta ao original', '')

for invalido, nome in [(b'{"materiais": [1,2', 'JSON incompleto'), (b'[1,2,3]', 'raiz não-objeto'), (b'', 'corpo vazio'), (b'   ', 'só espaços')]:
    r = s.put(BASE + '/api/storage/MES_LION_DATA', data=invalido)
    ok(r.status_code == 400 and 'inválido' in r.json()['error'], f'{nome} -> 400 sem alterar o banco', r.text[:100])
ok(s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'estado intacto após envios inválidos', '')
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=b'\xef\xbb\xbf' + corpo0)
ok(r.status_code == 200 and s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'estado com BOM UTF-8 aceito (BOM removido)', r.status_code)

gz = copy.deepcopy(estado); gz['__gzip'] = ['ok']
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=gzip.compress(compacto(gz)), headers={'Content-Encoding': 'gzip', 'Content-Type': 'text/plain; charset=utf-8'})
ok(r.status_code == 200 and s.get(BASE + '/api/bootstrap').json()['data'].get('__gzip') == ['ok'], 'PUT com Content-Encoding: gzip', r.status_code)
s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo0)

# Estado grande (~40 MB, como a biblioteca ambiental do MES real)
grande = copy.deepcopy(estado)
grande['__grande'] = [{'i': i, 'texto': 'x' * 380, 'num': i * 0.1, 'acento': 'ção'} for i in range(100000)]
corpo = compacto(grande)
t = time.time(); r = s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo); dt = time.time() - t
ok(r.status_code == 200, f'PUT estado grande ({len(corpo)/1e6:.1f} MB) em {dt:.1f}s', f'{r.status_code} {r.text[:100]}')
t = time.time(); bg = s.get(BASE + '/api/bootstrap'); dt = time.time() - t
ok(bg.status_code == 200 and bg.json()['data'] == grande, f'bootstrap grande íntegro em {dt:.1f}s', bg.status_code)
t = time.time(); st = s.get(BASE + '/api/storage'); dt = time.time() - t
ok(st.status_code == 200 and json.loads(st.json()['MES_LION_DATA']) == grande, f'GET /api/storage grande (estado como texto JSON) em {dt:.1f}s', st.status_code)
s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo0)

# Gravações concorrentes (dois usuários ao mesmo tempo): atendidas em sequência, a última prevalece, sem corromper
resultados = []
def gravar(i):
    e = copy.deepcopy(estado); e['__concorrente'] = [i]
    resultados.append(requests.put(BASE + '/api/storage/MES_LION_DATA', data=compacto(e), cookies=s.cookies).status_code)
th = [threading.Thread(target=gravar, args=(i,)) for i in range(6)]
[x.start() for x in th]; [x.join() for x in th]
final = s.get(BASE + '/api/bootstrap').json()['data']
ok(all(c == 200 for c in resultados) and final.get('__concorrente', [None])[0] in range(6) and {k: v for k, v in final.items() if k != '__concorrente'} == estado,
   'gravações concorrentes consistentes', resultados)
s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo0)

# ---------------------------------------------------------------- app_storage (localStorage)
r = s.put(BASE + '/api/storage/' + requests.utils.quote('MES_TESTE chave/ç', safe=''), data='valor ç 🙂 "x"\n'.encode('utf-8'))
ok(r.status_code == 200 and r.text == 'OK', 'PUT chave de appStorage (codificada)', r.status_code)
r = s.put(BASE + '/api/storage/MES_teste_caixa', data=b'minusculas')
r = s.put(BASE + '/api/storage/MES_TESTE_CAIXA', data=b'MAIUSCULAS')
kv = s.get(BASE + '/api/bootstrap').json()['appStorage']
ok(kv.get('MES_TESTE chave/ç') == 'valor ç 🙂 "x"\n', 'chave/valor de appStorage no bootstrap', kv.get('MES_TESTE chave/ç'))
ok(kv.get('MES_teste_caixa') == 'minusculas' and kv.get('MES_TESTE_CAIXA') == 'MAIUSCULAS', 'chaves diferenciam maiúsculas (como o localStorage)', kv)
st = s.get(BASE + '/api/storage').json()
ok(isinstance(st.get('MES_LION_DATA'), str) and json.loads(st['MES_LION_DATA']) == estado and st.get('MES_TESTE chave/ç') == 'valor ç 🙂 "x"\n', 'GET /api/storage (kv + MES_LION_DATA)', '')
for k in ['MES_TESTE chave/ç', 'MES_teste_caixa', 'MES_TESTE_CAIXA']:
    r = s.delete(BASE + '/api/storage/' + requests.utils.quote(k, safe=''))
ok(r.status_code == 200 and not any(k in s.get(BASE + '/api/bootstrap').json()['appStorage'] for k in ['MES_TESTE chave/ç', 'MES_TESTE_CAIXA']), 'DELETE chave de appStorage', r.status_code)
r = s.delete(BASE + '/api/storage/MES_LION_DATA')
ok(r.status_code == 200 and s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'DELETE MES_LION_DATA nunca apaga o estado', r.status_code)

# ---------------------------------------------------------------- usuários
r = s.get(BASE + '/api/users'); lista = r.json()
ok(r.status_code == 200 and isinstance(lista, list) and lista and set(lista[0].keys()) == {'id', 'username', 'full_name', 'role', 'active', 'created_at', 'updated_at'},
   'GET /api/users (formato original)', lista[:1])
nome_u = 'teste_' + uuid.uuid4().hex[:8]
senha_u = "S3nh@ 'com' \"aspas\" ç 🙂"
r = s.post(BASE + '/api/users', json={'username': nome_u, 'fullName': 'Usuário de Teste ção', 'password': senha_u, 'role': 'USER', 'active': True})
ok(r.status_code == 200 and 'id' in r.json(), 'POST /api/users', r.text)
uid = r.json().get('id')
r = s.post(BASE + '/api/users', json={'username': nome_u, 'fullName': 'x', 'password': 'y', 'role': 'USER', 'active': True})
ok(r.status_code == 400 and 'error' in r.json(), 'usuário duplicado rejeitado', r.status_code)
r = s.post(BASE + '/api/users', json={'username': '', 'fullName': 'x', 'password': 'y'})
ok(r.status_code == 400 and r.json()['error'] == 'Usuário, nome e senha são obrigatórios', 'campos obrigatórios', r.text)
su = sessao((nome_u, senha_u))
ok(su.get(BASE + '/api/auth/me').json()['user']['role'] == 'USER', 'login do novo usuário (senha com caracteres especiais)', '')
if DADOS:
    h = next(u['password_hash'] for u in ler_usuarios() if u['username'] == nome_u)
    ok(verificar_pbkdf2_v3(senha_u, h) and base64.b64decode(h)[1:5] == (2).to_bytes(4, 'big'), 'hash PBKDF2-SHA512 no formato V3 (o mesmo do MES LION AZURE)', h[:20])
r = su.get(BASE + '/api/users'); ok(r.status_code == 403 and r.json()['error'] == 'Acesso administrativo necessário', 'USER não acessa /api/users', r.status_code)
r = su.post(BASE + '/api/import', data=b'{}'); ok(r.status_code == 403, 'USER não importa banco', r.status_code)
ok(su.get(BASE + '/api/audit').status_code == 200, 'USER consulta histórico (como no original)', '')
r = s.put(BASE + f'/api/users/{uid}', json={'fullName': 'Nome Alterado', 'role': 'ADMIN', 'active': True, 'password': ''})
ok(r.status_code == 200 and r.json() == {'ok': True}, 'PUT /api/users/{id}', r.text)
u2 = [x for x in s.get(BASE + '/api/users').json() if x['id'] == uid][0]
ok(u2['full_name'] == 'Nome Alterado' and u2['role'] == 'ADMIN' and u2['active'] is True, 'usuário atualizado', u2)
ok(sessao((nome_u, senha_u)).get(BASE + '/api/users').status_code == 200, 'senha mantida quando vazia; agora ADMIN', '')
s.put(BASE + f'/api/users/{uid}', json={'fullName': 'Nome Alterado', 'role': 'USER', 'active': False, 'password': 'NovaSenha1'})
ok(su.get(BASE + '/api/auth/me').status_code == 401, 'usuário desativado perde a sessão na hora', '')
r = requests.post(BASE + '/api/auth/login', json={'username': nome_u, 'password': 'NovaSenha1'})
ok(r.status_code == 401, 'usuário desativado não faz login', r.status_code)
admin_id = s.get(BASE + '/api/auth/me').json()['user']['id']
outros_admins = [x for x in s.get(BASE + '/api/users').json() if x['role'] == 'ADMIN' and x['active'] and x['id'] != admin_id]
if not outros_admins:
    r = s.put(BASE + f'/api/users/{admin_id}', json={'fullName': 'Administrador MES LION', 'role': 'USER', 'active': True, 'password': ''})
    ok(r.status_code == 400 and 'administrador' in r.json()['error'], 'não permite ficar sem administrador ativo', r.text)
aud = s.get(BASE + '/api/audit').json()
ok(any(x['module'] == 'usuarios' and x['action'] == 'CREATE' and x['record_key'] == nome_u for x in aud), 'auditoria de criação de usuário', '')
ok(len(aud) <= 500 and set(aud[0].keys()) == {'username', 'module', 'action', 'record_key', 'changed_at', 'details'}, 'GET /api/audit (formato original, até 500)', aud[0])
ok(all(aud[i]['changed_at'] >= aud[i + 1]['changed_at'] for i in range(len(aud) - 1)), 'histórico do mais recente para o mais antigo', [a['changed_at'] for a in aud[:3]])

if DADOS:
    # usuário migrado do PostgreSQL com hash bcrypt (pgcrypto): login com a senha antiga e conversão para PBKDF2
    import bcrypt
    senha_pg = 'Operação@2026 ç'
    lista_u = ler_usuarios()
    lista_u.append({'id': str(uuid.uuid4()), 'username': 'migrado_pg', 'full_name': 'Usuário migrado', 'role': 'USER', 'active': True,
                    'password_hash': bcrypt.hashpw(senha_pg.encode('utf-8'), bcrypt.gensalt(6, prefix=b'2a')).decode(),
                    'created_at': '2026-01-02T03:04:05.123456-03:00', 'updated_at': '2026-01-02T03:04:05.123456-03:00'})
    lista_u.append({'id': str(uuid.uuid4()), 'username': 'pbkdf2_net', 'full_name': 'Hash gerado fora (formato .NET)', 'role': 'USER', 'active': True,
                    'password_hash': pbkdf2_v3('Senha .NET ç', 5000, 1), 'created_at': '2026-01-02T03:04:05-03:00', 'updated_at': '2026-01-02T03:04:05-03:00'})
    gravar_usuarios(lista_u)
    t0 = time.time()
    r = requests.post(BASE + '/api/auth/login', json={'username': 'migrado_pg', 'password': senha_pg})
    ok(r.status_code == 200, f'login com senha bcrypt do PostgreSQL ({time.time() - t0:.2f}s)', r.text)
    ok(requests.post(BASE + '/api/auth/login', json={'username': 'migrado_pg', 'password': 'errada'}).status_code == 401, 'senha errada com hash bcrypt -> 401', '')
    h = next(u['password_hash'] for u in ler_usuarios() if u['username'] == 'migrado_pg')
    ok(not h.startswith('$2') and verificar_pbkdf2_v3(senha_pg, h), 'hash bcrypt convertido para PBKDF2 no primeiro login', h[:12])
    ok(requests.post(BASE + '/api/auth/login', json={'username': 'migrado_pg', 'password': senha_pg}).status_code == 200, 'novo login após a conversão', '')
    ok(requests.post(BASE + '/api/auth/login', json={'username': 'pbkdf2_net', 'password': 'Senha .NET ç'}).status_code == 200, 'hash PBKDF2-SHA256 V3 gerado fora (MES LION AZURE) aceito', '')
    ok(any(u['username'] == 'migrado_pg' for u in s.get(BASE + '/api/users').json()), 'usuário migrado listado', '')

    # linha do histórico cortada (ex.: desligamento no meio da gravação) não quebra a tela de histórico
    with open(os.path.join(DADOS, 'auditoria.jsonl'), 'ab') as f:
        f.write(b'{"username":"cortado","module":"x","act')
    s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo0)
    r = s.get(BASE + '/api/audit')
    ok(r.status_code == 200 and r.json()[0]['action'] == 'SAVE_STATE' and not any(a['username'] == 'cortado' for a in r.json()), 'linha cortada no histórico ignorada', r.text[:120])

# ---------------------------------------------------------------- documentos de equipamentos
pdf = b'%PDF-1.4\n' + bytes(range(256)) * 40 + b'\r\n--\r\n%%EOF\r\n'
xlsx = b'PK\x03\x04' + bytes(range(255, -1, -1)) * 30 + b'\r\n-'
for codigo in ['10', 'EQ 01/A-ç']:
    cq = requests.utils.quote(codigo, safe='')
    r = s.post(BASE + f'/api/equipment/{cq}/documents', files={'file': ('Instrução de Trabalho Nº1.pdf', pdf, 'application/pdf')}, data={'documentType': 'checklist ç', 'revision': 'B'})
    ok(r.status_code == 200 and 'id' in r.json(), f'upload PDF no equipamento "{codigo}"', r.text)
    did = r.json().get('id')
    time.sleep(0.01)
    r = s.post(BASE + f'/api/equipment/{cq}/documents', files={'file': ('planilha.xlsx', xlsx, 'application/octet-stream')}, data={'documentType': 'registro', 'revision': '1'})
    xid = r.json().get('id')
    docs = s.get(BASE + f'/api/equipment/{cq}/documents').json()
    ok(len(docs) == 2 and docs[0]['id'] == xid and docs[0]['equipment_code'] == codigo and docs[0]['file_size'] == len(xlsx)
       and docs[1]['original_name'] == 'Instrução de Trabalho Nº1.pdf' and docs[1]['document_type'] == 'checklist ç',
       f'lista de documentos de "{codigo}" (mais recente primeiro, nomes UTF-8)', docs[:2])
    r = s.get(BASE + f'/api/documents/{did}')
    ok(r.status_code == 200 and r.content == pdf and r.headers['content-type'] == 'application/pdf' and 'inline' in r.headers.get('content-disposition', ''),
       'download do PDF idêntico byte a byte', (r.status_code, len(r.content), r.headers.get('content-type')))
    ok("filename*=UTF-8''Instru%C3%A7%C3%A3o" in r.headers.get('content-disposition', ''), 'nome UTF-8 no Content-Disposition', r.headers.get('content-disposition'))
    ok(s.get(BASE + f'/api/documents/{xid}').content == xlsx, 'download do XLSX idêntico byte a byte (termina em CRLF e "-")', '')
r = s.post(BASE + '/api/equipment/10/documents', files={'file': ('programa.exe', b'MZ', 'application/octet-stream')})
ok(r.status_code == 400 and r.json()['error'] == 'Somente PDF/XLS/XLSX', 'extensão não permitida', r.text)
r = s.post(BASE + '/api/equipment/10/documents', data={'documentType': 'x'})
ok(r.status_code == 400 and r.json()['error'] == 'Arquivo obrigatório', 'upload sem arquivo', r.text)
ok(s.get(BASE + f'/api/documents/{uuid.uuid4()}').status_code == 404, 'documento inexistente -> 404', '')
ok(requests.get(BASE + f'/api/documents/{did}').status_code == 401, 'documento exige sessão', '')

# ---------------------------------------------------------------- anexos
r = s.post(BASE + '/api/attachments', json={'scope': 'empresas', 'recordId': 'EM0001', 'name': 'Contrato Social ç.pdf', 'mime': 'application/pdf', 'dataBase64': base64.b64encode(pdf).decode()})
ok(r.status_code == 200 and r.json()['url'].startswith('/api/attachments/') and r.json()['path'] == 'empresas/EM0001/Contrato Social ç.pdf', 'POST /api/attachments {url, path}', r.text)
r2 = s.get(BASE + r.json()['url'])
ok(r2.status_code == 200 and r2.content == pdf, 'download de anexo idêntico', r2.status_code)
ok(requests.get(BASE + r.json()['url']).status_code == 401, 'anexo exige sessão', '')
ok(s.post(BASE + '/api/attachments', json={'scope': 'x', 'dataBase64': '###'}).status_code == 400, 'anexo base64 inválido -> 400', '')
r = s.post(BASE + '/api/attachments', json={'scope': 'x', 'recordId': '1', 'name': '../../Dados/usuarios.json', 'dataBase64': base64.b64encode(b'x').decode()})
ok(r.status_code == 200 and '/' not in r.json()['name'] and '\\' not in r.json()['name'], 'nome de anexo com caminho é neutralizado', r.text)

# ---------------------------------------------------------------- passaporte publicado (QR)
r = s.post(BASE + '/api/passport-publish', json={'id': 'BP-TESTE_01', 'html': '<!doctype html><html><body>Passaporte ção</body></html>'})
ok(r.status_code == 200 and r.json()['url'].endswith('/passaporte/BP-TESTE_01.html'), 'POST /api/passport-publish {url}', r.text)
caminho = '/' + r.json()['url'].split('/', 3)[3]
r = requests.get(BASE + caminho)
ok(r.status_code == 200 and 'Passaporte ção' in r.content.decode('utf-8') and r.headers['content-type'].startswith('text/html'), 'página pública do passaporte (sem login)', r.status_code)
ok(requests.get(BASE + '/passaporte/NAO_EXISTE.html').status_code == 404, 'passaporte não publicado -> 404', '')
ok(requests.get(BASE + '/passaporte/..%2F..%2FDados%2Fusuarios').status_code == 404, 'passaporte com caminho -> 404', '')

# ---------------------------------------------------------------- backup / exportar / importar
r = s.post(BASE + '/api/backup', data='{}', headers={'Content-Type': 'application/json'})
ok(r.status_code == 200 and r.json().get('ok') and r.json().get('path', '').endswith('.zip'), 'POST /api/backup {path}', r.text)
if DADOS and r.status_code == 200:
    caminho_bk = os.path.join(DADOS, 'backups', r.json()['arquivo'])
    with zipfile.ZipFile(caminho_bk) as z:
        nomes = z.namelist()
        conteudo = json.loads(z.read(nomes[0]).decode('utf-8'))
    ok(len(nomes) == 1 and nomes[0].endswith('.json') and conteudo['format'] == 'MES_LION_JSON_DATABASE' and conteudo['data'] == estado,
       'backup .zip com o banco (.json, formato MES_LION_JSON_DATABASE) pronto para "Importar banco"', nomes)
r = s.get(BASE + '/api/export')
exp = r.json()
ok(r.status_code == 200 and 'attachment' in r.headers.get('content-disposition', '') and exp['format'] == 'MES_LION_JSON_DATABASE' and exp['data'] == estado,
   'GET /api/export (formato MES_LION_JSON_DATABASE)', r.headers.get('content-disposition'))
ok(list(exp.keys())[-1] == 'data' and isinstance(exp['appStorage'], dict), 'exportação com appStorage e data', list(exp.keys()))
mod = copy.deepcopy(exp); mod['data']['__importado'] = [{'ok': True, 'texto': 'ção <b> 🙂', 'n': 0.1}]; mod['appStorage'] = {'MES_LION_IMPORT_TESTE': 'sim'}
r = s.post(BASE + '/api/import', data=compacto(mod))
ok(r.status_code == 200 and r.json()['ok'] and r.json().get('backupAnterior') and r.json()['formato'] == 'MES_LION_JSON_DATABASE', 'POST /api/import (cria backup antes)', r.text)
bi = s.get(BASE + '/api/bootstrap').json()
ok(bi['data'] == mod['data'] and bi['appStorage'] == {'MES_LION_IMPORT_TESTE': 'sim'}, 'importação substitui estado e appStorage', '')
r = s.post(BASE + '/api/import', data=compacto(exp))
ok(r.status_code == 200 and s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'reimportação do export original', r.status_code)
for invalido in [b'{"format":"MES_LION_JSON_DATABASE","data":', b'{"format":"MES_LION_JSON_DATABASE","data":[1]}', b'[1,2]', b'nao json']:
    r = s.post(BASE + '/api/import', data=invalido)
    ok(r.status_code == 400 and 'error' in r.json(), f'importação inválida -> 400 (nada alterado): {invalido[:30]!r}', r.status_code)
ok(s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'estado intacto após importações inválidas', '')
r = s.post(BASE + '/api/import', data=compacto(estado))
ok(r.status_code == 200 and r.json()['formato'] == 'ESTADO' and s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'importação de objeto de estado puro', r.status_code)
bk = s.get(BASE + '/api/backups').json()
ok(len(bk) >= 3 and {'id', 'arquivo', 'motivo', 'criadoEm', 'bytes'} <= set(bk[0].keys()) and bk[0]['motivo'] == 'antes_importar', 'GET /api/backups (mais recente primeiro)', bk[:1])
r = s.get(BASE + '/api/backups/' + requests.utils.quote(bk[0]['id']))
ok(r.status_code == 200 and r.content[:2] == b'PK', 'download de backup (.zip)', r.status_code)
ok(s.get(BASE + '/api/backups/..%2Fusuarios.json').status_code == 404, 'download de backup não sai da pasta backups', '')
r = s.post(BASE + '/api/open-data-folder', data='{}')
ok(r.status_code in (200, 400) and ('path' in r.json() or 'Pasta de dados' in r.json().get('error', '')), 'POST /api/open-data-folder', r.text)

# ---------------------------------------------------------------- info / logout
inf = s.get(BASE + '/api/info').json()
ok(inf['app'] == 'MES LION' and inf['banco']['provedor'] == 'JSON' and inf['estado']['bytes'] > 0, 'GET /api/info', inf.get('estado'))
r = s.get(BASE + '/api/rota-inexistente'); ok(r.status_code == 404 and r.text == 'API não encontrada', 'rota /api inexistente com sessão -> 404 "API não encontrada"', f'{r.status_code} {r.text}')
r = s.post(BASE + '/api/auth/logout'); ok(r.json() == {'ok': True}, 'logout', r.text)
ok(s.get(BASE + '/api/bootstrap').status_code == 401, 'sessão encerrada após logout', '')

print()
print(f'{total - len(falhas)}/{total} testes OK')
if falhas:
    print('FALHAS:')
    for f in falhas:
        print(' -', f)
    sys.exit(1)
