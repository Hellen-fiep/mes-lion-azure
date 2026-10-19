/* =====================================================================
   MES LION 1.0 JSON — ADAPTADOR DO FRONTEND
   Incluído pelo servidor (server\MES_LION_SERVER_JSON.ps1) no fim do index.html ao entregar a página, depois de
   todos os scripts originais. Os arquivos do frontend (index.html, js\, style.css) continuam idênticos aos do
   MES LION 1.0 PGSQL; as correções ficam aqui:
     1) ACV/LCC: coleções criadas ao carregar a página que se perdiam ao entrar (erro herdado);
     2) textos de plataforma (PostgreSQL -> versão JSON);
     3) Capacidade e Carga V1: botões também no Cadastro de Recursos;
     4) Calendário: botão "Editar dia" (era recriado sem parar e o clique se perdia);
     5) Programação nos dias disponíveis: o calendário guarda os trechos de trabalho de cada operação (não mostra mais
        operações em sábados, domingos, feriados e dias bloqueados), "Projetar sequência" do Plano usa o calendário de
        trabalho, "Validar conflitos" acusa operações em dia indisponível e "Recalcular programação" abre a
        "Sugestão de programação" do Calendário; operações já executadas ficam no calendário em cinza (histórico);
     6) Carga × capacidade: a carga da programação é lida com as datas no formato que o PCP grava (com vírgula);
     7) MRP: o botão "Abrir OPs" abre a tela de Ordens de Produção.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1) CORREÇÃO ACV / LCC / ICV, APONTAMENTO DE TEMPOS E LOTES DE PI
   Os módulos V1.0.19 a V1.1.3 criam essas coleções vazias ao carregar a página; no modo servidor o estado vindo
   do servidor substitui "data" logo depois e elas deixam de existir quando ainda não estão salvas (erro ao abrir
   ACV e LCC, ao salvar ICV e ao iniciar apontamento). Recria apenas as coleções AUSENTES, vazias.
   --------------------------------------------------------------------- */
(function () {
  'use strict';
  var COLECOES = ['acv_estudos', 'acv_cenarios', 'acv_resultados', 'acv_fatores', 'lcc_estudos', 'lcc_cenarios', 'lcc_resultados',
    'acv_icv_salvos', 'apontamento_tempos', 'op_pi_consumos', 'pi_lotes'];
  function garantirColecoes() {
    try {
      if (typeof data !== 'object' || data === null) return;
      for (var i = 0; i < COLECOES.length; i++) { var k = COLECOES[i]; data[k] = data[k] || []; }
    } catch (e) { if (window.console) console.warn('MES LION: correção de coleções', e); }
  }
  window.mesGarantirColecoes = garantirColecoes;
  garantirColecoes();
  var bootAnterior = window.boot;
  if (typeof bootAnterior === 'function') {
    window.boot = function () { garantirColecoes(); return bootAnterior.apply(this, arguments); };
  }
  var renderAnterior = window.render;
  if (typeof renderAnterior === 'function') {
    window.render = function () { garantirColecoes(); return renderAnterior.apply(this, arguments); };
  }
})();

/* ---------------------------------------------------------------------
   2) TEXTOS DE PLATAFORMA
   --------------------------------------------------------------------- */
(function () {
  'use strict';
  var NOME = 'MES LION 1.0 JSON';
  function el(id) { return document.getElementById(id); }
  function texto(t) {
    if (!t) return t;
    return String(t)
      .replace(/MES LION 1\.0 PGSQL/g, NOME)
      .replace(/Usuários PostgreSQL/g, 'Usuários do MES')
      .replace(/ — PostgreSQL \/ Multiusuário/g, ' — sem PostgreSQL');
  }
  function ajustarTitulos() {
    try {
      var novo = texto(document.title);
      if (/MES LION V2\.2\.1/.test(novo)) novo = NOME + ' — sem PostgreSQL';
      if (novo !== document.title) document.title = novo;
      var sub = el('subtitle');
      if (sub) { var s = texto(sub.textContent); if (s !== sub.textContent) sub.textContent = s; }
    } catch (e) { }
  }
  function observarSubtitulo() {
    var sub = el('subtitle');
    if (!sub || !window.MutationObserver) return;
    new MutationObserver(function () {
      var s = texto(sub.textContent);
      if (s !== sub.textContent) sub.textContent = s;
    }).observe(sub, { childList: true, characterData: true, subtree: true });
  }
  function infoLogin() {
    var card = document.querySelector('#login .login-card');
    if (!card || el('mesPlataformaInfo')) return;
    var p = document.createElement('small');
    p.id = 'mesPlataformaInfo';
    p.style.cssText = 'display:block;margin-top:6px;opacity:.75;font-size:11px;line-height:1.4';
    p.textContent = 'Servidor: PowerShell · Banco: arquivos JSON na pasta Dados (sem PostgreSQL)';
    card.appendChild(p);
  }
  ajustarTitulos();
  observarSubtitulo();
  infoLogin();
  window.MES_PLATAFORMA = { nome: NOME, banco: 'JSON' };
})();

/* ---------------------------------------------------------------------
   3) CAPACIDADE E CARGA V1 (js/mes_capacidade_carga_v1.js): os botões "Capacidades das máquinas" e
   "Carga × capacidade" devem aparecer também no Cadastro de Recursos, mas o módulo só os mostra quando a variável
   "current" já vale cad_recursos, e essa tela (V2.1) não a atualiza. Só inclui os botões.
   --------------------------------------------------------------------- */
(function () {
  'use strict';
  var renderAnterior = window.render;
  if (typeof renderAnterior !== 'function') return;
  window.render = function (k) {
    var r = renderAnterior.apply(this, arguments);
    try {
      var c = document.getElementById('content');
      if (k === 'cad_recursos' && typeof window.mesCapCadastro === 'function' && c && !c.querySelector('.mes-cap-toolbar')) {
        c.insertAdjacentHTML('afterbegin', '<div class="toolbar mes-cap-toolbar"><button onclick="mesCapCadastro()">Capacidades das máquinas</button>' +
          '<button onclick="mesCapRelatorio()">Carga × capacidade</button></div>');
      }
    } catch (e) { }
    return r;
  };
})();

