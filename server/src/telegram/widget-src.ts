/**
 * Source of the bot's widgets (Bot API 10.4, https://core.telegram.org/bots/widgets): the shop menu (MAIN_JS) and
 * the generic card (CARD_JS), drawn from the state the bot writes (widget.ts, cards.ts). Readable here; the shipped
 * HTML is minified into widget-html.ts by `npm run build:widgets` (scripts/build-widgets.ts) — Telegram takes at
 * most 4096 bytes after zlib -9, and test/unit/telegram-widget.test.ts fails when the two drift apart or grow over.
 *
 * Look: the site's own — always light whatever the chat's theme: paper, ink, shu red, indigo, a serif face, the 市
 * seal, and line icons drawn like the site's (24×24, 1.8 stroke, round caps). No emoji. No network, no inputs, no
 * external fonts or images are possible in a widget anyway.
 *
 * User text never reaches an attribute or a handler: it is escaped into element text only, and handlers carry the
 * app's own short commands and indices. The functions named in onclick (q, loc, cq, go, no, site) stay global.
 */

/** Styles every widget shares: palette, type, buttons, cards, rows. */
export const CSS = `
:root{color-scheme:light;--p:#f4efe6;--s:#fbf8f2;--k:#ece5d8;--i:#1c1a17;--m:#6b6459;--l:#e2dacb;--r:#c8102e;--b:#23395b;--bs:#dfe5ee;--g:#3d6631;--gs:#e2ead6;--rs:#f7deda;--w:#855400;--ws:#f4e8cb}
*{box-sizing:border-box;margin:0}
html,body{height:100%;overflow:hidden}
body{font:14px/1.35 serif;color:var(--i);background:var(--p);padding:12px;position:relative}
.el{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.h{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.se{width:34px;height:34px;border-radius:8px;background:var(--r);color:var(--s);display:grid;place-items:center;font-weight:700;font-size:19px;transform:rotate(-4deg)}
.u{font-weight:700;font-size:17px;flex:1;line-height:1.15}
.u .mu{font-weight:400}
button{font:inherit;color:var(--i);background:var(--k);border:0;border-radius:12px;padding:8px 11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
button:active{transform:scale(.96)}
.c{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:12px;margin-bottom:10px;box-shadow:0 4px 14px rgba(28,26,23,.07)}
button.c{display:block;text-align:left}
.g{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.c>:last-child,#a>:last-child,.g>.c{margin-bottom:0}
.mu{color:var(--m);font-size:12px}
.row{width:100%;margin-bottom:6px;padding:7px 11px;background:var(--s);border:1px solid var(--l);text-align:left}
.row b{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.pr{font-size:26px;font-weight:700;text-align:center;flex:1}
.main{width:100%;justify-content:center;background:var(--r);color:var(--s);font-weight:700;padding:12px;margin:0 0 8px}
.main.off{opacity:.45}
.ok{background:var(--gs);color:var(--g)}
.no{background:var(--rs);color:var(--r)}
.t{position:absolute;left:12px;right:12px;bottom:10px;text-align:center;font-size:13px;color:var(--s);background:var(--b);border-radius:10px;padding:8px;box-shadow:0 6px 18px rgba(28,26,23,.2)}
s{color:var(--m)}`;

/** Only the menu: the grouped list, counters, «Подбор», switches, the chart. */
export const CSS_MENU = `
.n{font-size:24px;font-weight:700}
.tl{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--s);border:1px solid var(--l);border-radius:14px;font-weight:600;text-align:left}
.tl svg{width:22px;height:22px;color:var(--b)}
.tl .n{font-size:22px}
.tl .mu{font-weight:400}
.ar{display:flex;align-items:center;gap:8px;border-radius:12px}.ar button{padding:7px 9px}
.bd{background:var(--r);color:var(--s);border-radius:99px;padding:1px 8px;font-size:12px;font-weight:700}
.em{text-align:center;padding:20px 14px}.em svg{width:34px;height:34px;color:var(--b);margin-bottom:6px}.em b{display:block;font-size:16px;margin-bottom:4px}.em .main{margin:12px 0 0}
.vb{background:var(--b);color:var(--s);border:0;padding:10px 12px;margin-bottom:8px}.vb .mu{color:var(--bs)}.vb svg{width:26px;height:26px;color:var(--s)}
.sw{width:36px;height:22px;border-radius:99px;background:var(--l);position:relative;margin-left:auto;flex:none}
.sw:after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff}
.sw.on{background:var(--g)}.sw.on:after{left:17px}
.bars{display:flex;align-items:flex-end;gap:5px;height:70px;margin:6px 0}
.bars i{flex:1;background:var(--b);border-radius:4px 4px 0 0;min-height:3px}`;

