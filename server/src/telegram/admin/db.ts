import { qs } from './api.js';
import type { Ctx, Routes } from './ctx.js';
import { ask, btn, clip, go, h, int, menu, pager, screen, str, toast, type Btn } from './ui.js';

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  enumValues: string[] | null;
  pk: boolean;
  secret: boolean;
}
interface Rows {
  table: string;
  columns: Column[];
  total: number;
  rows: Array<Record<string, unknown>>;
}

const TABLES_PER_PAGE = 30;
const ROWS_PER_PAGE = 8;
const API_PAGE = 50;

const keyOf = (cols: Column[], row: Record<string, unknown>) => Object.fromEntries(cols.filter((c) => c.pk).map((c) => [c.name, row[c.name]]));
const rowsOf = (api: Ctx['api'], table: string, p: Record<string, unknown>) =>
  api<Rows>('GET', `/admin/db/${encodeURIComponent(table)}${qs({ q: p.q, page: p.apiPage, sort: p.sort, dir: p.dir, filter: p.filter ? JSON.stringify(p.filter) : undefined })}`);

/** A typed value as the API expects it: NULL, arrays as JSON, booleans in words or digits, anything else as text. */
export function parseValue(col: Column, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = raw.trim();
  if (t.toUpperCase() === 'NULL') return col.nullable ? { ok: true, value: null } : { ok: false, error: 'Колонка не допускает NULL' };
  if (col.type.endsWith('[]')) {
    try {
      const v = JSON.parse(t) as unknown;
      return Array.isArray(v) ? { ok: true, value: v } : { ok: false, error: 'Нужен JSON-массив, например ["a","b"]' };
    } catch {
      return { ok: false, error: 'Нужен JSON-массив, например ["a","b"]' };
    }
  }
  if (/^jsonb?$/.test(col.type)) {
    try {
      JSON.parse(t);
      return { ok: true, value: t };
    } catch {
      return { ok: false, error: 'Нужен корректный JSON' };
    }
  }
  if (col.type === 'boolean') {
    if (/^(true|да|1|yes)$/i.test(t)) return { ok: true, value: 'true' };
    if (/^(false|нет|0|no)$/i.test(t)) return { ok: true, value: 'false' };
    return { ok: false, error: 'Нужно true или false' };
  }
  if (col.enumValues && !col.enumValues.includes(t)) return { ok: false, error: `Одно из: ${col.enumValues.join(', ')}` };
  return { ok: true, value: raw };
}

export const dbRoutes: Routes = {
  async db({ api, p }) {
    const { tables } = await api<{ tables: Array<{ name: string }> }>('GET', '/admin/db');
    const pages = Math.max(1, Math.ceil(tables.length / TABLES_PER_PAGE));
    const page = Math.min(int(p.page), pages - 1);
    const list = tables.slice(page * TABLES_PER_PAGE, (page + 1) * TABLES_PER_PAGE);
    const rows: Btn[][] = [];
    for (let i = 0; i < list.length; i += 3) rows.push(list.slice(i, i + 3).map((t) => btn(t.name, 'db.table', { table: t.name })));
    rows.push(pager('db', {}, 'page', page, pages));
    rows.push([menu()]);
    return screen(`🗄 <b>База данных</b>\n\nТаблиц: <b>${tables.length}</b>. Секретные колонки (хэши, токены, пароли) скрыты и не редактируются, все правки попадают в журнал модерации.`, rows);
  },

  async 'db.table'({ api, p }) {
    const table = str(p.table);
    const page = int(p.page);
    const res = await rowsOf(api, table, { ...p, apiPage: Math.floor((page * ROWS_PER_PAGE) / API_PAGE) + 1 });
    const offset = (page * ROWS_PER_PAGE) % API_PAGE;
    const pages = Math.max(1, Math.ceil(res.total / ROWS_PER_PAGE));
    const text = res.columns.filter((c) => !c.secret && !c.pk && /text|char|citext/.test(c.type)).slice(0, 2);
    const T = { table, q: p.q, sort: p.sort, dir: p.dir };
    const rows: Btn[][] = res.rows.slice(offset, offset + ROWS_PER_PAGE).map((r) => {
      const key = keyOf(res.columns, r);
      const label = [Object.values(key).map((v) => clip(String(v), 10)).join('/'), ...text.map((c) => clip(String(r[c.name] ?? '∅'), 18))].join(' · ');
      return [btn(label || '(строка)', 'db.row', { table, key, back: { ...T, page } })];
    });
    rows.push(pager('db.table', T, 'page', Math.min(page, pages - 1), pages));
    rows.push([btn(p.q ? `🔎 «${clip(p.q, 14)}» ✕` : '🔎 Поиск', p.q ? 'db.table' : 'db.find', { ...T, q: '' }), btn(p.dir === 'asc' ? '⬆️ Старые' : '⬇️ Новые', 'db.table', { ...T, dir: p.dir === 'asc' ? 'desc' : 'asc' })]);
    rows.push([btn('← Таблицы', 'db'), menu()]);
    const cols = res.columns.map((c) => `${c.pk ? '🔑' : ''}${c.secret ? '🔒' : ''}${h(c.name)}`).join(', ');
    return screen(`🗄 <b>${h(table)}</b>${p.q ? ` · «${h(p.q)}»` : ''}\n\nСтрок: <b>${res.total}</b>\n<i>${clip(cols, 900)}</i>`, rows);
  },
  async 'db.find'({ p }) {
    return ask('🔎 Что искать в текстовых колонках:', go('db.q', p), go('db.table', p));
  },
  async 'db.q'({ p }) {
    return toast('', go('db.table', { table: p.table, sort: p.sort, dir: p.dir, q: str(p.input).trim().slice(0, 100) }));
  },
};
