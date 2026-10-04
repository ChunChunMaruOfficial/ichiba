"use client";

import { Suspense } from "react";
import { WardrobeView, type WardrobeData } from "@/components/wardrobe-view";

export function WardrobeClient({ username, initial }: { username: string; initial?: WardrobeData | null }) {
  return (
    <Suspense>
      <WardrobeView username={username} initial={initial} />
    </Suspense>
  );
}
