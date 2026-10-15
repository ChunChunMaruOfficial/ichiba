"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { useMarketZone, withMarket } from "@/lib/market";
import { searchByPhoto } from "@/lib/photo-search";
import { useToast } from "./toast";
import { Spinner } from "./ui";

export const IconCameraSearch = ({ className = "size-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 8h3l2-2.5h6L17 8h3v11H4Z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

/** Camera button for search fields: pick or shoot a photo, then open /search with what looks like it. */
export function PhotoSearchButton({ className, children }: { className?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const zone = useMarketZone();
  return (
    <>
      <button
        type="button"
        aria-label="Найти по фото"
        title="Найти по фото"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={clsx("grid shrink-0 place-items-center text-ink-2 hover:text-ink disabled:cursor-wait", className)}
      >
        {busy ? <Spinner /> : (children ?? <IconCameraSearch />)}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const r = await searchByPhoto(file, zone);
            router.push(withMarket(`/search?photo=${r.id}`, zone));
          } catch (err) {
            toast(err instanceof ApiError ? err.message : "Не получилось найти по фото", { tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
