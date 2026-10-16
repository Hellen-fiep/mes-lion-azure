#!/usr/bin/env python3
"""
Teste ponta a ponta (navegador real, Playwright) dos fluxos principais do MES LION no servidor novo:
login, cadastro com anexo, persistência após recarregar, documentos de equipamento, ACV e LCC (estudos,
cenários, AICV, ICV, LCC), apontamento de tempo, usuários, backup/exportação, histórico, logout, sessão de
outro usuário e envio compactado em acesso remoto.

Uso: python e2e_fluxos.py <url_base> [url_remota_para_teste_gzip]
Requisitos: pip install playwright requests  (e um Chromium: python -m playwright install chromium)
"""
import sys, os, re, json, time, asyncio, tempfile, uuid
import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
REMOTA = sys.argv[2].rstrip('/') if len(sys.argv) > 2 else None
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0
ERROS_CONHECIDOS = ()  # nenhum: o erro herdado de ACV/LCC foi corrigido (js/mes_plataforma_azure.js; na versão JSON, adaptador do servidor)
SEL_ULTIMO = "(s=>{s.selectedIndex=s.options.length-1;s.dispatchEvent(new Event('change'))})(document.getElementById('%s'))"


def ok(cond, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if cond else '  [FALHA] ') + nome + ('' if cond else f' -> {det}'))
    if not cond: falhas.append(f'{nome}: {det}')


async def abrir_modulo(page, nav_id):
    await page.evaluate("document.querySelectorAll('nav details').forEach(d=>d.open=true)")
    await page.click('#' + nav_id)
    await page.wait_for_timeout(700)


async def menu_banco(page, item):
    """Abre o menu "Banco ▾" do cabeçalho (se estiver fechado) e clica no item."""
    if not await page.evaluate("document.querySelector('.v40-db-advanced').open"):
        await page.click('summary:has-text("Banco")')
    await page.click('text=' + item)


async def login(page, usuario, senha):
    await page.goto(BASE + '/', wait_until='load')
    await page.fill('#user', usuario); await page.fill('#pass', senha)
    await page.click('.login-card button')
    await page.wait_for_selector('#app:not(.hidden)', timeout=90000)
    await page.wait_for_timeout(1500)


