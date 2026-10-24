import { Injectable } from '@nestjs/common';
import { PhotoIndex } from '../ai/photo-index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HALF_LIFE_MS, meanVector, rankForYou, SIGNAL_WEIGHTS, spread, type SignalMeta, type SignalType, type TasteEvent } from './taste.js';

export { kindOf, SIGNAL_WEIGHTS, spread, type SignalMeta, type SignalType } from './taste.js';

/**
 * Recommendations, the way fashion marketplaces and Pinterest build them at our size: every action is a weighted
 * signal about an item, fading with time; «Для вас» ranks by the items' traits and by how they look (photo vectors).
 * The model itself is taste.ts; this service collects the signals and the data it needs. docs/RECOMMENDATIONS.md.
 */

const DAY = 24 * 3600 * 1000;
/** Impressions older than this are forgotten: an item scrolled past last month may deserve another look. */
const IMPRESSIONS_MS = 14 * DAY;
/**
 * «Для вас» keeps its order while the person scrolls (up to 30 min); the first page is ranked afresh once the order
 * is a minute old — not on every refetch of it, or the pages already loaded would no longer follow it.
 */
const FOR_YOU_TTL_MS = 30 * 60_000;
const FOR_YOU_FRESH_MS = 60_000;
const LOOK_TTL_MS = 60_000;

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

