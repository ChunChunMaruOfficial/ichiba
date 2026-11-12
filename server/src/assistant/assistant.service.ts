import { Injectable, Logger } from '@nestjs/common';
import { activitySource } from '../activity/activity.js';
import { AiEnsemble, RunBudget } from '../ai/ensemble/ensemble.js';
import { maskCardNumbers } from '../ai/text-rules.js';
import { AuctionsService } from '../auctions/auctions.js';
import { background } from '../common/background.js';
import type { AssistantMessage, Prisma } from '../generated/prisma/client.js';
import { ListingsService } from '../listings/listings.service.js';
import { esc } from '../mail/templates.js';
import { OffersService } from '../offers/offers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestsService } from '../requests/requests.service.js';
import { StatsService } from '../stats/stats.js';
import { TelegramNotifier } from '../telegram/notifier.js';
import { UsersService } from '../users/users.service.js';
import { findTopic } from './knowledge.js';
import { linkRows } from './links.js';
import { answerOf, asksMenu, asksUndo, BUSY, limitReached, NOTHING_TO_UNDO, LIMITS, menu, NOT_NOW, OFF_TOPIC, press, PRESETS, UNCLEAR, WELCOME } from './menu.js';
import { looksLikeSteering, planStep, type PlanInput } from './planner.js';
import { quick } from './quick.js';
import { toolByName } from './tools/index.js';
import { why } from './tools/shared.js';
import { Refusal, type Keyboard, type Tool, type ToolCtx } from './types.js';

export const PAGE = 50;
/** «Отменить» works this long after the action. */
export const UNDO_MS = 24 * 3600_000;
/** A «Сделать?» question nobody answered stops being valid: the account has moved on. */
const CONFIRM_MS = 3600_000;
const SUGGEST_MS = 10 * 60_000;
/** Things changed for one account per hour (the services are called past the HTTP rate limits, so the chat has its own). */
export const ACTIONS_PER_HOUR = 20;
/** Messages a day that go to a model; past that the chat answers from the menu and the help sections. */
export const AI_PER_DAY = 80;
/** Typed messages a minute; the HTTP rate limit behind it is a wider backstop, this one answers in the chat. */
export const MESSAGES_PER_MINUTE = 10;
const MAX_STEPS = 3;
/** Not a tool of the registry: the chat itself undoes the last thing it did (see undoLast). */
export const UNDO_LAST = 'undo_last';

/**
 * The model's words before they are shown: no ids (they mean nothing to a person), no addresses it made up — pages
 * are given only as buttons from the list of known links — and no markdown the chat doesn't draw.
 */
export const tidy = (say: string) =>
  say
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/(https?:\/\/|www\.)\S+/gi, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();

type Sent = Pick<AssistantMessage, 'id' | 'fromBot' | 'body' | 'createdAt'> & { buttons: Keyboard | null };
const out = (m: AssistantMessage): Sent => ({ id: m.id, fromBot: m.fromBot, body: m.body, buttons: (m.buttons as Keyboard | null) ?? null, createdAt: m.createdAt });

