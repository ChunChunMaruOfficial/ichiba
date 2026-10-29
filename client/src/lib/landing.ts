import type { Card } from "./types";

/**
 * Brand and category pages (server: seo/landing.ts): /c/<category>[/<subcategory>] and
 * /brands/<brand>[/<category>[/<subcategory>]]. Only the pages with enough live items are indexed and linked to.
 */

/** An indexed page, as the sitemap and the item page's breadcrumbs know it. */
export interface LandingEntry {
  path: string;
  kind: "category" | "subcategory" | "brand" | "brand-category" | "brand-subcategory";
  name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  count: number;
  updatedAt: string;
}

export interface LandingLink {
  path: string;
  name: string;
  count: number;
}

export interface LandingData {
  path: string;
  kind: LandingEntry["kind"];
  name: string;
  indexable: boolean;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  title: string;
  description: string;
  intro: string[];
  total: number;
  price: { min: number; max: number; median: number } | null;
  updatedAt: string;
  crumbs: Array<{ path: string; name: string }>;
  links: Array<{ title: string; links: LandingLink[] }>;
  sections: Array<{ market: "brands" | "resale"; total: number; items: Card[] }>;
}

export const landingHref = (path: string) => `/${path}`;

/** The indexed pages an item belongs to: its category, subcategory and brand, when they have a page. */
export function itemLandings(entries: LandingEntry[] | null | undefined, l: { category: string | null; subcategory?: string | null; brand: string | null }) {
  const find = (path: string) => entries?.find((e) => e.path === path);
  const brand = l.brand?.trim().toLowerCase();
  return {
    category: l.category ? find(`c/${l.category}`) : undefined,
    subcategory: l.category && l.subcategory ? find(`c/${l.category}/${l.subcategory}`) : undefined,
    brand: brand ? entries?.find((e) => e.kind === "brand" && e.brand?.toLowerCase() === brand) : undefined,
  };
}
export type ItemLandings = ReturnType<typeof itemLandings>;
