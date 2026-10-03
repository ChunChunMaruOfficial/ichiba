import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import * as catalog from '../catalog/catalog.js';
import { ZodPipe } from '../common/zod.js';
import { FeedQuery, ListingInput, ListingInputT, SearchQuery, SearchQueryT, WardrobeQuery } from './listings.dto.js';
import { ListingsService } from './listings.service.js';

@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get('meta')
  meta() {
    const { CATEGORIES, SIZES, CONDITIONS, COLORS, MATERIALS, STYLE_TAGS, CITIES, TOP_BRANDS } = catalog;
    return { categories: CATEGORIES, sizes: SIZES, conditions: CONDITIONS, colors: COLORS, materials: MATERIALS, styleTags: STYLE_TAGS, cities: CITIES, brands: TOP_BRANDS };
  }

  @Public()
  @Get('feed')
  feed(@Query(new ZodPipe(FeedQuery)) q: z.infer<typeof FeedQuery>, @CurrentUser() user?: AuthUser) {
    return this.listings.feed(q.chip, q.offset, q.limit, user?.id);
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
  @Get('wardrobes/:username')
  wardrobe(@Param('username') username: string, @Query(new ZodPipe(WardrobeQuery)) q: z.infer<typeof WardrobeQuery>, @CurrentUser() user?: AuthUser) {
    return this.listings.wardrobe(username, user?.id, q.section, q.sort);
  }

  @Public()
  @Get('listings/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.listings.get(id, user?.id);
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
