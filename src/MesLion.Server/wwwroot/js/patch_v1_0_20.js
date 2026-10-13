/* =====================================================================
   MES LION V1.0.20 — WIP IMEDIATO + LIMPEZA DA TELA DE OP
   - OP planejada deve aparecer no WIP assim que for gerada/salva.
   - Apontamento NÃO é pré-requisito para entrada no Dashboard.
   - Classificação tipo/escala resolve OP -> roteiro -> roteiro-base -> família.
   - Remove da tela de OP o painel redundante "Fluxo de produção em andamento".
   - Mantém PIs externos/isolados em rosa exclusivamente no Dashboard.
   ===================================================================== */
const APP_VERSION_V1020='V1.0.20';

function v1020Norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function v1020OpByCode(c){return (data.op||[]).find(o=>String(o.CodOP||'')===String(c||''));}
function v1020ParentOp(op){
  if(!op)return null;
  const refs=[op.OP_Pai,op.OPPai,op.CodOPPA,op.OP_Base,op.OPBase].filter(Boolean);
  for(const r of refs){const x=v1020OpByCode(r);if(x&&x!==op)return x;}
  if(String(op.TipoOP||'').toUpperCase()==='PI'){
    const stem=String(op.CodOP||'').replace(/-[^-]+$/,'');
    return v1020OpByCode(stem+'-PA')||null;
  }
  return null;
}
function v1020Route(op){
  if(!op)return {};
  const routes=data.roteiro||[];
  const code=String(op.CodRoteiro||op.CodigoRoteiro||'').trim();
  if(code){
    let r=routes.find(x=>String(x.CodRoteiro||'')===code);if(r)return r;
    // Roteiros derivados/cópias continuam pertencendo à mesma classificação.
    const base=code.replace(/_COPIA.*$/i,'').replace(/-COPIA.*$/i,'');
    r=routes.find(x=>String(x.CodRoteiro||'')===base);if(r)return r;
    r=routes.find(x=>code.startsWith(String(x.CodRoteiro||'')+'_COPIA')||code.startsWith(String(x.CodRoteiro||'')+'-COPIA'));if(r)return r;
  }
  const prod=String(op.CodigoPI||op.ProdutoGerado||op.Produto||op.CodigoProduto||'').trim();
  if(prod){const r=routes.find(x=>String(x.CodigoPI||x.CodigoProduto||'')===prod);if(r)return r;}
  const p=v1020ParentOp(op);return p?v1020Route(p):{};
}
function v1020Prod(op){
  const cod=String(op?.CodigoPI||op?.ProdutoGerado||op?.Produto||op?.CodigoProduto||'').trim();
  return (typeof produtoPorCodigo==='function'?produtoPorCodigo(cod):null)||{};
}
function v1020Type(op,depth=0){
  if(!op||depth>4)return '';
  const r=v1020Route(op),p=v1020Prod(op);
  const candidates=[op.TipoCelula,op.TipoCélula,op.ModeloCelula,op.Modelo,r.TipoCelula,r.TipoCélula,r.Tipo,r.ModeloCelula,r.Modelo,p['Tipo de Célula'],p.TipoCelula,p.Modelo];
  for(const raw of candidates){const n=v1020Norm(raw);if(n.includes('prism'))return 'Prismática';if(n.includes('cil'))return 'Cilíndrica';}
  const parent=v1020ParentOp(op);return parent&&parent!==op?v1020Type(parent,depth+1):'';
}
function v1020Scale(op,depth=0){
  if(!op||depth>4)return '';
  const r=v1020Route(op);
  const candidates=[op.EscalaProducao,op.Escala,r.EscalaProducao,r.Escala,r.EscalaPlanta];
  for(const raw of candidates){const n=v1020Norm(raw);if(n.includes('industrial'))return 'Industrial';if(n.includes('piloto')||n.includes('laboratorio'))return 'Planta Piloto';}
  const parent=v1020ParentOp(op);return parent&&parent!==op?v1020Scale(parent,depth+1):'';
}

// Substitui a classificação rígida usada pelos 4 WIPs.
v105Type=v1020Type;
v105Scale=v1020Scale;

function v1020EligibleOps(type,scale){
  return (data.op||[])
    .filter(o=>!v105Cancelled(o) && v1020Type(o)===type && v1020Scale(o)===scale)
    .sort((a,b)=>{
      // Planejadas / em produção primeiro; concluídas continuam consultáveis depois.
      const ac=v105Closed(a)?1:0,bc=v105Closed(b)?1:0;if(ac!==bc)return ac-bc;
      const ad=String(a.DataCriacao||a.DataOP||a.CriadoEm||''),bd=String(b.DataCriacao||b.DataOP||b.CriadoEm||'');
      return bd.localeCompare(ad);
    });
}
v105EligibleOps=v1020EligibleOps;

// Atualiza as opções dos 4 WIPs sem exigir apontamento e preserva a seleção atual.
function v1020RefreshWipSelectors(){
  if(current!=='dashboard')return;
  ['v105_wip_1','v105_wip_2','v105_wip_3','v105_wip_4'].forEach(id=>{
    const root=document.getElementById(id);if(!root)return;
    const type=root.dataset.type||'',scale=root.dataset.scale||'',sel=root.querySelector('.v105-op-select');if(!sel)return;
    const old=sel.value,rows=v1020EligibleOps(type,scale),fallback=rows[0]?.CodOP||'';
    sel.innerHTML=v105OpOptions(type,scale,(rows.some(o=>String(o.CodOP)===String(old))?old:fallback));
    const chosen=rows.some(o=>String(o.CodOP)===String(old))?old:fallback;if(chosen)sel.value=chosen;
    v108WipOpChanged(id);
  });
}

// Toda persistência feita enquanto o Dashboard estiver aberto atualiza o WIP.
const v1020SaveLocalBase=saveLocal;
saveLocal=function(){
  const ret=v1020SaveLocalBase.apply(this,arguments);
  if(current==='dashboard'){
    clearTimeout(window.__v1020DashRefresh);
    window.__v1020DashRefresh=setTimeout(()=>{try{v1020RefreshWipSelectors();}catch(e){console.warn('V1.0.20 refresh WIP',e);}},80);
  }
  return ret;
};

// A tela de Ordens de Produção não deve duplicar o fluxo do Dashboard.
const v1020OpModuleBase=opModule;
opModule=function(){
  const ret=v1020OpModuleBase.apply(this,arguments);
  const content=$('content');if(content){
    content.querySelectorAll('.v1018-wip-panel,.v1014-wip-card').forEach(el=>el.remove());
  }
  return ret;
};

// Reforça a regra após a montagem do Dashboard V1.0.19.
const v1020DashboardBase=dashboard;
dashboard=function(){
  const ret=v1020DashboardBase.apply(this,arguments);
  requestAnimationFrame(()=>{try{v1020RefreshWipSelectors();}catch(e){console.warn('V1.0.20 dashboard',e);}});
  return ret;
};
v108Dashboard=dashboard;v105Dashboard=dashboard;

try{
  data.meta=data.meta||{};
  data.meta.versao=APP_VERSION_V1020;
  data.meta.baseOperacional=(data.meta.baseOperacional||'')+' | V1.0.20: OP planejada entra no WIP sem apontamento; classificação robusta tipo/escala; fluxo redundante removido da tela OP';
  v1020SaveLocalBase();
  document.title='MES LION V1.0.20';
}catch(e){console.warn('MES LION V1.0.20',e);}
