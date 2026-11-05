"use client";

import { usePathname } from "next/navigation";

/**
 * Brands and the second-hand market («Вторичка») are kept apart everywhere: brands don't stand next to people's
 * closets. The zone is where the person is now — «Вторичка» and its wardrobes, or the brands' home — and every
 * link into search stays in it: a search on «Вторичка» is /resale?…, on the brands /?… (components/search-view.tsx).
 */
export type Zone = "brands" | "resale";

export function useMarketZone(): Zone {
  const pathname = usePathname();
  return /^\/(resale|wardrobes)(\/|$)/.test(pathname) ? "resale" : "brands";
}

/** The page a zone searches on. */
export const searchBase = (zone: Zone) => (zone === "resale" ? "/resale" : "/");

/** A link into search within the given zone: `query` without the leading «?». */
export const searchHref = (query: string, zone: Zone) => {
  const base = searchBase(zone);
  const clean = query.replace(/^[?&]+/, "");
  return clean ? `${base}?${clean}` : base;
};