/* ---------------------------------------------------------------------
   4 e 5) CALENDÁRIO DE PRODUÇÃO E PROGRAMAÇÃO NOS DIAS DISPONÍVEIS
   Calendário padrão do MES (o mesmo de js/mes_calendar_default_unavailability.js e js/mes_scheduler_fix.js):
   segunda a sexta, 08:00–12:00 e 13:00–17:00; sábados, domingos e feriados nacionais indisponíveis; exceções por
   dia e linha em data.meta.calendarioExcecoes ("Editar dia": Liberar expediente / Bloquear dia); indisponibilidades
   de cada equipamento em data.pcp_calendarios (tela Capacidade).
   --------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.__mesCorrecaoCalendarioJson) return;
  window.__mesCorrecaoCalendarioJson = true;

  var A = function (x) { return Array.isArray(x) ? x : []; };
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dma(date) { return date.slice(8, 10) + '/' + date.slice(5, 7) + '/' + date.slice(0, 4); }
  function parse(x) {
    if (!x) return null;
    if (x instanceof Date) return isNaN(x) ? null : new Date(x.getTime());
    var m = String(x).match(/^(\d{2})\/(\d{2})\/(\d{4})\D+(\d{2}):(\d{2})/);
    var d = m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : new Date(x);
    return isNaN(d) ? null : d;
  }
  function br(d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function temDados() { return typeof data === 'object' && data !== null; }
  function minutosDo(p) { var v = Number(String(p.Minutos == null ? '' : p.Minutos).replace(',', '.')); return isFinite(v) ? v : 0; }
  function recursoDo(p) { return String(p.RecursoRoteiro || p.Recurso || ''); }
  function rotulo(p) { return 'OP ' + (p.OP || p.Demanda || '?') + ' · etapa ' + (p.Ordem == null ? '?' : p.Ordem) + ' · ' + (p.Processo || 'Operação'); }

  // ---- dias úteis (mesmas regras dos módulos originais)
  var FERIADOS = { '01-01': 'Confraternizacao Universal', '04-21': 'Tiradentes', '05-01': 'Dia do Trabalho', '09-07': 'Independencia do Brasil',
    '10-12': 'Nossa Senhora Aparecida', '11-02': 'Finados', '11-15': 'Proclamacao da Republica', '11-20': 'Consciencia Negra', '12-25': 'Natal' };
  function pascoa(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k + 7) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31), dia = (h + l - 7 * m + 114) % 31 + 1;
    return new Date(y, mes - 1, dia);
  }
  function feriado(date) {
    var h = FERIADOS[date.slice(5)];
    if (h) return h;
    var e = pascoa(Number(date.slice(0, 4)));
    e.setDate(e.getDate() - 2);
    return ymd(e) === date ? 'Sexta-feira Santa' : '';
  }
  function motivoPadrao(date) {
    var h = feriado(date);
    if (h) return h;
    var dw = new Date(date + 'T12:00:00').getDay();
    return dw === 0 ? 'Domingo' : dw === 6 ? 'Sabado' : '';
  }
  function linhaAtual() { return String(window.__pcpLineV2314 || 'Todas'); }
  function excecoes() { return temDados() && data.meta ? A(data.meta.calendarioExcecoes) : []; }
  // linhas de produção (mesma comparação do calendário V2.3.17, sem o filtro de projeto)
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function casaPalavras(a, w) {
    if (!w) return true;
    a = norm(a).replace(/\bplanta\s+/g, '');
    w = norm(w).replace(/\bplanta\s+/g, '');
    return !!a && (a === w || a.indexOf(w) >= 0 || w.indexOf(a) >= 0);
  }
  function cartaoNaLinha(lp, linha) {
    var v = String(linha || '');
    if (!v || v === 'Todas') return true;
    var partes = v.split('|'), tipo = partes[0] || '', escala = partes[1] || '';
    if (!tipo && !escala) return true;
    return casaPalavras(lp.TipoCelula, tipo) && casaPalavras(lp.Escala, escala);
  }
  // tipo de célula e escala da operação, tirados da OP e do roteiro como no calendário V2.3.17 (os cartões montados
  // pela tela Plano trazem outro valor em TipoCelula)
  function atributosDeLinha(p) {
    var cod = String(p.OP || p.Demanda || ''), op = null, rt = null;
    if (temDados()) {
      op = A(data.op).find(function (o) { return o && String(o.CodOP) === cod; }) || null;
      if (op) rt = A(data.roteiro).find(function (r) { return r && String(r.CodRoteiro) === String(op.CodRoteiro); }) || null;
    }
    return {
      TipoCelula: (rt && rt.Tipo) || (op && op.TipoCelula) || p.TipoCelula || '',
      Escala: (rt && rt.EscalaProducao) || (op && (op.EscalaProducao || op.Escala)) || (rt && rt.Escala) || p.Escala || ''
    };
  }
  // exceção do dia na visão de uma linha (a da tela): a da própria linha vale mais que a de "Todas"
  function excecaoDaLinha(date, ln) {
    var lista = excecoes().filter(function (x) { return x && x.Data === date && (x.Linha === ln || x.Linha === 'Todas'); });
    lista.sort(function (a, b) { return (a.Linha === ln ? 1 : 0) - (b.Linha === ln ? 1 : 0); });
    return lista.pop();
  }
  // exceção do dia para uma operação: a da linha de produção da operação vale mais que a de "Todas"
  function excecaoDoCartao(date, lp) {
    var lista = excecoes().filter(function (x) {
      return x && x.Data === date && (x.Linha === 'Todas' || (!!x.Linha && x.Linha !== 'Caracterizacao' && cartaoNaLinha(lp, x.Linha)));
    });
    lista.sort(function (a, b) { return (a.Linha === 'Todas' ? 0 : 1) - (b.Linha === 'Todas' ? 0 : 1); });
    return lista.pop();
  }
  // '' = dia de trabalho; senão, o motivo da indisponibilidade
  function motivoDaExcecao(x, date) { return x ? (x.Tipo === 'Bloquear' ? (x.Motivo || 'Indisponivel') : '') : motivoPadrao(date); }
  function motivoIndisponivel(date, ln) { return motivoDaExcecao(excecaoDaLinha(date, ln), date); }
  function regraDaLinha(ln) { return function (date) { return motivoIndisponivel(date, ln); }; }
  function regraDoCartao(p) {
    var lp = atributosDeLinha(p);
    var regra = function (date) { return motivoDaExcecao(excecaoDoCartao(date, lp), date); };
    regra.linha = lp.TipoCelula + '|' + lp.Escala;
    return regra;
  }
  window.mesDiaIndisponivel = function (date, linha) { return motivoIndisponivel(String(date).slice(0, 10), linha ? String(linha) : linhaAtual()); };

  /* ---- 4) "Editar dia". A decoração do calendário removia e recriava a faixa INDISPONIVEL e o botão de todos os dias
     a cada alteração da tela, e cada recriação disparava a seguinte (cerca de mil alterações por segundo): o botão era
     trocado entre o apertar e o soltar do mouse e o clique não chegava. Agora só altera o que mudou; a tela fica parada
     e o botão abre a janela "Disponibilidade do dia" (Padrão / Liberar expediente / Bloquear dia). */
  function decorarCalendario() {
    var titulo = (document.getElementById('title') || {}).textContent || '';
    if (!/Calend.rio/i.test(titulo)) return;
    var mp = document.getElementById('pcp_month_pick'), mc = document.getElementById('mes-car-month');
    var m = (mp && mp.value) || (mc && mc.value) || window.__mesCarMonth || '';
    if (!/^\d{4}-\d{2}$/.test(m)) return;
    var ln = linhaAtual();
    var dias = document.querySelectorAll('.pcp-day-v2314:not(.outside),.mes-day:not(.empty)');
    for (var i = 0; i < dias.length; i++) {
      var el = dias[i];
      var b = el.querySelector('header b') || el.querySelector('b');
      var num = Number(b && b.textContent);
      if (!num || num > 31) continue;
      var date = m + '-' + pad(num);
      var motivo = motivoIndisponivel(date, ln);
      var textoFaixa = motivo ? 'INDISPONIVEL · ' + motivo : '';
      var faixa = el.querySelector('.mes-auto-block');
      if (faixa && faixa.textContent !== textoFaixa) { faixa.remove(); faixa = null; }
      if (textoFaixa && !faixa) {
        faixa = document.createElement('div');
        faixa.className = 'mes-auto-block';
        faixa.textContent = textoFaixa;
        var corpo = el.querySelector('.pcp-day-body-v2314');
        if (corpo) corpo.insertBefore(faixa, corpo.firstChild); else el.appendChild(faixa);
      }
      var botao = el.querySelector('.mes-edit-day');
      if (botao && botao.getAttribute('data-dia') !== date) { botao.remove(); botao = null; }
      if (!botao) {
        botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'mes-edit-day';
        botao.setAttribute('data-dia', date);
        botao.textContent = 'Editar dia';
        botao.title = 'Alterar disponibilidade deste dia nesta linha';
        botao.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          if (typeof window.mesEditarDia === 'function') window.mesEditarDia(this.getAttribute('data-dia'));
        });
        (el.querySelector('header') || el).appendChild(botao);
      }
    }
    if (!document.getElementById('mes-calendar-style')) {
      var st = document.createElement('style');
      st.id = 'mes-calendar-style';
      st.textContent = '.mes-auto-block{background:#fce3e3;color:#8c1111;border-left:3px solid #b00;padding:3px;font-size:11px;margin:3px 0}.mes-edit-day{font-size:10px;padding:2px 4px;margin-left:4px}';
      document.head.appendChild(st);
    }
  }
  window.mesCalendarDecorate = decorarCalendario;

  // ---- janelas de trabalho e alocação (a mesma regra de "Sugerir programação por data inicial")
  var JANELAS = [['08:00', '12:00'], ['13:00', '17:00']];
  function dataDoBloqueio(x) {
    var d = String(x.Data || '').trim();
    var m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : d.slice(0, 10);
  }
  function restricoesRecurso(r, date) {
    return A(temDados() ? data.pcp_calendarios : []).filter(function (x) { return x && String(x.Recurso) === String(r) && dataDoBloqueio(x) === date; })
      .map(function (x) { return { start: new Date(date + 'T' + (x.Inicio || '00:00')), end: new Date(date + 'T' + (x.Fim || '23:59')), x: x }; });
  }
  function proximaJanela(t, r, regra, ocupado) {
    var dia = new Date(t.getTime());
    dia.setHours(0, 0, 0, 0);
    for (var k = 0; k < 1500; k++) {
      var date = ymd(dia);
      if (!regra(date)) {
        var bloqueios = restricoesRecurso(r, date).concat(A(ocupado));
        for (var j = 0; j < JANELAS.length; j++) {
          var ini = new Date(date + 'T' + JANELAS[j][0]), fim = new Date(date + 'T' + JANELAS[j][1]);
          var cur = new Date(Math.max(ini.getTime(), t.getTime()));
          while (cur < fim) {
            var hit = null, prox = null;
            for (var q = 0; q < bloqueios.length; q++) {
              var x = bloqueios[q];
              if (cur >= x.start && cur < x.end) { hit = x; break; }
              if (x.start > cur && x.start < fim && (!prox || x.start < prox.start)) prox = x;
            }
            if (hit) { cur = new Date(hit.end.getTime()); continue; }
            var limite = prox ? prox.start : fim;
            if (limite > cur) return [cur, limite];
            break;
          }
        }
      }
      dia.setDate(dia.getDate() + 1);
      dia.setHours(0, 0, 0, 0);
    }
    return null;
  }
  function alocar(t, minutos, r, regra, ocupado) {
    var cur = new Date(t.getTime()), primeiro = null, resta = Math.ceil(minutos), segs = [], guarda = 0;
    while (resta > 0 && guarda++ < 20000) {
      var j = proximaJanela(cur, r, regra, ocupado);
      if (!j) return null;
      var disp = Math.floor((j[1] - j[0]) / 60000);
      if (disp <= 0) { cur = new Date(j[1].getTime() + 60000); continue; }
      var usa = Math.min(resta, disp);
      if (!primeiro) primeiro = j[0];
      cur = new Date(j[0].getTime() + usa * 60000);
      resta -= usa;
      segs.push({ start: new Date(j[0].getTime()), end: new Date(cur.getTime()) });
    }
    return resta === 0 && primeiro ? { start: primeiro, end: cur, segments: segs } : null;
  }
  window.mesAlocarNoCalendario = function (inicio, minutos, recurso, linha) {
    var t = parse(inicio);
    return t ? alocar(t, Number(minutos) || 0, String(recurso || ''), regraDaLinha(linha ? String(linha) : linhaAtual()), null) : null;
  };

  /* ---- 5a) Trechos de trabalho preservados. "Sugerir programação por data inicial" grava em cada cartão os trechos
     realmente trabalhados (Segmentos: só dias úteis, 08–12 e 13–17), mas o calendário reconstrói os cartões a partir
     das OPs a cada exibição e só copiava Início e Fim: os trechos se perdiam e o cartão passava a aparecer em todos os
     dias entre o início e o fim, inclusive sábados, domingos e feriados. Os trechos ficam guardados também em
     data.meta.pcpSegmentos e voltam ao cartão a cada gravação (o calendário grava logo depois de reconstruir os
     cartões e antes de desenhá-los). Cartões programados antes desta correção têm os trechos recalculados quando o
     Início e o Fim gravados são exatamente os do calendário de trabalho. Trechos que não batem mais com o Início/Fim
     do cartão (cartão arrastado, editado ou limpo) são descartados. */
  function chaveCartao(p) {
    return [p.OP || p.Demanda || '', p.Ordem, p.RecursoRoteiro || p.Recurso || p.IdRecursoRoteiro || '', p.Produto || ''].join('|');
  }
  function segmentosCoerentes(p, segs) {
    if (!Array.isArray(segs) || !segs.length) return false;
    var a = parse(p.Inicio), b = parse(p.Fim);
    if (!a || !b) return false;
    var anterior = null;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i] || {}, x = parse(s.Inicio), y = parse(s.Fim);
      if (!x || !y || y <= x || (anterior && x < anterior)) return false;
      anterior = y;
    }
    return Math.abs(parse(segs[0].Inicio) - a) < 60000 && Math.abs(parse(segs[segs.length - 1].Fim) - b) < 60000;
  }
  var memoTrechos = new Map(), memoAssinatura = null;
  function trechosRecalculados(p) {
    var a = parse(p.Inicio), b = parse(p.Fim), min = minutosDo(p), r = recursoDo(p);
    if (!a || !b || b <= a || !(min > 0)) return null;
    var regra = regraDoCartao(p), chave = [p.Inicio, p.Fim, min, r, regra.linha].join('|');
    if (memoTrechos.has(chave)) return memoTrechos.get(chave);
    var s = alocar(a, min, r, regra, null), res = null;
    if (s && s.segments.length > 1 && Math.abs(s.start - a) < 60000 && Math.abs(s.end - b) < 60000) {
      res = s.segments.map(function (g) { return { Inicio: br(g.start), Fim: br(g.end) }; });
    }
    memoTrechos.set(chave, res);
    return res;
  }
  function guardarRestaurarSegmentos() {
    if (!temDados() || !Array.isArray(data.pcp_programacao)) return;
    data.meta = data.meta || {};
    var assinatura = JSON.stringify(excecoes()) + '#' + JSON.stringify(A(data.pcp_calendarios));
    if (assinatura !== memoAssinatura) { memoTrechos = new Map(); memoAssinatura = assinatura; }
    var g0 = data.meta.pcpSegmentos;
    var guardados = g0 && typeof g0 === 'object' && !Array.isArray(g0) ? g0 : {};
    var novos = {}, vistos = {}, ops = {};
    data.pcp_programacao.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var k = chaveCartao(p), op = String(p.OP || p.Demanda || '');
      vistos[k] = true;
      ops[op] = true;
      if (congelado(p)) return;   // histórico da programação (5e): trechos reais vêm dos apontamentos
      if (!p.Inicio || !p.Fim) { if ('Segmentos' in p) delete p.Segmentos; return; }
      if (Array.isArray(p.Segmentos) && p.Segmentos.length && segmentosCoerentes(p, p.Segmentos)) {
        novos[k] = { OP: op, Inicio: p.Inicio, Fim: p.Fim, Segmentos: p.Segmentos };
        return;
      }
      if ('Segmentos' in p) delete p.Segmentos;
      var g = guardados[k];
      if (g && g.Inicio === p.Inicio && g.Fim === p.Fim && segmentosCoerentes(p, g.Segmentos)) {
        p.Segmentos = g.Segmentos;
        novos[k] = { OP: op, Inicio: p.Inicio, Fim: p.Fim, Segmentos: g.Segmentos };
        return;
      }
      var rec = trechosRecalculados(p);
      if (rec) {
        p.Segmentos = rec;
        novos[k] = { OP: op, Inicio: p.Inicio, Fim: p.Fim, Segmentos: rec };
      }
    });
    // cartões da mesma OP montados em outro formato (tela Plano x Calendário): os trechos continuam guardados
    Object.keys(guardados).forEach(function (k) {
      var g = guardados[k];
      if (!novos[k] && !vistos[k] && g && typeof g === 'object' && ops[String(g.OP || '')]) novos[k] = g;
    });
    data.meta.pcpSegmentos = novos;
  }
  window.mesGuardarSegmentosPcp = guardarRestaurarSegmentos;
  var gravarAnterior = window.saveLocal;
  if (typeof gravarAnterior === 'function' && !gravarAnterior.__mesSegmentos) {
    var gravar = function () {
      try { atualizarHistorico(); } catch (e) { if (window.console) console.warn('MES LION: histórico da programação', e); }
      try { guardarRestaurarSegmentos(); } catch (e) { if (window.console) console.warn('MES LION: trechos da programação', e); }
      return gravarAnterior.apply(this, arguments);
    };
    gravar.__mesSegmentos = true;
    window.saveLocal = gravar;
  }

  /* ---- 5b) Plano de Produção > "Projetar sequência pelas datas já informadas" (V2.3.16) encadeava as etapas de cada
     OP em tempo corrido (noites, sábados, domingos e feriados). Mesma regra — a partir da primeira data informada na
     OP, etapa após etapa na ordem do roteiro —, agora só em dias e horários de trabalho, respeitando os dias
     bloqueados ou liberados em "Editar dia" (da linha da operação) e as indisponibilidades de cada equipamento. */
  window.pcpProgramarV238 = function () {
    if (!temDados()) return;
    data.pcp_programacao = A(data.pcp_programacao);
    var porOP = {}, ordemOPs = [], pendentes = [], programadas = 0, comData = 0;
    data.pcp_programacao.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var k = String(p.OP || p.Demanda || '');
      if (!porOP[k]) { porOP[k] = []; ordemOPs.push(k); }
      porOP[k].push(p);
    });
    ordemOPs.forEach(function (op) {
      var todos = porOP[op].slice().sort(function (x, y) {
        return (Number(x.Ordem) || 0) - (Number(y.Ordem) || 0) || (Number(x.SequenciaRecurso) || 0) - (Number(y.SequenciaRecurso) || 0);
      });
      // operações já executadas (histórico, 5e) ficam como estão; as demais continuam depois delas
      var lista = todos.filter(function (p) { return !congelado(p); }), fimHistorico = null;
      todos.forEach(function (p) { var f = congelado(p) ? parse(p.Fim) : null; if (f && (!fimHistorico || f > fimHistorico)) fimHistorico = f; });
      if (!lista.length) return;
      var primeira = null;
      for (var i = 0; i < lista.length; i++) if (parse(lista[i].Inicio)) { primeira = lista[i]; break; }
      if (!primeira && !fimHistorico) return;
      comData++;
      var cursor = primeira ? parse(primeira.Inicio) : fimHistorico, parou = false;
      if (fimHistorico && cursor < fimHistorico) cursor = fimHistorico;
      lista.forEach(function (p, i) {
        if (parou) { pendentes.push(rotulo(p)); return; }
        if (i === 0 && parse(p.Inicio)) { cursor = parse(p.Inicio); if (fimHistorico && cursor < fimHistorico) cursor = fimHistorico; }
        var s = alocar(cursor, Math.max(1, minutosDo(p)), recursoDo(p), regraDoCartao(p), null);
        if (!s) { parou = true; pendentes.push(rotulo(p)); return; }
        p.Inicio = br(s.start);
        p.Fim = br(s.end);
        p.Segmentos = s.segments.map(function (g) { return { Inicio: br(g.start), Fim: br(g.end) }; });
        p.ConflitoPendente = 'PENDENTE_VALIDACAO';
        cursor = s.end;
        programadas++;
      });
    });
    saveLocal();
    if (pendentes.length) {
      alert('Sem janela de trabalho disponível para ' + pendentes.length + ' operação(ões) (dias bloqueados ou equipamento indisponível):\n- ' +
        pendentes.slice(0, 20).join('\n- ') + (pendentes.length > 20 ? '\n- ...' : ''));
    } else if (!comData) {
      alert('Nenhuma OP tem data informada. Informe o início da primeira etapa de uma OP (duplo clique no cartão) ou use "Sugerir programação por data inicial" no Calendário.');
    }
    if (typeof pcpCalendarioV2312 === 'function') pcpCalendarioV2312();
  };

  /* ---- 5c) "Validar conflitos" (V2.3.15) comparava Início–Fim corridos: com os trechos de trabalho acusava conflito
     falso (noite ou fim de semana dentro do intervalo) e não acusava operações em dia indisponível. Agora usa os
     trechos de cada cartão e marca também as operações que caem em dia indisponível (fim de semana, feriado ou dia
     bloqueado em "Editar dia", na linha da operação). */
  function trechosDoCartao(p) {
    var a = parse(p.Inicio), b = parse(p.Fim);
    if (!a || !b || b <= a) return null;
    if (Array.isArray(p.Segmentos) && p.Segmentos.length && segmentosCoerentes(p, p.Segmentos)) {
      return p.Segmentos.map(function (g) { return { start: parse(g.Inicio), end: parse(g.Fim) }; });
    }
    return [{ start: a, end: b }];
  }
  function diasDoTrecho(t) {
    var saida = [], d = new Date(t.start.getTime());
    d.setHours(0, 0, 0, 0);
    for (var k = 0; d < t.end && k < 1500; k++) {
      var amanha = new Date(d.getTime());
      amanha.setDate(amanha.getDate() + 1);
      var de = new Date(Math.max(t.start.getTime(), d.getTime())), ate = new Date(Math.min(t.end.getTime(), amanha.getTime()));
      if (de < ate) saida.push({ date: ymd(d), de: de, ate: ate });
      d = amanha;
    }
    return saida;
  }
  function sobrepoem(t1, t2) {
    for (var i = 0; i < t1.length; i++) for (var j = 0; j < t2.length; j++) if (t1[i].start < t2[j].end && t1[i].end > t2[j].start) return true;
    return false;
  }
  window.pcpValidarConflitosV2315 = function () {
    if (!temDados()) return;
    data.pcp_programacao = A(data.pcp_programacao);
    data.pcp_calendarios = A(data.pcp_calendarios);
    data.meta = data.meta || {};
    try { guardarRestaurarSegmentos(); } catch (e) { }
    var progs = data.pcp_programacao, avisos = [], porRecurso = {};
    var trechos = progs.map(function (p) { return p && typeof p === 'object' ? trechosDoCartao(p) : null; });
    progs.forEach(function (p) { if (p && typeof p === 'object') p.ConflitoPendente = ''; });
    progs.forEach(function (p, i) {
      var t = trechos[i];
      if (!t) return;
      var r = recursoDo(p), regra = regraDoCartao(p), diasRuins = [], vistos = {}, bloqueios = [];
      if (congelado(p)) { if (r) (porRecurso[r] = porRecurso[r] || []).push(i); return; }   // executada: é histórico, não programação
      t.forEach(function (g) {
        diasDoTrecho(g).forEach(function (dia) {
          var motivo = regra(dia.date);
          if (motivo && !vistos[dia.date]) { vistos[dia.date] = true; diasRuins.push(dma(dia.date) + ' (' + motivo + ')'); }
          if (r) restricoesRecurso(r, dia.date).forEach(function (x) {
            if (dia.de < x.end && dia.ate > x.start) bloqueios.push(dma(dia.date) + ' ' + hm(x.start) + '–' + hm(x.end) + (x.x.Motivo ? ' (' + x.x.Motivo + ')' : ''));
          });
        });
      });
      if (diasRuins.length) {
        avisos.push(rotulo(p) + ': programada em dia indisponível — ' + diasRuins.join(', '));
        p.ConflitoPendente = 'INDISPONIBILIDADE';
      }
      if (bloqueios.length) {
        avisos.push(rotulo(p) + ': equipamento ' + r + ' indisponível em ' + bloqueios.filter(function (v, n, a) { return a.indexOf(v) === n; }).join(', '));
        p.ConflitoPendente = 'INDISPONIBILIDADE';
      }
      if (r) (porRecurso[r] = porRecurso[r] || []).push(i);
    });
    Object.keys(porRecurso).forEach(function (r) {
      var idx = porRecurso[r];
      for (var x = 0; x < idx.length; x++) {
        for (var y = x + 1; y < idx.length; y++) {
          var p = progs[idx[x]], q = progs[idx[y]];
          if (congelado(p) && congelado(q)) continue;
          if (sobrepoem(trechos[idx[x]], trechos[idx[y]])) {
            avisos.push('Equipamento ' + r + ': conflito entre ' + rotulo(p) + (congelado(p) ? ' (executada)' : '') + ' e ' + rotulo(q) + (congelado(q) ? ' (executada)' : ''));
            if (!congelado(p)) p.ConflitoPendente = 'CONFLITO';
            if (!congelado(q)) q.ConflitoPendente = 'CONFLITO';
          }
        }
      }
    });
    saveLocal();
    alert(avisos.length ? 'Conflitos encontrados (' + avisos.length + '):\n\n- ' + avisos.slice(0, 40).join('\n- ') + (avisos.length > 40 ? '\n- ... e mais ' + (avisos.length - 40) : '')
      : 'Programação validada: nenhum conflito de recurso/indisponibilidade encontrado.');
    if (typeof pcpCalendarioV2312 === 'function') pcpCalendarioV2312();
  };

  /* ---- 5d) Programação > "Recalcular programação" (rotina da V2.3.5) dependia das demandas antigas do MRP (dava erro
     ao clicar) e programava em tempo corrido. Abre o Calendário com a mesma "Sugestão de programação" do botão
     "Sugerir programação por data inicial". */
  window.pcpProgramarV235 = function () {
    try { if (typeof render === 'function') render('pcp_calendario'); } catch (e) { if (window.console) console.warn('MES LION: calendário', e); }
    if (typeof window.mesAbrirProjecao === 'function') window.mesAbrirProjecao();
  };

  /* ---- 5e) Histórico da programação. O calendário (V2.3.17) monta os cartões só das OPs abertas: quando a OP era
     concluída os cartões sumiam e a programação feita se perdia. Agora cada operação com apontamento (tempo iniciado
     ou finalizado, produção registrada) ou de OP concluída fica guardada em data.pcp_historico e continua no
     calendário, congelada em cinza (não arrasta nem edita), no dia e horário reais dos apontamentos de tempo — ou no
     dia do apontamento de produção (expediente do dia), quando não há horário, ou no horário programado, quando a OP
     foi concluída sem apontamento. O histórico guarda também o horário que estava programado antes da execução. */
  var SIT_EXEC = 'EXECUTADA', SIT_ANDAMENTO = 'EM EXECUÇÃO', SIT_CONCLUIDA = 'CONCLUÍDA';
  var CAMPOS_CARTAO = ['OP', 'Demanda', 'Tipo', 'Produto', 'Roteiro', 'Ordem', 'SequenciaRecurso', 'Processo', 'Recurso', 'RecursoRoteiro',
    'IdRecursoRoteiro', 'Equipamento', 'Minutos', 'TipoCelula', 'Escala', 'DataNecessidade', 'OrigemRecurso'];
  function numero(v) { return typeof num === 'function' ? num(v) : (Number(String(v == null ? '' : v).replace(',', '.')) || 0); }
  function congelado(p) { return !!p && typeof p === 'object' && p.Congelado === 'Sim'; }
  function opDoCodigo(c) {
    var cod = String(c || '');
    return A(temDados() ? data.op : []).find(function (o) { return o && String(o.CodOP || '') === cod; }) || {};
  }
  function opConcluida(op) { var s = String(op && op.Status || '').toUpperCase(); return s.indexOf('CONCLU') >= 0 || s.indexOf('ENCERR') >= 0; }
  function opCancelada(op) { return /cancel|exclu|anulad/i.test(String(op && op.Status || '')); }
  function diaDe(x) {
    var s = String(x || '').trim(), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function horaDe(x) { var m = String(x || '').match(/^(\d{1,2}):(\d{2})/); return m ? [+m[1], +m[2]] : null; }
  function mesmoProcesso(a, b) { var x = norm(a), y = norm(b); return !x || !y || x === y; }
  function etapaConcluida(p, etapasDaOP) {
    return (etapasDaOP || []).some(function (e) {
      return numero(e.Ordem) === numero(p.Ordem) && (!e.CodEquipamento || String(e.CodEquipamento) === recursoDo(p)) &&
        /CONCLU|FINALIZ|ENCERR|EXECUTAD/i.test(String(e.Status || ''));
    });
  }
  function indices() {
    var porOP = function (lista) { var m = {}; A(lista).forEach(function (x) { if (x && x.CodOP) (m[String(x.CodOP)] = m[String(x.CodOP)] || []).push(x); }); return m; };
    return { tempos: porOP(data.apontamento_tempos), producao: porOP(data.producao), etapas: porOP(data.op_etapas) };
  }
  /* situação de execução de um cartão: null = ainda não executado */
  function execucaoDoCartao(p, agora, ix) {
    var op = opDoCodigo(p.OP);
    if (opCancelada(op)) return null;
    var cod = String(p.OP || '');
    var sessoes = (ix.tempos[cod] || []).filter(function (a) { return mesmoProcesso(a.Processo, p.Processo); });
    var prods = (ix.producao[cod] || []).filter(function (x) { return mesmoProcesso(x.Processo, p.Processo); });
    var trechos = [], andamento = false, fonte = '';
    sessoes.forEach(function (a) {
      var dia = diaDe(a.DataApontamento), hi = horaDe(a.HoraInicio), hf = horaDe(a.HoraFim);
      if (!dia || !hi) return;
      var ini = new Date(dia.getTime()), fim;
      ini.setHours(hi[0], hi[1], 0, 0);
      if (hf) {
        fim = new Date(dia.getTime());
        fim.setHours(hf[0], hf[1], 0, 0);
        if (fim <= ini) fim.setDate(fim.getDate() + 1);
      } else if (String(a.Status || '') === 'Iniciado') {
        andamento = true;
        fim = new Date(Math.max(agora.getTime(), ini.getTime() + 60000));
      } else fim = new Date(ini.getTime() + 60000);
      trechos.push({ start: ini, end: fim });
    });
    if (trechos.length) fonte = 'apontamento de tempo';
    else if (prods.length) {
      var vistos = {};
      prods.forEach(function (x) {
        var dia = diaDe(x.DataApontamento);
        if (!dia) return;
        var k = ymd(dia);
        if (vistos[k]) return;
        vistos[k] = true;
        // sem horário: o dia todo de expediente do calendário padrão (08:00–12:00 e 13:00–17:00)
        trechos.push({ start: new Date(k + 'T08:00'), end: new Date(k + 'T12:00') });
        trechos.push({ start: new Date(k + 'T13:00'), end: new Date(k + 'T17:00') });
      });
      if (trechos.length) fonte = 'apontamento de produção (dia, sem horário)';
    }
    var detalhes = sessoes.map(function (a) {
      return { Tipo: 'tempo', Data: a.DataApontamento || '', HoraInicio: a.HoraInicio || '', HoraFim: a.HoraFim || '', Operador: a.Operador || '', Status: a.Status || '' };
    }).concat(prods.map(function (x) {
      return { Tipo: 'produção', Data: x.DataApontamento || '', Quantidade: x['Quantidade produzida'] || x.QuantidadeProduzida || '', Operador: x.Operador || '' };
    }));
    if (!trechos.length) {
      if (!(opConcluida(op) || etapaConcluida(p, ix.etapas[cod]))) return null;
      var a0 = parse(p.Inicio), b0 = parse(p.Fim);
      if (!a0 || !b0 || b0 <= a0) return null;
      return { situacao: SIT_CONCLUIDA, fonte: 'programação (OP concluída sem apontamento de horário)', inicio: p.Inicio, fim: p.Fim,
        segmentos: Array.isArray(p.Segmentos) && segmentosCoerentes(p, p.Segmentos) ? p.Segmentos : [], apontamentos: detalhes };
    }
    trechos.sort(function (x, y) { return x.start - y.start; });
    var juntos = [];
    trechos.forEach(function (t) {
      var u = juntos[juntos.length - 1];
      if (u && t.start <= u.end) { if (t.end > u.end) u.end = t.end; } else juntos.push({ start: t.start, end: t.end });
    });
    return { situacao: andamento ? SIT_ANDAMENTO : SIT_EXEC, fonte: fonte, inicio: br(juntos[0].start), fim: br(juntos[juntos.length - 1].end),
      segmentos: juntos.map(function (t) { return { Inicio: br(t.start), Fim: br(t.end) }; }), apontamentos: detalhes };
  }
  function nomeRecurso(c) {
    var r = A(data.recursos).concat(A(data.cad_recursos)).find(function (x) { return x && String(x.CodEquipamento || x['Código Equipamento'] || x.Codigo || '') === String(c); }) || {};
    return r.Equipamento || r.Descricao || c || '';
  }
  /* cartões de uma OP, montados como o calendário V2.3.17 monta os das OPs abertas (para OPs já concluídas) */
  function cartoesDaOP(op, etapasDaOP) {
    var oes = (etapasDaOP || []).slice().sort(function (a, b) { return numero(a.Ordem) - numero(b.Ordem) || numero(a.SequenciaRecurso) - numero(b.SequenciaRecurso); });
    if (!oes.length && op.CodRoteiro) {
      A(data.roteiro_etapas).filter(function (e) { return String(e.CodRoteiro) === String(op.CodRoteiro); })
        .sort(function (a, b) { return numero(a.Ordem) - numero(b.Ordem); }).forEach(function (e) {
          var rr = A(data.roteiro_recursos).filter(function (x) { return String(x.CodRoteiro) === String(op.CodRoteiro) && String(x.OrdemEtapa || x.Ordem) === String(e.Ordem); });
          if (rr.length) rr.forEach(function (r, i) {
            oes.push(Object.assign({}, e, { CodOP: op.CodOP, IdRecursoRoteiro: r.IdRecursoRoteiro || '', CodEquipamento: r.CodEquipamento || '', Equipamento: r.Equipamento || '',
              Recurso: r.Equipamento || '', TempoOperacaoMin: r.TempoOperacaoMin || e.TempoOperacaoMin, SequenciaRecurso: i + 1 }));
          });
          else oes.push(Object.assign({}, e, { CodOP: op.CodOP, SequenciaRecurso: 1 }));
        });
    }
    var rt = A(data.roteiro).find(function (r) { return String(r.CodRoteiro) === String(op.CodRoteiro); }) || {}, vistos = {}, saida = [];
    oes.forEach(function (e, i) {
      var rec = e.CodEquipamento || '', rid = e.IdRecursoRoteiro || '';
      if (!rec && rid) { var rr = A(data.roteiro_recursos).find(function (x) { return String(x.IdRecursoRoteiro) === String(rid); }); if (rr) rec = rr.CodEquipamento || ''; }
      var prod = e.ProdutoGerado || e.CodigoPI || e.CodigoProduto || op.CodigoPI || op.CodigoProduto || op.Produto || '';
      var c = { OP: op.CodOP, Demanda: op.CodOP, Tipo: op.TipoOP || '', Produto: prod, Roteiro: op.CodRoteiro || '', Ordem: numero(e.Ordem),
        SequenciaRecurso: numero(e.SequenciaRecurso) || i + 1, Processo: e.Processo || '', Recurso: String(rec), RecursoRoteiro: String(rec), IdRecursoRoteiro: rid,
        Equipamento: e.Equipamento || e.Recurso || nomeRecurso(rec), Minutos: Math.max(1, numero(e.TempoPlanejado || e.TempoOperacaoMin) || 1),
        TipoCelula: rt.Tipo || op.TipoCelula || '', Escala: rt.EscalaProducao || op.EscalaProducao || op.Escala || rt.Escala || '', DataNecessidade: op.DataNecessidade || '',
        OrigemRecurso: rec ? 'OP_ESPELHO_ROTEIRO' : 'PENDENCIA_ROTEIRO' };
      var k = [c.OP, c.Roteiro, c.Ordem, c.Recurso || c.IdRecursoRoteiro, c.Produto].join('|');
      if (!vistos[k]) { vistos[k] = true; saida.push(c); }
    });
    return saida;
  }
  function atualizarHistorico() {
    if (!temDados()) return;
    data.pcp_programacao = A(data.pcp_programacao);
    data.pcp_historico = A(data.pcp_historico);
    var hist = data.pcp_historico, agora = new Date(), carimbo = agora.toLocaleString('pt-BR'), ix = indices(), porChave = {}, presentes = {};
    hist.forEach(function (h) { if (h && h.Chave) porChave[h.Chave] = h; });
    function registrar(p, ex) {
      var k = chaveCartao(p), h = porChave[k];
      if (!h) {
        h = { Chave: k };
        CAMPOS_CARTAO.forEach(function (c) { if (p[c] !== undefined) h[c] = p[c]; });
        var planejado = !congelado(p);
        h.InicioPlanejado = planejado ? (p.Inicio || '') : '';
        h.FimPlanejado = planejado ? (p.Fim || '') : '';
        h.SegmentosPlanejados = planejado && Array.isArray(p.Segmentos) ? p.Segmentos : [];
        h.CongeladoEm = carimbo;
        hist.push(h);
        porChave[k] = h;
      }
      var segs = ex.segmentos || [];
      if (h.Inicio !== ex.inicio || h.Fim !== ex.fim || h.Situacao !== ex.situacao || JSON.stringify(h.Segmentos || []) !== JSON.stringify(segs) ||
          JSON.stringify(h.Apontamentos || []) !== JSON.stringify(ex.apontamentos || [])) {
        h.Inicio = ex.inicio; h.Fim = ex.fim; h.Segmentos = segs; h.Situacao = ex.situacao; h.FonteHorario = ex.fonte;
        h.Apontamentos = ex.apontamentos || []; h.AtualizadoEm = carimbo;
      }
      return h;
    }
    function aplicar(p, h) {
      p.Inicio = h.Inicio;
      p.Fim = h.Fim;
      if (Array.isArray(h.Segmentos) && h.Segmentos.length) p.Segmentos = h.Segmentos; else if ('Segmentos' in p) delete p.Segmentos;
      p.Congelado = 'Sim';
      p.SituacaoExecucao = h.Situacao || SIT_EXEC;
      p.FonteHorario = h.FonteHorario || '';
      p.ConflitoPendente = '';
    }
    // 1) operações da programação atual que já foram apontadas (ou cuja OP foi concluída)
    data.pcp_programacao.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var k = chaveCartao(p), h = porChave[k], ex = execucaoDoCartao(p, agora, ix);
      presentes[k] = true;
      if (ex) aplicar(p, registrar(p, ex));
      else if (h && h.Inicio && h.Fim) aplicar(p, h);
      else if (congelado(p)) { delete p.Congelado; delete p.SituacaoExecucao; delete p.FonteHorario; }
    });
    // 2) OPs concluídas, que o calendário já não monta: o histórico vem dos apontamentos
    A(data.op).forEach(function (op) {
      if (!op || !op.CodOP || !opConcluida(op)) return;
      cartoesDaOP(op, ix.etapas[String(op.CodOP)]).forEach(function (p) {
        var k = chaveCartao(p);
        if (presentes[k]) return;
        var h = porChave[k], base = h ? Object.assign({}, p, { Inicio: h.Inicio, Fim: h.Fim, Segmentos: h.Segmentos, Congelado: 'Sim' }) : p;
        var ex = execucaoDoCartao(base, agora, ix);
        if (ex) registrar(p, ex);
      });
    });
    // 3) devolve à programação as operações congeladas que a montagem do calendário deixou de fora
    hist.forEach(function (h) {
      if (!h || !h.Chave || presentes[h.Chave] || !h.Inicio || !h.Fim) return;
      var p = {};
      CAMPOS_CARTAO.forEach(function (c) { if (h[c] !== undefined) p[c] = h[c]; });
      aplicar(p, h);
      data.pcp_programacao.push(p);
      presentes[h.Chave] = true;
    });
  }
  window.mesAtualizarHistoricoPcp = atualizarHistorico;
  function historicoDe(p) {
    var k = chaveCartao(p);
    return A(temDados() ? data.pcp_historico : []).find(function (h) { return h && h.Chave === k; }) || null;
  }
  function descricaoExecucao(p) {
    var h = historicoDe(p) || {}, linhas = [rotulo(p) + ' — equipamento ' + (recursoDo(p) || '?') + (p.Equipamento ? ' ' + p.Equipamento : ''),
      'Situação: ' + (p.SituacaoExecucao || SIT_EXEC) + (p.FonteHorario ? ' (' + p.FonteHorario + ')' : '')];
    if (h.InicioPlanejado) linhas.push('Programado: ' + h.InicioPlanejado + ' → ' + h.FimPlanejado);
    linhas.push('Executado: ' + (p.Inicio || '?') + ' → ' + (p.Fim || '?'));
    A(h.Apontamentos).slice(0, 12).forEach(function (a) {
      linhas.push(a.Tipo === 'produção' ? '  • produção apontada em ' + a.Data + (a.Quantidade ? ' (' + a.Quantidade + ')' : '') + (a.Operador ? ' — ' + a.Operador : '')
        : '  • ' + a.Data + ' ' + a.HoraInicio + '–' + (a.HoraFim || 'em andamento') + (a.Operador ? ' — ' + a.Operador : ''));
    });
    linhas.push('', 'Operação executada: fica no histórico da programação e não pode ser arrastada nem editada.');
    return linhas.join('\n');
  }
  function garantirEstiloHistorico() {
    if (document.getElementById('mes-historico-style')) return;
    var st = document.createElement('style');
    st.id = 'mes-historico-style';
    st.textContent = '.pcp-card-v2317.mes-congelado{filter:grayscale(1)!important;opacity:.8;cursor:help!important;border-style:dashed!important}' +
      '.pcp-card-v2317.mes-congelado .mes-exec-badge{display:block;font-style:normal;font-size:8px;font-weight:800;letter-spacing:.03em;color:#2f3a44;background:#dfe3e8;border-radius:4px;padding:1px 4px;margin-top:3px}' +
      '.pcp-card-v2317.mes-congelado.mes-andamento{opacity:.92}';
    document.head.appendChild(st);
  }
  function marcarCongelados() {
    if (!temDados()) return;
    garantirEstiloHistorico();
    var cartoes = document.querySelectorAll('.pcp-card-v2317[ondragstart]');
    for (var i = 0; i < cartoes.length; i++) {
      var el = cartoes[i], m = String(el.getAttribute('ondragstart') || '').match(/pcpDragV2317\(event,\s*(\d+)\)/);
      var p = m ? A(data.pcp_programacao)[+m[1]] : null;
      if (!congelado(p)) continue;
      el.classList.add('mes-congelado');
      if (p.SituacaoExecucao === SIT_ANDAMENTO) el.classList.add('mes-andamento');
      el.setAttribute('draggable', 'false');
      el.removeAttribute('ondragstart');
      el.setAttribute('data-congelado', m[1]);
      el.title = descricaoExecucao(p);
      if (!el.querySelector('.mes-exec-badge')) {
        var b = document.createElement('em');
        b.className = 'mes-exec-badge';
        b.textContent = (p.SituacaoExecucao || SIT_EXEC) + (p.FonteHorario && p.FonteHorario.indexOf('sem horário') >= 0 ? ' · sem horário' : '');
        el.appendChild(b);
      }
    }
  }
  window.mesMarcarCongeladosPcp = marcarCongelados;
  var calendarioAnterior = window.pcpCalendarioV2312;
  if (typeof calendarioAnterior === 'function' && !calendarioAnterior.__mesHistorico) {
    var calendario = function () {
      var r = calendarioAnterior.apply(this, arguments);
      try { marcarCongelados(); } catch (e) { if (window.console) console.warn('MES LION: histórico do calendário', e); }
      return r;
    };
    calendario.__mesHistorico = true;
    window.pcpCalendarioV2312 = calendario;
  }
  var editorAnterior = window.pcpEditarIntervaloV237;
  if (typeof editorAnterior === 'function') {
    window.pcpEditarIntervaloV237 = function (idx) {
      var p = A(temDados() ? data.pcp_programacao : [])[idx];
      if (congelado(p)) { alert(descricaoExecucao(p)); return; }
      return editorAnterior.apply(this, arguments);
    };
  }
  /* "Limpar datas" (V2.3.15): limpa só a programação; as operações executadas (histórico) ficam */
  window.pcpLimparDatasV2315 = function (id) {
    if (!temDados()) return;
    data.pcp_programacao = A(data.pcp_programacao);
    var rows = data.pcp_programacao.filter(function (p) { return p && !congelado(p) && (!id || p.Demanda === id); });
    if (!rows.length) return alert('Não há operações programadas para limpar.');
    var hist = data.pcp_programacao.filter(congelado).length;
    if (!confirm('Limpar início/fim de ' + rows.length + ' operação(ões)? Os cartões continuarão vinculados aos equipamentos do roteiro.' +
      (hist ? '\n\nAs ' + hist + ' operação(ões) já executadas (em cinza) ficam no histórico.' : ''))) return;
    rows.forEach(function (p) { p.Inicio = ''; p.Fim = ''; p.Prazo = ''; p.ConflitoPendente = ''; if ('Segmentos' in p) delete p.Segmentos; });
    saveLocal();
    if (typeof pcpCalendarioV2312 === 'function') pcpCalendarioV2312();
  };
})();

