"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useToast } from "@/components/toast";
import { Badge, Button, Chip, EmptyState, ErrorState, Input, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatPrice, LISTING_BADGE, timeAgo } from "@/lib/labels";
import type { Card } from "@/lib/types";

interface ReportRow {
  id: string;
  targetType: "LISTING" | "USER" | "APPEAL";
  targetId: string;
  reason: string;
  comment: string | null;
  status: "OPEN" | "RESOLVED" | "REJECTED";
  resolution: string | null;
  createdAt: string;
  reporter: string | null;
  /** user | ai — raised by automatic moderation or chat antifraud. */
  source: "user" | "ai";
  details: { reasons?: string[]; votes?: number; providers?: string[]; excerpts?: Array<{ body: string; threadId: string }> } | null;
  reportsOnTarget: number;
  listing: (Card & { blockedReason: string | null }) | null;
  user: { id: string; username: string; blockedAt: string | null } | null;
}

const TYPE_LABEL = { LISTING: "Вещь", USER: "Пользователь", APPEAL: "Обжалование" } as const;

/** Moderation queue (frame 20): post-moderation, reports and appeals, oldest first. */
export default function ModerationPage() {
  const [status, setStatus] = useState<"OPEN" | "RESOLVED" | "REJECTED">("OPEN");
  const { data, error, mutate } = useSWR<{ items: ReportRow[] }>(`/admin/reports?status=${status}`);
  return (
    <div>
      <div className="mb-6 flex gap-2">
        {(
          [
            ["OPEN", "Открытые"],
            ["RESOLVED", "Решённые"],
            ["REJECTED", "Отклонённые"],
          ] as const
        ).map(([k, l]) => (
          <Chip key={k} active={status === k} onClick={() => setStatus(k)}>
            {l}
          </Chip>
        ))}
      </div>
      {error ? (
        <ErrorState message="Не удалось загрузить жалобы" onRetry={() => mutate()} />
      ) : !data ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState title={status === "OPEN" ? "Очередь пуста" : "Пока ничего"} />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((r) => (
            <ReportItem key={r.id} r={r} onDone={() => mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportItem({ r, onDone }: { r: ReportRow; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const resolve = async (action: "block" | "unblock" | "dismiss" | "block_user") => {
    if ((action === "block" || action === "block_user") && !reason.trim()) return toast("Укажите причину — её увидит продавец", { tone: "error" });
    setBusy(action);
    try {
      await api(`/admin/reports/${r.id}/resolve`, { body: { action, reason: reason || null } });
      toast("Готово");
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const l = r.listing;
  return (
    <li className="flex flex-col gap-4 rounded-2xl bg-surface p-4 md:flex-row">
      {l && (
        <Link href={`/item/${l.id}`} target="_blank" className="w-24 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {l.cover && <img src={l.cover.urls.s} alt="" width={96} height={120} className="size-full object-contain" />}
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={r.targetType === "APPEAL" ? "warn" : r.targetType === "USER" ? "muted" : "danger"}>{TYPE_LABEL[r.targetType]}</Badge>
          {r.reportsOnTarget > 1 && <Badge tone="danger">жалоб: {r.reportsOnTarget}</Badge>}
          {r.source === "ai" && <Badge tone="outline">ИИ · {r.details?.providers?.length ? r.details.providers.join(", ") : "правила"}</Badge>}
          <span className="text-xs text-muted">
            {r.reporter ? `@${r.reporter}` : "Автомодерация"} · {timeAgo(r.createdAt)}
          </span>
        </div>
        <p className="mt-2 font-medium">{r.reason}</p>
        {r.source === "ai" && r.details?.reasons?.length ? (
          <ul className="mt-1 list-inside list-disc text-sm text-ink-2">
            {r.details.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          r.comment && <p className="mt-1 text-sm text-ink-2">«{r.comment}»</p>
        )}
        {r.details?.excerpts?.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {r.details.excerpts.slice(0, 3).map((x, i) => (
              <li key={i} className="rounded-lg bg-ink/5 px-3 py-1.5 text-sm text-ink-2">
                «{x.body}»
              </li>
            ))}
          </ul>
        ) : null}
        {l && (
          <p className="mt-2 text-sm">
            <Link href={`/item/${l.id}`} target="_blank" className="hover:underline">
              {l.title}
            </Link>{" "}
            · <span className="tabular">{formatPrice(l.price)}</span> · @{l.seller.username} · {LISTING_BADGE[l.status]?.label ?? "В продаже"}
            {l.blockedReason && <span className="text-danger"> · заблокировано: {l.blockedReason}</span>}
          </p>
        )}
        {r.user && (
          <p className="mt-2 text-sm">
            <Link href={`/u/${r.user.username}`} target="_blank" className="hover:underline">
              @{r.user.username}
            </Link>
            {r.user.blockedAt && <span className="text-danger"> · заблокирован</span>}
          </p>
        )}
        {r.status !== "OPEN" && r.resolution && <p className="mt-2 text-sm text-muted">Решение: {r.resolution}</p>}
      </div>
      {r.status === "OPEN" && (
        <div className="flex w-full flex-col gap-2 md:w-72">
          <Input aria-label="Причина решения" placeholder="Причина (увидит продавец)…" value={reason} onChange={(e) => setReason(e.target.value)} className="h-10" />
          <div className="flex flex-wrap gap-2">
            {r.targetType === "APPEAL" ? (
              <Button size="sm" loading={busy === "unblock"} onClick={() => resolve("unblock")}>
                Разблокировать
              </Button>
            ) : r.targetType === "LISTING" ? (
              <Button size="sm" variant="danger" loading={busy === "block"} onClick={() => resolve("block")}>
                Снять вещь
              </Button>
            ) : null}
            {r.targetType !== "APPEAL" && (
              <Button size="sm" variant="secondary" loading={busy === "block_user"} onClick={() => resolve("block_user")}>
                Заблокировать продавца
              </Button>
            )}
            <Button size="sm" variant="ghost" loading={busy === "dismiss"} onClick={() => resolve("dismiss")}>
              {r.targetType === "APPEAL" ? "Оставить блокировку" : "Отклонить жалобу"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
