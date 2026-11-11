import type { LogGroup } from './activity-labels.js';

/** User.tgAdmin: the bot's own state for an ADMIN account. */
export interface TgAdminState {
  /**
   * Opened with the account's password in one chat; dies at `until`, when the account's sessionVersion moves on, or
   * when the account is linked to another Telegram (the unlock never travels with a re-link).
   */
  session?: { until: string; sv: number; chat?: string } | null;
  /** Wrong passwords in a row; at MAX_FAILS the bot stops listening until `until`. */
  failed?: { n: number; until?: string | null } | null;
  log?: LogPrefs;
}
export interface LogPrefs {
  /** instant — a message a minute at most; hourly — one digest an hour; off. */
  mode: 'instant' | 'hourly' | 'off';
  off: LogGroup[];
  digestAt?: string | null;
}

export const MAX_FAILS = 5;
export const LOCKOUT_MS = 15 * 60_000;
/** How long one password unlock lasts (TELEGRAM_ADMIN_SESSION_HOURS, 12 by default, 1–72). */
export const sessionMs = () => Math.min(72, Math.max(1, Number(process.env.TELEGRAM_ADMIN_SESSION_HOURS) || 12)) * 3600_000;

export const stateOf = (raw: unknown): TgAdminState => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as TgAdminState) : {});
export const logPrefsOf = (s: TgAdminState): LogPrefs => ({
  mode: s.log?.mode === 'hourly' || s.log?.mode === 'off' ? s.log.mode : 'instant',
  off: Array.isArray(s.log?.off) ? s.log.off : [],
  digestAt: s.log?.digestAt ?? null,
});

export const unlocked = (s: TgAdminState, sessionVersion: number, chatId: string, now = Date.now()) =>
  !!s.session && new Date(s.session.until).getTime() > now && s.session.sv === sessionVersion && s.session.chat === chatId;
export const lockedOutFor = (s: TgAdminState, now = Date.now()) => {
  const until = s.failed?.until ? new Date(s.failed.until).getTime() : 0;
  return until > now ? until - now : 0;
};

/**
 * TELEGRAM_ADMIN_IDS (comma-separated Telegram user ids), when set, is a second gate: only those Telegram accounts
 * may open the panel at all, whatever account they are linked to.
 */
export const allowlisted = (tgUserId: number | string) => {
  const list = (process.env.TELEGRAM_ADMIN_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return !list.length || list.includes(String(tgUserId));
};

/** The owner's Telegram, the only one let into /admin unless TELEGRAM_ADMIN_USERNAMES names others. */
export const OWNER_USERNAMES = ['ChunChunMaruOn'];

/**
 * A third gate that is always on: the Telegram account's @username must be one of TELEGRAM_ADMIN_USERNAMES (by
 * default the owner's). It only ever narrows access — the numeric id linked to an ADMIN account, the password and
 * the session version are still required — because a @username can be changed or taken over by someone else once
 * released. A Telegram without a username, or one renamed, is refused (fail closed).
 */
export const ownerUsername = (username: string | undefined) => {
  const env = (process.env.TELEGRAM_ADMIN_USERNAMES ?? '').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  const list = (env.length ? env : OWNER_USERNAMES).map((s) => s.toLowerCase());
  return !!username && list.includes(username.toLowerCase());
};
