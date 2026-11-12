/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR 1.7.0: PAINÉIS E INDICADORES
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, depois de todos os outros
   adaptadores. Não altera os arquivos do frontend e não grava nada nos módulos: lê os mesmos dados e chama as mesmas
   funções que as telas usam (custo e CO₂ da família, auditoria das etapas, estoque, capacidade, paradas, testes).
     1) Tabelas dos módulos (Produção, Perdas, Consumos, Etapas, Tempos, Paradas, OEE, Custos, CO₂, Energia, Testes,
        Lotes, Capacidade, OPs) com campos tipados, unidade e o caminho da ligação (ex.: Perdas → OP → Produto →
        Química). As tabelas se ligam pelas dimensões em comum (mês, OP, família, produto, modelo, química, projeto,
        processo, equipamento, material...): cada tabela é somada no próprio nível e só depois juntada pela dimensão,
        então uma OP com vários consumos e várias perdas não multiplica nenhum número.
     2) Regra de cálculo: fórmulas em português (SOMA, MÉDIA, MÍN, MÁX, CONTAR, CONTAR.DISTINTO, DIVIDIR, SE, E, OU,
        NÃO, ABS, ARRED, MAIOR, MENOR, ACUMULADO, ANTERIOR), interpretadas pelo próprio MES (não executam código e só
        leem os dados). Travas: não soma unidades diferentes (kg com un), taxa não é somada (razão das somas), campo
        repetido por OP conta uma vez por OP, cálculo aberto com os números de verdade e "faltam dados" no lugar de 0.
     3) Indicadores oficiais (data.indicadores; só o administrador cria e altera, com versão e histórico): OEE e os
        componentes, rejeito, perda de material, custo unitário (sem depreciação), tempo de ciclo, capacidade
        instalada × utilizada, produção por mês × modelo × química, kWh consumido × gerado (medido), CO₂ por célula.
        Indicadores pessoais de cada usuário. Sub-indicadores: um indicador usa outros ([Disponibilidade] ×
        [Performance] × [Qualidade]) e abre nos componentes.
     4) Painéis (data.paineis) por área, com blocos em grade: cartão com meta e semáforo, colunas, colunas
        empilhadas, barras, linhas, combinado, pizza, medidor, tabela, matriz e dispersão. Editor de arrastar os
        campos (Eixo, Legenda, Valores, Filtros), filtros do painel, filtro cruzado (clique no gráfico), ver
        registros, Excel, PDF, modo TV, painéis modelo por área e fechamento do mês (data.paineis_fechamentos).
   ===================================================================== */
