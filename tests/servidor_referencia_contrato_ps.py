#!/usr/bin/env python3
"""
Servidor de REFERÊNCIA do contrato HTTP do MES_LION_SERVER.ps1 (PowerShell + PostgreSQL).
Uso exclusivo em testes A/B: reproduz as mesmas rotas, códigos HTTP e formatos JSON
do servidor PowerShell original, com estado em memória.
"""
import json, sys, os, uuid, re, mimetypes, threading, datetime, argparse, hashlib, base64
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

ap = argparse.ArgumentParser()
ap.add_argument('--root', required=True)
ap.add_argument('--seed', required=True)
ap.add_argument('--port', type=int, default=8766)
args = ap.parse_args()
ROOT = os.path.abspath(args.root)

with open(args.seed, encoding='utf-8-sig') as f:
    seed = json.load(f)
if isinstance(seed, dict) and seed.get('format') == 'MES_LION_JSON_DATABASE':
    STATE = json.dumps(seed.get('data') or {}, ensure_ascii=False)
    KV = {k: str(v) for k, v in (seed.get('appStorage') or {}).items()}
else:
    STATE = json.dumps(seed, ensure_ascii=False)
    KV = {}
LOCK = threading.Lock()
USERS = {}
def _mk_user(username, full, pw, role, active=True):
    uid = str(uuid.uuid4())
    now = datetime.datetime.now().astimezone().isoformat()
    USERS[uid] = dict(id=uid, username=username, full_name=full, password=pw, role=role, active=active, created_at=now, updated_at=now)
_mk_user('admin', 'Administrador MES LION', 'meslion2026', 'ADMIN')
SESSIONS = {}
AUDIT = []
DOCS = {}
UPLOADS = {}

def audit(u, module, action, key='', details=None):
    if not u: return
    AUDIT.insert(0, dict(username=u['username'], module=module, action=action, record_key=key,
                         changed_at=datetime.datetime.now().astimezone().isoformat(), details=details or {}))

