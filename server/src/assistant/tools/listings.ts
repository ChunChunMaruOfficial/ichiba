import { z } from 'zod';
import { recordActivity } from '../../activity/activity.js';
import { nextBumpAt } from '../../stats/stats.js';
import { clip, findMyListings, lines, ListingFilter, things, type MyListing } from '../my-listings.js';
import { Refusal, type Tool } from '../types.js';
import { capNote, current, each, failedNote, none, sameTime } from './shared.js';

const OnlyFilter = z.object({ filter: ListingFilter }).strict();
type OnlyFilterT = z.infer<typeof OnlyFilter>;

const when = (d: Date) => d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' });

interface BumpSnap {
  items: Array<{ id: string; title: string; liftedAt: string | null; lastBumpAt: string | null; bumpsCount: number; setAt: string }>;
}

export const bump: Tool<OnlyFilterT> = {
  name: 'bump',
  about: 'Поднять свои вещи в начало «Новинок» и поиска. Каждую вещь можно поднимать раз в 72 часа (первый раз — через 24 часа после публикации); те, что на паузе, пропускаются. Без уточнений берёт вещи с наименьшим числом просмотров.',
  args: OnlyFilter,
  kind: 'write',
  async run(ctx, { filter }) {
    // The limit applies to what can be bumped now, not to the first N found.
    const { items } = await findMyListings(ctx.prisma, ctx.userId, { ...filter, status: 'on_sale', order: filter.order ?? 'least_viewed', limit: undefined });
    if (!items.length) throw none('Вещей в продаже не нашлось');
    const now = Date.now();
    const ready = items.filter((l) => (nextBumpAt(l)?.getTime() ?? Infinity) <= now).slice(0, filter.limit ?? items.length);
    if (!ready.length) {
      const soonest = items.map((l) => nextBumpAt(l)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
      throw new Refusal(`Сейчас поднять нечего: все подходящие вещи на паузе.${soonest ? ` Ближайшую можно поднять ${when(soonest)}.` : ''}`);
    }
    const { done, failed } = await each<MyListing, Date>(ready, async (l) => (await ctx.listings.bump(ctx.userId, l.id)).liftedAt);
    if (!done.length) throw new Refusal(`Поднять не получилось.${failedNote(failed)}`);
    const snapshot: BumpSnap = {
      items: done.map(({ item, result }) => ({ id: item.id, title: item.title, liftedAt: item.liftedAt?.toISOString() ?? null, lastBumpAt: item.lastBumpAt?.toISOString() ?? null, bumpsCount: item.bumpsCount, setAt: result.toISOString() })),
    };
    const waiting = items.length - ready.length;
    return {
      report: `Поднял ${things(done.length)}:\n${lines(done.map(({ item }) => clip(item.title)))}${failedNote(failed)}${waiting > 0 && !filter.limit ? `\n\nЕщё ${things(waiting)} на паузе — их можно поднять позже.` : ''}\n\nСнова эти вещи можно поднять через 72 часа.`,
      snapshot,
    };
  },
  async undo(ctx, raw) {
    let back = 0;
    for (const it of (raw as BumpSnap).items) {
      // Only a bump that is still the last one: a later bump by hand stays.
      const { count } = await ctx.prisma.listing.updateMany({
        where: { id: it.id, sellerId: ctx.userId, lastBumpAt: new Date(it.setAt) },
        data: { liftedAt: it.liftedAt ? new Date(it.liftedAt) : null, lastBumpAt: it.lastBumpAt ? new Date(it.lastBumpAt) : null, bumpsCount: it.bumpsCount },
      });
      if (count) recordActivity(ctx.prisma, ctx.userId, 'listing_bumped', { listingId: it.id, detail: 'отмена поднятия' });
      back += count;
    }
    return `Отменил поднятие: ${things(back)} вернулись на прежние места, пауза на поднятие снята.`;
  },
};

interface IdsSnap {
  items: Array<{ id: string; title: string; at?: string | null }>;
}

export const hide: Tool<OnlyFilterT> = {
  name: 'hide',
  about: 'Снять свои вещи с продажи (скрыть): они остаются в гардеробе, их можно вернуть. Предложения цены по ним отменяются.',
  args: OnlyFilter,
  kind: 'write',
  async run(ctx, { filter }) {
    const { items, total } = await findMyListings(ctx.prisma, ctx.userId, { ...filter, status: 'on_sale' });
    if (!items.length) throw none('Вещей в продаже не нашлось');
    const offers = await ctx.prisma.offer.count({ where: { listingId: { in: items.map((l) => l.id) }, status: 'PENDING' } });
    const { done, failed } = await each<MyListing, unknown>(items, (l) => ctx.listings.hide(ctx.userId, l.id));
    if (!done.length) throw new Refusal(`Скрыть не получилось.${failedNote(failed)}`);
    const hidden = await ctx.prisma.listing.findMany({ where: { id: { in: done.map((d) => d.item.id) } }, select: { id: true, hiddenAt: true } });
    const at = new Map(hidden.map((h) => [h.id, h.hiddenAt?.toISOString() ?? null]));
    return {
      report: `Скрыл ${things(done.length)}:\n${lines(done.map(({ item }) => clip(item.title)))}${failedNote(failed)}${capNote(total, items.length)}${offers ? `\n\nПредложения цены по ним отменены (${offers}) — это вернуть нельзя.` : ''}`,
      snapshot: { items: done.map(({ item }) => ({ id: item.id, title: item.title, at: at.get(item.id) })) } satisfies IdsSnap,
    };
  },
  async undo(ctx, raw) {
    // Straight back to what it was a minute ago: the same row, still hidden by that very action, and not taken down
    // by an admin meanwhile. (publish() is for an item coming back after a while: it checks and announces it anew.)
    const seller = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { listingsHiddenAt: true } });
    if (seller.listingsHiddenAt) return 'Объявления аккаунта скрыты администрацией — вернуть их в продажу не могу.';
    let back = 0;
    for (const it of (raw as IdsSnap).items) {
      const l = await current(ctx, it.id);
      if (l?.status !== 'HIDDEN' || !sameTime(l.hiddenAt, it.at) || l.hiddenByAdmin || l.hiddenByBlock) continue;
      const { count } = await ctx.prisma.listing.updateMany({ where: { id: it.id, sellerId: ctx.userId, status: 'HIDDEN' }, data: { status: 'PUBLISHED', hiddenAt: null } });
      if (count) recordActivity(ctx.prisma, ctx.userId, 'listing_published', { listingId: it.id, detail: 'отмена скрытия' });
      back += count;
    }
    const all = (raw as IdsSnap).items.length;
    return `Вернул в продажу: ${things(back)}.${back < all ? ` Остальные (${all - back}) уже меняли после этого — их не трогал.` : ''}`;
  },
};

