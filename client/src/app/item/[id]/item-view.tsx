"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Gallery } from "@/components/gallery";
import { LikersOfferButton } from "@/components/likers-offer";
import { MEASURE_LABEL } from "@/components/measure-guide";
import { CardRow, FollowButton, SectionHeader } from "@/components/sections";
import { Nefuda } from "@/components/shop/nefuda";
import { useMeta, useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { AuctionPanel, AuctionTimer } from "@/components/auction";
import { AddToCollection } from "@/components/collections";
import { OfferSheet, OfferStatusPanel } from "@/components/offer";
import { ReportModal } from "@/components/report-modal";
import { BundleNote, FitHintBox, ListingStatsCard, RatingInline } from "@/components/trust";
import { Badge, Button, ButtonLink, DealBadge, EmptyState, ErrorState, Field, IconBag, IconCheck, IconHeart, IconMessage, IconShare, Modal, Skeleton, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { useFavorite } from "@/lib/hooks";
import { CONDITION_LABEL, DELIVERY_LABEL, formatPrice, items, plural, timeAgo } from "@/lib/labels";
import { useListingActions } from "@/lib/listing-actions";
import type { Card, ListingDetail, ListingResponse, Offer } from "@/lib/types";

const measurementLabel = (k: string) => (MEASURE_LABEL[k as keyof typeof MEASURE_LABEL] ?? k).toLowerCase();

function ProductSkeleton() {
  return (
    <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-6 md:grid-cols-[58fr_42fr] md:px-6">
      <Skeleton className="aspect-[4/5] rounded-3xl" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="mt-4 h-13 w-full rounded-xl" />
      </div>
    </div>
  );
}

/**
 * Product page (client part). The server page passes the public listing so the HTML is complete for search
 * engines and the first paint; SWR then refetches with the viewer's session (♡, owner tools, fit hint).
 */
export function ItemView({ id, initial }: { id: string; initial?: ListingResponse | null }) {
  // The server copy is anonymous: it paints instantly, while this request (always sent, no fallbackData that
  // SWR might treat as fresh) brings the viewer's own copy — owner tools, ♡, fit hint.
  const live = useSWR<ListingResponse>(`/listings/${id}`);
  const { error, mutate } = live;
  const data = live.data ?? initial ?? undefined;
  const related = useSWR<{ similar: Card[]; fromSeller: Card[]; forYou: Card[] }>(data && !("unavailable" in data) ? `/listings/${id}/related` : null);

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState title="Такой вещи нет" hint="Возможно, её удалили или ссылка неверная">
          <ButtonLink href="/">Смотреть новинки</ButtonLink>
        </EmptyState>
      );
    }
    return <ErrorState message="Не удалось загрузить вещь" onRetry={() => mutate()} />;
  }
  if (!data) return <ProductSkeleton />;

  if ("unavailable" in data) {
    return (
      <EmptyState
        title={data.unavailable === "hidden" ? "Вещь снята с продажи" : "Объявление недоступно"}
        hint={data.unavailable === "hidden" ? "Продавец скрыл её. Посмотрите другие вещи из гардероба" : undefined}
      >
        {data.unavailable === "hidden" && <ButtonLink href={`/u/${data.seller.username}`}>Гардероб @{data.seller.username}</ButtonLink>}
        <ButtonLink href="/" variant="secondary">
          На главную
        </ButtonLink>
      </EmptyState>
    );
  }

  // The server-rendered copy is anonymous; when the viewer's own copy arrives, remount once so local state
  // (♡, cart, auction panel) starts from the personal data.
  return <Product key={live.data ? "live" : "ssr"} listing={data} related={related.data} refresh={() => mutate()} />;
}

