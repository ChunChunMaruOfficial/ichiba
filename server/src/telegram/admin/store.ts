import { randomBytes } from 'node:crypto';
import type { RedisService } from '../../redis/redis.js';
import type { Go } from './ui.js';

/** What a chat is in the middle of: the panel message to edit, and the question waiting for a typed answer. */
export interface ChatState {
  panel?: number;
  ask?: { then: Go; back: Go; secret?: boolean; text: string; skip?: string };
}

const STATE_TTL_S = 24 * 3600;
const SCREEN_TTL_S = 3 * 24 * 3600;

/**
 * Short-lived bot state in Redis (memory when Redis is not configured): the routes behind a screen's buttons and
 * the chat's state. A button's callback data is `ad:<screen>:<n>` — a random screen id and a button number — and
 * the screen is stored under the chat's id, so a forged or replayed callback from another chat finds nothing.
 */
export class AdminStore {
  private readonly mem = new Map<string, { v: string; until: number }>();

  constructor(private readonly redis: RedisService) {}

  private async get(key: string): Promise<string | null> {
    const k = `ichiba:tgadm:${key}`;
    if (this.redis.client) {
      try {
        return await this.redis.client.get(k);
      } catch {
        // Redis down: this instance's memory.
      }
    }
    const hit = this.mem.get(k);
    return hit && hit.until > Date.now() ? hit.v : null;
  }

  private async set(key: string, v: string | null, ttlS: number) {
    const k = `ichiba:tgadm:${key}`;
    if (this.redis.client) {
      try {
        if (v === null) await this.redis.client.del(k);
        else await this.redis.client.set(k, v, 'EX', ttlS);
        return;
      } catch {
        // Redis down: this instance's memory.
      }
    }
    if (v === null) this.mem.delete(k);
    else {
      if (this.mem.size > 5000) for (const [mk, mv] of this.mem) if (mv.until < Date.now()) this.mem.delete(mk);
      if (this.mem.size > 10_000) this.mem.clear();
      this.mem.set(k, { v, until: Date.now() + ttlS * 1000 });
    }
  }

  /** Forgets a counter or a flag (a right password clears the wrong-password counter). */
  reset(key: string) {
    return this.set(key, null, 1);
  }

  /** True the first time a key is seen within `ttlS` (replayed updates). */
  async once(key: string, ttlS: number) {
    const k = `ichiba:tgadm:${key}`;
    if (this.redis.client) {
      try {
        return (await this.redis.client.set(k, '1', 'EX', ttlS, 'NX')) === 'OK';
      } catch {
        // Redis down: memory.
      }
    }
    if ((await this.get(key)) !== null) return false;
    await this.set(key, '1', ttlS);
    return true;
  }

  /** A counter that lives `ttlS` seconds (rate limits). */
  async count(key: string, ttlS: number) {
    const k = `ichiba:tgadm:${key}`;
    if (this.redis.client) {
      try {
        const n = await this.redis.client.incr(k);
        if (n === 1) await this.redis.client.expire(k, ttlS);
        return n;
      } catch {
        // Redis down: memory.
      }
    }
    const n = Number((await this.get(key)) ?? 0) + 1;
    await this.set(key, String(n), ttlS);
    return n;
  }

  async state(chatId: string): Promise<ChatState> {
    const raw = await this.get(`st:${chatId}`);
    try {
      return raw ? (JSON.parse(raw) as ChatState) : {};
    } catch {
      return {};
    }
  }

  async saveState(chatId: string, s: ChatState) {
    await this.set(`st:${chatId}`, JSON.stringify(s), STATE_TTL_S);
  }

  /** Keeps a screen's routes; returns the id its buttons carry. */
  async saveScreen(chatId: string, routes: Go[]) {
    const id = randomBytes(9).toString('base64url');
    await this.set(`scr:${chatId}:${id}`, JSON.stringify(routes), SCREEN_TTL_S);
    return id;
  }

  async route(chatId: string, data: string): Promise<Go | null> {
    const m = /^ad:([A-Za-z0-9_-]{12}):(\d{1,3})$/.exec(data);
    if (!m) return null;
    const raw = await this.get(`scr:${chatId}:${m[1]}`);
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as Go[])[Number(m[2])] ?? null;
    } catch {
      return null;
    }
  }
}
