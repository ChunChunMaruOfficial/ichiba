import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { withJobLock } from '../common/job-lock.js';
import { MEDIA_DIR } from '../media/storage.js';
import { RedisService } from '../redis/redis.js';

/**
 * A copy of every photo and video in a Cloudflare R2 bucket (any S3-compatible storage). In production the media live
 * on the server's Railway volume (MEDIA_DRIVER=local), and Railway's plan keeps no backups of volumes, so one lost
 * volume would empty every listing. Files are named by UUID and never change: each night (and a few minutes after a
 * deploy) the files the bucket lacks are uploaded, nothing is ever deleted from it. The database has its own daily
 * dump (Railway cron service «db-backup», scripts/backup); docs/BACKUPS.md has the setup and the restore.
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
}

/**
 * Uploads the files the bucket lacks, or holds with another size. A file that fails is retried on the next run;
 * the rest go on.
 */
export async function syncMedia(bucket: BackupBucket, dir: string, concurrency = 4): Promise<SyncResult> {
  const [files, stored] = await Promise.all([filesUnder(dir), bucket.list(MEDIA_PREFIX)]);
  const todo = files.filter((f) => f.size >= 0 && stored.get(MEDIA_PREFIX + f.key) !== f.size);
  const result: SyncResult = { files: files.length, uploaded: 0, bytes: 0, failed: [] };
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

const summaryOf = (r: SyncResult) =>
  `${r.files} files on the volume, ${r.uploaded} uploaded (${Math.round(r.bytes / 1024 / 1024)} MB)${r.failed.length ? `, ${r.failed.length} failed: ${r.failed.slice(0, 5).join('; ')}` : ''}`;

@Injectable()
export class MediaBackupService implements OnApplicationBootstrap {
  private readonly logger = new Logger('MediaBackup');
  private readonly bucket = bucketFromEnv();

  constructor(private readonly redis: RedisService) {}

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
    const summary = summaryOf(r);
    if (r.failed.length) {
      // An error reaches the admins' Telegram (common/alerts.ts).
      this.logger.error(`media backup incomplete: ${summary}`);
      await this.ping('/fail', summary);
    } else {
      this.logger.log(summary);
      await this.ping('', summary);
    }
  }

  private async ping(path: string, body = '') {
    const url = process.env.BACKUP_MEDIA_PING_URL;
    if (!url) return;
    await fetch(url + path, { method: 'POST', body, signal: AbortSignal.timeout(10_000) }).catch((e: Error) => this.logger.warn(`ping ${path || '/'}: ${e.message}`));
  }
}
