/**
 * How each notification reads in Telegram: an emoji, a bold heading, the same sentence the site shows in 🔔
 * (client/src/lib/notifications.ts — keep the two in step) and where «Открыть» leads. HTML parse mode: every
 * user-provided string goes through `h`.
 */
import { esc as h } from '../mail/templates.js';

type P = Record<string, unknown>;
const s = (v: unknown) => h(v ?? '');
const t = (p: P) => `«${s(p.title)}»`;
const lower = (v: unknown) => s(String(v ?? '').toLowerCase());
const byn = (v: unknown) => `${typeof v === 'number' ? v.toLocaleString('ru-RU') : s(v)} BYN`;
const stars = (n: unknown) => '★'.repeat(Math.min(5, Math.max(0, Number(n) || 0)));

/** Groups a user can switch off one by one in settings. */
export const TG_CATEGORIES = ['deals', 'offers', 'auctions', 'chat', 'favorites', 'account'] as const;
export type TgCategory = (typeof TG_CATEGORIES)[number];
export type TgPrefs = Record<TgCategory, boolean>;
/** Everything is on until switched off. */
export const tgPrefsOf = (raw: unknown): TgPrefs => Object.fromEntries(TG_CATEGORIES.map((c) => [c, (raw as Partial<TgPrefs> | null)?.[c] !== false])) as TgPrefs;

export const categoryOf = (type: string): TgCategory => {
  if (type.startsWith('offer_')) return 'offers';
  if (type.startsWith('auction_')) return 'auctions';
  if (/^(request_|deal_|dispute_|review_)/.test(type)) return 'deals';
  if (['price_drop', 'item_reserved', 'item_sold', 'item_available', 'follow_new_item'].includes(type)) return 'favorites';
  return 'account';
};

