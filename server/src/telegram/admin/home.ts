import type { Routes } from './ctx.js';
import { btn, byn, h, num, screen, site, type Btn } from './ui.js';

export const LISTING_STATUS: Record<string, string> = {
  PUBLISHED: 'В продаже',
  RESERVED: 'Зарезервирована',
  SOLD: 'Продана',
  HIDDEN: 'Скрыта',
  BLOCKED: 'Заблокирована',
  DRAFT: 'Черновик',
  DELETED: 'Удалена',
};
export const DEAL_STATUS: Record<string, string> = {
  CREATED: 'Создана',
  PENDING_SELLER: 'Ждёт продавца',
  ACCEPTED: 'Принята',
  DECLINED: 'Отклонена',
  COUNTER_OFFERED: 'Встречная цена',
  WAITING_PAYMENT: 'Ждёт оплаты',
  WAITING_HANDOVER: 'Ждёт передачи',
  HANDED_OVER: 'Передана',
  IN_TRANSIT: 'В пути',
  RECEIVED: 'Получена',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
  DISPUTED: 'Спор',
};

const PROVIDER: Record<string, string> = { gemini: 'Google Gemini', mistral: 'Mistral', glm: 'Z.ai GLM' };
const FEATURE: Record<string, string> = {
  listing_autofill: 'Автозаполнение',
  listing_describe: 'Описание',
  price_suggest: 'Подсказка цены',
  photo_check: 'Проверка фото',
  negotiation_advice: 'Советы в торге',
  nl_search: 'Умный поиск',
  listing_moderation: 'Модерация',
  chat_antifraud: 'Антифрод чата',
  listing_seo: 'SEO вещей',
  journal_topic: 'Проверка статей',
};
const AI_ERROR: Record<string, string> = { auth: 'ключ не принят', quota: 'нет квоты', rate: 'лимит запросов', overloaded: 'перегружен', timeout: 'таймаут', network: 'сеть', bad_request: 'запрос отклонён' };

interface Stats {
  completedWeek: number;
  gmvWeek: number;
  users: number;
  newUsers: number;
  publishedWeek: number;
  openReports: number;
  listingsByStatus: Record<string, number>;
  dealsByStatus: Record<string, number>;
}
interface AiStatus {
  providers: Array<{ id: string; configured: boolean; available: boolean; disabledUntil: string | null; calls: number; failures: number; avgLatencyMs: number | null; lastError: { kind: string; model?: string } | null }>;
  last24h: Array<{ feature: string; runs: number; avgLatencyMs: number }>;
}

const bar = (n: number, max: number) => '▰'.repeat(Math.max(1, Math.round((n / Math.max(1, max)) * 8))).padEnd(8, '▱');
const breakdown = (data: Record<string, number>, label: Record<string, string>) => {
  const rows = Object.entries(data).sort((x, y) => y[1] - x[1]);
  if (!rows.length) return '<i>пока нет</i>';
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return rows.map(([k, n]) => `<code>${bar(n, max)}</code> ${num(n)} · ${h(label[k] ?? k)}`).join('\n');
};
const count = (n: number) => (n > 0 ? ` (${n})` : '');

