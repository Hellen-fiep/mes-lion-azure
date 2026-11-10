/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR 1.6.0: IMPORTAÇÃO DE EQUIPAMENTOS POR PLANILHA (Recursos / Máquinas)
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, depois de adaptador_relatorios.js.
   Não altera os arquivos do frontend.

   Fluxo: baixar o modelo (.xlsx com instruções, listas suspensas e linhas de EXEMPLO — em branco ou já com os
   equipamentos cadastrados) → preencher → subir (.xlsx ou CSV) → conferir linha a linha o que será criado ou
   alterado e os erros → importar (só quando não houver erro). A importação pode ser desfeita depois.

   Grava as mesmas coleções e com as mesmas regras do formulário da tela Recursos / Máquinas
   (adaptador_codigos_estoque.js, window.mesRecursosAPI):
     - data.recursos (tempo, pessoas, potência, taxas e custos) + data.cad_recursos (ativo, patrimônio, NF, valor,
       capacidade), ligadas pelo IdRecurso. Custo de energia = potência (kW) × tempo (h) × taxa de energia;
       custo MOD = tempo (h) × pessoas × taxa MOD (custosRecurso, o mesmo cálculo do formulário);
     - equipamento já cadastrado em outro processo: o que ficar em branco (nome, potência, patrimônio, NF, valor,
       fatores, capacidade, taxas e escala) vem do cadastro desse equipamento, como no formulário;
     - data.mes_capacidades + data.mes_capacidade_historico (Capacidades das máquinas), com as validações da tela.
   Atualização: só muda o que vier preenchido (célula em branco mantém o valor atual). Cada importação fica em
   data.recursos_importacoes (com os valores anteriores de cada linha) e no Histórico de Modificações.
   ===================================================================== */
