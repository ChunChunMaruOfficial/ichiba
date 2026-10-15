"use client";

import { Suspense } from "react";
import { RequireAuth } from "@/components/require-auth";
import { WardrobeView } from "@/components/wardrobe-view";

export default function MyWardrobePage() {
  return <RequireAuth reason="чтобы вести свой гардероб и продавать вещи">{(me) => (
        <Suspense>
          <WardrobeView username={me.username} />
        </Suspense>
      )}</RequireAuth>;
}
