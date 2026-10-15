import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { CATEGORIES, CATEGORY_SLUGS, COLORS } from '../catalog/catalog.js';
import { ZodPipe } from '../common/zod.js';
import { ListingsService } from '../listings/listings.service.js';
import { MAX_UPLOAD_BYTES, MediaService } from '../media/media.service.js';
import { AdminGuard } from '../moderation/moderation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiService } from './ai.service.js';
import { AiEnsemble } from './ensemble/ensemble.js';
import { PhotoChecker } from './photo-check.js';
import { PriceAdvisor } from './price.js';
import { SearchParser } from './search-parse.js';

const AnalyzeDto = z.object({ photoIds: z.array(z.uuid()).min(1).max(10) });
const DescribeDto = z.object({
  title: z.string().min(1).max(80),
  category: z.string().nullish(),
  brand: z.string().nullish(),
  color: z.string().nullish(),
  size: z.string().nullish(),
  condition: z.string().nullish(),
  defects: z.string().nullish(),
  material: z.string().nullish(),
});
const PriceDto = z.object({
  listingId: z.uuid().nullish(),
  title: z.string().max(80).nullish(),
  category: z.enum(CATEGORY_SLUGS as [string, ...string[]]),
  subcategory: z.string().max(40).nullish(),
  brand: z.string().max(60).nullish(),
  color: z.string().max(20).nullish(),
  condition: z.enum(['NEW_WITH_TAGS', 'LIKE_NEW', 'GOOD', 'VISIBLE_WEAR']).nullish(),
  defectsPresent: z.boolean().nullish(),
  material: z.string().max(40).nullish(),
  size: z.string().max(20).nullish(),
  photoIds: z.array(z.uuid()).max(10).optional(),
});
const PhotoCheckDto = z.object({ photoIds: z.array(z.uuid()).min(1).max(10), category: z.string().nullish() });
const SearchParseDto = z.object({ q: z.string().trim().min(1).max(200) });

@Controller('ai')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AiController {
  private readonly logger = new Logger('AI');

  constructor(
    private readonly ai: AiService,
    private readonly ensemble: AiEnsemble,
    private readonly media: MediaService,
    private readonly prisma: PrismaService,
    private readonly price: PriceAdvisor,
    private readonly photos: PhotoChecker,
    private readonly search: SearchParser,
    private readonly listings: ListingsService,
  ) {}

  /** Add Item autofill from photos (frame 22). */
  @Post('analyze')
  @HttpCode(200)
  async analyze(@CurrentUser() user: AuthUser, @Body(new ZodPipe(AnalyzeDto)) dto: z.infer<typeof AnalyzeDto>) {
    if (!this.ai.enabled) return { status: 'disabled' as const };
    const photos = await this.prisma.photo.findMany({ where: { id: { in: dto.photoIds }, ownerId: user.id } });
    const ordered = dto.photoIds.map((id) => photos.find((p) => p.id === id)).filter((p) => p !== undefined);
    try {
      const images = await Promise.all(ordered.slice(0, 4).map((p) => this.media.imageForAi(p.key)));
      return { status: 'ok' as const, suggestion: await this.ai.analyze(images, user.id) };
    } catch (e) {
      // AI FAILED state (frame 10): the seller fills the fields manually.
      this.logger.warn(`analyze failed: ${(e as Error).message}`);
      return { status: 'failed' as const };
    }
  }

  @Post('describe')
  @HttpCode(200)
  async describe(@Body(new ZodPipe(DescribeDto)) dto: z.infer<typeof DescribeDto>) {
    try {
      return { description: await this.ai.describe(dto) };
    } catch (e) {
      this.logger.warn(`describe failed: ${(e as Error).message}`);
      return { description: null };
    }
  }

  /** Price hint on the price step of Add Item / Edit Item. */
  @Post('price-suggest')
  @HttpCode(200)
  priceSuggest(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PriceDto)) dto: z.infer<typeof PriceDto>) {
    return this.price.suggest(user.id, dto);
  }

  /** Photo quality and cover hints for the photo step. */
  @Post('photo-check')
  @HttpCode(200)
  photoCheck(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PhotoCheckDto)) dto: z.infer<typeof PhotoCheckDto>) {
    return this.photos.check(user.id, dto.photoIds, dto.category);
  }

  /** Natural-language search → catalog filters. Guests search too. */
  @Public()
  @Post('search-parse')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  searchParse(@Body(new ZodPipe(SearchParseDto)) dto: z.infer<typeof SearchParseDto>) {
    return this.search.parse(dto.q);
  }

  /**
   * Search by photo (guests too): the AI says what the item is, then items are ranked by those attributes and by
   * how close their cover photos look. The uploaded photo is not stored.
   */
  @Public()
  @Post('photo-search')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async photoSearch(@UploadedFile() file?: Express.Multer.File, @CurrentUser() user?: AuthUser, @Query('market') marketRaw?: string) {
    if (!file) throw new BadRequestException({ message: 'Выберите фото' });
    // Brands unless the search started on «Вторичка» (or asked for both).
    const market = marketRaw === 'resale' || marketRaw === 'all' ? marketRaw : 'brands';
    const { jpeg, dhash } = await this.media.searchImage(file.buffer);
    const seen = this.ai.enabled
      ? await this.ai.analyze([jpeg], user?.id).catch((e: Error) => {
          this.logger.warn(`photo search: analyze failed: ${e.message}`);
          return null;
        })
      : null;
    // "Not clothing" isn't final (AI answers vary, drawings and bags confuse it): then only the photo ranks.
    if (seen?.flags.not_clothing) return { label: null, look: {}, items: await this.listings.photoSearch({}, dhash, user?.id, market), notClothing: true };
    const category = seen && seen.category.confidence >= 0.5 ? CATEGORIES.find((c) => c.slug === seen.category.value) : undefined;
    const subcategory = category?.subcategories.find((sc) => sc.slug === seen?.subcategory.value);
    const color = seen && seen.color.confidence >= 0.5 ? COLORS.find((c) => c.value === seen.color.value) : undefined;
    const brand = seen && seen.brand.confidence >= 0.6 && seen.brand.value ? seen.brand.value : null;
    const look = { category: category?.slug ?? null, subcategory: subcategory?.slug ?? null, color: color?.value ?? null, brand };
    const label = [subcategory?.label ?? category?.label, color?.label.toLowerCase(), brand].filter(Boolean).join(', ') || null;
    return { label, look, items: await this.listings.photoSearch(look, dhash, user?.id, market), notClothing: false };
  }

  /** Provider health and recent usage for the admin dashboard. */
  @Get('status')
  @UseGuards(AdminGuard)
  async status() {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const runs = await this.prisma.aiRun.groupBy({ by: ['feature'], where: { createdAt: { gte: since } }, _count: true, _avg: { latencyMs: true } });
    return {
      providers: this.ensemble.status(),
      last24h: runs.map((r) => ({ feature: r.feature, runs: r._count, avgLatencyMs: Math.round(r._avg.latencyMs ?? 0) })),
    };
  }
}
