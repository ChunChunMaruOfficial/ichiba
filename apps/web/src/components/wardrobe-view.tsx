"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { items as itemsLabel, plural } from "@/lib/labels";
import { useListingActions } from "@/lib/listing-actions";
import type { Card, Deal, Offer, SellerSummary } from "@/lib/types";
import { DealCard } from "./deal-actions";
import { ReportModal } from "./report-modal";
import { OfferCard } from "./offer";
import { ItemCard } from "./item-card";
import { FollowButton } from "./sections";
import { useSession } from "./session";
import { useToast } from "./toast";
import { Button, ButtonLink, Chip, EmptyState, ErrorState, IconMore, IconPlus, IconShare, Modal, Skeleton, Spinner } from "./ui";

interface WardrobeData {
  seller: SellerSummary;
  isOwner: boolean;
  counts: Record<"all" | "top" | "bottom" | "shoes" | "accessories" | "new" | "selling" | "sold", number>;
  groups: Array<{ section: "top" | "bottom" | "shoes" | "accessories"; items: Card[] }>;
  drafts: Card[];
  favoritesTotal?: number;
}

/** "марта 2026" — genitive month, as in "на платформе с марта 2026". */
const sinceLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }).split(" ")[1]} ${d.getFullYear()}`;
};

const SECTION_LABEL = { top: "Верх", bottom: "Низ", shoes: "Обувь", accessories: "Аксессуары" } as const;
const FILTERS = [
  ["all", "Все"],
  ["top", "Верх"],
  ["bottom", "Низ"],
  ["shoes", "Обувь"],
  ["accessories", "Аксессуары"],
  ["new", "Новинки"],
  ["selling", "Продаётся"],
  ["sold", "Продано"],
] as const;
const SORTS = [
  ["new", "Новые"],
  ["old", "Старые"],
  ["cheap", "Дешевле"],
  ["expensive", "Дороже"],
] as const;

function OwnerMenu({ card, onDone }: { card: Card; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const actions = useListingActions(onDone);
  const reserved = card.status === "RESERVED";
  const item = (label: string, onClick: () => void, opts: { danger?: boolean; disabled?: boolean } = {}) => (
    <button
      disabled={opts.disabled}
      title={opts.disabled ? "Идёт сделка — завершите или отмените её в «Мои продажи»" : undefined}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-paper disabled:cursor-not-allowed disabled:text-muted ${opts.danger ? "text-danger" : ""}`}
    >
      {label}
    </button>
  );
  return (
    <div className="relative">
      <button aria-label="Действия с вещью" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="grid size-9 place-items-center rounded-full bg-white/90 shadow-sm">
        <IconMore />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="fade-in absolute right-0 top-11 z-20 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
            {item(card.status === "DRAFT" ? "Продолжить" : "Редактировать", () => router.push(`/item/${card.id}/edit`))}
            {card.status === "PUBLISHED" && item("Снять с продажи", () => actions.hide(card.id))}
            {card.status === "HIDDEN" && item("Вернуть в продажу", () => actions.unhide(card.id))}
            {(card.status === "PUBLISHED" || card.status === "HIDDEN" || reserved) && item("Пометить как проданное", () => actions.markSold(card.id), { disabled: reserved })}
            {card.status !== "SOLD" && item("Удалить", () => actions.remove(card.id), { danger: true, disabled: reserved })}
          </div>
        </>
      )}
    </div>
  );
}

