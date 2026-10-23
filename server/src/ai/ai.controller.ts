import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { CATEGORY_SLUGS, COLOR_VALUES } from '../catalog/catalog.js';
import { ZodPipe } from '../common/zod.js';
import { MAX_UPLOAD_BYTES, MediaService } from '../media/media.service.js';
import { AdminGuard } from '../moderation/moderation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiService } from './ai.service.js';
import { AiEnsemble } from './ensemble/ensemble.js';
import { PhotoChecker } from './photo-check.js';
import { PhotoSearch } from './photo-search.js';
import { PriceAdvisor } from './price.js';
import { SearchParser } from './search-parse.js';

const AnalyzeDto = z.object({ photoIds: z.array(z.uuid()).min(1).max(10) });
/** An optional form field: an empty string means "not chosen". */
const field = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? null : v), schema.nullish());
const DescribeDto = z.object({
  title: z.string().min(1).max(80),
  category: field(z.enum(CATEGORY_SLUGS as [string, ...string[]])),
  brand: field(z.string().max(60)),
  color: field(z.enum(COLOR_VALUES as [string, ...string[]])),
  size: field(z.string().max(60)),
  condition: field(z.enum(['NEW_WITH_TAGS', 'LIKE_NEW', 'GOOD', 'VISIBLE_WEAR'])),
  defects: field(z.string().max(500)),
  material: field(z.string().max(60)),
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
const PhotoCheckDto = z.object({ photoIds: z.array(z.uuid()).min(1).max(10), category: z.string().max(60).nullish() });
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
    private readonly photoSearcher: PhotoSearch,
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
  async describe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(DescribeDto)) dto: z.infer<typeof DescribeDto>) {
    try {
      return { description: await this.ai.describe(dto, user.id) };
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
   * Search by photo (guests too), in two steps: the AI says what kind of item it is, then the items of that kind are
   * ranked by how they look — colours, print, pattern — and the closest are compared with the photo by the vision
   * models (ai/photo-search.ts). Returns the ranked ids; /search?ids=…&sort=similar pages, refines and filters them.
   * The uploaded photo is not stored.
   */
  @Public()
  @Post('photo-search')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  photoSearch(@UploadedFile() file?: Express.Multer.File, @CurrentUser() user?: AuthUser, @Query('market') marketRaw?: string) {
    if (!file) throw new BadRequestException({ message: 'Выберите фото' });
    // Brands unless the search started on «Вторичка» (or asked for both).
    const market = marketRaw === 'resale' || marketRaw === 'all' ? marketRaw : 'brands';
    return this.photoSearcher.search(file.buffer, market, user?.id);
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
