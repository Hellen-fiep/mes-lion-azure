/* =========================================================================
   MES LION V1.0.15 — PATCH ADITIVO (carregado depois de app.js)
   Esta versão parte da V1.0.14 e reverte apenas o item 13 (Help Desk)
   para o formato antigo com <iframe>, a pedido — ver seção 13 mais abaixo.
   Segue o mesmo padrão do restante do sistema: captura a função vigente,
   estende o comportamento e reatribui. Nenhuma função anterior é apagada
   por este arquivo — por isso ele é seguro de aplicar sobre o V1.0.13.
   Itens cobertos (numeração conforme solicitado):
    1) Filtro por categoria em Materiais
    2) Categoria fixa (lista) + tela de cadastro de categorias
    3) Campo "Especificação do Item" na Entrada de Materiais
    4) Correção do filtro de Estoque por projeto (KPIs não filtravam)
    5) Estrutura do Produto em árvore PA -> PI
    6) OP de PI isolado: seleção múltipla com flag + saldo a usar
    7) Roteiro de PI isolado não pode referenciar outros PA/PI
    8) Ver relatório de obsolescência ao final do arquivo (não remove nada
       automaticamente — ver seção "RELATÓRIO DE OBSOLESCÊNCIA")
    9) Simulações somente com OPs encerradas e custo validado
    10/11) Processos/Equipamentos/Escalas por lista fixa + tela de Categorias
    12) Apontamento com hora início/fim + tabela auxiliar + WIP no dashboard
    13) Help Desk leve (sem iframe / sem 2ª requisição de rede)
   ========================================================================= */
const APP_VERSION_V1014 = 'V1.0.15';

/* ---------------------------------------------------------------------
   0) HELPERS COMUNS
   --------------------------------------------------------------------- */

// Lista única de escalas de produção usada em todo o sistema (roteiro,
// cadastro de recursos, geração de PI isolado). Evita listas divergentes
// como "Laboratório" x "Planta Piloto" x "Semi-industrial"/"Industrial".
// (V1.0.16 reduz esta lista para as duas escalas reais — ver bloco V1.0.16 no final do arquivo.)
const V1014_ESCALAS = ['Laboratório','Planta Piloto','Semi-industrial','Industrial','Testes de Caracterização'];
function v1014EscalaOptions(sel){
  return V1014_ESCALAS.map(e=>`<option value="${e}" ${String(sel||'')===e?'selected':''}>${e}</option>`).join('');
}

// Categorias de materiais: usa a tabela já existente data.categorias
// (campos Categoria + Processo). Esta função centraliza a leitura.
function v1014Categorias(){
  data.categorias = data.categorias||[];
  return [...data.categorias].sort((a,b)=>String(a.Categoria||'').localeCompare(String(b.Categoria||''),'pt-BR'));
}
function v1014CategoriaOptions(sel,incluirTodas){
  const cats=v1014Categorias();
  let html='';
  if(incluirTodas) html+='<option value="">Todas as categorias</option>';
  else html+='<option value="">Selecione a categoria...</option>';
  html+=cats.map(c=>`<option value="${htmlEscape(c.Categoria)}" ${String(sel||'')===String(c.Categoria)?'selected':''}>${htmlEscape(c.Categoria)}</option>`).join('');
  return html;
}
function v1014ProcessoOptions(sel){
  const rows=(data.processos||[]).slice().sort((a,b)=>String(a.Processo||'').localeCompare(String(b.Processo||''),'pt-BR'));
  return '<option value="">Sem processo padrão</option>'+rows.map(p=>`<option value="${htmlEscape(p.Processo)}" ${String(sel||'')===String(p.Processo)?'selected':''}>${htmlEscape(p.IdProcesso?p.IdProcesso+' — '+p.Processo:p.Processo)}</option>`).join('');
}

/* ---------------------------------------------------------------------
   1) + 2) MATERIAIS — FILTRO POR CATEGORIA + CATEGORIA FIXA + TELA NOVA
   --------------------------------------------------------------------- */

// Reescreve a tela de materiais adicionando um seletor de categoria que
// filtra a tabela junto com a busca por texto já existente.
const v1014MateriaisModuleBase = materiaisModuleV4047;
materiaisModuleV4047 = function(){
  $('title').textContent='Materiais';
  $('subtitle').textContent=`${(data.materiais||[]).length} registros. Especificações e qualificação ficam vinculadas ao cadastro mestre.`;
  $('content').innerHTML=`<div class="toolbar">
      <button onclick="editarMaterialCadastroV4047(-1)">+ Novo cadastro</button>
      <button class="secondary" onclick="v1014ClearMateriaisFilters()">Consultar todos</button>
      <select id="v1014_mat_cat" onchange="v1014RenderMateriaisTable()">${v1014CategoriaOptions('',true)}</select>
      <input id="q" placeholder="Pesquisar..." oninput="v1014RenderMateriaisTable()">
      <button onclick="reportTabela('materiais','Materiais')">PDF selecionados</button>
      <button class="secondary" onclick="exportSelectedExcel('materiais','Materiais')">Exportar Excel selecionados</button>
    </div><div id="crudBox"></div><div id="tbl">${table('materiais')}</div>`;
};
function v1014ClearMateriaisFilters(){
  if($('q'))$('q').value='';
  if($('v1014_mat_cat'))$('v1014_mat_cat').value='';
  v1014RenderMateriaisTable();
}
function v1014RenderMateriaisTable(){
  const q=($('q')?.value||'').toLowerCase();
  const cat=$('v1014_mat_cat')?.value||'';
  let rows=(data.materiais||[]);
  if(cat) rows=rows.filter(m=>String(m.Categoria||'')===cat);
  if(q) rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  $('tbl').innerHTML=table('materiais',rows);
}

// Formulário de material: troca o campo de categoria de texto livre para
// uma lista fixa vinda do cadastro de categorias, com botão para criar
// uma categoria nova sem sair da tela.
const v1014EditarMaterialBase = editarMaterialCadastroV4047;
editarMaterialCadastroV4047 = function(idx=-1){
  v1014EditarMaterialBase(idx);
  const sel=$('v47_mat_cat');
  if(!sel) return;
  const old=(idx>=0?(data.materiais[idx]||{}):{}).Categoria||'';
  const wrap=document.createElement('div');
  wrap.className='v1014-cat-wrap';
  wrap.innerHTML=`<select id="v1014_mat_cat_select">${v1014CategoriaOptions(old,false)}</select><button type="button" class="secondary mini" onclick="v1014NovaCategoriaInline('v1014_mat_cat_select')">+ Nova categoria</button>`;
  sel.replaceWith(wrap);
  wrap.querySelector('select').id='v47_mat_cat';
}
// Sobrepõe a leitura do campo de categoria no momento de salvar, já que o
// input original virou um select com o mesmo id ('v47_mat_cat').
// (salvarMaterialCadastroV4047 já lê $('v47_mat_cat').value, então nenhuma
// alteração adicional de leitura é necessária.)

// Abre um pequeno formulário para cadastrar categoria nova sem sair da
// tela atual, e atualiza o select indicado assim que salva.
function v1014NovaCategoriaInline(targetSelectId){
  const host=document.createElement('div');
  host.id='v1014CatOverlay';
  host.className='v1014-overlay';
  host.innerHTML=`<div class="v1014-modal"><h3>Nova categoria de material</h3>
    <div class="form-grid">
      <label class="wide"><span>Nome da categoria</span><input id="v1014_new_cat_nome" placeholder="Ex.: Aditivo Eletrólito"></label>
      <label class="wide"><span>Processo padrão desta categoria</span><select id="v1014_new_cat_proc">${v1014ProcessoOptions('')}</select></label>
    </div>
    <div class="form-actions">
      <button class="green" onclick="v1014SalvarCategoriaInline('${targetSelectId||''}')">Salvar categoria</button>
      <button class="secondary" onclick="document.getElementById('v1014CatOverlay').remove()">Cancelar</button>
    </div></div>`;
  document.body.appendChild(host);
  host.addEventListener('click',e=>{if(e.target===host)host.remove();});
  setTimeout(()=>$('v1014_new_cat_nome')?.focus(),0);
}
function v1014SalvarCategoriaInline(targetSelectId){
  const nome=($('v1014_new_cat_nome')?.value||'').trim();
  if(!nome) return alert('Informe o nome da categoria.');
  data.categorias=data.categorias||[];
  if(data.categorias.some(c=>String(c.Categoria||'').toLowerCase()===nome.toLowerCase())) return alert('Já existe uma categoria com esse nome.');
  data.categorias.push({Categoria:nome,Processo:$('v1014_new_cat_proc')?.value||''});
  saveLocal();
  document.getElementById('v1014CatOverlay')?.remove();
  if(targetSelectId && $(targetSelectId)){
    $(targetSelectId).innerHTML=v1014CategoriaOptions(nome,false);
  }
  if($('v1014_mat_cat')) $('v1014_mat_cat').innerHTML=v1014CategoriaOptions($('v1014_mat_cat').value,true);
  alert('Categoria "'+nome+'" cadastrada.');
}

