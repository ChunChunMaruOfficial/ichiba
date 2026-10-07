import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CONDITIONS } from '../catalog/catalog.js';
import type { Condition, OfferSide } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { majority, median, nicePrice } from './ensemble/aggregate.js';
import { AiEnsemble, hashKey, TtlCache, Vote } from './ensemble/ensemble.js';
import { PriceAdvisor, PriceSuggestion } from './price.js';
import { hasProfanity } from './text-rules.js';

/**
 * Negotiation hints (AI feature 5): whether to accept an offer and what counter-offer is reasonable.
 * A deterministic rule (market price, demand, days on sale, round) is one voter; each ensemble provider
 * is another. The counter amount is the median of the counter voters, always clamped to the allowed
 * range. The buyer side never sees anything derived from the seller's hidden minimum price.
 */

export type Action = 'accept' | 'counter' | 'decline';
export interface NegotiationAdvice {
  action: Action;
  counter: number | null;
  confidence: 'high' | 'medium' | 'low';
  facts: string[];
  reason: string | null;
  market: { low: number; high: number; recommended: number } | null;
  model: string;
}

export interface OfferContext {
  id: string;
  updatedAt: Date;
  round: number;
  amount: number;
  from: OfferSide;
  buyerId: string;
  listing: {
    id: string;
    title: string;
    price: number | null;
    category: string | null;
    subcategory: string | null;
    brand: string | null;
    color: string | null;
    condition: Condition | null;
    defectsPresent: boolean | null;
    sizeValue: string | null;
    minOfferPrice: number | null;
    viewsCount: number;
    favoritesCount: number;
    publishedAt: Date | null;
    createdAt: Date;
    sellerId: string;
  };
}

const AdviceVote = z.object({
  action: z.enum(['accept', 'counter', 'decline']),
  counter_amount: z.coerce.number().int().positive().nullish().catch(null),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  reason: z.string().catch(''),
});
type AdviceVoteT = z.infer<typeof AdviceVote>;

const SYSTEM = `Ты помогаешь участнику торга на C2C-маркетплейсе б/у одежды в Беларуси (цены в BYN). Посоветуй, что ответить на предложение: accept (принять), counter (встречное предложение) или decline (отклонить).
Учитывай рыночную цену похожих вещей, спрос (просмотры, ♡, другие предложения), сколько дней вещь в продаже, номер раунда. Цель — честная сделка, которая состоится: не советуй жадничать, если цена уже рыночная, и не советуй соглашаться на явно заниженную цену.
counter_amount — только для counter и строго в разрешённом диапазоне. reason — одно короткое предложение по-русски (до 140 символов).`;

const DAY = 24 * 3600 * 1000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

@Injectable()
export class NegotiationAdvisor {
  private readonly cache = new TtlCache<NegotiationAdvice>(10 * 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ensemble: AiEnsemble,
    private readonly price: PriceAdvisor,
  ) {}

  private market(l: OfferContext['listing']): Promise<PriceSuggestion | null> {
    if (!l.category) return Promise.resolve(null);
    return this.price
      .suggest(l.sellerId, { listingId: l.id, title: l.title, category: l.category, subcategory: l.subcategory, brand: l.brand, color: l.color, condition: l.condition, defectsPresent: l.defectsPresent, size: l.sizeValue })
      .catch(() => null);
  }

