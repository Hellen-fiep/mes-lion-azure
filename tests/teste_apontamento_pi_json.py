#!/usr/bin/env python3
"""
Teste no navegador da versão JSON 1.4.0 (server/adaptador_apontamento_pi.js) e das regras da 1.6.1:
  - atualização dos dados: QtdProduzida = soma dos apontamentos (o lançamento antigo contava o último duas vezes) e
    baixa única dos PIs das famílias já encerradas (o lote de PI não fica com saldo cheio depois de virar PA);
  - motivos de perda: cadastro sem duplicidade (acento/maiúscula), aviso de motivo parecido, lista suspensa no Registro
    de Perdas e importação dos motivos já digitados (com padronização);
  - roteiro: que PI entra em qual operação (validação, sugestão automática, cópia de roteiro) e fluxo em níveis na
    Estrutura do Produto; as OPs abertas recebem o PI como insumo da etapa (genealogia da OP de PA vira só genealogia);
  - apontamento de produção com etiquetas (kg: uma etiqueta; "un": N por etiqueta, uma por unidade, aglutinada) e
    impressão com código de barras; QtdProduzida sem dobrar;
  - consumo do PI pela leitura da etiqueta (retirado − devolvido, perda na etapa), saldo insuficiente bloqueado,
    estorno devolvendo o saldo;
  - Registro de Perdas com origem da perda (dentro do consumo / retirada adicional) para PI e material;
  - tempo por máquina (intervalo, iniciar/finalizar, sobreposição bloqueada) e o tempo real na energia da OP;
  - baixa automática do PI da família no encerramento da OP consumidora;
  - custo e CO₂ sem dupla contagem de perdas; estoque de PI e PA (saldos, etiquetas, baixa/estorno, cancelamento,
    rastreio, conferência); exclusão de produção com etiqueta consumida bloqueada;
  - 1.6.1: OP encerrada só com o consumo real no custo e na ACV (aviso no encerramento), consumo acima do saldo do lote
    com confirmação e marca, lote NEGATIVO, saldo do lote na lista de lotes, conversão de UM no estoque e MRP/reservas
    descontando o já consumido.

Uso: python teste_apontamento_pi_json.py <url_base>
"""
import sys, os, re, json, asyncio, time, datetime
import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0

ROT = 'RT-20260810103335_COPIA'
FAM = 'OP20260812101715'          # família aberta (roteiro ROT)
FAM_FECHADA = 'OP20260812094138'  # família encerrada antes da 1.4.0
OP01, OP02, OP03, OP04, OP05, OP06, OP07, OPPA = (FAM + s for s in ('-01', '-02', '-03', '-04', '-05', '-06', '-07', '-PA'))
FLUXO_ESPERADO = {('30', 'PI0001'), ('40', 'PI0002'), ('50', 'PI0003'), ('60', 'PI0004'), ('70', 'PI0005'), ('70', 'PI0006'), ('80', 'PI0007')}


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'), flush=True)
    if not c: falhas.append(f'{nome}: {str(det)[:500]}')


def perto(a, b, tol=1e-6):
    return a is not None and b is not None and abs(float(a) - float(b)) <= tol


