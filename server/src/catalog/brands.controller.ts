import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { brandKey, findBrandInText, searchBrands } from './brands.js';

const SuggestQuery = z.object({ q: z.string().max(60).default(''), limit: z.coerce.number().int().min(1).max(30).default(10) });
const DetectQuery = z.object({ text: z.string().max(200).default('') });

/** Brand picker for the listing form and search filters. */
@Controller('brands')
export class BrandsController {
  /** Listing counts per brand: brands people actually sell here rank higher. */
  private usage = { at: 0, counts: new Map<string, number>() };

  constructor(private readonly prisma: PrismaService) {}

  private async counts() {
    if (Date.now() - this.usage.at > 10 * 60_000) {
      this.usage.at = Date.now();
      const rows = await this.prisma.listing.groupBy({ by: ['brand'], where: { brand: { not: null }, status: { in: ['PUBLISHED', 'RESERVED', 'SOLD'] } }, _count: true });
      this.usage.counts = new Map(rows.map((r) => [brandKey(r.brand!), r._count]));
    }
    return this.usage.counts;
  }

  @Public()
  @Get()
  async suggest(@Query(new ZodPipe(SuggestQuery)) q: z.infer<typeof SuggestQuery>) {
    return { items: searchBrands(q.q, q.limit, await this.counts()) };
  }

  /** A brand named in a listing title, offered to the seller when the brand field is still empty. */
  @Public()
  @Get('detect')
  detect(@Query(new ZodPipe(DetectQuery)) q: z.infer<typeof DetectQuery>) {
    return { brand: findBrandInText(q.text)?.brand ?? null };
  }
}
