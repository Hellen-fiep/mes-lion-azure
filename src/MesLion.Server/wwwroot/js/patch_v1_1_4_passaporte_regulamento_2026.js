/* MES LION V1.1.4 — Passaporte UE / Guidance Digital Batteries Passport v2.0 (15/08/2026)
   Escopo deliberadamente isolado: formulário/dashboard do Passaporte.
   Não altera funções de OP, custos, ACV/ICV, massas, cálculos ou layout operacional.
*/
(function(){
'use strict';
const VER='v1.1.4-passaporte-regulamento-2026';
const $id=id=>document.getElementById(id);
const esc=v=>htmlEscape(v??'');
const val=(o,k,d='')=>String(o?.[k]??d);

/* Data points obrigatórios/condicionais conforme Guidance v2.0, páginas 5–14. */
const REG_FIELDS=[
 ['01','Identificador único da bateria','BP_DP01_UniqueIdentifier','all',true],
 ['02','Identidade de quem regista e/ou é responsável pelo Passaporte','BP_DP02_Responsible','all',true],
 ['03','Nome / nome comercial / marca registada do fabricante','BP_DP03_ManufacturerName','all',true],
 ['04','Endereço postal do fabricante, com ponto único de contacto','BP_DP04_ManufacturerAddress','all',true],
 ['05','Endereço web e e-mail do fabricante (se disponível)','BP_DP05_ManufacturerContact','all',false],
 ['06','Categoria da bateria','BP_DP06_BatteryCategory','all',true],
 ['07','Identificação do modelo e lote/serial/número do produto','BP_DP07_ModelBatchSerial','all',true],
 ['08','Local de fabrico da bateria (localização geográfica da fábrica)','BP_DP08_ManufacturingPlace','all',true],
 ['09','Data de fabrico (mês e ano)','BP_DP09_ManufacturingDate','all',true],
 ['10','Peso','BP_DP10_Weight','all',true],
 ['11','Capacidade','BP_DP11_Capacity','all',true],
 ['12','Química','BP_DP12_Chemistry','all',true],
 ['13','Substâncias perigosas presentes, exceto mercúrio, cádmio e chumbo','BP_DP13_HazardousSubstances','all',true],
 ['14','Agente extintor utilizável','BP_DP14_ExtinguishingAgent','all',true],
 ['15','Matérias-primas críticas presentes acima de 0,1 % m/m','BP_DP15_CriticalRawMaterials','all',true],
 ['24','Percentual de conteúdo renovável','BP_DP24_RenewableContent','all',true],
 ['26','Tensão mínima, com faixa de temperatura quando aplicável','BP_DP26_MinVoltage','all',true],
 ['27','Tensão nominal, com faixa de temperatura quando aplicável','BP_DP27_NominalVoltage','all',true],
 ['28','Tensão máxima, com faixa de temperatura quando aplicável','BP_DP28_MaxVoltage','all',true],
 ['29','Capacidade de potência original (W)','BP_DP29_OriginalPower','all',true],
 ['30','Limites de potência, com faixa de temperatura quando aplicável','BP_DP30_PowerLimits','all',true],
 ['31','Vida útil esperada, expressa em ciclos','BP_DP31_ExpectedLifeCycles','all',true,'EV|LMT|INDUSTRIAL'],
 ['32','Ensaio de referência da vida útil em ciclos','BP_DP32_LifetimeReferenceTest','all',true,'EV|LMT|INDUSTRIAL'],
 ['33','Limite de capacidade para esgotamento','BP_DP33_CapacityExhaustionThreshold','EV',true],
 ['34','Faixa de temperatura que a bateria suporta quando não está em uso (ensaio de referência)','BP_DP34_StorageTemperatureRange','all',true],
 ['35','Período de garantia comercial para a vida em calendário','BP_DP35_CommercialWarranty','all',false],
 ['36','Eficiência energética inicial ida e volta','BP_DP36_InitialRoundTripEfficiency','all',true,'EV|LMT'],
 ['37','Eficiência energética ida e volta a 50 % da vida útil','BP_DP37_RoundTripEfficiency50','all',true,'EV|LMT'],
 ['38','Resistência interna da célula e do pack','BP_DP38_InternalResistance','all',true],
 ['39','Taxa C do ensaio de vida útil relevante','BP_DP39_CRate','all',true,'EV|LMT'],
 ['40','Requisitos de marcação do Artigo 13(4)','BP_DP40_MarkingArticle134','all',true],
 ['41','Requisitos de marcação do Artigo 13(5), incluindo símbolo Cd/Pb quando aplicável','BP_DP41_MarkingArticle135','all',true],
 ['42','Declaração UE de conformidade referida no Artigo 18','BP_DP42_EUDeclarationConformity','all',true],
 ['43','Informações sobre prevenção e gestão de resíduos de baterias','BP_DP43_WasteBatteryInformation','all',true],
 ['45','Composição detalhada, incluindo materiais do cátodo, ânodo e eletrólito','BP_DP45_DetailedComposition','all',true],
 ['46','Números de peça dos componentes','BP_DP46_ComponentPartNumbers','all',true],
 ['47','Contactos das fontes de peças sobressalentes','BP_DP47_SparePartsSources','all',true],
 ['48','Informações de desmontagem','BP_DP48_DismantlingInformation','all',true],
 ['49','Medidas de segurança','BP_DP49_SafetyMeasures','all',true],
 ['50','Resultados dos relatórios de ensaio que comprovam a conformidade','BP_DP50_TestReports','all',true],
 ['51','Capacidade nominal dinâmica (Ah)','BP_DP51_DynamicRatedCapacity','all',true,'EV|LMT'],
 ['52','Perda de capacidade (%)','BP_DP52_CapacityFade','all',false],
 ['53','Potência (W) dinâmica','BP_DP53_DynamicPower','all',true,'EV|LMT'],
 ['54','Perda de potência (%)','BP_DP54_PowerFade','all',true,'EV|LMT'],
 ['55','Resistência interna (Ω) dinâmica','BP_DP55_DynamicInternalResistance','all',true,'EV|LMT'],
 ['56','Aumento da resistência interna (%)','BP_DP56_InternalResistanceIncrease','all',true,'EV|LMT'],
 ['57','Eficiência energética ida e volta, quando aplicável','BP_DP57_DynamicRoundTripEfficiency','all',false],
 ['58','Perda da eficiência energética ida e volta, quando aplicável','BP_DP58_RoundTripEfficiencyFade','all',false],
 ['59','Vida útil esperada nas condições de referência, em ciclos','BP_DP59_ExpectedLifetimeCycles','all',true,'EV|LMT'],
 ['60','Vida útil esperada nas condições de referência, em anos-calendário','BP_DP60_ExpectedLifetimeCalendarYears','all',true,'EV|LMT'],
 ['61','Estado de saúde: estado de energia certificado (SOCE)','BP_DP61_SOCE','EV',true],
 ['62','Estado de saúde: capacidade remanescente','BP_DP62_RemainingCapacity','LMT|INDUSTRIAL',true],
 ['63','Estado de saúde: capacidade de potência remanescente, quando possível','BP_DP63_RemainingPower','LMT|INDUSTRIAL',false],
 ['64','Estado de saúde: eficiência ida e volta remanescente, quando possível','BP_DP64_RemainingRoundTripEfficiency','LMT|INDUSTRIAL',false],
 ['65','Estado de saúde: evolução da taxa de autodescarga, quando aplicável','BP_DP65_SelfDischargeEvolution','LMT|INDUSTRIAL',false],
 ['66','Estado de saúde: resistência ôhmica, quando possível','BP_DP66_OhmicResistance','LMT|INDUSTRIAL',false],
 ['67','Estado da bateria: original, repurposed, re-used, remanufactured ou waste','BP_DP67_BatteryStatus','all',true],
 ['68','Número de ciclos de carga e descarga','BP_DP68_ChargeDischargeCycles','all',false],
 ['69','Eventos negativos, como acidentes','BP_DP69_NegativeEvents','all',false],
 ['70','Condições ambientais de operação registadas periodicamente, incluindo temperatura','BP_DP70_OperatingEnvironmentalConditions','all',false],
 ['71','Estado de carga registado periodicamente','BP_DP71_PeriodicStateOfCharge','all',false]
];

const REG_BY_ID=Object.fromEntries(REG_FIELDS.map(x=>[x[0],x]));
function regCategory(bp){
  const s=String(bp?.BP_DP06_BatteryCategory||bp?.EU_A4_Categoria||bp?.Categoria||'').toUpperCase();
  if(s.includes('EV')||s.includes('ELÉTRICO')||s.includes('ELECTRIC VEHICLE')) return 'EV';
  if(s.includes('LMT')) return 'LMT';
  return 'INDUSTRIAL';
}
function regApplicable(bp){const cat=regCategory(bp);return REG_FIELDS.filter(f=>f[3]==='all'||f[3].split('|').includes(cat));}
function isRegRequired(f,bp){const cat=regCategory(bp);return !!f[4] && (!f[5] || f[5].split('|').includes(cat));}
function regRequired(bp){return regApplicable(bp).filter(f=>isRegRequired(f,bp));}
function regInput(id,label,value,type='text',required=false){return `<label class="wide reg-field"><span>${esc(label)}${required?' *':''}</span><input id="${id}" type="${type}" value="${esc(value)}" ${required?'required':''}></label>`;}
function regText(id,label,value,required=false){return `<label class="wide reg-field"><span>${esc(label)}${required?' *':''}</span><textarea id="${id}" ${required?'required':''}>${esc(value)}</textarea></label>`;}
function regFieldHTML(bp,f){
  const [n,label,key]=f; const v=val(bp,key);
  const long=['04','05','13','15','30','32','40','41','42','43','45','46','47','48','49','50','69','70','71'].includes(n);
  const req=isRegRequired(f,bp); return long?regText(key,label,v,req):regInput(key,label,v,'text',req);
}
function regSectionsHTML(bp){
  const fields=regApplicable(bp); const ids={ident:['01','02','03','04','05','06','07','08','09','10'],composition:['11','12','13','14','15','24'],performance:['26','27','28','29','30','31','32','33','34','35','36','37','38','39'],compliance:['40','41','42','43'],engineering:['45','46','47','48','49','50'],dynamic:['51','52','53','54','55','56','57','58','59','60','61','62','63','64','65','66','67','68','69','70','71']};
  const mk=(title,list)=>{const fs=list.map(n=>REG_BY_ID[n]).filter(f=>fields.includes(f));return fs.length?`<details class="bp-reg-section" open><summary><b>${esc(title)}</b><span>Guia UE · 2026</span></summary><div class="form-grid">${fs.map(f=>regFieldHTML(bp,f)).join('')}</div></details>`:''};
  return mk('1 · Identificação e rastreabilidade',ids.ident)+mk('2 · Composição e circularidade',ids.composition)+mk('3 · Desempenho e vida útil',ids.performance)+mk('4 · Marcação, conformidade e resíduos',ids.compliance)+mk('5 · Composição detalhada, desmontagem e segurança',ids.engineering)+mk('6 · Dados dinâmicos e estado da bateria',ids.dynamic);
}
function inferRegDefaults(bp){
  const p=produtoPorCodigo(bp?.CodProduto)||{}, op=opPorCodigo(bp?.CodOrdemProducao)||{};
  const existing={...bp};
  const set=(k,v)=>{if(String(existing[k]||'').trim()===''&&String(v??'').trim()!=='')existing[k]=String(v)};
  set('BP_DP01_UniqueIdentifier',bp?.BatteryPassportID||bp?.BatteryPassportGUID);
  set('BP_DP02_Responsible',bp?.UsuarioCriacao||'');
  set('BP_DP03_ManufacturerName',bp?.FornecedorNomeSnapshot||'');
  set('BP_DP06_BatteryCategory','Industrial');
  set('BP_DP07_ModelBatchSerial',bp?.IDLote||p['Modelo']||bp?.BatteryPassportID||'');
  set('BP_DP09_ManufacturingDate',bp?.DataCriacao||'');
  set('BP_DP10_Weight',p['Peso (kg)']||p['Massa (kg)']||'');
  set('BP_DP11_Capacity',p['Capacidade Final (Ah)']||p['Capacidade (Ah)']||'');
  set('BP_DP12_Chemistry',p['Composição']||p['Química']||p['Célula']||'');
  set('BP_DP24_RenewableContent',bp?.EU_1_6_ConteudoRenovavel||'');
  set('BP_DP27_NominalVoltage',p['Tensão Nominal (V)']||'');
  set('BP_DP67_BatteryStatus','original');
  return existing;
}

/* Formulário: mantém o formulário validado e injeta apenas o novo bloco regulatório.
   Os campos textuais legados continuam armazenados para retrocompatibilidade, mas não são usados no dashboard do cliente. */
const _openBPFormReg=openBPForm;
openBPForm=function(idx=-1){
  const r=_openBPFormReg(idx);
  const bp=inferRegDefaults(idx>=0?(data.bp?.[idx]||{}):{});
  const form=$id('crudBox')?.querySelector('.form');
  const actions=form?.querySelector('.form-actions');
  if(!form||!actions)return r;
  const old=$id('bp_regulatory_fields'); if(old)old.remove();
  const wrap=document.createElement('div');wrap.id='bp_regulatory_fields';wrap.className='bp-regulatory-wrap';
  wrap.innerHTML=`<div class="bp-regulatory-head"><div><h3>Campos regulatórios — Batteries Passport Guidance v2.0</h3><p>Campos conforme a versão 2.0 de 15/08/2026. <b>*</b> = obrigatório para a categoria selecionada. Campos condicionais aparecem conforme a categoria.</p></div><span>v2.0 · 2026</span></div>${regSectionsHTML(bp)}`;
  form.insertBefore(wrap,actions);
  /* Evita duplicação visual dos antigos campos textuais no cadastro, sem apagar os dados legados. */
  ['bp_cf','bp_dd','bp_rec','bp_ren','bp_vida','bp_temp','bp_rte','bp_res','bp_ue','bp_descartadas','bp_desm','bp_seg','bp_ind_info','bp_ind_perf','bp_ind_status','bp_ind_uso'].forEach(id=>{const el=$id(id);if(el?.closest('label'))el.closest('label').classList.add('bp-legacy-text-field');});
  return r;
};

const _collectBPReg=collectBP;
collectBP=async function(){
  const o=await _collectBPReg();
  regApplicable(o).forEach(f=>{const el=$id(f[2]);if(el)o[f[2]]=el.value});
  o.PassaporteEU_Versao='Guidance-v2.0-15-08-2026';
  return o;
};

/* Validação somente dos campos regulamentares marcados como obrigatórios; OP/layout/cálculos não são tocados. */
const _saveBPReg=saveBP;
saveBP=async function(idx){
  const bpCurrent=idx>=0?(data.bp?.[idx]||{}):{};
  const candidate=inferRegDefaults(bpCurrent);
  const fields=regRequired(candidate);
  const missing=[];
  fields.forEach(f=>{const el=$id(f[2]);const v=el?el.value:candidate[f[2]];if(!String(v??'').trim())missing.push(f[0]+' — '+f[1])});
  if(missing.length){alert('O Passaporte não pode ser salvo como completo enquanto houver campos regulatórios obrigatórios vazios.\n\nPreencha:\n• '+missing.join('\n• '));return;}
  return _saveBPReg(idx);
};

/* Remove do módulo o relatório geral/“dados do BP” que não faz parte do Passaporte operacional. */
const _bpModuleReg=bpModule;
bpModule=function(){
  const r=_bpModuleReg();
  const tb=document.querySelector('#content .toolbar');
  if(tb){[...tb.querySelectorAll('button')].forEach(b=>{if(/Relatório (de dados BP|geral BP|geral)/i.test(b.textContent||''))b.remove();});}
  return r;
};

function acvForPassport(bp){
  const root=typeof v4034RootPAForBP==='function'?v4034RootPAForBP(bp):bp?.CodOrdemProducao;
  return (data.sust_op||[]).find(x=>(x.CodOPMae||x.CodOP)===root) || (data.sust_op||[]).find(x=>String(x.OPsRelacionadas||'').split(/;\s*/).includes(bp?.CodOrdemProducao));
}
function acvAuditRows(row){
  if(!row?.AuditoriaCO2JSON)return [];
  try{const a=JSON.parse(row.AuditoriaCO2JSON);return Array.isArray(a)?a:[]}catch(e){return []}
}
function acvCompleteHTML(bp,client=false){
  const r=acvForPassport(bp);
  if(!r)return '<p class="muted">Não há cálculo ACV consolidado vinculado à OP deste passaporte.</p>';
  const baseFields=['CodOPMae','ProdutoPA','DescricaoProduto','DataCalculo','Cenario','Metodo','OPsRelacionadas','MassaProduto','UnidadeProduto','MassaMateriaisKg','MassaPerdas','MassaPerdasMateriaisKg','EnergiaKWh','EnergiaTotal','Agua','RecursosMinerais','Acidificacao','Eutrofizacao','MaterialParticulado','OzonioFotoquimico','ToxicidadeHumana','Ecotoxicidade','HotspotPrincipal','FatorEnergiaUsado','MateriaisSemFatorKg'];
  const climate=['CO2eqTotal','CO2eqMateriais','CO2eqProduto','CO2eqPerdas','CO2eqEnergia','MateriaisSemFatorCO2'];
  const keys=client?baseFields:baseFields.concat(climate);
  const rows=keys.filter(k=>r[k]!==undefined&&r[k]!=='').map(k=>({Campo:fieldLabel(k)||k,Valor:displayValue(k,r[k])}));
  const audit=acvAuditRows(r);
  const auditRows=client?audit.map(x=>({Tipo:x.Tipo||'',OP:x.OP||'',Etapa:x.Etapa||'',CodigoMaterial:x.CodigoMaterial||'',Material:x.Material||'',Lote:x.Lote||'',Quantidade:x.Quantidade||'',UM:x.UM||'',MassaKg:x.MassaKg||'',Formula:'Dados do inventário ambiental'})):audit;
  return `<details class="passport-section passport-toggle" ${client?'':'open'}><summary><b>Dados completos de ACV</b><span>Inventário e indicadores ambientais</span></summary><div class="passport-detail-body">${tableHTML(rows,['Campo','Valor'])}${auditRows.length?`<h3>Rastreabilidade do inventário ambiental</h3>${tableHTML(auditRows,Object.keys(auditRows[0]))}`:''}</div></details>`;
}

function regulatoryClientSections(bp){
  const fields=regApplicable(bp);
  const groups=[
    ['Identificação e rastreabilidade',['01','02','03','04','05','06','07','08','09','10']],
    ['Composição e circularidade',['11','12','13','14','15','24','45','46','47']],
    ['Desempenho e vida útil',['26','27','28','29','30','31','32','33','34','35','36','37','38','39','51','52','53','54','55','56','57','58','59','60']],
    ['Conformidade, segurança e fim de vida',['40','41','42','43','48','49','50','67','68','69','70','71']],
    ['Estado de saúde',['61','62','63','64','65','66']]
  ];
  return groups.map(([title,ids])=>{const fs=ids.map(n=>REG_BY_ID[n]).filter(f=>f&&fields.includes(f));if(!fs.length)return '';return `<details class="passport-section passport-toggle" open><summary><b>${esc(title)}</b><span>Dados regulatórios</span></summary><div class="passport-detail-body">${tableHTML(fs.map(f=>({DataPoint:f[0],Informacao:f[1],Valor:bp[f[2]]||'—'})),['DataPoint','Informacao','Valor'])}</div></details>`}).join('');
}

/* Dashboard cliente: mantém massas, relação/códigos, desempenho e imagens; substitui os textos genéricos pelos data points regulatórios. */
bpDashboardBody=function(bp){
  const view=inferRegDefaults({...bp});
  const prod=produtoPorCodigo(view.CodProduto)||{},op=opPorCodigo(view.CodOrdemProducao)||{},mats=bpPublicMaterialRowsV401(view),filhos=(data.estrutura||[]).filter(p=>p['Código Pai']==view.CodProduto),descricao=prod['Descrição']||op.DescricaoProduto||op.Produto||'',line=v403PILineageRowsForBP(view),mass=v4041ProcessMassRows(view);
  return `<div class="dash-public passport-public">
    <section class="passport-hero"><div><span class="eyebrow">DIGITAL BATTERY PASSPORT</span><h1>${esc(descricao||view.CodProduto||'Bateria')}</h1><p>${esc(view.CodProduto||'')} · ${esc(view.IDLote||'Lote da bateria não informado')}</p></div><div class="passport-status"><span>${esc(view.StatusPassaporte||'RASCUNHO')}</span><b>${esc(view.BatteryPassportID||'')}</b></div></section>
    <div class="kpis passport-kpis"><div class="kpi"><b>Produto</b><span>${esc(view.CodProduto||'-')}</span></div><div class="kpi"><b>OP de origem</b><span>${esc(view.CodOrdemProducao||'-')}</span></div><div class="kpi"><b>Capacidade</b><span>${esc(view.BP_DP11_Capacity||'-')}</span></div><div class="kpi"><b>Tensão nominal</b><span>${esc(view.BP_DP27_NominalVoltage||'-')}</span></div></div>
    <section class="passport-section"><h2>Composição mássica da célula completa</h2>${v4043PublicPieFromData(mass)}</section>
    <details class="passport-section passport-toggle"><summary><b>Detalhamento percentual da composição mássica</b><span>expandir/recolher</span></summary><div class="passport-detail-body">${v4043MassAuditHTML(mass)}</div></details>
    <details open class="passport-section passport-toggle"><summary><b>Materiais, lotes, fornecedores e códigos</b><span>rastreabilidade</span></summary><div class="passport-detail-body">${tableHTML(mats,['OP','Etapa','CodigoMaterial','Material','Quantidade','UM','Lote','Fornecedor','NotaFiscal'])}${line.length?`<h3>Lotes de produtos intermediários</h3>${tableHTML(line,['PI','Descrição','LotePI','OPOrigem','Quantidade','UM','DataProdução'])}`:''}</div></details>
    ${regulatoryClientSections(view)}
    ${acvCompleteHTML(view,true)}
    <details open class="passport-section passport-toggle"><summary><b>Dados técnicos e desempenho</b><span>dados de produto</span></summary><div class="passport-detail-body">${kvHTML({...prod,...view},['Célula','Composição','Modelo','Capacidade Final (Ah)','Tensão Nominal (V)','Energia (Wh)','Dimensão Case'])}</div></details>
    <details class="passport-section passport-toggle"><summary><b>Qualificação da bateria e imagens</b><span>testes</span></summary><div class="passport-detail-body"><div class="bp-img-grid">${imageBlock('Imagem da bateria',view.ImagemBateria)}${imageBlock('Teste de ciclos',view.ImagemTesteCiclos)}${imageBlock('Teste de impedância',view.ImagemImpedancia||view.Tec_ResistenciaInterna_ImagemPath)}${imageBlock('Teste de aging',view.ImagemAging)}</div></div></details>
    <section class="passport-section"><h2>Estrutura PA → PI</h2>${tableHTML(filhos,['Código','Descrição','Tipo Produto','Código Pai','Composição','Modelo'])}</section>
  </div>`;
};

/* Relatório interno mantém ACV completa, incluindo indicadores climáticos; não altera nenhum cálculo. */
const _reportBPReg=reportBPObj;
reportBPObj=function(bp){
  if(bp&&typeof bp.then==='function')return bp.then(reportBPObj);
  if(!bp?.BatteryPassportID)return _reportBPReg(bp);
  const view=inferRegDefaults({...bp});
  const prod=produtoPorCodigo(view.CodProduto)||{},op=opPorCodigo(view.CodOrdemProducao)||{},mats=bpPublicMaterialRowsV401(view),filhos=(data.estrutura||[]).filter(p=>p['Código Pai']==view.CodProduto),mass=v4041ProcessMassRows(view),line=v403PILineageRowsForBP(view),desc=prod['Descrição']||op.DescricaoProduto||op.Produto||'';
  const body=`<section class="passport-section"><h2>Campos regulatórios — Guidance v2.0</h2>${tableHTML(regApplicable(view).map(f=>({DataPoint:f[0],Informacao:f[1],Obrigatorio:isRegRequired(f,view)?'Sim':'Não / condicional',Valor:view[f[2]]||'—'})),['DataPoint','Informacao','Obrigatorio','Valor'])}</section><section class="passport-section"><h2>Composição mássica</h2>${v4043PublicPieFromData(mass)}${v4043MassAuditHTML(mass)}</section><section class="passport-section"><h2>Materiais, lotes e fornecedores</h2>${tableHTML(mats,['OP','Etapa','CodigoMaterial','Material','Quantidade','UM','Lote','Fornecedor','NotaFiscal'])}</section>${acvCompleteHTML(view,false)}<section class="passport-section"><h2>Dados técnicos e desempenho</h2>${kvHTML({...prod,...view},['Célula','Composição','Modelo','Capacidade Final (Ah)','Tensão Nominal (V)','Energia (Wh)','Dimensão Case'])}</section><section class="passport-section"><h2>Qualificação e imagens</h2><div class="bp-img-grid">${imageBlock('Imagem da bateria',view.ImagemBateria)}${imageBlock('Teste de ciclos',view.ImagemTesteCiclos)}${imageBlock('Teste de impedância',view.ImagemImpedancia||view.Tec_ResistenciaInterna_ImagemPath)}${imageBlock('Teste de aging',view.ImagemAging)}</div></section><section class="passport-section"><h2>Estrutura PA → PI</h2>${tableHTML(filhos,['Código','Descrição','Tipo Produto','Código Pai','Composição','Modelo'])}</section>`;
  return passportPrintShell('Passaporte da Bateria',view,body);
};

/* Remove qualquer rótulo legado de “Dado público/Acesso público” apenas do passaporte. */
try{document.head.insertAdjacentHTML('beforeend',`<style id="bp-reg-v114-css">.bp-regulatory-wrap{margin-top:14px}.bp-regulatory-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:#eef5fa;border:1px solid #d7e4ed;border-left:4px solid #004b87;border-radius:10px;padding:12px 14px;margin-bottom:10px}.bp-regulatory-head h3{margin:0 0 5px}.bp-regulatory-head p{margin:0;color:#5e7180;font-size:12px}.bp-regulatory-head>span{background:#004b87;color:#fff;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:800;white-space:nowrap}.bp-reg-section{border:1px solid #dce6ed;border-radius:10px;background:#fff;margin:9px 0;overflow:hidden}.bp-reg-section>summary{cursor:pointer;list-style:none;padding:10px 12px;background:#f7fafc;color:#004b87;display:flex;justify-content:space-between}.bp-reg-section>summary::-webkit-details-marker{display:none}.bp-reg-section>summary span{font-size:10px;color:#6c7d89;font-weight:normal}.bp-reg-section .form-grid{padding:10px 12px}.bp-reg-section .reg-field span{line-height:1.25}.bp-legacy-text-field{display:none!important}.eu-access{display:none!important}.eu-passport .eu-access{display:none!important}.passport-public .passport-section .eu-access{display:none!important}@media(max-width:760px){.bp-regulatory-head{display:block}.bp-regulatory-head>span{display:inline-block;margin-top:8px}}`);}
catch(e){}

try{data.meta=data.meta||{};data.meta.patchPassaporteRegulamento2026=VER;data.meta.passaporteGuidance='Digital Batteries Passport Guidance Document v2.0 — 15 August 2026';}catch(e){}
})();
