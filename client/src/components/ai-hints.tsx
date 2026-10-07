"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { ListingValues, PhotoDraft } from "@/lib/listing-form";
import type { NegotiationAdvice, Offer, OpeningSuggestion, PriceSuggestion } from "@/lib/types";
import { Button, IconSparkle } from "./ui";

/** Value that settles `ms` after the last change (keeps typing from firing AI requests). */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const post = <T,>([url, body]: readonly [string, string]) => api<T>(url, { body: JSON.parse(body) });
const swrOpts = { revalidateOnFocus: false, dedupingInterval: 5 * 60_000, keepPreviousData: false } as const;

const CONFIDENCE = { high: "высокая точность", medium: "средняя точность", low: "приблизительно" } as const;

// ---------- price ----------

/** Market price for the listing as it's being filled in (recommended price and the usual range), or null. */
export function usePriceSuggestion(values: ListingValues, photos: PhotoDraft[], listingId?: string | null, enabled = true) {
  const photoIds = photos.filter((p) => p.status === "done" && p.id).map((p) => p.id!);
  const input =
    enabled && values.category
      ? JSON.stringify({
          listingId: listingId ?? null,
          title: values.title || null,
          category: values.category,
          subcategory: values.subcategory,
          brand: values.brand || null,
          color: values.color,
          condition: values.condition,
          defectsPresent: values.defectsPresent,
          material: values.material,
          size: values.sizeValue,
          photoIds: photoIds.slice(0, 1),
        })
      : null;
  const body = useDebounced(input, 900);
  const { data } = useSWR(body ? (["/ai/price-suggest", body] as const) : null, post<PriceSuggestion>, swrOpts);
  if (!input || !data || data.status !== "ok" || data.recommended == null || data.low == null || data.high == null) return null;
  return { recommended: data.recommended, low: data.low, high: data.high };
}

// ---------- negotiation ----------

const ACTION_LABEL = { accept: "Принять", counter: "Встречная цена", decline: "Отклонить" } as const;

/** Hint for the side whose turn it is (frame 13 negotiation + AI feature 5). */
export function NegotiationHint({ offer, onAccept, onCounter, onDecline, compact }: { offer: Offer; onAccept: () => void; onCounter: (amount: number) => void; onDecline: () => void; compact?: boolean }) {
  const { data, isLoading } = useSWR<NegotiationAdvice>(offer.myTurn && offer.status === "PENDING" ? `/offers/${offer.id}/advice` : null, swrOpts);
  if (!offer.myTurn) return null;
  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-ai-soft/60 px-3 py-2 text-sm text-ai">
        <IconSparkle className="size-4 animate-pulse" filled /> Подбираем совет…
      </div>
    );
  }
  const title = data.action === "counter" && data.counter ? `Совет: предложите ${data.counter} BYN` : data.action === "accept" ? "Совет: принять" : "Совет: отклонить";
  return (
    <div className="rounded-xl border border-ai/15 bg-ai-soft/60 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-ai">
        <IconSparkle className="size-4" filled /> {title}
        <span className="ml-auto text-xs font-normal text-muted">{CONFIDENCE[data.confidence]}</span>
      </p>
      {data.reason && <p className="mt-1 text-ink-2">{data.reason}</p>}
      {!compact && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted">
          {data.facts.map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => (data.action === "counter" && data.counter ? onCounter(data.counter) : data.action === "accept" ? onAccept() : onDecline())}
        >
          {data.action === "counter" && data.counter ? `Предложить ${data.counter} BYN` : ACTION_LABEL[data.action]}
        </Button>
      </div>
    </div>
  );
}

/** "Реалистичное предложение" in the offer sheet. Never derived from the seller's hidden minimum. */
export function OpeningHint({ listingId, onPick }: { listingId: string; onPick: (amount: number) => void }) {
  const { data } = useSWR<{ suggestion: OpeningSuggestion | null }>(`/offers/opening/${listingId}`, swrOpts);
  const s = data?.suggestion;
  if (!s) return null;
  const chance = { high: "скорее всего примут", medium: "есть шанс", low: "могут отказать" }[s.chance];
  return (
    <button type="button" onClick={() => onPick(s.suggested)} className="mt-3 flex w-full items-start gap-2 rounded-xl border border-ai/15 bg-ai-soft/60 px-3 py-2.5 text-left text-sm hover:border-ai/40">
      <IconSparkle className="mt-0.5 size-4 shrink-0 text-ai" filled />
      <span>
        <b className="font-semibold">Реалистичное предложение — {s.suggested} BYN</b>, {chance}
        {s.facts[0] && <span className="block text-xs text-muted">{s.facts[0]}</span>}
      </span>
    </button>
  );
}
