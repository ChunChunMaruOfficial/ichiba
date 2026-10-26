import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ChatGuard, MessageRisk } from '../ai/chat-guard.js';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { background } from '../common/background.js';
import { EventsService } from '../events/events.js';
import { type ListingStatus, Prisma, type RequestStatus } from '../generated/prisma/client.js';
import { cardInclude, serializeCard } from '../listings/listing.serializer.js';
import { photoUrls, serializeVideo, videoPoster } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecommendationsService } from '../recommendations/recommendations.service.js';
import { StatsService } from '../stats/stats.js';
import { TelegramNotifier } from '../telegram/notifier.js';

/** What a message needs for its preview line (thread list, reply quote, pinned bar). */
const previewSelect = {
  id: true,
  body: true,
  kind: true,
  senderId: true,
  createdAt: true,
  deletedAt: true,
  hiddenFor: true,
  photos: { orderBy: { order: 'asc' }, take: 1, select: { key: true, provider: true } },
  videos: { take: 1, select: { key: true, provider: true } },
  _count: { select: { photos: true, videos: true } },
} satisfies Prisma.MessageSelect;
type PreviewRow = Prisma.MessageGetPayload<{ select: typeof previewSelect }>;

const messageInclude = {
  photos: { orderBy: { order: 'asc' } },
  videos: { orderBy: { createdAt: 'asc' } },
  reactions: { orderBy: { createdAt: 'asc' } },
  replyTo: { select: previewSelect },
} satisfies Prisma.MessageInclude;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

const threadInclude = {
  listing: { include: cardInclude },
  buyer: { select: { id: true, username: true } },
  seller: { select: { id: true, username: true } },
  request: { select: { id: true, number: true, status: true } },
  // A few, so the preview can skip messages the viewer deleted for themselves.
  messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 5, select: previewSelect },
} satisfies Prisma.ThreadInclude;
type ThreadRow = Prisma.ThreadGetPayload<{ include: typeof threadInclude }>;

/** Reactions anyone can put on a message (a short list, like Telegram's default). */
const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🙏', '👎'] as const;
/** Own messages can be edited for 48 hours, as in Telegram. */
const EDIT_WINDOW_MS = 48 * 3600_000;
const MAX_MEDIA = 10;
const PAGE = 50;

const LOCATION_BODY = '📍 Местоположение';
/**
 * Deal states in which the two sides need each other's contacts to hand the item over: phones, names and links in
 * chat go through. Before the seller accepts (and once the deal is over) they are hidden.
 */
const CONTACTS_OPEN: RequestStatus[] = ['WAITING_HANDOVER', 'HANDED_OVER', 'IN_TRANSIT', 'RECEIVED', 'DISPUTED'];
const contactsOpen = (status: RequestStatus | null | undefined) => !!status && CONTACTS_OPEN.includes(status);
const notices = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join('. ') || null;
/** Statuses of an item a buyer can open a chat about (a sold one still has questions: returns, a second one). */
const OPEN_TO_CHAT: ListingStatus[] = ['PUBLISHED', 'RESERVED', 'SOLD'];

/** One line for lists and quotes: "🖼 Фото", "🎬 Видео · подпись", "📍 Местоположение". */
function previewText(m: Pick<PreviewRow, 'body' | 'kind' | '_count'>) {
  if (m.kind !== 'MEDIA') return m.body;
  const { photos, videos } = m._count;
  const label = videos && photos ? `🖼 ${photos + videos} медиа` : videos ? (videos > 1 ? `🎬 ${videos} видео` : '🎬 Видео') : photos > 1 ? `🖼 ${photos} фото` : '🖼 Фото';
  return m.body ? `${label} · ${m.body}` : label;
}

const visible = (m: { deletedAt: Date | null; hiddenFor: string[] }, viewerId: string) => !m.deletedAt && !m.hiddenFor.includes(viewerId);

