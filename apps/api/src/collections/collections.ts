import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { photoUrls } from '../media/media.service.js';

const NameDto = z.object({ name: z.string().trim().min(1, 'Введите название').max(40, 'До 40 символов') });

/** Private collections inside Favorites (frame 11). Adding to a collection also saves the item (♡). */
@Controller('collections')
export class CollectionsController {
  constructor(private readonly prisma: PrismaService) {}

  private async own(userId: string, id: string) {
    const c = await this.prisma.collection.findUnique({ where: { id } });
    if (!c || c.userId !== userId) throw new NotFoundException({ message: 'Коллекция не найдена' });
    return c;
  }

  /** With `listingId`, each collection says whether it already contains that item (for the "В коллекцию" popover). */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('listingId') listingId?: string) {
    const rows = await this.prisma.collection.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { items: true } },
        items: { orderBy: { addedAt: 'desc' }, take: 4, include: { listing: { include: { photos: { where: { isCover: true }, take: 1 } } } } },
      },
    });
    const containing = listingId
      ? new Set((await this.prisma.collectionItem.findMany({ where: { listingId, collection: { userId: user.id } }, select: { collectionId: true } })).map((c) => c.collectionId))
      : null;
    return {
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        count: c._count.items,
        covers: c.items.map((i) => (i.listing.photos[0] ? photoUrls(i.listing.photos[0].key).s : null)),
        hasItem: containing ? containing.has(c.id) : undefined,
      })),
    };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(NameDto)) dto: z.infer<typeof NameDto>) {
    const c = await this.prisma.collection.create({ data: { userId: user.id, name: dto.name } });
    return { id: c.id, name: c.name, count: 0, covers: [] };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.own(user.id, id);
    const items = await this.prisma.collectionItem.findMany({ where: { collectionId: id }, include: { listing: { include: cardInclude } }, orderBy: { addedAt: 'desc' } });
    const favs = new Set((await this.prisma.favorite.findMany({ where: { userId: user.id, listingId: { in: items.map((i) => i.listingId) } }, select: { listingId: true } })).map((f) => f.listingId));
    return { id: c.id, name: c.name, items: items.map((i) => serializeCard(i.listing, favs)) };
  }

  @Patch(':id')
  async rename(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(NameDto)) dto: z.infer<typeof NameDto>) {
    await this.own(user.id, id);
    await this.prisma.collection.update({ where: { id }, data: { name: dto.name } });
    return { ok: true };
  }

  /** Deleting a collection keeps the items in Favorites. */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.own(user.id, id);
    await this.prisma.collection.delete({ where: { id } });
    return { ok: true };
  }

  @Put(':id/items/:listingId')
  async addItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('listingId', ParseUUIDPipe) listingId: string) {
    await this.own(user.id, id);
    await this.prisma.collectionItem.upsert({ where: { collectionId_listingId: { collectionId: id, listingId } }, create: { collectionId: id, listingId }, update: {} });
    const fav = await this.prisma.favorite.findUnique({ where: { userId_listingId: { userId: user.id, listingId } } });
    if (!fav) {
      await this.prisma.$transaction([
        this.prisma.favorite.create({ data: { userId: user.id, listingId, source: 'product' } }),
        this.prisma.listing.update({ where: { id: listingId }, data: { favoritesCount: { increment: 1 } } }),
      ]);
    }
    return { ok: true };
  }

  @Delete(':id/items/:listingId')
  async removeItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('listingId', ParseUUIDPipe) listingId: string) {
    await this.own(user.id, id);
    await this.prisma.collectionItem.deleteMany({ where: { collectionId: id, listingId } });
    return { ok: true };
  }
}
