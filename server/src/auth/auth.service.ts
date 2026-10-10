import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { CodePurpose, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CodeSenderService } from './code-sender.service.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
/** Per address: protects users from being spammed and the SMS balance from being drained. */
const MAX_CODES_PER_HOUR = 5;
const SIGNUP_TOKEN_TTL = '30m';
/** Bump when the privacy policy changes materially; stored with each consent. */
const PRIVACY_VERSION = '2026-10-10';
/** Dev only: any 6-digit code passes verification. Never enabled in production. */
export const DEV_ANY_CODE = process.env.AUTH_DEV_ANY_CODE === 'true' && process.env.NODE_ENV !== 'production';

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BY_OPERATOR = /^(25|29|33|44|17)\d{7}$/;

/**
 * Email is lower-cased; anything else is a phone in E.164. Belarusian habits are understood:
 * "8 029 123-45-67", "29 123 45 67" and "+375 29 1234567" all become +375291234567.
 */
function normalizeLogin(raw: string): { kind: 'email' | 'phone'; value: string } {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestException({ message: 'Проверьте адрес почты', fields: { login: 'Проверьте адрес почты' } });
    return { kind: 'email', value: email };
  }
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('80')) digits = `375${digits.slice(2)}`;
  else if (BY_OPERATOR.test(digits)) digits = `375${digits}`;
  if (digits.length < 10 || digits.length > 15 || (digits.startsWith('375') && digits.length !== 12)) {
    throw new BadRequestException({ message: 'Проверьте номер телефона', fields: { login: 'Проверьте номер: +375 XX XXX-XX-XX' } });
  }
  return { kind: 'phone', value: `+${digits}` };
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
  async ensureAdmin(user: User): Promise<User> {
    const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (user.role === 'ADMIN' || !user.email || !user.emailVerifiedAt || !admins.includes(user.email.toLowerCase())) return user;
    return this.prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  }

  signAdmin(userId: string) {
    return this.jwt.signAsync({ sub: userId, purpose: 'admin' }, { expiresIn: '8h' });
  }

  sign(user: Pick<User, 'id' | 'username' | 'role'>) {
    return this.jwt.signAsync({ sub: user.id, username: user.username, role: user.role });
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
    return `${stem}_${Date.now().toString(36)}`;
  }

  private findByContact(login: { kind: 'email' | 'phone'; value: string }) {
    return this.prisma.user.findUnique({ where: login.kind === 'email' ? { email: login.value } : { phone: login.value } });
  }

  // ---------- passwordless: one flow for sign-in and sign-up (Avito / Kufar / Vinted style) ----------

  /** Step 1: send a code to the phone or email. Same answer for new and existing accounts. */
  async start(rawLogin: string) {
    const login = normalizeLogin(rawLogin);
    await this.issueCode(login.value, 'LOGIN');
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
        data: login.kind === 'email' ? { emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } : { phoneVerifiedAt: existing.phoneVerifiedAt ?? new Date() },
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
      if (byEmail) return { user: await this.prisma.user.update({ where: { id: byEmail.id }, data: { googleSub: claims.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() } }), isNew: false };
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
    const passwordHash = await bcrypt.hash(input.password, 10);
    // An unverified leftover registration is overwritten so the address is not locked forever.
    const data = { username, passwordHash, [login.kind]: login.value, privacyAcceptedAt: new Date(), privacyVersion: PRIVACY_VERSION };
    if (existing) await this.prisma.user.update({ where: { id: existing.id }, data });
    else await this.prisma.user.create({ data });

    await this.issueCode(login.value, 'VERIFY');
    return { needsVerification: true, target: login.value };
  }

  async verify(rawLogin: string, code: string) {
    const login = normalizeLogin(rawLogin);
    await this.consumeCode(login.value, 'VERIFY', code);
    const user = await this.prisma.user.update({
      where: login.kind === 'email' ? { email: login.value } : { phone: login.value },
      data: login.kind === 'email' ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() },
    });
    return { user, isNew: !user.onboardedAt };
  }

  async login(rawLogin: string, password: string) {
    const login = normalizeLogin(rawLogin);
    const user = await this.prisma.user.findUnique({ where: login.kind === 'email' ? { email: login.value } : { phone: login.value } });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException({ message: 'Неверный email или пароль' });
    }
    if (user.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
    const verified = login.kind === 'email' ? user.emailVerifiedAt : user.phoneVerifiedAt;
    if (!verified) {
      await this.issueCode(login.value, 'VERIFY');
      return { needsVerification: true as const, target: login.value };
    }
    return { user, isNew: false };
  }

  async resend(rawLogin: string, purpose: CodePurpose) {
    const login = normalizeLogin(rawLogin);
    await this.issueCode(login.value, purpose);
    return { ok: true };
  }

  async requestReset(rawLogin: string) {
    const login = normalizeLogin(rawLogin);
    const user = await this.prisma.user.findUnique({ where: login.kind === 'email' ? { email: login.value } : { phone: login.value } });
    // Same response whether or not the account exists, to avoid account enumeration.
    if (user) await this.issueCode(login.value, 'RESET');
    return { ok: true, target: login.value };
  }

  async confirmReset(rawLogin: string, code: string, password: string) {
    const login = normalizeLogin(rawLogin);
    await this.consumeCode(login.value, 'RESET', code);
    const user = await this.prisma.user.update({
      where: login.kind === 'email' ? { email: login.value } : { phone: login.value },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        // Receiving the code proves ownership of the address.
        ...(login.kind === 'email' ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() }),
      },
    });
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
          data: { [field]: sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() },
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

  private async issueCode(target: string, purpose: CodePurpose) {
    const last = await this.prisma.verificationCode.findFirst({ where: { target, purpose }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new HttpException({ message: `Код уже отправлен — повторить можно через ${wait} с`, resendIn: wait }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const lastHour = await this.prisma.verificationCode.count({ where: { target, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (lastHour >= MAX_CODES_PER_HOUR) throw new HttpException({ message: 'Слишком много кодов за час — попробуйте позже' }, HttpStatus.TOO_MANY_REQUESTS);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const record = await this.prisma.verificationCode.create({
      data: { target, purpose, codeHash: await bcrypt.hash(code, 8), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    try {
      await this.codes.send(target, code, purpose);
    } catch (e) {
      // Not delivered: don't start the resend cooldown or count it against the hourly limit.
      await this.prisma.verificationCode.delete({ where: { id: record.id } }).catch(() => undefined);
      throw e;
    }
  }

  private async consumeCode(target: string, purpose: CodePurpose, code: string) {
    const record = await this.prisma.verificationCode.findFirst({
      where: { target, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException({ message: 'Код устарел — запросите новый', fields: { code: 'Код устарел' } });
    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      throw new HttpException({ message: 'Слишком много попыток — повторите через 5 минут' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!DEV_ANY_CODE && !(await bcrypt.compare(code, record.codeHash))) {
      await this.prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException({ message: 'Код неверный', fields: { code: 'Код неверный' } });
    }
    await this.prisma.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  }
}
