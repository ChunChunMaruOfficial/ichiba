"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { plural } from "@/lib/labels";
import type { BundleTier, FitHint, ListingStats } from "@/lib/types";
import { useToast } from "./toast";
import { Button } from "./ui";

// ---------- rating ----------

/** Five stars; `value` may be fractional (4.6 → four full stars and a partial one). */
export function Stars({ value, size = "md", className }: { value: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const px = size === "sm" ? 14 : size === "lg" ? 22 : 17;
  return (
    <span className={clsx("inline-flex items-center gap-0.5", className)} role="img" aria-label={`${value.toFixed(1)} из 5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <svg key={i} width={px} height={px} viewBox="0 0 24 24" aria-hidden>
            <defs>
              <linearGradient id={`star-${i}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor="#d9a100" />
                <stop offset={`${fill * 100}%`} stopColor="currentColor" stopOpacity="0.18" />
              </linearGradient>
            </defs>
            <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z" fill={`url(#star-${i}-${Math.round(fill * 100)})`} />
          </svg>
        );
      })}
    </span>
  );
}

/** "4.8 ★ · 23 отзыва" linking to the seller's reviews. */
export function RatingInline({ rating, username, className }: { rating: { avg: number; count: number } | null; username: string; className?: string }) {
  if (!rating) return <span className={clsx("text-sm text-muted", className)}>Пока без отзывов</span>;
  return (
    <Link href={`/u/${username}?tab=reviews`} className={clsx("inline-flex items-center gap-1.5 text-sm hover:underline", className)}>
      <Stars value={rating.avg} size="sm" />
      <b className="tabular">{rating.avg.toFixed(1)}</b>
      <span className="text-ink-2">
        · {rating.count} {plural(rating.count, "отзыв", "отзыва", "отзывов")}
      </span>
    </Link>
  );
}

/** Interactive 1–5 star picker. */
export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const labels = ["", "Плохо", "Так себе", "Нормально", "Хорошо", "Отлично"];
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Оценка" className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={`${v} из 5`}
            onMouseEnter={() => setHover(v)}
            onClick={() => onChange(v)}
            className="p-0.5 text-ink transition-transform active:scale-90"
          >
            <svg width={34} height={34} viewBox="0 0 24 24" aria-hidden>
              <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z" fill={v <= shown ? "#d9a100" : "currentColor"} fillOpacity={v <= shown ? 1 : 0.15} />
            </svg>
          </button>
        ))}
      </div>
      <span className="text-sm text-ink-2">{labels[shown]}</span>
    </div>
  );
}

// ---------- size hint ----------

const FIT_TONE: Record<FitHint["verdict"], string> = {
  good: "bg-ok-soft text-ok",
  snug: "bg-warn-soft text-warn",
  loose: "bg-warn-soft text-warn",
  small: "bg-danger-soft text-danger",
  large: "bg-danger-soft text-danger",
};

/** "Скорее всего, подойдёт" under the size, or an invitation to save sizes. */
export function FitHintBox({ fit, hasProfile, signedIn, hasSize }: { fit: FitHint | null; hasProfile: boolean | null; signedIn: boolean; hasSize: boolean }) {
  if (!hasSize && !fit) return null;
  if (fit) {
    return (
      <div className={clsx("mt-3 rounded-xl px-4 py-3 text-sm", FIT_TONE[fit.verdict])}>
        <p className="font-semibold">{fit.title}</p>
        <ul className="mt-0.5 opacity-90">
          {fit.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <Link href="/settings#sizes" className="mt-1 inline-block text-xs underline underline-offset-4 opacity-80">
          {fit.basis === "size" ? "Добавьте замеры — подсказка станет точнее" : "Мои размеры"}
        </Link>
      </div>
    );
  }
  // null = not known yet (server-rendered copy) or not applicable.
  if (!signedIn || hasProfile !== false) return null;
  return (
    <Link href="/settings#sizes" className="mt-3 block rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-ink-2 hover:border-ink">
      <b className="font-semibold text-ink">Подойдёт ли размер?</b> Укажите свои размеры — будем подсказывать на каждой вещи
    </Link>
  );
}

// ---------- bundle discount ----------

export const tiersText = (tiers: BundleTier[]) => tiers.map((t) => `от ${t.minItems} ${plural(t.minItems, "вещи", "вещей", "вещей")} −${t.percent}%`).join(", ");

export function BundleNote({ tiers, username, className }: { tiers: BundleTier[]; username: string; className?: string }) {
  if (!tiers.length) return null;
  return (
    <div className={clsx("flex items-start gap-3 rounded-xl bg-kraft/60 px-4 py-3 text-sm", className)}>
      <span aria-hidden className="text-lg leading-none">%</span>
      <p>
        <b className="font-semibold">Скидка за комплект:</b> {tiersText(tiers)}.{" "}
        <Link href={`/u/${username}`} className="underline underline-offset-4">
          Собрать комплект в гардеробе
        </Link>
      </p>
    </div>
  );
}

// ---------- bump + listing stats (owner) ----------

const hoursUntil = (iso: string) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 3600_000));
const bumpLabel = (bump: { nextAt: string; available: boolean }) => (bump.available ? "Поднять в ленте" : `Поднять через ${hoursUntil(bump.nextAt)} ч`);

