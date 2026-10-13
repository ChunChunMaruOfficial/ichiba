import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Recommendations, the way second-hand marketplaces (Vinted, Depop, Poshmark, Avito) do it without ML: every action
 * is a weighted signal about the item's traits; signals fade with time, so the feed follows what the person does
 * now rather than what they did when the account was made. Rules, not a model: easy to reason about and to tune.
 */
const SIGNAL_WEIGHTS = {
  view: 1,
  /** A search or a filter: what the person is looking for right now (traits in Signal.meta). */
  search: 3,
  filter: 2,
  favorite: 5,
  swipe_right: 5,
  offer: 6,
  cart: 6,
  request: 8,
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

const DAY = 24 * 3600 * 1000;
/** A signal counts half after two weeks, a quarter after four: the profile drifts with the person's taste. */
const HALF_LIFE_MS = 14 * DAY;
const FRESH_MS = 72 * 3600 * 1000;
const MAX_SAME_SELLER_IN_A_ROW = 3;
/** Every n-th item of «Для вас» comes from outside the profile, so tastes can widen. */
const EXPLORE_EVERY = 5;

/** What ranking needs from a listing; feeds select exactly this. */
export const RANK_SELECT = {
  id: true,
  sellerId: true,
  category: true,
  subcategory: true,
  brand: true,
  color: true,
  sizeValue: true,
  sizes: true,
  styleTags: true,
  gender: true,
  price: true,
  publishedAt: true,
  viewsCount: true,
  favoritesCount: true,
} satisfies Prisma.ListingSelect;
export type Candidate = Prisma.ListingGetPayload<{ select: typeof RANK_SELECT }>;

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

@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, type: SignalType, listingId?: string, meta?: SignalMeta) {
    await this.prisma.signal.create({ data: { userId, type, weight: SIGNAL_WEIGHTS[type], listingId, meta: meta ? { ...meta } : undefined } });
  }

  /** Enough to say what the person likes: a few actions, or sizes picked at onboarding. */
  async hasProfile(userId: string) {
    const [n, user] = await Promise.all([
      this.prisma.signal.count({ where: { userId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { sizes: true } }),
    ]);
    const sizes = (user?.sizes ?? {}) as Record<string, string[] | undefined>;
    return n >= 3 || Object.values(sizes).some((s) => s?.length);
  }

  /**
   * «Популярное»: how much people engage with each item. Lifetime counters (views, saves) plus deeper actions of the
   * last 30 days (carts, offers, requests), which fade like profile signals so a hot new item can overtake an old one.
   */
  async popularity(candidates: Pick<Candidate, 'id' | 'viewsCount' | 'favoritesCount'>[]): Promise<Map<string, number>> {
    const ids = candidates.map((c) => c.id);
    const recent = await this.prisma.signal.findMany({
      where: { listingId: { in: ids }, createdAt: { gt: new Date(Date.now() - 30 * DAY) }, type: { in: ['favorite', 'swipe_right', 'cart', 'offer', 'request'] } },
      select: { listingId: true, weight: true, createdAt: true },
    });
    const now = Date.now();
    const score = new Map<string, number>(candidates.map((c) => [c.id, c.viewsCount + 4 * c.favoritesCount]));
    for (const s of recent) score.set(s.listingId!, (score.get(s.listingId!) ?? 0) + s.weight * 0.5 ** ((now - s.createdAt.getTime()) / HALF_LIFE_MS));
    return score;
  }

  /** Candidates by popularity, newest first among equals. */
  async rankPopular(candidates: Candidate[]): Promise<string[]> {
    const pop = await this.popularity(candidates);
    const t = (c: Candidate) => c.publishedAt?.getTime() ?? 0;
    return [...candidates].sort((a, b) => (pop.get(b.id) ?? 0) - (pop.get(a.id) ?? 0) || t(b) - t(a)).map((c) => c.id);
  }

  /**
   * «Для вас»: items like the ones the person engaged with lately come first (style, kind, brand, size, colour,
   * price), then the popular rest; every few items one comes from outside the profile.
   */
  async rankForUser(userId: string, candidates: Candidate[]): Promise<string[]> {
    const [signals, follows, user, popularity] = await Promise.all([
      this.prisma.signal.findMany({
        where: { userId, createdAt: { gt: new Date(Date.now() - 90 * DAY) } },
        orderBy: { createdAt: 'desc' },
        take: 800,
        include: { listing: { select: { category: true, subcategory: true, brand: true, color: true, sizeValue: true, sizes: true, styleTags: true, gender: true, price: true, sellerId: true } } },
      }),
      this.prisma.follow.findMany({ where: { followerId: userId }, select: { sellerId: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { sizes: true } }),
      this.popularity(candidates),
    ]);

    const now = Date.now();
    const w = { category: new Map(), subcategory: new Map(), brand: new Map(), style: new Map(), size: new Map(), color: new Map(), gender: new Map(), seller: new Map() } satisfies Record<string, Weights>;
    const prices: Array<[number, number]> = [];
    const hidden = new Set<string>();
    for (const s of signals) {
      const decay = 0.5 ** ((now - s.createdAt.getTime()) / HALF_LIFE_MS);
      const weight = s.weight * decay;
      const l = s.listing;
      if (l) {
        bump(w.category, l.category, weight);
        bump(w.subcategory, l.subcategory, weight);
        bump(w.brand, l.brand, weight);
        bump(w.color, l.color, weight);
        bump(w.gender, l.gender, weight);
        bump(w.seller, l.sellerId, weight);
        for (const t of l.styleTags) bump(w.style, t, weight);
        if (weight > 0) for (const size of l.sizes.length ? l.sizes : [l.sizeValue]) bump(w.size, size, weight);
        if (weight > 0 && l.price) prices.push([l.price, weight]);
      }
      const meta = (s.meta ?? {}) as SignalMeta;
      for (const c of meta.category ?? []) bump(w.category, c, weight);
      for (const b of meta.brand ?? []) bump(w.brand, b, weight);
      for (const t of meta.style ?? []) bump(w.style, t, weight);
      for (const size of meta.size ?? []) bump(w.size, size, weight);
      for (const c of meta.color ?? []) bump(w.color, c, weight);
      // «Не моё» hides that exact item for a week; «Не интересно» is filtered out by the feed itself.
      if (s.type === 'swipe_left' && now - s.createdAt.getTime() < 7 * DAY && s.listingId) hidden.add(s.listingId);
    }
    // Sizes from onboarding count as a steady, mild preference.
    for (const list of Object.values((user?.sizes ?? {}) as Record<string, string[] | undefined>)) for (const size of list ?? []) bump(w.size, size, 2);

    // The price band the person engages with: weighted 20th–80th percentile.
    prices.sort((a, b) => a[0] - b[0]);
    const total = prices.reduce((n, p) => n + p[1], 0);
    const quantile = (q: number) => {
      let acc = 0;
      for (const [price, weight] of prices) if ((acc += weight) >= total * q) return price;
      return prices.at(-1)?.[0];
    };
    const [low, high] = prices.length >= 3 ? [quantile(0.2)! * 0.8, quantile(0.8)! * 1.25] : [0, Infinity];
    const followed = new Set(follows.map((f) => f.sellerId));
    const maxPop = Math.max(1, ...popularity.values());

    const scored = candidates
      .filter((c) => !hidden.has(c.id))
      .map((c) => {
        const sizes = c.sizes.length ? c.sizes : [c.sizeValue];
        const affinity =
          share(w.style, c.styleTags[0]) * 1.5 +
          Math.max(0, ...c.styleTags.slice(1).map((t) => share(w.style, t))) * 0.75 +
          share(w.category, c.category) * 2 +
          share(w.subcategory, c.subcategory) * 2 +
          share(w.brand, c.brand) * 1.5 +
          Math.max(0, ...sizes.map((s) => share(w.size, s))) * 1.5 +
          share(w.color, c.color) * 0.75 +
          share(w.gender, c.gender) * 0.5 +
          share(w.seller, c.sellerId) * 1 +
          (c.price != null && c.price >= low && c.price <= high ? 0.5 : 0) +
          (followed.has(c.sellerId) ? 1.5 : 0);
        const pop = (popularity.get(c.id) ?? 0) / maxPop;
        const fresh = c.publishedAt && now - c.publishedAt.getTime() < FRESH_MS ? 0.3 : 0;
        return { c, affinity, score: affinity + pop * 0.8 + fresh, pop };
      });

    // Profile matches first (best first), then the popular rest; one in EXPLORE_EVERY comes from that rest.
    const matched = scored.filter((s) => s.affinity >= 1).sort((a, b) => b.score - a.score);
    const rest = scored.filter((s) => s.affinity < 1).sort((a, b) => b.pop - a.pop || b.score - a.score);
    const merged: Candidate[] = [];
    while (matched.length || rest.length) {
      const explore = rest.length && (!matched.length || (merged.length + 1) % EXPLORE_EVERY === 0);
      merged.push((explore ? rest.shift() : matched.shift())!.c);
    }
    return this.diversify(merged).map((c) => c.id);
  }

  /** No more than 3 items in a row from the same seller. */
  private diversify(items: Candidate[]): Candidate[] {
    const out: Candidate[] = [];
    const pending = [...items];
    while (pending.length) {
      const tail = out.slice(-MAX_SAME_SELLER_IN_A_ROW);
      const blocked = tail.length === MAX_SAME_SELLER_IN_A_ROW && tail.every((t) => t.sellerId === tail[0].sellerId) ? tail[0].sellerId : null;
      const idx = blocked ? pending.findIndex((p) => p.sellerId !== blocked) : 0;
      out.push(pending.splice(idx === -1 ? 0 : idx, 1)[0]);
    }
    return out;
  }
}
