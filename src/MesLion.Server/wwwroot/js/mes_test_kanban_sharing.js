/* MES LION 1.0 PGSQL: kanban de caracterização e publicação seletiva. */
(function(){
'use strict';
const A=x=>Array.isArray(x)?x:[];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lines=[['Prismática|Piloto','Prismática — Piloto'],['Prismática|Industrial','Prismática — Industrial'],['Cilíndrica|Piloto','Cilíndrica — Piloto'],['Cilíndrica|Industrial','Cilíndrica — Industrial']];
const code=r=>String(r['Código Equipamento']||r.CodEquipamento||r.Codigo||r.Recurso||'');
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function init(){if(!Array.isArray(data.pcp_caracterizacao))data.pcp_caracterizacao=[];}
function resources(){const seen=new Set();return A(data.cad_recursos).concat(A(data.recursos)).filter(r=>{const k=code(r);if(!k||seen.has(k))return false;seen.add(k);return /caracteriza/i.test([r.Escala,r.EscalaProducao,r['Escala de Produção']].join(' '));});}
function name(c){return resources().find(r=>code(r)===String(c))?.Equipamento||c;}
function visible(x,filter){return !filter||filter==='Todas'||A(x.Calendarios).includes(filter)}
function card(x,short=false){return `<article class="mes-test-kanban" ondblclick="mesEditTest('${esc(x.Id)}')" title="Duplo clique para editar e compartilhar"><strong>${esc(name(x.Recurso))}</strong><small>${esc(x.Inicio)}–${esc(x.Fim)} · ${esc(x.Descricao||'Teste')}</small>${!short?`<small>${esc(x.Data)} · ${A(x.Calendarios).length} calendário(s) adicional(is)</small>`:''}</article>`}
window.mesEditTest=function(id){
 init();const x=data.pcp_caracterizacao.find(r=>String(r.Id)===String(id));if(!x)return;
 let dlg=document.getElementById('mes-test-editor');if(dlg)dlg.remove();dlg=document.createElement('dialog');dlg.id='mes-test-editor';
 dlg.innerHTML=`<form method="dialog" style="min-width:min(460px,85vw);display:grid;gap:10px"><h3>Editar teste / compartilhar nos calendários</h3><label>Equipamento <select id="mte-resource">${resources().map(r=>`<option value="${esc(code(r))}" ${code(r)===String(x.Recurso)?'selected':''}>${esc(r.Equipamento||code(r))}</option>`).join('')}</select></label><label>Data <input id="mte-date" type="date" value="${esc(x.Data)}"></label><label>Início <input id="mte-start" type="time" value="${esc(x.Inicio)}"></label><label>Fim <input id="mte-end" type="time" value="${esc(x.Fim)}"></label><label>Descrição <input id="mte-desc" value="${esc(x.Descricao||'')}"></label><b>Exibir também em:</b>${lines.map(([k,v])=>`<label><input type="checkbox" class="mte-flag" value="${k}" ${A(x.Calendarios).includes(k)?'checked':''}> ${v}</label>`).join('')}<div style="display:flex;gap:8px"><button type="button" id="mte-save">Salvar</button><button type="button" id="mte-delete">Excluir teste</button><button type="button" onclick="this.closest('dialog').close()">Cancelar</button></div></form>`;
 document.body.appendChild(dlg);
 dlg.querySelector('#mte-save').onclick=()=>{const d=dlg.querySelector('#mte-date').value,a=dlg.querySelector('#mte-start').value,b=dlg.querySelector('#mte-end').value;if(!d||!a||!b||a>=b)return alert('Informe data e horários válidos.');Object.assign(x,{Recurso:dlg.querySelector('#mte-resource').value,Data:d,Inicio:a,Fim:b,Descricao:dlg.querySelector('#mte-desc').value,Calendarios:[...dlg.querySelectorAll('.mte-flag:checked')].map(el=>el.value)});saveLocal();dlg.close();refresh()};
 dlg.querySelector('#mte-delete').onclick=()=>{if(!confirm('Excluir este teste?'))return;data.pcp_caracterizacao=data.pcp_caracterizacao.filter(r=>r!==x);saveLocal();dlg.close();refresh()};
 dlg.showModal();
};
function refresh(){if(window.__pcpLineV2314==='Caracterizacao')window.mesCaracterizacao();else window.pcpCalendarioV2312()}
window.mesCaracterizacao=function(){
 init();const m=window.__mesCarMonth||document.getElementById('pcp_month_pick')?.value||iso(new Date()).slice(0,7);
 const [y,mm]=m.split('-').map(Number),offset=new Date(y,mm-1,1).getDay(),days=new Date(y,mm,0).getDate();
 const cells=Array.from({length:offset},()=>'<div class="mes-test-day outside"></div>');
 for(let n=1;n<=days;n++){const d=`${m}-${String(n).padStart(2,'0')}`;cells.push(`<div class="mes-test-day"><b>${n}</b>${data.pcp_caracterizacao.filter(x=>x.Data===d).map(x=>card(x)).join('')}</div>`)}
 while(cells.length%7)cells.push('<div class="mes-test-day outside"></div>');
 const select=resources().map(r=>`<option value="${esc(code(r))}">${esc(r.Equipamento||code(r))}</option>`).join('');
 document.getElementById('title').textContent='Calendário — Testes de Caracterização';
 document.getElementById('subtitle').textContent='Kanban independente de OP; duplo clique para editar e compartilhar.';
 document.getElementById('content').innerHTML=`<div class="toolbar"><button onclick="window.__pcpLineV2314='';pcpCalendarioV2312()">Voltar ao PCP</button><button onclick="mesTestMonth(-1)">← Mês</button><input type="month" value="${m}" onchange="window.__mesCarMonth=this.value;mesCaracterizacao()"><button onclick="mesTestMonth(1)">Mês →</button></div><div class="toolbar"><select id="mt-resource">${select}</select><input id="mt-date" type="date" value="${iso(new Date())}"><input id="mt-start" type="time" value="08:00"><input id="mt-end" type="time" value="09:00"><input id="mt-desc" placeholder="Descrição do teste"><button onclick="mesTestAdd()">Criar cartão Kanban</button></div>${!select?'<p>Cadastre equipamentos na escala Testes de Caracterização para programá-los.</p>':''}<div class="mes-test-week">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(x=>`<b>${x}</b>`).join('')}</div><div class="mes-test-grid">${cells.join('')}</div>`;
};
window.mesTestMonth=function(n){const m=window.__mesCarMonth||iso(new Date()).slice(0,7),[y,mo]=m.split('-').map(Number);window.__mesCarMonth=iso(new Date(y,mo-1+n,1)).slice(0,7);mesCaracterizacao()};
window.mesTestAdd=function(){init();const get=id=>document.getElementById(id)?.value||'';const r=get('mt-resource'),d=get('mt-date'),a=get('mt-start'),b=get('mt-end');if(!r||!d||!a||!b||a>=b)return alert('Selecione equipamento, data e horários válidos.');data.pcp_caracterizacao.push({Id:'CAR-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),Recurso:r,Data:d,Inicio:a,Fim:b,Descricao:get('mt-desc'),Calendarios:[]});saveLocal();mesCaracterizacao()};
const old=window.pcpCalendarioV2312;
if(typeof old==='function')window.pcpCalendarioV2312=function(){const result=old.apply(this,arguments);init();const filter=window.__pcpLineV2314||'';if(filter==='Caracterizacao')return mesCaracterizacao();const month=document.getElementById('pcp_month_pick')?.value;const cells=document.querySelectorAll('.pcp-month-v2314 .pcp-day-v2314:not(.outside)');cells.forEach(cell=>{const n=Number(cell.querySelector('header b')?.textContent);if(!n||!month)return;const d=month+'-'+String(n).padStart(2,'0');const tests=data.pcp_caracterizacao.filter(x=>x.Data===d&&visible(x,filter));if(!tests.length)return;const body=cell.querySelector('.pcp-day-body-v2314');if(body)body.insertAdjacentHTML('beforeend',tests.map(x=>card(x,true)).join(''))});return result};
const css=document.createElement('style');css.textContent='.mes-test-week,.mes-test-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.mes-test-week{text-align:center}.mes-test-day{min-height:105px;min-width:0;border:1px solid #bdcedb;border-radius:4px;padding:5px}.mes-test-day.outside{background:#f2f4f6}.mes-test-kanban{background:#e7f1ff;border:1px solid #5b92cf;border-left:4px solid #1764aa;border-radius:4px;padding:5px;margin:4px 0;overflow-wrap:anywhere;cursor:pointer;font-size:11px}.mes-test-kanban small{display:block;font-size:10px}.mes-test-kanban strong{display:block}';document.head.appendChild(css);
})();
