import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedShell } from "@/components/feed-shell";
import HomeClient from "./home-client";

// A server page only to carry metadata (a client page can't export it); the feed itself is the client component.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      {/* The feed bails out of server rendering (search params), so the page's heading is written here, in the HTML. */}
      <h1 className="sr-only">ichiba — вещи из открытых гардеробов</h1>
      <Suspense fallback={<FeedShell />}>
        <HomeClient />
      </Suspense>
    </>
  );
}
