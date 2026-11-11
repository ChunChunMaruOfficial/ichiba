import type { Btn, Go, Screen } from './ui.js';

/**
 * A panel screen (HTML text + button rows, the same one the text panel shows) as the widget's compact model:
 *   h  heading, n  note line (ne: it is an error), t  tabs [label, n, on], p  pager [label, n|null],
 *   b  blocks: ['g', label] | ['p', mini-HTML] | ['k', [[label, value, sub, tone]]] | ['r', [[label, count]]],
 *   a  action rows [[label, n | url, style]], u  1 when text was cut (the widget offers «Целиком»), r  revision.
 * Button numbers index `routes`, which the bot keeps per chat like the text panel's buttons. The whole model must
 * fit chat_data + public_data: 1024 bytes each, so long screens are trimmed and the full text is one tap away.
 */
export interface WidgetModel {
  r: number;
  h: string;
  n?: string;
  ne?: 1;
  t?: Array<[string, number, 0 | 1]>;
  p?: Array<[string, number | null]>;
  b: Array<[string, unknown]>;
  a: Array<Array<[string, number | string, string?]>>;
  u?: 1;
}

const PART = 1024;
const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The panel's HTML down to what the widget draws: <b> <i> <code> <s> and <sp> (spoiler); links become their text. */
export function miniHtml(html: string) {
  return html
    .replace(/<tg-spoiler>/g, '<sp>')
    .replace(/<\/tg-spoiler>/g, '</sp>')
    .replace(/<(?!\/?(b|i|code|s|sp)>)[^>]*>/g, '');
}

/** Cuts mini-HTML to about n characters of text; a cut through tags drops the tags rather than leave one open. */
function clipRich(s: string, n: number) {
  if (strip(s).length <= n) return s;
  return cut(strip(s), n);
}

function tone(label: string) {
  if (/^✅/.test(label)) return 'ok';
  if (/^(🚫|🗑|✖️|⛔)/.test(label)) return 'd';
  if (/^(📤|💾|✍️|🔓)/.test(label)) return 'p';
  if (/^(🏠|←|·)/.test(label)) return 'q';
  return '';
}

/** Text lines → blocks: «Label: <b>12</b>» runs become tiles, ▰▱ bars a breakdown, a bold line a group label. */
function blocks(lines: string[]) {
  const out: Array<[string, unknown]> = [];
  const lastOf = (k: string) => {
    const l = out[out.length - 1];
    return l && l[0] === k ? (l[1] as unknown[]) : null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1][0] !== 'g') out.push(['g', '']);
      continue;
    }
    const bar = /^<code>[▰▱]+<\/code>\s*([\d\s\u00a0]+)\s*·\s*(.+)$/.exec(line);
    if (bar) {
      const row: [string, number] = [cut(decode(strip(bar[2])), 24), Number(bar[1].replace(/\D/g, '')) || 0];
      const into = lastOf('r');
      if (into) into.push(row);
      else out.push(['r', [row]]);
      continue;
    }
    const stat = /^(?:[^\s:<]{1,3}\s)?([^:<]{2,32}):\s*<b>([\d\s\u00a0.,+\-−]+(?:\s?BYN)?)<\/b>\s*(.*)$/.exec(line);
    if (stat) {
      const tile = [cut(decode(stat[1].trim()), 24), decode(stat[2].trim()), cut(decode(strip(stat[3])).replace(/^[·\s]+|(?:⚠️|\s)+$/g, '').trim(), 26), /⚠️/.test(line) ? 1 : 0];
      const into = lastOf('k');
      if (into) into.push(tile);
      else out.push(['k', [tile]]);
      continue;
    }
    const head = /^<b>([^<]{1,40})<\/b>$/.exec(line);
    if (head) {
      if (out.length && out[out.length - 1][0] === 'g' && !out[out.length - 1][1]) out.pop();
      out.push(['g', decode(head[1])]);
      continue;
    }
    out.push(['p', miniHtml(line)]);
  }
  while (out.length && out[out.length - 1][0] === 'g') out.pop();
  return out;
}

const size = (m: WidgetModel) => Buffer.byteLength(JSON.stringify(m));
const budget = (rev: number) => 2 * (PART - String(rev).length - 1);

/** Builds the model and the routes behind its buttons. `full` is set when anything had to be left out. */
export function toModel(s: Screen, rev: number, note = '') {
  const routes: Go[] = [];
  const idx = (b: Btn) => {
    routes.push(b.go!);
    return routes.length - 1;
  };
  const lines = s.text.split('\n');
  const first = lines.findIndex((l) => l.trim());
  const m: WidgetModel = { r: rev, h: cut(decode(strip(lines[first] ?? '')).trim(), 60) || 'Админка', b: blocks(lines.slice(first + 1)), a: [] };
  const n = decode(strip(note)).trim().replace(/\n+/g, ' ');
  if (n) {
    m.n = cut(n, 140);
    if (/^(⚠️|⛔)/.test(n)) m.ne = 1;
  }
  for (const row of s.rows) {
    if (row.every((b) => b.kind === 'tab')) {
      m.t = [...(m.t ?? []), ...row.map((b): [string, number, 0 | 1] => [b.text.replace(/^•\s|\s•$/g, ''), idx(b), b.on ? 1 : 0])];
      continue;
    }
    if (row.every((b) => b.kind === 'page')) {
      m.p = row.map((b, i): [string, number | null] => [b.text, i === 1 || b.text === '·' ? null : idx(b)]);
      continue;
    }
    // The footer has ↻ already.
    const kept = row.filter((b) => b.text !== '🔄');
    if (!kept.length) continue;
    m.a.push(kept.map((b): [string, number | string, string?] => (b.url ? [cut(b.text, 40), b.url] : [cut(b.text, 48), idx(b), (kept.length === 1 && b.text.length > 24 ? 'l ' : '') + tone(b.text)])));
  }

  // Over the budget: whole text blocks go first (from the end), then long lines are shortened, then labels.
  const max = budget(rev);
  const textual = () => m.b.map((b, i) => [b, i] as const).filter(([b]) => b[0] === 'p');
  while (size(m) > max && textual().length > 1) {
    m.b.splice(textual()[textual().length - 1][1], 1);
    m.u = 1;
  }
  for (const n of [240, 120, 60]) {
    if (size(m) <= max) break;
    m.b = m.b.map((b) => (b[0] === 'p' && strip(b[1] as string).length > n ? ((m.u = 1), ['p', clipRich(b[1] as string, n)]) : b));
  }
  if (size(m) > max) {
    m.b = m.b.filter((b) => b[0] !== 'p' && b[0] !== 'r');
    m.u = 1;
  }
  for (const n of [28, 18, 12]) {
    if (size(m) <= max) break;
    m.a = m.a.map((row) => row.map(([l, t, st]) => [cut(l, n), t, st]));
  }
  if (size(m) > max) m.b = [];
  return { model: m, routes, truncated: !!m.u };
}

/** The model as chat_data and public_data: `<rev>|<first half>` and `<rev>|<rest>`, each ≤ 1024 bytes. */
export function split(m: WidgetModel): [string, string] {
  const json = JSON.stringify(m);
  const head = `${m.r}|`;
  const room = PART - head.length;
  let i = 0;
  let bytes = 0;
  for (const ch of json) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > room) break;
    bytes += b;
    i += ch.length;
  }
  const rest = json.slice(i);
  if (Buffer.byteLength(rest) > room) throw new Error('widget model over budget');
  return [head + json.slice(0, i), head + rest];
}
