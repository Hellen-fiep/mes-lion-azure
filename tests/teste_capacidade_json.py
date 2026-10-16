#!/usr/bin/env python3
"""
Teste no navegador do módulo CAPACIDADE E CARGA DE MÁQUINAS V1 (js/mes_capacidade_carga_v1.js) com o servidor:
configura a capacidade de um equipamento, confere que data.mes_capacidades e o histórico de capacidade
(data.mes_capacidade_historico) foram gravados no servidor, recarrega a página e calcula Carga × capacidade.

Uso: python teste_capacidade_json.py <url_base>
"""
import sys, os, json, asyncio
import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'), flush=True)
    if not c: falhas.append(f'{nome}: {det}')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo')
        page = await ctx.new_page()
        erros, dialogos = [], []
        page.on('pageerror', lambda e: erros.append(str(e)))
        page.on('dialog', lambda d: (dialogos.append(d.message), asyncio.ensure_future(d.accept())))
        await page.goto(BASE + '/', wait_until='load')
        await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026')
        await page.click('.login-card button')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1500)

        # Cadastro de Recursos > Capacidades das máquinas
        await page.evaluate("document.querySelectorAll('nav details').forEach(d=>d.open=true)")
        await page.click('#nav_cad_recursos')
        await page.wait_for_timeout(1000)
        tem_botao = await page.evaluate("[...document.querySelectorAll('#content button')].some(b => /Capacidades das m/.test(b.textContent))")
        atual = await page.evaluate("typeof current === 'undefined' ? null : current")
        ok(tem_botao, 'Cadastro de Recursos (menu) mostra o botão "Capacidades das máquinas"', atual)
        await page.evaluate("mesCapCadastro()")
        await page.wait_for_timeout(500)
        botoes = await page.query_selector_all('#content button:has-text("Configurar")')
        ok(len(botoes) > 0, f'lista de equipamentos para configurar ({len(botoes)})', '')
        codigo = await page.evaluate("document.querySelector('#content tbody tr td').textContent.trim()")
        await botoes[0].click()
        await page.wait_for_selector('#mcCap', timeout=5000)
        await page.select_option('#mcTipo', 'Contínua')
        for campo, valor in [('#mcCap', '120'), ('#mcCiclo', '0'), ('#mcSetup', '15'), ('#mcDia', '8'), ('#mcEf', '85'), ('#mcSim', '1'), ('#mcObs', 'Teste JSON ção')]:
            await page.fill(campo, valor)
        await page.click('button:has-text("Salvar capacidade")')
        await page.wait_for_timeout(2500)
        ok(not any('Confira capacidade' in d for d in dialogos), 'capacidade aceita pelo formulário', dialogos)

        ck = {c['name']: c['value'] for c in await ctx.cookies()}
        dados = requests.get(BASE + '/api/bootstrap', cookies=ck, timeout=180).json()['data']
        caps = [x for x in dados.get('mes_capacidades', []) if x.get('Codigo') == codigo]
        hist = [x for x in dados.get('mes_capacidade_historico', []) if x.get('Codigo') == codigo]
        ok(len(caps) == 1 and caps[0]['Capacidade'] == 120 and caps[0]['HorasDia'] == 8 and caps[0]['Eficiencia'] == 85 and caps[0]['Observacoes'] == 'Teste JSON ção',
           f'capacidade do equipamento {codigo} gravada no servidor (data.mes_capacidades)', caps)
        ok(len(hist) >= 1 and hist[-1]['Novo']['Capacidade'] == 120, 'histórico de alteração de capacidade gravado (data.mes_capacidade_historico)', hist[-1:])

        # recarrega (F5): sessão e dados vêm do servidor; relatório Carga × capacidade
        await page.reload(wait_until='load')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1500)
        await page.evaluate("mesCapRelatorio()")
        await page.wait_for_timeout(1000)
        linha = await page.evaluate(f"[...document.querySelectorAll('#mesCapResultado tbody tr')].map(t => t.textContent).find(t => t.startsWith({json.dumps(codigo)})) || ''")
        ok('Não cadastrada' not in linha and ('OK' in linha or 'Atenção' in linha or 'Sobrecarga' in linha), 'Carga × capacidade calculado com a capacidade gravada (após F5)', linha[:160])
        ok(not erros, 'nenhum erro JavaScript', erros[:3])
        await b.close()
    print(f'\n== {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print('FALHAS:'); [print(' - ' + f) for f in falhas]
        sys.exit(1)

asyncio.run(main())
