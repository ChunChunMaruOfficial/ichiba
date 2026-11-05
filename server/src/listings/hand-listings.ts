import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PRIVACY_VERSION } from '../auth/auth.service.js';
import { withJobLock } from '../common/job-lock.js';
import { hashDistance, MediaService, usableHash } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { ADOPT_SELECT, importerMayAdopt } from '../tg/adopt.js';
import { BATCHES } from './hand-batches.js';
import { ListingsService } from './listings.service.js';
import { reclassifySeller } from './market.js';

/** Lists the batches of hand-batches.ts once after a deploy (see there for what a batch is and how accounts are made). */
function passwordHash(nick: string): string | null {
  try {
    const hash = (JSON.parse(process.env.HAND_PASSWORD_HASHES ?? '{}') as Record<string, unknown>)[nick];
    return typeof hash === 'string' && hash.startsWith('$2') ? hash : null;
  } catch {
    return null;
  }
}

const fileOf = (buffer: Buffer, name: string) => ({ buffer, mimetype: 'image/jpeg', originalname: name, size: buffer.length }) as Express.Multer.File;

@Injectable()
export class HandListingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('HandListings');

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly media: MediaService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'production') return;
    // Locked: the old and the new container both start this during a deploy, and would list the same item twice.
    setTimeout(() => void withJobLock(this.redis, 'hand.listings', 15 * 60_000, () => this.run()), 20_000).unref();
  }

  /**
   * Makes the item's chosen photo the listing's cover: the one among its photos whose difference hash is nearest to
   * the file's (the same picture, resized). False when it already is the cover or isn't found.
   */
  private async setCover(listingId: string, folder: string, name: string) {
    const photos = await this.prisma.photo.findMany({ where: { listingId }, orderBy: { order: 'asc' }, select: { id: true, dhash: true } });
    if (photos.length < 2) return false;
    const { dhash } = await this.media.searchImage(await readFile(resolve(process.cwd(), 'seed-data', folder, name)));
    const scored = photos.map((p) => ({ p, d: usableHash(p.dhash) ? hashDistance(usableHash(p.dhash)!, dhash) : 99 }));
    const [best, next] = [...scored].sort((a, b) => a.d - b.d);
    // Measured on the batches: the same picture at the two sizes is 0–12 apart, a different photo of the item 14 or
    // more, so the nearest counts when it is near and clearly nearer than the next.
    if (best.d > 16 || (next && next.d - best.d < 4) || photos[0].id === best.p.id) return false;
    const order = [best.p, ...photos.filter((p) => p.id !== best.p.id)];
    await this.prisma.$transaction(order.map((p, i) => this.prisma.photo.update({ where: { id: p.id }, data: { order: i, isCover: i === 0 } })));
    return true;
  }

  /** Uploads the item's photos and links them to the listing (the first as the cover) in place of the ones it had. */
  private async replacePhotos(sellerId: string, listingId: string, folder: string, names: string[]) {
    const ids: string[] = [];
    for (const name of names) {
      const buffer = await readFile(resolve(process.cwd(), 'seed-data', folder, name));
      ids.push((await this.media.upload(sellerId, fileOf(buffer, name))).id);
    }
    await this.prisma.$transaction([
      this.prisma.photo.updateMany({ where: { listingId }, data: { listingId: null, isCover: false } }),
      ...ids.map((id, i) => this.prisma.photo.update({ where: { id }, data: { listingId, order: i, isCover: i === 0, isDefect: false } })),
    ]);
  }

  async run() {
    for (const batch of BATCHES) {
      const existing = await this.prisma.user.findUnique({
        where: { username: batch.username },
        select: { id: true, passwordHash: true, brandVerifiedAt: true, catalogApprovedAt: true, avatarId: true, ...ADOPT_SELECT },
      });
      // A batch that owns its account (`account`) lists under it and sets its password: only an account this import
      // made qualifies, never a person who happens to hold the nick. A batch without `account` lists for an existing
      // seller who handed the items over, and never touches the password.
      if (existing && batch.account && !importerMayAdopt(existing)) {
        this.logger.warn(`@${batch.username}: the nick belongs to an account the import didn't create — batch skipped`);
        continue;
      }
      const seller =
        existing ??
        (batch.account
          ? await this.prisma.user.create({
              data: {
                username: batch.username,
                bio: batch.account.bio,
                city: 'Минск',
                ...(batch.account.brandName ? { brandName: batch.account.brandName, brandVerifiedAt: new Date() } : {}),
                privacyAcceptedAt: new Date(),
                privacyVersion: PRIVACY_VERSION,
                onboardedAt: new Date(),
              },
              select: { id: true, passwordHash: true, brandVerifiedAt: true, catalogApprovedAt: true, avatarId: true },
            })
          : null);
      if (!seller) {
        this.logger.warn(`@${batch.username}: no such account`);
        continue;
      }
      const hash = batch.account && !seller.passwordHash ? passwordHash(batch.username) : null;
      if (hash) {
        await this.prisma.user.update({ where: { id: seller.id }, data: { passwordHash: hash } });
        this.logger.log(`@${batch.username}: password set`);
      }
      if (batch.account?.brandName && !seller.brandVerifiedAt) {
        const brandVerifiedAt = new Date();
        await this.prisma.user.update({ where: { id: seller.id }, data: { brandName: batch.account.brandName, brandVerifiedAt } });
        await reclassifySeller(this.prisma, seller.id, { brandVerifiedAt, catalogApprovedAt: seller.catalogApprovedAt });
      }
      if (batch.account?.logo && !seller.avatarId) {
        try {
          const buffer = await readFile(resolve(process.cwd(), 'seed-data', batch.folder, batch.account.logo));
          const photo = await this.media.upload(seller.id, fileOf(buffer, batch.account.logo), 'avatar');
          await this.prisma.user.update({ where: { id: seller.id }, data: { avatarId: photo.id } });
        } catch (e) {
          this.logger.warn(`@${batch.username}: avatar not set: ${(e as Error).message}`);
        }
      }
      for (const item of batch.items) {
        const title = item.input.title!;
        // A draft that failed to publish (deleted right away, never shown) doesn't count: the item is tried again.
        const listed = { sellerId: seller.id, title, NOT: { status: 'DELETED' as const, publishedAt: null } };
        const live = await this.prisma.listing.findFirst({ where: listed, select: { id: true, status: true, description: true, _count: { select: { photos: true } } } });
        if (live) {
          if (item.retext && item.input.description && live.description !== item.input.description && live.status !== 'SOLD') {
            // `updatedAt` moves with it, so the search snippet (seo.service.ts) is written again from the new text.
            await this.prisma.listing.update({ where: { id: live.id }, data: { description: item.input.description } });
            this.logger.log(`@${batch.username}: new text for «${title}»`);
          }
          if (item.cover) {
            try {
              if (await this.setCover(live.id, batch.folder, item.cover)) this.logger.log(`@${batch.username}: new cover for «${title}»`);
            } catch (e) {
              this.logger.warn(`@${batch.username}: «${title}» cover not set: ${(e as Error).message}`);
            }
          }
          if (item.replacePhotos != null && live._count.photos === item.replacePhotos && ['PUBLISHED', 'HIDDEN', 'RESERVED'].includes(live.status)) {
            try {
              await this.replacePhotos(seller.id, live.id, batch.folder, item.photos);
              this.logger.log(`@${batch.username}: new photos for «${title}»`);
            } catch (e) {
              this.logger.warn(`@${batch.username}: «${title}» photos not replaced: ${(e as Error).message}`);
            }
          }
          continue;
        }
        try {
          const photos: { id: string; isDefect: boolean }[] = [];
          for (const name of item.cover ? [item.cover, ...item.photos.filter((n) => n !== item.cover)] : item.photos) {
            const buffer = await readFile(resolve(process.cwd(), 'seed-data', batch.folder, name));
            photos.push({ id: (await this.media.upload(seller.id, fileOf(buffer, name))).id, isDefect: false });
          }
          const draft = await this.listings.create(seller.id, { ...item.input, photos, deliveryOptions: ['IN_PERSON', 'DELIVERY'], acceptsOffers: true, saleType: 'FIXED' });
          try {
            // The owner checked every item by hand: the AI's objections go to the admin queue, not against the item.
            await this.listings.publish(seller.id, draft.id, { trustedPhotos: true, allowUnchecked: true, trustedContent: true });
          } catch (e) {
            await this.listings.remove(seller.id, draft.id).catch(() => undefined);
            throw e;
          }
          this.logger.log(`@${batch.username}: listed «${title}»`);
        } catch (e) {
          this.logger.warn(`@${batch.username}: «${title}» failed: ${(e as Error).message}`);
        }
      }
      // Placed in the catalogue as by an admin (marketByAdmin), so the rules for worn items never move them back; an
      // item already placed, by this or by an admin, is left as it is.
      if (batch.account?.catalog && batch.account.brandName) {
        const { count } = await this.prisma.listing.updateMany({
          where: { sellerId: seller.id, status: { not: 'DELETED' }, marketByAdmin: false },
          data: { market: 'CATALOG', marketByAdmin: true },
        });
        if (count) this.logger.log(`@${batch.username}: ${count} items moved to the catalogue`);
      }
    }
  }
}