  /** Advice for the side whose turn it is. */
  async advise(o: OfferContext, role: 'buyer' | 'seller', history: Array<{ round: number; amount: number; from: OfferSide }>, range: { min: number; max: number } | null, maxRounds: number): Promise<NegotiationAdvice> {
    const key = hashKey('nego', o.id, o.updatedAt.toISOString(), role);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const l = o.listing;
    const P = l.price ?? o.amount;
    const canCounter = !!range && range.min <= range.max;
    const [suggestion, competing] = await Promise.all([
      this.market(l),
      role === 'seller'
        ? this.prisma.offer.findMany({ where: { listingId: l.id, status: 'PENDING', from: 'BUYER', expiresAt: { gt: new Date() }, buyerId: { not: o.buyerId } }, select: { amount: true } })
        : Promise.resolve([]),
    ]);
    const M = suggestion?.status === 'ok' ? suggestion.recommended! : null;
    const days = Math.max(0, Math.floor((Date.now() - (l.publishedAt ?? l.createdAt).getTime()) / DAY));
    const bestCompeting = competing.length ? Math.max(...competing.map((c) => c.amount)) : null;
    const previous = [...history].filter((h) => h.round < o.round).sort((a, b) => b.round - a.round)[0];

    const baseline = this.rule({ role, A: o.amount, P, M, days, favorites: l.favoritesCount, competing: bestCompeting, canCounter, range, minOfferPrice: role === 'seller' ? l.minOfferPrice : null, previous: previous?.amount ?? null });

    const facts: string[] = [];
    if (role === 'seller') facts.push(`Предложение — ${Math.round((o.amount / P) * 100)}% от вашей цены ${P} BYN`);
    else facts.push(`Продавец снизил цену на ${Math.max(0, Math.round(((P - o.amount) / P) * 100))}%: ${P} → ${o.amount} BYN`);
    if (suggestion?.status === 'ok') facts.push(`Похожие вещи уходят за ${suggestion.low}–${suggestion.high} BYN`);
    facts.push(`В продаже ${days} ${plural(days, 'день', 'дня', 'дней')} · ${l.viewsCount} просмотров · ${l.favoritesCount} ♡`);
    if (bestCompeting) facts.push(`Есть ещё ${competing.length} ${plural(competing.length, 'предложение', 'предложения', 'предложений')}, лучшее — ${bestCompeting} BYN`);
    facts.push(o.round >= maxRounds ? 'Последний раунд — встречное предложение уже нельзя' : `Раунд ${o.round} из ${maxRounds}`);

    let votes: Vote<AdviceVoteT>[] = [];
    if (this.ensemble.available) {
      const condition = CONDITIONS.find((c) => c.value === l.condition)?.label;
      const prompt = [
        `Ты советуешь: ${role === 'seller' ? 'ПРОДАВЦУ' : 'ПОКУПАТЕЛЮ'}.`,
        `Вещь: ${l.title}${l.brand ? `, ${l.brand}` : ''}${condition ? `, состояние «${condition}»` : ''}${l.defectsPresent ? ', есть дефекты' : ''}.`,
        `Цена в объявлении: ${P} BYN.`,
        `Текущее предложение от ${o.from === 'BUYER' ? 'покупателя' : 'продавца'}: ${o.amount} BYN (раунд ${o.round} из ${maxRounds}).`,
        previous && `Предыдущее предложение: ${previous.amount} BYN от ${previous.from === 'BUYER' ? 'покупателя' : 'продавца'}.`,
        suggestion?.status === 'ok' ? `Рынок: похожие вещи ${suggestion.low}–${suggestion.high} BYN, рекомендуемая цена ${suggestion.recommended} BYN.` : 'Рыночных данных мало.',
        `Спрос: ${l.viewsCount} просмотров, ${l.favoritesCount} ♡, в продаже ${days} дн.`,
        bestCompeting && `Другие покупатели предлагают до ${bestCompeting} BYN.`,
        role === 'seller' && l.minOfferPrice ? `Минимум, на который согласен продавец: ${l.minOfferPrice} BYN.` : null,
        canCounter ? `Встречное предложение возможно в диапазоне ${range!.min}–${range!.max} BYN.` : 'Встречное предложение невозможно: только accept или decline.',
      ].filter(Boolean);
      votes = (
        await this.ensemble.run({
          feature: 'negotiation_advice',
          system: SYSTEM,
          prompt: prompt.join('\n'),
          schema: AdviceVote,
          tier: 'fast',
          maxTokens: 250,
          temperature: 0.1,
          subject: { type: 'offer', id: o.id },
        })
      ).votes.filter((v) => canCounter || v.value.action !== 'counter');
    }

    // The rule is one more voter alongside the providers.
    const all: Vote<AdviceVoteT>[] = [...votes, { provider: 'rules', model: 'rules', weight: 1, latencyMs: 0, value: { action: baseline.action, counter_amount: baseline.counter, confidence: 0.6, reason: '' } }];
    const decided = majority(all, (v) => v.action);
    const action = (decided.value ?? baseline.action) as Action;
    let counter: number | null = null;
    if (action === 'counter' && canCounter) {
      const proposals = all.filter((v) => v.value.action === 'counter' && v.value.counter_amount).map((v) => v.value.counter_amount!);
      const raw = median(proposals) ?? baseline.counter ?? (range!.min + range!.max) / 2;
      counter = clamp(Math.round(raw), range!.min, range!.max);
      const nice = nicePrice(counter);
      if (nice >= range!.min && nice <= range!.max) counter = nice;
    }
    const reasonVote = votes.filter((v) => v.value.action === action && v.value.reason.trim()).sort((a, b) => b.weight - a.weight)[0];
    const reason = reasonVote && !hasProfanity(reasonVote.value.reason) ? reasonVote.value.reason.trim().slice(0, 160) : baseline.reason;

    const advice: NegotiationAdvice = {
      action,
      counter,
      confidence: decided.share >= 0.75 ? 'high' : decided.share >= 0.5 ? 'medium' : 'low',
      facts,
      reason,
      market: suggestion?.status === 'ok' ? { low: suggestion.low!, high: suggestion.high!, recommended: suggestion.recommended! } : null,
      model: votes.length ? `ensemble:${votes.map((v) => v.model).join('+')}+rules` : 'rules',
    };
    this.cache.set(key, advice);
    return advice;
  }

