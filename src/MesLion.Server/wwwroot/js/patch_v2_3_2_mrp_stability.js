/* MES LION V2.3.2 — estabilidade e desempenho do MRP.
   Não altera regras/layout de OP. */
(function(){
  function arr(v){
    if(Array.isArray(v)) return v;
    if(v==null) return [];
    /* PowerShell/JSON pode reidratar coleção vazia como objeto. */
    if(typeof v==='object') return Object.keys(v).sort((a,b)=>(+a||0)-(+b||0)).map(k=>v[k]).filter(x=>x&&typeof x==='object');
    return [];
  }
  function normalize(){
    data.mrp_demandas=arr(data.mrp_demandas);
    data.mrp_planos=arr(data.mrp_planos);
    data.sust_lci=arr(data.sust_lci);
    data.estrutura=arr(data.estrutura); data.roteiro=arr(data.roteiro); data.roteiro_materiais=arr(data.roteiro_materiais);
    data.entradas=arr(data.entradas); data.op_materiais=arr(data.op_materiais); data.materiais=arr(data.materiais);
  }
  normalize();

  function code(o){return o?.['Código']||o?.CodigoProduto||o?.CodigoPI||o?.Produto||''}
  function desc(c){const p=data.estrutura.find(x=>String(code(x))===String(c))||{};return p['Descrição']||p.DescricaoProduto||c}
  function buildIndexes(){
    const stock=new Map(),cons=new Map(),routeByProduct=new Map(),matsByRoute=new Map();
    for(const e of data.entradas){const c=String(e.CódigoMaterial||'');if(c)stock.set(c,(stock.get(c)||0)+num(e.QtdAdquirida));}
    for(const m of data.op_materiais){const c=String(m.CodigoMaterial||'');if(c)cons.set(c,(cons.get(c)||0)+num(m.QtdConsumida));}
    for(const r of data.roteiro){const c=String(r.CodigoProduto||r.CodigoPI||'');if(c&&!routeByProduct.has(c))routeByProduct.set(c,r);}
    for(const m of data.roteiro_materiais){const r=String(m.CodRoteiro||'');if(!matsByRoute.has(r))matsByRoute.set(r,[]);matsByRoute.get(r).push(m);}
    return {stock,cons,routeByProduct,matsByRoute};
  }
  function calculate(){
    normalize(); const ix=buildIndexes(),out=[];
    for(const d of data.mrp_demandas){
      if(String(d.Status||'ATIVA')==='CANCELADA')continue;
      const q=num(d.Quantidade),r=ix.routeByProduct.get(String(d.CodigoProduto)),mats=r?(ix.matsByRoute.get(String(r.CodRoteiro))||[]):[];
      if(!mats.length){out.push({Demanda:d.Id,CodigoProduto:d.CodigoProduto,Item:d.CodigoProduto,Descricao:desc(d.CodigoProduto),Tipo:'PRODUÇÃO',UM:d.UM||'un',NecessidadeBruta:q,Estoque:0,NecessidadeLiquida:q,DataNecessidade:d.DataNecessidade,Ação:'Produzir via roteiro/estrutura'});continue;}
      for(const m of mats){const c=String(m.CodigoMaterial||''),gross=num(m.QtdBase)*q,st=Math.max(0,(ix.stock.get(c)||0)-(ix.cons.get(c)||0));out.push({Demanda:d.Id,CodigoProduto:d.CodigoProduto,Item:c,Descricao:m.DescricaoMaterial||'',Tipo:'MATERIAL',UM:m.UM||'',NecessidadeBruta:gross,Estoque:st,NecessidadeLiquida:Math.max(0,gross-st),DataNecessidade:d.DataNecessidade,Ação:gross>st?'Comprar / suprir':'Estoque suficiente'});}
    }
    data.mrp_planos=out; return out;
  }
  function persist(){try{saveLocal();return true}catch(e){console.error(e);alert('Não foi possível salvar no banco: '+e.message);return false}}
  function clearFatal(){const b=document.getElementById('fatalErrorBanner');if(b)b.style.display='none';}

  window.mrpSalvarDemandaV230=function(){
    normalize(); const pc=$('mrp_prod'),pq=$('mrp_qtd'),pd=$('mrp_data');
    if(!pc||!pq||!pd)return alert('Formulário do MRP não está disponível. Atualize a página e tente novamente.');
    const c=pc.value,q=num(pq.value),dt=pd.value;if(!c||q<=0||!dt)return alert('Produto, quantidade e data de necessidade são obrigatórios.');
    data.mrp_demandas.unshift({Id:'MRP-'+Date.now(),CodigoProduto:c,Descricao:desc(c),Quantidade:q,UM:$('mrp_um')?.value||'un',DataNecessidade:dt,Prioridade:$('mrp_pri')?.value||'Normal',Status:'ATIVA',Observacoes:$('mrp_obs')?.value||'',CriadoEm:new Date().toLocaleString('pt-BR')});
    data.mrp_planos=calculate(); if(!persist())return; clearFatal(); mrpModuleV230();
  };
  window.mrpRecalcularV230=function(){data.mrp_planos=calculate();if(persist()){clearFatal();mrpModuleV230();}};
  window.mrpCancelarDemandaV230=function(id){normalize();const d=data.mrp_demandas.find(x=>x.Id===id);if(d&&confirm('Cancelar esta demanda do MRP?')){d.Status='CANCELADA';data.mrp_planos=calculate();if(persist())mrpModuleV230();}};
  window.mrpGerarOPV230=function(id){normalize();const d=data.mrp_demandas.find(x=>x.Id===id);if(!d)return;if(!confirm(`Gerar OP para ${d.CodigoProduto}, quantidade ${d.Quantidade}, reutilizando as validações/roteiros atuais do MES?`))return;try{const ops=gerarOPComEstrutura(d.CodigoProduto,num(d.Quantidade))||[];if(!Array.isArray(ops)||!ops.length)return alert('Não foi possível gerar a OP. Confira estrutura e roteiro do produto.');d.Status='OP GERADA';d.OPsGeradas=ops.map(o=>o.CodOP).filter(Boolean).join('; ');data.mrp_planos=calculate();if(!persist())return;alert('OP(s) gerada(s): '+d.OPsGeradas);render('op');}catch(e){console.error(e);alert('Erro ao gerar OP pelo MRP: '+e.message);}};

  window.mrpModuleV230=function(){
    normalize();clearFatal();$('title').textContent='MRP / Planejamento da Produção';$('subtitle').textContent='Planejamento de necessidades com os cadastros, estoque, estrutura e roteiros existentes.';
    const p=Array.isArray(data.mrp_planos)?data.mrp_planos:[];
    $('content').innerHTML=`<div class="toolbar"><button onclick="mrpNovaDemandaV230()">+ Nova demanda</button><button onclick="mrpRecalcularV230()">Recalcular MRP</button><button class="secondary" onclick="render('op')">Ordens de Produção</button></div><div id="mrp_form"></div><h3>Demandas</h3><div class="table-wrap"><table><thead><tr><th>Ações</th><th>ID</th><th>Produto</th><th>Descrição</th><th>Qtd</th><th>UM</th><th>Data necessidade</th><th>Prioridade</th><th>Status</th><th>OPs</th></tr></thead><tbody>${data.mrp_demandas.map(d=>`<tr><td>${d.Status==='ATIVA'?`<button class="mini" onclick="mrpGerarOPV230('${d.Id}')">Gerar OP</button> <button class="mini danger" onclick="mrpCancelarDemandaV230('${d.Id}')">Cancelar</button>`:''}</td><td>${htmlEscape(d.Id||'')}</td><td>${htmlEscape(d.CodigoProduto||'')}</td><td>${htmlEscape(d.Descricao||'')}</td><td>${htmlEscape(d.Quantidade||'')}</td><td>${htmlEscape(d.UM||'')}</td><td>${htmlEscape(d.DataNecessidade||'')}</td><td>${htmlEscape(d.Prioridade||'')}</td><td>${htmlEscape(d.Status||'')}</td><td>${htmlEscape(d.OPsGeradas||'')}</td></tr>`).join('')||'<tr><td colspan="10">Nenhuma demanda cadastrada.</td></tr>'}</tbody></table></div><h3>Necessidades calculadas</h3><div class="table-wrap"><table><thead><tr><th>Demanda</th><th>Produto</th><th>Item</th><th>Descrição</th><th>Tipo</th><th>Nec. bruta</th><th>Estoque</th><th>Nec. líquida</th><th>UM</th><th>Data</th><th>Ação</th></tr></thead><tbody>${p.map(r=>`<tr><td>${htmlEscape(r.Demanda||'')}</td><td>${htmlEscape(r.CodigoProduto||'')}</td><td>${htmlEscape(r.Item||'')}</td><td>${htmlEscape(r.Descricao||'')}</td><td>${htmlEscape(r.Tipo||'')}</td><td>${fmt(r.NecessidadeBruta,4)}</td><td>${fmt(r.Estoque,4)}</td><td><b>${fmt(r.NecessidadeLiquida,4)}</b></td><td>${htmlEscape(r.UM||'')}</td><td>${htmlEscape(r.DataNecessidade||'')}</td><td>${htmlEscape(r.Ação||'')}</td></tr>`).join('')||'<tr><td colspan="11">Clique em “Recalcular MRP” após cadastrar uma demanda.</td></tr>'}</tbody></table></div>`;
  };

  /* Corrige também coleção ambiental reidratada como objeto antes da importação. */
  const oldImport=window.importarBibliotecaAmbientalV230;
  if(oldImport)window.importarBibliotecaAmbientalV230=async function(){normalize();return oldImport.apply(this,arguments)};
  try{data.meta=data.meta||{};data.meta.versao='V2.3.2';}catch(e){}
})();
