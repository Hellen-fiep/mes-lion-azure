/* =====================================================================
   MES LION — ADAPTADOR DE PLATAFORMA MICROSOFT (ASP.NET Core / SQL Server / Azure)
   Carregado por último em index.html. NÃO altera regras de cálculo, telas ou dados:
   1) troca textos que citavam PostgreSQL/PGSQL pelo nome da nova plataforma;
   2) mostra na tela de login qual servidor/banco está ativo (apoio à validação);
   3) quando o Azure App Service tem login Microsoft Entra ID habilitado, exibe o botão
      "Entrar com Microsoft" e faz o logout também na Microsoft;
   4) em acesso remoto (rede/Azure), compacta (gzip) o envio assíncrono do estado do MES,
      reduzindo o tráfego de ~30 MB para ~2 MB por gravação. Em caso de qualquer falha,
      o envio volta automaticamente ao formato original.
   ===================================================================== */
(function () {
  'use strict';
  var NOME_PLATAFORMA = 'MES LION 1.0 AZURE';
  var cfg = null;
  var compressaoDesligada = false;

  function el(id) { return document.getElementById(id); }

  function textoPlataforma(t) {
    if (!t) return t;
    return String(t)
      .replace(/MES LION 1\.0 PGSQL/g, NOME_PLATAFORMA)
      .replace(/Usuários PostgreSQL/g, 'Usuários do MES (SQL Server)')
      .replace(/ — PostgreSQL \/ Multiusuário/g, ' — SQL Server / Multiusuário');
  }

  function ajustarTitulos() {
    try {
      var novo = textoPlataforma(document.title);
      if (/MES LION V2\.2\.1/.test(novo)) novo = NOME_PLATAFORMA + ' — SQL Server / Multiusuário';
      if (novo !== document.title) document.title = novo;
      var sub = el('subtitle');
      if (sub) { var s = textoPlataforma(sub.textContent); if (s !== sub.textContent) sub.textContent = s; }
    } catch (e) { }
  }

  // Subtítulos são redefinidos a cada tela: observa e ajusta somente os textos de plataforma.
  function observarSubtitulo() {
    var sub = el('subtitle');
    if (!sub || !window.MutationObserver) return;
    new MutationObserver(function () {
      var s = textoPlataforma(sub.textContent);
      if (s !== sub.textContent) sub.textContent = s;
    }).observe(sub, { childList: true, characterData: true, subtree: true });
  }

  function infoLogin() {
    var card = document.querySelector('#login .login-card');
    if (!card || !cfg || el('mesPlataformaInfo')) return;
    var p = document.createElement('small');
    p.id = 'mesPlataformaInfo';
    p.style.cssText = 'display:block;margin-top:6px;opacity:.75;font-size:11px;line-height:1.4';
    p.textContent = 'Servidor: ' + (cfg.plataforma || 'ASP.NET Core') + ' · Banco: ' + (cfg.bancoDescricao || cfg.banco || '');
    card.appendChild(p);
    if (cfg.entraId && cfg.entraId.habilitado && !el('mesEntraLogin')) {
      var b = document.createElement('button');
      b.id = 'mesEntraLogin';
      b.type = 'button';
      b.textContent = 'Entrar com Microsoft';
      b.style.cssText = 'margin-top:8px;background:#2f2f2f;color:#fff';
      b.onclick = function () { location.href = cfg.entraId.loginUrl; };
      var msg = el('loginMsg');
      card.insertBefore(b, msg || null);
    }
  }

  function carregarConfig() {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', '/api/auth/config', true);
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        if (x.status === 200) { try { cfg = JSON.parse(x.responseText); } catch (e) { cfg = null; } }
        infoLogin();
      };
      x.send(null);
    } catch (e) { }
  }

  // Logout: em sessões Microsoft Entra ID, encerra também a sessão do Azure App Service.
  var logoutOriginal = window.logout;
  window.logout = function () {
    var entra = window.MES_CURRENT_USER && window.MES_CURRENT_USER.provedor === 'ENTRA' && cfg && cfg.entraId && cfg.entraId.habilitado;
    if (!entra) return logoutOriginal.apply(this, arguments);
    try { var x = new XMLHttpRequest(); x.open('POST', '/api/auth/logout', false); x.send(null); } catch (e) { }
    location.href = cfg.entraId.logoutUrl;
  };

  // ------------------------------------------------------------------ compactação do envio do estado
  function acessoRemoto() {
    var h = location.hostname;
    return !(h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]');
  }
  function podeCompactar() {
    return !compressaoDesligada && cfg && cfg.compressaoUpload && acessoRemoto() &&
      typeof window.CompressionStream === 'function' && typeof window.TextEncoder === 'function' && typeof window.Response === 'function';
  }
  function gzip(texto) {
    var cs = new CompressionStream('gzip');
    var w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(texto));
    w.close();
    return new Response(cs.readable).arrayBuffer();
  }
  var abrir = XMLHttpRequest.prototype.open;
  var enviar = XMLHttpRequest.prototype.send;
  var cabecalho = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (metodo, url, assincrono) {
    this.__mesReq = { metodo: String(metodo || '').toUpperCase(), url: String(url || ''), assincrono: assincrono !== false };
    return abrir.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (corpo) {
    var r = this.__mesReq;
    if (r && r.assincrono && r.metodo === 'PUT' && /\/api\/storage\/MES_LION_DATA$/.test(r.url) &&
        typeof corpo === 'string' && corpo.length > 32768 && podeCompactar()) {
      var xhr = this;
      xhr.addEventListener('loadend', function () { if (xhr.status < 200 || xhr.status >= 300) compressaoDesligada = true; });
      gzip(corpo).then(function (buf) {
        try { cabecalho.call(xhr, 'Content-Encoding', 'gzip'); enviar.call(xhr, buf); }
        catch (e) { compressaoDesligada = true; try { enviar.call(xhr, corpo); } catch (e2) { } }
      }, function () { compressaoDesligada = true; enviar.call(xhr, corpo); });
      return;
    }
    return enviar.apply(this, arguments);
  };

  ajustarTitulos();
  observarSubtitulo();
  carregarConfig();
  window.MES_PLATAFORMA = { nome: NOME_PLATAFORMA, config: function () { return cfg; } };
})();