/** Only the items widget: filter chips, the price stepper, status pills. */
export const CSS_ITEMS = `
.ch{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.ch button{padding:7px 10px;font-size:13px}
.on{background:var(--b);color:var(--s)}
.st{display:flex;align-items:center;gap:8px;margin:6px 0}
.st button{width:44px;justify-content:center;font-size:20px}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:3px 10px;font-size:12px;background:var(--k);color:var(--m)}
.pill:before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.P{background:var(--gs);color:var(--g)}.pill.R{background:var(--bs);color:var(--b)}.pill.S{background:var(--ws);color:var(--w)}.pill.B{background:var(--rs);color:var(--r)}`;


/** Helpers both widgets share: escaping, money, buttons, icons, the request round-trip. */
const COMMON_JS = `
var W = TelegramWidget, S = {}, T = '', N = 0, TO;
var P = {
  back: 'M15 5l-7 7 7 7',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6 6 18'
};
function ic(n) { var d = P[n] || (S.P || {})[n]; return d ? '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>' : ''; }
function e(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
function byn(n) { return n == null ? 'договорная' : Number(n).toLocaleString('ru-RU') + ' BYN'; }
function b(t, c, k) { return '<button class="' + (k || '') + '" onclick="' + c + '">' + t + '</button>'; }
function hap(k) { try { k ? W.HapticFeedback.impactOccurred('light') : W.HapticFeedback.selectionChanged(); } catch (x) {} }
/** One request at a time (Telegram rejects a second one with BUSY): a tap while one waits says so and does nothing. */
function q(d) {
  if (N) { T = 'Секунду…'; r(); clearTimeout(TO); TO = setTimeout(function () { T = ''; r(); }, 1200); return 1; }
  hap(1); N++;
  W.request(d).then(function (a) { N--; a && a.result ? set(a.result) : (T = '', r()); }, function (x) {
    N--; set(W.chatData);
    T = x && x.code == 'RATE_LIMITED' ? 'Не так быстро' : 'Не получилось, повторите'; r();
  });
}
function seal(title, sub) { return '<div class="h"><div class="se">市</div><div class="u">' + title + (sub || '') + '</div></div>'; }
function fit() {
  try {
    var a = document.getElementById('a'), H = document.documentElement.clientHeight - 24, h = a.scrollHeight;
    a.style.transform = ''; a.style.width = '';
    if (H > 0 && h > H) { var k = H / h; a.style.transformOrigin = '0 0'; a.style.transform = 'scale(' + k + ')'; a.style.width = 100 / k + '%'; }
  } catch (x) {}
}
function done(h) { document.getElementById('a').innerHTML = h + (T ? '<div class="t">' + e(T) + '</div>' : ''); fit(); }
`;

/**
 * The shop menu: one widget, one message, every screen. It is a small renderer of blocks — the bot builds each
 * screen (texts, buttons, data) in widget-view.ts and sends it as the state; the code here only draws it, keeps the
 * few things that must answer at once on the tap (the price stepper, a second tap to confirm, a switch flip) and
 * sends the commands the blocks carry. A screen is {H: [title, sub, back], B: [blocks], t: note}.
 *
 * Blocks (arrays, the first item names the kind):
 *   ['g', tiles]            two-column tiles; a tile is [icon or number, label, command or https url, badge]
 *   ['v', icon, title, sub, command]          the «Подбор» banner
 *   ['r', label, command, icon, right]        a full-width row
 *   ['a', icon, title, sub, yes, no]          a one-line row to answer: ✓ at once, ✕ after «Отклонить?»
 *   ['c', ...lines]         a card; a line is ['b'|'m'|'p'|'pl'|'t', text, extra]
 *   ['ch', chips]           chips; a chip is [label, command, on, confirm label, icon]
 *   ['k', buttons]          two-column buttons; a button is [label, command, icon, confirm label, style]
 *   ['st', price, warn]     the price stepper with «Сохранить»
 *   ['s', label, on, command]                 a switch row (flips on the tap)
 *   ['m', label, command]   a main (red) button
 *   ['e', icon, title, text, label, command]  an empty state
 *   ['bars', values, caption]                 the 7-day chart
 *   ['pg', page, pages, previous, next]       a pager
 *   ['o', label, https url, icon]             a link row (opens the site)
 *   ['p', text]             a muted line
 */
