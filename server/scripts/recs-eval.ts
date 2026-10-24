/**
 * Offline measurement of «Для вас» (src/recommendations/taste.ts) on the items in the database.
 *
 *   npx tsx scripts/recs-eval.ts [--model marqo-fashionSigLIP@q8] [--personas 60] [--seed 1]
 *
 * Real histories are too few to measure on yet, so simulated buyers stand in for them, each with a taste the site's
 * own items define — and defined five different ways, so no one method wins by being measured on its own terms:
 *   style    — items with one style tag (what the trait rules see);
 *   shop     — the items of one seller (a wardrobe has a look of its own);
 *   look     — an item and its 25 nearest by photo (what the vectors see);
 *   kindprice — one category in one price third;
 *   mixed    — two of the above at once, mixed3 — three, long — three with 10 actions each (the case for
 *              several tastes per person).
 * A buyer acts on a few items of the taste (views, saves, carts, requests over 10 days) and scrolls three random
 * items; the rest of the taste is held out. Scores: how much of it is on the first page (recall@24), how high
 * (nDCG@24), and how alike the first page looks (mean pairwise photo similarity, lower is more varied).
 * Also runs on real histories that have 3+ saves/requests: the latest is held out, the rest is the history.
 * Then «Похожие» on the item page: from one item of a taste, the share of the first 8 from the same taste.
 */
import 'dotenv/config';
import pg from 'pg';
import { buildProfile, kindOf, meanVector, rankForYou, score, SIGNAL_WEIGHTS, spread, traitFit, type TasteEvent, type TasteInput, type Traits } from '../src/recommendations/taste.js';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const MODEL = arg('model', 'marqo-fashionSigLIP@q8');
const PERSONAS = Number(arg('personas', '60'));
let seed = Number(arg('seed', '1'));
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const shuffle = <T>(xs: T[]) => xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
const K = 24;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows: listingRows } = await db.query(`
  SELECT id, "sellerId", category, subcategory, brand, color, "sizeValue", sizes, "styleTags", gender::text, price, "publishedAt",
         "viewsCount", "favoritesCount", status::text, market::text
  FROM "Listing" WHERE status IN ('PUBLISHED', 'RESERVED', 'SOLD')`);
const { rows: photoRows } = await db.query(
  `SELECT p."listingId", v.vec FROM "Photo" p JOIN "PhotoVector" v ON v.key = p.key AND v.model = $1 WHERE NOT p."isDefect" AND length(v.vec) > 0`,
  [MODEL],
);
const { rows: signalRows } = await db.query(`SELECT "userId", "listingId", type, weight, "createdAt" FROM "Signal" ORDER BY "createdAt"`);
await db.end();

