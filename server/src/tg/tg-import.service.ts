import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AiService } from '../ai/ai.service.js';
import { PRIVACY_VERSION } from '../auth/auth.service.js';
import { sizeRequired } from '../catalog/catalog.js';
import type { ListingInputT } from '../listings/listings.dto.js';
import { ListingsService } from '../listings/listings.service.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { download, fetchAvatarUrl, fetchChannel, type TgChannelData, type TgPostData } from './scrape.js';
import { type ParsedItem, TgPostParser } from './parse.js';
import { type CuratedItem, TG_SOURCES, type TgSourceConfig } from './sources.js';

/**
 * bcrypt hashes of the shop accounts' passwords, by channel: TG_PASSWORD_HASHES='{"nenetstore":"$2b$10$…"}'.
 * Kept out of the (public) repository; the passwords themselves were handed to the shop owners.
 */
function passwordHash(channel: string): string | null {
  try {
    const hash = (JSON.parse(process.env.TG_PASSWORD_HASHES ?? '{}') as Record<string, unknown>)[channel];
    return typeof hash === 'string' && hash.startsWith('$2') ? hash : null;
  } catch {
    return null;
  }
}

/** A channel post that says the item is gone. */
const SOLD_RE = /\bsold\b|продан[оа]?\b|распродан|нет в наличии/i;

/** Item to list, with its photos already resolved to URLs. */
type ImportItem = Omit<CuratedItem, 'photos'> & { photoUrls: string[] };

/**
 * Mirrors the shops in TG_SOURCES: each channel is one seller account (nick = channel, password from the config).
 * Every few hours the whole channel is read again: new posts become listings, a deleted post takes its listings
 * down, a post edited to «SOLD» marks them sold. Every post is recorded once (TgPost), so nothing is listed twice.
 *
 * On by default in production; TG_IMPORT=off disables it, TG_IMPORT=on enables it elsewhere.
 */
