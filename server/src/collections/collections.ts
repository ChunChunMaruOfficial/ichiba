import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import type { Prisma } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatsService } from '../stats/stats.js';
import { photoUrls } from '../media/media.service.js';

const NameDto = z.object({ name: z.string().trim().min(1, 'Введите название').max(40, 'До 40 символов') });
/** Limits that keep one account from growing unbounded rows (collections are private, nobody curates them). */
const MAX_COLLECTIONS = 50;
const MAX_ITEMS = 500;
/** Items a buyer can still see: a deleted, moderator-blocked or draft item is gone from collections as from Favorites. */
const SHOWN = { status: { notIn: ['DELETED', 'BLOCKED', 'DRAFT'] } } as const satisfies Prisma.ListingWhereInput;

/** Private collections inside Favorites (frame 11). Adding to a collection also saves the item (♡). */
@Controller('collections')
export class CollectionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsService,
  ) {}

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
        _count: { select: { items: { where: { listing: SHOWN } } } },
        items: { where: { listing: SHOWN }, orderBy: { addedAt: 'desc' }, take: 4, include: { listing: { include: { photos: { where: { isCover: true }, take: 1 } } } } },
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
        covers: c.items.map((i) => (i.listing.photos[0] ? photoUrls(i.listing.photos[0]).s : null)),
        hasItem: containing ? containing.has(c.id) : undefined,
      })),
    };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(NameDto)) dto: z.infer<typeof NameDto>) {
    if ((await this.prisma.collection.count({ where: { userId: user.id } })) >= MAX_COLLECTIONS) {
      throw new ConflictException({ message: `Не больше ${MAX_COLLECTIONS} коллекций — удалите ненужные` });
    }
    const c = await this.prisma.collection.create({ data: { userId: user.id, name: dto.name } });
    return { id: c.id, name: c.name, count: 0, covers: [] };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.own(user.id, id);
    const items = await this.prisma.collectionItem.findMany({ where: { collectionId: id, listing: SHOWN }, include: { listing: { include: cardInclude } }, orderBy: { addedAt: 'desc' }, take: MAX_ITEMS });
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
    // Same rule as ♡: only items others can see (no drafts, hidden, blocked or deleted ones, no 500 on a wrong id).
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { status: true, hiddenByAdmin: true } });
    if (!listing || !['PUBLISHED', 'RESERVED', 'SOLD'].includes(listing.status) || listing.hiddenByAdmin) throw new NotFoundException({ message: 'Такой вещи нет' });
    const already = await this.prisma.collectionItem.findUnique({ where: { collectionId_listingId: { collectionId: id, listingId } }, select: { listingId: true } });
    if (!already && (await this.prisma.collectionItem.count({ where: { collectionId: id } })) >= MAX_ITEMS) {
      throw new ConflictException({ message: `В коллекции уже ${MAX_ITEMS} вещей — создайте новую` });
    }
    // skipDuplicates: two taps at once neither fail on the unique key nor count the ♡ twice.
    await this.prisma.collectionItem.createMany({ data: [{ collectionId: id, listingId }], skipDuplicates: true });
    const added = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.favorite.createMany({ data: [{ userId: user.id, listingId, source: 'product' }], skipDuplicates: true });
      if (count) await tx.listing.update({ where: { id: listingId }, data: { favoritesCount: { increment: count } } });
      return count;
    });
    if (added) this.stats.track(listingId, 'favorites');
    return { ok: true };
  }

  @Delete(':id/items/:listingId')
  async removeItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('listingId', ParseUUIDPipe) listingId: string) {
    await this.own(user.id, id);
    await this.prisma.collectionItem.deleteMany({ where: { collectionId: id, listingId } });
    return { ok: true };
  }
}
