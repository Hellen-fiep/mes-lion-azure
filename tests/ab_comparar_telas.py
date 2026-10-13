#!/usr/bin/env python3
"""
Teste A/B de telas: abre o MES no servidor de REFERÊNCIA (contrato do servidor PowerShell original,
frontend original) e no servidor NOVO (ASP.NET Core), com os mesmos dados, percorre todos os módulos
do menu e compara título, subtítulo e o HTML renderizado de cada tela.
Uso: python ab_comparar_telas.py <url_referencia> <url_nova> <saida.json> [url_referencia_com_colecoes]

Telas corrigidas (ACV e LCC): no original elas dão erro porque as coleções criadas pelos módulos antes do
login se perdem quando o estado vem do servidor. O servidor novo traz a correção (no adaptador js/mes_plataforma_azure.js).
Para essas telas a comparação é feita com o MESMO frontend original servindo um estado que já contém essas
coleções vazias (url_referencia_com_colecoes): a tela nova precisa ser idêntica e sem erro JavaScript.
"""
import sys, json, re, asyncio, hashlib, difflib
from playwright.async_api import async_playwright

REF, NOVO, SAIDA = sys.argv[1], sys.argv[2], sys.argv[3]
REF_COL = sys.argv[4] if len(sys.argv) > 4 else None
CORRIGIDAS = ('nav_acv', 'nav_lcc')
import os
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)

# Diferenças conhecidas e intencionais introduzidas pelo adaptador de plataforma
NORMALIZAR = [
    (r'MES LION 1\.0 AZURE', 'MES LION 1.0 PGSQL'),
    (r'Usuários do MES \(SQL Server\)', 'Usuários PostgreSQL'),
]
VOLATEIS = [
    (r'\d{2}/\d{2}/\d{4},? \d{2}:\d{2}(:\d{2})?', '<DATAHORA>'),
    (r'\d{1,2}:\d{2}:\d{2}(\.\d+)?', '<HORA>'),   # inclui frações de segundo (instantes de criação diferem entre os servidores)
    (r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<GUID>'),
    (r'(OP|SIM|MRP|CAL|BLOQ|META|CAR|PCM|AT|CPI)-?\d{10,}', r'\1<TS>'),
]

def norm(html):
    s = html or ''
    for a, b in NORMALIZAR: s = re.sub(a, b, s)
    for a, b in VOLATEIS: s = re.sub(a, b, s)
    return s

async def percorrer(p, base):
    b = await (p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else p.chromium.launch())
    ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo')
    page = await ctx.new_page()
    erros = []
    page.on('pageerror', lambda e: erros.append(str(e)))
    page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await page.goto(base + '/', wait_until='load')
    await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026')
    await page.click('.login-card button')
    await page.wait_for_selector('#app:not(.hidden)', timeout=90000)
    await page.wait_for_timeout(2500)
    navs = await page.evaluate("() => [...document.querySelectorAll('#nav button')].map(b=>b.id).filter(Boolean)")
    telas = {}
    for nid in navs:
        e0 = len(erros)
        try:
            await page.evaluate("document.querySelectorAll('nav details').forEach(d=>d.open=true)")
            await page.click('#' + nid, timeout=15000)
            await page.wait_for_timeout(900)
        except Exception as ex:
            telas[nid] = {'erro_clique': str(ex)[:200]}; continue
        info = await page.evaluate("""() => ({titulo: document.getElementById('title')?.textContent || '',
            subtitulo: document.getElementById('subtitle')?.textContent || '',
            html: document.getElementById('content')?.innerHTML || ''})""")
        info['erros_js'] = erros[e0:]
        telas[nid] = info
    await b.close()
    return navs, telas, erros

async def main():
    async with async_playwright() as p:
        nav_r, ref, err_r = await percorrer(p, REF)
        nav_n, novo, err_n = await percorrer(p, NOVO)
        ref_col = (await percorrer(p, REF_COL))[1] if REF_COL else {}
    rel = {'menu_igual': nav_r == nav_n, 'menu_ref': nav_r, 'menu_novo': nav_n, 'telas': {}, 'erros_js_ref': err_r, 'erros_js_novo': err_n,
           'telas_corrigidas': list(CORRIGIDAS) if REF_COL else []}
    iguais = 0
    for nid in nav_r:
        corrigida = bool(REF_COL) and nid in CORRIGIDAS
        a, b = (ref_col if corrigida else ref).get(nid, {}), novo.get(nid, {})
        ha, hb = norm(a.get('html')), norm(b.get('html'))
        ok = (norm(a.get('titulo')) == norm(b.get('titulo')) and norm(a.get('subtitulo')) == norm(b.get('subtitulo')) and ha == hb
              and len(a.get('erros_js', [])) == len(b.get('erros_js', [])))
        if corrigida: ok = ok and not b.get('erros_js')
        iguais += ok
        item = {'igual': ok, 'titulo': a.get('titulo'), 'bytes_ref': len(ha), 'bytes_novo': len(hb),
                'sha_ref': hashlib.sha256(ha.encode()).hexdigest()[:16], 'sha_novo': hashlib.sha256(hb.encode()).hexdigest()[:16],
                'erros_js_ref': a.get('erros_js'), 'erros_js_novo': b.get('erros_js')}
        if corrigida:
            item['referencia'] = 'frontend original com as coleções do módulo inicializadas'
            item['erros_js_original_sem_correcao'] = ref.get(nid, {}).get('erros_js')
        if not ok:
            item['diff'] = list(difflib.unified_diff(re.sub(r'>', '>\n', ha).splitlines(), re.sub(r'>', '>\n', hb).splitlines(), lineterm='', n=1))[:60]
        rel['telas'][nid] = item
    rel['resumo'] = f'{iguais}/{len(nav_r)} telas idênticas'
    json.dump(rel, open(SAIDA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(rel['resumo'], '| menu igual:', rel['menu_igual'])
    for nid, it in rel['telas'].items():
        extra = f"  [corrigida: original sem correção tinha {len(it.get('erros_js_original_sem_correcao') or [])} erro(s) JS]" if 'referencia' in it else ''
        print(('  OK   ' if it['igual'] else '  DIFF ') + f"{nid:28s} {str(it['titulo'])[:40]:40s} ref={it['bytes_ref']} novo={it['bytes_novo']} errosJS ref={len(it['erros_js_ref'] or [])} novo={len(it['erros_js_novo'] or [])}{extra}")
    return 0 if rel['menu_igual'] and iguais == len(nav_r) and nav_r else 1

sys.exit(asyncio.run(main()))
