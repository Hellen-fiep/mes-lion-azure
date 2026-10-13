#!/usr/bin/env python3
"""
Verificação do banco SQL Server / Azure SQL do MES LION após os testes de API:
esquema (tabelas/views/procedure), estado por coleção, payload reconstruído, camada relacional
(views geradas, views de correlação, tabelas normalizadas com FKs), rel.fn_num e catálogo.

Uso: python verificar_sqlserver.py <servidor> <porta> <usuario> <senha> <banco> <url_base_mes>
Requisitos: pip install pymssql requests
"""
import sys, json, time
import pymssql, requests

srv, porta, usr, pwd, banco, BASE = sys.argv[1:7]
falhas, total = [], 0


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'))
    if not c: falhas.append(f'{nome}: {det}')


cn = pymssql.connect(server=srv, port=int(porta), user=usr, password=pwd, database=banco, autocommit=True, charset='UTF-8', tds_version='7.4')
cur = cn.cursor()
def q(sql, *p):
    cur.execute(sql, p if p else None)
    return cur.fetchall()
def v(sql, *p):
    r = q(sql, *p)
    return r[0][0] if r else None

print(f'== Verificação SQL Server: {srv}:{porta}/{banco}')
ver = v("SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) + ' ' + CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100))")
print('   SQL Server', ver, '| compat', v("SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()"))

s = requests.Session()
assert s.post(BASE + '/api/auth/login', json={'username': 'admin', 'password': 'meslion2026'}).ok
estado = s.get(BASE + '/api/bootstrap').json()['data']

# ---------------------------------------------------------------- esquema
tabelas = {f'{r[0]}.{r[1]}' for r in q("SELECT s.name, t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id")}
esperadas = ['dbo.schema_version', 'dbo.users', 'dbo.app_state', 'dbo.app_state_collection', 'dbo.app_storage', 'dbo.audit_log',
             'dbo.products', 'dbo.materials', 'dbo.suppliers', 'dbo.equipment', 'dbo.equipment_documents', 'dbo.routes', 'dbo.route_steps',
             'dbo.production_orders', 'dbo.op_steps', 'dbo.op_materials', 'dbo.op_document_flags', 'dbo.icv_snapshots', 'dbo.aicv_results',
             'dbo.lcc_studies', 'dbo.battery_passports', 'dbo.equipment_scales', 'dbo.characterization_bookings', 'dbo.capacity_restrictions',
             'dbo.planning_goals', 'dbo.setup_time_logs', 'dbo.stock_movements', 'dbo.attachments', 'dbo.published_passports',
             'dbo.state_backups', 'dbo.data_protection_keys', 'rel.relacionamentos', 'rel.views_geradas', 'rel.sincronizacao_status', 'rel.qualidade_dados']
faltando = [t for t in esperadas if t not in tabelas]
ok(not faltando, f'{len(esperadas)} tabelas do esquema (inclui todas as do PostgreSQL original)', faltando)
ok(v('SELECT COUNT(*) FROM dbo.schema_version') == 5, 'scripts 001–005 aplicados (dbo.schema_version)', q('SELECT script FROM dbo.schema_version'))
ok(v("SELECT COUNT(*) FROM sys.foreign_keys") >= 30, 'chaves estrangeiras criadas', v("SELECT COUNT(*) FROM sys.foreign_keys"))
ok(v("SELECT COUNT(*) FROM sys.objects WHERE name = 'usp_sincronizar_modelo_relacional' AND type = 'P'") == 1, 'procedure rel.usp_sincronizar_modelo_relacional', '')

