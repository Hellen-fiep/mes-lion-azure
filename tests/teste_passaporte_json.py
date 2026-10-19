#!/usr/bin/env python3
"""
Teste no navegador do Passaporte da Bateria e da biblioteca de fatores ambientais da versão JSON
(correções do server/adaptador_passaporte.js):
  - biblioteca de fatores GWP100 (ecoinvent cut-off) recriada e gravada no servidor (ACV > Fatores e Biblioteca de
    Dados Ambientais); banco LCI sem linhas repetidas e sem voltar a repetir a cada cálculo; a versão ativa da
    biblioteca vale nos cálculos;
  - template da biblioteca (.xlsx) com linhas de EXEMPLO válidas e uma linha por material; importação de .xlsx salvo
    pelo Excel (compactado, textos compartilhados), de CSV (; e aspas) e avisos claros (exemplos, erros, .xls binário);
  - formulário do passaporte sem os blocos regulatórios repetidos e sem campo obrigatório; cada dado com a marca
    "painel"; ao escolher a OP, puxa a estrutura da célula (modelo, formato, química, capacidade, tensão, energia,
    dimensões), a pegada de carbono (ACV da família de OPs ou AICV da OP) e a composição mássica;
  - composição mássica publicada só com as massas úteis (solventes fora; cada material com sua marca);
  - rascunho salvo com informações incompletas e com OP ainda aberta; status VALIDADO com OP aberta pede confirmação;
  - painel do cliente (inclusive a página publicada para o QR) respeita as marcas; dados alterados à mão são mantidos;
  - passaporte antigo continua abrindo e mantém os dados ao ser salvo; PDF interno e tela do passaporte.

Uso: python teste_passaporte_json.py <url_base>
"""
import sys, os, re, json, asyncio, time, zipfile, tempfile
import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
DADOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dados_teste', 'MES_LION_DATA_TESTE.json')
falhas, total = [], 0

OP_FECHADA = 'OP20260812094138-PA'   # OP de PA concluída (2 células produzidas)
OP_ABERTA = 'OP20260812101715-PA'    # OP de PA planejada
# tabela GWP100 (print do usuário): código no MES -> (trecho do dataset, fator com 2 casas)
TABELA = {'MP0016': ('Electrolyte, for Li-ion battery', 3.68), 'MP0015': ('Battery separator', 35.81), 'MP0013': ('Aluminium collector foil', 15.51),
          'MP0009': ('Polyvinylfluoride', 15.68), 'MP0007': ('Carbon black', 2.42), 'MP0005': ('Synthetic graphite', 47.68),
          'MP0014': ('Copper collector foil', 8.98), 'PROC_AL': ('Aluminium, wrought alloy', 13.24), 'PROC_CU': ('Copper, anode', 6.00),
          'ENERGIA_BR': ('BR-Southern grid', 0.15), 'ENERGIA_CN': ('Electricity, medium voltage {CN}', 0.92), 'PROC_EXT': ('Extrusion, plastic film', 0.53),
          'MP0011': ('Latex', 2.76), 'PROC_PP': ('Polypropylene, granulate', 3.05), 'PROC_ROLL': ('Sheet rolling, aluminium', 0.63)}


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {det}'), flush=True)
    if not c: falhas.append(f'{nome}: {str(det)[:400]}')


def br(s):
    """número em formato brasileiro no começo do texto ('1.530,5 kg CO₂eq/kWh' -> 1530.5)"""
    m = re.search(r'-?\d[\d.]*(,\d+)?', str(s or ''))
    return float(m.group(0).replace('.', '').replace(',', '.')) if m else None


def perto(a, b, rel=2e-3):
    return a is not None and b is not None and abs(a - b) <= rel * max(abs(b), 1e-9)


