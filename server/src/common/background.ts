import { Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';

const logger = new Logger('Background');

/**
 * Work that must not delay the response (AI review, emails). On Vercel the function may be frozen
 * right after responding, so the promise is registered with waitUntil; on a long-running host it just runs.
 * A failure is logged with its origin: the caller has already answered and can't report it.
 */
export function background(work: Promise<unknown>, what = 'job') {
  const safe = work.catch((e: unknown) => logger.warn(`${what}: ${e instanceof Error ? e.message : String(e)}`));
  try {
    waitUntil(safe);
  } catch {
    // Not inside a Vercel request: nothing to register.
  }
}
