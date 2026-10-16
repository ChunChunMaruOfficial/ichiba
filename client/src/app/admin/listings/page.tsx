"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useToast } from "@/components/toast";
import { Button, Chip, EmptyState, ErrorState, Input, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import type { Card } from "@/lib/types";

type Row = Card & { blockedReason: string | null; market: "brands" | "resale"; marketByAdmin: boolean };

const TABS = [
  ["BLOCKED", "Заблокированные"],
  ["PUBLISHED", "В продаже"],
  ["HIDDEN", "Скрытые"],
] as const;

/**
 * Blocked listings with a manual unblock; items on sale with their section (catalogue or «Вторичка»), which an
 * admin can change for one item under the platform rules. A moved item stays where the admin put it, whatever
 * later happens to the seller's status. Search by title or seller.
 */
export default function AdminListingsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof TABS)[number][0]>("BLOCKED");
  const { data, error, mutate } = useSWR<{ items: Row[] }>(`/admin/listings?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const toast = useToast();
  const move = async (l: Row) => {
    const market = l.market === "brands" ? "resale" : "brands";
    try {
      await api(`/admin/listings/${l.id}/market`, { body: { market } });
      toast(market === "brands" ? "Вещь в основном каталоге" : "Вещь на вторичке");
      void mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось перенести");
    }
  };
  return (
    <div>
      <div className="mb-4 flex gap-2">
        {TABS.map(([k, label]) => (
          <Chip key={k} active={status === k} onClick={() => setStatus(k)}>
            {label}
          </Chip>
        ))}
      </div>
      <Input aria-label="Поиск" placeholder="Название или @продавец…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-6 max-w-sm" />
      {error ? (
        <ErrorState message="Не удалось загрузить" onRetry={() => mutate()} />
      ) : !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : data.items.length === 0 ? (
        <EmptyState title={status === "BLOCKED" ? "Заблокированных вещей нет" : "Ничего не найдено"} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {data.items.map((l) => (
            <li key={l.id} className="flex items-center gap-4 py-3">
              <div className="w-14 shrink-0 overflow-hidden rounded-lg bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {l.cover && <img src={l.cover.urls.s} alt="" width={56} height={70} className="size-full object-contain" />}
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/item/${l.id}`} target="_blank" className="block truncate font-medium hover:underline">
                  {l.title}
                </Link>
                <p className="text-sm text-muted">
                  @{l.seller.username} · <span className="tabular">{formatPrice(l.price)}</span> · {l.market === "brands" ? "каталог" : "вторичка"}
                  {l.marketByAdmin ? " (решение админа)" : ""}
                  {l.isBrand ? " · бренд" : ""}
                </p>
                {l.blockedReason && <p className="text-sm text-danger">{l.blockedReason}</p>}
              </div>
              {status === "BLOCKED" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await api(`/admin/listings/${l.id}/unblock`, { method: "POST" });
                    toast("Вещь снова опубликована");
                    void mutate();
                  }}
                >
                  Разблокировать
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => move(l)}>
                  {l.market === "brands" ? "На вторичку" : "В каталог"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
