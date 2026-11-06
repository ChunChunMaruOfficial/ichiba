import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { CodePurpose, Prisma, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { forgetSessionStatus } from './auth.guard.js';
import { CodeSenderService } from './code-sender.service.js';
import { botEnabled, tg } from '../telegram/bot-api.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
/** Per address and purpose: protects users from being spammed with codes, without letting a stranger's sign-in attempts lock the owner out of a password reset. */
const MAX_CODES_PER_HOUR = 5;
/** Compared against when the account doesn't exist, so a wrong address costs the same time as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync('ichiba-no-such-account', 10);
/** A password registration waiting for its code: created as an account only by `verify`. */
type PendingRegistration = { username: string; passwordHash: string };
const SIGNUP_TOKEN_TTL = '30m';
/** Bump when the privacy policy changes materially; stored with each consent. */
export const PRIVACY_VERSION = '2026-11-05';
/** Dev only: any 6-digit code passes verification. Never enabled in production. */
export const DEV_ANY_CODE = process.env.AUTH_DEV_ANY_CODE === 'true' && process.env.NODE_ENV !== 'production';

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const DEVICE_KEY_DAYS = 90;
const hashDeviceKey = (key: string) => createHash('sha256').update(key).digest('hex');
/** Nicks an account made by hand may carry (a shop named in Cyrillic): what signing in by nick accepts. */
const LOGIN_NICK_RE = /^[a-z0-9_а-яё]{3,24}$/;

export const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** Sign-in is by email only (no SMS gateway): the address is lower-cased and checked. */
function normalizeLogin(raw: string): { kind: 'email' | 'phone'; value: string } {
  const email = raw.trim().toLowerCase();
  if (!email.includes('@')) throw new BadRequestException({ message: 'Вход только по почте', fields: { login: 'Введите адрес почты' } });
  if (!EMAIL_RE.test(email)) throw new BadRequestException({ message: 'Проверьте адрес почты', fields: { login: 'Проверьте адрес почты' } });
  return { kind: 'email', value: email };
}

/** Pending sign-up after a confirmed code or a new Google/Telegram account: the account is created on "complete". */
type SignupClaims =
  | { purpose: 'signup'; kind: 'email' | 'phone'; value: string }
  | { purpose: 'signup'; kind: 'google'; sub: string; email?: string; nameHint?: string }
  | { purpose: 'signup'; kind: 'telegram'; sub: string; nameHint?: string };

/** Fields the Telegram Login Widget hands to the page (https://core.telegram.org/widgets/login). */
export interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/** A widget login older than this is refused (replay protection). */
const TELEGRAM_AUTH_MAX_AGE_S = 24 * 3600;

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly codes: CodeSenderService,
  ) {}

  /**
   * Admin area sign-in: password only (no codes, no Google), and only for ADMIN accounts. Every failure
   * looks the same, so the form doesn't reveal which logins exist or who is an admin.
   */
  async adminLogin(rawLogin: string, password: string) {
    const fail = () => new UnauthorizedException({ message: 'Неверный логин или пароль' });
    let login: ReturnType<typeof normalizeLogin>;
    try {
      login = normalizeLogin(rawLogin);
    } catch {
      throw fail();
    }
    const user = await this.prisma.user.findUnique({ where: login.kind === 'email' ? { email: login.value } : { phone: login.value } });
    const ok = !!user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw fail();
    const checked = await this.ensureAdmin(user);
    if (checked.role !== 'ADMIN' || checked.blockedAt || checked.deletedAt) throw fail();
    return checked;
  }

  /**
   * Accounts whose verified email is listed in ADMIN_EMAILS (comma-separated) become admins on sign-in:
   * the way to get the first moderator on a fresh production database.
   */
  // ---------- device keys: one tap back into an account this browser signed out of ----------

  /** A fresh key for the signed-in account, to be kept by the browser; 90 days. Only its hash is stored. */
  async createDeviceKey(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, blockedAt: true, deletedAt: true } });
    if (!user || user.blockedAt || user.deletedAt) throw new UnauthorizedException({ message: 'Войдите заново' });
    const key = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + DEVICE_KEY_DAYS * 24 * 3600 * 1000);
    await this.prisma.deviceKey.create({ data: { userId, keyHash: hashDeviceKey(key), sessionVersion: user.sessionVersion, expiresAt } });
    // A browser keeps one key per account; the account keeps the last few, so an old browser's key still works.
    const stale = await this.prisma.deviceKey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: 10, select: { id: true } });
    if (stale.length) await this.prisma.deviceKey.deleteMany({ where: { id: { in: stale.map((k) => k.id) } } });
    return { key, expiresAt };
  }

  /** The account behind a key, for a session; an expired or outdated key is refused and dropped. */
  async deviceLogin(key: string) {
    const stored = await this.prisma.deviceKey.findUnique({ where: { keyHash: hashDeviceKey(key) }, include: { user: true } });
    const gone = new UnauthorizedException({ message: 'Быстрый вход устарел — войдите заново', code: 'DEVICE_KEY_GONE' });
    if (!stored) throw gone;
    const { user } = stored;
    if (stored.expiresAt < new Date() || stored.sessionVersion !== user.sessionVersion || user.deletedAt) {
      await this.prisma.deviceKey.delete({ where: { id: stored.id } }).catch(() => undefined);
      throw gone;
    }
    if (user.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
    await this.prisma.deviceKey.update({ where: { id: stored.id }, data: { lastUsedAt: new Date() } });
    return { user, isNew: false };
  }

  /** The browser forgot the account: the key goes too. */
  async revokeDeviceKey(key: string) {
    await this.prisma.deviceKey.deleteMany({ where: { keyHash: hashDeviceKey(key) } });
  }

  async ensureAdmin(user: User): Promise<User> {
    const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (user.role === 'ADMIN' || !user.email || !user.emailVerifiedAt || !admins.includes(user.email.toLowerCase())) return user;
    return this.prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  }

  signAdmin(userId: string) {
    return this.jwt.signAsync({ sub: userId, purpose: 'admin' }, { expiresIn: '8h' });
  }

  sign(user: Pick<User, 'id' | 'username' | 'role' | 'sessionVersion'>) {
    return this.jwt.signAsync({ sub: user.id, username: user.username, role: user.role, sv: user.sessionVersion });
  }

  async usernameAvailability(raw: string) {
    const username = raw.trim().toLowerCase().replace(/^@/, '');
    if (!USERNAME_RE.test(username)) return { available: false, reason: 'Латиница, цифры и _, от 3 до 24 символов' };
    const taken = await this.prisma.user.findUnique({ where: { username } });
    if (!taken) return { available: true };
    return { available: false, reason: `@${username} занят`, suggestion: await this.suggestUsername(username) };
  }

  private async suggestUsername(base: string) {
    const stem = base.replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'user';
    for (const suffix of ['_mnsk', '_by', String(randomInt(10, 99)), String(randomInt(100, 9999))]) {
      const candidate = `${stem}${suffix}`;
      if (!(await this.prisma.user.findUnique({ where: { username: candidate } }))) return candidate;
    }
    return `${stem.slice(0, 16)}_${Date.now().toString(36)}`;
  }

  private findByContact(login: { kind: 'email' | 'phone'; value: string }) {
    return this.prisma.user.findUnique({ where: login.kind === 'email' ? { email: login.value } : { phone: login.value } });
  }

  /**
   * The account a password reset is for: by its sign-in address, else by its notification address. Shops imported
   * by nick and Telegram accounts have no sign-in address, but a seller's notification address was confirmed by a
   * code too (users/notify-email.ts), so it can take the reset code. That address is not unique: shared by two
   * accounts, it resets neither.
   */
  private async findForReset(login: { kind: 'email' | 'phone'; value: string }) {
    const user = await this.findByContact(login);
    if (user || login.kind !== 'email') return user;
    const byNotify = await this.prisma.user.findMany({ where: { notifyEmail: login.value, deletedAt: null }, take: 2 });
    return byNotify.length === 1 ? byNotify[0] : null;
  }

  // ---------- passwordless: one flow for sign-in and sign-up (Avito / Kufar / Vinted style) ----------

  /** Step 1: send a code to the phone or email. Same answer for new and existing accounts. */
  async start(rawLogin: string) {
    const login = normalizeLogin(rawLogin);
    const existing = await this.findByContact(login);
    await this.issueCode(login.value, 'LOGIN', undefined, existing?.tgChatId);
    return { target: login.value, kind: login.kind, resendIn: RESEND_COOLDOWN_MS / 1000 };
  }

  /**
   * Step 2: check the code. An existing account signs in right away; for a new address the caller gets a
   * short-lived sign-up token and fills in the nickname + consent (step 3). Nothing is created before consent.
   */
  async confirm(rawLogin: string, code: string) {
    const login = normalizeLogin(rawLogin);
    await this.consumeCode(login.value, 'LOGIN', code);
    const existing = await this.findByContact(login);
    if (existing) {
      if (existing.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { ...this.adoptUnverified(existing, login.kind), ...(login.kind === 'email' ? { emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } : { phoneVerifiedAt: existing.phoneVerifiedAt ?? new Date() }) },
      });
      return { session: { user, isNew: !user.onboardedAt } };
    }
    const hint = login.kind === 'email' ? login.value.split('@')[0] : `user${randomInt(1000, 10000)}`;
    return {
      signup: {
        token: await this.jwt.signAsync({ purpose: 'signup', kind: login.kind, value: login.value } satisfies SignupClaims, { expiresIn: SIGNUP_TOKEN_TTL }),
        contact: login.value,
        suggestion: await this.freeUsername(hint),
      },
    };
  }

  /** Step 3: nickname + consent → the account exists and the session starts. */
  async complete(token: string, username: string) {
    let claims: SignupClaims;
    try {
      claims = await this.jwt.verifyAsync<SignupClaims>(token);
      if (claims.purpose !== 'signup') throw new Error('purpose');
    } catch {
      throw new UnauthorizedException({ message: 'Время на регистрацию истекло — начните заново', code: 'SIGNUP_EXPIRED' });
    }
    const name = username.toLowerCase();
    const consent = { privacyAcceptedAt: new Date(), privacyVersion: PRIVACY_VERSION };

    if (claims.kind === 'google') {
      // The account may have appeared meanwhile (second tab): then just sign in.
      const existing = await this.prisma.user.findUnique({ where: { googleSub: claims.sub } });
      if (existing) return { user: existing, isNew: false };
      await this.assertUsername(name);
      const byEmail = claims.email ? await this.prisma.user.findUnique({ where: { email: claims.email } }) : null;
      if (byEmail) return { user: await this.prisma.user.update({ where: { id: byEmail.id }, data: { ...this.adoptUnverified(byEmail, 'email'), googleSub: claims.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() } }), isNew: false };
      const user = await this.prisma.user.create({ data: { username: name, googleSub: claims.sub, email: claims.email ?? null, emailVerifiedAt: claims.email ? new Date() : null, ...consent } });
      return { user, isNew: true };
    }

    if (claims.kind === 'telegram') {
      const existing = await this.prisma.user.findUnique({ where: { telegramId: claims.sub } });
      if (existing) return { user: existing, isNew: false };
      await this.assertUsername(name);
      const user = await this.prisma.user.create({ data: { username: name, telegramId: claims.sub, ...consent } });
      return { user, isNew: true };
    }

    const login = { kind: claims.kind, value: claims.value };
    const existing = await this.findByContact(login);
    if (existing) return { user: existing, isNew: false };
    await this.assertUsername(name);
    const user = await this.prisma.user.create({
      data: { username: name, ...(login.kind === 'email' ? { email: login.value, emailVerifiedAt: new Date() } : { phone: login.value, phoneVerifiedAt: new Date() }), ...consent },
    });
    return { user, isNew: true };
  }

  /**
   * An address proven by a code or an identity provider may find an older row that was registered with a password
   * but never verified: that password was set by whoever typed the address first, so it is dropped. The person who
   * proved the address keeps the row and sets a password through «Забыли пароль» if they want one.
   */
  private adoptUnverified(existing: User, kind: 'email' | 'phone'): Prisma.UserUpdateInput {
    const verified = kind === 'email' ? existing.emailVerifiedAt : existing.phoneVerifiedAt;
    return !verified && existing.passwordHash ? { passwordHash: null } : {};
  }

  private async assertUsername(name: string) {
    const avail = await this.usernameAvailability(name);
    if (!avail.available) throw new ConflictException({ message: avail.reason, fields: { username: avail.reason }, suggestion: avail.suggestion });
  }

  private async freeUsername(hint: string) {
    const base = hint.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18);
    const stem = base.length >= 3 ? base : `user${base}`;
    return (await this.usernameAvailability(stem)).available ? stem : this.suggestUsername(stem);
  }

  async register(input: { login: string; password: string; username: string }) {
    const login = normalizeLogin(input.login);
    const username = input.username.toLowerCase();
    const avail = await this.usernameAvailability(username);
    if (!avail.available) throw new ConflictException({ message: avail.reason, fields: { username: avail.reason }, suggestion: avail.suggestion });

    const existing = await this.prisma.user.findUnique({ where: login.kind === 'email' ? { email: login.value } : { phone: login.value } });
    if (existing && (existing.emailVerifiedAt || existing.phoneVerifiedAt)) {
      throw new ConflictException({ message: 'Аккаунт с таким email уже есть — Войти?', code: 'ACCOUNT_EXISTS' });
    }
    // The nick and password travel inside the code: the account appears only when the address owner enters it,
    // so nobody can plant a password on an address they don't own (and nothing is overwritten by a second attempt).
    await this.issueCode(login.value, 'VERIFY', { username, passwordHash: await bcrypt.hash(input.password, 10) });
    return { needsVerification: true, target: login.value };
  }

  async verify(rawLogin: string, code: string) {
    const login = normalizeLogin(rawLogin);
    const record = await this.consumeCode(login.value, 'VERIFY', code);
    const pending = this.pendingOf(record.payload);
    const existing = await this.findByContact(login);
    const verifiedAt = login.kind === 'email' ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() };
    const consent = { privacyAcceptedAt: new Date(), privacyVersion: PRIVACY_VERSION };
    if (existing) {
      if (existing.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
      const verified = login.kind === 'email' ? existing.emailVerifiedAt : existing.phoneVerifiedAt;
      let data: Prisma.UserUpdateInput = verified ? {} : this.adoptUnverified(existing, login.kind);
      if (pending && !verified) {
        // The row is an unverified leftover: it takes what this person chose, nothing from whoever typed the address before.
        if (pending.username !== existing.username) await this.assertUsername(pending.username);
        data = { username: pending.username, passwordHash: pending.passwordHash, ...consent };
      }
      const user = await this.prisma.user.update({ where: { id: existing.id }, data: { ...data, ...verifiedAt } });
      return { user, isNew: !user.onboardedAt };
    }
    if (!pending) throw new UnauthorizedException({ message: 'Регистрация не найдена — начните заново', code: 'SIGNUP_EXPIRED' });
    await this.assertUsername(pending.username);
    const user = await this.prisma.user.create({
      data: { username: pending.username, passwordHash: pending.passwordHash, [login.kind]: login.value, ...verifiedAt, ...consent },
    });
    return { user, isNew: true };
  }

  private pendingOf(payload: Prisma.JsonValue | null): PendingRegistration | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const { username, passwordHash } = payload as Record<string, unknown>;
    return typeof username === 'string' && USERNAME_RE.test(username) && typeof passwordHash === 'string' ? { username, passwordHash } : null;
  }

  async login(rawLogin: string, password: string) {
    // Accounts made without an address (shops imported from Telegram) sign in with their nick and password.
    const nick = rawLogin.trim().toLowerCase().replace(/^@/, '');
    if (!nick.includes('@') && LOGIN_NICK_RE.test(nick)) {
      const user = await this.prisma.user.findUnique({ where: { username: nick } });
      if (!user?.passwordHash || user.email || user.phone || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new UnauthorizedException({ message: 'Неверный ник или пароль' });
      }
      if (user.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
      return { user, isNew: false };
    }
    const login = normalizeLogin(rawLogin);
    const user = await this.prisma.user.findUnique({ where: login.kind === 'email' ? { email: login.value } : { phone: login.value } });
    // Unknown addresses still pay for a hash comparison, so timing doesn't tell them apart from wrong passwords.
    if (!(await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)) || !user?.passwordHash) {
      throw new UnauthorizedException({ message: 'Неверный email или пароль' });
    }
    if (user.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
    const verified = login.kind === 'email' ? user.emailVerifiedAt : user.phoneVerifiedAt;
    if (!verified) {
      // The password was just proven: it rides along with the code, so verifying keeps it (verify() drops unproven ones).
      await this.issueCode(login.value, 'VERIFY', { username: user.username, passwordHash: user.passwordHash });
      return { needsVerification: true as const, target: login.value };
    }
    return { user, isNew: false };
  }

  async resend(rawLogin: string, purpose: CodePurpose) {
    const login = normalizeLogin(rawLogin);
    const user = await this.findByContact(login);
    if (purpose === 'VERIFY') {
      // A fresh code for a registration still waiting carries the same nick and password; for a nobody, nothing is sent.
      const last = await this.prisma.verificationCode.findFirst({ where: { target: login.value, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
      const pending = this.pendingOf(last?.payload ?? null);
      if (!pending && !user) return { ok: true };
      await this.issueCode(login.value, purpose, pending ?? undefined);
      return { ok: true };
    }
    // RESET: same answer whether or not the account exists (no enumeration), a code only when it does.
    return this.requestReset(rawLogin);
  }

  async requestReset(rawLogin: string) {
    const login = normalizeLogin(rawLogin);
    const user = await this.findForReset(login);
    // Same response whether or not the account exists, to avoid account enumeration. The log says why nothing went
    // out, so «the code never came» can be told apart from a delivery problem.
    if (user) await this.issueCode(login.value, 'RESET', undefined, user.tgChatId);
    else this.logger.log(`[RESET] no account for ${login.value.replace(/^(.{2}).*@/, '$1***@')}: no code sent`);
    return { ok: true, target: login.value };
  }

  async confirmReset(rawLogin: string, code: string, password: string) {
    const login = normalizeLogin(rawLogin);
    await this.consumeCode(login.value, 'RESET', code);
    const existing = await this.findForReset(login);
    if (!existing) throw new BadRequestException({ message: 'Код устарел — запросите новый', fields: { code: 'Код устарел' } });
    if (existing.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
    const user = await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        // A new password ends every other session of the account (a stolen cookie included); the caller starts a fresh one.
        sessionVersion: { increment: 1 },
        // Receiving the code proves ownership of the address (the sign-in one; a notification address is confirmed already).
        ...(login.kind === 'email' ? (existing.email === login.value ? { emailVerifiedAt: new Date() } : {}) : { phoneVerifiedAt: new Date() }),
      },
    });
    forgetSessionStatus(user.id);
    return { user, isNew: false };
  }

  async google(idToken: string) {
    if (!this.googleClient) throw new ServiceUnavailableException({ message: 'Вход через Google ещё не настроен' });
    const ticket = await this.googleClient
      .verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID })
      .catch(() => {
        throw new UnauthorizedException({ message: 'Не удалось войти через Google' });
      });
    const p = ticket.getPayload();
    if (!p?.sub) throw new UnauthorizedException({ message: 'Не удалось войти через Google' });
    const email = p.email_verified ? p.email?.toLowerCase() : undefined;
    const bySub = await this.prisma.user.findUnique({ where: { googleSub: p.sub } });
    const byEmail = !bySub && email ? await this.prisma.user.findUnique({ where: { email } }) : null;
    if (bySub || byEmail) return { session: await this.upsertOAuth('googleSub', p.sub, email) };
    // New person: ask for a nickname and consent before creating the account.
    const hint = (p.given_name && /^[a-z0-9_]+$/i.test(p.given_name) ? p.given_name : email?.split('@')[0]) ?? 'user';
    return {
      signup: {
        token: await this.jwt.signAsync({ purpose: 'signup', kind: 'google', sub: p.sub, email, nameHint: hint } satisfies SignupClaims, { expiresIn: SIGNUP_TOKEN_TTL }),
        contact: email ?? 'Google',
        suggestion: await this.freeUsername(hint),
      },
    };
  }

  /**
   * Telegram Login Widget: the payload is signed with HMAC-SHA256 keyed by SHA-256(bot token), so only Telegram
   * (which knows the token) can produce it. Telegram gives no email, so accounts are matched by Telegram id only.
   */
  async telegram(data: TelegramAuthData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) throw new ServiceUnavailableException({ message: 'Вход через Telegram ещё не настроен' });
    const { hash, ...fields } = data;
    const checkString = Object.keys(fields)
      .filter((k) => fields[k as keyof typeof fields] !== undefined)
      .sort()
      .map((k) => `${k}=${fields[k as keyof typeof fields]}`)
      .join('\n');
    const expected = createHmac('sha256', createHash('sha256').update(botToken).digest()).update(checkString).digest();
    const given = Buffer.from(hash, 'hex');
    const fresh = Date.now() / 1000 - data.auth_date < TELEGRAM_AUTH_MAX_AGE_S;
    if (given.length !== expected.length || !timingSafeEqual(given, expected) || !fresh) {
      throw new UnauthorizedException({ message: 'Не удалось войти через Telegram — попробуйте ещё раз' });
    }
    const sub = String(data.id);
    const existing = await this.prisma.user.findUnique({ where: { telegramId: sub } });
    if (existing?.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
    if (existing) return { session: { user: existing, isNew: false } };
    // New person: ask for a nickname and consent before creating the account.
    const hint = data.username ?? (data.first_name && /^[a-z0-9_]+$/i.test(data.first_name) ? data.first_name : 'user');
    return {
      signup: {
        token: await this.jwt.signAsync({ purpose: 'signup', kind: 'telegram', sub, nameHint: hint } satisfies SignupClaims, { expiresIn: SIGNUP_TOKEN_TTL }),
        contact: data.username ? `@${data.username}` : 'Telegram',
        suggestion: await this.freeUsername(hint),
      },
    };
  }

  async apple(idToken: string) {
    if (!process.env.APPLE_CLIENT_ID) throw new ServiceUnavailableException({ message: 'Вход через Apple ещё не настроен' });
    const { payload } = await jwtVerify(idToken, appleJwks, {
      issuer: 'https://appleid.apple.com',
      audience: process.env.APPLE_CLIENT_ID,
    }).catch(() => {
      throw new UnauthorizedException({ message: 'Не удалось войти через Apple' });
    });
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    return this.upsertOAuth('appleSub', String(payload.sub), email, email?.split('@')[0]);
  }

  private async upsertOAuth(field: 'googleSub' | 'appleSub', sub: string, email?: string, nameHint?: string) {
    const bySub = await this.prisma.user.findUnique({ where: { [field]: sub } as { googleSub: string } });
    if (bySub?.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
    if (bySub) return { user: bySub, isNew: false };
    const normalizedEmail = email?.toLowerCase();
    if (normalizedEmail) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (byEmail) {
        const user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { ...this.adoptUnverified(byEmail, 'email'), [field]: sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() },
        });
        return { user, isNew: false };
      }
    }
    const base = (nameHint ?? 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'user';
    const username = (await this.usernameAvailability(base)).available ? base : await this.suggestUsername(base);
    const user = await this.prisma.user.create({
      data: { username, [field]: sub, email: normalizedEmail, emailVerifiedAt: normalizedEmail ? new Date() : null },
    });
    return { user, isNew: true };
  }

  /** Also used by users/notify-email.ts, whose codes carry the requesting account ({ userId }). */
  /**
   * `tgChatId`: the account's linked Telegram chat also gets the code (sign-in and reset of an existing account), so a
   * letter lost to a spam folder doesn't lock anyone out. Delivered if either way worked.
   */
  async issueCode(target: string, purpose: CodePurpose, payload?: PendingRegistration | { userId: string }, tgChatId?: string | null) {
    const last = await this.prisma.verificationCode.findFirst({ where: { target, purpose }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new HttpException({ message: `Код уже отправлен — повторить можно через ${wait} с`, resendIn: wait }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const lastHour = await this.prisma.verificationCode.count({ where: { target, purpose, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (lastHour >= MAX_CODES_PER_HOUR) throw new HttpException({ message: 'Слишком много кодов за час — попробуйте позже' }, HttpStatus.TOO_MANY_REQUESTS);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const record = await this.prisma.verificationCode.create({
      data: { target, purpose, codeHash: await bcrypt.hash(code, 8), expiresAt: new Date(Date.now() + CODE_TTL_MS), payload: payload ?? undefined },
    });
    const [mail, telegram] = await Promise.allSettled([this.codes.send(target, code, purpose), tgChatId && botEnabled() ? this.sendCodeToTelegram(tgChatId, code, purpose) : Promise.reject(null)]);
    if (telegram.status === 'rejected' && telegram.reason) this.logger.warn(`[${purpose}] code to Telegram failed: ${(telegram.reason as Error).message}`);
    if (telegram.status === 'fulfilled') this.logger.log(`[${purpose}] code sent to Telegram`);
    if (mail.status === 'rejected' && telegram.status === 'rejected') {
      // Not delivered: don't start the resend cooldown or count it against the hourly limit.
      await this.prisma.verificationCode.delete({ where: { id: record.id } }).catch(() => undefined);
      throw mail.reason;
    }
  }

  private sendCodeToTelegram(chatId: string, code: string, purpose: CodePurpose) {
    const what = purpose === 'RESET' ? 'сброса пароля' : purpose === 'LOGIN' ? 'входа' : 'подтверждения';
    return tg('sendMessage', {
      chat_id: chatId,
      text: `Код для ${what} в ichiba: <b>${code}</b>\nДействует 10 минут. Если вы ничего не запрашивали — просто проигнорируйте.`,
      parse_mode: 'HTML',
    });
  }

  /** `scope` narrows the codes looked at, e.g. to those one account asked for. */
  async consumeCode(target: string, purpose: CodePurpose, code: string, scope?: Prisma.VerificationCodeWhereInput) {
    const record = await this.prisma.verificationCode.findFirst({
      where: { ...scope, target, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException({ message: 'Код устарел — запросите новый', fields: { code: 'Код устарел' } });
    // The attempt is taken before the comparison, so parallel guesses can't share the same five tries.
    const claimed = await this.prisma.verificationCode.updateMany({ where: { id: record.id, attempts: { lt: MAX_CODE_ATTEMPTS }, consumedAt: null }, data: { attempts: { increment: 1 } } });
    if (!claimed.count) throw new HttpException({ message: 'Слишком много попыток — запросите новый код' }, HttpStatus.TOO_MANY_REQUESTS);
    if (!DEV_ANY_CODE && !(await bcrypt.compare(code, record.codeHash))) {
      throw new BadRequestException({ message: 'Код неверный', fields: { code: 'Код неверный' } });
    }
    const consumed = await this.prisma.verificationCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (!consumed.count) throw new BadRequestException({ message: 'Код устарел — запросите новый', fields: { code: 'Код устарел' } });
    return record;
  }
}
