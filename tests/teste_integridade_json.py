#!/usr/bin/env python3
"""
Teste no navegador da versão JSON 1.7.2 — integridade dos dados (server/adaptador_integridade.js) e OP impressa:
  - entrada com dados no estado em que a versão anterior os deixava: textos genéricos de validação no passaporte,
    teores deduzidos gravados no cadastro da formulação, massa de deposição do coating de cátodo com o slurry de
    ânodo, registros de teste do frontend e OPs abertas de slurry com a regra antiga da formulação → tudo corrigido
    uma vez, com registro em meta, e gravado no servidor; OPs encerradas intocadas;
  - ver as telas, cada OP e cada roteiro, abrir o passaporte, "PDF OP Produção", "Picking List PDF", "Custos da OP" e
    "Exportar Excel" não mudam nada nos dados (na memória nem no servidor);
  - fórmula congelada: mudar o cadastro da formulação não muda a OP já gerada; "Atualizar quantidade e recalcular"
    recalcula pelo retrato guardado na OP; OP encerrada nunca é recalculada; o cadastro não recebe teores deduzidos;
  - custo projetado de OP encerrada não muda com uma entrada nova do material (a aberta acompanha a média);
  - autoria: o que o frontend grava como "admin" numa ação de outro usuário fica com o usuário logado; cabeçalho dos
    relatórios com o usuário logado e a versão;
  - OP impressa: versão no rodapé; MP0010 (da formulação, fora do roteiro) na máquina dos demais materiais com nota;
  - versão do servidor no menu e nenhum aviso de servidor desatualizado.

Uso: python teste_integridade_json.py <url_base>
"""
import sys, os, re, json, asyncio, time
import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0
ABERTA, ENCERRADA = 'OP20260812101715', 'OP20260812094138'
OP01, OP02, OP03, OP04, OPPA = ABERTA + '-01', ABERTA + '-02', ABERTA + '-03', ABERTA + '-04', ABERTA + '-PA'
OP01F, OP02F = ENCERRADA + '-01', ENCERRADA + '-02'


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {str(det)[:900]}'), flush=True)
    if not c: falhas.append(f'{nome}: {str(det)[:900]}')


def perto(a, b, tol=1e-9):
    try:
        return abs(float(a) - float(b)) <= tol * max(1.0, abs(float(b)))
    except Exception:
        return False


def num(v):
    try: return float(str(v).replace(',', '.'))
    except Exception: return 0.0


def solvente(i):
    return bool(re.search(r'solvent', ' '.join(str(i.get(k) or '') for k in ('Funcao', 'DescricaoMaterial')), re.I))


def regra_atual(itens, grupo, massa):
    """quantidades pela regra atual (V1.0.1): massa total = sólidos + solvente, teores pelas partes quando vazios"""
    gi = [i for i in itens if str(i.get('Grupo', '')).upper() == grupo]
    sol = [i for i in gi if not solvente(i) and str(i.get('Base', '')).lower() != 'massa total']
    sv = [i for i in gi if solvente(i)]
    ps, pv = sum(num(i['Percentual']) for i in sol) or 100, sum(num(i['Percentual']) for i in sv)
    sp = round(100 * ps / (ps + pv), 6) if ps + pv > 0 else 100
    vp = max(0, 100 - sp)
    ms, mv = massa * sp / 100, massa * vp / 100
    r = {i['CodigoMaterial']: ms * num(i['Percentual']) / ps for i in sol}
    r.update({i['CodigoMaterial']: mv * num(i['Percentual']) / (pv or 1) for i in sv})
    return r, sp, vp, ms, mv