/* ---------------------------------------------------------------------
   6) CARGA × CAPACIDADE (js/mes_capacidade_carga_v1.js). A carga lia as datas da programação só no formato
   "dd/mm/aaaa hh:mm", mas o PCP grava "dd/mm/aaaa, hh:mm" (com vírgula, como o navegador escreve em português): a data
   não era reconhecida e caía na leitura americana do navegador — dias 13 a 31 ficavam de fora (carga zero) e dias
   1 a 12 eram contados com dia e mês trocados (10/11 virava 11/10). Mesmo cálculo e mesma tela do módulo, com a data
   lida corretamente; os trechos de trabalho (Segmentos) da programação continuam sendo usados quando existem.
   --------------------------------------------------------------------- */
(function () {
  'use strict';
  if (typeof window.mesCapCalcular !== 'function') return;
  var A = function (x) { return Array.isArray(x) ? x : []; };
  function $(id) { return document.getElementById(id); }
  function E(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function N(x) { var n = Number(String(x == null ? '' : x).replace(',', '.')); return isFinite(n) ? n : 0; }
  function codigo(r) { return String(r['Código Equipamento'] || r.CodEquipamento || r.Codigo || '').trim(); }
  function fmt(x) { return Number(x).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function dataHora(x) {
    if (!x) return null;
    var m = String(x).match(/^(\d{2})\/(\d{2})\/(\d{4})\D+(\d{2}):(\d{2})/);
    var d = m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : new Date(String(x));
    return isNaN(d) ? null : d;
  }
  function dias(a, b) {
    var o = [];
    for (var d = new Date(a + 'T12:00:00'); d <= new Date(b + 'T12:00:00') && o.length < 370; d.setDate(d.getDate() + 1)) o.push(new Date(d));
    return o;
  }
  function util(d) { return d.getDay() !== 0 && d.getDay() !== 6; }
  function horasProgramadas(c, ini, fim) {
    var total = 0, lo = new Date(ini + 'T00:00:00'), hi = new Date(fim + 'T23:59:59');
    data.pcp_programacao.forEach(function (p) {
      if (!p || String(p.RecursoRoteiro || p.Recurso || p.CodEquipamento || '') !== c) return;
      var segs = A(p.Segmentos);
      if (!segs.length) segs = [{ Inicio: p.Inicio, Fim: p.Fim }];
      segs.forEach(function (s) {
        var a = dataHora(s && s.Inicio), b = dataHora(s && s.Fim);
        if (!a || !b || b <= a) return;
        total += Math.max(0, Math.min(b, hi) - Math.max(a, lo)) / 3600000;
      });
    });
    return total;
  }
  function relatorio(ini, fim) {
    data.mes_capacidades = A(data.mes_capacidades);
    data.mes_capacidade_historico = A(data.mes_capacidade_historico);
    data.pcp_programacao = A(data.pcp_programacao);
    data.pcp_calendarios = A(data.pcp_calendarios);
    var uteis = dias(ini, fim).filter(util).length;
    return A(data.cad_recursos).filter(function (r) { return r && codigo(r); }).map(function (r) {
      var c = codigo(r), p = data.mes_capacidades.find(function (x) { return x && x.Codigo === c; });
      var nom = p ? uteis * N(p.HorasDia) : 0, ef = nom * (p ? N(p.Eficiencia) / 100 : 0), carga = horasProgramadas(c, ini, fim);
      return { Codigo: c, Equipamento: r.Equipamento || r.Descricao || '', Escala: r.Escala || '', HorasNominais: nom, HorasEfetivas: ef, Carga: carga,
        Saldo: ef - carga, Ocupacao: ef > 0 ? 100 * carga / ef : null, Configurado: !!p };
    });
  }
  window.mesCapCalcular = function () {
    var a = $('mcInicio') && $('mcInicio').value, b = $('mcFim') && $('mcFim').value;
    if (!a || !b || a > b || dias(a, b).length > 366) return alert('Selecione um período válido de até 366 dias.');
    var r = relatorio(a, b);
    window.__mesCapReport = r;
    var linhas = r.map(function (x) {
      return '<tr><td>' + E(x.Codigo) + '</td><td>' + E(x.Equipamento) + '</td><td>' + E(x.Escala) + '</td><td>' + (x.Configurado ? fmt(x.HorasNominais) : '—') +
        '</td><td>' + (x.Configurado ? fmt(x.HorasEfetivas) : 'Não cadastrada') + '</td><td>' + fmt(x.Carga) + '</td><td>' + (x.Configurado ? fmt(x.Saldo) : '—') +
        '</td><td>' + (x.Ocupacao === null ? '—' : fmt(x.Ocupacao) + '%') + '</td><td>' +
        (x.Ocupacao === null ? 'Sem parâmetros' : x.Ocupacao > 100 ? 'Sobrecarga' : x.Ocupacao > 85 ? 'Atenção' : 'OK') + '</td></tr>';
    }).join('');
    var caixa = $('mesCapResultado');
    if (caixa) caixa.innerHTML = '<div style="overflow:auto"><table><thead><tr><th>Código</th><th>Equipamento</th><th>Escala</th><th>Horas nominais</th>' +
      '<th>Horas efetivas</th><th>Carga (h)</th><th>Saldo (h)</th><th>Ocupação</th><th>Situação</th></tr></thead><tbody>' + linhas + '</tbody></table></div>';
  };
})();

/* ---------------------------------------------------------------------
   7) MRP > "Abrir OPs" (V2.3.16/V2.3.17) chamava render('ops'), uma tela que não existe: abria um cadastro vazio
   chamado "ops". A tela de Ordens de Produção é render('op').
   --------------------------------------------------------------------- */
(function () {
  'use strict';
  var renderAnterior = window.render;
  if (typeof renderAnterior !== 'function') return;
  window.render = function (k) {
    if (k === 'ops') {
      var args = Array.prototype.slice.call(arguments);
      args[0] = 'op';
      return renderAnterior.apply(this, args);
    }
    return renderAnterior.apply(this, arguments);
  };
})();