MIME = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
        '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.pdf':'application/pdf',
        '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel'}

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, str): body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Connection', 'close')
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True
    def j(self, code, obj, extra=None):
        self._send(code, json.dumps(obj, ensure_ascii=False, separators=(',', ':')), extra=extra)
    def user(self):
        m = re.search(r'MESSESSION=([^;]+)', self.headers.get('Cookie', '') or '')
        return SESSIONS.get(m.group(1)) if m else None
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''
    def do_GET(self): self.route('GET')
    def do_POST(self): self.route('POST')
    def do_PUT(self): self.route('PUT')
    def do_DELETE(self): self.route('DELETE')
    def route(self, method):
        global STATE
        path = urlparse(self.path).path
        u = self.user()
        b = self.body() if method in ('POST', 'PUT') else b''
        try:
            if path == '/api/auth/login' and method == 'POST':
                o = json.loads(b.decode('utf-8'))
                usr = next((x for x in USERS.values() if x['username'] == o.get('username') and x['active'] and x['password'] == o.get('password')), None)
                if not usr: return self.j(401, {'error': 'Usuário ou senha inválidos'})
                tok = uuid.uuid4().hex
                SESSIONS[tok] = {'id': usr['id'], 'username': usr['username'], 'fullName': usr['full_name'], 'role': usr['role']}
                audit(SESSIONS[tok], 'auth', 'LOGIN', usr['username'])
                return self.j(200, {'user': SESSIONS[tok]}, {'Set-Cookie': f'MESSESSION={tok}; Path=/; HttpOnly; SameSite=Lax'})
            if path == '/api/auth/logout' and method == 'POST':
                return self.j(200, {'ok': True}, {'Set-Cookie': 'MESSESSION=; Path=/; Max-Age=0'})
            if path == '/api/auth/me':
                return self.j(200, {'user': u}) if u else self.j(401, {'error': 'Não autenticado'})
            if path.startswith('/api/') and not u:
                return self.j(401, {'error': 'Não autenticado'})
            if path == '/api/bootstrap':
                with LOCK: st = STATE
                body = '{"data":' + st + ',"appStorage":' + json.dumps(KV, ensure_ascii=False) + ',"user":' + json.dumps(u, ensure_ascii=False) + '}'
                return self._send(200, body)
            if path == '/api/storage' and method == 'GET':
                o = dict(KV); o['MES_LION_DATA'] = STATE
                return self.j(200, o)
            m = re.match(r'^/api/storage/(.+)$', path)
            if m and method == 'PUT':
                key = unquote(m.group(1)); txt = b.decode('utf-8')
                if key == 'MES_LION_DATA':
                    json.loads(txt)  # jsonb valida
                    with LOCK: STATE = txt
                    audit(u, 'app', 'SAVE_STATE', 'MES_LION_DATA')
                else:
                    KV[key] = txt
                return self._send(200, 'OK', 'text/plain; charset=utf-8')
            if path == '/api/users' and method == 'GET':
                if u['role'] != 'ADMIN': return self.j(403, {'error': 'Acesso administrativo necessário'})
                rows = sorted(USERS.values(), key=lambda x: x['full_name'])
                return self.j(200, [{k: x[k] for k in ('id','username','full_name','role','active','created_at','updated_at')} for x in rows])
            if path == '/api/users' and method == 'POST':
                if u['role'] != 'ADMIN': return self.j(403, {'error': 'Acesso administrativo necessário'})
                o = json.loads(b.decode('utf-8'))
                if not (o.get('username') or '').strip() or not (o.get('fullName') or '').strip() or not (o.get('password') or '').strip():
                    return self.j(400, {'error': 'Usuário, nome e senha são obrigatórios'})
                if any(x['username'] == o['username'] for x in USERS.values()):
                    return self.j(500, {'error': 'duplicate key value violates unique constraint "users_username_key"'})
                _mk_user(o['username'], o['fullName'], o['password'], o.get('role') or 'USER', bool(o.get('active')))
                uid = [k for k, v in USERS.items() if v['username'] == o['username']][0]
                audit(u, 'usuarios', 'CREATE', o['username'])
                return self.j(200, {'id': uid})
            m = re.match(r'^/api/users/([0-9a-fA-F-]+)$', path)
            if m and method == 'PUT':
                if u['role'] != 'ADMIN': return self.j(403, {'error': 'Acesso administrativo necessário'})
                o = json.loads(b.decode('utf-8')); x = USERS.get(m.group(1))
                if x:
                    x['full_name'] = o.get('fullName') or ''; x['role'] = o.get('role') or ''; x['active'] = bool(o.get('active'))
                    if (o.get('password') or '').strip(): x['password'] = o['password']
                    x['updated_at'] = datetime.datetime.now().astimezone().isoformat()
                audit(u, 'usuarios', 'UPDATE', m.group(1))
                return self.j(200, {'ok': True})
            if path == '/api/audit':
                return self.j(200, AUDIT[:500])
            m = re.match(r'^/api/equipment/(.+)/documents$', path)
            if m and method == 'GET':
                code = unquote(m.group(1))
                rows = [d for d in DOCS.values() if d['equipment_code'] == code and d['active']]
                rows.sort(key=lambda d: d['uploaded_at'], reverse=True)
                return self.j(200, rows)
            if m and method == 'POST':
                code = unquote(m.group(1))
                ctype = self.headers.get('Content-Type', '')
                bm = re.search(r'boundary=(.+)$', ctype)
                parts = {}
                if bm:
                    bnd = ('--' + bm.group(1).strip('"')).encode('latin-1')
                    for part in b.split(bnd):
                        hm = re.search(rb'Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]*)")?', part)
                        if not hm: continue
                        idx = part.find(b'\r\n\r\n')
                        content = part[idx + 4:]
                        if content.endswith(b'\r\n'): content = content[:-2]
                        name = hm.group(1).decode()
                        if hm.group(2) is not None: parts[name] = (hm.group(2).decode('utf-8', 'replace'), content)
                        else: parts[name] = content.decode('utf-8', 'replace')
                if 'file' not in parts: return self.j(400, {'error': 'Arquivo obrigatório'})
                fn, content = parts['file']; ext = os.path.splitext(fn)[1].lower()
                if ext not in ('.pdf', '.xlsx', '.xls'): return self.j(400, {'error': 'Somente PDF/XLS/XLSX'})
                did = str(uuid.uuid4())
                DOCS[did] = dict(id=did, equipment_code=code, original_name=fn, mime_type=MIME.get(ext, 'application/octet-stream'), file_size=len(content),
                                 document_type=parts.get('documentType', ''), revision=parts.get('revision', ''), active=True,
                                 uploaded_at=datetime.datetime.now().astimezone().isoformat())
                UPLOADS[did] = content
                audit(u, 'equipamentos', 'UPLOAD_DOCUMENT', code)
                return self.j(200, {'id': did})
            m = re.match(r'^/api/documents/([0-9a-fA-F-]+)$', path)
            if m:
                d = DOCS.get(m.group(1))
                if not d: return self._send(404, 'Não encontrado', 'text/plain; charset=utf-8')
                return self._send(200, UPLOADS[d['id']], d['mime_type'], {'Content-Disposition': f'inline; filename="{d["original_name"]}"'})
            if path.startswith('/api/'):
                return self._send(404, 'API não encontrada', 'text/plain; charset=utf-8')
            rel = 'index.html' if path == '/' else unquote(path).lstrip('/')
            fp = os.path.abspath(os.path.join(ROOT, rel))
            if not fp.startswith(ROOT) or not os.path.isfile(fp):
                return self._send(404, 'Não encontrado', 'text/plain; charset=utf-8')
            with open(fp, 'rb') as f: data = f.read()
            return self._send(200, data, MIME.get(os.path.splitext(fp)[1].lower(), 'application/octet-stream'))
        except Exception as e:
            return self.j(500, {'error': str(e)})

print(f'REF server on http://127.0.0.1:{args.port}', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), H).serve_forever()
