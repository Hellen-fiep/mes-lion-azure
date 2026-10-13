(function(){'use strict';
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','&quot;': '&quot;',"'":'&#39;'}[c]));}
function update(){
 if(typeof data==='undefined'||!Array.isArray(data.op)||!Array.isArray(data.projetos))return;
 const title=document.getElementById('title')?.textContent||'';
 if(!/Ordens de Produção/i.test(title))return;
 const opSelect=document.getElementById('selOp');
 if(!opSelect)return;
 let panel=document.getElementById('mes-op-project');
 if(!panel){panel=document.createElement('div');panel.id='mes-op-project';panel.style.cssText='padding:10px;border:1px solid #c4d2df;margin:10px 0;background:#f3f8ff';opSelect.closest('.toolbar')?.after(panel);}
 if(!panel)return;
 const op=data.op.find(x=>String(x.CodOP)===String(opSelect.value));
 if(!op){panel.textContent='Selecione uma OP para associar um projeto.';return}
 const current=op.CodProjeto||'';
 if(panel.dataset.op===String(op.CodOP)&&panel.dataset.projects===String(data.projetos.length)&&panel.dataset.value===current)return;
 panel.dataset.op=String(op.CodOP);panel.dataset.projects=String(data.projetos.length);panel.dataset.value=current;
 panel.innerHTML='<b>Projeto vinculado à OP: </b><select id="mes-op-project-select"><option value="">Selecionar projeto</option>'+data.projetos.map(x=>'<option value="'+esc(x.CodProjeto)+'" '+(String(x.CodProjeto)===String(current)?'selected':'')+'>'+esc(x['Nome Projeto']||x.NomeProjeto||x.CodProjeto)+'</option>').join('')+'</select> <button type="button" id="mes-op-project-save">Vincular projeto à OP</button>';
 panel.querySelector('#mes-op-project-save').onclick=()=>{op.CodProjeto=panel.querySelector('select').value;panel.dataset.value=op.CodProjeto;saveLocal();alert('Projeto vinculado à OP '+op.CodOP)};
}
document.addEventListener('change',e=>{if(e.target?.id==='selOp')setTimeout(update,0)});
document.addEventListener('click',()=>setTimeout(update,80));
document.addEventListener('DOMContentLoaded',()=>{setInterval(update,1200)});
const st=document.createElement('style');st.textContent='.mes-project-tag{display:block;font-weight:800;color:#143a68;font-size:12px;margin:2px 0}';document.head.appendChild(st);
})();