def xlsx_como_excel(abas, caminho):
    """planilha no formato que o Excel grava: compactada (deflate), textos em sharedStrings, números como número"""
    textos, indice = [], {}
    esc = lambda t: str(t).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    def col(i):
        s = ''
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s
    def folha(linhas):
        rows = []
        for r, linha in enumerate(linhas, 1):
            cs = []
            for c, v in enumerate(linha):
                if v is None or v == '': continue
                if isinstance(v, (int, float)): cs.append(f'<c r="{col(c)}{r}"><v>{v}</v></c>')
                else:
                    if v not in indice: indice[v] = len(textos); textos.append(v)
                    cs.append(f'<c r="{col(c)}{r}" t="s"><v>{indice[v]}</v></c>')
            rows.append(f'<row r="{r}">{"".join(cs)}</row>')
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f'<sheetData>{"".join(rows)}</sheetData></worksheet>')
    xmls = [folha(l) for _, l in abas]
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    with zipfile.ZipFile(caminho, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
                   + ''.join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(len(abas)))
                   + '</Types>')
        z.writestr('_rels/.rels', f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml', f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="{rel}"><sheets>'
                   + ''.join(f'<sheet name="{esc(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, (n, _) in enumerate(abas)) + '</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + ''.join(f'<Relationship Id="rId{i + 1}" Type="{rel}/worksheet" Target="/xl/worksheets/sheet{i + 1}.xml"/>' for i in range(len(abas)))
                   + f'<Relationship Id="rId{len(abas) + 1}" Type="{rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
        for i, x in enumerate(xmls): z.writestr(f'xl/worksheets/sheet{i + 1}.xml', x)
        z.writestr('xl/sharedStrings.xml', f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(textos)}" uniqueCount="{len(textos)}">'
                   + ''.join(f'<si><t>{esc(t)}</t></si>' for t in textos) + '</sst>')


def massas_esperadas():
    d = json.load(open(DADOS, encoding='utf-8'))
    d = d.get('data', d)
    s = next(r for r in d['sust_op'] if (r.get('CodOPMae') or r.get('CodOP')) == OP_FECHADA)
    por = {}
    for x in json.loads(s['AuditoriaCO2JSON']):
        cod = str(x.get('CodigoMaterial') or '')
        if str(x.get('Tipo', '')).upper() != 'CONSUMO' or not cod or cod == 'ENERGIA' or cod.upper().startswith('PI'): continue
        por[cod] = por.get(cod, 0) + float(x.get('MassaKg') or 0)
    return por


async def main():
    por_material = massas_esperadas()
    util_lote = sum(v for k, v in por_material.items() if k not in ('MP0001', 'MP0002'))
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
        page = await ctx.new_page()
        erros, dialogos = [], []
        resposta = {'confirm': True}
        page.on('pageerror', lambda e: erros.append(str(e)))

        def dialogo(d):
            dialogos.append(d.message)
            asyncio.ensure_future(d.dismiss() if d.type == 'confirm' and not resposta['confirm'] else d.accept())
        page.on('dialog', dialogo)
        ev = page.evaluate

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

        async def entrar():
            await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
            await page.wait_for_timeout(1500)

        async def escolher_op(cod):
            await page.select_option('#bp_op', cod)
            await page.wait_for_timeout(1200)

        async def campo(k):
            return await ev(f"(document.getElementById('bpu_{k}') || {{}}).value")

        async def preencher(k, valor):
            await ev("([k, v]) => { const e = document.getElementById('bpu_' + k); e.closest('details').open = true; e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }", [k, valor])

        async def marcar(k, ligado):
            await ev("([k, v]) => { const c = document.getElementById('bpp_' + k); c.closest('details') && (c.closest('details').open = true); if (c.checked !== v) c.click(); }", [k, ligado])

        await page.goto(BASE + '/', wait_until='load')
        await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026')
        await page.click('.login-card button')
        await entrar()

        # ---------------------------------------------------------------- 1) biblioteca de fatores e banco LCI
        d, sim = await esperar_servidor(lambda d: (d.get('meta') or {}).get('bibliotecaFatoresGWP100') and len(d.get('acv_fatores') or []) >= 19)
        fat = {f.get('CodigoMaterial'): f for f in d.get('acv_fatores') or [] if f.get('Categoria') == 'Mudanças climáticas'}
        ruins = [k for k, (ds, v) in TABELA.items() if k not in fat or ds not in str(fat[k].get('Dataset', '')) or round(float(fat[k]['Fator']), 2) != v]
        ok(sim and not ruins, f'biblioteca GWP100 gravada no servidor ({len(d.get("acv_fatores") or [])} fatores; os 15 da tabela com dataset e fator)', ruins)
        ok(all(k in fat for k in ('MP0001', 'MP0002', 'MP0003', 'MP0006')) and all(f.get('Metodo') == 'IPCC 100a v1.3 / GWP100' for f in fat.values()),
           'fatores que já estavam na biblioteca (NMP, água, LFP, grafite natural) restaurados, método IPCC GWP100', sorted(fat))
        lci = d.get('sust_lci') or []
        unicos = {json.dumps(r, sort_keys=True, ensure_ascii=False) for r in lci}
        lib = [r for r in lci if r.get('ImportBatch') == 'BIBLIOTECA-GWP100-MES']
        ok(len(unicos) == len(lci) and len(lib) == 12 and all(r.get('LibraryActive') == 'Sim' for r in lib),
           f'banco LCI sem linhas repetidas ({len(lci)} linhas) e com a versão da biblioteca ativa (12 materiais)', (len(unicos), len(lci), len(lib)))
        n1 = await ev("data.sust_lci.length")
        await ev(f"(() => {{ for (let i = 0; i < 5; i++) lciActiveFactorV37('MP0003', 'Mudanças climáticas'); calcSustFamiliaOPV33('{OP_FECHADA}', false, {{}}); calcSustFamiliaOPV33('{OP_FECHADA}', false, {{}}); }})()")
        n2 = await ev("data.sust_lci.length")
        ok(n1 == n2, 'cálculos repetidos não criam linhas novas no banco LCI', (n1, n2))
        fs = await ev("[lciActiveFactorV37('MP0003', 'Mudanças climáticas'), lciActiveFactorV37('MP0014', 'Mudanças climáticas'), lciActiveFactorV37('MP0005', 'Mudanças climáticas')]")
        ok(fs == [5.336, 8.983, 47.681], 'a versão ativa da biblioteca vale nos cálculos (LFP, coletor de cobre, grafite sintético)', fs)
        await ev("render('acv')"); await page.wait_for_timeout(500)
        await ev("acvFactorsV110()"); await page.wait_for_timeout(300)
        linhas = await ev("[...document.querySelectorAll('.mes-biblioteca-fatores tbody tr')].map(t => t.textContent)")
        ok(len(linhas) == 19 and any('Polypropylene, granulate' in t and '3,05' in t for t in linhas), 'ACV > Fatores lista a biblioteca (19 fatores, com o polipropileno)', len(linhas))
        await ev("acvBibliotecaAmbientalV233()"); await page.wait_for_timeout(300)
        tela = await page.inner_text('#v110body')
        ok('v1' in tela and 'ATIVA' in tela and 'BIBLIOTECA-GWP100-MES' in tela, 'Biblioteca de Dados Ambientais mostra a versão v1 ativa', tela[:300])

        # ---------------------------------------------------------------- 2) formulário: campos únicos, sem obrigatório, marcas
        await ev("render('bp')"); await page.wait_for_timeout(600)
        await ev("openBPForm(-1)"); await page.wait_for_timeout(700)
        est = await ev("""() => ({antigos: document.querySelectorAll('#crudBox .bp-eu-reg, #bp_regulatory_fields, #eu_a9, #BP_DP10_Weight, #BP_DP11_Capacity').length,
            obrig: document.querySelectorAll('#crudBox [required]').length, campos: document.querySelectorAll('#bp_unificado .bpu-campo').length,
            semMarca: [...document.querySelectorAll('#bp_unificado .bpu-campo')].filter(c => !c.querySelector('input[type=checkbox][data-flag]')).length,
            base: ['bp_lote', 'bp_op', 'bp_guid', 'bp_fornecedor_nome', 'bp_cliente_nome'].filter(id => document.getElementById(id).closest('.bpu-base')?.querySelector('input[data-flag]')).length,
            abertas: [...document.querySelectorAll('#bp_op optgroup')].map(g => g.label + ':' + g.children.length)})""")
        ok(est['antigos'] == 0 and est['obrig'] == 0, 'formulário sem os blocos repetidos (UE e Guidance) e sem campo obrigatório', est)
        ok(est['campos'] >= 60 and est['semMarca'] == 0 and est['base'] == 5, f'{est["campos"]} dados do passaporte, cada um com a marca "painel" (também lote, OP, GUID, fabricante e cliente)', est)
        ok(any(g.startswith('OPs em andamento') for g in est['abertas']), 'OPs de PA em andamento disponíveis para rascunho', est['abertas'])
        marcas = await ev("Object.fromEntries([...document.querySelectorAll('#crudBox input[data-flag]')].map(c => [c.dataset.flag, c.checked]))")
        restritos = ['BP_DP45_DetailedComposition', 'BP_DP46_ComponentPartNumbers', 'BP_DP47_SparePartsSources', 'BP_DP48_DismantlingInformation', 'BP_DP49_SafetyMeasures', 'BP_DP50_TestReports', 'ClienteNomeSnapshot']
        ok(all(marcas.get(k) is False for k in restritos) and marcas.get('BP_DP11_Capacity') and marcas.get('EU_C1_PegadaCarbono'),
           'dados de acesso restrito (DP45–50) e cliente fora do painel por padrão; os demais marcados', {k: marcas.get(k) for k in restritos})

        # ---------------------------------------------------------------- 3) OP encerrada: dados puxados sozinhos
        await escolher_op(OP_FECHADA)
        vals = {k: await campo(k) for k in ('EU_A3_Modelo', 'BP_FormatoCelula', 'BP_DP12_Chemistry', 'BP_DP11_Capacity', 'BP_DP27_NominalVoltage', 'BP_EnergiaWh',
                                             'BP_Dimensoes', 'BP_DP09_ManufacturingDate', 'BP_DP10_Weight', 'BP_CO2_PorCelula', 'EU_C1_PegadaCarbono', 'BP_CO2_PorKg', 'BP_ACV_Fonte', 'BP_DP45_DetailedComposition')}
        esperado = {'EU_A3_Modelo': 'Ametista', 'BP_FormatoCelula': 'Prismática', 'BP_DP12_Chemistry': 'LFP', 'BP_DP11_Capacity': '100', 'BP_DP27_NominalVoltage': '3,6',
                    'BP_EnergiaWh': '336,89', 'BP_Dimensoes': '100x80', 'BP_DP09_ManufacturingDate': '08/2026'}
        dif = {k: (vals[k], v) for k, v in esperado.items() if vals[k] != v}
        ok(not dif, 'estrutura da célula puxada da OP: modelo, formato, química, capacidade, tensão, energia, dimensões e data', dif)
        lote = await ev("[document.getElementById('bp_lote').value, document.getElementById('bp_prod').value]")
        ok(lote == [OP_FECHADA, 'PA0001'], 'produto e lote preenchidos pela OP', lote)
        cel = await ev(f"(() => {{ const s = document.querySelector('#bpu_massas tfoot tr td:nth-child(4)'); return [...document.querySelectorAll('#bpu_massas tbody tr')].map(t => [t.querySelector('input').dataset.cod, t.querySelector('input').checked]); }})()")
        fora = sorted(c for c, m in cel if not m)
        ok(fora == ['MP0001', 'MP0002'] and len(cel) == len(por_material), 'massas: solventes (NMP e água) fora da composição publicada; os demais materiais marcados', cel)
        ok(perto(br(vals['BP_DP10_Weight']), util_lote / 2, 1e-3), f'peso da célula = massa útil por célula ({util_lote / 2:.4f} kg, sem os solventes)', vals['BP_DP10_Weight'])
        familia = await ev(f"Number(calcSustFamiliaOPV33('{OP_FECHADA}', false, {{}}).CO2eqTotal)")
        ok(perto(br(vals['BP_CO2_PorCelula']), familia / 2) and perto(br(vals['EU_C1_PegadaCarbono']), familia / 2 / 0.3368888721072, 3e-3)
           and perto(br(vals['BP_CO2_PorKg']), familia / 2 / (util_lote / 2), 3e-3) and 'família de OPs' in vals['BP_ACV_Fonte'],
           f'pegada de carbono puxada da ACV da família de OPs ({familia / 2:.1f} kg CO₂eq por célula, por kWh e por kg)', vals)
        ok('Solvente' not in vals['BP_DP45_DetailedComposition'] and 'Cátodo:' in vals['BP_DP45_DetailedComposition'], 'composição detalhada montada com as massas úteis', vals['BP_DP45_DetailedComposition'])
        await page.uncheck('#bpu_massas input.bpu-massa[data-cod="MP0018"]'); await page.wait_for_timeout(700)
        peso2, comp2 = await campo('BP_DP10_Weight'), await campo('BP_DP45_DetailedComposition')
        ok(perto(br(peso2), (util_lote - por_material['MP0018']) / 2, 1e-3) and 'Case' not in comp2, 'material desmarcado sai do peso e da composição publicada', (peso2, comp2))
        await preencher('BP_DP04_ManufacturerAddress', 'Rua do Teste, 123 — Curitiba/PR')
        await marcar('BP_DP04_ManufacturerAddress', False)
        await preencher('BP_DP48_DismantlingInformation', 'Desmontar com ferramenta isolada')
        await preencher('BP_DP31_ExpectedLifeCycles', '3000')
        await marcar('BP_DP45_DetailedComposition', True)
        await page.select_option('#bp_fornecedor', index=1); await page.wait_for_timeout(200)
        await ev("document.getElementById('bp_fornecedor').dispatchEvent(new Event('change'))"); await page.wait_for_timeout(400)
        resp = await campo('BP_DP02_Responsible')
        fab = await ev("document.getElementById('bp_fornecedor_nome').value")
        ok(resp and resp == fab, 'responsável pelo passaporte puxado do fabricante do cadastro', (resp, fab))
        await page.select_option('#bp_status', 'VALIDADO')
        dialogos.clear()
        await ev("saveBP(-1)"); await page.wait_for_timeout(1200)
        ok(dialogos == ['Passaporte da bateria salvo com sucesso.'], 'VALIDADO com OP encerrada salva direto', dialogos)
        d, sim = await esperar_servidor(lambda d: any(x.get('CodOrdemProducao') == OP_FECHADA and x.get('CamposUnificados') == 'Sim' for x in d.get('bp') or []))
        val = next((x for x in d.get('bp') or [] if x.get('CodOrdemProducao') == OP_FECHADA and x.get('CamposUnificados') == 'Sim'), {})
        ocultos, exc = set(str(val.get('CamposOcultos', '')).split(';')), set(str(val.get('MassasExcluidas', '')).split(';'))
        ok(sim and 'BP_DP04_ManufacturerAddress' in ocultos and 'BP_DP45_DetailedComposition' not in ocultos and exc == {'MP0001', 'MP0002', 'MP0018'}
           and val.get('BP_DP31_ExpectedLifeCycles') == '3000' and val.get('BP_DP11_Capacity') == '100',
           'passaporte gravado no servidor com os dados, as marcas do painel e os materiais fora da composição', {k: val.get(k) for k in ('CamposOcultos', 'MassasExcluidas', 'BP_DP31_ExpectedLifeCycles')})
        id_val = val.get('BatteryPassportID')

        # ---------------------------------------------------------------- 4) painel do cliente e página publicada (QR)
        html = await ev(f"standaloneDashboardHTML(data.bp.find(b => b.BatteryPassportID === '{id_val}'))")
        pizza = re.search(r'bpu-pizza-c[^>]*><span>([^<]+)<', html)
        ok('Composição mássica da célula' in html and pizza and perto(br(pizza.group(1)), (util_lote - por_material['MP0018']) / 2, 1e-3)
           and 'Solvente NMP' not in html and 'Solvente água' not in html and 'MP0018' not in html,
           'painel do cliente: composição mássica só com as massas úteis (sem solventes e sem o material desmarcado)', pizza.group(1) if pizza else None)
        ok('100 Ah' in html and '3,6 V' in html and 'Ametista' in html and 'Pegada de carbono' in html and vals['BP_CO2_PorCelula'] in html,
           'painel do cliente: capacidade, tensão, modelo e pegada de carbono', '')
        ok('Rua do Teste, 123' not in html and 'ferramenta isolada' not in html and 'Cátodo:' in html and '3000' in html,
           'painel do cliente respeita as marcas (endereço e desmontagem fora; composição detalhada e vida útil dentro)', '')
        pub = await ev(f"v4044PublishDashboard(data.bp.find(b => b.BatteryPassportID === '{id_val}'), null, true).then(r => [r.url, r.html])")
        ok(pub and pub[0].endswith(id_val + '.html') and 'Composição mássica da célula' in pub[1] and 'Solvente NMP' not in pub[1] and 'Rua do Teste, 123' not in pub[1],
           'HTML publicado para o QR é o mesmo painel do cliente', pub[0] if pub else None)

        # ---------------------------------------------------------------- 5) rascunho com OP aberta e informações incompletas
        n_bp = await ev("data.bp.length")
        await ev("openBPForm(-1)"); await page.wait_for_timeout(600)
        await escolher_op(OP_ABERTA)
        dialogos.clear()
        await ev("saveBP(-1)"); await page.wait_for_timeout(1200)
        ok(dialogos == ['Passaporte da bateria salvo como rascunho.'], 'RASCUNHO salvo com OP em andamento e dados incompletos (sem bloqueio)', dialogos)
        d, sim = await esperar_servidor(lambda d: any(x.get('CodOrdemProducao') == OP_ABERTA and x.get('StatusPassaporte') == 'RASCUNHO' for x in d.get('bp') or []))
        ok(sim, 'rascunho gravado no servidor', '')
        await ev("openBPForm(-1)"); await page.wait_for_timeout(600)
        await escolher_op(OP_ABERTA)
        await page.select_option('#bp_status', 'VALIDADO')
        resposta['confirm'] = False
        dialogos.clear()
        await ev("saveBP(-1)"); await page.wait_for_timeout(800)
        resposta['confirm'] = True
        n_depois = await ev("data.bp.length")
        ok(len(dialogos) == 1 and 'ainda não está encerrada' in dialogos[0] and n_depois == n_bp + 1, 'VALIDADO com OP aberta pede confirmação (cancelado: não salva)', dialogos)
        await ev("document.getElementById('crudBox').innerHTML = ''")

        # ---------------------------------------------------------------- 6) AICV da OP e escolha da fonte da ACV
        await ev("render('acv')"); await page.wait_for_timeout(400)
        await ev("acvStudiesV110()"); await ev("acvStudyFormV110()")
        await page.fill('#a_nome', 'Estudo ACV do passaporte')
        await page.select_option('#a_op', OP_FECHADA)
        await ev("saveACVStudyV110()")
        await ev("acvScenariosV110()")
        await ev("(() => { const s = document.getElementById('as_st'); s.selectedIndex = s.options.length - 1; })()")
        await page.fill('#as_nome', 'Base passaporte')
        await ev("saveACVScenarioV110()")
        await ev("acvAICVV110()")
        await ev("(() => { const s = document.getElementById('ai_st'); s.selectedIndex = s.options.length - 1; s.dispatchEvent(new Event('change')); })()")
        await page.wait_for_timeout(200)
        await ev("runAICVV110()"); await page.wait_for_timeout(500)
        aicv = await ev("(() => { const r = data.acv_resultados[0]; return {id: r.IdResultado, op: r.CodOP, total: Number(r.Impactos['Mudanças climáticas']), n: Number(r.MassaProduto)}; })()")
        await ev("render('bp')"); await page.wait_for_timeout(500)
        idx = await ev(f"data.bp.findIndex(b => b.CodOrdemProducao === '{OP_ABERTA}')")
        await ev(f"openBPForm({idx})"); await page.wait_for_timeout(700)
        await escolher_op(OP_FECHADA)
        co2 = await campo('BP_CO2_PorCelula')
        fonte = await campo('BP_ACV_Fonte')
        ok(aicv['op'] == OP_FECHADA and perto(br(co2), aicv['total'] / aicv['n']) and aicv['id'] in fonte,
           f'ACV calculada na OP (AICV {aicv["id"]}) puxada sozinha para o passaporte', (co2, aicv, fonte))
        opcoes = await ev("[...document.getElementById('bp_fonte_acv').options].map(o => o.value)")
        ok(opcoes[:1] == [''] and f"AICV:{aicv['id']}" in opcoes and 'FAMILIA' in opcoes, 'fontes da ACV para escolher: automático, AICV da OP e ACV da família', opcoes)
        await page.select_option('#bp_fonte_acv', 'FAMILIA'); await page.wait_for_timeout(700)
        co2f = await campo('BP_CO2_PorCelula')
        ok(perto(br(co2f), familia / 2, 3e-3), 'escolhendo a ACV da família, os valores de carbono mudam', co2f)
        # alteração à mão é mantida
        await preencher('BP_DP11_Capacity', '105')
        resposta['confirm'] = False
        dialogos.clear()
        await ev("mesBPAtualizarDaOP()"); await page.wait_for_timeout(600)
        mantida = await campo('BP_DP11_Capacity')
        resposta['confirm'] = True
        ok(mantida == '105' and dialogos and 'Capacidade nominal' in dialogos[-1], '"Atualizar com os dados da OP" pergunta antes de trocar o que foi alterado à mão', (mantida, dialogos[-1:]))
        dialogos.clear()
        await ev(f"saveBP({idx})"); await page.wait_for_timeout(1200)
        d, sim = await esperar_servidor(lambda d: any(x.get('CodOrdemProducao') == OP_FECHADA and x.get('FonteACV') == 'FAMILIA' and x.get('BP_DP11_Capacity') == '105' for x in d.get('bp') or []))
        ok(sim, 'fonte da ACV escolhida e valor alterado à mão gravados', '')

        # ---------------------------------------------------------------- 7) passaporte antigo (formato anterior)
        html_ant = await ev("standaloneDashboardHTML(data.bp.find(b => b.BatteryPassportID === 'BP0001'))")
        ok('DIGITAL BATTERY PASSPORT' in html_ant and '100 Ah' in html_ant and 'Ametista' in html_ant, 'passaporte antigo abre no painel novo (dados da estrutura do produto)', '')
        antigo = await ev("(() => { const b = data.bp.find(b => b.BatteryPassportID === 'BP0001'); return [data.bp.indexOf(b), b.Sust_CarbonFootprint_Texto]; })()")
        await ev(f"openBPForm({antigo[0]})"); await page.wait_for_timeout(700)
        dialogos.clear()
        await ev(f"saveBP({antigo[0]})"); await page.wait_for_timeout(1200)
        d, sim = await esperar_servidor(lambda d: any(x.get('BatteryPassportID') == 'BP0001' and x.get('CamposUnificados') == 'Sim' for x in d.get('bp') or []))
        b1 = next((x for x in d.get('bp') or [] if x.get('BatteryPassportID') == 'BP0001'), {})
        ok(sim and b1.get('Sust_CarbonFootprint_Texto') == antigo[1] and b1.get('DataCriacao') == '11/08/2026' and len(dialogos) == 2,
           'passaporte antigo salvo no formato novo sem perder os dados (com confirmação: a OP dele não existe mais)', dialogos)
        html_ant2 = await ev("standaloneDashboardHTML(data.bp.find(b => b.BatteryPassportID === 'BP0001'))")
        ok(b1.get('BP_DP11_Capacity') == '100' and '100 Ah' in html_ant2 and 'Ametista' in html_ant2, 'depois de salvo, o passaporte antigo continua mostrando os dados da célula', b1.get('BP_DP11_Capacity'))

        # ---------------------------------------------------------------- 8) F5, PDF interno e tela do passaporte
        await page.reload(wait_until='load')
        await entrar()
        await ev("render('bp')"); await page.wait_for_timeout(600)
        i_val = await ev(f"data.bp.findIndex(b => b.BatteryPassportID === '{id_val}')")
        await ev(f"openBPForm({i_val})"); await page.wait_for_timeout(800)
        f5 = await ev("""() => ({end: document.getElementById('bpu_BP_DP04_ManufacturerAddress').value, marcaEnd: document.getElementById('bpp_BP_DP04_ManufacturerAddress').checked,
            vida: document.getElementById('bpu_BP_DP31_ExpectedLifeCycles').value, cas: document.querySelector('#bpu_massas input.bpu-massa[data-cod="MP0018"]')?.checked})""")
        ok(f5 == {'end': 'Rua do Teste, 123 — Curitiba/PR', 'marcaEnd': False, 'vida': '3000', 'cas': False}, 'depois de recarregar (F5): dados, marcas e massas do passaporte mantidos', f5)
        await ev("document.getElementById('crudBox').innerHTML = ''")
        await ev(f"document.getElementById('bp_sel').value = '{id_val}'; showBP()"); await page.wait_for_timeout(400)
        tela = await page.inner_text('#bpDet')
        ok('Massa útil por célula' in tela and 'Dados no painel do cliente' in tela and 'solvente' in (await page.inner_html('#bpDet')), 'tela do passaporte: massa útil, massa total e o que vai para o painel', tela[:200])
        async with ctx.expect_page() as nova:
            await ev("reportBP()")
        pdf = await nova.value
        await pdf.wait_for_load_state()
        conteudo = await pdf.content()
        ok('No painel' in conteudo and 'Rua do Teste, 123' in conteudo and 'Cálculos de ACV disponíveis' in conteudo and 'Solvente NMP' in conteudo,
           'PDF interno com todos os dados, a marca "No painel", as massas (úteis e fora) e as ACVs disponíveis', '')
        await pdf.close()

        # ---------------------------------------------------------------- 9) template e importação da biblioteca de fatores
        tmp = tempfile.mkdtemp(prefix='mes_bib_')
        await ev("render('acv')"); await page.wait_for_timeout(400)
        await ev("acvBibliotecaAmbientalV233()"); await page.wait_for_timeout(300)
        async with page.expect_download() as baixa:
            await page.click('button:has-text("Baixar template Excel")')
        dl = await baixa.value
        tpl = os.path.join(tmp, dl.suggested_filename)
        await dl.save_as(tpl)
        n_mat = len(json.load(open(DADOS, encoding='utf-8')).get('data', {}).get('materiais') or json.load(open(DADOS, encoding='utf-8')).get('materiais') or [])
        with zipfile.ZipFile(tpl) as z:
            wbx, f1 = z.read('xl/workbook.xml').decode('utf-8'), z.read('xl/worksheets/sheet1.xml').decode('utf-8')
        n_ex, n_rows = f1.count('EXEMPLO fictício'), f1.count('<row ')
        ok(tpl.endswith('.xlsx') and 'name="Fatores"' in wbx and 'name="Como preencher"' in wbx and n_ex == 3 and n_rows == 1 + 3 + n_mat and '<dataValidation ' in f1,
           f'template .xlsx: aba Fatores com 3 linhas de EXEMPLO válidas e uma linha por material ({n_mat}), lista de indicadores e aba Como preencher', (n_ex, n_rows))

        async def importar(arquivo, confirmar):
            resposta['confirm'] = confirmar
            dialogos.clear()
            await page.set_input_files('#lci_import_file', arquivo)
            await page.click('button:has-text("Validar e importar")')
            await page.wait_for_timeout(1500)
            resposta['confirm'] = True
            return (await ev("(document.getElementById('lci_import_result') || {}).innerText || ''")).strip(), list(dialogos)

        versoes = lambda: ev("Math.max(...data.sust_lci.map(r => Number(r.LibraryVersion) || 0))")
        v0 = await versoes()
        txt, dg = await importar(tpl, False)
        ok('Nada para importar' in txt and dg and 'linha(s) de EXEMPLO' in dg[0] and await versoes() == v0,
           'template sem preencher: avisa das linhas de EXEMPLO e não grava nada se o usuário não quiser', (txt[:160], dg))
        txt, dg = await importar(tpl, True)
        ok('Importação concluída' in txt and 'EXEMPLO' in txt and await versoes() == v0 + 1, 'linhas de EXEMPLO são válidas: importadas quando o usuário confirma', txt[:200])
        xl = os.path.join(tmp, 'fatores_excel.xlsx')
        xlsx_como_excel([('Como preencher', [['instruções']]),
                         ('Fatores', [['CodigoMaterial', 'DescricaoMaterial', 'UMMaterial', 'Indicador', 'UnidadeIndicador', 'FatorPorKg', 'Metodo', 'Fonte', 'Cenario', 'Validade', 'Observacoes'],
                                      ['MP0016', 'Eletrólito', 'L', 'Mudanças climáticas', 'kg CO₂eq/kg', 3.7, 'IPCC 2021 GWP100', 'Electrolyte, for Li-ion battery {GLO}| for Li-ion battery | Cut-off, U', 'Base / Brasil', 46387, ''],
                                      ['MP0014', 'Cobre', 'm', 'GWP100', 'kg CO₂eq/kg', '9,5', 'IPCC 2021 GWP100', 'Copper collector foil {GLO}| Cut-off, U', 'Base / Brasil', '', ''],
                                      ['MP0018', 'Case', 'un', 'Mudanças climáticas', 'kg CO₂eq/kg', '', '', '', '', '', '']])], xl)
        txt, dg = await importar(xl, False)
        fx = await ev("[lciActiveFactorV37('MP0016', 'Mudanças climáticas'), lciActiveFactorV37('MP0014', 'Mudanças climáticas'), (data.acv_fatores[0] || {}).Fator, (data.sust_lci.find(r => r.LibraryActive === 'Sim' && r.CodigoMaterial === 'MP0016') || {}).Validade]")
        ok('Importação concluída' in txt and '2 registro(s)' in txt and not dg and fx == [3.7, 9.5, '3.7', '31/12/2026'],
           '.xlsx salvo pelo Excel importado (aba Fatores, textos compartilhados, vírgula decimal, data) e a nova versão vale no cálculo', (txt[:160], fx))
        csv = os.path.join(tmp, 'fatores.csv')
        open(csv, 'w', encoding='cp1252').write('CodigoMaterial;Indicador;UnidadeIndicador;FatorPorKg;Metodo;Fonte;Cenario\r\n'
                                                'MP0003;Mudanças climáticas;kg CO2eq/kg;5,336;IPCC 100a;"Lithium iron phosphate {CN}| market for lithium iron phosphate | Cut-off, U";Base / Brasil\r\n'
                                                'MP0003;Acidificacao;mol H+ eq/kg;0,02;EF 3.1;"fonte; com ponto e vírgula";Base / Brasil\r\n')
        txt, dg = await importar(csv, False)
        fc = await ev("[lciActiveFactorV37('MP0003', 'Mudanças climáticas'), lciActiveFactorV37('MP0003', 'Acidificação'), (data.sust_lci.find(r => r.LibraryActive === 'Sim' && r.Indicador === 'Acidificação') || {}).Fonte]")
        ok('Importação concluída' in txt and fc == [5.336, 0.02, 'fonte; com ponto e vírgula'], 'CSV com ponto e vírgula, aspas e acentos (ANSI) importado', (txt[:120], fc))
        ruim = os.path.join(tmp, 'errado.csv')
        open(ruim, 'w', encoding='utf-8').write('CodigoMaterial;Indicador;UnidadeIndicador;FatorPorKg;Metodo;Fonte;Cenario\nXX999;Mudanças climáticas;kg;1;m;f;c\nMP0003;Mudanças climáticas;kg;abc;m;f;c\nMP0003;Pegada hídrica;L;2;m;f;c\n')
        v1 = await versoes()
        txt, dg = await importar(ruim, False)
        ok('3 inconsistência(s)' in txt and 'XX999' in txt and '"abc"' in txt and 'Pegada hídrica' in txt and await versoes() == v1, 'planilha com erros: lista as linhas com problema e não grava nada', txt[:300])
        xls = os.path.join(tmp, 'antigo.xls')
        open(xls, 'wb').write(bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + bytes(600))
        txt, dg = await importar(xls, False)
        ok('Excel 97-2003' in txt and '.xlsx' in txt and await versoes() == v1, '.xls binário do Excel 97-2003: explica como salvar (.xlsx ou CSV)', txt[:200])
        d, sim = await esperar_servidor(lambda d: max(int(r.get('LibraryVersion') or 0) for r in d.get('sust_lci') or [{}]) == v1)
        ok(sim, 'versões importadas da biblioteca gravadas no servidor', '')

        ok(not erros, 'nenhum erro JavaScript', erros[:3])
        await b.close()
    print(f'\n== {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print('FALHAS:'); [print(' - ' + f) for f in falhas]
        sys.exit(1)

asyncio.run(main())
