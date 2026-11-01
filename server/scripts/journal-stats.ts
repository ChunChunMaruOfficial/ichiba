/**
 * Numbers for the journal's data articles (docs/journal/briefs, rubric «Цены и данные»): what is on sale, at what
 * prices, how fast it sells — straight from the database, so every figure in an article has a source and a date.
 *
 *   npx tsx scripts/journal-stats.ts [--days 90] [--out ../docs/journal/stats/2026-11.json]
 *
 * Reads DATABASE_URL from server/.env (or the environment). Only published and sold listings count; prices are in
 * BYN as stored (integers). Medians, not averages: a few luxury items would otherwise move the «typical» price.
 * The output is JSON with `n` beside every group, so an article never quotes a median of three items as a market.
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const DAYS = Number(arg('days', '90'));
const OUT = arg('out', '');
const MIN_GROUP = 5;

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (server/.env)');
const db = new pg.Client({ connectionString: url, ssl: /sslmode=require|railway|supabase/.test(url) ? { rejectUnauthorized: false } : undefined });
await db.connect();

const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const num = (v: unknown) => (v == null ? null : Number(v));

// Live items: published, with a price, not hidden; `market` tells the shop's new goods from the second-hand side.
const LIVE = `l.status = 'PUBLISHED' AND l."hiddenByAdmin" = false AND l."hiddenByBlock" = false`;

const totals = (
  await q<{ market: string; n: string; sellers: string; median: string | null; p25: string | null; p75: string | null }>(`
  SELECT l.market, COUNT(*)::int AS n, COUNT(DISTINCT l."sellerId")::int AS sellers,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price) AS median,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY l.price) AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY l.price) AS p75
  FROM "Listing" l WHERE ${LIVE} AND l.price IS NOT NULL GROUP BY l.market ORDER BY n DESC`)
).map((r) => ({ market: r.market, n: Number(r.n), sellers: Number(r.sellers), median: num(r.median), p25: num(r.p25), p75: num(r.p75) }));

const byCategory = (
  await q<{ category: string; market: string; n: string; median: string | null; p25: string | null; p75: string | null; min: string | null; max: string | null }>(`
  SELECT l.category, l.market, COUNT(*)::int AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price) AS median,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY l.price) AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY l.price) AS p75,
         MIN(l.price) AS min, MAX(l.price) AS max
  FROM "Listing" l WHERE ${LIVE} AND l.price IS NOT NULL AND l.category IS NOT NULL
  GROUP BY l.category, l.market HAVING COUNT(*) >= $1 ORDER BY l.category, l.market`, [MIN_GROUP])
).map((r) => ({ category: r.category, market: r.market, n: Number(r.n), median: num(r.median), p25: num(r.p25), p75: num(r.p75), min: num(r.min), max: num(r.max) }));

const byBrand = (
  await q<{ brand: string; n: string; resale: string; median_resale: string | null; median_new: string | null }>(`
  SELECT lower(trim(l.brand)) AS brand, COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE l.market = 'RESALE')::int AS resale,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price) FILTER (WHERE l.market = 'RESALE') AS median_resale,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price) FILTER (WHERE l.market <> 'RESALE') AS median_new
  FROM "Listing" l WHERE ${LIVE} AND l.price IS NOT NULL AND l.brand IS NOT NULL AND trim(l.brand) <> ''
  GROUP BY lower(trim(l.brand)) HAVING COUNT(*) >= $1 ORDER BY n DESC LIMIT 40`, [MIN_GROUP])
).map((r) => ({ brand: r.brand, n: Number(r.n), resale: Number(r.resale), medianResale: num(r.median_resale), medianNew: num(r.median_new) }));

const byCondition = (
  await q<{ condition: string | null; n: string; median: string | null }>(`
  SELECT l.condition, COUNT(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price) AS median
  FROM "Listing" l WHERE ${LIVE} AND l.price IS NOT NULL AND l.market = 'RESALE' GROUP BY l.condition ORDER BY n DESC`)
).map((r) => ({ condition: r.condition, n: Number(r.n), median: num(r.median) }));

// Resale price against the price new the seller gave («−70 % от новой»): how much a category loses second-hand.
const discount = (
  await q<{ category: string; n: string; keep: string | null }>(`
  SELECT l.category, COUNT(*)::int AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price::float / l."originalPrice") AS keep
  FROM "Listing" l WHERE ${LIVE} AND l.market = 'RESALE' AND l.price IS NOT NULL AND l."originalPrice" > l.price
  GROUP BY l.category HAVING COUNT(*) >= $1 ORDER BY n DESC`, [MIN_GROUP])
).map((r) => ({ category: r.category, n: Number(r.n), keepsShareOfNewPrice: r.keep == null ? null : Math.round(Number(r.keep) * 100) / 100 }));

const sizes = (
  await q<{ system: string | null; size: string; n: string }>(`
  SELECT l."sizeSystem" AS system, l."sizeValue" AS size, COUNT(*)::int AS n
  FROM "Listing" l WHERE ${LIVE} AND l."sizeValue" IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) >= $1 ORDER BY n DESC LIMIT 30`, [MIN_GROUP])
).map((r) => ({ system: r.system, size: r.size, n: Number(r.n) }));

const colors = (await q<{ color: string; n: string }>(`SELECT lower(trim(l.color)) AS color, COUNT(*)::int AS n FROM "Listing" l WHERE ${LIVE} AND l.color IS NOT NULL AND trim(l.color) <> '' GROUP BY 1 ORDER BY n DESC LIMIT 15`)).map((r) => ({ color: r.color, n: Number(r.n) }));

const cities = (await q<{ city: string; n: string }>(`SELECT trim(l.city) AS city, COUNT(*)::int AS n FROM "Listing" l WHERE ${LIVE} AND l.city IS NOT NULL AND trim(l.city) <> '' GROUP BY 1 ORDER BY n DESC LIMIT 15`)).map((r) => ({ city: r.city, n: Number(r.n) }));

// Sold in the period: through a completed deal, with the days from publication to completion.
const sold = (
  await q<{ category: string | null; n: string; median_days: string | null; median_price: string | null }>(`
  SELECT l.category, COUNT(DISTINCT l.id)::int AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r."completedAt" - l."publishedAt")) / 86400) AS median_days,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY i.price) AS median_price
  FROM "BuyRequest" r
  JOIN "BuyRequestItem" i ON i."requestId" = r.id
  JOIN "Listing" l ON l.id = i."listingId"
  WHERE r.status = 'COMPLETED' AND r."completedAt" >= now() - ($1::int || ' days')::interval AND l."publishedAt" IS NOT NULL
  GROUP BY ROLLUP (l.category) ORDER BY n DESC`, [DAYS])
).map((r) => ({ category: r.category ?? 'all', n: Number(r.n), medianDaysToSell: r.median_days == null ? null : Math.round(Number(r.median_days) * 10) / 10, medianPrice: num(r.median_price) }));

const auctions = (
  await q<{ n: string; with_bids: string; median_bids: string | null; median_uplift: string | null }>(`
  SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE b.bids > 0)::int AS with_bids,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY b.bids) FILTER (WHERE b.bids > 0) AS median_bids,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY b.top::float / a."startPrice") FILTER (WHERE b.bids > 0) AS median_uplift
  FROM "Auction" a
  LEFT JOIN LATERAL (SELECT COUNT(*)::int AS bids, MAX(amount) AS top FROM "Bid" WHERE "auctionId" = a.id) b ON true
  WHERE a."endsAt" < now() AND a."endsAt" >= now() - ($1::int || ' days')::interval`, [DAYS])
)[0];

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  periodDays: DAYS,
  minGroup: MIN_GROUP,
  note: 'Цены в BYN, медианы по опубликованным объявлениям с ценой; группы меньше minGroup не показаны. В статье указывайте дату и n.',
  totals,
  byCategory,
  byBrand,
  byCondition,
  discountOnNewPrice: discount,
  sizes,
  colors,
  cities,
  soldLastPeriod: sold,
  auctionsLastPeriod: auctions ? { n: Number(auctions.n), withBids: Number(auctions.with_bids), medianBids: num(auctions.median_bids), medianTopOverStart: auctions.median_uplift == null ? null : Math.round(Number(auctions.median_uplift) * 100) / 100 } : null,
};

await db.end();
const json = JSON.stringify(out, null, 2);
if (OUT) {
  await writeFile(OUT, json);
  console.log(`written ${OUT}`);
} else {
  console.log(json);
}
console.error(`live: ${totals.map((t) => `${t.market} ${t.n} (median ${t.median} BYN)`).join(', ')}; sold in ${DAYS} days: ${sold.find((s) => s.category === 'all')?.n ?? 0}`);