const TRAITS_SELECT = {
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
} satisfies Prisma.ListingSelect;

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotoIndex,
  ) {}

  private looks: { exp: number; v: Promise<Map<string, Float32Array>> } | null = null;
  private readonly forYouCache = new Map<string, { at: number; ids: string[] }>();

  async record(userId: string, type: SignalType, listingId?: string, meta?: SignalMeta) {
    await this.prisma.signal.create({ data: { userId, type, weight: SIGNAL_WEIGHTS[type], listingId, meta: meta ? { ...meta } : undefined } });
  }

  /** Records a signal unless the same one was recorded for the item within `withinMs` (one message, not every message). */
  async recordOnce(userId: string, type: SignalType, listingId: string, withinMs: number) {
    const recent = await this.prisma.signal.count({ where: { userId, type, listingId, createdAt: { gt: new Date(Date.now() - withinMs) } } });
    if (!recent) await this.record(userId, type, listingId);
  }

  /**
   * How a visit to an item page ended: a long look (20+ s, or 3+ photos) says more than the click itself; leaving
   * within 4 s says the click was a miss. Counted once per item per half hour.
   */
  async engagement(userId: string, listingId: string, ms: number, photos: number) {
    const type: SignalType | null = ms >= 20_000 || photos >= 3 ? 'dwell' : ms < 4_000 && photos <= 1 ? 'bounce' : null;
    if (!type) return;
    const recent = await this.prisma.signal.count({ where: { userId, listingId, type: { in: ['dwell', 'bounce'] }, createdAt: { gt: new Date(Date.now() - 30 * 60_000) } } });
    if (!recent) await this.record(userId, type, listingId);
  }

  /** Items a feed showed the person (counted by the client when a card has been on screen for a moment). */
  async impressions(userId: string, listingIds: string[]) {
    if (!listingIds.length) return;
    const since = new Date(Date.now() - IMPRESSIONS_MS);
    await this.prisma.$executeRaw`
      INSERT INTO "FeedImpression" ("userId", "listingId", "count", "lastAt")
      SELECT ${userId}, l."id", 1, now() FROM "Listing" l WHERE l."id" = ANY(${listingIds}::text[])
      ON CONFLICT ("userId", "listingId") DO UPDATE
      SET "count" = CASE WHEN "FeedImpression"."lastAt" < ${since} THEN 1 ELSE "FeedImpression"."count" + 1 END, "lastAt" = now()`;
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
      where: { listingId: { in: ids }, createdAt: { gt: new Date(Date.now() - 30 * DAY) }, type: { in: ['favorite', 'swipe_right', 'cart', 'offer', 'message', 'request'] } },
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
    return spread([...candidates].sort((a, b) => (pop.get(b.id) ?? 0) - (pop.get(a.id) ?? 0) || t(b) - t(a))).map((c) => c.id);
  }

  /**
   * The look of every listing with indexed photos: the mean of its photos' vectors in the model that indexes every
   * photo (the local one, unmetered; Gemini only when the local one is off). Rebuilt once a minute.
   */
  lookVectors(): Promise<Map<string, Float32Array>> {
    if (this.looks && this.looks.exp > Date.now()) return this.looks.v;
    const v = this.loadLooks();
    this.looks = { exp: Date.now() + LOOK_TTL_MS, v };
    v.catch(() => (this.looks = null));
    return v;
  }

  private async loadLooks() {
    const embedder = this.photos.embedders.all.find((e) => !e.metered) ?? this.photos.embedders.all[0];
    const out = new Map<string, Float32Array>();
    if (!embedder) return out;
    const [vectors, photos] = await Promise.all([
      this.photos.vectors(embedder.id),
      this.prisma.photo.findMany({ where: { isDefect: false, listing: { status: { in: ['PUBLISHED', 'RESERVED', 'SOLD'] } } }, select: { listingId: true, key: true } }),
    ]);
    const byListing = new Map<string, Float32Array[]>();
    for (const p of photos) {
      const v = vectors.get(p.key);
      if (v && p.listingId) (byListing.get(p.listingId) ?? byListing.set(p.listingId, []).get(p.listingId)!).push(v);
    }
    for (const [id, vs] of byListing) out.set(id, meanVector(vs)!);
    return out;
  }

  /**
   * «Для вас» for a feed that pages through it: the next page continues the same order; the first page ranks again
   * with whatever the person did meanwhile.
   */
  async forYou(userId: string, key: string, candidates: Candidate[], firstPage: boolean): Promise<string[]> {
    const cacheKey = `${userId}:${key}`;
    const hit = this.forYouCache.get(cacheKey);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (age < (firstPage ? FOR_YOU_FRESH_MS : FOR_YOU_TTL_MS)) return hit!.ids;
    const ids = await this.rankForUser(userId, candidates);
    if (this.forYouCache.size >= 1000) this.forYouCache.clear();
    this.forYouCache.set(cacheKey, { at: Date.now(), ids });
    return ids;
  }

  /**
   * «Для вас»: items like the ones the person engaged with lately — by traits and by look — come first, with one in
   * eight from the popular rest; items scrolled past again and again give way to others.
   */
  async rankForUser(userId: string, candidates: Candidate[]): Promise<string[]> {
    const now = Date.now();
    const [signals, follows, user, impressions, popularity, vectors] = await Promise.all([
      this.prisma.signal.findMany({
        where: { userId, createdAt: { gt: new Date(now - 90 * DAY) } },
        orderBy: { createdAt: 'desc' },
        take: 800,
        include: { listing: { select: TRAITS_SELECT } },
      }),
      this.prisma.follow.findMany({ where: { followerId: userId }, select: { sellerId: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { sizes: true } }),
      this.prisma.feedImpression.findMany({ where: { userId, lastAt: { gt: new Date(now - IMPRESSIONS_MS) } }, select: { listingId: true, count: true } }),
      this.popularity(candidates),
      this.lookVectors(),
    ]);
    const events: TasteEvent[] = signals.map((s) => ({ type: s.type, weight: s.weight, at: s.createdAt.getTime(), listing: s.listing, meta: s.meta as SignalMeta | null }));
    // Shown, never opened: the first showing is free, every repeat after it counts.
    const touched = new Set(signals.map((s) => s.listingId));
    const ignored = new Map(impressions.filter((i) => !touched.has(i.listingId) && i.count > 1).map((i) => [i.listingId, i.count - 1]));
    const sizes = Object.values((user?.sizes ?? {}) as Record<string, string[] | undefined>).flatMap((s) => s ?? []);
    return rankForYou({ now, events, vectors, followed: new Set(follows.map((f) => f.sellerId)), sizes, popularity, ignored }, candidates).map((c) => c.id);
  }
}
