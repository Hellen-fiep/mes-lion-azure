#!/usr/bin/env python3
"""
Testes de contrato da API do MES LION (servidor ASP.NET Core), equivalentes ao servidor PowerShell original.
Funciona com o modo Portátil e com SQL Server/Azure SQL.

Uso: python testes_api.py <url_base> [arquivo_dados_iniciais.json]
Requisitos: pip install requests
"""
import sys, json, gzip, base64, time, uuid, threading, copy, hashlib
import requests

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:8765'
SEED = sys.argv[2] if len(sys.argv) > 2 else None
ADMIN = ('admin', 'meslion2026')
falhas, total = [], 0


def ok(cond, nome, detalhe=''):
    global total
    total += 1
    print(('  [OK]   ' if cond else '  [FALHA] ') + nome + ('' if cond else f' -> {detalhe}'))
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


print(f'== MES LION — testes de API em {BASE}')

# ---------------------------------------------------------------- sem sessão
anon = requests.Session()
for metodo, rota in [('GET', '/api/bootstrap'), ('GET', '/api/storage'), ('GET', '/api/users'), ('GET', '/api/audit'),
                     ('PUT', '/api/storage/MES_LION_DATA'), ('GET', '/api/info'), ('POST', '/api/backup'), ('GET', '/api/rota-inexistente')]:
    r = anon.request(metodo, BASE + rota, data=b'{}')
    ok(r.status_code == 401 and r.json().get('error') == 'Não autenticado', f'sem sessão {metodo} {rota} -> 401', f'{r.status_code} {r.text[:80]}')
r = anon.get(BASE + '/api/auth/me'); ok(r.status_code == 401, '/api/auth/me sem sessão -> 401', r.status_code)
r = anon.get(BASE + '/'); ok(r.status_code == 200 and 'MES LION' in r.text and 'mes_plataforma_azure.js' in r.text, 'index.html servido', r.status_code)
r = anon.get(BASE + '/js/app.js?v=1.0.21'); ok(r.status_code == 200 and 'javascript' in r.headers.get('content-type', ''), 'js/app.js servido (application/javascript)', r.headers.get('content-type'))
r = anon.get(BASE + '/arquivo-inexistente.txt'); ok(r.status_code == 404 and r.text == 'Não encontrado', 'arquivo inexistente -> 404 "Não encontrado"', f'{r.status_code} {r.text}')
r = anon.get(BASE + '/healthz'); ok(r.status_code == 200 and r.json()['status'] == 'ok', '/healthz', r.text)
r = anon.get(BASE + '/api/auth/config'); ok(r.status_code == 200 and 'banco' in r.json(), '/api/auth/config público', r.text[:100])

# ---------------------------------------------------------------- login
r = anon.post(BASE + '/api/auth/login', json={'username': 'admin', 'password': 'senha-errada'})
ok(r.status_code == 401 and r.json()['error'] == 'Usuário ou senha inválidos', 'login com senha errada -> 401', r.text)
r = anon.post(BASE + '/api/auth/login', json={'username': 'ADMIN', 'password': ADMIN[1]})
ok(r.status_code == 401, 'username diferencia maiúsculas (como no PostgreSQL)', r.status_code)
s = requests.Session()
r = s.post(BASE + '/api/auth/login', json={'username': ADMIN[0], 'password': ADMIN[1]})
ok(r.status_code == 200 and r.json()['user']['username'] == 'admin' and r.json()['user']['role'] == 'ADMIN', 'login admin', r.text)
ck = r.headers.get('set-cookie', '')
ok('MESSESSION=' in ck and 'httponly' in ck.lower() and 'samesite=lax' in ck.lower() and 'path=/' in ck.lower(), 'cookie MESSESSION HttpOnly/SameSite=Lax/Path=/', ck[:150])
ok(set(r.json()['user'].keys()) >= {'id', 'username', 'fullName', 'role'}, 'formato do usuário {id,username,fullName,role}', r.json()['user'])
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
    ok(estado == seed_data, 'estado inicial = dados do arquivo inicial (seed)', 'diferente')
    ok(list(estado.keys()) == list(seed_data.keys()), 'ordem das coleções preservada', list(estado.keys())[:5])
    if seed.get('appStorage'):
        ok(all(b['appStorage'].get(k) == str(v) for k, v in seed['appStorage'].items()), 'appStorage inicial carregado do seed', b['appStorage'])
