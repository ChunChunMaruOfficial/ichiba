import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { canonicalBrand } from '../catalog/brands.js';
import { categoryBySlug, COLORS } from '../catalog/catalog.js';
import { majority, quorumSet } from '../ai/ensemble/aggregate.js';
import { AiEnsemble, Vote } from '../ai/ensemble/ensemble.js';
import { findContacts, hasProfanity } from '../ai/text-rules.js';
import { COLOR_STEMS, contentHash, grounded, SeoAi, sellerText, SeoListing, words } from './seo.js';

/**
 * The AI pass of the search snippet (seo.ts): the ensemble reads the seller's title and description and picks out what
 * the fields can't hold — the model or collection name, a brand written only in the text, the features people search
 * by — and retells the description in one line for the meta description.
 *
 * Precision over reach: each field is decided by a weighted vote of the providers, and every value must be found in
 * the seller's own words (`grounded`); the line about the item passes a fact check (no colour, number, brand or claim
 * the listing doesn't have). Whatever fails is dropped and the snippet is built from the fields alone.
 */

const SeoVote = z.object({
  model: z.string().nullish().catch(''),
  brand: z.string().nullish().catch(''),
  features: z.array(z.string()).catch([]),
  blurb: z.string().nullish().catch(''),
});
type VoteT = z.infer<typeof SeoVote>;

const SYSTEM = `Ты готовишь поисковый сниппет (title и description) для объявления на маркетплейсе одежды в Беларуси. Тебе дают текст продавца и поля объявления. Ничего не придумывай: бери только то, что написал продавец.

Верни:
- model — название модели, коллекции или принта ровно так, как написал продавец («Air Max 90», «School pants», «Тень», «Detroit»). Не бренд, не тип вещи, не цвет, не размер. Нет такого — пустая строка.
- brand — бренд, только если продавец прямо назвал его в тексте, а поле «Бренд» пустое. Иначе пустая строка.
- features — до 3 коротких (1–3 слова) особенностей из текста, по которым вещь ищут: крой (оверсайз, укороченный, приталенный), принт и декор (камуфляж, с вышивкой, в полоску), фактура (вельвет, в рубчик), стиль (винтаж, y2k). По-русски, в именительном падеже, как их набирают в поиске. Не повторяй тип вещи, бренд, цвет и размер.
- blurb — одно предложение по-русски, 60–140 символов: перескажи, что продавец написал о самой вещи (фасон, детали, ткань). Без цены, размера, состояния, города, доставки, контактов, оценок («идеальный», «лучший»), других брендов и цветов. Если в тексте нет ничего сверх заголовка — пустая строка.`;

/** Words a line about the item has no business saying: claims, sales talk and what the fields already tell. */
const FORBIDDEN = /(оригинал|подлинн|реплик|гарант|идеальн|лучш|скидк|акци|дёшев|дешев|выгодн|цен[аеуы]|руб|byn|доставк|размер|посадк[аи] по|состояни|бирк|носк[иа]|следы|следами|потёрт|потерт|катышк|дефект|торг|звоните|пишите|telegram|телеграм|инст|@|https?:|www\.)/i;