export function BumpButton({ listingId, bump, onDone, size = "md", block }: { listingId: string; bump: { nextAt: string; available: boolean } | null; onDone: () => void; size?: "sm" | "md"; block?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!bump) return null;
  return (
    <Button
      variant="secondary"
      size={size}
      block={block}
      disabled={!bump.available}
      loading={busy}
      title={bump.available ? "Вещь окажется в начале «Новинок» и поиска" : "Поднимать можно раз в 72 часа"}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/listings/${listingId}/bump`, { method: "POST" });
          toast("Вещь поднята — она снова в начале «Новинок»");
          onDone();
        } catch (e) {
          toast(e instanceof ApiError ? e.message : "Не удалось поднять", { tone: "error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      ↑ {bumpLabel(bump)}
    </Button>
  );
}

/** Tiny bar chart (no chart library): one bar per day. */
export function Bars({ values, labels, height = 56, className, title }: { values: number[]; labels?: string[]; height?: number; className?: string; title: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={clsx("flex items-end gap-[3px]", className)} style={{ height }} role="img" aria-label={`${title}: ${values.join(", ")}`}>
      {values.map((v, i) => (
        <span key={i} title={`${labels?.[i] ?? ""} · ${v}`} className={clsx("flex-1 rounded-t-sm", v ? "bg-ink/80" : "bg-ink/10")} style={{ height: `${Math.max(v ? 8 : 4, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

export function ListingStatsCard({ listingId, onBumped }: { listingId: string; onBumped: () => void }) {
  const { data, mutate } = useSWR<ListingStats>(`/stats/listings/${listingId}`);
  if (!data) return <div className="h-40 animate-pulse rounded-2xl bg-surface" />;
  const t = data.last30;
  return (
    <div className="rounded-2xl bg-surface p-4 text-sm">
      <div className="flex items-baseline justify-between">
        <p className="font-medium">Статистика за 30 дней</p>
        <Link href="/sales/stats" className="text-xs text-ink-2 underline underline-offset-4">
          Вся статистика
        </Link>
      </div>
      <Bars values={data.series.map((d) => d.views)} labels={data.series.map((d) => d.day)} className="mt-3" title="Просмотры по дням" />
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["Просмотры", t.views],
            ["В ♡", t.favorites],
            ["Написали", t.chats + t.offers],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-paper px-2 py-2">
            <dd className="tabular text-lg font-semibold">{v}</dd>
            <dt className="text-xs text-muted">{k}</dt>
          </div>
        ))}
      </dl>
      {data.tips.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-ink-2">
          {data.tips.map((tip) => (
            <li key={tip}>💡 {tip}</li>
          ))}
        </ul>
      )}
      {data.bump && (
        <div className="mt-3">
          <BumpButton listingId={listingId} bump={data.bump} block onDone={() => (void mutate(), onBumped())} />
          <p className="mt-1.5 text-center text-xs text-muted">Бесплатно, раз в 72 часа{data.bump.count ? ` · поднимали ${data.bump.count} раз` : ""}</p>
        </div>
      )}
    </div>
  );
}