ok(isinstance(estado, dict) and len(estado) > 0, 'estado com coleções', len(estado or {}))

# ---------------------------------------------------------------- gravação do estado
versao0 = s.get(BASE + '/api/info').json()['estado']['versao']
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=compacto(estado), headers={'Content-Type': 'text/plain; charset=utf-8'})
ok(r.status_code == 200 and r.text == 'OK', 'PUT estado sem mudanças -> "OK"', f'{r.status_code} {r.text}')
a = ultima_auditoria(s, 'SAVE_STATE')
ok(a and a['module'] == 'app' and a['record_key'] == 'MES_LION_DATA' and a['details'].get('colecoes_alteradas') == [], 'auditoria SAVE_STATE sem coleções alteradas', a)

alterado = copy.deepcopy(estado)
col = next(k for k, v in alterado.items() if isinstance(v, list) and v and isinstance(v[0], dict))
alterado[col][0]['__teste_api'] = 'valor com acentuação ção ã é 🙂 "aspas" \\ barra'
alterado['__colecao_teste'] = [{'x': 1, 'y': None, 'z': [1, {'w': 'k'}], 'n': 1.5e-7}]
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=compacto(alterado))
ok(r.status_code == 200, 'PUT estado alterado', r.status_code)
a = ultima_auditoria(s, 'SAVE_STATE')
ok(sorted(a['details'].get('colecoes_alteradas', [])) == sorted([col, '__colecao_teste']), 'grava somente as coleções alteradas', a['details'])
b2 = s.get(BASE + '/api/bootstrap').json()['data']
ok(b2 == alterado, 'bootstrap devolve exatamente o estado gravado (unicode, números, nulos, aninhados)', 'diferente')
ok(list(b2.keys()) == list(alterado.keys()), 'ordem das coleções após gravação', list(b2.keys())[-3:])

del alterado['__colecao_teste']
alterado[col][0].pop('__teste_api')
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=compacto(alterado))
a = ultima_auditoria(s, 'SAVE_STATE')
ok(r.status_code == 200 and a['details'].get('colecoes_removidas') == ['__colecao_teste'], 'remoção de coleção', a['details'])
ok(s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'estado volta ao original', '')

r = s.put(BASE + '/api/storage/MES_LION_DATA', data=b'{"materiais": [1,2')
ok(r.status_code == 400 and 'inválido' in r.json()['error'], 'JSON inválido -> 400 sem alterar o banco', r.text[:100])
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=b'[1,2,3]')
ok(r.status_code == 400, 'raiz não-objeto -> 400', r.status_code)
ok(s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'estado intacto após envios inválidos', '')

# Envio compactado (gzip), usado pelo adaptador em acesso remoto/Azure
gz = copy.deepcopy(estado); gz['__gzip'] = ['ok']
r = s.put(BASE + '/api/storage/MES_LION_DATA', data=gzip.compress(compacto(gz)), headers={'Content-Encoding': 'gzip', 'Content-Type': 'text/plain; charset=utf-8'})
ok(r.status_code == 200 and s.get(BASE + '/api/bootstrap').json()['data'].get('__gzip') == ['ok'], 'PUT com Content-Encoding: gzip', r.status_code)
s.put(BASE + '/api/storage/MES_LION_DATA', data=compacto(estado))

# Estado grande (~40 MB)
grande = copy.deepcopy(estado)
grande['__grande'] = [{'i': i, 'texto': 'x' * 380, 'num': i * 0.1} for i in range(100000)]
corpo = compacto(grande)
t = time.time(); r = s.put(BASE + '/api/storage/MES_LION_DATA', data=corpo); dt = time.time() - t
ok(r.status_code == 200, f'PUT estado grande ({len(corpo)/1e6:.1f} MB) em {dt:.1f}s', f'{r.status_code} {r.text[:100]}')
t = time.time(); bg = s.get(BASE + '/api/bootstrap', headers={'Accept-Encoding': 'gzip'}); dt = time.time() - t
ok(bg.status_code == 200 and bg.json()['data'] == grande, f'bootstrap grande íntegro em {dt:.1f}s (compressão: {bg.headers.get("content-encoding")})', bg.status_code)
s.put(BASE + '/api/storage/MES_LION_DATA', data=compacto(estado))

