import { cosine, normalise } from '../ai/embeddings.js';

/**
 * The taste model behind «Для вас»: pure functions, no database, so the same code runs in the feed and in the offline
 * measurement (scripts/recs-eval.ts). How it works and why — docs/RECOMMENDATIONS.md.
 *
 * A person's actions are weighted signals about items; each fades with time. From them come two views of taste:
 * - the traits of the items (style, kind, brand, size, colour, price, seller) — what can be named;
 * - how the items look (photo vectors, ai/embeddings.ts) — what can't: a cut, a print, a mood. An item fits by look
 *   when it is close to a few of the items the person engaged with, not to their average: someone into both grunge
 *   and office wear is shown either, never the grey middle of the two.
 * Items that look like the ones the person turned down are pushed down.
 */

export const SIGNAL_WEIGHTS = {
  view: 1,
  /** A long look at the item page (20+ s or 3+ photos). */
  dwell: 2,
  /** Left the item page within 4 s: the click was a miss. Cancels the view. */
  bounce: -1,
  /** A search or a filter: what the person is looking for right now (traits in Signal.meta). */
  search: 3,
  filter: 2,
  /** A search by photo: the best match stands for the look searched for. */
  photo_search: 3,
  favorite: 5,
  swipe_right: 5,
  offer: 6,
  cart: 6,
  /** Wrote to the seller about the item. */
  message: 7,
  request: 8,
  /** The deal went through: on top of the request. */
  purchase: 4,
  follow: 10,
  swipe_left: -3,
  /** «Не интересно» on the item page: the item leaves this person's feeds and search for good. */
  not_interested: -6,
} as const;
export type SignalType = keyof typeof SIGNAL_WEIGHTS;

/** Traits a search or filter was about, kept with its signal. */
export interface SignalMeta {
  category?: string[];
  brand?: string[];
  style?: string[];
  size?: string[];
  color?: string[];
}

/** What ranking knows about an item, on sale or not (signals point at sold ones too). */
export interface Traits {
  id: string;
  sellerId: string;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  color: string | null;
  sizeValue: string | null;
  sizes: string[];
  styleTags: string[];
  gender: string | null;
  price: number | null;
  publishedAt: Date | null;
}

export interface TasteEvent {
  type: string;
  weight: number;
  at: number;
  listing?: Traits | null;
  meta?: SignalMeta | null;
}

export interface TasteInput {
  now: number;
  events: TasteEvent[];
  /** Photo vector of an item by id (mean of its photos); items without one rank on traits alone. */
  vectors: Map<string, Float32Array>;
  followed: Set<string>;
  /** Sizes the person saved in the profile. */
  sizes: string[];
  /** «Популярное» score by item id. */
  popularity: Map<string, number>;
  /** How many times the person scrolled past an item in a feed without opening it. */
  ignored?: Map<string, number>;
}

const DAY = 24 * 3600 * 1000;
/** A signal counts half after two weeks, a quarter after four: the profile drifts with the person's taste. */
export const HALF_LIFE_MS = 14 * DAY;
/** What happened in the last half hour is what the person is after right now (Pinterest's TransAct). */
const SESSION_MS = 30 * 60_000;
const SESSION_BOOST = 2;
const FRESH_MS = 72 * 3600 * 1000;
const MAX_SAME_SELLER_IN_A_ROW = 3;
/** Every n-th item of «Для вас» comes from outside the profile, so tastes can widen (every 5th cost 4 points of recall). */
const EXPLORE_EVERY = 8;
/** How far ahead the variety pass looks for something of another kind, and what a repeat costs (in z-units). */
const VARIETY_WINDOW = 8;
const KIND_REPEAT_COST = 1;
/**
 * Liked items an item is compared with by look: the nearest few, at most 5 (measured: the nearest few beat the
 * average of all and PinnerSage-style clusters on our histories; 1–5 neighbours within noise of each other).
 */
const LOOK_NEIGHBOURS = 5;

const decay = (now: number, at: number) => 0.5 ** ((now - at) / HALF_LIFE_MS) * (now - at < SESSION_MS ? SESSION_BOOST : 1);

