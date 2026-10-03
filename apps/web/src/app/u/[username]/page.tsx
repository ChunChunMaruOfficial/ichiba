"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { WardrobeView } from "@/components/wardrobe-view";

export default function SellerWardrobePage() {
  const { username } = useParams<{ username: string }>();
  return <Suspense>
      <WardrobeView username={decodeURIComponent(username)} />
    </Suspense>;
}
