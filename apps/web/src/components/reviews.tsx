"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { api, ApiError } from "@/lib/api";
import { plural, timeAgo } from "@/lib/labels";
import type { Deal, Review, ReviewsPage } from "@/lib/types";
import { ReportModal } from "./report-modal";
import { useSession } from "./session";
import { useToast } from "./toast";
import { StarInput, Stars } from "./trust";
import { Button, Chip, EmptyState, Field, Skeleton, Textarea } from "./ui";

interface TagDef {
  key: string;
  label: string;
  positive: boolean;
}

/** Buyer's review form on the deal page (feature 3: buyer → seller). Also used to edit within 14 days. */
function ReviewForm({ deal, initial, onDone }: { deal: Pick<Deal, "id" | "counterpart">; initial?: { id: string; rating: number; tags: string[]; text: string | null }; onDone: () => void }) {
  const toast = useToast();
  const { data: tags } = useSWR<TagDef[]>("/reviews/tags");
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [picked, setPicked] = useState<string[]>(initial?.tags ?? []);
  const [text, setText] = useState(initial?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Positive tags fit good ratings, negative ones low ratings; both are offered at 3★.
  const shown = (tags ?? []).filter((t) => !rating || rating === 3 || (rating > 3 ? t.positive : !t.positive));

  const submit = async () => {
    if (!rating) return setError("Поставьте оценку");
    setBusy(true);
    setError(null);
    try {
      const body = { rating, tags: picked.filter((p) => shown.some((t) => t.key === p)), text: text.trim() || null };
      if (initial) await api(`/reviews/${initial.id}`, { method: "PATCH", body });
      else await api(`/requests/${deal.id}/review`, { body });
      toast(initial ? "Отзыв обновлён" : "Спасибо за отзыв!");
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.text ?? e.message) : "Не удалось отправить отзыв");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      id="review"
      className="flex flex-col gap-4 rounded-2xl bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">{initial ? "Изменить отзыв" : `Как прошла сделка с @${deal.counterpart.username}?`}</h2>
        <p className="text-sm text-ink-2">Отзыв увидят все покупатели в гардеробе продавца.</p>
      </div>
      <StarInput value={rating} onChange={(v) => (setRating(v), setError(null))} />
      {rating > 0 && shown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shown.map((t) => (
            <Chip key={t.key} active={picked.includes(t.key)} onClick={() => setPicked((p) => (p.includes(t.key) ? p.filter((x) => x !== t.key) : [...p, t.key]))}>
              {t.label}
            </Chip>
          ))}
        </div>
      )}
      <Field label="Комментарий" hint={`${text.length}/1000`}>
        <Textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Что понравилось, что можно улучшить" className="min-h-24" />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" loading={busy} className="self-start">
        {initial ? "Сохранить" : "Отправить отзыв"}
      </Button>
    </form>
  );
}

