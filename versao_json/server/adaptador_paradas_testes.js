/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR 1.7.0: PARADAS DE MÁQUINA E TESTES DAS CÉLULAS
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html, depois de
   adaptador_helpdesk_assistente.js e antes de adaptador_paineis.js. Não altera os arquivos do frontend.
     1) Paradas de máquina (data.paradas): equipamento, OP (opcional), motivo do cadastro de motivos de parada
        (data.paradas_motivos: categoria, motivo e se é planejada), planejada sim/não, início, fim e duração.
        Registro por intervalo informado ou "iniciar agora / encerrar agora"; uma parada aberta por equipamento e
        paradas do mesmo equipamento sem sobreposição. Tela Produção › Paradas de máquina (lista, filtros e
        minutos por motivo) e quadro "Paradas" no Apontamento de Produção, junto do tempo por máquina.
        É a base da Disponibilidade do OEE: tempo em operação = tempo apontado na máquina − paradas dentro dele;
        tempo planejado = tempo em operação + paradas não planejadas.
     2) Testes das células (data.testes_celulas): energia de descarga (Wh) e capacidade (Ah) MEDIDAS no teste de
        formação, capacidade ou ciclagem, por célula (etiqueta) da OP de PA. Quadro no Apontamento de Produção da
        OP de PA e tela Produção › Testes das células. A energia medida de cada célula é a do teste mais recente
        com energia informada. É a base do "kWh gerado" dos painéis e dos campos medidos do passaporte.
   ===================================================================== */
