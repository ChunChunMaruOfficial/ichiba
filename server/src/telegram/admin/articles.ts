import type { Routes } from './ctx.js';
import { a, ask, btn, clip, dt, go, h, int, menu, pager, screen, site, str, tabs, toast, type Btn } from './ui.js';

interface Article {
  id: string;
  slug: string;
  rubric: string;
  title: string;
  description: string;
  body: string;
  status: string;
  rejectReason: string | null;
  aiTopic: string | null;
  aiVerdict: { fits?: boolean; reason?: string; checked?: boolean } | null;
  submittedAt: string | null;
  publishedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  words: number;
  author: { id: string; username: string; blockedAt: string | null; deletedAt: string | null };
}

const TABS = [
  ['PENDING', 'На проверке'],
  ['PUBLISHED', 'Опубликованы'],
  ['REJECTED', 'Отклонены'],
  ['AI_REJECTED', 'Отклонил ИИ'],
  ['all', 'Все'],
] as const;
const STATUS: Record<string, string> = { PENDING: '⏳ на проверке', PUBLISHED: '✅ опубликована', REJECTED: '✖️ отклонена', AI_REJECTED: '🤖 отклонил ИИ', DRAFT: 'черновик' };

/** Markdown to a readable excerpt: no markup characters, paragraphs kept. */
const excerpt = (md: string, n: number) => clip(md.replace(/[#>*_`]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\n{3,}/g, '\n\n').trim(), n);

function card(x: Article) {
  const v = x.aiVerdict;
  return [
    `<b>${x.status === 'PUBLISHED' ? a(clip(x.title, 150), `/journal/${x.slug}`) : h(clip(x.title, 150))}</b>`,
    `${STATUS[x.status] ?? h(x.status)} · ${h(x.rubric)} · ${x.words} слов`,
    `Автор @${h(x.author.username)}${x.author.blockedAt ? ' 🚫' : ''}${x.author.deletedAt ? ' 🗑' : ''} · отправлена ${dt(x.submittedAt)}`,
    v ? `🤖 ИИ: ${v.checked === false ? 'не проверял' : v.fits ? 'подходит' : 'не подходит'}${x.aiTopic ? ` · тема «${h(x.aiTopic)}»` : ''}${v.reason ? `\n<i>${h(clip(v.reason, 300))}</i>` : ''}` : '',
    '',
    `<i>${h(clip(x.description, 300))}</i>`,
    '',
    h(excerpt(x.body, 1600)),
    x.rejectReason ? `\n✖️ Причина: ${h(clip(x.rejectReason, 400))}` : '',
    x.reviewedBy ? `Решение @${h(x.reviewedBy)} ${dt(x.reviewedAt)}` : '',
  ]
    .filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== '')
    .join('\n');
}

export const articleRoutes: Routes = {
  async articles({ api, p }) {
    const tab = TABS.some(([t]) => t === p.tab) ? str(p.tab) : 'PENDING';
    const { items } = await api<{ items: Article[] }>('GET', `/admin/journal?status=${tab}`);
    const i = Math.min(int(p.i), Math.max(0, items.length - 1));
    const rows: Btn[][] = [...tabs(TABS, tab, 'articles')];
    if (!items.length) return screen(`📰 <b>Статьи</b>\n\n${tab === 'PENDING' ? 'На проверке ничего нет ✨' : 'Пусто'}`, [...rows, [menu()]]);
    const x = items[i];
    const P = { id: x.id, tab, i };
    const act: Btn[] = [];
    if (x.status !== 'PUBLISHED') act.push(btn('✅ Опубликовать', 'articles.publish', P));
    act.push(btn(x.status === 'PUBLISHED' ? '✖️ Снять с журнала' : '✖️ Вернуть автору', 'articles.reject', P));
    rows.push(act);
    if (x.status === 'PUBLISHED') rows.push(site('Открыть статью', `/journal/${x.slug}`));
    rows.push(pager('articles', { tab }, 'i', i, items.length));
    rows.push([btn('🔄', 'articles', { tab, i }), menu()]);
    return screen(`📰 <b>Статьи</b> · ${i + 1} из ${items.length}\n\n${card(x)}`, rows);
  },

  async 'articles.publish'({ p }) {
    return screen('✅ Опубликовать статью в журнале ichiba? Автор получит уведомление.', [[btn('✅ Опубликовать', 'articles.publishdo', p), btn('Отмена', 'articles', { tab: p.tab, i: p.i })]]);
  },
  async 'articles.publishdo'({ api, p }) {
    await api('POST', `/admin/journal/${str(p.id)}/publish`);
    return toast('✅ Опубликовано', go('articles', { tab: p.tab, i: p.i }));
  },
  async 'articles.reject'({ p }) {
    return ask('✖️ Причина — её увидит автор (от 3 символов):', go('articles.rejectdo', p), go('articles', { tab: p.tab, i: int(p.i) }));
  },
  async 'articles.rejectdo'({ api, p }) {
    await api('POST', `/admin/journal/${str(p.id)}/reject`, { reason: str(p.input) });
    return toast('✖️ Возвращено автору', go('articles', { tab: p.tab, i: p.i }));
  },
};