async def main():
    ontem = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime('%d/%m/%Y')
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo')
        page = await ctx.new_page()
        erros, dialogos = [], []
        logado = {'v': False}
        page.on('pageerror', lambda e: erros.append(str(e)))
        page.on('console', lambda m: erros.append('console: ' + m.text) if logado['v'] and m.type == 'error' and 'MES LION 1.4' in m.text else None)

        def dialogo(d):
            dialogos.append(d.message)
            asyncio.ensure_future(d.accept(d.default_value) if d.type == 'prompt' else d.accept())
        page.on('dialog', dialogo)
        ev = page.evaluate

        async def dados_servidor():
            ck = {c['name']: c['value'] for c in await ctx.cookies()}
            return requests.get(BASE + '/api/bootstrap', cookies=ck, timeout=180).json()['data']

        async def esperar_servidor(cond, segundos=25):
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

        async def tela_producao(cod):
            await ev("render('producao')")
            await page.wait_for_timeout(400)
            await page.select_option('#prod_op', cod)
            await page.wait_for_timeout(700)

        async def tela_perdas(cod):
            await ev("render('perdas')")
            await page.wait_for_timeout(400)
            await page.select_option('#loss_op', cod)
            await page.wait_for_timeout(700)

        await page.goto(BASE + '/', wait_until='load')
        await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026'); await page.click('.login-card button')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1800)
        logado['v'] = True

        # ------------------------------------------------------------------ atualização dos dados (boot)
        ini = await ev(f"""() => {{
            const L = mesApontamentoPI14.livro(), lotes = Object.values(L.lotes);
            const fechados = lotes.filter(l => l.CodOP.startsWith('{FAM_FECHADA}'));
            return {{ v: window.MES_ADAPTADOR_APONTAMENTO_PI, cor: (data.meta.mes140CorrecoesQtd||[]).map(c => [c.CodOP, c.Antes, c.Depois]),
              q01: (data.op.find(o => o.CodOP === '{FAM_FECHADA}-01')||{{}}).QtdProduzida,
              leg: (data.op_pi_consumos||[]).filter(c => c.Origem === 'BAIXA_LEGADO_1.4.0').map(c => [c.CodOPConsumidora, c.CodigoPI, Number(c.QuantidadeConsumida)]),
              saldosPI: fechados.filter(l => l.Tipo === 'PI').map(l => [l.IdLote, l.Saldo]), saldoPA: (fechados.find(l => l.Tipo === 'PA')||{{}}).Saldo,
              v403: (typeof v403SaldoLote === 'function') ? v403SaldoLote({{IdLotePI: 'LPI-20260812094138-01', QuantidadeProduzida: '0,8956'}}) : null,
              nav: ['nav_perdas_motivos', 'nav_estoque_pi_pa'].map(id => !!document.getElementById(id)) }};
        }}""")
        ok(ini['v'] == '1.6.1', 'adaptador 1.6.1 (apontamento por máquina e PIs; regras de custo da 1.6.1) carregado', ini['v'])
        ok(len(ini['cor']) == 7 and ini['q01'] == '0,8956' and all(float(a.replace(',', '.')) == 2 * float(d.replace(',', '.')) for _, a, d in ini['cor']),
           'QtdProduzida corrigida para a soma dos apontamentos nas 7 OPs em que o último apontamento estava dobrado', ini['cor'])
        ok(len(ini['leg']) == 7 and all(c[0] == FAM_FECHADA + '-PA' for c in ini['leg']) and all(s == 0 for _, s in ini['saldosPI']) and ini['saldoPA'] == 1,
           'família encerrada antes da 1.4.0: os 7 PIs baixados uma vez (consumidos pelo PA) e o PA com saldo 1', ini)
        ok(ini['v403'] == 0, 'lote de PI da V40.3 (v403SaldoLote) usa o mesmo saldo do estoque', ini['v403'])
        ok(all(ini['nav']), 'menu com "Motivos de Perda" (Produção) e "Estoque PI / PA" (Materiais)', ini['nav'])

        # ------------------------------------------------------------------ motivos de perda
        await ev("render('perdas_motivos')")
        await page.wait_for_timeout(500)
        await page.click('text=+ Novo motivo')
        await page.select_option('#mes_mot_cat', 'Refugo de processo')
        await page.fill('#mes_mot_mot', 'Contaminação')
        await page.click('text=Salvar motivo')
        await page.wait_for_timeout(400)
        n1 = await ev("data.perdas_motivos.filter(m => m.Motivo === 'Contaminação' && m.Categoria === 'Refugo de processo').length")
        ok(n1 == 1, 'motivo "Contaminação" cadastrado em Refugo de processo', n1)
        await page.click('text=+ Novo motivo')
        await page.fill('#mes_mot_mot', 'contaminacao.')
        await page.click('text=Salvar motivo')
        await page.wait_for_timeout(400)
        dup = await ev("({n: data.perdas_motivos.length, msg: (document.getElementById('mes_mot_msg')||{}).textContent || ''})")
        ok(dup['n'] == 1 and 'Já existe' in dup['msg'], '"contaminacao." (sem acento, minúscula, pontuação) é bloqueado como duplicado', dup)
        dialogos.clear()
        await page.fill('#mes_mot_mot', 'Contaminaçãoo')
        await page.click('text=Salvar motivo')
        await page.wait_for_timeout(500)
        par = await ev("data.perdas_motivos.map(m => m.Motivo)")
        ok(any('parecido' in d for d in dialogos) and 'Contaminaçãoo' in par, 'motivo parecido pede confirmação (e grava se confirmado)', (dialogos[-1:] if dialogos else '', par))
        await ev("mesMotivoExcluir(data.perdas_motivos.find(m => m.Motivo === 'Contaminaçãoo').IdMotivo)")
        await page.wait_for_timeout(400)
        ok(await ev("!data.perdas_motivos.some(m => m.Motivo === 'Contaminaçãoo')"), 'motivo sem uso pode ser excluído')
        # importação dos motivos digitados
        await ev("""() => { data.perdas[0].Motivo = 'contaminação '; data.perdas[0].TipoApontamento = 'Refugo de processo';
                    data.perdas[1].Motivo = 'Fora de especificacao'; data.perdas[1].TipoApontamento = 'refugo de processo'; saveLocal(); }""")
        await ev("render('perdas_motivos')")
        await page.wait_for_timeout(400)
        await page.click('text=Importar motivos já digitados nas perdas')
        await page.wait_for_timeout(400)
        imp = await ev("({linhas: document.querySelectorAll('#mes14_overlay tbody tr').length, ja: document.querySelectorAll('#mes14_overlay .mes14-tag.ok').length})")
        await page.check('#mes14_imp_padronizar')
        await page.click('text=Importar selecionados')
        await page.wait_for_timeout(600)
        imp2 = await ev("""({reg: data.perdas_motivos.map(m => m.Categoria + '|' + m.Motivo), p0: [data.perdas[0].Motivo, data.perdas[0].IdMotivo], p1: [data.perdas[1].Motivo, data.perdas[1].TipoApontamento, data.perdas[1].IdMotivo]})""")
        ok(imp['linhas'] == 2 and imp['ja'] == 1 and 'Refugo de processo|Fora de especificacao' in imp2['reg'] and imp2['p0'][0] == 'Contaminação' and imp2['p0'][1]
           and imp2['p1'][1] == 'Refugo de processo' and imp2['p1'][2], 'importação agrupa os motivos digitados, cadastra o novo e padroniza as perdas antigas', (imp, imp2))
        await tela_perdas(OP03)
        lf = await ev("""({tipo: document.getElementById('loss_tipo').tagName, cats: [...document.getElementById('loss_tipo').options].map(o => o.value),
                         mot: document.getElementById('loss_motivo').tagName, mots: [...document.getElementById('loss_motivo').options].map(o => o.value)})""")
        ok(lf['mot'] == 'SELECT' and 'Refugo de processo' in lf['cats'] and 'Contaminação' in lf['mots'] and 'Fora de especificacao' in lf['mots'],
           'Registro de Perdas: categoria e motivo em lista suspensa do cadastro', lf)

        # ------------------------------------------------------------------ roteiro: que PI entra em qual operação
        await ev(f"render('roteiro'); setTimeout(() => {{ document.getElementById('v382_rot').value = '{ROT}'; renderRoteiroArvoreV382(); }}, 50)")
        await page.wait_for_timeout(900)
        card = await ev("(document.getElementById('mes14_fluxo_card')||{}).textContent || ''")
        ok('7 pendência' in card and 'Não entra em nenhuma operação' in card, 'roteiro sem fluxo: 7 PIs sem operação de destino apontados', card[:200])
        dialogos.clear()
        await ev("""() => { const s = document.getElementById('mes14_rpi_10'); s.insertAdjacentHTML('beforeend', '<option value="PI0003">PI0003</option>'); s.value = 'PI0003'; mesRotPIAdd('10'); }""")
        await page.wait_for_timeout(300)
        ok(any('operação posterior' in d for d in dialogos) and await ev(f"mesApontamentoPI14.entradasPI('{ROT}').length") == 0,
           'PI produzido na operação 30 não pode entrar na operação 10 (bloqueado)', dialogos[-1:])
        await page.click('text=Sugerir fluxo automaticamente')
        await page.wait_for_timeout(900)
        ents = await ev(f"mesApontamentoPI14.entradasPI('{ROT}').map(x => [x.OrdemEtapa, x.CodigoPI])")
        ok({tuple(x) for x in ents} == FLUXO_ESPERADO and len(ents) == 7, 'sugestão automática: 30←PI0001, 40←PI0002, 50←PI0003, 60←PI0004, 70←PI0005+PI0006, 80←PI0007', ents)
        card = await ev("(document.getElementById('mes14_fluxo_card')||{}).textContent || ''")
        chips = await ev("document.querySelectorAll('#rotDet .mes14-chip').length")
        ok('Fluxo completo' in card and chips == 7, 'roteiro com fluxo completo e as entradas em cada operação', (card[-120:], chips))
        sync = await ev(f"""() => {{
            const pi = c => data.op_materiais.filter(m => m.CodOP === c && /pi intermedi/i.test(m.TipoConsumo||''));
            const r03 = pi('{OP03}').find(m => m.CodigoMaterial === 'PI0001') || {{}};
            return {{ r03: [r03.OrigemDados, r03.OPOrigemPI, r03.QtdPlanejada, r03.OrdemEtapa, r03.Processo], r07: pi('{OP07}').map(m => m.CodigoMaterial).sort(),
              pa: pi('{OPPA}').map(m => [m.CodigoMaterial, m.OrdemEtapa, m.FluxoPISubstituido || '']),
              ativas: mesApontamentoPI14.linhasPIDaOP('{OPPA}').map(m => m.CodigoMaterial) }};
        }}""")
        ok(sync['r03'][:3] == ['FLUXO_PI_ROTEIRO', OP01, '0.8956'] and sync['r03'][3] == '30', 'OP de coating recebe o slurry PI0001 como insumo da etapa 30 (origem OP -01, planejado 0,8956)', sync['r03'])
        ok(sync['r07'] == ['PI0005', 'PI0006'], 'OP do jelly roll recebe os dois eletrodos cortados (PI0005 e PI0006)', sync['r07'])
        gen = [p for p in sync['pa'] if p[1] == 'PI']
        ok(len(gen) == 7 and all(p[2] == 'Sim' for p in gen) and sync['ativas'] == ['PI0007'], 'OP de PA: genealogia vira só genealogia; o insumo ativo é o PI0007 da etapa 80', sync)
        # cópia do roteiro leva o fluxo
        dialogos.clear()
        await ev("copiarRoteiroV386()")
        await page.wait_for_timeout(900)
        copia = await ev(f"(() => {{ const n = data.roteiro.find(r => r.RoteiroOrigem === '{ROT}'); return n ? [n.CodRoteiro, mesApontamentoPI14.entradasPI(n.CodRoteiro).length] : null; }})()")
        ok(copia and copia[1] == 7, 'cópia do roteiro leva as 7 entradas de PI', copia)
        # estrutura em níveis
        await ev("render('estrutura')")
        await page.wait_for_timeout(700)
        await ev("window.__mes14EstrPA = 'PA0001'")
        arv = await ev(f"""() => {{ const d = data.roteiro.find(r => r.CodRoteiro === '{ROT}'); window.__mes14EstrPA = 'PA0001';
            const box = document.getElementById('mes14_estr_arvore'); return box ? box.innerText : ''; }}""")
        prof = await ev("""() => { let max = 0; document.querySelectorAll('#mes14_estr_arvore details').forEach(d => { let n = 0, x = d; while (x && x.id !== 'mes14_estr_arvore') { if (x.tagName === 'DETAILS') n++; x = x.parentElement; } max = Math.max(max, n); }); return max; }""")
        ok('PA0001' in arv and 'PI0001' in arv, 'Estrutura do Produto mostra o fluxo em níveis pelo roteiro', arv[:200])
        ok(prof >= 5, 'fluxo multinível: PA0001 ← PI0007 ← PI0005 ← PI0003 ← PI0001 (5 níveis)', prof)

        # ------------------------------------------------------------------ produção com etiquetas
        await tela_producao(OP01)
        await page.fill('#ap_qtd', '0.9')
        await page.click('text=Registrar produção e etiquetas')
        await page.wait_for_timeout(900)
        p1 = await ev(f"""({{q: data.op.find(o => o.CodOP === '{OP01}').QtdProduzida, et: data.etiquetas_producao.filter(e => e.CodOP === '{OP01}').map(e => [e.IdEtiqueta, e.Quantidade, e.UM, e.Modo]),
                           msg: (document.getElementById('mes14_prod_msg')||{{}}).textContent || ''}})""")
        ok(p1['et'] == [['ET000001', '0.9', 'kg', 'UNICA']], 'produção em kg gera uma etiqueta com a quantidade apontada (ET000001)', p1)
        ok(p1['q'] == '0,9', 'QtdProduzida da OP = 0,9 (não dobra o último apontamento)', p1['q'])
        async with page.expect_popup() as pinfo:
            await page.click('#mes14_prod_msg button')
        pop = await pinfo.value
        await pop.wait_for_load_state()
        conteudo = await pop.content()
        ok(conteudo.count('mbc-barcode') == 1 and 'ET000001' in conteudo and 'PI0001' in conteudo, 'impressão da etiqueta com código de barras Code 128', conteudo[:200])
        await pop.close()
        imp = await ev(f"!!data.etiquetas_producao.find(e => e.IdEtiqueta === 'ET000001').ImpressaEm")
        ok(imp, 'etiqueta marcada como impressa')

        await tela_producao(OP05)
        await page.fill('#ap_qtd', '35')
        await page.click('text=Registrar produção e etiquetas')
        await page.wait_for_selector('#mes14_overlay')
        await page.check('#mes14_overlay input[value=POR_QUANTIDADE]')
        await page.fill('#mes14_k', '10')
        await page.dispatch_event('#mes14_k', 'input')
        info_k = await ev("document.getElementById('mes14_k_info').textContent")
        await page.click('#mes14_et_ok')
        await page.wait_for_timeout(900)
        e5 = await ev(f"data.etiquetas_producao.filter(e => e.CodOP === '{OP05}').map(e => Number(e.Quantidade))")
        ok(e5 == [10, 10, 10, 5] and '4 etiqueta' in info_k, '"un" com 10 por etiqueta: 35 un → 10 + 10 + 10 + 5 (4 etiquetas)', (e5, info_k))

        await tela_producao(OP06)
        await page.fill('#ap_qtd', '37')
        await page.click('text=Registrar produção e etiquetas')
        await page.wait_for_selector('#mes14_overlay')
        await page.check('#mes14_overlay input[value=POR_UNIDADE]')
        await page.click('#mes14_et_ok')
        await page.wait_for_timeout(900)
        await page.fill('#ap_qtd', '3')
        await page.click('text=Registrar produção e etiquetas')
        await page.wait_for_selector('#mes14_overlay')
        await page.check('#mes14_overlay input[value=AGLUTINADA]')
        await page.click('#mes14_et_ok')
        await page.wait_for_timeout(900)
        e6 = await ev(f"""(() => {{ const ets = data.etiquetas_producao.filter(e => e.CodOP === '{OP06}'), ps = data.producao.filter(p => p.CodOP === '{OP06}');
            return {{ n1: ets.filter(e => e.Modo === 'POR_UNIDADE').length, um: ets.filter(e => e.Modo === 'POR_UNIDADE').every(e => Number(e.Quantidade) === 1),
                     ag: ets.filter(e => e.Modo === 'AGLUTINADA').map(e => Number(e.Quantidade)), soma: ps.map(p => [p.NOP, ets.filter(e => e.NOP === p.NOP).reduce((s, e) => s + Number(e.Quantidade), 0), num(p['Quantidade produzida'])]),
                     q: data.op.find(o => o.CodOP === '{OP06}').QtdProduzida }}; }})()""")
        ok(e6['n1'] == 37 and e6['um'] and e6['ag'] == [3], '"un" uma por unidade (37 etiquetas de 1) e aglutinada (1 etiqueta de 3)', e6)
        ok(all(a == c for _, a, c in e6['soma']) and e6['q'] == '40', 'etiquetas somam exatamente cada apontamento; QtdProduzida = 40', e6['soma'])

        # ------------------------------------------------------------------ consumo do PI pela etiqueta
        await tela_producao(OP03)
        await page.fill('#mes14_pi_scan', 'ET000001')
        await page.press('#mes14_pi_scan', 'Enter')
        await page.wait_for_timeout(400)
        lido = await ev("({f: document.getElementById('mes14_pi_fonte').value, msg: document.getElementById('mes14_pi_scan_msg').textContent})")
        ok(lido['f'] == 'E:ET000001' and 'PI0001' in lido['msg'], 'leitura da etiqueta seleciona o PI e a etiqueta de origem', lido)
        await page.fill('#mes14_pi_ret', '0,85')
        await page.fill('#mes14_pi_dev', '0,05')
        await page.fill('#mes14_pi_per', '0,1')
        await page.select_option('#mes14_pi_cat', 'Refugo de processo')
        await page.select_option('#mes14_pi_mot', label='Contaminação')
        await page.click('text=Registrar consumo do PI')
        await page.wait_for_timeout(900)
        c1 = await ev(f"""(() => {{ const c = data.op_pi_consumos.filter(x => x.CodOPConsumidora === '{OP03}' && x.Origem === 'APONTAMENTO_PI');
            const p = data.perdas.find(x => x.IdConsumoPI === (c[0]||{{}}).IdConsumoPI) || {{}};
            const L = mesApontamentoPI14.livro(), lot = L.lotes[mesApontamentoPI14.idLote(data.op.find(o => o.CodOP === '{OP01}'))], et = L.porEtiqueta['ET000001'];
            return {{ c: c.map(x => [x.QuantidadeConsumida, x.QtdRetirada, x.QtdDevolvida, x.IdEtiqueta, x.PIExterno, x.CodOPPA, x.CodOPOrigemPI]),
                     p: [p.OrigemPerda, p.QuantidadePerdida, p.CodigoMaterial, p.Motivo, p.IdMotivo ? 1 : 0, p.IdEtiqueta], saldoLote: lot.Saldo, saldoEt: et.et.Saldo,
                     linha: mesApontamentoPI14.consumidoPelaOP('{OP03}', 'PI0001') }}; }})()""")
        ok(c1['c'] == [['0.8', '0.85', '0.05', 'ET000001', 'Não', '', OP01]], 'consumo do PI: retirado 0,85 − devolvido 0,05 = 0,8 da ET000001 (mesma família, sem custo herdado)', c1['c'])
        ok(c1['p'][:5] == ['DENTRO_DO_CONSUMO', '0,1', 'PI0001', 'Contaminação', 1], 'perda de 0,1 kg do slurry na etapa de coating registrada dentro do consumo, com motivo do cadastro', c1['p'])
        ok(perto(c1['saldoLote'], 0.1) and perto(c1['saldoEt'], 0.1) and perto(c1['linha'], 0.8), 'saldo do lote e da etiqueta: 0,9 − 0,8 = 0,1 (a perda dentro do consumo não baixa de novo)', c1)
        await page.fill('#mes14_pi_ret', '0,2')
        await page.fill('#mes14_pi_dev', '0')
        await page.fill('#mes14_pi_per', '0')
        await ev("document.getElementById('mes14_pi_fonte').value = 'E:ET000001'")
        await page.click('text=Registrar consumo do PI')
        await page.wait_for_timeout(500)
        bloq = await ev(f"({{n: data.op_pi_consumos.filter(x => x.CodOPConsumidora === '{OP03}' && x.Status !== 'CANCELADO').length, msg: document.getElementById('mes14_pi_msg').textContent}})")
        ok(bloq['n'] == 1 and 'Saldo insuficiente' in bloq['msg'], 'consumo acima do saldo da etiqueta é bloqueado', bloq)
        idc = await ev(f"data.op_pi_consumos.find(x => x.CodOPConsumidora === '{OP03}' && x.Status !== 'CANCELADO').IdConsumoPI")
        await ev(f"mesPIEstornar('{idc}')")
        await page.wait_for_timeout(300)
        await page.fill('#mes14_est_mot', 'teste de estorno')
        await page.click('#mes14_overlay button.danger')
        await page.wait_for_timeout(700)
        est = await ev(f"""(() => {{ const c = data.op_pi_consumos.find(x => x.IdConsumoPI === '{idc}'), L = mesApontamentoPI14.livro();
            return [c.Status, c.MotivoEstorno, L.porEtiqueta['ET000001'].et.Saldo, data.perdas.some(p => p.IdConsumoPI === '{idc}')]; }})()""")
        ok(est[0] == 'CANCELADO' and est[1] == 'teste de estorno' and perto(est[2], 0.9) and not est[3], 'estorno devolve 0,8 ao saldo da etiqueta e exclui a perda vinculada', est)
        await page.fill('#mes14_pi_scan', 'ET000001')
        await page.press('#mes14_pi_scan', 'Enter')
        await page.wait_for_timeout(300)
        await page.fill('#mes14_pi_ret', '0,9')
        await page.fill('#mes14_pi_dev', '0')
        await page.fill('#mes14_pi_per', '0')
        await page.click('text=Registrar consumo do PI')
        await page.wait_for_timeout(800)
        c2 = await ev("mesApontamentoPI14.livro().porEtiqueta['ET000001'].et.Saldo")
        ok(perto(c2, 0), 'consumo de toda a etiqueta: saldo zero', c2)

        # ------------------------------------------------------------------ Registro de Perdas com origem
        await tela_perdas(OP07)
        await page.select_option('#loss_alvo', 'Material')
        await page.wait_for_timeout(300)
        idx5 = await ev("[...document.getElementById('loss_item').options].find(o => /PI0005/.test(o.textContent)).value")
        await page.select_option('#loss_item', idx5)
        await page.wait_for_timeout(300)
        orig = await ev("document.getElementById('mes14_loss_origem').value")
        await page.select_option('#mes14_loss_origem', 'RETIRADA_ADICIONAL')
        await page.wait_for_timeout(200)
        await page.select_option('#mes14_loss_fonte', 'E:ET000002')
        await page.fill('#loss_qtd', '2')
        await page.select_option('#loss_tipo', 'Refugo de processo')
        await page.select_option('#loss_motivo', 'Contaminação')
        await page.click('text=Registrar perda')
        await page.wait_for_timeout(900)
        pl = await ev(f"""(() => {{ const p = data.perdas.filter(x => x.CodOP === '{OP07}' && x.CodigoMaterial === 'PI0005').pop() || {{}}, L = mesApontamentoPI14.livro();
            const lot = L.lotes[mesApontamentoPI14.idLote(data.op.find(o => o.CodOP === '{OP05}'))];
            return {{ p: [p.OrigemPerda, p.IdEtiqueta, p.IdLotePI ? 1 : 0, p.PIExterno, p.Motivo, p.IdMotivo ? 1 : 0], saldo: lot.Saldo, et: L.porEtiqueta['ET000002'].et.Saldo }}; }})()""")
        ok(orig == 'RETIRADA_ADICIONAL' and pl['p'] == ['RETIRADA_ADICIONAL', 'ET000002', 1, 'Não', 'Contaminação', 1], 'perda de PI por retirada adicional ligada à etiqueta (sem consumo apontado o padrão é retirada adicional)', (orig, pl))
        ok(perto(pl['saldo'], 33) and perto(pl['et'], 8), 'saldo: lote 35 − 2 = 33; etiqueta ET000002 10 − 2 = 8', pl)
        n_antes = await ev("data.perdas.length")
        await page.select_option('#loss_alvo', 'Material')
        await page.wait_for_timeout(300)
        idx6 = await ev("[...document.getElementById('loss_item').options].find(o => /PI0006/.test(o.textContent)).value")
        await page.select_option('#loss_item', idx6)
        await page.wait_for_timeout(300)
        await page.select_option('#mes14_loss_origem', 'DENTRO_DO_CONSUMO')
        await page.fill('#loss_qtd', '1')
        await page.select_option('#loss_motivo', 'Contaminação')
        dialogos.clear()
        await page.click('text=Registrar perda')
        await page.wait_for_timeout(500)
        ok(await ev("data.perdas.length") == n_antes and any('passa do consumo apontado' in d for d in dialogos), 'perda "dentro do consumo" maior que o consumo apontado é bloqueada', dialogos[-1:])
        # material: retirada adicional com lote baixa o estoque do lote
        await ev("""() => { data.entradas.push({Entrada: 'EN9999', 'CódigoMaterial': 'MP0013', DescricaoMaterial: 'Alumínio', QtdAdquirida: '10', UnidadeMedida: 'm', 'Custo R$': '20', 'ValorUnitario (R$/UM)': '2', Lote: 'AL-TESTE-14', DataCadatro: '01/11/2026'}); saveLocal(); }""")
        saldo_mp0 = await ev("mesEstoqueAPI.linhas().find(l => l.Entrada === 'EN9999').Saldo")
        await tela_perdas(OP03)
        await page.select_option('#loss_alvo', 'Material')
        await page.wait_for_timeout(300)
        idxm = await ev("[...document.getElementById('loss_item').options].find(o => /MP0013/.test(o.textContent)).value")
        await page.select_option('#loss_item', idxm)
        await page.wait_for_timeout(300)
        await page.select_option('#mes14_loss_origem', 'RETIRADA_ADICIONAL')
        await page.wait_for_timeout(200)
        await page.select_option('#mes14_loss_fonte', 'N:EN9999')
        await page.fill('#loss_qtd', '0.5')
        await page.select_option('#loss_motivo', 'Contaminação')
        await page.click('text=Registrar perda')
        await page.wait_for_timeout(900)
        mp = await ev(f"""(() => {{ const p = data.perdas.filter(x => x.CodOP === '{OP03}' && x.CodigoMaterial === 'MP0013').pop() || {{}};
            return {{ p: [p.OrigemPerda, p.EntradaMaterial, p.Lote], saldo: mesEstoqueAPI.linhas().find(l => l.Entrada === 'EN9999').Saldo,
                     custo: v102MaterialLossCost(p, data.op.find(o => o.CodOP === '{OP03}')).total }}; }})()""")
        ok(mp['p'] == ['RETIRADA_ADICIONAL', 'EN9999', 'AL-TESTE-14'] and perto(saldo_mp0 - mp['saldo'], 0.5), 'perda de material por retirada adicional com lote baixa 0,5 m do lote no estoque', (saldo_mp0, mp))
        ok(perto(mp['custo'], 1.0), 'custo da perda de material por retirada adicional = 0,5 m × R$ 2,00 = R$ 1,00', mp['custo'])

        # ------------------------------------------------------------------ custo e CO₂ sem dupla contagem
        dc = await ev(f"""(() => {{
            const op3 = data.op.find(o => o.CodOP === '{OP03}'), op7 = data.op.find(o => o.CodOP === '{OP07}');
            const fake = {{CodOP: '{OP03}', PerdaAlvoTipo: 'Material', CodigoMaterial: 'PI0001', ItemPerdaCodigo: 'PI0001', QuantidadePerdida: '0,1', OrigemPerda: 'DENTRO_DO_CONSUMO'}};
            const p7 = data.perdas.filter(x => x.CodOP === '{OP07}' && x.CodigoMaterial === 'PI0005').pop();
            const acv = perdasMateriaisOPV391('{OP07}').map(p => p.CodigoMaterial);
            const a = auditCostFamilyV4014('{OPPA}'), linhaPI = (a.perdas||[]).filter(r => /PI0005|Eletrodo Cortado C/.test(r.Item || ''));
            return {{ dentro: v102MaterialLossCost(fake, op3).total, familia: v102MaterialLossCost(p7, op7).total, acv: acv, audit: linhaPI.map(r => r.Resultado) }};
        }})()""")
        ok(dc['dentro'] == 0 and dc['familia'] == 0, 'custo de perda: dentro do consumo = 0 e PI da própria família = 0 (já contados)', dc)
        ok('PI0005' not in dc['acv'], 'ACV: perda de PI da própria família não entra de novo como perda de material', dc['acv'])
        ok(dc['audit'] and all(v == 0 for v in dc['audit']), 'auditoria de custo da família mostra a perda de PI com resultado 0', dc['audit'])

        # ------------------------------------------------------------------ PI de PI isolado (outra família): custo herdado na proporção consumida
        ets_ext = await ev("""(() => {
            const op = {CodOP: 'OPTESTE14-PI', CodRoteiro: '', CodigoProduto: 'PI0001', CodigoPI: 'PI0001', Produto: 'PI0001', DescricaoProduto: 'Slurry Cátodo PA0001', QtdPlanejada: '2',
                        QtdProduzida: '2', UM: 'kg', Status: 'Concluída', TipoOP: 'PI', OP_Base: 'OPTESTE14-PI', OP_Pai: '', OrigemGeracao: 'PI_ISOLADO', DataEncerramento: '01/11/2026 10:00'};
            data.op.push(op);
            const r = {NOP: 'PROD9901', CodOP: op.CodOP, Produto: 'PI0001', ProdutoApontado: 'PI0001', 'Unidade de medida': 'kg', 'Quantidade produzida': '2', QuantidadeProduzida: '2', Processo: 'Mistura Cátodo', DataApontamento: '01/11/2026'};
            data.producao.push(r);
            data.custos_op.push({CodOP: op.CodOP, CodOPMae: '', Escopo: 'PI ISOLADO', CustoTotal: '20', CustoMateriais: '16', CustoEnergia: '3', CustoMOD: '1', CustoPerdas: '0', QuantidadeBaseCusto: '2', CustoUnitario: '10', CustoFechado: 'SIM', FonteCusto: 'ENCERRAMENTO_OP'});
            const ets = mesApontamentoPI14.criarEtiquetas(r, op, 'UNICA', 0);
            saveLocal();
            return ets.map(e => e.IdEtiqueta);
        })()""")
        antes = await ev(f"(() => {{ const r = auditCostFamilyV4014('{OPPA}').resumo[0]; return [r.CustoTotal, r.CustoMateriais, r.CustoEnergia, r.CustoMOD]; }})()")
        await tela_producao(OP03)
        await page.fill('#mes14_pi_scan', ets_ext[0])
        await page.press('#mes14_pi_scan', 'Enter')
        await page.wait_for_timeout(400)
        scan_ext = await ev("document.getElementById('mes14_pi_scan_msg').textContent")
        await page.fill('#mes14_pi_ret', '0,5')
        await page.fill('#mes14_pi_dev', '0')
        await page.fill('#mes14_pi_per', '0')
        await page.click('text=Registrar consumo do PI')
        await page.wait_for_timeout(900)
        cx = await ev(f"""(() => {{ const c = data.op_pi_consumos.filter(x => x.IdEtiqueta === '{ets_ext[0]}').map(x => [x.PIExterno, x.CodOPPA, Number(x.QuantidadeConsumida), x.CodOPOrigemPI]);
            const r = auditCostFamilyV4014('{OPPA}').resumo[0]; return {{ c: c, depois: [r.CustoTotal, r.CustoMateriais, r.CustoEnergia, r.CustoMOD] }}; }})()""")
        delta = [round(cx['depois'][i] - antes[i], 6) for i in range(4)]
        ok('outra família' in scan_ext and cx['c'] == [['Sim', OPPA, 0.5, 'OPTESTE14-PI']], 'etiqueta de PI isolado consumida na OP de coating: consumo externo ligado à família do PA', (scan_ext, cx['c']))
        ok(delta == [5.0, 4.0, 0.75, 0.25], 'custo da família herda 0,5/2 do custo fechado do PI isolado: +R$ 5,00 (4,00 mat + 0,75 energia + 0,25 MOD)', (antes, cx['depois'], delta))

        # ------------------------------------------------------------------ tempo por máquina
        await tela_producao(OP01)
        maq = await ev("[...document.getElementById('mes14_tp_maq').options].map(o => [o.value, o.textContent])")
        mist = next(v for v, t in maq if 'Misturador' in t)
        filtro = next(v for v, t in maq if 'Filtro' in t)
        e0 = await ev(f"opEnergyKWh('{OP01}')")
        etapas = await ev(f"data.op_etapas.filter(e => e.CodOP === '{OP01}').map(e => [e.IdRecursoRoteiro, e.Recurso || e.Equipamento, num(e.PotenciaEquipamento), num(e.TempoOperacaoMin || e.TempoPlanejado)])")
        await page.select_option('#mes14_tp_maq', mist)
        await page.fill('#mes14_tp_dini', ontem); await page.fill('#mes14_tp_hini', '08:00')
        await page.fill('#mes14_tp_dfim', ontem); await page.fill('#mes14_tp_hfim', '10:30')
        await page.click('text=Registrar intervalo informado (início e fim)')
        await page.wait_for_timeout(800)
        t1 = await ev(f"data.op_etapas.filter(e => e.CodOP === '{OP01}').map(e => [e.IdRecursoRoteiro, e.TempoReal || ''])")
        ok([x for x in t1 if x[0] == mist] == [[mist, '150']] and all(x[1] == '' for x in t1 if x[0] != mist), 'intervalo de 08:00 a 10:30 no Misturador: tempo real 150 min só nessa máquina', t1)
        await page.select_option('#mes14_tp_maq', mist)
        await page.fill('#mes14_tp_dini', ontem); await page.fill('#mes14_tp_hini', '09:00')
        await page.fill('#mes14_tp_dfim', ontem); await page.fill('#mes14_tp_hfim', '09:30')
        await page.click('text=Registrar intervalo informado (início e fim)')
        await page.wait_for_timeout(500)
        sob = await ev(f"({{n: data.apontamento_tempos.filter(t => t.CodOP === '{OP01}').length, msg: document.getElementById('mes14_tp_msg').textContent}})")
        ok(sob['n'] == 1 and 'sobrepõe' in sob['msg'], 'intervalo sobreposto na mesma máquina é bloqueado', sob)
        await page.select_option('#mes14_tp_maq', filtro)
        await page.fill('#mes14_tp_dini', ontem); await page.fill('#mes14_tp_hini', '11:00')
        await page.click('text=▶ Iniciar na máquina')
        await page.wait_for_timeout(700)
        aberto = await ev(f"data.apontamento_tempos.filter(t => t.CodOP === '{OP01}' && t.Status === 'Iniciado').map(t => [t.IdRecursoRoteiro, t.HoraInicio])")
        await page.fill('#mes14_tp_dfim', ontem); await page.fill('#mes14_tp_hfim', '11:40')
        await page.click('text=■ Finalizar na máquina')
        await page.wait_for_timeout(700)
        t2 = await ev(f"data.apontamento_tempos.filter(t => t.CodOP === '{OP01}' && t.IdRecursoRoteiro === '{filtro}').map(t => [t.Status, t.DuracaoMin])")
        ok(aberto == [[filtro, '11:00']] and t2 == [['Finalizado', '40']], 'iniciar às 11:00 e finalizar às 11:40 no Filtro: 40 min', (aberto, t2))
        e1 = await ev(f"opEnergyKWh('{OP01}')")
        esperado = 0.0
        for rid, nome, pot, plan in etapas:
            minutos = 150 if rid == mist else (40 if rid == filtro else plan)
            esperado += pot / 1000 * minutos / 60
        ok(perto(e1, esperado, 1e-6) and not perto(e0, e1), f'energia da OP usa o tempo real das máquinas apontadas ({e0:.4f} → {e1:.4f} kWh)', (e0, e1, esperado))
        tp_srv, sim = await esperar_servidor(lambda d: any(t.get('IdRecursoRoteiro') == mist and t.get('DuracaoMin') == '150' for t in d.get('apontamento_tempos') or []))
        ok(sim, 'apontamentos de tempo por máquina gravados no servidor')
        # calendário: o histórico casa o apontamento com o cartão da mesma máquina (não com todas as máquinas da etapa)
        await ev("render('pcp_calendario')")
        await page.wait_for_timeout(900)
        cal = await ev(f"""(() => {{ if (typeof mesAtualizarHistoricoPcp === 'function') mesAtualizarHistoricoPcp();
            const et = data.op_etapas.filter(e => e.CodOP === '{OP01}');
            return et.map(e => {{ const p = (data.pcp_programacao||[]).find(x => x.OP === '{OP01}' && String(x.IdRecursoRoteiro||'') === String(e.IdRecursoRoteiro||'')) || {{}};
                return [e.IdRecursoRoteiro, p.Congelado || '', p.SituacaoExecucao || '', p.Inicio || '', p.Fim || '']; }}); }})()""")
        mapa = {c[0]: c for c in cal}
        ok(mapa.get(mist, [None, ''])[1:4] == ['Sim', 'EXECUTADA', ontem + ', 08:00'] and mapa[mist][4] == ontem + ', 10:30'
           and mapa.get(filtro, [None, ''])[1:3] == ['Sim', 'EXECUTADA'] and all(c[1] != 'Sim' for c in cal if c[0] not in (mist, filtro)),
           'calendário: Misturador e Filtro congelados no horário real; a Estufa (sem apontamento) continua programável', cal)

        # ------------------------------------------------------------------ baixa automática no encerramento
        await tela_producao(OP02)
        await page.fill('#ap_qtd', '1.5')
        await page.click('text=Registrar produção e etiquetas')
        await page.wait_for_timeout(900)
        await ev(f"render('op'); setTimeout(() => {{ document.getElementById('selOp').value = '{OP04}'; showOP(); }}, 80)")
        await page.wait_for_timeout(900)
        dialogos.clear()
        await ev("encerrarOPSelecionada('selOp')")
        await page.wait_for_timeout(1200)
        bx = await ev(f"""(() => {{ const c = data.op_pi_consumos.filter(x => x.CodOPConsumidora === '{OP04}' && x.Origem === 'BAIXA_AUTOMATICA_ENCERRAMENTO'), L = mesApontamentoPI14.livro();
            return {{ c: c.map(x => [x.CodigoPI, Number(x.QuantidadeConsumida), x.CodOPOrigemPI]), st: data.op.find(o => o.CodOP === '{OP04}').Status,
                     saldo: L.lotes[mesApontamentoPI14.idLote(data.op.find(o => o.CodOP === '{OP02}'))].Saldo }}; }})()""")
        ok(re.search('conclu', bx['st'] or '', re.I) and bx['c'] == [['PI0002', 1.4848, OP02]] and perto(bx['saldo'], 0.0152), 'OP de coating encerrada sem apontar o slurry: baixa automática do planejado (1,4848 de 1,5 kg; sobra 0,0152)', bx)
        ok(any('Baixa automática' in d for d in dialogos), 'o encerramento avisa a baixa automática', dialogos[-2:])
        # 1.6.1: OP encerrada só com o consumo real (custo e CO₂)
        ok(any('Material planejado sem consumo apontado nesta OP' in d and 'MP0014' in d and 'fora do custo' in d for d in dialogos),
           '1.6.1: o encerramento avisa o material planejado sem consumo (MP0014, 1,72 m), que fica fora do custo e do CO₂', dialogos[-3:])
        r161 = await ev(f"""(() => {{ const a = auditCostFamilyV4014('{OPPA}'), m = a.materiais.find(x => x.OP === '{OP04}' && x.CodigoMaterial === 'MP0014') || {{}};
            const m3 = a.materiais.find(x => x.OP === '{OP03}' && x.CodigoMaterial === 'MP0013') || {{}}, cons3 = data.consumos_materiais.some(c => c.CodOP === '{OP03}' && c.CodigoMaterial === 'MP0013');
            const acv = JSON.parse(calcSustFamiliaOPV33('{OPPA}', false, {{}}).AuditoriaCO2JSON || '[]');
            return {{ m: [m.Quantidade, m.QtdPlanejada, m.Resultado, m['Origem custo']], m3: [m3['Origem custo'] || '', m3.Resultado, cons3], st3: data.op.find(o => o.CodOP === '{OP03}').Status,
                     acv04: acv.filter(x => x.Tipo === 'CONSUMO' && x.OP === '{OP04}' && x.CodigoMaterial === 'MP0014').length, acv03: acv.filter(x => x.Tipo === 'CONSUMO' && x.OP === '{OP03}' && x.CodigoMaterial === 'MP0013').length }}; }})()""")
        ok(r161['m'][0] == 0 and perto(r161['m'][1], 1.72) and r161['m'][2] == 0 and 'fora do custo' in r161['m'][3] and r161['acv04'] == 0,
           '1.6.1: OP -04 encerrada: MP0014 planejado sem consumo fica com valor 0 no custo e sai da ACV', r161)
        ok(not re.search('conclu', r161['st3'] or '', re.I) and not r161['m3'][2] and r161['m3'][0].startswith('Projetado') and r161['m3'][1] > 0 and r161['acv03'] == 1,
           '1.6.1: OP -03 ainda aberta continua com o custo projetado do MP0013 (e na ACV)', r161)

        # ------------------------------------------------------------------ estoque de PI e PA
        await ev("render('estoque_pi_pa')")
        await page.wait_for_timeout(900)
        est_tela = await ev("""({titulo: document.getElementById('title').textContent, aba: (document.querySelector('#mbc_stock_tabs button.on')||{}).dataset.v,
            linhas: [...document.querySelectorAll('#v47_stock_tbl tbody tr')].map(t => [...t.children].map(c => c.textContent.trim()))})""")
        pi5 = next((l for l in est_tela['linhas'] if len(l) > 8 and l[1] == 'PI0005'), None)
        ok(est_tela['aba'] == 'pipa' and 'PI e PA' in est_tela['titulo'] and pi5 and pi5[4:11] == ['70', '35', '2', '0', '33', '35', '-2'],
           'Estoque › PI e PA prontos: PI0005 produzido 70 (2 lotes), consumido 35 (família antiga), perdido 2, saldo 33, reservado 35 para o jelly roll → disponível −2', (est_tela['titulo'], pi5))
        await ev("window.__mes14Sub = 'etiqueta'; mesEstoquePI14()")
        await page.wait_for_timeout(500)
        n_et = await ev("document.querySelectorAll('.mes14-et-sel').length")
        ok(n_et == 1 + 4 + 38 + 1 + 1, 'visão por etiqueta lista as 45 etiquetas geradas', n_et)
        await page.fill('#mes14_est_scan', 'ET000002')
        await page.press('#mes14_est_scan', 'Enter')
        await page.wait_for_timeout(500)
        tr = await ev("(document.querySelector('#mes14_overlay .mes14-trace')||{}).innerText || ''")
        ok('Para trás' in tr and 'Para frente' in tr and OP05 in tr and 'perda' in tr, 'leitura da etiqueta abre o rastreio (origem na OP -05, perda na OP -07)', tr[:300])
        await ev("mesFecharDialogo14()")
        await ev("mesBaixaPI14('ET000006', '')")
        await page.wait_for_timeout(300)
        await page.fill('#mes14_bx_q', '1')
        await page.select_option('#mes14_bx_m', 'Amostra / ensaio')
        await page.click('text=Confirmar baixa')
        await page.wait_for_timeout(600)
        bxa = await ev(f"(() => {{ const L = mesApontamentoPI14.livro(); return [L.lotes[mesApontamentoPI14.idLote(data.op.find(o => o.CodOP === '{OP06}'))].Saldo, L.porEtiqueta['ET000006'].et.Saldo, (data.estoque_pi_ajustes||[]).length]; }})()")
        ok(perto(bxa[0], 39) and perto(bxa[1], 0) and bxa[2] == 1, 'baixa de 1 un (amostra) da ET000006: lote 40 → 39', bxa)
        await ev("mesEstornarBaixaPI14(data.estoque_pi_ajustes[0].IdAjustePI)")
        await page.wait_for_timeout(600)
        ok(await ev(f"mesApontamentoPI14.livro().lotes[mesApontamentoPI14.idLote(data.op.find(o => o.CodOP === '{OP06}'))].Saldo") == 40, 'estorno da baixa devolve o saldo (40)')
        await ev("mesCancelarEtiqueta14('ET000007')")
        await page.wait_for_timeout(600)
        canc = await ev(f"(() => {{ const L = mesApontamentoPI14.livro(), lot = L.lotes[mesApontamentoPI14.idLote(data.op.find(o => o.CodOP === '{OP06}'))]; return [data.etiquetas_producao.find(e => e.IdEtiqueta === 'ET000007').Status, lot.SemEtiqueta, lot.Saldo, !!L.porEtiqueta['ET000007']]; }})()")
        ok(canc == ['CANCELADA', 1, 40, False], 'etiqueta sem movimento cancelada: a unidade volta para "sem etiqueta" e o saldo do lote não muda', canc)
        await ev("window.__mes14Sub = 'conf'; mesEstoquePI14()")
        await page.wait_for_timeout(500)
        conf = await ev("[...document.querySelectorAll('#v47_stock_tbl tbody tr')].map(t => [t.children[0].textContent.trim(), t.children[1].textContent.trim()])")
        regras_ok = {r: s for s, r in conf}
        ok(regras_ok.get('Quantidade produzida da OP = soma dos apontamentos') == 'OK' and regras_ok.get('Nenhum lote de PI/PA com saldo negativo') == 'OK'
           and regras_ok.get('Etiquetas não passam da produção apontada') == 'OK', 'conferência: quantidade produzida, saldo não negativo e etiquetas batem', conf)
        cfx = await ev("([...document.querySelectorAll('#v47_stock_tbl tbody tr')].find(t => /Custo gravado/.test(t.textContent)) || {}).textContent || ''")
        ok(FAM_FECHADA + '-PA' in cfx and 'base 2 × apontado 1' in cfx, 'conferência aponta o custo antigo dividido por 2 células (a produção apontada é 1)', cfx[:300])
        await ev(f"mesRefazerCustoFechado14('{FAM_FECHADA}-PA')")
        await page.wait_for_timeout(900)
        cf2 = await ev(f"(() => {{ const r = v104SavedCost('{FAM_FECHADA}-PA'); return [r.CustoFechado, Number(r.QuantidadeBaseCusto), Math.abs(Number(r.CustoUnitario) - Number(r.CustoTotal)) < 1e-9]; }})()")
        ok(cf2 == ['SIM', 1, True], '"Refazer" grava o custo fechado com quantidade-base 1 (custo unitário = custo total da célula)', cf2)
        await ev("window.__mes14Sub = 'produto'")

        # ------------------------------------------------------------------ exclusão de produção com etiqueta consumida
        dialogos.clear()
        await ev(f"(() => {{ const i = data.producao.findIndex(p => p.CodOP === '{OP01}'); excluirApontamentoOP('producao', i, '{OP01}'); }})()")
        await page.wait_for_timeout(400)
        ok(any('Estorne' in d for d in dialogos) and await ev(f"data.producao.filter(p => p.CodOP === '{OP01}').length") == 1, 'exclusão de produção com etiqueta já consumida é bloqueada', dialogos[-1:])

        # ------------------------------------------------------------------ 1.6.1: consumo acima do saldo do lote, UM no estoque, MRP
        await tela_producao(OP01)
        await ev("""(() => { const s = document.getElementById('cm_mat_v3814'); const i = [...s.options].findIndex(o => /MP0001/.test(o.textContent)); s.value = s.options[i].value; atualizarLotesConsumoV3814(); })()""")
        await page.wait_for_timeout(300)
        opc = await ev("[...document.getElementById('cm_lote_v3814').options].map(o => [o.value, o.textContent])")
        en1 = next((t for v, t in opc if v == 'EN0001'), '')
        ok('saldo 0,4091 kg' in en1, '1.6.1: a lista de lotes do consumo mostra o saldo atual do lote (EN0001: 0,4091 kg)', opc)
        await ev("document.getElementById('cm_lote_v3814').value = 'EN0001'; document.getElementById('cm_ret_v3814').value = '0.5'; document.getElementById('cm_dev_v3814').value = '0'")
        n0 = await ev("data.consumos_materiais.length")
        msg = await ev("""(() => { const c = window.confirm; let m = null; window.confirm = x => { m = x; return false; }; try { registrarConsumoMaterialV3814(); } finally { window.confirm = c; } return m; })()""")
        n1 = await ev("data.consumos_materiais.length")
        ok(msg and 'Consumo acima do saldo do lote EN0001' in msg and 'saldo do lote: 0,4091 kg' in msg and '-0,0909 kg' in msg and n1 == n0,
           '1.6.1: consumo maior que o saldo do lote pede confirmação; sem confirmar, nada é registrado', (msg, n0, n1))
        await ev("registrarConsumoMaterialV3814()")
        await page.wait_for_timeout(900)
        c161 = await ev(f"""(() => {{ const c = data.consumos_materiais[data.consumos_materiais.length - 1], l = mesLinhasEstoque().find(x => x.Entrada === 'EN0001');
            const z = mesNecessidadesMRP([data.op.find(o => o.CodOP === '{OP01}')]).find(x => x.Item === 'MP0001') || {{}};
            const res = mesReservasOPs().find(x => x.CodOP === '{OP01}' && x.CodigoMaterial === 'MP0001') || {{}};
            return {{ c: [c.CodOP, c.CodigoMaterial, c.Entrada, c.AcimaDoSaldo, c.SaldoLoteAntes, c.ConsumoLiquido], l: [l.Saldo, l.StatusSaldo],
                     z: [z.Planejado, z.JaConsumido, z.NecessidadeBruta], res: [res.Planejado, res.Consumido, res.Reservado] }}; }})()""")
        ok(c161['c'] == [OP01, 'MP0001', 'EN0001', 'Sim', '0.4091', '0.5'] and perto(c161['l'][0], -0.0909) and c161['l'][1] == 'NEGATIVO',
           '1.6.1: confirmado, o consumo fica marcado (acima do saldo, saldo antes 0,4091 kg) e o lote aparece NEGATIVO', c161)
        ok(perto(c161['z'][0], 0.4478) and perto(c161['z'][1], 0.5) and c161['z'][2] == 0 and perto(c161['res'][1], 0.5) and c161['res'][2] == 0,
           '1.6.1: MRP e reserva da OP -01 descontam o que ela já consumiu (planejado 0,4478 − consumido 0,5 → nada a consumir)', c161)
        uml = await ev("""(() => { const l = mesLinhasEstoque().find(x => x.Entrada === 'EN0016'), m = mesResumoMateriaisEstoque().find(x => x.CodigoMaterial === 'MP0016');
            return [l.Saldo, l.UM, m.SaldoFisico, m.UM, mesEstoqueAPI.converterUM(1, 'kg', 'L', 'MP0016').q, mesEstoqueAPI.converterUM(500, 'g', 'kg', 'MP0001').q,
                    mesEstoqueAPI.converterUM(2, 'un', 'kg', 'MP0018').q, mesEstoqueAPI.converterUM(1, 'L', 'm', 'MP0016').ok]; })()""")
        ok(perto(uml[0], 0.832) and uml[1] == 'kg' and perto(uml[2], 0.832 / 1.12) and uml[3] == 'L' and perto(uml[4], 1 / 1.12) and perto(uml[5], 0.5) and perto(uml[6], 0.44) and uml[7] is False,
           '1.6.1: consumo em L desconta do lote em kg pelo fator do material (EN0016: 1 − 0,15 L × 1,12 = 0,832 kg; 0,7429 L na visão por material); sem regra, não converte', uml)
        await ev("render('estoque')")
        await page.wait_for_timeout(800)
        await ev("mesEstoqueVisao('lote')")
        await page.wait_for_timeout(400)
        tx = await page.inner_text('#v47_stock_tbl')
        ok('NEGATIVO' in tx and 'saldo negativo' in tx, '1.6.1: o Estoque mostra o lote NEGATIVO e o aviso de saldo negativo', tx[:300])

        # ------------------------------------------------------------------ servidor
        d, sim = await esperar_servidor(lambda d: len(d.get('etiquetas_producao') or []) == 45 and any(c.get('Origem') == 'BAIXA_AUTOMATICA_ENCERRAMENTO' for c in d.get('op_pi_consumos') or [])
                                        and len(d.get('roteiro_pi_entradas') or []) >= 14 and len(d.get('perdas_motivos') or []) >= 2)
        ok(any(c.get('AcimaDoSaldo') == 'Sim' and c.get('Entrada') == 'EN0001' for c in (d or {}).get('consumos_materiais') or []), '1.6.1: consumo acima do saldo gravado no servidor com a marca', '')
        ok(sim, 'etiquetas, consumos de PI, fluxo do roteiro e motivos gravados no servidor',
           (len((d or {}).get('etiquetas_producao') or []), len((d or {}).get('roteiro_pi_entradas') or []), len((d or {}).get('perdas_motivos') or [])))

        # F5: tudo continua
        await page.reload(wait_until='load')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1800)
        f5 = await ev(f"""(() => {{ const L = mesApontamentoPI14.livro();
            return [L.porEtiqueta['ET000002'].et.Saldo, data.op_pi_consumos.filter(c => c.Origem === 'BAIXA_LEGADO_1.4.0').length, data.op.find(o => o.CodOP === '{OP01}').QtdProduzida,
                    data.op_etapas.find(e => e.CodOP === '{OP01}' && e.IdRecursoRoteiro === '{mist}').TempoReal]; }})()""")
        ok(f5 == [8, 7, '0,9', '150'], 'depois do F5: saldos, baixa única das OPs antigas (sem repetir), QtdProduzida e tempo real mantidos', f5)
        ok(not erros, 'nenhum erro JavaScript', erros[:5])
        await b.close()

    print(f'\n== {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print('FALHAS:')
        for f in falhas: print(' -', f)
        sys.exit(1)


asyncio.run(main())