# ---------------------------------------------------------------- estado
ok(v('SELECT COUNT(*) FROM dbo.app_state_collection') == len(estado), 'uma linha por coleção em dbo.app_state_collection', (v('SELECT COUNT(*) FROM dbo.app_state_collection'), len(estado)))
payload = v('SELECT payload FROM dbo.vw_app_state_payload')
ok(json.loads(payload) == estado, 'dbo.vw_app_state_payload reconstrói o payload completo (= app_state.payload do PostgreSQL)', len(payload or ''))
ordem = [r[0] for r in q('SELECT name FROM dbo.app_state_collection ORDER BY ordinal, name')]
ok(ordem == list(estado.keys()), 'ordem das coleções preservada no banco', ordem[:5])
ok(v("SELECT COUNT(*) FROM dbo.users WHERE username = 'admin' AND password_hash LIKE 'AQAAAA%'") == 1, 'senha do admin em PBKDF2 (formato ASP.NET Identity V3)', '')
ok(v("SELECT COUNT(*) FROM dbo.audit_log WHERE action = 'SAVE_STATE' AND ISJSON(details) = 1") > 0, 'auditoria SAVE_STATE com detalhes JSON', '')
ok(v("SELECT COUNT(*) FROM dbo.data_protection_keys") >= 1, 'chave de sessão (Data Protection) persistida no SQL Server', '')

# ---------------------------------------------------------------- camada relacional (aguarda o serviço em segundo plano)
versao = v('SELECT version FROM dbo.app_state WHERE id = 1')
for _ in range(90):
    st = q('SELECT versao_estado, sucesso, mensagem FROM rel.sincronizacao_status WHERE id = 1')[0]
    if st[0] == versao and st[1] is not None: break
    time.sleep(1)
print('   sincronização:', st)
ok(st[1] is True or st[1] == 1, 'sincronização relacional concluída com sucesso', st)

def unicos(colecao, campo):
    return len({str(r.get(campo)).strip() for r in estado.get(colecao, []) if isinstance(r, dict) and str(r.get(campo) or '').strip()})
ok(v('SELECT COUNT(*) FROM dbo.products') == unicos('estrutura', 'Código'), 'dbo.products = códigos de estrutura', (v('SELECT COUNT(*) FROM dbo.products'), unicos('estrutura', 'Código')))
ok(v('SELECT COUNT(*) FROM dbo.materials') == unicos('materiais', 'CódigoMaterial'), 'dbo.materials = materiais', '')
ok(v('SELECT COUNT(*) FROM dbo.suppliers') == unicos('empresas', 'CodigoEM'), 'dbo.suppliers = empresas', '')
ok(v('SELECT COUNT(*) FROM dbo.routes') == unicos('roteiro', 'CodRoteiro'), 'dbo.routes = roteiros', '')
ok(v('SELECT COUNT(*) FROM dbo.production_orders') == unicos('op', 'CodOP'), 'dbo.production_orders = OPs', (v('SELECT COUNT(*) FROM dbo.production_orders'), unicos('op', 'CodOP')))
ops = {str(o.get('CodOP')).strip() for o in estado.get('op', [])}
ok(v('SELECT COUNT(*) FROM dbo.op_steps') == sum(1 for e in estado.get('op_etapas', []) if str(e.get('CodOP') or '').strip() in ops), 'dbo.op_steps = etapas de OPs existentes', '')
ok(v('SELECT COUNT(*) FROM dbo.op_materials') == sum(1 for e in estado.get('op_materiais', []) if str(e.get('CodOP') or '').strip() in ops), 'dbo.op_materials = materiais de OPs existentes', '')
eqs = {str(r.get('Código Equipamento') or '').strip() for r in estado.get('cad_recursos', [])} | {str(r.get('CodEquipamento') or '').strip() for r in estado.get('recursos', [])}
eqs.discard('')
ok(v('SELECT COUNT(*) FROM dbo.equipment WHERE code IN (%s)' % ','.join(["N'%s'" % e.replace("'", "''") for e in eqs])) == len(eqs), 'dbo.equipment contém cad_recursos + recursos', '')
ok(v('SELECT COUNT(*) FROM dbo.battery_passports') == unicos('bp', 'BatteryPassportID'), 'dbo.battery_passports = passaportes', '')
pa = next((p for p in estado.get('estrutura', []) if p.get('Tipo Produto') == 'PA'), None)
if pa:
    ok(v('SELECT description FROM dbo.products WHERE code = %s', pa['Código']) == pa['Descrição'], 'campos acentuados ("Código"/"Descrição") lidos corretamente', '')
