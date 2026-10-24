import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { canonicalBrand } from '../catalog/brands.js';
import { CATEGORIES, COLORS } from '../catalog/catalog.js';
import { background } from '../common/background.js';
import { ListingsService } from '../listings/listings.service.js';
import { type Market, marketOf } from '../listings/market.js';
import { openImage, withSharp } from '../media/image.js';
import { hashDistance, MediaService, type StoredPhoto, usableHash } from '../media/media.service.js';
import { paletteSimilarity } from '../media/palette.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';
import { cosine, ImageEmbedder } from './embeddings.js';
import { majority, median, quorumSet, share } from './ensemble/aggregate.js';
import { AiEnsemble, hashKey, RunBudget, TtlCache, Vote } from './ensemble/ensemble.js';
import { PhotoIndex } from './photo-index.js';

/**
 * Search by photo, the way large shops do it (Pinterest Lens, Amazon, Alibaba): turn the photo into vectors and take
 * the nearest vectors among every photo of everything on sale.
 * 1. Vectors: the photo goes through two embedding models (ai/embeddings.ts); each listing scores by its closest
 *    photo, any angle. The two models' scores are put on one scale and averaged; a near-identical photo (taken off
 *    the site) comes first.
 * 2. Look: meanwhile the vision ensemble names the item for the results page («Шапка, чёрный, с принтом») and
 *    Gemini outlines it on the photo; the item cut out is embedded too (a beanie on someone's head is a small part
 *    of the photo), and the subcategory and a brand read off a logo add a little.
 * Tried on the site's own photos and left out because they made the ranking worse: the ensemble comparing the
 * closest dozen side by side (−10 points of top-1: the vectors tell prints and colourways apart better), and
 * bonuses for the category, colour and words the ensemble saw (its mistakes cost more than its hits bring).
 * With no embedder at hand the colour signature, the difference hash and the look rank, as before vectors.
 * Both markets are searched at once; the result for the same photo is kept for a while.
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
  /** Item ids in the market searched, the most similar first. */
  ids: string[];
  /**
   * The same search in the other market (brands ↔ «Вторичка»): the results page switches between them without
   * sending the photo again. The markets are never mixed.
   */
  other: { market: Exclude<Market, 'all'>; ids: string[] } | null;
  notClothing: boolean;
}

/** Normalised box [top, left, bottom, right], 0..1. */
export type Box = [number, number, number, number];

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
/** Models nest boxes or scale them differently now and then: whatever four numbers there are. */
const box = z
  .unknown()
  .transform((v) => parseBox(v))
  .catch(null);
