import { z } from 'zod';
import { recordActivity } from '../../activity/activity.js';
import { byn, clip, findMyListings, lines, ListingFilter, things, type MyListing } from '../my-listings.js';
import { Refusal, type Tool, type ToolCtx } from '../types.js';
import { capNote, current, each, edit, failedNote, none } from './shared.js';

const Args = z
  .object({
    filter: ListingFilter,
    mode: z.enum(['percent', 'amount', 'exact']).describe('percent — на сколько процентов, amount — на сколько рублей, exact — точная новая цена'),
    value: z.number().min(-100_000).max(100_000).describe('для percent и amount: отрицательное — снизить, положительное — поднять; для exact — новая цена в BYN'),
  })
  .strict();
type ArgsT = z.infer<typeof Args>;

const MAX_PRICE = 100_000;

/**
 * A price lowered from the chat is announced to those who saved the item a minute later, not at once: «Отменить»
 * pressed within that minute puts the price back and nobody hears about a discount that is gone. In the process's
 * memory: a restart within that minute loses the notice, never sends a wrong one.
 */
let noticeDelayMs = 60_000;
export const setPriceNoticeDelay = (ms: number) => void (noticeDelayMs = ms);

function announceLater(ctx: ToolCtx, drops: Array<{ id: string; from: number }>) {
  if (!drops.length) return;
  const timer = setTimeout(() => {
    void (async () => {
      for (const d of drops) await ctx.listings.announcePriceDrop(d.id, d.from).catch(() => undefined);
    })();
  }, noticeDelayMs);
  timer.unref?.();
}

/** The new price of an item, whole BYN, within what the site accepts. */
export function newPrice(price: number, mode: ArgsT['mode'], value: number): number {
  const raw = mode === 'exact' ? value : mode === 'percent' ? price * (1 + value / 100) : price + value;
  return Math.min(MAX_PRICE, Math.max(1, Math.round(raw)));
}

async function plan(ctx: Parameters<Tool['run']>[0], a: ArgsT) {
  if (a.mode === 'percent' && (a.value <= -100 || a.value > 500)) throw new Refusal('Процент должен быть больше −100 и не больше 500');
  const { items, total } = await findMyListings(ctx.prisma, ctx.userId, a.filter, { price: { not: null }, saleType: 'FIXED' });
  const changes = items.map((l) => ({ l, to: newPrice(l.price!, a.mode, a.value) })).filter((c) => c.to !== c.l.price);
  if (!changes.length) throw items.length ? new Refusal('Цены уже такие — менять нечего') : none();
  return Object.assign(changes, { total, taken: items.length });
}

interface Snap {
  items: Array<{ id: string; title: string; from: number; to: number; was: number | null }>;
}

export const setPrice: Tool<ArgsT> = {
  name: 'set_price',
  about: 'Изменить цену своих вещей: на процент, на сумму или поставить точную. Работает сразу по многим вещам (filter). Аукционы и вещи в сделке не трогает.',
  args: Args,
  kind: 'write',
  async ask(ctx, a) {
    const halved = (await plan(ctx, a)).filter((c) => c.to * 2 < c.l.price!);
    if (!halved.length) return null;
    return `Цена упадёт больше чем вдвое у ${things(halved.length)}:\n${lines(halved.map((c) => `${clip(c.l.title)}: ${byn(c.l.price)} → ${byn(c.to)}`), 8)}\n\nМенять?`;
  },
  async run(ctx, a) {
    const changes = await plan(ctx, a);
    const to = new Map(changes.map((c) => [c.l.id, c.to]));
    const { done, failed } = await each<MyListing, number>(changes.map((c) => c.l), async (l) => {
      await edit(ctx, l.id, { price: to.get(l.id)! }, { deferPriceDrop: true });
      return to.get(l.id)!;
    });
    if (!done.length) throw new Refusal(`Цены не изменились.${failedNote(failed)}`);
    const snapshot: Snap = { items: done.map(({ item, result }) => ({ id: item.id, title: item.title, from: item.price!, to: result, was: item.previousPrice })) };
    const drops = done.filter(({ item, result }) => item.status === 'PUBLISHED' && result < item.price!).map(({ item }) => ({ id: item.id, from: item.price! }));
    announceLater(ctx, drops);
    const mirrored = (await ctx.prisma.shopSource.count({ where: { userId: ctx.userId } })) > 0;
    const notes = [
      drops.length ? 'Тем, у кого вещь в избранном, уведомление о снижении цены уйдёт через минуту. Отмените раньше — и его не будет.' : '',
      mirrored ? 'Каталог синхронизируется с вашим магазином: когда цена изменится там, она обновится и здесь.' : '',
    ].filter(Boolean);
    return {
      report: `Изменил цену у ${things(done.length)}:\n${lines(done.map(({ item, result }) => `${clip(item.title)}: ${byn(item.price)} → ${byn(result)}`))}${failedNote(failed)}${capNote(changes.total, changes.taken)}${notes.length ? `\n\n${notes.join('\n')}` : ''}`,
      snapshot,
    };
  },
  async undo(ctx, raw) {
    const snap = raw as Snap;
    let back = 0;
    const skipped: string[] = [];
    for (const it of snap.items) {
      const l = await current(ctx, it.id);
      // Changed by hand since (or sold, reserved): the person's own later choice stays.
      if (!l || l.price !== it.to || !['PUBLISHED', 'HIDDEN', 'DRAFT'].includes(l.status)) {
        skipped.push(clip(it.title));
        continue;
      }
      // Straight to the row: the old price and its old «was» price come back exactly, and nobody is notified.
      await ctx.prisma.listing.update({ where: { id: it.id }, data: { price: it.from, previousPrice: it.was } });
      recordActivity(ctx.prisma, ctx.userId, 'price_changed', { listingId: it.id, detail: `отмена: ${it.to} → ${it.from} BYN` });
      back++;
    }
    return `Вернул прежние цены: ${things(back)}.${skipped.length ? `\nНе тронул (их уже меняли): ${skipped.slice(0, 6).join(', ')}` : ''}`;
  },
};
