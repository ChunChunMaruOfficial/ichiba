import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedShell } from "@/components/feed-shell";
import SearchClient from "./search-client";

// Result pages for arbitrary queries are thin and endless: crawlers follow the items, but don't index the lists.
export const metadata: Metadata = {
  title: "Поиск",
  description: "Поиск одежды, обуви и аксессуаров на ichiba: по словам, по фото, по размеру, бренду и цене.",
  alternates: { canonical: "/search" },
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return (
    <Suspense fallback={<FeedShell wide={false} />}>
      <SearchClient />
    </Suspense>
  );
}
