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
import { randomInt } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { CodePurpose, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CodeSenderService } from './code-sender.service.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
/** Dev only: any 6-digit code passes verification. Never enabled in production. */
export const DEV_ANY_CODE = process.env.AUTH_DEV_ANY_CODE === 'true' && process.env.NODE_ENV !== 'production';

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/** Email is lower-cased; anything else is treated as a phone and reduced to +digits. */
export function normalizeLogin(raw: string): { kind: 'email' | 'phone'; value: string } {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) return { kind: 'email', value: trimmed.toLowerCase() };
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) throw new BadRequestException({ message: 'Проверьте email или телефон', fields: { login: 'Проверьте email или телефон' } });
  return { kind: 'phone', value: `+${digits}` };
}

@Injectable()
export class AuthService {
  private googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly codes: CodeSenderService,
  ) {}

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
    const data = { username, passwordHash, [login.kind]: login.value };
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
    return this.upsertOAuth('googleSub', p.sub, p.email_verified ? p.email : undefined, p.email?.split('@')[0]);
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
      throw new HttpException({ message: 'Код уже отправлен — повторите через минуту' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.verificationCode.create({
      data: { target, purpose, codeHash: await bcrypt.hash(code, 8), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    await this.codes.send(target, code, purpose);
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
