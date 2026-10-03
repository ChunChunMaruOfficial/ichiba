"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { items } from "@/lib/labels";
import type { CollectionSummary } from "@/lib/types";
import { useToast } from "./toast";
import { Button, Chip, Field, Input, Modal, Spinner } from "./ui";

const NAME_HINTS = ["Осень", "Образы", "На работу", "Хочу", "Мой wishlist"];

export function NewCollectionModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: CollectionSummary) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const c = await api<CollectionSummary>("/collections", { body: { name } });
      setName("");
      onCreated(c);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.name ?? e.message) : "Не удалось создать");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новая коллекция">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Название" htmlFor="collection-name" error={error ?? undefined} hint={`${name.length}/40`}>
          <Input id="collection-name" name="name" autoComplete="off" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          {NAME_HINTS.map((h) => (
            <Chip key={h} onClick={() => setName(h)}>
              {h}
            </Chip>
          ))}
        </div>
        <Button type="submit" block className="mt-5" loading={busy} disabled={!name.trim()}>
          Создать
        </Button>
      </form>
    </Modal>
  );
}

/** "В коллекцию": checkbox list of collections + "Новая" (frame 11 SECONDARY ACTIONS). */
export function AddToCollection({ listingId, open, onClose }: { listingId: string; open: boolean; onClose: () => void }) {
  const { data, mutate } = useSWR<{ items: CollectionSummary[] }>(open ? `/collections?listingId=${listingId}` : null);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const toggle = async (c: CollectionSummary) => {
    const has = !!c.hasItem;
    void mutate((d) => d && { items: d.items.map((x) => (x.id === c.id ? { ...x, hasItem: !has, count: x.count + (has ? -1 : 1) } : x)) }, { revalidate: false });
    try {
      await api(`/collections/${c.id}/items/${listingId}`, { method: has ? "DELETE" : "PUT" });
    } catch {
      toast("Не удалось сохранить", { tone: "error" });
      void mutate();
    }
  };

  return (
    <>
      <Modal open={open && !creating} onClose={onClose} title="В коллекцию">
        {!data ? (
          <div className="flex justify-center py-6 text-muted">
            <Spinner />
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.items.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-paper">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!c.hasItem} onChange={() => toggle(c)} />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-sm text-muted">{c.count}</span>
                </label>
              </li>
            ))}
            {data.items.length === 0 && <li className="px-3 py-2 text-sm text-muted">Коллекций пока нет</li>}
          </ul>
        )}
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" onClick={() => setCreating(true)}>
            + Новая коллекция
          </Button>
          <Button className="ml-auto" onClick={onClose}>
            Готово
          </Button>
        </div>
      </Modal>
      <NewCollectionModal
        open={open && creating}
        onClose={() => setCreating(false)}
        onCreated={async (c) => {
          await api(`/collections/${c.id}/items/${listingId}`, { method: "PUT" });
          toast(`Добавлено в «${c.name}»`);
          setCreating(false);
          void mutate();
        }}
      />
    </>
  );
}

/** Collection tile: 2×2 collage of the latest items + name + count. */
export function CollectionTile({ c }: { c: CollectionSummary }) {
  return (
    <Link href={`/favorites/collections/${c.id}`} className="group block">
      <div className="grid aspect-square grid-cols-2 gap-1 overflow-hidden rounded-2xl bg-skeleton">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="overflow-hidden bg-skeleton">
            {c.covers[i] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.covers[i]!} alt="" width={160} height={160} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 font-medium">{c.name}</p>
      <p className="text-sm text-muted">{items(c.count)}</p>
    </Link>
  );
}
