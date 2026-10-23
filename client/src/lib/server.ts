import "server-only";
import { assertApiPath } from "./api";

/** Base URL of the public site (canonical links, sitemap, Open Graph). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
/** The API as seen from the Next.js server (same variable as the /api rewrite). */
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/**
 * Public API read for server components: cached for `revalidate` seconds, marked as a server render so it
 * isn't counted as a view. null = the resource doesn't exist (404); undefined = the API couldn't answer
 * (the page then renders the client shell, which retries and shows its own error state).
 */
export async function serverFetch<T>(path: string, revalidate = 60): Promise<T | null | undefined> {
  try {
    assertApiPath(path);
  } catch {
    return null;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers: { "x-ichiba-render": "ssr" }, next: { revalidate } });
  } catch {
    return undefined;
  }
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) return undefined;
  try {
    return (await res.json()) as T;
  } catch {
    // A proxy's HTML error page with a 200, or a cut-off body: treat it as "the API couldn't answer".
    return undefined;
  }
}

/** JSON for <script type="application/ld+json">, safe against "</script>" in user text. */
export const jsonLd = (data: unknown) => ({ __html: JSON.stringify(data).replace(/</g, "\\u003c") });

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
