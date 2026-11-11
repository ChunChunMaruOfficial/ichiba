/**
 * Building blocks of the admin bot's screens. A screen is one message (HTML) and its inline keyboard; a button leads
 * to a route `{ r, p }` that the bot keeps on its side (see store.ts), so callback data never carries ids or text.
 * Every value from the database or a user goes through `h` (HTML-escaped) before it reaches Telegram.
 */
import { appUrl, esc } from '../../mail/templates.js';

export interface Go {
  r: string;
  p?: Record<string, unknown>;
}
export interface Btn {
  text: string;
  go?: Go;
  url?: string;
  /** How the widget draws it: a tab (`on` = the open one) or a pager arrow; plain buttons otherwise. */
  kind?: 'tab' | 'page';
  on?: boolean;
}
export interface Screen {
  kind?: 'screen';
  text: string;
  rows: Btn[][];
  /** Sensitive (a new password): replaced by a neutral screen after this many ms if still on display. */
  expireMs?: number;
}
/** Asks for a line of text; the answer is passed to `then` as `p.input`. `skip` adds a button that passes ''. */
export interface Ask {
  kind: 'ask';
  text: string;
  then: Go;
  back: Go;
  skip?: string;
  /** Delete the answer from the chat as soon as it is read (passwords). */
  secret?: boolean;
}
/** A short answer under the tapped button, then (optionally) another screen. */
export interface Toast {
  kind: 'toast';
  text: string;
  alert?: boolean;
  then?: Go;
  /** The action failed: shown as an alert, the screen stays as it was. */
  error?: boolean;
}
export type Result = Screen | Ask | Toast;

export const h = (v: unknown) => esc(v ?? '');
export const go = (r: string, p?: Record<string, unknown>): Go => ({ r, p });
export const btn = (text: string, r: string, p?: Record<string, unknown>): Btn => ({ text, go: go(r, p) });
export const ask = (text: string, then: Go, back: Go, opts: { skip?: string; secret?: boolean } = {}): Ask => ({ kind: 'ask', text, then, back, ...opts });
export const toast = (text: string, then?: Go, alert = false): Toast => ({ kind: 'toast', text, then, alert });
export const screen = (text: string, rows: Btn[][]): Screen => ({ text, rows: rows.filter((r) => r.length) });

/** A link to the site; Telegram refuses non-public addresses (localhost), so those become no button. */
export function site(text: string, path: string): Btn[] {
  const url = `${appUrl()}${path}`;
  return url.startsWith('https://') ? [{ text, url }] : [];
}
export const siteUrl = (path: string) => `${appUrl()}${path}`;
/** An HTML link when the site has a public address, plain text otherwise. */
export const a = (text: string, path: string) => (siteUrl(path).startsWith('https://') ? `<a href="${h(siteUrl(path))}">${h(text)}</a>` : h(text));

export const clip = (s: unknown, n: number) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
export const num = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('ru-RU') : h(n));
export const byn = (n: unknown) => `${num(n)} BYN`;

const TZ = 'Europe/Minsk';
export const dt = (d: unknown) => {
  if (!d) return '—';
  const x = new Date(String(d));
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export const day = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const time = (d: unknown) => new Date(String(d)).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** Tabs as one row of buttons; the active one is marked. */
export function tabs<T extends string>(items: ReadonlyArray<readonly [T, string]>, active: string, route: string, p: Record<string, unknown> = {}): Btn[][] {
  const row = items.map(([id, label]): Btn => ({ ...btn(id === active ? `• ${label} •` : label, route, { ...p, tab: id, i: 0, page: 0 }), kind: 'tab', on: id === active }));
  const out: Btn[][] = [];
  for (let i = 0; i < row.length; i += 3) out.push(row.slice(i, i + 3));
  return out;
}

/** ◀️ 2/7 ▶️ under a one-item-per-screen queue or a paged list. */
export function pager(route: string, p: Record<string, unknown>, key: 'i' | 'page', at: number, count: number): Btn[] {
  if (count <= 1) return [];
  return [
    btn(at > 0 ? '◀️' : '·', route, { ...p, [key]: Math.max(0, at - 1) }),
    btn(`${at + 1} / ${count}`, route, { ...p, [key]: at }),
    btn(at < count - 1 ? '▶️' : '·', route, { ...p, [key]: Math.min(count - 1, at + 1) }),
  ].map((b) => ({ ...b, kind: 'page' as const }));
}

export const back = (r = 'home', p?: Record<string, unknown>, text = '← Назад'): Btn => btn(text, r, p);
export const menu = (): Btn => btn('🏠 Меню', 'home');
export const int = (v: unknown, min = 0) => Math.max(min, Math.floor(Number(v) || 0));
export const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Telegram's limit is 4096 characters; screens stay well under it, this is the last line of defence. */
export function fit(html: string) {
  if (html.length <= 4000) return html;
  // Tags go (a cut could leave one open, which Telegram refuses), entities stay; a half-cut entity is dropped.
  const plain = html.replace(/<[^>]+>/g, '').slice(0, 3900).replace(/&[#a-z0-9]*$/i, '');
  return `${plain}\n\n…обрезано`;
}
