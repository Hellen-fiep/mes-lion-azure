/* MES LION V1.1.2 — massa útil/perdida + integração ACV/ICV normalizada */
(function(){
const VER='V1.1.2';
function N(v){return typeof num==='function'?num(v||0):(Number(String(v||0).replace(',','.'))||0)}
function E(v){return typeof htmlEscape==='function'?htmlEscape(String(v??'')):String(v??'')}
function F(v,d=4){return Number.isFinite(N(v))?N(v).toLocaleString('pt-BR',{maximumFractionDigits:d}):'—'}
function matName(x){const m=typeof materialPorCodigo==='function'?materialPorCodigo(x.CodigoMaterial||'')||{}:{};return String(x.Material||x.DescricaoMaterial||m.DescricaoMateriais||m.Descricao||x.CodigoMaterial||'').trim()}
function isVolatile(x){const s=(String(x.CodigoMaterial||'')+' '+matName(x)).toLowerCase();return /(^|\W)(nmp|n-methyl-?2?-?pyrrolidone|n[- ]metil[- ]?2[- ]pirrolidona|metilpirrolidona|água|agua|water)(\W|$)/i.test(s)}
function massSplit(bp){
 const d=(typeof v4041ProcessMassRows==='function'?v4041ProcessMassRows(bp):{rows:[],total:0,fonte:'OP'}), useful=[],lost=[];
 (d.rows||[]).forEach(x=>{const y={...x};(isVolatile(y)?lost:useful).push(y)});
 const sum=a=>a.reduce((s,x)=>s+N(x.MassaKg),0),ut=sum(useful),lo=sum(lost);
 useful.forEach(x=>x.PercentualMassa=ut?N(x.MassaKg)/ut*100:0);lost.forEach(x=>x.PercentualMassa=lo?N(x.MassaKg)/lo*100:0);
 return {useful,lost,usefulTotal:ut,lostTotal:lo,inputTotal:ut+lo,fonte:d.fonte||'OP',finalCellMassKg:ut};
}
function pie(rows,total,label){
 if(!rows.length||!(total>0))return '<div style="color:#6d7d8c;font-size:12px;padding:12px 0">Sem dados de massa para esta classificação.</div>';
 let a=0;const cs=['#0b5ea8','#39a935','#78b82a','#1f7a8c','#f2a900','#6c5ce7','#00a8a8','#d35400','#7f8c8d','#2d98da'];
 const stops=rows.map((x,i)=>{let b=a+N(x.MassaKg)/total*100,z=`${cs[i%cs.length]} ${a}% ${b}%`;a=b;return z}).join(',');
 const leg=rows.map((x,i)=>`<div style="display:grid;grid-template-columns:10px minmax(120px,1fr) 68px 72px;gap:6px;align-items:center;border-bottom:1px solid #eaf0f5;padding:5px 0;font-size:11px"><i style="width:8px;height:8px;border-radius:50%;background:${cs[i%cs.length]}"></i><span>${E(matName(x))}</span><b style="text-align:right;color:#0b4d80">${F(N(x.MassaKg)/total*100,2)}%</b><small style="text-align:right;color:#6d7d8c">${F(x.MassaKg,4)} kg</small></div>`).join('');
 return `<div style="display:grid;grid-template-columns:150px minmax(260px,1fr);gap:18px;align-items:center"><div style="width:140px;height:140px;border-radius:50%;position:relative;background:conic-gradient(${stops});margin:auto"><div style="position:absolute;inset:28%;background:#fff;border-radius:50%"></div><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#0b4d80;font-weight:800">${F(total,4)}<small style="font-size:10px;color:#667">kg</small></div></div><div>${leg}</div></div><div style="font-size:10px;color:#6d7d8c;margin-top:6px">${E(label)}</div>`;
}
function acvForBP(bp){
 const op=String(bp.CodOrdemProducao||'');let rows=(data.acv_resultados||[]).filter(r=>String(r.CodOP||'')===op);
 if(!rows.length&&typeof v4034RootPAForBP==='function'){const root=String(v4034RootPAForBP(bp)||'');rows=(data.acv_resultados||[]).filter(r=>String(r.CodOP||'')===root)}
 return rows[0]||null;
}
function productEnergyKWh(bp){const p=typeof produtoPorCodigo==='function'?produtoPorCodigo(bp.CodProduto)||{}:{};return N(p['Energia (Wh)']||p.EnergiaWh||p.Energia)/1000}
function producedCells(bp){return Math.max(N(typeof opProduced==='function'?opProduced(bp.CodOrdemProducao):0),1)}
function costForBP(bp){try{const c=typeof calcCustoOP==='function'?calcCustoOP(bp.CodOrdemProducao,false)||{}:{};return N(c.CustoTotal)}catch(e){return 0}}
function impactValue(r,cat){if(!r)return 0;if(cat==='Mudanças climáticas')return N((r.Impactos||{})[cat]||r.GWP);return N((r.Impactos||{})[cat])}
function unitFor(cat){const m={'Mudanças climáticas':'kg CO₂eq','Acidificação':'mol H⁺ eq','Eutrofização':'kg P eq','Material particulado':'disease incidence','Uso de recursos minerais e metais':'kg Sb eq','Uso de água':'m³ world eq','Ecotoxicidade':'CTUe','Toxicidade humana':'CTUh','Formação de ozônio fotoquímico':'kg NMVOC eq'};return m[cat]||'unid. impacto'}
function normalize(bp,r,cat,den,fx){const v=impactValue(r,cat),sp=massSplit(bp),cells=producedCells(bp),e=productEnergyKWh(bp)*cells,cost=costForBP(bp);let div=1,suf='';if(den==='kWh'){div=e;suf='/kWh'}else if(den==='kg'){div=sp.usefulTotal;suf='/kg célula'}else if(den==='BRL'){div=cost;suf='/R$'}else if(den==='USD'){div=fx>0?cost/fx:0;suf='/US$'}else if(den==='cell'){div=cells;suf='/célula'}return {raw:v,value:div>0?v/div:null,divisor:div,suffix:suf,unit:unitFor(cat)}}
window.acvICVV110=function(){
 const ops=(data.op||[]).map(o=>`<option value="${E(o.CodOP)}">${E(o.CodOP)} — ${E(o.DescricaoProduto||o.Produto||o.CodigoProduto||'')}</option>`).join('');
 $('v110body').innerHTML=`<div class="v110-head"><h2>ICV — Inventário e normalização</h2></div><div class="form"><div class="form-grid"><label><span>OP</span><select id="icv_op">${ops}</select></label><label><span>Indicador ambiental</span><select id="icv_cat">${['Mudanças climáticas','Acidificação','Eutrofização','Material particulado','Uso de recursos minerais e metais','Uso de água','Ecotoxicidade','Toxicidade humana','Formação de ozônio fotoquímico'].map(x=>`<option>${x}</option>`).join('')}</select></label><label><span>Normalizar por</span><select id="icv_den"><option value="kWh">kWh de capacidade produzida</option><option value="kg">kg de célula (massa útil)</option><option value="cell">unidade de célula</option><option value="BRL">R$</option><option value="USD">US$</option></select></label><label><span>Câmbio R$/US$</span><input id="icv_fx" type="number" step="any" value="5.00"></label></div><button onclick="showICVV110()">Carregar e normalizar</button></div><div id="icvbox"></div>`;
}
window.showICVV110=function(){
 const op=$('icv_op').value,bp={CodOrdemProducao:op,CodProduto:(typeof opPorCodigo==='function'?opPorCodigo(op)||{}:{}).CodigoProduto||''},r=acvForBP(bp),cat=$('icv_cat').value,den=$('icv_den').value,fx=N($('icv_fx').value),z=normalize(bp,r,cat,den,fx),inv=typeof acvInventory==='function'?acvInventory(op):{mats:opMaterials(op)||[],energy:opEnergyKWh(op),loss:opLosses(op),prod:opProduced(op)};
 const src=r?`${r.IdResultado||'resultado'} · ${r.Metodo||''} · ${r.Data||''}`:'Nenhum cálculo AICV salvo para esta OP';
 $('icvbox').innerHTML=`<div class="v110-kpis"><div class="v110-kpi"><b>Indicador bruto</b><strong>${r?F(z.raw,7):'—'}</strong><span>${E(z.unit)}</span></div><div class="v110-kpi"><b>Normalizado</b><strong>${z.value==null?'—':F(z.value,7)}</strong><span>${E(z.unit+z.suffix)}</span></div><div class="v110-kpi"><b>Divisor</b><strong>${z.divisor?F(z.divisor,5):'—'}</strong><span>${den==='USD'?'US$':den}</span></div><div class="v110-kpi"><b>Fonte ambiental</b><strong>${r?'AICV salvo':'—'}</strong><span>${E(src)}</span></div></div><p class="muted"><b>Regra:</b> o ICV não recalcula fatores ambientais nesta tela. O indicador é lido do cálculo AICV previamente salvo e apenas normalizado pelo denominador selecionado.</p><h3>Fluxos primários do MES</h3>${miniTable((inv.mats||[]).map(m=>({Codigo:m.CodigoMaterial,Material:m.DescricaoMaterial||matName(m),Quantidade:N(m.QtdConsumida)||N(m.Qtd)||N(m.QtdPlanejada),UM:m.UM||'',Origem:'Dado primário MES'})))}`;
}
// Dashboard UE: substitui o bloco de carbono por resultado AICV salvo e separa massa útil/perdida.
const oldBP=bpDashboardBody;
bpDashboardBody=function(bp){
 const base=oldBP(bp),sp=massSplit(bp),r=acvForBP(bp),gwp=r?impactValue(r,'Mudanças climáticas'):null,cells=producedCells(bp),perCell=gwp!=null&&cells>0?gwp/cells:null,energy=productEnergyKWh(bp)*cells,perKWh=gwp!=null&&energy>0?gwp/energy:null;
 const mass=`<section class="passport-section"><h2>Relação de massas da célula</h2><div class="kpis passport-kpis"><div class="kpi"><b>Massa útil / peso final</b><span>${F(sp.usefulTotal,4)} kg</span></div><div class="kpi"><b>Massa volatilizada</b><span>${F(sp.lostTotal,4)} kg</span></div><div class="kpi"><b>Massa total de entrada</b><span>${F(sp.inputTotal,4)} kg</span></div></div><div class="two"><div><h3>Massa útil da célula</h3>${pie(sp.useful,sp.usefulTotal,'Peso final calculado excluindo água e NMP, que evaporam durante o processo.')}</div><div><h3>Massa perdida / volatilizada</h3>${pie(sp.lost,sp.lostTotal,'Água e NMP são classificados como massa perdida por evaporação e não integram o peso final da célula.')}</div></div></section>`;
 const acv=`<section class="passport-section"><h2>Indicadores ambientais — fonte ACV/AICV</h2><div class="kpis passport-kpis"><div class="kpi"><b>CO₂eq total</b><span>${r?F(gwp,6)+' kg CO₂eq':'—'}</span></div><div class="kpi"><b>CO₂eq/kWh</b><span>${perKWh==null?'—':F(perKWh,6)+' kg CO₂eq/kWh'}</span></div><div class="kpi"><b>CO₂eq/célula</b><span>${perCell==null?'—':F(perCell,6)+' kg CO₂eq/célula'}</span></div><div class="kpi"><b>Origem</b><span>${r?E(r.IdResultado||'AICV salvo'):'Sem cálculo AICV'}</span></div></div><p style="font-size:11px;color:#607786">Os valores ambientais deste dashboard são recuperados do cálculo previamente realizado no módulo ACV/AICV; o Passaporte não reaplica fatores ambientais nem recalcula o inventário.</p></section>`;
 // insere após hero/kpis, antes das seções regulatórias existentes
 const pos=base.indexOf('<details');return pos>0?base.slice(0,pos)+mass+acv+base.slice(pos):mass+acv+base;
}
// Peso regulamentar A.9 e carbono C.1/C.2 são apresentados dinamicamente a partir das fontes corretas.
if(typeof euTable==='function'){
 const oldEu=euTable;euTable=function(bp,defs){const view={...bp},sp=massSplit(bp),r=acvForBP(bp);if(sp.usefulTotal>0)view.EU_A9_PesoKg=F(sp.usefulTotal,4);if(r){view.EU_C1_PegadaCarbono=F(impactValue(r,'Mudanças climáticas'),7)+' kg CO₂eq';view.EU_C2_UnidadeFuncional=r.UnidadeFuncional||view.EU_C2_UnidadeFuncional;view.EU_C4_Metodologia=r.Metodo||view.EU_C4_Metodologia;view.EU_C5_LimitesSistema=r.Fronteira||view.EU_C5_LimitesSistema;}return oldEu(view,defs)};
}
try{data.meta=data.meta||{};data.meta.versao=VER;data.meta.patchMassasICV=VER;saveLocal();}catch(e){console.warn('Patch V1.1.2',e)}
})();
