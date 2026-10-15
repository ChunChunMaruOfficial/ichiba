"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

/**
 * Brands and the second-hand market («Вторичка») are kept apart everywhere: brands don't stand next to people's
 * closets. The zone is where the person is now — «Вторичка» and its wardrobes, or a search started there
 * (market=resale) — and every link into search carries it, so a category or a brand opens in the same market.
 */
export type Zone = "brands" | "resale";

const noop = () => () => {};
const currentSearch = () => window.location.search;

export function useMarketZone(): Zone {
  const pathname = usePathname();
  // Read at render: the menus and the search box re-render when used, so a stale value never reaches a link.
  const search = useSyncExternalStore(noop, currentSearch, () => "");
  if (/^\/(resale|wardrobes)(\/|$)/.test(pathname)) return "resale";
  if (pathname === "/search" && new URLSearchParams(search).get("market") === "resale") return "resale";
  return "brands";
}

/** A link into search within the given market (brands need nothing: they are the default). */
export const withMarket = (href: string, zone: Zone) => (zone === "resale" ? `${href}${href.includes("?") ? "&" : "?"}market=resale` : href);
