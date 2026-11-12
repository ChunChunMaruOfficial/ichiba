import { ListingInput, type ListingInputT } from '../../listings/listings.dto.js';
import { refusal } from '../../telegram/shop.js';
import { clip, MAX_ITEMS } from '../my-listings.js';
import { Refusal, type ToolCtx } from '../types.js';

/** Why a service refused, in the words the site itself would show. */
export const why = (e: unknown) => refusal(e) ?? (e instanceof Refusal ? e.message : 'не получилось');

/**
 * Runs one step per item and keeps going when one is refused: a bulk action reports what it did and, apart, what it
 * could not do and why. An unexpected error (not a refusal of the site) still stops everything.
 */
export async function each<T extends { id: string; title: string }, R>(items: T[], step: (item: T) => Promise<R>) {
  const done: Array<{ item: T; result: R }> = [];
  const failed: string[] = [];
  for (const item of items) {
    try {
      done.push({ item, result: await step(item) });
    } catch (e) {
      if (refusal(e) == null && !(e instanceof Refusal)) throw e;
      failed.push(`${clip(item.title)} — ${why(e)}`);
    }
  }
  return { done, failed };
}

export const failedNote = (failed: string[]) => (failed.length ? `\n\nНе получилось (${failed.length}):\n${failed.slice(0, 6).join('\n')}${failed.length > 6 ? `\n…и ещё ${failed.length - 6}` : ''}` : '');

/** An edit as the site's own form would send it: validated by the same schema before it reaches the service. */
export function edit(ctx: ToolCtx, id: string, patch: Record<string, unknown>, opts: { deferPriceDrop?: boolean } = {}) {
  const parsed = ListingInput.safeParse(patch);
  if (!parsed.success) throw new Refusal(parsed.error.issues[0]?.message ?? 'Такое значение не подходит');
  return ctx.listings.update(ctx.userId, id, parsed.data as ListingInputT, opts);
}

/** The seller's item as it is now, or null when it is gone or not theirs. */
export const current = (ctx: ToolCtx, id: string) => ctx.prisma.listing.findFirst({ where: { id, sellerId: ctx.userId, status: { not: 'DELETED' } } });

/** A bulk action takes MAX_ITEMS at most: said in the report when more fit, so nobody thinks «all» was all. */
export const capNote = (total: number, taken: number) => (total > taken ? `\n\nПодходящих вещей ${total}, а за одно действие я меняю не больше ${MAX_ITEMS}. Повторите просьбу — возьму следующие.` : '');

export const none = (what = 'Подходящих вещей не нашлось') => new Refusal(`${what}. Уточните, какие вещи вы имеете в виду.`);

export const sameTime = (a: Date | null, b: string | Date | null | undefined) => (a?.getTime() ?? null) === (b ? new Date(b).getTime() : null);
