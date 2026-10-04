import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { categoryBySlug, COLORS, CONDITIONS } from '../catalog/catalog.js';
import type { Condition } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { median, nicePrice, weightedQuantile } from './ensemble/aggregate.js';
import { AiEnsemble, hashKey, TtlCache } from './ensemble/ensemble.js';
import { hasProfanity } from './text-rules.js';

/**
 * Price hint (AI feature 1): "такие уходят за 40–55 BYN".
 * Market data first — comparable listings on the platform, adjusted to the item's condition, sold items
 * weighted up — then the ensemble's estimate, blended in with a weight that shrinks as market data grows.
 */

export interface PriceInput {
  listingId?: string | null;
  title?: string | null;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  color?: string | null;
  condition?: Condition | null;
  defectsPresent?: boolean | null;
  material?: string | null;
  size?: string | null;
  photoIds?: string[];
}

export interface PriceSuggestion {
  status: 'ok' | 'insufficient';
  recommended: number | null;
  low: number | null;
  high: number | null;
  quickSale: number | null;
  confidence: 'high' | 'medium' | 'low';
  facts: string[];
  reasoning: string | null;
  basis: { comparables: number; sold: number; aiVotes: number };
  comparables: ReturnType<typeof serializeCard>[];
  auction: { start: number; reserve: number } | null;
  model: string;
}

const COND_FACTOR: Record<Condition, number> = { NEW_WITH_TAGS: 1.25, LIKE_NEW: 1.1, GOOD: 1, VISIBLE_WEAR: 0.75 };
const COND_INDEX: Record<Condition, number> = { NEW_WITH_TAGS: 0, LIKE_NEW: 1, GOOD: 2, VISIBLE_WEAR: 3 };
const DEFECT_FACTOR = 0.85;
const DAY = 24 * 3600 * 1000;

const int = z.coerce.number().int().min(1).max(100_000);
const PriceVote = z.object({
  low: int,
  high: int,
  recommended: int,
  quick_sale: int,
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  brand_tier: z.enum(['mass', 'premium', 'luxury', 'unknown']).catch('unknown'),
  reasoning: z.string().catch(''),
});

const SYSTEM = `Ты оцениваешь цену б/у вещи для C2C-маркетплейса одежды в Беларуси. Цены в белорусских рублях (BYN), целые числа.
Ориентиры рынка: массовые бренды (Zara, H&M, Mango) в хорошем состоянии обычно 15–60 BYN, премиальные (COS, Massimo Dutti, The North Face) 40–200 BYN, люкс — от 300 BYN. Новая вещь с биркой дороже, заметные следы носки и дефекты снижают цену.
Если даны похожие объявления площадки — опирайся прежде всего на них; не придумывай цены, далёкие от рынка.
- recommended — цена, по которой вещь разумно продастся за 1–2 недели;
- low/high — реалистичный диапазон;
- quick_sale — цена для продажи за пару дней;
- reasoning — одно короткое предложение по-русски, почему так (до 160 символов).`;

@Injectable()
export class PriceAdvisor {
  private readonly cache = new TtlCache<PriceSuggestion>(30 * 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ensemble: AiEnsemble,
    private readonly media: MediaService,
  ) {}

  async suggest(userId: string | null, input: PriceInput): Promise<PriceSuggestion> {
    const key = hashKey('price', input, userId);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const comps = await this.comparables(userId, input);
    const ai = await this.askEnsemble(input, comps, userId);
    const result = await this.combine(input, comps, ai);
    this.cache.set(key, result);
    return result;
  }

