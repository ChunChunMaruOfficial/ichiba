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

/** Global guard: every route requires a session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[AUTH_COOKIE] ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; username: string; role: AuthUser['role'] }>(token);
        req.user = { id: payload.sub, username: payload.username, role: payload.role };
      } catch {
        // Expired or forged token: treat as a guest.
      }
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!isPublic && !req.user) throw new UnauthorizedException({ message: 'Войдите, чтобы продолжить' });
    return true;
  }
}
