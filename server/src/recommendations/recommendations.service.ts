import { Injectable } from '@nestjs/common';
import type { Listing } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Signal weights from frame 22 "RECOMMENDATION LOGIC MVP" (rules, not ML). */
const SIGNAL_WEIGHTS = {
  view: 1,
  favorite: 5,
  swipe_right: 5,
  swipe_left: -3,
  cart: 6,
  request: 8,
  follow: 10,
  filter: 2,
} as const;
export type SignalType = keyof typeof SIGNAL_WEIGHTS;

const DAY = 24 * 3600 * 1000;
const FRESH_MS = 72 * 3600 * 1000;
const MAX_SAME_SELLER_IN_A_ROW = 3;
const EXPLORATION_SHARE = 0.3;

type Candidate = Pick<Listing, 'id' | 'sellerId' | 'category' | 'brand' | 'color' | 'sizeValue' | 'price' | 'publishedAt'>;

@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, type: SignalType, listingId?: string) {
    await this.prisma.signal.create({ data: { userId, type, weight: SIGNAL_WEIGHTS[type], listingId } });
  }

  /** "Для вас" appears after 5+ item views or any onboarding swipes (frame 06 STATES). */
  async hasProfile(userId: string) {
    const n = await this.prisma.signal.count({ where: { userId, type: { in: ['view', 'favorite', 'swipe_right', 'swipe_left'] } } });
    return n >= 5;
  }

  /** Popularity = views + 3×favorites over the last 7 days. */
  async popularity(listingIds?: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.signal.groupBy({
      by: ['listingId', 'type'],
      where: {
        createdAt: { gt: new Date(Date.now() - 7 * DAY) },
        type: { in: ['view', 'favorite', 'swipe_right'] },
        listingId: listingIds ? { in: listingIds } : { not: null },
      },
      _count: true,
    });
    const score = new Map<string, number>();
    for (const r of rows) {
      if (!r.listingId) continue;
      score.set(r.listingId, (score.get(r.listingId) ?? 0) + r._count * (r.type === 'view' ? 1 : 3));
    }
    return score;
  }

  /** Ranks candidate listings for a user; returns ids in feed order. */
  async rankForUser(userId: string, candidates: Candidate[]): Promise<string[]> {
    const [signals, follows, popularity] = await Promise.all([
      this.prisma.signal.findMany({
        where: { userId, listingId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: { listing: { select: { category: true, brand: true, color: true, sizeValue: true, price: true } } },
      }),
      this.prisma.follow.findMany({ where: { followerId: userId }, select: { sellerId: true } }),
      this.popularity(candidates.map((c) => c.id)),
    ]);

    const weights = { category: new Map<string, number>(), brand: new Map<string, number>(), color: new Map<string, number>(), size: new Map<string, number>() };
    const bump = (m: Map<string, number>, k: string | null | undefined, w: number) => k && m.set(k, (m.get(k) ?? 0) + w);
    const prices: number[] = [];
    const rejected = new Set<string>();
    for (const s of signals) {
      if (!s.listing) continue;
      bump(weights.category, s.listing.category, s.weight);
      bump(weights.brand, s.listing.brand, s.weight);
      bump(weights.color, s.listing.color, s.weight);
      if (s.weight > 0) bump(weights.size, s.listing.sizeValue, s.weight);
      if (s.weight > 0 && s.listing.price) prices.push(s.listing.price);
      // "Не моё" hides that exact item for 7 days.
      if (s.type === 'swipe_left' && s.createdAt.getTime() > Date.now() - 7 * DAY && s.listingId) rejected.add(s.listingId);
    }
    prices.sort((a, b) => a - b);
    const p25 = prices[Math.floor(prices.length * 0.25)] ?? 0;
    const p75 = prices[Math.floor(prices.length * 0.75)] ?? Infinity;
    const followed = new Set(follows.map((f) => f.sellerId));
    const norm = (m: Map<string, number>) => Math.max(1, ...m.values());
    const maxPop = Math.max(1, ...popularity.values());

    const scored = candidates
      .filter((c) => !rejected.has(c.id))
      .map((c) => {
        const affinity =
          (weights.category.get(c.category ?? '') ?? 0) / norm(weights.category) * 3 +
          (weights.brand.get(c.brand ?? '') ?? 0) / norm(weights.brand) * 2 +
          (weights.color.get(c.color ?? '') ?? 0) / norm(weights.color) * 1.5 +
          (weights.size.get(c.sizeValue ?? '') ?? 0) / norm(weights.size) * 2 +
          (prices.length && c.price && c.price >= p25 && c.price <= p75 ? 1 : 0);
        const fresh = c.publishedAt && Date.now() - c.publishedAt.getTime() < FRESH_MS ? 1 : 0;
        const pop = (popularity.get(c.id) ?? 0) / maxPop;
        const follow = followed.has(c.sellerId) ? 2 : 0;
        return { c, affinity, score: affinity + fresh + pop + follow };
      });

    // 70% profile matches, 30% exploration (fresh/popular outside the profile), interleaved.
    const matched = scored.filter((s) => s.affinity > 0).sort((a, b) => b.score - a.score);
    const explore = scored.filter((s) => s.affinity <= 0).sort((a, b) => b.score - a.score);
    const merged: Candidate[] = [];
    let mi = 0;
    let ei = 0;
    while (mi < matched.length || ei < explore.length) {
      const takeExplore = ei < explore.length && (mi >= matched.length || (merged.length + 1) * EXPLORATION_SHARE > ei + 0.5);
      merged.push(takeExplore ? explore[ei++].c : matched[mi++].c);
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
