"use client";

import { SWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";

/**
 * Data the server already fetched, handed to the client's SWR hooks as their first value: the page renders with it on
 * the server (photos in the HTML, no waiting for scripts) and the hooks refresh it in the background as usual.
 * `pages` are first pages of useInfiniteCards lists, by the key of their first page.
 */
export function SwrFallback({ data = {}, pages = {}, children }: { data?: Record<string, unknown>; pages?: Record<string, unknown>; children: React.ReactNode }) {
  const fallback: Record<string, unknown> = { ...data };
  for (const [key, page] of Object.entries(pages)) fallback[unstable_serialize(() => key)] = [page];
  return <SWRConfig value={{ fallback }}>{children}</SWRConfig>;
}