/**
 * The «Ichiba» chat: one conversation per account with an assistant that answers questions about the platform and
 * does things on the account for its owner — through the same services the site and the Telegram bot use, always as
 * the signed-in user. Whatever it changes is reported with «Отменить»; what can't be put back is asked first.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger('Assistant');
  /** A site-wide cap on model runs a minute: the chat must not eat the quota listing moderation needs. */
  private readonly budget = new RunBudget(30);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiEnsemble,
    private readonly listings: ListingsService,
    private readonly requests: RequestsService,
    private readonly offers: OffersService,
    private readonly auctions: AuctionsService,
    private readonly stats: StatsService,
    private readonly users: UsersService,
    private readonly telegram: TelegramNotifier,
  ) {}

  private ctx(userId: string): ToolCtx {
    return { userId, prisma: this.prisma, listings: this.listings, requests: this.requests, offers: this.offers, auctions: this.auctions, stats: this.stats, users: this.users };
  }

  private async isSeller(userId: string) {
    return (await this.prisma.listing.count({ where: { sellerId: userId, status: { not: 'DELETED' } } })) > 0;
  }

  /** The greeting is not stored: an account that never wrote has an empty table and still sees it. */
  private async welcome(userId: string, at: Date): Promise<Sent> {
    return { id: 'welcome', fromBot: true, body: WELCOME, buttons: menu(await this.isSeller(userId)), createdAt: at };
  }

  async history(userId: string, before?: Date) {
    const rows = await this.prisma.assistantMessage.findMany({ where: { userId, ...(before ? { createdAt: { lt: before } } : {}) }, orderBy: { createdAt: 'desc' }, take: PAGE + 1 });
    const hasMore = rows.length > PAGE;
    const messages = rows.slice(0, PAGE).reverse().map(out);
    const user = await this.prisma.user.update({ where: { id: userId }, data: { assistantReadAt: new Date() }, select: { createdAt: true } });
    return { messages: hasMore ? messages : [await this.welcome(userId, user.createdAt), ...messages], hasMore };
  }

  /** The row in the list of chats: the last line and whether there is something unread. */
  async summary(userId: string) {
    const [last, user] = await Promise.all([
      this.prisma.assistantMessage.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { assistantReadAt: true, createdAt: true } }),
    ]);
    if (!last) return { lastMessage: WELCOME.split('\n')[0], fromBot: true, lastMessageAt: user.createdAt, unread: !user.assistantReadAt };
    return { lastMessage: last.body.slice(0, 140), fromBot: last.fromBot, lastMessageAt: last.createdAt, unread: last.fromBot && (!user.assistantReadAt || user.assistantReadAt < last.createdAt) };
  }

  async read(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { assistantReadAt: new Date() } });
    return { ok: true };
  }

  private async say(userId: string, body: string, buttons: Keyboard = [], actionId?: string): Promise<Sent> {
    return out(await this.prisma.assistantMessage.create({ data: { userId, fromBot: true, body, buttons: buttons.length ? (buttons as unknown as Prisma.InputJsonValue) : undefined, actionId } }));
  }

  private async heard(userId: string, body: string): Promise<Sent> {
    return out(await this.prisma.assistantMessage.create({ data: { userId, fromBot: false, body } }));
  }

  // ---------- a typed message ----------

  /**
   * One thing at a time per account: a second message or button while the first is still being carried out (a double
   * tap, two tabs) is answered «ещё выполняю» instead of running next to it — two bulk price changes at once would
   * each start from the same prices. In this process's memory, which is where the work itself runs.
   */
  private readonly working = new Set<string>();
  private async oneAtATime<T extends { messages: Sent[] }>(userId: string, work: () => Promise<T>): Promise<T | { messages: Sent[] }> {
    if (this.working.has(userId)) return { messages: [await this.say(userId, BUSY)] };
    this.working.add(userId);
    try {
      return await work();
    } finally {
      this.working.delete(userId);
    }
  }

  send(userId: string, raw: string): Promise<{ messages: Sent[] }> {
    return this.oneAtATime(userId, () => this.sendNow(userId, raw));
  }

  private async sendNow(userId: string, raw: string): Promise<{ messages: Sent[] }> {
    const text = maskCardNumbers(raw.trim().slice(0, 500)).text;
    // Counted before this message is saved: the tenth in a minute is still answered, the eleventh gets the limit.
    const wait = await this.waitFor('message', userId, MESSAGES_PER_MINUTE, 60_000);
    const mine = await this.heard(userId, text);
    if (wait) return { messages: [mine, await this.say(userId, limitReached(LIMITS.minute(MESSAGES_PER_MINUTE), wait))] };
    return { messages: [mine, ...(await this.reply(userId, text))] };
  }

  private async reply(userId: string, text: string): Promise<Sent[]> {
    // «Предложить улучшение» was pressed: the next message is the suggestion itself, whatever it says.
    const waiting = await this.prisma.assistantAction.findFirst({ where: { userId, tool: 'suggest', status: 'PENDING', createdAt: { gt: new Date(Date.now() - SUGGEST_MS) } } });
    if (waiting) return [await this.suggest(userId, text, waiting.id)];
    if (looksLikeSteering(text)) return [await this.say(userId, OFF_TOPIC, [[press('menu', 'Меню')]])];
    if (asksUndo(text)) return this.undoLast(userId);
    if (asksMenu(text)) return [await this.say(userId, 'Чем помочь? Напишите своими словами или выберите:', menu(await this.isSeller(userId)))];
    // The commonest requests need no model: done at once (and when no provider answers).
    const fast = quick(text);
    if (fast) return [await this.act(userId, toolByName(fast.tool)!, toolByName(fast.tool)!.args.parse(fast.args))];

    if (!this.ai.available) return [await this.offline(userId, text)];
    // The message just saved is one of them, hence the +1.
    const day = await this.waitFor('message', userId, AI_PER_DAY + 1, 24 * 3600_000);
    if (day) return [await this.say(userId, limitReached(LIMITS.day(AI_PER_DAY), day), [[press('menu', 'Меню')]])];
    if (!this.budget.take()) return [await this.say(userId, limitReached(LIMITS.busy, 60_000))];

    try {
      return await this.think(userId, text);
    } catch (e) {
      this.logger.error(`reply to ${userId} failed: ${(e as Error).stack ?? e}`);
      return [await this.say(userId, NOT_NOW, menu(await this.isSeller(userId)))];
    }
  }

  /** No model to ask: the help section that fits the words, or the menu. */
  private async offline(userId: string, text: string) {
    const topic = findTopic(text);
    if (topic) return this.say(userId, topic.text, [...linkRows(topic.links), [press('menu', 'Меню')]]);
    return this.say(userId, NOT_NOW, menu(await this.isSeller(userId)));
  }

  private async account(userId: string) {
    const [u, byStatus] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, city: true, brandVerifiedAt: true, tgChatId: true, tgSessionVersion: true, sessionVersion: true } }),
      this.prisma.listing.groupBy({ by: ['status'], where: { sellerId: userId, status: { not: 'DELETED' } }, _count: true }),
    ]);
    return {
      ник: u.username,
      город: u.city,
      бренд: !!u.brandVerifiedAt,
      telegramПривязан: !!u.tgChatId && u.tgSessionVersion === u.sessionVersion,
      вещейПоСтатусам: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      сегодня: new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' }),
    };
  }

  /** The loop: the model looks things up (read tools) until it can answer or act; at most MAX_STEPS model runs. */
  private async think(userId: string, text: string): Promise<Sent[]> {
    const recent = await this.prisma.assistantMessage.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 9 });
    const input: PlanInput = {
      account: await this.account(userId),
      // Without the message just saved (it goes last, on its own).
      history: recent.slice(1).reverse().map((m) => ({ who: m.fromBot ? ('помощник' as const) : ('человек' as const), text: m.body.slice(0, 400) })),
      message: text,
      observations: [],
    };
    const ctx = this.ctx(userId);
    for (let step = 0; step < MAX_STEPS; step++) {
      const plan = await planStep(this.ai, input, userId);
      if (!plan) return [await this.offline(userId, text)];
      if (!plan.onTopic) return [await this.say(userId, OFF_TOPIC, [[press('menu', 'Меню')]])];

      // «Отмени», «верни как было»: the same as pressing «Отменить» under the last thing done.
      if (plan.calls?.some((c) => c.tool === UNDO_LAST)) return this.undoLast(userId);

      const calls: Array<{ tool: Tool; args: unknown }> = [];
      for (const c of plan.calls ?? []) {
        const tool = toolByName(c.tool);
        const args = tool?.args.safeParse(c.args);
        if (tool && args?.success) calls.push({ tool, args: args.data });
        // A call that doesn't hold is told back to the model, never run «as close as possible».
        else input.observations.push({ tool: c.tool, args: c.args, result: { error: tool ? `аргументы не подходят: ${args?.error?.issues[0]?.message ?? ''}` : 'такого инструмента нет' } });
      }
      const reads = calls.filter((c) => c.tool.kind === 'read');
      if (reads.length) {
        for (const c of reads) {
          try {
            input.observations.push({ tool: c.tool.name, args: c.args, result: (await c.tool.run(ctx, c.args)).data });
          } catch (e) {
            input.observations.push({ tool: c.tool.name, args: c.args, result: { error: why(e) } });
          }
        }
        continue;
      }
      if (calls.length) {
        const sent: Sent[] = [];
        for (const c of calls.slice(0, 3)) sent.push(await this.act(userId, c.tool, c.args));
        return sent;
      }
      const words = tidy(plan.say);
      if (words) return [await this.say(userId, words, linkRows(plan.links ?? undefined))];
      if (!input.observations.length) break;
    }
    return [await this.say(userId, UNCLEAR, [[press('menu', 'Меню')]])];
  }

  private async undoLast(userId: string): Promise<Sent[]> {
    const done = await this.prisma.assistantAction.findMany({ where: { userId, status: 'DONE', createdAt: { gt: new Date(Date.now() - UNDO_MS) } }, orderBy: { createdAt: 'desc' }, take: 10 });
    const last = done.find((a) => a.snapshot != null && toolByName(a.tool)?.undo);
    if (!last) return [await this.say(userId, NOTHING_TO_UNDO)];
    return (await this.pressed(userId, `undo:${last.id}`)).messages;
  }

  // ---------- doing things ----------

  /**
   * How long until the account is under a limit again: 0 when it is under it now. With `limit` things in the window
   * already, the next one is allowed when the oldest of the newest `limit` leaves the window.
   */
  private async waitFor(what: 'message' | 'action', userId: string, limit: number, windowMs: number) {
    const since = { gt: new Date(Date.now() - windowMs) };
    const page = { orderBy: { createdAt: 'desc' as const }, skip: limit - 1, take: 1, select: { createdAt: true } };
    const [edge] =
      what === 'message'
        ? await this.prisma.assistantMessage.findMany({ where: { userId, fromBot: false, createdAt: since }, ...page })
        : await this.prisma.assistantAction.findMany({ where: { userId, status: { in: ['DONE', 'UNDONE'] }, tool: { not: 'suggest' }, createdAt: since }, ...page });
    return edge ? Math.max(1000, edge.createdAt.getTime() + windowMs - Date.now()) : 0;
  }

  private refused(userId: string, e: unknown) {
    return this.say(userId, why(e), e instanceof Refusal ? linkRows(e.links) : []);
  }

  /** Runs a tool the model asked for: at once with «Отменить», or as a question when it can't be put back. */
  private async act(userId: string, tool: Tool, args: unknown): Promise<Sent> {
    const wait = await this.waitFor('action', userId, ACTIONS_PER_HOUR, 3600_000);
    if (wait) return this.say(userId, limitReached(LIMITS.hour(ACTIONS_PER_HOUR), wait));
    const ctx = this.ctx(userId);
    try {
      const question = tool.kind === 'confirm' ? await tool.preview!(ctx, args) : await tool.ask?.(ctx, args);
      if (question) {
        const a = await this.prisma.assistantAction.create({ data: { userId, tool: tool.name, args: args as Prisma.InputJsonValue, status: 'PENDING' } });
        return await this.say(userId, question, [[press(`ok:${a.id}`, 'Сделать'), press(`no:${a.id}`, 'Отмена')]], a.id);
      }
      return await this.run(userId, tool, args);
    } catch (e) {
      if (why(e) === 'не получилось' && !(e instanceof Refusal)) this.logger.error(`${tool.name} for ${userId}: ${(e as Error).stack ?? e}`);
      return this.refused(userId, e);
    }
  }

  private async run(userId: string, tool: Tool, args: unknown, actionId?: string): Promise<Sent> {
    const result = await activitySource.run('помощник', () => tool.run(this.ctx(userId), args));
    const data = { snapshot: (result.snapshot ?? undefined) as Prisma.InputJsonValue | undefined, report: result.report.slice(0, 4000), status: 'DONE' };
    const a = actionId
      ? await this.prisma.assistantAction.update({ where: { id: actionId }, data })
      : await this.prisma.assistantAction.create({ data: { userId, tool: tool.name, args: args as Prisma.InputJsonValue, ...data } });
    const undo = tool.undo && result.snapshot !== undefined ? [[press(`undo:${a.id}`, 'Отменить')]] : [];
    return this.say(userId, result.report, [...undo, ...linkRows(result.links)], a.id);
  }

  /** The buttons under a message have done their job: they go, so nothing can be pressed twice. */
  private async spend(userId: string, actionId: string, keep: (id: string) => boolean = () => false) {
    const msgs = await this.prisma.assistantMessage.findMany({ where: { userId, actionId } });
    for (const m of msgs) {
      const rows = ((m.buttons as Keyboard | null) ?? []).map((r) => r.filter((b) => b.kind === 'link' || keep(b.id))).filter((r) => r.length);
      await this.prisma.assistantMessage.update({ where: { id: m.id }, data: { buttons: rows as unknown as Prisma.InputJsonValue } });
    }
    return msgs.map((m) => m.id);
  }

  // ---------- a pressed button ----------

  press(userId: string, id: string): Promise<{ messages: Sent[]; spent?: string[] }> {
    // «Поднять вещи» needs no model to understand it: the tool runs at once.
    if (id === 'say:bump') {
      return this.oneAtATime(userId, async () => ({ messages: [await this.heard(userId, PRESETS.bump), await this.act(userId, toolByName('bump')!, { filter: {} })] }));
    }
    // A menu button that sends a ready phrase takes the turn itself, in send().
    if (id.startsWith('say:')) return PRESETS[id.slice(4)] ? this.send(userId, PRESETS[id.slice(4)]) : Promise.resolve({ messages: [] });
    return this.oneAtATime(userId, () => this.pressed(userId, id));
  }

  private async pressed(userId: string, id: string): Promise<{ messages: Sent[]; spent?: string[] }> {
    const [kind, arg = ''] = id.split(/:(.*)/s);
    if (kind === 'menu') return { messages: [await this.say(userId, 'Чем помочь?', menu(await this.isSeller(userId)))] };
    if (kind === 'kb') {
      const a = answerOf(arg);
      if (!a) return { messages: [] };
      return { messages: [await this.heard(userId, a.title), await this.say(userId, a.text, [...linkRows(a.links), [press('menu', 'Меню')]])] };
    }
    if (kind === 'suggest') {
      const a = await this.prisma.assistantAction.create({ data: { userId, tool: 'suggest', args: {}, status: 'PENDING' } });
      return {
        messages: [
          await this.heard(userId, 'Предложить улучшение'),
          await this.say(userId, 'Напишите одним сообщением, что стоит добавить или исправить на Ichiba, — передам команде как есть.', [[press(`no:${a.id}`, 'Отмена')]], a.id),
        ],
      };
    }
    if (!['undo', 'ok', 'no'].includes(kind)) return { messages: [] };

    const action = await this.prisma.assistantAction.findFirst({ where: { id: arg, userId } });
    if (!action) return { messages: [] };
    const tool = toolByName(action.tool);

    if (kind === 'no') {
      const { count } = await this.prisma.assistantAction.updateMany({ where: { id: action.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      const spent = await this.spend(userId, action.id);
      return { messages: count ? [await this.say(userId, 'Хорошо, ничего не менял.')] : [], spent };
    }
    if (kind === 'ok') {
      const fresh = action.createdAt.getTime() > Date.now() - CONFIRM_MS;
      // Claimed first: a double tap can't run it twice.
      // What was stored is checked again as if it had just come from the model: nothing runs on trust in a row.
      const args = tool?.args.safeParse(action.args);
      const valid = fresh && !!tool && tool.name !== 'suggest' && !!args?.success;
      const { count } = await this.prisma.assistantAction.updateMany({ where: { id: action.id, status: 'PENDING' }, data: { status: valid ? 'RUNNING' : 'CANCELLED' } });
      const spent = await this.spend(userId, action.id);
      if (!count) return { messages: [], spent };
      if (!valid || !tool || !args?.success) return { messages: [await this.say(userId, 'Этот вопрос устарел — напишите ещё раз, что сделать.')], spent };
      try {
        return { messages: [await this.run(userId, tool, args.data, action.id)], spent };
      } catch (e) {
        await this.prisma.assistantAction.update({ where: { id: action.id }, data: { status: 'FAILED', report: why(e).slice(0, 4000) } });
        if (why(e) === 'не получилось' && !(e instanceof Refusal)) this.logger.error(`${tool.name} for ${userId}: ${(e as Error).stack ?? e}`);
        return { messages: [await this.refused(userId, e)], spent };
      }
    }
    // undo
    if (!tool?.undo || action.snapshot == null) return { messages: [] };
    if (action.createdAt.getTime() < Date.now() - UNDO_MS) return { messages: [await this.say(userId, 'Отменить можно в течение суток — это действие старше.')], spent: await this.spend(userId, action.id) };
    const { count } = await this.prisma.assistantAction.updateMany({ where: { id: action.id, status: 'DONE' }, data: { status: 'UNDONE', undoneAt: new Date() } });
    const spent = await this.spend(userId, action.id);
    if (!count) return { messages: [], spent };
    try {
      const report = await activitySource.run('помощник', () => tool.undo!(this.ctx(userId), action.snapshot));
      return { messages: [await this.say(userId, `Отменено. ${report}`)], spent };
    } catch (e) {
      // Not put back: the action counts as done again, and the person can try once more.
      await this.prisma.assistantAction.update({ where: { id: action.id }, data: { status: 'DONE', undoneAt: null } });
      this.logger.error(`undo of ${action.tool} for ${userId}: ${(e as Error).stack ?? e}`);
      return { messages: [await this.say(userId, `Отменить не получилось: ${why(e)}.`, [[press(`undo:${action.id}`, 'Отменить')]], action.id)], spent };
    }
  }

  // ---------- suggestions ----------

  private async suggest(userId: string, text: string, actionId: string) {
    const s = await this.prisma.suggestion.create({ data: { userId, text } });
    await this.prisma.assistantAction.update({ where: { id: actionId }, data: { status: 'DONE', report: `Предложение № ${s.number}` } });
    await this.spend(userId, actionId);
    background(this.tellAdmins(userId, s.number, text), 'suggestion-telegram');
    return this.say(userId, `Спасибо! Предложение № ${s.number} передал команде.`);
  }

  private async tellAdmins(userId: string, number: number, text: string) {
    const [author, admins] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
      this.prisma.user.findMany({ where: { role: 'ADMIN', tgChatId: { not: null }, blockedAt: null, deletedAt: null }, select: { tgChatId: true } }),
    ]);
    const html = `💡 <b>Предложение № ${number}</b> · @${esc(author?.username ?? '—')}\n\n${esc(text)}`;
    for (const chatId of new Set(admins.map((a) => a.tgChatId!))) await this.telegram.send(chatId, html);
  }
}
