import { Body, ConflictException, Controller, Get, HttpCode, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { background } from '../common/background.js';
import { ZodPipe } from '../common/zod.js';
import { EmailOutbox } from '../mail/mail.module.js';
import { appUrl, esc, render } from '../mail/templates.js';
import { AdminGuard } from '../moderation/moderation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { linkButton, TelegramNotifier } from '../telegram/notifier.js';

/**
 * «Жалобы и обращения»: the electronic complaint form with an answer that a marketplace must run (Правила
 * дистанционной торговли, пост. СМ № 31, п. 14.4). Anyone can write, signed in or not; the author gets the number and
 * a copy by email at once, the admins a Telegram message; an admin answers in the panel and the answer goes to the
 * author's email. The answer is due within 15 days (the rules page and the user agreement promise it).
 */
export const TOPICS = {
  DEAL: 'Сделка',
  SELLER: 'Продавец',
  ITEM: 'Вещь',
  SITE: 'Работа сайта',
  DATA: 'Персональные данные',
  OTHER: 'Другое',
} as const;
type Topic = keyof typeof TOPICS;

export const ComplaintDto = z
  .object({
    topic: z.enum(Object.keys(TOPICS) as [Topic, ...Topic[]], { error: 'Выберите тему' }),
    about: z
      .string()
      .trim()
      .max(300, 'До 300 символов')
      .nullish()
      .transform((v) => v || null),
    text: z.string().trim().min(20, 'Опишите, что случилось, хотя бы в паре предложений').max(4000, 'До 4000 символов'),
    name: z.string().trim().min(2, 'Как к вам обращаться').max(80),
    email: z.email('Проверьте почту — на неё придёт ответ').max(200),
    /** A field people never see: bots fill it. */
    website: z.string().max(0).optional(),
  })
  .transform(({ website: _bot, ...d }) => d);

const AnswerDto = z.object({ answer: z.string().trim().min(10, 'Напишите ответ').max(6000) });

const date = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Minsk' });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** The author's text as paragraphs of the email (blank lines split them; single line breaks stay in a paragraph). */
const paragraphs = (s: string) => s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger('Complaints');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EmailOutbox,
    private readonly telegram: TelegramNotifier,
  ) {}

  async create(userId: string | null, dto: z.infer<typeof ComplaintDto>) {
    const c = await this.prisma.complaint.create({ data: { ...dto, userId } });
    const topic = TOPICS[c.topic as Topic];
    // The receipt: the number and the author's own words, so the complaint is on record on both sides.
    await this.outbox.enqueue({
      to: c.email,
      ...render({
        subject: `Обращение № ${c.number} получено — ichiba`,
        preheader: `Ответим на эту почту в течение 15 дней.`,
        title: `Обращение № ${c.number} получено`,
        lines: [
          `Здравствуйте, ${c.name}!`,
          `Мы получили ваше обращение и ответим на эту почту в течение 15 дней, обычно быстрее.`,
          `Тема: ${topic}${c.about ? ` · ${c.about}` : ''}`,
          'Ваш текст:',
          ...paragraphs(c.text),
          `Хотите что-то добавить — отправьте новое обращение и укажите в нём номер ${c.number}.`,
        ],
      }),
      kind: 'complaint_received',
      userId: null,
    });
    background(this.tellAdmins(c.number, topic, c), 'complaint-telegram');
    return { number: c.number };
  }

  /** A Telegram message to every admin with a linked chat: complaints have a deadline, nobody should miss one. */
  private async tellAdmins(number: number, topic: string, c: { name: string; email: string; about: string | null; text: string }) {
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', tgChatId: { not: null }, blockedAt: null, deletedAt: null }, select: { tgChatId: true } });
    const chats = [...new Set(admins.map((a) => a.tgChatId!))];
    if (!chats.length) return this.logger.warn(`complaint № ${number}: no admin with a linked Telegram to tell`);
    const html = [
      `📮 <b>Обращение № ${number}</b> · ${esc(topic)}`,
      `${esc(c.name)} · ${esc(c.email)}`,
      ...(c.about ? [esc(c.about)] : []),
      '',
      esc(clip(c.text, 700)),
      '',
      '<i>Ответить нужно в течение 15 дней.</i>',
    ].join('\n');
    const open = linkButton('Ответить', '/admin/complaints');
    for (const chatId of chats) await this.telegram.send(chatId, html, open.length ? [open] : []);
  }

  async list(status: string) {
    const items = await this.prisma.complaint.findMany({ where: status === 'all' ? {} : { status }, orderBy: { createdAt: 'desc' }, take: 200 });
    const ids = [...new Set(items.map((c) => c.userId).filter((id): id is string => !!id))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } }) : [];
    const nick = new Map(users.map((u) => [u.id, u.username]));
    return items.map((c) => ({ ...c, username: c.userId ? (nick.get(c.userId) ?? null) : null }));
  }

  /** The answer is final and goes to the author's email; a second question is a new complaint. */
  async answer(admin: AuthUser, id: string, answer: string) {
    const c = await this.prisma.complaint.findUnique({ where: { id } });
    if (!c) throw new NotFoundException({ message: 'Обращение не найдено' });
    // Guarded: two admins answering at once can't both send.
    const { count } = await this.prisma.complaint.updateMany({ where: { id, status: 'NEW' }, data: { status: 'ANSWERED', answer, answeredAt: new Date(), answeredBy: admin.username } });
    if (!count) throw new ConflictException({ message: 'На это обращение уже ответили' });
    await this.outbox.enqueue({
      to: c.email,
      ...render({
        subject: `Ответ на обращение № ${c.number} — ichiba`,
        preheader: clip(answer.replace(/\s+/g, ' '), 120),
        title: `Ответ на обращение № ${c.number}`,
        lines: [`Здравствуйте, ${c.name}!`, ...paragraphs(answer), `Ваше обращение от ${date(c.createdAt)}: «${clip(c.text.replace(/\s+/g, ' '), 400)}»`],
        cta: { label: 'Написать ещё', url: `${appUrl()}/complaint` },
      }),
      kind: 'complaint_answer',
      userId: null,
    });
    return { ok: true };
  }
}

@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Public()
  @Post()
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  create(@CurrentUser() user: AuthUser | undefined, @Body(new ZodPipe(ComplaintDto)) dto: z.infer<typeof ComplaintDto>) {
    return this.complaints.create(user?.id ?? null, dto);
  }
}

@Controller('admin/complaints')
@UseGuards(AdminGuard)
export class AdminComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  async list(@Query('status') status = 'NEW') {
    return { items: await this.complaints.list(status) };
  }

  @Post(':id/answer')
  @HttpCode(200)
  answer(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AnswerDto)) dto: z.infer<typeof AnswerDto>) {
    return this.complaints.answer(admin, id, dto.answer);
  }
}
