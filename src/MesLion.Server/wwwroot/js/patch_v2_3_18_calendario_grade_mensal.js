/* MES LION V2.3.18 — calendário mensal fixo em grade de 7 dias por semana. */
(function(){
  function installStyle(){
    var old=document.getElementById('pcp-v2318-style'); if(old) old.remove();
    var st=document.createElement('style'); st.id='pcp-v2318-style';
    st.textContent=`
      .pcp-week-head-v2314,.pcp-month-v2314{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr))!important;gap:4px!important;width:100%!important;min-width:0!important;overflow:visible!important}
      .pcp-week-head-v2314{margin-top:7px;text-align:center;color:#064a82}
      .pcp-week-head-v2314>b{min-width:0;padding:4px 2px;background:#eef4f8;border:1px solid #d7e1e8;border-radius:4px;font-size:10px}
      .pcp-month-v2314{grid-auto-flow:row!important;grid-auto-rows:auto!important;align-items:stretch!important}
      .pcp-day-v2314{box-sizing:border-box!important;width:auto!important;min-width:0!important;max-width:none!important;min-height:118px!important;border:1px solid #d5dfe7;border-radius:5px;background:#fff;overflow:hidden!important;margin:0!important;display:block!important}
      .pcp-day-v2314.outside{background:#f5f7f8;border-style:dashed;min-height:40px!important}
      .pcp-day-v2314.today{outline:2px solid #3b82b8;outline-offset:-2px}
      .pcp-day-v2314>header{display:flex!important;justify-content:space-between;padding:4px 6px;background:#f5f8fa;border-bottom:1px solid #dce4ea;color:#064a82;font-size:10px}
      .pcp-day-body-v2314{padding:4px;display:flex!important;flex-direction:column!important;gap:3px;min-width:0}
      .pcp-day-body-v2314 em{color:#a0a9b0;font-size:9px}
      .pcp-month-v2314 .pcp-card-v2317,.pcp-month-v2314 .pcp-card-v2314{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;margin:0!important;background:#edf6ff;border:1px solid #78a9d1;border-left:4px solid #1268a8;border-radius:4px;padding:4px;cursor:grab;font-size:9px;overflow:hidden}
      .pcp-month-v2314 .pcp-card-v2317 b,.pcp-month-v2314 .pcp-card-v2317 span,.pcp-month-v2314 .pcp-card-v2317 small{display:block;white-space:normal;overflow-wrap:anywhere;word-break:break-word}
      .pcp-month-v2314 .pcp-card-v2317 span,.pcp-month-v2314 .pcp-card-v2317 small{font-size:8px}
      .pcp-block-v2314{box-sizing:border-box;width:100%;background:#fde8e8;border:1px solid #c62828;border-left:4px solid #b71c1c;border-radius:4px;padding:3px;color:#8b1010;font-size:8px;overflow:hidden}
      #content{min-width:0!important;overflow-x:hidden!important}
      @media(max-width:1050px){.pcp-day-v2314{min-height:100px!important}.pcp-month-v2314 .pcp-card-v2317{font-size:8px;padding:3px}.pcp-week-head-v2314>b{font-size:9px}}
    `;
    document.head.appendChild(st);
  }
  installStyle();
  var previous=window.pcpCalendarioV2312;
  if(typeof previous==='function'){
    window.pcpCalendarioV2312=function(){
      var out=previous.apply(this,arguments); installStyle();
      try{ data.meta=data.meta||{}; data.meta.versao='V2.3.18'; saveLocal(); }catch(e){}
      return out;
    };
  }
})();
