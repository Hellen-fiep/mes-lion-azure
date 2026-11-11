/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR 1.4.0: APONTAMENTO POR MÁQUINA, PIs COMO INSUMO, ETIQUETAS E ESTOQUE DE PI/PA
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, DEPOIS de adaptador_estoque_ajustes.js.
   Não altera os arquivos do frontend (index.html, js\, style.css): cada tela é estendida por cima da versão já validada.
     1) Motivos de perda: cadastro de categorias e motivos (sem duplicidade nem erro de digitação) usado como lista
        suspensa no Registro de Perdas; importação dos motivos já digitados.
     2) Tempo por máquina: no Apontamento de Produção cada máquina da etapa tem o seu início/fim (ou intervalo informado);
        o tempo real finalizado substitui o planejado daquela máquina no cálculo de energia e de mão de obra.
     3) Roteiro: em cada operação, quais PIs entram (PI produzido em operação anterior, ou PI de fora do roteiro); a tela
        Estrutura do Produto mostra o fluxo em níveis (PA ← PI ← PI ...) montado a partir do roteiro.
     4) OPs: o PI configurado no roteiro entra como insumo da OP consumidora (linha "PI intermediário"); no apontamento o
        consumo do PI é lançado pela etiqueta/lote (leitura do código), com devolução e perda na própria etapa; o
        Registro de Perdas pede a origem da perda (dentro do consumo apontado ou retirada adicional) e o lote/etiqueta.
     5) Etiquetas de PI/PA: ao apontar produção em "un", escolher uma etiqueta por unidade, aglutinar ou N unidades por
        etiqueta (demais unidades: uma etiqueta); impressão com código de barras Code 128.
     6) Estoque de PI e PA prontos: saldo por produto, lote (OP) e etiqueta, reservado para OPs abertas, baixa/estorno,
        rastreio para trás (insumos) e para frente (onde foi usado), conferência das regras.
     7) Regras de cálculo: QtdProduzida = soma dos apontamentos (o lançamento contava o último duas vezes); perda de PI
        da própria família e perda dentro do consumo apontado não somam custo/CO₂ de novo; baixa automática do PI não
        apontado quando a OP consumidora é encerrada.
     1.6.1) OP encerrada ou cancelada: só o consumo real entra no custo e no CO₂ (o material planejado sem consumo
        apontado fica fora, com valor 0 na auditoria) e o encerramento avisa antes; na ACV o consumo de um material conta
        uma vez por OP. Custo por OP (custosOP): energia + MOD das etapas desta OP na auditoria de custo (antes vinham do
        primeiro cadastro de recurso com o mesmo código ou processo) e perdas da OP no total efetivo.
   ===================================================================== */
