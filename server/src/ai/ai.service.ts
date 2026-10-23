import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { canonicalBrand } from '../catalog/brands.js';
import { CATEGORIES, COLORS, CONDITIONS, STYLE_TAGS } from '../catalog/catalog.js';
import { majority, quorumSet, share } from './ensemble/aggregate.js';
import { AiEnsemble, Vote } from './ensemble/ensemble.js';
import { hasProfanity, isGibberish } from './text-rules.js';

/**
 * AI listing assistant (frame 22). The ensemble suggests category, color, brand, style, title and a
 * description draft — never size, condition, material, defects or authenticity. Each field is decided
 * by a weighted vote of the providers; a field the models disagree on is left for the seller.
 */

interface AiField<T> {
  value: T;
  confidence: number;
}

export interface AiSuggestion {
  category: AiField<string | null>;
  subcategory: AiField<string | null>;
  color: AiField<string | null>;
  brand: AiField<string | null>;
  style_tags: AiField<string[]>;
  title: AiField<string>;
  description: AiField<string>;
  flags: { not_clothing: boolean; prohibited: boolean; inappropriate: boolean };
  model: string;
}

const conf = z.coerce.number().min(0).max(1).catch(0.5);
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).catch(false);

const AnalysisVote = z.object({
  category: z.string(),
  category_confidence: conf,
  subcategory: z.string().nullish(),
  color: z.string().nullish(),
  color_confidence: conf,
  brand: z.string().nullish(),
  brand_confidence: conf,
  style_tags: z.array(z.string()).catch([]),
  title: z.string().catch(''),
  description: z.string().catch(''),
  not_clothing: bool,
  prohibited: bool,
  inappropriate: bool,
});
type AnalysisVoteT = z.infer<typeof AnalysisVote>;

const subcategoryList = CATEGORIES.map((c) => `${c.slug} (${c.label}): ${c.subcategories.map((s) => `${s.slug}=${s.label}`).join(', ')}`).join('\n');

const ANALYZE_SYSTEM = `Ты помогаешь продавцу выставить вещь на C2C-маркетплейс одежды в Беларуси. По фотографиям определи атрибуты вещи.

Правила:
- category — slug одной из категорий; subcategory — slug из списка этой категории:
${subcategoryList}
- color — основной цвет самой вещи (не фона), один из: ${COLORS.map((c) => c.value).join(', ')}.
- brand — только если на фото читается логотип или бирка с брендом. Иначе пустая строка и brand_confidence 0.
- style_tags — от 0 до 3 из: ${STYLE_TAGS.join(', ')}.
- title — по-русски, по шаблону «{Цвет} {вещь} {бренд}», до 80 символов, например «Чёрная кожаная куртка Zara».
- description — 1–3 коротких предложения по-русски только о том, что видно на фото (фасон, детали, фактура). Не пиши о размере, состоянии, материале, дефектах и подлинности — их подтверждает продавец. Не повторяй бренд и цвет — они показаны отдельными полями.
- *_confidence — от 0 до 1, насколько ты уверен.
- not_clothing — на фото нет одежды, обуви, сумки или аксессуара. prohibited — похоже на запрещённый товар. inappropriate — неприемлемое изображение.`;

/** Below 0.5 a value is dropped (frame 22: "Не удалось определить"). */
const keep = <T>(value: T, confidence: number, blank: T): AiField<T> => (confidence < 0.5 ? { value: blank, confidence } : { value, confidence });

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Brand as the catalogue spells it, so «nike» from one model and «Nike» from another are one vote. */
const normBrand = (b: string | null | undefined) => canonicalBrand(b) ?? '';

const empty = (model: string): AiSuggestion => ({
  category: { value: null, confidence: 0 },
  subcategory: { value: null, confidence: 0 },
  color: { value: null, confidence: 0 },
  brand: { value: null, confidence: 0 },
  style_tags: { value: [], confidence: 0 },
  title: { value: '', confidence: 0 },
  description: { value: '', confidence: 0 },
  flags: { not_clothing: false, prohibited: false, inappropriate: false },
  model,
});

export const modelLabel = (votes: Vote<unknown>[]) => (votes.length ? `ensemble:${votes.map((v) => v.model).join('+')}` : 'none');

@Injectable()
export class AiService {
  constructor(private readonly ensemble: AiEnsemble) {}

  get enabled() {
    return this.ensemble.configured;
  }

  async analyze(images: Buffer[], userId?: string): Promise<AiSuggestion> {
    if (!images.length) return empty('none');
    const { votes } = await this.ensemble.run({
      feature: 'listing_autofill',
      system: ANALYZE_SYSTEM,
      prompt: 'Определи атрибуты вещи на фото.',
      images: images.slice(0, 4),
      schema: AnalysisVote,
      tier: 'fast',
      timeoutMs: 12_000,
      maxTokens: 700,
      subject: userId ? { type: 'user', id: userId } : undefined,
    });
    if (!votes.length) throw new Error('no AI answers');
    return this.combine(votes);
  }

