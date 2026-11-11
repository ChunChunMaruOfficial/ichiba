import type { Routes } from './ctx.js';
import { ask, btn, clip, dt, go, h, int, menu, pager, screen, str, tabs, toast, type Btn } from './ui.js';

interface Complaint {
  id: string;
  number: number;
  name: string;
  email: string;
  topic: string;
  about: string | null;
  text: string;
  status: string;
  answer: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
  createdAt: string;
  username: string | null;
}

const TABS = [
  ['NEW', 'Новые'],
  ['ANSWERED', 'Отвеченные'],
  ['all', 'Все'],
] as const;
const TOPIC: Record<string, string> = { DEAL: 'Сделка', SELLER: 'Продавец', ITEM: 'Вещь', SITE: 'Работа сайта', DATA: 'Персональные данные', OTHER: 'Другое' };
const DEADLINE_DAYS = 15;

function card(c: Complaint) {
  const left = DEADLINE_DAYS - Math.floor((Date.now() - new Date(c.createdAt).getTime()) / 86_400_000);
  const lines = [
    `<b>Обращение № ${c.number}</b> · ${h(TOPIC[c.topic] ?? c.topic)}`,
    `${h(c.name)} · ${h(c.email)}${c.username ? ` · @${h(c.username)}` : ''}`,
    `${dt(c.createdAt)}${c.status === 'NEW' ? ` · ${left > 0 ? `осталось ${left} дн.` : '⛔️ срок ответа истёк'}` : ''}`,
  ];
  if (c.about) lines.push(`О чём: ${h(clip(c.about, 300))}`);
  lines.push('', h(clip(c.text, 2000)));
  if (c.answer) lines.push('', `✉️ <b>Ответ</b> ${c.answeredBy ? `@${h(c.answeredBy)} ` : ''}${dt(c.answeredAt)}`, h(clip(c.answer, 1000)));
  return lines.join('\n');
}

export const complaintRoutes: Routes = {
  async complaints({ api, p }) {
    const tab = TABS.some(([t]) => t === p.tab) ? str(p.tab) : 'NEW';
    const { items } = await api<{ items: Complaint[] }>('GET', `/admin/complaints?status=${tab}`);
    const i = Math.min(int(p.i), Math.max(0, items.length - 1));
    const rows: Btn[][] = [...tabs(TABS, tab, 'complaints')];
    if (!items.length) return screen(`📮 <b>Обращения</b>\n\n${tab === 'NEW' ? 'Новых обращений нет ✨' : 'Пусто'}`, [...rows, [menu()]]);
    const c = items[i];
    if (c.status === 'NEW') rows.push([btn('✍️ Ответить на почту', 'complaints.write', { id: c.id, n: c.number, tab, i })]);
    rows.push(pager('complaints', { tab }, 'i', i, items.length));
    rows.push([btn('🔄', 'complaints', { tab, i }), menu()]);
    return screen(`📮 <b>Обращения</b> · ${i + 1} из ${items.length}\n\n${card(c)}`, rows);
  },

  async 'complaints.write'({ p }) {
    return ask(
      `✍️ Ответ на обращение № ${int(p.n)}\n\nНапишите ответ одним сообщением (от 10 символов). Он уйдёт письмом на почту автора — перед отправкой покажу, как он выглядит.\n\n<i>Пустая строка между абзацами — новый абзац.</i>`,
      go('complaints.preview', p),
      go('complaints', { tab: p.tab, i: p.i }),
    );
  },

  async 'complaints.preview'({ p }) {
    const answer = str(p.input).trim();
    if (answer.length < 10) return ask('⚠️ Слишком коротко — нужно от 10 символов. Напишите ответ ещё раз.', go('complaints.preview', { ...p, input: undefined }), go('complaints', { tab: p.tab, i: p.i }));
    const text = `✉️ <b>Ответ на обращение № ${int(p.n)}</b>\n\n${h(clip(answer, 3000))}\n\n<i>Ответ окончательный: после отправки его не изменить.</i>`;
    return screen(text, [
      [btn('📤 Отправить', 'complaints.send', { id: p.id, answer, tab: p.tab, i: p.i })],
      [btn('✏️ Переписать', 'complaints.write', { id: p.id, n: p.n, tab: p.tab, i: p.i }), btn('Отмена', 'complaints', { tab: p.tab, i: p.i })],
    ]);
  },

  async 'complaints.send'({ api, p }) {
    await api('POST', `/admin/complaints/${str(p.id)}/answer`, { answer: str(p.answer) });
    return toast('📤 Ответ отправлен на почту', go('complaints', { tab: p.tab, i: p.i }));
  },
};