async def main():
    s = requests.Session()
    r = s.post(BASE + '/api/auth/login', json={'username': 'admin', 'password': 'meslion2026'})
    ok(r.status_code == 200, 'login pela API', r.status_code)
    d0 = s.get(BASE + '/api/bootstrap', timeout=180).json()['data']
    app_js = s.get(BASE + '/js/app.js?v=1.0.21', timeout=60).text
    m = re.search(r'const V4043_BP_GENERIC_TEXTS=\{(.*?)\n\};', app_js, re.S)
    genericos = dict(re.findall(r"\n\s*([A-Za-z_]+):'([^']*)'", m.group(1))) if m else {}
    ok(len(genericos) == 5 and all(v.startswith('Texto de validação:') for v in genericos.values()), 'os 5 textos genéricos de validação do frontend (V40.4.3) lidos do app.js', list(genericos))

    # ---------------------------------------------------------------- dados no estado em que a versão anterior os deixava
    d = json.loads(json.dumps(d0))
    fm = [f for f in d['formulacoes'] if f['CodFormula'] == 'FM0003'][0]
    itens = [i for i in d['formulacao_itens'] if i['CodFormula'] == 'FM0003']
    _, spC, vpC, _, _ = regra_atual(itens, 'CATODO', 1)
    _, spA, vpA, _, _ = regra_atual(itens, 'ANODO', 1)
    fm.update({'TeorSolidosCatodo': str(spC), 'TeorSolventeCatodo': str(round(vpC, 6)), 'TeorSolidosAnodo': str(spA), 'TeorSolventeAnodo': str(round(vpA, 6))})
    d['bp'][0].update(genericos)
    for e in d['op_etapas']:
        if e['CodOP'] == OP03:   # coating de cátodo com a massa do slurry de ânodo (o frontend pegava o primeiro slurry da família)
            e.update({'MassaEntradaSlurry': '1.4848', 'MassaSolventeEvaporada': '0.507957890048', 'MassaSecaProjetada': '0.9768421099519999', 'RegraMassa': 'x'})
    d.setdefault('op_pi_consumos', []).append({'IdConsumoPI': 'CPI-TESTE-WIP-1', 'Origem': 'TESTE_WIP_V1019', 'CodOPConsumidora': OP03, 'QuantidadeConsumida': '0.25', 'UM': 'kg'})
    d.setdefault('apontamento_tempos', []).append({'IdApontamentoTempo': 'AT-TESTE-WIP-V1019', 'CodOP': ABERTA + '-07', 'Status': 'Iniciado', 'Operador': 'admin'})
    d['formulacoes'].append({'CodFormula': 'FORM-TESTE-LFP-01', 'Nome': 'TESTE — LFP', 'Usuario': 'sistema', 'Status': 'ATIVA'})
    d['formulacao_itens'].append({'CodFormula': 'FORM-TESTE-LFP-01', 'Grupo': 'CATODO', 'CodigoMaterial': 'MP0003', 'Percentual': '90', 'Base': 'Sólidos'})
    linhas_fechadas = sorted([(x['CodOP'], x['CodigoMaterial'], x.get('QtdPlanejada'), x.get('CustoTotal'), x.get('CustoUnitarioProjetadoCongelado')) for x in d['op_materiais'] if x['CodOP'] in (OP01F, OP02F)])
    legado01 = {x['CodigoMaterial']: num(x['QtdPlanejada']) for x in d['op_materiais'] if x['CodOP'] == OP01 and x.get('CodFormula')}
    r = s.put(BASE + '/api/storage/MES_LION_DATA', data=json.dumps(d, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'application/json; charset=utf-8'}, timeout=180)
    ok(r.status_code == 200 and abs(sum(legado01.values()) - 0.8956 * 1.5) < 1e-6,
       'dados com os efeitos da versão anterior enviados (textos genéricos, teores deduzidos, deposição trocada, registros de teste; OP -01 com a regra antiga: entradas = 150% da massa)', (r.status_code, legado01))

    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME) if CHROME else await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
        page = await ctx.new_page()
        erros = []
        page.on('pageerror', lambda e: erros.append(str(e)))
        page.on('dialog', lambda dd: asyncio.ensure_future(dd.accept()))
        ev = page.evaluate

        async def dados_servidor():
            ck = {c['name']: c['value'] for c in await ctx.cookies()}
            return requests.get(BASE + '/api/bootstrap', cookies=ck, timeout=180).json()['data']

        await page.goto(BASE + '/', wait_until='load')
        await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026'); await page.click('.login-card button')
        await page.wait_for_selector('#app:not(.hidden)', timeout=180000)
        await page.wait_for_timeout(3500)

        # ---------------------------------------------------------------- correções na entrada
        e1 = await ev("""() => { const m = data.meta || {}, bp = data.bp[0], f = data.formulacoes.find(x => x.CodFormula === 'FM0003');
            return { versao: window.MES_ADAPTADOR_INTEGRIDADE, textos: m.mes172TextosGenericosRemovidos || [], teores: m.mes172TeoresDeduzidosApagados || [], teste: m.mes172RegistrosDeTesteRemovidos || [],
              norm: m.mes172NormalizacaoFormula || [], bp: %s.map(k => bp[k] || ''), f: ['TeorSolidosCatodo', 'TeorSolventeCatodo', 'TeorSolidosAnodo', 'TeorSolventeAnodo'].map(k => f[k]),
              cpi: (data.op_pi_consumos || []).filter(x => /TESTE/.test(x.IdConsumoPI)).length, at: (data.apontamento_tempos || []).filter(x => /TESTE/.test(x.IdApontamentoTempo)).length,
              fteste: data.formulacoes.filter(x => /FORM-TESTE/.test(x.CodFormula)).length + data.formulacao_itens.filter(x => /FORM-TESTE/.test(x.CodFormula)).length }; }""" % json.dumps(list(genericos)))
        ok(e1['versao'] == '1.7.2', 'adaptador de integridade 1.7.2 carregado', e1['versao'])
        ok(e1['bp'] == ['', '', '', '', ''] and len(e1['textos']) == 5 and all(t['BatteryPassportID'] == 'BP0001' for t in e1['textos']),
           'passaporte: os 5 textos genéricos de validação apagados na entrada, com registro', (e1['bp'], e1['textos']))
        ok(e1['f'] == ['', '', '', ''] and sorted(t['Grupo'] for t in e1['teores']) == ['ANODO', 'CATODO'],
           'formulação FM0003: teores deduzidos pelas partes apagados do cadastro (o usuário não os informou), com registro', (e1['f'], e1['teores']))
        ok(e1['cpi'] == 0 and e1['at'] == 0 and e1['fteste'] == 0 and len(e1['teste']) == 4,
           'registros de teste do frontend (CPI-TESTE-WIP, AT-TESTE-WIP-V1019, FORM-TESTE-LFP-01 e item) removidos, com registro', e1['teste'])
        cods_norm = sorted(x['CodOP'] for x in e1['norm'])
        ok(cods_norm == sorted([OP01, OP02]) and all(sorted(x['Antes']) and x['Depois'] for x in e1['norm']),
           'OPs abertas de slurry (-01 e -02) recalculadas uma vez pela regra atual, com antes/depois registrados; encerradas fora', cods_norm)

        e2 = await ev("""() => { const q = cod => Object.fromEntries(data.op_materiais.filter(x => x.CodOP === cod && x.CodFormula).map(x => [x.CodigoMaterial, x.QtdPlanejada]));
            const op = cod => data.op.find(o => o.CodOP === cod);
            const dep = cod => data.op_etapas.filter(e => e.CodOP === cod).map(e => [e.MassaEntradaSlurry || '', e.MassaSolventeEvaporada || '', e.MassaSecaProjetada || '']);
            return { q01: q('%s'), q02: q('%s'), o01: op('%s'), o02: op('%s'), dep03: dep('%s'), dep04: dep('%s'),
              fechadas: data.op_materiais.filter(x => ['%s', '%s'].includes(x.CodOP)).map(x => [x.CodOP, x.CodigoMaterial, x.QtdPlanejada, x.CustoTotal, x.CustoUnitarioProjetadoCongelado]).sort() }; }"""
                       % (OP01, OP02, OP01, OP02, OP03, OP04, OP01F, OP02F))
        esp01, _, _, ms01, mv01 = regra_atual(itens, 'CATODO', 0.8956)
        esp02, _, _, ms02, mv02 = regra_atual(itens, 'ANODO', 1.4848)
        ok(sorted(e2['q01']) == sorted(esp01) and all(perto(e2['q01'][k], esp01[k]) for k in esp01) and perto(sum(num(v) for v in e2['q01'].values()), 0.8956),
           'OP -01: materiais da formulação pela regra atual (sólidos 66,67% / NMP 33,33% da massa total) e a soma = 0,8956 kg da OP', (e2['q01'], esp01))
        ok(sorted(e2['q02']) == sorted(esp02) and 'MP0010' in e2['q02'] and all(perto(e2['q02'][k], esp02[k]) for k in esp02) and perto(sum(num(v) for v in e2['q02'].values()), 1.4848),
           'OP -02: inclui o MP0010 da formulação (1,5% dos sólidos) e a soma = 1,4848 kg da OP', (e2['q02'], esp02))
        ok(sorted(map(tuple, e2['fechadas'])) == sorted(linhas_fechadas), 'OPs encerradas (família 094138): materiais, quantidades e custos intocados', '')
        ok(all(x == ['0.8956', e2['o01']['MassaSolvente'], e2['o01']['MassaSolidos']] for x in e2['dep03']) and perto(e2['o01']['MassaSolidos'], ms01)
           and all(x == ['1.4848', e2['o02']['MassaSolvente'], e2['o02']['MassaSolidos']] for x in e2['dep04']) and perto(e2['o02']['MassaSolidos'], ms02),
           'massa de deposição: coating de cátodo (-03) com o slurry de cátodo (0,8956 kg; seca 0,5971) e o de ânodo (-04) com o de ânodo', (e2['dep03'][:1], e2['dep04'][:1]))
        srv = await dados_servidor()
        ok(srv['bp'][0].get('Sust_DueDiligence_Texto', '') == '' and [f for f in srv['formulacoes'] if f['CodFormula'] == 'FM0003'][0].get('TeorSolidosCatodo') == ''
           and len((srv.get('meta') or {}).get('mes172NormalizacaoFormula') or []) == 2 and not any('TESTE' in str(x.get('IdConsumoPI')) for x in srv.get('op_pi_consumos') or []),
           'as correções da entrada foram gravadas no servidor', '')
        tela = await ev("({ v: (document.getElementById('mes172-versao') || {}).textContent || '', aviso: !!document.getElementById('mes172-aviso-servidor') })")
        ok('Servidor JSON 1.7.2' in tela['v'] and not tela['aviso'], 'versão do servidor no menu e nenhum aviso de servidor desatualizado', tela)

        # ---------------------------------------------------------------- ver, imprimir e exportar não mudam nada
        foto_js = "JSON.stringify(Object.keys(data).filter(k => k !== 'meta').sort().map(k => [k, data[k]]))"
        # primeira passada: as telas criam o que é delas (cache do MRP, indicadores dos painéis, cartões do PCP...)
        await ev("""async () => { for (const m of modules.map(x => x[0])) { try { render(m); } catch (e) { } await new Promise(r => setTimeout(r, 120)); } render('dashboard'); saveLocal(); }""")
        await page.wait_for_timeout(3500)
        antes, srv_antes = await ev(foto_js), await dados_servidor()
        await ev("""async () => {
            for (const m of modules.map(x => x[0])) { try { render(m); } catch (e) { } await new Promise(r => setTimeout(r, 100)); }
            render('op'); await new Promise(r => setTimeout(r, 300));
            for (const o of data.op) { const s = document.getElementById('selOp'); s.value = o.CodOP; showOP(); await new Promise(r => setTimeout(r, 80)); }
            render('roteiro'); await new Promise(r => setTimeout(r, 300));
            for (const r of data.roteiro) { const s = document.getElementById('selRot'); if (s) { s.value = r.CodRoteiro; showRoteiro(); } await new Promise(r => setTimeout(r, 80)); }
            render('bp'); await new Promise(r => setTimeout(r, 300)); try { openBPForm(0); } catch (e) { }
        }""")
        for nome, js in [('PDF OP Produção', "render('op'); document.getElementById('selOp').value = '%s'; showOP(); reportOP()" % OP01),
                         ('Picking List PDF', 'reportPicking()'), ('Custos da OP', "typeof reportCustosOP === 'function' && reportCustosOP()")]:
            async with page.expect_popup() as pinfo:
                await ev(js)
            pop = await pinfo.value
            await pop.close()
        await ev("render('op_materiais'); exportSelectedExcel('op_materiais', 'OP - Materiais')")
        await page.wait_for_timeout(2500)
        depois, srv_depois = await ev(foto_js), await dados_servidor()
        dif = [k for k, v in json.loads(antes) if dict(json.loads(depois)).get(k) != v]
        dif_srv = [k for k in set(srv_antes) | set(srv_depois) if k != 'meta' and srv_antes.get(k) != srv_depois.get(k)]
        ok(not dif and not dif_srv, 'ver telas, OPs, roteiros e passaporte, PDF OP Produção, Picking List, Custos da OP e Exportar Excel: nada mudou nos dados (memória e servidor)', (dif, dif_srv))

        # ---------------------------------------------------------------- fórmula congelada
        f1 = await ev("""() => { const it = data.formulacao_itens.find(i => i.CodFormula === 'FM0003' && i.CodigoMaterial === 'MP0001'); it.Percentual = '60';
            render('op'); const s = document.getElementById('selOp'); s.value = '%s'; showOP();
            return Object.fromEntries(data.op_materiais.filter(x => x.CodOP === '%s' && x.CodFormula).map(x => [x.CodigoMaterial, x.QtdPlanejada])); }""" % (OP01, OP01))
        ok(f1 == e2['q01'], 'mudar o cadastro da formulação (NMP 50 → 60) não muda a OP já gerada ao abrir', (f1, e2['q01']))
        f2 = await ev("""() => { render('op'); document.getElementById('selOp').value = '%s'; showOP();
            /* a tela atual não mostra mais o cartão do V40.5.0; a função continua sendo a ação explícita de recálculo */
            const i = document.createElement('input'); i.id = 'v4050_op_qty'; i.value = '1.2'; document.body.appendChild(i); v4050UpdateOPQty('%s'); i.remove();
            const f = data.formulacoes.find(x => x.CodFormula === 'FM0003');
            return { q: Object.fromEntries(data.op_materiais.filter(x => x.CodOP === '%s' && x.CodFormula).map(x => [x.CodigoMaterial, x.QtdPlanejada])), teor: f.TeorSolidosCatodo, op: data.op.find(o => o.CodOP === '%s').QtdPlanejada }; }"""
                       % (OP01, OP01, OP01, OP01))
        esp12, _, _, _, _ = regra_atual(itens, 'CATODO', 1.2)
        ok(f2 and f2['op'] == '1.2' and all(perto(f2['q'][k], esp12[k]) for k in esp12) and perto(f2['q']['MP0001'], 0.4, 1e-6) and not perto(f2['q']['MP0001'], 0.45, 1e-3) and f2['teor'] == '',
           '"Atualizar quantidade e recalcular" (1,2 kg) usa o retrato da OP (NMP 50 partes → 0,4 kg; com o cadastro novo seriam 0,45) e não grava teor no cadastro', f2)
        f3 = await ev("""() => { const antes = JSON.stringify(data.op_materiais.filter(x => x.CodOP === '%s'));
            mesIntegridade172.explicito(() => v4050RecalculateFormulaOP('%s', false));
            const it = data.formulacao_itens.find(i => i.CodFormula === 'FM0003' && i.CodigoMaterial === 'MP0001'); it.Percentual = '50';
            const i = document.createElement('input'); i.id = 'v4050_op_qty'; i.value = '0.8956'; document.body.appendChild(i); render('op'); document.getElementById('selOp').value = '%s'; v4050UpdateOPQty('%s'); i.remove();
            return antes === JSON.stringify(data.op_materiais.filter(x => x.CodOP === '%s')); }""" % (OP01F, OP01F, OP01, OP01, OP01F))
        ok(f3, 'OP encerrada nunca é recalculada (nem chamando o recálculo explicitamente)', f3)

        # ---------------------------------------------------------------- custo projetado de OP encerrada congelado
        c1 = await ev("""() => { const pega = cod => { const o = data.op.find(x => x.CodOP === cod), l = data.op_materiais.find(x => x.CodOP === cod && x.CodigoMaterial === 'MP0003');
                return [o.CustoMateriaisProjetado, o.DataAtualizacaoCustos, l.CustoUnitarioProjetadoCongelado, l.CustoProjetado]; };
            const f0 = pega('%s'), a0 = pega('%s');
            data.entradas.push({ Entrada: 'EN-T172', 'CódigoMaterial': 'MP0003', DescricaoMaterial: 'Material Ativo LFP', QtdAdquirida: '1', UnidadeMedida: 'kg', 'Custo R$': '9999', 'ValorUnitario (R$/UM)': '9999', Lote: 'T172' });
            recalcularCustosOPV3814('%s'); recalcularCustosOPV3814('%s');
            const f1 = pega('%s'), a1 = pega('%s');
            data.entradas = data.entradas.filter(e => e.Entrada !== 'EN-T172'); recalcularCustosOPV3814('%s');
            return { f0, f1, a0, a1, a2: pega('%s') }; }""" % (OP01F, OP01, OP01F, OP01, OP01F, OP01, OP01, OP01))
        ok(c1['f1'] == c1['f0'], 'OP encerrada: custo projetado, custo congelado do material e data dos custos iguais depois de uma entrada nova do MP0003', c1)
        ok(c1['a1'][2] != c1['a0'][2] and c1['a2'][2] == c1['a0'][2], 'OP aberta: custo projetado acompanha a média do material (e volta quando a entrada sai)', (c1['a0'], c1['a1'], c1['a2']))

        # ---------------------------------------------------------------- autoria
        a1 = await ev("""() => { const u0 = MES_CURRENT_USER.username; MES_CURRENT_USER.username = 'maria.teste';
            data.projetos.push({ CodProjeto: 'PRJ-T172', 'Nome Projeto': 'Teste 1.7.2', UsuarioCriacao: 'admin' });
            const o = data.op.find(x => x.CodOP === '%s'); o.UsuarioReabertura = 'admin';
            const fm = data.formulacoes.find(x => x.CodFormula === 'FM0003'), antes = fm.Usuario;
            saveLocal();
            const r = { proj: data.projetos.find(p => p.CodProjeto === 'PRJ-T172').UsuarioCriacao, reab: o.UsuarioReabertura, formula: fm.Usuario, formulaAntes: antes };
            data.projetos = data.projetos.filter(p => p.CodProjeto !== 'PRJ-T172'); delete o.UsuarioReabertura; saveLocal();
            MES_CURRENT_USER.username = u0; return r; }""" % OP03)
        ok(a1['proj'] == 'maria.teste' and a1['reab'] == 'maria.teste' and a1['formula'] == a1['formulaAntes'],
           'autoria: projeto criado e OP reaberta por outro usuário ficam com ele (o frontend gravava "admin"); o "admin" que já estava gravado não muda', a1)
        async with page.expect_popup() as pinfo:
            await ev("(() => { const u0 = MES_CURRENT_USER.username; MES_CURRENT_USER.username = 'maria.teste'; try { reportShell('Teste 1.7.2', '<p>x</p>'); } finally { MES_CURRENT_USER.username = u0; } })()")
        pop = await pinfo.value
        await pop.wait_for_load_state('load')
        meta = await pop.evaluate("(document.querySelector('.meta') || {}).textContent || ''")
        await pop.close()
        ok('Usuário: maria.teste' in meta and 'MES LION JSON 1.7.2' in meta, 'cabeçalho dos relatórios com o usuário logado e a versão (antes, sempre "Usuário: admin")', meta)

        # ---------------------------------------------------------------- OP impressa
        ler = """(cod) => { const doc = new DOMParser().parseFromString(opProductionPage(data.op.find(o => o.CodOP === cod), true), 'text/html');
            const secs = [...doc.querySelectorAll('section.op-stage')].filter(s => s.querySelector('.op-summary-v395'));
            return { maq: secs.map(s => [s.querySelector('.op-summary-v395 span').textContent.trim(), [...s.querySelectorAll('tbody tr')].map(tr => tr.cells[0]).filter(td => td && !td.hasAttribute('colspan')).map(td => td.firstChild.textContent.trim()).sort(), (s.querySelector('.mes-op-nota') || {}).textContent || '']),
              sem: !!doc.querySelector('.mes-op-sem-maquina'), rodape: (doc.querySelector('.mes-op-versao') || {}).textContent || '' }; }"""
        p02, ppa = await ev(ler, OP02), await ev(ler, OPPA)
        ok(p02['maq'][0][0] == 'Misturador' and p02['maq'][0][1] == ['MP0002', 'MP0005', 'MP0008', 'MP0010', 'MP0011'] and 'MP0010 vem da formulação FM0003' in p02['maq'][0][2]
           and all(not x[1] for x in p02['maq'][1:]) and not p02['sem'],
           'OP -02 impressa: MP0010 (da formulação, fora do roteiro) no Misturador com os demais materiais e a nota; Filtro e Estufa sem materiais', p02)
        ok('MES LION JSON 1.7.2' in ppa['rodape'] and ppa['maq'][0][1] == ['MP0016', 'MP0017', 'MP0018'] and all(not x[1] for x in ppa['maq'][1:]),
           'OP de PA impressa com a versão no rodapé e os materiais só na Injetora', ppa)
        ok(not erros, 'nenhum erro JavaScript', erros[:5])
        await b.close()

    print(f'\n== {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print('FALHAS:', falhas)
        sys.exit(1)


asyncio.run(main())
