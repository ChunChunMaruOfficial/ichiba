// Removes from seed-data the photos of hand-batch items that are already listed on prod: once listed, their photos
// live in the media store and the import never reads the files again (setCover skips a missing file). Each removed file
// goes to seed-data/purged.txt, which the hand-listings test accepts in place of the file.
// An item counts as listed when its title is in the seller's public wardrobe (published, reserved or sold) — items
// hidden or deleted keep their files. Run after the deploy that lists them has finished its import:
//   npx tsx scripts/purge-listed-photos.ts            (dry run)
//   npx tsx scripts/purge-listed-photos.ts --apply
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BATCHES } from '../src/listings/hand-batches.js';

// The API as the site serves it (the Next.js rewrite); API_URL points it elsewhere.
const API = process.env.API_URL ?? 'https://ichiba.by/api';
const SEED = resolve(import.meta.dirname, '../seed-data');
const LIST = resolve(SEED, 'purged.txt');
const apply = process.argv.includes('--apply');

async function publicTitles(username: string) {
  const titles = new Set<string>();
  for (let offset = 0; ; ) {
    const res = await fetch(`${API}/wardrobes/${encodeURIComponent(username)}?section=all&offset=${offset}`);
    if (!res.ok) throw new Error(`@${username}: ${res.status}`);
    const page = (await res.json()) as { items: { title: string }[]; hasMore: boolean; nextOffset: number | null };
    for (const it of page.items) titles.add(it.title);
    if (!page.hasMore || page.nextOffset == null) return titles;
    offset = page.nextOffset;
  }
}

const purged = new Set(existsSync(LIST) ? readFileSync(LIST, 'utf8').split('\n').filter(Boolean) : []);
let files = 0, bytes = 0;
for (const batch of BATCHES) {
  const live = await publicTitles(batch.username);
  let listed = 0, kept = 0;
  for (const item of batch.items) {
    if (!live.has(item.input.title!)) { kept++; continue; }
    listed++;
    for (const name of item.photos) {
      const path = resolve(SEED, batch.folder, name);
      if (!existsSync(path)) continue;
      files++;
      bytes += readFileSync(path).length;
      if (apply) unlinkSync(path);
      purged.add(`${batch.folder}/${name}`);
    }
  }
  console.log(`@${batch.username}: ${listed} listed, ${kept} not on the site (files kept)`);
}
console.log(`${apply ? 'removed' : 'would remove'} ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
if (apply) writeFileSync(LIST, [...purged].sort().join('\n') + '\n');
