"use client";


import { DragRow } from "./drag-row";
import { Noren } from "@/components/shop/noren";
import { Daruma } from "@/components/shop/daruma";
import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { plural } from "@/lib/labels";
import { useListingActions } from "@/lib/listing-actions";
import { usePresence } from "@/lib/presence";
import type { Card, Deal, Offer, SellerSummary } from "@/lib/types";
import { DealCard } from "./deal-actions";
import { LookEditor, LookHighlights } from "./looks";
import { ReportModal } from "./report-modal";
import { ReviewsSection } from "./reviews";
import { BundleNote, RatingInline } from "./trust";
import { OfferCard } from "./offer";
import { Avatar } from "./avatar";
import { Masonry, MasonrySkeleton } from "./masonry";
import { FollowButton } from "./sections";
import { useSession } from "./session";
import { useToast } from "./toast";
import { ButtonLink, Chip, EmptyState, ErrorState, IconMore, IconPlus, IconSettings, IconShare, Modal, Skeleton, Spinner } from "./ui";
import { Select } from "./select";

export interface WardrobeData {
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

/** Owner actions on a card: a dropdown on desktop, a bottom sheet on phones (where a dropdown would leave the screen). */
function OwnerMenu({ card, onDone }: { card: Card; onDone: () => void }) {
  const [open, setOpen] = useState<"menu" | "sheet" | null>(null);
  const pop = usePresence(open === "menu");
  const router = useRouter();
  const actions = useListingActions(onDone);
  const reserved = card.status === "RESERVED";
  const sheet = open === "sheet";
  const item = (label: string, onClick: () => void, opts: { danger?: boolean; disabled?: boolean } = {}) => (
    <button
      disabled={opts.disabled}
      title={opts.disabled ? "Идёт сделка — завершите или отмените её в «Мои продажи»" : undefined}
      onClick={() => {
        setOpen(null);
        onClick();
      }}
      className={clsx(
        "block w-full rounded-lg text-left hover:bg-paper disabled:cursor-not-allowed disabled:text-muted",
        sheet ? "px-2 py-3 text-[15px]" : "px-3 py-2 text-sm",
        opts.danger && "text-danger",
      )}
    >
      {label}
    </button>
  );
  const items = (
    <>
      {item(card.status === "DRAFT" ? "Продолжить" : "Редактировать", () => router.push(card.status === "DRAFT" ? `/sell?draft=${card.id}` : `/item/${card.id}/edit`))}
      {card.status === "PUBLISHED" && item("Снять с продажи", () => actions.hide(card.id))}
      {card.status === "HIDDEN" && item("Вернуть в продажу", () => actions.unhide(card.id))}
      {(card.status === "PUBLISHED" || card.status === "HIDDEN" || reserved) && item("Пометить как проданное", () => actions.markSold(card.id), { disabled: reserved })}
      {card.status !== "SOLD" && item("Удалить", () => actions.remove(card.id), { danger: true, disabled: reserved })}
    </>
  );
  return (
    <div className="relative">
      <button
        aria-label="Действия с вещью"
        aria-expanded={!!open}
        onClick={() => setOpen((v) => (v ? null : window.matchMedia("(min-width: 768px)").matches ? "menu" : "sheet"))}
        className="grid size-9 place-items-center on-photo rounded-full text-ink"
      >
        <IconMore />
      </button>
      {pop.mounted && (
        <>
          {open === "menu" && <div className="fixed inset-0 z-10" onClick={() => setOpen(null)} />}
          <div data-closing={pop.closing || undefined} className="fade-in absolute right-0 top-11 z-20 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
            {items}
          </div>
        </>
      )}
      <Modal open={sheet} onClose={() => setOpen(null)} title={card.title || (card.status === "DRAFT" ? "Черновик" : "Вещь")}>
        <div className="-mx-2 flex flex-col">{items}</div>
      </Modal>
    </div>
  );
}

/** Items laid like bricks, as in the home feed; the owner gets a menu on each card. */
function Grid({ items, owner, onDone }: { items: Card[]; owner: boolean; onDone: () => void }) {
  return <Masonry items={items} variant="feed" source="wardrobe" overlay={owner ? (c) => <OwnerMenu card={c} onDone={onDone} /> : undefined} />;
}

function ActionRequired({ onChange }: { onChange: () => void }) {
  const { data, mutate } = useSWR<{ items: Deal[]; summary: { newRequests: number; waitingHandover: number; offers: number } }>("/sales?tab=action");
  const offers = useSWR<{ items: Offer[] }>("/offers?role=seller&turn=mine");
  const total = (data?.items.length ?? 0) + (offers.data?.items.length ?? 0);
  if (!data || total === 0) return null;
  const { newRequests, waitingHandover } = data.summary;
  const offerCount = offers.data?.items.length ?? 0;
  const cards = [
    ...(offers.data?.items ?? []).map((o) => ({ key: o.id, node: <OfferCard plain offer={o} onChange={() => (void offers.mutate(), onChange())} /> })),
    ...data.items.map((d) => ({ key: d.id, node: <DealCard plain deal={d} onChange={() => (void mutate(), onChange())} /> })),
  ];
  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between gap-4">
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
      <ul className="mt-1 divide-y divide-line border-b border-line">
        {cards.slice(0, 3).map((c) => (
          <li key={c.key}>{c.node}</li>
        ))}
      </ul>
      <Link href="/sales" className="mt-3 inline-block text-sm font-medium text-ink-2 hover:text-ink">
        Все продажи
      </Link>
    </section>
  );
}

