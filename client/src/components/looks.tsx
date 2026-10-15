"use client";

import clsx from "clsx";
import Link from "next/link";
import { DragRow } from "./drag-row";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { formatPrice, listingPrice } from "@/lib/labels";
import type { Card, Cover, Look } from "@/lib/types";
import { useSession } from "./session";
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

/** A person's looks as round highlights on their profile; the owner gets «Новый образ» first. */
export function LookHighlights({ username, owner, onCreate }: { username: string; owner: boolean; onCreate: () => void }) {
  const { data } = useSWR<{ items: Look[] }>(`/users/${username}/looks`);
  if (!data) return owner ? <div className="h-[92px]" /> : null;
  if (!data.items.length && !owner) return null;
  return (
    <DragRow role="navigation" aria-label="Образы" viewportClassName="-mx-4 md:mx-0" className="gap-4 px-4 pb-1 md:px-0">
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
    </DragRow>
  );
}

/** Create or edit a look: a name and 2–8 items from anywhere on the site (favourites, own wardrobe, search). */
export function LookEditor({ username, open, onClose, look, initial, onSaved }: { username: string; open: boolean; onClose: () => void; look?: Look; initial?: Card[]; onSaved: (l: Look) => void }) {
  const toast = useToast();
  const router = useRouter();
  const [title, setTitle] = useState(look?.title ?? "");
  // Picked items in the order they were tapped, with their cards so they stay visible across tabs.
  const [picked, setPicked] = useState<Card[]>(look?.items ?? initial ?? []);
  const [source, setSource] = useState<"favorites" | "mine" | "search">("favorites");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = !open
    ? null
    : source === "favorites"
      ? "/favorites?sort=recent"
      : source === "mine"
        ? `/wardrobes/${username}?section=all&sort=new`
        : query
          ? `/search?q=${encodeURIComponent(query)}&limit=36&market=all`
          : "/feed?chip=new&limit=36&market=all";
  const { data } = useSWR<{ items?: Card[]; groups?: Array<{ items: Card[] }> }>(key);
  const items = (data?.items ?? data?.groups?.flatMap((g) => g.items) ?? []).filter((c) => c.status === "PUBLISHED" || c.status === "RESERVED" || c.status === "SOLD" || (source === "mine" && c.status === "HIDDEN"));
  const toggle = (c: Card) => setPicked((p) => (p.some((x) => x.id === c.id) ? p.filter((x) => x.id !== c.id) : p.length >= 8 ? p : [...p, c]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { title, listingIds: picked.map((c) => c.id) };
      const saved = look ? await api<Look>(`/looks/${look.id}`, { method: "PATCH", body }) : await api<Look>("/looks", { body });
      toast(look ? "Образ сохранён" : "Образ создан", look ? undefined : { action: { label: "Открыть", onClick: () => router.push(`/looks/${saved.id}`) } });
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
          <Input id="look-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Например: «Осень в городе»" />
        </Field>

        {/* What's in the look so far; a tap takes a piece out. */}
        <div>
          <p className="mb-2 flex justify-between text-sm">
            <span className="font-medium">В образе</span>
            <span className="tabular text-muted">{picked.length} из 8</span>
          </p>
          {picked.length ? (
            <ul className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {picked.map((c, i) => (
                <li key={c.id} className="relative shrink-0">
                  <button type="button" onClick={() => toggle(c)} aria-label={`Убрать «${c.title}»`} className="block h-20 w-16 overflow-hidden rounded-lg bg-skeleton ring-2 ring-shu">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.cover && <img src={c.cover.urls.s} alt="" className="size-full object-cover" />}
                  </button>
                  <span className="absolute -left-1 -top-1 grid size-5 place-items-center rounded-full bg-shu text-[11px] font-bold text-on-shu">{i + 1}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Выберите вещи ниже — из избранного, своего гардероба или со всего сайта.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["favorites", "Избранное"],
              ["mine", "Мой гардероб"],
              ["search", "Весь сайт"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setSource(id)} className={clsx("h-9 rounded-full px-3.5 text-sm", source === id ? "bg-ink text-accent-ink" : "shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-ink/5")}>
              {label}
            </button>
          ))}
          {source === "search" && <Input aria-label="Поиск вещей" placeholder="Что ищем? Например, «джинсы»" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 min-w-0 flex-1 basis-48" />}
        </div>

        {!data ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{source === "favorites" ? "В избранном пока пусто" : source === "mine" ? "В гардеробе пока нет вещей" : "Ничего не нашли"}</p>
        ) : (
          <ul className="grid max-h-[40vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {items.map((c) => {
              const n = picked.findIndex((x) => x.id === c.id);
              return (
                <li key={c.id}>
                  <button type="button" aria-pressed={n >= 0} onClick={() => toggle(c)} title={c.title} className={clsx("relative block aspect-[4/5] w-full overflow-hidden rounded-xl bg-skeleton ring-offset-2 ring-offset-surface transition", n >= 0 ? "ring-2 ring-shu" : "hover:opacity-90")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.cover && <img src={c.cover.urls.s} alt={c.title} className="size-full object-cover" />}
                    <span className={clsx("absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full text-xs font-bold", n >= 0 ? "bg-shu text-on-shu" : "bg-black/35 text-white")}>{n >= 0 ? n + 1 : ""}</span>
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-kraft/95 px-1 text-[10px] font-bold tabular text-kraft-ink">{listingPrice(c)}</span>
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

/** Item page «В образ»: add this item to one of your looks, or start a new look with it. */
export function AddToLook({ card, open, onClose }: { card: Card; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { me } = useSession();
  const { data, mutate } = useSWR<{ items: Look[] }>(open ? "/looks/mine" : null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (creating && me) return <LookEditor username={me.username} open onClose={() => (setCreating(false), onClose())} initial={[card]} onSaved={() => void mutate()} />;
  return (
    <Modal open={open} onClose={onClose} title="Добавить в образ">
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-3 rounded-2xl p-2 text-left hover:bg-ink/5">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl border-2 border-dashed border-line-strong text-ink-2">
            <IconPlus className="size-6" />
          </span>
          <span className="font-semibold">Новый образ с этой вещью</span>
        </button>
        {!data ? (
          <Skeleton className="h-16 rounded-2xl" />
        ) : (
          data.items.map((l) => {
            const has = l.items.some((i) => i.id === card.id);
            return (
              <button
                key={l.id}
                type="button"
                disabled={has || l.items.length >= 8 || busy === l.id}
                onClick={async () => {
                  setBusy(l.id);
                  try {
                    await api(`/looks/${l.id}/items/${card.id}`, { method: "POST" });
                    toast(`Добавлено в «${l.title}»`, { action: { label: "Открыть", onClick: () => router.push(`/looks/${l.id}`) } });
                    onClose();
                  } catch (e) {
                    toast(e instanceof ApiError ? e.message : "Не получилось добавить", { tone: "error" });
                  } finally {
                    setBusy(null);
                  }
                }}
                className="flex items-center gap-3 rounded-2xl p-2 text-left hover:bg-ink/5 disabled:opacity-60"
              >
                <LookCollage covers={l.items.map((i) => i.cover)} className="size-14 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.title}</span>
                  <span className="text-sm text-muted">{has ? "Уже в образе" : l.items.length >= 8 ? "Уже 8 вещей" : `${l.items.length} вещей`}</span>
                </span>
              </button>
            );
          })
        )}
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

