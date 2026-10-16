"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useDialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, Chip, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import type { Card } from "@/lib/types";

type Action = "complete" | "cancel" | "keep";
interface DisputeRow {
  id: string;
  number: number;
  status: string;
  priceTotal: number;
  deliveryMethod: string;
  trackingNumber: string | null;
  createdAt: string;
  buyer: { id: string; username: string };
  seller: { id: string; username: string };
  items: Array<Card & { dealPrice: number }>;
  dispute: { at: string; reason: string | null; by: "buyer" | "seller" } | null;
  decisions: Array<{ action: Action; reason: string | null; at: string }>;
}

const ACTION_LABEL: Record<Action, string> = { complete: "Сделка завершена", cancel: "Сделка отменена", keep: "Оставлен открытым" };
const date = (s: string) => new Date(s).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Disputes: what the side who opened one wrote, the deal and its items; the admin's decision (complete, cancel,
 * keep open) with a reason both sides see. Ichiba moves no money, so a decision here refunds or pays nothing.
 */
export default function AdminDisputesPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const { data, error, mutate } = useSWR<{ items: DisputeRow[] }>(`/admin/disputes?status=${status}`);
  const { prompt } = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (r: DisputeRow, action: Action) => {
    const reason = await prompt({
      title: { complete: `Завершить сделку № ${r.number}?`, cancel: `Отменить сделку № ${r.number}?`, keep: `Оставить спор № ${r.number} открытым?` }[action],
      message:
        action === "cancel"
          ? "Вещь вернётся в продажу, если её не передавали и не держит другая сделка; переданная — будет скрыта до возврата продавцу. Деньги платформа не проводит: возврат, если он нужен, стороны делают сами."
          : action === "complete"
            ? "Вещь станет проданной, как будто покупатель подтвердил получение. Деньги платформа не проводит."
            : "Статус не изменится, заметка попадёт в историю сделки.",
      label: action === "keep" ? "Заметка" : "Решение — его увидят обе стороны",
      multiline: true,
      confirmLabel: { complete: "Завершить", cancel: "Отменить сделку", keep: "Сохранить" }[action],
      danger: action === "cancel",
    });
    if (reason === null || !reason.trim()) return;
    setBusy(r.id);
    try {
      await api(`/admin/disputes/${r.id}/resolve`, { body: { action, reason } });
      toast(action === "keep" ? "Заметка сохранена" : "Решение записано");
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось", { tone: "error" });
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex gap-2">
        {(
          [
            ["open", "Открытые"],
            ["resolved", "Решённые"],
          ] as const
        ).map(([k, l]) => (
          <Chip key={k} active={status === k} onClick={() => setStatus(k)}>
            {l}
          </Chip>
        ))}
      </div>
      {error ? (
        <ErrorState message="Не удалось загрузить споры" onRetry={() => mutate()} />
      ) : !data ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState title={status === "open" ? "Открытых споров нет" : "Пока ничего"} />
      ) : (
        <ul className="flex flex-col gap-4">
          {data.items.map((r) => (
            <li key={r.id} className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-paper)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">
                    Сделка № {r.number}{" "}
                    {r.status === "DISPUTED" ? <Badge tone="danger">спор</Badge> : <Badge tone="ok">{r.status === "COMPLETED" ? "завершена" : "отменена"}</Badge>}
                  </p>
                  <p className="text-sm text-ink-2">
                    покупатель @{r.buyer.username} · продавец @{r.seller.username} · <span className="tabular">{formatPrice(r.priceTotal)}</span>
                    {r.trackingNumber && ` · трек ${r.trackingNumber}`}
                  </p>
                </div>
                {r.status === "DISPUTED" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={busy === r.id} onClick={() => decide(r, "complete")}>
                      Завершить
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r, "cancel")}>
                      Отменить и вернуть
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r, "keep")}>
                      Оставить открытым
                    </Button>
                  </div>
                )}
              </div>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {r.items.map((i) => (
                  <li key={i.id}>
                    <Link href={`/item/${i.id}`} target="_blank" className="underline underline-offset-4">
                      {i.title}
                    </Link>
                    {i.size ? ` · ${i.size}` : ""} · <span className="tabular">{formatPrice(i.dealPrice)}</span>
                  </li>
                ))}
              </ul>
              {r.dispute && (
                <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">
                  <span className="text-muted">{r.dispute.by === "buyer" ? "Покупатель" : "Продавец"}, {date(r.dispute.at)}: </span>
                  {r.dispute.reason}
                </p>
              )}
              {r.decisions.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
                  {r.decisions.map((d, k) => (
                    <li key={k}>
                      {date(d.at)} · {ACTION_LABEL[d.action] ?? d.action}
                      {d.reason ? `: ${d.reason}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
