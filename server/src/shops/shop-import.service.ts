import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import sharp from 'sharp';
import { AiService } from '../ai/ai.service.js';
import { PRIVACY_VERSION } from '../auth/auth.service.js';
import { categoryBySlug, SIZES } from '../catalog/catalog.js';
import { withJobLock } from '../common/job-lock.js';
import type { ListingInputT } from '../listings/listings.dto.js';
import { ListingsService } from '../listings/listings.service.js';
import { reclassifySeller } from '../listings/market.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Rates, RatesService } from '../rates/rates.js';
import { RedisService } from '../redis/redis.js';
import type { ShopProduct } from '../generated/prisma/client.js';
import { ADOPT_SELECT, importerMayAdopt } from '../tg/adopt.js';
import { download, downloadFirst, fetchProducts, lexicalText, type PayloadProduct, photoCandidates } from './payload.js';
import { fetchTildaProducts } from './tilda.js';
import { colorFromName, listingTitle, materialFrom, SHOP_SOURCES, type ShopKind, type ShopSourceConfig, tidySize } from './sources.js';

/**
 * bcrypt hashes of the brand accounts' passwords, by nick: SHOP_PASSWORD_HASHES='{"iloveredhead":"$2b$10$…"}'.
 * Kept out of the (public) repository; the passwords themselves are handed to the brands.
 */
function passwordHash(key: string): string | null {
  try {
    const hash = (JSON.parse(process.env.SHOP_PASSWORD_HASHES ?? '{}') as Record<string, unknown>)[key];
    return typeof hash === 'string' && hash.startsWith('$2') ? hash : null;
  } catch {
    return null;
  }
}

const REMOVED_ON_ICHIBA = 'снято на ichiba';
/** A BYN price that moved less than this (mostly the exchange rate wobbling) is not copied to the listing. */
const MIN_PRICE_CHANGE = 0.03;
/** Sizes a listing takes from the shop: at most this many, each at most SIZE_MAX characters (listing limits). */
const MAX_SIZES = 15;
const SIZE_MAX = 20;

/** A product as it would be listed now. */
interface Offer {
  kind: ShopKind;
  title: string;
  /** BYN. */
  price: number;
  originalPrice: number | null;
  /** In stock, in the shop's order; empty for a thing without sizes. */
  sizes: string[];
  /** Shown in the shop and something in stock. */
  available: boolean;
  description: string;
  material?: string;
  color?: string;
  /** Each photo as its download candidates (photoCandidates), in the shop's order. */
  photos: string[][];
  isNew: boolean;
  /** What a later sync compares to notice a change: BYN prices (at today's rate) and sizes in stock. */
  fingerprint: string;
}

/**
 * Mirrors the brands in SHOP_SOURCES: each web shop is one brand account. Every few hours the catalogue is read
 * again; a product is one listing, and the listing follows the product (price, sizes, sold out, hidden, gone).
 * Listings the brand removed or edited by hand on ichiba are left as they are, except for price and sizes.
 *
 * On by default in production; SHOP_IMPORT=off disables it, SHOP_IMPORT=on enables it elsewhere.
 */