(function () {
  'use strict';
  if (window.MES_ADAPTADOR_PAINEIS) return;
  var VERSAO = '1.7.0';

  /* ---------------------------------------------------------------------
     0) UTILITÁRIOS
     --------------------------------------------------------------------- */
  function A(v) { return Array.isArray(v) ? v : []; }
  function D() { return (typeof data === 'object' && data) ? data : null; }
  function N(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof num === 'function') return num(v);
    var n = Number(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function vazio(v) { return v === '' || v === null || v === undefined || (typeof v === 'number' && !isFinite(v)); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function jsStr(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '); }
  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? String(e.value == null ? '' : e.value) : ''; }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function norm(v) { return txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim(); }
  function arred(v, c) { var f = Math.pow(10, c == null ? 6 : c); return Math.round((Number(v) || 0) * f) / f; }
  function fmtNum(v, casas, min) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: min == null ? 0 : min, maximumFractionDigits: casas == null ? 2 : casas }); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function agora() { return new Date().toLocaleString('pt-BR'); }
  function hojeISO() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  /* data dd/mm/aaaa[, hh:mm[:ss]] ou aaaa-mm-dd[Thh:mm] -> Date (sem hora: meia-noite) */
  function paraData(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = txt(v); if (!s) return null;
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) { var d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)); return d.getMonth() === +m[2] - 1 ? d : null; }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (m) { var e = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)); return e.getMonth() === +m[2] - 1 ? e : null; }
    return null;
  }
  function mesDe(d) { return d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) : ''; }
  function rotuloMes(k) { var m = String(k || '').match(/^(\d{4})-(\d{2})$/); return m ? MESES[+m[2] - 1] + '/' + m[1] : String(k || ''); }
  function mesMais(k, n) { var m = String(k).match(/^(\d{4})-(\d{2})$/); if (!m) return k; var d = new Date(+m[1], +m[2] - 1 + n, 1); return mesDe(d); }
  function fimDoMes(k) { var m = String(k).match(/^(\d{4})-(\d{2})$/); var d = new Date(+m[1], +m[2], 0); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function usuarioLogin() { try { var u = window.MES_CURRENT_USER || {}; return txt(u.username) || 'admin'; } catch (e) { return 'admin'; } }
  function usuarioNome() { try { var u = window.MES_CURRENT_USER || {}; return txt(u.fullName) || txt(u.username) || 'admin'; } catch (e) { return 'admin'; } }
  function admin() { var u = window.MES_CURRENT_USER; return !!(u && String(u.role || '').toUpperCase() === 'ADMIN'); }
  function salvar() { try { if (typeof saveLocal === 'function') saveLocal(); } catch (e) { console.warn('MES LION 1.7: gravação', e); } }
  function setCurrent(k) { try { current = k; } catch (e) { } }
  function marcarNav(k) {
    try {
      document.body.classList.remove('dashboard-mode');
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      var b = el('nav_' + k); if (b) b.classList.add('active');
    } catch (e) { }
  }
  function cabecalho(t, s) { if (el('title')) el('title').textContent = t; if (el('subtitle')) el('subtitle').textContent = s || ''; }
  function api14() { return window.mesApontamentoPI14 || null; }
  function apiPT() { return window.mesParadasTestesAPI || null; }
  function idNovo(p) { return p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); }

  /* ---------------------------------------------------------------------
     1) SESSÃO DE CÁLCULO (cada painel/prévia recalcula as tabelas uma vez) E ATRIBUTOS COMUNS
     --------------------------------------------------------------------- */
  var sessao = { id: 0, cache: {} };
  function novaSessao() { sessao = { id: sessao.id + 1, cache: {} }; }
  function guardado(k, fn) { if (!Object.prototype.hasOwnProperty.call(sessao.cache, k)) sessao.cache[k] = fn(); return sessao.cache[k]; }
  function qtdProducao(r) { return N(r && (r['Quantidade produzida'] || r.QuantidadeProduzida || r.Quantidade)); }
  function equipRotulo(cod, nome) { var c = txt(cod), n = txt(nome); return c && n ? c + ' — ' + n : (n || c); }
  function contexto() {
    return guardado('ctx', function () {
      var d = D() || {}, ops = {}, prod = {}, a14 = api14(), producaoOP = {}, perdasProdOP = {}, porOP = {}, porProd = {};
      A(d.op).forEach(function (o) { if (o && txt(o.CodOP)) ops[txt(o.CodOP)] = o; });
      A(d.estrutura).forEach(function (p) { if (p && txt(p['Código'])) prod[txt(p['Código'])] = p; });
      A(d.producao).forEach(function (r) { var k = txt(r && r.CodOP); if (k && ops[k]) producaoOP[k] = (producaoOP[k] || 0) + qtdProducao(r); });
      A(d.perdas).forEach(function (p) {
        var k = txt(p && (p.CodOP || p.NOPP)); if (!k || !ops[k]) return;
        if (/mat/i.test(String(p.PerdaAlvoTipo || ''))) return;
        perdasProdOP[k] = (perdasProdOP[k] || 0) + N(p.QuantidadePerdida || p.Quantidade);
      });
      function attrsProduto(cod) {
        var k = txt(cod); if (porProd[k]) return porProd[k];
        var p = prod[k] || {}, r = { Codigo: k, Descricao: txt(p['Descrição']), Tipo: txt(p['Tipo Produto']) || (/^PI/i.test(k) ? 'PI' : (/^PA/i.test(k) ? 'PA' : '')), Modelo: '', Formato: '', Quimica: '', EnergiaWh: 0, CapacidadeAh: 0 };
        var cur = p, n = 0;
        while (cur && n < 8) {
          if (!r.Modelo && txt(cur['Célula'])) r.Modelo = txt(cur['Célula']);
          if (!r.Formato && txt(cur['Modelo'])) r.Formato = txt(cur['Modelo']);
          if (!r.Quimica && txt(cur['Composição'])) r.Quimica = txt(cur['Composição']);
          if (!r.EnergiaWh && N(cur['Energia (Wh)']) > 0 && cur === p) r.EnergiaWh = N(cur['Energia (Wh)']);
          if (!r.CapacidadeAh && cur === p) r.CapacidadeAh = N(cur['Capacidade (Ah)']) || N(cur['Capacidade Final (Ah)']);
          var pai = txt(cur['Código Pai']); cur = pai && pai !== txt(cur['Código']) ? prod[pai] : null; n++;
        }
        porProd[k] = r; return r;
      }
      function raiz(o) { try { return a14 && a14.raizFamilia ? txt(a14.raizFamilia(o)) || txt(o.CodOP) : txt(o.CodOP); } catch (e) { return txt(o.CodOP); } }
      function attrsOP(cod) {
        var k = txt(cod); if (porOP[k]) return porOP[k];
        var o = ops[k];
        if (!o) { porOP[k] = { OP: k, existe: false, Familia: '', TipoOP: '', Status: '', Produto: '', Descricao: '', Modelo: '', Formato: '', Quimica: '', Projeto: '', Planejado: 0, Produzido: 0, PerdasProduto: 0, UMOP: '' }; return porOP[k]; }
        var cp = txt(o.CodigoPI || o.CodigoPA || o.CodigoProduto || o.ProdutoGerado || o.Produto), pa = attrsProduto(cp), t = String(o.TipoOP || '').toUpperCase();
        porOP[k] = { OP: k, existe: true, Familia: raiz(o), TipoOP: t === 'PA' || t === 'PI' ? t : (pa.Tipo || ''), Status: txt(o.Status), Produto: cp, Descricao: txt(o.DescricaoProduto) || pa.Descricao,
          Modelo: pa.Modelo || txt(o.IdCelula), Formato: pa.Formato, Quimica: pa.Quimica || txt(o.QuimicaFormula), Projeto: txt(o.CodProjeto || o.Projeto || o.CodigoProjeto),
          Planejado: N(o.QtdPlanejada), Produzido: producaoOP[k] || 0, PerdasProduto: perdasProdOP[k] || 0, UMOP: txt(o.UM), op: o };
        return porOP[k];
      }
      return { d: d, ops: ops, prod: prod, attrsProduto: attrsProduto, attrsOP: attrsOP, raiz: raiz, producaoOP: producaoOP };
    });
  }
  /* campos de data comuns a toda linha */
  function comData(dt, r) { r.Data = dt || null; r.Mes = mesDe(dt); r.Ano = dt ? String(dt.getFullYear()) : ''; return r; }
  function comOP(r, o) {
    r.OP = o.OP; r.Familia = o.Familia; r.TipoOP = o.TipoOP; r.Produto = r.Produto || o.Produto; r.Descricao = r.Descricao || o.Descricao;
    r.Modelo = r.Modelo || o.Modelo; r.Formato = r.Formato || o.Formato; r.Quimica = r.Quimica || o.Quimica; r.Projeto = o.Projeto; r.StatusOP = o.Status;
    return r;
  }
  function familias() {
    return guardado('familias', function () {
      var c = contexto(), vistas = {}, out = [];
      Object.keys(c.ops).forEach(function (k) { var r = c.attrsOP(k).Familia; if (r && c.ops[r] && !vistas[r]) { vistas[r] = 1; out.push(r); } });
      return out;
    });
  }
  function dataProducaoOP(cod) {
    var c = contexto(), ult = null;
    A(c.d.producao).forEach(function (r) { if (txt(r && r.CodOP) === txt(cod)) { var d = paraData(r.DataApontamento); if (d && (!ult || d > ult)) ult = d; } });
    var o = c.ops[txt(cod)] || {};
    return ult || paraData(o.DataEncerramento) || paraData(o.DataUltimoApontamento) || paraData(o.DataOP) || paraData(o.DataCriacao);
  }

  /* ---------------------------------------------------------------------
     2) TABELAS DOS MÓDULOS
     Campo: k (chave na linha), l (rótulo), t (txt, num, data, mes, ano), dim (dimensão compartilhada), u (unidade fixa),
     um (campo da linha com a unidade), unico (o valor se repete por essa chave: soma uma vez por chave), taxa (razão de
     linha: não se soma), c (caminho da ligação).
     --------------------------------------------------------------------- */
  var DIMS = {
    mes: 'Mês', ano: 'Ano', op: 'OP', familia: 'Família (OP de PA)', tipo_op: 'Tipo de OP (PA/PI)', status_op: 'Situação da OP', produto: 'Produto', modelo: 'Modelo da célula',
    formato: 'Formato da célula', quimica: 'Química', projeto: 'Projeto', processo: 'Processo', equipamento: 'Equipamento', material: 'Material'
  };
  function F(k, l, t, o) { var f = { k: k, l: l, t: t || 'txt' }; if (o) Object.keys(o).forEach(function (x) { f[x] = o[x]; }); return f; }
  var C_DATA = [F('Mes', 'Mês', 'mes', { dim: 'mes' }), F('Ano', 'Ano', 'ano', { dim: 'ano' })];
  function camposOP(via) {
    var c = via + ' → OP';
    return [F('OP', 'OP', 'txt', { dim: 'op', c: c }), F('Familia', 'Família (OP de PA)', 'txt', { dim: 'familia', c: c + ' → família (OP de PA)' }), F('TipoOP', 'Tipo de OP (PA/PI)', 'txt', { dim: 'tipo_op', c: c }),
      F('StatusOP', 'Situação da OP', 'txt', { dim: 'status_op', c: c }), F('Produto', 'Produto', 'txt', { dim: 'produto', c: c + ' → produto' }), F('Descricao', 'Descrição do produto', 'txt', { c: c + ' → produto' }),
      F('Modelo', 'Modelo da célula', 'txt', { dim: 'modelo', c: c + ' → produto → estrutura (Célula)' }), F('Formato', 'Formato da célula', 'txt', { dim: 'formato', c: c + ' → produto → estrutura (Modelo)' }),
      F('Quimica', 'Química', 'txt', { dim: 'quimica', c: c + ' → produto → estrutura (Composição)' }), F('Projeto', 'Projeto', 'txt', { dim: 'projeto', c: c })];
  }
  var TABELAS = [];
  function T(def) { TABELAS.push(def); return def; }
  function tabela(id) { var k = norm(id); return TABELAS.find(function (t) { return t.id === id || norm(t.id) === k || norm(t.nome) === k; }) || null; }
  function campo(tb, k) { var n = norm(k); return A(tb && tb.campos).find(function (f) { return f.k === k || norm(f.k) === n || norm(f.l) === n; }) || null; }

  T({ id: 'producao', nome: 'Produção', modulo: 'Apontamento de Produção', desc: 'Cada apontamento de produção (quantidade boa apontada) com a OP, o produto e a data.',
    campos: [F('Data', 'Data do apontamento', 'data')].concat(C_DATA, camposOP('Produção'), [F('Processo', 'Processo', 'txt', { dim: 'processo' }), F('Operador', 'Operador'),
      F('Quantidade', 'Quantidade produzida', 'num', { um: 'UM' }), F('UM', 'Unidade')]),
    linhas: function () {
      var c = contexto(), fora = 0;
      var rows = A(c.d.producao).filter(function (r) { if (!r) return false; if (!c.ops[txt(r.CodOP)]) { fora++; return false; } return true; }).map(function (r) {
        var o = c.attrsOP(r.CodOP), cod = txt(r.ProdutoApontado || r.Produto) || o.Produto, pa = c.attrsProduto(cod);
        return comOP(comData(paraData(r.DataApontamento), { Produto: cod, Descricao: pa.Descricao || txt(r.DescricaoProduto), Modelo: pa.Modelo, Formato: pa.Formato, Quimica: pa.Quimica,
          Processo: txt(r.Processo), Operador: txt(r.Operador), Quantidade: qtdProducao(r), UM: txt(r['Unidade de medida'] || r.Unidade) || o.UMOP }), o);
      });
      if (fora) rows.avisos = [fora + ' apontamento(s) de OPs excluídas ficam fora.'];
      return rows;
    } });

  function alvoPerda(p, cod) {
    if (!/mat/i.test(String(p.PerdaAlvoTipo || p.TipoPerda || ''))) return 'Produto';
    var pa = contexto().attrsProduto(cod);
    return pa.Tipo === 'PI' ? 'PI' : 'Material';
  }
  var ORIGEM_PERDA = { DENTRO_DO_CONSUMO: 'Dentro do consumo apontado', RETIRADA_ADICIONAL: 'Retirada adicional' };
  T({ id: 'perdas', nome: 'Perdas', modulo: 'Registro de Perdas', desc: 'Cada perda registrada: do próprio produto da OP, de material ou de PI, com motivo, quantidade e custo (a mesma regra do custo da família).',
    campos: [F('Data', 'Data da perda', 'data')].concat(C_DATA, camposOP('Perdas'), [F('Processo', 'Processo', 'txt', { dim: 'processo' }), F('Alvo', 'O que se perdeu (Produto, Material, PI)'),
      F('Item', 'Item perdido', 'txt', { dim: 'material', c: 'Perdas → item perdido (material ou PI)' }), F('ItemDescricao', 'Descrição do item perdido'), F('Motivo', 'Motivo'), F('Categoria', 'Categoria do motivo'),
      F('Origem', 'Origem da perda'), F('Quantidade', 'Quantidade perdida', 'num', { um: 'UM' }), F('UM', 'Unidade'), F('Custo', 'Custo da perda', 'num', { u: 'R$' })]),
    linhas: function () {
      var c = contexto(), fora = 0, desc = {};
      A(c.d.materiais).forEach(function (m) { if (m) desc[txt(m['CódigoMaterial'])] = txt(m.DescricaoMateriais); });
      var rows = A(c.d.perdas).filter(function (p) { if (!p) return false; if (!c.ops[txt(p.CodOP || p.NOPP)]) { fora++; return false; } return true; }).map(function (p) {
        var o = c.attrsOP(p.CodOP || p.NOPP), cod = txt(p.CodigoMaterial || p.ItemPerdaCodigo), alvo = alvoPerda(p, cod), custo = '';
        try {
          if (alvo === 'Produto') custo = typeof v102ProductLossCost === 'function' ? N((v102ProductLossCost(o.op, p) || {}).total) : '';
          else custo = typeof v102MaterialLossCost === 'function' ? N((v102MaterialLossCost(p, o.op) || {}).total) : '';
        } catch (e) { custo = ''; }
        return comOP(comData(paraData(p.DataApontamento), { Processo: txt(p.Processo), Alvo: alvo, Item: alvo === 'Produto' ? (cod || o.Produto) : cod,
          ItemDescricao: txt(p.ItemPerdaDescricao) || desc[cod] || (alvo === 'Produto' ? o.Descricao : ''), Motivo: txt(p.Motivo) || '(sem motivo)', Categoria: txt(p.TipoApontamento),
          Origem: ORIGEM_PERDA[p.OrigemPerda] || (alvo === 'Produto' ? '' : 'Não informada'), Quantidade: N(p.QuantidadePerdida || p.Quantidade),
          UM: txt(p.Unidade || p.UM) || (alvo === 'Produto' ? o.UMOP : ''), Custo: custo }), o);
      });
      if (fora) rows.avisos = [fora + ' perda(s) de OPs excluídas ficam fora.'];
      return rows;
    } });

  T({ id: 'consumos', nome: 'Consumos', modulo: 'Apontamento de Produção (consumo por lote)', desc: 'Cada consumo de material apontado por lote: quantidade, massa em kg, custo efetivo e o lote.',
    campos: [F('Data', 'Data do consumo', 'data')].concat(C_DATA, camposOP('Consumos'), [F('Material', 'Material', 'txt', { dim: 'material' }), F('MaterialDescricao', 'Descrição do material'),
      F('CategoriaMaterial', 'Categoria do material', 'txt', { c: 'Consumos → material → cadastro' }), F('Entrada', 'Entrada'), F('Lote', 'Lote'), F('Fornecedor', 'Fornecedor', 'txt', { c: 'Consumos → entrada → fornecedor' }),
      F('Quantidade', 'Quantidade consumida', 'num', { um: 'UM' }), F('UM', 'Unidade'), F('MassaKg', 'Massa consumida', 'num', { u: 'kg' }), F('Custo', 'Custo efetivo', 'num', { u: 'R$' }),
      F('AcimaDoSaldo', 'Acima do saldo do lote')]),
    linhas: function () {
      var c = contexto(), fora = 0, mats = {}, ents = {};
      A(c.d.materiais).forEach(function (m) { if (m) mats[txt(m['CódigoMaterial'])] = m; });
      A(c.d.entradas).forEach(function (e) { if (e) ents[txt(e.Entrada)] = e; });
      var rows = A(c.d.consumos_materiais).filter(function (x) { if (!x) return false; if (!c.ops[txt(x.CodOP)]) { fora++; return false; } return true; }).map(function (x) {
        var o = c.attrsOP(x.CodOP), cod = txt(x.CodigoMaterial), m = mats[cod] || {}, e = ents[txt(x.Entrada)] || {};
        var q = (x.ConsumoLiquido !== undefined && x.ConsumoLiquido !== null && String(x.ConsumoLiquido) !== '') ? N(x.ConsumoLiquido) : N(x.QtdRetirada) - N(x.QtdDevolvida), um = txt(x.UM) || txt(m.UM);
        var kg = ''; try { if (typeof converterQtdMaterialParaKgV35 === 'function') { var k2 = N(converterQtdMaterialParaKgV35(q, cod, um)); kg = k2 > 0 || q === 0 ? k2 : ''; } } catch (er) { kg = ''; }
        return comOP(comData(paraData(x.DataApontamento), { Material: cod, MaterialDescricao: txt(x.DescricaoMaterial) || txt(m.DescricaoMateriais), CategoriaMaterial: txt(m.Categoria),
          Entrada: txt(x.Entrada), Lote: txt(x.Lote) || txt(e.Lote), Fornecedor: txt(e.NomeFornecedor || e.RazaoSocial), Quantidade: q, UM: um, MassaKg: kg,
          Custo: N(x.CustoEfetivo) || q * N(x.CustoUnitarioLote), AcimaDoSaldo: x.AcimaDoSaldo === 'Sim' ? 'Sim' : 'Não' }), o);
      });
      if (fora) rows.avisos = [fora + ' consumo(s) de OPs excluídas ficam fora (a mesma regra do estoque e do custo).'];
      return rows;
    } });

  /* etapas: a mesma auditoria do custo (v4033AuditCostPI: só as etapas da OP, com o tempo apontado ou o planejado) */
  function etapaOP(cod, e) {
    return A((D() || {}).op_etapas).find(function (x) {
      return x && txt(x.CodOP) === txt(cod) && ((txt(e.IdRecursoRoteiro) && txt(x.IdRecursoRoteiro) === txt(e.IdRecursoRoteiro)) || (!txt(e.IdRecursoRoteiro) && txt(x.Ordem) === txt(e.Ordem) && txt(x.Processo) === txt(e.Processo)));
    }) || null;
  }
  function temposFinalizados() {
    return guardado('tempos_fin', function () {
      var a = api14(), out = [];
      A((D() || {}).apontamento_tempos).forEach(function (t) {
        if (!t || t.Status !== 'Finalizado') return;
        var dur = 0; try { dur = a && a.duracaoMin ? N(a.duracaoMin(t)) : 0; } catch (e) { dur = 0; }
        var ini = paraData(txt(t.DataApontamento) + ' ' + txt(t.HoraInicio)), fim = ini ? new Date(ini.getTime() + dur * 60000) : null;
        out.push({ t: t, ini: ini, fim: fim, dur: dur });
      });
      return out;
    });
  }
  function dataEtapa(cod, e2) {
    var id = txt(e2 && e2.IdRecursoRoteiro), ult = null;
    temposFinalizados().forEach(function (x) { if (txt(x.t.CodOP) === txt(cod) && (!id || txt(x.t.IdRecursoRoteiro) === id) && x.fim && (!ult || x.fim > ult)) ult = x.fim; });
    if (ult) return ult;
    A((D() || {}).pcp_historico).forEach(function (h) { if (h && txt(h.OP) === txt(cod) && (!id || txt(h.IdRecursoRoteiro) === id)) { var f = paraData(h.Fim); if (f && (!ult || f > ult)) ult = f; } });
    return ult || dataProducaoOP(cod);
  }
  T({ id: 'etapas', nome: 'Etapas', modulo: 'OPs (auditoria de custo)', desc: 'Cada etapa/máquina de cada OP: tempo planejado e real, energia e mão de obra — a mesma conta do custo da família. Quantidades da OP repetidas em cada etapa contam uma vez por OP.',
    campos: [F('Data', 'Data da etapa (execução)', 'data')].concat(C_DATA, camposOP('Etapas'), [F('Ordem', 'Ordem da etapa'), F('Processo', 'Processo', 'txt', { dim: 'processo' }),
      F('Equipamento', 'Equipamento', 'txt', { dim: 'equipamento', c: 'Etapas → recurso do roteiro' }), F('TempoPlanejado', 'Tempo planejado', 'num', { u: 'min' }), F('TempoReal', 'Tempo real apontado', 'num', { u: 'min' }),
      F('TempoUsado', 'Tempo usado no custo', 'num', { u: 'min' }), F('OrigemTempo', 'Origem do tempo'), F('Pessoas', 'Pessoas', 'num', { u: 'pessoas', taxa: true }), F('PotenciaW', 'Potência', 'num', { u: 'W', taxa: true }),
      F('EnergiaKWh', 'Energia', 'num', { u: 'kWh' }), F('CustoEnergia', 'Custo de energia', 'num', { u: 'R$' }), F('CustoMOD', 'Custo de mão de obra', 'num', { u: 'R$' }),
      F('PlanejadoOP', 'Quantidade planejada da OP', 'num', { um: 'UMOP', unico: 'OP' }), F('ProduzidoOP', 'Quantidade produzida da OP', 'num', { um: 'UMOP', unico: 'OP' }), F('UMOP', 'Unidade da OP')]),
    linhas: function () {
      var c = contexto(), rows = [];
      Object.keys(c.ops).forEach(function (cod) {
        var a = null; try { a = typeof v4033AuditCostPI === 'function' ? v4033AuditCostPI(cod) : null; } catch (e) { a = null; }
        var o = c.attrsOP(cod);
        A(a && a.etapas).forEach(function (e) {
          if (txt(e.OP) !== cod) return;
          var e2 = etapaOP(cod, e) || {}, real = N(e2.TempoReal);
          rows.push(comOP(comData(dataEtapa(cod, e2), { Ordem: txt(e.Ordem), Processo: txt(e.Processo), Equipamento: equipRotulo(e2.CodEquipamento, e.Equipamento || e2.Equipamento || e2.Recurso),
            TempoPlanejado: N(e2.TempoPlanejado || e2.TempoOperacaoMin), TempoReal: real > 0 ? real : '', TempoUsado: N(e.TempoMin), OrigemTempo: real > 0 ? 'Apontado' : 'Planejado',
            Pessoas: N(e.Pessoas), PotenciaW: N(e.PotenciaW), EnergiaKWh: N(e.EnergiaKWh), CustoEnergia: N(e.CustoEnergia), CustoMOD: N(e.CustoMOD),
            PlanejadoOP: o.Planejado, ProduzidoOP: o.Produzido, UMOP: o.UMOP }), o));
        });
      });
      return rows;
    } });

  /* tempos e paradas: a parada dentro do intervalo apontado sai do tempo em operação */
  function chaveEq(cod, nome) { var a = apiPT(); return a ? a.chaveEquip(cod, nome) : txt(cod) + '|' + norm(nome); }
  function paradasInfo() {
    return guardado('paradas_info', function () {
      var a = apiPT(), out = [];
      A((D() || {}).paradas).forEach(function (p) {
        if (!p) return;
        var ini = a ? a.inicioParada(p) : null, fim = a ? a.fimParada(p) : null;
        out.push({ p: p, k: chaveEq(p.CodEquipamento, p.Equipamento), ini: ini, fim: fim || (p.Status === 'Aberta' ? new Date() : null), aberta: p.Status === 'Aberta' });
      });
      return out;
    });
  }
  function sobreposicaoMin(ini, fim, k) {
    var s = 0;
    paradasInfo().forEach(function (x) { if (x.k !== k || !x.ini || !x.fim || !ini || !fim) return; var a = Math.max(ini, x.ini), b = Math.min(fim, x.fim); if (b > a) s += (b - a) / 60000; });
    return arred(s, 2);
  }
  T({ id: 'tempos', nome: 'Tempos de máquina', modulo: 'Apontamento de tempo por máquina', desc: 'Cada intervalo finalizado no apontamento de tempo por máquina; a parada dentro do intervalo sai do tempo em operação.',
    campos: [F('Data', 'Data de início', 'data')].concat(C_DATA, camposOP('Tempos'), [F('Processo', 'Processo', 'txt', { dim: 'processo' }), F('Equipamento', 'Equipamento', 'txt', { dim: 'equipamento' }),
      F('Operador', 'Operador'), F('DuracaoMin', 'Duração apontada', 'num', { u: 'min' }), F('ParadaDentroMin', 'Paradas dentro do intervalo', 'num', { u: 'min' }), F('OperacaoMin', 'Tempo em operação', 'num', { u: 'min' })]),
    linhas: function () {
      var c = contexto();
      return temposFinalizados().filter(function (x) { return c.ops[txt(x.t.CodOP)]; }).map(function (x) {
        var t = x.t, o = c.attrsOP(t.CodOP), k = chaveEq(t.CodEquipamento, t.Equipamento), dentro = sobreposicaoMin(x.ini, x.fim, k);
        return comOP(comData(x.ini, { Processo: txt(t.Processo), Equipamento: equipRotulo(t.CodEquipamento, t.Equipamento), Operador: txt(t.Operador),
          DuracaoMin: x.dur, ParadaDentroMin: dentro, OperacaoMin: Math.max(0, arred(x.dur - dentro, 2)) }), o);
      });
    } });

  T({ id: 'paradas', nome: 'Paradas', modulo: 'Paradas de máquina', desc: 'Cada parada de máquina: motivo, se é planejada e a duração (parada aberta fica sem duração até ser encerrada).',
    campos: [F('Data', 'Início da parada', 'data')].concat(C_DATA, camposOP('Paradas'), [F('Processo', 'Processo', 'txt', { dim: 'processo' }), F('Equipamento', 'Equipamento', 'txt', { dim: 'equipamento' }),
      F('Categoria', 'Categoria da parada'), F('Motivo', 'Motivo da parada'), F('Planejada', 'Planejada (Sim/Não)'), F('Situacao', 'Situação (Aberta/Encerrada)'), F('DuracaoMin', 'Duração', 'num', { u: 'min' })]),
    linhas: function () {
      var c = contexto();
      return paradasInfo().map(function (x) {
        var p = x.p, o = txt(p.CodOP) ? c.attrsOP(p.CodOP) : null, r = comData(x.ini, { Processo: txt(p.Processo), Equipamento: equipRotulo(p.CodEquipamento, p.Equipamento), Categoria: txt(p.Categoria),
          Motivo: txt(p.Motivo), Planejada: p.Planejada === 'Sim' ? 'Sim' : 'Não', Situacao: x.aberta ? 'Aberta' : 'Encerrada', DuracaoMin: x.aberta ? '' : N(p.DuracaoMin) });
        if (o) comOP(r, o); else { r.OP = ''; r.Familia = ''; r.TipoOP = ''; r.StatusOP = ''; r.Produto = ''; r.Descricao = ''; r.Modelo = ''; r.Formato = ''; r.Quimica = ''; r.Projeto = ''; }
        return r;
      });
    } });

  /* OEE por OP e máquina: tempo em operação (apontado − paradas dentro), paradas não planejadas e planejadas, tempo padrão
     do roteiro proporcional ao produzido (bom + perdido) e ao bom. Sem tempo apontado a linha não entra em Disponibilidade
     nem Performance (fica como "sem tempo apontado"); sem tempo padrão não entra em Performance nem Qualidade. */
  T({ id: 'oee', nome: 'OEE', modulo: 'Apontamento de tempo + Paradas + Produção + Perdas', desc: 'Uma linha por OP e máquina (e uma por parada sem OP): tempo em operação, paradas, tempo planejado e tempo padrão do produzido e das boas. Base do OEE = Disponibilidade × Performance × Qualidade.',
    campos: [F('Data', 'Data', 'data')].concat(C_DATA, camposOP('OEE'), [F('Processo', 'Processo', 'txt', { dim: 'processo' }), F('Equipamento', 'Equipamento', 'txt', { dim: 'equipamento' }),
      F('ComTempo', 'Com tempo apontado (Sim/Não)'), F('ComPadrao', 'Com tempo padrão (Sim/Não)'), F('TempoOperacao', 'Tempo em operação', 'num', { u: 'min' }),
      F('ParadaNaoPlanejada', 'Paradas não planejadas', 'num', { u: 'min' }), F('ParadaPlanejada', 'Paradas planejadas', 'num', { u: 'min' }), F('TempoPlanejado', 'Tempo planejado (operação + paradas não planejadas)', 'num', { u: 'min' }),
      F('TempoPadraoProduzido', 'Tempo padrão do produzido (bom + perdido)', 'num', { u: 'min' }), F('TempoPadraoBoas', 'Tempo padrão das boas', 'num', { u: 'min' }),
      F('Boas', 'Quantidade boa da OP', 'num', { um: 'UMOP', unico: 'OP' }), F('PerdasProduto', 'Perdas do produto da OP', 'num', { um: 'UMOP', unico: 'OP' }), F('UMOP', 'Unidade da OP')]),
    linhas: function () {
      var c = contexto(), a = api14(), rows = [], usadas = {};
      Object.keys(c.ops).forEach(function (cod) {
        var o = c.attrsOP(cod), maqs = []; try { maqs = a && a.maquinasDaOP ? A(a.maquinasDaOP(o.op)) : []; } catch (e) { maqs = []; }
        maqs.forEach(function (m) {
          var k = chaveEq(m.CodEquipamento, m.Equipamento), run = 0, prim = null;
          temposFinalizados().forEach(function (x) {
            var t = x.t; if (txt(t.CodOP) !== cod) return;
            var kt = txt(t.IdRecursoRoteiro) || ((txt(t.CodEquipamento) || txt(t.OrdemEtapa)) ? txt(t.OrdemEtapa) + '|' + txt(t.CodEquipamento) : '');
            if (kt !== m.chave && !(m.IdRecursoRoteiro && txt(t.IdRecursoRoteiro) === m.IdRecursoRoteiro)) return;
            run += Math.max(0, x.dur - sobreposicaoMin(x.ini, x.fim, k)); if (x.ini && (!prim || x.ini < prim)) prim = x.ini;
          });
          var np = 0, pl = 0;
          paradasInfo().forEach(function (x) {
            if (x.aberta || x.k !== k || txt(x.p.CodOP) !== cod) return;
            usadas[x.p.IdParada] = 1;
            if (x.p.Planejada === 'Sim') pl += N(x.p.DuracaoMin); else np += N(x.p.DuracaoMin);
            if (x.ini && (!prim || x.ini < prim)) prim = x.ini;
          });
          var std = N(m.etapa && (m.etapa.TempoPlanejado || m.etapa.TempoOperacaoMin)), comT = run > 0, comP = std > 0 && o.Planejado > 0;
          rows.push(comOP(comData(prim || dataEtapa(cod, m.etapa), { Processo: txt(m.Processo), Equipamento: equipRotulo(m.CodEquipamento, m.Equipamento), ComTempo: comT ? 'Sim' : 'Não', ComPadrao: comP ? 'Sim' : 'Não',
            TempoOperacao: comT ? arred(run, 2) : '', ParadaNaoPlanejada: arred(np, 2), ParadaPlanejada: arred(pl, 2), TempoPlanejado: (comT || np > 0) ? arred((comT ? run : 0) + np, 2) : '',
            TempoPadraoProduzido: comT && comP ? arred(std * (o.Produzido + o.PerdasProduto) / o.Planejado, 4) : '', TempoPadraoBoas: comT && comP ? arred(std * o.Produzido / o.Planejado, 4) : '',
            Boas: o.Produzido, PerdasProduto: o.PerdasProduto, UMOP: o.UMOP }), o));
        });
      });
      /* paradas sem OP (ou numa máquina fora das etapas da OP): só tempo parado */
      paradasInfo().forEach(function (x) {
        if (x.aberta || usadas[x.p.IdParada]) return;
        var p = x.p, o = txt(p.CodOP) ? c.attrsOP(p.CodOP) : null, r = comData(x.ini, { Processo: txt(p.Processo), Equipamento: equipRotulo(p.CodEquipamento, p.Equipamento), ComTempo: 'Não', ComPadrao: 'Não',
          TempoOperacao: '', ParadaNaoPlanejada: p.Planejada === 'Sim' ? 0 : N(p.DuracaoMin), ParadaPlanejada: p.Planejada === 'Sim' ? N(p.DuracaoMin) : 0,
          TempoPlanejado: p.Planejada === 'Sim' ? '' : N(p.DuracaoMin), TempoPadraoProduzido: '', TempoPadraoBoas: '', Boas: '', PerdasProduto: '', UMOP: '' });
        if (o && o.existe) comOP(r, o); else { r.OP = ''; r.Familia = ''; r.TipoOP = ''; r.StatusOP = ''; r.Produto = ''; r.Descricao = ''; r.Modelo = ''; r.Formato = ''; r.Quimica = ''; r.Projeto = ''; }
        rows.push(r);
      });
      return rows;
    } });

  function camposFamilia(via) {
    var c = via + ' → família (OP de PA)';
    return [F('Familia', 'Família (OP de PA)', 'txt', { dim: 'familia', c: c }), F('StatusOP', 'Situação da OP de PA', 'txt', { dim: 'status_op', c: c }), F('Produto', 'Produto (PA)', 'txt', { dim: 'produto', c: c + ' → produto' }),
      F('Descricao', 'Descrição do produto'), F('Modelo', 'Modelo da célula', 'txt', { dim: 'modelo', c: c + ' → produto → estrutura (Célula)' }), F('Formato', 'Formato da célula', 'txt', { dim: 'formato', c: c + ' → produto → estrutura (Modelo)' }),
      F('Quimica', 'Química', 'txt', { dim: 'quimica', c: c + ' → produto → estrutura (Composição)' }), F('Projeto', 'Projeto', 'txt', { dim: 'projeto', c: c }),
      F('Produzida', 'Produzida (Sim/Não)'), F('Unidades', 'Unidades produzidas', 'num', { um: 'UM' }), F('UM', 'Unidade')];
  }
  function linhaFamilia(raiz) {
    var c = contexto(), o = c.attrsOP(raiz), prod = c.producaoOP[raiz] || 0;
    return comData(dataProducaoOP(raiz), { Familia: raiz, StatusOP: o.Status, Produto: o.Produto, Descricao: o.Descricao, Modelo: o.Modelo, Formato: o.Formato, Quimica: o.Quimica, Projeto: o.Projeto,
      Produzida: prod > 0 ? 'Sim' : 'Não', Unidades: prod > 0 ? prod : '', UM: o.UMOP || 'un' });
  }
  function custoFamilia(raiz) {
    return guardado('custo_' + raiz, function () {
      try { if (typeof v4033CostScope === 'function') return v4033CostScope(raiz, false).row || {}; if (typeof calcCustoFamiliaOPV33 === 'function') return calcCustoFamiliaOPV33(raiz, false, {}) || {}; } catch (e) { }
      return {};
    });
  }
  T({ id: 'custos', nome: 'Custos', modulo: 'Custos (família de OPs)', desc: 'Uma linha por família (OP de PA + OPs de PI): materiais, energia, mão de obra e perdas — o mesmo cálculo do módulo Custos, sem depreciação. Unidades = produzidas na OP de PA.',
    campos: [F('Data', 'Data da produção do PA', 'data')].concat(C_DATA, camposFamilia('Custos'), [F('Materiais', 'Materiais', 'num', { u: 'R$' }), F('Energia', 'Energia', 'num', { u: 'R$' }),
      F('MOD', 'Mão de obra', 'num', { u: 'R$' }), F('Perdas', 'Perdas', 'num', { u: 'R$' }), F('Total', 'Custo total', 'num', { u: 'R$' }), F('EnergiaKWh', 'Energia', 'num', { u: 'kWh' }),
      F('CustoUnitario', 'Custo unitário (da linha)', 'num', { u: 'R$/un', taxa: true })]),
    linhas: function () {
      return familias().map(function (r) {
        var x = custoFamilia(r), l = linhaFamilia(r);
        l.Materiais = N(x.CustoMateriais); l.Energia = N(x.CustoEnergia); l.MOD = N(x.CustoMOD); l.Perdas = N(x.CustoPerdas); l.Total = N(x.CustoTotal); l.EnergiaKWh = N(x.EnergiaKWh);
        l.CustoUnitario = l.Unidades ? l.Total / l.Unidades : '';
        return l;
      });
    } });
  function sustFamilia(raiz) { return guardado('sust_' + raiz, function () { try { return typeof calcSustFamiliaOPV33 === 'function' ? calcSustFamiliaOPV33(raiz, false, {}) || {} : {}; } catch (e) { return {}; } }); }
  T({ id: 'co2', nome: 'CO₂', modulo: 'Sustentabilidade / ACV (família de OPs)', desc: 'Uma linha por família: CO₂eq de materiais, perdas e energia e os kWh — o mesmo cálculo da tela Sustentabilidade / ACV.',
    campos: [F('Data', 'Data da produção do PA', 'data')].concat(C_DATA, camposFamilia('CO₂'), [F('CO2Total', 'CO₂eq total', 'num', { u: 'kg CO₂eq' }), F('CO2Materiais', 'CO₂eq dos materiais', 'num', { u: 'kg CO₂eq' }),
      F('CO2Perdas', 'CO₂eq das perdas', 'num', { u: 'kg CO₂eq' }), F('CO2Energia', 'CO₂eq da energia', 'num', { u: 'kg CO₂eq' }), F('EnergiaKWh', 'Energia', 'num', { u: 'kWh' }), F('MassaKg', 'Massa de materiais', 'num', { u: 'kg' })]),
    linhas: function () {
      return familias().map(function (r) {
        var s = sustFamilia(r), l = linhaFamilia(r);
        l.CO2Total = N(s.CO2eqTotal); l.CO2Materiais = N(s.CO2eqProduto || s.CO2eqMateriais); l.CO2Perdas = N(s.CO2eqPerdas); l.CO2Energia = N(s.CO2eqEnergia); l.EnergiaKWh = N(s.EnergiaKWh); l.MassaKg = N(s.MassaMateriaisKg);
        return l;
      });
    } });
  T({ id: 'energia', nome: 'Energia das células', modulo: 'Custos + Testes das células', desc: 'Uma linha por família COM PRODUÇÃO: energia consumida na produção (kWh da auditoria das etapas) e energia MEDIDA nos testes das células produzidas (sem teste = vazio, nunca a de projeto). A energia de projeto fica à parte, só para referência.',
    campos: [F('Data', 'Data da produção do PA', 'data')].concat(C_DATA, camposFamilia('Energia'), [F('CelulasProduzidas', 'Células produzidas', 'num', { u: 'un' }), F('CelulasTestadas', 'Células com energia medida', 'num', { u: 'un' }),
      F('ConsumidaKWh', 'Energia consumida na produção', 'num', { u: 'kWh' }), F('MedidaKWh', 'Energia medida das células (gerada)', 'num', { u: 'kWh' }), F('ProjetoKWh', 'Energia de projeto das células (referência)', 'num', { u: 'kWh' })]),
    linhas: function () {
      var c = contexto(), a = apiPT(), rows = [];
      familias().forEach(function (r) {
        var l = linhaFamilia(r); if (l.Produzida !== 'Sim') return;
        var x = custoFamilia(r), o = c.attrsOP(r), testadas = 0, wh = 0;
        if (a && o.op) A(a.celulasDaOP(o.op)).forEach(function (cel) { if (cel.fora) return; var m = a.medidoDaCelula(r, cel.IdCelula); if (m.energia != null) { testadas++; wh += m.energia; } });
        var pa = c.attrsProduto(o.Produto);
        l.CelulasProduzidas = N(l.Unidades); l.CelulasTestadas = testadas; l.ConsumidaKWh = N(x.EnergiaKWh); l.MedidaKWh = testadas ? arred(wh / 1000, 6) : '';
        l.ProjetoKWh = pa.EnergiaWh > 0 ? arred(N(l.Unidades) * pa.EnergiaWh / 1000, 6) : '';
        rows.push(l);
      });
      return rows;
    } });
  T({ id: 'testes', nome: 'Testes das células', modulo: 'Testes das células', desc: 'Uma linha por célula testada: a energia e a capacidade MEDIDAS no teste mais recente e as nominais da estrutura.',
    campos: [F('Data', 'Data do teste', 'data')].concat(C_DATA, camposOP('Testes'), [F('Celula', 'Célula (etiqueta)'), F('TipoTeste', 'Tipo do teste'), F('Testes', 'Testes da célula', 'num', { u: 'testes' }),
      F('EnergiaMedidaWh', 'Energia medida', 'num', { u: 'Wh' }), F('CapacidadeMedidaAh', 'Capacidade medida', 'num', { u: 'Ah' }), F('EnergiaNominalWh', 'Energia nominal', 'num', { u: 'Wh' }), F('CapacidadeNominalAh', 'Capacidade nominal', 'num', { u: 'Ah' })]),
    linhas: function () {
      var c = contexto(), a = apiPT(), vistos = {}, rows = [];
      if (!a) return rows;
      A(a.testes()).forEach(function (t) {
        var k = txt(t.CodOP) + '|' + t.IdCelula; if (vistos[k] || !c.ops[txt(t.CodOP)]) return; vistos[k] = 1;
        var m = a.medidoDaCelula(t.CodOP, t.IdCelula), o = c.attrsOP(t.CodOP), pa = c.attrsProduto(o.Produto), ref = m.testeE || m.testeC || t;
        rows.push(comOP(comData(paraData(ref.Data), { Celula: t.IdCelula, TipoTeste: txt(ref.TipoTeste), Testes: m.n, EnergiaMedidaWh: m.energia != null ? m.energia : '', CapacidadeMedidaAh: m.capacidade != null ? m.capacidade : '',
          EnergiaNominalWh: pa.EnergiaWh || '', CapacidadeNominalAh: pa.CapacidadeAh || '' }), o));
      });
      return rows;
    } });
  T({ id: 'lotes', nome: 'Lotes de materiais', modulo: 'Estoque / Rastreabilidade', desc: 'Cada entrada/lote com o saldo físico do Estoque (na unidade da entrada) e o valor do saldo.',
    campos: [F('Data', 'Data da entrada', 'data')].concat(C_DATA, [F('Material', 'Material', 'txt', { dim: 'material' }), F('MaterialDescricao', 'Descrição do material'), F('Entrada', 'Entrada'), F('Lote', 'Lote'),
      F('Fornecedor', 'Fornecedor'), F('Projeto', 'Projeto', 'txt', { dim: 'projeto' }), F('Situacao', 'Situação do saldo'), F('QtdEntrada', 'Quantidade da entrada', 'num', { um: 'UM' }),
      F('Consumido', 'Consumido nas OPs', 'num', { um: 'UM' }), F('Perdas', 'Perdas do lote', 'num', { um: 'UM' }), F('Saldo', 'Saldo físico', 'num', { um: 'UM' }), F('UM', 'Unidade'),
      F('ValorSaldo', 'Valor do saldo', 'num', { u: 'R$' })]),
    linhas: function () {
      var ls = typeof window.mesLinhasEstoque === 'function' ? A(window.mesLinhasEstoque()) : [];
      return ls.map(function (r) {
        return comData(paraData(r.DataCadastro), { Material: txt(r.CodigoMaterial), MaterialDescricao: txt(r.Material), Entrada: txt(r.Entrada), Lote: txt(r.Lote), Fornecedor: txt(r.Fornecedor),
          Projeto: txt(r.CodigoProjeto || r.Projeto), Situacao: txt(r.StatusSaldo), QtdEntrada: N(r.QtdEntrada), Consumido: N(r.ConsumoOP), Perdas: N(r.PerdasLote), Saldo: N(r.Saldo), UM: txt(r.UM),
          ValorSaldo: arred(N(r.Saldo) * N(r.CustoUnitario), 6) });
      });
    } });
  /* capacidade por máquina e mês: horas do calendário (Capacidade e Carga) e horas apontadas */
  function mesesCapacidade() {
    var hoje = mesDe(new Date()), ini = mesMais(hoje, -11), fim = mesMais(hoje, 2), min = ini;
    A((D() || {}).op).forEach(function (o) { var d = paraData(o && (o.DataOP || o.DataCriacao)); var m = mesDe(d); if (m && m < min) min = m; });
    if (min < mesMais(hoje, -35)) min = mesMais(hoje, -35);
    var out = [], m = min;
    while (m <= fim && out.length < 48) { out.push(m); m = mesMais(m, 1); }
    return out;
  }
  T({ id: 'capacidade', nome: 'Capacidade', modulo: 'PCP › Capacidade e Carga', desc: 'Uma linha por máquina e mês: horas disponíveis do calendário de capacidade, horas programadas (carga), horas em operação apontadas e a capacidade em unidades (capacidade por hora do cadastro × horas disponíveis).',
    campos: [F('Data', 'Mês (primeiro dia)', 'data')].concat(C_DATA, [F('Equipamento', 'Equipamento', 'txt', { dim: 'equipamento' }), F('Escala', 'Escala'), F('Configurado', 'Capacidade cadastrada (Sim/Não)'),
      F('HorasNominais', 'Horas nominais', 'num', { u: 'h' }), F('HorasDisponiveis', 'Horas disponíveis (capacidade instalada)', 'num', { u: 'h' }), F('HorasProgramadas', 'Horas programadas (carga)', 'num', { u: 'h' }),
      F('HorasApontadas', 'Horas em operação apontadas', 'num', { u: 'h' }), F('CapacidadePorHora', 'Capacidade por hora (cadastro)', 'num', { um: 'UMCapacidadeHora', taxa: true }),
      F('UMCapacidadeHora', 'Unidade da capacidade por hora'), F('CapacidadeInstaladaQtd', 'Capacidade instalada em unidades', 'num', { um: 'UMCapacidade' }), F('UMCapacidade', 'Unidade da capacidade')]),
    linhas: function () {
      if (typeof window.mesCapRelatorioDados !== 'function') return [];
      var cad = {}, rows = [];
      A((D() || {}).cad_recursos).forEach(function (r) { if (r && txt(r['Código Equipamento']) && N(r.Capacidade) > 0) cad[txt(r['Código Equipamento'])] = { cap: N(r.Capacidade), um: txt(r['Unidade Capacidade']) }; });
      var horasApont = {};
      A(TABELA_LINHAS('tempos')).forEach(function (t) { var k = t.Mes + '|' + t.Equipamento; horasApont[k] = (horasApont[k] || 0) + N(t.OperacaoMin) / 60; });
      mesesCapacidade().forEach(function (m) {
        var lst = []; try { lst = A(window.mesCapRelatorioDados(m + '-01', fimDoMes(m))); } catch (e) { lst = []; }
        lst.forEach(function (x) {
          var eq = equipRotulo(x.Codigo, x.Equipamento), cp = cad[txt(x.Codigo)], umH = cp ? cp.um : '', umQ = umH.replace(/\s*\/\s*h(ora)?$/i, '');
          rows.push(comData(paraData(m + '-01'), { Equipamento: eq, Escala: txt(x.Escala), Configurado: x.Configurado ? 'Sim' : 'Não', HorasNominais: x.Configurado ? N(x.HorasNominais) : '',
            HorasDisponiveis: x.Configurado ? N(x.HorasEfetivas) : '', HorasProgramadas: N(x.Carga), HorasApontadas: arred(horasApont[m + '|' + eq] || 0, 4),
            CapacidadePorHora: cp ? cp.cap : '', UMCapacidadeHora: umH, CapacidadeInstaladaQtd: cp && x.Configurado && umQ !== umH ? arred(cp.cap * N(x.HorasEfetivas), 4) : '', UMCapacidade: umQ !== umH ? umQ : '' }));
        });
      });
      return rows;
    } });
  T({ id: 'ops', nome: 'OPs', modulo: 'Ordens de Produção', desc: 'Uma linha por OP: situação, planejado, produzido, perdas do produto e tempo até o encerramento.',
    campos: [F('Data', 'Data da OP', 'data')].concat(C_DATA, camposOP('OPs'), [F('Encerrada', 'Encerrada (Sim/Não)'), F('Planejado', 'Quantidade planejada', 'num', { um: 'UM' }),
      F('Produzido', 'Quantidade produzida', 'num', { um: 'UM' }), F('PerdasProduto', 'Perdas do produto', 'num', { um: 'UM' }), F('UM', 'Unidade'), F('DataEncerramento', 'Data de encerramento', 'data'),
      F('LeadTimeDias', 'Dias da abertura ao encerramento', 'num', { u: 'dias', taxa: true })]),
    linhas: function () {
      var c = contexto();
      return Object.keys(c.ops).map(function (k) {
        var o = c.attrsOP(k), op = o.op, d0 = paraData(op.DataOP || op.DataCriacao), d1 = paraData(op.DataEncerramento), enc = /conclu|encerr|finaliz/i.test(o.Status) || !!d1;
        return comOP(comData(d0, { Encerrada: enc ? 'Sim' : 'Não', Planejado: o.Planejado, Produzido: o.Produzido, PerdasProduto: o.PerdasProduto, UM: o.UMOP, DataEncerramento: d1,
          LeadTimeDias: d0 && d1 ? arred((d1 - d0) / 86400000, 2) : '' }), o);
      });
    } });
  function TABELA_LINHAS(id) {
    return guardado('linhas_' + id, function () {
      var tb = tabela(id); if (!tb) return [];
      return protegido(function () {
        try { return tb.linhas() || []; } catch (e) { console.warn('MES LION 1.7: tabela ' + id, e); var r = []; r.avisos = ['Erro ao montar a tabela: ' + (e && e.message || e)]; return r; }
      });
    });
  }
  /* as funções dos módulos às vezes regravam campos ao calcular (o custo da OP refaz o consumo das linhas da OP, por
     exemplo). Nos painéis o cálculo é o mesmo, mas nada fica: não grava no servidor e, ao terminar, devolve cada
     coleção exatamente como estava (no mesmo objeto). Um painel inteiro monta as tabelas numa proteção só. */
  var protecao = 0;
  function restaurarDados(d, antes, pulados) {
    Object.keys(d).forEach(function (k) { if (!(k in antes) && !pulados[k]) delete d[k]; });
    Object.keys(antes).forEach(function (k) {
      var atualTxt;
      try { atualTxt = JSON.stringify(d[k]); } catch (e) { return; }
      if (atualTxt === antes[k]) return;
      var orig = antes[k] === undefined ? undefined : JSON.parse(antes[k]), atual = d[k];
      function igualar(x, o) { Object.keys(x).forEach(function (c) { if (!(c in o)) delete x[c]; }); Object.assign(x, o); }
      if (Array.isArray(atual) && Array.isArray(orig) && atual.length === orig.length) {
        atual.forEach(function (x, i) { var o = orig[i]; if (x && o && typeof x === 'object' && typeof o === 'object' && !Array.isArray(x) && !Array.isArray(o)) igualar(x, o); else atual[i] = o; });
      } else if (Array.isArray(atual) && Array.isArray(orig)) { atual.length = 0; Array.prototype.push.apply(atual, orig); }
      else if (atual && orig && typeof atual === 'object' && typeof orig === 'object' && !Array.isArray(atual) && !Array.isArray(orig)) igualar(atual, orig);
      else d[k] = orig;
    });
  }
  function protegido(fn) {
    if (protecao > 0) return fn();
    var ant = window.saveLocal, d = D(), antes = null, pulados = {};
    if (d) {
      antes = {};
      Object.keys(d).forEach(function (k) { var v = d[k]; if (Array.isArray(v) && v.length > 5000) { pulados[k] = 1; return; } try { antes[k] = JSON.stringify(v); } catch (e) { pulados[k] = 1; } });
    }
    protecao++; window.saveLocal = function () { };
    try { return fn(); }
    finally {
      protecao--; window.saveLocal = ant;
      if (d && antes) { try { restaurarDados(d, antes, pulados); } catch (e) { console.warn('MES LION 1.7: restauração dos dados depois do painel', e); } }
    }
  }
  /* monta (numa proteção só) as tabelas que ainda não estão na sessão */
  function montarTabelas(ids) {
    var faltam = A(ids).filter(function (id) { return tabela(id) && !Object.prototype.hasOwnProperty.call(sessao.cache, 'linhas_' + id); });
    if (faltam.length) protegido(function () { faltam.forEach(TABELA_LINHAS); });
  }

  /* ---------------------------------------------------------------------
     3) LINGUAGEM DE FÓRMULAS (interpretador próprio: só lê os dados)
     Tabela[Campo] = campo de uma tabela (nome da tabela com espaço vai entre aspas simples: 'Tempos de máquina'[OperacaoMin]);
     [Indicador] = outro indicador; argumentos separados por ";" e decimais com vírgula ou ponto.
     --------------------------------------------------------------------- */
  var FUNCOES = {
    'soma': { agg: true, rot: 'SOMA' }, 'media': { agg: true, rot: 'MÉDIA' }, 'min': { agg: true, rot: 'MÍN' }, 'max': { agg: true, rot: 'MÁX' },
    'contar': { agg: true, rot: 'CONTAR' }, 'contar.distinto': { agg: true, rot: 'CONTAR.DISTINTO' },
    'dividir': { n: [2, 3], rot: 'DIVIDIR' }, 'se': { n: [3, 3], rot: 'SE' }, 'e': { n: [1, 30], rot: 'E' }, 'ou': { n: [1, 30], rot: 'OU' }, 'nao': { n: [1, 1], rot: 'NÃO' },
    'abs': { n: [1, 1], rot: 'ABS' }, 'arred': { n: [1, 2], rot: 'ARRED' }, 'maior': { n: [2, 30], rot: 'MAIOR' }, 'menor': { n: [2, 30], rot: 'MENOR' },
    'acumulado': { n: [1, 1], janela: true, rot: 'ACUMULADO' }, 'anterior': { n: [1, 1], janela: true, rot: 'ANTERIOR' }
  };
  function chaveFuncao(s) { return norm(s).replace(/\s+/g, ''); }
  function ErroF(msg, pos) { var e = new Error(msg); e.pos = pos; e.formula = true; return e; }
  function tokenizar(s) {
    var out = [], i = 0, n = s.length;
    while (i < n) {
      var ch = s[i], r;
      if (/\s/.test(ch)) { i++; continue; }
      if ((r = s.slice(i).match(/^\d+(?:[.,]\d+)?/))) { out.push({ t: 'num', v: Number(r[0].replace(',', '.')), p: i }); i += r[0].length; continue; }
      if (ch === '"') { var j = i + 1, v = ''; while (j < n) { if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j += 2; continue; } break; } v += s[j++]; } if (j >= n) throw ErroF('Texto sem aspas de fechamento.', i); out.push({ t: 'str', v: v, p: i }); i = j + 1; continue; }
      if (ch === '[') { var k = s.indexOf(']', i); if (k < 0) throw ErroF('Colchete sem fechamento "]".', i); out.push({ t: 'col', v: s.slice(i + 1, k).trim(), p: i }); i = k + 1; continue; }
      if (ch === "'") { var q = s.indexOf("'", i + 1); if (q < 0) throw ErroF('Nome de tabela sem aspas simples de fechamento.', i); out.push({ t: 'id', v: s.slice(i + 1, q), p: i }); i = q + 1; continue; }
      if ((r = s.slice(i).match(/^(<=|>=|<>|[+\-*\/^()=<>;])/))) { out.push({ t: 'op', v: r[0], p: i }); i += r[0].length; continue; }
      if ((r = s.slice(i).match(/^[^\s()\[\];+\-*\/^=<>"',]+/))) { out.push({ t: 'id', v: r[0], p: i }); i += r[0].length; continue; }
      throw ErroF('Caractere inesperado "' + ch + '".', i);
    }
    return out;
  }
  function analisarTexto(texto, opts) {
    opts = opts || {};
    var tk = tokenizar(String(texto || '')), i = 0;
    function ver(t, v) { var x = tk[i]; return x && x.t === t && (v === undefined || x.v === v); }
    function comer(t, v, msg) { if (!ver(t, v)) throw ErroF(msg || ('Esperado "' + v + '".'), tk[i] ? tk[i].p : String(texto).length); return tk[i++]; }
    function expr() { return comparacao(); }
    function comparacao() {
      var a = soma();
      if (tk[i] && tk[i].t === 'op' && ['=', '<>', '<', '>', '<=', '>='].indexOf(tk[i].v) >= 0) { var op = tk[i++].v; a = { t: 'bin', op: op, a: a, b: soma() }; }
      return a;
    }
    function soma() { var a = produto(); while (tk[i] && tk[i].t === 'op' && (tk[i].v === '+' || tk[i].v === '-')) { var op = tk[i++].v; a = { t: 'bin', op: op, a: a, b: produto() }; } return a; }
    function produto() { var a = potencia(); while (tk[i] && tk[i].t === 'op' && (tk[i].v === '*' || tk[i].v === '/')) { var op = tk[i++].v; a = { t: 'bin', op: op, a: a, b: potencia() }; } return a; }
    function potencia() { var a = unario(); if (ver('op', '^')) { i++; a = { t: 'bin', op: '^', a: a, b: unario() }; } return a; }
    function unario() { if (ver('op', '-')) { i++; return { t: 'neg', a: unario() }; } if (ver('op', '+')) { i++; return unario(); } return primario(); }
    function primario() {
      var x = tk[i];
      if (!x) throw ErroF('A fórmula terminou antes da hora.', String(texto).length);
      if (x.t === 'num') { i++; return { t: 'num', v: x.v }; }
      if (x.t === 'str') { i++; return { t: 'str', v: x.v }; }
      if (x.t === 'op' && x.v === '(') { i++; var e = expr(); comer('op', ')', 'Falta fechar o parêntese ")".'); return e; }
      if (x.t === 'col') { i++; return { t: 'ind', nome: x.v, p: x.p }; }
      if (x.t === 'id') {
        i++;
        if (ver('op', '(')) {
          var fk = chaveFuncao(x.v), fn = FUNCOES[fk];
          if (!fn) throw ErroF('Função desconhecida: ' + x.v + '.', x.p);
          i++; var args = [];
          if (!ver('op', ')')) { args.push(argumento(fn)); while (ver('op', ';')) { i++; args.push(argumento(fn, args.length)); } }
          comer('op', ')', 'Falta fechar o parêntese de ' + fn.rot + '. Os argumentos são separados por ";".');
          return { t: 'fn', f: fk, a: args, p: x.p };
        }
        if (ver('col')) {
          var tb = tabela(x.v); if (!tb) throw ErroF('Tabela desconhecida: ' + x.v + '.', x.p);
          var cn = tk[i++].v, f = campo(tb, cn); if (!f) throw ErroF('A tabela ' + tb.nome + ' não tem o campo "' + cn + '".', x.p);
          return { t: 'campo', tb: tb.id, k: f.k, p: x.p };
        }
        var tb2 = tabela(x.v); if (tb2) return { t: 'tabela', tb: tb2.id, p: x.p };
        if (/^verdadeiro$/i.test(x.v)) return { t: 'bool', v: true };
        if (/^falso$/i.test(x.v)) return { t: 'bool', v: false };
        throw ErroF('Não entendi "' + x.v + '": use Tabela[Campo], [Indicador] ou uma função seguida de "(".', x.p);
      }
      throw ErroF('Não esperava "' + x.v + '" aqui.', x.p);
    }
    function argumento() { return expr(); }
    var ast = expr();
    if (i < tk.length) throw ErroF('Sobrou "' + tk[i].v + '" no fim da fórmula (faltou um operador ou um ";"?).', tk[i].p);
    return ast;
  }

  /* ---- análise: tabelas usadas, campos fora de agregação, unidades e travas ---- */
  /* por código ou nome; com o mesmo nome em mais de um, vale o oficial, depois o do próprio usuário, depois o compartilhado */
  function indicadorPor(ref) {
    var lst = indicadores(), exato = lst.find(function (x) { return x.IdIndicador === ref; });
    if (exato) return exato;
    var k = norm(ref), cands = lst.filter(function (x) { return norm(x.IdIndicador) === k || norm(x.Nome) === k; }), eu = usuarioLogin();
    if (cands.length < 2) return cands[0] || null;
    return cands.find(function (x) { return x.Oficial === 'Sim'; }) || cands.find(function (x) { return x.Dono === eu; }) || cands.find(function (x) { return x.Compartilhado === 'Sim'; }) || cands[0];
  }
  function verificar(ast, pilha) {
    /* inds = indicadores usados direto na fórmula; todos = também os que eles usam (para barrar referência circular e oficial que depende de pessoal) */
    var r = { erros: [], avisos: [], tabelas: {}, inds: {}, todos: {}, janela: false };
    pilha = pilha || [];
    function passo(n, dentroAgg, tbAgg) {
      if (!n) return;
      if (n.t === 'campo') {
        if (!dentroAgg) r.erros.push('O campo ' + rotTabela(n.tb) + '[' + n.k + '] precisa estar dentro de SOMA, MÉDIA, MÍN, MÁX, CONTAR ou CONTAR.DISTINTO.');
        else if (tbAgg && tbAgg !== n.tb) r.erros.push('O filtro de uma agregação só pode usar campos da mesma tabela (' + rotTabela(tbAgg) + '), não de ' + rotTabela(n.tb) + '.');
        r.tabelas[n.tb] = 1; return;
      }
      if (n.t === 'tabela') { if (!dentroAgg) r.erros.push('A tabela ' + rotTabela(n.tb) + ' só pode aparecer dentro de CONTAR.'); r.tabelas[n.tb] = 1; return; }
      if (n.t === 'ind') {
        if (dentroAgg) { r.erros.push('[' + n.nome + '] não pode ficar dentro de uma agregação.'); return; }
        var ind = indicadorPor(n.nome);
        if (!ind) { r.erros.push('Indicador desconhecido: [' + n.nome + '].'); return; }
        n.id = ind.IdIndicador;
        if (pilha.indexOf(ind.IdIndicador) >= 0) { r.erros.push('Referência circular: ' + pilha.concat([ind.IdIndicador]).join(' → ') + '.'); return; }
        r.inds[ind.IdIndicador] = 1; r.todos[ind.IdIndicador] = 1;
        var sub = astIndicador(ind, pilha.concat([ind.IdIndicador]));
        if (sub.info && sub.info.todos) Object.keys(sub.info.todos).forEach(function (k) { r.todos[k] = 1; });
        if (sub.erro) r.erros.push('[' + ind.Nome + ']: ' + sub.erro);
        else { Object.keys(sub.info.tabelas).forEach(function (t) { r.tabelas[t] = 1; }); sub.info.avisos.forEach(function (a) { r.avisos.push('[' + ind.Nome + '] ' + a); }); if (sub.info.janela) r.janela = true; }
        return;
      }
      if (n.t === 'fn') {
        var fn = FUNCOES[n.f];
        if (fn.agg) {
          if (dentroAgg) { r.erros.push(fn.rot + ' dentro de outra agregação não é permitido.'); return; }
          if (!n.a.length || n.a.length > 2) { r.erros.push(fn.rot + ' recebe o campo e, se quiser, uma condição: ' + fn.rot + '(Tabela[Campo]; condição).'); return; }
          var alvo = n.a[0];
          if (n.f === 'contar' && alvo.t === 'tabela') { r.tabelas[alvo.tb] = 1; n.tb = alvo.tb; }
          else if (alvo.t !== 'campo') { r.erros.push('O primeiro argumento de ' + fn.rot + ' tem de ser um campo, como Produção[Quantidade]' + (n.f === 'contar' ? ', ou uma tabela' : '') + '.'); return; }
          else {
            n.tb = alvo.tb; r.tabelas[alvo.tb] = 1;
            var f = campo(tabela(alvo.tb), alvo.k);
            if (['soma', 'media', 'min', 'max'].indexOf(n.f) >= 0 && f.t !== 'num') r.erros.push(fn.rot + ' precisa de um campo numérico; ' + rotTabela(alvo.tb) + '[' + f.k + '] é texto (use CONTAR ou CONTAR.DISTINTO).');
            if (n.f === 'soma' && f.taxa) r.erros.push(rotTabela(alvo.tb) + '[' + f.k + '] é uma taxa da linha (' + f.l + ') e não se soma: use DIVIDIR(SOMA(numerador); SOMA(denominador)).');
            if (n.f === 'media' && f.taxa) r.avisos.push('Média de ' + f.l + ' é a média simples das linhas; para uma taxa do grupo use DIVIDIR(SOMA(numerador); SOMA(denominador)).');
          }
          if (n.a[1]) passo(n.a[1], true, n.tb);
          return;
        }
        if (fn.janela) { r.janela = true; if (dentroAgg) r.erros.push(fn.rot + ' não pode ficar dentro de uma agregação.'); }
        if (n.a.length < fn.n[0] || n.a.length > fn.n[1]) r.erros.push(fn.rot + ' recebe ' + (fn.n[0] === fn.n[1] ? fn.n[0] : fn.n[0] + ' a ' + fn.n[1]) + ' argumento(s), separados por ";".');
        n.a.forEach(function (x) { passo(x, dentroAgg, tbAgg); });
        return;
      }
      if (n.t === 'bin') { passo(n.a, dentroAgg, tbAgg); passo(n.b, dentroAgg, tbAgg); return; }
      if (n.t === 'neg') passo(n.a, dentroAgg, tbAgg);
    }
    passo(ast, false, null);
    return r;
  }
  function rotTabela(id) { var t = tabela(id); return t ? (/\s/.test(t.nome) ? "'" + t.nome + "'" : t.nome) : id; }
  var cacheAst = {};
  function astIndicador(ind, pilha) {
    var chave = ind.IdIndicador + '|' + ind.Versao + '|' + ind.Formula + '|' + (pilha || []).join('>');
    if (cacheAst[chave]) return cacheAst[chave];
    var r;
    try { var ast = analisarTexto(ind.Formula); var info = verificar(ast, pilha || [ind.IdIndicador]); r = info.erros.length ? { erro: info.erros[0], info: info } : { ast: ast, info: info }; }
    catch (e) { r = { erro: e.message || String(e) }; }
    cacheAst[chave] = r; return r;
  }
  function compilar(texto) {
    try { var ast = analisarTexto(texto); var info = verificar(ast, []); return { ast: ast, info: info, erro: info.erros[0] || '' }; }
    catch (e) { return { erro: (e && e.message) || String(e), pos: e && e.pos }; }
  }

  /* ---------------------------------------------------------------------
     4) MOTOR DE CONSULTA: cada tabela filtrada e agrupada no próprio nível; as tabelas se juntam pelas dimensões
     --------------------------------------------------------------------- */
  var VAZIO = '(vazio)';
  /* campo da tabela para um eixo/filtro: {tipo:'dim', dim} usa o campo com essa dimensão; {tipo:'campo', tabela, campo} só existe na própria tabela */
  function campoDoAlvo(tb, alvo) {
    if (!alvo) return null;
    if (alvo.tipo === 'dim') return A(tb.campos).find(function (f) { return f.dim === alvo.dim; }) || null;
    if (alvo.tipo === 'campo') return alvo.tabela === tb.id ? campo(tb, alvo.campo) : null;
    return null;
  }
  function rotuloAlvo(alvo) {
    if (!alvo) return '';
    if (alvo.tipo === 'dim') return DIMS[alvo.dim] || alvo.dim;
    var tb = tabela(alvo.tabela), f = tb && campo(tb, alvo.campo);
    return (tb ? tb.nome + ' › ' : '') + (f ? f.l : alvo.campo);
  }
  function valorChave(row, f) {
    if (!f) return '';
    var v = row[f.k];
    if (v instanceof Date) return mesDe(v);
    if (vazio(v) || txt(v) === '') return VAZIO;
    return typeof v === 'number' ? String(v) : txt(v);
  }
  function rotuloValor(alvo, v) {
    if (v === VAZIO) return '(sem ' + (rotuloAlvo(alvo) || 'valor').toLowerCase() + ')';
    if (alvo && ((alvo.tipo === 'dim' && alvo.dim === 'mes') || /^\d{4}-\d{2}$/.test(v))) return rotuloMes(v);
    return v;
  }
  function passaFiltro(row, f, filtro) {
    var v = valorChave(row, f), lst = A(filtro.valores);
    if (!lst.length) return true;
    var dentro = lst.some(function (x) { return norm(x) === norm(v); });
    return filtro.op === 'fora' ? !dentro : dentro;
  }
  /* consulta = { eixo, legenda, filtros: [{alvo, op:'em'|'fora', valores}], periodo: {de:'AAAA-MM', ate:'AAAA-MM'} } */
  function prepararTabela(tbId, consulta, memo) {
    if (memo[tbId]) return memo[tbId];
    var tb = tabela(tbId), linhas = TABELA_LINHAS(tbId), res = { tb: tb, sem: [], fEixo: null, fLeg: null, base: [], idx: {}, avisos: A(linhas.avisos).slice() };
    var per = consulta.periodo || {}, fMes = campoDoAlvo(tb, { tipo: 'dim', dim: 'mes' });
    if ((per.de || per.ate) && !fMes) res.sem.push('não tem data para o período');
    /* filtro do clique (suave): a tabela sem essa dimensão segue sem o filtro, com aviso; filtro do painel ou do bloco: "não se relaciona" */
    var filtros = A(consulta.filtros).map(function (fl) {
      var f = campoDoAlvo(tb, fl.alvo);
      if (!f && A(fl.valores).length) { if (fl.suave) res.avisos.push('o filtro do clique (' + rotuloAlvo(fl.alvo) + ') não se aplica a esta tabela: valores sem esse filtro'); else res.sem.push('não tem ' + rotuloAlvo(fl.alvo)); }
      return { fl: fl, f: f };
    });
    if (consulta.eixo) { res.fEixo = campoDoAlvo(tb, consulta.eixo); if (!res.fEixo) res.sem.push('não tem ' + rotuloAlvo(consulta.eixo)); }
    if (consulta.legenda) { res.fLeg = campoDoAlvo(tb, consulta.legenda); if (!res.fLeg) res.sem.push('não tem ' + rotuloAlvo(consulta.legenda)); }
    if (!res.sem.length) {
      res.base = linhas.filter(function (row) {
        if (per.de || per.ate) { var m = row[fMes.k]; if (!m) return false; if (per.de && m < per.de) return false; if (per.ate && m > per.ate) return false; }
        return filtros.every(function (x) { return !x.f || passaFiltro(row, x.f, x.fl); });
      });
      res.base.forEach(function (row) { var k = chaveGrupo(valorChave(row, res.fEixo), valorChave(row, res.fLeg)); (res.idx[k] = res.idx[k] || []).push(row); });
    }
    memo[tbId] = res; return res;
  }
  function chaveGrupo(e, l) { return (e == null ? '*' : e) + '\u0001' + (l == null ? '*' : l); }
  /* linhas da tabela no grupo (eixo/legenda null = todos) */
  function linhasGrupo(prep, g) {
    if (g.eixo == null && g.leg == null) return prep.base;
    if (g.eixo != null && g.leg != null) return prep.idx[chaveGrupo(g.eixo, g.leg)] || [];
    if (g.eixo != null && !prep.fLeg) return prep.idx[chaveGrupo(g.eixo, '')] || [];
    if (g.leg != null && !prep.fEixo) return prep.idx[chaveGrupo('', g.leg)] || [];
    return prep.base.filter(function (row) { return (g.eixo == null || valorChave(row, prep.fEixo) === g.eixo) && (g.leg == null || valorChave(row, prep.fLeg) === g.leg); });
  }
  function juntarUM(a, b, op) {
    if (op === '*') return a && b ? a + '·' + b : (a || b);
    if (op === '/') { if (!b) return a; if (a === b) return ''; return (a || '1') + '/' + b; }
    return a || b;
  }
  function R(v, u, extra) { var r = { v: v, u: u || '' }; if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; }); return r; }
  function nulo(nota) { return { v: null, u: '', nota: nota || '' }; }
  /* avaliação de uma linha (condição do filtro de uma agregação) */
  function avaliarLinha(n, row) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'campo': var v = row[n.k]; return v instanceof Date ? mesDe(v) : v;
      case 'neg': return -N(avaliarLinha(n.a, row));
      case 'bin':
        var a = avaliarLinha(n.a, row), b = avaliarLinha(n.b, row);
        if (['=', '<>', '<', '>', '<=', '>='].indexOf(n.op) >= 0) {
          var na = typeof a === 'number' || (typeof b === 'number' && !vazio(a) && !isNaN(N(a))), x = na ? N(a) : norm(a), y = na ? N(b) : norm(b);
          if (n.op === '=') return x === y; if (n.op === '<>') return x !== y; if (n.op === '<') return x < y; if (n.op === '>') return x > y; if (n.op === '<=') return x <= y; return x >= y;
        }
        a = N(a); b = N(b);
        if (n.op === '+') return a + b; if (n.op === '-') return a - b; if (n.op === '*') return a * b; if (n.op === '/') return b ? a / b : null; return Math.pow(a, b);
      case 'fn':
        var as = n.a.map(function (x) { return avaliarLinha(x, row); });
        if (n.f === 'e') return as.every(Boolean); if (n.f === 'ou') return as.some(Boolean); if (n.f === 'nao') return !as[0];
        if (n.f === 'se') return as[0] ? as[1] : as[2]; if (n.f === 'abs') return Math.abs(N(as[0])); if (n.f === 'arred') return arred(N(as[0]), as.length > 1 ? N(as[1]) : 0);
        if (n.f === 'maior') return Math.max.apply(null, as.map(N)); if (n.f === 'menor') return Math.min.apply(null, as.map(N));
        if (n.f === 'dividir') return N(as[1]) ? N(as[0]) / N(as[1]) : (as.length > 2 ? as[2] : null);
        return null;
    }
    return null;
  }
  function agregar(n, rows, prep, cob) {
    var tb = prep.tb, fn = n.f, alvo = n.a[0], f = alvo.t === 'campo' ? campo(tb, alvo.k) : null;
    if (n.a[1]) rows = rows.filter(function (row) { return !!avaliarLinha(n.a[1], row); });
    if (f && f.unico) { var vistos = {}; rows = rows.filter(function (row) { var k = txt(row[f.unico]); if (vistos[k]) return false; vistos[k] = 1; return true; }); }
    if (fn === 'contar' && !f) return R(rows.length, '');
    var vals = [], ums = {}, semValor = [];
    rows.forEach(function (row) {
      var v = row[f.k];
      if (vazio(v) || txt(v) === '') { semValor.push(row); return; }
      vals.push(v);
      if (f.t === 'num') { var u = f.u || (f.um ? txt(row[f.um]) : ''); ums[u] = 1; }
    });
    /* cobertura: cada registro conta uma vez por campo, mesmo usado em vários valores do bloco */
    if (cob && rows.length) {
      var chaveCob = tb.id + '|' + f.k, c0 = cob[chaveCob] || (cob[chaveCob] = { tb: tb.nome, campo: f.l, faltas: new Set(), total: new Set() });
      rows.forEach(function (r) { c0.total.add(r); }); semValor.forEach(function (r) { c0.faltas.add(r); });
    }
    if (fn === 'contar') return R(vals.length, '');
    if (fn === 'contar.distinto') { var d = {}; vals.forEach(function (v) { d[norm(v)] = 1; }); return R(Object.keys(d).length, ''); }
    var lu = Object.keys(ums);
    if (lu.length > 1) return { v: null, u: '', erro: 'várias unidades em ' + tb.nome + '[' + f.k + '] (' + lu.filter(Boolean).join(', ') + '): separe por produto ou filtre uma unidade' };
    var u = lu[0] || '';
    /* soma sem nenhum registro = 0 "neutro" (serve para qualquer unidade: 0 perdas ÷ 10 un = 0); registros sem o valor = faltam dados */
    if (!vals.length) return fn === 'soma' && !rows.length ? R(0, '', { neutro: true }) : { v: null, u: u, nota: rows.length ? 'nenhum registro com ' + f.l.charAt(0).toLowerCase() + f.l.slice(1) + ' (' + tb.nome + ')' : 'sem registros no recorte' };
    var ns = vals.map(N);
    if (fn === 'soma') return R(ns.reduce(function (a, b) { return a + b; }, 0), u);
    if (fn === 'media') return R(ns.reduce(function (a, b) { return a + b; }, 0) / ns.length, u);
    if (fn === 'min') return R(Math.min.apply(null, ns), u);
    if (fn === 'max') return R(Math.max.apply(null, ns), u);
    return nulo();
  }
  /* ctx: { prep(tbId), grupo:{eixo, leg}, serie: [grupos na ordem do eixo], pos, memo, cob, explicar: [] } */
  function avaliar(n, cx) {
    switch (n.t) {
      case 'num': return R(n.v, '');
      case 'str': return R(n.v, '');
      case 'bool': return R(n.v, '');
      case 'neg': var a0 = avaliar(n.a, cx); if (a0.v == null || a0.erro || a0.semRelacao) return a0; if (typeof a0.v !== 'number') return { v: null, u: '', erro: 'o sinal de menos só aceita números' }; return R(-N(a0.v), a0.u, a0.neutro ? { neutro: true } : null);
      case 'ind': {
        var ind = indicadorPor(n.id || n.nome); if (!ind) return { v: null, u: '', erro: 'indicador [' + n.nome + '] não existe' };
        var ai = astIndicador(ind, [ind.IdIndicador]); if (ai.erro) return { v: null, u: '', erro: '[' + ind.Nome + ']: ' + ai.erro };
        var r0 = avaliar(ai.ast, cx);
        if (cx.explicar) cx.explicar.push('[' + ind.Nome + '] = ' + textoValor(r0, ind.Formato, ind.Casas));
        return r0;
      }
      case 'fn': {
        var fn = FUNCOES[n.f];
        if (fn.agg) {
          var prep = cx.prep(n.tb);
          if (prep.sem.length) return { v: null, u: '', semRelacao: prep.tb.nome + ' ' + prep.sem.join(' e ') };
          var r1 = agregar(n, linhasGrupo(prep, cx.grupo), prep, cx.cob);
          if (cx.explicar) cx.explicar.push(textoNo(n) + ' = ' + textoValor(r1, r1 && typeof r1.u === 'string' && r1.u.indexOf('R$') === 0 ? 'moeda' : undefined));
          return r1;
        }
        if (fn.janela) {
          if (!cx.serie) return n.f === 'acumulado' ? avaliar(n.a[0], cx) : { v: null, u: '', nota: 'ANTERIOR precisa de um eixo (ex.: mês)' };
          if (n.f === 'anterior') { if (cx.pos <= 0) return { v: null, u: '', nota: 'primeiro ponto do eixo' }; return avaliar(n.a[0], filho(cx, cx.pos - 1)); }
          var s = 0, alg = false, u = '', er = null;
          for (var i = 0; i <= cx.pos; i++) { var ri = avaliar(n.a[0], filho(cx, i)); if (ri.erro) { er = ri; break; } if (ri.v != null) { s += N(ri.v); alg = true; u = u || ri.u; } }
          return er || (alg ? R(s, u) : nulo('sem valores até aqui'));
        }
        var as = n.a.map(function (x) { return avaliar(x, cx); });
        var ruim = as.find(function (x) { return x.erro || x.semRelacao; });
        if (ruim && n.f !== 'se') return ruim;
        if (n.f === 'dividir') {
          if (as[0].v == null) return nulo(as[0].nota || 'numerador vazio');
          if (as[1].v == null || N(as[1].v) === 0) return as.length > 2 ? as[2] : nulo('sem base (divisor zero ou vazio)');
          if (as[0].neutro) return R(0, '', { neutro: true });
          return R(N(as[0].v) / N(as[1].v), juntarUM(as[0].u, as[1].u, '/'));
        }
        if (n.f === 'se') { var c = as[0]; if (c.erro || c.semRelacao) return c; return c.v ? as[1] : as[2]; }
        if (n.f === 'e') return R(as.every(function (x) { return !!x.v; }), '');
        if (n.f === 'ou') return R(as.some(function (x) { return !!x.v; }), '');
        if (n.f === 'nao') return R(!as[0].v, '');
        if (as.some(function (x) { return x.v == null; })) return nulo((as.find(function (x) { return x.v == null; }) || {}).nota);
        if (n.f === 'abs') return R(Math.abs(N(as[0].v)), as[0].u, as[0].neutro ? { neutro: true } : null);
        if (n.f === 'arred') return R(arred(N(as[0].v), as.length > 1 ? N(as[1].v) : 0), as[0].u, as[0].neutro ? { neutro: true } : null);
        if (n.f === 'maior' || n.f === 'menor') {
          var us = {}; as.forEach(function (x) { if (x.u) us[x.u] = 1; });
          if (Object.keys(us).length > 1) return { v: null, u: '', erro: 'compara unidades diferentes (' + Object.keys(us).join(', ') + ')' };
          return R((n.f === 'maior' ? Math.max : Math.min).apply(null, as.map(function (x) { return N(x.v); })), Object.keys(us)[0] || '');
        }
        return nulo();
      }
      case 'bin': {
        var a = avaliar(n.a, cx), b = avaliar(n.b, cx);
        if (a.erro || a.semRelacao) return a; if (b.erro || b.semRelacao) return b;
        if (['=', '<>', '<', '>', '<=', '>='].indexOf(n.op) >= 0) {
          if (a.v == null || b.v == null) return nulo();
          var na = typeof a.v === 'number', x = na ? a.v : norm(a.v), y = na ? N(b.v) : norm(b.v);
          return R(n.op === '=' ? x === y : n.op === '<>' ? x !== y : n.op === '<' ? x < y : n.op === '>' ? x > y : n.op === '<=' ? x <= y : x >= y, '');
        }
        if (a.v == null) return nulo(a.nota); if (b.v == null) return nulo(b.nota);
        /* conta só com número: texto ou condição (verdadeiro/falso) numa conta viraria um número inventado */
        if (typeof a.v !== 'number' || typeof b.v !== 'number') return { v: null, u: '', erro: 'a conta "' + n.op + '" só aceita números (há texto ou condição de um lado)' };
        if (n.op === '+' || n.op === '-') {
          if (a.u && b.u && a.u !== b.u) return { v: null, u: '', erro: (n.op === '+' ? 'soma' : 'subtração') + ' de unidades diferentes (' + a.u + ' e ' + b.u + ')' };
          return R(n.op === '+' ? N(a.v) + N(b.v) : N(a.v) - N(b.v), a.u || b.u, a.neutro && b.neutro ? { neutro: true } : null);
        }
        if (n.op === '*') return (a.neutro || b.neutro) ? R(0, '', { neutro: true }) : R(N(a.v) * N(b.v), juntarUM(a.u, b.u, '*'));
        if (n.op === '/') return N(b.v) ? (a.neutro ? R(0, '', { neutro: true }) : R(N(a.v) / N(b.v), juntarUM(a.u, b.u, '/'))) : nulo('divisão por zero');
        if (n.op === '^') return R(Math.pow(N(a.v), N(b.v)), a.u && N(b.v) !== 1 ? a.u + '^' + fmtNum(N(b.v), 6) : a.u);
        return nulo();
      }
    }
    return nulo();
  }
  function filho(cx, pos) { var g = cx.serie[pos]; return { prep: cx.prep, grupo: g, serie: cx.serie, pos: pos, cob: null, explicar: null }; }
  function textoNo(n) {
    switch (n.t) {
      case 'num': return fmtNum(n.v, 6);
      case 'str': return '"' + n.v + '"';
      case 'bool': return n.v ? 'VERDADEIRO' : 'FALSO';
      case 'campo': return rotTabela(n.tb) + '[' + n.k + ']';
      case 'tabela': return rotTabela(n.tb);
      case 'ind': return '[' + n.nome + ']';
      case 'neg': return '−' + textoNo(n.a);
      case 'bin': return textoNo(n.a) + ' ' + (n.op === '*' ? '×' : n.op === '/' ? '÷' : n.op) + ' ' + textoNo(n.b);
      case 'fn': return FUNCOES[n.f].rot + '(' + n.a.map(textoNo).join('; ') + ')';
    }
    return '';
  }
  function textoValor(r, formato, casas) {
    if (!r) return '—';
    if (r.erro) return 'erro: ' + r.erro;
    if (r.semRelacao) return 'não se relaciona (' + r.semRelacao + ')';
    if (r.v == null) return '—' + (r.nota ? ' (' + r.nota + ')' : '');
    if (typeof r.v === 'boolean') return r.v ? 'VERDADEIRO' : 'FALSO';
    if (typeof r.v === 'string') return '"' + r.v + '"';
    return formatar(r.v, formato, casas, r.u);
  }
  function formatar(v, formato, casas, u) {
    if (v == null || (typeof v === 'number' && !isFinite(v))) return '—';
    if (typeof v !== 'number') return String(v);
    var c = casas == null ? (formato === 'int' ? 0 : formato === 'moeda' ? 2 : formato === 'pct' ? 1 : 2) : casas;
    if (formato === 'pct') return fmtNum(v * 100, c, Math.min(1, c)) + '%';
    if (formato === 'moeda') return 'R$ ' + fmtNum(v, c, 2) + (u && u !== 'R$' && u.indexOf('R$') === 0 ? u.slice(2) : '');
    return fmtNum(v, c) + (u ? ' ' + u : '');
  }

  /* execução de uma consulta (bloco): valores = [{ formula | indicador, nome, formato, casas, acumulado }] */
  function resolverValor(vc) {
    var ind = vc.indicador ? indicadorPor(vc.indicador) : null, texto = ind ? '[' + ind.Nome + ']' : txt(vc.formula);
    if (vc.indicador && !ind) return { cfg: vc, nome: vc.nome || vc.indicador, erro: 'Indicador "' + vc.indicador + '" não existe mais.' };
    if (vc.acumulado) texto = 'ACUMULADO(' + texto + ')';
    var c = compilar(texto);
    return { cfg: vc, ind: ind, nome: vc.nome || (ind ? ind.Nome : txt(vc.formula)) + (vc.acumulado ? ' (acumulado)' : ''), formula: texto, ast: c.ast, info: c.info, erro: c.erro,
      formato: vc.formato || (ind ? ind.Formato : 'num'), casas: vc.casas != null && vc.casas !== '' ? N(vc.casas) : (ind && ind.Casas != null && ind.Casas !== '' ? N(ind.Casas) : null) };
  }
  function executar(cfg, filtrosPainel) {
    cfg = cfg || {}; filtrosPainel = filtrosPainel || {};
    var consulta = { eixo: cfg.eixo || null, legenda: cfg.legenda || null, periodo: cfg.periodoProprio ? (cfg.periodo || {}) : (filtrosPainel.periodo || cfg.periodo || {}),
      filtros: A(filtrosPainel.filtros).concat(A(cfg.filtros)) };
    var memo = {}, valores = A(cfg.valores).map(resolverValor), avisos = [], cob = {};
    function prep(id) { return prepararTabela(id, consulta, memo); }
    var tabs = {};
    valores.forEach(function (v) { if (v.info) Object.keys(v.info.tabelas).forEach(function (t) { tabs[t] = 1; }); if (v.erro) avisos.push(v.nome + ': ' + v.erro); else A(v.info && v.info.avisos).forEach(function (a) { avisos.push(v.nome + ': ' + a); }); });
    var eixoVals = {}, legVals = {};
    Object.keys(tabs).forEach(function (t) {
      var p = prep(t);
      A(p.avisos).forEach(function (a) { if (avisos.indexOf(p.tb.nome + ': ' + a) < 0) avisos.push(p.tb.nome + ': ' + a); });
      if (p.sem.length) return;
      p.base.forEach(function (row) { if (consulta.eixo) eixoVals[valorChave(row, p.fEixo)] = 1; if (consulta.legenda) legVals[valorChave(row, p.fLeg)] = 1; });
    });
    var ehMes = consulta.eixo && ((consulta.eixo.tipo === 'dim' && consulta.eixo.dim === 'mes') || (consulta.eixo.tipo === 'campo' && /^Mes$/.test(consulta.eixo.campo)));
    var eixo = Object.keys(eixoVals);
    if (ehMes) {
      var ms = eixo.filter(function (x) { return /^\d{4}-\d{2}$/.test(x); }).sort();
      var ini = consulta.periodo.de || ms[0], fim = consulta.periodo.ate || ms[ms.length - 1], cont = [];
      if (ini && fim) { var m = ini; while (m <= fim && cont.length < 120) { cont.push(m); m = mesMais(m, 1); } }
      eixo = cont.concat(eixo.filter(function (x) { return !/^\d{4}-\d{2}$/.test(x); }));
    } else eixo.sort(function (a, b) { return a === VAZIO ? 1 : b === VAZIO ? -1 : String(a).localeCompare(String(b), 'pt-BR', { numeric: true }); });
    var legendas = consulta.legenda ? Object.keys(legVals).sort(function (a, b) { return a === VAZIO ? 1 : b === VAZIO ? -1 : String(a).localeCompare(String(b), 'pt-BR', { numeric: true }); }) : [null];
    if (!consulta.eixo) eixo = [null];
    /* avaliação */
    var celulas = valores.map(function () { return {}; }), totais = valores.map(function () { return {}; }), geral = [];
    valores.forEach(function (v, vi) {
      legendas.forEach(function (lg) {
        var serie = eixo.map(function (e) { return { eixo: e, leg: lg }; });
        eixo.forEach(function (e, pos) {
          var r = v.erro ? { v: null, u: '', erro: v.erro } : avaliar(v.ast, { prep: prep, grupo: serie[pos], serie: consulta.eixo ? serie : null, pos: pos, cob: cob });
          celulas[vi][chaveGrupo(e, lg)] = r;
        });
        if (consulta.legenda && consulta.eixo) totais[vi][lg] = v.erro ? { v: null, erro: v.erro } : avaliar(v.ast, { prep: prep, grupo: { eixo: null, leg: lg }, serie: null, pos: 0, cob: null });
      });
      geral[vi] = v.erro ? { v: null, erro: v.erro } : avaliar(v.ast, { prep: prep, grupo: { eixo: null, leg: null }, serie: null, pos: 0, cob: null });
    });
    /* ordem pelo valor e top N */
    if (consulta.eixo && (cfg.ordem === 'valor_desc' || cfg.ordem === 'valor_asc') && valores.length) {
      var tot = {}; eixo.forEach(function (e) { tot[e] = legendas.reduce(function (s, lg) { var r = celulas[0][chaveGrupo(e, lg)]; return s + (r && typeof r.v === 'number' ? r.v : 0); }, 0); });
      eixo.sort(function (a, b) { return cfg.ordem === 'valor_desc' ? tot[b] - tot[a] : tot[a] - tot[b]; });
    }
    var cortados = 0;
    if (consulta.eixo && N(cfg.topN) > 0 && eixo.length > N(cfg.topN)) { cortados = eixo.length - N(cfg.topN); eixo = eixo.slice(0, N(cfg.topN)); }
    var semRel = {};
    valores.forEach(function (v, vi) { Object.keys(celulas[vi]).forEach(function (k) { var r = celulas[vi][k]; if (r && r.semRelacao) semRel[v.nome + ': não se relaciona — ' + r.semRelacao] = 1; if (r && r.erro) semRel[v.nome + ': ' + r.erro] = 1; }); });
    Object.keys(semRel).forEach(function (k) { if (avisos.indexOf(k) < 0) avisos.push(k); });
    var cobertura = Object.keys(cob).map(function (k) { return cob[k]; }).filter(function (c) { return c.faltas.size > 0; }).map(function (c) { return c.tb + ' › ' + c.campo + ': ' + c.faltas.size + ' de ' + c.total.size + ' registro(s) sem valor'; });
    return { cfg: cfg, consulta: consulta, valores: valores, eixo: eixo, legendas: legendas, celulas: celulas, totais: totais, geral: geral, avisos: avisos, cobertura: cobertura, cortados: cortados,
      rotEixo: function (e) { return e == null ? 'Total' : rotuloValor(consulta.eixo, e); }, rotLeg: function (l) { return l == null ? '' : rotuloValor(consulta.legenda, l); }, prep: prep };
  }
  /* cálculo aberto de um valor num grupo (ou no total) */
  function calculoAberto(res, vi, eixoV, legV) {
    var v = res.valores[vi]; if (!v || v.erro) return v ? v.erro : '';
    var memo = {}, linhas = [];
    function prep(id) { return prepararTabela(id, res.consulta, memo); }
    var serie = res.consulta.eixo ? res.eixo.map(function (e) { return { eixo: e, leg: legV == null ? null : legV }; }) : null, pos = serie ? Math.max(0, res.eixo.indexOf(eixoV)) : 0;
    var g = { eixo: eixoV == null ? null : eixoV, leg: legV == null ? null : legV };
    var r = avaliar(v.ast, { prep: prep, grupo: g, serie: eixoV == null ? null : serie, pos: pos, cob: null, explicar: linhas });
    return { formula: v.formula, passos: linhas, resultado: textoValor(r, v.formato, v.casas) };
  }
  /* registros por trás de um valor (todas as tabelas que ele usa), no grupo */
  function registros(res, vi, eixoV, legV) {
    var v = res.valores[vi], out = [];
    if (!v || !v.info) return out;
    var g = { eixo: eixoV == null ? null : eixoV, leg: legV == null ? null : legV };
    Object.keys(v.info.tabelas).forEach(function (t) {
      var p = res.prep(t); if (p.sem.length) return;
      out.push({ tabela: p.tb, linhas: linhasGrupo(p, g) });
    });
    return out;
  }

  /* ---------------------------------------------------------------------
     5) INDICADORES: oficiais (só o administrador cria e altera) e pessoais, com versão e histórico
     --------------------------------------------------------------------- */
  function I(id, nome, area, formula, formato, casas, sentido, desc, comp) { return { id: id, nome: nome, area: area, f: formula, fmt: formato, casas: casas, sentido: sentido || '', desc: desc, comp: comp || [] }; }
  var PA_PRODUTO = 'E(Perdas[Alvo] = "Produto"; Perdas[TipoOP] = "PA")';
  var OFICIAIS = [
    I('producao_celulas', 'Células produzidas', 'Produção', 'SOMA(Produção[Quantidade]; Produção[TipoOP] = "PA")', 'num', 0, 'maior', 'Quantidade boa apontada nas OPs de PA (células), na unidade da OP.'),
    I('producao_apontada', 'Produção apontada', 'Produção', 'SOMA(Produção[Quantidade])', 'num', 3, 'maior', 'Quantidade boa apontada em todas as OPs. Use por produto: kg, m e un não se somam.'),
    I('disponibilidade', 'Disponibilidade', 'Produção', 'DIVIDIR(SOMA(OEE[TempoOperacao]); SOMA(OEE[TempoPlanejado]))', 'pct', 1, 'maior',
      'Tempo em operação ÷ (tempo em operação + paradas não planejadas). Tempo em operação = tempo apontado na máquina − paradas dentro dele; paradas planejadas ficam fora.'),
    I('performance', 'Performance', 'Produção', 'DIVIDIR(SOMA(OEE[TempoPadraoProduzido]); SOMA(OEE[TempoOperacao]; OEE[ComPadrao] = "Sim"))', 'pct', 1, 'maior',
      'Tempo padrão do roteiro para o que foi produzido (bom + perdido) ÷ tempo em operação, só nas máquinas com tempo padrão.'),
    I('qualidade', 'Qualidade', 'Qualidade', 'DIVIDIR(SOMA(OEE[TempoPadraoBoas]); SOMA(OEE[TempoPadraoProduzido]))', 'pct', 1, 'maior',
      'Peças boas ÷ produzidas (boas + perdas do produto), ponderadas pelo tempo padrão de cada OP (permite juntar produtos diferentes).'),
    I('oee', 'OEE', 'Produção', '[disponibilidade] * [performance] * [qualidade]', 'pct', 1, 'maior',
      'Disponibilidade × Performance × Qualidade. Precisa do apontamento de tempo por máquina e das paradas; sem eles aparece "faltam dados".', ['disponibilidade', 'performance', 'qualidade']),
    I('rejeito_celulas', 'Taxa de rejeito de células', 'Qualidade', 'DIVIDIR(SOMA(Perdas[Quantidade]; ' + PA_PRODUTO + '); SOMA(Produção[Quantidade]; Produção[TipoOP] = "PA") + SOMA(Perdas[Quantidade]; ' + PA_PRODUTO + '))', 'pct', 2, 'menor',
      'Células perdidas ÷ (células boas + perdidas) nas OPs de PA.'),
    I('rejeito_produto', 'Taxa de rejeito do produto', 'Qualidade', 'DIVIDIR(SOMA(Perdas[Quantidade]; Perdas[Alvo] = "Produto"); SOMA(Produção[Quantidade]) + SOMA(Perdas[Quantidade]; Perdas[Alvo] = "Produto"))', 'pct', 2, 'menor',
      'Perdas do próprio produto da OP ÷ (produzido + perdido), na mesma unidade: use por produto.'),
    I('perda_material', 'Perda de material', 'Qualidade', 'DIVIDIR(SOMA(Perdas[Quantidade]; Perdas[Alvo] = "Material"); SOMA(Consumos[Quantidade]) + SOMA(Perdas[Quantidade]; E(Perdas[Alvo] = "Material"; Perdas[Origem] <> "Dentro do consumo apontado")))', 'pct', 2, 'menor',
      'Material perdido ÷ material usado. Usado = consumo apontado + perdas por retirada adicional (ou sem origem, de antes da 1.4.0); a perda dentro do consumo já está no consumo. Na mesma unidade: use por material.'),
    I('perdas_rs', 'Perdas (R$)', 'Qualidade', 'SOMA(Perdas[Custo])', 'moeda', 2, 'menor', 'Custo das perdas registradas no período (pela data da perda), pela mesma regra do custo da família: perda dentro do consumo e PI da própria família não somam de novo.'),
    I('perdas_sobre_custo', 'Perdas sobre o custo', 'Qualidade', 'DIVIDIR(SOMA(Custos[Perdas]; Custos[Produzida] = "Sim"); SOMA(Custos[Total]; Custos[Produzida] = "Sim"))', 'pct', 2, 'menor', 'Custo das perdas ÷ custo total, nas famílias produzidas (o mesmo cálculo do módulo Custos: perda dentro do consumo e PI da própria família não somam de novo).'),
    I('custo_unitario', 'Custo unitário de fabricação', 'Custos', 'DIVIDIR(SOMA(Custos[Total]; Custos[Produzida] = "Sim"); SOMA(Custos[Unidades]; Custos[Produzida] = "Sim"))', 'moeda', 2, 'menor',
      '(Materiais + energia + mão de obra + perdas) ÷ unidades produzidas na OP de PA, só famílias com produção. Sem depreciação.', ['custo_un_materiais', 'custo_un_energia', 'custo_un_mod', 'custo_un_perdas']),
    I('custo_un_materiais', 'Custo unitário — materiais', 'Custos', 'DIVIDIR(SOMA(Custos[Materiais]; Custos[Produzida] = "Sim"); SOMA(Custos[Unidades]; Custos[Produzida] = "Sim"))', 'moeda', 2, 'menor', 'Materiais ÷ unidades produzidas.'),
    I('custo_un_energia', 'Custo unitário — energia', 'Custos', 'DIVIDIR(SOMA(Custos[Energia]; Custos[Produzida] = "Sim"); SOMA(Custos[Unidades]; Custos[Produzida] = "Sim"))', 'moeda', 2, 'menor', 'Energia ÷ unidades produzidas.'),
    I('custo_un_mod', 'Custo unitário — mão de obra', 'Custos', 'DIVIDIR(SOMA(Custos[MOD]; Custos[Produzida] = "Sim"); SOMA(Custos[Unidades]; Custos[Produzida] = "Sim"))', 'moeda', 2, 'menor', 'Mão de obra ÷ unidades produzidas.'),
    I('custo_un_perdas', 'Custo unitário — perdas', 'Custos', 'DIVIDIR(SOMA(Custos[Perdas]; Custos[Produzida] = "Sim"); SOMA(Custos[Unidades]; Custos[Produzida] = "Sim"))', 'moeda', 2, 'menor', 'Perdas ÷ unidades produzidas.'),
    I('custo_total', 'Custo total das famílias produzidas', 'Custos', 'SOMA(Custos[Total]; Custos[Produzida] = "Sim")', 'moeda', 2, 'menor', 'Materiais + energia + mão de obra + perdas das famílias com produção.'),
    I('ciclo_real', 'Tempo de ciclo real', 'Produção', 'DIVIDIR(SOMA(Etapas[TempoReal]); SOMA(Etapas[ProduzidoOP]; Etapas[TempoReal] > 0))', 'num', 2, 'menor',
      'Minutos de máquina apontados ÷ quantidade produzida, só nas etapas com tempo real. Use por processo, máquina ou produto (unidades diferentes não se juntam).'),
    I('ciclo_padrao', 'Tempo de ciclo padrão', 'Produção', 'DIVIDIR(SOMA(Etapas[TempoPlanejado]); SOMA(Etapas[PlanejadoOP]))', 'num', 2, 'menor', 'Minutos do roteiro ÷ quantidade planejada da OP.'),
    I('cap_instalada_h', 'Capacidade instalada (h)', 'Produção', 'SOMA(Capacidade[HorasDisponiveis])', 'num', 1, 'maior', 'Horas disponíveis no calendário de capacidade das máquinas (Capacidade e Carga).'),
    I('cap_programada_h', 'Capacidade programada (h)', 'Produção', 'SOMA(Capacidade[HorasProgramadas])', 'num', 1, '', 'Horas de carga programada nas máquinas.'),
    I('cap_apontada_h', 'Horas em operação apontadas', 'Produção', 'SOMA(Capacidade[HorasApontadas])', 'num', 1, 'maior', 'Horas em operação apontadas (apontamento de tempo − paradas).'),
    I('utilizacao_programada', 'Utilização programada', 'Produção', 'DIVIDIR(SOMA(Capacidade[HorasProgramadas]); SOMA(Capacidade[HorasDisponiveis]))', 'pct', 1, 'maior', 'Horas programadas ÷ horas disponíveis.'),
    I('utilizacao_real', 'Utilização real', 'Produção', 'DIVIDIR(SOMA(Capacidade[HorasApontadas]); SOMA(Capacidade[HorasDisponiveis]))', 'pct', 1, 'maior', 'Horas em operação apontadas ÷ horas disponíveis.'),
    I('kwh_consumido', 'kWh consumidos na produção', 'Sustentabilidade', "SOMA('Energia das células'[ConsumidaKWh])", 'num', 2, 'menor', 'Energia das etapas (potência × tempo) das famílias com produção.'),
    I('kwh_gerado', 'kWh gerados (medidos)', 'Sustentabilidade', "SOMA('Energia das células'[MedidaKWh])", 'num', 3, 'maior', 'Energia medida no teste das células produzidas. Célula sem teste fica de fora (nunca a energia de projeto).'),
    I('kwh_razao', 'Energia gerada ÷ consumida', 'Sustentabilidade', 'DIVIDIR([kwh_gerado]; [kwh_consumido])', 'pct', 4, 'maior', 'kWh medidos nas células ÷ kWh consumidos para produzi-las.', ['kwh_gerado', 'kwh_consumido']),
    I('cobertura_testes', 'Células testadas', 'Sustentabilidade', "DIVIDIR(SOMA('Energia das células'[CelulasTestadas]); SOMA('Energia das células'[CelulasProduzidas]))", 'pct', 1, 'maior', 'Células com energia medida ÷ células produzidas.'),
    I('co2_por_celula', 'CO₂ por célula', 'Sustentabilidade', 'DIVIDIR(SOMA(CO₂[CO2Total]; CO₂[Produzida] = "Sim"); SOMA(CO₂[Unidades]; CO₂[Produzida] = "Sim"))', 'num', 2, 'menor', 'CO₂eq da família (materiais + perdas + energia) ÷ células produzidas.'),
    I('co2_total', 'CO₂ das famílias produzidas', 'Sustentabilidade', 'SOMA(CO₂[CO2Total]; CO₂[Produzida] = "Sim")', 'num', 2, 'menor', 'CO₂eq total das famílias com produção.'),
    I('paradas_min', 'Minutos parados', 'Produção', 'SOMA(Paradas[DuracaoMin])', 'num', 0, 'menor', 'Duração das paradas encerradas.'),
    I('paradas_np_min', 'Minutos parados não planejados', 'Produção', 'SOMA(Paradas[DuracaoMin]; Paradas[Planejada] = "Não")', 'num', 0, 'menor', 'Duração das paradas não planejadas encerradas.'),
    I('energia_media_celula', 'Energia medida média por célula', 'Engenharia', "MÉDIA('Testes das células'[EnergiaMedidaWh])", 'num', 2, 'maior', 'Média da energia de descarga medida (teste mais recente de cada célula).'),
    I('capacidade_media_celula', 'Capacidade medida média por célula', 'Engenharia', "MÉDIA('Testes das células'[CapacidadeMedidaAh])", 'num', 3, 'maior', 'Média da capacidade medida (teste mais recente de cada célula).'),
    I('energia_vs_nominal', 'Energia medida ÷ nominal', 'Engenharia', "DIVIDIR(SOMA('Testes das células'[EnergiaMedidaWh]); SOMA('Testes das células'[EnergiaNominalWh]; 'Testes das células'[EnergiaMedidaWh] > 0))", 'pct', 1, 'maior',
      'Energia medida ÷ energia nominal da estrutura, nas células testadas.')
  ];
  function indicadores() { return A((D() || {}).indicadores).filter(function (x) { return x && x.IdIndicador; }); }
  function podeEditar(ind) { return ind && (ind.Oficial === 'Sim' ? admin() : (ind.Dono === usuarioLogin() || admin())); }
  function visivel(ind) { return ind && (ind.Oficial === 'Sim' || ind.Compartilhado === 'Sim' || ind.Dono === usuarioLogin() || admin()); }
  /* oficiais que faltam na base entram uma vez (um indicador já alterado pelo administrador não é trocado) */
  function semear() {
    var d = D(); if (!d) return 0;
    if (!Array.isArray(d.indicadores)) d.indicadores = [];
    if (!Array.isArray(d.paineis)) d.paineis = [];
    if (!Array.isArray(d.paineis_fechamentos)) d.paineis_fechamentos = [];
    var n = 0;
    OFICIAIS.forEach(function (o) {
      if (d.indicadores.some(function (x) { return x && x.IdIndicador === o.id; })) return;
      d.indicadores.push({ IdIndicador: o.id, Nome: o.nome, Area: o.area, Descricao: o.desc, Formula: o.f, Formato: o.fmt, Casas: o.casas, Sentido: o.sentido, Meta: '', Oficial: 'Sim',
        Componentes: o.comp, Versao: 1, Historico: [{ Versao: 1, Nome: o.nome, Formula: o.f, Meta: '', Por: 'MES LION ' + VERSAO, Em: agora(), Nota: 'Indicador oficial padrão' }],
        CriadoEm: agora(), CriadoPor: 'MES LION ' + VERSAO, AtualizadoEm: agora(), AtualizadoPor: 'MES LION ' + VERSAO });
      n++;
    });
    return n;
  }
  /* salvar indicador (novo ou nova versão): valida a fórmula e as permissões */
  function salvarIndicador(dados, id) {
    var d = D(); semear();
    var atual = id ? indicadores().find(function (x) { return x.IdIndicador === id; }) : null;
    if (atual && !podeEditar(atual)) return { erro: atual.Oficial === 'Sim' ? 'Só o administrador altera indicadores oficiais.' : 'Só o dono altera este indicador.' };
    var oficial = atual ? atual.Oficial : (dados.Oficial === 'Sim' ? 'Sim' : 'Não');
    if (!atual && oficial === 'Sim' && !admin()) return { erro: 'Só o administrador cria indicadores oficiais.' };
    var nome = txt(dados.Nome); if (!nome) return { erro: 'Dê um nome ao indicador.' };
    if (indicadores().some(function (x) { return x !== atual && norm(x.Nome) === norm(nome) && (x.Oficial === 'Sim' || x.Dono === usuarioLogin()); })) return { erro: 'Já existe um indicador com esse nome.' };
    var c = compilar(dados.Formula);
    if (c.erro) return { erro: 'Fórmula: ' + c.erro };
    if (atual && c.info.todos[atual.IdIndicador]) return { erro: c.info.inds[atual.IdIndicador] ? 'O indicador não pode usar ele mesmo.' : 'Referência circular: a fórmula usa um indicador que depende deste (' + Object.keys(c.info.inds).map(function (k) { var x = indicadorPor(k); return x ? x.Nome : k; }).join(', ') + ').' };
    /* oficial só usa oficial (também nos sub-indicadores dos sub-indicadores): um pessoal pode mudar a qualquer hora e mudaria o número oficial */
    if (oficial === 'Sim') {
      var pessoais = Object.keys(c.info.todos).map(indicadorPor).filter(function (x) { return x && x.Oficial !== 'Sim'; });
      if (pessoais.length) return { erro: 'Um indicador oficial só pode usar indicadores oficiais (usa: ' + pessoais.map(function (x) { return x.Nome; }).join(', ') + ').' };
    }
    var meta = txt(dados.Meta) === '' ? '' : Number(String(dados.Meta).replace(',', '.'));
    if (meta !== '' && !isFinite(meta)) return { erro: 'Meta inválida.' };
    var formato = ['num', 'int', 'moeda', 'pct'].indexOf(dados.Formato) >= 0 ? dados.Formato : 'num';
    var casas = txt(dados.Casas) === '' ? '' : Math.max(0, Math.min(6, Math.round(N(dados.Casas))));
    /* sub-indicadores (o indicador "abre" neles): os escolhidos ou, sem escolha, os que a fórmula usa */
    var comps = Array.isArray(dados.Componentes) ? (dados.Componentes.length ? dados.Componentes : Object.keys(c.info.inds)) : (atual && A(atual.Componentes).length ? atual.Componentes : Object.keys(c.info.inds));
    comps = comps.filter(function (cid, i, l) { var x = indicadorPor(cid); return x && (!atual || x.IdIndicador !== atual.IdIndicador) && l.indexOf(cid) === i && (oficial !== 'Sim' || x.Oficial === 'Sim'); })
      .map(function (cid) { return indicadorPor(cid).IdIndicador; });
    var nomeAntigo = atual ? atual.Nome : '';
    var ind = atual;
    if (!ind) { ind = { IdIndicador: idNovo(oficial === 'Sim' ? 'IND' : 'MEU'), Oficial: oficial, Dono: oficial === 'Sim' ? '' : usuarioLogin(), Versao: 0, Historico: [], CriadoEm: agora(), CriadoPor: usuarioLogin() }; d.indicadores.push(ind); }
    var mudouRegra = !atual || atual.Formula !== txt(dados.Formula) || atual.Nome !== nome || String(atual.Meta) !== String(meta) || atual.Formato !== formato;
    Object.assign(ind, { Nome: nome, Area: AREAS.indexOf(txt(dados.Area)) >= 0 ? txt(dados.Area) : (txt(dados.Area) || 'Geral'), Descricao: txt(dados.Descricao), Formula: txt(dados.Formula), Formato: formato,
      Casas: casas, Sentido: dados.Sentido === 'maior' || dados.Sentido === 'menor' ? dados.Sentido : '', Meta: meta, Componentes: comps,
      Compartilhado: oficial === 'Sim' ? 'Sim' : (dados.Compartilhado === 'Sim' ? 'Sim' : (dados.Compartilhado === 'Não' ? 'Não' : (ind.Compartilhado || 'Não'))),
      AtualizadoEm: agora(), AtualizadoPor: usuarioLogin() });
    if (mudouRegra) { ind.Versao = N(ind.Versao) + 1; ind.Historico = A(ind.Historico).concat([{ Versao: ind.Versao, Nome: nome, Formula: ind.Formula, Meta: meta, Formato: formato, Por: usuarioLogin(), Em: agora(), Nota: txt(dados.Nota) || (atual ? '' : 'Criado') }]); }
    /* nome novo: as fórmulas que usam [nome antigo] passam a usar [nome novo] (a regra não muda, só o nome) */
    if (atual && nomeAntigo && norm(nomeAntigo) !== norm(nome)) trocarReferencias(nomeAntigo, nome, ind.IdIndicador);
    cacheAst = {};
    salvar();
    return { indicador: ind };
  }
  /* troca [antigo] por [novo] nas fórmulas dos indicadores e dos blocos dos painéis (só onde a referência aponta para este indicador) */
  function trocarNaFormula(f, antigo, novo) {
    var s = String(f || ''), tk; try { tk = tokenizar(s); } catch (e) { return s; }
    tk.filter(function (t) { return t.t === 'col' && norm(t.v) === norm(antigo); }).reverse().forEach(function (t) { var fim = s.indexOf(']', t.p); s = s.slice(0, t.p) + '[' + novo + ']' + s.slice(fim + 1); });
    return s;
  }
  function trocarReferencias(antigo, novo, id) {
    indicadores().forEach(function (x) { if (x.IdIndicador !== id && /\[/.test(x.Formula || '')) { var nf = trocarNaFormula(x.Formula, antigo, novo); if (nf !== x.Formula) x.Formula = nf; } });
    paineis().forEach(function (p) { A(p.Blocos).forEach(function (b) { A(b.valores).forEach(function (v) { if (v.formula) v.formula = trocarNaFormula(v.formula, antigo, novo); }); }); });
  }
  /* blocos de painel que usam o indicador (direto ou na fórmula) */
  function usoEmPaineis(id) {
    var out = [];
    paineis().forEach(function (p) {
      A(p.Blocos).forEach(function (b) {
        var usa = A(b.valores).some(function (v) { if (v.indicador) { var x = indicadorPor(v.indicador); return x && x.IdIndicador === id; } var c = v.formula ? compilar(v.formula) : null; return !!(c && c.info && c.info.inds[id]); });
        if (usa) out.push(p.Nome + ' › ' + tituloBloco(b));
      });
    });
    return out;
  }
  function excluirIndicador(id) {
    var ind = indicadores().find(function (x) { return x.IdIndicador === id; });
    if (!ind) return { erro: 'Indicador não encontrado.' };
    if (!podeEditar(ind)) return { erro: 'Sem permissão.' };
    var usadoEm = indicadores().filter(function (x) { if (x === ind) return false; var c = compilar(x.Formula); return (c.info && c.info.inds[id]) || A(x.Componentes).indexOf(id) >= 0; }).map(function (x) { return x.Nome; });
    if (usadoEm.length) return { erro: 'Usado nos indicadores: ' + usadoEm.join(', ') + '.' };
    var nosPaineis = usoEmPaineis(id);
    if (nosPaineis.length) return { erro: 'Usado nos painéis: ' + nosPaineis.join('; ') + '. Tire dos blocos antes de excluir.' };
    var d = D(); d.indicadores = d.indicadores.filter(function (x) { return x !== ind; }); cacheAst = {}; salvar();
    return { ok: true };
  }

  /* ---------------------------------------------------------------------
     6) PAINÉIS: dados, modelos por área e fechamento do mês
     --------------------------------------------------------------------- */
  var AREAS = ['Produção', 'Qualidade', 'Custos', 'Sustentabilidade', 'Engenharia', 'Diretoria', 'Geral'];
  var VISUAIS = [['cartao', 'Cartão'], ['colunas', 'Colunas'], ['empilhadas', 'Colunas empilhadas'], ['barras', 'Barras'], ['linhas', 'Linhas'], ['combinado', 'Barras + linha'],
    ['pizza', 'Pizza'], ['medidor', 'Medidor'], ['tabela', 'Tabela'], ['matriz', 'Matriz'], ['dispersao', 'Dispersão']];
  function dim(k) { return { tipo: 'dim', dim: k }; }
  function cmp(t, c) { return { tipo: 'campo', tabela: t, campo: c }; }
  function vI(id, extra) { var o = { indicador: id }; if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); return o; }
  function vF(nome, formula, formato, casas) { return { nome: nome, formula: formula, formato: formato || 'num', casas: casas }; }
  function B(titulo, visual, x, y, w, h, o) { var b = { id: idNovo('BL'), titulo: titulo, visual: visual, x: x, y: y, w: w, h: h, eixo: null, legenda: null, valores: [], filtros: [] }; Object.keys(o || {}).forEach(function (k) { b[k] = o[k]; }); return b; }
  function modelos() {
    var cards = function (ids, y) { var w = Math.floor(12 / ids.length); return ids.map(function (id, i) { return B(null, 'cartao', i * w, y, i === ids.length - 1 ? 12 - i * w : w, 1, { valores: [vI(id)] }); }); };
    return [
      { Nome: 'Produção', Area: 'Produção', Blocos: cards(['producao_celulas', 'oee', 'disponibilidade', 'performance', 'qualidade'], 0).concat([
        B('Células produzidas por mês e modelo', 'empilhadas', 0, 1, 6, 3, { eixo: dim('mes'), legenda: dim('modelo'), valores: [vI('producao_celulas')] }),
        B('Células produzidas por mês e química', 'empilhadas', 6, 1, 6, 3, { eixo: dim('mes'), legenda: dim('quimica'), valores: [vI('producao_celulas')] }),
        B('OEE por equipamento', 'colunas', 0, 4, 12, 3, { eixo: dim('equipamento'), valores: [vI('disponibilidade'), vI('performance'), vI('qualidade'), vI('oee')], ordem: 'eixo' }),
        B('Tempo de ciclo real × padrão por processo', 'barras', 0, 7, 6, 3, { eixo: dim('processo'), valores: [vI('ciclo_real'), vI('ciclo_padrao')] }),
        B('Utilização da capacidade por mês', 'linhas', 6, 7, 6, 3, { eixo: dim('mes'), valores: [vI('utilizacao_programada'), vI('utilizacao_real')] }),
        B('Capacidade instalada × programada × apontada (h)', 'colunas', 0, 10, 12, 3, { eixo: dim('equipamento'), valores: [vI('cap_instalada_h'), vI('cap_programada_h'), vI('cap_apontada_h')], ordem: 'valor_desc', topN: 15 })]) },
      { Nome: 'Qualidade', Area: 'Qualidade', Blocos: cards(['rejeito_celulas', 'qualidade', 'perdas_rs', 'perdas_sobre_custo'], 0).concat([
        B('Taxa de rejeito de células por mês', 'linhas', 0, 1, 6, 3, { eixo: dim('mes'), valores: [vI('rejeito_celulas')] }),
        B('Perdas por motivo (R$) — Pareto', 'barras', 6, 1, 6, 3, { eixo: cmp('perdas', 'Motivo'), valores: [vI('perdas_rs')], ordem: 'valor_desc' }),
        B('Perda de material por material', 'barras', 0, 4, 6, 3, { eixo: dim('material'), valores: [vI('perda_material')], ordem: 'valor_desc' }),
        B('Paradas por motivo (min) — Pareto', 'barras', 6, 4, 6, 3, { eixo: cmp('paradas', 'Motivo'), valores: [vI('paradas_min')], ordem: 'valor_desc' }),
        B('Rejeito por produto', 'tabela', 0, 7, 12, 3, { eixo: dim('produto'), valores: [vI('producao_apontada'), vI('rejeito_produto')] })]) },
      { Nome: 'Custos', Area: 'Custos', Blocos: cards(['custo_unitario', 'custo_total', 'perdas_sobre_custo'], 0).concat([
        B('Composição do custo unitário por família', 'empilhadas', 0, 1, 7, 3, { eixo: dim('familia'), valores: [vI('custo_un_materiais'), vI('custo_un_energia'), vI('custo_un_mod'), vI('custo_un_perdas')] }),
        B('Custo unitário por mês', 'linhas', 7, 1, 5, 3, { eixo: dim('mes'), valores: [vI('custo_unitario')] }),
        B('Custo por família', 'tabela', 0, 4, 12, 3, { eixo: dim('familia'), valores: [vF('Custo total calculado', 'SOMA(Custos[Total])', 'moeda', 2), vF('Unidades produzidas', 'SOMA(Custos[Unidades])', 'num', 0),
          vI('custo_unitario'), vI('custo_un_materiais'), vI('custo_un_energia'), vI('custo_un_mod'), vI('custo_un_perdas')] })]) },
      { Nome: 'Sustentabilidade', Area: 'Sustentabilidade', Blocos: cards(['kwh_consumido', 'kwh_gerado', 'kwh_razao', 'cobertura_testes', 'co2_por_celula'], 0).concat([
        B('kWh consumidos × gerados (acumulado por mês)', 'combinado', 0, 1, 8, 3, { eixo: dim('mes'), valores: [vI('kwh_consumido', { acumulado: true }), vI('kwh_gerado', { acumulado: true })] }),
        B('CO₂ por célula por família', 'colunas', 8, 1, 4, 3, { eixo: dim('familia'), valores: [vI('co2_por_celula')] }),
        B('CO₂ por origem e família', 'empilhadas', 0, 4, 12, 3, { eixo: dim('familia'), valores: [vF('Materiais', 'SOMA(CO₂[CO2Materiais]; CO₂[Produzida] = "Sim")', 'num', 2),
          vF('Perdas', 'SOMA(CO₂[CO2Perdas]; CO₂[Produzida] = "Sim")', 'num', 2), vF('Energia', 'SOMA(CO₂[CO2Energia]; CO₂[Produzida] = "Sim")', 'num', 2)] })]) },
      { Nome: 'Engenharia / P&D', Area: 'Engenharia', Blocos: cards(['energia_media_celula', 'capacidade_media_celula', 'energia_vs_nominal', 'cobertura_testes'], 0).concat([
        B('Energia medida × nominal por modelo (Wh)', 'colunas', 0, 1, 6, 3, { eixo: dim('modelo'), valores: [vI('energia_media_celula'), vF('Energia nominal média', "MÉDIA('Testes das células'[EnergiaNominalWh])", 'num', 2)] }),
        B('Testes por OP', 'tabela', 6, 1, 6, 3, { eixo: dim('op'), valores: [vF('Células testadas', "CONTAR('Testes das células')", 'int', 0), vI('energia_media_celula'), vI('capacidade_media_celula')] })]) },
      { Nome: 'Diretoria', Area: 'Diretoria', Blocos: cards(['producao_celulas', 'oee', 'custo_unitario'], 0).concat(cards(['rejeito_celulas', 'co2_por_celula', 'kwh_razao'], 1)).concat([
        B('Células produzidas por mês', 'colunas', 0, 2, 6, 3, { eixo: dim('mes'), valores: [vI('producao_celulas')] }),
        B('kWh consumidos × gerados (acumulado)', 'combinado', 6, 2, 6, 3, { eixo: dim('mes'), valores: [vI('kwh_consumido', { acumulado: true }), vI('kwh_gerado', { acumulado: true })] })]) }
    ];
  }
  function paineis() { return A((D() || {}).paineis).filter(function (p) { return p && p.IdPainel; }); }
  function painelVisivel(p) { return p.Compartilhado === 'Sim' || p.Dono === usuarioLogin() || admin(); }
  function podeEditarPainel(p) { return p && (p.Dono === usuarioLogin() || admin()); }
  function criarPainel(nome, area, blocos, compart) {
    var d = D(); semear();
    var p = { IdPainel: idNovo('PNL'), Nome: txt(nome) || 'Painel', Area: area || 'Geral', Dono: usuarioLogin(), Compartilhado: compart === 'Não' ? 'Não' : 'Sim', Blocos: blocos || [],
      Filtros: { periodo: {}, filtros: [] }, CriadoEm: agora(), CriadoPor: usuarioLogin(), AtualizadoEm: agora(), AtualizadoPor: usuarioLogin() };
    d.paineis.push(p); salvar(); return p;
  }
  function criarModelos() {
    var feitos = [];
    modelos().forEach(function (m) { if (!paineis().some(function (p) { return p.Modelo === m.Nome; })) { var p = criarPainel(m.Nome, m.Area, m.Blocos, 'Sim'); p.Modelo = m.Nome; feitos.push(p); } });
    salvar(); return feitos;
  }
  function painelPor(id) { return paineis().find(function (p) { return p.IdPainel === id; }) || null; }
  /* fechamento do mês: grava o valor de cada indicador oficial no mês (o número não muda depois, mesmo se alguém corrigir um apontamento antigo) */
  function fecharMes(mes) {
    if (!admin()) return { erro: 'Só o administrador fecha o mês.' };
    if (!/^\d{4}-\d{2}$/.test(mes)) return { erro: 'Mês inválido (AAAA-MM).' };
    if (mes >= mesDe(new Date())) return { erro: 'Só fecha mês que já terminou.' };
    var d = D(); semear(); novaSessao();
    var oficiais = indicadores().filter(function (i) { return i.Oficial === 'Sim'; });
    /* calcula tudo protegido (nada dos módulos muda) e só depois grava o fechamento */
    var valores = protegido(function () {
      return oficiais.map(function (ind) {
        var r = executar({ valores: [{ indicador: ind.IdIndicador }], periodoProprio: true, periodo: { de: mes, ate: mes } }, {}), g = r.geral[0] || {};
        return { Mes: mes, IdIndicador: ind.IdIndicador, Nome: ind.Nome, Valor: typeof g.v === 'number' ? g.v : '', Unidade: g.u || '', Situacao: g.erro ? 'erro: ' + g.erro : (g.semRelacao ? 'não se relaciona' : (g.v == null ? 'faltam dados' + (g.nota ? ' (' + g.nota + ')' : '') : 'ok')),
          Formula: ind.Formula, Versao: ind.Versao, Cobertura: r.cobertura.join('; '), FechadoPor: usuarioLogin(), FechadoEm: agora() };
      });
    });
    d.paineis_fechamentos = A(d.paineis_fechamentos).filter(function (x) { return x.Mes !== mes; }).concat(valores);
    salvar();
    return { feitos: valores.length };
  }
  function fechado(mes, id) { return A((D() || {}).paineis_fechamentos).find(function (x) { return x.Mes === mes && x.IdIndicador === id; }) || null; }

  /* ---------------------------------------------------------------------
     7) VISUAIS (SVG desenhado pelo próprio MES, sem biblioteca e sem internet)
     --------------------------------------------------------------------- */
  var CORES = ['#004b87', '#69ad2c', '#d0621b', '#7b4ea3', '#00838f', '#c62828', '#8d6e63', '#546e7a', '#f9a825', '#2e7d32', '#ad1457', '#3949ab'];
  function cor(i) { return CORES[i % CORES.length]; }
  function numero(r) { return r && typeof r.v === 'number' && isFinite(r.v) ? r.v : null; }
  function series(res) {
    var out = [], multi = res.valores.length > 1;
    res.valores.forEach(function (v, vi) {
      res.legendas.forEach(function (lg) {
        out.push({ vi: vi, lg: lg, nome: lg == null ? v.nome : (res.rotLeg(lg) + (multi ? ' · ' + v.nome : '')), v: v,
          pontos: res.eixo.map(function (e) { return res.celulas[vi][chaveGrupo(e, lg)] || null; }) });
      });
    });
    out.forEach(function (s, i) { s.cor = cor(i); });
    return out;
  }
  function escala(min, max, n) {
    if (min === max) { if (min === 0) { max = 1; } else if (min > 0) { min = 0; } else { max = 0; } }
    var passo = Math.pow(10, Math.floor(Math.log10((max - min) / (n || 5)))), err = (max - min) / (n || 5) / passo;
    passo *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var a = Math.floor(min / passo) * passo, b = Math.ceil(max / passo) * passo, t = [];
    for (var x = a; x <= b + passo / 2; x += passo) t.push(arred(x, 10));
    return { min: a, max: b, ticks: t };
  }
  function rotCurto(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function svgAbre(w, h, extra) { return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" class="mpn-svg" ' + (extra || '') + '>'; }
  function TX(x, y, s, o) { o = o || {}; return '<text x="' + arred(x, 1) + '" y="' + arred(y, 1) + '" font-size="' + (o.fs || 11) + '" fill="' + (o.cor || '#355566') + '"' + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + (o.peso ? ' font-weight="' + o.peso + '"' : '') + (o.rot ? ' transform="rotate(' + o.rot + ' ' + arred(x, 1) + ' ' + arred(y, 1) + ')"' : '') + '>' + esc(s) + '</text>'; }
  function legendaHTML(ss) {
    if (ss.length < 2) return '';
    return '<div class="mpn-leg">' + ss.map(function (s) { return '<span><i style="background:' + s.cor + '"></i>' + esc(s.nome) + '</span>'; }).join('') + '</div>';
  }
  function fmtEixo(v, s0) { return s0 ? formatar(v, s0.v.formato === 'moeda' ? 'num' : s0.v.formato, s0.v.formato === 'pct' ? 0 : (Math.abs(v) >= 100 ? 0 : 2), '') : fmtNum(v, 2); }
  /* colunas, empilhadas, barras, linhas e combinado */
  function grafico(res, b, w, h, tipo) {
    var ss = series(res), cats = res.eixo, nc = cats.length;
    if (!nc || !ss.length) return '<div class="mpn-vazio">Sem dados para o gráfico.</div>';
    var empil = tipo === 'empilhadas', horiz = tipo === 'barras', comb = tipo === 'combinado', linhas = tipo === 'linhas';
    var porU = {}; ss.forEach(function (s) { var u = s.v.formato === 'pct' ? '%' : (s.pontos.find(function (p) { return p && p.u; }) || {}).u || ''; s.u = u; porU[u] = 1; });
    var us = Object.keys(porU), todas = unidadesDe(ss), rotU = esc(todas.map(function (u) { return u || 'sem unidade'; }).join(', '));
    if (empil && todas.length > 1) return '<div class="mpn-vazio">Colunas empilhadas não somam unidades diferentes (' + rotU + '). Use colunas lado a lado, "Barras + linha" ou um bloco para cada valor.</div>';
    var avisoU = todas.length > 1 && !(comb && todas.length === 2 && ss.every(function (s) { return unidadesDe([s]).length <= 1; })) ?
      '<div class="mpn-msg alerta" style="font-size:10.5px;margin:2px 0 0">Unidades diferentes no mesmo eixo (' + rotU + '): cada ponto vale na sua unidade (passe o mouse para ver); não compare o tamanho entre unidades diferentes.</div>' : '';
    var dois = comb && us.length > 1, sEsq = ss.filter(function (s, i) { return !dois || (comb ? i === 0 || s.u === ss[0].u : true); }), sDir = dois ? ss.filter(function (s) { return sEsq.indexOf(s) < 0; }) : [];
    function faixa(lst, soma) {
      var mn = 0, mx = 0, tem = false;
      if (soma) cats.forEach(function (c, ci) { var p = 0, n = 0; lst.forEach(function (s) { var v = numero(s.pontos[ci]); if (v == null) return; tem = true; if (v >= 0) p += v; else n += v; }); mx = Math.max(mx, p); mn = Math.min(mn, n); });
      else lst.forEach(function (s) { s.pontos.forEach(function (p) { var v = numero(p); if (v == null) return; tem = true; mx = Math.max(mx, v); mn = Math.min(mn, v); }); });
      return tem ? escala(mn, mx, 5) : null;
    }
    var eE = faixa(comb ? sEsq : ss, empil), eD = sDir.length ? faixa(sDir, false) : null;
    if (!eE && !eD) return '<div class="mpn-vazio">Faltam dados para o gráfico.</div>';
    eE = eE || escala(0, 1, 5);
    var lbl = cats.map(function (c) { return res.rotEixo(c); }), maxLbl = Math.max.apply(null, lbl.map(function (l) { return l.length; }));
    var mL = horiz ? Math.min(170, Math.max(60, maxLbl * 6.2)) : 54, mR = eD ? 54 : (horiz ? 30 : 12), mT = 10, gira = !horiz && nc > 6 && maxLbl > 6, mB = horiz ? 26 : (gira ? Math.min(90, 20 + maxLbl * 4.5) : 30);
    var W = Math.max(120, w - mL - mR), H = Math.max(60, h - mT - mB), s = svgAbre(w, h);
    function y(v, e) { return mT + H - (v - e.min) / (e.max - e.min) * H; }
    function x(v, e) { return mL + (v - e.min) / (e.max - e.min) * W; }
    /* grade e eixos */
    eE.ticks.forEach(function (t) {
      if (horiz) { var xx = x(t, eE); s += '<line x1="' + xx + '" y1="' + mT + '" x2="' + xx + '" y2="' + (mT + H) + '" stroke="#e3eaf0"/>' + TX(xx, mT + H + 16, fmtEixo(t, ss[0]), { anchor: 'middle', fs: 10 }); }
      else { var yy = y(t, eE); s += '<line x1="' + mL + '" y1="' + yy + '" x2="' + (mL + W) + '" y2="' + yy + '" stroke="#e3eaf0"/>' + TX(mL - 6, yy + 3.5, fmtEixo(t, comb ? ss[0] : ss[0]), { anchor: 'end', fs: 10 }); }
    });
    if (eD) eD.ticks.forEach(function (t) { var yy = y(t, eD); s += TX(mL + W + 6, yy + 3.5, fmtEixo(t, sDir[0]), { fs: 10, cor: sDir[0].cor }); });
    var banda = (horiz ? H : W) / nc;
    var barrasSeries = linhas ? [] : (comb ? [ss[0]] : ss), linhasSeries = linhas ? ss : (comb ? ss.slice(1) : []);
    var zeroE = horiz ? x(Math.max(eE.min, Math.min(0, eE.max)), eE) : y(Math.max(eE.min, Math.min(0, eE.max)), eE);
    cats.forEach(function (c, ci) {
      var base = (horiz ? mT : mL) + ci * banda, acP = 0, acN = 0, nb = empil ? 1 : barrasSeries.length, bw = Math.max(2, banda * 0.72 / Math.max(1, nb)), off = banda * 0.14;
      barrasSeries.forEach(function (sr, si) {
        var p = sr.pontos[ci], v = numero(p); if (v == null) return;
        var e = eE, a, bb;
        if (empil) { if (v >= 0) { a = acP; bb = acP + v; acP = bb; } else { a = acN; bb = acN + v; acN = bb; } } else { a = 0; bb = v; }
        var dica = res.rotEixo(c) + ' · ' + sr.nome + ': ' + formatar(v, sr.v.formato, sr.v.casas, p.u);
        var clique = ' data-b="' + esc(b.id) + '" data-x="' + ci + '" data-s="' + ss.indexOf(sr) + '" class="mpn-alvo"';
        if (horiz) {
          var x1 = x(Math.max(eE.min, Math.min(a, bb)), e), x2 = x(Math.min(eE.max, Math.max(a, bb)), e), yy0 = base + off + (empil ? 0 : si * bw);
          s += '<rect x="' + arred(x1, 1) + '" y="' + arred(yy0, 1) + '" width="' + arred(Math.max(1, x2 - x1), 1) + '" height="' + arred(empil ? banda * 0.72 : bw, 1) + '" fill="' + sr.cor + '"' + clique + '><title>' + esc(dica) + '</title></rect>';
          if (!empil && barrasSeries.length === 1 && nc <= 14) s += TX(x2 + 4, yy0 + bw / 2 + 3.5, formatar(v, sr.v.formato, sr.v.casas, ''), { fs: 10 });
        } else {
          var y1 = y(Math.min(eE.max, Math.max(a, bb)), e), y2 = y(Math.max(eE.min, Math.min(a, bb)), e), xx0 = base + off + (empil ? 0 : si * bw);
          s += '<rect x="' + arred(xx0, 1) + '" y="' + arred(y1, 1) + '" width="' + arred(empil ? banda * 0.72 : bw, 1) + '" height="' + arred(Math.max(1, y2 - y1), 1) + '" fill="' + sr.cor + '"' + clique + '><title>' + esc(dica) + '</title></rect>';
          if (!empil && barrasSeries.length === 1 && nc <= 12) s += TX(xx0 + bw / 2, y1 - 3, formatar(v, sr.v.formato, sr.v.casas, ''), { anchor: 'middle', fs: 10 });
        }
      });
      var cx = (horiz ? mT : mL) + ci * banda + banda / 2;
      if (horiz) s += TX(mL - 6, cx + 3.5, rotCurto(lbl[ci], 28), { anchor: 'end', fs: 10.5 });
      else s += gira ? TX(cx, mT + H + 12, rotCurto(lbl[ci], 18), { anchor: 'end', fs: 10, rot: -40 }) : TX(cx, mT + H + 16, rotCurto(lbl[ci], Math.max(4, Math.floor(banda / 6))), { anchor: 'middle', fs: 10.5 });
    });
    linhasSeries.forEach(function (sr) {
      var e = (dois && sDir.indexOf(sr) >= 0) ? eD : eE, pts = [], trecho = '';
      sr.pontos.forEach(function (p, ci) {
        var v = numero(p), cx = mL + ci * banda + banda / 2;
        if (v == null) { if (trecho) { pts.push(trecho); trecho = ''; } return; }
        var yy = y(v, e); trecho += (trecho ? ' L' : 'M') + arred(cx, 1) + ' ' + arred(yy, 1);
        s += '<circle cx="' + arred(cx, 1) + '" cy="' + arred(yy, 1) + '" r="3.5" fill="' + sr.cor + '" data-b="' + esc(b.id) + '" data-x="' + ci + '" data-s="' + ss.indexOf(sr) + '" class="mpn-alvo"><title>' + esc(res.rotEixo(cats[ci]) + ' · ' + sr.nome + ': ' + formatar(v, sr.v.formato, sr.v.casas, p.u)) + '</title></circle>';
      });
      if (trecho) pts.push(trecho);
      s = s.replace(/(<svg[^>]*>)/, '$1') + pts.map(function (d) { return '<path d="' + d + '" fill="none" stroke="' + sr.cor + '" stroke-width="2.2"/>'; }).join('');
    });
    s += '<line x1="' + (horiz ? zeroE : mL) + '" y1="' + (horiz ? mT : zeroE) + '" x2="' + (horiz ? zeroE : mL + W) + '" y2="' + (horiz ? mT + H : zeroE) + '" stroke="#8aa0b2"/>';
    return s + '</svg>' + legendaHTML(ss) + avisoU;
  }
  function pizza(res, b, w, h) {
    var s0 = series(res)[0]; if (!s0) return '<div class="mpn-vazio">Sem dados.</div>';
    var itens = res.eixo.map(function (c, ci) { return { c: c, ci: ci, v: numero(s0.pontos[ci]) }; }).filter(function (x) { return x.v != null && x.v > 0; });
    var tot = itens.reduce(function (a, x) { return a + x.v; }, 0);
    if (!tot) return '<div class="mpn-vazio">Faltam dados (sem valores positivos).</div>';
    var r = Math.max(30, Math.min(h - 16, w * 0.45) / 2), cx = r + 8, cy = h / 2, a0 = -Math.PI / 2, s = svgAbre(Math.min(w, 2 * r + 16), h);
    itens.forEach(function (x, i) {
      var a1 = a0 + x.v / tot * Math.PI * 2, grande = a1 - a0 > Math.PI ? 1 : 0;
      var p = itens.length === 1 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + cor(i) + '"' : '<path d="M' + cx + ' ' + cy + ' L' + arred(cx + r * Math.cos(a0), 2) + ' ' + arred(cy + r * Math.sin(a0), 2) + ' A' + r + ' ' + r + ' 0 ' + grande + ' 1 ' + arred(cx + r * Math.cos(a1), 2) + ' ' + arred(cy + r * Math.sin(a1), 2) + ' Z" fill="' + cor(i) + '"';
      s += p + ' data-b="' + esc(b.id) + '" data-x="' + x.ci + '" data-s="0" class="mpn-alvo"><title>' + esc(res.rotEixo(x.c) + ': ' + formatar(x.v, s0.v.formato, s0.v.casas, (s0.pontos[x.ci] || {}).u) + ' (' + fmtNum(x.v / tot * 100, 1) + '%)') + '</title>' + (itens.length === 1 ? '</circle>' : '</path>');
      x.a = a1; a0 = a1;
    });
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + arred(r * 0.55, 1) + '" fill="#fff"/>' + TX(cx, cy + 4, formatar(tot, s0.v.formato, s0.v.casas, ''), { anchor: 'middle', fs: 12, peso: 700, cor: '#0b3a5c' }) + '</svg>';
    var leg = '<div class="mpn-leg mpn-leg-col">' + itens.map(function (x, i) { return '<span><i style="background:' + cor(i) + '"></i>' + esc(rotCurto(res.rotEixo(x.c), 34)) + ' — ' + fmtNum(x.v / tot * 100, 1) + '%</span>'; }).join('') + '</div>';
    return '<div class="mpn-pizza">' + s + leg + '</div>';
  }
  function metaDe(b, v) { var ind = v.ind; var m = b.meta !== undefined && b.meta !== '' && b.meta !== null ? N(b.meta) : (ind && ind.Meta !== '' && ind.Meta != null ? N(ind.Meta) : null); return { meta: m, sentido: b.sentido || (ind && ind.Sentido) || '' }; }
  function semaforo(v, m) {
    if (v == null || m.meta == null || !m.sentido) return '';
    if (m.sentido === 'maior') return v >= m.meta ? 'verde' : (v >= m.meta * 0.9 ? 'amarelo' : 'vermelho');
    return v <= m.meta ? 'verde' : (v <= m.meta * 1.1 ? 'amarelo' : 'vermelho');
  }
  function medidor(res, b, w, h) {
    var v0 = res.valores[0], r0 = res.geral[0] || {}, v = numero(r0), m = metaDe(b, v0), pct = v0.formato === 'pct';
    var max = pct ? Math.max(1, v || 0, m.meta || 0) : Math.max(v || 0, (m.meta || 0) * 1.25, 1) * (pct ? 1 : 1.2);
    var r = Math.max(30, Math.min(w / 2 - 12, h - 36)), cx = w / 2, cy = r + 12, s = svgAbre(w, h);
    function pt(f) { var a = Math.PI * (1 - Math.max(0, Math.min(1, f))); return [arred(cx + r * Math.cos(a), 2), arred(cy - r * Math.sin(a), 2)]; }
    var p0 = pt(0), p1 = pt(1);
    s += '<path d="M' + p0[0] + ' ' + p0[1] + ' A' + r + ' ' + r + ' 0 0 1 ' + p1[0] + ' ' + p1[1] + '" fill="none" stroke="#e3eaf0" stroke-width="' + arred(r * 0.22, 1) + '"/>';
    if (v != null) { var pv = pt(v / max), corV = { verde: '#2e7d32', amarelo: '#f9a825', vermelho: '#c62828' }[semaforo(v, m)] || '#004b87'; s += '<path d="M' + p0[0] + ' ' + p0[1] + ' A' + r + ' ' + r + ' 0 0 1 ' + pv[0] + ' ' + pv[1] + '" fill="none" stroke="' + corV + '" stroke-width="' + arred(r * 0.22, 1) + '"/>'; }
    if (m.meta != null) { var pm = pt(m.meta / max); s += '<circle cx="' + pm[0] + '" cy="' + pm[1] + '" r="5" fill="#0b3a5c"><title>Meta: ' + esc(formatar(m.meta, v0.formato, v0.casas, '')) + '</title></circle>'; }
    s += TX(cx, cy - 4, v == null ? 'faltam dados' : formatar(v, v0.formato, v0.casas, r0.u), { anchor: 'middle', fs: v == null ? 12 : 18, peso: 700, cor: v == null ? '#8a99a6' : '#0b3a5c' });
    s += TX(p0[0], cy + 14, formatar(0, v0.formato, 0, ''), { anchor: 'middle', fs: 10 }) + TX(p1[0], cy + 14, formatar(max, v0.formato, 0, ''), { anchor: 'middle', fs: 10 });
    return s + '</svg>';
  }
  function cartao(res, b) {
    var v0 = res.valores[0]; if (!v0) return '<div class="mpn-vazio">Sem valor.</div>';
    var r0 = res.geral[0] || {}, v = numero(r0), m = metaDe(b, v0), sem = semaforo(v, m), nome = txt(b.titulo) || v0.nome;
    var h = '<div class="mpn-cartao ' + sem + '"><div class="mpn-cartao-nome" title="' + esc(nome) + '">' + esc(nome) + '</div>' +
      '<div class="mpn-cartao-valor" data-b="' + esc(b.id) + '" data-x="-1" data-s="0">' + (r0.erro ? '<span class="mpn-erro">erro</span>' : r0.semRelacao ? '<span class="mpn-falta">não se relaciona</span>' : v == null ? '<span class="mpn-falta">faltam dados</span>' : esc(formatar(v, v0.formato, v0.casas, r0.u))) + '</div>' +
      (m.meta != null ? '<div class="mpn-cartao-meta">Meta ' + (m.sentido === 'menor' ? '≤ ' : m.sentido === 'maior' ? '≥ ' : '') + esc(formatar(m.meta, v0.formato, v0.casas, '')) + '</div>' : '') +
      (r0.erro ? '<div class="mpn-cartao-nota">' + esc(r0.erro) + '</div>' : r0.semRelacao ? '<div class="mpn-cartao-nota">' + esc(r0.semRelacao) + '</div>' : (v == null && r0.nota ? '<div class="mpn-cartao-nota">' + esc(r0.nota) + '</div>' : ''));
    var per = res.consulta.periodo || {};
    if (v0.ind && per.de && per.de === per.ate) { var f = fechado(per.de, v0.ind.IdIndicador); if (f) h += '<div class="mpn-cartao-nota">Mês fechado em ' + esc(f.FechadoEm) + ': ' + esc(f.Valor === '' ? f.Situacao : formatar(N(f.Valor), v0.formato, v0.casas, f.Unidade)) + (typeof f.Valor === 'number' && v != null && Math.abs(f.Valor - v) > 1e-9 ? ' (hoje: ' + esc(formatar(v, v0.formato, v0.casas, r0.u)) + ')' : '') + '</div>'; }
    var comps = v0.ind ? A(v0.ind.Componentes).map(indicadorPor).filter(Boolean) : [];
    if (comps.length) h += '<div class="mpn-comp"><a href="javascript:void(0)" onclick="mesPainelComponentes(\'' + jsStr(b.id) + '\',0)" title="' + esc(comps.map(function (c) { return c.Nome; }).join(', ')) + '">↳ abrir em ' + esc(comps.map(function (c) { return c.Nome; }).join(', ')) + '</a></div>';
    return h + '</div>';
  }
  function tabelaHTML(res, b) {
    var cab = '<th>' + esc(rotuloAlvo(res.consulta.eixo) || 'Total') + '</th>' + (res.consulta.legenda ? '<th>' + esc(rotuloAlvo(res.consulta.legenda)) + '</th>' : '') + res.valores.map(function (v) { return '<th>' + esc(v.nome) + '</th>'; }).join('');
    var linhas = [];
    res.eixo.forEach(function (e, ci) {
      res.legendas.forEach(function (lg) {
        linhas.push('<tr><td>' + esc(res.rotEixo(e)) + '</td>' + (res.consulta.legenda ? '<td>' + esc(res.rotLeg(lg)) + '</td>' : '') + res.valores.map(function (v, vi) {
          var r = res.celulas[vi][chaveGrupo(e, lg)];
          return '<td class="mpn-num mpn-alvo" data-b="' + esc(b.id) + '" data-x="' + ci + '" data-l="' + esc(lg == null ? '' : lg) + '" data-v="' + vi + '">' + esc(textoCurto(r, v)) + '</td>';
        }).join('') + '</tr>');
      });
    });
    if (res.consulta.eixo) linhas.push('<tr class="mpn-total"><td>Total</td>' + (res.consulta.legenda ? '<td></td>' : '') + res.valores.map(function (v, vi) { return '<td class="mpn-num mpn-alvo" data-b="' + esc(b.id) + '" data-x="-1" data-v="' + vi + '">' + esc(textoCurto(res.geral[vi], v)) + '</td>'; }).join('') + '</tr>');
    return '<div class="mpn-tab"><table><thead><tr>' + cab + '</tr></thead><tbody>' + linhas.join('') + '</tbody></table></div>';
  }
  function textoCurto(r, v) { if (!r) return '—'; if (r.erro) return 'erro'; if (r.semRelacao) return 'não se relaciona'; if (r.v == null) return '—'; return formatar(r.v, v.formato, v.casas, r.u); }
  function matrizHTML(res, b) {
    var v = res.valores[0]; if (!v) return '<div class="mpn-vazio">Sem valor.</div>';
    if (!res.consulta.legenda) return tabelaHTML(res, b);
    var cab = '<th>' + esc(rotuloAlvo(res.consulta.eixo)) + ' \\ ' + esc(rotuloAlvo(res.consulta.legenda)) + '</th>' + res.legendas.map(function (lg) { return '<th>' + esc(res.rotLeg(lg)) + '</th>'; }).join('') + '<th>Total</th>';
    var linhas = res.eixo.map(function (e, ci) {
      var tot = executarParcial(res, 0, e, null);
      return '<tr><td>' + esc(res.rotEixo(e)) + '</td>' + res.legendas.map(function (lg) { return '<td class="mpn-num mpn-alvo" data-b="' + esc(b.id) + '" data-x="' + ci + '" data-l="' + esc(lg == null ? '' : lg) + '" data-v="0">' + esc(textoCurto(res.celulas[0][chaveGrupo(e, lg)], v)) + '</td>'; }).join('') +
        '<td class="mpn-num"><b>' + esc(textoCurto(tot, v)) + '</b></td></tr>';
    });
    linhas.push('<tr class="mpn-total"><td>Total</td>' + res.legendas.map(function (lg) { return '<td class="mpn-num">' + esc(textoCurto(res.totais[0][lg], v)) + '</td>'; }).join('') + '<td class="mpn-num"><b>' + esc(textoCurto(res.geral[0], v)) + '</b></td></tr>');
    return '<div class="mpn-tab"><table><thead><tr>' + cab + '</tr></thead><tbody>' + linhas.join('') + '</tbody></table></div>';
  }
  /* total de um ponto do eixo somando todas as legendas (avaliado de novo: razão das somas, não soma de razões) */
  function executarParcial(res, vi, e, lg) {
    var v = res.valores[vi]; if (!v || v.erro) return { v: null, erro: v && v.erro };
    var serie = res.eixo.map(function (x) { return { eixo: x, leg: lg }; });
    return avaliar(v.ast, { prep: res.prep, grupo: { eixo: e, leg: lg }, serie: serie, pos: Math.max(0, res.eixo.indexOf(e)), cob: null });
  }
  function dispersao(res, b, w, h) {
    if (res.valores.length < 2) return '<div class="mpn-vazio">A dispersão precisa de dois valores (X e Y).</div>';
    var vx = res.valores[0], vy = res.valores[1], pts = res.eixo.map(function (e, ci) { return { e: e, ci: ci, x: numero(res.celulas[0][chaveGrupo(e, null)]), y: numero(res.celulas[1][chaveGrupo(e, null)]) }; }).filter(function (p) { return p.x != null && p.y != null; });
    if (!pts.length) return '<div class="mpn-vazio">Faltam dados.</div>';
    var ex = escala(Math.min.apply(null, pts.map(function (p) { return p.x; })), Math.max.apply(null, pts.map(function (p) { return p.x; })), 5);
    var ey = escala(Math.min.apply(null, pts.map(function (p) { return p.y; })), Math.max.apply(null, pts.map(function (p) { return p.y; })), 5);
    var mL = 58, mB = 34, mT = 10, mR = 14, W = w - mL - mR, H = h - mT - mB, s = svgAbre(w, h);
    ex.ticks.forEach(function (t) { var xx = mL + (t - ex.min) / (ex.max - ex.min) * W; s += '<line x1="' + xx + '" y1="' + mT + '" x2="' + xx + '" y2="' + (mT + H) + '" stroke="#e3eaf0"/>' + TX(xx, mT + H + 14, fmtEixo(t, { v: vx }), { anchor: 'middle', fs: 10 }); });
    ey.ticks.forEach(function (t) { var yy = mT + H - (t - ey.min) / (ey.max - ey.min) * H; s += '<line x1="' + mL + '" y1="' + yy + '" x2="' + (mL + W) + '" y2="' + yy + '" stroke="#e3eaf0"/>' + TX(mL - 6, yy + 3.5, fmtEixo(t, { v: vy }), { anchor: 'end', fs: 10 }); });
    pts.forEach(function (p) {
      var xx = mL + (p.x - ex.min) / (ex.max - ex.min) * W, yy = mT + H - (p.y - ey.min) / (ey.max - ey.min) * H;
      s += '<circle cx="' + arred(xx, 1) + '" cy="' + arred(yy, 1) + '" r="5" fill="#004b87" fill-opacity=".75" data-b="' + esc(b.id) + '" data-x="' + p.ci + '" data-s="0" class="mpn-alvo"><title>' + esc(res.rotEixo(p.e) + ' — ' + vx.nome + ': ' + formatar(p.x, vx.formato, vx.casas, '') + '; ' + vy.nome + ': ' + formatar(p.y, vy.formato, vy.casas, '')) + '</title></circle>';
    });
    s += TX(mL + W / 2, h - 2, vx.nome, { anchor: 'middle', fs: 10.5, peso: 700 }) + TX(12, mT + H / 2, vy.nome, { anchor: 'middle', fs: 10.5, peso: 700, rot: -90 });
    return s + '</svg>';
  }
  function desenhar(res, b, w, h) {
    switch (b.visual) {
      case 'cartao': return cartao(res, b);
      case 'medidor': return medidor(res, b, w, h);
      case 'pizza': return pizza(res, b, w, h);
      case 'tabela': return tabelaHTML(res, b);
      case 'matriz': return matrizHTML(res, b);
      case 'dispersao': return dispersao(res, b, w, h);
      default: return grafico(res, b, w, h - (res.legendas.length * res.valores.length > 1 ? 22 : 0) - (multiplasUnidades(res) ? 18 : 0), b.visual || 'colunas');
    }
  }
  /* unidades dos pontos com número (o zero "neutro" de uma soma vazia não tem unidade e não conta) */
  function unidadesDe(ss) { var u = {}; ss.forEach(function (s) { s.pontos.forEach(function (p) { if (numero(p) == null || p.neutro) return; u[s.v.formato === 'pct' ? '%' : (p.u || '')] = 1; }); }); return Object.keys(u); }
  function multiplasUnidades(res) { return ['colunas', 'barras', 'linhas', 'combinado', 'empilhadas'].indexOf(res.cfg.visual || 'colunas') >= 0 && unidadesDe(series(res)).length > 1; }
  function notasHTML(res) {
    var n = [];
    res.avisos.forEach(function (a) { n.push('<li class="aviso">' + esc(a) + '</li>'); });
    res.cobertura.forEach(function (c) { n.push('<li class="falta">Faltam dados — ' + esc(c) + '</li>'); });
    if (res.cortados) n.push('<li>Mostrando os ' + res.eixo.length + ' primeiros (' + res.cortados + ' a mais ficaram de fora).</li>');
    return n.length ? '<ul class="mpn-notas">' + n.join('') + '</ul>' : '';
  }

  /* ---------------------------------------------------------------------
     8) ESTILO
     --------------------------------------------------------------------- */
  function estilo() {
    if (el('mpn-estilo')) return;
    var st = document.createElement('style'); st.id = 'mpn-estilo';
    st.textContent = [
      '.mpn-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:10px 12px;margin:0 0 12px}',
      '.mpn-bar label{display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:700;color:#355566;margin:0}',
      '.mpn-bar input,.mpn-bar select{padding:6px 7px;border:1px solid #c9d6e0;border-radius:7px;font-size:12.5px;min-width:0;max-width:220px}',
      '.mpn-chip{display:inline-flex;gap:6px;align-items:center;background:#e3eefa;color:#0b4a8a;border-radius:999px;padding:4px 6px 4px 10px;font-size:12px;font-weight:700}',
      '.mpn-chip b{cursor:pointer;color:#a00e1c;padding:0 4px}',
      '.mpn-grade{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:118px;gap:12px}',
      '.mpn-bloco{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;position:relative}',
      '.mpn-bloco-cab{display:flex;align-items:center;gap:6px;min-height:22px}.mpn-bloco-cab h4{flex:1;margin:0;font-size:13px;color:#0b3a5c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.mpn-bloco-acoes{display:flex;gap:2px}.mpn-bloco-acoes span{cursor:pointer;color:#5b7385;font-size:13px;padding:1px 4px;border-radius:5px}.mpn-bloco-acoes span:hover{background:#eef3f7;color:#004b87}',
      '.mpn-corpo{flex:1;min-height:0;overflow:auto;position:relative}',
      '.mpn-editando .mpn-bloco{outline:2px dashed #9fbfd9;cursor:move}.mpn-editando .mpn-bloco.mpn-arrastando{opacity:.4}',
      '.mpn-svg{display:block}.mpn-svg .mpn-alvo{cursor:pointer}.mpn-svg .mpn-alvo:hover{opacity:.78}',
      '.mpn-leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:#355566;margin:2px 0 0}.mpn-leg span{display:inline-flex;align-items:center;gap:4px}.mpn-leg i{width:10px;height:10px;border-radius:2px;display:inline-block}',
      '.mpn-leg-col{flex-direction:column;gap:3px;overflow:auto}.mpn-pizza{display:flex;gap:10px;align-items:center;height:100%}',
      '.mpn-vazio{color:#8a99a6;font-size:12.5px;padding:18px 6px;text-align:center}',
      '.mpn-notas{margin:4px 0 0;padding-left:16px;font-size:10.5px;color:#5b7385;max-height:46px;overflow:auto}.mpn-notas li.falta{color:#8a5a00}.mpn-notas li.aviso{color:#7a5000}',
      '.mpn-cartao{display:flex;flex-direction:column;justify-content:center;height:100%;border-left:5px solid #c9d6e0;padding-left:10px}',
      '.mpn-cartao.verde{border-left-color:#2e7d32}.mpn-cartao.amarelo{border-left-color:#f9a825}.mpn-cartao.vermelho{border-left-color:#c62828}',
      '.mpn-cartao-nome{font-size:11.5px;color:#5b7385;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:4px}.mpn-cartao-valor{font-size:22px;font-weight:800;color:#0b3a5c;cursor:pointer;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.mpn-cartao-meta,.mpn-cartao-nota{font-size:10.5px;color:#5b7385}.mpn-falta{color:#8a99a6;font-size:15px}.mpn-erro{color:#a00e1c;font-size:15px}',
      '.mpn-comp{margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10.5px}.mpn-comp a{color:#0b4a8a;text-decoration:none}.mpn-comp a:hover{text-decoration:underline}',
      '.mpn-bloco-acoes{opacity:0;transition:opacity .15s;background:rgba(255,255,255,.96);border-radius:6px}.mpn-bloco:hover .mpn-bloco-acoes,.mpn-bloco:focus-within .mpn-bloco-acoes,.mpn-editando .mpn-bloco-acoes{opacity:1}',
      '.mpn-cab-flutua{position:absolute;top:4px;right:6px;z-index:3;min-height:0}.mpn-cab-flutua h4{display:none}.mpn-bloco.mpn-eh-cartao .mpn-corpo{overflow:hidden}',
      '.mpn-modal button{background:#083f7a;color:#fff;border:1px solid #083f7a;border-radius:6px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;min-height:28px;font-family:inherit}',
      '.mpn-modal button.secondary{background:#fff;color:#083f7a;border:1px solid #b9cad8}.mpn-modal button.mini{padding:3px 8px;font-size:11px;min-height:24px}.mpn-modal button.mini.secondary{background:#eef4f9;border-color:#cbdbe7}',
      '#mpn_tv_sair{background:#083f7a;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;opacity:.35}#mpn_tv_sair:hover{opacity:1}',
      '.mpn-tab-ind td{white-space:normal;vertical-align:top}.mpn-tab-ind td:nth-child(1){min-width:250px;max-width:400px}.mpn-tab-ind td:nth-child(3){min-width:300px;max-width:520px}.mpn-tab-ind code{white-space:pre-wrap;word-break:break-word}',
      '.mpn-tab-tb td{white-space:normal}',
      '.mpn-tab table{width:100%;border-collapse:collapse;font-size:11.5px}.mpn-tab th{background:#f3f6f9;text-align:left;padding:4px 6px;position:sticky;top:0}.mpn-tab td{padding:3px 6px;border-top:1px solid #edf1f4}',
      '.mpn-num{text-align:right;white-space:nowrap}.mpn-tab td.mpn-alvo{cursor:pointer}.mpn-tab td.mpn-alvo:hover{background:#eef6ff}.mpn-total td{font-weight:700;background:#f7fafc}',
      '.mpn-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin:0 0 16px}',
      '.mpn-card{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:12px 14px}.mpn-card h3{margin:0 0 4px;font-size:15px;color:#004b87}.mpn-card p{margin:0 0 8px;font-size:12px;color:#5b7385}',
      '.mpn-acoes{display:flex;flex-wrap:wrap;gap:6px}',
      '.mpn-pop{position:fixed;z-index:9600;background:#fff;border:1px solid #c9d6e0;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:6px;display:flex;flex-direction:column;gap:2px;min-width:200px}',
      '.mpn-pop div{padding:6px 10px;border-radius:7px;cursor:pointer;font-size:12.5px;color:#0b3a5c}.mpn-pop div:hover{background:#eef3f7}.mpn-pop small{padding:2px 10px;color:#5b7385;font-size:11px}',
      '.mpn-modal{position:fixed;inset:0;z-index:9500;background:rgba(10,30,50,.45);display:flex;align-items:stretch;justify-content:center;padding:2vh 1.2vw}',
      '.mpn-janela{background:#f4f7fa;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.25);width:100%;max-width:1500px;display:flex;flex-direction:column;overflow:hidden}',
      '.mpn-janela-cab{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-bottom:1px solid #dbe5ec}.mpn-janela-cab h3{flex:1;margin:0;color:#004b87;font-size:16px}',
      '.mpn-janela-corpo{flex:1;min-height:0;overflow:auto;padding:12px 14px}',
      '.mpn-ed{display:grid;grid-template-columns:270px 360px minmax(0,1fr);gap:12px;height:100%;min-height:0}',
      '.mpn-col{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:10px;overflow:auto;min-height:0}',
      '.mpn-col h4{margin:2px 0 6px;font-size:12.5px;color:#0b3a5c}',
      '.mpn-campos input[type=search]{width:100%;padding:6px 8px;border:1px solid #c9d6e0;border-radius:7px;font-size:12.5px;margin:0 0 6px}',
      '.mpn-campos details{margin:2px 0}.mpn-campos summary{cursor:pointer;font-size:12px;font-weight:700;color:#0b3a5c;padding:3px 0}',
      '.mpn-item{display:flex;align-items:center;gap:5px;font-size:11.5px;padding:3px 5px;border-radius:6px;cursor:grab;color:#123}.mpn-item:hover{background:#eef6ff}',
      '.mpn-item em{font-style:normal;font-size:10px;color:#5b7385;margin-left:auto}.mpn-item .mais{cursor:pointer;color:#004b87;font-weight:800;padding:0 4px}',
      '.mpn-item .ic{width:16px;text-align:center;color:#5b7385;font-size:11px}',
      '.mpn-poco{border:1.5px dashed #b9cfe0;border-radius:9px;min-height:34px;padding:5px;display:flex;flex-direction:column;gap:4px;margin:0 0 8px;background:#fbfdff}',
      '.mpn-poco.sobre{background:#e8f3ff;border-color:#004b87}.mpn-poco .dica{font-size:11px;color:#8a99a6;padding:3px}',
      '.mpn-val{background:#eef4fb;border:1px solid #d4e2ef;border-radius:8px;padding:5px 7px;font-size:11.5px}.mpn-val-top{display:flex;gap:4px;align-items:center}.mpn-val-top b{flex:1;color:#0b3a5c}',
      '.mpn-val-top span{cursor:pointer;color:#5b7385;padding:0 3px}.mpn-val-op{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;align-items:center}.mpn-val-op select,.mpn-val-op input{font-size:11px;padding:2px 4px;border:1px solid #c9d6e0;border-radius:5px;max-width:110px}',
      '.mpn-val code{display:block;font-size:10.5px;color:#45606f;white-space:pre-wrap;word-break:break-word;margin-top:3px}',
      '.mpn-tipos{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:0 0 8px}.mpn-tipos span{font-size:11px;text-align:center;padding:5px 2px;border:1px solid #d4e2ef;border-radius:7px;cursor:pointer;background:#fff;color:#0b3a5c}',
      '.mpn-tipos span.on{background:#004b87;color:#fff;border-color:#004b87}',
      '.mpn-form{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 8px}.mpn-form label{display:flex;flex-direction:column;gap:2px;font-size:10.5px;font-weight:700;color:#355566;margin:0}',
      '.mpn-form input,.mpn-form select,.mpn-form textarea{padding:5px 6px;border:1px solid #c9d6e0;border-radius:6px;font-size:12px;min-width:0}.mpn-form .wide{grid-column:span 2}',
      '.mpn-form textarea{font-family:Consolas,monospace;font-size:12px;min-height:58px}',
      '.mpn-msg{font-size:11.5px;margin:3px 0}.mpn-msg:empty{display:none}.mpn-msg.ok{color:#245d0d}.mpn-msg.erro{color:#a00e1c;font-weight:700}.mpn-msg.alerta{color:#8a5a00}',
      '.mpn-previa{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;height:360px}',
      '.mpn-aberto{font-family:Consolas,monospace;font-size:12px;background:#f7fafc;border:1px solid #e1e9ef;border-radius:8px;padding:8px;white-space:pre-wrap;word-break:break-word}',
      '.mpn-tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;background:#eef3f7;color:#0b3a5c}.mpn-tag.of{background:#e2f2ef;color:#0b6152}.mpn-tag.eu{background:#efe7fb;color:#5b2a9a}',
      'body.mpn-tv nav,body.mpn-tv header,body.mpn-tv .topbar,body.mpn-tv #mpn_toolbar,body.mpn-tv #mpn_filtros .mpn-sotela{display:none!important}',
      'body.mpn-tv main{margin:0!important;padding:10px!important;max-width:none!important;width:100%!important}body.mpn-tv .mpn-grade{grid-auto-rows:calc((100vh - 90px)/7)}',
      '@media print{nav,header,.topbar,#mpn_toolbar,.mpn-bloco-acoes,#mpn_filtros .mpn-sotela{display:none!important}main{margin:0!important}.mpn-bloco{break-inside:avoid}}',
      '@media (max-width:980px){.mpn-grade{grid-template-columns:1fr;grid-auto-rows:118px}.mpn-grade .mpn-bloco{grid-column:auto!important}.mpn-ed{grid-template-columns:1fr;height:auto}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------------
     9) TELA: LISTA DE PAINÉIS
     --------------------------------------------------------------------- */
  function telaLista() {
    estilo(); semear(); setCurrent('paineis'); marcarNav('paineis');
    cabecalho('Painéis', 'Indicadores dos módulos em painéis por área: arraste os campos, escolha o gráfico e a regra de cálculo.');
    var ps = paineis().filter(painelVisivel), faltam = modelos().filter(function (m) { return !paineis().some(function (p) { return p.Modelo === m.Nome; }); });
    var porArea = {}; ps.forEach(function (p) { (porArea[p.Area || 'Geral'] = porArea[p.Area || 'Geral'] || []).push(p); });
    var h = '<div class="toolbar" id="mpn_toolbar"><button onclick="mesPainelNovo()">+ Novo painel</button>' + (faltam.length ? '<button class="secondary" onclick="mesPaineisModelos()">Criar os painéis modelo das áreas (' + faltam.length + ')</button>' : '') +
      '<button class="secondary" onclick="render(\'indicadores\')">Indicadores</button><button class="secondary" onclick="render(\'paineis_tabelas\')">Tabelas e relações</button></div>';
    if (!ps.length) h += '<div class="mpn-card"><h3>Comece pelos painéis modelo</h3><p>Produção, Qualidade, Custos, Sustentabilidade, Engenharia / P&amp;D e Diretoria, já com os indicadores oficiais. Depois é só ajustar: arrastar campos, trocar o gráfico, mudar a regra.</p><div class="mpn-acoes"><button onclick="mesPaineisModelos()">Criar os painéis modelo</button><button class="secondary" onclick="mesPainelNovo()">Criar um painel vazio</button></div></div>';
    AREAS.forEach(function (a) {
      if (!porArea[a]) return;
      h += '<h3 style="margin:8px 0 6px;color:#0b3a5c">' + esc(a) + '</h3><div class="mpn-lista">' + porArea[a].map(function (p) {
        return '<div class="mpn-card"><h3>' + esc(p.Nome) + '</h3><p>' + A(p.Blocos).length + ' bloco(s) · ' + (p.Compartilhado === 'Sim' ? 'compartilhado' : 'só meu') + ' · de ' + esc(p.Dono || '') + '<br>Atualizado em ' + esc(p.AtualizadoEm || '') + '</p>' +
          '<div class="mpn-acoes"><button onclick="mesPainelAbrir(\'' + jsStr(p.IdPainel) + '\')">Abrir</button><button class="secondary" onclick="mesPainelDuplicar(\'' + jsStr(p.IdPainel) + '\')">Duplicar</button>' +
          (podeEditarPainel(p) ? '<button class="secondary" onclick="mesPainelExcluir(\'' + jsStr(p.IdPainel) + '\')">Excluir</button>' : '') + '</div></div>';
      }).join('') + '</div>';
    });
    el('content').innerHTML = h;
  }
  window.mesPaineisModelos = function () { var f = criarModelos(); telaLista(); if (f.length) setTimeout(function () { alert(f.length + ' painel(is) modelo criado(s): ' + f.map(function (p) { return p.Nome; }).join(', ') + '.'); }, 30); };
  window.mesPainelNovo = function () {
    var nome = prompt('Nome do painel:', 'Meu painel'); if (nome === null) return;
    var area = prompt('Área (' + AREAS.join(', ') + '):', 'Geral'); if (area === null) return;
    var a = AREAS.find(function (x) { return norm(x) === norm(area); }) || 'Geral';
    var p = criarPainel(nome, a, [], 'Sim'); mesPainelAbrir(p.IdPainel);
  };
  window.mesPainelDuplicar = function (id) {
    var p = painelPor(id); if (!p) return;
    var c = criarPainel(p.Nome + ' (cópia)', p.Area, clone(A(p.Blocos)).map(function (b) { b.id = idNovo('BL'); return b; }), 'Não');
    c.Filtros = clone(p.Filtros || { periodo: {}, filtros: [] }); salvar(); mesPainelAbrir(c.IdPainel);
  };
  window.mesPainelExcluir = function (id) {
    var p = painelPor(id); if (!p || !podeEditarPainel(p)) return;
    if (!confirm('Excluir o painel "' + p.Nome + '"? Os indicadores continuam na biblioteca.')) return;
    var d = D(); d.paineis = A(d.paineis).filter(function (x) { return x !== p; }); salvar(); telaLista();
  };

  /* ---------------------------------------------------------------------
     10) TELA: PAINEL (grade de blocos, filtros, filtro cruzado, layout, TV, PDF, Excel, fechamento)
     --------------------------------------------------------------------- */
  var estadoPainel = { id: '', editando: false, cruzado: null, resultados: {}, tv: null };
  window.mesPainelAbrir = function (id) { estadoPainel = { id: id, editando: false, cruzado: null, resultados: {}, tv: estadoPainel.tv }; render('painel'); };
  var FILTROS_PAINEL = [['quimica', 'Química'], ['modelo', 'Modelo'], ['produto', 'Produto'], ['equipamento', 'Equipamento'], ['projeto', 'Projeto']];
  /* valores que existem para um eixo/filtro nas tabelas dadas (sem tabelas: nas que têm o campo e não dependem do custo) */
  var TABELAS_LEVES = ['ops', 'producao', 'perdas', 'consumos', 'paradas', 'testes', 'lotes', 'tempos'];
  function valoresDistintos(alvo, ids) {
    var vs = {}, lst = A(ids).length ? A(ids) : TABELAS_LEVES;
    lst = lst.filter(function (id) { var tb = tabela(id); return tb && campoDoAlvo(tb, alvo); });
    montarTabelas(lst);
    lst.forEach(function (id) {
      var tb = tabela(id), f = campoDoAlvo(tb, alvo);
      A(TABELA_LINHAS(id)).forEach(function (row) { var v = valorChave(row, f); if (v !== VAZIO) vs[v] = 1; });
    });
    return Object.keys(vs).sort(function (a, b) { return String(a).localeCompare(String(b), 'pt-BR', { numeric: true }); });
  }
  /* tabelas usadas pelos valores de um bloco (com os sub-indicadores) e por todos os blocos de um painel */
  function tabelasDe(b) {
    var t = {};
    A(b && b.valores).forEach(function (vc) { var r = resolverValor(vc); if (r.info) Object.keys(r.info.tabelas).forEach(function (k) { t[k] = 1; }); });
    A(b && b.filtros).forEach(function (fl) { if (fl.alvo && fl.alvo.tipo === 'campo') t[fl.alvo.tabela] = 1; });
    return Object.keys(t);
  }
  function tabelasDoPainel(p) { var t = {}; A(p && p.Blocos).forEach(function (b) { tabelasDe(b).forEach(function (k) { t[k] = 1; }); }); return Object.keys(t); }
  function filtrosDoPainel(p) {
    var f = clone(p.Filtros || { periodo: {}, filtros: [] });
    f.periodo = f.periodo || {}; f.filtros = A(f.filtros);
    if (estadoPainel.cruzado) f.filtros.push({ alvo: estadoPainel.cruzado.alvo, op: 'em', valores: [estadoPainel.cruzado.valor], suave: true });
    return f;
  }
  function telaPainel() {
    estilo(); semear();
    var p = painelPor(estadoPainel.id);
    if (!p) return telaLista();
    setCurrent('painel'); marcarNav('paineis'); novaSessao(); fecharPopover();
    /* uma proteção só para todas as tabelas do painel (os módulos calculam, nada fica gravado) */
    var tabs = tabelasDoPainel(p);
    montarTabelas(tabs);
    cabecalho(p.Nome, (p.Area || 'Geral') + ' · ' + A(p.Blocos).length + ' bloco(s)' + (p.Compartilhado === 'Sim' ? ' · compartilhado' : ' · só meu') + ' · clique num gráfico para filtrar o painel, ver o cálculo aberto ou os registros');
    var pe = podeEditarPainel(p), fp = p.Filtros || { periodo: {}, filtros: [] }, per = fp.periodo || {};
    var h = '<div class="toolbar" id="mpn_toolbar"><button class="secondary" onclick="render(\'paineis\')">← Painéis</button>' + (pe ? '<button onclick="mesBlocoEditar(\'\')">+ Bloco</button><button class="secondary" onclick="mesPainelLayout()">' + (estadoPainel.editando ? '✓ Concluir layout' : 'Editar layout') + '</button>' : '') +
      '<button class="secondary" onclick="mesPainelExcel()">⬇ Excel</button><button class="secondary" onclick="mesPainelImprimir()">Imprimir / PDF</button><button class="secondary" onclick="mesPainelTV()">Modo TV</button>' +
      (admin() ? '<button class="secondary" onclick="mesPainelFecharMes()">Fechar mês</button>' : '') + (pe ? '<button class="secondary" onclick="mesPainelPropriedades()">Nome e compartilhamento</button>' : '') + '</div>';
    h += '<div class="mpn-bar" id="mpn_filtros"><label>De (mês)<input type="month" id="mpn_f_de" value="' + esc(per.de || '') + '"></label><label>Até (mês)<input type="month" id="mpn_f_ate" value="' + esc(per.ate || '') + '"></label>' +
      FILTROS_PAINEL.map(function (x) {
        var atual = (A(fp.filtros).find(function (fl) { return fl.alvo && fl.alvo.tipo === 'dim' && fl.alvo.dim === x[0]; }) || {}).valores || [];
        var opcoes = tabs.length ? valoresDistintos(dim(x[0]), tabs) : [];
        if (atual[0] && opcoes.indexOf(atual[0]) < 0) opcoes.unshift(atual[0]);
        return '<label>' + esc(x[1]) + '<select id="mpn_f_' + x[0] + '"><option value="">Todos</option>' + opcoes.map(function (v) { return '<option value="' + esc(v) + '"' + (atual[0] === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select></label>';
      }).join('') + '<span class="mpn-sotela" style="display:flex;gap:6px"><button onclick="mesPainelFiltrar()">Aplicar</button><button class="secondary" onclick="mesPainelLimparFiltros()">Limpar</button></span>' +
      (estadoPainel.cruzado ? '<span class="mpn-chip">Filtro do clique: ' + esc(estadoPainel.cruzado.rotulo) + ' <b onclick="mesPainelCruzado(null)" title="Tirar o filtro">✕</b></span>' : '') + '</div>';
    h += '<div class="mpn-grade' + (estadoPainel.editando ? ' mpn-editando' : '') + '" id="mpn_grade">' + A(p.Blocos).map(function (b) {
      var ehCartao = b.visual === 'cartao';
      return '<div class="mpn-bloco' + (ehCartao ? ' mpn-eh-cartao' : '') + '" id="mpn_b_' + esc(b.id) + '" data-id="' + esc(b.id) + '" style="grid-column:' + (N(b.x) + 1) + ' / span ' + Math.max(1, N(b.w)) + ';grid-row:' + (N(b.y) + 1) + ' / span ' + Math.max(1, N(b.h)) + '"' + (estadoPainel.editando ? ' draggable="true"' : '') + '>' +
        '<div class="mpn-bloco-cab' + (ehCartao ? ' mpn-cab-flutua' : '') + '"><h4 title="' + esc(tituloBloco(b)) + '">' + esc(tituloBloco(b)) + '</h4><div class="mpn-bloco-acoes">' +
        (estadoPainel.editando ? '<span title="Mais estreito" onclick="mesBlocoTamanho(\'' + jsStr(b.id) + '\',-1,0)">◀</span><span title="Mais largo" onclick="mesBlocoTamanho(\'' + jsStr(b.id) + '\',1,0)">▶</span><span title="Mais baixo" onclick="mesBlocoTamanho(\'' + jsStr(b.id) + '\',0,-1)">▲</span><span title="Mais alto" onclick="mesBlocoTamanho(\'' + jsStr(b.id) + '\',0,1)">▼</span>' : '') +
        (pe ? '<span title="Editar" onclick="mesBlocoEditar(\'' + jsStr(b.id) + '\')">✎</span><span title="Duplicar" onclick="mesBlocoDuplicar(\'' + jsStr(b.id) + '\')">⧉</span>' : '') +
        '<span title="Ver registros" onclick="mesBlocoRegistros(\'' + jsStr(b.id) + '\',-1,null,0)">🔎</span><span title="Excel do bloco" onclick="mesBlocoExcel(\'' + jsStr(b.id) + '\')">⬇</span>' +
        (pe ? '<span title="Remover" onclick="mesBlocoRemover(\'' + jsStr(b.id) + '\')">✕</span>' : '') + '</div></div><div class="mpn-corpo" id="mpn_c_' + esc(b.id) + '"><div class="mpn-vazio">Calculando…</div></div></div>';
    }).join('') + '</div>';
    if (!A(p.Blocos).length) h += '<div class="mpn-card"><h3>Painel vazio</h3><p>Use "+ Bloco" para escolher os campos, o gráfico e a regra de cálculo.</p></div>';
    el('content').innerHTML = h;
    desenharBlocos(p);
    if (estadoPainel.editando) ligarArraste(p);
  }
  function tituloBloco(b) {
    if (txt(b.titulo)) return b.titulo;
    var v = A(b.valores)[0]; if (!v) return 'Bloco';
    var ind = v.indicador ? indicadorPor(v.indicador) : null;
    return (ind ? ind.Nome : (v.nome || v.formula || 'Valor')) + (v.acumulado ? ' (acumulado)' : '');
  }
  function desenharBlocos(p) {
    var fp = filtrosDoPainel(p);
    A(p.Blocos).forEach(function (b) { desenharBloco(b, fp); });
  }
  function desenharBloco(b, fp, alvoId) {
    var c = el(alvoId || ('mpn_c_' + b.id)); if (!c) return;
    var res;
    try { res = executar(b, fp); }
    catch (e) { c.innerHTML = '<div class="mpn-vazio">Erro ao calcular: ' + esc(e && e.message || e) + '</div>'; console.warn('MES LION 1.7: bloco', e); return; }
    estadoPainel.resultados[b.id] = res;
    var w = Math.max(160, c.clientWidth - 4), notas = notasHTML(res), hNotas = notas ? 40 : 0, h = Math.max(70, c.clientHeight - 4 - hNotas);
    c.innerHTML = desenhar(res, b, w, h) + notas;
    c.onclick = function (ev) { cliqueBloco(ev, b, !!alvoId); };
  }
  /* clique num ponto: filtrar o painel (só no painel, não na prévia), cálculo aberto, registros e componentes */
  function cliqueBloco(ev, b, previa) {
    var t = ev.target.closest('[data-b]'); if (!t) return;
    var res = estadoPainel.resultados[b.id]; if (!res) return;
    var xi = Number(t.getAttribute('data-x')), si = t.getAttribute('data-s'), vi = t.getAttribute('data-v'), lgAttr = t.getAttribute('data-l');
    var ss = series(res), s = si != null && si !== '' ? ss[Number(si)] : null;
    vi = vi != null && vi !== '' ? Number(vi) : (s ? s.vi : 0);
    var lg = lgAttr != null ? (lgAttr === '' ? null : lgAttr) : (s ? s.lg : null), e = xi >= 0 ? res.eixo[xi] : null;
    var itens = [];
    if (!previa && e != null && res.consulta.eixo) itens.push(['Filtrar o painel por ' + rotuloAlvo(res.consulta.eixo) + ' = ' + res.rotEixo(e), function () { mesPainelCruzado({ alvo: res.consulta.eixo, valor: e, rotulo: rotuloAlvo(res.consulta.eixo) + ' = ' + res.rotEixo(e) }); }]);
    if (!previa && lg != null && res.consulta.legenda) itens.push(['Filtrar o painel por ' + rotuloAlvo(res.consulta.legenda) + ' = ' + res.rotLeg(lg), function () { mesPainelCruzado({ alvo: res.consulta.legenda, valor: lg, rotulo: rotuloAlvo(res.consulta.legenda) + ' = ' + res.rotLeg(lg) }); }]);
    itens.push(['Cálculo aberto', function () { mostrarCalculo(b, res, vi, e, lg); }]);
    itens.push(['Ver os registros', function () { mesBlocoRegistros(b.id, xi, lg, vi); }]);
    var v = res.valores[vi];
    if (!previa && v && v.ind && A(v.ind.Componentes).length) itens.push(['Abrir nos componentes (' + A(v.ind.Componentes).map(function (c) { var ci = indicadorPor(c); return ci ? ci.Nome : c; }).join(', ') + ')', function () { mesPainelComponentes(b.id, vi); }]);
    popover(ev.clientX, ev.clientY, (e != null ? res.rotEixo(e) : 'Total') + (lg != null ? ' · ' + res.rotLeg(lg) : ''), itens);
  }
  function popover(x, y, titulo, itens) {
    fecharPopover();
    var d = document.createElement('div'); d.className = 'mpn-pop'; d.id = 'mpn_pop';
    d.innerHTML = '<small>' + esc(titulo) + '</small>' + itens.map(function (it, i) { return '<div data-i="' + i + '">' + esc(it[0]) + '</div>'; }).join('');
    document.body.appendChild(d);
    d.style.left = Math.min(x, window.innerWidth - d.offsetWidth - 10) + 'px'; d.style.top = Math.min(y, window.innerHeight - d.offsetHeight - 10) + 'px';
    d.onclick = function (ev) { var t = ev.target.closest('[data-i]'); if (!t) return; fecharPopover(); itens[Number(t.getAttribute('data-i'))][1](); };
    setTimeout(function () { document.addEventListener('mousedown', fecharPopoverFora, true); }, 0);
  }
  function fecharPopoverFora(ev) { var d = el('mpn_pop'); if (d && !d.contains(ev.target)) fecharPopover(); }
  function fecharPopover() { var d = el('mpn_pop'); if (d) d.remove(); document.removeEventListener('mousedown', fecharPopoverFora, true); }
  window.mesPainelCruzado = function (c) { estadoPainel.cruzado = c; telaPainel(); };
  window.mesPainelFiltrar = function () {
    var p = painelPor(estadoPainel.id); if (!p) return;
    var f = { periodo: { de: val('mpn_f_de'), ate: val('mpn_f_ate') }, filtros: [] };
    if (f.periodo.de && f.periodo.ate && f.periodo.de > f.periodo.ate) return alert('O mês inicial é depois do final.');
    FILTROS_PAINEL.forEach(function (x) { var v = val('mpn_f_' + x[0]); if (v) f.filtros.push({ alvo: dim(x[0]), op: 'em', valores: [v] }); });
    p.Filtros = f;
    if (podeEditarPainel(p)) { p.AtualizadoEm = agora(); salvar(); }
    telaPainel();
  };
  window.mesPainelLimparFiltros = function () { var p = painelPor(estadoPainel.id); if (!p) return; p.Filtros = { periodo: {}, filtros: [] }; estadoPainel.cruzado = null; if (podeEditarPainel(p)) salvar(); telaPainel(); };
  window.mesPainelComponentes = function (bid, vi) {
    var p = painelPor(estadoPainel.id), b = p && A(p.Blocos).find(function (x) { return x.id === bid; }); if (!b) return;
    var v = A(b.valores)[vi || 0], ind = v && v.indicador ? indicadorPor(v.indicador) : null; if (!ind || !A(ind.Componentes).length) return;
    var cfg = clone(b); cfg.id = 'comp'; cfg.titulo = ind.Nome + ' — componentes'; cfg.valores = A(ind.Componentes).map(function (c) { return { indicador: c }; }).concat([{ indicador: ind.IdIndicador }]);
    if (cfg.visual === 'cartao' || cfg.visual === 'medidor') cfg.visual = cfg.eixo ? 'colunas' : 'tabela';
    janela(cfg.titulo, '<p class="muted" style="margin:0 0 8px">' + esc(ind.Descricao || '') + '</p><div class="mpn-previa" style="height:420px"><div class="mpn-corpo" id="mpn_comp_c"></div></div>', '');
    setTimeout(function () { desenharBloco(cfg, filtrosDoPainel(p), 'mpn_comp_c'); }, 20);
  };
  window.mesPainelLayout = function () { estadoPainel.editando = !estadoPainel.editando; telaPainel(); };
  window.mesBlocoTamanho = function (id, dw, dh) {
    var p = painelPor(estadoPainel.id), b = p && A(p.Blocos).find(function (x) { return x.id === id; }); if (!b) return;
    b.w = Math.max(2, Math.min(12, N(b.w) + dw)); b.h = Math.max(1, Math.min(8, N(b.h) + dh)); if (N(b.x) + b.w > 12) b.x = 12 - b.w;
    arrumar(p); p.AtualizadoEm = agora(); salvar(); telaPainel();
  };
  /* sem sobreposição: cada bloco desce até achar espaço livre (ordem de cima para baixo, da esquerda para a direita) */
  function arrumar(p) {
    var bs = A(p.Blocos).slice().sort(function (a, b) { return N(a.y) - N(b.y) || N(a.x) - N(b.x); }), ocup = {};
    function livre(b, y) { for (var r = y; r < y + N(b.h); r++) for (var c = N(b.x); c < N(b.x) + N(b.w); c++) if (ocup[r + '|' + c]) return false; return true; }
    bs.forEach(function (b) {
      b.x = Math.max(0, Math.min(12 - Math.max(1, N(b.w)), N(b.x))); var y = Math.max(0, N(b.y));
      while (!livre(b, y)) y++;
      b.y = y; for (var r = y; r < y + N(b.h); r++) for (var c = N(b.x); c < N(b.x) + N(b.w); c++) ocup[r + '|' + c] = 1;
    });
  }
  function ligarArraste(p) {
    var g = el('mpn_grade'); if (!g) return;
    var arrastando = null;
    g.querySelectorAll('.mpn-bloco').forEach(function (n) {
      n.addEventListener('dragstart', function (ev) { arrastando = n.getAttribute('data-id'); n.classList.add('mpn-arrastando'); try { ev.dataTransfer.setData('text/plain', arrastando); } catch (e) { } });
      n.addEventListener('dragend', function () { n.classList.remove('mpn-arrastando'); });
    });
    g.addEventListener('dragover', function (ev) { if (arrastando) ev.preventDefault(); });
    g.addEventListener('drop', function (ev) {
      ev.preventDefault(); if (!arrastando) return;
      var b = A(p.Blocos).find(function (x) { return x.id === arrastando; }); arrastando = null; if (!b) return;
      var r = g.getBoundingClientRect(), col = Math.floor((ev.clientX - r.left) / (r.width / 12)), lin = Math.floor((ev.clientY - r.top) / (118 + 12));
      b.x = Math.max(0, Math.min(12 - N(b.w), col)); b.y = Math.max(0, lin);
      A(p.Blocos).forEach(function (o) { if (o !== b && N(o.y) >= b.y && N(o.x) < b.x + N(b.w) && N(o.x) + N(o.w) > b.x) o.y = N(o.y) + 0; });
      p.Blocos = [b].concat(A(p.Blocos).filter(function (o) { return o !== b; }));
      arrumar(p); p.AtualizadoEm = agora(); salvar(); telaPainel();
    });
  }
  window.mesBlocoDuplicar = function (id) {
    var p = painelPor(estadoPainel.id), b = p && A(p.Blocos).find(function (x) { return x.id === id; }); if (!b || !podeEditarPainel(p)) return;
    var c = clone(b); c.id = idNovo('BL'); c.y = N(b.y) + N(b.h); p.Blocos.push(c); arrumar(p); p.AtualizadoEm = agora(); salvar(); telaPainel();
  };
  window.mesBlocoRemover = function (id) {
    var p = painelPor(estadoPainel.id), b = p && A(p.Blocos).find(function (x) { return x.id === id; }); if (!b || !podeEditarPainel(p)) return;
    if (!confirm('Remover o bloco "' + tituloBloco(b) + '"?')) return;
    p.Blocos = A(p.Blocos).filter(function (x) { return x !== b; }); p.AtualizadoEm = agora(); salvar(); telaPainel();
  };
  window.mesPainelPropriedades = function () {
    var p = painelPor(estadoPainel.id); if (!p || !podeEditarPainel(p)) return;
    var nome = prompt('Nome do painel:', p.Nome); if (nome === null) return;
    var area = prompt('Área (' + AREAS.join(', ') + '):', p.Area); if (area === null) return;
    var comp = confirm('Compartilhar com todos os usuários? (OK = compartilhado; Cancelar = só meu)');
    p.Nome = txt(nome) || p.Nome; p.Area = AREAS.find(function (x) { return norm(x) === norm(area); }) || p.Area; p.Compartilhado = comp ? 'Sim' : 'Não'; p.AtualizadoEm = agora(); salvar(); telaPainel();
  };
  window.mesPainelImprimir = function () { setTimeout(function () { window.print(); }, 50); };
  window.mesPainelTV = function () {
    if (estadoPainel.tv) return sairTV();
    document.body.classList.add('mpn-tv');
    var sair = document.createElement('button'); sair.id = 'mpn_tv_sair'; sair.textContent = 'Sair do modo TV'; sair.className = 'secondary';
    sair.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9400'; sair.onclick = sairTV; document.body.appendChild(sair);
    estadoPainel.tv = setInterval(function () { if (telaAtual() === 'painel') telaPainel(); else pararTV(); }, 5 * 60000);
    document.addEventListener('keydown', teclaTV); telaPainel();
  };
  function teclaTV(ev) { if (ev.key === 'Escape' && !document.querySelector('.mpn-modal') && !el('mpn_pop')) sairTV(); }
  function pararTV() { if (estadoPainel.tv) clearInterval(estadoPainel.tv); estadoPainel.tv = null; document.body.classList.remove('mpn-tv'); var b = el('mpn_tv_sair'); if (b) b.remove(); document.removeEventListener('keydown', teclaTV); }
  function sairTV() { var estava = !!estadoPainel.tv; pararTV(); if (estava && telaAtual() === 'painel') telaPainel(); }
  window.mesPainelFecharMes = function () {
    if (!admin()) return alert('Só o administrador fecha o mês.');
    var ant = mesMais(mesDe(new Date()), -1), m = prompt('Mês a fechar (AAAA-MM). Os indicadores oficiais desse mês ficam gravados como estão hoje:', ant); if (m === null) return;
    var ja = A((D() || {}).paineis_fechamentos).some(function (x) { return x.Mes === txt(m); });
    if (ja && !confirm('O mês ' + m + ' já foi fechado. Fechar de novo com os valores de hoje?')) return;
    var r = fecharMes(txt(m));
    if (r.erro) return alert(r.erro);
    alert('Mês ' + m + ' fechado: ' + r.feitos + ' indicador(es) gravado(s).');
    telaPainel();
  };

  /* ---- janelas: cálculo aberto, registros, Excel ---- */
  /* janelas empilham (o cálculo aberto abre por cima do editor do bloco); Fechar e Esc fecham a de cima */
  function janela(titulo, corpo, rodape) {
    fecharPopover();
    var n = document.querySelectorAll('.mpn-modal').length, o = document.createElement('div');
    o.className = 'mpn-modal'; o.style.zIndex = String(9500 + n * 10); o.setAttribute('data-nivel', String(n));
    o.innerHTML = '<div class="mpn-janela"><div class="mpn-janela-cab"><h3>' + esc(titulo) + '</h3>' + (rodape || '') + '<button class="secondary" data-fechar="1">Fechar</button></div><div class="mpn-janela-corpo">' + corpo + '</div></div>';
    o.querySelector('[data-fechar]').onclick = function () { fecharJanela(o); };
    document.body.appendChild(o);
    return o;
  }
  function fecharJanela(o) {
    var ms = document.querySelectorAll('.mpn-modal'), alvo = o || ms[ms.length - 1];
    if (!alvo) return;
    if (alvo.getAttribute('data-editor') === '1') { ed = null; }
    alvo.remove();
  }
  function fecharJanelas() { document.querySelectorAll('.mpn-modal').forEach(function (m) { m.remove(); }); ed = null; }
  window.mesPainelFecharJanela = function () { fecharJanela(); };
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (el('mpn_pop')) { fecharPopover(); ev.stopPropagation(); return; }
    if (document.querySelector('.mpn-modal')) { fecharJanela(); ev.stopPropagation(); }
  }, true);
  function mostrarCalculo(b, res, vi, e, lg) {
    var c = calculoAberto(res, vi, e, lg), v = res.valores[vi];
    if (typeof c === 'string') return janela('Cálculo aberto', '<div class="mpn-aberto">' + esc(c) + '</div>');
    var ind = v.ind, filtros = [];
    var per = res.consulta.periodo || {}; if (per.de || per.ate) filtros.push('Período: ' + (per.de ? rotuloMes(per.de) : 'início') + ' a ' + (per.ate ? rotuloMes(per.ate) : 'hoje'));
    A(res.consulta.filtros).forEach(function (f) { if (A(f.valores).length) filtros.push(rotuloAlvo(f.alvo) + (f.op === 'fora' ? ' fora de ' : ' = ') + f.valores.join(', ')); });
    if (e != null) filtros.push(rotuloAlvo(res.consulta.eixo) + ' = ' + res.rotEixo(e)); if (lg != null) filtros.push(rotuloAlvo(res.consulta.legenda) + ' = ' + res.rotLeg(lg));
    janela('Cálculo aberto — ' + v.nome, (ind ? '<p><b>' + esc(ind.Nome) + '</b> (' + (ind.Oficial === 'Sim' ? 'oficial' : 'pessoal') + ', versão ' + esc(ind.Versao) + ') — ' + esc(ind.Descricao || '') + '</p>' : '') +
      '<h4>Fórmula</h4><div class="mpn-aberto">' + esc(c.formula) + '</div><h4>Recorte</h4><div class="mpn-aberto">' + esc(filtros.join('\n') || 'Todos os registros') + '</div>' +
      '<h4>Passo a passo (com os números de agora)</h4><div class="mpn-aberto">' + esc(c.passos.join('\n') || '—') + '</div><h4>Resultado</h4><div class="mpn-aberto"><b>' + esc(c.resultado) + '</b></div>' +
      (res.cobertura.length ? '<h4>Faltam dados</h4><div class="mpn-aberto">' + esc(res.cobertura.join('\n')) + '</div>' : ''),
      '<button class="secondary" onclick="mesBlocoRegistros(\'' + jsStr(b.id) + '\',' + (e == null ? -1 : res.eixo.indexOf(e)) + ',' + (lg == null ? 'null' : '\'' + jsStr(lg) + '\'') + ',' + vi + ')">Ver os registros</button>');
  }
  function fmtCelula(v, f) {
    if (v instanceof Date) return v.toLocaleDateString('pt-BR');
    if (typeof v === 'number') return fmtNum(v, 6);
    return String(v == null ? '' : v);
  }
  /* janela de registros (fica guardada na própria janela, para o Excel exportar exatamente o que ela mostra) */
  function mostrarRegistros(titulo, grupos, nomeArquivo) {
    var lim = 500;
    var corpo = grupos.map(function (g) {
      var cols = g.tabela.campos;
      return '<h4>' + esc(g.tabela.nome) + ' — ' + g.linhas.length + ' registro(s)' + (g.linhas.length > lim ? ' (mostrando ' + lim + '; o Excel leva todos)' : '') + '</h4><div class="mpn-tab" style="max-height:340px;overflow:auto"><table><thead><tr>' +
        cols.map(function (f) { return '<th>' + esc(f.l) + (f.u ? ' (' + esc(f.u) + ')' : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        g.linhas.slice(0, lim).map(function (row) { return '<tr>' + cols.map(function (f) { return '<td' + (f.t === 'num' ? ' class="mpn-num"' : '') + '>' + esc(fmtCelula(row[f.k], f)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    }).join('') || '<p>Nenhum registro.</p>';
    var o = janela(titulo, corpo, '<button class="secondary" onclick="mesRegistrosExcel(this)">⬇ Excel</button>');
    o.__registros = { grupos: grupos, titulo: nomeArquivo || titulo };
    return o;
  }
  window.mesBlocoRegistros = function (bid, xi, lg, vi) {
    var res = estadoPainel.resultados[bid]; if (!res) return;
    var e = xi >= 0 ? res.eixo[xi] : null, v = res.valores[vi || 0];
    mostrarRegistros('Registros' + (v ? ' de ' + v.nome : '') + (e != null ? ' — ' + res.rotEixo(e) : '') + (lg != null ? ' · ' + res.rotLeg(lg) : ''), registros(res, vi || 0, e, lg == null ? null : lg), v ? v.nome : 'registros');
  };
  function baixar(nome, bytes) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function nomeArq(s) { return String(s || 'painel').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'painel'; }
  function xlsxValor(v) { if (v instanceof Date) return v.toLocaleDateString('pt-BR'); if (typeof v === 'number' && isFinite(v)) return v; return v == null ? '' : String(v); }
  function nomeAba(s, usados) {
    var n = String(s || 'Aba').replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Aba', base = n.slice(0, 27), i = 2;
    while (usados[norm(n)]) n = base + ' (' + (i++) + ')';
    usados[norm(n)] = 1; return n;
  }
  function larguras(linhas) {
    var w = [];
    linhas.slice(0, 300).forEach(function (l) { l.c.forEach(function (v, i) { var t = String(v == null ? '' : (typeof v === 'number' ? fmtNum(v, 6) : v)).length; w[i] = Math.max(w[i] || 8, Math.min(60, t + 2)); }); });
    return w;
  }
  window.mesRegistrosExcel = function (botao) {
    var m = botao && botao.closest ? botao.closest('.mpn-modal') : null, r = m && m.__registros, XL = window.mesXlsx; if (!r || !XL) return alert('Gerador de Excel indisponível.');
    var folhas = [], usados = {};
    r.grupos.forEach(function (g) {
      var linhas = [{ c: g.tabela.campos.map(function (f) { return f.l + (f.u ? ' (' + f.u + ')' : ''); }), s: 1 }].concat(g.linhas.map(function (row) { return { c: g.tabela.campos.map(function (f) { return xlsxValor(row[f.k]); }) }; }));
      folhas.push({ nome: nomeAba(g.tabela.nome, usados), xml: XL.folha(linhas, { congelar: 1, larguras: larguras(linhas), ativa: !folhas.length }) });
    });
    if (!folhas.length) return;
    var arq = 'Registros_' + nomeArq(r.titulo) + '.xlsx';
    baixar(arq, XL.gerar(folhas));
    registrarExportacao('registros', r.titulo, arq, folhas.length);
  };
  function dadosBloco(b, res) {
    var cab = [rotuloAlvo(res.consulta.eixo) || 'Total'].concat(res.consulta.legenda ? [rotuloAlvo(res.consulta.legenda)] : []);
    res.valores.forEach(function (v) { cab.push(v.nome); cab.push(v.nome + ' — unidade'); });
    var linhas = [{ c: cab, s: 1 }];
    res.eixo.forEach(function (e) {
      res.legendas.forEach(function (lg) {
        var l = [res.rotEixo(e)].concat(res.consulta.legenda ? [res.rotLeg(lg)] : []);
        res.valores.forEach(function (v, vi) { var r = res.celulas[vi][chaveGrupo(e, lg)] || {}; l.push(typeof r.v === 'number' ? (v.formato === 'pct' ? r.v : r.v) : (r.erro ? 'erro: ' + r.erro : r.semRelacao ? 'não se relaciona' : '')); l.push(v.formato === 'pct' ? 'fração (1 = 100%)' : (r.u || '')); });
        linhas.push({ c: l });
      });
    });
    if (res.consulta.eixo) { var t = ['Total'].concat(res.consulta.legenda ? [''] : []); res.valores.forEach(function (v, vi) { var r = res.geral[vi] || {}; t.push(typeof r.v === 'number' ? r.v : ''); t.push(v.formato === 'pct' ? 'fração (1 = 100%)' : (r.u || '')); }); linhas.push({ c: t, s: 1 }); }
    return linhas;
  }
  function parametros(p, b, res) {
    var l = [{ c: ['Parâmetro', 'Valor'], s: 1 }, { c: ['Painel', p ? p.Nome : ''] }, { c: ['Bloco', tituloBloco(b)] }, { c: ['Gerado em', agora()] }, { c: ['Usuário', usuarioNome() + ' (' + usuarioLogin() + ')'] }, { c: ['Versão', 'MES LION 1.0 JSON · painéis ' + VERSAO] }];
    var per = res.consulta.periodo || {}; l.push({ c: ['Período', (per.de ? rotuloMes(per.de) : 'início') + ' a ' + (per.ate ? rotuloMes(per.ate) : 'hoje')] });
    A(res.consulta.filtros).forEach(function (f) { if (A(f.valores).length) l.push({ c: ['Filtro: ' + rotuloAlvo(f.alvo), (f.op === 'fora' ? 'fora de ' : '') + f.valores.join(', ')] }); });
    res.valores.forEach(function (v) { l.push({ c: ['Regra: ' + v.nome, v.formula + (v.ind ? ' (indicador ' + (v.ind.Oficial === 'Sim' ? 'oficial' : 'pessoal') + ', versão ' + v.ind.Versao + ')' : '')] }); });
    res.cobertura.forEach(function (c) { l.push({ c: ['Faltam dados', c] }); });
    res.avisos.forEach(function (c) { l.push({ c: ['Aviso', c] }); });
    return l;
  }
  /* histórico de modificações: quem exportou o quê (o arquivo é gerado aqui no navegador) */
  function registrarExportacao(tipo, nome, arquivo, abas) {
    try { fetch('/api/relatorios/exportacao', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relatorio: 'painel_' + tipo, nome: nome, arquivo: arquivo || '', abas: String(abas || '') }) }).catch(function () { }); } catch (e) { }
  }
  window.mesBlocoExcel = function (bid) {
    var p = painelPor(estadoPainel.id), b = p && A(p.Blocos).find(function (x) { return x.id === bid; }), res = estadoPainel.resultados[bid], XL = window.mesXlsx;
    if (!b || !res || !XL) return alert('Gerador de Excel indisponível.');
    var dados = dadosBloco(b, res), par = parametros(p, b, res), arq = nomeArq(p.Nome + '_' + tituloBloco(b)) + '.xlsx';
    baixar(arq, XL.gerar([{ nome: 'Dados', xml: XL.folha(dados, { congelar: 1, larguras: larguras(dados), ativa: true }) }, { nome: 'Parâmetros', xml: XL.folha(par, { larguras: [26, 90] }) }]));
    registrarExportacao('bloco', p.Nome + ' › ' + tituloBloco(b), arq, 2);
  };
  window.mesPainelExcel = function () {
    var p = painelPor(estadoPainel.id), XL = window.mesXlsx; if (!p || !XL) return alert('Gerador de Excel indisponível.');
    var folhas = [], usados = {};
    A(p.Blocos).forEach(function (b, i) {
      var res = estadoPainel.resultados[b.id]; if (!res) return;
      var linhas = dadosBloco(b, res).concat([{ c: [] }]).concat(parametros(p, b, res));
      folhas.push({ nome: nomeAba((i + 1) + ' ' + tituloBloco(b), usados), xml: XL.folha(linhas, { congelar: 1, larguras: larguras(linhas), ativa: !folhas.length }) });
    });
    if (!folhas.length) return;
    var arq = nomeArq(p.Nome) + '.xlsx';
    baixar(arq, XL.gerar(folhas));
    registrarExportacao('painel', p.Nome, arq, folhas.length);
  };

  /* ---------------------------------------------------------------------
     11) EDITOR DO BLOCO: campos dos módulos (arrastar ou "+"), Eixo, Legenda, Valores e Filtros, tipo de visual,
         regra de cálculo (conferida na hora, com o valor de agora), opções e prévia com os números de verdade
     --------------------------------------------------------------------- */
  var ed = null;
  var FORMATOS = [['num', 'Número'], ['int', 'Inteiro'], ['moeda', 'R$'], ['pct', '%']];
  var ROT_AGG = { soma: 'Soma', media: 'Média', min: 'Mínimo', max: 'Máximo', contar: 'Registros', 'contar.distinto': 'Distintos' };
  function telaAtual() { try { return current; } catch (e) { return ''; } }
  function proximaLinha(p) { return A(p.Blocos).reduce(function (m, b) { return Math.max(m, N(b.y) + N(b.h)); }, 0); }
  function campoDe(o) { var tb = tabela(o && o.tabela); return tb ? campo(tb, o.campo) : null; }
  function aggsDoCampo(o) { var f = campoDe(o); if (!f) return ['contar']; return f.t === 'num' ? (f.taxa ? ['media', 'min', 'max', 'contar'] : ['soma', 'media', 'min', 'max', 'contar']) : ['contar.distinto', 'contar']; }
  function formulaCampo(o) { return FUNCOES[o.agg].rot + '(' + rotTabela(o.tabela) + '[' + o.campo + '])'; }
  function nomeCampo(o) { var f = campoDe(o), l = f ? f.l : o.campo; return o.agg === 'soma' ? l : ROT_AGG[o.agg] + ' — ' + l; }
  function valorDoCampo(o) {
    var f = campoDe(o), aggs = aggsDoCampo(o), agg = aggs.indexOf(o.agg) >= 0 ? o.agg : aggs[0], x = { tabela: o.tabela, campo: o.campo, agg: agg };
    var formato = agg === 'contar' || agg === 'contar.distinto' ? 'int' : (f && f.u === 'R$' ? 'moeda' : 'num');
    return { nome: nomeCampo(x), nomeAuto: true, formula: formulaCampo(x), formato: formato, casas: formato === 'int' ? 0 : '', origem: x };
  }
  /* campo com dimensão vira a dimensão (liga com as outras tabelas, como numa relação do Power BI) */
  function alvoDoItem(it) {
    if (it.k === 'dim') return dim(it.dim);
    if (it.k !== 'campo') return null;
    var f = campoDe(it); return f && f.dim ? dim(f.dim) : cmp(it.tabela, it.campo);
  }
  function referenciaTexto(it) {
    if (it.k === 'ind') { var i = indicadorPor(it.id); return i ? '[' + i.Nome + ']' : ''; }
    if (it.k === 'campo') return rotTabela(it.tabela) + '[' + it.campo + ']';
    return '';
  }
  function avisoEd(m) { var a = el('mpn_ed_aviso'); if (a) { a.className = 'mpn-msg' + (m ? ' alerta' : ''); a.textContent = m || ''; } }
  window.mesBlocoEditar = function (id) {
    var p = painelPor(estadoPainel.id); if (!p || !podeEditarPainel(p)) return;
    var b0 = id ? A(p.Blocos).find(function (x) { return x.id === id; }) : null;
    var b = b0 ? clone(b0) : { id: idNovo('BL'), titulo: '', visual: 'colunas', x: 0, y: proximaLinha(p), w: 6, h: 3, eixo: null, legenda: null, valores: [], filtros: [] };
    b.valores = A(b.valores); b.filtros = A(b.filtros);
    ed = { painel: p, novo: !b0, b: b, busca: '', editando: null };
    var corpo = '<div class="mpn-ed">' +
      '<div class="mpn-col mpn-campos"><h4>Campos dos módulos</h4><input type="search" id="mpn_ed_busca" placeholder="Procurar campo ou indicador…" oninput="mesEdBusca(this.value)">' +
      '<div class="muted" style="font-size:10.5px;margin:0 0 4px">Arraste para Eixo, Legenda, Valores, Filtros ou para a caixa da regra; ou use o "+".</div><div id="mpn_ed_arvore"></div></div>' +
      '<div class="mpn-col"><div class="mpn-msg" id="mpn_ed_aviso"></div><div id="mpn_ed_pocos"></div>' + regraHTML() + '<div id="mpn_ed_opcoes"></div></div>' +
      '<div class="mpn-col"><h4>Prévia (com os filtros do painel)</h4><div class="mpn-previa"><div class="mpn-bloco-cab"><h4 id="mpn_ed_ptit"></h4></div><div class="mpn-corpo" id="mpn_ed_corpo"></div></div>' +
      '<div class="mpn-acoes" style="margin-top:8px"><button class="secondary" onclick="mesEdCalculo()">Cálculo aberto (total)</button><button class="secondary" onclick="mesBlocoRegistros(\'__editor\',-1,null,0)">Ver os registros</button></div>' +
      '<div id="mpn_ed_info" style="font-size:11.5px;margin-top:8px;color:#355566"></div></div></div>';
    var o = janela((ed.novo ? 'Novo bloco' : 'Editar bloco') + ' — ' + p.Nome, corpo, '<button onclick="mesEdSalvar()">Salvar bloco</button>');
    o.setAttribute('data-editor', '1');
    var ta = el('mpn_ed_formula'); if (ta) ligarPocos(ta.parentNode);
    arvore(); montagem(); previa();
  };
  function itemArvore(dados, rotulo, extra, icone, titulo) {
    return '<div class="mpn-item" draggable="true" data-item="' + esc(JSON.stringify(dados)) + '" title="' + esc(titulo || rotulo) + '"><span class="ic">' + icone + '</span><span>' + esc(rotulo) + '</span>' +
      (extra ? '<em>' + esc(extra) + '</em>' : '') + '<span class="mais" data-mais="1" title="Adicionar ao bloco">+</span></div>';
  }
  function arvore() {
    var a = el('mpn_ed_arvore'); if (!a || !ed) return;
    var q = norm(ed.busca), casa = function (s) { return !q || norm(s).indexOf(q) >= 0; }, h = '';
    var inds = indicadores().filter(visivel);
    var of = inds.filter(function (i) { return i.Oficial === 'Sim' && (casa(i.Nome) || casa(i.Area)); });
    var meus = inds.filter(function (i) { return i.Oficial !== 'Sim' && (casa(i.Nome) || casa(i.Area)); });
    if (of.length) h += '<details open><summary>★ Indicadores oficiais (' + of.length + ')</summary>' + of.map(function (i) { return itemArvore({ k: 'ind', id: i.IdIndicador }, i.Nome, i.Area, '★', i.Descricao); }).join('') + '</details>';
    if (meus.length) h += '<details open><summary>☆ Meus e compartilhados (' + meus.length + ')</summary>' + meus.map(function (i) { return itemArvore({ k: 'ind', id: i.IdIndicador }, i.Nome, i.Area, '☆', i.Descricao); }).join('') + '</details>';
    var ds = Object.keys(DIMS).filter(function (k) { return casa(DIMS[k]); });
    if (ds.length) h += '<details' + (q ? ' open' : '') + '><summary>⧉ Dimensões (ligam as tabelas)</summary>' + ds.map(function (k) {
      var n = TABELAS.filter(function (t) { return t.campos.some(function (f) { return f.dim === k; }); }).length;
      return itemArvore({ k: 'dim', dim: k }, DIMS[k], n + ' tabela(s)', '⧉', 'Liga as ' + n + ' tabelas que têm ' + DIMS[k]);
    }).join('') + '</details>';
    TABELAS.forEach(function (tb) {
      var fs = tb.campos.filter(function (f) { return casa(f.l) || casa(f.k) || casa(tb.nome); });
      if (!fs.length) return;
      h += '<details' + (q ? ' open' : '') + '><summary>▦ ' + esc(tb.nome) + '</summary>' + fs.map(function (f) {
        return itemArvore({ k: 'campo', tabela: tb.id, campo: f.k }, f.l, f.t === 'num' ? (f.u || (f.um ? 'UM da linha' : '')) : (f.dim ? 'liga' : ''), f.t === 'num' ? 'Σ' : (f.t === 'data' ? '◷' : 'Aa'),
          rotTabela(tb.id) + '[' + f.k + ']' + (f.c ? ' — ' + f.c : '') + (f.taxa ? ' (taxa da linha: não se soma)' : '') + (f.unico ? ' (repete por ' + f.unico + ': conta uma vez por ' + f.unico + ')' : ''));
      }).join('') + '</details>';
    });
    a.innerHTML = h || '<div class="mpn-vazio">Nada encontrado.</div>';
    a.querySelectorAll('.mpn-item').forEach(function (n) {
      n.addEventListener('dragstart', function (ev) { try { ev.dataTransfer.setData('text/plain', n.getAttribute('data-item')); ev.dataTransfer.effectAllowed = 'copy'; } catch (e) { } });
    });
    a.onclick = function (ev) { var m = ev.target.closest('[data-mais]'); if (!m) return; var it = m.closest('.mpn-item'); menuAdicionar(ev, JSON.parse(it.getAttribute('data-item'))); };
  }
  function menuAdicionar(ev, it) {
    var f = it.k === 'campo' ? campoDe(it) : null, op = [];
    if (it.k === 'ind') op.push(['Valores', function () { soltar('valores', it); }]);
    else if (it.k === 'dim' || (f && f.t !== 'num')) {
      op.push(['Eixo', function () { soltar('eixo', it); }], ['Legenda', function () { soltar('legenda', it); }], ['Filtros do bloco', function () { soltar('filtros', it); }]);
      if (f) op.push(['Valores — distintos', function () { soltar('valores', it, 'contar.distinto'); }], ['Valores — registros', function () { soltar('valores', it, 'contar'); }]);
    } else if (f) aggsDoCampo(it).forEach(function (a) { op.push(['Valores — ' + ROT_AGG[a].toLowerCase(), function () { soltar('valores', it, a); }]); });
    if (it.k !== 'dim') op.push(['Inserir na regra de cálculo', function () { soltar('formula', it); }]);
    var r = ev.target.getBoundingClientRect();
    popover(r.right + 4, r.top, it.k === 'ind' ? ((indicadorPor(it.id) || {}).Nome || '') : (it.k === 'dim' ? DIMS[it.dim] : (f ? f.l : '')), op);
  }
  function soltar(poco, it, agg) {
    if (!ed || !it) return;
    var b = ed.b, f = it.k === 'campo' ? campoDe(it) : null;
    if (poco === 'formula') { var t = referenciaTexto(it); if (!t) return avisoEd('As dimensões entram no Eixo, na Legenda ou nos Filtros; na fórmula use Tabela[Campo] ou [Indicador].'); inserirTexto('mpn_ed_formula', t); return mesEdValidar(); }
    if (poco === 'eixo' || poco === 'legenda') {
      var onde = poco === 'eixo' ? 'no Eixo' : 'na Legenda';
      if (it.k === 'ind') return avisoEd('Indicador vai em Valores. ' + (poco === 'eixo' ? 'No Eixo' : 'Na Legenda') + ' vai uma dimensão ou um campo de texto.');
      if (f && f.t === 'num') return avisoEd(f.l + ' é um número: arraste para Valores (' + onde + ' vai uma dimensão ou um campo de texto).');
      var alvo = alvoDoItem(it), outro = poco === 'eixo' ? b.legenda : b.eixo;
      if (outro && JSON.stringify(outro) === JSON.stringify(alvo)) return avisoEd('O eixo e a legenda não podem ser o mesmo campo.');
      b[poco] = alvo;
    } else if (poco === 'valores') {
      if (it.k === 'dim') return avisoEd('Dimensão não é valor: arraste para o Eixo, a Legenda ou os Filtros. Para contar, use um campo de texto de uma tabela (ex.: Produção › OP) e escolha "distintos".');
      b.valores.push(it.k === 'ind' ? { indicador: it.id } : valorDoCampo({ tabela: it.tabela, campo: it.campo, agg: agg }));
    } else if (poco === 'filtros') {
      if (it.k === 'ind') return avisoEd('Filtre por uma dimensão ou um campo; o indicador vai em Valores.');
      if (f && f.t === 'num') return avisoEd('O filtro é por lista de valores: use um campo de texto ou uma dimensão. Para condição numérica use a regra de cálculo: SOMA(Tabela[Campo]; Tabela[Outro] > 0).');
      b.filtros.push({ alvo: alvoDoItem(it), op: 'em', valores: [] });
    } else return;
    avisoEd(''); montagem(); previa();
  }
  function ligarPocos(raiz) {
    raiz.querySelectorAll('[data-poco]').forEach(function (n) {
      if (n.__mpnPoco) return; n.__mpnPoco = 1;
      n.addEventListener('dragover', function (ev) { ev.preventDefault(); try { ev.dataTransfer.dropEffect = 'copy'; } catch (e) { } n.classList.add('sobre'); });
      n.addEventListener('dragleave', function () { n.classList.remove('sobre'); });
      n.addEventListener('drop', function (ev) {
        ev.preventDefault(); n.classList.remove('sobre');
        var t = ''; try { t = ev.dataTransfer.getData('text/plain'); } catch (e) { t = ''; }
        var it = null; try { it = JSON.parse(t); } catch (e) { it = null; }
        if (it && it.k) soltar(n.getAttribute('data-poco'), it);
      });
    });
  }
  function poco(k, itens, dica) { return '<div class="mpn-poco" data-poco="' + k + '">' + (itens.length ? itens.join('') : '<div class="dica">' + esc(dica) + '</div>') + '</div>'; }
  function chipAlvo(a, k) { return '<div class="mpn-val"><div class="mpn-val-top"><b>' + esc(rotuloAlvo(a)) + '</b><span title="Tirar" onclick="mesEdTirar(\'' + k + '\')">✕</span></div></div>'; }
  function dicaVisual(b) {
    var v = b.visual, n = A(b.valores).length;
    if ((v === 'cartao' || v === 'medidor') && (b.eixo || b.legenda)) return 'Cartão e medidor mostram o total: o eixo e a legenda não entram.';
    if ((v === 'cartao' || v === 'medidor') && n > 1) return 'Cartão e medidor mostram só o primeiro valor.';
    if (v === 'pizza' && !b.eixo) return 'A pizza precisa de um eixo (as fatias).';
    if (v === 'matriz' && !(b.eixo && b.legenda)) return 'A matriz cruza o Eixo (linhas) com a Legenda (colunas).';
    if (v === 'dispersao' && (n < 2 || !b.eixo)) return 'A dispersão precisa de um eixo (os pontos) e de dois valores (X e Y).';
    if (['colunas', 'empilhadas', 'barras', 'linhas', 'combinado'].indexOf(v) >= 0 && !b.eixo) return 'Sem eixo o gráfico tem uma categoria só (Total).';
    if (v === 'combinado' && n < 2) return 'Barras + linha: o primeiro valor vira barras e os outros, linhas (com eixo à direita se a unidade for outra).';
    return '';
  }
  function montagem() {
    var m = el('mpn_ed_pocos'); if (!m || !ed) return;
    var b = ed.b, dica = dicaVisual(b);
    var h = '<h4>Tipo de visual</h4><div class="mpn-tipos">' + VISUAIS.map(function (v) { return '<span class="' + (b.visual === v[0] ? 'on' : '') + '" onclick="mesEdVisual(\'' + v[0] + '\')">' + esc(v[1]) + '</span>'; }).join('') + '</div>' +
      (dica ? '<div class="mpn-msg alerta">' + esc(dica) + '</div>' : '');
    h += '<h4>Eixo (categorias)</h4>' + poco('eixo', b.eixo ? [chipAlvo(b.eixo, 'eixo')] : [], 'Arraste uma dimensão ou um campo de texto (ex.: Mês, Química, Motivo).');
    h += '<h4>Legenda (séries)</h4>' + poco('legenda', b.legenda ? [chipAlvo(b.legenda, 'legenda')] : [], 'Opcional: separa as séries (ex.: Modelo da célula).');
    h += '<h4>Valores</h4>' + poco('valores', b.valores.map(valorHTML), 'Arraste um indicador (★) ou um campo numérico (Σ).');
    h += '<h4>Filtros só deste bloco</h4>' + poco('filtros', b.filtros.map(filtroHTML), 'Arraste uma dimensão ou um campo de texto.');
    m.innerHTML = h; ligarPocos(m);
    var o = el('mpn_ed_opcoes'); if (o) o.innerHTML = opcoesHTML();
  }
  function opcoesSelect(lst, atual) { return lst.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(atual) === String(x[0]) ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join(''); }
  function valorHTML(vc, i) {
    var r = resolverValor(vc), ind = r.ind;
    var top = '<div class="mpn-val-top"><b>' + esc(r.nome) + '</b>' + (ind ? '<span class="mpn-tag ' + (ind.Oficial === 'Sim' ? 'of' : 'eu') + '" style="cursor:default">' + (ind.Oficial === 'Sim' ? 'oficial' : 'pessoal') + '</span>' : '') +
      '<span title="Subir" onclick="mesEdMover(' + i + ',-1)">↑</span><span title="Descer" onclick="mesEdMover(' + i + ',1)">↓</span>' +
      (!vc.indicador ? '<span title="Editar a regra" onclick="mesEdEditarRegra(' + i + ')">✎</span>' : '') + '<span title="Tirar" onclick="mesEdTirarValor(' + i + ')">✕</span></div>';
    var op = '<div class="mpn-val-op">';
    if (vc.origem && !vc.editada) op += '<select title="Conta" onchange="mesEdAgg(' + i + ',this.value)">' + opcoesSelect(aggsDoCampo(vc.origem).map(function (a) { return [a, ROT_AGG[a]]; }), vc.origem.agg) + '</select>';
    op += '<label style="display:inline-flex;gap:3px;align-items:center;font-size:11px;font-weight:400;margin:0"><input type="checkbox"' + (vc.acumulado ? ' checked' : '') + ' onchange="mesEdOpcaoValor(' + i + ',\'acumulado\',this.checked)">acumulado</label>';
    op += '<select title="Formato" onchange="mesEdOpcaoValor(' + i + ',\'formato\',this.value)">' + opcoesSelect(FORMATOS, vc.formato || (ind ? ind.Formato : 'num')) + '</select>';
    op += '<input type="number" min="0" max="6" title="Casas decimais" placeholder="casas" style="width:58px" value="' + esc(vc.casas == null ? '' : vc.casas) + '" onchange="mesEdOpcaoValor(' + i + ',\'casas\',this.value)">';
    op += '<input type="text" title="Nome no gráfico" placeholder="nome no gráfico" value="' + esc(vc.nomeAuto ? '' : (vc.nome || '')) + '" onchange="mesEdOpcaoValor(' + i + ',\'nome\',this.value)"></div>';
    return '<div class="mpn-val">' + top + op + '<code>' + esc(r.formula || '') + '</code>' + (r.erro ? '<div class="mpn-msg erro">' + esc(r.erro) + '</div>' : '') + '</div>';
  }
  function valoresParaFiltro(alvo) {
    if (alvo.tipo === 'campo') return valoresDistintos(alvo, [alvo.tabela]);
    var ids = tabelasDe({ valores: ed.b.valores });
    return valoresDistintos(alvo, ids.length ? ids : null);
  }
  function filtroHTML(fl, i) {
    var vals = valoresParaFiltro(fl.alvo), sel = A(fl.valores);
    sel.forEach(function (v) { if (vals.indexOf(v) < 0) vals.unshift(v); });
    return '<div class="mpn-val"><div class="mpn-val-top"><b>' + esc(rotuloAlvo(fl.alvo)) + '</b><span title="Tirar" onclick="mesEdTirarFiltro(' + i + ')">✕</span></div><div class="mpn-val-op">' +
      '<select onchange="mesEdFiltroOp(' + i + ',this.value)">' + opcoesSelect([['em', 'é um de'], ['fora', 'não é']], fl.op === 'fora' ? 'fora' : 'em') + '</select>' +
      '<select multiple size="' + Math.min(6, Math.max(2, vals.length)) + '" style="max-width:230px;min-width:170px" onchange="mesEdFiltroValores(' + i + ',this)">' +
      vals.map(function (v) { return '<option value="' + esc(v) + '"' + (sel.indexOf(v) >= 0 ? ' selected' : '') + '>' + esc(rotuloValor(fl.alvo, v)) + '</option>'; }).join('') + '</select></div>' +
      (sel.length ? '' : '<div class="muted" style="font-size:10.5px">Nenhum valor marcado: o filtro ainda não corta nada (Ctrl + clique marca vários).</div>') + '</div>';
  }
  var AJUDA = [
    ['SOMA(Tabela[Campo]; condição)', 'Soma do campo nas linhas do grupo; a condição (opcional) usa campos da mesma tabela.', 'SOMA('],
    ['MÉDIA(Tabela[Campo]; condição)', 'Média simples das linhas.', 'MÉDIA('],
    ['MÍN(…) e MÁX(…)', 'Menor e maior valor.', 'MÁX('],
    ['CONTAR(Tabela) ou CONTAR(Tabela[Campo])', 'Registros (com valor no campo).', 'CONTAR('],
    ['CONTAR.DISTINTO(Tabela[Campo])', 'Valores diferentes (ex.: OPs distintas).', 'CONTAR.DISTINTO('],
    ['DIVIDIR(a; b; se_zero)', 'a ÷ b; com b zero ou vazio fica "faltam dados" (ou o 3º argumento).', 'DIVIDIR('],
    ['SE(condição; então; senão)', 'Escolhe um dos dois valores.', 'SE('],
    ['E(…) · OU(…) · NÃO(…)', 'Combina condições: E(Perdas[Alvo] = "Produto"; Perdas[TipoOP] = "PA").', 'E('],
    ['ACUMULADO(expressão)', 'Soma do início do eixo até o ponto (ex.: acumulado por mês).', 'ACUMULADO('],
    ['ANTERIOR(expressão)', 'O valor no ponto anterior do eixo (ex.: mês anterior).', 'ANTERIOR('],
    ['ARRED(x; casas) · ABS(x) · MAIOR(a; b) · MENOR(a; b)', 'Arredonda, valor absoluto, maior e menor.', 'ARRED('],
    ['[Indicador]', 'Usa outro indicador (sub-indicador): [Disponibilidade] * [Performance] * [Qualidade].', '[']
  ];
  function ajudaFuncoes(alvo) {
    return AJUDA.map(function (a, i) { return '<div style="margin:0 0 4px"><a href="javascript:void(0)" onclick="mesInserirAjuda(\'' + alvo + '\',' + i + ')" style="font-family:Consolas,monospace;font-weight:700">' + esc(a[0]) + '</a> — ' + esc(a[1]) + '</div>'; }).join('') +
      '<div class="muted" style="margin-top:6px">Argumentos separados por ";", decimais com vírgula ou ponto, texto entre aspas ("PA"). Tabela com espaço no nome vai entre aspas simples: \'Tempos de máquina\'[OperacaoMin]. Operadores: + − * / ^ = &lt;&gt; &lt; &gt; &lt;= &gt;=. Sem dado, o resultado fica "faltam dados" — nunca zero inventado.</div>';
  }
  window.mesInserirAjuda = function (alvo, i) { var a = AJUDA[i]; if (!a) return; inserirTexto(alvo, a[2]); if (alvo === 'mpn_ed_formula') mesEdValidar(); else mesIndValidar(); };
  function regraHTML() {
    return '<h4 style="margin-top:6px">Regra de cálculo</h4><p class="muted" style="font-size:11px;margin:0 0 6px">Escreva a fórmula ou arraste campos e indicadores para dentro da caixa: ela é conferida na hora (unidades, campos, sub-indicadores) e mostra o valor de agora.</p>' +
      '<div class="mpn-form"><label class="wide">Nome<input id="mpn_ed_fnome" placeholder="ex.: Custo das perdas por célula"></label>' +
      '<label class="wide">Fórmula<textarea id="mpn_ed_formula" data-poco="formula" spellcheck="false" placeholder="DIVIDIR(SOMA(Perdas[Custo]); [Células produzidas])" oninput="mesEdValidar()"></textarea></label>' +
      '<label>Formato<select id="mpn_ed_fformato" onchange="mesEdValidar()">' + opcoesSelect(FORMATOS, 'num') + '</select></label><label>Casas decimais<input id="mpn_ed_fcasas" type="number" min="0" max="6" placeholder="automático" onchange="mesEdValidar()"></label></div>' +
      '<div class="mpn-msg" id="mpn_ed_fmsg"></div>' +
      '<div class="mpn-acoes"><button class="mini" id="mpn_ed_fadd" onclick="mesEdAddRegra()">Adicionar ao bloco</button><button class="mini secondary" onclick="mesEdRegraIndicador()">Salvar como indicador</button><button class="mini secondary" onclick="mesEdAjuda(\'mpn_ed_ajuda\')">Funções</button></div>' +
      '<div id="mpn_ed_ajuda" class="mpn-aberto" style="display:none;margin-top:6px;font-family:inherit">' + ajudaFuncoes('mpn_ed_formula') + '</div>';
  }
  function inserirTexto(id, t) {
    var a = el(id); if (!a) return;
    var i = a.selectionStart == null ? a.value.length : a.selectionStart, j = a.selectionEnd == null ? i : a.selectionEnd;
    a.value = a.value.slice(0, i) + t + a.value.slice(j); a.focus(); var p = i + t.length; try { a.setSelectionRange(p, p); } catch (e) { }
  }
  window.mesEdValidar = function () { if (!ed) return; clearTimeout(ed.tv); ed.tv = setTimeout(validarRegra, 250); };
  function validarRegra() {
    var m = el('mpn_ed_fmsg'), f = val('mpn_ed_formula'); if (!m || !ed) return null;
    if (!txt(f)) { m.className = 'mpn-msg'; m.textContent = ''; return null; }
    var c = compilar(f);
    if (c.erro) { m.className = 'mpn-msg erro'; m.textContent = c.erro + (c.pos != null ? ' (posição ' + (c.pos + 1) + ')' : ''); return null; }
    var tabs = Object.keys(c.info.tabelas), inds = Object.keys(c.info.inds).map(function (i) { var x = indicadorPor(i); return x ? x.Nome : i; });
    var cfg = { valores: [{ formula: f, formato: val('mpn_ed_fformato') || 'num', casas: val('mpn_ed_fcasas') }], filtros: ed.b.filtros, periodoProprio: ed.b.periodoProprio, periodo: ed.b.periodo };
    montarTabelas(tabs);
    var r = executar(cfg, filtrosDoPainel(ed.painel)), g = r.geral[0];
    if (g && (g.erro || g.semRelacao)) {
      m.className = 'mpn-msg erro';
      m.innerHTML = 'A fórmula está escrita certo, mas o cálculo não fecha: ' + esc(g.erro || ('não se relaciona — ' + g.semRelacao)) + (g.erro && /unidades/.test(g.erro) ? '<br>Dica: filtre uma unidade (ex.: Produção[UM] = "un") ou use um eixo que separe as unidades (produto, material).' : '');
      return c;
    }
    m.className = 'mpn-msg ' + (c.info.avisos.length || r.cobertura.length ? 'alerta' : 'ok');
    m.innerHTML = '✓ Fórmula válida. Usa ' + esc(tabs.map(function (t) { return tabela(t).nome; }).join(', ') || 'só números') + (inds.length ? ' (com ' + esc(inds.join(', ')) + ')' : '') +
      '. Valor agora, com os filtros do painel e do bloco: <b>' + esc(textoValor(g, r.valores[0].formato, r.valores[0].casas)) + '</b>' +
      c.info.avisos.map(function (a) { return '<br>⚠ ' + esc(a); }).join('') + r.cobertura.map(function (a) { return '<br>Faltam dados — ' + esc(a); }).join('');
    return c;
  }
  function limparRegra() {
    ['mpn_ed_fnome', 'mpn_ed_formula', 'mpn_ed_fcasas'].forEach(function (k) { if (el(k)) el(k).value = ''; });
    if (el('mpn_ed_fformato')) el('mpn_ed_fformato').value = 'num';
    var m = el('mpn_ed_fmsg'); if (m) { m.textContent = ''; m.className = 'mpn-msg'; }
    if (el('mpn_ed_fadd')) el('mpn_ed_fadd').textContent = 'Adicionar ao bloco';
    if (ed) ed.editando = null;
  }
  window.mesEdAddRegra = function () {
    if (!ed) return;
    var f = txt(val('mpn_ed_formula')); if (!f) return avisoEd('Escreva a fórmula da regra de cálculo.');
    var c = compilar(f); if (c.erro) { validarRegra(); return; }
    var v = { nome: txt(val('mpn_ed_fnome')) || f, formula: f, formato: val('mpn_ed_fformato') || 'num', casas: txt(val('mpn_ed_fcasas')) === '' ? '' : N(val('mpn_ed_fcasas')) };
    var ant = ed.editando != null ? ed.b.valores[ed.editando] : null;
    if (ant) { v.acumulado = !!ant.acumulado; if (ant.origem && ant.formula === f) { v.origem = ant.origem; } else v.editada = true; ed.b.valores[ed.editando] = v; } else ed.b.valores.push(v);
    limparRegra(); avisoEd(''); montagem(); previa();
  };
  window.mesEdEditarRegra = function (i) {
    var v = ed && ed.b.valores[i]; if (!v || v.indicador) return;
    el('mpn_ed_fnome').value = v.nomeAuto ? '' : (v.nome || ''); el('mpn_ed_formula').value = v.formula || ''; el('mpn_ed_fformato').value = v.formato || 'num'; el('mpn_ed_fcasas').value = v.casas == null ? '' : v.casas;
    ed.editando = i; el('mpn_ed_fadd').textContent = 'Atualizar o valor ' + (i + 1); validarRegra(); el('mpn_ed_formula').focus();
  };
  window.mesEdRegraIndicador = function () {
    if (!ed) return;
    var f = txt(val('mpn_ed_formula')), nome = txt(val('mpn_ed_fnome'));
    if (!f) return avisoEd('Escreva a fórmula da regra de cálculo.');
    if (!nome) { nome = prompt('Nome do indicador:', ''); if (!txt(nome)) return; }
    var oficial = admin() && confirm('Salvar "' + nome + '" como indicador OFICIAL? Todos veem e só o administrador altera.\n\nCancelar = indicador pessoal (só seu).');
    var r = salvarIndicador({ Nome: nome, Formula: f, Formato: val('mpn_ed_fformato') || 'num', Casas: val('mpn_ed_fcasas'), Area: AREAS.indexOf(ed.painel.Area) >= 0 ? ed.painel.Area : 'Geral',
      Oficial: oficial ? 'Sim' : 'Não', Compartilhado: 'Não', Nota: 'Criado no editor do painel ' + ed.painel.Nome });
    if (r.erro) { var m = el('mpn_ed_fmsg'); if (m) { m.className = 'mpn-msg erro'; m.textContent = r.erro; } return; }
    var v = { indicador: r.indicador.IdIndicador };
    if (ed.editando != null && ed.b.valores[ed.editando]) { v.acumulado = !!ed.b.valores[ed.editando].acumulado; ed.b.valores[ed.editando] = v; } else ed.b.valores.push(v);
    limparRegra(); arvore(); montagem(); previa();
  };
  function opcoesHTML() {
    var b = ed.b, v0 = b.valores[0], pct = !!(v0 && resolverValor(v0).formato === 'pct'), per = b.periodo || {};
    var meta = b.meta === '' || b.meta == null ? '' : (pct ? arred(N(b.meta) * 100, 6) : b.meta), larg = [], alt = [];
    for (var i = 2; i <= 12; i++) larg.push([i, i]); for (var j = 1; j <= 8; j++) alt.push([j, j]);
    return '<h4 style="margin-top:6px">Opções</h4><div class="mpn-form">' +
      '<label class="wide">Título<input value="' + esc(b.titulo || '') + '" placeholder="' + esc(tituloBloco({ valores: b.valores })) + '" onchange="mesEdOpcao(\'titulo\',this.value)"></label>' +
      '<label>Ordem do eixo<select onchange="mesEdOpcao(\'ordem\',this.value)">' + opcoesSelect([['eixo', 'pelo eixo'], ['valor_desc', 'maior valor primeiro'], ['valor_asc', 'menor valor primeiro']], b.ordem || 'eixo') + '</select></label>' +
      '<label>Mostrar só os primeiros<input type="number" min="0" value="' + esc(b.topN || '') + '" placeholder="todos" onchange="mesEdOpcao(\'topN\',this.value)"></label>' +
      '<label>Meta' + (pct ? ' (%)' : '') + '<input type="number" step="any" value="' + esc(meta) + '" placeholder="a do indicador" onchange="mesEdMeta(this.value)"></label>' +
      '<label>Melhor quando<select onchange="mesEdOpcao(\'sentido\',this.value)">' + opcoesSelect([['', 'o do indicador'], ['maior', 'maior'], ['menor', 'menor']], b.sentido || '') + '</select></label>' +
      '<label class="wide" style="flex-direction:row;align-items:center;gap:6px;font-weight:400"><input type="checkbox"' + (b.periodoProprio ? ' checked' : '') + ' onchange="mesEdOpcao(\'periodoProprio\',this.checked)"> Período próprio (não segue o período do painel)</label>' +
      (b.periodoProprio ? '<label>De (mês)<input type="month" value="' + esc(per.de || '') + '" onchange="mesEdPeriodo(\'de\',this.value)"></label><label>Até (mês)<input type="month" value="' + esc(per.ate || '') + '" onchange="mesEdPeriodo(\'ate\',this.value)"></label>' : '') +
      '<label>Largura (de 12 colunas)<select onchange="mesEdOpcao(\'w\',this.value)">' + opcoesSelect(larg, b.w) + '</select></label><label>Altura<select onchange="mesEdOpcao(\'h\',this.value)">' + opcoesSelect(alt, b.h) + '</select></label></div>';
  }
  function previa() {
    if (!ed) return;
    clearTimeout(ed.tp);
    ed.tp = setTimeout(function () {
      var c = el('mpn_ed_corpo'); if (!c || !ed) return;
      var bp = clone(ed.b); bp.id = '__editor';
      if (el('mpn_ed_ptit')) el('mpn_ed_ptit').textContent = tituloBloco(bp);
      if (!A(bp.valores).length) { c.innerHTML = '<div class="mpn-vazio">Arraste um indicador ou um campo para Valores.</div>'; if (el('mpn_ed_info')) el('mpn_ed_info').innerHTML = ''; delete estadoPainel.resultados.__editor; return; }
      montarTabelas(tabelasDe(bp));
      desenharBloco(bp, filtrosDoPainel(ed.painel), 'mpn_ed_corpo');
      var res = estadoPainel.resultados.__editor;
      if (el('mpn_ed_info')) el('mpn_ed_info').innerHTML = res ? infoLigacao(res) : '';
    }, 150);
  }
  /* de onde vêm os números do bloco: registros no recorte de cada tabela e o caminho da ligação do eixo e da legenda */
  function infoLigacao(res) {
    var ts = {}; res.valores.forEach(function (v) { if (v.info) Object.keys(v.info.tabelas).forEach(function (t) { ts[t] = 1; }); });
    var itens = Object.keys(ts).map(function (t) {
      var p = res.prep(t), tb = p.tb, partes = [];
      if (p.sem.length) return '<li><b>' + esc(tb.nome) + '</b>: não se relaciona (' + esc(p.sem.join(' e ')) + ')</li>';
      [['eixo', res.consulta.eixo], ['legenda', res.consulta.legenda]].forEach(function (x) { if (!x[1]) return; var f = campoDoAlvo(tb, x[1]); partes.push(x[0] + ' por ' + (f ? (f.c || tb.nome + ' → ' + f.l) : '—')); });
      return '<li><b>' + esc(tb.nome) + '</b>: ' + p.base.length + ' registro(s) no recorte' + (partes.length ? ' · ' + esc(partes.join(' · ')) : '') + '</li>';
    });
    return itens.length ? '<b>De onde vêm os números</b><ul style="margin:4px 0 0;padding-left:16px">' + itens.join('') + '</ul>' : '';
  }
  window.mesEdVisual = function (v) {
    if (!ed) return; var b = ed.b, era = b.visual; b.visual = v;
    if (ed.novo && v === 'cartao' && era !== 'cartao') { b.w = 3; b.h = 1; } else if (ed.novo && era === 'cartao' && v !== 'cartao') { b.w = 6; b.h = 3; }
    montagem(); previa();
  };
  window.mesEdOpcao = function (k, v) {
    if (!ed) return; var b = ed.b;
    if (k === 'topN') b.topN = N(v) > 0 ? Math.round(N(v)) : '';
    else if (k === 'w') b.w = Math.max(2, Math.min(12, N(v)));
    else if (k === 'h') b.h = Math.max(1, Math.min(8, N(v)));
    else if (k === 'periodoProprio') { b.periodoProprio = !!v; b.periodo = b.periodo || {}; montagem(); }
    else b[k] = v;
    previa();
  };
  window.mesEdMeta = function (v) { if (!ed) return; var b = ed.b, v0 = b.valores[0], pct = !!(v0 && resolverValor(v0).formato === 'pct'); b.meta = txt(v) === '' ? '' : (pct ? N(v) / 100 : N(v)); previa(); };
  window.mesEdPeriodo = function (k, v) { if (!ed) return; ed.b.periodo = ed.b.periodo || {}; ed.b.periodo[k] = v; previa(); };
  window.mesEdTirar = function (k) { if (!ed) return; ed.b[k] = null; montagem(); previa(); };
  window.mesEdTirarValor = function (i) { if (!ed) return; ed.b.valores.splice(i, 1); if (ed.editando === i) limparRegra(); else if (ed.editando > i) ed.editando--; montagem(); previa(); };
  window.mesEdMover = function (i, d) { if (!ed) return; var a = ed.b.valores, j = i + d; if (j < 0 || j >= a.length) return; var t = a[i]; a[i] = a[j]; a[j] = t; limparRegra(); montagem(); previa(); };
  window.mesEdAgg = function (i, agg) {
    var v = ed && ed.b.valores[i]; if (!v || !v.origem) return;
    var n = valorDoCampo({ tabela: v.origem.tabela, campo: v.origem.campo, agg: agg });
    v.origem = n.origem; v.formula = n.formula; v.formato = n.formato; v.casas = n.casas; if (v.nomeAuto) v.nome = n.nome;
    montagem(); previa();
  };
  window.mesEdOpcaoValor = function (i, k, x) {
    var v = ed && ed.b.valores[i]; if (!v) return;
    if (k === 'acumulado') v.acumulado = !!x;
    else if (k === 'nome') { if (txt(x)) { v.nome = txt(x); v.nomeAuto = false; } else { v.nomeAuto = true; v.nome = v.origem ? nomeCampo(v.origem) : (v.indicador ? '' : v.formula); if (v.indicador) delete v.nome; } }
    else if (k === 'casas') v.casas = txt(x) === '' ? '' : Math.max(0, Math.min(6, Math.round(N(x))));
    else if (k === 'formato') v.formato = x;
    if (k === 'acumulado' || k === 'formato' || k === 'nome') montagem();
    previa();
  };
  window.mesEdFiltroOp = function (i, op) { var f = ed && ed.b.filtros[i]; if (f) { f.op = op === 'fora' ? 'fora' : 'em'; previa(); } };
  window.mesEdFiltroValores = function (i, sel) { var f = ed && ed.b.filtros[i]; if (!f) return; f.valores = [].slice.call(sel.selectedOptions).map(function (o) { return o.value; }); previa(); };
  window.mesEdTirarFiltro = function (i) { if (!ed) return; ed.b.filtros.splice(i, 1); montagem(); previa(); };
  window.mesEdBusca = function (q) { if (!ed) return; ed.busca = q; arvore(); };
  window.mesEdAjuda = function (id) { var a = el(id); if (a) a.style.display = a.style.display === 'none' ? '' : 'none'; };
  window.mesEdCalculo = function () { var res = estadoPainel.resultados.__editor; if (!res || !res.valores.length) return; mostrarCalculo({ id: '__editor' }, res, 0, null, null); };
  window.mesEdSalvar = function () {
    var p = ed && ed.painel; if (!p || !podeEditarPainel(p)) return;
    var b = ed.b;
    if (!A(b.valores).length) return avisoEd('Coloque pelo menos um valor no bloco.');
    var ruins = A(b.valores).map(resolverValor).filter(function (r) { return r.erro; });
    if (ruins.length && !confirm('Há valor com erro na regra:\n' + ruins.map(function (r) { return '• ' + r.nome + ': ' + r.erro; }).join('\n') + '\n\nSalvar assim mesmo?')) return;
    b.w = Math.max(2, Math.min(12, N(b.w) || 6)); b.h = Math.max(1, Math.min(8, N(b.h) || 3));
    b.valores.forEach(function (v) { if (v.nomeAuto && v.indicador) delete v.nome; });
    p.Blocos = A(p.Blocos);
    var i = p.Blocos.findIndex(function (x) { return x.id === b.id; });
    if (i >= 0) p.Blocos[i] = b; else p.Blocos.push(b);
    arrumar(p); p.AtualizadoEm = agora(); p.AtualizadoPor = usuarioLogin(); salvar();
    fecharJanelas(); telaPainel();
  };

  /* ---------------------------------------------------------------------
     12) TELA: INDICADORES (biblioteca com a regra aberta, versão, histórico, valores e montador de sub-indicador)
     --------------------------------------------------------------------- */
  var filtroInd = { area: '', busca: '', tipo: '' };
  var edInd = null;
  function tagIndicador(i) {
    if (i.Oficial === 'Sim') return '<span class="mpn-tag of">oficial</span>';
    return '<span class="mpn-tag eu">' + (i.Dono === usuarioLogin() ? 'meu' : 'de ' + esc(i.Dono || '?')) + '</span>' + (i.Compartilhado === 'Sim' ? ' <span class="mpn-tag">compartilhado</span>' : '');
  }
  function metaTexto(i) { return i.Meta === '' || i.Meta == null ? '—' : (i.Sentido === 'menor' ? '≤ ' : i.Sentido === 'maior' ? '≥ ' : '') + formatar(N(i.Meta), i.Formato, i.Casas === '' || i.Casas == null ? null : N(i.Casas), ''); }
  function telaIndicadores() {
    estilo(); semear(); setCurrent('indicadores'); marcarNav('indicadores');
    cabecalho('Indicadores', 'A regra de cálculo de cada número dos painéis. Os oficiais só o administrador cria e altera, com versão e histórico; os pessoais são de cada usuário.');
    var q = norm(filtroInd.busca);
    var lst = indicadores().filter(visivel).filter(function (i) {
      if (filtroInd.area && i.Area !== filtroInd.area) return false;
      if (filtroInd.tipo === 'of' && i.Oficial !== 'Sim') return false;
      if (filtroInd.tipo === 'eu' && i.Oficial === 'Sim') return false;
      return !q || norm(i.Nome + ' ' + (i.Descricao || '') + ' ' + i.Formula + ' ' + i.IdIndicador).indexOf(q) >= 0;
    }).sort(function (a, b) { return (a.Oficial === 'Sim' ? 0 : 1) - (b.Oficial === 'Sim' ? 0 : 1) || AREAS.indexOf(a.Area) - AREAS.indexOf(b.Area) || String(a.Nome).localeCompare(String(b.Nome), 'pt-BR'); });
    var areas = AREAS.filter(function (a) { return indicadores().some(function (i) { return i.Area === a; }); });
    var h = '<div class="toolbar" id="mpn_toolbar"><button onclick="mesIndicadorEditar(\'\')">+ Novo indicador</button><button class="secondary" onclick="render(\'paineis\')">Painéis</button><button class="secondary" onclick="render(\'paineis_tabelas\')">Tabelas e relações</button></div>' +
      '<div class="mpn-bar"><label>Procurar<input id="mpn_i_busca" value="' + esc(filtroInd.busca) + '" placeholder="nome, fórmula…" onkeydown="if(event.key===\'Enter\')mesIndicadoresFiltrar()"></label>' +
      '<label>Área<select id="mpn_i_area"><option value="">Todas</option>' + areas.map(function (a) { return '<option' + (filtroInd.area === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select></label>' +
      '<label>Tipo<select id="mpn_i_tipo">' + opcoesSelect([['', 'Todos'], ['of', 'Oficiais'], ['eu', 'Pessoais']], filtroInd.tipo) + '</select></label><button onclick="mesIndicadoresFiltrar()">Filtrar</button>' +
      '<span class="muted" style="font-size:11.5px">' + lst.length + ' indicador(es)</span></div>';
    h += '<div class="table-wrap" style="max-height:none"><table class="mpn-tab-ind"><thead><tr><th>Indicador</th><th>Área</th><th>Regra de cálculo</th><th>Meta</th><th>Versão</th><th>Atualizado</th><th></th></tr></thead><tbody>' +
      (lst.length ? lst.map(linhaIndicador).join('') : '<tr><td colspan="7" class="muted">Nenhum indicador.</td></tr>') + '</tbody></table></div>';
    el('content').innerHTML = h;
  }
  function linhaIndicador(i) {
    var c = astIndicador(i, [i.IdIndicador]), pe = podeEditar(i), id = jsStr(i.IdIndicador);
    var comps = A(i.Componentes).map(function (x) { var k = indicadorPor(x); return k ? k.Nome : x; });
    return '<tr id="mpn_ind_' + esc(i.IdIndicador) + '"><td><b>' + esc(i.Nome) + '</b> ' + tagIndicador(i) + '<div class="muted" style="font-size:11px">' + esc(i.Descricao || '') + '</div>' +
      (comps.length ? '<div class="muted" style="font-size:11px">Abre em: ' + esc(comps.join(', ')) + '</div>' : '') + '</td>' +
      '<td>' + esc(i.Area || '') + '</td><td><code style="font-size:11px;white-space:pre-wrap;word-break:break-word">' + esc(i.Formula) + '</code>' + (c.erro ? '<div class="mpn-msg erro">' + esc(c.erro) + '</div>' : '') + '</td>' +
      '<td class="mpn-num">' + esc(metaTexto(i)) + '</td><td class="mpn-num">' + esc(i.Versao) + '</td><td style="font-size:11px">' + esc(i.AtualizadoEm || '') + '<br><span class="muted">' + esc(i.AtualizadoPor || '') + '</span></td>' +
      '<td style="white-space:nowrap"><button class="mini" onclick="mesIndicadorValores(\'' + id + '\')">Valores</button> <button class="mini secondary" onclick="mesIndicadorEditar(\'' + id + '\')">' + (pe ? 'Editar' : 'Ver') + '</button> ' +
      '<button class="mini secondary" onclick="mesIndicadorHistorico(\'' + id + '\')">Histórico</button> <button class="mini secondary" onclick="mesIndicadorDuplicar(\'' + id + '\')">Duplicar</button>' +
      (pe ? ' <button class="mini secondary" onclick="mesIndicadorExcluir(\'' + id + '\')">Excluir</button>' : '') + '</td></tr>';
  }
  window.mesIndicadoresFiltrar = function () { filtroInd = { busca: val('mpn_i_busca'), area: val('mpn_i_area'), tipo: val('mpn_i_tipo') }; telaIndicadores(); };
  function msgInd(tipo, t) { var m = el('mpn_ie_msg'); if (m) { m.className = 'mpn-msg ' + (tipo || ''); m.innerHTML = t || ''; } }
  function montadorHTML() {
    return '<details class="mpn-campos" style="margin:4px 0 8px" id="mpn_mo"><summary>Montar a partir de uma tabela de um módulo (sub-indicador)</summary><div class="mpn-form" style="margin-top:6px">' +
      '<label>Tabela<select id="mpn_mo_tab" onchange="mesMontadorTabela()">' + TABELAS.map(function (t) { return '<option value="' + t.id + '">' + esc(t.nome) + '</option>'; }).join('') + '</select></label>' +
      '<label>Conta<select id="mpn_mo_agg">' + opcoesSelect([['soma', 'Soma'], ['media', 'Média'], ['min', 'Mínimo'], ['max', 'Máximo'], ['contar', 'Registros'], ['contar.distinto', 'Distintos']], 'soma') + '</select></label>' +
      '<label class="wide">Campo<select id="mpn_mo_campo"></select></label>' +
      '<label>Só quando (campo)<select id="mpn_mo_ccampo" onchange="mesMontadorValores()"></select></label>' +
      '<label>for<select id="mpn_mo_cop">' + opcoesSelect([['=', 'igual a'], ['<>', 'diferente de'], ['>', 'maior que'], ['<', 'menor que'], ['>=', 'maior ou igual a'], ['<=', 'menor ou igual a']], '=') + '</select></label>' +
      '<label class="wide">Valor<input id="mpn_mo_cval" list="mpn_mo_lista" placeholder="ex.: PA, Quebra do rolo, 0"><datalist id="mpn_mo_lista"></datalist></label></div>' +
      '<div class="mpn-acoes"><button class="mini" onclick="mesMontadorInserir()">Inserir na fórmula</button><span class="muted" style="font-size:11px">Para uma taxa, junte dois com DIVIDIR(…; …).</span></div></details>';
  }
  window.mesMontadorTabela = function () {
    var tb = tabela(val('mpn_mo_tab')), c = el('mpn_mo_campo'), cc = el('mpn_mo_ccampo'); if (!tb || !c || !cc) return;
    c.innerHTML = tb.campos.map(function (f) { return '<option value="' + esc(f.k) + '">' + esc(f.l + (f.t === 'num' ? ' (' + (f.u || 'UM da linha') + ')' : '')) + '</option>'; }).join('');
    cc.innerHTML = '<option value="">— sem condição —</option>' + tb.campos.filter(function (f) { return f.t !== 'data'; }).map(function (f) { return '<option value="' + esc(f.k) + '">' + esc(f.l) + '</option>'; }).join('');
    var n = tb.campos.find(function (f) { return f.t === 'num' && !f.taxa; }); if (n) c.value = n.k;
    mesMontadorValores();
  };
  window.mesMontadorValores = function () {
    var tb = tabela(val('mpn_mo_tab')), k = val('mpn_mo_ccampo'), dl = el('mpn_mo_lista'); if (!dl) return;
    if (!tb || !k) { dl.innerHTML = ''; return; }
    dl.innerHTML = valoresDistintos(cmp(tb.id, k), [tb.id]).slice(0, 300).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
  };
  window.mesMontadorInserir = function () {
    var tb = tabela(val('mpn_mo_tab')), f = tb && campo(tb, val('mpn_mo_campo')), agg = val('mpn_mo_agg');
    if (!tb || !f) return;
    if (['soma', 'media', 'min', 'max'].indexOf(agg) >= 0 && f.t !== 'num') return msgInd('erro', esc(f.l) + ' é texto: use Registros ou Distintos.');
    if (agg === 'soma' && f.taxa) return msgInd('erro', esc(f.l) + ' é uma taxa da linha e não se soma: use Média, ou DIVIDIR(SOMA(numerador); SOMA(denominador)).');
    var cond = '', ck = val('mpn_mo_ccampo');
    if (ck) {
      var cf = campo(tb, ck), cv = val('mpn_mo_cval'), op = val('mpn_mo_cop'), numero = cf.t === 'num' && txt(cv) !== '' && isFinite(Number(String(cv).replace(',', '.')));
      if (cf.t === 'num' && !numero) return msgInd('erro', esc(cf.l) + ' é um número: informe um valor numérico na condição.');
      cond = '; ' + rotTabela(tb.id) + '[' + cf.k + '] ' + op + ' ' + (numero ? String(Number(String(cv).replace(',', '.'))) : '"' + String(cv).replace(/"/g, '""') + '"');
    }
    var vazia = !txt(val('mpn_ie_formula'));
    inserirTexto('mpn_ie_formula', FUNCOES[agg].rot + '(' + rotTabela(tb.id) + '[' + f.k + ']' + cond + ')');
    /* fórmula nova: o formato acompanha o que foi montado (contagem = inteiro; campo em R$ = moeda) */
    if (vazia && el('mpn_ie_formato')) { if (agg === 'contar' || agg === 'contar.distinto') el('mpn_ie_formato').value = 'int'; else if (f.u === 'R$' && agg !== 'media') el('mpn_ie_formato').value = 'moeda'; mesIndFormato(); }
    else mesIndValidar();
  };
  function camposIndicador() {
    var a = el('mpn_ie_campos'); if (!a) return;
    var inds = indicadores().filter(visivel).filter(function (x) { return !edInd || x.IdIndicador !== edInd.id; });
    a.innerHTML = '<details><summary>★ Indicadores (sub-indicadores)</summary>' + inds.map(function (i) { return '<div class="mpn-item" data-ins="' + esc('[' + i.Nome + ']') + '"><span class="ic">' + (i.Oficial === 'Sim' ? '★' : '☆') + '</span><span>' + esc(i.Nome) + '</span></div>'; }).join('') + '</details>' +
      TABELAS.map(function (tb) {
        return '<details><summary>▦ ' + esc(tb.nome) + '</summary>' + tb.campos.map(function (f) {
          return '<div class="mpn-item" data-ins="' + esc(rotTabela(tb.id) + '[' + f.k + ']') + '" title="' + esc((f.c || '') + (f.taxa ? ' — taxa da linha: não se soma' : '')) + '"><span class="ic">' + (f.t === 'num' ? 'Σ' : 'Aa') + '</span><span>' + esc(f.l) + '</span><em>' + esc(f.t === 'num' ? (f.u || 'UM da linha') : '') + '</em></div>';
        }).join('') + '</details>';
      }).join('');
    a.onclick = function (ev) { var it = ev.target.closest('[data-ins]'); if (!it || (edInd && edInd.so)) return; inserirTexto('mpn_ie_formula', it.getAttribute('data-ins')); mesIndValidar(); };
  }
  window.mesIndicadorEditar = function (id, base) {
    semear();
    var i = id ? indicadores().find(function (x) { return x.IdIndicador === id; }) : null;
    if (id && !i) return alert('Indicador não encontrado.');
    var d = i ? clone(i) : (base || { Nome: '', Area: 'Geral', Descricao: '', Formula: '', Formato: 'num', Casas: '', Sentido: '', Meta: '', Componentes: [], Oficial: 'Não', Compartilhado: 'Não' });
    var so = !!(i && !podeEditar(i)), dis = so ? ' disabled' : '';
    edInd = { id: i ? i.IdIndicador : '', so: so, novo: !i, oficial: d.Oficial === 'Sim' };
    var pct = d.Formato === 'pct', meta = d.Meta === '' || d.Meta == null ? '' : (pct ? arred(N(d.Meta) * 100, 6) : d.Meta);
    var outros = indicadores().filter(visivel).filter(function (x) { return !i || x.IdIndicador !== i.IdIndicador; });
    var corpo = '<div class="mpn-ed" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)">' +
      '<div class="mpn-col">' + (so ? '<div class="mpn-msg alerta">' + (i.Oficial === 'Sim' ? 'Indicador oficial: só o administrador altera. Use "Duplicar como meu" para fazer a sua versão.' : 'Indicador de ' + esc(i.Dono) + ': só o dono altera.') + '</div>' : '') +
      '<div class="mpn-form"><label class="wide">Nome<input id="mpn_ie_nome" value="' + esc(d.Nome) + '"' + dis + '></label>' +
      '<label>Área<select id="mpn_ie_area"' + dis + '>' + AREAS.map(function (a) { return '<option' + (d.Area === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select></label>' +
      '<label>Formato<select id="mpn_ie_formato" onchange="mesIndFormato()"' + dis + '>' + opcoesSelect(FORMATOS, d.Formato || 'num') + '</select></label>' +
      '<label class="wide">Descrição (como se lê o número)<textarea id="mpn_ie_desc" style="font-family:inherit;min-height:42px"' + dis + '>' + esc(d.Descricao || '') + '</textarea></label>' +
      '<label class="wide">Regra de cálculo (fórmula)<textarea id="mpn_ie_formula" spellcheck="false" style="min-height:96px" oninput="mesIndValidar()"' + dis + '>' + esc(d.Formula || '') + '</textarea></label></div>' +
      '<div class="mpn-msg" id="mpn_ie_msg"></div>' +
      (so ? '' : '<div class="mpn-acoes" style="margin:0 0 6px"><button class="mini secondary" onclick="mesEdAjuda(\'mpn_ie_ajuda\')">Funções</button></div><div id="mpn_ie_ajuda" class="mpn-aberto" style="display:none;margin:0 0 8px;font-family:inherit">' + ajudaFuncoes('mpn_ie_formula') + '</div>' + montadorHTML()) +
      '<div class="mpn-form"><label>Casas decimais<input id="mpn_ie_casas" type="number" min="0" max="6" value="' + esc(d.Casas === '' || d.Casas == null ? '' : d.Casas) + '" placeholder="automático" onchange="mesIndValidar()"' + dis + '></label>' +
      '<label>Melhor quando<select id="mpn_ie_sentido"' + dis + '>' + opcoesSelect([['', '—'], ['maior', 'maior'], ['menor', 'menor']], d.Sentido || '') + '</select></label>' +
      '<label>Meta <span id="mpn_ie_metaun">' + (pct ? '(%)' : '') + '</span><input id="mpn_ie_meta" type="number" step="any" value="' + esc(meta) + '"' + dis + '></label>' +
      (!i && admin() ? '<label>Tipo<select id="mpn_ie_oficial" onchange="mesIndValidar()">' + opcoesSelect([['Não', 'Pessoal'], ['Sim', 'Oficial']], d.Oficial === 'Sim' ? 'Sim' : 'Não') + '</select></label>' : '') +
      (d.Oficial === 'Sim' ? '' : '<label>Quem vê<select id="mpn_ie_comp"' + dis + '>' + opcoesSelect([['Não', 'Só eu'], ['Sim', 'Todos (compartilhado)']], d.Compartilhado === 'Sim' ? 'Sim' : 'Não') + '</select></label>') +
      (i ? '<label class="wide">O que mudou (vai para o histórico)<input id="mpn_ie_nota" placeholder="ex.: meta revista com a engenharia"' + dis + '></label>' : '') + '</div>' +
      '<h4>Sub-indicadores (o indicador abre neles no painel)</h4><div id="mpn_ie_comps" style="max-height:150px;overflow:auto;font-size:12px">' + outros.map(function (x) {
        return '<label style="display:flex;gap:6px;align-items:center;font-weight:400;margin:1px 0"><input type="checkbox" value="' + esc(x.IdIndicador) + '"' + (A(d.Componentes).indexOf(x.IdIndicador) >= 0 ? ' checked' : '') + dis + '> ' + esc(x.Nome) + ' ' + tagIndicador(x) + '</label>';
      }).join('') + '</div><p class="muted" style="font-size:11px">Sem marcar nada, valem os indicadores que a fórmula usa.' + (d.Oficial === 'Sim' || edInd.oficial ? ' Oficial só abre em oficiais.' : '') + '</p></div>' +
      '<div class="mpn-col"><h4>Valores de agora (por mês)</h4><div class="mpn-previa" style="height:300px"><div class="mpn-corpo" id="mpn_ie_previa"></div></div><div id="mpn_ie_info" style="font-size:11.5px;margin-top:6px"></div>' +
      '<h4 style="margin-top:10px">Campos das tabelas e indicadores</h4><div class="muted" style="font-size:11px">Clique para inserir na fórmula.</div><div id="mpn_ie_campos" class="mpn-campos" style="max-height:280px;overflow:auto"></div></div></div>';
    var o = janela(i ? (so ? 'Indicador — ' : 'Editar indicador — ') + i.Nome : 'Novo indicador', corpo, so ? '<button class="secondary" onclick="mesIndicadorDuplicar(\'' + jsStr(i.IdIndicador) + '\')">Duplicar como meu</button>' : '<button onclick="mesIndicadorSalvar()">Salvar indicador</button>');
    o.setAttribute('data-indicador', '1');
    if (!so) mesMontadorTabela();
    camposIndicador(); validarIndicador();
  };
  window.mesIndFormato = function () { var u = el('mpn_ie_metaun'); if (u) u.textContent = val('mpn_ie_formato') === 'pct' ? '(%)' : ''; mesIndValidar(); };
  window.mesIndValidar = function () { clearTimeout(window.__mpnIndT); window.__mpnIndT = setTimeout(validarIndicador, 250); };
  function validarIndicador() {
    var f = val('mpn_ie_formula'), pv = el('mpn_ie_previa'), info = el('mpn_ie_info'); if (!pv) return;
    if (!txt(f)) { msgInd('', ''); pv.innerHTML = '<div class="mpn-vazio">Escreva a regra de cálculo.</div>'; if (info) info.innerHTML = ''; return; }
    var c = compilar(f);
    if (c.erro) { msgInd('erro', esc(c.erro) + (c.pos != null ? ' (posição ' + (c.pos + 1) + ')' : '')); pv.innerHTML = '<div class="mpn-vazio">Corrija a fórmula para ver os valores.</div>'; if (info) info.innerHTML = ''; return; }
    if (edInd && edInd.id && c.info.todos[edInd.id]) { msgInd('erro', c.info.inds[edInd.id] ? 'O indicador não pode usar ele mesmo.' : 'Referência circular: a fórmula usa um indicador que depende deste.'); return; }
    var oficial = edInd && (edInd.oficial || val('mpn_ie_oficial') === 'Sim');
    var pessoais = oficial ? Object.keys(c.info.todos).map(indicadorPor).filter(function (x) { return x && x.Oficial !== 'Sim'; }) : [];
    var tabs = Object.keys(c.info.tabelas);
    msgInd(pessoais.length ? 'erro' : (c.info.avisos.length ? 'alerta' : 'ok'), (pessoais.length ? 'Um indicador oficial só pode usar indicadores oficiais (usa: ' + esc(pessoais.map(function (x) { return x.Nome; }).join(', ')) + ').' : '✓ Fórmula válida.') +
      ' Usa ' + esc(tabs.map(function (t) { return tabela(t).nome; }).join(', ') || 'só números') + '.' + c.info.avisos.map(function (a) { return '<br>⚠ ' + esc(a); }).join(''));
    novaSessao(); montarTabelas(tabs);
    var cfg = { id: '__ind', visual: 'tabela', eixo: dim('mes'), valores: [{ formula: f, nome: txt(val('mpn_ie_nome')) || 'Valor', formato: val('mpn_ie_formato') || 'num', casas: val('mpn_ie_casas') }] };
    desenharBloco(cfg, {}, 'mpn_ie_previa');
    var res = estadoPainel.resultados.__ind;
    if (info && res) info.innerHTML = '<b>Total (todo o período): ' + esc(textoValor(res.geral[0], res.valores[0].formato, res.valores[0].casas)) + '</b>' + (res.cobertura.length ? '<br>Faltam dados — ' + esc(res.cobertura.join('; ')) : '');
  }
  window.mesIndicadorSalvar = function () {
    if (!edInd || edInd.so) return;
    var formato = val('mpn_ie_formato'), meta = val('mpn_ie_meta');
    var comps = [].slice.call(document.querySelectorAll('#mpn_ie_comps input:checked')).map(function (x) { return x.value; });
    var dados = { Nome: val('mpn_ie_nome'), Area: val('mpn_ie_area'), Descricao: val('mpn_ie_desc'), Formula: val('mpn_ie_formula'), Formato: formato, Casas: val('mpn_ie_casas'), Sentido: val('mpn_ie_sentido'),
      Meta: txt(meta) === '' ? '' : (formato === 'pct' ? N(meta) / 100 : N(meta)), Componentes: comps, Nota: val('mpn_ie_nota') };
    if (el('mpn_ie_comp')) dados.Compartilhado = val('mpn_ie_comp');
    if (el('mpn_ie_oficial')) dados.Oficial = val('mpn_ie_oficial');
    var r = salvarIndicador(dados, edInd.id);
    if (r.erro) return msgInd('erro', esc(r.erro));
    var top = document.querySelector('.mpn-modal[data-indicador="1"]'); if (top) fecharJanela(top);
    edInd = null;
    if (telaAtual() === 'indicadores') telaIndicadores(); else if (telaAtual() === 'painel') telaPainel();
  };
  window.mesIndicadorDuplicar = function (id) {
    var i = indicadores().find(function (x) { return x.IdIndicador === id; }); if (!i) return;
    var top = document.querySelector('.mpn-modal[data-indicador="1"]'); if (top) fecharJanela(top);
    var nome = i.Nome + ' (minha versão)', n = 2;
    while (indicadores().some(function (x) { return norm(x.Nome) === norm(nome); })) nome = i.Nome + ' (minha versão ' + (n++) + ')';
    mesIndicadorEditar('', { Nome: nome, Area: i.Area, Descricao: i.Descricao, Formula: i.Formula, Formato: i.Formato, Casas: i.Casas, Sentido: i.Sentido, Meta: i.Meta, Componentes: A(i.Componentes).slice(), Oficial: 'Não', Compartilhado: 'Não' });
  };
  window.mesIndicadorHistorico = function (id) {
    var i = indicadores().find(function (x) { return x.IdIndicador === id; }); if (!i) return;
    var hs = A(i.Historico).slice().reverse();
    janela('Histórico — ' + i.Nome, '<p>' + tagIndicador(i) + ' · versão atual ' + esc(i.Versao) + ' · criado em ' + esc(i.CriadoEm || '') + ' por ' + esc(i.CriadoPor || '') + '</p><div class="table-wrap"><table><thead><tr><th>Versão</th><th>Em</th><th>Por</th><th>Nome</th><th>Regra de cálculo</th><th>Meta</th><th>O que mudou</th></tr></thead><tbody>' +
      (hs.length ? hs.map(function (h) { return '<tr><td class="mpn-num">' + esc(h.Versao) + '</td><td>' + esc(h.Em) + '</td><td>' + esc(h.Por) + '</td><td>' + esc(h.Nome) + '</td><td><code style="font-size:11px;white-space:pre-wrap">' + esc(h.Formula) + '</code></td><td class="mpn-num">' + esc(h.Meta === '' || h.Meta == null ? '—' : formatar(N(h.Meta), h.Formato || i.Formato, null, '')) + '</td><td>' + esc(h.Nota || '') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="muted">Sem histórico.</td></tr>') +
      '</tbody></table></div>');
  };
  window.mesIndicadorValores = function (id) {
    var i = indicadores().find(function (x) { return x.IdIndicador === id; }); if (!i) return;
    janela('Valores — ' + i.Nome, '<p class="muted">' + esc(i.Descricao || '') + '</p><p><code>' + esc(i.Formula) + '</code></p><div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:12px">' +
      '<div class="mpn-previa" style="height:150px"><div class="mpn-corpo" id="mpn_iv_total"></div></div><div class="mpn-previa" style="height:420px"><div class="mpn-corpo" id="mpn_iv_mes"></div></div></div>' +
      '<p class="muted" style="font-size:11.5px">Clique num valor para ver o cálculo aberto e os registros.</p>');
    setTimeout(function () {
      novaSessao(); montarTabelas(tabelasDe({ valores: [{ indicador: id }] }));
      desenharBloco({ id: '__iv_total', visual: 'cartao', valores: [{ indicador: id }] }, {}, 'mpn_iv_total');
      desenharBloco({ id: '__iv_mes', visual: 'tabela', eixo: dim('mes'), valores: [{ indicador: id }] }, {}, 'mpn_iv_mes');
    }, 20);
  };
  window.mesIndicadorExcluir = function (id) {
    var i = indicadores().find(function (x) { return x.IdIndicador === id; }); if (!i) return;
    if (!confirm('Excluir o indicador "' + i.Nome + '"' + (i.Oficial === 'Sim' ? ' (OFICIAL)' : '') + '?')) return;
    var r = excluirIndicador(id);
    if (r.erro) return alert('Não foi possível excluir: ' + r.erro);
    telaIndicadores();
  };

  /* ---------------------------------------------------------------------
     13) TELA: TABELAS E RELAÇÕES (de onde vem cada número)
     --------------------------------------------------------------------- */
  var TIPOS_CAMPO = { num: 'número', txt: 'texto', data: 'data', mes: 'mês', ano: 'ano' };
  function telaTabelas() {
    estilo(); semear(); setCurrent('paineis_tabelas'); marcarNav('paineis_tabelas');
    cabecalho('Tabelas e relações', 'De onde vem cada número dos painéis: as tabelas dos módulos, os campos com a unidade e o caminho da ligação. Cada tabela é somada no próprio nível e só depois juntada pelas dimensões em comum.');
    el('content').innerHTML = '<div class="toolbar" id="mpn_toolbar"><button class="secondary" onclick="render(\'paineis\')">Painéis</button><button class="secondary" onclick="render(\'indicadores\')">Indicadores</button></div><div id="mpn_tabs_corpo"><div class="mpn-vazio">Montando as tabelas dos módulos…</div></div>';
    setTimeout(function () {
      if (telaAtual() !== 'paineis_tabelas' || !el('mpn_tabs_corpo')) return;
      novaSessao(); montarTabelas(TABELAS.map(function (t) { return t.id; }));
      var dk = Object.keys(DIMS);
      var h = '<div class="mpn-card" style="margin-bottom:12px"><h3>Como as tabelas se ligam</h3><p>● = a tabela tem a dimensão. Números de tabelas diferentes no mesmo gráfico só se juntam por uma dimensão que as duas têm; sem ela o bloco avisa "não se relaciona" — o MES não inventa a ligação.</p>' +
        '<div class="table-wrap"><table><thead><tr><th>Tabela</th><th>Registros</th>' + dk.map(function (k) { return '<th style="font-size:10.5px">' + esc(DIMS[k]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        TABELAS.map(function (t) {
          return '<tr><td><a href="javascript:void(0)" onclick="var x=document.getElementById(\'mpn_t_' + t.id + '\');if(x)x.scrollIntoView({behavior:\'smooth\'})">' + esc(t.nome) + '</a></td><td class="mpn-num">' + TABELA_LINHAS(t.id).length + '</td>' +
            dk.map(function (k) { return '<td style="text-align:center">' + (t.campos.some(function (f) { return f.dim === k; }) ? '●' : '') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div></div>';
      TABELAS.forEach(function (t) {
        var ls = TABELA_LINHAS(t.id);
        h += '<div class="mpn-card" id="mpn_t_' + t.id + '" style="margin-bottom:12px"><h3>' + esc(t.nome) + ' <span class="mpn-tag">' + ls.length + ' registro(s)</span></h3><p>' + esc(t.desc) + '<br><b>Módulo:</b> ' + esc(t.modulo) + ' · <b>Na fórmula:</b> <code>' + esc(rotTabela(t.id)) + '[Campo]</code></p>' +
          (A(ls.avisos).length ? '<div class="mpn-msg alerta">' + esc(ls.avisos.join(' ')) + '</div>' : '') +
          '<div class="table-wrap" style="max-height:none"><table class="mpn-tab-tb"><thead><tr><th>Campo na fórmula</th><th>Rótulo</th><th>Tipo</th><th>Unidade</th><th>Dimensão</th><th>Ligação</th><th>Preenchido</th><th>Regra</th></tr></thead><tbody>' +
          t.campos.map(function (f) {
            var cheios = ls.filter(function (r) { var v = r[f.k]; return !(vazio(v) || txt(v) === ''); }).length;
            return '<tr><td><code>' + esc(rotTabela(t.id) + '[' + f.k + ']') + '</code></td><td>' + esc(f.l) + '</td><td>' + esc(TIPOS_CAMPO[f.t] || f.t) + '</td>' +
              '<td>' + esc(f.u || (f.um ? 'a da linha (' + f.um + ')' : '')) + '</td><td>' + esc(f.dim ? DIMS[f.dim] : '') + '</td><td style="font-size:11px">' + esc(f.c || '') + '</td>' +
              '<td class="mpn-num">' + (ls.length ? fmtNum(cheios / ls.length * 100, 0) + '%' : '—') + '</td><td style="font-size:11px">' + esc(f.taxa ? 'taxa da linha: não se soma' : (f.unico ? 'repete por ' + f.unico + ': conta uma vez por ' + f.unico : '')) + '</td></tr>';
          }).join('') + '</tbody></table></div><div class="mpn-acoes" style="margin-top:6px"><button class="mini secondary" onclick="mesTabelaRegistros(\'' + t.id + '\')">Ver os registros</button></div></div>';
      });
      var c = el('mpn_tabs_corpo'); if (c) c.innerHTML = h;
    }, 30);
  }
  window.mesTabelaRegistros = function (id) { var tb = tabela(id); if (!tb) return; montarTabelas([id]); mostrarRegistros('Registros — ' + tb.nome, [{ tabela: tb, linhas: TABELA_LINHAS(id) }], tb.nome); };

  /* ---------------------------------------------------------------------
     14) MENU "Painéis", ROTAS E API (para testes e outros adaptadores)
     --------------------------------------------------------------------- */
  var ITENS_MENU = [['paineis', 'Painéis'], ['indicadores', 'Indicadores'], ['paineis_tabelas', 'Tabelas e relações']];
  var TELAS = { paineis: telaLista, painel: telaPainel, indicadores: telaIndicadores, paineis_tabelas: telaTabelas };
  function ajustarMenu() {
    try {
      var mods = (typeof modules !== 'undefined') ? modules : null, grupos = (typeof moduleGroups !== 'undefined') ? moduleGroups : null;
      if (mods) ITENS_MENU.forEach(function (x) { if (!mods.some(function (m) { return m[0] === x[0]; })) mods.push(x); });
      if (grupos && !grupos.some(function (g) { return g.title === 'Painéis'; })) {
        var grupo = { title: 'Painéis', icon: '📊', items: ITENS_MENU.map(function (x) { return x[0]; }) };
        var rel = grupos.findIndex(function (g) { return g.title === 'Relatórios'; }), adm = grupos.findIndex(function (g) { return g.title === 'Administração'; });
        grupos.splice(rel >= 0 ? rel : (adm >= 0 ? adm : grupos.length), 0, grupo);
      }
    } catch (e) { console.warn('MES LION 1.7: menu', e); }
  }
  ajustarMenu();
  function refazerMenu() {
    try { var app = el('app'); if (app && !app.classList.contains('hidden') && typeof renderNav === 'function') { var at = telaAtual(); renderNav(); marcarNav(at === 'painel' ? 'paineis' : at); } } catch (e) { }
  }
  (function () {
    var ant = window.render;
    if (typeof ant !== 'function') return;
    window.render = function (k) {
      fecharPopover();
      if (Object.prototype.hasOwnProperty.call(TELAS, k)) {
        if (k !== 'painel') pararTV();
        try { return TELAS[k](); }
        catch (e) {
          console.error('MES LION 1.7: painéis', e);
          var c = el('content'); if (c) c.innerHTML = '<div class="mpn-msg erro">Erro ao abrir a tela: ' + esc(e && e.message || e) + '</div>';
          return;
        }
      }
      pararTV();
      return ant.apply(this, arguments);
    };
  })();
  (function () {
    var ant = window.boot;
    if (typeof ant !== 'function') return;
    window.boot = function () { ajustarMenu(); var r = ant.apply(this, arguments); refazerMenu(); return r; };
  })();
  refazerMenu();

  function serial(v) { return v instanceof Date ? hojeDe(v) : v; }
  function hojeDe(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
  function linhaSerial(l) { var o = {}; Object.keys(l).forEach(function (k) { if (k !== 'op') o[k] = serial(l[k]); }); return o; }
  function celulaSerial(c) { c = c || {}; return { v: typeof c.v === 'number' ? (isFinite(c.v) ? c.v : null) : (typeof c.v === 'boolean' || typeof c.v === 'string' ? c.v : null), u: c.u || '', erro: c.erro || '', nota: c.nota || '', semRelacao: c.semRelacao || '' }; }
  function resumoResultado(r) {
    return {
      eixo: r.eixo, legendas: r.legendas, rotEixo: r.eixo.map(r.rotEixo), rotLeg: r.legendas.map(r.rotLeg),
      valores: r.valores.map(function (v) { return { nome: v.nome, formula: v.formula, erro: v.erro || '', formato: v.formato, casas: v.casas, indicador: v.ind ? v.ind.IdIndicador : '' }; }),
      celulas: r.valores.map(function (v, vi) { var o = {}; r.eixo.forEach(function (e) { r.legendas.forEach(function (lg) { o[(e == null ? '*' : e) + '|' + (lg == null ? '*' : lg)] = celulaSerial(r.celulas[vi][chaveGrupo(e, lg)]); }); }); return o; }),
      geral: r.geral.map(celulaSerial), avisos: r.avisos.slice(), cobertura: r.cobertura.slice(), cortados: r.cortados
    };
  }
  function prepararAPI(cfg, nova) { semear(); if (nova !== false) novaSessao(); montarTabelas(tabelasDe(cfg)); }
  window.mesPaineisAPI = {
    versao: VERSAO,
    tabelas: function () { return TABELAS.map(function (t) { return { id: t.id, nome: t.nome, modulo: t.modulo, desc: t.desc, campos: clone(t.campos) }; }); },
    dimensoes: function () { return clone(DIMS); },
    linhas: function (id, nova) { if (nova !== false) novaSessao(); montarTabelas([id]); var ls = TABELA_LINHAS(id); return { linhas: ls.map(linhaSerial), avisos: A(ls.avisos).slice() }; },
    compilar: function (t) { semear(); var c = compilar(t); return { erro: c.erro || '', pos: c.pos == null ? null : c.pos, tabelas: c.info ? Object.keys(c.info.tabelas) : [], indicadores: c.info ? Object.keys(c.info.inds) : [], avisos: c.info ? c.info.avisos.slice() : [] }; },
    executar: function (cfg, filtros, nova) { prepararAPI(cfg, nova); return resumoResultado(executar(cfg, filtros)); },
    calculoAberto: function (cfg, filtros, vi, e, lg) { prepararAPI(cfg); return calculoAberto(executar(cfg, filtros), vi || 0, e == null ? null : e, lg == null ? null : lg); },
    registros: function (cfg, filtros, vi, e, lg) {
      prepararAPI(cfg); var r = executar(cfg, filtros);
      return registros(r, vi || 0, e == null ? null : e, lg == null ? null : lg).map(function (g) { return { tabela: g.tabela.id, linhas: g.linhas.map(linhaSerial) }; });
    },
    indicadores: function () { semear(); return clone(indicadores()); },
    indicador: function (ref) { semear(); var i = indicadorPor(ref); return i ? clone(i) : null; },
    salvarIndicador: function (dados, id) { var r = salvarIndicador(dados, id); return r.erro ? { erro: r.erro } : { indicador: clone(r.indicador) }; },
    excluirIndicador: excluirIndicador,
    semear: semear, oficiais: function () { return OFICIAIS.map(function (o) { return o.id; }); },
    paineis: function () { return clone(paineis()); }, modelos: function () { return modelos().map(function (m) { return m.Nome; }); },
    criarModelos: function () { return criarModelos().map(function (p) { return p.IdPainel; }); },
    criarPainel: function (nome, area, blocos, comp) { return clone(criarPainel(nome, area, blocos, comp)); },
    abrirPainel: function (id) { window.mesPainelAbrir(id); },
    resultadoBloco: function (bid) { var r = estadoPainel.resultados[bid]; return r ? resumoResultado(r) : null; },
    fecharMes: fecharMes, fechamentos: function () { return clone(A((D() || {}).paineis_fechamentos)); },
    formatar: formatar, novaSessao: novaSessao, usoEmPaineis: usoEmPaineis
  };
  window.MES_ADAPTADOR_PAINEIS = VERSAO;

})();
