import { notFound } from "next/navigation";
import { itemIdFrom } from "@/lib/item-path";
import { serverFetch } from "@/lib/server";

/**
 * The "does it exist" check lives here, outside the page's loading boundary: once loading.tsx has streamed, a
 * notFound() inside the page can no longer turn the response into a 404, and crawlers would index «Вещь не найдена»
 * as a page (a soft 404). The layout resolves before anything is sent, so the status is right; the fetch is memoised
 * by Next for the page and its metadata, which call the same URL, so nothing is requested twice.
 * The segment is the id, optionally followed by the slug (lib/item-path.ts).
 */
export default async function ItemLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const id = itemIdFrom((await params).id);
  if (!id || (await serverFetch(`/listings/${encodeURIComponent(id)}`)) === null) notFound();
  return children;
}
