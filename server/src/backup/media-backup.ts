import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { withJobLock } from '../common/job-lock.js';
import { MEDIA_DIR } from '../media/storage.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';

/**
 * A copy of every photo and video in a Cloudflare R2 bucket (any S3-compatible storage). In production the media live
 * on the server's Railway volume (MEDIA_DRIVER=local), and Railway's plan keeps no backups of volumes, so one lost
 * volume would empty every listing. Files are named by UUID and never change: each night (and a few minutes after a
 * deploy) the files the bucket lacks are uploaded. A file deleted on purpose (a deleted account's photos, a replaced
 * avatar: gone from the volume AND from the database) is erased from the bucket after ERASE_AFTER_DAYS, so it leaves
 * every copy within the 15 days the privacy policy promises (planErasures). The database has its own daily dump
 * (Railway cron service «db-backup», scripts/backup); docs/BACKUPS.md has the setup and the restore.
 *
 * Off unless BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY are set.
 * BACKUP_MEDIA_PING_URL (a Healthchecks.io check) hears about every run, so a backup that stops is noticed.
 */
export const MEDIA_PREFIX = 'media/';

/** What the sync needs from the bucket. */
export interface BackupBucket {
  /** Every key under the prefix with its size. */
  list(prefix: string): Promise<Map<string, number>>;
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export function bucketFromEnv(env = process.env): BackupBucket | null {
  const { BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_BUCKET: bucket, BACKUP_S3_ACCESS_KEY_ID: accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const s3 = new S3Client({
    endpoint,
    region: 'auto',
    credentials: { accessKeyId, secretAccessKey },
    // R2 refuses the extra checksums the SDK adds to every request by default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // The SDK sets no timeout: a stalled R2 connection would hang the nightly copy (and its job lock) for good.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 120_000 },
  });
  return {
    async list(prefix) {
      const keys = new Map<string, number>();
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of page.Contents ?? []) if (o.Key) keys.set(o.Key, o.Size ?? 0);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async put(key, body) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
    async get(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** Every file under `dir`, as paths relative to it with forward slashes (the media keys). */
export async function filesUnder(dir: string, base = ''): Promise<Array<{ key: string; size: number }>> {
  const out: Array<{ key: string; size: number }> = [];
  let entries;
  try {
    entries = await readdir(join(dir, base), { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw e;
  }
  for (const e of entries) {
    const key = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await filesUnder(dir, key)));
    // A file removed while the walk runs is skipped (size -1).
    else if (e.isFile()) out.push({ key, size: (await stat(join(dir, key)).catch(() => null))?.size ?? -1 });
  }
  return out;
}

export interface SyncResult {
  files: number;
  uploaded: number;
  bytes: number;
  failed: string[];
  /** What the bucket held before this run (the erasure plan reads it). */
  stored: Map<string, number>;
  /** Every file key found on the volume. */
  present: Set<string>;
}

/**
 * Uploads the files the bucket lacks, or holds with another size. A file that fails is retried on the next run;
 * the rest go on.
 */
export async function syncMedia(bucket: BackupBucket, dir: string, concurrency = 4): Promise<SyncResult> {
  const [files, stored] = await Promise.all([filesUnder(dir), bucket.list(MEDIA_PREFIX)]);
  const todo = files.filter((f) => f.size >= 0 && stored.get(MEDIA_PREFIX + f.key) !== f.size);
  const result: SyncResult = { files: files.length, uploaded: 0, bytes: 0, failed: [], stored, present: new Set(files.map((f) => f.key)) };
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const f = todo[next++];
      try {
        const body = await readFile(join(dir, f.key));
        await bucket.put(MEDIA_PREFIX + f.key, body);
        result.uploaded += 1;
        result.bytes += body.length;
      } catch (e) {
        result.failed.push(`${f.key}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return result;
}

/** Days a file stays in the backup after it was first found gone from the volume and from the database. */
export const ERASE_AFTER_DAYS = 13;
const DAY = 24 * 3600_000;

/** The photo or video a media file belongs to: `<key>_<width>.webp` (photo variants, video posters) or `<key>.<ext>`. */
export const baseKeyOf = (file: string) => file.replace(/_\d+\.webp$/, '').replace(/\.[a-z0-9]+$/i, '');

export interface ErasurePlan {
  /** Bucket keys to delete now. */
  erase: string[];
  /** File keys newly found gone: their grace period starts. */
  start: string[];
  /** File keys with a running grace period that are back (restored file or row): the period is dropped. */
  forget: string[];
  /** Why nothing is erased this run, if so. */
  skipped?: string;
}

/**
 * Which backed-up files may leave the backup. A file is a candidate only when it is gone from the volume AND no photo or
 * video row names it, so a lost volume (rows still there) or a database restored from an older dump (files still
 * there) never empties the backup; it is erased after ERASE_AFTER_DAYS of being a candidate. As a last guard nothing
 * is erased when the volume looks empty or when more than a third of the bucket would go at once.
 */
export function planErasures(input: {
  stored: Map<string, number>;
  present: Set<string>;
  /** Base keys (baseKeyOf) that some photo or video row still uses. */
  referenced: Set<string>;
  /** Running grace periods: file key → when it was first found missing. */
  missing: Map<string, Date>;
  now: Date;
}): ErasurePlan {
  const { stored, present, referenced, missing, now } = input;
  const candidates = new Set<string>();
  for (const objectKey of stored.keys()) {
    if (!objectKey.startsWith(MEDIA_PREFIX)) continue;
    const file = objectKey.slice(MEDIA_PREFIX.length);
    if (!present.has(file) && !referenced.has(baseKeyOf(file))) candidates.add(file);
  }
  const forget = [...missing.keys()].filter((k) => !candidates.has(k));
  if (present.size === 0 && stored.size > 0) return { erase: [], start: [], forget, skipped: 'the media folder is empty: nothing is erased from the backup' };
  if (candidates.size > Math.max(50, stored.size / 3)) return { erase: [], start: [], forget, skipped: `${candidates.size} of ${stored.size} backed-up files would go at once: nothing is erased, check the volume` };
  const erase: string[] = [];
  const start: string[] = [];
  for (const file of candidates) {
    const since = missing.get(file);
    if (!since) start.push(file);
    else if (now.getTime() - since.getTime() >= ERASE_AFTER_DAYS * DAY) erase.push(MEDIA_PREFIX + file);
  }
  return { erase, start, forget };
}

const summaryOf = (r: SyncResult) =>
  `${r.files} files on the volume, ${r.uploaded} uploaded (${Math.round(r.bytes / 1024 / 1024)} MB)${r.failed.length ? `, ${r.failed.length} failed: ${r.failed.slice(0, 5).join('; ')}` : ''}`;

@Injectable()
export class MediaBackupService implements OnApplicationBootstrap {
  private readonly logger = new Logger('MediaBackup');
  private readonly bucket = bucketFromEnv();

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** Only where the media are files on this server: with MEDIA_DRIVER=s3 they already live in object storage. */
  get enabled() {
    return !!this.bucket && process.env.MEDIA_DRIVER !== 's3';
  }

  /** A run soon after every deploy, so new settings (and the first full copy) don't wait for the night. */
  onApplicationBootstrap() {
    if (this.enabled) setTimeout(() => void this.run(), 3 * 60_000).unref();
  }

  @Cron('40 3 * * *', { timeZone: 'Europe/Minsk' })
  async run() {
    if (!this.enabled) return;
    await withJobLock(this.redis, 'backup.media', 3 * 3600_000, () => this.syncNow());
  }

  async syncNow() {
    await this.ping('/start');
    let r: SyncResult;
    try {
      r = await syncMedia(this.bucket!, MEDIA_DIR);
    } catch (e) {
      await this.ping('/fail', (e as Error).message);
      throw e;
    }
    let erased = '';
    try {
      erased = await this.eraseDeleted(r);
    } catch (e) {
      // Erasing is housekeeping: the copy itself succeeded, the next night tries again.
      this.logger.error(`media backup: erasing deleted files failed: ${(e as Error).message}`);
    }
    const summary = summaryOf(r) + erased;
    if (r.failed.length) {
      // An error reaches the admins' Telegram (common/alerts.ts).
      this.logger.error(`media backup incomplete: ${summary}`);
      await this.ping('/fail', summary);
    } else {
      this.logger.log(summary);
      await this.ping('', summary);
    }
  }

  /** Deleted files leave the bucket after their grace period (planErasures). Returns a note for the run's summary. */
  private async eraseDeleted(r: SyncResult): Promise<string> {
    const bases = new Set<string>();
    for (const k of r.stored.keys()) if (k.startsWith(MEDIA_PREFIX)) bases.add(baseKeyOf(k.slice(MEDIA_PREFIX.length)));
    const referenced = new Set<string>();
    const all = [...bases];
    for (let i = 0; i < all.length; i += 1000) {
      const chunk = all.slice(i, i + 1000);
      const [photos, videos] = await Promise.all([
        this.prisma.photo.findMany({ where: { key: { in: chunk } }, select: { key: true } }),
        this.prisma.video.findMany({ where: { key: { in: chunk } }, select: { key: true } }),
      ]);
      for (const x of [...photos, ...videos]) referenced.add(x.key);
    }
    const missing = new Map((await this.prisma.mediaBackupErasure.findMany()).map((m) => [m.key, m.missingSince]));
    const plan = planErasures({ stored: r.stored, present: r.present, referenced, missing, now: new Date() });
    if (plan.forget.length) await this.prisma.mediaBackupErasure.deleteMany({ where: { key: { in: plan.forget } } });
    if (plan.skipped) {
      this.logger.error(`media backup: ${plan.skipped}`);
      return `; erasing skipped: ${plan.skipped}`;
    }
    if (plan.start.length) await this.prisma.mediaBackupErasure.createMany({ data: plan.start.map((key) => ({ key })), skipDuplicates: true });
    let erased = 0;
    for (const objectKey of plan.erase) {
      try {
        await this.bucket!.delete(objectKey);
        await this.prisma.mediaBackupErasure.delete({ where: { key: objectKey.slice(MEDIA_PREFIX.length) } });
        erased++;
      } catch (e) {
        this.logger.warn(`media backup: ${objectKey} not erased: ${(e as Error).message}`);
      }
    }
    return `; deleted files: ${plan.start.length} newly missing, ${erased} erased from the backup`;
  }

  private async ping(path: string, body = '') {
    const url = process.env.BACKUP_MEDIA_PING_URL;
    if (!url) return;
    await fetch(url + path, { method: 'POST', body, signal: AbortSignal.timeout(10_000) }).catch((e: Error) => this.logger.warn(`ping ${path || '/'}: ${e.message}`));
  }
}
