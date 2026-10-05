import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Request } from 'express';

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

/** userId → whether the account may still use its sessions; short cache keeps this off the hot path. */
const sessionStatus = new Map<string, { ok: boolean; until: number }>();
/** Call after deleting or blocking an account so its sessions stop working at once, not after the cache TTL. */
export const forgetSessionStatus = (userId: string) => sessionStatus.delete(userId);

/** Global guard: every route requires a session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  /** Deleted or blocked accounts lose all their sessions within a minute, on every device. */
  private async active(userId: string) {
    const hit = sessionStatus.get(userId);
    if (hit && hit.until > Date.now()) return hit.ok;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true, blockedAt: true } });
    const ok = !!u && !u.deletedAt && !u.blockedAt;
    if (sessionStatus.size > 10_000) sessionStatus.clear();
    sessionStatus.set(userId, { ok, until: Date.now() + 60_000 });
    return ok;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[AUTH_COOKIE] ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; username: string; role: AuthUser['role'] }>(token);
        if (await this.active(payload.sub)) req.user = { id: payload.sub, username: payload.username, role: payload.role };
      } catch {
        // Expired or forged token: treat as a guest.
      }
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!isPublic && !req.user) throw new UnauthorizedException({ message: 'Войдите, чтобы продолжить' });
    return true;
  }
}