/** The look of an item: the mean of its photos' vectors, L2-normalised. */
export function meanVector(vs: Float32Array[]): Float32Array | null {
  if (!vs.length) return null;
  const sum = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < sum.length; i++) sum[i] += v[i];
  return normalise(sum);
}

interface Weighted {
  vec: Float32Array;
  w: number;
}

// ---------- traits ----------

type Weights = Map<string, number>;
const bump = (m: Weights, k: string | null | undefined, w: number) => {
  if (k) m.set(k, (m.get(k) ?? 0) + w);
};
/** Share of the strongest positive weight, 0..1 (negatives push below 0). */
const share = (m: Weights, k: string | null | undefined) => {
  if (!k) return 0;
  const top = Math.max(0, ...m.values());
  return top ? Math.max(-1, (m.get(k) ?? 0) / top) : 0;
};

const HEADWEAR = new Set(['hat', 'cap', 'beanie']);
/** The kind of thing an item is, for «not two of a kind in a row»: the category; accessories split by what they are. */
export const kindOf = (c: Pick<Traits, 'category' | 'subcategory'>) =>
  c.category === 'accessories' ? (HEADWEAR.has(c.subcategory ?? '') ? 'headwear' : (c.subcategory ?? 'accessories')) : (c.category ?? '');

/**
 * Keeps a feed's order but never puts two items of one kind side by side (three jackets, then four hats looks like a
 * dump, not a shop window), nor more than 3 in a row from one seller. When only one kind is left, it runs on.
 */
export function spread<T extends Pick<Traits, 'category' | 'subcategory' | 'sellerId'>>(items: T[]): T[] {
  const out: T[] = [];
  const pending = [...items];
  while (pending.length) {
    const prev = out.at(-1);
    const tail = out.slice(-MAX_SAME_SELLER_IN_A_ROW);
    const blockedSeller = tail.length === MAX_SAME_SELLER_IN_A_ROW && tail.every((t) => t.sellerId === tail[0].sellerId) ? tail[0].sellerId : null;
    const kindOk = (p: T) => !prev || kindOf(p) !== kindOf(prev);
    const sellerOk = (p: T) => p.sellerId !== blockedSeller;
    let idx = pending.findIndex((p) => kindOk(p) && sellerOk(p));
    if (idx === -1) idx = pending.findIndex(kindOk);
    if (idx === -1) idx = pending.findIndex(sellerOk);
    out.push(pending.splice(Math.max(0, idx), 1)[0]);
  }
  return out;
}

export interface Profile {
  traits: Record<'category' | 'subcategory' | 'brand' | 'style' | 'size' | 'color' | 'gender' | 'seller', Weights>;
  priceBand: [number, number];
  followed: Set<string>;
  liked: Weighted[];
  disliked: Weighted[];
  /** Items the person turned down lately («Не моё» within a week). */
  hidden: Set<string>;
}

