import { ConsoleLogger } from '@nestjs/common';
import { botEnabled, tg } from '../telegram/bot-api.js';

/**
 * Errors reach the admins in Telegram (the notification bot, linked from settings): everything the API logs at the
 * error level — a request that failed with a 500, a background job or an import that broke, an unhandled rejection —
 * also goes to every ADMIN account with a linked chat. Nobody watches the Railway logs; a failure should not wait for
 * a user to notice it.
 *
 * On by default where the API runs on Railway (RAILWAY_PUBLIC_DOMAIN); ALERTS_TELEGRAM=on|off overrides it. A laptop
 * shares the production bot token, so alerts never leave it unless asked to.
 */

/** The same error (place + first line, ids blurred) at most once an hour; all errors together at most 20 an hour. */
export class AlertGate {
  private readonly last = new Map<string, number>();
  private sent: number[] = [];

  constructor(
    private readonly perKeyMs = 60 * 60_000,
    private readonly perHour = 20,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    this.sent = this.sent.filter((s) => t - s < 60 * 60_000);
    if (this.sent.length >= this.perHour) return false;
    const prev = this.last.get(key);
    if (prev !== undefined && t - prev < this.perKeyMs) return false;
    if (this.last.size > 500) this.last.clear();
    this.last.set(key, t);
    this.sent.push(t);
    return true;
  }
}

/** One error kind, whatever item or user it hit: ids, numbers and quoted values don't make it a new error. */
export const alertKey = (context: string, text: string) =>
  `${context}|${(text.split('\n')[0] ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '0')
    .replace(/"[^"]*"|'[^']*'/g, '""')
    .slice(0, 200)}`;

/**
 * Takes out what must not leave the server in a chat message: tokens and keys, passwords in URLs and parameters,
 * emails and phone numbers.
 */
export function redact(text: string): string {
  return text
    .replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot<token>')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 <secret>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, '$1<user>:<password>@')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|key|code)["']?\s*[=:]\s*["']?)[^\s"'&,;}]+/gi, '$1<secret>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/(?:\+375|\b80)[\d\s()-]{7,}\d/g, '<phone>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<secret>');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The chat message: where it happened, the error and the top of its stack, at most 600 characters of it. */
export function alertText(context: string, message: string, stack?: string): string {
  const where = stack?.split('\n').slice(1, 4).map((l) => l.trim()).join('\n') ?? '';
  const body = redact([message, where].filter(Boolean).join('\n')).slice(0, 600);
  return `⚠️ <b>ichiba</b> · ${escapeHtml(context || 'API')}\n<pre>${escapeHtml(body)}</pre>`;
}

const alertsOn = () => {
  const flag = (process.env.ALERTS_TELEGRAM ?? '').toLowerCase();
  if (flag === 'off') return false;
  return (flag === 'on' || !!process.env.RAILWAY_PUBLIC_DOMAIN) && botEnabled();
};

/** The Nest logger of the API: the usual console output, and errors forwarded to the admins' Telegram. */
export class AlertLogger extends ConsoleLogger {
  private readonly gate = new AlertGate();
  private chats: () => Promise<string[]> = async () => [];
  private chatCache: { at: number; ids: string[] } | null = null;

  /** Where alerts go: the admins' linked chats, read at most every ten minutes. */
  useChats(read: () => Promise<string[]>) {
    this.chats = async () => {
      if (this.chatCache && Date.now() - this.chatCache.at < 10 * 60_000) return this.chatCache.ids;
      const ids = await read();
      this.chatCache = { at: Date.now(), ids };
      return ids;
    };
  }

  error(message: unknown, ...rest: unknown[]) {
    super.error(message, ...(rest as [string?, string?]));
    this.forward(message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]) {
    super.fatal(message, ...(rest as [string?]));
    this.forward(message, rest);
  }

  private forward(message: unknown, rest: unknown[]) {
    if (!alertsOn()) return;
    // Nest passes (message, stack?, context?); the context is the last string, the stack a string with "\n    at ".
    const strings = rest.filter((r): r is string => typeof r === 'string');
    const context = (strings.length && !strings[strings.length - 1].includes('\n') ? strings[strings.length - 1] : this.context) ?? 'API';
    const stack = strings.find((s) => s.includes('\n    at ')) ?? (message instanceof Error ? message.stack : undefined);
    const text = message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message);
    if (!this.gate.allow(alertKey(context, text))) return;
    void this.send(alertText(context, text, stack));
  }

  private async send(html: string) {
    try {
      for (const chatId of await this.chats()) {
        await tg('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      }
    } catch (e) {
      // Never through this.error: a failing Telegram must not alert about itself in a loop.
      process.stderr.write(`[Alerts] not sent: ${(e as Error).message}\n`);
    }
  }
}