@Injectable()
export class TgImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger('TgImport');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly media: MediaService,
    private readonly ai: AiService,
    private readonly parser: TgPostParser,
  ) {}

  get enabled() {
    const flag = process.env.TG_IMPORT;
    return flag ? flag !== 'off' : process.env.NODE_ENV === 'production';
  }

  onApplicationBootstrap() {
    // Shortly after start, so a fresh deploy imports at once without slowing the boot.
    if (this.enabled) setTimeout(() => void this.syncAll(), 30_000).unref();
  }

  @Cron('17 */3 * * *')
  async cron() {
    if (this.enabled) await this.syncAll();
  }

  async syncAll() {
    if (this.running) return;
    this.running = true;
    try {
      for (const cfg of TG_SOURCES) {
        try {
          await this.syncSource(cfg);
        } catch (e) {
          this.logger.error(`@${cfg.channel}: sync failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async syncSource(cfg: TgSourceConfig) {
    const channel = await fetchChannel(cfg.channel);
    if (!channel.posts.length) throw new Error('no posts read (channel private or t.me unreachable)');
    this.logger.log(`@${cfg.channel}: ${channel.posts.length} posts read${channel.complete ? '' : ' (incomplete)'}`);
    const userId = await this.ensureSeller(cfg, channel);
    await this.foldRepeats(cfg, userId);
    const source = await this.prisma.tgSource.upsert({ where: { channel: cfg.channel }, create: { channel: cfg.channel, userId }, update: {} });
    if (!source.enabled) return;

    const known = new Map<number, { status: string; listingIds: string[] }>(
      (await this.prisma.tgPost.findMany({ where: { sourceId: source.id } })).map((p) => [p.postId, { status: p.status, listingIds: p.listingIds }]),
    );
    const posts = new Map(channel.posts.map((p) => [p.id, p]));
    const stats = { imported: 0, skipped: 0, failed: 0, removed: 0, sold: 0 };
    const record = async (postId: number, status: 'IMPORTED' | 'SKIPPED' | 'FAILED', reason: string | null, listingIds: string[] = []) => {
      await this.prisma.tgPost.upsert({
        where: { sourceId_postId: { sourceId: source.id, postId } },
        create: { sourceId: source.id, postId, status, reason, listingIds },
        update: { status, reason, listingIds },
      });
      known.set(postId, { status, listingIds });
      stats[status === 'IMPORTED' ? 'imported' : status === 'SKIPPED' ? 'skipped' : 'failed']++;
    };

    // 1. The hand-split history: items grouped by their home post.
    const byHome = new Map<number, CuratedItem[]>();
    for (const item of cfg.items) byHome.set(item.photos[0][0], [...(byHome.get(item.photos[0][0]) ?? []), item]);
    for (const [home, items] of byHome) {
      if (known.has(home)) continue;
      const post = posts.get(home);
      if (!post) continue; // deleted from the channel before the first import
      const resolved = items.map((i) => ({ ...i, photoUrls: i.photos.map(([pid, idx]) => posts.get(pid)?.photos[idx]).filter((u): u is string => !!u) }));
      await this.importPost(cfg, userId, post, resolved, true, record);
    }
    // Everything else up to the curated mark was looked at and is not for sale.
    for (const post of channel.posts) {
      if (post.id <= cfg.curatedUpTo && !known.has(post.id)) await record(post.id, 'SKIPPED', byHome.size ? 'не товар (разметка)' : 'не товар');
    }

    // 2. New posts: the AI decides what is for sale.
    for (const post of channel.posts) {
      if (post.id <= cfg.curatedUpTo || known.has(post.id)) continue;
      if (!post.photos.length) {
        await record(post.id, 'SKIPPED', post.hasVideo ? 'только видео' : 'без фото');
        continue;
      }
      if (SOLD_RE.test(post.text)) {
        await record(post.id, 'SKIPPED', 'уже продано');
        continue;
      }
      if (!this.parser.available) break; // try again on the next run
      let parsed: { items: ParsedItem[]; skip?: string };
      try {
        const images = await Promise.all(post.photos.slice(0, 6).map(async (u) => this.media.searchImage(await download(u)).then((r) => r.jpeg)));
        parsed = await this.parser.parse(post.text, images, cfg.ownBrand);
      } catch (e) {
        this.logger.warn(`@${cfg.channel}/${post.id}: parse failed: ${(e as Error).message}`);
        continue; // a transient AI failure: the post stays unknown and is tried again
      }
      if (!parsed.items.length) {
        await record(post.id, 'SKIPPED', parsed.skip ?? 'не товар');
        continue;
      }
      const items = parsed.items.map(({ photoIndexes, ...i }) => ({ ...i, photoUrls: photoIndexes.map((x) => post.photos[x]).filter(Boolean) }));
      await this.importPost(cfg, userId, post, items, false, record);
    }

    // 3. Posts gone from the channel take their listings down; posts edited to «SOLD» mark them sold.
    const oldest = channel.posts[0].id;
    for (const [postId, row] of known) {
      if (row.status !== 'IMPORTED' || !row.listingIds.length) continue;
      const post = posts.get(postId);
      if (!post && channel.complete && postId >= oldest) {
        stats.removed += await this.closeListings(userId, row.listingIds, 'remove');
        await this.prisma.tgPost.update({ where: { sourceId_postId: { sourceId: source.id, postId } }, data: { status: 'REMOVED', reason: 'пост удалён из канала' } });
      } else if (post && SOLD_RE.test(post.text)) {
        stats.sold += await this.closeListings(userId, row.listingIds, 'sold');
      }
    }

    await this.prisma.tgSource.update({ where: { id: source.id }, data: { lastSyncAt: new Date() } });
    if (Object.values(stats).some((n) => n > 0)) this.logger.log(`@${cfg.channel}: ${JSON.stringify(stats)}`);
  }

  /** The shop's account: created once with the configured password; the profile follows the channel. */
  private async ensureSeller(cfg: TgSourceConfig, channel: TgChannelData) {
    const existing = await this.prisma.user.findUnique({ where: { username: cfg.channel }, include: { tgSources: true } });
    if (existing && !existing.tgSources.length && (existing.email || existing.phone || existing.googleSub || existing.telegramId)) {
      throw new Error(`@${cfg.channel} is taken by a real user — not touching it`);
    }
    const user =
      existing ??
      (await this.prisma.user.create({
        // The bio is ours, not the channel's: channel descriptions carry contacts for ordering outside the platform.
        data: { username: cfg.channel, passwordHash: passwordHash(cfg.channel), bio: cfg.bio, privacyAcceptedAt: new Date(), privacyVersion: PRIVACY_VERSION, onboardedAt: new Date() },
      }));
    // The password may be configured after the account was made: then it is set once (the owner may change it later).
    const hash = passwordHash(cfg.channel);
    if (!user.passwordHash && hash) await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    if (!user.bio) await this.prisma.user.update({ where: { id: user.id }, data: { bio: cfg.bio } });
    if (!user.avatarId && channel.avatarUrl) {
      try {
        const buffer = await download((await fetchAvatarUrl(cfg.channel).catch(() => null)) ?? channel.avatarUrl);
        const photo = await this.media.upload(user.id, fileOf(buffer, 'avatar.jpg'), 'avatar');
        await this.prisma.user.update({ where: { id: user.id }, data: { avatarId: photo.id } });
      } catch (e) {
        this.logger.warn(`@${cfg.channel}: avatar not set: ${(e as Error).message}`);
      }
    }
    return user.id;
  }

  /** Lists the items of one post and records the post, whatever happens to each item. */
  private async importPost(
    cfg: TgSourceConfig,
    userId: string,
    post: TgPostData,
    items: ImportItem[],
    backdate: boolean,
    record: (postId: number, status: 'IMPORTED' | 'SKIPPED' | 'FAILED', reason: string | null, listingIds?: string[]) => Promise<void>,
  ) {
    const ids: string[] = [];
    const errors: string[] = [];
    for (const item of items) {
      try {
        ids.push(...(await this.createListing(cfg, userId, item, backdate && post.date ? new Date(post.date) : null, backdate)));
      } catch (e) {
        errors.push(`${item.title}: ${errorText(e)}`);
        this.logger.warn(`@${cfg.channel}/${post.id} «${item.title}»: ${errorText(e)}`);
      }
    }
    await record(post.id, ids.length ? 'IMPORTED' : 'FAILED', errors.join('; ').slice(0, 1000) || null, ids);
  }

  /** One item → one published listing; returns its id (as a list, like a post's listingIds). */
  private async createListing(cfg: TgSourceConfig, userId: string, item: ImportItem, publishedAt: Date | null, handChecked: boolean) {
    // A run cut short (deploy, restart) may have listed this item already, or left its draft behind.
    const title = item.title.slice(0, 80);
    for (const draft of await this.prisma.listing.findMany({ where: { sellerId: userId, title, status: 'DRAFT' }, select: { id: true } })) {
      await this.listings.remove(userId, draft.id);
    }
    const earlier = await this.prisma.listing.findFirst({ where: { sellerId: userId, title, status: { notIn: ['DELETED', 'DRAFT'] } }, orderBy: { createdAt: 'asc' } });
    if (earlier) return [earlier.id];
    const urls = [...new Set(item.photoUrls)].slice(0, 10);
    if (!urls.length) throw new Error('нет фото');
    const photos: { id: string; isDefect: boolean }[] = [];
    let cover: Buffer | null = null;
    for (const url of urls) {
      const buffer = await download(url);
      cover ??= buffer;
      photos.push({ id: (await this.media.upload(userId, fileOf(buffer, 'photo.jpg'))).id, isDefect: false });
    }

    let color = item.color;
    let styleTags: string[] = [];
    if (cover && this.ai.enabled) {
      // Colour (when the post doesn't say) and style tags from the cover, like the sell form's autofill.
      try {
        const s = await this.ai.analyze([(await this.media.searchImage(cover)).jpeg], userId);
        color ??= s.color.value ?? undefined;
        styleTags = s.style_tags.value;
      } catch {
        /* optional */
      }
    }

    const shoes = item.category === 'shoes';
    const sizes = item.sizes ?? [];
    // One listing per item; several sizes are its «Несколько размеров» (the buyer picks one).
    const size = sizes.length
      ? { sizeSystem: (shoes ? 'SHOE_EU' : 'ALPHA') as 'SHOE_EU' | 'ALPHA', sizeValue: sizes[0], sizes }
      : sizeRequired(item.category)
        ? { sizeSystem: 'OTHER' as const, sizeValue: 'Уточняйте' }
        : { sizeSystem: null, sizeValue: null };

    const input: ListingInputT = {
      photos,
      title: item.title.slice(0, 80),
      category: item.category,
      subcategory: item.subcategory,
      ...size,
      condition: 'NEW_WITH_TAGS',
      hasTags: true,
      defectsPresent: false,
      brand: item.brand ?? cfg.ownBrand ?? null,
      color: color ?? null,
      material: item.material ?? null,
      description: [item.description, cfg.footer].filter(Boolean).join('\n\n').slice(0, 2000),
      deliveryOptions: ['DELIVERY'],
      saleType: 'FIXED',
      ...(item.price ? { price: item.price, acceptsOffers: true } : { priceNegotiable: true, acceptsOffers: true }),
      gender: item.gender ?? null,
      styleTags,
    };
    const draft = await this.listings.create(userId, input);
    try {
      // Old posts keep their date, so a first import doesn't flood «Новое» and followers aren't notified.
      if (publishedAt) await this.prisma.listing.update({ where: { id: draft.id }, data: { publishedAt, liftedAt: publishedAt } });
      // Hand-split items are different things even when their product shots hash alike (black hoodies on white).
      await this.listings.publish(userId, draft.id, { trustedPhotos: handChecked });
    } catch (e) {
      await this.listings.remove(userId, draft.id).catch(() => undefined);
      throw e;
    }
    return [draft.id];
  }

  /**
   * One item = one card: size copies made by earlier imports are folded into their first listing (as its
   * «Несколько размеров»), and listings repeating a title keep only the oldest. Items in a deal are left alone.
   */
  private async foldRepeats(cfg: TgSourceConfig, userId: string) {
    const ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
    const rank = (v: string | null) => (ORDER.includes(v ?? '') ? ORDER.indexOf(v!) : 100 + Number(v ?? 0));
    const live = await this.prisma.listing.findMany({
      where: { sellerId: userId, status: { in: ['PUBLISHED', 'HIDDEN', 'RESERVED', 'SOLD'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, status: true, groupId: true, sizeValue: true, sizeSystem: true, sizes: true },
    });
    let folded = 0;
    const byTitle = new Map<string, typeof live>();
    for (const l of live) byTitle.set(l.title, [...(byTitle.get(l.title) ?? []), l]);
    // A first fix wrote several sizes as one line («S, M, L»): such listings get them as real sizes.
    for (const l of live) {
      if (l.sizeSystem === 'OTHER' && l.sizeValue?.includes(', ') && !l.sizes.length) {
        const list = l.sizeValue.split(', ');
        await this.prisma.listing.update({ where: { id: l.id }, data: { sizeSystem: 'ALPHA', sizeValue: list[0], sizes: list } });
        Object.assign(l, { sizeSystem: 'ALPHA', sizeValue: list[0], sizes: list });
        folded++;
      }
    }
    for (const [, rows] of byTitle) {
      if (rows.length < 2) continue;
      const keep = rows.find((r) => r.status === 'RESERVED') ?? rows[0];
      const sizes = [...new Set(rows.flatMap((r) => (r.sizes.length ? r.sizes : [r.sizeValue])).filter((v): v is string => !!v && v !== 'Уточняйте'))].sort((a, b) => rank(a) - rank(b));
      for (const r of rows) {
        if (r.id === keep.id || r.status === 'RESERVED') continue;
        await this.prisma.listing.update({ where: { id: r.id }, data: { status: 'DELETED' } });
        await this.prisma.offer.updateMany({ where: { listingId: r.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        folded++;
      }
      await this.prisma.listing.update({
        where: { id: keep.id },
        data: { groupId: null, extraSizes: [], ...(sizes.length > 1 ? { sizeValue: sizes[0], sizes } : {}) },
      });
    }
    if (folded) this.logger.log(`@${cfg.channel}: ${folded} repeated listings folded`);
  }

  private async closeListings(userId: string, ids: string[], how: 'remove' | 'sold') {
    let n = 0;
    const live = await this.prisma.listing.findMany({ where: { id: { in: ids }, status: { in: ['PUBLISHED', 'HIDDEN'] } }, select: { id: true } });
    for (const { id } of live) {
      try {
        await (how === 'remove' ? this.listings.remove(userId, id) : this.listings.markSold(userId, id));
        n++;
      } catch (e) {
        this.logger.warn(`${how} ${id}: ${errorText(e)}`);
      }
    }
    return n;
  }
}

const fileOf = (buffer: Buffer, name: string) => ({ buffer, mimetype: 'image/jpeg', originalname: name, size: buffer.length }) as Express.Multer.File;

/** Nest HTTP errors carry the useful part (field errors) in the response body. */
function errorText(e: unknown) {
  const r = (e as { getResponse?: () => unknown }).getResponse?.() as { message?: string; fields?: Record<string, string> } | undefined;
  if (r?.fields) return `${r.message}: ${Object.values(r.fields).join(', ')}`;
  return r?.message ?? (e as Error).message;
}
