/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR 1.6.0: ASSISTENTE PASSO A PASSO NO HELP DESK (treinamento)
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, depois de
   adaptador_recursos_importacao.js. Não altera os arquivos do frontend.

   O Help Desk (botão "?" do menu, "? Ajuda" do topo e "? Procedimento" das telas) ganha a aba
   "🧭 Assistente passo a passo"; a aba "🗺 Fluxo de integração" continua com o fluxo de antes.
     - a pessoa diz o que quer fazer (busca por objetivo, com sinônimos) ou escolhe na lista por módulo;
     - perguntas de sim e não conferem os pré-requisitos, com uma checagem automática nos dados
       (ex.: "há materiais cadastrados?", "há lote com saldo?", "a OP está aberta?"); quando falta algo,
       o assistente leva para o objetivo que resolve e depois volta;
     - cada passo diz onde fica, o que preencher, o que é obrigatório, para onde vão os dados e os erros
       comuns; "Ir para a tela" abre a tela, destaca o botão certo e deixa o assistente no canto da tela
       com "✓ Feito → próximo passo";
     - checklist final e o próximo passo natural;
     - trilhas por perfil (Operador, PCP, Engenharia, Qualidade/ACV, Administrador) com o progresso de cada
       usuário em data.helpdesk_progresso;
     - "Não encontrei o que queria" grava o que a pessoa procurava e onde estava em data.helpdesk_buscas
       (o administrador vê tudo em "Equipe" e exporta para o Excel).
   ===================================================================== */
