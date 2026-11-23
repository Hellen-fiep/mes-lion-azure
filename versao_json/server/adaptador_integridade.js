/* =====================================================================
   MES LION — ADAPTADOR 1.7.2: INTEGRIDADE DOS DADOS (auditoria de 23/11/2026)
   Último adaptador incluído pelo servidor. Corrige, sem tocar no frontend (que continua idêntico ao original),
   os pontos em que o MES gravava dados sem o usuário pedir, inventava dados ou ligava cálculos errado:

   1) Ver, imprimir e exportar não recalculam nem gravam nada. Antes, "PDF OP Produção", "Picking List PDF",
      "Custos da OP" e "Exportar Excel" chamavam v4050RefreshCalculatedData + saveLocal (recalculavam e gravavam as
      fórmulas de todas as OPs de slurry, inclusive as encerradas, e a massa de deposição das etapas de coating), e
      abrir uma OP em Ordens de Produção recalculava a fórmula dela.
   2) Fórmula congelada de verdade: os materiais da formulação só são recalculados ao aplicar a formulação (gerar as
      OPs) e em "Atualizar quantidade e recalcular"; o cálculo usa o retrato da formulação guardado na OP
      (SnapshotFormula) — antes usava o cadastro atual, e uma mudança na formulação mudava as OPs já geradas —; OP
      encerrada nunca é recalculada; o cadastro da formulação não recebe mais os teores deduzidos (TeorSolidos* e
      TeorSolvente* calculados pelas partes), e os já gravados iguais à dedução são apagados uma vez (o cálculo deduz
      os mesmos valores sem gravá-los). OP aberta com os materiais da formulação fora da regra atual (massa total da
      OP = sólidos + solvente) é recalculada uma vez ao entrar, a partir do retrato, com registro do antes/depois em
      meta.mes172NormalizacaoFormula.
   3) Massa de deposição (informação das etapas de coating): o coating de cátodo usa o slurry de cátodo da família e o
      de ânodo, o de ânodo (antes pegava o primeiro slurry da família: no cátodo aparecia a massa do slurry de ânodo).
   4) Custo projetado de OP encerrada não muda mais quando o custo médio do material muda depois (antes, abrir a OP
      regravava o custo "congelado" com a média do dia); o custo efetivo (consumo apontado) continua sendo atualizado.
   5) Passaporte: os "Textos de validação" genéricos do V40.4.3 (due diligence, conteúdo reciclado e renovável,
      declaração UE, segurança) não são mais preenchidos sozinhos; os já gravados iguais ao texto genérico são
      apagados uma vez (meta.mes172TextosGenericosRemovidos).
   6) Autoria: campos de usuário que o frontend grava fixos como "admin" (Usuario, UsuarioCriacao,
      UsuarioUltimaAlteracao, UsuarioEncerramento, UsuarioReabertura) recebem o usuário logado quando a ação é dele;
      o cabeçalho dos relatórios mostra o usuário logado (antes, sempre "admin") e a versão do MES.
   7) Registros de teste e de demonstração do frontend (V38.19, V1.0.19 e V1.1.3) nunca ficam na base: se aparecerem,
      saem na entrada, com registro em meta.mes172RegistrosDeTesteRemovidos (só se nada os usar).
   8) Aviso na tela quando os arquivos da pasta server foram atualizados depois que a janela do servidor abriu
      (a janela antiga continua com o código antigo até ser fechada) e a versão do servidor no menu.
   ===================================================================== */
