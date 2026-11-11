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
body{font:14px/1.35 serif;color:var(--i);background:var(--p);padding:12px}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.h{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.se{width:34px;height:34px;border-radius:8px;background:var(--r);color:var(--s);display:grid;place-items:center;font-weight:700;font-size:19px;transform:rotate(-4deg);box-shadow:0 2px 6px rgba(200,16,46,.25)}
.u{font-weight:700;font-size:17px;flex:1;line-height:1.15}
.u .mu{font-weight:400}
button{font:inherit;color:var(--i);background:var(--k);border:0;border-radius:12px;padding:8px 11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:transform .12s,background .2s}
button:active{transform:scale(.96)}
.c{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:12px;margin-bottom:10px;box-shadow:0 1px 2px rgba(28,26,23,.06),0 8px 24px rgba(28,26,23,.06)}
button.c{display:block;text-align:left}
.g{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.c>:last-child,#a>:last-child,.g>.c{margin-bottom:0}
.mu{color:var(--m);font-size:12px}
.row{width:100%;margin-bottom:8px;background:var(--s);border:1px solid var(--l);text-align:left}
.row b{flex:1;font-weight:600}
.pr{font-size:30px;font-weight:700;text-align:center;flex:1}
.main{width:100%;justify-content:center;background:var(--r);color:var(--s);font-weight:700;padding:12px;margin:0 0 8px}
.main[disabled]{opacity:.45}
.ok{background:var(--gs);color:var(--g)}
.no{background:var(--rs);color:var(--r)}
.t{margin-top:8px;text-align:center;font-size:13px;color:var(--b)}
s{color:var(--m)}`;

/** Only the menu: the grouped list, counters, «Подбор», switches, the chart. */
export const CSS_MENU = `
.n{font-size:24px;font-weight:700}
.tl{gap:10px;padding:12px;background:var(--s);border:1px solid var(--l);border-radius:14px;font-weight:600;text-align:left}
.tl svg{width:22px;height:22px;color:var(--b)}
.tl .n{font-size:22px}
.tl .mu{font-weight:400}
.bd{background:var(--r);color:var(--s);border-radius:99px;padding:1px 8px;font-size:12px;font-weight:700}
.vb{background:var(--b);color:var(--s);border:0;padding:14px;margin-bottom:10px}.vb .mu{color:var(--bs)}.vb svg{width:26px;height:26px;color:var(--s)}
.sw{width:36px;height:22px;border-radius:99px;background:var(--l);position:relative;margin-left:auto;flex:none;transition:background .2s}
.sw:after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s}
.sw.on{background:var(--g)}.sw.on:after{left:17px}
.bars{display:flex;align-items:flex-end;gap:5px;height:70px;margin:6px 0}
.bars i{flex:1;background:var(--b);border-radius:4px 4px 0 0;min-height:3px}`;

/** Only the items widget: filter chips, the price stepper, status pills. */
export const CSS_ITEMS = `
.ch{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.on{background:var(--b);color:var(--s)}
.st{display:flex;align-items:center;gap:8px;margin:8px 0}
.st button{width:44px;justify-content:center;font-size:20px}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:3px 10px;font-size:12px;background:var(--k);color:var(--m)}
.pill:before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.P{background:var(--gs);color:var(--g)}.pill.R{background:var(--bs);color:var(--b)}.pill.S{background:var(--ws);color:var(--w)}.pill.B{background:var(--rs);color:var(--r)}`;


/** Helpers both widgets share: escaping, money, buttons, icons, the request round-trip. */
const COMMON_JS = `
var W = TelegramWidget, S = {}, T = '';
var P = {
  back: 'M15 5l-7 7 7 7',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6 6 18'
};
function ic(n) { return '<svg viewBox="0 0 24 24"><path d="' + P[n] + '"/></svg>'; }
function e(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
function byn(n) { return n == null ? 'договорная' : Number(n).toLocaleString('ru-RU') + ' BYN'; }
function b(t, c, k) { return '<button class="' + (k || '') + '" onclick="' + c + '">' + t + '</button>'; }
function hap(k) { try { k ? W.HapticFeedback.impactOccurred('light') : W.HapticFeedback.selectionChanged(); } catch (x) {} }
function q(d) {
  hap(1); T = '…'; r();
  W.request(d).then(function (a) { a && a.result ? set(a.result) : (T = '', r()); }, function (x) {
    T = x && x.code == 'RATE_LIMITED' ? 'Не так быстро' : 'Не получилось — попробуйте ещё раз'; r();
  });
}
function seal(title, sub) { return '<div class="h"><div class="se">市</div><div class="u">' + title + (sub || '') + '</div></div>'; }
function done(h) { document.getElementById('a').innerHTML = h + (T ? '<div class="t">' + e(T) + '</div>' : ''); }
`;

/**
 * The shop menu, in two widgets (a widget's code is fixed per message and must fit 4 KB compressed): MENU_JS —
 * home, what waits, purchases, statistics, notifications, shops; ITEMS_JS — the list and an item. Moving between the
 * two, the bot replaces the message (widget.ts), so the chat keeps one menu. Nesting: the 市 logo only on home,
 * «back» at the top left everywhere else (an item → its list, the rest → home).
 */
const MAIN_BASE = `
var L = {};
var ST = { P: 'В продаже', R: 'Идёт сделка', H: 'Снята с продажи', D: 'Черновик', S: 'Продана', B: 'Снята модератором' };
var NC = ['Сделки', 'Предложения цены', 'Аукционы', 'Сообщения', 'Интерес к вещам', 'Вечерняя сводка', 'Избранное и подписки', 'Аккаунт'];
var TT = { l: 'Вещи', i: 'Вещь', d: 'Ждут ответа', b: 'Покупки', t: 'Статистика', n: 'Уведомления', x: 'Магазины' };
function set(j) { try { S = j ? JSON.parse(j) : {}; } catch (x) { S = {}; } L = {}; T = S.t || ''; r(); }
function loc(k, v) { hap(); L[k] = v; r(); }
function site(p) { W.openLink('https://ichiba.by' + (p || '')); }
function r() {
  var s = S.s, u = S.u ? '<div class="mu">@' + e(S.u) + '</div>' : '';
  var back = s == 'i' ? "q('l:" + (S.f || 'a') + ":0')" : "q('h')";
  var h = s && s != 'h' && s != 'x'
    ? '<div class="h">' + b(ic('back'), back, 'bk') + '<div class="u">' + TT[s] + u + '</div></div>'
    : seal('Ichiba', u);
  if (!s) h += '<div class="c">' + (S.e ? e(S.e) : 'Магазин ichiba') + '</div>' + b('Открыть', "q('h')", 'main');
  else h += (SCR[s] || SCR.h || function () { return ''; })();
  done(h);
}
`;

export const MENU_JS =
  COMMON_JS +
  MAIN_BASE +
  `
Object.assign(P, {
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
  bag: 'M5 8h14l-1.2 12H6.2zM9 8V7a3 3 0 0 1 6 0v1',
  cart: 'M3 4h2.5l2.2 10.5h10.6L20.5 7H6.2M9.5 19.5h.01M17 19.5h.01',
  chart: 'M4 20v-9M10 20V5M16 20v-6M3 20h18',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  swap: 'M4 8h15l-3.5-3.5M20 16H5l3.5 3.5',
  key: 'M15 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10M11.5 12.5 4 20M7 17l2 2M5 19l1.5 1.5',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01'
});

function home() {
  var n = S.n || [0, 0, 0, 0], l = ['В продаже', 'Сняты', 'Черновики', 'Проданы'], f = 'ahds';
  var nav = [['box', 'Вещи', 'l:a:0'], ['bag', 'Сделки', 'd', S.w], ['cart', 'Покупки', 'b'], ['chart', 'Статистика', 't'], ['bell', 'Уведомления', 'n']];
  if (S.k) nav.push(['swap', 'Другой магазин', 'x']);
  if (S.ad) nav.unshift(['key', 'Админка', 'A']);
  // «Подбор» stands apart from the account: the site's swipe, one photo at a time, in its own message.
  return b(ic('heart') + '<span><b>Подбор вещей</b><br><span class="mu">листайте и сохраняйте, что нравится</span></span>', "q('V')", 'row vb') +
    (S.w ? b(ic('bag') + 'Ждут вашего ответа: ' + S.w, "q('d')", 'main') : '') +
    (n[0] + n[1] + n[2] + n[3] ? '<div class="g">' + n.map(function (v, i) { return b('<span class="n">' + v + '</span><span class="mu">' + l[i] + '</span>', "q('l:" + f[i] + ":0')", 'tl'); }).join('') + '</div>' : '') +
    '<div class="g">' + nav.map(function (x) { return b(ic(x[0]) + x[1] + (x[3] ? '<span class="bd">' + x[3] + '</span>' : ''), "q('" + x[2] + "')", 'tl'); }).join('') +
    b(ic('globe') + 'Сайт ichiba', 'site()', 'tl') + b(ic('help') + 'Помощь', "site('/how-it-works')", 'tl') + '</div>';
}
function deals() {
  var i = S.i || [];
  return i.length ? i.map(function (x, k) {
    return '<div class="c"><b>' + ic(x[0] == 'r' ? 'bag' : 'tag') + ' @' + e(x[1]) + '</b> · ' + byn(x[3]) + '<div class="mu" style="margin:4px 0 8px">' + e(x[2]) + '</div><div class="g">' +
      b(ic('check') + 'Принять', "q('da:" + k + "')", 'ok') + (L.d === k ? b('Отклонить?', "q('dx:" + k + "')", 'no') : b(ic('x') + 'Отклонить', "loc('d'," + k + ')')) + '</div></div>';
  }).join('') : '<p class="mu">Ничего не ждёт ответа.</p>';
}
function buys() {
  var i = S.i || [];
  return i.length ? i.map(function (x) {
    return '<div class="c"><b>' + e(x[1]) + '</b> · ' + byn(x[2]) + '<div class="mu" style="margin:4px 0">' + e(x[3]) + '</div>' +
      (x[0] == 'c' ? '<div class="g">' + b(ic('check') + 'Принять', "q('ba:" + x[4] + "')", 'ok') + (L.y === x[4] ? b('Отклонить?', "q('bx:" + x[4] + "')", 'no') : b(ic('x') + 'Отклонить', "loc('y'," + x[4] + ')')) + '</div>' : '') + '</div>';
  }).join('') : '<p class="mu">Активных покупок нет.</p>';
}
function stats() {
  var d = S.d || [], m = Math.max.apply(null, d.concat(1));
  return '<div class="mu">Просмотры за 7 дней</div><div class="bars">' + d.map(function (v) { return '<i style="height:' + Math.round((v / m) * 100) + '%"></i>'; }).join('') + '</div><div class="g">' +
    [['Просмотры', S.v], ['В избранном', S.f], ['В корзине', S.c], ['Чаты', S.m], ['Предложения', S.o], ['Запросы', S.r]].map(function (x) { return '<div class="c"><div class="n">' + x[1] + '</div><div class="mu">' + x[0] + '</div></div>'; }).join('') + '</div>';
}
function nots() {
  return (S.q || []).map(function (v, k) { return b(NC[k] + '<span class="sw' + (v ? ' on' : '') + '"></span>', "q('nt:" + k + "')", 'row'); }).join('') +
    (L.k ? b('Точно отключить этот Telegram?', "q('K')", 'row no') : b(ic('x') + 'Отключить Telegram от магазина', "loc('k',1)", 'row'));
}
function acc() { return (S.a || []).map(function (x, k) { return b('@' + e(x), "q('xa:" + k + "')", 'row'); }).join(''); }
var SCR = { h: home, d: deals, b: buys, t: stats, n: nots, x: acc };
W.onEvent('chatDataChanged', function () { set(W.chatData); });
set(W.chatData);
try { W.ready(); } catch (x) {}
`;

export const ITEMS_JS =
  COMMON_JS +
  MAIN_BASE +
  `
Object.assign(P, {
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  up: 'M12 19V5M6 11l6-6 6 6',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01'
});
P.hide = P.eye + 'M4 4l16 16';

function list() {
  var f = S.f || 'a', h = '<div class="ch">' + [['a', 'В продаже'], ['h', 'Снятые'], ['d', 'Черновики'], ['s', 'Проданные']].map(function (x) { return b(x[1], "q('l:" + x[0] + ":0')", f == x[0] ? 'on' : ''); }).join('') + '</div>';
  var i = S.i || [];
  h += i.length ? i.map(function (x, k) { return b('<b>' + e(x[0]) + '</b><span class="mu">' + byn(x[1]) + '</span>', "q('o:" + k + "')", 'row'); }).join('') : '<p class="mu">Здесь пока пусто.</p>';
  if (S.P > 1) h += '<div class="st">' + b('‹', S.p > 0 ? "q('l:" + f + ':' + (S.p - 1) + "')" : '') + '<span class="pr" style="font-size:14px">' + (S.p + 1) + ' / ' + S.P + '</span>' + b('›', S.p < S.P - 1 ? "q('l:" + f + ':' + (S.p + 1) + "')" : '') + '</div>';
  return h;
}
function item() {
  var c = L.c == null ? S.c : L.c, st = S.st, ed = /[PHD]/.test(st) && !S.au;
  var h = '<div class="c"><b style="font-size:16px">' + e(S.T) + '</b><div style="margin:8px 0"><span class="pill ' + st + '">' + (ST[st] || st) + '</span></div>';
  if (/[PR]/.test(st)) h += '<div class="mu">' + S.v + ' просмотров · ' + S.fv + ' в избранном' + (S.of ? ' · торг принимается' : '') + '</div>';
  if (ed) {
    var sp = L.s || 5;
    h += '<div class="st">' + b('−', "loc('c'," + Math.max(1, (c || 0) - sp) + ')') + '<span class="pr">' + byn(c) + '</span>' + b('+', "loc('c'," + Math.min(1e5, (c || 0) + sp) + ')') + '</div>';
    h += '<div class="ch">' + [1, 5, 10, 50, 100].map(function (x) { return b('±' + x, "loc('s'," + x + ')', sp == x ? 'on' : ''); }).join('') + '</div>';
    if (S.c && c * 2 < S.c) h += '<p class="mu" style="color:var(--r)">Больше чем вдвое дешевле — точно?</p>';
    h += '<button class="main" ' + (c == S.c || !c ? 'disabled' : '') + ' onclick="q(\\'P:' + c + '\\')">' + ic('check') + 'Сохранить · ' + byn(c) + '</button>';
  } else h += '<div class="pr">' + byn(S.c) + (S.o ? ' <s style="font-size:16px">' + byn(S.o) + '</s>' : '') + '</div>';
  h += '</div>';
  var z = S.z || [];
  if (z.length > 1) h += '<div class="mu">Размеры в наличии — нажмите проданный:</div><div class="ch">' + z.map(function (x, k) { return L.z === k ? b('Убрать ' + e(x) + '?', "q('Z:" + k + "')", 'no') : b(e(x) + ic('x'), "loc('z'," + k + ')'); }).join('') + '</div>';
  var a = [];
  if (st == 'P') { a.push(b(ic('hide') + 'Снять', "q('H')")); if (S.bu == 0) a.push(b(ic('up') + 'Поднять', "q('B')")); if (S.fx) a.push(b(ic('tag') + (S.of ? 'Торг: вкл' : 'Торг: выкл'), "q('O')", S.of ? 'ok' : '')); }
  if (st == 'H' && !S.ha) a.push(b(ic('eye') + 'Вернуть в продажу', "q('U')", 'ok'));
  if (st == 'D') a.push(b(ic('up') + 'Опубликовать', "q('U')", 'ok'));
  if (st == 'P' || (st == 'H' && !S.ha)) a.push(L.x ? b('Точно продано? Да', "q('S')", 'no') : b(ic('check') + 'Продано', "loc('x',1)"));
  return h + '<div class="g">' + a.join('') + '</div>';
}
var SCR = { l: list, i: item };
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
