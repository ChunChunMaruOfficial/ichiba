"use client";

import { useDialog } from "@/components/dialog";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Avatar } from "@/components/avatar";
import { LookEditor } from "@/components/looks";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatPrice, listingPrice } from "@/lib/labels";
import type { Look } from "@/lib/types";
import { itemHref } from "@/lib/item-path";

// The pieces lie on the page like clothes laid out on a table: each at its own slight angle.
const TILT = [-3, 2.5, -1.5, 3, -2.5, 1.5, -2, 2];

/** One look: the pieces laid out together, their prices, and «Всё в корзину». */
export default function LookPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useDialog();
  const { requireAuth, refresh } = useSession();
  const { data, error, mutate } = useSWR<Look>(`/looks/${encodeURIComponent(id)}`);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  if (error) {
    return error instanceof ApiError && error.status === 404 ? <EmptyState title="Образ не найден" hint="Возможно, его удалили" /> : <ErrorState message="Не удалось открыть образ" onRetry={() => mutate()} />;
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <Skeleton className="h-10 w-64" />
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const addAll = () =>
    requireAuth(async () => {
      setAdding(true);
      const onSale = data.items.filter((i) => i.status === "PUBLISHED");
      const results = await Promise.allSettled(onSale.map((i) => api(`/cart/${i.id}`, { method: "POST" })));
      setAdding(false);
      void refresh();
      const ok = results.filter((r) => r.status === "fulfilled").length;
      toast(ok ? `В корзине: ${ok} ${ok === 1 ? "вещь" : ok < 5 ? "вещи" : "вещей"} из образа` : "Не получилось добавить в корзину", {
        tone: ok ? "default" : "error",
        action: ok ? { label: "Открыть корзину", onClick: () => router.push("/cart") } : undefined,
      });
    });

  const remove = async () => {
    if (!(await confirm({ title: "Удалить образ?", message: "Вещи останутся в гардеробе.", confirmLabel: "Удалить", danger: true }))) return;
    await api(`/looks/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Образ удалён");
    router.push(data.owner ? `/u/${data.owner.username}` : "/");
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">
      <header className="flex flex-wrap items-center gap-4">
        {data.owner && (
          <Link href={`/u/${data.owner.username}`} className="flex items-center gap-2.5 text-sm text-ink-2 hover:text-ink">
            <Avatar username={data.owner.username} avatar={data.owner.avatar} ring className="size-11" />
            <span>
              <span className="block text-xs uppercase tracking-[0.12em] text-muted">Образ</span>@{data.owner.username}
            </span>
          </Link>
        )}
        {data.isOwner && (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Изменить
            </Button>
            <Button variant="ghost" size="sm" className="text-danger" onClick={remove}>
              Удалить
            </Button>
          </div>
        )}
      </header>
      <h1 className="rise mt-5 text-3xl font-bold tracking-tight md:text-5xl">{data.title}</h1>

      <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 md:gap-x-8 md:gap-y-12">
        {data.items.map((c, i) => (
          <li key={c.id} className="pop" style={{ animationDelay: `${i * 60}ms` }}>
            <Link href={itemHref(c)} className="group block">
              <span
                className="block overflow-hidden rounded-2xl bg-skeleton shadow-[var(--shadow-paper)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:rotate-0 group-hover:scale-[1.02]"
                style={{ rotate: `${TILT[i % TILT.length]}deg`, aspectRatio: "4 / 5" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.cover && <img src={c.cover.urls.m} alt={c.title} className={clsx("size-full object-cover", c.status !== "PUBLISHED" && "opacity-60")} />}
              </span>
              <span className="mt-3 block truncate font-medium">{c.title}</span>
              <span className="block text-sm text-ink-2 tabular">{c.status === "SOLD" ? "Продано" : c.status === "RESERVED" ? "Забронировано" : listingPrice(c)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {data.available > 0 && !data.isOwner && (
        <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom))] mt-10 flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-[var(--shadow-float)] md:bottom-6">
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-muted">
              {data.available === data.items.length ? "Весь образ" : `Доступно ${data.available} из ${data.items.length}`}
            </span>
            <span className="block text-xl font-bold tabular">{formatPrice(data.total)}</span>
          </span>
          <Button loading={adding} onClick={addAll}>
            Всё в корзину
          </Button>
        </div>
      )}

      {data.isOwner && data.owner && <LookEditor username={data.owner.username} open={editing} onClose={() => setEditing(false)} look={data} onSaved={(l) => void mutate({ ...data, ...l }, { revalidate: true })} />}
    </div>
  );
}
