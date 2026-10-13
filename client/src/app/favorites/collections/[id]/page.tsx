"use client";

import { useDialog } from "@/components/dialog";
import { Omamori } from "@/components/shop/omamori";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { ItemCard } from "@/components/item-card";
import { MasonrySkeleton } from "@/components/masonry";
import { RequireAuth } from "@/components/require-auth";
import { useToast } from "@/components/toast";
import { Button, ButtonLink, EmptyState, ErrorState, IconX, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Card } from "@/lib/types";

export default function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth reason="чтобы открыть коллекцию">{() => <Collection id={id} />}</RequireAuth>;
}

/** Collection page (frame 11 page 9): editable name, items, delete (items stay in Favorites). */
function Collection({ id }: { id: string }) {
  const { data, error, mutate } = useSWR<{ id: string; name: string; items: Card[] }>(`/collections/${id}`);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useDialog();

  if (error) return error instanceof ApiError && error.status === 404 ? <EmptyState title="Коллекция не найдена" /> : <ErrorState message="Не удалось загрузить коллекцию" onRetry={() => mutate()} />;

  const rename = async () => {
    try {
      await api(`/collections/${id}`, { method: "PATCH", body: { name } });
      setEditing(false);
      void mutate();
    } catch (e) {
      toast(e instanceof ApiError ? (e.fields.name ?? e.message) : "Не удалось переименовать", { tone: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <Link href="/favorites?tab=collections" className="text-sm text-ink-2 hover:text-ink">
        ← Коллекции
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <Input aria-label="Название коллекции" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="h-11 text-xl font-semibold" />
            <Button type="submit">Сохранить</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </form>
        ) : (
          <h1 className="text-3xl font-semibold tracking-tight">
            <button onClick={() => (setName(data?.name ?? ""), setEditing(true))} className="text-left hover:underline" title="Переименовать">
              {data?.name ?? "…"}
            </button>
            {data && <span className="ml-2 text-xl font-normal text-muted">· {data.items.length}</span>}
          </h1>
        )}
        <Button
          variant="ghost"
          className="text-danger"
          onClick={async () => {
            if (!(await confirm({ title: "Удалить коллекцию?", message: "Вещи останутся в избранном.", confirmLabel: "Удалить", danger: true }))) return;
            await api(`/collections/${id}`, { method: "DELETE" });
            toast("Коллекция удалена");
            router.push("/favorites?tab=collections");
          }}
        >
          Удалить коллекцию
        </Button>
      </div>

      <div className="mt-8">
        {!data ? (
          <MasonrySkeleton />
        ) : data.items.length === 0 ? (
          <EmptyState art={<Omamori className="mb-2 h-36" />} title="В коллекции пока пусто" hint="Откройте вещь из избранного и нажмите «Добавить в коллекцию»">
            <ButtonLink href="/favorites">Избранное</ButtonLink>
          </EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
            {data.items.map((i) => (
              <div key={i.id} className="relative">
                <ItemCard card={i} variant="grid" />
                <button
                  aria-label={`Убрать «${i.title}» из коллекции`}
                  onClick={async () => {
                    await mutate((d) => d && { ...d, items: d.items.filter((x) => x.id !== i.id) }, { revalidate: false });
                    await api(`/collections/${id}/items/${i.id}`, { method: "DELETE" }).catch(() => mutate());
                  }}
                  className="absolute left-2.5 top-2.5 grid size-9 place-items-center on-photo rounded-full text-ink hover:scale-105"
                >
                  <IconX className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
