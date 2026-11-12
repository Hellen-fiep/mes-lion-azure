#!/usr/bin/env python3
"""
Teste no navegador da versão JSON 1.6.0 (server/adaptador_helpdesk_assistente.js) — assistente passo a passo no Help Desk:
  - os objetivos (fluxos de sim e não) estão bem formados: destinos existem, todo nó é alcançável, todo caminho termina,
    todo objetivo está em pelo menos uma trilha, as telas existem e abrem sem erro, os botões destacados existem;
  - o Help Desk abre (menu "?", "? Ajuda" do topo) com as abas "Assistente passo a passo" e "Fluxo de integração" (o
    fluxo de antes continua lá) e mostra os objetivos da tela atual;
  - busca por objetivo com sinônimos, sem acento e sem maiúsculas; "não encontrei" grava o pedido (data.helpdesk_buscas);
  - checagens nos dados sugerem Sim ou Não; Não leva ao objetivo que resolve e, ao concluir, volta para o objetivo de origem;
  - "Ir para a tela" abre a tela, destaca o botão e deixa o assistente no canto com "✓ Feito → próximo passo";
    a OP escolhida no assistente já vem selecionada na tela;
  - checklist final só conclui com todos os itens marcados; próximo passo natural; posição guardada (continuar depois);
  - trilhas por perfil com o progresso de cada usuário (data.helpdesk_progresso); o administrador vê a equipe e exporta
    o Excel; um usuário comum não vê a equipe e tem o seu próprio progresso;
  - sem erro de JavaScript.

Uso: python teste_helpdesk_assistente_json.py <url_base>
"""
import sys, os, json, asyncio, time, tempfile
import requests
import openpyxl
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0
PASTA = tempfile.mkdtemp(prefix='mes_helpdesk_')
OP_ABERTA = 'OP20260812101715-03'

