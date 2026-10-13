/* MES LION V2.3.0 — MRP + importação versionada da Biblioteca Ambiental
   Preserva integralmente a lógica/layout de OP existente. */
(function(){
  data.mrp_demandas=data.mrp_demandas||[];
  data.mrp_planos=data.mrp_planos||[];
  data.sust_lci=data.sust_lci||[];

  const oldRenderNav=renderNav, oldRender=render, oldSust=sustentabilidadeModule;
  renderNav=function(){
    oldRenderNav();
    const prod=[...document.querySelectorAll('nav details')].find(d=>d.querySelector('summary')?.textContent.includes('Produção'));
    if(prod && !$('nav_mrp')) prod.insertAdjacentHTML('beforeend',`<button id="nav_mrp" onclick="render('mrp')">MRP / Planejamento</button>`);
  };
  render=function(k){
    if(k==='mrp'){current=k;document.body.classList.remove('dashboard-mode');document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));$('nav_mrp')?.classList.add('active');return mrpModuleV230();}
    return oldRender(k);
  };

  function codProduto(o){return o['Código']||o.CodigoProduto||o.CodigoPI||o.Produto||''}
  function descProduto(c){const p=(data.estrutura||[]).find(x=>codProduto(x)===c)||{};return p['Descrição']||p.DescricaoProduto||c}
  function estoqueMaterial(c){
    const ent=(data.entradas||[]).filter(e=>e['CódigoMaterial']===c).reduce((s,e)=>s+num(e.QtdAdquirida),0);
    const cons=(data.op_materiais||[]).filter(m=>m.CodigoMaterial===c).reduce((s,m)=>s+num(m.QtdConsumida),0);
    return Math.max(0,ent-cons);
  }
  function roteiroProduto(c){return (data.roteiro||[]).find(r=>(r.CodigoProduto||r.CodigoPI)===c)||null}
  function materiaisProduto(c,q){
    const r=roteiroProduto(c); if(!r)return [];
    return (data.roteiro_materiais||[]).filter(m=>m.CodRoteiro===r.CodRoteiro).map(m=>({CodigoMaterial:m.CodigoMaterial,DescricaoMaterial:m.DescricaoMaterial||'',UM:m.UM||'',QtdBruta:num(m.QtdBase)*q}));
  }
  function mrpCalcularV230(){
    const planos=[];
    (data.mrp_demandas||[]).filter(d=>String(d.Status||'ATIVA')!=='CANCELADA').forEach(d=>{
      const q=num(d.Quantidade); const mats=materiaisProduto(d.CodigoProduto,q);
      if(!mats.length) planos.push({Demanda:d.Id,CodigoProduto:d.CodigoProduto,Item:d.CodigoProduto,Descricao:descProduto(d.CodigoProduto),Tipo:'PRODUÇÃO',UM:d.UM||'un',NecessidadeBruta:q,Estoque:0,NecessidadeLiquida:q,DataNecessidade:d.DataNecessidade,Ação:'Produzir via roteiro/estrutura'});
      mats.forEach(m=>{const est=estoqueMaterial(m.CodigoMaterial);planos.push({Demanda:d.Id,CodigoProduto:d.CodigoProduto,Item:m.CodigoMaterial,Descricao:m.DescricaoMaterial,Tipo:'MATERIAL',UM:m.UM,NecessidadeBruta:m.QtdBruta,Estoque:est,NecessidadeLiquida:Math.max(0,m.QtdBruta-est),DataNecessidade:d.DataNecessidade,Ação:Math.max(0,m.QtdBruta-est)>0?'Comprar / suprir':'Estoque suficiente'});});
    });
    data.mrp_planos=planos;saveLocal();return planos;
  }
  window.mrpNovaDemandaV230=function(){
    const ps=(data.estrutura||[]).filter(p=>String(p.Tipo||p['Tipo']||'').toUpperCase()==='PA' || !p['Código Pai']);
    $('mrp_form').innerHTML=`<div class="form"><h3>Nova demanda de produção</h3><div class="form-grid"><label><span>Produto / PA</span><select id="mrp_prod"><option value="">Selecione</option>${ps.map(p=>`<option value="${htmlEscape(codProduto(p))}">${htmlEscape(codProduto(p))} — ${htmlEscape(p['Descrição']||'')}</option>`).join('')}</select></label><label><span>Quantidade</span><input id="mrp_qtd" type="number" step="any"></label><label><span>UM</span><input id="mrp_um" value="un"></label><label><span>Data necessidade</span><input id="mrp_data" type="date"></label><label><span>Prioridade</span><select id="mrp_pri"><option>Normal</option><option>Alta</option><option>Baixa</option></select></label><label class="wide"><span>Observações</span><textarea id="mrp_obs"></textarea></label></div><div class="form-actions"><button onclick="mrpSalvarDemandaV230()">Salvar demanda</button><button class="secondary" onclick="$('mrp_form').innerHTML=''">Cancelar</button></div></div>`;
  };
  window.mrpSalvarDemandaV230=function(){const c=$('mrp_prod').value,q=num($('mrp_qtd').value),dt=$('mrp_data').value;if(!c||q<=0||!dt)return alert('Produto, quantidade e data de necessidade são obrigatórios.');data.mrp_demandas.unshift({Id:'MRP-'+Date.now(),CodigoProduto:c,Descricao:descProduto(c),Quantidade:q,UM:$('mrp_um').value||'un',DataNecessidade:dt,Prioridade:$('mrp_pri').value,Status:'ATIVA',Observacoes:$('mrp_obs').value,CriadoEm:new Date().toLocaleString('pt-BR')});saveLocal();mrpModuleV230();};
  window.mrpRecalcularV230=function(){mrpCalcularV230();mrpModuleV230();};
  window.mrpCancelarDemandaV230=function(id){const d=data.mrp_demandas.find(x=>x.Id===id);if(d&&confirm('Cancelar esta demanda do MRP?')){d.Status='CANCELADA';saveLocal();mrpModuleV230();}};
  window.mrpGerarOPV230=function(id){const d=data.mrp_demandas.find(x=>x.Id===id);if(!d)return;if(!confirm(`Gerar OP para ${d.CodigoProduto}, quantidade ${d.Quantidade}, reutilizando as validações/roteiros atuais do MES?`))return;const ops=gerarOPComEstrutura(d.CodigoProduto,num(d.Quantidade));if(!ops.length)return alert('Não foi possível gerar a OP. Confira estrutura e roteiro do produto.');d.Status='OP GERADA';d.OPsGeradas=ops.map(o=>o.CodOP).join('; ');saveLocal();alert('OP(s) gerada(s): '+d.OPsGeradas);render('op');};
  window.mrpModuleV230=mrpModuleV230;
  function mrpModuleV230(){
    $('title').textContent='MRP / Planejamento da Produção';$('subtitle').textContent='Planejamento de necessidades usando cadastros, estoque, estrutura e roteiros existentes. Não altera o layout nem as regras das OPs.';
    const p=mrpCalcularV230();
    $('content').innerHTML=`<div class="toolbar"><button onclick="mrpNovaDemandaV230()">+ Nova demanda</button><button onclick="mrpRecalcularV230()">Recalcular MRP</button><button class="secondary" onclick="render('op')">Ordens de Produção</button></div><div id="mrp_form"></div><h3>Demandas</h3><div class="table-wrap"><table><thead><tr><th>Ações</th><th>ID</th><th>Produto</th><th>Descrição</th><th>Qtd</th><th>UM</th><th>Data necessidade</th><th>Prioridade</th><th>Status</th><th>OPs</th></tr></thead><tbody>${(data.mrp_demandas||[]).map(d=>`<tr><td>${d.Status==='ATIVA'?`<button class="mini" onclick="mrpGerarOPV230('${d.Id}')">Gerar OP</button> <button class="mini danger" onclick="mrpCancelarDemandaV230('${d.Id}')">Cancelar</button>`:''}</td><td>${htmlEscape(d.Id)}</td><td>${htmlEscape(d.CodigoProduto)}</td><td>${htmlEscape(d.Descricao)}</td><td>${htmlEscape(d.Quantidade)}</td><td>${htmlEscape(d.UM)}</td><td>${htmlEscape(d.DataNecessidade)}</td><td>${htmlEscape(d.Prioridade)}</td><td>${htmlEscape(d.Status)}</td><td>${htmlEscape(d.OPsGeradas||'')}</td></tr>`).join('')||'<tr><td colspan="10">Nenhuma demanda cadastrada.</td></tr>'}</tbody></table></div><h3>Necessidades calculadas</h3><div class="table-wrap"><table><thead><tr><th>Demanda</th><th>Produto</th><th>Item</th><th>Descrição</th><th>Tipo</th><th>Nec. bruta</th><th>Estoque</th><th>Nec. líquida</th><th>UM</th><th>Data</th><th>Ação</th></tr></thead><tbody>${p.map(r=>`<tr><td>${htmlEscape(r.Demanda)}</td><td>${htmlEscape(r.CodigoProduto)}</td><td>${htmlEscape(r.Item)}</td><td>${htmlEscape(r.Descricao)}</td><td>${htmlEscape(r.Tipo)}</td><td>${fmt(r.NecessidadeBruta,4)}</td><td>${fmt(r.Estoque,4)}</td><td><b>${fmt(r.NecessidadeLiquida,4)}</b></td><td>${htmlEscape(r.UM)}</td><td>${htmlEscape(r.DataNecessidade)}</td><td>${htmlEscape(r.Ação)}</td></tr>`).join('')||'<tr><td colspan="11">Cadastre uma demanda para calcular o MRP.</td></tr>'}</tbody></table></div>`;
  }

  function ambientalCols(){return ['CodigoMaterial','Indicador','UnidadeIndicador','FatorPorKg','Metodo','Fonte','Cenario','Validade','Observacoes']}
  window.baixarTemplateAmbientalV230=function(){
    const rows=(data.materiais||[]).map(m=>[m.CódigoMaterial||'',m.DescricaoMateriais||'',m.UM||'','','','','ecoinvent / informar dataset','Base','','']);
    const heads=['CodigoMaterial','DescricaoMaterial','UMMaterial',...ambientalCols().slice(1)];
    const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const html=`<html><head><meta charset="utf-8"></head><body><table><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr>${rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
    const b=new Blob([html],{type:'application/vnd.ms-excel;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='TEMPLATE_BIBLIOTECA_AMBIENTAL_MES_LION.xls';a.click();URL.revokeObjectURL(a.href);
  };
  function parsePlanilhaAmbiental(txt){
    if(/<table/i.test(txt)){const doc=new DOMParser().parseFromString(txt,'text/html');const rr=[...doc.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(td=>td.textContent.trim()));const h=rr.shift()||[];return rr.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((x,i)=>[x,r[i]||''])));}
    const lines=txt.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean),sep=(lines[0]||'').includes(';')?';':',';const h=(lines.shift()||'').split(sep).map(x=>x.trim().replace(/^"|"$/g,''));return lines.map(l=>{const v=l.split(sep).map(x=>x.trim().replace(/^"|"$/g,''));return Object.fromEntries(h.map((x,i)=>[x,v[i]||'']));});
  }
  window.importarBibliotecaAmbientalV230=async function(){
    const f=$('lci_import_file')?.files?.[0];if(!f)return alert('Selecione a planilha preenchida (.xls ou .csv).');
    const ext=f.name.toLowerCase().split('.').pop();if(!['xls','csv'].includes(ext))return alert('Use o template .XLS baixado pelo MES ou um CSV com as mesmas colunas.');
    const rows=parsePlanilhaAmbiental(await f.text());const errors=[],valid=[];const obrig=['CodigoMaterial','Indicador','UnidadeIndicador','FatorPorKg','Metodo','Fonte','Cenario'];
    rows.forEach((r,i)=>{const line=i+2,miss=obrig.filter(c=>!String(r[c]||'').trim());if(miss.length)errors.push(`Linha ${line}: campos obrigatórios ausentes: ${miss.join(', ')}`);if(!(data.materiais||[]).some(m=>String(m.CódigoMaterial)===String(r.CodigoMaterial)))errors.push(`Linha ${line}: código ${r.CodigoMaterial||'(vazio)'} não existe no cadastro de Materiais.`);if(r.FatorPorKg && !Number.isFinite(Number(String(r.FatorPorKg).replace(',','.'))))errors.push(`Linha ${line}: FatorPorKg inválido.`);if(!miss.length&&(data.materiais||[]).some(m=>String(m.CódigoMaterial)===String(r.CodigoMaterial))&&Number.isFinite(Number(String(r.FatorPorKg).replace(',','.'))))valid.push(r);});
    if(errors.length){$('lci_import_result').innerHTML=`<div class="card warn"><h3>Importação não realizada</h3><p>Foram encontradas ${errors.length} inconsistências. Nenhum registro foi gravado.</p><ul>${errors.slice(0,100).map(e=>`<li>${htmlEscape(e)}</li>`).join('')}</ul></div>`;return;}
    if(!valid.length)return alert('A planilha não possui registros válidos.');
    const versions=(data.sust_lci||[]).map(r=>num(r.LibraryVersion)).filter(Boolean),ver=(versions.length?Math.max(...versions):0)+1,batch='ENV-'+Date.now(),now=new Date().toLocaleString('pt-BR');
    (data.sust_lci||[]).forEach(r=>{if(r.LibraryActive==='Sim')r.LibraryActive='Não'});
    valid.forEach(r=>{const mat=(data.materiais||[]).find(m=>String(m.CódigoMaterial)===String(r.CodigoMaterial))||{};data.sust_lci.push({CodigoMaterial:r.CodigoMaterial,DescricaoMaterial:mat.DescricaoMateriais||r.DescricaoMaterial||'',CategoriaMaterial:mat.Categoria||'',UnidadeEntrada:mat.UM||r.UMMaterial||'',FatorKg:String(materialKgFactorV35(r.CodigoMaterial)||''),Indicador:r.Indicador,UnidadeIndicador:r.UnidadeIndicador,FatorPorKg:String(r.FatorPorKg).replace(',','.'),Metodo:r.Metodo,Fonte:r.Fonte,Cenario:r.Cenario,Ativo:'Sim',Validade:r.Validade||'',Observacoes:r.Observacoes||'',LibraryVersion:ver,LibraryActive:'Sim',ImportBatch:batch,ImportedAt:now,ImportedFile:f.name});});
    saveLocal();$('lci_import_result').innerHTML=`<div class="card"><h3>Biblioteca importada</h3><p><b>Versão ${ver}</b> criada com ${valid.length} registros. Versões anteriores foram preservadas para rastreabilidade e marcadas como não ativas.</p><p>Lote: ${batch}</p></div>`;setTimeout(()=>lciDatabaseModuleV37(),1200);
  };
  window.bibliotecaAmbientalImportBoxV230=function(){return `<div class="form"><h3>Importar fatores ambientais / ecoinvent</h3><p class="muted">O MES fornece apenas o template e não distribui dados licenciados do ecoinvent. Preencha o arquivo com dados obtidos/licenciados pela organização. A importação valida códigos de materiais e campos obrigatórios antes de gravar.</p><div class="toolbar"><button onclick="baixarTemplateAmbientalV230()">Baixar template Excel</button><label>Planilha preenchida<input id="lci_import_file" type="file" accept=".xls,.csv"></label><button onclick="importarBibliotecaAmbientalV230()">Validar e importar</button></div><div id="lci_import_result"></div></div>`};

  sustentabilidadeModule=function(){oldSust();const tb=$('content')?.querySelector('.toolbar');if(tb&&!$('btn_env_import'))tb.insertAdjacentHTML('beforeend',`<button id="btn_env_import" onclick="$('s_result').innerHTML=bibliotecaAmbientalImportBoxV230()">Importar biblioteca ambiental</button>`);};

  try{fields.sust_lci=fields.sust_lci||[];['LibraryVersion','LibraryActive','ImportBatch','ImportedAt','ImportedFile'].forEach(f=>{if(!fields.sust_lci.includes(f))fields.sust_lci.push(f)});}catch(e){}
})();
