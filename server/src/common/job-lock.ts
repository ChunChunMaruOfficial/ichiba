import { Logger } from '@nestjs/common';
import type { RedisService } from '../redis/redis.js';

const logger = new Logger('Jobs');
/** Jobs running on this instance, so a slow run is never overlapped by the next tick even without Redis. */
const running = new Set<string>();

/**
 * Runs a scheduled job once at a time: across instances through a Redis lock (`SET NX PX`, held for `ttlMs` or
 * until the job ends), and within this process through an in-memory set. Two replicas, or the old and the new
 * container overlapping during a deploy, would otherwise both close the same auctions, publish the same drafts and
 * send every notification twice. Errors are logged, never thrown into the scheduler.
 */
export async function withJobLock(redis: RedisService, name: string, ttlMs: number, work: () => Promise<void>) {
  if (running.has(name)) return;
  running.add(name);
  const key = `ichiba:job:${name}`;
  let locked = false;
  try {
    if (redis.client) {
      try {
        locked = (await redis.client.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
      } catch (e) {
        // Redis unavailable: the in-process guard still holds, and a single instance is the common deployment.
        logger.warn(`${name}: lock unavailable (${(e as Error).message}), running unlocked`);
        locked = false;
        await work();
        return;
      }
      if (!locked) return;
    }
    await work();
  } catch (e) {
    logger.error(`${name}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  } finally {
    running.delete(name);
    if (locked) await redis.client?.del(key).catch(() => undefined);
  }
}