(function () {
  'use strict';
  var VERSAO = '1.6.1';

  /* ---------------------------------------------------------------------
     0) UTILITÁRIOS
     --------------------------------------------------------------------- */
  function A(v) { return Array.isArray(v) ? v : []; }
  function D() { return (typeof data === 'object' && data) ? data : null; }
  function N(v) {
    if (typeof num === 'function') return num(v);
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).trim();
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(',', '.');
    var n = Number(s.replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  /* número digitado: aceita vírgula; '' = vazio; NaN = inválido */
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
  function norm(v) { return txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function arred(v, c) { var f = Math.pow(10, c == null ? 6 : c); return Math.round((Number(v) || 0) * f) / f; }
  function f4(v) { var n = typeof v === 'number' ? v : N(v); return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }); }
  function f2(v) { var n = typeof v === 'number' ? v : N(v); return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function reais(v) { return (typeof money === 'function') ? money(v) : 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function hoje() { return new Date().toLocaleDateString('pt-BR'); }
  function agora() { return new Date().toLocaleString('pt-BR'); }
  function horaAgora() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function dataBR(d) { return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function horaHM(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function usuario() { try { return (window.MES_CURRENT_USER && (MES_CURRENT_USER.username || MES_CURRENT_USER.fullName)) || 'admin'; } catch (e) { return 'admin'; } }
  function idNovo(prefixo) { return prefixo + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(); }
  /* data dd/mm/aaaa (ou aaaa-mm-dd) + hora hh:mm -> Date */
  function parseDataHora(d, h) {
    var s = txt(d), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/), y, mo, dd;
    if (m) { dd = +m[1]; mo = +m[2]; y = +m[3]; }
    else { m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return null; y = +m[1]; mo = +m[2]; dd = +m[3]; }
    var hh = 0, mi = 0;
    if (h !== undefined) {
      var t = txt(h).match(/^(\d{1,2}):(\d{2})$/);
      if (!t) return null;
      hh = +t[1]; mi = +t[2];
      if (hh > 23 || mi > 59) return null;
    }
    var r = new Date(y, mo - 1, dd, hh, mi, 0, 0);
    if (r.getFullYear() !== y || r.getMonth() !== mo - 1 || r.getDate() !== dd) return null;
    return r;
  }
  function dataValida(s) { return !!parseDataHora(s); }
  function horaValida(s) { return /^(\d{1,2}):(\d{2})$/.test(txt(s)) && !!parseDataHora('01/01/2000', s); }

  /* geração: muda a cada gravação (saveLocal) e a cada alteração deste adaptador; o livro do estoque de PI/PA é
     recalculado só quando ela muda */
  var geracao = 0;
  function mudou() { geracao++; }
  var gravando = false;
  function salvar() {
    mudou();
    try { if (typeof saveLocal === 'function') { gravando = true; saveLocal(); } } catch (e) { console.warn('MES LION 1.4: gravação', e); } finally { gravando = false; }
  }
  function setCurrent(k) { try { current = k; } catch (e) { } }
  function marcarNav(k) {
    try {
      document.body.classList.remove('dashboard-mode');
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      var b = el('nav_' + k); if (b) b.classList.add('active');
    } catch (e) { }
  }
  function cabecalho(t, s) { if (el('title')) el('title').textContent = t; if (el('subtitle')) el('subtitle').textContent = s || ''; }
  function aviso(id, msg, tipo) { var b = el(id); if (!b) return; b.className = 'mes14-msg ' + (tipo || 'ok'); b.innerHTML = msg; }
  function bip(ok) {
    try {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      var ctx = bip.ctx || (bip.ctx = new C()), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = ok ? 1250 : 330; g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + (ok ? 0.09 : 0.3));
    } catch (e) { }
  }
  function barcode(t, op) { return typeof window.mesBarcodeSvg === 'function' ? window.mesBarcodeSvg(t, op) : '<b>' + esc(t) + '</b>'; }
  function tag(s, cls) { return '<span class="mes14-tag ' + (cls || '') + '">' + esc(s) + '</span>'; }
  function th(cols) { return '<thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead>'; }
  function tabela(cols, linhas, vazio) {
    return '<div class="table-wrap"><table>' + th(cols) + '<tbody>' + (linhas.length ? linhas.join('') : '<tr><td colspan="' + cols.length + '" class="muted">' + esc(vazio || 'Nenhum registro.') + '</td></tr>') + '</tbody></table></div>';
  }
  function campoLeitura(id, rotulo, dica, fn) {
    return '<div class="mes14-scan"><label><span>▮▯▮ ' + esc(rotulo) + '</span><input id="' + id + '" autocomplete="off" spellcheck="false" placeholder="' + esc(dica) + '" ' +
      'onkeydown="if((event.key===\'Enter\'||event.key===\'Tab\')&&this.value.trim()){event.preventDefault();' + fn + '(this.value);}"></label>' +
      '<button class="secondary" onclick="' + fn + '(document.getElementById(\'' + id + '\').value)">Buscar</button><div id="' + id + '_msg" class="mes14-msg"></div></div>';
  }

  /* ---------------------------------------------------------------------
     ESTILO (classes mes14-*, sem mexer no style.css)
     --------------------------------------------------------------------- */
  function estilo() {
    if (el('mes14-estilo')) return;
    var st = document.createElement('style'); st.id = 'mes14-estilo';
    st.textContent = [
      '.mes14-card{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:14px 16px;margin:0 0 14px}',
      '.mes14-card h3{margin:0 0 6px;color:#004b87;font-size:15px}.mes14-card h4{margin:12px 0 6px;color:#0b3a5c;font-size:13px}',
      '.mes14-card>p.muted{margin:0 0 10px}',
      '.mes14-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:0 0 8px}',
      '.mes14-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;margin:0}',
      '.mes14-grid label>span{font-weight:700;color:#355566;font-size:11px}',
      '.mes14-grid input,.mes14-grid select,.mes14-grid textarea{padding:7px 8px;border:1px solid #c9d6e0;border-radius:7px;font-size:13px;min-width:0}',
      '.mes14-grid input[readonly]{background:#f3f6f9;color:#45606f}',
      '.mes14-grid .wide{grid-column:span 2}',
      '.mes14-actions{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 8px}',
      '.mes14-msg{font-size:12.5px;margin:4px 0}.mes14-msg:empty{display:none}',
      '.mes14-msg.ok{color:#245d0d}.mes14-msg.erro{color:#a00e1c;font-weight:700}.mes14-msg.alerta{color:#8a5a00}',
      '.mes14-tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#eef3f7;color:#0b3a5c;white-space:nowrap}',
      '.mes14-tag.ok{background:#e3f3d8;color:#245d0d}.mes14-tag.erro{background:#fde4e6;color:#a00e1c}.mes14-tag.alerta{background:#fff1d1;color:#7a5000}.mes14-tag.info{background:#e3eefa;color:#0b4a8a}.mes14-tag.pi{background:#efe7fb;color:#5b2a9a}.mes14-tag.pa{background:#e2f2ef;color:#0b6152}',
      '.mes14-num{text-align:right;white-space:nowrap}',
      '.mes14-scan{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;background:#f2f8ee;border:1px solid #cfe5c1;border-left:4px solid #69ad2c;border-radius:10px;padding:10px 12px;margin:0 0 12px}',
      '.mes14-scan label{display:flex;flex-direction:column;gap:4px;flex:1 1 300px;margin:0}',
      '.mes14-scan label span{font-size:11px;font-weight:700;color:#2f6b12}',
      '.mes14-scan input{font-size:15px;padding:9px 10px;border:2px solid #9fcd80;border-radius:8px;background:#fff;font-family:Consolas,monospace}',
      '.mes14-scan .mes14-msg{flex-basis:100%}',
      '.mes14-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 12px}',
      '.mes14-kpis div{background:#fff;border:1px solid #dbe5ec;border-radius:10px;padding:10px 12px}',
      '.mes14-kpis small{display:block;color:#5b7385;font-size:11px}.mes14-kpis b{font-size:19px;color:#0b3a5c}',
      '.mes14-tabs{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap}',
      '.mes14-tabs button{background:#eef3f7;color:#0b3a5c;border:1px solid #cfdbe5}.mes14-tabs button.on{background:#004b87;color:#fff;border-color:#004b87}',
      '.mes14-overlay{position:fixed;inset:0;background:rgba(10,30,50,.45);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px;overflow:auto}',
      '.mes14-dialog{background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.25);max-width:760px;width:100%;padding:18px 20px}',
      '.mes14-dialog h3{margin:0 0 6px;color:#004b87}.mes14-dialog .opcao{display:flex;gap:10px;align-items:flex-start;border:1px solid #dbe5ec;border-radius:10px;padding:10px 12px;margin:8px 0;cursor:pointer}',
      '.mes14-dialog .opcao input[type=radio]{width:18px!important;height:18px!important;margin:2px 0 0!important;flex:0 0 auto}',
      '.mes14-dialog .opcao b{display:block;color:#0b3a5c}.mes14-dialog .opcao small{color:#5b7385}',
      '.mes14-dialog .opcao.on{border-color:#004b87;background:#f2f7fc}',
      '.mes14-pi-in{border:1px dashed #b9a6dc;background:#faf7ff;border-radius:10px;padding:8px 10px;margin:8px 0}',
      '.mes14-pi-in-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:0 0 6px}.mes14-pi-in-head b{color:#5b2a9a}.mes14-pi-in-head span{color:#6b5a85;font-size:11.5px}',
      '.mes14-chip{display:inline-flex;gap:6px;align-items:center;background:#fff;border:1px solid #d6c8ef;border-radius:999px;padding:3px 6px 3px 10px;margin:2px 4px 2px 0;font-size:12px}',
      '.mes14-chip button{background:#fde4e6;color:#a00e1c;border:0;border-radius:999px;padding:1px 7px;cursor:pointer;font-weight:700}',
      '.mes14-pi-add{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}.mes14-pi-add select{padding:5px 6px;border:1px solid #c9d6e0;border-radius:6px;max-width:100%}',
      '.mes14-fluxo details{border-left:3px solid #d6c8ef;margin:4px 0 4px 10px;padding-left:8px}',
      '.mes14-fluxo summary{cursor:pointer;padding:4px 0;font-size:12.5px}.mes14-fluxo .mp{color:#45606f;font-size:11.5px;margin:2px 0 2px 18px}',
      '.mes14-fluxo .seta{color:#7a5a9e;font-size:11.5px;margin-left:6px}',
      '.mes14-trace ul{list-style:none;margin:0;padding-left:16px;border-left:2px solid #dbe5ec}.mes14-trace li{margin:4px 0}',
      '.mes14-trace .no{display:inline-block;background:#f7fafc;border:1px solid #e1e9ef;border-radius:8px;padding:4px 8px}',
      '.mes14-sel{width:16px!important;height:16px!important;min-width:0!important;margin:0!important;padding:0!important}',
      '.mes14-subtle{color:#5b7385;font-size:11.5px}td .mes14-subtle,th .mes14-subtle{font-size:inherit}',
      '.mes14-actions button:not(.mini),.mes14-scan button{background:#083f7a;color:#fff;border:0;border-radius:10px;padding:8px 13px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 3px 8px rgba(8,63,122,.12);font-family:inherit}',
      '.mes14-actions button.secondary:not(.mini){background:#eef4fb;color:#083f7a;border:1px solid #dbe6f1;box-shadow:none}',
      '.mes14-actions button.danger:not(.mini){background:#b42318!important;color:#fff!important}',
      '.mes14-actions button:disabled,.mes14-scan button:disabled{opacity:.45;cursor:not-allowed}',
      '.mes14-motivo-linha{display:flex;gap:6px;align-items:center;min-width:0}.mes14-motivo-linha select{flex:1 1 auto;min-width:0}.mes14-motivo-linha button{flex:0 0 auto;white-space:nowrap}',
      '.form-grid .mes14-loss-ajuda{grid-column:1/-1;display:block;margin-top:-2px}.mes14-loss-ajuda:empty{display:none!important}',
      '@media (max-width:760px){.mes14-grid .wide{grid-column:auto}}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function fecharDialogo() { var o = el('mes14_overlay'); if (o) o.remove(); }
  function abrirDialogo(html) {
    estilo(); fecharDialogo();
    var o = document.createElement('div'); o.id = 'mes14_overlay'; o.className = 'mes14-overlay';
    o.innerHTML = '<div class="mes14-dialog" role="dialog">' + html + '</div>';
    document.body.appendChild(o);
    return o;
  }
  window.mesFecharDialogo14 = fecharDialogo;

  /* ---------------------------------------------------------------------
     1) DADOS: COLEÇÕES NOVAS E ACESSO COMUM
     --------------------------------------------------------------------- */
  var COLECOES = ['perdas_motivos', 'apontamento_tempos', 'roteiro_pi_entradas', 'etiquetas_producao', 'estoque_pi_ajustes', 'op_pi_consumos', 'pi_lotes',
    'op', 'op_etapas', 'op_materiais', 'producao', 'perdas', 'roteiro', 'roteiro_etapas', 'roteiro_recursos', 'roteiro_materiais', 'estrutura'];
  function garantirColecoes() {
    var d = D(); if (!d) return;
    for (var i = 0; i < COLECOES.length; i++) { if (!Array.isArray(d[COLECOES[i]])) d[COLECOES[i]] = []; }
    if (!d.meta || typeof d.meta !== 'object') d.meta = {};
  }
  function camposTabelas() {
    try {
      if (typeof fields !== 'object' || !fields) return;
      if (!fields.perdas_motivos) fields.perdas_motivos = ['IdMotivo', 'Categoria', 'Motivo', 'Descricao', 'Ativo', 'CriadoEm', 'CriadoPor'];
      if (!fields.roteiro_pi_entradas) fields.roteiro_pi_entradas = ['IdEntradaPI', 'CodRoteiro', 'OrdemEtapa', 'Processo', 'CodigoPI', 'DescricaoPI', 'IdRecursoRoteiro', 'Equipamento', 'OrdemEtapaOrigem', 'Origem'];
      if (!fields.etiquetas_producao) fields.etiquetas_producao = ['IdEtiqueta', 'TipoProduto', 'CodigoProduto', 'DescricaoProduto', 'CodOP', 'NOP', 'IdLote', 'Quantidade', 'UM', 'Sequencia', 'TotalEtiquetas', 'Modo', 'DataProducao', 'Status'];
      if (!fields.estoque_pi_ajustes) fields.estoque_pi_ajustes = ['IdAjustePI', 'IdEtiqueta', 'IdLote', 'CodOP', 'CodigoProduto', 'Quantidade', 'UM', 'Motivo', 'Data', 'Usuario', 'Status'];
      if (Array.isArray(fields.apontamento_tempos)) {
        ['OrdemEtapa', 'CodEquipamento', 'Equipamento', 'DataFim', 'DuracaoMin', 'Origem'].forEach(function (c) { if (fields.apontamento_tempos.indexOf(c) < 0) fields.apontamento_tempos.push(c); });
      }
    } catch (e) { }
  }
  camposTabelas();

  function produto(cod) { var k = txt(cod); return A((D() || {}).estrutura).find(function (p) { return txt(p['Código']) === k; }) || null; }
  function descProduto(cod) { var p = produto(cod); return p ? (p['Descrição'] || '') : ''; }
  function ehPI(cod) { var p = produto(cod); return p ? String(p['Tipo Produto'] || '').toUpperCase() === 'PI' || (!p['Tipo Produto'] && /^PI/i.test(txt(cod))) : /^PI/i.test(txt(cod)); }
  function codProdutoOP(op) { return txt(op && (op.CodigoPI || op.ProdutoGerado || op.CodigoProduto || op.CodProduto || op.Produto)); }
  function tipoOP(op) {
    var t = String(op && op.TipoOP || '').toUpperCase();
    if (t === 'PI' || t === 'PA') return t;
    return ehPI(codProdutoOP(op)) ? 'PI' : 'PA';
  }
  function umProduto(cod) {
    try { if (typeof v101ProductUM === 'function') { var u = v101ProductUM(cod); if (u) return u; } } catch (e) { }
    try { if (typeof prodUMV382 === 'function') { var u2 = prodUMV382(cod); if (u2) return u2; } } catch (e) { }
    return '';
  }
  function umOP(op) {
    try { if (typeof unidadeProdutoOPV36 === 'function') return unidadeProdutoOPV36(op) || 'un'; } catch (e) { }
    return txt(op && op.UM) || umProduto(codProdutoOP(op)) || 'un';
  }
  function ehUnidade(um) { return /^(un|und|unid|unidade|unidades|pc|pç|pcs|peca|peça|pecas|peças|celula|célula|celulas|células)$/i.test(txt(um)); }
  function opPor(cod) { var k = txt(cod); return A((D() || {}).op).find(function (o) { return o && txt(o.CodOP) === k; }) || null; }
  function opCancelada(op) { return /cancel|exclu|anulad/i.test(String(op && op.Status || '')); }
  function opConcluida(op) { return !!op && !opCancelada(op) && (/conclu|encerr|finaliz/i.test(String(op.Status || '')) || !!op.DataEncerramento); }
  function opAberta(op) { return !!op && !opCancelada(op) && !opConcluida(op); }
  function etapasDaOP(cod) {
    var k = txt(cod);
    return A((D() || {}).op_etapas).filter(function (e) { return e && txt(e.CodOP) === k; })
      .sort(function (a, b) { return N(a.Ordem) - N(b.Ordem) || N(a.SequenciaRecurso) - N(b.SequenciaRecurso); });
  }
  function nomeRecurso(cod) {
    var d = D() || {}, c = txt(cod); if (!c) return '';
    var r = A(d.recursos).concat(A(d.cad_recursos)).find(function (x) { return x && txt(x.CodEquipamento || x['Código Equipamento']) === c; }) || {};
    return r.Equipamento || '';
  }
  /* família de OPs: a OP de PA é a raiz; PI isolado é a própria raiz */
  function raizFamilia(op) {
    if (!op) return '';
    if (tipoOP(op) === 'PA') return txt(op.CodOP);
    if (String(op.OrigemGeracao || '').toUpperCase() === 'PI_ISOLADO') return txt(op.CodOP);
    var ops = A((D() || {}).op), pai = txt(op.OP_Pai), base = txt(op.OP_Base);
    var pa = ops.find(function (o) { return o && tipoOP(o) === 'PA' && (txt(o.CodOP) === pai || txt(o.CodOP) === base); }) ||
      ops.find(function (o) { return o && tipoOP(o) === 'PA' && base && txt(o.OP_Base) === base; }) ||
      ops.find(function (o) { return o && tipoOP(o) === 'PA' && base && txt(o.CodOP) === base + '-PA'; });
    return pa ? txt(pa.CodOP) : (pai || base || txt(op.CodOP));
  }
  function opsDaFamilia(raiz) { return A((D() || {}).op).filter(function (o) { return o && raizFamilia(o) === raiz; }); }
  function opOrigemNaFamilia(raiz, codPI) {
    var k = txt(codPI);
    return opsDaFamilia(raiz).find(function (o) { return codProdutoOP(o) === k && !opCancelada(o); }) || null;
  }
  function idLote(op) {
    if (!op) return '';
    var nucleo = String(op.CodOP || '').replace(/^OP/i, '').replace(/[^0-9A-Za-z-]/g, '').slice(-22);
    if (tipoOP(op) === 'PI') { try { if (typeof v403LotCode === 'function') return v403LotCode(op); } catch (e) { } return 'LPI-' + nucleo; }
    return 'LPA-' + nucleo;
  }
  function opDoLote(id) {
    var k = txt(id); if (!k) return null;
    return A((D() || {}).op).find(function (o) { return o && idLote(o) === k; }) || null;
  }
  function qtdProducao(r) { return N(r && (r['Quantidade produzida'] || r.QuantidadeProduzida || r.Quantidade)); }
  function producaoDaOP(cod) { var k = txt(cod); return A((D() || {}).producao).filter(function (r) { return r && txt(r.CodOP) === k; }); }
  function somaProducao(cod) { return arred(producaoDaOP(cod).reduce(function (s, r) { return s + qtdProducao(r); }, 0)); }
  function ativoConsumo(c) { return !!c && String(c.Status || 'ATIVO').toUpperCase() !== 'CANCELADO'; }
  function ehLinhaPI(m) { return !!m && String(m.TipoConsumo || '').toLowerCase().indexOf('pi intermedi') >= 0; }
  function ehGenealogia(m) { return ehLinhaPI(m) && (txt(m.OrdemEtapa) === 'PI' || txt(m.Ordem) === 'PI') && /genealog/i.test(String(m.Processo || '')); }
  function linhaPIAtiva(m) { return ehLinhaPI(m) && !(ehGenealogia(m) && m.FluxoPISubstituido === 'Sim') && m.RemovidoDoRoteiro !== 'Sim'; }
  function linhasPIDaOP(cod) { var k = txt(cod); return A((D() || {}).op_materiais).filter(function (m) { return m && txt(m.CodOP) === k && linhaPIAtiva(m); }); }

  /* ---------------------------------------------------------------------
     2) LIVRO DO ESTOQUE DE PI E PA (produção apontada − consumos − perdas por retirada adicional − baixas)
     Lote = produção de uma OP (código LPI-… para PI, igual ao lote de PI da V40.3; LPA-… para PA).
     Etiqueta = parte do lote (cada apontamento de produção gera as suas). Movimentos sem etiqueta (consumo legado,
     baixa automática no encerramento, consumo planejado na geração da OP) abatem primeiro a produção sem etiqueta e
     depois as etiquetas na ordem de criação (para a consulta por etiqueta); o saldo do LOTE é sempre o exato.
     --------------------------------------------------------------------- */
  var cacheLivro = null;
  function assinatura() {
    var d = D() || {};
    return [geracao, A(d.producao).length, A(d.op_pi_consumos).length, A(d.perdas).length, A(d.etiquetas_producao).length, A(d.estoque_pi_ajustes).length, A(d.op).length, A(d.op_materiais).length].join('|');
  }
  function etiquetasAtivas() { return A((D() || {}).etiquetas_producao).filter(function (e) { return e && e.Status !== 'CANCELADA'; }); }
  function ordemEtiqueta(a, b) { return String(a.IdEtiqueta).localeCompare(String(b.IdEtiqueta), 'pt-BR', { numeric: true }); }
  function livro() {
    var sig = assinatura();
    if (cacheLivro && cacheLivro.sig === sig && cacheLivro.dados === D()) return cacheLivro;
    var d = D() || {}, lotes = {}, porEtiqueta = {}, orfaos = [];
    function lote(op) {
      var id = idLote(op);
      if (!lotes[id]) {
        var cod = codProdutoOP(op);
        lotes[id] = { IdLote: id, CodOP: txt(op.CodOP), op: op, Tipo: tipoOP(op), CodigoProduto: cod, Descricao: descProduto(cod) || op.DescricaoProduto || '', UM: umOP(op),
          Familia: raizFamilia(op), Produzido: 0, Apontamentos: [], Etiquetas: [], Consumos: [], Perdas: [], Baixas: [], Saldo: 0, Reservado: 0, Reservas: [] };
      }
      return lotes[id];
    }
    A(d.producao).forEach(function (r) {
      var op = opPor(r && r.CodOP); if (!op) return;
      var L = lote(op), q = qtdProducao(r);
      L.Produzido += q; L.Apontamentos.push(r);
    });
    etiquetasAtivas().forEach(function (e) {
      var op = opPor(e.CodOP); if (!op) return;
      var L = lote(op), x = { e: e, Quantidade: N(e.Quantidade), Especifico: 0, Rateado: 0, Saldo: 0, Movimentos: [] };
      L.Etiquetas.push(x); porEtiqueta[e.IdEtiqueta] = { lote: L, et: x };
    });
    function loteDoMovimento(idL, idE, codOrigem) {
      if (idE && porEtiqueta[idE]) return porEtiqueta[idE].lote;
      if (idL && lotes[idL]) return lotes[idL];
      if (idL) { var o = opDoLote(idL); if (o) return lote(o); }
      if (!idL && codOrigem) { var o2 = opPor(codOrigem); if (o2) return lote(o2); }
      return null;
    }
    A(d.op_pi_consumos).forEach(function (c) {
      if (!ativoConsumo(c)) return;
      var L = loteDoMovimento(txt(c.IdLotePI), txt(c.IdEtiqueta), txt(c.CodOPOrigemPI));
      if (!L) { orfaos.push(c); return; }
      L.Consumos.push(c);
    });
    A(d.perdas).forEach(function (p) {
      if (!p || p.OrigemPerda !== 'RETIRADA_ADICIONAL' || !(p.IdLotePI || p.IdEtiqueta)) return;
      var L = loteDoMovimento(txt(p.IdLotePI), txt(p.IdEtiqueta), txt(p.CodOPOrigemPI));
      if (L) L.Perdas.push(p);
    });
    A(d.estoque_pi_ajustes).forEach(function (a) {
      if (!a || a.Status === 'ESTORNADO') return;
      var L = loteDoMovimento(txt(a.IdLote), txt(a.IdEtiqueta), txt(a.CodOP));
      if (L) L.Baixas.push(a);
    });
    Object.keys(lotes).forEach(function (id) {
      var L = lotes[id];
      L.Produzido = arred(L.Produzido);
      var cons = L.Consumos.reduce(function (s, c) { return s + N(c.QuantidadeConsumida); }, 0);
      var perd = L.Perdas.reduce(function (s, p) { return s + N(p.QuantidadePerdida); }, 0);
      var bx = L.Baixas.reduce(function (s, a) { return s + N(a.Quantidade); }, 0);
      L.Consumido = arred(cons); L.Perdido = arred(perd); L.Baixado = arred(bx);
      L.Saldo = arred(L.Produzido - cons - perd - bx);
      /* por etiqueta */
      L.Etiquetas.sort(function (a, b) { return ordemEtiqueta(a.e, b.e); });
      var semEt = 0;
      function movQtd(m) { return N(m.QuantidadeConsumida !== undefined && m.QuantidadeConsumida !== '' ? m.QuantidadeConsumida : (m.QuantidadePerdida !== undefined && m.QuantidadePerdida !== '' ? m.QuantidadePerdida : m.Quantidade)); }
      L.Consumos.concat(L.Perdas, L.Baixas).forEach(function (m) {
        var idE = txt(m.IdEtiqueta), x = idE && porEtiqueta[idE] && porEtiqueta[idE].lote === L ? porEtiqueta[idE].et : null;
        if (x) { x.Especifico += movQtd(m); x.Movimentos.push(m); } else semEt += movQtd(m);
      });
      var totalEt = L.Etiquetas.reduce(function (s, x) { return s + x.Quantidade; }, 0);
      L.SemEtiqueta = arred(Math.max(0, L.Produzido - totalEt));
      L.EtiquetadoAMais = arred(Math.max(0, totalEt - L.Produzido));
      var resto = semEt, livreSem = Math.min(L.SemEtiqueta, resto);
      resto -= livreSem;
      L.SaldoSemEtiqueta = arred(L.SemEtiqueta - livreSem);
      L.Etiquetas.forEach(function (x) {
        var disp = Math.max(0, x.Quantidade - x.Especifico), t = Math.min(disp, resto);
        x.Rateado = arred(t); resto -= t;
        x.Saldo = arred(x.Quantidade - x.Especifico - t);
      });
    });
    /* reservado: PI planejado nas OPs abertas que consomem este lote (ainda não consumido pela OP consumidora) */
    A(d.op_materiais).forEach(function (m) {
      if (!linhaPIAtiva(m)) return;
      var opC = opPor(m.CodOP); if (!opAberta(opC)) return;
      var plan = N(m.QtdPlanejada); if (!(plan > 0)) return;
      var L = null;
      if (txt(m.Lote) && lotes[txt(m.Lote)]) L = lotes[txt(m.Lote)];
      else if (txt(m.OPOrigemPI)) { var o = opPor(m.OPOrigemPI); if (o) L = lotes[idLote(o)] || null; }
      if (!L) return;
      var ja = consumidoPelaOP(m.CodOP, m.CodigoMaterial || m.CodigoPI);
      var r = arred(Math.max(0, plan - ja));
      if (r > 0) { L.Reservado = arred(L.Reservado + r); L.Reservas.push({ CodOP: m.CodOP, Quantidade: r }); }
    });
    Object.keys(lotes).forEach(function (id) { var L = lotes[id]; L.Disponivel = arred(L.Saldo - L.Reservado); });
    cacheLivro = { sig: sig, dados: D(), lotes: lotes, porEtiqueta: porEtiqueta, orfaos: orfaos };
    return cacheLivro;
  }
  /* consumo de PI já lançado pela OP consumidora (inclui o consumo de lote feito na geração da OP, V40.3/V1.0.11) */
  function consumosDaOPConsumidora(codOP, codPI) {
    var op = opPor(codOP), raiz = raizFamilia(op), k = txt(codOP), p = txt(codPI);
    return A((D() || {}).op_pi_consumos).filter(function (c) {
      if (!ativoConsumo(c) || (p && txt(c.CodigoPI) !== p)) return false;
      if (txt(c.CodOPConsumidora)) return txt(c.CodOPConsumidora) === k;
      return !!raiz && txt(c.CodOPPA) === raiz && tipoOP(op) === 'PA';
    });
  }
  function consumidoPelaOP(codOP, codPI) { return arred(consumosDaOPConsumidora(codOP, codPI).reduce(function (s, c) { return s + N(c.QuantidadeConsumida); }, 0)); }
  function perdasPIDaOP(codOP, codPI) {
    var k = txt(codOP), p = txt(codPI);
    return A((D() || {}).perdas).filter(function (x) { return x && txt(x.CodOP) === k && String(x.PerdaAlvoTipo || '').toUpperCase() === 'MATERIAL' && txt(x.CodigoMaterial || x.ItemPerdaCodigo) === p; });
  }
  function infoEtiqueta(id) { var L = livro(); return L.porEtiqueta[txt(id)] || null; }
  function lotesDoProduto(cod) {
    var L = livro(), k = txt(cod);
    return Object.keys(L.lotes).map(function (id) { return L.lotes[id]; }).filter(function (x) { return x.CodigoProduto === k; });
  }

  /* ---------------------------------------------------------------------
     3) MOTIVOS DE PERDA — CADASTRO (categoria + motivo) E LISTA SUSPENSA NO REGISTRO DE PERDAS
     Duplicidade: a chave é categoria + motivo sem acento, sem diferença de maiúsculas e sem pontuação/espaços extras;
     motivos parecidos (até 2 letras de diferença) pedem confirmação. Motivo em uso não é excluído (só desativado).
     --------------------------------------------------------------------- */
  var CATEGORIAS_PADRAO = ['Refugo de processo', 'Perda de material', 'Retrabalho', 'Não conformidade', 'Teste / amostra'];
  var SUGESTOES_MOTIVOS = {
    'Refugo de processo': ['Contaminação', 'Fora de especificação', 'Ajuste de máquina (setup)', 'Falha de equipamento', 'Erro operacional'],
    'Perda de material': ['Sobra / descarte de material', 'Derramamento', 'Material vencido', 'Material danificado no manuseio'],
    'Retrabalho': ['Retrabalho por defeito', 'Retrabalho por ajuste de parâmetro'],
    'Não conformidade': ['Defeito dimensional', 'Defeito visual', 'Falha em teste elétrico'],
    'Teste / amostra': ['Amostra para análise / qualidade', 'Teste destrutivo']
  };
  function motivos() { return A((D() || {}).perdas_motivos); }
  function chaveMotivo(cat, mot) { return norm(cat) + '|' + norm(mot); }
  function categoriaCanonica(cat) {
    var k = norm(cat); if (!k) return '';
    var c = CATEGORIAS_PADRAO.find(function (x) { return norm(x) === k; });
    if (c) return c;
    var m = motivos().find(function (x) { return norm(x.Categoria) === k; });
    return m ? txt(m.Categoria) : txt(cat);
  }
  function categorias(todas) {
    var out = CATEGORIAS_PADRAO.slice(), vistos = {};
    out.forEach(function (c) { vistos[norm(c)] = 1; });
    var extras = [];
    motivos().forEach(function (m) {
      var k = norm(m.Categoria); if (!k || vistos[k]) return;
      if (!todas && m.Ativo === 'Não') return;
      vistos[k] = 1; extras.push(txt(m.Categoria));
    });
    extras.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    return out.concat(extras);
  }
  function motivosDaCategoria(cat, soAtivos) {
    var k = norm(cat);
    return motivos().filter(function (m) { return norm(m.Categoria) === k && (!soAtivos || m.Ativo !== 'Não'); })
      .sort(function (a, b) { return String(a.Motivo).localeCompare(String(b.Motivo), 'pt-BR'); });
  }
  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length, i, j, prev = [], cur;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function parecidos(cat, mot, ignorarId) {
    var k = norm(mot);
    return motivosDaCategoria(cat, false).filter(function (m) {
      if (m.IdMotivo === ignorarId) return false;
      var o = norm(m.Motivo); if (o === k) return false;
      return (Math.min(o.length, k.length) >= 4 && levenshtein(o, k) <= 2) || (Math.min(o.length, k.length) >= 5 && (o.indexOf(k) >= 0 || k.indexOf(o) >= 0));
    });
  }
  function usosMotivo(m) {
    var kc = norm(m.Categoria), km = norm(m.Motivo);
    return A((D() || {}).perdas).filter(function (p) { return p && (p.IdMotivo === m.IdMotivo || (norm(p.Motivo) === km && norm(p.TipoApontamento) === kc)); }).length;
  }
  function proximoIdMotivo() {
    var max = 0;
    motivos().forEach(function (m) { var x = String(m.IdMotivo || '').match(/(\d+)$/); if (x) max = Math.max(max, +x[1]); });
    return 'MOT' + String(max + 1).padStart(4, '0');
  }
  function opcoesCategorias(sel, comNova) {
    var lista = categorias(true);
    return lista.map(function (c) { return '<option value="' + esc(c) + '"' + (norm(c) === norm(sel) ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      (comNova ? '<option value="__nova">+ Nova categoria…</option>' : '');
  }
  function motivosModulo() {
    garantirColecoes(); estilo(); setCurrent('perdas_motivos'); marcarNav('perdas_motivos');
    cabecalho('Motivos de perda', 'Categorias e motivos padronizados usados na lista suspensa do Registro de Perdas (evita cadastros duplicados e erros de digitação).');
    var c = el('content'); if (!c) return;
    c.innerHTML = '<div class="toolbar"><button onclick="mesMotivoForm(\'\')">+ Novo motivo</button>' +
      '<button class="secondary" onclick="mesMotivosImportar()">Importar motivos já digitados nas perdas</button>' +
      '<button class="secondary" onclick="mesMotivosSugestoes()">Carregar sugestões padrão</button>' +
      '<button class="secondary" onclick="render(\'perdas\')">Registro de Perdas</button>' +
      '<input id="mes_mot_q" placeholder="Pesquisar categoria ou motivo..." oninput="mesMotivosTabela()"></div>' +
      '<div class="hint">A chave de duplicidade ignora acentos, maiúsculas e pontuação: “Contaminação”, “contaminacao” e “CONTAMINAÇÃO.” são o mesmo motivo. Motivos já usados em perdas não podem ser excluídos — desative-os para tirar da lista.</div>' +
      '<div id="mes_mot_form"></div><div id="mes_mot_tbl"></div>';
    window.mesMotivosTabela();
  }
  window.mesMotivosTabela = function () {
    var box = el('mes_mot_tbl'); if (!box) return;
    var q = norm(val('mes_mot_q')), html = '';
    categorias(true).forEach(function (cat) {
      var lista = motivosDaCategoria(cat, false).filter(function (m) { return !q || norm(cat + ' ' + m.Motivo + ' ' + (m.Descricao || '')).indexOf(q) >= 0; });
      if (q && !lista.length && norm(cat).indexOf(q) < 0) return;
      var linhas = lista.map(function (m) {
        var u = usosMotivo(m);
        return '<tr><td>' + esc(m.IdMotivo) + '</td><td><b>' + esc(m.Motivo) + '</b>' + (m.Descricao ? '<br><span class="mes14-subtle">' + esc(m.Descricao) + '</span>' : '') + '</td>' +
          '<td>' + (m.Ativo === 'Não' ? tag('Inativo', 'alerta') : tag('Ativo', 'ok')) + '</td><td class="mes14-num">' + u + '</td><td>' + esc(m.CriadoPor || '') + '<br><span class="mes14-subtle">' + esc(m.CriadoEm || '') + '</span></td>' +
          '<td><button class="mini" onclick="mesMotivoForm(\'' + jsStr(m.IdMotivo) + '\')">Editar</button> <button class="mini secondary" onclick="mesMotivoAtivar(\'' + jsStr(m.IdMotivo) + '\')">' + (m.Ativo === 'Não' ? 'Reativar' : 'Desativar') + '</button>' +
          (u ? '' : ' <button class="mini danger" onclick="mesMotivoExcluir(\'' + jsStr(m.IdMotivo) + '\')">Excluir</button>') + '</td></tr>';
      });
      html += '<div class="mes14-card"><h3>' + esc(cat) + (CATEGORIAS_PADRAO.indexOf(cat) >= 0 ? ' <span class="mes14-subtle">(categoria padrão)</span>' : '') + '</h3>' +
        tabela(['Código', 'Motivo', 'Situação', 'Perdas com este motivo', 'Cadastro', 'Ações'], linhas, 'Nenhum motivo cadastrado nesta categoria.') +
        '<div class="mes14-actions"><button class="mini secondary" onclick="mesMotivoForm(\'\',\'' + jsStr(cat) + '\')">+ Motivo em ' + esc(cat) + '</button></div></div>';
    });
    box.innerHTML = html || '<p class="muted">Nada encontrado.</p>';
  };
  window.mesMotivoForm = function (id, catInicial) {
    var box = el('mes_mot_form'); if (!box) return;
    var m = id ? motivos().find(function (x) { return x.IdMotivo === id; }) : null;
    if (id && !m) return;
    box.innerHTML = '<div class="mes14-card"><h3>' + (m ? 'Editar motivo ' + esc(m.IdMotivo) : 'Novo motivo de perda') + '</h3><div class="mes14-grid">' +
      '<label><span>Categoria</span><select id="mes_mot_cat" onchange="document.getElementById(\'mes_mot_cat_nova_l\').style.display=this.value===\'__nova\'?\'\':\'none\'">' + opcoesCategorias(m ? m.Categoria : (catInicial || CATEGORIAS_PADRAO[0]), true) + '</select></label>' +
      '<label id="mes_mot_cat_nova_l" style="display:none"><span>Nome da nova categoria</span><input id="mes_mot_cat_nova" placeholder="Ex.: Parada de máquina"></label>' +
      '<label class="wide"><span>Motivo</span><input id="mes_mot_mot" value="' + esc(m ? m.Motivo : '') + '" placeholder="Ex.: Contaminação do slurry"></label>' +
      '<label class="wide"><span>Descrição / como identificar (opcional)</span><input id="mes_mot_desc" value="' + esc(m ? m.Descricao || '' : '') + '"></label>' +
      '<label><span>Situação</span><select id="mes_mot_ativo"><option' + (m && m.Ativo === 'Não' ? '' : ' selected') + '>Sim</option><option' + (m && m.Ativo === 'Não' ? ' selected' : '') + '>Não</option></select></label></div>' +
      '<div class="mes14-actions"><button onclick="mesMotivoSalvar(\'' + jsStr(id || '') + '\')">Salvar motivo</button><button class="secondary" onclick="document.getElementById(\'mes_mot_form\').innerHTML=\'\'">Cancelar</button></div>' +
      '<div id="mes_mot_msg" class="mes14-msg"></div></div>';
    var i = el('mes_mot_mot'); if (i) i.focus();
  };
  /* grava um motivo (cadastro ou edição); devolve o registro ou null */
  function gravarMotivo(id, catTxt, motTxt, desc, ativo, msgId) {
    var cat = categoriaCanonica(catTxt), mot = txt(motTxt).replace(/\s+/g, ' ');
    if (!cat) { aviso(msgId, 'Informe a categoria.', 'erro'); return null; }
    if (!mot) { aviso(msgId, 'Informe o motivo.', 'erro'); return null; }
    var k = chaveMotivo(cat, mot);
    var dup = motivos().find(function (x) { return x.IdMotivo !== id && chaveMotivo(x.Categoria, x.Motivo) === k; });
    if (dup) { aviso(msgId, 'Já existe o motivo “' + esc(dup.Motivo) + '” em ' + esc(dup.Categoria) + ' (' + esc(dup.IdMotivo) + ')' + (dup.Ativo === 'Não' ? ' — está inativo: reative-o na lista.' : '.'), 'erro'); return null; }
    var par = parecidos(cat, mot, id);
    if (par.length && !confirm('Já existe motivo parecido em ' + cat + ':\n- ' + par.map(function (x) { return x.Motivo + ' (' + x.IdMotivo + ')'; }).join('\n- ') + '\n\nCadastrar “' + mot + '” mesmo assim?')) return null;
    var d = D();
    if (id) {
      var m = motivos().find(function (x) { return x.IdMotivo === id; }); if (!m) return null;
      var antes = { Categoria: m.Categoria, Motivo: m.Motivo }, usos = usosMotivo(m);
      m.Categoria = cat; m.Motivo = mot; m.Descricao = txt(desc); m.Ativo = ativo === 'Não' ? 'Não' : 'Sim'; m.Chave = k; m.AlteradoEm = agora(); m.AlteradoPor = usuario();
      if (usos && (antes.Categoria !== cat || antes.Motivo !== mot) && confirm('Atualizar também o texto das ' + usos + ' perda(s) já registradas com este motivo?')) {
        A(d.perdas).forEach(function (p) {
          if (p && (p.IdMotivo === id || (norm(p.Motivo) === norm(antes.Motivo) && norm(p.TipoApontamento) === norm(antes.Categoria)))) { p.Motivo = mot; p.TipoApontamento = cat; p.IdMotivo = id; }
        });
      }
      salvar(); return m;
    }
    var novo = { IdMotivo: proximoIdMotivo(), Categoria: cat, Motivo: mot, Descricao: txt(desc), Ativo: ativo === 'Não' ? 'Não' : 'Sim', Chave: k, CriadoEm: agora(), CriadoPor: usuario() };
    d.perdas_motivos.push(novo);
    salvar(); return novo;
  }
  window.mesMotivoSalvar = function (id) {
    var cat = val('mes_mot_cat') === '__nova' ? val('mes_mot_cat_nova') : val('mes_mot_cat');
    var m = gravarMotivo(id, cat, val('mes_mot_mot'), val('mes_mot_desc'), val('mes_mot_ativo'), 'mes_mot_msg');
    if (!m) return;
    if (el('mes_mot_form')) el('mes_mot_form').innerHTML = '<div class="mes14-msg ok">✔ Motivo ' + esc(m.IdMotivo) + ' — ' + esc(m.Motivo) + ' gravado em ' + esc(m.Categoria) + '.</div>';
    window.mesMotivosTabela();
  };
  window.mesMotivoAtivar = function (id) {
    var m = motivos().find(function (x) { return x.IdMotivo === id; }); if (!m) return;
    m.Ativo = m.Ativo === 'Não' ? 'Sim' : 'Não'; m.AlteradoEm = agora(); m.AlteradoPor = usuario();
    salvar(); window.mesMotivosTabela();
  };
  window.mesMotivoExcluir = function (id) {
    var d = D(), m = motivos().find(function (x) { return x.IdMotivo === id; }); if (!m) return;
    if (usosMotivo(m)) return alert('Este motivo já foi usado em perdas: desative-o em vez de excluir.');
    if (!confirm('Excluir o motivo “' + m.Motivo + '” (' + m.Categoria + ')?')) return;
    d.perdas_motivos = motivos().filter(function (x) { return x.IdMotivo !== id; });
    salvar(); window.mesMotivosTabela();
  };
  window.mesMotivosSugestoes = function () {
    var novos = [];
    Object.keys(SUGESTOES_MOTIVOS).forEach(function (cat) {
      SUGESTOES_MOTIVOS[cat].forEach(function (mot) { if (!motivos().some(function (x) { return chaveMotivo(x.Categoria, x.Motivo) === chaveMotivo(cat, mot); })) novos.push([cat, mot]); });
    });
    if (!novos.length) return alert('Todas as sugestões já estão cadastradas.');
    if (!confirm('Cadastrar ' + novos.length + ' motivo(s) sugerido(s)?\n\n' + novos.map(function (x) { return x[0] + ' › ' + x[1]; }).join('\n'))) return;
    var d = D();
    novos.forEach(function (x) { d.perdas_motivos.push({ IdMotivo: proximoIdMotivo(), Categoria: x[0], Motivo: x[1], Descricao: '', Ativo: 'Sim', Chave: chaveMotivo(x[0], x[1]), CriadoEm: agora(), CriadoPor: usuario(), Origem: 'SUGESTAO_PADRAO' }); });
    salvar(); window.mesMotivosTabela();
  };
  /* importação: agrupa os motivos já digitados (texto livre) pela chave sem acento/maiúscula */
  function gruposHistorico() {
    var g = {};
    A((D() || {}).perdas).forEach(function (p) {
      var mot = txt(p && p.Motivo); if (!mot) return;
      var cat = categoriaCanonica(txt(p.TipoApontamento) || CATEGORIAS_PADRAO[0]), k = chaveMotivo(cat, mot);
      var x = g[k] || (g[k] = { Chave: k, Categoria: cat, Textos: {}, Qtd: 0 });
      x.Textos[mot] = (x.Textos[mot] || 0) + 1; x.Qtd++;
    });
    return Object.keys(g).map(function (k) {
      var x = g[k], textos = Object.keys(x.Textos).sort(function (a, b) { return x.Textos[b] - x.Textos[a]; });
      x.Motivo = textos[0]; x.Variacoes = textos;
      x.Existente = motivos().find(function (m) { return chaveMotivo(m.Categoria, m.Motivo) === k; }) || null;
      return x;
    }).sort(function (a, b) { return a.Categoria.localeCompare(b.Categoria, 'pt-BR') || a.Motivo.localeCompare(b.Motivo, 'pt-BR'); });
  }
  window.mesMotivosImportar = function () {
    var gs = gruposHistorico();
    if (!gs.length) return alert('Nenhuma perda registrada tem motivo digitado.');
    window.__mes14Grupos = gs;
    abrirDialogo('<h3>Importar motivos já digitados nas perdas</h3><p class="muted">Textos iguais sem acento/maiúsculas foram agrupados; o texto mais usado vira o motivo cadastrado.</p>' +
      tabela(['', 'Categoria', 'Motivo', 'Variações digitadas', 'Perdas'], gs.map(function (x, i) {
        return '<tr><td>' + (x.Existente ? tag('Já cadastrado', 'ok') : '<input type="checkbox" class="mes14-sel mes14-imp" data-i="' + i + '" checked>') + '</td><td>' + esc(x.Categoria) + '</td><td><b>' + esc(x.Motivo) + '</b></td><td>' + esc(x.Variacoes.join(' · ')) + '</td><td class="mes14-num">' + x.Qtd + '</td></tr>';
      })) +
      '<label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="mes14_imp_padronizar" class="mes14-sel"> Padronizar o texto das perdas antigas para o motivo cadastrado (e gravar o código do motivo)</label>' +
      '<div class="mes14-actions"><button onclick="mesMotivosImportarConfirmar()">Importar selecionados</button><button class="secondary" onclick="mesFecharDialogo14()">Fechar</button></div>');
  };
  window.mesMotivosImportarConfirmar = function () {
    var gs = window.__mes14Grupos || [], d = D(), padronizar = !!(el('mes14_imp_padronizar') && el('mes14_imp_padronizar').checked), n = 0;
    document.querySelectorAll('.mes14-imp:checked').forEach(function (cb) {
      var x = gs[+cb.dataset.i]; if (!x || x.Existente) return;
      var m = { IdMotivo: proximoIdMotivo(), Categoria: x.Categoria, Motivo: x.Motivo, Descricao: '', Ativo: 'Sim', Chave: x.Chave, CriadoEm: agora(), CriadoPor: usuario(), Origem: 'IMPORTADO_DAS_PERDAS' };
      d.perdas_motivos.push(m); x.Existente = m; n++;
    });
    if (padronizar) {
      A(d.perdas).forEach(function (p) {
        var mot = txt(p && p.Motivo); if (!mot) return;
        var cat = categoriaCanonica(txt(p.TipoApontamento) || CATEGORIAS_PADRAO[0]), k = chaveMotivo(cat, mot);
        var m = motivos().find(function (x) { return chaveMotivo(x.Categoria, x.Motivo) === k; });
        if (m) { p.Motivo = m.Motivo; p.TipoApontamento = m.Categoria; p.IdMotivo = m.IdMotivo; }
      });
    }
    salvar(); fecharDialogo();
    alert(n + ' motivo(s) importado(s).' + (padronizar ? ' Textos das perdas antigas padronizados.' : ''));
    if (el('mes_mot_tbl')) window.mesMotivosTabela();
  };
  /* Registro de Perdas: categoria e motivo passam a ser listas suspensas do cadastro */
  function preencherMotivosPerda(selecionar) {
    var s = el('loss_motivo'); if (!s || s.tagName !== 'SELECT') return;
    var lista = motivosDaCategoria(val('loss_tipo'), true);
    s.innerHTML = lista.length ? '<option value="">Selecione o motivo...</option>' + lista.map(function (m) {
      return '<option value="' + esc(m.Motivo) + '" data-id="' + esc(m.IdMotivo) + '">' + esc(m.Motivo) + '</option>';
    }).join('') : '<option value="">(nenhum motivo cadastrado nesta categoria — use “+ Novo motivo”)</option>';
    if (selecionar) s.value = selecionar;
  }
  function decorarMotivosPerda() {
    var tipo = el('loss_tipo'), mot = el('loss_motivo');
    if (!tipo || !mot) return;
    if (!tipo.dataset.mes14) {
      var atual = tipo.value;
      tipo.innerHTML = categorias(false).map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
      if (atual) tipo.value = categoriaCanonica(atual) || tipo.value;
      tipo.dataset.mes14 = '1';
      tipo.addEventListener('change', function () { preencherMotivosPerda(); });
    }
    if (mot.tagName !== 'SELECT') {
      var s = document.createElement('select'); s.id = 'loss_motivo';
      mot.parentNode.replaceChild(s, mot);
      var lab = s.closest('label');
      if (lab) {
        var sp = lab.querySelector('span'); if (sp) sp.textContent = 'Motivo (cadastro de motivos)';
        /* lista + botões na mesma linha (o rótulo fica da altura dos outros campos) */
        lab.classList.add('wide');
        var linha = document.createElement('div'); linha.className = 'mes14-motivo-linha';
        s.parentNode.insertBefore(linha, s); linha.appendChild(s);
        linha.insertAdjacentHTML('beforeend', '<button type="button" class="mini secondary" onclick="mesMotivoRapido()">+ Novo motivo</button><button type="button" class="mini secondary" onclick="render(\'perdas_motivos\')">Gerenciar</button>');
      }
    }
    preencherMotivosPerda();
  }
  window.mesMotivoRapido = function () {
    var cat = val('loss_tipo') || CATEGORIAS_PADRAO[0];
    abrirDialogo('<h3>Novo motivo de perda</h3><div class="mes14-grid"><label><span>Categoria</span><select id="mes_mr_cat">' + opcoesCategorias(cat, false) + '</select></label>' +
      '<label class="wide"><span>Motivo</span><input id="mes_mr_mot" placeholder="Ex.: Contaminação do slurry"></label></div>' +
      '<div class="mes14-actions"><button onclick="mesMotivoRapidoSalvar()">Cadastrar e usar</button><button class="secondary" onclick="mesFecharDialogo14()">Cancelar</button></div><div id="mes_mr_msg" class="mes14-msg"></div>');
    var i = el('mes_mr_mot'); if (i) i.focus();
  };
  window.mesMotivoRapidoSalvar = function () {
    var m = gravarMotivo('', val('mes_mr_cat'), val('mes_mr_mot'), '', 'Sim', 'mes_mr_msg');
    if (!m) return;
    fecharDialogo();
    var tipo = el('loss_tipo');
    if (tipo) {
      if (![].some.call(tipo.options, function (o) { return o.value === m.Categoria; })) tipo.insertAdjacentHTML('beforeend', '<option value="' + esc(m.Categoria) + '">' + esc(m.Categoria) + '</option>');
      tipo.value = m.Categoria;
    }
    preencherMotivosPerda(m.Motivo);
  };
  function motivoSelecionadoPerda() {
    var s = el('loss_motivo'); if (!s || s.tagName !== 'SELECT') return null;
    var o = s.options[s.selectedIndex];
    return { motivo: s.value, id: o ? (o.getAttribute('data-id') || '') : '', exigido: motivosDaCategoria(val('loss_tipo'), true).length > 0 };
  }

  /* ---------------------------------------------------------------------
     4) APONTAMENTO DE TEMPO POR MÁQUINA
     Cada linha de OP - Etapas é uma máquina (IdRecursoRoteiro). O registro de tempo guarda a máquina; o tempo real
     finalizado (soma dos intervalos) vai para OP - Etapas.TempoReal daquela máquina, que já é o tempo usado por energia
     (kWh = W/1000 × min/60) e mão de obra (min/60 × pessoas × R$/h) no lugar do planejado. Sem tempo finalizado, vale o
     planejado. Uma máquina só tem um apontamento aberto por OP; intervalos da mesma máquina na mesma OP não se sobrepõem.
     --------------------------------------------------------------------- */
  function maquinasDaOP(op) {
    var vistos = {};
    return etapasDaOP(op.CodOP).map(function (e, i) {
      var cod = txt(e.CodEquipamento), id = txt(e.IdRecursoRoteiro), chave = id || ((txt(e.Ordem) || cod) ? txt(e.Ordem) + '|' + cod : '#' + i);
      if (vistos[chave]) chave = chave + '#' + i;
      vistos[chave] = 1;
      return { i: i, chave: chave, Ordem: txt(e.Ordem), Processo: e.Processo || '', IdRecursoRoteiro: id, CodEquipamento: cod,
        Equipamento: e.Recurso || e.Equipamento || nomeRecurso(cod) || (cod ? 'Equipamento ' + cod : 'Sem equipamento'),
        Planejado: N(e.TempoPlanejado || e.TempoOperacaoMin), Pessoas: N(e.NPessoas || e.PessoasPlanejado), etapa: e };
    });
  }
  function chaveTempo(t) {
    var id = txt(t && t.IdRecursoRoteiro); if (id) return id;
    if (txt(t && t.CodEquipamento) || txt(t && t.OrdemEtapa)) return txt(t.OrdemEtapa) + '|' + txt(t.CodEquipamento);
    return '';
  }
  function temposDaOP(cod) { var k = txt(cod); return A((D() || {}).apontamento_tempos).filter(function (t) { return t && txt(t.CodOP) === k; }); }
  function inicioTempo(t) { return parseDataHora(t.DataApontamento, t.HoraInicio); }
  function fimTempo(t) {
    if (!txt(t.HoraFim)) return null;
    var ini = inicioTempo(t), f = parseDataHora(txt(t.DataFim) || t.DataApontamento, t.HoraFim);
    if (f && ini && !txt(t.DataFim) && f <= ini) f = new Date(f.getTime() + 86400000);
    return f;
  }
  function duracaoMin(t) { var a = inicioTempo(t), b = fimTempo(t); return a && b && b > a ? arred((b - a) / 60000, 2) : 0; }
  function fmtMin(m) { m = Number(m) || 0; var h = Math.floor(m / 60), r = Math.round(m - h * 60); return f2(m) + ' min' + (m >= 60 ? ' (' + h + 'h' + pad2(r) + ')' : ''); }
  function recalcularTempoReal(cod) {
    var op = opPor(cod); if (!op) return;
    var soma = {};
    temposDaOP(cod).forEach(function (t) { if (t.Status === 'Finalizado' && chaveTempo(t)) soma[chaveTempo(t)] = (soma[chaveTempo(t)] || 0) + duracaoMin(t); });
    maquinasDaOP(op).forEach(function (m) {
      var e = m.etapa, total = arred(soma[m.chave] || 0, 2);
      if (total > 0) { e.TempoReal = String(total); e.TempoApontadoMin = String(total); e.TempoRealOrigem = 'APONTAMENTO_TEMPO_MAQUINA'; }
      else if (e.TempoRealOrigem === 'APONTAMENTO_TEMPO_MAQUINA') { e.TempoReal = ''; e.TempoApontadoMin = ''; delete e.TempoRealOrigem; }
    });
  }
  function atualizarCalculosOP(cod) {
    recalcularTempoReal(cod);
    try { if (typeof recalcOPFamilyV395 === 'function') recalcOPFamilyV395(cod); } catch (e) { }
    salvar();
  }
  function opSelecionada(id) { try { var o = typeof selectedOP === 'function' ? selectedOP(id || 'prod_op') : null; return o && o.CodOP ? o : null; } catch (e) { return null; } }
  function maquinaSelecionada(op) { var k = val('mes14_tp_maq'); return maquinasDaOP(op).find(function (m) { return m.chave === k; }) || null; }
  function abertoNaMaquina(op, chave) { return temposDaOP(op.CodOP).find(function (t) { return t.Status === 'Iniciado' && chaveTempo(t) === chave; }) || null; }
  function sobrepoe(op, chave, ini, fim, ignorarId) {
    return temposDaOP(op.CodOP).find(function (t) {
      if (t.IdApontamentoTempo === ignorarId || chaveTempo(t) !== chave) return false;
      var a = inicioTempo(t), b = t.Status === 'Iniciado' ? new Date() : fimTempo(t);
      return a && b && a < fim && ini < b;
    }) || null;
  }
  function painelTempo(op, fechada) {
    var maqs = maquinasDaOP(op), tempos = temposDaOP(op.CodOP).slice().sort(function (a, b) { return (inicioTempo(b) || 0) - (inicioTempo(a) || 0); });
    var sel = window.__mes14Maq && maqs.some(function (m) { return m.chave === window.__mes14Maq; }) ? window.__mes14Maq : (maqs[0] || {}).chave;
    var porMaq = {};
    tempos.forEach(function (t) { var k = chaveTempo(t); if (!k) return; var x = porMaq[k] || (porMaq[k] = { real: 0, aberto: null }); if (t.Status === 'Finalizado') x.real += duracaoMin(t); else if (t.Status === 'Iniciado') x.aberto = t; });
    var resumo = maqs.map(function (m) {
      var x = porMaq[m.chave] || { real: 0, aberto: null }, real = arred(x.real, 2), dif = real - m.Planejado;
      var sit = x.aberto ? tag('Em andamento desde ' + x.aberto.DataApontamento + ' ' + x.aberto.HoraInicio, 'info') : (real > 0 ? tag('Tempo real usado nos custos', 'ok') : tag('Sem apontamento: vale o planejado', ''));
      return '<tr><td>' + esc(m.Ordem) + '</td><td>' + esc(m.Processo) + '</td><td><b>' + esc(m.Equipamento) + '</b>' + (m.CodEquipamento ? ' <span class="mes14-subtle">cód. ' + esc(m.CodEquipamento) + '</span>' : '') + '</td>' +
        '<td class="mes14-num">' + fmtMin(m.Planejado) + '</td><td class="mes14-num"><b>' + (real > 0 ? fmtMin(real) : '—') + '</b></td><td class="mes14-num">' + (real > 0 ? (dif >= 0 ? '+' : '') + f2(dif) + ' min' : '—') + '</td><td>' + sit + '</td></tr>';
    });
    var linhas = tempos.map(function (t) {
      var k = chaveTempo(t), m = maqs.find(function (x) { return x.chave === k; });
      var maqTxt = m ? (m.Equipamento + ' · etapa ' + m.Ordem) : (k ? (t.Equipamento || t.CodEquipamento || k) : '<span class="mes14-tag alerta">sem máquina (registro anterior)</span>');
      var acoes = '';
      if (!fechada) {
        if (t.Status === 'Iniciado') acoes += '<button class="mini" onclick="mesTempoFinalizar(\'' + jsStr(t.IdApontamentoTempo) + '\')">Finalizar</button> ';
        if (!k) acoes += '<button class="mini secondary" onclick="mesTempoAtribuir(\'' + jsStr(t.IdApontamentoTempo) + '\')">Informar máquina</button> ';
        acoes += '<button class="mini danger" onclick="mesTempoExcluir(\'' + jsStr(t.IdApontamentoTempo) + '\')">Excluir</button>';
      }
      return '<tr><td>' + esc(t.DataApontamento || '') + '</td><td>' + esc(t.HoraInicio || '') + '</td><td>' + esc((txt(t.DataFim) && t.DataFim !== t.DataApontamento ? t.DataFim + ' ' : '') + (t.HoraFim || '')) + '</td>' +
        '<td class="mes14-num">' + (t.Status === 'Finalizado' ? fmtMin(duracaoMin(t)) : '—') + '</td><td>' + (m || !k ? maqTxt : esc(maqTxt)) + '</td><td>' + esc(t.Processo || '') + '</td><td>' + esc(t.Operador || '') + '</td>' +
        '<td>' + (t.Status === 'Iniciado' ? tag('Em andamento', 'info') : tag(t.Status || '', 'ok')) + '</td><td>' + esc(t.Origem === 'MANUAL' ? 'Intervalo informado' : (t.Origem ? 'Iniciar/finalizar' : 'Anterior à 1.4')) + '</td><td>' + acoes + '</td></tr>';
    });
    var opts = maqs.map(function (m) {
      return '<option value="' + esc(m.chave) + '"' + (m.chave === sel ? ' selected' : '') + '>Etapa ' + esc(m.Ordem) + ' · ' + esc(m.Processo) + ' · ' + esc(m.Equipamento) + (m.CodEquipamento ? ' (cód. ' + esc(m.CodEquipamento) + ')' : '') + ' · planejado ' + f2(m.Planejado) + ' min</option>';
    }).join('');
    return '<div class="mes14-card" id="mes14_tempo"><h3>Tempo por máquina</h3>' +
      '<p class="muted">Cada máquina da etapa tem o seu apontamento. O tempo real finalizado de uma máquina substitui o tempo planejado dela no cálculo de energia (potência × tempo) e de mão de obra (tempo × pessoas × taxa). Sem tempo finalizado, vale o planejado do roteiro.</p>' +
      (maqs.length ? '<div class="mes14-grid"><label class="wide"><span>Etapa / máquina</span><select id="mes14_tp_maq" onchange="window.__mes14Maq=this.value">' + opts + '</select></label>' +
        '<label><span>Operador</span><input id="mes14_tp_oper" value="' + esc(val('ap_operador')) + '" placeholder="Nome do operador"></label>' +
        '<label><span>Data de início</span><input id="mes14_tp_dini" placeholder="dd/mm/aaaa (vazio = hoje)"></label><label><span>Hora de início</span><input id="mes14_tp_hini" placeholder="hh:mm (vazio = agora)"></label>' +
        '<label><span>Data de fim</span><input id="mes14_tp_dfim" placeholder="dd/mm/aaaa (vazio = data de início)"></label><label><span>Hora de fim</span><input id="mes14_tp_hfim" placeholder="hh:mm (vazio = agora)"></label>' +
        '<label class="wide"><span>Observação</span><input id="mes14_tp_obs" placeholder="Opcional"></label></div>' +
        '<div class="mes14-actions"><button ' + (fechada ? 'disabled' : '') + ' onclick="mesTempoIniciar()">▶ Iniciar na máquina</button><button ' + (fechada ? 'disabled' : '') + ' onclick="mesTempoFinalizar()">■ Finalizar na máquina</button>' +
        '<button class="secondary" ' + (fechada ? 'disabled' : '') + ' onclick="mesTempoIntervalo()">Registrar intervalo informado (início e fim)</button></div>' : '<p class="muted">Esta OP não tem etapas/máquinas (OP - Etapas). Verifique o roteiro.</p>') +
      '<div id="mes14_tp_msg" class="mes14-msg"></div>' +
      '<h4>Resumo por máquina</h4>' + tabela(['Etapa', 'Processo', 'Máquina', 'Planejado', 'Real apontado', 'Diferença', 'Situação'], resumo, 'Sem máquinas.') +
      '<h4>Apontamentos de tempo desta OP</h4>' + tabela(['Data', 'Início', 'Fim', 'Duração', 'Máquina', 'Processo', 'Operador', 'Status', 'Origem', 'Ações'], linhas, 'Nenhum apontamento de tempo nesta OP.') +
      (fechada ? '<p class="muted">OP encerrada: apontamentos de tempo bloqueados.</p>' : '') + '</div>';
  }
  function reexibirProducao(msg, tipo) {
    if (msg) window.__mes14TempoMsg = { html: msg, tipo: tipo || 'ok' };
    if (typeof showProdOP === 'function') showProdOP();
  }
  window.mesTempoIniciar = function () {
    var op = opSelecionada('prod_op'); if (!op) return;
    if (!opAberta(op)) return aviso('mes14_tp_msg', 'OP encerrada: novos apontamentos de tempo estão bloqueados.', 'erro');
    var m = maquinaSelecionada(op); if (!m) return aviso('mes14_tp_msg', 'Selecione a máquina.', 'erro');
    var di = txt(val('mes14_tp_dini')) || hoje(), hi = txt(val('mes14_tp_hini')) || horaAgora();
    if (!dataValida(di) || !horaValida(hi)) return aviso('mes14_tp_msg', 'Data/hora de início inválida: use dd/mm/aaaa e hh:mm.', 'erro');
    var ini = parseDataHora(di, hi);
    if (ini.getTime() > Date.now() + 5 * 60000) return aviso('mes14_tp_msg', 'O início não pode ficar no futuro.', 'erro');
    var ab = abertoNaMaquina(op, m.chave);
    if (ab) return aviso('mes14_tp_msg', 'Já existe apontamento iniciado em ' + esc(m.Equipamento) + ' nesta OP (desde ' + esc(ab.DataApontamento + ' ' + ab.HoraInicio) + '). Finalize-o antes de iniciar outro.', 'erro');
    var sob = sobrepoe(op, m.chave, ini, new Date(ini.getTime() + 60000), '');
    if (sob) return aviso('mes14_tp_msg', 'O início cai dentro de um intervalo já apontado nesta máquina (' + esc(sob.DataApontamento + ' ' + sob.HoraInicio + '–' + (sob.HoraFim || '')) + ').', 'erro');
    var outras = A(D().apontamento_tempos).filter(function (t) { return t && t.Status === 'Iniciado' && txt(t.CodOP) !== txt(op.CodOP) && m.CodEquipamento && txt(t.CodEquipamento) === m.CodEquipamento; });
    if (outras.length && !confirm('A máquina ' + m.Equipamento + ' já está com apontamento iniciado na(s) OP(s) ' + outras.map(function (t) { return t.CodOP; }).join(', ') + '.\n\nIniciar também nesta OP (a máquina atende as duas ao mesmo tempo)?')) return;
    D().apontamento_tempos.push({ IdApontamentoTempo: 'AT' + Date.now().toString(36).toUpperCase(), CodOP: op.CodOP, Processo: m.Processo, OrdemEtapa: m.Ordem, IdRecursoRoteiro: m.IdRecursoRoteiro,
      CodEquipamento: m.CodEquipamento, Equipamento: m.Equipamento, Operador: txt(val('mes14_tp_oper')), DataApontamento: dataBR(ini), HoraInicio: horaHM(ini), DataFim: '', HoraFim: '', DuracaoMin: '',
      Status: 'Iniciado', Origem: 'INICIAR_FINALIZAR', Observacoes: txt(val('mes14_tp_obs')), CriadoEm: agora(), CriadoPor: usuario() });
    if (!/EM PRODU/i.test(String(op.Status || ''))) op.Status = 'Em Produção';
    window.__mes14Maq = m.chave;
    atualizarCalculosOP(op.CodOP);
    reexibirProducao('▶ Apontamento iniciado em <b>' + esc(m.Equipamento) + '</b> às ' + esc(horaHM(ini)) + '.');
  };
  window.mesTempoFinalizar = function (id) {
    var op = opSelecionada('prod_op'); if (!op) return;
    if (!opAberta(op)) return aviso('mes14_tp_msg', 'OP encerrada: apontamentos bloqueados.', 'erro');
    var t = id ? temposDaOP(op.CodOP).find(function (x) { return x.IdApontamentoTempo === id; }) : null;
    if (!t) { var m = maquinaSelecionada(op); if (!m) return aviso('mes14_tp_msg', 'Selecione a máquina.', 'erro'); t = abertoNaMaquina(op, m.chave); if (!t) return aviso('mes14_tp_msg', 'Não há apontamento iniciado em ' + esc(m.Equipamento) + ' nesta OP.', 'erro'); }
    if (t.Status !== 'Iniciado') return;
    var ini = inicioTempo(t), hf = txt(val('mes14_tp_hfim')), df = txt(val('mes14_tp_dfim')), fim;
    if (hf || df) {
      if (!horaValida(hf || horaAgora()) || (df && !dataValida(df))) return aviso('mes14_tp_msg', 'Data/hora de fim inválida.', 'erro');
      fim = parseDataHora(df || dataBR(ini), hf || horaAgora());
      if (!df && fim <= ini) fim = new Date(fim.getTime() + 86400000);
    } else fim = new Date();
    if (!ini || fim <= ini) return aviso('mes14_tp_msg', 'O fim precisa ser depois do início (' + esc(t.DataApontamento + ' ' + t.HoraInicio) + ').', 'erro');
    if (fim.getTime() > Date.now() + 5 * 60000) return aviso('mes14_tp_msg', 'O fim não pode ficar no futuro.', 'erro');
    var sob = sobrepoe(op, chaveTempo(t), ini, fim, t.IdApontamentoTempo);
    if (sob) return aviso('mes14_tp_msg', 'O intervalo se sobrepõe a outro apontamento da mesma máquina (' + esc(sob.DataApontamento + ' ' + sob.HoraInicio + '–' + (sob.HoraFim || 'em andamento')) + ').', 'erro');
    t.HoraFim = horaHM(fim); t.DataFim = dataBR(fim); t.Status = 'Finalizado'; t.DuracaoMin = String(duracaoMin(t)); t.FinalizadoEm = agora(); t.FinalizadoPor = usuario();
    if (txt(val('mes14_tp_oper')) && !t.Operador) t.Operador = txt(val('mes14_tp_oper'));
    atualizarCalculosOP(op.CodOP);
    reexibirProducao('■ Apontamento finalizado: ' + esc(t.Equipamento || '') + ' · ' + fmtMin(duracaoMin(t)) + '.');
  };
  window.mesTempoIntervalo = function () {
    var op = opSelecionada('prod_op'); if (!op) return;
    if (!opAberta(op)) return aviso('mes14_tp_msg', 'OP encerrada: apontamentos bloqueados.', 'erro');
    var m = maquinaSelecionada(op); if (!m) return aviso('mes14_tp_msg', 'Selecione a máquina.', 'erro');
    var di = txt(val('mes14_tp_dini')), hi = txt(val('mes14_tp_hini')), df = txt(val('mes14_tp_dfim')) || di, hf = txt(val('mes14_tp_hfim'));
    if (!dataValida(di) || !horaValida(hi) || !dataValida(df) || !horaValida(hf)) return aviso('mes14_tp_msg', 'Informe data e hora de início e de fim (dd/mm/aaaa e hh:mm).', 'erro');
    var ini = parseDataHora(di, hi), fim = parseDataHora(df, hf);
    if (fim <= ini) return aviso('mes14_tp_msg', 'O fim precisa ser depois do início.', 'erro');
    if (fim.getTime() > Date.now() + 5 * 60000) return aviso('mes14_tp_msg', 'O fim não pode ficar no futuro.', 'erro');
    var sob = sobrepoe(op, m.chave, ini, fim, '');
    if (sob) return aviso('mes14_tp_msg', 'O intervalo se sobrepõe a outro apontamento da mesma máquina nesta OP (' + esc(sob.DataApontamento + ' ' + sob.HoraInicio + '–' + (sob.HoraFim || 'em andamento')) + ').', 'erro');
    var t = { IdApontamentoTempo: 'AT' + Date.now().toString(36).toUpperCase(), CodOP: op.CodOP, Processo: m.Processo, OrdemEtapa: m.Ordem, IdRecursoRoteiro: m.IdRecursoRoteiro,
      CodEquipamento: m.CodEquipamento, Equipamento: m.Equipamento, Operador: txt(val('mes14_tp_oper')), DataApontamento: dataBR(ini), HoraInicio: horaHM(ini), DataFim: dataBR(fim), HoraFim: horaHM(fim), DuracaoMin: '',
      Status: 'Finalizado', Origem: 'MANUAL', Observacoes: txt(val('mes14_tp_obs')), CriadoEm: agora(), CriadoPor: usuario() };
    t.DuracaoMin = String(duracaoMin(t));
    D().apontamento_tempos.push(t);
    if (!/EM PRODU/i.test(String(op.Status || ''))) op.Status = 'Em Produção';
    window.__mes14Maq = m.chave;
    atualizarCalculosOP(op.CodOP);
    reexibirProducao('✔ Intervalo registrado em <b>' + esc(m.Equipamento) + '</b>: ' + fmtMin(duracaoMin(t)) + '.');
  };
  window.mesTempoExcluir = function (id) {
    var op = opSelecionada('prod_op'); if (!op) return;
    var t = temposDaOP(op.CodOP).find(function (x) { return x.IdApontamentoTempo === id; }); if (!t) return;
    if (!confirm('Excluir o apontamento de tempo de ' + (t.Equipamento || t.Processo || '') + ' (' + t.DataApontamento + ' ' + t.HoraInicio + '–' + (t.HoraFim || 'em andamento') + ')?')) return;
    D().apontamento_tempos = A(D().apontamento_tempos).filter(function (x) { return x !== t; });
    atualizarCalculosOP(op.CodOP);
    reexibirProducao('Apontamento de tempo excluído; o tempo real da máquina foi recalculado.');
  };
  window.mesTempoAtribuir = function (id) {
    var op = opSelecionada('prod_op'); if (!op) return;
    var t = temposDaOP(op.CodOP).find(function (x) { return x.IdApontamentoTempo === id; }); if (!t) return;
    var maqs = maquinasDaOP(op).filter(function (m) { return !t.Processo || norm(m.Processo) === norm(t.Processo); });
    if (!maqs.length) maqs = maquinasDaOP(op);
    abrirDialogo('<h3>Informar a máquina do apontamento</h3><p class="muted">' + esc(t.DataApontamento + ' ' + t.HoraInicio + '–' + (t.HoraFim || 'em andamento') + ' · ' + (t.Processo || '')) + '</p>' +
      '<div class="mes14-grid"><label class="wide"><span>Máquina</span><select id="mes14_atr_maq">' + maqs.map(function (m) { return '<option value="' + esc(m.chave) + '">Etapa ' + esc(m.Ordem) + ' · ' + esc(m.Processo) + ' · ' + esc(m.Equipamento) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="mes14-actions"><button onclick="mesTempoAtribuirConfirmar(\'' + jsStr(id) + '\')">Gravar</button><button class="secondary" onclick="mesFecharDialogo14()">Cancelar</button></div><div id="mes14_atr_msg" class="mes14-msg"></div>');
  };
  window.mesTempoAtribuirConfirmar = function (id) {
    var op = opSelecionada('prod_op'); if (!op) return;
    var t = temposDaOP(op.CodOP).find(function (x) { return x.IdApontamentoTempo === id; }); if (!t) return;
    var m = maquinasDaOP(op).find(function (x) { return x.chave === val('mes14_atr_maq'); }); if (!m) return;
    var ini = inicioTempo(t), fim = t.Status === 'Iniciado' ? new Date() : fimTempo(t);
    if (ini && fim && sobrepoe(op, m.chave, ini, fim, t.IdApontamentoTempo)) return aviso('mes14_atr_msg', 'Esta máquina já tem apontamento nesse horário.', 'erro');
    if (t.Status === 'Iniciado' && abertoNaMaquina(op, m.chave)) return aviso('mes14_atr_msg', 'Esta máquina já tem apontamento em andamento.', 'erro');
    t.OrdemEtapa = m.Ordem; t.IdRecursoRoteiro = m.IdRecursoRoteiro; t.CodEquipamento = m.CodEquipamento; t.Equipamento = m.Equipamento; t.Processo = m.Processo;
    if (t.Status === 'Finalizado') t.DuracaoMin = String(duracaoMin(t));
    t.AlteradoEm = agora(); t.AlteradoPor = usuario();
    fecharDialogo(); atualizarCalculosOP(op.CodOP);
    reexibirProducao('Máquina informada: ' + esc(m.Equipamento) + '.');
  };

  /* ---------------------------------------------------------------------
     5) ROTEIRO — QUE PI ENTRA EM QUAL OPERAÇÃO (data.roteiro_pi_entradas)
     O PI precisa ser produzido em uma operação ANTERIOR do mesmo roteiro (ou vir de fora do roteiro: estoque / PI
     isolado); uma operação não consome o próprio produto; o mesmo PI não entra duas vezes na mesma operação.
     O roteiro continua sem quantidades: na OP o PI planejado é a quantidade planejada da OP que o produz.
     --------------------------------------------------------------------- */
  function roteiroPor(cod) { var k = txt(cod); return A((D() || {}).roteiro).find(function (r) { return r && txt(r.CodRoteiro) === k; }) || null; }
  function roteiroAtual() { try { var r = typeof roteiroAtualV382 === 'function' ? roteiroAtualV382() : null; return r && r.CodRoteiro ? r : null; } catch (e) { return null; } }
  function entradasPI(codRot) { var k = txt(codRot); return A((D() || {}).roteiro_pi_entradas).filter(function (x) { return x && txt(x.CodRoteiro) === k; }); }
  function etapasRoteiro(codRot) { var k = txt(codRot); return A((D() || {}).roteiro_etapas).filter(function (e) { return e && txt(e.CodRoteiro) === k; }).sort(function (a, b) { return N(a.Ordem) - N(b.Ordem); }); }
  function produtoEtapa(e) { return txt(e && (e.ProdutoGerado || e.CodigoProduto || e.CodigoPI)); }
  function etapaProdutora(codRot, codPI) { var k = txt(codPI); return etapasRoteiro(codRot).find(function (e) { return produtoEtapa(e) === k; }) || null; }
  function etapaDoRoteiro(codRot, ordem) { return etapasRoteiro(codRot).find(function (e) { return txt(e.Ordem) === txt(ordem); }) || null; }
  function recursosEtapa(codRot, ordem) { return A((D() || {}).roteiro_recursos).filter(function (x) { return x && txt(x.CodRoteiro) === txt(codRot) && txt(x.OrdemEtapa || x.Ordem) === txt(ordem); }); }
  function idSeguro(v) { return String(v).replace(/[^A-Za-z0-9_-]/g, '_'); }
  function validarEntradaPI(codRot, ordem, codPI) {
    var et = etapaDoRoteiro(codRot, ordem); if (!et) return 'Operação ' + ordem + ' não encontrada no roteiro.';
    if (produtoEtapa(et) === txt(codPI)) return 'A operação ' + ordem + ' produz o ' + codPI + ': ela não pode consumir o próprio produto.';
    var prod = etapaProdutora(codRot, codPI);
    if (prod && N(prod.Ordem) >= N(ordem)) return 'O ' + codPI + ' é produzido na operação ' + prod.Ordem + ' (' + (prod.Processo || '') + '): ele só pode entrar em uma operação posterior.';
    if (entradasPI(codRot).some(function (x) { return txt(x.OrdemEtapa) === txt(ordem) && txt(x.CodigoPI) === txt(codPI); })) return 'O ' + codPI + ' já entra na operação ' + ordem + '.';
    if (!produto(codPI)) return 'O ' + codPI + ' não está cadastrado na Estrutura do Produto.';
    return '';
  }
  function candidatosPI(codRot, ordem) {
    var r = roteiroPor(codRot), et = etapasRoteiro(codRot), atual = etapaDoRoteiro(codRot, ordem), prodAtual = produtoEtapa(atual), produzidos = {}, internos = [], vistos = {};
    var ja = entradasPI(codRot).filter(function (x) { return txt(x.OrdemEtapa) === txt(ordem); }).map(function (x) { return txt(x.CodigoPI); });
    et.forEach(function (e) { produzidos[produtoEtapa(e)] = 1; });
    et.forEach(function (e) {
      var p = produtoEtapa(e); if (!p || vistos[p] || p === prodAtual || N(e.Ordem) >= N(ordem)) return;
      if (r && p === txt(r.CodigoProduto) && !ehPI(p)) return;
      vistos[p] = 1; if (ja.indexOf(p) < 0) internos.push({ cod: p, ordem: txt(e.Ordem), processo: e.Processo || '' });
    });
    var externos = A((D() || {}).estrutura).filter(function (p) { var c = txt(p['Código']); return String(p['Tipo Produto'] || '').toUpperCase() === 'PI' && !produzidos[c] && ja.indexOf(c) < 0; })
      .map(function (p) { return { cod: txt(p['Código']) }; });
    return { internos: internos, externos: externos };
  }
  function blocoEntradas(r, ordem) {
    var ents = entradasPI(r.CodRoteiro).filter(function (x) { return txt(x.OrdemEtapa) === txt(ordem); }), c = candidatosPI(r.CodRoteiro, ordem), recs = recursosEtapa(r.CodRoteiro, ordem), sid = idSeguro(ordem);
    var chips = ents.map(function (x) {
      var prod = etapaProdutora(r.CodRoteiro, x.CodigoPI);
      return '<span class="mes14-chip"><b>' + esc(x.CodigoPI) + '</b> ' + esc(descProduto(x.CodigoPI) || x.DescricaoPI || '') +
        ' <span class="mes14-subtle">' + (prod ? '← operação ' + esc(prod.Ordem) + ' (' + esc(prod.Processo || '') + ')' : '← de fora do roteiro') + (x.Equipamento ? ' · entra em ' + esc(x.Equipamento) : '') + '</span>' +
        '<button title="Remover" onclick="mesRotPIRemover(\'' + jsStr(x.IdEntradaPI) + '\')">✕</button></span>';
    }).join('');
    var opts = (c.internos.length ? '<optgroup label="Produzidos em operações anteriores deste roteiro">' + c.internos.map(function (x) { return '<option value="' + esc(x.cod) + '">' + esc(x.cod + ' — ' + (descProduto(x.cod) || '') + ' (operação ' + x.ordem + ' · ' + x.processo + ')') + '</option>'; }).join('') + '</optgroup>' : '') +
      (c.externos.length ? '<optgroup label="PI de fora deste roteiro (estoque / PI isolado)">' + c.externos.map(function (x) { return '<option value="' + esc(x.cod) + '">' + esc(x.cod + ' — ' + (descProduto(x.cod) || '')) + '</option>'; }).join('') + '</optgroup>' : '');
    return '<div class="mes14-pi-in" data-ordem="' + esc(ordem) + '"><div class="mes14-pi-in-head"><b>PIs que entram nesta operação</b><span>insumo vindo de operação anterior: aparece no apontamento desta etapa (consumo pela etiqueta/lote) e pode ser apontado como perda aqui</span></div>' +
      (chips || '<span class="mes14-subtle">Nenhum PI entra nesta operação.</span>') +
      '<div class="mes14-pi-add"><select id="mes14_rpi_' + sid + '"><option value="">+ PI que entra nesta operação…</option>' + opts + '</select>' +
      '<select id="mes14_rpm_' + sid + '"><option value="">Máquina onde entra: a primeira da operação</option>' + recs.map(function (x) { return '<option value="' + esc(x.IdRecursoRoteiro) + '">' + esc((x.Equipamento || x.CodEquipamento || '') + (x.SubProcesso ? ' · ' + x.SubProcesso : '')) + '</option>'; }).join('') + '</select>' +
      '<button class="mini" onclick="mesRotPIAdd(\'' + jsStr(ordem) + '\')">Adicionar</button></div></div>';
  }
  function diagnosticoFluxo(codRot) {
    var r = roteiroPor(codRot), et = etapasRoteiro(codRot), ents = entradasPI(codRot), produtos = [], linhas = [];
    et.forEach(function (e) { var p = produtoEtapa(e); if (p && produtos.indexOf(p) < 0) produtos.push(p); });
    produtos.forEach(function (p) {
      var prod = etapaProdutora(codRot, p), cons = ents.filter(function (x) { return txt(x.CodigoPI) === p; }), final = r && p === txt(r.CodigoProduto);
      var antes = cons.filter(function (x) { return prod && N(x.OrdemEtapa) <= N(prod.Ordem); });
      var sit = final ? tag('Produto final do roteiro', 'pa') : antes.length ? tag('Entra antes de ser produzido', 'erro') : cons.length ? tag('OK', 'ok') : tag('Não entra em nenhuma operação', 'alerta');
      linhas.push({ p: p, html: '<tr><td><b>' + esc(p) + '</b> ' + esc(descProduto(p)) + '</td><td>' + (prod ? esc(prod.Ordem + ' — ' + (prod.Processo || '')) : '—') + '</td><td>' +
        (cons.length ? cons.map(function (x) { var e = etapaDoRoteiro(codRot, x.OrdemEtapa); return esc(x.OrdemEtapa + ' — ' + ((e && e.Processo) || x.Processo || '')) + (x.Equipamento ? ' (' + esc(x.Equipamento) + ')' : ''); }).join('<br>') : '—') + '</td><td>' + sit + '</td></tr>',
        ok: final || (cons.length && !antes.length) });
    });
    ents.filter(function (x) { return !etapaProdutora(codRot, x.CodigoPI); }).forEach(function (x) {
      linhas.push({ p: x.CodigoPI, html: '<tr><td><b>' + esc(x.CodigoPI) + '</b> ' + esc(descProduto(x.CodigoPI)) + '</td><td>De fora do roteiro</td><td>' + esc(x.OrdemEtapa + ' — ' + (x.Processo || '')) + '</td><td>' + tag('Vem do estoque / PI isolado', 'info') + '</td></tr>', ok: true });
    });
    return linhas;
  }
  function cardFluxo(r) {
    var diag = diagnosticoFluxo(r.CodRoteiro), pend = diag.filter(function (x) { return !x.ok; }).length;
    return '<div class="mes14-card" id="mes14_fluxo_card"><h3>Fluxo dos PIs neste roteiro — que PI entra em qual operação</h3>' +
      '<p class="muted">O PI configurado em uma operação entra como insumo da OP dessa operação: aparece no Apontamento de Produção (consumo pela etiqueta/lote) e no Registro de Perdas daquela etapa. Configure em cada operação abaixo (“PIs que entram nesta operação”) ou use a sugestão automática.</p>' +
      tabela(['PI / produto', 'Produzido na operação', 'Entra na(s) operação(ões)', 'Situação'], diag.map(function (x) { return x.html; }), 'O roteiro ainda não tem operações.') +
      '<div class="mes14-actions"><button onclick="mesRotPISugerir()">Sugerir fluxo automaticamente</button><button class="secondary" onclick="mesRotPIAplicar()">Aplicar às OPs abertas deste roteiro</button>' +
      (pend ? tag(pend + ' pendência(s) no fluxo', 'alerta') : tag('Fluxo completo', 'ok')) + '</div>' +
      (r.FluxoPIAtualizadoEm ? '<div class="mes14-subtle">Última alteração do fluxo: ' + esc(r.FluxoPIAtualizadoEm) + ' por ' + esc(r.FluxoPIAtualizadoPor || '') + '</div>' : '') + '</div>';
  }
  function decorarRoteiro() {
    var root = el('rotDet'), r = roteiroAtual(); if (!root || !r) return;
    estilo();
    var antigo = el('mes14_fluxo_card'); if (antigo) antigo.remove();
    var head = root.querySelector('.roteiro-head-v382');
    if (head) head.insertAdjacentHTML('afterend', cardFluxo(r)); else root.insertAdjacentHTML('afterbegin', cardFluxo(r));
    root.querySelectorAll('.op-node-v382').forEach(function (node) {
      var ordem = String(node.id || '').replace(/^opnode_/, ''); if (!ordem || !etapaDoRoteiro(r.CodRoteiro, ordem)) return;
      var velho = node.querySelector('.mes14-pi-in'); if (velho) velho.remove();
      var h = node.querySelector('.op-head-v382'), html = blocoEntradas(r, ordem);
      if (h) h.insertAdjacentHTML('afterend', html); else node.insertAdjacentHTML('afterbegin', html);
    });
  }
  function marcarFluxoAlterado(r) { r.FluxoPIAtualizadoEm = agora(); r.FluxoPIAtualizadoPor = usuario(); r.DataUltimaAlteracao = agora(); }
  function redesenharRoteiro() { try { if (typeof renderRoteiroArvoreV382 === 'function') renderRoteiroArvoreV382(); else decorarRoteiro(); } catch (e) { decorarRoteiro(); } }
  function criarEntradaPI(r, ordem, codPI, idRec) {
    var et = etapaDoRoteiro(r.CodRoteiro, ordem) || {}, prod = etapaProdutora(r.CodRoteiro, codPI);
    var rec = idRec ? recursosEtapa(r.CodRoteiro, ordem).find(function (x) { return txt(x.IdRecursoRoteiro) === txt(idRec); }) : null;
    var x = { IdEntradaPI: idNovo('RPI'), CodRoteiro: r.CodRoteiro, OrdemEtapa: txt(ordem), Processo: et.Processo || '', ProdutoEtapa: produtoEtapa(et), IdRecursoRoteiro: rec ? txt(rec.IdRecursoRoteiro) : '',
      CodEquipamento: rec ? txt(rec.CodEquipamento) : '', Equipamento: rec ? (rec.Equipamento || '') : '', CodigoPI: txt(codPI), DescricaoPI: descProduto(codPI), UM: umProduto(codPI),
      OrdemEtapaOrigem: prod ? txt(prod.Ordem) : '', ProcessoOrigem: prod ? (prod.Processo || '') : '', Origem: prod ? 'ROTEIRO' : 'EXTERNO', CriadoEm: agora(), CriadoPor: usuario() };
    D().roteiro_pi_entradas.push(x);
    return x;
  }
  window.mesRotPIAdd = function (ordem) {
    var r = roteiroAtual(); if (!r) return alert('Selecione um roteiro.');
    var sid = idSeguro(ordem), cod = val('mes14_rpi_' + sid), idRec = val('mes14_rpm_' + sid);
    if (!cod) return alert('Selecione o PI que entra na operação ' + ordem + '.');
    var erro = validarEntradaPI(r.CodRoteiro, ordem, cod); if (erro) return alert(erro);
    criarEntradaPI(r, ordem, cod, idRec);
    marcarFluxoAlterado(r);
    sincronizarRoteiro(r.CodRoteiro);
    salvar(); redesenharRoteiro();
  };
  window.mesRotPIRemover = function (id) {
    var d = D(), x = A(d.roteiro_pi_entradas).find(function (e) { return e.IdEntradaPI === id; }); if (!x) return;
    var r = roteiroPor(x.CodRoteiro);
    var usadas = A(d.op_materiais).filter(function (m) { return m.IdEntradaPI === id && (consumidoPelaOP(m.CodOP, m.CodigoMaterial) > 0 || perdasPIDaOP(m.CodOP, m.CodigoMaterial).length); }).map(function (m) { return m.CodOP; });
    if (!confirm('Tirar o ' + x.CodigoPI + ' da operação ' + x.OrdemEtapa + '?' + (usadas.length ? '\n\nAs OPs ' + usadas.join(', ') + ' já têm consumo/perda deste PI: nelas a linha do PI fica (marcada como removida do roteiro) para não perder a rastreabilidade.' : '\n\nAs OPs abertas deste roteiro deixam de ter este PI como insumo.'))) return;
    d.roteiro_pi_entradas = A(d.roteiro_pi_entradas).filter(function (e) { return e.IdEntradaPI !== id; });
    if (r) { marcarFluxoAlterado(r); sincronizarRoteiro(r.CodRoteiro); }
    salvar(); redesenharRoteiro();
  };
  function sugestoesFluxo(codRot) {
    var et = etapasRoteiro(codRot), atuais = entradasPI(codRot), out = [], usados = {};
    atuais.forEach(function (x) { usados[txt(x.CodigoPI)] = 1; });
    var papel = typeof v1011Role === 'function' ? function (c) { try { return v1011Role(c); } catch (e) { return 'OTHER'; } } : function () { return 'OTHER'; };
    var anteriores = typeof v1011PrevRoles === 'function' ? function (p) { try { return v1011PrevRoles(p) || []; } catch (e) { return []; } } : function () { return []; };
    et.forEach(function (e, idx) {
      var p = produtoEtapa(e); if (!p) return;
      if (atuais.some(function (x) { return txt(x.OrdemEtapa) === txt(e.Ordem); })) return;
      var pp = papel(p), prev = anteriores(pp), cands = [];
      if (prev.length) cands = et.filter(function (x) { var c = produtoEtapa(x); return N(x.Ordem) < N(e.Ordem) && c && c !== p && prev.indexOf(papel(c)) >= 0; });
      /* papel desconhecido (nome fora do padrão slurry → depositado → cortado → jelly roll → PA): PI da operação anterior;
         produto que começa a cadeia (slurry) não recebe sugestão */
      if (!cands.length && idx > 0 && (pp === 'OTHER' || !pp)) {
        var ant = et.slice(0, idx).reverse().find(function (x) { return produtoEtapa(x) && produtoEtapa(x) !== p && N(x.Ordem) < N(e.Ordem); });
        if (ant && ehPI(produtoEtapa(ant)) && !usados[produtoEtapa(ant)]) cands = [ant];
      }
      cands.forEach(function (x) {
        var c = produtoEtapa(x);
        if (out.some(function (o) { return o.ordem === txt(e.Ordem) && o.cod === c; })) return;
        out.push({ ordem: txt(e.Ordem), processo: e.Processo || '', cod: c, origem: txt(x.Ordem), processoOrigem: x.Processo || '' });
        usados[c] = 1;
      });
    });
    return out;
  }
  window.mesRotPISugerir = function () {
    var r = roteiroAtual(); if (!r) return alert('Selecione um roteiro.');
    var s = sugestoesFluxo(r.CodRoteiro).filter(function (x) { return !validarEntradaPI(r.CodRoteiro, x.ordem, x.cod); });
    if (!s.length) return alert('Nada a sugerir: as operações deste roteiro já têm PIs de entrada configurados ou não há PI anterior compatível.');
    if (!confirm('Configurar estas entradas de PI?\n\n' + s.map(function (x) { return 'Operação ' + x.ordem + ' (' + x.processo + ')  ←  ' + x.cod + ' ' + descProduto(x.cod) + '  [produzido na operação ' + x.origem + ']'; }).join('\n') + '\n\nVocê pode tirar ou acrescentar depois em cada operação.')) return;
    s.forEach(function (x) { criarEntradaPI(r, x.ordem, x.cod, ''); });
    marcarFluxoAlterado(r);
    sincronizarRoteiro(r.CodRoteiro);
    salvar(); redesenharRoteiro();
  };
  window.mesRotPIAplicar = function () {
    var r = roteiroAtual(); if (!r) return alert('Selecione um roteiro.');
    var n = sincronizarRoteiro(r.CodRoteiro);
    salvar();
    var abertas = A(D().op).filter(function (o) { return txt(o.CodRoteiro) === txt(r.CodRoteiro) && opAberta(o); }).length;
    alert(abertas ? 'Fluxo de PIs aplicado às ' + abertas + ' OP(s) abertas do roteiro ' + r.CodRoteiro + (n ? ' (' + n + ' alteração(ões)).' : ' (já estavam atualizadas).') : 'Não há OP aberta do roteiro ' + r.CodRoteiro + '. As próximas OPs geradas já recebem o fluxo.');
  };
  /* cópia de roteiro leva o fluxo de PIs; exclusão de operação tira as entradas daquela operação */
  (function () {
    var copiarAnt = window.copiarRoteiroV386;
    if (typeof copiarAnt === 'function') {
      window.copiarRoteiroV386 = function () {
        var origem = roteiroAtual(), antes = {};
        A(D().roteiro).forEach(function (r) { antes[txt(r.CodRoteiro)] = 1; });
        var ret = copiarAnt.apply(this, arguments);
        try {
          var novo = A(D().roteiro).find(function (r) { return r && !antes[txt(r.CodRoteiro)]; });
          if (origem && novo) {
            entradasPI(origem.CodRoteiro).forEach(function (x) {
              var c = JSON.parse(JSON.stringify(x)); c.IdEntradaPI = idNovo('RPI'); c.CodRoteiro = novo.CodRoteiro; c.CopiadoDe = x.IdEntradaPI; c.CriadoEm = agora(); c.CriadoPor = usuario();
              D().roteiro_pi_entradas.push(c);
            });
            salvar(); redesenharRoteiro();
          }
        } catch (e) { console.warn('MES LION 1.4: cópia do fluxo de PIs', e); }
        return ret;
      };
    }
    var excluirAnt = window.excluirOperacaoV382;
    if (typeof excluirAnt === 'function') {
      window.excluirOperacaoV382 = function (ordem) {
        var r = roteiroAtual();
        var ret = excluirAnt.apply(this, arguments);
        try {
          if (r && !etapaDoRoteiro(r.CodRoteiro, ordem)) {
            var d = D(), antes = A(d.roteiro_pi_entradas).length;
            d.roteiro_pi_entradas = A(d.roteiro_pi_entradas).filter(function (x) { return !(txt(x.CodRoteiro) === txt(r.CodRoteiro) && txt(x.OrdemEtapa) === txt(ordem)); });
            if (d.roteiro_pi_entradas.length !== antes) { marcarFluxoAlterado(r); sincronizarRoteiro(r.CodRoteiro); salvar(); redesenharRoteiro(); }
          }
        } catch (e) { console.warn('MES LION 1.4: exclusão de operação', e); }
        return ret;
      };
    }
  })();

  /* Estrutura do produto: fluxo em níveis montado pelo roteiro (PA ← PI ← PI ...), com as matérias-primas de cada operação */
  function roteirosDoPA(codPA) {
    return A((D() || {}).roteiro).filter(function (r) { return r && txt(r.CodigoProduto) === txt(codPA) && String(r.Ativo || 'TRUE').toUpperCase() !== 'FALSE'; });
  }
  /* roteiro mostrado no fluxo: o último que teve o fluxo de PIs alterado; senão um com fluxo; senão o salvo */
  function roteiroPrincipalDe(codPA) {
    var rs = roteirosDoPA(codPA);
    var comFluxo = rs.filter(function (r) { return entradasPI(r.CodRoteiro).length; });
    if (comFluxo.length) {
      comFluxo.sort(function (a, b) { return (parseDataHora(String(b.FluxoPIAtualizadoEm || '').slice(0, 10), String(b.FluxoPIAtualizadoEm || '').slice(12, 17) || '00:00') || 0) - (parseDataHora(String(a.FluxoPIAtualizadoEm || '').slice(0, 10), String(a.FluxoPIAtualizadoEm || '').slice(12, 17) || '00:00') || 0); });
      return comFluxo[0];
    }
    var salvo = rs.find(function (r) { try { return typeof roteiroEstaSalvoV387 === 'function' && roteiroEstaSalvoV387(r); } catch (e) { return false; } });
    return salvo || rs[0] || null;
  }
  function arvoreFluxoHTML(r) {
    var et = etapasRoteiro(r.CodRoteiro), ents = entradasPI(r.CodRoteiro), final = txt(r.CodigoProduto) || produtoEtapa(et[et.length - 1]);
    var noFluxo = {};
    function mps(etapas) {
      var vistos = {}, lst = [];
      A(D().roteiro_materiais).forEach(function (m) {
        if (!m || txt(m.CodRoteiro) !== txt(r.CodRoteiro) || !etapas.some(function (e) { return txt(e.Ordem) === txt(m.OrdemEtapa || m.Ordem); })) return;
        if (vistos[m.CodigoMaterial]) return; vistos[m.CodigoMaterial] = 1; lst.push(m);
      });
      return lst.map(function (m) { return '<div class="mp">▪ ' + esc(m.CodigoMaterial) + ' — ' + esc(m.DescricaoMaterial || '') + ' <span class="mes14-subtle">(MP' + (m.Recurso ? ' · ' + esc(m.Recurso) : '') + ')</span></div>'; }).join('');
    }
    function no(cod, caminho) {
      noFluxo[cod] = 1;
      var etapas = et.filter(function (e) { return produtoEtapa(e) === cod; });
      var badge = ehPI(cod) ? '<span class="mes14-tag pi">PI</span>' : '<span class="mes14-tag pa">PA</span>';
      if (!etapas.length) return '<div class="mp">◇ ' + badge + ' <b>' + esc(cod) + '</b> ' + esc(descProduto(cod)) + ' <span class="seta">vem de fora do roteiro (estoque / PI isolado)</span></div>';
      if (caminho.indexOf(cod) >= 0) return '<div class="mp">↺ ' + esc(cod) + ' (ciclo no fluxo — revise o roteiro)</div>';
      var filhos = ents.filter(function (x) { return etapas.some(function (e) { return txt(e.Ordem) === txt(x.OrdemEtapa); }); });
      return '<details open><summary>' + badge + ' <b>' + esc(cod) + '</b> ' + esc(descProduto(cod)) + '<span class="seta">operação ' + esc(etapas.map(function (e) { return e.Ordem + ' · ' + (e.Processo || ''); }).join(' / ')) + '</span></summary>' +
        mps(etapas) + filhos.map(function (x) { return '<div class="mes14-subtle" style="margin-left:18px">entra na operação ' + esc(x.OrdemEtapa) + (x.Equipamento ? ' (' + esc(x.Equipamento) + ')' : '') + ':</div>' + no(txt(x.CodigoPI), caminho.concat([cod])); }).join('') + '</details>';
    }
    var html = no(final, []);
    var fora = A(D().estrutura).filter(function (p) { return txt(p['Código Pai']) === final && String(p['Tipo Produto'] || '').toUpperCase() === 'PI' && !noFluxo[txt(p['Código'])]; });
    return html + (fora.length ? '<p class="mes14-msg alerta">PIs do ' + esc(final) + ' fora do fluxo (não entram em nenhuma operação ligada ao PA): ' + esc(fora.map(function (p) { return p['Código']; }).join(', ')) + '. Configure no roteiro.</p>' : '');
  }
  function decorarEstrutura() {
    var c = el('content'); if (!c || el('mes14_estr_fluxo')) return;
    estilo();
    var pas = A(D().estrutura).filter(function (p) { return String(p['Tipo Produto'] || '').toUpperCase() === 'PA' || (!p['Tipo Produto'] && /^PA/i.test(txt(p['Código']))); }).filter(function (p) { return roteiroPrincipalDe(p['Código']); });
    var sel = window.__mes14EstrPA && pas.some(function (p) { return txt(p['Código']) === window.__mes14EstrPA; }) ? window.__mes14EstrPA : txt((pas[0] || {})['Código']);
    var host = c.querySelector('.v1014-tree-host');
    var html = '<div class="mes14-card mes14-fluxo" id="mes14_estr_fluxo"><h3>Fluxo de produção em níveis (pelo roteiro)</h3>' +
      '<p class="muted">Mostra em que operação cada PI entra: o PA consome o PI da operação anterior, que consome o seu, até as matérias-primas. A ligação é configurada no Roteiro (“PIs que entram nesta operação”); o cadastro PA → PI acima continua igual.</p>' +
      (pas.length ? '<div class="mes14-grid"><label><span>PA</span><select id="mes14_estr_pa" onchange="window.__mes14EstrPA=this.value;window.__mes14EstrRot=\'\';mesEstruturaFluxo()">' + pas.map(function (p) { return '<option value="' + esc(p['Código']) + '"' + (txt(p['Código']) === sel ? ' selected' : '') + '>' + esc(p['Código'] + ' — ' + (p['Descrição'] || '')) + '</option>'; }).join('') + '</select></label>' +
        '<label class="wide"><span>Roteiro</span><select id="mes14_estr_rot" onchange="window.__mes14EstrRot=this.value;mesEstruturaFluxo()"></select></label></div><div id="mes14_estr_arvore"></div>' : '<p class="muted">Nenhum PA com roteiro cadastrado.</p>') + '</div>';
    if (host) host.insertAdjacentHTML('afterend', html); else c.insertAdjacentHTML('beforeend', html);
    window.__mes14EstrPA = sel;
    window.mesEstruturaFluxo();
  }
  window.mesEstruturaFluxo = function () {
    var box = el('mes14_estr_arvore'); if (!box) return;
    var rs = roteirosDoPA(window.__mes14EstrPA), r = (window.__mes14EstrRot && rs.find(function (x) { return x.CodRoteiro === window.__mes14EstrRot; })) || roteiroPrincipalDe(window.__mes14EstrPA);
    var sr = el('mes14_estr_rot');
    if (sr) sr.innerHTML = rs.map(function (x) { var n = entradasPI(x.CodRoteiro).length; return '<option value="' + esc(x.CodRoteiro) + '"' + (r && x.CodRoteiro === r.CodRoteiro ? ' selected' : '') + '>' + esc(x.CodRoteiro + ' — ' + (x.DescricaoRoteiro || '') + (n ? ' · ' + n + ' entrada(s) de PI' : ' · sem fluxo de PIs')) + '</option>'; }).join('');
    if (!r) { box.innerHTML = '<p class="muted">PA sem roteiro.</p>'; return; }
    var ents = entradasPI(r.CodRoteiro);
    box.innerHTML = '<p class="mes14-subtle">Roteiro ' + esc(r.CodRoteiro) + ' — ' + esc(r.DescricaoRoteiro || '') + '</p>' +
      (ents.length ? '' : '<p class="mes14-msg alerta">Este roteiro ainda não diz que PI entra em qual operação. <button class="mini" onclick="mesAbrirRoteiro14(\'' + jsStr(r.CodRoteiro) + '\')">Configurar no roteiro</button></p>') + arvoreFluxoHTML(r);
  };
  window.mesAbrirRoteiro14 = function (cod) {
    render('roteiro');
    setTimeout(function () { var s = el('v382_rot'); if (s) { s.value = cod; redesenharRoteiro(); } }, 60);
  };

  /* ---------------------------------------------------------------------
     6) PIs COMO INSUMO NAS OPs
     OP aberta cujo roteiro tem entradas de PI na sua etapa recebe a linha "PI intermediário" (OrigemDados
     FLUXO_PI_ROTEIRO), ligada à OP da mesma família que produz o PI (OPOrigemPI) e com a quantidade planejada dessa
     OP. Linhas já existentes do mesmo PI (cadeia V1.0.11) são aproveitadas, sem duplicar. As linhas de "Integração /
     genealogia" da OP de PA ficam só como genealogia quando o mesmo PI já entra em uma operação da família.
     As linhas de PI continuam fora de massa, custo de materiais, MRP e ACV (o PI já está contado na OP que o produz).
     --------------------------------------------------------------------- */
  function sincronizarOP(op) {
    if (!op || !opAberta(op) || !txt(op.CodRoteiro)) return 0;
    var d = D(), ents = entradasPI(op.CodRoteiro), mud = 0, k = txt(op.CodOP), prodOP = codProdutoOP(op), raiz = raizFamilia(op);
    var ordens = {}; etapasDaOP(op.CodOP).forEach(function (e) { ordens[txt(e.Ordem)] = 1; });
    ents.forEach(function (x) {
      var cod = txt(x.CodigoPI);
      if (!ordens[txt(x.OrdemEtapa)] || !cod || cod === prodOP) return;
      var linha = A(d.op_materiais).find(function (m) { return m && txt(m.CodOP) === k && ehLinhaPI(m) && !ehGenealogia(m) && txt(m.CodigoMaterial || m.CodigoPI) === cod; });
      var origem = opOrigemNaFamilia(raiz, cod); if (origem && txt(origem.CodOP) === k) origem = null;
      var etOP = etapasDaOP(op.CodOP).filter(function (e) { return txt(e.Ordem) === txt(x.OrdemEtapa); });
      var rec = (x.IdRecursoRoteiro && etOP.find(function (e) { return txt(e.IdRecursoRoteiro) === txt(x.IdRecursoRoteiro); })) || etOP[0] || {};
      if (!linha) {
        linha = { CodOP: op.CodOP, CodRoteiro: op.CodRoteiro, Ordem: txt(x.OrdemEtapa), OrdemEtapa: txt(x.OrdemEtapa), CodigoProduto: prodOP, CodigoPI: cod, Processo: x.Processo || rec.Processo || '',
          IdRecursoRoteiro: txt(rec.IdRecursoRoteiro), CodEquipamento: txt(rec.CodEquipamento), CodigoMaterial: cod, DescricaoMaterial: descProduto(cod) || x.DescricaoPI || cod,
          EntradaMaterial: origem ? origem.CodOP : '', Lote: '', OPOrigemPI: origem ? origem.CodOP : '', QtdPlanejada: origem ? txt(origem.QtdPlanejada) : '', QtdBase: '', UM: umProduto(cod) || x.UM || '',
          CustoUnitario: '0', CustoTotal: '0', TipoConsumo: 'PI intermediário', IdEntradaPI: x.IdEntradaPI, OrigemDados: 'FLUXO_PI_ROTEIRO', RegraQuantidade: 'PI_CONSUMIDO_ETAPA_SEGUINTE',
          OrigemQuantidade: origem ? 'QTD_PLANEJADA_DA_OP_DE_ORIGEM' : 'DEFINIDA_NO_CONSUMO',
          Observacoes: 'PI ' + cod + ' entra na etapa ' + x.OrdemEtapa + ' (' + (x.Processo || '') + ') pelo fluxo de PIs do roteiro ' + op.CodRoteiro + '. Consumo e perda apontados pela etiqueta/lote.' };
        d.op_materiais.push(linha); mud++;
      } else {
        if (!linha.IdEntradaPI) { linha.IdEntradaPI = x.IdEntradaPI; mud++; }
        if (!txt(linha.OPOrigemPI) && !txt(linha.Lote) && origem) { linha.OPOrigemPI = origem.CodOP; if (!txt(linha.EntradaMaterial)) linha.EntradaMaterial = origem.CodOP; mud++; }
        if (linha.RemovidoDoRoteiro === 'Sim') { delete linha.RemovidoDoRoteiro; mud++; }
      }
      if (linha.OrigemDados === 'FLUXO_PI_ROTEIRO') {
        var plan = origem ? txt(origem.QtdPlanejada) : txt(linha.QtdPlanejada);
        if (txt(linha.QtdPlanejada) !== plan) { linha.QtdPlanejada = plan; mud++; }
        var um = umProduto(cod) || linha.UM; if (um && linha.UM !== um) { linha.UM = um; mud++; }
      }
    });
    var remover = [];
    A(d.op_materiais).forEach(function (m) {
      if (!m || txt(m.CodOP) !== k || m.OrigemDados !== 'FLUXO_PI_ROTEIRO') return;
      var existe = ents.some(function (x) { return x.IdEntradaPI === m.IdEntradaPI || (txt(x.OrdemEtapa) === txt(m.OrdemEtapa) && txt(x.CodigoPI) === txt(m.CodigoMaterial)); });
      if (existe) return;
      if (consumidoPelaOP(op.CodOP, m.CodigoMaterial) > 0 || perdasPIDaOP(op.CodOP, m.CodigoMaterial).length) { if (m.RemovidoDoRoteiro !== 'Sim') { m.RemovidoDoRoteiro = 'Sim'; mud++; } }
      else remover.push(m);
    });
    if (remover.length) { d.op_materiais = A(d.op_materiais).filter(function (m) { return remover.indexOf(m) < 0; }); mud += remover.length; }
    return mud;
  }
  function marcarGenealogia(raiz) {
    var d = D(), cods = {}, fluxo = {}, mud = 0;
    opsDaFamilia(raiz).forEach(function (o) { cods[txt(o.CodOP)] = 1; });
    A(d.op_materiais).forEach(function (m) { if (m && cods[txt(m.CodOP)] && ehLinhaPI(m) && !ehGenealogia(m)) fluxo[txt(m.CodigoMaterial || m.CodigoPI)] = 1; });
    A(d.op_materiais).forEach(function (m) {
      if (!m || !cods[txt(m.CodOP)] || !ehGenealogia(m)) return;
      var s = fluxo[txt(m.CodigoMaterial || m.CodigoPI)] ? 'Sim' : '';
      if ((m.FluxoPISubstituido || '') !== s) { if (s) m.FluxoPISubstituido = 'Sim'; else delete m.FluxoPISubstituido; mud++; }
    });
    return mud;
  }
  function sincronizarFamilia(raiz) {
    var ops = opsDaFamilia(raiz); if (!ops.some(opAberta)) return 0;
    var mud = 0;
    ops.forEach(function (o) { mud += sincronizarOP(o); });
    mud += marcarGenealogia(raiz);
    if (mud) mudou();
    return mud;
  }
  function sincronizarRoteiro(codRot) {
    var raizes = {};
    A(D().op).forEach(function (o) { if (o && txt(o.CodRoteiro) === txt(codRot) && opAberta(o)) raizes[raizFamilia(o)] = 1; });
    var n = 0; Object.keys(raizes).forEach(function (r) { n += sincronizarFamilia(r); });
    return n;
  }
  function sincronizarTudo() {
    var raizes = {};
    A((D() || {}).op).forEach(function (o) { if (o && opAberta(o)) raizes[raizFamilia(o)] = 1; });
    var n = 0; Object.keys(raizes).forEach(function (r) { n += sincronizarFamilia(r); });
    return n;
  }

  /* fontes de PI para consumo: etiquetas com saldo e saldo sem etiqueta (produção anterior à 1.4.0), da mesma família primeiro */
  function fontesPI(codPI, opC) {
    var raiz = raizFamilia(opC), lst = [];
    lotesDoProduto(codPI).forEach(function (L) {
      if (opC && txt(L.CodOP) === txt(opC.CodOP)) return;
      var mesma = L.Familia === raiz;
      L.Etiquetas.forEach(function (x) { if (x.Saldo > 1e-9) lst.push({ valor: 'E:' + x.e.IdEtiqueta, etiqueta: x.e.IdEtiqueta, L: L, saldo: Math.min(x.Saldo, Math.max(0, L.Saldo)), mesma: mesma }); });
      if (L.SaldoSemEtiqueta > 1e-9 && L.Saldo > 1e-9) lst.push({ valor: 'L:' + L.IdLote, etiqueta: '', L: L, saldo: Math.min(L.SaldoSemEtiqueta, L.Saldo), mesma: mesma });
    });
    return lst.filter(function (f) { return f.saldo > 1e-9; }).sort(function (a, b) { return (b.mesma - a.mesma) || String(a.L.CodOP).localeCompare(String(b.L.CodOP), 'pt-BR', { numeric: true }) || String(a.etiqueta).localeCompare(String(b.etiqueta), 'pt-BR', { numeric: true }); });
  }
  function rotuloFonte(f) {
    var o = f.L.op || {};
    return (f.etiqueta ? 'Etiqueta ' + f.etiqueta : 'Lote ' + f.L.IdLote + ' (sem etiqueta)') + ' · ' + f.L.CodOP + ' · saldo ' + f4(f.saldo) + ' ' + (f.L.UM || '') + (f.mesma ? ' · mesma família' : ' · outra família/PI isolado') + (opConcluida(o) ? '' : ' · OP de origem aberta');
  }
  function fonteEscolhida(valor) {
    var v = txt(valor); if (!v) return null;
    if (v.indexOf('E:') === 0) { var inf = infoEtiqueta(v.slice(2)); return inf ? { etiqueta: v.slice(2), L: inf.lote, saldo: Math.min(inf.et.Saldo, Math.max(0, inf.lote.Saldo)) } : null; }
    if (v.indexOf('L:') === 0) { var L = livro().lotes[v.slice(2)]; return L ? { etiqueta: '', L: L, saldo: Math.min(L.SaldoSemEtiqueta, L.Saldo) } : null; }
    return null;
  }
  function painelPI(op, fechada) {
    var linhas = linhasPIDaOP(op.CodOP);
    if (!linhas.length) {
      return '<div class="mes14-card" id="mes14_pi"><h3>Consumo de PIs (produtos intermediários)</h3><p class="muted">Esta OP não consome PI. Para um PI entrar nesta etapa, configure no Roteiro em “PIs que entram nesta operação”.</p>' +
        (txt(op.CodRoteiro) ? '<div class="mes14-actions"><button class="secondary" onclick="mesAbrirRoteiro14(\'' + jsStr(op.CodRoteiro) + '\')">Abrir o roteiro ' + esc(op.CodRoteiro) + '</button></div>' : '') + '</div>';
    }
    var maqs = maquinasDaOP(op);
    var resumo = linhas.map(function (m, i) {
      var cod = txt(m.CodigoMaterial), cons = consumidoPelaOP(op.CodOP, cod), perdas = perdasPIDaOP(op.CodOP, cod).reduce(function (s, p) { return s + N(p.QuantidadePerdida); }, 0), plan = N(m.QtdPlanejada);
      var origem = txt(m.Lote) ? 'Lote ' + m.Lote : (txt(m.OPOrigemPI) ? 'OP ' + m.OPOrigemPI : 'Estoque (etiqueta/lote)');
      var sit = plan > 0 ? (cons + 1e-9 >= plan ? tag('Consumido', 'ok') : (cons > 0 ? tag('Parcial', 'info') : tag('A consumir', 'alerta'))) : (cons > 0 ? tag('Consumido', 'ok') : tag('A consumir', 'alerta'));
      return '<tr><td><b>' + esc(cod) + '</b> ' + esc(m.DescricaoMaterial || descProduto(cod)) + (m.RemovidoDoRoteiro === 'Sim' ? ' ' + tag('removido do roteiro', 'alerta') : '') + (ehGenealogia(m) ? ' ' + tag('genealogia', '') : '') + '</td>' +
        '<td>' + esc((m.OrdemEtapa || '') + ' — ' + (m.Processo || '')) + '</td><td>' + esc(origem) + '</td><td class="mes14-num">' + (plan > 0 ? f4(plan) : '—') + ' ' + esc(m.UM || '') + '</td>' +
        '<td class="mes14-num"><b>' + f4(cons) + '</b></td><td class="mes14-num">' + f4(perdas) + '</td><td class="mes14-num">' + (plan > 0 ? f4(Math.max(0, plan - cons)) : '—') + '</td><td>' + sit + '</td></tr>';
    });
    var hist = A(D().op_pi_consumos).filter(function (c) { return txt(c.CodOPConsumidora) === txt(op.CodOP) || (!txt(c.CodOPConsumidora) && txt(c.CodOPPA) === txt(op.CodOP)); })
      .slice().reverse().map(function (c) {
        var ativo = ativoConsumo(c);
        return '<tr' + (ativo ? '' : ' style="opacity:.55"') + '><td>' + esc(c.DataApontamento || c.DataConsumo || '') + '</td><td><b>' + esc(c.CodigoPI) + '</b></td><td>' + esc(c.IdEtiqueta || '—') + '</td><td>' + esc(c.IdLotePI || '') + '</td><td>' + esc(c.CodOPOrigemPI || '') + '</td>' +
          '<td class="mes14-num">' + f4(c.QtdRetirada || c.QuantidadeConsumida) + '</td><td class="mes14-num">' + f4(c.QtdDevolvida || 0) + '</td><td class="mes14-num"><b>' + f4(c.QuantidadeConsumida) + '</b> ' + esc(c.UM || '') + '</td>' +
          '<td>' + esc(c.Equipamento || c.Processo || '') + '</td><td>' + esc(rotuloOrigemConsumo(c)) + (c.PIExterno === 'Sim' ? ' ' + tag('externo', 'info') : '') + '</td><td>' + esc(c.Operador || '') + '</td>' +
          '<td>' + (ativo ? (fechada ? '' : '<button class="mini danger" onclick="mesPIEstornar(\'' + jsStr(c.IdConsumoPI) + '\')">Estornar</button>') : tag('Estornado', 'alerta')) + '</td></tr>';
      });
    var catOpts = categorias(false).map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    return '<div class="mes14-card" id="mes14_pi"><h3>Consumo de PIs (produtos intermediários) nesta OP</h3>' +
      '<p class="muted">O PI que entra nesta etapa é baixado da etiqueta (ou do lote) da OP que o produziu. Retirado − devolvido = consumo (sai do estoque de PI). A perda informada aqui é a parte do consumo que se perdeu na etapa: fica registrada como perda do PI, sem baixar o estoque de novo.</p>' +
      (fechada ? '' : campoLeitura('mes14_pi_scan', 'Ler a etiqueta do PI', 'Bipe a etiqueta do PI (código ET…) e tecle Enter', 'mesPILerEtiqueta')) +
      tabela(['PI', 'Entra na etapa', 'Origem prevista', 'Planejado', 'Consumido', 'Perdido na etapa', 'A consumir', 'Situação'], resumo) +
      (fechada ? '<p class="muted">OP encerrada: consumos bloqueados.</p>' :
        '<div class="mes14-grid"><label class="wide"><span>PI</span><select id="mes14_pi_linha" onchange="mesPIAtualizarForm()">' + linhas.map(function (m, i) { return '<option value="' + i + '">' + esc(m.CodigoMaterial + ' — ' + (m.DescricaoMaterial || '') + ' · etapa ' + (m.OrdemEtapa || '')) + '</option>'; }).join('') + '</select></label>' +
        '<label class="wide"><span>Etiqueta / lote de origem</span><select id="mes14_pi_fonte" onchange="mesPIAtualizarSaldo()"></select></label>' +
        '<label><span>Máquina</span><select id="mes14_pi_maq">' + maqs.map(function (m) { return '<option value="' + esc(m.chave) + '">' + esc('Etapa ' + m.Ordem + ' · ' + m.Equipamento) + '</option>'; }).join('') + '</select></label>' +
        '<label><span>Saldo da origem</span><input id="mes14_pi_saldo" readonly></label>' +
        '<label><span>Quantidade retirada</span><input id="mes14_pi_ret" inputmode="decimal" placeholder="0"></label><label><span>Quantidade devolvida</span><input id="mes14_pi_dev" inputmode="decimal" value="0"></label>' +
        '<label><span>Perdida nesta etapa (da retirada)</span><input id="mes14_pi_per" inputmode="decimal" value="0"></label>' +
        '<label><span>Categoria da perda</span><select id="mes14_pi_cat" onchange="mesPIMotivos()">' + catOpts + '</select></label><label><span>Motivo da perda</span><select id="mes14_pi_mot"></select></label>' +
        '<label><span>Data</span><input id="mes14_pi_data" value="' + esc(hoje()) + '"></label><label><span>Operador</span><input id="mes14_pi_oper" value="' + esc(val('ap_operador')) + '"></label>' +
        '<label class="wide"><span>Observação</span><input id="mes14_pi_obs" placeholder="Opcional"></label></div>' +
        '<div class="mes14-actions"><button onclick="mesPIRegistrarConsumo()">Registrar consumo do PI</button></div>') +
      '<div id="mes14_pi_msg" class="mes14-msg"></div><h4>Consumos de PI desta OP</h4>' +
      tabela(['Data', 'PI', 'Etiqueta', 'Lote', 'OP de origem', 'Retirado', 'Devolvido', 'Consumo', 'Máquina', 'Lançamento', 'Operador', ''], hist, 'Nenhum consumo de PI lançado nesta OP.') + '</div>';
  }
  function rotuloOrigemConsumo(c) {
    var o = String(c.Origem || '');
    if (o === 'APONTAMENTO_PI') return 'Apontamento';
    if (o === 'BAIXA_AUTOMATICA_ENCERRAMENTO') return 'Baixa automática no encerramento';
    if (o === 'BAIXA_LEGADO_1.4.0') return 'Baixa de OP encerrada antes da 1.4';
    if (/LOTE_PI_EXISTENTE/.test(o)) return 'Lote escolhido na geração da OP';
    return o || '—';
  }
  window.mesPIMotivos = function () {
    var s = el('mes14_pi_mot'); if (!s) return;
    var lst = motivosDaCategoria(val('mes14_pi_cat'), true);
    s.innerHTML = '<option value="">' + (lst.length ? 'Selecione o motivo...' : '(sem motivos nesta categoria)') + '</option>' + lst.map(function (m) { return '<option value="' + esc(m.IdMotivo) + '">' + esc(m.Motivo) + '</option>'; }).join('');
  };
  window.mesPIAtualizarForm = function (selecionarFonte) {
    var op = opSelecionada('prod_op'); if (!op) return;
    var m = linhasPIDaOP(op.CodOP)[N(val('mes14_pi_linha'))], s = el('mes14_pi_fonte'); if (!s) return;
    if (!m) { s.innerHTML = ''; return; }
    var fs = fontesPI(m.CodigoMaterial, op), ref = txt(m.OPOrigemPI);
    if (txt(m.Lote)) { var ol = opDoLote(m.Lote); if (ol) ref = txt(ol.CodOP); }
    fs.sort(function (a, b) { return ((txt(b.L.CodOP) === ref) - (txt(a.L.CodOP) === ref)); });
    s.innerHTML = fs.length ? '<option value="">Selecione a etiqueta ou o lote…</option>' + fs.map(function (f) { return '<option value="' + esc(f.valor) + '">' + esc(rotuloFonte(f)) + '</option>'; }).join('') :
      '<option value="">Nenhuma etiqueta/lote de ' + esc(m.CodigoMaterial) + ' com saldo (aponte a produção da OP de origem)</option>';
    if (selecionarFonte && [].some.call(s.options, function (o) { return o.value === selecionarFonte; })) s.value = selecionarFonte;
    else if (fs.length === 1) s.value = fs[0].valor;
    var mq = el('mes14_pi_maq');
    if (mq) { var mm = maquinasDaOP(op).find(function (x) { return (txt(m.IdRecursoRoteiro) && x.IdRecursoRoteiro === txt(m.IdRecursoRoteiro)) || (x.Ordem === txt(m.OrdemEtapa) && x.CodEquipamento === txt(m.CodEquipamento)); }); if (mm) mq.value = mm.chave; }
    window.mesPIAtualizarSaldo();
  };
  window.mesPIAtualizarSaldo = function () {
    var f = fonteEscolhida(val('mes14_pi_fonte')), s = el('mes14_pi_saldo');
    if (s) s.value = f ? f4(f.saldo) + ' ' + (f.L.UM || '') : '';
  };
  function atualizarFormPI() { if (el('mes14_pi_linha')) { window.mesPIMotivos(); window.mesPIAtualizarForm(); } }
  window.mesPILerEtiqueta = function (v) {
    var op = opSelecionada('prod_op'), inp = el('mes14_pi_scan'), cod = txt(v).toUpperCase();
    if (!op) return;
    var inf = infoEtiqueta(cod);
    if (!inf) { bip(false); aviso('mes14_pi_scan_msg', '✖ Etiqueta <b>' + esc(cod) + '</b> não encontrada (ou cancelada).', 'erro'); if (inp) inp.select(); return; }
    var linhas = linhasPIDaOP(op.CodOP), i = linhas.findIndex(function (m) { return txt(m.CodigoMaterial) === inf.lote.CodigoProduto; });
    if (i < 0) { bip(false); aviso('mes14_pi_scan_msg', '✖ A etiqueta ' + esc(cod) + ' é do ' + esc(inf.lote.CodigoProduto) + ', que não entra nesta OP.', 'erro'); if (inp) inp.select(); return; }
    if (txt(inf.lote.CodOP) === txt(op.CodOP)) { bip(false); aviso('mes14_pi_scan_msg', '✖ A etiqueta é da produção desta própria OP.', 'erro'); return; }
    if (!(inf.et.Saldo > 1e-9)) { bip(false); aviso('mes14_pi_scan_msg', '✖ A etiqueta ' + esc(cod) + ' está sem saldo.', 'erro'); if (inp) inp.select(); return; }
    var s = el('mes14_pi_linha'); if (s) s.value = String(i);
    window.mesPIAtualizarForm('E:' + cod);
    bip(true);
    aviso('mes14_pi_scan_msg', '✔ Etiqueta <b>' + esc(cod) + '</b> — ' + esc(inf.lote.CodigoProduto + ' ' + inf.lote.Descricao) + ' · OP ' + esc(inf.lote.CodOP) + ' · saldo ' + f4(inf.et.Saldo) + ' ' + esc(inf.lote.UM) + (inf.lote.Familia === raizFamilia(op) ? '' : ' · <b>outra família/PI isolado</b>'), 'ok');
    if (inp) inp.value = '';
    var q = el('mes14_pi_ret'); if (q) q.focus();
  };
  function proximoNOPP() { try { if (typeof nextByPrefix === 'function') return nextByPrefix(D().perdas || [], 'NOPP', 'PERD'); } catch (e) { } return 'PERD' + Date.now(); }
  /* reserva/consumo planejado na geração da OP (V40.3/V1.0.11) vira histórico quando o consumo real do mesmo lote é apontado */
  function substituirReservas(rec) {
    A(D().op_pi_consumos).forEach(function (c) {
      if (c === rec || !ativoConsumo(c) || !/LOTE_PI_EXISTENTE/.test(String(c.Origem || '')) || txt(c.IdLotePI) !== txt(rec.IdLotePI)) return;
      var mesmaOP = txt(c.CodOPConsumidora) ? txt(c.CodOPConsumidora) === txt(rec.CodOPConsumidora) : txt(c.CodOPPA) === txt(rec.FamiliaConsumidora);
      if (!mesmaOP) return;
      c.Status = 'CANCELADO'; c.SubstituidoPorApontamento = rec.IdConsumoPI; c.MotivoCancelamento = 'Consumo planejado na geração da OP substituído pelo consumo apontado'; c.CanceladoEm = agora();
    });
  }
  window.mesPIRegistrarConsumo = function () {
    var op = opSelecionada('prod_op'); if (!op) return;
    if (!opAberta(op)) return aviso('mes14_pi_msg', 'OP encerrada: consumos bloqueados.', 'erro');
    var m = linhasPIDaOP(op.CodOP)[N(val('mes14_pi_linha'))]; if (!m) return aviso('mes14_pi_msg', 'Selecione o PI.', 'erro');
    var f = fonteEscolhida(val('mes14_pi_fonte')); if (!f) return aviso('mes14_pi_msg', 'Selecione a etiqueta ou o lote de origem do PI.', 'erro');
    if (f.L.CodigoProduto !== txt(m.CodigoMaterial)) return aviso('mes14_pi_msg', 'A origem escolhida não é do ' + esc(m.CodigoMaterial) + '.', 'erro');
    var ret = numDigitado(val('mes14_pi_ret')), dev = numDigitado(val('mes14_pi_dev')), per = numDigitado(val('mes14_pi_per'));
    if (dev === '') dev = 0; if (per === '') per = 0;
    if (!(ret > 0)) return aviso('mes14_pi_msg', 'Informe a quantidade retirada (maior que zero).', 'erro');
    if (isNaN(dev) || dev < 0 || dev > ret) return aviso('mes14_pi_msg', 'A devolução deve ficar entre zero e a quantidade retirada.', 'erro');
    var liquido = arred(ret - dev);
    if (isNaN(per) || per < 0 || per > liquido + 1e-9) return aviso('mes14_pi_msg', 'A perda na etapa deve ficar entre zero e o consumo (retirado − devolvido = ' + f4(liquido) + ').', 'erro');
    if (!(liquido > 0)) return aviso('mes14_pi_msg', 'Consumo zero: nada a lançar.', 'erro');
    if (liquido > f.saldo + 1e-9) return aviso('mes14_pi_msg', 'Saldo insuficiente: a origem tem ' + f4(f.saldo) + ' ' + esc(f.L.UM) + ' e o consumo é ' + f4(liquido) + '. Se a quantidade real for maior, corrija o apontamento de produção da OP ' + esc(f.L.CodOP) + '.', 'erro');
    var motId = val('mes14_pi_mot'), mot = motivos().find(function (x) { return x.IdMotivo === motId; }) || null;
    if (per > 0 && !mot && motivosDaCategoria(val('mes14_pi_cat'), true).length) return aviso('mes14_pi_msg', 'Selecione o motivo da perda.', 'erro');
    var raiz = raizFamilia(op), externo = f.L.Familia !== raiz, opO = f.L.op;
    if (externo && opO && !opConcluida(opO) && !confirm('O ' + m.CodigoMaterial + ' vem da OP ' + f.L.CodOP + ', de outra família/PI isolado e ainda aberta.\n\nO custo e o CO₂ desse PI entram nesta família pelo custo fechado da OP de origem, que só existe quando ela for encerrada. Lançar mesmo assim?')) return;
    var mq = maquinasDaOP(op).find(function (x) { return x.chave === val('mes14_pi_maq'); }) || {};
    var paRaiz = opPor(raiz) || {};
    var rec = { IdConsumoPI: idNovo('CPI-AP'), CodOPConsumidora: op.CodOP, FamiliaConsumidora: raiz, CodOPPA: externo ? raiz : '', OPBase: paRaiz.OP_Base || raiz, CodigoPA: codProdutoOP(paRaiz),
      CodigoPI: txt(m.CodigoMaterial), TipoPI: (produto(m.CodigoMaterial) || {})['Tipo PI'] || '', IdLotePI: f.L.IdLote, IdEtiqueta: f.etiqueta, CodOPOrigemPI: f.L.CodOP, FamiliaOrigem: f.L.Familia,
      PIExterno: externo ? 'Sim' : 'Não', OrdemEtapa: mq.Ordem || txt(m.OrdemEtapa), Processo: mq.Processo || m.Processo || '', IdRecursoRoteiro: mq.IdRecursoRoteiro || txt(m.IdRecursoRoteiro),
      CodEquipamento: mq.CodEquipamento || txt(m.CodEquipamento), Equipamento: mq.Equipamento || '', QtdRetirada: String(arred(ret)), QtdDevolvida: String(arred(dev)), QuantidadeConsumida: String(liquido),
      QtdPerdidaNaEtapa: String(arred(per)), UM: f.L.UM || m.UM || '', DataConsumo: agora(), DataApontamento: txt(val('mes14_pi_data')) || hoje(), Operador: txt(val('mes14_pi_oper')) || txt(val('ap_operador')),
      Observacoes: txt(val('mes14_pi_obs')), Status: 'ATIVO', Origem: 'APONTAMENTO_PI', CriadoPor: usuario() };
    var d = D();
    d.op_pi_consumos.push(rec);
    if (per > 0) {
      var p = { NOPP: proximoNOPP(), CodOP: op.CodOP, PerdaAlvoTipo: 'Material', TipoApontamento: mot ? mot.Categoria : categoriaCanonica(val('mes14_pi_cat')), ItemPerdaCodigo: rec.CodigoPI,
        ItemPerdaDescricao: m.DescricaoMaterial || descProduto(rec.CodigoPI), CodigoMaterial: rec.CodigoPI, Produto: codProdutoOP(op), DescricaoProduto: m.DescricaoMaterial || descProduto(rec.CodigoPI),
        OrdemEtapa: rec.OrdemEtapa, Processo: rec.Processo, IdRecursoRoteiro: rec.IdRecursoRoteiro, CodEquipamento: rec.CodEquipamento, Equipamento: rec.Equipamento, ProdutoEtapa: codProdutoOP(op),
        Unidade: rec.UM, QuantidadePerdida: String(arred(per)).replace('.', ','), Operador: rec.Operador, DataApontamento: rec.DataApontamento, Motivo: mot ? mot.Motivo : '', IdMotivo: mot ? mot.IdMotivo : '',
        Observacoes: 'Perda do PI na etapa, lançada com o consumo ' + rec.IdConsumoPI + (rec.Observacoes ? ' — ' + rec.Observacoes : ''), PlanejadoItem: m.QtdPlanejada || '',
        OrigemPerda: 'DENTRO_DO_CONSUMO', IdConsumoPI: rec.IdConsumoPI, IdLotePI: rec.IdLotePI, IdEtiqueta: rec.IdEtiqueta, CodOPOrigemPI: rec.CodOPOrigemPI, PIExterno: rec.PIExterno };
      d.perdas.push(p); rec.IdPerdaVinculada = p.NOPP;
    }
    substituirReservas(rec);
    op.DataUltimoApontamento = typeof nowBR === 'function' ? nowBR() : agora();
    if (!/EM PRODU/i.test(String(op.Status || ''))) op.Status = 'Em Produção';
    try { if (typeof recalcOPFamilyV395 === 'function') recalcOPFamilyV395(op.CodOP); } catch (e) { }
    salvar();
    try { if (typeof v403SyncPILots === 'function') v403SyncPILots(); } catch (e) { }
    window.__mes14PIMsg = '✔ Consumo de ' + f4(liquido) + ' ' + esc(rec.UM) + ' do ' + esc(rec.CodigoPI) + ' (' + esc(rec.IdEtiqueta || rec.IdLotePI) + ') lançado' + (per > 0 ? ' com perda de ' + f4(per) + ' ' + esc(rec.UM) + ' na etapa (' + esc(rec.IdPerdaVinculada) + ')' : '') + '.';
    if (typeof showProdOP === 'function') showProdOP();
  };
  window.mesPIEstornar = function (id) {
    var c = A(D().op_pi_consumos).find(function (x) { return x.IdConsumoPI === id; }); if (!c || !ativoConsumo(c)) return;
    var perda = c.IdPerdaVinculada ? A(D().perdas).find(function (p) { return p.NOPP === c.IdPerdaVinculada; }) : null;
    abrirDialogo('<h3>Estornar consumo de PI</h3><p>' + esc(c.CodigoPI) + ' · ' + f4(c.QuantidadeConsumida) + ' ' + esc(c.UM || '') + ' · ' + esc(c.IdEtiqueta || c.IdLotePI || '') + ' · OP ' + esc(c.CodOPConsumidora || c.CodOPPA || '') + '</p>' +
      '<p class="muted">O estorno devolve a quantidade ao saldo da etiqueta/lote de origem. O lançamento fica no histórico como estornado.</p>' +
      '<div class="mes14-grid"><label class="wide"><span>Motivo do estorno</span><input id="mes14_est_mot" placeholder="Ex.: etiqueta errada"></label></div>' +
      (perda ? '<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" id="mes14_est_perda" class="mes14-sel" checked> Excluir também a perda vinculada (' + esc(perda.NOPP) + ': ' + esc(perda.QuantidadePerdida) + ' ' + esc(perda.Unidade || '') + ')</label>' : '') +
      '<div class="mes14-actions"><button class="danger" onclick="mesPIEstornarConfirmar(\'' + jsStr(id) + '\')">Estornar</button><button class="secondary" onclick="mesFecharDialogo14()">Cancelar</button></div><div id="mes14_est_msg" class="mes14-msg"></div>');
  };
  window.mesPIEstornarConfirmar = function (id) {
    var d = D(), c = A(d.op_pi_consumos).find(function (x) { return x.IdConsumoPI === id; }); if (!c || !ativoConsumo(c)) return fecharDialogo();
    var motivo = txt(val('mes14_est_mot')); if (!motivo) return aviso('mes14_est_msg', 'Informe o motivo do estorno.', 'erro');
    c.Status = 'CANCELADO'; c.EstornadoEm = agora(); c.EstornadoPor = usuario(); c.MotivoEstorno = motivo;
    if (c.IdPerdaVinculada && el('mes14_est_perda') && el('mes14_est_perda').checked) d.perdas = A(d.perdas).filter(function (p) { return p.NOPP !== c.IdPerdaVinculada; });
    var outros = A(d.op_pi_consumos).some(function (x) { return x !== c && ativoConsumo(x) && x.Origem === 'APONTAMENTO_PI' && txt(x.IdLotePI) === txt(c.IdLotePI) && txt(x.FamiliaConsumidora) === txt(c.FamiliaConsumidora); });
    if (!outros) A(d.op_pi_consumos).forEach(function (x) { if (x.SubstituidoPorApontamento === c.IdConsumoPI && String(x.Status) === 'CANCELADO') { x.Status = 'ATIVO'; delete x.SubstituidoPorApontamento; delete x.MotivoCancelamento; delete x.CanceladoEm; } });
    try { if (typeof recalcOPFamilyV395 === 'function') recalcOPFamilyV395(c.CodOPConsumidora || c.CodOPPA); } catch (e) { }
    salvar(); fecharDialogo();
    if (current === 'producao' && typeof showProdOP === 'function') showProdOP();
    else if (current === 'estoque' || current === 'estoque_pi_pa') window.mesEstoquePI14();
  };

  /* Registro de Perdas: origem da quantidade perdida e etiqueta/lote (PI) ou entrada/lote (material) */
  function itemPerdaSelecionado(op) {
    var mats = A(D().op_materiais).filter(function (m) { return txt(m.CodOP) === txt(op.CodOP); });
    return mats[parseInt(val('loss_item') || '0', 10)] || null;
  }
  function consumoMPDaOP(codOP, codMat) { return arred(A(D().consumos_materiais).filter(function (c) { return txt(c.CodOP) === txt(codOP) && txt(c.CodigoMaterial) === txt(codMat); }).reduce(function (s, c) { return s + N(c.ConsumoLiquido !== undefined && c.ConsumoLiquido !== '' ? c.ConsumoLiquido : N(c.QtdRetirada) - N(c.QtdDevolvida)); }, 0)); }
  function perdasDentroJa(codOP, codMat) { return arred(A(D().perdas).filter(function (p) { return txt(p.CodOP) === txt(codOP) && txt(p.CodigoMaterial || p.ItemPerdaCodigo) === txt(codMat) && p.OrigemPerda === 'DENTRO_DO_CONSUMO'; }).reduce(function (s, p) { return s + N(p.QuantidadePerdida); }, 0)); }
  function decorarOrigemPerda() {
    var op = opSelecionada('loss_op'), item = el('loss_item'); if (!op || !item) return;
    var grid = item.closest('.form-grid'); if (!grid) return;
    if (!el('mes14_loss_origem')) {
      var l1 = document.createElement('label'); l1.id = 'mes14_loss_origem_l'; l1.className = 'wide';
      l1.innerHTML = '<span>Origem da quantidade perdida</span><select id="mes14_loss_origem" onchange="mesPerdaFontes()"></select>';
      var l2 = document.createElement('label'); l2.id = 'mes14_loss_fonte_l'; l2.className = 'wide';
      l2.innerHTML = '<span id="mes14_loss_fonte_t">Etiqueta / lote</span><select id="mes14_loss_fonte"></select>';
      /* explicação numa linha inteira no fim do formulário (não desalinha os campos) */
      var aj = document.createElement('small'); aj.id = 'mes14_loss_ajuda'; aj.className = 'mes14-subtle mes14-loss-ajuda';
      grid.appendChild(aj);
      /* logo antes do Motivo (2ª linha do formulário: origem · etiqueta/lote · motivo · observações); sem o Motivo, depois do item */
      var motivo = el('loss_motivo'), antes = motivo ? motivo.closest('label') : null, host = item.closest('label');
      if (antes && antes.parentNode === grid) { grid.insertBefore(l1, antes); grid.insertBefore(l2, antes); }
      else if (host && host.nextSibling) { grid.insertBefore(l2, host.nextSibling); grid.insertBefore(l1, l2); } else { grid.appendChild(l1); grid.appendChild(l2); }
      var alvo = el('loss_alvo');
      if (alvo) alvo.addEventListener('change', function () { setTimeout(window.mesPerdaOrigem, 0); });
      item.addEventListener('change', function () { setTimeout(window.mesPerdaOrigem, 0); });
    }
    window.mesPerdaOrigem();
  }
  window.mesPerdaOrigem = function () {
    var op = opSelecionada('loss_op'), l1 = el('mes14_loss_origem_l'), l2 = el('mes14_loss_fonte_l'), s = el('mes14_loss_origem'); if (!op || !s) return;
    var mat = val('loss_alvo') === 'Material', m = mat ? itemPerdaSelecionado(op) : null;
    var aj = el('mes14_loss_ajuda');
    if (!mat || !m) { l1.style.display = 'none'; l2.style.display = 'none'; if (aj) aj.style.display = 'none'; return; }
    l1.style.display = ''; l2.style.display = ''; if (aj) aj.style.display = '';
    var cod = txt(m.CodigoMaterial), pi = ehLinhaPI(m), cons = pi ? consumidoPelaOP(op.CodOP, cod) : consumoMPDaOP(op.CodOP, cod), dentro = arred(cons - perdasDentroJa(op.CodOP, cod));
    s.innerHTML = '<option value="DENTRO_DO_CONSUMO">Dentro do consumo já apontado nesta OP (não baixa o estoque de novo)</option><option value="RETIRADA_ADICIONAL">Retirada adicional do estoque (baixa o saldo ' + (pi ? 'da etiqueta/lote' : 'do lote') + ')</option>';
    s.value = dentro > 1e-9 ? 'DENTRO_DO_CONSUMO' : 'RETIRADA_ADICIONAL';
    s.dataset.dentro = String(dentro);
    window.mesPerdaFontes();
  };
  window.mesPerdaFontes = function () {
    var op = opSelecionada('loss_op'), sf = el('mes14_loss_fonte'), aj = el('mes14_loss_ajuda'), t = el('mes14_loss_fonte_t'); if (!op || !sf) return;
    var m = itemPerdaSelecionado(op); if (!m) return;
    var cod = txt(m.CodigoMaterial), pi = ehLinhaPI(m), origem = val('mes14_loss_origem'), dentro = N((el('mes14_loss_origem') || {}).dataset ? el('mes14_loss_origem').dataset.dentro : 0);
    if (origem === 'DENTRO_DO_CONSUMO') {
      if (t) t.textContent = pi ? 'Etiqueta / lote consumido (opcional)' : 'Entrada / lote consumido (opcional)';
      var usados = pi ? consumosDaOPConsumidora(op.CodOP, cod).map(function (c) { return { v: (c.IdEtiqueta ? 'E:' + c.IdEtiqueta : 'L:' + c.IdLotePI), r: (c.IdEtiqueta || c.IdLotePI) + ' · ' + f4(c.QuantidadeConsumida) + ' ' + (c.UM || '') }; })
        : A(D().consumos_materiais).filter(function (c) { return txt(c.CodOP) === txt(op.CodOP) && txt(c.CodigoMaterial) === cod; }).map(function (c) { return { v: 'N:' + c.Entrada, r: (c.Lote || '-') + ' · ' + c.Entrada + ' · ' + f4(c.ConsumoLiquido) + ' ' + (c.UM || '') }; });
      var vistos = {};
      sf.innerHTML = '<option value="">Não informar</option>' + usados.filter(function (x) { if (vistos[x.v]) return false; vistos[x.v] = 1; return true; }).map(function (x) { return '<option value="' + esc(x.v) + '">' + esc(x.r) + '</option>'; }).join('');
      if (aj) aj.textContent = 'Consumo apontado ainda sem perda: ' + f4(dentro) + ' ' + (m.UM || '') + '. O custo e o CO₂ dessa quantidade já estão no consumo: a perda não soma de novo.';
    } else {
      if (t) t.textContent = pi ? 'Etiqueta / lote de onde saiu (obrigatório)' : 'Entrada / lote de onde saiu';
      if (pi) {
        var fs = fontesPI(cod, op);
        sf.innerHTML = '<option value="">Selecione…</option>' + fs.map(function (f) { return '<option value="' + esc(f.valor) + '">' + esc(rotuloFonte(f)) + '</option>'; }).join('');
        if (aj) aj.textContent = 'A quantidade sai do saldo da etiqueta/lote escolhido.' + (fs.length ? '' : ' Nenhuma etiqueta/lote com saldo.');
      } else {
        var api = window.mesEstoqueAPI, linhas = api && api.linhas ? api.linhas().filter(function (l) { return txt(l.CodigoMaterial) === cod && l.Saldo > 1e-9; }) : [];
        sf.innerHTML = '<option value="">Sem lote (não baixa o estoque)</option>' + linhas.map(function (l) { return '<option value="N:' + esc(l.Entrada) + '">' + esc((l.Lote || '-') + ' · ' + l.Entrada + ' · saldo ' + f4(l.Saldo) + ' ' + (l.UM || '')) + '</option>'; }).join('');
        if (aj) aj.textContent = 'Retirada além do consumo apontado: soma ao custo de perdas e, com lote, baixa o saldo do lote.';
      }
    }
  };
  function validarPerdaExtra(op) {
    if (val('loss_alvo') !== 'Material') return { ok: true };
    var m = itemPerdaSelecionado(op); if (!m) return { ok: true };
    var cod = txt(m.CodigoMaterial), pi = ehLinhaPI(m), origem = val('mes14_loss_origem') || 'RETIRADA_ADICIONAL', fonte = val('mes14_loss_fonte'), q = N(val('loss_qtd'));
    var r = { ok: true, origem: origem, pi: pi, cod: cod, linha: m };
    if (origem === 'DENTRO_DO_CONSUMO') {
      var dentro = N(el('mes14_loss_origem') && el('mes14_loss_origem').dataset.dentro);
      if (q > dentro + 1e-9) { r.ok = false; r.msg = 'A perda dentro do consumo (' + f4(q) + ') passa do consumo apontado ainda sem perda nesta OP (' + f4(dentro) + ' ' + (m.UM || '') + ').\n\nAponte o consumo primeiro ou escolha “Retirada adicional do estoque”.'; return r; }
      if (pi && fonte) { var fx = fonte.indexOf('E:') === 0 ? infoEtiqueta(fonte.slice(2)) : null; r.etiqueta = fonte.indexOf('E:') === 0 ? fonte.slice(2) : ''; r.lote = fx ? fx.lote.IdLote : (fonte.indexOf('L:') === 0 ? fonte.slice(2) : ''); }
      if (!pi && fonte.indexOf('N:') === 0) r.entradaConsumo = fonte.slice(2);
      return r;
    }
    if (pi) {
      var f = fonteEscolhida(fonte);
      if (!f) { r.ok = false; r.msg = 'Escolha a etiqueta/lote do PI de onde saiu a quantidade perdida.'; return r; }
      if (q > f.saldo + 1e-9) { r.ok = false; r.msg = 'Saldo insuficiente na origem: ' + f4(f.saldo) + ' ' + (f.L.UM || '') + '.'; return r; }
      r.etiqueta = f.etiqueta; r.lote = f.L.IdLote; r.opOrigem = f.L.CodOP; r.externo = f.L.Familia !== raizFamilia(op);
    } else if (fonte.indexOf('N:') === 0) {
      var api = window.mesEstoqueAPI, l = api && api.linhas ? api.linhas().find(function (x) { return x.Entrada === fonte.slice(2); }) : null;
      if (l && q > l.Saldo + 1e-9) { r.ok = false; r.msg = 'Saldo insuficiente no lote ' + (l.Lote || l.Entrada) + ': ' + f4(l.Saldo) + ' ' + (l.UM || '') + '.'; return r; }
      r.entrada = fonte.slice(2); r.loteMP = l ? l.Lote : '';
    }
    return r;
  }

  /* ---------------------------------------------------------------------
     7) BAIXA AUTOMÁTICA DO PI NO ENCERRAMENTO DA OP CONSUMIDORA
     Encerrada a OP que consome um PI da própria família sem nenhum consumo desse PI apontado, o PI planejado é baixado
     do lote da OP que o produziu (no máximo o saldo do lote; sem quantidade planejada, o saldo inteiro). Consumo
     apontado (mesmo parcial) prevalece: nada é baixado automaticamente. Lote de outra família nunca é baixado sozinho.
     OPs encerradas antes da 1.4.0 recebem essa baixa uma única vez (Origem BAIXA_LEGADO_1.4.0), senão o lote da
     família apareceria com saldo cheio no estoque mesmo já tendo virado o PA.
     --------------------------------------------------------------------- */
  function baixaAutomaticaLigada() { var m = (D() || {}).meta || {}; return m.mesBaixaAutomaticaPI !== 'Não'; }
  function baixaAutomaticaPI(op, origemTxt, deterministico) {
    if (!op) return [];
    var d = D(), raiz = raizFamilia(op), feitos = [];
    linhasPIDaOP(op.CodOP).forEach(function (m) {
      var cod = txt(m.CodigoMaterial || m.CodigoPI); if (!cod || cod === codProdutoOP(op)) return;
      if (consumidoPelaOP(op.CodOP, cod) > 1e-9) return;
      var origem = txt(m.Lote) ? opDoLote(m.Lote) : null;
      if (!origem && txt(m.OPOrigemPI)) origem = opPor(m.OPOrigemPI);
      if (!origem) origem = opOrigemNaFamilia(raiz, cod);
      if (!origem || raizFamilia(origem) !== raiz || txt(origem.CodOP) === txt(op.CodOP)) return;
      var L = livro().lotes[idLote(origem)]; if (!L || !(L.Saldo > 1e-9)) return;
      var plan = N(m.QtdPlanejada), q = arred(plan > 0 ? Math.min(plan, L.Saldo) : L.Saldo); if (!(q > 0)) return;
      var id = deterministico ? 'CPI-LEG-' + op.CodOP + '-' + cod : idNovo('CPI-BX');
      if (A(d.op_pi_consumos).some(function (c) { return c.IdConsumoPI === id; })) return;
      var paRaiz = opPor(raiz) || {};
      d.op_pi_consumos.push({ IdConsumoPI: id, CodOPConsumidora: op.CodOP, FamiliaConsumidora: raiz, CodOPPA: '', OPBase: paRaiz.OP_Base || raiz, CodigoPA: codProdutoOP(paRaiz), CodigoPI: cod,
        TipoPI: (produto(cod) || {})['Tipo PI'] || '', IdLotePI: L.IdLote, IdEtiqueta: '', CodOPOrigemPI: L.CodOP, FamiliaOrigem: raiz, PIExterno: 'Não', OrdemEtapa: txt(m.OrdemEtapa), Processo: m.Processo || '',
        IdRecursoRoteiro: txt(m.IdRecursoRoteiro), CodEquipamento: txt(m.CodEquipamento), Equipamento: '', QtdRetirada: String(q), QtdDevolvida: '0', QuantidadeConsumida: String(q), UM: L.UM || m.UM || '',
        DataConsumo: agora(), DataApontamento: op.DataEncerramento ? String(op.DataEncerramento).slice(0, 10) : hoje(), Operador: usuario(),
        Observacoes: (origemTxt === 'BAIXA_LEGADO_1.4.0' ? 'OP encerrada antes da 1.4.0 sem consumo de PI apontado: ' : 'Encerramento da OP sem consumo de PI apontado: ') + (plan > 0 ? 'baixada a quantidade planejada (' + f4(plan) + ')' : 'baixado o saldo do lote') + ' do lote da família.',
        Status: 'ATIVO', Origem: origemTxt, CriadoPor: usuario() });
      mudou();
      feitos.push({ PI: cod, Quantidade: q, UM: L.UM || m.UM || '', Lote: L.IdLote, OPOrigem: L.CodOP });
    });
    return feitos;
  }
  function migrarBaixaLegado() {
    var d = D(); if (!d || !d.meta || d.meta.mes140BaixaLegadoPI) return false;
    var n = 0, ops = A(d.op).filter(function (o) { return opConcluida(o) && linhasPIDaOP(o.CodOP).length; });
    /* primeiro as OPs de PI (consumo entre etapas), depois as de PA (genealogia) */
    ops.sort(function (a, b) { return (tipoOP(a) === 'PA') - (tipoOP(b) === 'PA'); });
    ops.forEach(function (o) { n += baixaAutomaticaPI(o, 'BAIXA_LEGADO_1.4.0', true).length; });
    d.meta.mes140BaixaLegadoPI = agora() + ' — ' + n + ' baixa(s) de PI em OPs já encerradas';
    return true;
  }
  function avisosAntesDeEncerrar(op) {
    var av = [], abertos = temposDaOP(op.CodOP).filter(function (t) { return t.Status === 'Iniciado'; });
    if (abertos.length) av.push('Há apontamento de tempo em andamento: ' + abertos.map(function (t) { return (t.Equipamento || t.Processo || '') + ' desde ' + t.DataApontamento + ' ' + t.HoraInicio; }).join('; ') + '. O tempo real só conta depois de finalizado.');
    var pend = consumosDaOPConsumidora(op.CodOP, '').filter(function (c) { return c.PIExterno === 'Sim' && !opConcluida(opPor(c.CodOPOrigemPI)); });
    if (pend.length && tipoOP(op) === 'PA') av.push('PI de outra família vindo de OP ainda aberta (' + pend.map(function (c) { return c.CodOPOrigemPI; }).join(', ') + '): o custo herdado só existe depois que ela for encerrada.');
    var semCons = materiaisSemConsumo(op);
    if (semCons.length) av.push('Material planejado sem consumo apontado nesta OP: ' + semCons.map(function (x) { return x.CodigoMaterial + (x.Material ? ' — ' + x.Material : '') + ' (planejado ' + f4(x.Planejado) + ' ' + x.UM + ')'; }).join('; ') +
      '. Com a OP encerrada, ' + (semCons.length > 1 ? 'esses materiais ficam' : 'esse material fica') + ' fora do custo e do CO₂ (conta só o consumo real). Se ' + (semCons.length > 1 ? 'foram usados' : 'foi usado') + ', aponte o consumo antes de encerrar.');
    return av.length ? 'Antes de encerrar a OP ' + op.CodOP + ':\n\n- ' + av.join('\n- ') + '\n\nContinuar com o encerramento?' : '';
  }
  (function () {
    var ant = window.encerrarOPSelecionada;
    if (typeof ant !== 'function') return;
    window.encerrarOPSelecionada = function (selectId) {
      var op0 = null; try { op0 = typeof selectedOP === 'function' ? selectedOP(selectId) : null; } catch (e) { }
      var cod = op0 && op0.CodOP, estavaAberta = opAberta(op0);
      if (estavaAberta && cod && selectId === 'selOp') { var av = avisosAntesDeEncerrar(op0); if (av && !confirm(av)) return; }
      var ret = ant.apply(this, arguments);
      try {
        var op = opPor(cod);
        if (estavaAberta && opConcluida(op) && baixaAutomaticaLigada()) {
          var f = baixaAutomaticaPI(op, 'BAIXA_AUTOMATICA_ENCERRAMENTO', false);
          if (f.length) {
            salvar();
            try { if (typeof v403SyncPILots === 'function') v403SyncPILots(); } catch (e) { }
            alert('Baixa automática dos PIs da família não apontados nesta OP:\n\n' + f.map(function (x) { return x.PI + ': ' + f4(x.Quantidade) + ' ' + x.UM + ' do lote ' + x.Lote + ' (OP ' + x.OPOrigem + ')'; }).join('\n') + '\n\nPara corrigir, estorne em Estoque › PI e PA prontos › Movimentos.');
          }
        }
      } catch (e) { console.warn('MES LION 1.4: baixa automática de PI', e); }
      return ret;
    };
  })();

  /* ---------------------------------------------------------------------
     8) ETIQUETAS DE PI/PA (data.etiquetas_producao) — GERADAS NO APONTAMENTO DE PRODUÇÃO
     UM "un": uma por unidade, aglutinada (uma com tudo) ou N unidades por etiqueta (a última leva o resto).
     Demais UMs: uma etiqueta com a quantidade apontada. A soma das etiquetas de um apontamento é sempre a
     quantidade apontada. Código ET000001 (Code 128), lido no consumo do PI e no estoque.
     --------------------------------------------------------------------- */
  function proximaEtiqueta() {
    var max = 0;
    A(D().etiquetas_producao).forEach(function (e) { var m = String(e && e.IdEtiqueta || '').match(/^ET(\d+)$/); if (m) max = Math.max(max, +m[1]); });
    return max + 1;
  }
  function partesEtiquetas(q, modo, k) {
    var partes = [], i;
    if (modo === 'POR_UNIDADE') { for (i = 0; i < Math.round(q); i++) partes.push(1); }
    else if (modo === 'POR_QUANTIDADE' && k > 0) {
      var n = Math.floor(q / k + 1e-9);
      for (i = 0; i < n; i++) partes.push(k);
      var resto = arred(q - n * k); if (resto > 1e-9) partes.push(resto);
    } else partes.push(arred(q));
    return partes;
  }
  function etiquetasDoApontamento(r) { return etiquetasAtivas().filter(function (e) { return e.NOP === r.NOP && txt(e.CodOP) === txt(r.CodOP); }); }
  function criarEtiquetas(r, op, modo, k) {
    var q = qtdProducao(r); if (!(q > 0)) return [];
    var partes = partesEtiquetas(q, modo, k), seq = proximaEtiqueta(), um = txt(r['Unidade de medida'] || r.Unidade) || umOP(op), cod = txt(r.ProdutoApontado || r.Produto) || codProdutoOP(op), out = [];
    partes.forEach(function (p, i) {
      var id = 'ET' + String(seq + i).padStart(6, '0');
      var e = { IdEtiqueta: id, CodigoBarras: id, TipoProduto: tipoOP(op), CodigoProduto: cod, DescricaoProduto: descProduto(cod) || r.DescricaoProduto || op.DescricaoProduto || '', CodOP: op.CodOP,
        NOP: r.NOP, IdLote: idLote(op), Quantidade: String(arred(p)), UM: um, Sequencia: i + 1, TotalEtiquetas: partes.length, Modo: modo, QuantidadePorEtiqueta: modo === 'POR_QUANTIDADE' ? String(k) : '',
        DataProducao: r.DataApontamento || hoje(), Processo: r.Processo || '', Operador: r.Operador || '', Projeto: op.CodProjeto || op.Projeto || '', CodRoteiro: op.CodRoteiro || '',
        Status: 'ATIVA', CriadoEm: agora(), CriadoPor: usuario(), ImpressaEm: '' };
      D().etiquetas_producao.push(e); out.push(e);
    });
    mudou();
    return out;
  }
  function textoModo(modo, k) { return modo === 'POR_UNIDADE' ? 'uma por unidade' : modo === 'POR_QUANTIDADE' ? k + ' por etiqueta' : modo === 'AGLUTINADA' ? 'aglutinada' : 'etiqueta única'; }
  function dialogoModoEtiquetas(titulo, q, um, acaoConfirmar, textoBotao) {
    var inteiro = Math.abs(q - Math.round(q)) < 1e-9;
    abrirDialogo('<h3>' + titulo + '</h3><p class="muted">Cada etiqueta vira um item rastreável no Estoque de PI/PA e é lida (código de barras) quando o item é consumido em outra etapa.</p>' +
      '<label class="opcao' + (inteiro ? ' on' : '') + '"><input type="radio" name="mes14_modo" value="POR_UNIDADE"' + (inteiro ? ' checked' : ' disabled') + '><div><b>Uma etiqueta por unidade</b><small>' + (inteiro ? f4(q) + ' etiquetas de 1 ' + esc(um) : 'exige quantidade inteira') + '</small></div></label>' +
      '<label class="opcao' + (inteiro ? '' : ' on') + '"><input type="radio" name="mes14_modo" value="AGLUTINADA"' + (inteiro ? '' : ' checked') + '><div><b>Aglutinar em uma etiqueta</b><small>1 etiqueta com ' + f4(q) + ' ' + esc(um) + '</small></div></label>' +
      '<label class="opcao"><input type="radio" name="mes14_modo" value="POR_QUANTIDADE"><div><b>Indicar quantas unidades por etiqueta</b><small><input id="mes14_k" type="number" min="1" step="1" value="' + Math.max(1, Math.min(10, Math.floor(q) || 1)) + '" style="width:90px" oninput="mesModoEtiquetaInfo(' + q + ')"> ' + esc(um) + ' por etiqueta → <span id="mes14_k_info"></span></small></div></label>' +
      '<div class="mes14-actions"><button id="mes14_et_ok" onclick="' + acaoConfirmar + '">' + esc(textoBotao) + '</button><button class="secondary" onclick="mesFecharDialogo14()">Cancelar</button></div><div id="mes14_et_msg" class="mes14-msg"></div>');
    document.querySelectorAll('#mes14_overlay input[name=mes14_modo]').forEach(function (r) {
      r.addEventListener('change', function () { document.querySelectorAll('#mes14_overlay .opcao').forEach(function (o) { o.classList.toggle('on', !!o.querySelector('input[name=mes14_modo]:checked')); }); });
    });
    var k = el('mes14_k'); if (k) k.addEventListener('focus', function () { var r = document.querySelector('#mes14_overlay input[value=POR_QUANTIDADE]'); if (r) { r.checked = true; r.dispatchEvent(new Event('change')); } });
    window.mesModoEtiquetaInfo(q);
  }
  window.mesModoEtiquetaInfo = function (q) {
    var k = numDigitado(val('mes14_k')), s = el('mes14_k_info'); if (!s) return;
    if (!(k >= 1) || Math.abs(k - Math.round(k)) > 1e-9) { s.textContent = 'informe um número inteiro ≥ 1'; return; }
    var p = partesEtiquetas(q, 'POR_QUANTIDADE', k), resto = p.length && p[p.length - 1] !== k ? p[p.length - 1] : 0;
    s.textContent = p.length + ' etiqueta(s)' + (resto ? ' (' + (p.length - 1) + ' de ' + k + ' e 1 de ' + f4(resto) + ')' : '');
  };
  function modoEscolhido(q) {
    var r = document.querySelector('#mes14_overlay input[name=mes14_modo]:checked'), modo = r ? r.value : 'AGLUTINADA', k = 0;
    if (modo === 'POR_QUANTIDADE') {
      k = numDigitado(val('mes14_k'));
      if (!(k >= 1) || Math.abs(k - Math.round(k)) > 1e-9) { aviso('mes14_et_msg', 'Informe quantas unidades por etiqueta (número inteiro ≥ 1).', 'erro'); return null; }
    }
    if (modo === 'POR_UNIDADE' && Math.abs(q - Math.round(q)) > 1e-9) { aviso('mes14_et_msg', 'Uma etiqueta por unidade exige quantidade inteira.', 'erro'); return null; }
    var n = partesEtiquetas(q, modo, k).length;
    if (n > 200 && !confirm('Serão geradas ' + n + ' etiquetas. Continuar?')) return null;
    return { modo: modo, k: k };
  }
  window.mesRegistrarProducaoEtiquetas = function () {
    var op = opSelecionada('prod_op'), q = N(val('ap_qtd'));
    if (!op || !opAberta(op) || !(q > 0)) return window.registrarProducaoOP();
    var um = umOP(op);
    if (!ehUnidade(um)) return registrarComEtiquetas('UNICA', 0);
    dialogoModoEtiquetas('Etiquetas para ' + f4(q) + ' ' + esc(um) + ' de ' + esc(codProdutoOP(op) + ' ' + (descProduto(codProdutoOP(op)) || '')), q, um, 'mesConfirmarProducaoEtiquetas()', 'Registrar produção e gerar etiquetas');
  };
  window.mesConfirmarProducaoEtiquetas = function () {
    var m = modoEscolhido(N(val('ap_qtd'))); if (!m) return;
    fecharDialogo();
    registrarComEtiquetas(m.modo, m.k);
  };
  function registrarComEtiquetas(modo, k) {
    var op = opSelecionada('prod_op'); if (!op) return;
    var antes = {}; A(D().producao).forEach(function (r) { if (r) antes[r.NOP] = 1; });
    window.registrarProducaoOP();
    var novos = A(D().producao).filter(function (r) { return r && !antes[r.NOP] && txt(r.CodOP) === txt(op.CodOP); });
    if (!novos.length) return;
    var ets = [], opAt = opPor(op.CodOP) || op;
    novos.forEach(function (r) { ets = ets.concat(criarEtiquetas(r, opAt, modo, k)); });
    salvar();
    var ids = ets.map(function (e) { return e.IdEtiqueta; }).join(',');
    window.__mes14ProdMsg = { tipo: 'ok', html: '✔ Produção registrada (' + esc(novos.map(function (r) { return r.NOP; }).join(', ')) + ') e ' + ets.length + ' etiqueta(s) gerada(s) — ' + textoModo(modo, k) + ': <b>' + esc(ets[0].IdEtiqueta + (ets.length > 1 ? ' … ' + ets[ets.length - 1].IdEtiqueta : '')) + '</b> ' +
      '<button class="mini" onclick="mesImprimirEtiquetas14(\'' + jsStr(ids) + '\')">Imprimir etiquetas</button>' };
    if (typeof showProdOP === 'function') showProdOP();
  }
  function infoEtiquetasOP(op) {
    var ets = etiquetasAtivas().filter(function (e) { return txt(e.CodOP) === txt(op.CodOP); }).sort(ordemEtiqueta);
    var semEt = producaoDaOP(op.CodOP).filter(function (r) { return !etiquetasDoApontamento(r).length; });
    if (!ets.length && !semEt.length) return '';
    return '<div class="mes14-subtle" style="margin-top:6px">Etiquetas desta OP: <b>' + ets.length + '</b>' + (ets.length ? ' (' + esc(ets[0].IdEtiqueta) + (ets.length > 1 ? ' … ' + esc(ets[ets.length - 1].IdEtiqueta) : '') + ') <button class="mini secondary" onclick="mesImprimirEtiquetas14(\'' + jsStr(ets.map(function (e) { return e.IdEtiqueta; }).join(',')) + '\')">Imprimir todas</button>' : '') +
      (semEt.length ? ' · ' + semEt.length + ' apontamento(s) sem etiqueta <button class="mini secondary" onclick="mesGerarEtiquetasLote14(\'' + jsStr(idLote(op)) + '\')">Gerar etiquetas</button>' : '') + '</div>';
  }
  window.mesImprimirEtiquetas14 = function (ids) {
    var lista = String(ids || '').split(',').map(txt).filter(Boolean);
    var ets = lista.map(function (id) { return A(D().etiquetas_producao).find(function (e) { return e.IdEtiqueta === id; }); }).filter(Boolean);
    if (!ets.length) return alert('Nenhuma etiqueta para imprimir.');
    var w = window.open('', '_blank', 'width=820,height=720'); if (!w) return alert('Permita pop-ups para imprimir as etiquetas.');
    var cards = ets.map(function (e) {
      var op = opPor(e.CodOP) || {}, cancel = e.Status === 'CANCELADA';
      return '<article class="lab"><header><b>MES Lion · ' + (e.TipoProduto === 'PI' ? 'Produto intermediário (PI)' : 'Produto acabado (PA)') + '</b><span>' + esc(e.Sequencia + '/' + e.TotalEtiquetas) + '</span></header>' +
        '<h1>' + esc(e.CodigoProduto) + '</h1><h2>' + esc(e.DescricaoProduto || '') + '</h2>' +
        '<div class="qtd">' + esc(f4(e.Quantidade)) + ' <small>' + esc(e.UM || '') + '</small>' + (cancel ? ' <em>CANCELADA</em>' : '') + '</div>' +
        '<div class="code">' + barcode(e.IdEtiqueta, { modulo: 0.32, altura: 11, fonte: 2.6 }) + '</div>' +
        '<div class="grid"><b>OP</b><span>' + esc(e.CodOP) + '</span><b>Lote</b><span>' + esc(e.IdLote || '') + '</span><b>Apontamento</b><span>' + esc(e.NOP || '') + '</span><b>Data</b><span>' + esc(e.DataProducao || '') + '</span>' +
        '<b>Processo</b><span>' + esc(e.Processo || '') + '</span><b>Operador</b><span>' + esc(e.Operador || '—') + '</span><b>Roteiro</b><span>' + esc(e.CodRoteiro || op.CodRoteiro || '') + '</span><b>Projeto</b><span>' + esc(e.Projeto || '—') + '</span></div></article>';
    }).join('');
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas ' + esc(ets[0].IdEtiqueta) + '</title><style>' +
      '@page{size:100mm 70mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#0a2742;background:#fff}' +
      '.lab{width:100mm;height:70mm;padding:3.5mm 4mm;border:1px solid #0b4f88;overflow:hidden;page-break-after:always;break-after:page}' +
      '.lab header{display:flex;justify-content:space-between;font-size:8.5px;color:#0b4f88;border-bottom:2px solid #69ad2c;padding-bottom:1.2mm}' +
      'h1{font-size:17px;margin:1.6mm 0 0}h2{font-size:9.5px;font-weight:600;margin:.4mm 0 1mm;color:#40576b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.qtd{font-size:20px;font-weight:800;color:#003f73}.qtd small{font-size:11px}.qtd em{color:#b42318;font-size:12px}' +
      '.code svg{max-width:100%;height:15mm}.grid{display:grid;grid-template-columns:18% 32% 18% 32%;font-size:7.6px;gap:.4mm 1mm;margin-top:.6mm}.grid b{color:#526b7e}' +
      '.print{position:fixed;right:10px;top:10px;padding:8px 12px}@media print{.print{display:none}.lab{border:0}}</style></head><body><button class="print" onclick="window.print()">Imprimir</button>' + cards + '</body></html>');
    w.document.close();
    var marcou = false;
    ets.forEach(function (e) { if (!e.ImpressaEm) { e.ImpressaEm = agora(); marcou = true; } });
    if (marcou) salvar();
  };
  /* etiquetas para apontamentos que ainda não têm (produção anterior à 1.4.0) */
  window.mesGerarEtiquetasLote14 = function (id) {
    var L = livro().lotes[txt(id)]; if (!L) return alert('Lote não encontrado.');
    var sem = L.Apontamentos.filter(function (r) { return !etiquetasDoApontamento(r).length; });
    if (!sem.length) return alert('Todos os apontamentos deste lote já têm etiqueta.');
    window.__mes14GerarLote = { id: L.IdLote, noops: sem.map(function (r) { return r.NOP; }) };
    var q = sem.reduce(function (s, r) { return s + qtdProducao(r); }, 0);
    dialogoModoEtiquetas('Gerar etiquetas — lote ' + esc(L.IdLote) + ' (' + esc(L.CodigoProduto) + ')', q, L.UM, 'mesConfirmarEtiquetasLote14()', 'Gerar etiquetas');
    var box = document.querySelector('#mes14_overlay .mes14-dialog');
    if (box) box.insertAdjacentHTML('beforeend', '<p class="mes14-subtle">Apontamentos sem etiqueta: ' + esc(sem.map(function (r) { return r.NOP + ' (' + r.DataApontamento + ': ' + f4(qtdProducao(r)) + ' ' + (r['Unidade de medida'] || L.UM) + ')'; }).join('; ')) + '. Cada apontamento recebe as suas etiquetas. ' +
      (L.Saldo <= 1e-9 ? '<b>O saldo deste lote é zero</b> (já consumido): as etiquetas servem só para a rastreabilidade.' : 'Saldo do lote: ' + f4(L.Saldo) + ' ' + esc(L.UM) + '.') + '</p>');
  };
  window.mesConfirmarEtiquetasLote14 = function () {
    var g = window.__mes14GerarLote; if (!g) return fecharDialogo();
    var L = livro().lotes[g.id]; if (!L) return fecharDialogo();
    var sem = L.Apontamentos.filter(function (r) { return g.noops.indexOf(r.NOP) >= 0 && !etiquetasDoApontamento(r).length; });
    var q = sem.reduce(function (s, r) { return s + qtdProducao(r); }, 0), m = modoEscolhido(q); if (!m) return;
    var ets = [];
    sem.forEach(function (r) { ets = ets.concat(criarEtiquetas(r, opPor(r.CodOP), m.modo === 'POR_UNIDADE' && Math.abs(qtdProducao(r) - Math.round(qtdProducao(r))) > 1e-9 ? 'AGLUTINADA' : m.modo, m.k)); });
    salvar(); fecharDialogo();
    if (ets.length && confirm(ets.length + ' etiqueta(s) gerada(s). Imprimir agora?')) window.mesImprimirEtiquetas14(ets.map(function (e) { return e.IdEtiqueta; }).join(','));
    if (current === 'producao' && typeof showProdOP === 'function') showProdOP(); else window.mesEstoquePI14();
  };

  /* ---------------------------------------------------------------------
     9) ESTOQUE DE PI E PA PRONTOS — aba no Estoque / Rastreabilidade (e item "Estoque PI / PA" no menu)
     --------------------------------------------------------------------- */
  var SUBVISOES = [['produto', 'Por produto'], ['lote', 'Por lote (OP)'], ['etiqueta', 'Por etiqueta'], ['mov', 'Movimentos'], ['conf', 'Conferência das regras']];
  var MOTIVOS_BAIXA = ['Expedição / envio ao cliente', 'Amostra / ensaio', 'Descarte / sucata', 'Ajuste de inventário', 'Outro'];
  function lotesFiltrados() {
    var L = livro(), tipo = window.__mes14Tipo || '', q = norm(window.__mes14Q || '');
    return Object.keys(L.lotes).map(function (id) { return L.lotes[id]; }).filter(function (x) {
      if (tipo && x.Tipo !== tipo) return false;
      if (!q) return true;
      return norm([x.IdLote, x.CodOP, x.CodigoProduto, x.Descricao, x.Familia, x.Etiquetas.map(function (e) { return e.e.IdEtiqueta; }).join(' ')].join(' ')).indexOf(q) >= 0;
    }).sort(function (a, b) { return String(a.CodigoProduto).localeCompare(String(b.CodigoProduto), 'pt-BR', { numeric: true }) || String(a.CodOP).localeCompare(String(b.CodOP), 'pt-BR', { numeric: true }); });
  }
  function statusSaldo(saldo, total) { return saldo <= 1e-9 ? tag('Sem saldo', '') : (saldo + 1e-9 < total ? tag('Parcial', 'info') : tag('Disponível', 'ok')); }
  function renderEstoquePI() {
    var box = el('v47_stock_tbl'); if (!box) return;
    estilo();
    cabecalho('Estoque de PI e PA prontos', 'Saldo de produtos intermediários e acabados por lote (OP) e etiqueta: produzido − consumido pelas etapas seguintes − perdido por retirada − baixas. Etiquetas com código de barras.');
    var kpi = el('v1014_stock_kpis'); if (kpi) kpi.innerHTML = '';
    var sub = window.__mes14Sub || 'produto', lotes = lotesFiltrados(), Lv = livro();
    var nEt = 0, nEtSaldo = 0, semEt = 0;
    lotes.forEach(function (x) { nEt += x.Etiquetas.length; nEtSaldo += x.Etiquetas.filter(function (e) { return e.Saldo > 1e-9; }).length; semEt += x.Apontamentos.filter(function (r) { return !etiquetasDoApontamento(r).length; }).length; });
    var html = '<div class="mes14-kpis"><div><small>Lotes PI com saldo</small><b>' + lotes.filter(function (x) { return x.Tipo === 'PI' && x.Saldo > 1e-9; }).length + '</b></div>' +
      '<div><small>Lotes PA com saldo</small><b>' + lotes.filter(function (x) { return x.Tipo === 'PA' && x.Saldo > 1e-9; }).length + '</b></div>' +
      '<div><small>Etiquetas com saldo</small><b>' + nEtSaldo + ' / ' + nEt + '</b></div><div><small>Apontamentos sem etiqueta</small><b>' + semEt + '</b></div>' +
      '<div><small>PI reservado p/ OPs abertas</small><b>' + lotes.filter(function (x) { return x.Reservado > 1e-9; }).length + ' lote(s)</b></div></div>' +
      campoLeitura('mes14_est_scan', 'Ler etiqueta (rastrear)', 'Bipe a etiqueta ET… e tecle Enter', 'mesEstoqueLerEtiqueta14') +
      '<div class="toolbar" style="margin:0 0 8px"><label>Tipo<select onchange="window.__mes14Tipo=this.value;mesEstoquePI14()"><option value="">PI e PA</option><option value="PI"' + (window.__mes14Tipo === 'PI' ? ' selected' : '') + '>Só PI</option><option value="PA"' + (window.__mes14Tipo === 'PA' ? ' selected' : '') + '>Só PA</option></select></label>' +
      '<input id="mes14_est_q" placeholder="Produto, OP, lote, etiqueta..." value="' + esc(window.__mes14Q || '') + '" onchange="window.__mes14Q=this.value;mesEstoquePI14()">' +
      '<button class="secondary" onclick="mesImprimirSelecionadas14()">Imprimir etiquetas selecionadas</button><button class="secondary" onclick="mesExportarEstoquePI14()">Exportar Excel</button></div>' +
      '<div class="mes14-tabs">' + SUBVISOES.map(function (s) { return '<button class="' + (s[0] === sub ? 'on' : '') + '" onclick="window.__mes14Sub=\'' + s[0] + '\';mesEstoquePI14()">' + s[1] + '</button>'; }).join('') + '</div>';
    if (sub === 'produto') html += visaoProduto(lotes);
    else if (sub === 'lote') html += visaoLote(lotes);
    else if (sub === 'etiqueta') html += visaoEtiqueta(lotes);
    else if (sub === 'mov') html += visaoMovimentos(lotes);
    else html += visaoConferencia(Lv);
    html += '<p class="muted" style="margin-top:8px">Saldo do lote = produção apontada − consumos pelas etapas seguintes (apontados, baixa automática no encerramento ou lote escolhido na geração da OP) − perdas por retirada adicional − baixas. Perda “dentro do consumo” não baixa de novo. <b>Reservado</b> = PI planejado nas OPs abertas que consomem o lote e ainda não consumido.</p>';
    box.innerHTML = html;
  }
  window.mesEstoquePI14 = function () {
    if (el('v47_stock_tbl') && window.__mbcStockView === 'pipa') return renderEstoquePI();
    if (typeof render === 'function') render('estoque_pi_pa');
  };
  function visaoProduto(lotes) {
    var por = {};
    lotes.forEach(function (x) {
      var p = por[x.CodigoProduto] || (por[x.CodigoProduto] = { cod: x.CodigoProduto, desc: x.Descricao, tipo: x.Tipo, um: x.UM, prod: 0, cons: 0, perd: 0, bx: 0, saldo: 0, res: 0, lotes: 0, lotesSaldo: 0, et: 0, etSaldo: 0 });
      p.prod += x.Produzido; p.cons += x.Consumido; p.perd += x.Perdido; p.bx += x.Baixado; p.saldo += x.Saldo; p.res += x.Reservado; p.lotes++; if (x.Saldo > 1e-9) p.lotesSaldo++;
      p.et += x.Etiquetas.length; p.etSaldo += x.Etiquetas.filter(function (e) { return e.Saldo > 1e-9; }).length;
    });
    var linhas = Object.keys(por).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); }).map(function (k) {
      var p = por[k], disp = arred(p.saldo - p.res);
      return '<tr><td>' + tag(p.tipo, p.tipo === 'PI' ? 'pi' : 'pa') + '</td><td><b>' + esc(p.cod) + '</b></td><td>' + esc(p.desc) + '</td><td>' + esc(p.um) + '</td><td class="mes14-num">' + f4(p.prod) + '</td><td class="mes14-num">' + f4(p.cons) + '</td>' +
        '<td class="mes14-num">' + f4(p.perd) + '</td><td class="mes14-num">' + f4(p.bx) + '</td><td class="mes14-num"><b>' + f4(p.saldo) + '</b></td><td class="mes14-num">' + f4(p.res) + '</td>' +
        '<td class="mes14-num"><b style="color:' + (disp < -1e-9 ? '#a00e1c' : '#0b3a5c') + '">' + f4(disp) + '</b></td><td class="mes14-num">' + p.lotesSaldo + ' / ' + p.lotes + '</td><td class="mes14-num">' + p.etSaldo + ' / ' + p.et + '</td></tr>';
    });
    return tabela(['Tipo', 'Código', 'Produto', 'UM', 'Produzido', 'Consumido nas etapas', 'Perdido (retirada)', 'Baixas', 'Saldo', 'Reservado OPs abertas', 'Disponível', 'Lotes c/ saldo', 'Etiquetas c/ saldo'], linhas, 'Nenhuma produção de PI/PA apontada.');
  }
  function visaoLote(lotes) {
    var linhas = lotes.map(function (x) {
      var semEt = x.Apontamentos.filter(function (r) { return !etiquetasDoApontamento(r).length; }).length, op = x.op || {};
      return '<tr><td>' + tag(x.Tipo, x.Tipo === 'PI' ? 'pi' : 'pa') + '</td><td><b>' + esc(x.IdLote) + '</b><br><span class="mes14-subtle">família ' + esc(x.Familia) + '</span></td><td>' + esc(x.CodOP) + '<br><span class="mes14-subtle">' + esc(op.Status || '') + '</span></td><td><b>' + esc(x.CodigoProduto) + '</b> ' + esc(x.Descricao) + '</td>' +
        '<td class="mes14-num">' + f4(x.Produzido) + ' ' + esc(x.UM) + '</td><td class="mes14-num">' + f4(x.Consumido) + '</td><td class="mes14-num">' + f4(x.Perdido) + '</td><td class="mes14-num">' + f4(x.Baixado) + '</td>' +
        '<td class="mes14-num"><b style="color:' + (x.Saldo < -1e-9 ? '#a00e1c' : '#0b3a5c') + '">' + f4(x.Saldo) + '</b></td><td>' + statusSaldo(x.Saldo, x.Produzido) + '</td>' +
        '<td class="mes14-num">' + (x.Reservado > 1e-9 || x.Reservas.length ? f4(x.Reservado) + '<br><span class="mes14-subtle">' + esc(x.Reservas.map(function (r) { return r.CodOP; }).join(', ')) + '</span>' : '—') + '</td>' +
        '<td>' + x.Etiquetas.length + (semEt ? ' ' + tag(semEt + ' apont. sem etiqueta', 'alerta') : '') + '</td>' +
        '<td><button class="mini" onclick="mesRastrear14(\'\',\'' + jsStr(x.IdLote) + '\')">Rastrear</button>' + (semEt ? ' <button class="mini secondary" onclick="mesGerarEtiquetasLote14(\'' + jsStr(x.IdLote) + '\')">Gerar etiquetas</button>' : '') +
        (x.Saldo > 1e-9 ? ' <button class="mini secondary" onclick="mesBaixaPI14(\'\',\'' + jsStr(x.IdLote) + '\')">Baixa</button>' : '') + '</td></tr>';
    });
    return tabela(['Tipo', 'Lote / família (OP raiz)', 'OP', 'Produto', 'Produzido', 'Consumido', 'Perdido', 'Baixas', 'Saldo', 'Situação', 'Reservado', 'Etiquetas', 'Ações'], linhas, 'Nenhum lote.');
  }
  function visaoEtiqueta(lotes) {
    var linhas = [];
    lotes.forEach(function (x) {
      x.Etiquetas.forEach(function (e) {
        var mov = arred(e.Especifico + e.Rateado);
        linhas.push('<tr><td><input type="checkbox" class="mes14-sel mes14-et-sel" value="' + esc(e.e.IdEtiqueta) + '"></td><td><b>' + esc(e.e.IdEtiqueta) + '</b><br><span class="mes14-subtle">' + esc(e.e.Sequencia + '/' + e.e.TotalEtiquetas + ' · ' + textoModo(e.e.Modo, e.e.QuantidadePorEtiqueta)) + '</span></td>' +
          '<td>' + tag(x.Tipo, x.Tipo === 'PI' ? 'pi' : 'pa') + ' <b>' + esc(x.CodigoProduto) + '</b> ' + esc(x.Descricao) + '</td><td>' + esc(x.CodOP) + '</td><td>' + esc(x.IdLote) + '<br><span class="mes14-subtle">' + esc(e.e.NOP || '') + '</span></td>' +
          '<td class="mes14-num">' + f4(e.Quantidade) + ' ' + esc(e.e.UM || x.UM) + '</td><td class="mes14-num">' + f4(mov) + '</td><td class="mes14-num"><b>' + f4(e.Saldo) + '</b></td><td>' + statusSaldo(e.Saldo, e.Quantidade) + '</td>' +
          '<td>' + esc(e.e.DataProducao || '') + '</td><td>' + (e.e.ImpressaEm ? tag('Impressa', 'ok') : tag('Não impressa', 'alerta')) + '</td>' +
          '<td><button class="mini" onclick="mesImprimirEtiquetas14(\'' + jsStr(e.e.IdEtiqueta) + '\')">Imprimir</button> <button class="mini secondary" onclick="mesRastrear14(\'' + jsStr(e.e.IdEtiqueta) + '\',\'\')">Rastrear</button>' +
          (e.Saldo > 1e-9 ? ' <button class="mini secondary" onclick="mesBaixaPI14(\'' + jsStr(e.e.IdEtiqueta) + '\',\'\')">Baixa</button>' : '') +
          (e.Movimentos.length || e.Rateado > 1e-9 ? '' : ' <button class="mini danger" onclick="mesCancelarEtiqueta14(\'' + jsStr(e.e.IdEtiqueta) + '\')">Cancelar</button>') + '</td></tr>');
      });
    });
    return '<div class="mes14-actions"><label class="mes14-subtle" style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="mes14-sel" onchange="document.querySelectorAll(\'.mes14-et-sel\').forEach(function(c){c.checked=this.checked}.bind(this))"> marcar todas</label></div>' +
      tabela(['', 'Etiqueta', 'Produto', 'OP', 'Lote / apontamento', 'Quantidade', 'Movimentado', 'Saldo', 'Situação', 'Data', 'Impressão', 'Ações'], linhas, 'Nenhuma etiqueta gerada. As etiquetas nascem no Apontamento de Produção (ou em “Gerar etiquetas” na visão por lote).');
  }
  function visaoMovimentos(lotes) {
    var mov = [];
    lotes.forEach(function (x) {
      x.Apontamentos.forEach(function (r) { mov.push({ d: parseDataHora(r.DataApontamento) || 0, html: '<tr><td>' + esc(r.DataApontamento || '') + '</td><td>' + tag('Produção', 'ok') + '</td><td>' + esc(x.CodigoProduto) + '</td><td>' + esc(x.IdLote) + '</td><td>' + esc(etiquetasDoApontamento(r).map(function (e) { return e.IdEtiqueta; }).join(', ') || '—') + '</td><td>' + esc(x.CodOP) + '</td><td>—</td><td class="mes14-num">+' + f4(qtdProducao(r)) + ' ' + esc(x.UM) + '</td><td>' + esc(r.NOP || '') + '</td><td></td></tr>' }); });
      x.Consumos.forEach(function (c) { mov.push({ d: parseDataHora(String(c.DataApontamento || c.DataConsumo || '').slice(0, 10)) || 0, html: '<tr><td>' + esc(c.DataApontamento || c.DataConsumo || '') + '</td><td>' + tag('Consumo', 'info') + '</td><td>' + esc(x.CodigoProduto) + '</td><td>' + esc(x.IdLote) + '</td><td>' + esc(c.IdEtiqueta || '—') + '</td><td>' + esc(x.CodOP) + '</td><td>' + esc(c.CodOPConsumidora || c.CodOPPA || '') + '</td><td class="mes14-num">−' + f4(c.QuantidadeConsumida) + ' ' + esc(c.UM || x.UM) + '</td><td>' + esc(rotuloOrigemConsumo(c)) + '</td><td><button class="mini danger" onclick="mesPIEstornar(\'' + jsStr(c.IdConsumoPI) + '\')">Estornar</button></td></tr>' }); });
      x.Perdas.forEach(function (p) { mov.push({ d: parseDataHora(p.DataApontamento) || 0, html: '<tr><td>' + esc(p.DataApontamento || '') + '</td><td>' + tag('Perda (retirada)', 'erro') + '</td><td>' + esc(x.CodigoProduto) + '</td><td>' + esc(x.IdLote) + '</td><td>' + esc(p.IdEtiqueta || '—') + '</td><td>' + esc(x.CodOP) + '</td><td>' + esc(p.CodOP || '') + '</td><td class="mes14-num">−' + f4(p.QuantidadePerdida) + ' ' + esc(p.Unidade || x.UM) + '</td><td>' + esc((p.NOPP || '') + ' ' + (p.Motivo || '')) + '</td><td></td></tr>' }); });
      x.Baixas.forEach(function (a) { mov.push({ d: parseDataHora(String(a.Data || '').slice(0, 10)) || 0, html: '<tr><td>' + esc(a.Data || '') + '</td><td>' + tag('Baixa', 'alerta') + '</td><td>' + esc(x.CodigoProduto) + '</td><td>' + esc(x.IdLote) + '</td><td>' + esc(a.IdEtiqueta || '—') + '</td><td>' + esc(x.CodOP) + '</td><td>—</td><td class="mes14-num">−' + f4(a.Quantidade) + ' ' + esc(a.UM || x.UM) + '</td><td>' + esc(a.Motivo + (a.Observacoes ? ' — ' + a.Observacoes : '') + ' · ' + (a.Usuario || '')) + '</td><td><button class="mini danger" onclick="mesEstornarBaixaPI14(\'' + jsStr(a.IdAjustePI) + '\')">Estornar</button></td></tr>' }); });
    });
    mov.sort(function (a, b) { return (b.d || 0) - (a.d || 0); });
    return tabela(['Data', 'Movimento', 'Produto', 'Lote', 'Etiqueta', 'OP de origem', 'OP consumidora', 'Quantidade', 'Referência', ''], mov.map(function (m) { return m.html; }), 'Sem movimentos.');
  }
  window.mesEstoqueLerEtiqueta14 = function (v) {
    var cod = txt(v).toUpperCase(), inf = infoEtiqueta(cod), inp = el('mes14_est_scan');
    if (!inf) { bip(false); aviso('mes14_est_scan_msg', '✖ Etiqueta <b>' + esc(cod) + '</b> não encontrada.', 'erro'); if (inp) inp.select(); return; }
    bip(true); if (inp) inp.value = '';
    aviso('mes14_est_scan_msg', '✔ ' + esc(cod) + ' — ' + esc(inf.lote.CodigoProduto + ' ' + inf.lote.Descricao) + ' · saldo ' + f4(inf.et.Saldo) + ' ' + esc(inf.lote.UM), 'ok');
    window.mesRastrear14(cod, '');
  };
  window.mesImprimirSelecionadas14 = function () {
    var ids = [].map.call(document.querySelectorAll('.mes14-et-sel:checked'), function (c) { return c.value; });
    if (!ids.length) { window.__mes14Sub = 'etiqueta'; renderEstoquePI(); return alert('Marque as etiquetas na visão “Por etiqueta”.'); }
    window.mesImprimirEtiquetas14(ids.join(','));
  };
  window.mesCancelarEtiqueta14 = function (id) {
    var e = A(D().etiquetas_producao).find(function (x) { return x.IdEtiqueta === id; }), inf = infoEtiqueta(id); if (!e || !inf) return;
    if (inf.et.Movimentos.length || inf.et.Rateado > 1e-9) return alert('A etiqueta já tem movimento: estorne antes de cancelar.');
    if (!confirm('Cancelar a etiqueta ' + id + ' (' + f4(e.Quantidade) + ' ' + (e.UM || '') + ')? A quantidade volta para “sem etiqueta” no lote ' + e.IdLote + ' e pode ser etiquetada de novo.')) return;
    e.Status = 'CANCELADA'; e.CanceladoEm = agora(); e.CanceladoPor = usuario();
    salvar(); renderEstoquePI();
  };
  window.mesBaixaPI14 = function (idEt, idL) {
    var inf = idEt ? infoEtiqueta(idEt) : null, L = inf ? inf.lote : livro().lotes[txt(idL)]; if (!L) return;
    var saldo = inf ? Math.min(inf.et.Saldo, L.Saldo) : (L.SaldoSemEtiqueta > 1e-9 ? Math.min(L.SaldoSemEtiqueta, L.Saldo) : L.Saldo);
    if (!idEt && L.SaldoSemEtiqueta <= 1e-9 && L.Etiquetas.some(function (e) { return e.Saldo > 1e-9; })) return alert('O saldo deste lote está nas etiquetas: faça a baixa pela etiqueta (visão “Por etiqueta”).');
    abrirDialogo('<h3>Baixa de ' + esc(L.Tipo) + ' — ' + esc(idEt ? 'etiqueta ' + idEt : 'lote ' + L.IdLote) + '</h3><p>' + esc(L.CodigoProduto + ' ' + L.Descricao) + ' · saldo ' + f4(saldo) + ' ' + esc(L.UM) + '</p>' +
      '<p class="muted">Saída sem OP consumidora (expedição, amostra, descarte, ajuste). O custo já está na OP que produziu o item: a baixa só tira do estoque. Pode ser estornada em “Movimentos”.</p>' +
      '<div class="mes14-grid"><label><span>Quantidade</span><input id="mes14_bx_q" inputmode="decimal" value="' + esc(String(arred(saldo))) + '"></label><label><span>Motivo</span><select id="mes14_bx_m">' + MOTIVOS_BAIXA.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('') + '</select></label>' +
      '<label class="wide"><span>Observação / documento</span><input id="mes14_bx_o" placeholder="Ex.: NF 123, laudo, cliente"></label></div>' +
      '<div class="mes14-actions"><button onclick="mesBaixaPIConfirmar14(\'' + jsStr(idEt || '') + '\',\'' + jsStr(L.IdLote) + '\')">Confirmar baixa</button><button class="secondary" onclick="mesFecharDialogo14()">Cancelar</button></div><div id="mes14_bx_msg" class="mes14-msg"></div>');
  };
  window.mesBaixaPIConfirmar14 = function (idEt, idL) {
    var inf = idEt ? infoEtiqueta(idEt) : null, L = inf ? inf.lote : livro().lotes[txt(idL)]; if (!L) return fecharDialogo();
    var saldo = inf ? Math.min(inf.et.Saldo, L.Saldo) : Math.min(L.SaldoSemEtiqueta > 1e-9 ? L.SaldoSemEtiqueta : L.Saldo, L.Saldo), q = numDigitado(val('mes14_bx_q'));
    if (!(q > 0)) return aviso('mes14_bx_msg', 'Informe a quantidade.', 'erro');
    if (q > saldo + 1e-9) return aviso('mes14_bx_msg', 'A baixa passa do saldo (' + f4(saldo) + ').', 'erro');
    D().estoque_pi_ajustes.push({ IdAjustePI: idNovo('APA'), IdEtiqueta: idEt || '', IdLote: L.IdLote, CodOP: L.CodOP, CodigoProduto: L.CodigoProduto, TipoProduto: L.Tipo, Quantidade: String(arred(q)), UM: L.UM,
      Motivo: val('mes14_bx_m'), Observacoes: txt(val('mes14_bx_o')), Data: agora(), Usuario: usuario(), Status: 'ATIVO' });
    salvar(); fecharDialogo(); renderEstoquePI();
  };
  window.mesEstornarBaixaPI14 = function (id) {
    var a = A(D().estoque_pi_ajustes).find(function (x) { return x.IdAjustePI === id; }); if (!a || a.Status === 'ESTORNADO') return;
    if (!confirm('Estornar a baixa de ' + f4(a.Quantidade) + ' ' + (a.UM || '') + ' (' + a.Motivo + ')? A quantidade volta ao saldo.')) return;
    a.Status = 'ESTORNADO'; a.EstornadoEm = agora(); a.EstornadoPor = usuario();
    salvar(); renderEstoquePI();
  };
  window.mesExportarEstoquePI14 = function () {
    if (typeof downloadAuditExcelV3819 !== 'function') return alert('Exportação indisponível.');
    var lotes = lotesFiltrados();
    downloadAuditExcelV3819('MES_LION_estoque_PI_PA.xls', 'Estoque de PI e PA prontos', [
      { title: 'Saldo por lote (OP)', rows: lotes.map(function (x) { return { Tipo: x.Tipo, Lote: x.IdLote, OP: x.CodOP, Produto: x.CodigoProduto, Descricao: x.Descricao, Familia: x.Familia, UM: x.UM, Produzido: x.Produzido, Consumido: x.Consumido, PerdidoRetirada: x.Perdido, Baixas: x.Baixado, Saldo: x.Saldo, Reservado: x.Reservado, Disponivel: x.Disponivel }; }) },
      { title: 'Etiquetas', rows: [].concat.apply([], lotes.map(function (x) { return x.Etiquetas.map(function (e) { return { Etiqueta: e.e.IdEtiqueta, Produto: x.CodigoProduto, OP: x.CodOP, Lote: x.IdLote, Apontamento: e.e.NOP, Quantidade: e.Quantidade, Movimentado: arred(e.Especifico + e.Rateado), Saldo: e.Saldo, UM: e.e.UM, Modo: e.e.Modo, Data: e.e.DataProducao, Impressa: e.e.ImpressaEm || '' }; }); })) },
      { title: 'Consumos de PI', rows: A(D().op_pi_consumos) },
      { title: 'Baixas de PI/PA', rows: A(D().estoque_pi_ajustes) }
    ]);
  };
  /* rastreabilidade: para trás (insumos da OP do lote, recursivo pelos lotes de PI consumidos) e para frente (onde o lote foi usado) */
  function rastroTras(L, visit, nivel) {
    if (!L) return '';
    if (visit[L.IdLote] || nivel > 8) return '<li><span class="no">↺ ' + esc(L.IdLote) + '</span></li>';
    visit[L.IdLote] = 1;
    var op = L.op || {}, cod = txt(L.CodOP), itens = [];
    A(D().consumos_materiais).filter(function (c) { return txt(c.CodOP) === cod; }).forEach(function (c) {
      itens.push('<li><span class="no">MP <b>' + esc(c.CodigoMaterial) + '</b> ' + esc(c.DescricaoMaterial || '') + ' · lote ' + esc(c.Lote || '—') + ' · entrada ' + esc(c.Entrada || '—') + ' · ' + f4(c.ConsumoLiquido) + ' ' + esc(c.UM || '') + '</span></li>');
    });
    if (!itens.length) A(D().op_materiais).filter(function (m) { return txt(m.CodOP) === cod && !ehLinhaPI(m); }).forEach(function (m) {
      itens.push('<li><span class="no">MP <b>' + esc(m.CodigoMaterial) + '</b> ' + esc(m.DescricaoMaterial || '') + ' · planejado ' + f4(m.QtdPlanejada) + ' ' + esc(m.UM || '') + ' <span class="mes14-subtle">(sem consumo por lote apontado)</span></span></li>');
    });
    consumosDaOPConsumidora(cod, '').forEach(function (c) {
      var Lo = livro().lotes[txt(c.IdLotePI)] || (opPor(c.CodOPOrigemPI) ? livro().lotes[idLote(opPor(c.CodOPOrigemPI))] : null);
      itens.push('<li><span class="no">PI <b>' + esc(c.CodigoPI) + '</b> · ' + esc(c.IdEtiqueta ? 'etiqueta ' + c.IdEtiqueta : 'lote ' + (c.IdLotePI || '—')) + ' · ' + f4(c.QuantidadeConsumida) + ' ' + esc(c.UM || '') + ' · ' + esc(rotuloOrigemConsumo(c)) + '</span>' + (Lo ? '<ul>' + rastroTras(Lo, visit, nivel + 1) + '</ul>' : '') + '</li>');
    });
    return '<li><span class="no">' + tag(L.Tipo, L.Tipo === 'PI' ? 'pi' : 'pa') + ' <b>' + esc(L.IdLote) + '</b> · OP ' + esc(cod) + ' · ' + esc(L.CodigoProduto + ' ' + L.Descricao) + ' · produzido ' + f4(L.Produzido) + ' ' + esc(L.UM) + ' · ' + esc(op.Status || '') + '</span>' + (itens.length ? '<ul>' + itens.join('') + '</ul>' : '') + '</li>';
  }
  function rastroFrente(L, visit, nivel, soEtiqueta) {
    if (!L) return '';
    if (visit[L.IdLote] || nivel > 8) return '<li><span class="no">↺ ' + esc(L.IdLote) + '</span></li>';
    visit[L.IdLote] = 1;
    var itens = [];
    L.Consumos.filter(function (c) { return !soEtiqueta || txt(c.IdEtiqueta) === soEtiqueta; }).forEach(function (c) {
      var opC = opPor(c.CodOPConsumidora) || (txt(c.CodOPPA) ? opPor(c.CodOPPA) : null), Lc = opC ? livro().lotes[idLote(opC)] : null;
      itens.push('<li><span class="no">→ consumido na OP <b>' + esc(opC ? opC.CodOP : (c.CodOPConsumidora || c.CodOPPA || '?')) + '</b>' + (c.Processo ? ' · ' + esc(c.Processo) : '') + ' · ' + f4(c.QuantidadeConsumida) + ' ' + esc(c.UM || '') + (c.IdEtiqueta ? ' · etiqueta ' + esc(c.IdEtiqueta) : '') + ' · ' + esc(rotuloOrigemConsumo(c)) + '</span>' + (Lc ? '<ul>' + rastroFrente(Lc, visit, nivel + 1, '') + '</ul>' : '') + '</li>');
    });
    L.Perdas.filter(function (p) { return !soEtiqueta || txt(p.IdEtiqueta) === soEtiqueta; }).forEach(function (p) { itens.push('<li><span class="no">✖ perda ' + esc(p.NOPP || '') + ' na OP ' + esc(p.CodOP) + ' · ' + f4(p.QuantidadePerdida) + ' ' + esc(p.Unidade || '') + ' · ' + esc(p.Motivo || '') + '</span></li>'); });
    L.Baixas.filter(function (a) { return !soEtiqueta || txt(a.IdEtiqueta) === soEtiqueta; }).forEach(function (a) { itens.push('<li><span class="no">⇲ baixa ' + f4(a.Quantidade) + ' ' + esc(a.UM || '') + ' · ' + esc(a.Motivo) + '</span></li>'); });
    if (L.Tipo === 'PA') A(D().bp).filter(function (b) { return txt(b.CodOrdemProducao) === txt(L.CodOP); }).forEach(function (b) { itens.push('<li><span class="no">▣ Passaporte ' + esc(b.BatteryPassportID || '') + ' · ' + esc(b.StatusPassaporte || '') + '</span></li>'); });
    var saldo = soEtiqueta && L.Etiquetas.find(function (e) { return e.e.IdEtiqueta === soEtiqueta; });
    return '<li><span class="no">' + tag(L.Tipo, L.Tipo === 'PI' ? 'pi' : 'pa') + ' <b>' + esc(soEtiqueta || L.IdLote) + '</b> · OP ' + esc(L.CodOP) + ' · saldo ' + f4(saldo ? saldo.Saldo : L.Saldo) + ' ' + esc(L.UM) + '</span>' + (itens.length ? '<ul>' + itens.join('') + '</ul>' : '<ul><li class="mes14-subtle">ainda não usado</li></ul>') + '</li>';
  }
  window.mesRastrear14 = function (idEt, idL) {
    var inf = idEt ? infoEtiqueta(idEt) : null, L = inf ? inf.lote : livro().lotes[txt(idL)];
    if (!L) return alert('Etiqueta/lote não encontrado.');
    abrirDialogo('<h3>Rastreabilidade — ' + esc(idEt ? 'etiqueta ' + idEt : 'lote ' + L.IdLote) + '</h3><p class="muted">' + esc(L.CodigoProduto + ' ' + L.Descricao + ' · OP ' + L.CodOP + ' · família ' + L.Familia) + '</p>' +
      '<div class="mes14-trace"><h4>Para trás — de onde veio (insumos da OP, lotes de MP e de PI)</h4><ul>' + rastroTras(L, {}, 0) + '</ul>' +
      '<h4>Para frente — onde foi usado</h4><ul>' + rastroFrente(L, {}, 0, idEt || '') + '</ul></div>' +
      '<div class="mes14-actions">' + (idEt ? '<button class="secondary" onclick="mesImprimirEtiquetas14(\'' + jsStr(idEt) + '\')">Imprimir etiqueta</button>' : '') + '<button onclick="mesFecharDialogo14()">Fechar</button></div>');
  };
  /* conferência das regras de cálculo e rastreabilidade */
  /* custo gravado (fechado ou calculado antes do fechamento) cuja quantidade-base não é a produção apontada; sem
     QuantidadeBaseCusto (registros antigos) a base é CustoTotal ÷ CustoUnitario */
  function baseDoCusto(c) { return N(c.QuantidadeBaseCusto) || (N(c.CustoUnitario) ? N(c.CustoTotal) / N(c.CustoUnitario) : 0); }
  function custoFechadoDivergente() {
    return A(D().custos_op).filter(function (c) {
      if (!c) return false;
      var cod = txt(c.CodOP || c.CodOPMae), s = somaProducao(cod), b = baseDoCusto(c);
      return s > 0 && b > 0 && Math.abs(b - s) > Math.max(1e-6, 1e-4 * s);
    });
  }
  function visaoConferencia(Lv) {
    var d = D(), linhas = [];
    function item(ok, titulo, det, acao) { linhas.push('<tr><td>' + (ok ? tag('OK', 'ok') : tag('Ver', 'alerta')) + '</td><td><b>' + esc(titulo) + '</b></td><td>' + det + '</td><td>' + (acao || '') + '</td></tr>'); }
    var divQ = A(d.op).filter(function (o) { var p = producaoDaOP(o.CodOP); return p.length && Math.abs(N(o.QtdProduzida) - somaProducao(o.CodOP)) > 1e-6; });
    var cor = A(d.meta && d.meta.mes140CorrecoesQtd);
    item(!divQ.length, 'Quantidade produzida da OP = soma dos apontamentos', (divQ.length ? esc(divQ.map(function (o) { return o.CodOP + ': ' + o.QtdProduzida + ' ≠ ' + f4(somaProducao(o.CodOP)); }).join('; ')) : 'Todas as OPs batem.') +
      (cor.length ? '<br><span class="mes14-subtle">Corrigidas na atualização para a 1.4.0 (o lançamento antigo somava o último apontamento duas vezes): ' + esc(cor.map(function (c) { return c.CodOP + ' ' + c.Antes + ' → ' + c.Depois; }).join('; ')) + '</span>' : ''));
    var negativos = Object.keys(Lv.lotes).map(function (k) { return Lv.lotes[k]; }).filter(function (x) { return x.Saldo < -1e-9; });
    item(!negativos.length, 'Nenhum lote de PI/PA com saldo negativo', negativos.length ? esc(negativos.map(function (x) { return x.IdLote + ' (' + f4(x.Saldo) + ')'; }).join('; ')) : 'OK.');
    var amais = Object.keys(Lv.lotes).map(function (k) { return Lv.lotes[k]; }).filter(function (x) { return x.EtiquetadoAMais > 1e-9; });
    item(!amais.length, 'Etiquetas não passam da produção apontada', amais.length ? esc(amais.map(function (x) { return x.IdLote + ' (+' + f4(x.EtiquetadoAMais) + ')'; }).join('; ')) : 'OK.');
    item(!Lv.orfaos.length, 'Consumos de PI ligados a um lote existente', Lv.orfaos.length ? esc(Lv.orfaos.length + ' consumo(s) sem lote correspondente: ' + Lv.orfaos.slice(0, 8).map(function (c) { return (c.IdLotePI || '?') + ' → ' + (c.CodOPConsumidora || c.CodOPPA || ''); }).join('; ')) : 'OK.');
    var cf = custoFechadoDivergente();
    item(!cf.length, 'Custo gravado (fechado ou calculado) com a produção apontada como quantidade-base', cf.length ? esc(cf.map(function (c) { return (c.CodOP || c.CodOPMae) + ': base ' + f4(baseDoCusto(c)) + ' × apontado ' + f4(somaProducao(c.CodOP || c.CodOPMae)) + ' (custo unitário ' + reais(c.CustoUnitario) + ')'; }).join('; ')) + '<br><span class="mes14-subtle">O custo unitário foi dividido pela quantidade em dobro (erro do lançamento antigo). “Refazer” grava o custo fechado de novo com a produção apontada (o total é recalculado com os dados atuais).</span>' : 'OK.',
      cf.length ? cf.map(function (c) { return '<button class="mini" onclick="mesRefazerCustoFechado14(\'' + jsStr(c.CodOP || c.CodOPMae) + '\')">Refazer ' + esc(c.CodOP || c.CodOPMae) + '</button>'; }).join(' ') : '');
    var pend = [];
    A(d.roteiro).forEach(function (r) { if (!r || !etapasRoteiro(r.CodRoteiro).length) return; var n = diagnosticoFluxo(r.CodRoteiro).filter(function (x) { return !x.ok; }).length; if (n) pend.push(r.CodRoteiro + ' (' + n + ')'); });
    item(!pend.length, 'Roteiros com o fluxo de PIs completo (todo PI entra em alguma operação depois de produzido)', pend.length ? esc(pend.join('; ')) : 'OK.', pend.length ? '<button class="mini secondary" onclick="render(\'roteiro\')">Abrir roteiros</button>' : '');
    var semOrig = A(d.perdas).filter(function (p) { return p && String(p.PerdaAlvoTipo || '').toUpperCase() === 'MATERIAL' && !p.OrigemPerda; });
    item(true, 'Perdas de material sem “origem da perda” (registradas antes da 1.4.0)', semOrig.length ? semOrig.length + ' perda(s): continuam somando ao custo de perdas e ao CO₂ como antes.' : 'Nenhuma.');
    item(true, 'Baixa automática do PI da família no encerramento da OP consumidora', (baixaAutomaticaLigada() ? 'Ligada.' : 'Desligada.') + (d.meta && d.meta.mes140BaixaLegadoPI ? '<br><span class="mes14-subtle">OPs encerradas antes da 1.4.0: ' + esc(d.meta.mes140BaixaLegadoPI) + '</span>' : ''),
      '<button class="mini secondary" onclick="mesAlternarBaixaAuto14()">' + (baixaAutomaticaLigada() ? 'Desligar' : 'Ligar') + '</button>');
    return tabela(['', 'Regra', 'Situação', ''], linhas) +
      '<div class="mes14-card" style="margin-top:10px"><h4>Regras de cálculo da 1.4.0</h4><ul class="mes14-subtle" style="margin:0;padding-left:18px">' +
      '<li>PI consumido dentro da família não transfere custo nem CO₂ (já estão na OP que produziu o PI). PI de outra família / PI isolado herda o custo e o CO₂ fechados da OP de origem, na proporção consumida.</li>' +
      '<li>Perda “dentro do consumo apontado” é a parte do consumo que se perdeu: não baixa o estoque de novo e não soma custo/CO₂ (já estão no consumo). Perda por retirada adicional baixa o saldo e soma custo/CO₂ — exceto PI da própria família, cujo custo já está na OP de origem.</li>' +
      '<li>Tempo real finalizado por máquina substitui o planejado daquela máquina em energia e mão de obra.</li>' +
      '<li>Quantidade produzida da OP = soma dos apontamentos de produção; etiquetas somam exatamente cada apontamento.</li></ul></div>';
  }
  window.mesAlternarBaixaAuto14 = function () { var d = D(); d.meta.mesBaixaAutomaticaPI = baixaAutomaticaLigada() ? 'Não' : 'Sim'; salvar(); renderEstoquePI(); };
  window.mesRefazerCustoFechado14 = function (cod) {
    if (typeof v104FreezeCost !== 'function') return alert('Função de fechamento de custo indisponível.');
    if (!confirm('Refazer o custo fechado da OP ' + cod + ' com a produção apontada (' + f4(somaProducao(cod)) + ')? O registro anterior é substituído.')) return;
    try { v104FreezeCost(cod, true); try { if (typeof v403SyncPILots === 'function') v403SyncPILots(); } catch (e) { } salvar(); alert('Custo fechado refeito.'); } catch (e) { alert('Falha ao refazer: ' + (e.message || e)); }
    renderEstoquePI();
  };

  /* ---------------------------------------------------------------------
     10) REGRAS DE CÁLCULO
     a) QtdProduzida = soma dos apontamentos de produção. O lançamento V3.x gravava "soma (que já inclui o apontamento
        novo) + quantidade do apontamento": o último apontamento ficava contado duas vezes nesse campo, que é o usado
        pelos lotes de PI, pelo custo fechado (quantidade-base) e pela ACV ("produzido").
     b) Perda de material/PI marcada "dentro do consumo apontado": custo e CO₂ já estão no consumo — não soma de novo.
        Perda de PI produzido na própria família: custo e CO₂ já estão na OP que produziu o PI — não soma de novo.
        Perda de PI de outra família / PI isolado por retirada adicional: herda custo e CO₂ fechados da OP de origem.
     c) Saldo do lote de PI (V40.3) = o do livro do estoque (consumos + perdas por retirada + baixas).
     --------------------------------------------------------------------- */
  function normalizarQtdProduzida() {
    var d = D(), porOP = {}, log = [];
    A(d.producao).forEach(function (r) { var k = txt(r && r.CodOP); if (k) porOP[k] = (porOP[k] || 0) + qtdProducao(r); });
    A(d.op).forEach(function (o) {
      var k = txt(o && o.CodOP); if (!k || !Object.prototype.hasOwnProperty.call(porOP, k)) return;
      var soma = arred(porOP[k]);
      if (Math.abs(N(o.QtdProduzida) - soma) > 1e-6) { log.push({ CodOP: k, Antes: String(o.QtdProduzida == null ? '' : o.QtdProduzida), Depois: String(soma).replace('.', ','), Data: agora() }); o.QtdProduzida = String(soma).replace('.', ','); }
    });
    if (log.length) d.meta.mes140CorrecoesQtd = A(d.meta.mes140CorrecoesQtd).concat(log);
    return log.length;
  }
  (function () {
    var ant = window.registrarProducaoOP;
    if (typeof ant !== 'function') return;
    window.registrarProducaoOP = function () {
      var op = opSelecionada('prod_op'), cod = op && op.CodOP;
      var r = ant.apply(this, arguments);
      try {
        var o = opPor(cod);
        if (o && producaoDaOP(cod).length) {
          var novo = String(somaProducao(cod)).replace('.', ',');
          if (txt(o.QtdProduzida) !== novo) { o.QtdProduzida = novo; try { if (typeof recalcOPFamilyV395 === 'function') recalcOPFamilyV395(cod); } catch (e) { } salvar(); }
        }
      } catch (e) { console.warn('MES LION 1.4: quantidade produzida', e); }
      return r;
    };
  })();
  function perdaPIExterna(p, op) {
    if (p.PIExterno === 'Sim') return true;
    if (p.PIExterno === 'Não') return false;
    var cod = txt(p.CodigoMaterial || p.ItemPerdaCodigo), raiz = raizFamilia(op || opPor(p.CodOP)), origem = null;
    if (txt(p.CodOPOrigemPI)) origem = opPor(p.CodOPOrigemPI);
    if (!origem && txt(p.IdLotePI)) origem = opDoLote(p.IdLotePI);
    if (!origem) {
      var m = A(D().op_materiais).find(function (x) { return x && txt(x.CodOP) === txt(p.CodOP) && ehLinhaPI(x) && txt(x.CodigoMaterial) === cod; });
      if (m && txt(m.Lote)) origem = opDoLote(String(m.Lote).split(';')[0]);
      if (!origem && m && txt(m.OPOrigemPI)) origem = opPor(m.OPOrigemPI);
    }
    if (!origem) origem = opOrigemNaFamilia(raiz, cod);
    return !!origem && raizFamilia(origem) !== raiz;
  }
  function ehPerdaDePI(p) {
    var cod = txt(p && (p.CodigoMaterial || p.ItemPerdaCodigo || p.CodMaterial)); if (!cod) return false;
    var pr = produto(cod); if (pr) return String(pr['Tipo Produto'] || '').toUpperCase() === 'PI';
    return A(D().op_materiais).some(function (m) { return m && txt(m.CodOP) === txt(p.CodOP) && ehLinhaPI(m) && txt(m.CodigoMaterial) === cod; });
  }
  function custoUnitarioFechado(op) {
    if (!op) return null;
    try { var row = typeof v104SavedCost === 'function' ? v104SavedCost(op.CodOP) : null; if (row && N(row.QuantidadeBaseCusto) > 0) return { unit: N(row.CustoUnitario) || N(row.CustoTotal) / N(row.QuantidadeBaseCusto), row: row }; } catch (e) { }
    return null;
  }
  (function () {
    var ant = window.v102MaterialLossCost;
    if (typeof ant !== 'function') return;
    window.v102MaterialLossCost = function (p, op) {
      var c = ant.apply(this, arguments) || { unit: 0, total: 0, rule: '' };
      try {
        var q = N(p && p.QuantidadePerdida), u = N(c.unit);
        if (p && p.OrigemPerda === 'DENTRO_DO_CONSUMO') return { unit: u, total: 0, valorInformativo: q * u, rule: 'Perda dentro do consumo já apontado: o custo já está no consumo (valor informativo ' + q + ' × ' + u + ' = ' + (q * u) + '); não soma de novo.' };
        if (p && ehPerdaDePI(p)) {
          if (!perdaPIExterna(p, op)) return { unit: u, total: 0, valorInformativo: q * u, rule: 'Perda de PI produzido na própria família: materiais, energia e MOD já estão na OP que produziu o PI (valor informativo ' + (q * u) + '); não soma de novo.' };
          var origem = opPor(p.CodOPOrigemPI) || opDoLote(p.IdLotePI), cf = custoUnitarioFechado(origem);
          if (cf) return { unit: cf.unit, total: q * cf.unit, rule: 'Perda de PI de outra família/PI isolado: quantidade × custo unitário fechado da OP de origem ' + origem.CodOP + '.' };
        }
      } catch (e) { console.warn('MES LION 1.4: custo de perda', e); }
      return c;
    };
  })();
  (function () {
    var ant = window.perdasMateriaisOPV391;
    if (typeof ant !== 'function') return;
    window.perdasMateriaisOPV391 = function (codOP) {
      var lst = ant.apply(this, arguments) || [];
      try { return lst.filter(function (p) { return p.OrigemPerda !== 'DENTRO_DO_CONSUMO' && !ehPerdaDePI(p); }); } catch (e) { return lst; }
    };
  })();
  (function () {
    var ant = window.calcSustFamiliaOPV33;
    if (typeof ant !== 'function') return;
    window.calcSustFamiliaOPV33 = function (codMae, persist, opts) {
      var fam = []; try { fam = typeof opFamilyV33 === 'function' ? opFamilyV33(codMae) : []; } catch (e) { }
      var cods = {}; A(fam).forEach(function (o) { if (o) cods[txt(o.CodOP)] = 1; });
      var ext = A((D() || {}).perdas).filter(function (p) { return p && cods[txt(p.CodOP)] && p.OrigemPerda === 'RETIRADA_ADICIONAL' && ehPerdaDePI(p) && perdaPIExterna(p, opPor(p.CodOP)); });
      if (!ext.length) return ant.apply(this, arguments);
      var row = ant.call(this, codMae, false, opts) || {}, add = 0;
      ext.forEach(function (p) {
        var origem = opPor(p.CodOPOrigemPI) || opDoLote(p.IdLotePI); if (!origem) return;
        try { var s = typeof v403SourceSust === 'function' ? v403SourceSust({ CodOPOrigem: origem.CodOP }) : null; if (s && s.q) add += N(p.QuantidadePerdida) * N(s.total) / s.q; } catch (e) { }
      });
      if (add) {
        row.CO2eqPerdas = String(N(row.CO2eqPerdas) + add); row.CO2eqTotal = String(N(row.CO2eqTotal) + add);
        row.Observacoes = (row.Observacoes || '') + ' 1.4.0: perda de PI de outra família/PI isolado com o CO₂ herdado da OP de origem.';
      }
      if (persist !== false && row.CodOP) { var d = D(); d.sust_op = A(d.sust_op); var i = d.sust_op.findIndex(function (x) { return (x.CodOPMae || x.CodOP) === codMae; }); if (i >= 0) d.sust_op[i] = row; else d.sust_op.unshift(row); salvar(); }
      return row;
    };
  })();
  (function () {
    var ant = window.v403ConsumidoLote;
    window.v403ConsumidoLote = function (lot) {
      try { var x = livro().lotes[txt(lot && lot.IdLotePI)]; if (x) return arred(x.Consumido + x.Perdido + x.Baixado); } catch (e) { }
      return typeof ant === 'function' ? ant.apply(this, arguments) : 0;
    };
  })();

  /* 1.6.1 — d) OP ENCERRADA OU CANCELADA: SÓ O CONSUMO REAL ENTRA NO CUSTO E NO CO₂.
     O custo da família (auditCostFamilyV4014) projetava, para o material planejado sem consumo apontado, quantidade
     planejada × média ponderada das entradas — também em OP já encerrada, em que esse material não será mais consumido
     (ou foi consumido em outra OP da família, que já tem o custo real: o valor entrava duas vezes). A ACV fazia o mesmo
     com a massa planejada. Agora, em OP encerrada/cancelada, a linha continua na auditoria com quantidade 0, valor 0 e a
     origem "Planejado sem consumo apontado — fora do custo (OP encerrada)" (o planejado fica em QtdPlanejada). OP aberta
     continua com a projeção, que é o custo esperado. O encerramento lista esses materiais antes de encerrar (seção 7).
     ACV: o consumo apontado de um material conta uma vez por OP, mesmo com o material em mais de uma linha da OP (a
     V39.x copiava o total do material para cada linha). */
  function opSemProjecao(op) { return !!op && (opConcluida(op) || opCancelada(op)); }
  function consumoApontado(codOP, codMat) {
    var k = txt(codOP), c = txt(codMat), q = 0;
    A((D() || {}).consumos_materiais).forEach(function (x) {
      if (x && txt(x.CodOP) === k && txt(x.CodigoMaterial) === c) q += N(x.ConsumoLiquido) || Math.max(0, N(x.QtdRetirada) - N(x.QtdDevolvida));
    });
    return q;
  }
  function linhasDoMaterial(codOP, codMat) {
    var k = txt(codOP), c = txt(codMat);
    return A((D() || {}).op_materiais).filter(function (x) { return x && txt(x.CodOP) === k && txt(x.CodigoMaterial || x.CodMaterial) === c && !ehLinhaPI(x); });
  }
  /* apontamento anterior ao consumo por lote (op_materiais.QtdConsumida sem consumos_materiais) */
  function consumoLegado(linhas) { return linhas.reduce(function (s, x) { return s + (N(x.QtdConsumida) || N(x.QtdReal)); }, 0); }
  function qtdPlanejadaLinha(m) { return N(m.QtdPlanejada) || N(m.QtdBase) || N(m.Qtd); }
  function materiaisSemConsumo(op) {
    var vistos = {}, out = [];
    A((D() || {}).op_materiais).forEach(function (m) {
      if (!m || txt(m.CodOP) !== txt(op && op.CodOP) || ehLinhaPI(m)) return;
      var cod = txt(m.CodigoMaterial || m.CodMaterial); if (!cod || vistos[cod]) return;
      vistos[cod] = 1;
      var linhas = linhasDoMaterial(op.CodOP, cod), plan = linhas.reduce(function (s, x) { return s + qtdPlanejadaLinha(x); }, 0);
      if (plan > 0 && !(consumoApontado(op.CodOP, cod) > 0) && !(consumoLegado(linhas) > 0)) {
        var mat = typeof materialPorCodigo === 'function' ? (materialPorCodigo(cod) || {}) : {};
        out.push({ CodigoMaterial: cod, Material: txt(m.DescricaoMaterial) || mat.DescricaoMateriais || '', Planejado: arred(plan), UM: txt(m.UM) || mat.UM || '' });
      }
    });
    return out;
  }
  var REGRA_SEM_CONSUMO = 'Quantidade planejada × média ponderada das entradas compatíveis, só em OP aberta (custo projetado). Em OP encerrada ou cancelada conta só o consumo real: o planejado sem consumo apontado fica fora do custo (valor 0 na auditoria).';
  function regraOPEncerradaNoCusto(a) {
    if (!a || !Array.isArray(a.materiais)) return a;
    var r = (Array.isArray(a.resumo) && a.resumo[0]) || null, delta = 0, fora = [], legadoUsado = {};
    a.materiais.forEach(function (m) {
      if (!m || !/^projetado/i.test(txt(m['Origem custo']))) return;
      if (!opSemProjecao(opPor(m.OP))) return;
      var antes = N(m.Resultado), unit = N(m.CustoUnitario), plan = N(m.Quantidade), chave = txt(m.OP) + '|' + txt(m.CodigoMaterial);
      var leg = legadoUsado[chave] ? 0 : consumoLegado(linhasDoMaterial(m.OP, m.CodigoMaterial));
      legadoUsado[chave] = 1;
      m.QtdPlanejada = plan;
      if (leg > 0) {
        m.Quantidade = leg; m.Resultado = leg * unit;
        m['Cálculo aberto'] = leg + ' × ' + unit + ' = ' + m.Resultado + ' (consumo apontado sem lote; planejado ' + plan + ')';
        m['Origem custo'] = 'Consumo apontado sem lote — média ponderada das entradas (OP encerrada)';
      } else {
        m.Quantidade = 0; m.Resultado = 0;
        m['Cálculo aberto'] = 'OP encerrada sem consumo apontado: 0 (o planejado ' + plan + ' ' + txt(m.UM) + ' × ' + unit + ' = ' + antes + ' fica fora do custo)';
        m['Origem custo'] = 'Planejado sem consumo apontado — fora do custo (OP encerrada)';
        fora.push(m);
      }
      delta += N(m.Resultado) - antes;
    });
    if (r) {
      if (delta) { r.CustoMateriais = N(r.CustoMateriais) + delta; r.CustoTotal = N(r.CustoTotal) + delta; }
      if (fora.length) r.PlanejadoForaDoCusto = fora.map(function (m) { return m.OP + ' ' + m.CodigoMaterial + ' (' + m.QtdPlanejada + ' ' + txt(m.UM) + ')'; }).join('; ');
    }
    a.regras = A(a.regras);
    var rg = a.regras.find(function (x) { return x && /sem apontamento/i.test(String(x['Campo calculado'] || '')); });
    if (rg) rg['Regra/Fórmula'] = REGRA_SEM_CONSUMO; else a.regras.push({ 'Ordem': 2, 'Campo calculado': 'Material sem apontamento', 'Regra/Fórmula': REGRA_SEM_CONSUMO });
    return a;
  }
  (function () {
    var ant = window.auditCostFamilyV4014;
    if (typeof ant !== 'function') return;
    var nova = function (codMae) {
      var a = ant.apply(this, arguments);
      try { regraOPEncerradaNoCusto(a); } catch (e) { console.warn('MES LION 1.6.1: custo de OP encerrada', e); }
      return a;
    };
    window.auditCostFamilyV4014 = nova; window.auditCostFamilyV3822 = nova; window.auditCostFamilyV3819 = nova;
  })();
  /* quantidade de cada linha de material na ACV (auditoriaACVFamiliaV391) */
  function qtdMaterialACV(m) {
    var cod = txt(m.CodigoMaterial || m.CodMaterial), linhas = linhasDoMaterial(m.CodOP, cod), i = linhas.indexOf(m), primeira = i <= 0;
    var real = consumoApontado(m.CodOP, cod);
    if (real > 0) return primeira ? real : 0;
    if (opSemProjecao(opPor(m.CodOP))) { var leg = consumoLegado(linhas); return primeira && leg > 0 ? leg : 0; }
    var legL = N(m.QtdConsumida) || N(m.QtdReal);
    if (legL > 0) return legL;
    /* OP aberta sem consumo: projeção, uma vez por material/etapa/recurso (a mesma chave do custo projetado) */
    var chave = function (x) { return [txt(x.OrdemEtapa || x.Ordem), txt(x.IdRecursoRoteiro)].join('|'); }, kk = chave(m);
    for (var j = 0; j < i; j++) { if (chave(linhas[j]) === kk) return 0; }
    return qtdPlanejadaLinha(m);
  }
  (function () {
    var ant = window.qtdMaterialLinhaV391;
    if (typeof ant !== 'function') return;
    window.qtdMaterialLinhaV391 = function (m) {
      try { if (m && txt(m.CodOP) && !ehLinhaPI(m) && txt(m.CodigoMaterial || m.CodMaterial)) return qtdMaterialACV(m); } catch (e) { console.warn('MES LION 1.6.1: quantidade na ACV', e); }
      return ant.apply(this, arguments);
    };
  })();

  /* 1.6.1 — e) CUSTO POR OP (custosOP: relatório "Custo por OP", "Custos da OP" e texto de custo do passaporte).
     A energia + MOD da OP era a soma de CustoEnergia + CustoMOD do PRIMEIRO cadastro de recurso com o mesmo código de
     equipamento OU o mesmo processo de cada etapa: em geral outro recurso, sem o tempo e a potência da etapa (a OP de PA
     aparecia com R$ 0). Agora vêm das etapas desta OP na auditoria de custo — a mesma conta do custo da família, então a
     soma das OPs fecha com a família. As perdas da OP entram no total efetivo (total projetado: materiais projetados +
     energia + MOD, sem perdas). */
  function custoProprioDaOP(cod) {
    var op = opPor(cod); if (!op) return null;
    var a = typeof v4033AuditCostPI === 'function' ? v4033AuditCostPI(op.CodOP) : null;
    if (!a) return null;
    var en = 0, mod = 0, kwh = 0, perdas = 0;
    A(a.etapas).forEach(function (e) { if (!e || txt(e.OP) !== txt(op.CodOP)) return; en += N(e.CustoEnergia); mod += N(e.CustoMOD); kwh += N(e.EnergiaKWh); });
    A(a.perdas).forEach(function (p) { if (p && txt(p.OP) === txt(op.CodOP)) perdas += N(p.Resultado); });
    return { energia: en, mod: mod, kwh: kwh, perdas: perdas };
  }
  (function () {
    var ant = window.custosOP;
    if (typeof ant !== 'function') return;
    window.custosOP = function (cod) {
      var c = ant.apply(this, arguments) || {};
      try {
        var p = custoProprioDaOP(cod);
        if (p) {
          c.energia = p.energia; c.mod = p.mod; c.energiaKWh = p.kwh; c.processo = p.energia + p.mod; c.perdas = p.perdas;
          c.total = N(c.materiaisProjetado) + c.processo;
          c.totalEfetivo = N(c.materiaisEfetivo) + c.processo + c.perdas;
          c.regraProcesso = 'Energia + MOD das etapas desta OP na auditoria de custo (potência × tempo × tarifa; tempo × pessoas × taxa MOD).';
        }
      } catch (e) { console.warn('MES LION 1.6.1: custo por OP', e); }
      return c;
    };
  })();

  /* ---------------------------------------------------------------------
     11) TELAS: APONTAMENTO DE PRODUÇÃO, REGISTRO DE PERDAS, OP, ROTEIRO, ESTRUTURA E ESTOQUE
     --------------------------------------------------------------------- */
  function decorarApontamento() {
    var box = el('prodBox'), op = opSelecionada('prod_op'); if (!box || !op) return;
    estilo();
    var fechada = !opAberta(op);
    ['ap_hora_ini', 'ap_hora_fim'].forEach(function (id) { var i = el(id), l = i && i.closest('label'); if (l) l.remove(); });
    box.querySelectorAll('.v1014-ap-tempo-btn,.v1014-ap-status').forEach(function (x) { x.remove(); });
    var form = box.querySelector('.op-form');
    var btn = form ? [].find.call(form.querySelectorAll('.form-actions button'), function (b) { return /registrarProducaoOP\(\)/.test(b.getAttribute('onclick') || ''); }) : null;
    if (btn) { btn.setAttribute('onclick', 'mesRegistrarProducaoEtiquetas()'); btn.textContent = 'Registrar produção e etiquetas'; }
    if (form && !el('mes14_prod_msg')) {
      var um = umOP(op);
      form.insertAdjacentHTML('beforeend', '<div id="mes14_prod_msg" class="mes14-msg"></div><p class="mes14-subtle" style="margin:4px 0 0">' + (ehUnidade(um) ? 'Produto em <b>' + esc(um) + '</b>: ao registrar, escolha uma etiqueta por unidade, aglutinar ou N unidades por etiqueta.' : 'Ao registrar, a produção recebe uma etiqueta com a quantidade apontada (' + esc(um) + ').') + '</p>' + infoEtiquetasOP(op));
    }
    if (!el('mes14_tempo')) { var h = painelTempo(op, fechada); if (form) form.insertAdjacentHTML('afterend', h); else box.insertAdjacentHTML('beforeend', h); }
    if (!el('mes14_pi')) { var cm = box.querySelector('.consumo-materiais-v3814'), hp = painelPI(op, fechada); if (cm) cm.insertAdjacentHTML('afterend', hp); else box.insertAdjacentHTML('beforeend', hp); }
    atualizarFormPI();
    if (window.__mes14ProdMsg) { aviso('mes14_prod_msg', window.__mes14ProdMsg.html, window.__mes14ProdMsg.tipo); window.__mes14ProdMsg = null; }
    if (window.__mes14TempoMsg) { aviso('mes14_tp_msg', window.__mes14TempoMsg.html, window.__mes14TempoMsg.tipo); window.__mes14TempoMsg = null; }
    if (window.__mes14PIMsg) { aviso('mes14_pi_msg', window.__mes14PIMsg, 'ok'); window.__mes14PIMsg = null; }
  }
  function syncDaOPSelecionada(id) {
    try { var op = opSelecionada(id); if (op && sincronizarFamilia(raizFamilia(op))) salvar(); } catch (e) { console.warn('MES LION 1.4: sincronização de PIs', e); }
  }
  (function () {
    var ant = window.showProdOP;
    if (typeof ant !== 'function') return;
    window.showProdOP = function () {
      syncDaOPSelecionada('prod_op');
      var r = ant.apply(this, arguments);
      try { decorarApontamento(); } catch (e) { console.warn('MES LION 1.4: apontamento', e); }
      return r;
    };
  })();
  (function () {
    var ant = window.showLossOP;
    if (typeof ant !== 'function') return;
    window.showLossOP = function () {
      syncDaOPSelecionada('loss_op');
      var r = ant.apply(this, arguments);
      try { estilo(); decorarMotivosPerda(); decorarOrigemPerda(); } catch (e) { console.warn('MES LION 1.4: perdas', e); }
      return r;
    };
  })();
  (function () {
    var ant = window.registrarPerdaOP;
    if (typeof ant !== 'function') return;
    window.registrarPerdaOP = function () {
      var op = opSelecionada('loss_op');
      if (!op) return ant.apply(this, arguments);
      var ms = motivoSelecionadoPerda();
      if (ms && ms.exigido && !ms.motivo && N(val('loss_qtd')) > 0) return alert('Selecione o motivo da perda (lista do cadastro de motivos). Se o motivo não existe, use “+ Novo motivo”.');
      var extra = N(val('loss_qtd')) > 0 ? validarPerdaExtra(op) : { ok: true };
      if (!extra.ok) return alert(extra.msg);
      var d = D(), n0 = A(d.perdas).length, catSel = val('loss_tipo');
      var rec = ant.apply(this, arguments);
      try {
        var novo = rec && typeof rec === 'object' && rec.NOPP ? rec : (A(d.perdas).length > n0 ? d.perdas[d.perdas.length - 1] : null);
        if (novo) {
          if (ms && ms.id) novo.IdMotivo = ms.id;
          novo.TipoApontamento = categoriaCanonica(novo.TipoApontamento || catSel) || novo.TipoApontamento;
          if (String(novo.PerdaAlvoTipo || '').toUpperCase() === 'MATERIAL' && extra.origem) {
            novo.OrigemPerda = extra.origem;
            if (extra.pi) {
              if (extra.lote) novo.IdLotePI = extra.lote;
              if (extra.etiqueta) novo.IdEtiqueta = extra.etiqueta;
              var oo = extra.opOrigem || (extra.lote ? txt((opDoLote(extra.lote) || {}).CodOP) : '');
              if (oo) novo.CodOPOrigemPI = oo;
              novo.PIExterno = (extra.externo || (oo && raizFamilia(opPor(oo)) !== raizFamilia(op))) ? 'Sim' : 'Não';
            } else {
              if (extra.entrada) { novo.EntradaMaterial = extra.entrada; novo.Lote = extra.loteMP || ''; }
              if (extra.entradaConsumo) novo.EntradaConsumo = extra.entradaConsumo;
            }
          }
          try { if (typeof recalcOPFamilyV395 === 'function') recalcOPFamilyV395(op.CodOP); } catch (e) { }
          salvar();
          if (typeof showLossOP === 'function' && el('lossBox')) showLossOP();
        }
      } catch (e) { console.warn('MES LION 1.4: registro de perda', e); }
      return rec;
    };
  })();
  /* lista de itens da perda: esconde as linhas de genealogia já substituídas pelo fluxo (mantém o índice das demais) */
  (function () {
    var ant = window.materialOptionsForOPV36;
    if (typeof ant !== 'function') return;
    window.materialOptionsForOPV36 = function (op) {
      var html = ant.apply(this, arguments);
      try {
        var mats = A(D().op_materiais).filter(function (m) { return String(m.CodOP) === String(op && op.CodOP); }), ocultar = {}, algum = false;
        mats.forEach(function (m, i) { if (ehGenealogia(m) && m.FluxoPISubstituido === 'Sim') { ocultar[i] = 1; algum = true; } });
        if (!algum) return html;
        var s = document.createElement('select'); s.innerHTML = html;
        [].slice.call(s.options).forEach(function (o) { if (ocultar[+o.value]) o.remove(); });
        return s.innerHTML;
      } catch (e) { return html; }
    };
  })();
  (function () {
    var ant = window.showOP;
    if (typeof ant !== 'function') return;
    window.showOP = function () {
      syncDaOPSelecionada('selOp');
      return ant.apply(this, arguments);
    };
  })();
  (function () {
    var ant = window.renderRoteiroArvoreV382;
    if (typeof ant !== 'function') return;
    window.renderRoteiroArvoreV382 = function () {
      var r = ant.apply(this, arguments);
      try { decorarRoteiro(); } catch (e) { console.warn('MES LION 1.4: roteiro', e); }
      return r;
    };
  })();
  (function () {
    var ant = window.estruturaModule;
    if (typeof ant !== 'function') return;
    window.estruturaModule = function () {
      var r = ant.apply(this, arguments);
      try { decorarEstrutura(); } catch (e) { console.warn('MES LION 1.4: estrutura', e); }
      return r;
    };
  })();
  /* exclusão de apontamento de produção: as etiquetas dele são canceladas (bloqueia se já foram consumidas/baixadas) */
  (function () {
    var ant = window.excluirApontamentoOP;
    if (typeof ant !== 'function') return;
    window.excluirApontamentoOP = function (fonte, idx, cod) {
      if (fonte !== 'producao') return ant.apply(this, arguments);
      var r = A(D().producao)[idx]; if (!r) return ant.apply(this, arguments);
      var ets = etiquetasDoApontamento(r), comMov = ets.filter(function (e) { var i = infoEtiqueta(e.IdEtiqueta); return i && (i.et.Movimentos.length || i.et.Rateado > 1e-9); });
      if (comMov.length) return alert('Este apontamento tem etiqueta(s) com consumo/baixa (' + comMov.map(function (e) { return e.IdEtiqueta; }).join(', ') + '). Estorne esses movimentos antes de excluir a produção.');
      var opR = opPor(r.CodOP), L = opR ? livro().lotes[idLote(opR)] : null;
      if (L && L.Saldo - qtdProducao(r) < -1e-6) return alert('O lote ' + L.IdLote + ' já teve consumo/baixa maior que a produção que sobraria (' + f4(L.Saldo - qtdProducao(r)) + '). Estorne os consumos antes de excluir este apontamento.');
      var n0 = A(D().producao).length;
      var ret = ant.apply(this, arguments);
      try {
        if (A(D().producao).length < n0 && ets.length) {
          ets.forEach(function (e) { e.Status = 'CANCELADA'; e.MotivoCancelamento = 'Apontamento de produção ' + r.NOP + ' excluído'; e.CanceladoEm = agora(); e.CanceladoPor = usuario(); });
          salvar();
        }
      } catch (e) { }
      return ret;
    };
  })();
  /* "Etiqueta" do histórico e "Etiqueta da última produção": imprime as etiquetas com código de barras do apontamento */
  (function () {
    var ant = window.v4049OpenLabel;
    if (typeof ant !== 'function') return;
    window.v4049OpenLabel = function (kind, idx) {
      if (kind !== 'perdas') {
        var r = A(D().producao)[idx], ets = r ? etiquetasDoApontamento(r) : [];
        if (ets.length) return window.mesImprimirEtiquetas14(ets.map(function (e) { return e.IdEtiqueta; }).join(','));
      }
      return ant.apply(this, arguments);
    };
  })();
  /* leitor do apontamento (1.2.0): etiqueta de PI lida no campo de material vai para o consumo de PI */
  (function () {
    var ant = window.mesApontamentoLerMaterial;
    if (typeof ant !== 'function') return;
    window.mesApontamentoLerMaterial = function (v) {
      var cod = txt(v).toUpperCase();
      if (/^ET\d+$/.test(cod) && infoEtiqueta(cod)) {
        var i = el('mbc_scan_mat'); if (i) i.value = '';
        var p = el('mes14_pi'); if (p && p.scrollIntoView) p.scrollIntoView({ block: 'start' });
        return window.mesPILerEtiqueta(cod);
      }
      return ant.apply(this, arguments);
    };
  })();
  /* Estoque: aba "PI e PA prontos (etiquetas)" */
  function garantirAbaPI() {
    var tabs = el('mbc_stock_tabs');
    if (tabs && !tabs.querySelector('[data-v=pipa]')) tabs.insertAdjacentHTML('beforeend', '<button data-v="pipa" onclick="mesEstoqueVisao(\'pipa\')">PI e PA prontos (etiquetas)</button>');
  }
  (function () {
    var ant = window.v4047RenderStockTable;
    window.v4047RenderStockTable = function () {
      garantirAbaPI();
      if (window.__mbcStockView === 'pipa') {
        document.querySelectorAll('#mbc_stock_tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === 'pipa'); });
        try { return renderEstoquePI(); } catch (e) { console.warn('MES LION 1.4: estoque PI/PA', e); }
        return;
      }
      if (typeof ant === 'function') return ant.apply(this, arguments);
    };
  })();

  /* ---------------------------------------------------------------------
     12) MENU, ROTAS E INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  function ajustarMenu() {
    try {
      var mods = (typeof modules !== 'undefined') ? modules : null, grupos = (typeof moduleGroups !== 'undefined') ? moduleGroups : null;
      if (mods) [['perdas_motivos', 'Motivos de Perda'], ['estoque_pi_pa', 'Estoque PI / PA']].forEach(function (x) { if (!mods.some(function (m) { return m[0] === x[0]; })) mods.push(x); });
      if (grupos) {
        var prod = grupos.find(function (g) { return g.title === 'Produção'; });
        if (prod && prod.items.indexOf('perdas_motivos') < 0) { var i = prod.items.indexOf('perdas'); prod.items.splice(i >= 0 ? i + 1 : prod.items.length, 0, 'perdas_motivos'); }
        var mat = grupos.find(function (g) { return g.title === 'Materiais'; });
        if (mat && mat.items.indexOf('estoque_pi_pa') < 0) { var j = mat.items.indexOf('estoque'); mat.items.splice(j >= 0 ? j + 1 : mat.items.length, 0, 'estoque_pi_pa'); }
      }
    } catch (e) { console.warn('MES LION 1.4: menu', e); }
  }
  ajustarMenu();
  function refazerMenu() {
    try { var app = el('app'); if (app && !app.classList.contains('hidden') && typeof renderNav === 'function') { var at = current; renderNav(); marcarNav(at); } } catch (e) { }
  }
  function limparEntradasOrfas() {
    var d = D(), rots = {}; A(d.roteiro).forEach(function (r) { if (r) rots[txt(r.CodRoteiro)] = 1; });
    var antes = A(d.roteiro_pi_entradas).length;
    d.roteiro_pi_entradas = A(d.roteiro_pi_entradas).filter(function (x) { return x && rots[txt(x.CodRoteiro)] && etapaDoRoteiro(x.CodRoteiro, x.OrdemEtapa); });
    return antes - d.roteiro_pi_entradas.length;
  }
  function inicializarDados() {
    if (!D()) return;
    garantirColecoes();
    var mud = 0;
    mud += normalizarQtdProduzida();
    A(D().op).forEach(function (o) {
      if (!o || !temposDaOP(o.CodOP).some(function (t) { return chaveTempo(t); })) return;
      var antes = JSON.stringify(etapasDaOP(o.CodOP).map(function (e) { return [e.TempoReal, e.TempoRealOrigem]; }));
      recalcularTempoReal(o.CodOP);
      if (JSON.stringify(etapasDaOP(o.CodOP).map(function (e) { return [e.TempoReal, e.TempoRealOrigem]; })) !== antes) mud++;
    });
    mud += limparEntradasOrfas();
    mud += sincronizarTudo();
    if (migrarBaixaLegado()) mud++;
    mudou();
    if (mud) salvar();
  }
  (function () {
    var ant = window.render;
    if (typeof ant !== 'function') return;
    window.render = function (k) {
      garantirColecoes();
      if (k === 'perdas_motivos') return motivosModulo();
      if (k === 'estoque_pi_pa') { window.__mbcStockView = 'pipa'; var r0 = ant.call(this, 'estoque'); setCurrent('estoque_pi_pa'); marcarNav('estoque_pi_pa'); return r0; }
      if (k === 'estoque' && window.__mbcStockView === 'pipa') window.__mbcStockView = 'material';
      return ant.apply(this, arguments);
    };
  })();
  (function () {
    var ant = window.boot;
    if (typeof ant !== 'function') return;
    window.boot = function () {
      try { inicializarDados(); } catch (e) { console.warn('MES LION 1.4: inicialização dos dados', e); }
      ajustarMenu();
      var r = ant.apply(this, arguments);
      refazerMenu();
      return r;
    };
  })();
  (function () {
    var ant = window.saveLocal;
    if (typeof ant !== 'function') return;
    window.saveLocal = function () { try { garantirColecoes(); } catch (e) { } mudou(); return ant.apply(this, arguments); };
  })();
  garantirColecoes();
  refazerMenu();
  /* acesso para testes e outros adaptadores */
  window.mesApontamentoPI14 = {
    versao: VERSAO, livro: livro, sincronizarTudo: sincronizarTudo, sincronizarFamilia: sincronizarFamilia, raizFamilia: raizFamilia, idLote: idLote,
    consumidoPelaOP: consumidoPelaOP, linhasPIDaOP: linhasPIDaOP, maquinasDaOP: maquinasDaOP, duracaoMin: duracaoMin, recalcularTempoReal: recalcularTempoReal,
    entradasPI: entradasPI, validarEntradaPI: validarEntradaPI, sugestoesFluxo: sugestoesFluxo, diagnosticoFluxo: diagnosticoFluxo, partesEtiquetas: partesEtiquetas,
    criarEtiquetas: criarEtiquetas, baixaAutomaticaPI: baixaAutomaticaPI, normalizarQtdProduzida: normalizarQtdProduzida, chaveMotivo: chaveMotivo, categorias: categorias,
    perdaPIExterna: perdaPIExterna, fontesPI: fontesPI,
    /* 1.6.1 */ materiaisSemConsumo: materiaisSemConsumo, opSemProjecao: opSemProjecao, custoProprioDaOP: custoProprioDaOP, consumoApontado: consumoApontado, ehPerdaDePI: ehPerdaDePI
  };
  window.MES_ADAPTADOR_APONTAMENTO_PI = VERSAO;
})();