# Gravações concorrentes (dois usuários ao mesmo tempo): a última gravação completa prevalece, sem corromper
resultados = []
def gravar(i):
    st = copy.deepcopy(estado); st['__concorrente'] = [i]
    resultados.append(requests.put(BASE + '/api/storage/MES_LION_DATA', data=compacto(st), cookies=s.cookies).status_code)
th = [threading.Thread(target=gravar, args=(i,)) for i in range(6)]
[t.start() for t in th]; [t.join() for t in th]
final = s.get(BASE + '/api/bootstrap').json()['data']
ok(all(c == 200 for c in resultados) and final.get('__concorrente', [None])[0] in range(6) and {k: v for k, v in final.items() if k != '__concorrente'} == estado,
   'gravações concorrentes consistentes', resultados)
s.put(BASE + '/api/storage/MES_LION_DATA', data=compacto(estado))
v1 = s.get(BASE + '/api/info').json()['estado']['versao']
ok(v1 > versao0, 'versão do estado incrementa a cada gravação', f'{versao0} -> {v1}')

# ---------------------------------------------------------------- app_storage (localStorage)
r = s.put(BASE + '/api/storage/' + requests.utils.quote('MES_TESTE chave/ç', safe=''), data='valor ç 🙂'.encode('utf-8'))
ok(r.status_code == 200 and r.text == 'OK', 'PUT chave de appStorage (codificada)', r.status_code)
kv = s.get(BASE + '/api/bootstrap').json()['appStorage']
ok(kv.get('MES_TESTE chave/ç') == 'valor ç 🙂', 'chave/valor de appStorage no bootstrap', kv.get('MES_TESTE chave/ç'))
st = s.get(BASE + '/api/storage').json()
ok(isinstance(st.get('MES_LION_DATA'), str) and json.loads(st['MES_LION_DATA']) == estado and st.get('MES_TESTE chave/ç') == 'valor ç 🙂', 'GET /api/storage (kv + MES_LION_DATA)', '')
r = s.delete(BASE + '/api/storage/' + requests.utils.quote('MES_TESTE chave/ç', safe=''))
ok(r.status_code == 200 and 'MES_TESTE chave/ç' not in s.get(BASE + '/api/bootstrap').json()['appStorage'], 'DELETE chave de appStorage', r.status_code)
r = s.delete(BASE + '/api/storage/MES_LION_DATA')
ok(r.status_code == 200 and s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'DELETE MES_LION_DATA nunca apaga o estado', r.status_code)

# ---------------------------------------------------------------- usuários
r = s.get(BASE + '/api/users'); lista = r.json()
ok(r.status_code == 200 and isinstance(lista, list) and lista and set(lista[0].keys()) == {'id', 'username', 'full_name', 'role', 'active', 'created_at', 'updated_at'},
   'GET /api/users (formato original)', lista[:1])
