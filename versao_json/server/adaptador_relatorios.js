/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR 1.5.0: RELATÓRIOS
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, DEPOIS de todos os outros
   adaptadores. Não altera os arquivos do frontend nem as regras das telas: lê os mesmos dados e chama as mesmas
   funções que as telas usam (saldo do Estoque, livro de PI/PA, custos, ACV, carga × capacidade, passaporte), para o
   Excel bater com o MES.
     1) Menu "Relatórios": Catálogo de relatórios, Dossiê da OP e Meus modelos.
     2) Catálogo por módulo com busca; filtros comuns (período, projeto, produto, OP, máquina, situação e busca livre);
        prévia na tela com o total de registros e a linha de totais; escolha de colunas; modelos salvos
        (data.relatorios_modelos, para todos os usuários).
     3) Excel .xlsx de verdade, gerado no navegador: números como número, datas como data, unidade no cabeçalho,
        filtro automático, cabeçalho congelado, linha "Total" com SUBTOTAL (acompanha o filtro do Excel) e a aba
        "Parâmetros" (relatório, filtros, data e hora, usuário, versão e regra de cálculo). Quantidades em unidades
        diferentes nunca são somadas ("várias UM").
     4) Cada exportação fica no Histórico de Modificações (POST /api/relatorios/exportacao).
     5) Dossiê da OP: uma planilha com várias abas (a OP sozinha ou a família PA + PIs) — resumo, produção,
        etiquetas, materiais e lotes, PIs, tempos por máquina, perdas, custo, CO₂ e rastreabilidade.
     1.6.1) Auditoria › "Consistência dos dados": confere os dados que alimentam estoque, custo, CO₂ e passaporte e
        lista o que deixa algum número errado ou desatualizado, com o impacto e como corrigir (só leitura). "Custo por
        OP" com energia, MOD e perdas das etapas da OP; MRP com a mesma conta da tela (planejado − já consumido).
   ===================================================================== */