export function buildProfile(input: TasteInput): Profile {
  const { now } = input;
  const traits: Profile['traits'] = { category: new Map(), subcategory: new Map(), brand: new Map(), style: new Map(), size: new Map(), color: new Map(), gender: new Map(), seller: new Map() };
  const prices: Array<[number, number]> = [];
  const hidden = new Set<string>();
  const byItem = new Map<string, number>();
  for (const s of input.events) {
    const weight = s.weight * decay(now, s.at);
    const l = s.listing;
    if (l) {
      bump(traits.category, l.category, weight);
      bump(traits.subcategory, l.subcategory, weight);
      bump(traits.brand, l.brand, weight);
      bump(traits.color, l.color, weight);
      bump(traits.gender, l.gender, weight);
      bump(traits.seller, l.sellerId, weight);
      for (const t of l.styleTags) bump(traits.style, t, weight);
      if (weight > 0) for (const size of l.sizes.length ? l.sizes : [l.sizeValue]) bump(traits.size, size, weight);
      if (weight > 0 && l.price) prices.push([l.price, weight]);
      byItem.set(l.id, (byItem.get(l.id) ?? 0) + weight);
      // «Не моё» hides that exact item for a week; «Не интересно» is filtered out by the feed itself.
      if (s.type === 'swipe_left' && now - s.at < 7 * DAY) hidden.add(l.id);
    }
    const meta = s.meta ?? {};
    for (const c of meta.category ?? []) bump(traits.category, c, weight);
    for (const b of meta.brand ?? []) bump(traits.brand, b, weight);
    for (const t of meta.style ?? []) bump(traits.style, t, weight);
    for (const size of meta.size ?? []) bump(traits.size, size, weight);
    for (const c of meta.color ?? []) bump(traits.color, c, weight);
  }
  // Sizes from onboarding count as a steady, mild preference.
  for (const size of input.sizes) bump(traits.size, size, 2);

  // The price band the person engages with: weighted 20th–80th percentile.
  prices.sort((a, b) => a[0] - b[0]);
  const total = prices.reduce((n, p) => n + p[1], 0);
  const quantile = (q: number) => {
    let acc = 0;
    for (const [price, weight] of prices) if ((acc += weight) >= total * q) return price;
    return prices.at(-1)![0];
  };
  const priceBand: [number, number] = prices.length >= 3 ? [quantile(0.2) * 0.8, quantile(0.8) * 1.25] : [0, Infinity];

  // An item's net weight decides which side it's on: viewed, then «Не интересно» is a dislike.
  const liked: Weighted[] = [];
  const disliked: Weighted[] = [];
  for (const [id, w] of byItem) {
    const vec = input.vectors.get(id);
    if (vec && w > 0) liked.push({ vec, w });
    else if (vec && w < 0) disliked.push({ vec, w: -w });
  }
  // The 100 strongest likes are plenty and keep a feed request cheap.
  liked.sort((a, b) => b.w - a.w);
  return { traits, priceBand, followed: input.followed, liked: liked.slice(0, 100), disliked, hidden };
}

/** How well an item's traits match the profile (the rules the feed ran on before photo vectors). */
export function traitFit(p: Profile, c: Traits): number {
  const t = p.traits;
  const sizes = c.sizes.length ? c.sizes : [c.sizeValue];
  return (
    share(t.style, c.styleTags[0]) * 1.5 +
    Math.max(0, ...c.styleTags.slice(1).map((s) => share(t.style, s))) * 0.75 +
    share(t.category, c.category) * 2 +
    share(t.subcategory, c.subcategory) * 2 +
    share(t.brand, c.brand) * 1.5 +
    Math.max(0, ...sizes.map((s) => share(t.size, s))) * 1.5 +
    share(t.color, c.color) * 0.75 +
    share(t.gender, c.gender) * 0.5 +
    share(t.seller, c.sellerId) * 1 +
    (c.price != null && c.price >= p.priceBand[0] && c.price <= p.priceBand[1] ? 0.5 : 0) +
    (p.followed.has(c.sellerId) ? 1.5 : 0)
  );
}

/**
 * How well an item fits the person's looks: mean closeness to the nearest liked items, a stronger
 * like counting a little more. Nearest, not average: each taste is matched on its own.
 */
function lookFit(vec: Float32Array, liked: Weighted[]): number {
  const top = liked[0].w;
  const sims = liked.map((m) => cosine(vec, m.vec) + 0.05 * Math.log(m.w / top)).sort((a, b) => b - a);
  // A third of the history, so a short one isn't averaged into the middle of two tastes.
  const k = Math.max(1, Math.min(LOOK_NEIGHBOURS, Math.ceil(sims.length / 3)));
  return sims.slice(0, k).reduce((a, b) => a + b, 0) / k;
}

/** Mean and spread of a score over the candidates, to put scores of different kinds on one scale. */
function zScorer(values: number[]) {
  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  return (v: number) => (v - mean) / sd;
}

export interface Ranked<T> {
  item: T;
  score: number;
  /** Fits the profile (as opposed to the popular rest that fills the feed). */
  matched: boolean;
}