const MAIN_BASE = `
var L = {}, LK = [];
Object.assign(P, {
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
  bag: 'M5 8h14l-1.2 12H6.2zM9 8V7a3 3 0 0 1 6 0v1',
  cart: 'M3 4h2.5l2.2 10.5h10.6L20.5 7H6.2M9.5 19.5h.01M17 19.5h.01',
  chart: 'M4 20v-9M10 20V5M16 20v-6M3 20h18',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c3.5 4 3.5 14 0 18',
  key: 'M15 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10M11.5 12.5 4 20M7 17l2 2M5 19l1.5 1.5',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  up: 'M12 19V5M6 11l6-6 6 6'
});
P.hide = P.eye + 'M4 4l16 16';
function set(j) {
  try { S = j ? JSON.parse(j) : {}; } catch (x) { S = {}; }
  // Taps still on their way keep what they show (a switch flipped twice fast does not blink back).
  if (!N) L = {};
  T = S.t || ''; r();
  // A note from the bot floats over the bottom for a moment, then goes.
  clearTimeout(TO); if (T) TO = setTimeout(function () { T = ''; r(); }, 3500);
}
function loc(k, v) { hap(); L[k] = v; r(); }
/** A command for a handler: only the app's own shapes, never anything else. */
function cm(c) { return /^[\\w:]+$/.test(c || '') ? "q('" + c + "')" : ''; }
function go(i) { W.openLink(LK[i]); }
function flip(i) { if (N) return q(); var x = S.B[i]; L[i] = !(L[i] != null ? L[i] : x[2]); r(); q(x[3]); }
function tile(t) {
  return b((typeof t[0] == 'number' ? '<span class="n">' + t[0] + '</span><span class="mu">' + e(t[1]) + '</span>' : ic(t[0]) + e(t[1])) + (t[3] ? '<span class="bd">' + t[3] + '</span>' : ''), /^https:/.test(t[2]) ? 'go(' + (LK.push(t[2]) - 1) + ')' : cm(t[2]), 'tl');
}
function line(l) {
  return l[0] == 'b' ? '<b class="el" style="font-size:16px">' + e(l[1]) + '</b>'
    : l[0] == 'p' ? '<div class="pr">' + e(l[1]) + (l[2] ? ' <s style="font-size:15px">' + e(l[2]) + '</s>' : '') + '</div>'
    : l[0] == 'pl' ? '<div style="margin:6px 0"><span class="pill ' + l[2] + '">' + e(l[1]) + '</span></div>'
    : '<div class="mu' + (l[0] == 't' ? ' el' : '') + '" style="margin:3px 0">' + e(l[1]) + '</div>';
}
var BK = {
  g: function (x) { return '<div class="g">' + x[1].map(tile).join('') + '</div>'; },
  v: function (x) { return b(ic(x[1]) + '<b>' + e(x[2]) + '</b><span class="mu">' + e(x[3]) + '</span>', cm(x[4]), 'row vb'); },
  r: function (x) { return b(ic(x[3]) + '<b>' + e(x[1]) + '</b>' + (x[4] != null ? '<span class="mu">' + e(x[4]) + '</span>' : ''), cm(x[2]), 'row'); },
  a: function (x, i) {
    return '<div class="row ar">' + ic(x[1]) + '<span class="el" style="flex:1"><b class="el">' + e(x[2]) + '</b><span class="mu el">' + e(x[3]) + '</span></span>' +
      (x[4] ? b(ic('check'), cm(x[4]), 'ok') + (L[i] ? b('Отклонить?', cm(x[5]), 'no') : b(ic('x'), "loc('" + i + "',1)")) : '') + '</div>';
  },
  c: function (x) { return '<div class="c">' + x.slice(1).map(line).join('') + '</div>'; },
  ch: function (x, i) {
    return '<div class="ch">' + x[1].map(function (c, j) {
      var id = i + '.' + j;
      return L[id] ? b(e(c[3]), cm(c[1]), 'no') : b(e(c[0]) + ic(c[4]), c[3] ? "loc('" + id + "',1)" : cm(c[1]), c[2] ? 'on' : '');
    }).join('') + '</div>';
  },
  k: function (x, i) {
    return '<div class="g">' + x[1].map(function (a, j) {
      var id = i + '.' + j;
      return L[id] ? b(e(a[3]), cm(a[1]), 'no') : b(ic(a[2]) + e(a[0]), a[3] ? "loc('" + id + "',1)" : cm(a[1]), a[4] || '');
    }).join('') + '</div>';
  },
  st: function (x) {
    var c = L.c == null ? x[1] : L.c, sp = L.s || 5, h = '<div class="st">' + b('−', "loc('c'," + Math.max(1, c - sp) + ')') + '<span class="pr">' + byn(c) + '</span>' + b('+', "loc('c'," + Math.min(1e5, c + sp) + ')') + '</div>';
    h += '<div class="ch">' + [1, 5, 10, 50, 100].map(function (v) { return b('±' + v, "loc('s'," + v + ')', sp == v ? 'on' : ''); }).join('') + '</div>';
    if (c * 2 < x[1]) h += '<div class="mu" style="color:var(--r)">' + e(x[2]) + '</div>';
    return h + b(ic('check') + 'Сохранить · ' + byn(c), c == x[1] ? '' : cm('P:' + c), 'main' + (c == x[1] ? ' off' : ''));
  },
  s: function (x, i) { var on = L[i] != null ? L[i] : x[2]; return b(e(x[1]) + '<span class="sw' + (on ? ' on' : '') + '"></span>', 'flip(' + i + ')', 'row'); },
  m: function (x) { return b(e(x[1]), cm(x[2]), 'main'); },
  e: function (x) { return '<div class="c em">' + ic(x[1]) + '<b>' + e(x[2]) + '</b><div class="mu">' + e(x[3]) + '</div>' + (x[4] ? b(e(x[4]), /^https:/.test(x[5]) ? 'go(' + (LK.push(x[5]) - 1) + ')' : cm(x[5]), 'main') : '') + '</div>'; },
  bars: function (x) { var m = Math.max.apply(null, x[1].concat(1)); return '<div class="mu">' + e(x[2]) + '</div><div class="bars">' + x[1].map(function (v) { return '<i style="height:' + Math.round((v / m) * 100) + '%"></i>'; }).join('') + '</div>'; },
  pg: function (x) { return '<div class="st">' + b('‹', cm(x[3])) + '<span class="pr" style="font-size:14px">' + x[1] + ' / ' + x[2] + '</span>' + b('›', cm(x[4])) + '</div>'; },
  o: function (x) { return /^https:/.test(x[2]) ? b(ic(x[3]) + '<b>' + e(x[1]) + '</b>', 'go(' + (LK.push(x[2]) - 1) + ')', 'row') : ''; },
  p: function (x) { return '<p class="mu">' + e(x[1]) + '</p>'; }
};
function r() {
  var H = S.H || ['Ichiba'], u = H[1] ? '<div class="mu">' + e(H[1]) + '</div>' : '';
  LK = [];
  var h = H[2] ? '<div class="h">' + b(ic('back'), cm(H[2]), 'bk') + '<div class="u">' + e(H[0]) + u + '</div></div>' : seal(e(H[0]), u);
  (S.B || []).forEach(function (x, i) { h += BK[x[0]] ? BK[x[0]](x, i) : ''; });
  done(h);
}
`;

