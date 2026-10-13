/* MES LION V2.3.3 — Biblioteca Ambiental no ACV + escala visual global compacta.
   Não altera regras/layout de OP. */
(function(){
  function arr(v){if(Array.isArray(v))return v;if(v&&typeof v==='object')return Object.keys(v).map(k=>v[k]).filter(x=>x&&typeof x==='object');return []}
  function esc(v){return htmlEscape(String(v??''))}
  function normalize(){data.sust_lci=arr(data.sust_lci);data.materiais=arr(data.materiais);data.acv_fatores=arr(data.acv_fatores)}
  normalize();

  window.acvModuleV110=function(){
    normalize(); current='acv'; $('title').textContent='ACV — Análise de Ciclo de Vida'; $('subtitle').textContent='Estudos, inventário, avaliação de impactos e biblioteca de dados ambientais.';
    $('content').innerHTML=`<div class="v110-tabs"><button onclick="acvDashboardV110()">Dashboard</button><button onclick="acvStudiesV110()">ACV / Estudos</button><button onclick="acvICVV110()">ICV</button><button onclick="acvAICVV110()">AICV</button><button onclick="acvScenariosV110()">Cenários</button><button onclick="acvFactorsV110()">Fatores</button><button class="acv-library-tab" onclick="acvBibliotecaAmbientalV233()">Biblioteca de Dados Ambientais</button></div><div id="v110body"></div>`;
    acvDashboardV110();
  };

  function versions(){
    normalize(); const map=new Map();
    data.sust_lci.forEach(r=>{const v=Number(r.LibraryVersion)||0;if(!v)return;let x=map.get(v);if(!x)x={Versao:v,Ativa:'Não',Registros:0,Lote:r.ImportBatch||'',ImportadoEm:r.ImportedAt||'',Arquivo:r.ImportedFile||''};x.Registros++;if(r.LibraryActive==='Sim')x.Ativa='Sim';map.set(v,x)});
    return [...map.values()].sort((a,b)=>b.Versao-a.Versao);
  }
  window.acvBibliotecaAmbientalV233=function(){
    normalize(); const vs=versions(),active=vs.find(v=>v.Ativa==='Sim');
    $('v110body').innerHTML=`<div class="v110-head"><div><h2>Biblioteca de Dados Ambientais</h2><p class="muted">Importação controlada de fatores ambientais para utilização nos cálculos de ACV. Cada importação aprovada gera uma nova versão rastreável.</p></div></div>
    <div class="env-summary"><div><span>Versão ativa</span><b>${active?'v'+active.Versao:'Nenhuma'}</b></div><div><span>Registros ativos</span><b>${active?active.Registros:0}</b></div><div><span>Versões preservadas</span><b>${vs.length}</b></div></div>
    ${bibliotecaAmbientalImportBoxV230()}
    <div class="env-section"><h3>Histórico de versões</h3><div class="table-wrap"><table><thead><tr><th>Versão</th><th>Status</th><th>Registros</th><th>Lote</th><th>Importação</th><th>Arquivo de origem</th></tr></thead><tbody>${vs.map(v=>`<tr><td><b>v${v.Versao}</b></td><td>${v.Ativa==='Sim'?'<span class="env-active">ATIVA</span>':'Inativa'}</td><td>${v.Registros}</td><td>${esc(v.Lote)}</td><td>${esc(v.ImportadoEm)}</td><td>${esc(v.Arquivo)}</td></tr>`).join('')||'<tr><td colspan="6">Nenhuma biblioteca importada.</td></tr>'}</tbody></table></div></div>
    <div class="env-section"><h3>Fatores da versão ativa</h3><div class="table-wrap"><table><thead><tr><th>Código</th><th>Material</th><th>Indicador</th><th>Fator/kg</th><th>Unidade</th><th>Método</th><th>Fonte</th><th>Cenário</th></tr></thead><tbody>${data.sust_lci.filter(r=>r.LibraryActive==='Sim').map(r=>`<tr><td>${esc(r.CodigoMaterial)}</td><td>${esc(r.DescricaoMaterial)}</td><td>${esc(r.Indicador)}</td><td>${esc(r.FatorPorKg)}</td><td>${esc(r.UnidadeIndicador)}</td><td>${esc(r.Metodo)}</td><td>${esc(r.Fonte)}</td><td>${esc(r.Cenario)}</td></tr>`).join('')||'<tr><td colspan="8">Nenhum fator ativo.</td></tr>'}</tbody></table></div></div>`;
  };

  function parseSheet(txt){
    if(/<table/i.test(txt)){const doc=new DOMParser().parseFromString(txt,'text/html'),rr=[...doc.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(td=>td.textContent.trim())),h=rr.shift()||[];return rr.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((x,i)=>[x,r[i]||''])))}
    const lines=txt.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean),sep=(lines[0]||'').includes(';')?';':',',h=(lines.shift()||'').split(sep).map(x=>x.trim().replace(/^"|"$/g,''));return lines.map(l=>{const v=l.split(sep).map(x=>x.trim().replace(/^"|"$/g,''));return Object.fromEntries(h.map((x,i)=>[x,v[i]||'']))})
  }
  window.importarBibliotecaAmbientalV230=async function(){
    normalize(); const f=$('lci_import_file')?.files?.[0]; if(!f)return alert('Selecione a planilha preenchida (.xls ou .csv).');
    const ext=f.name.toLowerCase().split('.').pop(); if(!['xls','csv'].includes(ext))return alert('Use o template .XLS baixado pelo MES ou um CSV com as mesmas colunas.');
    const rows=parseSheet(await f.text()),errors=[],valid=[],required=['CodigoMaterial','Indicador','UnidadeIndicador','FatorPorKg','Metodo','Fonte','Cenario'];
    rows.forEach((r,i)=>{const line=i+2,miss=required.filter(c=>!String(r[c]||'').trim()),mat=data.materiais.find(m=>String(m.CódigoMaterial)===String(r.CodigoMaterial)),factor=Number(String(r.FatorPorKg||'').replace(',','.'));if(miss.length)errors.push(`Linha ${line}: campos obrigatórios ausentes: ${miss.join(', ')}`);if(!mat)errors.push(`Linha ${line}: código ${r.CodigoMaterial||'(vazio)'} não existe no cadastro de Materiais.`);if(String(r.FatorPorKg||'').trim()&&!Number.isFinite(factor))errors.push(`Linha ${line}: FatorPorKg inválido.`);if(!miss.length&&mat&&Number.isFinite(factor))valid.push({...r,_mat:mat,_factor:factor})});
    const box=$('lci_import_result'); if(errors.length){box.innerHTML=`<div class="card warn"><h3>Importação bloqueada</h3><p><b>${errors.length} inconsistência(s).</b> Nenhum registro foi gravado.</p><ul>${errors.slice(0,100).map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`;return}
    if(!valid.length)return alert('A planilha não possui registros válidos.');
    const nums=data.sust_lci.map(r=>Number(r.LibraryVersion)||0),ver=(nums.length?Math.max(...nums):0)+1,batch='ENV-'+Date.now(),now=new Date().toLocaleString('pt-BR');
    data.sust_lci.forEach(r=>r.LibraryActive='Não'); data.acv_fatores.forEach(r=>{if(r.OrigemBibliotecaAmbiental==='Sim')r.LibraryActive='Não'});
    const newFactors=[];
    valid.forEach(r=>{const rec={CodigoMaterial:r.CodigoMaterial,DescricaoMaterial:r._mat.DescricaoMateriais||r.DescricaoMaterial||'',CategoriaMaterial:r._mat.Categoria||'',UnidadeEntrada:r._mat.UM||r.UMMaterial||'',Indicador:r.Indicador,UnidadeIndicador:r.UnidadeIndicador,FatorPorKg:String(r._factor),Metodo:r.Metodo,Fonte:r.Fonte,Cenario:r.Cenario,Ativo:'Sim',Validade:r.Validade||'',Observacoes:r.Observacoes||'',LibraryVersion:ver,LibraryActive:'Sim',ImportBatch:batch,ImportedAt:now,ImportedFile:f.name};data.sust_lci.push(rec);newFactors.push({CodigoMaterial:r.CodigoMaterial,Categoria:r.Indicador,Fator:String(r._factor),Unidade:r.UnidadeIndicador,Dataset:r.Fonte,Versao:'Biblioteca Ambiental v'+ver,Regiao:r.Cenario,Ano:r.Validade||'',Qualidade:r.Observacoes||'',Metodo:r.Metodo,OrigemBibliotecaAmbiental:'Sim',LibraryVersion:ver,LibraryActive:'Sim',ImportBatch:batch})});
    data.acv_fatores=[...newFactors,...data.acv_fatores]; saveLocal();
    box.innerHTML=`<div class="card env-success"><h3>Importação concluída</h3><p><b>Biblioteca v${ver}</b> criada com ${valid.length} registro(s). A versão anterior foi preservada e a nova versão foi marcada como ativa para os cálculos de ACV.</p><p>Lote ${esc(batch)} · arquivo ${esc(f.name)}</p></div>`;
    setTimeout(()=>acvBibliotecaAmbientalV233(),700);
  };
  try{data.meta=data.meta||{};data.meta.versao='V2.3.3';}catch(e){}
})();