(function () {
  'use strict';
  var VERSAO = '1.7.2';
  if (window.MES_ADAPTADOR_INTEGRIDADE) return;
  window.MES_ADAPTADOR_INTEGRIDADE = VERSAO;

  function A(v) { return Array.isArray(v) ? v : []; }
  function D() { return (typeof data === 'object' && data) ? data : null; }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function N(v) {
    if (typeof num === 'function') { try { var x = num(v); if (isFinite(x)) return x; } catch (e) { } }
    var n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0;
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function agora() { return new Date().toLocaleString('pt-BR'); }
  function usuario() { try { var u = window.MES_CURRENT_USER; return txt(u && (u.username || u.fullName)); } catch (e) { return ''; } }
  function copia(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function opPor(cod) { return A((D() || {}).op).find(function (o) { return o && txt(o.CodOP) === txt(cod); }) || null; }
  function opFechada(op) {
    if (!op) return false;
    try { if (typeof v403StatusClosed === 'function' && v403StatusClosed(op)) return true; } catch (e) { }
    return /conclu|encerr|cancel|finaliz|fechad/i.test(String(op.Status || ''));
  }
  function registrar(chave, itens) {
    var d = D(); if (!d || !itens || !itens.length) return;
    d.meta = d.meta || {};
    d.meta[chave] = A(d.meta[chave]).concat(itens).slice(-300);
  }

  /* ---------------------------------------------------------------------
     1) e 2) FÓRMULA CONGELADA; NADA RECALCULA AO VER, IMPRIMIR OU EXPORTAR
     --------------------------------------------------------------------- */
  var explicito = 0;   /* > 0 enquanto roda "aplicar formulação" (gerar OPs) ou "Atualizar quantidade e recalcular" */
  /* durante fn, a formulação da OP vem do retrato guardado nela (cópia): o cadastro não é lido nem alterado */
  function comFormulaDaOP(op, fn) {
    var snap = null; try { snap = JSON.parse(op.SnapshotFormula || 'null'); } catch (e) { snap = null; }
    var fOrig = window.formulaByCodeV3813, iOrig = window.v101FormulaItems, cod = txt(op.CodFormula);
    var cab = snap && snap.cabecalho ? copia(snap.cabecalho) : null, itens = snap && Array.isArray(snap.itens) && snap.itens.length ? copia(snap.itens) : null;
    if (!cab && typeof fOrig === 'function') cab = copia(fOrig(cod));
    if (!itens && typeof iOrig === 'function') itens = copia(iOrig(cod));
    window.formulaByCodeV3813 = function (c) { return txt(c) === cod ? cab : (typeof fOrig === 'function' ? copia(fOrig(c)) : null); };
    window.v101FormulaItems = function (c) { return txt(c) === cod ? (itens || []) : (typeof iOrig === 'function' ? copia(iOrig(c)) : []); };
    try { return fn(); } finally { window.formulaByCodeV3813 = fOrig; window.v101FormulaItems = iOrig; }
  }
  var recalcOrig = window.v4050RecalculateFormulaOP;
  if (typeof recalcOrig === 'function') {
    window.v4050RecalculateFormulaOP = function (codOP) {
      var op = opPor(codOP);
      if (!op || !explicito || opFechada(op)) return;   /* ver, imprimir, exportar: nada; OP encerrada: nunca */
      var self = this, args = arguments;
      return comFormulaDaOP(op, function () { return recalcOrig.apply(self, args); });
    };
  }
  var aplicarOrig = window.aplicarFormulaNasOPsV3813;
  if (typeof aplicarOrig === 'function') {
    window.aplicarFormulaNasOPsV3813 = function () {
      var fOrig = window.formulaByCodeV3813, self = this, args = arguments;
      explicito++;
      /* o retrato guardado na OP é tirado de uma cópia do cadastro (os teores deduzidos ficam só no retrato) */
      window.formulaByCodeV3813 = function (c) { return typeof fOrig === 'function' ? copia(fOrig(c)) : null; };
      try { return aplicarOrig.apply(self, args); } finally { window.formulaByCodeV3813 = fOrig; explicito--; }
    };
  }
  function explicitamente(nome) {
    var orig = window[nome];
    if (typeof orig !== 'function') return;
    window[nome] = function () { explicito++; try { return orig.apply(this, arguments); } finally { explicito--; } };
  }
  /* "Atualizar quantidade e recalcular" (V40.5.0) e "Gerar estrutura de OPs" (V1.0.11) são ações do usuário */
  explicitamente('v4050UpdateOPQty');
  explicitamente('v1011ConfirmFamily');
  /* "Formulação só pertence ao PI slurry" (V1.0.11): a limpeza do cabeçalho da formulação nas OPs que não são de
     slurry também rodava ao abrir a OP — inclusive nas encerradas; agora só ao gerar/aplicar, e nunca em encerrada */
  var tirarOrig = window.v1011StripFormulaFromNonSlurry;
  if (typeof tirarOrig === 'function') {
    window.v1011StripFormulaFromNonSlurry = function (op) { if (!explicito || !op || opFechada(op)) return; return tirarOrig.apply(this, arguments); };
  }
  /* "Relatórios e exportações: garante atualização das massas antes de gerar documentos" (V40.5.0) — deixa de
     recalcular; só corrige a massa de deposição quando ela estiver errada */
  if (typeof window.v4050RefreshCalculatedData === 'function') {
    window.v4050RefreshCalculatedData = function () { try { massaDeposicao(); } catch (e) { if (window.console) console.warn('MES LION 1.7.2: massa de deposição', e); } };
  }
  /* os V38.19 e V1.0.19 também tinham dados de teste no boot; nenhum dos dois roda mais, mas fica garantido */
  if (typeof window.ensureTestDataV3819 === 'function') window.ensureTestDataV3819 = function () { };

  function linhasFormulaDaOP(op) {
    return A((D() || {}).op_materiais).filter(function (m) { return m && txt(m.CodOP) === txt(op.CodOP) && txt(m.CodFormula) && String(m.TipoConsumo || '').toLowerCase().indexOf('pi intermedi') < 0; });
  }
  function retratoQtd(op) {
    var r = {};
    linhasFormulaDaOP(op).forEach(function (m) { var k = txt(m.CodigoMaterial); r[k] = (r[k] || 0) + N(m.QtdPlanejada); });
    return r;
  }
  function ehSlurry(op) { try { return typeof v1011IsSlurry === 'function' ? !!v1011IsSlurry(op) : /slurry/i.test(String(op.DescricaoProduto || '')); } catch (e) { return false; } }
  /* uma vez por entrada: OP aberta de slurry cujos materiais não fecham com a regra atual é recalculada do retrato */
  function normalizarFormulasAbertas() {
    var feitos = [];
    A((D() || {}).op).forEach(function (op) {
      if (!op || !txt(op.CodFormula) || opFechada(op) || !ehSlurry(op) || !(N(op.QtdPlanejada) > 0)) return;
      var antes = retratoQtd(op), soma = Object.keys(antes).reduce(function (s, k) { return s + antes[k]; }, 0);
      /* regra atual (V1.0.1): massa total da OP = sólidos + solvente; já fechada → não mexe */
      if (Object.keys(antes).length && Math.abs(soma - N(op.QtdPlanejada)) <= Math.max(1e-9, 1e-6 * N(op.QtdPlanejada))) return;
      explicito++;
      try { window.v4050RecalculateFormulaOP(op.CodOP, false); } catch (e) { if (window.console) console.warn('MES LION 1.7.2: fórmula da OP ' + op.CodOP, e); } finally { explicito--; }
      var depois = retratoQtd(op);
      if (JSON.stringify(antes) !== JSON.stringify(depois)) {
        feitos.push({ CodOP: op.CodOP, Data: agora(), Usuario: usuario(), MassaTotalOP: txt(op.QtdPlanejada), Antes: antes, Depois: depois });
        /* custo projetado da OP com as quantidades novas (o mesmo que a tela faria ao abrir a OP) */
        try { if (typeof window.recalcularCustosOPV3814 === 'function') window.recalcularCustosOPV3814(op.CodOP); } catch (e) { }
      }
    });
    registrar('mes172NormalizacaoFormula', feitos);
    return feitos.length;
  }
  /* teores deduzidos pelas partes (V1.0.1 gravava no cadastro): apagados quando são exatamente a dedução */
  function limparTeoresDeduzidos() {
    var d = D(); if (!d) return 0;
    var feitos = [];
    A(d.formulacoes).forEach(function (f) {
      if (!f) return;
      var itens = A(d.formulacao_itens).filter(function (i) { return i && txt(i.CodFormula) === txt(f.CodFormula); });
      [['CATODO', 'TeorSolidosCatodo', 'TeorSolventeCatodo'], ['ANODO', 'TeorSolidosAnodo', 'TeorSolventeAnodo']].forEach(function (g) {
        var gi = itens.filter(function (i) { return txt(i.Grupo).toUpperCase() === g[0]; });
        var solvente = function (i) { try { return typeof v101IsSolvent === 'function' ? !!v101IsSolvent(i) : /solvent/i.test(String(i.Funcao || '')); } catch (e) { return false; } };
        var partesS = gi.filter(function (i) { return !solvente(i) && txt(i.Base).toLowerCase() !== 'massa total'; }).reduce(function (s, i) { return s + N(i.Percentual); }, 0) || 100;
        var partesV = gi.filter(solvente).reduce(function (s, i) { return s + N(i.Percentual); }, 0);
        var tot = partesS + partesV, sp = tot > 0 ? 100 * partesS / tot : 100, vp = Math.max(0, 100 - sp);
        var esperadoS = String(Number(sp.toFixed(6))), esperadoV = String(Number(vp.toFixed(6)));
        if (txt(f[g[1]]) === esperadoS && txt(f[g[2]]) === esperadoV) {
          feitos.push({ CodFormula: f.CodFormula, Grupo: g[0], TeorSolidos: f[g[1]], TeorSolvente: f[g[2]], Data: agora() });
          f[g[1]] = ''; f[g[2]] = '';
        }
      });
    });
    registrar('mes172TeoresDeduzidosApagados', feitos);
    return feitos.length;
  }

  /* ---------------------------------------------------------------------
     3) MASSA DE DEPOSIÇÃO COM O SLURRY DO MESMO ELETRODO
     --------------------------------------------------------------------- */
  function papel(op) { try { return typeof v1011Role === 'function' ? v1011Role(op) : ''; } catch (e) { return ''; } }
  function massaDeposicao() {
    var d = D(); if (!d) return 0;
    var mud = 0, campos = ['MassaEntradaSlurry', 'MassaSolventeEvaporada', 'MassaSecaProjetada', 'RegraMassa'];
    A(d.op).forEach(function (op) {
      var p = papel(op); if (p !== 'DEP_CAT' && p !== 'DEP_AN') return;
      var quer = p === 'DEP_CAT' ? 'SLURRY_CAT' : 'SLURRY_AN';
      var pai = A(d.op).find(function (s) { return s && s.CodOP !== op.CodOP && txt(s.OP_Pai) && txt(s.OP_Pai) === txt(op.OP_Pai) && papel(s) === quer; });
      var alvo = pai && N(pai.MassaSolvente) > 0 ? {
        MassaEntradaSlurry: pai.QtdPlanejada || pai.MassaTotalFormulada || '', MassaSolventeEvaporada: pai.MassaSolvente || '',
        MassaSecaProjetada: pai.MassaSolidos || pai.MassaAposDeposicao || '',
        RegraMassa: 'Na deposição, o solvente do slurry é evaporado; a massa seca projetada corresponde à fração de sólidos.'
      } : null;
      A(d.op_etapas).forEach(function (e) {
        if (!e || txt(e.CodOP) !== txt(op.CodOP) || !/deposi|coating|revest/i.test(String(e.Processo || ''))) return;
        campos.forEach(function (c) {
          var v = alvo ? alvo[c] : undefined;
          if (v === undefined) { if (c in e) { delete e[c]; mud++; } }
          else if (e[c] !== v) { e[c] = v; mud++; }
        });
      });
    });
    return mud;
  }

  /* ---------------------------------------------------------------------
     4) CUSTO PROJETADO DE OP ENCERRADA CONGELADO
     --------------------------------------------------------------------- */
  var custosOrig = window.recalcularCustosOPV3814;
  if (typeof custosOrig === 'function') {
    var CAMPOS_PROJ = ['CustoUnitarioProjetadoCongelado', 'CustoUnitarioProjetado', 'CustoUnitario', 'CustoProjetado', 'CustoTotal', 'OrigemCustoProjetado', 'DataCustoProjetado', 'QtdBaseCustoMedio', 'NumeroEntradasCustoMedio', 'FatorConversaoKg'];
    var CAMPOS_CUSTO_OP = ['CustoMateriaisProjetado', 'CustoMateriaisEfetivo', 'DesvioCustoMateriais'];
    var CAMPOS_CUSTO_LINHA = CAMPOS_PROJ.concat(['QtdConsumida', 'CustoEfetivo', 'LotesConsumidos']);
    function fotoCustos(op, mats) { return JSON.stringify([CAMPOS_CUSTO_OP.map(function (c) { return op[c]; }), mats.map(function (m) { return CAMPOS_CUSTO_LINHA.map(function (c) { return m[c]; }); })]); }
    window.recalcularCustosOPV3814 = function (codOP) {
      var op = opPor(codOP);
      if (op && !opFechada(op)) {
        /* OP aberta: custo projetado acompanha a média do material; a data só muda se algum custo mudou */
        var lista = A(D().op_materiais).filter(function (m) { return m && txt(m.CodOP) === txt(codOP); }), antes = fotoCustos(op, lista), dataAnt = op.DataAtualizacaoCustos;
        var r0 = custosOrig.apply(this, arguments);
        if (fotoCustos(op, lista) === antes) { if (dataAnt === undefined) delete op.DataAtualizacaoCustos; else op.DataAtualizacaoCustos = dataAnt; }
        return r0;
      }
      if (!op) return custosOrig.apply(this, arguments);
      var d = D(), mats = A(d.op_materiais).filter(function (m) { return m && txt(m.CodOP) === txt(codOP); });
      var guarda = mats.map(function (m) { var g = {}; CAMPOS_PROJ.forEach(function (c) { g[c] = Object.prototype.hasOwnProperty.call(m, c) ? m[c] : undefined; }); return g; });
      var opG = { CustoMateriaisProjetado: op.CustoMateriaisProjetado, CustoMateriaisEfetivo: op.CustoMateriaisEfetivo, DesvioCustoMateriais: op.DesvioCustoMateriais, DataAtualizacaoCustos: op.DataAtualizacaoCustos };
      var efetivo = function () { return JSON.stringify(mats.map(function (m) { return [m.QtdConsumida, m.CustoEfetivo, m.LotesConsumidos]; })); }, efAntes = efetivo();
      var r = custosOrig.apply(this, arguments);
      mats.forEach(function (m, i) { CAMPOS_PROJ.forEach(function (c) { if (guarda[i][c] === undefined) delete m[c]; else m[c] = guarda[i][c]; }); });
      if (opG.CustoMateriaisProjetado === undefined) delete op.CustoMateriaisProjetado; else op.CustoMateriaisProjetado = opG.CustoMateriaisProjetado;
      if (efetivo() === efAntes) {
        ['CustoMateriaisEfetivo', 'DesvioCustoMateriais', 'DataAtualizacaoCustos'].forEach(function (c) { if (opG[c] === undefined) delete op[c]; else op[c] = opG[c]; });
      } else {
        op.DesvioCustoMateriais = String(N(op.CustoMateriaisEfetivo) - N(op.CustoMateriaisProjetado));
      }
      return r;
    };
  }

  /* ---------------------------------------------------------------------
     5) PASSAPORTE SEM TEXTOS GENÉRICOS INVENTADOS
     --------------------------------------------------------------------- */
  function textosGenericos() { try { return (typeof V4043_BP_GENERIC_TEXTS === 'object' && V4043_BP_GENERIC_TEXTS) ? V4043_BP_GENERIC_TEXTS : {}; } catch (e) { return {}; } }
  window.v4043ApplyGenericBPFields = function (bp) { return bp; };
  window.v4043FillGenericBPForm = function () { };
  function limparTextosGenericos() {
    var gen = textosGenericos(), feitos = [];
    A((D() || {}).bp).forEach(function (bp) {
      if (!bp) return;
      Object.keys(gen).forEach(function (k) {
        if (txt(bp[k]) && txt(bp[k]) === txt(gen[k])) { bp[k] = ''; feitos.push({ BatteryPassportID: bp.BatteryPassportID || '', Campo: k, Data: agora() }); }
      });
    });
    registrar('mes172TextosGenericosRemovidos', feitos);
    return feitos.length;
  }

  /* ---------------------------------------------------------------------
     6) AUTORIA: O USUÁRIO LOGADO, NÃO "admin"
     --------------------------------------------------------------------- */
  var CAMPOS_USUARIO = ['Usuario', 'UsuarioCriacao', 'UsuarioUltimaAlteracao', 'UsuarioEncerramento', 'UsuarioReabertura'];
  var COLECOES_USUARIO = ['op', 'projetos', 'bp', 'roteiro', 'formulacoes', 'simulacoes'];
  var fotoAutoria = null;
  var ID_AUTORIA = { op: 'CodOP', projetos: 'CodProjeto', bp: 'BatteryPassportID', roteiro: 'CodRoteiro', formulacoes: 'CodFormula', simulacoes: 'IdSimulacao' };
  function chaveAutoria(col, r, i) { return col + '|' + (txt(r[ID_AUTORIA[col]]) || ('#' + i)); }
  function tirarFotoAutoria() {
    var d = D(); if (!d) return;
    var f = Object.create(null);
    COLECOES_USUARIO.forEach(function (col) {
      A(d[col]).forEach(function (r, i) { if (!r) return; var g = {}; CAMPOS_USUARIO.forEach(function (c) { if (c in r) g[c] = r[c]; }); f[chaveAutoria(col, r, i)] = g; });
    });
    fotoAutoria = f;
  }
  function corrigirAutoria() {
    var d = D(), u = usuario(); if (!d || !fotoAutoria || !u || u.toLowerCase() === 'admin') return 0;
    var n = 0;
    COLECOES_USUARIO.forEach(function (col) {
      A(d[col]).forEach(function (r, i) {
        if (!r) return;
        var ant = fotoAutoria[chaveAutoria(col, r, i)] || {};
        CAMPOS_USUARIO.forEach(function (c) { if (r[c] === 'admin' && ant[c] !== 'admin') { r[c] = u; n++; } });
      });
    });
    return n;
  }
  (function () {
    var ant = window.saveLocal;
    if (typeof ant !== 'function') return;
    window.saveLocal = function () {
      try { corrigirAutoria(); } catch (e) { }
      var r = ant.apply(this, arguments);
      try { tirarFotoAutoria(); } catch (e) { }
      return r;
    };
  })();
  /* cabeçalho dos relatórios (V3.9.5): mesmo layout, com o usuário logado e a versão do MES */
  var CSS_RELATORIO = "<style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.15;margin:0;color:#172b3d}.page{padding:0}.head{display:flex;align-items:center;gap:12px;border-bottom:3px solid #084777;padding-bottom:7px;margin-bottom:8px}.head img{width:135px;height:45px;object-fit:contain}.head h1{font-size:20px;margin:0;color:#084777}.meta{font-size:9px;color:#667b8b}.op-card{break-before:page}.op-card:first-child{break-before:auto}.op-stage{break-inside:avoid;margin:8px 0 10px}.op-stage h2,h2{font-size:13px;color:#084777;border-left:4px solid #5aa83d;padding-left:6px;margin:9px 0 5px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #d5e0e9;padding:4px 5px;vertical-align:top}th{background:#eaf2f8;color:#084777}tr{break-inside:avoid}.op-head td{font-size:11px}.annotation-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0}.blank{border:1px solid #cddae4;border-radius:5px;min-height:40px;padding:5px}.blank b{font-size:9px;color:#084777}.obs-big{min-height:72px;border:1px solid #cddae4;border-radius:5px;padding:6px;margin:6px 0}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:22px}.line{border-top:1px solid #374a59;text-align:center;padding-top:4px;font-size:9px}.op-summary-v395{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:5px 0}.op-summary-v395>div{border:1px solid #d6e2eb;padding:5px;background:#f8fbfd}.op-summary-v395 b{font-size:8px;color:#084777;display:block}.op-summary-v395 span{font-size:10px}.break{break-before:page}@media print{.print{display:none}.op-stage{break-inside:avoid}thead{display:table-header-group}}</style>";
  if (typeof window.reportShell === 'function') {
    window.reportShell = function (title, body) {
      var w = window.open('', '_blank'); if (!w) return alert('Permita pop-ups.');
      var h = typeof htmlEscape === 'function' ? htmlEscape : esc;
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + h(title) + '</title>' + CSS_RELATORIO + '</head><body><button class="print" onclick="window.print()" style="margin:8px;padding:6px 10px">Imprimir / Salvar PDF</button><div class="page"><div class="head"><img src="' +
        new URL('assets/logo-mes.jpg', location.href).href + '"><div><h1>' + h(title) + '</h1><div class="meta">MES LION · ' + new Date().toLocaleString('pt-BR') + ' · Usuário: ' + h(usuario() || '—') +
        ' · MES LION JSON ' + VERSAO + '</div></div></div>' + body + '</div></body></html>');
      w.document.close();
    };
  }

  /* ---------------------------------------------------------------------
     7) REGISTROS DE TESTE E DEMONSTRAÇÃO DO FRONTEND FORA DA BASE
     --------------------------------------------------------------------- */
  function removerRegistrosDeTeste() {
    var d = D(); if (!d) return 0;
    var feitos = [];
    function tirar(col, ehTeste, rotulo) {
      if (!Array.isArray(d[col])) return;
      var fica = d[col].filter(function (x) { return !(x && ehTeste(x)); });
      d[col].filter(function (x) { return x && ehTeste(x); }).forEach(function (x) { feitos.push({ Colecao: col, Registro: rotulo(x), Data: agora() }); });
      if (fica.length !== d[col].length) d[col] = fica;
    }
    var opsTeste = A(d.op).filter(function (o) { return o && /^OP-VALID-REL-/.test(txt(o.CodOP)) && o.ValidacaoRelatorio === 'Sim'; }).map(function (o) { return txt(o.CodOP); });
    var usadas = function (cod) { return A(d.op_materiais).some(function (m) { return m && txt(m.CodOP) === cod; }) || A(d.producao).some(function (p) { return p && txt(p.CodOP) === cod; }) || A(d.bp).some(function (b) { return b && txt(b.CodOrdemProducao) === cod; }); };
    opsTeste = opsTeste.filter(function (c) { return !usadas(c); });
    tirar('op_pi_consumos', function (x) { return /^CPI-TESTE-WIP-/.test(txt(x.IdConsumoPI)) && txt(x.Origem) === 'TESTE_WIP_V1019'; }, function (x) { return x.IdConsumoPI; });
    tirar('apontamento_tempos', function (x) { return txt(x.IdApontamentoTempo) === 'AT-TESTE-WIP-V1019'; }, function (x) { return x.IdApontamentoTempo; });
    var fUsada = function (c) { return A(d.op).some(function (o) { return o && txt(o.CodFormula) === c; }); };
    tirar('formulacoes', function (x) { return /^FORM-TESTE-LFP-0[12]$/.test(txt(x.CodFormula)) && txt(x.Usuario) === 'sistema' && !fUsada(txt(x.CodFormula)); }, function (x) { return x.CodFormula; });
    tirar('formulacao_itens', function (x) { return /^FORM-TESTE-LFP-0[12]$/.test(txt(x.CodFormula)) && !A(d.formulacoes).some(function (f) { return f && f.CodFormula === x.CodFormula; }); }, function (x) { return x.CodFormula + ' ' + (x.CodigoMaterial || ''); });
    tirar('op', function (x) { return opsTeste.indexOf(txt(x.CodOP)) >= 0; }, function (x) { return x.CodOP; });
    tirar('acv_icv_salvos', function (x) { return /^ICV-REL-(PRISM|21700)-GS$/.test(txt(x.IdICV)) && opsTeste.indexOf(txt(x.CodOP)) >= 0; }, function (x) { return x.IdICV; });
    tirar('acv_resultados', function (x) { return /^REL-/.test(txt(x.IdResultado)) && opsTeste.indexOf(txt(x.CodOP)) >= 0; }, function (x) { return x.IdResultado; });
    registrar('mes172RegistrosDeTesteRemovidos', feitos);
    return feitos.length;
  }

  /* ---------------------------------------------------------------------
     8) VERSÃO DO SERVIDOR E AVISO DE JANELA DO SERVIDOR DESATUALIZADA
     --------------------------------------------------------------------- */
  function infoServidor(cb) {
    try {
      var x = new XMLHttpRequest(); x.open('GET', '/api/info', true);
      x.onload = function () { try { if (x.status === 200) cb(JSON.parse(x.responseText)); } catch (e) { } };
      x.send(null);
    } catch (e) { }
  }
  function mostrarVersao(info) {
    var v = txt(info && info.servidorVersao), app = document.getElementById('app'); if (!app) return;
    var nav = document.querySelector('#app nav, #app .sidebar, #app aside') || app;
    var el = document.getElementById('mes172-versao');
    if (!el) { el = document.createElement('div'); el.id = 'mes172-versao'; el.style.cssText = 'font-size:10px;color:#8aa0b2;padding:6px 12px;opacity:.85'; nav.appendChild(el); }
    el.textContent = 'Servidor JSON ' + (v || '?') + ' · adaptadores ' + VERSAO;
    var av = document.getElementById('mes172-aviso-servidor'), lst = A(info && info.arquivosServidorAlterados).filter(function (x) { return txt(x); });
    if (lst.length) {
      if (!av) { av = document.createElement('div'); av.id = 'mes172-aviso-servidor'; av.style.cssText = 'position:sticky;top:0;z-index:9999;background:#fff4cc;border:1px solid #e0b100;color:#5a4500;padding:8px 12px;font-size:13px'; app.insertBefore(av, app.firstChild); }
      av.innerHTML = '<b>Atualização pendente:</b> os arquivos da pasta <code>server</code> mudaram depois que a janela do servidor abriu (' + esc(lst.slice(0, 4).join(', ')) + (lst.length > 4 ? '…' : '') +
        '). A janela continua com o código anterior: feche a janela preta do servidor do MES e abra o MES de novo pelo INICIAR_MES.bat.';
    } else if (av) av.parentNode.removeChild(av);
  }

  /* ---------------------------------------------------------------------
     ENTRADA: correções únicas, foto da autoria e aviso do servidor
     --------------------------------------------------------------------- */
  function aoEntrar() {
    var mud = 0;
    try { mud += removerRegistrosDeTeste(); } catch (e) { if (window.console) console.warn('MES LION 1.7.2: registros de teste', e); }
    try { mud += limparTextosGenericos(); } catch (e) { if (window.console) console.warn('MES LION 1.7.2: textos genéricos', e); }
    try { mud += limparTeoresDeduzidos(); } catch (e) { if (window.console) console.warn('MES LION 1.7.2: teores deduzidos', e); }
    try { mud += normalizarFormulasAbertas(); } catch (e) { if (window.console) console.warn('MES LION 1.7.2: fórmulas', e); }
    try { mud += massaDeposicao(); } catch (e) { if (window.console) console.warn('MES LION 1.7.2: massa de deposição', e); }
    return mud;
  }
  (function () {
    var ant = window.boot;
    if (typeof ant !== 'function') return;
    window.boot = function () {
      var mud = 0;
      try { mud = aoEntrar(); } catch (e) { }
      var r = ant.apply(this, arguments);
      try { tirarFotoAutoria(); } catch (e) { }
      if (mud) { try { window.saveLocal(); } catch (e) { } }
      infoServidor(mostrarVersao);
      return r;
    };
  })();
  /* para os testes e a conferência */
  window.mesIntegridade172 = {
    versao: VERSAO, normalizarFormulasAbertas: normalizarFormulasAbertas, massaDeposicao: massaDeposicao, limparTeoresDeduzidos: limparTeoresDeduzidos,
    limparTextosGenericos: limparTextosGenericos, removerRegistrosDeTeste: removerRegistrosDeTeste, corrigirAutoria: corrigirAutoria, tirarFotoAutoria: tirarFotoAutoria,
    explicito: function (fn) { explicito++; try { return fn(); } finally { explicito--; } }
  };
})();
