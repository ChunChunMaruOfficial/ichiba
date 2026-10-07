/**
 * Adds demo auctions to an already seeded database (decision D16): a few ending soon, one with a
 * reserve, one nobody bid on. Safe to re-run: items that already had an auction are skipped.
 *
 *   npx tsx prisma/seed-auctions.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { defaultStep } from '../src/auctions/rules.js';
import { assertDemoSeedAllowed } from './demo-guard.js';

assertDemoSeedAllowed();

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }) });
const HOUR = 3600 * 1000;

async function main() {
  const bidders = await prisma.user.findMany({ where: { username: { in: ['buyer', 'nastya', 'igor', 'sveta'] } } });
  const candidates = await prisma.listing.findMany({
    where: { status: 'PUBLISHED', saleType: 'FIXED', auctions: { none: {} }, price: { gte: 40 }, requestItems: { none: {} }, offers: { none: {} }, seller: { username: { in: ['vintage_by', 'sneakerhead', 'secondhand_hub', 'stylist_anna', 'lena_v', 'den'] } } },
    orderBy: { price: 'desc' },
    take: 10,
  });
  // [hours left, number of bids, reserve multiplier or null]
  const plans: Array<[number, number, number | null]> = [
    [0.3, 6, null], [2, 4, null], [5, 3, 1.6], [20, 2, null], [30, 5, null], [50, 1, null], [70, 0, null], [100, 3, null], [140, 2, 1.3], [160, 0, null],
  ];
  let created = 0;
  for (const [i, l] of candidates.entries()) {
    const [hoursLeft, bidCount, reserve] = plans[i];
    const start = Math.round((l.price! * 0.6) / 5) * 5 || 5;
    const step = defaultStep(start);
    const total = hoursLeft > 100 ? 168 : hoursLeft > 24 ? 72 : 24;
    await prisma.listing.update({ where: { id: l.id }, data: { saleType: 'AUCTION', price: start, auctionStep: step, auctionHours: total, auctionReserve: reserve ? Math.round(start * reserve) : null, previousPrice: null } });
    const startsAt = new Date(Date.now() - (total - hoursLeft) * HOUR);
    const a = await prisma.auction.create({
      data: { listingId: l.id, startPrice: start, step, reservePrice: reserve ? Math.round(start * reserve) : null, startsAt, endsAt: new Date(Date.now() + hoursLeft * HOUR), createdAt: startsAt },
    });
    let amount = start;
    for (let b = 0; b < bidCount; b++) {
      const bidder = bidders[(i + b) % bidders.length];
      await prisma.bid.create({ data: { auctionId: a.id, bidderId: bidder.id, amount, createdAt: new Date(startsAt.getTime() + (b + 1) * HOUR) } });
      amount += step * (1 + (b % 2));
    }
    created++;
  }
  console.log(`Created ${created} auctions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