/** Seller Wardrobe and My Wardrobe share one template (frame 09); MVP is a 2D grid grouped by section. */
export function WardrobeView({ username, initial }: { username: string; initial?: WardrobeData | null }) {
  const params = useSearchParams();
  const section = (FILTERS.find(([k]) => k === params.get("section"))?.[0] ?? "all") as (typeof FILTERS)[number][0];
  const sort = SORTS.find(([k]) => k === params.get("sort"))?.[0] ?? "new";
  const tab = params.get("tab") === "reviews" ? "reviews" : "items";
  const { me, requireAuth } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [people, setPeople] = useState<"followers" | "following" | null>(null);
  const [creatingLook, setCreatingLook] = useState(false);
  const { mutate: globalMutate } = useSWRConfig();
  const setQuery = (next: { section?: string; sort?: string; tab?: string }) => {
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
  // Server-rendered first page (default section and sort) makes the wardrobe indexable and paints instantly.
  // The server copy is anonymous (no owner tools), so the session request is always sent and replaces it.
  const live = useSWR<WardrobeData>(`/wardrobes/${username}?section=${section}&sort=${sort}`);
  const { error, mutate } = live;
  const data = live.data ?? (section === "all" && sort === "new" ? (initial ?? undefined) : undefined);

  if (error) {
    if ((error as { status?: number }).status === 404) {
      return (
        <EmptyState title="Такого гардероба нет">
          <ButtonLink href="/">На главную</ButtonLink>
        </EmptyState>
      );
    }
    // Your own wardrobe never greets you with an error screen: the main action stays one tap away.
    if (me?.username === username) {
      return (
        <EmptyState art={<Noren className="mb-2 w-64" />} title="Мой гардероб" hint="Выставьте первую вещь — это займёт около минуты">
          <ButtonLink href="/sell">
            <IconPlus className="size-4" /> Добавить вещь
          </ButtonLink>
          <button type="button" onClick={() => mutate()} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
            Не загрузились вещи — обновить
          </button>
        </EmptyState>
      );
    }
    return <ErrorState message="Не удалось открыть гардероб" onRetry={() => mutate()} />;
  }

  const s = data?.seller;
  const owner = !!data?.isOwner;
  const onFollow = (v: boolean) => mutate((d) => d && { ...d, seller: { ...d.seller, isFollowing: v, followers: d.seller.followers + (v ? 1 : -1) } }, { revalidate: false });
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
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      {/* Header */}
      {!s ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-80" />
        </div>
      ) : (
        // The seller's cover: aizome cloth, the nickname large, a brush label 箪笥 («wardrobe») at the side.
        <header className="aizome aizome-fade-r relative flex flex-col gap-6 rounded-[28px] px-5 py-6 md:flex-row md:items-center md:justify-between md:px-10 md:py-12">
          <div className="absolute right-3 top-3 flex items-center gap-2 md:right-5 md:top-5">
            {/* Desktop: beside «Поделиться»; phones get it full width at the bottom of the cover. */}
            {!owner && me?.username !== s.username && (
              <span className="hidden md:inline-flex">
                <FollowButton seller={s} onChange={onFollow} />
              </span>
            )}
            {owner && (
              <Link href="/settings" aria-label="Настройки" title="Настройки" className="grid size-10 place-items-center rounded-full text-ink-2 transition-[color,background-color,transform] duration-300 hover:rotate-45 hover:bg-ink/10 hover:text-ink">
                <IconSettings className="size-5" />
              </Link>
            )}
            <button onClick={share} aria-label="Поделиться гардеробом" title="Поделиться" className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-ink/10 hover:text-ink">
              <IconShare className="size-5" />
            </button>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-4 pr-10 md:pr-0">
              {s.avatar ? (
                <Avatar username={s.username} avatar={s.avatar} ring className="size-16 md:size-20" />
              ) : (
                // No photo: a personal seal, the nickname's first letter pressed in cinnabar.
                <span aria-hidden className="grid size-14 shrink-0 -rotate-3 place-items-center rounded-xl border-2 border-[#f4efe6]/30 bg-shu text-3xl font-bold uppercase text-[#f4efe6] shadow-[0_6px_16px_-6px_rgb(0_0_0/0.5)] md:size-16 md:text-4xl">
                  {s.username.slice(0, 1)}
                </span>
              )}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-3">
                  <h1 className="truncate text-4xl font-bold leading-[1.05] md:text-6xl">{s.username}</h1>
                </div>
                <p className="mt-1 text-sm text-ink-2" title={`На ichiba с ${sinceLabel(s.createdAt)}`}>
                  {s.city ? `${s.city} · ` : ""}на ichiba с {sinceLabel(s.createdAt)}
                </p>
              </div>
            </div>
            {/* The counts as three columns: easy to read at a glance, on a phone too. */}
            <dl className="mt-6 grid max-w-md grid-cols-3 divide-x divide-[#f4efe6]/15 rounded-2xl bg-[#f4efe6]/[0.07] py-3 text-center ring-1 ring-[#f4efe6]/10">
              <div>
                <dt className="sr-only">Вещей в продаже</dt>
                <dd className="tabular text-2xl font-bold leading-none">{s.activeCount}</dd>
                <dd className="mt-1 text-xs text-ink-2">{plural(s.activeCount, "вещь", "вещи", "вещей")}</dd>
              </div>
              <div>
                <dt className="sr-only">Продано</dt>
                <dd className="tabular text-2xl font-bold leading-none">{s.soldCount}</dd>
                <dd className="mt-1 text-xs text-ink-2">продано</dd>
              </div>
              <div>
                <dt className="sr-only">Подписчики</dt>
                <dd>
                  <button className="group/f w-full" onClick={() => setPeople("followers")}>
                    <span className="tabular block text-2xl font-bold leading-none">{s.followers}</span>
                    <span className="mt-1 block text-xs text-ink-2 group-hover/f:text-ink group-hover/f:underline">{plural(s.followers, "подписчик", "подписчика", "подписчиков")}</span>
                  </button>
                </dd>
              </div>
            </dl>
            <RatingInline rating={s.rating} username={s.username} className="mt-3" />
            {s.bio && <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-ink">{s.bio}</p>}
          </div>
          <div className="flex flex-wrap gap-2 empty:hidden max-md:[&>*]:flex-1">
            {!owner && me?.username !== s.username && (
              <span className="md:hidden">
                <FollowButton seller={s} onChange={onFollow} block />
              </span>
            )}
            {owner ? (
              <>
                {!empty && (
                  <ButtonLink href="/sell" variant="shu">
                    <IconPlus className="size-4" /> Добавить вещь
                  </ButtonLink>
                )}
              </>
            ) : null}
          </div>
        </header>
      )}
      {s && (
        <div className="mt-6">
          <LookHighlights username={s.username} owner={owner} onCreate={() => setCreatingLook(true)} />
        </div>
      )}
      {owner && creatingLook && s && <LookEditor username={s.username} open onClose={() => setCreatingLook(false)} onSaved={() => void globalMutate(`/users/${s.username}/looks`)} />}
      {s && <ReportModal open={reporting} onClose={() => setReporting(false)} targetType="USER" targetId={s.username} title={`@${s.username}`} />}
      {s && <PeopleModal username={s.username} list={people} onClose={() => setPeople(null)} />}

      {s && !owner && s.bundleDiscounts.length > 0 && <BundleNote tiers={s.bundleDiscounts} username={s.username} className="mt-6 max-w-2xl" />}

      <div className="mt-8">{owner && <ActionRequired onChange={() => mutate()} />}</div>

      {tab === "reviews" ? (
        <div className="mt-8">
          <button onClick={() => setQuery({ tab: undefined })} className="mb-4 text-sm text-ink-2 hover:text-ink">
            ← Вещи
          </button>
          <ReviewsSection username={username} />
        </div>
      ) : empty ? (
        owner ? (
          <EmptyState art={<Daruma eyes={1} className="mb-2 h-40" />} title="Гардероб пока пуст" hint="Выложите первую вещь — у Дарумы уже нарисован один глаз, второй — в день первой продажи">
            <ButtonLink href="/sell">+ Добавить первую вещь</ButtonLink>
          </EmptyState>
        ) : (
          <EmptyState title={`У @${username} пока нет вещей`} hint="Подпишитесь, чтобы узнать о первой вещи" />
        )
      ) : (
        <>
          <div className="under-header under-header-still z-20 -mx-4 flex items-center gap-2 px-4 py-3 md:-mx-6 md:px-6">
            <DragRow viewportClassName="-my-1.5 min-w-0 flex-1" className="gap-2 py-1.5">
              {FILTERS.filter(([key]) => key === "all" || key === section || !data || data.counts[key] > 0).map(([key, label]) => (
                <Chip key={key} active={section === key} onClick={() => setSection(key)}>
                  {label}
                </Chip>
              ))}
            </DragRow>
            <Select variant="pill" aria-label="Сортировка" value={sort} onChange={setSort} options={SORTS.map(([v, l]) => ({ value: v, label: l }))} />
          </div>

          {!data ? (
            <div className="mt-4">
              <MasonrySkeleton count={10} />
            </div>
          ) : section === "all" ? (
            <div className="mt-4 flex flex-col gap-14">
              <Grid items={data.groups.flatMap((g) => g.items)} owner={owner} onDone={() => mutate()} />
              {owner && data.drafts.length > 0 && (
                <section>
                  <h2 className="mb-4 text-xl font-bold">
                    Черновики <span className="font-sans text-base font-normal text-muted">{data.drafts.length}</span>
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
          {s && !owner && me?.username !== s.username && (
            <p className="mt-14 text-center">
              <button className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => requireAuth(() => setReporting(true))}>
                Пожаловаться на гардероб
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Followers / following list (frame 16). */
function PeopleModal({ username, list, onClose }: { username: string; list: "followers" | "following" | null; onClose: () => void }) {
  // The last opened list stays on screen while the modal animates out.
  const [shown, setShown] = useState(list);
  if (list && list !== shown) setShown(list);
  const { data } = useSWR<{ items: SellerSummary[] }>(shown ? `/users/${username}/${shown}` : null);
  return (
    <Modal open={!!list} onClose={onClose} title={shown === "followers" ? "Подписчики" : "Подписки"}>
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
