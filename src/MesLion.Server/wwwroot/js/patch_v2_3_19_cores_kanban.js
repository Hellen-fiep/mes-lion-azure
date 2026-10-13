/* MES LION V2.3.19 — cores determinísticas por processo e equipamento no Kanban. */
(function(){
  const processPalettes=[
    ['#e8f3ff','#1769aa','#0b4778'], ['#f1ebff','#7352b8','#4b3180'],
    ['#fff3df','#c47b14','#7a4b08'], ['#e8f7f0','#26835e','#17573f'],
    ['#fdecef','#b94d69','#7e2f44'], ['#eef0ff','#5266b8','#34417c'],
    ['#f2f4e7','#7d8a36','#505a20'], ['#f7ecff','#9654b8','#63347b']
  ];
  const equipPalettes=[
    ['#dff5e7','#237a45'], ['#fde3ee','#a53d69'], ['#ffe7c7','#a95d00'],
    ['#e0efff','#2269a8'], ['#eee4ff','#7045a8'], ['#fff4bf','#8a6a00'],
    ['#dff4f3','#25736f'], ['#f2e7dc','#82583b'], ['#e8ebef','#4f5b66']
  ];
  function hash(s){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;return Math.abs(h)}
  function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
  function processPalette(name){let n=norm(name);if(n.includes('mistura'))return processPalettes[0];if(n.includes('coating')||n.includes('depos'))return processPalettes[1];if(n.includes('corte'))return processPalettes[2];if(n.includes('montagem'))return processPalettes[3];return processPalettes[hash(n)%processPalettes.length]}
  function equipPalette(name){let n=norm(name);if(n.includes('filtro'))return ['#dff5e7','#237a45'];if(n.includes('mistur'))return ['#fde3ee','#a53d69'];if(n.includes('estufa'))return ['#ffe7c7','#a95d00'];return equipPalettes[hash(n)%equipPalettes.length]}
  function apply(){document.querySelectorAll('.pcp-card-v2317').forEach(card=>{
    let title=card.querySelector('b')?.textContent?.trim()||'Operação';
    let smalls=[...card.querySelectorAll('small')]; let eq=smalls[0]; if(!eq)return;
    let equip=eq.textContent.trim(); let p=processPalette(title), e=equipPalette(equip);
    card.style.setProperty('background',p[0],'important');card.style.setProperty('border-color',p[1],'important');card.style.setProperty('border-left-color',p[1],'important');
    card.style.setProperty('--pcp-process-color',p[2]);
    let b=card.querySelector('b');if(b)b.style.color=p[2];
    eq.classList.add('pcp-equip-badge-v2319');eq.style.setProperty('background',e[0],'important');eq.style.setProperty('color',e[1],'important');eq.style.setProperty('border-color',e[1],'important');
    card.dataset.processColor=title;card.dataset.equipmentColor=equip;
  })}
  function style(){if(document.getElementById('pcp-v2319-style'))return;let st=document.createElement('style');st.id='pcp-v2319-style';st.textContent=`
    .pcp-card-v2317{transition:filter .12s ease,box-shadow .12s ease}
    .pcp-card-v2317 .pcp-equip-badge-v2319{display:inline-block!important;width:auto!important;max-width:100%;margin:3px 0 2px;padding:2px 5px;border:1px solid;border-radius:999px;font-weight:700;font-size:8px!important;line-height:1.25;white-space:normal}
    .pcp-card-v2317>span{color:#334155}.pcp-card-v2317>small:last-child{color:#52606d}
    @media(hover:hover) and (pointer:fine){.pcp-card-v2317:hover{filter:brightness(.985);box-shadow:0 1px 4px rgba(0,0,0,.12)}}
  `;document.head.appendChild(st)}
  style();apply();
  let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;apply()})}).observe(document.body,{childList:true,subtree:true});
  try{data.meta=data.meta||{};data.meta.versao='V2.3.19';saveLocal();}catch(e){}
})();
