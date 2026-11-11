/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR 1.6.0: CÓDIGOS DE BARRAS, ESTOQUE, INVENTÁRIO, RECURSOS E PIs POR PROCESSO
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, DEPOIS de adaptador_frontend.js e
   adaptador_passaporte.js. Não altera os arquivos do frontend (index.html, js\, style.css): cada tela é estendida
   por cima da versão já validada, chamando sempre a função original antes.
     1) Código de barras (Code 128, gerado no próprio MES, sem internet) e leitura por leitor USB/Bluetooth
        (modo teclado: o leitor "digita" o código e tecla Enter);
     2) Materiais: campo "Código de barras do fornecedor"; material novo pode usar o código de barras como código;
     3) Entrada de materiais: leitura do código de barras (seleciona o material ou cadastra um novo com esse código),
        campo Localização física e etiquetas com código de barras;
     4) Estoque / rastreabilidade: localização, saldo reservado em OPs abertas, em produção e consumido;
     5) Locais de estoque: consulta por localização (e mudança de local);
     6) Inventário de estoque: template .xlsx, validação, aplicação, reversão, reaplicação e exclusão;
     7) Apontamento: buscar OP por leitura do código; ler o código do material no lançamento de lotes;
     8) OP impressa com o código de barras da OP e dos materiais;
     9) Passaporte: consulta por leitura do código/QR da etiqueta; etiqueta com código de barras do passaporte;
    10) Recursos / Máquinas: uma única tela para "Recursos / Custos" e "Cadastro de Recursos" (sem redundância);
    11) Estrutura do produto: gerar PIs filhos escolhendo, por flag, os processos cadastrados.
    1.3.0) O saldo de cada entrada também desconta as saídas manuais e as baixas técnicas do Ajuste de Estoque
           (data.estoque_ajustes, tela em adaptador_estoque_ajustes.js); o Inventário passa a considerá-las; a visão
           por material mostra o estoque mínimo do cadastro de materiais (só alerta).
    1.6.0) Recursos / Máquinas ganha o botão "⬆ Importar planilha de equipamentos" (tela em
           adaptador_recursos_importacao.js), que usa as regras desta tela por window.mesRecursosAPI; o gerador de
           planilhas (window.mesXlsx) passa a ter cabeçalho de várias linhas congelado, células mescladas, listas
           suspensas, nomes definidos e mais estilos (cabeçalhos coloridos e linha com erro).
    1.6.1) Unidade de medida no estoque: consumo, perda e apontamento antigo descontam do lote na UM do lote (conversão
           direta de massa, volume e comprimento; entre a UM do material e kg, pelo "Fator conversão para kg"); a visão
           por material e as reservas somam na UM do material (lote sem regra de conversão fica fora da soma e aparece
           marcado). Saldo negativo vira NEGATIVO (antes aparecia como ESGOTADO). Consumo maior que o saldo do lote só é
           registrado depois de confirmar o aviso, e fica marcado (AcimaDoSaldo = Sim).
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
    var n = Number(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function jsStr(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '); }
  function el(id) { return document.getElementById(id); }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function chave(v) { return txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' '); }
  function chaveCodigo(v) { return txt(v).replace(/[\u0000-\u001F]/g, '').toUpperCase(); }
  function f3(v) { var n = typeof v === 'number' ? v : N(v); return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
  function f4(v) { var n = typeof v === 'number' ? v : N(v); return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }); }
  function reais(v) { return (typeof money === 'function') ? money(v) : 'R$ ' + f4(v); }
  function hoje() { return new Date().toLocaleDateString('pt-BR'); }
  function agora() { return new Date().toLocaleString('pt-BR'); }
  function usuario() { try { return (window.MES_CURRENT_USER && (MES_CURRENT_USER.username || MES_CURRENT_USER.fullName)) || 'admin'; } catch (e) { return 'admin'; } }
  function salvar() { try { if (typeof saveLocal === 'function') saveLocal(); } catch (e) { console.warn('MES LION: gravação', e); } }
  function arred(v, c) { var f = Math.pow(10, c == null ? 6 : c); return Math.round((Number(v) || 0) * f) / f; }
  function setCurrent(k) { try { current = k; } catch (e) { } }
  function marcarNav(k) {
    try {
      document.body.classList.remove('dashboard-mode');
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      var b = el('nav_' + k); if (b) b.classList.add('active');
    } catch (e) { }
  }
  function cabecalho(t, s) { if (el('title')) el('title').textContent = t; if (el('subtitle')) el('subtitle').textContent = s || ''; }
  /* aviso discreto na tela (sem alert, para não travar o leitor de código de barras) */
  function aviso(id, msg, tipo) {
    var b = el(id); if (!b) return;
    b.className = 'mbc-msg ' + (tipo || 'ok');
    b.innerHTML = msg;
  }
  function bip(ok) {
    try {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      var ctx = bip.ctx || (bip.ctx = new C()), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = ok ? 1250 : 330; g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + (ok ? 0.09 : 0.3));
    } catch (e) { }
  }
  function baixar(nome, bytes, tipo) {
    var blob = new Blob([bytes], { type: tipo || 'application/octet-stream' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  /* campo de leitura: Enter (ou Tab enviado pelo leitor) dispara a busca */
  function campoLeitura(id, rotulo, dica, fn, extraHtml) {
    return '<div class="mbc-scan"><label><span>▮▯▮ ' + esc(rotulo) + '</span><input id="' + id + '" autocomplete="off" spellcheck="false" placeholder="' + esc(dica) + '" ' +
      'onkeydown="if((event.key===\'Enter\'||event.key===\'Tab\')&&this.value.trim()){event.preventDefault();' + fn + '(this.value);}"></label>' +
      '<button class="secondary" onclick="' + fn + '(document.getElementById(\'' + id + '\').value)">Buscar</button>' + (extraHtml || '') +
      '<div id="' + id + '_msg" class="mbc-msg"></div></div>';
  }

  /* ---------------------------------------------------------------------
     1) CÓDIGO DE BARRAS CODE 128 (SVG, sem bibliotecas externas)
     --------------------------------------------------------------------- */
  var C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112').split(' ');
  /* Codifica texto ASCII 32-126 em símbolos Code 128 (B, com trechos em C para sequências de 4+ dígitos) */
  function code128Simbolos(txt) {
    txt = String(txt == null ? '' : txt);
    var s = [], i = 0, set = null, n = txt.length;
    function ehDig(p) { var c = txt.charCodeAt(p); return c >= 48 && c <= 57; }
    function run(p) { var k = 0; while (p + k < n && ehDig(p + k)) k++; return k; }
    function charB(p) { var c = txt.charCodeAt(p); if (c < 32 || c > 126) c = 63; if (set === null) s.push(104); else if (set !== 'B') s.push(100); set = 'B'; s.push(c - 32); }
    while (i < n) {
      var d = run(i);
      if (set !== 'C') {
        var limite = set === null ? (d === n ? 2 : 4) : (i + d === n ? 4 : 6);
        if (d >= limite) {
          if (d % 2 === 1) { charB(i); i++; d--; }
          s.push(set === null ? 105 : 99); set = 'C';
        }
      }
      if (set === 'C') {
        if (d >= 2) { s.push(Number(txt.substr(i, 2))); i += 2; continue; }
        charB(i); i++; continue;
      }
      charB(i); i++;
    }
    if (set === null) s.push(104);
    var soma = s[0];
    for (var j = 1; j < s.length; j++) soma += s[j] * j;
    s.push(soma % 103);
    s.push(106);
    return s;
  }
  function code128Modulos(txt) {
    var larg = [];
    code128Simbolos(txt).forEach(function (v) { C128[v].split('').forEach(function (w) { larg.push(Number(w)); }); });
    return larg; // alterna barra/espaço começando por barra
  }
  /* SVG do código de barras. op: {modulo (mm), altura (mm), texto (bool), fonte (mm)} */
  function barcodeSvg(txt, op) {
    op = op || {};
    var t = String(txt == null ? '' : txt).trim();
    if (!t) return '';
    var w = code128Modulos(t), quiet = 10, total = quiet * 2 + w.reduce(function (a, b) { return a + b; }, 0);
    var mod = op.modulo || 0.3, alt = op.altura || 12, mostra = op.texto !== false, fonte = op.fonte || 2.6;
    var x = quiet, rects = '';
    for (var i = 0; i < w.length; i++) { if (i % 2 === 0) rects += '<rect x="' + x + '" y="0" width="' + w[i] + '" height="' + alt / mod + '"/>'; x += w[i]; }
    var hTot = alt + (mostra ? fonte + 1 : 0);
    var vbH = hTot / mod;
    var txtEl = mostra ? '<text x="' + (total / 2) + '" y="' + ((alt + fonte * 0.95 + 0.6) / mod) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' + (fonte / mod) + '">' +
      String(t).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }) + '</text>' : '';
    return '<svg class="mbc-barcode" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Código de barras ' + t.replace(/"/g, '') + '" width="' + (total * mod).toFixed(2) + 'mm" height="' + hTot.toFixed(2) + 'mm" viewBox="0 0 ' + total + ' ' + vbH.toFixed(2) + '" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">' + rects + '</g>' + txtEl + '</svg>';
  }
  window.mesBarcodeSvg = barcodeSvg;

  /* ---------------------------------------------------------------------
     ESTILO DAS TELAS NOVAS (classes mbc-*, sem mexer no style.css)
     --------------------------------------------------------------------- */
  function garantirEstilo() {
    if (el('mbc-estilo')) return;
    var st = document.createElement('style'); st.id = 'mbc-estilo';
    st.textContent = [
      '.mbc-scan{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;background:#f2f8ee;border:1px solid #cfe5c1;border-left:4px solid #69ad2c;border-radius:10px;padding:10px 12px;margin:0 0 12px}',
      '.mbc-scan label{display:flex;flex-direction:column;gap:4px;flex:1 1 320px;margin:0}',
      '.mbc-scan label span{font-size:11px;font-weight:700;color:#2f6b12;letter-spacing:.02em}',
      '.mbc-scan input{font-size:15px;padding:9px 10px;border:2px solid #9fcd80;border-radius:8px;background:#fff;font-family:Consolas,monospace}',
      '.mbc-scan button{background:#004b87;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}',
      '.mbc-inline{display:flex;align-items:center;gap:6px;font-weight:400}',
      '.mbc-inline input[type=checkbox],.toolbar .mbc-inline input[type=checkbox],.form .mbc-inline input[type=checkbox]{width:16px!important;min-width:0!important;height:16px!important;margin:0!important;padding:0!important;flex:0 0 auto}',
      '.mbc-scan input:focus{outline:none;border-color:#004b87;box-shadow:0 0 0 3px rgba(0,75,135,.15)}',
      '.mbc-msg{flex-basis:100%;font-size:12.5px;min-height:0}',
      '.mbc-msg:empty{display:none}',
      '.mbc-msg.ok{color:#245d0d}.mbc-msg.erro{color:#a00e1c;font-weight:700}.mbc-msg.alerta{color:#8a5a00}',
      '.mbc-card{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:14px 16px;margin:0 0 14px}',
      '.mbc-card h3{margin:0 0 8px;color:#004b87;font-size:15px}',
      '.mbc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:0 0 12px}',
      '.mbc-kpis div{background:#fff;border:1px solid #dbe5ec;border-radius:10px;padding:10px 12px}',
      '.mbc-kpis small{display:block;color:#5b7385;font-size:11px}.mbc-kpis b{font-size:19px;color:#0b3a5c}',
      '.mbc-tabs{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap}',
      '.mbc-tabs button{background:#eef3f7;color:#0b3a5c;border:1px solid #cfdbe5}',
      '.mbc-tabs button.on{background:#004b87;color:#fff;border-color:#004b87}',
      '.mbc-tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#eef3f7;color:#0b3a5c;white-space:nowrap}',
      '.mbc-tag.ok{background:#e3f3d8;color:#245d0d}.mbc-tag.erro{background:#fde4e6;color:#a00e1c}.mbc-tag.alerta{background:#fff1d1;color:#7a5000}.mbc-tag.info{background:#e3eefa;color:#0b4a8a}',
      '.mbc-num{text-align:right;white-space:nowrap}',
      '.mbc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}',
      '.mbc-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px}',
      '.mbc-grid label>span{font-weight:700;color:#355566;font-size:11px}',
      '.mbc-grid input,.mbc-grid select{padding:7px 8px;border:1px solid #c9d6e0;border-radius:7px}',
      '.mbc-grid input[readonly]{background:#f3f6f9;color:#45606f}',
      '.mbc-fieldset{border:1px solid #dbe5ec;border-radius:10px;padding:10px 12px 12px;margin:0 0 10px}',
      '.mbc-fieldset legend{font-weight:700;color:#004b87;font-size:12.5px;padding:0 6px}',
      '.mbc-proc-list{display:grid;gap:6px;margin:8px 0}',
      '.mbc-proc{display:grid;grid-template-columns:26px minmax(160px,1.1fr) minmax(170px,1fr) 90px minmax(160px,1.3fr);gap:8px;align-items:center;background:#f7fafc;border:1px solid #e1e9ef;border-radius:8px;padding:6px 8px}',
      '.mbc-proc input[type=checkbox]{width:18px!important;height:18px!important;min-width:0!important;margin:0!important;padding:0!important}',
      '.mbc-proc.existe{background:#f1f7ec;border-color:#cfe5c1}',
      '.mbc-proc input[type=text],.mbc-proc select{padding:6px 7px;border:1px solid #c9d6e0;border-radius:6px;width:100%}',
      '.mbc-proc-head{font-size:11px;font-weight:700;color:#5b7385;background:none;border:0;padding:0 8px}',
      '.mbc-loc-group{border:1px solid #dbe5ec;border-radius:10px;margin:0 0 10px;background:#fff}',
      '.mbc-loc-group>summary{cursor:pointer;padding:10px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-weight:700;color:#0b3a5c}',
      '.mbc-loc-group>div{padding:0 12px 12px}',
      '.mbc-conflitos li{margin:4px 0}',
      '.mbc-barcode{background:#fff;max-width:100%;height:auto}',
      '.mbc-op-code{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
      '.mbc-mini-code svg{height:30px;width:auto}',
      '@media (max-width:760px){.mbc-proc{grid-template-columns:26px 1fr}.mbc-proc>*:nth-child(n+3){grid-column:2}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------------
     2) NORMALIZAÇÃO DOS DADOS (coleções novas, código de barras da OP)
     --------------------------------------------------------------------- */
  function normalizar() {
    var d = D(); if (!d) return;
    if (!Array.isArray(d.inventarios)) d.inventarios = [];
    if (!Array.isArray(d.estoque_ajustes)) d.estoque_ajustes = [];
    if (!Array.isArray(d.entradas)) d.entradas = [];
    if (!Array.isArray(d.materiais)) d.materiais = [];
    if (!Array.isArray(d.recursos)) d.recursos = [];
    if (!Array.isArray(d.cad_recursos)) d.cad_recursos = [];
    /* o código de barras da OP é o próprio número da OP, gravado quando a OP é gerada */
    A(d.op).forEach(function (o) { if (o && o.CodOP && !o.CodigoBarras) o.CodigoBarras = String(o.CodOP); });
  }
  window.mesNormalizarCodigosBarras = normalizar;

  /* ---------------------------------------------------------------------
     3) RESOLUÇÃO DE UM CÓDIGO LIDO
     Aceita: código do material, código de barras do fornecedor (campo CodigoBarras, vários separados por ";"),
     número da entrada (ex.: EN0012, impresso na etiqueta do lote) e GS1-128/DataMatrix com (01) GTIN e (10) lote.
     --------------------------------------------------------------------- */
  function codigosBarrasMaterial(m) {
    return String((m && m.CodigoBarras) || '').split(/[;,\n|]+/).map(chaveCodigo).filter(Boolean);
  }
  function parseGS1(raw) {
    var s = String(raw || '').trim(), out = {};
    s = s.replace(/^\][A-Za-z]\d/, ''); // prefixo de simbologia (]C1, ]d2, ]Q3)
    if (/^\(\d{2,4}\)/.test(s)) {
      var re = /\((\d{2,4})\)([^(]*)/g, m;
      while ((m = re.exec(s))) out[m[1]] = m[2].trim();
    } else if (/\x1d/.test(s) || /^01\d{14}/.test(s)) {
      var fixos = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 }, i = 0, guard = 0;
      while (i < s.length && guard++ < 20) {
        if (s[i] === '\x1d') { i++; continue; }
        var ai = s.substr(i, 2);
        if (fixos[ai]) { out[ai] = s.substr(i + 2, fixos[ai]); i += 2 + fixos[ai]; continue; }
        var ai3 = /^(31|32|33|34|35|36)\d/.test(s.substr(i, 4)) ? s.substr(i, 4) : ai;
        var ini = i + ai3.length, fim = s.indexOf('\x1d', ini); if (fim < 0) fim = s.length;
        out[ai3] = s.substring(ini, fim); i = fim;
      }
    }
    if (out['01']) out.gtin = out['01'];
    if (out['10']) out.lote = out['10'];
    if (out['17']) out.validade = out['17'];
    return out;
  }
  function materialPorCodigo(cod) {
    var k = chaveCodigo(cod); if (!k) return null;
    var ms = A((D() || {}).materiais);
    return ms.find(function (m) { return chaveCodigo(m['CódigoMaterial']) === k; }) ||
      ms.find(function (m) { return codigosBarrasMaterial(m).indexOf(k) >= 0; }) ||
      (/^\d{8,14}$/.test(k) ? ms.find(function (m) {
        // GTIN-13 lido como GTIN-14 (zero à esquerda) e vice-versa
        var alvo = k.replace(/^0+/, '');
        return codigosBarrasMaterial(m).concat([chaveCodigo(m['CódigoMaterial'])]).some(function (c) { return c.replace(/^0+/, '') === alvo && /^\d+$/.test(c); });
      }) : null) || null;
  }
  function resolverCodigo(raw) {
    var r = { bruto: String(raw || ''), codigo: chaveCodigo(raw), material: null, entrada: null, lote: '' };
    if (!r.codigo) return r;
    var d = D() || {};
    var en = A(d.entradas).find(function (e) { return chaveCodigo(e.Entrada) === r.codigo; });
    if (en) { r.entrada = en; r.material = materialPorCodigo(en['CódigoMaterial']) || { 'CódigoMaterial': en['CódigoMaterial'], DescricaoMateriais: en.DescricaoMaterial }; return r; }
    r.material = materialPorCodigo(r.codigo);
    if (!r.material) {
      var g = parseGS1(raw);
      if (g.gtin) { r.material = materialPorCodigo(g.gtin); r.gtin = g.gtin; }
      if (g.lote) r.lote = g.lote;
      if (g.validade) r.validade = g.validade;
    }
    if (r.material && r.lote) {
      r.entrada = A(d.entradas).find(function (e) { return e['CódigoMaterial'] === r.material['CódigoMaterial'] && chave(e.Lote) === chave(r.lote); }) || null;
    }
    return r;
  }
  window.mesResolverCodigo = resolverCodigo;
  function codigoBarrasDoMaterial(cod) {
    var m = materialPorCodigo(cod);
    var cb = m ? codigosBarrasMaterial(m)[0] : '';
    return cb || txt(cod);
  }
  window.mesCodigoBarrasDoMaterial = codigoBarrasDoMaterial;

  /* campos novos nas tabelas (lista de colunas do MES) */
  function camposTabelas() {
    try {
      if (typeof fields !== 'object' || !fields) return;
      if (Array.isArray(fields.materiais) && fields.materiais.indexOf('CodigoBarras') < 0) fields.materiais.splice(1, 0, 'CodigoBarras');
      if (Array.isArray(fields.entradas)) {
        if (fields.entradas.indexOf('Localizacao') < 0) fields.entradas.splice(Math.max(0, fields.entradas.indexOf('Lote') + 1), 0, 'Localizacao');
        if (fields.entradas.indexOf('CodigoBarrasLido') < 0) fields.entradas.push('CodigoBarrasLido');
      }
    } catch (e) { }
  }
  camposTabelas();
  /* códigos numéricos (código de barras, código do material) aparecem como foram lidos, sem separador de milhar */
  (function () {
    try {
      if (typeof MES_FIELD_LABELS === 'object' && MES_FIELD_LABELS) {
        if (!MES_FIELD_LABELS.CodigoBarras) MES_FIELD_LABELS.CodigoBarras = 'Código de barras';
        if (!MES_FIELD_LABELS.Localizacao) MES_FIELD_LABELS.Localizacao = 'Localização';
        if (!MES_FIELD_LABELS.CodigoBarrasLido) MES_FIELD_LABELS.CodigoBarrasLido = 'Código de barras lido';
      }
    } catch (e) { }
    var dvAnt = window.displayValue;
    if (typeof dvAnt !== 'function') return;
    window.displayValue = function (field, value) {
      if ((typeof value === 'string' || typeof value === 'number') && /^c[oó]d|barras|gtin|^ean|^entrada$/i.test(String(field || ''))) return String(value);
      return dvAnt.apply(this, arguments);
    };
  })();

  /* ---------------------------------------------------------------------
     4) MATERIAIS — CAMPO "CÓDIGO DE BARRAS DO FORNECEDOR"
     --------------------------------------------------------------------- */
  (function () {
    var editarAnt = window.editarMaterialCadastroV4047;
    if (typeof editarAnt === 'function') {
      window.editarMaterialCadastroV4047 = function (idx) {
        var r = editarAnt.apply(this, arguments);
        try {
          var i = (typeof idx === 'number') ? idx : -1;
          var cod = el('v47_mat_cod'); if (!cod || el('mbc_mat_cb')) return r;
          var old = i >= 0 ? (A(D().materiais)[i] || {}) : {};
          cod.dataset.mbcOriginal = cod.value;
          var lab = document.createElement('label');
          lab.className = 'wide';
          lab.innerHTML = '<span>Código de barras do fornecedor (leia com o leitor; mais de um: separe com ";")</span>' +
            '<input id="mbc_mat_cb" autocomplete="off" value="' + esc(old.CodigoBarras || '') + '" placeholder="Bipe a etiqueta do fornecedor" oninput="mesMatCodigoBarrasDigitado()" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();}">' +
            (i < 0 ? '<span class="mbc-inline" style="margin-top:4px"><input type="checkbox" id="mbc_mat_usar" checked onchange="mesMatCodigoBarrasDigitado()"> Usar o código de barras como código do material</span>' : '');
          var host = cod.closest('label');
          if (host && host.parentNode) host.parentNode.insertBefore(lab, host.nextSibling);
        } catch (e) { console.warn('MES LION: código de barras no material', e); }
        return r;
      };
    }
    window.mesMatCodigoBarrasDigitado = function () {
      var cod = el('v47_mat_cod'), cb = el('mbc_mat_cb'), usar = el('mbc_mat_usar');
      if (!cod || !cb || !usar) return;
      var primeiro = String(cb.value || '').split(/[;,\n|]+/).map(chaveCodigo).filter(Boolean)[0] || '';
      cod.value = (usar.checked && primeiro) ? primeiro : (cod.dataset.mbcOriginal || cod.value);
    };
    var salvarAnt = window.salvarMaterialCadastroV4047;
    if (typeof salvarAnt === 'function') {
      window.salvarMaterialCadastroV4047 = async function (idx) {
        var cbEl = el('mbc_mat_cb'), codEl = el('v47_mat_cod');
        if (!cbEl || !codEl) return salvarAnt.apply(this, arguments);
        var lista = String(cbEl.value || '').split(/[;,\n|]+/).map(chaveCodigo).filter(Boolean);
        var cod = txt(codEl.value), ms = A(D().materiais), i = (typeof idx === 'number') ? idx : -1;
        var proprio = i >= 0 ? ms[i] : null;
        if (i < 0 && ms.some(function (m) { return chaveCodigo(m['CódigoMaterial']) === chaveCodigo(cod); })) {
          return alert('Já existe um material com o código ' + cod + '. Use outro código ou edite o material existente.');
        }
        for (var k = 0; k < lista.length; k++) {
          var dono = ms.find(function (m) { return m !== proprio && (codigosBarrasMaterial(m).indexOf(lista[k]) >= 0 || chaveCodigo(m['CódigoMaterial']) === lista[k]); });
          if (dono && !(i < 0 && chaveCodigo(dono['CódigoMaterial']) === chaveCodigo(cod))) {
            return alert('O código de barras ' + lista[k] + ' já pertence ao material ' + dono['CódigoMaterial'] + ' — ' + (dono.DescricaoMateriais || '') + '.');
          }
        }
        var r = await salvarAnt.apply(this, arguments);
        try {
          var m = A(D().materiais).find(function (x) { return chaveCodigo(x['CódigoMaterial']) === chaveCodigo(cod); });
          if (m && (m.CodigoBarras || '') !== lista.join(';')) {
            m.CodigoBarras = lista.join(';');
            salvar();
            try { if (current === 'materiais' && typeof render === 'function') render('materiais'); } catch (e) { }
          }
        } catch (e) { console.warn('MES LION: código de barras do material', e); }
        return r;
      };
    }
  })();

  /* ---------------------------------------------------------------------
     5) ENTRADA DE MATERIAIS — LEITURA DO CÓDIGO, CADASTRO RÁPIDO, LOCALIZAÇÃO E ETIQUETAS
     --------------------------------------------------------------------- */
  function locaisConhecidos() {
    var s = {};
    A((D() || {}).entradas).forEach(function (e) { var l = txt(e.Localizacao); if (l) s[l] = 1; });
    return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
  }
  function datalistLocais() {
    return '<datalist id="mbc_locais">' + locaisConhecidos().map(function (l) { return '<option value="' + esc(l) + '">'; }).join('') + '</datalist>';
  }
  function categoriasOpcoes(sel) {
    var cs = A((D() || {}).categorias).map(function (c) { return txt(c.Categoria); }).filter(Boolean);
    cs = cs.filter(function (c, i) { return cs.indexOf(c) === i; }).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    return '<option value="">Sem categoria</option>' + cs.map(function (c) { return '<option ' + (c === sel ? 'selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }
  function preencherSelectMateriais(id, valor) {
    var s = el(id); if (!s) return;
    if (typeof fillSelect === 'function') fillSelect(id, D().materiais, 'CódigoMaterial', 'DescricaoMateriais');
    if (valor != null) s.value = valor;
  }
  (function () {
    var moduloAnt = window.entradasModule;
    if (typeof moduloAnt !== 'function') return;
    window.entradasModule = function () {
      var r = moduloAnt.apply(this, arguments);
      try {
        garantirEstilo();
        var c = el('content'); if (!c) return r;
        var form = c.querySelector('.form');
        if (form && !el('mbc_scan_ent')) {
          var div = document.createElement('div');
          div.innerHTML = campoLeitura('mbc_scan_ent', 'Ler código de barras do material (etiqueta do fornecedor)', 'Bipe o código de barras e tecle Enter', 'mesEntradaLerCodigo') + '<div id="mbc_novo_mat"></div>';
          form.insertBefore(div, form.querySelector('.form-grid'));
        }
        var lote = el('em_lote');
        if (lote && !el('mbc_em_loc')) {
          var lab = document.createElement('label');
          lab.innerHTML = '<span>Localização física (endereço no estoque)</span><input id="mbc_em_loc" list="mbc_locais" placeholder="Ex.: Almox A · Rua 2 · Prateleira 3">' + datalistLocais();
          var host = lote.closest('label');
          if (host && host.parentNode) host.parentNode.insertBefore(lab, host.nextSibling);
        }
        var tb = c.querySelector('.toolbar');
        if (tb && !tb.querySelector('.mbc-btn-locais')) {
          tb.insertAdjacentHTML('beforeend', '<button class="secondary mbc-btn-locais" onclick="render(\'locais_estoque\')">Locais de estoque</button><button class="secondary" onclick="render(\'inventario_estoque\')">Inventário</button>');
        }
        setTimeout(function () { var i = el('mbc_scan_ent'); if (i && document.activeElement && document.activeElement.tagName !== 'INPUT') i.focus(); }, 60);
      } catch (e) { console.warn('MES LION: leitura na entrada', e); }
      return r;
    };
  })();
  window.mesEntradaLerCodigo = function (valor) {
    var raw = String(valor || ''), r = resolverCodigo(raw), inp = el('mbc_scan_ent'), box = el('mbc_novo_mat');
    if (!r.codigo) return;
    if (box) box.innerHTML = '';
    if (r.material && A(D().materiais).indexOf(r.material) >= 0) {
      preencherSelectMateriais('em_mat', r.material['CódigoMaterial']);
      if (typeof entradaLookup === 'function') { try { entradaLookup(); } catch (e) { } }
      if (r.lote && el('em_lote') && !el('em_lote').value) el('em_lote').value = r.lote;
      window.__mbcCodigoLido = { bruto: raw.trim(), material: r.material['CódigoMaterial'] };
      aviso('mbc_scan_ent_msg', '✔ <b>' + esc(r.material['CódigoMaterial']) + '</b> — ' + esc(r.material.DescricaoMateriais || '') + ' selecionado' +
        (r.lote ? ' · lote ' + esc(r.lote) + ' (GS1)' : '') + '. Informe quantidade, custo, lote e localização e clique em "Registrar entrada".', 'ok');
      bip(true);
      if (inp) inp.value = '';
      var q = el('em_qtd'); if (q) q.focus();
      return;
    }
    bip(false);
    var codigo = r.gtin || r.codigo;
    aviso('mbc_scan_ent_msg', 'Código <b>' + esc(codigo) + '</b> não está cadastrado. Cadastre o material com este código ou associe o código a um material já cadastrado.', 'alerta');
    if (!box) return;
    var mats = A(D().materiais).slice().sort(function (a, b) { return String(a['CódigoMaterial']).localeCompare(String(b['CódigoMaterial']), 'pt-BR', { numeric: true }); });
    box.innerHTML = '<div class="mbc-card"><h3>Novo material pelo código de barras</h3>' +
      '<div class="mbc-grid"><label><span>Código do material (= código de barras)</span><input id="mbc_nm_cod" value="' + esc(codigo) + '"></label>' +
      '<label style="grid-column:span 2"><span>Descrição</span><input id="mbc_nm_desc" placeholder="Descrição do material"></label>' +
      '<label><span>UM</span><input id="mbc_nm_um" list="mbc_ums" value="kg"><datalist id="mbc_ums"><option>kg</option><option>g</option><option>L</option><option>mL</option><option>m</option><option>un</option><option>rolo</option></datalist></label>' +
      '<label><span>Fator conversão para kg</span><input id="mbc_nm_fator" type="number" step="any" placeholder="1 para kg"></label>' +
      '<label><span>Categoria</span><select id="mbc_nm_cat">' + categoriasOpcoes('') + '</select></label></div>' +
      '<div class="form-actions"><button onclick="mesEntradaCadastrarMaterial(\'' + jsStr(raw.trim()) + '\')">Cadastrar material e usar nesta entrada</button>' +
      '<button class="secondary" onclick="document.getElementById(\'mbc_novo_mat\').innerHTML=\'\'">Cancelar</button></div>' +
      '<hr style="border:0;border-top:1px solid #e1e9ef;margin:12px 0"><div class="mbc-grid"><label style="grid-column:span 2"><span>Ou associar este código a um material já cadastrado</span><select id="mbc_nm_assoc"><option value="">Selecione o material...</option>' +
      mats.map(function (m) { return '<option value="' + esc(m['CódigoMaterial']) + '">' + esc(m['CódigoMaterial'] + ' — ' + (m.DescricaoMateriais || '')) + '</option>'; }).join('') +
      '</select></label></div><div class="form-actions"><button class="secondary" onclick="mesEntradaAssociarCodigo(\'' + jsStr(codigo) + '\',\'' + jsStr(raw.trim()) + '\')">Associar código ao material</button></div></div>';
    var d = el('mbc_nm_desc'); if (d) d.focus();
  };
  window.mesEntradaCadastrarMaterial = function (bruto) {
    var cod = chaveCodigo(el('mbc_nm_cod') && el('mbc_nm_cod').value), desc = txt(el('mbc_nm_desc') && el('mbc_nm_desc').value), um = txt(el('mbc_nm_um') && el('mbc_nm_um').value);
    if (!cod) return alert('Informe o código do material.');
    if (!desc) return alert('Informe a descrição do material.');
    if (!um) return alert('Informe a unidade de medida.');
    if (materialPorCodigo(cod)) return alert('O código ' + cod + ' já está em uso por outro material.');
    var m = { 'CódigoMaterial': cod, CodigoBarras: cod, DescricaoMateriais: desc, UM: um, 'Fator conversão para kg': txt(el('mbc_nm_fator') && el('mbc_nm_fator').value),
      Categoria: (el('mbc_nm_cat') && el('mbc_nm_cat').value) || '', CodigoBPM: '', CodigoFornecedor: '', MaterialQualificado: 'Não', ArquivosEspecificacao: [],
      Observacoes: 'Cadastrado pela leitura do código de barras na Entrada de Materiais em ' + agora() + ' por ' + usuario() + '.', OrigemCadastro: 'LEITURA_CODIGO_BARRAS' };
    D().materiais.unshift(m);
    salvar();
    if (el('mbc_novo_mat')) el('mbc_novo_mat').innerHTML = '';
    window.mesEntradaLerCodigo(bruto || cod);
  };
  window.mesEntradaAssociarCodigo = function (codigo, bruto) {
    var alvo = el('mbc_nm_assoc') && el('mbc_nm_assoc').value;
    if (!alvo) return alert('Selecione o material.');
    var m = A(D().materiais).find(function (x) { return x['CódigoMaterial'] === alvo; });
    if (!m) return;
    var lista = codigosBarrasMaterial(m);
    if (lista.indexOf(chaveCodigo(codigo)) < 0) lista.push(chaveCodigo(codigo));
    m.CodigoBarras = lista.join(';');
    salvar();
    if (el('mbc_novo_mat')) el('mbc_novo_mat').innerHTML = '';
    window.mesEntradaLerCodigo(bruto || codigo);
  };
  (function () {
    var addAnt = window.addEntrada;
    if (typeof addAnt !== 'function') return;
    window.addEntrada = async function () {
      var loc = txt(el('mbc_em_loc') && el('mbc_em_loc').value);
      var mat = el('em_mat') ? el('em_mat').value : '';
      var lido = window.__mbcCodigoLido && window.__mbcCodigoLido.material === mat ? window.__mbcCodigoLido.bruto : '';
      var antes = {};
      A(D().entradas).forEach(function (e) { antes[e.Entrada] = 1; });
      var r = await addAnt.apply(this, arguments);
      try {
        var nova = A(D().entradas).find(function (e) { return e && !antes[e.Entrada]; });
        if (nova && (loc || lido)) {
          if (loc) { nova.Localizacao = loc; nova.LocalizacaoHistorico = [{ Data: agora(), Local: loc, Usuario: usuario(), Origem: 'Entrada' }]; }
          if (lido) nova.CodigoBarrasLido = lido;
          window.__mbcCodigoLido = null;
          salvar();
          try { if (current === 'entradas') render('entradas'); } catch (e) { }
        }
      } catch (e) { console.warn('MES LION: localização da entrada', e); }
      return r;
    };
  })();
  (function () {
    var editAnt = window.editarEntrada;
    if (typeof editAnt !== 'function') return;
    window.editarEntrada = function (idx) {
      var r = editAnt.apply(this, arguments);
      try {
        var e = A(D().entradas)[idx] || {}, lote = el('ed_lote');
        if (lote && !el('mbc_ed_loc')) {
          var lab = document.createElement('label');
          lab.innerHTML = '<span>Localização física</span><input id="mbc_ed_loc" list="mbc_locais" value="' + esc(e.Localizacao || '') + '">' + datalistLocais();
          var host = lote.closest('label');
          if (host && host.parentNode) host.parentNode.insertBefore(lab, host.nextSibling);
        }
      } catch (err) { }
      return r;
    };
    var salvarEdAnt = window.salvarEntradaEditada;
    if (typeof salvarEdAnt !== 'function') return;
    window.salvarEntradaEditada = async function (idx) {
      var campo = el('mbc_ed_loc'), loc = campo ? txt(campo.value) : null;
      var r = await salvarEdAnt.apply(this, arguments);
      try {
        var e = A(D().entradas)[idx];
        if (e && loc !== null && txt(e.Localizacao) !== loc) {
          e.Localizacao = loc;
          e.LocalizacaoHistorico = A(e.LocalizacaoHistorico).concat([{ Data: agora(), Local: loc, Usuario: usuario(), Origem: 'Edição da entrada' }]);
          salvar();
          try { if (current === 'entradas') render('entradas'); } catch (er) { }
        }
      } catch (er) { console.warn('MES LION: localização da entrada', er); }
      return r;
    };
  })();
  /* etiquetas de lote com código de barras do material e da entrada */
  window.etiquetasEntradasV4047 = function () {
    var rows = (typeof getSelectedRows === 'function') ? getSelectedRows('entradas') : [];
    if (!rows.length) rows = A(D().entradas).slice(0, 1);
    if (!rows.length) return alert('Não há entradas para etiquetar.');
    var cards = rows.map(function (e) {
      var cbMat = codigoBarrasDoMaterial(e['CódigoMaterial']);
      return '<article class="mat-label"><header><b>MES Lion · Material</b><span>' + esc(e.Entrada || '') + '</span></header>' +
        '<h2>' + esc(e['CódigoMaterial'] || '') + '</h2><h3>' + esc(e.DescricaoMaterial || '') + '</h3>' +
        '<div class="grid"><b>Lote</b><span>' + esc(e.Lote || '-') + '</span><b>Localização</b><span>' + esc(e.Localizacao || '-') + '</span><b>Fornecedor</b><span>' + esc(e.NomeFornecedor || '-') + '</span>' +
        '<b>Projeto</b><span>' + esc(e.CodigoProjeto || '-') + ' ' + esc(e.Projeto || '') + '</span><b>NF</b><span>' + esc(e['N° NF'] || '-') + '</span>' +
        '<b>Quantidade</b><span>' + esc(e.QtdAdquirida || '') + ' ' + esc(e.UnidadeMedida || '') + '</span><b>Qualificação</b><span>' + esc(e.MaterialQualificado || 'Não') + '</span></div>' +
        '<div class="codes"><div><small>Material</small>' + barcodeSvg(cbMat, { modulo: 0.26, altura: 9, fonte: 2.4 }) + '</div>' +
        '<div><small>Lote / entrada (seleciona material e lote no apontamento)</small>' + barcodeSvg(e.Entrada || '', { modulo: 0.3, altura: 9, fonte: 2.4 }) + '</div></div></article>';
    }).join('');
    var w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return alert('Permita pop-ups.');
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas de materiais</title><style>@page{size:A4;margin:8mm}body{font-family:Arial;margin:0}' +
      '.wrap{display:grid;grid-template-columns:repeat(2,1fr);gap:7mm}.mat-label{border:1.5px solid #004b87;padding:5mm;min-height:72mm;break-inside:avoid}' +
      '.mat-label header{display:flex;justify-content:space-between;border-bottom:2px solid #69ad2c;padding-bottom:2mm;color:#004b87}.mat-label h2{font-size:20px;margin:4mm 0 1mm}' +
      '.mat-label h3{font-size:14px;margin:0 0 4mm}.grid{display:grid;grid-template-columns:31% 69%;font-size:11px;gap:1.5mm}.grid b{color:#355566}' +
      '.codes{display:grid;gap:2mm;margin-top:3mm}.codes small{display:block;font-size:9px;color:#355566;margin-bottom:.5mm}.codes svg{max-width:100%;height:auto}' +
      '.print{position:fixed;right:10px;top:10px}@media print{.print{display:none}}</style></head><body><button class="print" onclick="window.print()">Imprimir</button><div class="wrap">' + cards + '</div></body></html>');
    w.document.close();
  };

  /* ---------------------------------------------------------------------
     6) ESTOQUE / RASTREABILIDADE — LOCALIZAÇÃO, RESERVADO EM OPs, EM PRODUÇÃO E CONSUMIDO
     Saldo de cada entrada = quantidade da entrada − consumos − perdas do lote.
     Consumos: os apontamentos de consumo por lote (consumos_materiais, com a entrada escolhida) das OPs existentes;
     para OPs sem esses apontamentos vale a regra anterior (OP - Materiais com entrada/lote único). Perdas: regra anterior.
     Reservado: quantidade planejada nas OPs abertas ainda não consumida.
     --------------------------------------------------------------------- */
  function opFechada(op) {
    if (!op) return true;
    var s = String(op.Status || '').toLowerCase();
    return /conclu|encerr|finaliz|cancel/.test(s);
  }
  function opCancelada(op) { return /cancel/i.test(String((op && op.Status) || '')); }
  /* 1.6.1 — UNIDADE DE MEDIDA. O consumo é apontado na UM do material da OP e a entrada pode ter sido lançada em outra
     (ex.: MP0016 cadastrado em L com entrada em kg): o saldo do lote subtraía litros de quilos. Agora consumo, perda e
     apontamento antigo descontam do lote convertidos para a UM DO LOTE; a visão por material, as reservas e o MRP somam
     na UM DO MATERIAL. Massa (kg, g, mg, t), volume (L, mL, m³) e comprimento (m, cm, mm, km) convertem direto; entre a UM
     do material e kg vale o "Fator conversão para kg" do cadastro de materiais (1 L de MP0016 = 1,12 kg). Sem regra de
     conversão: no saldo do lote a quantidade entra como está (como antes) e a visão por material deixa o lote de fora e
     o lista em "Lotes sem conversão de UM"; o relatório Consistência dos dados aponta os dois casos. */
  var GRUPOS_UM = { kg: ['massa', 1], g: ['massa', 0.001], mg: ['massa', 0.000001], t: ['massa', 1000],
    l: ['volume', 1], ml: ['volume', 0.001], m3: ['volume', 1000], m: ['comprimento', 1], cm: ['comprimento', 0.01], mm: ['comprimento', 0.001], km: ['comprimento', 1000], un: ['contagem', 1] };
  var APELIDOS_UM = { quilo: 'kg', quilos: 'kg', quilograma: 'kg', quilogramas: 'kg', kgs: 'kg', grama: 'g', gramas: 'g', gr: 'g', miligrama: 'mg', miligramas: 'mg',
    ton: 't', tonelada: 't', toneladas: 't', litro: 'l', litros: 'l', lt: 'l', lts: 'l', mililitro: 'ml', mililitros: 'ml', 'm³': 'm3', metro: 'm', metros: 'm', mt: 'm',
    centimetro: 'cm', centimetros: 'cm', milimetro: 'mm', milimetros: 'mm', quilometro: 'km', quilometros: 'km',
    unidade: 'un', unidades: 'un', und: 'un', unid: 'un', pc: 'un', 'pç': 'un', pcs: 'un', peca: 'un', pecas: 'un', 'peça': 'un', 'peças': 'un' };
  function normUM(u) { var s = txt(u).toLowerCase().replace(/\.$/, ''); return APELIDOS_UM[s] || APELIDOS_UM[chave(s)] || s; }
  function fatorKgDoMaterial(mat) { return N(mat && (mat['Fator conversão para kg'] || mat.FatorConversaoKg || mat.FatorKg)); }
  /* q na unidade "de" → unidade "para"; ok = false quando não há regra de conversão (q volta como está) */
  function converterUM(q, de, para, codMaterial) {
    var a = normUM(de), b = normUM(para), v = N(q);
    if (!a || !b || a === b) return { q: v, ok: true };
    var ga = GRUPOS_UM[a], gb = GRUPOS_UM[b];
    if (ga && gb && ga[0] === gb[0]) return { q: v * ga[1] / gb[1], ok: true };
    var mat = materialPorCodigo(codMaterial) || {}, umM = normUM(mat.UM), f = fatorKgDoMaterial(mat), gm = GRUPOS_UM[umM];
    if (!(f > 0) || !umM) return { q: v, ok: false };
    var kg = null;
    if (ga && ga[0] === 'massa') kg = v * ga[1];
    else if (a === umM) kg = v * f;
    else if (ga && gm && ga[0] === gm[0]) kg = v * ga[1] / gm[1] * f;
    if (kg === null) return { q: v, ok: false };
    if (gb && gb[0] === 'massa') return { q: kg / gb[1], ok: true };
    if (b === umM) return { q: kg / f, ok: true };
    if (gb && gm && gb[0] === gm[0]) return { q: kg / f * gm[1] / gb[1], ok: true };
    return { q: v, ok: false };
  }
  function umDoMaterial(cod, alternativa) { var m = materialPorCodigo(cod); return txt(m && m.UM) || txt(alternativa); }
  /* custo: quantidade da entrada na UM do material (base do custo unitário do lote e da média ponderada). A V38.22 só
     convertia de/para kg pelo fator: entrada em g de material em kg (ou mL de material em L) dava custo unitário 0. */
  (function () {
    var ant = window.qtdEntradaNaUMMaterialV3822;
    if (typeof ant !== 'function') return;
    window.qtdEntradaNaUMMaterialV3822 = function (e, cod) {
      var r = ant.apply(this, arguments);
      try {
        var m = materialPorCodigo(cod) || {}, q = N(e && e.QtdAdquirida), uE = txt(e && (e.UnidadeMedida || e.UM));
        if (q && txt(m.UM) && uE) { var c = converterUM(q, uE, m.UM, cod); if (c.ok) return c.q; }
      } catch (x) { }
      return r;
    };
  })();
  function contextoEstoque() {
    var d = D() || {}, ops = {}, consOpMat = {}, orfaos = 0;
    A(d.op).forEach(function (o) { if (o && o.CodOP) ops[o.CodOP] = o; });
    A(d.consumos_materiais).forEach(function (c) {
      if (!c) return;
      if (!ops[c.CodOP]) { orfaos++; return; }
      /* na UM do material (as reservas e o MRP comparam com o planejado, convertido para a mesma UM) */
      var q = converterUM(consumoLiquido(c), c.UM || c.UMConsumo, umDoMaterial(c.CodigoMaterial, c.UM), c.CodigoMaterial).q;
      consOpMat[c.CodOP + '|' + c.CodigoMaterial] = (consOpMat[c.CodOP + '|' + c.CodigoMaterial] || 0) + q;
    });
    return { ops: ops, consOpMat: consOpMat, orfaos: orfaos, ajustes: saidasAjustePorEntrada() };
  }
  /* 1.3.0 — Ajuste de Estoque (data.estoque_ajustes): saídas manuais e baixas técnicas sem OP, por entrada/lote.
     Só os ajustes ATIVOS com Sentido SAIDA entram aqui; a entrada manual cria uma entrada nova (já somada pela QtdAdquirida)
     e o ajuste ESTORNADO deixa de contar. */
  function saidasAjustePorEntrada() {
    var por = {};
    A((D() || {}).estoque_ajustes).forEach(function (a) {
      if (!a || a.Status === 'ESTORNADO' || a.Sentido !== 'SAIDA') return;
      var baixa = a.Tipo === 'BAIXA_TECNICA';
      A(a.Lotes).forEach(function (l) {
        if (!l || !l.Entrada) return;
        var x = por[l.Entrada] || (por[l.Entrada] = { saida: 0, baixa: 0 });
        if (baixa) x.baixa += N(l.Quantidade); else x.saida += N(l.Quantidade);
      });
    });
    return por;
  }
  function consumoLiquido(c) {
    if (c.ConsumoLiquido !== undefined && c.ConsumoLiquido !== null && String(c.ConsumoLiquido) !== '') return N(c.ConsumoLiquido);
    return N(c.QtdRetirada) - N(c.QtdDevolvida);
  }
  function usoEntrada(entry, ctx) {
    ctx = ctx || contextoEstoque();
    var d = D() || {}, cod = String(entry['CódigoMaterial'] || ''), lote = String(entry.Lote || '').trim(), eid = String(entry.Entrada || '');
    var used = 0, aberta = 0, fechada = 0, loss = 0, refs = [], umLote = entry.UnidadeMedida || entry.UM || '', semConversao = [];
    /* quantidade apontada na UM do registro → UM do lote */
    function naUMLote(q, um, origem) {
      var c = converterUM(q, um, umLote, cod);
      if (!c.ok) semConversao.push(origem + ': ' + f4(q) + ' ' + txt(um) + ' sem conversão para ' + txt(umLote));
      return c.q;
    }
    A(d.consumos_materiais).forEach(function (c) {
      if (!c || String(c.Entrada || '') !== eid || String(c.CodigoMaterial || '') !== cod) return;
      var op = ctx.ops[c.CodOP]; if (!op) return;
      var q = naUMLote(consumoLiquido(c), c.UM || c.UMConsumo, 'consumo ' + (c.ConsumoID || '') + ' (OP ' + c.CodOP + ')'); used += q;
      if (opFechada(op)) fechada += q; else aberta += q;
      if (q) refs.push(c.CodOP);
    });
    var split = typeof splitLotesV401 === 'function' ? splitLotesV401 : function (v) { return String(v || '').split(/[;,|]/).map(function (x) { return x.trim(); }).filter(Boolean); };
    A(d.op_materiais).forEach(function (m) {
      if (!m || String(m.CodigoMaterial || '') !== cod) return;
      if (ctx.consOpMat[m.CodOP + '|' + cod] !== undefined) return; // OP com apontamento por lote: já contado acima
      var explicit = String(m.EntradaMaterial || '') === eid;
      var lots = split(m.LotesConsumidos || m.LoteConsumido || m.Lote || '');
      var sameLot = lote && lots.length === 1 && String(lots[0]).trim() === lote;
      if (explicit || sameLot) {
        var q = N(m.QtdConsumida || m.ConsumoReal || m.QtdReal || 0);
        if (q) q = naUMLote(q, m.UM, 'apontamento da OP ' + (m.CodOP || ''));
        used += q;
        if (opFechada(ctx.ops[m.CodOP])) fechada += q; else aberta += q;
        if (q) refs.push(m.CodOP || '');
      }
    });
    A(d.perdas).forEach(function (p) {
      if (!p || String(p.CodigoMaterial || p.ItemPerdaCodigo || '') !== cod) return;
      var explicit = String(p.EntradaMaterial || '') === eid, sameLot = lote && String(p.Lote || '').trim() === lote;
      if (explicit || sameLot) { loss += naUMLote(N(p.QuantidadePerdida || 0), p.Unidade || p.UM, 'perda da OP ' + (p.CodOP || '')); if (p.CodOP) refs.push(p.CodOP); }
    });
    var aj = (ctx.ajustes || saidasAjustePorEntrada())[eid] || { saida: 0, baixa: 0 };
    return { used: used, loss: loss, ops: refs.filter(function (x, i, a) { return x && a.indexOf(x) === i; }), aberta: aberta, fechada: fechada,
      ajusteSaida: aj.saida, baixaTecnica: aj.baixa, extras: aj.saida + aj.baixa, semConversao: semConversao };
  }
  window.v4047EntryUsage = function (entry) { return usoEntrada(entry); };
  function linhasEstoque() {
    var ctx = contextoEstoque();
    return A((D() || {}).entradas).map(function (e) {
      var u = usoEntrada(e, ctx), q = N(e.QtdAdquirida), saldo = arred(q - u.used - u.loss - u.extras, 6);
      return { Entrada: e.Entrada || '', CodigoMaterial: e['CódigoMaterial'] || '', Material: e.DescricaoMaterial || '', Lote: e.Lote || '', Localizacao: e.Localizacao || '',
        Fornecedor: e.NomeFornecedor || '', Projeto: e.Projeto || '', CodigoProjeto: e.CodigoProjeto || '', UM: e.UnidadeMedida || '', QtdEntrada: q,
        ConsumoOP: u.used, ConsumoOPEncerrada: u.fechada, ConsumoOPAberta: u.aberta, PerdasLote: u.loss, AjusteSaida: u.ajusteSaida, BaixaTecnica: u.baixaTecnica, Saldo: saldo,
        DataCadastro: e.DataCadatro || e.DataCadastro || '', OrigemEntrada: e.OrigemEntrada || '',
        /* 1.6.1: saldo negativo = saiu mais do que entrou (entrada faltando ou com quantidade/UM errada) */
        StatusSaldo: saldo < 0 ? 'NEGATIVO' : saldo <= 0 ? 'ESGOTADO' : saldo < q * 0.2 ? 'BAIXO' : 'DISPONÍVEL', MaterialQualificado: e.MaterialQualificado || 'Não',
        UMMaterial: umDoMaterial(e['CódigoMaterial'], e.UnidadeMedida), SemConversaoUM: u.semConversao.join('; '),
        NotaFiscal: e['N° NF'] || '', OPsRelacionadas: u.ops.join('; '), CustoUnitario: N(e['ValorUnitario (R$/UM)']) };
    });
  }
  window.v4047StockRows = linhasEstoque;
  window.mesLinhasEstoque = linhasEstoque;
  /* 1.6.1 — lista de lotes do consumo (Apontamento de Produção): além da quantidade da entrada, o SALDO atual do lote
     (o operador via só a quantidade recebida e não sabia que o lote já tinha acabado). */
  (function () {
    var ant = window.lotesOptionsConsumoV3814;
    if (typeof ant !== 'function') return;
    window.lotesOptionsConsumoV3814 = function (cod) {
      var html = ant.apply(this, arguments);
      try {
        var por = {};
        linhasEstoque().forEach(function (r) { if (r.CodigoMaterial === txt(cod)) por[r.Entrada] = r; });
        html = String(html).replace(/<option value="([^"]+)"([^>]*)>([^<]*)<\/option>/g, function (tudo, id, attrs, rotulo) {
          var k = id.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), r = por[k];
          if (!r) return tudo;
          return '<option value="' + id + '"' + attrs + '>' + rotulo + ' | saldo ' + esc(f4(r.Saldo) + ' ' + (r.UM || '')) + (r.Saldo < 0 ? ' (NEGATIVO)' : r.Saldo <= 0 ? ' (esgotado)' : '') + '</option>';
        });
      } catch (e) { }
      return html;
    };
  })();
  /* 1.6.1 — consumo do formulário do Apontamento de Produção (material, lote, retirada − devolução) × saldo do lote,
     na UM do lote. null quando o formulário ainda não está válido (a validação continua sendo a da tela). */
  function conferirSaldoDoConsumo() {
    var eid = txt((el('cm_lote_v3814') || {}).value); if (!eid) return null;
    var op = typeof selectedOP === 'function' ? selectedOP('prod_op') || {} : {};
    if (!op.CodOP || /conclu/i.test(String(op.Status || ''))) return null;
    var m = typeof consumoMaterialSelecionadoV3814 === 'function' ? consumoMaterialSelecionadoV3814() || {} : {};
    var cod = txt(m.CodigoMaterial); if (!cod) return null;
    var ret = N((el('cm_ret_v3814') || {}).value), dev = N((el('cm_dev_v3814') || {}).value);
    if (!(ret > 0) || dev < 0 || dev > ret) return null;
    var ent = A((D() || {}).entradas).find(function (e) { return e && txt(e.Entrada) === eid && txt(e['CódigoMaterial']) === cod; }); if (!ent) return null;
    var umConsumo = txt(m.UM) || umDoMaterial(cod, ''), umLote = txt(ent.UnidadeMedida || ent.UM), conv = converterUM(ret - dev, umConsumo, umLote, cod);
    var linha = linhasEstoque().find(function (r) { return r.Entrada === txt(ent.Entrada) && r.CodigoMaterial === cod; });
    var saldo = linha ? N(linha.Saldo) : N(ent.QtdAdquirida), depois = arred(saldo - conv.q, 6);
    return { acima: conv.q > saldo + 1e-9, entrada: txt(ent.Entrada), material: cod, saldo: saldo, umLote: umLote, q: conv.q, depois: depois,
      mensagem: 'Consumo acima do saldo do lote ' + txt(ent.Entrada) + (txt(ent.Lote) ? ' (lote ' + txt(ent.Lote) + ')' : '') + ' de ' + cod + ':\n\n' +
        '- consumo: ' + f4(ret - dev) + ' ' + umConsumo + (normUM(umConsumo) !== normUM(umLote) ? (conv.ok ? ' = ' + f4(conv.q) + ' ' + umLote : ' (sem conversão cadastrada para ' + umLote + ')') : '') + '\n' +
        '- saldo do lote: ' + f4(saldo) + ' ' + umLote + '\n- saldo depois do consumo: ' + f4(depois) + ' ' + umLote + ' (negativo)\n\n' +
        'Em geral isso indica entrada não lançada ou lançada com quantidade ou unidade errada. O consumo fica marcado como "acima do saldo" e o lote aparece como NEGATIVO no Estoque e no relatório Consistência dos dados.\n\nRegistrar mesmo assim?' };
  }
  function reservasOPs() {
    var d = D() || {}, ctx = contextoEstoque(), plan = {}, mats = {};
    A(d.materiais).forEach(function (m) { mats[m['CódigoMaterial']] = m; });
    A(d.op_materiais).forEach(function (m) {
      if (!m || !mats[m.CodigoMaterial]) return;
      if (String(m.TipoConsumo || '').toLowerCase().indexOf('pi intermedi') >= 0) return;
      var op = ctx.ops[m.CodOP]; if (!op || opFechada(op)) return;
      var k = m.CodOP + '|' + m.CodigoMaterial, umMat = txt((mats[m.CodigoMaterial] || {}).UM) || m.UM || '';
      if (!plan[k]) plan[k] = { CodOP: m.CodOP, CodigoMaterial: m.CodigoMaterial, Material: m.DescricaoMaterial || (mats[m.CodigoMaterial] || {}).DescricaoMateriais || '', UM: umMat, Planejado: 0, LegadoConsumido: 0, Status: op.Status || '' };
      /* 1.6.1: na UM do material (a mesma do saldo físico e do consumo) */
      plan[k].Planejado += converterUM(N(m.QtdPlanejada || m.QtdBase || m.Qtd), m.UM, umMat, m.CodigoMaterial).q;
      plan[k].LegadoConsumido += converterUM(N(m.QtdConsumida || 0), m.UM, umMat, m.CodigoMaterial).q;
    });
    return Object.keys(plan).map(function (k) {
      var p = plan[k], cons = ctx.consOpMat[k] !== undefined ? ctx.consOpMat[k] : p.LegadoConsumido;
      return { CodOP: p.CodOP, StatusOP: p.Status, CodigoMaterial: p.CodigoMaterial, Material: p.Material, UM: p.UM, Planejado: arred(p.Planejado), Consumido: arred(cons), Reservado: arred(Math.max(0, p.Planejado - cons)) };
    });
  }
  window.mesReservasOPs = reservasOPs;
  /* 1.6.1 — quanto a OP já consumiu do material, na UM do material (consumo por lote; sem ele, o apontamento antigo) */
  function consumidoNaOP(codOP, cod, ctx) {
    ctx = ctx || contextoEstoque();
    var k = codOP + '|' + cod;
    if (ctx.consOpMat[k] !== undefined) return ctx.consOpMat[k];
    var umMat = umDoMaterial(cod, '');
    return A((D() || {}).op_materiais).reduce(function (s, m) {
      if (!m || String(m.CodOP) !== String(codOP) || String(m.CodigoMaterial) !== String(cod) || /pi intermedi/i.test(String(m.TipoConsumo || ''))) return s;
      return s + converterUM(N(m.QtdConsumida || 0), m.UM, umMat || m.UM, cod).q;
    }, 0);
  }
  function resumoMateriais(linhas, reservas) {
    var d = D() || {}, por = {};
    function item(cod, desc, um) {
      if (!por[cod]) {
        var m = materialPorCodigo(cod) || {};
        por[cod] = { CodigoMaterial: cod, Material: m.DescricaoMateriais || desc || '', UM: m.UM || um || '', Lotes: 0, LotesComSaldo: 0, Entradas: 0, ConsumidoEncerradas: 0, EmProducao: 0, Perdas: 0, AjustesSaida: 0, BaixasTecnicas: 0, SaldoFisico: 0, Reservado: 0, OPsReserva: [],
          EstoqueMinimo: txt(m.EstoqueMinimo) === '' ? '' : N(m.EstoqueMinimo), LotesSemConversao: [] };
      }
      return por[cod];
    }
    linhas.forEach(function (r) {
      var it = item(r.CodigoMaterial, r.Material, r.UM);
      it.Lotes++; if (r.Saldo > 0) it.LotesComSaldo++;
      /* 1.6.1: o lote está na UM da entrada; a visão por material soma na UM do material */
      var f = converterUM(1, r.UM, it.UM, r.CodigoMaterial);
      if (!f.ok) { it.LotesSemConversao.push(r.Entrada + ' (' + f4(r.Saldo) + ' ' + (r.UM || '') + ')'); return; }
      var k = f.q;
      it.Entradas += r.QtdEntrada * k; it.ConsumidoEncerradas += r.ConsumoOPEncerrada * k; it.EmProducao += r.ConsumoOPAberta * k; it.Perdas += r.PerdasLote * k; it.AjustesSaida += (r.AjusteSaida || 0) * k; it.BaixasTecnicas += (r.BaixaTecnica || 0) * k; it.SaldoFisico += r.Saldo * k;
    });
    /* material com estoque mínimo e sem nenhuma entrada também aparece (saldo zero abaixo do mínimo) */
    A(d.materiais).forEach(function (m) { if (m && m['CódigoMaterial'] && N(m.EstoqueMinimo) > 0) item(m['CódigoMaterial'], m.DescricaoMateriais, m.UM); });
    reservas.forEach(function (r) {
      if (r.Reservado <= 0) return;
      var it = item(r.CodigoMaterial, r.Material, r.UM);
      it.Reservado += r.Reservado; it.OPsReserva.push(r.CodOP + ' (' + f4(r.Reservado) + ' ' + (r.UM || '') + ')');
    });
    return Object.keys(por).map(function (k) {
      var it = por[k];
      it.SaldoFisico = arred(it.SaldoFisico); it.Reservado = arred(it.Reservado);
      it.Disponivel = arred(it.SaldoFisico - it.Reservado);
      it.Entradas = arred(it.Entradas); it.ConsumidoEncerradas = arred(it.ConsumidoEncerradas); it.EmProducao = arred(it.EmProducao); it.Perdas = arred(it.Perdas);
      it.AjustesSaida = arred(it.AjustesSaida); it.BaixasTecnicas = arred(it.BaixasTecnicas);
      it.LotesSemConversaoUM = it.LotesSemConversao.join('; ');
      it.Status = it.Disponivel < 0 ? 'FALTA PARA AS OPs' : (it.SaldoFisico <= 0 ? 'SEM SALDO' : (it.Reservado > 0 ? 'COM RESERVA' : 'LIVRE'));
      it.SituacaoMinimo = situacaoMinimo(it.EstoqueMinimo, it.SaldoFisico, it.Disponivel);
      it.OPsComReserva = it.OPsReserva.join('; ');
      return it;
    }).sort(function (a, b) { return String(a.CodigoMaterial).localeCompare(String(b.CodigoMaterial), 'pt-BR', { numeric: true }); });
  }
  /* 1.3.0 — estoque mínimo (só alerta; não muda necessidade líquida nem reservas) */
  function situacaoMinimo(minimo, saldoFisico, disponivel) {
    if (minimo === '' || minimo === null || minimo === undefined || !(N(minimo) > 0)) return '';
    if (saldoFisico < N(minimo)) return 'ABAIXO DO MÍNIMO';
    if (disponivel < N(minimo)) return 'FICARÁ ABAIXO COM AS OPs ABERTAS';
    return 'OK';
  }
  window.mesSituacaoMinimo = situacaoMinimo;
  window.mesResumoMateriaisEstoque = function () { return resumoMateriais(linhasEstoque(), reservasOPs()); };
  function tagStatus(s) {
    var cls = /FALTA|ESGOT|SEM SALDO|ABAIXO DO M|NEGATIV/.test(s) ? 'erro' : (/BAIXO|RESERVA|FICAR/.test(s) ? 'alerta' : 'ok');
    return '<span class="mbc-tag ' + cls + '">' + esc(s) + '</span>';
  }
  (function () {
    var moduloAnt = window.estoqueModuleV4047;
    window.estoqueModuleV4047 = function () {
      if (typeof moduloAnt === 'function') moduloAnt.apply(this, arguments);
      try {
        garantirEstilo(); setCurrent('estoque'); marcarNav('estoque');
        cabecalho('Estoque e rastreabilidade de materiais', 'Saldo físico por entrada/lote e localização, quanto está reservado para OPs abertas, quanto já está em produção e quanto foi consumido.');
        var tb = document.querySelector('#content .toolbar');
        if (tb && !tb.querySelector('.mbc-btn-locais')) {
          var inp = el('v47_stock_q'); if (inp) inp.placeholder = 'Material, lote, localização, fornecedor...';
          tb.insertAdjacentHTML('beforeend', '<button class="secondary mbc-btn-locais" onclick="render(\'locais_estoque\')">Locais de estoque</button><button class="secondary" onclick="render(\'inventario_estoque\')">Inventário</button>');
        }
        var tbl = el('v47_stock_tbl');
        if (tbl && !el('mbc_stock_tabs')) {
          tbl.insertAdjacentHTML('beforebegin', '<div class="mbc-tabs" id="mbc_stock_tabs"><button data-v="material" onclick="mesEstoqueVisao(\'material\')">Por material (reservado × em produção × consumido)</button>' +
            '<button data-v="lote" onclick="mesEstoqueVisao(\'lote\')">Por entrada / lote / localização</button><button data-v="reservas" onclick="mesEstoqueVisao(\'reservas\')">Reservas por OP</button></div>');
        }
        window.v4047RenderStockTable();
      } catch (e) { console.warn('MES LION: estoque', e); }
    };
  })();
  window.mesEstoqueVisao = function (v) { window.__mbcStockView = v; window.v4047RenderStockTable(); };
  window.v4047RenderStockTable = function () {
    var box = el('v47_stock_tbl'); if (!box) return;
    var visao = window.__mbcStockView || 'material';
    document.querySelectorAll('#mbc_stock_tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === visao); });
    var pr = (el('v47_stock_proj') || {}).value || '', q = chave((el('v47_stock_q') || {}).value || '');
    var linhas = linhasEstoque(), reservas = reservasOPs(), ctx = contextoEstoque();
    var linhasF = linhas.filter(function (r) { return (!pr || r.CodigoProjeto === pr) && (!q || chave(JSON.stringify(r)).indexOf(q) >= 0); });
    var mats = resumoMateriais(linhas.filter(function (r) { return !pr || r.CodigoProjeto === pr; }), reservas).filter(function (r) { return !q || chave(JSON.stringify(r)).indexOf(q) >= 0; });
    var resF = reservas.filter(function (r) { return r.Reservado > 0 && (!q || chave(JSON.stringify(r)).indexOf(q) >= 0); });
    var kpi = el('v1014_stock_kpis');
    if (kpi) {
      kpi.innerHTML = '<div><small>Entradas/lotes' + (pr ? ' (projeto filtrado)' : '') + '</small><b>' + linhasF.length + '</b></div><div><small>Lotes com saldo</small><b>' + linhasF.filter(function (r) { return r.Saldo > 0; }).length + '</b></div>' +
        '<div><small>Qualificados</small><b>' + linhasF.filter(function (r) { return typeof v4047Qualified === 'function' ? v4047Qualified(r.MaterialQualificado) : /sim/i.test(r.MaterialQualificado); }).length + '</b></div>' +
        '<div><small>Materiais com reserva em OPs abertas</small><b>' + mats.filter(function (m) { return m.Reservado > 0; }).length + '</b></div>' +
        '<div><small>Materiais em falta para as OPs</small><b style="color:' + (mats.some(function (m) { return m.Disponivel < 0; }) ? '#a00e1c' : 'inherit') + '">' + mats.filter(function (m) { return m.Disponivel < 0; }).length + '</b></div>' +
        '<div><small>Abaixo do estoque mínimo</small><b style="color:' + (mats.some(function (m) { return m.SituacaoMinimo === 'ABAIXO DO MÍNIMO'; }) ? '#a00e1c' : 'inherit') + '">' + mats.filter(function (m) { return m.SituacaoMinimo === 'ABAIXO DO MÍNIMO'; }).length + '</b></div>';
    }
    var nota = '<p class="muted" style="margin:4px 0 8px">Saldo físico = entradas − consumos apontados − perdas do lote − saídas manuais e baixas técnicas (Ajuste de Estoque). <b>Em produção</b> = já retirado para OPs ainda abertas. <b>Reservado</b> = planejado nas OPs abertas e ainda não consumido. <b>Disponível</b> = saldo físico − reservado.' +
      (pr ? ' As reservas consideram todas as OPs abertas.' : '') + (ctx.orfaos ? ' <span class="mbc-tag alerta">' + ctx.orfaos + ' consumo(s) de OPs excluídas não entram no saldo</span>' : '') +
      ' O lote fica na UM da entrada; a visão por material e as reservas, na UM do material (conversão pelo "Fator conversão para kg" quando as unidades são diferentes).' +
      (function () {
        var neg = linhas.filter(function (r) { return r.Saldo < 0; }).length, sem = linhas.filter(function (r) { return r.SemConversaoUM; }).length;
        return (neg ? ' <span class="mbc-tag erro">' + neg + ' lote(s) com saldo negativo: saiu mais do que entrou — confira a entrada (quantidade e UM)</span>' : '') +
          (sem ? ' <span class="mbc-tag alerta">' + sem + ' lote(s) com apontamento em UM sem conversão para a UM do lote — veja o relatório Consistência dos dados</span>' : '');
      })() + '</p>';
    var th = function (cols) { return '<thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead>'; };
    var html;
    if (visao === 'lote') {
      html = '<div class="table-wrap"><table>' + th(['Entrada', 'Código', 'Material', 'Lote', 'Localização', 'Fornecedor', 'Projeto', 'UM', 'Qtd entrada', 'Consumido (OPs encerradas)', 'Em produção (OPs abertas)', 'Perdas', 'Saídas manuais / baixas técnicas', 'Saldo', 'Status', 'Qualificado', 'NF', 'OPs relacionadas']) + '<tbody>' +
        linhasF.map(function (r) {
          return '<tr><td>' + esc(r.Entrada) + '</td><td>' + esc(r.CodigoMaterial) + '</td><td>' + esc(r.Material) + '</td><td>' + esc(r.Lote) + '</td><td>' + (r.Localizacao ? esc(r.Localizacao) : '<span class="muted">—</span>') + '</td><td>' + esc(r.Fornecedor) + '</td><td>' + esc(r.Projeto) + '</td><td>' + esc(r.UM) + '</td>' +
            '<td class="mbc-num">' + f3(r.QtdEntrada) + '</td><td class="mbc-num">' + f3(r.ConsumoOPEncerrada) + '</td><td class="mbc-num">' + f3(r.ConsumoOPAberta) + '</td><td class="mbc-num">' + f3(r.PerdasLote) + '</td><td class="mbc-num">' + f3((r.AjusteSaida || 0) + (r.BaixaTecnica || 0)) + '</td><td class="mbc-num"><b>' + f3(r.Saldo) + '</b></td>' +
            '<td>' + tagStatus(r.StatusSaldo) + (r.SemConversaoUM ? '<br><span class="mbc-tag alerta" title="' + esc(r.SemConversaoUM) + '">UM sem conversão</span>' : '') + '</td><td>' + esc(r.MaterialQualificado) + '</td><td>' + esc(r.NotaFiscal) + '</td><td>' + esc(r.OPsRelacionadas) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (visao === 'reservas') {
      html = '<div class="table-wrap"><table>' + th(['OP', 'Status da OP', 'Código', 'Material', 'UM', 'Planejado', 'Já consumido', 'Reservado (a consumir)', 'Saldo físico do material']) + '<tbody>' +
        (resF.map(function (r) {
          var m = mats.find(function (x) { return x.CodigoMaterial === r.CodigoMaterial; }) || {};
          return '<tr><td>' + esc(r.CodOP) + '</td><td>' + esc(r.StatusOP) + '</td><td>' + esc(r.CodigoMaterial) + '</td><td>' + esc(r.Material) + '</td><td>' + esc(r.UM) + '</td><td class="mbc-num">' + f4(r.Planejado) + '</td><td class="mbc-num">' + f4(r.Consumido) + '</td><td class="mbc-num"><b>' + f4(r.Reservado) + '</b></td><td class="mbc-num">' + f3(m.SaldoFisico || 0) + '</td></tr>';
        }).join('') || '<tr><td colspan="9">Nenhuma reserva: não há material a consumir em OPs abertas.</td></tr>') + '</tbody></table></div>';
    } else {
      html = '<div class="table-wrap"><table>' + th(['Código', 'Material', 'UM', 'Lotes c/ saldo', 'Entradas', 'Consumido (OPs encerradas)', 'Em produção (OPs abertas)', 'Perdas', 'Saídas manuais / baixas técnicas', 'Saldo físico', 'Reservado p/ OPs abertas', 'Disponível', 'Status', 'Estoque mínimo', 'OPs com reserva']) + '<tbody>' +
        (mats.map(function (m) {
          return '<tr><td>' + esc(m.CodigoMaterial) + '</td><td>' + esc(m.Material) + '</td><td>' + esc(m.UM) + '</td><td class="mbc-num">' + m.LotesComSaldo + ' / ' + m.Lotes + '</td><td class="mbc-num">' + f3(m.Entradas) + '</td>' +
            '<td class="mbc-num">' + f3(m.ConsumidoEncerradas) + '</td><td class="mbc-num">' + f3(m.EmProducao) + '</td><td class="mbc-num">' + f3(m.Perdas) + '</td><td class="mbc-num">' + f3(m.AjustesSaida + m.BaixasTecnicas) + '</td><td class="mbc-num"><b>' + f3(m.SaldoFisico) + '</b></td>' +
            '<td class="mbc-num">' + f4(m.Reservado) + '</td><td class="mbc-num"><b style="color:' + (m.Disponivel < 0 ? '#a00e1c' : '#0b3a5c') + '">' + f3(m.Disponivel) + '</b></td><td>' + tagStatus(m.Status) +
            (m.LotesSemConversaoUM ? '<br><span class="mbc-tag alerta" title="Fora da soma: ' + esc(m.LotesSemConversaoUM) + '">lote(s) em UM sem conversão fora da soma</span>' : '') + '</td><td>' + (m.SituacaoMinimo ? f3(m.EstoqueMinimo) + '<br>' + tagStatus(m.SituacaoMinimo) : '<span class="muted">—</span>') + '</td><td style="max-width:340px">' + esc(m.OPsComReserva) + '</td></tr>';
        }).join('') || '<tr><td colspan="15">Nenhum material.</td></tr>') + '</tbody></table></div>';
    }
    box.innerHTML = nota + html;
  };
  window.exportEstoqueExcelV4047 = function () {
    var proj = (el('v47_stock_proj') || {}).value || '', linhas = linhasEstoque(), filt = proj ? linhas.filter(function (r) { return r.CodigoProjeto === proj; }) : linhas, reservas = reservasOPs();
    var mats = resumoMateriais(filt, reservas).map(function (m) { var o = Object.assign({}, m); delete o.OPsReserva; return o; });
    if (typeof downloadAuditExcelV3819 !== 'function') return alert('Exportação indisponível.');
    downloadAuditExcelV3819('MES_LION_saldos_estoque.xls', 'Saldos e rastreabilidade de estoque', [
      { title: 'Saldo por material: físico, reservado em OPs abertas, em produção e consumido', rows: mats },
      { title: 'Saldos por entrada, lote e localização', rows: filt },
      { title: 'Reservas por OP aberta', rows: reservas.filter(function (r) { return r.Reservado > 0; }) },
      { title: 'Entradas originais', rows: D().entradas || [] },
      { title: 'Consumos OP', rows: D().op_materiais || [] }
    ]);
  };

  /* ---------------------------------------------------------------------
     7) LOCAIS DE ESTOQUE — CONSULTA POR LOCALIZAÇÃO E MUDANÇA DE LOCAL
     --------------------------------------------------------------------- */
  function locaisModulo() {
    garantirEstilo(); setCurrent('locais_estoque'); marcarNav('locais_estoque');
    cabecalho('Locais de estoque', 'Consulta dos materiais por localização física (endereço informado na entrada do lote).');
    el('content').innerHTML = '<div class="toolbar"><button class="secondary" onclick="render(\'entradas\')">← Entradas</button><button class="secondary" onclick="estoqueModuleV4047()">Estoque / Rastreabilidade</button>' +
      '<input id="mbc_loc_q" placeholder="Localização, material, lote..." oninput="mesLocaisRender()" style="min-width:260px">' +
      '<label class="mbc-inline" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="mbc_loc_zero" onchange="mesLocaisRender()"> Mostrar lotes esgotados</label></div>' +
      campoLeitura('mbc_loc_scan', 'Ler etiqueta do lote ou do material', 'Bipe a etiqueta para ver onde o material está', 'mesLocaisLer') +
      '<div class="mbc-kpis" id="mbc_loc_kpis"></div><div id="mbc_loc_lista"></div>';
    window.mesLocaisRender();
  }
  window.mesLocaisLer = function (v) {
    var r = resolverCodigo(v);
    if (!r.material && !r.entrada) { bip(false); return aviso('mbc_loc_scan_msg', 'Código ' + esc(r.codigo) + ' não encontrado.', 'erro'); }
    bip(true);
    var q = el('mbc_loc_q'); if (q) q.value = r.entrada ? r.entrada.Entrada : r.material['CódigoMaterial'];
    var z = el('mbc_loc_zero'); if (z) z.checked = false;
    window.mesLocaisRender();
    var linhas = linhasEstoque().filter(function (l) { return r.entrada ? l.Entrada === r.entrada.Entrada : l.CodigoMaterial === r.material['CódigoMaterial']; }).filter(function (l) { return l.Saldo > 0 || r.entrada; });
    aviso('mbc_loc_scan_msg', linhas.length ? linhas.map(function (l) { return '<b>' + esc(l.Entrada) + '</b> lote ' + esc(l.Lote || '-') + ': ' + esc(l.Localizacao || 'sem localização') + ' · saldo ' + f3(l.Saldo) + ' ' + esc(l.UM); }).join('<br>') : 'Material sem saldo em estoque.', 'ok');
    var i = el('mbc_loc_scan'); if (i) { i.value = ''; i.focus(); }
  };
  window.mesLocaisRender = function () {
    var box = el('mbc_loc_lista'); if (!box) return;
    var q = chave((el('mbc_loc_q') || {}).value || ''), zero = !!(el('mbc_loc_zero') || {}).checked;
    var linhas = linhasEstoque().filter(function (r) { return (zero || r.Saldo > 0) && (!q || chave([r.Localizacao, r.Entrada, r.CodigoMaterial, r.Material, r.Lote, r.Fornecedor].join(' ')).indexOf(q) >= 0); });
    var grupos = {};
    linhas.forEach(function (r) { var k = txt(r.Localizacao) || '(sem localização)'; (grupos[k] = grupos[k] || []).push(r); });
    var nomes = Object.keys(grupos).sort(function (a, b) { if (a === '(sem localização)') return 1; if (b === '(sem localização)') return -1; return a.localeCompare(b, 'pt-BR', { numeric: true }); });
    var k = el('mbc_loc_kpis');
    if (k) k.innerHTML = '<div><small>Locais com material</small><b>' + nomes.filter(function (n) { return n !== '(sem localização)'; }).length + '</b></div><div><small>Lotes listados</small><b>' + linhas.length + '</b></div>' +
      '<div><small>Lotes sem localização</small><b>' + ((grupos['(sem localização)'] || []).length) + '</b></div>';
    box.innerHTML = nomes.map(function (n) {
      var rows = grupos[n], porUM = {};
      rows.forEach(function (r) { porUM[r.UM || 'UM'] = (porUM[r.UM || 'UM'] || 0) + r.Saldo; });
      var mats = rows.map(function (r) { return r.CodigoMaterial; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).length;
      return '<details class="mbc-loc-group" ' + (nomes.length <= 6 || q ? 'open' : '') + '><summary>📍 ' + esc(n) + ' <span class="mbc-tag info">' + rows.length + ' lote(s)</span><span class="mbc-tag">' + mats + ' material(is)</span>' +
        Object.keys(porUM).map(function (u) { return '<span class="mbc-tag ok">' + f3(porUM[u]) + ' ' + esc(u) + '</span>'; }).join('') + '</summary><div><div class="table-wrap"><table><thead><tr><th>Entrada</th><th>Código</th><th>Material</th><th>Lote</th><th>Fornecedor</th><th>Saldo</th><th>UM</th><th>Status</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + esc(r.Entrada) + '</td><td>' + esc(r.CodigoMaterial) + '</td><td>' + esc(r.Material) + '</td><td>' + esc(r.Lote) + '</td><td>' + esc(r.Fornecedor) + '</td><td class="mbc-num"><b>' + f3(r.Saldo) + '</b></td><td>' + esc(r.UM) + '</td><td>' + tagStatus(r.StatusSaldo) + '</td>' +
            '<td><button class="mini secondary" onclick="mesMoverLocal(\'' + jsStr(r.Entrada) + '\')">Mudar local</button></td></tr>';
        }).join('') + '</tbody></table></div></div></details>';
    }).join('') || '<p class="muted">Nenhum lote encontrado.</p>';
  };
  window.mesMoverLocal = function (entrada) {
    var e = A(D().entradas).find(function (x) { return x.Entrada === entrada; }); if (!e) return;
    var novo = prompt('Nova localização do lote ' + (e.Lote || '') + ' (' + entrada + ' — ' + (e.DescricaoMaterial || '') + '):\nLocais já usados: ' + locaisConhecidos().slice(0, 15).join(' | '), e.Localizacao || '');
    if (novo === null) return;
    novo = txt(novo);
    if (novo === txt(e.Localizacao)) return;
    e.Localizacao = novo;
    e.LocalizacaoHistorico = A(e.LocalizacaoHistorico).concat([{ Data: agora(), Local: novo, Usuario: usuario(), Origem: 'Locais de estoque' }]);
    salvar(); window.mesLocaisRender();
  };

  /* ---------------------------------------------------------------------
     8) INVENTÁRIO DE ESTOQUE
     Baixar template (.xlsx com o saldo e o custo atuais de cada entrada/lote) → preencher a contagem e/ou o custo novo
     → validar → aplicar. Cada inventário aplicado guarda os valores anteriores de cada lote: pode ser revertido
     (volta aos dados anteriores), reaplicado e excluído. Antes de aplicar, o MES cria uma cópia de segurança.
     Ajuste de saldo: a quantidade da entrada é corrigida para que saldo = contagem (o consumo já apontado não muda).
     Custo: o valor unitário e o custo total da entrada são corrigidos (consumos já apontados mantêm o custo gravado).
     --------------------------------------------------------------------- */
  var XL = (function () {
    function xmlEsc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); }
    function colLetra(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
    function colIndice(l) { var n = 0; String(l || '').toUpperCase().replace(/[^A-Z]/g, '').split('').forEach(function (ch) { n = n * 26 + ch.charCodeAt(0) - 64; }); return n - 1; }
    var T = null;
    function crc32(b) {
      if (!T) { T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } }
      var crc = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) crc = T[(crc ^ b[i]) & 0xFF] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0;
    }
    function zip(arqs) {
      var enc = new TextEncoder(), partes = [], central = [], off = 0, ag = new Date();
      var hora = (ag.getHours() << 11) | (ag.getMinutes() << 5) | (ag.getSeconds() >> 1), dia = ((ag.getFullYear() - 1980) << 9) | ((ag.getMonth() + 1) << 5) | ag.getDate();
      arqs.forEach(function (a) {
        var nome = enc.encode(a.nome), dados = enc.encode(a.texto), crc = crc32(dados), lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, hora, true); lh.setUint16(12, dia, true);
        lh.setUint32(14, crc, true); lh.setUint32(18, dados.length, true); lh.setUint32(22, dados.length, true); lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true);
        partes.push(new Uint8Array(lh.buffer), nome, dados);
        var ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, hora, true); ch.setUint16(14, dia, true);
        ch.setUint32(16, crc, true); ch.setUint32(20, dados.length, true); ch.setUint32(24, dados.length, true); ch.setUint16(28, nome.length, true);
        ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, off, true);
        central.push(new Uint8Array(ch.buffer), nome); off += 30 + nome.length + dados.length;
      });
      var tc = central.reduce(function (s, p) { return s + p.length; }, 0), fim = new DataView(new ArrayBuffer(22));
      fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arqs.length, true); fim.setUint16(10, arqs.length, true); fim.setUint32(12, tc, true); fim.setUint32(16, off, true);
      var todas = partes.concat(central, [new Uint8Array(fim.buffer)]), out = new Uint8Array(todas.reduce(function (s, p) { return s + p.length; }, 0)), pos = 0;
      todas.forEach(function (p) { out.set(p, pos); pos += p.length; }); return out;
    }
    /* linhas: [{c:[valores], s: estilo da linha, cs: [estilo por célula]}]. Estilos: 1 cabeçalho, 2 amarelo (preencher), 3 texto quebrado, 4 título, 5 cinza (não alterar),
       6 a 9 cabeçalhos verde/roxo/laranja/cinza, 10 vermelho claro (linha com erro) */
    function folha(linhas, op) {
      op = op || {};
      var rows = linhas.map(function (l, r) {
        return '<row r="' + (r + 1) + '">' + l.c.map(function (v, c) {
          var ref = colLetra(c) + (r + 1), s = (l.cs && l.cs[c] != null) ? l.cs[c] : l.s, st = s ? ' s="' + s + '"' : '';
          if (v === '' || v == null) return s ? '<c r="' + ref + '"' + st + '/>' : '';
          if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
          return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
        }).join('') + '</row>';
      }).join('');
      var cols = op.larguras ? '<cols>' + op.larguras.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
      /* 1.6.0: op.congelar = número de linhas fixas (true = 1); op.mesclar = ['A1:G1', ...];
         op.validacoes = [{ ref: 'C3:C2000', nome: 'ListaProcessos' | valores: ['Sim', 'Não'], titulo, mensagem }] (lista suspensa do Excel) */
      var nf = op.congelar === true ? 1 : (Number(op.congelar) || 0);
      var mesclas = A(op.mesclar).length ? '<mergeCells count="' + op.mesclar.length + '">' + op.mesclar.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '';
      var vals = A(op.validacoes).length ? '<dataValidations count="' + op.validacoes.length + '">' + op.validacoes.map(function (v) {
        var f = v.nome ? xmlEsc(v.nome) : '"' + xmlEsc(A(v.valores).join(',')) + '"';
        return '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"' + (v.titulo ? ' errorTitle="' + xmlEsc(v.titulo) + '" promptTitle="' + xmlEsc(v.titulo) + '"' : '') +
          (v.mensagem ? ' error="' + xmlEsc(v.mensagem) + '" prompt="' + xmlEsc(v.mensagem) + '"' : '') + ' sqref="' + v.ref + '"><formula1>' + f + '</formula1></dataValidation>';
      }).join('') + '</dataValidations>' : '';
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"' + (op.ativa ? ' tabSelected="1"' : '') + '>' +
        (nf ? '<pane ySplit="' + nf + '" topLeftCell="A' + (nf + 1) + '" activePane="bottomLeft" state="frozen"/>' : '') + '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + rows + '</sheetData>' + mesclas + vals + '</worksheet>';
    }
    function gerar(folhas, nomes) {
      var ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml.', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      var arqs = [
        { nome: '[Content_Types].xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="' + ct + 'sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="' + ct + 'styles+xml"/>' + folhas.map(function (f, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="' + ct + 'worksheet+xml"/>'; }).join('') + '</Types>' },
        { nome: '_rels/.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
        { nome: 'xl/workbook.xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + rel + '"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' + folhas.map(function (f, i) { return '<sheet name="' + xmlEsc(f.nome) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' +
          (A(nomes).length ? '<definedNames>' + nomes.map(function (n) { return '<definedName name="' + xmlEsc(n.nome) + '">' + xmlEsc(n.ref) + '</definedName>'; }).join('') + '</definedNames>' : '') + '</workbook>' },
        { nome: 'xl/_rels/workbook.xml.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + folhas.map(function (f, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="' + rel + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (folhas.length + 1) + '" Type="' + rel + '/styles" Target="styles.xml"/></Relationships>' },
        { nome: 'xl/styles.xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="13"/><color rgb="FF004B87"/><name val="Calibri"/><family val="2"/></font></fonts>' +
          '<fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF004B87"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF1F4"/><bgColor indexed="64"/></patternFill></fill>' +
          '<fill><patternFill patternType="solid"><fgColor rgb="FF2E7D32"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6A1B9A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC55A11"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF546E7A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8D7DA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' +
          /* 1.6.0: 6 a 9 = cabeçalho verde, roxo, laranja e cinza (grupos de colunas); 10 = linha com erro (vermelho claro) */
          ['5', '6', '7', '8'].map(function (f) { return '<xf numFmtId="0" fontId="1" fillId="' + f + '" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>'; }).join('') +
          '<xf numFmtId="0" fontId="0" fillId="9" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
      ];
      folhas.forEach(function (f, i) { arqs.push({ nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', texto: f.xml }); });
      return zip(arqs);
    }
    async function inflar(dados) {
      if (typeof DecompressionStream !== 'function') throw new Error('Este navegador não consegue ler .xlsx. Salve a planilha como CSV (separado por ponto e vírgula) e importe de novo.');
      var fl = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(fl).arrayBuffer());
    }
    async function lerZip(bytes) {
      var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), fim = -1, out = {}, dec = new TextDecoder('utf-8');
      for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; } }
      if (fim < 0) throw new Error('arquivo .xlsx inválido');
      var n = dv.getUint16(fim + 10, true), pos = dv.getUint32(fim + 16, true);
      for (var k = 0; k < n; k++) {
        if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('arquivo .xlsx inválido');
        var met = dv.getUint16(pos + 10, true), tam = dv.getUint32(pos + 20, true), ln = dv.getUint16(pos + 28, true), le = dv.getUint16(pos + 30, true), lc = dv.getUint16(pos + 32, true), loc = dv.getUint32(pos + 42, true);
        var nome = dec.decode(bytes.subarray(pos + 46, pos + 46 + ln));
        if (/\.(xml|rels)$/i.test(nome)) { var ini = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true), d = bytes.subarray(ini, ini + tam); out[nome] = met === 0 ? d : (met === 8 ? await inflar(d) : null); }
        pos += 46 + ln + le + lc;
      }
      return out;
    }
    function filhos(no, nome) { return [].slice.call(no.getElementsByTagNameNS('*', nome)); }
    async function lerXlsx(bytes, abaPreferida) {
      var z = await lerZip(bytes), dec = new TextDecoder('utf-8');
      var xml = function (n) { var b = z[n]; return b ? new DOMParser().parseFromString(dec.decode(b), 'application/xml') : null; };
      var wb = xml('xl/workbook.xml'); if (!wb) throw new Error('arquivo .xlsx sem planilhas');
      var alvo = {}, rels = xml('xl/_rels/workbook.xml.rels');
      if (rels) filhos(rels, 'Relationship').forEach(function (r) { alvo[r.getAttribute('Id')] = r.getAttribute('Target'); });
      var fs = filhos(wb, 'sheet').map(function (s) { return { nome: s.getAttribute('name') || '', rid: s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id') }; });
      var esc2 = fs.find(function (f) { return chave(f.nome).replace(/[^a-z]/g, '') === abaPreferida; }) || fs[0];
      var cam = String((esc2 && alvo[esc2.rid]) || 'worksheets/sheet1.xml').replace(/^\//, ''); if (cam.indexOf('xl/') !== 0) cam = 'xl/' + cam;
      var comp = [], ss = xml('xl/sharedStrings.xml');
      if (ss) filhos(ss, 'si').forEach(function (si) { comp.push(filhos(si, 't').filter(function (t) { return t.parentNode && t.parentNode.localName !== 'rPh'; }).map(function (t) { return t.textContent; }).join('')); });
      var fo = xml(cam); if (!fo) throw new Error('aba da planilha não encontrada no .xlsx');
      var linhas = [];
      filhos(fo, 'row').forEach(function (row) {
        var r = Number(row.getAttribute('r')) || (linhas.length + 1), cel = [];
        filhos(row, 'c').forEach(function (c) {
          var ref = c.getAttribute('r') || '', col = ref ? colIndice(ref) : cel.length, t = c.getAttribute('t') || '', v = filhos(c, 'v')[0], val = '';
          if (t === 's') val = comp[Number(v ? v.textContent : -1)] || '';
          else if (t === 'inlineStr') val = filhos(c, 't').map(function (x) { return x.textContent; }).join('');
          else if (t === 'b') val = v && v.textContent === '1' ? 'VERDADEIRO' : 'FALSO';
          else val = v ? v.textContent : '';
          cel[col >= 0 ? col : cel.length] = { v: val, num: (t === '' || t === 'n') && !!v };
        });
        linhas[r - 1] = cel;
      });
      for (var i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = [];
      return linhas;
    }
    function lerCSV(t) {
      if (t.charAt(0) === '﻿') t = t.slice(1);
      var pri = t.split(/\r?\n/)[0] || '', sep = pri.indexOf(';') >= 0 ? ';' : (pri.indexOf('\t') >= 0 ? '\t' : ',');
      var ls = [], l = [], c = '', q = false;
      for (var i = 0; i < t.length; i++) {
        var ch = t[i];
        if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
        else if (ch === '"') q = true; else if (ch === sep) { l.push(c); c = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; l.push(c); ls.push(l); l = []; c = ''; }
        else c += ch;
      }
      if (c !== '' || l.length) { l.push(c); ls.push(l); }
      return ls.map(function (x) { return x.map(function (v) { return { v: v, num: false }; }); });
    }
    async function ler(file, aba) {
      var b = new Uint8Array(await file.arrayBuffer());
      if (b.length > 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 3 && b[3] === 4) return lerXlsx(b, aba);
      if (b.length > 8 && b[0] === 0xD0 && b[1] === 0xCF) throw new Error('Formato antigo do Excel 97-2003 (.xls). No Excel use Arquivo > Salvar como > "Pasta de Trabalho do Excel (.xlsx)" ou CSV.');
      var t; try { t = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { t = new TextDecoder('windows-1252').decode(b); }
      return lerCSV(t);
    }
    function numero(c) {
      if (!c || String(c.v).trim() === '') return NaN;
      if (c.num) return Number(c.v);
      var s = String(c.v).trim().replace(/\s|R\$/g, '');
      if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.'); else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
      return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
    }
    return { gerar: gerar, folha: folha, ler: ler, numero: numero, coluna: colLetra };
  })();
  window.mesXlsx = XL;

  var COLS_INV = ['Entrada', 'CodigoMaterial', 'DescricaoMaterial', 'Lote', 'UM', 'LocalizacaoAtual', 'SaldoSistema', 'CustoUnitarioSistema', 'SaldoContado', 'CustoUnitarioNovo', 'LocalizacaoNova', 'Observacao'];
  function templateInventario(incluirEsgotados) {
    var linhas = linhasEstoque().filter(function (r) { return incluirEsgotados || r.Saldo > 0; })
      .sort(function (a, b) { return (String(a.Localizacao) + '|' + a.CodigoMaterial + '|' + a.Lote).localeCompare(String(b.Localizacao) + '|' + b.CodigoMaterial + '|' + b.Lote, 'pt-BR', { numeric: true }); });
    var cinza = [5, 5, 5, 5, 5, 5, 5, 5, 2, 2, 2, 2];
    var dados = [{ c: COLS_INV, s: 1 }].concat(linhas.map(function (r) {
      return { c: [r.Entrada, r.CodigoMaterial, r.Material, r.Lote, r.UM, r.Localizacao, arred(r.Saldo, 6), arred(r.CustoUnitario, 6), '', '', '', ''], cs: cinza };
    }));
    for (var i = 0; i < 5; i++) dados.push({ c: ['', '', '', '', '', '', '', '', '', '', '', ''], cs: [2, 2, 5, 2, 5, 5, 5, 5, 2, 2, 2, 2] });
    var instr = [
      { c: ['Inventário geral de estoque — MES LION'], s: 4 }, { c: ['Gerado em ' + agora() + ' por ' + usuario()] }, { c: [''] },
      { c: ['1. A aba "Inventario" traz uma linha por entrada/lote, com o saldo e o custo unitário que o MES tem hoje (colunas cinza: não altere).'], s: 3 },
      { c: ['2. Preencha só as colunas amarelas que mudam: SaldoContado (quantidade contada, na UM da entrada), CustoUnitarioNovo (R$ por UM) e LocalizacaoNova. Deixe em branco o que não muda.'], s: 3 },
      { c: ['3. SaldoContado = 0 zera o lote. Linhas sem nenhuma coluna amarela preenchida são ignoradas.'], s: 3 },
      { c: ['4. Lote que existe fisicamente e não está no MES: use uma linha nova sem Entrada, com CodigoMaterial (código do cadastro), Lote, SaldoContado e CustoUnitarioNovo. O MES cria uma entrada de inventário.'], s: 3 },
      { c: ['5. Se houver consumo depois do download, o MES aplica a diferença contada (SaldoContado − SaldoSistema) sobre o saldo do momento e avisa na validação.'], s: 3 },
      { c: ['6. No MES: Materiais > Inventário de Estoque > "Validar planilha" mostra o que vai mudar; só então "Aplicar inventário" grava. Um inventário aplicado pode ser revertido (volta aos dados anteriores), reaplicado ou excluído.'], s: 3 },
      { c: ['7. Salve como "Pasta de Trabalho do Excel (.xlsx)" ou CSV separado por ponto e vírgula.'], s: 3 }
    ];
    return XL.gerar([
      { nome: 'Inventario', xml: XL.folha(dados, { larguras: [11, 15, 34, 14, 7, 24, 14, 18, 14, 18, 24, 34], congelar: true, ativa: true }) },
      { nome: 'Como preencher', xml: XL.folha(instr, { larguras: [150] }) }
    ]);
  }
  window.mesInventarioTemplate = function () {
    try {
      var z = !!(el('mbc_inv_zero') || {}).checked;
      baixar('INVENTARIO_ESTOQUE_MES_LION_' + new Date().toISOString().slice(0, 10) + '.xlsx', templateInventario(z), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) { alert('Não foi possível gerar o template.\n\n' + (e && e.message ? e.message : e)); }
  };
  function validarInventario(linhasPlanilha) {
    var cab = -1, idx = {};
    for (var i = 0; i < Math.min(linhasPlanilha.length, 15); i++) {
      var ks = (linhasPlanilha[i] || []).map(function (c) { return chave(c && c.v).replace(/[^a-z]/g, ''); });
      if (ks.indexOf('saldocontado') >= 0 && (ks.indexOf('entrada') >= 0 || ks.indexOf('codigomaterial') >= 0)) { cab = i; ks.forEach(function (k, j) { if (k && idx[k] === undefined) idx[k] = j; }); break; }
    }
    if (cab < 0) throw new Error('Cabeçalho não encontrado. Use o template do inventário (colunas Entrada, CodigoMaterial, SaldoContado, CustoUnitarioNovo...).');
    var col = function (l, nome) { var j = idx[nome]; return j === undefined ? null : (l[j] || { v: '', num: false }); };
    var atual = {}, vistas = {}, out = [];
    linhasEstoque().forEach(function (r) { atual[r.Entrada] = r; });
    for (var n = cab + 1; n < linhasPlanilha.length; n++) {
      var l = linhasPlanilha[n] || [];
      var ent = txt((col(l, 'entrada') || {}).v), cod = txt((col(l, 'codigomaterial') || {}).v), lote = txt((col(l, 'lote') || {}).v);
      var cont = XL.numero(col(l, 'saldocontado')), custo = XL.numero(col(l, 'custounitarionovo')), locN = txt((col(l, 'localizacaonova') || {}).v), obs = txt((col(l, 'observacao') || {}).v);
      var saldoTpl = XL.numero(col(l, 'saldosistema'));
      var contTxt = txt((col(l, 'saldocontado') || {}).v), custoTxt = txt((col(l, 'custounitarionovo') || {}).v);
      if (!ent && !cod && !contTxt && !custoTxt && !locN) continue;
      var L = { Linha: n + 1, Entrada: ent, CodigoMaterial: cod, Lote: lote, SaldoContado: contTxt === '' ? null : cont, CustoUnitarioNovo: custoTxt === '' ? null : custo, LocalizacaoNova: locN, Observacao: obs, Status: 'OK', Mensagens: [] };
      var erro = function (m) { L.Status = 'ERRO'; L.Mensagens.push(m); }, alerta = function (m) { if (L.Status === 'OK') L.Status = 'AVISO'; L.Mensagens.push(m); };
      if (contTxt !== '' && (!isFinite(cont) || cont < 0)) erro('SaldoContado inválido (' + contTxt + ').');
      if (custoTxt !== '' && (!isFinite(custo) || custo < 0)) erro('CustoUnitarioNovo inválido (' + custoTxt + ').');
      if (ent) {
        var r = atual[ent], e = A(D().entradas).find(function (x) { return x.Entrada === ent; });
        if (!r || !e) { erro('Entrada ' + ent + ' não existe no MES.'); out.push(L); continue; }
        if (vistas[ent]) erro('Entrada ' + ent + ' repetida na planilha (linha ' + vistas[ent] + ').');
        vistas[ent] = L.Linha;
        if (cod && chaveCodigo(cod) !== chaveCodigo(r.CodigoMaterial)) erro('CodigoMaterial ' + cod + ' não corresponde à entrada ' + ent + ' (' + r.CodigoMaterial + ').');
        L.Tipo = 'AJUSTE'; L.CodigoMaterial = r.CodigoMaterial; L.Material = r.Material; L.Lote = r.Lote; L.UM = r.UM;
        L.SaldoAtual = r.Saldo; L.CustoAtual = r.CustoUnitario; L.LocalAtual = r.Localizacao;
        if (contTxt === '' && custoTxt === '' && !locN) { L.Status = 'IGNORADA'; L.Mensagens.push('Sem alteração.'); out.push(L); continue; }
        var base = isFinite(saldoTpl) ? saldoTpl : r.Saldo;
        if (L.SaldoContado !== null && isFinite(cont)) {
          L.Delta = arred(cont - base, 6);
          L.SaldoNovo = arred(r.Saldo + L.Delta, 6);
          if (isFinite(saldoTpl) && Math.abs(saldoTpl - r.Saldo) > 1e-9) alerta('O saldo mudou desde o download (' + f4(saldoTpl) + ' → ' + f4(r.Saldo) + '): a diferença contada (' + f4(L.Delta) + ') é aplicada sobre o saldo atual.');
          if (L.SaldoNovo < -1e-9) erro('O saldo ficaria negativo (' + f4(L.SaldoNovo) + ').');
        } else { L.Delta = 0; L.SaldoNovo = r.Saldo; }
        L.CustoNovo = (L.CustoUnitarioNovo !== null && isFinite(custo)) ? custo : r.CustoUnitario;
        L.LocalNovo = locN || r.Localizacao;
        if (Math.abs(L.Delta) < 1e-12 && Math.abs(L.CustoNovo - r.CustoUnitario) < 1e-12 && L.LocalNovo === r.Localizacao && L.Status === 'OK') { L.Status = 'IGNORADA'; L.Mensagens.push('Valores iguais aos do MES.'); }
      } else {
        L.Tipo = 'NOVO LOTE';
        var m = materialPorCodigo(cod);
        if (!cod) erro('Linha nova sem Entrada: informe o CodigoMaterial.');
        else if (!m) erro('Material ' + cod + ' não cadastrado. Cadastre o material antes (ou leia o código de barras na Entrada de Materiais).');
        if (L.SaldoContado === null || !(cont > 0)) erro('Linha nova: SaldoContado deve ser maior que zero.');
        if (m) { L.CodigoMaterial = m['CódigoMaterial']; L.Material = m.DescricaoMateriais || ''; L.UM = m.UM || ''; }
        L.SaldoAtual = 0; L.SaldoNovo = isFinite(cont) ? cont : 0; L.Delta = L.SaldoNovo;
        if (L.CustoUnitarioNovo === null && m) {
          var med = typeof custoMedioPonderadoMaterialV3814 === 'function' ? custoMedioPonderadoMaterialV3814(m['CódigoMaterial']) : { valor: 0 };
          L.CustoNovo = N(med.valor); alerta('Sem CustoUnitarioNovo: usado o custo médio das entradas (' + reais(L.CustoNovo) + ').');
        } else L.CustoNovo = isFinite(custo) ? custo : 0;
        L.LocalNovo = locN; L.CustoAtual = 0; L.LocalAtual = '';
      }
      out.push(L);
    }
    return out;
  }
  function resumoValidacao(ls) {
    var c = { OK: 0, AVISO: 0, ERRO: 0, IGNORADA: 0 }, dv = 0;
    ls.forEach(function (l) { c[l.Status] = (c[l.Status] || 0) + 1; if (l.Status === 'OK' || l.Status === 'AVISO') dv += (N(l.SaldoNovo) * N(l.CustoNovo)) - (N(l.SaldoAtual) * N(l.CustoAtual)); });
    c.Aplicar = c.OK + c.AVISO; c.DiferencaValor = dv; return c;
  }
  function inventarioModulo() {
    garantirEstilo(); setCurrent('inventario_estoque'); marcarNav('inventario_estoque');
    normalizar();
    cabecalho('Inventário de estoque', 'Template para inventário geral: corrige saldos, custos e localização dos lotes, com validação antes de gravar e reversão dos dados anteriores.');
    el('content').innerHTML = '<div class="toolbar"><button class="secondary" onclick="estoqueModuleV4047()">← Estoque / Rastreabilidade</button><button class="secondary" onclick="render(\'locais_estoque\')">Locais de estoque</button></div>' +
      '<div class="mbc-card"><h3>1. Baixar o template</h3><p class="muted">Planilha .xlsx com uma linha por entrada/lote, com o saldo e o custo unitário atuais. Preencha só as colunas amarelas (SaldoContado, CustoUnitarioNovo, LocalizacaoNova).</p>' +
      '<div class="form-actions" style="align-items:center"><button onclick="mesInventarioTemplate()">Baixar template do inventário (.xlsx)</button><label class="mbc-inline"><input type="checkbox" id="mbc_inv_zero"> incluir lotes esgotados</label></div></div>' +
      '<div class="mbc-card"><h3>2. Enviar a planilha preenchida e validar</h3><div class="form-actions" style="align-items:center"><input type="file" id="mbc_inv_file" accept=".xlsx,.csv"><button onclick="mesInventarioValidar()">Validar planilha</button></div>' +
      '<div id="mbc_inv_valid"></div></div>' +
      '<div class="mbc-card"><h3>3. Histórico de inventários</h3><p class="muted">Cada inventário guarda os valores anteriores de cada lote. <b>Reverter</b> devolve os saldos, custos e locais anteriores; <b>Reaplicar</b> aplica de novo um inventário revertido; <b>Excluir</b> apaga o registro de um inventário revertido.</p><div id="mbc_inv_hist"></div></div>';
    renderHistoricoInventario();
  }
  var validacaoAtual = null;
  window.mesInventarioValidar = async function () {
    var f = el('mbc_inv_file') && el('mbc_inv_file').files[0];
    if (!f) return alert('Selecione a planilha do inventário (.xlsx ou .csv).');
    var box = el('mbc_inv_valid');
    try {
      var linhas = await XL.ler(f, 'inventario');
      var ls = validarInventario(linhas), r = resumoValidacao(ls);
      validacaoAtual = { arquivo: f.name, linhas: ls, resumo: r };
      var cls = function (s) { return s === 'ERRO' ? 'erro' : (s === 'AVISO' ? 'alerta' : (s === 'IGNORADA' ? '' : 'ok')); };
      var mostrar = ls.filter(function (l) { return l.Status !== 'IGNORADA'; });
      box.innerHTML = '<div class="mbc-kpis" style="margin-top:10px"><div><small>Linhas a aplicar</small><b>' + r.Aplicar + '</b></div><div><small>Com aviso</small><b>' + r.AVISO + '</b></div><div><small>Com erro</small><b style="color:' + (r.ERRO ? '#a00e1c' : 'inherit') + '">' + r.ERRO + '</b></div><div><small>Sem alteração</small><b>' + r.IGNORADA + '</b></div><div><small>Diferença de valor em estoque</small><b>' + reais(r.DiferencaValor) + '</b></div></div>' +
        (r.ERRO ? '<p class="mbc-msg erro">Corrija as linhas com erro na planilha e valide de novo. Nada foi gravado.</p>' : (r.Aplicar ? '<div class="form-actions"><button onclick="mesInventarioAplicar()">Aplicar inventário (' + r.Aplicar + ' linha(s))</button><span class="muted">Uma cópia de segurança do banco é criada antes.</span></div>' : '<p class="muted">Nenhuma alteração a aplicar.</p>')) +
        '<div class="table-wrap"><table><thead><tr><th>Linha</th><th>Status</th><th>Tipo</th><th>Entrada</th><th>Código</th><th>Material</th><th>Lote</th><th>UM</th><th>Saldo MES</th><th>Saldo novo</th><th>Diferença</th><th>Custo unit. MES</th><th>Custo unit. novo</th><th>Local MES</th><th>Local novo</th><th>Mensagens</th></tr></thead><tbody>' +
        (mostrar.map(function (l) {
          return '<tr><td>' + l.Linha + '</td><td><span class="mbc-tag ' + cls(l.Status) + '">' + l.Status + '</span></td><td>' + esc(l.Tipo || '') + '</td><td>' + esc(l.Entrada || '(nova)') + '</td><td>' + esc(l.CodigoMaterial) + '</td><td>' + esc(l.Material || '') + '</td><td>' + esc(l.Lote) + '</td><td>' + esc(l.UM || '') + '</td>' +
            '<td class="mbc-num">' + f4(l.SaldoAtual) + '</td><td class="mbc-num"><b>' + f4(l.SaldoNovo) + '</b></td><td class="mbc-num">' + (l.Delta ? (l.Delta > 0 ? '+' : '') + f4(l.Delta) : '0') + '</td><td class="mbc-num">' + reais(l.CustoAtual) + '</td><td class="mbc-num">' + reais(l.CustoNovo) + '</td>' +
            '<td>' + esc(l.LocalAtual || '') + '</td><td>' + esc(l.LocalNovo || '') + '</td><td>' + esc(l.Mensagens.join(' ')) + '</td></tr>';
        }).join('') || '<tr><td colspan="16">Nenhuma linha preenchida na planilha.</td></tr>') + '</tbody></table></div>';
    } catch (e) {
      validacaoAtual = null;
      box.innerHTML = '<p class="mbc-msg erro">Não foi possível ler a planilha: ' + esc(e && e.message ? e.message : e) + '</p>';
    }
  };
  function snapshotEntrada(e) { return { QtdAdquirida: e.QtdAdquirida, 'Custo R$': e['Custo R$'], 'ValorUnitario (R$/UM)': e['ValorUnitario (R$/UM)'], Localizacao: e.Localizacao === undefined ? null : e.Localizacao }; }
  function restaurarSnapshot(e, s) {
    ['QtdAdquirida', 'Custo R$', 'ValorUnitario (R$/UM)'].forEach(function (k) { if (s[k] === undefined) delete e[k]; else e[k] = s[k]; });
    if (s.Localizacao === null || s.Localizacao === undefined) delete e.Localizacao; else e.Localizacao = s.Localizacao;
  }
  function iguais(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  /* aplica as linhas (OK/AVISO) sobre o estado atual; devolve as linhas gravadas com antes/depois */
  function aplicarLinhas(inv, linhas) {
    var d = D(), ctx = contextoEstoque(), gravadas = [];
    linhas.forEach(function (l) {
      if (l.Status !== 'OK' && l.Status !== 'AVISO') return;
      if (l.Tipo === 'NOVO LOTE') {
        var m = materialPorCodigo(l.CodigoMaterial) || {};
        var id = typeof nextByPrefix === 'function' ? nextByPrefix(d.entradas, 'Entrada', 'EN') : 'EN' + Date.now();
        var qtd = arred(l.SaldoNovo, 6), unit = arred(l.CustoNovo, 6);
        var e = { 'Entrada': id, 'CódigoMaterial': m['CódigoMaterial'] || l.CodigoMaterial, 'DescricaoMaterial': m.DescricaoMateriais || l.Material || '', 'QtdAdquirida': String(qtd), 'UnidadeMedida': m.UM || l.UM || '',
          'Custo R$': String(arred(qtd * unit, 6)), 'ValorUnitario (R$/UM)': String(unit), 'Lote': l.Lote || ('INV-' + inv.IdInventario), 'NomeFornecedor': 'INVENTÁRIO', 'CNPJFornecedor': '', 'N° NF': '',
          MaterialQualificado: 'Não', ArquivosQualificacao: [], DataCadatro: hoje(), Localizacao: l.LocalNovo || '', OrigemEntrada: 'INVENTARIO', InventarioID: inv.IdInventario,
          EspecificacaoItem: 'Entrada criada pelo inventário ' + inv.IdInventario + (l.Observacao ? ' — ' + l.Observacao : '') };
        if (e.Localizacao) e.LocalizacaoHistorico = [{ Data: agora(), Local: e.Localizacao, Usuario: usuario(), Origem: 'Inventário ' + inv.IdInventario }];
        d.entradas.unshift(e);
        gravadas.push({ Linha: l.Linha, Tipo: 'NOVO LOTE', Entrada: id, CodigoMaterial: e['CódigoMaterial'], Material: e.DescricaoMaterial, Lote: e.Lote, UM: e.UnidadeMedida, SaldoAntes: 0, SaldoDepois: qtd, Delta: qtd, CustoAntes: 0, CustoDepois: unit, LocalAntes: '', LocalDepois: e.Localizacao, Observacao: l.Observacao || '', Antes: null, Depois: snapshotEntrada(e) });
        return;
      }
      var en = A(d.entradas).find(function (x) { return x.Entrada === l.Entrada; }); if (!en) return;
      var u = usoEntrada(en, ctx), saldoAntes = arred(N(en.QtdAdquirida) - u.used - u.loss - u.extras, 6), antes = snapshotEntrada(en);
      var saldoNovo = arred(saldoAntes + N(l.Delta), 6); if (saldoNovo < 0) saldoNovo = 0;
      var qtdNova = arred(saldoNovo + u.used + u.loss + u.extras, 6), unitAntes = N(en['ValorUnitario (R$/UM)']), unit = (l.CustoUnitarioNovo !== null && l.CustoUnitarioNovo !== undefined && isFinite(l.CustoUnitarioNovo)) ? arred(l.CustoUnitarioNovo, 6) : unitAntes;
      var mudouQtd = Math.abs(qtdNova - N(en.QtdAdquirida)) > 1e-12, mudouCusto = Math.abs(unit - unitAntes) > 1e-12;
      if (mudouQtd) { if (en.QtdAdquiridaOriginal === undefined) en.QtdAdquiridaOriginal = en.QtdAdquirida; en.QtdAdquirida = String(qtdNova); }
      if (mudouQtd || mudouCusto) { en['ValorUnitario (R$/UM)'] = String(unit); en['Custo R$'] = String(arred(qtdNova * unit, 6)); }
      if (l.LocalizacaoNova && l.LocalizacaoNova !== txt(en.Localizacao)) {
        en.Localizacao = l.LocalizacaoNova;
        en.LocalizacaoHistorico = A(en.LocalizacaoHistorico).concat([{ Data: agora(), Local: l.LocalizacaoNova, Usuario: usuario(), Origem: 'Inventário ' + inv.IdInventario }]);
      }
      en.AjustesInventario = A(en.AjustesInventario).concat([{ IdInventario: inv.IdInventario, Data: agora(), Usuario: usuario(), SaldoAntes: saldoAntes, SaldoDepois: saldoNovo, CustoAntes: unitAntes, CustoDepois: unit }]);
      en.UltimoInventario = inv.IdInventario;
      gravadas.push({ Linha: l.Linha, Tipo: 'AJUSTE', Entrada: en.Entrada, CodigoMaterial: en['CódigoMaterial'], Material: en.DescricaoMaterial || '', Lote: en.Lote || '', UM: en.UnidadeMedida || '',
        SaldoAntes: saldoAntes, SaldoDepois: saldoNovo, Delta: arred(saldoNovo - saldoAntes, 6), CustoAntes: unitAntes, CustoDepois: unit, CustoUnitarioNovo: l.CustoUnitarioNovo, LocalizacaoNova: l.LocalizacaoNova || '',
        LocalAntes: antes.Localizacao || '', LocalDepois: en.Localizacao || '', Observacao: l.Observacao || '', Antes: antes, Depois: snapshotEntrada(en) });
    });
    return gravadas;
  }
  function backupAntes(motivo) {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/backup', false);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send('{}');
      return x.status >= 200 && x.status < 300;
    } catch (e) { console.warn('MES LION: backup antes do inventário', e); }
    return false;
  }
  window.mesInventarioAplicar = function () {
    if (!validacaoAtual || validacaoAtual.resumo.ERRO) return alert('Valide a planilha sem erros antes de aplicar.');
    var r = validacaoAtual.resumo;
    if (!confirm('Aplicar o inventário "' + validacaoAtual.arquivo + '"?\n\n' + r.Aplicar + ' lote(s) serão ajustados (saldo, custo e/ou localização).\nDiferença de valor em estoque: ' + reais(r.DiferencaValor) + '.\n\nOs valores anteriores ficam guardados e o inventário pode ser revertido.')) return;
    normalizar();
    var bk = backupAntes();
    var d = D(), id = typeof nextByPrefix === 'function' ? nextByPrefix(d.inventarios, 'IdInventario', 'INV') : 'INV' + Date.now();
    var inv = { IdInventario: id, Data: agora(), Usuario: usuario(), Arquivo: validacaoAtual.arquivo, Status: 'APLICADO', BackupAntes: bk ? 'Sim' : 'Não', Eventos: [{ Data: agora(), Usuario: usuario(), Acao: 'APLICADO' }] };
    inv.Entradas = validacaoAtual.linhas.filter(function (l) { return l.Status === 'OK' || l.Status === 'AVISO'; }).map(function (l) {
      return { Linha: l.Linha, Tipo: l.Tipo, Entrada: l.Entrada, CodigoMaterial: l.CodigoMaterial, Material: l.Material, Lote: l.Lote, UM: l.UM, Delta: l.Delta, SaldoNovo: l.SaldoNovo, CustoUnitarioNovo: l.CustoUnitarioNovo, CustoNovo: l.CustoNovo, LocalizacaoNova: l.LocalizacaoNova, LocalNovo: l.LocalNovo, Observacao: l.Observacao, Status: 'OK' };
    });
    inv.Linhas = aplicarLinhas(inv, validacaoAtual.linhas);
    inv.Resumo = { Linhas: inv.Linhas.length, NovosLotes: inv.Linhas.filter(function (l) { return l.Tipo === 'NOVO LOTE'; }).length, DiferencaQtd: inv.Linhas.reduce(function (s, l) { return s + N(l.Delta); }, 0), DiferencaValor: inv.Linhas.reduce(function (s, l) { return s + N(l.SaldoDepois) * N(l.CustoDepois) - N(l.SaldoAntes) * N(l.CustoAntes); }, 0) };
    d.inventarios.unshift(inv);
    salvar();
    validacaoAtual = null;
    alert('Inventário ' + id + ' aplicado: ' + inv.Linhas.length + ' lote(s) ajustado(s).' + (bk ? '' : '\n\nAtenção: não foi possível criar a cópia de segurança automática (o inventário pode ser revertido pelo histórico).'));
    inventarioModulo();
  };
  window.mesInventarioReverter = function (id, semConfirmar) {
    var d = D(), inv = A(d.inventarios).find(function (x) { return x.IdInventario === id; });
    if (!inv || inv.Status !== 'APLICADO') return false;
    var conflitos = [], bloqueios = [];
    inv.Linhas.forEach(function (l) {
      var e = A(d.entradas).find(function (x) { return x.Entrada === l.Entrada; });
      if (!e) { if (l.Tipo !== 'NOVO LOTE') conflitos.push(l.Entrada + ': entrada não existe mais'); return; }
      if (l.Tipo === 'NOVO LOTE') {
        var usado = A(d.consumos_materiais).some(function (c) { return c.Entrada === l.Entrada; }) || A(d.op_materiais).some(function (m) { return m.EntradaMaterial === l.Entrada; });
        var ajustado = A(d.estoque_ajustes).some(function (a) { return a && a.Status !== 'ESTORNADO' && A(a.Lotes).some(function (x) { return x && x.Entrada === l.Entrada; }); });
        if (usado) bloqueios.push(l.Entrada + ' (lote criado pelo inventário já tem consumo apontado)');
        else if (ajustado) bloqueios.push(l.Entrada + ' (lote criado pelo inventário tem saída manual ou baixa técnica no Ajuste de Estoque; estorne o ajuste antes)');
        return;
      }
      if (!iguais(snapshotEntrada(e), l.Depois)) conflitos.push(l.Entrada + ' (alterada depois do inventário)');
    });
    if (bloqueios.length) { alert('Não é possível reverter o inventário ' + id + ':\n\n' + bloqueios.join('\n') + '\n\nExclua os consumos desses lotes antes de reverter.'); return false; }
    if (!semConfirmar) {
      var msg = 'Reverter o inventário ' + id + '?\n\nSaldo, custo e localização de ' + inv.Linhas.length + ' lote(s) voltam aos valores anteriores ao inventário; lotes criados por ele são removidos.';
      if (conflitos.length) msg += '\n\nAtenção — estes lotes foram alterados depois do inventário e também voltarão aos valores anteriores:\n' + conflitos.slice(0, 12).join('\n') + (conflitos.length > 12 ? '\n...' : '');
      if (!confirm(msg)) return false;
    }
    backupAntes();
    inv.Linhas.slice().reverse().forEach(function (l) {
      var i = A(d.entradas).findIndex(function (x) { return x.Entrada === l.Entrada; });
      if (i < 0) return;
      var e = d.entradas[i];
      if (l.Tipo === 'NOVO LOTE') { d.entradas.splice(i, 1); return; }
      restaurarSnapshot(e, l.Antes || {});
      e.AjustesInventario = A(e.AjustesInventario).filter(function (a) { return a.IdInventario !== id; });
      if (!e.AjustesInventario.length) { delete e.AjustesInventario; if (e.QtdAdquiridaOriginal !== undefined && String(e.QtdAdquiridaOriginal) === String(e.QtdAdquirida)) delete e.QtdAdquiridaOriginal; }
      if (e.UltimoInventario === id) { var ult = A(e.AjustesInventario).slice(-1)[0]; if (ult) e.UltimoInventario = ult.IdInventario; else delete e.UltimoInventario; }
      if (l.LocalDepois !== l.LocalAntes) e.LocalizacaoHistorico = A(e.LocalizacaoHistorico).concat([{ Data: agora(), Local: e.Localizacao || '', Usuario: usuario(), Origem: 'Reversão do inventário ' + id }]);
    });
    inv.Status = 'REVERTIDO'; inv.DataReversao = agora(); inv.UsuarioReversao = usuario();
    inv.Eventos = A(inv.Eventos).concat([{ Data: agora(), Usuario: usuario(), Acao: 'REVERTIDO' + (conflitos.length ? ' (' + conflitos.length + ' lote(s) alterados depois)' : '') }]);
    salvar();
    if (current === 'inventario_estoque') inventarioModulo();
    return true;
  };
  window.mesInventarioReaplicar = function (id) {
    var d = D(), inv = A(d.inventarios).find(function (x) { return x.IdInventario === id; });
    if (!inv || inv.Status !== 'REVERTIDO') return;
    if (!confirm('Reaplicar o inventário ' + id + '?\n\nAs diferenças contadas, os custos e as localizações deste inventário são aplicados de novo sobre o saldo atual.')) return;
    var ls = A(inv.Entradas).map(function (l) {
      var c = Object.assign({}, l, { Status: 'OK' });
      if (l.Tipo !== 'NOVO LOTE' && !A(d.entradas).some(function (e) { return e.Entrada === l.Entrada; })) c.Status = 'ERRO';
      return c;
    });
    var faltam = ls.filter(function (l) { return l.Status === 'ERRO'; });
    if (faltam.length && !confirm(faltam.length + ' entrada(s) deste inventário não existem mais e serão ignoradas. Continuar?')) return;
    backupAntes();
    inv.Linhas = aplicarLinhas(inv, ls);
    inv.Status = 'APLICADO'; inv.DataReaplicacao = agora();
    inv.Eventos = A(inv.Eventos).concat([{ Data: agora(), Usuario: usuario(), Acao: 'REAPLICADO' }]);
    salvar(); inventarioModulo();
  };
  window.mesInventarioExcluir = function (id) {
    var d = D(), inv = A(d.inventarios).find(function (x) { return x.IdInventario === id; }); if (!inv) return;
    if (inv.Status === 'APLICADO') {
      if (!confirm('O inventário ' + id + ' está aplicado. Para excluir, ele precisa ser revertido primeiro (os dados voltam aos valores anteriores). Reverter e excluir?')) return;
      if (!window.mesInventarioReverter(id, true)) return;
    } else if (!confirm('Excluir o registro do inventário ' + id + '? Esta ação não altera o estoque.')) return;
    d.inventarios = A(d.inventarios).filter(function (x) { return x.IdInventario !== id; });
    salvar(); inventarioModulo();
  };
  window.mesInventarioDetalhe = function (id) {
    var inv = A(D().inventarios).find(function (x) { return x.IdInventario === id; }); if (!inv) return;
    var b = el('mbc_inv_det_' + id); if (!b) return;
    if (b.innerHTML) { b.innerHTML = ''; return; }
    b.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Entrada</th><th>Código</th><th>Material</th><th>Lote</th><th>UM</th><th>Saldo antes</th><th>Saldo depois</th><th>Diferença</th><th>Custo antes</th><th>Custo depois</th><th>Local antes</th><th>Local depois</th><th>Obs.</th></tr></thead><tbody>' +
      A(inv.Linhas).map(function (l) {
        return '<tr><td>' + esc(l.Tipo) + '</td><td>' + esc(l.Entrada) + '</td><td>' + esc(l.CodigoMaterial) + '</td><td>' + esc(l.Material) + '</td><td>' + esc(l.Lote) + '</td><td>' + esc(l.UM) + '</td><td class="mbc-num">' + f4(l.SaldoAntes) + '</td><td class="mbc-num">' + f4(l.SaldoDepois) + '</td><td class="mbc-num">' + f4(l.Delta) + '</td><td class="mbc-num">' + reais(l.CustoAntes) + '</td><td class="mbc-num">' + reais(l.CustoDepois) + '</td><td>' + esc(l.LocalAntes) + '</td><td>' + esc(l.LocalDepois) + '</td><td>' + esc(l.Observacao) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="muted">' + A(inv.Eventos).map(function (e) { return esc(e.Data + ' · ' + e.Acao + ' · ' + e.Usuario); }).join('<br>') + '</p>';
  };
  window.mesInventarioExportar = function (id) {
    var inv = A(D().inventarios).find(function (x) { return x.IdInventario === id; }); if (!inv) return;
    var cab = ['Tipo', 'Entrada', 'CodigoMaterial', 'Material', 'Lote', 'UM', 'SaldoAntes', 'SaldoDepois', 'Delta', 'CustoAntes', 'CustoDepois', 'LocalAntes', 'LocalDepois', 'Observacao'];
    var rows = [{ c: cab, s: 1 }].concat(A(inv.Linhas).map(function (l) { return { c: cab.map(function (k) { var v = l[k]; return typeof v === 'number' ? arred(v, 6) : (v == null ? '' : String(v)); }) }; }));
    baixar('INVENTARIO_' + id + '.xlsx', XL.gerar([{ nome: id, xml: XL.folha(rows, { larguras: [11, 11, 15, 34, 14, 7, 13, 13, 12, 13, 13, 22, 22, 30], congelar: true, ativa: true }) }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  function renderHistoricoInventario() {
    var b = el('mbc_inv_hist'); if (!b) return;
    var invs = A(D().inventarios);
    b.innerHTML = invs.length ? '<div class="table-wrap"><table><thead><tr><th>Inventário</th><th>Data</th><th>Usuário</th><th>Arquivo</th><th>Lotes</th><th>Novos lotes</th><th>Diferença de valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>' +
      invs.map(function (inv) {
        var r = inv.Resumo || {}, st = inv.Status === 'APLICADO' ? 'ok' : 'alerta';
        return '<tr><td><b>' + esc(inv.IdInventario) + '</b></td><td>' + esc(inv.Data) + '</td><td>' + esc(inv.Usuario) + '</td><td>' + esc(inv.Arquivo) + '</td><td class="mbc-num">' + A(inv.Linhas).length + '</td><td class="mbc-num">' + (r.NovosLotes || 0) + '</td><td class="mbc-num">' + reais(r.DiferencaValor || 0) + '</td>' +
          '<td><span class="mbc-tag ' + st + '">' + esc(inv.Status) + '</span>' + (inv.DataReversao && inv.Status === 'REVERTIDO' ? '<br><small class="muted">' + esc(inv.DataReversao) + '</small>' : '') + '</td><td style="white-space:nowrap">' +
          '<button class="mini secondary" onclick="mesInventarioDetalhe(\'' + jsStr(inv.IdInventario) + '\')">Detalhes</button> <button class="mini secondary" onclick="mesInventarioExportar(\'' + jsStr(inv.IdInventario) + '\')">Excel</button> ' +
          (inv.Status === 'APLICADO' ? '<button class="mini" onclick="mesInventarioReverter(\'' + jsStr(inv.IdInventario) + '\')">Reverter</button> ' : '<button class="mini" onclick="mesInventarioReaplicar(\'' + jsStr(inv.IdInventario) + '\')">Reaplicar</button> ') +
          '<button class="mini danger" onclick="mesInventarioExcluir(\'' + jsStr(inv.IdInventario) + '\')">Excluir</button></td></tr>' +
          '<tr><td colspan="9" style="padding:0;border:0"><div id="mbc_inv_det_' + esc(inv.IdInventario) + '"></div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">Nenhum inventário aplicado ainda.</p>';
  }

  /* ---------------------------------------------------------------------
     9) APONTAMENTO — BUSCAR OP PELO CÓDIGO E LER O MATERIAL NO LANÇAMENTO DE LOTES
     --------------------------------------------------------------------- */
  function opPorCodigoLido(raw) {
    var k = chaveCodigo(raw); if (!k) return null;
    var ops = A((D() || {}).op);
    return ops.find(function (o) { return chaveCodigo(o.CodigoBarras) === k || chaveCodigo(o.CodOP) === k; }) ||
      ops.find(function (o) { return chaveCodigo(o.CodOP).replace(/[^A-Z0-9]/g, '') === k.replace(/[^A-Z0-9]/g, ''); }) || null;
  }
  window.mesOPPorCodigo = opPorCodigoLido;
  function painelLeituraOP() {
    return campoLeitura('mbc_scan_op', 'Buscar OP pelo código de barras (impresso na OP)', 'Bipe o código da OP e tecle Enter', 'mesApontamentoLerOP');
  }
  function inserirLeituraOP() {
    var c = el('content'); if (!c || el('mbc_scan_op') || !el('prod_op')) return;
    garantirEstilo();
    var div = document.createElement('div'); div.innerHTML = painelLeituraOP();
    c.insertBefore(div.firstChild, c.firstChild);
    setTimeout(function () { var i = el('mbc_scan_op'); if (i) i.focus(); }, 50);
  }
  window.mesApontamentoLerOP = function (v) {
    var op = opPorCodigoLido(v), inp = el('mbc_scan_op');
    if (!op) { bip(false); aviso('mbc_scan_op_msg', '✖ OP <b>' + esc(chaveCodigo(v)) + '</b> não encontrada.', 'erro'); if (inp) inp.select(); return; }
    var q = el('prod_q'); if (q) q.value = '';
    if (typeof filterOPSelect === 'function') { try { filterOPSelect('prod_op', ''); } catch (e) { } }
    var s = el('prod_op'); if (s) s.value = op.CodOP;
    if (typeof showProdOP === 'function') showProdOP();
    var fechada = opFechada(op);
    bip(!fechada);
    aviso('mbc_scan_op_msg', (fechada ? '⚠ ' : '✔ ') + 'OP <b>' + esc(op.CodOP) + '</b> carregada — ' + esc((op.CodigoProduto || op.Produto || '') + ' ' + (op.DescricaoProduto || '')) + ' · status ' + esc(op.Status || '') + (fechada ? ' (OP encerrada: só consulta)' : ''), fechada ? 'alerta' : 'ok');
    if (inp) inp.value = '';
    var m = el('mbc_scan_mat'); if (m && !fechada) m.focus(); else if (inp) inp.focus();
  };
  function materiaisDaOPConsumo(op) {
    return A((D() || {}).op_materiais).filter(function (m) { return m.CodOP === op.CodOP && String(m.TipoConsumo || '').toLowerCase().indexOf('pi intermedi') < 0; });
  }
  function inserirLeituraMaterial() {
    var painel = document.querySelector('.consumo-materiais-v3814');
    if (!painel || el('mbc_scan_mat')) return;
    var grid = painel.querySelector('.form-grid'); if (!grid) return;
    var div = document.createElement('div');
    div.innerHTML = campoLeitura('mbc_scan_mat', 'Ler código do material ou da etiqueta do lote', 'Bipe o código impresso na OP (material) ou a etiqueta do lote', 'mesApontamentoLerMaterial');
    painel.insertBefore(div.firstChild, grid);
  }
  window.mesApontamentoLerMaterial = function (v) {
    var op = typeof selectedOP === 'function' ? selectedOP('prod_op') : {}, inp = el('mbc_scan_mat');
    if (!op || !op.CodOP) { bip(false); return aviso('mbc_scan_mat_msg', 'Carregue a OP primeiro.', 'erro'); }
    var r = resolverCodigo(v);
    if (!r.material) { bip(false); aviso('mbc_scan_mat_msg', '✖ Código <b>' + esc(r.codigo) + '</b> não corresponde a nenhum material cadastrado.', 'erro'); if (inp) inp.select(); return; }
    var cod = r.material['CódigoMaterial'], mats = materiaisDaOPConsumo(op), i = mats.findIndex(function (m) { return m.CodigoMaterial === cod; });
    if (i < 0) {
      bip(false);
      aviso('mbc_scan_mat_msg', '✖ <b>' + esc(cod) + ' — ' + esc(r.material.DescricaoMateriais || '') + '</b> não está previsto nesta OP. Confira o material.', 'erro');
      if (inp) inp.select(); return;
    }
    var sel = el('cm_mat_v3814'); if (sel) sel.value = String(i);
    if (typeof atualizarLotesConsumoV3814 === 'function') atualizarLotesConsumoV3814();
    var lote = el('cm_lote_v3814'), loteMsg = '';
    if (r.entrada && lote) {
      if (r.entrada['CódigoMaterial'] === cod && [].some.call(lote.options, function (o) { return o.value === r.entrada.Entrada; })) { lote.value = r.entrada.Entrada; loteMsg = ' · lote <b>' + esc(r.entrada.Lote || r.entrada.Entrada) + '</b> (' + esc(r.entrada.Entrada) + ') selecionado'; }
      else loteMsg = ' · a entrada lida não está disponível para este material';
    } else if (lote) {
      var comSaldo = linhasEstoque().filter(function (l) { return l.CodigoMaterial === cod && l.Saldo > 0; });
      loteMsg = comSaldo.length ? ' · lotes com saldo: ' + comSaldo.map(function (l) { return esc((l.Lote || '-') + ' (' + l.Entrada + ': ' + f3(l.Saldo) + ' ' + l.UM + (l.Localizacao ? ' · ' + l.Localizacao : '') + ')'); }).join('; ') + '. Selecione o lote.' : ' · nenhum lote com saldo em estoque.';
    }
    bip(true);
    aviso('mbc_scan_mat_msg', '✔ <b>' + esc(cod) + '</b> — ' + esc(r.material.DescricaoMateriais || '') + ' (previsto ' + f4(mats[i].QtdPlanejada || mats[i].QtdBase) + ' ' + esc(mats[i].UM || '') + ')' + loteMsg, 'ok');
    if (inp) inp.value = '';
    var foco = (r.entrada && lote && lote.value) ? el('cm_ret_v3814') : lote;
    if (foco) foco.focus();
  };
  (function () {
    var showAnt = window.showProdOP;
    if (typeof showAnt !== 'function') return;
    window.showProdOP = function () {
      var msgOP = el('mbc_scan_op_msg') ? el('mbc_scan_op_msg').outerHTML : '';
      var r = showAnt.apply(this, arguments);
      try { garantirEstilo(); inserirLeituraOP(); inserirLeituraMaterial(); } catch (e) { console.warn('MES LION: leitura no apontamento', e); }
      return r;
    };
    var regAnt = window.registrarConsumoMaterialV3814;
    if (typeof regAnt === 'function') {
      window.registrarConsumoMaterialV3814 = function () {
        /* 1.6.1: consumo maior que o saldo do lote é permitido, mas só depois de confirmar o aviso; o registro fica
           marcado (AcimaDoSaldo = Sim, saldo do lote antes) e o lote aparece como NEGATIVO. */
        var chk = null;
        try { chk = conferirSaldoDoConsumo(); } catch (e) { chk = null; }
        if (chk && chk.acima && !confirm(chk.mensagem)) return;
        var antes = A((D() || {}).consumos_materiais).length;
        var r = regAnt.apply(this, arguments);
        try {
          var lst = A((D() || {}).consumos_materiais), novo = lst.length > antes ? lst[lst.length - 1] : null;
          if (chk && chk.acima && novo && txt(novo.Entrada) === chk.entrada && txt(novo.CodigoMaterial) === chk.material) {
            novo.AcimaDoSaldo = 'Sim'; novo.SaldoLoteAntes = String(arred(chk.saldo)); novo.UMLote = chk.umLote;
            novo.Observacoes = txt(novo.Observacoes) + (txt(novo.Observacoes) ? ' | ' : '') + 'Consumo acima do saldo do lote (saldo antes: ' + f4(chk.saldo) + ' ' + chk.umLote + '), confirmado por ' + usuario() + ' em ' + agora() + '.';
            salvar();
          }
        } catch (e) { console.warn('MES LION 1.6.1: consumo acima do saldo', e); }
        setTimeout(function () { var m = el('mbc_scan_mat'); if (m) m.focus(); }, 30);
        return r;
      };
    }
  })();

  /* ---------------------------------------------------------------------
     10) OP IMPRESSA COM CÓDIGO DE BARRAS (da OP e de cada material)
     --------------------------------------------------------------------- */
  (function () {
    var pagAnt = window.opProductionPage;
    if (typeof pagAnt === 'function') {
      window.opProductionPage = function (op) {
        var html = pagAnt.apply(this, arguments);
        try {
          if (op && op.CodOP && typeof html === 'string' && html.indexOf('mbc-op-print-code') < 0) {
            if (!op.CodigoBarras) op.CodigoBarras = String(op.CodOP);
            var bloco = '<div class="mbc-op-print-code" style="display:flex;justify-content:space-between;align-items:center;gap:6mm;margin:1mm 0 2mm;padding:2mm 3mm;border:1px solid #cdd9e3;border-radius:2mm">' +
              '<div style="font-size:9pt;color:#355566;line-height:1.35"><b style="color:#004b87">Código de barras da OP</b><br>Leia na tela Apontamento Produção para abrir esta OP.<br>Materiais: leia o código abaixo de cada material ao lançar o lote.</div>' +
              barcodeSvg(op.CodigoBarras || op.CodOP, { modulo: 0.3, altura: 11, fonte: 2.8 }) + '</div>';
            var i = html.indexOf('<table class="op-head"');
            html = i >= 0 ? html.slice(0, i) + bloco + html.slice(i) : bloco + html;
            /* código de barras abaixo do código de cada material (primeira coluna das tabelas de materiais) */
            var cache = {};
            html = html.replace(/<tr><td>([^<]{1,60})<\/td>/g, function (all, c) {
              var cod = c.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
              if (!materialPorCodigo(cod)) return all;
              if (!cache[cod]) cache[cod] = barcodeSvg(codigoBarrasDoMaterial(cod), { modulo: 0.22, altura: 6, texto: false });
              return '<tr><td style="white-space:nowrap">' + c + '<div style="margin-top:1mm">' + cache[cod] + '</div></td>';
            });
          }
        } catch (e) { console.warn('MES LION: código de barras na OP', e); }
        return html;
      };
    }
    var showOPAnt = window.showOP;
    if (typeof showOPAnt === 'function') {
      window.showOP = function () {
        var r = showOPAnt.apply(this, arguments);
        try {
          var cod = el('selOp') && el('selOp').value, op = cod && opPorCodigoLido(cod), det = el('opDet');
          if (op && det && !det.querySelector('.mbc-op-card')) {
            garantirEstilo();
            if (!op.CodigoBarras) { op.CodigoBarras = String(op.CodOP); }
            var div = document.createElement('div'); div.className = 'mbc-card mbc-op-card';
            div.innerHTML = '<h3>Código de barras da OP</h3><div class="mbc-op-code">' + barcodeSvg(op.CodigoBarras, { modulo: 0.33, altura: 12 }) +
              '<p class="muted" style="max-width:520px">Gerado com a OP e impresso no "PDF OP Produção". No Apontamento Produção, leia este código para abrir a OP sem procurar na lista.</p></div>';
            det.insertBefore(div, det.firstChild);
          }
        } catch (e) { console.warn('MES LION: código da OP', e); }
        return r;
      };
    }
  })();

  /* ---------------------------------------------------------------------
     11) PASSAPORTE — CONSULTA PELA LEITURA DA ETIQUETA E CÓDIGO DE BARRAS NA ETIQUETA
     --------------------------------------------------------------------- */
  function candidatosPassaporte(raw) {
    var s = txt(raw), c = [s];
    try {
      if (/^https?:\/\//i.test(s) || /[#?\/]/.test(s)) {
        var u = new URL(s, location.href);
        var h = (u.hash || '').replace(/^#/, ''), hp = new URLSearchParams(h.indexOf('=') >= 0 ? h : '');
        ['bp', 'id', 'passaporte'].forEach(function (k) { if (hp.get(k)) c.push(hp.get(k)); if (u.searchParams.get(k)) c.push(u.searchParams.get(k)); });
        var m = u.pathname.match(/\/passaporte\/([^\/?#]+)/i); if (m) c.push(decodeURIComponent(m[1]).replace(/\.html?$/i, ''));
        var ult = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '').replace(/\.html?$/i, ''); if (ult) c.push(ult);
      }
    } catch (e) { }
    return c.map(chaveCodigo).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }
  function buscarPassaportes(raw) {
    var cs = candidatosPassaporte(raw), s = txt(raw), bps = A((D() || {}).bp);
    var campos = ['BatteryPassportID', 'BatteryPassportGUID', 'IDLote', 'NumeroSerie', 'NumeroDeSerie', 'DataMatrixHash', 'CodOrdemProducao'];
    var achados = bps.filter(function (b) {
      if (!b) return false;
      if (b.URLPassaporteWeb && txt(b.URLPassaporteWeb) === s) return true;
      if (b.URLDashboardPublicado && txt(b.URLDashboardPublicado) === s) return true;
      return campos.some(function (k) { var v = chaveCodigo(b[k]); return v && cs.indexOf(v) >= 0; }) ||
        cs.some(function (c) { return chaveCodigo(b.BatteryPassportID).replace(/[^A-Z0-9_-]/g, '') === c.replace(/[^A-Z0-9_-]/g, ''); });
    });
    if (!achados.length) {
      var op = null; cs.some(function (c) { op = opPorCodigoLido(c); return !!op; });
      if (op) {
        var raiz = String(op.OP_Base || op.CodOP).replace(/-[^-]+$/, '');
        achados = bps.filter(function (b) { return String(b.CodOrdemProducao || '') === op.CodOP || (raiz && String(b.CodOrdemProducao || '').indexOf(raiz) === 0); });
      }
    }
    return achados;
  }
  window.mesBuscarPassaportes = buscarPassaportes;
  window.mesPassaporteLer = function (v) {
    var achados = buscarPassaportes(v), inp = el('mbc_scan_bp');
    if (!achados.length) { bip(false); aviso('mbc_scan_bp_msg', '✖ Nenhum passaporte encontrado para <b>' + esc(txt(v).slice(0, 120)) + '</b>. A leitura aceita o QR/código da etiqueta, o ID do passaporte, o identificador global, o lote ou a OP.', 'erro'); if (inp) inp.select(); return; }
    bip(true);
    var abrir = function (b) {
      var s = el('bp_sel'); if (s) s.value = b.BatteryPassportID;
      if (typeof showBP === 'function') showBP();
      var det = el('bpDet'); if (det) det.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    abrir(achados[0]);
    aviso('mbc_scan_bp_msg', '✔ Passaporte <b>' + esc(achados[0].BatteryPassportID) + '</b> — ' + esc(achados[0].CodProduto || '') + ' · OP ' + esc(achados[0].CodOrdemProducao || '-') + ' · lote ' + esc(achados[0].IDLote || '-') + ' · status ' + esc(achados[0].StatusPassaporte || '-') +
      (achados.length > 1 ? '<br>Outros passaportes para este código: ' + achados.slice(1).map(function (b) { return '<a href="#" onclick="event.preventDefault();document.getElementById(\'bp_sel\').value=\'' + jsStr(b.BatteryPassportID) + '\';showBP();">' + esc(b.BatteryPassportID) + '</a>'; }).join(', ') : ''), 'ok');
    if (inp) inp.value = '';
  };
  function inserirLeituraBP() {
    var c = el('content'); if (!c || el('mbc_scan_bp') || !el('bp_sel')) return;
    garantirEstilo();
    var div = document.createElement('div');
    div.innerHTML = campoLeitura('mbc_scan_bp', 'Consultar passaporte pela etiqueta (QR Code ou código de barras)', 'Leia a etiqueta do cliente, ou digite o ID do passaporte, lote ou OP', 'mesPassaporteLer');
    c.insertBefore(div.firstChild, c.firstChild);
  }
  (function () {
    var etqAnt = window.printBPProductLabel;
    if (typeof etqAnt !== 'function') return;
    window.printBPProductLabel = async function () {
      var openAnt = window.open, janela = null;
      window.open = function () { janela = openAnt.apply(window, arguments); return janela; };
      var r;
      try { r = etqAnt.apply(this, arguments); } finally { window.open = openAnt; }
      try { await r; } catch (e) { }
      try {
        var sel = el('bp_sel'), bp = A(D().bp).find(function (b) { return b.BatteryPassportID === (sel && sel.value); });
        var doc = janela && !janela.closed && janela.document, foot = doc && doc.querySelector('.foot');
        if (bp && foot && !doc.querySelector('.mbc-bp-code')) {
          var sec = doc.createElement('section'); sec.className = 'mbc-bp-code';
          sec.setAttribute('style', 'text-align:center;padding:1mm 0 1.5mm');
          sec.innerHTML = barcodeSvg(bp.BatteryPassportID, { modulo: 0.3, altura: 6, fonte: 2.2 });
          foot.parentNode.insertBefore(sec, foot);
          doc.head.insertAdjacentHTML('beforeend', '<style>.qrwrap img{width:41mm!important;height:41mm!important}.qrwrap{padding-top:1mm!important;min-height:0}.qrwrap span{margin-top:1mm!important}</style>');
        }
      } catch (e) { console.warn('MES LION: código de barras na etiqueta do passaporte', e); }
      return r;
    };
  })();

  /* ---------------------------------------------------------------------
     12) RECURSOS / MÁQUINAS — TELA ÚNICA
     "Recursos / Custos" (data.recursos: tempos, pessoas, taxas e custos) e "Cadastro de Recursos" (data.cad_recursos:
     patrimônio, capacidade, ativo) passam a ser editados numa só tela. As duas coleções continuam existindo porque
     o PCP, o roteiro, a OP, os custos e a capacidade leem uma ou outra; esta tela grava as duas juntas (cada linha de
     Recursos / Custos tem a sua linha espelho no Cadastro, ligadas pelo campo IdRecurso).
     --------------------------------------------------------------------- */
  var CAMPOS_EQUIP = ['Equipamento', 'PotenciaEquipamento (W)', 'NumeroPatrimonio', 'NumeroNF', 'ValorEquipamento', 'FatorDepreciacao', 'Fator dolar', 'Impostos', 'Capacidade', 'Unidade Capacidade'];
  function codRec(r) { return txt(r && (r.CodEquipamento != null && r.CodEquipamento !== '' ? r.CodEquipamento : r['Código Equipamento'])); }
  function novoIdRecurso() { return 'RC' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }
  function proximoCodigoRecurso() {
    var d = D(), ns = A(d.recursos).concat(A(d.cad_recursos)).map(function (r) { return N(codRec(r)); }).filter(function (n) { return n > 0; });
    return String((ns.length ? Math.max.apply(null, ns) : 0) + 1);
  }
  function espelhoCad(r) {
    return { 'Código Equipamento': codRec(r), Equipamento: r.Equipamento || '', Processo: r.Processo || '', SubProcesso: r.SubProcesso || '', 'PotenciaEquipamento (W)': r['PotenciaEquipamento (W)'] || '',
      Ativo: 'Sim', Escala: r.Escala || '', NumeroPatrimonio: '', NumeroNF: '', ValorEquipamento: '', FatorDepreciacao: '', Capacidade: '', 'Unidade Capacidade': '', 'Fator dolar': '', Impostos: '', 'Modelo Celula': r.IdCelula || '' };
  }
  function espelhoRec(c) {
    return { CodEquipamento: codRec(c), Equipamento: c.Equipamento || '', 'PotenciaEquipamento (W)': c['PotenciaEquipamento (W)'] || '', Processo: c.Processo || '', SubProcesso: c.SubProcesso || '',
      'TempoOperação (min)': '', NPessoas: '', 'TaxaEnergia (R$/kWh)': '', 'TaxaMOD (R$/h)': '', CustoEnergia: '', CustoMOD: '', Escala: c.Escala || '', IdCelula: c['Modelo Celula'] || '' };
  }
  /* Liga cada linha de recursos à sua linha do cadastro (mesmo código + processo + subprocesso; depois código + processo).
     Linhas que só existem de um lado ganham o espelho no fim da lista (não muda a ordem das existentes). */
  function sincronizarRecursos() {
    var d = D(); if (!d) return { criadosCad: 0, criadosRec: 0 };
    var R = d.recursos = A(d.recursos), C = d.cad_recursos = A(d.cad_recursos), criadosCad = 0, criadosRec = 0;
    var porId = {}, ligado = [];
    R.forEach(function (r) { if (!r) return; if (r.IdRecurso && porId[r.IdRecurso]) r.IdRecurso = ''; if (r.IdRecurso) porId[r.IdRecurso] = r; });
    var cadDoId = {};
    C.forEach(function (c, j) {
      if (!c || !c.IdRecurso) return;
      if (porId[c.IdRecurso] && cadDoId[c.IdRecurso] === undefined) { cadDoId[c.IdRecurso] = j; ligado[j] = true; }
      else c.IdRecurso = '';
    });
    R.forEach(function (r) {
      if (!r || (r.IdRecurso && cadDoId[r.IdRecurso] !== undefined)) return;
      var achar = function (exato) {
        return C.findIndex(function (c, j) { return c && !ligado[j] && codRec(c) === codRec(r) && chave(c.Processo) === chave(r.Processo) && (!exato || chave(c.SubProcesso) === chave(r.SubProcesso)); });
      };
      var j = achar(true); if (j < 0) j = achar(false);
      if (!r.IdRecurso) r.IdRecurso = novoIdRecurso();
      if (j >= 0) { C[j].IdRecurso = r.IdRecurso; ligado[j] = true; cadDoId[r.IdRecurso] = j; return; }
      var novo = espelhoCad(r); novo.IdRecurso = r.IdRecurso; C.push(novo); ligado[C.length - 1] = true; cadDoId[r.IdRecurso] = C.length - 1; criadosCad++;
    });
    C.forEach(function (c, j) {
      if (!c || ligado[j]) return;
      c.IdRecurso = novoIdRecurso();
      var novo = espelhoRec(c); novo.IdRecurso = c.IdRecurso; R.push(novo); ligado[j] = true; criadosRec++;
    });
    return { criadosCad: criadosCad, criadosRec: criadosRec };
  }
  window.mesSincronizarRecursos = sincronizarRecursos;
  function parCad(r) { return A(D().cad_recursos).find(function (c) { return c.IdRecurso && c.IdRecurso === r.IdRecurso; }) || {}; }
  function custosRecurso(o) {
    var pot = N(o['PotenciaEquipamento (W)']), t = N(o['TempoOperação (min)'] || o.TempoOperacaoMin), te = N(o['TaxaEnergia (R$/kWh)']), tm = N(o['TaxaMOD (R$/h)']), p = N(o.NPessoas);
    return { energia: ((pot / 1000) * (t / 60) * te).toFixed(4), mod: ((t / 60) * p * tm).toFixed(4) };
  }
  function conflitosRecursos() {
    var d = D(), R = A(d.recursos), out = { codigos: [], duplicados: [], fisicos: [] };
    var porCod = {};
    R.forEach(function (r, i) { var c = codRec(r); if (!c) return; (porCod[c] = porCod[c] || []).push({ r: r, i: i }); });
    Object.keys(porCod).forEach(function (c) {
      var nomes = porCod[c].map(function (x) { return txt(x.r.Equipamento); }).filter(function (n, i, a) { return n && a.findIndex(function (y) { return chave(y) === chave(n); }) === i; });
      if (nomes.length > 1) out.codigos.push({ codigo: c, nomes: nomes });
      var vistos = {};
      porCod[c].forEach(function (x) {
        var k = chave(x.r.Processo) + '|' + chave(x.r.SubProcesso);
        if (vistos[k] !== undefined) out.duplicados.push({ codigo: c, equipamento: x.r.Equipamento, processo: x.r.Processo, subprocesso: x.r.SubProcesso, idx: [vistos[k], x.i] });
        else vistos[k] = x.i;
      });
      var porNome = {};
      porCod[c].forEach(function (x) { var k = chave(x.r.Equipamento); (porNome[k] = porNome[k] || []).push(x.r); });
      Object.keys(porNome).forEach(function (k) {
        var pots = porNome[k].map(function (r) { return txt(r['PotenciaEquipamento (W)']); }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        if (pots.length > 1) out.fisicos.push({ codigo: c, equipamento: porNome[k][0].Equipamento, potencias: pots });
      });
    });
    var porCodProc = {};
    R.forEach(function (r, i) { var k = codRec(r) + '|' + chave(r.Processo); (porCodProc[k] = porCodProc[k] || []).push(i); });
    Object.keys(porCodProc).forEach(function (k) {
      var is = porCodProc[k]; if (is.length < 2) return;
      var ja = out.duplicados.some(function (dp) { return dp.idx.every(function (x) { return is.indexOf(x) >= 0; }); });
      var subs = is.map(function (i) { return chave(R[i].SubProcesso); });
      if (!ja && subs.some(function (s) { return !s; })) out.duplicados.push({ codigo: codRec(R[is[0]]), equipamento: R[is[0]].Equipamento, processo: R[is[0]].Processo, subprocesso: '(vazio em uma das linhas)', idx: is });
    });
    return out;
  }
  function recursosModulo() {
    garantirEstilo(); normalizar();
    var s = sincronizarRecursos();
    if (s.criadosCad || s.criadosRec) salvar();
    setCurrent('cad_recursos'); marcarNav('cad_recursos');
    cabecalho('Recursos / Máquinas', 'Cadastro único dos equipamentos por processo: tempos, pessoas, potência, taxas e custos, patrimônio, capacidade e documentos.');
    var procs = A(D().processos).map(function (p) { return txt(p.Processo); }).concat(A(D().recursos).map(function (r) { return txt(r.Processo); })).filter(function (p, i, a) { return p && a.indexOf(p) === i; }).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    var codes = A(D().recursos).map(codRec).filter(function (c, i, a) { return c && a.indexOf(c) === i; }).sort(function (a, b) { return N(a) - N(b) || a.localeCompare(b); });
    el('content').innerHTML = '<div class="toolbar"><button onclick="mesRecursoEditar(-1)">+ Novo recurso</button>' +
      (typeof window.mesRecursosImportacao === 'function' ? '<button onclick="mesRecursosImportacao()">⬆ Importar planilha de equipamentos</button>' : '') +
      '<button onclick="mesRecursosRecalcular()">Recalcular custos</button>' +
      '<button onclick="reportRecursos()">PDF Custos + Gráficos</button><button class="secondary" onclick="reportTabela(\'recursos\',\'Checklist / Relatório de Recursos\')">PDF Recursos</button>' +
      (typeof window.mesCapCadastro === 'function' ? '<button class="secondary" onclick="mesCapCadastro()">Capacidades das máquinas</button><button class="secondary" onclick="mesCapRelatorio()">Carga × capacidade</button>' : '') +
      '<button class="secondary" onclick="exportSelectedExcel(\'recursos\',\'Recursos / Máquinas\')">Exportar Excel selecionados</button></div>' +
      '<div class="toolbar"><input id="mbc_rec_q" placeholder="Pesquisar código, equipamento, processo..." oninput="mesRecursosTabela()" style="min-width:260px"><select id="mbc_rec_proc" onchange="mesRecursosTabela()"><option value="">Todos os processos</option>' + procs.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('') + '</select>' +
      '<select id="eqv2" onchange="showEqDocsV2()"><option value="">Documentos da máquina...</option>' + codes.map(function (c) { var r = A(D().recursos).find(function (x) { return codRec(x) === c; }) || {}; return '<option value="' + esc(c) + '">' + esc(c + ' — ' + (r.Equipamento || '')) + '</option>'; }).join('') + '</select></div>' +
      '<div id="crudBox"></div><div id="eqdocs"></div><div id="mbc_rec_conf"></div><div id="tbl"></div>';
    renderConflitos(s);
    window.mesRecursosTabela();
  }
  function renderConflitos(s) {
    var b = el('mbc_rec_conf'); if (!b) return;
    var c = conflitosRecursos(), itens = [];
    if (s && (s.criadosCad || s.criadosRec)) itens.push('<li><span class="mbc-tag info">sincronizado</span> ' + (s.criadosCad ? s.criadosCad + ' recurso(s) que só existiam em "Recursos / Custos" ganharam a linha no cadastro. ' : '') + (s.criadosRec ? s.criadosRec + ' equipamento(s) que só existiam no "Cadastro de Recursos" ganharam a linha de tempos e custos (preencha tempo, pessoas e taxas).' : '') + '</li>');
    c.codigos.forEach(function (x) { itens.push('<li><span class="mbc-tag erro">código repetido</span> O código <b>' + esc(x.codigo) + '</b> está em equipamentos diferentes: ' + x.nomes.map(esc).join(' × ') + '. A capacidade, o calendário e os documentos são controlados por código: dê um código próprio a cada equipamento (edite a linha e troque o código, antes de usá-lo em novos roteiros).</li>'); });
    c.duplicados.forEach(function (x) { itens.push('<li><span class="mbc-tag alerta">possível duplicidade</span> <b>' + esc(x.codigo + ' — ' + (x.equipamento || '')) + '</b> em ' + esc(x.processo) + ' / ' + esc(x.subprocesso || '(sem subprocesso)') + ' aparece ' + x.idx.length + ' vezes (linhas ' + x.idx.map(function (i) { return '<a href="#" onclick="event.preventDefault();mesRecursoEditar(' + i + ')">#' + (i + 1) + '</a>'; }).join(', ') + '). Os custos usam a primeira; confira e exclua a que sobra.</li>'); });
    c.fisicos.forEach(function (x) { itens.push('<li><span class="mbc-tag alerta">dados físicos diferentes</span> <b>' + esc(x.codigo + ' — ' + x.equipamento) + '</b> tem potências diferentes entre os processos: ' + x.potencias.map(function (p) { return esc(p || 'vazio') + ' W'; }).join(' × ') + '.</li>'); });
    b.innerHTML = itens.length ? '<details class="mbc-card" ' + (c.codigos.length || c.duplicados.length ? 'open' : '') + '><summary style="cursor:pointer;font-weight:700;color:#004b87">Verificação do cadastro: ' + itens.length + ' ponto(s) para conferir</summary><ul class="mbc-conflitos">' + itens.join('') + '</ul></details>' : '<p class="muted">Cadastro verificado: sem códigos repetidos nem duplicidades.</p>';
  }
  window.mesRecursosTabela = function () {
    var b = el('tbl'); if (!b) return;
    var q = chave((el('mbc_rec_q') || {}).value || ''), pr = (el('mbc_rec_proc') || {}).value || '';
    var R = A(D().recursos);
    var cols = ['Código', 'Equipamento', 'Processo', 'Subprocesso', 'Escala', 'Ativo', 'Tempo (min)', 'Pessoas', 'Potência (W)', 'Taxa energia (R$/kWh)', 'Taxa MOD (R$/h)', 'Custo energia', 'Custo MOD', 'Capacidade', 'Patrimônio'];
    var linhas = R.map(function (r, i) { return { r: r, i: i, c: parCad(r) }; }).filter(function (x) {
      return (!pr || txt(x.r.Processo) === pr) && (!q || chave([codRec(x.r), x.r.Equipamento, x.r.Processo, x.r.SubProcesso, x.r.Escala, x.c.NumeroPatrimonio].join(' ')).indexOf(q) >= 0);
    });
    b.innerHTML = '<div class="table-wrap"><table><thead><tr><th class="sel-col"><input type="checkbox" onchange="toggleAllRows(\'recursos\',this.checked)" title="Selecionar todos"></th><th>Ações</th>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (linhas.map(function (x) {
        var r = x.r, c = x.c;
        return '<tr><td class="sel-col"><input type="checkbox" class="row-recursos" data-index="' + x.i + '"></td><td style="white-space:nowrap"><button class="mini" onclick="mesRecursoEditar(' + x.i + ')">Editar</button></td>' +
          '<td>' + esc(codRec(r)) + '</td><td>' + esc(r.Equipamento) + '</td><td>' + esc(r.Processo) + '</td><td>' + esc(r.SubProcesso) + '</td><td>' + esc(r.Escala || c.Escala || '') + '</td><td>' + esc(c.Ativo || 'Sim') + '</td>' +
          '<td class="mbc-num">' + esc(r['TempoOperação (min)'] || r.TempoOperacaoMin || '') + '</td><td class="mbc-num">' + esc(r.NPessoas || '') + '</td><td class="mbc-num">' + esc(r['PotenciaEquipamento (W)'] || c['PotenciaEquipamento (W)'] || '') + '</td>' +
          '<td class="mbc-num">' + esc(r['TaxaEnergia (R$/kWh)'] || '') + '</td><td class="mbc-num">' + esc(r['TaxaMOD (R$/h)'] || '') + '</td><td class="mbc-num">' + (r.CustoEnergia !== '' && r.CustoEnergia != null ? reais(r.CustoEnergia) : '') + '</td><td class="mbc-num">' + (r.CustoMOD !== '' && r.CustoMOD != null ? reais(r.CustoMOD) : '') + '</td>' +
          '<td>' + esc((c.Capacidade || '') + (c['Unidade Capacidade'] ? ' ' + c['Unidade Capacidade'] : '')) + '</td><td>' + esc(c.NumeroPatrimonio || '') + '</td></tr>';
      }).join('') || '<tr><td colspan="17">Nenhum recurso.</td></tr>') + '</tbody></table></div><p class="muted">' + linhas.length + ' de ' + R.length + ' recurso(s).</p>';
  };
  window.mesRecursosRecalcular = function () {
    A(D().recursos).forEach(function (r) { var k = custosRecurso(r); r.CustoEnergia = k.energia; r.CustoMOD = k.mod; });
    salvar(); window.mesRecursosTabela(); renderConflitos();
  };
  function inp(id, rot, val, extra) { return '<label><span>' + rot + '</span><input id="' + id + '" value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + '></label>'; }
  window.mesRecursoEditar = function (idx) {
    var R = A(D().recursos), r = idx >= 0 ? (R[idx] || {}) : { CodEquipamento: proximoCodigoRecurso(), Escala: 'Planta Piloto' }, c = idx >= 0 ? parCad(r) : { Ativo: 'Sim' };
    var existentes = {}; R.forEach(function (x) { var k = codRec(x) + '|' + chave(x.Equipamento); if (codRec(x) && !existentes[k]) existentes[k] = x; });
    var opExist = Object.keys(existentes).sort(function (a, b) { return N(a) - N(b) || a.localeCompare(b); }).map(function (k) { var x = existentes[k]; return '<option value="' + esc(k) + '">' + esc(codRec(x) + ' — ' + (x.Equipamento || '')) + '</option>'; }).join('');
    var escAtual = r.Escala || c.Escala || '';
    var escalas = typeof v1014EscalaOptions === 'function' ? v1014EscalaOptions(escAtual) : '';
    if (escAtual && escalas.indexOf('value="' + esc(escAtual) + '"') < 0) escalas += '<option value="' + esc(escAtual) + '" selected>' + esc(escAtual) + '</option>';
    var procs = typeof v1014ProcessoOptions === 'function' ? v1014ProcessoOptions(r.Processo || '') : '<option>' + esc(r.Processo || '') + '</option>';
    if (r.Processo && procs.indexOf('value="' + esc(r.Processo) + '"') < 0) procs += '<option value="' + esc(r.Processo) + '" selected>' + esc(r.Processo) + ' (fora do cadastro de processos)</option>';
    var outros = idx >= 0 ? R.filter(function (x, j) { return j !== idx && codRec(x) === codRec(r) && chave(x.Equipamento) === chave(r.Equipamento); }).length : 0;
    el('crudBox').innerHTML = '<div class="form edit-form"><h3>' + (idx >= 0 ? 'Editar' : 'Novo') + ' recurso</h3>' +
      (idx < 0 ? '<div class="mbc-grid" style="margin-bottom:10px"><label style="grid-column:span 2"><span>Equipamento já cadastrado em outro processo?</span><select id="mbc_rec_exist" onchange="mesRecursoUsarExistente()"><option value="">Não — equipamento novo</option>' + opExist + '</select></label></div>' : '') +
      '<fieldset class="mbc-fieldset"><legend>Identificação</legend><div class="mbc-grid">' + inp('mbc_rec_cod', 'Código do equipamento', codRec(r)) + inp('mbc_rec_nome', 'Equipamento', r.Equipamento) +
      '<label><span>Processo</span><select id="mbc_rec_procsel">' + procs + '</select></label>' + inp('mbc_rec_sub', 'Subprocesso', r.SubProcesso) +
      '<label><span>Escala</span><select id="mbc_rec_esc">' + escalas + '</select></label><label><span>Ativo</span><select id="mbc_rec_ativo"><option ' + (c.Ativo !== 'Não' ? 'selected' : '') + '>Sim</option><option ' + (c.Ativo === 'Não' ? 'selected' : '') + '>Não</option></select></label>' +
      inp('mbc_rec_cel', 'Célula / modelo', r.IdCelula || c['Modelo Celula'] || '') + '</div></fieldset>' +
      '<fieldset class="mbc-fieldset"><legend>Tempos, energia e custos da operação</legend><div class="mbc-grid">' + inp('mbc_rec_tempo', 'Tempo de operação (min)', r['TempoOperação (min)'] || r.TempoOperacaoMin || '', 'type="number" step="any" oninput="mesRecursoCalc()"') +
      inp('mbc_rec_pess', 'Nº de pessoas', r.NPessoas, 'type="number" step="any" oninput="mesRecursoCalc()"') + inp('mbc_rec_pot', 'Potência (W)', r['PotenciaEquipamento (W)'] || c['PotenciaEquipamento (W)'] || '', 'type="number" step="any" oninput="mesRecursoCalc()"') +
      inp('mbc_rec_te', 'Taxa de energia (R$/kWh)', r['TaxaEnergia (R$/kWh)'], 'oninput="mesRecursoCalc()"') + inp('mbc_rec_tm', 'Taxa MOD (R$/h)', r['TaxaMOD (R$/h)'], 'oninput="mesRecursoCalc()"') +
      inp('mbc_rec_ce', 'Custo energia (R$)', r.CustoEnergia, 'readonly') + inp('mbc_rec_cm', 'Custo MOD (R$)', r.CustoMOD, 'readonly') + '</div></fieldset>' +
      '<fieldset class="mbc-fieldset"><legend>Patrimônio e capacidade</legend><div class="mbc-grid">' + inp('mbc_rec_pat', 'Nº patrimônio', c.NumeroPatrimonio) + inp('mbc_rec_nf', 'Nº NF', c.NumeroNF) + inp('mbc_rec_val', 'Valor do equipamento', c.ValorEquipamento) +
      inp('mbc_rec_dep', 'Fator de depreciação', c.FatorDepreciacao) + inp('mbc_rec_dol', 'Fator dólar', c['Fator dolar']) + inp('mbc_rec_imp', 'Impostos', c.Impostos) +
      inp('mbc_rec_cap', 'Capacidade', c.Capacidade) + inp('mbc_rec_ucap', 'Unidade da capacidade', c['Unidade Capacidade']) + '</div>' +
      (typeof window.mesCapCadastro === 'function' ? '<p class="muted" style="margin:8px 0 0">Ciclo, setup, horas/dia, eficiência e simultaneidade ficam em <a href="#" onclick="event.preventDefault();mesCapCadastro()">Capacidades das máquinas</a>.</p>' : '') + '</fieldset>' +
      (outros ? '<div class="mbc-inline" style="margin:4px 0 10px"><input type="checkbox" id="mbc_rec_prop" checked><span>Levar as alterações de nome, código, potência, patrimônio e capacidade também para os outros ' + outros + ' processo(s) deste equipamento</span></div>' : '') +
      '<div class="form-actions"><button onclick="mesRecursoSalvar(' + idx + ')">Salvar recurso</button>' + (idx >= 0 ? '<button class="danger" onclick="mesRecursoExcluir(' + idx + ')">Excluir</button>' : '') +
      '<button class="secondary" onclick="document.getElementById(\'crudBox\').innerHTML=\'\'">Cancelar</button></div></div>';
    window.mesRecursoCalc();
    el('crudBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  window.mesRecursoCalc = function () {
    var o = { 'PotenciaEquipamento (W)': (el('mbc_rec_pot') || {}).value, 'TempoOperação (min)': (el('mbc_rec_tempo') || {}).value, 'TaxaEnergia (R$/kWh)': (el('mbc_rec_te') || {}).value, 'TaxaMOD (R$/h)': (el('mbc_rec_tm') || {}).value, NPessoas: (el('mbc_rec_pess') || {}).value };
    var k = custosRecurso(o);
    if (el('mbc_rec_ce')) el('mbc_rec_ce').value = k.energia;
    if (el('mbc_rec_cm')) el('mbc_rec_cm').value = k.mod;
  };
  window.mesRecursoUsarExistente = function () {
    var k = (el('mbc_rec_exist') || {}).value, R = A(D().recursos);
    var travar = function (on) { ['mbc_rec_cod', 'mbc_rec_nome', 'mbc_rec_pot', 'mbc_rec_pat', 'mbc_rec_nf', 'mbc_rec_val', 'mbc_rec_cap', 'mbc_rec_ucap'].forEach(function (id) { if (el(id)) el(id).readOnly = on; }); };
    if (!k) { travar(false); if (el('mbc_rec_cod')) el('mbc_rec_cod').value = proximoCodigoRecurso(); return; }
    var r = R.find(function (x) { return codRec(x) + '|' + chave(x.Equipamento) === k; }); if (!r) return;
    var c = parCad(r);
    var set = function (id, v) { if (el(id)) el(id).value = v == null ? '' : v; };
    set('mbc_rec_cod', codRec(r)); set('mbc_rec_nome', r.Equipamento); set('mbc_rec_pot', r['PotenciaEquipamento (W)'] || c['PotenciaEquipamento (W)']);
    set('mbc_rec_pat', c.NumeroPatrimonio); set('mbc_rec_nf', c.NumeroNF); set('mbc_rec_val', c.ValorEquipamento); set('mbc_rec_dep', c.FatorDepreciacao); set('mbc_rec_dol', c['Fator dolar']); set('mbc_rec_imp', c.Impostos);
    set('mbc_rec_cap', c.Capacidade); set('mbc_rec_ucap', c['Unidade Capacidade']); set('mbc_rec_te', r['TaxaEnergia (R$/kWh)']); set('mbc_rec_tm', r['TaxaMOD (R$/h)']);
    if (el('mbc_rec_esc') && r.Escala) el('mbc_rec_esc').value = r.Escala;
    travar(true); window.mesRecursoCalc();
  };
  window.mesRecursoSalvar = function (idx) {
    var g = function (id) { return txt((el(id) || {}).value); };
    var cod = g('mbc_rec_cod'), nome = g('mbc_rec_nome'), proc = g('mbc_rec_procsel');
    if (!cod) return alert('Informe o código do equipamento.');
    if (!nome) return alert('Informe o nome do equipamento.');
    if (!proc) return alert('Selecione o processo.');
    var d = D(), R = d.recursos, C = d.cad_recursos;
    var antigo = idx >= 0 ? Object.assign({}, R[idx]) : null;
    var outroNome = R.find(function (x, j) { return j !== idx && codRec(x) === cod && chave(x.Equipamento) !== chave(nome); });
    if (outroNome && !confirm('O código ' + cod + ' já é usado pelo equipamento "' + outroNome.Equipamento + '". Equipamentos diferentes com o mesmo código se misturam na capacidade, no calendário e nos documentos.\n\nSalvar mesmo assim?')) return;
    var dup = R.find(function (x, j) { return j !== idx && codRec(x) === cod && chave(x.Processo) === chave(proc) && chave(x.SubProcesso) === chave(g('mbc_rec_sub')); });
    if (dup && !confirm('Já existe o recurso ' + cod + ' em ' + proc + (g('mbc_rec_sub') ? ' / ' + g('mbc_rec_sub') : '') + '. Criar outra linha igual?')) return;
    if (antigo && codRec(antigo) !== cod) {
      var usosCod = A(d.roteiro_recursos).concat(A(d.roteiro_etapas), A(d.op_etapas), A(d.pcp_programacao)).filter(function (x) { return String(x.CodEquipamento || x.Recurso || '') === codRec(antigo); }).length;
      if (!confirm('Trocar o código ' + codRec(antigo) + ' por ' + cod + '?' + (usosCod ? '\n\nO código antigo aparece em ' + usosCod + ' registro(s) de roteiro/OP/programação, que NÃO são alterados (continuam apontando para ' + codRec(antigo) + ').' : '') + '\nA capacidade (Capacidades das máquinas) e os documentos da máquina são guardados por código.')) return;
    }
    var rec = idx >= 0 ? R[idx] : { IdRecurso: novoIdRecurso() };
    if (!rec.IdRecurso) rec.IdRecurso = novoIdRecurso();
    rec.CodEquipamento = cod; rec.Equipamento = nome; rec.Processo = proc; rec.SubProcesso = g('mbc_rec_sub');
    rec['PotenciaEquipamento (W)'] = g('mbc_rec_pot'); rec['TempoOperação (min)'] = g('mbc_rec_tempo'); rec.NPessoas = g('mbc_rec_pess');
    rec['TaxaEnergia (R$/kWh)'] = g('mbc_rec_te'); rec['TaxaMOD (R$/h)'] = g('mbc_rec_tm'); rec.Escala = g('mbc_rec_esc'); rec.IdCelula = g('mbc_rec_cel');
    var k = custosRecurso(rec); rec.CustoEnergia = k.energia; rec.CustoMOD = k.mod;
    if (idx < 0) R.push(rec);
    var cad = C.find(function (c) { return c.IdRecurso === rec.IdRecurso; });
    if (!cad) { cad = { IdRecurso: rec.IdRecurso }; C.push(cad); }
    var cadAntes = Object.assign({}, cad);
    cad['Código Equipamento'] = cod; cad.Equipamento = nome; cad.Processo = proc; cad.SubProcesso = rec.SubProcesso; cad['PotenciaEquipamento (W)'] = rec['PotenciaEquipamento (W)'];
    cad.Ativo = g('mbc_rec_ativo') || 'Sim'; cad.Escala = rec.Escala; cad.NumeroPatrimonio = g('mbc_rec_pat'); cad.NumeroNF = g('mbc_rec_nf'); cad.ValorEquipamento = g('mbc_rec_val');
    cad.FatorDepreciacao = g('mbc_rec_dep'); cad['Fator dolar'] = g('mbc_rec_dol'); cad.Impostos = g('mbc_rec_imp'); cad.Capacidade = g('mbc_rec_cap'); cad['Unidade Capacidade'] = g('mbc_rec_ucap'); cad['Modelo Celula'] = rec.IdCelula;
    if (antigo && el('mbc_rec_prop') && el('mbc_rec_prop').checked) {
      /* só os campos alterados nesta edição vão para os outros processos do equipamento (o que difere e não foi mexido fica) */
      var mudou = function (f) { return txt(cad[f]) !== txt(cadAntes[f]); };
      var mudouPot = txt(rec['PotenciaEquipamento (W)']) !== txt(antigo['PotenciaEquipamento (W)']);
      R.forEach(function (x) {
        if (x === rec || codRec(x) !== codRec(antigo) || chave(x.Equipamento) !== chave(antigo.Equipamento)) return;
        x.CodEquipamento = cod; x.Equipamento = nome;
        if (mudouPot) { x['PotenciaEquipamento (W)'] = rec['PotenciaEquipamento (W)']; var kk = custosRecurso(x); x.CustoEnergia = kk.energia; x.CustoMOD = kk.mod; }
        var cx = C.find(function (c) { return c.IdRecurso && c.IdRecurso === x.IdRecurso; });
        if (cx) {
          cx['Código Equipamento'] = cod; cx.Equipamento = nome;
          if (mudouPot) cx['PotenciaEquipamento (W)'] = rec['PotenciaEquipamento (W)'];
          CAMPOS_EQUIP.forEach(function (f) { if (f !== 'Equipamento' && f !== 'PotenciaEquipamento (W)' && mudou(f)) cx[f] = cad[f]; });
        }
      });
    }
    salvar(); recursosModulo();
  };
  window.mesRecursoExcluir = function (idx) {
    var d = D(), r = d.recursos[idx]; if (!r) return;
    var usos = A(d.roteiro_recursos).filter(function (x) { return String(x.CodEquipamento) === codRec(r) && chave(x.Processo) === chave(r.Processo); }).length +
      A(d.op_etapas).filter(function (x) { return String(x.CodEquipamento) === codRec(r) && chave(x.Processo) === chave(r.Processo) && !opFechada(opPorCodigoLido(x.CodOP)); }).length;
    if (!confirm('Excluir o recurso ' + codRec(r) + ' — ' + (r.Equipamento || '') + ' (' + (r.Processo || '') + ')?' + (usos ? '\n\nAtenção: ele aparece em ' + usos + ' roteiro(s)/etapa(s) de OP aberta. Os roteiros e OPs não são alterados.' : ''))) return;
    d.recursos.splice(idx, 1);
    if (r.IdRecurso) d.cad_recursos = A(d.cad_recursos).filter(function (c) { return c.IdRecurso !== r.IdRecurso; });
    salvar(); recursosModulo();
  };
  window.mesRecursosModulo = recursosModulo;
  /* 1.6.0 — regras desta tela usadas pela importação de equipamentos (adaptador_recursos_importacao.js) */
  window.mesRecursosAPI = {
    codigo: codRec, novoId: novoIdRecurso, proximoCodigo: proximoCodigoRecurso, sincronizar: sincronizarRecursos, custos: custosRecurso,
    conflitos: conflitosRecursos, camposEquip: function () { return CAMPOS_EQUIP.slice(); }, chave: chave, modulo: recursosModulo
  };

  /* ---------------------------------------------------------------------
     13) ESTRUTURA DO PRODUTO — GERAR PIs FILHOS PELOS PROCESSOS CADASTRADOS
     "Gerar PIs do PA selecionado" (e o salvamento de um PA novo) abre a lista dos processos cadastrados, cada um com
     flag, tipo de PI sugerido e unidade. Só os processos marcados geram PI; processos que já têm PI ficam indicados.
     --------------------------------------------------------------------- */
  var TIPOS_PI = ['Slurry Cátodo', 'Slurry Ânodo', 'Eletrodo Depositado Cátodo', 'Eletrodo Depositado Ânodo', 'Eletrodo Calandrado Cátodo', 'Eletrodo Calandrado Ânodo',
    'Eletrodo Cortado Cátodo', 'Eletrodo Cortado Ânodo', 'Jelly Roll', 'Célula Montada', 'Outro'];
  function lado(p) { var k = chave(p); return /catod/.test(k) ? 'Cátodo' : (/anod/.test(k) ? 'Ânodo' : ''); }
  function tipoPIdoProcesso(p) {
    var k = chave(p), l = lado(p);
    if (/mistur|slurry|dispers/.test(k)) return l ? 'Slurry ' + l : 'Slurry';
    if (/coating|deposi|recobr|revest|espalm/.test(k)) return l ? 'Eletrodo Depositado ' + l : 'Eletrodo Depositado';
    if (/calandr|prensag/.test(k)) return l ? 'Eletrodo Calandrado ' + l : 'Eletrodo Calandrado';
    if (/corte|slit|estamp|laser|recort/.test(k)) return l ? 'Eletrodo Cortado ' + l : 'Eletrodo Cortado';
    if (/montag|empilh|stack|bobin|enrol|wind/.test(k)) return 'Jelly Roll';
    if (/formac|envelhec|aging|teste|ensaio/.test(k)) return 'Célula Montada';
    return txt(p);
  }
  function umDoTipo(t) { var k = chave(t); return /slurry/.test(k) ? 'kg' : (/depositado|calandrado/.test(k) ? 'm' : 'un'); }
  function ordemProcesso(p) {
    var k = chave(p), base = /mistur|slurry/.test(k) ? 1 : /coating|deposi|recobr/.test(k) ? 2 : /calandr/.test(k) ? 3 : /corte|slit|estamp|laser/.test(k) ? 4 : /montag|empilh|stack|bobin/.test(k) ? 5 : /formac|aging|teste|ensaio/.test(k) ? 6 : 7;
    return base * 10 + (lado(p) === 'Cátodo' ? 1 : lado(p) === 'Ânodo' ? 2 : 3);
  }
  function processosOrdenados() {
    var ps = A((D() || {}).processos).filter(function (p) { return p && txt(p.Processo); });
    return ps.slice().sort(function (a, b) { return ordemProcesso(a.Processo) - ordemProcesso(b.Processo) || String(a.IdProcesso || '').localeCompare(String(b.IdProcesso || ''), 'pt-BR', { numeric: true }); });
  }
  function abrirGeradorPIs(codPA, origem) {
    var d = D(), pas = A(d.estrutura).filter(function (r) { return String(r['Tipo Produto'] || '').toUpperCase() === 'PA'; });
    if (!pas.length) return alert('Cadastre ou marque um PA para gerar os PIs.');
    var pa = pas.find(function (p) { return p['Código'] === codPA; }) || pas[0];
    garantirEstilo();
    var box = el('crudBox');
    if (!box) { if (typeof render === 'function') render('estrutura'); box = el('crudBox'); if (!box) return; }
    var procs = processosOrdenados();
    box.innerHTML = '<div class="form edit-form mbc-gerador-pi"><h3>Gerar PIs filhos pelos processos</h3>' +
      (origem === 'novoPA' ? '<p class="mbc-msg ok" style="display:block">PA ' + esc(pa['Código']) + ' salvo. Marque os processos que devem ter PI filho (ou cancele para fazer depois).</p>' : '') +
      '<div class="mbc-grid" style="margin-bottom:8px"><label style="grid-column:span 2"><span>PA</span><select id="mbc_gpi_pa" onchange="mesGerarPIsAbrir(this.value)">' +
      pas.map(function (p) { return '<option value="' + esc(p['Código']) + '" ' + (p === pa ? 'selected' : '') + '>' + esc(p['Código'] + ' — ' + (p['Descrição'] || '')) + '</option>'; }).join('') + '</select></label></div>' +
      (procs.length ? '<div class="mbc-proc mbc-proc-head"><span></span><span>Processo</span><span>Tipo de PI</span><span>UM</span><span>Descrição do PI</span></div><div class="mbc-proc-list">' +
        procs.map(function (p, i) {
          var tipo = tipoPIdoProcesso(p.Processo);
          var existe = pisDoPAx(pa['Código']).find(function (x) { return chave(x.Processo) === chave(p.Processo) || chave(x['Tipo PI']) === chave(tipo); });
          return '<div class="mbc-proc ' + (existe ? 'existe' : '') + '"><input type="checkbox" class="mbc-gpi-flag" data-i="' + i + '" ' + (existe ? 'disabled checked' : 'checked') + ' title="' + (existe ? 'Já existe PI para este processo' : 'Gerar PI') + '">' +
            '<span><b>' + esc(p.Processo) + '</b><br><small class="muted">' + esc(p.IdProcesso || '') + (existe ? ' · já existe: ' + esc(existe['Código'] + ' — ' + (existe['Tipo PI'] || '')) : '') + '</small></span>' +
            '<span><input type="text" list="mbc_tipos_pi" id="mbc_gpi_tipo_' + i + '" value="' + esc(existe ? existe['Tipo PI'] || tipo : tipo) + '" ' + (existe ? 'disabled' : '') + ' oninput="mesGerarPIsDesc(' + i + ')"></span>' +
            '<span><select id="mbc_gpi_um_' + i + '" ' + (existe ? 'disabled' : '') + '>' + ['kg', 'g', 'm', 'cm', 'un', 'L', 'mL'].map(function (u) { return '<option ' + (u === (existe ? existe['Unidade de Produção'] || umDoTipo(tipo) : umDoTipo(tipo)) ? 'selected' : '') + '>' + u + '</option>'; }).join('') + '</select></span>' +
            '<span><input type="text" id="mbc_gpi_desc_' + i + '" value="' + esc(existe ? existe['Descrição'] || '' : tipo + ' ' + pa['Código']) + '" ' + (existe ? 'disabled' : '') + '></span></div>';
        }).join('') + '</div><datalist id="mbc_tipos_pi">' + TIPOS_PI.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>'
        : '<p class="mbc-msg alerta" style="display:block">Nenhum processo cadastrado (Engenharia > Processos). Cadastre os processos para gerar os PIs por processo.</p>') +
      '<div class="form-actions"><button onclick="mesGerarPIsConfirmar()">Gerar PIs marcados</button><button class="secondary" onclick="document.querySelectorAll(\'.mbc-gpi-flag:not(:disabled)\').forEach(function(c){c.checked=true})">Marcar todos</button>' +
      '<button class="secondary" onclick="document.querySelectorAll(\'.mbc-gpi-flag:not(:disabled)\').forEach(function(c){c.checked=false})">Desmarcar todos</button><button class="secondary" onclick="document.getElementById(\'crudBox\').innerHTML=\'\'">Cancelar</button></div></div>';
    window.__mbcGpi = { pa: pa['Código'], procs: procs };
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function pisDoPAx(cod) { return A((D() || {}).estrutura).filter(function (r) { return r['Código Pai'] === cod && String(r['Tipo Produto'] || '').toUpperCase() === 'PI'; }); }
  window.mesGerarPIsAbrir = function (cod) { abrirGeradorPIs(cod); };
  window.mesGerarPIsDesc = function (i) {
    var t = el('mbc_gpi_tipo_' + i), dsc = el('mbc_gpi_desc_' + i), g = window.__mbcGpi; if (!t || !dsc || !g) return;
    dsc.value = txt(t.value) + ' ' + g.pa;
    var um = el('mbc_gpi_um_' + i); if (um) um.value = umDoTipo(t.value);
  };
  window.mesGerarPIsConfirmar = function () {
    var g = window.__mbcGpi, d = D(); if (!g) return;
    var pa = A(d.estrutura).find(function (r) { return r['Código'] === g.pa; }); if (!pa) return alert('PA não encontrado.');
    var marcados = [].slice.call(document.querySelectorAll('.mbc-gpi-flag:checked:not(:disabled)')).map(function (c) { return Number(c.dataset.i); });
    if (!marcados.length) return alert('Marque ao menos um processo.');
    var criados = [];
    marcados.forEach(function (i) {
      var p = g.procs[i]; if (!p) return;
      var tipo = txt((el('mbc_gpi_tipo_' + i) || {}).value) || tipoPIdoProcesso(p.Processo);
      if (pisDoPAx(pa['Código']).some(function (x) { return chave(x.Processo) === chave(p.Processo); })) return;
      var cod = typeof nextCodigoPIForPA === 'function' ? nextCodigoPIForPA(pa['Código']) : 'PI' + Date.now();
      var um = (el('mbc_gpi_um_' + i) || {}).value || umDoTipo(tipo);
      var pi = Object.assign({}, pa, { 'Código': cod, 'Descrição': txt((el('mbc_gpi_desc_' + i) || {}).value) || (tipo + ' ' + pa['Código']), 'Tipo Produto': 'PI', 'Código Pai': pa['Código'], 'Tipo PI': tipo,
        Processo: p.Processo, IdProcesso: p.IdProcesso || '', 'Unidade de Produção': um, 'Ultima Atualizacao': agora(), OrigemGeracao: 'PROCESSOS_SELECIONADOS' });
      d.estrutura.push(pi); criados.push(cod + ' (' + p.Processo + ')');
    });
    salvar();
    alert(criados.length ? 'PIs gerados para ' + pa['Código'] + ':\n' + criados.join('\n') : 'Nenhum PI novo: os processos marcados já têm PI.');
    if (typeof render === 'function') render('estrutura');
  };
  window.gerarPIsDoPA = function () {
    var marcados = typeof getSelectedRows === 'function' ? getSelectedRows('estrutura').filter(function (r) { return String(r['Tipo Produto'] || '').toUpperCase() === 'PA'; }) : [];
    abrirGeradorPIs(marcados[0] ? marcados[0]['Código'] : '');
  };
  (function () {
    var salvarAnt = window.salvarEstrutura;
    if (typeof salvarAnt !== 'function') return;
    window.salvarEstrutura = function (idx) {
      var novoPA = !(idx >= 0) && el('est_tipo') && el('est_tipo').value === 'PA', cod = el('est_codigo') ? el('est_codigo').value : '';
      var r = salvarAnt.apply(this, arguments);
      try {
        if (novoPA && cod && A(D().estrutura).some(function (x) { return x['Código'] === cod; }) && !pisDoPAx(cod).length && processosOrdenados().length) {
          setTimeout(function () { abrirGeradorPIs(cod, 'novoPA'); }, 60);
        }
      } catch (e) { }
      return r;
    };
  })();
  (function () {
    var modAnt = window.estruturaModule;
    if (typeof modAnt !== 'function') return;
    window.estruturaModule = function () {
      var r = modAnt.apply(this, arguments);
      try {
        document.querySelectorAll('#content .toolbar button').forEach(function (b) { if (/Gerar PIs do PA/i.test(b.textContent || '')) b.textContent = 'Gerar PIs do PA (escolher processos)'; });
        document.querySelectorAll('#content .hint').forEach(function (h) { if (/Gerar PIs do PA/.test(h.textContent || '')) h.innerHTML = 'Para criar PIs automaticamente, marque o PA e use <b>“Gerar PIs do PA (escolher processos)”</b>: abre a lista dos processos cadastrados para escolher, por flag, quais terão PI filho. Ao salvar um PA novo a lista abre sozinha.'; });
      } catch (e) { }
      return r;
    };
  })();

  /* ---------------------------------------------------------------------
     14) MENU, ROTAS E INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  function ajustarMenu() {
    try {
      var mods = (typeof modules !== 'undefined') ? modules : null, grupos = (typeof moduleGroups !== 'undefined') ? moduleGroups : null;
      if (mods) {
        var cad = mods.find(function (m) { return m[0] === 'cad_recursos'; }); if (cad) cad[1] = 'Recursos / Máquinas';
        [['estoque', 'Estoque / Rastreabilidade'], ['locais_estoque', 'Locais de Estoque'], ['inventario_estoque', 'Inventário de Estoque']].forEach(function (x) { if (!mods.some(function (m) { return m[0] === x[0]; })) mods.push(x); });
      }
      if (grupos) {
        var eng = grupos.find(function (g) { return g.title === 'Engenharia'; });
        if (eng) { eng.items = eng.items.filter(function (k) { return k !== 'recursos'; }); if (eng.items.indexOf('cad_recursos') < 0) eng.items.splice(2, 0, 'cad_recursos'); }
        var mat = grupos.find(function (g) { return g.title === 'Materiais'; });
        if (mat) {
          var pos = mat.items.indexOf('entradas');
          ['estoque', 'locais_estoque', 'inventario_estoque'].forEach(function (k, j) { if (mat.items.indexOf(k) < 0) mat.items.splice(pos >= 0 ? pos + 1 + j : mat.items.length, 0, k); });
        }
      }
    } catch (e) { console.warn('MES LION: menu', e); }
  }
  ajustarMenu();
  function refazerMenu() {
    try { var app = el('app'); if (app && !app.classList.contains('hidden') && typeof renderNav === 'function') { var at = current; renderNav(); marcarNav(at); } } catch (e) { }
  }
  (function () {
    var renderAnt = window.render;
    if (typeof renderAnt !== 'function') return;
    window.render = function (k) {
      normalizar();
      if (k === 'locais_estoque') return locaisModulo();
      if (k === 'inventario_estoque') return inventarioModulo();
      if (k === 'estoque') return window.estoqueModuleV4047();
      if (k === 'recursos' || k === 'cad_recursos') {
        var r0;
        try { r0 = renderAnt.call(this, 'cad_recursos'); } catch (e) { console.warn('MES LION: tela anterior de recursos', e); }
        recursosModulo();
        return r0;
      }
      var r = renderAnt.apply(this, arguments);
      try {
        if (k === 'producao') { garantirEstilo(); inserirLeituraOP(); inserirLeituraMaterial(); }
        if (k === 'bp') inserirLeituraBP();
      } catch (e) { console.warn('MES LION: leitura de código', e); }
      return r;
    };
  })();
  (function () {
    var bootAnt = window.boot;
    if (typeof bootAnt !== 'function') return;
    window.boot = function () {
      normalizar(); ajustarMenu();
      var r = bootAnt.apply(this, arguments);
      refazerMenu();
      return r;
    };
  })();
  (function () {
    var showBPAnt = window.showBP;
    if (typeof showBPAnt !== 'function') return;
    window.showBP = function () { var r = showBPAnt.apply(this, arguments); try { inserirLeituraBP(); } catch (e) { } return r; };
  })();
  (function () {
    /* a OP recebe o código de barras assim que é gravada (geração por roteiro, MRP, PI isolado ou manual) */
    var gravarAnt = window.saveLocal;
    if (typeof gravarAnt !== 'function') return;
    window.saveLocal = function () { try { normalizar(); } catch (e) { } return gravarAnt.apply(this, arguments); };
  })();
  normalizar();
  refazerMenu();
  /* 1.3.0 — funções do estoque usadas pelo adaptador_estoque_ajustes.js (Ajuste de Estoque, estoque mínimo e MRP) */
  window.mesEstoqueAPI = {
    linhas: linhasEstoque, reservas: reservasOPs, resumo: function () { return resumoMateriais(linhasEstoque(), reservasOPs()); },
    material: materialPorCodigo, estilo: garantirEstilo, backup: backupAntes, normalizar: normalizar, tag: tagStatus,
    setCurrent: setCurrent, marcarNav: marcarNav, cabecalho: cabecalho, aviso: aviso, usuario: usuario, chaveCodigo: chaveCodigo,
    /* 1.6.1 */ converterUM: converterUM, normUM: normUM, conferirSaldoDoConsumo: conferirSaldoDoConsumo, contexto: contextoEstoque, consumidoNaOP: consumidoNaOP
  };
  window.MES_ADAPTADOR_CODIGOS_ESTOQUE = VERSAO;
})();
