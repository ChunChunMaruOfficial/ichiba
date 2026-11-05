import { mkdir, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import { pathToFileURL } from 'url';
import { type BackupBucket, bucketFromEnv, filesUnder, MEDIA_PREFIX } from './media-backup.js';

/**
 * Brings the photos and videos back from the backup bucket onto the media volume: every key under media/ that is
 * missing on disk or has another size. Files already in place are left alone, so it can be run again after a break.
 *
 * On Railway, in the server's shell (`railway ssh`, service «server»), with the BACKUP_S3_* variables set:
 *     node dist/backup/media-restore.js
 * See docs/BACKUPS.md.
 */
export async function restoreMedia(bucket: BackupBucket, dir: string, log: (line: string) => void = () => {}) {
  const root = resolve(dir);
  const [stored, local] = await Promise.all([bucket.list(MEDIA_PREFIX), filesUnder(root)]);
  const have = new Map(local.map((f) => [f.key, f.size]));
  let restored = 0;
  for (const [key, size] of stored) {
    const rel = key.slice(MEDIA_PREFIX.length);
    if (!rel || have.get(rel) === size) continue;
    const path = resolve(root, rel);
    // A key from the bucket must never write outside the media folder.
    if (!path.startsWith(root + sep)) throw new Error(`refusing key outside the media folder: ${key}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await bucket.get(key));
    restored += 1;
    if (restored % 200 === 0) log(`${restored} files restored…`);
  }
  return { inBucket: stored.size, restored };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const bucket = bucketFromEnv();
  if (!bucket) {
    console.error('Set BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY first.');
    process.exit(1);
  }
  const dir = process.env.MEDIA_DIR ?? join(process.cwd(), 'storage/media');
  restoreMedia(bucket, dir, console.log)
    .then((r) => console.log(`done: ${r.restored} of ${r.inBucket} files restored into ${dir}`))
    .catch((e: Error) => {
      console.error(e.message);
      process.exit(1);
    });
}