// Tela dedicada de cadastro de categorias (item 2 e item 10 — "crie uma
// tabela pra cadastro de categoria, um botão").
function categoriasModule(){
  current='categorias';
  $('title').textContent='Categorias de Materiais';
  $('subtitle').textContent='Lista fixa usada nos filtros de Materiais e no cadastro de Recursos/Equipamentos. Crie aqui antes de usar em outra tela.';
  $('content').innerHTML=`<div class="toolbar"><button onclick="v1014NovaCategoria(-1)">+ Nova categoria</button><input id="q" placeholder="Pesquisar..." oninput="v1014RenderCategoriasTable()"></div><div id="crudBox"></div><div id="tbl"></div>`;
  v1014RenderCategoriasTable();
}
function v1014RenderCategoriasTable(){
  const q=($('q')?.value||'').toLowerCase();
  let rows=v1014Categorias();
  if(q) rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  $('tbl').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Ações</th><th>Categoria</th><th>Processo padrão</th></tr></thead><tbody>${rows.map(r=>{const idx=(data.categorias||[]).indexOf(r);return `<tr><td><button class="mini" onclick="v1014NovaCategoria(${idx})">Editar</button></td><td>${htmlEscape(r.Categoria||'')}</td><td>${htmlEscape(r.Processo||'')}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function v1014NovaCategoria(idx=-1){
  const old=idx>=0?(data.categorias[idx]||{}):{};
  $('crudBox').innerHTML=`<div class="form edit-form"><h3>${idx>=0?'Editar':'Nova'} categoria</h3><div class="form-grid">
    <label class="wide"><span>Nome da categoria</span><input id="v1014_cat_nome" value="${htmlEscape(old.Categoria||'')}"></label>
    <label class="wide"><span>Processo padrão</span><select id="v1014_cat_proc">${v1014ProcessoOptions(old.Processo||'')}</select></label>
    </div><div class="form-actions"><button onclick="v1014SalvarCategoria(${idx})">Salvar</button>${idx>=0?`<button class="danger" onclick="v1014ExcluirCategoria(${idx})">Excluir</button>`:''}<button class="secondary" onclick="$('crudBox').innerHTML=''">Cancelar</button></div></div>`;
  $('crudBox').scrollIntoView({behavior:'smooth',block:'start'});
}
function v1014SalvarCategoria(idx){
  const nome=($('v1014_cat_nome')?.value||'').trim();
  if(!nome) return alert('Informe o nome da categoria.');
  data.categorias=data.categorias||[];
  const dup=data.categorias.some((c,i)=>i!==idx&&String(c.Categoria||'').toLowerCase()===nome.toLowerCase());
  if(dup) return alert('Já existe uma categoria com esse nome.');
  const o={Categoria:nome,Processo:$('v1014_cat_proc')?.value||''};
  if(idx>=0) data.categorias[idx]=o; else data.categorias.unshift(o);
  saveLocal(); categoriasModule();
}
function v1014ExcluirCategoria(idx){
  const cat=(data.categorias||[])[idx]?.Categoria||'';
  const emUso=(data.materiais||[]).some(m=>String(m.Categoria||'')===cat);
  if(emUso && !confirm('Existem materiais cadastrados com esta categoria. Excluir mesmo assim?')) return;
  if(!confirm('Excluir esta categoria?')) return;
  data.categorias.splice(idx,1); saveLocal(); categoriasModule();
}

/* ---------------------------------------------------------------------
   3) ENTRADA DE MATERIAIS — CAMPO "ESPECIFICAÇÃO DO ITEM"
   --------------------------------------------------------------------- */
if(fields.entradas && !fields.entradas.includes('EspecificacaoItem')){
  fields.entradas.push('EspecificacaoItem');
}
const v1014EntradasModuleBase = entradasModule;
entradasModule = function(){
  v1014EntradasModuleBase();
  const um=$('em_um');
  if(!um) return;
  const label=document.createElement('label');
  label.className='wide';
  label.innerHTML='<span>Especificação do Item</span><textarea id="em_espec" placeholder="Preenchimento livre: características, norma, tolerância, observações técnicas do item recebido..."></textarea>';
  const grid=um.closest('.form-grid');
  if(grid) grid.appendChild(label);
};
const v1014AddEntradaBase = addEntrada;
addEntrada = async function(){
  const espec=$('em_espec')?.value||'';
  window.__v1014PendingEspec = espec;
  await v1014AddEntradaBase();
  if(espec && data.entradas && data.entradas[0] && !data.entradas[0].EspecificacaoItem){
    data.entradas[0].EspecificacaoItem = espec;
    saveLocal();
    if(current==='entradas') render('entradas');
  }
};
const v1014EditarEntradaBase = editarEntrada;
editarEntrada = function(idx){
  v1014EditarEntradaBase(idx);
  const r=(data.entradas||[])[idx]||{};
  const box=$('crudBox');
  const um=$('ed_um');
  if(!box||!um) return;
  const label=document.createElement('label');
  label.className='wide';
  label.innerHTML=`<span>Especificação do Item</span><textarea id="ed_espec" placeholder="Preenchimento livre...">${htmlEscape(r.EspecificacaoItem||'')}</textarea>`;
  const grid=um.closest('.form-grid');
  if(grid) grid.appendChild(label);
};
const v1014SalvarEntradaEditadaBase = salvarEntradaEditada;
salvarEntradaEditada = async function(idx){
  const espec=$('ed_espec')?.value||'';
  await v1014SalvarEntradaEditadaBase(idx);
  if(data.entradas && data.entradas[idx]){
    data.entradas[idx].EspecificacaoItem = espec;
    saveLocal();
    if(current==='entradas') render('entradas');
  }
};

/* ---------------------------------------------------------------------
   4) ESTOQUE — CORRIGE KPIs QUE NÃO RESPEITAVAM O FILTRO DE PROJETO
   --------------------------------------------------------------------- */
estoqueModuleV4047 = function(){
  current='estoque';
  $('title').textContent='Estoque e rastreabilidade de materiais';
  $('subtitle').textContent='Saldo por entrada/lote/projeto calculado a partir das entradas e dos consumos efetivamente vinculados às OPs.';
  $('content').innerHTML=`<div class="toolbar"><button class="secondary" onclick="render('entradas')">← Entradas</button><select id="v47_stock_proj" onchange="v4047RenderStockTable()"><option value="">Todos os projetos</option>${(data.projetos||[]).map(p=>`<option value="${htmlEscape(p.CodProjeto||'')}">${htmlEscape(p.CodProjeto||'')} — ${htmlEscape(p['Nome Projeto']||'')}</option>`).join('')}</select><input id="v47_stock_q" placeholder="Material, lote, fornecedor..." oninput="v4047RenderStockTable()"><button onclick="exportEstoqueExcelV4047()">Exportar Excel de saldos</button></div><div class="v4047-stock-kpis" id="v1014_stock_kpis"></div><div id="v47_stock_tbl"></div>`;
  v4047RenderStockTable();
};
// Agora o cálculo dos KPIs acontece dentro da própria renderização da
// tabela, sempre a partir das linhas JÁ filtradas por projeto/texto —
// antes os cards de topo somavam o total geral e ignoravam o filtro.
v4047RenderStockTable = function(){
  let rows=v4047StockRows();
  const pr=$('v47_stock_proj')?.value||'', q=($('v47_stock_q')?.value||'').toLowerCase();
  if(pr) rows=rows.filter(r=>r.CodigoProjeto===pr);
  if(q) rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  const kpi=$('v1014_stock_kpis');
  if(kpi){
    kpi.innerHTML=`<div><small>Entradas/lotes${pr?' (projeto filtrado)':''}</small><b>${rows.length}</b></div><div><small>Com saldo</small><b>${rows.filter(r=>r.Saldo>0).length}</b></div><div><small>Qualificados</small><b>${rows.filter(r=>v4047Qualified(r.MaterialQualificado)).length}</b></div><div><small>Saldo total (soma UM mistas)</small><b>${v4034FormatNumber(rows.reduce((s,r)=>s+(r.Saldo>0?r.Saldo:0),0),3)}</b></div>`;
  }
  $('v47_stock_tbl').innerHTML=`<div class="table-wrap"><table><thead><tr>${['Entrada','Código','Material','Lote','Fornecedor','Projeto','UM','Qtd entrada','Consumido OP','Perdas','Saldo','Status','Qualificado','NF','OPs relacionadas'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td>${htmlEscape(r.Entrada)}</td><td>${htmlEscape(r.CodigoMaterial)}</td><td>${htmlEscape(r.Material)}</td><td>${htmlEscape(r.Lote)}</td><td>${htmlEscape(r.Fornecedor)}</td><td>${htmlEscape(r.Projeto)}</td><td>${htmlEscape(r.UM)}</td><td>${v4034FormatNumber(r.QtdEntrada,3)}</td><td>${v4034FormatNumber(r.ConsumoOP,3)}</td><td>${v4034FormatNumber(r.PerdasLote,3)}</td><td><b>${v4034FormatNumber(r.Saldo,3)}</b></td><td>${htmlEscape(r.StatusSaldo)}</td><td>${htmlEscape(r.MaterialQualificado)}</td><td>${htmlEscape(r.NotaFiscal)}</td><td>${htmlEscape(r.OPsRelacionadas)}</td></tr>`).join('')}</tbody></table></div>`;
};

/* ---------------------------------------------------------------------
   5) ESTRUTURA DO PRODUTO — ÁRVORE PA -> PI EXPANSÍVEL
   --------------------------------------------------------------------- */
const v1014EstruturaModuleBase = estruturaModule;
estruturaModule = function(){
  v1014EstruturaModuleBase();
  const box=$('content');
  if(!box) return;
  const host=document.createElement('div');
  host.className='v1014-tree-host';
  host.innerHTML=`<h3 class="section-title">Árvore de produtos (PA → PI)</h3><div id="v1014_tree"></div>`;
  const tbl=$('tbl');
  if(tbl) tbl.parentNode.insertBefore(host, tbl); else box.appendChild(host);
  v1014RenderEstruturaArvore();
};
function v1014EstruturaFilhos(codPai){
  return (data.estrutura||[]).filter(x=>String(x['Código Pai']||'')===String(codPai||''));
}
function v1014EstruturaNode(p, nivel){
  const filhos=v1014EstruturaFilhos(p['Código']);
  const tipo=String(p['Tipo Produto']||'').toUpperCase();
  const idx=(data.estrutura||[]).indexOf(p);
  return `<details class="v1014-tree-node" ${nivel<1?'open':''}>
    <summary>
      <span class="prod-badge-v382 ${tipo==='PA'?'pa':'pi'}">${htmlEscape(tipo||'PROD')}</span>
      <b>${htmlEscape(p['Código']||'')}</b>
      <em>${htmlEscape(p['Descrição']||'')}</em>
      ${filhos.length?`<small>${filhos.length} filho(s)</small>`:''}
      <button class="mini" onclick="event.preventDefault();event.stopPropagation();novoEstrutura(${idx})">Editar</button>
    </summary>
    ${filhos.length?`<div class="v1014-tree-children">${filhos.map(f=>v1014EstruturaNode(f,nivel+1)).join('')}</div>`:'<div class="empty-v382">Sem PI filho cadastrado.</div>'}
  </details>`;
}
function v1014RenderEstruturaArvore(){
  const host=$('v1014_tree');
  if(!host) return;
  const raizes=(data.estrutura||[]).filter(p=>String(p['Tipo Produto']||'').toUpperCase()==='PA');
  if(!raizes.length){host.innerHTML='<div class="hint">Cadastre um PA para ver a árvore.</div>';return;}
  host.innerHTML=raizes.map(p=>v1014EstruturaNode(p,0)).join('');
}

/* ---------------------------------------------------------------------
   6) + 7) OP DE PI ISOLADO — SELEÇÃO MÚLTIPLA COM FLAG E SALDO A USAR,
   SEM ABRIR OUTROS PA/PI NO ROTEIRO ISOLADO
   --------------------------------------------------------------------- */

// Substitui a tela de "Produzir PI isoladamente" por uma lista com
// checkbox (flag) por PI e um campo de quantidade/saldo a usar por linha,
// permitindo gerar várias OPs de PI isolado de uma só vez.
abrirOPPIIsolado = function(){
  const pis=(data.estrutura||[]).filter(p=>String(p['Tipo Produto']||'').toUpperCase()==='PI'&&v403RoteiroPI(p['Código']));
  if(!pis.length) return alert('Não há PI com roteiro salvo. Crie/salve um roteiro de PI isolado primeiro.');
  const linhas=pis.map((p,i)=>{
    const r=v403RoteiroPI(p['Código']);
    const um=v101ProductUM(p['Código'],r)||'un';
    const precisaFormula=v101PIRequiresFormula(p['Código'],r);
    return `<tr class="v1014-pi-row" data-cod="${htmlEscape(p['Código'])}">
      <td><input type="checkbox" class="v1014-pi-flag" id="v1014_pi_flag_${i}"></td>
      <td><b>${htmlEscape(p['Código'])}</b><br><small>${htmlEscape(p['Descrição']||'')}</small></td>
      <td>${htmlEscape(r?.CodRoteiro||'')}</td>
      <td><input class="v1014-pi-qtd" id="v1014_pi_qtd_${i}" type="number" min="0" step="0.000001" placeholder="Definir depois na OP"><span class="muted"> ${htmlEscape(um)}</span></td>
      <td>${precisaFormula?`<select class="v1014-pi-formula" id="v1014_pi_formula_${i}"><option value="">Selecionar formulação</option>${typeof formulaOptionsV3813==='function'?formulaOptionsV3813():''}</select>`:'<span class="muted">Não formulado</span>'}</td>
    </tr>`;
  }).join('');
  $('crudBox').innerHTML=`<div class="form"><h3>Produzir PI(s) isoladamente</h3>
    <p class="muted">Marque um ou mais PIs (flag). Informe o saldo/quantidade a usar de cada um — se deixar em branco, a quantidade é definida depois dentro da própria OP, como já acontece hoje. Cada PI marcado gera sua própria OP isolada; nenhum outro PA/PI é aberto ou vinculado.</p>
    <div class="table-wrap"><table><thead><tr><th>Gerar</th><th>PI</th><th>Roteiro</th><th>Saldo/Quantidade a usar</th><th>Formulação</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <div class="form-actions"><button class="green" onclick="confirmarOPPIIsoladoMultiplo()">Gerar OP(s) do(s) PI(s) marcado(s)</button><button class="secondary" onclick="$('crudBox').innerHTML=''">Cancelar</button></div>
    </div>`;
  $('crudBox').scrollIntoView({behavior:'smooth',block:'start'});
};

// Mantém a função antiga como alias, caso algum outro ponto do sistema
// ainda a referencie diretamente (compatibilidade).
confirmarOPPIIsolado = function(){ return confirmarOPPIIsoladoMultiplo(); };

function confirmarOPPIIsoladoMultiplo(){
  const linhas=[...document.querySelectorAll('.v1014-pi-row')];
  const marcadas=linhas.filter(l=>l.querySelector('.v1014-pi-flag')?.checked);
  if(!marcadas.length) return alert('Marque ao menos um PI para gerar a OP.');
  const criadas=[]; const erros=[];
  marcadas.forEach(linha=>{
    const cod=linha.dataset.cod;
    const r=v403RoteiroPI(cod);
    if(!r){erros.push(`${cod}: roteiro não encontrado`);return;}
    const precisaFormula=v101PIRequiresFormula(cod,r);
    const f=linha.querySelector('.v1014-pi-formula')?.value||'';
    if(precisaFormula && !f){erros.push(`${cod}: selecione a formulação`);return;}
    const qtdInformada=num(linha.querySelector('.v1014-pi-qtd')?.value||'');
    const base=baseOPCode();
    const op=v10CriarOPEstrutural(r,cod,base+'-PI',base);
    op.OP_Pai=''; op.OP_Base=op.CodOP; op.TipoOP='PI'; op.OrigemGeracao='PI_ISOLADO';
    op.UM=v101ProductUM(cod,r);
    if(qtdInformada>0){
      op.QtdPlanejada=String(qtdInformada);
      op.OrigemQtdPlanejada='INFORMADA_NA_GERACAO_PI_ISOLADO';
      (data.op_etapas||[]).filter(e=>e.CodOP===op.CodOP).forEach(e=>{e.QtdPlanejadaProduto=String(qtdInformada);});
    } else {
      op.QtdPlanejada='';
      op.OrigemQtdPlanejada='DEFINIR_NA_OP';
    }
    if(f) aplicarFormulaNasOPsV3813([op],f);
    criadas.push(op.CodOP);
  });
  saveLocal();
  if(erros.length) alert('Algumas OPs não foram geradas:\n- '+erros.join('\n- '));
  if(criadas.length){
    render('op');
    setTimeout(()=>{ if($('selOp')){ $('selOp').value=criadas[criadas.length-1]; showOP(); } },80);
    alert('OP(s) de PI isolado gerada(s):\n- '+criadas.join('\n- '));
  }
}

// Reforça o isolamento do roteiro de PI isolado: o editor de roteiro
// (tela "Roteiro") nunca deve oferecer outro PA/PI para adicionar
// operação quando o roteiro selecionado é do tipo PI_ISOLADO — mesmo que
// a base de dados/estrutura mude no futuro. A implementação existente já
// filtra por produto do próprio roteiro; este bloco apenas garante o
// comportamento de forma explícita e documentada.
const v1014ProdutosDoRoteiroBase = produtosDoRoteiroV382;
produtosDoRoteiroV382 = function(r){
  if(String(r?.TipoRoteiro||'').toUpperCase()==='PI_ISOLADO'){
    const cod=r.CodigoProduto||r.CodigoPI||'';
    const p=(data.estrutura||[]).find(x=>x['Código']===cod);
    return p?[p]:[];
  }
  return v1014ProdutosDoRoteiroBase(r);
};

// A tela de "Gerar OP por roteiro salvo" (fluxo de família PA) não deve
// listar roteiros de PI isolado — esses só são gerados pela tela
// dedicada "+ OP de PI isolado", evitando misturar os dois fluxos.
const v1014NovaOPPorRoteiroBase = novaOPPorRoteiro;
novaOPPorRoteiro = function(){
  const original=data.roteiro;
  data.roteiro=(data.roteiro||[]).filter(r=>String(r.TipoRoteiro||'').toUpperCase()!=='PI_ISOLADO');
  try{ v1014NovaOPPorRoteiroBase(); } finally { data.roteiro=original; }
};

/* ---------------------------------------------------------------------
   9) SIMULAÇÕES — SOMENTE OPs ENCERRADAS COM CUSTO VALIDADO
   --------------------------------------------------------------------- */
fillSimOPSelectV3817 = function(currentCod=''){
  const el=$('sim_op'); if(!el) return;
  const ops=(data.op||[]).filter(o=>o&&o.CodOP && v104IsClosed(o) && v104SavedCost(o.CodOP));
  el.innerHTML='<option value="">Selecione uma OP encerrada com custo validado...</option>'+ops.map(o=>`<option value="${htmlEscape(o.CodOP)}">${htmlEscape(opSimulacaoLabelV3817(o))}</option>`).join('');
  if(!ops.length) el.innerHTML='<option value="">Nenhuma OP encerrada com custo validado ainda</option>';
  if(currentCod&&ops.some(o=>o.CodOP===currentCod)) el.value=currentCod;
};

/* ---------------------------------------------------------------------
   10) + 11) CADASTRO DE RECURSOS/EQUIPAMENTOS — PROCESSO E ESCALA POR
   LISTA (sem digitação livre) + CONGELAMENTO AO REUTILIZAR EQUIPAMENTO
   EXISTENTE EM OUTRO PROCESSO
   --------------------------------------------------------------------- */

function v1014RecursosExistentes(){
  const map=new Map();
  (data.cad_recursos||[]).forEach(r=>{
    const cod=String(r['Código Equipamento']||'');
    if(cod && !map.has(cod)) map.set(cod,r);
  });
  return map;
}
function cadRecursosModule(){
  current='cad_recursos';
  $('title').textContent='Cadastro de Recursos';
  $('subtitle').textContent='Equipamentos vinculados a um processo cadastrado. Ao reutilizar um equipamento já existente em outro processo, os dados físicos do equipamento carregam automaticamente e ficam bloqueados para edição.';
  $('content').innerHTML=`<div class="toolbar"><button onclick="v1014NovoRecurso(-1)">+ Novo cadastro</button><input id="q" placeholder="Pesquisar..." oninput="v1014RenderRecursosTable()"></div><div id="crudBox"></div><div id="tbl"></div>`;
  v1014RenderRecursosTable();
}
function v1014RenderRecursosTable(){
  const q=($('q')?.value||'').toLowerCase();
  let rows=(data.cad_recursos||[]);
  if(q) rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  $('tbl').innerHTML=table('cad_recursos',rows);
}
function v1014NovoRecurso(idx=-1){
  const old=idx>=0?(data.cad_recursos[idx]||{}):{'Código Equipamento':nextRecursoCadastroCode(),'Ativo':'Sim','Escala':'Planta Piloto'};
  const existentes=v1014RecursosExistentes();
  const codOptions='<option value="">Novo equipamento (informar dados)</option>'+[...existentes.keys()].sort((a,b)=>Number(a)-Number(b)).map(c=>`<option value="${htmlEscape(c)}" ${old['Código Equipamento']===c&&idx>=0?'selected':''}>${htmlEscape(c)} — ${htmlEscape(existentes.get(c).Equipamento||'')}</option>`).join('');
  $('crudBox').innerHTML=`<div class="form edit-form"><h3>${idx<0?'Novo':'Editar'} recurso</h3>
    <div class="form-grid">
      <label><span>Equipamento já cadastrado?</span><select id="v1014_rec_existente" onchange="v1014AplicarRecursoExistente(${idx})">${codOptions}</select></label>
      <label><span>Código Equipamento</span><input id="v1014_rec_codigo" value="${htmlEscape(old['Código Equipamento']||'')}" ${idx>=0?'readonly':''}></label>
      <label><span>Equipamento</span><input id="v1014_rec_nome" value="${htmlEscape(old.Equipamento||'')}"></label>
      <label><span>Processo</span><select id="v1014_rec_processo">${v1014ProcessoOptions(old.Processo||'')}</select></label>
      <label><span>SubProcesso</span><input id="v1014_rec_sub" value="${htmlEscape(old.SubProcesso||'')}"></label>
      <label><span>Potência (W)</span><input id="v1014_rec_potencia" type="number" value="${htmlEscape(old['PotenciaEquipamento (W)']||'')}"></label>
      <label><span>Escala</span><select id="v1014_rec_escala">${v1014EscalaOptions(old.Escala||'Planta Piloto')}</select></label>
      <label><span>Ativo</span><select id="v1014_rec_ativo"><option ${old.Ativo!=='Não'?'selected':''}>Sim</option><option ${old.Ativo==='Não'?'selected':''}>Não</option></select></label>
      <label><span>Nº Patrimônio</span><input id="v1014_rec_patrimonio" value="${htmlEscape(old.NumeroPatrimonio||'')}"></label>
      <label><span>Capacidade</span><input id="v1014_rec_capacidade" value="${htmlEscape(old.Capacidade||'')}"></label>
      <label><span>Unidade Capacidade</span><input id="v1014_rec_unicap" value="${htmlEscape(old['Unidade Capacidade']||'')}"></label>
    </div>
    <p class="muted" id="v1014_rec_hint">${idx>=0?'Editando cadastro existente.':'Selecione um equipamento já cadastrado acima para reaproveitar os dados físicos (ficam bloqueados), ou preencha um equipamento novo.'}</p>
    <div class="form-actions"><button onclick="v1014SalvarRecurso(${idx})">Salvar cadastro</button>${idx>=0?`<button class="danger" onclick="deleteRecord('cad_recursos',${idx})">Excluir</button>`:''}<button class="secondary" onclick="$('crudBox').innerHTML=''">Cancelar</button></div>
    </div>`;
  if(idx>=0) v1014TravarCamposRecurso(true);
  $('crudBox').scrollIntoView({behavior:'smooth',block:'start'});
}
function v1014TravarCamposRecurso(travar){
  ['v1014_rec_nome','v1014_rec_potencia','v1014_rec_patrimonio','v1014_rec_capacidade','v1014_rec_unicap'].forEach(id=>{
    const el=$(id); if(el) el.readOnly=!!travar;
  });
}
function v1014AplicarRecursoExistente(idx){
  const cod=$('v1014_rec_existente')?.value||'';
  const hint=$('v1014_rec_hint');
  if(!cod){
    v1014TravarCamposRecurso(false);
    if($('v1014_rec_codigo')) $('v1014_rec_codigo').readOnly=false;
    if(hint) hint.textContent='Equipamento novo: preencha todos os dados físicos.';
    if(idx<0 && $('v1014_rec_codigo')) $('v1014_rec_codigo').value=nextRecursoCadastroCode();
    return;
  }
  const r=v1014RecursosExistentes().get(cod);
  if(!r) return;
  if($('v1014_rec_codigo')) $('v1014_rec_codigo').value=cod;
  if($('v1014_rec_nome')) $('v1014_rec_nome').value=r.Equipamento||'';
  if($('v1014_rec_potencia')) $('v1014_rec_potencia').value=r['PotenciaEquipamento (W)']||'';
  if($('v1014_rec_patrimonio')) $('v1014_rec_patrimonio').value=r.NumeroPatrimonio||'';
  if($('v1014_rec_capacidade')) $('v1014_rec_capacidade').value=r.Capacidade||'';
  if($('v1014_rec_unicap')) $('v1014_rec_unicap').value=r['Unidade Capacidade']||'';
  if($('v1014_rec_escala')) $('v1014_rec_escala').value=r.Escala||'Planta Piloto';
  if($('v1014_rec_codigo')) $('v1014_rec_codigo').readOnly=true;
  v1014TravarCamposRecurso(true);
  if(hint) hint.textContent='Dados físicos carregados do equipamento "'+(r.Equipamento||cod)+'" e bloqueados para edição. Só o processo/subprocesso desta linha ficam livres.';
}
function v1014SalvarRecurso(idx){
  const nome=($('v1014_rec_nome')?.value||'').trim();
  if(!nome) return alert('Informe o nome do equipamento.');
  if(!$('v1014_rec_processo')?.value) return alert('Selecione o processo cadastrado.');
  const old=idx>=0?(data.cad_recursos[idx]||{}):{};
  const o={...old,
    'Código Equipamento':$('v1014_rec_codigo')?.value||nextRecursoCadastroCode(),
    Equipamento:nome,
    Processo:$('v1014_rec_processo').value,
    SubProcesso:$('v1014_rec_sub')?.value||'',
    'PotenciaEquipamento (W)':$('v1014_rec_potencia')?.value||'',
    Escala:$('v1014_rec_escala')?.value||'Planta Piloto',
    Ativo:$('v1014_rec_ativo')?.value||'Sim',
    NumeroPatrimonio:$('v1014_rec_patrimonio')?.value||'',
    Capacidade:$('v1014_rec_capacidade')?.value||'',
    'Unidade Capacidade':$('v1014_rec_unicap')?.value||''
  };
  data.cad_recursos=data.cad_recursos||[];
  if(idx>=0) data.cad_recursos[idx]=o; else data.cad_recursos.unshift(o);
  saveLocal(); cadRecursosModule();
}

// Também trava a Escala no cadastro simplificado "Recursos / Custos"
// (tabela 'recursos'), que usa o formulário genérico — troca o campo
// livre por lista fixa e o Processo por lista do cadastro de processos.
const v1014InputForFieldBase = inputForField;
inputForField = function(k,c,row){
  if(k==='recursos' && c==='Escala') return `<label><span>${htmlEscape(c)}</span><select data-field="${htmlEscape(c)}">${v1014EscalaOptions(row[c]||'')}</select></label>`;
  if((k==='recursos') && (c==='Processo'||c==='processo')) return `<label><span>${htmlEscape(c)}</span><select data-field="${htmlEscape(c)}">${v1014ProcessoOptions(row[c]||'')}</select></label>`;
  return v1014InputForFieldBase(k,c,row);
};

/* ---------------------------------------------------------------------
   12) APONTAMENTO — HORÁRIO DE INÍCIO/FIM + TABELA AUXILIAR + WIP
   --------------------------------------------------------------------- */
data.apontamento_tempos = data.apontamento_tempos || [];
if(fields && !fields.apontamento_tempos) fields.apontamento_tempos=['IdApontamentoTempo','CodOP','Processo','Operador','DataApontamento','HoraInicio','HoraFim','Status'];

function v1014HoraAgora(){
  const d=new Date();
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function v1014ApontamentoAberto(codOP,processo){
  return (data.apontamento_tempos||[]).find(a=>a.CodOP===codOP && a.Processo===processo && a.Status==='Iniciado');
}
function v1014IniciarApontamento(){
  const op=selectedOP('prod_op'); if(!op.CodOP) return alert('Selecione uma OP.');
  const processo=$('ap_etapa')?.value||'';
  if(v1014ApontamentoAberto(op.CodOP,processo)) return alert('Já existe um apontamento iniciado para esta OP/etapa. Finalize-o antes de iniciar outro.');
  data.apontamento_tempos.push({
    IdApontamentoTempo:'AT'+Date.now().toString(36).toUpperCase(),
    CodOP:op.CodOP, Processo:processo, Operador:$('ap_operador')?.value||'',
    DataApontamento:$('ap_data')?.value||todayBR(), HoraInicio:v1014HoraAgora(), HoraFim:'', Status:'Iniciado'
  });
  saveLocal(); showProdOP();
}
function v1014FinalizarApontamento(){
  const op=selectedOP('prod_op'); if(!op.CodOP) return alert('Selecione uma OP.');
  const processo=$('ap_etapa')?.value||'';
  const aberto=v1014ApontamentoAberto(op.CodOP,processo);
  if(!aberto) return alert('Não há apontamento iniciado para esta OP/etapa.');
  aberto.HoraFim=v1014HoraAgora(); aberto.Status='Finalizado';
  saveLocal(); showProdOP();
}
// Injeta os campos de horário e os botões Iniciar/Finalizar na tela de
// apontamento, sem remover o fluxo de "Registrar produção" já existente.
const v1014ShowProdOPBase = showProdOP;
showProdOP = function(){
  v1014ShowProdOPBase();
  const box=$('prodBox'); if(!box) return;
  const grid=box.querySelector('.op-form .form-grid');
  if(!grid || grid.querySelector('#ap_hora_ini')) return;
  const op=selectedOP('prod_op');
  const processo=$('ap_etapa')?.value||'';
  const aberto=v1014ApontamentoAberto(op.CodOP,processo);
  const wrap=document.createElement('div'); wrap.className='v1014-tempo-wrap';
  wrap.innerHTML=`<label><span>Horário de início</span><input id="ap_hora_ini" value="${htmlEscape(aberto?.HoraInicio||'')}" placeholder="hh:mm"></label><label><span>Horário de fim</span><input id="ap_hora_fim" value="${htmlEscape(aberto?.HoraFim||'')}" placeholder="hh:mm"></label>`;
  while(wrap.firstElementChild) grid.appendChild(wrap.firstElementChild);
  const actions=box.querySelector('.op-form .form-actions');
  if(actions && !actions.querySelector('.v1014-ap-tempo-btn')){
    const bIni=document.createElement('button'); bIni.className='secondary v1014-ap-tempo-btn'; bIni.textContent=aberto?'Apontamento já iniciado':'Iniciar apontamento'; bIni.disabled=!!aberto; bIni.onclick=v1014IniciarApontamento;
    const bFim=document.createElement('button'); bFim.className='secondary v1014-ap-tempo-btn'; bFim.textContent='Finalizar apontamento'; bFim.disabled=!aberto; bFim.onclick=v1014FinalizarApontamento;
    actions.appendChild(bIni); actions.appendChild(bFim);
  }
  const status=$('ap_hora_ini')?.closest('.op-form');
  if(status && !status.querySelector('.v1014-ap-status')){
    const historico=(data.apontamento_tempos||[]).filter(a=>a.CodOP===op.CodOP);
    const div=document.createElement('div'); div.className='v1014-ap-status';
    if(historico.length){
      div.innerHTML=`<b>Apontamentos de tempo desta OP</b><div class="table-wrap"><table><thead><tr><th>Processo</th><th>Operador</th><th>Data</th><th>Início</th><th>Fim</th><th>Status</th></tr></thead><tbody>${historico.map(h=>`<tr><td>${htmlEscape(h.Processo)}</td><td>${htmlEscape(h.Operador)}</td><td>${htmlEscape(h.DataApontamento)}</td><td>${htmlEscape(h.HoraInicio)}</td><td>${htmlEscape(h.HoraFim)}</td><td>${htmlEscape(h.Status)}</td></tr>`).join('')}</tbody></table></div>`;
      status.appendChild(div);
    }
  }
};

// WIP no dashboard: como a tela "Dashboard" hoje redireciona para a lista
// de OPs (dashboard = render('op')), o indicador de WIP (em andamento)
// entra como um painel no topo da tela de Ordens de Produção — cartão de
// resumo + lista do fluxo de produção em andamento.
function v1014WIPCounts(){
  const iniciados=(data.apontamento_tempos||[]).filter(a=>a.Status==='Iniciado').length;
  const finalizadosHoje=(data.apontamento_tempos||[]).filter(a=>a.Status==='Finalizado' && a.DataApontamento===todayBR()).length;
  const opsEmProducao=(data.op||[]).filter(o=>statusOP(o).includes('EM PRODU')).length;
  return {iniciados,finalizadosHoje,opsEmProducao};
}

/* -----------------------------------------------------------------------
   V1.0.18 — DESTAQUE NO WIP PARA PI(s) ORIUNDOS DE OUTRA PRODUÇÃO
   Uma OP entra no fluxo "misturada" com outra produção em dois casos:
   1) Ela é uma OP de PI isolado (OrigemGeracao === 'PI_ISOLADO') — feita
      fora de uma família de PA específica.
   2) Ela consumiu, como insumo, um lote de PI cujo OP de origem pertence
      a uma família (PA) DIFERENTE da própria família desta OP — ou seja,
      um PI "pronto" trazido de outra produção para completar esta.
   Em ambos os casos, a OP recebe a marca visual rosa no WIP.
   ----------------------------------------------------------------------- */
function v1018OrigemExterna(op){
  if(!op) return null;
  if(String(op.OrigemGeracao||'')==='PI_ISOLADO') return {tipo:'PI isolado', detalhe:'OP de PI produzido isoladamente, fora de uma família de PA.'};
  const meuRoot = typeof v1011FamilyRoot==='function' ? v1011FamilyRoot(op) : (op.OP_Pai||op.OP_Base||op.CodOP);
  const consumos = (data.op_pi_consumos||[]).filter(c=>c.CodOPConsumidora===op.CodOP && String(c.Status||'ATIVO')!=='CANCELADO');
  for(const c of consumos){
    const opOrigem = opPorCodigo(c.CodOPOrigemPI);
    if(!opOrigem) continue;
    const rootOrigem = typeof v1011FamilyRoot==='function' ? v1011FamilyRoot(opOrigem) : (opOrigem.OP_Pai||opOrigem.OP_Base||opOrigem.CodOP);
    if(rootOrigem && rootOrigem!==meuRoot){
      return {tipo:'PI de outra produção', detalhe:`Usa o lote ${c.IdLotePI} (${c.CodigoPI}), produzido na OP ${c.CodOPOrigemPI} de outra família.`};
    }
  }
  return null;
}

// Lista das OPs atualmente em andamento (fluxo de produção), com destaque
// rosa para as que trazem PI de outra produção ou vêm de PI isolado.
function v1018FluxoWIPHTML(){
  const emAndamento=(data.op||[]).filter(o=>statusOP(o).includes('EM PRODU')||statusOP(o).includes('PLANEJAD'));
  if(!emAndamento.length) return '<p class="muted">Nenhuma OP em andamento no momento.</p>';
  const rows=emAndamento.map(op=>{
    const info=opProductInfo(op);
    const externa=v1018OrigemExterna(op);
    const aberto=(data.apontamento_tempos||[]).find(a=>a.CodOP===op.CodOP&&a.Status==='Iniciado');
    return `<div class="v1018-wip-item ${externa?'v1018-wip-pink':''}" title="${externa?htmlEscape(externa.detalhe):''}">
      <div class="v1018-wip-top"><b>${htmlEscape(op.CodOP)}</b>${externa?`<span class="v1018-wip-badge">${htmlEscape(externa.tipo)}</span>`:''}</div>
      <div class="v1018-wip-mid">${htmlEscape(info.cod||'')} — ${htmlEscape(info.desc||'')}</div>
      <div class="v1018-wip-bottom"><span>${htmlEscape(statusOP(op))}</span>${aberto?`<span class="v1018-wip-live">● apontamento em andamento</span>`:''}</div>
    </div>`;
  }).join('');
  return `<div class="v1018-wip-flow">${rows}</div>`;
}

const v1014OpModuleBase = opModule;
opModule = function(){
  v1014OpModuleBase();
  const content=$('content'); if(!content) return;
  content.querySelector('.v1014-wip-card')?.remove();
  content.querySelector('.v1018-wip-panel')?.remove();
  const c=v1014WIPCounts();
  const panel=document.createElement('div');
  panel.className='v1018-wip-panel';
  panel.innerHTML=`<div class="v1014-wip-card"><div><small>OPs em produção</small><b>${c.opsEmProducao}</b></div><div><small>Apontamentos em andamento (WIP)</small><b>${c.iniciados}</b></div><div><small>Finalizados hoje</small><b>${c.finalizadosHoje}</b></div></div>
    <h3 class="section-title">Fluxo de produção em andamento</h3>
    <p class="muted">Itens em <span class="v1018-wip-badge">rosa</span> são PI isolado ou usam PI vindo de outra produção dentro deste fluxo.</p>
    ${v1018FluxoWIPHTML()}`;
  const toolbar=content.querySelector('.toolbar');
  if(toolbar) toolbar.insertAdjacentElement('afterend',panel); else content.insertBefore(panel,content.firstChild);
};

/* ---------------------------------------------------------------------

   13) HELP DESK — REVERTIDO PARA O FORMATO ANTIGO NA V1.0.15
   A versão V1.0.14 trocou o <iframe> do fluxo por um desenho embutido na
   página (SVG) para reduzir uma requisição de rede. O visual não agradou,
   então esta versão volta exatamente ao formato anterior (V40.1): overlay
   com <iframe src="assets/helpdesk_fluxo_mes_lion.html">, igual ao que já
   existia antes da V1.0.14. A otimização de desempenho real (item 13
   original) é mantida do lado do servidor — ver servidor_mes_lion.ps1,
   que passou a permitir cache do navegador para arquivos estáticos e
   reduziu o polling ocioso de 150ms para 20ms. Isso já deixa a abertura
   do Help Desk (e do resto do sistema) mais rápida sem mudar o visual.
   --------------------------------------------------------------------- */
function closeHelpDeskV40(){ document.getElementById('v40HelpOverlay')?.remove(); }
function openHelpDeskV40(k=current||'dashboard'){
  closeHelpDeskV40();
  const title=modules.find(m=>m[0]===k)?.[1]||k;
  const d=document.createElement('div'); d.id='v40HelpOverlay'; d.className='v40-help-overlay';
  d.innerHTML=`<div class="v40-help"><header><div><b>MES LION — Help Desk</b><span>${htmlEscape(title)}</span></div><div><button onclick="window.open('assets/helpdesk_fluxo_mes_lion.html?v=40.1','_blank')">Abrir fluxo em nova aba</button><button onclick="closeHelpDeskV40()">Fechar</button></div></header><section><b>Procedimento do módulo</b><p>${htmlEscape(typeof helpProcedureV395==='function'?helpProcedureV395(k):'')}</p></section><div class="v40-help-frame"><iframe src="assets/helpdesk_fluxo_mes_lion.html?v=40.1" title="Fluxo MES LION estilo Bizagi"></iframe></div></div>`;
  d.addEventListener('click',e=>{ if(e.target===d) closeHelpDeskV40(); });
  document.body.appendChild(d);
}
// Botão de navegação e botão por módulo já injetados pelas versões
// anteriores continuam chamando openHelpDeskV40, agora de volta ao
// formato com iframe.

/* ---------------------------------------------------------------------
   REGISTRO DE NAVEGAÇÃO — 'categorias' e 'cad_recursos' (tela própria)
   --------------------------------------------------------------------- */
if(!modules.some(m=>m[0]==='categorias')) modules.push(['categorias','Categorias de Materiais']);
const v1014GrupoMateriais=moduleGroups.find(g=>g.title==='Materiais');
if(v1014GrupoMateriais && !v1014GrupoMateriais.items.includes('categorias')) v1014GrupoMateriais.items.push('categorias');

const v1014RenderBase = render;
render = function(k){
  if(k==='categorias'){
    current=k; document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active')); $('nav_categorias')?.classList.add('active');
    return categoriasModule();
  }
  if(k==='cad_recursos'){
    current=k; document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active')); $('nav_cad_recursos')?.classList.add('active');
    return cadRecursosModule();
  }
  return v1014RenderBase(k);
};
const v1014NewRecordBase = newRecord;
newRecord = function(k){ if(k==='categorias') return v1014NovaCategoria(-1); if(k==='cad_recursos') return v1014NovoRecurso(-1); return v1014NewRecordBase(k); };
const v1014EditRecordBase = editRecord;
editRecord = function(k,idx){ if(k==='categorias') return v1014NovaCategoria(idx); if(k==='cad_recursos') return v1014NovoRecurso(idx); return v1014EditRecordBase(k,idx); };
// Re-renderiza o menu lateral para incluir "Categorias".
try{ renderNav(); const b=$('nav_'+current); if(b) b.classList.add('active'); }catch(e){}

try{
  data.meta=data.meta||{};
  data.meta.versao=APP_VERSION_V1014;
  data.meta.baseOperacional='Filtros de materiais/estoque corrigidos, árvore de estrutura, PI isolado múltiplo, cadastros por lista fixa, apontamento com tempos; Help Desk de volta ao formato com iframe (a pedido)';
  saveLocal();
  document.title='MES LION V1.0.15';
}catch(e){ console.warn('MES LION V1.0.15',e); }

/* =========================================================================
   RELATÓRIO DE OBSOLESCÊNCIA (item 8) — NADA FOI APAGADO AUTOMATICAMENTE
   =========================================================================
   O app.js usa o padrão "capturar função atual -> estender -> reatribuir"
   em praticamente toda a evolução do sistema (ex.: roteiro, opModule,
   showOP, render, dashboard). Isso cria muitas funções com o MESMO NOME
   declaradas várias vezes ao longo do arquivo — só a ÚLTIMA realmente
   roda, mas várias são a BASE capturada por versões seguintes (não são
   código morto: fazem parte de uma cadeia ativa). Remover a função errada
   quebra a cadeia inteira. Por isso, esta versão NÃO apaga nada sozinha.

   Candidatos confirmados como SEGUROS de remover numa limpeza futura
   (nenhuma versão posterior captura ou depende deles):
   1. dashboard() antigo em cards de KPI (linhas ~7687/7795 da V1.0) — a
      versão realmente usada hoje é "dashboard=function(){return
      render('op');}" (fim do arquivo). As duas versões anteriores nunca
      são chamadas nem capturadas como base por nada.
   2. entradasModule()/addEntrada() das versões pré-V40.4.7 (linhas ~393 e
      ~859) — inteiramente substituídas pela versão V40.4.7 (linha 8595),
      que por sua vez este patch V1.0.14 volta a redefinir.
   3. recursosModule() e recalcularRecursos() antigos citando campos tipo
      "TempoOperação (min)" com acentuação diferente do restante do
      sistema — divergem do padrão atual "TempoOperacaoMin".
   4. Registros de teste embutidos no código (ex.: 'OP-TESTE-BP-001',
      'OP-TESTE-BP-002' usados só para demonstrar o Passaporte da
      Bateria) — não fazem parte de nenhum fluxo de produção real.
   5. (Nota da V1.0.15: o item 5 do relatório original da V1.0.14 dizia
      que assets/helpdesk_fluxo_mes_lion.html deixaria de ser usado — isso
      foi revertido. O Help Desk voltou a usar esse arquivo via <iframe>,
      então ele continua ativo e não deve ser removido.)

   Candidatos que PARECEM duplicados mas são cadeias ativas (NÃO REMOVER
   sem reescrever a cadeia inteira e testar cada etapa):
   - roteiro(), opModule(), showOP(), custosModule(), simulacoesModule(),
     confirmarGerarOPPA(), gerarOPDoRoteiro() e variantes — cada versão
     posterior chama a anterior capturada (padrão "*Base()"). Apagar uma
     etapa intermediária quebra a versão final.

   Recomendação: numa próxima rodada dedicada só a isso, consolidar cada
   cadeia (ex.: roteiro V1.0 -> V1.0.1 -> ... -> V1.0.13) em uma única
   função, testando tela por tela, e só então apagar os degraus
   intermediários. Isso não foi feito agora para não arriscar quebrar o
   sistema em produção nesta mesma entrega.
   ========================================================================= */

/* =========================================================================
   MES LION V1.0.16 — CORREÇÃO: ESCALA ÚNICA (PLANTA PILOTO / INDUSTRIAL)
   =========================================================================
   Relato do usuário: ao criar um roteiro com escala Industrial/Semi-
   industrial, a tela não atualizava e o WIP não aparecia.

   Causa raiz encontrada: existiam DUAS listas de escala diferentes e
   inconsistentes no próprio app.js original:
   - Tela "+ Novo roteiro" (novoRoteiroV388 / campo rt388_escala): oferecia
     Planta Piloto, Semi-industrial e Industrial.
   - Tela de edição do roteiro (renderRoteiroArvoreV382 / campo
     v382_escala) e a criação de roteiro de PI isolado (v403_pi_scale):
     ofereciam só Planta Piloto e Semi-industrial — SEM Industrial.
   Resultado prático: ao criar um roteiro como "Industrial" e depois abrir
   o editor do roteiro, o campo de escala não tinha essa opção, o
   navegador caía para a primeira opção da lista (Planta Piloto) e, ao
   salvar o roteiro (ex.: clicar em "Salvar roteiro"), a escala do
   roteiro era silenciosamente sobrescrita — sem nenhum aviso de erro.

   Correção: conforme definido pelo usuário, só existem duas linhas —
   Planta Piloto e Industrial. "Semi-industrial" e "Laboratório" saem de
   circulação em todas as telas (roteiro, PI isolado, cadastro de
   recursos). Registros antigos com essas escalas são migrados para o
   valor mais próximo (Semi-industrial -> Industrial, Laboratório ->
   Planta Piloto) uma única vez, na primeira carga desta versão.
   ========================================================================= */

// Lista única de escalas, agora com só as duas linhas reais.
V1014_ESCALAS.length = 0;
V1014_ESCALAS.push('Planta Piloto','Industrial','Testes de Caracterização');

// Migração de dados: roda uma única vez (marca em data.meta) para não
// reprocessar a cada carregamento da página.
(function v1016MigrarEscalas(){
  if(data.meta && data.meta.migracaoEscalaV1016) return;
  const map = {'Semi-industrial':'Industrial','Semi-Industrial':'Industrial','Laboratório':'Planta Piloto','Laboratorio':'Planta Piloto'};
  let alterados = 0;
  (data.roteiro||[]).forEach(r=>{
    if(map[r.EscalaProducao]){ r.EscalaProducao = map[r.EscalaProducao]; alterados++; }
    if(map[r.Escala]){ r.Escala = map[r.Escala]; }
  });
  (data.cad_recursos||[]).forEach(r=>{ if(map[r.Escala]){ r.Escala = map[r.Escala]; alterados++; } });
  (data.recursos||[]).forEach(r=>{ if(map[r.Escala]){ r.Escala = map[r.Escala]; alterados++; } });
  (data.roteiro_etapas||[]).forEach(e=>{ if(map[e.Escala]){ e.Escala = map[e.Escala]; } });
  data.meta = data.meta||{};
  data.meta.migracaoEscalaV1016 = true;
  data.meta.registrosMigradosEscalaV1016 = alterados;
  if(alterados) saveLocal();
})();

// 1) Tela "+ Novo roteiro" — troca a lista de escala do cabeçalho.
const v1016NovoRoteiroV388Base = novoRoteiroV388;
novoRoteiroV388 = function(idx=-1){
  v1016NovoRoteiroV388Base(idx);
  const sel=$('rt388_escala'); if(!sel) return;
  const old = idx>=0 ? (data.roteiro[idx]||{}) : {};
  sel.innerHTML = v1014EscalaOptions(old.EscalaProducao||'Planta Piloto');
};

// 2) Editor do roteiro (tela "Roteiro", árvore PA/PI → operações) — troca
// a lista de escala do cabeçalho de edição, que era a causa raiz.
const v1016RenderRoteiroArvoreBase = renderRoteiroArvoreV382;
renderRoteiroArvoreV382 = function(){
  v1016RenderRoteiroArvoreBase();
  const sel=$('v382_escala'); if(!sel) return;
  const r=roteiroAtualV382();
  sel.innerHTML = v1014EscalaOptions(r.EscalaProducao||'Planta Piloto');
};

// 3) Criação de roteiro de PI isolado — mesma lista, sem Semi-industrial.
const v1016NovoRoteiroPIIsoladoBase = novoRoteiroPIIsolado;
novoRoteiroPIIsolado = function(){
  v1016NovoRoteiroPIIsoladoBase();
  const sel=$('v403_pi_scale'); if(!sel) return;
  sel.innerHTML = v1014EscalaOptions('Planta Piloto');
};

try{
  data.meta=data.meta||{};
  data.meta.versao='V1.0.16';
  data.meta.baseOperacional=(data.meta.baseOperacional||'')+' | V1.0.16: escala unificada (Planta Piloto / Industrial), corrige roteiro que não salvava a escala Industrial';
  saveLocal();
  document.title='MES LION V1.0.16';
}catch(e){ console.warn('MES LION V1.0.16',e); }

/* =========================================================================
   MES LION V1.0.17 — SELECIONAR VÁRIOS LOTES DE PI PRONTO PARA A MESMA OP
   =========================================================================
   Antes: ao escolher "Usar PI pronto / lote existente" na tela Estruturar
   OP, só era possível marcar UM lote por PI, mesmo quando havia vários
   lotes disponíveis com saldo (ex.: 2 lotes menores que juntos cobrem a
   quantidade necessária, mas nenhum sozinho cobre).
   Agora: quando há mais de um lote compatível, aparece uma lista com
   flag (checkbox) por lote + quantidade a usar de cada um. Pode marcar
   vários lotes para o mesmo PI/OP; a quantidade total consumida é a soma
   dos lotes marcados, e cada lote fica rastreado separadamente (cada um
   gera seu próprio registro de consumo/rastreabilidade).
   ========================================================================= */

// Linha da tabela de planejamento: troca o <select> único de lote por uma
// lista de checkboxes + quantidade por lote, quando existe mais de uma
// opção compatível (com 0 ou 1 lote o comportamento visual é o mesmo).
v1011PlanningRowsHTML = function(r, codFormula){
  const rows = v1011RouteProducts(r);
  return `<div class="v1011-family-plan"><div class="card"><h3>Estrutura da produção — informe origem e quantidade de cada PI</h3><p class="muted">A formulação <b>${htmlEscape(codFormula||'')}</b> será aplicada somente aos slurrys. Para os demais PIs, a etapa consome o PI anterior. Se um ou mais PIs prontos forem selecionados, nenhuma OP será criada para fabricá-los — a quantidade necessária pode ser somada a partir de vários lotes.</p><div class="table-wrap"><table><thead><tr><th>Seq.</th><th>PI / PA</th><th>Nome</th><th>Processo</th><th>Origem</th><th>Lote(s) PI pronto</th><th>Quantidade / massa a produzir</th><th>UM</th></tr></thead><tbody>${rows.map((cod,i)=>{
    const p=v1011Prod(cod), role=v1011Role(cod), isPA=role==='PA', lots=isPA?[]:v1011LotsForRole(role), um=v101ProductUM(cod,r)||prodUMV382(cod)||unidadeProdutoV35(cod)||'un';
    const lotsHtml = lots.length ? `<div class="v1017-lots-wrap">${lots.map(l=>`<label class="v1017-lot-row"><input type="checkbox" class="v1017-lot-flag" data-lotid="${htmlEscape(l.IdLotePI)}" disabled onchange="v1017SyncLotQty(this)"><span>${htmlEscape(v1011LotLabel(l))}</span><input type="number" class="v1017-lot-qty" min="0" step="0.000001" max="${v403SaldoLote(l)}" placeholder="Qtd deste lote" disabled></label>`).join('')}</div>` : '<div class="empty-v382">Sem lote compatível</div>';
    return `<tr class="v1011-plan-row" data-code="${htmlEscape(cod)}" data-role="${role}"><td>${i+1}</td><td><b>${htmlEscape(cod)}</b></td><td>${htmlEscape(p['Descrição']||'')}</td><td>${htmlEscape(v1011RouteProcess(r,cod)||v1011RoleLabel(role))}</td><td>${isPA?'<b>Produzir PA</b>':`<select class="v1011-origin" onchange="v1011ToggleLot(this)"><option value="PRODUZIR">Produzir nova OP</option><option value="LOTE" ${lots.length?'':'disabled'}>Usar PI pronto / lote(s) existente(s)${lots.length?'':' (sem saldo)'}</option></select>`}</td><td>${isPA?'—':lotsHtml}</td><td><input class="v1011-qtd" type="number" min="0" step="0.000001" placeholder="Informe ${um}"></td><td><b>${htmlEscape(um)}</b></td></tr>`;
  }).join('')}</tbody></table></div><div class="form-actions"><button class="green" onclick="v1011ConfirmFamily('${jsq(r.CodRoteiro)}','${jsq(codFormula)}')">Gerar estrutura de OPs</button><button class="secondary" onclick="$('crudBox').innerHTML=''">Cancelar</button></div></div></div>`;
};

// Habilita/desabilita a lista de lotes (flags + quantidade) conforme a
// origem escolhida (Produzir nova OP x Usar PI pronto).
v1011ToggleLot = function(sel){
  const row = sel.closest('.v1011-plan-row');
  const usaLote = sel.value === 'LOTE';
  row?.querySelectorAll('.v1017-lot-flag,.v1017-lot-qty').forEach(el=>{ el.disabled = !usaLote; });
  if(!usaLote){
    row?.querySelectorAll('.v1017-lot-flag').forEach(cb=>{ cb.checked=false; });
    row?.querySelectorAll('.v1017-lot-qty').forEach(inp=>{ inp.value=''; });
  }
  // Ao trocar para "Usar PI pronto", o campo de quantidade total passa a
  // ser calculado a partir da soma dos lotes marcados.
  v1017RecalcRowTotal(row);
};
// Ao marcar/desmarcar um lote, sugere automaticamente o saldo disponível
// como quantidade (o usuário pode reduzir) e recalcula o total da linha.
function v1017SyncLotQty(cb){
  const row = cb.closest('.v1011-plan-row');
  const qtyInput = cb.closest('.v1017-lot-row')?.querySelector('.v1017-lot-qty');
  if(cb.checked){
    if(qtyInput && !num(qtyInput.value)){
      const max = num(qtyInput.max);
      if(max>0) qtyInput.value = String(max);
    }
  } else if(qtyInput){
    qtyInput.value = '';
  }
  v1017RecalcRowTotal(row);
}
// Mantém o campo "Quantidade / massa" da linha como a soma dos lotes
// marcados, só como referência visual (somatório real é lido no plano).
function v1017RecalcRowTotal(row){
  if(!row) return;
  const origin = row.querySelector('.v1011-origin')?.value;
  if(origin!=='LOTE') return;
  const total = [...row.querySelectorAll('.v1017-lot-flag:checked')].reduce((s,cb)=>{
    const q = num(cb.closest('.v1017-lot-row')?.querySelector('.v1017-lot-qty')?.value);
    return s+q;
  },0);
  const qtdInput = row.querySelector('.v1011-qtd');
  if(qtdInput) qtdInput.value = total>0 ? String(total) : '';
}
// Também recalcula o total ao editar manualmente a quantidade de um lote.
document.addEventListener('input', e=>{
  if(e.target?.classList?.contains('v1017-lot-qty')){
    v1017RecalcRowTotal(e.target.closest('.v1011-plan-row'));
  }
});

// Lê o plano da tela: para linhas em modo "LOTE", agora retorna a lista
// de lotes marcados (com a quantidade de cada um), em vez de um único id.
v1011ReadPlan = function(){
  return [...document.querySelectorAll('.v1011-plan-row')].map(row=>{
    const origin = row.querySelector('.v1011-origin')?.value || 'PRODUZIR';
    const um = row.querySelector('td:last-child')?.textContent?.trim() || '';
    let lots = [];
    if(origin==='LOTE'){
      lots = [...row.querySelectorAll('.v1017-lot-flag:checked')].map(cb=>({
        lotId: cb.dataset.lotid,
        q: num(cb.closest('.v1017-lot-row')?.querySelector('.v1017-lot-qty')?.value)
      })).filter(x=>x.q>0);
    }
    const q = origin==='LOTE' ? lots.reduce((s,x)=>s+x.q,0) : num(row.querySelector('.v1011-qtd')?.value);
    return {code: row.dataset.code, role: row.dataset.role, origin, lots, q, um};
  });
};

// Confirmação da família: valida cada lote individualmente (saldo próprio)
// e, na geração, cria um consumo/rastreabilidade por lote selecionado,
// somando as quantidades no material consumido pela etapa seguinte.
v1011ConfirmFamily = function(codRoteiro, codFormula){
  const r=(data.roteiro||[]).find(x=>x.CodRoteiro===codRoteiro); if(!r) return alert('Roteiro não encontrado.');
  const plan=v1011ReadPlan(); if(!plan.length) return alert('Estrutura do roteiro vazia.');
  for(const x of plan){
    if(!(x.q>0)) return alert(`Informe a quantidade/massa de ${x.code} — ${v1011Prod(x.code)['Descrição']||''}.`);
    if(x.origin==='LOTE'){
      if(!x.lots.length) return alert(`Selecione ao menos um lote pronto para ${x.code}, ou marque a quantidade de cada lote escolhido.`);
      for(const lsel of x.lots){
        const lot=(data.pi_lotes||[]).find(l=>l.IdLotePI===lsel.lotId);
        if(!lot) return alert(`Lote não encontrado para ${x.code}.`);
        if(lsel.q>v403SaldoLote(lot)+1e-9) return alert(`Saldo insuficiente no lote ${lot.IdLotePI}. Disponível: ${fmtMax4V395(v403SaldoLote(lot))} ${lot.UM||''}.`);
      }
    }
  }
  const base=baseOPCode(), created=[], sourcesByRole={}, sourceByCode={}; let seq=1, pa=null;
  let lotesUsados=0;
  // Cria somente OPs realmente necessárias. PI(s) pronto(s) eliminam a OP correspondente.
  plan.filter(x=>x.role!=='PA').forEach(x=>{
    if(x.origin==='LOTE'){
      sourcesByRole[x.role]=sourcesByRole[x.role]||[];
      x.lots.forEach(lsel=>{
        const lot=(data.pi_lotes||[]).find(l=>l.IdLotePI===lsel.lotId);
        const src={code:lot.CodigoPI, role:x.role, lot, q:lsel.q, um:lot.UM||x.um};
        sourcesByRole[x.role].push(src); lotesUsados++;
      });
      sourceByCode[x.code]=sourcesByRole[x.role];
      return;
    }
    const op=v10CriarOPEstrutural(r,x.code,base+'-'+pad(seq++,2),base);op.QtdPlanejada=String(x.q);op.UM=x.um||v101ProductUM(x.code,r)||op.UM;op.OrigemQtdPlanejada='INFORMADA_NA_ESTRUTURA_DA_OP';op.OrigemGeracao='CADEIA_PI_V1.0.11';op.OP_Base=base;op.OP_Pai=base;(data.op_etapas||[]).filter(e=>e.CodOP===op.CodOP).forEach(e=>{e.QtdPlanejadaProduto=String(x.q);e.UMProduto=op.UM;});
    if(v1011IsSlurry(op))aplicarFormulaNasOPsV3813([op],codFormula);else v1011StripFormulaFromNonSlurry(op);
    const src={code:x.code,role:x.role,op,q:x.q,um:op.UM};sourcesByRole[x.role]=[src];sourceByCode[x.code]=[src];created.push(op);
  });
  const pRow=plan.find(x=>x.role==='PA');if(pRow){pa=v10CriarOPEstrutural(r,pRow.code,base+'-PA',base);pa.QtdPlanejada=String(pRow.q);pa.UM=pRow.um||v101ProductUM(pRow.code,r)||pa.UM;pa.OP_Base=pa.CodOP;pa.OP_Pai='';pa.OrigemQtdPlanejada='INFORMADA_NA_ESTRUTURA_DA_OP';pa.OrigemGeracao='CADEIA_PI_V1.0.11';(data.op_etapas||[]).filter(e=>e.CodOP===pa.CodOP).forEach(e=>{e.QtdPlanejadaProduto=String(pRow.q);e.UMProduto=pa.UM;});v1011StripFormulaFromNonSlurry(pa);created.push(pa);}
  if(!pa){pa=created[created.length-1]||null;}
  // Conecta cada PI como insumo da etapa seguinte. Agora pode haver mais
  // de uma origem (lote) por PI anterior — cada uma gera seu próprio
  // registro de consumo/rastreabilidade e a quantidade total é somada.
  created.forEach(consumer=>{const role=v1011Role(consumer);v1011PrevRoles(role).forEach(prev=>{(sourcesByRole[prev]||[]).forEach(src=>v1011AddPIInput(consumer,src,pa,r));});});
  if(pa)v1011PrevRoles('PA').forEach(prev=>{(sourcesByRole[prev]||[]).forEach(src=>v1011AddPIInput(pa,src,pa,r));});
  // Para rastreabilidade, todas as OPs novas da família apontam para o PA final.
  if(pa)created.filter(o=>o.CodOP!==pa.CodOP).forEach(o=>{o.OP_Pai=pa.CodOP;o.OP_Base=pa.CodOP;});
  v1011CleanOpenNonSlurryFormula();saveLocal();
  alert(`Estrutura criada com ${created.length} OP(s). ${lotesUsados} lote(s) de PI pronto foram reutilizados sem gerar nova OP.\n\nA formulação foi aplicada somente aos slurrys.`);
  render('op');setTimeout(()=>{if($('selOp')&&pa){$('selOp').value=pa.CodOP;showOP();}},80);
};

// v1011AddPIInput agora SOMA a quantidade quando o mesmo material/PI é
// alimentado por mais de um lote para a mesma OP consumidora, em vez de
// sobrescrever. O custo unitário do material vira a média ponderada entre
// os lotes usados; cada lote continua com seu próprio registro de
// rastreabilidade (op_pi_consumos), sem perder a origem individual.
v1011AddPIInput = function(consumer, source, rootPA, r){
  if(!consumer||!source) return;
  const sourceCode = source.code||source.op?.Produto||source.lot?.CodigoPI||'';
  const p = v1011Prod(sourceCode), role = v1011Role(sourceCode), q = num(source.q);
  const um = source.um||source.op?.UM||source.lot?.UM||v101ProductUM(sourceCode,r)||'';
  const stage = (data.op_etapas||[]).filter(e=>e.CodOP===consumer.CodOP).sort((a,b)=>num(a.Ordem)-num(b.Ordem))[0]||{};
  const existing = (data.op_materiais||[]).find(m=>m.CodOP===consumer.CodOP && String(m.CodigoMaterial)===String(sourceCode) && String(m.TipoConsumo||'').toLowerCase().includes('pi intermedi'));
  let unit=0, lotId='', opOrig='';
  if(source.lot){ lotId=source.lot.IdLotePI; opOrig=source.lot.CodOPOrigem; const c=typeof v104SavedCost==='function'?v104SavedCost(opOrig):null; unit=c?num(c.CustoUnitario):0; }
  else if(source.op){ opOrig=source.op.CodOP; const c=typeof v104SavedCost==='function'?v104SavedCost(opOrig):null; unit=c?num(c.CustoUnitario):0; }
  const prevQ = existing?num(existing.QtdPlanejada||0):0;
  const prevCusto = existing?num(existing.CustoTotal||0):0;
  const novaQ = prevQ + q;
  const novoCustoTotal = prevCusto + (unit?unit*q:0);
  const novoUnit = novaQ ? (novoCustoTotal/novaQ) : unit;
  const lotesAnteriores = existing?String(existing.Lote||''):'';
  const loteAcumulado = lotId ? (lotesAnteriores ? lotesAnteriores+'; '+lotId : lotId) : lotesAnteriores;
  const row = existing || {CodOP:consumer.CodOP,CodRoteiro:consumer.CodRoteiro||r.CodRoteiro,Ordem:stage.Ordem||'PI',OrdemEtapa:stage.Ordem||'PI',CodigoProduto:consumer.Produto||consumer.CodigoProduto||'',CodigoPI:sourceCode,Processo:stage.Processo||'',IdRecursoRoteiro:stage.IdRecursoRoteiro||'',CodEquipamento:stage.CodEquipamento||'',CodigoMaterial:sourceCode,DescricaoMaterial:p['Descrição']||sourceCode,TipoConsumo:'PI intermediário'};
  Object.assign(row,{Lote:loteAcumulado,EntradaMaterial:opOrig||row.EntradaMaterial||'',OPOrigemPI:opOrig||row.OPOrigemPI||'',QtdPlanejada:novaQ>0?String(novaQ):'',QtdBase:'',UM:um,CustoUnitario:novoUnit?String(novoUnit):'',CustoTotal:novoCustoTotal?String(novoCustoTotal):'',OrigemQuantidade:source.lot?'LOTE_PI_EXISTENTE':'OP_PI_PRODUZIDA',RegraQuantidade:'PI_CONSUMIDO_ETAPA_SEGUINTE',OrigemDados:'CADEIA_PI_V1.0.11',Observacoes:`${v1011RoleLabel(role)} consumido na etapa ${stage.Processo||''}.${loteAcumulado.includes(';')?' Somatório de múltiplos lotes.':''} Pode ser apontado como consumo e perda.`});
  if(!existing)(data.op_materiais||[]).push(row);
  if(source.lot){
    const dup=(data.op_pi_consumos||[]).find(c=>c.CodOPConsumidora===consumer.CodOP&&c.IdLotePI===source.lot.IdLotePI&&String(c.Status||'ATIVO')!=='CANCELADO');
    if(!dup)(data.op_pi_consumos||[]).push({IdConsumoPI:'CPI-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),CodOPPA:rootPA.CodOP,CodOPConsumidora:consumer.CodOP,OPBase:rootPA.OP_Base||rootPA.CodOP,CodigoPA:rootPA.Produto||rootPA.CodigoProduto||'',CodigoPI:sourceCode,TipoPI:p['Tipo PI']||v1011RoleLabel(role),IdLotePI:source.lot.IdLotePI,CodOPOrigemPI:source.lot.CodOPOrigem,QuantidadeConsumida:String(q),UM:um,DataConsumo:new Date().toLocaleString('pt-BR'),Status:'ATIVO',Origem:'LOTE_PI_EXISTENTE_ETAPA'});
  }
};

try{
  data.meta=data.meta||{};
  data.meta.versao='V1.0.18';
  data.meta.baseOperacional=(data.meta.baseOperacional||'')+' | V1.0.18: destaque rosa no WIP para PI isolado / PI de outra produção';
  saveLocal();
  document.title='MES LION V1.0.18';
}catch(e){ console.warn('MES LION V1.0.18',e); }

/* =====================================================================
   MES LION V1.0.19 — PI EXTERNO / ISOLADO DENTRO DO WIP REAL DO DASH
   - O WIP passa a refletir a estrutura efetiva da OP.
   - Todo PI vindo de outra OP/família é exibido em bloco rosa independente.
   - Não consolida PIs: 3, 4 ou mais vínculos aparecem individualmente.
   - Exibe PI, quantidade/UM, OP consumidora e OP de origem.
   - Considera apontamentos de tempo da OP consumidora para o status visual.
   ===================================================================== */
const APP_VERSION_V1019='V1.0.19';

data.op_pi_consumos = data.op_pi_consumos || [];
data.apontamento_tempos = data.apontamento_tempos || [];

function v1019RootCode(op){
  if(!op)return '';
  if(typeof v1011FamilyRoot==='function'){
    const r=v1011FamilyRoot(op); if(r?.CodOP)return String(r.CodOP); if(typeof r==='string')return r;
  }
  if(String(op.TipoOP||'').toUpperCase()==='PA')return String(op.CodOP||'');
  return String(op.OP_Pai||op.OP_Base||op.CodOP||'').replace(/-PA$/i,'')+(String(op.OP_Pai||'').endsWith('-PA')?'-PA':'');
}
function v1019FamilyCodes(op){
  const fam=typeof v105Family==='function'?v105Family(op):[op];
  const s=new Set((fam||[]).map(o=>String(o.CodOP||'')).filter(Boolean));
  if(op?.CodOP)s.add(String(op.CodOP));
  return s;
}
function v1019ProdDesc(cod){
  const p=(data.estrutura||[]).find(x=>String(x['Código']||x.Codigo||'')===String(cod||''))||{};
  return p['Descrição']||p.Descricao||cod||'PI';
}
function v1019ConsumerProcess(codOP){
  const e=(data.op_etapas||[]).filter(x=>String(x.CodOP||'')===String(codOP||'')).sort((a,b)=>num(a.Ordem||a.OrdemEtapa)-num(b.Ordem||b.OrdemEtapa))[0]||{};
  return e.Processo||e.DescricaoProcesso||'';
}
function v1019PointingForConsumer(codOP){
  const rows=(data.apontamento_tempos||[]).filter(a=>String(a.CodOP||'')===String(codOP||''));
  if(!rows.length)return null;
  return rows.slice().sort((a,b)=>String(b.IdApontamentoTempo||'').localeCompare(String(a.IdApontamentoTempo||'')))[0];
}
function v1019ExternalPIRecords(op,proc=''){
  if(!op)return [];
  const family=v1019FamilyCodes(op);
  const selectedRoot=String(v1019RootCode(op)||'');
  const out=[];
  const seen=new Set();
  const push=(x)=>{
    const key=[x.codigoPI,x.opOrigem,x.lote,x.opConsumidora,x.quantidade].join('|');
    if(seen.has(key))return;seen.add(key);out.push(x);
  };

  (data.op_pi_consumos||[]).forEach(c=>{
    if(String(c.Status||'ATIVO').toUpperCase()==='CANCELADO')return;
    const consumer=String(c.CodOPConsumidora||'');
    if(!family.has(consumer) && String(c.CodOPPA||'')!==String(op.CodOP||'') && String(c.CodOPPA||'')!==selectedRoot)return;
    const source=(data.op||[]).find(o=>String(o.CodOP||'')===String(c.CodOPOrigemPI||''));
    const sourceRoot=source?String(v1019RootCode(source)||''):'';
    const external=!!source && (String(source.OrigemGeracao||'')==='PI_ISOLADO' || (sourceRoot&&selectedRoot&&sourceRoot!==selectedRoot));
    if(!external && !String(c.Origem||'').toUpperCase().includes('ISOL') && !String(c.Origem||'').toUpperCase().includes('EXTERN'))return;
    const process=v1019ConsumerProcess(consumer);
    if(proc && process!==proc)return;
    const codigoPI=String(c.CodigoPI||source?.CodigoPI||source?.Produto||'');
    push({codigoPI,descricao:v1019ProdDesc(codigoPI)||source?.DescricaoProduto||codigoPI,opOrigem:String(c.CodOPOrigemPI||source?.CodOP||''),opConsumidora:consumer,lote:String(c.IdLotePI||''),quantidade:num(c.QuantidadeConsumida||c.Quantidade||0),um:String(c.UM||source?.UM||''),process,source,point:v1019PointingForConsumer(consumer)});
  });

  // Compatibilidade com PI intermediário gravado diretamente em op_materiais.
  (data.op_materiais||[]).forEach(m=>{
    const consumer=String(m.CodOP||'');if(!family.has(consumer))return;
    if(!String(m.TipoConsumo||'').toLowerCase().includes('pi intermedi'))return;
    const opOrigem=String(m.OPOrigemPI||m.EntradaMaterial||'');
    const source=(data.op||[]).find(o=>String(o.CodOP||'')===opOrigem);
    const sourceRoot=source?String(v1019RootCode(source)||''):'';
    const external=!!source && (String(source.OrigemGeracao||'')==='PI_ISOLADO' || (sourceRoot&&selectedRoot&&sourceRoot!==selectedRoot));
    if(!external)return;
    const process=String(m.Processo||v1019ConsumerProcess(consumer));if(proc&&process!==proc)return;
    const codigoPI=String(m.CodigoPI||m.CodigoMaterial||source?.CodigoPI||source?.Produto||'');
    const lotes=String(m.Lote||'').split(';').map(s=>s.trim()).filter(Boolean);const lote=lotes[0]||'';
    push({codigoPI,descricao:v1019ProdDesc(codigoPI)||m.DescricaoMaterial||source?.DescricaoProduto||codigoPI,opOrigem,opConsumidora:consumer,lote,quantidade:num(m.QtdPlanejada||m.QtdConsumida||0),um:String(m.UM||source?.UM||''),process,source,point:v1019PointingForConsumer(consumer)});
  });
  return out;
}
function v1019ExternalState(r){
  const p=r.point;
  if(p?.Status==='Iniciado')return {label:'Em uso / apontamento iniciado',cls:'run',detail:`${p.DataApontamento||''} ${p.HoraInicio||''}`.trim()};
  if(p?.Status==='Finalizado')return {label:'Apontado',cls:'done',detail:`${p.DataApontamento||''} ${p.HoraInicio||''}${p.HoraFim?'–'+p.HoraFim:''}`.trim()};
  return {label:'PI externo vinculado',cls:'wait',detail:''};
}
function v1019ExternalCard(r){
  const st=v1019ExternalState(r),q=r.quantidade>0?`${fmtMax4V395(r.quantidade)} ${r.um||''}`:'Quantidade não informada';
  return `<article class="v1019-external-card ${st.cls}">
    <div class="v1019-external-card-head"><small>${htmlEscape(r.codigoPI||'PI')}</small><span>PI externo</span></div>
    <b title="${htmlEscape(r.descricao||'')}">${htmlEscape(r.descricao||r.codigoPI||'PI')}</b>
    <div class="v1019-origin"><em>OP origem</em><strong title="${htmlEscape(r.opOrigem||'')}">${htmlEscape(r.opOrigem||'—')}</strong></div>
    <div class="v1019-consumer"><em>Usado em</em><span title="${htmlEscape(r.opConsumidora||'')}">${htmlEscape(r.opConsumidora||'—')}${r.process?' · '+htmlEscape(r.process):''}</span></div>
    <div class="v1019-external-foot"><strong>${htmlEscape(q)}</strong><span>${htmlEscape(st.label)}</span></div>
    ${r.lote?`<time>Lote: ${htmlEscape(r.lote)}</time>`:''}${st.detail?`<time>Apontamento: ${htmlEscape(st.detail)}</time>`:''}
  </article>`;
}
function v1019ExternalBlock(op,proc=''){
  const rows=v1019ExternalPIRecords(op,proc);if(!rows.length)return '';
  return `<section class="v1019-external-pis"><header><div><i>◆</i><b>PIs externos / isolados adicionados à OP</b></div><span>${rows.length} PI${rows.length>1?'s':''} no fluxo</span></header><div class="v1019-external-track">${rows.map(v1019ExternalCard).join('<span class="v1019-external-arrow">→</span>')}</div></section>`;
}

const v1019RenderWipBase=v108RenderWip;
function v1019RenderWip(id){
  v1019RenderWipBase(id);
  const root=document.getElementById(id);if(!root)return;
  const cod=root.querySelector('.v105-op-select')?.value||'',proc=root.querySelector('.v105-proc-select')?.value||'';
  const op=(data.op||[]).find(o=>String(o.CodOP||'')===String(cod));if(!op)return;
  const flow=root.querySelector('.v105-flow');if(!flow)return;
  flow.querySelector('.v1019-external-pis')?.remove();
  const html=v1019ExternalBlock(op,proc);if(!html)return;
  flow.insertAdjacentHTML('afterbegin',html);
}

// Todos os handlers já existentes do dashboard passam a usar a versão nova.
v108RenderWip=v1019RenderWip;
v107RenderWip=v1019RenderWip;
v106RenderWip=v1019RenderWip;
v105RenderWip=v1019RenderWip;

// Legenda rosa no dashboard sem substituir o layout validado da V1.0.8.
const v1019DashboardBase=v108Dashboard;
function v1019Dashboard(){
  const ret=v1019DashboardBase();
  requestAnimationFrame(()=>{
    const legend=document.querySelector('.v105-legend');
    if(legend&&!legend.querySelector('.v1019-legend-pi'))legend.insertAdjacentHTML('beforeend','<span class="v1019-legend-pi"><i></i>PI externo / isolado</span>');
  });
  return ret;
}
v108Dashboard=v1019Dashboard;v105Dashboard=v1019Dashboard;dashboard=v1019Dashboard;

// Dados de teste controlados: usa PIs concluídos de uma produção anterior
// como origem para uma família planejada. Não altera estoque/custo; serve
// apenas para validar visualmente o WIP e o apontamento de tempo.
(function v1019SeedDashboardTest(){
  if((data.op_pi_consumos||[]).some(x=>String(x.Origem||'')==='TESTE_WIP_V1019'))return;
  const target=(data.op||[]).find(o=>String(o.CodOP||'')==='OP20260812101715-PA');
  const srcs=['OP20260812094138-01','OP20260812094138-02','OP20260812094138-05'].map(c=>(data.op||[]).find(o=>String(o.CodOP||'')===c));
  if(!target||srcs.some(x=>!x))return;
  const tests=[
    {src:srcs[0],consumer:'OP20260812101715-03',q:'0.25',um:'kg',lote:'LPI-TESTE-CAT-01'},
    {src:srcs[1],consumer:'OP20260812101715-04',q:'0.30',um:'kg',lote:'LPI-TESTE-AN-01'},
    {src:srcs[2],consumer:'OP20260812101715-07',q:'5',um:'un',lote:'LPI-TESTE-CORTE-CAT-01'}
  ];
  tests.forEach((t,i)=>data.op_pi_consumos.push({IdConsumoPI:'CPI-TESTE-WIP-'+(i+1),CodOPPA:target.CodOP,CodOPConsumidora:t.consumer,OPBase:target.OP_Base||target.CodOP,CodigoPA:target.Produto||target.CodigoProduto||'PA0001',CodigoPI:t.src.CodigoPI||t.src.Produto,TipoPI:t.src.DescricaoProduto||'',IdLotePI:t.lote,CodOPOrigemPI:t.src.CodOP,QuantidadeConsumida:t.q,UM:t.um,DataConsumo:'31/08/2026, 10:30:00',Status:'ATIVO',Origem:'TESTE_WIP_V1019'}));
  if(!(data.apontamento_tempos||[]).some(x=>x.IdApontamentoTempo==='AT-TESTE-WIP-V1019'))data.apontamento_tempos.push({IdApontamentoTempo:'AT-TESTE-WIP-V1019',CodOP:'OP20260812101715-07',Processo:'Montagem Célula',Operador:'admin',DataApontamento:'31/08/2026',HoraInicio:'10:30',HoraFim:'',Status:'Iniciado',Observacoes:'Apontamento de teste para validar PI externo no WIP.'});
  saveLocal();
})();

try{
  data.meta=data.meta||{};data.meta.versao=APP_VERSION_V1019;data.meta.baseOperacional=(data.meta.baseOperacional||'')+' | V1.0.19: PIs externos/isolados exibidos em rosa no WIP conforme estrutura real da OP';
  saveLocal();document.title='MES LION V1.0.19';
}catch(e){console.warn('MES LION V1.0.19',e);}
