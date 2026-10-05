import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';
import { categoryBySlug } from '../catalog/catalog.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { count } from './ensemble/aggregate.js';
import { AiEnsemble, hashKey, Vote } from './ensemble/ensemble.js';
import { counterfeitSignal, findContacts, hasProfanity, isGibberish, mentionsItem, mentionsProhibited } from './text-rules.js';

/**
 * Automatic listing moderation (AI feature 10), run on publish and on edits of live listings.
 *
 * Layer 1 — deterministic rules (instant, always on): profanity, contacts/links, gibberish titles,
 * explicit counterfeit wording.
 * Layer 2 — ensemble vote on text + first photos: is the title a real wearable item, does it match the
 * category and photos, prohibited goods, inappropriate images, hidden contacts.
 *
 * Decisions: a model can reject only by strict majority of the providers that answered; a lone model is
 * never enough on its own — it sends the listing to manual review instead (published, but in the admin
 * queue). When no provider is reachable the listing is published as "unchecked" and re-checked by cron.
 */

type ModerationDecision = 'allow' | 'review' | 'reject';
export interface ModerationVerdict {
  decision: ModerationDecision;
  /** Field → message for the seller (on reject). */
  fields: Record<string, string>;
  /** Human-readable reasons for the admin queue. */
  reasons: string[];
  votes: number;
  providers: string[];
  hash: string;
  checked: boolean;
}

export interface ModeratedListing {
  id: string;
  sellerId: string;
  title: string;
  description: string | null;
  brand: string | null;
  defectsDescription: string | null;
  category: string | null;
  subcategory: string | null;
  moderation?: unknown;
}

const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).catch(false);
const ModerationVote = z.object({
  title_is_item: bool,
  title_matches_category: bool,
  photos_show_item: bool,
  photos_match_title: bool,
  photos_inappropriate: bool,
  prohibited_item: bool,
  counterfeit: bool,
  offensive_text: bool,
  contacts_in_text: bool,
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  reason: z.string().catch(''),
});
type ModerationVoteT = z.infer<typeof ModerationVote>;

const SYSTEM = `Ты модератор C2C-маркетплейса б/у одежды, обуви, сумок и аксессуаров. Проверь объявление (текст и фото) и ответь по каждому пункту.
- title_is_item — название называет конкретную вещь, которую носят (одежда, обувь, сумка, аксессуар, украшение), и понятно, что продаётся. Только бренд или модель без типа вещи («Nike», «Zara 2023») — false. Животные, техника, телефоны, еда, мебель, услуги, бессмыслица, шутки, оскорбления — false. Бренд + модель известной обуви/одежды («Air Max 90», «Levi's 501») — true.
- title_matches_category — название соответствует выбранной категории (кроссовки не в «Платьях»).
- photos_show_item — на фото видна одежда, обувь, сумка, аксессуар или украшение (оценивай само фото, независимо от названия). Если фото нет — true.
- photos_match_title — фото соответствуют названию (на фото куртка, в названии куртка). Если фото нет — true.
- photos_inappropriate — нагота, сексуальный контент, насилие, символика ненависти.
- prohibited_item — запрещённый товар: оружие, наркотики, табак и вейпы, алкоголь, лекарства, документы, животные.
- counterfeit — продавец сам указывает, что это копия/реплика бренда, или явный фейк известного бренда.
- offensive_text — оскорбления, мат, угрозы, дискриминация в тексте.
- contacts_in_text — в тексте есть телефон, мессенджер, ссылка, соцсеть, в том числе замаскированные («восемь ноль два девять…», «тг: ...»).
- confidence — от 0 до 1; reason — коротко по-русски, что не так (или пустая строка).
Обычные описания б/у вещей, следы носки и дефекты — это нормально.`;

const TEXT_FIELDS = ['title', 'description', 'brand', 'defectsDescription'] as const;

const MSG = {
  profanity: 'Уберите нецензурные слова',
  contacts: 'Контакты и ссылки в объявлении запрещены — покупатели напишут вам в чат',
  gibberish: 'Название должно понятно описывать вещь, например «Чёрная джинсовая куртка Levi’s»',
  notItem: 'В названии должна быть вещь: что именно вы продаёте, например «Кроссовки Nike Air Max 90»',
  mismatch: 'Название не совпадает с категорией — проверьте категорию',
  counterfeit: 'Продажа реплик и копий брендов запрещена правилами',
  prohibited: 'Этот товар запрещено продавать на площадке',
  photosNoItem: 'На фото не видно вещи — добавьте фото того, что продаёте',
  photosMismatch: 'Фото не совпадают с названием',
  photosInappropriate: 'Фото нарушают правила площадки',
  offensive: 'Текст нарушает правила площадки',
};

@Injectable()
export class ListingModerator {
  private readonly logger = new Logger('Moderation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly ensemble: AiEnsemble,
  ) {}

