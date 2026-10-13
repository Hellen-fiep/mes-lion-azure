/* Scheduler v1.0.5 — etapa em paralelo por recurso; restrições por recurso e dia. */
(function(){'use strict';
const A=x=>Array.isArray(x)?x:[];
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dt=x=>{if(!x)return null;const m=String(x).match(/^(\d\d)\/(\d\d)\/(\d{4})\D+(\d\d):(\d\d)/);return m?new Date(+m[3],+m[2]-1,+m[1],+m[4],+m[5]):new Date(x)};
const br=d=>`${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const resource=p=>String(p.RecursoRoteiro||p.Recurso||'');
const line=()=>String(window.__pcpLineV2314||'Todas');
function holiday(d){let y=d.getFullYear(),md=iso(d).slice(5);const fixed=['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'];if(fixed.includes(md))return true;let a=y%19,b=Math.floor(y/100),c=y%100,dd=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-dd-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451),em=Math.floor((h+l-7*m+114)/31),ed=(h+l-7*m+114)%31+1;let easter=new Date(y,em-1,ed);easter.setDate(easter.getDate()-2);return iso(easter)===iso(d)}
function dayAllowed(d){const date=iso(d),ln=line();const exc=A(data.meta?.calendarioExcecoes).filter(x=>x.Data===date&&(x.Linha===ln||x.Linha==='Todas')).sort((a,b)=>(a.Linha===ln?1:0)-(b.Linha===ln?1:0)).pop();if(exc)return exc.Tipo==='Liberar';return d.getDay()!==0&&d.getDay()!==6&&!holiday(d)}
function restrictions(r,date){return A(data.pcp_calendarios).filter(x=>String(x.Recurso)===r&&String(x.Data).slice(0,10)===date).map(x=>({start:new Date(date+'T'+(x.Inicio||'00:00')),end:new Date(date+'T'+(x.Fim||'23:59'))}));}
function daySlots(d){let date=iso(d);return [[new Date(date+'T08:00'),new Date(date+'T12:00')],[new Date(date+'T13:00'),new Date(date+'T17:00')]]}
function nextWork(t,r,busy){let day=new Date(t);day.setHours(0,0,0,0);for(let k=0;k<1500;k++){if(dayAllowed(day)){let blocked=[...restrictions(r,iso(day)),...A(busy[r])];for(let [start,end] of daySlots(day)){let cur=new Date(Math.max(start.getTime(),t.getTime()));while(cur<end){let hit=blocked.find(x=>cur>=x.start&&cur<x.end);if(hit){cur=new Date(hit.end);continue}let next=blocked.filter(x=>x.start>cur&&x.start<end).sort((a,b)=>a.start-b.start)[0];let limit=next?next.start:end;if(limit>cur)return [cur,limit];break}}}day.setDate(day.getDate()+1);day.setHours(0,0,0,0)}return null}
function allocate(t,minutes,r,busy){let cur=new Date(t),first=null,remaining=Math.ceil(minutes),guard=0,segments=[];while(remaining>0&&guard++<10000){let slot=nextWork(cur,r,busy);if(!slot)return null;let available=Math.floor((slot[1]-slot[0])/60000);if(available<=0){cur=new Date(slot[1].getTime()+60000);continue}let take=Math.min(remaining,available);if(!first)first=slot[0];cur=new Date(slot[0].getTime()+take*60000);remaining-=take;segments.push({start:new Date(slot[0]),end:new Date(cur)})}return remaining===0?{start:first,end:cur,segments}:null}
window.mesGerarProjecao=function(){const val=document.getElementById('mes-proj-date')?.value;if(!val)return alert('Informe a data inicial');const begin=new Date(val+'T08:00');const rows=A(data.pcp_programacao),filter=line();let selected=rows.filter(p=>!p.Inicio&&(!filter||filter==='Todas'||(typeof window.mesMatchesLine==='function'?window.mesMatchesLine(p,filter):true)));
const busy={};rows.filter(p=>p.Inicio&&p.Fim).forEach(p=>{let a=dt(p.Inicio),b=dt(p.Fim);if(a&&b&&!isNaN(a)&&!isNaN(b))(busy[resource(p)]??=[]).push({start:a,end:b})});
const result=[],skipped=[],stages=new Map();
for(const p of selected){const order=Number(p.Ordem);if(!Number.isFinite(order)){skipped.push('Etapa inválida: '+p.OP);continue}if(!stages.has(order))stages.set(order,[]);stages.get(order).push(p)}
const stageFinish=new Map(), opFinish=new Map();
for(const [ord,items] of [...stages].sort((a,b)=>a[0]-b[0])){
 const grouped=new Map();
 for(const p of items){const op=String(p.OP||p.CodOP||'');if(!grouped.has(op))grouped.set(op,[]);grouped.get(op).push(p)}
 for(const [op,stage] of grouped){
   let cursor=new Date(begin);
   for(const [priorOrder,ends] of stageFinish)if(priorOrder<ord)for(const end of ends)if(end>cursor)cursor=new Date(end);
   for(const q of rows.filter(q=>q.Inicio&&q.Fim&&Number(q.Ordem)<ord)){const end=dt(q.Fim);if(end&&!isNaN(end)&&end>cursor)cursor=new Date(end)}
   if(opFinish.has(op)&&opFinish.get(op)>cursor)cursor=new Date(opFinish.get(op));
   let latest=new Date(cursor);
   for(const p of stage){
     const r=resource(p),mins=Number(p.Minutos)||0;
     if(!r||mins<=0){skipped.push(op+' / '+ord+': recurso ou duração ausente');continue}
     const slot=allocate(cursor,mins,r,busy);
     if(!slot){skipped.push(op+' / '+ord+' / '+r+': sem janela');continue}
     result.push({p,a:slot.start,b:slot.end,segments:slot.segments});
     for(const seg of slot.segments)(busy[r]??=[]).push(seg);
     if(slot.end>latest)latest=slot.end;
   }
   if(!stageFinish.has(ord))stageFinish.set(ord,[]);
   stageFinish.get(ord).push(latest);opFinish.set(op,latest);
 }
}
window.__mesProjection=result;let box=document.getElementById('mes-proj-result');if(!box)return;box.replaceChildren();const summary=document.createElement('p');summary.textContent=`${result.length} operações propostas; ${skipped.length} pendências. Etapas em ordem, equipamentos da mesma etapa em paralelo, respeitando restrições individuais.`;box.append(summary);const div=document.createElement('div');div.style.cssText='max-height:250px;overflow:auto';for(const x of result){const row=document.createElement('div');row.textContent=`${x.p.OP} · Etapa ${x.p.Ordem} · ${resource(x.p)} · ${br(x.a)} → ${br(x.b)}`;div.append(row)}for(const s of skipped){const row=document.createElement('div');row.style.color='#b3261e';row.textContent='PENDENTE: '+s;div.append(row)}box.append(div);const btn=document.createElement('button');btn.type='button';btn.textContent='Confirmar e salvar';btn.disabled=!result.length||!!skipped.length;btn.onclick=()=>{for(const x of result){if(x.p.Inicio)continue;x.p.Inicio=br(x.a);x.p.Fim=br(x.b);x.p.Segmentos=x.segments.map(g=>({Inicio:br(g.start),Fim:br(g.end)}));x.p.ConflitoPendente='PENDENTE_VALIDACAO'}saveLocal();document.getElementById('mes-proj-dialog')?.close();pcpCalendarioV2312()};box.append(btn)};
window.mesEditarDia=function(date){const ln=line();const old=document.getElementById('mes-edit-day-dialog');if(old)old.remove();const d=document.createElement('dialog');d.id='mes-edit-day-dialog';d.innerHTML='<form method="dialog" style="display:grid;gap:12px;min-width:320px"><h3>Disponibilidade do dia</h3><p id="mes-day-label"></p><label>Regra <select id="mes-day-mode"><option value="PADRAO">Padrão</option><option value="LIBERAR">Liberar expediente</option><option value="BLOQUEAR">Bloquear dia</option></select></label><label>Motivo <input id="mes-day-reason" placeholder="Motivo da restrição"></label><div><button type="button" id="mes-day-save">Salvar</button> <button type="button" id="mes-day-cancel">Cancelar</button></div></form>';document.body.append(d);d.querySelector('#mes-day-label').textContent=date+' — '+ln;const existing=A(data.meta?.calendarioExcecoes).find(x=>x.Data===date&&x.Linha===ln);d.querySelector('#mes-day-mode').value=existing?.Tipo==='Liberar'?'LIBERAR':existing?.Tipo==='Bloquear'?'BLOQUEAR':'PADRAO';d.querySelector('#mes-day-reason').value=existing?.Motivo||'';d.querySelector('#mes-day-cancel').onclick=()=>d.close();d.querySelector('#mes-day-save').onclick=()=>{data.meta=data.meta||{};let list=A(data.meta.calendarioExcecoes).filter(x=>!(x.Data===date&&x.Linha===ln));const mode=d.querySelector('#mes-day-mode').value;if(mode!=='PADRAO')list.push({Data:date,Linha:ln,Tipo:mode==='LIBERAR'?'Liberar':'Bloquear',Motivo:d.querySelector('#mes-day-reason').value||'Indisponível'});data.meta.calendarioExcecoes=list;saveLocal();d.close();if(ln==='Caracterizacao'&&typeof mesCaracterizacao==='function')mesCaracterizacao();else pcpCalendarioV2312()};d.addEventListener('close',()=>d.remove());d.showModal()};
})();
