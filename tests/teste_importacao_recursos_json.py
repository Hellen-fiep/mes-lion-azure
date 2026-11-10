#!/usr/bin/env python3
"""
Teste no navegador da versão JSON 1.6.0 (server/adaptador_recursos_importacao.js) — importação de equipamentos por
planilha em Engenharia › Recursos / Máquinas:
  - botão "⬆ Importar planilha de equipamentos" na tela Recursos / Máquinas e a tela da importação;
  - modelo em branco (.xlsx conferido com openpyxl): abas Equipamentos / Instruções / Listas, grupos de colunas mesclados,
    cabeçalho congelado, listas suspensas (processos, escala, ativo, operação, unidade) ligadas aos nomes da aba Listas,
    linhas de EXEMPLO amarelas com números como número; o modelo intocado não importa nada (exemplos ignorados);
  - planilha preenchida: equipamento novo com código automático, novo processo de equipamento já cadastrado (o que fica em
    branco vem do cadastro, como no formulário), atualização pelo código + processo + subprocesso (acentos e maiúsculas
    não importam), código informado, listas sem acento, Capacidades das máquinas (padrões e uma vez por código);
  - importação: Recursos / Custos + Cadastro ligados pelo IdRecurso, custos calculados como no formulário, capacidade
    e histórico da capacidade, registro da importação e Histórico de Modificações (POST /api/recursos/importacao);
  - a mesma planilha de novo não duplica nada; o modelo com os equipamentos cadastrados volta sem nenhuma mudança
    (inclusive códigos repetidos, "0,80" com vírgula e nomes com espaço no fim, como na base real);
  - erros que bloqueiam (nome, processo fora do cadastro, número inválido ou negativo, listas, linha repetida, código
    inválido, capacidade incompleta, ID inexistente, equipamento que já existe sem o código) e a planilha de erros;
  - CSV com os nomes dos campos do cadastro; "Atualizar os equipamentos que já existem" desmarcado; troca de processo e de
    código pelo ID interno;
  - desfazer: volta tudo, pula a linha alterada depois da importação e o equipamento já usado em roteiro;
  - sem erro de JavaScript.

Uso: python teste_importacao_recursos_json.py <url_base>
"""
import sys, os, json, asyncio, time, datetime, tempfile, copy
import requests
import openpyxl
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
CHROME = os.environ.get('MES_CHROME') or ('/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else None)
falhas, total = [], 0
PASTA = tempfile.mkdtemp(prefix='mes_importacao_recursos_')

REC = ['CodEquipamento', 'Equipamento', 'PotenciaEquipamento (W)', 'Processo', 'SubProcesso', 'TempoOperação (min)', 'NPessoas', 'TaxaEnergia (R$/kWh)', 'TaxaMOD (R$/h)',
       'CustoEnergia', 'CustoMOD', 'Escala', 'IdCelula']
CAD = ['Código Equipamento', 'Equipamento', 'Processo', 'SubProcesso', 'PotenciaEquipamento (W)', 'Ativo', 'Escala', 'NumeroPatrimonio', 'NumeroNF', 'ValorEquipamento',
       'FatorDepreciacao', 'Fator dolar', 'Impostos', 'Capacidade', 'Unidade Capacidade', 'Modelo Celula']
CAP = ['Codigo', 'Tipo', 'Capacidade', 'Unidade', 'CicloMin', 'SetupMin', 'HorasDia', 'Eficiencia', 'Simultaneas', 'Observacoes']
OBS_EX = 'EXEMPLO fictício — substitua pelos dados do seu equipamento ou apague esta linha'


def ok(c, nome, det=''):
    global total
    total += 1
    print(('  [OK]   ' if c else '  [FALHA] ') + nome + ('' if c else f' -> {str(det)[:700]}'), flush=True)
    if not c: falhas.append(f'{nome}: {str(det)[:700]}')


def cabecalho(ws):
    # nome da coluna (linha 2, sem o " *" dos obrigatórios) -> número da coluna
    return {str(c.value).replace(' *', '').strip(): c.column for c in ws[2] if c.value}


def planilha(modelo, linhas, nome, manter_dados=False):
    """Copia o modelo baixado, troca as linhas de dados pelas informadas ({coluna: valor}) e grava em PASTA/nome."""
    wb = openpyxl.load_workbook(modelo)
    ws = wb['Equipamentos']
    col = cabecalho(ws)
    if not manter_dados and ws.max_row >= 3:
        ws.delete_rows(3, ws.max_row)
    r = ws.max_row + 1 if manter_dados else 3
    for l in linhas:
        for k, v in l.items():
            ws.cell(row=r, column=col[k], value=v)
        r += 1
    cam = os.path.join(PASTA, nome)
    wb.save(cam)
    return cam


def editar(modelo, nome, alteracoes, novas=()):
    """Altera linhas do modelo com os cadastrados: alteracoes = [(filtro(dict da linha) -> bool, {coluna: valor})]."""
    wb = openpyxl.load_workbook(modelo)
    ws = wb['Equipamentos']
    col = cabecalho(ws)
    feitos = [0] * len(alteracoes)
    for r in range(3, ws.max_row + 1):
        linha = {k: ws.cell(row=r, column=c).value for k, c in col.items()}
        for i, (filtro, valores) in enumerate(alteracoes):
            if filtro(linha):
                for k, v in valores.items(): ws.cell(row=r, column=col[k], value=v)
                feitos[i] += 1
    r = ws.max_row + 1
    for l in novas:
        for k, v in l.items(): ws.cell(row=r, column=col[k], value=v)
        r += 1
    cam = os.path.join(PASTA, nome)
    wb.save(cam)
    return cam, feitos


def por_chave(lista, cod, proc, sub=None):
    return [r for r in lista if str(r.get('CodEquipamento') or r.get('Código Equipamento') or '') == cod and r.get('Processo') == proc and (sub is None or (r.get('SubProcesso') or '') == sub)]


async def main():
    hoje = datetime.date.today().isoformat()
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
        page = await ctx.new_page()
        erros, dialogos, respostas = [], [], []
        logado = {'v': False}
        page.on('pageerror', lambda e: erros.append(str(e)))
        page.on('console', lambda m: erros.append('console: ' + m.text) if logado['v'] and m.type == 'error' and ('MES LION 1.6' in m.text or 'recursos/importacao' in m.text) else None)
        page.on('response', lambda r: respostas.append((r.status, r.url)) if '/api/recursos/importacao' in r.url else None)

        def dialogo(d):
            dialogos.append(d.message)
            asyncio.ensure_future(d.accept())
        page.on('dialog', dialogo)
        ev = page.evaluate

        async def cookies():
            return {c['name']: c['value'] for c in await ctx.cookies()}

        async def dados_servidor():
            return requests.get(BASE + '/api/bootstrap', cookies=await cookies(), timeout=180).json()['data']

        async def auditoria():
            r = requests.get(BASE + f'/api/audit?de={hoje}&ate={hoje}&limite=5000', cookies=await cookies(), timeout=60)
            return r.json() if r.status_code == 200 else []

        async def esperar(cond, segundos=30):
            fim = time.time() + segundos
            while time.time() < fim:
                try:
                    if await cond(): return True
                except Exception:
                    pass
                await page.wait_for_timeout(500)
            return False

        async def menu(k):
            if not await ev(f"document.getElementById('nav_{k}').closest('details').open"):
                await page.click(f'nav details:has(#nav_{k}) > summary')
            await page.click('#nav_' + k)
            await page.wait_for_timeout(400)

        async def baixar(rotulo):
            async with page.expect_download(timeout=60000) as info:
                await page.click(f'button:has-text("{rotulo}")')
            dl = await info.value
            caminho = os.path.join(PASTA, dl.suggested_filename)   # o openpyxl exige a extensão .xlsx no nome
            await dl.save_as(caminho)
            return dl.suggested_filename, caminho

        async def subir(caminho):
            await ev("mesRecImpLimpar()")
            await page.set_input_files('#mri_arquivo', caminho)
            await page.wait_for_function("(() => { const m = document.getElementById('mri_msg'); return m && /lidas|Não foi possível/.test(m.textContent); })()", timeout=60000)
            await page.wait_for_timeout(150)
            return await ev("mesRecursosImportacaoAPI.ultima()")

        async def importar():
            n = len(dialogos)
            await page.click('#mri_importar')
            await page.wait_for_function("(() => { const m = document.getElementById('mri_msg'); return m && /concluída|Não foi possível importar/.test(m.textContent); })()", timeout=60000)
            msg = await ev("document.getElementById('mri_msg').textContent")
            return msg, dialogos[n:]

        async def desfazer(id_imp):
            await ev("document.getElementById('mri_msg').textContent = ''")
            await page.click(f'tr[data-imp="{id_imp}"] button')
            await page.wait_for_function("(() => { const m = document.getElementById('mri_msg'); return m && /desfeita|Nada foi desfeito|Não foi possível desfazer/.test(m.textContent); })()", timeout=60000)
            return await ev("document.getElementById('mri_msg').textContent")

        async def gravado(cond, segundos=40):
            # espera o servidor refletir o que a tela gravou (saveLocal grava em segundo plano)
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

        def resumo(v):
            return v['resumo'] if v else None

        def item(v, linha):
            return next((i for i in v['itens'] if i['linha'] == linha), None)

        await page.goto(BASE + '/', wait_until='load')
        await page.fill('#user', 'admin'); await page.fill('#pass', 'meslion2026'); await page.click('.login-card button')
        await page.wait_for_selector('#app:not(.hidden)', timeout=120000)
        await page.wait_for_timeout(1800)
        logado['v'] = True

        # ------------------------------------------------------------------ tela
        ini = await ev("({ v: window.MES_ADAPTADOR_RECURSOS_IMPORTACAO, api: !!window.mesRecursosImportacaoAPI, rec: !!window.mesRecursosAPI, xl: !!(window.mesXlsx && mesXlsx.coluna) })")
        ok(ini == {'v': '1.6.0', 'api': True, 'rec': True, 'xl': True}, 'adaptador 1.6.0 (importação de equipamentos) carregado, com a API de Recursos / Máquinas', ini)
        await menu('cad_recursos')
        botoes = await ev("""(() => { const b = Array.from(document.querySelectorAll('#content .toolbar button')).find(x => x.textContent.trim() === '+ Novo recurso');
            return b ? Array.from(b.parentElement.querySelectorAll('button')).map(x => x.textContent.trim()) : []; })()""")
        ok(botoes[:2] == ['+ Novo recurso', '⬆ Importar planilha de equipamentos'], 'botão "⬆ Importar planilha de equipamentos" ao lado de "+ Novo recurso"', botoes)
        base = json.loads(await ev("JSON.stringify({ recursos: data.recursos, cad: data.cad_recursos, processos: data.processos, caps: data.mes_capacidades || [] })"))
        n_rec0 = len(base['recursos'])
        await page.click('button:has-text("⬆ Importar planilha de equipamentos")')
        await page.wait_for_timeout(300)
        t = await ev("({ t: document.getElementById('title').textContent, nav: (document.querySelector('nav button.active') || {}).id, botoes: Array.from(document.querySelectorAll('#content .toolbar button')).map(b => b.textContent.trim()), arq: !!document.querySelector('#mri_arquivo[type=file]'), chk: document.getElementById('mri_atualizar').checked })")
        ok(t['t'] == 'Importar planilha de equipamentos' and t['nav'] == 'nav_cad_recursos' and t['arq'] and t['chk']
           and t['botoes'] == ['← Recursos / Máquinas', '⬇ Modelo em branco (com exemplos)', '⬇ Modelo com os equipamentos cadastrados'],
           'tela da importação (voltar, dois modelos, arquivo, "Atualizar os que já existem" marcado; menu Recursos / Máquinas ativo)', t)

        # ------------------------------------------------------------------ modelo em branco
        nome_modelo, modelo = await baixar('⬇ Modelo em branco (com exemplos)')
        wb = openpyxl.load_workbook(modelo)
        ws = wb['Equipamentos']
        cols = await ev("mesRecursosImportacaoAPI.colunas()")
        cab = [c.value for c in ws[2]]
        procs = sorted({p['Processo'] for p in base['processos']} | {r['Processo'] for r in base['recursos'] if r.get('Processo')}, key=lambda s: s)
        ok(nome_modelo == 'MES_LION_modelo_importacao_equipamentos.xlsx' and wb.sheetnames == ['Equipamentos', 'Instruções', 'Listas'] and wb.active.title == 'Equipamentos',
           'modelo .xlsx com as abas Equipamentos (ativa), Instruções e Listas', (nome_modelo, wb.sheetnames, wb.active.title))
        ok(cab == [c['rot'] + (' *' if c['obrig'] else '') for c in cols] and cab[:3] == ['Código do equipamento', 'Equipamento *', 'Processo *'] and cab[-1] == 'ID interno (não altere)',
           f'cabeçalho na linha 2 com as {len(cols)} colunas (obrigatórias com *)', cab)
        grupos = {str(r) for r in ws.merged_cells.ranges}
        ok(ws['A1'].value == 'Identificação' and ws['H1'].value == 'Tempos, energia e custos da operação' and str(ws['U1'].value).startswith('Planejamento')
           and {'A1:G1', 'H1:L1', 'M1:T1', 'U1:AC1', 'AD1:AE1'} <= grupos and ws.freeze_panes == 'A3',
           'grupos de colunas mesclados na linha 1 e as duas linhas do cabeçalho congeladas', (grupos, ws.freeze_panes))
        dv = {str(d.sqref): d.formula1 for d in ws.data_validations.dataValidation}
        nomes = {n: wb.defined_names[n].attr_text for n in wb.defined_names}
        ok(dv.get('C3:C2002') == 'ListaProcessos' and dv.get('E3:E2002') == 'ListaEscalas' and dv.get('F3:F2002') == 'ListaSimNao' and dv.get('U3:U2002') == 'ListaOperacao'
           and dv.get('W3:W2002') == 'ListaUnidades' and nomes.get('ListaProcessos') == f"'Listas'!$A$2:$A${len(procs) + 1}", 'listas suspensas (processo, escala, ativo, operação, unidade) ligadas aos nomes da aba Listas', (dv, nomes))
        wl = wb['Listas']
        lista_proc = [wl.cell(row=r, column=1).value for r in range(2, wl.max_row + 1) if wl.cell(row=r, column=1).value]
        lista_esc = [wl.cell(row=r, column=2).value for r in range(2, wl.max_row + 1) if wl.cell(row=r, column=2).value]
        ok(sorted(lista_proc) == sorted(procs) and 'Planta Piloto' in lista_esc and [wl.cell(row=r, column=3).value for r in (2, 3)] == ['Sim', 'Não']
           and [wl.cell(row=r, column=4).value for r in (2, 3, 4)] == ['Batelada', 'Contínua', 'Unidade'], 'aba Listas com os processos cadastrados, escalas, Sim/Não, operações e unidades', (lista_proc, lista_esc))
        ex = [[c.value for c in ws[r]] for r in (3, 4)]
        col = cabecalho(ws)
        ok(ws.max_row == 4 and all(str(l[col['Observações da importação'] - 1]).startswith('EXEMPLO') for l in ex) and ex[0][0] == ex[1][0] == 'EX-01'
           and ex[0][col['Processo'] - 1] in procs and ex[1][col['Processo'] - 1] in procs and ex[0][col['Processo'] - 1] != ex[1][col['Processo'] - 1]
           and isinstance(ex[0][col['Tempo de operação (min)'] - 1], (int, float)) and ex[0][col['Taxa de energia (R$/kWh)'] - 1] == 0.82
           and ws.cell(row=3, column=2).fill.fgColor.rgb == 'FFFFF2CC', 'duas linhas de EXEMPLO amarelas (mesmo equipamento em dois processos, números como número)', ex)
        wi = wb['Instruções']
        txt_inst = '\n'.join(str(c.value) for r in wi.iter_rows() for c in r if c.value)
        ok('Como preencher' in txt_inst and 'célula em branco mantém o valor atual' in txt_inst and all(c['rot'] in txt_inst for c in cols), 'aba Instruções com as regras e todas as colunas', txt_inst[:300])

        v = await subir(modelo)
        r0 = resumo(v)
        btn = await ev("(b => b ? { d: b.disabled, t: b.textContent } : null)(document.getElementById('mri_importar'))")
        ok(r0 and r0['linhas'] == 2 and r0['exemplos'] == 2 and r0['aplicar'] == 0 and r0['erros'] == 0 and btn == {'d': True, 't': 'Nada para importar'},
           'modelo intocado: as linhas de EXEMPLO são ignoradas e não há o que importar', (r0, btn))

        # ------------------------------------------------------------------ planilha preenchida
        p_corte = next(p for p in procs if p.startswith('Corte ân'))
        linhas = [
            {'Equipamento': 'Moinho de bolas TESTE', 'Processo': 'Mistura Ânodo', 'Subprocesso': 'Moagem', 'Tempo de operação (min)': 60, 'Nº de pessoas': 2, 'Potência (W)': 1500,
             'Taxa de energia (R$/kWh)': '0,9', 'Taxa MOD (R$/h)': 30, 'Nº patrimônio': 'PAT-T1', 'Valor do equipamento (R$)': 12000,
             'Operação': 'Batelada', 'Capacidade física por ciclo/hora': 10, 'Unidade da capacidade física': 'kg/batelada', 'Tempo de ciclo (min)': 90},
            {'Código do equipamento': '1', 'Processo': 'Montagem Célula', 'Subprocesso': 'Prensagem', 'Tempo de operação (min)': 30, 'Nº de pessoas': 1},
            {'Código do equipamento': '2', 'Processo': 'corte anodo', 'Subprocesso': p_corte, 'Tempo de operação (min)': 45},
            {'Código do equipamento': 'T-100', 'Equipamento': 'Prensa hidráulica TESTE', 'Processo': 'Montagem Célula', 'Subprocesso': 'Prensagem', 'Escala': 'industrial', 'Ativo': 'não',
             'Tempo de operação (min)': 15, 'Nº de pessoas': 1, 'Potência (W)': 5000, 'Taxa de energia (R$/kWh)': 0.82, 'Taxa MOD (R$/h)': 25,
             'Operação': 'continua', 'Capacidade física por ciclo/hora': 50, 'Unidade da capacidade física': 'kg/h', 'Horas programadas por dia útil': 16, 'Eficiência planejada (%)': 90, 'Operações simultâneas': 2},
            {'Código do equipamento': 'T-100', 'Equipamento': 'Prensa hidráulica TESTE', 'Processo': 'Corte cátodo', 'Subprocesso': 'Prensagem cátodo',
             'Tempo de operação (min)': 20, 'Nº de pessoas': 1, 'Potência (W)': 5000, 'Taxa de energia (R$/kWh)': 0.82, 'Taxa MOD (R$/h)': 25,
             'Operação': 'Contínua', 'Capacidade física por ciclo/hora': 50, 'Unidade da capacidade física': 'kg/h', 'Horas programadas por dia útil': 16, 'Eficiência planejada (%)': 90, 'Operações simultâneas': 2},
            {'Código do equipamento': 'EX-01', 'Equipamento': 'EXEMPLO Misturador planetário 5 L', 'Processo': 'Mistura Ânodo', 'Observações da importação': OBS_EX},
        ]
        arq1 = planilha(modelo, linhas, 'equipamentos_preenchida.xlsx')
        v = await subir(arq1)
        r1 = resumo(v)
        acoes = [(i['linha'], i['acao'], i['codigo'], i['automatico']) for i in v['itens']]
        ok(r1 and (r1['linhas'], r1['novos'], r1['novosProcessos'], r1['atualizar'], r1['exemplos'], r1['erros'], r1['capacidades'], r1['aplicar']) == (6, 3, 1, 1, 1, 0, 2, 5)
           and acoes == [(3, 'NOVO', '15', True), (4, 'NOVO_PROCESSO', '1', False), (5, 'ATUALIZAR', '2', False), (6, 'NOVO', 'T-100', False), (7, 'NOVO', 'T-100', False), (8, 'EXEMPLO', '', False)],
           'validação: código automático (15), novo processo do equipamento 1, atualização do 2 (processo sem acento), T-100 em dois processos, exemplo ignorado', (r1, acoes))
        i3, i4, i5, i6, i7 = (item(v, n) for n in (3, 4, 5, 6, 7))
        ok(i3['rec']['CustoEnergia'] == '1.3500' and i3['rec']['CustoMOD'] == '60.0000' and i3['rec']['TaxaEnergia (R$/kWh)'] == '0.9' and i3['rec']['Escala'] == 'Planta Piloto'
           and i3['cad']['Ativo'] == 'Sim' and i3['cap'] == {'Codigo': '15', 'Tipo': 'Batelada', 'Capacidade': 10, 'Unidade': 'kg/batelada', 'CicloMin': 90, 'SetupMin': 0, 'HorasDia': 8,
                                                              'Eficiencia': 100, 'Simultaneas': 1, 'Observacoes': ''},
           'equipamento novo: custos como no formulário, "0,9" com vírgula, escala e ativo padrão, capacidade com os padrões (8 h, 100%, 1, setup 0)', i3)
        ok(i4['rec']['Equipamento'] == 'Calandra' and i4['rec']['PotenciaEquipamento (W)'] == '2000' and i4['rec']['TaxaEnergia (R$/kWh)'] == '0.82' and i4['rec']['TaxaMOD (R$/h)'] == '5'
           and i4['rec']['Escala'] == 'Laboratório' and i4['rec']['CustoEnergia'] == '0.8200' and i4['rec']['CustoMOD'] == '2.5000'
           and any('copiados do cadastro' in a and 'Potência (W)' in a for a in i4['avisos']),
           'novo processo de equipamento já cadastrado: nome, potência, taxas e escala vêm do cadastro (aviso), custos calculados', i4)
        muda5 = {m['campo']: (m['de'], m['para']) for m in i5['mudancas']}
        ok(muda5 == {'Tempo de operação (min)': ('40', '45'), 'Custo energia (calculado)': ('0.54666666666666663', '0.6150'), 'Custo MOD (calculado)': ('3.333333333333333', '3.7500')},
           'atualização mostra o que muda (tempo e custos recalculados) e só isso', muda5)
        ok(i6['cad']['Ativo'] == 'Não' and i6['rec']['Escala'] == 'Industrial' and i6['cap']['Tipo'] == 'Contínua' and i6['cap']['HorasDia'] == 16 and i7['cap'] and not i6['erros'] and not i7['erros'],
           'listas sem acento e em minúsculas ("não", "industrial", "continua") viram o valor da lista; capacidade igual nas duas linhas do T-100', (i6['cad'], i6['cap'], i7['cap']))
        tabela = await ev("Array.from(document.querySelectorAll('#mri_res tbody tr')).map(tr => Array.from(tr.cells).map(td => td.innerText.trim()))")
        btn = await ev("document.getElementById('mri_importar').textContent")
        ok(len(tabela) == 6 and tabela[0][1] == 'Novo equipamento' and '15 (automático)' in tabela[0][2] and tabela[1][1] == 'Novo processo de equipamento já cadastrado'
           and tabela[2][1] == 'Atualizar' and 'Tempo de operação (min): 40 → 45' in tabela[2][6] and tabela[5][1] == 'Exemplo (não é importada)' and btn == '⬆ Importar 5 linha(s) e 2 capacidade(s)',
           'prévia na tela linha a linha e o botão "Importar 5 linha(s) e 2 capacidade(s)"', (tabela, btn))

        msg, dlg = await importar()
        id1 = await ev("data.recursos_importacoes[0].IdImportacao")
        ok('concluída' in msg and '3 novo(s), 1 processo(s) novo(s), 1 atualizado(s), 2 capacidade(s)' in msg and dlg and 'Importar a planilha "equipamentos_preenchida.xlsx"?' in dlg[0],
           'importação confirmada e concluída', (msg, dlg))
        d = await gravado(lambda d: any(r.get('CodEquipamento') == '15' for r in d['recursos']) and d.get('recursos_importacoes'))
        R, C = d['recursos'], d['cad_recursos']
        ok(len(R) == n_rec0 + 4 and len(C) == len(R) and {r['IdRecurso'] for r in R} == {c['IdRecurso'] for c in C} and len({r['IdRecurso'] for r in R}) == len(R),
           'gravado no servidor: 4 linhas novas em Recursos e no Cadastro, ligadas pelo IdRecurso (sem repetir)', (len(R), len(C), n_rec0))
        cad = {c['IdRecurso']: c for c in C}
        r15 = por_chave(R, '15', 'Mistura Ânodo', 'Moagem')
        c15 = cad.get(r15[0]['IdRecurso']) if r15 else {}
        ok(len(r15) == 1 and {k: r15[0][k] for k in ('Equipamento', 'TempoOperação (min)', 'NPessoas', 'PotenciaEquipamento (W)', 'TaxaEnergia (R$/kWh)', 'TaxaMOD (R$/h)', 'CustoEnergia', 'CustoMOD', 'Escala')}
           == {'Equipamento': 'Moinho de bolas TESTE', 'TempoOperação (min)': '60', 'NPessoas': '2', 'PotenciaEquipamento (W)': '1500', 'TaxaEnergia (R$/kWh)': '0.9', 'TaxaMOD (R$/h)': '30',
               'CustoEnergia': '1.3500', 'CustoMOD': '60.0000', 'Escala': 'Planta Piloto'}
           and c15.get('Código Equipamento') == '15' and c15.get('Ativo') == 'Sim' and c15.get('NumeroPatrimonio') == 'PAT-T1' and c15.get('ValorEquipamento') == '12000' and c15.get('Processo') == 'Mistura Ânodo',
           'equipamento 15 gravado (tempos, taxas, custos) com o espelho no cadastro (patrimônio, valor, ativo)', (r15, c15))
        r1n = por_chave(R, '1', 'Montagem Célula', 'Prensagem')
        r2a = por_chave(R, '2', p_corte, p_corte)
        r2c = [r for r in R if r.get('CodEquipamento') == '2' and r.get('Processo') != p_corte]
        ok(len(r1n) == 1 and r1n[0]['Equipamento'] == 'Calandra' and cad[r1n[0]['IdRecurso']]['Equipamento'] == 'Calandra' and cad[r1n[0]['IdRecurso']]['Ativo'] == 'Sim'
           and len(r2a) == 1 and r2a[0]['TempoOperação (min)'] == '45' and r2a[0]['CustoEnergia'] == '0.6150' and r2c and r2c[0]['TempoOperação (min)'] == '40',
           'novo processo da Calandra gravado e só a linha do Corte ânodo do equipamento 2 mudou', (r1n, r2a, r2c))
        t100 = [r for r in R if r.get('CodEquipamento') == 'T-100']
        ok(len(t100) == 2 and sorted(cad[r['IdRecurso']]['Ativo'] for r in t100) == ['Não', 'Sim'] and {r['Escala'] for r in t100} == {'Industrial', 'Planta Piloto'},
           'T-100 nos dois processos (ativo e escala de cada linha)', t100)
        caps = {p['Codigo']: p for p in d.get('mes_capacidades') or []}
        hist = [h for h in d.get('mes_capacidade_historico') or [] if id1 in str(h.get('Origem'))]
        ok({k: caps.get('15', {}).get(k) for k in CAP} == i3['cap'] and caps.get('T-100', {}).get('Simultaneas') == 2 and caps['T-100'].get('Eficiencia') == 90 and caps['T-100'].get('AtualizadoEm')
           and len(hist) == 2 and all(h['Anterior'] is None and h['Usuario'] == 'admin' for h in hist),
           'Capacidades das máquinas gravadas (15 e T-100, uma vez cada) com o histórico da capacidade', (caps.get('15'), caps.get('T-100'), hist))
        imp = (d.get('recursos_importacoes') or [{}])[0]
        ok(imp.get('IdImportacao') == id1 and imp.get('Status') == 'APLICADA' and (imp.get('Novos'), imp.get('NovosProcessos'), imp.get('Atualizados'), imp.get('Capacidades')) == (3, 1, 1, 2)
           and imp.get('Arquivo') == 'equipamentos_preenchida.xlsx' and len(imp.get('Itens') or []) == 5 and imp['Itens'][2]['RecAntes']['TempoOperação (min)'] == '40',
           'importação registrada (arquivo, contagens, valores anteriores de cada linha)', {k: imp.get(k) for k in ('IdImportacao', 'Status', 'Novos', 'Arquivo')})
        aud = await auditoria()
        a1 = [a for a in aud if a.get('module') == 'recursos' and a.get('action') == 'IMPORTAR' and a.get('record_key') == id1]
        det = (a1[0].get('details') or {}) if a1 else {}
        ok(a1 and det.get('arquivo') == 'equipamentos_preenchida.xlsx' and det.get('novos') == '4' and det.get('atualizados') == '1' and det.get('capacidades') == '2' and a1[0].get('username') == 'admin',
           'importação no Histórico de Modificações (usuário, arquivo, novos, atualizados, capacidades)', a1[:1])
        hist_tela = await ev("Array.from(document.querySelectorAll('#mri_hist tbody tr')).map(tr => tr.dataset.imp + '|' + tr.innerText)")
        ok(hist_tela and hist_tela[0].startswith(id1 + '|') and 'APLICADA' in hist_tela[0] and 'Desfazer' in hist_tela[0], '"Importações anteriores" com a importação e o botão Desfazer', hist_tela)

        # ------------------------------------------------------------------ a mesma planilha de novo
        v = await subir(arq1)
        r2 = resumo(v)
        e3 = item(v, 3)
        ok(r2 and r2['erros'] == 1 and r2['semMudanca'] == 4 and r2['aplicar'] == 0 and e3['acao'] == 'ERRO' and any('com o código 15' in e and 'informe o código 15' in e for e in e3['erros']),
           'a mesma planilha de novo não duplica: a linha sem código acusa que o equipamento já existe (código 15) e as outras ficam sem mudança', (r2, e3['erros']))

        # ------------------------------------------------------------------ modelo com os cadastrados: ida e volta sem mudança
        nome_cad, cadastrados = await baixar('⬇ Modelo com os equipamentos cadastrados')
        wc = openpyxl.load_workbook(cadastrados)['Equipamentos']
        colc = cabecalho(wc)
        linhas_cad = [{k: wc.cell(row=r, column=c).value for k, c in colc.items()} for r in range(3, wc.max_row + 1)]
        l15 = next((l for l in linhas_cad if l['Código do equipamento'] == '15'), {})
        l11 = next((l for l in linhas_cad if l['Código do equipamento'] == '11' and not l['Subprocesso']), {})
        ok(nome_cad.startswith('MES_LION_equipamentos_cadastrados_') and len(linhas_cad) == n_rec0 + 4 and all(l['ID interno (não altere)'] for l in linhas_cad)
           and l15.get('Operação') == 'Batelada' and l15.get('Tempo de ciclo (min)') == 90 and l15.get('Nº patrimônio') == 'PAT-T1' and l11.get('Taxa de energia (R$/kWh)') == 0.8,
           'modelo com os cadastrados: uma linha por recurso, com o ID interno, o cadastro e a capacidade ("0,80" sai como número 0,8)', (len(linhas_cad), l15, l11))
        v = await subir(cadastrados)
        r3 = resumo(v)
        avisos6 = [i for i in v['itens'] if i['codigo'] in ('6', '12') and any('também é do equipamento' in a for a in i['avisos'])]
        ok(r3 and r3['erros'] == 0 and r3['aplicar'] == 0 and r3['capacidades'] == 0 and r3['semMudanca'] == n_rec0 + 4 and len(avisos6) == 4
           and await ev("document.getElementById('mri_importar').disabled"),
           'modelo com os cadastrados subido sem alteração: nada muda (códigos 6 e 12 repetidos só com aviso)', (r3, [(i['linha'], i['acao'], i['mudancas'], i['erros']) for i in v['itens'] if i['acao'] != 'SEM_MUDANCA'][:5]))

        # ------------------------------------------------------------------ erros
        com_erro = [
            {'Processo': 'Mistura Ânodo', 'Tempo de operação (min)': 10},
            {'Equipamento': 'Equipamento X', 'Processo': 'Processo Inexistente'},
            {'Equipamento': 'Equipamento Y', 'Processo': 'Mistura Ânodo', 'Tempo de operação (min)': 'abc'},
            {'Equipamento': 'Equipamento Z', 'Processo': 'Mistura Ânodo', 'Potência (W)': -5},
            {'Equipamento': 'Equipamento W', 'Processo': 'Mistura Ânodo', 'Escala': 'Gigante'},
            {'Equipamento': 'Equipamento V', 'Processo': 'Mistura Ânodo', 'Ativo': 'talvez'},
            {'Código do equipamento': 'DUP-1', 'Equipamento': 'Duplicado', 'Processo': 'Mistura Ânodo', 'Subprocesso': 'A'},
            {'Código do equipamento': 'DUP-1', 'Equipamento': 'Duplicado', 'Processo': 'mistura anodo', 'Subprocesso': 'a'},
            {'Código do equipamento': 'C|1', 'Equipamento': 'Código ruim', 'Processo': 'Mistura Ânodo'},
            {'Equipamento': 'Equipamento Q', 'Processo': 'Mistura Ânodo', 'Operação': 'Batelada', 'Capacidade física por ciclo/hora': 5, 'Unidade da capacidade física': 'kg/batelada'},
            {'Equipamento': 'Equipamento R', 'Processo': 'Mistura Ânodo', 'ID interno (não altere)': 'RCNAOEXISTE'},
            {'Equipamento': 'Calandra', 'Processo': 'Coating ânodo', 'Subprocesso': 'Calandragem ânodo'},
            {'Equipamento': 'Equipamento certo', 'Processo': 'Mistura Ânodo'},
        ]
        arq_erro = planilha(modelo, com_erro, 'equipamentos_com_erro.xlsx')
        v = await subir(arq_erro)
        r4 = resumo(v)
        msgs = {i['linha']: ' | '.join(i['erros']) for i in v['itens']}
        esperado = {3: 'Informe o nome', 4: 'não está cadastrado', 5: 'não é um número', 6: 'não pode ser negativo', 7: 'não é um valor válido', 8: 'não é um valor válido',
                    10: 'Mesmo código, processo e subprocesso da linha 9', 11: 'sem "|"', 12: 'na batelada, informe o tempo de ciclo', 13: 'não existe mais no cadastro', 14: 'com o código 1'}
        faltam = {k: msgs.get(k) for k, e in esperado.items() if e not in (msgs.get(k) or '')}
        btn = await ev("(b => ({ d: b.disabled, t: b.textContent }))(document.getElementById('mri_importar'))")
        ok(r4 and r4['erros'] == 11 and not faltam and not msgs[9] and not msgs[15] and btn == {'d': True, 't': 'Corrija os erros para importar'},
           'erros apontados linha a linha e a importação bloqueada (nome, processo, número, negativo, listas, repetida, código, capacidade, ID, já existe)', (r4, faltam, btn))
        nome_res, res = await baixar('⬇ Planilha com os erros e avisos apontados')
        wr = openpyxl.load_workbook(res)['Equipamentos']
        ult = wr.max_column
        val3, val15 = wr.cell(row=3, column=ult).value or '', wr.cell(row=15, column=ult).value or ''
        ok(nome_res.startswith('MES_LION_equipamentos_validacao_') and str(wr.cell(row=2, column=ult).value).startswith('Resultado da validação') and val3.startswith('Com erro') and 'ERRO: Informe o nome' in val3
           and val15.startswith('Novo equipamento') and wr.cell(row=3, column=1).fill.fgColor.rgb == 'FFF8D7DA' and wr.cell(row=5, column=8).value == 'abc',
           'planilha com os erros apontados (coluna "Resultado da validação", linhas com erro em vermelho, valores como foram digitados)', (val3, val15))
        v = await subir(res)
        ok(resumo(v)['erros'] == 11 and not v['ignoradas'], 'a planilha de erros pode ser corrigida e subida de novo (a coluna do resultado é ignorada)', (resumo(v), v['ignoradas']))

        # ------------------------------------------------------------------ CSV com os nomes dos campos do cadastro
        csv = os.path.join(PASTA, 'equipamentos.csv')
        with open(csv, 'w', encoding='utf-8-sig', newline='') as f:
            f.write('Código Equipamento;Equipamento;Processo;SubProcesso;TempoOperação (min);NPessoas;PotenciaEquipamento (W);TaxaEnergia (R$/kWh);TaxaMOD (R$/h);Coluna extra\r\n')
            f.write(';Bomba de vácuo CSV;Coating cátodo;Vácuo;30;1;750;0,82;12,5;x\r\n')
            f.write(';;;;;;;;;\r\n')
        v = await subir(csv)
        i_csv = item(v, 2)
        ok(resumo(v)['novos'] == 1 and resumo(v)['linhas'] == 1 and i_csv['codigo'] == '16' and i_csv['rec']['CustoEnergia'] == '0.3075' and i_csv['rec']['CustoMOD'] == '6.2500' and v['ignoradas'] == ['Coluna extra'],
           'CSV (;) com os nomes dos campos do cadastro e vírgula decimal; coluna desconhecida ignorada e avisada; linha vazia pulada', (resumo(v), i_csv, v['ignoradas']))
        msg, _ = await importar()
        id_csv = await ev("data.recursos_importacoes[0].IdImportacao")
        ok('concluída' in msg and await ev("data.recursos.some(r => r.CodEquipamento === '16' && r.Equipamento === 'Bomba de vácuo CSV')"), 'CSV importado (código 16)', msg)

        # ------------------------------------------------------------------ atualização pelo modelo com os cadastrados
        _, cadastrados2 = await baixar('⬇ Modelo com os equipamentos cadastrados')
        e_estufa = lambda l: l['Código do equipamento'] == '4' and l['Processo'] == 'Mistura Ânodo' and not l['Subprocesso']
        alter = [(lambda l: l['Código do equipamento'] == '13', {'Taxa MOD (R$/h)': 7.5}),
                 (e_estufa, {'Processo': 'Montagem Célula'}),
                 (lambda l: l['Código do equipamento'] == '6' and l['Equipamento'] == 'Glove box', {'Código do equipamento': '6B'})]
        arq_upd_novo, feitos = editar(cadastrados2, 'equipamentos_atualizar_mais_novo.xlsx', alter, [{'Equipamento': 'Novo via modelo', 'Processo': 'Corte cátodo'}])
        arq_upd, _ = editar(cadastrados2, 'equipamentos_atualizar.xlsx', alter)
        ok(feitos == [1, 1, 1], 'planilhas de atualização montadas a partir do modelo com os cadastrados', feitos)
        await page.click('#mri_atualizar')   # desmarca: só inclui os novos
        v = await subir(arq_upd_novo)
        r5 = resumo(v)
        ok(r5['naoAtualizar'] == 3 and r5['novos'] == 1 and r5['aplicar'] == 1 and await ev("document.getElementById('mri_importar').textContent") == '⬆ Importar 1 linha(s)',
           '"Atualizar os que já existem" desmarcado: as 3 alterações ficam de fora e só o equipamento novo entra', r5)
        await page.click('#mri_atualizar')
        await page.wait_for_timeout(200)
        r5b = resumo(await ev("mesRecursosImportacaoAPI.ultima()"))
        await page.click('#mri_atualizar')
        await page.wait_for_timeout(200)
        r5c = resumo(await ev("mesRecursosImportacaoAPI.ultima()"))
        ok(r5b['atualizar'] == 3 and r5b['aplicar'] == 4 and r5c['aplicar'] == 1, 'marcar e desmarcar refaz a validação na hora', (r5b, r5c))
        msg, _ = await importar()
        ok('1 novo(s), 0 processo(s) novo(s), 0 atualizado(s)' in msg and await ev("data.recursos.find(r => r.CodEquipamento === '13')['TaxaMOD (R$/h)'] === '5'")
           and await ev("data.recursos.some(r => r.CodEquipamento === '17' && r.Equipamento === 'Novo via modelo')"),
           'só o novo foi importado (código 17); a taxa MOD do 13 não mudou', msg)
        await page.click('#mri_atualizar')   # marca de novo
        v = await subir(arq_upd)
        r6 = resumo(v)
        i_glove = next(i for i in v['itens'] if i['codigo'] == '6B')
        i_estufa = next(i for i in v['itens'] if i['rec'] and i['rec']['Processo'] == 'Montagem Célula' and i['codigo'] == '4')
        ok(r6['atualizar'] == 3 and r6['erros'] == 0 and r6['novos'] == 0 and any('Troca o código 6 por 6B' in a for a in i_glove['avisos'])
           and {m['campo'] for m in i_estufa['mudancas']} == {'Processo'},
           'pelo ID interno: troca de código (com aviso) e troca de processo; taxa MOD do 13', (r6, i_glove['avisos'], i_estufa['mudancas']))
        msg, _ = await importar()
        id_upd = await ev("data.recursos_importacoes[0].IdImportacao")
        d = await gravado(lambda d: any(r.get('CodEquipamento') == '6B' for r in d['recursos']))
        R = d['recursos']; cad = {c['IdRecurso']: c for c in d['cad_recursos']}
        r13 = [r for r in R if r.get('CodEquipamento') == '13']
        g6 = [r for r in R if r.get('CodEquipamento') == '6B']
        est = [r for r in R if r.get('CodEquipamento') == '4' and r.get('Processo') == 'Montagem Célula']
        ok(r13 and r13[0]['TaxaMOD (R$/h)'] == '7.5' and r13[0]['CustoMOD'] == '22.5000' and g6 and g6[0]['Equipamento'] == 'Glove box' and cad[g6[0]['IdRecurso']]['Código Equipamento'] == '6B'
           and est and cad[est[0]['IdRecurso']]['Processo'] == 'Montagem Célula' and est[0]['TempoOperação (min)'] == '12',
           'atualizações gravadas (custo MOD recalculado; código e processo também no cadastro)', (r13, g6, est))

        # ------------------------------------------------------------------ desfazer
        antes = {x['IdRecurso']: x for x in base['recursos'] if x.get('IdRecurso')}
        msg = await desfazer(id_upd)
        d = await gravado(lambda d: any(r.get('CodEquipamento') == '6' and r.get('Equipamento') == 'Glove box' for r in d['recursos']))
        R = d['recursos']; cad = {c['IdRecurso']: c for c in d['cad_recursos']}
        r13 = [r for r in R if r.get('CodEquipamento') == '13']
        b13 = next(r for r in base['recursos'] if r.get('CodEquipamento') == '13')
        g6 = [r for r in R if r.get('Equipamento') == 'Glove box']
        est = [r for r in R if r.get('CodEquipamento') == '4' and r.get('IdCelula') == 'Ametista2']
        imp_upd = next(x for x in d['recursos_importacoes'] if x['IdImportacao'] == id_upd)
        ok('desfeita (' in msg and imp_upd['Status'] == 'DESFEITA' and {k: r13[0][k] for k in REC} == {k: b13.get(k, '') for k in REC} and g6[0]['CodEquipamento'] == '6'
           and cad[g6[0]['IdRecurso']]['Código Equipamento'] == '6' and est[0]['Processo'] == 'Mistura Ânodo' and cad[est[0]['IdRecurso']]['Processo'] == 'Mistura Ânodo',
           'desfazer a atualização volta os valores exatos de antes (taxa, custos, código e processo)', (msg, r13, g6, est))
        # linha alterada depois da importação: o desfazer pula essa linha e volta o resto
        await ev("""(() => { const r = data.recursos.find(r => r.CodEquipamento === 'T-100' && r.Processo === 'Corte cátodo'); r['TempoOperação (min)'] = '99'; saveLocal(); })()""")
        msg = await desfazer(id1)
        d = await gravado(lambda d: not any(r.get('CodEquipamento') == '15' for r in d['recursos']))
        R = d['recursos']; cad = {c['IdRecurso']: c for c in d['cad_recursos']}
        imp1 = next(x for x in d['recursos_importacoes'] if x['IdImportacao'] == id1)
        r2a = por_chave(R, '2', p_corte, p_corte)
        b2a = por_chave(base['recursos'], '2', p_corte, p_corte)[0]
        caps = {p['Codigo']: p for p in d.get('mes_capacidades') or []}
        hist = [h for h in d.get('mes_capacidade_historico') or [] if ('Desfazer importação ' + id1) in str(h.get('Origem'))]
        ok('desfeita em parte' in msg and imp1['Status'] == 'DESFEITA EM PARTE' and len(imp1['Pulados']) == 1 and 'T-100' in imp1['Pulados'][0] and 'alterada depois da importação' in imp1['Pulados'][0]
           and not por_chave(R, '1', 'Montagem Célula') and {k: r2a[0][k] for k in REC} == {k: b2a.get(k, '') for k in REC}
           and [r['Processo'] for r in R if r.get('CodEquipamento') == 'T-100'] == ['Corte cátodo'] and '15' not in caps and 'T-100' not in caps and len(hist) == 2
           and len(R) == len(d['cad_recursos']),
           'desfazer pula a linha alterada depois e volta o resto (linhas novas saem, a atualizada volta, capacidades saem com histórico)', (msg, imp1.get('Pulados'), len(hist)))
        # equipamento já usado em roteiro: o desfazer não apaga
        await ev("""(() => { data.roteiro_recursos = data.roteiro_recursos || []; data.roteiro_recursos.push({ IdRecursoRoteiro: 'RR-TESTE-IMP', CodRoteiro: 'RT-TESTE', CodEquipamento: '16', Processo: 'Coating cátodo' }); saveLocal(); })()""")
        msg = await desfazer(id_csv)
        tem16 = await ev("data.recursos.some(r => r.CodEquipamento === '16')")
        st_csv = await ev(f"data.recursos_importacoes.find(x => x.IdImportacao === '{id_csv}').Status")
        ok('Nada foi desfeito' in msg and 'já usada em 1 registro' in msg and tem16 and st_csv == 'APLICADA',
           'desfazer não apaga o equipamento que já entrou em um roteiro (a importação continua aplicada)', (msg, st_csv))
        await ev("""(() => { data.roteiro_recursos = data.roteiro_recursos.filter(x => x.IdRecursoRoteiro !== 'RR-TESTE-IMP'); saveLocal(); })()""")
        msg = await desfazer(id_csv)
        ok('desfeita (1 item(ns))' in msg and not await ev("data.recursos.some(r => r.CodEquipamento === '16')"), 'sem o roteiro, o desfazer da mesma importação funciona', msg)
        botoes_hist = await ev("Array.from(document.querySelectorAll('#mri_hist tbody tr')).map(tr => [tr.dataset.imp, !!tr.querySelector('button')])")
        ok(dict(botoes_hist).get(id1) is False and dict(botoes_hist).get(id_upd) is False and dict(botoes_hist).get(id_csv) is False, 'importação desfeita não oferece desfazer de novo', botoes_hist)
        aud = await auditoria()
        ok(len([a for a in aud if a.get('module') == 'recursos' and a.get('action') == 'DESFAZER_IMPORTACAO' and a.get('record_key') in (id1, id_upd, id_csv)]) == 3,
           'cada desfazer no Histórico de Modificações', [a for a in aud if a.get('module') == 'recursos'][:4])

        # ------------------------------------------------------------------ voltar e consistência
        await page.click('button:has-text("← Recursos / Máquinas")')
        await page.wait_for_timeout(400)
        ok(await ev("document.getElementById('title').textContent") == 'Recursos / Máquinas', '"← Recursos / Máquinas" volta para o cadastro', '')
        sinc = await ev("(() => { const ids = r => r.map(x => x.IdRecurso).sort().join(','); return { r: data.recursos.length, c: data.cad_recursos.length, mesmo: ids(data.recursos) === ids(data.cad_recursos) }; })()")
        ok(sinc['r'] == sinc['c'] and sinc['mesmo'], 'Recursos e Cadastro continuam ligados um a um depois de importar e desfazer', sinc)
        ruins = [r for r in respostas if r[0] != 200]
        ok(respostas and not ruins, 'registros da importação aceitos pelo servidor (POST /api/recursos/importacao)', ruins or respostas[:3])
        r = requests.post(BASE + '/api/recursos/importacao', json={'acao': 'IMPORTAR', 'idImportacao': 'x'}, timeout=30)
        ok(r.status_code == 401, 'registro da importação exige login', r.status_code)
        ok(not erros, 'sem erro de JavaScript', erros[:5])
        await b.close()


asyncio.run(main())
print(f'\n== {total - len(falhas)}/{total} verificações OK', flush=True)
if falhas:
    print('FALHAS:'); [print(' -', f) for f in falhas]
    sys.exit(1)
