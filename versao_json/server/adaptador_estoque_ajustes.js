/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR 1.3.0: ESTOQUE MÍNIMO, AJUSTE DE ESTOQUE, MRP COM SALDO ÚNICO E KANBAN DE CARACTERIZAÇÃO
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, DEPOIS de adaptador_codigos_estoque.js.
   Não altera os arquivos do frontend (index.html, js\, style.css): cada tela é estendida por cima da versão já validada.
     1) Materiais: campo "Estoque mínimo" (na UM do material). Só alerta: não muda necessidade líquida, reservas nem OPs.
     2) MRP: o estoque passa a ser o MESMO saldo físico do módulo Estoque / Rastreabilidade (entradas − consumos
        apontados − perdas do lote − saídas manuais e baixas técnicas). Colunas e quadro de estoque mínimo.
     3) Plano de Produção: quadro de materiais abaixo do estoque mínimo.
     4) Ajuste de Estoque (novo item do menu Materiais): saída manual, baixa técnica sem OP (motivo + projeto),
        entrada manual (novo lote) e correção do saldo geral do material; histórico, estorno e Excel.
        Gravado em data.estoque_ajustes; o saldo é calculado em adaptador_codigos_estoque.js (função usoEntrada).
     5) Calendário de Testes de Caracterização: cartões no estilo Kanban, arrastáveis entre os dias (só nessa tela),
        com a mesma validação de dias úteis / dias bloqueados / indisponibilidade do equipamento do PCP e sem
        sobreposição de testes no mesmo equipamento.
     1.6.1) MRP: a necessidade de cada OP é o planejado menos o que ela já consumiu (o consumo já saiu do saldo físico;
        antes era descontado duas vezes) e tudo fica na UM do material (window.mesNecessidadesMRP, usada também pelo
        relatório de MRP).
   ===================================================================== */