(function () {
  'use strict';
  if (window.MES_ADAPTADOR_RECURSOS_IMPORTACAO) return;
  var VERSAO = '1.6.0';

  /* ---------------------------------------------------------------------
     0) UTILITÁRIOS
     --------------------------------------------------------------------- */
  function A(x) { return Array.isArray(x) ? x : []; }
  function D() { try { return typeof data !== 'undefined' ? data : window.data; } catch (e) { return window.data; } }
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function N(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof num === 'function') return num(v);
    var n = Number(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function chave(v) { return txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').replace(/²/g, '2'); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function api() { return window.mesRecursosAPI || null; }
  function xl() { return window.mesXlsx || null; }
  function est() { return window.mesEstoqueAPI || {}; }
  function usuario() { try { return (window.MES_CURRENT_USER && (MES_CURRENT_USER.username || MES_CURRENT_USER.fullName)) || 'admin'; } catch (e) { return 'admin'; } }
  function salvar() { try { if (typeof saveLocal === 'function') saveLocal(); } catch (e) { console.warn('MES LION 1.6: gravação', e); } }
  function agora() { return new Date().toLocaleString('pt-BR'); }
  function fmt(v) { var n = typeof v === 'number' ? v : NaN; return isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : txt(v); }
  /* número gravado como o formulário grava (ponto decimal) */
  function numTexto(n) { return isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : ''; }
  function codRec(r) { var a = api(); return a ? a.codigo(r) : txt(r && (r.CodEquipamento || r['Código Equipamento'])); }
  function pick(o, campos) { var r = {}; campos.forEach(function (c) { r[c] = o && o[c] != null ? o[c] : ''; }); return r; }
  function mesmo(a, b, campos) { return JSON.stringify(pick(a, campos)) === JSON.stringify(pick(b, campos)); }
  /* capacidade: números como número e textos sem espaço (o cadastro antigo pode ter "5" e o novo 5) */
  function capNorm(p) {
    p = p || {};
    return [txt(p.Codigo), txt(p.Tipo), N(p.Capacidade), txt(p.Unidade), N(p.CicloMin), N(p.SetupMin), N(p.HorasDia), N(p.Eficiencia), N(p.Simultaneas), txt(p.Observacoes)];
  }
  function capIgual(a, b) { return JSON.stringify(capNorm(a)) === JSON.stringify(capNorm(b)); }
  function igualar(alvo, origem) { Object.keys(alvo).forEach(function (k) { if (!(k in origem)) delete alvo[k]; }); Object.assign(alvo, clone(origem)); }
  /* volta só os campos que a importação grava (o que outras telas gravaram depois fica) */
  function restaurar(alvo, antes, campos) { campos.forEach(function (c) { if (antes && c in antes) alvo[c] = clone(antes[c]); else delete alvo[c]; }); }
  function novoIdImportacao() {
    var d = new Date();
    return 'IMPREC-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  /* campos que a importação grava (o resto dos registros não é tocado) */
  var REC_CAMPOS = ['CodEquipamento', 'Equipamento', 'PotenciaEquipamento (W)', 'Processo', 'SubProcesso', 'TempoOperação (min)', 'NPessoas', 'TaxaEnergia (R$/kWh)', 'TaxaMOD (R$/h)',
    'CustoEnergia', 'CustoMOD', 'Escala', 'IdCelula'];
  var CAD_CAMPOS = ['Código Equipamento', 'Equipamento', 'Processo', 'SubProcesso', 'PotenciaEquipamento (W)', 'Ativo', 'Escala', 'NumeroPatrimonio', 'NumeroNF', 'ValorEquipamento',
    'FatorDepreciacao', 'Fator dolar', 'Impostos', 'Capacidade', 'Unidade Capacidade', 'Modelo Celula'];
  var CAP_CAMPOS = ['Codigo', 'Tipo', 'Capacidade', 'Unidade', 'CicloMin', 'SetupMin', 'HorasDia', 'Eficiencia', 'Simultaneas', 'Observacoes'];

  /* ---------------------------------------------------------------------
     1) COLUNAS DO MODELO (a mesma ordem e os mesmos campos do formulário Recursos / Máquinas)
     g = grupo; t = txt | num | lista; rec / cad / cap = campo gravado; apelidos = outros nomes aceitos no cabeçalho
     --------------------------------------------------------------------- */
  var GRUPOS = [
    { id: 'id', titulo: 'Identificação', estilo: 1 },
    { id: 'custo', titulo: 'Tempos, energia e custos da operação', estilo: 6 },
    { id: 'pat', titulo: 'Patrimônio e capacidade (cadastro)', estilo: 7 },
    { id: 'cap', titulo: 'Planejamento — Capacidades das máquinas (opcional, por equipamento)', estilo: 8 },
    { id: 'ctl', titulo: 'Controle', estilo: 9 }
  ];
  var SIMNAO = ['Sim', 'Não'], TIPOS = ['Batelada', 'Contínua', 'Unidade'], UNIDADES = ['kg/batelada', 'kg/h', 'm²/h', 'células/h', 'un/h'];
  var COLS = [
    { k: 'codigo', rot: 'Código do equipamento', g: 'id', t: 'txt', larg: 13, apelidos: ['Código Equipamento', 'CodEquipamento', 'Código', 'Codigo'],
      ajuda: 'Vazio = o MES numera (próximo número livre). Código já cadastrado com o mesmo processo e subprocesso = atualiza essa linha; código já cadastrado em outro processo = acrescenta o processo ao equipamento.', ex: 'EX-01' },
    { k: 'nome', rot: 'Equipamento', g: 'id', t: 'txt', obrig: true, larg: 28, rec: 'Equipamento', cad: 'Equipamento', apelidos: ['Nome do equipamento'], ajuda: 'Nome do equipamento (obrigatório no equipamento novo).', ex: 'EXEMPLO Misturador planetário 5 L' },
    { k: 'processo', rot: 'Processo', g: 'id', t: 'lista', lista: 'processos', obrig: true, larg: 20, rec: 'Processo', cad: 'Processo', ajuda: 'Um dos processos cadastrados em Engenharia › Processos (lista suspensa).' },
    { k: 'sub', rot: 'Subprocesso', g: 'id', t: 'txt', larg: 20, rec: 'SubProcesso', cad: 'SubProcesso', apelidos: ['SubProcesso'], ajuda: 'Etapa dentro do processo (livre).', ex: 'Mistura' },
    { k: 'escala', rot: 'Escala', g: 'id', t: 'lista', lista: 'escalas', larg: 16, rec: 'Escala', cad: 'Escala', ajuda: 'Lista suspensa. Vazio no equipamento novo = Planta Piloto.', ex: 'Planta Piloto' },
    { k: 'ativo', rot: 'Ativo', g: 'id', t: 'lista', lista: 'simnao', larg: 8, cad: 'Ativo', ajuda: 'Sim ou Não. Vazio no equipamento novo = Sim.', ex: 'Sim' },
    { k: 'celula', rot: 'Célula / modelo', g: 'id', t: 'txt', larg: 14, rec: 'IdCelula', cad: 'Modelo Celula', apelidos: ['IdCelula', 'Modelo Celula', 'Célula'], ajuda: 'Linha / célula de produção ou modelo de célula (livre).', ex: '' },
    { k: 'tempo', rot: 'Tempo de operação (min)', g: 'custo', t: 'num', larg: 12, rec: 'TempoOperação (min)', apelidos: ['TempoOperação (min)', 'TempoOperacaoMin', 'Tempo (min)'], ajuda: 'Tempo padrão da operação neste processo (vai para o roteiro).', ex: 120 },
    { k: 'pessoas', rot: 'Nº de pessoas', g: 'custo', t: 'num', larg: 10, rec: 'NPessoas', apelidos: ['NPessoas', 'Pessoas'], ajuda: 'Pessoas na operação (custo de mão de obra).', ex: 1 },
    { k: 'potencia', rot: 'Potência (W)', g: 'custo', t: 'num', larg: 11, rec: 'PotenciaEquipamento (W)', cad: 'PotenciaEquipamento (W)', apelidos: ['PotenciaEquipamento (W)', 'Potência'], ajuda: 'Potência em watts (energia, custo e CO₂ de energia).', ex: 3000 },
    { k: 'te', rot: 'Taxa de energia (R$/kWh)', g: 'custo', t: 'num', larg: 12, rec: 'TaxaEnergia (R$/kWh)', apelidos: ['TaxaEnergia (R$/kWh)', 'Taxa energia (R$/kWh)'], ajuda: 'R$ por kWh.', ex: 0.82 },
    { k: 'tm', rot: 'Taxa MOD (R$/h)', g: 'custo', t: 'num', larg: 11, rec: 'TaxaMOD (R$/h)', apelidos: ['TaxaMOD (R$/h)', 'Taxa de MOD (R$/h)'], ajuda: 'R$ por hora de cada pessoa.', ex: 25 },
    { k: 'patrimonio', rot: 'Nº patrimônio', g: 'pat', t: 'txt', larg: 13, cad: 'NumeroPatrimonio', apelidos: ['NumeroPatrimonio', 'Patrimônio'], ex: 'PAT-000123' },
    { k: 'nf', rot: 'Nº NF', g: 'pat', t: 'txt', larg: 11, cad: 'NumeroNF', apelidos: ['NumeroNF'], ex: 'NF 4567' },
    { k: 'valor', rot: 'Valor do equipamento (R$)', g: 'pat', t: 'num', larg: 14, cad: 'ValorEquipamento', apelidos: ['ValorEquipamento', 'Valor do equipamento'], ex: 85000 },
    { k: 'dep', rot: 'Fator de depreciação', g: 'pat', t: 'num', larg: 12, cad: 'FatorDepreciacao', apelidos: ['FatorDepreciacao'], ex: 10 },
    { k: 'dolar', rot: 'Fator dólar', g: 'pat', t: 'num', larg: 10, cad: 'Fator dolar', apelidos: ['Fator dolar'], ex: '' },
    { k: 'impostos', rot: 'Impostos', g: 'pat', t: 'num', larg: 10, cad: 'Impostos', ex: '' },
    { k: 'capcad', rot: 'Capacidade (cadastro)', g: 'pat', t: 'txt', larg: 12, cad: 'Capacidade', apelidos: ['Capacidade'], ajuda: 'Texto livre do cadastro (ex.: 5). O planejamento usa as colunas laranja.', ex: '5' },
    { k: 'ucapcad', rot: 'Unidade da capacidade (cadastro)', g: 'pat', t: 'txt', larg: 15, cad: 'Unidade Capacidade', apelidos: ['Unidade Capacidade', 'Unidade da capacidade'], ex: 'kg/batelada' },
    { k: 'capTipo', rot: 'Operação', g: 'cap', t: 'lista', lista: 'tipos', larg: 12, cap: 'Tipo', apelidos: ['Tipo de operação'], ajuda: 'Batelada, Contínua ou Unidade.', ex: 'Batelada' },
    { k: 'capCap', rot: 'Capacidade física por ciclo/hora', g: 'cap', t: 'num', larg: 14, cap: 'Capacidade', ajuda: 'Maior que zero.', ex: 5 },
    { k: 'capUm', rot: 'Unidade da capacidade física', g: 'cap', t: 'lista', lista: 'unidades', larg: 14, cap: 'Unidade', ajuda: 'kg/batelada, kg/h, m²/h, células/h ou un/h.', ex: 'kg/batelada' },
    { k: 'capCiclo', rot: 'Tempo de ciclo (min)', g: 'cap', t: 'num', larg: 11, cap: 'CicloMin', ajuda: 'Obrigatório na batelada.', ex: 120 },
    { k: 'capSetup', rot: 'Setup padrão (min)', g: 'cap', t: 'num', larg: 11, cap: 'SetupMin', ajuda: 'Vazio = 0.', ex: 15 },
    { k: 'capHoras', rot: 'Horas programadas por dia útil', g: 'cap', t: 'num', larg: 12, cap: 'HorasDia', apelidos: ['Horas por dia útil'], ajuda: 'De 0 a 24. Vazio = 8.', ex: 8 },
    { k: 'capEf', rot: 'Eficiência planejada (%)', g: 'cap', t: 'num', larg: 11, cap: 'Eficiencia', apelidos: ['Eficiência (%)'], ajuda: 'De 1 a 100. Vazio = 100.', ex: 85 },
    { k: 'capSim', rot: 'Operações simultâneas', g: 'cap', t: 'num', larg: 11, cap: 'Simultaneas', ajuda: 'Número inteiro, 1 ou mais. Vazio = 1.', ex: 1 },
    { k: 'capObs', rot: 'Observações técnicas', g: 'cap', t: 'txt', larg: 22, cap: 'Observacoes', ex: 'Limpeza a cada troca de material' },
    { k: 'obs', rot: 'Observações da importação', g: 'ctl', t: 'txt', larg: 34, apelidos: ['Observações'], ajuda: 'Livre. Linha que começa com "EXEMPLO" é exemplo e não é importada.' },
    { k: 'id', rot: 'ID interno (não altere)', g: 'ctl', t: 'txt', larg: 20, apelidos: ['IdRecurso', 'ID interno'], ajuda: 'Preenchido no modelo com os equipamentos cadastrados. Deixe vazio na linha nova.' }
  ];
  var POR_K = {}; COLS.forEach(function (c) { POR_K[c.k] = c; });
  var OBS_EXEMPLO = 'EXEMPLO fictício — substitua pelos dados do seu equipamento ou apague esta linha (linhas de EXEMPLO não são importadas)';
  var LINHAS_MODELO = 2000;

  /* processos aceitos: os de Engenharia › Processos e os já usados em Recursos / Máquinas (a mesma lista do formulário) */
  function processos() {
    var d = D() || {}, vistos = {};
    return A(d.processos).map(function (p) { return txt(p && p.Processo); }).concat(A(d.recursos).map(function (r) { return txt(r && r.Processo); }))
      .filter(function (p) { var k = chave(p); if (!p || vistos[k]) return false; vistos[k] = 1; return true; })
      .sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }
  function escalas() {
    try { if (typeof V1014_ESCALAS !== 'undefined' && A(V1014_ESCALAS).length) return V1014_ESCALAS.slice(); } catch (e) { }
    return ['Laboratório', 'Planta Piloto', 'Semi-industrial', 'Industrial', 'Testes de Caracterização'];
  }
  function listas() { return { processos: processos(), escalas: escalas(), simnao: SIMNAO, tipos: TIPOS, unidades: UNIDADES }; }
  function daLista(v, lista) { var k = chave(v); return A(lista).find(function (x) { return chave(x) === k; }) || ''; }
  function simNao(v) {
    var k = chave(v);
    if (['sim', 's', 'yes', 'y', 'true', 'verdadeiro', '1', 'ativo'].indexOf(k) >= 0) return 'Sim';
    if (['nao', 'n', 'no', 'false', 'falso', '0', 'inativo'].indexOf(k) >= 0) return 'Não';
    return '';
  }

  /* ---------------------------------------------------------------------
     2) MODELO .XLSX (Equipamentos com exemplos ou com os cadastrados, Instruções, Listas)
     --------------------------------------------------------------------- */
  function cabecalhoLinhas() {
    var grupo = [], cab = [], cs = [], mescla = [], X = xl(), ini = 0;
    GRUPOS.forEach(function (g) {
      var cols = COLS.filter(function (c) { return c.g === g.id; });
      cols.forEach(function (c, j) { grupo.push(j === 0 ? g.titulo : ''); cab.push(c.rot + (c.obrig ? ' *' : '')); cs.push(g.estilo); });
      if (cols.length > 1) mescla.push(X.coluna(ini) + '1:' + X.coluna(ini + cols.length - 1) + '1');
      ini += cols.length;
    });
    return { grupo: { c: grupo, cs: cs }, cab: { c: cab, cs: cs.slice() }, mescla: mescla };
  }
  function validacoesModelo(L, linhasDados) {
    var X = xl(), out = [], ate = Math.max(LINHAS_MODELO, (linhasDados || 0) + 500) + 2;
    var nomes = { processos: 'ListaProcessos', escalas: 'ListaEscalas', simnao: 'ListaSimNao', tipos: 'ListaOperacao', unidades: 'ListaUnidades' };
    COLS.forEach(function (c, i) {
      if (c.t !== 'lista' || !A(L[c.lista]).length) return;
      out.push({ ref: X.coluna(i) + '3:' + X.coluna(i) + ate, nome: nomes[c.lista], titulo: c.rot, mensagem: 'Escolha um valor da lista (aba Listas).' });
    });
    return out;
  }
  function nomesListas(L) {
    var out = [], cols = [['processos', 'ListaProcessos'], ['escalas', 'ListaEscalas'], ['simnao', 'ListaSimNao'], ['tipos', 'ListaOperacao'], ['unidades', 'ListaUnidades']];
    cols.forEach(function (x, i) { var n = A(L[x[0]]).length; if (n) out.push({ nome: x[1], ref: "'Listas'!$" + xl().coluna(i) + '$2:$' + xl().coluna(i) + '$' + (n + 1) }); });
    return out;
  }
  function folhaListas(L) {
    var X = xl(), cols = [['Processos cadastrados', L.processos], ['Escala', L.escalas], ['Ativo', L.simnao], ['Operação (planejamento)', L.tipos], ['Unidade da capacidade física', L.unidades]];
    var n = Math.max.apply(null, cols.map(function (c) { return c[1].length; })), linhas = [{ c: cols.map(function (c) { return c[0]; }), s: 1 }];
    for (var i = 0; i < n; i++) linhas.push({ c: cols.map(function (c) { return c[1][i] != null ? c[1][i] : ''; }) });
    return { nome: 'Listas', xml: X.folha(linhas, { larguras: [30, 22, 10, 24, 26], congelar: 1 }) };
  }
  /* textos curtos, um por linha (sem quebra automática: o texto da coluna A continua nas colunas vazias ao lado) */
  function folhaInstrucoes(L) {
    var X = xl(), p1 = L.processos[0] || 'Mistura', linhas = [];
    var t = function (s) { linhas.push({ c: [s], s: 4 }); }, p = function (s) { linhas.push({ c: [s] }); }, br = function () { linhas.push({ c: [''] }); };
    t('MES LION — Importação de equipamentos (Recursos / Máquinas)');
    p('Preencha a aba "Equipamentos" e suba o arquivo em Engenharia › Recursos / Máquinas › "⬆ Importar planilha de equipamentos".');
    p('Antes de gravar, o MES mostra linha a linha o que será criado ou alterado, com os erros e avisos.');
    br(); t('Como preencher');
    p('1. Uma linha por equipamento e processo. O mesmo equipamento em dois processos = duas linhas com o mesmo código (veja as linhas de EXEMPLO).');
    p('2. Obrigatórios no equipamento novo: Equipamento e Processo. Use a lista suspensa de processos (aba "Listas", ex.: ' + p1 + ').');
    p('    Processo novo: cadastre antes em Engenharia › Processos e baixe o modelo de novo.');
    p('3. Código do equipamento em branco: o MES numera (próximo número livre).');
    p('    Código que já existe, com o mesmo processo e subprocesso: atualiza essa linha do cadastro.');
    p('    Código que já existe, em outro processo: acrescenta o processo ao equipamento. O que ficar em branco (nome, potência,');
    p('    patrimônio, NF, valor, fatores, capacidade, taxas e escala) vem do cadastro desse equipamento, como no formulário.');
    p('4. Na atualização, célula em branco mantém o valor atual: só muda o que for preenchido.');
    p('5. Números com vírgula ou ponto decimal e sem separador de milhar (ex.: 0,82 ou 0.82; 85000).');
    p('6. Custos calculados pelo MES, como no formulário: energia = potência (kW) × tempo (h) × taxa de energia; MOD = tempo (h) × pessoas × taxa MOD.');
    p('7. Colunas laranja (opcional): Capacidades das máquinas do planejamento, por equipamento (código).');
    p('    Se usar, informe operação, capacidade física e unidade; a batelada precisa do tempo de ciclo.');
    p('    Em branco: horas por dia = 8, eficiência = 100%, setup = 0 e operações simultâneas = 1.');
    p('    Repita os mesmos valores em todas as linhas do mesmo código ou preencha em uma só.');
    p('8. As linhas amarelas com "EXEMPLO" são fictícias e NÃO são importadas: apague-as ou substitua pelos seus dados.');
    p('9. "ID interno" vem preenchido no modelo com os equipamentos cadastrados e permite mudar o processo, o subprocesso ou o código');
    p('    de uma linha existente. Não altere; na linha nova deixe vazio.');
    p('10. O MES só importa quando não houver erro e faz uma cópia de segurança antes de gravar.');
    p('    A importação pode ser desfeita em "Importações anteriores" enquanto as linhas importadas não forem alteradas.');
    br(); t('Colunas da aba "Equipamentos"');
    linhas.push({ c: ['Coluna', 'Obrigatória', 'O que informar'], s: 1 });
    GRUPOS.forEach(function (g) {
      linhas.push({ c: [g.titulo, '', ''], s: g.estilo });
      COLS.filter(function (c) { return c.g === g.id; }).forEach(function (c) {
        linhas.push({ c: [c.rot, c.obrig ? 'Sim (equipamento novo)' : 'Não', c.ajuda || ''] });
      });
    });
    return { nome: 'Instruções', xml: X.folha(linhas, { larguras: [36, 22, 120] }) };
  }
  function valorCelula(c, v) {
    if (v === '' || v == null) return '';
    if (c.t === 'num') { var n = typeof v === 'number' ? v : (xl() ? xl().numero({ v: String(v), num: false }) : NaN); return isFinite(n) ? n : String(v); }
    return String(v);
  }
  function linhasExemplo(L) {
    var p1 = L.processos[0] || 'Mistura', p2 = L.processos[1] || p1;
    var e1 = {}, e2 = {};
    COLS.forEach(function (c) { e1[c.k] = c.ex != null ? c.ex : ''; });
    e1.processo = p1; e1.obs = OBS_EXEMPLO;
    Object.keys(e1).forEach(function (k) { e2[k] = ''; });
    e2.codigo = e1.codigo; e2.nome = e1.nome; e2.processo = p2; e2.sub = p2 === p1 ? 'Descarga' : e1.sub; e2.tempo = 90; e2.pessoas = 1; e2.ativo = 'Sim';
    e2.obs = 'EXEMPLO fictício — o mesmo equipamento em outro processo: potência, patrimônio, taxas e escala em branco vêm da linha acima (do cadastro)';
    return [e1, e2];
  }
  function linhaParaCelulas(v, estilo) { return { c: COLS.map(function (c) { return valorCelula(c, v[c.k]); }), s: estilo || 0, cs: COLS.map(function (c) { return c.k === 'id' ? 5 : (estilo || 0); }) }; }
  function valoresCadastrados() {
    var a = api(); if (a) a.sincronizar();
    var d = D() || {}, C = A(d.cad_recursos), caps = A(d.mes_capacidades);
    return A(d.recursos).filter(function (r) { return r && (codRec(r) || txt(r.Equipamento)); }).map(function (r) {
      var c = C.find(function (x) { return x && x.IdRecurso && x.IdRecurso === r.IdRecurso; }) || {}, p = caps.find(function (x) { return x && x.Codigo === codRec(r); }) || {};
      return { codigo: codRec(r), nome: r.Equipamento, processo: r.Processo, sub: r.SubProcesso, escala: r.Escala || c.Escala || '', ativo: c.Ativo || '', celula: r.IdCelula || c['Modelo Celula'] || '',
        tempo: r['TempoOperação (min)'] || r.TempoOperacaoMin || '', pessoas: r.NPessoas, potencia: r['PotenciaEquipamento (W)'] || c['PotenciaEquipamento (W)'] || '', te: r['TaxaEnergia (R$/kWh)'], tm: r['TaxaMOD (R$/h)'],
        patrimonio: c.NumeroPatrimonio, nf: c.NumeroNF, valor: c.ValorEquipamento, dep: c.FatorDepreciacao, dolar: c['Fator dolar'], impostos: c.Impostos, capcad: c.Capacidade, ucapcad: c['Unidade Capacidade'],
        capTipo: p.Tipo, capCap: p.Capacidade, capUm: p.Unidade, capCiclo: p.CicloMin, capSetup: p.SetupMin, capHoras: p.HorasDia, capEf: p.Eficiencia, capSim: p.Simultaneas, capObs: p.Observacoes,
        obs: '', id: r.IdRecurso || '' };
    }).sort(function (x, y) { return (N(x.codigo) - N(y.codigo)) || String(x.codigo).localeCompare(String(y.codigo), 'pt-BR', { numeric: true }) || String(x.processo).localeCompare(String(y.processo), 'pt-BR'); });
  }
  /* tipo: 'exemplo' (modelo em branco com 2 linhas de EXEMPLO) | 'cadastrados' (uma linha por recurso cadastrado) |
     'resultado' (as linhas lidas do arquivo + coluna com a validação) */
  function montarModelo(tipo, validacao) {
    var X = xl(); if (!X) throw new Error('Gerador de planilha indisponível nesta versão.');
    var L = listas(), h = cabecalhoLinhas(), linhas = [h.grupo, h.cab];
    var larguras = COLS.map(function (c) { return c.larg; });
    if (tipo === 'cadastrados') valoresCadastrados().forEach(function (v) { linhas.push(linhaParaCelulas(v, 0)); });
    else if (tipo === 'resultado' && validacao) {
      h.grupo.c.push('Validação do MES'); h.grupo.cs.push(9); h.cab.c.push('Resultado da validação (esta coluna é ignorada ao subir de novo)'); h.cab.cs.push(9); larguras.push(70);
      validacao.itens.forEach(function (it) {
        var v = {}; COLS.forEach(function (c) { v[c.k] = it.bruto[c.k] ? it.bruto[c.k].v : ''; });
        var estilo = it.acao === 'ERRO' ? 10 : (it.avisos.length || it.acao === 'EXEMPLO' ? 2 : 0), l = linhaParaCelulas(v, estilo);
        l.c.push([rotuloAcao(it.acao)].concat(it.erros.map(function (e) { return 'ERRO: ' + e; }), it.avisos.map(function (a) { return 'Aviso: ' + a; })).join(' | '));
        l.cs.push(estilo);
        linhas.push(l);
      });
    } else linhasExemplo(L).forEach(function (v) { linhas.push(linhaParaCelulas(v, 2)); });
    var equip = { nome: 'Equipamentos', xml: X.folha(linhas, { larguras: larguras, congelar: 2, ativa: true, mesclar: h.mescla, validacoes: validacoesModelo(L, linhas.length) }) };
    return X.gerar([equip, folhaInstrucoes(L), folhaListas(L)], nomesListas(L));
  }
  function baixar(bytes, nome) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function carimbo() { var d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()); }

  /* ---------------------------------------------------------------------
     3) LEITURA DO ARQUIVO (.xlsx ou CSV; aba "Equipamentos"; cabeçalho localizado pelos nomes das colunas)
     --------------------------------------------------------------------- */
  var CAB = {};
  COLS.forEach(function (c) { [c.rot].concat(A(c.apelidos)).forEach(function (n) { var k = chaveCab(n); if (!(k in CAB)) CAB[k] = c.k; }); });
  function chaveCab(v) { return chave(v).replace(/\*/g, '').replace(/\s+/g, ' ').trim(); }
  function mapearCabecalho(linha) {
    var mapa = {}, ignoradas = [];
    A(linha).forEach(function (c, j) {
      var h = c ? txt(c.v) : ''; if (!h) return;
      var k = CAB[chaveCab(h)];
      if (k && mapa[k] === undefined) mapa[k] = j; else if (!k) ignoradas.push(h);
    });
    return { mapa: mapa, ignoradas: ignoradas };
  }
  async function lerArquivo(file) {
    var X = xl(); if (!X) throw new Error('Leitor de planilha indisponível nesta versão.');
    var linhas = await X.ler(file, 'equipamentos'), hr = -1, m = null;
    for (var i = 0; i < Math.min(linhas.length, 15); i++) {
      var t = mapearCabecalho(linhas[i]);
      if (t.mapa.nome !== undefined && (t.mapa.processo !== undefined || t.mapa.id !== undefined)) { hr = i; m = t; break; }
    }
    if (!m) throw new Error('Não encontrei o cabeçalho com as colunas "Equipamento" e "Processo". Use o modelo baixado nesta tela (aba "Equipamentos").');
    var out = [];
    for (var r = hr + 1; r < linhas.length; r++) {
      var cel = linhas[r] || [], v = {}, vazio = true;
      COLS.forEach(function (c) {
        var j = m.mapa[c.k], x = j === undefined ? null : cel[j];
        v[c.k] = x ? { v: txt(x.v), num: !!x.num } : { v: '', num: false };
        if (v[c.k].v !== '' && c.k !== 'obs') vazio = false;   /* só observação = linha vazia (anotação) */
      });
      if (!vazio) out.push({ linha: r + 1, cel: v });
    }
    return { arquivo: file.name || 'planilha', linhas: out, cabecalho: hr + 1, ignoradas: m.ignoradas.filter(function (h) { return !/^resultado da valida/i.test(h); }) };
  }

  /* ---------------------------------------------------------------------
     4) VALIDAÇÃO (o que cada linha faz, erros que impedem a importação e avisos)
     --------------------------------------------------------------------- */
  var ROTULOS = { NOVO: 'Novo equipamento', NOVO_PROCESSO: 'Novo processo de equipamento já cadastrado', ATUALIZAR: 'Atualizar', SEM_MUDANCA: 'Sem mudança',
    NAO_ATUALIZAR: 'Já cadastrado (não atualizado)', EXEMPLO: 'Exemplo (não é importada)', ERRO: 'Com erro' };
  function rotuloAcao(a) { return ROTULOS[a] || a; }
  function aplicavel(it, atualizar) { return it.acao === 'NOVO' || it.acao === 'NOVO_PROCESSO' || (it.acao === 'ATUALIZAR' && atualizar !== false); }
  function valorAtual(c, rec, cad, perfil) {
    if (c.cap) return perfil ? perfil[c.cap] : '';
    if (c.rec) { var v = rec ? rec[c.rec] : ''; if ((v === '' || v == null) && c.cad && cad) v = cad[c.cad]; return v; }
    if (c.cad) return cad ? cad[c.cad] : '';
    return '';
  }
  /* quantos registros de roteiro, OP e programação usam o código (proc informado: só os desse processo) */
  function usosCodigo(cod, proc) {
    var d = D() || {}, c = txt(cod), n = 0;
    var conta = function (lista, f) {
      A(lista).forEach(function (x) { if (x && txt(f(x)) === c && (!proc || (x.Processo && chave(x.Processo) === chave(proc)))) n++; });
    };
    conta(d.roteiro_recursos, function (x) { return x.CodEquipamento; });
    conta(d.roteiro_etapas, function (x) { return x.CodEquipamento; });
    conta(d.op_etapas, function (x) { return x.CodEquipamento; });
    conta(d.pcp_programacao, function (x) { return x.RecursoRoteiro || x.Recurso || x.CodEquipamento; });
    return n;
  }
  function quaseIgual(a, b) { return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); }
  function listaCurta(l) { return l.length ? (l.slice(0, 12).join(', ') + (l.length > 12 ? ' e mais ' + (l.length - 12) : '')) : 'nenhum processo cadastrado'; }
  function validar(lidas, opcoes) {
    opcoes = opcoes || {};
    var a = api(), X = xl();
    if (!a || !X) throw new Error('A tela Recursos / Máquinas desta versão não foi carregada (adaptador_codigos_estoque.js).');
    a.sincronizar();
    var d = D(), R = A(d.recursos), C = A(d.cad_recursos), caps = A(d.mes_capacidades), L = listas();
    var cadDe = function (r) { return r && r.IdRecurso ? C.find(function (c) { return c && c.IdRecurso === r.IdRecurso; }) || null : null; };
    /* próximo código automático: depois de todos os números já usados no cadastro e na planilha */
    var usados = R.concat(C).map(function (r) { return N(codRec(r)); }).concat(lidas.linhas.map(function (l) { return /^\d+$/.test(l.cel.codigo.v) ? Number(l.cel.codigo.v) : 0; }));
    var proximo = Math.max.apply(null, [0].concat(usados.filter(function (n) { return isFinite(n) && n > 0; }))) + 1;
    var vistoNome = {}, alvos = [], nomesCod = {}, itens = [];
    lidas.linhas.forEach(function (l) {
      var g = function (k) { return l.cel[k] ? l.cel[k].v : ''; };
      var it = { linha: l.linha, bruto: l.cel, erros: [], avisos: [], mudancas: [], acao: '', codigo: '', automatico: false, novo: null, alvo: null, base: null, cap: null, capAntes: null };
      itens.push(it);
      if (/^exemplo/.test(chave(g('obs'))) || /^exemplo/.test(chave(g('nome')))) { it.acao = 'EXEMPLO'; return; }
      var id = g('id'), cod = g('codigo'), procBruto = g('processo'), sub = g('sub'), nome = g('nome');
      if (cod && (cod.length > 30 || /[|;\u0000-\u001F]/.test(cod))) it.erros.push('Código do equipamento: até 30 caracteres, sem "|" nem ";".');
      /* processo do cadastro */
      var proc = procBruto ? daLista(procBruto, L.processos) : '';
      /* linha existente: pelo ID interno ou por código + processo + subprocesso */
      var alvo = null;
      if (id) {
        alvo = R.find(function (r) { return r && txt(r.IdRecurso) === id; }) || null;
        if (!alvo) it.erros.push('ID interno "' + id + '" não existe mais no cadastro: apague o ID desta linha para cadastrar como novo.');
      } else if (cod) {
        alvo = R.find(function (r) { return r && codRec(r) === cod && chave(r.Processo) === chave(procBruto) && chave(r.SubProcesso) === chave(sub); }) || null;
      }
      var cadAlvo = cadDe(alvo);
      it.alvo = alvo;
      if (alvo) it.acao = 'ATUALIZAR';
      else if (cod && R.some(function (r) { return codRec(r) === cod; })) it.acao = 'NOVO_PROCESSO';
      else it.acao = 'NOVO';
      /* processo: obrigatório e do cadastro (na atualização, vazio mantém; fora do cadastro só se for o mesmo de antes) */
      if (procBruto && !proc) {
        if (alvo && chave(procBruto) === chave(alvo.Processo)) { proc = alvo.Processo; it.avisos.push('Processo "' + procBruto + '" não está em Engenharia › Processos (mantido como está).'); }
        else it.erros.push('Processo "' + procBruto + '" não está cadastrado (Engenharia › Processos). Use um da lista suspensa: ' + listaCurta(L.processos) + '.');
      }
      if (!procBruto && !alvo) it.erros.push('Informe o processo.');
      /* código final */
      if (alvo) it.codigo = cod || codRec(alvo);
      else if (cod) it.codigo = cod;
      else { it.codigo = String(proximo++); it.automatico = true; }
      /* base: o mesmo equipamento em outro processo (o que ficar em branco vem dele, como no formulário) */
      if (it.acao === 'NOVO_PROCESSO') {
        var mesmos = R.filter(function (r) { return codRec(r) === cod; });
        var b = (nome ? mesmos.find(function (r) { return chave(r.Equipamento) === chave(nome); }) : null) || mesmos[0];
        it.base = { rec: b, cad: cadDe(b) || {} };
      }
      if (!nome && !alvo && it.acao !== 'NOVO_PROCESSO') it.erros.push('Informe o nome do equipamento.');
      /* duas linhas da planilha mexendo no mesmo registro do cadastro */
      if (alvo) {
        var ja = alvos.find(function (x) { return x.alvo === alvo; });
        if (ja) it.erros.push('A linha ' + ja.linha + ' já altera este mesmo equipamento / processo do cadastro: deixe uma linha só.');
        else alvos.push({ alvo: alvo, linha: l.linha });
      }
      if (it.automatico) {
        var kn = chave(nome) + '|' + chave(proc || procBruto) + '|' + chave(sub);
        var noCad = R.find(function (r) { return chave(r.Equipamento) === chave(nome) && chave(r.Processo) === chave(proc || procBruto) && chave(r.SubProcesso) === chave(sub); });
        if (noCad) it.erros.push('Já existe "' + noCad.Equipamento + '" em ' + noCad.Processo + (noCad.SubProcesso ? ' / ' + noCad.SubProcesso : '') + ' com o código ' + codRec(noCad) +
          '. Para atualizar, informe o código ' + codRec(noCad) + ' (ou use o modelo com os equipamentos cadastrados); para um equipamento igual, informe outro código.');
        else if (vistoNome[kn]) it.erros.push('Mesmo equipamento, processo e subprocesso da linha ' + vistoNome[kn] + ': para dois equipamentos iguais, informe um código diferente em cada linha.');
        else vistoNome[kn] = l.linha;
      }
      /* valores: números, listas e textos (na atualização, valor igual ao atual = sem mudança) */
      var perfilAtual = caps.find(function (p) { return p && p.Codigo === it.codigo; }) || null;
      var v = {};
      COLS.forEach(function (c) {
        if (c.k === 'codigo' || c.k === 'id' || c.k === 'obs') return;
        var bruto = l.cel[c.k], raw = bruto ? bruto.v : '';
        if (raw === '') { v[c.k] = null; return; }
        if (alvo && !c.cap && raw === txt(valorAtual(c, alvo, cadAlvo, null))) { v[c.k] = null; return; }
        if (c.t === 'num') {
          var n = X.numero(bruto);
          if (!isFinite(n)) { it.erros.push(c.rot + ': "' + raw + '" não é um número.'); v[c.k] = null; return; }
          if (n < 0) { it.erros.push(c.rot + ' não pode ser negativo.'); v[c.k] = null; return; }
          /* mesmo número já gravado (ex.: "0,82" no cadastro e 0.82 na planilha) = sem mudança */
          if (alvo && !c.cap) { var at = X.numero({ v: txt(valorAtual(c, alvo, cadAlvo, null)), num: false }); if (isFinite(at) && quaseIgual(at, n)) { v[c.k] = null; return; } }
          v[c.k] = n; return;
        }
        if (c.t === 'lista') {
          var val = c.lista === 'simnao' ? simNao(raw) : daLista(raw, L[c.lista]);
          if (c.k === 'processo') val = proc;
          if (!val) { if (c.k !== 'processo') it.erros.push(c.rot + ': "' + raw + '" não é um valor válido (' + L[c.lista].join(', ') + ').'); v[c.k] = null; return; }
          v[c.k] = val; return;
        }
        if (raw.length > 250) { it.erros.push(c.rot + ': até 250 caracteres.'); v[c.k] = null; return; }
        v[c.k] = raw;
      });
      if (alvo && proc && chave(proc) === chave(alvo.Processo)) v.processo = null;
      it.valores = v;
      /* capacidade do planejamento (por código) */
      var temCap = COLS.some(function (c) { return c.cap && l.cel[c.k] && l.cel[c.k].v !== ''; });
      if (temCap) {
        var p = Object.assign({ Codigo: it.codigo }, pick(perfilAtual, CAP_CAMPOS.slice(1)));
        COLS.forEach(function (c) { if (c.cap && v[c.k] !== null && v[c.k] !== undefined) p[c.cap] = v[c.k]; });
        if (!perfilAtual) {
          if (p.HorasDia === '' || p.HorasDia == null) p.HorasDia = 8;
          if (p.Eficiencia === '' || p.Eficiencia == null) p.Eficiencia = 100;
          if (p.Simultaneas === '' || p.Simultaneas == null) p.Simultaneas = 1;
          if (p.SetupMin === '' || p.SetupMin == null) p.SetupMin = 0;
          if (p.CicloMin === '' || p.CicloMin == null) p.CicloMin = 0;
          if (p.Observacoes == null) p.Observacoes = '';
        }
        ['Capacidade', 'CicloMin', 'SetupMin', 'HorasDia', 'Eficiencia', 'Simultaneas'].forEach(function (f) { p[f] = p[f] === '' || p[f] == null ? 0 : N(p[f]); });
        p.Observacoes = txt(p.Observacoes); p.Tipo = txt(p.Tipo); p.Unidade = txt(p.Unidade);
        var ec = [];
        /* igual à capacidade já cadastrada (mesmo que antiga e fora das regras de hoje): sem mudança, nada a validar */
        if (perfilAtual && capIgual(p, perfilAtual)) p = null;
        if (p && !p.Tipo) ec.push('informe a operação (Batelada, Contínua ou Unidade)');
        if (p) {
          if (!(p.Capacidade > 0)) ec.push('capacidade física maior que zero');
          if (!p.Unidade) ec.push('informe a unidade da capacidade física');
          if (!(p.HorasDia > 0) || p.HorasDia > 24) ec.push('horas por dia útil entre 0 e 24');
          if (!(p.Eficiencia > 0) || p.Eficiencia > 100) ec.push('eficiência entre 1 e 100%');
          if (!Number.isInteger(p.Simultaneas) || p.Simultaneas < 1) ec.push('operações simultâneas: número inteiro, 1 ou mais');
          if (p.Tipo === 'Batelada' && !(p.CicloMin > 0)) ec.push('na batelada, informe o tempo de ciclo');
        }
        if (ec.length) it.erros.push('Capacidades das máquinas: ' + ec.join('; ') + '.');
        it.cap = p; it.capAntes = perfilAtual ? clone(perfilAtual) : null;
      }
      /* registros como ficarão (o mesmo cálculo e os mesmos espelhos do formulário) */
      it.novo = montarRegistros(it, alvo, cadAlvo);
      /* avisos */
      /* o mesmo código em equipamentos de nomes diferentes (no cadastro ou em outra linha da planilha) */
      var meuNome = chave(it.novo.rec.Equipamento), outros = R.filter(function (r) { return r !== alvo && codRec(r) === it.codigo && chave(r.Equipamento) !== meuNome; })
        .map(function (r) { return '"' + r.Equipamento + '"'; });
      var nc = nomesCod[it.codigo] = nomesCod[it.codigo] || [];
      nc.forEach(function (x) { if (chave(x.nome) !== meuNome) outros.push('"' + x.nome + '" (linha ' + x.linha + ' da planilha)'); });
      nc.push({ nome: it.novo.rec.Equipamento, linha: l.linha });
      if (outros.length) it.avisos.push('O código ' + it.codigo + ' também é do equipamento ' + outros[0] + ': equipamentos diferentes com o mesmo código se misturam na capacidade, no calendário e nos documentos.');
      if (it.acao === 'NOVO_PROCESSO' && it.base && it.base.rec) {
        var copiados = ['potencia', 'te', 'tm', 'escala', 'patrimonio', 'nf', 'valor', 'dep', 'dolar', 'impostos', 'capcad', 'ucapcad'].filter(function (k) { return v[k] == null && txt(valorAtual(POR_K[k], it.base.rec, it.base.cad, null)); });
        if (!nome) copiados.unshift('nome');
        if (copiados.length) it.avisos.push('Dados do equipamento copiados do cadastro (' + codRec(it.base.rec) + ' em ' + it.base.rec.Processo + '): ' + copiados.map(function (k) { return POR_K[k].rot; }).join(', ') + '.');
        if (v.potencia != null && txt(it.base.rec['PotenciaEquipamento (W)']) && N(it.base.rec['PotenciaEquipamento (W)']) !== v.potencia)
          it.avisos.push('Potência diferente da cadastrada para este equipamento em ' + it.base.rec.Processo + ' (' + fmt(N(it.base.rec['PotenciaEquipamento (W)'])) + ' W).');
      }
      if (alvo && cod && cod !== codRec(alvo)) {
        var u = usosCodigo(codRec(alvo), alvo.Processo);
        it.avisos.push('Troca o código ' + codRec(alvo) + ' por ' + cod + (u ? ': o código antigo aparece em ' + u + ' registro(s) de roteiro, OP ou programação, que NÃO são alterados' : '') + '. A capacidade e os documentos da máquina são guardados por código.');
      }
      if (it.acao !== 'ATUALIZAR' && !it.erros.length) {   /* na linha com erro, o aviso só atrapalha: aparece depois de corrigir */
        var falta = [];
        if (!N(it.novo.rec['PotenciaEquipamento (W)'])) falta.push('potência');
        if (!N(it.novo.rec['TempoOperação (min)'])) falta.push('tempo de operação');
        if (!N(it.novo.rec['TaxaEnergia (R$/kWh)'])) falta.push('taxa de energia');
        if (!N(it.novo.rec['TaxaMOD (R$/h)']) || !N(it.novo.rec.NPessoas)) falta.push('pessoas / taxa MOD');
        if (falta.length) it.avisos.push('Sem ' + falta.join(', ') + ': os custos (e o CO₂ da energia) desta operação ficam zero até preencher.');
      }
      /* o que muda numa linha existente (recurso com recurso, cadastro com cadastro) */
      if (alvo) {
        COLS.forEach(function (c) {
          if (!c.rec && !c.cad) return;
          var antes = c.rec ? alvo[c.rec] : (cadAlvo ? cadAlvo[c.cad] : ''), depois = c.rec ? it.novo.rec[c.rec] : it.novo.cad[c.cad];
          if (txt(antes) !== txt(depois)) it.mudancas.push({ campo: c.rot, de: txt(antes), para: txt(depois) });
        });
        if (codRec(alvo) !== it.novo.rec.CodEquipamento) it.mudancas.unshift({ campo: 'Código do equipamento', de: codRec(alvo), para: it.novo.rec.CodEquipamento });
        if (it.novo.custosMudaram) {
          if (txt(alvo.CustoEnergia) !== txt(it.novo.rec.CustoEnergia)) it.mudancas.push({ campo: 'Custo energia (calculado)', de: txt(alvo.CustoEnergia), para: it.novo.rec.CustoEnergia });
          if (txt(alvo.CustoMOD) !== txt(it.novo.rec.CustoMOD)) it.mudancas.push({ campo: 'Custo MOD (calculado)', de: txt(alvo.CustoMOD), para: it.novo.rec.CustoMOD });
        }
      }
      if (it.cap && !(it.capAntes && capIgual(it.cap, it.capAntes))) it.mudancas.push({ campo: 'Capacidades das máquinas', de: it.capAntes ? resumoCap(it.capAntes) : '(sem capacidade)', para: resumoCap(it.cap) });
      else if (it.cap) it.cap = null;
      if (it.acao === 'ATUALIZAR' && !it.mudancas.length && !it.erros.length) it.acao = 'SEM_MUDANCA';
      if (it.acao === 'ATUALIZAR' && opcoes.atualizar === false) it.acao = 'NAO_ATUALIZAR';
    });
    /* capacidade é por equipamento: linhas do mesmo código precisam concordar */
    var capCod = {};
    itens.forEach(function (it) {
      if (!it.cap || it.erros.length) return;
      var k = it.codigo;
      if (capCod[k]) { if (!capIgual(capCod[k].cap, it.cap)) it.erros.push('Capacidades das máquinas diferentes da linha ' + capCod[k].linha + ' (a capacidade é por equipamento: o mesmo código usa os mesmos valores).'); }
      else capCod[k] = it;
    });
    /* código + processo + subprocesso não podem repetir depois da importação (linhas novas e linhas que mudam essa chave) */
    var chaveFinal = function (r) { return codRec(r) + '|' + chave(r.Processo) + '|' + chave(r.SubProcesso); };
    var mudaChave = function (it) { return it.alvo && it.novo && chaveFinal(it.alvo) !== chaveFinal(it.novo.rec); };
    var finais = {};
    R.forEach(function (r) {
      if (!r || itens.some(function (it) { return it.alvo === r && mudaChave(it); })) return;
      var k = chaveFinal(r); if (!finais[k]) finais[k] = { r: r };
    });
    itens.forEach(function (it) {
      if (!it.novo || it.acao === 'EXEMPLO' || (it.alvo && !mudaChave(it))) return;
      var k = chaveFinal(it.novo.rec), f = finais[k];
      if (f && f.r) it.erros.push('Já existe no cadastro "' + f.r.Equipamento + '" com o código ' + codRec(f.r) + ' em ' + f.r.Processo + (f.r.SubProcesso ? ' / ' + f.r.SubProcesso : '') + ': mesmo código, processo e subprocesso.');
      else if (f) it.erros.push('Mesmo código, processo e subprocesso da linha ' + f.linha + '.');
      else finais[k] = { linha: it.linha };
    });
    itens.forEach(function (it) { if (it.erros.length && it.acao !== 'EXEMPLO') { it.acaoOriginal = it.acao; it.acao = 'ERRO'; } });
    /* a capacidade de cada código é gravada uma vez, na primeira linha que será importada */
    var capFeita = {};
    itens.forEach(function (it) {
      if (!it.cap || it.acao === 'ERRO') return;
      var vai = aplicavel(it, opcoes.atualizar) && !capFeita[it.codigo];
      if (vai && opcoes.atualizar === false && it.capAntes) { vai = false; it.avisos.push('As Capacidades das máquinas deste equipamento já estão cadastradas e não foram alteradas (atualização desmarcada).'); }
      if (vai) { capFeita[it.codigo] = true; return; }
      it.capRepetida = true;
      it.mudancas = it.mudancas.filter(function (m) { return m.campo !== 'Capacidades das máquinas'; });
      if (it.acao === 'ATUALIZAR' && !it.mudancas.length) it.acao = 'SEM_MUDANCA';
    });
    var resumo = { linhas: itens.length, novos: 0, novosProcessos: 0, atualizar: 0, semMudanca: 0, naoAtualizar: 0, exemplos: 0, erros: 0, avisos: 0, capacidades: 0 };
    itens.forEach(function (it) {
      if (it.acao === 'NOVO') resumo.novos++; else if (it.acao === 'NOVO_PROCESSO') resumo.novosProcessos++; else if (it.acao === 'ATUALIZAR') resumo.atualizar++;
      else if (it.acao === 'SEM_MUDANCA') resumo.semMudanca++; else if (it.acao === 'NAO_ATUALIZAR') resumo.naoAtualizar++; else if (it.acao === 'EXEMPLO') resumo.exemplos++; else if (it.acao === 'ERRO') resumo.erros++;
      if (it.avisos.length && it.acao !== 'EXEMPLO') resumo.avisos++;
      if (it.cap && !it.capRepetida && aplicavel(it, opcoes.atualizar)) resumo.capacidades++;
    });
    resumo.aplicar = resumo.novos + resumo.novosProcessos + (opcoes.atualizar === false ? 0 : resumo.atualizar);
    return { arquivo: lidas.arquivo, lidas: lidas, itens: itens, resumo: resumo, atualizar: opcoes.atualizar !== false, ignoradas: lidas.ignoradas || [] };
  }
  function resumoCap(p) {
    return [p.Tipo, fmt(N(p.Capacidade)) + ' ' + (p.Unidade || ''), (p.CicloMin ? 'ciclo ' + fmt(N(p.CicloMin)) + ' min' : ''), fmt(N(p.HorasDia)) + ' h/dia', fmt(N(p.Eficiencia)) + '%',
      (N(p.Simultaneas) > 1 ? N(p.Simultaneas) + ' simultâneas' : '')].filter(Boolean).join(' · ');
  }
  /* como o recurso e o seu espelho no cadastro ficam depois da importação desta linha */
  function montarRegistros(it, alvo, cadAlvo) {
    var a = api(), v = it.valores || {}, base = it.base;
    var rec = alvo ? clone(alvo) : { CodEquipamento: '', Equipamento: '', 'PotenciaEquipamento (W)': '', Processo: '', SubProcesso: '', 'TempoOperação (min)': '', NPessoas: '', 'TaxaEnergia (R$/kWh)': '', 'TaxaMOD (R$/h)': '', CustoEnergia: '', CustoMOD: '', Escala: '', IdCelula: '' };
    var cad = cadAlvo ? clone(cadAlvo) : { 'Código Equipamento': '', Equipamento: '', Processo: '', SubProcesso: '', 'PotenciaEquipamento (W)': '', Ativo: '', Escala: '', NumeroPatrimonio: '', NumeroNF: '', ValorEquipamento: '', FatorDepreciacao: '', Capacidade: '', 'Unidade Capacidade': '', 'Fator dolar': '', Impostos: '', 'Modelo Celula': '' };
    if (!alvo && base && base.rec) {
      rec.Equipamento = base.rec.Equipamento || ''; rec['PotenciaEquipamento (W)'] = base.rec['PotenciaEquipamento (W)'] || base.cad['PotenciaEquipamento (W)'] || '';
      rec['TaxaEnergia (R$/kWh)'] = base.rec['TaxaEnergia (R$/kWh)'] || ''; rec['TaxaMOD (R$/h)'] = base.rec['TaxaMOD (R$/h)'] || ''; rec.Escala = base.rec.Escala || base.cad.Escala || '';
      ['NumeroPatrimonio', 'NumeroNF', 'ValorEquipamento', 'FatorDepreciacao', 'Fator dolar', 'Impostos', 'Capacidade', 'Unidade Capacidade'].forEach(function (f) { cad[f] = base.cad[f] || ''; });
    }
    var antesCusto = pick(rec, ['PotenciaEquipamento (W)', 'TempoOperação (min)', 'NPessoas', 'TaxaEnergia (R$/kWh)', 'TaxaMOD (R$/h)']);
    rec.CodEquipamento = it.codigo;
    COLS.forEach(function (c) {
      var x = v[c.k]; if (x === null || x === undefined || c.cap) return;
      var s = c.t === 'num' ? numTexto(x) : String(x);
      if (c.rec) rec[c.rec] = s; else if (c.cad) cad[c.cad] = s;
    });
    if (!alvo) {
      if (!rec.Escala) rec.Escala = 'Planta Piloto';
      if (!cad.Ativo) cad.Ativo = 'Sim';
    }
    var custoMudou = !alvo || JSON.stringify(antesCusto) !== JSON.stringify(pick(rec, ['PotenciaEquipamento (W)', 'TempoOperação (min)', 'NPessoas', 'TaxaEnergia (R$/kWh)', 'TaxaMOD (R$/h)']));
    if (custoMudou) { var k = a.custos(rec); rec.CustoEnergia = k.energia; rec.CustoMOD = k.mod; }
    /* espelho no cadastro: os campos comuns acompanham o recurso (como o formulário grava) */
    var comuns = [['CodEquipamento', 'Código Equipamento'], ['Equipamento', 'Equipamento'], ['Processo', 'Processo'], ['SubProcesso', 'SubProcesso'], ['PotenciaEquipamento (W)', 'PotenciaEquipamento (W)'], ['Escala', 'Escala'], ['IdCelula', 'Modelo Celula']];
    comuns.forEach(function (p) { if (!alvo || !cadAlvo || txt(rec[p[0]]) !== txt(alvo[p[0]])) cad[p[1]] = rec[p[0]]; });
    return { rec: rec, cad: cad, custosMudaram: !!alvo && custoMudou };
  }

  /* ---------------------------------------------------------------------
     5) IMPORTAR E DESFAZER
     --------------------------------------------------------------------- */
  function registrarServidor(acao, reg) {
    try {
      return fetch('/api/recursos/importacao', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: acao, idImportacao: reg.IdImportacao, arquivo: reg.Arquivo, linhas: String(reg.Linhas), novos: String(reg.Novos + reg.NovosProcessos), atualizados: String(reg.Atualizados),
          capacidades: String(reg.Capacidades || 0), ignorados: String(A(reg.Pulados).length) }) }).catch(function (e) { console.warn('MES LION 1.6: histórico da importação', e); });
    } catch (e) { console.warn('MES LION 1.6: histórico da importação', e); }
  }
  function importar(val) {
    var a = api();
    /* valida de novo com os dados de agora (alguém pode ter mexido no cadastro desde a prévia) */
    var v2 = validar(val.lidas, { atualizar: val.atualizar });
    if (v2.resumo.erros) throw new Error('A planilha tem ' + v2.resumo.erros + ' linha(s) com erro: corrija e suba de novo.');
    if (!v2.resumo.aplicar && !v2.resumo.capacidades) throw new Error('Nada para importar: as linhas já estão iguais ao cadastro.');
    var d = D(); d.recursos = A(d.recursos); d.cad_recursos = A(d.cad_recursos); d.mes_capacidades = A(d.mes_capacidades); d.mes_capacidade_historico = A(d.mes_capacidade_historico);
    var R = d.recursos, C = d.cad_recursos, itens = [], capItens = [], idImp = novoIdImportacao(), cont = { NOVO: 0, NOVO_PROCESSO: 0, ATUALIZAR: 0 };
    /* IdRecurso único (o gerador do formulário usa a hora em ms + 2 caracteres: várias linhas no mesmo ms poderiam repetir) */
    var ids = {}; R.concat(C).forEach(function (r) { if (r && r.IdRecurso) ids[r.IdRecurso] = 1; });
    var novoId = function () { var id = a.novoId(), n = 0; while (ids[id]) id = a.novoId() + (++n).toString(36).toUpperCase(); ids[id] = 1; return id; };
    v2.itens.forEach(function (it) {
      if (!aplicavel(it, v2.atualizar)) return;
      var rec = it.alvo, cad = rec ? C.find(function (c) { return c && c.IdRecurso === rec.IdRecurso; }) : null, recAntes = rec ? clone(rec) : null, cadAntes = cad ? clone(cad) : null;
      if (rec) igualar(rec, it.novo.rec); else { rec = clone(it.novo.rec); rec.IdRecurso = novoId(); R.push(rec); }
      if (cad) igualar(cad, it.novo.cad); else { cad = clone(it.novo.cad); cad.IdRecurso = rec.IdRecurso; C.push(cad); }
      cont[it.acao]++;
      itens.push({ Linha: it.linha, Acao: it.acao, IdRecurso: rec.IdRecurso, Codigo: rec.CodEquipamento, Equipamento: rec.Equipamento, Processo: rec.Processo, SubProcesso: rec.SubProcesso,
        RecAntes: recAntes, CadAntes: cadAntes, RecDepois: pick(rec, REC_CAMPOS), CadDepois: pick(cad, CAD_CAMPOS) });
    });
    v2.itens.forEach(function (it) {
      if (!it.cap || it.capRepetida || !aplicavel(it, v2.atualizar)) return;
      var i = d.mes_capacidades.findIndex(function (x) { return x && x.Codigo === it.cap.Codigo; }), antes = i >= 0 ? clone(d.mes_capacidades[i]) : null;
      var p = Object.assign({}, it.cap, { AtualizadoEm: new Date().toISOString() });
      d.mes_capacidade_historico.push({ Codigo: p.Codigo, Anterior: antes, Novo: clone(p), Data: p.AtualizadoEm, Usuario: usuario(), Origem: 'Importação de equipamentos ' + idImp });
      if (i >= 0) d.mes_capacidades[i] = p; else d.mes_capacidades.push(p);
      capItens.push({ Codigo: p.Codigo, Antes: antes, Depois: pick(p, CAP_CAMPOS) });
    });
    var reg = { IdImportacao: idImp, Data: agora(), DataISO: new Date().toISOString(), Usuario: usuario(), Arquivo: v2.arquivo, Linhas: v2.itens.length,
      Novos: cont.NOVO, NovosProcessos: cont.NOVO_PROCESSO, Atualizados: cont.ATUALIZAR, SemMudanca: v2.resumo.semMudanca, Exemplos: v2.resumo.exemplos, Capacidades: capItens.length,
      Status: 'APLICADA', Itens: itens, CapItens: capItens };
    d.recursos_importacoes = A(d.recursos_importacoes);
    d.recursos_importacoes.unshift(reg);
    /* guarda os valores anteriores das 20 importações mais recentes (as mais antigas ficam só no histórico) */
    d.recursos_importacoes.slice(20).forEach(function (r) { if (r.Itens) { r.Itens = null; r.CapItens = null; r.SemDesfazer = true; } });
    a.sincronizar();
    salvar();
    registrarServidor('IMPORTAR', reg);
    return reg;
  }
  function desfazer(idImp) {
    var a = api(), d = D(), reg = A(d && d.recursos_importacoes).find(function (r) { return r && r.IdImportacao === idImp; });
    if (!reg) throw new Error('Importação não encontrada.');
    if (reg.Status !== 'APLICADA') throw new Error('Esta importação já foi desfeita.');
    if (!reg.Itens) throw new Error('Esta importação é antiga: os valores anteriores não foram guardados (só as 20 mais recentes podem ser desfeitas).');
    var R = A(d.recursos), C = A(d.cad_recursos), caps = d.mes_capacidades = A(d.mes_capacidades), feitos = 0, pulados = [];
    reg.Itens.slice().reverse().forEach(function (x) {
      var rec = R.find(function (r) { return r && r.IdRecurso === x.IdRecurso; }), cad = C.find(function (c) { return c && c.IdRecurso === x.IdRecurso; });
      var rot = 'Linha ' + x.Linha + ' (' + x.Codigo + ' — ' + x.Equipamento + ', ' + x.Processo + ')';
      if (!rec || !mesmo(rec, x.RecDepois, REC_CAMPOS) || (cad && !mesmo(cad, x.CadDepois, CAD_CAMPOS))) { pulados.push(rot + ': alterada depois da importação — ficou como está.'); return; }
      if (x.Acao === 'ATUALIZAR') { restaurar(rec, x.RecAntes, REC_CAMPOS); if (cad && x.CadAntes) restaurar(cad, x.CadAntes, CAD_CAMPOS); }
      else {
        /* linha criada: sai do cadastro, a não ser que já esteja em roteiro, OP ou programação */
        var outros = R.some(function (r) { return r !== rec && codRec(r) === x.Codigo; }), u = usosCodigo(x.Codigo, outros ? x.Processo : '');
        if (u) { pulados.push(rot + ': já usada em ' + u + ' registro(s) de roteiro, OP ou programação — exclua pela tela Recursos / Máquinas, se quiser.'); return; }
        R.splice(R.indexOf(rec), 1);
        if (cad) C.splice(C.indexOf(cad), 1);
      }
      feitos++;
    });
    A(reg.CapItens).forEach(function (x) {
      var i = caps.findIndex(function (p) { return p && p.Codigo === x.Codigo; });
      if (i < 0 || !capIgual(caps[i], x.Depois)) { pulados.push('Capacidade do equipamento ' + x.Codigo + ': alterada depois da importação — ficou como está.'); return; }
      var atual = clone(caps[i]);
      if (x.Antes) caps[i] = clone(x.Antes); else caps.splice(i, 1);
      d.mes_capacidade_historico = A(d.mes_capacidade_historico);
      d.mes_capacidade_historico.push({ Codigo: x.Codigo, Anterior: atual, Novo: x.Antes ? clone(x.Antes) : null, Data: new Date().toISOString(), Usuario: usuario(), Origem: 'Desfazer importação ' + reg.IdImportacao });
      feitos++;
    });
    /* nada pôde ser desfeito: a importação continua aplicada (dá para tentar de novo depois de resolver o motivo) */
    if (!feitos) return { nada: true, Status: reg.Status, Desfeitos: 0, Pulados: pulados };
    reg.Status = pulados.length ? 'DESFEITA EM PARTE' : 'DESFEITA'; reg.DesfeitaEm = agora(); reg.DesfeitaPor = usuario(); reg.Pulados = pulados; reg.Desfeitos = feitos;
    a.sincronizar();
    salvar();
    registrarServidor('DESFAZER', reg);
    return reg;
  }

  /* ---------------------------------------------------------------------
     6) TELA "Importar planilha de equipamentos"
     --------------------------------------------------------------------- */
  var ESTADO = { val: null, atualizar: true };
  function estilo() {
    try { if (est().estilo) est().estilo(); } catch (e) { }
    if (el('mri-estilo')) return;
    var st = document.createElement('style'); st.id = 'mri-estilo';
    st.textContent = [
      '.mri-passos{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin:0 0 12px}',
      '.mri-passos div{background:#f6f9fb;border:1px solid #dbe5ec;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.45}',
      '.mri-passos b{display:block;color:#004b87;margin-bottom:4px}',
      '.mri-tab{overflow:auto;max-height:60vh;border:1px solid #dbe5ec;border-radius:10px;background:#fff}',
      '.mri-tab table{border-collapse:collapse;width:100%;font-size:12px}',
      '.mri-tab th{position:sticky;top:0;background:#eaf2f9;color:#073f7a;padding:7px 8px;text-align:left;z-index:1;white-space:nowrap}',
      '.mri-tab td{padding:6px 8px;border-bottom:1px solid #edf1f5;vertical-align:top}',
      '.mri-tab td:last-child{white-space:normal;min-width:360px}',
      '.mri-tab tr.erro td{background:#fff5f6}.mri-tab tr.exemplo td{background:#fffbea;color:#6b5a1e}.mri-tab tr.igual td{color:#6b7f8c}',
      '.mri-tab ul{margin:0;padding-left:16px}.mri-tab li{margin:1px 0}',
      '.mri-erro{color:#a00e1c}.mri-aviso{color:#7a5000}.mri-muda{color:#0b4a8a}',
      '.mri-arq{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
      '.mri-arq input[type=file]{padding:8px;border:2px dashed #9db2c5;border-radius:10px;background:#f8fbfd;min-width:280px}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function setCurrent(k) { if (est().setCurrent) est().setCurrent(k); else { try { current = k; } catch (e) { } } }
  function marcar(k) { if (est().marcarNav) est().marcarNav(k); }
  function cab(t, s) { if (est().cabecalho) est().cabecalho(t, s); else { if (el('title')) el('title').textContent = t; if (el('subtitle')) el('subtitle').textContent = s; } }
  function msg(id, html, tipo) { var b = el(id); if (!b) return; b.className = 'mbc-msg ' + (tipo || 'ok'); b.innerHTML = html; }
  function tela() {
    estilo(); setCurrent('recursos_importacao'); marcar('cad_recursos');
    cab('Importar planilha de equipamentos', 'Cadastre ou atualize vários equipamentos de uma vez: baixe o modelo, preencha, suba e confira a validação linha a linha antes de importar.');
    var c = el('content'); if (!c) return;
    c.innerHTML = '<div class="toolbar"><button class="secondary" onclick="render(\'cad_recursos\')">← Recursos / Máquinas</button>' +
      '<button onclick="mesRecImpModelo(\'exemplo\')">⬇ Modelo em branco (com exemplos)</button>' +
      '<button class="secondary" onclick="mesRecImpModelo(\'cadastrados\')">⬇ Modelo com os equipamentos cadastrados</button></div>' +
      '<div class="mri-passos"><div><b>1. Baixe o modelo</b>Em branco para equipamentos novos, ou com os equipamentos já cadastrados para alterar em massa. A aba "Instruções" explica cada coluna.</div>' +
      '<div><b>2. Preencha</b>Uma linha por equipamento e processo. Equipamento e Processo são obrigatórios no novo; processo, escala e listas têm lista suspensa. Linhas de EXEMPLO são ignoradas.</div>' +
      '<div><b>3. Suba e confira</b>O MES mostra o que cada linha faz (novo, novo processo, atualizar, sem mudança) e os erros. Só importa sem erro; dá para baixar a planilha com os erros apontados.</div>' +
      '<div><b>4. Importe</b>Grava em Recursos / Máquinas (tempos, potência, taxas e custos calculados, patrimônio) e em Capacidades das máquinas, com cópia de segurança antes. Pode ser desfeita.</div></div>' +
      '<div class="mbc-card"><h3>Subir a planilha</h3><div class="mri-arq"><input type="file" id="mri_arquivo" accept=".xlsx,.csv,.txt" onchange="mesRecImpLer(this)">' +
      '<label class="mbc-inline"><input type="checkbox" id="mri_atualizar"' + (ESTADO.atualizar ? ' checked' : '') + ' onchange="mesRecImpAtualizar(this.checked)"> Atualizar os equipamentos que já existem (desmarque para só incluir novos)</label></div>' +
      '<div id="mri_msg" class="mbc-msg"></div></div><div id="mri_res"></div><div id="mri_hist"></div>';
    if (ESTADO.val) desenharResultado(ESTADO.val);
    desenharHistorico();
  }
  window.mesRecImpModelo = function (tipo, validacao) {
    try {
      var bytes = montarModelo(tipo, validacao || (tipo === 'resultado' ? ESTADO.val : null));
      var nome = tipo === 'cadastrados' ? 'MES_LION_equipamentos_cadastrados_' + carimbo() + '.xlsx' : (tipo === 'resultado' ? 'MES_LION_equipamentos_validacao_' + carimbo() + '.xlsx' : 'MES_LION_modelo_importacao_equipamentos.xlsx');
      baixar(bytes, nome);
      msg('mri_msg', 'Arquivo gerado: <b>' + esc(nome) + '</b>.', 'ok');
      return nome;
    } catch (e) { console.error(e); msg('mri_msg', 'Não foi possível gerar o modelo: ' + esc(e && e.message || e), 'erro'); }
  };
  window.mesRecImpAtualizar = function (on) {
    ESTADO.atualizar = !!on;
    if (ESTADO.val) { try { ESTADO.val = validar(ESTADO.val.lidas, { atualizar: ESTADO.atualizar }); desenharResultado(ESTADO.val); } catch (e) { msg('mri_msg', esc(e.message || e), 'erro'); } }
  };
  window.mesRecImpLer = async function (inp) {
    var f = inp && inp.files && inp.files[0]; if (!f) return;
    msg('mri_msg', 'Lendo <b>' + esc(f.name) + '</b>…', 'ok');
    try {
      var lidas = await lerArquivo(f);
      ESTADO.val = validar(lidas, { atualizar: ESTADO.atualizar });
      msg('mri_msg', 'Arquivo <b>' + esc(f.name) + '</b>: ' + lidas.linhas.length + ' linha(s) lidas a partir da linha ' + (lidas.cabecalho + 1) + '.' +
        (ESTADO.val.ignoradas.length ? ' Colunas não reconhecidas (ignoradas): ' + ESTADO.val.ignoradas.map(esc).join(', ') + '.' : ''), 'ok');
      desenharResultado(ESTADO.val);
    } catch (e) { console.error(e); ESTADO.val = null; if (el('mri_res')) el('mri_res').innerHTML = ''; msg('mri_msg', 'Não foi possível ler a planilha: ' + esc(e && e.message || e), 'erro'); }
    try { inp.value = ''; } catch (e) { }
  };
  function desenharResultado(val) {
    var b = el('mri_res'); if (!b) return;
    var r = val.resumo, pode = !r.erros && (r.aplicar > 0 || r.capacidades > 0);
    var kpi = function (rot, v, cls) { return '<div><small>' + rot + '</small><b' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</b></div>'; };
    var linhas = val.itens.map(function (it) {
      var cls = it.acao === 'ERRO' ? 'erro' : (it.acao === 'EXEMPLO' ? 'exemplo' : (it.acao === 'SEM_MUDANCA' || it.acao === 'NAO_ATUALIZAR' ? 'igual' : ''));
      var tag = { NOVO: 'ok', NOVO_PROCESSO: 'ok', ATUALIZAR: 'info', ERRO: 'erro', EXEMPLO: 'alerta' }[it.acao] || '';
      var nome = it.novo ? it.novo.rec.Equipamento : (it.bruto.nome ? it.bruto.nome.v : ''), proc = it.novo ? it.novo.rec.Processo : (it.bruto.processo ? it.bruto.processo.v : ''), sub = it.novo ? it.novo.rec.SubProcesso : (it.bruto.sub ? it.bruto.sub.v : '');
      var notas = it.erros.map(function (e) { return '<li class="mri-erro">' + esc(e) + '</li>'; }).concat(it.avisos.map(function (a) { return '<li class="mri-aviso">' + esc(a) + '</li>'; }),
        it.mudancas.map(function (m) { return '<li class="mri-muda">' + esc(m.campo) + ': ' + esc(m.de === '' ? '(vazio)' : m.de) + ' → ' + esc(m.para === '' ? '(vazio)' : m.para) + '</li>'; }));
      return '<tr class="' + cls + '"><td class="mbc-num">' + it.linha + '</td><td><span class="mbc-tag ' + tag + '">' + esc(rotuloAcao(it.acao)) + '</span>' +
        (it.acao === 'ERRO' && it.acaoOriginal ? '<br><small class="muted">' + esc(rotuloAcao(it.acaoOriginal)) + '</small>' : '') + '</td>' +
        '<td>' + esc(it.codigo || (it.bruto.codigo ? it.bruto.codigo.v : '')) + (it.automatico ? ' <span class="muted">(automático)</span>' : '') + '</td><td>' + esc(nome) + '</td><td>' + esc(proc) + '</td><td>' + esc(sub) + '</td>' +
        '<td>' + (notas.length ? '<ul>' + notas.join('') + '</ul>' : (it.acao === 'NOVO' || it.acao === 'NOVO_PROCESSO' ? '<span class="muted">tudo certo</span>' : '')) + '</td></tr>';
    }).join('');
    b.innerHTML = '<div class="mbc-kpis">' + kpi('Linhas lidas', r.linhas) + kpi('Equipamentos novos', r.novos) + kpi('Novos processos de equipamentos existentes', r.novosProcessos) +
      kpi('Atualizações', r.atualizar) + kpi('Sem mudança', r.semMudanca + r.naoAtualizar) + kpi('Capacidades (planejamento)', r.capacidades) + kpi('Exemplos ignorados', r.exemplos) +
      kpi('Linhas com erro', r.erros, r.erros ? 'mri-erro' : '') + kpi('Linhas com aviso', r.avisos, r.avisos ? 'mri-aviso' : '') + '</div>' +
      '<div class="toolbar"><button id="mri_importar" onclick="mesRecImpImportar(this)"' + (pode ? '' : ' disabled') + '>' + (pode ? '⬆ Importar ' + r.aplicar + ' linha(s)' + (r.capacidades ? ' e ' + r.capacidades + ' capacidade(s)' : '') : (r.erros ? 'Corrija os erros para importar' : 'Nada para importar')) + '</button>' +
      ((r.erros || r.avisos) ? '<button class="secondary" onclick="mesRecImpModelo(\'resultado\')">⬇ Planilha com os erros e avisos apontados</button>' : '') +
      '<button class="secondary" onclick="mesRecImpLimpar()">Limpar</button></div>' +
      '<div class="mri-tab"><table><thead><tr><th>Linha</th><th>O que faz</th><th>Código</th><th>Equipamento</th><th>Processo</th><th>Subprocesso</th><th>Erros, avisos e o que muda</th></tr></thead><tbody>' +
      (linhas || '<tr><td colspan="7" class="muted">Nenhuma linha preenchida na planilha.</td></tr>') + '</tbody></table></div>';
  }
  window.mesRecImpLimpar = function () { ESTADO.val = null; if (el('mri_res')) el('mri_res').innerHTML = ''; msg('mri_msg', '', 'ok'); };
  window.mesRecImpImportar = function (btn) {
    var val = ESTADO.val; if (!val) return;
    var r = val.resumo;
    if (!confirm('Importar a planilha "' + val.arquivo + '"?\n\n' + r.novos + ' equipamento(s) novo(s), ' + r.novosProcessos + ' processo(s) novo(s) de equipamentos existentes' +
      (val.atualizar ? ', ' + r.atualizar + ' atualização(ões)' : '') + (r.capacidades ? ' e ' + r.capacidades + ' capacidade(s) do planejamento' : '') +
      '.\n\nAntes de gravar o MES faz uma cópia de segurança. A importação pode ser desfeita depois em "Importações anteriores".')) return;
    if (btn) btn.disabled = true;
    try {
      try { if (est().backup) est().backup('importacao_recursos'); } catch (e) { }
      var reg = importar(val);
      ESTADO.val = null;
      tela();
      msg('mri_msg', 'Importação <b>' + esc(reg.IdImportacao) + '</b> concluída: ' + reg.Novos + ' novo(s), ' + reg.NovosProcessos + ' processo(s) novo(s), ' + reg.Atualizados + ' atualizado(s)' +
        (reg.Capacidades ? ', ' + reg.Capacidades + ' capacidade(s)' : '') + '. <a href="#" onclick="event.preventDefault();render(\'cad_recursos\')">Ver em Recursos / Máquinas</a>.', 'ok');
    } catch (e) { console.error(e); if (btn) btn.disabled = false; msg('mri_msg', 'Não foi possível importar: ' + esc(e && e.message || e), 'erro'); }
  };
  function desenharHistorico() {
    var b = el('mri_hist'); if (!b) return;
    var lista = A((D() || {}).recursos_importacoes);
    if (!lista.length) { b.innerHTML = ''; return; }
    b.innerHTML = '<div class="mbc-card"><h3>Importações anteriores</h3><div class="mri-tab"><table><thead><tr><th>Data</th><th>Usuário</th><th>Arquivo</th><th class="mbc-num">Novos</th><th class="mbc-num">Atualizados</th>' +
      '<th class="mbc-num">Capacidades</th><th>Situação</th><th></th></tr></thead><tbody>' + lista.map(function (r) {
        var pode = r.Status === 'APLICADA' && r.Itens;
        return '<tr data-imp="' + esc(r.IdImportacao) + '"><td>' + esc(r.Data) + '</td><td>' + esc(r.Usuario) + '</td><td>' + esc(r.Arquivo) + '</td><td class="mbc-num">' + (N(r.Novos) + N(r.NovosProcessos)) + '</td><td class="mbc-num">' + N(r.Atualizados) + '</td>' +
          '<td class="mbc-num">' + N(r.Capacidades) + '</td><td>' + esc(r.Status) + (r.DesfeitaEm ? ' <span class="muted">(' + esc(r.DesfeitaEm) + ', ' + esc(r.DesfeitaPor || '') + ')</span>' : '') +
          (A(r.Pulados).length ? '<ul>' + r.Pulados.map(function (p) { return '<li class="mri-aviso">' + esc(p) + '</li>'; }).join('') + '</ul>' : '') + '</td>' +
          '<td>' + (pode ? '<button class="mini danger" onclick="mesRecImpDesfazer(\'' + esc(r.IdImportacao) + '\')">Desfazer</button>' : (r.SemDesfazer ? '<span class="muted">antiga</span>' : '')) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  window.mesRecImpDesfazer = function (id) {
    var reg = A((D() || {}).recursos_importacoes).find(function (r) { return r.IdImportacao === id; }); if (!reg) return;
    if (!confirm('Desfazer a importação "' + reg.Arquivo + '" de ' + reg.Data + '?\n\nOs equipamentos criados saem do cadastro e os alterados voltam aos valores anteriores. Linhas alteradas depois da importação (ou equipamentos já usados em roteiro/OP) ficam como estão.')) return;
    try {
      try { if (est().backup) est().backup('desfazer_importacao_recursos'); } catch (e) { }
      var r = desfazer(id); tela();
      if (r.nada) msg('mri_msg', 'Nada foi desfeito na importação ' + esc(id) + ' (ela continua aplicada):<br>' + r.Pulados.slice(0, 8).map(esc).join('<br>') + (r.Pulados.length > 8 ? '<br>… e mais ' + (r.Pulados.length - 8) : ''), 'alerta');
      else msg('mri_msg', 'Importação ' + esc(id) + ': ' + esc(r.Status.toLowerCase()) + ' (' + r.Desfeitos + ' item(ns))' + (A(r.Pulados).length ? '; ' + r.Pulados.length + ' item(ns) ficaram como estão — veja abaixo.' : '.'), A(r.Pulados).length ? 'alerta' : 'ok');
    }
    catch (e) { console.error(e); msg('mri_msg', 'Não foi possível desfazer: ' + esc(e && e.message || e), 'erro'); }
  };
  window.mesRecursosImportacao = function () { render('recursos_importacao'); };

  (function () {
    var ant = window.render;
    if (typeof ant !== 'function') return;
    window.render = function (k) {
      if (k === 'recursos_importacao') {
        try { return tela(); } catch (e) { console.error('MES LION 1.6: importação de equipamentos', e); var c = el('content'); if (c) c.innerHTML = '<div class="mbc-msg erro">Erro ao abrir a importação: ' + esc(e && e.message || e) + '</div>'; return; }
      }
      return ant.apply(this, arguments);
    };
  })();

  /* ---------------------------------------------------------------------
     7) ACESSO PARA TESTES
     --------------------------------------------------------------------- */
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function semObjetos(val) {
    return { arquivo: val.arquivo, resumo: val.resumo, atualizar: val.atualizar, ignoradas: val.ignoradas, itens: val.itens.map(function (it) {
      return { linha: it.linha, acao: it.acao, acaoOriginal: it.acaoOriginal || '', codigo: it.codigo, automatico: it.automatico, erros: it.erros, avisos: it.avisos, mudancas: it.mudancas,
        rec: it.novo ? it.novo.rec : null, cad: it.novo ? it.novo.cad : null, cap: it.cap || null };
    }) };
  }
  window.mesRecursosImportacaoAPI = {
    versao: VERSAO, colunas: function () { return COLS.map(function (c) { return { k: c.k, rot: c.rot, grupo: c.g, tipo: c.t, obrig: !!c.obrig }; }); },
    modelo: function (tipo) { return b64(montarModelo(tipo || 'exemplo', tipo === 'resultado' ? ESTADO.val : null)); },
    validarArquivo: async function (b64texto, nome, opcoes) {
      var bin = atob(b64texto), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var f = new File([u], nome || 'planilha.xlsx');
      var val = validar(await lerArquivo(f), opcoes || {}); ESTADO.val = val; return semObjetos(val);
    },
    ultima: function () { return ESTADO.val ? semObjetos(ESTADO.val) : null; },
    importarUltima: function () { if (!ESTADO.val) throw new Error('nada validado'); var r = importar(ESTADO.val); ESTADO.val = null; return { id: r.IdImportacao, novos: r.Novos, novosProcessos: r.NovosProcessos, atualizados: r.Atualizados, capacidades: r.Capacidades }; },
    desfazer: function (id) { var r = desfazer(id); return { status: r.Status, desfeitos: r.Desfeitos, pulados: r.Pulados }; }
  };
  window.MES_ADAPTADOR_RECURSOS_IMPORTACAO = VERSAO;
})();