/** One review with the seller's public answer; the seller can answer, the author can edit, others can report. */
function ReviewCard({ review: r, onChange, showListing = true }: { review: Review; onChange: () => void; showListing?: boolean }) {
  const toast = useToast();
  const { requireAuth } = useSession();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState(r.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const sendReply = async () => {
    setBusy(true);
    try {
      await api(`/reviews/${r.id}/reply`, { body: { text: reply } });
      toast("Ответ опубликован");
      setReplying(false);
      onChange();
    } catch (e) {
      toast(e instanceof ApiError ? (e.fields.text ?? e.message) : "Не удалось отправить", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={r.rating} size="sm" />
        <span className="text-sm font-medium">@{r.author}</span>
        <span className="text-xs text-muted">
          {timeAgo(r.createdAt)}
          {r.edited && " · изменён"}
        </span>
      </div>
      {r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.tags.map((t) => (
            <span key={t.key} className={clsx("rounded-full px-2.5 py-0.5 text-xs", t.positive ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
              {t.label}
            </span>
          ))}
        </div>
      )}
      {r.text && <p className="whitespace-pre-line text-[15px] leading-relaxed">{r.text}</p>}
      {showListing && r.listing && (
        <Link href={`/item/${r.listing.id}`} className="w-fit text-xs text-ink-2 underline underline-offset-4">
          {r.listing.title}
        </Link>
      )}
      {r.reply && !replying && (
        <div className="mt-1 rounded-xl bg-paper px-3 py-2.5 text-sm">
          <p className="text-xs font-semibold text-ink-2">Ответ продавца</p>
          <p className="mt-0.5 whitespace-pre-line">{r.reply}</p>
        </div>
      )}
      {replying && (
        <div className="flex flex-col gap-2">
          <Textarea value={reply} maxLength={1000} onChange={(e) => setReply(e.target.value)} placeholder="Ответьте покупателю — ответ увидят все" className="min-h-20" autoFocus />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={reply.trim().length < 2} onClick={sendReply}>
              Опубликовать
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
      <div className="flex gap-4 text-xs">
        {r.canReply && !replying && (
          <button className="font-medium text-ink-2 underline underline-offset-4 hover:text-ink" onClick={() => setReplying(true)}>
            {r.reply ? "Изменить ответ" : "Ответить"}
          </button>
        )}
        {!r.mine && !r.canReply && (
          <button className="text-muted underline underline-offset-4 hover:text-ink" onClick={() => requireAuth(() => setReportOpen(true), { reason: "чтобы пожаловаться на отзыв" })}>
            Пожаловаться
          </button>
        )}
      </div>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} targetType="REVIEW" targetId={r.id} />
    </li>
  );
}

/** Seller's reviews with a summary: average, distribution and top tags (wardrobe page). */
export function ReviewsSection({ username }: { username: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const key = (i: number, prev: ReviewsPage | null) => {
    if (prev && !prev.hasMore) return null;
    const before = prev?.items.at(-1)?.createdAt;
    return `/users/${username}/reviews?${new URLSearchParams({ ...(before ? { before } : {}), ...(rating ? { rating: String(rating) } : {}) })}`;
  };
  const { data, size, setSize, mutate, isLoading } = useSWRInfinite<ReviewsPage>(key);
  const first = data?.[0];
  if (isLoading && !first) return <Skeleton className="h-48 rounded-2xl" />;
  if (!first) return null;
  const s = first.summary;
  if (!s.count) return <EmptyState title="Пока нет отзывов" hint="Отзывы оставляют покупатели после завершённой сделки" />;
  const items = data!.flatMap((p) => p.items);

  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      <aside className="flex flex-col gap-4 md:sticky md:top-24 md:self-start">
        <div className="rounded-2xl bg-surface p-5">
          <p className="tabular text-4xl font-semibold">{s.avg.toFixed(1)}</p>
          <Stars value={s.avg} />
          <p className="mt-1 text-sm text-ink-2">
            {s.count} {plural(s.count, "отзыв", "отзыва", "отзывов")}
          </p>
          <ul className="mt-4 flex flex-col gap-1.5">
            {s.distribution.map((d) => (
              <li key={d.stars}>
                <button className={clsx("grid w-full grid-cols-[1.5rem_1fr_2rem] items-center gap-2 text-sm", rating === d.stars && "font-semibold")} onClick={() => setRating((r) => (r === d.stars ? null : d.stars))} aria-pressed={rating === d.stars}>
                  <span>{d.stars}★</span>
                  <span className="h-2 overflow-hidden rounded-full bg-black/5">
                    <span className="block h-full rounded-full bg-[#d9a100]" style={{ width: `${s.count ? (d.count / s.count) * 100 : 0}%` }} />
                  </span>
                  <span className="tabular text-right text-muted">{d.count}</span>
                </button>
              </li>
            ))}
          </ul>
          {s.topTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {s.topTags.map((t) => (
                <span key={t.key} className="rounded-full bg-ok-soft px-2.5 py-0.5 text-xs text-ok">
                  {t.label} · {t.count}
                </span>
              ))}
            </div>
          )}
        </div>
      </aside>
      <div>
        {rating && (
          <p className="mb-3 text-sm text-ink-2">
            Показаны отзывы с оценкой {rating}★ ·{" "}
            <button className="underline underline-offset-4" onClick={() => setRating(null)}>
              все отзывы
            </button>
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <ReviewCard key={r.id} review={r} onChange={() => mutate()} />
          ))}
        </ul>
        {data!.at(-1)?.hasMore && (
          <Button variant="secondary" className="mt-4" onClick={() => setSize(size + 1)}>
            Показать ещё
          </Button>
        )}
      </div>
    </div>
  );
}

/** Review block on the deal page: form for the buyer, the posted review (+ edit / answer) for both sides. */
export function DealReview({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState(deal.review?.reply ?? "");
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = deal.review;
  if (deal.canReview || (r && editing)) {
    return <ReviewForm deal={deal} initial={editing && r ? r : undefined} onDone={() => (setEditing(false), onChange())} />;
  }
  if (!r) return null;
  const canEdit = r.canEdit;
  return (
    <section id="review" className="flex flex-col gap-2 rounded-2xl bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{deal.role === "buyer" ? "Ваш отзыв" : "Отзыв покупателя"}</h2>
        {r.hidden && <span className="text-xs text-danger">Скрыт модератором</span>}
      </div>
      <Stars value={r.rating} />
      {r.text && <p className="whitespace-pre-line text-[15px]">{r.text}</p>}
      {r.reply && !replying && (
        <div className="rounded-xl bg-paper px-3 py-2.5 text-sm">
          <p className="text-xs font-semibold text-ink-2">Ответ продавца</p>
          <p className="mt-0.5 whitespace-pre-line">{r.reply}</p>
        </div>
      )}
      {replying && (
        <div className="flex flex-col gap-2">
          <Textarea value={reply} maxLength={1000} onChange={(e) => setReply(e.target.value)} placeholder="Ответ увидят все покупатели" className="min-h-20" autoFocus />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={busy}
              disabled={reply.trim().length < 2}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/reviews/${r.id}/reply`, { body: { text: reply } });
                  toast("Ответ опубликован");
                  setReplying(false);
                  onChange();
                } catch (e) {
                  toast(e instanceof ApiError ? (e.fields.text ?? e.message) : "Не удалось отправить", { tone: "error" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Опубликовать
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
      <div className="flex gap-4 text-sm">
        {canEdit && (
          <button className="font-medium text-ink-2 underline underline-offset-4" onClick={() => setEditing(true)}>
            Изменить
          </button>
        )}
        {deal.role === "seller" && !replying && (
          <button className="font-medium text-ink-2 underline underline-offset-4" onClick={() => setReplying(true)}>
            {r.reply ? "Изменить ответ" : "Ответить"}
          </button>
        )}
      </div>
    </section>
  );
}