(function () {
  'use strict';
  if (window.MES_ADAPTADOR_PARADAS_TESTES) return;
  var VERSAO = '1.7.0';

  /* ---------------------------------------------------------------------
     0) UTILITÁRIOS
     --------------------------------------------------------------------- */
  function A(v) { return Array.isArray(v) ? v : []; }
  function D() { return (typeof data === 'object' && data) ? data : null; }
  function N(v) {
    if (typeof num === 'function') return num(v);
    var n = Number(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  /* número digitado: aceita vírgula; '' = vazio; NaN = inválido */
  function numDigitado(v) {
    var s = String(v == null ? '' : v).trim();
    if (s === '') return '';
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
    return Number(s);
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function jsStr(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '); }
  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? String(e.value == null ? '' : e.value) : ''; }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function norm(v) { return txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function arred(v, c) { var f = Math.pow(10, c == null ? 6 : c); return Math.round((Number(v) || 0) * f) / f; }
  function fmt(v, c) { var n = typeof v === 'number' ? v : N(v); return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: c == null ? 2 : c }); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function hoje() { return new Date().toLocaleDateString('pt-BR'); }
  function agora() { return new Date().toLocaleString('pt-BR'); }
  function horaAgora() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function dataBR(d) { return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function horaHM(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function usuario() { try { return (window.MES_CURRENT_USER && (MES_CURRENT_USER.username || MES_CURRENT_USER.fullName)) || 'admin'; } catch (e) { return 'admin'; } }
  function idNovo(p) { return p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  function parseDataHora(d, h) {
    var s = txt(d), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/), y, mo, dd;
    if (m) { dd = +m[1]; mo = +m[2]; y = +m[3]; }
    else { m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return null; y = +m[1]; mo = +m[2]; dd = +m[3]; }
    var hh = 0, mi = 0;
    if (h !== undefined) {
      var t = txt(h).match(/^(\d{1,2}):(\d{2})$/);
      if (!t) return null;
      hh = +t[1]; mi = +t[2];
      if (hh > 23 || mi > 59) return null;
    }
    var r = new Date(y, mo - 1, dd, hh, mi, 0, 0);
    if (r.getFullYear() !== y || r.getMonth() !== mo - 1 || r.getDate() !== dd) return null;
    return r;
  }
  function salvar() { try { if (typeof saveLocal === 'function') saveLocal(); } catch (e) { console.warn('MES LION 1.7: gravação', e); } }
  function setCurrent(k) { try { current = k; } catch (e) { } }
  function marcarNav(k) {
    try {
      document.body.classList.remove('dashboard-mode');
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      var b = el('nav_' + k); if (b) b.classList.add('active');
    } catch (e) { }
  }
  function cabecalho(t, s) { if (el('title')) el('title').textContent = t; if (el('subtitle')) el('subtitle').textContent = s || ''; }
  function aviso(id, msg, tipo) { var b = el(id); if (!b) return; b.className = 'mpt-msg ' + (tipo || 'ok'); b.innerHTML = msg; }
  function tag(s, cls) { return '<span class="mpt-tag ' + (cls || '') + '">' + esc(s) + '</span>'; }
  function tabela(cols, linhas, vazio) {
    return '<div class="table-wrap"><table><thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (linhas.length ? linhas.join('') : '<tr><td colspan="' + cols.length + '" class="muted">' + esc(vazio || 'Nenhum registro.') + '</td></tr>') + '</tbody></table></div>';
  }
  function estilo() {
    if (el('mpt-estilo')) return;
    var st = document.createElement('style'); st.id = 'mpt-estilo';
    st.textContent = [
      '.mpt-card{background:#fff;border:1px solid #dbe5ec;border-radius:12px;padding:14px 16px;margin:0 0 14px}',
      '.mpt-card h3{margin:0 0 6px;color:#004b87;font-size:15px}.mpt-card h4{margin:12px 0 6px;color:#0b3a5c;font-size:13px}',
      '.mpt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 8px}',
      '.mpt-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;margin:0}.mpt-grid label>span{font-weight:700;color:#355566;font-size:11px}',
      '.mpt-grid input,.mpt-grid select,.mpt-grid textarea{padding:7px 8px;border:1px solid #c9d6e0;border-radius:7px;font-size:13px;min-width:0}',
      '.mpt-grid .wide{grid-column:span 2}',
      '.mpt-actions{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 8px}',
      '.mpt-msg{font-size:12.5px;margin:4px 0}.mpt-msg:empty{display:none}.mpt-msg.ok{color:#245d0d}.mpt-msg.erro{color:#a00e1c;font-weight:700}.mpt-msg.alerta{color:#8a5a00}',
      '.mpt-tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#eef3f7;color:#0b3a5c;white-space:nowrap}',
      '.mpt-tag.ok{background:#e3f3d8;color:#245d0d}.mpt-tag.erro{background:#fde4e6;color:#a00e1c}.mpt-tag.alerta{background:#fff1d1;color:#7a5000}.mpt-tag.info{background:#e3eefa;color:#0b4a8a}',
      '.mpt-num{text-align:right;white-space:nowrap}',
      '.mpt-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 12px}',
      '.mpt-kpis div{background:#f7fafc;border:1px solid #dbe5ec;border-radius:10px;padding:9px 12px}.mpt-kpis small{display:block;color:#5b7385;font-size:11px}.mpt-kpis b{font-size:18px;color:#0b3a5c}',
      '.mpt-barra{height:10px;background:#e7eef4;border-radius:6px;overflow:hidden;min-width:120px}.mpt-barra i{display:block;height:100%;background:#d0621b}',
      '.mpt-tabs{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap}',
      '.mpt-teste input{width:100%;min-width:70px;padding:5px 6px;border:1px solid #c9d6e0;border-radius:6px;font-size:12.5px;text-align:right}',
      '@media (max-width:760px){.mpt-grid .wide{grid-column:auto}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------------
     1) DADOS
     --------------------------------------------------------------------- */
  var COLECOES = ['paradas', 'paradas_motivos', 'testes_celulas'];
  function garantir() { var d = D(); if (!d) return; COLECOES.forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; }); }
  var CATEGORIAS = [['Manutenção corretiva', 'Não'], ['Manutenção preventiva', 'Sim'], ['Setup / troca de produto', 'Não'], ['Falta de material', 'Não'], ['Falta de operador', 'Não'],
    ['Qualidade / retrabalho', 'Não'], ['Utilidades (energia, ar, água, vácuo)', 'Não'], ['Limpeza', 'Não'], ['Sem programação', 'Sim'], ['Teste / ensaio', 'Não'], ['Outros', 'Não']];
  function api14() { return window.mesApontamentoPI14 || null; }
  function opPor(cod) { var k = txt(cod); return A((D() || {}).op).find(function (o) { return o && txt(o.CodOP) === k; }) || null; }
  function opAberta(op) { return !!op && !/conclu|encerr|finaliz|cancel|exclu|anulad/i.test(String(op.Status || '')) && !op.DataEncerramento; }
  function tipoOP(op) { var t = String(op && op.TipoOP || '').toUpperCase(); if (t === 'PI' || t === 'PA') return t; return /^PI/i.test(txt(op && (op.CodigoPI || op.CodigoProduto))) ? 'PI' : 'PA'; }
  function produtoDe(cod) { var k = txt(cod); return A((D() || {}).estrutura).find(function (p) { return p && txt(p['Código']) === k; }) || {}; }
  function codProdutoOP(op) { return txt(op && (op.CodigoPA || op.CodigoProduto || op.ProdutoGerado || op.Produto)); }

  /* equipamentos: código + nome (o mesmo código pode estar em equipamentos diferentes; a chave é o par) */
  function chaveEquip(cod, nome) { return txt(cod) + '|' + norm(nome); }
  function equipamentos() {
    var d = D() || {}, por = {}, out = [];
    A(d.recursos).concat(A(d.cad_recursos)).forEach(function (r) {
      if (!r) return;
      var c = txt(r.CodEquipamento || r['Código Equipamento']), n = txt(r.Equipamento); if (!c && !n) return;
      var k = chaveEquip(c, n); if (por[k]) return;
      por[k] = { chave: k, CodEquipamento: c, Equipamento: n, Processo: txt(r.Processo) };
      out.push(por[k]);
    });
    return out.sort(function (a, b) { return String(a.CodEquipamento).localeCompare(String(b.CodEquipamento), 'pt-BR', { numeric: true }) || a.Equipamento.localeCompare(b.Equipamento, 'pt-BR'); });
  }
  function equipPorChave(k) { return equipamentos().find(function (e) { return e.chave === k; }) || null; }

  /* ---------------------------------------------------------------------
     2) PARADAS
     --------------------------------------------------------------------- */
  function motivos(ativos) { return A((D() || {}).paradas_motivos).filter(function (m) { return m && (!ativos || m.Ativo !== 'Não'); }); }
  function motivoPorId(id) { return motivos().find(function (m) { return m.IdMotivoParada === id; }) || null; }
  function proximoIdMotivo() {
    var max = 0;
    motivos().forEach(function (m) { var x = String(m.IdMotivoParada || '').match(/^PRM(\d+)$/); if (x) max = Math.max(max, +x[1]); });
    return 'PRM' + String(max + 1).padStart(4, '0');
  }
  function salvarMotivo(categoria, motivo, planejada, ignorarId) {
    garantir();
    var cat = txt(categoria), mot = txt(motivo);
    if (!CATEGORIAS.some(function (c) { return c[0] === cat; })) return { erro: 'Escolha a categoria da parada.' };
    if (!mot) return { erro: 'Informe o motivo.' };
    if (planejada !== 'Sim' && planejada !== 'Não') return { erro: 'Diga se a parada é planejada (Sim ou Não).' };
    var igual = motivos().find(function (m) { return m.IdMotivoParada !== ignorarId && norm(m.Categoria) === norm(cat) && norm(m.Motivo) === norm(mot); });
    if (igual) return { erro: 'Esse motivo já está cadastrado (' + igual.IdMotivoParada + ').' };
    var d = D(), m = ignorarId ? motivoPorId(ignorarId) : null;
    if (m) { m.Categoria = cat; m.Motivo = mot; m.Planejada = planejada; m.AlteradoEm = agora(); m.AlteradoPor = usuario(); }
    else { m = { IdMotivoParada: proximoIdMotivo(), Categoria: cat, Motivo: mot, Planejada: planejada, Ativo: 'Sim', CriadoEm: agora(), CriadoPor: usuario() }; d.paradas_motivos.push(m); }
    salvar();
    return { motivo: m };
  }
  function inicioParada(p) { return parseDataHora(p.DataInicio, p.HoraInicio); }
  function fimParada(p) { return txt(p.HoraFim) ? parseDataHora(txt(p.DataFim) || p.DataInicio, p.HoraFim) : null; }
  function duracaoParada(p) { var a = inicioParada(p), b = fimParada(p); return a && b && b > a ? arred((b - a) / 60000, 2) : 0; }
  function paradas() { return A((D() || {}).paradas).filter(Boolean); }
  function paradasDoEquip(k) { return paradas().filter(function (p) { return chaveEquip(p.CodEquipamento, p.Equipamento) === k; }); }
  function abertaNoEquip(k) { return paradasDoEquip(k).find(function (p) { return p.Status === 'Aberta'; }) || null; }
  function sobrepoe(k, ini, fim, ignorarId) {
    return paradasDoEquip(k).find(function (p) {
      if (p.IdParada === ignorarId) return false;
      var a = inicioParada(p), b = p.Status === 'Aberta' ? new Date(8640000000000000) : fimParada(p);
      return a && b && a < fim && ini < b;
    }) || null;
  }
  /* registra (ou altera) uma parada. o = { equip, CodOP, IdRecursoRoteiro, Processo, IdMotivoParada, Planejada, DataInicio,
     HoraInicio, DataFim, HoraFim (vazio = aberta), Observacoes, Operador } */
  function registrarParada(o, ignorarId) {
    garantir();
    var eq = o.equip && o.equip.chave ? o.equip : equipPorChave(o.equip);
    if (!eq) return { erro: 'Escolha o equipamento.' };
    var mot = motivoPorId(o.IdMotivoParada);
    if (!mot) return { erro: 'Escolha o motivo da parada (cadastro de motivos de parada).' };
    var plan = o.Planejada === 'Sim' || o.Planejada === 'Não' ? o.Planejada : mot.Planejada;
    var di = txt(o.DataInicio), hi = txt(o.HoraInicio), df = txt(o.DataFim), hf = txt(o.HoraFim);
    var ini = parseDataHora(di, hi);
    if (!ini) return { erro: 'Início inválido: data dd/mm/aaaa e hora hh:mm.' };
    var fim = null;
    if (hf || df) {
      fim = parseDataHora(df || di, hf);
      if (!fim) return { erro: 'Fim inválido: hora hh:mm (e data dd/mm/aaaa, se for outro dia).' };
      /* "Encerrar agora" no mesmo minuto em que começou fica com 0 min (nada inventado); no intervalo digitado, fim = início é engano */
      if (fim < ini || (+fim === +ini && !o.permitirZero)) return { erro: 'O fim da parada tem de ser depois do início.' };
    }
    if (fim && fim > new Date(Date.now() + 5 * 60000)) return { erro: 'O fim da parada está no futuro.' };
    if (!fim && ini > new Date(Date.now() + 5 * 60000)) return { erro: 'O início da parada está no futuro.' };
    var ab = abertaNoEquip(eq.chave);
    if (!fim && ab && ab.IdParada !== ignorarId) return { erro: 'Já há uma parada aberta neste equipamento (desde ' + ab.DataInicio + ' ' + ab.HoraInicio + '): encerre-a antes.' };
    var sob = sobrepoe(eq.chave, ini, fim || new Date(8640000000000000), ignorarId);
    if (sob) return { erro: 'Sobrepõe outra parada deste equipamento (' + sob.DataInicio + ' ' + sob.HoraInicio + (sob.HoraFim ? ' a ' + (sob.DataFim && sob.DataFim !== sob.DataInicio ? sob.DataFim + ' ' : '') + sob.HoraFim : ', aberta') + ').' };
    var op = txt(o.CodOP) ? opPor(o.CodOP) : null;
    if (txt(o.CodOP) && !op) return { erro: 'OP ' + o.CodOP + ' não encontrada.' };
    var d = D(), p = ignorarId ? paradas().find(function (x) { return x.IdParada === ignorarId; }) : null, novo = !p;
    if (!p) p = { IdParada: idNovo('PAR'), CriadoEm: agora(), CriadoPor: usuario() };
    Object.assign(p, { CodEquipamento: eq.CodEquipamento, Equipamento: eq.Equipamento, CodOP: op ? op.CodOP : '', IdRecursoRoteiro: txt(o.IdRecursoRoteiro), Processo: txt(o.Processo) || eq.Processo || '',
      IdMotivoParada: mot.IdMotivoParada, Categoria: mot.Categoria, Motivo: mot.Motivo, Planejada: plan, DataInicio: dataBR(ini), HoraInicio: horaHM(ini),
      DataFim: fim ? dataBR(fim) : '', HoraFim: fim ? horaHM(fim) : '', Status: fim ? 'Encerrada' : 'Aberta', Operador: txt(o.Operador) || usuario(), Observacoes: txt(o.Observacoes) });
    p.DuracaoMin = fim ? String(duracaoParada(p)) : '';
    if (!novo) { p.AlteradoEm = agora(); p.AlteradoPor = usuario(); }
    if (novo) d.paradas.push(p);
    salvar();
    return { parada: p };
  }
  function encerrarParada(id, dataFim, horaFim) {
    var p = paradas().find(function (x) { return x.IdParada === id; });
    if (!p) return { erro: 'Parada não encontrada.' };
    if (p.Status !== 'Aberta') return { erro: 'Esta parada já está encerrada.' };
    return registrarParada({ equip: { chave: chaveEquip(p.CodEquipamento, p.Equipamento), CodEquipamento: p.CodEquipamento, Equipamento: p.Equipamento, Processo: p.Processo }, CodOP: p.CodOP, IdRecursoRoteiro: p.IdRecursoRoteiro, Processo: p.Processo, IdMotivoParada: p.IdMotivoParada,
      Planejada: p.Planejada, DataInicio: p.DataInicio, HoraInicio: p.HoraInicio, DataFim: dataFim || hoje(), HoraFim: horaFim || horaAgora(), Observacoes: p.Observacoes, Operador: p.Operador, permitirZero: true }, p.IdParada);
  }
  function excluirParada(id) {
    var d = D(), n = A(d.paradas).length;
    d.paradas = A(d.paradas).filter(function (x) { return x && x.IdParada !== id; });
    if (d.paradas.length !== n) { salvar(); return true; }
    return false;
  }

  /* ---- formulário (tela de paradas e quadro no apontamento) ---- */
  function opcoesMotivos(sel) {
    var ms = motivos(true);
    if (!ms.length) return '<option value="">Nenhum motivo cadastrado — cadastre em "Motivos de parada"</option>';
    return '<option value="">Selecione o motivo...</option>' + CATEGORIAS.map(function (c) {
      var g = ms.filter(function (m) { return m.Categoria === c[0]; });
      return g.length ? '<optgroup label="' + esc(c[0]) + '">' + g.map(function (m) { return '<option value="' + esc(m.IdMotivoParada) + '"' + (m.IdMotivoParada === sel ? ' selected' : '') + '>' + esc(m.Motivo) + (m.Planejada === 'Sim' ? ' (planejada)' : '') + '</option>'; }).join('') + '</optgroup>' : '';
    }).join('');
  }
  function formParada(px, ctx) {
    ctx = ctx || {};
    var eqs = ctx.equipamentos || equipamentos();
    return '<div class="mpt-grid">' +
      '<label class="wide"><span>Equipamento</span><select id="' + px + '_eq">' + (eqs.length ? eqs.map(function (e) {
        return '<option value="' + esc(e.chave) + '"' + (e.chave === ctx.equip ? ' selected' : '') + '>' + esc((e.CodEquipamento ? e.CodEquipamento + ' — ' : '') + e.Equipamento) + (e.rotulo ? ' · ' + esc(e.rotulo) : '') + '</option>';
      }).join('') : '<option value="">Nenhum equipamento cadastrado</option>') + '</select></label>' +
      '<label class="wide"><span>Motivo da parada</span><select id="' + px + '_mot" onchange="mesParadaMotivo(\'' + px + '\')">' + opcoesMotivos('') + '</select></label>' +
      '<label><span>Planejada?</span><select id="' + px + '_plan"><option value="">(do motivo)</option><option>Não</option><option>Sim</option></select></label>' +
      (ctx.semOP ? '' : '<label><span>OP (opcional)</span><input id="' + px + '_op" value="' + esc(ctx.op || '') + '" placeholder="Código da OP"></label>') +
      '<label><span>Data de início</span><input id="' + px + '_di" placeholder="dd/mm/aaaa (vazio = hoje)"></label><label><span>Hora de início</span><input id="' + px + '_hi" placeholder="hh:mm (vazio = agora)"></label>' +
      '<label><span>Data de fim</span><input id="' + px + '_df" placeholder="dd/mm/aaaa (vazio = data de início)"></label><label><span>Hora de fim</span><input id="' + px + '_hf" placeholder="hh:mm"></label>' +
      '<label class="wide"><span>Observação</span><input id="' + px + '_obs" placeholder="O que aconteceu (opcional)"></label></div>' +
      '<div class="mpt-actions"><button onclick="mesParadaRegistrar(\'' + px + '\', true)">⏸ Iniciar parada agora</button><button onclick="mesParadaRegistrar(\'' + px + '\', false)">Registrar intervalo (início e fim)</button>' +
      '<button class="secondary" onclick="render(\'paradas_motivos\')">Motivos de parada</button></div><div id="' + px + '_msg" class="mpt-msg"></div>';
  }
  window.mesParadaMotivo = function (px) { var m = motivoPorId(val(px + '_mot')); if (m && el(px + '_plan')) el(px + '_plan').value = m.Planejada; };
  var equipsAp = {};
  window.mesParadaRegistrar = function (px, agoraSim) {
    var o = { equip: (px === 'mpt_ap' && equipsAp[val(px + '_eq')]) || val(px + '_eq'), CodOP: el(px + '_op') ? val(px + '_op') : (window.__mptOP || ''), IdMotivoParada: val(px + '_mot'), Planejada: val(px + '_plan'),
      DataInicio: txt(val(px + '_di')) || hoje(), HoraInicio: txt(val(px + '_hi')) || horaAgora(), DataFim: agoraSim ? '' : txt(val(px + '_df')), HoraFim: agoraSim ? '' : txt(val(px + '_hf')),
      Observacoes: val(px + '_obs'), Operador: val('ap_operador') };
    if (!agoraSim && !txt(o.HoraFim)) return aviso(px + '_msg', 'Informe a hora de fim (ou use "Iniciar parada agora").', 'erro');
    var r = registrarParada(o);
    if (r.erro) return aviso(px + '_msg', esc(r.erro), 'erro');
    window.__mptMsg = { px: px, html: 'Parada registrada: ' + esc(r.parada.Equipamento) + ' · ' + esc(r.parada.Motivo) + (r.parada.Status === 'Aberta' ? ' (aberta desde ' + r.parada.HoraInicio + ')' : ' · ' + fmt(r.parada.DuracaoMin) + ' min') };
    reexibir();
  };
  window.mesParadaEncerrar = function (id) {
    var r = encerrarParada(id);
    if (r.erro) return alert(r.erro);
    reexibir();
  };
  window.mesParadaExcluir = function (id) {
    var p = paradas().find(function (x) { return x.IdParada === id; }); if (!p) return;
    if (!confirm('Excluir a parada de ' + p.Equipamento + ' (' + p.DataInicio + ' ' + p.HoraInicio + ', ' + p.Motivo + ')?')) return;
    excluirParada(id); reexibir();
  };
  function reexibir() {
    if (typeof current !== 'undefined' && current === 'paradas') return telaParadas();
    if (typeof showProdOP === 'function' && el('prod_op')) return showProdOP();
  }
  function linhaParada(p, comOP) {
    return '<tr><td>' + esc(p.DataInicio) + ' ' + esc(p.HoraInicio) + '</td><td>' + (p.HoraFim ? esc((p.DataFim && p.DataFim !== p.DataInicio ? p.DataFim + ' ' : '') + p.HoraFim) : tag('aberta', 'alerta')) + '</td>' +
      '<td class="mpt-num">' + (p.Status === 'Aberta' ? '—' : fmt(p.DuracaoMin) + ' min') + '</td><td>' + esc((p.CodEquipamento ? p.CodEquipamento + ' — ' : '') + p.Equipamento) + '</td>' +
      (comOP ? '<td>' + esc(p.CodOP || '—') + '</td>' : '') + '<td>' + esc(p.Categoria) + '</td><td>' + esc(p.Motivo) + '</td><td>' + (p.Planejada === 'Sim' ? tag('planejada', 'info') : tag('não planejada', 'erro')) + '</td>' +
      '<td>' + esc(p.Operador || '') + '</td><td>' + esc(p.Observacoes || '') + '</td><td style="white-space:nowrap">' + (p.Status === 'Aberta' ? '<button class="mini" onclick="mesParadaEncerrar(\'' + jsStr(p.IdParada) + '\')">Encerrar agora</button> ' : '') +
      '<button class="mini secondary" onclick="mesParadaExcluir(\'' + jsStr(p.IdParada) + '\')">Excluir</button></td></tr>';
  }
  var COLS_PARADA = ['Início', 'Fim', 'Duração', 'Equipamento', 'Categoria', 'Motivo', 'Tipo', 'Operador', 'Observação', 'Ações'];

  /* ---- tela Paradas de máquina ---- */
  function telaParadas() {
    garantir(); estilo(); setCurrent('paradas'); marcarNav('paradas');
    cabecalho('Paradas de máquina', 'Paradas por equipamento com motivo e se são planejadas: base da Disponibilidade do OEE nos Painéis.');
    var f = window.__mptFiltro || { eq: '', de: '', ate: '' }, de = f.de ? parseDataHora(f.de) : null, ate = f.ate ? parseDataHora(f.ate) : null;
    if (ate) ate = new Date(ate.getTime() + 86399999);
    var lista = paradas().filter(function (p) {
      var a = inicioParada(p);
      return (!f.eq || chaveEquip(p.CodEquipamento, p.Equipamento) === f.eq) && (!de || (a && a >= de)) && (!ate || (a && a <= ate));
    }).sort(function (a, b) { return (inicioParada(b) || 0) - (inicioParada(a) || 0); });
    var porMot = {}, tot = 0, totNP = 0;
    lista.forEach(function (p) { if (p.Status !== 'Encerrada') return; var m = N(p.DuracaoMin); tot += m; if (p.Planejada !== 'Sim') totNP += m; var k = p.Categoria + ' › ' + p.Motivo; porMot[k] = (porMot[k] || 0) + m; });
    var pareto = Object.keys(porMot).map(function (k) { return [k, porMot[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var maxM = pareto.length ? pareto[0][1] : 0, acum = 0;
    var eqs = equipamentos();
    el('content').innerHTML = '<div class="toolbar"><button class="secondary" onclick="render(\'paradas_motivos\')">Motivos de parada</button><button class="secondary" onclick="render(\'producao\')">Apontamento de Produção</button></div>' +
      '<div class="mpt-card"><h3>Registrar parada</h3><p class="muted">Use para paradas fora de uma OP (sem programação, manutenção, falta de operador) ou dentro dela. Paradas não planejadas reduzem a Disponibilidade do OEE; as planejadas ficam fora do tempo planejado.</p>' +
      (motivos(true).length ? '' : '<p class="mpt-msg alerta">Cadastre primeiro os motivos de parada (botão "Motivos de parada").</p>') + formParada('mpt_tp', { equipamentos: eqs }) + '</div>' +
      '<div class="mpt-card"><h3>Paradas registradas</h3><div class="mpt-grid"><label class="wide"><span>Equipamento</span><select id="mpt_f_eq"><option value="">Todos</option>' + eqs.map(function (e) { return '<option value="' + esc(e.chave) + '"' + (e.chave === f.eq ? ' selected' : '') + '>' + esc((e.CodEquipamento ? e.CodEquipamento + ' — ' : '') + e.Equipamento) + '</option>'; }).join('') + '</select></label>' +
      '<label><span>De</span><input id="mpt_f_de" value="' + esc(f.de) + '" placeholder="dd/mm/aaaa"></label><label><span>Até</span><input id="mpt_f_ate" value="' + esc(f.ate) + '" placeholder="dd/mm/aaaa"></label></div>' +
      '<div class="mpt-actions"><button onclick="mesParadasFiltrar()">Filtrar</button><button class="secondary" onclick="window.__mptFiltro=null;render(\'paradas\')">Limpar</button></div>' +
      '<div class="mpt-kpis"><div><small>Paradas no filtro</small><b>' + lista.length + '</b></div><div><small>Minutos parados (encerradas)</small><b>' + fmt(tot) + '</b></div><div><small>Não planejadas</small><b>' + fmt(totNP) + ' min</b></div><div><small>Abertas agora</small><b>' + lista.filter(function (p) { return p.Status === 'Aberta'; }).length + '</b></div></div>' +
      tabela(['Início', 'Fim', 'Duração', 'Equipamento', 'OP', 'Categoria', 'Motivo', 'Tipo', 'Operador', 'Observação', 'Ações'], lista.map(function (p) { return linhaParada(p, true); }), 'Nenhuma parada no filtro.') +
      '<h4>Minutos parados por motivo (Pareto, paradas encerradas)</h4>' + tabela(['Categoria › motivo', 'Minutos', '% do total', '% acumulado', ''], pareto.map(function (x) {
        acum += x[1];
        return '<tr><td>' + esc(x[0]) + '</td><td class="mpt-num">' + fmt(x[1]) + '</td><td class="mpt-num">' + fmt(tot ? x[1] / tot * 100 : 0, 1) + '%</td><td class="mpt-num">' + fmt(tot ? acum / tot * 100 : 0, 1) + '%</td><td><div class="mpt-barra"><i style="width:' + (maxM ? arred(x[1] / maxM * 100, 1) : 0) + '%"></i></div></td></tr>';
      }), 'Sem paradas encerradas no filtro.') + '</div>';
    if (window.__mptMsg && window.__mptMsg.px === 'mpt_tp') { aviso('mpt_tp_msg', window.__mptMsg.html, 'ok'); window.__mptMsg = null; }
  }
  window.mesParadasFiltrar = function () { window.__mptFiltro = { eq: val('mpt_f_eq'), de: txt(val('mpt_f_de')), ate: txt(val('mpt_f_ate')) }; telaParadas(); };

  /* ---- tela Motivos de parada ---- */
  function telaMotivos() {
    garantir(); estilo(); setCurrent('paradas_motivos'); marcarNav('paradas_motivos');
    cabecalho('Motivos de parada', 'Categoria, motivo e se a parada é planejada (planejada fica fora do tempo planejado do OEE).');
    var ms = motivos().slice().sort(function (a, b) { return CATEGORIAS.findIndex(function (c) { return c[0] === a.Categoria; }) - CATEGORIAS.findIndex(function (c) { return c[0] === b.Categoria; }) || a.Motivo.localeCompare(b.Motivo, 'pt-BR'); });
    var uso = {}; paradas().forEach(function (p) { uso[p.IdMotivoParada] = (uso[p.IdMotivoParada] || 0) + 1; });
    el('content').innerHTML = '<div class="toolbar"><button class="secondary" onclick="render(\'paradas\')">← Paradas de máquina</button></div>' +
      '<div class="mpt-card"><h3>Novo motivo</h3><div class="mpt-grid"><label><span>Categoria</span><select id="mpt_m_cat" onchange="mesMotivoParadaCat()"><option value="">Selecione...</option>' +
      CATEGORIAS.map(function (c) { return '<option>' + esc(c[0]) + '</option>'; }).join('') + '</select></label><label class="wide"><span>Motivo</span><input id="mpt_m_mot" placeholder="Ex.: troca de rolo da calandra"></label>' +
      '<label><span>Planejada?</span><select id="mpt_m_plan"><option>Não</option><option>Sim</option></select></label></div>' +
      '<div class="mpt-actions"><button onclick="mesMotivoParadaSalvar()">Salvar motivo</button></div><div id="mpt_m_msg" class="mpt-msg"></div></div>' +
      '<div class="mpt-card"><h3>Motivos cadastrados</h3>' + tabela(['Código', 'Categoria', 'Motivo', 'Planejada', 'Ativo', 'Paradas', 'Ações'], ms.map(function (m) {
        return '<tr><td>' + esc(m.IdMotivoParada) + '</td><td>' + esc(m.Categoria) + '</td><td>' + esc(m.Motivo) + '</td><td>' + esc(m.Planejada) + '</td><td>' + esc(m.Ativo || 'Sim') + '</td><td class="mpt-num">' + (uso[m.IdMotivoParada] || 0) + '</td>' +
          '<td><button class="mini secondary" onclick="mesMotivoParadaAtivo(\'' + jsStr(m.IdMotivoParada) + '\')">' + (m.Ativo === 'Não' ? 'Reativar' : 'Desativar') + '</button></td></tr>';
      }), 'Nenhum motivo cadastrado.') + '</div>';
  }
  window.mesMotivoParadaCat = function () { var c = CATEGORIAS.find(function (x) { return x[0] === val('mpt_m_cat'); }); if (c) el('mpt_m_plan').value = c[1]; };
  window.mesMotivoParadaSalvar = function () {
    var r = salvarMotivo(val('mpt_m_cat'), val('mpt_m_mot'), val('mpt_m_plan'));
    if (r.erro) return aviso('mpt_m_msg', esc(r.erro), 'erro');
    telaMotivos(); aviso('mpt_m_msg', 'Motivo ' + esc(r.motivo.IdMotivoParada) + ' salvo.', 'ok');
  };
  window.mesMotivoParadaAtivo = function (id) { var m = motivoPorId(id); if (!m) return; m.Ativo = m.Ativo === 'Não' ? 'Sim' : 'Não'; salvar(); telaMotivos(); };

  /* ---------------------------------------------------------------------
     3) TESTES DAS CÉLULAS
     --------------------------------------------------------------------- */
  var TIPOS_TESTE = ['Formação', 'Capacidade', 'Ciclagem'];
  function testes() { return A((D() || {}).testes_celulas).filter(Boolean); }
  function etiquetasDaOP(cod) { return A((D() || {}).etiquetas_producao).filter(function (e) { return e && e.Status !== 'CANCELADA' && txt(e.CodOP) === txt(cod); }); }
  function qtdProduzida(op) {
    var s = A((D() || {}).producao).filter(function (r) { return r && txt(r.CodOP) === txt(op.CodOP); }).reduce(function (t, r) { return t + N(r['Quantidade produzida'] || r.QuantidadeProduzida || r.Quantidade); }, 0);
    return s > 0 ? s : N(op.QtdProduzida);
  }
  /* uma linha por célula: etiqueta de 1 un = a célula; etiqueta de k un = k células (ET#1..k); sem etiqueta = OP#1..n */
  function celulasDaOP(op) {
    var out = [], ets = etiquetasDaOP(op.CodOP);
    ets.forEach(function (e) {
      var q = Math.round(N(e.Quantidade));
      if (q <= 1) out.push({ IdCelula: e.IdEtiqueta, Etiqueta: e.IdEtiqueta });
      else for (var i = 1; i <= q; i++) out.push({ IdCelula: e.IdEtiqueta + '#' + i, Etiqueta: e.IdEtiqueta });
    });
    if (!out.length) { var n = Math.round(qtdProduzida(op)); for (var j = 1; j <= n; j++) out.push({ IdCelula: op.CodOP + '#' + j, Etiqueta: '' }); }
    /* células com teste gravado que já não estão na lista (ex.: etiqueta cancelada) continuam visíveis */
    testes().forEach(function (t) { if (txt(t.CodOP) === txt(op.CodOP) && !out.some(function (c) { return c.IdCelula === t.IdCelula; })) out.push({ IdCelula: t.IdCelula, Etiqueta: t.Etiqueta || '', fora: true }); });
    return out;
  }
  function chaveData(t) { var d = parseDataHora(t.Data); return (d ? d.getTime() : 0) * 1000 + (N(t.Seq) || 0); }
  /* resultado medido da célula: teste mais recente com energia (e, separado, com capacidade) */
  function medidoDaCelula(cod, idCel) {
    var ts = testes().filter(function (t) { return txt(t.CodOP) === txt(cod) && t.IdCelula === idCel; }).sort(function (a, b) { return chaveData(b) - chaveData(a); });
    var e = ts.find(function (t) { return N(t.EnergiaDescargaWh) > 0; }), c = ts.find(function (t) { return N(t.CapacidadeDescargaAh) > 0; });
    return { energia: e ? N(e.EnergiaDescargaWh) : null, capacidade: c ? N(c.CapacidadeDescargaAh) : null, testeE: e || null, testeC: c || null, n: ts.length };
  }
  function resumoTestes(op) {
    var cels = celulasDaOP(op).filter(function (c) { return !c.fora; }), es = [], cs = [];
    cels.forEach(function (c) { var m = medidoDaCelula(op.CodOP, c.IdCelula); if (m.energia != null) es.push(m.energia); if (m.capacidade != null) cs.push(m.capacidade); });
    var prod = produtoDe(codProdutoOP(op)), enom = N(prod['Energia (Wh)']), cnom = N(prod['Capacidade (Ah)']) || N(prod['Capacidade Final (Ah)']);
    function est(v) { if (!v.length) return null; var s = v.reduce(function (a, b) { return a + b; }, 0); return { n: v.length, soma: s, media: s / v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v) }; }
    return { celulas: cels.length, energia: est(es), capacidade: est(cs), energiaNominal: enom, capacidadeNominal: cnom };
  }
  function salvarTestes(op, tipo, dataT, equip, linhas) {
    garantir();
    if (TIPOS_TESTE.indexOf(tipo) < 0) return { erro: 'Escolha o tipo de teste.' };
    if (!parseDataHora(dataT)) return { erro: 'Data do teste inválida (dd/mm/aaaa).' };
    if (parseDataHora(dataT) > new Date()) return { erro: 'A data do teste está no futuro.' };
    var erros = [], ok = [];
    linhas.forEach(function (l) {
      var e = numDigitado(l.energia), c = numDigitado(l.capacidade);
      if (e === '' && c === '') return;
      if ((e !== '' && (isNaN(e) || e <= 0)) || (c !== '' && (isNaN(c) || c <= 0))) { erros.push(l.IdCelula + ': valores devem ser números maiores que zero'); return; }
      ok.push({ l: l, e: e, c: c });
    });
    if (erros.length) return { erro: erros.join('; ') };
    if (!ok.length) return { erro: 'Informe a energia e/ou a capacidade medidas de pelo menos uma célula.' };
    var d = D(), seq = testes().reduce(function (m, t) { return Math.max(m, N(t.Seq)); }, 0), feitos = [];
    ok.forEach(function (x) {
      /* o mesmo tipo de teste na mesma data para a mesma célula substitui o registro (correção de digitação) */
      var t = testes().find(function (y) { return txt(y.CodOP) === txt(op.CodOP) && y.IdCelula === x.l.IdCelula && y.TipoTeste === tipo && y.Data === dataT; });
      if (!t) { t = { IdTeste: idNovo('TC'), CodOP: op.CodOP, IdCelula: x.l.IdCelula, Etiqueta: x.l.Etiqueta || '', CodigoProduto: codProdutoOP(op), TipoTeste: tipo, Data: dataT, CriadoEm: agora(), CriadoPor: usuario(), Seq: ++seq }; d.testes_celulas.push(t); }
      else { t.AlteradoEm = agora(); t.AlteradoPor = usuario(); t.Seq = ++seq; }
      t.Equipamento = txt(equip); t.EnergiaDescargaWh = x.e === '' ? '' : String(x.e); t.CapacidadeDescargaAh = x.c === '' ? '' : String(x.c);
      feitos.push(t);
    });
    salvar();
    return { gravados: feitos };
  }
  function excluirTeste(id) { var d = D(), n = A(d.testes_celulas).length; d.testes_celulas = A(d.testes_celulas).filter(function (t) { return t && t.IdTeste !== id; }); if (d.testes_celulas.length !== n) { salvar(); return true; } return false; }
  function painelTestes(op) {
    var cels = celulasDaOP(op), r = resumoTestes(op), um = txt(op.UM) || 'un';
    var linhas = cels.map(function (c, i) {
      var m = medidoDaCelula(op.CodOP, c.IdCelula);
      return '<tr class="mpt-teste"><td>' + esc(c.IdCelula) + (c.fora ? ' ' + tag('fora da lista', 'alerta') : '') + '</td><td>' + (m.energia != null ? fmt(m.energia, 3) + ' Wh <span class="muted">(' + esc(m.testeE.TipoTeste + ' ' + m.testeE.Data) + ')</span>' : '<span class="muted">sem teste</span>') + '</td>' +
        '<td>' + (m.capacidade != null ? fmt(m.capacidade, 3) + ' Ah' : '<span class="muted">—</span>') + '</td>' +
        '<td><input id="mpt_te_' + i + '" data-cel="' + esc(c.IdCelula) + '" data-et="' + esc(c.Etiqueta || '') + '" inputmode="decimal" placeholder="Wh"></td><td><input id="mpt_tc_' + i + '" inputmode="decimal" placeholder="Ah"></td></tr>';
    });
    var pct = function (x, nom) { return nom > 0 && x ? ' (' + fmt(x / nom * 100, 1) + '% do nominal ' + fmt(nom, 2) + ')' : ''; };
    return '<div class="mpt-card" id="mpt_testes"><h3>🔋 Testes das células — energia e capacidade medidas</h3>' +
      '<p class="muted">Resultado do teste de formação, capacidade ou ciclagem de cada célula. A energia medida de cada célula (teste mais recente com energia) é o "kWh gerado" dos Painéis e aparece no passaporte. Célula sem teste fica como "sem teste": o MES não usa a energia de projeto no lugar.</p>' +
      '<div class="mpt-kpis"><div><small>Células (' + esc(um) + ')</small><b>' + r.celulas + '</b></div><div><small>Com energia medida</small><b>' + (r.energia ? r.energia.n : 0) + ' de ' + r.celulas + '</b></div>' +
      '<div><small>Energia média</small><b>' + (r.energia ? fmt(r.energia.media, 2) + ' Wh' : '—') + '</b>' + (r.energia ? '<small>' + esc(pct(r.energia.media, r.energiaNominal)) + '</small>' : '') + '</div>' +
      '<div><small>Capacidade média</small><b>' + (r.capacidade ? fmt(r.capacidade.media, 3) + ' Ah' : '—') + '</b>' + (r.capacidade ? '<small>' + esc(pct(r.capacidade.media, r.capacidadeNominal)) + '</small>' : '') + '</div></div>' +
      '<div class="mpt-grid"><label><span>Tipo de teste</span><select id="mpt_tt_tipo">' + TIPOS_TESTE.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></label>' +
      '<label><span>Data do teste</span><input id="mpt_tt_data" value="' + esc(hoje()) + '" placeholder="dd/mm/aaaa"></label><label class="wide"><span>Equipamento de teste</span><input id="mpt_tt_eq" placeholder="Ex.: Arbin"></label></div>' +
      tabela(['Célula', 'Energia medida (último teste)', 'Capacidade medida', 'Nova energia de descarga (Wh)', 'Nova capacidade (Ah)'], linhas, 'Sem células: aponte a produção da OP de PA primeiro.') +
      '<div class="mpt-actions"><button onclick="mesTestesSalvar()">Salvar resultados dos testes</button><button class="secondary" onclick="render(\'testes_celulas\')">Todos os testes</button></div><div id="mpt_tt_msg" class="mpt-msg"></div></div>';
  }
  window.mesTestesSalvar = function () {
    var op = typeof selectedOP === 'function' ? selectedOP('prod_op') : null; if (!op || !op.CodOP) return;
    var linhas = [], i = 0;
    while (el('mpt_te_' + i)) { var e = el('mpt_te_' + i); linhas.push({ IdCelula: e.dataset.cel, Etiqueta: e.dataset.et, energia: e.value, capacidade: val('mpt_tc_' + i) }); i++; }
    var r = salvarTestes(op, val('mpt_tt_tipo'), txt(val('mpt_tt_data')), val('mpt_tt_eq'), linhas);
    if (r.erro) return aviso('mpt_tt_msg', esc(r.erro), 'erro');
    window.__mptTesteMsg = r.gravados.length + ' resultado(s) de teste gravado(s).';
    if (typeof showProdOP === 'function') showProdOP();
  };
  function telaTestes() {
    garantir(); estilo(); setCurrent('testes_celulas'); marcarNav('testes_celulas');
    cabecalho('Testes das células', 'Energia e capacidade medidas por célula (formação, capacidade, ciclagem).');
    var ts = testes().slice().sort(function (a, b) { return chaveData(b) - chaveData(a); });
    el('content').innerHTML = '<div class="toolbar"><button class="secondary" onclick="render(\'producao\')">Apontamento de Produção</button></div><div class="mpt-card"><h3>Resultados gravados</h3>' +
      '<p class="muted">Para lançar: Apontamento de Produção › OP de PA › quadro "Testes das células".</p>' +
      tabela(['Data', 'OP', 'Célula', 'Produto', 'Tipo', 'Equipamento', 'Energia (Wh)', 'Capacidade (Ah)', 'Gravado por', 'Ações'], ts.map(function (t) {
        return '<tr><td>' + esc(t.Data) + '</td><td>' + esc(t.CodOP) + '</td><td>' + esc(t.IdCelula) + '</td><td>' + esc(t.CodigoProduto || '') + '</td><td>' + esc(t.TipoTeste) + '</td><td>' + esc(t.Equipamento || '') + '</td>' +
          '<td class="mpt-num">' + (N(t.EnergiaDescargaWh) > 0 ? fmt(t.EnergiaDescargaWh, 3) : '—') + '</td><td class="mpt-num">' + (N(t.CapacidadeDescargaAh) > 0 ? fmt(t.CapacidadeDescargaAh, 3) : '—') + '</td><td>' + esc(t.AlteradoPor || t.CriadoPor || '') + '</td>' +
          '<td><button class="mini secondary" onclick="mesTesteExcluir(\'' + jsStr(t.IdTeste) + '\')">Excluir</button></td></tr>';
      }), 'Nenhum teste gravado.') + '</div>';
  }
  window.mesTesteExcluir = function (id) {
    var t = testes().find(function (x) { return x.IdTeste === id; }); if (!t) return;
    if (!confirm('Excluir o teste ' + t.TipoTeste + ' de ' + t.Data + ' da célula ' + t.IdCelula + '?')) return;
    excluirTeste(id); telaTestes();
  };

  /* ---------------------------------------------------------------------
     4) APONTAMENTO DE PRODUÇÃO: paradas das máquinas da OP e testes das células da OP de PA
     --------------------------------------------------------------------- */
  function decorarApontamento() {
    var box = el('prodBox'), op = typeof selectedOP === 'function' ? selectedOP('prod_op') : null;
    if (!box || !op || !op.CodOP) return;
    estilo(); garantir();
    window.__mptOP = op.CodOP;
    if (!el('mpt_paradas')) {
      var a = api14(), maqs = a && a.maquinasDaOP ? A(a.maquinasDaOP(op)) : [], vistos = {}, eqs = [];
      maqs.forEach(function (m) {
        var k = chaveEquip(m.CodEquipamento, m.Equipamento); if (vistos[k]) return; vistos[k] = 1;
        eqs.push({ chave: k, CodEquipamento: m.CodEquipamento, Equipamento: m.Equipamento, Processo: m.Processo, rotulo: 'etapa ' + m.Ordem });
      });
      var chaves = {}; equipsAp = {}; eqs.forEach(function (e) { chaves[e.chave] = 1; equipsAp[e.chave] = e; });
      var lista = paradas().filter(function (p) { return txt(p.CodOP) === txt(op.CodOP) || (chaves[chaveEquip(p.CodEquipamento, p.Equipamento)] && p.Status === 'Aberta'); })
        .sort(function (x, y) { return (inicioParada(y) || 0) - (inicioParada(x) || 0); });
      var h = '<div class="mpt-card" id="mpt_paradas"><h3>⏸ Paradas das máquinas desta OP</h3><p class="muted">Máquina parada durante a OP (quebra, setup, falta de material...). O tempo parado dentro do apontamento de tempo sai do tempo em operação; parada não planejada reduz a Disponibilidade do OEE.</p>' +
        (eqs.length ? formParada('mpt_ap', { equipamentos: eqs, semOP: true }) : '<p class="muted">Esta OP não tem máquinas nas etapas.</p>') +
        tabela(COLS_PARADA, lista.map(function (p) { return linhaParada(p, false); }), 'Nenhuma parada nesta OP.') + '</div>';
      var tempo = el('mes14_tempo');
      if (tempo) tempo.insertAdjacentHTML('afterend', h); else box.insertAdjacentHTML('beforeend', h);
      if (window.__mptMsg && window.__mptMsg.px === 'mpt_ap') { aviso('mpt_ap_msg', window.__mptMsg.html, 'ok'); window.__mptMsg = null; }
    }
    if (tipoOP(op) === 'PA' && !el('mpt_testes')) {
      var alvo = el('mpt_paradas') || el('mes14_tempo');
      var ht = painelTestes(op);
      if (alvo) alvo.insertAdjacentHTML('afterend', ht); else box.insertAdjacentHTML('beforeend', ht);
      if (window.__mptTesteMsg) { aviso('mpt_tt_msg', esc(window.__mptTesteMsg), 'ok'); window.__mptTesteMsg = null; }
    }
  }
  (function () {
    var ant = window.showProdOP;
    if (typeof ant !== 'function') return;
    window.showProdOP = function () {
      var r = ant.apply(this, arguments);
      try { decorarApontamento(); } catch (e) { console.warn('MES LION 1.7: paradas e testes no apontamento', e); }
      return r;
    };
  })();

  /* ---------------------------------------------------------------------
     5) MENU, ROTAS E API
     --------------------------------------------------------------------- */
  var ITENS = [['paradas', 'Paradas de Máquina'], ['paradas_motivos', 'Motivos de Parada'], ['testes_celulas', 'Testes das Células']];
  function ajustarMenu() {
    try {
      var mods = (typeof modules !== 'undefined') ? modules : null, grupos = (typeof moduleGroups !== 'undefined') ? moduleGroups : null;
      if (mods) ITENS.forEach(function (x) { if (!mods.some(function (m) { return m[0] === x[0]; })) mods.push(x); });
      var prod = grupos && grupos.find(function (g) { return g.title === 'Produção'; });
      if (prod) {
        var depois = prod.items.indexOf('perdas_motivos') >= 0 ? 'perdas_motivos' : 'perdas';
        ITENS.forEach(function (x) { if (prod.items.indexOf(x[0]) < 0) { var i = prod.items.indexOf(depois); prod.items.splice(i >= 0 ? i + 1 : prod.items.length, 0, x[0]); depois = x[0]; } });
      }
    } catch (e) { console.warn('MES LION 1.7: menu', e); }
  }
  ajustarMenu();
  function refazerMenu() { try { var app = el('app'); if (app && !app.classList.contains('hidden') && typeof renderNav === 'function') { var at = current; renderNav(); marcarNav(at); } } catch (e) { } }
  (function () {
    var ant = window.render;
    if (typeof ant !== 'function') return;
    window.render = function (k) {
      garantir();
      if (k === 'paradas') return telaParadas();
      if (k === 'paradas_motivos') return telaMotivos();
      if (k === 'testes_celulas') return telaTestes();
      return ant.apply(this, arguments);
    };
  })();
  (function () {
    var ant = window.boot;
    if (typeof ant !== 'function') return;
    window.boot = function () { try { garantir(); } catch (e) { } ajustarMenu(); var r = ant.apply(this, arguments); refazerMenu(); return r; };
  })();
  garantir();
  refazerMenu();
  window.mesParadasTestesAPI = {
    versao: VERSAO, categorias: function () { return CATEGORIAS.map(function (c) { return { categoria: c[0], planejada: c[1] }; }); },
    equipamentos: equipamentos, chaveEquip: chaveEquip, motivos: motivos, salvarMotivo: salvarMotivo, paradas: paradas, registrarParada: registrarParada,
    encerrarParada: encerrarParada, excluirParada: excluirParada, inicioParada: inicioParada, fimParada: fimParada, duracaoParada: duracaoParada,
    testes: testes, celulasDaOP: celulasDaOP, medidoDaCelula: medidoDaCelula, resumoTestes: resumoTestes, salvarTestes: salvarTestes, excluirTeste: excluirTeste,
    parseDataHora: parseDataHora
  };
  window.MES_ADAPTADOR_PARADAS_TESTES = VERSAO;
})();
