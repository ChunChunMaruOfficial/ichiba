import { waitUntil } from '@vercel/functions';

/**
 * Work that must not delay the response (AI review, emails). On Vercel the function may be frozen
 * right after responding, so the promise is registered with waitUntil; on a long-running host it just runs.
 */
export function background(work: Promise<unknown>) {
  const safe = work.catch(() => undefined);
  try {
    waitUntil(safe);
  } catch {
    // Not inside a Vercel request: nothing to register.
  }
}
