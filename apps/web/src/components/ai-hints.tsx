"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import type { ListingValues, PhotoDraft } from "@/lib/listing-form";
import type { NegotiationAdvice, Offer, OpeningSuggestion, PhotoCheck, PhotoIssue, PriceSuggestion } from "@/lib/types";
import { Button, IconSparkle, Skeleton } from "./ui";

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

function AiBox({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-2xl border border-ai/15 bg-ai-soft/60 p-4", className)} aria-live="polite">
      <header className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ai">
          <IconSparkle className="size-4" filled /> {title}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

// ---------- photos ----------

/** Runs the photo check whenever the set or order of uploaded photos changes. */
export function usePhotoCheck(photos: PhotoDraft[], category: string | null) {
  const ids = photos.filter((p) => p.status === "done" && p.id).map((p) => p.id!);
  const body = useDebounced(ids.length ? JSON.stringify({ photoIds: ids, category }) : null, 700);
  const { data, isLoading } = useSWR(body ? (["/ai/photo-check", body] as const) : null, post<PhotoCheck>, swrOpts);
  // Ignore an answer about a photo set that has changed since.
  const fresh = data && data.photos.every((p) => ids.includes(p.id)) ? data : undefined;
  return { check: fresh, loading: isLoading };
}

export const issuesById = (check?: PhotoCheck) => Object.fromEntries((check?.photos ?? []).map((p) => [p.id, p.issues])) as Record<string, PhotoIssue[]>;

export function PhotoAdvice({ check, loading, photos, onMakeCover }: { check?: PhotoCheck; loading?: boolean; photos: PhotoDraft[]; onMakeCover: (photoId: string) => void }) {
  if (loading && !check) {
    return (
      <AiBox title="Проверяем фото">
        <Skeleton className="h-4 w-2/3 rounded" />
      </AiBox>
    );
  }
  if (!check) return null;
  const numbered = check.photos
    .map((p, i) => ({ n: i + 1, issues: p.issues.filter((x) => x.severity !== "info" || p.issues.length === 1) }))
    .filter((p) => p.issues.length);
  const cover = check.cover ? photos.find((p) => p.id === check.cover!.photoId) : null;
  if (!numbered.length && !cover && !check.missing.length) {
    return (
      <AiBox title="Фото в порядке">
        <p className="text-sm text-ink-2">Светло, резко, вещь хорошо видно.</p>
      </AiBox>
    );
  }
  return (
    <AiBox title="Советы по фото" aside={<span className="tabular text-xs text-muted">{check.score}/100</span>}>
      {cover && (
        <div className="mb-3 flex items-center gap-3 rounded-xl bg-surface p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover.preview} alt="" className="h-14 w-11 shrink-0 rounded-lg object-cover" />
          <p className="min-w-0 flex-1 text-sm">{check.cover!.reason}</p>
          <Button size="sm" variant="secondary" onClick={() => onMakeCover(cover.id!)}>
            Сделать обложкой
          </Button>
        </div>
      )}
      <ul className="flex flex-col gap-1.5 text-sm">
        {numbered.flatMap((p) =>
          p.issues.map((x) => (
            <li key={`${p.n}-${x.code}`} className="flex gap-2">
              <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", x.severity === "error" ? "bg-danger" : x.severity === "warn" ? "bg-[#d9a100]" : "bg-muted")} />
              <span>
                <b className="font-medium">Фото {p.n}:</b> {x.text}
              </span>
            </li>
          )),
        )}
        {check.missing.map((m) => (
          <li key={m.code} className="flex gap-2 text-ink-2">
            <span className="mt-px shrink-0 font-semibold text-ai">+</span>
            {m.text}
          </li>
        ))}
      </ul>
    </AiBox>
  );
}

// ---------- price ----------

const CONFIDENCE = { high: "высокая точность", medium: "средняя точность", low: "приблизительно" } as const;

export function PriceHint({
  values,
  photos,
  listingId,
  set,
  disabled,
  className,
}: {
  values: ListingValues;
  photos: PhotoDraft[];
  listingId?: string | null;
  set: (patch: Partial<ListingValues>) => void;
  disabled?: boolean;
  className?: string;
}) {
  const photoIds = photos.filter((p) => p.status === "done" && p.id).map((p) => p.id!);
  const input = values.category
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
  const { data, isLoading, error } = useSWR(body ? (["/ai/price-suggest", body] as const) : null, post<PriceSuggestion>, swrOpts);

  if (!values.category || error) return null;
  if (isLoading || !data) {
    return (
      <AiBox title="Подсказка цены" className={className}>
        <p className="mb-2 text-sm text-muted">Смотрим, за сколько уходят похожие вещи…</p>
        <Skeleton className="h-8 w-1/2 rounded-lg" />
      </AiBox>
    );
  }
  if (data.status !== "ok" || data.recommended == null) {
    return (
      <AiBox title="Подсказка цены" className={className}>
        <p className="text-sm text-ink-2">Похожих вещей пока мало — ориентируйтесь на цену новой вещи и состояние.</p>
      </AiBox>
    );
  }

  const auction = values.saleType === "AUCTION";
  const price = Number(values.price) || null;
  const low = data.low!;
  const high = data.high!;
  const span = Math.max(1, high - low);
  const pos = price != null ? Math.min(100, Math.max(0, ((price - low) / span) * 100)) : null;
  const verdict = price == null ? null : price > high * 1.1 ? "Выше рынка — продажа может затянуться" : price < low * 0.9 ? "Ниже рынка — уйдёт быстро, но можно заработать больше" : "В рынке";

  return (
    <AiBox title="Подсказка цены" className={className} aside={<span className="text-xs text-muted">{CONFIDENCE[data.confidence]}</span>}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm text-ink-2">
          Рекомендуем <b className="tabular text-xl text-ink">{formatPrice(data.recommended)}</b>
        </p>
        <p className="tabular text-sm text-muted">
          обычно {low}–{high} BYN · быстро — {data.quickSale} BYN
        </p>
      </div>

      <div className="relative mt-3 h-2 rounded-full bg-gradient-to-r from-ok/40 via-ai/30 to-warn/50" aria-hidden>
        {pos != null && <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink shadow" style={{ left: `${pos}%` }} />}
      </div>
      {verdict && <p className={clsx("mt-2 text-xs font-medium", verdict === "В рынке" ? "text-ok" : "text-ink-2")}>Ваша цена: {verdict.toLowerCase()}</p>}

      {(data.facts.length > 0 || data.reasoning) && (
        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
          {data.facts.map((f) => (
            <li key={f}>· {f}</li>
          ))}
          {data.reasoning && <li className="italic">· {data.reasoning}</li>}
        </ul>
      )}

      {!disabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          {auction && data.auction ? (
            <Button size="sm" variant="secondary" onClick={() => set({ price: String(data.auction!.start), auctionReserve: String(data.auction!.reserve) })}>
              Старт {data.auction.start} · резерв {data.auction.reserve} BYN
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => set({ price: String(data.recommended) })}>
                Поставить {data.recommended} BYN
              </Button>
              {data.quickSale != null && data.quickSale < data.recommended && (
                <Button size="sm" variant="ghost" onClick={() => set({ price: String(data.quickSale) })}>
                  Продать быстрее — {data.quickSale} BYN
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </AiBox>
  );
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
