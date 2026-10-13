/* MES LION V1.1.1 — Passaporte UE: somente requisitos marcados X no resumo fornecido */
(function(){
'use strict';
const VER='v1.1.1-passaporte-eu-x';
const e=v=>htmlEscape(v??'');
const g=id=>document.getElementById(id);
const input=(id,label,val='',type='text',wide=false,ph='')=>`<label class="${wide?'wide':''}"><span>${e(label)}</span><input id="${id}" type="${type}" value="${e(val)}" placeholder="${e(ph)}"></label>`;
const area=(id,label,val='',ph='')=>`<label class="wide"><span>${e(label)}</span><textarea id="${id}" placeholder="${e(ph)}">${e(val)}</textarea></label>`;
const section=(title,code,body,note='')=>`<details class="bp-eu-section" open><summary><b>${e(title)}</b><span>${e(code)}</span></summary>${note?`<p class="muted">${e(note)}</p>`:''}<div class="form-grid">${body}</div></details>`;
function prodFor(bp){try{return produtoPorCodigo(bp?.CodProduto)||{}}catch(_){return {}}}
function valAny(o,keys){for(const k of keys){if(o&&o[k]!==undefined&&o[k]!==null&&String(o[k]).trim()!=='')return o[k]}return ''}
function auto(bp,key,fallback=''){return bp?.[key]??fallback??''}
function productDefaults(bp){const p=prodFor(bp);return {
 model:valAny(p,['Modelo','Descrição']), type:valAny(p,['Composição','Célula']), cap:valAny(p,['Capacidade Final (Ah)','Capacidade (Ah)']), vnom:valAny(p,['Tensão Nominal (V)']),
 chemistry:valAny(p,['Composição','Química','Célula']), weight:valAny(p,['Peso (kg)','Massa (kg)']), category:valAny(p,['Categoria']), subcategory:valAny(p,['Subcategoria'])
};}
const baseOpen=openBPForm;
openBPForm=function(idx=-1){
  baseOpen(idx);
  const bp=idx>=0?(data.bp?.[idx]||{}):{}; const d=productDefaults(bp);
  const form=g('crudBox')?.querySelector('.form'); const actions=form?.querySelector('.form-actions'); if(!form||!actions)return;
  const wrap=document.createElement('div'); wrap.className='bp-eu-reg';
  wrap.innerHTML=`<div class="bp-eu-head"><div><h3>Campos regulatórios — Passaporte de Baterias UE</h3><p>Implementados exclusivamente os itens marcados com <b>X</b> no resumo regulatório fornecido. Itens NA, em branco, “VER” ou apenas indicados para análise futura não foram adicionados.</p></div><span>UE · X</span></div>
  ${section('Identificação do modelo e da bateria','Tabela 2 · A.1–A.11',
    input('eu_a1','A.1 — Identificação do fabricante',auto(bp,'EU_A1_Fabricante'))+
    input('eu_a2','A.2 — Local de fabrico',auto(bp,'EU_A2_LocalFabrico'))+
    input('eu_a3','A.3 — Identificação do modelo',auto(bp,'EU_A3_Modelo',d.model))+
    input('eu_a4','A.4 — Categoria da bateria',auto(bp,'EU_A4_Categoria',d.category))+
    input('eu_a5','A.5 — Subcategoria da bateria',auto(bp,'EU_A5_Subcategoria',d.subcategory))+
    input('eu_a6','A.6 — Tipo de bateria / tecnologia',auto(bp,'EU_A6_Tipo',d.type))+
    input('eu_a7','A.7 — Código único de identificação',auto(bp,'EU_A7_CodigoUnico',bp.BatteryPassportGUID||bp.BatteryPassportID||''))+
    input('eu_a8','A.8 — Ano de colocação no mercado UE',auto(bp,'EU_A8_AnoMercado'),'number')+
    input('eu_a9','A.9 — Peso da bateria (kg)',auto(bp,'EU_A9_PesoKg',d.weight),'number')+
    input('eu_a10','A.10 — Estado da bateria',auto(bp,'EU_A10_Estado','Nova'))+
    input('eu_a11','A.11 — Finalidade de uso',auto(bp,'EU_A11_Finalidade')))}
  ${section('Composição, circularidade e desempenho','1.2, 1.5–1.12 e 1.14–1.16',
    area('eu_12','1.2 — Composição material (química, substâncias perigosas exceto Hg/Cd/Pb e matérias-primas críticas)',auto(bp,'EU_1_2_Composicao',d.chemistry))+
    input('eu_15','1.5 — Conteúdo reciclado (%)',auto(bp,'EU_1_5_ConteudoReciclado'),'number')+
    input('eu_16','1.6 — Conteúdo renovável (%)',auto(bp,'EU_1_6_ConteudoRenovavel'),'number')+
    input('eu_17','1.7 — Capacidade nominal (Ah)',auto(bp,'EU_1_7_CapacidadeAh',d.cap),'number')+
    input('eu_18min','1.8 — Tensão mínima (V)',auto(bp,'EU_1_8_TensaoMin'),'number')+
    input('eu_18nom','1.8 — Tensão nominal (V)',auto(bp,'EU_1_8_TensaoNom',d.vnom),'number')+
    input('eu_18max','1.8 — Tensão máxima (V)',auto(bp,'EU_1_8_TensaoMax'),'number')+
    input('eu_18temp','1.8 — Intervalo de temperatura aplicável',auto(bp,'EU_1_8_Temperatura'))+
    input('eu_19','1.9 — Capacidade de potência original (W)',auto(bp,'EU_1_9_PotenciaW'),'number')+
    input('eu_19lim','1.9 — Limites de potência / temperatura',auto(bp,'EU_1_9_Limites'))+
    input('eu_110','1.10 — Vida útil esperada (nº de ciclos)',auto(bp,'EU_1_10_Ciclos'),'number')+
    input('eu_110ens','1.10 — Ensaio de referência',auto(bp,'EU_1_10_Ensaio'))+
    input('eu_111','1.11 — Limite de capacidade para esgotamento (VE)',auto(bp,'EU_1_11_LimiteEsgotamento'))+
    input('eu_112','1.12 — Temperatura suportada fora de uso',auto(bp,'EU_1_12_TempForaUso'))+
    input('eu_112ens','1.12 — Ensaio de referência',auto(bp,'EU_1_12_Ensaio'))+
    input('eu_114ini','1.14 — Eficiência energética inicial ida e volta (%)',auto(bp,'EU_1_14_EficienciaInicial'),'number')+
    input('eu_11450','1.14 — Eficiência a 50% da vida útil (%)',auto(bp,'EU_1_14_Eficiencia50'),'number')+
    input('eu_115cel','1.15 — Resistência interna das células',auto(bp,'EU_1_15_RICelulas'))+
    input('eu_115pack','1.15 — Resistência interna do pack',auto(bp,'EU_1_15_RIPack'))+
    input('eu_116','1.16 — Taxa C do ensaio de vida útil',auto(bp,'EU_1_16_CRate')))}
  ${section('Pegada de carbono','Tabela 3 · C.1–C.11',
    input('eu_c1','C.1 — Pegada de carbono (kg CO₂eq / unidade funcional)',auto(bp,'EU_C1_PegadaCarbono'))+
    input('eu_c2','C.2 — Unidade funcional',auto(bp,'EU_C2_UnidadeFuncional','1 kWh de capacidade nominal'))+
    input('eu_c3','C.3 — Categoria da bateria avaliada',auto(bp,'EU_C3_Categoria',d.category))+
    input('eu_c4','C.4 — Metodologia de cálculo',auto(bp,'EU_C4_Metodologia'))+
    input('eu_c5','C.5 — Limites do sistema',auto(bp,'EU_C5_LimitesSistema','Cradle-to-gate'))+
    area('eu_c6','C.6 — Fases do ciclo de vida incluídas',auto(bp,'EU_C6_Fases'))+
    area('eu_c7','C.7 — Contribuição por fase / etapa do processo',auto(bp,'EU_C7_Contribuicao'))+
    input('eu_c8','C.8 — Local de produção',auto(bp,'EU_C8_LocalProducao'))+
    input('eu_c9','C.9 — Ano/período de referência dos dados',auto(bp,'EU_C9_AnoReferencia'))+
    input('eu_c10','C.10 — Verificação independente',auto(bp,'EU_C10_Verificacao'))+
    input('eu_c11','C.11 — Identificação do verificador',auto(bp,'EU_C11_Verificador')))}
  ${section('Acesso restrito — dados técnicos','2.1–2.4',
    area('eu_21','2.1 — Composição detalhada de cátodo, ânodo e eletrólito',auto(bp,'EU_2_1_ComposicaoDetalhada'))+
    area('eu_22','2.2 — Nº de peça e fontes de peças de substituição',auto(bp,'EU_2_2_PecasFontes'))+
    area('eu_23','2.3 — Informações para desmontagem',auto(bp,'EU_2_3_Desmontagem'))+
    area('eu_24','2.4 — Medidas de segurança',auto(bp,'EU_2_4_Seguranca')),
    'Classificação mantida como acesso restrito conforme o resumo regulatório.')}
  ${section('Bateria individual','4.1',area('eu_41','4.1 — Informações específicas da bateria individual / dados resultantes do uso',auto(bp,'EU_4_1_DadosIndividuais')))}
  ${section('Marcação','Tabela 5 · M.1–M.7 e M.10',
    input('eu_m1','M.1 — Identificação do fabricante',auto(bp,'EU_M1_Fabricante',auto(bp,'EU_A1_Fabricante')))+
    input('eu_m2','M.2 — Tipo de bateria',auto(bp,'EU_M2_Tipo',d.type))+
    input('eu_m3','M.3 — Modelo da bateria',auto(bp,'EU_M3_Modelo',d.model))+
    input('eu_m4','M.4 — Capacidade nominal (Ah ou Wh)',auto(bp,'EU_M4_Capacidade',d.cap))+
    input('eu_m5','M.5 — Tensão nominal (V)',auto(bp,'EU_M5_Tensao',d.vnom))+
    input('eu_m6','M.6 — Data de fabrico',auto(bp,'EU_M6_DataFabrico'),'date')+
    input('eu_m7','M.7 — Número de série ou lote',auto(bp,'EU_M7_SerieLote',bp.IDLote||''))+
    input('eu_m10','M.10 — Código QR / URL do Passaporte Digital',auto(bp,'EU_M10_QR',bp.URLPassaporteWeb||''), 'url', true))}
  ${section('Prevenção e gestão de resíduos','Tabela 6 · a–f',
    area('eu_w_a','a — Prevenção de resíduos',auto(bp,'EU_W_A_Prevencao'))+
    area('eu_w_b','b — Sistemas de recolha',auto(bp,'EU_W_B_Recolha'))+
    area('eu_w_c','c — Obrigações do utilizador final',auto(bp,'EU_W_C_Obrigacoes'))+
    area('eu_w_d','d — Significado dos símbolos',auto(bp,'EU_W_D_Simbolos'))+
    area('eu_w_e','e — Impactos ambientais e à saúde',auto(bp,'EU_W_E_Impactos'))+
    area('eu_w_f','f — Preparação para reutilização e reciclagem',auto(bp,'EU_W_F_Reutilizacao')))} `;
  form.insertBefore(wrap,actions);
};
const baseCollect=collectBP;
collectBP=async function(){const o=await baseCollect(); const map={
EU_A1_Fabricante:'eu_a1',EU_A2_LocalFabrico:'eu_a2',EU_A3_Modelo:'eu_a3',EU_A4_Categoria:'eu_a4',EU_A5_Subcategoria:'eu_a5',EU_A6_Tipo:'eu_a6',EU_A7_CodigoUnico:'eu_a7',EU_A8_AnoMercado:'eu_a8',EU_A9_PesoKg:'eu_a9',EU_A10_Estado:'eu_a10',EU_A11_Finalidade:'eu_a11',
EU_1_2_Composicao:'eu_12',EU_1_5_ConteudoReciclado:'eu_15',EU_1_6_ConteudoRenovavel:'eu_16',EU_1_7_CapacidadeAh:'eu_17',EU_1_8_TensaoMin:'eu_18min',EU_1_8_TensaoNom:'eu_18nom',EU_1_8_TensaoMax:'eu_18max',EU_1_8_Temperatura:'eu_18temp',EU_1_9_PotenciaW:'eu_19',EU_1_9_Limites:'eu_19lim',EU_1_10_Ciclos:'eu_110',EU_1_10_Ensaio:'eu_110ens',EU_1_11_LimiteEsgotamento:'eu_111',EU_1_12_TempForaUso:'eu_112',EU_1_12_Ensaio:'eu_112ens',EU_1_14_EficienciaInicial:'eu_114ini',EU_1_14_Eficiencia50:'eu_11450',EU_1_15_RICelulas:'eu_115cel',EU_1_15_RIPack:'eu_115pack',EU_1_16_CRate:'eu_116',
EU_C1_PegadaCarbono:'eu_c1',EU_C2_UnidadeFuncional:'eu_c2',EU_C3_Categoria:'eu_c3',EU_C4_Metodologia:'eu_c4',EU_C5_LimitesSistema:'eu_c5',EU_C6_Fases:'eu_c6',EU_C7_Contribuicao:'eu_c7',EU_C8_LocalProducao:'eu_c8',EU_C9_AnoReferencia:'eu_c9',EU_C10_Verificacao:'eu_c10',EU_C11_Verificador:'eu_c11',
EU_2_1_ComposicaoDetalhada:'eu_21',EU_2_2_PecasFontes:'eu_22',EU_2_3_Desmontagem:'eu_23',EU_2_4_Seguranca:'eu_24',EU_4_1_DadosIndividuais:'eu_41',
EU_M1_Fabricante:'eu_m1',EU_M2_Tipo:'eu_m2',EU_M3_Modelo:'eu_m3',EU_M4_Capacidade:'eu_m4',EU_M5_Tensao:'eu_m5',EU_M6_DataFabrico:'eu_m6',EU_M7_SerieLote:'eu_m7',EU_M10_QR:'eu_m10',
EU_W_A_Prevencao:'eu_w_a',EU_W_B_Recolha:'eu_w_b',EU_W_C_Obrigacoes:'eu_w_c',EU_W_D_Simbolos:'eu_w_d',EU_W_E_Impactos:'eu_w_e',EU_W_F_Reutilizacao:'eu_w_f'};
Object.entries(map).forEach(([k,id])=>{if(g(id))o[k]=g(id).value}); o.PassaporteEU_Versao='X-Resumo-2026'; return o;};
function rows(bp,defs){return defs.map(([c,l,k])=>({Nº:c,Informação:l,Valor:bp[k]||'—'}));}
function euTable(bp,defs){return tableHTML(rows(bp,defs),['Nº','Informação','Valor']);}
const A=[['A.1','Identificação do fabricante','EU_A1_Fabricante'],['A.2','Local de fabrico','EU_A2_LocalFabrico'],['A.3','Modelo','EU_A3_Modelo'],['A.4','Categoria','EU_A4_Categoria'],['A.5','Subcategoria','EU_A5_Subcategoria'],['A.6','Tipo / tecnologia','EU_A6_Tipo'],['A.7','Código único','EU_A7_CodigoUnico'],['A.8','Ano de colocação no mercado UE','EU_A8_AnoMercado'],['A.9','Peso (kg)','EU_A9_PesoKg'],['A.10','Estado da bateria','EU_A10_Estado'],['A.11','Finalidade de uso','EU_A11_Finalidade']];
const PERF=[['1.2','Composição material','EU_1_2_Composicao'],['1.5','Conteúdo reciclado (%)','EU_1_5_ConteudoReciclado'],['1.6','Conteúdo renovável (%)','EU_1_6_ConteudoRenovavel'],['1.7','Capacidade nominal (Ah)','EU_1_7_CapacidadeAh'],['1.8','Tensão mínima (V)','EU_1_8_TensaoMin'],['1.8','Tensão nominal (V)','EU_1_8_TensaoNom'],['1.8','Tensão máxima (V)','EU_1_8_TensaoMax'],['1.8','Intervalo de temperatura','EU_1_8_Temperatura'],['1.9','Potência original (W)','EU_1_9_PotenciaW'],['1.9','Limites de potência','EU_1_9_Limites'],['1.10','Vida útil esperada (ciclos)','EU_1_10_Ciclos'],['1.10','Ensaio de referência','EU_1_10_Ensaio'],['1.11','Limite de capacidade para esgotamento (VE)','EU_1_11_LimiteEsgotamento'],['1.12','Temperatura fora de uso','EU_1_12_TempForaUso'],['1.12','Ensaio de referência','EU_1_12_Ensaio'],['1.14','Eficiência inicial ida e volta (%)','EU_1_14_EficienciaInicial'],['1.14','Eficiência a 50% da vida útil (%)','EU_1_14_Eficiencia50'],['1.15','Resistência interna das células','EU_1_15_RICelulas'],['1.15','Resistência interna do pack','EU_1_15_RIPack'],['1.16','Taxa C do ensaio','EU_1_16_CRate']];
const C=[['C.1','Pegada de carbono','EU_C1_PegadaCarbono'],['C.2','Unidade funcional','EU_C2_UnidadeFuncional'],['C.3','Categoria avaliada','EU_C3_Categoria'],['C.4','Metodologia de cálculo','EU_C4_Metodologia'],['C.5','Limites do sistema','EU_C5_LimitesSistema'],['C.6','Fases incluídas','EU_C6_Fases'],['C.7','Contribuição por fase/etapa','EU_C7_Contribuicao'],['C.8','Local de produção','EU_C8_LocalProducao'],['C.9','Ano/período de referência','EU_C9_AnoReferencia'],['C.10','Verificação independente','EU_C10_Verificacao'],['C.11','Verificador','EU_C11_Verificador']];
const R=[['2.1','Composição detalhada de cátodo, ânodo e eletrólito','EU_2_1_ComposicaoDetalhada'],['2.2','Peças e fontes de substituição','EU_2_2_PecasFontes'],['2.3','Informações para desmontagem','EU_2_3_Desmontagem'],['2.4','Medidas de segurança','EU_2_4_Seguranca'],['4.1','Dados específicos da bateria individual','EU_4_1_DadosIndividuais']];
const M=[['M.1','Fabricante','EU_M1_Fabricante'],['M.2','Tipo de bateria','EU_M2_Tipo'],['M.3','Modelo','EU_M3_Modelo'],['M.4','Capacidade nominal','EU_M4_Capacidade'],['M.5','Tensão nominal','EU_M5_Tensao'],['M.6','Data de fabrico','EU_M6_DataFabrico'],['M.7','Número de série ou lote','EU_M7_SerieLote'],['M.10','Código QR / URL','EU_M10_QR']];
const W=[['a','Prevenção de resíduos','EU_W_A_Prevencao'],['b','Sistemas de recolha','EU_W_B_Recolha'],['c','Obrigações do utilizador final','EU_W_C_Obrigacoes'],['d','Significado dos símbolos','EU_W_D_Simbolos'],['e','Impactos ambientais e à saúde','EU_W_E_Impactos'],['f','Preparação para reutilização e reciclagem','EU_W_F_Reutilizacao']];
bpDashboardBody=function(bp){const p=prodFor(bp),op=opPorCodigo(bp.CodOrdemProducao)||{},desc=p['Descrição']||op.DescricaoProduto||op.Produto||bp.CodProduto||'Bateria',met=typeof v4033PassportMetrics==='function'?v4033PassportMetrics(bp):{};return `<div class="dash-public passport-public eu-passport"><section class="passport-hero"><div><span class="eyebrow">EU DIGITAL BATTERY PASSPORT</span><h1>${e(desc)}</h1><p>${e(bp.CodProduto||'')} · ${e(bp.IDLote||'Lote não informado')}</p></div><div class="passport-status"><span>${e(bp.StatusPassaporte||'RASCUNHO')}</span><b>${e(bp.BatteryPassportID||'')}</b></div></section><div class="kpis passport-kpis"><div class="kpi"><b>Modelo</b><span>${e(bp.EU_A3_Modelo||'—')}</span></div><div class="kpi"><b>Capacidade nominal</b><span>${e(bp.EU_1_7_CapacidadeAh||'—')} Ah</span></div><div class="kpi"><b>Pegada de carbono</b><span>${e(bp.EU_C1_PegadaCarbono|| (met.co2PerKWh!=null?v4033MetricValue(met.co2PerKWh,' kg CO₂eq/kWh'):'—'))}</span></div><div class="kpi"><b>Conteúdo reciclado</b><span>${e(bp.EU_1_5_ConteudoReciclado||'—')}%</span></div></div><details open class="passport-section"><summary><b>Identificação da bateria</b><span class="eu-access">Acesso público</span></summary>${euTable(bp,A)}</details><details open class="passport-section"><summary><b>Composição, circularidade e desempenho</b><span class="eu-access">Acesso público</span></summary>${euTable(bp,PERF)}</details><details open class="passport-section"><summary><b>Pegada de carbono</b><span class="eu-access">Acesso público</span></summary>${euTable(bp,C)}</details><details class="passport-section"><summary><b>Marcação e QR Code</b><span class="eu-access">Acesso público</span></summary>${euTable(bp,M)}${qrCardHTML(bp,'Acesso ao Passaporte Digital')}</details><details class="passport-section"><summary><b>Prevenção e gestão de resíduos</b><span class="eu-access">Acesso público</span></summary>${euTable(bp,W)}</details><details class="passport-section eu-restricted"><summary><b>Informações técnicas restritas</b><span class="eu-access restricted">Acesso restrito</span></summary>${euTable(bp,R)}</details></div>`;};
// relatório do passaporte também recebe os mesmos campos regulatórios
const baseReport=reportBPObj;
reportBPObj=function(bp){if(bp&&typeof bp.then==='function')return bp.then(reportBPObj);if(!bp||!bp.BatteryPassportID)return baseReport(bp);const body=`<section class="passport-section"><h2>1. Identificação regulamentar</h2>${euTable(bp,A)}</section><section class="passport-section"><h2>2. Composição, circularidade e desempenho</h2>${euTable(bp,PERF)}</section><section class="passport-section"><h2>3. Pegada de carbono</h2>${euTable(bp,C)}</section><section class="passport-section"><h2>4. Marcação</h2>${euTable(bp,M)}</section><section class="passport-section"><h2>5. Prevenção e gestão de resíduos</h2>${euTable(bp,W)}</section><section class="passport-section"><h2>6. Informações de acesso restrito</h2>${euTable(bp,R)}</section>`;return passportPrintShell('Passaporte da Bateria — Campos UE',bp,body);};
try{data.meta=data.meta||{};data.meta.patchPassaporteEU=VER;saveLocal();}catch(err){console.warn('Patch Passaporte UE',err)}
})();
