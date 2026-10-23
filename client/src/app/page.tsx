import type { Metadata } from "next";
import { Suspense } from "react";
import HomeClient from "./home-client";

// A server page only to carry metadata (a client page can't export it); the feed itself is the client component.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
