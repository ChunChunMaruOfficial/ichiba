import { z } from 'zod';
import { byn, clip, findMyListings, lines, ListingFilter, things, type MyListing } from '../my-listings.js';
import { Refusal, type Tool, type ToolCtx } from '../types.js';
import { each, failedNote, none } from './shared.js';

/**
 * What can't be put back: the chat shows what exactly will happen and waits for «Сделать». Nothing here runs from
 * the model's answer alone.
 */
const OnlyFilter = z.object({ filter: ListingFilter }).strict();
type OnlyFilterT = z.infer<typeof OnlyFilter>;

const pick = async (ctx: ToolCtx, a: OnlyFilterT, status: 'any' | undefined) => {
  // Sold and deleted for good: never «everything» by default — the model must name ids or a narrowing filter.
  const f = a.filter;
  if (!f.ids?.length && !f.words?.length && !f.category && !f.limit) throw new Refusal('Уточните, какие именно вещи: назовите их или категорию');
  const { items } = await findMyListings(ctx.prisma, ctx.userId, { ...f, status: f.status ?? status });
  const fit = items.filter((l) => ['PUBLISHED', 'HIDDEN', 'DRAFT'].includes(l.status));
  if (!fit.length) throw none();
  return fit;
};
const titles = (items: MyListing[]) => lines(items.map((l) => `${clip(l.title)} · ${byn(l.price)}`), 10);

export const markSold: Tool<OnlyFilterT> = {
  name: 'mark_sold',
  about: 'Отметить свои вещи проданными (продано вне площадки). Вернуть нельзя: запросы покупателей отклоняются.',
  args: OnlyFilter,
  kind: 'confirm',
  preview: async (ctx, a) => {
    const items = (await pick(ctx, a, undefined)).filter((l) => l.status !== 'DRAFT');
    if (!items.length) throw none();
    return `Отметить проданными ${things(items.length)}?\n${titles(items)}\n\nЭто нельзя отменить: запросы покупателей по ним будут отклонены.`;
  },
  async run(ctx, a) {
    const items = (await pick(ctx, a, undefined)).filter((l) => l.status !== 'DRAFT');
    const { done, failed } = await each<MyListing, unknown>(items, (l) => ctx.listings.markSold(ctx.userId, l.id));
    return { report: `Отметил проданными: ${things(done.length)}.${done.length ? `\n${lines(done.map(({ item }) => clip(item.title)))}` : ''}${failedNote(failed)}` };
  },
};

export const deleteListing: Tool<OnlyFilterT> = {
  name: 'delete_listing',
  about: 'Удалить свои вещи насовсем. Вернуть нельзя. Если человек хочет просто убрать с продажи — это hide.',
  args: OnlyFilter,
  kind: 'confirm',
  preview: async (ctx, a) => {
    const items = await pick(ctx, a, 'any');
    return `Удалить насовсем ${things(items.length)}?\n${titles(items)}\n\nЭто нельзя отменить. Чтобы просто убрать с продажи, лучше скрыть.`;
  },
  async run(ctx, a) {
    const items = await pick(ctx, a, 'any');
    const { done, failed } = await each<MyListing, unknown>(items, (l) => ctx.listings.remove(ctx.userId, l.id));
    return { report: `Удалил: ${things(done.length)}.${done.length ? `\n${lines(done.map(({ item }) => clip(item.title)))}` : ''}${failedNote(failed)}` };
  },
};

const LikersArgs = z.object({ id: z.uuid().describe('id вещи'), amount: z.number().int().min(1).max(100_000).describe('цена со скидкой, BYN') }).strict();
type LikersArgsT = z.infer<typeof LikersArgs>;

export const offerLikers: Tool<LikersArgsT> = {
  name: 'offer_likers',
  about: 'Отправить личную скидку всем, кто добавил вещь в избранное (раз в 3 дня, не больше 50%). Отозвать нельзя.',
  args: LikersArgs,
  kind: 'confirm',
  preview: async (ctx, a) => {
    const l = await ctx.prisma.listing.findFirst({ where: { id: a.id, sellerId: ctx.userId }, select: { title: true, price: true } });
    if (!l) throw none('Такой вещи у вас нет');
    const info = await ctx.offers.likersInfo(ctx.userId, a.id);
    if (!info.count) throw new Refusal('Пока некому отправить: вещь никто не добавил в избранное');
    return `Отправить скидку по «${clip(l.title)}»: ${byn(l.price)} → ${byn(a.amount)}?\nПолучат ${info.count} чел. Отозвать предложение будет нельзя.`;
  },
  async run(ctx, a) {
    await ctx.offers.offerLikers(ctx.userId, a.id, a.amount);
    return { report: `Скидку отправил: ${byn(a.amount)}. Кто согласится — придёт запрос на покупку.`, links: ['sales_action'] };
  },
};

const AuctionArgs = z.object({ id: z.uuid().describe('id вещи на аукционе') }).strict();
type AuctionArgsT = z.infer<typeof AuctionArgs>;
const liveAuction = async (ctx: ToolCtx, listingId: string) => {
  const a = await ctx.prisma.auction.findFirst({ where: { listingId, status: 'ACTIVE', listing: { sellerId: ctx.userId } }, select: { id: true, listing: { select: { title: true } }, _count: { select: { bids: true } } } });
  if (!a) throw new Refusal('У этой вещи нет идущего аукциона');
  return a;
};

export const cancelAuction: Tool<AuctionArgsT> = {
  name: 'cancel_auction',
  about: 'Отменить идущий аукцион своей вещи (только пока нет ставок). Вещь останется в продаже по обычной цене.',
  args: AuctionArgs,
  kind: 'confirm',
  preview: async (ctx, a) => {
    const au = await liveAuction(ctx, a.id);
    if (au._count.bids) throw new Refusal('На аукционе уже есть ставки — отменить его нельзя');
    return `Отменить аукцион по «${clip(au.listing.title)}»? Вещь останется в продаже по обычной цене; запустить его заново с того же места не получится.`;
  },
  async run(ctx, a) {
    const au = await liveAuction(ctx, a.id);
    await ctx.auctions.cancel(ctx.userId, au.id);
    return { report: `Аукцион по «${clip(au.listing.title)}» отменён.` };
  },
};
