import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CATEGORIES, COLORS, CONDITIONS, STYLE_TAGS } from '../catalog/catalog.js';

/**
 * AI listing assistant (frame 22). Claude vision suggests category, color, brand, style, title and a
 * description draft — never size, condition, material, defects or authenticity.
 * Without ANTHROPIC_API_KEY it returns an empty suggestion so the UI falls back to manual entry.
 */

export interface AiField<T> {
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

const subcategoryList = CATEGORIES.map((c) => `${c.slug}: ${c.subcategories.map((s) => s.slug).join(', ')}`).join('\n');

const AnalysisSchema = z.object({
  category: z.enum(CATEGORIES.map((c) => c.slug) as [string, ...string[]]),
  category_confidence: z.number(),
  subcategory: z.string(),
  subcategory_confidence: z.number(),
  color: z.enum(COLORS.map((c) => c.value) as [string, ...string[]]),
  color_confidence: z.number(),
  brand: z.string(),
  brand_confidence: z.number(),
  style_tags: z.array(z.enum(STYLE_TAGS as [string, ...string[]])),
  style_confidence: z.number(),
  title: z.string(),
  description: z.string(),
  not_clothing: z.boolean(),
  prohibited: z.boolean(),
  inappropriate: z.boolean(),
});

const SYSTEM = `Ты помогаешь продавцу выставить вещь на C2C-маркетплейс одежды. По фотографиям определи атрибуты вещи.

Правила:
- category — одна из категорий; subcategory — slug из списка этой категории:
${subcategoryList}
- color — основной цвет самой вещи, а не фона.
- brand — только если на фото виден логотип или бирка с брендом. Иначе пустая строка и confidence 0.
- style_tags — от 0 до 3 тегов.
- title — по-русски, по шаблону «{Цвет} {подкатегория} {бренд}», до 80 символов, например «Чёрная кожаная куртка Zara».
- description — 1–3 коротких предложения по-русски только о том, что видно на фото (фасон, детали, фактура). Не пиши о размере, состоянии, материале, дефектах и подлинности — их подтверждает продавец.
- *_confidence — от 0 до 1, насколько ты уверен.
- not_clothing — на фото нет одежды, обуви, сумки или аксессуара. prohibited — похоже на запрещённый товар. inappropriate — неприемлемое изображение.`;

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

/** Below 0.5 a value is dropped (frame 22: "Не удалось определить"). */
const keep = <T>(value: T, confidence: number, blank: T): AiField<T> =>
  confidence < 0.5 ? { value: blank, confidence } : { value, confidence };

@Injectable()
export class AiService {
  private readonly logger = new Logger('AI');
  private readonly model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  private readonly client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 1 }) : null;

  get enabled() {
    return this.client !== null;
  }

  async analyze(images: Buffer[]): Promise<AiSuggestion> {
    if (!this.client || images.length === 0) return empty('none');

    const response = await this.client.beta.messages.parse(
      {
        model: this.model,
        max_tokens: 2000,
        // Must answer within the 2–8 s window from frame 10; low effort keeps latency down.
        output_config: { effort: 'low', format: zodOutputFormat(AnalysisSchema) },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              ...images.slice(0, 4).map((img) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: 'image/webp' as const, data: img.toString('base64') },
              })),
              { type: 'text' as const, text: 'Определи атрибуты вещи на фото.' },
            ],
          },
        ],
      },
      { timeout: 25_000 },
    );

    const out = response.parsed_output;
    if (response.stop_reason === 'refusal' || !out) {
      this.logger.warn(`No structured output (stop_reason=${response.stop_reason})`);
      return empty(this.model);
    }

    const category = CATEGORIES.find((c) => c.slug === out.category);
    const subcategoryValid = category?.subcategories.some((s) => s.slug === out.subcategory);
    return {
      category: keep<string | null>(out.category, out.category_confidence, null),
      subcategory: keep<string | null>(subcategoryValid ? out.subcategory : null, subcategoryValid ? out.subcategory_confidence : 0, null),
      color: keep<string | null>(out.color, out.color_confidence, null),
      brand: keep<string | null>(out.brand.trim() || null, out.brand.trim() ? out.brand_confidence : 0, null),
      style_tags: keep(out.style_tags.slice(0, 3), out.style_confidence, []),
      title: { value: out.title.slice(0, 80), confidence: Math.min(out.category_confidence, out.color_confidence) },
      description: { value: out.description.slice(0, 2000), confidence: out.category_confidence },
      flags: { not_clothing: out.not_clothing, prohibited: out.prohibited, inappropriate: out.inappropriate },
      model: response.model,
    };
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
  }): Promise<string> {
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

    if (!this.client) return this.templateDescription(fields.title, fields.size, condition, fields.defects);

    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 1000,
        output_config: { effort: 'low' },
        system:
          'Напиши описание вещи для объявления на маркетплейсе одежды: 2–4 простых предложения по-русски, без эмодзи, без преувеличений. Используй только факты из списка — ничего не добавляй.',
        messages: [{ role: 'user', content: facts.join('\n') }],
      },
      { timeout: 20_000 },
    );
    const text = response.content.find((b) => b.type === 'text');
    return text && text.type === 'text' ? text.text.trim().slice(0, 2000) : this.templateDescription(fields.title, fields.size, condition, fields.defects);
  }

  private templateDescription(title: string, size?: string | null, condition?: string, defects?: string | null) {
    return [
      `${title}${size ? `, размер ${size}` : ''}.`,
      condition && `Состояние: ${condition.toLowerCase()}.`,
      defects ? `Дефекты: ${defects}.` : 'Дефектов нет.',
    ]
      .filter(Boolean)
      .join(' ');
  }
}
