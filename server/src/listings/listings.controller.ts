import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { POPULAR_BRANDS } from '../catalog/brands.js';
import * as catalog from '../catalog/catalog.js';
import { ZodPipe } from '../common/zod.js';
import { FeedQuery, ListingInput, ListingInputT, SearchQuery, SearchQueryT, WardrobeQuery } from './listings.dto.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';
import { ListingsService } from './listings.service.js';

const ScheduleDto = z.object({ at: z.coerce.date() });
const EngagementDto = z.object({ ms: z.number().int().min(0).max(24 * 3600_000), photos: z.number().int().min(0).max(100) });
const ImpressionsDto = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });
const PageQuery = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(48).default(24) });

@Controller()
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly recs: RecommendationsService,
  ) {}

  @Public()
  @Get('meta')
  meta() {
    const { CATEGORIES, SIZES, CONDITIONS, COLORS, MATERIALS, STYLE_TAGS, CITIES, GENDERS } = catalog;
    return { categories: CATEGORIES, genders: GENDERS, sizes: SIZES, conditions: CONDITIONS, colors: COLORS, materials: MATERIALS, styleTags: STYLE_TAGS, cities: CITIES, brands: POPULAR_BRANDS };
  }

  @Public()
  @Get('feed')
  feed(@Query(new ZodPipe(FeedQuery)) q: z.infer<typeof FeedQuery>, @CurrentUser() user?: AuthUser) {
    return this.listings.feed(q.chip, q.offset, q.limit, user?.id, q.market);
  }

  @Public()
  @Get('home')
  home(@CurrentUser() user?: AuthUser) {
    return this.listings.home(user?.id);
  }

  @Public()
  @Get('search')
  search(@Query(new ZodPipe(SearchQuery)) q: SearchQueryT, @CurrentUser() user?: AuthUser) {
    return this.listings.search(q, user?.id);
  }

  @Public()
  @Get('wardrobes')
  wardrobes(@Query(new ZodPipe(PageQuery)) q: z.infer<typeof PageQuery>, @Query('q') raw: string | string[] | undefined, @CurrentUser() user?: AuthUser) {
    // `?q=a&q=b` arrives as an array: the first one is the search.
    const text = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 64);
    return this.listings.wardrobes(q.offset, q.limit, typeof text === 'string' ? text : undefined, user?.id);
  }

  @Public()
  @Get('wardrobes/:username')
  wardrobe(@Param('username') username: string, @Query(new ZodPipe(WardrobeQuery)) q: z.infer<typeof WardrobeQuery>, @CurrentUser() user?: AuthUser) {
    return this.listings.wardrobe(username, user?.id, q.section, q.sort, q.offset);
  }

  @Public()
  @Get('listings/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Ip() ip: string, @CurrentUser() user?: AuthUser, @Headers('x-ichiba-render') render?: string) {
    // Server-side renders (and crawlers hitting them) are not views; the browser's own request counts, once a day.
    return this.listings.get(id, user?.id, { trackView: render !== 'ssr', viewer: ip ? `ip:${ip}` : undefined });
  }

  /** How a visit to the item page ended (sent as the page is left): time on it and photos looked at. */
  @Post('listings/:id/engagement')
  @HttpCode(204)
  async engagement(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(EngagementDto)) dto: z.infer<typeof EngagementDto>) {
    await this.recs.engagement(user.id, id, dto.ms, dto.photos);
  }

  /** Cards a feed showed the person: «Для вас» lets items scrolled past again and again give way. */
  @Post('feed/impressions')
  @HttpCode(204)
  async impressions(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ImpressionsDto)) dto: z.infer<typeof ImpressionsDto>) {
    await this.recs.impressions(user.id, [...new Set(dto.ids)]);
  }

  /** «Не интересно»: hide the item from this person's feeds and search (DELETE brings it back). */
  @Post('listings/:id/not-interested')
  @HttpCode(200)
  notInterested(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.setNotInterested(user.id, id, true);
  }

  @Delete('listings/:id/not-interested')
  interestedAgain(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.setNotInterested(user.id, id, false);
  }

  @Public()
  @Get('listings/:id/similar')
  similar(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(PageQuery)) q: z.infer<typeof PageQuery>, @CurrentUser() user?: AuthUser) {
    return this.listings.similar(id, q.offset, q.limit, user?.id);
  }

  @Public()
  @Get('listings/:id/related')
  related(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.listings.related(id, user?.id);
  }

  @Post('listings')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ListingInput)) dto: ListingInputT) {
    return this.listings.create(user.id, dto);
  }

  @Patch('listings/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ListingInput)) dto: ListingInputT) {
    return this.listings.update(user.id, id, dto);
  }

  @Post('listings/:id/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.publish(user.id, id);
  }

  @Post('listings/:id/schedule')
  @HttpCode(200)
  schedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ScheduleDto)) dto: z.infer<typeof ScheduleDto>) {
    return this.listings.schedule(user.id, id, dto.at);
  }

  @Delete('listings/:id/schedule')
  unschedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.unschedule(user.id, id);
  }

  @Post('listings/:id/bump')
  @HttpCode(200)
  bump(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.bump(user.id, id);
  }

  /** URLs for sitemap.xml: live listings and wardrobes with something on sale (SEO, feature 15). */
  @Public()
  @Get('seo/sitemap')
  sitemap() {
    return this.listings.sitemap();
  }

  @Post('listings/:id/hide')
  @HttpCode(200)
  hide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.hide(user.id, id);
  }

  @Post('listings/:id/sold')
  @HttpCode(200)
  sold(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.markSold(user.id, id);
  }

  @Delete('listings/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.remove(user.id, id);
  }
}
