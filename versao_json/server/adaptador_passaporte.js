/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR DO PASSAPORTE DA BATERIA E DA BIBLIOTECA DE FATORES AMBIENTAIS
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, depois de
   server\adaptador_frontend.js. Os arquivos do frontend continuam idênticos aos do MES LION 1.0 PGSQL.
     1) Biblioteca de fatores ambientais GWP100 (ecoinvent cut-off) recriada: tela ACV > Fatores e
        ACV > Biblioteca de Dados Ambientais; a versão ativa vale nos cálculos; o banco LCI deixa de repetir linhas
        a cada cálculo; o template de importação (.xlsx) traz linhas de exemplo válidas e a importação lê o .xlsx
        salvo pelo Excel e o CSV.
     2) Passaporte da bateria:
        - ao escolher a OP, puxa sozinho os dados da estrutura da célula (modelo, formato, química,
          capacidade, tensão, energia, peso, dimensões), a pegada de carbono calculada (AICV da OP ou
          ACV da família de OPs) e a composição mássica;
        - nenhum campo é obrigatório; cada dado tem a marca "painel" (aparece ou não no painel do cliente);
          em RASCUNHO salva com informações incompletas e com OP ainda aberta;
        - a composição mássica publicada considera só as massas úteis (cada material com sua marca; os
          solventes, que evaporam no processo, ficam fora por padrão);
        - os campos repetidos dos blocos "UE" (V1.1.1) e "Guidance v2.0" (V1.1.4) viraram um cadastro único.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1) BIBLIOTECA DE FATORES AMBIENTAIS (GWP100) E BANCO LCI
   A biblioteca de fatores da V1.1.3 era criada só ao carregar a página: no modo servidor o estado vindo do
   servidor substitui "data" logo depois e ela se perdia sem ser gravada. Ela volta (uma vez por base, marcada em
   data.meta.bibliotecaFatoresGWP100) com os fatores da tabela GWP100, em data.acv_fatores (usada pelo AICV do
   módulo ACV) e como versão da Biblioteca de Dados Ambientais em data.sust_lci (usada pelo cálculo de ACV da família
   de OPs). A versão ativa da biblioteca passa a valer nos cálculos (antes uma versão importada só era usada nos
   materiais que ainda não tinham fator). O template de importação traz linhas de exemplo válidas e a importação lê
   o .xlsx salvo pelo Excel.
   O banco LCI (data.sust_lci) ganhava linhas repetidas a cada cálculo (o teste de existência procurava o cenário
   "Base / Brasil", mas a linha nova era gravada com o cenário do fator antigo): as repetidas idênticas são removidas
   e a rotina passa a não repetir.
   --------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.__mesBibliotecaGWP100) return;
  window.__mesBibliotecaGWP100 = true;

  var A = function (x) { return Array.isArray(x) ? x : []; };
  function temDados() { return typeof data === 'object' && data !== null; }
  function logado() { return !!window.MES_CURRENT_USER; }
  function E(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  var METODO = 'IPCC 100a v1.3 / GWP100';
  var VERSAO = 'Ecoinvent / Cut-off, U';
  var LOTE = 'BIBLIOTECA-GWP100-MES';
  var FONTE = 'Biblioteca de fatores GWP100 (ecoinvent cut-off)';
  var KG = 'kg CO₂eq/kg', KWH = 'kg CO₂eq/kWh';
  /* [código no MES, dataset ecoinvent, fator GWP100, unidade]. Os 15 primeiros são os da tabela GWP100 (mesmos
     valores, com as casas decimais do relatório); os 4 últimos já estavam na biblioteca da V1.1.3. Códigos PROC_ e
     ENERGIA_ não são materiais do cadastro (processos, energia e insumos de referência). */
  var BIBLIOTECA = [
    ['MP0016', 'Electrolyte, for Li-ion battery {GLO}| for Li-ion battery | Cut-off, U', 3.681, KG],
    ['MP0015', 'Battery separator {GLO}| market for battery separator | Cut-off, U', 35.810, KG],
    ['MP0013', 'Aluminium collector foil, for Li-ion battery {GLO}| for Li-ion battery | Cut-off, U', 15.514, KG],
    ['MP0009', 'Polyvinylfluoride {GLO}| market for polyvinylfluoride | Cut-off, U', 15.679, KG],
    ['MP0007', 'Carbon black {GLO}| market for carbon black | Cut-off, U', 2.415, KG],
    ['MP0005', 'Synthetic graphite, battery grade {CN}| battery grade | Cut-off, U', 47.681, KG],
    ['MP0014', 'Copper collector foil, for Li-ion battery {GLO}| for Li-ion battery | Cut-off, U', 8.983, KG],
    ['PROC_AL', 'Aluminium, wrought alloy {GLO}| market for aluminium, wrought alloy | Cut-off, U', 13.23887, KG],
    ['PROC_CU', 'Copper, anode {GLO}| market for copper, anode | Cut-off, U', 6.001, KG],
    ['ENERGIA_BR', 'Electricity, medium voltage {BR-Southern grid}| medium voltage | Cut-off, U', 0.151, KWH],
    ['ENERGIA_CN', 'Electricity, medium voltage {CN}| market for | Cut-off, U', 0.915, KWH],
    ['PROC_EXT', 'Extrusion, plastic film {GLO}| market for extrusion, plastic film | Cut-off, U', 0.52884, KG],
    ['MP0011', 'Latex {GLO}| market for | Cut-off, U', 2.76424, KG],
    ['PROC_PP', 'Polypropylene, granulate {GLO}| market for polypropylene, granulate | Cut-off, U', 3.05, KG],
    ['PROC_ROLL', 'Sheet rolling, aluminium {GLO}| market for sheet rolling, aluminium | Cut-off, U', 0.63132, KG],
    ['MP0002', 'Water, deionised {RoW}| market for water, deionised | Cut-off, U', 0.00047, KG],
    ['MP0006', 'Natural graphite, coated {CN}| market for natural graphite, coated | Cut-off, U', 9.211, KG],
    ['MP0001', 'N-methyl-2-pyrrolidone {GLO}| market for N-methyl-2-pyrrolidone | Cut-off, U', 7.904, KG],
    ['MP0003', 'Lithium iron phosphate {CN}| market for lithium iron phosphate | Cut-off, U', 5.336, KG]
  ];
  function regiao(ds) { var m = String(ds).match(/\{([^}]+)\}/); return m ? m[1] : 'GLO'; }
  function materialDe(cod) { return A(data.materiais).find(function (m) { return m && String(m['CódigoMaterial']) === String(cod); }) || null; }

  /* banco LCI: remove as linhas repetidas (idênticas), mantendo a primeira */
  function semRepeticoes() {
    var lista = A(data.sust_lci);
    if (lista.length < 2) return 0;
    var vistos = new Set(), saida = [];
    lista.forEach(function (r) {
      if (r && typeof r === 'object') {
        var k = JSON.stringify(r);
        if (vistos.has(k)) return;
        vistos.add(k);
      }
      saida.push(r);
    });
    var removidas = lista.length - saida.length;
    if (removidas) data.sust_lci = saida;
    return removidas;
  }

  /* V37: gera uma linha do banco LCI por material com entrada e indicador. Mesma regra, sem repetir a linha. */
  var ensureOriginal = window.ensureLCIDatabaseFromEntradasV37;
  if (typeof ensureOriginal === 'function') {
    window.ensureLCIDatabaseFromEntradasV37 = function () {
      if (!temDados()) return;
      if (typeof indicadoresLCIV37 !== 'function' || typeof materiaisComEntradaV37 !== 'function') return ensureOriginal.apply(this, arguments);
      data.sust_lci = A(data.sust_lci);
      var existentes = new Set();
      data.sust_lci.forEach(function (r) { if (r) existentes.add(r.CodigoMaterial + '|' + r.Indicador + '|' + (r.Cenario || 'Base / Brasil')); });
      var inds = A(indicadoresLCIV37());
      A(materiaisComEntradaV37()).forEach(function (x) {
        var cod = x.cod, mat = x.mat || {}, ent = x.ent || {};
        inds.forEach(function (ind) {
          var desc = String(mat.DescricaoMateriais || '').toLowerCase();
          var old = A(data.sust_fatores).find(function (f) {
            return String(f.Categoria || '') === ind.Indicador && (String(f.Item || '').toLowerCase().includes(desc.split(' ')[0]) || f.Item === mat.DescricaoMateriais);
          });
          var cenario = old ? (old.Cenario || 'Base / Brasil') : 'Base / Brasil';
          var k = cod + '|' + ind.Indicador + '|';
          if (existentes.has(k + cenario) || existentes.has(k + 'Base / Brasil')) return;
          existentes.add(k + cenario);
          var fkg = '';
          try { fkg = String((typeof materialKgFactorV35 === 'function' && materialKgFactorV35(cod)) || ''); } catch (e) { fkg = ''; }
          data.sust_lci.push({
            CodigoMaterial: cod, DescricaoMaterial: ent.DescricaoMaterial || mat.DescricaoMateriais || '', CategoriaMaterial: mat.Categoria || '',
            UnidadeEntrada: ent.UnidadeMedida || mat.UM || '', FatorKg: fkg, UltimaEntrada: ent.Entrada || '', LoteReferencia: ent.Lote || '',
            Fornecedor: ent.NomeFornecedor || '', CNPJFornecedor: ent.CNPJFornecedor || '', ValorUnitario: ent['ValorUnitario (R$/UM)'] || '',
            Indicador: ind.Indicador, UnidadeIndicador: ind.UnidadeIndicador, FatorPorKg: old ? String(old.Fator || '') : '',
            Metodo: old ? (old.Metodo || 'EF 3.1 simplificado') : 'EF 3.1 simplificado', Fonte: old ? (old.Fonte || '') : 'Informar fonte / banco ACV',
            Cenario: cenario, Ativo: 'Sim', Validade: '',
            Observacoes: 'Gerado automaticamente a partir das entradas de materiais. Preencher fator por kg conforme fonte ACV.'
          });
        });
      });
    };
  }

  function semearBiblioteca() {
    data.meta = (data.meta && typeof data.meta === 'object') ? data.meta : {};
    if (data.meta.bibliotecaFatoresGWP100) return false;
    data.acv_fatores = A(data.acv_fatores);
    data.sust_lci = A(data.sust_lci);
    var agora = new Date().toLocaleString('pt-BR');
    var versoes = data.sust_lci.map(function (r) { return Number(r && r.LibraryVersion) || 0; });
    var ver = (versoes.length ? Math.max.apply(null, versoes) : 0) + 1;
    var ativa = !data.sust_lci.some(function (r) { return r && r.LibraryActive === 'Sim'; });
    var novos = [], linhasLCI = 0;
    BIBLIOTECA.forEach(function (b) {
      var cod = b[0], ds = b[1], fator = b[2], un = b[3];
      if (!data.acv_fatores.some(function (x) { return x && x.CodigoMaterial === cod && x.Categoria === 'Mudanças climáticas'; })) {
        novos.push({ CodigoMaterial: cod, Categoria: 'Mudanças climáticas', Fator: String(fator), Unidade: un, Dataset: ds, Versao: VERSAO,
          Regiao: regiao(ds), Ano: '2026', Qualidade: 'Dado secundário — ecoinvent cut-off', Metodo: METODO, Fonte: FONTE,
          OrigemBibliotecaAmbiental: 'Sim', LibraryVersion: ver, LibraryActive: ativa ? 'Sim' : 'Não', ImportBatch: LOTE });
      }
      var mat = materialDe(cod);
      if (!mat) return;
      var fkg = '';
      try { fkg = String((typeof materialKgFactorV35 === 'function' && materialKgFactorV35(cod)) || ''); } catch (e) { fkg = ''; }
      data.sust_lci.push({ CodigoMaterial: cod, DescricaoMaterial: mat.DescricaoMateriais || '', CategoriaMaterial: mat.Categoria || '',
        UnidadeEntrada: mat.UM || '', FatorKg: fkg, Indicador: 'Mudanças climáticas', UnidadeIndicador: un, FatorPorKg: String(fator),
        Metodo: METODO, Fonte: ds, Cenario: 'Base / Brasil', Ativo: 'Sim', Validade: '',
        Observacoes: 'Biblioteca de fatores GWP100 (ecoinvent cut-off) recriada pelo MES.',
        LibraryVersion: ver, LibraryActive: ativa ? 'Sim' : 'Não', ImportBatch: LOTE, ImportedAt: agora, ImportedFile: FONTE });
      linhasLCI++;
    });
    // como na importação da Biblioteca Ambiental (V2.3.3), os fatores novos ficam no início da lista
    data.acv_fatores = novos.concat(data.acv_fatores);
    data.meta.bibliotecaFatoresGWP100 = { Versao: ver, Data: agora, Lote: LOTE, FatoresACV: novos.length, LinhasLCI: linhasLCI, Metodo: METODO };
    return true;
  }

  var tratados = typeof WeakSet === 'function' ? new WeakSet() : null;
  function tratar() {
    if (!temDados() || !logado()) return;
    if (tratados) { if (tratados.has(data)) return; tratados.add(data); }
    try {
      var removidas = semRepeticoes();
      var semeou = semearBiblioteca();
      if (removidas && window.console) console.info('MES LION: banco LCI — ' + removidas + ' linha(s) repetida(s) removida(s).');
      if ((removidas || semeou) && typeof saveLocal === 'function') saveLocal();
    } catch (e) { if (window.console) console.warn('MES LION: biblioteca de fatores', e); }
  }
  window.mesBibliotecaFatoresGWP100 = function () { return BIBLIOTECA.map(function (b) { return { CodigoMaterial: b[0], Dataset: b[1], Fator: b[2], Unidade: b[3] }; }); };
  window.mesTratarBibliotecaFatores = tratar;

  var bootAnterior = window.boot;
  if (typeof bootAnterior === 'function') {
    window.boot = function () { tratar(); return bootAnterior.apply(this, arguments); };
  }
  var renderAnterior = window.render;
  if (typeof renderAnterior === 'function') {
    window.render = function () { tratar(); return renderAnterior.apply(this, arguments); };
  }

  /* ACV > Fatores: a lista da biblioteca fica legível (código, material, dataset, fator, unidade, região, método) */
  var fatoresAnterior = window.acvFactorsV110;
  if (typeof fatoresAnterior === 'function') {
    window.acvFactorsV110 = function () {
      var r = fatoresAnterior.apply(this, arguments);
      try {
        var corpo = document.getElementById('v110body'), tw = corpo && corpo.querySelector('.table-wrap');
        var rows = A(temDados() ? data.acv_fatores : []);
        if (tw && rows.length) {
          tw.outerHTML = '<h3 style="margin:14px 0 6px">Biblioteca de fatores ambientais (' + rows.length + ')</h3><div class="table-wrap mes-biblioteca-fatores"><table><thead><tr>' +
            '<th>Código</th><th>Material</th><th>Dataset</th><th>Categoria</th><th>Fator</th><th>Unidade</th><th>Região</th><th>Método</th><th>Fonte</th></tr></thead><tbody>' +
            rows.map(function (f) {
              var m = materialDe(f.CodigoMaterial);
              var fator = Number(String(f.Fator == null ? '' : f.Fator).replace(',', '.'));
              return '<tr><td>' + E(f.CodigoMaterial) + '</td><td>' + E(m ? String(m.DescricaoMateriais || '').trim() : '— (referência)') + '</td><td>' + E(f.Dataset) +
                '</td><td>' + E(f.Categoria) + '</td><td style="text-align:right">' + E(isFinite(fator) && String(f.Fator).trim() !== '' ? fator.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : f.Fator) +
                '</td><td>' + E(f.Unidade) + '</td><td>' + E(f.Regiao) + '</td><td>' + E(f.Metodo || '') + '</td><td>' + E(f.Fonte || f.Versao || '') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        }
      } catch (e) { if (window.console) console.warn('MES LION: lista de fatores', e); }
      return r;
    };
  }

  /* Versão ativa da biblioteca: vale nos cálculos. O banco LCI usava o primeiro fator preenchido do material, e as
     versões importadas entram no fim da lista: a importação não mudava o cálculo dos materiais que já tinham fator. */
  function numero(v) { if (typeof num === 'function') return num(v); var n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
  if (typeof window.lciActiveFactorV37 === 'function') {
    window.lciActiveFactorV37 = function (codMaterial, indicador) {
      try { if (typeof window.ensureLCIDatabaseFromEntradasV37 === 'function') window.ensureLCIDatabaseFromEntradasV37(); } catch (e) { }
      var rows = A(temDados() ? data.sust_lci : []).filter(function (r) {
        return r && r.CodigoMaterial === codMaterial && r.Indicador === indicador && String(r.Ativo || 'Sim').toLowerCase() !== 'não';
      });
      var escolhido = rows.find(function (r) { return r.LibraryActive === 'Sim' && numero(r.FatorPorKg) > 0; }) ||
        rows.find(function (r) { return numero(r.FatorPorKg) > 0; }) || rows[0];
      return escolhido ? numero(escolhido.FatorPorKg) : 0;
    };
  }

  /* ---- Importação da Biblioteca de Dados Ambientais ----
     Template .xlsx (aba "Fatores" com linhas de EXEMPLO fictícias já no formato válido e uma linha por material para
     preencher; aba "Como preencher"). A importação lê .xlsx (inclusive salvo pelo Excel), .csv (; , ou tabulação) e o
     .xls do template anterior; ignora as linhas sem fator; avisa antes de gravar linhas de EXEMPLO. */
  var COLUNAS = ['CodigoMaterial', 'DescricaoMaterial', 'UMMaterial', 'Indicador', 'UnidadeIndicador', 'FatorPorKg', 'Metodo', 'Fonte', 'Cenario', 'Validade', 'Observacoes'];
  var OBRIGATORIAS = ['CodigoMaterial', 'Indicador', 'UnidadeIndicador', 'FatorPorKg', 'Metodo', 'Fonte', 'Cenario'];
  var APELIDOS = { codigo: 'CodigoMaterial', codigodomaterial: 'CodigoMaterial', material: 'DescricaoMaterial', descricao: 'DescricaoMaterial', um: 'UMMaterial',
    unidade: 'UnidadeIndicador', fator: 'FatorPorKg', fatorkg: 'FatorPorKg', metodologia: 'Metodo', dataset: 'Fonte', observacao: 'Observacoes' };
  var OBS_EXEMPLO = 'EXEMPLO fictício — substitua pelos dados da sua fonte ou apague esta linha';
  function indicadoresBib() {
    try { var l = A(indicadoresLCIV37()); if (l.length) return l; } catch (e) { }
    return [{ Indicador: 'Mudanças climáticas', UnidadeIndicador: KG }];
  }
  function chaveCol(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase(); }
  function xmlEsc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); }
  function colLetra(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndice(letras) { var n = 0; String(letras || '').toUpperCase().replace(/[^A-Z]/g, '').split('').forEach(function (ch) { n = n * 26 + ch.charCodeAt(0) - 64; }); return n - 1; }
  var TABELA_CRC = null;
  function crc32(b) {
    if (!TABELA_CRC) {
      TABELA_CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABELA_CRC[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) crc = TABELA_CRC[(crc ^ b[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  /* ZIP sem compressão (formato do .xlsx) */
  function zipSemCompressao(arquivos) {
    var enc = new TextEncoder(), partes = [], central = [], offset = 0, agora = new Date();
    var hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
    var dia = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
    arquivos.forEach(function (a) {
      var nome = enc.encode(a.nome), dados = enc.encode(a.texto), crc = crc32(dados);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, hora, true); lh.setUint16(12, dia, true); lh.setUint32(14, crc, true); lh.setUint32(18, dados.length, true);
      lh.setUint32(22, dados.length, true); lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true);
      partes.push(new Uint8Array(lh.buffer), nome, dados);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, hora, true); ch.setUint16(14, dia, true); ch.setUint32(16, crc, true); ch.setUint32(20, dados.length, true); ch.setUint32(24, dados.length, true);
      ch.setUint16(28, nome.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nome);
      offset += 30 + nome.length + dados.length;
    });
    var tamCentral = central.reduce(function (s, p) { return s + p.length; }, 0);
    var fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(4, 0, true); fim.setUint16(6, 0, true); fim.setUint16(8, arquivos.length, true);
    fim.setUint16(10, arquivos.length, true); fim.setUint32(12, tamCentral, true); fim.setUint32(16, offset, true); fim.setUint16(20, 0, true);
    var todas = partes.concat(central, [new Uint8Array(fim.buffer)]), saida = new Uint8Array(todas.reduce(function (s, p) { return s + p.length; }, 0)), pos = 0;
    todas.forEach(function (p) { saida.set(p, pos); pos += p.length; });
    return saida;
  }
  /* linhas: [{c: [valores], s: estilo}] — número vira célula numérica, texto vira texto */
  function folhaXML(linhas, op) {
    op = op || {};
    var rows = linhas.map(function (l, r) {
      return '<row r="' + (r + 1) + '">' + l.c.map(function (v, c) {
        var ref = colLetra(c) + (r + 1), st = l.s ? ' s="' + l.s + '"' : '';
        if (v === '' || v == null) return l.s ? '<c r="' + ref + '"' + st + '/>' : '';
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
        return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('');
    var cols = op.larguras ? '<cols>' + op.larguras.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
    var vista = '<sheetViews><sheetView workbookViewId="0"' + (op.ativa ? ' tabSelected="1"' : '') + '>' +
      (op.congelar ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') + '</sheetView></sheetViews>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      vista + '<sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + rows + '</sheetData>' + (op.validacao || '') + '</worksheet>';
  }
  function gerarXlsx(folhas) {
    var ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml.', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var arquivos = [
      { nome: '[Content_Types].xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="' + ct + 'sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="' + ct + 'styles+xml"/>' +
        folhas.map(function (f, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="' + ct + 'worksheet+xml"/>'; }).join('') + '</Types>' },
      { nome: '_rels/.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { nome: 'xl/workbook.xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + rel + '">' +
        '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' + folhas.map(function (f, i) { return '<sheet name="' + xmlEsc(f.nome) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' },
      { nome: 'xl/_rels/workbook.xml.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        folhas.map(function (f, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="' + rel + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (folhas.length + 1) + '" Type="' + rel + '/styles" Target="styles.xml"/></Relationships>' },
      { nome: 'xl/styles.xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><b/><sz val="13"/><color rgb="FF004B87"/><name val="Calibri"/><family val="2"/></font></fonts>' +
        '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF004B87"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
    ];
    folhas.forEach(function (f, i) { arquivos.push({ nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', texto: f.xml }); });
    return zipSemCompressao(arquivos);
  }
  function exemplosTemplate(mats) {
    var inds = indicadoresBib(), un = function (nome, padrao) { var x = inds.find(function (i) { return i.Indicador === nome; }); return x ? x.UnidadeIndicador : padrao; };
    var bons = mats.filter(function (m) { return /^kg$/i.test(String(m.UM || '').trim()) && !/solvent/i.test(String(m.Categoria || '')); });
    var m1 = bons[0] || mats[0] || { 'CódigoMaterial': 'MP0001', DescricaoMateriais: 'Material de exemplo', UM: 'kg' }, m2 = bons[1] || mats[1] || m1;
    var nome = function (m) { return String(m.DescricaoMateriais || m['CódigoMaterial'] || '').trim(); };
    var linha = function (m, ind, unidade, fator, metodo, fonte) {
      return [m['CódigoMaterial'] || '', nome(m), m.UM || '', ind, unidade, fator, metodo, fonte, 'Base / Brasil', '31/12/2027', OBS_EXEMPLO];
    };
    return [
      linha(m1, 'Mudanças climáticas', un('Mudanças climáticas', KG), 2.5, 'IPCC 2021 GWP100', 'EXEMPLO: ' + nome(m1) + ' {GLO}| market for ' + nome(m1).toLowerCase() + ' | Cut-off, U (ecoinvent 3.10)'),
      linha(m1, 'Acidificação', un('Acidificação', 'mol H+ eq/kg'), 0.0125, 'EF 3.1', 'EXEMPLO: ' + nome(m1) + ' {GLO}| market for ' + nome(m1).toLowerCase() + ' | Cut-off, U (ecoinvent 3.10)'),
      linha(m2, 'Água', un('Água', 'L/kg'), 35, 'AWARE', 'EXEMPLO: ' + nome(m2) + ' {RoW}| production | Cut-off, U (ecoinvent 3.10)')
    ];
  }
  function templateXlsx() {
    var mats = A(temDados() ? data.materiais : []).filter(function (m) { return m && m['CódigoMaterial']; });
    var inds = indicadoresBib();
    var fatores = [{ c: COLUNAS, s: 1 }].concat(exemplosTemplate(mats).map(function (l) { return { c: l, s: 2 }; }),
      mats.map(function (m) { return { c: [m['CódigoMaterial'], String(m.DescricaoMateriais || '').trim(), m.UM || '', 'Mudanças climáticas', KG, '', METODO, '', 'Base / Brasil', '', ''] }; }));
    var lista = inds.map(function (i) { return i.Indicador; }).join(',');
    var validacao = lista.length < 250 ? '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Indicador" ' +
      'error="Escolha um indicador da lista (aba Como preencher)." sqref="D2:D2000"><formula1>"' + xmlEsc(lista) + '"</formula1></dataValidation></dataValidations>' : '';
    var instr = [
      { c: ['Biblioteca de fatores ambientais do MES LION — como preencher'], s: 4 }, { c: [''] },
      { c: ['1. Preencha a aba "Fatores": uma linha por material e por indicador. Linhas sem FatorPorKg são ignoradas na importação.'], s: 3 },
      { c: ['2. As linhas amarelas são EXEMPLOS FICTÍCIOS, já no formato válido: mostram como preencher. Substitua pelos dados da sua fonte (ecoinvent ou outra base licenciada) ou apague. Se forem importadas sem alteração, o MES pergunta antes de gravar.'], s: 3 },
      { c: ['3. CodigoMaterial deve existir no cadastro de Materiais do MES: cada material já vem em uma linha, com código, descrição e unidade. Para outro indicador do mesmo material, copie a linha e troque o indicador.'], s: 3 },
      { c: ['4. FatorPorKg é o fator por kg de material: só o número, sem unidade (2,5 ou 2.5).'], s: 3 },
      { c: ['5. Salve como "Pasta de Trabalho do Excel (.xlsx)" ou CSV. O formato antigo "Excel 97-2003 (.xls)" não é lido.'], s: 3 },
      { c: ['6. Cada importação cria uma nova versão da biblioteca: a anterior fica preservada e a nova passa a valer nos cálculos de ACV. Importe a lista completa de fatores: os materiais que ficarem fora da nova versão voltam a usar o fator do banco LCI.'], s: 3 },
      { c: [''] }, { c: ['Coluna', 'Obrigatória', 'O que informar', 'Exemplo'], s: 1 },
      { c: ['CodigoMaterial', 'Sim', 'Código do material no cadastro do MES', (mats[0] || {})['CódigoMaterial'] || 'MP0003'], s: 3 },
      { c: ['DescricaoMaterial', 'Não', 'Só para conferência (o MES usa a descrição do cadastro)', String((mats[0] || {}).DescricaoMateriais || '').trim()], s: 3 },
      { c: ['UMMaterial', 'Não', 'Unidade do material no cadastro', (mats[0] || {}).UM || 'kg'], s: 3 },
      { c: ['Indicador', 'Sim', 'Um dos indicadores da lista abaixo', 'Mudanças climáticas'], s: 3 },
      { c: ['UnidadeIndicador', 'Sim', 'Unidade do fator (por kg de material)', KG], s: 3 },
      { c: ['FatorPorKg', 'Sim', 'Valor do fator por kg de material', 2.5], s: 3 },
      { c: ['Metodo', 'Sim', 'Método de avaliação de impacto', 'IPCC 2021 GWP100'], s: 3 },
      { c: ['Fonte', 'Sim', 'Dataset ou base de dados de origem', 'Lithium iron phosphate {CN}| market for lithium iron phosphate | Cut-off, U'], s: 3 },
      { c: ['Cenario', 'Sim', 'Cenário em que o fator vale', 'Base / Brasil'], s: 3 },
      { c: ['Validade', 'Não', 'Data limite de uso do fator', '31/12/2027'], s: 3 },
      { c: ['Observacoes', 'Não', 'Livre. Linhas que começam com "EXEMPLO" são tratadas como exemplo.', ''], s: 3 },
      { c: [''] }, { c: ['Indicador', 'Unidade sugerida'], s: 1 }
    ].concat(inds.map(function (i) { return { c: [i.Indicador, i.UnidadeIndicador] }; }));
    return gerarXlsx([
      { nome: 'Fatores', xml: folhaXML(fatores, { larguras: [14, 30, 8, 26, 16, 12, 26, 60, 16, 12, 60], congelar: true, ativa: true, validacao: validacao }) },
      { nome: 'Como preencher', xml: folhaXML(instr, { larguras: [32, 12, 60, 62] }) }
    ]);
  }
  window.mesTemplateBibliotecaXlsx = templateXlsx;
  window.baixarTemplateAmbientalV230 = function () {
    try {
      var blob = new Blob([templateXlsx()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'TEMPLATE_BIBLIOTECA_AMBIENTAL_MES_LION.xlsx';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    } catch (e) { alert('Não foi possível gerar o template.\n\nDetalhe: ' + (e && e.message ? e.message : e)); }
  };

  /* leitura da planilha: linhas de células {v: texto, num: célula numérica do Excel} */
  async function inflar(dados) {
    if (typeof DecompressionStream !== 'function') throw new Error('Este navegador não consegue ler .xlsx. Salve a planilha como CSV e importe de novo.');
    var fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }
  async function lerZip(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), fim = -1, saida = {}, dec = new TextDecoder('utf-8');
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; } }
    if (fim < 0) throw new Error('arquivo .xlsx inválido');
    var n = dv.getUint16(fim + 10, true), pos = dv.getUint32(fim + 16, true);
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('arquivo .xlsx inválido');
      var metodo = dv.getUint16(pos + 10, true), tam = dv.getUint32(pos + 20, true), lNome = dv.getUint16(pos + 28, true), lExtra = dv.getUint16(pos + 30, true),
        lCom = dv.getUint16(pos + 32, true), loc = dv.getUint32(pos + 42, true);
      var nome = dec.decode(bytes.subarray(pos + 46, pos + 46 + lNome));
      if (/\.(xml|rels)$/i.test(nome)) {
        var ini = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true), dados = bytes.subarray(ini, ini + tam);
        saida[nome] = metodo === 0 ? dados : (metodo === 8 ? await inflar(dados) : null);
      }
      pos += 46 + lNome + lExtra + lCom;
    }
    return saida;
  }
  function filhos(no, nome) { return [].slice.call(no.getElementsByTagNameNS('*', nome)); }
  async function lerXlsx(bytes) {
    var z = await lerZip(bytes), dec = new TextDecoder('utf-8');
    var xml = function (n) { var b = z[n]; return b ? new DOMParser().parseFromString(dec.decode(b), 'application/xml') : null; };
    var wb = xml('xl/workbook.xml');
    if (!wb) throw new Error('arquivo .xlsx sem planilhas');
    var alvo = {}, rels = xml('xl/_rels/workbook.xml.rels');
    if (rels) filhos(rels, 'Relationship').forEach(function (r) { alvo[r.getAttribute('Id')] = r.getAttribute('Target'); });
    var folhas = filhos(wb, 'sheet').map(function (s) {
      return { nome: s.getAttribute('name') || '', rid: s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id') };
    });
    var escolha = folhas.find(function (f) { return chaveCol(f.nome) === 'fatores'; }) || folhas[0];
    var caminho = String((escolha && alvo[escolha.rid]) || 'worksheets/sheet1.xml').replace(/^\//, '');
    if (caminho.indexOf('xl/') !== 0) caminho = 'xl/' + caminho;
    var comp = [], ss = xml('xl/sharedStrings.xml');
    if (ss) filhos(ss, 'si').forEach(function (si) { comp.push(filhos(si, 't').filter(function (t) { return t.parentNode && t.parentNode.localName !== 'rPh'; }).map(function (t) { return t.textContent; }).join('')); });
    var folha = xml(caminho);
    if (!folha) throw new Error('aba da planilha não encontrada no .xlsx');
    var linhas = [];
    filhos(folha, 'row').forEach(function (row) {
      var r = Number(row.getAttribute('r')) || (linhas.length + 1), cel = [];
      filhos(row, 'c').forEach(function (c) {
        var ref = c.getAttribute('r') || '', col = ref ? colIndice(ref) : cel.length, t = c.getAttribute('t') || '', v = filhos(c, 'v')[0], valor = '';
        if (t === 's') valor = comp[Number(v ? v.textContent : -1)] || '';
        else if (t === 'inlineStr') valor = filhos(c, 't').map(function (x) { return x.textContent; }).join('');
        else if (t === 'b') valor = v && v.textContent === '1' ? 'VERDADEIRO' : 'FALSO';
        else valor = v ? v.textContent : '';
        cel[col >= 0 ? col : cel.length] = { v: valor, num: (t === '' || t === 'n') && !!v };
      });
      linhas[r - 1] = cel;
    });
    for (var i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = [];
    return linhas;
  }
  function lerCSV(txt) {
    if (txt.charAt(0) === String.fromCharCode(0xFEFF)) txt = txt.slice(1);
    var primeira = txt.split(/\r?\n/)[0] || '';
    var sep = primeira.indexOf(';') >= 0 ? ';' : (primeira.indexOf('\t') >= 0 ? '\t' : ',');
    var linhas = [], linha = [], campo = '', aspas = false;
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i];
      if (aspas) {
        if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
      } else if (ch === '"') aspas = true;
      else if (ch === sep) { linha.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
      else campo += ch;
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas.map(function (l) { return l.map(function (v) { return { v: v, num: false }; }); });
  }
  function lerHTML(txt) {
    var doc = new DOMParser().parseFromString(txt, 'text/html');
    return [].slice.call(doc.querySelectorAll('tr')).map(function (tr) { return [].slice.call(tr.querySelectorAll('th,td')).map(function (td) { return { v: td.textContent.trim(), num: false }; }); });
  }
  async function lerPlanilha(f) {
    var bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 3 && bytes[3] === 4) return lerXlsx(bytes);
    if (bytes.length > 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
      throw new Error('O arquivo está no formato antigo do Excel 97-2003 (.xls binário), que o MES não lê. No Excel, use Arquivo > Salvar como > "Pasta de Trabalho do Excel (.xlsx)" (ou CSV) e importe de novo.');
    }
    var txt;
    try { txt = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { txt = new TextDecoder('windows-1252').decode(bytes); }
    return /<table/i.test(txt) ? lerHTML(txt) : lerCSV(txt);
  }
  function numeroPlanilha(c) {
    if (!c || String(c.v).trim() === '') return NaN;
    if (c.num) return Number(c.v);
    var s = String(c.v).trim().replace(/\s/g, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
  }
  function dataPlanilha(c) {
    if (c && c.num && Number(c.v) > 20000 && Number(c.v) < 80000) {
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(c.v)) * 86400000);
      return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
    }
    return c ? String(c.v).trim() : '';
  }
  function caixa(html) { var b = document.getElementById('lci_import_result'); if (b) b.innerHTML = html; else alert(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); }

  window.importarBibliotecaAmbientalV230 = async function () {
    if (!temDados()) return;
    var inp = document.getElementById('lci_import_file'), f = inp && inp.files && inp.files[0];
    if (!f) return alert('Selecione a planilha preenchida (.xlsx, .csv ou o .xls do template anterior).');
    var linhas;
    try { linhas = await lerPlanilha(f); } catch (e) {
      caixa('<div class="card warn"><h3>Importação não realizada</h3><p>' + E(e && e.message ? e.message : e) + '</p></div>');
      return;
    }
    var ic = -1, mapa = {};
    for (var i = 0; i < linhas.length && ic < 0; i++) {
      var m = {};
      (linhas[i] || []).forEach(function (c, j) { var k = chaveCol(c && c.v), nome = COLUNAS.find(function (x) { return chaveCol(x) === k; }) || APELIDOS[k]; if (nome && m[nome] == null) m[nome] = j; });
      if (m.CodigoMaterial != null && m.FatorPorKg != null) { ic = i; mapa = m; }
    }
    if (ic < 0) {
      caixa('<div class="card warn"><h3>Importação não realizada</h3><p>Não encontrei a linha de títulos com as colunas <b>CodigoMaterial</b> e <b>FatorPorKg</b>. Use o template baixado pelo MES (aba "Fatores").</p></div>');
      return;
    }
    var inds = indicadoresBib(), indPorChave = {};
    inds.forEach(function (x) { indPorChave[chaveCol(x.Indicador)] = x.Indicador; });
    ['gwp', 'gwp100', 'aquecimentoglobal', 'pegadadecarbono', 'climatechange'].forEach(function (k) { indPorChave[k] = indPorChave[k] || 'Mudanças climáticas'; });
    var erros = [], validas = [], exemplos = [], semFator = 0;
    linhas.slice(ic + 1).forEach(function (cel, j) {
      var lin = ic + j + 2, cell = function (n) { return mapa[n] != null ? cel[mapa[n]] : null; }, txt = function (n) { var c = cell(n); return c ? String(c.v == null ? '' : c.v).trim() : ''; };
      if (!COLUNAS.some(function (n) { return txt(n); })) return;
      if (!txt('FatorPorKg')) { semFator++; return; }
      var r = {};
      COLUNAS.forEach(function (n) { r[n] = txt(n); });
      r.Validade = dataPlanilha(cell('Validade'));
      var faltam = OBRIGATORIAS.filter(function (n) { return !r[n]; });
      if (faltam.length) erros.push('Linha ' + lin + ': falta ' + faltam.join(', '));
      var mat = materialDe(r.CodigoMaterial);
      if (r.CodigoMaterial && !mat) erros.push('Linha ' + lin + ': o código ' + r.CodigoMaterial + ' não existe no cadastro de Materiais');
      var fator = numeroPlanilha(cell('FatorPorKg'));
      if (!isFinite(fator)) erros.push('Linha ' + lin + ': FatorPorKg "' + r.FatorPorKg + '" não é um número');
      else if (fator < 0) erros.push('Linha ' + lin + ': FatorPorKg negativo');
      var ind = indPorChave[chaveCol(r.Indicador)];
      if (r.Indicador && !ind) erros.push('Linha ' + lin + ': indicador "' + r.Indicador + '" não reconhecido (use: ' + inds.map(function (x) { return x.Indicador; }).join(', ') + ')');
      if (faltam.length || !mat || !isFinite(fator) || fator < 0 || !ind) return;
      var item = Object.assign({}, r, { Indicador: ind, _mat: mat, _fator: fator, _linha: lin });
      validas.push(item);
      if (/^\s*exemplo/i.test(r.Observacoes) || /^\s*exemplo/i.test(r.Fonte)) exemplos.push(item);
    });
    if (erros.length) {
      caixa('<div class="card warn"><h3>Importação não realizada</h3><p><b>' + erros.length + ' inconsistência(s)</b>. Nenhum registro foi gravado. Corrija a planilha e importe de novo.</p><ul>' +
        erros.slice(0, 100).map(function (e) { return '<li>' + E(e) + '</li>'; }).join('') + '</ul></div>');
      return;
    }
    if (exemplos.length) {
      var junto = confirm('A planilha tem ' + exemplos.length + ' linha(s) de EXEMPLO (fictícias, linha ' + exemplos.map(function (x) { return x._linha; }).join(', ') + ').\n\n' +
        'OK = importar também os exemplos\nCancelar = importar só as outras linhas');
      if (!junto) validas = validas.filter(function (x) { return exemplos.indexOf(x) < 0; });
    }
    if (!validas.length) {
      caixa('<div class="card warn"><h3>Nada para importar</h3><p>Nenhuma linha com fator preenchido' + (exemplos.length ? ' além dos exemplos' : '') + '. ' +
        'Preencha a coluna <b>FatorPorKg</b> (e Fonte) dos materiais na aba "Fatores" do template e importe de novo.' + (semFator ? ' Linhas sem fator ignoradas: ' + semFator + '.' : '') + '</p></div>');
      return;
    }
    data.sust_lci = A(data.sust_lci);
    data.acv_fatores = A(data.acv_fatores);
    var versoes = data.sust_lci.map(function (r) { return Number(r && r.LibraryVersion) || 0; });
    var ver = (versoes.length ? Math.max.apply(null, versoes) : 0) + 1, lote = 'ENV-' + Date.now(), agora = new Date().toLocaleString('pt-BR');
    data.sust_lci.forEach(function (r) { if (r && r.LibraryActive === 'Sim') r.LibraryActive = 'Não'; });
    data.acv_fatores.forEach(function (r) { if (r && r.OrigemBibliotecaAmbiental === 'Sim') r.LibraryActive = 'Não'; });
    var novos = [];
    validas.forEach(function (r) {
      var mat = r._mat, fkg = '';
      try { fkg = String((typeof materialKgFactorV35 === 'function' && materialKgFactorV35(r.CodigoMaterial)) || ''); } catch (e) { fkg = ''; }
      data.sust_lci.push({ CodigoMaterial: r.CodigoMaterial, DescricaoMaterial: mat.DescricaoMateriais || r.DescricaoMaterial || '', CategoriaMaterial: mat.Categoria || '',
        UnidadeEntrada: mat.UM || r.UMMaterial || '', FatorKg: fkg, Indicador: r.Indicador, UnidadeIndicador: r.UnidadeIndicador, FatorPorKg: String(r._fator),
        Metodo: r.Metodo, Fonte: r.Fonte, Cenario: r.Cenario, Ativo: 'Sim', Validade: r.Validade || '', Observacoes: r.Observacoes || '',
        LibraryVersion: ver, LibraryActive: 'Sim', ImportBatch: lote, ImportedAt: agora, ImportedFile: f.name });
      novos.push({ CodigoMaterial: r.CodigoMaterial, Categoria: r.Indicador, Fator: String(r._fator), Unidade: r.UnidadeIndicador, Dataset: r.Fonte,
        Versao: 'Biblioteca Ambiental v' + ver, Regiao: r.Cenario, Ano: r.Validade || '', Qualidade: r.Observacoes || '', Metodo: r.Metodo,
        OrigemBibliotecaAmbiental: 'Sim', LibraryVersion: ver, LibraryActive: 'Sim', ImportBatch: lote });
    });
    data.acv_fatores = novos.concat(data.acv_fatores);
    if (typeof saveLocal === 'function') saveLocal();
    var importouExemplos = validas.some(function (x) { return exemplos.indexOf(x) >= 0; });
    caixa('<div class="card env-success"><h3>Importação concluída</h3><p><b>Biblioteca v' + ver + '</b> criada com ' + validas.length + ' registro(s)' +
      (semFator ? ' (' + semFator + ' linha(s) sem fator ignorada(s))' : '') + '. A versão anterior foi preservada e a nova passa a valer nos cálculos de ACV.' +
      (importouExemplos ? ' <b>Atenção:</b> as linhas de EXEMPLO (fictícias) foram importadas.' : '') + '</p><p>Lote ' + E(lote) + ' · arquivo ' + E(f.name) + '</p></div>');
    if (document.getElementById('v110body') && typeof acvBibliotecaAmbientalV233 === 'function') setTimeout(function () {
      var res = document.getElementById('lci_import_result'), html = res ? res.innerHTML : '';
      acvBibliotecaAmbientalV233();
      var novo = document.getElementById('lci_import_result');
      if (novo && html) novo.innerHTML = html;
    }, 700);
  };
  window.bibliotecaAmbientalImportBoxV230 = function () {
    return '<div class="form mes-lci-import"><h3>Importar fatores ambientais / ecoinvent</h3><p class="muted">O MES fornece o template — com linhas de EXEMPLO fictícias já no ' +
      'formato válido e uma linha por material para preencher — e não distribui dados licenciados do ecoinvent. Preencha com os dados obtidos/licenciados pela organização: ' +
      'a importação confere os códigos dos materiais, os indicadores e os campos obrigatórios antes de gravar. Aceita .xlsx, .csv e o .xls do template anterior.</p>' +
      '<div class="toolbar"><button onclick="baixarTemplateAmbientalV230()">Baixar template Excel (com exemplo)</button><label>Planilha preenchida<input id="lci_import_file" type="file" ' +
      'accept=".xlsx,.xls,.csv"></label><button onclick="importarBibliotecaAmbientalV230()">Validar e importar</button></div><div id="lci_import_result"></div></div>';
  };
})();

/* ---------------------------------------------------------------------
   2) PASSAPORTE DA BATERIA
   Formulário: o cadastro (ID, OP, produto, lote, cliente, fabricante, status, imagens) continua o mesmo; os dois blocos
   regulatórios que se repetiam (V1.1.1 "UE" e V1.1.4 "Guidance v2.0") viram uma seção única, por assunto, em que
   cada dado tem a marca "painel". Os valores antigos são aproveitados (quando o campo novo está vazio).
   Gravação no passaporte: os campos (chaves BP_DP.. / EU_..), CamposOcultos (dados desmarcados), MassasExcluidas
   (materiais fora da composição publicada), FonteACV, CamposAutomaticos (último valor puxado da OP, para saber se o
   campo foi alterado à mão) e CamposUnificados = "Sim".
   --------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.__mesPassaporteUnificado) return;
  window.__mesPassaporteUnificado = true;

  var A = function (x) { return Array.isArray(x) ? x : []; };
  function $(id) { return document.getElementById(id); }
  function temDados() { return typeof data === 'object' && data !== null; }
  function E(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function N(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).trim().replace(/\s/g, '');
    if (!s) return 0;
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  function fmt(v, casas) {
    var n = typeof v === 'number' ? v : N(v);
    if (!isFinite(n)) return '';
    return n.toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 3 : casas });
  }
  function fmtSig(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    var a = Math.abs(n), casas = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : a >= 0.01 ? 5 : 8;
    return n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
  }
  function numTexto(v, casas) { var s = String(v == null ? '' : v).trim(); if (!s) return ''; var n = N(s); return n || /^0+([.,]0*)?$/.test(s) ? fmt(n, casas) : s; }
  function temValor(v) { return v != null && String(v).trim() !== ''; }
  function generico(v) { return /^\s*Texto de validação:/i.test(String(v || '')); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function setDe(s) { return new Set(String(s == null ? '' : s).split(';').map(function (x) { return x.trim(); }).filter(Boolean)); }
  function lerJSON(s) { try { var o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function usuarioAtual() { var u = window.MES_CURRENT_USER; return (u && (u.username || u.fullName)) || 'admin'; }
  function opDe(c) { if (!c || !temDados()) return null; return A(data.op).find(function (o) { return o && String(o.CodOP || '') === String(c); }) || null; }
  function produtoDe(c) { if (!c || !temDados()) return {}; return A(data.estrutura).find(function (p) { return p && String(p['Código'] || '') === String(c); }) || {}; }
  function materialDe(c) { return A(temDados() ? data.materiais : []).find(function (m) { return m && String(m['CódigoMaterial']) === String(c); }) || null; }
  function opFechada(op) { var s = String(op && op.Status || '').toUpperCase(); return s.indexOf('CONCLU') >= 0 || s.indexOf('ENCERR') >= 0; }
  function dataNum(s) {
    var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() : 0;
  }
  function rootPA(codOP) {
    if (!codOP) return '';
    try { if (typeof v4034RootPAForBP === 'function') return v4034RootPAForBP({ CodOrdemProducao: codOP }) || codOP; } catch (e) { }
    return codOP;
  }
  function familiaCods(root) {
    var s = new Set([String(root)]);
    try { if (typeof v4035FamilyOps === 'function') A(v4035FamilyOps(root)).forEach(function (o) { if (o && o.CodOP) s.add(String(o.CodOP)); }); } catch (e) { }
    return s;
  }
  function celulasDoLote(op) {
    if (!op) return 1;
    var q = N(op.QtdProduzida);
    if (!(q > 0)) { try { if (typeof opProduced === 'function') q = N(opProduced(op.CodOP)); } catch (e) { q = 0; } }
    if (!(q > 0)) q = N(op.QtdPlanejada);
    return q > 0 ? q : 1;
  }
  function mesAno(op) {
    if (!op) return '';
    var prods = A(data.producao).filter(function (p) { return p && String(p.CodOP || '') === String(op.CodOP); })
      .map(function (p) { return p.DataApontamento; }).filter(Boolean).sort(function (a, b) { return dataNum(b) - dataNum(a); });
    var cands = [op.DataEncerramento, prods[0], op.DataOP, op.DataCriacao];
    for (var i = 0; i < cands.length; i++) {
      var m = String(cands[i] || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return pad(m[2]) + '/' + m[3];
    }
    return '';
  }

  /* ---------------- catálogo único de campos ----------------
     k: chave gravada no passaporte; l: rótulo; g: grupo; u: unidade; dp: data point do Battery Passport (Guia UE);
     t: 'area' (texto longo) ou 'lista' (com sugestões); base: id do campo do cadastro (o dado não se repete);
     leg: chaves antigas aproveitadas quando o campo está vazio; oculto: fora do painel por padrão (acesso restrito). */
  var GRUPOS = [
    { id: 'ident', titulo: 'Identificação e fabricante', aberto: true },
    { id: 'celula', titulo: 'Célula — estrutura do produto', aberto: true, nota: 'Puxados do cadastro da estrutura (PA) da OP.' },
    { id: 'composicao', titulo: 'Composição e circularidade', aberto: true },
    { id: 'carbono', titulo: 'Pegada de carbono (ACV)', aberto: true },
    { id: 'desempenho', titulo: 'Desempenho e durabilidade', aberto: false },
    { id: 'conformidade', titulo: 'Conformidade, segurança e fim de vida', aberto: false },
    { id: 'uso', titulo: 'Uso e estado de saúde (dados dinâmicos)', aberto: false }
  ];
  var LISTA_CATEGORIA = ['Industrial', 'Veículo elétrico (EV)', 'Meio de transporte leve (LMT)', 'Portátil', 'Arranque, iluminação e ignição (SLI)'];
  var LISTA_ESTADO = ['original', 'reutilizada (re-used)', 'reaproveitada (repurposed)', 'remanufaturada', 'resíduo (waste)'];
  function residuosLegado(bp) {
    var p = [['a) Prevenção', 'EU_W_A_Prevencao'], ['b) Recolha', 'EU_W_B_Recolha'], ['c) Obrigações do usuário final', 'EU_W_C_Obrigacoes'],
      ['d) Símbolos', 'EU_W_D_Simbolos'], ['e) Impactos ambientais e à saúde', 'EU_W_E_Impactos'], ['f) Reutilização e reciclagem', 'EU_W_F_Reutilizacao']]
      .filter(function (x) { return temValor(bp[x[1]]) && !generico(bp[x[1]]); }).map(function (x) { return x[0] + ': ' + String(bp[x[1]]).trim(); });
    if (temValor(bp.Comp_BateriasDescartadas_Texto) && !generico(bp.Comp_BateriasDescartadas_Texto)) p.push(String(bp.Comp_BateriasDescartadas_Texto).trim());
    return p.join('\n');
  }
  function resistenciaLegado(bp) {
    var c = bp.EU_1_15_RICelulas, k = bp.EU_1_15_RIPack;
    if (temValor(c) && temValor(k)) return 'célula: ' + c + '; pack: ' + k;
    return temValor(c) ? c : (temValor(k) ? 'pack: ' + k : '');
  }
  function individualLegado(bp) {
    return [['Informações', 'Ind_InfoIndividual_Texto'], ['Desempenho', 'Ind_ParametrosPerformance_Texto'], ['Estado', 'Ind_StatusBateria_Texto'], ['Uso', 'Ind_DadosUso_Texto']]
      .filter(function (x) { return temValor(bp[x[1]]) && !generico(bp[x[1]]); }).map(function (x) { return x[0] + ': ' + String(bp[x[1]]).trim(); }).join('\n');
  }
  var CAMPOS = [
    // identificação (os do cadastro recebem só a marca "painel")
    { k: 'FornecedorNomeSnapshot', base: 'bp_fornecedor_nome', g: 'ident', l: 'Fabricante (nome / marca)', dp: '03', leg: ['BP_DP03_ManufacturerName', 'EU_A1_Fabricante', 'EU_M1_Fabricante'] },
    { k: 'BP_DP04_ManufacturerAddress', g: 'ident', l: 'Endereço do fabricante (ponto de contato)', dp: '04', t: 'area' },
    { k: 'BP_DP05_ManufacturerContact', g: 'ident', l: 'Site e e-mail do fabricante', dp: '05' },
    { k: 'BP_DP02_Responsible', g: 'ident', l: 'Responsável pelo passaporte', dp: '02' },
    { k: 'BP_DP08_ManufacturingPlace', g: 'ident', l: 'Local de fabricação', dp: '08', leg: ['EU_A2_LocalFabrico', 'EU_C8_LocalProducao'] },
    { k: 'BP_DP09_ManufacturingDate', g: 'ident', l: 'Data de fabricação (mês/ano)', dp: '09', leg: ['EU_M6_DataFabrico'] },
    { k: 'BP_DP06_BatteryCategory', g: 'ident', l: 'Categoria da bateria', dp: '06', t: 'lista', opcoes: LISTA_CATEGORIA, leg: ['EU_A4_Categoria', 'EU_C3_Categoria'] },
    { k: 'EU_A5_Subcategoria', g: 'ident', l: 'Subcategoria' },
    { k: 'EU_A11_Finalidade', g: 'ident', l: 'Finalidade de uso' },
    { k: 'EU_A8_AnoMercado', g: 'ident', l: 'Ano de colocação no mercado' },
    { k: 'BP_DP67_BatteryStatus', g: 'ident', l: 'Estado da bateria', dp: '67', t: 'lista', opcoes: LISTA_ESTADO, leg: ['EU_A10_Estado'] },
    { k: 'IDLote', base: 'bp_lote', g: 'ident', l: 'Lote / número de série', dp: '07', leg: ['BP_DP07_ModelBatchSerial', 'EU_M7_SerieLote'] },
    { k: 'CodOrdemProducao', base: 'bp_op', g: 'ident', l: 'OP de origem' },
    { k: 'BatteryPassportGUID', base: 'bp_guid', g: 'ident', l: 'Identificador único', dp: '01', leg: ['BP_DP01_UniqueIdentifier', 'EU_A7_CodigoUnico'] },
    { k: 'ClienteNomeSnapshot', base: 'bp_cliente_nome', g: 'ident', l: 'Cliente', oculto: true },
    // célula (estrutura do produto)
    { k: 'EU_A3_Modelo', g: 'celula', l: 'Modelo da célula', leg: ['EU_M3_Modelo'] },
    { k: 'BP_FormatoCelula', g: 'celula', l: 'Formato' },
    { k: 'BP_DP12_Chemistry', g: 'celula', l: 'Química', dp: '12', leg: ['EU_A6_Tipo', 'EU_M2_Tipo'] },
    { k: 'BP_DP11_Capacity', g: 'celula', l: 'Capacidade nominal', u: 'Ah', dp: '11', leg: ['EU_1_7_CapacidadeAh', 'EU_M4_Capacidade'] },
    { k: 'BP_CapacidadeFinalAh', g: 'celula', l: 'Capacidade final calculada', u: 'Ah', oculto: true },
    { k: 'BP_DP27_NominalVoltage', g: 'celula', l: 'Tensão nominal', u: 'V', dp: '27', leg: ['EU_1_8_TensaoNom', 'EU_M5_Tensao'] },
    { k: 'BP_DP26_MinVoltage', g: 'celula', l: 'Tensão mínima', u: 'V', dp: '26', leg: ['EU_1_8_TensaoMin'] },
    { k: 'BP_DP28_MaxVoltage', g: 'celula', l: 'Tensão máxima', u: 'V', dp: '28', leg: ['EU_1_8_TensaoMax'] },
    { k: 'EU_1_8_Temperatura', g: 'celula', l: 'Faixa de temperatura das tensões' },
    { k: 'BP_EnergiaWh', g: 'celula', l: 'Energia nominal', u: 'Wh' },
    { k: 'BP_DP10_Weight', g: 'celula', l: 'Peso da célula', u: 'kg', dp: '10', leg: ['EU_A9_PesoKg'] },
    { k: 'BP_Dimensoes', g: 'celula', l: 'Dimensões' },
    { k: 'BP_DP29_OriginalPower', g: 'celula', l: 'Potência original', u: 'W', dp: '29', leg: ['EU_1_9_PotenciaW'] },
    { k: 'BP_DP30_PowerLimits', g: 'celula', l: 'Limites de potência (com faixa de temperatura)', dp: '30', leg: ['EU_1_9_Limites'] },
    // composição e circularidade
    { k: 'BP_DP45_DetailedComposition', g: 'composicao', l: 'Composição detalhada (cátodo, ânodo, eletrólito…)', dp: '45', t: 'area', oculto: true, leg: ['EU_2_1_ComposicaoDetalhada', 'EU_1_2_Composicao'] },
    { k: 'BP_DP13_HazardousSubstances', g: 'composicao', l: 'Substâncias perigosas (exceto Hg, Cd e Pb)', dp: '13', t: 'area' },
    { k: 'BP_DP15_CriticalRawMaterials', g: 'composicao', l: 'Matérias-primas críticas acima de 0,1 % m/m', dp: '15', t: 'area' },
    { k: 'BP_DP14_ExtinguishingAgent', g: 'composicao', l: 'Agente extintor', dp: '14' },
    { k: 'EU_1_5_ConteudoReciclado', g: 'composicao', l: 'Conteúdo reciclado', u: '%' },
    { k: 'BP_DP24_RenewableContent', g: 'composicao', l: 'Conteúdo renovável', u: '%', dp: '24', leg: ['EU_1_6_ConteudoRenovavel'] },
    { k: 'BP_DueDiligence', g: 'composicao', l: 'Due diligence da cadeia de fornecimento', t: 'area', leg: ['Sust_DueDiligence_Texto'] },
    // pegada de carbono (ACV)
    { k: 'BP_CO2_PorCelula', g: 'carbono', l: 'Pegada de carbono por célula' },
    { k: 'EU_C1_PegadaCarbono', g: 'carbono', l: 'Pegada de carbono por kWh' },
    { k: 'BP_CO2_PorKg', g: 'carbono', l: 'Pegada de carbono por kg de célula' },
    { k: 'BP_CO2_TotalOP', g: 'carbono', l: 'Emissão total do lote (OP)', oculto: true },
    { k: 'EU_C2_UnidadeFuncional', g: 'carbono', l: 'Unidade funcional' },
    { k: 'EU_C4_Metodologia', g: 'carbono', l: 'Metodologia' },
    { k: 'EU_C5_LimitesSistema', g: 'carbono', l: 'Limites do sistema' },
    { k: 'EU_C6_Fases', g: 'carbono', l: 'Fases do ciclo de vida incluídas', t: 'area' },
    { k: 'EU_C7_Contribuicao', g: 'carbono', l: 'Contribuição por fonte', t: 'area' },
    { k: 'BP_ACV_Indicadores', g: 'carbono', l: 'Outros indicadores ambientais (por célula)', t: 'area' },
    { k: 'EU_C9_AnoReferencia', g: 'carbono', l: 'Período de referência dos dados' },
    { k: 'BP_ACV_Fonte', g: 'carbono', l: 'Fonte do cálculo' },
    { k: 'EU_C10_Verificacao', g: 'carbono', l: 'Verificação independente' },
    { k: 'EU_C11_Verificador', g: 'carbono', l: 'Verificador' },
    // desempenho e durabilidade
    { k: 'BP_DP31_ExpectedLifeCycles', g: 'desempenho', l: 'Vida útil esperada (ciclos)', dp: '31', leg: ['BP_DP59_ExpectedLifetimeCycles', 'EU_1_10_Ciclos', 'Tec_VidaUtil_Texto'] },
    { k: 'BP_DP60_ExpectedLifetimeCalendarYears', g: 'desempenho', l: 'Vida útil esperada (anos)', dp: '60' },
    { k: 'BP_DP32_LifetimeReferenceTest', g: 'desempenho', l: 'Ensaio de referência da vida útil', dp: '32', t: 'area', leg: ['EU_1_10_Ensaio'] },
    { k: 'BP_DP39_CRate', g: 'desempenho', l: 'Taxa C do ensaio de vida útil', dp: '39', leg: ['EU_1_16_CRate'] },
    { k: 'BP_DP33_CapacityExhaustionThreshold', g: 'desempenho', l: 'Limite de capacidade para esgotamento (VE)', dp: '33', leg: ['EU_1_11_LimiteEsgotamento'] },
    { k: 'BP_DP34_StorageTemperatureRange', g: 'desempenho', l: 'Temperatura suportada fora de uso', dp: '34', leg: ['EU_1_12_TempForaUso', 'Tec_FaixaTemperatura_Texto'] },
    { k: 'BP_DP35_CommercialWarranty', g: 'desempenho', l: 'Garantia comercial', dp: '35' },
    { k: 'BP_DP36_InitialRoundTripEfficiency', g: 'desempenho', l: 'Eficiência energética ida e volta inicial', u: '%', dp: '36', leg: ['EU_1_14_EficienciaInicial', 'Tec_RoundTripEfficiency_Texto'] },
    { k: 'BP_DP37_RoundTripEfficiency50', g: 'desempenho', l: 'Eficiência ida e volta a 50 % da vida útil', u: '%', dp: '37', leg: ['EU_1_14_Eficiencia50'] },
    { k: 'BP_DP38_InternalResistance', g: 'desempenho', l: 'Resistência interna (célula e pack)', dp: '38', leg: [resistenciaLegado, 'Tec_ResistenciaInterna_Texto'] },
    // conformidade, segurança e fim de vida
    { k: 'BP_DP40_MarkingArticle134', g: 'conformidade', l: 'Marcações — Art. 13(4)', dp: '40', t: 'area' },
    { k: 'BP_DP41_MarkingArticle135', g: 'conformidade', l: 'Marcações — Art. 13(5) (símbolos Cd/Pb)', dp: '41', t: 'area' },
    { k: 'BP_DP42_EUDeclarationConformity', g: 'conformidade', l: 'Declaração UE de conformidade', dp: '42', t: 'area', leg: ['Comp_DeclaracaoUE_Texto'] },
    { k: 'BP_DP43_WasteBatteryInformation', g: 'conformidade', l: 'Prevenção e gestão de resíduos', dp: '43', t: 'area', leg: [residuosLegado] },
    { k: 'BP_DP48_DismantlingInformation', g: 'conformidade', l: 'Informações de desmontagem', dp: '48', t: 'area', oculto: true, leg: ['EU_2_3_Desmontagem', 'Eng_Desmontagem_Texto'] },
    { k: 'BP_DP49_SafetyMeasures', g: 'conformidade', l: 'Medidas de segurança', dp: '49', t: 'area', oculto: true, leg: ['EU_2_4_Seguranca', 'Eng_Seguranca_Texto'] },
    { k: 'BP_DP46_ComponentPartNumbers', g: 'conformidade', l: 'Números de peça dos componentes', dp: '46', t: 'area', oculto: true, leg: ['EU_2_2_PecasFontes'] },
    { k: 'BP_DP47_SparePartsSources', g: 'conformidade', l: 'Fontes de peças sobressalentes', dp: '47', t: 'area', oculto: true, leg: ['EU_2_2_PecasFontes'] },
    { k: 'BP_DP50_TestReports', g: 'conformidade', l: 'Relatórios de ensaio de conformidade', dp: '50', t: 'area', oculto: true },
    // uso e estado de saúde
    { k: 'BP_DP51_DynamicRatedCapacity', g: 'uso', l: 'Capacidade nominal dinâmica', u: 'Ah', dp: '51' },
    { k: 'BP_DP52_CapacityFade', g: 'uso', l: 'Perda de capacidade', u: '%', dp: '52' },
    { k: 'BP_DP53_DynamicPower', g: 'uso', l: 'Potência dinâmica', u: 'W', dp: '53' },
    { k: 'BP_DP54_PowerFade', g: 'uso', l: 'Perda de potência', u: '%', dp: '54' },
    { k: 'BP_DP55_DynamicInternalResistance', g: 'uso', l: 'Resistência interna dinâmica', u: 'Ω', dp: '55' },
    { k: 'BP_DP56_InternalResistanceIncrease', g: 'uso', l: 'Aumento da resistência interna', u: '%', dp: '56' },
    { k: 'BP_DP57_DynamicRoundTripEfficiency', g: 'uso', l: 'Eficiência ida e volta atual', u: '%', dp: '57' },
    { k: 'BP_DP58_RoundTripEfficiencyFade', g: 'uso', l: 'Perda de eficiência ida e volta', u: '%', dp: '58' },
    { k: 'BP_DP61_SOCE', g: 'uso', l: 'Estado de energia certificado (SOCE)', u: '%', dp: '61' },
    { k: 'BP_DP62_RemainingCapacity', g: 'uso', l: 'Capacidade remanescente', dp: '62' },
    { k: 'BP_DP63_RemainingPower', g: 'uso', l: 'Potência remanescente', dp: '63' },
    { k: 'BP_DP64_RemainingRoundTripEfficiency', g: 'uso', l: 'Eficiência ida e volta remanescente', dp: '64' },
    { k: 'BP_DP65_SelfDischargeEvolution', g: 'uso', l: 'Evolução da autodescarga', dp: '65' },
    { k: 'BP_DP66_OhmicResistance', g: 'uso', l: 'Resistência ôhmica', dp: '66' },
    { k: 'BP_DP68_ChargeDischargeCycles', g: 'uso', l: 'Ciclos de carga e descarga', dp: '68' },
    { k: 'BP_DP69_NegativeEvents', g: 'uso', l: 'Eventos negativos (acidentes)', dp: '69', t: 'area' },
    { k: 'BP_DP70_OperatingEnvironmentalConditions', g: 'uso', l: 'Condições ambientais de operação', dp: '70', t: 'area' },
    { k: 'BP_DP71_PeriodicStateOfCharge', g: 'uso', l: 'Estado de carga registrado', dp: '71', t: 'area' },
    { k: 'EU_4_1_DadosIndividuais', g: 'uso', l: 'Outros dados da bateria individual', t: 'area', leg: [individualLegado] }
  ];
  var SECOES = [
    { k: 'SEC_Massas', l: 'Composição mássica (massas úteis)' },
    { k: 'SEC_Rastreabilidade', l: 'Materiais, lotes e fornecedores' },
    { k: 'SEC_Imagens', l: 'Imagens de qualificação' },
    { k: 'SEC_Estrutura', l: 'Estrutura do produto (PA → PI)' }
  ];
  var POR_CHAVE = {};
  CAMPOS.forEach(function (f) { POR_CHAVE[f.k] = f; });
  var OCULTOS_PADRAO = CAMPOS.filter(function (f) { return f.oculto; }).map(function (f) { return f.k; });
  var UNIDADE_CAT = { 'Mudanças climáticas': 'kg CO₂eq', 'Acidificação': 'mol H⁺ eq', 'Eutrofização': 'kg P eq', 'Material particulado': 'incidência de doença',
    'Uso de recursos minerais e metais': 'kg Sb eq', 'Uso de água': 'm³ eq', 'Ecotoxicidade': 'CTUe', 'Toxicidade humana': 'CTUh', 'Formação de ozônio fotoquímico': 'kg NMVOC eq' };
  var OUTROS_FAMILIA = [['Agua', 'Água', 'L'], ['RecursosMinerais', 'Recursos minerais', 'kg Sb eq'], ['Acidificacao', 'Acidificação', 'mol H⁺ eq'],
    ['Eutrofizacao', 'Eutrofização', 'kg PO₄ eq'], ['MaterialParticulado', 'Material particulado', 'kg PM2,5 eq'], ['OzonioFotoquimico', 'Formação fotoquímica de ozônio', 'kg NMVOC eq'],
    ['ToxicidadeHumana', 'Toxicidade humana', 'CTUh'], ['Ecotoxicidade', 'Ecotoxicidade', 'CTUe']];

  function ocultosDe(bp) {
    if (bp && typeof bp.CamposOcultos === 'string') return setDe(bp.CamposOcultos);
    return new Set(OCULTOS_PADRAO);
  }
  function legado(bp, f) {
    var lista = f.leg || [];
    for (var i = 0; i < lista.length; i++) {
      var x = lista[i], v = typeof x === 'function' ? x(bp) : bp[x];
      if (temValor(v) && !generico(v)) return String(v).trim();
    }
    return '';
  }
  function comUnidade(f, v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || !f || !f.u) return s;
    return /^-?[\d.,]+$/.test(s) ? s + ' ' + f.u : s;
  }

  /* ---------------- massas: só as úteis entram na composição publicada ---------------- */
  var RX_SOLVENTE = /(^|[^a-z0-9])(nmp|n-metil|metilpirrolidona|pirrolidona|pyrrolidone|água|agua|water|solvente|solvent)([^a-z0-9]|$)/i;
  function ehSolvente(cod, nome, fam) {
    var m = materialDe(cod) || {};
    if (/solvent/i.test(String(m.Categoria || ''))) return true;
    if (RX_SOLVENTE.test(String(nome || '') + ' ' + String(m.DescricaoMateriais || ''))) return true;
    return A(data.op_materiais).some(function (x) {
      return x && fam.has(String(x.CodOP)) && String(x.CodigoMaterial) === String(cod) && /adi[cç][aã]o ao processo/i.test(String(x.TipoConsumo || ''));
    });
  }
  function semConversaoKg(root, fam, d) {
    var nomes = [];
    var s = null;
    try { s = typeof v4041SavedRootRow === 'function' ? v4041SavedRootRow(data.sust_op, root) : null; } catch (e) { s = null; }
    if (d && /ACV/.test(String(d.fonte || '')) && s && temValor(s.MateriaisSemFatorKg)) {
      nomes = String(s.MateriaisSemFatorKg).split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    } else if (typeof converterQtdMaterialParaKgV35 === 'function') {
      var vistos = {};
      A(data.op_materiais).forEach(function (x) {
        if (!x || !fam.has(String(x.CodOP)) || /pi intermedi/i.test(String(x.TipoConsumo || ''))) return;
        var cod = String(x.CodigoMaterial || ''), q = 0;
        if (!cod || /^PI/i.test(cod) || vistos[cod]) return;
        try { q = typeof v4034QuantityForMaterialRecord === 'function' ? v4034QuantityForMaterialRecord(x) : N(x.QtdConsumida || x.QtdPlanejada); } catch (e) { q = 0; }
        if (!(q > 0)) return;
        var kg = 0;
        try { kg = converterQtdMaterialParaKgV35(q, cod, x.UM); } catch (e) { kg = 0; }
        if (!(kg > 0)) { vistos[cod] = true; nomes.push(cod + ' ' + String(x.DescricaoMaterial || (materialDe(cod) || {}).DescricaoMateriais || '').trim() + (x.UM ? ' (' + x.UM + ')' : '')); }
      });
    }
    return nomes;
  }
  /* excluidas: Set de códigos fora da composição publicada; null = padrão (solventes) */
  function massas(codOP, excluidas) {
    var vazio = { linhas: [], util: 0, excluida: 0, total: 0, celulas: 1, utilCelula: 0, fonte: '', semConversao: [], excluidas: excluidas instanceof Set ? excluidas : new Set(), raiz: '' };
    if (!codOP || !temDados()) return vazio;
    var d = { rows: [], total: 0, fonte: '' };
    try { if (typeof v4041ProcessMassRows === 'function') d = v4041ProcessMassRows({ CodOrdemProducao: codOP }) || d; } catch (e) { if (window.console) console.warn('MES LION: massas do passaporte', e); }
    var root = rootPA(codOP), fam = familiaCods(root), rootOp = opDe(root) || opDe(codOP), n = celulasDoLote(rootOp);
    var linhas = A(d.rows).map(function (x) {
      var cod = String(x.CodigoMaterial || ''), m = materialDe(cod) || {};
      return { CodigoMaterial: cod, Material: String(x.Material || m.DescricaoMateriais || cod).trim(), Categoria: String(m.Categoria || '').trim(),
        Processos: x.Processos || '', MassaKg: N(x.MassaKg), Solvente: ehSolvente(cod, x.Material, fam) };
    }).filter(function (l) { return l.MassaKg > 0; });
    var exc = excluidas instanceof Set ? excluidas : new Set(linhas.filter(function (l) { return l.Solvente; }).map(function (l) { return l.CodigoMaterial; }));
    var util = 0, excl = 0;
    linhas.forEach(function (l) { l.Publicar = !exc.has(l.CodigoMaterial); l.MassaCelulaKg = l.MassaKg / n; if (l.Publicar) util += l.MassaKg; else excl += l.MassaKg; });
    linhas.forEach(function (l) { l.Percentual = l.Publicar && util > 0 ? l.MassaKg / util * 100 : 0; });
    linhas.sort(function (a, b) { return (b.Publicar - a.Publicar) || (b.MassaKg - a.MassaKg); });
    return { linhas: linhas, util: util, excluida: excl, total: util + excl, celulas: n, utilCelula: util / n, fonte: d.fonte || '',
      semConversao: semConversaoKg(root, fam, d), excluidas: exc, raiz: root };
  }
  window.mesBPMassas = function (bp) {
    bp = bp || {};
    return massas(bp.CodOrdemProducao, bp.MassasExcluidas != null ? setDe(bp.MassasExcluidas) : null);
  };
  function composicaoTexto(ms) {
    var grupos = {}, ordem = ['Cátodo', 'Ânodo', 'Eletrólito', 'Separador', 'Invólucro e outros'];
    ms.linhas.filter(function (l) { return l.Publicar && l.MassaKg > 0; }).forEach(function (l) {
      var c = (l.Categoria + ' ' + l.Material).toLowerCase(), g = 'Invólucro e outros';
      if (/c[aá]todo/.test(c)) g = 'Cátodo'; else if (/[aâ]nodo/.test(c)) g = 'Ânodo'; else if (/eletr[oó]lito/.test(c)) g = 'Eletrólito'; else if (/separador/.test(c)) g = 'Separador';
      (grupos[g] = grupos[g] || []).push(l.Material + ' ' + fmt(l.Percentual, 2) + ' %');
    });
    return ordem.filter(function (g) { return grupos[g]; }).map(function (g) { return g + ': ' + grupos[g].join('; '); }).join('\n');
  }

  /* ---------------- ACV do passaporte ---------------- */
  function resultadosAICV(codOP) {
    var cods = new Set([String(codOP), String(rootPA(codOP))]);
    return A(data.acv_resultados).map(function (r, i) { return { r: r, i: i }; })
      .filter(function (x) { return x.r && cods.has(String(x.r.CodOP || '')); })
      .sort(function (a, b) { return (dataNum(b.r.Data) - dataNum(a.r.Data)) || (a.i - b.i); })
      .map(function (x) { return x.r; });
  }
  var cacheFamilia = {};
  function familiaACV(root, fresco) {
    var row = null;
    if (fresco && typeof calcSustFamiliaOPV33 === 'function') {
      if (cacheFamilia[root] && Date.now() - cacheFamilia[root].t < 120000) row = cacheFamilia[root].row;
      else {
        try { row = calcSustFamiliaOPV33(root, false, {}); } catch (e) { row = null; }
        cacheFamilia[root] = { t: Date.now(), row: row };
      }
    }
    if (!row || !(row.CodOP || row.CodOPMae)) {
      try { row = typeof v4041SavedRootRow === 'function' ? v4041SavedRootRow(data.sust_op, root) : null; } catch (e) { row = null; }
    }
    return row && (row.CodOP || row.CodOPMae) && temValor(row.CO2eqTotal) ? row : null;
  }
  function fontesACV(codOP, escolha, fresco) {
    if (!codOP) return { opcoes: [], sel: null };
    var aicv = resultadosAICV(codOP), fam = familiaACV(rootPA(codOP), fresco);
    var opcoes = aicv.map(function (r) { return { id: 'AICV:' + r.IdResultado, tipo: 'AICV', r: r }; });
    if (fam) opcoes.push({ id: 'FAMILIA', tipo: 'FAMILIA', r: fam });
    var sel = escolha ? opcoes.find(function (o) { return o.id === escolha; }) || null : null;
    return { opcoes: opcoes, sel: sel || opcoes[0] || null, escolhida: !!sel };
  }
  function rotuloFonte(o) {
    if (!o) return '';
    var r = o.r;
    if (o.tipo === 'AICV') {
      var est = A(data.acv_estudos).find(function (s) { return s && s.IdEstudo === r.IdEstudo; }) || {};
      var cen = A(data.acv_cenarios).find(function (s) { return s && s.IdCenario === r.IdCenario; }) || {};
      return 'AICV ' + (r.IdResultado || '') + (est.Nome ? ' · estudo ' + est.Nome : '') + ((r.NomeCenario || cen.Nome) ? ' · cenário ' + (r.NomeCenario || cen.Nome) : '') +
        ' · OP ' + (r.CodOP || '') + (r.Data ? ' · ' + r.Data : '');
    }
    var n = String(r.OPsRelacionadas || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean).length;
    return 'ACV da família de OPs (Sustentabilidade) · OP ' + (r.CodOPMae || r.CodOP || '') + (n ? ' + ' + (n - 1) + ' OP(s) de PI' : '') + (r.DataCalculo ? ' · ' + r.DataCalculo : '');
  }
  function metricasACV(o, kwh, peso, celulasFam) {
    if (!o) return null;
    var r = o.r, total, celulas, contrib = [], outros = [], metodo, fronteira, fases, dataCalc;
    if (o.tipo === 'AICV') {
      total = N((r.Impactos || {})['Mudanças climáticas']) || N(r.GWP);
      var opR = opDe(r.CodOP) || {};
      celulas = N(r.MassaProduto) > 0 ? N(r.MassaProduto) : (N(opR.QtdProduzida) > 0 ? N(opR.QtdProduzida) : (N(opR.QtdPlanejada) > 0 ? N(opR.QtdPlanejada) : 1));
      var linhas = A(r.Linhas).filter(function (l) { return l && l.Categoria === 'Mudanças climáticas'; });
      var mat = 0, ene = 0, porMat = {};
      linhas.forEach(function (l) {
        var v = N(l.Impacto);
        if (String(l.Tipo) === 'Energia') ene += v;
        else { mat += v; var nome = String(l.Descricao || (materialDe(l.Codigo) || {}).DescricaoMateriais || l.Codigo || '').trim(); porMat[nome] = (porMat[nome] || 0) + v; }
      });
      var soma = mat + ene;
      if (soma > 0) {
        contrib.push({ nome: 'Materiais', valor: mat / celulas, pct: mat / soma * 100 });
        contrib.push({ nome: 'Energia elétrica', valor: ene / celulas, pct: ene / soma * 100 });
        Object.keys(porMat).sort(function (a, b) { return porMat[b] - porMat[a]; }).slice(0, 3).forEach(function (k) {
          if (porMat[k] > 0) contrib.push({ nome: '— ' + k, valor: porMat[k] / celulas, pct: porMat[k] / soma * 100 });
        });
      }
      Object.keys(r.Impactos || {}).forEach(function (cat) {
        var v = N(r.Impactos[cat]);
        if (cat !== 'Mudanças climáticas' && v) outros.push({ nome: cat, valor: v / celulas, unidade: (UNIDADE_CAT[cat] || 'unid.') + '/célula' });
      });
      metodo = [r.Metodo, r.BaseDados].filter(Boolean).join(' · ');
      fronteira = r.Fronteira || 'Cradle-to-gate (berço ao portão)';
      fases = 'Materiais e energia da OP ' + (r.CodOP || '') + ' (inventário do estudo ACV)';
      dataCalc = r.Data || '';
    } else {
      total = N(r.CO2eqTotal);
      celulas = celulasFam > 0 ? celulasFam : 1;
      var m1 = N(r.CO2eqProduto || r.CO2eqMateriais), p1 = N(r.CO2eqPerdas), e1 = N(r.CO2eqEnergia), s1 = m1 + p1 + e1;
      if (s1 > 0) {
        contrib.push({ nome: 'Materiais (PA + PIs)', valor: m1 / celulas, pct: m1 / s1 * 100 });
        contrib.push({ nome: 'Perdas de material', valor: p1 / celulas, pct: p1 / s1 * 100 });
        contrib.push({ nome: 'Energia elétrica', valor: e1 / celulas, pct: e1 / s1 * 100 });
      }
      OUTROS_FAMILIA.forEach(function (x) { var v = N(r[x[0]]); if (v) outros.push({ nome: x[1], valor: v / celulas, unidade: x[2] + '/célula' }); });
      metodo = (r.Metodo || 'ICV + ACV por família de OPs') + ' · fatores GWP100 do banco LCI do MES';
      fronteira = 'Cradle-to-gate (berço ao portão)';
      fases = 'Matérias-primas e materiais consumidos (PA e PIs), perdas reais de material e energia elétrica da fabricação';
      dataCalc = r.DataCalculo || '';
    }
    var porCelula = celulas > 0 ? total / celulas : null;
    return { tipo: o.tipo, id: o.id, rotulo: rotuloFonte(o), total: total, celulas: celulas, porCelula: porCelula,
      porKWh: porCelula != null && kwh > 0 ? porCelula / kwh : null, porKg: porCelula != null && peso > 0 ? porCelula / peso : null,
      contrib: contrib, outros: outros, metodo: metodo, fronteira: fronteira, fases: fases, data: dataCalc };
  }

  /* ---------------- valores puxados da OP (estrutura, massas, ACV) ---------------- */
  function valoresAutomaticos(ctx) {
    var v = {}, fontes = {};
    function put(k, val, fonte) { if (val != null && String(val).trim() !== '') { v[k] = String(val); fontes[k] = fonte; } }
    put('BP_DP06_BatteryCategory', 'Industrial', 'padrão');
    put('BP_DP67_BatteryStatus', 'original', 'padrão');
    if (ctx.fornecedorNome) put('BP_DP02_Responsible', ctx.fornecedorNome, 'fabricante do cadastro');
    var codOP = ctx.codOP || '';
    var op = opDe(codOP), root = rootPA(codOP), rootOp = opDe(root) || op;
    var prodCod = ctx.codProduto || (rootOp && (rootOp.CodigoProduto || rootOp.CodigoPA || rootOp.Produto)) || (op && (op.CodigoProduto || op.Produto)) || '';
    var prod = produtoDe(prodCod);
    var ms = massas(codOP, ctx.excluidas);
    var fe = 'estrutura ' + (prod['Código'] || prodCod);
    if (prod['Código']) {
      put('EU_A3_Modelo', prod['Célula'] || (rootOp && rootOp.IdCelula), fe);
      put('BP_FormatoCelula', prod['Modelo'], fe);
      put('BP_DP12_Chemistry', prod['Composição'] || (rootOp && rootOp.QuimicaFormula), fe);
      put('BP_DP11_Capacity', numTexto(prod['Capacidade (Ah)'] || prod['Capacidade Final (Ah)'], 2), fe);
      put('BP_CapacidadeFinalAh', numTexto(prod['Capacidade Final (Ah)'], 2), fe);
      put('BP_DP27_NominalVoltage', numTexto(prod['Tensão Nominal (V)'], 3), fe);
      put('BP_EnergiaWh', numTexto(prod['Energia (Wh)'], 2), fe);
      put('BP_Dimensoes', prod['Dimensão Case'], fe);
    } else if (rootOp) {
      put('EU_A3_Modelo', rootOp.IdCelula, 'OP ' + root);
      put('BP_DP12_Chemistry', rootOp.QuimicaFormula, 'OP ' + root);
    }
    var peso = N(prod['Peso (kg)'] || prod['Massa (kg)']), fontePeso = fe;
    if (!(peso > 0) && ms.utilCelula > 0 && !ms.semConversao.length) { peso = ms.utilCelula; fontePeso = 'massa útil calculada da OP'; }
    if (peso > 0) put('BP_DP10_Weight', fmt(peso, 4), fontePeso);
    if (ms.linhas.length) put('BP_DP45_DetailedComposition', composicaoTexto(ms), 'massas úteis da OP');
    if (rootOp) put('BP_DP09_ManufacturingDate', mesAno(rootOp), 'OP ' + root);
    var f = fontesACV(codOP, ctx.escolhaACV, ctx.fresco);
    var kwh = N(prod['Energia (Wh)']) / 1000;
    var m = metricasACV(f.sel, kwh, peso, ms.celulas);
    if (m && m.porCelula != null) {
      var fa = 'ACV · ' + (m.tipo === 'AICV' ? 'AICV ' + (f.sel.r.IdResultado || '') : 'família de OPs');
      put('BP_CO2_PorCelula', fmtSig(m.porCelula) + ' kg CO₂eq/célula', fa);
      if (m.porKWh != null) put('EU_C1_PegadaCarbono', fmtSig(m.porKWh) + ' kg CO₂eq/kWh', fa);
      if (m.porKg != null) put('BP_CO2_PorKg', fmtSig(m.porKg) + ' kg CO₂eq/kg', fa);
      put('BP_CO2_TotalOP', fmtSig(m.total) + ' kg CO₂eq (' + fmt(m.celulas, 3) + ' célula(s))', fa);
      put('EU_C2_UnidadeFuncional', '1 kWh de energia nominal da célula', 'padrão');
      put('EU_C4_Metodologia', m.metodo, fa);
      put('EU_C5_LimitesSistema', m.fronteira, fa);
      put('EU_C6_Fases', m.fases, fa);
      put('EU_C7_Contribuicao', m.contrib.map(function (c) { return c.nome + ': ' + fmtSig(c.valor) + ' kg CO₂eq/célula (' + fmt(c.pct, c.pct < 1 ? 2 : 1) + ' %)'; }).join('\n'), fa);
      put('BP_ACV_Indicadores', m.outros.map(function (x) { return x.nome + ': ' + fmtSig(x.valor) + ' ' + x.unidade; }).join('\n'), fa);
      put('BP_ACV_Fonte', m.rotulo, fa);
      put('EU_C9_AnoReferencia', v.BP_DP09_ManufacturingDate || '', 'OP ' + root);
    }
    return { valores: v, fontes: fontes, massas: ms, acv: f, metricas: m, prod: prod, op: op, root: root, rootOp: rootOp };
  }

  /* ---------------- visão do passaporte gravado (painel, relatório, tela) ---------------- */
  function visao(bp) {
    bp = bp || {};
    var unificado = bp.CamposUnificados === 'Sim';
    var exc = bp.MassasExcluidas != null ? setDe(bp.MassasExcluidas) : null;
    var auto = null;
    try {
      auto = valoresAutomaticos({ codOP: bp.CodOrdemProducao || '', codProduto: bp.CodProduto || '', fornecedorNome: bp.FornecedorNomeSnapshot || '',
        excluidas: exc, escolhaACV: bp.FonteACV || '', fresco: false });
    } catch (e) { auto = null; if (window.console) console.warn('MES LION: passaporte', e); }
    var ocultos = ocultosDe(bp);
    function valor(k) {
      var f = POR_CHAVE[k] || { k: k };
      var v = bp[k];
      if (!unificado || f.base) {
        if (!temValor(v) || generico(v)) v = legado(bp, f);
        if (!unificado && !temValor(v) && auto && auto.valores[k] != null) v = auto.valores[k];
      }
      return temValor(v) && !generico(v) ? String(v).trim() : '';
    }
    var prod = (auto && auto.prod && auto.prod['Código']) ? auto.prod : produtoDe(bp.CodProduto);
    return { bp: bp, unificado: unificado, ocultos: ocultos, valor: valor, publico: function (k) { return !ocultos.has(k); },
      massas: auto ? auto.massas : massas(bp.CodOrdemProducao, exc), auto: auto, prod: prod, op: opDe(bp.CodOrdemProducao) || {} };
  }
  window.mesBPVisao = visao;

  /* ---------------- formulário ---------------- */
  var estado = null;
  function htmlFlag(k, texto, titulo) {
    return '<label class="bpu-pub" title="' + E(titulo || 'Marcado: o dado aparece no painel do cliente') + '"><input type="checkbox" id="bpp_' + E(k) + '" data-flag="' + E(k) + '"> ' + E(texto || 'painel') + '</label>';
  }
  function htmlCampo(f) {
    var id = 'bpu_' + f.k;
    var entrada = f.t === 'area' ? '<textarea id="' + id + '" rows="2"></textarea>'
      : '<input id="' + id + '"' + (f.opcoes ? ' list="' + id + '_l"' : '') + ' autocomplete="off">' +
        (f.opcoes ? '<datalist id="' + id + '_l">' + f.opcoes.map(function (o) { return '<option value="' + E(o) + '">'; }).join('') + '</datalist>' : '');
    return '<div class="bpu-campo' + (f.t === 'area' ? ' bpu-largo' : '') + '" data-k="' + E(f.k) + '"><div class="bpu-topo"><label for="' + id + '">' + E(f.l) +
      (f.u ? ' <i>(' + E(f.u) + ')</i>' : '') + (f.dp ? ' <sup title="Data point ' + E(f.dp) + ' do Battery Passport (Guia UE 2026)">DP' + E(f.dp) + '</sup>' : '') + '</label>' +
      htmlFlag(f.k) + '</div>' + entrada + '<small class="bpu-auto" id="bpa_' + E(f.k) + '"></small></div>';
  }
  function htmlFormulario() {
    var grupos = GRUPOS.map(function (g) {
      var campos = CAMPOS.filter(function (f) { return f.g === g.id && !f.base; });
      var extra = g.id === 'composicao' ? '<div class="bpu-massas" id="bpu_massas"></div>' :
        g.id === 'carbono' ? '<div class="bpu-acv"><label for="bp_fonte_acv"><b>Fonte do cálculo ACV</b></label><select id="bp_fonte_acv"></select><small class="bpu-nota" id="bpu_acv_nota"></small></div>' : '';
      return '<details class="bpu-grupo" data-g="' + g.id + '"' + (g.aberto ? ' open' : '') + '><summary><b>' + E(g.titulo) + '</b><span class="bpu-cont" id="bpu_cont_' + g.id + '"></span></summary>' +
        '<div class="bpu-corpo">' + (g.nota ? '<p class="bpu-nota" style="margin:0 0 6px">' + E(g.nota) + '</p>' : '') + extra +
        '<div class="bpu-grupo-acoes"><button type="button" class="bpu-mini" data-marcar="' + g.id + '" data-valor="1">Marcar todos no painel</button>' +
        '<button type="button" class="bpu-mini" data-marcar="' + g.id + '" data-valor="0">Desmarcar todos</button></div>' +
        '<div class="bpu-grid">' + campos.map(htmlCampo).join('') + '</div></div></details>';
    }).join('');
    return '<div class="bpu-cab"><div><h3>Dados do passaporte</h3><p>Nenhum campo é obrigatório. Marque <b>painel</b> nos dados que devem aparecer no painel do cliente ' +
      '(campos vazios nunca aparecem). Em <b>RASCUNHO</b> o passaporte é salvo mesmo com informações incompletas e com a OP ainda aberta. ' +
      'Ao escolher a OP, os dados da estrutura da célula, a pegada de carbono (ACV) e a composição mássica são puxados sozinhos; o que for alterado à mão é mantido.</p></div>' +
      '<div><button type="button" class="bpu-mini bpu-forte" id="bpu_atualizar">⟳ Atualizar com os dados da OP</button></div></div>' +
      '<div class="bpu-origem" id="bpu_origem"></div>' +
      '<div class="bpu-secoes"><b>Seções do painel do cliente:</b>' + SECOES.filter(function (s) { return s.k !== 'SEC_Massas'; })
        .map(function (s) { return htmlFlag(s.k, s.l, 'Marcado: a seção aparece no painel do cliente'); }).join('') +
      '<span class="bpu-nota">(a composição mássica é marcada na tabela de massas, em Composição e circularidade)</span></div>' +
      grupos;
  }
  function ocultarRegraQR(form) {
    A([].slice.call(form.querySelectorAll('input[readonly]'))).forEach(function (el) {
      if (/^O QR só funciona/.test(el.value || '')) { var l = el.closest('label'); if (l) l.classList.add('bpu-oculto'); }
    });
  }
  function rotuloOP(o) {
    try { if (typeof opLabel === 'function') return opLabel(o); } catch (e) { }
    return (o.CodOP || '') + ' — ' + (o.CodigoProduto || o.Produto || '') + ' ' + (o.DescricaoProduto || '');
  }
  function opcoesDeOP(atual) {
    var sel = $('bp_op');
    if (!sel) return;
    var ops = A(data.op).filter(function (o) { return o && o.CodOP; });
    var enc = ops.filter(opFechada);
    var abertas = ops.filter(function (o) { return !opFechada(o) && String(o.TipoOP || '').toUpperCase() === 'PA' && !/cancel/i.test(String(o.Status || '')); });
    var opt = function (o) { return '<option value="' + E(o.CodOP) + '">' + E(rotuloOP(o)) + '</option>'; };
    sel.disabled = false;
    sel.innerHTML = '<option value="">Selecione a OP da bateria...</option>' +
      (enc.length ? '<optgroup label="OPs encerradas">' + enc.map(opt).join('') + '</optgroup>' : '') +
      (abertas.length ? '<optgroup label="OPs em andamento (o passaporte fica em rascunho)">' + abertas.map(opt).join('') + '</optgroup>' : '');
    if (atual && ![].slice.call(sel.options).some(function (o) { return o.value === atual; })) {
      sel.insertAdjacentHTML('beforeend', '<option value="' + E(atual) + '">' + E(atual) + ' (OP não encontrada)</option>');
    }
    sel.value = atual || '';
  }
  function flagsNosCamposBase() {
    CAMPOS.filter(function (f) { return f.base; }).forEach(function (f) {
      var el = $(f.base), lab = el && el.closest('label');
      if (!lab || (lab.parentNode && lab.parentNode.classList && lab.parentNode.classList.contains('bpu-base'))) return;
      var w = document.createElement('div');
      w.className = 'bpu-base' + (lab.classList.contains('wide') ? ' wide' : '');
      lab.parentNode.insertBefore(w, lab);
      w.appendChild(lab);
      w.insertAdjacentHTML('beforeend', htmlFlag(f.k, 'painel'));
    });
    var ren = { 'Fornecedor': 'Fornecedor / fabricante', 'Fornecedor Nome': 'Fabricante (nome / marca)', 'Fornecedor CNPJ': 'Fabricante — CNPJ' };
    A([].slice.call(document.querySelectorAll('#crudBox .form-grid label > span'))).forEach(function (s) { var t = s.textContent.trim(); if (ren[t]) s.textContent = ren[t]; });
  }
  function aplicarFlags(ocultos) {
    A([].slice.call(document.querySelectorAll('#crudBox input[data-flag]'))).forEach(function (cb) { cb.checked = !ocultos.has(cb.getAttribute('data-flag')); });
  }
  function valorInicial(bp, f) {
    var v = bp[f.k];
    if (bp.CamposUnificados !== 'Sim' && !temValor(v)) v = legado(bp, f);
    return temValor(v) && !generico(v) ? String(v) : '';
  }
  function contexto() {
    return { codOP: $('bp_op') ? $('bp_op').value : '', codProduto: $('bp_prod') ? $('bp_prod').value : '',
      fornecedorNome: $('bp_fornecedor_nome') ? $('bp_fornecedor_nome').value.trim() : '',
      excluidas: estado ? estado.excluidas : null, escolhaACV: estado ? estado.escolhaACV : '', fresco: true };
  }
  function ajustarAltura(el) {
    if (el && el.tagName === 'TEXTAREA') el.rows = Math.min(8, Math.max(2, String(el.value || '').split('\n').length + (String(el.value || '').length > 140 ? 1 : 0)));
  }
  function dica(f, el, novo, fonte) {
    ajustarAltura(el);
    var d = $('bpa_' + f.k);
    if (!d) return;
    var atual = String(el.value || '');
    d.classList.remove('bpu-dif');
    if (novo == null) { d.textContent = ''; return; }
    if (atual === novo) d.textContent = 'automático · ' + (fonte || 'OP');
    else { d.textContent = 'valor da OP: ' + novo.replace(/\n/g, ' · ').slice(0, 140) + ' (' + (fonte || 'OP') + ')'; d.classList.add('bpu-dif'); }
  }
  function contarGrupos() {
    GRUPOS.forEach(function (g) {
      var cs = CAMPOS.filter(function (f) { return f.g === g.id && !f.base; });
      var cheios = cs.filter(function (f) { var el = $('bpu_' + f.k); return el && el.value.trim(); }).length;
      var pub = cs.filter(function (f) { var el = $('bpu_' + f.k), cb = $('bpp_' + f.k); return el && el.value.trim() && cb && cb.checked; }).length;
      var s = $('bpu_cont_' + g.id);
      if (s) s.textContent = cheios + ' de ' + cs.length + ' preenchidos · ' + pub + ' no painel';
    });
  }
  function renderMassas(r) {
    var box = $('bpu_massas');
    if (!box) return;
    var ms = r ? r.massas : null;
    var cab = '<div class="bpu-massas-cab"><b>Composição mássica publicada</b>' + htmlFlag('SEC_Massas', 'mostrar no painel', 'Marcado: a composição mássica aparece no painel do cliente') + '</div>';
    if (!ms || !ms.linhas.length) {
      box.innerHTML = cab + '<p class="bpu-nota">' + (r ? 'Não há massas convertíveis em kg registradas para a OP e suas OPs de PI.' : 'Escolha a OP para ver as massas dos materiais.') + '</p>';
    } else {
      box.innerHTML = cab + '<p class="bpu-nota" style="margin:2px 0 4px">Marque os materiais que permanecem na célula. Solventes (NMP, água) evaporam no processo e ficam fora da massa publicada.</p>' +
        '<div class="table-wrap"><table class="bpu-tab"><thead><tr><th>Publicar</th><th>Material</th><th>Categoria</th><th>Massa no lote (kg)</th><th>Por célula (kg)</th><th>% da massa útil</th></tr></thead><tbody>' +
        ms.linhas.map(function (l) {
          return '<tr class="' + (l.Publicar ? '' : 'bpu-fora') + '"><td style="text-align:center"><input type="checkbox" class="bpu-massa" data-cod="' + E(l.CodigoMaterial) + '"' + (l.Publicar ? ' checked' : '') + '></td>' +
            '<td>' + E(l.CodigoMaterial) + ' — ' + E(l.Material) + (l.Solvente ? '<span class="bpu-tag">solvente</span>' : '') + '</td><td>' + E(l.Categoria) + '</td>' +
            '<td class="n">' + fmt(l.MassaKg, 4) + '</td><td class="n">' + fmt(l.MassaCelulaKg, 4) + '</td><td class="n">' + (l.Publicar ? fmt(l.Percentual, 2) + ' %' : '—') + '</td></tr>';
        }).join('') + '</tbody><tfoot><tr><td></td><td colspan="2"><b>Massa útil publicada</b></td><td class="n"><b>' + fmt(ms.util, 4) + '</b></td><td class="n"><b>' + fmt(ms.utilCelula, 4) +
        '</b></td><td class="n">100 %</td></tr><tr class="bpu-fora"><td></td><td colspan="2">Fora da composição (solventes e desmarcados)</td><td class="n">' + fmt(ms.excluida, 4) + '</td><td class="n">' +
        fmt(ms.excluida / ms.celulas, 4) + '</td><td></td></tr></tfoot></table></div>' +
        '<p class="bpu-nota">Lote de ' + fmt(ms.celulas, 3) + ' célula(s) (OP ' + E(ms.raiz) + ') · fonte das massas: ' + E(ms.fonte || 'OPs') +
        (ms.semConversao.length ? ' · <b>sem conversão para kg</b> (não entram na massa): ' + E(ms.semConversao.join('; ')) : '') + '</p>';
    }
    var cb = $('bpp_SEC_Massas');
    if (cb && estado) cb.checked = !estado.ocultos.has('SEC_Massas');
  }
  function renderOpcoesACV(r) {
    var sel = $('bp_fonte_acv'), nota = $('bpu_acv_nota');
    if (!sel) return;
    var f = r ? r.acv : { opcoes: [], sel: null };
    sel.innerHTML = '<option value="">Automático — AICV da OP, se houver; senão ACV da família de OPs</option>' +
      f.opcoes.map(function (o) { return '<option value="' + E(o.id) + '">' + E(rotuloFonte(o)) + '</option>'; }).join('');
    sel.value = estado && estado.escolhaACV && f.opcoes.some(function (o) { return o.id === estado.escolhaACV; }) ? estado.escolhaACV : '';
    if (nota) {
      var m = r && r.metricas;
      nota.innerHTML = (m ? 'Em uso: <b>' + E(m.rotulo) + '</b> — ' + E(fmtSig(m.porCelula)) + ' kg CO₂eq/célula' + (m.porKWh != null ? ' · ' + E(fmtSig(m.porKWh)) + ' kg CO₂eq/kWh' : '') + '. '
        : (r ? '<b>Nenhum cálculo de ACV para esta OP.</b> Calcule no módulo ACV (AICV) ou em Sustentabilidade. ' : '')) +
        'O AICV (módulo ACV) considera o inventário da OP escolhida no estudo; a ACV da família (Sustentabilidade) soma a OP de PA e as OPs de PI: materiais, perdas e energia.';
    }
  }
  function renderOrigem(r) {
    var o = $('bpu_origem');
    if (!o) return;
    if (!r || !r.op) { o.innerHTML = $('bp_op') && $('bp_op').value ? '<b>OP não encontrada.</b> Os dados automáticos dependem da OP.' : 'Escolha a <b>OP vinculada</b> para puxar os dados da célula, da ACV e das massas.'; return; }
    var p = r.prod || {}, m = r.metricas, ms = r.massas;
    o.innerHTML = 'Dados puxados da OP <b>' + E(r.op.CodOP) + '</b>' + (r.root && r.root !== r.op.CodOP ? ' (PA ' + E(r.root) + ')' : '') +
      ' · estrutura <b>' + E(p['Código'] || '—') + '</b>' + (p['Célula'] ? ' (' + E([p['Célula'], p['Modelo'], p['Composição']].filter(Boolean).join(', ')) + ')' : '') +
      ' · ACV: <b>' + E(m ? m.rotulo : 'sem cálculo') + '</b> · massa útil: <b>' + (ms.utilCelula > 0 ? E(fmt(ms.utilCelula, 4)) + ' kg/célula' : '—') + '</b>' +
      (opFechada(r.op) ? '' : ' · <span class="bpu-tag">OP em andamento</span>');
  }
  function preencherAutomatico(op) {
    op = op || {};
    if (!estado || !$('bp_unificado')) return [];
    var r = null;
    try { r = valoresAutomaticos(contexto()); } catch (e) { r = null; if (window.console) console.warn('MES LION: dados automáticos do passaporte', e); }
    estado.ultimo = r;
    renderMassas(r); renderOpcoesACV(r); renderOrigem(r);
    var editados = [];
    CAMPOS.forEach(function (f) {
      if (f.base) return;
      var el = $('bpu_' + f.k);
      if (!el) return;
      var novo = r && r.valores[f.k] != null ? r.valores[f.k] : null;
      var anterior = el.getAttribute('data-auto');
      if (anterior == null && estado.autoAnterior[f.k] != null) anterior = String(estado.autoAnterior[f.k]);
      var atual = el.value;
      var automatico = (atual.trim() === '' && !estado.limpos.has(f.k)) || (anterior != null && atual === anterior);
      if (op.aplicar !== false) {
        if (novo != null) {
          if (automatico || op.forcar) { el.value = novo; el.setAttribute('data-auto', novo); estado.limpos.delete(f.k); }
          else if (novo === atual) el.setAttribute('data-auto', novo);
          else { editados.push(f); if (anterior != null) el.setAttribute('data-auto', anterior); }
        } else if (anterior != null && atual === anterior && atual !== '') {
          el.value = '';                       // dado puxado de outra OP que esta OP não tem
          el.removeAttribute('data-auto');
        } else if (anterior != null) el.setAttribute('data-auto', anterior);
      } else if (anterior != null) el.setAttribute('data-auto', anterior);
      dica(f, el, novo, r && r.fontes[f.k]);
    });
    contarGrupos();
    return editados;
  }
  function montarFormulario(idx) {
    var box = $('crudBox'), form = box && box.querySelector('.form'), acoes = form && form.querySelector('.form-actions');
    if (!form || !acoes || !$('bp_id')) return;
    garantirEstilo();
    var bp = idx >= 0 ? (A(data.bp)[idx] || {}) : {};
    var autoAnterior = lerJSON(bp.CamposAutomaticos);
    estado = { idx: idx, original: bp, autoAnterior: autoAnterior, ocultos: ocultosDe(bp),
      excluidas: bp.MassasExcluidas != null ? setDe(bp.MassasExcluidas) : null, escolhaACV: bp.FonteACV || '', loteAuto: '',
      // campos que o usuário esvaziou de propósito (tinham valor automático e foram gravados vazios): continuam vazios
      limpos: new Set(bp.CamposUnificados === 'Sim' ? CAMPOS.filter(function (f) { return !f.base && bp[f.k] === '' && autoAnterior[f.k] != null; }).map(function (f) { return f.k; }) : []) };
    A([].slice.call(form.querySelectorAll('.bp-eu-reg, #bp_regulatory_fields, #bp_unificado'))).forEach(function (e) { e.remove(); });
    ocultarRegraQR(form);
    opcoesDeOP(bp.CodOrdemProducao || '');
    flagsNosCamposBase();
    var div = document.createElement('div');
    div.id = 'bp_unificado';
    div.innerHTML = htmlFormulario();
    form.insertBefore(div, acoes);
    CAMPOS.forEach(function (f) { if (f.base) return; var el = $('bpu_' + f.k); if (el) el.value = valorInicial(bp, f); });
    aplicarFlags(estado.ocultos);
    var lote = $('bp_lote');
    estado.loteAuto = lote && bp.CodOrdemProducao && lote.value === bp.CodOrdemProducao ? lote.value : '';
    var status = String(bp.StatusPassaporte || 'RASCUNHO').toUpperCase();
    // passaporte VALIDADO não muda sozinho; o do formato anterior recebe os dados que o painel dele já mostrava
    preencherAutomatico({ aplicar: idx < 0 || status.indexOf('VALID') < 0 || bp.CamposUnificados !== 'Sim' });
    aplicarFlags(estado.ocultos);
    contarGrupos();
    ligarEventos(div);
  }
  function ligarEventos(div) {
    div.addEventListener('input', function (ev) {
      var t = ev.target, k = t && t.id && t.id.indexOf('bpu_') === 0 ? t.id.slice(4) : '';
      var f = POR_CHAVE[k];
      if (f && estado && estado.ultimo) dica(f, t, estado.ultimo.valores[k] != null ? estado.ultimo.valores[k] : null, estado.ultimo.fontes[k]);
      contarGrupos();
    });
    div.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !estado) return;
      if (t.classList.contains('bpu-massa')) {
        var exc = new Set(estado.ultimo ? estado.ultimo.massas.excluidas : []);
        if (t.checked) exc.delete(t.getAttribute('data-cod')); else exc.add(t.getAttribute('data-cod'));
        estado.excluidas = exc;
        preencherAutomatico({ aplicar: true });
      } else if (t.id === 'bp_fonte_acv') {
        estado.escolhaACV = t.value || '';
        preencherAutomatico({ aplicar: true });
      } else if (t.getAttribute('data-flag')) {
        var k = t.getAttribute('data-flag');
        if (t.checked) estado.ocultos.delete(k); else estado.ocultos.add(k);
        contarGrupos();
      }
    });
    div.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!b || !estado) return;
      if (b.id === 'bpu_atualizar') { ev.preventDefault(); atualizarDaOP(); return; }
      var g = b.getAttribute('data-marcar');
      if (g) {
        ev.preventDefault();
        var on = b.getAttribute('data-valor') === '1';
        CAMPOS.filter(function (f) { return f.g === g; }).forEach(function (f) {
          var cb = $('bpp_' + f.k);
          if (!cb) return;
          cb.checked = on;
          if (on) estado.ocultos.delete(f.k); else estado.ocultos.add(f.k);
        });
        contarGrupos();
      }
    });
  }
  function atualizarDaOP() {
    if (!$('bp_op') || !$('bp_op').value) { alert('Escolha a OP vinculada para puxar os dados.'); return; }
    cacheFamilia = {};
    var editados = preencherAutomatico({ aplicar: true });
    if (editados.length && confirm('Estes campos foram alterados à mão e são diferentes dos dados da OP:\n\n• ' +
      editados.map(function (f) { return f.l; }).join('\n• ') + '\n\nSubstituir pelos dados da OP?')) preencherAutomatico({ aplicar: true, forcar: true });
  }
  window.mesBPAtualizarDaOP = atualizarDaOP;

  function coletarUnificados(o) {
    CAMPOS.forEach(function (f) { if (f.base) return; var el = $('bpu_' + f.k); if (el) o[f.k] = String(el.value || '').trim(); });
    var ocultos = [];
    A([].slice.call(document.querySelectorAll('#crudBox input[data-flag]'))).forEach(function (cb) { if (!cb.checked) ocultos.push(cb.getAttribute('data-flag')); });
    o.CamposOcultos = ocultos.join(';');
    var r = estado && estado.ultimo;
    if (r && r.massas && r.massas.linhas.length) o.MassasExcluidas = Array.from(r.massas.excluidas).join(';');
    else if (estado && estado.excluidas) o.MassasExcluidas = Array.from(estado.excluidas).join(';');
    o.FonteACV = $('bp_fonte_acv') ? $('bp_fonte_acv').value : ((estado && estado.escolhaACV) || '');
    var autos = {};
    CAMPOS.forEach(function (f) { var el = $('bpu_' + f.k); if (el && el.getAttribute('data-auto') != null) autos[f.k] = el.getAttribute('data-auto'); });
    o.CamposAutomaticos = JSON.stringify(autos);
    o.CamposUnificados = 'Sim';
    o.PassaporteCamposVersao = 'MES JSON 1.1.0';
    // leitura dos cadastros antigos
    o.BP_DP01_UniqueIdentifier = o.BatteryPassportGUID || '';
    o.BP_DP03_ManufacturerName = o.FornecedorNomeSnapshot || '';
    o.BP_DP07_ModelBatchSerial = o.IDLote || '';
    return o;
  }

  var abrirAnterior = window.openBPForm;
  if (typeof abrirAnterior === 'function') {
    window.openBPForm = function (idx) {
      var r = abrirAnterior.apply(this, arguments);
      try { montarFormulario(Number.isInteger(idx) ? idx : -1); } catch (e) { if (window.console) console.warn('MES LION: formulário do passaporte', e); }
      return r;
    };
  }
  var coletarAnterior = window.collectBP;
  if (typeof coletarAnterior === 'function') {
    window.collectBP = async function () {
      var o = await coletarAnterior.apply(this, arguments);
      if (o && estado && $('bp_unificado')) coletarUnificados(o);
      return o;
    };
  }
  /* OP vinculada: OP encerrada ou, para rascunho, OP de PA em andamento; puxa produto, lote, ACV e estrutura */
  window.bpOPChange = function () {
    var cod = $('bp_op') ? $('bp_op').value : '';
    var op = opDe(cod);
    if (op) {
      var prod = op.CodigoProduto || op.CodProduto || op.Produto || '';
      if (prod && $('bp_prod')) $('bp_prod').value = prod;
      var lote = $('bp_lote');
      if (lote && (!lote.value || (estado && lote.value === estado.loteAuto))) {
        lote.value = op.Lote || op.IDLote || op.CodOP || '';
        if (estado) estado.loteAuto = lote.value;
      }
    }
    try { if (typeof bpUpdateSnapshot === 'function') bpUpdateSnapshot(); } catch (e) { }
    if (op) {
      try { if (typeof atualizarCarbonoPassaporteV391 === 'function') atualizarCarbonoPassaporteV391(); } catch (e) { if (window.console) console.warn('MES LION: ACV da OP', e); }
      try { if (typeof atualizarCustosPassaporteV395 === 'function') atualizarCustosPassaporteV395(); } catch (e) { }
    }
    if (estado) { estado.excluidas = null; estado.escolhaACV = ''; estado.limpos = new Set(); }
    cacheFamilia = {};
    preencherAutomatico({ aplicar: true });
  };
  var empresaAnterior = window.bpEmpresaChange;
  if (typeof empresaAnterior === 'function') {
    window.bpEmpresaChange = function () {
      var r = empresaAnterior.apply(this, arguments);
      try { if (estado && $('bp_unificado')) preencherAutomatico({ aplicar: true }); } catch (e) { }
      return r;
    };
  }
  /* textos genéricos de validação (V40.4.3): só nos passaportes antigos; nos novos, campo vazio continua vazio */
  var genericosAnterior = window.v4043ApplyGenericBPFields;
  if (typeof genericosAnterior === 'function') {
    window.v4043ApplyGenericBPFields = function (bp) {
      if (bp && bp.CamposUnificados === 'Sim') return bp;
      return genericosAnterior.apply(this, arguments);
    };
  }

  /* salvar: nenhum campo obrigatório; rascunho salva incompleto (inclusive com OP aberta) */
  window.saveBP = async function (idx) {
    idx = Number.isInteger(idx) ? idx : -1;
    var status = String(($('bp_status') && $('bp_status').value) || 'RASCUNHO');
    var codOP = $('bp_op') ? $('bp_op').value : '';
    var op = opDe(codOP);
    if (status.toUpperCase() !== 'RASCUNHO') {
      var avisos = [];
      if (!codOP) avisos.push('sem OP vinculada');
      else if (!op) avisos.push('a OP ' + codOP + ' não existe mais no cadastro de OPs');
      else if (!opFechada(op)) avisos.push('a OP ' + codOP + ' ainda não está encerrada');
      if (avisos.length && !confirm('O passaporte vai ser salvo como ' + status + ' ' + avisos.join(' e ') + '.\n\nSalvar assim mesmo? (Para salvar sem esse aviso, use o status RASCUNHO.)')) return;
    }
    if (op) {
      try { if (typeof atualizarCarbonoPassaporteV391 === 'function') atualizarCarbonoPassaporteV391(); } catch (e) { }
      try { if (typeof atualizarCustosPassaporteV395 === 'function') atualizarCustosPassaporteV395(); } catch (e) { }
    }
    try {
      var anterior = idx >= 0 ? (A(data.bp)[idx] || {}) : {};
      var o = await window.collectBP();
      if (!o.CamposUnificados && estado && $('bp_unificado')) coletarUnificados(o);
      var usuario = usuarioAtual();
      o.UsuarioUltimaAlteracao = usuario;
      var novo = Object.assign({}, anterior, o);
      novo.DataCriacao = anterior.DataCriacao || o.DataCriacao || new Date().toLocaleDateString('pt-BR');
      novo.UsuarioCriacao = anterior.UsuarioCriacao || usuario;
      if (op && !temValor(novo.CustoOP_Texto)) {
        try {
          var c = typeof custosOP === 'function' ? custosOP(codOP) : {};
          var din = typeof money === 'function' ? money : function (x) { return 'R$ ' + fmt(x, 2); };
          novo.CustoOP_Texto = 'Custo projetado da OP: ' + din(c.total || op.CustoTotalProjetado || 0) + '; materiais projetados: ' + din(c.materiaisProjetado || c.materiais || op.CustoMateriaisProjetado || 0) +
            '; materiais efetivos: ' + din(c.materiaisEfetivo || op.CustoMateriaisEfetivo || 0) + '.';
        } catch (e) { }
      }
      data.bp = A(data.bp);
      if (idx >= 0) data.bp[idx] = novo; else data.bp.unshift(novo);
      saveLocal();
      alert(status.toUpperCase() === 'RASCUNHO' ? 'Passaporte da bateria salvo como rascunho.' : 'Passaporte da bateria salvo com sucesso.');
      estado = null;
      render('bp');
    } catch (err) {
      if (window.console) console.error('Erro ao salvar passaporte:', err);
      var msg = err && err.message ? err.message : String(err);
      if (/quota|storage|exceed/i.test(msg)) alert('Não foi possível salvar o passaporte porque as imagens excederam o espaço do navegador. Reduza o tamanho das imagens e tente novamente.\n\nDetalhe: ' + msg);
      else alert('Erro ao salvar o passaporte da bateria.\n\nDetalhe: ' + msg);
    }
  };

  /* ---------------- painel do cliente ---------------- */
  var CORES = ['#0b5ea8', '#39a935', '#78b82a', '#1f7a8c', '#f2a900', '#6c5ce7', '#00a8a8', '#d35400', '#7f8c8d', '#2d98da', '#8854d0', '#20bf6b', '#3867d6', '#eb3b5a'];
  var CSS_PAINEL = '.bpu-painel .bpu-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:14px 0}' +
    '.bpu-painel .bpu-kpis div{background:#f5f8fa;border:1px solid #dfe8ee;border-radius:12px;padding:11px 12px}' +
    '.bpu-painel .bpu-kpis b{display:block;color:#607786;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em}' +
    '.bpu-painel .bpu-kpis span{display:block;color:#003b70;font-size:18px;font-weight:800;margin-top:5px;overflow-wrap:anywhere}' +
    '.bpu-pizza{display:grid;grid-template-columns:170px minmax(220px,1fr);gap:18px;align-items:center}' +
    '.bpu-pizza-c{width:150px;height:150px;border-radius:50%;position:relative;margin:auto}' +
    '.bpu-pizza-c:after{content:"";position:absolute;inset:27%;background:#fff;border-radius:50%}' +
    '.bpu-pizza-c span{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1;color:#003b70;font-weight:800;font-size:14px}' +
    '.bpu-pizza-c small{font-size:9px;color:#607786;font-weight:600}' +
    '.bpu-leg div{display:grid;grid-template-columns:10px minmax(110px,1fr) 62px 86px;gap:6px;align-items:center;border-bottom:1px solid #eaf0f5;padding:4px 0;font-size:12px}' +
    '.bpu-leg i{width:9px;height:9px;border-radius:50%;display:block}.bpu-leg b{text-align:right;color:#0b4d80}.bpu-leg small{text-align:right;color:#6d7d8c}' +
    '.bpu-kv{width:100%;border-collapse:collapse}.bpu-kv th,.bpu-kv td{border:0;border-bottom:1px solid #e7edf1;padding:7px 8px;vertical-align:top;text-align:left;white-space:pre-line}' +
    '.bpu-kv th{width:36%;background:#f8fafb;color:#31566f;font-weight:700}.bpu-nota-p{font-size:11px;color:#607786;line-height:1.45;margin:6px 0}' +
    '@media(max-width:700px){.bpu-pizza{grid-template-columns:1fr}.bpu-leg div{grid-template-columns:10px 1fr 56px 74px}}';
  function pizza(linhas, total, porCelula) {
    if (!linhas.length || !(total > 0)) return '<p class="bpu-nota-p">Não há massas úteis registradas para a OP deste passaporte.</p>';
    var acc = 0;
    var stops = linhas.map(function (l, i) { var a = acc; acc += l.Percentual; return CORES[i % CORES.length] + ' ' + a + '% ' + acc + '%'; }).join(',');
    return '<div class="bpu-pizza"><div class="bpu-pizza-c" style="background:conic-gradient(' + stops + ')"><span>' + E(fmt(total, 4)) + '<small>kg' + (porCelula ? ' por célula' : '') + '</small></span></div>' +
      '<div class="bpu-leg">' + linhas.map(function (l, i) {
        return '<div><i style="background:' + CORES[i % CORES.length] + '"></i><span>' + E(l.Material) + '</span><b>' + E(fmt(l.Percentual, 2)) + '%</b><small>' + E(fmt(porCelula ? l.MassaCelulaKg : l.MassaKg, 4)) + ' kg</small></div>';
      }).join('') + '</div></div>';
  }
  function tabelaKV(rows) {
    return '<table class="bpu-kv">' + rows.map(function (r) { return '<tr><th>' + E(r[0]) + '</th><td>' + E(r[1]) + '</td></tr>'; }).join('') + '</table>';
  }
  function linhasGrupo(v, g, ignorar) {
    return CAMPOS.filter(function (f) { return f.g === g && !(ignorar && ignorar[f.k]); })
      .map(function (f) { var x = v.valor(f.k); return v.publico(f.k) && x ? [f.l, comUnidade(f, x)] : null; }).filter(Boolean);
  }
  function rastreabilidade(bp, ms) {
    var fora = ms ? ms.excluidas : new Set();
    var mats = [], linhagem = [];
    try { mats = typeof bpPublicMaterialRowsV401 === 'function' ? A(bpPublicMaterialRowsV401(bp)) : []; } catch (e) { mats = []; }
    mats = mats.filter(function (m) { return !fora.has(String(m.CodigoMaterial || '')) && !/^PI/i.test(String(m.CodigoMaterial || '')); });
    try { linhagem = typeof v403PILineageRowsForBP === 'function' ? A(v403PILineageRowsForBP(bp)) : []; } catch (e) { linhagem = []; }
    var th = typeof tableHTML === 'function' ? tableHTML : function () { return ''; };
    return { mats: mats, linhagem: linhagem, html: (mats.length ? th(mats, ['OP', 'Etapa', 'CodigoMaterial', 'Material', 'Quantidade', 'UM', 'Lote', 'Fornecedor', 'NotaFiscal']) : '<p class="bpu-nota-p">Sem materiais registrados.</p>') +
      (linhagem.length ? '<h3>Lotes de produtos intermediários</h3>' + th(linhagem, ['PI', 'Descrição', 'LotePI', 'OPOrigem', 'Quantidade', 'UM', 'DataProdução']) : '') };
  }
  function imagens(bp) {
    var lista = [['Imagem da bateria', bp.ImagemBateria], ['Teste de ciclos', bp.ImagemTesteCiclos], ['Teste de impedância', bp.ImagemImpedancia || bp.Tec_ResistenciaInterna_ImagemPath], ['Teste de aging', bp.ImagemAging]]
      .filter(function (x) { return temValor(x[1]); });
    if (!lista.length) return '';
    return '<div class="bp-img-grid">' + lista.map(function (x) {
      return typeof imageBlock === 'function' ? imageBlock(x[0], x[1]) : '<div class="bp-img-card"><b>' + E(x[0]) + '</b><img src="' + E(x[1]) + '" alt="' + E(x[0]) + '"></div>';
    }).join('') + '</div>';
  }
  function estruturaFilhos(bp) {
    return A(data.estrutura).filter(function (p) { return p && bp.CodProduto && String(p['Código Pai'] || '') === String(bp.CodProduto); });
  }
  function painelCliente(bp) {
    var v = visao(bp), mostra = function (k) { return v.publico(k) && !!v.valor(k); };
    var prod = v.prod || {}, op = v.op || {};
    var titulo = prod['Descrição'] || op.DescricaoProduto || bp.CodProduto || 'Bateria';
    var sub = [bp.CodProduto || '', mostra('IDLote') ? 'Lote ' + v.valor('IDLote') : ''].filter(Boolean).join(' · ');
    var kpis = [['BP_DP11_Capacity', 'Capacidade nominal'], ['BP_DP27_NominalVoltage', 'Tensão nominal'], ['BP_EnergiaWh', 'Energia nominal'], ['BP_DP10_Weight', 'Peso'],
      ['EU_C1_PegadaCarbono', 'Pegada de carbono'], ['BP_CO2_PorCelula', 'CO₂eq por célula'], ['BP_DP12_Chemistry', 'Química'], ['EU_A3_Modelo', 'Modelo da célula']]
      .filter(function (x) { return mostra(x[0]); });
    var h = '<div class="dash-public passport-public bpu-painel"><style>' + CSS_PAINEL + '</style>' +
      '<section class="passport-hero"><div><span class="eyebrow">DIGITAL BATTERY PASSPORT</span><h1>' + E(titulo) + '</h1><p>' + E(sub) + '</p></div>' +
      '<div class="passport-status"><span>' + E(bp.StatusPassaporte || 'RASCUNHO') + '</span><b>' + E(bp.BatteryPassportID || '') + '</b></div></section>';
    if (kpis.length) h += '<div class="bpu-kpis">' + kpis.map(function (x) { return '<div><b>' + E(x[1]) + '</b><span>' + E(comUnidade(POR_CHAVE[x[0]], v.valor(x[0]))) + '</span></div>'; }).join('') + '</div>';
    var ms = v.massas, uteis = ms.linhas.filter(function (l) { return l.Publicar; });
    if (v.publico('SEC_Massas') && uteis.length) {
      h += '<section class="passport-section"><h2>Composição mássica da célula</h2>' + pizza(uteis, ms.utilCelula, true) +
        '<p class="bpu-nota-p">Massa útil por célula: <b>' + E(fmt(ms.utilCelula, 4)) + ' kg</b>. Considera só os materiais que permanecem na célula; solventes usados no processo (ex.: NMP e água) evaporam e não fazem parte da massa final.</p></section>';
    }
    GRUPOS.forEach(function (g) {
      var rows = linhasGrupo(v, g.id);
      if (!rows.length) return;
      var titulo = g.id === 'carbono' ? 'Pegada de carbono' : g.titulo.replace(' — estrutura do produto', '');
      h += '<details open class="passport-section passport-toggle"><summary><b>' + E(titulo) + '</b><span>' + (g.id === 'carbono' ? 'ciclo de vida (ACV)' : rows.length + ' dado(s)') +
        '</span></summary><div class="passport-detail-body">' + tabelaKV(rows) + '</div></details>';
    });
    if (v.publico('SEC_Rastreabilidade')) {
      var rs = rastreabilidade(bp, ms);
      if (rs.mats.length || rs.linhagem.length) h += '<details class="passport-section passport-toggle"><summary><b>Materiais, lotes e fornecedores</b><span>rastreabilidade</span></summary><div class="passport-detail-body">' + rs.html + '</div></details>';
    }
    if (v.publico('SEC_Imagens')) {
      var im = imagens(bp);
      if (im) h += '<details class="passport-section passport-toggle"><summary><b>Qualificação da bateria e imagens</b><span>testes</span></summary><div class="passport-detail-body">' + im + '</div></details>';
    }
    if (v.publico('SEC_Estrutura')) {
      var filhos = estruturaFilhos(bp);
      if (filhos.length && typeof tableHTML === 'function') h += '<section class="passport-section"><h2>Estrutura do produto (PA → PI)</h2>' + tableHTML(filhos, ['Código', 'Descrição', 'Tipo Produto', 'Tipo PI', 'Composição', 'Modelo']) + '</section>';
    }
    return h + '</div>';
  }
  window.bpDashboardBody = function (bp) {
    try { return painelCliente(bp || {}); } catch (e) {
      if (window.console) console.warn('MES LION: painel do passaporte', e);
      return '<div class="dash-public passport-public"><p>Não foi possível montar o painel do passaporte: ' + E(e && e.message) + '</p></div>';
    }
  };

  /* ---------------- PDF interno (todos os dados, com a marca do painel) ---------------- */
  function relatorioInterno(bp) {
    var v = visao(bp), ms = v.massas, prod = v.prod || {}, op = v.op || {};
    var kpis = [['BP_DP11_Capacity', 'Capacidade'], ['BP_DP27_NominalVoltage', 'Tensão'], ['BP_EnergiaWh', 'Energia'], ['BP_DP10_Weight', 'Peso'],
      ['EU_C1_PegadaCarbono', 'CO₂eq/kWh'], ['BP_CO2_PorCelula', 'CO₂eq/célula'], ['BP_DP12_Chemistry', 'Química'], ['EU_A3_Modelo', 'Modelo']]
      .filter(function (x) { return v.valor(x[0]); }).slice(0, 8);
    var body = '<style>' + CSS_PAINEL + '.bpu-rel td.pub{text-align:center;font-weight:700}</style><div class="bpu-painel">';
    body += '<div class="kpis"><div class="kpi"><b>Produto</b><span>' + E(bp.CodProduto || '-') + '</span></div><div class="kpi"><b>OP</b><span>' + E(bp.CodOrdemProducao || '-') + '</span></div>' +
      kpis.map(function (x) { return '<div class="kpi"><b>' + E(x[1]) + '</b><span>' + E(comUnidade(POR_CHAVE[x[0]], v.valor(x[0]))) + '</span></div>'; }).join('') + '</div>';
    var vazios = [];
    GRUPOS.forEach(function (g) {
      var rows = CAMPOS.filter(function (f) { return f.g === g.id; }).map(function (f) {
        var x = v.valor(f.k);
        if (!x) { vazios.push(f.l); return ''; }
        return '<tr><td>' + E(f.dp ? 'DP' + f.dp : '') + '</td><td>' + E(f.l) + '</td><td style="white-space:pre-line">' + E(comUnidade(f, x)) + '</td><td class="pub">' + (v.publico(f.k) ? 'Sim' : 'Não') + '</td></tr>';
      }).join('');
      if (rows) body += '<section class="passport-section"><h2>' + E(g.titulo) + '</h2><table class="bpu-rel"><thead><tr><th style="width:8%">Data point</th><th style="width:30%">Dado</th><th>Valor</th><th style="width:9%">No painel</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
    });
    if (vazios.length) body += '<p class="internal-note"><b>Sem informação (' + vazios.length + '):</b> ' + E(vazios.join('; ')) + '.</p>';
    body += '<section class="passport-section"><h2>Composição mássica</h2>';
    if (ms.linhas.length) {
      body += pizza(ms.linhas.filter(function (l) { return l.Publicar; }), ms.utilCelula, true) +
        '<table><thead><tr><th>Código</th><th>Material</th><th>Categoria</th><th>Processos</th><th>Massa no lote (kg)</th><th>Por célula (kg)</th><th>% massa útil</th><th>Publicado</th></tr></thead><tbody>' +
        ms.linhas.map(function (l) {
          return '<tr><td>' + E(l.CodigoMaterial) + '</td><td>' + E(l.Material) + (l.Solvente ? ' (solvente)' : '') + '</td><td>' + E(l.Categoria) + '</td><td>' + E(l.Processos) + '</td><td>' + E(fmt(l.MassaKg, 4)) +
            '</td><td>' + E(fmt(l.MassaCelulaKg, 4)) + '</td><td>' + (l.Publicar ? E(fmt(l.Percentual, 2)) + ' %' : '—') + '</td><td>' + (l.Publicar ? 'Sim' : 'Não') + '</td></tr>';
        }).join('') + '</tbody></table><p class="internal-note">Massa útil: ' + E(fmt(ms.util, 4)) + ' kg no lote (' + E(fmt(ms.utilCelula, 4)) + ' kg por célula, ' + E(fmt(ms.celulas, 3)) +
        ' célula(s)). Fora da composição publicada: ' + E(fmt(ms.excluida, 4)) + ' kg. Fonte: ' + E(ms.fonte || 'OPs') + (ms.semConversao.length ? '. Sem conversão para kg: ' + E(ms.semConversao.join('; ')) : '') +
        '. Composição publicada no painel: ' + (v.publico('SEC_Massas') ? 'Sim' : 'Não') + '.</p>';
    } else body += '<p>Sem massas registradas para a OP.</p>';
    body += '</section>';
    var f = fontesACV(bp.CodOrdemProducao || '', bp.FonteACV || '', false);
    if (f.opcoes.length) {
      var kwh = N((v.prod || {})['Energia (Wh)']) / 1000, peso = N(v.valor('BP_DP10_Weight')) || ms.utilCelula;
      body += '<section class="passport-section"><h2>Cálculos de ACV disponíveis para a OP</h2><table><thead><tr><th>Fonte</th><th>CO₂eq total (kg)</th><th>Células</th><th>kg CO₂eq/célula</th><th>kg CO₂eq/kWh</th><th>Usado no passaporte</th></tr></thead><tbody>' +
        f.opcoes.map(function (o) {
          var m = metricasACV(o, kwh, peso, ms.celulas);
          return '<tr><td>' + E(m.rotulo) + '</td><td>' + E(fmtSig(m.total)) + '</td><td>' + E(fmt(m.celulas, 3)) + '</td><td>' + E(fmtSig(m.porCelula)) + '</td><td>' + E(m.porKWh != null ? fmtSig(m.porKWh) : '—') +
            '</td><td>' + (f.sel && f.sel.id === o.id ? 'Sim' : '') + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    }
    var rs = rastreabilidade(bp, ms);
    body += '<section class="passport-section"><h2>Materiais, lotes e fornecedores</h2>' + rs.html + '</section>';
    var im = imagens(bp);
    if (im) body += '<section class="passport-section"><h2>Qualificação e imagens</h2>' + im + '</section>';
    var filhos = estruturaFilhos(bp);
    if (filhos.length && typeof tableHTML === 'function') body += '<section class="passport-section"><h2>Estrutura do produto (PA → PI)</h2>' + tableHTML(filhos, ['Código', 'Descrição', 'Tipo Produto', 'Tipo PI', 'Composição', 'Modelo']) + '</section>';
    body += '<p class="internal-note">Relatório interno: traz todos os dados do passaporte; a coluna "No painel" indica o que aparece no painel do cliente. Descrição do produto: ' + E(prod['Descrição'] || op.DescricaoProduto || '') + '.</p></div>';
    return body;
  }
  window.reportBPObj = function (bp) {
    if (bp && typeof bp.then === 'function') return bp.then(window.reportBPObj);
    if (!bp || !bp.BatteryPassportID) return alert('Selecione ou salve um passaporte antes de gerar o PDF.');
    var body;
    try { body = relatorioInterno(bp); } catch (e) { if (window.console) console.warn('MES LION: PDF do passaporte', e); body = '<p>Não foi possível montar o relatório: ' + E(e && e.message) + '</p>'; }
    if (typeof passportPrintShell === 'function') return passportPrintShell('Passaporte da Bateria', bp, body);
    if (typeof reportShell === 'function') return reportShell('Passaporte da Bateria', body);
  };

  /* ---------------- tela interna do passaporte selecionado ---------------- */
  window.showBP = function () {
    var sel = $('bp_sel');
    var id = (sel && sel.value) || ((A(data.bp)[0] || {}).BatteryPassportID || '');
    if (sel) sel.value = id;
    var det = $('bpDet');
    if (!det) return;
    var bp = A(data.bp).find(function (b) { return b && String(b.BatteryPassportID) === String(id); });
    if (!bp) { det.innerHTML = ''; return; }
    garantirEstilo();
    var v = visao(bp), ms = v.massas, prod = v.prod || {}, op = v.op || {};
    var cheios = CAMPOS.filter(function (f) { return v.valor(f.k); });
    var publicados = cheios.filter(function (f) { return v.publico(f.k); });
    var custo = 0, co2 = 0;
    try { custo = N((v4041SavedRootRow(data.custos_op, rootPA(bp.CodOrdemProducao)) || {}).CustoTotal); } catch (e) { custo = 0; }
    var met = v.auto && v.auto.metricas;
    co2 = met ? met.total : 0;
    var classe = typeof bpStatusClass === 'function' ? bpStatusClass(bp.StatusPassaporte) : 'pill';
    det.innerHTML = '<div class="card bpu-interno"><div class="bpu-int-cab"><div><b>' + E(bp.BatteryPassportID) + '</b><span>' + E(bp.CodProduto || '') + ' · ' + E(prod['Descrição'] || op.DescricaoProduto || '') +
      (bp.CodOrdemProducao ? ' · OP ' + E(bp.CodOrdemProducao) : '') + '</span></div><span class="' + E(classe) + '">' + E(bp.StatusPassaporte || 'RASCUNHO') + '</span></div>' +
      '<div class="bpu-int-kpis">' +
      '<div><small>Massa útil por célula (publicada)</small><b>' + (ms.utilCelula > 0 ? E(fmt(ms.utilCelula, 4)) + ' kg' : 'N/D') + '</b></div>' +
      '<div><small>Massa de insumos do lote (inclui solventes)</small><b>' + (ms.total > 0 ? E(fmt(ms.total, 4)) + ' kg' : 'N/D') + '</b></div>' +
      '<div><small>CO₂eq por célula</small><b>' + E(v.valor('BP_CO2_PorCelula') || 'N/D') + '</b></div>' +
      '<div><small>CO₂eq por kWh</small><b>' + E(v.valor('EU_C1_PegadaCarbono') || 'N/D') + '</b></div>' +
      '<div><small>CO₂eq/R$ (interno)</small><b>' + (custo > 0 && co2 > 0 ? E(fmtSig(co2 / custo)) + ' kg CO₂eq/R$' : 'N/D') + '</b></div>' +
      '<div><small>R$/kg de massa útil (interno)</small><b>' + (custo > 0 && ms.util > 0 ? E(fmt(custo / ms.util, 2)) + ' R$/kg' : 'N/D') + '</b></div>' +
      '<div><small>Dados no painel do cliente</small><b>' + publicados.length + ' de ' + cheios.length + ' preenchidos</b></div></div>' +
      '<p class="bpu-nota">Fonte da ACV: ' + E(v.valor('BP_ACV_Fonte') || (met ? met.rotulo : 'sem cálculo')) + '</p>' +
      '<h3>Composição mássica publicada (massas úteis)</h3>' + pizza(ms.linhas.filter(function (l) { return l.Publicar; }), ms.utilCelula, true) +
      '<details class="v4041-pass-details"><summary>Relação de massas (úteis e fora da composição)</summary>' + (typeof tableHTML === 'function' ? tableHTML(ms.linhas.map(function (l) {
        return { Codigo: l.CodigoMaterial, Material: l.Material, Categoria: l.Categoria, Processos: l.Processos, MassaLoteKg: fmt(l.MassaKg, 4), MassaCelulaKg: fmt(l.MassaCelulaKg, 4),
          Percentual: l.Publicar ? fmt(l.Percentual, 2) + '%' : '—', Publicado: l.Publicar ? 'Sim' : 'Não (' + (l.Solvente ? 'solvente' : 'desmarcado') + ')' };
      }), ['Codigo', 'Material', 'Categoria', 'Processos', 'MassaLoteKg', 'MassaCelulaKg', 'Percentual', 'Publicado']) : '') + '</details>' +
      '<details class="v4041-pass-details"><summary>Dados fora do painel do cliente</summary><p class="bpu-nota">' +
      E(cheios.filter(function (f) { return !v.publico(f.k); }).map(function (f) { return f.l; }).join('; ') || 'Nenhum: todos os dados preenchidos aparecem no painel.') + '</p></details></div>';
  };

  /* ---------------- estilo ---------------- */
  function garantirEstilo() {
    if ($('bpu-css')) return;
    var st = document.createElement('style');
    st.id = 'bpu-css';
    st.textContent = '#bp_unificado{margin-top:14px}' +
      '#bp_unificado .bpu-cab{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;background:#eef5fa;border:1px solid #d7e4ed;border-left:4px solid #004b87;border-radius:10px;padding:10px 12px;margin-bottom:6px}' +
      '#bp_unificado .bpu-cab h3{margin:0 0 4px}#bp_unificado .bpu-cab p{margin:0;color:#4f6577;font-size:11.5px;line-height:1.45}' +
      '#bp_unificado .bpu-origem{font-size:11px;color:#36597a;margin:4px 2px 8px;line-height:1.5}' +
      '#bp_unificado .bpu-secoes{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;font-size:11px;background:#f7fafc;border:1px solid #dce6ed;border-radius:9px;padding:8px 10px;margin-bottom:8px}' +
      '#bp_unificado .bpu-grupo{border:1px solid #dce6ed;border-radius:10px;background:#fff;margin:8px 0;overflow:hidden}' +
      '#bp_unificado .bpu-grupo>summary{cursor:pointer;list-style:none;padding:9px 12px;background:#f7fafc;color:#004b87;display:flex;justify-content:space-between;gap:10px;align-items:center}' +
      '#bp_unificado .bpu-grupo>summary::-webkit-details-marker{display:none}#bp_unificado .bpu-grupo>summary b:before{content:"▸ ";display:inline-block}' +
      '#bp_unificado .bpu-grupo[open]>summary b:before{content:"▾ "}#bp_unificado .bpu-grupo>summary b{flex:1}' +
      '#bp_unificado .bpu-cont{font-size:10px;color:#6c7d89}#bp_unificado .bpu-corpo{padding:8px 12px 12px}' +
      '#bp_unificado .bpu-grupo-acoes{display:flex;gap:6px;justify-content:flex-end;margin:4px 0 6px}' +
      '#bp_unificado .bpu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px 12px}' +
      '#bp_unificado .bpu-campo{display:flex;flex-direction:column;gap:3px;min-width:0;border:1px solid #e6eef4;border-radius:8px;padding:6px 8px;background:#fcfdfe}' +
      '#bp_unificado .bpu-campo.bpu-largo{grid-column:1/-1}' +
      '#bp_unificado .bpu-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}' +
      '#bp_unificado .bpu-topo>label:first-child{font-size:11px;font-weight:700;color:#20364c;line-height:1.3}' +
      '#bp_unificado .bpu-topo i{font-style:normal;color:#5f7488;font-weight:600}#bp_unificado .bpu-topo sup{font-size:8px;color:#7a8d9c;font-weight:600;margin-left:2px}' +
      '.bpu-pub{display:inline-flex!important;flex-direction:row!important;align-items:center;gap:4px!important;font-size:10px!important;font-weight:600!important;color:#2f6b3a!important;white-space:nowrap;cursor:pointer;user-select:none}' +
      'main .bpu-pub input[type=checkbox],#bp_unificado input[type=checkbox]{width:auto!important;min-width:0!important;min-height:0!important;height:auto!important;padding:0!important;margin:0!important;accent-color:#2f8a3a}' +
      '#bp_unificado textarea{min-height:52px!important;resize:vertical}' +
      '#bp_unificado .bpu-auto{font-size:9.5px;color:#7b8d9b;line-height:1.3}#bp_unificado .bpu-auto.bpu-dif{color:#a0662a}' +
      '.bpu-base{position:relative;min-width:0;display:flex;flex-direction:column}.bpu-base>.bpu-pub{position:absolute;top:0;right:0}.bpu-base>label>span{padding-right:52px}.bpu-oculto{display:none!important}' +
      '#bp_unificado button.bpu-mini{background:#fff!important;color:#0b5ea8!important;border:1px solid #c9dbea!important;font-weight:700!important}' +
      '#bp_unificado button.bpu-forte{background:#0b5ea8!important;color:#fff!important;border-color:#0b5ea8!important;white-space:nowrap}' +
      '#bp_unificado .bpu-massas{border:1px dashed #c9dbea;border-radius:9px;padding:8px 10px;margin-bottom:8px;background:#fbfdff}' +
      '#bp_unificado .bpu-massas-cab{display:flex;justify-content:space-between;align-items:center;gap:10px;color:#004b87}' +
      '#bp_unificado .bpu-tab{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0}' +
      '#bp_unificado .bpu-tab th,#bp_unificado .bpu-tab td{border:1px solid #e1e9ef;padding:4px 6px;text-align:left}' +
      '#bp_unificado .bpu-tab th{background:#eef4f8;color:#0b4d80}#bp_unificado .bpu-tab td.n{text-align:right;font-variant-numeric:tabular-nums}' +
      '#bp_unificado .bpu-tab tr.bpu-fora td{color:#8a97a3;background:#fafafa}' +
      '.bpu-tag{display:inline-block;font-size:9px;font-weight:800;color:#8a5a00;background:#fff3d6;border-radius:4px;padding:0 4px;margin-left:4px}' +
      '#bp_unificado .bpu-acv{display:grid;grid-template-columns:minmax(200px,max-content) minmax(260px,560px);gap:4px 12px;align-items:center;margin-bottom:8px}' +
      '#bp_unificado .bpu-acv small{grid-column:1/-1}.bpu-nota{font-size:10.5px;color:#5f7488;line-height:1.45}' +
      '.bpu-interno .bpu-int-cab{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}.bpu-interno .bpu-int-cab span{display:block;color:#5f7488;font-size:11px}' +
      '.bpu-interno .bpu-int-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:8px 0}' +
      '.bpu-interno .bpu-int-kpis div{background:#f5f8fa;border:1px solid #dfe8ee;border-radius:9px;padding:8px 10px}.bpu-interno .bpu-int-kpis small{display:block;color:#607786;font-size:10px}' +
      '.bpu-interno .bpu-int-kpis b{display:block;color:#003b70;font-size:14px;margin-top:3px}' + CSS_PAINEL;
    document.head.appendChild(st);
  }
})();