# botões que só aparecem depois de abrir um formulário ou carregar uma OP na tela (o assistente manda clicar antes)
DESTAQUE_DEPOIS_DE_ABRIR = {('formulacoes', 'Validar percentuais')}


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {str(det)[:700]}'), flush=True)
    if not c: falhas.append(f'{nome}: {str(det)[:700]}')


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
        page = await ctx.new_page()
        erros = []
        logado = {'v': False}
        page.on('pageerror', lambda e: erros.append(str(e)))
        page.on('console', lambda m: erros.append('console: ' + m.text) if logado['v'] and m.type == 'error' and 'MES LION 1.6' in m.text else None)
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        ev = page.evaluate

        async def cookies(c=None):
            return {k['name']: k['value'] for k in await (c or ctx).cookies()}

        async def dados_servidor():
            return requests.get(BASE + '/api/bootstrap', cookies=await cookies(), timeout=180).json()['data']

        async def gravado(cond, segundos=40):
            fim = time.time() + segundos
            d = None
            while time.time() < fim:
                d = await dados_servidor()
                try:
                    if cond(d): return d
                except Exception:
                    pass
                await page.wait_for_timeout(700)
            return d

        async def login(p, usuario, senha):
            await p.goto(BASE + '/', wait_until='load')
            await p.fill('#user', usuario); await p.fill('#pass', senha); await p.click('.login-card button')
            await p.wait_for_selector('#app:not(.hidden)', timeout=120000)
            await p.wait_for_timeout(1600)

        async def abrir_help(p=None):
            p = p or page
            await p.click('#helpDeskNavV400')
            await p.wait_for_selector('#mhaPainel', timeout=10000)
            await p.wait_for_timeout(250)

        async def estado(p=None):
            return await (p or page).evaluate('mesHelpDeskAPI.estado()')

        async def clicar(sel, espera=250):
            await page.click(sel)
            await page.wait_for_timeout(espera)

        await login(page, 'admin', 'meslion2026')
        logado['v'] = True

        # ------------------------------------------------------------------ estrutura dos objetivos
        info = await ev("""() => ({ v: window.MES_ADAPTADOR_HELPDESK_ASSISTENTE, erros: mesHelpDeskAPI.validar(), fluxos: mesHelpDeskAPI.fluxos(),
            trilhas: mesHelpDeskAPI.trilhas(), grupos: mesHelpDeskAPI.grupos(), telas: mesHelpDeskAPI.telas() })""")
        fl = info['fluxos']
        ok(info['v'] == '1.7.0' and info['erros'] == [], 'adaptador 1.7.0 (assistente do Help Desk) carregado e todos os objetivos bem formados (destinos, alcance, fim de cada caminho)', info['erros'][:5])
        por_grupo = {g: [f['id'] for f in fl if f['grupo'] == g] for g in info['grupos']}
        ok(len(fl) >= 20 and all(len(v) >= 2 for v in por_grupo.values()) and len(info['grupos']) == 7,
           f'{len(fl)} objetivos em {len(info["grupos"])} módulos (cadastros, estoque, produção, planejamento, custos/ACV/passaporte, relatórios, administração)', {k: len(v) for k, v in por_grupo.items()})
        tr = {t['id']: t['fluxos'] for t in info['trilhas']}
        ok(list(tr) == ['Operador', 'PCP', 'Engenharia', 'Qualidade/ACV', 'Administrador'] and all(f['perfis'] for f in fl)
           and 'apontar_producao' in tr['Operador'] and 'calcular_acv' in tr['Qualidade/ACV'] and 'usuarios' in tr['Administrador'],
           'trilhas Operador, PCP, Engenharia, Qualidade/ACV e Administrador; todo objetivo está em pelo menos uma trilha', {k: len(v) for k, v in tr.items()})

        # todas as telas citadas abrem sem erro e os botões que o assistente destaca existem
        pares = await ev("""() => { const out = [];
            for (const f of mesHelpDeskAPI.fluxos()) { const d = mesHelpDeskAPI.fluxo(f.id);
              for (const [k, n] of Object.entries(d.nos)) if (n.tipo === 'passo' && n.tela && n.tela !== 'topo') out.push([n.tela, n.destacar || '', f.id + '.' + k]); }
            return out; }""")
        telas = sorted({p[0] for p in pares})
        sem_titulo, sem_botao = [], []
        for tela in telas:
            n0 = len(erros)
            await ev(f"render('{tela}')")
            await page.wait_for_timeout(700)
            tit = await ev("document.getElementById('title').textContent")
            if not tit or len(erros) > n0: sem_titulo.append((tela, tit, erros[n0:n0 + 2]))
            for t2, dest, onde in pares:
                if t2 != tela or not dest or (tela, dest) in DESTAQUE_DEPOIS_DE_ABRIR: continue
                achou = await ev(f"mesHelpDeskAPI.destacar({json.dumps(dest)})")
                if not achou: sem_botao.append((onde, dest))
        ok(not sem_titulo, f'as {len(telas)} telas dos passos abrem sem erro ({", ".join(telas)})', sem_titulo)
        ok(not sem_botao, 'todo botão que o assistente manda clicar existe na tela (é destacado)', sem_botao)
        ok(await ev("document.querySelectorAll('.mha-alvo').length") == 1, 'o destaque marca um botão de cada vez', '')

        # ------------------------------------------------------------------ Help Desk com as abas
        await ev("render('producao')")
        await page.wait_for_timeout(600)
        await abrir_help()
        ab = await ev("""() => ({ abas: Array.from(document.querySelectorAll('.mha-abas button')).map(b => [b.textContent.trim(), b.classList.contains('on')]),
            painel: getComputedStyle(document.getElementById('mhaPainel')).display, frame: getComputedStyle(document.querySelector('.v40-help-frame')).display,
            iframe: (document.querySelector('.v40-help iframe') || {}).getAttribute ? document.querySelector('.v40-help iframe').getAttribute('src') : '',
            tela: Array.from(document.querySelectorAll('#mha_main .mha-item')).map(x => x.dataset.id) })""")
        ok(ab['abas'] == [['🧭 Assistente passo a passo', True], ['🗺 Fluxo de integração dos módulos', False]] and ab['painel'] != 'none' and ab['frame'] == 'none'
           and 'helpdesk_fluxo_mes_lion.html' in (ab['iframe'] or ''), 'Help Desk abre no Assistente passo a passo; o fluxo de antes fica na outra aba', ab)
        ok({'apontar_producao', 'consumir_materiais'} <= set(ab['tela']), '"Nesta tela" (Apontamento Produção) sugere apontar a produção e consumir materiais/PIs', ab['tela'])
        await clicar('.mha-abas button[data-aba="fluxo"]')
        vis = await ev("[getComputedStyle(document.getElementById('mhaPainel')).display, getComputedStyle(document.querySelector('.v40-help-frame')).display, getComputedStyle(document.querySelector('.v40-help > section')).display]")
        ok(vis[0] == 'none' and vis[1] != 'none' and vis[2] != 'none', 'aba "Fluxo de integração" mostra o procedimento do módulo e o fluxo (iframe) de antes', vis)
        await clicar('.mha-abas button[data-aba="assistente"]')

        # ------------------------------------------------------------------ busca
        buscas = {'cadastrar maquina': 'cad_equipamento', 'Cadastrar um EQUIPAMENTO novo': 'cad_equipamento', 'nota fiscal': 'entrada_material', 'refugo': 'registrar_perda',
                  'pegada de carbono': 'calcular_acv', 'o que comprar': 'mrp', 'saldo do lote': 'saldo_estoque', 'quem alterou': 'historico', 'trocar senha': 'usuarios',
                  'importar planilha de equipamentos': 'cad_equipamento', 'fórmula do slurry': 'formulacao', 'encerrar op': 'encerrar_op', 'calendário': 'calendario',
                  'lote negativo': 'consistencia', 'números errados': 'consistencia', 'máquina parada': 'registrar_parada', 'energia medida na formação': 'testes_celulas',
                  'dashboard': 'painel', 'regra de cálculo': 'indicador'}
        errados = {}
        for q, esperado in buscas.items():
            await page.fill('#mha_q', q)
            await page.wait_for_timeout(120)
            primeiro = await ev("(document.querySelector('#mha_res .mha-item') || {}).dataset ? document.querySelector('#mha_res .mha-item').dataset.id : ''")
            if primeiro != esperado: errados[q] = primeiro
        ok(not errados, f'busca por objetivo com sinônimos, sem acento e sem maiúsculas ({len(buscas)} frases)', errados)
        await page.fill('#mha_q', 'xyzabc impressora 3d')
        await page.wait_for_timeout(150)
        vazio = await ev("document.getElementById('mha_res').innerText")
        ok('Nenhum objetivo encontrado' in vazio, 'busca sem resultado avisa e oferece "avise o que você queria fazer"', vazio)
        await clicar('#mha_res [data-acao="nao_encontrei"]')
        ok(await ev("document.getElementById('mha_ne_termo').value") == 'xyzabc impressora 3d', '"Não encontrei" já traz o que foi digitado', '')
        await page.fill('#mha_ne_coment', 'Queria cadastrar a impressora 3D do laboratório')
        await clicar('[data-acao="enviar_ne"]', 400)
        msg = await ev("document.getElementById('mha_ne_msg').textContent")
        d = await gravado(lambda d: any(x.get('Termo') == 'xyzabc impressora 3d' for x in d.get('helpdesk_buscas') or []))
        reg = next((x for x in d.get('helpdesk_buscas') or [] if x.get('Termo') == 'xyzabc impressora 3d'), {})
        ok('registrado' in msg and reg.get('Usuario') == 'admin' and reg.get('Tela') == 'producao' and 'impressora 3D' in reg.get('Comentario', '') and reg.get('Caminho') == '(início do assistente)',
           '"Não encontrei o que queria" grava o pedido com usuário, tela e caminho (data.helpdesk_buscas)', reg)
        await clicar('[data-acao="cancelar_ne"]')
        await page.fill('#mha_q', '')

        # ------------------------------------------------------------------ trilha
        await clicar('.mha-chip[data-id="Operador"]', 400)
        prog = await ev("(document.getElementById('mha_prog') || {}).textContent || ''")
        d = await gravado(lambda d: any(r.get('Usuario') == 'admin' and r.get('Trilha') == 'Operador' for r in d.get('helpdesk_progresso') or []))
        ok(prog.startswith('0 de 8 objetivos') and any(r.get('Usuario') == 'admin' and r.get('Trilha') == 'Operador' for r in d.get('helpdesk_progresso') or []),
           'trilha Operador escolhida: "0 de 8 objetivos" e gravada por usuário (data.helpdesk_progresso)', prog)
        prox = await ev("(document.querySelector('#mha_main .mha-card .mha-item') ? Array.from(document.querySelectorAll('#mha_main .mha-card')).map(c => c.innerText).join(' | ') : '')")
        ok('Registrar a entrada (recebimento) de material' in prox, 'o início mostra o próximo objetivo da trilha', prox[:300])

        # ------------------------------------------------------------------ sim e não com checagem, desvio e volta
        await ev("mesHelpDeskAPI.iniciar('roteiro')")
        await page.wait_for_timeout(200)
        q1 = await ev("({ q: document.querySelector('.mha-q').textContent, chk: document.querySelector('.mha-chk').textContent, sug: document.querySelector('.mha-sn .sugerido') ? document.querySelector('.mha-sn .sugerido').className : '', nao: document.querySelector('.mha-nao small').textContent })")
        ok('estrutura do produto' in q1['q'] and 'PA0001' in q1['chk'] and 'Sugestão: Sim' in q1['chk'] and 'mha-sim' in q1['sug'] and q1['nao'] == 'primeiro: Criar a estrutura do produto (PA e PIs)',
           'pergunta com a checagem nos dados ("1 PA cadastrado: PA0001", sugestão Sim) e o que acontece no Não', q1)
        await clicar('.mha-nao')
        e = await estado()
        ban = await ev("(document.querySelector('.mha-desvio') || {}).textContent || ''")
        ok(e['fluxo'] == 'cad_estrutura' and e['pilha'] == [{'fluxo': 'roteiro', 'no': 'q_maq'}] and 'Montar o roteiro' in ban, 'Não leva antes para "Criar a estrutura do produto" e guarda a volta', (e, ban))
        await clicar('.mha-sim'); await clicar('.mha-sim'); await clicar('.mha-sim')
        e = await estado()
        btn = await ev("(b => ({ d: b.disabled, t: b.textContent }))(document.getElementById('mha_concluir'))")
        ok(e['tipo'] == 'fim' and btn['d'] and btn['t'].startswith('✓ Concluir e voltar para "Montar o roteiro'), 'checklist final: só conclui depois de marcar todos os itens', btn)
        n_itens = await ev("document.querySelectorAll('.mha-check input').length")
        for i in range(n_itens):
            await clicar(f'.mha-check input[data-i="{i}"]', 120)
        ok(await ev("!document.getElementById('mha_concluir').disabled"), 'com todos os itens marcados o botão Concluir libera', '')
        await clicar('#mha_concluir', 400)
        e = await estado()
        volta = await ev("(document.querySelector('.mha-volta') || {}).textContent || ''")
        ok(e['fluxo'] == 'roteiro' and e['no'] == 'q_maq' and not e['pilha'] and 'Criar a estrutura do produto (PA e PIs) concluído' in volta,
           'ao concluir, o assistente volta para o objetivo de origem (roteiro) na pergunta seguinte', (e, volta))
        await clicar('[data-acao="voltar"]')
        e = await estado()
        ok(e['fluxo'] == 'cad_estrutura' and e['tipo'] == 'fim', '"← Voltar" volta o caminho (até dentro do desvio)', e)
        await clicar('#mha_main [data-acao="recomecar"]')
        await ev("mesHelpDeskAPI.iniciar('roteiro')")
        await clicar('.mha-sim'); await clicar('.mha-sim'); await clicar('.mha-sim')
        e = await estado()
        passo = await ev("({ t: document.querySelector('.mha-passo h3').textContent, onde: document.querySelector('.mha-onde').textContent, secs: Array.from(document.querySelectorAll('.mha-cols .mha-sec h5')).map(h => h.textContent) })")
        ok(e['no'] == 'p_novo' and 'Criar o roteiro' in passo['t'] and 'Produção › Roteiro' in passo['onde'] and '"+ Novo roteiro"' in passo['onde']
           and passo['secs'] == ['✏️ O que preencher / fazer', '⚠️ Obrigatório', '➡️ Para onde vão os dados', '🚫 Erros comuns'],
           'passo com onde fica, o botão, o que preencher, obrigatório, para onde vão os dados e erros comuns', passo)

        # ------------------------------------------------------------------ ir para a tela e o assistente no canto
        await clicar('.mha-onde .mha-ir', 900)
        tela = await ev("""() => ({ overlay: !!document.getElementById('v40HelpOverlay'), titulo: document.getElementById('title').textContent,
            alvo: (document.querySelector('.mha-alvo') || {}).textContent, dock: (document.querySelector('#mhaDock h4') || {}).textContent })""")
        ok(not tela['overlay'] and tela['titulo'].startswith('Roteiro') and (tela['alvo'] or '').strip() == '+ Novo roteiro' and 'Criar o roteiro' in (tela['dock'] or ''),
           '"Ir para a tela": abre o Roteiro, destaca "+ Novo roteiro" e deixa o assistente no canto', tela)
        await clicar('#mhaDock [data-dock="min"]')
        ok(await ev("document.getElementById('mhaDock').classList.contains('min')"), 'o assistente do canto minimiza', '')
        await clicar('#mhaDock [data-dock="min"]')
        await clicar('#mhaDock [data-dock="feito"]', 700)
        dk = await ev("({ h: document.querySelector('#mhaDock h4').textContent, alvo: (document.querySelector('.mha-alvo') || {}).textContent || '', overlay: !!document.getElementById('v40HelpOverlay') })")
        ok('Criar as operações' in dk['h'] and '+ Criar operação' in dk['alvo'] and not dk['overlay'], '"✓ Feito → próximo passo" no canto: próximo passo na mesma tela, com o botão destacado', dk)
        await clicar('#mhaDock [data-dock="feito"]', 500); await clicar('#mhaDock [data-dock="feito"]', 500); await clicar('#mhaDock [data-dock="feito"]', 900)
        fim = await ev("({ overlay: !!document.getElementById('v40HelpOverlay'), dock: !!document.getElementById('mhaDock'), chk: document.querySelectorAll('.mha-check input').length })")
        ok(fim['overlay'] and not fim['dock'] and fim['chk'] == 5, 'no último passo o Help Desk reabre no checklist final', fim)
        for i in range(fim['chk']):
            await clicar(f'.mha-check input[data-i="{i}"]', 100)
        await clicar('#mha_concluir', 500)
        concl = await ev("({ t: document.getElementById('mha_main').innerText, prox: Array.from(document.querySelectorAll('#mha_main .mha-item')).map(x => x.dataset.id) })")
        d = await gravado(lambda d: any(r.get('Usuario') == 'admin' and (r.get('Fluxos') or {}).get('roteiro', {}).get('Concluido') for r in d.get('helpdesk_progresso') or []))
        meu = next((r for r in d.get('helpdesk_progresso') or [] if r.get('Usuario') == 'admin'), {})
        ok('Objetivo concluído!' in concl['t'] and concl['prox'] == ['formulacao', 'abrir_op'] and set(meu.get('Fluxos', {})) >= {'roteiro', 'cad_estrutura'} and meu.get('Ultimo') == 'roteiro'
           and len(meu['Fluxos']['roteiro'].get('Checklist') or []) == 5, 'objetivo concluído: progresso gravado (roteiro e a estrutura do desvio) e o próximo passo natural', (concl['prox'], meu.get('Fluxos', {}).keys()))
        lista = await ev("Array.from(document.querySelectorAll('.mha-lista .mha-item')).filter(x => x.querySelector('.mha-ok-ico')).map(x => x.dataset.id)")
        ok(set(lista) == {'roteiro', 'cad_estrutura'}, 'a lista de objetivos marca com ✓ o que o usuário já concluiu', lista)

        # ------------------------------------------------------------------ OP escolhida no assistente
        await ev("mesHelpDeskAPI.iniciar('apontar_producao')")
        await clicar('.mha-sim')
        await page.select_option('#mha_main select[data-acao="ctx_op"]', OP_ABERTA)
        await clicar('.mha-onde .mha-ir', 1200)
        sel = await ev("({ v: (document.getElementById('prod_op') || {}).value, t: document.getElementById('title').textContent, alvo: (document.querySelector('.mha-alvo') || {}).textContent || '' })")
        ok(sel['v'] == OP_ABERTA and 'Apontamento' in sel['t'] and sel['alvo'].strip() == 'Carregar OP', 'a OP escolhida no assistente já vem selecionada no Apontamento, com "Carregar OP" destacado', sel)
        await clicar('#mhaDock [data-dock="abrir"]', 500)
        e = await estado()
        ok(await ev("!!document.getElementById('v40HelpOverlay')") and e['fluxo'] == 'apontar_producao' and e['no'] == 'p_carregar' and not e['dock'],
           '"Abrir o assistente" volta ao Help Desk no mesmo passo', e)
        # perguntas sem dado (motivos de perda): a sugestão é Não
        await ev("mesHelpDeskAPI.iniciar('registrar_perda')")
        await page.wait_for_timeout(200)
        sug = await ev("({ s: document.querySelector('.mha-sn .sugerido') ? document.querySelector('.mha-sn .sugerido').className : '', c: document.querySelector('.mha-chk').textContent })")
        ok('mha-nao' in sug['s'] and 'Nenhum motivo de perda cadastrado' in sug['c'], 'sem motivos de perda cadastrados, a sugestão é Não (cadastrar o motivo primeiro)', sug)
        await clicar('.mha-nao')
        ok((await estado())['no'] == 'p_mot', 'Não leva ao passo "Cadastrar o motivo"', '')

        # ------------------------------------------------------------------ continuar depois (posição guardada)
        await page.reload(wait_until='load')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1500)
        await abrir_help()
        cont = await ev("(document.querySelector('[data-acao=\"continuar\"]') ? document.querySelector('[data-acao=\"continuar\"]').closest('.mha-card').innerText : '')")
        await clicar('[data-acao="continuar"]')
        e = await estado()
        ok('Continuar de onde parei' in cont and 'Registrar uma perda' in cont and e['fluxo'] == 'registrar_perda' and e['no'] == 'p_mot', 'depois de recarregar: "Continuar de onde parei" volta ao mesmo passo', (cont, e))
        await clicar('#mha_main [data-acao="sair"]')
        ok((await estado())['vista'] == 'inicio' and not await ev("!!document.querySelector('[data-acao=\"continuar\"]')"), '"Sair do objetivo" volta ao início e esquece a posição', '')

        # ------------------------------------------------------------------ equipe (administrador)
        await clicar('[data-acao="equipe"]')
        eq = await ev("document.getElementById('mha_main').innerText")
        ok('Progresso da equipe e pedidos de ajuda' in eq and 'Operador' in eq and 'xyzabc impressora 3d' in eq, 'administrador vê o progresso da equipe e os pedidos "não encontrei"', eq[:400])
        async with page.expect_download(timeout=60000) as info_dl:
            await page.click('[data-acao="excel_equipe"]')
        dl = await info_dl.value
        cam = os.path.join(PASTA, dl.suggested_filename)
        await dl.save_as(cam)
        wb = openpyxl.load_workbook(cam)
        p1 = [[c.value for c in r] for r in wb['Progresso'].iter_rows()]
        ne = [[c.value for c in r] for r in wb['Não encontrei'].iter_rows()]
        ok(dl.suggested_filename.startswith('MES_LION_helpdesk_equipe_') and wb.sheetnames == ['Progresso', 'Objetivos concluídos', 'Não encontrei']
           and any(r[0] == 'admin' and r[2] == 'Operador' for r in p1[1:]) and any(r[2] == 'xyzabc impressora 3d' for r in ne[1:]) and wb['Objetivos concluídos'].max_row >= 3,
           'Excel da equipe (progresso, objetivos concluídos e "não encontrei")', (wb.sheetnames, p1[:2], ne[:2]))
        await clicar('[data-acao="inicio"]')
        await page.click('#v40HelpOverlay .v40-help > header button:last-child')
        await page.wait_for_timeout(300)

        # ------------------------------------------------------------------ "? Ajuda" do topo e "? Procedimento"
        await ev("render('cad_recursos')")
        await page.wait_for_timeout(500)
        await page.click('.v40-header-actions button:has-text("? Ajuda")')
        await page.wait_for_selector('#mhaPainel', timeout=10000)
        nt = await ev("Array.from(document.querySelectorAll('#mha_main .mha-item')).map(x => x.dataset.id)")
        ok('cad_equipamento' in nt, '"? Ajuda" do topo abre o assistente com os objetivos da tela (Recursos / Máquinas)', nt)
        await page.click('#v40HelpOverlay .v40-help > header button:last-child')
        await page.wait_for_timeout(300)

        # ------------------------------------------------------------------ usuário comum
        s = requests.Session()
        s.cookies.update(await cookies())
        r = s.post(BASE + '/api/users', json={'username': 'operador_hd', 'fullName': 'Operador Help Desk', 'password': 'Senha#2026', 'role': 'USER', 'active': True}, timeout=30)
        ok(r.status_code in (200, 201) or 'já existe' in r.text, 'usuário comum criado para o teste', r.text[:200])
        ctx2 = await b.new_context(viewport={'width': 1400, 'height': 900}, locale='pt-BR')
        p2 = await ctx2.new_page()
        p2.on('pageerror', lambda e: erros.append('usuário comum: ' + str(e)))
        await login(p2, 'operador_hd', 'Senha#2026')
        await abrir_help(p2)
        sem_equipe = await p2.evaluate("!document.querySelector('[data-acao=\"equipe\"]')")
        await p2.evaluate("mesHelpDeskAPI.iniciar('usuarios')")
        await p2.wait_for_timeout(200)
        sug = await p2.evaluate("({ s: document.querySelector('.mha-sn .sugerido') ? document.querySelector('.mha-sn .sugerido').className : '', c: document.querySelector('.mha-chk').textContent })")
        await p2.click('.mha-chip[data-id="PCP"]')
        await p2.wait_for_timeout(300)
        prog2 = await p2.evaluate("(document.getElementById('mha_prog') || {}).textContent || ''")
        ok(sem_equipe and 'mha-nao' in sug['s'] and 'sem perfil de administrador' in sug['c'] and prog2.startswith('0 de 12'),
           'usuário comum: sem a visão da equipe, "Criar usuário" sugere Não (não é administrador) e o progresso é dele (trilha PCP 0 de 12)', (sem_equipe, sug, prog2))
        cookies2 = {k['name']: k['value'] for k in await ctx2.cookies()}
        fim_t = time.time() + 40
        regs = []
        while time.time() < fim_t:
            regs = requests.get(BASE + '/api/bootstrap', cookies=cookies2, timeout=180).json()['data'].get('helpdesk_progresso') or []
            if any(x.get('Usuario') == 'operador_hd' for x in regs): break
            await p2.wait_for_timeout(700)
        rop = next((x for x in regs if x.get('Usuario') == 'operador_hd'), {})
        radm = next((x for x in regs if x.get('Usuario') == 'admin'), {})
        ok(rop.get('Trilha') == 'PCP' and not rop.get('Fluxos') and radm.get('Trilha') == 'Operador' and 'roteiro' in (radm.get('Fluxos') or {}),
           'cada usuário com o seu registro de progresso (o do administrador continua com a trilha e os concluídos dele)', (rop, radm.get('Trilha')))
        await ctx2.close()

        ok(not erros, 'sem erro de JavaScript', erros[:5])
        await b.close()


asyncio.run(main())
print(f'\n== {total - len(falhas)}/{total} verificações OK', flush=True)
if falhas:
    print('FALHAS:'); [print(' -', f) for f in falhas]
    sys.exit(1)