export const unhide: Tool<OnlyFilterT> = {
  name: 'unhide',
  about: 'Вернуть в продажу свои скрытые вещи.',
  args: OnlyFilter,
  kind: 'write',
  async run(ctx, { filter }) {
    const { items, total } = await findMyListings(ctx.prisma, ctx.userId, { ...filter, status: 'hidden' });
    if (!items.length) throw none('Скрытых вещей не нашлось');
    const { done, failed } = await each<MyListing, unknown>(items, (l) => ctx.listings.publish(ctx.userId, l.id));
    if (!done.length) throw new Refusal(`Вернуть не получилось.${failedNote(failed)}`);
    return {
      report: `Вернул в продажу ${things(done.length)}:\n${lines(done.map(({ item }) => clip(item.title)))}${failedNote(failed)}${capNote(total, items.length)}`,
      snapshot: { items: done.map(({ item }) => ({ id: item.id, title: item.title })) } satisfies IdsSnap,
    };
  },
  async undo(ctx, raw) {
    const still: Array<{ id: string; title: string }> = [];
    for (const it of (raw as IdsSnap).items) if ((await current(ctx, it.id))?.status === 'PUBLISHED') still.push(it);
    const { done, failed } = await each(still, (it) => ctx.listings.hide(ctx.userId, it.id));
    return `Снова скрыл: ${things(done.length)}.${failedNote(failed)}`;
  },
};
