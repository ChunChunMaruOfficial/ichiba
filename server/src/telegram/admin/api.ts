import { JwtService } from '@nestjs/jwt';
import { ADMIN_COOKIE, AUTH_COOKIE } from '../../auth/auth.guard.js';

/** Who drives the bot: an ADMIN account, read from the database on every update. */
export interface Admin {
  id: string;
  username: string;
  role: 'ADMIN';
  sessionVersion: number;
}

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The bot does nothing on its own: every read and every action is a request to this server's own /admin API, the
 * one the site's admin panel uses. So the bot gets exactly the panel's rules — AdminGuard (role re-read from the
 * database), the same validation, rate limits, guarded status changes and the moderation log — and can't do anything
 * the panel can't. The request carries a session and an admin token minted for this one call (valid two minutes),
 * for the account that is linked to this Telegram and unlocked with its password; it never leaves the machine.
 */
export class AdminApi {
  constructor(private readonly jwt: JwtService) {}

  private base() {
    return (process.env.ADMIN_BOT_API_URL || `http://127.0.0.1:${Number(process.env.PORT ?? 4000)}`).replace(/\/$/, '');
  }

  async call<T>(admin: Admin, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    // Checked after the URL is normalised: «/admin/../auth/…» must not walk out of the admin API.
    const url = new URL(path, `${this.base()}/`);
    const resolved = url.pathname;
    if (!path.startsWith('/') || path.startsWith('//') || url.origin !== new URL(this.base()).origin || /(^|\/)\.\.?(\/|$)|%2e/i.test(path) || !(resolved.startsWith('/admin/') || resolved === '/ai/status')) throw new AdminApiError('Недоступно из бота', 400);
    const [session, adminToken] = await Promise.all([
      this.jwt.signAsync({ sub: admin.id, username: admin.username, role: admin.role, sv: admin.sessionVersion }, { expiresIn: '2m' }),
      this.jwt.signAsync({ sub: admin.id, purpose: 'admin' }, { expiresIn: '2m' }),
    ]);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'error',
        method,
        headers: { cookie: `${AUTH_COOKIE}=${session}; ${ADMIN_COOKIE}=${adminToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      throw new AdminApiError(`Сервер не ответил: ${(e as Error).message}`, 503);
    }
    const data = (await res.json().catch(() => null)) as (T & { message?: unknown }) | null;
    if (!res.ok) {
      const m = data?.message;
      throw new AdminApiError(Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : `Ошибка ${res.status}`, res.status);
    }
    return data as T;
  }
}

/** Query string from defined, non-empty values. */
export const qs = (p: Record<string, unknown>) => {
  const e = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return e.length ? `?${e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};
