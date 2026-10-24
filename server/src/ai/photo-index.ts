import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withJobLock } from '../common/job-lock.js';
import type { PhotoProvider } from '../generated/prisma/client.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import { ImageEmbedder, ImageEmbedders, vectorFromBytes, vectorToBytes } from './embeddings.js';

/**
 * Vectors of every photo of the listings on sale, per embedder (ai/embeddings.ts), for search by photo.
 * A background job embeds new photos a minute or so after they're published; the vectors are kept in memory and
 * compared by brute force — a few thousand photos take a millisecond or two, no vector index needed at this size.
 */

const BATCH = 4;
/** One run of the job stops starting new batches after this: the next minute picks up the rest. */
const RUN_MS = 45_000;
/** How often a search re-reads vectors written since the last read (by this or another instance). */
const REFRESH_MS = 30_000;

interface Space {
  vectors: Map<string, Float32Array>;
  loadedAt: Date | null;
  refreshedAt: number;
  loading: Promise<void> | null;
}

@Injectable()
export class PhotoIndex {
  private readonly logger = new Logger('PhotoIndex');
  private readonly spaces = new Map<string, Space>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly redis: RedisService,
    readonly embedders: ImageEmbedders,
  ) {}

  /** The vectors of one model by photo key, fresh within REFRESH_MS. */
  async vectors(model: string): Promise<Map<string, Float32Array>> {
    let space = this.spaces.get(model);
    if (!space) this.spaces.set(model, (space = { vectors: new Map(), loadedAt: null, refreshedAt: 0, loading: null }));
    if (Date.now() - space.refreshedAt > REFRESH_MS) {
      const s = space;
      s.loading ??= this.read(model, s).finally(() => (s.loading = null));
      await s.loading;
    }
    return space.vectors;
  }

  private async read(model: string, space: Space) {
    const startedAt = new Date();
    const rows = await this.prisma.photoVector.findMany({
      where: { model, ...(space.loadedAt ? { createdAt: { gte: new Date(space.loadedAt.getTime() - 5_000) } } : {}) },
      select: { key: true, vec: true },
    });
    for (const r of rows) if (r.vec.length) space.vectors.set(r.key, vectorFromBytes(r.vec));
    space.loadedAt = startedAt;
    space.refreshedAt = Date.now();
  }

  /** Embeds photos of the listings on sale that have no vector yet, newest first. */
  @Cron(CronExpression.EVERY_MINUTE)
  async backfill() {
    await withJobLock(this.redis, 'ai.photoIndex', 2 * 60_000, async () => {
      const deadline = Date.now() + RUN_MS;
      await Promise.all(this.embedders.all.map((e) => this.backfillWith(e, deadline)));
    });
  }

  private async backfillWith(embedder: ImageEmbedder, deadline: number) {
    let done = 0;
    let failed = 0;
    while (Date.now() < deadline && embedder.available()) {
      const rows = await this.prisma.$queryRaw<Array<{ key: string; provider: PhotoProvider }>>`
        SELECT p."key", MIN(p."provider"::text)::"PhotoProvider" AS "provider"
        FROM "Photo" p JOIN "Listing" l ON l."id" = p."listingId"
        WHERE l."status" IN ('PUBLISHED', 'RESERVED') AND NOT p."isDefect"
          AND NOT EXISTS (SELECT 1 FROM "PhotoVector" v WHERE v."key" = p."key" AND v."model" = ${embedder.id})
        GROUP BY p."key"
        ORDER BY MAX(p."createdAt") DESC
        LIMIT ${BATCH}`;
      if (!rows.length) break;
      // An unreadable photo gets an empty vector, so it isn't tried again.
      const images = await Promise.all(rows.map((r) => this.media.imageForAi(r, 512).catch(() => null)));
      const readable = rows.flatMap((r, i) => (images[i] ? [{ key: r.key, image: images[i] }] : []));
      let vecs: Float32Array[];
      try {
        vecs = readable.length ? await embedder.embed(readable.map((r) => r.image), false) : [];
      } catch (e) {
        this.logger.warn(`${embedder.id}: ${(e as Error).message}`);
        break;
      }
      const byKey = new Map(readable.map((r, i) => [r.key, vecs[i]]));
      await this.prisma.photoVector.createMany({
        data: rows.map((r) => ({ key: r.key, model: embedder.id, vec: byKey.has(r.key) ? vectorToBytes(byKey.get(r.key)!) : new Uint8Array(0) })),
        skipDuplicates: true,
      });
      done += readable.length;
      failed += rows.length - readable.length;
    }
    if (done || failed) this.logger.log(`${embedder.id}: ${done} photos indexed${failed ? `, ${failed} unreadable` : ''}`);
  }
}
