import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { preconnect, preload } from "react-dom";
import { FeedShell } from "@/components/feed-shell";
import { SwrFallback } from "@/components/swr-fallback";
import { og } from "@/lib/og";
import { serverFetch } from "@/lib/server";
import type { Card } from "@/lib/types";
import { RESALE_WARDROBES, resaleChip, resaleFeedKey } from "@/lib/resale-feed";
import ResaleClient from "./resale-client";

export const metadata: Metadata = {
  title: "Вторичка — б/у одежда от частных продавцов",
  description: "Вещи из гардеробов людей в Беларуси: б/у одежда, обувь и аксессуары по честным ценам, аукционы и торг с продавцом.",
  alternates: { canonical: "/resale" },
  openGraph: og("/resale", { title: "Вторичка на ichiba — б/у одежда от частных продавцов", description: "Б/у одежда, обувь и аксессуары из гардеробов людей в Беларуси: честные цены, аукционы и торг с продавцом." }),
};

/**
 * Guests and search engines get the first screen of the market in the HTML, as on the home page: the page used to be
 * built once at deploy time with an empty feed, so crawlers saw a skeleton and phones waited for scripts before the
 * first photo (Lighthouse LCP 7.8–8.8 s). A signed-in visitor's cards carry their own likes and «Для вас», so their
 * feed stays on the client as before.
 */
export default async function ResalePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, jar] = await Promise.all([searchParams, cookies()]);
  const guest = !jar.has("ichiba_token");
  const chip = resaleChip(typeof params.chip === "string" ? params.chip : null);
  const key = resaleFeedKey(chip, 0);
  const ssr = guest && chip !== "for_you" && !Object.keys(params).some((k) => k !== "chip");
  const [feed, wardrobes] = ssr ? await Promise.all([serverFetch<{ items?: Card[] }>(key), serverFetch(RESALE_WARDROBES)]) : [null, null];
  // The first card's photo is the page's largest paint: its host and the file start from <head>, with the card's own
  // srcset and sizes so the browser reuses the download.
  const cover = feed?.items?.find((i) => i.cover)?.cover;
  if (cover) {
    preconnect(new URL(cover.urls.m).origin);
    preload(cover.urls.m, {
      as: "image",
      fetchPriority: "high",
      imageSrcSet: `${cover.urls.s} 320w, ${cover.urls.m} 640w, ${cover.urls.l} 1280w`,
      imageSizes: "(min-width: 1024px) 25vw, 50vw",
    });
  }
  const content = (
    <Suspense fallback={<FeedShell />}>
      <ResaleClient />
    </Suspense>
  );
  return (
    <>
      <h1 className="sr-only">Вторичка — вещи с историей</h1>
      {feed ? (
        <SwrFallback data={wardrobes ? { [RESALE_WARDROBES]: wardrobes } : {}} pages={{ [key]: feed }}>
          {content}
        </SwrFallback>
      ) : (
        content
      )}
    </>
  );
}
