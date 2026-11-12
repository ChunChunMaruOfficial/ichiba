import { z } from 'zod';
import { clip, lines, things } from '../my-listings.js';
import { Refusal, type Tool } from '../types.js';

/**
 * The buyer's own lists: tidy up the favourites, the cart and the subscriptions. Removal only — adding an item or
 * a seller is one tap on its page, and here there is nothing to name it by. Every removal can be put back.
 */
const FavArgs = z.object({ which: z.enum(['sold', 'unavailable', 'all']).describe('sold — проданные; unavailable — всё, что нельзя купить (проданные, скрытые, в резерве); all — всё избранное') }).strict();
interface RowsSnap {
  rows: Array<{ listingId: string; title: string; size?: string | null; source?: string }>;
}

export const cleanFavorites: Tool<z.infer<typeof FavArgs>> = {
  name: 'clean_favorites',
  about: 'Убрать вещи из моего избранного: проданные, недоступные или все.',
  args: FavArgs,
  kind: 'write',
  async run(ctx, { which }) {
    const status = which === 'sold' ? { status: 'SOLD' as const } : which === 'unavailable' ? { status: { not: 'PUBLISHED' as const } } : {};
    const favs = await ctx.prisma.favorite.findMany({ where: { userId: ctx.userId, listing: status }, take: 500, select: { listingId: true, source: true, listing: { select: { title: true } } } });
    if (!favs.length) throw new Refusal('Таких вещей в избранном нет');
    const ids = favs.map((f) => f.listingId);
    await ctx.prisma.$transaction([
      ctx.prisma.favorite.deleteMany({ where: { userId: ctx.userId, listingId: { in: ids } } }),
      ctx.prisma.listing.updateMany({ where: { id: { in: ids }, favoritesCount: { gt: 0 } }, data: { favoritesCount: { decrement: 1 } } }),
    ]);
    return {
      report: `Убрал из избранного ${things(favs.length)}:\n${lines(favs.map((f) => clip(f.listing.title)), 8)}`,
      snapshot: { rows: favs.map((f) => ({ listingId: f.listingId, title: f.listing.title, source: f.source })) } satisfies RowsSnap,
      links: ['favorites'],
    };
  },
  async undo(ctx, raw) {
    const rows = (raw as RowsSnap).rows;
    const alive = await ctx.prisma.listing.findMany({ where: { id: { in: rows.map((r) => r.listingId) }, status: { notIn: ['DELETED', 'BLOCKED', 'DRAFT'] } }, select: { id: true } });
    const ok = new Set(alive.map((l) => l.id));
    const back = rows.filter((r) => ok.has(r.listingId));
    const { count } = await ctx.prisma.favorite.createMany({ data: back.map((r) => ({ userId: ctx.userId, listingId: r.listingId, source: r.source ?? 'product' })), skipDuplicates: true });
    // The counter goes up only for the rows that really came back (createMany says how many, not which: recount them).
    if (count) for (const r of back) await ctx.prisma.listing.update({ where: { id: r.listingId }, data: { favoritesCount: await ctx.prisma.favorite.count({ where: { listingId: r.listingId } }) } });
    return `Вернул в избранное: ${things(count)}.`;
  },
};

const CartArgs = z.object({ which: z.enum(['unavailable', 'all']).describe('unavailable — то, что уже нельзя купить; all — всю корзину') }).strict();

export const clearCart: Tool<z.infer<typeof CartArgs>> = {
  name: 'clear_cart',
  about: 'Очистить мою корзину: всю или только то, что уже нельзя купить.',
  args: CartArgs,
  kind: 'write',
  async run(ctx, { which }) {
    const items = await ctx.prisma.cartItem.findMany({ where: { userId: ctx.userId, ...(which === 'unavailable' ? { listing: { status: { not: 'PUBLISHED' } } } : {}) }, select: { listingId: true, size: true, listing: { select: { title: true } } } });
    if (!items.length) throw new Refusal(which === 'all' ? 'Корзина и так пуста' : 'В корзине всё можно купить');
    await ctx.prisma.cartItem.deleteMany({ where: { userId: ctx.userId, listingId: { in: items.map((i) => i.listingId) } } });
    return {
      report: `Убрал из корзины ${things(items.length)}:\n${lines(items.map((i) => clip(i.listing.title)), 8)}`,
      snapshot: { rows: items.map((i) => ({ listingId: i.listingId, title: i.listing.title, size: i.size })) } satisfies RowsSnap,
      links: ['cart'],
    };
  },
  async undo(ctx, raw) {
    const rows = (raw as RowsSnap).rows;
    const alive = await ctx.prisma.listing.findMany({ where: { id: { in: rows.map((r) => r.listingId) }, status: { in: ['PUBLISHED', 'RESERVED'] }, sellerId: { not: ctx.userId } }, select: { id: true } });
    const ok = new Set(alive.map((l) => l.id));
    const { count } = await ctx.prisma.cartItem.createMany({ data: rows.filter((r) => ok.has(r.listingId)).map((r) => ({ userId: ctx.userId, listingId: r.listingId, size: r.size ?? null })), skipDuplicates: true });
    return `Вернул в корзину: ${things(count)}.`;
  },
};

const FollowArgs = z.object({ usernames: z.array(z.string().trim().toLowerCase().regex(/^@?[a-z0-9_]{3,24}$/)).min(1).max(20).describe('ники продавцов, от которых отписаться') }).strict();
interface FollowSnap {
  sellers: Array<{ id: string; username: string }>;
}

export const unfollow: Tool<z.infer<typeof FollowArgs>> = {
  name: 'unfollow',
  about: 'Отписаться от продавцов по никам.',
  args: FollowArgs,
  kind: 'write',
  async run(ctx, { usernames }) {
    const names = usernames.map((u) => u.replace(/^@/, ''));
    const rows = await ctx.prisma.follow.findMany({ where: { followerId: ctx.userId, seller: { username: { in: names } } }, select: { sellerId: true, seller: { select: { username: true } } } });
    if (!rows.length) throw new Refusal('На этих продавцов вы не подписаны');
    await ctx.prisma.follow.deleteMany({ where: { followerId: ctx.userId, sellerId: { in: rows.map((r) => r.sellerId) } } });
    return {
      report: `Отписал вас от: ${rows.map((r) => `@${r.seller.username}`).join(', ')}.`,
      snapshot: { sellers: rows.map((r) => ({ id: r.sellerId, username: r.seller.username })) } satisfies FollowSnap,
      links: ['following'],
    };
  },
  async undo(ctx, raw) {
    const sellers = (raw as FollowSnap).sellers;
    const alive = await ctx.prisma.user.findMany({ where: { id: { in: sellers.map((s) => s.id) }, deletedAt: null, blockedAt: null }, select: { id: true, username: true } });
    await ctx.prisma.follow.createMany({ data: alive.map((s) => ({ followerId: ctx.userId, sellerId: s.id })), skipDuplicates: true });
    return `Подписал обратно: ${alive.map((s) => `@${s.username}`).join(', ') || 'никого — этих продавцов больше нет'}.`;
  },
};