async def main():
    tmp = tempfile.mkdtemp()
    pdf_path = os.path.join(tmp, 'Ficha técnica qualificação.pdf')
    pdf = b'%PDF-1.4\n' + os.urandom(3000) + b'\n%%EOF\n'
    open(pdf_path, 'wb').write(pdf)
    codigo = 'MPE2E' + uuid.uuid4().hex[:5].upper()
    novo_usuario = 'e2e_' + uuid.uuid4().hex[:6]

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
        page = await ctx.new_page()
        erros, dialogos = [], []
        page.on('pageerror', lambda e: erros.append(str(e)))
        page.on('dialog', lambda d: (dialogos.append(d.message), asyncio.ensure_future(d.accept())))

        # 1) login e tela inicial
        await page.goto(BASE + '/', wait_until='load')
        info = await page.wait_for_selector('#mesPlataformaInfo', timeout=10000)
        ok('Banco:' in (await info.inner_text()), 'tela de login mostra servidor/banco ativos', await info.inner_text())
        ok(await page.title() == 'MES LION 1.0 AZURE — SQL Server / Multiusuário' or 'AZURE' in await page.title() or 'MES LION 1.0 JSON' in await page.title(), 'título da plataforma', await page.title())
        await login(page, 'admin', 'meslion2026')
        ok(await page.is_visible('#nav'), 'login admin e menu carregado', '')
        ok(not await page.is_visible('#fatalErrorBanner'), 'sem erro fatal após login', erros)

        # 2) cadastro de material com anexo de qualificação (/api/attachments)
        await abrir_modulo(page, 'nav_materiais')
        await page.click('text=+ Novo cadastro'); await page.wait_for_timeout(400)
        codigo = await page.input_value('#v47_mat_cod')  # código automático (somente leitura), como no original
        await page.fill('#v47_mat_desc', 'Material E2E ção')
        await page.fill('#v47_mat_um', 'kg')
        await page.select_option('#v47_mat_cat', index=1)
        await page.check('#v47_mat_qual')
        await page.set_input_files('#v47_mat_files', pdf_path)
        n_dialogos = len(dialogos)
        await page.click('text=Salvar cadastro')
        await page.wait_for_timeout(2500)
        html = await page.inner_html('#content')
        ok(codigo in html, 'material salvo e listado', dialogos[n_dialogos:])
        ok(not any('Falha' in d or 'Erro' in d or 'erro' in d for d in dialogos[n_dialogos:]), 'sem alerta de erro ao salvar (anexo enviado)', dialogos[n_dialogos:])

        # 3) recarregar a página: sessão mantida e dado persistido no banco
        await page.wait_for_timeout(1500)  # gravação assíncrona (debounce de 450 ms do frontend)
        await page.reload(wait_until='load')
        await page.wait_for_selector('#app:not(.hidden)', timeout=90000)
        await page.wait_for_timeout(1500)
        ok(await page.is_hidden('#login'), 'recarregar mantém a sessão (cookie MESSESSION)', '')
        await abrir_modulo(page, 'nav_materiais')
        html = await page.inner_html('#content')
        ok(codigo in html, 'material persiste após recarregar (gravado no banco)', '')
        cookies = {c['name']: c['value'] for c in await ctx.cookies()}
        estado = requests.get(BASE + '/api/bootstrap', cookies=cookies).json()['data']
        mat = next((m for m in estado.get('materiais', []) if m.get('CódigoMaterial') == codigo), None)
        ok(mat is not None, 'material presente no estado do servidor', '')
        anexos = [v for v in (mat or {}).values() if isinstance(v, list) and v and isinstance(v[0], dict) and 'Url' in v[0]]
        url = anexos[0][0]['Url'] if anexos else ''
        r = requests.get(BASE + url, cookies=cookies) if url else None
        ok(r is not None and r.status_code == 200 and r.content == pdf, 'anexo do material gravado e baixado íntegro', url)

        # 4) documento de equipamento (Cadastro de Recursos)
        await abrir_modulo(page, 'nav_cad_recursos')
        opcoes = await page.eval_on_selector_all('#eqv2 option', 'os => os.map(o => o.value).filter(Boolean)')
        eq = opcoes[0] if opcoes else None
        ok(eq is not None, 'lista de equipamentos no Cadastro de Recursos', opcoes[:3])
        if eq:
            await page.select_option('#eqv2', eq); await page.wait_for_timeout(700)
            await page.fill('#doc_type', 'Checklist E2E'); await page.fill('#doc_rev', 'R1')
            await page.set_input_files('#doc_file', pdf_path)
            await page.click('text=Enviar documento'); await page.wait_for_timeout(1500)
            eqdocs = await page.inner_text('#eqdocs')
            ok('Ficha técnica qualificação.pdf' in eqdocs and 'Checklist E2E' in eqdocs, 'documento PDF enviado e listado no equipamento', eqdocs[:200])

        # 4b) ACV e LCC — antes da correção, abrir ou salvar nesses módulos dava erro com a base do servidor
        ev = page.evaluate
        n_err = len(erros)
        await abrir_modulo(page, 'nav_acv')
        await ev("acvStudiesV110()"); await ev("acvStudyFormV110()")
        await page.fill('#a_nome', 'Estudo ACV E2E'); await page.select_option('#a_op', index=1)
        await ev("saveACVStudyV110()")
        await ev("acvScenariosV110()"); await ev(SEL_ULTIMO % 'as_st'); await page.fill('#as_nome', 'Base E2E')
        await ev("saveACVScenarioV110()")
        await ev("acvAICVV110()"); await ev(SEL_ULTIMO % 'ai_st'); await page.wait_for_timeout(200)
        await ev("runAICVV110()"); await page.wait_for_timeout(400)
        await ev("acvICVV110()"); await page.select_option('#icv_op', index=1); await ev("showICVV113()")
        await ev("saveICVSnapshotV113()"); await ev("acvDashboardV110()"); await page.wait_for_timeout(300)
        acv = await ev("({e:data.acv_estudos.length, c:data.acv_cenarios.length, r:data.acv_resultados.length, i:data.acv_icv_salvos.length})")
        ok(acv['e'] >= 1 and acv['c'] >= 1 and acv['r'] >= 1 and acv['i'] >= 1 and len(erros) == n_err,
           'ACV: dashboard, estudo, cenário, AICV e ICV sem erro', (acv, erros[n_err:]))
        await abrir_modulo(page, 'nav_lcc')
        await ev("lccStudiesV110()"); await page.fill('#ls_nome', 'Estudo LCC E2E'); await page.select_option('#ls_op', index=1)
        await ev("saveLCCStudyV110()")
        await ev("lccInventoryV110()"); await page.select_option('#li_op', index=1); await ev("showLCCInvV110()")
        await ev("lccScenariosV110()"); await ev(SEL_ULTIMO % 'lc_st'); await page.fill('#lc_nome', 'Base E2E')
        await ev("saveLCCScenarioV110()")
        await ev("lccScenariosV110()"); await ev(SEL_ULTIMO % 'lc_st'); await ev("runLCCV110()"); await page.wait_for_timeout(400)
        await ev("lccDashboardV110()"); await page.wait_for_timeout(300)
        lcc = await ev("({e:data.lcc_estudos.length, c:data.lcc_cenarios.length, r:data.lcc_resultados.length})")
        ok(lcc['e'] >= 1 and lcc['c'] >= 1 and lcc['r'] >= 1 and len(erros) == n_err,
           'LCC: dashboard, estudo, inventário, cenário e cálculo sem erro', (lcc, erros[n_err:]))
        await abrir_modulo(page, 'nav_producao')
        if await ev("!!document.getElementById('prod_op') && typeof v1014IniciarApontamento === 'function'"):
            await page.select_option('#prod_op', index=1)
            await ev("document.getElementById('prod_op').dispatchEvent(new Event('change'))"); await page.wait_for_timeout(300)
            n_ap = await ev("(data.apontamento_tempos || []).length")
            await ev("v1014IniciarApontamento()"); await page.wait_for_timeout(300)
            ok(await ev("(data.apontamento_tempos || []).length") == n_ap + 1 and len(erros) == n_err,
               'apontamento de tempo iniciado sem erro', erros[n_err:])
        await page.wait_for_timeout(1500)  # gravação assíncrona
        est = requests.get(BASE + '/api/bootstrap', cookies={c['name']: c['value'] for c in await ctx.cookies()}).json()['data']
        ok(len(est.get('acv_estudos', [])) >= 1 and len(est.get('acv_resultados', [])) >= 1 and len(est.get('lcc_resultados', [])) >= 1,
           'ACV e LCC gravados no banco do servidor', {k: len(est.get(k, [])) for k in ('acv_estudos', 'acv_resultados', 'lcc_resultados')})

        # 5) usuários
        await abrir_modulo(page, 'nav_usuarios')
        await page.click('text=+ Novo usuário'); await page.wait_for_timeout(300)
        await page.fill('#u_user', novo_usuario); await page.fill('#u_name', 'Usuário E2E'); await page.fill('#u_pass', 'Teste@2026')
        await page.select_option('#u_role', 'USER')
        await page.click('#crudBox >> text=Salvar'); await page.wait_for_timeout(1200)
        ok(novo_usuario in await page.inner_text('#content'), 'usuário criado pela tela de Usuários', '')

        # 6) menu Banco: backup e exportação (rotas que não existiam no servidor PowerShell)
        await abrir_modulo(page, 'nav_processos')  # o cabeçalho (menu Banco) fica oculto no modo Dashboard (igual ao original)
        n_dialogos = len(dialogos)
        await menu_banco(page, 'Criar backup'); await page.wait_for_timeout(2500)
        ok(any('Backup criado com sucesso' in d for d in dialogos[n_dialogos:]), 'Criar backup', dialogos[n_dialogos:])
        async with page.expect_download(timeout=60000) as dl:
            await menu_banco(page, 'Exportar banco')
        d = await dl.value
        caminho = await d.path()
        exp = json.load(open(caminho, encoding='utf-8'))
        ok(d.suggested_filename.startswith('MES_LION_BANCO_') and exp.get('format') == 'MES_LION_JSON_DATABASE', 'Exportar banco (download .json)', d.suggested_filename)

        # 7) histórico de modificações
        await abrir_modulo(page, 'nav_auditoria')
        hist = await page.inner_text('#content')
        ok('SAVE_STATE' in hist and 'UPLOAD_DOCUMENT' in hist and 'BACKUP' in hist, 'histórico registra gravações, documentos e backup', hist[:200])

        # 8) logout e login com o novo usuário (perfil USER)
        await page.click('button.logout'); await page.wait_for_timeout(1500)
        ok(await page.is_visible('#login'), 'logout volta para a tela de login', '')
        await login(page, novo_usuario, 'Teste@2026')
        await abrir_modulo(page, 'nav_usuarios')
        ok('restrito' in (await page.inner_text('#content')).lower(), 'perfil USER sem acesso à administração de usuários', '')
        await page.click('button.logout'); await page.wait_for_timeout(1000)

        # 9) Restaurar dados iniciais: agora cria backup antes (no PowerShell o backup falhava)
        await login(page, 'admin', 'meslion2026')
        await abrir_modulo(page, 'nav_processos')
        n_bk = len(requests.get(BASE + '/api/backups', cookies={c['name']: c['value'] for c in await ctx.cookies()}).json())
        n_dialogos = len(dialogos)
        await menu_banco(page, 'Restaurar dados iniciais'); await page.wait_for_timeout(3000)
        n_bk2 = len(requests.get(BASE + '/api/backups', cookies={c['name']: c['value'] for c in await ctx.cookies()}).json())
        ok(n_bk2 == n_bk + 1 and any('Backup criado com sucesso' in x for x in dialogos[n_dialogos:]), 'Restaurar dados iniciais cria backup antes', (n_bk, n_bk2, dialogos[n_dialogos:]))

        inesperados = [e for e in erros if not any(k in e for k in ERROS_CONHECIDOS)]
        ok(not inesperados, 'nenhum erro JavaScript inesperado', inesperados[:5])
        await ctx.close()

        # 10) acesso remoto: o adaptador compacta (gzip) o envio do estado
        if REMOTA:
            ctx2 = await b.new_context(viewport={'width': 1400, 'height': 900})
            pg = await ctx2.new_page()
            encs = []
            pg.on('request', lambda r: encs.append(r.headers.get('content-encoding')) if r.method == 'PUT' and r.url.endswith('/api/storage/MES_LION_DATA') else None)
            pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(REMOTA + '/', wait_until='load')
            await pg.fill('#user', 'admin'); await pg.fill('#pass', 'meslion2026'); await pg.click('.login-card button')
            await pg.wait_for_selector('#app:not(.hidden)', timeout=90000)
            await pg.wait_for_timeout(1500)
            marca = 'GZIP' + uuid.uuid4().hex[:6]
            await pg.evaluate(f"data.meta = data.meta || {{}}; data.meta.testeGzip = '{marca}'; saveLocal();")
            await pg.wait_for_timeout(4000)
            ck = {c['name']: c['value'] for c in await ctx2.cookies()}
            meta = requests.get(REMOTA + '/api/bootstrap', cookies=ck).json()['data'].get('meta', {})
            ok('gzip' in encs and meta.get('testeGzip') == marca, 'acesso remoto: estado enviado compactado (gzip) e gravado', (encs, meta.get('testeGzip')))
            await ctx2.close()
        await b.close()

    print(f'\n== {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print('FALHAS:'); [print(' - ' + f) for f in falhas]
        sys.exit(1)

asyncio.run(main())
