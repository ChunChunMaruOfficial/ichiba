import { a, clip, h, time } from './ui.js';

/** Codes of server/src/activity/activity.ts in words, as client/src/app/admin/log names them. Deal steps are `deal_<status>`. */
export const ACTIONS: Record<string, string> = {
  listing_created: 'Создал вещь',
  listing_edited: 'Изменил вещь',
  price_changed: 'Изменил цену',
  listing_published: 'Выставил',
  listing_scheduled: 'Запланировал публикацию',
  listing_hidden: 'Снял с продажи',
  listing_bumped: 'Поднял',
  listing_sold: 'Продано',
  listing_deleted: 'Удалил вещь',
  offer_countered: 'Встречная цена',
  offer_accepted: 'Принял предложение',
  offer_declined: 'Отклонил предложение',
  likers_offer: 'Скидка лайкнувшим',
  auction_cancelled: 'Отменил аукцион',
  brand_applied: 'Заявка на бренд',
  profile_edited: 'Изменил профиль',
  look_created: 'Создал образ',
};
const DEALS: Record<string, string> = {
  accepted: 'принял',
  declined: 'отклонил',
  cancelled: 'отменил',
  handed_over: 'передал',
  in_transit: 'отправил',
  disputed: 'спор',
  completed: 'завершена',
  counter_offered: 'встречная цена',
  waiting_handover: 'ждёт передачи',
  waiting_payment: 'ждёт оплаты',
};
export const actionLabel = (code: string) => (code.startsWith('deal_') ? `Сделка: ${DEALS[code.slice(5)] ?? code.slice(5)}` : (ACTIONS[code] ?? code));

const EMOJI: Record<string, string> = {
  listing_created: '🆕',
  listing_edited: '✏️',
  price_changed: '🏷',
  listing_published: '🟢',
  listing_scheduled: '🗓',
  listing_hidden: '⏸',
  listing_bumped: '⬆️',
  listing_sold: '💰',
  listing_deleted: '🗑',
  offer_countered: '↔️',
  offer_accepted: '🤝',
  offer_declined: '✖️',
  likers_offer: '🎁',
  auction_cancelled: '🔨',
  brand_applied: '🏮',
  profile_edited: '👤',
  look_created: '👗',
};
export const actionEmoji = (code: string) => (code.startsWith('deal_') ? (code === 'deal_disputed' ? '⚠️' : code === 'deal_completed' ? '🎉' : '🤝') : (EMOJI[code] ?? '•'));

/** Groups an admin turns on and off for journal notifications. */
export const LOG_GROUPS = {
  listings: { label: '📦 Вещи: создание, правки, публикация, снятие', match: (c: string) => /^listing_(created|edited|published|scheduled|hidden|bumped|deleted)$/.test(c) || c === 'look_created' },
  prices: { label: '🏷 Цены и скидки', match: (c: string) => c === 'price_changed' || c === 'likers_offer' },
  sales: { label: '💰 Продажи и сделки', match: (c: string) => c === 'listing_sold' || c.startsWith('deal_') },
  offers: { label: '💬 Предложения и аукционы', match: (c: string) => c.startsWith('offer_') || c.startsWith('auction_') },
  account: { label: '👤 Профили и заявки', match: (c: string) => c === 'profile_edited' || c === 'brand_applied' },
} as const;
export type LogGroup = keyof typeof LOG_GROUPS;
export const groupOf = (code: string): LogGroup => (Object.entries(LOG_GROUPS).find(([, g]) => g.match(code))?.[0] as LogGroup | undefined) ?? 'account';

export interface LogRow {
  at: string | Date;
  action: string;
  detail: string | null;
  market: 'brands' | 'resale' | null;
  seller: { username: string; brand: string | true | null } | null;
  listing: { id: string; title: string; status?: string } | null;
}

/** One line of the journal: time, who, what, which item. HTML. */
export function logLine(r: LogRow, withTime = true) {
  const who = r.seller ? `@${h(r.seller.username)}${r.seller.brand ? ' 🏮' : ''}` : '—';
  const item = r.listing ? ` ${a(`«${clip(r.listing.title, 40)}»`, `/item/${r.listing.id}`)}` : '';
  const detail = r.detail ? ` · <i>${h(clip(r.detail, 60))}</i>` : '';
  const market = r.market === 'resale' ? ' · втор.' : '';
  return `${withTime ? `<code>${time(r.at)}</code> ` : ''}${actionEmoji(r.action)} ${who} — ${h(actionLabel(r.action))}${item}${detail}${market}`;
}