op = estado.get('op', [{}])[0]
if op:
    ok(json.loads(v('SELECT payload FROM dbo.production_orders WHERE code = %s', op['CodOP'])) == next(o for o in reversed(estado['op']) if o['CodOP'] == op['CodOP']),
       'payload da OP = registro completo do estado', '')
ok(v('SELECT COUNT(*) FROM dbo.op_steps s LEFT JOIN dbo.production_orders o ON o.code = s.op_code WHERE o.code IS NULL') == 0, 'integridade OP → etapas (FK)', '')
ok(v("SELECT COUNT(*) FROM dbo.equipment_documents d JOIN dbo.equipment e ON e.code = d.equipment_code") == v("SELECT COUNT(*) FROM dbo.equipment_documents"), 'documentos ligados a equipamentos (FK)', '')
print('   avisos de qualidade:', q('SELECT tabela, tipo, chave, detalhe FROM rel.qualidade_dados')[:8])

# views geradas (uma por coleção)
geradas = {r[0]: r[1] for r in q('SELECT colecao, nome_view FROM rel.views_geradas')}
ok(set(geradas) == set(estado.keys()), 'uma view rel.<coleção> por coleção do estado', set(estado.keys()) - set(geradas))
erros_view = []
for col, nome in geradas.items():
    if isinstance(estado[col], list):
        n = v(f'SELECT COUNT(*) FROM {nome}')
        esperado = sum(1 for x in estado[col] if isinstance(x, dict)) if any(isinstance(x, dict) for x in estado[col]) else len(estado[col])
        if n != esperado: erros_view.append((nome, n, esperado))
ok(not erros_view, 'contagem de linhas das views rel.<coleção> = registros de cada coleção', erros_view[:5])
if estado.get('materiais'):
    cod = estado['materiais'][0]['CódigoMaterial']
    ok(v('SELECT [DescricaoMateriais] FROM rel.materiais WHERE [CódigoMaterial] = %s', cod) == estado['materiais'][0]['DescricaoMateriais'], 'rel.materiais com colunas = campos do frontend', '')

# views de correlação
for view, esperado in [('rel.vw_op_familia', len(estado.get('op', []))), ('rel.vw_op_etapas_equipamento', len(estado.get('op_etapas', []))),
                       ('rel.vw_op_materiais_rastreabilidade', len(estado.get('op_materiais', []))), ('rel.vw_entradas_material', len(estado.get('entradas', []))),
                       ('rel.vw_roteiro_recursos', len(estado.get('roteiro_recursos', []))), ('rel.vw_estrutura_produto', len(estado.get('estrutura', []))),
                       ('rel.vw_apontamentos_op', len(estado.get('producao', [])) + len(estado.get('perdas', []))), ('rel.vw_passaporte_op', len(estado.get('bp', []))),
                       ('rel.vw_colecoes', len(estado))]:
    n = v(f'SELECT COUNT(*) FROM {view}')
    ok(n == esperado, f'{view}: {n} linhas', esperado)
ok(v("SELECT COUNT(*) FROM rel.vw_op_etapas_equipamento WHERE cod_equipamento IS NOT NULL AND equipamento IS NOT NULL") > 0, 'correlação etapa da OP → equipamento resolvida', '')

# rel.fn_num = num() do frontend
for entrada, esperado in [('1.234,56', 1234.56), ('0,8956', 0.8956), ('R$ 637', 637), ('17.498999999999999', 17.499), ('-2,5', -2.5), ('', None), ('abc', None)]:
    r = v('SELECT rel.fn_num(%s)', entrada)
    ok((r is None and esperado is None) or (r is not None and esperado is not None and abs(float(r) - esperado) < 1e-6), f"rel.fn_num('{entrada}') = {esperado}", r)
ok(v('SELECT COUNT(*) FROM rel.relacionamentos') >= 70, 'catálogo de correlações (rel.relacionamentos)', v('SELECT COUNT(*) FROM rel.relacionamentos'))

print(f'\n== {total - len(falhas)}/{total} verificações OK')
if falhas:
    print('FALHAS:'); [print(' - ' + f) for f in falhas]
    sys.exit(1)