  private combine(votes: Vote<AnalysisVoteT>[]): AiSuggestion {
    const validCat = (v: AnalysisVoteT) => (CATEGORIES.some((c) => c.slug === v.category) ? v.category : null);
    const cat = majority(votes, validCat);
    const catVoters = votes.filter((v) => validCat(v.value) === cat.value && cat.value);
    const catConfidence = cat.share * avg(catVoters.map((v) => v.value.category_confidence));

    const category = CATEGORIES.find((c) => c.slug === cat.value);
    const sub = majority(catVoters, (v) => (category?.subcategories.some((s) => s.slug === v.subcategory) ? v.subcategory! : null));
    const subConfidence = sub.value ? sub.share * catConfidence : 0;

    const validColor = (v: AnalysisVoteT) => (COLORS.some((c) => c.value === v.color) ? v.color! : null);
    const color = majority(votes, validColor);
    const colorConfidence = color.value ? color.share * avg(votes.filter((v) => validColor(v.value) === color.value).map((v) => v.value.color_confidence)) : 0;

    // A brand is kept only when the providers that saw one agree on it and they are the majority.
    const brand = majority(votes, (v) => normBrand(v.brand).toLowerCase() || null);
    const brandVoters = votes.filter((v) => brand.value && normBrand(v.value.brand).toLowerCase() === brand.value);
    const brandConfidence = brand.value ? brand.share * avg(brandVoters.map((v) => v.value.brand_confidence)) : 0;
    const brandValue = brandVoters[0] ? normBrand(brandVoters[0].value.brand) : null;

    const tags = quorumSet(votes, (v) => v.style_tags.filter((t) => STYLE_TAGS.includes(t)), 0.5).slice(0, 3);
    const tagsConfidence = tags.length ? share(votes, (v) => tags.some((t) => v.style_tags.includes(t))) : 0;

    // Title and description come from the provider whose answer agrees most with the final fields.
    const scored = [...votes].sort((a, b) => this.agreement(b, cat.value, color.value, brand.value) - this.agreement(a, cat.value, color.value, brand.value) || b.weight - a.weight);
    const author = scored.find((v) => v.value.title.trim() && !hasProfanity(v.value.title) && !isGibberish(v.value.title)) ?? scored[0];

    return {
      category: keep<string | null>(cat.value, catConfidence, null),
      subcategory: keep<string | null>(sub.value, subConfidence, null),
      color: keep<string | null>(color.value, colorConfidence, null),
      brand: keep<string | null>(brandValue, brandConfidence, null),
      style_tags: keep(tags, tagsConfidence, []),
      title: { value: author.value.title.trim().slice(0, 80), confidence: Math.min(catConfidence, colorConfidence || catConfidence) },
      description: { value: hasProfanity(author.value.description) ? '' : author.value.description.trim().slice(0, 2000), confidence: catConfidence },
      flags: {
        not_clothing: share(votes, (v) => v.not_clothing) > 0.5,
        prohibited: share(votes, (v) => v.prohibited) > 0.5,
        inappropriate: share(votes, (v) => v.inappropriate) > 0.5,
      },
      model: modelLabel(votes),
    };
  }

  private agreement(v: Vote<AnalysisVoteT>, category: string | null, color: string | null, brand: string | null) {
    return (
      (v.value.category === category ? 2 : 0) + (v.value.color === color ? 1 : 0) + ((normBrand(v.value.brand).toLowerCase() || null) === brand ? 1 : 0)
    );
  }

  /**
   * Description draft from the fields the seller confirmed ("Перегенерировать").
   * Size, condition and defects come only from the seller's input.
   */
  async describe(fields: {
    title: string;
    category?: string | null;
    brand?: string | null;
    color?: string | null;
    size?: string | null;
    condition?: string | null;
    defects?: string | null;
    material?: string | null;
  }, userId?: string): Promise<string> {
    const condition = CONDITIONS.find((c) => c.value === fields.condition)?.label;
    const color = COLORS.find((c) => c.value === fields.color)?.label;
    const facts = [
      `Название: ${fields.title}`,
      fields.brand && `Бренд: ${fields.brand}`,
      color && `Цвет: ${color}`,
      fields.size && `Размер: ${fields.size}`,
      condition && `Состояние: ${condition}`,
      fields.material && `Материал: ${fields.material}`,
      fields.defects ? `Дефекты: ${fields.defects}` : 'Дефектов нет',
    ].filter(Boolean);
    const fallback = this.templateDescription(fields.title, fields.defects);
    if (!this.ensemble.available) return fallback;

    const { votes } = await this.ensemble.run({
      feature: 'listing_describe',
      system:
        'Напиши описание вещи для объявления на маркетплейсе одежды: 2–3 простых предложения по-русски, без эмодзи, без преувеличений и без контактов. ' +
        'Бренд, размер, цвет, состояние и материал покупатель уже видит в отдельных полях — не повторяй их. Опиши фасон и детали из названия, стиль, с чем носить и для какого случая; дефекты, если есть, — своими словами. Не выдумывай фактов, которых нет в списке.',
      prompt: facts.join('\n'),
      schema: z.object({ description: z.string() }),
      tier: 'fast',
      temperature: 0.5,
      maxTokens: 500,
      // Runs are attributed to the person, so heavy use shows up per account in AiRun.
      subject: userId ? { type: 'user', id: userId } : undefined,
    });
    // Free text can't be voted on: take the best-weighted answer that passes the text checks.
    const best = [...votes]
      .sort((a, b) => b.weight - a.weight)
      .map((v) => v.value.description.trim())
      .find((d) => d.length >= 30 && d.length <= 1200 && !hasProfanity(d));
    return best ? best.slice(0, 2000) : fallback;
  }

  /** Size, brand and condition are separate fields, so the fallback doesn't repeat them. */
  private templateDescription(title: string, defects?: string | null) {
    return defects ? `${title}. Есть нюанс: ${defects}.` : `${title}. Без дефектов, готова к носке.`;
  }
}
