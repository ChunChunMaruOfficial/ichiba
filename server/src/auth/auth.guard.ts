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
/** Separate short admin session: the admin area asks for a password even when the admin is signed in on the site. */
export const ADMIN_COOKIE = 'ichiba_admin';
export const ADMIN_SESSION_MS = 8 * 3600 * 1000;

export interface AuthUser {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
}

/** What a session token carries; `sv` is the account's session version at sign-in (see User.sessionVersion). */
export interface SessionClaims {
  sub: string;
  username: string;
  role: AuthUser['role'];
  sv?: number;
  typ?: string;
  purpose?: string;
}

type AuthedRequest = Request & { user?: AuthUser };

const PUBLIC_KEY = 'isPublic';
/** Route works for guests; `@CurrentUser()` is undefined when not signed in. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user,
);

/** userId → whether the account may still use its sessions, and which session version is current; short cache keeps this off the hot path. */
const sessionStatus = new Map<string, { ok: boolean; version: number; until: number }>();
/** Call after deleting, blocking or re-keying an account so its sessions stop working at once, not after the cache TTL. */
export const forgetSessionStatus = (userId: string) => sessionStatus.delete(userId);

/**
 * Whether a token issued at session version `sv` still opens a session for the account: the account exists, is not
 * blocked, and nothing (password reset, block, deletion) has ended its sessions since. Shared by the HTTP guard and
 * the WebSocket handshake.
 */
export async function sessionOk(prisma: PrismaService, userId: string, sv: number) {
  const hit = sessionStatus.get(userId);
  if (hit && hit.until > Date.now()) return hit.ok && hit.version === sv;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true, blockedAt: true, sessionVersion: true } });
  const ok = !!u && !u.deletedAt && !u.blockedAt;
  if (sessionStatus.size > 10_000) sessionStatus.clear();
  sessionStatus.set(userId, { ok, version: u?.sessionVersion ?? 0, until: Date.now() + 60_000 });
  return ok && (u?.sessionVersion ?? 0) === sv;
}

/** Global guard: every route requires a session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[AUTH_COOKIE] ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<SessionClaims>(token);
        // Only session tokens open a session: WebSocket tickets and admin/unsubscribe tokens are signed with the same key.
        if (!payload.typ && !payload.purpose && payload.username && (await sessionOk(this.prisma, payload.sub, payload.sv ?? 0))) {
          req.user = { id: payload.sub, username: payload.username, role: payload.role };
        }
      } catch {
        // Expired or forged token: treat as a guest.
      }
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!isPublic && !req.user) throw new UnauthorizedException({ message: 'Войдите, чтобы продолжить' });
    return true;
  }
}
