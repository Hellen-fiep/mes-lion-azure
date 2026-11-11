#!/usr/bin/env python3
"""
Teste no navegador da versão JSON 1.5.0 (server/adaptador_relatorios.js) — menu Relatórios:
  - menu "Relatórios" (Catálogo de relatórios, Dossiê da OP, Meus modelos) antes de Administração;
  - catálogo com todos os módulos, busca e filtro por módulo; todos os relatórios executam e abrem na tela sem erro;
  - executar os relatórios não altera nenhum dado nem grava no servidor (as funções das telas que regravam campos
    ao calcular, como o custo da OP, ficam sem efeito);
  - números conferidos com as funções das telas: saldo por lote e por material (Estoque / Rastreabilidade), livro de
    PI / PA, produção apontada, tempo planejado por máquina, custo da família (módulo Custos), CO₂ da família
    (Sustentabilidade), carga × capacidade, MRP;
  - filtros comuns (período, OP, produto sem acento, situação, busca livre), escolha de colunas e ordem;
  - Excel real (.xlsx) baixado pela tela e conferido com openpyxl: números como número, datas como data, unidade no
    cabeçalho, filtro automático, cabeçalho congelado, linha Total com SUBTOTAL(109) e a aba Parâmetros;
  - cada exportação registrada no Histórico de Modificações (GET /api/audit?de=&ate=);
  - modelos salvos: salvar, substituir, abrir (filtros, colunas e ordem voltam), exportar e excluir (gravados no servidor);
  - dossiê da OP (família e só a OP): abas, resumo, custo e CO₂ da família e rastreabilidade para trás e para frente.

Uso: python teste_relatorios_json.py <url_base>
"""
import sys, os, re, json, asyncio, time, datetime, unicodedata, tempfile
import requests
import openpyxl
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0
PASTA = tempfile.mkdtemp(prefix='mes_relatorios_')

FAM_FECHADA = 'OP20260812094138'   # família encerrada (PA + 7 PIs) dos dados de teste
OPPA = FAM_FECHADA + '-PA'
ABAS_DOSSIE = ['Resumo', 'Produção', 'Etiquetas', 'Saldo PI e PA', 'Materiais planejado × real', 'Lotes de material', 'Consumo de PIs', 'Tempo por máquina',
               'Apontamentos de tempo', 'Perdas', 'Custo por OP', 'Custo e CO₂ da família', 'Contribuição no CO₂', 'Rastreabilidade', 'Parâmetros']


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {str(det)[:600]}'), flush=True)
    if not c: falhas.append(f'{nome}: {str(det)[:600]}')


def perto(a, b, tol=1e-6):
    try:
        return abs(float(a) - float(b)) <= tol
    except Exception:
        return False


def norm(s):
    return unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode().lower().strip()


def num_br(v):
    s = str(v or '').strip().replace('R$', '').replace(' ', '')
    if not s: return 0.0
    if ',' in s and '.' in s: s = s.replace('.', '').replace(',', '.')
    elif ',' in s: s = s.replace(',', '.')
    try: return float(s)
    except ValueError: return 0.0


def linhas_xlsx(ws):
    return [[c.value for c in r] for r in ws.iter_rows()]


def kv_aba(ws):
    # pares rótulo → valor (coluna A → B); vale a primeira ocorrência (o Resumo do dossiê tem uma tabela depois dos pares)
    out = {}
    for r in ws.iter_rows():
        if r[0].value is not None and len(r) > 1 and str(r[0].value) not in out:
            out[str(r[0].value)] = r[1].value
    return out


