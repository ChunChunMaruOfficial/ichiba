import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type BackupBucket, syncMedia } from '../../src/backup/media-backup.js';
import { restoreMedia } from '../../src/backup/media-restore.js';

/** A bucket in memory; an upload of a key in `failOn` throws. */
function memoryBucket(failOn = new Set<string>()) {
  const objects = new Map<string, Buffer>();
  const puts: string[] = [];
  const bucket: BackupBucket = {
    list: async (prefix) => new Map([...objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, v.length])),
    put: async (key, body) => {
      if (failOn.has(key)) throw new Error('network');
      puts.push(key);
      objects.set(key, body);
    },
    get: async (key) => objects.get(key)!,
  };
  return { bucket, objects, puts };
}

async function mediaDir(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'media-'));
  for (const [key, body] of Object.entries(files)) {
    await mkdir(dirname(join(dir, key)), { recursive: true });
    await writeFile(join(dir, key), body);
  }
  return dir;
}

test('the first run copies every file under media/, the next one only what is new or changed in size', async () => {
  const dir = await mediaDir({ 'a/1_320.webp': 'one', 'a/1_640.webp': 'one-big', 'b/2.mp4': 'video' });
  const { bucket, objects, puts } = memoryBucket();
  const first = await syncMedia(bucket, dir);
  assert.deepEqual({ files: first.files, uploaded: first.uploaded, failed: first.failed }, { files: 3, uploaded: 3, failed: [] });
  assert.equal(objects.get('media/a/1_640.webp')?.toString(), 'one-big');

  puts.length = 0;
  await writeFile(join(dir, 'c_new.webp'), 'new');
  await writeFile(join(dir, 'a/1_320.webp'), 'one, re-encoded');
  const second = await syncMedia(bucket, dir);
  assert.equal(second.uploaded, 2);
  assert.deepEqual(puts.sort(), ['media/a/1_320.webp', 'media/c_new.webp']);

  // Nothing is deleted from the backup when a file leaves the volume.
  await rm(join(dir, 'b'), { recursive: true });
  await syncMedia(bucket, dir);
  assert.ok(objects.has('media/b/2.mp4'));
  await rm(dir, { recursive: true });
});

test('a failed upload is reported and retried next time; the others go on', async () => {
  const dir = await mediaDir({ 'x.webp': 'x', 'y.webp': 'y' });
  const fail = new Set(['media/x.webp']);
  const { bucket, objects } = memoryBucket(fail);
  const r = await syncMedia(bucket, dir);
  assert.equal(r.uploaded, 1);
  assert.match(r.failed[0], /^x\.webp: network/);
  fail.clear();
  assert.equal((await syncMedia(bucket, dir)).uploaded, 1);
  assert.ok(objects.has('media/x.webp'));
  await rm(dir, { recursive: true });
});

test('a missing media folder is an empty one', async () => {
  const { bucket } = memoryBucket();
  assert.deepEqual(await syncMedia(bucket, join(tmpdir(), 'no-such-media-dir-ichiba')), { files: 0, uploaded: 0, bytes: 0, failed: [] });
});

test('restore puts back what the volume lost and leaves the rest', async () => {
  const src = await mediaDir({ 'a/1.webp': 'one', 'a/2.webp': 'two', 'b/3.webp': 'three' });
  const { bucket } = memoryBucket();
  await syncMedia(bucket, src);
  const dst = await mediaDir({ 'a/1.webp': 'one' });
  assert.deepEqual(await restoreMedia(bucket, dst), { inBucket: 3, restored: 2 });
  assert.equal((await readFile(join(dst, 'b/3.webp'))).toString(), 'three');
  assert.deepEqual(await restoreMedia(bucket, dst), { inBucket: 3, restored: 0 });
  await rm(src, { recursive: true });
  await rm(dst, { recursive: true });
});

test('restore refuses a key that would write outside the media folder', async () => {
  const dst = await mediaDir({});
  const bucket: BackupBucket = { list: async () => new Map([['media/../../evil.txt', 4]]), put: async () => {}, get: async () => Buffer.from('evil') };
  await assert.rejects(restoreMedia(bucket, dst), /outside the media folder/);
  await rm(dst, { recursive: true });
});