@Injectable()
export class ShopImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ShopImport');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly media: MediaService,
    private readonly ai: AiService,
    private readonly rates: RatesService,
    private readonly redis: RedisService,
  ) {}

  get enabled() {
    const flag = process.env.SHOP_IMPORT;
    return flag ? flag !== 'off' : process.env.NODE_ENV === 'production';
  }

  onApplicationBootstrap() {
    // After the Telegram import's first run has started, so the two don't download photos at the same moment.
    if (this.enabled) setTimeout(() => void this.cron(), 90_000).unref();
  }

  /** Under the job lock: the old and the new container overlapping in a deploy would list every new product twice. */
  @Cron('47 */3 * * *')
  async cron() {
    if (this.enabled) await withJobLock(this.redis, 'shops.import', 3 * 3600_000, () => this.syncAll());
  }

  async syncAll() {
    if (this.running) return;
    this.running = true;
    try {
      for (const cfg of SHOP_SOURCES) {
        try {
          await this.syncSource(cfg);
        } catch (e) {
          this.logger.error(`${cfg.key}: sync failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async syncSource(cfg: ShopSourceConfig) {
    const rates = cfg.currency === 'BYN' ? null : await this.rates.get();
    if (cfg.currency !== 'BYN' && !rates) throw new Error('no exchange rates — prices cannot be converted');
    const products = cfg.tilda ? await fetchTildaProducts(cfg.tilda) : await fetchProducts(cfg.origin);
    if (!products.length) throw new Error('the shop returned no products');
    this.logger.log(`${cfg.key}: ${products.length} products read`);

    const userId = await this.ensureSeller(cfg);
    if (!userId) return;
    const source = await this.prisma.shopSource.upsert({ where: { key: cfg.key }, create: { key: cfg.key, userId }, update: {} });
    if (!source.enabled) return;
    // The first import keeps each product's own date, so the brand's whole catalogue doesn't flood «Новое».
    const firstRun = !source.lastSyncAt;

    const rows = new Map((await this.prisma.shopProduct.findMany({ where: { sourceId: source.id } })).map((r) => [r.productId, r]));
    await this.adoptMoved(cfg, products, rows);
    const stats = { listed: 0, updated: 0, hidden: 0, shown: 0, removed: 0, skipped: 0, failed: 0 };
    const save = async (productId: string, data: { status: string; reason?: string | null; listingId?: string | null; fingerprint?: string | null }) => {
      const row = await this.prisma.shopProduct.upsert({
        where: { sourceId_productId: { sourceId: source.id, productId } },
        create: { sourceId: source.id, productId, reason: null, ...data },
        update: { reason: null, ...data },
      });
      rows.set(productId, row);
    };

    // Oldest first, so on the first import the newest products end up on top.
    const ordered = [...products].sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? '') || 0);
    for (const product of ordered) {
      const productId = String(product.id);
      const row = rows.get(productId);
      const offer = this.offerOf(cfg, product, rates);
      if (!offer) {
        if (row?.status !== 'SKIPPED') stats.skipped++;
        await save(productId, { status: 'SKIPPED', reason: 'не вещь для ichiba (набор-сюрприз или неизвестный тип)', listingId: row?.listingId ?? null });
        continue;
      }
      const listing = row?.listingId
        ? await this.prisma.listing.findUnique({ where: { id: row.listingId }, select: { id: true, status: true, price: true } })
        : null;

      try {
        // Removed by the brand (or blocked by a moderator) on ichiba: never brought back.
        if (row?.status === 'REMOVED' && row.reason === REMOVED_ON_ICHIBA) continue;
        if (listing && ['DELETED', 'BLOCKED'].includes(listing.status) && row?.status !== 'REMOVED') {
          await save(productId, { status: 'REMOVED', reason: REMOVED_ON_ICHIBA, listingId: listing.id, fingerprint: row?.fingerprint });
          continue;
        }

        // Nothing live for it yet (new, failed before, sold on ichiba, back in the shop after being gone): list it.
        const live = listing && ['PUBLISHED', 'HIDDEN', 'RESERVED', 'DRAFT'].includes(listing.status) ? listing : null;
        if (!live) {
          if (!offer.available) {
            if (row?.status !== 'SKIPPED') stats.skipped++;
            await save(productId, { status: 'SKIPPED', reason: product.hidden ? 'скрыт в магазине' : 'нет в наличии', listingId: listing?.id ?? null, fingerprint: row?.fingerprint });
            continue;
          }
          const id = await this.createListing(cfg, userId, offer, firstRun && product.createdAt ? new Date(product.createdAt) : null);
          await save(productId, { status: 'LISTED', listingId: id, fingerprint: offer.fingerprint });
          stats.listed++;
          continue;
        }

        if (live.status === 'DRAFT') {
          // A run cut short left the draft: finish it.
          await this.listings.publish(userId, live.id, { trustedPhotos: true, allowUnchecked: true });
        }
        // Photos the shop was too slow to give last time: the listing gets the full set once it can be fetched.
        if (live.status !== 'RESERVED' && (await this.prisma.photo.count({ where: { listingId: live.id } })) < offer.photos.length) {
          const { photos } = await this.uploadPhotos(cfg, userId, offer);
          if (photos.length === offer.photos.length) {
            await this.listings.update(userId, live.id, { photos });
            stats.updated++;
          }
        }
        // What the listing is known to show; differs from the offer's when a small price move was left out.
        let fingerprint = offer.fingerprint;
        if (row!.fingerprint !== offer.fingerprint && live.status !== 'RESERVED') {
          const patch = this.priceAndSizes(offer);
          // A move under 3% (an exchange-rate wobble) keeps the listed price: no edit for it and no «цена снижена» to
          // everyone who saved the item. The fingerprint records the price actually listed, so a drift that adds up
          // past 3% is copied on a later run.
          const small = live.price != null && live.price > 0 && Math.abs(offer.price - live.price) / live.price < MIN_PRICE_CHANGE;
          if (small) {
            patch.price = live.price;
            fingerprint = JSON.stringify([live.price, offer.originalPrice, offer.sizes]);
          }
          const [, prevOld, prevSizes] = (JSON.parse(row!.fingerprint ?? 'null') as [number, number | null, string[]] | null) ?? [];
          const onlyPrice = JSON.stringify([prevOld ?? null, prevSizes ?? []]) === JSON.stringify([offer.originalPrice, offer.sizes]);
          if (!(small && onlyPrice)) {
            await this.listings.update(userId, live.id, patch);
            stats.updated++;
          }
        }
        if (!offer.available && (live.status === 'PUBLISHED' || live.status === 'DRAFT')) {
          await this.listings.hide(userId, live.id);
          stats.hidden++;
          await save(productId, { status: 'OUT', reason: product.hidden ? 'скрыт в магазине' : 'нет в наличии', listingId: live.id, fingerprint });
        } else if (offer.available && live.status === 'HIDDEN' && row!.status === 'OUT') {
          // Only what the sync hid comes back; a listing the brand hid by hand stays hidden.
          await this.listings.publish(userId, live.id, { trustedPhotos: true });
          stats.shown++;
          await save(productId, { status: 'LISTED', listingId: live.id, fingerprint });
        } else {
          await save(productId, { status: row!.status === 'OUT' && offer.available ? 'LISTED' : row!.status, listingId: live.id, fingerprint });
        }
      } catch (e) {
        stats.failed++;
        this.logger.warn(`${cfg.key}/${productId} «${offer.title}»: ${errorText(e)}`);
        await save(productId, { status: row?.listingId ? row.status : 'FAILED', reason: errorText(e).slice(0, 1000), listingId: row?.listingId ?? null, fingerprint: row?.fingerprint });
      }
    }

    // Products gone from the shop take their listings down.
    const present = new Set(products.map((p) => String(p.id)));
    for (const row of rows.values()) {
      if (present.has(row.productId) || !row.listingId || !['LISTED', 'OUT'].includes(row.status)) continue;
      try {
        const l = await this.prisma.listing.findUnique({ where: { id: row.listingId }, select: { status: true } });
        if (l && ['PUBLISHED', 'HIDDEN', 'DRAFT'].includes(l.status)) await this.listings.remove(userId, row.listingId);
        if (l?.status === 'RESERVED') continue; // a deal is on: removed on a later run, once it is over
        await save(row.productId, { status: 'REMOVED', reason: 'товар удалён из магазина', listingId: row.listingId });
        stats.removed++;
      } catch (e) {
        this.logger.warn(`${cfg.key}/${row.productId}: remove failed: ${errorText(e)}`);
      }
    }

    await this.prisma.shopSource.update({ where: { id: source.id }, data: { lastSyncAt: new Date() } });
    if (Object.values(stats).some((n) => n > 0)) this.logger.log(`${cfg.key}: ${JSON.stringify(stats)}`);
  }

  /**
   * A shop that moved to another platform (iloveredhead: Payload → Tilda) gives every product a new id. A new id whose
   * listing title is that of a known product gone from the feed takes that product's row over, so its listing stays on
   * with its favourites, views and offers, instead of being taken down and listed again.
   */
  private async adoptMoved(cfg: ShopSourceConfig, products: PayloadProduct[], rows: Map<string, ShopProduct>) {
    const present = new Set(products.map((p) => String(p.id)));
    const gone = [...rows.values()].filter((r) => !present.has(r.productId) && r.listingId);
    if (!gone.length) return;
    const listings = await this.prisma.listing.findMany({ where: { id: { in: gone.map((r) => r.listingId!) } }, select: { id: true, title: true } });
    let adopted = 0;
    // The same title first; then the title without the brand's own name, which the shop dropped from some products
    // when it moved («HAT “I<3REDHEAD” CAMO» became «HAT “CAMO”»). A key two listings or two products share is skipped.
    const withoutBrand = (title: string) => (cfg.brandPattern ? titleKey(title).replace(cfg.brandPattern, ' ').replace(/ +/g, ' ').trim() : titleKey(title));
    for (const key of [titleKey, withoutBrand]) {
      const unique = <T>(items: T[], keyOf: (t: T) => string) => {
        const seen = new Map<string, T | null>();
        for (const it of items) seen.set(keyOf(it), seen.has(keyOf(it)) ? null : it);
        return seen;
      };
      const left = listings.filter((l) => gone.some((r) => r.listingId === l.id && rows.get(r.productId) === r));
      const fresh = products.flatMap((p) => {
        const kind = rows.has(String(p.id)) ? null : cfg.kind(p);
        return kind ? [{ p, title: listingTitle(cfg, p, kind) }] : [];
      });
      const byListing = unique(left, (l) => key(l.title));
      for (const [k, item] of unique(fresh, (f) => key(f.title))) {
        const listing = byListing.get(k);
        const row = item && listing ? gone.find((r) => r.listingId === listing.id) : undefined;
        if (!item || !row) continue;
        const moved = await this.prisma.shopProduct.update({ where: { id: row.id }, data: { productId: String(item.p.id) } });
        rows.delete(row.productId);
        rows.set(moved.productId, moved);
        adopted++;
      }
    }
    if (adopted) this.logger.log(`${cfg.key}: ${adopted} products kept their listings under new shop ids`);
  }


  /** The product as a listing would show it, or null when it is not a thing ichiba lists. */
  private offerOf(cfg: ShopSourceConfig, p: PayloadProduct, rates: Rates | null): Offer | null {
    const kind = cfg.kind(p);
    if (!kind || !categoryBySlug(kind.category) || !p.price) return null;
    const byn = (amount: number) => (rates ? Math.max(1, Math.round(amount / rates.perByn.RUB)) : Math.round(amount));
    const price = byn(p.price);
    const old = p.oldPrice && p.oldPrice > p.price ? byn(p.oldPrice) : null;

    const inStock = (p.stock ?? []).filter((s) => (s.quantity ?? 0) > 0 && s.size?.trim()).map((s) => tidySize(s.size!));
    const sized = (categoryBySlug(kind.category)?.sizeSystems.length ?? 0) > 0;
    // Third-party data: sizes are kept to what a listing can hold (a broken feed can't write hundreds of long «sizes»).
    const sizes = sized ? [...new Set(inStock)].filter((s) => s.length <= SIZE_MAX).slice(0, MAX_SIZES) : [];
    const available = !p.hidden && p.inStock !== false && (p.stock?.length ? inStock.length > 0 : true);

    const text = withoutContacts(p.descriptionText ?? lexicalText(p.description_ru));
    // Things without sizes keep the shop's variants (a keychain's colours) in the text.
    const variants = !sized && inStock.length && !inStock.every((s) => /^ONE SIZE$/.test(s)) ? `В наличии: ${inStock.map((s) => s.toLowerCase()).join(', ')}.` : '';
    const shipping = p.shippingText?.trim() ? `${p.shippingText.trim().charAt(0).toUpperCase()}${p.shippingText.trim().slice(1)}.`.replace(/\.\.$/, '.') : '';
    const description = [text, variants, shipping, cfg.footer].filter(Boolean).join('\n\n').slice(0, 2000);

    const seen = new Set<string>();
    const photos = [...(p.images ?? []).map((i) => i.image), p.sizeChart]
      .map((m) => photoCandidates(m).map((u) => new URL(u, cfg.origin).href))
      .filter((c) => c.length && !seen.has(c[0]) && seen.add(c[0]))
      .slice(0, 10);

    return {
      kind,
      title: listingTitle(cfg, p, kind),
      price,
      originalPrice: old && old > price ? old : null,
      sizes,
      available,
      description,
      material: materialFrom(text),
      color: colorFromName(p.name_ru),
      photos,
      isNew: !!p.isNew,
      // In BYN: a shop price change or a new exchange rate that moves the rounded BYN price both reach the listing.
      fingerprint: JSON.stringify([price, old && old > price ? old : null, sizes]),
    };
  }

  /** Size fields: «Несколько размеров» for several, the one size, or «ONE SIZE» for clothes the shop sells so. */
  private sizeFields(offer: Offer): Pick<ListingInputT, 'sizeSystem' | 'sizeValue' | 'sizes'> {
    if (!offer.sizes.length) {
      return (categoryBySlug(offer.kind.category)?.sizeSystems.length ?? 0) > 0
        ? { sizeSystem: 'OTHER', sizeValue: 'Уточняйте', sizes: [] }
        : { sizeSystem: null, sizeValue: null, sizes: [] };
    }
    const alpha = offer.sizes.every((s) => SIZES.ALPHA.includes(s));
    return { sizeSystem: alpha ? 'ALPHA' : 'OTHER', sizeValue: offer.sizes[0], sizes: offer.sizes };
  }

  private priceAndSizes(offer: Offer): ListingInputT {
    return { price: offer.price, originalPrice: offer.originalPrice, ...this.sizeFields(offer) };
  }

  /**
   * The brand's account: created once, a verified brand from the start; the profile follows the shop. Null when the
   * nick belongs to an account the import didn't make (a person's): it is never listed under or given a password.
   */
  private async ensureSeller(cfg: ShopSourceConfig) {
    const existing = await this.prisma.user.findUnique({
      where: { username: cfg.key },
      select: { id: true, passwordHash: true, bio: true, brandVerifiedAt: true, catalogApprovedAt: true, avatarId: true, ...ADOPT_SELECT },
    });
    if (existing && !importerMayAdopt(existing)) {
      this.logger.warn(`@${cfg.key}: the nick belongs to an account the import didn't create — shop skipped`);
      return null;
    }
    const user =
      existing ??
      (await this.prisma.user.create({
        data: {
          username: cfg.key,
          passwordHash: passwordHash(cfg.key),
          bio: cfg.bio,
          brandName: cfg.brandName,
          brandVerifiedAt: new Date(),
          privacyAcceptedAt: new Date(),
          privacyVersion: PRIVACY_VERSION,
          onboardedAt: new Date(),
        },
      }));
    const hash = passwordHash(cfg.key);
    const patch = {
      ...(!user.passwordHash && hash ? { passwordHash: hash } : {}),
      ...(!user.bio ? { bio: cfg.bio } : {}),
      ...(!user.brandVerifiedAt ? { brandVerifiedAt: new Date(), brandName: cfg.brandName } : {}),
    };
    if (Object.keys(patch).length) await this.prisma.user.update({ where: { id: user.id }, data: patch });
    // The status granted just now: the account's items follow the catalogue rules (an admin's own choices stay).
    if (!user.brandVerifiedAt) await reclassifySeller(this.prisma, user.id, { brandVerifiedAt: new Date(), catalogApprovedAt: user.catalogApprovedAt });
    if (!user.avatarId && cfg.logoUrl) {
      try {
        const photo = await this.media.upload(user.id, jpegFile(await squareLogo(await download(cfg.origin, cfg.logoUrl, cfg.mediaHosts)), 'avatar.jpg'), 'avatar');
        await this.prisma.user.update({ where: { id: user.id }, data: { avatarId: photo.id } });
      } catch (e) {
        this.logger.warn(`${cfg.key}: avatar not set: ${(e as Error).message}`);
      }
    }
    return user.id;
  }

  /** The product's photos uploaded in its order; a photo that can't be fetched is left out (and topped up later). */
  private async uploadPhotos(cfg: ShopSourceConfig, userId: string, offer: Offer) {
    if (!offer.photos.length) throw new Error('нет фото');
    const photos: { id: string; isDefect: boolean }[] = [];
    let cover: Buffer | null = null;
    for (const candidates of offer.photos) {
      try {
        const buffer = await downloadFirst(cfg.origin, candidates, cfg.mediaHosts);
        cover ??= buffer;
        photos.push({ id: (await this.media.upload(userId, jpegFile(buffer, 'photo.jpg'))).id, isDefect: false });
      } catch (e) {
        // One broken photo (a size chart too small, a dead link) doesn't stop the item.
        this.logger.warn(`${cfg.key} «${offer.title}»: photo skipped: ${errorText(e)}`);
      }
    }
    if (!photos.length) throw new Error('ни одно фото не загрузилось');
    return { photos, cover };
  }

  /** One product → one published listing; returns its id. */
  private async createListing(cfg: ShopSourceConfig, userId: string, offer: Offer, publishedAt: Date | null) {
    // A run cut short (a deploy, a restart) may have left this item's draft behind.
    for (const draft of await this.prisma.listing.findMany({ where: { sellerId: userId, title: offer.title, status: 'DRAFT' }, select: { id: true } })) {
      await this.listings.remove(userId, draft.id);
    }
    const { photos, cover } = await this.uploadPhotos(cfg, userId, offer);

    let color = offer.color;
    let styleTags: string[] = [];
    if (cover && this.ai.enabled) {
      // Colour (when the name doesn't say) and style tags from the cover, like the sell form's autofill.
      try {
        const s = await this.ai.analyze([(await this.media.searchImage(cover)).jpeg], userId);
        color ??= s.color.value ?? undefined;
        styleTags = s.style_tags.value;
      } catch {
        /* optional */
      }
    }

    const input: ListingInputT = {
      photos,
      title: offer.title,
      category: offer.kind.category,
      subcategory: offer.kind.subcategory,
      ...this.sizeFields(offer),
      condition: 'NEW_WITH_TAGS',
      hasTags: true,
      defectsPresent: false,
      brand: cfg.brandName,
      color: color ?? null,
      material: offer.material ?? null,
      description: offer.description,
      deliveryOptions: ['DELIVERY'],
      saleType: 'FIXED',
      price: offer.price,
      originalPrice: offer.originalPrice,
      acceptsOffers: true,
      gender: offer.kind.gender ?? null,
      // «новинка» for the shop's new products; no «бренд» seal by default (the brand may add it on ichiba).
      labels: offer.isNew ? ['new'] : [],
      styleTags,
    };
    const draft = await this.listings.create(userId, input);
    try {
      if (publishedAt) await this.prisma.listing.update({ where: { id: draft.id }, data: { publishedAt, liftedAt: publishedAt } });
      // Product shots on one backdrop hash alike (a row of beanies); they are different products all the same.
      await this.listings.publish(userId, draft.id, { trustedPhotos: true });
    } catch (e) {
      await this.listings.remove(userId, draft.id).catch(() => undefined);
      throw e;
    }
    return draft.id;
  }
}

/** A logo (often a wide SVG) centred on a white square, large enough for a profile photo. */
async function squareLogo(buffer: Buffer) {
  const logo = await sharp(buffer, { density: 600 }).resize(720, 720, { fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#ffffff' } })
    .composite([{ input: logo, gravity: 'center' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

const CONTACT = /@[a-z0-9_]{3,}|https?:\/\/|www\.|t\.me|\+?\d[\d\s()-]{8,}\d/i;

/**
 * Shop texts send buyers to the shop's Telegram («свяжитесь с менеджером в тг @…»); here buyers write in the chat,
 * and moderation rejects contacts. Such a request is turned to the chat; any other line with a contact is dropped.
 */
function withoutContacts(text: string) {
  return text
    .split('\n')
    .map((line) => (CONTACT.test(line) ? line.replace(/(свяжитесь|пишите|напишите|обращайтесь)[^\n]*$/i, 'напишите нам в чат') : line))
    .filter((line) => !CONTACT.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const jpegFile = (buffer: Buffer, name: string) => ({ buffer, mimetype: 'image/jpeg', originalname: name, size: buffer.length }) as Express.Multer.File;

/** Nest HTTP errors carry the useful part (field errors) in the response body. */
/** Titles compared for adoption: case, quotes and spacing aside. */
const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»“”„"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function errorText(e: unknown) {
  const r = (e as { getResponse?: () => unknown }).getResponse?.() as { message?: string; fields?: Record<string, string> } | undefined;
  if (r?.fields) return `${r.message}: ${Object.values(r.fields).join(', ')}`;
  return r?.message ?? (e as Error).message;
}
