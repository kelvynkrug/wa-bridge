/**
 * wa-bridge · painel — HTML+CSS+JS vanilla, sem build e sem CDN, SVG à mão.
 * Modo mock: abra com ?mock=1 (dados completos), ?mock=empty, ?mock=error,
 * ?mock=pairing ou ?mock=close para exercitar cada estado sem o daemon rodando.
 * Identidade da instância no mock: &label=Trabalho&color=%23F7B00D.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'wa-bridge-token';
  // Servido pelo próprio daemon, o painel fala com a origem que o serviu: com mais de
  // uma instância (uma porta por número), cada painel enxerga só o seu daemon. A porta
  // fixa fica só para quando o arquivo é aberto direto do disco (file://).
  var DEFAULT_BASE = /^https?:$/.test(location.protocol)
    ? location.origin
    : 'http://127.0.0.1:7788';

  var WINDOWS = [3600000, 86400000, 604800000, 2592000000];
  var REFRESH_MS = 10000;

  var qs = new URLSearchParams(location.search);
  var MOCK = qs.has('mock') ? (qs.get('mock') || '1') : null;

  var state = {
    windowMs: 86400000,
    paused: false,
    lastUpdated: null,
    inFlight: false
  };

  var els = {}; // cache de nós DOM, preenchido em init()

  // ---------------------------------------------------------------- utils

  /** Formata ms em string curta (ex: "180ms", "2.4s"). */
  function fmtMs(ms) {
    if (ms == null || isNaN(ms)) return '—';
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  /** Tempo relativo em pt-BR a partir de um epoch ms. */
  function relTime(ts) {
    if (!ts) return '—';
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    var s = Math.floor(diff / 1000);
    if (s < 5) return 'agora';
    if (s < 60) return 'há ' + s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return 'há ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'há ' + h + (h === 1 ? ' hora' : ' horas');
    var d = Math.floor(h / 24);
    return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  }

  /** Data/hora curta em pt-BR, formato varia conforme a janela selecionada. */
  function fmtAxisTs(ts, windowMs) {
    var d = new Date(ts);
    if (windowMs <= 86400000) {
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  function fmtDateTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }

  function fmtHour(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /**
   * Mascara um JID para nunca expor o número completo na tela.
   * Grupos mostram só um sufixo opaco; números mostram início/fim com meio oculto.
   */
  function maskJid(jid) {
    if (!jid) return '—';
    var parts = jid.split('@');
    var user = parts[0] || '';
    var domain = parts[1] || '';
    if (domain === 'g.us') {
      return 'grupo·' + user.slice(-4);
    }
    if (domain === 'broadcast' || domain === 'newsletter') {
      return 'lista·' + user.slice(-4);
    }
    var digits = user.replace(/\D/g, '');
    if (digits.length <= 6) return '•'.repeat(digits.length || 4);
    return digits.slice(0, 4) + '•'.repeat(Math.max(2, digits.length - 8)) + digits.slice(-4);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
  }

  // ------------------------------------------------------------------ auth

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignora: storage indisponível */ }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignora */ }
  }

  function showAuthScreen(message) {
    els.authScreen.classList.remove('hidden');
    els.app.classList.add('hidden');
    if (message) {
      els.authError.textContent = message;
      els.authError.classList.remove('hidden');
    } else {
      els.authError.classList.add('hidden');
    }
    els.tokenInput.value = '';
    els.tokenInput.focus();
  }

  function showApp() {
    els.authScreen.classList.add('hidden');
    els.app.classList.remove('hidden');
  }

  // --------------------------------------------------------------- fetch

  /**
   * Busca uma rota da API do daemon, anexando o Bearer token.
   * Em modo mock, nunca faz rede: resolve com dados embutidos em mock-data.js.
   */
  function apiFetch(path) {
    if (MOCK) return mockFetch(path);

    var token = getToken();
    return fetch(DEFAULT_BASE + path, {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (res) {
      if (res.status === 401) {
        clearToken();
        var err = new Error('UNAUTHORIZED');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
      if (!res.ok) {
        var e2 = new Error('HTTP ' + res.status);
        e2.code = 'HTTP_ERROR';
        throw e2;
      }
      return res.json();
    });
  }

  function mockFetch(path) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (MOCK === 'error') {
          var e = new Error('daemon indisponível (mock)');
          e.code = 'NETWORK_ERROR';
          reject(e);
          return;
        }
        var data = window.WA_MOCK;
        if (path.indexOf('/metrics/summary') === 0) {
          resolve(MOCK === 'empty' ? data.emptySummary(state.windowMs) : data.summaryFor(state.windowMs));
        } else if (path.indexOf('/metrics/calls') === 0) {
          resolve({ calls: MOCK === 'empty' ? [] : data.calls });
        } else if (path.indexOf('/metrics/audit') === 0) {
          resolve({ events: MOCK === 'empty' ? [] : data.audit });
        } else if (path.indexOf('/health') === 0) {
          // ?label=Trabalho&color=%23F7B00D exercita a identidade da instância no mock.
          resolve({
            ok: true,
            account: {
              label: qs.get('label'),
              description: null,
              color: qs.get('color'),
              tokenPath: '~/.wa-bridge/token'
            }
          });
        } else if (path.indexOf('/session') === 0) {
          var variant = (MOCK === 'pairing' || MOCK === 'close' || MOCK === 'connecting') ? MOCK : 'open';
          resolve(data.sessions[variant]);
        } else {
          reject(new Error('rota mock desconhecida: ' + path));
        }
      }, 120);
    });
  }

  // ----------------------------------------------------------- identidade

  /*
   * Cada daemon serve um número só, e o painel é servido pelo próprio daemon. A
   * identidade (nome, cor, caminho do token) vem de /health, que não pede token: assim
   * até a tela de login já diz de qual número ela é.
   */
  var DEFAULT_ACCENT = '#8b7cf6';
  var identityLoaded = false;

  function loadIdentity() {
    var req = MOCK
      ? mockFetch('/health')
      : fetch(DEFAULT_BASE + '/health').then(function (res) { return res.ok ? res.json() : null; });
    return req.then(function (health) {
      if (!health) return;
      applyIdentity(health.account);
      identityLoaded = true;
    }).catch(function () { /* daemon fora do ar: tenta de novo no próximo refresh */ });
  }

  function applyIdentity(account) {
    account = account || {};
    var label = account.label || null;
    var color = account.color || null;
    var root = document.documentElement;

    if (color) {
      root.style.setProperty('--account-color', color);
      root.style.setProperty('--accent-contrast', contrastText(color));
      root.setAttribute('data-account-color', '');
    } else {
      root.style.removeProperty('--account-color');
      root.style.removeProperty('--accent-contrast');
      root.removeAttribute('data-account-color');
    }

    [els.brandAccount, els.authAccount].forEach(function (node) {
      node.textContent = label || '';
      node.classList.toggle('hidden', !label);
    });
    document.title = label ? label + ' · wa-bridge' : 'wa-bridge · painel';

    if (account.tokenPath) {
      var path = tildify(account.tokenPath);
      els.authTokenPath.textContent = path;
      els.authTokenCmd.textContent = 'cat ' + path;
    }

    setFavicon(color || DEFAULT_ACCENT, label);
  }

  /** Favicon de bolinha na cor da conta com a inicial: distingue as abas lado a lado. */
  function setFavicon(color, label) {
    var initial = label ? label.trim().charAt(0).toUpperCase() : '';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="30" fill="' + color + '"/>' +
      (initial
        ? '<text x="32" y="44" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="34" ' +
          'font-weight="700" text-anchor="middle" fill="' + contrastText(color) + '">' +
          initial.replace(/[<>&"]/g, '') + '</text>'
        : '') +
      '</svg>';
    els.favicon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /** Texto escuro ou branco sobre a cor, pelo maior contraste (WCAG). */
  function contrastText(hex) {
    var rgb = [1, 3, 5].map(function (i) {
      var c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    var lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? '#14161c' : '#ffffff';
  }

  function tildify(path) {
    return path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  }

  // ------------------------------------------------------------- render

  function renderConnectionError(message) {
    els.connBanner.textContent = message;
    els.connBanner.classList.remove('hidden');
  }
  function clearConnectionError() {
    els.connBanner.classList.add('hidden');
  }

  var SESSION_LABEL = {
    open: 'conectado', connecting: 'conectando', close: 'desconectado', pairing: 'pareando'
  };

  function renderSession(session) {
    if (!session) {
      els.sessionDot.className = 'status-dot';
      els.sessionStateLabel.textContent = 'sem dados';
      els.sessionNumber.textContent = '—';
      els.sessionSince.textContent = '';
      els.qrPairing.classList.add('hidden');
      return;
    }
    els.sessionDot.className = 'status-dot st-' + session.state;
    els.sessionStateLabel.textContent = SESSION_LABEL[session.state] || session.state;
    // Nome e número juntos: duas contas podem ter o mesmo nome de perfil.
    els.sessionNumber.textContent = session.me
      ? [session.me.name, maskJid(session.me.jid)].filter(Boolean).join(' · ')
      : 'não pareado';
    els.sessionSince.textContent = session.since ? ('desde ' + fmtDateTime(session.since)) : '';

    if (session.lastError) {
      els.sessionError.textContent = session.lastError;
      els.sessionError.classList.remove('hidden');
    } else {
      els.sessionError.classList.add('hidden');
    }

    if (session.state === 'pairing' && session.qrDataUrl) {
      els.qrImage.src = session.qrDataUrl;
      els.qrPairing.classList.remove('hidden');
    } else {
      els.qrPairing.classList.add('hidden');
    }
  }

  var KPI_DEFS = [
    { key: 'calls', label: 'Chamadas' },
    { key: 'errors', label: 'Erros', cls: 'is-error' },
    { key: 'sends', label: 'Envios' },
    { key: 'cancels', label: 'Cancelamentos' },
    { key: 'blocked', label: 'Bloqueios', cls: 'is-blocked' },
    { key: 'mediaProcessed', label: 'Mídias' },
    { key: 'messagesRead', label: 'Lidas' }
  ];

  function renderKpis(totals) {
    totals = totals || {};
    clear(els.kpiGrid);
    KPI_DEFS.forEach(function (def) {
      var value = totals[def.key] || 0;
      var card = el('div', 'kpi-card flash' + (def.cls ? ' ' + def.cls : ''));
      card.appendChild(el('div', 'kpi-label', def.label));
      card.appendChild(el('div', 'kpi-value', String(value)));
      if (def.key === 'errors') {
        var rate = totals.calls ? ((totals.errors / totals.calls) * 100) : 0;
        card.appendChild(el('div', 'kpi-sub', rate.toFixed(1) + '% das chamadas'));
      }
      els.kpiGrid.appendChild(card);
      setTimeout(function () { card.classList.remove('flash'); }, 500);
    });
  }

  // ---- timeline SVG (barras agrupadas, calls/sends/errors) ----

  function renderTimeline(timeline) {
    clear(els.timelineChart);
    var hasData = timeline && timeline.length;
    var anyNonZero = hasData && timeline.some(function (b) { return b.calls || b.sends || b.errors; });

    if (!hasData || !anyNonZero) {
      els.timelineEmpty.classList.remove('hidden');
      return;
    }
    els.timelineEmpty.classList.add('hidden');

    var width = 920, height = 220;
    var padL = 36, padR = 8, padT = 10, padB = 28;
    var plotW = width - padL - padR;
    var plotH = height - padT - padB;

    var max = 1;
    timeline.forEach(function (b) {
      max = Math.max(max, b.calls || 0, b.sends || 0, b.errors || 0);
    });

    var n = timeline.length;
    var groupW = plotW / n;
    var barW = Math.max(2, groupW / 4.2);

    var wrap = el('div', 'chart-pos-wrap');
    var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, preserveAspectRatio: 'xMidYMid meet' });

    // grid horizontal (4 linhas)
    for (var g = 0; g <= 3; g++) {
      var gy = padT + plotH - (plotH * g / 3);
      svg.appendChild(svgEl('line', { x1: padL, x2: width - padR, y1: gy, y2: gy, class: 'grid-line' }));
      var label = Math.round(max * g / 3);
      var ty = svgEl('text', { x: padL - 6, y: gy + 3, class: 'axis-text', 'text-anchor': 'end' });
      ty.textContent = String(label);
      svg.appendChild(ty);
    }

    var tooltip = el('div', 'chart-tooltip');

    timeline.forEach(function (b, i) {
      var gx = padL + i * groupW;
      var series = [
        { v: b.calls || 0, color: 'var(--accent)', name: 'chamadas' },
        { v: b.sends || 0, color: 'var(--ok)', name: 'envios' },
        { v: b.errors || 0, color: 'var(--error)', name: 'erros' }
      ];
      series.forEach(function (s, si) {
        var h = (s.v / max) * plotH;
        var x = gx + si * (barW + 2) + groupW / 2 - (barW * 1.5 + 2);
        var y = padT + plotH - h;
        var rect = svgEl('rect', {
          x: x, y: y, width: barW, height: Math.max(h, s.v > 0 ? 1.5 : 0),
          rx: 2, fill: s.color, class: 'chart-bar'
        });
        svg.appendChild(rect);
      });

      // área de hover cobrindo o grupo inteiro
      var hoverRect = svgEl('rect', {
        x: gx, y: padT, width: groupW, height: plotH, fill: 'transparent'
      });
      hoverRect.addEventListener('mouseenter', function () {
        tooltip.innerHTML = '';
        var title = el('div', null, fmtAxisTs(b.bucketTs, state.windowMs));
        title.style.fontWeight = '600';
        title.style.marginBottom = '4px';
        tooltip.appendChild(title);
        series.forEach(function (s) {
          var row = el('div', 'tt-row');
          var dot = el('span', 'tt-dot');
          dot.style.background = s.color;
          row.appendChild(dot);
          row.appendChild(el('span', null, s.name + ': ' + s.v));
          tooltip.appendChild(row);
        });
        tooltip.classList.add('visible');
      });
      hoverRect.addEventListener('mousemove', function (ev) {
        var rectBounds = wrap.getBoundingClientRect();
        tooltip.style.left = (ev.clientX - rectBounds.left) + 'px';
        tooltip.style.top = (ev.clientY - rectBounds.top) + 'px';
      });
      hoverRect.addEventListener('mouseleave', function () {
        tooltip.classList.remove('visible');
      });
      svg.appendChild(hoverRect);

      // eixo X: mostra só alguns labels pra não poluir
      var showEvery = Math.ceil(n / 8);
      if (i % showEvery === 0 || i === n - 1) {
        var tx = svgEl('text', { x: gx + groupW / 2, y: height - 8, class: 'axis-text', 'text-anchor': 'middle' });
        tx.textContent = fmtAxisTs(b.bucketTs, state.windowMs);
        svg.appendChild(tx);
      }
    });

    wrap.appendChild(svg);
    wrap.appendChild(tooltip);
    els.timelineChart.appendChild(wrap);
  }

  // ---- uso por agente ----

  function renderByAgent(byAgent) {
    clear(els.byagentList);
    if (!byAgent || !byAgent.length) {
      els.byagentEmpty.classList.remove('hidden');
      return;
    }
    els.byagentEmpty.classList.add('hidden');

    var sorted = byAgent.slice().sort(function (a, b) { return (b.calls || 0) - (a.calls || 0); });
    var max = Math.max(1, sorted[0].calls || 1);

    sorted.forEach(function (a, i) {
      var row = el('div', 'agent-row');
      var nameWrap = el('div', 'agent-name');
      if (i === 0) nameWrap.appendChild(el('span', 'crown', '★'));
      nameWrap.appendChild(document.createTextNode(a.agent || 'desconhecido'));
      row.appendChild(nameWrap);

      var track = el('div', 'agent-bar-track');
      var fill = el('div', 'agent-bar-fill' + (i === 0 ? ' is-top' : ''));
      var pct = Math.max(2, ((a.calls || 0) / max) * 100);
      track.appendChild(fill);
      var countLabel = el('span', 'agent-bar-count', String(a.calls || 0));
      track.appendChild(countLabel);
      row.appendChild(track);
      setTimeout(function () { fill.style.width = pct + '%'; }, 20);

      var stats = el('div', 'agent-stats');
      var errSpan = el('span', null, null);
      errSpan.appendChild(document.createTextNode('erros '));
      var errB = el('b', 'err-val', String(a.errors || 0));
      errSpan.appendChild(errB);
      stats.appendChild(errSpan);

      var sendSpan = el('span', null, null);
      sendSpan.appendChild(document.createTextNode('envios '));
      var sendB = el('b', null, String(a.sends || 0));
      sendSpan.appendChild(sendB);
      stats.appendChild(sendSpan);

      stats.appendChild(el('span', null, 'p50 ' + fmtMs(a.p50Ms)));
      stats.appendChild(el('span', null, 'p95 ' + fmtMs(a.p95Ms)));
      row.appendChild(stats);

      els.byagentList.appendChild(row);
    });
  }

  // ---- uso por tool ----

  function renderByTool(byTool) {
    var tbody = els.bytoolTable.querySelector('tbody');
    clear(tbody);
    if (!byTool || !byTool.length) {
      els.bytoolEmpty.classList.remove('hidden');
      els.bytoolTable.parentElement.classList.add('hidden');
      return;
    }
    els.bytoolEmpty.classList.add('hidden');
    els.bytoolTable.parentElement.classList.remove('hidden');

    var sorted = byTool.slice().sort(function (a, b) { return (b.calls || 0) - (a.calls || 0); });
    sorted.forEach(function (t) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, t.tool || '—'));
      tr.appendChild(el('td', 'num', String(t.calls || 0)));
      var errTd = el('td', 'num', String(t.errors || 0));
      if (t.errors) errTd.style.color = 'var(--error)';
      tr.appendChild(errTd);
      tr.appendChild(el('td', 'num', fmtMs(t.p95Ms)));
      tbody.appendChild(tr);
    });
  }

  // ---- trilha de auditoria ----

  var AUDIT_ICON = {
    'send.confirmed': { icon: '→', cls: 'ic-ok' },
    'send.completed': { icon: '✓', cls: 'ic-ok' },
    'send.cancelled': { icon: '✕', cls: 'ic-neutral' },
    'send.blocked': { icon: '⛔', cls: 'ic-blocked' },
    'send.failed': { icon: '!', cls: 'ic-error' },
    'draft.created': { icon: '✎', cls: 'ic-neutral' },
    'draft.expired': { icon: '⏳', cls: 'ic-neutral' },
    'media.materialized': { icon: '▣', cls: 'ic-info' },
    'session.paired': { icon: '⚿', cls: 'ic-ok' },
    'session.lost': { icon: '⚡', cls: 'ic-error' },
    'alias.set': { icon: '@', cls: 'ic-info' }
  };

  var AUDIT_LABEL = {
    'send.confirmed': 'envio confirmado',
    'send.completed': 'envio concluído',
    'send.cancelled': 'envio cancelado',
    'send.blocked': 'envio bloqueado',
    'send.failed': 'envio falhou',
    'draft.created': 'rascunho criado',
    'draft.expired': 'rascunho expirou',
    'media.materialized': 'mídia processada',
    'session.paired': 'sessão pareada',
    'session.lost': 'sessão perdida',
    'alias.set': 'apelido definido'
  };

  function renderAudit(events) {
    clear(els.auditList);
    if (!events || !events.length) {
      els.auditEmpty.classList.remove('hidden');
      return;
    }
    els.auditEmpty.classList.add('hidden');

    events.forEach(function (ev) {
      var flagged = ev.action === 'send.blocked' || ev.action === 'send.cancelled';
      var iconDef = AUDIT_ICON[ev.action] || { icon: '•', cls: 'ic-neutral' };
      if (ev.outcome === 'error' && iconDef.cls !== 'ic-blocked') iconDef = { icon: iconDef.icon, cls: 'ic-error' };

      var li = el('li', 'audit-item' + (flagged ? ' is-flagged' : ''));
      var icon = el('div', 'audit-icon ' + iconDef.cls, iconDef.icon);
      li.appendChild(icon);

      var main = el('div', 'audit-main');
      var action = el('div', 'audit-action' + (flagged ? ' is-flagged' : ''), AUDIT_LABEL[ev.action] || ev.action);
      main.appendChild(action);

      var detailBits = [];
      if (ev.chatJid) detailBits.push(maskJid(ev.chatJid));
      if (ev.detail && typeof ev.detail === 'object') {
        var note = ev.detail.note || ev.detail.reason || ev.detail.message;
        if (note) detailBits.push(String(note));
      }
      // textContent apenas — detail pode conter texto de terceiros (input não confiável)
      main.appendChild(el('div', 'audit-detail', detailBits.join(' · ') || '—'));
      li.appendChild(main);

      var meta = el('div', 'audit-meta');
      meta.appendChild(el('span', 'agent-tag', ev.agent || 'unknown'));
      meta.appendChild(document.createTextNode(relTime(ev.ts)));
      li.appendChild(meta);

      els.auditList.appendChild(li);
    });
  }

  // ---- últimas chamadas ----

  function renderCalls(calls) {
    var tbody = els.callsTable.querySelector('tbody');
    clear(tbody);
    if (!calls || !calls.length) {
      els.callsEmpty.classList.remove('hidden');
      els.callsTable.parentElement.classList.add('hidden');
      return;
    }
    els.callsEmpty.classList.add('hidden');
    els.callsTable.parentElement.classList.remove('hidden');

    calls.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, fmtHour(c.ts)));
      tr.appendChild(el('td', null, c.agent || '—'));
      tr.appendChild(el('td', null, c.tool || '—'));
      tr.appendChild(el('td', 'num', fmtMs(c.durationMs)));

      var statusTd = document.createElement('td');
      var pillCls = c.status === 'ok' ? 'pill-ok' : (c.status === 'denied' ? 'pill-denied' : 'pill-error');
      var pill = el('span', 'pill ' + pillCls, c.status || '—');
      statusTd.appendChild(pill);
      if (c.error) {
        statusTd.appendChild(el('span', 'err-msg', c.error));
      }
      tr.appendChild(statusTd);

      tbody.appendChild(tr);
    });
  }

  // --------------------------------------------------------- ciclo de refresh

  function setRefreshIndicator(text) {
    els.refreshIndicator.textContent = text;
  }

  function tickRefreshLabel() {
    if (!state.lastUpdated) return;
    var s = Math.floor((Date.now() - state.lastUpdated) / 1000);
    setRefreshIndicator(state.paused ? 'pausado' : (s < 2 ? 'atualizado agora' : 'atualizado há ' + s + 's'));
  }

  function refreshAll() {
    if (state.inFlight) return;
    state.inFlight = true;

    Promise.all([
      apiFetch('/metrics/summary?window=' + state.windowMs),
      apiFetch('/metrics/calls?limit=100'),
      apiFetch('/metrics/audit?limit=100'),
      apiFetch('/session')
    ]).then(function (results) {
      var summary = results[0], callsRes = results[1], auditRes = results[2], session = results[3];
      clearConnectionError();
      if (!identityLoaded) loadIdentity();
      renderSession(session || (summary && summary.session));
      renderKpis(summary && summary.totals);
      renderTimeline(summary && summary.timeline);
      renderByAgent(summary && summary.byAgent);
      renderByTool(summary && summary.byTool);
      renderAudit(callsOrEmpty(auditRes, 'events'));
      renderCalls(callsOrEmpty(callsRes, 'calls'));
      state.lastUpdated = Date.now();
      tickRefreshLabel();
    }).catch(function (err) {
      if (err && err.code === 'UNAUTHORIZED') {
        showAuthScreen('Token inválido ou expirado. Cole o token atual.');
        return;
      }
      renderConnectionError('daemon não responde em ' + DEFAULT_BASE + ' — verifique se o processo está de pé. (' + (err && err.message ? err.message : 'erro desconhecido') + ')');
    }).finally(function () {
      state.inFlight = false;
    });
  }

  function callsOrEmpty(res, key) {
    if (!res) return [];
    var arr = res[key];
    return Array.isArray(arr) ? arr : [];
  }

  var refreshTimer = null;
  function scheduleRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (!state.paused) refreshAll();
    }, REFRESH_MS);
  }

  // ------------------------------------------------------------------ init

  function cacheEls() {
    els.authScreen = document.getElementById('auth-screen');
    els.app = document.getElementById('app');
    els.tokenInput = document.getElementById('token-input');
    els.tokenSubmit = document.getElementById('token-submit');
    els.authError = document.getElementById('auth-error');
    els.changeToken = document.getElementById('change-token');

    els.connBanner = document.getElementById('connection-banner');

    els.favicon = document.getElementById('favicon');
    els.brandAccount = document.getElementById('brand-account');
    els.authAccount = document.getElementById('auth-account');
    els.authTokenPath = document.getElementById('auth-token-path');
    els.authTokenCmd = document.getElementById('auth-token-cmd');

    els.sessionDot = document.getElementById('session-dot');
    els.sessionStateLabel = document.getElementById('session-state-label');
    els.sessionNumber = document.getElementById('session-number');
    els.sessionSince = document.getElementById('session-since');
    els.sessionError = document.getElementById('session-error');
    els.qrPairing = document.getElementById('qr-pairing');
    els.qrImage = document.getElementById('qr-image');

    els.kpiGrid = document.getElementById('kpi-grid');
    els.timelineChart = document.getElementById('timeline-chart');
    els.timelineEmpty = document.getElementById('timeline-empty');

    els.byagentList = document.getElementById('byagent-list');
    els.byagentEmpty = document.getElementById('byagent-empty');

    els.bytoolTable = document.getElementById('bytool-table');
    els.bytoolEmpty = document.getElementById('bytool-empty');

    els.auditList = document.getElementById('audit-list');
    els.auditEmpty = document.getElementById('audit-empty');

    els.callsTable = document.getElementById('calls-table');
    els.callsEmpty = document.getElementById('calls-empty');

    els.pauseToggle = document.getElementById('pause-toggle');
    els.refreshIndicator = document.getElementById('refresh-indicator');
    els.windowBtns = Array.prototype.slice.call(document.querySelectorAll('.window-btn'));
    els.mockBadge = document.getElementById('mock-badge');
  }

  function bindEvents() {
    els.tokenSubmit.addEventListener('click', submitToken);
    els.tokenInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitToken();
    });
    els.changeToken.addEventListener('click', function () {
      showAuthScreen(null);
    });

    els.pauseToggle.addEventListener('click', function () {
      state.paused = !state.paused;
      els.pauseToggle.setAttribute('aria-pressed', String(state.paused));
      els.pauseToggle.querySelector('.pause-icon').textContent = state.paused ? '▶' : '⏸';
      els.pauseToggle.querySelector('.pause-label').textContent = state.paused ? 'retomar' : 'pausar';
      tickRefreshLabel();
    });

    els.windowBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        els.windowBtns.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        state.windowMs = parseInt(btn.getAttribute('data-window'), 10);
        refreshAll();
      });
    });
  }

  function submitToken() {
    var v = els.tokenInput.value.trim();
    if (!v) {
      els.authError.textContent = 'Cole o token antes de continuar.';
      els.authError.classList.remove('hidden');
      return;
    }
    setToken(v);
    showApp();
    refreshAll();
  }

  function init() {
    cacheEls();
    bindEvents();

    if (MOCK) {
      els.mockBadge.classList.remove('hidden');
    }

    loadIdentity();

    // `./wa-bridge open` abre o painel com `#token=...`: o fragmento nunca vai ao servidor,
    // e sai da barra de endereço logo depois de guardado, para não ficar à vista.
    var hashToken = /(?:^#|&)token=([^&]+)/.exec(location.hash);
    if (hashToken) {
      setToken(decodeURIComponent(hashToken[1]));
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignora */ }
    }

    if (MOCK || getToken()) {
      showApp();
      refreshAll();
    } else {
      showAuthScreen(null);
    }

    scheduleRefresh();
    setInterval(tickRefreshLabel, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
