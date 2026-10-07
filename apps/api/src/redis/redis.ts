import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';

/**
 * Optional Redis (REDIS_URL, e.g. Upstash `rediss://…`): fans real-time events out across API instances
 * and keeps rate limits shared between serverless instances. Without it everything stays in-process.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  private readonly url = process.env.REDIS_URL || null;
  private clients: Redis[] = [];
  private main: Redis | null = null;

  get enabled() {
    return !!this.url;
  }

  private create(name: string) {
    const client = new Redis(this.url!, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false, connectionName: `ichiba-${name}` });
    client.on('error', (e) => this.logger.warn(`${name}: ${e.message}`));
    this.clients.push(client);
    return client;
  }

  /** Shared command connection, or null when Redis is not configured. */
  get client(): Redis | null {
    if (!this.url) return null;
    return (this.main ??= this.create('main'));
  }

  /** A dedicated connection (subscribers cannot run regular commands). */
  duplicate(name: string): Redis | null {
    return this.url ? this.create(name) : null;
  }

  async ping() {
    if (!this.client) return null;
    return (await this.client.ping()) === 'PONG';
  }

  async onModuleDestroy() {
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** Fixed-window rate limit counters in Redis, so limits hold across instances. */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;
    const blockedFor = await this.redis.pttl(blockKey);
    if (blockedFor > 0) return { totalHits: limit + 1, timeToExpire: Math.ceil(blockedFor / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(blockedFor / 1000) };

    const res = await this.redis.multi().incr(hitsKey).pexpire(hitsKey, ttl, 'NX').pttl(hitsKey).exec();
    const totalHits = Number(res?.[0]?.[1] ?? 1);
    const pttl = Number(res?.[2]?.[1] ?? ttl);
    if (totalHits > limit) {
      await this.redis.set(blockKey, '1', 'PX', blockDuration || ttl);
      return { totalHits, timeToExpire: Math.ceil(pttl / 1000), isBlocked: true, timeToBlockExpire: Math.ceil((blockDuration || ttl) / 1000) };
    }
    return { totalHits, timeToExpire: Math.ceil(pttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
  }
}