nome_u = 'teste_' + uuid.uuid4().hex[:8]
r = s.post(BASE + '/api/users', json={'username': nome_u, 'fullName': 'Usuário de Teste ção', 'password': "S3nh@ 'com' \"aspas\" ç", 'role': 'USER', 'active': True})
ok(r.status_code == 200 and 'id' in r.json(), 'POST /api/users', r.text)
uid = r.json().get('id')
r = s.post(BASE + '/api/users', json={'username': nome_u, 'fullName': 'x', 'password': 'y', 'role': 'USER', 'active': True})
ok(r.status_code >= 400 and 'error' in r.json(), 'usuário duplicado rejeitado', r.status_code)
r = s.post(BASE + '/api/users', json={'username': '', 'fullName': 'x', 'password': 'y'})
ok(r.status_code == 400 and r.json()['error'] == 'Usuário, nome e senha são obrigatórios', 'campos obrigatórios', r.text)
su = sessao((nome_u, "S3nh@ 'com' \"aspas\" ç"))
ok(su.get(BASE + '/api/auth/me').json()['user']['role'] == 'USER', 'login do novo usuário (senha com caracteres especiais)', '')
r = su.get(BASE + '/api/users'); ok(r.status_code == 403 and r.json()['error'] == 'Acesso administrativo necessário', 'USER não acessa /api/users', r.status_code)
r = su.post(BASE + '/api/import', data=b'{}'); ok(r.status_code == 403, 'USER não importa banco', r.status_code)
ok(su.get(BASE + '/api/audit').status_code == 200, 'USER consulta histórico (como no original)', '')
r = s.put(BASE + f'/api/users/{uid}', json={'fullName': 'Nome Alterado', 'role': 'ADMIN', 'active': True, 'password': ''})
ok(r.status_code == 200 and r.json() == {'ok': True}, 'PUT /api/users/{id}', r.text)
u2 = [x for x in s.get(BASE + '/api/users').json() if x['id'] == uid][0]
ok(u2['full_name'] == 'Nome Alterado' and u2['role'] == 'ADMIN' and u2['active'] is True, 'usuário atualizado', u2)
ok(sessao((nome_u, "S3nh@ 'com' \"aspas\" ç")).get(BASE + '/api/users').status_code == 200, 'senha mantida quando vazia; agora ADMIN', '')
s.put(BASE + f'/api/users/{uid}', json={'fullName': 'Nome Alterado', 'role': 'USER', 'active': False, 'password': 'NovaSenha1'})
time.sleep(21)  # cache de sessão de 20 s
ok(su.get(BASE + '/api/auth/me').status_code == 401, 'usuário desativado perde a sessão', '')
r = requests.post(BASE + '/api/auth/login', json={'username': nome_u, 'password': 'NovaSenha1'})
ok(r.status_code == 401, 'usuário desativado não faz login', r.status_code)
aud = s.get(BASE + '/api/audit').json()
ok(any(x['module'] == 'usuarios' and x['action'] == 'CREATE' and x['record_key'] == nome_u for x in aud), 'auditoria de criação de usuário', '')
ok(len(aud) <= 500 and set(aud[0].keys()) == {'username', 'module', 'action', 'record_key', 'changed_at', 'details'}, 'GET /api/audit (formato original, até 500)', aud[0])

# ---------------------------------------------------------------- documentos de equipamentos
pdf = b'%PDF-1.4\n' + bytes(range(256)) * 40 + b'\r\n--\r\n%%EOF\r\n'
xlsx = b'PK\x03\x04' + bytes(range(255, -1, -1)) * 30 + b'\r\n-'
for codigo in ['10', 'EQ 01/A-ç']:
    cq = requests.utils.quote(codigo, safe='')
    r = s.post(BASE + f'/api/equipment/{cq}/documents', files={'file': ('Instrução de Trabalho Nº1.pdf', pdf, 'application/pdf')}, data={'documentType': 'checklist', 'revision': 'B'})
    ok(r.status_code == 200 and 'id' in r.json(), f'upload PDF no equipamento "{codigo}"', r.text)
    did = r.json().get('id')
    r = s.post(BASE + f'/api/equipment/{cq}/documents', files={'file': ('planilha.xlsx', xlsx, 'application/octet-stream')}, data={'documentType': 'registro', 'revision': '1'})
    xid = r.json().get('id')
    docs = s.get(BASE + f'/api/equipment/{cq}/documents').json()
    ok(len(docs) >= 2 and docs[0]['id'] == xid and docs[0]['equipment_code'] == codigo and docs[0]['file_size'] == len(xlsx),
       f'lista de documentos de "{codigo}" (mais recente primeiro)', docs[:1])
    r = s.get(BASE + f'/api/documents/{did}')
    ok(r.status_code == 200 and r.content == pdf and r.headers['content-type'] == 'application/pdf' and 'inline' in r.headers.get('content-disposition', ''),
       'download do PDF idêntico byte a byte', (r.status_code, len(r.content), r.headers.get('content-type')))
    ok("filename*=UTF-8''Instru%C3%A7%C3%A3o" in r.headers.get('content-disposition', ''), 'nome UTF-8 no Content-Disposition', r.headers.get('content-disposition'))
    ok(s.get(BASE + f'/api/documents/{xid}').content == xlsx, 'download do XLSX idêntico byte a byte', '')
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
ok(s.post(BASE + '/api/attachments', json={'scope': 'x', 'dataBase64': '###'}).status_code == 400, 'anexo base64 inválido -> 400', '')