function Grid({ items, owner, onDone }: { items: Card[]; owner: boolean; onDone: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((c) => (
        <div key={c.id} className="relative">
          <ItemCard card={c} variant="grid" source="wardrobe" />
          {owner && (
            <div className="absolute right-12 top-2.5">
              <OwnerMenu card={c} onDone={onDone} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ActionRequired({ onChange }: { onChange: () => void }) {
  const { data, mutate } = useSWR<{ items: Deal[]; summary: { newRequests: number; waitingHandover: number; offers: number } }>("/sales?tab=action");
  const offers = useSWR<{ items: Offer[] }>("/offers?role=seller&turn=mine");
  const total = (data?.items.length ?? 0) + (offers.data?.items.length ?? 0);
  if (!data || total === 0) return null;
  const { newRequests, waitingHandover } = data.summary;
  const offerCount = offers.data?.items.length ?? 0;
  const cards = [
    ...(offers.data?.items ?? []).map((o) => ({ key: o.id, node: <OfferCard offer={o} onChange={() => (void offers.mutate(), onChange())} /> })),
    ...data.items.map((d) => ({ key: d.id, node: <DealCard deal={d} onChange={() => (void mutate(), onChange())} /> })),
  ];
  return (
    <section className="mb-10 rounded-3xl bg-warn-soft/60 p-4 md:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">
          Требует действия
          <span className="ml-2 text-sm font-normal text-ink-2">
            {[
              newRequests && `${newRequests} ${plural(newRequests, "новый запрос", "новых запроса", "новых запросов")}`,
              offerCount && `${offerCount} ${plural(offerCount, "предложение цены", "предложения цены", "предложений цены")}`,
              waitingHandover && `${waitingHandover} ожидают передачи`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </h2>
        {total > 3 && (
          <Link href="/sales" className="text-sm font-medium hover:underline">
            Все ({total})
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {cards.slice(0, 3).map((c) => (
          <div key={c.key}>{c.node}</div>
        ))}
      </div>
      <Link href="/sales" className="mt-4 inline-block text-sm font-medium text-ink-2 hover:text-ink">
        Все продажи
      </Link>
    </section>
  );
}

/** Seller Wardrobe and My Wardrobe share one template (frame 09); MVP is a 2D grid grouped by section. */
export function WardrobeView({ username }: { username: string }) {
  const params = useSearchParams();
  const section = (FILTERS.find(([k]) => k === params.get("section"))?.[0] ?? "all") as (typeof FILTERS)[number][0];
  const sort = SORTS.find(([k]) => k === params.get("sort"))?.[0] ?? "new";
  const { me, requireAuth } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [people, setPeople] = useState<"followers" | "following" | null>(null);
  const setQuery = (next: { section?: string; sort?: string }) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "all" || v === "new") sp.delete(k);
      else sp.set(k, v);
    }
    const q = sp.toString();
    router.replace(q ? `?${q}` : "?", { scroll: false });
  };
  const setSection = (s: string) => setQuery({ section: s });
  const setSort = (s: string) => setQuery({ sort: s });
  const { data, error, mutate, isLoading } = useSWR<WardrobeData>(`/wardrobes/${username}?section=${section}&sort=${sort}`);

  if (error) {
    return (error as { status?: number }).status === 404 ? (
      <EmptyState title="Такого гардероба нет">
        <ButtonLink href="/">На главную</ButtonLink>
      </EmptyState>
    ) : (
      <ErrorState message="Не удалось открыть гардероб" onRetry={() => mutate()} />
    );
  }

  const s = data?.seller;
  const owner = !!data?.isOwner;
  const share = async () => {
    const url = `${window.location.origin}/u/${username}`;
    if (navigator.share) await navigator.share({ title: `Гардероб @${username}`, url }).catch(() => {});
    else {
      await navigator.clipboard.writeText(url);
      toast("Ссылка на гардероб скопирована");
    }
  };

  const totalShown = data ? data.groups.reduce((n, g) => n + g.items.length, 0) : 0;
  const empty = data && data.counts.all === 0 && data.drafts.length === 0;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 md:py-10">
      {/* Header */}
      {!s || isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-80" />
        </div>
      ) : (
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            {owner && <p className="text-sm text-muted">Мой гардероб</p>}
            <h1 className="text-3xl font-semibold tracking-tight">{s.username}</h1>
            <p className="mt-1 text-sm text-muted">
              {[s.city, `на платформе с ${sinceLabel(s.createdAt)}`].filter(Boolean).join(" · ")}
            </p>
            {!owner && (
              <p className="mt-3 text-[15px]">
                <b>{s.activeCount}</b> {plural(s.activeCount, "вещь", "вещи", "вещей")} · <b>{s.soldCount}</b> продано ·{" "}
                <button className="hover:underline" onClick={() => setPeople("followers")}>
                  <b>{s.followers}</b> {plural(s.followers, "подписчик", "подписчика", "подписчиков")}
                </button>{" "}
                ·{" "}
                <button className="hover:underline" onClick={() => setPeople("following")}>
                  <b>{s.following}</b> {plural(s.following, "подписка", "подписки", "подписок")}
                </button>
              </p>
            )}
            {s.bio && <p className="mt-2 max-w-xl text-[15px] text-ink-2">{s.bio}</p>}
            {!owner && s.completedDeals > 0 && <p className="mt-2 text-sm text-muted">{s.completedDeals} {plural(s.completedDeals, "завершённая сделка", "завершённые сделки", "завершённых сделок")}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {owner ? (
              <>
                <ButtonLink href="/sell">
                  <IconPlus className="size-4" /> Добавить вещь
                </ButtonLink>
                <ButtonLink href="/settings" variant="secondary">
                  Редактировать профиль
                </ButtonLink>
              </>
            ) : (
              me?.username !== s.username && <FollowButton seller={s} onChange={(v) => mutate((d) => d && { ...d, seller: { ...d.seller, isFollowing: v, followers: d.seller.followers + (v ? 1 : -1) } }, { revalidate: false })} />
            )}
            <Button variant="secondary" onClick={share} aria-label="Поделиться гардеробом">
              <IconShare className="size-4" />
              <span className="hidden sm:inline">Поделиться</span>
            </Button>
            {!owner && me?.username !== s.username && (
              <Button variant="ghost" onClick={() => requireAuth(() => setReporting(true), { reason: "чтобы отправить жалобу" })}>
                Пожаловаться
              </Button>
            )}
          </div>
        </header>
      )}
      {s && <ReportModal open={reporting} onClose={() => setReporting(false)} targetType="USER" targetId={s.username} title={`@${s.username}`} />}
      {s && <PeopleModal username={s.username} list={people} onClose={() => setPeople(null)} />}

      {owner && data && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Активные вещи", data.counts.selling, () => setSection("selling")],
            ["Запросы", me?.pendingSales ?? 0, () => router.push("/sales")],
            ["Продажи", data.counts.sold, () => setSection("sold")],
            ["Подписчики", data.seller.followers, () => setPeople("followers")],
          ].map(([label, n, onClick]) => (
            <button
              key={label as string}
              disabled={!onClick}
              onClick={onClick as (() => void) | undefined}
              className="rounded-2xl bg-surface p-4 text-left transition-colors enabled:hover:bg-white disabled:cursor-default"
            >
              <p className="tabular text-2xl font-semibold">{n as number}</p>
              <p className="text-sm text-muted">{label as string}</p>
            </button>
          ))}
        </div>
      )}

      <div className="mt-8">{owner && <ActionRequired onChange={() => mutate()} />}</div>

      {empty ? (
        owner ? (
          <EmptyState title="Гардероб пока пуст" hint="Выставление занимает около минуты">
            <ButtonLink href="/sell">+ Добавить первую вещь</ButtonLink>
          </EmptyState>
        ) : (
          <EmptyState title={`У @${username} пока нет вещей`} hint="Подпишитесь, чтобы узнать о первой вещи" />
        )
      ) : (
        <>
          <div className="sticky top-14 z-20 -mx-4 flex items-center gap-2 bg-paper/90 px-4 py-3 backdrop-blur-md md:top-16 md:-mx-6 md:px-6">
            <div className="no-scrollbar flex flex-1 gap-2 overflow-x-auto">
              {FILTERS.map(([key, label]) => (
                <Chip key={key} active={section === key} onClick={() => setSection(key)}>
                  {label}
                  {data && <span className={section === key ? "text-white/70" : "text-muted"}>{data.counts[key]}</span>}
                </Chip>
              ))}
            </div>
            <select aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 shrink-0 rounded-full border border-line-strong bg-surface px-3 text-sm">
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  По дате: {l.toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          {!data ? (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
              ))}
            </div>
          ) : section === "all" ? (
            <div className="mt-4 flex flex-col gap-12">
              {data.groups.map((g) => (
                <section key={g.section}>
                  <h2 className="mb-4 text-lg font-semibold">
                    {SECTION_LABEL[g.section]} <span className="font-normal text-muted">· {g.items.length}</span>
                  </h2>
                  <Grid items={g.items} owner={owner} onDone={() => mutate()} />
                </section>
              ))}
              {owner && data.drafts.length > 0 && (
                <section className="rounded-3xl border-2 border-dashed border-line-strong p-4 md:p-6">
                  <h2 className="mb-4 text-lg font-semibold">
                    Черновики <span className="font-normal text-muted">· {data.drafts.length}</span>
                  </h2>
                  <Grid items={data.drafts} owner onDone={() => mutate()} />
                </section>
              )}
            </div>
          ) : totalShown === 0 ? (
            <EmptyState title={`В разделе «${FILTERS.find(([k]) => k === section)?.[1]}» пока ничего нет`} />
          ) : (
            <div className="mt-4">
              <Grid items={data.groups.flatMap((g) => g.items)} owner={owner} onDone={() => mutate()} />
            </div>
          )}
          {data && section === "all" && !owner && <p className="mt-10 text-center text-sm text-muted">{itemsLabel(data.counts.all)} в гардеробе</p>}
        </>
      )}
    </div>
  );
}

/** Followers / following list (frame 16). */
function PeopleModal({ username, list, onClose }: { username: string; list: "followers" | "following" | null; onClose: () => void }) {
  const { data } = useSWR<{ items: SellerSummary[] }>(list ? `/users/${username}/${list}` : null);
  return (
    <Modal open={!!list} onClose={onClose} title={list === "followers" ? "Подписчики" : "Подписки"}>
      {!data ? (
        <div className="flex justify-center py-6 text-muted">
          <Spinner />
        </div>
      ) : data.items.length === 0 ? (
        <p className="py-4 text-sm text-muted">Пока никого</p>
      ) : (
        <ul className="flex flex-col">
          {data.items.map((u) => (
            <li key={u.id}>
              <Link href={`/u/${u.username}`} onClick={onClose} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 hover:bg-paper">
                <span className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{u.username[0].toUpperCase()}</span>
                  <span>
                    <span className="block font-medium">@{u.username}</span>
                    <span className="text-xs text-muted">
                      {u.activeCount} {plural(u.activeCount, "вещь", "вещи", "вещей")}
                      {u.city ? ` · ${u.city}` : ""}
                    </span>
                  </span>
                </span>
                {u.isFollowing && <span className="text-xs text-muted">вы подписаны</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
