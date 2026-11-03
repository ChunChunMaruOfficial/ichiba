import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { FeedShell } from "@/components/feed-shell";
import { SwrFallback } from "@/components/swr-fallback";
import { og } from "@/lib/og";
import { serverFetch } from "@/lib/server";
import { WARDROBES_FIRST } from "@/lib/wardrobes-feed";
import WardrobesClient from "./wardrobes-client";

export const metadata: Metadata = {
  title: "Гардеробы продавцов одежды в Беларуси",
  description: "Открытые гардеробы продавцов ichiba: найдите человека со своим стилем и размером и подпишитесь на его новые вещи.",
  alternates: { canonical: "/wardrobes" },
  openGraph: og("/wardrobes", { title: "Гардеробы продавцов на ichiba", description: "Найдите продавца со своим стилем и размером и подпишитесь на его новые вещи." }),
};

/**
 * Guests and search engines get the first twelve wardrobes in the HTML: the page used to be built at deploy time with
 * an empty list, so a crawler saw only the heading and none of the links to the sellers' pages.
 */
export default async function WardrobesPage() {
  const guest = !(await cookies()).has("ichiba_token");
  const first = guest ? await serverFetch(WARDROBES_FIRST) : null;
  const content = (
    <Suspense fallback={<FeedShell />}>
      <WardrobesClient />
    </Suspense>
  );
  return first ? <SwrFallback pages={{ [WARDROBES_FIRST]: first }}>{content}</SwrFallback> : content;
}