  contentHash(l: ModeratedListing, photoKeys: string[]) {
    return hashKey(l.title, l.description, l.brand, l.defectsDescription, l.category, l.subcategory, photoKeys);
  }

  async check(l: ModeratedListing, photoKeys: string[]): Promise<ModerationVerdict> {
    const hash = this.contentHash(l, photoKeys);
    const prev = l.moderation as { hash?: string; status?: string } | null | undefined;
    // Unchanged content that already passed (or is already in review) isn't checked again.
    if (prev?.hash === hash && (prev.status === 'passed' || prev.status === 'review')) {
      return { decision: prev.status === 'passed' ? 'allow' : 'review', fields: {}, reasons: [], votes: 0, providers: [], hash, checked: true };
    }

    const fields: Record<string, string> = {};
    const reasons: string[] = [];
    const reject = (field: string, msg: string, reason: string) => {
      fields[field] ??= msg;
      reasons.push(reason);
    };

    // ---------- layer 1: rules ----------
    for (const f of TEXT_FIELDS) {
      const text = l[f];
      if (!text) continue;
      if (hasProfanity(text)) reject(f, MSG.profanity, `Мат в поле «${f}»`);
      else if (findContacts(text).length) reject(f, MSG.contacts, `Контакты в поле «${f}»: ${findContacts(text)[0].match}`);
    }
    if (!fields.title && isGibberish(l.title)) reject('title', MSG.gibberish, 'Бессмысленное название');
    const allText = [l.title, l.description, l.brand].filter(Boolean).join('\n');
    const fake = counterfeitSignal(allText);
    if (fake === 'strong') reject(counterfeitSignal(l.title) === 'strong' ? 'title' : 'description', MSG.counterfeit, 'Продавец указывает, что это копия');
    const prohibitedWords = mentionsProhibited(allText);
    const itemWord = mentionsItem(l.title);

    // Hard rule violations are reported immediately; no need to spend model calls.
    if (Object.keys(fields).length) {
      return { decision: 'reject', fields, reasons, votes: 0, providers: [], hash, checked: true };
    }

    // ---------- layer 2: ensemble ----------
    const votes = await this.askEnsemble(l, photoKeys);
    const v = votes.votes;
    const n = v.length;
    const majority = (pick: (x: ModerationVoteT) => boolean) => n > 0 && count(v, pick) > n / 2;
    const of = (pick: (x: ModerationVoteT) => boolean) => `${count(v, pick)} из ${n}`;
    let review = false;

    // Title must name an item. The vocabulary rule acts as an extra voter when the title has no item word.
    const notItem = majority((x) => !x.title_is_item);
    if (notItem && (n >= 2 || !itemWord)) reject('title', MSG.notItem, `Название не похоже на вещь (${of((x) => !x.title_is_item)} моделей${itemWord ? '' : ', нет слова-вещи'})`);
    else if (!itemWord && (n === 0 || count(v, (x) => !x.title_is_item) > 0)) {
      review = true;
      reasons.push(n ? `Название под вопросом (${of((x) => !x.title_is_item)} моделей)` : 'В названии нет слова-вещи, ИИ недоступен');
    }

    if (!fields.title && n >= 2 && majority((x) => x.title_is_item && !x.title_matches_category)) {
      reject('category', MSG.mismatch, `Название не совпадает с категорией «${categoryBySlug(l.category)?.label ?? l.category}» (${of((x) => !x.title_matches_category)})`);
    }

    if (photoKeys.length) {
      if (majority((x) => !x.photos_show_item)) {
        if (n >= 2) reject('photos', MSG.photosNoItem, `На фото нет вещи (${of((x) => !x.photos_show_item)})`);
        else {
          review = true;
          reasons.push('На фото может не быть вещи (1 модель)');
        }
      } else if (n >= 2 && majority((x) => !x.photos_match_title)) {
        review = true;
        reasons.push(`Фото не совпадают с названием (${of((x) => !x.photos_match_title)})`);
      }
      const inappropriate = count(v, (x) => x.photos_inappropriate) + votes.blocked.length;
      if (n >= 2 && majority((x) => x.photos_inappropriate)) reject('photos', MSG.photosInappropriate, `Неприемлемые фото (${of((x) => x.photos_inappropriate)})`);
      else if (inappropriate > 0) {
        review = true;
        reasons.push(votes.blocked.length ? `Провайдер отказался обрабатывать фото: ${votes.blocked.join(', ')}` : 'Фото могут быть неприемлемыми (1 модель)');
      }
    }

    if (n >= 2 && majority((x) => x.prohibited_item)) reject('title', MSG.prohibited, `Запрещённый товар (${of((x) => x.prohibited_item)})`);
    else if (prohibitedWords || count(v, (x) => x.prohibited_item) > 0) {
      review = true;
      reasons.push(prohibitedWords ? 'В тексте есть слова о запрещённых товарах' : 'Возможно, запрещённый товар (1 модель)');
    }

    if (majority((x) => x.counterfeit)) {
      if (fake === 'weak' && n >= 1) reject('description', MSG.counterfeit, `Похоже на копию бренда (${of((x) => x.counterfeit)} + слова «копия/фейк»)`);
      else {
        review = true;
        reasons.push(`Возможна подделка (${of((x) => x.counterfeit)})`);
      }
    } else if (fake === 'weak') {
      review = true;
      reasons.push('В тексте слова «копия/фейк/люкс»');
    }

    if (n >= 2 && majority((x) => x.offensive_text)) reject('description', MSG.offensive, `Оскорбительный текст (${of((x) => x.offensive_text)})`);
    if (n >= 2 && majority((x) => x.contacts_in_text)) reject('description', MSG.contacts, `Скрытые контакты в тексте (${of((x) => x.contacts_in_text)})`);

    const decision: ModerationDecision = Object.keys(fields).length ? 'reject' : review ? 'review' : 'allow';
    return { decision, fields, reasons, votes: n, providers: v.map((x) => x.provider), hash, checked: n > 0 };
  }