/** Chat about a specific item, optionally tied to a deal (frame 15). One thread per (item, buyer). */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly guard: ChatGuard,
    private readonly stats: StatsService,
    private readonly telegram: TelegramNotifier,
    private readonly recs: RecommendationsService,
  ) {}

  private quote(m: PreviewRow | null, viewerId: string) {
    if (!m) return null;
    if (!visible(m, viewerId)) return { id: m.id, mine: m.senderId === viewerId, deleted: true, text: 'Сообщение удалено', kind: m.kind, thumb: null };
    const photo = m.photos[0];
    const thumb = photo ? photoUrls(photo).s : m.videos[0] ? videoPoster(m.videos[0], 320) : null;
    return { id: m.id, mine: m.senderId === viewerId, deleted: false, text: previewText(m), kind: m.kind, thumb };
  }

  /** Antifraud warnings are shown to the recipient only. */
  private message(m: MessageRow, viewerId: string) {
    const mine = m.senderId === viewerId;
    const counts = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const r of m.reactions) {
      const c = counts.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      c.count++;
      if (r.userId === viewerId) c.mine = true;
      counts.set(r.emoji, c);
    }
    return {
      id: m.id,
      kind: m.kind,
      body: m.body,
      mine,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      risk: mine ? null : ((m.risk as MessageRisk | null) ?? null),
      location: location(m),
      media: [
        ...m.photos.map((p) => ({ type: 'photo' as const, id: p.id, width: p.width, height: p.height, urls: photoUrls(p) })),
        ...m.videos.map((v) => ({ type: 'video' as const, ...serializeVideo(v) })),
      ],
      replyTo: this.quote(m.replyTo, viewerId),
      reactions: [...counts.values()],
    };
  }

  private serialize(t: ThreadRow, viewerId: string) {
    const role = t.buyerId === viewerId ? 'buyer' : 'seller';
    const readAt = role === 'buyer' ? t.buyerReadAt : t.sellerReadAt;
    const last = t.messages.find((m) => visible(m, viewerId));
    const newest = t.messages[0];
    return {
      id: t.id,
      role,
      listing: serializeCard(t.listing),
      counterpart: role === 'buyer' ? t.seller : t.buyer,
      request: t.request,
      lastMessage: last ? { body: previewText(last), mine: last.senderId === viewerId, createdAt: last.createdAt } : null,
      lastMessageAt: t.lastMessageAt,
      unread: !!newest && newest.senderId !== viewerId && (!readAt || readAt < newest.createdAt),
      counterpartReadAt: role === 'buyer' ? t.sellerReadAt : t.buyerReadAt,
    };
  }

  private async load(id: string, viewerId: string) {
    const t = await this.prisma.thread.findUnique({ where: { id }, include: threadInclude });
    if (!t) throw new NotFoundException({ message: 'Диалог не найден' });
    if (t.buyerId !== viewerId && t.sellerId !== viewerId) throw new ForbiddenException({ message: 'Нет доступа' });
    return t;
  }

  /** Participants only; returns the other side. */
  private async members(id: string, userId: string) {
    const t = await this.prisma.thread.findUnique({ where: { id }, select: { buyerId: true, sellerId: true, request: { select: { status: true } } } });
    if (!t || (t.buyerId !== userId && t.sellerId !== userId)) throw new NotFoundException({ message: 'Диалог не найден' });
    return { other: t.buyerId === userId ? t.sellerId : t.buyerId, role: t.buyerId === userId ? ('buyer' as const) : ('seller' as const), requestStatus: t.request?.status ?? null };
  }

  /** A message of this thread that the viewer can still see. */
  private async target(threadId: string, messageId: string, userId: string) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId }, include: messageInclude });
    if (!m || m.threadId !== threadId || !visible(m, userId)) throw new NotFoundException({ message: 'Сообщение не найдено' });
    return m;
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
      // Only an item anyone can see can be asked about: a draft, hidden or blocked one isn't there for buyers.
      if (!l || !OPEN_TO_CHAT.includes(l.status) || l.hiddenByAdmin) throw new NotFoundException({ message: 'Такой вещи нет' });
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

  /** Messages the viewer can see, newest page first; `before` pages back in time. */
  async get(userId: string, id: string, before?: string) {
    const t = await this.load(id, userId);
    const at = before ? new Date(before) : null;
    if (at && Number.isNaN(at.getTime())) throw new BadRequestException({ message: 'Неверная дата' });
    const messages = await this.prisma.message.findMany({
      where: { threadId: id, deletedAt: null, NOT: { hiddenFor: { has: userId } }, createdAt: at ? { lt: at } : undefined },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: PAGE + 1,
    });
    if (this.serialize(t, userId).unread) await this.markRead(t, userId);
    return {
      thread: this.serialize(t, userId),
      messages: messages
        .slice(0, PAGE)
        .reverse()
        .map((m) => this.message(m, userId)),
      hasMore: messages.length > PAGE,
      // Older pages only need messages; pins come with the first one.
      pins: at ? undefined : await this.pins(id, userId),
    };
  }

  /** Pins the viewer sees (theirs and the shared ones), newest first, one entry per message. */
  private async pins(threadId: string, userId: string) {
    const rows = await this.prisma.messagePin.findMany({
      where: { threadId, OR: [{ forAll: true }, { userId }], message: { deletedAt: null, NOT: { hiddenFor: { has: userId } } } },
      orderBy: { createdAt: 'desc' },
      include: { message: { select: previewSelect } },
      take: 50,
    });
    const seen = new Map<string, { messageId: string; forAll: boolean; createdAt: Date; message: NonNullable<ReturnType<ChatService['quote']>> & { createdAt: Date } }>();
    for (const p of rows) {
      const prev = seen.get(p.messageId);
      if (prev) {
        prev.forAll ||= p.forAll;
        continue;
      }
      seen.set(p.messageId, { messageId: p.messageId, forAll: p.forAll, createdAt: p.createdAt, message: { ...this.quote(p.message, userId)!, createdAt: p.message.createdAt } });
    }
    return [...seen.values()];
  }

  /** Moves my read mark; the other side sees "Прочитано" live. */
  private async markRead(t: { id: string; buyerId: string; sellerId: string }, userId: string) {
    const at = new Date();
    await this.prisma.thread.update({ where: { id: t.id }, data: t.buyerId === userId ? { buyerReadAt: at } : { sellerReadAt: at } });
    await this.events.emit(t.buyerId === userId ? t.sellerId : t.buyerId, { type: 'thread_read', data: { threadId: t.id, at } });
  }

  /** "печатает…" for the other side; nothing is stored. */
  async typing(userId: string, id: string) {
    const { other } = await this.members(id, userId);
    await this.events.emit(other, { type: 'typing', data: { threadId: id } });
    return { ok: true };
  }

  /** A quoted message must be from this thread and still visible to the sender. */
  private async replyTarget(threadId: string, userId: string, replyToId?: string) {
    if (!replyToId) return null;
    const r = await this.prisma.message.findUnique({ where: { id: replyToId }, select: { threadId: true, deletedAt: true, hiddenFor: true } });
    if (!r || r.threadId !== threadId || !visible(r, userId)) throw new BadRequestException({ message: 'Сообщение, на которое вы отвечаете, удалено' });
    return replyToId;
  }

  /** Delivers a new message to the other side (live) and returns it for the sender. */
  private async deliver(t: ThreadRow, userId: string, id: string, notice: string | null) {
    const m = await this.prisma.message.findUniqueOrThrow({ where: { id }, include: messageInclude });
    const other = t.buyerId === userId ? t.sellerId : t.buyerId;
    const me = t.buyerId === userId ? t.buyer : t.seller;
    const preview = previewText({ ...m, _count: { photos: m.photos.length, videos: m.videos.length } });
    await this.events.emit(other, {
      type: 'message',
      data: { threadId: t.id, message: { ...this.message(m, other), preview, from: me.username, title: t.listing.title } },
    });
    background(this.telegram.chat(other, { threadId: t.id, from: me.username, title: t.listing.title, preview }), 'telegram for message');
    return { ...this.message(m, userId), notice };
  }

  async send(userId: string, id: string, input: { body: string; replyToId?: string; photoIds: string[]; videoIds: string[] }) {
    const t = await this.load(id, userId);
    const photoIds = [...new Set(input.photoIds)];
    const videoIds = [...new Set(input.videoIds)];
    const hasMedia = photoIds.length + videoIds.length > 0;
    if (!input.body && !hasMedia) throw new BadRequestException({ message: 'Напишите сообщение' });
    if (photoIds.length + videoIds.length > MAX_MEDIA) throw new BadRequestException({ message: `Не больше ${MAX_MEDIA} фото и видео в одном сообщении` });
    const replyToId = await this.replyTarget(id, userId, input.replyToId);

    // Only my own fresh uploads, not attached anywhere yet.
    if (hasMedia) {
      const free = { ownerId: userId, listingId: null, messageId: null };
      const [photos, videos] = await Promise.all([
        photoIds.length ? this.prisma.photo.count({ where: { id: { in: photoIds }, ...free } }) : 0,
        videoIds.length ? this.prisma.video.count({ where: { id: { in: videoIds }, ...free } }) : 0,
      ]);
      if (photos !== photoIds.length || videos !== videoIds.length) throw new BadRequestException({ message: 'Файл не найден — загрузите его ещё раз' });
    }

    const now = new Date();
    // Card numbers are masked before storage; obvious scam patterns are flagged right away.
    const check = input.body ? this.guard.prepare(input.body) : null;
    const contacts = check && !contactsOpen(t.request?.status) ? await this.guard.hideContacts(userId, check.body, t.buyerId === userId ? 'buyer' : 'seller') : null;
    if (contacts?.hidden.length && !contacts.body && !hasMedia) {
      // Only a contact: nothing to deliver. Stored deleted for both sides — it still counts towards the warnings.
      await this.prisma.message.create({ data: { threadId: id, senderId: userId, body: '', hiddenContacts: contacts.hidden, deletedAt: now, createdAt: now } });
      throw new BadRequestException({ message: contacts.notice, code: 'CONTACTS' });
    }
    const m = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          threadId: id,
          senderId: userId,
          body: contacts?.body ?? check?.body ?? '',
          hiddenContacts: contacts?.hidden ?? [],
          kind: hasMedia ? 'MEDIA' : 'TEXT',
          replyToId,
          createdAt: now,
          risk: (check?.immediate ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      for (const [order, photoId] of photoIds.entries()) await tx.photo.update({ where: { id: photoId }, data: { messageId: created.id, order } });
      if (videoIds.length) await tx.video.updateMany({ where: { id: { in: videoIds } }, data: { messageId: created.id } });
      await tx.thread.update({ where: { id }, data: { lastMessageAt: now, ...(t.buyerId === userId ? { buyerReadAt: now } : { sellerReadAt: now }) } });
      return created;
    });
    const other = t.buyerId === userId ? t.sellerId : t.buyerId;
    // Writing to the seller about an item is a strong sign of interest (once a month per item, not per message).
    if (t.buyerId === userId) background(this.recs.recordOnce(userId, 'message', t.listingId, 30 * 24 * 3600_000), 'message signal');
    if (check?.needsAi) {
      // The ensemble verdict arrives later as a "message_risk" event; sending is never blocked on it.
      background(this.guard.review({ messageId: m.id, threadId: id, senderId: userId, recipientId: other, signals: check.signals, masked: check.masked, immediate: check.immediate }));
    }
    return this.deliver(t, userId, m.id, notices(check?.masked ? CARD_NOTICE : null, contacts?.notice));
  }

  /** Shares a point on the map, like a location message in Telegram. The body is the preview line for lists. */
  async sendLocation(userId: string, id: string, point: { lat: number; lng: number; accuracy?: number; replyToId?: string }) {
    const t = await this.load(id, userId);
    const replyToId = await this.replyTarget(id, userId, point.replyToId);
    const now = new Date();
    // ~10 cm precision is plenty; the device's own noise is far larger.
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    const [m] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          threadId: id,
          senderId: userId,
          body: LOCATION_BODY,
          kind: 'LOCATION',
          lat: round(point.lat),
          lng: round(point.lng),
          accuracy: point.accuracy != null ? Math.round(point.accuracy) : null,
          replyToId,
          createdAt: now,
        },
      }),
      this.prisma.thread.update({ where: { id }, data: { lastMessageAt: now, ...(t.buyerId === userId ? { buyerReadAt: now } : { sellerReadAt: now }) } }),
    ]);
    return this.deliver(t, userId, m.id, null);
  }

  /** Edits my text or caption within 48 h. The new text goes through the same antifraud checks. */
  async edit(userId: string, id: string, messageId: string, raw: string) {
    const { other, role, requestStatus } = await this.members(id, userId);
    const m = await this.target(id, messageId, userId);
    if (m.senderId !== userId) throw new ForbiddenException({ message: 'Можно изменить только своё сообщение' });
    if (m.kind === 'LOCATION') throw new BadRequestException({ message: 'Местоположение нельзя изменить' });
    if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS) throw new BadRequestException({ message: 'Сообщение можно изменить в течение 48 часов' });
    if (!raw && m.kind === 'TEXT') throw new BadRequestException({ message: 'Напишите сообщение' });
    if (raw === m.body) return this.message(m, userId);
    // A flagged message is evidence (for the warning the recipient saw and for moderators): editing it would wipe both.
    if (m.risk) throw new ConflictException({ message: 'Это сообщение нельзя изменить' });

    const check = raw ? this.guard.prepare(raw) : null;
    const contacts = check && !contactsOpen(requestStatus) ? await this.guard.hideContacts(userId, check.body, role) : null;
    if (contacts?.hidden.length && !contacts.body && m.kind === 'TEXT') throw new BadRequestException({ message: contacts.notice, code: 'CONTACTS' });
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body: contacts?.body ?? check?.body ?? '', hiddenContacts: contacts?.hidden ?? [], editedAt: new Date(), risk: check?.immediate ? (check.immediate as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      include: messageInclude,
    });
    await this.events.emit(other, { type: 'message_update', data: { threadId: id, message: this.message(updated, other) } });
    if (check?.needsAi) {
      background(this.guard.review({ messageId, threadId: id, senderId: userId, recipientId: other, signals: check.signals, masked: check.masked, immediate: check.immediate }));
    }
    return { ...this.message(updated, userId), notice: notices(check?.masked ? CARD_NOTICE : null, contacts?.notice) };
  }

  /**
   * Deletes messages for me (any message) or for both sides (my own only). Deleted-for-both messages lose their
   * text, location and media, except ones antifraud flagged: those stay in the database for moderation.
   */
  async remove(userId: string, id: string, ids: string[], forAll: boolean) {
    const { other } = await this.members(id, userId);
    const rows = await this.prisma.message.findMany({ where: { id: { in: ids }, threadId: id }, select: { id: true, senderId: true, risk: true, deletedAt: true, hiddenFor: true } });
    const live = rows.filter((m) => visible(m, userId));
    if (!live.length) return { ok: true, ids: [] };
    const liveIds = live.map((m) => m.id);
    if (forAll) {
      if (live.some((m) => m.senderId !== userId)) throw new ForbiddenException({ message: 'У собеседника можно удалить только свои сообщения' });
      const clean = live.filter((m) => !m.risk).map((m) => m.id);
      await this.prisma.$transaction([
        this.prisma.message.updateMany({ where: { id: { in: liveIds } }, data: { deletedAt: new Date() } }),
        this.prisma.message.updateMany({ where: { id: { in: clean } }, data: { body: '', lat: null, lng: null, accuracy: null } }),
        // Detached media is removed by the nightly orphan cleanup.
        this.prisma.photo.updateMany({ where: { messageId: { in: clean } }, data: { messageId: null } }),
        this.prisma.video.updateMany({ where: { messageId: { in: clean } }, data: { messageId: null } }),
        this.prisma.messagePin.deleteMany({ where: { messageId: { in: liveIds } } }),
        this.prisma.messageReaction.deleteMany({ where: { messageId: { in: liveIds } } }),
      ]);
      await this.events.emit(other, { type: 'message_delete', data: { threadId: id, ids: liveIds } });
    } else {
      await this.prisma.$transaction([
        ...liveIds.map((mid) => this.prisma.message.update({ where: { id: mid }, data: { hiddenFor: { push: userId } } })),
        this.prisma.messagePin.deleteMany({ where: { messageId: { in: liveIds }, userId, forAll: false } }),
      ]);
    }
    return { ok: true, ids: liveIds };
  }

  /** Pins for me, or for both sides (then the other side sees it live). */
  async pin(userId: string, id: string, messageId: string, forAll: boolean) {
    const { other } = await this.members(id, userId);
    await this.target(id, messageId, userId);
    const count = await this.prisma.messagePin.count({ where: { threadId: id, OR: [{ forAll: true }, { userId }] } });
    if (count >= 50) throw new BadRequestException({ message: 'Слишком много закреплённых сообщений — открепите старые' });
    await this.prisma.messagePin.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, threadId: id, forAll },
      update: { forAll, createdAt: new Date() },
    });
    if (forAll) await this.events.emit(other, { type: 'thread_pins', data: { threadId: id } });
    return { pins: await this.pins(id, userId) };
  }

  /** Unpins for me; a shared pin (by either side) is removed for both, as in Telegram's private chats. */
  async unpin(userId: string, id: string, messageId: string) {
    const { other } = await this.members(id, userId);
    const shared = await this.prisma.messagePin.count({ where: { messageId, threadId: id, forAll: true } });
    await this.prisma.messagePin.deleteMany({ where: { messageId, threadId: id, OR: [{ userId }, { forAll: true }] } });
    if (shared) await this.events.emit(other, { type: 'thread_pins', data: { threadId: id } });
    return { pins: await this.pins(id, userId) };
  }

  /** One reaction per person: the same emoji again removes it, another one replaces it. */
  async react(userId: string, id: string, messageId: string, emoji: string | null) {
    const { other } = await this.members(id, userId);
    const m = await this.target(id, messageId, userId);
    const current = m.reactions.find((r) => r.userId === userId);
    if (!emoji || current?.emoji === emoji) await this.prisma.messageReaction.deleteMany({ where: { messageId, userId } });
    else await this.prisma.messageReaction.upsert({ where: { messageId_userId: { messageId, userId } }, create: { messageId, userId, emoji }, update: { emoji, createdAt: new Date() } });
    const updated = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
    if (visible(updated, other)) await this.events.emit(other, { type: 'message_update', data: { threadId: id, message: this.message(updated, other) } });
    return this.message(updated, userId);
  }

  async read(userId: string, id: string) {
    const t = await this.load(id, userId);
    if (this.serialize(t, userId).unread) await this.markRead(t, userId);
    return { ok: true };
  }

  /** Threads whose latest message is from the other side and newer than my read mark. */
  async unreadCount(userId: string) {
    // One query: the newest live message of each of my threads (index threadId+createdAt), counted in the database
    // instead of loading every thread on each badge refresh.
    const [row] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM "Thread" t
      CROSS JOIN LATERAL (
        SELECT m."senderId", m."createdAt" FROM "Message" m
        WHERE m."threadId" = t.id AND m."deletedAt" IS NULL
        ORDER BY m."createdAt" DESC LIMIT 1
      ) last
      WHERE (t."buyerId" = ${userId} OR t."sellerId" = ${userId})
        AND last."senderId" <> ${userId}
        AND COALESCE(CASE WHEN t."buyerId" = ${userId} THEN t."buyerReadAt" ELSE t."sellerReadAt" END, '-infinity'::timestamp) < last."createdAt"`;
    return row?.n ?? 0;
  }
}

const CARD_NOTICE = 'Номер карты скрыт. Не передавайте данные карты в чате — оплачивайте при встрече или при получении';

const location = (m: { kind: string; lat: number | null; lng: number | null; accuracy: number | null }) =>
  m.kind === 'LOCATION' && m.lat != null && m.lng != null ? { lat: m.lat, lng: m.lng, accuracy: m.accuracy } : null;

const LocationDto = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  replyToId: z.uuid().optional(),
});

const OpenDto = z.object({ listingId: z.uuid().optional(), requestId: z.uuid().optional() });
const SendDto = z.object({
  body: z.string().trim().max(2000, 'Не больше 2000 символов').default(''),
  replyToId: z.uuid().optional(),
  photoIds: z.array(z.uuid()).max(MAX_MEDIA).default([]),
  videoIds: z.array(z.uuid()).max(MAX_MEDIA).default([]),
});
const EditDto = z.object({ body: z.string().trim().max(2000, 'Не больше 2000 символов') });
const DeleteDto = z.object({ ids: z.array(z.uuid()).min(1).max(100), forAll: z.boolean().default(false) });
const PinDto = z.object({ forAll: z.boolean().default(false) });
const ReactDto = z.object({ emoji: z.enum(REACTIONS).nullable() });

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
    return this.chat.send(user.id, id, dto);
  }

  @Post(':id/messages/delete')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DeleteDto)) dto: z.infer<typeof DeleteDto>) {
    return this.chat.remove(user.id, id, dto.ids, dto.forAll);
  }

  @Put(':id/messages/:messageId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  edit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body(new ZodPipe(EditDto)) dto: z.infer<typeof EditDto>) {
    return this.chat.edit(user.id, id, messageId, dto.body);
  }

  @Post(':id/messages/:messageId/pin')
  @HttpCode(200)
  pin(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body(new ZodPipe(PinDto)) dto: z.infer<typeof PinDto>) {
    return this.chat.pin(user.id, id, messageId, dto.forAll);
  }

  @Delete(':id/messages/:messageId/pin')
  unpin(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string) {
    return this.chat.unpin(user.id, id, messageId);
  }

  @Put(':id/messages/:messageId/reaction')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  react(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body(new ZodPipe(ReactDto)) dto: z.infer<typeof ReactDto>) {
    return this.chat.react(user.id, id, messageId, dto.emoji);
  }

  @Post(':id/location')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendLocation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(LocationDto)) dto: z.infer<typeof LocationDto>) {
    return this.chat.sendLocation(user.id, id, dto);
  }

  @Post(':id/typing')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  typing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.typing(user.id, id);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.read(user.id, id);
  }
}
