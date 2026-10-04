import { z } from 'zod';

/**
 * Bundle discount (frame 12 cart + feature 10): the seller sets up to three tiers, e.g. "from 2 items −10%",
 * "from 3 items −15%". The best tier for the number of items in one request applies automatically.
 */

export interface BundleTier {
  minItems: number;
  percent: number;
}

export const BundleTiersDto = z
  .array(z.object({ minItems: z.number().int().min(2, 'От 2 вещей').max(10, 'До 10 вещей'), percent: z.number().int().min(1, 'От 1%').max(50, 'Не больше 50%') }))
  .max(3, 'Не больше трёх ступеней')
  .refine((t) => t.every((x, i) => i === 0 || (x.minItems > t[i - 1].minItems && x.percent > t[i - 1].percent)), {
    message: 'Каждая следующая ступень — больше вещей и больше скидка',
  });

export function tiersOf(raw: unknown): BundleTier[] {
  const parsed = BundleTiersDto.safeParse(raw);
  return parsed.success ? [...parsed.data].sort((a, b) => a.minItems - b.minItems) : [];
}

export function discountFor(tiers: BundleTier[], count: number): number {
  return tiers.filter((t) => count >= t.minItems).reduce((best, t) => Math.max(best, t.percent), 0);
}

/** Next tier the buyer can reach ("add one more item — −15%"). */
export function nextTier(tiers: BundleTier[], count: number): { needItems: number; percent: number } | null {
  const t = tiers.find((x) => x.minItems > count);
  return t ? { needItems: t.minItems - count, percent: t.percent } : null;
}

/**
 * Applies a percentage to a set of item prices. The total is rounded down to whole BYN in the buyer's
 * favour and spread over items proportionally, so per-item deal prices always add up to the total.
 */
export function applyDiscount(prices: number[], percent: number) {
  const subtotal = prices.reduce((s, p) => s + p, 0);
  if (!percent) return { subtotal, total: subtotal, itemPrices: prices, discount: 0 };
  const total = Math.floor((subtotal * (100 - percent)) / 100);
  const itemPrices = prices.map((p) => Math.floor((p * total) / subtotal));
  let rest = total - itemPrices.reduce((s, p) => s + p, 0);
  // Remainder from rounding goes to the most expensive items first.
  const order = prices.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) itemPrices[order[k][1]]++;
  return { subtotal, total, itemPrices, discount: subtotal - total };
}