async def main():
    hoje = datetime.date.today().isoformat()
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
        page = await ctx.new_page()
        erros, dialogos, escritas = [], [], []
        logado = {'v': False}
        page.on('pageerror', lambda e: erros.append(str(e)))
        page.on('console', lambda m: erros.append('console: ' + m.text) if logado['v'] and m.type == 'error' and 'MES LION 1.5' in m.text else None)
        page.on('request', lambda r: escritas.append((r.method, r.url)) if r.method in ('POST', 'PUT', 'PATCH', 'DELETE') else None)

        def dialogo(d):
            dialogos.append(d.message)
            asyncio.ensure_future(d.accept('Teste dos relatórios') if d.type == 'prompt' else d.accept())
        page.on('dialog', dialogo)
        ev = page.evaluate

        def sessao():
            return requests.Session()

        async def cookies():
            return {c['name']: c['value'] for c in await ctx.cookies()}

        async def dados_servidor():
            return requests.get(BASE + '/api/bootstrap', cookies=await cookies(), timeout=180).json()['data']

        async def auditoria(de, ate, limite=2000):
            r = requests.get(BASE + f'/api/audit?de={de}&ate={ate}&limite={limite}', cookies=await cookies(), timeout=60)
            return r.status_code, (r.json() if r.status_code == 200 else None)

        async def esperar(cond, segundos=25):
            fim = time.time() + segundos
            while time.time() < fim:
                try:
                    if await cond(): return True
                except Exception:
                    pass
                await page.wait_for_timeout(500)
            return False

        async def esperar_previa():
            await page.wait_for_function("document.querySelector('#mes15_previa') && !/Calculando/.test(document.querySelector('#mes15_previa').innerText)", timeout=60000)
            await page.wait_for_timeout(150)

        async def menu(k):
            # o grupo "Relatórios" do menu lateral começa fechado, como os outros grupos: abre e clica no item
            if not await ev(f"document.getElementById('nav_{k}').closest('details').open"):
                await page.click(f'nav details:has(#nav_{k}) > summary')
            await page.click('#nav_' + k)
            await page.wait_for_timeout(400)

        async def baixar(acao):
            async with page.expect_download(timeout=60000) as info:
                await acao()
            dl = await info.value
            caminho = os.path.join(PASTA, dl.suggested_filename)   # o openpyxl exige a extensão .xlsx no nome
            await dl.save_as(caminho)
            return dl.suggested_filename, caminho

        await page.goto(BASE + '/', wait_until='load')
        await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026'); await page.click('.login-card button')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1800)
        logado['v'] = True

        # ------------------------------------------------------------------ menu e catálogo
        ini = await ev("""() => ({ v: window.MES_ADAPTADOR_RELATORIOS, api: !!window.mesRelatoriosAPI,
            grupos: Array.from(document.querySelectorAll('nav details summary b')).map(b => b.textContent.trim()),
            itens: ['relatorios', 'relatorios_dossie', 'relatorios_modelos'].map(k => { const b = document.getElementById('nav_' + k); return b ? b.textContent.trim() : null; }) })""")
        ok(ini['v'] == '1.6.1' and ini['api'], 'adaptador 1.6.1 (relatórios) carregado', ini)
        g = ini['grupos']
        ok('Relatórios' in g and ini['itens'] == ['Catálogo de relatórios', 'Dossiê da OP', 'Meus modelos'] and ('Administração' not in g or g.index('Relatórios') == g.index('Administração') - 1),
           'menu "Relatórios" com Catálogo, Dossiê da OP e Meus modelos (antes de Administração)', ini)
        lista = await ev('mesRelatoriosAPI.lista()')
        mods = await ev('mesRelatoriosAPI.modulos()')
        ids = [r['id'] for r in lista]
        ok(len(lista) >= 38 and len(set(ids)) == len(ids) and len(mods) == 11 and all(any(r['modulo'] == m['id'] for r in lista) for m in mods),
           f'catálogo com {len(lista)} relatórios em {len(mods)} módulos (todos os módulos com relatório)', (len(lista), [m['id'] for m in mods]))
        await menu('relatorios')
        cards = await ev("document.querySelectorAll('.mes15-rel').length")
        ok(cards == len(lista) and await ev("document.getElementById('title').textContent") == 'Relatórios', 'tela do catálogo com um cartão por relatório', cards)
        await page.fill('#mes15_q', 'etiqueta')
        await page.wait_for_timeout(300)
        vis = await ev("Array.from(document.querySelectorAll('.mes15-rel')).map(x => x.dataset.rel)")
        ok('pipa_etiquetas' in vis and 'cad_recursos' not in vis and len(vis) < len(lista), 'busca no catálogo ("etiqueta")', vis)
        await page.fill('#mes15_q', '')
        await ev("mesRelCatalogo('perdas')")
        await page.wait_for_timeout(200)
        vis = await ev("Array.from(document.querySelectorAll('.mes15-rel')).map(x => x.dataset.rel)")
        ok(vis and all(i.startswith('perdas') for i in vis), 'filtro por módulo no catálogo (Perdas)', vis)
        await ev("mesRelCatalogo('')")

        # ------------------------------------------------------------------ todos os relatórios: sem erro, sem alterar dados, sem gravar
        foto = "JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k, v]) => !(Array.isArray(v) && v.length > 5000))))"
        antes = json.loads(await ev(foto))
        escritas.clear()
        execs = await ev("""async () => { const out = {};
            for (const r of mesRelatoriosAPI.lista()) {
              try { const t0 = performance.now(); const x = await mesRelatoriosAPI.executar(r.id, {}); out[r.id] = { n: x.linhas.length, total: x.total, ms: Math.round(performance.now() - t0) }; }
              catch (e) { out[r.id] = { erro: String(e && e.message || e) }; } }
            return out; }""")
        depois = json.loads(await ev(foto))
        com_erro = {k: v for k, v in execs.items() if 'erro' in v}
        ok(not com_erro and len(execs) == len(lista), 'todos os relatórios executam sem erro', com_erro)
        dif = sorted(k for k in set(antes) | set(depois) if antes.get(k) != depois.get(k))
        ok(not dif, 'executar todos os relatórios não altera nenhum dado em memória (custo da OP e afins ficam sem efeito)', dif)
        ok(not [e for e in escritas if '/api/' in e[1]], 'executar os relatórios não grava nada no servidor', escritas[:5])
        print('     linhas por relatório:', {k: v.get('n') for k, v in execs.items()}, flush=True)

        # ------------------------------------------------------------------ 1.6.1: custo por OP, MRP e Consistência dos dados
        r161 = await ev("""async () => {
            const co = (await mesRelatoriosAPI.executar('custo_op', {})).linhas.filter(l => String(l.OP).startsWith('OP20260812094138'));
            const a = auditCostFamilyV4014('OP20260812094138-PA').resumo[0];
            const mr = (await mesRelatoriosAPI.executar('pcp_mrp', {})).linhas, cs = await mesRelatoriosAPI.executar('aud_consistencia', {});
            return { proc: co.reduce((s, l) => s + l.Processo, 0), tef: co.reduce((s, l) => s + l.TotalEf, 0), fam: [a.CustoEnergia + a.CustoMOD, a.CustoTotal, a.CustoMateriais],
                     pa: (co.find(l => l.OP === 'OP20260812094138-PA') || {}).Processo, o1: (co.find(l => l.OP === 'OP20260812094138-01') || {}).Processo,
                     cols: (await mesRelatoriosAPI.executar('custo_op', {})).colunas.map(c => c.k),
                     mrp: mr.length > 0 && mr.every(l => l.JaConsumido > 0 ? l.Bruta <= l.Planejado + 1e-9 : Math.abs(l.Bruta - l.Planejado) < 1e-9),
                     cs: cs.linhas.map(l => [l.Gravidade, l.Tipo, l.Registro]), resumo: cs.resumo }; }""")
        ok(perto(r161['proc'], r161['fam'][0], 1e-4) and perto(r161['tef'], r161['fam'][1], 1e-4) and perto(r161['pa'], 3069.221, 1e-3) and perto(r161['o1'], 461.768, 1e-3)
           and all(k in r161['cols'] for k in ('Energia', 'MOD', 'Perdas', 'KWh')),
           '1.6.1: Custo por OP — energia + MOD de cada OP somam a da família (4.633,51) e o total efetivo das OPs fecha com o custo da família', r161)
        ok(perto(r161['fam'][2], 967.694735, 1e-6), '1.6.1: família encerrada com materiais = só o consumo real (970,138335 − 0,1274 − 2,3162 do planejado sem consumo)', r161['fam'])
        ok(r161['mrp'], '1.6.1: relatório de MRP com planejado, já consumido e necessidade = o que falta consumir', r161['mrp'])
        tipos = {(g, t) for g, t, _ in r161['cs']}
        esperados = {('Erro', 'Lote com saldo negativo'), ('Erro', 'Passaporte ligado a OP inexistente'), ('Atenção', 'Código de equipamento repetido'), ('Atenção', 'Custo gravado diferente do cálculo atual'),
                     ('Atenção', 'Potência fora do comum'), ('Atenção', 'Perda de material sem lote'), ('Atenção', 'Registro de OP excluída'), ('Atenção', 'Tarifa de energia diferente no cadastro de recursos'),
                     ('Atenção', 'UM da entrada diferente da UM do material'), ('Informação', 'OP encerrada com material planejado sem consumo'), ('Informação', 'Etapa concentra a energia da família')}
        ok(esperados <= tipos, '1.6.1: Consistência dos dados aponta lotes negativos, passaporte sem OP, códigos repetidos, custo gravado desatualizado, potência, perdas sem lote, OPs excluídas, tarifa, UM e energia concentrada',
           sorted(esperados - tipos))
        neg = sorted(r for g, t, r in r161['cs'] if t == 'Lote com saldo negativo')
        rep = sorted(r for g, t, r in r161['cs'] if t == 'Código de equipamento repetido')
        ok(neg == ['EN0013 · MP0013', 'EN0014 · MP0014', 'EN0015 · MP0015'] and rep == ['Código 12', 'Código 6'], '1.6.1: lotes negativos EN0013, EN0014 e EN0015; códigos 6 e 12 repetidos', (neg, rep))
        ok([x[0] for x in r161['resumo'][:3]] == ['Erros (número errado hoje)', 'Atenção (provavelmente errado ou desatualizado)', 'Informação (regra aplicada)'] and r161['cs'][0][0] == 'Erro',
           '1.6.1: Consistência ordenada por gravidade (Erro primeiro) com o resumo por gravidade', r161['resumo'])

        sem_tela = []
        for r in lista:
            await ev(f"mesRelAbrir('{r['id']}')")
            try:
                await esperar_previa()
                info = await ev("(document.querySelector('.mes15-info') || {}).innerText || ''")
                if 'registro' not in info: sem_tela.append((r['id'], info[:80]))
            except Exception as ex:
                sem_tela.append((r['id'], str(ex)[:80]))
        ok(not sem_tela and not erros, 'a tela de cada relatório abre com a prévia (filtros, colunas, total de registros) sem erro', (sem_tela, erros[:3]))

        # ------------------------------------------------------------------ números = funções das telas
        chk = await ev("""async () => {
            const A = mesRelatoriosAPI, R = async (id, f) => (await A.executar(id, f || {})).linhas, out = {};
            const lotes = await R('est_lotes'), base = mesLinhasEstoque();
            out.lotes = { n: lotes.length, nb: base.length,
              ident: lotes.every(l => Math.abs(l.Saldo - (l.QtdEntrada - l.Consumo - l.Perdas - l.AjusteSaida - l.BaixaTecnica)) < 1e-6),
              igual: lotes.every(l => { const b = base.find(x => x.Entrada === l.Entrada); return b && Math.abs(num(b.Saldo) - l.Saldo) < 1e-9 && Math.abs(l.ValorSaldo - l.Saldo * l.CustoUnit) < 1e-6; }) };
            const mats = await R('est_materiais'), res = mesResumoMateriaisEstoque();
            out.mats = { n: mats.length, nb: res.length,
              igual: mats.every(m => { const r = res.find(x => x.CodigoMaterial === m.Material); return r && Math.abs(num(r.SaldoFisico) - m.Saldo) < 1e-9 && Math.abs(num(r.Reservado) - m.Reservado) < 1e-9
                && Math.abs(m.Disponivel - (m.Saldo - m.Reservado)) < 1e-6 && m.Status === r.Status; }),
              /* 1.6.1: o lote fica na UM da entrada e o material, na UM do material (conversão do estoque) */
              somaLotes: mats.every(m => Math.abs(lotes.filter(l => l.Material === m.Material).reduce((s, l) => s + mesEstoqueAPI.converterUM(l.Saldo, l.UM, m.UM, m.Material).q, 0) - m.Saldo) < 1e-6) };
            const L = mesApontamentoPI14.livro(), pl = await R('pipa_lote');
            out.pipa = { n: pl.length, nl: Object.keys(L.lotes).length,
              igual: pl.every(x => { const l = L.lotes[x.Lote]; return l && Math.abs(l.Saldo - x.Saldo) < 1e-9 && Math.abs(l.Disponivel - x.Disponivel) < 1e-9
                && Math.abs(x.Saldo - (x.Produzido - x.Consumido - x.Perdido - x.Baixado)) < 1e-6; }) };
            const pp = await R('pipa_produto');
            out.pipaProd = pp.length > 0 && pp.every(p => Math.abs(pl.filter(x => x.Produto === p.Produto && x.Tipo === p.Tipo && x.UM === p.UM).reduce((s, x) => s + x.Saldo, 0) - p.Saldo) < 1e-6);
            const mov = await R('pipa_mov');
            out.mov = pl.every(x => { const ms = mov.filter(m => m.Lote === x.Lote); return ms.length ? Math.abs(ms[ms.length - 1].SaldoApos - x.Saldo) < 1e-6 : Math.abs(x.Saldo) < 1e-9; });
            const po = await R('prod_ops'), soma = {};
            (data.producao || []).forEach(p => { soma[p.CodOP] = (soma[p.CodOP] || 0) + num(p['Quantidade produzida'] || p.QuantidadeProduzida || p.Quantidade); });
            out.prod = { n: po.length, ok: po.every(o => Math.abs(o.Produzido - (soma[o.OP] || 0)) < 1e-6 && Math.abs(o.Saldo - (o.Planejado - o.Produzido)) < 1e-6) };
            const tm = await R('tempo_maquina_op');
            out.tempo = po.every(o => Math.abs(tm.filter(t => t.OP === o.OP && t.Planejado !== '').reduce((s, t) => s + t.Planejado, 0) - o.TempoPlan) < 1e-6);
            const pc = await R('perdas_pareto');
            out.pareto = { soma: pc.reduce((s, x) => s + x.Ocorrencias, 0), n: (data.perdas || []).length, ult: pc.length ? pc[pc.length - 1].PctAcum : null };
            const carga = await R('pcp_carga'), h = new Date(), ini = h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-01',
              fim = new Date(h.getFullYear(), h.getMonth() + 1, 0), fimS = fim.getFullYear() + '-' + String(fim.getMonth() + 1).padStart(2, '0') + '-' + String(fim.getDate()).padStart(2, '0');
            const cap = mesCapRelatorioDados(ini, fimS);
            out.carga = { n: carga.length, nc: cap.length, igual: carga.every(c => { const x = cap.find(y => String(y.Codigo) === c.Maquina); return x && Math.abs(num(x.Carga) - c.Carga) < 1e-6
              && (!x.Configurado || Math.abs(num(x.HorasEfetivas) - c.HorasEfetivas) < 1e-6) && (x.Ocupacao == null ? c.Ocupacao === '' : Math.abs(x.Ocupacao - c.Ocupacao) < 1e-6); }) };
            return out; }""")
        ok(chk['lotes']['n'] == chk['lotes']['nb'] and chk['lotes']['ident'] and chk['lotes']['igual'],
           'Saldo por lote = Estoque / Rastreabilidade (recebido − consumido − perdas − saídas − baixas; valor = saldo × custo)', chk['lotes'])
        ok(chk['mats']['n'] == chk['mats']['nb'] and chk['mats']['igual'] and chk['mats']['somaLotes'],
           'Saldo por material = visão "Por material" (saldo, reservado, disponível, situação) e = soma dos lotes', chk['mats'])
        ok(chk['pipa']['n'] == chk['pipa']['nl'] and chk['pipa']['igual'] and chk['pipaProd'] and chk['mov'],
           'PI e PA: lotes = livro do Estoque PI / PA; por produto = soma dos lotes; saldo após o último movimento = saldo do lote', chk)
        ok(chk['prod']['n'] > 0 and chk['prod']['ok'] and chk['tempo'], 'Ordens de produção: produzido = soma dos apontamentos; tempo planejado = soma das máquinas', chk['prod'])
        ok(chk['pareto']['soma'] == chk['pareto']['n'] and (chk['pareto']['n'] == 0 or perto(chk['pareto']['ult'], 100)), 'Pareto de perdas: todas as perdas e acumulado em 100%', chk['pareto'])
        ok(chk['carga']['n'] == chk['carga']['nc'] and chk['carga']['igual'], 'Carga × capacidade = relatório da tela (mês atual)', chk['carga'])

        # tempo por máquina: um apontamento finalizado (em memória, desfeito no fim) = tempo real gravado na etapa pela 1.4.0
        tp = await ev("""async () => {
            const a = mesApontamentoPI14, op = data.op.find(o => !/conclu|encerr|cancel/i.test(o.Status || '') && a.maquinasDaOP(o).length);
            if (!op) return null;
            const m = a.maquinasDaOP(op)[0], sv = window.saveLocal, bak = JSON.stringify({ t: data.apontamento_tempos || null, e: data.op_etapas });
            window.saveLocal = function () {};
            try {
              data.apontamento_tempos = data.apontamento_tempos || [];
              data.apontamento_tempos.push({ IdApontamentoTempo: 'TESTE-REL-1', CodOP: op.CodOP, OrdemEtapa: m.Ordem, Processo: m.Processo, IdRecursoRoteiro: m.IdRecursoRoteiro,
                CodEquipamento: m.CodEquipamento, Equipamento: m.Equipamento, Operador: 'admin', DataApontamento: '01/11/2026', HoraInicio: '08:00', DataFim: '01/11/2026',
                HoraFim: '09:30', DuracaoMin: '90', Status: 'Finalizado', Origem: 'TESTE' });
              a.recalcularTempoReal(op.CodOP);
              const r = (await mesRelatoriosAPI.executar('tempo_maquina_op', { op: op.CodOP })).linhas.filter(x => x.Real !== '');
              const t = (await mesRelatoriosAPI.executar('tempo_apont', { op: op.CodOP })).linhas;
              const mes = (await mesRelatoriosAPI.executar('tempo_maquina_mes', { de: '2026-11-01', ate: '2026-11-30' })).linhas;
              const po = (await mesRelatoriosAPI.executar('prod_ops', { op: op.CodOP })).linhas.find(x => x.OP === op.CodOP);
              return { real: r.map(x => [x.CodMaquina, x.Real, x.Situacao]), etapa: m.etapa.TempoReal, origem: m.etapa.TempoRealOrigem, cod: m.CodEquipamento,
                apont: t.map(x => [x.Duracao, x.Horas, x.Status, x.Inicio, x.Fim]), mes: mes.map(x => [x.Mes, x.CodMaquina, x.Minutos, x.Apontamentos]), tempoReal: po && po.TempoReal };
            } finally {
              const o = JSON.parse(bak); data.apontamento_tempos = o.t || [];
              data.op_etapas.forEach((x, i) => { Object.keys(x).forEach(k => { if (!(k in o.e[i])) delete x[k]; }); Object.assign(x, o.e[i]); });
              window.saveLocal = sv;
            } }""")
        ok(tp is None or (tp['real'] == [[tp['cod'], 90, 'Apontado']] and tp['etapa'] == '90' and tp['origem'] == 'APONTAMENTO_TEMPO_MAQUINA'
                          and tp['apont'] == [[90, 1.5, 'Finalizado', '2026-11-01T08:00:00', '2026-11-01T09:30:00']] and ['2026-11', tp['cod'], 90, 1] in tp['mes'] and tp['tempoReal'] == 90),
           'tempo por máquina: real do relatório = tempo real gravado na etapa (1.4.0); apontamentos, horas por mês e tempo real da OP', tp)

        # ------------------------------------------------------------------ filtros, colunas e ordem (expectativas calculadas dos dados do servidor)
        srv = await dados_servidor()
        cons = srv.get('consumos_materiais') or []
        esperado_dia = sum(1 for c in cons if str(c.get('DataApontamento', '')).startswith('11/08/2026'))
        r = await ev("async () => (await mesRelatoriosAPI.executar('est_consumos', { de: '2026-08-11', ate: '2026-08-11' })).linhas.map(l => l.Data)")
        ok(len(r) == esperado_dia and all(x.startswith('2026-08-11') for x in r), f'filtro de período (11/08/2026): {esperado_dia} consumos', (len(r), r[:3]))
        r = await ev("async () => (await mesRelatoriosAPI.executar('est_consumos', { de: '11/08/2026' })).linhas.length")
        ok(r == sum(1 for c in cons if (lambda d: d and d >= '2026-08-11')('-'.join(reversed(str(c.get('DataApontamento', ''))[:10].split('/'))))), 'período só com "de" (data dd/mm/aaaa aceita)', r)
        prod = srv.get('producao') or []
        r = await ev(f"async () => (await mesRelatoriosAPI.executar('prod_apont', {{ op: '{FAM_FECHADA}-0' }})).linhas.map(l => l.OP)")
        ok(sorted(r) == sorted(p['CodOP'] for p in prod if (FAM_FECHADA + '-0') in p['CodOP']) and len(r) > 0, 'filtro de OP (contém)', r)
        todos = await ev("async () => (await mesRelatoriosAPI.executar('est_lotes', {})).linhas")
        esperado = [l for l in todos if 'solvente' in norm(l['Material']) or 'solvente' in norm(l['Descricao'])]
        r = await ev("async () => (await mesRelatoriosAPI.executar('est_lotes', { produto: 'SOLVÊNTE' })).linhas.map(l => l.Entrada)")
        ok(len(esperado) > 0 and sorted(r) == sorted(l['Entrada'] for l in esperado), 'filtro de produto sem diferenciar acento e maiúscula ("SOLVÊNTE")', (r, [l['Entrada'] for l in esperado]))
        sit = todos[0]['Situacao'] if todos else ''
        r = await ev(f"async () => (await mesRelatoriosAPI.executar('est_lotes', {{ status: '{sit}' }})).linhas.length")
        ok(r == sum(1 for l in todos if l['Situacao'] == sit), f'filtro de situação ("{sit}")', r)
        nf = (srv.get('entradas') or [{}])[0].get('N° NF', '')
        r = await ev(f"async () => (await mesRelatoriosAPI.executar('est_entradas', {{ busca: '{nf}' }})).linhas.map(l => l.NF)")
        ok(nf and r and all(nf.lower() in x.lower() for x in r) and len(r) == sum(1 for e in srv['entradas'] if nf.lower() in str(e.get('N° NF', '')).lower()), f'busca livre ("{nf}")', r)
        r = await ev("async () => { const x = await mesRelatoriosAPI.executar('prod_ops', {}, ['OP', 'Planejado', 'Produzido'], { k: 'Planejado', dir: 'desc' }); return { c: x.colunas.map(c => c.k), v: x.linhas.map(l => l.Planejado) }; }")
        ok(r['c'] == ['OP', 'Planejado', 'Produzido'] and r['v'] == sorted(r['v'], reverse=True), 'escolha de colunas e ordem decrescente', r)

        # ------------------------------------------------------------------ Excel pela tela (filtro, coluna desmarcada, ordem) + Histórico
        await menu('relatorios')
        await page.click('.mes15-rel[data-rel="est_lotes"] >> text=Abrir')
        await esperar_previa()
        await page.fill('#mes15_f_produto', 'solvente')
        await page.press('#mes15_f_produto', 'Tab')
        await page.wait_for_timeout(500)
        await esperar_previa()
        await page.click('#mes15_cols_box summary')
        await page.uncheck('#mes15_cols input[value="Fornecedor"]')
        await page.wait_for_timeout(300)
        await ev("mesRelOrdenar('Saldo')"); await page.wait_for_timeout(200)
        await ev("mesRelOrdenar('Saldo')"); await page.wait_for_timeout(300)
        await esperar_previa()
        tela = await ev("({ info: document.querySelector('.mes15-info').innerText, th: Array.from(document.querySelectorAll('.mes15-tab thead th')).map(t => t.innerText.trim()), tot: (document.querySelector('.mes15-tab tfoot') || {}).innerText || '' })")
        n_esp = len(esperado)
        ok(tela['info'].startswith(str(n_esp)) and not any(t.startswith('Fornecedor') for t in tela['th']) and any(t.startswith('Saldo') and '▼' in t for t in tela['th']) and 'Total' in tela['tot'],
           'prévia na tela: registros filtrados, coluna desmarcada, ordem por Saldo ▼ e linha de totais', tela)
        nome, caminho = await baixar(lambda: page.click('#mes15_btn_xlsx'))
        ok(re.match(r'^MES_LION_saldo_por_lote_entrada_\d{8}_\d{4}\.xlsx$', nome) is not None, 'nome do arquivo exportado', nome)
        wb = openpyxl.load_workbook(caminho)
        wbv = openpyxl.load_workbook(caminho, data_only=True)
        ok(wb.sheetnames == ['Saldo por lote', 'Parâmetros'], 'abas do Excel: dados + Parâmetros', wb.sheetnames)
        ws, wsv = wb.worksheets[0], wbv.worksheets[0]
        cab = [c.value for c in ws[1]]
        ums = sorted({l['UM'] for l in esperado})
        col = {v: i for i, v in enumerate(cab)}
        saldo_cab = 'Saldo (' + ums[0] + ')' if len(ums) == 1 else 'Saldo'
        ok('Fornecedor' not in cab and saldo_cab in cab and 'Valor do saldo (R$)' in cab and 'Data da entrada' in cab, 'cabeçalho com a unidade (UM única → no nome da coluna; R$ nas colunas de valor)', cab)
        dados = [[c.value for c in r] for r in ws.iter_rows(min_row=2, max_row=1 + n_esp)]
        isaldo, idata, ivalor = col.get(saldo_cab), col.get('Data da entrada'), col.get('Valor do saldo (R$)')
        ok(len(dados) == n_esp and all(isinstance(r[isaldo], (int, float)) for r in dados) and all(isinstance(r[idata], datetime.datetime) for r in dados if r[idata] is not None)
           and all(isinstance(r[ivalor], (int, float)) for r in dados), 'números gravados como número e datas como data', dados[:2])
        ok([r[isaldo] for r in dados] == sorted([r[isaldo] for r in dados], reverse=True), 'linhas na mesma ordem da tela (Saldo decrescente)', [r[isaldo] for r in dados])
        ultima = [c.value for c in ws[n_esp + 2]]
        ultima_v = [c.value for c in wsv[n_esp + 2]]
        letra = openpyxl.utils.get_column_letter(ivalor + 1)
        ok(str(ultima[0]).startswith('Total (' + str(n_esp)) and ultima[ivalor] == f'=SUBTOTAL(109,{letra}2:{letra}{n_esp + 1})'
           and perto(ultima_v[ivalor], sum(r[ivalor] for r in dados), 1e-6), 'linha Total com SUBTOTAL(109) (acompanha o filtro do Excel) e valor já calculado', (ultima, ultima_v[ivalor]))
        ok(ws.auto_filter.ref == f'A1:{openpyxl.utils.get_column_letter(len(cab))}{n_esp + 1}' and ws.freeze_panes == 'A2', 'filtro automático e cabeçalho congelado', (ws.auto_filter.ref, ws.freeze_panes))
        fmt_valor = ws.cell(row=2, column=ivalor + 1).number_format
        fmt_data = ws.cell(row=2, column=idata + 1).number_format
        ok('R$' in fmt_valor and fmt_data == 'dd/mm/yyyy', 'formatos: moeda em R$ e data dd/mm/aaaa', (fmt_valor, fmt_data))
        par = kv_aba(wb['Parâmetros'])
        ok(par.get('Relatório') == 'Saldo por lote (entrada)' and par.get('Filtro: Material ou descrição') == 'solvente' and par.get('Ordenação') == 'Saldo (decrescente)'
           and 'admin' in str(par.get('Usuário')) and '1.6.1' in str(par.get('Versão')) and isinstance(par.get('Gerado em'), datetime.datetime)
           and par.get('Registros exportados') == n_esp and 'saldo = recebido' in str(par.get('Regra de cálculo')), 'aba Parâmetros: relatório, filtros, ordem, data e hora, usuário, versão e regra de cálculo', par)
        st, aud = await auditoria(hoje, hoje)
        reg = [a for a in (aud or []) if a.get('module') == 'relatorios' and a.get('action') == 'EXPORTAR' and a.get('record_key') == 'est_lotes']
        det = (reg[0].get('details') or {}) if reg else {}
        ok(st == 200 and reg and det.get('arquivo') == nome and det.get('linhas') == str(n_esp) and 'solvente' in str(det.get('filtros')) and reg[0].get('username') == 'admin',
           'exportação registrada no Histórico de Modificações (usuário, relatório, arquivo, linhas e filtros)', (st, reg[:1]))

        # ------------------------------------------------------------------ modelos salvos
        await page.click('text=⭐ Salvar como modelo')
        await page.fill('#mes15_modelo_nome', 'Solventes por saldo')
        await page.click('text=Salvar modelo')
        await page.wait_for_timeout(400)
        m = await ev("(data.relatorios_modelos || []).map(m => ({ n: m.Nome, r: m.Relatorio, f: m.Filtros, c: m.Colunas, o: m.Ordem, por: m.CriadoPor, id: m.IdModelo }))")
        ncols = len([c for c in next(x for x in lista if x['id'] == 'est_lotes')['colunas']])
        ok(len(m) == 1 and m[0]['r'] == 'est_lotes' and m[0]['f'].get('produto') == 'solvente' and 'Fornecedor' not in m[0]['c'] and len(m[0]['c']) == ncols - 1
           and m[0]['o'] == {'k': 'Saldo', 'dir': 'desc'} and m[0]['por'] == 'admin', 'modelo salvo com filtros, colunas e ordem', m)
        ok(await esperar(lambda: _tem_modelo(dados_servidor, 'Solventes por saldo')), 'modelo gravado no servidor (data.relatorios_modelos)')
        await page.click('text=⭐ Salvar como modelo')
        await page.click('text=Salvar modelo')
        await page.wait_for_timeout(400)
        ok(await ev("data.relatorios_modelos.length") == 1, 'salvar de novo com o mesmo nome substitui o modelo (sem duplicar)', await ev("data.relatorios_modelos.map(m => m.Nome)"))
        await menu('relatorios_modelos')
        ok('Solventes por saldo' in await page.inner_text('#content'), 'Meus modelos lista o modelo')
        await page.click('.mes15-tab >> text=Abrir')
        await esperar_previa()
        aberto = await ev("""({ tag: (document.querySelector('.toolbar .mes15-tag') || {}).innerText || '', prod: document.getElementById('mes15_f_produto').value,
            th: Array.from(document.querySelectorAll('.mes15-tab thead th')).map(t => t.innerText.trim()), info: document.querySelector('.mes15-info').innerText })""")
        ok('Solventes por saldo' in aberto['tag'] and aberto['prod'] == 'solvente' and len(aberto['th']) == ncols - 1 and aberto['info'].startswith(str(n_esp))
           and any(t.startswith('Saldo') and '▼' in t for t in aberto['th']), 'abrir o modelo devolve filtros, colunas e ordem', aberto)
        await menu('relatorios_modelos')
        nome2, caminho2 = await baixar(lambda: page.click('.mes15-tab >> text=Excel'))
        par2 = kv_aba(openpyxl.load_workbook(caminho2)['Parâmetros'])
        ok(nome2.startswith('MES_LION_solventes_por_saldo_') and 'Solventes por saldo' in str(par2.get('Modelo salvo')) and par2.get('Registros exportados') == n_esp,
           'exportar o modelo direto de Meus modelos', (nome2, par2.get('Modelo salvo')))
        dialogos.clear()
        await page.click('.mes15-tab >> text=Excluir')
        await page.wait_for_timeout(500)
        ok(any('Excluir o modelo' in d for d in dialogos) and await ev("(data.relatorios_modelos || []).length") == 0, 'excluir modelo (com confirmação)', dialogos)
        ok(await esperar(lambda: _sem_modelos(dados_servidor)), 'exclusão gravada no servidor')

        # ------------------------------------------------------------------ Excel (tudo) direto do catálogo
        await menu('relatorios')
        nome3, caminho3 = await baixar(lambda: page.click('.mes15-rel[data-rel="prod_ops"] >> text=Excel (tudo)'))
        wb3 = openpyxl.load_workbook(caminho3)
        ws3 = wb3.worksheets[0]
        cab3 = [c.value for c in ws3[1]]
        n3 = execs['prod_ops']['n']
        ia = cab3.index('Atendido') + 1 if 'Atendido' in cab3 else None
        fmts_pct = {ws3.cell(row=i, column=ia).number_format for i in range(2, n3 + 2) if ia and isinstance(ws3.cell(row=i, column=ia).value, (int, float))}
        ok(nome3.startswith('MES_LION_ordens_de_producao_') and ws3.max_row == n3 + 2 and fmts_pct == {'0.0%'},
           '"Excel (tudo)" no catálogo: todas as OPs, percentual gravado como percentual', (nome3, ws3.max_row, n3, fmts_pct))
        ok('Exportado' in await page.inner_text('#mes15_cat_msg'), 'mensagem de exportação no catálogo')

        # ------------------------------------------------------------------ Ajuste de Estoque (1.3.0): saída e estorno aparecem no relatório e no saldo do lote
        lotes0 = await ev("async () => (await mesRelatoriosAPI.executar('est_lotes', {})).linhas")
        alvo = next((l for l in lotes0 if l['Saldo'] >= 0.2), None)
        if alvo:
            await menu('ajuste_estoque')
            await ev(f"mesAjusteMaterial('{alvo['Material']}')"); await ev("mesAjusteTipo('SAIDA')")
            await page.wait_for_timeout(300)
            await page.fill('#mea_qtd', '0,1')   # quantidade total; o lote escolhido recebe tudo
            await ev(f"""(() => {{ document.querySelectorAll('#mea_form .mea-q').forEach(i => i.value = i.dataset.entrada === '{alvo["Entrada"]}' ? '0,1' : ''); mesAjusteSomar(); }})()""")
            dialogos.clear()
            await ev("mesAjusteRegistrar()")
            await page.wait_for_timeout(800)
            consulta = f"""async () => {{ const a = (data.estoque_ajustes || [])[0] || {{}};
                return {{ id: a.IdAjuste, r: (await mesRelatoriosAPI.executar('est_ajustes', {{}})).linhas.filter(x => x.Id === a.IdAjuste),
                  l: (await mesRelatoriosAPI.executar('est_lotes', {{}})).linhas.find(x => x.Entrada === '{alvo['Entrada']}') }}; }}"""
            aj = await ev(consulta)
            r0 = aj['r'][0] if aj['r'] else {}
            ok(len(aj['r']) == 1 and r0.get('Entrada') == alvo['Entrada'] and perto(r0.get('Qtd'), 0.1) and perto(r0.get('Efeito'), -0.1) and r0.get('Situacao') == 'ATIVO'
               and perto(aj['l']['AjusteSaida'], alvo['AjusteSaida'] + 0.1) and perto(aj['l']['Saldo'], alvo['Saldo'] - 0.1)
               and perto(aj['l']['Saldo'], aj['l']['QtdEntrada'] - aj['l']['Consumo'] - aj['l']['Perdas'] - aj['l']['AjusteSaida'] - aj['l']['BaixaTecnica']),
               'saída manual do Ajuste de Estoque: relatório de ajustes (efeito −0,1) e saldo do lote', (aj, dialogos[-1:]))
            await ev(f"mesAjusteEstornar('{aj['id']}')")
            await page.wait_for_timeout(800)
            es = await ev(consulta)
            r1 = es['r'][0] if es['r'] else {}
            ok(r1.get('Situacao') == 'ESTORNADO' and r1.get('Efeito') == 0 and perto(es['l']['Saldo'], alvo['Saldo']), 'estorno do ajuste: efeito zero e o saldo do lote volta', es)

        # ------------------------------------------------------------------ dossiê da OP (família) pela tela
        ref = await ev(f"""() => {{ const L = mesApontamentoPI14.livro(), fam = data.op.filter(o => mesApontamentoPI14.raizFamilia(o) === '{OPPA}').map(o => o.CodOP);
            return {{ fam, cons: (data.consumos_materiais || []).filter(c => fam.includes(c.CodOP)).length,
              pis: (data.op_pi_consumos || []).filter(c => fam.includes(c.CodOPConsumidora) && String(c.Status || 'ATIVO') !== 'CANCELADO').map(c => [c.CodigoPI, c.CodOPOrigemPI]),
              prod: (data.producao || []).filter(p => fam.includes(p.CodOP)).length }}; }}""")
        custo_ref = await ev(f"async () => (await mesRelatoriosAPI.executar('custo_familia', {{ ops: ['{OPPA}'] }})).linhas[0]")
        co2_ref = await ev(f"async () => (await mesRelatoriosAPI.executar('acv_familia', {{ ops: ['{OPPA}'] }})).linhas[0]")
        await menu('relatorios_dossie')
        await page.fill('#mes15_d_op', OPPA)
        await page.press('#mes15_d_op', 'Enter')
        await page.wait_for_function("document.querySelector('#mes15_d_prev .mes15-tab')", timeout=60000)
        prev = await ev("Array.from(document.querySelectorAll('#mes15_d_prev tbody tr')).map(t => t.cells[0].innerText.trim())")
        ok(prev == ABAS_DOSSIE, 'prévia do dossiê lista as abas', prev)
        nome4, caminho4 = await baixar(lambda: page.click('#mes15_d_btn'))
        ok(re.match(r'^MES_LION_Dossie_' + OPPA + r'_\d{8}_\d{4}\.xlsx$', nome4) is not None, 'nome do arquivo do dossiê', nome4)
        wb4 = openpyxl.load_workbook(caminho4)
        ok(wb4.sheetnames == ABAS_DOSSIE, 'dossiê com as 15 abas (resumo, produção, etiquetas, saldos, materiais, lotes, PIs, tempos, perdas, custo, CO₂, rastreabilidade, parâmetros)', wb4.sheetnames)
        res4 = kv_aba(wb4['Resumo'])
        ok(wb4['Resumo']['A1'].value == 'Dossiê da OP ' + OPPA and res4.get('OP') == OPPA and res4.get('Conteúdo do dossiê') == f"Família inteira: {len(ref['fam'])} OP(s)"
           and perto(res4.get('Custo total da família (R$)'), custo_ref['Total']) and perto(res4.get('CO₂eq total da família (kg)'), co2_ref['Total']),
           'resumo do dossiê: OP, família, custo e CO₂ da família iguais aos relatórios / telas', {k: res4.get(k) for k in ('OP', 'Conteúdo do dossiê', 'Custo total da família (R$)', 'CO₂eq total da família (kg)')})
        prod4 = wb4['Produção']
        ok(prod4.max_row == ref['prod'] + 2 and str(prod4.cell(row=prod4.max_row, column=1).value).startswith(f"Total ({ref['prod']}"), 'aba Produção com os apontamentos da família e linha Total', prod4.max_row)
        rast = linhas_xlsx(wb4['Rastreabilidade'])
        cr = {v: i for i, v in enumerate(rast[0])}
        mp = [r for r in rast[1:] if r[cr['Tipo']] == 'Lote de matéria-prima']
        lpi = [r for r in rast[1:] if r[cr['Tipo']] in ('Lote de PI', 'PI de outra família')]
        frente = [r for r in rast[1:] if str(r[cr['Direção']]).startswith('Para frente')]
        ok(len(mp) == ref['cons'] and all(r[cr['Nota fiscal']] for r in mp) and all(r[cr['Lote / entrada']] for r in mp),
           'rastreabilidade para trás: cada lote de matéria-prima consumido, com entrada / lote e nota fiscal', (len(mp), ref['cons']))
        ok(sorted((r[cr['Item']], r[cr['OP relacionada']]) for r in lpi) == sorted(tuple(x) for x in ref['pis']) and len(frente) >= len(ref['pis']),
           'rastreabilidade: cada PI consumido aponta a OP que o produziu, e o caminho para frente (PI → OP de PA)', (lpi[:2], len(frente)))
        cf = kv_aba(wb4['Custo e CO₂ da família'])
        ok(perto(cf.get('Total (R$)'), custo_ref['Total']) and perto(cf.get('CO₂eq total (kg CO₂eq)'), co2_ref['Total']), 'aba Custo e CO₂ da família', {k: cf.get(k) for k in ('Total (R$)', 'CO₂eq total (kg CO₂eq)')})
        par4 = kv_aba(wb4['Parâmetros'])
        ok(all(o in str(par4.get('OPs incluídas')) for o in ref['fam']) and par4.get('Dossiê da OP') == OPPA, 'Parâmetros do dossiê com as OPs incluídas', par4.get('OPs incluídas'))
        st, aud = await auditoria(hoje, hoje)
        regd = [a for a in (aud or []) if a.get('record_key') == 'dossie_op' and (a.get('details') or {}).get('arquivo') == nome4]
        ok(regd and str(len(ABAS_DOSSIE)) == (regd[0].get('details') or {}).get('abas'), 'dossiê registrado no Histórico de Modificações', regd[:1])

        # só a OP (PI): para trás os lotes da OP, para frente a OP de PA que consumiu
        so = await ev(f"async () => {{ const x = await mesRelatoriosAPI.dossie('{FAM_FECHADA}-03', false); return {{ m: x.membros, abas: x.abas.length, r: mesRelatoriosAPI.rastreabilidade(x.membros) }}; }}")
        fr = [r for r in so['r'] if r['Direcao'].startswith('Para frente') and r['Tipo'] == 'Consumido por outra OP']
        ok(so['m'] == [FAM_FECHADA + '-03'] and so['abas'] == len(ABAS_DOSSIE) and fr and all(r['OPRelacionada'] == OPPA for r in fr)
           and any(r['Tipo'] == 'Lote de matéria-prima' for r in so['r']), 'dossiê "só esta OP" (PI): lotes de entrada e a OP de PA que consumiu o PI', so)
        ok(await ev(f"async () => {{ try {{ await mesRelatoriosAPI.dossie('NAO-EXISTE', true); return false; }} catch (e) {{ return /não encontrada/.test(e.message); }} }}"),
           'dossiê de OP inexistente avisa "OP não encontrada"')

        # ------------------------------------------------------------------ histórico (relatório de auditoria) e contrato do servidor
        # período de ontem a amanhã: o navegador do teste está no fuso de São Paulo e o servidor pode estar em UTC (CI)
        ontem = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        amanha = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        r = await ev(f"async () => (await mesRelatoriosAPI.executar('aud_historico', {{ de: '{ontem}', ate: '{amanha}', status: 'EXPORTAR' }})).linhas.map(l => l.Registro)")
        ok('est_lotes' in r and 'dossie_op' in r and 'prod_ops' in r, 'relatório "Histórico de modificações" do dia mostra as exportações', r)
        st, vazio = await auditoria('2000-01-01', '2000-01-02')
        ok(st == 200 and vazio == [], '/api/audit?de=&ate= filtra pelo período (sem registros em 2000)', (st, vazio))
        rq = requests.get(BASE + '/api/audit?limite=1', cookies=await cookies(), timeout=30)
        ok(rq.status_code == 200 and len(rq.json()) == 1, '/api/audit?limite=1 devolve só o último registro', rq.text[:200])
        rq = requests.post(BASE + '/api/relatorios/exportacao', json={'relatorio': 'x'}, timeout=30)
        ok(rq.status_code == 401, 'registro de exportação exige login', rq.status_code)
        rq = requests.post(BASE + '/api/relatorios/exportacao', json={'nome': 'sem id'}, cookies=await cookies(), timeout=30)
        ok(rq.status_code == 400, 'registro de exportação sem o relatório é recusado (400)', rq.status_code)

        # ------------------------------------------------------------------ MRP e custo/CO₂ = funções das telas (chamadas diretas, com os dados restaurados depois)
        cmp = await ev("""async () => {
            const bak = JSON.stringify({ planos: data.mrp_planos, meta: data.meta, custos: data.custos_op, sust: data.sust_op, op: data.op, opm: data.op_materiais });
            const ativas = data.op.filter(o => !/cancel|exclu|anulad|encerrad|conclu/i.test(String(o.Status || ''))).map(o => String(o.CodOP));
            data.meta = data.meta || {}; data.meta.mrpOpsIncluidas = ativas; data.meta.mrpOpsInicializado = true;
            const sv = window.saveLocal; window.saveLocal = function () {};
            let tela = [], cf = [], af = [];
            try {
              tela = mesCalcMRPUnificado();
              const fams = (await mesRelatoriosAPI.executar('custo_familia', {})).linhas.map(l => l.Familia);
              cf = fams.map(f => [f, num(calcCustoFamiliaOPV33(f, false, {}).CustoTotal)]);
              af = fams.map(f => [f, num(calcSustFamiliaOPV33(f, false, {}).CO2eqTotal)]);
            } finally {
              window.saveLocal = sv;
              const o = JSON.parse(bak); data.mrp_planos = o.planos; data.meta = o.meta; data.custos_op = o.custos; data.sust_op = o.sust;
              data.op.forEach((x, i) => Object.assign(x, o.op[i])); data.op_materiais.forEach((x, i) => Object.assign(x, o.opm[i]));
            }
            const rel = (await mesRelatoriosAPI.executar('pcp_mrp', {})).linhas, rc = (await mesRelatoriosAPI.executar('custo_familia', {})).linhas, ra = (await mesRelatoriosAPI.executar('acv_familia', {})).linhas;
            const contrib = (await mesRelatoriosAPI.executar('acv_contribuicao', {})).linhas;
            return { n: rel.length, nt: tela.length,
              mrp: rel.every(r => { const t = tela.find(x => x.Item === r.Material); return t && Math.abs(t.NecessidadeBruta - r.Bruta) < 1e-6 && Math.abs(t.NecessidadeLiquida - r.Liquida) < 1e-6 && Math.abs(t.Estoque - r.Estoque) < 1e-6; }),
              custo: rc.length > 0 && rc.every(r => { const c = cf.find(x => x[0] === r.Familia); return c && Math.abs(c[1] - r.Total) < 1e-6; }),
              co2: ra.length > 0 && ra.every(r => { const c = af.find(x => x[0] === r.Familia); return c && Math.abs(c[1] - r.Total) < 1e-6 && Math.abs(r.PorUnidade - r.Total / r.Unidades) < 1e-6; }),
              contrib: ra.every(r => Math.abs(contrib.filter(c => c.Familia === r.Familia).reduce((s, c) => s + c.CO2, 0) - r.Total) < 1e-4 * Math.max(1, r.Total)),
              cf, af, mp17: (tela.find(x => x.Item === 'MP0017') || {}).NecessidadeBruta }; }""")
        ok(cmp['n'] == cmp['nt'] and cmp['mrp'], 'MRP das OPs abertas = MRP da tela com todas as OPs abertas marcadas (bruta, estoque e líquida)', cmp)
        ok(cmp['mp17'] is None or perto(cmp['mp17'], 0.001, 1e-9), 'MRP da tela lê "0.001" kg gravado como 0,001 (não 1)', cmp['mp17'])
        ok(cmp['custo'], 'Custo da família = módulo Custos (calcCustoFamiliaOPV33)', cmp['cf'])
        ok(cmp['co2'] and cmp['contrib'], 'Pegada de carbono = Sustentabilidade (calcSustFamiliaOPV33); por unidade = total ÷ unidades; contribuições somam o total', cmp['af'])

        ok(not erros, 'nenhum erro JavaScript', erros[:5])
        await b.close()

    print(f'\n== {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print('FALHAS:')
        for f in falhas: print(' -', f)
        sys.exit(1)


async def _tem_modelo(dados_servidor, nome):
    d = await dados_servidor()
    return any(m.get('Nome') == nome for m in d.get('relatorios_modelos') or [])


async def _sem_modelos(dados_servidor):
    d = await dados_servidor()
    return not (d.get('relatorios_modelos') or [])


asyncio.run(main())