(function () {
  'use strict';
  var VERSAO = '1.6.1';

  /* ---------------------------------------------------------------------
     0) UTILITÁRIOS
     --------------------------------------------------------------------- */
  function A(v) { return Array.isArray(v) ? v : []; }
  function D() { return (typeof data === 'object' && data) ? data : null; }
  /* número gravado nos dados ou calculado ("0,8956", "0.125", 12.5): a mesma leitura do app (num do app.js).
     1.5.0: o ponto como separador de milhar vale só para o que a pessoa digita (numDigitado) — antes um valor gravado
     como "0.001" ou "0.125" era lido como 1 ou 125 (MRP, saldo do lote no Ajuste de Estoque, estoque mínimo). */
  function N(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof num === 'function') return num(v);
    var s = String(v == null ? '' : v).trim();
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  /* número digitado pelo usuário: aceita vírgula; '' = vazio; NaN = inválido */
  function numDigitado(v) {
    var s = String(v == null ? '' : v).trim();
    if (s === '') return '';
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
    return Number(s);
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function jsStr(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '); }
  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? String(e.value == null ? '' : e.value) : ''; }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function arred(v, c) { var f = Math.pow(10, c == null ? 6 : c); return Math.round((Number(v) || 0) * f) / f; }
  function f3(v) { var n = typeof v === 'number' ? v : N(v); return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
  function f4(v) { var n = typeof v === 'number' ? v : N(v); return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }); }
  function reais(v) { return (typeof money === 'function') ? money(v) : 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function hoje() { return new Date().toLocaleDateString('pt-BR'); }
  function agora() { return new Date().toLocaleString('pt-BR'); }
  function salvar() { try { if (typeof saveLocal === 'function') saveLocal(); } catch (e) { console.warn('MES LION: gravação', e); } }
  function API() { return window.mesEstoqueAPI || null; }
  function usuario() { var a = API(); if (a && a.usuario) return a.usuario(); try { return (window.MES_CURRENT_USER && (MES_CURRENT_USER.username || MES_CURRENT_USER.fullName)) || 'admin'; } catch (e) { return 'admin'; } }
  function tag(s) { var a = API(); return a && a.tag ? a.tag(s) : '<span>' + esc(s) + '</span>'; }
  function cabecalho(t, s) { if (el('title')) el('title').textContent = t; if (el('subtitle')) el('subtitle').textContent = s || ''; }
  function setCurrent(k) { try { current = k; } catch (e) { } }
  function marcarNav(k) {
    try {
      document.body.classList.remove('dashboard-mode');
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      var b = el('nav_' + k); if (b) b.classList.add('active');
    } catch (e) { }
  }
  function material(cod) {
    var a = API(); if (a && a.material) return a.material(cod);
    return A((D() || {}).materiais).find(function (m) { return String(m['CódigoMaterial']) === String(cod); }) || null;
  }
  function minimoDoMaterial(m) { return m && txt(m.EstoqueMinimo) !== '' && N(m.EstoqueMinimo) > 0 ? N(m.EstoqueMinimo) : ''; }
  function dataBRparaNum(s) {
    var m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? Number(m[3] + m[2] + m[1]) : 99999999;
  }
  function estilo() {
    var a = API(); if (a && a.estilo) a.estilo();
    if (el('mea-estilo')) return;
    var st = document.createElement('style'); st.id = 'mea-estilo';
    st.textContent = [
      '.mea-card{background:#fff;border:1px solid #d6e2ec;border-radius:10px;padding:12px 14px;margin:0 0 12px}',
      '.mea-card h3{margin:0 0 8px;font-size:14px;color:#0b3a5c}',
      '.mea-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px 12px;align-items:end}',
      '.mea-grid label{display:flex;flex-direction:column;gap:3px;font-size:12px}',
      '.mea-grid label.wide{grid-column:1/-1}',
      '.mea-grid input,.mea-grid select,.mea-grid textarea{width:100%;box-sizing:border-box}',
      '.mea-tipos{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}',
      '.mea-tipos button{background:#eef3f8;color:#0b3a5c;border:1px solid #b9cbdb}',
      '.mea-tipos button.on{background:#0b3a5c;color:#fff;border-color:#0b3a5c}',
      '.mea-kpis{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}',
      '.mea-kpis div{background:#f4f8fb;border:1px solid #d6e2ec;border-radius:8px;padding:6px 10px;min-width:120px}',
      '.mea-kpis small{display:block;color:#52606d;font-size:11px}.mea-kpis b{font-size:15px;color:#0b3a5c}',
      '.mea-num{text-align:right;white-space:nowrap}',
      '.mea-q{width:110px;text-align:right}',
      '.mea-msg{margin:8px 0;padding:8px 10px;border-radius:8px;font-size:12px}',
      '.mea-msg.ok{background:#eaf6e4;border:1px solid #b9dca6}.mea-msg.erro{background:#fdecec;border:1px solid #f0b4b4}.mea-msg.alerta{background:#fff6e0;border:1px solid #f0d58f}',
      '.mea-min{border:1px solid #f0c5a3;background:#fff8f1;border-left:4px solid #d9822b;border-radius:8px;padding:8px 12px;margin:0 0 12px}',
      '.mea-min.ok{border-color:#b9dca6;background:#f3faef;border-left-color:#4f9a2c}',
      '.mea-min summary{cursor:pointer;font-weight:700;color:#7a4b08}.mea-min.ok summary{color:#2f6b17}',
      '.mea-min table{margin-top:6px}',
      '.mea-row-min td{background:#fff3f2}',
      '.mea-est{color:#8a8f96;text-decoration:line-through}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------------
     1) MATERIAIS — CAMPO "ESTOQUE MÍNIMO"
     --------------------------------------------------------------------- */
  (function () {
    var editarAnt = window.editarMaterialCadastroV4047;
    if (typeof editarAnt === 'function') {
      window.editarMaterialCadastroV4047 = function (idx) {
        var r = editarAnt.apply(this, arguments);
        try {
          if (el('mea_mat_min')) return r;
          var i = (typeof idx === 'number') ? idx : -1;
          var old = i >= 0 ? (A(D().materiais)[i] || {}) : {};
          var um = el('v47_mat_um'), host = um ? um.closest('label') : null;
          if (!host || !host.parentNode) return r;
          var lab = document.createElement('label');
          lab.innerHTML = '<span>Estoque mínimo <small class="muted" id="mea_mat_min_um">(' + esc(old.UM || (um && um.value) || 'UM') + ')</small></span>' +
            '<input id="mea_mat_min" inputmode="decimal" autocomplete="off" placeholder="ex.: 2,5 — vazio = sem mínimo" value="' + esc(txt(old.EstoqueMinimo) === '' ? '' : String(old.EstoqueMinimo).replace('.', ',')) + '">';
          host.parentNode.insertBefore(lab, host.nextSibling);
          um.addEventListener('input', function () { var s = el('mea_mat_min_um'); if (s) s.textContent = '(' + (um.value || 'UM') + ')'; });
        } catch (e) { console.warn('MES LION: estoque mínimo no material', e); }
        return r;
      };
    }
    var salvarAnt = window.salvarMaterialCadastroV4047;
    if (typeof salvarAnt === 'function') {
      window.salvarMaterialCadastroV4047 = async function (idx) {
        var minEl = el('mea_mat_min'), codEl = el('v47_mat_cod');
        if (!minEl || !codEl) return salvarAnt.apply(this, arguments);
        var minimo = numDigitado(minEl.value);
        if (minimo !== '' && (!isFinite(minimo) || minimo < 0)) return alert('Estoque mínimo inválido: "' + minEl.value + '". Informe um número maior ou igual a zero (ex.: 2,5) ou deixe em branco.');
        var cod = txt(codEl.value), i = (typeof idx === 'number') ? idx : -1;
        var antes = A(D().materiais), qtdAntes = antes.length, objAntes = i >= 0 ? antes[i] : null;
        var r = await salvarAnt.apply(this, arguments);
        try {
          var ms = A(D().materiais);
          var gravou = i >= 0 ? ms[i] !== objAntes : ms.length > qtdAntes;
          if (!gravou) return r;
          var m = i >= 0 ? ms[i] : null;
          if (!m || txt(m['CódigoMaterial']) !== cod) m = ms.find(function (x) { return txt(x['CódigoMaterial']) === cod; });
          if (!m) return r;
          var novo = minimo === '' ? '' : String(arred(minimo, 6));
          if (txt(m.EstoqueMinimo) !== novo) {
            if (novo === '') delete m.EstoqueMinimo; else m.EstoqueMinimo = novo;
            salvar();
            try { if (current === 'materiais' && typeof render === 'function') render('materiais'); } catch (e) { }
          }
        } catch (e) { console.warn('MES LION: estoque mínimo do material', e); }
        return r;
      };
    }
  })();

  /* coluna "Estoque mínimo" na lista de materiais (logo depois da unidade de medida) */
  (function () {
    try {
      if (typeof fields === 'object' && fields && Array.isArray(fields.materiais) && fields.materiais.indexOf('EstoqueMinimo') < 0) {
        var p = fields.materiais.indexOf('UM');
        fields.materiais.splice(p >= 0 ? p + 1 : fields.materiais.length, 0, 'EstoqueMinimo');
      }
      if (typeof MES_FIELD_LABELS === 'object' && MES_FIELD_LABELS && !MES_FIELD_LABELS.EstoqueMinimo) MES_FIELD_LABELS.EstoqueMinimo = 'Estoque mínimo';
    } catch (e) { }
  })();

  /* materiais com estoque mínimo e a situação atual (saldo físico do Estoque e disponível após as OPs abertas) */
  function alertasMinimo() {
    var a = API(); if (!a) return { definidos: 0, linhas: [] };
    var res = a.resumo(), definidos = 0, linhas = [];
    res.forEach(function (m) {
      if (!m.SituacaoMinimo) return;
      definidos++;
      if (m.SituacaoMinimo !== 'OK') linhas.push(m);
    });
    linhas.sort(function (x, y) { return (x.SituacaoMinimo === 'ABAIXO DO MÍNIMO' ? 0 : 1) - (y.SituacaoMinimo === 'ABAIXO DO MÍNIMO' ? 0 : 1) || String(x.CodigoMaterial).localeCompare(String(y.CodigoMaterial), 'pt-BR', { numeric: true }); });
    return { definidos: definidos, linhas: linhas };
  }
  function quadroMinimo(contexto) {
    var r = alertasMinimo();
    if (!r.definidos) return '';
    if (!r.linhas.length) return '<details class="mea-min ok" id="mea_min_box"><summary>Estoque mínimo: nenhum material abaixo do mínimo (' + r.definidos + ' material(is) com mínimo cadastrado)</summary></details>';
    var abaixo = r.linhas.filter(function (m) { return m.SituacaoMinimo === 'ABAIXO DO MÍNIMO'; }).length;
    return '<details class="mea-min" id="mea_min_box" open><summary>Estoque mínimo: ' + abaixo + ' material(is) abaixo do mínimo' +
      (r.linhas.length - abaixo ? ' · ' + (r.linhas.length - abaixo) + ' ficarão abaixo com as OPs abertas' : '') + '</summary>' +
      '<p class="muted" style="margin:4px 0">Somente alerta (' + esc(contexto) + '): o mínimo não altera a necessidade líquida nem as OPs. Saldo físico = mesmo saldo do módulo Estoque / Rastreabilidade; disponível = saldo físico − reservado para as OPs abertas.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Código</th><th>Material</th><th>UM</th><th>Estoque mínimo</th><th>Saldo físico</th><th>Reservado p/ OPs abertas</th><th>Disponível</th><th>Situação</th></tr></thead><tbody>' +
      r.linhas.map(function (m) {
        return '<tr><td>' + esc(m.CodigoMaterial) + '</td><td>' + esc(m.Material) + '</td><td>' + esc(m.UM) + '</td><td class="mea-num">' + f3(m.EstoqueMinimo) + '</td><td class="mea-num"><b>' + f3(m.SaldoFisico) + '</b></td><td class="mea-num">' + f4(m.Reservado) + '</td><td class="mea-num">' + f3(m.Disponivel) + '</td><td>' + tag(m.SituacaoMinimo) + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }
  window.mesQuadroEstoqueMinimo = quadroMinimo;

  /* ---------------------------------------------------------------------
     2) MRP — SALDO ÚNICO COM O MÓDULO ESTOQUE + ESTOQUE MÍNIMO (SÓ ALERTA)
     Mesma regra da V2.3.17 (OPs selecionáveis, necessidade bruta = materiais dimensionados nas OPs, necessidade
     líquida = bruta − estoque); muda apenas a origem do estoque: saldo físico do Estoque / Rastreabilidade.
     --------------------------------------------------------------------- */
  (function () {
    var mrpAnt = window.mrpModuleV235, memAnt = window.mrpMemoriaV2317, pdfAnt = window.mrpComprasPDFV2316, xlsAnt = window.mrpComprasExcelV2316;
    if (typeof mrpAnt !== 'function') return;
    function E(s) { return typeof htmlEscape === 'function' ? htmlEscape(String(s == null ? '' : s)) : esc(s); }
    function ensure() { var d = D(); ['op', 'op_materiais', 'entradas', 'consumos_materiais', 'materiais'].forEach(function (k) { d[k] = A(d[k]); }); d.meta = d.meta || {}; }
    function activeOP(o) { return !/cancel|exclu|anulad|encerrad|conclu/i.test(String(o.Status || '')); }
    function selectedSet() {
      var d = D(); ensure();
      var active = d.op.filter(activeOP).map(function (o) { return String(o.CodOP); });
      var saved = A(d.meta.mrpOpsIncluidas).map(String).filter(function (x) { return active.indexOf(x) >= 0; });
      if (!d.meta.mrpOpsInicializado) { saved = active.slice(); d.meta.mrpOpsInicializado = true; d.meta.mrpOpsIncluidas = saved; }
      return new Set(saved);
    }
    function saldoPorMaterial() {
      var m = new Map(), a = API();
      a.resumo().forEach(function (r) { m.set(String(r.CodigoMaterial), r); });
      return m;
    }
    function situacaoMRP(minimo, saldo, bruta) {
      if (minimo === '') return '';
      if (saldo < minimo) return 'ABAIXO DO MÍNIMO';
      if (saldo - bruta < minimo) return 'FICARÁ ABAIXO APÓS AS OPs SELECIONADAS';
      return 'OK';
    }
    /* 1.6.1 — necessidade de cada OP = planejado − o que ela já consumiu (esse consumo já saiu do saldo físico; antes o
       planejado inteiro entrava na necessidade e o consumido era descontado duas vezes), tudo na UM do material. */
    function conv(q, de, para, c) { var a = API(); return a && a.converterUM ? a.converterUM(q, de, para, c).q : q; }
    function necessidades(ops) {
      var d = D(), a = API(), ctx = a && a.contexto ? a.contexto() : null, map = new Map();
      ops.forEach(function (op) {
        var porMat = {};
        d.op_materiais.filter(function (m) { return String(m.CodOP) === String(op.CodOP) && !/pi intermedi/i.test(String(m.TipoConsumo || '')); }).forEach(function (m) {
          var c = String(m.CodigoMaterial || '').trim(); if (!c) return;
          var mat = material(c) || {}, umMat = txt(mat.UM) || m.UM || '';
          var q = conv(N(m.QtdPlanejada || m.QtdNecessaria || m.QuantidadePlanejada || m.Qtd), m.UM, umMat, c);
          var z = map.get(c) || { Item: c, Material: m.DescricaoMaterial || mat.DescricaoMateriais || '', UM: umMat, NecessidadeBruta: 0, Planejado: 0, JaConsumido: 0, Detalhes: [], PorOP: [] };
          z.Planejado += q;
          z.Detalhes.push({ OP: op.CodOP, Item: op.CodigoProduto || op.Produto || '', QuantidadeOP: op.QtdPlanejada || '', QtdMaterial: q, UM: umMat, Etapa: m.OrdemEtapa || m.Ordem || '', Equipamento: m.CodEquipamento || '' });
          map.set(c, z);
          porMat[c] = (porMat[c] || 0) + q;
        });
        Object.keys(porMat).forEach(function (c) {
          var z = map.get(c), cons = a && a.consumidoNaOP ? N(a.consumidoNaOP(op.CodOP, c, ctx)) : 0, rest = Math.max(0, porMat[c] - cons);
          z.JaConsumido += cons; z.NecessidadeBruta += rest;
          z.PorOP.push({ OP: op.CodOP, Planejado: arred(porMat[c], 6), JaConsumido: arred(cons, 6), AConsumir: arred(rest, 6) });
        });
      });
      return map;
    }
    window.mesNecessidadesMRP = function (ops) { var out = []; necessidades(A(ops)).forEach(function (z) { out.push(z); }); return out; };
    function calcMRP() {
      var d = D(), sel = selectedSet(), saldos = saldoPorMaterial();
      var map = necessidades(d.op.filter(function (o) { return activeOP(o) && sel.has(String(o.CodOP)); }));
      var out = [];
      map.forEach(function (z) {
        z.Planejado = arred(z.Planejado, 6); z.JaConsumido = arred(z.JaConsumido, 6);
        var s = saldos.get(z.Item) || {}, fisico = N(s.SaldoFisico), st = Math.max(0, fisico), bruta = arred(z.NecessidadeBruta, 6), net = arred(Math.max(0, bruta - st), 6);
        var minimo = minimoDoMaterial(material(z.Item));
        out.push(Object.assign({}, z, { NecessidadeBruta: bruta, Estoque: arred(st, 6), NecessidadeLiquida: net, 'Ação': net > 0 ? 'COMPRAR / SUPRIR' : 'ESTOQUE SUFICIENTE',
          EstoqueMinimo: minimo, SituacaoMinimo: situacaoMRP(minimo, fisico, bruta), OrigemEstoque: 'Saldo físico do Estoque / Rastreabilidade' }));
      });
      d.mrp_planos = out;
      return out;
    }
    window.mesCalcMRPUnificado = calcMRP;
    function buyRows() {
      return calcMRP().filter(function (x) { return x.NecessidadeLiquida > 0; }).map(function (x) {
        return { CodigoMaterial: x.Item, Material: x.Material, NecessidadeBruta: x.NecessidadeBruta, EstoqueDisponivel: x.Estoque, QuantidadeSolicitada: x.NecessidadeLiquida, UM: x.UM,
          EstoqueMinimo: x.EstoqueMinimo === '' ? '' : x.EstoqueMinimo, SituacaoMinimo: x.SituacaoMinimo, OPs: x.Detalhes.map(function (d) { return d.OP; }).join('; ') };
      });
    }
    window.mrpModuleV235 = function () {
      if (!API()) return mrpAnt.apply(this, arguments);
      ensure(); estilo();
      var d = D(), sel = selectedSet(), ops = d.op.filter(activeOP), rows = calcMRP();
      cabecalho('MRP — Planejamento de Materiais', 'Necessidades consolidadas das OPs selecionadas.');
      var opTable = '<div class="table-wrap"><table><thead><tr><th>Incluir</th><th>OP</th><th>Tipo</th><th>PI/PA</th><th>Quantidade</th><th>UM</th><th>Roteiro</th><th>Status</th></tr></thead><tbody>' +
        (ops.map(function (o) { return '<tr><td><input type="checkbox" ' + (sel.has(String(o.CodOP)) ? 'checked' : '') + ' onchange="mrpToggleOPV2317(\'' + E(o.CodOP) + '\',this.checked)"></td><td>' + E(o.CodOP) + '</td><td>' + E(o.TipoOP || '') + '</td><td>' + E(o.CodigoProduto || o.Produto || '') + '</td><td>' + E(o.QtdPlanejada || '') + '</td><td>' + E(o.UM || '') + '</td><td>' + E(o.CodRoteiro || '') + '</td><td>' + E(o.Status || '') + '</td></tr>'; }).join('') || '<tr><td colspan="8">Nenhuma OP aberta/planejada.</td></tr>') + '</tbody></table></div>';
      var needTable = '<div class="table-wrap"><table><thead><tr><th>Material</th><th>Descrição</th><th>Nec. bruta</th><th>Estoque (saldo físico)</th><th>Nec. líquida</th><th>UM</th><th>Situação</th><th>Estoque mínimo</th><th>Alerta de mínimo</th><th>Memória</th></tr></thead><tbody>' +
        (rows.map(function (r) {
          return '<tr class="' + (r.SituacaoMinimo === 'ABAIXO DO MÍNIMO' ? 'mea-row-min' : '') + '"><td>' + E(r.Item) + '</td><td>' + E(r.Material) + '</td><td class="mea-num">' + f4(r.NecessidadeBruta) + '</td><td class="mea-num">' + f4(r.Estoque) + '</td><td class="mea-num"><b>' + f4(r.NecessidadeLiquida) + '</b></td><td>' + E(r.UM) + '</td><td>' + E(r['Ação']) + '</td>' +
            '<td class="mea-num">' + (r.EstoqueMinimo === '' ? '<span class="muted">—</span>' : f3(r.EstoqueMinimo)) + '</td><td>' + (r.SituacaoMinimo ? tag(r.SituacaoMinimo) : '<span class="muted">sem mínimo</span>') + '</td>' +
            '<td><button class="mini" onclick="mrpMemoriaV2317(\'' + E(r.Item) + '\')">Ver cálculo</button></td></tr>';
        }).join('') || '<tr><td colspan="10">Selecione ao menos uma OP com materiais dimensionados.</td></tr>') + '</tbody></table></div>';
      el('content').innerHTML = '<div class="toolbar"><button onclick="mrpModuleV235()">Recalcular MRP</button><button onclick="mrpSelectAllV2317(true)">Selecionar todas</button><button onclick="mrpSelectAllV2317(false)">Limpar seleção</button><button onclick="mrpComprasPDFV2316()">PDF Compras</button><button onclick="mrpComprasExcelV2316()">Excel Compras</button><button onclick="render(\'ops\')">Abrir OPs</button><button class="secondary" onclick="render(\'estoque\')">Estoque / Rastreabilidade</button></div>' +
        '<div class="mrp-note"><b>Regra V2.3.17:</b> o MRP não cria OP. Você escolhe quais OPs entram no planejamento; a necessidade bruta é a soma dos materiais já dimensionados nessas OPs e a necessidade líquida desconta o estoque disponível. ' +
        '<b>1.3.0:</b> o estoque é o mesmo saldo físico do Estoque / Rastreabilidade (entradas − consumos apontados − perdas do lote − saídas manuais e baixas técnicas). O estoque mínimo do cadastro de materiais é só alerta. ' +
        '<b>1.6.1:</b> a necessidade de cada OP é o planejado menos o que ela já consumiu (esse consumo já saiu do saldo físico e não é descontado duas vezes), tudo na UM do material.' +
        (function () {
          var ops = {}; d.op.forEach(function (o) { ops[o.CodOP] = 1; });
          var orf = d.consumos_materiais.filter(function (c) { return c && !ops[c.CodOP]; }), opsOrf = orf.map(function (c) { return c.CodOP; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
          return orf.length ? ' <span class="mbc-tag alerta" title="' + esc(opsOrf.join(', ')) + '">' + orf.length + ' consumo(s) de ' + opsOrf.length + ' OP(s) excluída(s) não entram no saldo (mesma regra do Estoque)</span>' : '';
        })() + '</div>' +
        quadroMinimo('MRP') +
        '<h3>OPs consideradas no MRP</h3>' + opTable + '<h3>Necessidades consolidadas</h3>' + needTable;
      salvar();
    };
    window.mrpModuleV230 = window.mrpModuleV235; window.mrpRecalcularV230 = window.mrpModuleV235;
    window.mrpMemoriaV2317 = function (code) {
      if (!API()) return memAnt && memAnt.apply(this, arguments);
      var row = calcMRP().find(function (x) { return String(x.Item) === String(code); }); if (!row) return;
      var s = saldoPorMaterial().get(String(code)) || {};
      var lines = row.Detalhes.map(function (x) { return x.OP + ': ' + f4(x.QtdMaterial) + ' ' + x.UM + (x.Etapa ? ' · etapa ' + x.Etapa : '') + (x.Equipamento ? ' · ' + x.Equipamento : ''); }).join('\n');
      var porOP = A(row.PorOP).map(function (x) { return x.OP + ': planejado ' + f4(x.Planejado) + ' − já consumido ' + f4(x.JaConsumido) + ' = a consumir ' + f4(x.AConsumir) + ' ' + row.UM; }).join('\n');
      alert('Memória de cálculo — ' + row.Item + ' ' + row.Material + '\n\nPlanejado nas OPs:\n' + lines + (porOP ? '\n\nPor OP (o que já foi consumido já saiu do estoque):\n' + porOP : '') +
        '\n\nNecessidade bruta (a consumir) = ' + f4(row.NecessidadeBruta) + ' ' + row.UM +
        '\nEstoque disponível (saldo físico do Estoque) = ' + f4(row.Estoque) + ' ' + row.UM +
        '\n   entradas ' + f4(s.Entradas) + ' − consumido ' + f4(N(s.ConsumidoEncerradas) + N(s.EmProducao)) + ' − perdas ' + f4(s.Perdas) + ' − saídas manuais/baixas técnicas ' + f4(N(s.AjustesSaida) + N(s.BaixasTecnicas)) +
        '\nNecessidade líquida = ' + f4(row.NecessidadeLiquida) + ' ' + row.UM +
        (row.EstoqueMinimo !== '' ? '\n\nEstoque mínimo = ' + f3(row.EstoqueMinimo) + ' ' + row.UM + ' → ' + row.SituacaoMinimo + ' (só alerta; não entra na necessidade líquida)' : ''));
    };
    window.mrpComprasPDFV2316 = function () {
      if (!API()) return pdfAnt && pdfAnt.apply(this, arguments);
      var r = buyRows(); if (!r.length) return alert('Não há necessidade líquida para Compras nas OPs selecionadas.');
      reportShell('Requisição de Materiais — MRP por OP', '<h2>Materiais a suprir</h2>' + tableHTML(r, Object.keys(r[0])));
    };
    window.mrpComprasExcelV2316 = function () {
      if (!API()) return xlsAnt && xlsAnt.apply(this, arguments);
      var r = buyRows(); if (!r.length) return alert('Não há necessidade líquida para Compras nas OPs selecionadas.');
      if (typeof exportExcel === 'function') return exportExcel(r, 'MRP_Compras_OPs');
      /* a versão anterior chamava exportExcel/exportCSV, que não existem nesta instalação; usa o exportador do MES */
      if (typeof downloadAuditExcelV3819 === 'function') return downloadAuditExcelV3819('MRP_Compras_OPs.xls', 'Requisição de Materiais — MRP por OP', [{ title: 'Materiais a suprir (OPs selecionadas)', rows: r }]);
      if (typeof exportCSV === 'function') return exportCSV(r, 'MRP_Compras_OPs.csv');
      alert('Exportador Excel não disponível nesta instalação.');
    };
  })();

  /* ---------------------------------------------------------------------
     3) PLANO DE PRODUÇÃO — QUADRO DE ESTOQUE MÍNIMO
     --------------------------------------------------------------------- */
  (function () {
    var planoAnt = window.pcpPlanoV235;
    if (typeof planoAnt !== 'function') return;
    window.pcpPlanoV235 = function () {
      var r = planoAnt.apply(this, arguments);
      try {
        if (!API() || el('mea_min_box')) return r;
        estilo();
        var html = quadroMinimo('Plano de Produção'); if (!html) return r;
        var c = el('content'); if (!c) return r;
        var tb = c.querySelector('.toolbar');
        if (tb) tb.insertAdjacentHTML('afterend', html); else c.insertAdjacentHTML('afterbegin', html);
      } catch (e) { console.warn('MES LION: estoque mínimo no Plano de Produção', e); }
      return r;
    };
  })();

  /* ---------------------------------------------------------------------
     4) AJUSTE DE ESTOQUE — ENTRADA / SAÍDA MANUAL, CORREÇÃO DO SALDO GERAL E BAIXA TÉCNICA SEM OP
     data.estoque_ajustes: { IdAjuste, Data, Usuario, Tipo, Sentido (ENTRADA/SAIDA), CodigoMaterial, Material, UM,
       Quantidade, Motivo, CodProjeto, Projeto, OPReferencia, TesteReferencia, Observacao, Valor, SaldoGeralAntes,
       SaldoGeralDepois, Status (ATIVO/ESTORNADO), Lotes: [{ Entrada, Lote, Quantidade, CustoUnitario, Valor, NovoLote }] }
     --------------------------------------------------------------------- */
  var TIPOS = {
    SAIDA: { nome: 'Saída manual', sentido: 'SAIDA', motivos: ['Correção de lançamento', 'Transferência / empréstimo', 'Uso e consumo geral', 'Outro'] },
    BAIXA_TECNICA: { nome: 'Baixa técnica (sem OP)', sentido: 'SAIDA', motivos: ['Resto de bobina / sobra não utilizável', 'Amostra para caracterização / ensaio', 'Avaria / dano', 'Vencido / fora da validade', 'Contaminado / fora de especificação', 'Devolução ao fornecedor', 'Outro'] },
    ENTRADA: { nome: 'Entrada manual (novo lote)', sentido: 'ENTRADA', motivos: ['Sobra devolvida ao estoque', 'Material encontrado', 'Correção de lançamento', 'Amostra / doação recebida', 'Outro'] },
    CORRECAO_SALDO: { nome: 'Corrigir saldo geral', sentido: '', motivos: ['Contagem física', 'Correção de lançamento', 'Outro'] }
  };
  function normalizarAjustes() { var d = D(); if (d && !Array.isArray(d.estoque_ajustes)) d.estoque_ajustes = []; }
  function lotesDoMaterial(cod) {
    var a = API(); if (!a) return [];
    return a.linhas().filter(function (l) { return String(l.CodigoMaterial) === String(cod); })
      .sort(function (x, y) { return dataBRparaNum(x.DataCadastro) - dataBRparaNum(y.DataCadastro) || String(x.Entrada).localeCompare(String(y.Entrada), 'pt-BR', { numeric: true }); });
  }
  function resumoDoMaterial(cod) {
    var a = API(); if (!a) return null;
    return a.resumo().find(function (r) { return String(r.CodigoMaterial) === String(cod); }) || null;
  }
  function custoReferencia(cod) {
    var ls = lotesDoMaterial(cod).filter(function (l) { return l.CustoUnitario > 0; });
    return ls.length ? ls[ls.length - 1].CustoUnitario : 0;
  }
  function locais() {
    var s = {}; A((D() || {}).entradas).forEach(function (e) { var l = txt(e.Localizacao); if (l) s[l] = 1; });
    return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
  }
  function opcoesProjetos(sel) {
    return '<option value="">— selecione —</option>' + A((D() || {}).projetos).map(function (p) { var c = txt(p.CodProjeto); return '<option value="' + esc(c) + '"' + (c === sel ? ' selected' : '') + '>' + esc(c + ' — ' + (p['Nome Projeto'] || p.NomeProjeto || '')) + '</option>'; }).join('');
  }
  function nomeProjeto(cod) { var p = A((D() || {}).projetos).find(function (x) { return txt(x.CodProjeto) === txt(cod); }); return p ? (p['Nome Projeto'] || p.NomeProjeto || '') : ''; }
  function opcoesTestes() {
    var rs = A((D() || {}).cad_recursos).concat(A((D() || {}).recursos));
    function nomeRec(c) { var r = rs.find(function (x) { return String(x['Código Equipamento'] || x.CodEquipamento || '') === String(c); }); return r ? r.Equipamento : c; }
    return '<option value="">— nenhum —</option>' + A((D() || {}).pcp_caracterizacao).slice().sort(function (a, b) { return String(b.Data).localeCompare(String(a.Data)); }).map(function (t) {
      var d = String(t.Data || '').split('-').reverse().join('/');
      return '<option value="' + esc(t.Id) + '">' + esc(d + ' ' + (t.Inicio || '') + ' · ' + nomeRec(t.Recurso) + ' · ' + (t.Descricao || 'Teste')) + '</option>';
    }).join('');
  }
  function descTeste(id) {
    var t = A((D() || {}).pcp_caracterizacao).find(function (x) { return String(x.Id) === String(id); });
    return t ? String(t.Data || '').split('-').reverse().join('/') + ' ' + (t.Inicio || '') + ' · ' + (t.Descricao || 'Teste') : '';
  }

  function ajusteModulo() {
    normalizarAjustes(); estilo(); setCurrent('ajuste_estoque'); marcarNav('ajuste_estoque');
    cabecalho('Ajuste de Estoque', 'Entrada e saída manual por material e lote, correção do saldo geral e baixa técnica sem OP (resto de bobina, amostra, avaria...). Cada ajuste fica no histórico e pode ser estornado.');
    var mats = A(D().materiais).slice().sort(function (a, b) { return String(a['CódigoMaterial']).localeCompare(String(b['CódigoMaterial']), 'pt-BR', { numeric: true }); });
    var sel = window.__meaMat || '';
    var tipo = window.__meaTipo || 'SAIDA';
    el('content').innerHTML =
      '<div class="toolbar"><button class="secondary" onclick="estoqueModuleV4047()">← Estoque / Rastreabilidade</button><button class="secondary" onclick="render(\'inventario_estoque\')">Inventário de Estoque</button></div>' +
      '<div class="mea-card"><h3>1. Material</h3><div class="mea-grid">' +
      '<label><span>Ler código (leitor ou digitação + Enter)</span><input id="mea_scan" autocomplete="off" placeholder="Código do material ou código de barras" onkeydown="if(event.key===\'Enter\'){event.preventDefault();mesAjusteLer();}"></label>' +
      '<label class="wide" style="grid-column:span 2"><span>Material</span><select id="mea_mat" onchange="mesAjusteMaterial(this.value)"><option value="">— selecione o material —</option>' +
      mats.map(function (m) { var c = m['CódigoMaterial']; return '<option value="' + esc(c) + '"' + (String(c) === String(sel) ? ' selected' : '') + '>' + esc(c + ' — ' + (m.DescricaoMateriais || '') + ' (' + (m.UM || '') + ')') + '</option>'; }).join('') +
      '</select></label></div><div id="mea_scan_msg"></div><div id="mea_resumo"></div></div>' +
      '<div class="mea-card"><h3>2. Tipo de ajuste</h3><div class="mea-tipos" id="mea_tipos">' +
      Object.keys(TIPOS).map(function (k) { return '<button type="button" data-t="' + k + '" class="' + (k === tipo ? 'on' : '') + '" onclick="mesAjusteTipo(\'' + k + '\')">' + esc(TIPOS[k].nome) + '</button>'; }).join('') +
      '</div><div id="mea_form"></div><div id="mea_msg"></div></div>' +
      '<div class="mea-card"><h3>3. Histórico de ajustes</h3><div class="toolbar" style="margin:0 0 8px"><input id="mea_h_q" placeholder="Material, lote, motivo, projeto, OP..." oninput="mesAjusteHistorico()"><select id="mea_h_tipo" onchange="mesAjusteHistorico()"><option value="">Todos os tipos</option>' +
      Object.keys(TIPOS).map(function (k) { return '<option value="' + k + '">' + esc(TIPOS[k].nome) + '</option>'; }).join('') +
      '</select><select id="mea_h_st" onchange="mesAjusteHistorico()"><option value="">Ativos e estornados</option><option value="ATIVO">Ativos</option><option value="ESTORNADO">Estornados</option></select><button onclick="mesAjusteExcel()">Exportar Excel</button></div><div id="mea_hist"></div></div>';
    renderResumo(); renderForm(); renderHistorico();
  }
  window.mesAjusteModulo = ajusteModulo;
  window.mesAjusteLer = function () {
    var v = val('mea_scan'), m = material(v);
    var msg = el('mea_scan_msg');
    if (!m) { if (msg) msg.innerHTML = '<div class="mea-msg erro">Nenhum material com o código "' + esc(v) + '".</div>'; return; }
    if (msg) msg.innerHTML = '';
    el('mea_scan').value = '';
    var s = el('mea_mat'); if (s) s.value = m['CódigoMaterial'];
    window.mesAjusteMaterial(m['CódigoMaterial']);
  };
  window.mesAjusteMaterial = function (cod) { window.__meaMat = cod || ''; renderResumo(); renderForm(); };
  window.mesAjusteTipo = function (t) {
    window.__meaTipo = t;
    document.querySelectorAll('#mea_tipos button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    renderForm();
  };
  function renderResumo() {
    var box = el('mea_resumo'); if (!box) return;
    var cod = window.__meaMat; if (!cod) { box.innerHTML = '<p class="muted">Selecione ou leia o material para ver o saldo geral e os lotes.</p>'; return; }
    var m = material(cod) || {}, r = resumoDoMaterial(cod) || { SaldoFisico: 0, Reservado: 0, Disponivel: 0, LotesComSaldo: 0, Lotes: 0 }, um = m.UM || r.UM || '';
    var minimo = minimoDoMaterial(m), sit = window.mesSituacaoMinimo ? window.mesSituacaoMinimo(minimo, N(r.SaldoFisico), N(r.Disponivel)) : '';
    box.innerHTML = '<div class="mea-kpis"><div><small>Saldo geral (físico)</small><b>' + f3(r.SaldoFisico) + ' ' + esc(um) + '</b></div><div><small>Reservado p/ OPs abertas</small><b>' + f4(r.Reservado) + '</b></div>' +
      '<div><small>Disponível</small><b>' + f3(r.Disponivel) + '</b></div><div><small>Lotes com saldo</small><b>' + (r.LotesComSaldo || 0) + ' / ' + (r.Lotes || 0) + '</b></div>' +
      '<div><small>Estoque mínimo</small><b>' + (minimo === '' ? '—' : f3(minimo)) + '</b>' + (sit ? '<br>' + tag(sit) : '') + '</div></div>';
  }
  function tabelaLotes(cod, editavel) {
    var ls = lotesDoMaterial(cod).filter(function (l) { return l.Saldo > 1e-9; });
    if (!ls.length) return '<div class="mea-msg alerta">Este material não tem lote com saldo. Não há de onde dar saída.</div>';
    return '<div class="table-wrap"><table><thead><tr><th>Entrada</th><th>Lote</th><th>Data</th><th>Localização</th><th>Fornecedor</th><th>Projeto</th><th>Saldo</th><th>Custo unit.</th>' + (editavel ? '<th>Retirar</th>' : '') + '</tr></thead><tbody>' +
      ls.map(function (l) {
        return '<tr><td>' + esc(l.Entrada) + '</td><td>' + esc(l.Lote) + '</td><td>' + esc(l.DataCadastro) + '</td><td>' + esc(l.Localizacao || '—') + '</td><td>' + esc(l.Fornecedor) + '</td><td>' + esc(l.Projeto) + '</td><td class="mea-num"><b>' + f4(l.Saldo) + '</b> ' + esc(l.UM) + '</td><td class="mea-num">' + reais(l.CustoUnitario) + '</td>' +
          (editavel ? '<td><input class="mea-q" data-entrada="' + esc(l.Entrada) + '" data-saldo="' + l.Saldo + '" inputmode="decimal" oninput="mesAjusteSomar()" value=""></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div><div id="mea_soma" class="muted" style="margin:4px 0"></div>';
  }
  function camposComuns(tipo, exigeProjeto) {
    var t = TIPOS[tipo];
    return '<label><span>Motivo *</span><select id="mea_motivo">' + t.motivos.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('') + '</select></label>' +
      '<label><span>Projeto' + (exigeProjeto ? ' *' : '') + '</span><select id="mea_proj">' + opcoesProjetos('') + '</select></label>' +
      '<label><span>OP de referência (opcional)</span><input id="mea_op" list="mea_ops" placeholder="Só registro; não consome da OP"><datalist id="mea_ops">' + A(D().op).map(function (o) { return '<option value="' + esc(o.CodOP) + '">'; }).join('') + '</datalist></label>' +
      (tipo === 'BAIXA_TECNICA' ? '<label><span>Teste de caracterização (opcional)</span><select id="mea_teste">' + opcoesTestes() + '</select></label>' : '') +
      '<label class="wide"><span>Observação' + ' (obrigatória quando o motivo é "Outro")</span><input id="mea_obs" placeholder="Ex.: ponta da bobina com 0,8 m, abaixo do mínimo para o coating"></label>';
  }
  function renderForm() {
    var box = el('mea_form'); if (!box) return;
    el('mea_msg') && (el('mea_msg').innerHTML = '');
    var cod = window.__meaMat, tipo = window.__meaTipo || 'SAIDA';
    if (!cod) { box.innerHTML = '<p class="muted">Selecione o material primeiro.</p>'; return; }
    var m = material(cod) || {}, um = m.UM || '', r = resumoDoMaterial(cod) || { SaldoFisico: 0 };
    var html = '';
    if (tipo === 'SAIDA' || tipo === 'BAIXA_TECNICA') {
      html = (tipo === 'BAIXA_TECNICA' ? '<p class="muted" style="margin:0 0 8px">Baixa de material que não será consumido em nenhuma OP (resto de bobina, amostra, avaria...). O custo fica apropriado ao projeto informado; a OP de referência e o teste são só rastreabilidade (não entram no consumo da OP, no custo da OP nem no ACV).</p>' : '<p class="muted" style="margin:0 0 8px">Retira quantidade dos lotes escolhidos. O saldo de cada lote nunca fica negativo.</p>') +
        '<div class="mea-grid"><label><span>Quantidade total (' + esc(um) + ') *</span><input id="mea_qtd" inputmode="decimal" oninput="mesAjusteDistribuir()" placeholder="ex.: 0,8"></label>' +
        '<div><button type="button" class="secondary" onclick="mesAjusteDistribuir(true)">Distribuir pelos lotes mais antigos</button></div>' +
        camposComuns(tipo, tipo === 'BAIXA_TECNICA') + '</div><h4 style="margin:12px 0 4px">Lotes de onde sai o material</h4>' + tabelaLotes(cod, true);
    } else if (tipo === 'ENTRADA') {
      html = '<p class="muted" style="margin:0 0 8px">Cria uma entrada nova (lote) com origem AJUSTE DE ESTOQUE, que aparece em Entradas, Estoque, Locais e Inventário.</p>' +
        '<div class="mea-grid"><label><span>Quantidade (' + esc(um) + ') *</span><input id="mea_qtd" inputmode="decimal"></label>' + camposEntrada(cod) + camposComuns(tipo, false) + '</div>';
    } else {
      html = '<p class="muted" style="margin:0 0 8px">Informe o saldo real contado do material (todos os lotes). Se for menor que o saldo do sistema, a diferença sai dos lotes (mais antigos primeiro, editável); se for maior, entra como um lote novo.</p>' +
        '<div class="mea-grid"><label><span>Saldo do sistema</span><input readonly value="' + esc(f4(r.SaldoFisico) + ' ' + um) + '"></label><label><span>Saldo contado (' + esc(um) + ') *</span><input id="mea_contado" inputmode="decimal" oninput="mesAjusteCorrecao()"></label>' +
        '<label><span>Diferença</span><input id="mea_dif" readonly></label>' + camposComuns(tipo, false) + '</div><div id="mea_corr"></div>';
    }
    html += '<div class="form-actions" style="margin-top:10px"><button onclick="mesAjusteRegistrar()">Registrar ajuste</button></div>';
    box.innerHTML = html;
    if (tipo === 'SAIDA' || tipo === 'BAIXA_TECNICA') window.mesAjusteSomar();
  }
  function camposEntrada(cod) {
    var d = new Date(), lote = 'AJ-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    return '<label><span>Custo unitário (R$/UM)</span><input id="mea_custo" inputmode="decimal" value="' + esc(String(arred(custoReferencia(cod), 6)).replace('.', ',')) + '"></label>' +
      '<label><span>Lote</span><input id="mea_lote" value="' + esc(lote) + '"></label>' +
      '<label><span>Localização</span><input id="mea_local" list="mea_locais"><datalist id="mea_locais">' + locais().map(function (l) { return '<option value="' + esc(l) + '">'; }).join('') + '</datalist></label>';
  }
  window.mesAjusteSomar = function () {
    var q = numDigitado(val('mea_qtd')), soma = 0;
    document.querySelectorAll('#mea_form .mea-q').forEach(function (i) { var v = numDigitado(i.value); if (isFinite(v) && v !== '') soma += v; });
    var b = el('mea_soma'); if (!b) return;
    var ok = q !== '' && isFinite(q) && Math.abs(arred(soma, 6) - arred(q, 6)) < 1e-9;
    b.innerHTML = 'Distribuído nos lotes: <b>' + f4(soma) + '</b>' + (q !== '' && isFinite(q) ? ' de ' + f4(q) + (ok ? ' ✓' : ' <span style="color:#a00e1c">(a soma precisa ser igual à quantidade total)</span>') : '');
  };
  /* preenche os lotes do mais antigo para o mais novo */
  function distribuirFIFO(q) {
    var resto = q;
    document.querySelectorAll('#mea_form .mea-q').forEach(function (i) {
      var s = N(i.dataset.saldo), t = Math.max(0, Math.min(s, resto));
      i.value = t > 0 ? String(arred(t, 6)).replace('.', ',') : '';
      resto = arred(resto - t, 9);
    });
    return resto;
  }
  window.mesAjusteDistribuir = function () {
    var q = numDigitado(val('mea_qtd'));
    if (q === '' || !isFinite(q) || q <= 0) { window.mesAjusteSomar(); return; }
    var resto = distribuirFIFO(q);
    window.mesAjusteSomar();
    var b = el('mea_soma');
    if (b && resto > 1e-9) b.innerHTML += ' <span style="color:#a00e1c">— saldo insuficiente: faltam ' + f4(resto) + '</span>';
  };
  window.mesAjusteCorrecao = function () {
    var cod = window.__meaMat, r = resumoDoMaterial(cod) || { SaldoFisico: 0 }, c = numDigitado(val('mea_contado')), box = el('mea_corr'), dif = el('mea_dif');
    if (!box) return;
    if (c === '' || !isFinite(c) || c < 0) { box.innerHTML = ''; if (dif) dif.value = ''; return; }
    var delta = arred(c - N(r.SaldoFisico), 6);
    if (dif) dif.value = (delta > 0 ? '+' : '') + f4(delta);
    if (Math.abs(delta) < 1e-9) { box.innerHTML = '<div class="mea-msg ok">O saldo contado é igual ao saldo do sistema. Nada a ajustar.</div>'; return; }
    if (delta < 0) {
      if (box.dataset.modo !== 'saida') { box.dataset.modo = 'saida'; box.innerHTML = '<h4 style="margin:12px 0 4px">Saída de ' + f4(-delta) + ' — lotes de onde sai</h4>' + tabelaLotes(cod, true) + '<input type="hidden" id="mea_qtd">'; }
      else { var h = box.querySelector('h4'); if (h) h.textContent = 'Saída de ' + f4(-delta) + ' — lotes de onde sai'; }
      el('mea_qtd').value = String(-delta);
      distribuirFIFO(-delta); window.mesAjusteSomar();
    } else {
      if (box.dataset.modo !== 'entrada') { box.dataset.modo = 'entrada'; box.innerHTML = '<h4 style="margin:12px 0 4px">Entrada de ' + f4(delta) + ' em lote novo</h4><div class="mea-grid">' + camposEntrada(cod) + '</div>'; }
      else { var h2 = box.querySelector('h4'); if (h2) h2.textContent = 'Entrada de ' + f4(delta) + ' em lote novo'; }
    }
  };
  function lerDistribuicao() {
    var lotes = [], erro = '';
    document.querySelectorAll('#mea_form .mea-q').forEach(function (i) {
      var v = numDigitado(i.value);
      if (v === '') return;
      if (!isFinite(v) || v < 0) { erro = 'Quantidade inválida no lote ' + i.dataset.entrada + '.'; return; }
      if (v === 0) return;
      if (v > N(i.dataset.saldo) + 1e-9) { erro = 'O lote ' + i.dataset.entrada + ' tem só ' + f4(N(i.dataset.saldo)) + ' de saldo.'; return; }
      lotes.push({ Entrada: i.dataset.entrada, Quantidade: arred(v, 6) });
    });
    return { lotes: lotes, erro: erro };
  }
  function msg(h, t) { var b = el('mea_msg'); if (b) b.innerHTML = '<div class="mea-msg ' + (t || 'erro') + '">' + h + '</div>'; }
  window.mesAjusteRegistrar = function () {
    normalizarAjustes();
    var a = API(); if (!a) return alert('Módulo de estoque indisponível.');
    var d = D(), cod = window.__meaMat, tipo = window.__meaTipo || 'SAIDA';
    if (!cod) return msg('Selecione o material.');
    var m = material(cod); if (!m) return msg('Material não encontrado.');
    var motivo = val('mea_motivo'), obs = txt(val('mea_obs')), proj = val('mea_proj'), opRef = txt(val('mea_op')), teste = val('mea_teste');
    if (!motivo) return msg('Informe o motivo.');
    if (motivo === 'Outro' && !obs) return msg('Descreva o motivo na observação.');
    if (tipo === 'BAIXA_TECNICA' && !proj && A(d.projetos).length) return msg('Informe o projeto da baixa técnica.');
    if (opRef && !A(d.op).some(function (o) { return String(o.CodOP) === opRef; })) return msg('OP de referência não encontrada: ' + esc(opRef) + '.');
    var r = resumoDoMaterial(cod) || { SaldoFisico: 0 }, saldoAntes = arred(N(r.SaldoFisico), 6);
    var sentido, qtd, lotes = [], entradaNova = null;
    var modoCorr = tipo === 'CORRECAO_SALDO' ? ((el('mea_corr') || {}).dataset || {}).modo : '';
    if (tipo === 'CORRECAO_SALDO') {
      var c = numDigitado(val('mea_contado'));
      if (c === '' || !isFinite(c) || c < 0) return msg('Informe o saldo contado (número maior ou igual a zero).');
      var delta = arred(c - saldoAntes, 6);
      if (Math.abs(delta) < 1e-9) return msg('O saldo contado é igual ao saldo do sistema. Nada a ajustar.', 'alerta');
      sentido = delta < 0 ? 'SAIDA' : 'ENTRADA'; qtd = Math.abs(delta);
      if ((sentido === 'SAIDA' && modoCorr !== 'saida') || (sentido === 'ENTRADA' && modoCorr !== 'entrada')) window.mesAjusteCorrecao();
    } else {
      sentido = TIPOS[tipo].sentido;
      qtd = numDigitado(val('mea_qtd'));
      if (qtd === '' || !isFinite(qtd) || qtd <= 0) return msg('Informe uma quantidade maior que zero.');
      qtd = arred(qtd, 6);
    }
    var custos = {}; lotesDoMaterial(cod).forEach(function (l) { custos[l.Entrada] = l; });
    if (sentido === 'SAIDA') {
      var dist = lerDistribuicao(); if (dist.erro) return msg(dist.erro);
      var soma = arred(dist.lotes.reduce(function (s, l) { return s + l.Quantidade; }, 0), 6);
      if (Math.abs(soma - qtd) > 1e-9) return msg('A soma retirada dos lotes (' + f4(soma) + ') precisa ser igual à quantidade (' + f4(qtd) + ').');
      lotes = dist.lotes.map(function (l) { var x = custos[l.Entrada] || {}; return { Entrada: l.Entrada, Lote: x.Lote || '', Localizacao: x.Localizacao || '', Quantidade: l.Quantidade, CustoUnitario: x.CustoUnitario || 0, Valor: arred(l.Quantidade * (x.CustoUnitario || 0), 6), NovoLote: false }; });
    } else {
      var custo = numDigitado(val('mea_custo')); if (custo === '') custo = 0;
      if (!isFinite(custo) || custo < 0) return msg('Custo unitário inválido.');
      entradaNova = { lote: txt(val('mea_lote')) || ('AJ-' + Date.now()), local: txt(val('mea_local')), custo: arred(custo, 6) };
    }
    var id = typeof nextByPrefix === 'function' ? nextByPrefix(d.estoque_ajustes, 'IdAjuste', 'AJ') : 'AJ' + Date.now();
    var resumoTxt = TIPOS[tipo].nome + ' — ' + cod + ' ' + (m.DescricaoMateriais || '') + '\n\n' + (sentido === 'SAIDA' ? 'Saída' : 'Entrada') + ': ' + f4(qtd) + ' ' + (m.UM || '') +
      '\nSaldo geral: ' + f4(saldoAntes) + ' → ' + f4(arred(saldoAntes + (sentido === 'SAIDA' ? -qtd : qtd), 6)) + '\nMotivo: ' + motivo + (proj ? '\nProjeto: ' + proj : '') +
      (lotes.length ? '\n\nLotes: ' + lotes.map(function (l) { return l.Entrada + ' (' + (l.Lote || '-') + '): ' + f4(l.Quantidade); }).join('; ') : (entradaNova ? '\n\nNovo lote: ' + entradaNova.lote + (entradaNova.local ? ' · ' + entradaNova.local : '') : '')) +
      '\n\nO ajuste pode ser estornado pelo histórico.';
    if (!confirm('Registrar o ajuste ' + id + '?\n\n' + resumoTxt)) return;
    try { a.normalizar(); } catch (e) { }
    var bk = false; try { bk = a.backup(); } catch (e) { }
    var ps = typeof v4047ProjectSnapshot === 'function' ? v4047ProjectSnapshot(proj) : { CodigoProjeto: proj, Projeto: nomeProjeto(proj) };
    if (entradaNova) {
      var eid = typeof nextByPrefix === 'function' ? nextByPrefix(d.entradas, 'Entrada', 'EN') : 'EN' + Date.now();
      var e = Object.assign({ 'Entrada': eid, 'CódigoMaterial': m['CódigoMaterial'], 'DescricaoMaterial': m.DescricaoMateriais || '', 'QtdAdquirida': String(qtd), 'UnidadeMedida': m.UM || '',
        'Custo R$': String(arred(qtd * entradaNova.custo, 6)), 'ValorUnitario (R$/UM)': String(entradaNova.custo), 'Lote': entradaNova.lote, 'NomeFornecedor': 'AJUSTE DE ESTOQUE', 'CNPJFornecedor': '', 'N° NF': '' },
        proj ? ps : {}, { MaterialQualificado: 'Não', ArquivosQualificacao: [], DataCadatro: hoje(), OrigemEntrada: 'AJUSTE_MANUAL', AjusteID: id,
          EspecificacaoItem: 'Entrada criada pelo ajuste de estoque ' + id + ' — ' + motivo + (obs ? ' — ' + obs : '') });
      if (entradaNova.local) { e.Localizacao = entradaNova.local; e.LocalizacaoHistorico = [{ Data: agora(), Local: entradaNova.local, Usuario: usuario(), Origem: 'Ajuste de estoque ' + id }]; }
      d.entradas.unshift(e);
      lotes = [{ Entrada: eid, Lote: e.Lote, Localizacao: e.Localizacao || '', Quantidade: qtd, CustoUnitario: entradaNova.custo, Valor: arred(qtd * entradaNova.custo, 6), NovoLote: true }];
    }
    var aj = { IdAjuste: id, Data: agora(), Usuario: usuario(), Tipo: tipo, Sentido: sentido, CodigoMaterial: m['CódigoMaterial'], Material: m.DescricaoMateriais || '', UM: m.UM || '',
      Quantidade: qtd, Motivo: motivo, CodProjeto: proj || '', Projeto: proj ? (ps.Projeto || nomeProjeto(proj)) : '', OPReferencia: opRef, TesteReferencia: teste || '', TesteDescricao: teste ? descTeste(teste) : '',
      Observacao: obs, Lotes: lotes, Valor: arred(lotes.reduce(function (s, l) { return s + N(l.Valor); }, 0), 6), SaldoGeralAntes: saldoAntes,
      SaldoGeralDepois: arred(saldoAntes + (sentido === 'SAIDA' ? -qtd : qtd), 6), Status: 'ATIVO', BackupAntes: bk ? 'Sim' : 'Não' };
    d.estoque_ajustes.unshift(aj);
    salvar();
    var depois = resumoDoMaterial(cod) || { SaldoFisico: 0 };
    ajusteModulo();
    msg('Ajuste <b>' + esc(id) + '</b> registrado. Saldo geral de ' + esc(cod) + ': ' + f4(saldoAntes) + ' → <b>' + f4(depois.SaldoFisico) + '</b> ' + esc(m.UM || '') + '.' + (bk ? '' : ' <span class="muted">(cópia de segurança automática não foi criada)</span>'), 'ok');
  };
  function usosDaEntrada(eid, ignorarAjuste) {
    var d = D(), u = [];
    if (A(d.consumos_materiais).some(function (c) { return c && c.Entrada === eid; }) || A(d.op_materiais).some(function (x) { return x && x.EntradaMaterial === eid; })) u.push('consumo apontado em OP');
    if (A(d.perdas).some(function (p) { return p && p.EntradaMaterial === eid; })) u.push('perda apontada');
    if (A(d.estoque_ajustes).some(function (a) { return a && a.IdAjuste !== ignorarAjuste && a.Status !== 'ESTORNADO' && A(a.Lotes).some(function (l) { return l && l.Entrada === eid; }); })) u.push('outro ajuste de estoque');
    var e = A(d.entradas).find(function (x) { return x.Entrada === eid; });
    if (e && A(e.AjustesInventario).length) u.push('inventário aplicado');
    return u;
  }
  window.mesAjusteEstornar = function (id) {
    var d = D(), aj = A(d.estoque_ajustes).find(function (x) { return x.IdAjuste === id; });
    if (!aj || aj.Status === 'ESTORNADO') return;
    var novos = A(aj.Lotes).filter(function (l) { return l.NovoLote; });
    var bloqueios = [];
    novos.forEach(function (l) { var u = usosDaEntrada(l.Entrada, id); if (u.length) bloqueios.push(l.Entrada + ': ' + u.join(', ')); });
    if (bloqueios.length) return alert('Não é possível estornar o ajuste ' + id + ': o lote criado por ele já foi movimentado.\n\n' + bloqueios.join('\n') + '\n\nEstorne/exclua esses movimentos antes, ou faça um novo ajuste de saída.');
    var motivo = prompt('Estornar o ajuste ' + id + ' (' + (TIPOS[aj.Tipo] || {}).nome + ', ' + f4(aj.Quantidade) + ' ' + aj.UM + ' de ' + aj.CodigoMaterial + ')?\n\n' +
      (aj.Sentido === 'SAIDA' ? 'A quantidade volta para os lotes de origem.' : 'O lote criado pelo ajuste é removido das entradas.') + '\n\nInforme o motivo do estorno:', '');
    if (motivo === null) return;
    if (!txt(motivo)) return alert('Informe o motivo do estorno.');
    try { var a = API(); if (a) a.backup(); } catch (e) { }
    novos.forEach(function (l) { d.entradas = A(d.entradas).filter(function (e) { return e.Entrada !== l.Entrada; }); });
    aj.Status = 'ESTORNADO'; aj.EstornoData = agora(); aj.EstornoUsuario = usuario(); aj.EstornoMotivo = txt(motivo);
    salvar();
    if (current === 'ajuste_estoque') { ajusteModulo(); msg('Ajuste <b>' + esc(id) + '</b> estornado.', 'ok'); }
  };
  window.mesAjusteDetalhe = function (id) {
    var b = el('mea_det_' + id); if (!b) return;
    if (b.innerHTML) { b.innerHTML = ''; return; }
    var aj = A(D().estoque_ajustes).find(function (x) { return x.IdAjuste === id; }); if (!aj) return;
    b.innerHTML = '<div style="padding:6px 10px;background:#f7fafc"><div class="table-wrap"><table><thead><tr><th>Entrada</th><th>Lote</th><th>Localização</th><th>Quantidade</th><th>Custo unit.</th><th>Valor</th><th>Novo lote</th></tr></thead><tbody>' +
      A(aj.Lotes).map(function (l) { return '<tr><td>' + esc(l.Entrada) + '</td><td>' + esc(l.Lote) + '</td><td>' + esc(l.Localizacao || '—') + '</td><td class="mea-num">' + f4(l.Quantidade) + ' ' + esc(aj.UM) + '</td><td class="mea-num">' + reais(l.CustoUnitario) + '</td><td class="mea-num">' + reais(l.Valor) + '</td><td>' + (l.NovoLote ? 'Sim' : 'Não') + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="muted" style="margin:4px 0">Saldo geral: ' + f4(aj.SaldoGeralAntes) + ' → ' + f4(aj.SaldoGeralDepois) + ' ' + esc(aj.UM) + (aj.Observacao ? ' · Obs.: ' + esc(aj.Observacao) : '') + (aj.TesteDescricao ? ' · Teste: ' + esc(aj.TesteDescricao) : '') +
      (aj.Status === 'ESTORNADO' ? '<br>Estornado em ' + esc(aj.EstornoData) + ' por ' + esc(aj.EstornoUsuario) + ': ' + esc(aj.EstornoMotivo) : '') + '</p></div>';
  };
  function historicoFiltrado() {
    var q = String(val('mea_h_q')).toLowerCase(), t = val('mea_h_tipo'), s = val('mea_h_st');
    return A((D() || {}).estoque_ajustes).filter(function (a) { return (!t || a.Tipo === t) && (!s || a.Status === s) && (!q || JSON.stringify(a).toLowerCase().indexOf(q) >= 0); });
  }
  function renderHistorico() {
    var b = el('mea_hist'); if (!b) return;
    var rows = historicoFiltrado();
    b.innerHTML = rows.length ? '<div class="table-wrap"><table><thead><tr><th>Ajuste</th><th>Data</th><th>Usuário</th><th>Tipo</th><th>Material</th><th>Quantidade</th><th>Lotes</th><th>Motivo</th><th>Projeto</th><th>Referência</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>' +
      rows.map(function (a) {
        var est = a.Status === 'ESTORNADO';
        return '<tr class="' + (est ? 'mea-est-row' : '') + '"><td><b>' + esc(a.IdAjuste) + '</b></td><td>' + esc(a.Data) + '</td><td>' + esc(a.Usuario) + '</td><td>' + esc((TIPOS[a.Tipo] || {}).nome || a.Tipo) + '</td>' +
          '<td>' + esc(a.CodigoMaterial) + ' — ' + esc(a.Material) + '</td><td class="mea-num' + (est ? ' mea-est' : '') + '"><b>' + (a.Sentido === 'SAIDA' ? '−' : '+') + f4(a.Quantidade) + '</b> ' + esc(a.UM) + '</td>' +
          '<td>' + A(a.Lotes).map(function (l) { return esc(l.Entrada + (l.Lote ? ' (' + l.Lote + ')' : '')); }).join('<br>') + '</td><td>' + esc(a.Motivo) + '</td><td>' + esc(a.CodProjeto ? a.CodProjeto + ' — ' + (a.Projeto || '') : '—') + '</td>' +
          '<td>' + esc([a.OPReferencia ? 'OP ' + a.OPReferencia : '', a.TesteDescricao ? 'Teste ' + a.TesteDescricao : ''].filter(Boolean).join(' · ') || '—') + '</td><td class="mea-num">' + reais(a.Valor) + '</td>' +
          '<td>' + (est ? '<span class="mbc-tag" style="background:#eceff3;color:#52606d;border-color:#c5cdd6" title="' + esc((a.EstornoData || '') + ' · ' + (a.EstornoUsuario || '') + ' · ' + (a.EstornoMotivo || '')) + '">ESTORNADO</span>' : tag('ATIVO')) + '</td><td style="white-space:nowrap"><button class="mini secondary" onclick="mesAjusteDetalhe(\'' + jsStr(a.IdAjuste) + '\')">Detalhes</button> ' +
          (est ? '' : '<button class="mini" onclick="mesAjusteEstornar(\'' + jsStr(a.IdAjuste) + '\')">Estornar</button>') + '</td></tr>' +
          '<tr><td colspan="13" style="padding:0;border:0"><div id="mea_det_' + esc(a.IdAjuste) + '"></div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">Nenhum ajuste' + (A((D() || {}).estoque_ajustes).length ? ' com esses filtros' : ' registrado ainda') + '.</p>';
  }
  window.mesAjusteHistorico = renderHistorico;
  window.mesAjusteExcel = function () {
    var rows = [];
    historicoFiltrado().forEach(function (a) {
      A(a.Lotes).forEach(function (l) {
        rows.push({ Ajuste: a.IdAjuste, Data: a.Data, Usuario: a.Usuario, Tipo: (TIPOS[a.Tipo] || {}).nome || a.Tipo, Sentido: a.Sentido, CodigoMaterial: a.CodigoMaterial, Material: a.Material, UM: a.UM,
          Entrada: l.Entrada, Lote: l.Lote, Localizacao: l.Localizacao || '', Quantidade: a.Sentido === 'SAIDA' ? -N(l.Quantidade) : N(l.Quantidade), CustoUnitario: l.CustoUnitario, Valor: a.Sentido === 'SAIDA' ? -N(l.Valor) : N(l.Valor), NovoLote: l.NovoLote ? 'Sim' : 'Não',
          Motivo: a.Motivo, CodProjeto: a.CodProjeto, Projeto: a.Projeto, OPReferencia: a.OPReferencia, Teste: a.TesteDescricao || '', Observacao: a.Observacao, SaldoGeralAntes: a.SaldoGeralAntes, SaldoGeralDepois: a.SaldoGeralDepois,
          Status: a.Status, EstornoData: a.EstornoData || '', EstornoUsuario: a.EstornoUsuario || '', EstornoMotivo: a.EstornoMotivo || '' });
      });
    });
    if (!rows.length) return alert('Nenhum ajuste para exportar.');
    if (typeof downloadAuditExcelV3819 === 'function') return downloadAuditExcelV3819('MES_LION_ajustes_estoque.xls', 'Ajustes de estoque', [{ title: 'Ajustes de estoque (uma linha por lote)', rows: rows }]);
    if (typeof exportExcel === 'function') return exportExcel(rows, 'MES_LION_ajustes_estoque');
    alert('Exportador Excel não disponível nesta instalação.');
  };

  /* ---------------------------------------------------------------------
     5) CALENDÁRIO DE TESTES DE CARACTERIZAÇÃO — CARTÕES KANBAN ARRASTÁVEIS (SÓ NESSA TELA)
     O arrasto usa o tipo próprio "application/x-mes-teste": o soltar do Calendário de Produção (pcpDropDiaV2314) lê só
     índices de operação, então um teste nunca é confundido com uma OP.
     --------------------------------------------------------------------- */
  (function () {
    var carAnt = window.mesCaracterizacao;
    if (typeof carAnt !== 'function') return;
    var PAL = [['#e0efff', '#2269a8'], ['#dff5e7', '#237a45'], ['#fde3ee', '#a53d69'], ['#ffe7c7', '#a95d00'], ['#eee4ff', '#7045a8'], ['#fff4bf', '#8a6a00'], ['#dff4f3', '#25736f'], ['#f2e7dc', '#82583b']];
    function hash(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); }
    function codeRec(r) { return String(r['Código Equipamento'] || r.CodEquipamento || r.Codigo || r.Recurso || ''); }
    function nomeRec(c) { var r = A(D().cad_recursos).concat(A(D().recursos)).find(function (x) { return codeRec(x) === String(c); }); return (r && r.Equipamento) || c; }
    function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function minutos(h) { var m = String(h || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }
    function diaBloqueado(date) {
      if (typeof window.mesValidarAlocacao !== 'function') { var dw = new Date(date + 'T12:00').getDay(); return dw === 0 || dw === 6; }
      var ant = window.__pcpLineV2314; window.__pcpLineV2314 = 'Caracterizacao';
      try { return /Dia não útil/i.test(window.mesValidarAlocacao({ Recurso: '__MES_TESTE__', Segmentos: [] }, new Date(date + 'T08:00'), new Date(date + 'T08:01')) || ''); }
      finally { window.__pcpLineV2314 = ant; }
    }
    function validarMover(x, date) {
      var a = new Date(date + 'T' + (x.Inicio || '08:00')), b = new Date(date + 'T' + (x.Fim || '09:00'));
      if (typeof window.mesValidarAlocacao === 'function') {
        var ant = window.__pcpLineV2314; window.__pcpLineV2314 = 'Caracterizacao';
        try { var e = window.mesValidarAlocacao({ Recurso: x.Recurso, Segmentos: [] }, a, b); if (e) return e; } finally { window.__pcpLineV2314 = ant; }
      }
      var ini = minutos(x.Inicio), fim = minutos(x.Fim);
      var choque = A(D().pcp_caracterizacao).find(function (y) { return y !== x && String(y.Recurso) === String(x.Recurso) && y.Data === date && minutos(y.Inicio) < fim && minutos(y.Fim) > ini; });
      if (choque) return 'O equipamento ' + nomeRec(x.Recurso) + ' já tem o teste "' + (choque.Descricao || 'Teste') + '" das ' + choque.Inicio + ' às ' + choque.Fim + ' nesse dia.';
      return '';
    }
    function cartao(x) {
      var p = PAL[hash(x.Recurso) % PAL.length], n = A(x.Calendarios).length;
      return '<article class="mes-car-card" draggable="true" data-id="' + esc(x.Id) + '" ondragstart="mesCarDrag(event,\'' + jsStr(x.Id) + '\')" ondragend="mesCarDragFim()" ondblclick="mesEditTest(\'' + jsStr(x.Id) + '\')" title="Arraste para outro dia · duplo clique para editar e compartilhar" style="background:' + p[0] + ';border-color:' + p[1] + ';border-left-color:' + p[1] + '">' +
        '<b style="color:' + p[1] + '">' + esc(x.Descricao || 'Teste') + '</b><small class="mes-car-eq" style="color:' + p[1] + ';border-color:' + p[1] + '">' + esc(nomeRec(x.Recurso)) + '</small>' +
        '<small>' + esc(x.Inicio || '') + '–' + esc(x.Fim || '') + (n ? ' · ' + n + ' calendário(s) adicional(is)' : '') + '</small></article>';
    }
    function css() {
      if (el('mes-car-kanban-css')) return;
      var st = document.createElement('style'); st.id = 'mes-car-kanban-css';
      st.textContent = [
        '.mes-car-week,.mes-car-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}',
        '.mes-car-week b{text-align:center;font-size:12px;color:#0b3a5c}',
        '.mes-car-day{min-height:118px;min-width:0;border:1px solid #bdcedb;border-radius:6px;background:#fff;display:flex;flex-direction:column}',
        '.mes-car-day header{display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid #e3ebf2;font-size:11px}',
        '.mes-car-day header b{font-size:13px;color:#0b3a5c}.mes-car-day header span{color:#52606d}.mes-car-day header em{margin-left:auto;font-style:normal;background:#eef3f8;border-radius:999px;padding:0 6px;font-size:10px}',
        '.mes-car-day .mes-car-body{flex:1;padding:4px;display:flex;flex-direction:column;gap:4px}',
        '.mes-car-day.outside{background:#f2f4f6;border-style:dashed}',
        '.mes-car-day.blocked{background:repeating-linear-gradient(135deg,#f8f1f1,#f8f1f1 6px,#fbf7f7 6px,#fbf7f7 12px)}',
        '.mes-car-day.blocked header i{color:#a00e1c;font-style:normal;font-weight:700;font-size:9px}',
        '.mes-car-day.today{box-shadow:inset 0 0 0 2px #69ad2c}',
        '.mes-car-day.over{outline:2px dashed #1268a8;background:#eef6ff}',
        '.mes-car-day.over.blocked{outline-color:#a00e1c}',
        '.mes-car-day em.livre{color:#9aa5b1;font-size:10px;font-style:normal;margin:auto}',
        '.mes-car-card{box-sizing:border-box;width:100%;border:1px solid;border-left:4px solid;border-radius:4px;padding:4px 5px;cursor:grab;font-size:10px;overflow:hidden;user-select:none}',
        '.mes-car-card:active{cursor:grabbing}.mes-car-card.dragging{opacity:.45}',
        '.mes-car-card b,.mes-car-card small{display:block;overflow-wrap:anywhere}',
        '.mes-car-card small{font-size:9px;color:#334155}',
        '.mes-car-card .mes-car-eq{display:inline-block;margin:2px 0;padding:1px 6px;border:1px solid;border-radius:999px;background:#fff;font-weight:700}',
        '@media(hover:hover){.mes-car-card:hover{box-shadow:0 1px 4px rgba(0,0,0,.15)}}'
      ].join('\n');
      document.head.appendChild(st);
    }
    window.mesCaracterizacao = function () {
      var r = carAnt.apply(this, arguments);
      try {
        var grid = document.querySelector('#content .mes-test-grid'); if (!grid) return r;
        css();
        if (!Array.isArray(D().pcp_caracterizacao)) D().pcp_caracterizacao = [];
        var mon = document.querySelector('#content input[type="month"]'), m = (mon && mon.value) || window.__mesCarMonth || iso(new Date()).slice(0, 7);
        var yy = Number(m.slice(0, 4)), mm = Number(m.slice(5, 7)), offset = new Date(yy, mm - 1, 1).getDay(), dias = new Date(yy, mm, 0).getDate(), hojeIso = iso(new Date());
        var nomes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'], cells = [];
        for (var z = 0; z < offset; z++) cells.push('<div class="mes-car-day outside"></div>');
        for (var n = 1; n <= dias; n++) {
          var date = m + '-' + String(n).padStart(2, '0'), bloq = diaBloqueado(date);
          var ts = D().pcp_caracterizacao.filter(function (x) { return x.Data === date; }).sort(function (a, b) { return String(a.Inicio).localeCompare(String(b.Inicio)); });
          cells.push('<section class="mes-car-day' + (bloq ? ' blocked' : '') + (date === hojeIso ? ' today' : '') + '" data-date="' + date + '" ondragover="mesCarOver(event,this)" ondragleave="this.classList.remove(\'over\')" ondrop="mesCarDrop(event,\'' + date + '\',this)">' +
            '<header><b>' + n + '</b><span>' + nomes[new Date(yy, mm - 1, n).getDay()] + '</span>' + (bloq ? '<i>INDISPONÍVEL</i>' : '') + (ts.length ? '<em>' + ts.length + '</em>' : '') + '</header>' +
            '<div class="mes-car-body">' + (ts.map(cartao).join('') || '<em class="livre">Livre</em>') + '</div></section>');
        }
        while (cells.length % 7) cells.push('<div class="mes-car-day outside"></div>');
        grid.className = 'mes-car-grid';
        grid.innerHTML = cells.join('');
        var wk = document.querySelector('#content .mes-test-week'); if (wk) wk.className = 'mes-car-week';
        var sub = el('subtitle'); if (sub) sub.textContent = 'Kanban independente de OP: arraste o cartão para outro dia (mantém o horário); duplo clique para editar e compartilhar.';
      } catch (e) { console.warn('MES LION: Kanban de caracterização', e); }
      return r;
    };
    var arrastando = null;
    window.mesCarDrag = function (ev, id) {
      arrastando = id;
      try { ev.dataTransfer.setData('application/x-mes-teste', id); ev.dataTransfer.setData('text/plain', 'TESTE:' + id); ev.dataTransfer.effectAllowed = 'move'; } catch (e) { }
      var c = ev.target && ev.target.closest ? ev.target.closest('.mes-car-card') : null; if (c) c.classList.add('dragging');
    };
    window.mesCarDragFim = function () { arrastando = null; document.querySelectorAll('.mes-car-card.dragging,.mes-car-day.over').forEach(function (x) { x.classList.remove('dragging'); x.classList.remove('over'); }); };
    window.mesCarOver = function (ev, cell) { ev.preventDefault(); try { ev.dataTransfer.dropEffect = 'move'; } catch (e) { } cell.classList.add('over'); };
    window.mesCarDrop = function (ev, date, cell) {
      ev.preventDefault(); if (cell) cell.classList.remove('over');
      var id = ''; try { id = ev.dataTransfer.getData('application/x-mes-teste'); } catch (e) { }
      if (!id) { try { var t = ev.dataTransfer.getData('text/plain'); if (/^TESTE:/.test(t)) id = t.slice(6); } catch (e) { } }
      if (!id) id = arrastando || '';
      window.mesCarDragFim();
      if (!id) return;
      window.mesMoverTeste(id, date);
    };
    window.mesMoverTeste = function (id, date) {
      var x = A(D().pcp_caracterizacao).find(function (r) { return String(r.Id) === String(id); });
      if (!x || x.Data === date) return false;
      var erro = validarMover(x, date);
      if (erro) { alert('Não é possível mover o teste para ' + date.split('-').reverse().join('/') + ':\n\n' + erro); return false; }
      x.HistoricoDatas = A(x.HistoricoDatas).concat([{ De: x.Data, Para: date, Data: agora(), Usuario: usuario() }]);
      x.Data = date;
      salvar();
      window.mesCaracterizacao();
      return true;
    };
  })();

  /* ---------------------------------------------------------------------
     6) MENU, ROTAS E INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  function ajustarMenu() {
    try {
      var mods = (typeof modules !== 'undefined') ? modules : null, grupos = (typeof moduleGroups !== 'undefined') ? moduleGroups : null;
      if (mods && !mods.some(function (m) { return m[0] === 'ajuste_estoque'; })) mods.push(['ajuste_estoque', 'Ajuste de Estoque']);
      if (grupos) {
        var mat = grupos.find(function (g) { return g.title === 'Materiais'; });
        if (mat && mat.items.indexOf('ajuste_estoque') < 0) {
          var pos = mat.items.indexOf('inventario_estoque');
          mat.items.splice(pos >= 0 ? pos + 1 : mat.items.length, 0, 'ajuste_estoque');
        }
      }
    } catch (e) { console.warn('MES LION: menu ajuste de estoque', e); }
  }
  function refazerMenu() {
    try { var app = el('app'); if (app && !app.classList.contains('hidden') && typeof renderNav === 'function') { var at = current; renderNav(); marcarNav(at); } } catch (e) { }
  }
  ajustarMenu();
  /* atalho para o Ajuste de Estoque nas telas de Estoque e Inventário */
  function botaoAjuste() {
    try {
      var tb = document.querySelector('#content .toolbar');
      if (tb && !tb.querySelector('.mea-btn-ajuste')) tb.insertAdjacentHTML('beforeend', '<button class="secondary mea-btn-ajuste" onclick="render(\'ajuste_estoque\')">Ajuste de Estoque</button>');
    } catch (e) { }
  }
  (function () {
    var estAnt = window.estoqueModuleV4047;
    if (typeof estAnt !== 'function') return;
    window.estoqueModuleV4047 = function () { var r = estAnt.apply(this, arguments); botaoAjuste(); return r; };
  })();
  (function () {
    var renderAnt = window.render;
    if (typeof renderAnt !== 'function') return;
    window.render = function (k) {
      if (k === 'ajuste_estoque') return ajusteModulo();
      var r = renderAnt.apply(this, arguments);
      if (k === 'inventario_estoque') botaoAjuste();
      return r;
    };
  })();
  (function () {
    var bootAnt = window.boot;
    if (typeof bootAnt !== 'function') return;
    window.boot = function () { normalizarAjustes(); ajustarMenu(); var r = bootAnt.apply(this, arguments); refazerMenu(); return r; };
  })();
  normalizarAjustes();
  refazerMenu();
  window.MES_ADAPTADOR_ESTOQUE_AJUSTES = VERSAO;
})();
