import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedShell } from "@/components/feed-shell";
import WardrobesClient from "./wardrobes-client";

export const metadata: Metadata = {
  title: "Гардеробы",
  description: "Открытые гардеробы продавцов ichiba: найдите человека со своим стилем и размером и подпишитесь на его новые вещи.",
  alternates: { canonical: "/wardrobes" },
};

export default function WardrobesPage() {
  return (
    <Suspense fallback={<FeedShell />}>
      <WardrobesClient />
    </Suspense>
  );
}
