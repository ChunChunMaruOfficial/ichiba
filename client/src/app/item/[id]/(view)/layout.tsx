import { permanentRedirect } from "next/navigation";
import { itemIdFrom, itemSegment } from "@/lib/item-path";
import { serverFetch } from "@/lib/server";
import type { ListingResponse } from "@/lib/types";

/**
 * One address per item: a bare /item/<id>, an outdated slug (the title changed) or a different spelling goes to the
 * current /item/<id>-<slug> with a 308, so links pile up on one page in search. It sits above the page's loading
 * boundary, so the redirect is a real HTTP status rather than a client-side hop. Only the item page itself: /edit and
 * /similar keep whatever address they were opened with.
 */
export default async function ItemViewLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const segment = decodeURIComponent((await params).id);
  const id = itemIdFrom(segment);
  const l = id ? await serverFetch<ListingResponse>(`/listings/${encodeURIComponent(id)}`) : null;
  if (l && !("unavailable" in l) && l.slug && segment !== itemSegment(l)) permanentRedirect(`/item/${itemSegment(l)}`);
  return children;
}