/** Scores every candidate against the profile; best first. */
export function score<T extends Traits>(input: TasteInput, profile: Profile, candidates: T[]): Ranked<T>[] {
  const { now } = input;
  const pool = candidates.filter((c) => !profile.hidden.has(c.id));
  const trait = pool.map((c) => traitFit(profile, c));
  const look = pool.map((c) => {
    const v = input.vectors.get(c.id);
    return v && profile.liked.length ? lookFit(v, profile.liked) : null;
  });
  // Looks like something turned down: closer than 0.9 starts to cost, a near copy costs the most.
  const unlike = pool.map((c) => {
    const v = input.vectors.get(c.id);
    let worst = 0;
    if (v) for (const d of profile.disliked) worst = Math.max(worst, (cosine(v, d.vec) - 0.9) * 10 * Math.min(1, d.w / 3));
    return worst;
  });
  const zTrait = zScorer(trait);
  const zLook = zScorer(look.filter((x): x is number => x != null));
  const maxPop = Math.max(1, ...input.popularity.values());
  return pool
    .map((c, i) => {
      const fit = zTrait(trait[i]) + (look[i] != null ? zLook(look[i]!) : 0) - unlike[i];
      const pop = (input.popularity.get(c.id) ?? 0) / maxPop;
      const fresh = c.publishedAt && now - c.publishedAt.getTime() < FRESH_MS ? 0.3 : 0;
      // Scrolled past it a few times: it had its chance (impressions without a click, as in Pinterest's and YouTube's feeds).
      const ignored = Math.log1p(input.ignored?.get(c.id) ?? 0) * 0.4;
      return { item: c, score: fit + pop * 0.8 + fresh - ignored, matched: fit > 0.5 };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Soft variety: the next item is the best of the next few after a cost for repeating the kind just shown (measured
 * against «never two of a kind side by side»: 48% of a buyer's taste on the first page instead of 46%, still 7 kinds
 * of 24). Never more than 3 in a row from one seller.
 */
function vary<T extends Traits>(ranked: Ranked<T>[]): T[] {
  const out: T[] = [];
  const pending = [...ranked];
  while (pending.length) {
    const tail = out.slice(-MAX_SAME_SELLER_IN_A_ROW);
    const blockedSeller = tail.length === MAX_SAME_SELLER_IN_A_ROW && tail.every((t) => t.sellerId === tail[0].sellerId) ? tail[0].sellerId : null;
    const [prev, prev2] = [out.at(-1), out.at(-2)];
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < Math.min(VARIETY_WINDOW, pending.length); i++) {
      const p = pending[i];
      if (p.item.sellerId === blockedSeller) continue;
      const kind = kindOf(p.item);
      const s = p.score - (prev && kindOf(prev) === kind ? KIND_REPEAT_COST : 0) - (prev2 && kindOf(prev2) === kind ? KIND_REPEAT_COST / 2 : 0);
      if (s > bestScore) [bestScore, best] = [s, i];
    }
    // Only that seller ahead: the first item of anyone else, however far.
    if (bestScore === -Infinity) best = Math.max(0, pending.findIndex((p) => p.item.sellerId !== blockedSeller));
    out.push(pending.splice(best, 1)[0].item);
  }
  return out;
}

/** The feed order: profile matches (best first) with every EXPLORE_EVERY-th slot from the popular rest, then the rest. */
function feedOrder<T extends Traits>(ranked: Ranked<T>[], popularity: Map<string, number>): T[] {
  const matched = ranked.filter((r) => r.matched);
  const rest = ranked.filter((r) => !r.matched).sort((a, b) => (popularity.get(b.item.id) ?? 0) - (popularity.get(a.item.id) ?? 0) || b.score - a.score);
  const merged: Ranked<T>[] = [];
  while (matched.length || rest.length) {
    const explore = rest.length && (!matched.length || (merged.length + 1) % EXPLORE_EVERY === 0);
    // An explore slot keeps its place in the variety pass: it takes the score of the item before it.
    const next = (explore ? rest.shift() : matched.shift())!;
    merged.push(explore && merged.length ? { ...next, score: merged.at(-1)!.score } : next);
  }
  return vary(merged);
}

/** «Для вас» in one call. */
export function rankForYou<T extends Traits>(input: TasteInput, candidates: T[]): T[] {
  return feedOrder(score(input, buildProfile(input), candidates), input.popularity);
}
