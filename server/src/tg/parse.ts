import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AiEnsemble } from '../ai/ensemble/ensemble.js';
import { CATEGORIES, COLORS } from '../catalog/catalog.js';
import type { CuratedItem } from './sources.js';

/**
 * Turns a new channel post into items for sale: the AI ensemble reads the text and looks at the photos, splits a
 * post with several things into several items and skips everything that is not a concrete thing for sale
 * (announcements, polls, teasers, giveaways, sold-out notes).
 */

const Item = z.object({
  photo_indexes: z.array(z.coerce.number().int().min(0)).catch([]),
  title: z.string().catch(''),
  category: z.string().catch(''),
  subcategory: z.string().nullish(),
  brand: z.string().nullish(),
  color: z.string().nullish(),
  sizes: z.array(z.string()).catch([]),
  price_byn: z.coerce.number().nullish().catch(null),
  description: z.string().catch(''),
});

export type ParsedItem = Omit<CuratedItem, 'photos'> & { photoIndexes: number[] };

const Answer = z.object({
  items: z.array(Item).catch([]),
  skip_reason: z.string().nullish(),
});
type AnswerT = z.infer<typeof Answer>;

const categoryList = CATEGORIES.map((c) => `${c.slug} (${c.label}): ${c.subcategories.map((s) => s.slug).join(', ')}`).join('\n');

const SYSTEM = `Ты разбираешь пост из Telegram-канала магазина одежды, чтобы выставить его вещи на маркетплейс в Беларуси.

Верни items — вещи, которые этот пост продаёт прямо сейчас. Если вещей нет, верни пустой items и skip_reason.
Пропускай (пустой items): анонсы и тизеры («скоро», «дроп завтра», «как вам?»), опросы, розыгрыши, mystery box, отзывы,
новости про доставку, посты где вещь продана («SOLD», «распродано», «нет в наличии»), фото без конкретной вещи.
Только одежда, обувь, сумки и аксессуары.

Для каждой вещи:
- photo_indexes — номера фото (с 0) именно этой вещи; первое — лучшее для обложки. Если в посте несколько вещей
  (комплект худи + штаны, несколько моделей футболок, два цвета) — раздели их на отдельные вещи.
- title — по-русски, «{вещь} {бренд} «{название модели}»», до 80 символов, без эмодзи.
- category и subcategory — slug из списка:
${categoryList}
- brand — бренд, если он назван в тексте; иначе пусто.
- color — основной цвет вещи, один из: ${COLORS.map((c) => c.value).join(', ')}; если не ясно — пусто.
- sizes — размеры, которые есть в наличии (XS, S, M, L, XL, XXL или EU-размер обуви); если не указаны — пустой список.
- price_byn — цена в BYN, если указана; иначе null. Рубли не переводи.
- description — 1–3 предложения по-русски: материал, детали, посадка из текста поста. Без контактов, @ников,
  ссылок и призывов писать в бот.`;

@Injectable()
export class TgPostParser {
  constructor(private readonly ensemble: AiEnsemble) {}

  get available() {
    return this.ensemble.available;
  }

  /** Items of a post (photos as indexes into `images`), or the reason it was skipped. */
  async parse(text: string, images: Buffer[], ownBrand?: string): Promise<{ items: ParsedItem[]; skip?: string }> {
    const { votes } = await this.ensemble.run({
      feature: 'tg_import',
      system: SYSTEM,
      prompt: `Текст поста:\n"""\n${text || '(без текста)'}\n"""\nФото: ${images.length} шт.${ownBrand ? ` Магазин — собственный бренд ${ownBrand}: если другой бренд не назван, это вещь ${ownBrand}.` : ''}`,
      images: images.slice(0, 6),
      schema: Answer,
      tier: 'smart',
      timeoutMs: 45_000,
      maxTokens: 1800,
    });
    if (!votes.length) throw new Error('no AI answers');
    // The answer most providers agree with on how many items there are; the heavier provider breaks ties.
    const counts = new Map<number, number>();
    for (const v of votes) counts.set(v.value.items.length, (counts.get(v.value.items.length) ?? 0) + v.weight);
    const [n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const best = votes.filter((v) => v.value.items.length === n).sort((a, b) => b.weight - a.weight)[0].value;
    return this.clean(best, images.length, ownBrand);
  }

  private clean(a: AnswerT, photoCount: number, ownBrand?: string): { items: ParsedItem[]; skip?: string } {
    const items = a.items
      .map((i): ParsedItem | null => {
        const category = CATEGORIES.find((c) => c.slug === i.category);
        if (!category || !i.title.trim()) return null;
        const photoIndexes = [...new Set(i.photo_indexes.filter((x) => x < photoCount))];
        return {
          photoIndexes: photoIndexes.length ? photoIndexes : [0],
          title: i.title.trim().slice(0, 80),
          category: category.slug,
          subcategory: category.subcategories.find((s) => s.slug === i.subcategory)?.slug ?? category.subcategories[0].slug,
          brand: i.brand?.trim() || ownBrand,
          color: COLORS.some((c) => c.value === i.color) ? i.color! : undefined,
          sizes: i.sizes.map((s) => s.trim().toUpperCase()).filter((s) => /^(XXS|XS|S|M|L|XL|XXL|3XL|\d{2})$/.test(s)),
          price: i.price_byn && i.price_byn > 0 && i.price_byn <= 100_000 ? Math.round(i.price_byn) : undefined,
          description: i.description.trim().slice(0, 1500),
        };
      })
      .filter((i): i is ParsedItem => i !== null);
    return { items, skip: items.length ? undefined : a.skip_reason?.trim() || 'не товар' };
  }
}
