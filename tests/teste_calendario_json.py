#!/usr/bin/env python3
"""
Teste no navegador do Calendário de Produção da versão JSON (correções do server/adaptador_frontend.js):
  - "Editar dia" abre com clique real do mouse (apertar e soltar com intervalo, como uma pessoa) e grava
    Liberar expediente / Bloquear dia no servidor; a tela do calendário fica estável (sem redesenho contínuo);
  - "Sugerir programação por data inicial": nenhuma operação em sábado, domingo, feriado ou dia bloqueado (o sábado
    liberado é usado), trechos de trabalho (Segmentos) gravados no servidor e mantidos depois de recarregar (F5);
  - cartão em tempo corrido sobre um sábado (programação antiga) aparece em "Validar conflitos";
  - Plano de Produção > "Projetar sequência pelas datas já informadas" só em dias e horários de trabalho, inclusive
    com sábado liberado só para uma linha de produção;
  - Programação > "Recalcular programação" abre a sugestão de programação sem erro; "Limpar datas" limpa os trechos.

Uso: python teste_calendario_json.py <url_base>
"""
import sys, os, re, json, asyncio, time, datetime
import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0

LIBERADO = '2026-10-17'      # sábado liberado em "Editar dia"
LIBERADO_LINHA = '2026-10-24'  # sábado liberado só para a linha Prismática — Piloto (a das OPs dos dados de teste)
LIBERADOS = {LIBERADO}
BLOQUEADO = '2026-10-21'     # quarta-feira bloqueada em "Editar dia"
MOTIVO_BLOQUEIO = 'Manutenção preventiva teste'
FIXOS = {'01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'}


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'), flush=True)
    if not c: falhas.append(f'{nome}: {str(det)[:400]}')


