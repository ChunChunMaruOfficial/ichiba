import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import type { ListingStatus } from '../generated/prisma/client.js';
import { cardInclude } from '../listings/listing.serializer.js';
import { ListingsService } from '../listings/listings.service.js';
import { photoUrls } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * «Образы»: anyone puts 2–8 items from the whole site together into an outfit. Looks sit on their author's
 * profile as round highlights, open on their own page (with «Всё в корзину»), and an item page shows the
 * looks it is part of.
 */

const MAX_LOOKS = 30;
/** What a look shows: items others can see; the viewer's own hidden items too. Never deleted ones or drafts. */
const VISIBLE: ListingStatus[] = ['PUBLISHED', 'RESERVED', 'SOLD'];

const LookDto = z.object({
  title: z.string().trim().min(1, 'Назовите образ').max(60, 'До 60 символов'),
  listingIds: z.array(z.uuid()).min(2, 'Выберите хотя бы 2 вещи').max(8, 'Не больше 8 вещей'),
});

@Injectable()
export class LooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  private async serialize(look: { id: string; title: string; userId: string; createdAt: Date; items: Array<{ listingId: string; position: number }> }, viewerId?: string) {
    const order = new Map(look.items.map((i) => [i.listingId, i.position]));
    const rows = await this.prisma.listing.findMany({
      where: { id: { in: [...order.keys()] }, OR: [{ status: { in: VISIBLE } }, ...(viewerId ? [{ sellerId: viewerId, status: 'HIDDEN' as const }] : [])] },
      include: cardInclude,
    });
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const items = await this.listings.cards(rows, viewerId);
    const onSale = rows.filter((r) => r.status === 'PUBLISHED');
    return {
      id: look.id,
      title: look.title,
      createdAt: look.createdAt,
      isOwner: viewerId === look.userId,
      items,
      /** Price of what can still be bought, for «Всё в корзину». */
      total: onSale.reduce((n, r) => n + (r.price ?? 0), 0),
      available: onSale.length,
    };
  }

  async byUser(username: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) throw new NotFoundException({ message: 'Такого гардероба нет' });
    const looks = await this.prisma.look.findMany({ where: { userId: user.id }, include: { items: true }, orderBy: { createdAt: 'desc' } });
    const out = await Promise.all(looks.map((l) => this.serialize(l, viewerId)));
    // A look whose items were all sold off and deleted has nothing left to show.
    return { items: out.filter((l) => l.items.length > 0) };
  }

  async one(id: string, viewerId?: string) {
    const look = await this.prisma.look.findUnique({ where: { id }, include: { items: true, user: { select: { username: true, avatar: { select: { key: true, provider: true } } } } } });
    if (!look) throw new NotFoundException({ message: 'Образ не найден' });
    const body = await this.serialize(look, viewerId);
    if (!body.items.length) throw new NotFoundException({ message: 'Образ не найден' });
    return { ...body, owner: { username: look.user.username, avatar: look.user.avatar ? photoUrls(look.user.avatar) : null } };
  }

  async withListing(listingId: string, viewerId?: string) {
    const looks = await this.prisma.look.findMany({ where: { items: { some: { listingId } } }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 3 });
    const out = await Promise.all(looks.map((l) => this.serialize(l, viewerId)));
    return { items: out.filter((l) => l.items.length > 1) };
  }

  /** Any item on the site that people can see, plus the author's own hidden ones. */
  private async checkItems(userId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const ok = await this.prisma.listing.count({ where: { id: { in: unique }, OR: [{ status: { in: VISIBLE } }, { sellerId: userId, status: 'HIDDEN' }] } });
    if (ok !== unique.length) throw new BadRequestException({ message: 'Некоторые вещи недоступны — уберите их из образа' });
    return unique;
  }

  /** «В образ» on an item page: the viewer's looks, to add the item to one of them. */
  async mine(userId: string) {
    const looks = await this.prisma.look.findMany({ where: { userId }, include: { items: true }, orderBy: { updatedAt: 'desc' } });
    return { items: await Promise.all(looks.map((l) => this.serialize(l, userId))) };
  }

  async addItem(userId: string, id: string, listingId: string) {
    await this.own(userId, id);
    await this.checkItems(userId, [listingId]);
    const count = await this.prisma.lookItem.count({ where: { lookId: id } });
    if (count >= 8) throw new BadRequestException({ message: 'В образе уже 8 вещей' });
    await this.prisma.lookItem.upsert({ where: { lookId_listingId: { lookId: id, listingId } }, create: { lookId: id, listingId, position: count }, update: {} });
    await this.prisma.look.update({ where: { id }, data: { updatedAt: new Date() } });
    return { ok: true };
  }

  async create(userId: string, dto: z.infer<typeof LookDto>) {
    if ((await this.prisma.look.count({ where: { userId } })) >= MAX_LOOKS) throw new BadRequestException({ message: `Не больше ${MAX_LOOKS} образов` });
    const ids = await this.checkItems(userId, dto.listingIds);
    const look = await this.prisma.look.create({
      data: { userId, title: dto.title, items: { create: ids.map((listingId, position) => ({ listingId, position })) } },
      include: { items: true },
    });
    return this.serialize(look, userId);
  }

  private async own(userId: string, id: string) {
    const look = await this.prisma.look.findUnique({ where: { id } });
    if (!look) throw new NotFoundException({ message: 'Образ не найден' });
    if (look.userId !== userId) throw new ForbiddenException({ message: 'Это не ваш образ' });
    return look;
  }

  async update(userId: string, id: string, dto: z.infer<typeof LookDto>) {
    await this.own(userId, id);
    const ids = await this.checkItems(userId, dto.listingIds);
    const look = await this.prisma.$transaction(async (tx) => {
      await tx.lookItem.deleteMany({ where: { lookId: id } });
      return tx.look.update({
        where: { id },
        data: { title: dto.title, items: { create: ids.map((listingId, position) => ({ listingId, position })) } },
        include: { items: true },
      });
    });
    return this.serialize(look, userId);
  }

  async remove(userId: string, id: string) {
    await this.own(userId, id);
    await this.prisma.look.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller()
export class LooksController {
  constructor(private readonly looks: LooksService) {}

  @Public()
  @Get('users/:username/looks')
  byUser(@Param('username') username: string, @CurrentUser() user?: AuthUser) {
    return this.looks.byUser(username, user?.id);
  }

  // Before looks/:id, or «mine» would be taken for an id.
  @Get('looks/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.looks.mine(user.id);
  }

  @Public()
  @Get('looks/:id')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.looks.one(id, user?.id);
  }

  @Public()
  @Get('listings/:id/looks')
  withListing(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.looks.withListing(id, user?.id);
  }

  @Post('looks/:id/items/:listingId')
  addItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.looks.addItem(user.id, id, listingId);
  }

  @Post('looks')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(LookDto)) dto: z.infer<typeof LookDto>) {
    return this.looks.create(user.id, dto);
  }

  @Patch('looks/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(LookDto)) dto: z.infer<typeof LookDto>) {
    return this.looks.update(user.id, id, dto);
  }

  @Delete('looks/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.looks.remove(user.id, id);
  }
}
