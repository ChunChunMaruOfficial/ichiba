import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { categoryBySlug } from '../catalog/catalog.js';
import { MediaService, PhotoQuality } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { majority, quorumSet, share } from './ensemble/aggregate.js';
import { AiEnsemble, hashKey, TtlCache, Vote } from './ensemble/ensemble.js';
import { modelLabel } from './ai.service.js';

/**
 * Photo check (AI feature 2): "фото тёмное", "лучше сделать обложкой вот это", "добавьте фото бирки".
 * Technical quality is measured deterministically (luminance, contrast, Laplacian sharpness, resolution);
 * content questions (is the item visible, which shot is the best cover, what's missing) go to the vision
 * ensemble and are decided by majority.
 */

type IssueSeverity = 'error' | 'warn' | 'info';
interface PhotoIssue {
  code: string;
  severity: IssueSeverity;
  text: string;
}

export interface PhotoCheckResult {
  photos: Array<{ id: string; issues: PhotoIssue[] }>;
  cover: { photoId: string; reason: string } | null;
  missing: Array<{ code: string; text: string }>;
  score: number;
  ai: boolean;
  model: string;
}

const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).catch(false);
const MISSING_CODES = ['label', 'back', 'full_front', 'detail', 'on_body'] as const;
const PhotoVote = z.object({
  photos: z.array(
    z.object({
      index: z.coerce.number().int().min(1),
      shows_item: bool,
      item_fully_visible: bool,
      cluttered_background: bool,
      blurry: bool,
      too_dark: bool,
      is_label_or_tag: bool,
      is_defect_closeup: bool,
      quality: z.coerce.number().min(0).max(1).catch(0.5),
    }),
  ),
  best_cover: z.coerce.number().int().min(1),
  missing: z.array(z.string()).catch([]),
});
type PhotoVoteT = z.infer<typeof PhotoVote>;

const MISSING_TEXT: Record<(typeof MISSING_CODES)[number], string> = {
  label: 'Добавьте фото бирки с размером и составом',
  back: 'Добавьте фото со спины',
  full_front: 'Добавьте фото вещи целиком спереди',
  detail: 'Добавьте крупный план ткани или деталей',
  on_body: 'Фото на себе помогает понять посадку',
};

const SYSTEM = `Ты проверяешь фотографии объявления на маркетплейсе б/у одежды. Фото пронумерованы по порядку, начиная с 1; фото 1 сейчас обложка.
Для каждого фото оцени:
- shows_item — на фото видна вещь для продажи (одежда, обувь, сумка, аксессуар), а не посторонний предмет;
- item_fully_visible — вещь видна целиком, не обрезана;
- cluttered_background — фон захламлён и отвлекает;
- blurry — фото нерезкое; too_dark — слишком тёмное;
- is_label_or_tag — крупно бирка или этикетка; is_defect_closeup — крупный план дефекта;
- quality — общее качество фото как обложки, от 0 до 1.
best_cover — номер фото, лучшего для обложки: вещь целиком, резко, светло, без лишнего.
missing — каких кадров не хватает покупателю, коды: label (бирка), back (вид сзади), full_front (вещь целиком спереди), detail (крупно ткань/детали), on_body (на человеке). Только действительно важные, максимум 2.`;

@Injectable()
export class PhotoChecker {
  private readonly cache = new TtlCache<PhotoCheckResult>(60 * 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly ensemble: AiEnsemble,
  ) {}

  async check(userId: string, photoIds: string[], category?: string | null): Promise<PhotoCheckResult> {
    const key = hashKey('photos', photoIds, category);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const rows = await this.prisma.photo.findMany({ where: { id: { in: photoIds }, ownerId: userId } });
    const photos = photoIds.map((id) => rows.find((r) => r.id === id)).filter((p) => p !== undefined);
    const qualities = await Promise.all(photos.map((p) => this.media.quality(p)));

    const votes = photos.length && this.ensemble.available ? await this.askEnsemble(userId, photos.slice(0, 6).map((p) => p.key)) : [];
    const result = this.combine(photos, qualities, votes, category);
    this.cache.set(key, result);
    return result;
  }

  private async askEnsemble(userId: string, keys: string[]) {
    const images = (await Promise.all(keys.map((k) => this.media.imageForAi(k, 384).catch(() => null)))).filter((b): b is Buffer => !!b);
    if (!images.length) return [];
    const { votes } = await this.ensemble.run({
      feature: 'photo_check',
      system: SYSTEM,
      prompt: `Проверь ${images.length} фото.`,
      images,
      schema: PhotoVote,
      tier: 'fast',
      timeoutMs: 12_000,
      maxTokens: 900,
      subject: { type: 'user', id: userId },
    });
    // Keep only votes that describe the photos we sent.
    return votes.filter((v) => v.value.photos.some((p) => p.index <= images.length));
  }