  private async comparables(userId: string | null, input: PriceInput) {
    const rows = await this.prisma.listing.findMany({
      where: {
        category: input.category,
        price: { not: null },
        status: { in: ['PUBLISHED', 'RESERVED', 'SOLD'] },
        ...(input.listingId ? { id: { not: input.listingId } } : {}),
        ...(userId ? { sellerId: { not: userId } } : {}),
      },
      select: { id: true, title: true, price: true, brand: true, subcategory: true, condition: true, defectsPresent: true, status: true, publishedAt: true, soldAt: true, createdAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 400,
    });
    const target = input.condition ?? 'GOOD';
    const brand = input.brand?.trim().toLowerCase() || null;
    return rows
      .map((r) => {
        let w = 1;
        if (input.subcategory && r.subcategory === input.subcategory) w *= 2;
        const rb = r.brand?.trim().toLowerCase() || null;
        if (brand && rb === brand) w *= 3;
        else if (brand && rb && rb !== brand) w *= 0.6;
        const dist = Math.abs(COND_INDEX[target] - COND_INDEX[r.condition ?? 'GOOD']);
        w *= [1, 0.7, 0.45, 0.3][dist];
        if (r.status === 'SOLD') w *= 1.3;
        const age = (Date.now() - (r.soldAt ?? r.publishedAt ?? r.createdAt).getTime()) / DAY;
        w *= Math.exp(-Math.max(0, age) / 120);
        // Bring the comparable to the target item's condition and defects.
        let adjusted = (r.price! * COND_FACTOR[target]) / COND_FACTOR[r.condition ?? 'GOOD'];
        if (input.defectsPresent) adjusted *= DEFECT_FACTOR;
        if (r.defectsPresent) adjusted /= DEFECT_FACTOR;
        return { ...r, weight: w, adjusted, brandMatch: !!brand && rb === brand };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 25);
  }

  private async askEnsemble(input: PriceInput, comps: Awaited<ReturnType<PriceAdvisor['comparables']>>, userId: string | null) {
    if (!this.ensemble.available) return [];
    const category = categoryBySlug(input.category);
    const facts = [
      input.title && `Название: ${input.title}`,
      `Категория: ${category?.label ?? input.category}${input.subcategory ? ` / ${category?.subcategories.find((s) => s.slug === input.subcategory)?.label ?? input.subcategory}` : ''}`,
      input.brand && `Бренд: ${input.brand}`,
      input.color && `Цвет: ${COLORS.find((c) => c.value === input.color)?.label ?? input.color}`,
      input.condition && `Состояние: ${CONDITIONS.find((c) => c.value === input.condition)?.label}`,
      input.defectsPresent != null && `Дефекты: ${input.defectsPresent ? 'есть' : 'нет'}`,
      input.material && `Материал: ${input.material}`,
      input.size && `Размер: ${input.size}`,
    ].filter(Boolean);
    const compLines = comps.slice(0, 12).map((c) => `- ${c.title} · ${c.brand ?? 'без бренда'} · ${CONDITIONS.find((x) => x.value === c.condition)?.label ?? '—'} · ${c.price} BYN · ${c.status === 'SOLD' ? 'продано' : 'в продаже'}`);

    let images: Buffer[] = [];
    if (input.photoIds?.length) {
      const photo = await this.prisma.photo.findFirst({ where: { id: input.photoIds[0], ...(userId ? { ownerId: userId } : {}) } });
      if (photo) images = [await this.media.imageForAi(photo.key, 384).catch(() => null)].filter((b): b is Buffer => !!b);
    }
    const { votes } = await this.ensemble.run({
      feature: 'price_suggest',
      system: SYSTEM,
      prompt: `Вещь:\n${facts.join('\n')}\n\nПохожие объявления на площадке${compLines.length ? '' : ': нет данных'}\n${compLines.join('\n')}`,
      images,
      schema: PriceVote,
      tier: 'fast',
      maxTokens: 400,
      subject: input.listingId ? { type: 'listing', id: input.listingId } : undefined,
      logResult: (v) => ({ recommended: median(v.map((x) => x.value.recommended)) }),
    });
    return votes;
  }

  private async combine(input: PriceInput, comps: Awaited<ReturnType<PriceAdvisor['comparables']>>, votes: Awaited<ReturnType<PriceAdvisor['askEnsemble']>>): Promise<PriceSuggestion> {
    const n = comps.length;
    const sold = comps.filter((c) => c.status === 'SOLD');
    const items = comps.map((c) => ({ value: c.adjusted, weight: c.weight }));
    const cMed = weightedQuantile(items, 0.5);
    const cLow = weightedQuantile(items, 0.25);
    const cHigh = weightedQuantile(items, 0.75);

    // Drop model answers far off the market (hallucinations) when there is market data to compare with.
    const sane = votes.filter((v) => {
      const x = v.value;
      if (!(x.low <= x.recommended && x.recommended <= x.high)) return false;
      if (n >= 3 && cMed) return x.recommended >= cMed / 4 && x.recommended <= cMed * 4;
      return true;
    });
    const aiRec = median(sane.map((v) => v.value.recommended));
    const aiLow = median(sane.map((v) => v.value.low));
    const aiHigh = median(sane.map((v) => v.value.high));
    const aiQuick = median(sane.map((v) => v.value.quick_sale));

    const hasMarket = n >= 3 && cMed != null;
    if (!hasMarket && aiRec == null) {
      return { status: 'insufficient', recommended: null, low: null, high: null, quickSale: null, confidence: 'low', facts: [], reasoning: null, basis: { comparables: n, sold: sold.length, aiVotes: 0 }, comparables: [], auction: null, model: 'none' };
    }
    const wMarket = !hasMarket ? 0 : aiRec == null ? 1 : Math.min(0.75, 0.25 + n / 30);
    const blend = (m: number | null, a: number | null) => (m != null && a != null ? wMarket * m + (1 - wMarket) * a : (m ?? a)!);

    const rec = blend(hasMarket ? cMed : null, aiRec);
    let low = blend(hasMarket ? cLow : null, aiLow);
    let high = blend(hasMarket ? cHigh : null, aiHigh);
    low = Math.min(low, rec * 0.95, rec);
    high = Math.max(high, rec * 1.05);
    low = Math.max(low, rec * 0.55);
    high = Math.min(high, rec * 1.7);
    const quick = Math.min(aiQuick != null ? (aiQuick + low) / 2 : low, rec * 0.88);

    const recs = sane.map((v) => v.value.recommended);
    const spread = recs.length >= 2 ? (Math.max(...recs) - Math.min(...recs)) / (median(recs) || 1) : null;
    const confidence: PriceSuggestion['confidence'] =
      (n >= 8 && (spread == null || spread < 0.5)) || (n >= 4 && sane.length >= 2 && spread != null && spread < 0.35) ? 'high' : n < 3 && sane.length < 2 ? 'low' : spread != null && spread > 0.9 ? 'low' : 'medium';

    const facts: string[] = [];
    if (hasMarket) facts.push(`${n} ${plural(n, 'похожая вещь', 'похожие вещи', 'похожих вещей')} на площадке: обычно ${nicePrice(cLow!)}–${nicePrice(cHigh!)} BYN`);
    if (sold.length) facts.push(`${sold.length} ${plural(sold.length, 'продана', 'проданы', 'продано')} — в среднем за ${nicePrice(median(sold.map((s) => s.price!))!)} BYN`);
    if (input.condition && input.condition !== 'GOOD') facts.push(`Учли состояние «${CONDITIONS.find((c) => c.value === input.condition)?.label.toLowerCase()}»`);
    if (input.defectsPresent) facts.push('Учли дефекты: −15%');

    // A model's explanation is shown only if its own estimate is close to the final number.
    const closest = [...sane].sort((a, b) => Math.abs(a.value.recommended - rec) - Math.abs(b.value.recommended - rec))[0];
    const reasoning = closest && Math.abs(closest.value.recommended - rec) / rec <= 0.1 ? closest.value.reasoning.trim().slice(0, 200) || null : null;

    const top = comps.filter((c) => c.status !== 'RESERVED').slice(0, 3);
    const cards = top.length ? await this.prisma.listing.findMany({ where: { id: { in: top.map((c) => c.id) } }, include: cardInclude }) : [];

    const r = { rec: nicePrice(rec), low: nicePrice(low), high: nicePrice(high), quick: nicePrice(quick) };
    return {
      status: 'ok',
      recommended: r.rec,
      low: Math.min(r.low, r.rec),
      high: Math.max(r.high, r.rec),
      quickSale: Math.min(r.quick, r.rec),
      confidence,
      facts,
      reasoning: reasoning && !hasProfanity(reasoning) ? reasoning : null,
      basis: { comparables: n, sold: sold.length, aiVotes: sane.length },
      comparables: top.map((c) => cards.find((x) => x.id === c.id)).filter((x) => !!x).map((x) => serializeCard(x)),
      // Low start attracts bidders; the reserve protects the realistic price.
      auction: (() => {
        const start = nicePrice(Math.max(1, Math.min(low, quick) * 0.8));
        return { start, reserve: Math.max(start, nicePrice(quick)) };
      })(),
      model: sane.length ? `ensemble:${sane.map((v) => v.model).join('+')}${hasMarket ? '+market' : ''}` : 'market',
    };
  }
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
