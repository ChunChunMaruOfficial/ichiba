import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { FeedShell } from "@/components/feed-shell";
import { SwrFallback } from "@/components/swr-fallback";
import { serverFetch } from "@/lib/server";
import { homeChip, homeFeedKey } from "@/lib/home-feed";
import HomeClient from "./home-client";

// A server page to carry metadata (a client page can't export it) and the first screen of the feed.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Guests and search engines get the first screen of the feed in the HTML: the client used to fetch /home, then /feed,
 * only once its scripts ran, so the first photo appeared seconds late on a phone (Lighthouse LCP 8.7 s). A signed-in
 * visitor's feed is their own («Для вас», from the session cookie the server fetch doesn't send), so it stays on the
 * client as before.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, jar] = await Promise.all([searchParams, cookies()]);
  const guest = !jar.has("ichiba_token");
  const key = homeFeedKey(homeChip(typeof params.chip === "string" ? params.chip : null, false), 0);
  const [home, feed] = guest && params.mode !== "swipe" ? await Promise.all([serverFetch("/home"), serverFetch(key)]) : [null, null];
  const content = (
    <Suspense fallback={<FeedShell />}>
      <HomeClient />
    </Suspense>
  );
  return (
    <>
      <h1 className="sr-only">ichiba — вещи из открытых гардеробов</h1>
      {home && feed ? (
        <SwrFallback data={{ "/home": home }} pages={{ [key]: feed }}>
          {content}
        </SwrFallback>
      ) : (
        content
      )}
    </>
  );
}
