import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { z } from 'zod';
import { canonicalBrand } from '../catalog/brands.js';
import { CATEGORIES, COLORS } from '../catalog/catalog.js';
import { ListingsService } from '../listings/listings.service.js';
import type { Market } from '../listings/market.js';
import { mapLimit, openImage, withSharp } from '../media/image.js';
import { hashDistance, MediaService, type StoredPhoto, usableHash } from '../media/media.service.js';
import { paletteSimilarity } from '../media/palette.js';
import { majority, quorumSet, share } from './ensemble/aggregate.js';
import { AiEnsemble, hashKey, RunBudget, TtlCache, Vote } from './ensemble/ensemble.js';

/**
 * Search by photo, in two steps.
 * 1. What is it: the vision ensemble names the type (category and subcategory), the colours, the pattern or print
 *    and a few words for what stands out («пламя», «полоски», «логотип»).
 * 2. What looks like it: among the items of that type, a cheap local ranking (colour signature of the cover, its
 *    difference hash, the colours, subcategory, brand and words in the title and description), then the vision
 *    ensemble compares the photo with the closest dozen side by side and puts the truly similar ones first —
 *    the same print beats the same type in another print.
 * Costs two vision requests per search; the result for the same photo is kept for a while.
 */

export interface PhotoLook {
  category: string | null;
  subcategory: string | null;
  colors: string[];
  pattern: string | null;
  keywords: string[];
  brand: string | null;
}

export interface PhotoSearchResult {
  label: string | null;
  look: PhotoLook;
  /** Item ids, the most similar first. */
  ids: string[];
  notClothing: boolean;
}

const PATTERNS = ['solid', 'stripes', 'check', 'print', 'logo', 'text', 'floral', 'animal', 'camo', 'dots', 'flames', 'knit_pattern', 'other'] as const;
const PATTERN_LABEL: Record<string, string> = {
  stripes: 'в полоску',
  check: 'в клетку',
  print: 'с принтом',
  logo: 'с логотипом',
  text: 'с надписью',
  floral: 'с цветами',
  animal: 'анималистичный принт',
  camo: 'камуфляж',
  dots: 'в горошек',
  flames: 'с пламенем',
  knit_pattern: 'с вязаным узором',
};

const conf = z.coerce.number().min(0).max(1).catch(0.5);
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).catch(false);
const SeeVote = z.object({
  category: z.string(),
  category_confidence: conf,
  subcategory: z.string().nullish(),
  colors: z.array(z.string()).catch([]),
  pattern: z.string().nullish(),
  keywords: z.array(z.string()).catch([]),
  brand: z.string().nullish(),
  brand_confidence: conf,
  not_clothing: bool,
});
type SeeVoteT = z.infer<typeof SeeVote>;

const subcategoryList = CATEGORIES.map((c) => `${c.slug} (${c.label}): ${c.subcategories.map((s) => `${s.slug}=${s.label}`).join(', ')}`).join('\n');

const SEE_SYSTEM = `Покупатель ищет на маркетплейсе одежды вещь по фотографии. Опиши главную вещь на фото так, чтобы найти похожие.
- category — slug категории; subcategory — slug из списка этой категории:
${subcategoryList}
- colors — 1–3 основных цвета самой вещи (не фона), главный первым, из: ${COLORS.map((c) => c.value).join(', ')}.
- pattern — рисунок вещи, один из: ${PATTERNS.join(', ')} (solid — однотонная; flames — языки пламени; knit_pattern — вязаный узор).
- keywords — 2–6 коротких русских слов о том, что отличает вещь внешне: рисунок, принт, надписи, фактура, детали, фасон (например «пламя», «полоски», «стёганая», «оверсайз», «помпон»). Без цвета и типа вещи.
- brand — только если на фото читается логотип или бирка. Иначе пустая строка и brand_confidence 0.
- *_confidence — от 0 до 1.
- not_clothing — на фото нет одежды, обуви, сумки или аксессуара.`;

const GRID_COLS = 4;
const GRID_ROWS = 3;
const CELL_W = 192;
const CELL_H = 240;
const GAP = 16;
const RERANK = GRID_COLS * GRID_ROWS;

const RerankVote = z.object({ scores: z.array(z.object({ cell: z.coerce.number().int().min(1), score: z.coerce.number().min(0).max(10) })) });

const RERANK_SYSTEM = `Ты сравниваешь вещи по внешнему виду для поиска по фото на маркетплейсе одежды.
Изображение 1 — фото вещи, которую ищет покупатель. Изображение 2 — сетка ${GRID_COLS}×${GRID_ROWS} с вещами-кандидатами на белом фоне; клетки нумеруются слева направо и сверху вниз начиная с 1 (верхний ряд 1–${GRID_COLS}), пустые клетки пропусти.
Для каждой вещи поставь score от 0 до 10 — насколько она похожа на вещь с изображения 1:
- 9–10: та же или почти та же вещь (тип, фасон, цвета и тот же рисунок или принт);
- 6–8: тот же тип и похожий рисунок, принт или узор, цвета близки;
- 3–5: тот же тип и цвет, но рисунок или принт другой либо его нет;
- 0–2: другая вещь.
Рисунок, принт, надписи и узор важнее мелких деталей фасона.`;

