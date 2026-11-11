/**
 * Deal cards: the notifications that wait for an answer — a buy request or an offer to a seller, a counter-offer to
 * either side — sent as a small widget (NOTICE_HTML) with «Принять / Отклонить» inside. This module only builds the
 * card's state; notifier.ts sends it, widget.ts answers its taps.
 */
import { appUrl } from '../mail/templates.js';
import type { NoticeCtx } from './widget-store.js';

/** Notification types that become deal cards. */
export const NOTICE_TYPES = new Set(['request_new', 'offer_new', 'offer_countered']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A link for the card's «Открыть на ichiba»: only https (Telegram opens nothing else). */
export function siteLink(path: string) {
  const url = `${appUrl()}${path}`;
  return url.startsWith('https://') && url.length <= 256 ? url : undefined;
}

/** The card for a notification, or null when the type isn't a deal card or the payload lacks its id. */
export function noticeFor(type: string, p: Record<string, unknown>): { ctx: NoticeCtx; state: Record<string, unknown>; caption: string } | null {
  const title = short(str(p.title), 80);
  if (type === 'request_new' && UUID.test(str(p.requestId))) {
    const id = str(p.requestId);
    const sewn = !!p.sewn;
    return {
      ctx: { k: 'r', id },
      state: {
        h: sewn ? '✂️ Пошив по меркам' : '🛍 Хотят купить',
        w: `@${str(p.buyer)} ${sewn ? 'просит сшить по своим меркам' : 'хочет купить'}`,
        t: title,
        p: num(p.price),
        m: 'Ответьте в течение 48 часов — иначе запрос отменится сам',
        a: 1,
        u: siteLink(`/deals/${id}`),
      },
      caption: `🛍 @${str(p.buyer)} хочет купить «${title}» за ${num(p.price) ?? '—'} BYN`,
    };
  }
  if ((type === 'offer_new' || type === 'offer_countered') && UUID.test(str(p.offerId))) {
    const id = str(p.offerId);
    const counter = type === 'offer_countered';
    const listingId = UUID.test(str(p.listingId)) ? str(p.listingId) : null;
    return {
      ctx: { k: 'o', id },
      state: {
        h: counter ? '↔️ Встречное предложение' : '💬 Предложение цены',
        w: `@${str(counter ? p.by : p.buyer)} предлагает`,
        t: title,
        p: num(p.amount),
        o: counter ? null : num(p.price),
        a: 1,
        u: siteLink(counter ? (listingId ? `/item/${listingId}` : '/purchases') : '/sales'),
      },
      caption: `${counter ? '↔️' : '💬'} @${str(counter ? p.by : p.buyer)} предлагает ${num(p.amount) ?? '—'} BYN за «${title}»`,
    };
  }
  return null;
}
