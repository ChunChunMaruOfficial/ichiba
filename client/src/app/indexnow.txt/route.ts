import { serverFetch } from "@/lib/server";

/**
 * The IndexNow key (indexnow.org): the API tells Yandex and Bing about new and changed items and names this file as the
 * key's location; they fetch it to check the submission came from the site. The key itself lives in the API.
 */
export async function GET() {
  const key = (await serverFetch<{ key: string }>("/seo/indexnow-key", 3600))?.key;
  if (typeof key !== "string" || !/^[a-zA-Z0-9-]{8,128}$/.test(key)) return new Response("Not found", { status: 404 });
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