export const SHOP_JS =
  COMMON_JS +
  MAIN_BASE +
  `
W.onEvent('chatDataChanged', function () { set(W.chatData); });
set(W.chatData);
try { W.ready(); } catch (x) {}
`;

/** The generic card: replies, notifications, deal cards, sign-up (cards.ts, widget-notice.ts). */
export const CARD_JS =
  COMMON_JS +
  `
Object.assign(P, {
  arr: 'M7 17 17 7M8 7h9v9'
});

var L = 0;
function set(j) { try { S = j ? JSON.parse(j) : {}; } catch (x) { S = {}; } L = 0; T = ''; r(); }
function ln() { var l = (S.l || []).slice(); if (S.u) l.push(['Открыть на ichiba', S.u]); return l; }
function go(k) { var l = ln()[k]; if (l) W.openLink(l[1]); }
function cq(k) { var c = (S.c || [])[k]; if (c) q(c[1]); }
function no() { L = 1; r(); }
function r() {
  var h = seal(e(S.h || 'Ichiba')), x = S.x || [];
  if (S.w || S.t || S.p != null || S.m || x.length) {
    h += '<div class="c">' + (S.w ? '<div class="mu">' + e(S.w) + '</div>' : '') + (S.t ? '<b style="font-size:16px">' + e(S.t) + '</b>' : '');
    if (S.p != null) h += '<div class="pr">' + byn(S.p) + (S.o != null ? ' <s style="font-size:16px">' + byn(S.o) + '</s>' : '') + '</div>';
    h += x.map(function (s) { return '<p style="white-space:pre-line;margin:4px 0">' + e(s) + '</p>'; }).join('') + (S.m ? '<div class="mu">' + e(S.m) + '</div>' : '') + '</div>';
  }
  if (S.d) h += '<div class="c" style="text-align:center;font-weight:700">' + e(S.d) + '</div>';
  else if (S.a) h += '<div class="g">' + b(ic('check') + 'Принять', "q('na')", 'ok') + (L ? b('Точно отклонить?', "q('nx')", 'no') : b(ic('x') + 'Отклонить', 'no()')) + '</div>';
  h += (S.c || []).map(function (c, k) { return b(e(c[0]), 'cq(' + k + ')', k ? 'row' : 'main'); }).join('');
  h += ln().map(function (l, k) { return b('<b>' + e(l[0]) + '</b>' + ic('arr'), 'go(' + k + ')', 'row'); }).join('');
  done(h);
}
W.onEvent('chatDataChanged', function () { set(W.chatData); });
set(W.chatData);
try { W.ready(); } catch (x) {}
`;