type Item = Traits & { viewsCount: number; favoritesCount: number; status: string; market: string };
const all: Item[] = listingRows.map((r) => ({ ...r, styleTags: r.styleTags ?? [], sizes: r.sizes ?? [], price: r.price == null ? null : Number(r.price) }));
const byId = new Map(all.map((l) => [l.id, l]));
const photoVecs = new Map<string, Float32Array[]>();
for (const r of photoRows) {
  const b: Buffer = r.vec;
  (photoVecs.get(r.listingId) ?? photoVecs.set(r.listingId, []).get(r.listingId)!).push(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
}
const vectors = new Map<string, Float32Array>();
for (const [id, vs] of photoVecs) vectors.set(id, meanVector(vs)!);
const onSale = all.filter((l) => l.status !== 'SOLD');
const popularity = new Map(onSale.map((c) => [c.id, c.viewsCount + 4 * c.favoritesCount]));
console.log(`${onSale.length} items on sale, ${vectors.size} with vectors (${MODEL}), ${signalRows.length} signals`);

// ---------- tastes ----------

const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
const groups = {
  style: () => {
    const tags = [...new Set(onSale.flatMap((l) => l.styleTags))].filter((t) => onSale.filter((l) => l.styleTags.includes(t)).length >= 10);
    const t = pick(tags);
    return onSale.filter((l) => l.styleTags.includes(t));
  },
  shop: () => {
    const counts = new Map<string, number>();
    for (const l of onSale) counts.set(l.sellerId, (counts.get(l.sellerId) ?? 0) + 1);
    // A seller with everything (an imported catalogue) has no one look.
    const sellers = [...counts].filter(([, n]) => n >= 10 && n <= 60).map(([s]) => s);
    const s = pick(sellers);
    return onSale.filter((l) => l.sellerId === s);
  },
  look: () => {
    const withVec = onSale.filter((l) => vectors.has(l.id));
    const seedItem = pick(withVec);
    const v = vectors.get(seedItem.id)!;
    return withVec.map((l) => [cos(v, vectors.get(l.id)!), l] as const).sort((a, b) => b[0] - a[0]).slice(0, 26).map((p) => p[1]);
  },
  kindprice: () => {
    const cats = [...new Set(onSale.map((l) => l.category))].filter((c) => onSale.filter((l) => l.category === c && l.price).length >= 15);
    const c = pick(cats);
    const items = onSale.filter((l) => l.category === c && l.price).sort((a, b) => a.price! - b.price!);
    const third = Math.floor(rand() * 3);
    return items.slice(Math.floor((third * items.length) / 3), Math.floor(((third + 1) * items.length) / 3));
  },
};
type Kind = keyof typeof groups | 'mixed' | 'mixed3' | 'long';

interface Case {
  kind: Kind;
  events: TasteEvent[];
  held: Set<string>;
  seen: Set<string>;
}

const now = Date.now();
const DAY = 24 * 3600 * 1000;
function actOn(items: Item[]): TasteEvent[] {
  return items.map((l) => {
    const r = rand();
    const type = r < 0.55 ? 'view' : r < 0.8 ? 'favorite' : r < 0.92 ? 'cart' : 'request';
    return { type, weight: SIGNAL_WEIGHTS[type], at: now - rand() * 10 * DAY, listing: l };
  });
}
function makeCase(kind: Kind): Case | null {
  const anyKind = () => pick(['style', 'shop', 'look', 'kindprice'] as const);
  const parts = kind === 'mixed' ? [pick(['style', 'shop', 'kindprice'] as const), pick(['look', 'shop', 'style'] as const)] : kind === 'mixed3' || kind === 'long' ? [anyKind(), anyKind(), anyKind()] : [kind];
  const events: TasteEvent[] = [];
  const held = new Set<string>();
  const seen = new Set<string>();
  for (const p of parts) {
    const g = shuffle(groups[p]());
    const nTrain = kind === 'long' ? 10 : kind === 'mixed3' ? 5 : parts.length > 1 ? 4 : 6;
    if (g.length < nTrain + 4) return null;
    const train = g.slice(0, nTrain);
    events.push(...actOn(train));
    for (const l of train) seen.add(l.id);
    for (const l of g.slice(nTrain)) held.add(l.id);
  }
  // Noise: a few items opened by accident.
  for (const l of shuffle(onSale).slice(0, 3)) {
    events.push({ type: 'view', weight: 1, at: now - rand() * 10 * DAY, listing: l });
    seen.add(l.id);
  }
  for (const id of seen) held.delete(id);
  return { kind, events, held, seen };
}

// ---------- rankers ----------

type Ranker = (input: TasteInput, candidates: Item[]) => Item[];
/** The old merge: every 5th slot from the popular rest. */
function feedOrderBefore(ranked: Array<{ item: Item; score: number; matched: boolean }>, popularity: Map<string, number>): Item[] {
  const matched = ranked.filter((r) => r.matched);
  const rest = ranked.filter((r) => !r.matched).sort((a, b) => (popularity.get(b.item.id) ?? 0) - (popularity.get(a.item.id) ?? 0) || b.score - a.score);
  const merged: Item[] = [];
  while (matched.length || rest.length) merged.push((rest.length && (!matched.length || (merged.length + 1) % 5 === 0) ? rest.shift() : matched.shift())!.item);
  return merged;
}

const rankers: Record<string, Ranker> = {
  /** The feed before photo vectors: trait rules on their raw scale, every 5th slot popular, strict variety. */
  'before (rules)': (input, candidates) => {
    const profile = buildProfile({ ...input, vectors: new Map() });
    const maxPop = Math.max(1, ...input.popularity.values());
    const ranked = candidates
      .filter((c) => !profile.hidden.has(c.id))
      .map((c) => {
        const fit = traitFit(profile, c);
        return { item: c, score: fit + ((input.popularity.get(c.id) ?? 0) / maxPop) * 0.8, matched: fit >= 1 };
      })
      .sort((a, b) => b.score - a.score);
    return spread(feedOrderBefore(ranked, input.popularity));
  },
  'score only, no feed rules': (input, c) => score(input, buildProfile(input), c).map((r) => r.item),
  'after (taste.ts)': (input, c) => rankForYou(input, c),
  'after, traits only': (input, c) => rankForYou({ ...input, vectors: new Map() }, c),
};

function evaluate(ranked: Item[], c: Case) {
  const list = ranked.filter((l) => !c.seen.has(l.id));
  const top = list.slice(0, K);
  const hits = top.map((l) => c.held.has(l.id));
  const recall = hits.filter(Boolean).length / Math.min(K, c.held.size);
  const dcg = hits.reduce((s, h, i) => s + (h ? 1 / Math.log2(i + 2) : 0), 0);
  const idcg = Array.from({ length: Math.min(K, c.held.size) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  const vs = top.map((l) => vectors.get(l.id)).filter((v): v is Float32Array => !!v);
  let sim = 0;
  let pairs = 0;
  for (let i = 0; i < vs.length; i++)
    for (let j = i + 1; j < vs.length; j++) {
      sim += cos(vs[i], vs[j]);
      pairs++;
    }
  let run = 1;
  let maxRun = 1;
  for (let i = 1; i < top.length; i++) maxRun = Math.max(maxRun, (run = kindOf(top[i]) === kindOf(top[i - 1]) ? run + 1 : 1));
  return { recall, ndcg: dcg / idcg, alike: pairs ? sim / pairs : 0, kinds: new Set(top.map(kindOf)).size, maxRun };
}

const cases: Case[] = [];
for (const kind of ['style', 'shop', 'look', 'kindprice', 'mixed', 'mixed3', 'long'] as Kind[]) {
  let made = 0;
  for (let tries = 0; made < PERSONAS && tries < PERSONAS * 5; tries++) {
    const c = makeCase(kind);
    if (!c) continue;
    cases.push(c);
    made++;
  }
}

// Real histories: the latest save / cart / request is held out.
const byUser = new Map<string, typeof signalRows>();
for (const s of signalRows) (byUser.get(s.userId) ?? byUser.set(s.userId, []).get(s.userId)!).push(s);
for (const [, sig] of byUser) {
  const strong = sig.filter((s) => ['favorite', 'cart', 'request', 'swipe_right'].includes(s.type) && byId.get(s.listingId)?.status !== 'SOLD');
  if (strong.length < 3) continue;
  const last = strong.at(-1)!;
  const history = sig.filter((s) => s.createdAt < last.createdAt && s.listingId !== last.listingId);
  cases.push({
    kind: 'real' as Kind,
    events: history.map((s) => ({ type: s.type, weight: s.weight, at: new Date(s.createdAt).getTime(), listing: s.listingId ? byId.get(s.listingId) : null })),
    held: new Set([last.listingId]),
    seen: new Set(history.map((s) => s.listingId).filter(Boolean)),
  });
}

const kinds = [...new Set(cases.map((c) => c.kind))];
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\n${cases.length} buyers: ${kinds.map((k) => `${k} ${cases.filter((c) => c.kind === k).length}`).join(', ')}\n`);
console.log(pad('ranker', 32) + kinds.map((k) => pad(k, 14)).join('') + pad('ALL r@24', 10) + pad('nDCG', 8) + pad('alike', 8) + pad('kinds', 7) + 'run');
for (const [name, rank] of Object.entries(rankers)) {
  const started = Date.now();
  const res = cases.map((c) => {
    const input: TasteInput = { now, events: c.events, vectors, followed: new Set(), sizes: [], popularity };
    return { kind: c.kind, ...evaluate(rank(input, onSale), c) };
  });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const cells = kinds.map((k) => pad(`${(mean(res.filter((r) => r.kind === k).map((r) => r.recall)) * 100).toFixed(1)}%`, 14));
  const ms = (Date.now() - started) / cases.length;
  console.log(
    pad(name, 32) + cells.join('') + pad(`${(mean(res.map((r) => r.recall)) * 100).toFixed(1)}%`, 10) + pad(mean(res.map((r) => r.ndcg)).toFixed(3), 8) + pad(mean(res.map((r) => r.alike)).toFixed(3), 8) + pad(mean(res.map((r) => r.kinds)).toFixed(1), 7) + mean(res.map((r) => r.maxRun)).toFixed(1) + `   ${ms.toFixed(1)} ms`,
  );
}

// ---------- «Похожие» on the item page ----------
// From one item of a taste, how much of the first 8 «Похожие» is from the same taste (precision@8).

const { rows: hashRows } = await (async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(`SELECT DISTINCT ON ("listingId") "listingId", dhash FROM "Photo" WHERE "listingId" IS NOT NULL ORDER BY "listingId", "isCover" DESC, "order"`);
  await c.end();
  return r;
})();
const dhash = new Map<string, string | null>(hashRows.map((r) => [r.listingId, r.dhash]));
const hashDist = (a: string, b: string) => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
};
function similarScores(src: Item, lookWeight: number, useHash: boolean) {
  const rows = onSale.filter((l) => l.id !== src.id && l.category === src.category);
  const sv = vectors.get(src.id);
  const sims = rows.map((l) => (sv && vectors.has(l.id) ? cos(sv, vectors.get(l.id)!) : null));
  const known = sims.filter((x): x is number => x != null);
  const m = known.reduce((a, b) => a + b, 0) / (known.length || 1);
  const sd = Math.sqrt(known.reduce((a, b) => a + (b - m) ** 2, 0) / (known.length || 1)) || 1;
  const price = src.price ?? 0;
  return rows
    .map((l, i) => {
      let s = 0;
      if (src.subcategory && l.subcategory === src.subcategory) s += 3;
      if (src.brand && l.brand && l.brand.toLowerCase() === src.brand.toLowerCase()) s += 2;
      if (src.color && l.color === src.color) s += 1.5;
      if (src.gender && (l.gender === src.gender || l.gender == null || l.gender === 'UNISEX')) s += 0.5;
      if (src.sizeValue && l.sizeValue === src.sizeValue) s += 0.5;
      if (price && l.price) s -= Math.min(2, Math.abs(l.price - price) / price) * 1.5;
      const [a, b] = [dhash.get(src.id), dhash.get(l.id)];
      if (useHash && a && b && /^[0-9a-f]{16}$/.test(a) && /^[0-9a-f]{16}$/.test(b)) s += Math.max(0, (20 - hashDist(a, b)) / 20) * 2;
      if (sims[i] != null) s += lookWeight * ((sims[i]! - m) / sd);
      return { l, s };
    })
    .sort((x, y) => y.s - x.s)
    .map((x) => x.l);
}
const simCases: Array<{ kind: string; src: Item; group: Set<string> }> = [];
for (const kind of ['style', 'shop', 'look', 'kindprice'] as const)
  for (let i = 0; i < PERSONAS; i++) {
    const g = groups[kind]();
    if (g.length < 6) continue;
    const src = pick(g);
    simCases.push({ kind, src, group: new Set(g.filter((l) => l.id !== src.id).map((l) => l.id)) });
  }
console.log(`\n«Похожие»: ${simCases.length} items, share of the first 8 from the same taste`);
const simKinds = ['style', 'shop', 'look', 'kindprice'];
console.log(pad('ranker', 32) + simKinds.map((k) => pad(k, 14)).join('') + 'ALL');
for (const [name, lw, hash] of [['before (traits + hash)', 0, true], ['+ look 1', 1, true], ['+ look 2', 2, true], ['+ look 3', 3, true], ['+ look 2, no hash', 2, false], ['+ look 3, no hash', 3, false]] as const) {
  const res = simCases.map((c) => {
    const top = similarScores(c.src, lw, hash).slice(0, 8);
    return { kind: c.kind, p: top.filter((l) => c.group.has(l.id)).length / Math.max(1, Math.min(8, top.length)) };
  });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  console.log(pad(name, 32) + simKinds.map((k) => pad(`${(mean(res.filter((r) => r.kind === k).map((r) => r.p)) * 100).toFixed(1)}%`, 14)).join('') + `${(mean(res.map((r) => r.p)) * 100).toFixed(1)}%`);
}
