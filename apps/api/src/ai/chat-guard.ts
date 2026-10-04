import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { EventsService } from '../events/events.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { quorumSet } from './ensemble/aggregate.js';
import { AiEnsemble } from './ensemble/ensemble.js';
import { FraudCategory, FraudSignals, fraudSignals, maskCardNumbers } from './text-rules.js';

/**
 * Chat antifraud (AI feature 11).
 * At send time (synchronous, no AI): card numbers are masked before the message is stored, and rules
 * score scam patterns — prepayment, phishing "safe deal" links, SMS-code/CVV requests, fake couriers.
 * Messages with any signal are then judged by the ensemble in the background with the conversation as
 * context; the recipient gets a warning under the message in real time. Rules alone decide only when
 * the evidence is unambiguous or no provider is reachable. Repeat offenders go to the moderation queue.
 */

export type RiskLevel = 'warn' | 'high';
export interface MessageRisk {
  level: RiskLevel;
  categories: FraudCategory[];
  text: string;
  source: 'rules' | 'ai';
}

/** Ordered by priority: the first matching category picks the warning text. */
const CATEGORIES: FraudCategory[] = ['phishing_link', 'sms_code', 'fake_delivery', 'prepayment', 'card_data', 'impersonation', 'off_platform', 'pressure', 'other'];

const WARNING: Record<FraudCategory, string> = {
  phishing_link: 'Ссылка может быть мошеннической. Не вводите данные карты на сторонних сайтах — «безопасной сделки по ссылке» у нас нет',
  sms_code: 'Никому не сообщайте коды из SMS, CVV и срок действия карты — так крадут деньги',
  card_data: 'Никому не сообщайте данные карты, CVV и коды из SMS',
  fake_delivery: 'Доставку оформляйте сами — не переходите по ссылкам «курьерских служб» из чата',
  prepayment: 'Просят предоплату переводом. Безопаснее платить при встрече или при получении',
  impersonation: 'Сотрудники площадки не пишут в чат сделки и не просят оплату',
  off_platform: 'Предлагают уйти в мессенджер. Переписка здесь сохраняется и поможет в споре',
  pressure: 'Вас торопят — частый приём мошенников. Не спешите',
  other: 'Будьте осторожны с этим сообщением',
};

const RiskVote = z.object({
  risk: z.enum(['none', 'low', 'medium', 'high']).catch('none'),
  categories: z.array(z.string()).catch([]),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
});
const RISK_SCORE = { none: 0, low: 1, medium: 2, high: 3 } as const;

const SYSTEM = `Ты система антифрода в чате C2C-маркетплейса б/у одежды в Беларуси. Оцени последнее сообщение (помечено >>>) с учётом переписки.
Типичные схемы мошенников: просят предоплату или задаток переводом на карту; присылают ссылку на «безопасную сделку», «оплату» или «оформление доставки» (фишинг); просят код из SMS, CVV, срок действия карты; выдают себя за поддержку площадки или банка; торопят; уводят в мессенджер, чтобы там прислать ссылку.
Нормально: договориться о встрече, примерке, обсудить цену, размеры, доставку Европочтой/Белпочтой, оплату при получении, обменяться телефоном для встречи.
risk: none — обычное сообщение; low — немного подозрительно; medium — похоже на схему; high — явное мошенничество.
categories — из: ${CATEGORIES.join(', ')}.`;

const levelOf = (s: FraudSignals): RiskLevel | null => (s.certain || s.score >= 4 ? 'high' : s.score >= 2 ? 'warn' : s.score >= 1 ? 'warn' : null);

function warningFor(categories: FraudCategory[], masked: boolean): string {
  const top = CATEGORIES.find((c) => categories.includes(c));
  if (top) return WARNING[top];
  return masked ? WARNING.prepayment : WARNING.other;
}

