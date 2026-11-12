#!/usr/bin/env python3
"""
Teste no navegador da versão JSON 1.7.0 — paradas de máquina, testes das células e o menu Painéis:
  - menus: Produção ganha Paradas de máquina, Motivos de parada e Testes das células; o grupo "Painéis" (Painéis,
    Indicadores, Tabelas e relações) fica antes de Relatórios;
  - ver painéis, indicadores e tabelas não grava nada no servidor nem altera os dados (as funções dos módulos que
    regravam campos ao calcular ficam sem efeito);
  - motor dos painéis com os números das funções dos módulos: custo da família (módulo Custos), custo unitário e os
    componentes, perdas, kWh e CO₂ da Sustentabilidade, células produzidas; perda de material com a regra do custo
    (retirada adicional entra no material usado); unidades diferentes nunca somadas; "faltam dados" com a cobertura;
    "não se relaciona" quando a tabela não tem a dimensão; acumulado; cálculo aberto passo a passo e os registros;
  - travas das fórmulas: campo fora de agregação, taxa não se soma, condição de outra tabela, função/tabela/campo/
    indicador desconhecidos, conta com texto, referência circular direta e indireta, oficial só usa oficial;
  - paradas: motivos com categoria (planejada ou não) sem duplicar, intervalo com duração, sobreposição recusada,
    parada aberta pelo apontamento da OP e encerrada; os minutos parados chegam ao painel;
  - testes das células: energia e capacidade medidas por célula da OP de PA, resumo da OP, o passaporte com a média
    MEDIDA e os indicadores de energia gerada (kWh gerado, células testadas, razão gerada ÷ consumida);
  - painéis modelo por área, filtro do painel e filtro cruzado pelo clique, editor do bloco ("+" e arrastar), regra de
    cálculo conferida na hora, componentes do indicador, layout sem sobreposição, modo TV;
  - indicadores: montador de sub-indicador, renomear atualiza as fórmulas e os blocos, excluir bloqueado quando usado;
  - Excel do bloco, do painel e dos registros (openpyxl) e cada exportação no Histórico de Modificações;
  - fechar o mês grava o valor dos indicadores oficiais (só o administrador; mês corrente recusado);
  - usuário comum: não cria nem altera indicador oficial, não fecha mês, vê os painéis compartilhados sem editar,
    cria os próprios indicadores e painéis.

Uso: python teste_paineis_json.py <url_base>
"""
import sys, os, re, json, asyncio, time, datetime, tempfile
import requests
import openpyxl
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0
PASTA = tempfile.mkdtemp(prefix='mes_paineis_')

FAM = 'OP20260812094138'          # família encerrada dos dados de teste (OP de PA com 1 célula produzida)
OPPA = FAM + '-PA'
FAM_ABERTA = 'OP20260812101715'   # família aberta (PA ainda sem produção)
MES_DADOS = '2026-08'
EXCLUIR = ['indicadores', 'paineis', 'paineis_fechamentos']
JS_FOTO = "JSON.stringify(Object.keys(data).filter(k => !%s.includes(k)).sort().map(k => [k, data[k]]))" % json.dumps(EXCLUIR)


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {str(det)[:700]}'), flush=True)
    if not c: falhas.append(f'{nome}: {str(det)[:700]}')


def perto(a, b, tol=1e-6):
    try:
        return abs(float(a) - float(b)) <= tol * max(1.0, abs(float(b)))
    except Exception:
        return False


def linhas_xlsx(ws):
    return [[c.value for c in r] for r in ws.iter_rows()]


# números das funções dos próprios módulos (Custos e Sustentabilidade), com a gravação desligada; a página é
# recarregada depois, para nada do que elas regravam na memória sobrar para o resto do teste
JS_MODULOS = """() => {
  const sv = window.saveLocal; window.saveLocal = function () {};
  try {
    const r = v4033CostScope('%s', false).row, s = calcSustFamiliaOPV33('%s', false, {});
    const ops = {}; data.op.forEach(o => ops[String(o.CodOP).trim()] = o);
    const taxa = {};
    ['MP0013', 'MP0014', 'MP0015'].forEach(m => {
      const ps = data.perdas.filter(p => String(p.CodigoMaterial || p.ItemPerdaCodigo || '') === m && ops[String(p.CodOP || '').trim()]);
      const L = ps.reduce((a, p) => a + num(p.QuantidadePerdida), 0), adic = ps.filter(p => p.OrigemPerda !== 'DENTRO_DO_CONSUMO').reduce((a, p) => a + num(p.QuantidadePerdida), 0);
      const C = data.consumos_materiais.filter(c => String(c.CodigoMaterial) === m && ops[String(c.CodOP || '').trim()])
        .reduce((a, c) => a + ((c.ConsumoLiquido !== undefined && c.ConsumoLiquido !== null && String(c.ConsumoLiquido) !== '') ? num(c.ConsumoLiquido) : num(c.QtdRetirada) - num(c.QtdDevolvida)), 0);
      taxa[m] = { L: L, C: C, adic: adic, t: L / (C + adic) };
    });
    return { total: num(r.CustoTotal), mat: num(r.CustoMateriais), en: num(r.CustoEnergia), mod: num(r.CustoMOD), perdas: num(r.CustoPerdas), kwh: num(r.EnergiaKWh),
      co2: num(s.CO2eqTotal), kwhSust: num(s.EnergiaKWh), taxa: taxa, nOficiais: mesPaineisAPI.oficiais().length };
  } finally { window.saveLocal = sv; }
}""" % (OPPA, OPPA)

# indicadores oficiais calculados pelo motor (todo o período, sem filtro)
JS_OFICIAIS = """() => { const api = mesPaineisAPI; api.novaSessao(); const o = {};
  api.oficiais().forEach(id => { const r = api.executar({ valores: [{ indicador: id }] }, {}, false); o[id] = Object.assign({}, r.geral[0], { cobertura: r.cobertura }); });
  return o; }"""