  private combine(
    photos: Array<{ id: string; width: number; height: number; isDefect: boolean }>,
    qualities: Array<PhotoQuality | null>,
    votes: Vote<PhotoVoteT>[],
    category?: string | null,
  ): PhotoCheckResult {
    const perPhoto = photos.map((photo, i) => {
      const index = i + 1;
      const q = qualities[i];
      const answers = votes
        .map((v) => ({ ...v, value: v.value.photos.find((p) => p.index === index) }))
        .filter((v): v is Vote<PhotoVoteT['photos'][number]> & { value: PhotoVoteT['photos'][number] } => !!v.value);
      const yes = (pick: (p: PhotoVoteT['photos'][number]) => boolean) => answers.length > 0 && share(answers, pick) > 0.5;

      const dark = (q && q.brightness < 70) || yes((p) => p.too_dark);
      const overexposed = !!q && q.brightness > 235 && q.contrast < 25;
      const blurry = (q && q.sharpness < 25 && q.contrast >= 20) || yes((p) => p.blurry);
      const issues: PhotoIssue[] = [];
      if (answers.length && yes((p) => !p.shows_item)) issues.push({ code: 'no_item', severity: 'error', text: 'На фото не видно вещи' });
      if (blurry) issues.push({ code: 'blurry', severity: 'warn', text: 'Фото нерезкое — переснимите, держа телефон ровно' });
      if (dark) issues.push({ code: 'dark', severity: 'warn', text: 'Фото тёмное — снимите при дневном свете' });
      if (overexposed) issues.push({ code: 'overexposed', severity: 'warn', text: 'Фото пересвечено — уберите вспышку' });
      if (q && !dark && q.contrast < 18) issues.push({ code: 'low_contrast', severity: 'info', text: 'Фото блёклое — вещь сливается с фоном' });
      if (Math.min(photo.width, photo.height) < 600) issues.push({ code: 'low_res', severity: 'info', text: 'Низкое разрешение — детали будет плохо видно' });
      const ratio = photo.width / photo.height;
      if (ratio > 2.2 || ratio < 0.45) issues.push({ code: 'aspect', severity: 'info', text: 'Слишком вытянутое фото — в ленте его обрежет' });
      if (!photo.isDefect && answers.length && yes((p) => p.shows_item && !p.item_fully_visible && !p.is_label_or_tag && !p.is_defect_closeup)) {
        issues.push({ code: 'cropped', severity: 'info', text: 'Вещь видна не целиком' });
      }
      if (answers.length && yes((p) => p.cluttered_background)) issues.push({ code: 'background', severity: 'info', text: 'Фон отвлекает — лучше однотонная стена или пол' });

      const aiQuality = answers.length ? answers.reduce((s, a) => s + a.value.quality * a.weight, 0) / answers.reduce((s, a) => s + a.weight, 0) : 0.6;
      const penalty = issues.reduce((s, x) => s + (x.severity === 'error' ? 1 : x.severity === 'warn' ? 0.3 : 0.08), 0);
      const coverable = !photo.isDefect && !yes((p) => p.is_label_or_tag || p.is_defect_closeup) && !issues.some((x) => x.severity === 'error');
      return { id: photo.id, issues, score: aiQuality - penalty, coverable };
    });

    // Cover: the ensemble's pick if it is a clean shot, otherwise the best-scoring coverable photo.
    let cover: PhotoCheckResult['cover'] = null;
    if (perPhoto.length > 1) {
      const pick = majority(votes, (v) => (v.best_cover >= 1 && v.best_cover <= perPhoto.length ? v.best_cover : null));
      const byVote = pick.value != null && pick.share > 0.5 ? perPhoto[pick.value - 1] : null;
      const best = byVote && byVote.coverable && !byVote.issues.some((x) => x.severity === 'warn') ? byVote : [...perPhoto].filter((p) => p.coverable).sort((a, b) => b.score - a.score)[0];
      const current = perPhoto[0];
      if (best && best.id !== current.id && (best.score - current.score > 0.15 || !current.coverable)) {
        cover = { photoId: best.id, reason: !current.coverable ? 'Текущая обложка не показывает вещь целиком' : 'На этом фото вещь видно лучше всего' };
      }
    }

    const missing: PhotoCheckResult['missing'] = [];
    if (photos.length === 1) missing.push({ code: 'more', text: 'Добавьте ещё 2–3 фото — с ними продаётся быстрее' });
    const noLabelNeeded = !categoryBySlug(category)?.sizeSystems.length;
    for (const code of quorumSet(votes, (v) => v.missing.filter((m): m is (typeof MISSING_CODES)[number] => (MISSING_CODES as readonly string[]).includes(m)), 0.5)) {
      if (code === 'label' && noLabelNeeded) continue;
      if (missing.length >= 2) break;
      missing.push({ code, text: MISSING_TEXT[code as (typeof MISSING_CODES)[number]] });
    }

    const worst = perPhoto.reduce((s, p) => s + p.issues.reduce((t, x) => t + (x.severity === 'error' ? 30 : x.severity === 'warn' ? 12 : 3), 0), 0);
    return {
      photos: perPhoto.map((p) => ({ id: p.id, issues: p.issues })),
      cover,
      missing,
      score: Math.max(0, Math.min(100, 100 - worst - missing.length * 5)),
      ai: votes.length > 0,
      model: modelLabel(votes),
    };
  }
}