/** Crude Russian stem, the same as the text search uses: «полоски» → «полос». */
const stem = (w: string) => (w.length > 5 ? w.slice(0, -2) : w.length > 3 ? w.slice(0, -1) : w);

@Injectable()
export class PhotoSearch {
  private readonly logger = new Logger('PhotoSearch');
  private readonly cache = new TtlCache<PhotoSearchResult>(15 * 60_000, 200);
  /** Searches per minute, site-wide: each one decodes a photo and costs two vision runs, and guests can search. */
  private readonly budget = new RunBudget(20);

  constructor(
    private readonly ensemble: AiEnsemble,
    private readonly media: MediaService,
    private readonly listings: ListingsService,
  ) {}

  async search(file: Buffer, market: Market, viewerId?: string): Promise<PhotoSearchResult> {
    if (!this.budget.take()) throw new HttpException({ message: 'Поиск по фото сейчас перегружен — попробуйте через минуту', code: 'BUSY' }, HttpStatus.TOO_MANY_REQUESTS);
    const query = await this.media.searchImage(file);
    const key = hashKey(query.dhash, query.palette, market, viewerId ?? null);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const seen = this.ensemble.available
      ? await this.see(query.jpeg).catch((e: Error) => {
          this.logger.warn(`see failed: ${e.message}`);
          return null;
        })
      : null;
    // "Not clothing" isn't final (answers vary, drawings and bags confuse the models): then the look alone ranks.
    const notClothing = !!seen?.notClothing;
    const look: PhotoLook = seen && !notClothing ? seen.look : { category: null, subcategory: null, colors: [], pattern: null, keywords: [], brand: null };

    let candidates = await this.listings.photoCandidates(look.category, market, viewerId);
    // A type nobody sells yet: fall back to everything rather than show nothing.
    if (look.category && !candidates.length) candidates = await this.listings.photoCandidates(null, market, viewerId);

    const keywords = [...new Set(look.keywords.map((k) => stem(k.toLowerCase().trim())).filter((k) => k.length >= 3))];
    // Stored hash and colours only: a public search must not read hundreds of images. Photos the backfill job hasn't
    // reached yet (or couldn't read) just give no visual signal.
    const scored = candidates.map((l) => {
      const cover = l.photos[0];
      const seenCover = { dhash: usableHash(cover?.dhash), palette: cover?.palette ?? null };
      let s = 0;
      if (look.subcategory && l.subcategory === look.subcategory) s += 2;
      if (look.colors[0] && l.color === look.colors[0]) s += 1.5;
      else if (l.color && look.colors.includes(l.color)) s += 0.75;
      if (look.brand && l.brand && l.brand.toLowerCase() === look.brand.toLowerCase()) s += 1.5;
      const text = `${l.title} ${l.description ?? ''}`.toLowerCase();
      s += Math.min(3, keywords.filter((k) => text.includes(k)).length);
      s += paletteSimilarity(query.palette, seenCover.palette) * 4;
      if (query.dhash && seenCover.dhash) s += Math.max(0, (24 - hashDistance(query.dhash, seenCover.dhash)) / 24) * 1.5;
      return { id: l.id, cover, s };
    });
    const ranked = scored.sort((a, b) => b.s - a.s);

    // Step 2: the closest dozen compared with the photo side by side.
    const top = ranked.slice(0, RERANK).filter((x) => x.cover);
    const ai = this.ensemble.available && top.length >= 2 ? await this.rerank(query.jpeg, top).catch((e: Error) => (this.logger.warn(`rerank failed: ${e.message}`), null)) : null;
    let ids: string[];
    if (ai) {
      const checked = new Set(top.map((x) => x.id));
      // Confirmed look-alikes first, then the rest by the local ranking; what the models found unlike sinks a little.
      const good = top.filter((x) => (ai.get(x.id) ?? 0) >= 5).sort((a, b) => ai.get(b.id)! - ai.get(a.id)! || b.s - a.s);
      const rest = ranked.filter((x) => !good.includes(x)).map((x) => ({ ...x, s: checked.has(x.id) && (ai.get(x.id) ?? 10) < 3 ? x.s - 2 : x.s }));
      ids = [...good, ...rest.sort((a, b) => b.s - a.s)].map((x) => x.id);
    } else {
      ids = ranked.map((x) => x.id);
    }

    const result: PhotoSearchResult = { label: seen?.label ?? null, look, ids: ids.slice(0, 120), notClothing };
    this.cache.set(key, result);
    return result;
  }

  /** Step 1: what the item on the photo is. */
  private async see(jpeg: Buffer): Promise<{ look: PhotoLook; label: string | null; notClothing: boolean } | null> {
    const { votes } = await this.ensemble.run({
      feature: 'photo_search',
      system: SEE_SYSTEM,
      prompt: 'Опиши вещь на фото.',
      images: [jpeg],
      schema: SeeVote,
      tier: 'fast',
      timeoutMs: 10_000,
      maxTokens: 300,
    });
    if (!votes.length) return null;
    return combineLook(votes);
  }

