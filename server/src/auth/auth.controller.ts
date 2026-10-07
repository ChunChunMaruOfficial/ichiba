import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.js';
import type { User } from '../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import { ADMIN_COOKIE, ADMIN_SESSION_MS, AUTH_COOKIE, AuthUser, CurrentUser, Public } from './auth.guard.js';
import { AuthService, DEV_ANY_CODE, USERNAME_RE } from './auth.service.js';

const SESSION_DAYS = 30;

const login = z.string().trim().min(3, 'Введите email или телефон');
const password = z.string().min(8, 'Минимум 8 символов').max(128);
const code = z.string().regex(/^\d{6}$/, 'Код — 6 цифр');

const RegisterDto = z.object({
  login,
  password,
  username: z.string().trim().toLowerCase().regex(USERNAME_RE, 'Латиница, цифры и _, от 3 до 24 символов'),
  acceptTerms: z.literal(true, { error: 'Нужно принять условия' }),
});
const LoginDto = z.object({ login, password: z.string().min(1, 'Введите пароль') });
const VerifyDto = z.object({ login, code });
const ResendDto = z.object({ login, purpose: z.enum(['VERIFY', 'RESET']).default('VERIFY') });
const ResetConfirmDto = z.object({ login, code, password });
const TokenDto = z.object({ idToken: z.string().min(10) });
const StartDto = z.object({ login });
const CompleteDto = z.object({
  token: z.string().min(20),
  username: z.string().trim().toLowerCase().regex(USERNAME_RE, 'Латиница, цифры и _, от 3 до 24 символов'),
  acceptPrivacy: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }),
});

@Controller('auth')
@Public()
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Get('username-available')
  usernameAvailable(@Query('u') u = '') {
    return this.auth.usernameAvailability(u);
  }

  /** Passwordless step 1: code to phone (SMS) or email. */
  @Post('start')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  start(@Body(new ZodPipe(StartDto)) dto: z.infer<typeof StartDto>) {
    return this.auth.start(dto.login);
  }

  /** Step 2: existing account → session; new address → sign-up token for step 3. */
  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body(new ZodPipe(VerifyDto)) dto: z.infer<typeof VerifyDto>, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.confirm(dto.login, dto.code);
    return r.session ? this.startSession(res, r.session) : { signup: r.signup };
  }

  /** Step 3: nickname + consent to personal data processing → account created, session started. */
  @Post('complete')
  @HttpCode(200)
  async complete(@Body(new ZodPipe(CompleteDto)) dto: z.infer<typeof CompleteDto>, @Res({ passthrough: true }) res: Response) {
    return this.startSession(res, await this.auth.complete(dto.token, dto.username));
  }

  @Post('register')
  register(@Body(new ZodPipe(RegisterDto)) dto: z.infer<typeof RegisterDto>) {
    return this.auth.register(dto);
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body(new ZodPipe(VerifyDto)) dto: z.infer<typeof VerifyDto>, @Res({ passthrough: true }) res: Response) {
    return this.startSession(res, await this.auth.verify(dto.login, dto.code));
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginDto)) dto: z.infer<typeof LoginDto>, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.login, dto.password);
    if ('needsVerification' in result) return result;
    return this.startSession(res, result);
  }

  @Post('resend')
  @HttpCode(200)
  resend(@Body(new ZodPipe(ResendDto)) dto: z.infer<typeof ResendDto>) {
    return this.auth.resend(dto.login, dto.purpose);
  }

  @Post('reset/request')
  @HttpCode(200)
  resetRequest(@Body(new ZodPipe(z.object({ login }))) dto: { login: string }) {
    return this.auth.requestReset(dto.login);
  }

  @Post('reset/confirm')
  @HttpCode(200)
  async resetConfirm(@Body(new ZodPipe(ResetConfirmDto)) dto: z.infer<typeof ResetConfirmDto>, @Res({ passthrough: true }) res: Response) {
    return this.startSession(res, await this.auth.confirmReset(dto.login, dto.code, dto.password));
  }

  @Post('google')
  @HttpCode(200)
  async google(@Body(new ZodPipe(TokenDto)) dto: { idToken: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.google(dto.idToken);
    return r.session ? this.startSession(res, r.session) : { signup: r.signup };
  }

  @Post('apple')
  @HttpCode(200)
  async apple(@Body(new ZodPipe(TokenDto)) dto: { idToken: string }, @Res({ passthrough: true }) res: Response) {
    return this.startSession(res, await this.auth.apple(dto.idToken));
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    res.clearCookie(ADMIN_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** Admin area sign-in by password: starts the site session and a separate 8-hour admin session. */
  @Public()
  @Post('admin-login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async adminLogin(@Body(new ZodPipe(LoginDto)) dto: z.infer<typeof LoginDto>, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.adminLogin(dto.login, dto.password);
    const session = await this.startSession(res, { user, isNew: false });
    res.cookie(ADMIN_COOKIE, await this.auth.signAdmin(user.id), {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ADMIN_SESSION_MS,
      path: '/',
    });
    return session;
  }

  @Post('admin-logout')
  @HttpCode(200)
  adminLogout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ADMIN_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** Session bootstrap for the web app: user + header counters, or null for guests. */
  @Get('me')
  async me(@CurrentUser() user?: AuthUser) {
    return { user: user ? await this.users.me(user.id) : null };
  }

  /** Exposes which sign-in buttons should be shown. */
  @Get('providers')
  providers() {
    return { google: process.env.GOOGLE_CLIENT_ID || null, apple: process.env.APPLE_CLIENT_ID || null, devAnyCode: DEV_ANY_CODE };
  }

  private async startSession(res: Response, { user: signedIn, isNew }: { user: User; isNew: boolean }) {
    const user = await this.auth.ensureAdmin(signedIn);
    if (user.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку' });
    res.cookie(AUTH_COOKIE, await this.auth.sign(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_DAYS * 24 * 3600 * 1000,
      path: '/',
    });
    return { user: await this.users.me(user.id), isNew };
  }
}
