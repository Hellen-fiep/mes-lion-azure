/* MES LION V1.0.21 — limpeza do fluxo de OP + layout compacto da estruturação */
(function(){
  const VERSION='1.0.21';

  function removeLegacyPAButton(){
    const root=document.getElementById('content');
    if(!root) return;
    [...root.querySelectorAll('button')].forEach(b=>{
      const t=String(b.textContent||'').trim();
      if(/Gerar\s*PA\s*\/\s*escolher\s*origem\s*dos\s*PIs/i.test(t)) b.remove();
    });
  }

  // O fluxo oficial é Estruturar OP -> escolher origem/quantidade dos PIs -> Gerar OPs.
  // A rotina antiga permanece no código-base somente por compatibilidade de dados,
  // mas não é mais exposta ao usuário.
  if(typeof opModule==='function'){
    const baseOpModule=opModule;
    opModule=function(){
      baseOpModule();
      removeLegacyPAButton();
      setTimeout(removeLegacyPAButton,0);
    };
  }

  // Mantém a mesma regra funcional V1.0.17, alterando somente a apresentação.
  if(typeof v1011PlanningRowsHTML==='function'){
    v1011PlanningRowsHTML=function(r,codFormula){
      const rows=v1011RouteProducts(r);
      return `<div class="v1011-family-plan v1021-family-plan"><div class="card"><h3>Estrutura da produção — informe origem e quantidade de cada PI</h3><p class="muted">A formulação <b>${htmlEscape(codFormula||'')}</b> será aplicada somente aos slurrys. Para os demais PIs, a etapa consome o PI anterior. Se um ou mais PIs prontos forem selecionados, nenhuma OP será criada para fabricá-los — a quantidade necessária pode ser somada a partir de vários lotes.</p><div class="table-wrap v1021-plan-scroll"><table class="v1021-plan-table"><thead><tr><th>Seq.</th><th>PI / PA</th><th>Nome</th><th>Processo</th><th>Origem</th><th>Lote(s) PI pronto</th><th>Quantidade / massa a produzir</th><th>UM</th></tr></thead><tbody>${rows.map((cod,i)=>{
        const p=v1011Prod(cod),role=v1011Role(cod),isPA=role==='PA',lots=isPA?[]:v1011LotsForRole(role),um=v101ProductUM(cod,r)||prodUMV382(cod)||unidadeProdutoV35(cod)||'un';
        const lotsHtml=lots.length?`<div class="v1017-lots-wrap v1021-lots-wrap">${lots.map(l=>{const label=v1011LotLabel(l);return `<label class="v1017-lot-row v1021-lot-row" title="${htmlEscape(label)}"><input type="checkbox" class="v1017-lot-flag v1021-lot-flag" data-lotid="${htmlEscape(l.IdLotePI)}" disabled onchange="v1017SyncLotQty(this)"><span class="v1021-lot-label">${htmlEscape(label)}</span><input type="number" class="v1017-lot-qty v1021-lot-qty" min="0" step="0.000001" max="${v403SaldoLote(l)}" placeholder="Qtd deste lote" disabled></label>`}).join('')}</div>`:'<div class="empty-v382">Sem lote compatível</div>';
        return `<tr class="v1011-plan-row" data-code="${htmlEscape(cod)}" data-role="${role}"><td>${i+1}</td><td><b>${htmlEscape(cod)}</b></td><td class="v1021-text-cell" title="${htmlEscape(p['Descrição']||'')}">${htmlEscape(p['Descrição']||'')}</td><td class="v1021-text-cell" title="${htmlEscape(v1011RouteProcess(r,cod)||v1011RoleLabel(role))}">${htmlEscape(v1011RouteProcess(r,cod)||v1011RoleLabel(role))}</td><td>${isPA?'<b>Produzir PA</b>':`<select class="v1011-origin v1021-origin" onchange="v1011ToggleLot(this)"><option value="PRODUZIR">Produzir nova OP</option><option value="LOTE" ${lots.length?'':'disabled'}>Usar PI pronto / lote(s) existente(s)${lots.length?'':' (sem saldo)'}</option></select>`}</td><td>${isPA?'—':lotsHtml}</td><td><input class="v1011-qtd v1021-total-qty" type="number" min="0" step="0.000001" placeholder="Informe ${htmlEscape(um)}"></td><td><b>${htmlEscape(um)}</b></td></tr>`;
      }).join('')}</tbody></table></div><div class="form-actions"><button class="green" onclick="v1011ConfirmFamily('${jsq(r.CodRoteiro)}','${jsq(codFormula)}')">Gerar estrutura de OPs</button><button class="secondary" onclick="$ ('crudBox').innerHTML=''">Cancelar</button></div></div></div>`.replace("$ ('crudBox')","$('crudBox')");
    };
  }

  try{
    data.meta=data.meta||{};
    data.meta.versao='V'+VERSION;
    data.meta.baseOperacional=(data.meta.baseOperacional||'')+' | V1.0.21: remove botão legado Gerar PA/escolher origem dos PIs e compacta estruturação de OP sem sobreposição';
    saveLocal();
  }catch(e){console.warn('MES LION V1.0.21 meta',e);}
  document.title='MES LION V1.0.21';
  removeLegacyPAButton();
})();