  /** Step 2: similarity 0..10 of each candidate to the photo, by the providers' weighted average. */
  private async rerank(jpeg: Buffer, top: Array<{ id: string; cover?: StoredPhoto }>): Promise<Map<string, number> | null> {
    const tiles = await mapLimit(top, 4, async (x) => {
      try {
        const img = await this.media.imageForAi(x.cover!, 320);
        return await withSharp(() => openImage(img).resize(CELL_W, CELL_H, { fit: 'contain', background: '#ffffff' }).jpeg().toBuffer());
      } catch {
        return null;
      }
    });
    const width = GRID_COLS * CELL_W + (GRID_COLS + 1) * GAP;
    const height = GRID_ROWS * CELL_H + (GRID_ROWS + 1) * GAP;
    const grid = await withSharp(() =>
      sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
        .composite(
          tiles.flatMap((t, i) => (t ? [{ input: t, left: GAP + (i % GRID_COLS) * (CELL_W + GAP), top: GAP + Math.floor(i / GRID_COLS) * (CELL_H + GAP) }] : [])),
        )
        .jpeg({ quality: 80 })
        .toBuffer(),
    );
    const { votes } = await this.ensemble.run({
      feature: 'photo_search_rerank',
      system: RERANK_SYSTEM,
      prompt: `Оцени клетки 1–${top.length}. Ответ: {"scores":[{"cell":1,"score":0}]}.`,
      images: [jpeg, grid],
      schema: RerankVote,
      tier: 'fast',
      timeoutMs: 12_000,
      maxTokens: 400,
    });
    if (!votes.length) return null;
    const sum = new Map<string, number>();
    const weight = new Map<string, number>();
    for (const v of votes)
      for (const { cell, score } of v.value.scores) {
        const item = top[cell - 1];
        if (!item || !tiles[cell - 1]) continue;
        sum.set(item.id, (sum.get(item.id) ?? 0) + score * v.weight);
        weight.set(item.id, (weight.get(item.id) ?? 0) + v.weight);
      }
    return new Map([...sum].map(([id, s]) => [id, s / weight.get(id)!]));
  }
}

/** The providers' answers about the photo, decided by weighted majority. */
export function combineLook(votes: Vote<SeeVoteT>[]): { look: PhotoLook; label: string | null; notClothing: boolean } {
  const validCat = (v: SeeVoteT) => (CATEGORIES.some((c) => c.slug === v.category) ? v.category : null);
  const cat = majority(votes, validCat);
  const catVoters = votes.filter((v) => cat.value && validCat(v.value) === cat.value);
  const catConfidence = cat.share * (catVoters.reduce((s, v) => s + v.value.category_confidence, 0) / (catVoters.length || 1));
  const category = catConfidence >= 0.4 ? CATEGORIES.find((c) => c.slug === cat.value) : undefined;
  const sub = majority(catVoters, (v) => (category?.subcategories.some((s) => s.slug === v.subcategory) ? v.subcategory! : null));
  const subcategory = sub.value ? category?.subcategories.find((s) => s.slug === sub.value) : undefined;

  const colorValues = COLORS.map((c) => c.value);
  // The main colour by majority of first answers, then the others most providers saw.
  const main = majority(votes, (v) => v.colors.find((c) => colorValues.includes(c)) ?? null).value;
  const colors = [...new Set([...(main ? [main] : []), ...quorumSet(votes, (v) => v.colors.filter((c) => colorValues.includes(c)), 0.5)])].slice(0, 3);

  const pattern = majority(votes, (v) => (PATTERNS.includes(v.pattern as (typeof PATTERNS)[number]) ? v.pattern! : null)).value;
  const keywords = [...new Set(votes.flatMap((v) => v.value.keywords.map((k) => k.toLowerCase().trim()).filter((k) => k && k.length <= 30)))].slice(0, 10);

  const brand = majority(votes, (v) => (v.brand_confidence >= 0.6 ? canonicalBrand(v.brand)?.toLowerCase() || null : null));
  const brandName = brand.value && brand.share > 0.5 ? (canonicalBrand(votes.find((v) => canonicalBrand(v.value.brand)?.toLowerCase() === brand.value)?.value.brand) ?? null) : null;

  const look: PhotoLook = { category: category?.slug ?? null, subcategory: subcategory?.slug ?? null, colors, pattern: pattern === 'other' ? null : pattern, keywords, brand: brandName };
  const colorLabel = colors[0] ? COLORS.find((c) => c.value === colors[0])?.label.toLowerCase() : undefined;
  const label = [subcategory?.label ?? category?.label, colorLabel, pattern ? PATTERN_LABEL[pattern] : undefined, brandName].filter(Boolean).join(', ') || null;
  return { look, label, notClothing: share(votes, (v) => v.not_clothing) > 0.5 };
}
