import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

export const AUTH_COOKIE = 'ichiba_token';

export interface AuthUser {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
}

type AuthedRequest = Request & { user?: AuthUser };

const PUBLIC_KEY = 'isPublic';
/** Route works for guests; `@CurrentUser()` is undefined when not signed in. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user,
);

/** Role and block state are re-read from the DB (cached briefly), so a ban or role change applies to live sessions. */
const STATE_TTL_MS = 30_000;
const stateCache = new Map<string, { at: number; role: AuthUser['role']; blocked: boolean } | { at: number; missing: true }>();

/** Global guard: every route requires a session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  private async state(userId: string) {
    const hit = stateCache.get(userId);
    if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, blockedAt: true } });
    const next = u ? { at: Date.now(), role: u.role, blocked: !!u.blockedAt } : { at: Date.now(), missing: true as const };
    if (stateCache.size > 10_000) stateCache.clear();
    stateCache.set(userId, next);
    return next;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[AUTH_COOKIE] ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; username: string; role: AuthUser['role']; typ?: string }>(token);
        if (!payload.typ) req.user = { id: payload.sub, username: payload.username, role: payload.role };
      } catch {
        // Expired or forged token: treat as a guest.
      }
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (req.user) {
      const s = await this.state(req.user.id);
      if ('missing' in s) req.user = undefined;
      else if (s.blocked) {
        // A banned account browses as a guest and cannot act.
        req.user = undefined;
        if (!isPublic) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку', code: 'BLOCKED' });
      } else req.user.role = s.role;
    }
    if (!isPublic && !req.user) throw new UnauthorizedException({ message: 'Войдите, чтобы продолжить' });
    return true;
  }
}
