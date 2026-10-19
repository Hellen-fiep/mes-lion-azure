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
        "Sugestão de programação" do Calendário.
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
      var lista = porOP[op].slice().sort(function (x, y) {
        return (Number(x.Ordem) || 0) - (Number(y.Ordem) || 0) || (Number(x.SequenciaRecurso) || 0) - (Number(y.SequenciaRecurso) || 0);
      });
      var primeira = null;
      for (var i = 0; i < lista.length; i++) if (parse(lista[i].Inicio)) { primeira = lista[i]; break; }
      if (!primeira) return;
      comData++;
      var cursor = parse(primeira.Inicio), parou = false;
      lista.forEach(function (p, i) {
        if (parou) { pendentes.push(rotulo(p)); return; }
        if (i === 0 && parse(p.Inicio)) cursor = parse(p.Inicio);
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
          if (sobrepoem(trechos[idx[x]], trechos[idx[y]])) {
            var p = progs[idx[x]], q = progs[idx[y]];
            avisos.push('Equipamento ' + r + ': conflito entre ' + rotulo(p) + ' e ' + rotulo(q));
            p.ConflitoPendente = q.ConflitoPendente = 'CONFLITO';
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
})();