  private async askEnsemble(l: ModeratedListing, photoKeys: string[]): Promise<{ votes: Vote<ModerationVoteT>[]; blocked: string[] }> {
    if (!this.ensemble.available) return { votes: [], blocked: [] };
    const images = (await Promise.all(photoKeys.slice(0, 3).map((k) => this.media.imageForAi(k, 384).catch(() => null)))).filter((b): b is Buffer => !!b);
    const category = categoryBySlug(l.category);
    const text = [
      `Название: ${l.title}`,
      `Категория: ${category?.label ?? l.category ?? '—'}${l.subcategory ? ` / ${category?.subcategories.find((s) => s.slug === l.subcategory)?.label ?? l.subcategory}` : ''}`,
      l.brand && `Бренд: ${l.brand}`,
      l.description && `Описание: ${l.description.slice(0, 1500)}`,
      l.defectsDescription && `Дефекты: ${l.defectsDescription.slice(0, 500)}`,
      `Фото: ${images.length ? `${images.length} шт. (приложены)` : 'нет'}`,
    ].filter(Boolean);
    const { votes, blocked } = await this.ensemble.run({
      feature: 'listing_moderation',
      system: SYSTEM,
      prompt: text.join('\n'),
      images,
      schema: ModerationVote,
      tier: 'fast',
      timeoutMs: 14_000,
      graceMs: 3_500,
      maxTokens: 400,
      temperature: 0,
      classifyUnsafe: true,
      subject: { type: 'listing', id: l.id },
    });
    return { votes, blocked };
  }

  /** Stores the verdict on the listing and queues "review" verdicts for moderators. */
  async record(l: ModeratedListing, verdict: ModerationVerdict) {
    const status = verdict.decision === 'review' ? 'review' : verdict.decision === 'reject' ? 'rejected' : verdict.checked ? 'passed' : 'unchecked';
    await this.prisma.listing.update({
      where: { id: l.id },
      data: { moderation: { status, hash: verdict.hash, reasons: verdict.reasons, votes: verdict.votes, providers: verdict.providers, checkedAt: new Date().toISOString() } },
    });
    if (status === 'review') await this.queueForReview(l.id, verdict);
  }

  private async queueForReview(listingId: string, verdict: ModerationVerdict) {
    const open = await this.prisma.report.findFirst({ where: { targetType: 'LISTING', targetId: listingId, source: 'ai', status: 'OPEN' } });
    const details = { reasons: verdict.reasons, votes: verdict.votes, providers: verdict.providers, fields: verdict.fields } as Prisma.InputJsonValue;
    if (open) {
      await this.prisma.report.update({ where: { id: open.id }, data: { comment: verdict.reasons.join('; ').slice(0, 1000), details } });
      return;
    }
    await this.prisma.report.create({
      data: { reporterId: null, source: 'ai', targetType: 'LISTING', targetId: listingId, reason: 'Автомодерация', comment: verdict.reasons.join('; ').slice(0, 1000), details },
    });
  }

  /** Listings published while no provider was reachable are checked again; findings go to review. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async recheckUnchecked() {
    if (!this.ensemble.available) return;
    const rows = await this.prisma.listing.findMany({
      where: { status: { in: ['PUBLISHED', 'RESERVED'] }, moderation: { path: ['status'], equals: 'unchecked' } },
      include: { photos: { orderBy: { order: 'asc' }, select: { key: true } } },
      take: 20,
    });
    for (const l of rows) {
      try {
        const verdict = await this.check({ ...l, moderation: null }, l.photos.map((p) => p.key));
        // After publication a rejection is not applied automatically: a moderator decides.
        await this.record(l, verdict.decision === 'reject' ? { ...verdict, decision: 'review' } : verdict);
      } catch (e) {
        this.logger.warn(`recheck ${l.id} failed: ${(e as Error).message}`);
      }
    }
    if (rows.length) this.logger.log(`re-checked ${rows.length} listings`);
  }
}