def pascoa(y):
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    return datetime.date(y, (h + l - 7 * m + 114) // 31, (h + l - 7 * m + 114) % 31 + 1)


def disponivel(d):
    iso = d.isoformat()
    if iso in LIBERADOS: return True
    if iso == BLOQUEADO: return False
    if iso[5:] in FIXOS or d == pascoa(d.year) - datetime.timedelta(days=2): return False
    return d.weekday() < 5


def dt(s):
    m = re.match(r'^(\d{2})/(\d{2})/(\d{4})\D+(\d{2}):(\d{2})', str(s or ''))
    return datetime.datetime(int(m[3]), int(m[2]), int(m[1]), int(m[4]), int(m[5])) if m else None


def problemas_programacao(cartoes):
    """Cada cartão programado: trechos (Segmentos) coerentes com Início/Fim, cada trecho num dia disponível e dentro de uma
    janela 08–12/13–17, somando os minutos da operação. Sem Segmentos, o próprio Início–Fim tem de caber numa janela
    (é o caso de operação curta, igual com ou sem trechos)."""
    erros, programados = [], 0
    for p in cartoes:
        if not p.get('Inicio'): continue
        programados += 1
        nome = f"{p.get('OP')} etapa {p.get('Ordem')} rec {p.get('RecursoRoteiro') or p.get('Recurso')}"
        a, b = dt(p.get('Inicio')), dt(p.get('Fim'))
        segs = p.get('Segmentos') or [{'Inicio': p.get('Inicio'), 'Fim': p.get('Fim')}]
        if not a or not b or dt(segs[0]['Inicio']) != a or dt(segs[-1]['Fim']) != b:
            erros.append(f'{nome}: trechos não batem com Início/Fim')
        soma = 0
        for s in segs:
            x, y = dt(s['Inicio']), dt(s['Fim'])
            if not x or not y or y <= x or x.date() != y.date():
                erros.append(f'{nome}: trecho inválido ou sem trechos ({s["Inicio"]} → {s["Fim"]})'); continue
            soma += (y - x).total_seconds() / 60
            if not disponivel(x.date()):
                erros.append(f'{nome}: trecho em dia indisponível {x:%d/%m/%Y %a}')
            jan = [(8, 12), (13, 17)]
            if not any(datetime.time(h1) <= x.time() and y.time() <= datetime.time(h2) for h1, h2 in jan):
                erros.append(f'{nome}: trecho fora do expediente {x:%d/%m %H:%M}–{y:%H:%M}')
        if abs(soma - float(str(p.get('Minutos') or 0).replace(',', '.'))) > 1:
            erros.append(f'{nome}: trechos somam {soma:.0f} min, operação tem {p.get("Minutos")} min')
    return erros, programados


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo')
        page = await ctx.new_page()
        erros_js, dialogos = [], []
        page.on('pageerror', lambda e: erros_js.append(str(e)))
        page.on('dialog', lambda d: (dialogos.append(d.message), asyncio.ensure_future(d.accept())))

        async def dados_servidor():
            ck = {c['name']: c['value'] for c in await ctx.cookies()}
            return requests.get(BASE + '/api/bootstrap', cookies=ck, timeout=180).json()['data']

        async def esperar_servidor(cond, segundos=20):
            fim = time.time() + segundos
            d = None
            while time.time() < fim:
                d = await dados_servidor()
                try:
                    if cond(d): return d, True
                except Exception:
                    pass
                await page.wait_for_timeout(700)
            return d, False

        async def clique_humano(loc):
            # como uma pessoa: leva o mouse até o botão, aperta, espera um instante e solta (o botão precisa continuar o mesmo)
            await loc.evaluate("e => e.scrollIntoView({block: 'center', inline: 'center'})")
            await page.wait_for_timeout(150)
            alvo_ok = await loc.evaluate("e => { const r = e.getBoundingClientRect(); const x = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!x && (x === e || e.contains(x)); }")
            if not alvo_ok:
                raise RuntimeError('o botão está coberto por outro elemento: ' + await loc.inner_text())
            bb = await loc.bounding_box()
            await page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2, steps=4)
            await page.mouse.down()
            await page.wait_for_timeout(160)
            await page.mouse.up()

        async def abrir_mes(ano_mes):
            await page.evaluate("(m) => { if (typeof render === 'function' && document.getElementById('title').textContent.indexOf('Calend') < 0) render('pcp_calendario'); }", ano_mes)
            await page.wait_for_timeout(300)
            await page.evaluate("(m) => { const i = document.getElementById('pcp_month_pick'); i.value = m; i.dispatchEvent(new Event('change', {bubbles: true})); }", ano_mes)
            await page.wait_for_timeout(700)

        def celula(dia):
            return page.locator('section.pcp-day-v2314:not(.outside)').filter(has=page.locator('header b', has_text=re.compile(rf'^{dia}$'))).first

        async def mapa_celulas():
            cel = await page.evaluate("""() => [...document.querySelectorAll('section.pcp-day-v2314:not(.outside)')].map(c => [
                Number(c.querySelector('header b').textContent), {faixa: c.querySelector('.mes-auto-block')?.textContent || '', botoes: c.querySelectorAll('.mes-edit-day').length,
                cartoes: c.querySelectorAll('.pcp-card-v2317').length}])""")
            return {int(k): v for k, v in cel}

        async def conferir_tela(ano, mes, rotulo):
            await abrir_mes(f'{ano}-{mes:02d}')
            cel = await mapa_celulas()
            ruins = [d for d, v in cel.items() if v['cartoes'] and not disponivel(datetime.date(ano, mes, int(d)))]
            ok(not ruins, f'{rotulo}: {mes:02d}/{ano} sem operações em dias indisponíveis', {d: cel[d] for d in ruins})
            return cel

        # ---------------------------------------------------------------- entrada e calendário
        await page.goto(BASE + '/', wait_until='load')
        await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026')
        await page.click('.login-card button')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1500)
        await page.evaluate("render('pcp_calendario')")
        await page.wait_for_timeout(500)
        await abrir_mes('2026-10')
        await page.wait_for_timeout(600)
        mut = await page.evaluate("""() => new Promise(res => { let c = 0; const o = new MutationObserver(m => c += m.length);
            o.observe(document.getElementById('content'), {childList: true, subtree: true}); setTimeout(() => { o.disconnect(); res(c) }, 1500) })""")
        ok(mut == 0, 'calendário estável (sem redesenho contínuo da tela)', f'{mut} alterações em 1,5 s')
        cel = await mapa_celulas()
        ok(len(cel) == 31 and all(v['botoes'] == 1 for v in cel.values()), 'um botão "Editar dia" em cada dia de outubro/2026', cel)
        ok(cel[17]['faixa'] == 'INDISPONIVEL · Sabado' and cel[18]['faixa'] == 'INDISPONIVEL · Domingo' and cel[12]['faixa'] == 'INDISPONIVEL · Nossa Senhora Aparecida'
           and cel[16]['faixa'] == '', 'sábados, domingos e feriado marcados como indisponíveis', {k: cel[k]['faixa'] for k in (12, 16, 17, 18)})

        # ---------------------------------------------------------------- Editar dia (clique real)
        await clique_humano(celula(17).locator('.mes-edit-day'))
        await page.wait_for_timeout(400)
        aberto = await page.evaluate("!!document.querySelector('#mes-edit-day-dialog[open]')")
        rot = await page.evaluate("document.querySelector('#mes-day-label')?.textContent || ''")
        ok(aberto and LIBERADO in rot, '"Editar dia" abre a janela de disponibilidade com clique do mouse', rot)
        if aberto:
            await page.select_option('#mes-day-mode', 'LIBERAR')
            await page.fill('#mes-day-reason', 'Hora extra teste')
            await clique_humano(page.locator('#mes-day-save'))
            await page.wait_for_timeout(700)
        cel = await mapa_celulas()
        ok(cel[17]['faixa'] == '' and cel[17]['botoes'] == 1, 'sábado 17/10 liberado (faixa INDISPONIVEL some)', cel[17])
        await clique_humano(celula(21).locator('.mes-edit-day'))
        await page.wait_for_timeout(400)
        if await page.evaluate("!!document.querySelector('#mes-edit-day-dialog[open]')"):
            await page.select_option('#mes-day-mode', 'BLOQUEAR')
            await page.fill('#mes-day-reason', MOTIVO_BLOQUEIO)
            await clique_humano(page.locator('#mes-day-save'))
            await page.wait_for_timeout(700)
        cel = await mapa_celulas()
        ok(cel[21]['faixa'] == 'INDISPONIVEL · ' + MOTIVO_BLOQUEIO, 'quarta 21/10 bloqueada em "Editar dia"', cel[21])

        def excecoes_ok(d):
            ex = {(x['Data'], x['Linha']): x for x in ((d.get('meta') or {}).get('calendarioExcecoes') or [])}
            return ex.get((LIBERADO, 'Todas'), {}).get('Tipo') == 'Liberar' and ex.get((BLOQUEADO, 'Todas'), {}).get('Tipo') == 'Bloquear'
        d, sim = await esperar_servidor(excecoes_ok)
        ok(sim, 'exceções do calendário gravadas no servidor (data.meta.calendarioExcecoes)', (d.get('meta') or {}).get('calendarioExcecoes') if d else None)

        # ---------------------------------------------------------------- Sugerir programação por data inicial
        await clique_humano(page.locator('button:has-text("Sugerir programação por data inicial")'))
        await page.wait_for_selector('#mes-proj-dialog[open]', timeout=5000)
        await page.fill('#mes-proj-date', '2026-10-16')
        await clique_humano(page.locator('#mes-proj-dialog button:has-text("Calcular proposta")'))
        await page.wait_for_timeout(800)
        res = await page.inner_text('#mes-proj-result')
        m = re.search(r'(\d+) operações propostas; (\d+) pendências', res)
        ok(m and int(m[1]) > 0 and m[2] == '0', 'sugestão de programação calculada sem pendências', res[:300])
        conf = page.locator('#mes-proj-result button:has-text("Confirmar e salvar")')
        ok(await conf.is_enabled(), 'proposta pode ser confirmada', res[:300])
        await clique_humano(conf)
        await page.wait_for_timeout(1000)
        cel10 = await conferir_tela(2026, 10, 'calendário após a sugestão')
        ok(cel10[17]['cartoes'] > 0, 'sábado liberado (17/10) recebeu operações', cel10[17])
        await conferir_tela(2026, 11, 'calendário após a sugestão')

        def todos_com_trechos(d):
            pr = d.get('pcp_programacao') or []
            return pr and all(p.get('Inicio') and p.get('Segmentos') for p in pr)
        d, sim = await esperar_servidor(todos_com_trechos)
        prob, n = problemas_programacao(d.get('pcp_programacao') or [])
        ok(sim and n > 0 and not prob, f'servidor: {n} operações programadas com trechos só em dias e horários de trabalho', prob[:6])
        guardados = (d.get('meta') or {}).get('pcpSegmentos') or {}
        ok(len(guardados) == n, 'trechos guardados também em data.meta.pcpSegmentos', f'{len(guardados)} de {n}')

        # ---------------------------------------------------------------- F5: continua igual
        await page.reload(wait_until='load')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1500)
        await page.evaluate("render('pcp_calendario')")
        await page.wait_for_timeout(400)
        await conferir_tela(2026, 10, 'depois de recarregar (F5)')
        await conferir_tela(2026, 11, 'depois de recarregar (F5)')
        await page.wait_for_timeout(2500)
        d = await dados_servidor()
        prob, n2 = problemas_programacao(d.get('pcp_programacao') or [])
        sem = [p.get('OP') for p in d.get('pcp_programacao') or [] if p.get('Inicio') and not p.get('Segmentos')]
        ok(n2 == n and not prob and not sem, 'servidor depois do F5: trechos mantidos (o calendário reconstrói os cartões e os trechos voltam)', prob[:6] or sem[:6])

        # ---------------------------------------------------------------- programação feita pela versão anterior (trechos não gravados)
        d = await dados_servidor()
        for p in d.get('pcp_programacao') or []: p.pop('Segmentos', None)
        (d.get('meta') or {}).pop('pcpSegmentos', None)
        await page.goto('about:blank')
        ck = {c['name']: c['value'] for c in await ctx.cookies()}
        r = requests.put(BASE + '/api/storage/MES_LION_DATA', data=json.dumps(d, ensure_ascii=False).encode('utf-8'), cookies=ck,
                         headers={'Content-Type': 'application/json; charset=utf-8'}, timeout=180)
        ok(r.status_code == 200, 'dados com a programação sem trechos (como gravava a versão anterior) enviados ao servidor', r.status_code)
        await page.goto(BASE + '/', wait_until='load')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1500)
        await page.evaluate("render('pcp_calendario')")
        await page.wait_for_timeout(400)
        await conferir_tela(2026, 10, 'programação da versão anterior')
        await conferir_tela(2026, 11, 'programação da versão anterior')
        d, sim = await esperar_servidor(lambda d: not problemas_programacao(d.get('pcp_programacao') or [])[0])
        prob, n4 = problemas_programacao(d.get('pcp_programacao') or [])
        ok(sim and n4 == n, 'programação da versão anterior: trechos recalculados para todas as operações (servidor)', prob[:6])

        # ---------------------------------------------------------------- Validar conflitos
        dialogos.clear()
        await clique_humano(page.locator('button:has-text("Validar conflitos")'))
        await page.wait_for_timeout(1200)
        msg = dialogos[-1] if dialogos else ''
        ok('nenhum conflito' in msg, 'Validar conflitos: programação sugerida validada sem conflitos', msg[:400])

        # cartão em tempo corrido sobre o sábado 24/10 (como a projeção antiga do Plano fazia)
        alvo = await page.evaluate("""() => {
            const ps = data.pcp_programacao.filter(p => Number(p.Minutos) <= 600).sort((a, b) => Number(a.Minutos) - Number(b.Minutos));
            const p = ps[0]; const i = data.pcp_programacao.indexOf(p);
            const fim = new Date(2026, 9, 24, 8, 0); fim.setMinutes(fim.getMinutes() + Number(p.Minutos));
            const f = d => String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() + ', ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
            p.Inicio = '24/10/2026, 08:00'; p.Fim = f(fim); saveLocal();
            return {i, op: p.OP, ordem: p.Ordem, temTrechos: 'Segmentos' in p};
        }""")
        ok(not alvo['temTrechos'], 'cartão alterado à mão perde os trechos antigos', alvo)
        dialogos.clear()
        await abrir_mes('2026-10')
        cel = await mapa_celulas()
        ok(cel[24]['cartoes'] == 1, 'cartão em tempo corrido aparece no sábado 24/10', cel[24])
        await clique_humano(page.locator('button:has-text("Validar conflitos")'))
        await page.wait_for_timeout(1200)
        msg = dialogos[-1] if dialogos else ''
        ok('dia indisponível' in msg and '24/10/2026 (Sabado)' in msg and f"OP {alvo['op']}" in msg, 'Validar conflitos acusa a operação no sábado indisponível', msg[:400])
        marca = await page.evaluate(f"data.pcp_programacao.find(p => p.OP === {json.dumps(alvo['op'])} && String(p.Ordem) === {json.dumps(str(alvo['ordem']))} && p.Inicio === '24/10/2026, 08:00')?.ConflitoPendente")
        ok(marca == 'INDISPONIBILIDADE', 'cartão no sábado marcado com INDISPONIBILIDADE', marca)

        # cartão programado antes da correção (sem trechos gravados) volta a ter trechos quando segue o calendário
        rec = await page.evaluate("""() => {
            if (typeof mesAlocarNoCalendario !== 'function') return {fim: '', trechos: ['mesAlocarNoCalendario ausente']};
            const p = data.pcp_programacao.find(x => Number(x.Minutos) >= 120 && Number(x.Minutos) <= 900 && x.Inicio !== '24/10/2026, 08:00');
            const s = mesAlocarNoCalendario('23/10/2026, 16:00', Number(p.Minutos), p.RecursoRoteiro || p.Recurso, 'Todas');
            const f = d => String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() + ', ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
            p.Inicio = f(s.start); p.Fim = f(s.end); delete p.Segmentos; saveLocal();
            return {fim: p.Fim, trechos: (p.Segmentos || []).map(g => g.Inicio + ' - ' + g.Fim)};
        }""")
        ok(len(rec['trechos']) >= 2 and rec['trechos'][0].startswith('23/10/2026, 16:00') and rec['trechos'][1].startswith('26/10/2026, 08:00'),
           'trechos recalculados para cartão que segue o calendário (sexta 16:00 → segunda)', rec)

        # ---------------------------------------------------------------- Plano: Projetar sequência pelas datas já informadas
        dialogos.clear()
        await page.evaluate("render('pcp_plano')")
        await page.wait_for_timeout(800)
        await clique_humano(page.locator('button:has-text("Projetar sequência pelas datas já informadas")'))
        await page.wait_for_timeout(1500)
        ok(not dialogos, 'Projetar sequência sem avisos de falta de janela', dialogos[:2])
        d, sim = await esperar_servidor(lambda d: not problemas_programacao(d.get('pcp_programacao') or [])[0] and
                                        not any(p.get('Inicio') == '24/10/2026, 08:00' for p in d.get('pcp_programacao') or []))
        prob, n3 = problemas_programacao(d.get('pcp_programacao') or [])
        ok(sim and n3 == n and not prob, f'Projetar sequência: {n3} operações só em dias e horários de trabalho (servidor)', prob[:6])
        await conferir_tela(2026, 10, 'calendário após Projetar sequência')
        await conferir_tela(2026, 11, 'calendário após Projetar sequência')
        dialogos.clear()
        await clique_humano(page.locator('button:has-text("Validar conflitos")'))
        await page.wait_for_timeout(1200)
        msg = dialogos[-1] if dialogos else ''
        ok(msg and 'dia indisponível' not in msg, 'Validar conflitos após Projetar sequência: nenhuma operação em dia indisponível', msg[:400])

        # ---------------------------------------------------------------- sábado liberado só para uma linha de produção
        await abrir_mes('2026-10')
        await page.select_option('#pcp_line_v2314', 'Prismática|Piloto')
        await page.wait_for_timeout(800)
        await clique_humano(celula(24).locator('.mes-edit-day'))
        await page.wait_for_timeout(400)
        rot = await page.evaluate("document.querySelector('#mes-edit-day-dialog[open] #mes-day-label')?.textContent || ''")
        ok(LIBERADO_LINHA in rot and 'Prismática|Piloto' in rot, '"Editar dia" na linha Prismática — Piloto', rot)
        if rot:
            await page.select_option('#mes-day-mode', 'LIBERAR')
            await page.fill('#mes-day-reason', 'Hora extra linha piloto')
            await clique_humano(page.locator('#mes-day-save'))
            await page.wait_for_timeout(700)
        cel = await mapa_celulas()
        ok(cel[24]['faixa'] == '', 'sábado 24/10 liberado na linha Prismática — Piloto', cel[24])
        await page.select_option('#pcp_line_v2314', '')
        await page.wait_for_timeout(800)
        cel = await mapa_celulas()
        ok(cel[24]['faixa'] == 'INDISPONIVEL · Sabado', 'em "Todas" o sábado 24/10 continua indisponível (liberado só para a linha)', cel[24])
        LIBERADOS.add(LIBERADO_LINHA)
        dialogos.clear()
        await page.evaluate("render('pcp_plano')")
        await page.wait_for_timeout(800)
        await clique_humano(page.locator('button:has-text("Projetar sequência pelas datas já informadas")'))
        await page.wait_for_timeout(1500)
        no_sabado = lambda d: [p for p in d.get('pcp_programacao') or [] if any(g['Inicio'].startswith('24/10/2026') for g in p.get('Segmentos') or [])]
        d, sim = await esperar_servidor(lambda d: not problemas_programacao(d.get('pcp_programacao') or [])[0] and no_sabado(d))
        prob, n5 = problemas_programacao(d.get('pcp_programacao') or [])
        ok(sim and n5 == n and not prob, f'Projetar sequência usa o sábado liberado para a linha das OPs ({len(no_sabado(d))} operações em 24/10)', prob[:6])
        dialogos.clear()
        await abrir_mes('2026-10')
        await clique_humano(page.locator('button:has-text("Validar conflitos")'))
        await page.wait_for_timeout(1200)
        msg = dialogos[-1] if dialogos else ''
        ok(msg and 'dia indisponível' not in msg, 'Validar conflitos (visão "Todas"): sábado liberado para a linha não é acusado', msg[:400])

        # ---------------------------------------------------------------- Programação: Recalcular programação
        await page.evaluate("render('pcp_programacao')")
        await page.wait_for_timeout(600)
        antes = len(erros_js)
        await clique_humano(page.locator('button:has-text("Recalcular programação")'))
        await page.wait_for_timeout(800)
        aberto = await page.evaluate("!!document.querySelector('#mes-proj-dialog[open]')")
        titulo = await page.inner_text('#title')
        ok(aberto and 'Calendário' in titulo and len(erros_js) == antes, '"Recalcular programação" abre a sugestão de programação no Calendário, sem erro', (titulo, erros_js[antes:]))
        if aberto:
            await page.evaluate("document.querySelector('#mes-proj-dialog').close()")

        # ---------------------------------------------------------------- Limpar datas
        dialogos.clear()
        await page.evaluate("render('pcp_calendario')")
        await page.wait_for_timeout(500)
        await clique_humano(page.locator('button:has-text("Limpar datas")'))
        await page.wait_for_timeout(1000)
        d, sim = await esperar_servidor(lambda d: not any(p.get('Inicio') or p.get('Segmentos') for p in d.get('pcp_programacao') or [])
                                        and not ((d.get('meta') or {}).get('pcpSegmentos') or {}))
        ok(sim, '"Limpar datas" limpa início, fim e trechos (cartões e data.meta.pcpSegmentos)', '')

        ok(not erros_js, 'nenhum erro JavaScript', erros_js[:3])
        await b.close()
    print(f'\n== {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print('FALHAS:'); [print(' - ' + f) for f in falhas]
        sys.exit(1)

asyncio.run(main())
