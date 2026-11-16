/**
 * Dados de exemplo para o modo mock do painel (?mock=1, ?mock=empty, ?mock=error).
 * Usado só para desenvolvimento local sem o daemon rodando — nunca é usado em produção
 * a menos que o parâmetro esteja presente na URL. Nenhum dado real aqui.
 */
(function () {
  'use strict';

  var NOW = Date.now();

  /** QR "falso" só para exercitar a tela de pareamento — não é um QR válido de verdade. */
  function fakeQrDataUrl() {
    var size = 21;
    var cell = 10;
    var px = size * cell;
    var rects = '';
    var seed = 42;
    function rnd() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var onBorder = x < 3 || y < 3 || (x > size - 4 && y < 3) || (x < 3 && y > size - 4);
        var on = onBorder ? (x + y) % 2 === 0 : rnd() > 0.55;
        if (on) {
          rects += '<rect x="' + x * cell + '" y="' + y * cell + '" width="' + cell + '" height="' + cell + '" fill="#111"/>';
        }
      }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '">' +
      '<rect width="' + px + '" height="' + px + '" fill="#fff"/>' + rects + '</svg>';
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  var AGENTS = ['claude-code', 'codex-cli', 'opencode', 'antigravity'];
  var TOOLS = [
    'wa_send_text', 'wa_read_messages', 'wa_list_chats', 'wa_media',
    'wa_resolve_contact', 'wa_usage', 'wa_mark_read', 'wa_react',
    'wa_cancel', 'wa_set_alias', 'wa_session_status', 'wa_send_media'
  ];

  function pick(arr, i) { return arr[i % arr.length]; }

  function buildTimeline(windowMs) {
    var buckets, bucketMs;
    if (windowMs <= 3600000) { buckets = 12; bucketMs = 5 * 60 * 1000; }
    else if (windowMs <= 86400000) { buckets = 24; bucketMs = 60 * 60 * 1000; }
    else if (windowMs <= 604800000) { buckets = 14; bucketMs = 12 * 60 * 60 * 1000; }
    else { buckets = 30; bucketMs = 24 * 60 * 60 * 1000; }

    var out = [];
    var start = NOW - windowMs;
    for (var i = 0; i < buckets; i++) {
      var bucketTs = start + i * bucketMs;
      // alguns buckets propositalmente vazios, para validar que não interpola
      var isEmpty = i % 7 === 3 || i % 11 === 0;
      if (isEmpty) {
        out.push({ bucketTs: bucketTs, calls: 0, sends: 0, errors: 0 });
        continue;
      }
      var base = 3 + Math.round(6 * Math.abs(Math.sin(i * 0.7)));
      var calls = base + (i % 5);
      var sends = Math.max(0, Math.round(calls * 0.3) - (i % 3));
      var errors = i % 9 === 0 ? Math.max(1, Math.round(calls * 0.15)) : (i % 4 === 0 ? 1 : 0);
      out.push({ bucketTs: bucketTs, calls: calls, sends: sends, errors: errors });
    }
    return out;
  }

  function buildByAgent() {
    var defs = [
      { agent: 'claude-code', calls: 482, errRate: 0.03, sendRate: 0.18, p50: 210, p95: 980 },
      { agent: 'codex-cli', calls: 156, errRate: 0.06, sendRate: 0.22, p50: 340, p95: 1420 },
      { agent: 'opencode', calls: 64, errRate: 0.02, sendRate: 0.1, p50: 180, p95: 610 },
      { agent: 'antigravity', calls: 21, errRate: 0.1, sendRate: 0.05, p50: 290, p95: 1100 }
    ];
    return defs.map(function (d) {
      return {
        agent: d.agent,
        calls: d.calls,
        errors: Math.round(d.calls * d.errRate),
        sends: Math.round(d.calls * d.sendRate),
        p50Ms: d.p50,
        p95Ms: d.p95
      };
    });
  }

  function buildByTool() {
    var defs = [
      { tool: 'wa_read_messages', calls: 310, errRate: 0.01, p95: 320 },
      { tool: 'wa_list_chats', calls: 190, errRate: 0.0, p95: 140 },
      { tool: 'wa_send_text', calls: 118, errRate: 0.05, p95: 2200 },
      { tool: 'wa_media', calls: 61, errRate: 0.08, p95: 4800 },
      { tool: 'wa_resolve_contact', calls: 44, errRate: 0.0, p95: 90 },
      { tool: 'wa_usage', calls: 38, errRate: 0.0, p95: 60 },
      { tool: 'wa_mark_read', calls: 22, errRate: 0.0, p95: 70 },
      { tool: 'wa_cancel', calls: 6, errRate: 0.0, p95: 50 },
      { tool: 'wa_react', calls: 5, errRate: 0.0, p95: 80 },
      { tool: 'wa_set_alias', calls: 3, errRate: 0.0, p95: 40 }
    ];
    return defs.map(function (d) {
      return { tool: d.tool, calls: d.calls, errors: Math.round(d.calls * d.errRate), p95Ms: d.p95 };
    });
  }

  function buildCalls(limit) {
    var out = [];
    var statuses = ['ok', 'ok', 'ok', 'ok', 'ok', 'error', 'ok', 'denied'];
    for (var i = 0; i < limit; i++) {
      var status = pick(statuses, i * 3 + 1);
      out.push({
        id: limit - i,
        ts: NOW - i * 97000,
        traceId: 'tr_' + (1000 + i).toString(36),
        agent: pick(AGENTS, i),
        tool: pick(TOOLS, i * 2),
        durationMs: 40 + Math.round(1800 * Math.abs(Math.sin(i * 1.3))),
        status: status,
        error: status === 'error' ? pick([
          'timeout aguardando ack do Baileys',
          'ffmpeg: formato de áudio não suportado',
          'rate limit: 10 envios/hora excedido',
          'contato ambíguo: múltiplos matches'
        ], i) : (status === 'denied' ? 'draft requer acknowledge NEVER_CONTACTED' : null)
      });
    }
    return out;
  }

  function buildAudit(limit) {
    var actions = [
      { action: 'send.completed', outcome: 'ok' },
      { action: 'draft.created', outcome: 'ok' },
      { action: 'send.confirmed', outcome: 'ok' },
      { action: 'send.blocked', outcome: 'denied' },
      { action: 'send.cancelled', outcome: 'ok' },
      { action: 'media.materialized', outcome: 'ok' },
      { action: 'alias.set', outcome: 'ok' },
      { action: 'session.paired', outcome: 'ok' },
      { action: 'send.failed', outcome: 'error' }
    ];
    var jids = ['556199998888@s.whatsapp.net', '556288887777@s.whatsapp.net', '120363012345678901@g.us', '554796665544@s.whatsapp.net'];
    var out = [];
    for (var i = 0; i < limit; i++) {
      var def = pick(actions, i * 5 + 2);
      var jid = pick(jids, i);
      var detailText = i === 2
        ? 'bubble 1/2: "Oi, bora marcar aquele café amanhã? <script>alert(1)</script>"'
        : (def.action === 'send.blocked' ? 'destino na blocklist (status@broadcast)' : 'ok');
      out.push({
        id: limit - i,
        ts: NOW - i * 210000,
        traceId: 'tr_' + (2000 + i).toString(36),
        agent: pick(AGENTS, i + 1),
        action: def.action,
        chatJid: jid,
        outcome: def.outcome,
        detail: { note: detailText, bubbles: 1 + (i % 3) }
      });
    }
    return out;
  }

  function summaryFor(windowMs) {
    var byAgent = buildByAgent();
    var byTool = buildByTool();
    var totals = {
      calls: byAgent.reduce(function (s, a) { return s + a.calls; }, 0),
      errors: byAgent.reduce(function (s, a) { return s + a.errors; }, 0),
      sends: byAgent.reduce(function (s, a) { return s + a.sends; }, 0),
      cancels: 7,
      blocked: 4,
      mediaProcessed: 61,
      messagesRead: 893
    };
    return {
      windowMs: windowMs,
      generatedAt: Date.now(),
      totals: totals,
      byAgent: byAgent,
      byTool: byTool,
      timeline: buildTimeline(windowMs),
      session: SESSION_OPEN
    };
  }

  var SESSION_OPEN = {
    state: 'open',
    me: { jid: '555199990000@s.whatsapp.net', name: 'Você' },
    qrDataUrl: null,
    since: NOW - 3 * 60 * 60 * 1000 - 42 * 60 * 1000,
    lastError: null
  };

  var SESSION_PAIRING = {
    state: 'pairing',
    me: null,
    qrDataUrl: fakeQrDataUrl(),
    since: NOW - 8000,
    lastError: null
  };

  var SESSION_CONNECTING = {
    state: 'connecting',
    me: null,
    qrDataUrl: null,
    since: NOW - 4000,
    lastError: null
  };

  var SESSION_CLOSE = {
    state: 'close',
    me: { jid: '555199990000@s.whatsapp.net', name: 'Você' },
    qrDataUrl: null,
    since: NOW - 20 * 60 * 1000,
    lastError: 'Connection Closed (device_removed)'
  };

  function emptySummary(windowMs) {
    return {
      windowMs: windowMs,
      generatedAt: Date.now(),
      totals: { calls: 0, errors: 0, sends: 0, cancels: 0, blocked: 0, mediaProcessed: 0, messagesRead: 0 },
      byAgent: [],
      byTool: [],
      timeline: buildTimeline(windowMs).map(function (b) { return { bucketTs: b.bucketTs, calls: 0, sends: 0, errors: 0 }; }),
      session: SESSION_OPEN
    };
  }

  window.WA_MOCK = {
    sessions: {
      open: SESSION_OPEN,
      pairing: SESSION_PAIRING,
      connecting: SESSION_CONNECTING,
      close: SESSION_CLOSE
    },
    summaryFor: summaryFor,
    emptySummary: emptySummary,
    calls: buildCalls(60),
    audit: buildAudit(40)
  };
})();
