#!/usr/bin/env python3
"""
Primeira tela após o login: para CADA opção do menu, abre uma sessão nova do navegador, faz login e abre essa
tela como a primeira; depois recarrega a página (F5, sessão mantida) e abre a mesma tela de novo.
Nenhuma tela pode gerar erro JavaScript.

No MES LION 1.0 PGSQL, ACV e LCC falhavam exatamente nesse cenário (coleções criadas pelos módulos ao carregar
a página eram perdidas quando o estado vinha do servidor) — corrigido no adaptador js/mes_plataforma_azure.js.

Uso: python primeira_tela.py <url_base> [id_do_menu ...]   (sem ids: todas as opções do menu)
Requisitos: pip install playwright  (e um Chromium: python -m playwright install chromium)
"""
import sys, os, asyncio
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
SOMENTE = sys.argv[2:]
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)


async def sessao(b):
    ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo')
    page = await ctx.new_page()
    erros = []
    page.on('pageerror', lambda e: erros.append(str(e)))
    page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await page.goto(BASE + '/', wait_until='load')
    await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026')
    await page.click('.login-card button')
    await page.wait_for_selector('#app:not(.hidden)', timeout=90000)
    await page.wait_for_timeout(1000)
    return ctx, page, erros


async def abrir(page, nid):
    ok = await page.evaluate("id => { document.querySelectorAll('nav details').forEach(d => d.open = true);"
                             " const b = document.getElementById(id); if (b) { b.click(); return true; } return false; }", nid)
    if ok: await page.wait_for_timeout(800)
    return ok


async def main():
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else p.chromium.launch())
        ctx, page, _ = await sessao(b)
        navs = await page.evaluate("() => [...document.querySelectorAll('#nav button')].map(b => b.id).filter(Boolean)")
        if SOMENTE: navs = [n for n in navs if n in SOMENTE]
        await ctx.close()
        falhas = {}
        for nid in navs:
            ctx, page, erros = await sessao(b)
            n0 = len(erros)
            await abrir(page, nid)
            titulo = await page.evaluate("document.getElementById('title')?.textContent || ''")
            if erros[n0:]: falhas[nid] = erros[n0:]
            await page.reload(wait_until='load')
            await page.wait_for_selector('#app:not(.hidden)', timeout=90000)
            await page.wait_for_timeout(1000)
            n1 = len(erros)
            reaberta = await abrir(page, nid)
            if erros[n1:]: falhas[nid + ' (após F5)'] = erros[n1:]
            print(('  [OK]   ' if not (erros[n0:]) else '  [FALHA] ') + f'{nid:26s} {titulo[:45]:45s}' + ('' if reaberta else ' (após F5 a tela abre por outro menu)'))
            await ctx.close()
        await b.close()
    print(f'\n== {len(navs) - len({k.split(" ")[0] for k in falhas})}/{len(navs)} telas sem erro JavaScript como primeira tela (e após F5)')
    if falhas:
        print('FALHAS:'); [print(f' - {k}: {v[:2]}') for k, v in falhas.items()]
        return 1
    return 0

sys.exit(asyncio.run(main()))
