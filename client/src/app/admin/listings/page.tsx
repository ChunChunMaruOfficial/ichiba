"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useToast } from "@/components/toast";
import { Button, EmptyState, ErrorState, Input, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import type { Card } from "@/lib/types";

/** Blocked listings with a manual unblock; search by title or seller. */
export default function AdminListingsPage() {
  const [q, setQ] = useState("");
  const { data, error, mutate } = useSWR<{ items: Array<Card & { blockedReason: string | null }> }>(`/admin/listings?status=BLOCKED${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const toast = useToast();
  return (
    <div>
      <Input aria-label="Поиск" placeholder="Название или @продавец…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-6 max-w-sm" />
      {error ? (
        <ErrorState message="Не удалось загрузить" onRetry={() => mutate()} />
      ) : !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Заблокированных вещей нет" />
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
                  @{l.seller.username} · <span className="tabular">{formatPrice(l.price)}</span>
                </p>
                {l.blockedReason && <p className="text-sm text-danger">{l.blockedReason}</p>}
              </div>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