const SeeVote = z.object({
  category: z.string(),
  category_confidence: conf,
  subcategory: z.string().nullish(),
  box_2d: box,
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
Главная вещь — та, ради которой сделано фото: крупная, в центре, в фокусе; на фото человека в образе — самая заметная вещь.
- category — slug категории; subcategory — slug из списка этой категории:
${subcategoryList}
- box_2d — рамка главной вещи [ymin, xmin, ymax, xmax], числа 0–1000 от размеров фото, плотно по краям вещи.
- colors — 1–3 основных цвета самой вещи (не фона), главный первым, из: ${COLORS.map((c) => c.value).join(', ')}.
- pattern — рисунок вещи, один из: ${PATTERNS.join(', ')} (solid — однотонная; flames — языки пламени; knit_pattern — вязаный узор).
- keywords — 2–6 коротких русских слов о том, что отличает вещь внешне: рисунок, принт, надписи, фактура, детали, фасон (например «пламя», «полоски», «стёганая», «оверсайз», «помпон»). Без цвета и типа вещи.
- brand — только если на фото читается логотип или бирка. Иначе пустая строка и brand_confidence 0.
- *_confidence — от 0 до 1.
- not_clothing — на фото нет одежды, обуви, сумки или аксессуара.`;

// ---------- ranking (pure, tuned offline on the site's photos) ----------

/**
 * How much each signal moves a listing, in units of the vector score's spread among the candidates. Tuned on the
 * site's photos: another photo of the same item, as is and cropped and recompressed like a screenshot.
 */
const WEIGHTS = {
  /** Per embedder; normalised over the embedders that answered. */
  models: { gemini: 0.5, siglip: 0.5 } as Record<string, number>,
  /** The main item cut out of the photo, next to the whole photo (1). */
  item: 0.5,
  subcategory: 0.15,
  brand: 0.2,
  /** A near-identical photo (the visitor took it off the site): on top whatever the rest says. */
  duplicate: 3,
};

export interface Candidate {
  id: string;
  title: string;
  category: string | null;
  subcategory: string | null;
  color: string | null;
  brand: string | null;
  photos: Array<StoredPhoto & { dhash: string | null; palette: string | null }>;
}

export interface QueryVectors {
  /** Embedder id → vectors of the whole photo and, for some, of the main item cut out of it. */
  byModel: Map<string, { whole: Float32Array; item?: Float32Array }>;
  dhash: string | null;
  palette: string | null;
}

const modelFamily = (id: string) => (id.startsWith('gemini') ? 'gemini' : 'siglip');

/** Standard scores: how far each value is from the mean, in spreads. */
function zScores(xs: number[]): number[] {
  const n = xs.length;
  if (!n) return [];
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  return xs.map((x) => (x - mean) / sd);
}

/**
 * Ranks the candidates by how close they look to the query: the closest photo per embedder, z-scored per embedder
 * and averaged, plus what the ensemble saw. Without vectors, the colour signature, the difference hash and the look.
 */
export function rankCandidates(candidates: Candidate[], query: QueryVectors, look: PhotoLook, spaces: Map<string, Map<string, Float32Array>>): Array<{ id: string; s: number }> {
  const fused = new Array<number>(candidates.length).fill(0);
  const weightSum = new Array<number>(candidates.length).fill(0);
  for (const [m, { whole, item }] of query.byModel) {
    const space = spaces.get(m);
    if (!space) continue;
    // The cut-out item tips the balance rather than deciding: listings show items on people as often as alone.
    const raw = candidates.map((c) => {
      let best = -Infinity;
      for (const p of c.photos) {
        const v = space.get(p.key);
        if (v) best = Math.max(best, item ? (cosine(whole, v) + WEIGHTS.item * cosine(item, v)) / (1 + WEIGHTS.item) : cosine(whole, v));
      }
      return best;
    });
    const known = raw.filter((x) => x > -Infinity);
    if (known.length < 2) continue;
    const z = zScores(known);
    const w = WEIGHTS.models[modelFamily(m)] ?? 0.5;
    let k = 0;
    raw.forEach((x, i) => {
      if (x === -Infinity) return; // not indexed in this space yet: the other one decides
      fused[i] += w * z[k++];
      weightSum[i] += w;
    });
  }
  const hasVectors = weightSum.some((w) => w > 0);
  const sameBrand = (c: Candidate) => !!look.brand && !!c.brand && c.brand.toLowerCase() === look.brand.toLowerCase();

  return candidates
    .map((c, i) => {
      let duplicate = false;
      let cheap = 0;
      for (const p of c.photos) {
        const h = usableHash(p.dhash);
        const distance = query.dhash && h ? hashDistance(query.dhash, h) : 64;
        if (distance <= 5) duplicate = true;
        if (!hasVectors) cheap = Math.max(cheap, paletteSimilarity(query.palette, p.palette) * 4 + (Math.max(0, 24 - distance) / 24) * 1.5);
      }
      let s: number;
      if (hasVectors) {
        s = weightSum[i] ? fused[i] / weightSum[i] : 0;
        if (look.subcategory && c.subcategory === look.subcategory) s += WEIGHTS.subcategory;
        if (sameBrand(c)) s += WEIGHTS.brand;
      } else {
        // The ranking from before vectors: what the ensemble saw counts for much more when the pixels can't tell.
        s = cheap;
        if (look.category && c.category === look.category) s += 2;
        if (look.subcategory && c.subcategory === look.subcategory) s += 2;
        if (look.colors[0] && c.color === look.colors[0]) s += 1.5;
        if (sameBrand(c)) s += 1.5;
      }
      if (duplicate) s += WEIGHTS.duplicate;
      return { id: c.id, s };
    })
    .sort((a, b) => b.s - a.s);
}

// ---------- the item's box ----------

/** Four numbers out of whatever a model wrote (a list, a nested list, 0..1 or 0..1000), as a valid box or null. */
export function parseBox(raw: unknown): Box | null {
  const nums = [raw].flat(3).map(Number);
  if (nums.length !== 4 || !nums.every(Number.isFinite)) return null;
  const scale = nums.every((n) => n <= 1.0001) ? 1 : 1000;
  const [y0, x0, y1, x1] = nums.map((n) => Math.min(1, Math.max(0, n / scale)));
  if (y1 - y0 < 0.03 || x1 - x0 < 0.03) return null;
  return [y0, x0, y1, x1];
}

/** A box worth cutting out: one that is most of the photo adds nothing to the whole photo. */
export const worthCutting = (b: Box | null): b is Box => !!b && (b[2] - b[0]) * (b[3] - b[1]) < 0.8;

/** Callers hold a `withSharp` slot. A little margin around the item, as product photos have. */
async function cutOut(image: Buffer, b: Box): Promise<Buffer | null> {
  const { width = 0, height = 0 } = await openImage(image).metadata();
  const padY = (b[2] - b[0]) * 0.08;
  const padX = (b[3] - b[1]) * 0.08;
  const top = Math.round(Math.max(0, b[0] - padY) * height);
  const left = Math.round(Math.max(0, b[1] - padX) * width);
  const bottom = Math.round(Math.min(1, b[2] + padY) * height);
  const right = Math.round(Math.min(1, b[3] + padX) * width);
  if (bottom - top < 48 || right - left < 48) return null;
  return openImage(image)
    .extract({ top, left, width: right - left, height: bottom - top })
    .resize(512, 512, { fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer();
}

@Injectable()
export class PhotoSearch {
  private readonly logger = new Logger('PhotoSearch');
  private readonly cache = new TtlCache<PhotoSearchResult>(15 * 60_000, 200);
  /** Searches per minute, site-wide: each one costs a vision run and a Gemini embedding, and guests can search. */
  private readonly budget = new RunBudget(20);

  constructor(
    private readonly ensemble: AiEnsemble,
    private readonly media: MediaService,
    private readonly listings: ListingsService,
    private readonly index: PhotoIndex,
    private readonly recs: RecommendationsService,
  ) {}

  async search(file: Buffer, market: Market, viewerId?: string): Promise<PhotoSearchResult> {
    if (!this.budget.take()) throw new HttpException({ message: 'Поиск по фото сейчас перегружен — попробуйте через минуту', code: 'BUSY' }, HttpStatus.TOO_MANY_REQUESTS);
    const query = await this.media.searchImage(file);
    const key = hashKey(query.dhash, query.palette, market, viewerId ?? null);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const started = Date.now();

    const embedders = this.index.embedders.all.filter((e) => e.available());
    // The whole photo is embedded while the ensemble looks at it; the cut-out item follows once it has answered.
    const [whole, seen, candidates] = await Promise.all([
      this.embedAll(embedders, [query.jpeg]),
      this.ensemble.available
        ? this.see(query.jpeg).catch((e: Error) => {
            this.logger.warn(`see failed: ${e.message}`);
            return null;
          })
        : null,
      // Both markets at once: the other one is offered as a switch on the results page.
      this.listings.photoCandidates('all', viewerId),
    ]);
    // "Not clothing" isn't final (answers vary, drawings and bags confuse the models): then the pixels alone rank.
    const notClothing = !!seen?.notClothing;
    const look: PhotoLook = seen && !notClothing ? seen.look : { category: null, subcategory: null, colors: [], pattern: null, keywords: [], brand: null };

    // The item cut out, for the embedders without a quota (a cut-out would cost a Gemini request for little gain).
    const box = seen?.box ?? null;
    const crop = worthCutting(box) ? await withSharp(() => cutOut(query.large, box)).catch(() => null) : null;
    const items = crop ? await this.embedAll(embedders.filter((e) => !e.metered), [crop]) : new Map<string, Float32Array[]>();
    const byModel = new Map([...whole].map(([m, [v]]) => [m, { whole: v, item: items.get(m)?.[0] }]));

    const spaces = new Map(await Promise.all([...byModel.keys()].map(async (m) => [m, await this.index.vectors(m)] as const)));
    const all = rankCandidates(candidates, { byModel, dhash: query.dhash, palette: query.palette }, look, spaces);
    const marketById = new Map(candidates.map((c) => [c.id, marketOf(c)]));
    const inMarket = (m: Exclude<Market, 'all'>) => all.filter((x) => marketById.get(x.id) === m).slice(0, 120).map((x) => x.id);
    const other = market === 'all' ? null : market === 'brands' ? 'resale' : 'brands';

    this.logger.log(`search: ${Date.now() - started} ms, ${candidates.length} candidates, models ${[...byModel.keys()].join('+') || 'none'}, ${crop ? 'item cut out' : 'whole photo'}`);
    const result: PhotoSearchResult = {
      label: seen?.label ?? null,
      look,
      ids: market === 'all' ? all.slice(0, 120).map((x) => x.id) : inMarket(market),
      other: other ? { market: other, ids: inMarket(other) } : null,
      notClothing,
    };
    this.cache.set(key, result);
    // The look searched for shapes «Для вас»: the best match stands for it.
    if (viewerId && !notClothing && all[0]) background(this.recs.record(viewerId, 'photo_search', all[0].id), 'photo search signal');
    return result;
  }

  /** Each available embedder's vectors of the images; an embedder that fails is left out of this search. */
  private async embedAll(embedders: ImageEmbedder[], images: Buffer[]): Promise<Map<string, Float32Array[]>> {
    const out = await Promise.all(
      embedders.map((e) =>
        e.embed(images, true).then(
          (v) => [e.id, v] as const,
          (err: Error) => (this.logger.warn(`${e.id}: ${err.message}`), null),
        ),
      ),
    );
    return new Map(out.filter((x): x is readonly [string, Float32Array[]] => !!x));
  }

  /** What the item on the photo is, and where it is. */
  private async see(jpeg: Buffer) {
    const { votes } = await this.ensemble.run({
      feature: 'photo_search',
      system: SEE_SYSTEM,
      prompt: 'Опиши вещь на фото.',
      images: [jpeg],
      schema: SeeVote,
      tier: 'fast',
      // The vectors are ready in half a second and the look adds a point or so: the visitor doesn't wait long for it.
      timeoutMs: 5_000,
      graceMs: 1_500,
      maxTokens: 400,
    });
    if (!votes.length) return null;
    return combineLook(votes);
  }
}

/** Only Gemini is trained to outline objects ([ymin, xmin, ymax, xmax] in 0–1000); other models' boxes are noise. */
const outlines = (v: Vote<SeeVoteT>) => v.provider === 'gemini';

/** The providers' answers about the photo, decided by weighted majority; the item's box from the model that can draw it. */
export function combineLook(votes: Vote<SeeVoteT>[]): { look: PhotoLook; label: string | null; notClothing: boolean; box: Box | null } {
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

  // The item's box: the median of the outlining votes.
  const boxes = votes
    .filter(outlines)
    .map((v) => v.value.box_2d)
    .filter((b): b is Box => !!b);
  const box = boxes.length ? ([0, 1, 2, 3].map((i) => median(boxes.map((b) => b[i]))!) as Box) : null;

  const look: PhotoLook = { category: category?.slug ?? null, subcategory: subcategory?.slug ?? null, colors, pattern: pattern === 'other' ? null : pattern, keywords, brand: brandName };
  const colorLabel = colors[0] ? COLORS.find((c) => c.value === colors[0])?.label.toLowerCase() : undefined;
  const label = [subcategory?.label ?? category?.label, colorLabel, pattern ? PATTERN_LABEL[pattern] : undefined, brandName].filter(Boolean).join(', ') || null;
  return { look, label, notClothing: share(votes, (v) => v.not_clothing) > 0.5, box };
}