function Product({ listing: l, related, refresh }: { listing: ListingDetail; related?: { similar: Card[]; fromSeller: Card[]; forYou: Card[] }; refresh: () => void }) {
  const router = useRouter();
  const meta = useMeta();
  const toast = useToast();
  const { requireAuth } = useSession();
  const [photo, setPhoto] = useState(0);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [seller, setSeller] = useState(l.seller);
  const { isFavorite, toggle } = useFavorite({ id: l.id, title: l.title, isFavorite: l.isFavorite }, "product");
  const actions = useListingActions(refresh);
  const { me, refresh: refreshMe } = useSession();
  const offerKey = me && !l.isOwner ? `/offers/listing/${l.id}` : null;
  const { data: offerData, mutate: mutateOffer } = useSWR<{ offer: Offer | null }>(offerKey);
  const offer = offerData?.offer && offerData.offer.status !== "CANCELLED" ? offerData.offer : null;
  const [offerOpen, setOfferOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [inCart, setInCart] = useState(l.inCart);

  const color = meta?.colors.find((c) => c.value === l.color);
  const measurements = Object.entries(l.measurements ?? {}).filter(([, v]) => v);
  const defectPhoto = l.photos.findIndex((p) => p.isDefect);
  const reserved = l.status === "RESERVED";
  const sold = l.status === "SOLD";
  const activeRequest = l.myRequest && !["COMPLETED"].includes(l.myRequest.status);
  // Local copy so a bid updates the panel instantly.
  const [auction, setAuction] = useState(l.auction);
  const auctionRunning = l.saleType === "AUCTION" && auction?.status === "ACTIVE";
  const showAuction = !!auction && (auctionRunning || auction.status === "SOLD" || (auction.status === "NO_SALE" && auction.bidsCount > 0));
  const canBuy = !l.isOwner && l.status === "PUBLISHED" && !activeRequest && !auctionRunning;

  const buy = () => requireAuth(() => router.push(`/buy/${l.id}`), { reason: `чтобы купить «${l.title}»` });
  const openOffer = () => requireAuth(() => setOfferOpen(true), { reason: `чтобы предложить цену за «${l.title}»` });
  const ask = () =>
    requireAuth(
      async () => {
        try {
          const t = await api<{ id: string }>("/threads", { body: { listingId: l.id } });
          router.push(`/messages/${t.id}`);
        } catch (e) {
          toast(e instanceof ApiError ? e.message : "Не удалось открыть чат", { tone: "error" });
        }
      },
      { reason: "чтобы задать вопрос продавцу" },
    );
  const toggleCart = () =>
    requireAuth(
      async () => {
        const next = !inCart;
        setInCart(next);
        try {
          await api(`/cart/${l.id}`, { method: next ? "POST" : "DELETE" });
          void refreshMe();
          if (next) toast("В корзине", { action: { label: "Перейти", onClick: () => router.push("/cart") } });
        } catch (e) {
          setInCart(!next);
          toast(e instanceof ApiError ? e.message : "Не удалось", { tone: "error" });
        }
      },
      { reason: "чтобы добавить вещь в корзину" },
    );
  const offerOpenNegotiation = offer && (offer.status === "PENDING" || offer.status === "ACCEPTED");
  const canOffer = canBuy && l.acceptsOffers && !offerOpenNegotiation;
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: l.title, url }).catch(() => {});
    else {
      await navigator.clipboard.writeText(url);
      toast("Ссылка скопирована");
    }
  };

  const discount = l.originalPrice && l.price && l.originalPrice > l.price ? Math.round((1 - l.price / l.originalPrice) * 100) : 0;
  const params: Array<[string, React.ReactNode]> = [
    ["Размер", l.size ? (
      <span>
        {l.sizes ? (
          // Same item in several sizes: each size is its own listing.
          <span className="inline-flex flex-wrap gap-1.5 align-middle">
            {l.sizes.map((s) =>
              s.current ? (
                <b key={s.id} className="rounded-lg bg-ink px-2.5 py-0.5 text-accent-ink">{s.size}</b>
              ) : (
                <Link key={s.id} href={`/item/${s.id}`} className={clsx("rounded-lg border px-2.5 py-0.5", s.available ? "border-line-strong hover:border-ink" : "border-line text-muted line-through")}>
                  {s.size}
                </Link>
              ),
            )}
          </span>
        ) : (
          <b>{l.size}</b>
        )}
        {measurements.length > 0 && (
          <button className="ml-2 text-sm text-ink-2 underline underline-offset-4" onClick={() => setShowMeasurements((v) => !v)} aria-expanded={showMeasurements}>
            Замеры
          </button>
        )}
      </span>
    ) : null],
    ["Бренд", l.brand && <Link href={`/search?brand=${encodeURIComponent(l.brand)}`} className="hover:underline">{l.brand}</Link>],
    ["Для кого", meta?.genders.find((g) => g.value === l.gender)?.label],
    ["Состояние", l.condition && CONDITION_LABEL[l.condition]],
    ["Цвет", color?.label],
    ["Материал", l.material],
    ["Категория", l.subcategoryLabel ?? l.categoryLabel],
  ];

  const ownerPanel = l.isOwner && (
    <div className="flex flex-col gap-3">
      {showAuction && auction && <AuctionPanel auction={auction} listingId={l.id} title={l.title} isOwner onChange={(a) => (setAuction(a), a.status === "CANCELLED" && refresh())} />}
      {l.status === "DRAFT" ? (
        <ButtonLink href={`/sell?draft=${l.id}`} size="lg" block>
          Продолжить публикацию
        </ButtonLink>
      ) : (
        <ButtonLink href={`/item/${l.id}/edit`} size="lg" block>
          Редактировать
        </ButtonLink>
      )}
      <div className="grid grid-cols-2 gap-3">
        {l.status === "PUBLISHED" && (
          <Button variant="secondary" onClick={() => actions.hide(l.id)}>
            Снять с продажи
          </Button>
        )}
        {l.status === "HIDDEN" && (
          <Button variant="secondary" onClick={() => actions.unhide(l.id)}>
            Вернуть в продажу
          </Button>
        )}
        {(l.status === "PUBLISHED" || l.status === "HIDDEN") && (
          <Button variant="secondary" onClick={() => actions.markSold(l.id)}>
            Пометить проданным
          </Button>
        )}
      </div>
      {reserved && <p className="text-sm text-muted">Идёт сделка — завершите или отмените её в «Мои продажи».</p>}
      {l.status !== "RESERVED" && (
        <button className="self-start text-sm text-danger hover:underline" onClick={async () => (await actions.remove(l.id)) && router.push("/wardrobe")}>
          Удалить
        </button>
      )}
      {(!!l.owner?.pendingRequests || !!l.owner?.pendingOffers) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-accent-soft px-4 py-3 text-sm">
          {!!l.owner?.pendingRequests && (
            <Link href="/sales" className="font-medium text-accent hover:underline">
              Новые запросы: {l.owner.pendingRequests}
            </Link>
          )}
          {!!l.owner?.pendingOffers && (
            <Link href="/sales" className="font-medium text-accent hover:underline">
              Предложения цены: {l.owner.pendingOffers}
            </Link>
          )}
        </p>
      )}
      {l.status === "PUBLISHED" && l.saleType === "FIXED" && l.price != null && <LikersOfferButton listingId={l.id} price={l.price} />}
      <ButtonLink href={`/sell?similar=${l.id}`} variant="ghost" block>
        Выставить похожую
      </ButtonLink>
      {l.status !== "DRAFT" && <ListingStatsCard listingId={l.id} onBumped={refresh} />}
      {l.status === "BLOCKED" && (
        <div className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
          <p>Заблокировано модератором{l.blockedReason ? `: ${l.blockedReason}` : ""}</p>
          {l.owner?.appealOpen ? (
            <p className="mt-2 font-medium">Обжалование на рассмотрении</p>
          ) : (
            <button className="mt-2 font-semibold underline underline-offset-4" onClick={() => setAppealOpen(true)}>
              Обжаловать
            </button>
          )}
        </div>
      )}
    </div>
  );

  const buyerPanel = !l.isOwner && (
    <div className="flex flex-col gap-3">
      {reserved && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">Зарезервировано — продавец принял запрос другого покупателя. Сохраните: если сделка сорвётся, мы сообщим.</p>}
      {activeRequest && l.myRequest && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            Ваш запрос <DealBadge status={l.myRequest.status} role="buyer" />
          </span>
          <Link href={`/deals/${l.myRequest.id}`} className="font-semibold text-accent hover:underline">
            Открыть сделку
          </Link>
        </div>
      )}
      {l.myRequest?.status === "COMPLETED" && (
        <Link href={`/deals/${l.myRequest.id}`} className="rounded-xl bg-accent-soft px-4 py-3 text-sm font-medium text-accent">
          Вы купили эту вещь · Открыть сделку
        </Link>
      )}
      {showAuction && auction && <AuctionPanel auction={auction} listingId={l.id} title={l.title} isOwner={false} onChange={setAuction} />}
      {auctionRunning ? null : sold ? (
        <div className="grid grid-cols-2 gap-3">
          <ButtonLink href={`/search?category=${l.category ?? ""}`} variant="secondary">
            Смотреть похожие
          </ButtonLink>
          <ButtonLink href={`/u/${l.seller.username}`} variant="secondary">
            Гардероб продавца
          </ButtonLink>
        </div>
      ) : (
        <>
          {offer && (
            <OfferStatusPanel
              offer={offer}
              listingId={l.id}
              onChange={(o) => (void mutateOffer(o ? { offer: o } : { offer: null }, { revalidate: true }), refresh())}
              onNewOffer={openOffer}
            />
          )}
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" onClick={buy} disabled={!canBuy}>
              Купить
            </Button>
            {(canBuy || inCart) && (
              <Button size="lg" variant="secondary" onClick={toggleCart} aria-pressed={inCart} aria-label={inCart ? "Убрать из корзины" : "Добавить в корзину"} title={inCart ? "Убрать из корзины" : "В корзину"}>
                <IconBag className="size-5" />
                {inCart && <IconCheck className="-ml-1 size-4" />}
              </Button>
            )}
          </div>
          {canOffer && (
            <Button size="lg" variant="secondary" block onClick={openOffer}>
              Предложить цену
            </Button>
          )}
        </>
      )}
      <Button variant="secondary" onClick={ask}>
        <IconMessage className="size-5" /> Задать вопрос
      </Button>
      {isFavorite && (
        <button className="self-start text-sm text-ink-2 underline underline-offset-4 hover:text-ink" onClick={() => setCollectionOpen(true)}>
          Добавить в коллекцию
        </button>
      )}
      {!sold && !auctionRunning && <BundleNote tiers={seller.bundleDiscounts ?? []} username={seller.username} />}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-28 pt-4 md:px-6 md:pb-16">
      <nav aria-label="Хлебные крошки" className="mb-4 hidden text-sm text-muted md:block">
        <Link href="/" className="hover:text-ink">Главная</Link>
        {l.categoryLabel && (
          <>
            {" / "}
            <Link href={`/search?category=${l.category}`} className="hover:text-ink">{l.categoryLabel}</Link>
          </>
        )}
        {l.subcategoryLabel && <> / <span className="text-ink-2">{l.subcategoryLabel}</span></>}
      </nav>

      <div className="grid gap-8 md:grid-cols-[58fr_42fr] md:gap-12">
        <Gallery
          photos={l.photos}
          video={l.video}
          title={l.title}
          index={photo}
          onIndex={setPhoto}
          overlay={
            <>
              {(sold || l.status === "HIDDEN" || l.status === "DRAFT" || reserved) && (
                <span className="absolute left-3 top-3">
                  <Badge tone={sold ? "dark" : reserved ? "warn" : "outline"}>{sold ? "Продано" : reserved ? "Зарезервировано" : l.status === "HIDDEN" ? "Скрыто" : "Черновик"}</Badge>
                </span>
              )}
              {!l.isOwner && (
                <button aria-label={isFavorite ? "Убрать из избранного" : "В избранное"} onClick={toggle} className="absolute right-3 top-3 grid size-11 place-items-center on-photo rounded-full md:hidden">
                  <IconHeart className={clsx("size-5", isFavorite && "text-heart")} filled={isFavorite} />
                </button>
              )}
            </>
          }
        />

        <div className="md:sticky md:top-24 md:self-start">
          {/* Share and ♡ hang in the corner without stretching the title row, so the price follows the title closely. */}
          <div className="relative pr-12">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            {auctionRunning && <Badge tone="warn" className="mb-2 block w-fit">Аукцион</Badge>}
            {l.title}
          </h1>
            <div className="absolute -right-2 -top-1.5 flex flex-col">
              <button aria-label="Поделиться" onClick={share} className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-ink/5">
                <IconShare />
              </button>
              {!l.isOwner && (
                <button aria-label={isFavorite ? "Убрать из избранного" : "В избранное"} aria-pressed={isFavorite} onClick={toggle} className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-ink/5">
                  <IconHeart className={clsx("size-5", isFavorite && "text-heart")} filled={isFavorite} />
                </button>
              )}
            </div>
          </div>
          {/* The price on a paper tag tied with a cinnabar thread (値札). */}
          <p className={clsx("mt-4 flex items-center gap-3 pl-5", auctionRunning && "hidden")}>
            <Nefuda className={clsx("tabular text-[28px] font-bold leading-tight", sold && "opacity-60")}>
              <span className={clsx(l.previousPrice && l.price && l.previousPrice > l.price && "text-shu")}>{formatPrice(l.price)}</span>
            </Nefuda>
            {l.previousPrice && l.price && l.previousPrice > l.price && <s className="text-lg text-muted">{formatPrice(l.previousPrice)}</s>}
          </p>
          {discount > 0 && !auctionRunning && (
            <p className="mt-1 text-sm text-ink-2">
              <span className="mr-1.5 rounded-md bg-ok-soft px-1.5 py-0.5 font-semibold text-ok">−{discount}%</span>
              от цены в магазине · {formatPrice(l.originalPrice)}
            </p>
          )}

          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
            {params
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            <dt className="text-muted">Дефекты</dt>
            <dd className="flex items-start gap-2">
              <span className={clsx("mt-[0.45em] size-2 shrink-0 rounded-full", l.defectsPresent ? "bg-amber" : "bg-ok")} aria-hidden />
              {l.defectsPresent ? (
                <span>
                  {l.defectsDescription || "Есть"}
                  {defectPhoto >= 0 && (
                    <button className="ml-2 text-ink-2 underline underline-offset-4" onClick={() => setPhoto(defectPhoto)}>
                      Смотреть на фото
                    </button>
                  )}
                </span>
              ) : (
                "Нет"
              )}
            </dd>
          </dl>
          {showMeasurements && (
            <p className="mt-2 rounded-xl bg-surface px-4 py-3 text-sm text-ink-2">
              {measurements.map(([k, v]) => `${measurementLabel(k)} ${v} см`).join(" · ")}
              <span className="block text-xs text-muted">Замеры в разложенном виде</span>
            </p>
          )}
          {!l.isOwner && !sold && <FitHintBox fit={l.fit} hasProfile={l.fitProfile} signedIn={!!me} hasSize={!!l.size} />}


          <div className="mt-6">{l.isOwner ? ownerPanel : buyerPanel}</div>

          <p className="mt-5 text-sm text-ink-2">
            {[l.city, l.deliveryOptions.map((d) => DELIVERY_LABEL[d]).join(", ")].filter(Boolean).join(" · ")}
          </p>

          {l.description && (
            <div className="mt-6">
              <p className={clsx("whitespace-pre-line text-[15px] leading-relaxed", !expanded && "line-clamp-5")}>{l.description}</p>
              {l.description.length > 280 && (
                <button className="mt-1 text-sm font-medium text-ink-2 underline underline-offset-4" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Свернуть" : "Показать полностью"}
                </button>
              )}
              {l.descriptionByAi && <p className="mt-2 text-xs text-muted">Описание составлено с помощью AI, проверено продавцом</p>}
            </div>
          )}
          {!measurements.length && l.size && <p className="mt-4 text-sm text-muted">Замеры не указаны</p>}

          <p className="mt-6 text-xs text-muted">
            {l.publishedAt ? `Опубликовано ${timeAgo(l.publishedAt)}` : "Не опубликовано"} · {l.viewsCount} просмотров · {l.favoritesCount} сохранений
          </p>
          {!l.isOwner && (
            <button className="mt-3 text-xs text-muted underline underline-offset-4 hover:text-ink" onClick={() => requireAuth(() => setReportOpen(true), { reason: "чтобы отправить жалобу" })}>
              Пожаловаться
            </button>
          )}
        </div>
      </div>

      {/* Seller wardrobe block */}
      <section className="mt-16 grid gap-8 border-t border-line pt-10 md:mt-24 md:grid-cols-[minmax(0,320px)_1fr]">
        <div>
          <Link href={`/u/${seller.username}`} className="text-2xl font-semibold hover:underline">
            {seller.username}
          </Link>
          <p className="mt-1 text-sm text-muted">
            {[seller.city, `${items(seller.activeCount)} · ${seller.soldCount} продано`, `на платформе с ${new Date(seller.createdAt).getFullYear()}`].filter(Boolean).join(" · ")}
          </p>
          <RatingInline rating={seller.rating} username={seller.username} className="mt-3" />
          <p className="mt-1 text-sm text-ink-2">{seller.completedDeals} {plural(seller.completedDeals, "завершённая сделка", "завершённые сделки", "завершённых сделок")}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href={`/u/${seller.username}`} variant="secondary">
              Смотреть гардероб
            </ButtonLink>
            {!l.isOwner && <FollowButton seller={seller} onChange={(v) => setSeller((s) => ({ ...s, isFollowing: v, followers: s.followers + (v ? 1 : -1) }))} />}
          </div>
        </div>
        {related && related.fromSeller.length > 0 && (
          <div className="min-w-0">
            <CardRow items={related.fromSeller.slice(0, 6)} variant="feed" />
          </div>
        )}
      </section>

      {related && related.similar.length > 0 && (
        <section className="mt-16">
          <SectionHeader title="Похожие вещи" href={`/item/${l.id}/similar`} />
          <CardRow items={related.similar} />
        </section>
      )}
      {related && related.forYou.length > 0 && (
        <section className="mt-16">
          <SectionHeader title="Возможно, вам понравится" />
          <CardRow items={related.forYou} />
        </section>
      )}

      {l.price != null && (
        <OfferSheet
          open={offerOpen}
          onClose={() => setOfferOpen(false)}
          listing={{ id: l.id, title: l.title, price: l.price, cover: l.photos[0]?.urls.s }}
          onSent={(o) => void mutateOffer({ offer: o }, { revalidate: false })}
        />
      )}
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} targetType="LISTING" targetId={l.id} title={l.title} />
      <AddToCollection listingId={l.id} open={collectionOpen} onClose={() => setCollectionOpen(false)} />
      {l.isOwner && <AppealModal open={appealOpen} onClose={() => setAppealOpen(false)} listingId={l.id} onDone={refresh} />}

      {/* Mobile sticky buy bar (replaces bottom nav on this page) */}
      {!l.isOwner && auctionRunning && auction && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
          <span className="tabular text-lg font-semibold">{formatPrice(auction.currentBid ?? auction.startPrice)}</span>
          <AuctionTimer endsAt={auction.endsAt} />
          {auction.leaderIsMe ? (
            <span className="ml-auto text-sm font-medium text-ok">Вы лидируете</span>
          ) : (
            <Button className="ml-auto" onClick={() => document.getElementById("bid-amount")?.focus()}>
              Сделать ставку
            </Button>
          )}
        </div>
      )}
      {!l.isOwner && !sold && !auctionRunning && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
          <span className="tabular text-lg font-semibold">{formatPrice(l.price)}</span>
          {canOffer && (
            <Button variant="secondary" className="ml-auto" onClick={openOffer}>
              Предложить
            </Button>
          )}
          <Button className={canOffer ? "min-w-28" : "ml-auto min-w-36"} onClick={buy} disabled={!canBuy}>
            {activeRequest ? "Запрос отправлен" : "Купить"}
          </Button>
        </div>
      )}
    </div>
  );
}

function AppealModal({ open, onClose, listingId, onDone }: { open: boolean; onClose: () => void; listingId: string; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Обжаловать блокировку">
      <Field label="Почему блокировка ошибочна" htmlFor="appeal" error={error ?? undefined} hint="Например: это оригинал, бирка на третьем фото">
        <Textarea id="appeal" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      </Field>
      <Button
        block
        className="mt-5"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/listings/${listingId}/appeal`, { body: { comment } });
            toast("Обжалование отправлено модератору");
            onDone();
            onClose();
          } catch (e) {
            setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : "Не удалось отправить");
          } finally {
            setBusy(false);
          }
        }}
      >
        Отправить
      </Button>
    </Modal>
  );
}