(function () {
  'use strict';
  if (window.MES_ADAPTADOR_RELATORIOS) return;
  var VERSAO = '1.6.1';

  /* ---------------------------------------------------------------------
     0) UTILITÁRIOS
     --------------------------------------------------------------------- */
  function A(v) { return Array.isArray(v) ? v : []; }
  function D() { return (typeof data === 'object' && data) ? data : null; }
  function txt(v) { return v == null ? '' : String(v).trim(); }
  /* mesmo conversor das telas (num do app.js: "1.234,5", "0,8956", "0.8956", "R$ 3,11") */
  function N(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof num === 'function') return num(v);
    var n = Number(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function arred(v, c) { var f = Math.pow(10, c == null ? 10 : c); return Math.round((Number(v) || 0) * f) / f; }
  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(v) { return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function usuarioLogin() { var u = window.MES_CURRENT_USER; return (u && u.username) || 'admin'; }
  function usuarioNome() { var u = window.MES_CURRENT_USER; if (!u) return 'admin'; return u.fullName && u.fullName !== u.username ? u.fullName + ' (' + u.username + ')' : (u.username || ''); }
  function unicos(lista) { var v = {}, o = []; lista.forEach(function (x) { var k = txt(x); if (k && !v[k]) { v[k] = 1; o.push(k); } }); return o; }

  /* datas: "dd/mm/aaaa", "dd/mm/aaaa, hh:mm", "aaaa-mm-dd", ISO com fuso; hora opcional ("hh:mm") */
  function paraData(v, hora) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getTime());
    var s = txt(v), d = null, m;
    if (!s) return null;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/))) {
      if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) d = new Date(s.replace(/(\.\d{3})\d+/, '$1'));
      else d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    if (!d || isNaN(d.getTime())) return null;
    var h = txt(hora).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (h) d.setHours(+h[1], +h[2], +(h[3] || 0), 0);
    return d;
  }
  function fmtData(d) { return d ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() : ''; }
  function fmtDataHora(d) { return d ? fmtData(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''; }
  function diaISO(d) { return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : ''; }
  function maxData(lista) { var m = null; lista.forEach(function (d) { if (d && (!m || d > m)) m = d; }); return m; }
  function difHoras(a, b) { return a && b ? arred((a.getTime() - b.getTime()) / 3600000, 4) : ''; }

  /* tipos de coluna: formato no Excel e regra de total */
  var TIPOS = {
    txt: {}, int: { casas: 0, soma: true }, num: { casas: 2, soma: true }, qtd: { casas: 4, soma: 'um' },
    moeda: { casas: 2, soma: true }, pct: { casas: 1 }, min: { casas: 1, soma: true }, h: { casas: 2, soma: true },
    co2: { casas: 4, soma: true }, data: {}, datahora: {}
  };
  function C(k, l, t, o) {
    var c = { k: k, l: l, t: t || 'txt' };
    if (o) Object.keys(o).forEach(function (x) { c[x] = o[x]; });
    return c;
  }
  function casasDe(c) { return c.casas != null ? c.casas : ((TIPOS[c.t] || {}).casas || 0); }
  function rotulo(c) { return c.l + (c.u ? ' (' + c.u + ')' : ''); }
  function fmtNum(v, casas, min) {
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: min == null ? casas : min, maximumFractionDigits: casas });
  }
  /* texto da célula na prévia (pt-BR) */
  function formatar(v, c) {
    if (v === '' || v == null) return '';
    if (v instanceof Date) return c.t === 'data' ? fmtData(v) : fmtDataHora(v);
    if (typeof v !== 'number') return String(v);
    var cs = casasDe(c);
    if (c.t === 'moeda') return 'R$ ' + fmtNum(v, cs);
    if (c.t === 'pct') return fmtNum(v, cs) + '%';
    if (c.t === 'qtd' || c.t === 'co2') return fmtNum(v, cs, 0);
    return fmtNum(v, cs);
  }

  /* ---------------------------------------------------------------------
     1) GERADOR DE .XLSX (Office Open XML, sem bibliotecas externas)
     --------------------------------------------------------------------- */
  var XLSX = (function () {
    var enc = new TextEncoder();
    function x(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, ''); }
    function letra(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
    function serial(d) { return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000; }
    function nomeAba(nome, usados) {
      var s = String(nome || 'Planilha').replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Planilha', b = s, i = 2;
      while (usados[s.toLowerCase()]) { var suf = ' (' + (i++) + ')'; s = b.slice(0, 31 - suf.length) + suf; }
      usados[s.toLowerCase()] = 1;
      return s;
    }
    /* estilos: fontes 0 normal, 1 cabeçalho, 2 negrito, 3 título, 4 nota; preenchimentos 2 azul, 3 cinza (total) */
    function Estilos() {
      var fmts = {}, lista = [], xfs = [{ f: 0, fo: 0, fi: 0, b: 0, w: 0 }], idx = { '0|0|0|0|0': 0 }, prox = 164;
      function fmtId(code) {
        if (code == null || code === '') return 0;
        if (code === '@') return 49;
        if (!fmts[code]) { fmts[code] = prox++; lista.push([fmts[code], code]); }
        return fmts[code];
      }
      return {
        xf: function (code, fonte, fill, wrap, borda) {
          var f = fmtId(code), k = f + '|' + (fonte || 0) + '|' + (fill || 0) + '|' + (wrap ? 1 : 0) + '|' + (borda || 0);
          if (idx[k] == null) { idx[k] = xfs.length; xfs.push({ f: f, fo: fonte || 0, fi: fill || 0, w: wrap ? 1 : 0, b: borda || 0 }); }
          return idx[k];
        },
        xml: function () {
          return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            (lista.length ? '<numFmts count="' + lista.length + '">' + lista.map(function (n) { return '<numFmt numFmtId="' + n[0] + '" formatCode="' + x(n[1]) + '"/>'; }).join('') + '</numFmts>' : '') +
            '<fonts count="5"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
            '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
            '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
            '<font><b/><sz val="13"/><color rgb="FF004B87"/><name val="Calibri"/><family val="2"/></font>' +
            '<font><i/><sz val="9"/><color rgb="FF5F7488"/><name val="Calibri"/><family val="2"/></font></fonts>' +
            '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FF004B87"/><bgColor indexed="64"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills>' +
            '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
            '<border><left/><right/><top style="thin"><color rgb="FF9DB2C5"/></top><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="' + xfs.length + '">' + xfs.map(function (s) {
              return '<xf numFmtId="' + s.f + '" fontId="' + s.fo + '" fillId="' + s.fi + '" borderId="' + s.b + '" xfId="0"' + (s.f ? ' applyNumberFormat="1"' : '') +
                (s.fo ? ' applyFont="1"' : '') + (s.fi ? ' applyFill="1"' : '') + (s.b ? ' applyBorder="1"' : '') +
                (s.w ? ' applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' : '/>');
            }).join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
        }
      };
    }
    function codigoFormato(c) {
      var cs = casasDe(c), dec = cs > 0 ? '.' + new Array(cs + 1).join('0') : '';
      switch (c.t) {
        case 'data': return 'dd/mm/yyyy';
        case 'datahora': return 'dd/mm/yyyy hh:mm';
        case 'moeda': return '"R$" #,##0' + dec;
        case 'pct': return '0' + dec + '%';
        case 'txt': return '@';
        case 'qtd': return c.casas != null ? '#,##0' + dec : '';   /* quantidade: formato Geral (mostra as casas que o número tem) */
        default: return '#,##0' + dec;
      }
    }
    /* uma aba: blocos {tipo: 'titulo'|'nota'|'kv'|'tabela'} empilhados com uma linha em branco entre eles */
    function folha(aba, est, ativa) {
      var rows = [], r = 0, larg = [], filtro = null, pane = 0;
      function largura(ci, v) { var n = Math.min(60, Math.max(8, String(v == null ? '' : v).length + 2)); if (!larg[ci] || larg[ci] < n) larg[ci] = n; }
      function celTexto(ref, v, s) { return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + x(v) + '</t></is></c>'; }
      function celValor(ref, c, v, sNum, sTxt) {
        if (v === '' || v == null) return '';
        if (v instanceof Date) return isNaN(v.getTime()) ? '' : '<c r="' + ref + '" s="' + sNum + '"><v>' + arred(serial(v), 8) + '</v></c>';
        if (typeof v === 'number') {
          if (!isFinite(v)) return '';
          if (c.t === 'txt') return celTexto(ref, String(v), sTxt);
          return '<c r="' + ref + '" s="' + sNum + '"><v>' + arred(c.t === 'pct' ? v / 100 : v, 10) + '</v></c>';
        }
        return celTexto(ref, v, sTxt);
      }
      A(aba.blocos).forEach(function (b, bi) {
        if (bi > 0 && rows.length) r++;
        if (b.tipo === 'titulo' || b.tipo === 'nota') {
          r++;
          rows.push('<row r="' + r + '">' + celTexto('A' + r, b.texto, est.xf('', b.tipo === 'titulo' ? 3 : 4, 0, false)) + '</row>');
          return;
        }
        if (b.tipo === 'kv') {
          /* linhas [rótulo, valor, coluna opcional (formato do número / data)] */
          var sK = est.xf('', 2, 0, false), sT = est.xf('@', 0, 0, true), sN = est.xf('', 0, 0, false), sD = est.xf('dd/mm/yyyy hh:mm', 0, 0, false);
          A(b.linhas).forEach(function (l) {
            r++;
            var v = l[1], c = l[2], cel;
            if (v instanceof Date) cel = isNaN(v.getTime()) ? '' : '<c r="B' + r + '" s="' + (c && c.t === 'data' ? est.xf('dd/mm/yyyy', 0, 0, false) : sD) + '"><v>' + arred(serial(v), 8) + '</v></c>';
            else if (typeof v === 'number' && isFinite(v)) cel = '<c r="B' + r + '" s="' + (c && c.t !== 'txt' ? est.xf(codigoFormato(c), 0, 0, false) : sN) + '"><v>' + arred(c && c.t === 'pct' ? v / 100 : v, 10) + '</v></c>';
            else cel = celTexto('B' + r, v == null ? '' : v, sT);
            largura(0, l[0]); largura(1, v instanceof Date ? '00/00/0000 00:00' : (typeof v === 'number' && c ? formatar(v, c) : String(v == null ? '' : v).slice(0, 80)));
            rows.push('<row r="' + r + '">' + celTexto('A' + r, l[0], sK) + cel + '</row>');
          });
          return;
        }
        /* tabela */
        var cols = A(b.colunas), linhas = A(b.linhas), sCab = est.xf('', 1, 2, true), primeira, ultima;
        r++;
        var cab = r;
        rows.push('<row r="' + r + '">' + cols.map(function (c, ci) { largura(ci, rotulo(c)); return celTexto(letra(ci) + r, rotulo(c), sCab); }).join('') + '</row>');
        if (aba.congelar && !pane) pane = r;
        var estilos = cols.map(function (c) { return { n: est.xf(codigoFormato(c), 0, 0, false), t: est.xf('@', 0, 0, false) }; });
        primeira = r + 1;
        linhas.forEach(function (lin) {
          r++;
          rows.push('<row r="' + r + '">' + cols.map(function (c, ci) {
            var v = lin[c.k];
            if (v === '' || v == null) return '';
            largura(ci, v instanceof Date ? (c.t === 'data' ? '00/00/0000' : '00/00/0000 00:00') : (typeof v === 'number' ? formatar(v, c) : String(v).slice(0, 70)));
            return celValor(letra(ci) + r, c, v, estilos[ci].n, estilos[ci].t);
          }).join('') + '</row>');
        });
        ultima = r;
        if (b.filtro && !filtro && cols.length) filtro = 'A' + cab + ':' + letra(cols.length - 1) + Math.max(cab, ultima);
        if (b.totais && linhas.length && cols.length) {
          r++;
          var tot = totaisColunas(cols, linhas), sTL = est.xf('', 2, 3, false, 1), cel = [];
          cols.forEach(function (c, ci) {
            var ref = letra(ci) + r, t = tot[c.k];
            if (ci === 0 && !t) { cel.push(celTexto(ref, 'Total (' + linhas.length + ' linha' + (linhas.length === 1 ? '' : 's') + ')', sTL)); return; }
            if (!t) { cel.push('<c r="' + ref + '" s="' + est.xf('', 2, 3, false, 1) + '"/>'); return; }
            if (t.misto) { cel.push(celTexto(ref, 'várias UM', est.xf('', 2, 3, false, 1))); return; }
            var col = letra(ci);
            cel.push('<c r="' + ref + '" s="' + est.xf(codigoFormato(c), 2, 3, false, 1) + '"><f>SUBTOTAL(109,' + col + primeira + ':' + col + ultima + ')</f><v>' + arred(c.t === 'pct' ? t.valor / 100 : t.valor, 10) + '</v></c>');
          });
          rows.push('<row r="' + r + '">' + cel.join('') + '</row>');
        }
      });
      var ncols = Math.max(1, larg.length);
      var dim = 'A1:' + letra(ncols - 1) + Math.max(1, r);
      var vista = '<sheetViews><sheetView workbookViewId="0"' + (ativa ? ' tabSelected="1"' : '') + '>' +
        (pane ? '<pane ySplit="' + pane + '" topLeftCell="A' + (pane + 1) + '" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A' + (pane + 1) + '" sqref="A' + (pane + 1) + '"/>' : '') +
        '</sheetView></sheetViews>';
      var colsXml = larg.length ? '<cols>' + larg.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (w || 10) + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
      return {
        filtro: filtro,
        xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<dimension ref="' + dim + '"/>' + vista + '<sheetFormatPr defaultRowHeight="15"/>' + colsXml + '<sheetData>' + rows.join('') + '</sheetData>' +
          (filtro ? '<autoFilter ref="' + filtro + '"/>' : '') + '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'
      };
    }
    var TAB_CRC = null;
    function crc32(b) {
      if (!TAB_CRC) { TAB_CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TAB_CRC[n] = c >>> 0; } }
      var crc = 0xFFFFFFFF;
      for (var i = 0; i < b.length; i++) crc = TAB_CRC[(crc ^ b[i]) & 0xFF] ^ (crc >>> 8);
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }
    async function comprimir(bytes) {
      if (typeof CompressionStream !== 'function' || bytes.length < 512) return null;
      try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); } catch (e) { return null; }
    }
    async function zip(arquivos) {
      var partes = [], central = [], offset = 0, agora = new Date();
      var hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1), dia = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
      for (var i = 0; i < arquivos.length; i++) {
        var a = arquivos[i], nome = enc.encode(a.nome), dados = enc.encode(a.texto), crc = crc32(dados), comp = await comprimir(dados);
        var metodo = comp && comp.length < dados.length ? 8 : 0, corpo = metodo ? comp : dados;
        var lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, metodo, true); lh.setUint16(10, hora, true); lh.setUint16(12, dia, true);
        lh.setUint32(14, crc, true); lh.setUint32(18, corpo.length, true); lh.setUint32(22, dados.length, true); lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true);
        partes.push(new Uint8Array(lh.buffer), nome, corpo);
        var ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, metodo, true); ch.setUint16(12, hora, true);
        ch.setUint16(14, dia, true); ch.setUint32(16, crc, true); ch.setUint32(20, corpo.length, true); ch.setUint32(24, dados.length, true); ch.setUint16(28, nome.length, true);
        ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
        central.push(new Uint8Array(ch.buffer), nome);
        offset += 30 + nome.length + corpo.length;
      }
      var tam = central.reduce(function (s, p) { return s + p.length; }, 0), fim = new DataView(new ArrayBuffer(22));
      fim.setUint32(0, 0x06054b50, true); fim.setUint16(4, 0, true); fim.setUint16(6, 0, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
      fim.setUint32(12, tam, true); fim.setUint32(16, offset, true); fim.setUint16(20, 0, true);
      var todas = partes.concat(central, [new Uint8Array(fim.buffer)]), out = new Uint8Array(todas.reduce(function (s, p) { return s + p.length; }, 0)), pos = 0;
      todas.forEach(function (p) { out.set(p, pos); pos += p.length; });
      return out;
    }
    /* abas: [{nome, congelar, blocos}] -> Uint8Array (.xlsx) */
    async function gerar(abas, meta) {
      meta = meta || {};
      var est = Estilos(), usados = {}, nomes = [], folhas = [], ns = 'http://schemas.openxmlformats.org/', rel = ns + 'officeDocument/2006/relationships';
      abas.forEach(function (a, i) { var n = nomeAba(a.nome, usados); nomes.push(n); folhas.push(folha(a, est, i === 0)); });
      var definidos = folhas.map(function (f, i) { return f.filtro ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + x(nomes[i].replace(/'/g, "''")) + '\'!' + f.filtro.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2') + '</definedName>' : ''; }).join('');
      var iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      var arquivos = [
        { nome: '[Content_Types].xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + ns + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          folhas.map(function (f, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
        { nome: '_rels/.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + ns + 'package/2006/relationships"><Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/>' +
          '<Relationship Id="rId2" Type="' + ns + 'package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
        { nome: 'docProps/core.xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="' + ns + 'package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          '<dc:title>' + x(meta.titulo || 'Relatório MES LION') + '</dc:title><dc:creator>MES LION</dc:creator><cp:lastModifiedBy>' + x(usuarioLogin()) + '</cp:lastModifiedBy>' +
          '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified></cp:coreProperties>' },
        { nome: 'xl/workbook.xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + ns + 'spreadsheetml/2006/main" xmlns:r="' + rel + '"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
          nomes.map(function (n, i) { return '<sheet name="' + x(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' +
          (definidos ? '<definedNames>' + definidos + '</definedNames>' : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
        { nome: 'xl/_rels/workbook.xml.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + ns + 'package/2006/relationships">' +
          folhas.map(function (f, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="' + rel + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
          '<Relationship Id="rId' + (folhas.length + 1) + '" Type="' + rel + '/styles" Target="styles.xml"/></Relationships>' }
      ];
      folhas.forEach(function (f, i) { arquivos.push({ nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', texto: f.xml }); });
      arquivos.push({ nome: 'xl/styles.xml', texto: est.xml() });
      return zip(arquivos);
    }
    return { gerar: gerar, serial: serial };
  })();

  /* totais da prévia e do Excel: soma só números; quantidade ("qtd") só quando todas as linhas têm a mesma UM */
  function totaisColunas(cols, linhas) {
    var t = {};
    cols.forEach(function (c) {
      var soma = c.soma != null ? c.soma : (TIPOS[c.t] || {}).soma;
      if (!soma) return;
      var nums = linhas.filter(function (r) { return typeof r[c.k] === 'number' && isFinite(r[c.k]); });
      if (!nums.length) return;
      if (soma === 'um') {
        var ums = unicos(nums.map(function (r) { return r[c.um || 'UM'] || '—'; }));
        if (ums.length > 1) { t[c.k] = { misto: true }; return; }
        t[c.k] = { valor: arred(nums.reduce(function (s, r) { return s + r[c.k]; }, 0), 10), um: ums[0] };
        return;
      }
      t[c.k] = { valor: arred(nums.reduce(function (s, r) { return s + r[c.k]; }, 0), 10) };
    });
    return t;
  }

  function nomeArquivo(base) {
    var d = new Date(), s = norm(base).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'relatorio';
    return 'MES_LION_' + s + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.xlsx';
  }
  function baixar(bytes, nome) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  }
  /* histórico de modificações: quem exportou o quê (o arquivo é gerado aqui no navegador) */
  function registrarExportacao(info) {
    try {
      return fetch('/api/relatorios/exportacao', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info) })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  /* as funções das telas às vezes regravam campos ao calcular (ex.: o custo da OP congela o custo projetado e refaz o
     consumo das linhas da OP). No relatório o cálculo é o mesmo, mas nada fica: não grava no servidor e, ao terminar,
     devolve cada coleção exatamente como estava (no mesmo objeto, sem trocar referências). Coleções muito grandes
     (biblioteca de ICV) não são copiadas: os cálculos só leem essas coleções. */
  function restaurarDados(d, antes, pulados) {
    /* coleção criada durante o cálculo sai (as telas recriam as suas com "data.x = A(data.x)" quando precisam) */
    Object.keys(d).forEach(function (k) { if (!(k in antes) && !pulados[k]) delete d[k]; });
    Object.keys(antes).forEach(function (k) {
      var agora;
      try { agora = JSON.stringify(d[k]); } catch (e) { return; }
      if (agora === antes[k]) return;
      var orig = antes[k] === undefined ? undefined : JSON.parse(antes[k]), atual = d[k];
      function igualar(x, o) { Object.keys(x).forEach(function (c) { if (!(c in o)) delete x[c]; }); Object.assign(x, o); }
      if (Array.isArray(atual) && Array.isArray(orig) && atual.length === orig.length) {
        atual.forEach(function (x, i) {
          var o = orig[i];
          if (x && o && typeof x === 'object' && typeof o === 'object' && !Array.isArray(x) && !Array.isArray(o)) igualar(x, o); else atual[i] = o;
        });
      } else if (Array.isArray(atual) && Array.isArray(orig)) { atual.length = 0; Array.prototype.push.apply(atual, orig); }
      else if (atual && orig && typeof atual === 'object' && typeof orig === 'object' && !Array.isArray(atual) && !Array.isArray(orig)) igualar(atual, orig);
      else d[k] = orig;
    });
  }
  function semGravar(fn) {
    var ant = window.saveLocal, d = D(), antes = null, pulados = {};
    if (d) {
      antes = {};
      Object.keys(d).forEach(function (k) {
        var v = d[k];
        if (Array.isArray(v) && v.length > 5000) { pulados[k] = 1; return; }
        try { antes[k] = JSON.stringify(v); } catch (e) { pulados[k] = 1; }
      });
    }
    window.saveLocal = function () { };
    try { return fn(); }
    finally {
      window.saveLocal = ant;
      if (d && antes) { try { restaurarDados(d, antes, pulados); } catch (e) { console.warn('MES LION 1.5: restauração dos dados depois do relatório', e); } }
    }
  }

  /* ---------------------------------------------------------------------
     2) DADOS DO MES (as mesmas fontes e funções das telas)
     --------------------------------------------------------------------- */
  function opsMapa() { var m = {}; A((D() || {}).op).forEach(function (o) { if (o && o.CodOP) m[txt(o.CodOP)] = o; }); return m; }
  function mapaDescricoes() {
    var m = {}, d = D() || {};
    A(d.materiais).forEach(function (p) { var c = txt(p && p['CódigoMaterial']); if (c) m[c] = txt(p.DescricaoMateriais); });
    A(d.estrutura).forEach(function (p) { var c = txt(p && p['Código']); if (c) m[c] = txt(p['Descrição']) || m[c] || ''; });
    return m;
  }
  function mapaMaquinas() {
    var m = {}, d = D() || {};
    A(d.recursos).forEach(function (r) { var c = txt(r && r.CodEquipamento); if (c && !m[c]) m[c] = txt(r.Equipamento); });
    A(d.cad_recursos).forEach(function (r) { var c = txt(r && r['Código Equipamento']); if (c && !m[c]) m[c] = txt(r.Equipamento); });
    return m;
  }
  function maquinaTxt(cod, nome, mapa) { var c = txt(cod), n = txt(nome) || (mapa && mapa[c]) || ''; return c ? c + ' — ' + n : n; }
  function projetoOP(op) { return txt(op && (op.CodProjeto || op.Projeto || op.CodigoProjeto)); }
  function fechada(op) { return /CONCLU|ENCERR/i.test(txt(op && op.Status)); }
  /* OP que entra no MRP: a mesma regra da tela MRP (activeOP do 1.3.0) */
  function opAtivaMRP(op) { return !/cancel|exclu|anulad|encerrad|conclu/i.test(String(op && op.Status || '')); }
  function materialCad(cod) { return A((D() || {}).materiais).find(function (m) { return m && txt(m['CódigoMaterial']) === txt(cod); }) || null; }
  var ORIGEM_PI = { APONTAMENTO: 'Apontamento de produção', BAIXA_AUTOMATICA_ENCERRAMENTO: 'Baixa automática no encerramento da OP', 'BAIXA_LEGADO_1.4.0': 'Baixa de integração (dados anteriores à 1.4.0)' };
  function origemConsumoPI(o) { var s = txt(o); return ORIGEM_PI[s] || s; }
  function cancelada(op) { return /CANCEL/i.test(txt(op && op.Status)); }
  function api14() { return window.mesApontamentoPI14 || null; }
  function raiz(op) { var a = api14(); try { return a && op ? txt(a.raizFamilia(op)) || txt(op.CodOP) : txt(op && op.CodOP); } catch (e) { return txt(op && op.CodOP); } }
  function produtoOP(op) { return txt(op && (op.CodigoProduto || op.ProdutoGerado || op.CodigoPI || op.Produto)); }
  function qtdProducao(r) { return N(r && (r['Quantidade produzida'] || r.QuantidadeProduzida || r.Quantidade)); }
  function producaoPorOP() { var m = {}; A((D() || {}).producao).forEach(function (r) { var c = txt(r && r.CodOP); if (c) m[c] = arred((m[c] || 0) + qtdProducao(r)); }); return m; }
  function perdasProduto(cod) {
    if (typeof perdasProdutoV32 === 'function') return N(perdasProdutoV32(cod));
    return A((D() || {}).perdas).filter(function (p) { return p && p.CodOP === cod && String(p.PerdaAlvoTipo || p.TipoAlvo || 'Produto').toUpperCase() !== 'MATERIAL'; })
      .reduce(function (s, p) { return s + N(p.QuantidadePerdida || p.Quantidade || 0); }, 0);
  }
  function consumoLiquido(c) { return (c.ConsumoLiquido !== undefined && c.ConsumoLiquido !== null && String(c.ConsumoLiquido) !== '') ? N(c.ConsumoLiquido) : N(c.QtdRetirada) - N(c.QtdDevolvida); }
  function consumoPIAtivo(c) { return !!c && String(c.Status || 'ATIVO').toUpperCase() !== 'CANCELADO'; }
  function ehLinhaPI(m) { return !!m && String(m.TipoConsumo || '').toLowerCase().indexOf('pi intermedi') >= 0; }
  function etapaTxt(ordem, processo) { var o = txt(ordem), p = txt(processo); return o && p ? o + ' · ' + p : (o || p); }
  function livroPI() { var a = api14(); try { return a && typeof a.livro === 'function' ? a.livro() : null; } catch (e) { return null; } }
  function chaveTempo(t) {
    var id = txt(t && t.IdRecursoRoteiro); if (id) return id;
    if (txt(t && t.CodEquipamento) || txt(t && t.OrdemEtapa)) return txt(t.OrdemEtapa) + '|' + txt(t.CodEquipamento);
    return '';
  }
  function inicioTempo(t) { return paraData(t.DataApontamento, t.HoraInicio); }
  function fimTempo(t) {
    if (!txt(t.HoraFim)) return null;
    var ini = inicioTempo(t), f = paraData(txt(t.DataFim) || t.DataApontamento, t.HoraFim);
    if (f && ini && !txt(t.DataFim) && f <= ini) f = new Date(f.getTime() + 86400000);
    return f;
  }
  function duracaoTempo(t) {
    var a = api14();
    if (a && typeof a.duracaoMin === 'function') { try { return N(a.duracaoMin(t)); } catch (e) { } }
    var i = inicioTempo(t), f = fimTempo(t);
    return i && f && f > i ? arred((f - i) / 60000, 2) : 0;
  }
  function familiasPA() {
    var ops = A((D() || {}).op).filter(function (o) { return o && o.CodOP; });
    return ops.filter(function (o) { return raiz(o) === txt(o.CodOP) && (String(o.TipoOP || '').toUpperCase() === 'PA' || ops.some(function (x) { return x !== o && raiz(x) === txt(o.CodOP); })); });
  }
  function unidadesFamilia(op) {
    var q = N(op.QtdProduzida), origem = 'produzida';
    if (!(q > 0)) { q = A((D() || {}).producao).filter(function (r) { return r && txt(r.CodOP) === txt(op.CodOP); }).reduce(function (s, r) { return s + qtdProducao(r); }, 0); }
    if (!(q > 0)) { q = N(op.QtdPlanejada); origem = 'planejada'; }
    if (!(q > 0)) { q = 1; origem = 'sem quantidade (1)'; }
    return { q: q, origem: origem };
  }
  function gravadoDe(lista, cod) { return A(lista).find(function (x) { return x && txt(x.CodOPMae || x.CodOP) === cod; }) || null; }

  /* ---------------------------------------------------------------------
     3) CATÁLOGO DE RELATÓRIOS
     Cada relatório: id, modulo, nome, descricao, regra (fonte dos números), filtros (filtro -> coluna da linha),
     colunas e linhas(f) (pode devolver Promise ou {linhas, resumo}).
     --------------------------------------------------------------------- */
  var MODULOS = [['estoque', 'Estoque de materiais', '📦'], ['pipa', 'PI e PA prontos', '🏷️'], ['producao', 'Produção', '🏭'], ['tempo', 'Tempo por máquina', '⏱️'],
    ['perdas', 'Perdas', '⚠️'], ['planejamento', 'Planejamento', '📅'], ['custos', 'Custos', '💰'], ['acv', 'Sustentabilidade / ACV', '🌱'],
    ['passaporte', 'Passaporte da bateria', '🔋'], ['cadastros', 'Cadastros', '🧩'], ['auditoria', 'Auditoria', '🛡️']];
  var RELS = [], POR_ID = {};
  function rel(def) { RELS.push(def); POR_ID[def.id] = def; }
  function nomeModulo(id) { var m = MODULOS.find(function (x) { return x[0] === id; }); return m ? m[1] : id; }

  /* ---------------- Estoque de materiais ---------------- */
  function linhasLotes() {
    if (typeof window.mesLinhasEstoque !== 'function') return [];
    return A(window.mesLinhasEstoque()).map(function (r) {
      var saldo = N(r.Saldo), cu = N(r.CustoUnitario);
      return { Entrada: txt(r.Entrada), DataEntrada: paraData(r.DataCadastro), Material: txt(r.CodigoMaterial), Descricao: txt(r.Material), Lote: txt(r.Lote), Local: txt(r.Localizacao),
        Fornecedor: txt(r.Fornecedor), NF: txt(r.NotaFiscal), Projeto: txt(r.CodigoProjeto || r.Projeto), UM: txt(r.UM), QtdEntrada: N(r.QtdEntrada), Consumo: N(r.ConsumoOP),
        Perdas: N(r.PerdasLote), AjusteSaida: N(r.AjusteSaida), BaixaTecnica: N(r.BaixaTecnica), Saldo: saldo, CustoUnit: cu, ValorSaldo: arred(saldo * cu, 6), Situacao: txt(r.StatusSaldo) };
    });
  }
  rel({ id: 'est_lotes', modulo: 'estoque', nome: 'Saldo por lote (entrada)',
    descricao: 'Cada entrada / lote: recebido, consumido nas OPs, perdas, saídas e baixas do Ajuste de Estoque e saldo, com o valor do saldo.',
    regra: 'Mesma conta da tela Estoque / Rastreabilidade: saldo = recebido − consumido nas OPs − perdas do lote − saídas manuais − baixas técnicas. Valor do saldo = saldo × custo unitário da entrada.',
    filtros: { periodo: 'DataEntrada', projeto: 'Projeto', produto: 'Material', produtoDesc: 'Descricao', status: 'Situacao' },
    colunas: [C('Entrada', 'Entrada'), C('DataEntrada', 'Data da entrada', 'data'), C('Material', 'Material'), C('Descricao', 'Descrição'), C('Lote', 'Lote'), C('Local', 'Localização'),
      C('Fornecedor', 'Fornecedor'), C('NF', 'Nota fiscal'), C('Projeto', 'Projeto'), C('UM', 'UM'), C('QtdEntrada', 'Recebido', 'qtd'), C('Consumo', 'Consumido nas OPs', 'qtd'),
      C('Perdas', 'Perdas do lote', 'qtd'), C('AjusteSaida', 'Saídas manuais', 'qtd'), C('BaixaTecnica', 'Baixas técnicas', 'qtd'), C('Saldo', 'Saldo', 'qtd'),
      C('CustoUnit', 'Custo unitário', 'moeda', { u: 'R$/UM', soma: false }), C('ValorSaldo', 'Valor do saldo', 'moeda', { u: 'R$' }), C('Situacao', 'Situação')],
    linhas: linhasLotes });

  function linhasMateriais() {
    if (typeof window.mesResumoMateriaisEstoque !== 'function') return [];
    return A(window.mesResumoMateriaisEstoque()).map(function (r) {
      /* os mesmos campos da visão "Por material" (saldo, reservado, disponível, situação e alerta de mínimo) */
      var fis = N(r.SaldoFisico), res = N(r.Reservado), disp = r.Disponivel !== undefined ? N(r.Disponivel) : arred(fis - res, 6);
      var min = txt(r.EstoqueMinimo) !== '' && N(r.EstoqueMinimo) > 0 ? N(r.EstoqueMinimo) : '';
      var sit = r.SituacaoMinimo !== undefined ? txt(r.SituacaoMinimo) : (typeof window.mesSituacaoMinimo === 'function' ? window.mesSituacaoMinimo(min, fis, disp) : '');
      return { Material: txt(r.CodigoMaterial), Descricao: txt(r.Material), UM: txt(r.UM), Lotes: N(r.Lotes), LotesSaldo: N(r.LotesComSaldo), Recebido: N(r.Entradas),
        Consumido: N(r.ConsumidoEncerradas), EmProducao: N(r.EmProducao), Perdas: N(r.Perdas), Saidas: N(r.AjustesSaida), Baixas: N(r.BaixasTecnicas), Saldo: fis,
        Reservado: res, Disponivel: disp, Status: txt(r.Status), Minimo: min, Situacao: sit || (min === '' ? 'Sem mínimo cadastrado' : 'OK'),
        OPs: txt(r.OPsComReserva) || A(r.OPsReserva).join('; ') };
    });
  }
  var COLS_MATERIAIS = [C('Material', 'Material'), C('Descricao', 'Descrição'), C('UM', 'UM'), C('Lotes', 'Lotes', 'int'), C('LotesSaldo', 'Lotes com saldo', 'int'),
    C('Recebido', 'Recebido', 'qtd'), C('Consumido', 'Consumido (OPs encerradas)', 'qtd'), C('EmProducao', 'Em produção (OPs abertas)', 'qtd'), C('Perdas', 'Perdas', 'qtd'),
    C('Saidas', 'Saídas manuais', 'qtd'), C('Baixas', 'Baixas técnicas', 'qtd'), C('Saldo', 'Saldo físico', 'qtd'), C('Reservado', 'Reservado p/ OPs abertas', 'qtd'),
    C('Disponivel', 'Disponível', 'qtd'), C('Status', 'Situação do saldo'), C('Minimo', 'Estoque mínimo', 'qtd'), C('Situacao', 'Situação do mínimo'), C('OPs', 'OPs com reserva')];
  rel({ id: 'est_materiais', modulo: 'estoque', nome: 'Saldo por material',
    descricao: 'Por material: recebido, consumido, em produção, perdas, saídas, saldo físico, reservado para as OPs abertas, disponível e estoque mínimo.',
    regra: 'Mesma conta da visão "Por material" do Estoque / Rastreabilidade. Disponível = saldo físico − reservado (planejado nas OPs abertas ainda não consumido).',
    filtros: { produto: 'Material', produtoDesc: 'Descricao', status: 'Status' }, colunas: COLS_MATERIAIS, linhas: linhasMateriais });
  rel({ id: 'est_minimo', modulo: 'estoque', nome: 'Materiais abaixo do estoque mínimo',
    descricao: 'Materiais com saldo físico abaixo do mínimo, ou que ficarão abaixo com as OPs abertas.',
    regra: 'Mesma regra de alerta do cadastro de materiais (1.3.0): abaixo do mínimo = saldo físico < mínimo; ficará abaixo = disponível < mínimo.',
    filtros: { produto: 'Material', produtoDesc: 'Descricao', status: 'Situacao' }, colunas: COLS_MATERIAIS,
    linhas: function () { return linhasMateriais().filter(function (r) { return /ABAIXO/i.test(r.Situacao); }); } });

  rel({ id: 'est_entradas', modulo: 'estoque', nome: 'Entradas de materiais',
    descricao: 'Todas as entradas (compras e entradas manuais): data, material, lote, quantidade, custo, fornecedor e nota fiscal.',
    regra: 'Cadastro de Entrada de Materiais. Custo total = "Custo R$" da entrada (ou quantidade × custo unitário, quando vazio).',
    filtros: { periodo: 'Data', projeto: 'Projeto', produto: 'Material', produtoDesc: 'Descricao' },
    colunas: [C('Entrada', 'Entrada'), C('Data', 'Data', 'data'), C('Material', 'Material'), C('Descricao', 'Descrição'), C('Lote', 'Lote'), C('Local', 'Localização'),
      C('Qtd', 'Recebido', 'qtd'), C('UM', 'UM'), C('CustoUnit', 'Custo unitário', 'moeda', { u: 'R$/UM', soma: false }), C('CustoTotal', 'Custo total', 'moeda', { u: 'R$' }),
      C('Fornecedor', 'Fornecedor'), C('CNPJ', 'CNPJ do fornecedor'), C('NF', 'Nota fiscal'), C('Projeto', 'Projeto'), C('Origem', 'Origem')],
    linhas: function () {
      return A((D() || {}).entradas).filter(Boolean).map(function (e) {
        var q = N(e.QtdAdquirida), cu = N(e['ValorUnitario (R$/UM)']), ct = txt(e['Custo R$']) !== '' ? N(e['Custo R$']) : arred(q * cu, 6);
        return { Entrada: txt(e.Entrada), Data: paraData(e.DataCadatro || e.DataCadastro), Material: txt(e['CódigoMaterial']), Descricao: txt(e.DescricaoMaterial), Lote: txt(e.Lote),
          Local: txt(e.Localizacao), Qtd: q, UM: txt(e.UnidadeMedida), CustoUnit: cu, CustoTotal: ct, Fornecedor: txt(e.NomeFornecedor), CNPJ: txt(e.CNPJFornecedor),
          NF: txt(e['N° NF']), Projeto: txt(e.CodigoProjeto || e.Projeto), Origem: txt(e.OrigemEntrada) || 'Entrada' };
      });
    } });

  rel({ id: 'est_consumos', modulo: 'estoque', nome: 'Consumos de material por lote',
    descricao: 'Lançamentos de consumo dos apontamentos: OP, material, entrada / lote, retirado, devolvido, consumo líquido e custo efetivo.',
    regra: 'Lançamentos "Consumo de materiais e lotes" do Apontamento de Produção. Consumo líquido = retirado − devolvido (o mesmo que baixa o saldo do lote).',
    filtros: { periodo: 'Data', projeto: 'Projeto', produto: 'Material', produtoDesc: 'Descricao', op: 'OP', status: 'StatusOP' },
    colunas: [C('Data', 'Data', 'data'), C('OP', 'OP'), C('StatusOP', 'Situação da OP'), C('Produto', 'Produto da OP'), C('Material', 'Material'), C('Descricao', 'Descrição'),
      C('Entrada', 'Entrada'), C('Lote', 'Lote'), C('Retirado', 'Retirado', 'qtd'), C('Devolvido', 'Devolvido', 'qtd'), C('Consumo', 'Consumo líquido', 'qtd'), C('UM', 'UM'),
      C('CustoUnit', 'Custo unitário do lote', 'moeda', { u: 'R$/UM', soma: false }), C('CustoEfetivo', 'Custo efetivo', 'moeda', { u: 'R$' }), C('Operador', 'Operador'),
      C('Projeto', 'Projeto'), C('Obs', 'Observações')],
    linhas: function () {
      var ops = opsMapa();
      return A((D() || {}).consumos_materiais).filter(Boolean).map(function (c) {
        var op = ops[txt(c.CodOP)] || {};
        return { Data: paraData(c.DataApontamento), OP: txt(c.CodOP), StatusOP: txt(op.Status), Produto: produtoOP(op), Material: txt(c.CodigoMaterial), Descricao: txt(c.DescricaoMaterial),
          Entrada: txt(c.Entrada), Lote: txt(c.Lote), Retirado: N(c.QtdRetirada), Devolvido: N(c.QtdDevolvida), Consumo: arred(consumoLiquido(c)), UM: txt(c.UM),
          CustoUnit: N(c.CustoUnitarioLote), CustoEfetivo: N(c.CustoEfetivo), Operador: txt(c.Operador), Projeto: projetoOP(op), Obs: txt(c.Observacoes) };
      });
    } });

  rel({ id: 'est_ajustes', modulo: 'estoque', nome: 'Ajustes de estoque',
    descricao: 'Saídas manuais, baixas técnicas, entradas manuais e correções do Ajuste de Estoque, lote a lote, com o efeito no saldo.',
    regra: 'Registros do Ajuste de Estoque. Efeito no saldo: saída/baixa = −quantidade; entrada = +quantidade; estornado = 0 (deixa de contar no saldo).',
    filtros: { periodo: 'Data', projeto: 'Projeto', produto: 'Material', produtoDesc: 'Descricao', status: 'Situacao' },
    colunas: [C('Id', 'Ajuste'), C('Data', 'Data', 'datahora'), C('Tipo', 'Tipo'), C('Sentido', 'Sentido'), C('Situacao', 'Situação'), C('Material', 'Material'), C('Descricao', 'Descrição'),
      C('Entrada', 'Entrada'), C('Lote', 'Lote'), C('Qtd', 'Quantidade', 'qtd'), C('Efeito', 'Efeito no saldo', 'qtd'), C('UM', 'UM'), C('Valor', 'Valor', 'moeda', { u: 'R$' }),
      C('Motivo', 'Motivo'), C('Projeto', 'Projeto'), C('OPRef', 'OP de referência'), C('Usuario', 'Usuário'), C('Obs', 'Observação')],
    linhas: function () {
      var out = [];
      A((D() || {}).estoque_ajustes).filter(Boolean).forEach(function (a) {
        var est = txt(a.Status) === 'ESTORNADO', sinal = est ? 0 : (txt(a.Sentido) === 'SAIDA' ? -1 : 1);
        var base = { Id: txt(a.IdAjuste), Data: paraData(a.Data), Tipo: txt(a.Tipo), Sentido: txt(a.Sentido), Situacao: txt(a.Status) || 'ATIVO', Material: txt(a.CodigoMaterial),
          Descricao: txt(a.Material), UM: txt(a.UM), Motivo: txt(a.Motivo), Projeto: txt(a.CodProjeto || a.Projeto), OPRef: txt(a.OPReferencia), Usuario: txt(a.Usuario), Obs: txt(a.Observacao) };
        var lotes = A(a.Lotes).filter(Boolean);
        if (!lotes.length) out.push(Object.assign({}, base, { Entrada: txt(a.Entrada || a.NovoLote), Lote: txt(a.Lote), Qtd: N(a.Quantidade), Efeito: arred(sinal * N(a.Quantidade)), Valor: N(a.Valor) }));
        lotes.forEach(function (l) {
          var q = N(l.Quantidade);
          out.push(Object.assign({}, base, { Entrada: txt(l.Entrada), Lote: txt(l.Lote), Qtd: q, Efeito: arred(sinal * q), Valor: txt(l.Valor) !== '' ? N(l.Valor) : (lotes.length === 1 ? N(a.Valor) : '') }));
        });
      });
      return out;
    } });

  rel({ id: 'est_inventarios', modulo: 'estoque', nome: 'Inventários de estoque',
    descricao: 'Inventários aplicados ou revertidos, lote a lote: saldo e custo antes e depois, diferença em quantidade e em valor, localização.',
    regra: 'Registros do Inventário de Estoque (o que foi aplicado em cada lote). Diferença = saldo depois − saldo antes; diferença em valor = saldo depois × custo depois − saldo antes × custo antes (a mesma conta do resumo do inventário).',
    filtros: { periodo: 'Data', produto: 'Material', produtoDesc: 'Descricao', status: 'Situacao' },
    colunas: [C('Id', 'Inventário'), C('Data', 'Data', 'datahora'), C('Situacao', 'Situação do inventário'), C('Usuario', 'Usuário'), C('Arquivo', 'Arquivo'), C('Tipo', 'Tipo da linha'),
      C('Entrada', 'Entrada'), C('Material', 'Material'), C('Descricao', 'Descrição'), C('Lote', 'Lote'), C('UM', 'UM'), C('SaldoAntes', 'Saldo antes', 'qtd'), C('SaldoDepois', 'Saldo depois', 'qtd'),
      C('Delta', 'Diferença', 'qtd'), C('CustoAntes', 'Custo unitário antes', 'moeda', { u: 'R$/UM', soma: false }), C('CustoDepois', 'Custo unitário depois', 'moeda', { u: 'R$/UM', soma: false }),
      C('DifValor', 'Diferença em valor', 'moeda', { u: 'R$' }), C('LocalAntes', 'Localização antes'), C('LocalDepois', 'Localização depois'), C('Obs', 'Observação')],
    linhas: function () {
      var out = [];
      function v(x) { return txt(x) !== '' ? N(x) : ''; }
      A((D() || {}).inventarios).filter(Boolean).forEach(function (inv) {
        var base = { Id: txt(inv.IdInventario), Data: paraData(inv.Data), Situacao: txt(inv.Status), Usuario: txt(inv.Usuario), Arquivo: txt(inv.Arquivo) };
        A(inv.Linhas).filter(Boolean).forEach(function (l) {
          var sa = v(l.SaldoAntes), sd = txt(l.SaldoDepois) !== '' ? N(l.SaldoDepois) : v(l.SaldoNovo), ca = v(l.CustoAntes),
            cd = txt(l.CustoDepois) !== '' ? N(l.CustoDepois) : (txt(l.CustoNovo) !== '' ? N(l.CustoNovo) : v(l.CustoUnitarioNovo));
          var delta = txt(l.Delta) !== '' ? N(l.Delta) : (sa !== '' && sd !== '' ? arred(sd - sa, 6) : '');
          out.push(Object.assign({}, base, { Tipo: txt(l.Tipo), Entrada: txt(l.Entrada), Material: txt(l.CodigoMaterial), Descricao: txt(l.Material || l.DescricaoMaterial), Lote: txt(l.Lote), UM: txt(l.UM),
            SaldoAntes: sa, SaldoDepois: sd, Delta: delta, CustoAntes: ca, CustoDepois: cd,
            DifValor: sd !== '' && cd !== '' ? arred(sd * cd - (sa === '' ? 0 : sa) * (ca === '' ? 0 : ca), 6) : '',
            LocalAntes: txt(l.LocalAntes), LocalDepois: txt(l.LocalDepois || l.LocalizacaoNova || l.LocalNovo), Obs: txt(l.Observacao) }));
        });
      });
      return out;
    } });

  /* ---------------- PI e PA prontos (livro do Estoque PI / PA, 1.4.0) ---------------- */
  function lotesPI() { var L = livroPI(); return L ? Object.keys(L.lotes || {}).map(function (k) { return L.lotes[k]; }) : []; }
  function linhaLote(L) {
    var op = L.op || {};
    return { Lote: L.IdLote, Tipo: L.Tipo, Produto: L.CodigoProduto, Descricao: L.Descricao, OP: L.CodOP, Familia: L.Familia, Projeto: projetoOP(op), StatusOP: txt(op.Status), UM: L.UM,
      Produzido: N(L.Produzido), Consumido: N(L.Consumido), Perdido: N(L.Perdido), Baixado: N(L.Baixado), Saldo: N(L.Saldo), Reservado: N(L.Reservado), Disponivel: N(L.Disponivel),
      SemEtiqueta: N(L.SaldoSemEtiqueta), Etiquetas: A(L.Etiquetas).length, UltimaProducao: maxData(A(L.Apontamentos).map(function (r) { return paraData(r.DataApontamento); })) };
  }
  rel({ id: 'pipa_lote', modulo: 'pipa', nome: 'Saldo de PI e PA por lote (OP)',
    descricao: 'Cada lote (produção de uma OP): produzido, consumido pelas etapas seguintes, perdido, baixado, saldo, reservado para OPs abertas e disponível.',
    regra: 'Mesma conta do Estoque PI / PA: saldo = produção apontada − consumos pelas etapas seguintes − perdas por retirada adicional − baixas. Disponível = saldo − reservado.',
    filtros: { periodo: 'UltimaProducao', projeto: 'Projeto', produto: 'Produto', produtoDesc: 'Descricao', op: 'OP', status: 'Tipo' },
    colunas: [C('Lote', 'Lote'), C('Tipo', 'Tipo'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('OP', 'OP de origem'), C('Familia', 'Família (OP de PA)'), C('StatusOP', 'Situação da OP'),
      C('UltimaProducao', 'Última produção', 'data'), C('UM', 'UM'), C('Produzido', 'Produzido', 'qtd'), C('Consumido', 'Consumido nas etapas', 'qtd'), C('Perdido', 'Perdido (retirada)', 'qtd'),
      C('Baixado', 'Baixas', 'qtd'), C('Saldo', 'Saldo', 'qtd'), C('Reservado', 'Reservado OPs abertas', 'qtd'), C('Disponivel', 'Disponível', 'qtd'),
      C('SemEtiqueta', 'Saldo sem etiqueta', 'qtd'), C('Etiquetas', 'Etiquetas', 'int'), C('Projeto', 'Projeto')],
    linhas: function () { return lotesPI().map(linhaLote); } });
  rel({ id: 'pipa_produto', modulo: 'pipa', nome: 'Saldo de PI e PA por produto',
    descricao: 'Soma dos lotes de cada PI e PA: produzido, consumido, perdido, baixado, saldo, reservado e disponível.',
    regra: 'Soma, por produto e unidade, dos lotes do relatório "Saldo de PI e PA por lote" (mesma conta do Estoque PI / PA).',
    filtros: { produto: 'Produto', produtoDesc: 'Descricao', status: 'Tipo' },
    colunas: [C('Tipo', 'Tipo'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('UM', 'UM'), C('Produzido', 'Produzido', 'qtd'), C('Consumido', 'Consumido nas etapas', 'qtd'),
      C('Perdido', 'Perdido (retirada)', 'qtd'), C('Baixado', 'Baixas', 'qtd'), C('Saldo', 'Saldo', 'qtd'), C('Reservado', 'Reservado OPs abertas', 'qtd'), C('Disponivel', 'Disponível', 'qtd'),
      C('Lotes', 'Lotes', 'int'), C('LotesSaldo', 'Lotes com saldo', 'int')],
    linhas: function () {
      var por = {}, ordem = [];
      lotesPI().map(linhaLote).forEach(function (l) {
        var k = l.Tipo + '|' + l.Produto + '|' + l.UM;
        if (!por[k]) { por[k] = { Tipo: l.Tipo, Produto: l.Produto, Descricao: l.Descricao, UM: l.UM, Produzido: 0, Consumido: 0, Perdido: 0, Baixado: 0, Saldo: 0, Reservado: 0, Disponivel: 0, Lotes: 0, LotesSaldo: 0 }; ordem.push(k); }
        var p = por[k];
        ['Produzido', 'Consumido', 'Perdido', 'Baixado', 'Saldo', 'Reservado', 'Disponivel'].forEach(function (c) { p[c] = arred(p[c] + l[c]); });
        p.Lotes++; if (l.Saldo > 1e-9) p.LotesSaldo++;
      });
      return ordem.map(function (k) { return por[k]; }).sort(function (a, b) { return (a.Tipo + a.Produto).localeCompare(b.Tipo + b.Produto, 'pt-BR', { numeric: true }); });
    } });
  rel({ id: 'pipa_etiquetas', modulo: 'pipa', nome: 'Etiquetas de PI e PA',
    descricao: 'Etiquetas emitidas no apontamento: produto, OP, lote, quantidade, saldo da etiqueta, situação, modo de geração e impressão.',
    regra: 'Etiquetas do Estoque PI / PA. Saldo da etiqueta = quantidade − movimentos lidos pela etiqueta − rateio dos movimentos do lote sem etiqueta (mesma regra da visão "Por etiqueta").',
    filtros: { periodo: 'Data', projeto: 'Projeto', produto: 'Produto', produtoDesc: 'Descricao', op: 'OP', status: 'Situacao' },
    colunas: [C('Etiqueta', 'Etiqueta'), C('Tipo', 'Tipo'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('OP', 'OP'), C('Lote', 'Lote'), C('NOP', 'Apontamento'),
      C('Data', 'Data da produção', 'data'), C('Quantidade', 'Quantidade', 'qtd'), C('Saldo', 'Saldo', 'qtd'), C('UM', 'UM'), C('Situacao', 'Situação'), C('Modo', 'Modo'),
      C('Seq', 'Sequência'), C('Processo', 'Processo'), C('Operador', 'Operador'), C('Impressa', 'Impressa em'), C('Projeto', 'Projeto')],
    linhas: function () {
      var L = livroPI(), por = (L && L.porEtiqueta) || {};
      return A((D() || {}).etiquetas_producao).filter(Boolean).map(function (e) {
        var x = por[e.IdEtiqueta], ativa = txt(e.Status) !== 'CANCELADA';
        var saldo = ativa && x && x.et ? N(x.et.Saldo) : 0;
        return { Etiqueta: txt(e.IdEtiqueta), Tipo: txt(e.TipoProduto), Produto: txt(e.CodigoProduto), Descricao: txt(e.DescricaoProduto), OP: txt(e.CodOP), Lote: txt(e.IdLote), NOP: txt(e.NOP),
          Data: paraData(e.DataProducao), Quantidade: N(e.Quantidade), Saldo: saldo, UM: txt(e.UM), Situacao: !ativa ? 'CANCELADA' : (saldo > 1e-9 ? 'COM SALDO' : 'SEM SALDO'),
          Modo: txt(e.Modo), Seq: txt(e.Sequencia) + (txt(e.TotalEtiquetas) ? '/' + txt(e.TotalEtiquetas) : ''), Processo: txt(e.Processo), Operador: txt(e.Operador),
          Impressa: txt(e.ImpressaEm), Projeto: txt(e.Projeto) };
      });
    } });
  rel({ id: 'pipa_mov', modulo: 'pipa', nome: 'Movimentos de PI e PA',
    descricao: 'Produção (+), consumo pelas etapas seguintes, perdas por retirada adicional e baixas (−) de cada lote, com o saldo após cada movimento.',
    regra: 'Movimentos do livro do Estoque PI / PA. O saldo após o último movimento de cada lote é o saldo do lote.',
    filtros: { periodo: 'Data', produto: 'Produto', produtoDesc: 'Descricao', op: 'OPLote', status: 'Movimento' },
    colunas: [C('Lote', 'Lote'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('OPLote', 'OP do lote'), C('Data', 'Data', 'data'), C('Movimento', 'Movimento'),
      C('Documento', 'Documento'), C('OPMov', 'OP do movimento'), C('Etiqueta', 'Etiqueta'), C('Qtd', 'Quantidade', 'qtd'), C('SaldoApos', 'Saldo após', 'qtd', { soma: false }),
      C('UM', 'UM'), C('Detalhe', 'Detalhe')],
    linhas: function () {
      var out = [];
      lotesPI().forEach(function (L) {
        var movs = [];
        A(L.Apontamentos).forEach(function (r) { movs.push({ Data: paraData(r.DataApontamento), Movimento: 'Produção', Documento: txt(r.NOP), OPMov: txt(r.CodOP), Etiqueta: '', Qtd: qtdProducao(r), Detalhe: txt(r.Processo) }); });
        A(L.Consumos).forEach(function (c) { movs.push({ Data: paraData(c.DataConsumo || c.DataApontamento), Movimento: txt(c.Origem) === 'BAIXA_AUTOMATICA_ENCERRAMENTO' ? 'Consumo (baixa automática no encerramento)' : (txt(c.Origem) === 'BAIXA_LEGADO_1.4.0' ? 'Consumo (integração de dados anteriores à 1.4.0)' : 'Consumo pela etapa seguinte'), Documento: txt(c.IdConsumoPI), OPMov: txt(c.CodOPConsumidora), Etiqueta: txt(c.IdEtiqueta), Qtd: -N(c.QuantidadeConsumida), Detalhe: txt(c.Processo) }); });
        A(L.Perdas).forEach(function (p) { movs.push({ Data: paraData(p.DataApontamento), Movimento: 'Perda (retirada adicional)', Documento: txt(p.NOPP), OPMov: txt(p.CodOP), Etiqueta: txt(p.IdEtiqueta), Qtd: -N(p.QuantidadePerdida), Detalhe: txt(p.Motivo) }); });
        A(L.Baixas).forEach(function (a) { movs.push({ Data: paraData(a.Data), Movimento: 'Baixa', Documento: txt(a.IdAjustePI), OPMov: '', Etiqueta: txt(a.IdEtiqueta), Qtd: -N(a.Quantidade), Detalhe: txt(a.Motivo) }); });
        movs.sort(function (a, b) { return (a.Data ? a.Data.getTime() : 0) - (b.Data ? b.Data.getTime() : 0) || (b.Qtd - a.Qtd); });
        var s = 0;
        movs.forEach(function (m) { s = arred(s + m.Qtd); out.push(Object.assign({ Lote: L.IdLote, Produto: L.CodigoProduto, Descricao: L.Descricao, OPLote: L.CodOP, UM: L.UM, SaldoApos: s }, m)); });
      });
      return out;
    } });
  rel({ id: 'pi_consumos', modulo: 'pipa', nome: 'Consumos de PI pelas OPs',
    descricao: 'PIs consumidos pelas OPs das etapas seguintes: etiqueta / lote, OP de origem, retirado, devolvido, perdido na etapa e consumido.',
    regra: 'Consumos de PI do Apontamento de Produção e baixas automáticas no encerramento. Consumido = retirado − devolvido; a perda na etapa é parte do consumido.',
    filtros: { periodo: 'Data', produto: 'PI', produtoDesc: 'Descricao', op: 'OP', status: 'Situacao' },
    colunas: [C('Data', 'Data', 'data'), C('OP', 'OP consumidora'), C('Etapa', 'Etapa'), C('Maquina', 'Máquina'), C('PI', 'PI'), C('Descricao', 'Descrição'), C('Etiqueta', 'Etiqueta'),
      C('Lote', 'Lote do PI'), C('OPOrigem', 'OP de origem'), C('Retirado', 'Retirado', 'qtd'), C('Devolvido', 'Devolvido', 'qtd'), C('Perdido', 'Perdido na etapa', 'qtd'),
      C('Consumido', 'Consumido', 'qtd'), C('UM', 'UM'), C('Origem', 'Origem do lançamento'), C('Situacao', 'Situação'), C('Operador', 'Operador')],
    linhas: function () {
      var desc = mapaDescricoes(), maq = mapaMaquinas();
      return A((D() || {}).op_pi_consumos).filter(Boolean).map(function (c) {
        return { Data: paraData(c.DataConsumo || c.DataApontamento), OP: txt(c.CodOPConsumidora), Etapa: etapaTxt(c.OrdemEtapa, c.Processo), Maquina: maquinaTxt(c.CodEquipamento, c.Equipamento, maq),
          PI: txt(c.CodigoPI), Descricao: desc[txt(c.CodigoPI)] || '', Etiqueta: txt(c.IdEtiqueta), Lote: txt(c.IdLotePI), OPOrigem: txt(c.CodOPOrigemPI),
          Retirado: N(c.QtdRetirada), Devolvido: N(c.QtdDevolvida), Perdido: N(c.QtdPerdidaNaEtapa), Consumido: N(c.QuantidadeConsumida), UM: txt(c.UM),
          Origem: origemConsumoPI(c.Origem), Situacao: consumoPIAtivo(c) ? 'ATIVO' : 'CANCELADO', Operador: txt(c.Operador) };
      });
    } });

  /* ---------------- Produção ---------------- */
  rel({ id: 'prod_ops', modulo: 'producao', nome: 'Ordens de produção',
    descricao: 'Cada OP: planejado, produzido (soma dos apontamentos), perdas do produto, saldo a produzir, atendimento, datas, lead time, tempos e etiquetas.',
    regra: 'Produzido = soma dos apontamentos de produção (regra da 1.4.0). Perdas do produto = perdas da OP que não são de material. Saldo a produzir = planejado − produzido (negativo = produziu a mais). Índice de perda = perdas ÷ (produzido + perdas). Lead time = encerramento − abertura, em dias corridos.',
    filtros: { periodo: 'Abertura', projeto: 'Projeto', produto: 'Produto', produtoDesc: 'Descricao', op: 'OP', status: 'Status' },
    colunas: [C('OP', 'OP'), C('Tipo', 'Tipo'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('Familia', 'Família (OP de PA)'), C('Projeto', 'Projeto'), C('Roteiro', 'Roteiro'),
      C('Status', 'Situação'), C('UM', 'UM'), C('Planejado', 'Planejado', 'qtd'), C('Produzido', 'Produzido', 'qtd'), C('Perdas', 'Perdas do produto', 'qtd'),
      C('Saldo', 'Saldo a produzir', 'qtd'), C('Atendido', 'Atendido', 'pct'), C('IndicePerda', 'Índice de perda', 'pct'), C('Abertura', 'Abertura', 'data'),
      C('Encerramento', 'Encerramento', 'datahora'), C('LeadTime', 'Lead time', 'num', { u: 'dias', casas: 1, soma: false }), C('TempoPlan', 'Tempo planejado', 'min', { u: 'min' }),
      C('TempoReal', 'Tempo real apontado', 'min', { u: 'min' }), C('Etiquetas', 'Etiquetas emitidas', 'int')],
    linhas: function () {
      var prod = producaoPorOP(), a = api14(), tempos = {}, ets = {};
      A((D() || {}).apontamento_tempos).forEach(function (t) { if (t && txt(t.Status) === 'Finalizado') tempos[txt(t.CodOP)] = (tempos[txt(t.CodOP)] || 0) + duracaoTempo(t); });
      A((D() || {}).etiquetas_producao).forEach(function (e) { if (e && txt(e.Status) !== 'CANCELADA') ets[txt(e.CodOP)] = (ets[txt(e.CodOP)] || 0) + 1; });
      return A((D() || {}).op).filter(function (o) { return o && o.CodOP; }).map(function (o) {
        var cod = txt(o.CodOP), plan = N(o.QtdPlanejada), pr = prod[cod] || 0, pe = arred(perdasProduto(cod)), ab = paraData(o.DataOP || o.DataCriacao), en = paraData(o.DataEncerramento);
        var plt = 0;
        if (a && typeof a.maquinasDaOP === 'function') { try { plt = A(a.maquinasDaOP(o)).reduce(function (s, m) { return s + N(m.Planejado); }, 0); } catch (e) { plt = 0; } }
        return { OP: cod, Tipo: txt(o.TipoOP), Produto: produtoOP(o), Descricao: txt(o.DescricaoProduto), Familia: raiz(o), Projeto: projetoOP(o), Roteiro: txt(o.CodRoteiro),
          Status: txt(o.Status), UM: txt(o.UM), Planejado: plan, Produzido: pr, Perdas: pe, Saldo: arred(plan - pr), Atendido: plan > 0 ? arred(pr / plan * 100, 6) : '',
          IndicePerda: pr + pe > 0 ? arred(pe / (pr + pe) * 100, 6) : '', Abertura: ab, Encerramento: en,
          LeadTime: ab && en ? arred((en - new Date(ab.getFullYear(), ab.getMonth(), ab.getDate())) / 86400000, 2) : '',
          TempoPlan: arred(plt, 2), TempoReal: arred(tempos[cod] || 0, 2), Etiquetas: ets[cod] || 0 };
      });
    } });
  rel({ id: 'prod_apont', modulo: 'producao', nome: 'Apontamentos de produção',
    descricao: 'Cada apontamento: data, OP, produto, processo, operador, quantidade e etiquetas geradas.',
    regra: 'Registros do Apontamento de Produção. A soma por OP é a quantidade produzida da OP.',
    filtros: { periodo: 'Data', projeto: 'Projeto', produto: 'Produto', produtoDesc: 'Descricao', op: 'OP' },
    colunas: [C('NOP', 'Apontamento'), C('Data', 'Data', 'data'), C('OP', 'OP'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('Processo', 'Processo'), C('Operador', 'Operador'),
      C('Qtd', 'Quantidade', 'qtd'), C('UM', 'UM'), C('Etiquetas', 'Etiquetas', 'int'), C('Projeto', 'Projeto'), C('Obs', 'Observações')],
    linhas: function () {
      var ops = opsMapa(), ets = {};
      A((D() || {}).etiquetas_producao).forEach(function (e) { if (e && txt(e.Status) !== 'CANCELADA') ets[txt(e.NOP)] = (ets[txt(e.NOP)] || 0) + 1; });
      return A((D() || {}).producao).filter(Boolean).map(function (r) {
        var op = ops[txt(r.CodOP)] || {};
        return { NOP: txt(r.NOP), Data: paraData(r.DataApontamento), OP: txt(r.CodOP), Produto: txt(r.ProdutoApontado || r.Produto), Descricao: txt(r.DescricaoProduto), Processo: txt(r.Processo),
          Operador: txt(r.Operador), Qtd: qtdProducao(r), UM: txt(r['Unidade de medida'] || r.Unidade) || txt(op.UM), Etiquetas: ets[txt(r.NOP)] || 0, Projeto: projetoOP(op), Obs: txt(r.Observacoes) };
      });
    } });
  rel({ id: 'prod_consumo', modulo: 'producao', nome: 'Consumo planejado × real (materiais e PIs)',
    descricao: 'Por OP e item: quantidade planejada, consumida, desvio e custo efetivo — matérias-primas e PIs.',
    regra: 'Matéria-prima: planejado = linhas da OP; consumido = consumos por lote (retirado − devolvido) ou, sem consumo por lote, o consumo antigo da linha da OP (mesma regra das reservas do Estoque). PI: consumido pelos consumos de PI da OP (1.4.0); a perda na etapa é parte do consumido. Desvio = consumido − planejado.',
    filtros: { projeto: 'Projeto', produto: 'Item', produtoDesc: 'Descricao', op: 'OP', status: 'StatusOP' },
    colunas: [C('OP', 'OP'), C('StatusOP', 'Situação da OP'), C('Tipo', 'Tipo'), C('Etapa', 'Etapa'), C('Item', 'Item'), C('Descricao', 'Descrição'), C('UM', 'UM'),
      C('Planejado', 'Planejado', 'qtd'), C('Consumido', 'Consumido', 'qtd'), C('Desvio', 'Desvio', 'qtd'), C('DesvioPct', 'Desvio', 'pct', { u: '%' }),
      C('PerdidoEtapa', 'Perdido na etapa (PI)', 'qtd'), C('CustoEfetivo', 'Custo efetivo', 'moeda', { u: 'R$' }), C('Projeto', 'Projeto')],
    linhas: function () {
      var d = D() || {}, ops = opsMapa(), desc = mapaDescricoes(), cons = {}, custo = {}, plan = {}, ordem = [], out = [], a = api14();
      A(d.consumos_materiais).forEach(function (c) {
        if (!c || !ops[txt(c.CodOP)]) return;
        var k = txt(c.CodOP) + '|' + txt(c.CodigoMaterial);
        cons[k] = (cons[k] || 0) + consumoLiquido(c); custo[k] = (custo[k] || 0) + N(c.CustoEfetivo);
        if (!plan[k]) { plan[k] = { OP: txt(c.CodOP), Item: txt(c.CodigoMaterial), Desc: txt(c.DescricaoMaterial), UM: txt(c.UM), Etapa: '', Planejado: 0, Legado: 0, semPlano: true }; ordem.push(k); }
      });
      A(d.op_materiais).forEach(function (m) {
        if (!m || ehLinhaPI(m) || !ops[txt(m.CodOP)] || !txt(m.CodigoMaterial)) return;
        var k = txt(m.CodOP) + '|' + txt(m.CodigoMaterial);
        if (!plan[k]) { plan[k] = { OP: txt(m.CodOP), Item: txt(m.CodigoMaterial), Desc: txt(m.DescricaoMaterial), UM: txt(m.UM), Etapa: '', Planejado: 0, Legado: 0 }; ordem.push(k); }
        var p = plan[k];
        if (p.semPlano) { p.semPlano = false; p.UM = txt(m.UM) || p.UM; }
        if (!p.Etapa) p.Etapa = etapaTxt(m.OrdemEtapa || m.Ordem, m.Processo);
        p.Planejado += N(m.QtdPlanejada || m.QtdBase || m.Qtd);
        p.Legado += N(m.QtdConsumida || 0);
      });
      ordem.forEach(function (k) {
        var p = plan[k], op = ops[p.OP] || {}, c = cons[k] !== undefined ? cons[k] : p.Legado, pl = arred(p.Planejado), cs = arred(c), dv = arred(cs - pl);
        out.push({ OP: p.OP, StatusOP: txt(op.Status), Tipo: 'Matéria-prima', Etapa: p.Etapa, Item: p.Item, Descricao: p.Desc || desc[p.Item] || '', UM: p.UM, Planejado: pl, Consumido: cs,
          Desvio: dv, DesvioPct: pl > 0 ? arred(dv / pl * 100, 6) : '', PerdidoEtapa: '', CustoEfetivo: custo[k] !== undefined ? arred(custo[k], 6) : '', Projeto: projetoOP(op) });
      });
      Object.keys(ops).forEach(function (cod) {
        var op = ops[cod], linhas = [];
        try { linhas = a && typeof a.linhasPIDaOP === 'function' ? A(a.linhasPIDaOP(cod)) : A(d.op_materiais).filter(function (m) { return m && txt(m.CodOP) === cod && ehLinhaPI(m); }); } catch (e) { linhas = []; }
        var por = {};
        linhas.forEach(function (m) {
          var pi = txt(m.CodigoMaterial || m.CodigoPI); if (!pi) return;
          var x = por[pi] || (por[pi] = { Planejado: 0, UM: txt(m.UM), Etapa: etapaTxt(m.OrdemEtapa || m.Ordem, m.Processo), Desc: txt(m.DescricaoMaterial) });
          x.Planejado += N(m.QtdPlanejada);
        });
        A(d.op_pi_consumos).forEach(function (c) {
          if (!consumoPIAtivo(c) || txt(c.CodOPConsumidora) !== cod) return;
          var pi = txt(c.CodigoPI); if (!pi) return;
          var x = por[pi] || (por[pi] = { Planejado: 0, UM: txt(c.UM), Etapa: etapaTxt(c.OrdemEtapa, c.Processo), Desc: '' });
          x.Perdido = (x.Perdido || 0) + N(c.QtdPerdidaNaEtapa);
        });
        Object.keys(por).forEach(function (pi) {
          var x = por[pi], cs = 0;
          try { cs = a && typeof a.consumidoPelaOP === 'function' ? N(a.consumidoPelaOP(cod, pi)) : 0; } catch (e) { cs = 0; }
          var pl = arred(x.Planejado), dv = arred(cs - pl);
          out.push({ OP: cod, StatusOP: txt(op.Status), Tipo: 'PI', Etapa: x.Etapa, Item: pi, Descricao: x.Desc || desc[pi] || '', UM: x.UM, Planejado: pl, Consumido: arred(cs),
            Desvio: dv, DesvioPct: pl > 0 ? arred(dv / pl * 100, 6) : '', PerdidoEtapa: arred(x.Perdido || 0), CustoEfetivo: '', Projeto: projetoOP(op) });
        });
      });
      return out;
    } });

  /* ---------------- Tempo por máquina ---------------- */
  rel({ id: 'tempo_apont', modulo: 'tempo', nome: 'Apontamentos de tempo',
    descricao: 'Cada apontamento de tempo: início, fim, duração, OP, etapa, máquina, operador e situação.',
    regra: 'Apontamentos de tempo por máquina (1.4.0). Duração = fim − início (o fim antes do início, sem data de fim, passa da meia-noite). Em andamento não tem duração.',
    filtros: { periodo: 'Inicio', projeto: 'Projeto', produto: 'Produto', op: 'OP', maquina: 'CodMaquina', status: 'Status' },
    colunas: [C('Inicio', 'Início', 'datahora'), C('Fim', 'Fim', 'datahora'), C('Duracao', 'Duração', 'min', { u: 'min' }), C('Horas', 'Duração', 'h', { u: 'h' }), C('OP', 'OP'),
      C('Produto', 'Produto'), C('Etapa', 'Etapa'), C('Maquina', 'Máquina'), C('CodMaquina', 'Código da máquina'), C('Operador', 'Operador'), C('Status', 'Situação'),
      C('Origem', 'Origem'), C('Projeto', 'Projeto'), C('Obs', 'Observações')],
    linhas: function () {
      var ops = opsMapa(), maq = mapaMaquinas();
      return A((D() || {}).apontamento_tempos).filter(Boolean).map(function (t) {
        var op = ops[txt(t.CodOP)] || {}, fin = txt(t.Status) === 'Finalizado', dur = fin ? duracaoTempo(t) : '';
        return { Inicio: inicioTempo(t), Fim: fimTempo(t), Duracao: dur, Horas: dur === '' ? '' : arred(dur / 60, 6), OP: txt(t.CodOP), Produto: produtoOP(op), Etapa: etapaTxt(t.OrdemEtapa, t.Processo),
          Maquina: chaveTempo(t) ? maquinaTxt(t.CodEquipamento, t.Equipamento, maq) : '(sem máquina)', CodMaquina: txt(t.CodEquipamento), Operador: txt(t.Operador),
          Status: fin ? 'Finalizado' : (txt(t.Status) || 'Em andamento'), Origem: txt(t.Origem), Projeto: projetoOP(op), Obs: txt(t.Observacoes) };
      });
    } });
  rel({ id: 'tempo_maquina_op', modulo: 'tempo', nome: 'Tempo planejado × real por máquina e OP',
    descricao: 'Cada máquina de cada OP: tempo planejado no roteiro, tempo real apontado (finalizado), diferença e apontamentos em andamento.',
    regra: 'Mesma regra da 1.4.0: o tempo real finalizado de uma máquina (soma dos intervalos) substitui o planejado dela na energia e na mão de obra; sem apontamento vale o planejado. Diferença = real − planejado.',
    filtros: { projeto: 'Projeto', produto: 'Produto', op: 'OP', maquina: 'CodMaquina', status: 'Situacao' },
    colunas: [C('OP', 'OP'), C('StatusOP', 'Situação da OP'), C('Produto', 'Produto'), C('Etapa', 'Etapa'), C('Maquina', 'Máquina'), C('CodMaquina', 'Código da máquina'),
      C('Planejado', 'Planejado', 'min', { u: 'min' }), C('Real', 'Real finalizado', 'min', { u: 'min' }), C('Diferenca', 'Diferença', 'min', { u: 'min' }),
      C('RealPct', 'Real ÷ planejado', 'pct'), C('Apontamentos', 'Apontamentos finalizados', 'int'), C('Andamento', 'Em andamento', 'int'), C('Situacao', 'Situação'), C('Projeto', 'Projeto')],
    linhas: function () {
      var a = api14(), out = [], maq = mapaMaquinas(), porOP = {};
      A((D() || {}).apontamento_tempos).forEach(function (t) { if (t) (porOP[txt(t.CodOP)] = porOP[txt(t.CodOP)] || []).push(t); });
      A((D() || {}).op).filter(function (o) { return o && o.CodOP; }).forEach(function (op) {
        var cod = txt(op.CodOP), ts = porOP[cod] || [], maqs = [];
        try { maqs = a && typeof a.maquinasDaOP === 'function' ? A(a.maquinasDaOP(op)) : []; } catch (e) { maqs = []; }
        var usados = {};
        maqs.forEach(function (m) {
          var meus = ts.filter(function (t) { return chaveTempo(t) === m.chave; }); usados[m.chave] = 1;
          var fin = meus.filter(function (t) { return txt(t.Status) === 'Finalizado'; }), real = arred(fin.reduce(function (s, t) { return s + duracaoTempo(t); }, 0), 2);
          var andam = meus.length - fin.length, pl = N(m.Planejado);
          out.push({ OP: cod, StatusOP: txt(op.Status), Produto: produtoOP(op), Etapa: etapaTxt(m.Ordem, m.Processo), Maquina: maquinaTxt(m.CodEquipamento, m.Equipamento, maq),
            CodMaquina: txt(m.CodEquipamento), Planejado: pl, Real: fin.length ? real : '', Diferenca: fin.length ? arred(real - pl, 2) : '', RealPct: fin.length && pl > 0 ? arred(real / pl * 100, 6) : '',
            Apontamentos: fin.length, Andamento: andam, Situacao: andam ? 'Em andamento' : (fin.length ? 'Apontado' : 'Sem apontamento (vale o planejado)'), Projeto: projetoOP(op) });
        });
        var soltos = ts.filter(function (t) { return !chaveTempo(t) || !usados[chaveTempo(t)]; });
        if (soltos.length) {
          var fin2 = soltos.filter(function (t) { return txt(t.Status) === 'Finalizado'; });
          out.push({ OP: cod, StatusOP: txt(op.Status), Produto: produtoOP(op), Etapa: '', Maquina: '(sem máquina)', CodMaquina: '', Planejado: '', Real: arred(fin2.reduce(function (s, t) { return s + duracaoTempo(t); }, 0), 2),
            Diferenca: '', RealPct: '', Apontamentos: fin2.length, Andamento: soltos.length - fin2.length, Situacao: 'Sem máquina: não entra no tempo real', Projeto: projetoOP(op) });
        }
      });
      return out;
    } });
  rel({ id: 'tempo_maquina_mes', modulo: 'tempo', nome: 'Horas reais por máquina e mês',
    descricao: 'Soma dos apontamentos de tempo finalizados por máquina e mês do início: quantidade de apontamentos, minutos, horas e OPs.',
    regra: 'Soma das durações dos apontamentos finalizados, agrupadas pelo mês do início do apontamento.',
    filtros: { periodo: 'InicioRef', maquina: 'CodMaquina' },
    colunas: [C('Mes', 'Mês'), C('Maquina', 'Máquina'), C('CodMaquina', 'Código da máquina'), C('Apontamentos', 'Apontamentos', 'int'), C('Minutos', 'Minutos', 'min', { u: 'min' }),
      C('Horas', 'Horas', 'h', { u: 'h' }), C('OPs', 'OPs'), C('InicioRef', 'Primeiro início', 'datahora')],
    linhas: function (f) {
      var por = {}, maq = mapaMaquinas(), de = f && f.de ? paraData(f.de) : null, ate = f && f.ate ? paraData(f.ate) : null;
      if (ate) ate = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate(), 23, 59, 59, 999);
      A((D() || {}).apontamento_tempos).forEach(function (t) {
        if (!t || txt(t.Status) !== 'Finalizado') return;
        var i = inicioTempo(t); if (!i) return;
        if ((de && i < de) || (ate && i > ate)) return;
        var cod = chaveTempo(t) ? txt(t.CodEquipamento) : '', mes = i.getFullYear() + '-' + pad(i.getMonth() + 1), k = mes + '|' + (chaveTempo(t) ? cod : '#');
        var x = por[k] || (por[k] = { Mes: mes, Maquina: chaveTempo(t) ? maquinaTxt(cod, t.Equipamento, maq) : '(sem máquina)', CodMaquina: cod, Apontamentos: 0, Minutos: 0, ops: {}, InicioRef: i });
        x.Apontamentos++; x.Minutos += duracaoTempo(t); x.ops[txt(t.CodOP)] = 1; if (i < x.InicioRef) x.InicioRef = i;
      });
      return Object.keys(por).sort().map(function (k) { var x = por[k]; return { Mes: x.Mes, Maquina: x.Maquina, CodMaquina: x.CodMaquina, Apontamentos: x.Apontamentos, Minutos: arred(x.Minutos, 2), Horas: arred(x.Minutos / 60, 6), OPs: Object.keys(x.ops).join('; '), InicioRef: x.InicioRef }; });
    }, periodoInterno: true });

  /* ---------------- Perdas ---------------- */
  function origemPerda(p) {
    var o = txt(p.OrigemPerda);
    if (o === 'DENTRO_DO_CONSUMO') return 'Dentro do consumo apontado';
    if (o === 'RETIRADA_ADICIONAL') return 'Retirada adicional do estoque';
    return String(p.PerdaAlvoTipo || '').toUpperCase() === 'MATERIAL' ? 'Sem origem (antes da 1.4.0)' : 'Perda do produto';
  }
  function linhasPerdas() {
    var ops = opsMapa(), desc = mapaDescricoes(), maq = mapaMaquinas(), mot = {};
    A((D() || {}).perdas_motivos).forEach(function (m) { if (m) mot[txt(m.IdMotivo)] = m; });
    return A((D() || {}).perdas).filter(Boolean).map(function (p) {
      var op = ops[txt(p.CodOP)] || {}, material = String(p.PerdaAlvoTipo || '').toUpperCase() === 'MATERIAL', item = txt(p.ItemPerdaCodigo || p.CodigoMaterial || p.Produto);
      var custo = '', info = '', regra = '';
      if (material && typeof v102MaterialLossCost === 'function') {
        try { var c = v102MaterialLossCost(p, op) || {}; custo = N(c.total); info = c.valorInformativo != null ? N(c.valorInformativo) : ''; regra = txt(c.rule); } catch (e) { custo = ''; }
      }
      var m = mot[txt(p.IdMotivo)];
      return { NOPP: txt(p.NOPP), Data: paraData(p.DataApontamento), OP: txt(p.CodOP), Produto: produtoOP(op) || txt(p.Produto), Etapa: etapaTxt(p.OrdemEtapa, p.Processo),
        Maquina: txt(p.CodEquipamento) ? maquinaTxt(p.CodEquipamento, p.Equipamento, maq) : '', CodMaquina: txt(p.CodEquipamento), TipoItem: material ? (/^PI/i.test(item) ? 'PI' : 'Material') : 'Produto',
        Item: item, Descricao: txt(p.ItemPerdaDescricao) || desc[item] || txt(p.DescricaoProduto), Qtd: N(p.QuantidadePerdida || p.Quantidade), UM: txt(p.Unidade),
        Categoria: (m && txt(m.Categoria)) || txt(p.TipoApontamento), Motivo: (m && txt(m.Motivo)) || txt(p.Motivo), Origem: origemPerda(p), Custo: custo, ValorInfo: info,
        RegraCusto: regra, Operador: txt(p.Operador), Projeto: projetoOP(op), Obs: txt(p.Observacoes) };
    });
  }
  rel({ id: 'perdas_lista', modulo: 'perdas', nome: 'Perdas registradas',
    descricao: 'Cada perda: data, OP, etapa, máquina, item perdido, quantidade, categoria, motivo, origem e custo da perda.',
    regra: 'Registro de Perdas. Custo da perda = mesma regra do custo da família (1.4.0): perda dentro do consumo apontado e perda de PI da própria família não somam custo de novo (o valor fica como informativo).',
    filtros: { periodo: 'Data', projeto: 'Projeto', produto: 'Item', produtoDesc: 'Descricao', op: 'OP', maquina: 'CodMaquina', status: 'Categoria' },
    colunas: [C('NOPP', 'Perda'), C('Data', 'Data', 'data'), C('OP', 'OP'), C('Produto', 'Produto da OP'), C('Etapa', 'Etapa'), C('Maquina', 'Máquina'), C('TipoItem', 'Tipo do item'),
      C('Item', 'Item perdido'), C('Descricao', 'Descrição'), C('Qtd', 'Quantidade', 'qtd'), C('UM', 'UM'), C('Categoria', 'Categoria'), C('Motivo', 'Motivo'), C('Origem', 'Origem da perda'),
      C('Custo', 'Custo da perda', 'moeda', { u: 'R$' }), C('ValorInfo', 'Valor informativo (não soma)', 'moeda', { u: 'R$', soma: false }), C('Operador', 'Operador'), C('Projeto', 'Projeto'),
      C('RegraCusto', 'Regra do custo'), C('Obs', 'Observações')],
    linhas: linhasPerdas });
  rel({ id: 'perdas_pareto', modulo: 'perdas', nome: 'Pareto de perdas por motivo',
    descricao: 'Perdas agrupadas por categoria e motivo: ocorrências, custo, participação e acumulado (Pareto), com as quantidades por unidade.',
    regra: 'Ordenado pelo custo da perda (quando houver custo) ou pelo número de ocorrências; % acumulado na mesma medida. Quantidades de unidades diferentes ficam separadas, nunca somadas.',
    filtros: { periodo: 'DataRef', op: 'OPs', maquina: 'Maquinas', status: 'Categoria' },
    colunas: [C('Categoria', 'Categoria'), C('Motivo', 'Motivo'), C('Ocorrencias', 'Ocorrências', 'int'), C('Custo', 'Custo da perda', 'moeda', { u: 'R$' }), C('Pct', 'Participação', 'pct'),
      C('PctAcum', 'Acumulado', 'pct'), C('Quantidades', 'Quantidades por UM'), C('OPs', 'OPs'), C('Maquinas', 'Máquinas'), C('DataRef', 'Última perda', 'data')],
    linhas: function (f) {
      var de = f && f.de ? paraData(f.de) : null, ate = f && f.ate ? paraData(f.ate) : null, por = {};
      if (ate) ate = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate(), 23, 59, 59, 999);
      linhasPerdas().forEach(function (p) {
        if ((de || ate) && (!p.Data || (de && p.Data < de) || (ate && p.Data > ate))) return;
        if (f && f.ops instanceof Set && !f.ops.has(p.OP)) return;
        var k = norm(p.Categoria) + '|' + norm(p.Motivo || '(sem motivo)');
        var x = por[k] || (por[k] = { Categoria: p.Categoria || '(sem categoria)', Motivo: p.Motivo || '(sem motivo)', Ocorrencias: 0, Custo: 0, qtd: {}, ops: {}, maqs: {}, DataRef: null });
        x.Ocorrencias++; x.Custo += typeof p.Custo === 'number' ? p.Custo : 0; x.qtd[p.UM || '—'] = (x.qtd[p.UM || '—'] || 0) + p.Qtd; x.ops[p.OP] = 1; if (p.CodMaquina) x.maqs[p.CodMaquina] = 1;
        if (p.Data && (!x.DataRef || p.Data > x.DataRef)) x.DataRef = p.Data;
      });
      var lista = Object.keys(por).map(function (k) { return por[k]; }), totC = lista.reduce(function (s, x) { return s + x.Custo; }, 0), totO = lista.reduce(function (s, x) { return s + x.Ocorrencias; }, 0);
      var porCusto = totC > 1e-9;
      lista.sort(function (a, b) { return porCusto ? (b.Custo - a.Custo) || (b.Ocorrencias - a.Ocorrencias) : (b.Ocorrencias - a.Ocorrencias) || (b.Custo - a.Custo); });
      var acum = 0;
      var linhas = lista.map(function (x) {
        var base = porCusto ? x.Custo / totC : x.Ocorrencias / totO;
        acum += base;
        return { Categoria: x.Categoria, Motivo: x.Motivo, Ocorrencias: x.Ocorrencias, Custo: arred(x.Custo, 6), Pct: arred(base * 100, 6), PctAcum: arred(Math.min(1, acum) * 100, 6),
          Quantidades: Object.keys(x.qtd).map(function (u) { return fmtNum(arred(x.qtd[u]), 4, 0) + ' ' + u; }).join('; '), OPs: Object.keys(x.ops).join('; '), Maquinas: Object.keys(x.maqs).join('; '), DataRef: x.DataRef };
      });
      return { linhas: linhas, resumo: [['Medida do Pareto', porCusto ? 'Custo da perda (R$)' : 'Ocorrências (as perdas filtradas não têm custo)'], ['Total de ocorrências', totO], ['Custo total das perdas (R$)', arred(totC, 6), C('x', 'x', 'moeda')]] };
    }, periodoInterno: true });
  rel({ id: 'perdas_etapa', modulo: 'perdas', nome: 'Perdas por etapa e máquina',
    descricao: 'Perdas agrupadas por etapa, máquina, tipo de item e unidade: ocorrências, quantidade e custo.',
    regra: 'Soma das perdas registradas por etapa, máquina, tipo de item e UM (quantidades de unidades diferentes ficam em linhas diferentes).',
    filtros: { periodo: 'DataRef', op: 'OPs', maquina: 'CodMaquina', status: 'TipoItem' },
    colunas: [C('Etapa', 'Etapa'), C('Maquina', 'Máquina'), C('CodMaquina', 'Código da máquina'), C('TipoItem', 'Tipo do item'), C('UM', 'UM'), C('Ocorrencias', 'Ocorrências', 'int'),
      C('Qtd', 'Quantidade', 'qtd'), C('Custo', 'Custo da perda', 'moeda', { u: 'R$' }), C('Itens', 'Itens'), C('OPs', 'OPs'), C('DataRef', 'Última perda', 'data')],
    linhas: function (f) {
      var de = f && f.de ? paraData(f.de) : null, ate = f && f.ate ? paraData(f.ate) : null, por = {};
      if (ate) ate = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate(), 23, 59, 59, 999);
      linhasPerdas().forEach(function (p) {
        if ((de || ate) && (!p.Data || (de && p.Data < de) || (ate && p.Data > ate))) return;
        if (f && f.ops instanceof Set && !f.ops.has(p.OP)) return;
        var k = [norm(p.Etapa), p.CodMaquina, p.TipoItem, p.UM].join('|');
        var x = por[k] || (por[k] = { Etapa: p.Etapa || '(sem etapa)', Maquina: p.Maquina || '(sem máquina)', CodMaquina: p.CodMaquina, TipoItem: p.TipoItem, UM: p.UM, Ocorrencias: 0, Qtd: 0, Custo: 0, itens: {}, ops: {}, DataRef: null });
        x.Ocorrencias++; x.Qtd += p.Qtd; x.Custo += typeof p.Custo === 'number' ? p.Custo : 0; x.itens[p.Item] = 1; x.ops[p.OP] = 1;
        if (p.Data && (!x.DataRef || p.Data > x.DataRef)) x.DataRef = p.Data;
      });
      return Object.keys(por).sort().map(function (k) { var x = por[k]; return { Etapa: x.Etapa, Maquina: x.Maquina, CodMaquina: x.CodMaquina, TipoItem: x.TipoItem, UM: x.UM, Ocorrencias: x.Ocorrencias, Qtd: arred(x.Qtd), Custo: arred(x.Custo, 6), Itens: Object.keys(x.itens).join('; '), OPs: Object.keys(x.ops).join('; '), DataRef: x.DataRef }; });
    }, periodoInterno: true });

  /* ---------------- Planejamento ---------------- */
  function duracaoSegmentos(segs, ini, fim) {
    var s = A(segs).reduce(function (t, g) { var a = paraData(g && g.Inicio), b = paraData(g && g.Fim); return t + (a && b && b > a ? (b - a) / 60000 : 0); }, 0);
    if (s > 0) return arred(s, 2);
    var a2 = paraData(ini), b2 = paraData(fim);
    return a2 && b2 && b2 > a2 ? arred((b2 - a2) / 60000, 2) : '';
  }
  rel({ id: 'pcp_programacao', modulo: 'planejamento', nome: 'Programação da produção',
    descricao: 'Operações do Calendário de Produção: OP, etapa, máquina, início, fim, tempo, trechos de trabalho e situação (programada, executada, sem data).',
    regra: 'Cartões do Calendário de Produção. Operações executadas (histórico, em cinza) aparecem com o horário dos apontamentos.',
    filtros: { periodo: 'Inicio', produto: 'Produto', op: 'OP', maquina: 'CodMaquina', status: 'Situacao' },
    colunas: [C('OP', 'OP'), C('Produto', 'Produto'), C('Etapa', 'Etapa'), C('Maquina', 'Máquina'), C('CodMaquina', 'Código da máquina'), C('Inicio', 'Início', 'datahora'),
      C('Fim', 'Fim', 'datahora'), C('Minutos', 'Tempo da operação', 'min', { u: 'min' }), C('Trechos', 'Trechos de trabalho', 'int', { soma: false }), C('Situacao', 'Situação'), C('Conflito', 'Conflito')],
    linhas: function () {
      var maq = mapaMaquinas();
      return A((D() || {}).pcp_programacao).filter(Boolean).map(function (p) {
        var cod = txt(p.RecursoRoteiro || p.Recurso);
        return { OP: txt(p.OP || p.Demanda), Produto: txt(p.Produto), Etapa: etapaTxt(p.Ordem, p.Processo), Maquina: maquinaTxt(cod, p.Equipamento, maq), CodMaquina: cod,
          Inicio: paraData(p.Inicio), Fim: paraData(p.Fim), Minutos: N(p.Minutos), Trechos: A(p.Segmentos).length || (p.Inicio ? 1 : 0),
          Situacao: p.Congelado === 'Sim' ? (txt(p.SituacaoExecucao) || 'EXECUTADA') : (txt(p.Inicio) ? 'PROGRAMADA' : 'SEM DATA'), Conflito: txt(p.ConflitoPendente) };
      });
    } });
  rel({ id: 'pcp_aderencia', modulo: 'planejamento', nome: 'Programado × executado (aderência ao plano)',
    descricao: 'Operações executadas: início e fim programados × reais, duração, atraso e resultado (no prazo, atrasada, sem programação prévia).',
    regra: 'Histórico da programação (1.1.0): o horário programado antes da execução × o horário real dos apontamentos. Atraso = real − programado, em horas corridas. No prazo = fim real até o fim programado.',
    filtros: { periodo: 'InicioReal', produto: 'Produto', op: 'OP', maquina: 'CodMaquina', status: 'Resultado' },
    colunas: [C('OP', 'OP'), C('Produto', 'Produto'), C('Etapa', 'Etapa'), C('Maquina', 'Máquina'), C('CodMaquina', 'Código da máquina'), C('Situacao', 'Situação'),
      C('InicioPlan', 'Início programado', 'datahora'), C('FimPlan', 'Fim programado', 'datahora'), C('InicioReal', 'Início real', 'datahora'), C('FimReal', 'Fim real', 'datahora'),
      C('DurPlan', 'Duração programada', 'min', { u: 'min' }), C('DurReal', 'Duração real', 'min', { u: 'min' }), C('AtrasoIni', 'Atraso no início', 'h', { u: 'h', soma: false }),
      C('AtrasoFim', 'Atraso no fim', 'h', { u: 'h', soma: false }), C('Resultado', 'Resultado'), C('Fonte', 'Fonte do horário real')],
    linhas: function () {
      var maq = mapaMaquinas(), linhas = A((D() || {}).pcp_historico).filter(function (h) { return h && h.Inicio && h.Fim; }).map(function (h) {
        var cod = txt(h.RecursoRoteiro || h.Recurso), ip = paraData(h.InicioPlanejado), fp = paraData(h.FimPlanejado), ir = paraData(h.Inicio), fr = paraData(h.Fim);
        return { OP: txt(h.OP || h.Demanda), Produto: txt(h.Produto), Etapa: etapaTxt(h.Ordem, h.Processo), Maquina: maquinaTxt(cod, h.Equipamento, maq), CodMaquina: cod, Situacao: txt(h.Situacao),
          InicioPlan: ip, FimPlan: fp, InicioReal: ir, FimReal: fr, DurPlan: ip && fp ? duracaoSegmentos(h.SegmentosPlanejados, h.InicioPlanejado, h.FimPlanejado) : '',
          DurReal: duracaoSegmentos(h.Segmentos, h.Inicio, h.Fim), AtrasoIni: difHoras(ir, ip), AtrasoFim: difHoras(fr, fp),
          Resultado: !fp ? 'Sem programação prévia' : (fr <= fp ? 'No prazo' : 'Atrasada'), Fonte: txt(h.FonteHorario) };
      });
      var comPlano = linhas.filter(function (l) { return l.Resultado !== 'Sem programação prévia'; }), noPrazo = comPlano.filter(function (l) { return l.Resultado === 'No prazo'; }).length;
      return { linhas: linhas, resumo: [['Operações executadas', linhas.length], ['Com programação prévia', comPlano.length], ['No prazo', noPrazo],
        ['Aderência ao plano', comPlano.length ? arred(noPrazo / comPlano.length * 100, 6) : 'sem operações programadas antes da execução', C('x', 'x', 'pct')]] };
    } });
  rel({ id: 'pcp_carga', modulo: 'planejamento', nome: 'Carga × capacidade por máquina',
    descricao: 'Horas nominais e efetivas de cada máquina no período, carga programada, saldo e ocupação — o mesmo relatório da tela Carga × capacidade.',
    regra: 'Mesma conta da tela Carga × capacidade: horas nominais = dias úteis × horas por dia; efetivas = nominais × eficiência; carga = horas dos trechos programados no período. Sem período escolhido, usa o mês atual.',
    filtros: { periodo: 'Periodo', maquina: 'Maquina', status: 'Situacao' },
    colunas: [C('Maquina', 'Código da máquina'), C('Equipamento', 'Equipamento'), C('Escala', 'Escala'), C('HorasNominais', 'Horas nominais', 'h', { u: 'h' }),
      C('HorasEfetivas', 'Horas efetivas', 'h', { u: 'h' }), C('Carga', 'Carga programada', 'h', { u: 'h' }), C('Saldo', 'Saldo', 'h', { u: 'h' }), C('Ocupacao', 'Ocupação', 'pct'),
      C('Situacao', 'Situação')],
    linhas: function (f) {
      var hoje = new Date(), ini = f && f.de ? f.de : diaISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim = f && f.ate ? f.ate : diaISO(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0));
      if (typeof window.mesCapRelatorioDados !== 'function') return { linhas: [], resumo: [['Aviso', 'Relatório de capacidade indisponível nesta versão.']] };
      var linhas = A(window.mesCapRelatorioDados(ini, fim)).map(function (x) {
        var oc = x.Ocupacao === null || x.Ocupacao === undefined ? '' : arred(N(x.Ocupacao), 6);
        return { Maquina: txt(x.Codigo), Equipamento: txt(x.Equipamento), Escala: txt(x.Escala), HorasNominais: x.Configurado ? arred(N(x.HorasNominais), 6) : '', HorasEfetivas: x.Configurado ? arred(N(x.HorasEfetivas), 6) : '',
          Carga: arred(N(x.Carga), 6), Saldo: x.Configurado ? arred(N(x.Saldo), 6) : '', Ocupacao: oc,
          Situacao: oc === '' ? 'Sem parâmetros de capacidade' : (oc > 100 ? 'Sobrecarga' : oc > 85 ? 'Atenção' : 'OK') };
      });
      return { linhas: linhas, resumo: [['Período da carga', fmtData(paraData(ini)) + ' a ' + fmtData(paraData(fim))]] };
    }, periodoInterno: true });
  rel({ id: 'pcp_mrp', modulo: 'planejamento', nome: 'Necessidades de material das OPs abertas (MRP)',
    descricao: 'Por material: necessidade bruta das OPs abertas, saldo físico, necessidade líquida (a comprar ou suprir) e estoque mínimo.',
    regra: 'Mesma regra da tela MRP, aplicada a todas as OPs abertas (a tela usa só as OPs marcadas): necessidade bruta = o que ainda falta consumir nas OPs (planejado − já consumido em cada OP, 1.6.1), na UM do material; estoque = saldo físico do Estoque / Rastreabilidade (negativo conta como zero); líquida = bruta − estoque, se positiva. PIs não entram (são produzidos nas OPs da família). O estoque mínimo é só alerta.',
    filtros: { produto: 'Material', produtoDesc: 'Descricao', op: 'OPs', status: 'Acao' },
    colunas: [C('Material', 'Material'), C('Descricao', 'Descrição'), C('UM', 'UM'), C('Planejado', 'Planejado nas OPs', 'qtd'), C('JaConsumido', 'Já consumido nas OPs', 'qtd'),
      C('Bruta', 'Necessidade bruta (a consumir)', 'qtd'), C('Estoque', 'Estoque (saldo físico)', 'qtd'),
      C('Liquida', 'Necessidade líquida', 'qtd'), C('Acao', 'Ação'), C('Minimo', 'Estoque mínimo', 'qtd'), C('SituacaoMinimo', 'Situação do mínimo'), C('OPs', 'OPs')],
    linhas: function () {
      var d = D() || {}, ops = opsMapa(), saldos = {}, por = {}, ordem = [];
      linhasMateriais().forEach(function (m) { saldos[m.Material] = m; });
      if (typeof window.mesNecessidadesMRP === 'function') {
        /* 1.6.1: a mesma conta da tela MRP (planejado − já consumido, na UM do material) */
        window.mesNecessidadesMRP(A(d.op).filter(function (o) { return o && o.CodOP && opAtivaMRP(o); })).forEach(function (z) {
          var c = txt(z.Item), x = por[c] = { Material: c, Descricao: txt(z.Material), UM: txt(z.UM), Bruta: N(z.NecessidadeBruta), Planejado: N(z.Planejado), JaConsumido: N(z.JaConsumido), ops: {} };
          A(z.Detalhes).forEach(function (q) { x.ops[txt(q.OP)] = 1; });
          ordem.push(c);
        });
      } else A(d.op_materiais).forEach(function (m) {
        if (!m || ehLinhaPI(m)) return;
        var op = ops[txt(m.CodOP)], c = txt(m.CodigoMaterial);
        if (!op || !c || !opAtivaMRP(op)) return;
        var x = por[c] || (por[c] = { Material: c, Descricao: txt(m.DescricaoMaterial), UM: txt(m.UM), Bruta: 0, Planejado: 0, JaConsumido: 0, ops: {} });
        if (!por[c].contado) { por[c].contado = true; ordem.push(c); }
        var q = N(m.QtdPlanejada || m.QtdNecessaria || m.QuantidadePlanejada || m.Qtd); x.Bruta += q; x.Planejado += q; x.ops[txt(m.CodOP)] = 1;
      });
      var linhas = ordem.map(function (c) {
        var x = por[c], s = saldos[c] || {}, fis = N(s.Saldo), est = Math.max(0, fis), br = arred(x.Bruta, 6), liq = arred(Math.max(0, br - est), 6);
        var mat = materialCad(c), min = mat && txt(mat.EstoqueMinimo) !== '' && N(mat.EstoqueMinimo) > 0 ? N(mat.EstoqueMinimo) : '';
        var sitMin = min === '' ? '' : (fis < min ? 'ABAIXO DO MÍNIMO' : (fis - br < min ? 'FICARÁ ABAIXO APÓS AS OPs ABERTAS' : 'OK'));
        return { Material: c, Descricao: x.Descricao || s.Descricao || '', UM: x.UM || s.UM || '', Planejado: arred(x.Planejado, 6), JaConsumido: arred(x.JaConsumido, 6), Bruta: br, Estoque: arred(est, 6), Liquida: liq,
          Acao: liq > 0 ? 'COMPRAR / SUPRIR' : 'ESTOQUE SUFICIENTE', Minimo: min, SituacaoMinimo: sitMin, OPs: Object.keys(x.ops).join('; ') };
      });
      var abertas = A(d.op).filter(function (o) { return o && o.CodOP && opAtivaMRP(o); }).length, marcadas = A(d.meta && d.meta.mrpOpsIncluidas).length;
      return { linhas: linhas, resumo: [['OPs abertas consideradas', abertas], ['OPs marcadas na tela MRP', d.meta && d.meta.mrpOpsInicializado ? marcadas : 'todas (nenhuma seleção gravada)'],
        ['Materiais a comprar / suprir', linhas.filter(function (l) { return l.Liquida > 0; }).length]] };
    } });

  /* ---------------- Custos ---------------- */
  rel({ id: 'custo_op', modulo: 'custos', nome: 'Custo por OP (projetado × efetivo)',
    descricao: 'Cada OP: custo de materiais projetado e efetivo, desvio, energia e mão de obra das etapas, perdas, total projetado, total efetivo e custo por unidade produzida.',
    regra: 'Materiais projetados (planejado × média ponderada) × efetivos (consumos por lote), desvio = efetivo − projetado. Energia e MOD = as etapas desta OP na auditoria de custo (a mesma conta do custo da família, 1.6.1: a soma das OPs fecha com a família). Total projetado = materiais projetados + energia + MOD; total efetivo = materiais efetivos + energia + MOD + perdas. Custo por unidade = total efetivo ÷ produzido. Sem depreciação.',
    filtros: { projeto: 'Projeto', produto: 'Produto', produtoDesc: 'Descricao', op: 'OP', status: 'Status' },
    colunas: [C('OP', 'OP'), C('Tipo', 'Tipo'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('Status', 'Situação'), C('UM', 'UM'), C('Produzido', 'Produzido', 'qtd'),
      C('MatProj', 'Materiais projetados', 'moeda', { u: 'R$' }), C('MatEf', 'Materiais efetivos', 'moeda', { u: 'R$' }), C('Desvio', 'Desvio de materiais', 'moeda', { u: 'R$' }),
      C('DesvioPct', 'Desvio de materiais', 'pct', { u: '%' }), C('Energia', 'Energia', 'moeda', { u: 'R$' }), C('MOD', 'Mão de obra', 'moeda', { u: 'R$' }),
      C('Processo', 'Energia + MOD (etapas da OP)', 'moeda', { u: 'R$' }), C('KWh', 'Energia', 'num', { u: 'kWh', casas: 3 }), C('Perdas', 'Perdas', 'moeda', { u: 'R$' }),
      C('TotalProj', 'Total projetado', 'moeda', { u: 'R$' }), C('TotalEf', 'Total efetivo', 'moeda', { u: 'R$' }), C('Unit', 'Custo efetivo por unidade', 'moeda', { u: 'R$/UM', soma: false }), C('Projeto', 'Projeto')],
    linhas: function (f) {
      var prod = producaoPorOP();
      return A((D() || {}).op).filter(function (o) { return o && o.CodOP && (!(f && f.ops instanceof Set) || f.ops.has(txt(o.CodOP))); }).map(function (o) {
        var cod = txt(o.CodOP), c = {};
        try { c = typeof custosOP === 'function' ? custosOP(cod) || {} : {}; } catch (e) { c = {}; }
        var mp = N(c.materiaisProjetado), me = N(c.materiaisEfetivo), pr = prod[cod] || 0, tef = N(c.totalEfetivo);
        return { OP: cod, Tipo: txt(o.TipoOP), Produto: produtoOP(o), Descricao: txt(o.DescricaoProduto), Status: txt(o.Status), UM: txt(o.UM), Produzido: pr, MatProj: arred(mp, 6), MatEf: arred(me, 6),
          Desvio: arred(me - mp, 6), DesvioPct: mp ? arred((me - mp) / mp * 100, 6) : '', Energia: arred(N(c.energia), 6), MOD: arred(N(c.mod), 6), Processo: arred(N(c.processo), 6),
          KWh: arred(N(c.energiaKWh), 6), Perdas: arred(N(c.perdas), 6), TotalProj: arred(N(c.total), 6), TotalEf: arred(tef, 6),
          Unit: pr > 0 ? arred(tef / pr, 6) : '', Projeto: projetoOP(o) };
      });
    } });
  rel({ id: 'custo_familia', modulo: 'custos', nome: 'Custo da família de OPs (PA + PIs)',
    descricao: 'Cada OP de PA com as OPs de PI: materiais, energia, mão de obra, perdas, total, custo unitário, composição e comparação com o custo gravado.',
    regra: 'Mesmo cálculo do módulo Custos (família PA + PIs, 1.4.0: PI da própria família sem custo em dobro), feito agora sem gravar. Custo unitário = total ÷ quantidade produzida da OP de PA (ou planejada, se ainda não produziu). Diferença = atual − gravado.',
    filtros: { projeto: 'Projeto', produto: 'Produto', produtoDesc: 'Descricao', op: 'Familia', status: 'Status' },
    colunas: [C('Familia', 'Família (OP de PA)'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('Status', 'Situação'), C('Base', 'Quantidade base', 'qtd', { soma: false }), C('UM', 'UM'),
      C('Materiais', 'Materiais', 'moeda', { u: 'R$' }), C('Energia', 'Energia', 'moeda', { u: 'R$' }), C('MOD', 'Mão de obra', 'moeda', { u: 'R$' }), C('Perdas', 'Perdas', 'moeda', { u: 'R$' }),
      C('Total', 'Total', 'moeda', { u: 'R$' }), C('Unit', 'Custo unitário', 'moeda', { u: 'R$/UM', soma: false }), C('PctMat', 'Materiais', 'pct', { u: '% do total' }), C('PctEne', 'Energia', 'pct', { u: '% do total' }),
      C('PctMOD', 'Mão de obra', 'pct', { u: '% do total' }), C('PctPerdas', 'Perdas', 'pct', { u: '% do total' }), C('KWh', 'Energia', 'num', { u: 'kWh', casas: 3 }), C('OPs', 'OPs incluídas'),
      C('Gravado', 'Custo total gravado', 'moeda', { u: 'R$' }), C('GravadoEm', 'Gravado em', 'datahora'), C('Diferenca', 'Diferença (atual − gravado)', 'moeda', { u: 'R$' }), C('Projeto', 'Projeto')],
    linhas: function (f) {
      return familiasPA().filter(function (o) { return !(f && f.ops instanceof Set) || f.ops.has(txt(o.CodOP)); }).map(function (o) {
        var cod = txt(o.CodOP), r = {};
        try { r = typeof calcCustoFamiliaOPV33 === 'function' ? calcCustoFamiliaOPV33(cod, false, {}) || {} : {}; } catch (e) { r = {}; }
        var tot = N(r.CustoTotal), g = gravadoDe((D() || {}).custos_op, cod), pc = function (v) { return tot ? arred(N(v) / tot * 100, 6) : ''; };
        return { Familia: cod, Produto: produtoOP(o), Descricao: txt(o.DescricaoProduto), Status: txt(o.Status), Base: N(o.QtdProduzida) || N(o.QtdPlanejada) || 1, UM: txt(o.UM),
          Materiais: arred(N(r.CustoMateriais), 6), Energia: arred(N(r.CustoEnergia), 6), MOD: arred(N(r.CustoMOD), 6), Perdas: arred(N(r.CustoPerdas), 6), Total: arred(tot, 6),
          Unit: arred(N(r.CustoUnitario), 6), PctMat: pc(r.CustoMateriais), PctEne: pc(r.CustoEnergia), PctMOD: pc(r.CustoMOD), PctPerdas: pc(r.CustoPerdas), KWh: arred(N(r.EnergiaKWh), 6),
          OPs: txt(r.OPsRelacionadas), Gravado: g ? N(g.CustoTotal) : '', GravadoEm: g ? paraData(g.DataCalculo) : null, Diferenca: g ? arred(tot - N(g.CustoTotal), 6) : '', Projeto: projetoOP(o) };
      });
    } });

  /* ---------------- Sustentabilidade / ACV ---------------- */
  function sustFamilia(cod) { try { return typeof calcSustFamiliaOPV33 === 'function' ? calcSustFamiliaOPV33(cod, false, {}) || {} : {}; } catch (e) { return {}; } }
  rel({ id: 'acv_familia', modulo: 'acv', nome: 'Pegada de carbono por família e por unidade',
    descricao: 'Cada OP de PA com as OPs de PI: CO₂eq total, por materiais, perdas e energia, energia em kWh, CO₂eq e kWh por unidade e comparação com o cálculo gravado.',
    regra: 'Mesmo cálculo do módulo Sustentabilidade (ACV da família PA + PIs, fatores GWP100 da versão ativa da biblioteca), feito agora sem gravar. Por unidade = total ÷ unidades produzidas da OP de PA (a mesma base do passaporte).',
    filtros: { projeto: 'Projeto', produto: 'Produto', produtoDesc: 'Descricao', op: 'Familia', status: 'Status' },
    colunas: [C('Familia', 'Família (OP de PA)'), C('Produto', 'Produto'), C('Descricao', 'Descrição'), C('Status', 'Situação'), C('Unidades', 'Unidades (base)', 'qtd', { soma: false }),
      C('OrigemBase', 'Origem da base'), C('Total', 'CO₂eq total', 'co2', { u: 'kg CO₂eq' }), C('Materiais', 'Materiais', 'co2', { u: 'kg CO₂eq' }), C('Perdas', 'Perdas', 'co2', { u: 'kg CO₂eq' }),
      C('Energia', 'Energia elétrica', 'co2', { u: 'kg CO₂eq' }), C('KWh', 'Energia', 'num', { u: 'kWh', casas: 3 }), C('PorUnidade', 'CO₂eq por unidade', 'co2', { u: 'kg CO₂eq/un', soma: false }),
      C('KWhUnidade', 'Energia por unidade', 'num', { u: 'kWh/un', casas: 3, soma: false }), C('Massa', 'Massa considerada', 'num', { u: 'kg', casas: 4 }), C('Hotspot', 'Principal fonte'),
      C('SemFator', 'Materiais sem fator CO₂'), C('Gravado', 'CO₂eq total gravado', 'co2', { u: 'kg CO₂eq' }), C('GravadoEm', 'Gravado em', 'datahora'),
      C('Diferenca', 'Diferença (atual − gravado)', 'co2', { u: 'kg CO₂eq' }), C('Projeto', 'Projeto')],
    linhas: function (f) {
      return familiasPA().filter(function (o) { return !(f && f.ops instanceof Set) || f.ops.has(txt(o.CodOP)); }).map(function (o) {
        var cod = txt(o.CodOP), r = sustFamilia(cod), u = unidadesFamilia(o), tot = N(r.CO2eqTotal), g = gravadoDe((D() || {}).sust_op, cod);
        return { Familia: cod, Produto: produtoOP(o), Descricao: txt(o.DescricaoProduto), Status: txt(o.Status), Unidades: u.q, OrigemBase: u.origem, Total: arred(tot, 8),
          Materiais: arred(N(r.CO2eqProduto || r.CO2eqMateriais), 8), Perdas: arred(N(r.CO2eqPerdas), 8), Energia: arred(N(r.CO2eqEnergia), 8), KWh: arred(N(r.EnergiaKWh), 6),
          PorUnidade: arred(tot / u.q, 8), KWhUnidade: arred(N(r.EnergiaKWh) / u.q, 6), Massa: arred(N(r.MassaProduto), 6), Hotspot: txt(r.HotspotPrincipal), SemFator: txt(r.MateriaisSemFatorCO2),
          Gravado: g ? N(g.CO2eqTotal) : '', GravadoEm: g ? paraData(g.DataCalculo) : null, Diferenca: g ? arred(tot - N(g.CO2eqTotal), 8) : '', Projeto: projetoOP(o) };
      });
    } });
  rel({ id: 'acv_contribuicao', modulo: 'acv', nome: 'Contribuição de cada material e da energia no CO₂',
    descricao: 'Linha a linha da auditoria do cálculo de CO₂ da família: OP, item, quantidade, massa, fator e CO₂eq, com a participação no total.',
    regra: 'Auditoria do cálculo de ACV da família (a mesma do Excel auditável): CO₂eq = massa (kg) × fator (kg CO₂eq/kg); energia = kWh × fator da rede. Participação = CO₂eq da linha ÷ CO₂eq total da família.',
    filtros: { produto: 'Item', produtoDesc: 'Material', op: 'Familia', status: 'Tipo' },
    colunas: [C('Familia', 'Família (OP de PA)'), C('Tipo', 'Tipo'), C('OP', 'OP'), C('Item', 'Item'), C('Material', 'Descrição'), C('Qtd', 'Quantidade', 'qtd'), C('UM', 'UM'),
      C('FatorKg', 'Fator para kg', 'num', { casas: 6, soma: false }), C('MassaKg', 'Massa', 'num', { u: 'kg', casas: 6 }), C('FatorCO2', 'Fator de emissão', 'num', { casas: 6, soma: false }),
      C('CO2', 'CO₂eq', 'co2', { u: 'kg CO₂eq', casas: 6 }), C('Pct', 'Participação', 'pct', { casas: 2 })],
    linhas: function (f) {
      var out = [], resumo = [];
      familiasPA().filter(function (o) { return !(f && f.ops instanceof Set) || f.ops.has(txt(o.CodOP)); }).forEach(function (o) {
        var cod = txt(o.CodOP), r = sustFamilia(cod), tot = N(r.CO2eqTotal), linhas = [];
        try { linhas = A(JSON.parse(r.AuditoriaCO2JSON || '[]')); } catch (e) { linhas = []; }
        var soma = 0;
        linhas.forEach(function (x) {
          var co2 = N(x.CO2eq); soma += co2;
          out.push({ Familia: cod, Tipo: txt(x.Tipo), OP: txt(x.OP), Item: txt(x.CodigoMaterial), Material: txt(x.Material), Qtd: N(x.Quantidade), UM: txt(x.UM), FatorKg: N(x.FatorKg),
            MassaKg: arred(N(x.MassaKg), 8), FatorCO2: N(x.FatorCO2), CO2: arred(co2, 8), Pct: tot ? arred(co2 / tot * 100, 6) : '' });
        });
        resumo.push(['CO₂eq total da família ' + cod + ' (kg)', arred(tot, 6)]);
        resumo.push(['Soma das linhas da auditoria ' + cod + ' (kg)', arred(soma, 6)]);
      });
      return { linhas: out, resumo: resumo };
    } });
  var UNID_CAT = { 'Mudanças climáticas': 'kg CO₂eq', 'Acidificação': 'mol H⁺ eq', 'Eutrofização': 'kg P eq', 'Material particulado': 'incidência de doença', 'Uso de recursos minerais e metais': 'kg Sb eq',
    'Uso de água': 'm³ eq', 'Ecotoxicidade': 'CTUe', 'Toxicidade humana': 'CTUh', 'Formação de ozônio fotoquímico': 'kg NMVOC eq' };
  rel({ id: 'acv_aicv', modulo: 'acv', nome: 'Resultados de AICV (módulo ACV)',
    descricao: 'Cada resultado de AICV calculado no módulo ACV, por categoria de impacto: valor total e por unidade.',
    regra: 'Resultados gravados no módulo ACV (AICV por estudo e cenário). Por unidade = valor ÷ quantidade do produto do resultado.',
    filtros: { periodo: 'Data', op: 'OP', status: 'Categoria' },
    colunas: [C('Id', 'Resultado'), C('Data', 'Data', 'datahora'), C('Estudo', 'Estudo'), C('Cenario', 'Cenário'), C('OP', 'OP'), C('Metodo', 'Método'), C('Base', 'Base de dados'),
      C('Categoria', 'Categoria de impacto'), C('Valor', 'Valor', 'num', { casas: 6, soma: false }), C('Unidade', 'Unidade'), C('Quantidade', 'Quantidade do produto', 'num', { casas: 4, soma: false }),
      C('PorUnidade', 'Valor por unidade', 'num', { casas: 6, soma: false })],
    linhas: function () {
      var d = D() || {}, out = [];
      A(d.acv_resultados).filter(Boolean).forEach(function (r) {
        var est = A(d.acv_estudos).find(function (s) { return s && s.IdEstudo === r.IdEstudo; }) || {}, cen = A(d.acv_cenarios).find(function (s) { return s && s.IdCenario === r.IdCenario; }) || {};
        var q = N(r.MassaProduto), imp = r.Impactos || {};
        Object.keys(imp).forEach(function (cat) {
          var v = N(imp[cat]);
          out.push({ Id: txt(r.IdResultado), Data: paraData(r.Data), Estudo: txt(est.Nome), Cenario: txt(r.NomeCenario || cen.Nome), OP: txt(r.CodOP), Metodo: txt(r.Metodo), Base: txt(r.BaseDados),
            Categoria: cat, Valor: v, Unidade: UNID_CAT[cat] || '', Quantidade: q || '', PorUnidade: q > 0 ? arred(v / q, 10) : '' });
        });
      });
      return out;
    } });

  /* ---------------- Passaporte da bateria ---------------- */
  function camposBP() { try { return typeof window.mesBPCampos === 'function' ? A(window.mesBPCampos()) : []; } catch (e) { return []; } }
  function visaoBP(bp) { try { return typeof window.mesBPVisao === 'function' ? window.mesBPVisao(bp) : null; } catch (e) { return null; } }
  rel({ id: 'bp_lista', modulo: 'passaporte', nome: 'Passaportes da bateria',
    descricao: 'Cada passaporte: situação, OP, produto, lote, cliente, fonte da ACV, CO₂ e massa útil por célula, dados preenchidos e dados no painel do cliente.',
    regra: 'Mesma visão do passaporte (1.1.0): valores do cadastro e, nos campos vazios do formato anterior, os dados da OP. Dados no painel = preenchidos e marcados "painel".',
    filtros: { periodo: 'Criado', produto: 'Produto', op: 'OP', status: 'Status' },
    colunas: [C('Id', 'Passaporte'), C('Status', 'Situação'), C('OP', 'OP'), C('Produto', 'Produto'), C('Lote', 'Lote'), C('Cliente', 'Cliente'), C('Fabricante', 'Fabricante'),
      C('Criado', 'Criado em', 'data'), C('CriadoPor', 'Criado por'), C('Alterado', 'Alterado em'), C('AlteradoPor', 'Alterado por'), C('FonteACV', 'Fonte da ACV'),
      C('CO2', 'CO₂eq por célula (texto do passaporte)'), C('MassaUtil', 'Massa útil por célula', 'num', { u: 'kg', casas: 4, soma: false }), C('Preenchidos', 'Dados preenchidos', 'int'),
      C('NoPainel', 'Dados no painel', 'int'), C('Vazios', 'Dados vazios', 'int')],
    linhas: function () {
      var campos = camposBP();
      return A((D() || {}).bp).filter(Boolean).map(function (bp) {
        var v = visaoBP(bp), val = function (k) { try { return v ? txt(v.valor(k)) : txt(bp[k]); } catch (e) { return txt(bp[k]); } };
        var cheios = campos.filter(function (c) { return val(c.k); }), pub = cheios.filter(function (c) { try { return v ? v.publico(c.k) : true; } catch (e) { return true; } });
        var mu = v && v.massas ? N(v.massas.utilCelula) : 0;
        return { Id: txt(bp.BatteryPassportID), Status: txt(bp.StatusPassaporte) || 'RASCUNHO', OP: txt(bp.CodOrdemProducao), Produto: txt(bp.CodProduto), Lote: txt(bp.IDLote),
          Cliente: txt(bp.ClienteNomeSnapshot), Fabricante: txt(bp.FornecedorNomeSnapshot), Criado: paraData(bp.DataCriacao), CriadoPor: txt(bp.UsuarioCriacao),
          Alterado: txt(bp.DataUltimaAlteracao), AlteradoPor: txt(bp.UsuarioUltimaAlteracao), FonteACV: val('BP_ACV_Fonte'), CO2: val('BP_CO2_PorCelula'), MassaUtil: mu > 0 ? arred(mu, 6) : '',
          Preenchidos: cheios.length, NoPainel: pub.length, Vazios: campos.length - cheios.length };
      });
    } });
  rel({ id: 'bp_campos', modulo: 'passaporte', nome: 'Dados de cada passaporte (campo a campo)',
    descricao: 'Para cada passaporte, cada dado: grupo, data point do Battery Passport, valor, se aparece no painel do cliente e se está preenchido.',
    regra: 'Catálogo único de campos do passaporte (1.1.0). "No painel" segue a marca de cada dado; campo vazio nunca aparece no painel.',
    filtros: { op: 'OP', status: 'Situacao', produto: 'Campo' },
    colunas: [C('Id', 'Passaporte'), C('StatusBP', 'Situação do passaporte'), C('OP', 'OP'), C('Grupo', 'Grupo'), C('DP', 'Data point'), C('Campo', 'Dado'), C('Valor', 'Valor'),
      C('Unidade', 'Unidade'), C('NoPainel', 'No painel'), C('Situacao', 'Situação')],
    linhas: function () {
      var campos = camposBP(), out = [];
      A((D() || {}).bp).filter(Boolean).forEach(function (bp) {
        var v = visaoBP(bp);
        campos.forEach(function (c) {
          var x = ''; try { x = v ? txt(v.valor(c.k)) : txt(bp[c.k]); } catch (e) { x = txt(bp[c.k]); }
          var pub = false; try { pub = v ? !!v.publico(c.k) : !c.oculto; } catch (e) { pub = false; }
          out.push({ Id: txt(bp.BatteryPassportID), StatusBP: txt(bp.StatusPassaporte) || 'RASCUNHO', OP: txt(bp.CodOrdemProducao), Grupo: c.grupo, DP: c.dp ? 'DP' + c.dp : '', Campo: c.l, Valor: x,
            Unidade: c.u, NoPainel: x ? (pub ? 'Sim' : 'Não') : 'Não (vazio)', Situacao: x ? 'Preenchido' : 'Vazio' });
        });
      });
      return out;
    } });

  /* ---------------- Cadastros ---------------- */
  rel({ id: 'cad_estrutura', modulo: 'cadastros', nome: 'Estrutura do produto (multinível)',
    descricao: 'PA → PI → PI em níveis, pelo cadastro da Estrutura do Produto (Código Pai), com o caminho de cada item.',
    regra: 'Cadastro da Estrutura do Produto: cada item abaixo do seu "Código Pai". Itens sem pai cadastrado aparecem no nível 1.',
    filtros: { produto: 'Codigo', produtoDesc: 'Descricao', status: 'Tipo' },
    colunas: [C('Nivel', 'Nível', 'int', { soma: false }), C('Codigo', 'Código'), C('Descricao', 'Descrição'), C('Tipo', 'Tipo'), C('TipoPI', 'Tipo de PI'), C('Pai', 'Código pai'),
      C('Caminho', 'Caminho'), C('Composicao', 'Composição'), C('Modelo', 'Modelo'), C('Celula', 'Célula')],
    linhas: function () {
      var itens = A((D() || {}).estrutura).filter(function (p) { return p && txt(p['Código']); }), filhos = {}, cods = {}, out = [], vistos = {};
      itens.forEach(function (p) { cods[txt(p['Código'])] = 1; });
      itens.forEach(function (p) { var pai = txt(p['Código Pai']); if (pai && cods[pai] && pai !== txt(p['Código'])) (filhos[pai] = filhos[pai] || []).push(p); });
      function visitar(p, nivel, caminho) {
        var c = txt(p['Código']); if (vistos[c]) return; vistos[c] = 1;
        var cam = caminho ? caminho + ' › ' + c : c;
        out.push({ Nivel: nivel, Codigo: c, Descricao: txt(p['Descrição']), Tipo: txt(p['Tipo Produto']), TipoPI: txt(p['Tipo PI']), Pai: txt(p['Código Pai']), Caminho: cam,
          Composicao: txt(p['Composição']), Modelo: txt(p.Modelo), Celula: txt(p['Célula']) });
        A(filhos[c]).sort(function (a, b) { return txt(a['Código']).localeCompare(txt(b['Código']), 'pt-BR', { numeric: true }); }).forEach(function (f) { visitar(f, nivel + 1, cam); });
      }
      itens.filter(function (p) { var pai = txt(p['Código Pai']); return !pai || !cods[pai] || pai === txt(p['Código']); }).forEach(function (p) { visitar(p, 1, ''); });
      itens.forEach(function (p) { if (!vistos[txt(p['Código'])]) visitar(p, 1, ''); });
      return out;
    } });
  rel({ id: 'cad_roteiro_op', modulo: 'cadastros', nome: 'Roteiros — operações e máquinas',
    descricao: 'Cada roteiro, operação e máquina: produto gerado, tempo de operação, pessoas e potência.',
    regra: 'Cadastro do Roteiro (etapas e recursos de cada etapa).',
    filtros: { produto: 'ProdutoRoteiro', op: 'Roteiro', maquina: 'CodMaquina', status: 'SituacaoRoteiro' },
    colunas: [C('Roteiro', 'Roteiro'), C('ProdutoRoteiro', 'Produto do roteiro'), C('SituacaoRoteiro', 'Situação do roteiro'), C('Ordem', 'Ordem', 'int', { soma: false }), C('Processo', 'Processo'),
      C('Gerado', 'Produto gerado'), C('Maquina', 'Máquina'), C('CodMaquina', 'Código da máquina'), C('Tempo', 'Tempo de operação', 'min', { u: 'min' }), C('Pessoas', 'Pessoas', 'num', { casas: 1, soma: false }),
      C('Potencia', 'Potência', 'num', { u: 'W', casas: 0, soma: false })],
    linhas: function () {
      var d = D() || {}, rots = {}, maq = mapaMaquinas(), out = [];
      A(d.roteiro).forEach(function (r) { if (r) rots[txt(r.CodRoteiro)] = r; });
      A(d.roteiro_etapas).filter(Boolean).sort(function (a, b) { return txt(a.CodRoteiro).localeCompare(txt(b.CodRoteiro)) || N(a.Ordem) - N(b.Ordem); }).forEach(function (e) {
        var r = rots[txt(e.CodRoteiro)] || {}, base = { Roteiro: txt(e.CodRoteiro), ProdutoRoteiro: txt(r.CodigoProduto), SituacaoRoteiro: txt(r.StatusRoteiro), Ordem: N(e.Ordem), Processo: txt(e.Processo),
          Gerado: txt(e.ProdutoGerado || e.CodigoPI || e.CodigoProduto) };
        var recs = A(d.roteiro_recursos).filter(function (x) { return x && txt(x.CodRoteiro) === txt(e.CodRoteiro) && txt(x.OrdemEtapa) === txt(e.Ordem); });
        if (!recs.length) recs = [{ CodEquipamento: e.CodEquipamento, Equipamento: e.Equipamento, TempoOperacaoMin: e.TempoOperacaoMin || e['TempoOperaçãoMin'], NPessoas: e.NPessoas }];
        recs.forEach(function (x) {
          out.push(Object.assign({}, base, { Maquina: maquinaTxt(x.CodEquipamento, x.Equipamento, maq), CodMaquina: txt(x.CodEquipamento), Tempo: N(x.TempoOperacaoMin), Pessoas: N(x.NPessoas), Potencia: N(x.PotenciaEquipamento) || '' }));
        });
      });
      return out;
    } });
  rel({ id: 'cad_roteiro_insumos', modulo: 'cadastros', nome: 'Roteiros — matérias-primas e PIs por operação',
    descricao: 'Insumos de cada operação do roteiro: matérias-primas (quantidade base e planejada) e PIs que entram na operação, com a operação de origem.',
    regra: 'Cadastro do Roteiro: materiais por operação e o quadro "PIs que entram nesta operação" (1.4.0).',
    filtros: { produto: 'Item', produtoDesc: 'Descricao', op: 'Roteiro', status: 'Tipo' },
    colunas: [C('Roteiro', 'Roteiro'), C('Ordem', 'Ordem', 'int', { soma: false }), C('Processo', 'Processo'), C('Maquina', 'Máquina'), C('Tipo', 'Tipo'), C('Item', 'Item'),
      C('Descricao', 'Descrição'), C('QtdBase', 'Quantidade base', 'qtd', { soma: false }), C('QtdPlan', 'Quantidade planejada', 'qtd'), C('UM', 'UM'), C('Origem', 'Origem do PI')],
    linhas: function () {
      var d = D() || {}, maq = mapaMaquinas(), desc = mapaDescricoes(), out = [];
      A(d.roteiro_materiais).filter(Boolean).forEach(function (m) {
        out.push({ Roteiro: txt(m.CodRoteiro), Ordem: N(m.OrdemEtapa || m.Ordem), Processo: txt(m.Processo), Maquina: maquinaTxt(m.CodEquipamento, m.Recurso, maq),
          Tipo: ehLinhaPI(m) ? 'PI' : 'Matéria-prima', Item: txt(m.CodigoMaterial), Descricao: txt(m.DescricaoMaterial), QtdBase: N(m.QtdBase), QtdPlan: N(m.QtdPlanejada), UM: txt(m.UM || m.UMConsumo), Origem: '' });
      });
      A(d.roteiro_pi_entradas).filter(Boolean).forEach(function (x) {
        out.push({ Roteiro: txt(x.CodRoteiro), Ordem: N(x.OrdemEtapa), Processo: txt(x.Processo), Maquina: txt(x.Equipamento), Tipo: 'PI', Item: txt(x.CodigoPI),
          Descricao: txt(x.DescricaoPI) || desc[txt(x.CodigoPI)] || '', QtdBase: '', QtdPlan: '', UM: '', Origem: txt(x.OrdemEtapaOrigem) ? 'Operação ' + txt(x.OrdemEtapaOrigem) : txt(x.Origem) });
      });
      return out.sort(function (a, b) { return a.Roteiro.localeCompare(b.Roteiro) || a.Ordem - b.Ordem; });
    } });
  rel({ id: 'cad_recursos', modulo: 'cadastros', nome: 'Recursos / máquinas',
    descricao: 'Cada máquina: processo, potência, tempo padrão, pessoas, taxas e custos de energia e mão de obra, patrimônio e situação.',
    regra: 'Cadastro de Recursos / Máquinas (custos e cadastro técnico).',
    filtros: { maquina: 'Codigo', status: 'Ativo' },
    colunas: [C('Codigo', 'Código'), C('Equipamento', 'Equipamento'), C('Processo', 'Processo'), C('SubProcesso', 'Subprocesso'), C('Potencia', 'Potência', 'num', { u: 'W', casas: 0, soma: false }),
      C('Tempo', 'Tempo de operação', 'min', { u: 'min', soma: false }), C('Pessoas', 'Pessoas', 'num', { casas: 1, soma: false }), C('TaxaEnergia', 'Taxa de energia', 'moeda', { u: 'R$/kWh', casas: 4, soma: false }),
      C('TaxaMOD', 'Taxa de mão de obra', 'moeda', { u: 'R$/h', soma: false }), C('CustoEnergia', 'Custo de energia', 'moeda', { u: 'R$', soma: false }), C('CustoMOD', 'Custo de mão de obra', 'moeda', { u: 'R$', soma: false }),
      C('Escala', 'Escala'), C('Patrimonio', 'Patrimônio'), C('Valor', 'Valor do equipamento', 'moeda', { u: 'R$' }), C('Ativo', 'Ativo')],
    linhas: function () {
      var d = D() || {}, cad = {}, out = [], vistos = {};
      A(d.cad_recursos).forEach(function (r) { var c = txt(r && r['Código Equipamento']); if (c && !cad[c]) cad[c] = r; });
      A(d.recursos).filter(Boolean).forEach(function (r) {
        var c = txt(r.CodEquipamento), k = cad[c] || {}; vistos[c] = 1;
        out.push({ Codigo: c, Equipamento: txt(r.Equipamento), Processo: txt(r.Processo), SubProcesso: txt(r.SubProcesso), Potencia: N(r['PotenciaEquipamento (W)']), Tempo: N(r['TempoOperação (min)']),
          Pessoas: N(r.NPessoas), TaxaEnergia: N(r['TaxaEnergia (R$/kWh)']), TaxaMOD: N(r['TaxaMOD (R$/h)']), CustoEnergia: N(r.CustoEnergia), CustoMOD: N(r.CustoMOD), Escala: txt(r.Escala),
          Patrimonio: txt(k.NumeroPatrimonio), Valor: txt(k.ValorEquipamento) !== '' ? N(k.ValorEquipamento) : '', Ativo: txt(k.Ativo) || 'Sim' });
      });
      Object.keys(cad).forEach(function (c) {
        if (vistos[c]) return;
        var k = cad[c];
        out.push({ Codigo: c, Equipamento: txt(k.Equipamento), Processo: txt(k.Processo), SubProcesso: txt(k.SubProcesso), Potencia: N(k['PotenciaEquipamento (W)']), Tempo: '', Pessoas: '', TaxaEnergia: '',
          TaxaMOD: '', CustoEnergia: '', CustoMOD: '', Escala: txt(k.Escala), Patrimonio: txt(k.NumeroPatrimonio), Valor: txt(k.ValorEquipamento) !== '' ? N(k.ValorEquipamento) : '', Ativo: txt(k.Ativo) || 'Sim' });
      });
      return out;
    } });
  rel({ id: 'cad_materiais', modulo: 'cadastros', nome: 'Materiais',
    descricao: 'Cadastro de materiais: código, descrição, unidade, categoria, fator para kg, estoque mínimo e códigos.',
    regra: 'Cadastro de Materiais.',
    filtros: { produto: 'Codigo', produtoDesc: 'Descricao', status: 'Categoria' },
    colunas: [C('Codigo', 'Código'), C('Descricao', 'Descrição'), C('UM', 'UM'), C('Categoria', 'Categoria'), C('FatorKg', 'Fator para kg', 'num', { casas: 6, soma: false }),
      C('Minimo', 'Estoque mínimo', 'qtd', { soma: false }), C('CodigoBarras', 'Código de barras'), C('CodigoFornecedor', 'Código do fornecedor'), C('CodigoBPM', 'Código BPM'), C('Obs', 'Observações')],
    linhas: function () {
      return A((D() || {}).materiais).filter(Boolean).map(function (m) {
        var kb = Object.keys(m).find(function (k) { return /barra/i.test(k) && txt(m[k]); });
        return { Codigo: txt(m['CódigoMaterial']), Descricao: txt(m.DescricaoMateriais), UM: txt(m.UM), Categoria: txt(m.Categoria), FatorKg: txt(m['Fator conversão para kg']) !== '' ? N(m['Fator conversão para kg']) : '',
          Minimo: txt(m.EstoqueMinimo) !== '' ? N(m.EstoqueMinimo) : '', CodigoBarras: kb ? txt(m[kb]) : '', CodigoFornecedor: txt(m.CodigoFornecedor), CodigoBPM: txt(m.CodigoBPM), Obs: txt(m.Observacoes) };
      });
    } });

  /* ---------------- Auditoria ---------------- */
  rel({ id: 'aud_historico', modulo: 'auditoria', nome: 'Histórico de modificações',
    descricao: 'Alterações gravadas pelo servidor: data e hora, usuário, módulo, ação, registro e detalhes — inclusive as exportações de relatórios.',
    regra: 'Histórico de Modificações do servidor (Dados\\auditoria.jsonl). Com período: todas as alterações do período (até 20.000); sem período: as 5.000 mais recentes.',
    filtros: { periodo: 'DataHora', produto: 'Modulo', status: 'Acao' },
    colunas: [C('DataHora', 'Data e hora', 'datahora'), C('Usuario', 'Usuário'), C('Modulo', 'Módulo'), C('Acao', 'Ação'), C('Registro', 'Registro'), C('Detalhes', 'Detalhes')],
    linhas: function (f) {
      var q = f && (f.de || f.ate) ? '?de=' + encodeURIComponent(f.de || '') + '&ate=' + encodeURIComponent(f.ate || '') + '&limite=20000' : '?limite=5000';
      return fetch('/api/audit' + q, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (lista) {
        return A(lista).filter(Boolean).map(function (a) {
          var det = a.details && typeof a.details === 'object' ? JSON.stringify(a.details) : txt(a.details);
          return { DataHora: paraData(a.changed_at), Usuario: txt(a.username), Modulo: txt(a.module), Acao: txt(a.action), Registro: txt(a.record_key), Detalhes: det.length > 1000 ? det.slice(0, 1000) + '…' : det };
        });
      });
    } });
  rel({ id: 'aud_consistencia', modulo: 'auditoria', nome: 'Consistência dos dados',
    descricao: 'Confere os dados que alimentam estoque, custo, CO₂ e passaporte e lista o que deixa algum número errado ou desatualizado — lotes negativos, registros de OPs excluídas, unidades sem conversão, perdas sem lote, potências fora do comum, códigos repetidos, custo e CO₂ gravados diferentes do cálculo atual e outros — com o impacto e como corrigir.',
    regra: 'Só leitura: nada é corrigido sozinho. Erro = número errado hoje; Atenção = número provavelmente errado ou desatualizado; Informação = regra aplicada que vale conferir. Custo e CO₂ atuais = o mesmo cálculo das telas, feito agora sem gravar; diferença acima de 0,5% é apontada. Potência acima de 50 kW é apontada para conferência.',
    filtros: { produto: 'Tipo', status: 'Gravidade', op: 'Registro' },
    colunas: [C('Gravidade', 'Gravidade'), C('Tipo', 'Verificação'), C('Modulo', 'Módulo'), C('Registro', 'Registro'), C('Detalhe', 'O que foi encontrado'), C('Impacto', 'Impacto nos números'),
      C('Correcao', 'Como corrigir')],
    linhas: function () { return consistencia(); } });

  /* 1.6.1 — CONSISTÊNCIA DOS DADOS (relatório aud_consistencia) */
  function q4(v) { return fmtNum(arred(N(v), 4), 4, 0); }
  function rs(v) { return 'R$ ' + fmtNum(arred(N(v), 2), 2); }
  var GRAVIDADE = { E: 'Erro', A: 'Atenção', I: 'Informação' }, ORDEM_GRAV = { E: 0, A: 1, I: 2 };
  var SOLTOS = [
    ['consumos_materiais', 'CodOP', 'consumo(s) de material', 'Ignorados no saldo do estoque e no custo.'],
    ['producao', 'CodOP', 'apontamento(s) de produção', 'Ignorados nos cálculos (custo, CO₂, lotes de PI/PA).'],
    ['perdas', 'CodOP', 'perda(s)', 'Ignoradas nos cálculos de custo e CO₂.'],
    ['op_etapas', 'CodOP', 'etapa(s) de OP', 'Ignoradas no custo e no CO₂.'],
    ['op_materiais', 'CodOP', 'linha(s) de material de OP', 'Ignoradas nas reservas e no MRP.'],
    ['pcp_programacao', 'OP', 'programação(ões) no calendário', 'Podem ocupar o calendário e a carga de capacidade.'],
    ['apontamento_tempos', 'CodOP', 'apontamento(s) de tempo', 'Ignorados no tempo real das OPs.'],
    ['op_pi_consumos', 'CodOPConsumidora', 'consumo(s) de PI', 'Podem baixar o saldo de lotes de PI.'],
    ['etiquetas_producao', 'CodOP', 'etiqueta(s) de produção', 'Podem aparecer no estoque de PI e PA.'],
    ['custos_op', 'CodOP', 'custo(s) gravado(s)', 'Ficam como histórico; nenhuma OP usa.'],
    ['sust_op', 'CodOP', 'cálculo(s) de CO₂ gravado(s)', 'Ficam como histórico; nenhuma OP usa.']];
  function consistencia() {
    var d = D() || {}, out = [], ops = opsMapa(), a14 = api14(), est = window.mesEstoqueAPI || null, desc = mapaDescricoes();
    function add(g, tipo, modulo, registro, detalhe, impacto, correcao) {
      out.push({ _g: g, Gravidade: GRAVIDADE[g], Tipo: tipo, Modulo: modulo, Registro: registro, Detalhe: detalhe, Impacto: impacto, Correcao: correcao });
    }
    function ehPI(cod) { var p = A(d.estrutura).find(function (x) { return x && txt(x['Código']) === txt(cod); }); return p ? String(p['Tipo Produto'] || '').toUpperCase() === 'PI' : /^PI/i.test(txt(cod)); }

    /* custo e CO₂ das famílias (as mesmas funções das telas, sem gravar) e energia por equipamento */
    var kwhPorEquip = {}, kwhTotal = 0, familias = [];
    familiasPA().forEach(function (o) {
      var cod = txt(o.CodOP), f = { op: o, cod: cod, audit: null, custo: null, sust: null };
      try { f.audit = typeof auditCostFamilyV4014 === 'function' ? auditCostFamilyV4014(cod) : null; } catch (e) { }
      try { f.custo = typeof v4033CostScope === 'function' ? v4033CostScope(cod, false).row : (typeof calcCustoFamiliaOPV33 === 'function' ? calcCustoFamiliaOPV33(cod, false, {}) : null); } catch (e) { }
      try { f.sust = sustFamilia(cod); } catch (e) { }
      A(f.audit && f.audit.etapas).forEach(function (e) { var k = norm(e.Equipamento); kwhPorEquip[k] = (kwhPorEquip[k] || 0) + N(e.EnergiaKWh); kwhTotal += N(e.EnergiaKWh); });
      familias.push(f);
    });

    /* 1) estoque: lotes, entradas e consumos */
    var lotes = typeof window.mesLinhasEstoque === 'function' ? A(window.mesLinhasEstoque()) : [];
    lotes.forEach(function (r) {
      var reg = txt(r.Entrada) + ' · ' + txt(r.CodigoMaterial), um = txt(r.UM);
      if (N(r.Saldo) < 0) add('E', 'Lote com saldo negativo', 'Estoque', reg,
        'Entrada de ' + q4(r.QtdEntrada) + ' ' + um + '; saíram ' + q4(N(r.ConsumoOP) + N(r.PerdasLote) + N(r.AjusteSaida) + N(r.BaixaTecnica)) + ' ' + um + ' (consumos ' + q4(r.ConsumoOP) + ', perdas ' + q4(r.PerdasLote) +
        ', saídas e baixas ' + q4(N(r.AjusteSaida) + N(r.BaixaTecnica)) + '): saldo ' + q4(r.Saldo) + ' ' + um + '.' + (txt(r.OPsRelacionadas) ? ' OPs: ' + txt(r.OPsRelacionadas) + '.' : ''),
        'Saldo do estoque, disponível para as OPs, MRP e inventário.',
        'Confira a quantidade e a UM da entrada ' + txt(r.Entrada) + ' (Entrada de materiais). Se faltou lançar uma entrada, lance-a; se o consumo foi apontado no lote errado, estorne e aponte no lote certo.');
      if (txt(r.SemConversaoUM)) add('E', 'Apontamento em UM sem conversão para o lote', 'Estoque', reg, txt(r.SemConversaoUM) + '.', 'O saldo do lote soma quantidades de unidades diferentes.',
        'Cadastre o "Fator conversão para kg" do material ' + txt(r.CodigoMaterial) + ' (Materiais) ou corrija a UM do lançamento.');
    });
    A(d.consumos_materiais).forEach(function (c) {
      if (!c || c.AcimaDoSaldo !== 'Sim' || !ops[txt(c.CodOP)]) return;
      add('I', 'Consumo registrado acima do saldo do lote', 'Apontamento de produção', txt(c.ConsumoID) + ' · OP ' + txt(c.CodOP),
        q4(consumoLiquido(c)) + ' ' + txt(c.UM) + ' de ' + txt(c.CodigoMaterial) + ' no lote ' + txt(c.Entrada) + ' (saldo antes: ' + q4(c.SaldoLoteAntes) + ' ' + txt(c.UMLote) + '), confirmado no aviso.',
        'O lote fica negativo até a entrada ser corrigida.', 'Corrija a entrada do lote ou estorne o consumo e aponte no lote certo.');
    });
    A(d.entradas).forEach(function (e) {
      if (!e) return;
      var cod = txt(e['CódigoMaterial']), m = materialCad(cod), uE = txt(e.UnidadeMedida), uM = txt(m && m.UM), reg = txt(e.Entrada) + ' · ' + cod;
      if (!m) { add('E', 'Entrada de material sem cadastro', 'Entrada de materiais', reg, 'O material ' + cod + ' não está no cadastro de materiais.', 'Custo médio, conversão de UM e CO₂ desse material ficam sem dados.', 'Cadastre o material ' + cod + ' ou corrija o código da entrada.'); return; }
      if (uE && uM && est && est.normUM(uE) !== est.normUM(uM)) {
        var c1 = est.converterUM(1, uE, uM, cod), fk = N(m['Fator conversão para kg']);
        if (c1.ok) add('A', 'UM da entrada diferente da UM do material', 'Entrada de materiais', reg,
          'Entrada em ' + uE + ', material em ' + uM + ': o MES converte 1 ' + uE + ' = ' + q4(c1.q) + ' ' + uM + (fk > 0 ? ' (fator ' + q4(fk) + ' kg por ' + uM + ')' : '') + '.',
          'Custo unitário do lote, saldo na visão por material e MRP dependem dessa conversão.', 'Se o fator estiver certo, nada a fazer; se não, corrija o "Fator conversão para kg" do material ' + cod + '.');
        else add('E', 'UM da entrada sem conversão para a UM do material', 'Entrada de materiais', reg, 'Entrada em ' + uE + ', material em ' + uM + ', sem fator de conversão.',
          'Custo unitário do lote fica 0 e o lote fica fora da visão por material e do MRP.', 'Cadastre o "Fator conversão para kg" do material ' + cod + ' ou corrija a UM da entrada.');
      }
      if (!(N(e.QtdAdquirida) > 0)) add('E', 'Entrada sem quantidade', 'Entrada de materiais', reg, 'Quantidade adquirida vazia ou zero.', 'Lote sem saldo; consumo desse lote deixa o saldo negativo.', 'Informe a quantidade da entrada.');
      else if (!(N(e['Custo R$']) > 0) && !(N(e['ValorUnitario (R$/UM)']) > 0)) add('A', 'Entrada sem valor', 'Entrada de materiais', reg, 'Sem valor unitário nem custo total.', 'O consumo desse lote entra no custo da OP com R$ 0.', 'Informe o valor da entrada.');
    });

    /* 2) perdas */
    A(d.perdas).forEach(function (p) {
      if (!p || !ops[txt(p.CodOP || p.NOPP)]) return;
      var cod = txt(p.CodigoMaterial || p.ItemPerdaCodigo), reg = 'OP ' + txt(p.CodOP || p.NOPP) + (cod ? ' · ' + cod : ''), q = q4(p.QuantidadePerdida) + ' ' + txt(p.Unidade || p.UM);
      var material = /MAT/i.test(String(p.PerdaAlvoTipo || '')) && cod && !ehPI(cod);
      if (material && !txt(p.Lote) && !txt(p.EntradaMaterial) && p.OrigemPerda !== 'DENTRO_DO_CONSUMO')
        add('A', 'Perda de material sem lote', 'Registro de perdas', reg, 'Perda de ' + q + ' de ' + cod + (desc[cod] ? ' — ' + desc[cod] : '') + ' sem lote' + (txt(p.DataApontamento) ? ' (' + txt(p.DataApontamento) + ')' : '') + '.',
          'O custo e o CO₂ da perda entram na OP, mas o estoque não baixa a perda (não sabe de qual lote): o saldo fica maior que o real.',
          'Informe o lote na perda; se a perda foi dentro do consumo já apontado, marque a origem "Dentro do consumo apontado".');
      if (!txt(p.Motivo)) add('I', 'Perda sem motivo', 'Registro de perdas', reg, 'Perda de ' + q + ' sem motivo informado.', 'Não entra nas análises por motivo.', 'Informe o motivo (cadastro de motivos de perda).');
    });

    /* 3) registros de OPs que não existem mais */
    SOLTOS.forEach(function (s) {
      /* agrupado pela família (código da OP sem o sufixo -PA / -01...) */
      var por = {};
      A(d[s[0]]).forEach(function (x) {
        var k = txt(x && (x[s[1]] || (s[0] === 'perdas' ? x.NOPP : '') || (s[0] === 'custos_op' || s[0] === 'sust_op' ? x.CodOPMae : ''))); if (!k || ops[k]) return;
        var base = k.replace(/-(PA|\d+)$/i, ''), g = por[base] || (por[base] = { n: 0, ops: {} });
        g.n++; g.ops[k] = (g.ops[k] || 0) + 1;
      });
      Object.keys(por).forEach(function (base) {
        var g = por[base], lista = Object.keys(g.ops).sort();
        add('A', 'Registro de OP excluída', 'Ordens de produção', lista.length > 1 ? 'Família ' + base : 'OP ' + lista[0],
          g.n + ' ' + s[2] + ' de ' + lista.length + ' OP(s) que não existem mais: ' + lista.map(function (k) { return k + ' (' + g.ops[k] + ')'; }).join(', ') + '.', s[3],
          'Se a OP foi excluída por engano, recrie-a com o mesmo código; se não, esses registros podem ser apagados (são só histórico).');
      });
    });
    A(d.bp).forEach(function (b) {
      var k = txt(b && b.CodOrdemProducao);
      if (k && !ops[k]) add('E', 'Passaporte ligado a OP inexistente', 'Passaporte da bateria', txt(b.BatteryPassportID) || txt(b.BatteryPassportGUID), 'O passaporte aponta para a OP ' + k + ', que não existe mais.',
        'O passaporte não puxa custo, CO₂, estrutura nem genealogia da OP.', 'Abra o passaporte e selecione a OP certa.');
    });

    /* 4) recursos: código repetido, potência, tarifa de energia */
    var nomesPorCod = {}, vistos = {};
    A(d.cad_recursos).concat(A(d.recursos)).forEach(function (r) {
      if (!r) return;
      var c = txt(r['Código Equipamento'] || r.CodEquipamento), n = txt(r.Equipamento); if (!c || !n) return;
      (nomesPorCod[c] = nomesPorCod[c] || {})[norm(n)] = n;
      var w = N(r['PotenciaEquipamento (W)']), k = c + '|' + norm(n) + '|' + w;
      if (w > 50000 && !vistos[k]) {
        vistos[k] = 1;
        var kwh = kwhPorEquip[norm(n)] || 0;
        add('A', 'Potência fora do comum', 'Recursos / Máquinas', n + ' (código ' + c + ')', fmtNum(w, 0, 0) + ' W = ' + fmtNum(arred(w / 1000, 2), 2, 0) + ' kW.' +
          (kwh > 0 && kwhTotal > 0 ? ' Nas famílias de OPs atuais esse equipamento soma ' + fmtNum(arred(kwh, 2), 2, 0) + ' kWh de ' + fmtNum(arred(kwhTotal, 2), 2, 0) + ' kWh (' + fmtNum(arred(kwh / kwhTotal * 100, 1), 1, 0) + '%).' : ''),
          'Energia (kWh), custo de energia e CO₂ de todas as OPs que usam esse equipamento.', 'Confira a potência em W no cadastro do equipamento (um erro de vírgula ou de unidade multiplica o valor por 1.000).');
      }
    });
    Object.keys(nomesPorCod).forEach(function (c) {
      var nomes = Object.keys(nomesPorCod[c]).map(function (k) { return nomesPorCod[c][k]; });
      if (nomes.length > 1) add('A', 'Código de equipamento repetido', 'Recursos / Máquinas', 'Código ' + c, 'O código ' + c + ' está em equipamentos diferentes: ' + nomes.join('; ') + '.',
        'Custo, energia, capacidade e apontamento de tempo buscam o equipamento pelo código e podem pegar o errado.', 'Dê um código único para cada equipamento em Recursos / Máquinas.');
    });
    var fe = A(d.custos_fatores).filter(function (f) { return f && f.Tipo === 'Energia'; }), tarifa = fe.length ? N(fe[0].CustoUnitario) : 0.82;
    if (!fe.length) add('A', 'Sem tarifa de energia cadastrada', 'Fatores de custo', 'Energia', 'Não há fator de custo do tipo Energia: o custo usa 0,82 R$/kWh, valor fixo do sistema.', 'Custo de energia de todas as OPs.', 'Cadastre a tarifa de energia em Fatores de custo.');
    else {
      if (fe.length > 1) add('A', 'Mais de uma tarifa de energia', 'Fatores de custo', 'Energia', fe.length + ' fatores do tipo Energia; o custo usa o primeiro da lista: ' + q4(tarifa) + ' R$/kWh (' + txt(fe[0].Item) + ').',
        'Custo de energia de todas as OPs.', 'Deixe só a tarifa válida (ou coloque-a em primeiro).');
      var outras = {};
      A(d.recursos).forEach(function (r) { var t = N(r && r['TaxaEnergia (R$/kWh)']); if (t > 0 && Math.abs(t - tarifa) > 1e-9) outras[t] = (outras[t] || 0) + 1; });
      Object.keys(outras).forEach(function (t) {
        add('A', 'Tarifa de energia diferente no cadastro de recursos', 'Recursos / Máquinas', q4(t) + ' R$/kWh', outras[t] + ' recurso(s) com ' + q4(t) + ' R$/kWh; o custo das OPs usa ' + q4(tarifa) + ' R$/kWh (Fatores de custo).',
          'Nenhum no custo hoje (ele usa os Fatores de custo), mas a tela de recursos mostra outra tarifa.', 'Deixe a tarifa dos recursos igual à dos Fatores de custo.');
      });
    }

    /* 5) OPs: quantidade produzida */
    var prod = producaoPorOP();
    A(d.op).forEach(function (o) {
      var k = txt(o && o.CodOP); if (!k || prod[k] === undefined) return;
      if (Math.abs(N(o.QtdProduzida) - prod[k]) > 1e-6) add('E', 'Quantidade produzida diferente dos apontamentos', 'Ordens de produção', 'OP ' + k, 'QtdProduzida ' + q4(o.QtdProduzida) + ' × soma dos apontamentos ' + q4(prod[k]) + '.',
        'Custo unitário, lotes de PI/PA e passaporte usam a QtdProduzida.', 'Grave um apontamento na OP (o MES recalcula a soma) ou corrija o apontamento errado.');
    });

    /* 6) famílias: custo e CO₂ gravados × atuais, fatores ambientais, etapas sem tempo, planejado sem consumo */
    familias.forEach(function (f) {
      var cod = f.cod, reg = 'Família ' + cod, g = gravadoDe(d.custos_op, cod), c = f.custo;
      if (g && c) {
        var tg = N(g.CustoTotal), ta = N(c.CustoTotal), dif = ta - tg;
        if (Math.abs(dif) >= 0.01) add(Math.abs(dif) > Math.abs(tg) * 0.005 ? 'A' : 'I', 'Custo gravado diferente do cálculo atual', 'Custos', reg,
          'Gravado ' + rs(tg) + (txt(g.DataFechamentoCusto || g.DataCalculo) ? ' em ' + txt(g.DataFechamentoCusto || g.DataCalculo) : '') + (g.CustoFechado === 'SIM' ? ' (fechado no encerramento)' : '') + '; atual ' + rs(ta) +
          ': diferença ' + rs(dif) + (tg ? ' (' + fmtNum(arred(dif / tg * 100, 1), 1, 1) + '%)' : '') + '. Unitário gravado ' + rs(g.CustoUnitario) + ' × atual ' + rs(c.CustoUnitario) + '.',
          'Custos Industriais, relatórios de custo gravado e passaporte mostram o valor gravado.',
          fechada(f.op) ? 'Se a diferença vem de correção de dados ou de regra, reabra a OP de PA e encerre de novo: o custo fechado é gravado de novo no encerramento (não muda sozinho).' : 'Recalcule e grave o custo na tela Custos.');
      }
      var s = f.sust || {}, gs = gravadoDe(d.sust_op, cod);
      if (gs && s.CO2eqTotal !== undefined) {
        var sg = N(gs.CO2eqTotal), sa = N(s.CO2eqTotal), ds = sa - sg;
        if (Math.abs(ds) >= 0.0001) add(Math.abs(ds) > Math.abs(sg) * 0.005 ? 'A' : 'I', 'CO₂ gravado diferente do cálculo atual', 'Sustentabilidade / ACV', reg,
          'Gravado ' + q4(sg) + ' kg CO₂eq' + (txt(gs.DataCalculo) ? ' em ' + txt(gs.DataCalculo) : '') + '; atual ' + q4(sa) + ' kg CO₂eq: diferença ' + q4(ds) + ' kg' + (sg ? ' (' + fmtNum(arred(ds / sg * 100, 1), 1, 1) + '%)' : '') + '.',
          'Telas e documentos que leem o cálculo gravado (passaporte) mostram o valor antigo.', 'Calcule de novo na tela Sustentabilidade / ACV para gravar o valor atual.');
      }
      if (txt(s.MateriaisSemFatorCO2)) add('A', 'Material sem fator de emissão', 'Sustentabilidade / ACV', reg, 'Sem fator de CO₂: ' + txt(s.MateriaisSemFatorCO2) + '.', 'O CO₂ desses materiais conta 0: a pegada fica menor que a real.', 'Cadastre o fator na biblioteca de fatores ambientais.');
      if (txt(s.MateriaisSemFatorKg)) add('A', 'Material sem conversão para kg', 'Sustentabilidade / ACV', reg, 'Sem fator para kg: ' + txt(s.MateriaisSemFatorKg) + '.', 'A massa e o CO₂ desses materiais contam 0.', 'Informe o "Fator conversão para kg" no cadastro de materiais.');
      if (N(s.EnergiaKWh) > 0 && !(N(s.CO2eqEnergia) > 0)) add('A', 'Energia sem fator de emissão', 'Sustentabilidade / ACV', reg, q4(s.EnergiaKWh) + ' kWh sem fator de CO₂ da energia.', 'O CO₂ da energia conta 0.', 'Cadastre o fator de emissão da energia elétrica (Sustentabilidade).');
      var kwhFam = A(f.audit && f.audit.etapas).reduce(function (s2, e) { return s2 + N(e.EnergiaKWh); }, 0);
      A(f.audit && f.audit.etapas).forEach(function (e) {
        var r2 = 'OP ' + txt(e.OP) + ' · etapa ' + txt(e.Ordem) + (txt(e.Equipamento) ? ' · ' + txt(e.Equipamento) : '');
        if (N(e.EnergiaKWh) > 100 && kwhFam > 0 && N(e.EnergiaKWh) / kwhFam > 0.25) add('I', 'Etapa concentra a energia da família', 'Ordens de produção', r2,
          fmtNum(arred(N(e.EnergiaKWh), 2), 2, 0) + ' kWh = ' + fmtNum(arred(N(e.PotenciaW) / 1000, 3), 3, 0) + ' kW × ' + fmtNum(arred(N(e.TempoMin) / 60, 2), 2, 0) + ' h: ' + fmtNum(arred(N(e.EnergiaKWh) / kwhFam * 100, 1), 1, 0) + '% da energia da família.',
          'Energia, custo de energia e CO₂ da família.', 'Confira potência e tempo. Se o equipamento atende várias células ou lotes ao mesmo tempo (ciclador, estufa), a energia da etapa vai inteira para esta OP: ajuste o tempo ou a potência atribuídos a ela.');
        if (!(N(e.TempoMin) > 0)) add('A', 'Etapa sem tempo', 'Ordens de produção', r2, 'Sem tempo real nem planejado (roteiro e cadastro do recurso).', 'Energia e mão de obra dessa etapa contam 0.', 'Informe o tempo da operação no roteiro ou aponte o tempo real.');
        else if (!(N(e.PotenciaW) > 0)) add('I', 'Etapa sem potência', 'Ordens de produção', r2, 'Equipamento sem potência cadastrada.', 'Energia dessa etapa conta 0.', 'Se a etapa usa equipamento elétrico, cadastre a potência em Recursos / Máquinas.');
      });
      A(f.audit && f.audit.materiais).forEach(function (m) {
        if (!/fora do custo/i.test(txt(m['Origem custo']))) return;
        add('I', 'OP encerrada com material planejado sem consumo', 'Custos', 'OP ' + txt(m.OP) + ' · ' + txt(m.CodigoMaterial),
          txt(m.CodigoMaterial) + (txt(m.Material) ? ' — ' + txt(m.Material) : '') + ': planejado ' + q4(m.QtdPlanejada) + ' ' + txt(m.UM) + ', sem consumo apontado (seria ' + rs(N(m.QtdPlanejada) * N(m.CustoUnitario)) + ').',
          'Fica fora do custo e do CO₂ da família (só o consumo real conta em OP encerrada).', 'Se o material foi usado nessa OP, reabra a OP, aponte o consumo e encerre de novo.');
      });
    });

    out.sort(function (a, b) { return ORDEM_GRAV[a._g] - ORDEM_GRAV[b._g] || String(a.Tipo).localeCompare(String(b.Tipo), 'pt-BR') || String(a.Registro).localeCompare(String(b.Registro), 'pt-BR', { numeric: true }); });
    var cont = { E: 0, A: 0, I: 0 }; out.forEach(function (x) { cont[x._g]++; delete x._g; });
    return { linhas: out, resumo: [['Erros (número errado hoje)', cont.E], ['Atenção (provavelmente errado ou desatualizado)', cont.A], ['Informação (regra aplicada)', cont.I],
      ['Famílias de OPs conferidas', familias.length], ['Lotes conferidos', lotes.length]] };
  }

  /* ---------------------------------------------------------------------
     4) EXECUÇÃO: filtros comuns, colunas, ordem e totais
     (a mesma para a prévia na tela, o Excel, os modelos salvos e o dossiê)
     --------------------------------------------------------------------- */
  var ABAS = { est_minimo: 'Abaixo do estoque mínimo', prod_consumo: 'Consumo planejado × real', tempo_maquina_op: 'Tempo planejado × real',
    pcp_aderencia: 'Programado × executado', pcp_mrp: 'MRP das OPs abertas', custo_op: 'Custo por OP', custo_familia: 'Custo da família', acv_familia: 'Pegada de carbono',
    acv_contribuicao: 'Contribuição no CO₂', acv_aicv: 'Resultados de AICV', bp_campos: 'Passaporte campo a campo', cad_estrutura: 'Estrutura do produto',
    cad_roteiro_op: 'Roteiros - operações', cad_roteiro_insumos: 'Roteiros - insumos', cad_recursos: 'Recursos e máquinas' };
  function abaDe(def) { return ABAS[def.id] || def.nome.replace(/\s*\([^)]*\)\s*$/, ''); }
  function colunaDe(def, k) { return A(def && def.colunas).find(function (c) { return c.k === k; }) || null; }
  function rotuloColuna(def, k) { var c = colunaDe(def, k); return c ? c.l : k; }
  function numerica(c) { return ['int', 'num', 'qtd', 'moeda', 'pct', 'min', 'h', 'co2'].indexOf(c.t) >= 0; }
  function filtroVazio() { return { de: '', ate: '', projeto: '', produto: '', op: '', maquina: '', status: '', busca: '' }; }
  function isoDia(v) { var s = txt(v); if (!s) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; var d = paraData(s); return d ? diaISO(d) : ''; }
  function normalizarFiltros(f) {
    var o = filtroVazio();
    if (f && typeof f === 'object') Object.keys(o).forEach(function (k) { if (f[k] != null) o[k] = txt(f[k]); });
    o.de = isoDia(o.de); o.ate = isoDia(o.ate);
    if (f && f.ops instanceof Set) o.ops = f.ops;
    else if (f && Array.isArray(f.ops)) o.ops = new Set(f.ops.map(txt));
    return o;
  }
  /* colunas com vários códigos ("A; B") contam cada um */
  function valoresDe(v) { var s = txt(v); return s.indexOf('; ') >= 0 ? s.split('; ') : [s]; }
  function fimDoDia(d) { return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999) : null; }
  function filtrar(def, linhas, f, colunas) {
    var F = def.filtros || {}, de = null, ate = null, q = norm(f.busca);
    if (F.periodo && !def.periodoInterno) { de = f.de ? paraData(f.de) : null; ate = fimDoDia(f.ate ? paraData(f.ate) : null); }
    var pj = norm(f.projeto), pr = norm(f.produto), op = norm(f.op), mq = norm(f.maquina), st = norm(f.status);
    return linhas.filter(function (l) {
      if (de || ate) { var d = l[F.periodo]; if (!(d instanceof Date) || (de && d < de) || (ate && d > ate)) return false; }
      if (pj && F.projeto && norm(l[F.projeto]).indexOf(pj) < 0) return false;
      if (pr && (F.produto || F.produtoDesc) && !((F.produto && norm(l[F.produto]).indexOf(pr) >= 0) || (F.produtoDesc && norm(l[F.produtoDesc]).indexOf(pr) >= 0))) return false;
      if (op && F.op && norm(l[F.op]).indexOf(op) < 0) return false;
      if (mq && F.maquina && valoresDe(l[F.maquina]).map(norm).indexOf(mq) < 0) return false;
      if (st && F.status && norm(l[F.status]) !== st) return false;
      if (f.ops instanceof Set && F.op && !valoresDe(l[F.op]).some(function (v) { return f.ops.has(v); })) return false;
      if (q && !colunas.some(function (c) { return norm(formatar(l[c.k], c)).indexOf(q) >= 0; })) return false;
      return true;
    });
  }
  function ordenar(linhas, ordem) {
    if (!ordem || !ordem.k) return linhas;
    var k = ordem.k, s = ordem.dir === 'desc' ? -1 : 1;
    return linhas.slice().sort(function (a, b) {
      var x = a[k], y = b[k], vx = x === '' || x == null, vy = y === '' || y == null;
      if (vx || vy) return vx && vy ? 0 : (vx ? 1 : -1);
      if (x instanceof Date && y instanceof Date) return s * (x - y);
      if (typeof x === 'number' && typeof y === 'number') return s * (x - y);
      return s * String(x).localeCompare(String(y), 'pt-BR', { numeric: true, sensitivity: 'base' });
    });
  }
  /* unidade no cabeçalho: quantidade com uma só UM nas linhas leva a UM no nome da coluna */
  function comUnidade(cols, linhas) {
    return cols.map(function (c) {
      if (c.t !== 'qtd' || c.u) return c;
      var ums = unicos(linhas.filter(function (l) { return typeof l[c.k] === 'number'; }).map(function (l) { return l[c.um || 'UM']; }));
      if (ums.length !== 1) return c;
      var n = Object.assign({}, c); n.u = ums[0]; return n;
    });
  }
  function chaveCache(def, f) { return def.id + '|' + f.de + '|' + f.ate + '|' + (f.ops ? Array.from(f.ops).sort().join(',') : ''); }
  async function executar(def, filtros, colsK, ordem, cache) {
    if (!def) throw new Error('Relatório não encontrado.');
    var f = normalizarFiltros(filtros), chave = chaveCache(def, f), bruto;
    if (cache && cache.chave === chave && cache.dados) bruto = cache.dados;
    else {
      var r = await semGravar(function () { return def.linhas(f); });
      bruto = { linhas: (Array.isArray(r) ? r : A(r && r.linhas)).filter(Boolean), resumo: Array.isArray(r) ? [] : A(r && r.resumo) };
    }
    var sel = A(colsK).length ? def.colunas.filter(function (c) { return colsK.indexOf(c.k) >= 0; }) : def.colunas.slice();
    if (!sel.length) sel = def.colunas.slice();
    var linhas = ordenar(filtrar(def, bruto.linhas, f, sel), ordem), cols = comUnidade(sel, linhas);
    return { def: def, filtros: f, ordem: ordem && ordem.k ? ordem : null, colunas: cols, linhas: linhas, totais: totaisColunas(cols, linhas), resumo: bruto.resumo,
      total: bruto.linhas.length, bruto: bruto, chave: chave };
  }
  function rotuloFiltro(def, campo) {
    var F = def.filtros || {};
    if (campo === 'periodo') return def.id === 'pcp_carga' ? 'Período da carga' : 'Período (' + rotuloColuna(def, F.periodo) + ')';
    if (campo === 'projeto') return 'Projeto';
    if (campo === 'maquina') return 'Máquina';
    if (campo === 'produto') return rotuloColuna(def, F.produto || F.produtoDesc) + (F.produto && F.produtoDesc ? ' ou descrição' : '');
    if (campo === 'op') return rotuloColuna(def, F.op);
    if (campo === 'status') return rotuloColuna(def, F.status);
    return campo;
  }
  function descreverFiltros(def, f) {
    var F = def.filtros || {}, out = [];
    if ((f.de || f.ate) && F.periodo) out.push([rotuloFiltro(def, 'periodo'), (f.de ? fmtData(paraData(f.de)) : 'início') + ' a ' + (f.ate ? fmtData(paraData(f.ate)) : 'hoje')]);
    ['projeto', 'produto', 'op', 'maquina', 'status'].forEach(function (k) { if (f[k] && F[k === 'produto' ? (F.produto ? 'produto' : 'produtoDesc') : k]) out.push([rotuloFiltro(def, k), f[k]]); });
    if (f.busca) out.push(['Busca livre', f.busca]);
    if (f.ops instanceof Set) out.push(['OPs', Array.from(f.ops).join('; ')]);
    return out;
  }
  var NOTA_TOTAIS = 'Linha "Total": fórmula SUBTOTAL(109) — ao filtrar no Excel, soma só as linhas visíveis. Quantidades de unidades diferentes não são somadas ("várias UM"); ' +
    'percentuais, custos unitários, fatores e saldos acumulados não são somados. Números e datas estão gravados como número e data (prontos para filtro, soma e tabela dinâmica).';
  function abaDados(res) { return { nome: abaDe(res.def), congelar: true, blocos: [{ tipo: 'tabela', colunas: res.colunas, linhas: res.linhas, totais: true, filtro: true }] }; }
  function abaParametros(res, modelo) {
    var def = res.def, kv = [['Relatório', def.nome], ['Módulo', nomeModulo(def.modulo)], ['Descrição', def.descricao]];
    if (modelo) kv.push(['Modelo salvo', modelo.Nome + ' (' + modelo.IdModelo + ', criado por ' + (modelo.CriadoPor || '?') + ')']);
    kv.push(['Gerado em', new Date()], ['Usuário', usuarioNome()], ['Versão', 'MES LION 1.0 JSON · relatórios ' + VERSAO],
      ['Registros exportados', res.linhas.length], ['Registros antes dos filtros', res.total]);
    var fl = descreverFiltros(def, res.filtros);
    if (fl.length) fl.forEach(function (x) { kv.push(['Filtro: ' + x[0], x[1]]); });
    else kv.push(['Filtros', 'Nenhum (todos os registros)']);
    if (res.ordem) kv.push(['Ordenação', rotuloColuna(def, res.ordem.k) + (res.ordem.dir === 'desc' ? ' (decrescente)' : ' (crescente)')]);
    kv.push(['Colunas', res.colunas.map(rotulo).join('; ')], ['Regra de cálculo', def.regra]);
    A(res.resumo).forEach(function (x) { kv.push([x[0], x[1], x[2]]); });
    return { nome: 'Parâmetros', blocos: [{ tipo: 'titulo', texto: 'MES LION — ' + def.nome }, { tipo: 'kv', linhas: kv }, { tipo: 'nota', texto: NOTA_TOTAIS }] };
  }
  function textoFiltros(def, f) { var fl = descreverFiltros(def, f); return fl.length ? fl.map(function (x) { return x[0] + ': ' + x[1]; }).join(' | ') : 'Nenhum'; }
  async function exportar(res, modelo) {
    var nome = nomeArquivo(modelo ? modelo.Nome : res.def.nome), bytes = await XLSX.gerar([abaDados(res), abaParametros(res, modelo)], { titulo: res.def.nome });
    baixar(bytes, nome);
    await registrarExportacao({ relatorio: res.def.id, nome: res.def.nome + (modelo ? ' — modelo ' + modelo.Nome : ''), arquivo: nome, linhas: String(res.linhas.length), abas: '2',
      filtros: textoFiltros(res.def, res.filtros) });
    return { nome: nome, bytes: bytes };
  }

  /* ---------------------------------------------------------------------
     5) DOSSIÊ DA OP — uma planilha com várias abas (a OP sozinha ou a família PA + PIs)
     --------------------------------------------------------------------- */
  function acharOP(v) {
    var s = txt(v); if (!s) return null;
    var ops = A((D() || {}).op).filter(function (o) { return o && o.CodOP; }), n = norm(s);
    return ops.find(function (o) { return txt(o.CodOP) === s; }) || ops.find(function (o) { return norm(o.CodOP) === n || (txt(o.CodigoBarras) && norm(o.CodigoBarras) === n); }) || null;
  }
  var COLS_RAST = [C('Direcao', 'Direção'), C('Nivel', 'Nível', 'int', { soma: false }), C('Tipo', 'Tipo'), C('OP', 'OP'), C('Etapa', 'Etapa'), C('Item', 'Item'), C('Descricao', 'Descrição'),
    C('Lote', 'Lote / entrada'), C('Etiqueta', 'Etiqueta'), C('OPRelacionada', 'OP relacionada'), C('Qtd', 'Quantidade', 'qtd', { soma: false }), C('UM', 'UM'), C('Data', 'Data', 'data'),
    C('Fornecedor', 'Fornecedor'), C('NF', 'Nota fiscal'), C('Detalhe', 'Detalhe')];
  /* para trás: lotes de matéria-prima e lotes de PI que entraram (e, de cada PI, a OP que o produziu, em níveis);
     para frente: quem consumiu o PI / PA produzido (em níveis), perdas e baixas do lote e passaportes da OP */
  function rastreabilidade(membros) {
    var d = D() || {}, ops = opsMapa(), desc = mapaDescricoes(), entradas = {}, out = [], L = livroPI(), lotes = L ? Object.keys(L.lotes || {}).map(function (k) { return L.lotes[k]; }) : [];
    var origemDoConsumo = new Map();
    lotes.forEach(function (x) { A(x.Consumos).forEach(function (c) { origemDoConsumo.set(c, x); }); });
    A(d.entradas).forEach(function (e) { if (e && e.Entrada) entradas[txt(e.Entrada)] = e; });
    var TRAS = 'Para trás (o que entrou)', FRENTE = 'Para frente (para onde foi)', vistosT = {}, vistosF = {};
    function tras(cod, nivel) {
      if (vistosT[cod] || nivel > 15) return; vistosT[cod] = 1;
      var consumos = A(d.consumos_materiais).filter(function (c) { return c && txt(c.CodOP) === cod; }), comLote = {};
      consumos.forEach(function (c) {
        var e = entradas[txt(c.Entrada)] || {}; comLote[txt(c.CodigoMaterial)] = 1;
        out.push({ Direcao: TRAS, Nivel: nivel, Tipo: 'Lote de matéria-prima', OP: cod, Etapa: etapaTxt(c.OrdemEtapa, c.Processo), Item: txt(c.CodigoMaterial), Descricao: txt(c.DescricaoMaterial) || desc[txt(c.CodigoMaterial)] || '',
          Lote: txt(c.Entrada) + (txt(c.Lote) ? ' / ' + txt(c.Lote) : ''), Etiqueta: '', OPRelacionada: '', Qtd: arred(consumoLiquido(c)), UM: txt(c.UM), Data: paraData(c.DataApontamento),
          Fornecedor: txt(e.NomeFornecedor), NF: txt(e['N° NF']), Detalhe: 'Consumo apontado (retirado − devolvido)' });
      });
      A(d.op_materiais).forEach(function (m) {
        if (!m || ehLinhaPI(m) || txt(m.CodOP) !== cod || comLote[txt(m.CodigoMaterial)] || !(N(m.QtdConsumida) > 0)) return;
        out.push({ Direcao: TRAS, Nivel: nivel, Tipo: 'Matéria-prima sem lote apontado', OP: cod, Etapa: etapaTxt(m.OrdemEtapa || m.Ordem, m.Processo), Item: txt(m.CodigoMaterial),
          Descricao: txt(m.DescricaoMaterial) || desc[txt(m.CodigoMaterial)] || '', Lote: '', Etiqueta: '', OPRelacionada: '', Qtd: N(m.QtdConsumida), UM: txt(m.UM), Data: null,
          Fornecedor: '', NF: '', Detalhe: 'Consumo antigo da linha da OP (sem lote)' });
      });
      A(d.op_pi_consumos).forEach(function (c) {
        if (!consumoPIAtivo(c) || txt(c.CodOPConsumidora) !== cod) return;
        var lo = origemDoConsumo.get(c), orig = (lo && lo.CodOP) || txt(c.CodOPOrigemPI);
        out.push({ Direcao: TRAS, Nivel: nivel, Tipo: String(c.PIExterno) === 'true' || c.PIExterno === true || c.PIExterno === 'Sim' ? 'PI de outra família' : 'Lote de PI', OP: cod,
          Etapa: etapaTxt(c.OrdemEtapa, c.Processo), Item: txt(c.CodigoPI), Descricao: desc[txt(c.CodigoPI)] || '', Lote: txt(c.IdLotePI) || (lo ? lo.IdLote : ''), Etiqueta: txt(c.IdEtiqueta),
          OPRelacionada: orig, Qtd: N(c.QuantidadeConsumida), UM: txt(c.UM), Data: paraData(c.DataConsumo || c.DataApontamento), Fornecedor: '', NF: '', Detalhe: origemConsumoPI(c.Origem) });
        if (orig && ops[orig]) tras(orig, nivel + 1);
      });
    }
    function frente(cod, nivel) {
      if (vistosF[cod] || nivel > 15) return; vistosF[cod] = 1;
      lotes.filter(function (x) { return x.CodOP === cod; }).forEach(function (x) {
        A(x.Consumos).forEach(function (c) {
          var cons = txt(c.CodOPConsumidora);
          out.push({ Direcao: FRENTE, Nivel: nivel, Tipo: 'Consumido por outra OP', OP: cod, Etapa: etapaTxt(c.OrdemEtapa, c.Processo), Item: x.CodigoProduto, Descricao: x.Descricao, Lote: x.IdLote,
            Etiqueta: txt(c.IdEtiqueta), OPRelacionada: cons, Qtd: N(c.QuantidadeConsumida), UM: txt(c.UM) || x.UM, Data: paraData(c.DataConsumo || c.DataApontamento), Fornecedor: '', NF: '', Detalhe: origemConsumoPI(c.Origem) });
          if (cons && ops[cons]) frente(cons, nivel + 1);
        });
        A(x.Perdas).forEach(function (p) {
          out.push({ Direcao: FRENTE, Nivel: nivel, Tipo: 'Perda do lote (retirada adicional)', OP: cod, Etapa: etapaTxt(p.OrdemEtapa, p.Processo), Item: x.CodigoProduto, Descricao: x.Descricao, Lote: x.IdLote,
            Etiqueta: txt(p.IdEtiqueta), OPRelacionada: txt(p.CodOP), Qtd: N(p.QuantidadePerdida), UM: txt(p.Unidade) || x.UM, Data: paraData(p.DataApontamento), Fornecedor: '', NF: '', Detalhe: txt(p.Motivo) });
        });
        A(x.Baixas).forEach(function (a) {
          out.push({ Direcao: FRENTE, Nivel: nivel, Tipo: 'Baixa do lote', OP: cod, Etapa: '', Item: x.CodigoProduto, Descricao: x.Descricao, Lote: x.IdLote, Etiqueta: txt(a.IdEtiqueta), OPRelacionada: '',
            Qtd: N(a.Quantidade), UM: txt(a.UM) || x.UM, Data: paraData(a.Data), Fornecedor: '', NF: '', Detalhe: txt(a.Motivo) });
        });
      });
      A(d.bp).forEach(function (bp) {
        if (!bp || txt(bp.CodOrdemProducao) !== cod) return;
        out.push({ Direcao: FRENTE, Nivel: nivel, Tipo: 'Passaporte da bateria', OP: cod, Etapa: '', Item: txt(bp.CodProduto), Descricao: '', Lote: txt(bp.IDLote), Etiqueta: '', OPRelacionada: '',
          Qtd: '', UM: '', Data: paraData(bp.DataCriacao), Fornecedor: '', NF: '', Detalhe: txt(bp.BatteryPassportID) + ' · ' + (txt(bp.StatusPassaporte) || 'RASCUNHO') });
      });
    }
    membros.forEach(function (c) { tras(c, 1); });
    membros.forEach(function (c) { frente(c, 1); });
    return out;
  }
  function kvDaLinha(res, ignorar) {
    var l = res.linhas[0]; if (!l) return [];
    return res.colunas.filter(function (c) { return (ignorar || []).indexOf(c.k) < 0; }).map(function (c) { return [rotulo(c), l[c.k], c]; });
  }
  async function montarDossie(codTxt, familia) {
    var op = acharOP(codTxt); if (!op) throw new Error('OP não encontrada: ' + txt(codTxt));
    var cod = txt(op.CodOP), ops = opsMapa(), r = raiz(op);
    var membros = familia ? Object.keys(ops).filter(function (c) { return raiz(ops[c]) === r; }) : [cod];
    if (membros.indexOf(cod) < 0) membros.push(cod);
    membros.sort(function (a, b) { return a === r ? -1 : (b === r ? 1 : a.localeCompare(b, 'pt-BR', { numeric: true })); });
    var fOps = { ops: new Set(membros) }, abas = [];
    async function tabela(nome, id) {
      var res = await executar(POR_ID[id], fOps);
      abas.push({ nome: nome, congelar: true, n: res.linhas.length, rel: POR_ID[id], blocos: [{ tipo: 'tabela', colunas: res.colunas, linhas: res.linhas, totais: true, filtro: true }] });
      return res;
    }
    var resOPs = await executar(POR_ID.prod_ops, fOps);
    await tabela('Produção', 'prod_apont');
    await tabela('Etiquetas', 'pipa_etiquetas');
    var resLotes = await tabela('Saldo PI e PA', 'pipa_lote');
    await tabela('Materiais planejado × real', 'prod_consumo');
    await tabela('Lotes de material', 'est_consumos');
    await tabela('Consumo de PIs', 'pi_consumos');
    await tabela('Tempo por máquina', 'tempo_maquina_op');
    await tabela('Apontamentos de tempo', 'tempo_apont');
    var resPerdas = await tabela('Perdas', 'perdas_lista');
    var resCusto = await tabela('Custo por OP', 'custo_op');
    /* custo e CO₂ são da família inteira (OP de PA + PIs), como no módulo Custos e no Sustentabilidade */
    var fRaiz = { ops: new Set([r]) }, cf = await executar(POR_ID.custo_familia, fRaiz), af = await executar(POR_ID.acv_familia, fRaiz), contrib = await executar(POR_ID.acv_contribuicao, fRaiz);
    var blocosFam = [];
    if (cf.linhas.length) blocosFam.push({ tipo: 'titulo', texto: 'Custo da família ' + r + ' (OP de PA + OPs de PI)' }, { tipo: 'kv', linhas: kvDaLinha(cf, ['Familia']) }, { tipo: 'nota', texto: POR_ID.custo_familia.regra });
    if (af.linhas.length) blocosFam.push({ tipo: 'titulo', texto: 'Pegada de carbono da família ' + r }, { tipo: 'kv', linhas: kvDaLinha(af, ['Familia']) }, { tipo: 'nota', texto: POR_ID.acv_familia.regra });
    if (!blocosFam.length) blocosFam.push({ tipo: 'titulo', texto: 'Custo e CO₂ da família' }, { tipo: 'nota', texto: 'A OP ' + cod + ' não pertence a uma família com OP de PA (OP de PI isolada): o custo por OP está na aba "Custo por OP".' });
    abas.push({ nome: 'Custo e CO₂ da família', n: cf.linhas.length + af.linhas.length, rel: POR_ID.custo_familia, blocos: blocosFam });
    abas.push({ nome: 'Contribuição no CO₂', congelar: true, n: contrib.linhas.length, rel: POR_ID.acv_contribuicao, blocos: [{ tipo: 'tabela', colunas: contrib.colunas, linhas: contrib.linhas, totais: true, filtro: true }] });
    var rast = semGravar(function () { return rastreabilidade(membros); });
    abas.push({ nome: 'Rastreabilidade', congelar: true, n: rast.length, rel: { nome: 'Rastreabilidade para trás e para frente', regra: 'Para trás: lotes de matéria-prima (entrada, fornecedor e NF) e lotes de PI consumidos, subindo pela OP que produziu cada PI. Para frente: OPs que consumiram o PI / PA produzido (em níveis), perdas por retirada adicional, baixas do lote e passaportes da OP. Mesmo livro do Estoque PI / PA.' },
      blocos: [{ tipo: 'tabela', colunas: comUnidade(COLS_RAST, rast), linhas: rast, totais: false, filtro: true }] });
    /* resumo na primeira aba */
    var lo = resOPs.linhas.find(function (l) { return l.OP === cod; }) || {}, um = txt(op.UM), cq = C('q', 'q', 'qtd'), cfl = cf.linhas[0] || {}, afl = af.linhas[0] || {};
    var kv = [['OP', cod], ['Tipo', txt(op.TipoOP)], ['Produto', produtoOP(op) + (txt(op.DescricaoProduto) ? ' — ' + txt(op.DescricaoProduto) : '')], ['Situação', txt(op.Status)],
      ['Projeto', projetoOP(op)], ['Roteiro', txt(op.CodRoteiro)], ['Família (OP de PA)', r], ['Conteúdo do dossiê', familia ? 'Família inteira: ' + membros.length + ' OP(s)' : 'Só esta OP'],
      ['Planejado' + (um ? ' (' + um + ')' : ''), lo.Planejado, cq], ['Produzido' + (um ? ' (' + um + ')' : ''), lo.Produzido, cq], ['Perdas do produto' + (um ? ' (' + um + ')' : ''), lo.Perdas, cq],
      ['Saldo a produzir' + (um ? ' (' + um + ')' : ''), lo.Saldo, cq], ['Atendido', lo.Atendido, colunaDe(POR_ID.prod_ops, 'Atendido')], ['Índice de perda', lo.IndicePerda, colunaDe(POR_ID.prod_ops, 'IndicePerda')],
      ['Abertura', lo.Abertura, colunaDe(POR_ID.prod_ops, 'Abertura')], ['Encerramento', lo.Encerramento, colunaDe(POR_ID.prod_ops, 'Encerramento')], ['Lead time (dias)', lo.LeadTime, colunaDe(POR_ID.prod_ops, 'LeadTime')],
      ['Tempo planejado (min)', lo.TempoPlan, colunaDe(POR_ID.prod_ops, 'TempoPlan')], ['Tempo real apontado (min)', lo.TempoReal, colunaDe(POR_ID.prod_ops, 'TempoReal')], ['Etiquetas emitidas', lo.Etiquetas]];
    var lote = resLotes.linhas.find(function (l) { return l.OP === cod; });
    if (lote) kv.push(['Saldo do lote ' + lote.Lote + (lote.UM ? ' (' + lote.UM + ')' : ''), lote.Saldo, cq], ['Disponível do lote' + (lote.UM ? ' (' + lote.UM + ')' : ''), lote.Disponivel, cq]);
    var custoOP = resCusto.linhas.find(function (l) { return l.OP === cod; });
    if (custoOP) kv.push(['Custo efetivo da OP (R$)', custoOP.TotalEf, colunaDe(POR_ID.custo_op, 'TotalEf')]);
    if (cf.linhas.length) kv.push(['Custo total da família (R$)', cfl.Total, colunaDe(POR_ID.custo_familia, 'Total')], ['Custo unitário da família (R$/' + (cfl.UM || 'UM') + ')', cfl.Unit, colunaDe(POR_ID.custo_familia, 'Unit')]);
    if (af.linhas.length) kv.push(['CO₂eq total da família (kg)', afl.Total, colunaDe(POR_ID.acv_familia, 'Total')], ['CO₂eq por unidade (kg/un)', afl.PorUnidade, colunaDe(POR_ID.acv_familia, 'PorUnidade')]);
    kv.push(['Perdas registradas (ocorrências)', resPerdas.linhas.length], ['Gerado em', new Date()], ['Usuário', usuarioNome()], ['Versão', 'MES LION 1.0 JSON · relatórios ' + VERSAO]);
    var colsOPs = resOPs.colunas.filter(function (c) { return ['OP', 'Tipo', 'Produto', 'Descricao', 'Status', 'UM', 'Planejado', 'Produzido', 'Perdas', 'Saldo', 'Atendido', 'Abertura', 'Encerramento', 'TempoPlan', 'TempoReal'].indexOf(c.k) >= 0; });
    var indice = abas.map(function (a) { return [a.nome, a.n + ' registro' + (a.n === 1 ? '' : 's') + ' — ' + a.rel.nome]; });
    abas.unshift({ nome: 'Resumo', n: resOPs.linhas.length, rel: POR_ID.prod_ops, blocos: [{ tipo: 'titulo', texto: 'Dossiê da OP ' + cod }, { tipo: 'kv', linhas: kv },
      { tipo: 'titulo', texto: familia ? 'OPs da família ' + r : 'OP' }, { tipo: 'tabela', colunas: comUnidade(colsOPs, resOPs.linhas), linhas: resOPs.linhas, totais: false, filtro: false },
      { tipo: 'titulo', texto: 'Abas deste dossiê' }, { tipo: 'kv', linhas: indice }] });
    var par = [['Dossiê da OP', cod], ['Conteúdo', familia ? 'Família inteira (OP de PA + OPs de PI)' : 'Só esta OP'], ['Família (OP de PA)', r], ['OPs incluídas', membros.join('; ')],
      ['Gerado em', new Date()], ['Usuário', usuarioNome()], ['Versão', 'MES LION 1.0 JSON · relatórios ' + VERSAO]];
    abas.slice(1).forEach(function (a) { par.push(['Aba "' + a.nome + '"', a.rel.nome + ': ' + a.rel.regra]); });
    abas.push({ nome: 'Parâmetros', n: par.length, rel: { nome: 'Parâmetros', regra: '' }, blocos: [{ tipo: 'titulo', texto: 'MES LION — Dossiê da OP ' + cod }, { tipo: 'kv', linhas: par }, { tipo: 'nota', texto: NOTA_TOTAIS }] });
    return { op: op, cod: cod, raiz: r, membros: membros, familia: !!familia, abas: abas };
  }
  function nomeArquivoDossie(cod) {
    var d = new Date();
    return 'MES_LION_Dossie_' + String(cod).replace(/[^A-Za-z0-9_-]+/g, '_') + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.xlsx';
  }
  async function exportarDossie(cod, familia) {
    var x = await montarDossie(cod, familia), nome = nomeArquivoDossie(x.cod), bytes = await XLSX.gerar(x.abas, { titulo: 'Dossiê da OP ' + x.cod });
    baixar(bytes, nome);
    await registrarExportacao({ relatorio: 'dossie_op', nome: 'Dossiê da OP ' + x.cod, arquivo: nome, abas: String(x.abas.length),
      linhas: String(x.abas.reduce(function (s, a) { return s + (a.n || 0); }, 0)), filtros: 'OP ' + x.cod + (x.familia ? ' — família ' + x.raiz + ' (' + x.membros.length + ' OPs: ' + x.membros.join('; ') + ')' : ' — só a OP') });
    return { dossie: x, nome: nome, bytes: bytes };
  }

  /* ---------------------------------------------------------------------
     6) TELAS: Catálogo, Relatório (filtros, colunas, prévia, Excel, modelo), Dossiê da OP e Meus modelos
     --------------------------------------------------------------------- */
  var EST = { id: '', filtros: filtroVazio(), colunas: null, ordem: null, modelo: '', res: null, moduloCat: '', buscaCat: '', todosModelos: false, dossieOP: '', dossieFamilia: true };
  var LIMITE_PREVIA = 200, seqExec = 0, tBusca = null;
  function jsStr(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '\\x3c').replace(/\r?\n/g, ' '); }
  function salvar() { try { if (typeof saveLocal === 'function') saveLocal(); } catch (e) { console.warn('MES LION 1.5: gravação', e); } }
  function setCurrent(k) { var api = window.mesEstoqueAPI; if (api && api.setCurrent) api.setCurrent(k); else { try { current = k; } catch (e) { } } }
  function marcarNav(k) {
    var api = window.mesEstoqueAPI;
    if (api && api.marcarNav) return api.marcarNav(k);
    try { document.body.classList.remove('dashboard-mode'); document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); }); var b = el('nav_' + k); if (b) b.classList.add('active'); } catch (e) { }
  }
  function cabecalho(t, s) { if (el('title')) el('title').textContent = t; if (el('subtitle')) el('subtitle').textContent = s || ''; }
  function msg(id, html, tipo) { var b = el(id); if (!b) return; b.className = 'mes15-msg ' + (tipo || 'ok'); b.innerHTML = html; }
  function trava(btn, on, texto) {
    if (!btn) return;
    if (on) { btn.dataset.mes15 = btn.textContent; btn.textContent = texto || 'Gerando…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.mes15 || btn.textContent; btn.disabled = false; }
  }
  function estilo() {
    if (el('mes15-estilo')) return;
    var st = document.createElement('style'); st.id = 'mes15-estilo';
    st.textContent = [
      '.mes15-card{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:12px 14px;margin:0 0 12px}',
      '.mes15-card>summary{cursor:pointer;color:#004b87;font-size:13.5px;font-weight:700}',
      '.mes15-card h3{margin:0 0 8px;color:#004b87;font-size:15px}',
      '.mes15-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}',
      '.mes15-chip{background:#eef3f7;color:#0b3a5c;border:1px solid #cfdbe5;border-radius:999px;padding:6px 12px;font-weight:700;font-size:12px;cursor:pointer}',
      '.mes15-chip.on{background:#004b87;color:#fff;border-color:#004b87}.mes15-chip small{opacity:.75;margin-left:4px;font-weight:600}',
      '.mes15-mod{margin:18px 0 8px;color:#004b87;font-size:15px}',
      '.mes15-rels{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px}',
      '.mes15-rel{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}',
      '.mes15-rel h4{margin:0;color:#0b3a5c;font-size:13.5px}.mes15-rel p{margin:0;color:#5b7385;font-size:12px;line-height:1.45;flex:1}',
      '.mes15-acoes{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}',
      '.mes15-filtros{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}',
      '.mes15-filtros label{display:flex;flex-direction:column;gap:4px;font-size:12px;margin:0;min-width:0}',
      '.mes15-filtros label>span{font-weight:700;color:#355566;font-size:11px}',
      '.mes15-filtros input,.mes15-filtros select{padding:7px 8px;border:1px solid #c9d6e0;border-radius:7px;font-size:13px;min-width:0;background:#fff;width:100%;box-sizing:border-box}',
      '.mes15-filtros .wide{grid-column:span 2}',
      '.mes15-periodo{display:flex;gap:6px}.mes15-periodo input{flex:1 1 0}',
      '.mes15-rapidos{display:flex;flex-wrap:wrap;gap:2px 8px}.mes15-rapidos a{color:#0b4a8a;font-size:11px;cursor:pointer;text-decoration:underline}',
      '.mes15-cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 12px;margin:8px 0}',
      '.mes15-cols label{display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;margin:0}',
      '.mes15-info{font-size:12.5px;color:#355566;margin:0 0 8px}',
      '.mes15-regra{font-size:12px;color:#45606f;background:#f6f9fb;border-left:4px solid #9db2c5;border-radius:8px;padding:8px 10px;margin:0 0 10px;line-height:1.45}',
      '.mes15-tab{background:#fff;border:1px solid #dbe5ec;border-radius:12px;overflow:auto;max-height:62vh}',
      '.mes15-tab table{border-collapse:collapse;width:100%;font-size:12px}',
      '.mes15-tab th{position:sticky;top:0;background:#eaf2f9;color:#073f7a;padding:7px 8px;text-align:left;white-space:nowrap;z-index:1;border-bottom:1px solid #d5e2ee}',
      '.mes15-tab th.ord{cursor:pointer;user-select:none}.mes15-tab th.ord:hover{background:#dce9f5}',
      '.mes15-tab td{padding:6px 8px;border-bottom:1px solid #edf1f5;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}',
      '.mes15-tab .n{text-align:right}',
      '.mes15-tab tfoot td{position:sticky;bottom:0;background:#e8eef4;font-weight:700;border-top:1px solid #9db2c5}',
      '.mes15-msg{font-size:12.5px;margin:6px 0}.mes15-msg:empty{display:none}',
      '.mes15-msg.ok{color:#245d0d}.mes15-msg.erro{color:#a00e1c;font-weight:700}.mes15-msg.alerta{color:#8a5a00}',
      '.mes15-tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#eef3f7;color:#0b3a5c;white-space:nowrap}',
      '.mes15-tag.info{background:#e3eefa;color:#0b4a8a}.mes15-tag.ok{background:#e3f3d8;color:#245d0d}',
      '.mes15-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:0 0 10px}',
      '.mes15-kpis div{background:#fff;border:1px solid #dbe5ec;border-radius:10px;padding:8px 10px}',
      '.mes15-kpis small{display:block;color:#5b7385;font-size:11px}.mes15-kpis b{font-size:15px;color:#0b3a5c}',
      '.mes15-inline{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.mes15-inline input{padding:7px 8px;border:1px solid #c9d6e0;border-radius:7px;font-size:13px;min-width:260px}',
      '@media (max-width:700px){.mes15-filtros .wide{grid-column:auto}.mes15-inline input{min-width:0;flex:1 1 200px}}'
    ].join('');
    document.head.appendChild(st);
  }
  function modelos() { var d = D(); return d && Array.isArray(d.relatorios_modelos) ? d.relatorios_modelos : []; }
  function admin() { var u = window.MES_CURRENT_USER; return !!(u && String(u.role || '').toUpperCase() === 'ADMIN'); }

  /* ---------------- Catálogo ---------------- */
  function telaCatalogo() {
    estilo(); setCurrent('relatorios'); marcarNav('relatorios');
    cabecalho('Relatórios', 'Relatórios prontos de todos os módulos, com filtros, prévia na tela e exportação em Excel (.xlsx): números como número, datas como data, totais e a aba Parâmetros.');
    var c = el('content'); if (!c) return;
    c.innerHTML = '<div class="toolbar"><input id="mes15_q" style="flex:1 1 320px;padding:9px 10px;border:1px solid #c9d6e0;border-radius:9px" placeholder="Pesquisar relatório, módulo ou dado (ex.: lote, perda, CO₂, máquina, etiqueta)..." ' +
      'value="' + esc(EST.buscaCat) + '" oninput="mesRelCatalogo(undefined,this.value)">' +
      '<button class="secondary" onclick="render(\'relatorios_dossie\')">📘 Dossiê da OP</button><button class="secondary" onclick="render(\'relatorios_modelos\')">⭐ Meus modelos</button></div>' +
      '<div class="mes15-regra">Os números saem das mesmas contas das telas (saldo do Estoque, livro de PI / PA, custos, ACV, carga × capacidade, passaporte). ' +
      'Abra um relatório para filtrar, escolher colunas e conferir na tela antes de exportar; salve a combinação como modelo para repetir. Cada exportação fica no Histórico de Modificações.</div>' +
      '<div id="mes15_cat_msg" class="mes15-msg"></div><div class="mes15-chips" id="mes15_chips"></div><div id="mes15_cat"></div>';
    window.mesRelCatalogo();
  }
  window.mesRelCatalogo = function (mod, busca) {
    if (mod !== undefined) EST.moduloCat = mod || '';
    if (busca !== undefined) EST.buscaCat = busca;
    var q = norm(EST.buscaCat), mods = modelos(), qtdModelo = {};
    mods.forEach(function (m) { qtdModelo[m.Relatorio] = (qtdModelo[m.Relatorio] || 0) + 1; });
    var achados = RELS.filter(function (r) {
      return !q || norm([r.nome, r.descricao, nomeModulo(r.modulo), r.colunas.map(function (c) { return c.l; }).join(' ')].join(' ')).indexOf(q) >= 0;
    });
    var chips = el('mes15_chips');
    if (chips) chips.innerHTML = '<button class="mes15-chip' + (EST.moduloCat ? '' : ' on') + '" onclick="mesRelCatalogo(\'\')">Todos<small>' + achados.length + '</small></button>' +
      MODULOS.map(function (m) {
        var n = achados.filter(function (r) { return r.modulo === m[0]; }).length;
        return n ? '<button class="mes15-chip' + (EST.moduloCat === m[0] ? ' on' : '') + '" onclick="mesRelCatalogo(\'' + m[0] + '\')">' + m[2] + ' ' + esc(m[1]) + '<small>' + n + '</small></button>' : '';
      }).join('');
    var box = el('mes15_cat'); if (!box) return;
    var html = MODULOS.filter(function (m) { return !EST.moduloCat || EST.moduloCat === m[0]; }).map(function (m) {
      var lista = achados.filter(function (r) { return r.modulo === m[0]; });
      if (!lista.length) return '';
      return '<h3 class="mes15-mod">' + m[2] + ' ' + esc(m[1]) + '</h3><div class="mes15-rels">' + lista.map(function (r) {
        return '<div class="mes15-rel" data-rel="' + r.id + '"><h4>' + esc(r.nome) + '</h4><p>' + esc(r.descricao) + '</p><div class="mes15-acoes">' +
          '<button class="mini" onclick="mesRelAbrir(\'' + r.id + '\')">Abrir</button><button class="mini secondary" onclick="mesRelExportarDireto(\'' + r.id + '\',this)">Excel (tudo)</button>' +
          (qtdModelo[r.id] ? ' <span class="mes15-tag info">⭐ ' + qtdModelo[r.id] + ' modelo' + (qtdModelo[r.id] === 1 ? '' : 's') + '</span>' : '') + '</div></div>';
      }).join('') + '</div>';
    }).join('');
    box.innerHTML = html || '<p class="muted">Nenhum relatório encontrado para “' + esc(EST.buscaCat) + '”.</p>';
  };
  window.mesRelExportarDireto = async function (id, btn) {
    var def = POR_ID[id]; if (!def) return;
    trava(btn, true);
    try { var res = await executar(def, filtroVazio()); var x = await exportar(res); msg('mes15_cat_msg', 'Exportado: <b>' + esc(x.nome) + '</b> (' + res.linhas.length + ' registros).', 'ok'); }
    catch (e) { console.error(e); msg('mes15_cat_msg', 'Não foi possível exportar “' + esc(def.nome) + '”: ' + esc(e && e.message || e), 'erro'); }
    finally { trava(btn, false); }
  };

  /* ---------------- Relatório ---------------- */
  window.mesRelAbrir = function (id, idModelo) {
    if (!POR_ID[id]) return;
    EST.id = id; EST.filtros = filtroVazio(); EST.colunas = null; EST.ordem = null; EST.modelo = ''; EST.res = null;
    if (idModelo) {
      var m = modelos().find(function (x) { return x.IdModelo === idModelo; });
      if (m) {
        var f = normalizarFiltros(m.Filtros); delete f.ops; EST.filtros = f;
        var validas = POR_ID[id].colunas.map(function (c) { return c.k; });
        EST.colunas = A(m.Colunas).filter(function (k) { return validas.indexOf(k) >= 0; });
        if (!EST.colunas.length) EST.colunas = null;
        EST.ordem = m.Ordem && m.Ordem.k && validas.indexOf(m.Ordem.k) >= 0 ? { k: m.Ordem.k, dir: m.Ordem.dir === 'desc' ? 'desc' : 'asc' } : null;
        EST.modelo = m.IdModelo;
      }
    }
    render('relatorios_ver');
  };
  function campoFiltro(def, campo) {
    var f = EST.filtros, F = def.filtros || {};
    if (campo === 'periodo') {
      return '<label class="wide"><span>' + esc(rotuloFiltro(def, 'periodo')) + (def.id === 'pcp_carga' ? ' — vazio = mês atual' : '') + '</span><div class="mes15-periodo">' +
        '<input type="date" id="mes15_f_de" value="' + esc(f.de) + '" onchange="mesRelFiltro(\'de\',this.value)" title="De">' +
        '<input type="date" id="mes15_f_ate" value="' + esc(f.ate) + '" onchange="mesRelFiltro(\'ate\',this.value)" title="Até"></div>' +
        '<div class="mes15-rapidos"><a onclick="mesRelPeriodo(\'mes\')">este mês</a><a onclick="mesRelPeriodo(\'mesant\')">mês passado</a><a onclick="mesRelPeriodo(\'30\')">últimos 30 dias</a>' +
        '<a onclick="mesRelPeriodo(\'ano\')">este ano</a><a onclick="mesRelPeriodo(\'\')">tudo</a></div></label>';
    }
    if (campo === 'maquina' || campo === 'status') {
      return '<label><span>' + esc(rotuloFiltro(def, campo)) + '</span><select id="mes15_f_' + campo + '" onchange="mesRelFiltro(\'' + campo + '\',this.value)"><option value="">(todas)</option>' +
        (f[campo] ? '<option selected value="' + esc(f[campo]) + '">' + esc(f[campo]) + '</option>' : '') + '</select></label>';
    }
    if (campo === 'produto' && !F.produto && !F.produtoDesc) return '';
    return '<label><span>' + esc(rotuloFiltro(def, campo)) + '</span><input id="mes15_f_' + campo + '" list="mes15_dl_' + campo + '" value="' + esc(f[campo]) + '" placeholder="contém…" ' +
      'onchange="mesRelFiltro(\'' + campo + '\',this.value)"><datalist id="mes15_dl_' + campo + '"></datalist></label>';
  }
  function telaRelatorio() {
    var def = POR_ID[EST.id]; if (!def) return telaCatalogo();
    estilo(); setCurrent('relatorios_ver'); marcarNav('relatorios');
    cabecalho(def.nome, nomeModulo(def.modulo) + ' · ' + def.descricao);
    var c = el('content'); if (!c) return;
    var F = def.filtros || {}, m = EST.modelo ? modelos().find(function (x) { return x.IdModelo === EST.modelo; }) : null;
    var campos = ['periodo', 'projeto', 'produto', 'op', 'maquina', 'status'].filter(function (k) { return k === 'produto' ? (F.produto || F.produtoDesc) : F[k]; });
    var sel = EST.colunas || def.colunas.map(function (x) { return x.k; });
    c.innerHTML = '<div class="toolbar"><button class="secondary" onclick="render(\'relatorios\')">← Catálogo</button>' +
      '<button id="mes15_btn_xlsx" onclick="mesRelExportar(this)">⬇ Exportar Excel (.xlsx)</button>' +
      '<button class="secondary" onclick="mesRelModeloForm()">⭐ Salvar como modelo</button>' +
      '<button class="secondary" onclick="mesRelLimpar()">Limpar filtros</button>' +
      (m ? '<span class="mes15-tag info">Modelo: ' + esc(m.Nome) + '</span>' : '') + '</div>' +
      '<div id="mes15_modelo"></div><div id="mes15_msg" class="mes15-msg"></div>' +
      '<div class="mes15-card"><h3>Filtros</h3><div class="mes15-filtros">' + campos.map(function (k) { return campoFiltro(def, k); }).join('') +
      '<label class="wide"><span>Busca livre (em todas as colunas visíveis)</span><input id="mes15_f_busca" value="' + esc(EST.filtros.busca) + '" placeholder="digite qualquer parte de um valor…" oninput="mesRelBusca(this.value)"></label>' +
      '</div></div>' +
      '<details class="mes15-card" id="mes15_cols_box"><summary>Colunas <span class="muted" id="mes15_cols_n">(' + sel.length + ' de ' + def.colunas.length + ')</span></summary>' +
      '<div class="mes15-cols" id="mes15_cols">' + def.colunas.map(function (x) {
        return '<label><input type="checkbox" value="' + esc(x.k) + '"' + (sel.indexOf(x.k) >= 0 ? ' checked' : '') + ' onchange="mesRelColuna()">' + esc(rotulo(x)) + '</label>';
      }).join('') + '</div><div class="mes15-acoes"><button class="mini secondary" onclick="mesRelColunas(true)">Marcar todas</button><button class="mini secondary" onclick="mesRelColunas(false)">Desmarcar todas</button>' +
      '<span class="muted" style="font-size:11.5px">Clique no título de uma coluna da prévia para ordenar (o Excel sai na mesma ordem).</span></div></details>' +
      '<div class="mes15-regra"><b>Regra de cálculo:</b> ' + esc(def.regra) + '</div>' +
      '<div id="mes15_previa"><p class="muted">Calculando…</p></div>';
    EST.res = null;
    atualizar();
  }
  async function atualizar() {
    var def = POR_ID[EST.id]; if (!def) return;
    var meu = ++seqExec, box = el('mes15_previa');
    try {
      var cache = EST.res && EST.res.def === def ? { chave: EST.res.chave, dados: EST.res.bruto } : null;
      var res = await executar(def, EST.filtros, EST.colunas, EST.ordem, cache);
      if (meu !== seqExec) return;
      EST.res = res;
      opcoesFiltros(res);
      desenharPrevia(res);
    } catch (e) {
      console.error(e);
      if (meu === seqExec && box) box.innerHTML = '<div class="mes15-msg erro">Não foi possível montar o relatório: ' + esc(e && e.message || e) + '</div>';
    }
  }
  /* listas dos filtros a partir das linhas do relatório (sem filtro) */
  function opcoesFiltros(res) {
    var def = res.def, F = def.filtros || {}, linhas = res.bruto.linhas;
    function distintos(k, separar) {
      var v = [];
      linhas.forEach(function (l) { (separar ? valoresDe(l[k]) : [txt(l[k])]).forEach(function (x) { if (x) v.push(x); }); });
      return unicos(v).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
    }
    ['projeto', 'produto', 'op'].forEach(function (campo) {
      var dl = el('mes15_dl_' + campo), k = campo === 'produto' ? (F.produto || F.produtoDesc) : F[campo];
      if (dl && k) dl.innerHTML = distintos(k, true).slice(0, 1500).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    });
    var maq = mapaMaquinas();
    ['maquina', 'status'].forEach(function (campo) {
      var s = el('mes15_f_' + campo); if (!s || !F[campo]) return;
      var atual = EST.filtros[campo], vals = distintos(F[campo], campo === 'maquina');
      if (atual && vals.map(norm).indexOf(norm(atual)) < 0) vals.unshift(atual);
      s.innerHTML = '<option value="">(todas)</option>' + vals.map(function (v) {
        var rot = campo === 'maquina' && maq[v] ? v + ' — ' + maq[v] : v;
        return '<option value="' + esc(v) + '"' + (norm(v) === norm(atual) ? ' selected' : '') + '>' + esc(rot) + '</option>';
      }).join('');
    });
  }
  function desenharPrevia(res) {
    var box = el('mes15_previa'); if (!box) return;
    var cols = res.colunas, n = res.linhas.length, mostra = res.linhas.slice(0, LIMITE_PREVIA), o = res.ordem;
    var info = '<div class="mes15-info"><b>' + n.toLocaleString('pt-BR') + '</b> registro' + (n === 1 ? '' : 's') +
      (n !== res.total ? ' de ' + res.total.toLocaleString('pt-BR') + ' (com os filtros)' : '') +
      (n > LIMITE_PREVIA ? ' · a prévia mostra os primeiros ' + LIMITE_PREVIA + ' — o Excel leva todos' : '') + '</div>';
    var resumo = A(res.resumo).length ? '<div class="mes15-kpis">' + res.resumo.map(function (x) {
      var v = x[1] instanceof Date ? fmtDataHora(x[1]) : (typeof x[1] === 'number' ? (x[2] ? formatar(x[1], x[2]) : fmtNum(x[1], 4, 0)) : txt(x[1]));
      return '<div><small>' + esc(x[0]) + '</small><b>' + esc(v) + '</b></div>';
    }).join('') + '</div>' : '';
    var th = cols.map(function (c) {
      var seta = o && o.k === c.k ? (o.dir === 'desc' ? ' ▼' : ' ▲') : '';
      return '<th class="ord' + (numerica(c) ? ' n' : '') + '" onclick="mesRelOrdenar(\'' + jsStr(c.k) + '\')" title="Ordenar por ' + esc(c.l) + '">' + esc(rotulo(c)) + seta + '</th>';
    }).join('');
    var corpo = mostra.map(function (l) {
      return '<tr>' + cols.map(function (c) {
        var v = formatar(l[c.k], c);
        return '<td' + (numerica(c) ? ' class="n"' : '') + (v.length > 60 ? ' title="' + esc(v) + '"' : '') + '>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var tot = res.totais, linhaTot = '';
    if (n && Object.keys(tot).length) {
      linhaTot = '<tr>' + cols.map(function (c, i) {
        var t = tot[c.k];
        if (!t) return '<td>' + (i === 0 ? 'Total (' + n.toLocaleString('pt-BR') + ')' : '') + '</td>';
        if (t.misto) return '<td class="n">várias UM</td>';
        return '<td class="n">' + esc(formatar(t.valor, c)) + (c.t === 'qtd' && t.um && t.um !== '—' && !c.u ? ' ' + esc(t.um) : '') + '</td>';
      }).join('') + '</tr>';
    }
    box.innerHTML = info + resumo + '<div class="mes15-tab"><table><thead><tr>' + th + '</tr></thead><tbody>' +
      (corpo || '<tr><td colspan="' + cols.length + '" class="muted">Nenhum registro com estes filtros.</td></tr>') + '</tbody>' + (linhaTot ? '<tfoot>' + linhaTot + '</tfoot>' : '') + '</table></div>';
  }
  window.mesRelFiltro = function (campo, valor) { EST.filtros[campo] = txt(valor); atualizar(); };
  window.mesRelBusca = function (v) { clearTimeout(tBusca); tBusca = setTimeout(function () { EST.filtros.busca = txt(v); atualizar(); }, 300); };
  window.mesRelPeriodo = function (tipo) {
    var h = new Date(), de = '', ate = '';
    if (tipo === 'mes') { de = diaISO(new Date(h.getFullYear(), h.getMonth(), 1)); ate = diaISO(new Date(h.getFullYear(), h.getMonth() + 1, 0)); }
    else if (tipo === 'mesant') { de = diaISO(new Date(h.getFullYear(), h.getMonth() - 1, 1)); ate = diaISO(new Date(h.getFullYear(), h.getMonth(), 0)); }
    else if (tipo === '30') { de = diaISO(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 29)); ate = diaISO(h); }
    else if (tipo === 'ano') { de = h.getFullYear() + '-01-01'; ate = h.getFullYear() + '-12-31'; }
    EST.filtros.de = de; EST.filtros.ate = ate;
    if (el('mes15_f_de')) el('mes15_f_de').value = de;
    if (el('mes15_f_ate')) el('mes15_f_ate').value = ate;
    atualizar();
  };
  window.mesRelLimpar = function () { EST.filtros = filtroVazio(); EST.ordem = null; telaRelatorio(); };
  window.mesRelColuna = function () {
    var def = POR_ID[EST.id]; if (!def) return;
    var caixas = Array.prototype.slice.call(document.querySelectorAll('#mes15_cols input[type=checkbox]')), marcadas = caixas.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
    if (!marcadas.length) { caixas[0].checked = true; marcadas = [caixas[0].value]; msg('mes15_msg', 'O relatório precisa de pelo menos uma coluna.', 'alerta'); }
    EST.colunas = marcadas.length === def.colunas.length ? null : marcadas;
    if (el('mes15_cols_n')) el('mes15_cols_n').textContent = '(' + marcadas.length + ' de ' + def.colunas.length + ')';
    atualizar();
  };
  window.mesRelColunas = function (todas) {
    var caixas = Array.prototype.slice.call(document.querySelectorAll('#mes15_cols input[type=checkbox]'));
    caixas.forEach(function (x, i) { x.checked = todas || i === 0; });
    window.mesRelColuna();
  };
  window.mesRelOrdenar = function (k) {
    var o = EST.ordem;
    EST.ordem = !o || o.k !== k ? { k: k, dir: 'asc' } : (o.dir === 'asc' ? { k: k, dir: 'desc' } : null);
    atualizar();
  };
  window.mesRelExportar = async function (btn) {
    var def = POR_ID[EST.id]; if (!def) return;
    trava(btn, true);
    try {
      var res = await executar(def, EST.filtros, EST.colunas, EST.ordem, EST.res && EST.res.def === def ? { chave: EST.res.chave, dados: EST.res.bruto } : null);
      var m = EST.modelo ? modelos().find(function (x) { return x.IdModelo === EST.modelo; }) : null, x = await exportar(res, m);
      msg('mes15_msg', 'Exportado: <b>' + esc(x.nome) + '</b> — ' + res.linhas.length + ' registro' + (res.linhas.length === 1 ? '' : 's') + ', ' + res.colunas.length + ' colunas e a aba Parâmetros. Registrado no Histórico de Modificações.', 'ok');
    } catch (e) { console.error(e); msg('mes15_msg', 'Não foi possível exportar: ' + esc(e && e.message || e), 'erro'); }
    finally { trava(btn, false); }
  };

  /* ---------------- Modelos salvos ---------------- */
  function novoIdModelo() {
    var d = new Date();
    return 'MREL-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  window.mesRelModeloForm = function () {
    var box = el('mes15_modelo'), def = POR_ID[EST.id]; if (!box || !def) return;
    var m = EST.modelo ? modelos().find(function (x) { return x.IdModelo === EST.modelo; }) : null;
    box.innerHTML = '<div class="mes15-card"><h3>Salvar como modelo</h3><div class="mes15-inline"><input id="mes15_modelo_nome" maxlength="80" value="' + esc(m ? m.Nome : '') + '" placeholder="Nome do modelo (ex.: Perdas do mês — linha de eletrodos)" ' +
      'onkeydown="if(event.key===\'Enter\'){event.preventDefault();mesRelModeloSalvar();}">' +
      '<button onclick="mesRelModeloSalvar()">Salvar modelo</button><button class="secondary" onclick="document.getElementById(\'mes15_modelo\').innerHTML=\'\'">Cancelar</button></div>' +
      '<p class="muted" style="font-size:12px;margin:8px 0 0">Guarda os filtros, as colunas e a ordem deste relatório. O período fica gravado como datas fixas.</p><div id="mes15_modelo_msg" class="mes15-msg"></div></div>';
    var i = el('mes15_modelo_nome'); if (i) i.focus();
  };
  window.mesRelModeloSalvar = function () {
    var def = POR_ID[EST.id], nome = txt(el('mes15_modelo_nome') && el('mes15_modelo_nome').value).replace(/\s+/g, ' ');
    if (!def) return;
    if (!nome) { msg('mes15_modelo_msg', 'Informe o nome do modelo.', 'erro'); return; }
    var d = D(); if (!d) return;
    if (!Array.isArray(d.relatorios_modelos)) d.relatorios_modelos = [];
    var eu = usuarioLogin(), agora = new Date().toLocaleString('pt-BR');
    var mesmo = d.relatorios_modelos.find(function (x) { return x.Relatorio === def.id && norm(x.Nome) === norm(nome) && x.CriadoPor === eu; });
    if (mesmo && mesmo.IdModelo !== EST.modelo && !confirm('Você já tem o modelo “' + mesmo.Nome + '” deste relatório. Substituir pelos filtros e colunas atuais?')) return;
    var filtros = normalizarFiltros(EST.filtros); delete filtros.ops;
    var dados = { Nome: nome, Relatorio: def.id, NomeRelatorio: def.nome, Modulo: def.modulo, Filtros: filtros, Colunas: EST.colunas ? EST.colunas.slice() : [], Ordem: EST.ordem ? { k: EST.ordem.k, dir: EST.ordem.dir } : null };
    var alvo = mesmo || (EST.modelo ? d.relatorios_modelos.find(function (x) { return x.IdModelo === EST.modelo && x.CriadoPor === eu && norm(x.Nome) === norm(nome); }) : null);
    if (alvo) { Object.assign(alvo, dados, { AtualizadoEm: agora, AtualizadoPor: eu }); }
    else { alvo = Object.assign({ IdModelo: novoIdModelo() }, dados, { CriadoPor: eu, CriadoEm: agora, AtualizadoEm: agora, AtualizadoPor: eu }); d.relatorios_modelos.push(alvo); }
    EST.modelo = alvo.IdModelo;
    salvar();
    if (el('mes15_modelo')) el('mes15_modelo').innerHTML = '';
    msg('mes15_msg', 'Modelo “' + esc(nome) + '” salvo (' + esc(alvo.IdModelo) + '). Ele fica em Relatórios › Meus modelos.', 'ok');
  };
  function telaModelos() {
    estilo(); setCurrent('relatorios_modelos'); marcarNav('relatorios_modelos');
    cabecalho('Meus modelos de relatório', 'Relatórios salvos com filtros, colunas e ordem — abra para conferir na tela ou exporte direto para o Excel.');
    var c = el('content'); if (!c) return;
    var eu = usuarioLogin(), todos = modelos(), lista = todos.filter(function (m) { return EST.todosModelos || m.CriadoPor === eu; });
    lista = lista.slice().sort(function (a, b) { return String(a.Nome).localeCompare(String(b.Nome), 'pt-BR', { numeric: true }); });
    var linhas = lista.map(function (m) {
      var def = POR_ID[m.Relatorio], f = normalizarFiltros(m.Filtros), pode = m.CriadoPor === eu || admin();
      return '<tr><td><b>' + esc(m.Nome) + '</b><br><span class="muted" style="font-size:11px">' + esc(m.IdModelo) + '</span></td>' +
        '<td>' + esc(def ? def.nome : (m.NomeRelatorio || m.Relatorio) + ' (indisponível)') + '<br><span class="muted" style="font-size:11px">' + esc(def ? nomeModulo(def.modulo) : '') + '</span></td>' +
        '<td style="white-space:normal;max-width:360px">' + esc(def ? textoFiltros(def, f) : '') + '</td><td class="n">' + (A(m.Colunas).length || (def ? def.colunas.length : 0)) + '</td>' +
        '<td>' + esc(m.CriadoPor || '') + '<br><span class="muted" style="font-size:11px">' + esc(m.CriadoEm || '') + '</span></td><td>' + esc(m.AtualizadoEm || '') + '</td>' +
        '<td>' + (def ? '<button class="mini" onclick="mesRelAbrir(\'' + jsStr(m.Relatorio) + '\',\'' + jsStr(m.IdModelo) + '\')">Abrir</button> ' +
          '<button class="mini secondary" onclick="mesRelModeloExportar(\'' + jsStr(m.IdModelo) + '\',this)">Excel</button> ' : '') +
        (pode ? '<button class="mini danger" onclick="mesRelModeloExcluir(\'' + jsStr(m.IdModelo) + '\')">Excluir</button>' : '') + '</td></tr>';
    });
    c.innerHTML = '<div class="toolbar"><button class="secondary" onclick="render(\'relatorios\')">← Catálogo</button>' +
      '<label style="display:flex;gap:6px;align-items:center;font-size:13px;margin:0"><input type="checkbox" style="width:16px;height:16px;min-width:0;padding:0;margin:0;flex:none"' + (EST.todosModelos ? ' checked' : '') +
      ' onchange="mesRelModelosTodos(this.checked)"> Mostrar os modelos de todos os usuários (' + todos.length + ')</label></div>' +
      '<div id="mes15_msg" class="mes15-msg"></div>' +
      '<div class="mes15-tab"><table><thead><tr><th>Modelo</th><th>Relatório</th><th>Filtros</th><th class="n">Colunas</th><th>Criado por</th><th>Atualizado em</th><th>Ações</th></tr></thead><tbody>' +
      (linhas.join('') || '<tr><td colspan="7" class="muted">Nenhum modelo salvo' + (EST.todosModelos ? '' : ' por você') + '. Abra um relatório no Catálogo, ajuste filtros e colunas e use “Salvar como modelo”.</td></tr>') +
      '</tbody></table></div>';
  }
  window.mesRelModelosTodos = function (v) { EST.todosModelos = !!v; telaModelos(); };
  window.mesRelModeloExcluir = function (id) {
    var d = D(), m = modelos().find(function (x) { return x.IdModelo === id; }); if (!d || !m) return;
    if (m.CriadoPor !== usuarioLogin() && !admin()) return;
    if (!confirm('Excluir o modelo “' + m.Nome + '”? O relatório continua no catálogo; só o modelo salvo é apagado.')) return;
    d.relatorios_modelos = modelos().filter(function (x) { return x.IdModelo !== id; });
    if (EST.modelo === id) EST.modelo = '';
    salvar();
    telaModelos();
    msg('mes15_msg', 'Modelo “' + esc(m.Nome) + '” excluído.', 'ok');
  };
  window.mesRelModeloExportar = async function (id, btn) {
    var m = modelos().find(function (x) { return x.IdModelo === id; }), def = m && POR_ID[m.Relatorio]; if (!def) return;
    trava(btn, true);
    try {
      var f = normalizarFiltros(m.Filtros); delete f.ops;
      var res = await executar(def, f, A(m.Colunas), m.Ordem), x = await exportar(res, m);
      msg('mes15_msg', 'Exportado: <b>' + esc(x.nome) + '</b> (' + res.linhas.length + ' registros).', 'ok');
    } catch (e) { console.error(e); msg('mes15_msg', 'Não foi possível exportar: ' + esc(e && e.message || e), 'erro'); }
    finally { trava(btn, false); }
  };

  /* ---------------- Dossiê da OP ---------------- */
  function telaDossie() {
    estilo(); setCurrent('relatorios_dossie'); marcarNav('relatorios_dossie');
    cabecalho('Dossiê da OP', 'Uma planilha com tudo de uma OP — ou da família OP de PA + OPs de PI: produção, etiquetas, saldos, materiais e lotes, PIs, tempos por máquina, perdas, custo, CO₂ e rastreabilidade.');
    var c = el('content'); if (!c) return;
    var ops = A((D() || {}).op).filter(function (o) { return o && o.CodOP; }).slice().sort(function (a, b) {
      var x = paraData(a.DataOP || a.DataCriacao), y = paraData(b.DataOP || b.DataCriacao);
      return ((y ? y.getTime() : 0) - (x ? x.getTime() : 0)) || txt(b.CodOP).localeCompare(txt(a.CodOP));
    });
    c.innerHTML = '<div class="toolbar"><button class="secondary" onclick="render(\'relatorios\')">← Catálogo</button>' +
      '<button id="mes15_d_btn" onclick="mesRelDossieGerar(this)">⬇ Gerar dossiê (Excel)</button></div>' +
      '<div class="mes15-card"><div class="mes15-filtros">' +
      '<label class="wide"><span>OP (digite, escolha na lista ou leia o código de barras)</span><input id="mes15_d_op" list="mes15_d_ops" value="' + esc(EST.dossieOP) + '" placeholder="OP..." ' +
      'onchange="mesRelDossieOP(this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();mesRelDossieOP(this.value);}"></label>' +
      '<label class="wide"><span>Conteúdo</span><select id="mes15_d_modo" onchange="mesRelDossieModo(this.value)"><option value="familia"' + (EST.dossieFamilia ? ' selected' : '') + '>Família inteira (OP de PA + OPs de PI)</option>' +
      '<option value="op"' + (EST.dossieFamilia ? '' : ' selected') + '>Só esta OP</option></select></label></div>' +
      '<datalist id="mes15_d_ops">' + ops.map(function (o) { return '<option value="' + esc(o.CodOP) + '">' + esc([produtoOP(o), txt(o.DescricaoProduto), txt(o.Status)].filter(Boolean).join(' · ')) + '</option>'; }).join('') + '</datalist></div>' +
      '<div id="mes15_msg" class="mes15-msg"></div><div id="mes15_d_prev">' + (EST.dossieOP ? '<p class="muted">Calculando…</p>' : '<p class="muted">Escolha uma OP para ver o conteúdo do dossiê antes de gerar.</p>') + '</div>';
    if (EST.dossieOP) previaDossie();
  }
  window.mesRelDossieOP = function (v) {
    var op = acharOP(v);
    if (!op) { msg('mes15_msg', txt(v) ? 'OP “' + esc(v) + '” não encontrada.' : '', 'erro'); return; }
    EST.dossieOP = txt(op.CodOP);
    if (el('mes15_d_op')) el('mes15_d_op').value = EST.dossieOP;
    msg('mes15_msg', '', 'ok');
    previaDossie();
  };
  window.mesRelDossieModo = function (v) { EST.dossieFamilia = v !== 'op'; if (EST.dossieOP) previaDossie(); };
  var seqDossie = 0;
  async function previaDossie() {
    var box = el('mes15_d_prev'), meu = ++seqDossie; if (!box) return;
    box.innerHTML = '<p class="muted">Calculando…</p>';
    try {
      var x = await montarDossie(EST.dossieOP, EST.dossieFamilia);
      if (meu !== seqDossie) return;
      var op = x.op;
      box.innerHTML = '<div class="mes15-kpis"><div><small>OP</small><b>' + esc(x.cod) + '</b></div><div><small>Produto</small><b>' + esc(produtoOP(op)) + '</b></div>' +
        '<div><small>Situação</small><b>' + esc(txt(op.Status) || '—') + '</b></div><div><small>Família (OP de PA)</small><b>' + esc(x.raiz) + '</b></div>' +
        '<div><small>OPs no dossiê</small><b>' + x.membros.length + '</b></div><div><small>Abas</small><b>' + x.abas.length + '</b></div></div>' +
        '<div class="mes15-card"><h3>OPs incluídas</h3><p style="margin:0;font-size:12.5px">' + x.membros.map(function (c) { return esc(c) + (c === x.raiz ? ' <span class="mes15-tag info">PA / raiz</span>' : ''); }).join(' · ') + '</p></div>' +
        '<div class="mes15-tab"><table><thead><tr><th>Aba</th><th class="n">Registros</th><th>Origem dos números</th></tr></thead><tbody>' +
        x.abas.map(function (a) { return '<tr><td><b>' + esc(a.nome) + '</b></td><td class="n">' + (a.n || 0) + '</td><td style="white-space:normal">' + esc(a.rel ? a.rel.nome : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    } catch (e) { console.error(e); if (meu === seqDossie) box.innerHTML = '<div class="mes15-msg erro">Não foi possível montar o dossiê: ' + esc(e && e.message || e) + '</div>'; }
  }
  window.mesRelDossieGerar = async function (btn) {
    var v = el('mes15_d_op') ? el('mes15_d_op').value : EST.dossieOP, op = acharOP(v);
    if (!op) { msg('mes15_msg', 'Escolha uma OP válida.', 'erro'); return; }
    EST.dossieOP = txt(op.CodOP);
    trava(btn, true);
    try {
      var r = await exportarDossie(EST.dossieOP, EST.dossieFamilia);
      msg('mes15_msg', 'Dossiê gerado: <b>' + esc(r.nome) + '</b> — ' + r.dossie.abas.length + ' abas (' + r.dossie.membros.length + ' OP' + (r.dossie.membros.length === 1 ? '' : 's') + '). Registrado no Histórico de Modificações.', 'ok');
    } catch (e) { console.error(e); msg('mes15_msg', 'Não foi possível gerar o dossiê: ' + esc(e && e.message || e), 'erro'); }
    finally { trava(btn, false); }
  };

  /* ---------------------------------------------------------------------
     7) MENU "Relatórios" e ligação com o render do app
     --------------------------------------------------------------------- */
  var ITENS_MENU = [['relatorios', 'Catálogo de relatórios'], ['relatorios_dossie', 'Dossiê da OP'], ['relatorios_modelos', 'Meus modelos']];
  function ajustarMenu() {
    try {
      var mods = (typeof modules !== 'undefined') ? modules : null, grupos = (typeof moduleGroups !== 'undefined') ? moduleGroups : null;
      if (mods) ITENS_MENU.forEach(function (x) { if (!mods.some(function (m) { return m[0] === x[0]; })) mods.push(x); });
      if (grupos && !grupos.some(function (g) { return g.title === 'Relatórios'; })) {
        var grupo = { title: 'Relatórios', icon: '📑', items: ITENS_MENU.map(function (x) { return x[0]; }) }, adm = grupos.findIndex(function (g) { return g.title === 'Administração'; });
        if (adm >= 0) grupos.splice(adm, 0, grupo); else grupos.push(grupo);
      }
    } catch (e) { console.warn('MES LION 1.5: menu', e); }
  }
  ajustarMenu();
  function refazerMenu() {
    try { var app = el('app'); if (app && !app.classList.contains('hidden') && typeof renderNav === 'function') { var at = current; renderNav(); marcarNav(at === 'relatorios_ver' ? 'relatorios' : at); } } catch (e) { }
  }
  (function () {
    var ant = window.render;
    if (typeof ant !== 'function') return;
    window.render = function (k) {
      try {
        if (k === 'relatorios') return telaCatalogo();
        if (k === 'relatorios_ver') return telaRelatorio();
        if (k === 'relatorios_dossie') return telaDossie();
        if (k === 'relatorios_modelos') return telaModelos();
      } catch (e) {
        console.error('MES LION 1.5: relatórios', e);
        var c = el('content'); if (c) c.innerHTML = '<div class="mes15-msg erro">Erro ao abrir a tela de relatórios: ' + esc(e && e.message || e) + '</div>';
        return;
      }
      return ant.apply(this, arguments);
    };
  })();
  (function () {
    var ant = window.boot;
    if (typeof ant !== 'function') return;
    window.boot = function () { ajustarMenu(); var r = ant.apply(this, arguments); refazerMenu(); return r; };
  })();
  refazerMenu();

  /* ---------------------------------------------------------------------
     8) ACESSO PARA TESTES E OUTROS ADAPTADORES
     --------------------------------------------------------------------- */
  function serial(v) { return v instanceof Date ? diaISO(v) + 'T' + pad(v.getHours()) + ':' + pad(v.getMinutes()) + ':' + pad(v.getSeconds()) : v; }
  function linhasSerial(linhas) { return linhas.map(function (l) { var o = {}; Object.keys(l).forEach(function (k) { o[k] = serial(l[k]); }); return o; }); }
  function base64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function colInfo(c) { return { k: c.k, l: rotulo(c), t: c.t }; }
  window.mesRelatoriosAPI = {
    versao: VERSAO,
    modulos: function () { return MODULOS.map(function (m) { return { id: m[0], nome: m[1] }; }); },
    lista: function () { return RELS.map(function (r) { return { id: r.id, modulo: r.modulo, nome: r.nome, aba: abaDe(r), filtros: r.filtros, periodoInterno: !!r.periodoInterno, colunas: r.colunas.map(colInfo) }; }); },
    executar: async function (id, filtros, colunas, ordem) {
      var r = await executar(POR_ID[id], filtros, colunas, ordem);
      return { colunas: r.colunas.map(colInfo), linhas: linhasSerial(r.linhas), totais: r.totais, resumo: r.resumo.map(function (x) { return [x[0], serial(x[1])]; }), total: r.total };
    },
    xlsx: async function (id, filtros, colunas, ordem) {
      var r = await executar(POR_ID[id], filtros, colunas, ordem);
      return base64(await XLSX.gerar([abaDados(r), abaParametros(r)], { titulo: r.def.nome }));
    },
    dossie: async function (cod, familia) {
      var x = await montarDossie(cod, familia !== false), b = await XLSX.gerar(x.abas, { titulo: 'Dossiê da OP ' + x.cod });
      return { op: x.cod, raiz: x.raiz, membros: x.membros, abas: x.abas.map(function (a) { return { nome: a.nome, linhas: a.n || 0 }; }), xlsx: base64(b) };
    },
    rastreabilidade: function (membros) { return linhasSerial(semGravar(function () { return rastreabilidade(A(membros)); })); },
    paraData: function (v, h) { return serial(paraData(v, h)); },
    serialExcel: function (iso) { var d = paraData(iso); return d ? XLSX.serial(d) : null; }
  };
  window.MES_ADAPTADOR_RELATORIOS = VERSAO;
})();
