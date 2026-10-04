import type { Vote } from './ensemble.js';

/** Weighted majority of categorical answers; null when nobody answered. */
export function majority<T, V extends string | number | boolean | null>(votes: Vote<T>[], pick: (v: T) => V): { value: V | null; share: number } {
  const totals = new Map<V, number>();
  let all = 0;
  for (const v of votes) {
    const key = pick(v.value);
    totals.set(key, (totals.get(key) ?? 0) + v.weight);
    all += v.weight;
  }
  let best: V | null = null;
  let bestW = -1;
  for (const [k, w] of totals) if (w > bestW) [best, bestW] = [k, w];
  return { value: best, share: all ? bestW / all : 0 };
}

/** Weighted share of votes for which the predicate holds (0..1). */
export function share<T>(votes: Vote<T>[], pred: (v: T) => boolean): number {
  const all = votes.reduce((s, v) => s + v.weight, 0);
  return all ? votes.filter((v) => pred(v.value)).reduce((s, v) => s + v.weight, 0) / all : 0;
}

/** Count of providers for which the predicate holds. */
export const count = <T>(votes: Vote<T>[], pred: (v: T) => boolean) => votes.filter((v) => pred(v.value)).length;

export function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** Weighted quantile (q in 0..1). */
export function weightedQuantile(items: Array<{ value: number; weight: number }>, q: number): number | null {
  const xs = items.filter((i) => Number.isFinite(i.value) && i.weight > 0).sort((a, b) => a.value - b.value);
  if (!xs.length) return null;
  const total = xs.reduce((s, i) => s + i.weight, 0);
  let acc = 0;
  for (const i of xs) {
    acc += i.weight;
    if (acc >= total * q) return i.value;
  }
  return xs[xs.length - 1].value;
}

/** Values proposed by at least `quorum` share of the weighted votes (for tag/list fields). */
export function quorumSet<T>(votes: Vote<T>[], pick: (v: T) => string[], quorum = 0.5): string[] {
  const all = votes.reduce((s, v) => s + v.weight, 0);
  const totals = new Map<string, number>();
  for (const v of votes) for (const item of new Set(pick(v.value))) totals.set(item, (totals.get(item) ?? 0) + v.weight);
  return [...totals.entries()]
    .filter(([, w]) => all && w / all >= quorum - 1e-9)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

/**
 * How many agreeing providers are needed to act on a flag: with one healthy provider a single vote
 * can only send something to review, never reject on its own.
 */
export const quorumFor = (n: number) => (n <= 1 ? 2 : n === 2 ? 2 : Math.ceil((n * 2) / 3));

/** Rounds a price to a "shop" number: 1 BYN below 100, 5 BYN below 500, 10 BYN above. */
export function nicePrice(x: number): number {
  if (!Number.isFinite(x) || x <= 1) return 1;
  if (x < 100) return Math.round(x);
  if (x < 500) return Math.round(x / 5) * 5;
  return Math.round(x / 10) * 10;
}
