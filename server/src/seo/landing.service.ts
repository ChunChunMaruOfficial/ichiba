import { Controller, Get, Injectable, NotFoundException, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildLandings, type Landing, landingCrumbs, landingLinks, landingStats, landingText, type LiveRow, normalizeLandingPath } from './landing.js';

/** How long the set of pages and their counts are reused: crawlers and item pages ask often, listings change slowly. */
const INDEX_TTL_MS = 10 * 60_000;
/** Items shown per section of a page; the rest are a search away («Смотреть все»). */
const SECTION_ITEMS = 40;

/** Brand and category pages (landing.ts): which exist, and one page's text and items. */
@Injectable()
export class LandingService {
  private index: { at: number; pages: Promise<Map<string, Landing>> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private pages() {
    if (!this.index || Date.now() - this.index.at > INDEX_TTL_MS) {
      const pages = this.load();
      this.index = { at: Date.now(), pages };
      pages.catch(() => (this.index = null));
    }
    return this.index.pages;
  }

  private async load() {
    const rows: LiveRow[] = await this.prisma.listing.findMany({
      where: { status: { in: ['PUBLISHED', 'RESERVED'] } },
      select: { id: true, brand: true, category: true, subcategory: true, market: true, condition: true, price: true, priceNegotiable: true, city: true, deliveryOptions: true, updatedAt: true },
      // The order the pages show items in: the search's default (lifted or newest first).
      orderBy: [{ liftedAt: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }],
      take: 50_000,
    });
    return buildLandings(rows);
  }

  /** The indexed pages: for the sitemap and for links from item pages. */
  async list() {
    const pages = await this.pages();
    return [...pages.values()]
      .filter((p) => p.indexable)
      .map((p) => ({ path: p.path, kind: p.kind, name: p.name, brand: p.brand?.name ?? null, category: p.category || null, subcategory: p.subcategory, count: p.rows.length, updatedAt: p.updatedAt }));
  }

  async page(rawPath: string) {
    const path = normalizeLandingPath(rawPath);
    const pages = await this.pages();
    const p = path ? pages.get(path) : undefined;
    if (!p) throw new NotFoundException({ message: 'Такой страницы нет' });

    // New items and second-hand ones are shown apart, as everywhere on the site (listings/market.ts).
    const sections = await Promise.all(
      (['CATALOG', 'RESALE'] as const).map(async (market) => {
        const rows = p.rows.filter((r) => r.market === market);
        const ids = rows.slice(0, SECTION_ITEMS).map((r) => r.id);
        const found = ids.length ? await this.prisma.listing.findMany({ where: { id: { in: ids }, status: { in: ['PUBLISHED', 'RESERVED'] } }, include: cardInclude }) : [];
        const byId = new Map(found.map((l) => [l.id, l]));
        const items = ids.flatMap((id) => {
          const l = byId.get(id);
          return l ? [serializeCard(l)] : [];
        });
        return { market: market === 'CATALOG' ? ('brands' as const) : ('resale' as const), total: rows.length, items };
      }),
    );
    const s = landingStats(p);
    return {
      path: p.path,
      kind: p.kind,
      name: p.name,
      indexable: p.indexable,
      brand: p.brand?.name ?? null,
      category: p.category || null,
      subcategory: p.subcategory,
      ...landingText(p),
      total: s.total,
      price: s.price,
      updatedAt: p.updatedAt,
      crumbs: landingCrumbs(p, pages),
      links: landingLinks(p, pages),
      sections: sections.filter((x) => x.total > 0),
    };
  }
}

@Controller('seo')
export class LandingController {
  constructor(private readonly landings: LandingService) {}

  @Public()
  @SkipThrottle()
  @Get('landings')
  list() {
    return this.landings.list();
  }

  /** One page by its address: `?path=c/jeans/flare`, `?path=brands/carhartt/outerwear`. */
  @Public()
  @Get('landing')
  page(@Query('path') path: unknown) {
    if (typeof path !== 'string' || path.length > 200) throw new NotFoundException({ message: 'Такой страницы нет' });
    return this.landings.page(path);
  }
}
