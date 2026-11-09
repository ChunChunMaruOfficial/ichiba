// Runs the Maestro web flows against the e2e stand (README.md): picks a real item from the stand's database for the
// flows to look for, makes an unsubscribe token for a seeded account, then starts Maestro.
//   node e2e/maestro/run.mjs [flow.yaml …]
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'server', 'package.json'));
const pg = require('pg');
const jwt = require('jsonwebtoken');

const DB = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:51310/template1?sslmode=disable';
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100';
const API_URL = process.env.API_URL ?? 'http://localhost:4100';
const SECRET = process.env.JWT_SECRET ?? 'e2e-only-secret-e2e-only-secret-e2e-only';
const MAESTRO = process.env.MAESTRO ?? 'D:\\tools\\maestro\\bin\\maestro.bat';

const db = new pg.Client({ connectionString: DB });
await db.connect();
// The newest plain item: fixed price under 1000 (no thousands separator to match), one size, a photo, a visible seller.
const { rows } = await db.query(`
  SELECT l.id, l.title, l.price FROM "Listing" l JOIN "User" u ON u.id = l."sellerId"
  WHERE l.status = 'PUBLISHED' AND l."saleType" <> 'AUCTION' AND NOT l."priceNegotiable" AND l.price IS NOT NULL AND l.price < 1000
    AND cardinality(l.sizes) <= 1 AND u."listingsHiddenAt" IS NULL AND u."deletedAt" IS NULL
    AND EXISTS (SELECT 1 FROM "Photo" p WHERE p."listingId" = l.id)
  ORDER BY l."liftedAt" DESC NULLS LAST, l."publishedAt" DESC LIMIT 1`);
if (!rows.length) throw new Error('No published item in the e2e database: seed it first (README.md)');
const item = rows[0];
const kate = (await db.query(`UPDATE "User" SET "notifyEmail" = 'kate-notify@ichiba.test' WHERE username = 'kate' RETURNING id`)).rows[0];
await db.end();

const word = item.title.split(/[\s,.«»"()—-]+/).find((w) => w.length > 3) ?? item.title;
const vars = {
  BASE_URL,
  API_URL,
  ITEM_ID: item.id,
  // Maestro reads texts as regular expressions: the title's own dots and brackets are escaped.
  ITEM_TITLE: item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ITEM_PRICE: `.*${Number(item.price)} BYN.*`,
  SEARCH_WORD: word,
  // A JWT is URL-safe as it is (base64url and dots).
  UNSUB_TOKEN: jwt.sign({ sub: kate.id, purpose: 'unsubscribe' }, SECRET, { expiresIn: '1h' }),
};
console.log(`item «${item.title}» (${item.price} BYN), search «${word}»`);

const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const flows = process.argv.slice(2).length ? process.argv.slice(2).map((f) => join(here, f)) : [here];
const args = ['test', '--format', 'junit', '--output', join(out, 'report.xml'), '--test-output-dir', out, ...Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]), ...flows];
// A .bat needs a shell on Windows: every argument is quoted for cmd (titles have spaces).
const quoted = args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`);
// Selenium Manager downloads Chrome for Testing + chromedriver (no Chrome on this machine) and unpacks itself into the
// temp folder: both go to D:, drive C has no room for them.
const TOOLS = process.env.E2E_TOOLS ?? 'D:\\tools';
const tmp = join(TOOLS, 'tmp');
mkdirSync(tmp, { recursive: true });
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME ?? 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot',
  SE_CACHE_PATH: process.env.SE_CACHE_PATH ?? join(TOOLS, 'selenium-cache'),
  TEMP: tmp,
  TMP: tmp,
  JAVA_OPTS: `${process.env.JAVA_OPTS ?? ''} -Djava.io.tmpdir=${tmp}`.trim(),
};
const r = spawnSync(`"${MAESTRO}"`, quoted, { stdio: 'inherit', shell: true, env });
process.exit(r.status ?? 1);