(function () {
  'use strict';
  if (window.MES_ADAPTADOR_HELPDESK_ASSISTENTE) return;
  var VERSAO = '1.6.0';

  /* ---------------------------------------------------------------------
     0) UTILITÁRIOS
     --------------------------------------------------------------------- */
  function A(x) { return Array.isArray(x) ? x : []; }
  function D() { try { return typeof data !== 'undefined' ? data : window.data; } catch (e) { return window.data; } }
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function chave(v) { return txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' '); }
  function N(v) { if (typeof v === 'number') return isFinite(v) ? v : 0; if (typeof num === 'function') return num(v); var n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
  function usuario() { var u = window.MES_CURRENT_USER; return (u && (u.username || u.fullName)) || 'admin'; }
  function usuarioNome() { var u = window.MES_CURRENT_USER; return (u && (u.fullName || u.username)) || 'admin'; }
  function admin() { var u = window.MES_CURRENT_USER; return !!(u && String(u.role || '').toUpperCase() === 'ADMIN'); }
  function salvar() { try { if (typeof saveLocal === 'function') saveLocal(); } catch (e) { console.warn('MES LION 1.6: gravação do Help Desk', e); } }
  function agoraISO() { return new Date().toISOString(); }
  function dataBR(iso) { var d = iso ? new Date(iso) : new Date(); return isNaN(d) ? txt(iso) : d.toLocaleString('pt-BR'); }
  function telaAtual() { try { return typeof current !== 'undefined' ? current : ''; } catch (e) { return ''; } }
  function plural(n, s, p) { return n + ' ' + (n === 1 ? s : p); }
  function amostra(lista, n) { lista = lista.filter(Boolean); return lista.slice(0, n).join(', ') + (lista.length > n ? '…' : ''); }
  function aberta(op) { return !/conclu|encerr|cancel|finaliz/.test(chave(op && op.Status)); }

  /* ---------------------------------------------------------------------
     1) CHECAGENS AUTOMÁTICAS NOS DADOS (aparecem nas perguntas de sim e não)
     ok = pré-requisito atendido; n = quantos; txt = o que o MES encontrou
     --------------------------------------------------------------------- */
  var CHK = {
    categorias: function (d) { var l = A(d.categorias).map(function (c) { return txt(c && (c.Categoria || c.Nome || c.nome || c.categoria)); }); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'categoria cadastrada', 'categorias cadastradas') + ' (ex.: ' + amostra(l, 4) + ').' : 'Nenhuma categoria cadastrada.' }; },
    materiais: function (d) { var l = A(d.materiais); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'material cadastrado', 'materiais cadastrados') + ' (ex.: ' + amostra(l.map(function (m) { return txt(m['CódigoMaterial'] || m.CodigoMaterial) + ' — ' + txt(m.DescricaoMateriais || m.Descricao); }), 3) + ').' : 'Nenhum material cadastrado.' }; },
    empresas: function (d) { var l = A(d.empresas); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'empresa cadastrada', 'empresas cadastradas') + ' (ex.: ' + amostra(l.map(function (e) { return txt(e.RazaoSocial || e['Razão social'] || e.NomeEmpresa || e.Nome || e.Empresa); }), 3) + ').' : 'Nenhuma empresa (fornecedor) cadastrada.' }; },
    processos: function (d) { var l = A(d.processos).map(function (p) { return txt(p && p.Processo); }); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'processo cadastrado', 'processos cadastrados') + ': ' + amostra(l, 8) + '.' : 'Nenhum processo cadastrado.' }; },
    equipamentos: function (d) {
      var cod = function (r) { return txt(r && (r.CodEquipamento || r['Código Equipamento'])); };
      var cods = A(d.recursos).map(cod).filter(function (c, i, a) { return c && a.indexOf(c) === i; });
      var semTaxa = A(d.recursos).filter(function (r) { return r && (!N(r['TaxaEnergia (R$/kWh)']) || !N(r['TaxaMOD (R$/h)'])); }).length;
      return { ok: cods.length > 0, n: cods.length, txt: cods.length ? plural(cods.length, 'máquina cadastrada', 'máquinas cadastradas') + ' em ' + plural(A(d.recursos).length, 'linha', 'linhas') + ' de Recursos / Máquinas' + (semTaxa ? '; ' + plural(semTaxa, 'linha está', 'linhas estão') + ' sem taxa de energia ou de MOD (custo zero).' : '.') : 'Nenhuma máquina cadastrada.' };
    },
    pa: function (d) { var l = A(d.estrutura).filter(function (e) { return chave(e['Tipo Produto'] || e.TipoProduto) === 'pa'; }); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'PA cadastrado', 'PAs cadastrados') + ': ' + amostra(l.map(function (e) { return txt(e['Código'] || e.Codigo); }), 5) + '.' : 'Nenhum PA (produto acabado) na estrutura.' }; },
    pi: function (d) { var l = A(d.estrutura).filter(function (e) { return chave(e['Tipo Produto'] || e.TipoProduto) === 'pi'; }); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'PI cadastrado', 'PIs cadastrados') + ' na estrutura.' : 'Nenhum PI (produto intermediário) na estrutura.' }; },
    roteiros: function (d) { var l = A(d.roteiro); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'roteiro salvo', 'roteiros salvos') + ' (ex.: ' + amostra(l.map(function (r) { return txt(r.CodRoteiro) + ' — ' + txt(r.CodigoProduto); }), 3) + ').' : 'Nenhum roteiro salvo.' }; },
    formulacoes: function (d) { var l = A(d.formulacoes).filter(function (f) { return !f.Status || chave(f.Status) === 'ativa'; }); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'formulação ativa', 'formulações ativas') + ' (ex.: ' + amostra(l.map(function (f) { return txt(f.CodFormula) + ' — ' + txt(f.Nome); }), 3) + ').' : 'Nenhuma formulação ativa.' }; },
    lotes_saldo: function (d) {
      var linhas = null; try { if (typeof window.mesLinhasEstoque === 'function') linhas = window.mesLinhasEstoque(); } catch (e) { }
      if (!linhas) return { ok: A(d.entradas).length > 0, n: A(d.entradas).length, txt: plural(A(d.entradas).length, 'entrada de material registrada', 'entradas de material registradas') + '.' };
      var com = linhas.filter(function (l) { return N(l.Saldo) > 0; }), mats = com.map(function (l) { return l.CodigoMaterial; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
      return { ok: com.length > 0, n: com.length, txt: com.length ? plural(com.length, 'lote com saldo', 'lotes com saldo') + ' de ' + plural(mats.length, 'material', 'materiais') + '.' : 'Nenhum lote de material com saldo no estoque.' };
    },
    pi_apontados: function (d) {
      var ops = {}; A(d.op).forEach(function (o) { if (o && chave(o.TipoOP) === 'pi') ops[o.CodOP] = 1; });
      var n = A(d.producao).filter(function (p) { return p && ops[p.CodOP]; }).length;
      return { ok: n > 0, n: n, txt: n ? plural(n, 'apontamento de produção de PI', 'apontamentos de produção de PI') + ' (veja o saldo em Estoque PI / PA).' : 'Nenhuma produção de PI apontada ainda.' };
    },
    ops_abertas: function (d) { var l = A(d.op).filter(aberta); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'OP aberta', 'OPs abertas') + ' (ex.: ' + amostra(l.map(function (o) { return txt(o.CodOP); }), 3) + ').' : 'Nenhuma OP aberta.' }; },
    ops_pa_fechadas: function (d) { var l = A(d.op).filter(function (o) { return o && chave(o.TipoOP) === 'pa' && !aberta(o); }); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'OP de PA encerrada', 'OPs de PA encerradas') + ' (ex.: ' + amostra(l.map(function (o) { return txt(o.CodOP); }), 3) + ').' : 'Nenhuma OP de PA encerrada.' }; },
    motivos: function (d) { var l = A(d.perdas_motivos).filter(function (m) { return m && m.Ativo !== false && chave(m.Ativo) !== 'nao'; }); return { ok: l.length > 0, n: l.length, txt: l.length ? plural(l.length, 'motivo de perda ativo', 'motivos de perda ativos') + '.' : 'Nenhum motivo de perda cadastrado.' }; },
    capacidades: function (d) {
      var cods = A(d.recursos).map(function (r) { return txt(r && (r.CodEquipamento || r['Código Equipamento'])); }).filter(function (c, i, a) { return c && a.indexOf(c) === i; });
      var n = A(d.mes_capacidades).length;
      return { ok: n > 0, n: n, txt: n ? n + ' de ' + plural(cods.length, 'máquina', 'máquinas') + ' com capacidade configurada.' : 'Nenhuma máquina com capacidade configurada.' };
    },
    custos: function (d) { var n = A(d.custos_op).length; return { ok: n > 0, n: n, txt: n ? plural(n, 'custo de OP fechado', 'custos de OP fechados') + '.' : 'Nenhum custo de OP fechado ainda.' }; },
    fatores: function (d) { var n = A(d.acv_fatores).length + A(d.sust_fatores).length; return { ok: n > 0, n: n, txt: n ? plural(n, 'fator ambiental cadastrado', 'fatores ambientais cadastrados') + '.' : 'Nenhum fator ambiental cadastrado.' }; },
    acv_calculados: function (d) { var n = A(d.sust_op).length; return { ok: n > 0, n: n, txt: n ? plural(n, 'cálculo de ACV por OP', 'cálculos de ACV por OP') + ' (ex.: ' + amostra(A(d.sust_op).map(function (s) { return txt(s.CodOPMae || s.CodOP); }), 3) + ').' : 'Nenhum ACV calculado ainda.' }; },
    admin: function () { var a = admin(); return { ok: a, n: a ? 1 : 0, txt: a ? 'Você entrou como ' + usuario() + ' (perfil ADMIN).' : 'Você entrou como ' + usuario() + ', sem perfil de administrador.' }; }
  };
  function checar(k) {
    if (!k || !CHK[k]) return null;
    try { return CHK[k](D() || {}); } catch (e) { return { ok: false, n: 0, txt: 'Não foi possível conferir agora (' + (e && e.message || e) + ').', falhou: true }; }
  }

  /* ---------------------------------------------------------------------
     2) ONDE FICA CADA TELA (a chave é a mesma do render)
     --------------------------------------------------------------------- */
  var TELAS = {
    materiais: 'Materiais › Materiais', empresas: 'Materiais › Empresas', entradas: 'Materiais › Entrada de Materiais', estoque: 'Materiais › Estoque / Rastreabilidade',
    estoque_pi_pa: 'Materiais › Estoque PI / PA', locais_estoque: 'Materiais › Locais de Estoque', inventario_estoque: 'Materiais › Inventário de Estoque',
    ajuste_estoque: 'Materiais › Ajuste de Estoque', categorias: 'Materiais › Categorias de Materiais', estrutura: 'Engenharia › Estrutura do Produto',
    cad_recursos: 'Engenharia › Recursos / Máquinas', recursos_importacao: 'Engenharia › Recursos / Máquinas › ⬆ Importar planilha de equipamentos',
    processos: 'Engenharia › Processos', formulacoes: 'Engenharia › Formulações', roteiro: 'Produção › Roteiro', op: 'Produção › Ordens de Produção',
    producao: 'Produção › Apontamento Produção', perdas: 'Produção › Perdas', perdas_motivos: 'Produção › Motivos de Perda', mrp: 'Planejamento › MRP',
    pcp_capacidade: 'Planejamento › Capacidade', pcp_calendario: 'Planejamento › Calendário', custos: 'Projetos › Custos Industriais',
    acv: 'Projetos › ACV — Ciclo de Vida', sustentabilidade: 'Sustentabilidade / ICV / ACV (cálculo por OP — o assistente abre a tela)', bp: 'Projetos › Battery Passport',
    relatorios: 'Relatórios › Catálogo de relatórios', relatorios_dossie: 'Relatórios › Dossiê da OP', usuarios: 'Administração › Usuários / Segurança',
    auditoria: 'Administração › Histórico de Modificações', topo: 'Topo da tela › Banco ▾'
  };

  /* ---------------------------------------------------------------------
     3) OBJETIVOS (FLUXOS DE SIM E NÃO)
     pergunta: { texto, ajuda, chk, decide (a checagem sugere a resposta), sim, nao }
     passo:    { titulo, texto, tela, destacar (texto do botão ou seletor), ctx ('op' | 'op_pa'), preencher, obrig, destino, erros, prox }
     fim:      { texto, checklist, proximos }
     destino de sim / nao / prox: 'no' do mesmo objetivo; { fluxo, volta } = faz antes o outro objetivo e volta
     para o nó 'volta'; { fluxo } sem volta = troca de objetivo.
     --------------------------------------------------------------------- */
  var FLUXOS = {}, ORDEM = [];
  function fluxo(id, def) { def.id = id; FLUXOS[id] = def; ORDEM.push(id); }
  function P(texto, o) { o.tipo = 'pergunta'; o.texto = texto; return o; }
  function Ps(titulo, o) { o.tipo = 'passo'; o.titulo = titulo; return o; }
  function E(o) { o = o || {}; o.tipo = 'fim'; return o; }

  var GRUPOS = [
    { id: 'Cadastros', icone: '🧩', desc: 'Materiais, processos, máquinas, estrutura, roteiro e formulação' },
    { id: 'Estoque', icone: '📦', desc: 'Entradas, ajustes, inventário e saldos' },
    { id: 'Produção', icone: '🏭', desc: 'OP, apontamento, consumos, perdas e encerramento' },
    { id: 'Planejamento', icone: '📅', desc: 'MRP, calendário e capacidade' },
    { id: 'Custos, ACV e Passaporte', icone: '🌱', desc: 'Custo fechado, pegada de carbono e passaporte' },
    { id: 'Relatórios', icone: '📑', desc: 'Excel dos módulos e dossiê da OP' },
    { id: 'Administração', icone: '🔐', desc: 'Usuários, histórico e cópia de segurança' }
  ];

  /* ---- Cadastros ---- */
  fluxo('cad_material', {
    titulo: 'Cadastrar um material (matéria-prima)', grupo: 'Cadastros',
    resumo: 'Cria o código do material usado na entrada, no roteiro, na formulação, no MRP, nos custos e no ACV.',
    sinonimos: ['material', 'materia prima', 'insumo', 'mp', 'novo material', 'cadastrar material', 'codigo do material', 'item', 'fator de conversao', 'unidade de medida', 'um', 'categoria de material', 'estoque minimo', 'codigo de barras do fornecedor'],
    inicio: 'q_cat',
    nos: {
      q_cat: P('A categoria do material já existe em Materiais › Categorias de Materiais?', { chk: 'categorias', decide: true, sim: 'q_existe', nao: 'p_cat',
        ajuda: 'A categoria agrupa os materiais nos filtros e liga o material a um processo padrão. É uma lista fixa: crie antes de usar.' }),
      p_cat: Ps('Criar a categoria', { tela: 'categorias', destacar: '+ Nova categoria',
        preencher: ['Nome da categoria — ex.: "Binder cátodo"', 'Processo padrão (opcional) — o processo em que o material costuma entrar'], obrig: ['Nome da categoria'],
        destino: 'Filtro de Materiais e cadastro de Recursos / Máquinas.', erros: ['A mesma categoria com outra grafia ("Binder catodo" × "Binder cátodo"): os filtros passam a separar as duas.'], prox: 'q_existe' }),
      q_existe: P('O material já está cadastrado? Pesquise pelo código ou pela descrição na tela Materiais.', { chk: 'materiais', sim: 'fim_ja', nao: 'p_mat',
        ajuda: 'Cadastrar de novo um material que já existe divide o saldo, o custo e o histórico em dois códigos.' }),
      p_mat: Ps('Cadastrar o material', { tela: 'materiais', destacar: '+ Novo cadastro', texto: 'Clique em "+ Novo cadastro", preencha e clique em "Salvar cadastro".',
        preencher: ['Código — ex.: MP0021 (único; é o código lido no código de barras)', 'Descrição — o nome técnico do material', 'UM — unidade de compra e de consumo (kg, g, L, m, un…)',
          'Fator conversão para kg — quantos kg tem 1 UM (ex.: 1 m de folha de alumínio = 0,054 kg)', 'Categoria', 'Estoque mínimo (kg) — opcional; gera o alerta no Estoque e no MRP',
          'Código de barras do fornecedor — leia com o leitor (mais de um: separe com ";")', 'Material qualificado e ficha técnica — opcional'],
        obrig: ['Código', 'Descrição', 'UM', 'Fator conversão para kg quando a UM não for de massa (m, L, un…)'],
        destino: 'Entrada de Materiais (lotes e custo), Roteiro e Formulação (materiais por operação), MRP (compras), Custos (valor do lote consumido) e ACV (massa em kg × fator de emissão).',
        erros: ['UM diferente da usada na compra ou no roteiro (g × kg): as quantidades ficam 1.000 vezes maiores ou menores.', 'Sem fator para kg num material medido em m, L ou un: a massa e o CO₂ dele ficam zerados no ACV.',
          'Código repetido ou com espaço no fim: o leitor de código de barras não encontra o material.'], prox: 'fim' }),
      fim: E({ checklist: ['Código único, sem espaço no fim', 'UM igual à da nota fiscal e do roteiro', 'Fator para kg preenchido (quando a UM não é kg)', 'Categoria correta', 'O material aparece na lista de Materiais'], proximos: ['entrada_material', 'roteiro'] }),
      fim_ja: E({ texto: 'O material já existe: não cadastre de novo. Use o mesmo código na entrada, no roteiro e na formulação.', checklist: ['Conferi o código, a UM e o fator para kg do material que já existe'], proximos: ['entrada_material', 'roteiro'] })
    }
  });

  fluxo('cad_processo', {
    titulo: 'Cadastrar um processo produtivo', grupo: 'Cadastros',
    resumo: 'O processo (mistura, coating, corte, montagem…) organiza o roteiro, as máquinas e os relatórios.',
    sinonimos: ['processo', 'processo produtivo', 'etapa', 'operacao', 'idprocesso', 'mistura', 'coating', 'corte', 'montagem', 'calandragem', 'formacao', 'novo processo'],
    inicio: 'q_existe',
    nos: {
      q_existe: P('O processo já aparece em Engenharia › Processos?', { chk: 'processos', sim: 'fim_ja', nao: 'p_proc' }),
      p_proc: Ps('Cadastrar o processo', { tela: 'processos', destacar: '+ Novo cadastro',
        preencher: ['Processo — o nome padronizado (ex.: "Coating cátodo")', 'IdProcesso — código único (ex.: PR-008)'], obrig: ['Processo', 'IdProcesso'],
        destino: 'Lista de processos do Roteiro, de Recursos / Máquinas (máquinas por processo), da importação de equipamentos e dos relatórios por processo.',
        erros: ['O mesmo processo com grafias diferentes ("Coating catodo" × "Coating cátodo"): roteiro, carga das máquinas e relatórios tratam como processos diferentes.', 'IdProcesso repetido.'], prox: 'fim' }),
      fim: E({ checklist: ['Nome igual ao usado na fábrica, com acentos', 'IdProcesso único'], proximos: ['cad_equipamento', 'roteiro'] }),
      fim_ja: E({ texto: 'O processo já existe: use-o no roteiro e nas máquinas.', checklist: ['Conferi a grafia do processo que já existe'], proximos: ['cad_equipamento', 'roteiro'] })
    }
  });

  fluxo('cad_equipamento', {
    titulo: 'Cadastrar equipamentos / máquinas (um a um ou por planilha)', grupo: 'Cadastros',
    resumo: 'Máquina por processo, com tempo, pessoas, potência e taxas — base do roteiro, do custo, do ACV e da capacidade.',
    sinonimos: ['equipamento', 'maquina', 'recurso', 'recursos', 'cadastrar maquina', 'nova maquina', 'novo equipamento', 'cadastrar equipamento', 'potencia', 'taxa mod', 'taxa de energia', 'custo hora', 'patrimonio',
      'importar planilha', 'importar equipamentos', 'planilha de equipamentos', 'cadastro em massa', 'varios equipamentos', 'template de equipamentos'],
    inicio: 'q_proc',
    nos: {
      q_proc: P('O processo em que a máquina trabalha já está cadastrado (Engenharia › Processos)?', { chk: 'processos', decide: true, sim: 'q_varios', nao: { fluxo: 'cad_processo', volta: 'q_varios' } }),
      q_varios: P('Você vai cadastrar ou alterar muitos equipamentos de uma vez?', { sim: 'p_modelo', nao: 'q_outro',
        ajuda: 'Para mais de 5 equipamentos a planilha é mais rápida: o MES confere todas as linhas antes de gravar e a importação pode ser desfeita.' }),
      p_modelo: Ps('Baixar o modelo da planilha', { tela: 'recursos_importacao', destacar: '⬇ Modelo em branco (com exemplos)',
        texto: 'Use o modelo em branco para equipamentos novos ou "⬇ Modelo com os equipamentos cadastrados" para alterar em massa (ele traz o ID interno de cada linha).',
        preencher: ['Uma linha por equipamento e processo (a mesma máquina em 2 processos = 2 linhas com o mesmo código)', 'Equipamento e Processo (lista suspensa)', 'Código em branco = o MES numera',
          'Tempo (min), pessoas, potência (W), taxas de energia e de MOD', 'Colunas laranja (opcional): Capacidades das máquinas do planejamento'],
        obrig: ['Equipamento e Processo no equipamento novo'], destino: 'Recursos / Máquinas (tempos, potência, taxas, custos calculados, patrimônio) e Capacidades das máquinas.',
        erros: ['Deixar a palavra EXEMPLO nas linhas amarelas: elas são ignoradas.', 'Processo fora da lista: a linha fica com erro.', 'Máquina que já existe sem o código: o MES acusa para não duplicar — informe o código.'], prox: 'p_subir' }),
      p_subir: Ps('Subir a planilha e conferir a prévia', { tela: 'recursos_importacao', destacar: '#mri_arquivo',
        preencher: ['Escolha o arquivo (.xlsx ou CSV)', 'Confira linha a linha: novo equipamento, novo processo, atualizar, sem mudança ou com erro', 'Com erro: baixe a "Planilha com os erros e avisos apontados", corrija e suba de novo', 'Sem erro: clique em "⬆ Importar"'],
        obrig: ['Nenhuma linha com erro'], destino: 'Antes de gravar o MES faz uma cópia de segurança; a importação fica em "Importações anteriores" e pode ser desfeita.',
        erros: ['Desmarcar "Atualizar os equipamentos que já existem" sem querer: as alterações ficam de fora.'], prox: 'q_cap' }),
      q_outro: P('A mesma máquina já está cadastrada em outro processo?', { chk: 'equipamentos', sim: 'p_mesma', nao: 'p_nova',
        ajuda: 'Uma máquina usada em vários processos tem um único código e uma linha por processo.' }),
      p_mesma: Ps('Acrescentar o processo à máquina', { tela: 'cad_recursos', destacar: '+ Novo recurso',
        texto: 'Em "Equipamento já cadastrado em outro processo?" escolha a máquina: código, nome, potência, patrimônio e taxas vêm preenchidos.',
        preencher: ['Processo e Subprocesso novos', 'Tempo de operação (min) e Nº de pessoas deste processo', 'Confira potência e taxas (vêm do cadastro)'], obrig: ['Processo'],
        destino: 'A máquina passa a aparecer nas operações desse processo no Roteiro.', erros: ['Criar outro código para a mesma máquina: capacidade e documentos ficam divididos.'], prox: 'q_cap' }),
      p_nova: Ps('Cadastrar a máquina', { tela: 'cad_recursos', destacar: '+ Novo recurso',
        preencher: ['Código do equipamento — único por máquina (vazio = próximo número livre)', 'Equipamento — o nome', 'Processo e Subprocesso', 'Escala e Ativo', 'Tempo de operação (min) e Nº de pessoas', 'Potência (W)',
          'Taxa de energia (R$/kWh) e Taxa MOD (R$/h) — os custos são calculados', 'Patrimônio, NF, valor e fatores — opcionais'],
        obrig: ['Equipamento', 'Processo'], destino: 'Roteiro (máquinas de cada operação), OP (tempo planejado), Apontamento (tempo por máquina), Custos (energia e MOD), ACV (kWh), Capacidade e Calendário.',
        erros: ['O mesmo código em máquinas diferentes: capacidade, calendário e documentos se misturam (a tela avisa em "Verificação do cadastro").', 'Taxas em branco: custo de energia e de MOD ficam zero.', 'Tempo em horas no campo de minutos.'], prox: 'q_cap' }),
      q_cap: P('Essa máquina entra no planejamento (calendário e carga × capacidade)?', { sim: 'p_cap', nao: 'fim' }),
      p_cap: Ps('Configurar a capacidade', { tela: 'cad_recursos', destacar: 'Capacidades das máquinas', texto: 'Clique em "Configurar" na máquina.',
        preencher: ['Operação: Batelada, Contínua ou Unidade', 'Capacidade física por ciclo/hora e a unidade', 'Tempo de ciclo (obrigatório na batelada) e setup', 'Horas programadas por dia útil, eficiência (%) e operações simultâneas'],
        obrig: ['Operação', 'Capacidade maior que zero', 'Horas por dia entre 0 e 24', 'Eficiência entre 1 e 100%'], destino: 'Carga × capacidade e Calendário de Produção.', erros: ['Esquecer o tempo de ciclo na batelada.'], prox: 'fim' }),
      fim: E({ checklist: ['Um código por máquina (sem repetir em máquinas diferentes)', 'Processo e subprocesso corretos', 'Tempo em minutos e nº de pessoas', 'Potência e taxas preenchidas (custos diferentes de zero)', 'Capacidade configurada, se a máquina entra no calendário'], proximos: ['roteiro', 'carga_capacidade'] })
    }
  });

  fluxo('cad_estrutura', {
    titulo: 'Criar a estrutura do produto (PA e PIs)', grupo: 'Cadastros',
    resumo: 'A árvore PA → PI: cada PA e cada PI do roteiro vira uma OP da família.',
    sinonimos: ['estrutura', 'arvore', 'pa', 'pi', 'produto acabado', 'produto intermediario', 'bom', 'lista de materiais', 'celula', 'slurry', 'eletrodo', 'jelly roll', 'gerar pis', 'novo produto'],
    inicio: 'q_pa',
    nos: {
      q_pa: P('O PA (produto acabado) já existe em Engenharia › Estrutura do Produto?', { chk: 'pa', sim: 'q_pi', nao: 'p_pa' }),
      p_pa: Ps('Cadastrar o PA', { tela: 'estrutura', destacar: '+ Novo PA',
        preencher: ['Código (ex.: PA0002) e Descrição', 'Célula, Composição e Modelo', 'Unidade de produção (un) e Quantidade padrão do lote', 'Casas decimais e Permite fracionamento', 'Capacidade Final (Ah), Tensão Nominal (V) e Energia (Wh)', 'Status'],
        obrig: ['Código', 'Descrição', 'Unidade de produção'], destino: 'Roteiro (produto final), OP de PA, custo por Wh e Passaporte da bateria (dados técnicos).',
        erros: ['Energia (Wh) em branco: o custo por Wh e o passaporte ficam sem o dado.', 'Unidade diferente da usada no roteiro.'], prox: 'q_pi' }),
      q_pi: P('Os PIs (intermediários: slurry, eletrodo, jelly roll…) desse PA já estão cadastrados?', { chk: 'pi', sim: 'q_rot', nao: 'p_pi' }),
      p_pi: Ps('Gerar os PIs do PA', { tela: 'estrutura', destacar: 'Gerar PIs do PA (escolher processos)',
        texto: 'Escolha os processos: o MES cria um PI por processo, ligado ao PA. Para um PI avulso use "+ Novo PI do PA".',
        preencher: ['PA pai', 'Processos que geram PI', 'Descrição e Tipo PI de cada PI', 'Unidade de cada PI (kg para slurry, m para eletrodo, un para peças)'], obrig: ['PA pai', 'Unidade'],
        destino: 'Cada PI vira uma OP filha; o saldo do PI aparece em Estoque PI / PA e ele é consumido nas operações seguintes.',
        erros: ['PI sem o PA pai: não entra na família de OPs.', 'Unidade do PI diferente da operação que o consome.'], prox: 'q_rot' }),
      q_rot: P('Essa estrutura já tem um roteiro salvo?', { chk: 'roteiros', sim: 'fim', nao: { fluxo: 'roteiro', volta: 'fim' } }),
      fim: E({ checklist: ['PA com unidade e energia (Wh)', 'Um PI para cada produto intermediário', 'Unidades coerentes (kg, m, un)', 'Árvore PA → PI conferida em "Árvore de produtos"'], proximos: ['roteiro', 'formulacao'] })
    }
  });

  fluxo('roteiro', {
    titulo: 'Montar o roteiro (operações, máquinas, materiais e PIs)', grupo: 'Cadastros',
    resumo: 'A receita de fabricação de 1 PA: operações em ordem, máquinas com tempo e pessoas, materiais e o caminho dos PIs.',
    sinonimos: ['roteiro', 'rota', 'roteiro de fabricacao', 'operacoes', 'etapas', 'sequencia', 'materiais por etapa', 'maquinas do roteiro', 'fluxo de pis', 'receita', 'processo de fabricacao', 'tempo padrao'],
    inicio: 'q_estr',
    nos: {
      q_estr: P('A estrutura do produto (PA e PIs) está cadastrada?', { chk: 'pa', decide: true, sim: 'q_maq', nao: { fluxo: 'cad_estrutura', volta: 'q_maq' } }),
      q_maq: P('Os processos e as máquinas das operações estão cadastrados?', { chk: 'equipamentos', decide: true, sim: 'q_mat', nao: { fluxo: 'cad_equipamento', volta: 'q_mat' } }),
      q_mat: P('Os materiais usados nas operações estão cadastrados?', { chk: 'materiais', decide: true, sim: 'p_novo', nao: { fluxo: 'cad_material', volta: 'p_novo' } }),
      p_novo: Ps('Criar o roteiro', { tela: 'roteiro', destacar: '+ Novo roteiro',
        preencher: ['Código do produto (o PA)', 'Tipo e Composição', 'Versão e Escala de produção', 'Descrição do roteiro', 'Ativo e Observações'], obrig: ['Código do produto', 'Escala de produção'],
        destino: 'Base da família de OPs (OP de PA + OPs de PI), do custo e do ACV.', erros: ['Copiar um roteiro e esquecer de mudar a versão ou a escala.'], prox: 'p_oper' }),
      p_oper: Ps('Criar as operações', { tela: 'roteiro', destacar: '+ Criar operação',
        preencher: ['PA/PI que será produzido nesta operação', 'Processo pré-cadastrado no MES e Ordem (10, 20, 30…)', '"+ Adicionar equipamento": máquina, Tempo (min) e Pessoas', '"🔎 Pesquisar no cadastro de materiais": material e QtdBase por unidade-base do produto'],
        obrig: ['Produto', 'Processo', 'Ao menos uma máquina por operação'], destino: 'OP - Etapas e OP - Materiais (copiados para cada OP), tempo planejado por máquina, reservas e MRP.',
        erros: ['Material fora de uma operação: não entra no custo nem no ACV.', 'Quantidade do lote inteiro no lugar da quantidade por unidade-base.', 'Ordem fora da sequência real da fábrica.'], prox: 'p_pis' }),
      p_pis: Ps('Ligar os PIs às operações seguintes', { tela: 'roteiro', destacar: 'Sugerir fluxo automaticamente',
        texto: 'Em "Fluxo dos PIs neste roteiro" diga que PI entra em qual operação ("+ PI que entra nesta operação…") e em qual máquina. "Sugerir fluxo automaticamente" propõe pela ordem.',
        preencher: ['Em cada operação, os PIs que entram', 'A máquina onde o PI entra (padrão: a primeira da operação)'], obrig: ['Todo PI produzido entra numa operação seguinte (situação OK)'],
        destino: 'Consumo do PI no apontamento (pela etiqueta), estoque de PI e custo/ACV sem dupla contagem.', erros: ['PI sem operação de destino: o saldo fica parado e o custo não chega ao PA.'], prox: 'p_salvar' }),
      p_salvar: Ps('Salvar o roteiro', { tela: 'roteiro', destacar: 'Salvar roteiro',
        texto: 'Se já houver OPs abertas desse roteiro, "Aplicar às OPs abertas deste roteiro" leva as mudanças para elas.',
        preencher: ['Salvar roteiro', '"PDF Roteiro" para conferir'], destino: 'O roteiro salvo aparece em "+ Nova OP por roteiro salvo".', erros: ['Sair da tela sem salvar.'], prox: 'fim' }),
      fim: E({ checklist: ['Toda operação com processo e ao menos uma máquina', 'Tempo (min) e pessoas em cada máquina', 'Todos os materiais dentro de uma operação', 'Todo PI produzido entra numa operação seguinte', 'Roteiro salvo'], proximos: ['formulacao', 'abrir_op'] })
    }
  });

  fluxo('formulacao', {
    titulo: 'Cadastrar uma formulação (percentuais do slurry)', grupo: 'Cadastros',
    resumo: 'Composição percentual reutilizável de cátodo e ânodo, escolhida ao abrir a OP.',
    sinonimos: ['formulacao', 'formula', 'receita', 'percentual', 'slurry', 'catodo', 'anodo', 'composicao', 'teor de solidos', 'solvente', 'binder', 'material ativo'],
    inicio: 'q_mat',
    nos: {
      q_mat: P('Os materiais da formulação estão cadastrados?', { chk: 'materiais', decide: true, sim: 'p_form', nao: { fluxo: 'cad_material', volta: 'p_form' } }),
      p_form: Ps('Cadastrar a formulação', { tela: 'formulacoes', destacar: '+ Nova formulação',
        preencher: ['Código, Nome e Versão', 'Química, Aplicação e Status', 'Teores de sólidos e de solvente (cátodo / ânodo)', '"+ Adicionar material": Material, Percentual sobre a base (%), Classificação do percentual e Função'],
        obrig: ['Código', 'Nome', 'Materiais com percentual'], destino: 'Escolhida em "Formulação dos slurrys" ao estruturar a OP; usada nas Simulações.',
        erros: ['Base que não fecha 100%.', 'Solvente ou adição classificado como base (só as adições podem levar a entrada acima de 100%).', 'Formulação INATIVA: não aparece na OP.'], prox: 'p_validar' }),
      p_validar: Ps('Validar e salvar', { tela: 'formulacoes', destacar: 'Validar percentuais', preencher: ['Validar percentuais', 'Salvar formulação'], prox: 'fim' }),
      fim: E({ checklist: ['Base fecha 100%', 'Solventes e adições classificados', 'Status ATIVA', 'Versão correta'], proximos: ['abrir_op'] })
    }
  });

  /* ---- Estoque ---- */
  fluxo('entrada_material', {
    titulo: 'Registrar a entrada (recebimento) de material', grupo: 'Estoque',
    resumo: 'Cria o lote com quantidade, custo, fornecedor, NF e localização — de onde sai todo consumo das OPs.',
    sinonimos: ['entrada', 'recebimento', 'receber material', 'compra', 'nota fiscal', 'nf', 'lote', 'fornecedor', 'chegada de material', 'registrar entrada', 'etiqueta de material', 'custo do lote'],
    inicio: 'q_mat',
    nos: {
      q_mat: P('O material está cadastrado?', { chk: 'materiais', decide: true, sim: 'q_forn', nao: { fluxo: 'cad_material', volta: 'q_forn' } }),
      q_forn: P('O fornecedor está cadastrado em Materiais › Empresas?', { chk: 'empresas', decide: true, sim: 'p_ent', nao: 'p_forn' }),
      p_forn: Ps('Cadastrar o fornecedor', { tela: 'empresas', destacar: '+ Novo cadastro',
        preencher: ['Código', 'Razão social', 'CNPJ', 'Categoria', 'Fornecedor qualificado e arquivos de qualificação'], obrig: ['Razão social', 'CNPJ'],
        destino: 'Entrada (fornecedor do lote) e Passaporte da bateria (cadeia de fornecimento).', erros: ['CNPJ com outra pontuação: o mesmo fornecedor aparece duas vezes.'], prox: 'p_ent' }),
      p_ent: Ps('Registrar a entrada', { tela: 'entradas', destacar: 'Registrar entrada', texto: 'Leia o código de barras da etiqueta do fornecedor ou escolha o material e preencha "Nova entrada".',
        preencher: ['Material (▮▯▮ ler o código de barras)', 'Qtd adquirida (na UM do material)', 'Custo total R$ — o valor unitário é calculado', 'Fornecedor, Lote e Nº NF', 'Localização física (endereço no estoque)', 'Projeto', 'Material/lote qualificado e arquivos'],
        obrig: ['Material', 'Qtd adquirida', 'Custo total', 'Lote'],
        destino: 'Saldo por lote (Estoque / Rastreabilidade), custo dos consumos nas OPs (valor unitário do lote), MRP (saldo físico) e rastreabilidade do passaporte (fornecedor e lote).',
        erros: ['Quantidade em outra unidade (g × kg).', 'Valor unitário digitado no campo do custo total.', 'Lote em branco: perde a rastreabilidade.', 'Sem localização: o lote fica "(sem localização)" em Locais de Estoque.'], prox: 'p_etq' }),
      p_etq: Ps('Imprimir a etiqueta do lote', { tela: 'entradas', destacar: 'Etiquetas de materiais', preencher: ['Escolha as entradas e imprima', 'Cole a etiqueta na embalagem'],
        destino: 'O código da etiqueta é lido no consumo da OP, no ajuste e no inventário.', prox: 'fim' }),
      fim: E({ checklist: ['Quantidade na UM do cadastro', 'Custo total e unitário conferidos', 'Lote, NF e fornecedor', 'Localização informada', 'Etiqueta impressa e colada'], proximos: ['saldo_estoque', 'consumir_materiais'] })
    }
  });

  fluxo('ajuste_estoque', {
    titulo: 'Ajustar o estoque (saída, baixa técnica, entrada manual) e estornar', grupo: 'Estoque',
    resumo: 'Movimentos fora da OP: amostra, avaria, sobra, correção do saldo — tudo com motivo e histórico, e com estorno.',
    sinonimos: ['ajuste', 'ajuste de estoque', 'acertar saldo', 'corrigir saldo', 'baixa', 'baixa tecnica', 'avaria', 'amostra', 'descarte', 'estorno', 'estornar', 'desfazer ajuste', 'saida manual', 'sobra', 'entrada manual', 'resto de bobina'],
    inicio: 'q_geral',
    nos: {
      q_geral: P('A diferença é de muitos lotes ao mesmo tempo (contagem geral do estoque)?', { sim: { fluxo: 'inventario' }, nao: 'q_sem_op',
        ajuda: 'Para a contagem geral o caminho certo é o Inventário: uma planilha com todos os lotes, validada antes de gravar e reversível.' }),
      q_sem_op: P('O material saiu do estoque sem OP (amostra, avaria, resto de bobina, descarte)?', { sim: 'p_baixa', nao: 'q_entrou' }),
      p_baixa: Ps('Registrar a saída ou a baixa técnica', { tela: 'ajuste_estoque', destacar: 'Baixa técnica (sem OP)',
        texto: 'Escolha o material em "1. Material" e o tipo em "2. Tipo de ajuste": "Saída manual" para retirada comum; "Baixa técnica (sem OP)" para amostra, avaria ou resto.',
        preencher: ['Material (ler o código ou escolher)', 'Lote(s) e Quantidade', 'Motivo', 'Projeto e OP de referência (opcional)', 'Observação (obrigatória quando o motivo é "Outro")'], obrig: ['Material', 'Quantidade', 'Motivo'],
        destino: 'Saldo do lote, histórico de ajustes e relatórios de estoque.', erros: ['Baixar de um lote errado.', 'Dar baixa de algo que foi consumido numa OP (baixa em dobro).'], prox: 'p_estorno' }),
      q_entrou: P('Entrou material sem nota (sobra, devolução, material achado)?', { sim: 'p_entrada', nao: 'p_corrigir' }),
      p_entrada: Ps('Entrada manual (novo lote)', { tela: 'ajuste_estoque', destacar: 'Entrada manual (novo lote)', preencher: ['Material', 'Quantidade', 'Lote, custo e localização', 'Motivo'], obrig: ['Material', 'Quantidade', 'Motivo'],
        destino: 'Novo lote com saldo no Estoque / Rastreabilidade.', prox: 'p_estorno' }),
      p_corrigir: Ps('Corrigir o saldo geral do material', { tela: 'ajuste_estoque', destacar: 'Corrigir saldo geral', preencher: ['Material', 'Saldo contado', 'Motivo e observação'], obrig: ['Saldo contado', 'Motivo'],
        destino: 'O MES calcula a diferença e distribui pelos lotes.', prox: 'p_estorno' }),
      p_estorno: Ps('Conferir (e estornar, se errou)', { tela: 'ajuste_estoque', texto: 'O ajuste aparece em "3. Histórico de ajustes". Lançou errado? Use "Estornar" na linha: o saldo volta e o ajuste fica marcado como estornado (nada é apagado).',
        preencher: ['Confira material, lote, quantidade e motivo no histórico'], prox: 'fim' }),
      fim: E({ checklist: ['Motivo informado', 'Lote certo', 'Saldo conferido em Estoque / Rastreabilidade'], proximos: ['saldo_estoque', 'inventario'] })
    }
  });

  fluxo('inventario', {
    titulo: 'Fazer o inventário (contagem geral) pela planilha', grupo: 'Estoque',
    resumo: 'Planilha com todos os lotes: conta, valida e aplica saldo, custo e localização — e pode ser revertido.',
    sinonimos: ['inventario', 'contagem', 'balanco', 'contar estoque', 'template de inventario', 'corrigir saldos em massa', 'auditoria de estoque'],
    inicio: 'p_tpl',
    nos: {
      p_tpl: Ps('Baixar o template', { tela: 'inventario_estoque', destacar: 'Baixar template do inventário (.xlsx)', texto: 'Marque "incluir lotes esgotados" para contar também os lotes zerados.',
        preencher: ['Uma linha por lote, com o saldo do sistema'], destino: 'A planilha é a lista de contagem.', prox: 'p_contar' }),
      p_contar: Ps('Contar e preencher a planilha', { texto: 'Faça a contagem física e preencha a planilha (fora do MES).',
        preencher: ['SaldoContado — o que foi contado', 'CustoUnitarioNovo — só se o custo mudar', 'LocalizacaoNova — só se o lote mudou de lugar', 'Observacao'], obrig: ['SaldoContado das linhas contadas'],
        erros: ['Alterar as colunas cinza (entrada, código, lote).', 'Vírgula e ponto trocados nos números.'], prox: 'p_validar' }),
      p_validar: Ps('Validar e aplicar', { tela: 'inventario_estoque', destacar: 'Validar planilha', preencher: ['Escolha a planilha preenchida', 'Confira as diferenças lote a lote', 'Aplique'],
        destino: 'Saldo, custo e localização dos lotes; o inventário fica no histórico e pode ser revertido.', erros: ['Aplicar com linhas de erro.'], prox: 'fim' }),
      fim: E({ checklist: ['Todos os lotes contados', 'Diferenças conferidas antes de aplicar', 'Inventário no histórico'], proximos: ['saldo_estoque'] })
    }
  });

  fluxo('saldo_estoque', {
    titulo: 'Consultar o saldo e rastrear um lote ou etiqueta', grupo: 'Estoque',
    resumo: 'Quanto tem, quanto está reservado, onde está e de onde veio cada lote, PI ou PA.',
    sinonimos: ['saldo', 'estoque', 'quanto tem', 'rastreabilidade', 'rastrear', 'rastrear lote', 'onde esta', 'localizacao', 'reservado', 'disponivel', 'pi pronto', 'pa pronto', 'etiqueta', 'consultar estoque'],
    inicio: 'q_tipo',
    nos: {
      q_tipo: P('É matéria-prima (material comprado)?', { sim: 'p_mp', nao: 'p_pipa', ajuda: 'Responda Não para PI (produto intermediário) ou PA (produto acabado) produzidos nas OPs.' }),
      p_mp: Ps('Saldo de matéria-prima', { tela: 'estoque', destacar: 'Por entrada / lote / localização',
        texto: '"Por material" mostra reservado × em produção × consumido; "Por entrada / lote / localização" mostra cada lote.',
        preencher: ['Disponível = saldo físico − reservado para OPs abertas', 'Filtro por projeto'], destino: 'Excel em "Exportar Excel de saldos" ou no menu Relatórios.', prox: 'p_local' }),
      p_local: Ps('Onde está o lote', { tela: 'locais_estoque', texto: 'Lotes por endereço físico; use "Mudar local" quando mover um lote.', prox: 'fim' }),
      p_pipa: Ps('Saldo de PI e PA prontos', { tela: 'estoque_pi_pa', destacar: 'Por etiqueta', texto: 'Leia a etiqueta em "▮▯▮ Ler etiqueta (rastrear)" para ver de onde veio e para onde foi.',
        preencher: ['Abas: Por produto, Por lote (OP), Por etiqueta e Movimentos'], prox: 'fim' }),
      fim: E({ checklist: ['Saldo conferido', 'Lote ou etiqueta localizados'], proximos: ['relatorio', 'dossie'] })
    }
  });

  /* ---- Produção ---- */
  fluxo('abrir_op', {
    titulo: 'Abrir uma OP (família de OPs pelo roteiro)', grupo: 'Produção',
    resumo: 'Gera a OP de PA e uma OP para cada PI, com etapas e materiais do roteiro.',
    sinonimos: ['abrir op', 'ordem de producao', 'criar op', 'gerar op', 'nova op', 'produzir', 'familia de ops', 'estruturar op', 'op de pa', 'op de pi', 'picking list'],
    inicio: 'q_rot',
    nos: {
      q_rot: P('O roteiro do produto está salvo?', { chk: 'roteiros', decide: true, sim: 'q_slurry', nao: { fluxo: 'roteiro', volta: 'q_slurry' } }),
      q_slurry: P('O produto tem slurry (usa formulação de cátodo ou ânodo)?', { sim: 'q_form', nao: 'p_op' }),
      q_form: P('A formulação está cadastrada e ATIVA?', { chk: 'formulacoes', decide: true, sim: 'p_op', nao: { fluxo: 'formulacao', volta: 'p_op' } }),
      p_op: Ps('Estruturar a família de OPs', { tela: 'op', destacar: '+ Nova OP por roteiro salvo',
        preencher: ['Roteiro salvo', 'Formulação dos slurrys', '"Estruturar OP" e a quantidade do PA'], obrig: ['Roteiro', 'Quantidade'],
        destino: 'Cria a OP de PA e uma OP de PI para cada PI, com etapas e materiais do roteiro (OP - Etapas e OP - Materiais), reserva os materiais no estoque e entra no MRP e no Calendário.',
        erros: ['Escolher o roteiro de outra versão ou escala.', 'Esquecer a formulação.'], prox: 'p_conf' }),
      p_conf: Ps('Conferir e imprimir', { tela: 'op', destacar: 'PDF OP Produção', preencher: ['Conferir em OP - Etapas e OP - Materiais', '"Vincular projeto à OP"', '"PDF OP Produção" e "Picking List PDF"'], prox: 'q_cal' }),
      q_cal: P('Vai programar as datas no calendário agora?', { sim: { fluxo: 'calendario', volta: 'fim' }, nao: 'fim' }),
      fim: E({ checklist: ['OP de PA e OPs de PI criadas', 'Etapas e materiais conferidos', 'Projeto vinculado', 'Documentos impressos'], proximos: ['mrp', 'apontar_producao'] })
    }
  });

  fluxo('apontar_producao', {
    titulo: 'Apontar a produção (quantidade, etiquetas e tempo por máquina)', grupo: 'Produção',
    resumo: 'Registra o que foi produzido, imprime as etiquetas e mede o tempo de cada máquina.',
    sinonimos: ['apontar', 'apontamento', 'apontar producao', 'registrar producao', 'produzi', 'quantidade produzida', 'etiqueta', 'imprimir etiqueta', 'tempo de maquina', 'iniciar maquina', 'finalizar maquina', 'cronometro', 'hora maquina'],
    inicio: 'q_op',
    nos: {
      q_op: P('A OP está aberta (Planejada ou em produção)?', { chk: 'ops_abertas', decide: true, sim: 'p_carregar', nao: { fluxo: 'abrir_op', volta: 'p_carregar' } }),
      p_carregar: Ps('Carregar a OP', { tela: 'producao', destacar: 'Carregar OP', ctx: 'op', texto: 'Leia o código de barras impresso na OP ou escolha em "Pesquisar OP" e clique em "Carregar OP".',
        preencher: ['OP de PI para produto intermediário; OP de PA para a célula final'], obrig: ['OP'], erros: ['Apontar na OP errada (PA × PI).'], prox: 'q_tempo' }),
      q_tempo: P('Vai registrar o tempo da máquina em tempo real (iniciar agora e finalizar no fim)?', { sim: 'p_real', nao: 'p_informado' }),
      p_real: Ps('Iniciar e finalizar na máquina', { tela: 'producao', destacar: '▶ Iniciar na máquina',
        preencher: ['Etapa / máquina e Operador', '"▶ Iniciar na máquina" no começo', '"■ Finalizar na máquina" no fim'],
        destino: 'Tempo real por máquina × planejado (relatórios de tempo e calendário executado).', erros: ['Esquecer de finalizar: o tempo fica aberto.'], prox: 'p_qtd' }),
      p_informado: Ps('Informar início e fim', { tela: 'producao', destacar: 'Registrar intervalo informado (início e fim)', preencher: ['Etapa / máquina e Operador', 'Data e hora de início e de fim', 'Observação'], prox: 'p_qtd' }),
      p_qtd: Ps('Registrar a quantidade e as etiquetas', { tela: 'producao', destacar: 'Registrar produção e etiquetas',
        preencher: ['Produto apontado, Data e Operador', 'Etapa / processo', 'Quantidade real produzida (na unidade do produto)', 'Itens em un: uma etiqueta por un, aglutinar ou N por etiqueta', 'Observações'],
        obrig: ['Quantidade real produzida'], destino: 'Saldo de PI/PA (etiquetas), situação da OP, custo e ACV pela produção real.',
        erros: ['Quantidade em outra unidade.', 'Não imprimir a etiqueta: o PI não é achado na operação seguinte.'], prox: 'fim' }),
      fim: E({ checklist: ['Quantidade e unidade conferidas', 'Etiquetas impressas', 'Tempo por máquina registrado', 'Consumos de materiais e PIs feitos'], proximos: ['consumir_materiais', 'registrar_perda', 'encerrar_op'] })
    }
  });

  fluxo('consumir_materiais', {
    titulo: 'Consumir materiais e PIs na OP (lote, etiqueta e devolução)', grupo: 'Produção',
    resumo: 'Baixa do estoque o lote ou a etiqueta usados em cada OP — base do custo efetivo, do ACV e da rastreabilidade.',
    sinonimos: ['consumo', 'consumir', 'baixar material', 'retirada', 'devolucao', 'lote utilizado', 'consumir pi', 'requisicao', 'picking', 'usar material', 'sobra de material'],
    inicio: 'q_saldo',
    nos: {
      q_saldo: P('Há saldo do material no estoque?', { chk: 'lotes_saldo', decide: true, sim: 'q_pi', nao: { fluxo: 'entrada_material', volta: 'q_pi' } }),
      q_pi: P('O que vai consumir é um PI (produto intermediário de outra OP)?', { sim: 'q_pi_ok', nao: 'p_mat' }),
      p_mat: Ps('Consumir o material pelo lote', { tela: 'producao', destacar: 'Registrar consumo do lote', ctx: 'op', texto: 'Carregue a OP e vá em "Consumo de materiais e lotes".',
        preencher: ['▮▯▮ Ler o código do material ou da etiqueta do lote', 'Material previsto na OP e Lote / entrada utilizada', 'Quantidade retirada e Quantidade devolvida', 'Data e Operador'], obrig: ['Lote', 'Quantidade retirada'],
        destino: 'Saldo do lote, custo efetivo da OP (valor unitário do lote), massa do ACV e rastreabilidade do passaporte.',
        erros: ['Lote errado.', 'Não registrar a devolução da sobra.', 'Consumir na OP de PA um material que é da OP de PI.'], prox: 'fim' }),
      q_pi_ok: P('O PI de origem já foi apontado (tem etiqueta com saldo)?', { chk: 'pi_apontados', sim: 'p_pi', nao: { fluxo: 'apontar_producao', volta: 'p_pi' } }),
      p_pi: Ps('Consumir o PI pela etiqueta', { tela: 'producao', destacar: 'Registrar consumo do PI', ctx: 'op', texto: 'Carregue a OP e vá em "Consumo de PIs (produtos intermediários) nesta OP".',
        preencher: ['▮▯▮ Ler a etiqueta do PI', 'PI e Etiqueta / lote de origem', 'Máquina onde entra', 'Quantidade consumida e a perdida na etapa (categoria e motivo)'],
        destino: 'Saldo do PI (Estoque PI / PA); custo e CO₂ do PI chegam ao PA sem dupla contagem.', erros: ['Consumir PI de outra família de OPs.'], prox: 'fim' }),
      fim: E({ checklist: ['Lote ou etiqueta certos', 'Devolução registrada', 'Saldo conferido'], proximos: ['registrar_perda', 'encerrar_op'] })
    }
  });

  fluxo('registrar_perda', {
    titulo: 'Registrar uma perda ou refugo', grupo: 'Produção',
    resumo: 'Perda de produto ou de material com etapa, máquina, categoria e motivo — entra no custo e no CO₂.',
    sinonimos: ['perda', 'perdas', 'refugo', 'sucata', 'retrabalho', 'nao conformidade', 'descarte', 'scrap', 'motivo de perda', 'quebra', 'defeito'],
    inicio: 'q_mot',
    nos: {
      q_mot: P('O motivo da perda já existe em Produção › Motivos de Perda?', { chk: 'motivos', decide: true, sim: 'p_perda', nao: 'p_mot' }),
      p_mot: Ps('Cadastrar o motivo', { tela: 'perdas_motivos', destacar: '+ Novo motivo', texto: '"Carregar sugestões padrão" cria uma lista inicial de motivos.',
        preencher: ['Categoria', 'Motivo', 'Descrição / como identificar (opcional)', 'Situação'], obrig: ['Categoria', 'Motivo'],
        destino: 'Lista suspensa do Registro de Perdas e relatórios de perdas por motivo.', prox: 'p_perda' }),
      p_perda: Ps('Registrar a perda', { tela: 'perdas', destacar: 'Registrar perda', ctx: 'op',
        preencher: ['OP ("Carregar OP")', 'Tipo de perda (Produto ou Material) e o item', 'Etapa / processo (máquina)', 'Categoria e Motivo', 'Quantidade real perdida (unidade automática)', 'Origem da quantidade e Etiqueta / lote', 'Data, Operador e Observações'],
        obrig: ['Tipo', 'Item', 'Quantidade', 'Motivo'], destino: 'Saldo da OP no encerramento, custo e CO₂ das perdas e relatório de perdas por etapa e equipamento.',
        erros: ['Perda de material lançada como produto.', 'Perda já descontada no consumo (dupla contagem).', 'Quantidade em outra unidade.'], prox: 'fim' }),
      fim: E({ checklist: ['Categoria e motivo corretos', 'Quantidade na unidade certa', 'Etiqueta ou lote informados'], proximos: ['encerrar_op', 'relatorio'] })
    }
  });

  fluxo('encerrar_op', {
    titulo: 'Encerrar a OP (fechar custo e saldo)', grupo: 'Produção',
    resumo: 'Congela o custo da família, libera o ACV e o passaporte. Pode ser reaberta se precisar.',
    sinonimos: ['encerrar', 'encerrar op', 'fechar op', 'concluir op', 'finalizar ordem', 'checklist de encerramento', 'reabrir op', 'fechar ordem'],
    inicio: 'q_prod',
    nos: {
      q_prod: P('Toda a produção da OP foi apontada?', { sim: 'q_cons', nao: { fluxo: 'apontar_producao', volta: 'q_cons' } }),
      q_cons: P('Os consumos de materiais e PIs e as perdas foram registrados?', { sim: 'q_filhas', nao: { fluxo: 'consumir_materiais', volta: 'q_filhas' } }),
      q_filhas: P('As OPs de PI (filhas) da família já estão encerradas? Responda Sim se esta OP for de PI.', { sim: 'p_enc', nao: 'p_filhas',
        ajuda: 'O custo e o CO₂ dos PIs sobem para o PA: encerre as OPs de PI antes da OP de PA.' }),
      p_filhas: Ps('Encerrar primeiro as OPs de PI', { tela: 'op', destacar: 'Encerrar OP', texto: 'Selecione cada OP de PI da família e encerre (uma por vez) antes da OP de PA.', prox: 'p_enc' }),
      p_enc: Ps('Encerrar a OP', { tela: 'op', destacar: 'Encerrar OP', ctx: 'op', texto: 'Selecione a OP, confira o "Checklist de encerramento" e clique em "Encerrar OP".',
        preencher: ['Checklist: produção, consumos, perdas e saldo', '"Encerrar OP"'],
        destino: 'Custo consolidado e congelado (Custos Industriais), ACV da família, saldo de PI/PA e Passaporte.', erros: ['Encerrar com saldo pendente ou sem as perdas.'], prox: 'p_reabrir' }),
      p_reabrir: Ps('Se precisar corrigir depois', { tela: 'op', destacar: 'Reabrir OP', texto: '"Reabrir OP" permite novos apontamentos; ao encerrar de novo, custo e ACV são recalculados.', prox: 'fim' }),
      fim: E({ checklist: ['Produção, consumos e perdas completos', 'OPs de PI encerradas antes da OP de PA', 'OP com situação Concluída'], proximos: ['custo_op', 'calcular_acv'] })
    }
  });

  /* ---- Planejamento ---- */
  fluxo('mrp', {
    titulo: 'Rodar o MRP (o que comprar)', grupo: 'Planejamento',
    resumo: 'Necessidade de materiais das OPs abertas contra o saldo do estoque, com a lista de compras.',
    sinonimos: ['mrp', 'compras', 'comprar', 'necessidade', 'falta de material', 'o que comprar', 'planejamento de materiais', 'lista de compras', 'requisicao de compra'],
    inicio: 'q_ops',
    nos: {
      q_ops: P('As OPs que você quer planejar estão abertas?', { chk: 'ops_abertas', decide: true, sim: 'p_mrp', nao: { fluxo: 'abrir_op', volta: 'p_mrp' } }),
      p_mrp: Ps('Calcular o MRP', { tela: 'mrp', destacar: 'Recalcular MRP', preencher: ['Marque as OPs em "Incluir" (ou "Selecionar todas")', '"Recalcular MRP"', '"Ver cálculo" mostra a memória de cada material'],
        destino: 'Necessidade líquida = necessidade bruta − saldo físico do estoque; alerta de estoque mínimo.', erros: ['Deixar OPs de fora da seleção.', 'Material com unidade diferente da do roteiro.'], prox: 'p_compras' }),
      p_compras: Ps('Gerar a lista de compras', { tela: 'mrp', destacar: 'Excel Compras', preencher: ['"Excel Compras" ou "PDF Compras"'], prox: 'fim' }),
      fim: E({ checklist: ['OPs certas incluídas', 'Necessidades líquidas conferidas', 'Lista de compras enviada'], proximos: ['entrada_material', 'calendario'] })
    }
  });

  fluxo('calendario', {
    titulo: 'Programar a produção no calendário', grupo: 'Planejamento',
    resumo: 'Datas de cada etapa e máquina das OPs, respeitando capacidade e indisponibilidades.',
    sinonimos: ['calendario', 'programacao', 'programar', 'agenda', 'sequenciar', 'datas', 'planejar producao', 'gantt', 'editar dia', 'conflito', 'indisponibilidade', 'manutencao', 'feriado'],
    inicio: 'q_cap',
    nos: {
      q_cap: P('As máquinas têm capacidade configurada (Capacidades das máquinas)?', { chk: 'capacidades', decide: true, sim: 'p_sug', nao: { fluxo: 'carga_capacidade', volta: 'p_sug' } }),
      p_sug: Ps('Sugerir a programação', { tela: 'pcp_calendario', destacar: 'Sugerir programação por data inicial',
        preencher: ['Filtros de projeto e linha de produção', '"Sugerir programação por data inicial"', 'Ajustes com "Editar dia"', '"Validar conflitos"'],
        destino: 'Programação das OPs por etapa e máquina; operações executadas ficam congeladas em cinza.', erros: ['Programar em dia indisponível.'], prox: 'p_salvar' }),
      p_salvar: Ps('Salvar o calendário', { tela: 'pcp_calendario', destacar: '💾 Salvar calendário', preencher: ['"💾 Salvar calendário"', '"Excel período" ou "PDF período"'], prox: 'p_indisp' }),
      p_indisp: Ps('Registrar indisponibilidades', { tela: 'pcp_capacidade', destacar: 'Salvar indisponibilidade', texto: 'Manutenção, feriado ou parada: informe Recurso, Data, Início, Fim e Motivo.', prox: 'fim' }),
      fim: E({ checklist: ['Sem conflitos', 'Calendário salvo', 'Indisponibilidades registradas'], proximos: ['carga_capacidade', 'apontar_producao'] })
    }
  });

  fluxo('carga_capacidade', {
    titulo: 'Conferir a carga × capacidade das máquinas', grupo: 'Planejamento',
    resumo: 'Horas disponíveis × horas programadas por máquina: mostra os gargalos.',
    sinonimos: ['capacidade', 'carga', 'carga x capacidade', 'ocupacao', 'gargalo', 'horas disponiveis', 'eficiencia', 'capacidades das maquinas', 'batelada', 'ciclo'],
    inicio: 'q_cfg',
    nos: {
      q_cfg: P('As capacidades das máquinas estão configuradas?', { chk: 'capacidades', decide: true, sim: 'p_carga', nao: 'p_cfg' }),
      p_cfg: Ps('Configurar as capacidades', { tela: 'pcp_capacidade', destacar: 'Capacidades das máquinas',
        texto: 'Clique em "Configurar" em cada máquina. Para muitas máquinas use a planilha de importação de equipamentos (colunas laranja).',
        preencher: ['Operação, capacidade física e unidade', 'Tempo de ciclo (batelada) e setup', 'Horas por dia útil, eficiência (%) e operações simultâneas'],
        obrig: ['Capacidade maior que zero', 'Horas por dia', 'Eficiência'], destino: 'Carga × capacidade e Calendário.', prox: 'p_carga' }),
      p_carga: Ps('Ver a carga × capacidade', { tela: 'pcp_capacidade', destacar: 'Carga × capacidade', preencher: ['Período', 'Horas nominais, efetivas, carga e ocupação (%)'],
        destino: 'Máquina acima de 100% de ocupação é gargalo: replaneje no Calendário.', prox: 'fim' }),
      fim: E({ checklist: ['Máquinas do roteiro configuradas', 'Gargalos identificados'], proximos: ['calendario'] })
    }
  });

  /* ---- Custos, ACV e Passaporte ---- */
  fluxo('custo_op', {
    titulo: 'Ver o custo fechado da OP', grupo: 'Custos, ACV e Passaporte',
    resumo: 'Custo da família (materiais, energia, MOD e perdas) congelado no encerramento, com o Excel auditável.',
    sinonimos: ['custo', 'custos', 'custo da op', 'quanto custou', 'custo unitario', 'custo por wh', 'excel auditavel', 'mod', 'energia', 'custo industrial'],
    inicio: 'q_enc',
    nos: {
      q_enc: P('A OP de PA está encerrada?', { chk: 'custos', sim: 'p_custo', nao: { fluxo: 'encerrar_op', volta: 'p_custo' }, ajuda: 'O custo só existe depois do encerramento: é calculado e congelado nessa hora.' }),
      p_custo: Ps('Abrir o custo fechado', { tela: 'custos', destacar: 'Carregar custo fechado', ctx: 'op_pa', texto: 'O custo é consolidado (OP de PA + OPs de PI) e congelado no encerramento: esta tela não recalcula.',
        preencher: ['OP / escopo', '"Carregar custo fechado"', '"Exportar Excel auditável" (memória de cálculo)'], destino: 'Simulações, LCC e Passaporte.',
        erros: ['Procurar o custo de uma OP aberta.'], prox: 'fim' }),
      fim: E({ checklist: ['Materiais, energia, MOD e perdas conferidos', 'Excel auditável salvo'], proximos: ['calcular_acv', 'relatorio'] })
    }
  });

  fluxo('calcular_acv', {
    titulo: 'Calcular a pegada de carbono (ACV) da OP', grupo: 'Custos, ACV e Passaporte',
    resumo: 'CO₂eq da família de OPs: materiais consumidos, perdas reais e energia das máquinas.',
    sinonimos: ['acv', 'co2', 'carbono', 'pegada', 'pegada de carbono', 'emissoes', 'sustentabilidade', 'ciclo de vida', 'gwp', 'fator de emissao', 'fatores ambientais', 'biblioteca ambiental', 'icv', 'aicv'],
    inicio: 'q_enc',
    nos: {
      q_enc: P('A OP de PA está encerrada?', { chk: 'ops_pa_fechadas', sim: 'q_fat', nao: { fluxo: 'encerrar_op', volta: 'q_fat' }, ajuda: 'Encerrada, a OP tem todos os consumos e perdas: o ACV fica completo.' }),
      q_fat: P('Os materiais têm fator de emissão (Biblioteca Ambiental / Fatores)?', { chk: 'fatores', decide: true, sim: 'p_acv', nao: 'p_fat' }),
      p_fat: Ps('Importar os fatores ambientais', { tela: 'acv', destacar: 'Biblioteca Ambiental',
        texto: 'Em "Biblioteca Ambiental": "Baixar template Excel (com exemplo)", preencha e "Validar e importar". Um fator avulso: aba "Fatores" → "Salvar fator".',
        preencher: ['Material, categoria (Mudanças climáticas), fator e unidade', 'Dataset / fonte, versão, região e ano'], obrig: ['Material', 'Fator', 'Unidade'],
        destino: 'CO₂eq dos materiais consumidos e das perdas.', erros: ['Fator em g no lugar de kg CO₂eq.'], prox: 'p_acv' }),
      p_acv: Ps('Calcular o ACV da OP', { tela: 'sustentabilidade', destacar: 'Calcular / atualizar ACV', ctx: 'op_pa',
        preencher: ['OP mãe / PA', 'Fator de energia (matriz elétrica)', '"Calcular / atualizar ACV"', '"Auditoria CO₂ / perdas" e "Excel auditável ACV"'],
        destino: 'CO₂eq da família (materiais + perdas reais + energia), usado no Passaporte e no Dashboard.', erros: ['Calcular antes de lançar todas as perdas.'], prox: 'q_estudo' }),
      q_estudo: P('Precisa do estudo completo (ICV, cenários e AICV)?', { sim: 'p_estudo', nao: 'fim' }),
      p_estudo: Ps('Estudo de ACV completo', { tela: 'acv', destacar: 'ICV',
        texto: '"ICV": escolha a OP, "Carregar / validar" e "Salvar ICV desta OP". "Cenários": multiplicadores e fator de energia. "AICV": estudo + cenário → "Calcular AICV". No topo: "Relatório PDF" e "Excel completo".', prox: 'fim' }),
      fim: E({ checklist: ['Fatores de todos os materiais', 'ACV calculado na OP mãe', 'Excel auditável salvo'], proximos: ['passaporte'] })
    }
  });

  fluxo('passaporte', {
    titulo: 'Publicar o passaporte da bateria', grupo: 'Custos, ACV e Passaporte',
    resumo: 'Puxa da OP a estrutura, os lotes, os fornecedores e o CO₂; publica o painel do cliente com QR e etiqueta.',
    sinonimos: ['passaporte', 'battery passport', 'bp', 'qr code', 'qr', 'etiqueta da bateria', 'cliente', 'publicar', 'dpp', 'passaporte digital'],
    inicio: 'q_acv',
    nos: {
      q_acv: P('A OP de PA está encerrada e com o ACV calculado?', { chk: 'acv_calculados', sim: 'p_bp', nao: { fluxo: 'calcular_acv', volta: 'p_bp' } }),
      p_bp: Ps('Criar o passaporte', { tela: 'bp', destacar: '+ Novo passaporte',
        preencher: ['OP vinculada', '"⟳ Atualizar com os dados da OP" (estrutura, lotes, fornecedores, CO₂)', 'Cliente, fabricante e responsável', 'Dados técnicos e de sustentabilidade', '"mostrar no painel" no que vai para o cliente'],
        obrig: ['OP vinculada (o rascunho pode ficar incompleto)'], destino: 'Painel do cliente (QR), PDF e etiqueta 90 × 150 mm.', erros: ['Publicar sem atualizar com os dados da OP.'], prox: 'p_pub' }),
      p_pub: Ps('Publicar e imprimir', { tela: 'bp', destacar: 'Atualizar HTML / QR', preencher: ['"Salvar BP"', '"Atualizar HTML / QR" e "Copiar link/QR"', '"Imprimir etiqueta 90 × 150 mm"', '"PDF do passaporte"'], prox: 'fim' }),
      fim: E({ checklist: ['Dados da OP atualizados', 'Campos do painel escolhidos', 'QR testado', 'Etiqueta impressa'], proximos: ['dossie'] })
    }
  });

  /* ---- Relatórios ---- */
  fluxo('relatorio', {
    titulo: 'Exportar um relatório para o Excel', grupo: 'Relatórios',
    resumo: 'Relatórios prontos de todos os módulos, com filtros, prévia na tela e Excel.',
    sinonimos: ['relatorio', 'relatorios', 'excel', 'exportar', 'planilha', 'listagem', 'consulta', 'extrair dados', 'modelo de relatorio', 'meus modelos'],
    inicio: 'p_cat',
    nos: {
      p_cat: Ps('Escolher o relatório', { tela: 'relatorios', texto: 'Busque no catálogo ou filtre o módulo e clique em "Abrir". "Excel (tudo)" exporta sem filtros.',
        preencher: ['Filtros: período, OP, produto, situação e busca', 'Colunas e ordem', 'Prévia na tela'], prox: 'p_exp' }),
      p_exp: Ps('Exportar e salvar como modelo', { tela: 'relatorios', texto: '"⬇ Excel" gera o .xlsx (números como número, totais e a aba Parâmetros). "⭐ Salvar como modelo" guarda filtros e colunas em Meus modelos.', prox: 'fim' }),
      fim: E({ checklist: ['Filtros conferidos na prévia', 'Excel salvo'], proximos: ['dossie'] })
    }
  });

  fluxo('dossie', {
    titulo: 'Gerar o dossiê da OP', grupo: 'Relatórios',
    resumo: 'Uma planilha com tudo da OP ou da família: produção, etiquetas, lotes, PIs, tempos, perdas, custo, CO₂ e rastreabilidade.',
    sinonimos: ['dossie', 'dossie da op', 'historico completo da op', 'tudo da op', 'rastreabilidade completa', 'auditoria da op', 'relatorio da op'],
    inicio: 'p_dos',
    nos: {
      p_dos: Ps('Gerar o dossiê', { tela: 'relatorios_dossie', destacar: '⬇ Gerar dossiê (Excel)', ctx: 'op',
        preencher: ['OP (digite, escolha ou leia o código de barras)', 'Conteúdo: Família inteira (OP de PA + OPs de PI) ou Só esta OP'], obrig: ['OP'],
        destino: 'Planilha com produção, etiquetas, saldos, materiais e lotes, PIs, tempos, perdas, custo, CO₂ e rastreabilidade.', prox: 'fim' }),
      fim: E({ checklist: ['OP certa', 'Conteúdo escolhido', 'Dossiê salvo'], proximos: ['relatorio'] })
    }
  });

  /* ---- Administração ---- */
  fluxo('usuarios', {
    titulo: 'Criar um usuário e definir o perfil', grupo: 'Administração',
    resumo: 'Login individual de cada pessoa: o Histórico de Modificações mostra quem fez cada alteração.',
    sinonimos: ['usuario', 'usuarios', 'senha', 'acesso', 'login', 'perfil', 'permissao', 'novo colaborador', 'criar usuario', 'trocar senha'],
    inicio: 'q_adm',
    nos: {
      q_adm: P('Você entrou como administrador?', { chk: 'admin', decide: true, sim: 'p_user', nao: 'fim_sem' }),
      p_user: Ps('Criar o usuário', { tela: 'usuarios', destacar: '+ Novo usuário', preencher: ['Usuário (login)', 'Nome completo', 'Senha inicial', 'Perfil: ADMIN ou USER', 'Ativo'], obrig: ['Usuário', 'Senha', 'Perfil'],
        destino: 'Login no MES e Histórico de Modificações (cada alteração com o usuário).', erros: ['O mesmo usuário para várias pessoas: o histórico perde quem fez.', 'Perfil ADMIN sem necessidade.'], prox: 'fim' }),
      fim: E({ checklist: ['Usuário individual', 'Perfil certo', 'Senha entregue com segurança'], proximos: ['historico'] }),
      fim_sem: E({ texto: 'Só o administrador cria usuários: peça a ele.', checklist: ['Pedi o acesso ao administrador'], proximos: [] })
    }
  });

  fluxo('historico', {
    titulo: 'Conferir quem alterou o quê (Histórico de Modificações)', grupo: 'Administração',
    resumo: 'Data, usuário, módulo e registro de cada alteração.',
    sinonimos: ['historico', 'auditoria', 'quem alterou', 'log', 'rastreio de alteracoes', 'historico de modificacoes', 'quem mudou'],
    inicio: 'p_hist',
    nos: {
      p_hist: Ps('Abrir o Histórico de Modificações', { tela: 'auditoria', texto: 'Data/hora, usuário, módulo, ação e registro de cada alteração. Para um período, use Relatórios › 🛡️ Auditoria.', prox: 'fim' }),
      fim: E({ checklist: ['Encontrei a alteração que procurava'], proximos: ['relatorio'] })
    }
  });

  fluxo('backup', {
    titulo: 'Fazer uma cópia de segurança do banco', grupo: 'Administração',
    resumo: 'Cópia dos dados antes de mudanças grandes (o MES também copia antes de importar e de aplicar inventário).',
    sinonimos: ['backup', 'copia de seguranca', 'salvar banco', 'exportar banco', 'importar banco', 'restaurar', 'pasta de dados'],
    inicio: 'p_bk',
    nos: {
      p_bk: Ps('Criar a cópia de segurança', { tela: 'topo', destacar: '.v40-db-advanced > summary',
        texto: 'No topo da tela: "Banco ▾" → "Criar backup". "Exportar banco" baixa uma cópia; "Importar banco" restaura uma cópia (substitui os dados atuais).',
        erros: ['Usar "Importar banco" ou "Restaurar dados iniciais" sem querer: os dados atuais são substituídos (o MES faz uma cópia antes).'], prox: 'fim' }),
      fim: E({ checklist: ['Backup criado antes da mudança'], proximos: ['historico'] })
    }
  });

  var TRILHAS = [
    { id: 'Operador', icone: '👷', desc: 'Receber material, apontar a produção, consumir lotes e PIs, registrar perdas.', fluxos: ['entrada_material', 'saldo_estoque', 'apontar_producao', 'consumir_materiais', 'registrar_perda', 'ajuste_estoque'] },
    { id: 'PCP', icone: '📅', desc: 'Abrir OPs, MRP, capacidade, calendário, encerramento e custos.', fluxos: ['abrir_op', 'mrp', 'carga_capacidade', 'calendario', 'apontar_producao', 'encerrar_op', 'inventario', 'custo_op', 'relatorio'] },
    { id: 'Engenharia', icone: '🧩', desc: 'Cadastros-base: processos, materiais, máquinas, estrutura, roteiro e formulação.', fluxos: ['cad_processo', 'cad_material', 'cad_equipamento', 'cad_estrutura', 'roteiro', 'formulacao', 'abrir_op'] },
    { id: 'Qualidade/ACV', icone: '🌱', desc: 'Perdas, encerramento, custo, pegada de carbono, passaporte e dossiê.', fluxos: ['registrar_perda', 'encerrar_op', 'custo_op', 'calcular_acv', 'passaporte', 'dossie', 'historico'] },
    { id: 'Administrador', icone: '🔐', desc: 'Usuários, cópia de segurança, histórico, cadastros e inventário.', fluxos: ['usuarios', 'backup', 'historico', 'cad_processo', 'cad_material', 'cad_equipamento', 'inventario', 'relatorio'] }
  ];
  function trilha(id) { return TRILHAS.find(function (t) { return t.id === id; }) || null; }
  /* as trilhas são a fonte: cada objetivo sabe em quais trilhas está */
  ORDEM.forEach(function (id) { FLUXOS[id].perfis = TRILHAS.filter(function (t) { return t.fluxos.indexOf(id) >= 0; }).map(function (t) { return t.id; }); });

  /* conferência da estrutura dos objetivos (usada nos testes): destinos existem, todo nó é alcançável e todo caminho termina */
  function validarFluxos() {
    var erros = [];
    var alvoOk = function (f, a, onde) {
      if (typeof a === 'string') { if (!f.nos[a]) erros.push(f.id + '.' + onde + ': nó "' + a + '" não existe'); return; }
      if (!a || !a.fluxo || !FLUXOS[a.fluxo]) { erros.push(f.id + '.' + onde + ': objetivo de destino inválido'); return; }
      if (a.fluxo === f.id) erros.push(f.id + '.' + onde + ': desvio para o próprio objetivo');
      if (a.volta && !f.nos[a.volta]) erros.push(f.id + '.' + onde + ': volta "' + a.volta + '" não existe');
    };
    ORDEM.forEach(function (id) {
      var f = FLUXOS[id];
      if (!f.titulo || !f.grupo || !GRUPOS.some(function (g) { return g.id === f.grupo; })) erros.push(id + ': título ou grupo inválido');
      if (!A(f.sinonimos).length) erros.push(id + ': sem sinônimos');
      if (!A(f.perfis).length) erros.push(id + ': fora de todas as trilhas');
      if (!f.nos[f.inicio]) erros.push(id + ': início inexistente');
      Object.keys(f.nos).forEach(function (k) {
        var n = f.nos[k];
        if (n.tipo === 'pergunta') { alvoOk(f, n.sim, k + '.sim'); alvoOk(f, n.nao, k + '.nao'); if (n.chk && !CHK[n.chk]) erros.push(id + '.' + k + ': checagem "' + n.chk + '" inexistente'); }
        else if (n.tipo === 'passo') { alvoOk(f, n.prox, k + '.prox'); if (n.tela && !TELAS[n.tela]) erros.push(id + '.' + k + ': tela "' + n.tela + '" sem nome'); }
        else if (n.tipo === 'fim') { if (!A(n.checklist).length) erros.push(id + '.' + k + ': fim sem checklist'); A(n.proximos).forEach(function (p) { if (!FLUXOS[p]) erros.push(id + '.' + k + ': próximo "' + p + '" inexistente'); }); }
        else erros.push(id + '.' + k + ': tipo inválido');
      });
      /* alcançáveis a partir do início; de cada nó dá para chegar a um fim (ou sair para outro objetivo) */
      var vistos = {}, fila = [f.inicio];
      while (fila.length) {
        var k = fila.shift(); if (vistos[k] || !f.nos[k]) continue; vistos[k] = 1;
        var n = f.nos[k];
        [n.sim, n.nao, n.prox].forEach(function (a) { if (typeof a === 'string') fila.push(a); else if (a && a.volta) fila.push(a.volta); });
      }
      Object.keys(f.nos).forEach(function (k) { if (!vistos[k]) erros.push(id + '.' + k + ': nó inalcançável'); });
      var termina = {}, mudou = true;
      while (mudou) {
        mudou = false;
        Object.keys(f.nos).forEach(function (k) {
          if (termina[k]) return;
          var n = f.nos[k], ok = n.tipo === 'fim' || [n.sim, n.nao, n.prox].some(function (a) { return a && (typeof a === 'string' ? termina[a] : (!a.volta || termina[a.volta])); });
          if (ok) { termina[k] = 1; mudou = true; }
        });
      }
      Object.keys(f.nos).forEach(function (k) { if (!termina[k]) erros.push(id + '.' + k + ': caminho sem fim'); });
    });
    TRILHAS.forEach(function (t) { t.fluxos.forEach(function (x) { if (!FLUXOS[x]) erros.push('trilha ' + t.id + ': objetivo "' + x + '" inexistente'); }); });
    return erros;
  }

  /* ---------------------------------------------------------------------
     4) BUSCA POR OBJETIVO (título, sinônimos, grupo e passos; sem acento e sem maiúsculas)
     --------------------------------------------------------------------- */
  var PARADAS = ['o', 'a', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'um', 'uma', 'como', 'fazer', 'faco', 'quero', 'para', 'pra', 'no', 'na', 'nos', 'nas', 'e', 'em', 'eu', 'meu', 'minha', 'que', 'se', 'por', 'com', 'onde', 'qual', 'preciso', 'ver', 'o que'];
  function tokens(s) { return chave(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(function (t) { return t.length > 1 && PARADAS.indexOf(t) < 0; }); }
  var INDICE = null;
  function indice() {
    if (INDICE) return INDICE;
    INDICE = ORDEM.map(function (id) {
      var f = FLUXOS[id], passos = Object.keys(f.nos).map(function (k) { return f.nos[k].titulo || ''; }).join(' ');
      var frases = [chave(f.titulo)].concat(A(f.sinonimos).map(chave));
      return { id: id, frases: frases, palavras: tokens([f.titulo, f.sinonimos.join(' '), f.grupo, f.resumo, passos].join(' ')) };
    });
    return INDICE;
  }
  /* pontos por palavra: igual ao título/sinônimo 4, começo 3, no texto 2 ou 1; palavras raras (que aparecem em poucos objetivos) valem mais */
  function buscar(q) {
    var qt = tokens(q), qc = chave(q).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!qt.length) return [];
    var idx = indice(), tab = idx.map(function (x) {
      return qt.map(function (t) {
        var melhor = 0;
        x.frases.forEach(function (f) { f.split(' ').forEach(function (w) { if (w === t) melhor = Math.max(melhor, 4); else if (t.length > 2 && w.indexOf(t) === 0) melhor = Math.max(melhor, 3); }); });
        if (!melhor) x.palavras.forEach(function (w) { if (w === t) melhor = Math.max(melhor, 2); else if (t.length > 3 && (w.indexOf(t) === 0 || t.indexOf(w) === 0 && w.length > 3)) melhor = Math.max(melhor, 1); });
        return melhor;
      });
    });
    var df = qt.map(function (t, j) { return tab.filter(function (l) { return l[j] > 0; }).length; });
    return idx.map(function (x, i) {
      var p = 0, achou = 0;
      if (qc.length > 3 && x.frases.some(function (f) { return f.indexOf(qc) >= 0; })) p += 8;
      tab[i].forEach(function (m, j) { if (m) { achou++; p += m * (1 + Math.log(idx.length / Math.max(1, df[j]))); } });
      if (achou < Math.ceil(qt.length / 2)) p = 0;
      return { id: x.id, pontos: p };
    }).filter(function (r) { return r.pontos > 0; }).sort(function (a, b) { return b.pontos - a.pontos || ORDEM.indexOf(a.id) - ORDEM.indexOf(b.id); }).slice(0, 8);
  }

  /* ---------------------------------------------------------------------
     5) PROGRESSO POR USUÁRIO (data.helpdesk_progresso) E "NÃO ENCONTREI" (data.helpdesk_buscas)
     --------------------------------------------------------------------- */
  function registroProgresso(criar) {
    var d = D(); if (!d) return null;
    if (!Array.isArray(d.helpdesk_progresso)) { if (!criar) return null; d.helpdesk_progresso = []; }
    var u = usuario(), r = d.helpdesk_progresso.find(function (x) { return x && x.Usuario === u; });
    if (!r && criar) { r = { Usuario: u, Nome: usuarioNome(), Trilha: '', Fluxos: {}, Criado: agoraISO(), Atualizado: agoraISO() }; d.helpdesk_progresso.push(r); }
    if (r && (!r.Fluxos || typeof r.Fluxos !== 'object')) r.Fluxos = {};
    return r;
  }
  function concluido(id) { var r = registroProgresso(false); return !!(r && r.Fluxos[id] && r.Fluxos[id].Concluido); }
  function trilhaAtual() { var r = registroProgresso(false); return (r && r.Trilha) || ''; }
  function escolherTrilha(id) {
    if (!trilha(id)) return;
    var r = registroProgresso(true); r.Trilha = id; r.Atualizado = agoraISO(); r.Nome = usuarioNome();
    salvar();
  }
  function marcarConcluido(id, itens) {
    var r = registroProgresso(true), f = r.Fluxos[id] || { Vezes: 0 };
    f.Concluido = agoraISO(); f.Vezes = (f.Vezes || 0) + 1; f.Checklist = itens || [];
    r.Fluxos[id] = f; r.Atualizado = agoraISO(); r.Nome = usuarioNome(); r.Ultimo = id;
    salvar();
  }
  function progressoTrilha(id, reg) {
    var t = trilha(id); if (!t) return { feitos: 0, total: 0 };
    var r = reg || registroProgresso(false), feitos = t.fluxos.filter(function (x) { return r && r.Fluxos && r.Fluxos[x] && r.Fluxos[x].Concluido; }).length;
    return { feitos: feitos, total: t.fluxos.length };
  }
  function registrarNaoEncontrei(termo, comentario) {
    var d = D(); if (!d) return null;
    d.helpdesk_buscas = A(d.helpdesk_buscas);
    var f = S.fluxo ? FLUXOS[S.fluxo] : null, no = f ? f.nos[S.no] : null;
    var reg = { IdBusca: 'HDB-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(), Data: agoraISO(), Usuario: usuario(), Nome: usuarioNome(),
      Termo: txt(termo).slice(0, 300), Comentario: txt(comentario).slice(0, 1000), Caminho: f ? f.titulo + (no ? ' › ' + (no.titulo || no.texto || 'Checklist final') : '') : '(início do assistente)',
      Tela: S.telaOrigem || telaAtual(), Trilha: trilhaAtual() };
    d.helpdesk_buscas.push(reg);
    if (d.helpdesk_buscas.length > 2000) d.helpdesk_buscas.splice(0, d.helpdesk_buscas.length - 2000);
    salvar();
    return reg;
  }

  /* ---------------------------------------------------------------------
     6) ESTADO DO ASSISTENTE (posição guardada no navegador, por usuário)
     --------------------------------------------------------------------- */
  var S = { vista: 'inicio', fluxo: '', no: '', hist: [], pilha: [], marcados: {}, ctx: { op: '' }, q: '', telaOrigem: '', dock: false, minimizado: false, concluiuAgora: '' };
  function chavePos() { return 'MES_HD_ASSISTENTE_' + usuario(); }
  function guardarPosicao() {
    try {
      if (!S.fluxo) localStorage.removeItem(chavePos());
      else localStorage.setItem(chavePos(), JSON.stringify({ fluxo: S.fluxo, no: S.no, pilha: S.pilha, hist: S.hist.slice(-30), ctx: S.ctx, quando: agoraISO() }));
    } catch (e) { }
  }
  function lerPosicao() {
    try { var p = JSON.parse(localStorage.getItem(chavePos()) || 'null'); if (p && FLUXOS[p.fluxo] && FLUXOS[p.fluxo].nos[p.no]) return p; } catch (e) { }
    return null;
  }
  function noAtual() { var f = FLUXOS[S.fluxo]; return f ? f.nos[S.no] : null; }
  function foto() { return { fluxo: S.fluxo, no: S.no, pilha: JSON.parse(JSON.stringify(S.pilha)) }; }
  /* desvio = true: veio de uma resposta (o caminho e a volta já foram guardados por quem chamou) */
  function iniciar(id, desvio) {
    if (!FLUXOS[id]) return;
    if (!desvio) { S.hist = []; S.pilha = []; }
    S.fluxo = id; S.no = FLUXOS[id].inicio; S.vista = 'fluxo'; S.marcados = {}; S.concluiuAgora = '';
    guardarPosicao(); mostrar();
  }
  function seguir(alvo) {
    if (!alvo || !S.fluxo) return;
    S.hist.push(foto());
    if (typeof alvo === 'string') { S.no = alvo; S.marcados = {}; S.concluiuAgora = ''; guardarPosicao(); mostrar(); return; }
    if (alvo.fluxo) { if (alvo.volta) S.pilha.push({ fluxo: S.fluxo, no: alvo.volta }); iniciar(alvo.fluxo, true); }
  }
  function voltar() {
    var h = S.hist.pop(); if (!h) { sair(); return; }
    S.fluxo = h.fluxo; S.no = h.no; S.pilha = h.pilha || []; S.marcados = {}; S.vista = 'fluxo'; S.concluiuAgora = ''; guardarPosicao(); mostrar();
  }
  function sair() { S.fluxo = ''; S.no = ''; S.hist = []; S.pilha = []; S.vista = 'inicio'; S.concluiuAgora = ''; guardarPosicao(); fecharDock(); desenhar(); }
  function responder(r) { var n = noAtual(); if (!n || n.tipo !== 'pergunta') return; seguir(r === 'sim' ? n.sim : n.nao); }
  function feito() { var n = noAtual(); if (!n || n.tipo !== 'passo') return; seguir(n.prox); }
  function concluir() {
    var n = noAtual(); if (!n || n.tipo !== 'fim') return false;
    var itens = A(n.checklist).map(function (c, i) { return { Item: c, Ok: !!S.marcados[i] }; });
    if (itens.some(function (x) { return !x.Ok; })) return false;
    var id = S.fluxo; marcarConcluido(id, itens.map(function (x) { return x.Item; }));
    if (S.pilha.length) { S.hist.push(foto()); var p = S.pilha.pop(); S.fluxo = p.fluxo; S.no = p.no; S.marcados = {}; S.concluiuAgora = id; guardarPosicao(); mostrar(); return true; }
    S.vista = 'concluido'; S.concluiuAgora = id; S.fluxo = ''; S.no = ''; S.hist = []; S.pilha = []; guardarPosicao(); fecharDock(); desenhar();
    return true;
  }

  /* ---------------------------------------------------------------------
     7) "IR PARA A TELA": abre a tela, escolhe a OP, destaca o botão e deixa o assistente no canto
     --------------------------------------------------------------------- */
  function visivel(x) { return !!(x && (x.offsetWidth || x.offsetHeight || x.getClientRects().length)); }
  function destacar(spec) {
    if (!spec) return null;
    var alvo = null;
    if (/^[#.]/.test(spec)) { try { alvo = document.querySelector(spec); } catch (e) { alvo = null; } }
    else {
      var k = chave(spec), cands = [].slice.call(document.querySelectorAll('#content button, #content summary, #content a, #content label, #content h3, #content legend')).filter(visivel);
      alvo = cands.find(function (b) { return chave(b.textContent) === k; }) || cands.find(function (b) { return chave(b.textContent).indexOf(k) >= 0; });
    }
    if (!alvo) return null;
    [].slice.call(document.querySelectorAll('.mha-alvo')).forEach(function (x) { x.classList.remove('mha-alvo'); });
    alvo.classList.add('mha-alvo');
    try { alvo.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
    setTimeout(function () { alvo.classList.remove('mha-alvo'); }, 9000);
    return alvo;
  }
  function destacarComEspera(spec, tentativas) {
    if (!spec) return;
    var t = tentativas || 0;
    if (destacar(spec) || t >= 4) return;
    setTimeout(function () { destacarComEspera(spec, t + 1); }, 350 + t * 400);
  }
  function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function preselecionar(op) {
    if (!op) return false;
    var re = new RegExp('(^|[^A-Za-z0-9-])' + rx(op) + '($|[^A-Za-z0-9-])');
    var sels = [].slice.call(document.querySelectorAll('#content select'));
    for (var i = 0; i < sels.length; i++) {
      var o = [].slice.call(sels[i].options).find(function (x) { return x.value === op || re.test(x.value) || re.test(x.textContent); });
      if (o) {
        if (sels[i].value !== o.value) { sels[i].value = o.value; sels[i].dispatchEvent(new Event('change', { bubbles: true })); }
        return true;
      }
    }
    var inp = document.querySelector('#content input[list]');
    if (inp) { inp.value = op; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    return false;
  }
  function irParaTela() {
    var n = noAtual(); if (!n || n.tipo !== 'passo') return;
    try { if (typeof window.closeHelpDeskV40 === 'function') window.closeHelpDeskV40(); } catch (e) { }
    S.dock = true; S.minimizado = false;
    if (n.tela && n.tela !== 'topo' && telaAtual() !== n.tela) { try { render(n.tela); } catch (e) { console.error('MES LION 1.6: Help Desk — abrir a tela', e); } }
    setTimeout(function () { if (n.ctx && S.ctx.op) preselecionar(S.ctx.op); destacarComEspera(n.destacar); }, 300);
    desenharDock();
  }

  /* ---------------------------------------------------------------------
     8) ESTILO
     --------------------------------------------------------------------- */
  function estilo() {
    if (el('mha-estilo')) return;
    var st = document.createElement('style'); st.id = 'mha-estilo';
    st.textContent = [
      '.v40-help.mha-com-abas{display:flex!important;flex-direction:column}',
      '.v40-help.mha-com-abas>header{flex:0 0 auto}.v40-help.mha-com-abas>section{flex:0 0 auto}.v40-help.mha-com-abas>.v40-help-frame{flex:1 1 auto;min-height:0}',
      '.mha-abas{display:flex;gap:4px;padding:8px 12px 0;background:#f8fbfd;border-bottom:1px solid #d6e2eb;flex:0 0 auto}',
      '.mha-abas button{border:1px solid #d6e2eb;border-bottom:0;background:#eef3f7;color:#355566;border-radius:8px 8px 0 0;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:-1px}',
      '.mha-abas button.on{background:#fff;color:#004b87;border-color:#d6e2eb;box-shadow:0 -2px 0 #004b87 inset}',
      '.mha{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:330px 1fr;background:#fff;color:#17344d;font-size:13.5px}',
      '.mha-lado{border-right:1px solid #e1e9ef;overflow:auto;padding:14px;background:#f8fbfd;display:flex;flex-direction:column;gap:14px}',
      '.mha-main{overflow:auto;padding:18px 22px 28px}',
      '.mha-busca label{display:block;font-weight:800;color:#0d3553;margin:0 0 6px;font-size:14px}',
      '.mha-busca input{width:100%;box-sizing:border-box;padding:11px 12px;border:2px solid #9db2c5;border-radius:10px;font-size:14px;background:#fff}',
      '.mha-busca input:focus{outline:none;border-color:#004b87;box-shadow:0 0 0 3px rgba(0,75,135,.15)}',
      '.mha-res{display:flex;flex-direction:column;gap:6px;margin-top:8px}',
      '.mha-item{display:flex;gap:10px;align-items:flex-start;text-align:left;width:100%;background:#fff;border:1px solid #dbe5ec;border-radius:10px;padding:9px 10px;cursor:pointer;color:#17344d;font-size:13px;line-height:1.35}',
      '.mha-item:hover{border-color:#004b87;background:#f2f7fb}.mha-item b{display:block;color:#0d3553}.mha-item small{color:#5b7385}',
      '.mha-item .mha-ok-ico{margin-left:auto;color:#2e7d32;font-weight:800}',
      '.mha-vazio{background:#fff8e6;border:1px solid #f0d58a;border-radius:10px;padding:10px;font-size:12.5px;color:#6b5a1e}',
      '.mha-link{background:none;border:0;color:#004b87;text-decoration:underline;cursor:pointer;padding:0;font-size:12.5px}',
      '.mha-card{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:12px 14px}',
      '.mha-card h4{margin:0 0 8px;color:#0d3553;font-size:14px}',
      '.mha-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.mha-chip{border:1px solid #cfdbe5;background:#eef3f7;color:#0b3a5c;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer}',
      '.mha-chip.on{background:#004b87;color:#fff;border-color:#004b87}',
      '.mha-barra{height:8px;background:#e6edf3;border-radius:99px;overflow:hidden;margin:8px 0 4px}.mha-barra i{display:block;height:100%;background:linear-gradient(90deg,#69ad2c,#2e7d32);border-radius:99px}',
      '.mha-lista details{border:1px solid #dbe5ec;border-radius:10px;background:#fff;margin:0 0 6px}',
      '.mha-lista summary{cursor:pointer;padding:8px 10px;font-weight:800;color:#0d3553;list-style:none;display:flex;gap:8px;align-items:center}',
      '.mha-lista summary::-webkit-details-marker{display:none}.mha-lista summary small{margin-left:auto;color:#5b7385;font-weight:600}',
      '.mha-lista details>div{padding:0 8px 8px;display:flex;flex-direction:column;gap:4px}',
      '.mha-lista .mha-item{padding:7px 9px;font-size:12.5px}',
      '.mha-cab{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 6px}',
      '.mha-grupo{background:#e3eefa;color:#0b4a8a;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:800}',
      '.mha-main h2{margin:4px 0 4px;color:#0d3553;font-size:21px}',
      '.mha-resumo{color:#4b6476;margin:0 0 12px}',
      '.mha-trilho{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:0 0 14px;font-size:11.5px;color:#5b7385}',
      '.mha-trilho span{background:#eef3f7;border-radius:999px;padding:3px 9px}.mha-trilho span.at{background:#004b87;color:#fff;font-weight:700}',
      '.mha-desvio{background:#fff4e5;border:1px solid #f3c98b;border-radius:10px;padding:9px 12px;margin:0 0 12px;color:#7a4b00;font-size:12.5px}',
      '.mha-volta{background:#e8f5e9;border:1px solid #a5d6a7;border-radius:10px;padding:9px 12px;margin:0 0 12px;color:#1b5e20;font-size:12.5px}',
      '.mha-q{font-size:20px;font-weight:800;color:#0d3553;line-height:1.35;margin:6px 0 12px}',
      '.mha-chk{border-radius:10px;padding:10px 12px;margin:0 0 12px;font-size:13px;border:1px solid}',
      '.mha-chk.ok{background:#edf7e9;border-color:#c5e3b5;color:#245d0d}.mha-chk.alerta{background:#fff4e5;border-color:#f3c98b;color:#7a4b00}.mha-chk.info{background:#eef5fb;border-color:#cfe0ee;color:#0b4a8a}',
      '.mha-ajuda{color:#4b6476;margin:0 0 14px}',
      '.mha-sn{display:flex;gap:12px;flex-wrap:wrap;margin:6px 0 10px}',
      '.mha-sn button{min-width:150px;padding:13px 22px;font-size:17px;font-weight:800;border-radius:12px;cursor:pointer;border:2px solid #9db2c5;background:#fff;color:#0d3553}',
      '.mha-sn button.mha-sim:hover{border-color:#2e7d32;background:#edf7e9}.mha-sn button.mha-nao:hover{border-color:#c62828;background:#fdecee}',
      '.mha-sn button.sugerido{box-shadow:0 0 0 3px rgba(105,173,44,.35);border-color:#69ad2c}',
      '.mha-sn button small{display:block;font-size:11px;font-weight:600;color:#5b7385;margin-top:2px}',
      '.mha-onde{display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:#f2f7fb;border:1px solid #d6e2eb;border-radius:10px;padding:9px 12px;margin:0 0 12px}',
      '.mha-onde b{color:#0d3553}',
      '.mha-ir{background:#004b87;color:#fff;border:0;border-radius:9px;padding:9px 16px;font-weight:800;cursor:pointer;font-size:13.5px}',
      '.mha-ir:hover{background:#003a69}',
      '.mha-passo h3{margin:0 0 6px;color:#0d3553;font-size:19px}',
      '.mha-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:12px 0}',
      '.mha-cols .mha-sec{border:1px solid #e1e9ef;border-radius:10px;padding:10px 12px;background:#fff}',
      '.mha-cols h5{margin:0 0 6px;font-size:13px;color:#0d3553}',
      '.mha-cols ul{margin:0;padding-left:18px}.mha-cols li{margin:3px 0;line-height:1.4}',
      '.mha-cols .mha-sec.obrig{border-color:#f3c98b;background:#fffaf2}.mha-cols .mha-sec.erros{border-color:#f5c2c7;background:#fff7f8}.mha-cols .mha-sec.destino{border-color:#c5e3b5;background:#f7fcf4}',
      '.mha-acoes{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}',
      '.mha-acoes button{border-radius:9px;padding:9px 14px;font-weight:700;cursor:pointer;border:1px solid #cfdbe5;background:#eef3f7;color:#0b3a5c}',
      '.mha-acoes button.mha-ok,.mha-dock .mha-dock-acoes button.mha-ok{background:#2e7d32;border-color:#2e7d32;color:#fff}',
      '.mha-acoes button.mha-ok:disabled{background:#a5c9a7;border-color:#a5c9a7;cursor:not-allowed}',
      '.mha-ctx{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px;font-size:12.5px}.mha-ctx select{padding:6px 8px;border:1px solid #c9d6e0;border-radius:7px;max-width:420px}',
      '.mha-check label{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid #e1e9ef;border-radius:9px;margin:0 0 6px;cursor:pointer;background:#fff}',
      '.mha-check label.on{background:#edf7e9;border-color:#c5e3b5}',
      '.mha-check input{width:18px!important;height:18px!important;min-width:0!important;margin:0!important}',
      '.mha-prox{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}',
      '.mha-prox button{border:1px solid #004b87;color:#004b87;background:#fff;border-radius:9px;padding:8px 12px;font-weight:700;cursor:pointer}',
      '.mha-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}',
      '.mha-passos-como{counter-reset:p;margin:0;padding:0;list-style:none}.mha-passos-como li{counter-increment:p;margin:0 0 7px;padding-left:30px;position:relative}',
      '.mha-passos-como li:before{content:counter(p);position:absolute;left:0;top:0;width:21px;height:21px;border-radius:50%;background:#004b87;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center}',
      '.mha-feito{font-size:44px;line-height:1;margin:0 0 4px}',
      '.mha-tab{overflow:auto;border:1px solid #dbe5ec;border-radius:10px;margin:0 0 14px}.mha-tab table{border-collapse:collapse;width:100%;font-size:12.5px}',
      '.mha-tab th{background:#eaf2f9;color:#073f7a;padding:7px 8px;text-align:left;position:sticky;top:0}.mha-tab td{padding:6px 8px;border-top:1px solid #edf1f5;vertical-align:top}',
      '.mha-alvo{outline:3px solid #ff9800!important;outline-offset:3px;animation:mhaPulso 1s ease-in-out 0s 6;position:relative;z-index:2}',
      '@keyframes mhaPulso{0%,100%{box-shadow:0 0 0 0 rgba(255,152,0,.7)}50%{box-shadow:0 0 0 10px rgba(255,152,0,0)}}',
      '.mha-dock{position:fixed;right:18px;bottom:18px;width:370px;max-width:calc(100vw - 36px);max-height:62vh;background:#fff;border:1px solid #9db2c5;border-radius:14px;box-shadow:0 12px 34px rgba(7,18,29,.28);z-index:99990;display:flex;flex-direction:column;font-size:13px;color:#17344d}',
      '.mha-dock .mha-dock-cab{display:flex;align-items:center;gap:8px;background:#0d3553;color:#fff;border-radius:13px 13px 0 0;padding:9px 10px 9px 12px;cursor:default}',
      '.mha-dock .mha-dock-cab b{font-size:12.5px;flex:1;line-height:1.3}.mha-dock .mha-dock-cab button{background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:7px;width:28px;height:26px;cursor:pointer;font-size:14px;padding:0}',
      '.mha-dock .mha-dock-corpo{padding:10px 12px;overflow:auto}',
      '.mha-dock h4{margin:0 0 4px;color:#0d3553;font-size:15px}.mha-dock ul{margin:6px 0;padding-left:18px}.mha-dock li{margin:2px 0}',
      '.mha-dock .mha-dock-acoes{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-top:1px solid #e1e9ef}',
      '.mha-dock .mha-dock-acoes button{border-radius:8px;padding:8px 10px;font-weight:700;cursor:pointer;border:1px solid #cfdbe5;background:#eef3f7;color:#0b3a5c;font-size:12.5px}',
      '.mha-dock.min{width:auto;max-height:none}.mha-dock.min .mha-dock-corpo,.mha-dock.min .mha-dock-acoes{display:none}.mha-dock.min .mha-dock-cab{border-radius:13px}',
      '@media (max-width:900px){.mha{grid-template-columns:1fr}.mha-lado{border-right:0;border-bottom:1px solid #e1e9ef;max-height:42vh}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------------
     9) DESENHO DO ASSISTENTE (dentro do Help Desk)
     --------------------------------------------------------------------- */
  function painel() { return el('mhaPainel'); }
  function nomeTela(k) {
    if (TELAS[k]) return TELAS[k];
    try { var m = (typeof modules !== 'undefined' ? modules : []).find(function (x) { return x[0] === k; }); if (m) return m[1]; } catch (e) { }
    return k || '';
  }
  function itemFluxo(id, compacto) {
    var f = FLUXOS[id], g = GRUPOS.find(function (x) { return x.id === f.grupo; }) || {};
    return '<button type="button" class="mha-item" data-acao="iniciar" data-id="' + esc(id) + '"><span>' + esc(g.icone || '•') + '</span><span><b>' + esc(f.titulo) + '</b>' + (compacto ? '' : '<small>' + esc(f.resumo) + '</small>') + '</span>' +
      (concluido(id) ? '<span class="mha-ok-ico" title="Você já concluiu este objetivo">✓</span>' : '') + '</button>';
  }
  function desenharLado() {
    var b = el('mha_lado'); if (!b) return;
    var t = trilhaAtual(), tr = trilha(t), pg = tr ? progressoTrilha(t) : null;
    b.innerHTML = '<div class="mha-busca"><label for="mha_q">O que você quer fazer?</label><input id="mha_q" type="search" autocomplete="off" placeholder="Ex.: cadastrar máquina, apontar produção, saldo do lote…" value="' + esc(S.q) + '">' +
      '<div id="mha_res" class="mha-res"></div></div>' +
      '<div class="mha-card"><h4>Minha trilha de treinamento</h4><div class="mha-chips">' + TRILHAS.map(function (x) {
        return '<button type="button" class="mha-chip' + (x.id === t ? ' on' : '') + '" data-acao="trilha" data-id="' + esc(x.id) + '">' + esc(x.icone + ' ' + x.id) + '</button>';
      }).join('') + '</div>' + (tr ? '<div class="mha-barra"><i style="width:' + Math.round(100 * pg.feitos / Math.max(1, pg.total)) + '%"></i></div><small id="mha_prog">' + pg.feitos + ' de ' + pg.total + ' objetivos concluídos — ' + esc(tr.desc) + '</small>'
        : '<small>Escolha o seu perfil para ver os objetivos na ordem certa e acompanhar o progresso.</small>') + '</div>' +
      '<div class="mha-lista"><h4 style="margin:0 0 6px;color:#0d3553">Objetivos por módulo</h4>' + GRUPOS.map(function (g) {
        var ids = ORDEM.filter(function (id) { return FLUXOS[id].grupo === g.id; }), feitos = ids.filter(concluido).length;
        return '<details' + (S.fluxo && FLUXOS[S.fluxo] && FLUXOS[S.fluxo].grupo === g.id ? ' open' : '') + '><summary>' + esc(g.icone + ' ' + g.id) + '<small>' + feitos + '/' + ids.length + '</small></summary><div>' +
          ids.map(function (id) { return itemFluxo(id, true); }).join('') + '</div></details>';
      }).join('') + '</div>' +
      (admin() ? '<button type="button" class="mha-link" data-acao="equipe">👥 Progresso da equipe e pedidos de ajuda</button>' : '');
    desenharResultados();
  }
  function desenharResultados() {
    var b = el('mha_res'); if (!b) return;
    var q = S.q.trim();
    if (!q) { b.innerHTML = ''; return; }
    var r = buscar(q);
    b.innerHTML = r.length ? r.map(function (x) { return itemFluxo(x.id); }).join('') + '<button type="button" class="mha-link" data-acao="nao_encontrei">Não encontrei o que queria</button>'
      : '<div class="mha-vazio">Nenhum objetivo encontrado para "<b>' + esc(q) + '</b>". Tente outras palavras (ex.: "máquina", "lote", "OP") ou ' +
        '<button type="button" class="mha-link" data-acao="nao_encontrei">avise o que você queria fazer</button>.</div>';
  }
  function desenharMain() {
    var b = el('mha_main'); if (!b) return;
    if (S.vista === 'equipe' && admin()) { b.innerHTML = vistaEquipe(); return; }
    if (S.vista === 'nao_encontrei') { b.innerHTML = vistaNaoEncontrei(); var t = el('mha_ne_termo'); if (t) t.focus(); return; }
    if (S.vista === 'concluido') { b.innerHTML = vistaConcluido(); return; }
    if (S.vista === 'fluxo' && noAtual()) { b.innerHTML = vistaFluxo(); return; }
    b.innerHTML = vistaInicio();
  }
  function desenhar() { if (!painel()) return; desenharLado(); desenharMain(); }
  function mostrar() {
    if (painel()) desenhar();
    var n = noAtual();
    if (S.dock) {
      if (n && n.tipo === 'passo') { desenharDock(); if (!painel()) { irParaTelaSilencioso(n); } }
      else if (n) { fecharDock(true); abrirAssistente(); }
      else fecharDock();
    }
  }
  /* depois de "Feito → próximo passo" no canto da tela: abre a próxima tela só se for outra */
  function irParaTelaSilencioso(n) {
    if (n.tela && n.tela !== 'topo' && telaAtual() !== n.tela) { try { render(n.tela); } catch (e) { console.error('MES LION 1.6: Help Desk — abrir a tela', e); } }
    setTimeout(function () { if (n.ctx && S.ctx.op) preselecionar(S.ctx.op); destacarComEspera(n.destacar); }, 300);
  }

  function vistaInicio() {
    var k = S.telaOrigem, pos = lerPosicao(), t = trilha(trilhaAtual());
    var daTela = ORDEM.filter(function (id) { var f = FLUXOS[id]; return Object.keys(f.nos).some(function (x) { return f.nos[x].tela === k; }); });
    var proc = ''; try { proc = typeof helpProcedureV395 === 'function' ? helpProcedureV395(k) : ''; } catch (e) { }
    var prox = t ? t.fluxos.find(function (x) { return !concluido(x); }) : '';
    return '<div class="mha-cab"><span class="mha-grupo">🧭 Assistente passo a passo</span></div><h2>Olá, ' + esc(usuarioNome()) + '! O que você quer fazer no MES?</h2>' +
      '<p class="mha-resumo">Digite ao lado o que você precisa ou escolha um objetivo. O assistente pergunta o que já está pronto (sim ou não), mostra onde clicar e o que preencher, e confere tudo no final.</p>' +
      (pos ? '<div class="mha-card" style="margin:0 0 12px;border-color:#004b87"><h4>▶ Continuar de onde parei</h4><p style="margin:0 0 8px">' + esc(FLUXOS[pos.fluxo].titulo) + ' — ' + esc((FLUXOS[pos.fluxo].nos[pos.no].titulo || FLUXOS[pos.fluxo].nos[pos.no].texto || 'Checklist final')) + '</p>' +
        '<div class="mha-acoes" style="margin:0"><button type="button" class="mha-ok" data-acao="continuar">Continuar</button><button type="button" data-acao="descartar">Começar outro</button></div></div>' : '') +
      '<div class="mha-grade">' +
      '<div class="mha-card"><h4>📍 Nesta tela: ' + esc(nomeTela(k) || 'início') + '</h4>' + (proc ? '<p style="margin:0 0 8px;color:#4b6476">' + esc(proc) + '</p>' : '') +
      (daTela.length ? '<div class="mha-res">' + daTela.map(function (id) { return itemFluxo(id); }).join('') + '</div>' : '<p class="muted" style="margin:0">Escolha um objetivo na lista ao lado.</p>') + '</div>' +
      '<div class="mha-card"><h4>' + (t ? esc(t.icone + ' Trilha ' + t.id) : '🎯 Comece por uma trilha') + '</h4>' +
      (t ? (prox ? '<p style="margin:0 0 8px">Próximo objetivo da sua trilha:</p>' + itemFluxo(prox) : '<p style="margin:0">🏆 Você concluiu todos os objetivos da trilha. Escolha outra trilha ou revise um objetivo.</p>')
        : '<p style="margin:0 0 8px">Escolha o seu perfil ao lado (Operador, PCP, Engenharia, Qualidade/ACV ou Administrador): o assistente mostra os objetivos na ordem e guarda o seu progresso.</p>') + '</div>' +
      '<div class="mha-card"><h4>Como funciona</h4><ol class="mha-passos-como"><li>Diga o que quer fazer ou escolha o objetivo.</li><li>Responda <b>Sim</b> ou <b>Não</b>: o MES confere nos dados o que já está pronto e, se faltar algo, leva você até lá antes.</li>' +
      '<li>Em cada passo: onde fica, o que preencher, o que é obrigatório, para onde vão os dados e os erros comuns.</li><li><b>Ir para a tela</b> abre a tela e destaca o botão; o assistente fica no canto com <b>✓ Feito → próximo passo</b>.</li><li>No fim, o checklist confirma que ficou tudo certo.</li></ol></div>' +
      '</div>';
  }
  function trilhoHtml() {
    var partes = S.hist.filter(function (h) { return h.fluxo === S.fluxo; }).map(function (h) { var n = FLUXOS[h.fluxo].nos[h.no]; return n ? (n.titulo || 'Pergunta') : ''; }).filter(Boolean).slice(-6);
    var n = noAtual();
    return '<div class="mha-trilho">' + partes.map(function (p) { return '<span>✓ ' + esc(p) + '</span>›'; }).join('') + '<span class="at">' + esc(n.tipo === 'pergunta' ? 'Pergunta' : (n.tipo === 'fim' ? 'Checklist final' : n.titulo)) + '</span></div>';
  }
  function opcoesOP(tipo) {
    var ops = A((D() || {}).op).filter(function (o) { return o && o.CodOP && (tipo !== 'op_pa' || chave(o.TipoOP) === 'pa'); });
    ops.sort(function (a, b) { return (aberta(b) - aberta(a)) || String(b.CodOP).localeCompare(String(a.CodOP)); });
    return ops.slice(0, 300).map(function (o) { return '<option value="' + esc(o.CodOP) + '"' + (S.ctx.op === o.CodOP ? ' selected' : '') + '>' + esc(o.CodOP + ' — ' + (o.CodigoProduto || o.Produto || '') + ' — ' + (o.Status || '')) + '</option>'; }).join('');
  }
  function lista(titulo, itens, cls) { return A(itens).length ? '<div class="mha-sec ' + (cls || '') + '"><h5>' + titulo + '</h5><ul>' + itens.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : ''; }
  function vistaFluxo() {
    var f = FLUXOS[S.fluxo], n = noAtual(), g = GRUPOS.find(function (x) { return x.id === f.grupo; }) || {}, h = '';
    h += '<div class="mha-cab"><span class="mha-grupo">' + esc((g.icone || '') + ' ' + f.grupo) + '</span>' + (concluido(f.id) ? '<span class="mha-grupo" style="background:#e3f3d8;color:#245d0d">✓ já concluído antes</span>' : '') +
      '<small style="color:#5b7385">Trilhas: ' + esc(A(f.perfis).join(', ')) + '</small></div>';
    h += '<h2>' + esc(f.titulo) + '</h2><p class="mha-resumo">' + esc(f.resumo) + '</p>';
    if (S.pilha.length) { var top = S.pilha[S.pilha.length - 1]; h += '<div class="mha-desvio">↪ Antes de continuar em <b>' + esc(FLUXOS[top.fluxo].titulo) + '</b>, faça este objetivo. Ao concluir, o assistente volta para lá.</div>'; }
    if (S.concluiuAgora && FLUXOS[S.concluiuAgora] && S.concluiuAgora !== f.id) h += '<div class="mha-volta">✅ <b>' + esc(FLUXOS[S.concluiuAgora].titulo) + '</b> concluído. Continuando daqui.</div>';
    h += trilhoHtml();
    if (n.tipo === 'pergunta') {
      var c = checar(n.chk), sug = '';
      if (c && !c.falhou) sug = n.decide ? (c.ok ? 'sim' : 'nao') : (c.n === 0 ? 'nao' : '');
      var destinoTxt = function (a) { return typeof a === 'string' ? (f.nos[a].tipo === 'fim' ? 'vai para o checklist final' : (f.nos[a].titulo || 'próxima pergunta')) : ((a.volta ? 'primeiro: ' : 'vai para: ') + FLUXOS[a.fluxo].titulo); };
      h += '<div class="mha-pergunta"><div class="mha-q">❓ ' + esc(n.texto) + '</div>' +
        (c ? '<div class="mha-chk ' + (c.falhou ? 'alerta' : (n.decide ? (c.ok ? 'ok' : 'alerta') : 'info')) + '">🔎 <b>O MES conferiu:</b> ' + esc(c.txt) + (sug ? ' <b>Sugestão: ' + (sug === 'sim' ? 'Sim' : 'Não') + '.</b>' : '') + '</div>' : '') +
        (n.ajuda ? '<p class="mha-ajuda">💡 ' + esc(n.ajuda) + '</p>' : '') +
        '<div class="mha-sn"><button type="button" class="mha-sim' + (sug === 'sim' ? ' sugerido' : '') + '" data-acao="sim">Sim<small>' + esc(destinoTxt(n.sim)) + '</small></button>' +
        '<button type="button" class="mha-nao' + (sug === 'nao' ? ' sugerido' : '') + '" data-acao="nao">Não<small>' + esc(destinoTxt(n.nao)) + '</small></button></div>' +
        (S.hist.length ? '<div class="mha-acoes"><button type="button" data-acao="voltar">← Voltar</button></div>' : '') + '</div>';
    } else if (n.tipo === 'passo') {
      h += '<div class="mha-passo"><h3>👉 ' + esc(n.titulo) + '</h3>' + (n.texto ? '<p>' + esc(n.texto) + '</p>' : '');
      if (n.tela) h += '<div class="mha-onde">📍 Onde: <b>' + esc(nomeTela(n.tela)) + '</b>' + (n.destacar && !/^[#.]/.test(n.destacar) ? ' — botão <b>"' + esc(n.destacar) + '"</b>' : '') +
        '<button type="button" class="mha-ir" data-acao="ir">Ir para a tela ↗</button></div>';
      if (n.ctx) h += '<div class="mha-ctx">🔖 OP (opcional — o assistente já deixa escolhida na tela): <select data-acao="ctx_op"><option value="">— escolher depois na tela —</option>' + opcoesOP(n.ctx) + '</select></div>';
      h += '<div class="mha-cols">' + lista('✏️ O que preencher / fazer', n.preencher) + lista('⚠️ Obrigatório', n.obrig, 'obrig') +
        (n.destino ? '<div class="mha-sec destino"><h5>➡️ Para onde vão os dados</h5><p style="margin:0">' + esc(n.destino) + '</p></div>' : '') + lista('🚫 Erros comuns', n.erros, 'erros') + '</div>';
      h += '<div class="mha-acoes"><button type="button" data-acao="voltar">← Voltar</button>' + (n.tela ? '<button type="button" data-acao="ir">Ir para a tela ↗</button>' : '') +
        '<button type="button" class="mha-ok" data-acao="feito">✓ Feito → próximo passo</button></div></div>';
    } else {
      var marc = A(n.checklist).filter(function (x, i) { return S.marcados[i]; }).length, tudo = marc === A(n.checklist).length;
      h += '<div class="mha-fim"><h3 style="margin:0 0 6px;color:#0d3553">✅ Checklist final</h3>' + (n.texto ? '<p>' + esc(n.texto) + '</p>' : '<p>Confira cada item e marque:</p>') +
        '<div class="mha-check">' + A(n.checklist).map(function (c, i) { return '<label class="' + (S.marcados[i] ? 'on' : '') + '"><input type="checkbox" data-acao="marcar" data-i="' + i + '"' + (S.marcados[i] ? ' checked' : '') + '> ' + esc(c) + '</label>'; }).join('') + '</div>' +
        '<div class="mha-acoes"><button type="button" data-acao="voltar">← Voltar</button><button type="button" class="mha-ok" data-acao="concluir" id="mha_concluir"' + (tudo ? '' : ' disabled') + '>' +
        (S.pilha.length ? '✓ Concluir e voltar para "' + esc(FLUXOS[S.pilha[S.pilha.length - 1].fluxo].titulo) + '"' : '✓ Concluir este objetivo') + '</button><small style="color:#5b7385">' + marc + ' de ' + A(n.checklist).length + ' conferidos</small></div>' +
        (A(n.proximos).length && !S.pilha.length ? '<h4 style="margin:18px 0 4px;color:#0d3553">Próximo passo natural</h4><div class="mha-prox">' + n.proximos.map(function (p) { return '<button type="button" data-acao="iniciar" data-id="' + esc(p) + '">' + esc(FLUXOS[p].titulo) + ' →</button>'; }).join('') + '</div>' : '') + '</div>';
    }
    h += '<div class="mha-acoes" style="margin-top:22px;border-top:1px solid #e1e9ef;padding-top:12px"><button type="button" data-acao="recomecar">↺ Recomeçar este objetivo</button><button type="button" data-acao="sair">✕ Sair do objetivo</button>' +
      '<button type="button" class="mha-link" data-acao="nao_encontrei">Não encontrei o que queria</button></div>';
    return h;
  }
  function vistaConcluido() {
    var f = FLUXOS[S.concluiuAgora], n = f ? f.nos[Object.keys(f.nos).find(function (k) { return f.nos[k].tipo === 'fim'; })] : null, t = trilha(trilhaAtual()), pg = t ? progressoTrilha(t.id) : null;
    var prox = n ? A(n.proximos) : [];
    return '<div class="mha-feito">🎉</div><h2>Objetivo concluído!</h2><p class="mha-resumo">' + esc(f ? f.titulo : '') + ' — registrado no seu progresso.</p>' +
      (t ? '<div class="mha-card" style="margin:0 0 12px"><h4>' + esc(t.icone + ' Trilha ' + t.id) + '</h4><div class="mha-barra"><i style="width:' + Math.round(100 * pg.feitos / Math.max(1, pg.total)) + '%"></i></div><small>' + pg.feitos + ' de ' + pg.total + ' objetivos concluídos</small></div>' : '') +
      (prox.length ? '<h4 style="color:#0d3553;margin:0 0 6px">Próximo passo natural</h4><div class="mha-res">' + prox.map(function (p) { return itemFluxo(p); }).join('') + '</div>' : '') +
      '<div class="mha-acoes"><button type="button" data-acao="inicio">🏠 Início do assistente</button></div>';
  }
  function vistaNaoEncontrei() {
    return '<h2>Não encontrei o que queria</h2><p class="mha-resumo">Conte o que você queria fazer: o pedido fica registrado (com a tela e o passo em que você estava) para o administrador montar o passo a passo.</p>' +
      '<div class="mha-card" style="max-width:720px"><label style="display:block;font-weight:700;margin:0 0 4px">O que você queria fazer?</label><input id="mha_ne_termo" style="width:100%;padding:9px;border:1px solid #c9d6e0;border-radius:8px;box-sizing:border-box" value="' + esc(S.q) + '">' +
      '<label style="display:block;font-weight:700;margin:10px 0 4px">Detalhes (opcional)</label><textarea id="mha_ne_coment" rows="3" style="width:100%;padding:9px;border:1px solid #c9d6e0;border-radius:8px;box-sizing:border-box"></textarea>' +
      '<div class="mha-acoes"><button type="button" class="mha-ok" data-acao="enviar_ne">Registrar o pedido</button><button type="button" data-acao="cancelar_ne">Cancelar</button></div><div id="mha_ne_msg" class="mbc-msg"></div></div>';
  }
  function vistaEquipe() {
    var d = D() || {}, regs = A(d.helpdesk_progresso), buscas = A(d.helpdesk_buscas).slice().reverse();
    return '<div class="mha-cab"><span class="mha-grupo">👥 Equipe</span></div><h2>Progresso da equipe e pedidos de ajuda</h2>' +
      '<div class="mha-acoes" style="margin:0 0 12px"><button type="button" data-acao="inicio">← Assistente</button><button type="button" class="mha-ok" data-acao="excel_equipe">⬇ Exportar Excel</button></div>' +
      '<h4 style="color:#0d3553;margin:0 0 6px">Trilhas de treinamento (' + regs.length + ' usuário(s))</h4><div class="mha-tab"><table><thead><tr><th>Usuário</th><th>Nome</th><th>Trilha</th><th>Progresso da trilha</th><th>Objetivos concluídos</th><th>Último concluído</th><th>Atualizado</th></tr></thead><tbody>' +
      (regs.length ? regs.map(function (r) {
        var pg = r.Trilha ? progressoTrilha(r.Trilha, r) : null, feitos = Object.keys(r.Fluxos || {}).filter(function (k) { return r.Fluxos[k] && r.Fluxos[k].Concluido; });
        return '<tr><td>' + esc(r.Usuario) + '</td><td>' + esc(r.Nome || '') + '</td><td>' + esc(r.Trilha || '—') + '</td><td>' + (pg ? pg.feitos + ' de ' + pg.total : '—') + '</td><td>' + feitos.length + '</td><td>' + esc(r.Ultimo && FLUXOS[r.Ultimo] ? FLUXOS[r.Ultimo].titulo : '—') + '</td><td>' + esc(dataBR(r.Atualizado)) + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="muted">Ninguém começou uma trilha ainda.</td></tr>') + '</tbody></table></div>' +
      '<h4 style="color:#0d3553;margin:0 0 6px">"Não encontrei o que queria" (' + buscas.length + ')</h4><div class="mha-tab"><table><thead><tr><th>Data</th><th>Usuário</th><th>O que procurava</th><th>Detalhes</th><th>Onde estava</th><th>Tela</th></tr></thead><tbody>' +
      (buscas.length ? buscas.slice(0, 300).map(function (x) {
        return '<tr><td>' + esc(dataBR(x.Data)) + '</td><td>' + esc(x.Usuario) + '</td><td>' + esc(x.Termo) + '</td><td>' + esc(x.Comentario) + '</td><td>' + esc(x.Caminho) + '</td><td>' + esc(nomeTela(x.Tela)) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">Nenhum pedido registrado.</td></tr>') + '</tbody></table></div>';
  }
  function excelEquipe() {
    var X = window.mesXlsx; if (!X) { alert('Gerador de planilha indisponível.'); return; }
    var d = D() || {}, regs = A(d.helpdesk_progresso), buscas = A(d.helpdesk_buscas);
    var p = [{ c: ['Usuário', 'Nome', 'Trilha', 'Objetivos da trilha concluídos', 'Objetivos da trilha', 'Objetivos concluídos (todos)', 'Último concluído', 'Atualizado'], s: 1 }].concat(regs.map(function (r) {
      var pg = r.Trilha ? progressoTrilha(r.Trilha, r) : { feitos: '', total: '' }, feitos = Object.keys(r.Fluxos || {}).filter(function (k) { return r.Fluxos[k] && r.Fluxos[k].Concluido; });
      return { c: [r.Usuario, r.Nome || '', r.Trilha || '', pg.feitos, pg.total, feitos.length, r.Ultimo && FLUXOS[r.Ultimo] ? FLUXOS[r.Ultimo].titulo : '', dataBR(r.Atualizado)] };
    }));
    var det = [{ c: ['Usuário', 'Objetivo', 'Grupo', 'Concluído em', 'Vezes'], s: 1 }];
    regs.forEach(function (r) { Object.keys(r.Fluxos || {}).forEach(function (k) { var x = r.Fluxos[k]; if (x && x.Concluido) det.push({ c: [r.Usuario, FLUXOS[k] ? FLUXOS[k].titulo : k, FLUXOS[k] ? FLUXOS[k].grupo : '', dataBR(x.Concluido), x.Vezes || 1] }); }); });
    var b = [{ c: ['Data', 'Usuário', 'O que procurava', 'Detalhes', 'Onde estava', 'Tela', 'Trilha'], s: 1 }].concat(buscas.map(function (x) { return { c: [dataBR(x.Data), x.Usuario, x.Termo, x.Comentario, x.Caminho, nomeTela(x.Tela), x.Trilha || ''] }; }));
    var bytes = X.gerar([{ nome: 'Progresso', xml: X.folha(p, { larguras: [16, 26, 16, 14, 12, 14, 44, 20], congelar: 1, ativa: true }) },
      { nome: 'Objetivos concluídos', xml: X.folha(det, { larguras: [16, 54, 26, 20, 8], congelar: 1 }) },
      { nome: 'Não encontrei', xml: X.folha(b, { larguras: [20, 16, 44, 44, 50, 40, 16], congelar: 1 }) }]);
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    var dt = new Date(); a.href = url; a.download = 'MES_LION_helpdesk_equipe_' + dt.getFullYear() + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getDate()).padStart(2, '0') + '.xlsx';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ações (um único ouvinte por painel) */
  function acao(nome, alvo) {
    switch (nome) {
      case 'iniciar': iniciar(alvo.getAttribute('data-id'), false); return;
      case 'trilha': escolherTrilha(alvo.getAttribute('data-id')); desenhar(); return;
      case 'sim': responder('sim'); return;
      case 'nao': responder('nao'); return;
      case 'feito': feito(); return;
      case 'voltar': voltar(); return;
      case 'ir': irParaTela(); return;
      case 'concluir': concluir(); return;
      case 'recomecar': if (S.fluxo) iniciar(S.fluxo, false); return;
      case 'sair': sair(); return;
      case 'inicio': S.vista = S.fluxo ? 'fluxo' : 'inicio'; if (S.vista === 'inicio') S.concluiuAgora = ''; desenhar(); return;
      case 'continuar': var p = lerPosicao(); if (p) { S.fluxo = p.fluxo; S.no = p.no; S.pilha = p.pilha || []; S.hist = p.hist || []; S.ctx = p.ctx || { op: '' }; S.vista = 'fluxo'; desenhar(); } return;
      case 'descartar': S.fluxo = ''; S.no = ''; S.hist = []; S.pilha = []; guardarPosicao(); desenhar(); return;
      case 'equipe': S.vista = 'equipe'; desenharMain(); return;
      case 'excel_equipe': excelEquipe(); return;
      case 'nao_encontrei': S.vistaAntes = S.vista; S.vista = 'nao_encontrei'; desenharMain(); return;
      case 'cancelar_ne': S.vista = S.fluxo ? 'fluxo' : 'inicio'; desenharMain(); return;
      case 'enviar_ne':
        var termo = txt((el('mha_ne_termo') || {}).value), com = txt((el('mha_ne_coment') || {}).value), m = el('mha_ne_msg');
        if (!termo && !com) { if (m) { m.className = 'mbc-msg erro'; m.textContent = 'Escreva o que você queria fazer.'; } return; }
        registrarNaoEncontrei(termo, com);
        if (m) { m.className = 'mbc-msg ok'; m.textContent = 'Obrigado! O pedido ficou registrado para o administrador.'; }
        var bt = painel() && painel().querySelector('[data-acao="enviar_ne"]'); if (bt) bt.disabled = true;
        return;
    }
  }
  function ligar(p) {
    p.addEventListener('click', function (e) {
      var a = e.target.closest('[data-acao]'); if (!a || !p.contains(a)) return;
      var nome = a.getAttribute('data-acao');
      if (nome === 'marcar' || nome === 'ctx_op') return;
      e.preventDefault(); acao(nome, a);
    });
    p.addEventListener('change', function (e) {
      var a = e.target.closest('[data-acao]'); if (!a) return;
      if (a.getAttribute('data-acao') === 'marcar') { S.marcados[a.getAttribute('data-i')] = a.checked; desenharMain(); }
      else if (a.getAttribute('data-acao') === 'ctx_op') { S.ctx.op = a.value; guardarPosicao(); }
    });
    p.addEventListener('input', function (e) { if (e.target && e.target.id === 'mha_q') { S.q = e.target.value; desenharResultados(); } });
    p.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'mha_q' && e.key === 'Enter') { var r = buscar(S.q); if (r.length) { e.preventDefault(); iniciar(r[0].id, false); } }
    });
  }

  /* ---------------------------------------------------------------------
     10) O ASSISTENTE NO CANTO DA TELA
     --------------------------------------------------------------------- */
  function fecharDock(manterEstado) { var d = el('mhaDock'); if (d) d.remove(); if (!manterEstado) S.dock = false; }
  function desenharDock() {
    estilo();
    var n = noAtual(); if (!n || n.tipo !== 'passo') { fecharDock(); return; }
    var f = FLUXOS[S.fluxo], d = el('mhaDock');
    if (!d) {
      d = document.createElement('div'); d.id = 'mhaDock'; d.className = 'mha-dock'; document.body.appendChild(d);
      d.addEventListener('click', function (e) {
        var a = e.target.closest('[data-dock]'); if (!a) return;
        var x = a.getAttribute('data-dock');
        if (x === 'min') { S.minimizado = !S.minimizado; desenharDock(); }
        else if (x === 'fechar') { fecharDock(); }
        else if (x === 'feito') { feito(); }
        else if (x === 'onde') { var m = noAtual(); if (m) { if (m.tela && m.tela !== 'topo' && telaAtual() !== m.tela) { try { render(m.tela); } catch (er) { } } setTimeout(function () { destacarComEspera(m.destacar); }, 250); } }
        else if (x === 'abrir') { abrirAssistente(); }
        else if (x === 'voltar') { voltar(); }
      });
    }
    d.className = 'mha-dock' + (S.minimizado ? ' min' : '');
    var passosVistos = S.hist.filter(function (h) { return h.fluxo === S.fluxo; }).length + 1;
    d.innerHTML = '<div class="mha-dock-cab"><b>🧭 ' + esc(f.titulo) + '<br><span style="font-weight:400;opacity:.85">Passo ' + passosVistos + ' — ' + esc(n.titulo) + '</span></b>' +
      '<button type="button" data-dock="min" title="' + (S.minimizado ? 'Abrir' : 'Minimizar') + '">' + (S.minimizado ? '▢' : '–') + '</button><button type="button" data-dock="fechar" title="Fechar o assistente">×</button></div>' +
      '<div class="mha-dock-corpo"><h4>👉 ' + esc(n.titulo) + '</h4>' + (n.texto ? '<p style="margin:0 0 6px">' + esc(n.texto) + '</p>' : '') +
      (A(n.preencher).length ? '<b>O que preencher / fazer</b><ul>' + n.preencher.slice(0, 6).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + (n.preencher.length > 6 ? '<li>…</li>' : '') + '</ul>' : '') +
      (A(n.obrig).length ? '<div style="color:#7a4b00"><b>⚠️ Obrigatório:</b> ' + esc(n.obrig.join('; ')) + '</div>' : '') + '</div>' +
      '<div class="mha-dock-acoes"><button type="button" class="mha-ok" data-dock="feito">✓ Feito → próximo passo</button>' + (n.destacar || n.tela ? '<button type="button" data-dock="onde">📍 Onde clicar</button>' : '') +
      '<button type="button" data-dock="abrir">🧭 Abrir o assistente</button><button type="button" data-dock="voltar">← Voltar</button></div>';
  }

  /* ---------------------------------------------------------------------
     11) ABAS NO HELP DESK (o Help Desk original continua na aba "Fluxo de integração")
     --------------------------------------------------------------------- */
  function montarAbas(k, abaInicial) {
    var ov = el('v40HelpOverlay'), caixa = ov && ov.querySelector('.v40-help'); if (!caixa || caixa.querySelector('.mha-abas')) return;
    estilo();
    S.telaOrigem = k || telaAtual();
    caixa.classList.add('mha-com-abas');
    var cab = caixa.querySelector('header'), sec = caixa.querySelector(':scope > section'), frame = caixa.querySelector('.v40-help-frame');
    var abas = document.createElement('div'); abas.className = 'mha-abas';
    abas.innerHTML = '<button type="button" data-aba="assistente">🧭 Assistente passo a passo</button><button type="button" data-aba="fluxo">🗺 Fluxo de integração dos módulos</button>';
    var p = document.createElement('div'); p.id = 'mhaPainel'; p.className = 'mha';
    p.innerHTML = '<div class="mha-lado" id="mha_lado"></div><div class="mha-main" id="mha_main"></div>';
    if (cab && cab.nextSibling) caixa.insertBefore(abas, cab.nextSibling); else caixa.appendChild(abas);
    caixa.appendChild(p);
    ligar(p);
    var trocar = function (aba) {
      [].slice.call(abas.querySelectorAll('button')).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-aba') === aba); });
      p.style.display = aba === 'assistente' ? '' : 'none';
      if (sec) sec.style.display = aba === 'fluxo' ? '' : 'none';
      if (frame) frame.style.display = aba === 'fluxo' ? '' : 'none';
      S.aba = aba;
    };
    abas.addEventListener('click', function (e) { var b = e.target.closest('[data-aba]'); if (b) trocar(b.getAttribute('data-aba')); });
    trocar(abaInicial || 'assistente');
    fecharDock();
    if (S.fluxo && noAtual()) S.vista = 'fluxo'; else if (S.vista === 'fluxo') S.vista = 'inicio';
    desenhar();
    setTimeout(function () { var q = el('mha_q'); if (q && S.vista === 'inicio' && S.aba === 'assistente') { try { q.focus(); } catch (e) { } } }, 50);
  }
  function abrirAssistente() {
    S.dock = false; fecharDock();
    if (typeof window.openHelpDeskV40 === 'function') window.openHelpDeskV40(telaAtual() || 'op');
  }

  (function () {
    var original = window.openHelpDeskV40;
    if (typeof original !== 'function') { console.warn('MES LION 1.6: Help Desk original não encontrado — assistente desligado.'); return; }
    window.openHelpDeskV40 = function (k) {
      var r = original.apply(this, arguments);
      try { montarAbas(k || telaAtual()); } catch (e) { console.error('MES LION 1.6: assistente do Help Desk', e); }
      return r;
    };
  })();

  /* ---------------------------------------------------------------------
     12) ACESSO PARA TESTES
     --------------------------------------------------------------------- */
  window.mesHelpDeskAPI = {
    versao: VERSAO,
    fluxos: function () { return ORDEM.map(function (id) { var f = FLUXOS[id]; return { id: id, titulo: f.titulo, grupo: f.grupo, perfis: f.perfis.slice(), nos: Object.keys(f.nos).length, telas: Object.keys(f.nos).map(function (k) { return f.nos[k].tela; }).filter(Boolean) }; }); },
    fluxo: function (id) { return FLUXOS[id] ? JSON.parse(JSON.stringify(FLUXOS[id])) : null; },
    trilhas: function () { return JSON.parse(JSON.stringify(TRILHAS)); },
    grupos: function () { return GRUPOS.map(function (g) { return g.id; }); },
    telas: function () { return JSON.parse(JSON.stringify(TELAS)); },
    validar: validarFluxos,
    buscar: function (q) { return buscar(q).map(function (r) { return r.id; }); },
    checar: function (k) { return checar(k); },
    checagens: function () { return Object.keys(CHK); },
    destacar: function (spec) { return !!destacar(spec); },
    estado: function () { var n = noAtual(); return { vista: S.vista, fluxo: S.fluxo, no: S.no, tipo: n ? n.tipo : '', pilha: JSON.parse(JSON.stringify(S.pilha)), dock: !!el('mhaDock'), ctx: S.ctx.op }; },
    iniciar: function (id) { iniciar(id, false); return this.estado(); },
    responder: function (r) { responder(r); return this.estado(); },
    feito: function () { feito(); return this.estado(); },
    progresso: function () { return JSON.parse(JSON.stringify(registroProgresso(false) || null)); },
    sair: function () { sair(); return this.estado(); }
  };
  window.MES_ADAPTADOR_HELPDESK_ASSISTENTE = VERSAO;
})();
