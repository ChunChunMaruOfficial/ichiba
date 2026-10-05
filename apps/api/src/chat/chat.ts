import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ChatGuard, MessageRisk } from '../ai/chat-guard.js';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { EventsService } from '../events/events.js';
import type { Message, Prisma } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatsService } from '../stats/stats.js';

const threadInclude = {
  listing: { include: cardInclude },
  buyer: { select: { id: true, username: true } },
  seller: { select: { id: true, username: true } },
  request: { select: { id: true, number: true, status: true } },
  messages: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.ThreadInclude;
type ThreadRow = Prisma.ThreadGetPayload<{ include: typeof threadInclude }>;

/** Chat about a specific item, optionally tied to a deal (frame 15). One thread per (item, buyer). */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly guard: ChatGuard,
    private readonly stats: StatsService,
  ) {}

  /** Antifraud warnings are shown to the recipient only. */
  private message(m: Message, viewerId: string) {
    const mine = m.senderId === viewerId;
    return { id: m.id, body: m.body, mine, createdAt: m.createdAt, risk: mine ? null : ((m.risk as MessageRisk | null) ?? null) };
  }

  private serialize(t: ThreadRow, viewerId: string) {
    const role = t.buyerId === viewerId ? 'buyer' : 'seller';
    const readAt = role === 'buyer' ? t.buyerReadAt : t.sellerReadAt;
    const last = t.messages[0];
    return {
      id: t.id,
      role,
      listing: serializeCard(t.listing),
      counterpart: role === 'buyer' ? t.seller : t.buyer,
      request: t.request,
      lastMessage: last ? { body: last.body, mine: last.senderId === viewerId, createdAt: last.createdAt } : null,
      lastMessageAt: t.lastMessageAt,
      unread: !!last && last.senderId !== viewerId && (!readAt || readAt < last.createdAt),
    };
  }

  private async load(id: string, viewerId: string) {
    const t = await this.prisma.thread.findUnique({ where: { id }, include: threadInclude });
    if (!t) throw new NotFoundException({ message: 'Диалог не найден' });
    if (t.buyerId !== viewerId && t.sellerId !== viewerId) throw new ForbiddenException({ message: 'Нет доступа' });
    return t;
  }

  /** Opens the thread for an item (buyer side) or for a deal (either side). */
  async open(userId: string, input: { listingId?: string; requestId?: string }) {
    let listingId: string;
    let buyerId: string;
    let sellerId: string;
    let requestId: string | null;
    if (input.requestId) {
      const r = await this.prisma.buyRequest.findUnique({ where: { id: input.requestId }, include: { items: { take: 1 } } });
      if (!r || (r.buyerId !== userId && r.sellerId !== userId)) throw new NotFoundException({ message: 'Сделка не найдена' });
      listingId = r.items[0].listingId;
      buyerId = r.buyerId;
      sellerId = r.sellerId;
      requestId = r.id;
    } else if (input.listingId) {
      const l = await this.prisma.listing.findUnique({ where: { id: input.listingId } });
      if (!l || l.status === 'DELETED') throw new NotFoundException({ message: 'Такой вещи нет' });
      if (l.sellerId === userId) throw new BadRequestException({ message: 'Это ваша вещь' });
      listingId = l.id;
      buyerId = userId;
      sellerId = l.sellerId;
      const active = await this.prisma.buyRequest.findFirst({ where: { buyerId, items: { some: { listingId } } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      requestId = active?.id ?? null;
    } else throw new BadRequestException({ message: 'Не выбрана вещь' });

    const isNew = !(await this.prisma.thread.findUnique({ where: { listingId_buyerId: { listingId, buyerId } }, select: { id: true } }));
    const t = await this.prisma.thread.upsert({
      where: { listingId_buyerId: { listingId, buyerId } },
      create: { listingId, buyerId, sellerId, requestId },
      update: requestId ? { requestId } : {},
      include: threadInclude,
    });
    if (isNew) this.stats.track(listingId, 'chats');
    return this.serialize(t, userId);
  }

  async list(userId: string) {
    const rows = await this.prisma.thread.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }], messages: { some: {} } },
      include: threadInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
    return { items: rows.map((t) => this.serialize(t, userId)) };
  }

  async get(userId: string, id: string, before?: string) {
    const t = await this.load(id, userId);
    const messages = await this.prisma.message.findMany({
      where: { threadId: id, createdAt: before ? { lt: new Date(before) } : undefined },
      orderBy: { createdAt: 'desc' },
      take: 51,
    });
    await this.markRead(t, userId);
    return {
      thread: this.serialize(t, userId),
      messages: messages
        .slice(0, 50)
        .reverse()
        .map((m) => this.message(m, userId)),
      hasMore: messages.length > 50,
    };
  }

  private markRead(t: { id: string; buyerId: string }, userId: string) {
    return this.prisma.thread.update({ where: { id: t.id }, data: t.buyerId === userId ? { buyerReadAt: new Date() } : { sellerReadAt: new Date() } });
  }

  async send(userId: string, id: string, raw: string) {
    const t = await this.load(id, userId);
    const now = new Date();
    // Card numbers are masked before storage; obvious scam patterns are flagged right away.
    const check = this.guard.prepare(raw);
    const body = check.body;
    const [m] = await this.prisma.$transaction([
      this.prisma.message.create({ data: { threadId: id, senderId: userId, body, createdAt: now, risk: (check.immediate ?? undefined) as Prisma.InputJsonValue | undefined } }),
      this.prisma.thread.update({ where: { id }, data: { lastMessageAt: now, ...(t.buyerId === userId ? { buyerReadAt: now } : { sellerReadAt: now }) } }),
    ]);
    const other = t.buyerId === userId ? t.sellerId : t.buyerId;
    const me = t.buyerId === userId ? t.buyer : t.seller;
    this.events.emit(other, { type: 'message', data: { threadId: id, message: { id: m.id, body: m.body, mine: false, createdAt: m.createdAt, risk: check.immediate, from: me.username, title: t.listing.title } } });
    if (check.needsAi) {
      // The ensemble verdict arrives later as a "message_risk" event; sending is never blocked on it.
      void this.guard
        .review({ messageId: m.id, threadId: id, senderId: userId, recipientId: other, signals: check.signals, masked: check.masked, immediate: check.immediate })
        .catch(() => undefined);
    }
    return {
      id: m.id,
      body: m.body,
      mine: true,
      createdAt: m.createdAt,
      risk: null,
      notice: check.masked ? 'Номер карты скрыт. Не передавайте данные карты в чате — оплачивайте при встрече или при получении' : null,
    };
  }

  async read(userId: string, id: string) {
    const t = await this.load(id, userId);
    await this.markRead(t, userId);
    return { ok: true };
  }

  /** Threads whose latest message is from the other side and newer than my read mark. */
  async unreadCount(userId: string) {
    const rows = await this.prisma.thread.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: { buyerId: true, buyerReadAt: true, sellerReadAt: true, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderId: true, createdAt: true } } },
    });
    return rows.filter((t) => {
      const last = t.messages[0];
      const readAt = t.buyerId === userId ? t.buyerReadAt : t.sellerReadAt;
      return last && last.senderId !== userId && (!readAt || readAt < last.createdAt);
    }).length;
  }
}

const OpenDto = z.object({ listingId: z.uuid().optional(), requestId: z.uuid().optional() });
const SendDto = z.object({ body: z.string().trim().min(1, 'Напишите сообщение').max(2000) });

@Controller('threads')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.chat.list(user.id);
  }

  @Post()
  open(@CurrentUser() user: AuthUser, @Body(new ZodPipe(OpenDto)) dto: z.infer<typeof OpenDto>) {
    return this.chat.open(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('before') before?: string) {
    return this.chat.get(user.id, id, before);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SendDto)) dto: z.infer<typeof SendDto>) {
    return this.chat.send(user.id, id, dto.body);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.read(user.id, id);
  }
}