export const homeRoutes: Routes = {
  async home({ api, admin }) {
    const safe = <T>(p: Promise<T>) => p.catch(() => null);
    const [stats, disputes, complaints, brands, journal] = await Promise.all([
      safe(api<Stats>('GET', '/admin/stats')),
      safe(api<{ items: unknown[] }>('GET', '/admin/disputes?status=open')),
      safe(api<{ items: unknown[] }>('GET', '/admin/complaints?status=NEW')),
      safe(api<{ items: unknown[] }>('GET', '/admin/brand-applications?status=PENDING')),
      safe(api<{ pending: number }>('GET', '/admin/journal?status=PENDING')),
    ]);
    const reports = stats?.openReports ?? 0;
    const waiting = reports + (disputes?.items.length ?? 0) + (complaints?.items.length ?? 0) + (brands?.items.length ?? 0) + (journal?.pending ?? 0);
    const text = [
      '🏮 <b>Админка ichiba</b>',
      `<i>@${h(admin.username)}</i>`,
      '',
      ...(stats ? [`Сделок за 7 дней: <b>${num(stats.completedWeek)}</b> на ${byn(stats.gmvWeek)}`] : []),
      waiting ? `Ждут решения: <b>${num(waiting)}</b>` : 'Очереди пусты ✨',
    ];
    const rows: Btn[][] = [
      [btn('📊 Обзор', 'overview'), btn(`🛡 Модерация${count(reports)}`, 'reports')],
      [btn(`⚖️ Споры${count(disputes?.items.length ?? 0)}`, 'disputes'), btn(`📮 Обращения${count(complaints?.items.length ?? 0)}`, 'complaints')],
      [btn('📦 Объявления', 'listings'), btn('👥 Пользователи', 'users')],
      [btn(`🏮 Бренды${count(brands?.items.length ?? 0)}`, 'brands'), btn(`📰 Статьи${count(journal?.pending ?? 0)}`, 'articles')],
      [btn('📜 Журнал', 'log'), btn('📥 Импорты', 'imports')],
      [btn('🗄 База данных', 'db'), btn('🔔 Уведомления', 'notify')],
      [...site('🌐 Админка на сайте', '/admin'), btn('🔒 Выйти', 'lock')],
    ];
    return screen(text.join('\n'), rows);
  },

  async overview({ api }) {
    const [s, ai] = await Promise.all([api<Stats>('GET', '/admin/stats'), api<AiStatus>('GET', '/ai/status').catch(() => null)]);
    const lines = [
      '📊 <b>Обзор</b>',
      '',
      `Завершённые сделки за 7 дней: <b>${num(s.completedWeek)}</b>`,
      `Оборот за 7 дней: <b>${byn(s.gmvWeek)}</b>`,
      '',
      `👥 Пользователи: <b>${num(s.users)}</b> (+${num(s.newUsers)} за неделю)`,
      `🆕 Опубликовано за неделю: <b>${num(s.publishedWeek)}</b>`,
      `🛡 Открытые жалобы: <b>${num(s.openReports)}</b>${s.openReports ? ' ⚠️' : ''}`,
      '',
      '<b>Вещи по статусам</b>',
      breakdown(s.listingsByStatus, LISTING_STATUS),
      '',
      '<b>Сделки по статусам</b>',
      breakdown(s.dealsByStatus, DEAL_STATUS),
    ];
    if (ai) {
      lines.push('', '<b>ИИ-ансамбль</b>');
      for (const p of ai.providers) {
        const state = !p.configured ? '⚪️ нет ключа' : p.available ? '🟢 голосует' : `🔴 отключён до ${p.disabledUntil ? new Date(p.disabledUntil).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Minsk', hour: '2-digit', minute: '2-digit' }) : '—'}`;
        const err = p.lastError ? ` · ошибка: ${h(AI_ERROR[p.lastError.kind] ?? p.lastError.kind)}${p.lastError.model ? ` (${h(p.lastError.model)})` : ''}` : '';
        lines.push(`${h(PROVIDER[p.id] ?? p.id)}: ${state} · ${num(p.calls)} вызовов, ${num(p.failures)} ошибок${p.avgLatencyMs != null ? `, ~${(p.avgLatencyMs / 1000).toFixed(1)} с` : ''}${err}`);
      }
      if (ai.last24h.length) lines.push('', '<i>За сутки:</i> ' + ai.last24h.map((f) => `${h(FEATURE[f.feature] ?? f.feature)} ${num(f.runs)}`).join(' · '));
    }
    return screen(lines.join('\n'), [[btn('🔄 Обновить', 'overview'), btn('🏠 Меню', 'home')]]);
  },
};
