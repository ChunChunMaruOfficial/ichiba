/**
 * Item addresses: /item/<id>-<slug>, the id first and then the item in Latin words («…-chernaya-kurtka-carhartt»), as
 * on Vinted and Grailed. Search engines show and weigh those words; the id alone finds the item, so a bare /item/<id>
 * or an outdated slug still works and is redirected to the current address (item/[id]/(view)/layout.tsx).
 */

const ITEM_PARAM = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-[^/]*)?$/i;

/** The listing id in an /item/[id] segment, with or without the slug; null when there is none. */
export function itemIdFrom(param: string): string | null {
  let s = param;
  try {
    s = decodeURIComponent(param);
  } catch {
    // A malformed escape: try the segment as it is.
  }
  return ITEM_PARAM.exec(s)?.[1].toLowerCase() ?? null;
}

/** The /item/[id] segment search engines are given for a listing. */
export const itemSegment = (l: { id: string; slug?: string | null }) => (l.slug ? `${l.id}-${l.slug}` : l.id);

export const itemHref = (l: { id: string; slug?: string | null }) => `/item/${itemSegment(l)}`;