/** [emoji, heading, sentence]. */
const TEXT: Record<string, (p: P) => [string, string, string]> = {
  request_new: (p) => ['🛍', 'Хотят купить', `@${s(p.buyer)} хочет купить ${t(p)} за <b>${byn(p.price)}</b>\n\n<i>Ответьте в течение 48 часов — иначе запрос отменится сам.</i>`],
  request_accepted: (p) =>
    p.confirmed ? ['🤝', 'Сделка подтверждена', `@${s(p.buyer)} выбрал способ получения ${t(p)} — договоритесь о передаче`] : ['✅', 'Продавец подтвердил', `@${s(p.seller)} подтвердил запрос на ${t(p)}`],
  request_declined: (p) => ['✖️', 'Запрос отклонён', `Продавец отклонил запрос на ${t(p)}${p.reason ? `: ${lower(p.reason)}` : ''}`],
  request_cancelled: (p) => ['✖️', 'Сделка отменена', `Сделка по ${t(p)} отменена`],
  request_expired: (p) => ['⌛', 'Запрос отменён', p.reason ? `Запрос на ${t(p)} отменён: ${lower(p.reason)}` : `Запрос на ${t(p)} отменён — не было ответа 48 часов`],
  dispute_opened: (p) => ['⚠️', 'Открыт спор', `${p.by === 'buyer' ? 'Покупатель' : 'Продавец'} открыл спор по ${t(p)}${p.reason ? `: ${s(p.reason)}` : ''} — сделка заморожена до решения администратора`],
  dispute_resolved: (p) => ['⚖️', 'Спор решён', `Спор по ${t(p)} решён: ${p.outcome === 'complete' ? 'сделка завершена' : 'сделка отменена'}${p.reason ? ` — ${s(p.reason)}` : ''}`],
  deal_handed_over: (p) => ['📦', 'Вещь передана', `Продавец отметил ${t(p)} как переданную — подтвердите получение`],
  deal_in_transit: (p) => ['🚚', 'В пути', `${t(p)} в пути${p.trackingNumber ? `, трек <code>${s(p.trackingNumber)}</code>` : ''}`],
  deal_completed: (p) => ['🎉', 'Сделка завершена', `Сделка по ${t(p)} завершена${Array.isArray(p.sizes) && p.sizes.length ? ` · продан размер ${s(p.sizes.join(', '))} — уберите его из наличия` : ''}`],
  brand_approved: (p) => ['🏮', 'Статус бренда подтверждён', `Статус бренда «${s(p.brand)}» подтверждён — печать «Бренд» уже на ваших вещах`],
  brand_rejected: (p) => ['📝', 'Заявка на бренд отклонена', `Заявка на статус бренда «${s(p.brand)}» отклонена${p.note ? `: ${s(p.note)}` : ''}`],
  catalog_approved: () => ['🏮', 'Вы в основном каталоге', 'Вас допустили в основной каталог — новые вещи с биркой теперь показываются там'],
  catalog_rejected: (p) => ['📝', 'Заявка в каталог отклонена', `Заявка на размещение в основном каталоге отклонена${p.note ? `: ${s(p.note)}` : ''}`],
  price_drop: (p) => ['🏷', 'Цена снижена', `${t(p)} — <b>${byn(p.newPrice)}</b> вместо <s>${s(p.oldPrice)}</s>`],
  item_reserved: (p) => ['🔒', 'Зарезервирована', `${t(p)} из избранного зарезервирована`],
  item_sold: (p) => ['🔒', 'Продана', `${t(p)} из избранного продана`],
  item_available: (p) => ['🔓', 'Снова в продаже', `${t(p)} снова в продаже`],
  offer_new: (p) => ['💬', 'Предложение цены', `@${s(p.buyer)} предлагает <b>${byn(p.amount)}</b> за ${t(p)}${p.price != null ? ` вместо ${s(p.price)}` : ''}`],
  offer_countered: (p) => ['↔️', 'Встречное предложение', `@${s(p.by)} предлагает <b>${byn(p.amount)}</b> за ${t(p)}`],
  offer_accepted: (p) => ['🤝', 'Предложение принято', `Предложение ${byn(p.amount)} за ${t(p)} принято`],
  offer_declined: (p) => ['✖️', 'Предложение отклонено', p.auto ? `Продавец не готов продать ${t(p)} за ${byn(p.amount)}` : `Предложение ${byn(p.amount)} за ${t(p)} отклонено`],
  offer_expired: (p) => ['⌛', 'Предложение истекло', `Предложение ${byn(p.amount)} за ${t(p)} истекло`],
  offer_likers: (p) => ['🎁', 'Цена для вас', `@${s(p.seller)} снизил цену для вас: ${t(p)} за <b>${byn(p.amount)}</b> вместо ${s(p.price)} — 48 часов`],
  offer_auto_accepted: (p) => ['🤝', 'Предложение принято автоматически', `Предложение @${s(p.buyer)} ${byn(p.amount)} за ${t(p)} принято автоматически — сделка открыта`],
  follow_new_item: (p) => ['✨', 'Новая вещь', `@${s(p.seller)} выставил ${t(p)}`],
  listing_blocked: (p) => ['🚫', 'Вещь снята', `${t(p)} снята модератором${p.reason ? `: ${s(p.reason)}` : ''}`],
  listing_unblocked: (p) => ['✅', 'Снова опубликована', `${t(p)} снова опубликована`],
  listing_scheduled_published: (p) => ['🗓', 'Опубликовано', `${t(p)} опубликована по расписанию`],
  listing_schedule_failed: (p) => ['⚠️', 'Не опубликовано', `Не получилось опубликовать ${t(p)} по расписанию${p.reason ? `: ${lower(p.reason)}` : ''} — откройте черновик`],
  auction_bid: (p) => ['🔨', 'Новая ставка', `Новая ставка <b>${byn(p.amount)}</b> на ${t(p)}`],
  auction_outbid: (p) => ['📉', 'Ставку перебили', p.auto ? `Ваша автоставка на ${t(p)} исчерпана: теперь ${byn(p.amount)}` : `Вашу ставку на ${t(p)} перебили: теперь ${byn(p.amount)}`],
  auction_won: (p) => ['🏆', 'Победа', p.buyNow ? `Вы выкупили ${t(p)} за ${byn(p.amount)} — выберите способ получения` : `Вы выиграли аукцион ${t(p)} за ${byn(p.amount)} — выберите способ получения`],
  auction_runner_up: (p) => ['🏆', 'Вещь ваша', `Победитель не вышел на связь — ${t(p)} ваша за ${byn(p.amount)}. Выберите способ получения`],
  auction_sold: (p) => ['🔨', 'Аукцион завершён', p.buyNow ? `${t(p)} выкупили по цене «Купить сейчас»: ${byn(p.amount)}` : `Аукцион ${t(p)} завершён: <b>${byn(p.amount)}</b>`],
  auction_bought_out: (p) => ['🔨', 'Выкуплено', `${t(p)} выкупили по цене «Купить сейчас» (${byn(p.amount)}) — аукцион завершён`],
  auction_no_sale: (p) => ['🔨', 'Без продажи', p.reason === 'reserve' ? `Аукцион ${t(p)} завершён: резервная цена не достигнута` : `Аукцион ${t(p)} завершён без продажи — вещь осталась в продаже`],
  review_new: (p) => ['⭐', 'Новый отзыв', `@${s(p.buyer)} оставил отзыв: ${stars(p.rating)}${p.title ? ` — ${t(p)}` : ''}`],
  review_reply: (p) => ['💬', 'Ответ на отзыв', `@${s(p.seller)} ответил на ваш отзыв`],
  review_request: (p) => ['⭐', 'Оцените сделку', p.reminder ? `Как прошла сделка с @${s(p.seller)}? Оставьте отзыв — это займёт минуту` : `Сделка завершена — оцените @${s(p.seller)}`],
};