async def main():
    hoje = datetime.date.today().isoformat()
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
        page = await ctx.new_page()
        erros, dialogos, escritas = [], [], []
        logado = {'v': False}
        page.on('pageerror', lambda e: erros.append(str(e)))
        page.on('console', lambda m: erros.append('console: ' + m.text) if logado['v'] and m.type == 'error' and 'MES LION 1.7' in m.text else None)
        page.on('request', lambda r: escritas.append((r.method, r.url)) if r.method in ('POST', 'PUT', 'PATCH', 'DELETE') else None)

        def dialogo(d):
            dialogos.append(d.message)
            asyncio.ensure_future(d.accept())
        page.on('dialog', dialogo)
        ev = page.evaluate

        async def cookies(c=None):
            return {k['name']: k['value'] for k in await (c or ctx).cookies()}

        async def dados_servidor(c=None):
            return requests.get(BASE + '/api/bootstrap', cookies=await cookies(c), timeout=180).json()['data']

        async def auditoria(de, ate, limite=3000):
            r = requests.get(BASE + f'/api/audit?de={de}&ate={ate}&limite={limite}', cookies=await cookies(), timeout=60)
            return r.status_code, (r.json() if r.status_code == 200 else None)

        async def esperar(cond, segundos=40):
            fim = time.time() + segundos
            while time.time() < fim:
                try:
                    if await cond(): return True
                except Exception:
                    pass
                await page.wait_for_timeout(500)
            return False

        async def entrar(p, usuario, senha):
            await p.goto(BASE + '/', wait_until='load')
            await p.fill('#user', usuario); await p.fill('#pass', senha); await p.click('.login-card button')
            await p.wait_for_selector('#app:not(.hidden)', timeout=180000)
            await p.wait_for_timeout(1800)

        async def baixar(acao, p=None):
            async with (p or page).expect_download(timeout=60000) as info:
                await acao()
            dl = await info.value
            caminho = os.path.join(PASTA, dl.suggested_filename)
            await dl.save_as(caminho)
            return dl.suggested_filename, caminho

        async def gravado(cond_py, segundos=40):
            # espera o servidor ter o que a tela gravou (a gravação é assíncrona)
            fim = time.time() + segundos
            d = {}
            while time.time() < fim:
                d = await dados_servidor()
                if cond_py(d): return True, d
                await page.wait_for_timeout(700)
            return False, d

        await entrar(page, 'admin', 'meslion2026')
        logado['v'] = True

        # ------------------------------------------------------------------ versões e menus
        v = await ev("({ p: window.MES_ADAPTADOR_PAINEIS, t: window.MES_ADAPTADOR_PARADAS_TESTES, api: !!window.mesPaineisAPI && !!window.mesParadasTestesAPI })")
        ok(v == {'p': '1.7.0', 't': '1.7.0', 'api': True}, 'adaptadores 1.7.0 carregados (painéis e paradas/testes)', v)
        m = await ev("""() => ({ itens: ['paradas', 'paradas_motivos', 'testes_celulas', 'paineis', 'indicadores', 'paineis_tabelas'].map(k => !!document.getElementById('nav_' + k)),
          ordem: [moduleGroups.findIndex(g => g.title === 'Painéis'), moduleGroups.findIndex(g => g.title === 'Relatórios')],
          grupo: (moduleGroups.find(g => g.title === 'Painéis') || {}).items })""")
        ok(all(m['itens']) and 0 <= m['ordem'][0] < m['ordem'][1] and m['grupo'] == ['paineis', 'indicadores', 'paineis_tabelas'],
           'menus: paradas, motivos e testes das células; grupo Painéis (Painéis, Indicadores, Tabelas e relações) antes de Relatórios', m)

        # ------------------------------------------------------------------ números dos módulos (referência)
        mod = await ev(JS_MODULOS)
        ok(mod['total'] > 0 and mod['kwh'] > 0 and mod['co2'] > 0 and perto(mod['kwh'], mod['kwhSust']), 'referência: custo, kWh e CO₂ da família encerrada pelas funções dos módulos', mod)
        await page.reload(wait_until='load')
        if await page.is_visible('#user'):
            await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026'); await page.click('.login-card button')
        await page.wait_for_selector('#app:not(.hidden)', timeout=180000)
        await page.wait_for_timeout(1800)

        # ------------------------------------------------------------------ ver não grava e não altera os dados
        foto0 = await ev(JS_FOTO)
        escritas.clear()
        of = await ev(JS_OFICIAIS)
        await ev("render('paineis')"); await page.wait_for_timeout(500)
        vazio = await ev("document.getElementById('content').innerText")
        ok('Comece pelos painéis modelo' in vazio, 'sem painéis: a tela oferece os painéis modelo das áreas', vazio[:200])
        await ev("render('indicadores')"); await page.wait_for_timeout(600)
        n_ind = await ev("document.querySelectorAll('#content table.mpn-tab-ind tbody tr').length")
        ok(n_ind == mod['nOficiais'] and mod['nOficiais'] >= 30, f'biblioteca de indicadores: {mod["nOficiais"]} oficiais semeados', (n_ind, mod['nOficiais']))
        await ev("mesIndicadorValores('custo_unitario')")
        await page.wait_for_function("document.getElementById('mpn_iv_total') && /R\\$/.test(document.getElementById('mpn_iv_total').innerText)", timeout=30000)
        txt_iv = await ev("document.getElementById('mpn_iv_total').innerText + ' | ' + document.getElementById('mpn_iv_mes').innerText")
        await ev("mesPainelFecharJanela()")
        await ev("render('paineis_tabelas')")
        await page.wait_for_function("document.querySelector('#mpn_tabs_corpo table')", timeout=60000)
        tabs = await ev("""() => ({ linhas: document.querySelectorAll('#mpn_tabs_corpo .mpn-card:first-child tbody tr').length, n: mesPaineisAPI.tabelas().length,
          cartoes: document.querySelectorAll('#mpn_tabs_corpo .mpn-card').length })""")
        ok(tabs['linhas'] == tabs['n'] and tabs['n'] >= 14 and tabs['cartoes'] == tabs['n'] + 1, 'Tabelas e relações: a matriz das dimensões e um quadro de campos por tabela', tabs)
        await page.wait_for_timeout(800)
        foto1 = await ev(JS_FOTO)
        grav = [e for e in escritas if '/api/' in e[1]]
        ok(foto0 == foto1, 'calcular todos os indicadores e abrir as telas não altera nenhum dado (custos, consumos, OPs…)', len(foto0) - len(foto1))
        ok(not grav, 'ver painéis, indicadores e tabelas não grava nada no servidor', grav[:5])

        # ------------------------------------------------------------------ motor: números conferidos com os módulos
        c_un = of['custo_unitario']
        ok(perto(of['custo_total']['v'], mod['total']) and of['custo_total']['u'] == 'R$', 'custo total das famílias produzidas = custo da família (módulo Custos)', (of['custo_total'], mod['total']))
        ok(perto(c_un['v'], mod['total'] / 1) and c_un['u'] == 'R$/un', 'custo unitário = custo da família ÷ 1 célula produzida', (c_un, mod['total']))
        comp = [of[k]['v'] for k in ('custo_un_materiais', 'custo_un_energia', 'custo_un_mod', 'custo_un_perdas')]
        ok(perto(comp[0], mod['mat']) and perto(comp[1], mod['en']) and perto(comp[2], mod['mod']) and perto(comp[3], mod['perdas']) and perto(sum(comp), c_un['v']),
           'componentes do custo unitário (materiais, energia, mão de obra, perdas) = módulo Custos e somam o custo unitário', (comp, mod))
        ok(perto(of['perdas_rs']['v'], mod['perdas']) and perto(of['perdas_sobre_custo']['v'], mod['perdas'] / mod['total']) and of['perdas_sobre_custo']['u'] == '',
           'perdas (R$) = perdas da família; perdas sobre o custo = perdas ÷ custo total, sem unidade', (of['perdas_rs'], of['perdas_sobre_custo']))
        ok(perto(of['kwh_consumido']['v'], mod['kwh']) and of['kwh_consumido']['u'] == 'kWh' and perto(of['co2_total']['v'], mod['co2']) and perto(of['co2_por_celula']['v'], mod['co2']),
           'kWh consumidos e CO₂ = Sustentabilidade / ACV (CO₂ por célula com 1 célula)', (of['kwh_consumido'], of['co2_total'], mod['co2']))
        ok(of['producao_celulas']['v'] == 1 and of['producao_celulas']['u'] == 'un' and of['rejeito_celulas']['v'] == 0 and of['rejeito_celulas']['u'] == '',
           'células produzidas = 1 un; rejeito de células = 0 (soma sem registro não vira unidade "1/un")', (of['producao_celulas'], of['rejeito_celulas']))
        ok(of['producao_apontada']['v'] is None and 'várias unidades' in of['producao_apontada']['erro'],
           'produção apontada no total: erro "várias unidades" (kg, m e un não se somam)', of['producao_apontada'])
        oee = of['oee']
        ok(oee['v'] is None and 'tempo em operação' in oee['nota'] and any(re.search(r'OEE › Tempo em operação: (\d+) de \1 registro', c) for c in oee['cobertura']),
           'OEE sem apontamento de tempo: "faltam dados" com a cobertura (nenhum zero inventado)', oee)
        ok(of['kwh_gerado']['v'] is None and of['energia_media_celula']['v'] is None and of['cobertura_testes']['v'] == 0,
           'sem teste das células: kWh gerado e energia medida ficam "faltam dados" (nunca a energia de projeto); células testadas 0%', (of['kwh_gerado'], of['cobertura_testes']))

        r = await ev("""() => { const api = mesPaineisAPI;
          const pm = api.executar({ eixo: { tipo: 'dim', dim: 'material' }, valores: [{ indicador: 'perda_material' }] }, {});
          const nr = api.executar({ eixo: { tipo: 'dim', dim: 'material' }, valores: [{ indicador: 'custo_total' }] }, {});
          const ac = api.executar({ eixo: { tipo: 'dim', dim: 'mes' }, valores: [{ indicador: 'kwh_consumido' }, { indicador: 'kwh_consumido', acumulado: true }] }, {});
          const div = api.executar({ valores: [{ formula: 'DIVIDIR(1; 0)' }, { formula: '"texto" + 1' }, { formula: 'SOMA(Custos[Total]) + SOMA(Produção[Quantidade]; Produção[TipoOP] = "PA")' },
            { formula: 'SOMA(Produção[Quantidade]; Produção[UM] = "un")' }, { formula: 'CONTAR.DISTINTO(Consumos[OP])' }] }, {});
          const pf = api.executar({ eixo: { tipo: 'dim', dim: 'familia' }, valores: [{ indicador: 'custo_unitario' }] }, { periodo: { de: '2026-08', ate: '2026-08' }, filtros: [{ alvo: { tipo: 'dim', dim: 'familia' }, op: 'em', valores: ['%s'] }] });
          return { pm: { e: pm.eixo, c: pm.celulas[0] }, nr: nr.geral[0], ac: ac.eixo.map(e => [e, ac.celulas[0][e + '|*'].v, ac.celulas[1][e + '|*'].v]), div: div.geral,
            pf: { e: pf.eixo, v: pf.geral[0] }, aberto: api.calculoAberto({ valores: [{ indicador: 'custo_unitario' }] }, {}, 0),
            reg: api.registros({ valores: [{ indicador: 'custo_unitario' }] }, {}, 0).map(g => [g.tabela, g.linhas.length, g.linhas.map(l => l.Familia)]) }; }""" % OPPA)
        pm = r['pm']['c']
        ok(all(perto((pm.get(m + '|*') or {}).get('v'), mod['taxa'][m]['t']) for m in ('MP0013', 'MP0014', 'MP0015')) and perto(pm['MP0014|*']['v'], 3 / 5.46, 1e-9),
           'perda de material por material = perdido ÷ (consumido + retirada adicional), a mesma regra do custo (MP0014: 3 ÷ 5,46 = 54,95%)', (pm, mod['taxa']))
        ok(r['nr']['v'] is None and 'Custos não tem Material' in r['nr']['semRelacao'], 'custo por material: "não se relaciona" (o custo da família não tem material) — nada inventado', r['nr'])
        acum = r['ac']
        ok(acum and all(perto(acum[i][2], sum(x[1] or 0 for x in acum[:i + 1])) for i in range(len(acum))) and perto(sum(x[1] or 0 for x in acum), mod['kwh']),
           'acumulado por mês = soma dos meses até o ponto (kWh)', acum)
        d0, d1, d2, d3, d4 = r['div']
        ok(d0['v'] is None and 'sem base' in d0['nota'] and 'só aceita números' in d1['erro'] and 'unidades diferentes (R$ e un)' in d2['erro'] and d3['v'] >= 1 and d3['u'] == 'un' and d4['v'] > 0,
           'DIVIDIR por zero = faltam dados; conta com texto = erro; R$ + un = erro; filtro de unidade soma só "un"', r['div'])
        ok(r['pf']['e'] == [OPPA] and perto(r['pf']['v']['v'], mod['total']), 'filtro de período e de família: só a família pedida, mesmo custo unitário', r['pf'])
        ab = r['aberto']
        ok(isinstance(ab, dict) and any('SOMA(Custos[Total]; Custos[Produzida] = "Sim")' in p for p in ab['passos']) and 'R$ 5.613,80/un' in ab['resultado'] and '5.613,80' in txt_iv,
           'cálculo aberto passo a passo (e o valor no "Valores" do indicador)', (ab, txt_iv[:120]))
        ok(r['reg'] and r['reg'][0][0] == 'custos' and OPPA in r['reg'][0][2], 'registros por trás do número: as linhas da tabela Custos', r['reg'])

        # ------------------------------------------------------------------ travas das fórmulas e regras dos indicadores
        tr = await ev("""() => { const api = mesPaineisAPI, c = f => api.compilar(f).erro;
          const out = { campo: c('Produção[Quantidade]'), taxa: c('SOMA(Etapas[PotenciaW])'), outra: c('SOMA(Produção[Quantidade]; Perdas[Motivo] = "x")'), fn: c('XPTO(1)'),
            tab: c('SOMA(Nada[X])'), cmp: c('SOMA(Produção[Inexistente])'), ind: c('[Não existe]'), fim: c('1 +'), texto: c('MÉDIA(Produção[OP])'), args: c('DIVIDIR(1)'),
            dentro: c('SOMA([oee])'), boa: c("DIVIDIR(SOMA('Tempos de máquina'[OperacaoMin]); CONTAR(Perdas))"), aviso: api.compilar('MÉDIA(Etapas[PotenciaW])').avisos };
          const b = api.salvarIndicador({ Nome: 'Teste B', Formula: '1' }), a = api.salvarIndicador({ Nome: 'Teste A', Formula: '[Teste B] * 2' });
          out.direta = api.salvarIndicador({ Nome: 'Teste B', Formula: '[Teste B] + 1' }, b.indicador.IdIndicador).erro;
          out.indireta = api.salvarIndicador({ Nome: 'Teste B', Formula: '[Teste A] + 1' }, b.indicador.IdIndicador).erro;
          out.oficialPessoal = api.salvarIndicador({ Nome: 'Oficial X', Formula: '[Teste A]', Oficial: 'Sim' }).erro;
          const cc = api.salvarIndicador({ Nome: 'Teste C', Formula: '[oee] + [Teste A]' });
          out.oficialAninhado = api.salvarIndicador({ Nome: 'Oficial Y', Formula: '[Teste C]', Oficial: 'Sim' }).erro;
          out.comps = cc.indicador.Componentes;
          out.usado = api.excluirIndicador(b.indicador.IdIndicador).erro;
          out.ren = api.salvarIndicador({ Nome: 'Teste B renomeado', Formula: '1' }, b.indicador.IdIndicador).erro || api.indicador(a.indicador.IdIndicador).Formula;
          out.valA = api.executar({ valores: [{ indicador: a.indicador.IdIndicador }] }, {}).geral[0].v;
          out.mesmoNome = api.salvarIndicador({ Nome: 'OEE', Formula: '1' }).erro;
          const vb = api.indicador(b.indicador.IdIndicador); out.versao = [vb.Versao, vb.Historico.length, vb.Historico.map(h => h.Nome)];
          const oficial = api.salvarIndicador({ Nome: 'Teste oficial', Formula: 'SOMA(Perdas[Custo])', Formato: 'moeda', Oficial: 'Sim' });
          out.oficial = oficial.erro || [oficial.indicador.Oficial, oficial.indicador.Dono, oficial.indicador.Compartilhado];
          [cc, a, b, oficial].forEach(x => x.indicador && api.excluirIndicador(x.indicador.IdIndicador));
          out.sobra = api.indicadores().filter(i => /^Teste/.test(i.Nome)).length;
          return out; }""")
        ok('precisa estar dentro de SOMA' in tr['campo'] and 'taxa da linha' in tr['taxa'] and 'mesma tabela' in tr['outra'] and 'Função desconhecida' in tr['fn']
           and 'Tabela desconhecida' in tr['tab'] and 'não tem o campo' in tr['cmp'] and 'Indicador desconhecido' in tr['ind'] and 'terminou antes' in tr['fim']
           and 'campo numérico' in tr['texto'] and 'argumento' in tr['args'] and 'tem de ser um campo' in tr['dentro'] and tr['boa'] == '' and tr['aviso'],
           'travas: campo fora de agregação, taxa não se soma, condição de outra tabela, função/tabela/campo/indicador desconhecidos, texto em MÉDIA, nº de argumentos', tr)
        ok('ele mesmo' in tr['direta'] and 'Referência circular' in tr['indireta'] and 'só pode usar indicadores oficiais' in tr['oficialPessoal']
           and 'Teste A' in tr['oficialAninhado'] and tr['comps'] and len(tr['comps']) == 2,
           'referência circular direta e indireta recusadas; oficial não usa pessoal (nem por outro indicador); sub-indicadores = os da fórmula', tr)
        ok('Usado nos indicadores' in (tr['usado'] or '') and tr['ren'] == '[Teste B renomeado] * 2' and tr['valA'] == 2 and 'Já existe um indicador' in (tr['mesmoNome'] or ''),
           'excluir indicador usado: recusado; renomear atualiza a fórmula de quem usa; nome de oficial não se repete', tr)
        ok(tr['versao'][0] == 2 and tr['versao'][1] == 2 and tr['oficial'] == ['Sim', '', 'Sim'] and tr['sobra'] == 0,
           'versão e histórico a cada mudança de regra; oficial criado pelo administrador (todos veem)', tr)

        # ------------------------------------------------------------------ paradas de máquina
        await ev("render('paradas_motivos')"); await page.wait_for_timeout(400)
        for cat, mot in (('Manutenção corretiva', 'Quebra do rolo'), ('Manutenção preventiva', 'Lubrificação'), ('Manutenção corretiva', 'quebra do ROLO')):
            await page.select_option('#mpt_m_cat', cat); await page.fill('#mpt_m_mot', mot); await page.click('text=Salvar motivo'); await page.wait_for_timeout(300)
        mot = await ev("({ m: data.paradas_motivos.map(m => [m.IdMotivoParada, m.Categoria, m.Motivo, m.Planejada]), msg: document.getElementById('mpt_m_msg').textContent })")
        ok(mot['m'] == [['PRM0001', 'Manutenção corretiva', 'Quebra do rolo', 'Não'], ['PRM0002', 'Manutenção preventiva', 'Lubrificação', 'Sim']] and 'já está cadastrado' in mot['msg'],
           'motivos de parada: corretiva não planejada, preventiva planejada; o mesmo motivo (sem acento/maiúscula) não duplica', mot)
        await ev("render('paradas')"); await page.wait_for_timeout(500)
        eqs = await ev("mesParadasTestesAPI.equipamentos().map(e => e.chave)")
        await page.select_option('#mpt_tp_eq', eqs[0]); await page.select_option('#mpt_tp_mot', 'PRM0001')
        await page.fill('#mpt_tp_di', '10/08/2026'); await page.fill('#mpt_tp_hi', '08:00'); await page.fill('#mpt_tp_hf', '08:45')
        await page.click('text=Registrar intervalo (início e fim)'); await page.wait_for_timeout(500)
        p1 = await ev("data.paradas.map(p => [p.Motivo, p.Planejada, p.DataInicio, p.HoraInicio, p.HoraFim, String(p.DuracaoMin), p.Status])")
        ok(p1 == [['Quebra do rolo', 'Não', '10/08/2026', '08:00', '08:45', '45', 'Encerrada']], 'parada registrada por intervalo: 45 min, não planejada, encerrada', p1)
        await page.select_option('#mpt_tp_eq', eqs[0]); await page.select_option('#mpt_tp_mot', 'PRM0001')
        await page.fill('#mpt_tp_di', '10/08/2026'); await page.fill('#mpt_tp_hi', '08:30'); await page.fill('#mpt_tp_hf', '09:00')
        await page.click('text=Registrar intervalo (início e fim)'); await page.wait_for_timeout(400)
        sob = await ev("({ m: document.getElementById('mpt_tp_msg').textContent, n: data.paradas.length })")
        ok('Sobrepõe outra parada' in sob['m'] and sob['n'] == 1, 'parada que sobrepõe outra do mesmo equipamento é recusada', sob)
        await ev("render('producao')"); await page.wait_for_timeout(500)
        await page.select_option('#prod_op', FAM_ABERTA + '-01'); await page.wait_for_timeout(900)
        ok(await ev("!!document.getElementById('mpt_paradas') && document.getElementById('mpt_ap_eq').options.length > 0"), 'apontamento da OP: quadro de paradas com as máquinas da OP', '')
        await page.select_option('#mpt_ap_mot', 'PRM0002')
        await page.click('#mpt_paradas >> text=Iniciar parada agora'); await page.wait_for_timeout(700)
        ab = await ev("data.paradas.filter(p => p.Status === 'Aberta').map(p => [p.CodOP, p.Motivo, p.Planejada, p.IdParada])")
        ok(len(ab) == 1 and ab[0][0] == FAM_ABERTA + '-01' and ab[0][1:3] == ['Lubrificação', 'Sim'], 'parada aberta pelo apontamento, com a OP e o motivo planejado', ab)
        if ab:
            await ev("(id) => mesParadasTestesAPI.encerrarParada(id)", ab[0][3]); await page.wait_for_timeout(400)
        fech = await ev("data.paradas.map(p => [p.Status, Number(p.DuracaoMin) >= 0])")
        ok(fech == [['Encerrada', True], ['Encerrada', True]], 'parada aberta encerrada (com a duração)', fech)

        # ------------------------------------------------------------------ testes das células e passaporte
        await page.select_option('#prod_op', OPPA); await page.wait_for_timeout(900)
        ok(await ev("!!document.getElementById('mpt_testes') && document.querySelectorAll('#mpt_testes tbody tr').length === 1"), 'OP de PA: quadro de testes com uma linha por célula produzida', '')
        await page.fill('#mpt_te_0', '330,5'); await page.fill('#mpt_tc_0', '92,1'); await page.fill('#mpt_tt_eq', 'Arbin')
        await page.click('text=Salvar resultados dos testes'); await page.wait_for_timeout(800)
        te = await ev("""() => ({ t: data.testes_celulas.map(t => [t.CodOP, t.TipoTeste, Number(t.EnergiaDescargaWh), Number(t.CapacidadeDescargaAh), t.Equipamento]),
          r: mesParadasTestesAPI.resumoTestes(data.op.find(o => o.CodOP === '%s')) })""" % OPPA)
        ok(te['t'] == [[OPPA, 'Formação', 330.5, 92.1, 'Arbin']] and te['r']['energia']['media'] == 330.5 and te['r']['capacidade']['media'] == 92.1,
           'teste da célula gravado (330,5 Wh e 92,1 Ah) e o resumo da OP', te)
        await ev("render('bp')"); await page.wait_for_timeout(600)
        await ev("openBPForm(-1)"); await page.wait_for_timeout(700)
        await page.select_option('#bp_op', OPPA); await page.wait_for_timeout(1500)
        bp = await ev("[(document.getElementById('bpu_BP_EnergiaMedidaWh') || {}).value, (document.getElementById('bpu_BP_CapacidadeMedidaAh') || {}).value]")
        ok(bp == ['330,5', '92,1'], 'passaporte puxa a energia e a capacidade MEDIDAS (média dos testes das células)', bp)
        await ev("render('testes_celulas')"); await page.wait_for_timeout(500)
        ok(await ev("document.querySelectorAll('#content tbody tr').length") == 1, 'tela Testes das células lista o teste', '')
        of2 = await ev(JS_OFICIAIS)
        ok(perto(of2['kwh_gerado']['v'], 0.3305) and of2['kwh_gerado']['u'] == 'kWh' and of2['cobertura_testes']['v'] == 1 and perto(of2['energia_media_celula']['v'], 330.5)
           and perto(of2['kwh_razao']['v'], 0.3305 / mod['kwh']),
           'depois do teste: kWh gerado = 0,3305 (330,5 Wh medidos), 100% das células testadas, razão gerada ÷ consumida', (of2['kwh_gerado'], of2['cobertura_testes'], of2['kwh_razao']))
        par = await ev("({ min: mesPaineisAPI.executar({ valores: [{ indicador: 'paradas_min' }, { indicador: 'paradas_np_min' }] }, {}).geral.map(g => g.v), soma: data.paradas.reduce((a, p) => a + Number(p.DuracaoMin || 0), 0) })")
        ok(perto(par['min'][0], par['soma']) and par['min'][1] == 45, 'minutos parados no painel = soma das paradas; não planejadas = 45 min', par)
        okg, srv = await gravado(lambda d: len(d.get('paradas') or []) == 2 and len(d.get('testes_celulas') or []) == 1 and len(d.get('paradas_motivos') or []) == 2)
        ok(okg, 'paradas, motivos e testes das células gravados no servidor', {k: len(srv.get(k) or []) for k in ('paradas', 'paradas_motivos', 'testes_celulas')})

        # ------------------------------------------------------------------ painéis modelo
        await ev("render('paineis')"); await page.wait_for_timeout(400)
        await ev("mesPaineisModelos()"); await page.wait_for_timeout(1500)
        ps = await ev("data.paineis.map(p => [p.Nome, p.Area, p.Blocos.length, p.Compartilhado, p.Dono])")
        ok([p[0] for p in ps] == ['Produção', 'Qualidade', 'Custos', 'Sustentabilidade', 'Engenharia / P&D', 'Diretoria'] and all(p[2] >= 6 and p[3] == 'Sim' and p[4] == 'admin' for p in ps),
           'painéis modelo das áreas criados (compartilhados)', ps)
        prob = {}
        for nome in [p[0] for p in ps]:
            await ev("(n) => mesPainelAbrir(data.paineis.find(p => p.Nome === n).IdPainel)", nome)
            await page.wait_for_timeout(400)
            st = await ev("""() => ({ n: document.querySelectorAll('.mpn-bloco').length, erro: [...document.querySelectorAll('.mpn-corpo')].filter(c => /Erro ao calcular|Calculando/.test(c.innerText)).length,
              svg: document.querySelectorAll('.mpn-bloco svg').length })""")
            if st['erro'] or st['n'] != next(p[2] for p in ps if p[0] == nome): prob[nome] = st
        ok(not prob, 'todos os blocos de todos os painéis modelo calculam e desenham', prob)

        id_custos = await ev("data.paineis.find(p => p.Nome === 'Custos').IdPainel")
        await ev("(id) => mesPainelAbrir(id)", id_custos); await page.wait_for_timeout(500)
        card = await ev("[...document.querySelectorAll('.mpn-cartao')].map(c => c.innerText.replace(/\\s+/g, ' '))")
        ok(any('Custo unitário de fabricação' in c and 'R$ 5.613,80/un' in c for c in card) and any('0,22%' in c for c in card),
           'cartões do painel Custos: custo unitário R$ 5.613,80/un e perdas sobre o custo 0,22%', card)
        fam_tab = "(() => { const b = [...document.querySelectorAll('.mpn-bloco')].find(x => x.querySelector('h4').textContent === 'Custo por família'); return b ? [...b.querySelectorAll('tbody tr')].map(r => r.cells[0].textContent) : null; })()"
        antes = await ev(fam_tab)
        await page.click('.mpn-bloco .mpn-alvo'); await page.wait_for_timeout(300)
        pop = await ev("[...document.querySelectorAll('#mpn_pop div')].map(d => d.textContent)")
        await page.click('#mpn_pop div[data-i="0"]'); await page.wait_for_timeout(700)
        chip = await ev("(document.querySelector('.mpn-chip') || {}).textContent || ''")
        depois = await ev(fam_tab)
        ok(pop and pop[0].startswith('Filtrar o painel por Família (OP de PA) = ' + OPPA) and 'Cálculo aberto' in pop and 'Ver os registros' in pop
           and OPPA in chip and len(antes) == 3 and depois == [OPPA, 'Total'], 'filtro cruzado: clicar na família filtra o painel inteiro (a tabela fica só com ela)', (pop, chip, antes, depois))
        await page.click('.mpn-chip b'); await page.wait_for_timeout(600)
        ok(await ev(fam_tab) == antes, 'tirar o filtro do clique volta todas as famílias', '')

        # filtro do painel (período) gravado no painel
        await page.fill('#mpn_f_de', MES_DADOS); await page.fill('#mpn_f_ate', MES_DADOS)
        await page.click('#mpn_filtros >> text=Aplicar'); await page.wait_for_timeout(700)
        fp = await ev("(id) => data.paineis.find(p => p.IdPainel === id).Filtros", id_custos)
        card2 = await ev("[...document.querySelectorAll('.mpn-cartao')].map(c => c.innerText.replace(/\\s+/g, ' '))")
        ok(fp['periodo'] == {'de': MES_DADOS, 'ate': MES_DADOS} and any('R$ 5.613,80/un' in c for c in card2), 'filtro de período do painel gravado no painel; valores do mês iguais', (fp, card2[:1]))

        # cálculo aberto pelo clique no cartão e componentes
        await page.click('.mpn-cartao-valor >> nth=0'); await page.wait_for_timeout(300)
        await page.click('#mpn_pop div:has-text("Cálculo aberto")'); await page.wait_for_timeout(500)
        cab = await ev("[...document.querySelectorAll('.mpn-modal .mpn-aberto')].map(x => x.innerText).join(' | ')")
        ok('SOMA(Custos[Total]; Custos[Produzida] = "Sim")' in cab and 'Período: ago/2026 a ago/2026' in cab, 'cálculo aberto: fórmula, recorte (período) e o passo a passo com os números', cab[:400])
        await ev("mesPainelFecharJanela()")
        bid = await ev("(id) => data.paineis.find(p => p.IdPainel === id).Blocos.find(b => b.valores[0] && b.valores[0].indicador === 'custo_unitario' && b.visual === 'cartao').id", id_custos)
        await ev("(b) => mesPainelComponentes(b, 0)", bid); await page.wait_for_timeout(800)
        cp = await ev("[...document.querySelectorAll('#mpn_comp_c tbody tr')].map(r => [...r.cells].map(c => c.textContent))")
        ok(cp and cp[-1][0] == 'Total' and cp[-1][1:5] == ['R$ 967,69/un', 'R$ 2.697,51/un', 'R$ 1.936,00/un', 'R$ 12,60/un'] and cp[-1][5] == 'R$ 5.613,80/un',
           'abrir o custo unitário nos componentes (materiais + energia + mão de obra + perdas = total)', cp)
        await ev("mesPainelFecharJanela()")

        # ------------------------------------------------------------------ Excel e histórico
        b_fam = await ev("(id) => data.paineis.find(p => p.IdPainel === id).Blocos.find(b => b.titulo === 'Custo por família').id", id_custos)
        nome_x, cam = await baixar(lambda: page.click(f'#mpn_b_{b_fam} .mpn-bloco-acoes span[title="Excel do bloco"]'))
        wb = openpyxl.load_workbook(cam)
        lin = linhas_xlsx(wb['Dados'])
        lfam = next((l for l in lin if l[0] == OPPA), None)
        parx = {str(l[0]): l[1] for l in linhas_xlsx(wb['Parâmetros'])}
        ok(wb.sheetnames == ['Dados', 'Parâmetros'] and lin[0][:3] == ['Família (OP de PA)', 'Custo total calculado', 'Custo total calculado — unidade'] and lfam and perto(lfam[1], mod['total'])
           and lfam[2] == 'R$' and lin[-1][0] == 'Total' and parx.get('Regra: Custo total calculado') == 'SOMA(Custos[Total])' and 'ago/2026' in str(parx.get('Período')) and 'admin' in str(parx.get('Usuário')),
           'Excel do bloco: aba Dados com número como número e a unidade ao lado, linha Total e aba Parâmetros (regra, período, usuário)', (nome_x, lin[:3], parx))
        n_bl = await ev("(id) => data.paineis.find(p => p.IdPainel === id).Blocos.length", id_custos)
        nome_p, cam_p = await baixar(lambda: page.click('#mpn_toolbar >> text=⬇ Excel'))
        wbp = openpyxl.load_workbook(cam_p)
        ok(len(wbp.sheetnames) == n_bl and wbp.sheetnames[0].startswith('1 '), 'Excel do painel: uma aba por bloco', (nome_p, wbp.sheetnames))
        await ev("(b) => mesBlocoRegistros(b, -1, null, 0)", b_fam); await page.wait_for_timeout(500)
        nome_r, cam_r = await baixar(lambda: page.click('.mpn-modal >> text=⬇ Excel'))
        wbr = openpyxl.load_workbook(cam_r)
        lr = linhas_xlsx(wbr[wbr.sheetnames[0]])
        ok(wbr.sheetnames == ['Custos'] and len(lr) == 3 and any(OPPA in [str(x) for x in l] for l in lr), 'Excel dos registros: as linhas da tabela por trás do número', (wbr.sheetnames, lr[:2]))
        await ev("mesPainelFecharJanela()")
        fim_a = time.time() + 30
        regs = []
        while time.time() < fim_a:
            st_a, aud = await auditoria(hoje, hoje)
            regs = [a for a in (aud or []) if a.get('module') == 'relatorios' and a.get('action') == 'EXPORTAR' and str(a.get('record_key', '')).startswith('painel_')]
            if len(regs) >= 3: break
            await page.wait_for_timeout(700)
        chaves = sorted(set(a.get('record_key') for a in regs))
        ok(chaves == ['painel_bloco', 'painel_painel', 'painel_registros'] and all(a.get('username') == 'admin' for a in regs) and any((a.get('details') or {}).get('arquivo') == nome_x for a in regs),
           'cada exportação no Histórico de Modificações (bloco, painel e registros, com o arquivo)', (chaves, regs[:1]))

        # ------------------------------------------------------------------ editor do bloco ("+" e arrastar) e regra de cálculo
        id_prod = await ev("data.paineis.find(p => p.Nome === 'Produção').IdPainel")
        await ev("(id) => mesPainelAbrir(id)", id_prod); await page.wait_for_timeout(500)
        n0 = await ev("(id) => data.paineis.find(p => p.IdPainel === id).Blocos.length", id_prod)
        await page.click('#mpn_toolbar >> text=+ Bloco'); await page.wait_for_timeout(700)
        await page.click('#mpn_ed_arvore details:has(summary:text("Dimensões")) summary'); await page.wait_for_timeout(200)
        await page.click('#mpn_ed_arvore .mpn-item[data-item*=\'"dim":"mes"\'] .mais'); await page.wait_for_timeout(200)
        await page.click('#mpn_pop div[data-i="0"]'); await page.wait_for_timeout(300)
        await page.click('#mpn_ed_arvore .mpn-item[data-item*=\'"id":"producao_celulas"\'] .mais'); await page.wait_for_timeout(200)
        await page.click('#mpn_pop div[data-i="0"]'); await page.wait_for_timeout(300)
        await page.drag_and_drop('#mpn_ed_arvore .mpn-item[data-item*=\'"dim":"quimica"\']', '.mpn-poco[data-poco="legenda"]'); await page.wait_for_timeout(500)
        await page.drag_and_drop('#mpn_ed_arvore .mpn-item[data-item*=\'"dim":"modelo"\']', '.mpn-poco[data-poco="valores"]'); await page.wait_for_timeout(300)
        av = await ev("document.getElementById('mpn_ed_aviso').textContent")
        await page.fill('#mpn_ed_formula', 'DIVIDIR(SOMA(Perdas[Custo]); [producao_celulas])'); await page.fill('#mpn_ed_fnome', 'Perdas por célula')
        await page.wait_for_function("/Fórmula válida/.test(document.getElementById('mpn_ed_fmsg').innerText)", timeout=20000)
        msg1 = await ev("document.getElementById('mpn_ed_fmsg').innerText")
        await page.click('#mpn_ed_fadd'); await page.wait_for_timeout(500)
        await page.fill('#mpn_ed_formula', 'SOMA(Produção[Quantidade]) + 1'); await page.wait_for_timeout(900)
        msg2 = await ev("document.getElementById('mpn_ed_fmsg').innerText")
        await page.fill('#mpn_ed_formula', 'SOMA(Produção[Quantidade]'); await page.wait_for_timeout(900)
        msg3 = await ev("document.getElementById('mpn_ed_fmsg').innerText")
        prev = await ev("({ svg: !!document.querySelector('#mpn_ed_corpo svg'), info: document.getElementById('mpn_ed_info').innerText })")
        ok('Dimensão não é valor' in av, 'arrastar dimensão para Valores: aviso (dimensão vai no eixo, na legenda ou nos filtros)', av)
        ok('R$/un' in msg1 and '12,6' in msg1 and 'não fecha' in msg2 and 'várias unidades' in msg2 and 'Falta fechar o parêntese de SOMA' in msg3,
           'regra de cálculo conferida na hora: válida com o valor de agora, erro de unidade e erro de escrita', (msg1, msg2, msg3))
        ok(prev['svg'] and 'Produção' in prev['info'] and 'eixo por' in prev['info'], 'prévia com os números de verdade e de onde vêm (tabela e caminho da ligação)', prev)
        await page.click('.mpn-modal button:has-text("Salvar bloco")'); await page.wait_for_timeout(900)
        nb = await ev("(id) => { const p = data.paineis.find(p => p.IdPainel === id); const b = p.Blocos[p.Blocos.length - 1]; return { n: p.Blocos.length, eixo: b.eixo, leg: b.legenda, val: b.valores.map(v => v.indicador || v.formula) }; }", id_prod)
        ok(nb['n'] == n0 + 1 and nb['eixo'] == {'tipo': 'dim', 'dim': 'mes'} and nb['leg'] == {'tipo': 'dim', 'dim': 'quimica'} and nb['val'] == ['producao_celulas', 'DIVIDIR(SOMA(Perdas[Custo]); [producao_celulas])'],
           'bloco novo salvo: Mês no eixo ("+"), Química na legenda (arrastar), indicador e regra própria nos valores', nb)
        okg, srv = await gravado(lambda d: any(p.get('IdPainel') == id_prod and len(p.get('Blocos') or []) == n0 + 1 for p in (d.get('paineis') or [])))
        ok(okg, 'bloco gravado no servidor', '')
        sobre = await ev("""(id) => { const p = data.paineis.find(p => p.IdPainel === id), o = {}; let ruim = 0;
          p.Blocos.forEach(b => { for (let r = b.y; r < b.y + b.h; r++) for (let c = b.x; c < b.x + b.w; c++) { const k = r + '|' + c; if (o[k]) ruim++; o[k] = 1; } }); return ruim; }""", id_prod)
        ok(sobre == 0, 'layout sem blocos sobrepostos', sobre)

        # ------------------------------------------------------------------ indicador pessoal pelo montador; renomear e excluir
        await ev("render('indicadores')"); await page.wait_for_timeout(500)
        await page.click('#mpn_toolbar >> text=+ Novo indicador'); await page.wait_for_timeout(600)
        await page.fill('#mpn_ie_nome', 'Custo das perdas de material')
        await page.click('#mpn_mo summary'); await page.wait_for_timeout(200)
        await page.select_option('#mpn_mo_tab', 'perdas'); await page.wait_for_timeout(200)
        await page.select_option('#mpn_mo_campo', 'Custo'); await page.select_option('#mpn_mo_ccampo', 'Alvo'); await page.fill('#mpn_mo_cval', 'Material')
        await page.click('text=Inserir na fórmula')
        await page.wait_for_function("/Fórmula válida/.test(document.getElementById('mpn_ie_msg').innerText) && /R\\$/.test(document.getElementById('mpn_ie_info').innerText)", timeout=30000)
        fmo = await ev("({ f: document.getElementById('mpn_ie_formula').value, info: document.getElementById('mpn_ie_info').innerText })")
        await page.click('.mpn-modal button:has-text("Salvar indicador")'); await page.wait_for_timeout(700)
        ip = await ev("(data.indicadores.find(i => i.Nome === 'Custo das perdas de material') || {})")
        ok(fmo['f'] == 'SOMA(Perdas[Custo]; Perdas[Alvo] = "Material")' and 'R$ 12,60' in fmo['info'] and ip.get('Oficial') == 'Não' and ip.get('Dono') == 'admin' and ip.get('Versao') == 1,
           'montador: tabela Perdas → soma do custo só quando Alvo = Material; o indicador pessoal mostra R$ 12,60 e grava', (fmo, ip.get('Formula')))
        r6 = await ev("""(idp) => { const api = mesPaineisAPI, ind = api.indicador('Custo das perdas de material');
          const dep = api.salvarIndicador({ Nome: 'Perdas de material por célula', Formula: 'DIVIDIR([Custo das perdas de material]; [producao_celulas])', Formato: 'moeda' });
          const p = data.paineis.find(x => x.IdPainel === idp); p.Blocos.push({ id: 'BLTESTE', titulo: 'Teste', visual: 'tabela', x: 0, y: 99, w: 6, h: 2, valores: [{ formula: '[Custo das perdas de material] * 2', nome: 'Dobro' }], filtros: [] });
          const ren = api.salvarIndicador({ Nome: 'Perdas de material (R$)', Formula: ind.Formula, Formato: 'moeda' }, ind.IdIndicador);
          const out = { ren: ren.erro || '', dep: api.indicador(dep.indicador.IdIndicador).Formula, bloco: p.Blocos.find(b => b.id === 'BLTESTE').valores[0].formula,
            v: api.executar({ valores: [{ indicador: dep.indicador.IdIndicador }] }, {}).geral[0].v };
          out.ex1 = api.excluirIndicador(ind.IdIndicador).erro;
          api.excluirIndicador(dep.indicador.IdIndicador);
          out.ex2 = api.excluirIndicador(ind.IdIndicador).erro;
          p.Blocos = p.Blocos.filter(b => b.id !== 'BLTESTE');
          out.ex3 = api.excluirIndicador(ind.IdIndicador).erro || 'ok';
          return out; }""", id_prod)
        ok(r6['ren'] == '' and r6['dep'] == 'DIVIDIR([Perdas de material (R$)]; [producao_celulas])' and r6['bloco'] == '[Perdas de material (R$)] * 2' and perto(r6['v'], 12.5952)
           and 'Usado nos indicadores' in r6['ex1'] and 'Usado nos painéis' in r6['ex2'] and r6['ex3'] == 'ok',
           'renomear atualiza as fórmulas dos indicadores e dos blocos; excluir só depois de tirar de onde é usado', r6)

        # ------------------------------------------------------------------ layout, modo TV
        await ev("(id) => mesPainelAbrir(id)", id_custos); await page.wait_for_timeout(400)
        await page.click('#mpn_toolbar >> text=Editar layout'); await page.wait_for_timeout(400)
        w0 = await ev("(id) => data.paineis.find(p => p.IdPainel === id).Blocos[0].w", id_custos)
        await page.click('.mpn-bloco >> nth=0 >> span[title="Mais largo"]'); await page.wait_for_timeout(500)
        w1 = await ev("(id) => data.paineis.find(p => p.IdPainel === id).Blocos[0].w", id_custos)
        ok(w1 == w0 + 1 and await ev("!!document.querySelector('.mpn-editando')"), 'editar layout: alargar um bloco grava a largura', (w0, w1))
        await page.click('#mpn_toolbar >> text=Concluir layout'); await page.wait_for_timeout(400)
        await page.click('#mpn_toolbar >> text=Modo TV'); await page.wait_for_timeout(500)
        tv1 = await ev("document.body.classList.contains('mpn-tv') && !!document.getElementById('mpn_tv_sair')")
        await page.keyboard.press('Escape'); await page.wait_for_timeout(500)
        tv2 = await ev("!document.body.classList.contains('mpn-tv') && !document.getElementById('mpn_tv_sair')")
        ok(tv1 and tv2, 'modo TV (sem menu, atualiza sozinho) e Esc sai', (tv1, tv2))

        # ------------------------------------------------------------------ fechar o mês
        fm = await ev("""() => { const api = mesPaineisAPI;
          const r1 = api.fecharMes('%s'), n1 = api.fechamentos().length;
          const r2 = api.fecharMes('%s'), n2 = api.fechamentos().length;
          const atual = new Date(), mesAtual = atual.getFullYear() + '-' + String(atual.getMonth() + 1).padStart(2, '0');
          const r3 = api.fecharMes(mesAtual), r4 = api.fecharMes('2099-01');
          const f = api.fechamentos().find(x => x.IdIndicador === 'custo_unitario');
          return { r1, r2, n1, n2, r3, r4, f, oee: api.fechamentos().find(x => x.IdIndicador === 'oee') }; }""" % (MES_DADOS, MES_DADOS))
        ok(fm['r1'].get('feitos') == mod['nOficiais'] and fm['n1'] == mod['nOficiais'] and fm['n2'] == fm['n1'] and fm['r3'].get('erro') and fm['r4'].get('erro')
           and perto(fm['f']['Valor'], mod['total']) and fm['f']['Unidade'] == 'R$/un' and fm['f']['FechadoPor'] == 'admin' and fm['oee']['Valor'] == '' and 'faltam dados' in fm['oee']['Situacao'],
           'fechar o mês grava os oficiais (custo unitário R$ 5.613,80/un; OEE "faltam dados"); fechar de novo substitui; mês corrente e futuro recusados', fm)
        await ev("(id) => mesPainelAbrir(id)", id_custos); await page.wait_for_timeout(500)
        nota_f = await ev("[...document.querySelectorAll('.mpn-cartao-nota')].map(x => x.textContent).join(' | ')")
        ok('Mês fechado em' in nota_f, 'cartão com o período de um mês fechado mostra o valor gravado no fechamento', nota_f)
        okg, srv = await gravado(lambda d: len(d.get('paineis_fechamentos') or []) == mod['nOficiais'])
        ok(okg, 'fechamento gravado no servidor', len(srv.get('paineis_fechamentos') or []))

        # ------------------------------------------------------------------ usuário comum
        await ev("""() => { const api = mesPaineisAPI;
          api.salvarIndicador({ Nome: 'Indicador pessoal do admin', Formula: 'CONTAR(Perdas)', Formato: 'int', Compartilhado: 'Não' });
          api.salvarIndicador({ Nome: 'Indicador compartilhado do admin', Formula: 'CONTAR(Consumos)', Formato: 'int', Compartilhado: 'Sim' }); }""")
        okg, srv = await gravado(lambda d: sum(1 for i in (d.get('indicadores') or []) if str(i.get('Nome', '')).startswith('Indicador ')) == 2)
        ok(okg, 'indicadores pessoal e compartilhado do administrador gravados', '')
        s = requests.Session(); s.cookies.update(await cookies())
        rq = s.post(BASE + '/api/users', json={'username': 'analista_paineis', 'fullName': 'Analista dos Painéis', 'password': 'Senha#2026', 'role': 'USER', 'active': True}, timeout=30)
        ok(rq.status_code in (200, 201) or 'já existe' in rq.text, 'usuário comum criado para o teste', rq.text[:200])
        ctx2 = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo')
        p2 = await ctx2.new_page()
        p2.on('pageerror', lambda e: erros.append('usuário comum: ' + str(e)))
        p2.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await entrar(p2, 'analista_paineis', 'Senha#2026')
        u = await p2.evaluate("""() => { const api = mesPaineisAPI;
          const o1 = api.salvarIndicador({ Nome: 'Oficial do analista', Formula: '1', Oficial: 'Sim' }).erro;
          const o2 = api.salvarIndicador({ Nome: 'OEE', Formula: '[disponibilidade]' }, 'oee').erro;
          const meu = api.salvarIndicador({ Nome: 'Meu indicador', Formula: 'CONTAR(Perdas)', Formato: 'int' });
          const fm = api.fecharMes('2026-08').erro;
          render('indicadores');
          const nomes = [...document.querySelectorAll('#content table.mpn-tab-ind tbody tr b')].map(x => x.textContent);
          const p = data.paineis.find(x => x.Nome === 'Custos'); mesPainelAbrir(p.IdPainel);
          const bar = document.getElementById('mpn_toolbar').innerText;
          mesBlocoEditar(''); const modal = !!document.querySelector('.mpn-modal');
          const meuP = api.criarPainel('Painel do analista', 'Qualidade', [], 'Não');
          return { o1, o2, fm, meu: meu.indicador ? [meu.indicador.Oficial, meu.indicador.Dono] : meu.erro, nomes, bar, modal, meuP: [meuP.Dono, meuP.Compartilhado] }; }""")
        ok('Só o administrador' in (u['o1'] or '') and 'Só o administrador' in (u['o2'] or '') and 'Só o administrador' in (u['fm'] or '') and u['meu'] == ['Não', 'analista_paineis'],
           'usuário comum: não cria nem altera indicador oficial, não fecha o mês; cria o seu indicador pessoal', u)
        ok('Meu indicador' in u['nomes'] and 'Custo unitário de fabricação' in u['nomes'] and 'Indicador compartilhado do admin' in u['nomes'] and 'Indicador pessoal do admin' not in u['nomes'],
           'usuário comum vê os oficiais e os seus (não os pessoais do administrador)', u['nomes'][:5])
        ok('+ Bloco' not in u['bar'] and 'Fechar mês' not in u['bar'] and 'Editar layout' not in u['bar'] and not u['modal'] and u['meuP'] == ['analista_paineis', 'Não'],
           'usuário comum vê o painel compartilhado sem editar (sem + Bloco, layout ou fechar mês) e cria o próprio painel', u)
        c2 = {k['name']: k['value'] for k in await ctx2.cookies()}
        fim_u = time.time() + 40
        du = {}
        while time.time() < fim_u:
            du = requests.get(BASE + '/api/bootstrap', cookies=c2, timeout=180).json()['data']
            if any(p.get('Nome') == 'Painel do analista' for p in du.get('paineis') or []): break
            await p2.wait_for_timeout(700)
        ok(any(p.get('Nome') == 'Painel do analista' and p.get('Dono') == 'analista_paineis' for p in du.get('paineis') or [])
           and any(i.get('Nome') == 'Meu indicador' for i in du.get('indicadores') or []), 'painel e indicador do usuário comum gravados no servidor', '')
        await ctx2.close()

        ok(not erros, 'nenhum erro JavaScript', erros[:5])
        await b.close()

    print(f'\n== {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print('FALHAS:')
        for f in falhas: print(' -', f)
        sys.exit(1)


asyncio.run(main())