/** The item's own facts, as the models see them and as the fact check allows them. */
function facts(l: SeoListing) {
  const cat = categoryBySlug(l.category);
  return [
    cat && `Категория: ${cat.label}${l.subcategory ? ` / ${cat.subcategories.find((s) => s.slug === l.subcategory)?.label ?? l.subcategory}` : ''}`,
    `Бренд: ${l.brand || '—'}`,
    l.color && `Цвет: ${COLORS.find((c) => c.value === l.color)?.label ?? l.color}`,
    l.material && `Материал: ${l.material}`,
    l.gender === 'MALE' ? 'Для кого: мужское' : l.gender === 'FEMALE' ? 'Для кого: женское' : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The fact check of the line about the item: right length, no contact or sales talk, no colour but the item's own (or
 * one the seller wrote), no number or Latin word (a brand, a model) the seller didn't write, and mostly the seller's
 * own words — a retelling, not an invention.
 */
export function checkBlurb(text: string, l: SeoListing): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 40 || t.length > 150) return false;
  if (FORBIDDEN.test(t) || hasProfanity(t) || findContacts(t).length) return false;
  const source = `${sellerText(l)}\n${l.brand ?? ''}\n${l.material ?? ''}`;
  const src = words(source);
  const own = l.color ? COLOR_STEMS[l.color] ?? [] : [];
  for (const w of words(t)) {
    if (/\d/.test(w) && !src.includes(w)) return false;
    if (/^[a-z]/.test(w) && w.length > 1 && !src.includes(w)) return false;
    const colour = Object.values(COLOR_STEMS).flat().find((s) => w.startsWith(s.replace(/ё/g, 'е')));
    if (colour && !own.some((s) => w.startsWith(s.replace(/ё/g, 'е'))) && !grounded(w, source)) return false;
  }
  const content = words(t).filter((w) => w.length >= 5);
  if (!content.length) return false;
  return content.filter((w) => grounded(w, source)).length / content.length >= 0.5;
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/^[«"'“\s]+|[»"'”\s]+$/g, '').replace(/\s+/g, ' ').trim();

@Injectable()
export class SeoWriter {
  constructor(private readonly ensemble: AiEnsemble) {}

  get configured() {
    return this.ensemble.configured;
  }

  get available() {
    return this.ensemble.available;
  }

  /** null: no provider gave a valid answer (try again later); otherwise the checked result, possibly empty. */
  async write(l: SeoListing): Promise<SeoAi | null> {
    const source = sellerText(l);
    const { votes } = await this.ensemble.run({
      feature: 'listing_seo',
      system: SYSTEM,
      prompt: `Текст продавца:\n«««\n${source.slice(0, 2000)}\n»»»\n\nПоля объявления:\n${facts(l)}`,
      schema: SeoVote,
      tier: 'fast',
      timeoutMs: 15_000,
      maxTokens: 400,
      temperature: 0.2,
      subject: { type: 'listing', id: l.id },
      logResult: (vs) => this.decide(l, vs),
    });
    if (!votes.length) return null;
    return this.decide(l, votes);
  }

  /** Field by field: a weighted majority (an empty answer is a vote too), then the grounding check. */
  decide(l: SeoListing, votes: Vote<VoteT>[]): SeoAi {
    const source = sellerText(l);
    const key = (s: string) => words(s).join(' ');

    const modelVote = majority(votes, (v) => key(norm(v.model)));
    const modelText = votes.map((v) => norm(v.value.model)).find((m) => key(m) === modelVote.value);
    const model = modelVote.value && modelVote.share >= 0.5 && modelText && grounded(modelText, source) ? modelText : null;

    const brandVote = majority(votes, (v) => key(norm(v.brand)));
    const brandText = votes.map((v) => norm(v.value.brand)).find((b) => key(b) === brandVote.value);
    const brand = !l.brand && brandVote.value && brandVote.share >= 0.5 && brandText && grounded(brandText, source) ? canonicalBrand(brandText) : null;

    // A single provider's features count only when nobody else answered.
    const features = quorumSet(votes, (v) => v.features.map((f) => norm(f).toLowerCase()).filter(Boolean), votes.length > 1 ? 0.5 : 1)
      .filter((f) => f.length <= 24 && words(f).length <= 3 && !FORBIDDEN.test(f) && grounded(f, source))
      .slice(0, 2);

    // The line from the most trusted provider whose text passes the check, nearest to 110 characters on a tie.
    const blurb =
      votes
        .map((v) => ({ text: norm(v.value.blurb), weight: v.weight }))
        .filter((c) => c.text && checkBlurb(c.text, l))
        .sort((a, b) => b.weight - a.weight || Math.abs(a.text.length - 110) - Math.abs(b.text.length - 110))[0]?.text ?? null;

    return { hash: contentHash(l), model, brand, features, blurb: blurb ? blurb.replace(/\.?$/, '.') : null };
  }
}
