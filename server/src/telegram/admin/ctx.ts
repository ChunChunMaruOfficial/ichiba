import type { Admin } from './api.js';
import type { Result } from './ui.js';

/** What a route gets: the admin, the API on their behalf, and the route's parameters (`p.input` = a typed answer). */
export interface Ctx {
  admin: Admin;
  api: <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<T>;
  p: Record<string, unknown>;
}
export type Handler = (ctx: Ctx) => Promise<Result>;
export type Routes = Record<string, Handler>;