# ---------------------------------------------------------------- passaporte publicado (QR)
r = s.post(BASE + '/api/passport-publish', json={'id': 'BP-TESTE_01', 'html': '<!doctype html><html><body>Passaporte ção</body></html>'})
ok(r.status_code == 200 and r.json()['url'].endswith('/passaporte/BP-TESTE_01.html'), 'POST /api/passport-publish {url}', r.text)
caminho = '/' + r.json()['url'].split('/', 3)[3]
r = requests.get(BASE + caminho)
ok(r.status_code == 200 and 'Passaporte ção' in r.content.decode('utf-8') and r.headers['content-type'].startswith('text/html'), 'página pública do passaporte (sem login)', r.status_code)
ok(requests.get(BASE + '/passaporte/NAO_EXISTE.html').status_code == 404, 'passaporte não publicado -> 404', '')

# ---------------------------------------------------------------- backup / exportar / importar
r = s.post(BASE + '/api/backup', data='{}', headers={'Content-Type': 'application/json'})
ok(r.status_code == 200 and r.json().get('ok') and r.json().get('path'), 'POST /api/backup {path}', r.text)
r = s.get(BASE + '/api/export')
exp = r.json()
ok(r.status_code == 200 and 'attachment' in r.headers.get('content-disposition', '') and exp['format'] == 'MES_LION_JSON_DATABASE' and exp['data'] == estado,
   'GET /api/export (formato MES_LION_JSON_DATABASE)', r.headers.get('content-disposition'))
mod = copy.deepcopy(exp); mod['data']['__importado'] = [{'ok': True}]; mod['appStorage'] = {'MES_LION_IMPORT_TESTE': 'sim'}
r = s.post(BASE + '/api/import', data=compacto(mod))
ok(r.status_code == 200 and r.json()['ok'] and r.json().get('backupAnterior'), 'POST /api/import (cria backup antes)', r.text)
bi = s.get(BASE + '/api/bootstrap').json()
ok(bi['data'] == mod['data'] and bi['appStorage'] == {'MES_LION_IMPORT_TESTE': 'sim'}, 'importação substitui estado e appStorage', '')
r = s.post(BASE + '/api/import', data=compacto(exp))
ok(r.status_code == 200 and s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'reimportação do export original', r.status_code)
r = s.post(BASE + '/api/import', data=b'{"format":"MES_LION_JSON_DATABASE","data":')
ok(r.status_code == 400, 'importação inválida -> 400 (nada alterado)', r.status_code)
r = s.post(BASE + '/api/import', data=compacto(estado))
ok(r.status_code == 200 and s.get(BASE + '/api/bootstrap').json()['data'] == estado, 'importação de objeto de estado puro', r.status_code)
bk = s.get(BASE + '/api/backups').json()
ok(len(bk) >= 2, 'GET /api/backups', len(bk))
r = s.get(BASE + f"/api/backups/{bk[-1]['id']}")
ok(r.status_code == 200 and json.loads(gzip.decompress(r.content))['format'] == 'MES_LION_JSON_DATABASE', 'download de backup (.json.gz)', r.status_code)

# ---------------------------------------------------------------- info / logout
inf = s.get(BASE + '/api/info').json()
ok(inf['app'] == 'MES LION' and inf['estado']['colecoes'] == len(estado), 'GET /api/info', inf.get('estado'))
r = s.get(BASE + '/api/rota-inexistente'); ok(r.status_code == 404 and r.text == 'API não encontrada', 'rota /api inexistente com sessão -> 404 "API não encontrada"', f'{r.status_code} {r.text}')
r = s.post(BASE + '/api/auth/logout'); ok(r.json() == {'ok': True}, 'logout', r.text)
ok(s.get(BASE + '/api/bootstrap').status_code == 401, 'sessão encerrada após logout', '')

print()
print(f'== {total - len(falhas)}/{total} verificações OK')
if falhas:
    print('FALHAS:'); [print(' - ' + f) for f in falhas]
    sys.exit(1)