/** The message for a notification, HTML. */
export function notificationMessage(type: string, p: P) {
  const [emoji, heading, line] = TEXT[type]?.(p) ?? ['🔔', 'Уведомление', 'Новое уведомление на ichiba'];
  return `${emoji} <b>${h(heading)}</b>\n\n${line}`;
}

/** Same paths as notificationHref on the client. */
export function notificationPath(type: string, p: P) {
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
  const listingId = str('listingId');
  const requestId = str('requestId');
  if ((type === 'auction_won' || type === 'auction_runner_up') && listingId && requestId) return `/buy/${listingId}?request=${requestId}`;
  if ((type === 'offer_accepted' || type === 'offer_auto_accepted') && requestId) return `/deals/${requestId}`;
  if (type === 'listing_schedule_failed' && listingId) return `/item/${listingId}/edit`;
  if (type === 'review_request' && requestId) return `/deals/${requestId}#review`;
  if (type === 'review_new' || type === 'review_reply') return requestId ? `/deals/${requestId}#review` : '/wardrobe?tab=reviews';
  if (type.startsWith('offer_') && listingId) return type === 'offer_new' ? '/sales' : `/item/${listingId}`;
  if (requestId) return `/deals/${requestId}`;
  if (listingId) return `/item/${listingId}`;
  return '/notifications';
}

/** Label of the «open on the site» button. */
export function openLabel(type: string) {
  if (type.startsWith('request_') || type.startsWith('deal_') || type.startsWith('dispute_')) return 'Открыть сделку';
  if (type === 'auction_won' || type === 'auction_runner_up') return 'Выбрать способ получения';
  if (type.startsWith('review_')) return 'Открыть отзыв';
  if (type === 'listing_schedule_failed') return 'Открыть черновик';
  return 'Открыть на ichiba';
}

/** A new chat message, for the other side of the conversation. */
export function chatMessage(from: string, title: string, preview: string) {
  return `✉️ <b>@${h(from)}</b> · ${t({ title })}\n\n${h(preview.length > 600 ? `${preview.slice(0, 600)}…` : preview)}`;
}