@Injectable()
export class ChatGuard {
  private readonly logger = new Logger('Antifraud');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ensemble: AiEnsemble,
    private readonly events: EventsService,
  ) {}

  /** Synchronous part of send: masked body, rule signals and the risk to store right away. */
  prepare(body: string) {
    const signals = fraudSignals(body);
    const { text, masked } = maskCardNumbers(body);
    // A card number in a seller's message means "pay me by transfer".
    if (masked && !signals.categories.includes('prepayment')) signals.categories.push('prepayment');
    const ruleLevel = levelOf(signals);
    const needsAi = signals.score > 0 || masked || /\d{7,}|руб|byn|деньг|оплат|карт|ссылк|http/i.test(body);
    // Unambiguous evidence (or no AI to ask) is flagged immediately; the rest waits for the ensemble.
    const immediate: MessageRisk | null =
      ruleLevel && (signals.certain || !this.ensemble.available) ? { level: ruleLevel, categories: signals.categories, text: warningFor(signals.categories, masked), source: 'rules' } : null;
    return { body: text, masked, signals, immediate, needsAi: needsAi && this.ensemble.available };
  }

  /** Background part: ensemble verdict → message.risk → realtime update for the recipient. */
  async review(args: { messageId: string; threadId: string; senderId: string; recipientId: string; signals: FraudSignals; masked: boolean; immediate: MessageRisk | null }) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: args.threadId },
      select: { buyerId: true, listing: { select: { title: true, price: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, senderId: true, body: true } } },
    });
    if (!thread) return;
    const history = [...thread.messages].reverse().map((m) => `${m.id === args.messageId ? '>>> ' : ''}${m.senderId === thread.buyerId ? 'Покупатель' : 'Продавец'}: ${m.body.slice(0, 500)}`);

    const { votes } = await this.ensemble.run({
      feature: 'chat_antifraud',
      system: SYSTEM,
      prompt: `Вещь: ${thread.listing.title}, ${thread.listing.price ?? '—'} BYN\nСигналы правил: ${args.signals.categories.join(', ') || 'нет'}\n\nПереписка:\n${history.join('\n')}`,
      schema: RiskVote,
      tier: 'fast',
      timeoutMs: 10_000,
      maxTokens: 200,
      temperature: 0,
      classifyUnsafe: true,
      subject: { type: 'message', id: args.messageId },
    });

    let risk: MessageRisk | null = args.immediate;
    if (votes.length) {
      const total = votes.reduce((s, v) => s + v.weight, 0);
      const score = votes.reduce((s, v) => s + RISK_SCORE[v.value.risk] * v.weight, 0) / total;
      const aiLevel: RiskLevel | null = score >= 2.3 ? 'high' : score >= 1.4 ? 'warn' : null;
      const aiCategories = quorumSet(votes, (v) => v.categories.filter((c): c is FraudCategory => (CATEGORIES as string[]).includes(c)), 0.5) as FraudCategory[];
      const categories = [...new Set([...aiCategories, ...(aiLevel ? args.signals.categories : [])])];
      // Certain rule hits stay flagged even if the models disagree; otherwise the models decide.
      const level: RiskLevel | null = args.signals.certain ? 'high' : aiLevel;
      risk = level ? { level, categories: categories.length ? categories : args.signals.categories, text: warningFor(categories.length ? categories : args.signals.categories, args.masked), source: 'ai' } : null;
    } else if (!risk) {
      const ruleLevel = levelOf(args.signals);
      risk = ruleLevel ? { level: ruleLevel, categories: args.signals.categories, text: warningFor(args.signals.categories, args.masked), source: 'rules' } : null;
    }

    if (JSON.stringify(risk) === JSON.stringify(args.immediate)) return;
    await this.prisma.message.update({ where: { id: args.messageId }, data: { risk: risk ? (risk as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
    this.events.emit(args.recipientId, { type: 'message_risk', data: { threadId: args.threadId, messageId: args.messageId, risk } });
    if (risk?.level === 'high') await this.escalate(args.senderId, args.messageId);
  }

  /** Two or more high-risk messages from one sender within a day → moderation queue (once). */
  private async escalate(senderId: string, messageId: string) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const flagged = await this.prisma.message.findMany({
      where: { senderId, createdAt: { gte: since }, risk: { path: ['level'], equals: 'high' } },
      select: { id: true, body: true, threadId: true, risk: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    if (flagged.length < 2) return;
    const open = await this.prisma.report.findFirst({ where: { targetType: 'USER', targetId: senderId, source: 'ai', status: 'OPEN' } });
    const excerpts = flagged.map((m) => ({ messageId: m.id, threadId: m.threadId, body: m.body.slice(0, 300), risk: m.risk }));
    if (open) {
      await this.prisma.report.update({ where: { id: open.id }, data: { details: { excerpts } as Prisma.InputJsonValue } });
      return;
    }
    await this.prisma.report.create({
      data: {
        reporterId: null,
        source: 'ai',
        targetType: 'USER',
        targetId: senderId,
        reason: 'Мошенничество',
        comment: `Антифрод: ${flagged.length} подозрительных сообщения за сутки. Последнее: «${flagged[0].body.slice(0, 200)}»`,
        details: { excerpts, trigger: messageId } as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(`user ${senderId} escalated to moderation (${flagged.length} high-risk messages)`);
  }
}
