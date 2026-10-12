"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import type { Card, Cover, Look } from "@/lib/types";
import { useToast } from "./toast";
import { Button, Field, IconPlus, Input, Modal, Skeleton } from "./ui";

/** Up to four item covers in a grid (2×2, or side by side for two). */
export function LookCollage({ covers, className, round }: { covers: (Cover | null)[]; className?: string; round?: boolean }) {
  const shown = covers.slice(0, 4);
  return (
    <span className={clsx("grid overflow-hidden bg-skeleton", shown.length > 2 ? "grid-cols-2 grid-rows-2" : "grid-cols-2", round ? "rounded-full" : "rounded-2xl", className)}>
      {shown.map((c, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={c?.urls.s} alt="" className={clsx("size-full object-cover", shown.length === 3 && i === 0 && "row-span-2")} />
      ))}
    </span>
  );
}

/** The profile's looks as round highlights under the bio; the owner gets «Новый образ» first. */
export function LookHighlights({ username, owner, onCreate }: { username: string; owner: boolean; onCreate: () => void }) {
  const { data } = useSWR<{ items: Look[] }>(`/users/${username}/looks`);
  if (!data) return owner ? <div className="h-[92px]" /> : null;
  if (!data.items.length && !owner) return null;
  return (
    <nav aria-label="Образы" className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {owner && (
        <button type="button" onClick={onCreate} className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center">
          <span className="grid size-[68px] place-items-center rounded-full border-2 border-dashed border-line-strong text-ink-2 transition-colors hover:border-shu hover:text-shu">
            <IconPlus className="size-6" />
          </span>
          <span className="w-full truncate text-[11px] text-ink-2">Новый образ</span>
        </button>
      )}
      {data.items.map((l) => (
        <Link key={l.id} href={`/looks/${l.id}`} className="group flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center">
          <span className="block size-[68px] rounded-full bg-[conic-gradient(from_200deg,var(--shu),var(--amber),var(--shu))] p-[2.5px] transition-transform group-hover:scale-105">
            <span className="block size-full rounded-full bg-paper p-[2.5px]">
              <LookCollage covers={l.items.map((i) => i.cover)} round className="size-full" />
            </span>
          </span>
          <span className="w-full truncate text-[11px]">{l.title}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Create or edit a look: a name and 2–8 of the seller's own items, in the order they were tapped. */
export function LookEditor({ username, open, onClose, look, onSaved }: { username: string; open: boolean; onClose: () => void; look?: Look; onSaved: (l: Look) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(look?.title ?? "");
  const [picked, setPicked] = useState<string[]>(look?.items.map((i) => i.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data } = useSWR<{ groups: Array<{ items: Card[] }> }>(open ? `/wardrobes/${username}?section=all&sort=new` : null);
  const items = (data?.groups.flatMap((g) => g.items) ?? []).filter((c) => c.status !== "DRAFT" && c.status !== "BLOCKED");
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 8 ? p : [...p, id]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { title, listingIds: picked };
      const saved = look ? await api<Look>(`/looks/${look.id}`, { method: "PATCH", body }) : await api<Look>("/looks", { body });
      toast(look ? "Образ сохранён" : "Образ создан");
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не получилось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={look ? "Изменить образ" : "Новый образ"} width="max-w-2xl">
      <div className="flex flex-col gap-4">
        <Field label="Название" htmlFor="look-title" error={error ?? undefined}>
          <Input id="look-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Например: «Осень в городе»" autoFocus />
        </Field>
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium">Вещи из гардероба</p>
          <p className="text-sm text-muted tabular">Выбрано {picked.length} из 8</p>
        </div>
        {!data ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
            ))}
          </div>
        ) : items.length < 2 ? (
          <p className="py-6 text-center text-sm text-muted">Для образа нужно хотя бы 2 вещи в гардеробе.</p>
        ) : (
          <ul className="grid max-h-[46vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {items.map((c) => {
              const n = picked.indexOf(c.id);
              return (
                <li key={c.id}>
                  <button type="button" aria-pressed={n >= 0} onClick={() => toggle(c.id)} className={clsx("relative block aspect-[4/5] w-full overflow-hidden rounded-xl bg-skeleton ring-offset-2 ring-offset-surface transition", n >= 0 ? "ring-2 ring-shu" : "hover:opacity-90")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.cover && <img src={c.cover.urls.s} alt={c.title} className="size-full object-cover" />}
                    <span className={clsx("absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full text-xs font-bold", n >= 0 ? "bg-shu text-on-shu" : "bg-black/35 text-white")}>{n >= 0 ? n + 1 : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={busy} disabled={!title.trim() || picked.length < 2} onClick={save}>
            {look ? "Сохранить" : "Создать образ"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Item page: the looks this item is part of, each as a small collage with the other pieces. */
export function LooksWithItem({ listingId }: { listingId: string }) {
  const { data } = useSWR<{ items: Look[] }>(`/listings/${listingId}/looks`);
  if (!data?.items.length) return null;
  return (
    <section className="mt-6">
      <p className="mb-2 text-sm font-medium text-ink-2">Входит в образ</p>
      <ul className="flex flex-col gap-2">
        {data.items.map((l) => (
          <li key={l.id}>
            <Link href={`/looks/${l.id}`} className="flex items-center gap-3 rounded-2xl bg-surface p-2 pr-4 shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[var(--shadow-paper),inset_0_0_0_1px_var(--line)]">
              <LookCollage covers={l.items.map((i) => i.cover)} className="size-14 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{l.title}</span>
                <span className="block text-sm text-muted">
                  {l.items.length} {l.items.length < 5 ? "вещи" : "вещей"}
                  {l.available > 0 && ` · ${formatPrice(l.total)}`}
                </span>
              </span>
              <span className="text-sm font-medium text-ink-2">Смотреть →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