  private rule(x: {
    role: 'buyer' | 'seller';
    A: number;
    P: number;
    M: number | null;
    days: number;
    favorites: number;
    competing: number | null;
    canCounter: boolean;
    range: { min: number; max: number } | null;
    minOfferPrice: number | null;
    previous: number | null;
  }): { action: Action; counter: number | null; reason: string } {
    const market = x.M ?? x.P;
    if (x.role === 'seller') {
      const hot = x.favorites >= 5 || (x.competing ?? 0) > x.A;
      const stale = x.days > 30 && x.favorites < 2;
      const acceptAt = hot ? Math.max(market, x.P * 0.92) : stale ? Math.min(market * 0.9, x.P * 0.85) : Math.max(market * 0.95, x.P * 0.88);
      if (x.A >= Math.min(acceptAt, x.P - 1)) return { action: 'accept', counter: null, reason: 'Предложение на уровне рынка — сделка состоится быстро' };
      if (x.canCounter) {
        const target = hot ? (x.A + x.P * 2) / 3 : (x.A + Math.max(market, x.A)) / 2 + (x.P - x.A) * 0.15;
        return { action: 'counter', counter: Math.round(target), reason: 'Ниже рынка — предложите цену ближе к рыночной' };
      }
      const floor = Math.max(x.minOfferPrice ?? 0, market * (stale ? 0.7 : 0.8));
      return x.A >= floor
        ? { action: 'accept', counter: null, reason: 'Последний раунд, цена приемлемая' }
        : { action: 'decline', counter: null, reason: 'Последний раунд, цена заметно ниже рынка' };
    }
    // Buyer answering the seller's counter-offer.
    if (x.A <= market * 1.02) return { action: 'accept', counter: null, reason: 'Цена на уровне рынка или ниже' };
    if (x.canCounter) {
      const mid = x.previous != null ? (x.previous + x.A) / 2 : (market + x.A) / 2;
      return { action: 'counter', counter: Math.round(mid), reason: 'Дороже рынка — можно поторговаться ещё' };
    }
    return x.A <= market * 1.12
      ? { action: 'accept', counter: null, reason: 'Немного выше рынка, но торг окончен' }
      : { action: 'decline', counter: null, reason: 'Заметно дороже похожих вещей' };
  }

  /** Buyer's first offer: an amount that is likely to be accepted. Never uses the hidden minimum. */
  async opening(listing: OfferContext['listing']): Promise<{ suggested: number; min: number; chance: 'high' | 'medium' | 'low'; facts: string[] } | null> {
    if (!listing.price || listing.price < 4) return null;
    const P = listing.price;
    const min = Math.ceil(P * 0.3);
    const suggestion = await this.market(listing);
    const M = suggestion?.status === 'ok' ? suggestion.recommended! : null;
    const base = M != null ? Math.min(P - 1, Math.max(M * 0.95, P * 0.8)) : P * 0.85;
    // Never suggest (almost) the full price: then the buyer should just press «Купить».
    const capped = Math.min(base, P * 0.92);
    const suggested = clamp(nicePrice(capped) < P ? nicePrice(capped) : Math.floor(capped), min, P - 1);
    const ratio = suggested / P;
    const facts = suggestion?.status === 'ok' ? [`Похожие вещи уходят за ${suggestion.low}–${suggestion.high} BYN`] : [];
    return { suggested, min, chance: ratio >= 0.88 ? 'high' : ratio >= 0.75 ? 'medium' : 'low', facts };
  }
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
