import { qs } from './api.js';
import type { Ctx, Routes } from './ctx.js';
import { parseValue } from './db.js';
import { ask, btn, clip, go, h, menu, screen, str, toast, type Btn } from './ui.js';

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  enumValues: string[] | null;
  pk: boolean;
  secret: boolean;
}

/** Rows of these are never hard-deleted from the panel (the API refuses too). */
const NO_DELETE = new Set(['User', 'Listing', 'Thread', 'Message', 'ModerationAction', 'BuyRequest', 'Review', 'Report']);
const show = (v: unknown, n = 160) => (v === null || v === undefined ? '<i>NULL</i>' : h(clip(typeof v === 'object' ? JSON.stringify(v) : String(v), n)));
const keyText = (key: Record<string, unknown>) => Object.entries(key).map(([k, v]) => `${h(k)}=${h(clip(String(v), 40))}`).join(', ');

async function fetchRow(api: Ctx['api'], table: string, key: Record<string, unknown>) {
  const r = await api<{ columns: Column[]; rows: Array<Record<string, unknown>> }>('GET', `/admin/db/${encodeURIComponent(table)}${qs({ filter: JSON.stringify(key) })}`);
  return { columns: r.columns, row: r.rows[0] ?? null };
}
const keyOf = (p: Record<string, unknown>) => (p.key && typeof p.key === 'object' ? (p.key as Record<string, unknown>) : {});
const backTo = (p: Record<string, unknown>) => (p.back && typeof p.back === 'object' ? (p.back as Record<string, unknown>) : { table: p.table });

export const dbRowRoutes: Routes = {
  async 'db.row'({ api, p }) {
    const table = str(p.table);
    const { columns, row } = await fetchRow(api, table, keyOf(p));
    if (!row) return toast('Строка не найдена', go('db.table', backTo(p)), true);
    const lines = [`🗄 <b>${h(table)}</b> · ${keyText(keyOf(p))}`, ''];
    for (const c of columns) lines.push(`${c.pk ? '🔑 ' : c.secret ? '🔒 ' : ''}<b>${h(c.name)}</b>: ${show(row[c.name])}`);
    const R = { table, key: p.key, back: p.back };
    const rows: Btn[][] = [[btn('✏️ Изменить поле', 'db.cols', R)]];
    if (!NO_DELETE.has(table)) rows.push([btn('🗑 Удалить строку', 'db.del', R)]);
    rows.push([btn('← К таблице', 'db.table', backTo(p)), menu()]);
    return screen(lines.join('\n'), rows);
  },

  async 'db.cols'({ api, p }) {
    const { columns } = await fetchRow(api, str(p.table), keyOf(p));
    const editable = columns.filter((c) => !c.secret && !c.pk);
    const rows: Btn[][] = [];
    for (let i = 0; i < editable.length; i += 3) rows.push(editable.slice(i, i + 3).map((c) => btn(c.name, 'db.edit', { ...p, col: c.name })));
    rows.push([btn('← К строке', 'db.row', p)]);
    return screen(`✏️ <b>${h(str(p.table))}</b> · какое поле изменить?\n\n<i>Ключи и секретные колонки не меняются.</i>`, rows);
  },

  async 'db.edit'({ api, p }) {
    const { columns, row } = await fetchRow(api, str(p.table), keyOf(p));
    const col = columns.find((c) => c.name === p.col && !c.secret && !c.pk);
    if (!col || !row) return toast('Поле недоступно', go('db.row', p), true);
    const hint = [
      `тип <code>${h(col.type)}</code>`,
      col.enumValues ? `значения: ${col.enumValues.map((v) => `<code>${h(v)}</code>`).join(', ')}` : '',
      col.type.endsWith('[]') ? 'массив в JSON: <code>["a","b"]</code>' : '',
      col.nullable ? '<code>NULL</code> — пустое значение' : '',
    ].filter(Boolean);
    return ask(`✏️ <b>${h(str(p.table))}.${h(col.name)}</b>\n\nСейчас: ${show(row[col.name], 800)}\n\n${hint.join(' · ')}\n\nНовое значение:`, go('db.confirm', { ...p, input: undefined }), go('db.row', p));
  },

  async 'db.confirm'({ api, p }) {
    const { columns, row } = await fetchRow(api, str(p.table), keyOf(p));
    const col = columns.find((c) => c.name === p.col && !c.secret && !c.pk);
    if (!col || !row) return toast('Поле недоступно', go('db.row', p), true);
    const parsed = parseValue(col, str(p.input));
    if (!parsed.ok) return ask(`⚠️ ${h(parsed.error)}\n\nВведите значение <b>${h(col.name)}</b> ещё раз:`, go('db.confirm', { ...p, input: undefined }), go('db.row', p));
    const R = { table: p.table, key: p.key, back: p.back, col: col.name, value: parsed.value };
    return screen(`⚠️ <b>Изменить строку ${h(str(p.table))}?</b>\n${keyText(keyOf(p))}\n\n<b>${h(col.name)}</b>\nбыло: ${show(row[col.name], 600)}\nстанет: ${show(parsed.value, 600)}\n\n<i>Правка попадёт в журнал модерации.</i>`, [
      [btn('💾 Сохранить', 'db.save', R), btn('Отмена', 'db.row', R)],
    ]);
  },

  async 'db.save'({ api, p }) {
    await api('PATCH', `/admin/db/${encodeURIComponent(str(p.table))}`, { key: keyOf(p), set: { [str(p.col)]: p.value } });
    return toast('💾 Сохранено', go('db.row', { table: p.table, key: p.key, back: p.back }));
  },

  async 'db.del'({ p }) {
    return screen(`🗑 Удалить строку <b>${h(str(p.table))}</b> (${keyText(keyOf(p))})? Отменить нельзя.`, [[btn('Дальше →', 'db.del2', p), btn('Отмена', 'db.row', p)]]);
  },
  async 'db.del2'({ p }) {
    return screen('⚠️ Точно удалить? Это последнее подтверждение.', [[btn('🗑 Да, удалить', 'db.deldo', p), btn('Отмена', 'db.row', p)]]);
  },
  async 'db.deldo'({ api, p }) {
    await api('DELETE', `/admin/db/${encodeURIComponent(str(p.table))}`, { key: keyOf(p) });
    return toast('🗑 Строка удалена', go('db.table', backTo(p)), true);
  },
};
