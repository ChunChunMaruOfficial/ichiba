"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { RequireAuth } from "@/components/require-auth";
import { Furoshiki } from "@/components/shop/furoshiki";
import { Badge, Button, ButtonLink, EmptyState, ErrorState, Field, IconChevronLeft, Input, OptionCard, PriceTag, Skeleton, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { conditionLabel, DELIVERY_WAY, type DeliveryWay, deliveryWays, formatPrice } from "@/lib/labels";
import type { Deal, ListingDetail, ListingResponse, Me } from "@/lib/types";

export default function BuyPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireAuth reason="чтобы купить вещь">
      {(me) => (
        <Suspense>
          <BuyRequest id={id} me={me} />
        </Suspense>
      )}
    </RequireAuth>
  );
}

function BuyRequest({ id, me }: { id: string; me: Me }) {
  const router = useRouter();
  const { data, error: loadError, mutate } = useSWR<ListingResponse>(`/listings/${encodeURIComponent(id)}`);
  // After an accepted offer the deal already exists (ACCEPTED): the buyer only picks delivery (frame 13).
  const params = useSearchParams();
  const requestId = params.get("request");
  /** «Несколько размеров»: the size picked on the item page. */
  const size = params.get("size");
  const { data: agreed, error: agreedError, mutate: mutateAgreed } = useSWR<Deal>(requestId ? `/requests/${encodeURIComponent(requestId)}` : null);
  const [method, setMethod] = useState<DeliveryWay | null>(null);
  const [point, setPoint] = useState("");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; code?: string; requestId?: string } | null>(null);
  const [sent, setSent] = useState<Deal | null>(null);

  if (loadError) return <ErrorState message="Не удалось загрузить вещь" onRetry={() => mutate()} />;
  // Without this the skeleton below stayed forever when the agreed deal couldn't be loaded.
  if (requestId && agreedError) return <ErrorState message="Не удалось загрузить сделку" onRetry={() => mutateAgreed()} />;
  if (!data || (requestId && !agreed)) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="mt-6 h-36 w-full rounded-2xl" />
      </div>
    );
  }
  const confirming = !!agreed && agreed.status === "ACCEPTED" && agreed.role === "buyer";
  if (agreed && !confirming) {
    return (
      <EmptyState title="Способ получения уже выбран">
        <ButtonLink href={`/deals/${agreed.id}`}>Открыть переписку</ButtonLink>
      </EmptyState>
    );
  }
  if ("unavailable" in data || data.isOwner || !["PUBLISHED", "RESERVED"].includes(data.status)) {
    return (
      <EmptyState title={"unavailable" in data || data.status !== "SOLD" ? "Вещь недоступна для покупки" : "Вещь уже продана"}>
        <ButtonLink href="/">Смотреть другие вещи</ButtonLink>
      </EmptyState>
    );
  }
  const l: ListingDetail = data;
  // Bought on the item page, not with this form: a negotiable price (offer or chat), an auction (a bid), or a size
  // still to pick. The server refuses such a request anyway; this sends the buyer where they can go on.
  const pickOnItemPage = !confirming && (l.priceNegotiable || l.saleType === "AUCTION" || ((l.stockSizes?.length ?? 0) > 1 && !(size && l.stockSizes?.includes(size))));
  if (pickOnItemPage) {
    return (
      <EmptyState
        title={l.priceNegotiable ? "Цена договорная" : l.saleType === "AUCTION" ? "Это аукцион" : "Выберите размер"}
        hint={l.priceNegotiable ? "Предложите свою цену или напишите продавцу на странице вещи" : l.saleType === "AUCTION" ? "Сделайте ставку на странице вещи" : "Размер выбирается на странице вещи"}
      >
        <ButtonLink href={`/item/${l.id}`}>Открыть вещь</ButtonLink>
      </EmptyState>
    );
  }
  const ways = deliveryWays(l.deliveryOptions);
  const chosen = method ?? ways[0] ?? null;
  const cover = l.photos[0];

  if (sent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        <div className="relative">
          <div className="rise w-40 overflow-hidden rounded-3xl shadow-[var(--shadow-float)]" style={{ aspectRatio: "4 / 5" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {cover && <img src={cover.urls.m} alt="" className="size-full object-contain" />}
          </div>
          {/* the purchase, wrapped in cloth for the way home */}
          <Furoshiki className="rise sway absolute -bottom-6 -right-14 h-24" />
        </div>
        <h1 className="rise mt-10 text-2xl font-bold">Запрос отправлен продавцу</h1>
        <Badge tone="warn" className="mt-3">
          Ожидает ответа
        </Badge>
        <p className="mt-4 text-ink-2">
          Мы сообщим, когда @{l.seller.username} ответит. Продавец отвечает в течение 48 часов
          {sent.buyerComment ? " — ваш комментарий уже в переписке." : "."}
        </p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <ButtonLink href={sent.threadId ? `/messages/${sent.threadId}` : `/deals/${sent.id}`} size="lg" block>
            Открыть переписку
          </ButtonLink>
          <ButtonLink href="/" variant="secondary" block>
            Продолжить смотреть
          </ButtonLink>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!chosen) return;
    setBusy(true);
    setFields({});
    setError(null);
    try {
      const body = { deliveryMethod: chosen, deliveryPoint: chosen === "DELIVERY" ? point : null, contactPhone: phone || null, buyerComment: comment || null };
      if (confirming) {
        const deal = await api<Deal>(`/requests/${agreed.id}/confirm-delivery`, { body });
        router.push(deal.threadId ? `/messages/${deal.threadId}` : `/deals/${deal.id}`);
        return;
      }
      // The price on screen goes along: if the seller changed it meanwhile the API answers PRICE_CHANGED instead of
      // quietly charging the new one, and the page reloads the item to show it.
      const deal = await api<Deal>("/requests", { body: { listingId: l.id, ...(size ? { size } : {}), ...(l.price != null ? { expectedTotal: l.price } : {}), ...body } });
      setSent(deal);
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(e.fields);
        setError({ message: e.message, code: e.code, requestId: e.data.requestId as string | undefined });
        if (e.code === "PRICE_CHANGED") void mutate();
      } else setError({ message: "Не удалось отправить запрос. Проверьте соединение" });
    } finally {
      setBusy(false);
    }
  };

  const reserved = !confirming && (l.status === "RESERVED" || error?.code === "RESERVED");
  const price = confirming ? agreed.priceTotal : l.price;

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-32 pt-4 md:px-6 md:pb-16 md:pt-8">
      <button onClick={() => router.back()} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <IconChevronLeft className="size-4" /> Назад
      </button>
      <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">{confirming ? (agreed.source === "AUCTION" ? "Вы выиграли аукцион" : "Цена согласована") : "Запрос на покупку"}</h1>
      {confirming && <p className="rise mt-2 text-ink-2">Вещь зарезервирована за вами. Выберите, как её получить — после этого откроются контакты продавца.</p>}

      <form
        className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reserved) void submit();
        }}
      >
        {reserved ? (
          <div className="rise rounded-[28px] bg-warn-soft p-6">
            <p className="font-semibold text-warn">Пока вы оформляли, вещь зарезервировали</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <ButtonLink href={`/item/${l.id}/similar`}>Похожие вещи</ButtonLink>
            </div>
          </div>
        ) : (
          <div className="rise flex flex-col gap-8">
            <fieldset>
              <legend className="mb-3 text-lg font-semibold">Способ получения</legend>
              {ways.length === 1 ? (
                // One way only: shown as a fact, not a choice.
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <OptionCard fixed seal={DELIVERY_WAY[ways[0]].seal} title={DELIVERY_WAY[ways[0]].only} hint={DELIVERY_WAY[ways[0]].hint} aside={ways[0] === "IN_PERSON" ? l.city : null} />
                </div>
              ) : (
                <div role="radiogroup" aria-label="Способ получения" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ways.map((d) => (
                    <OptionCard key={d} name="delivery" checked={chosen === d} onChange={() => setMethod(d)} seal={DELIVERY_WAY[d].seal} title={DELIVERY_WAY[d].title} hint={DELIVERY_WAY[d].hint} aside={d === "IN_PERSON" ? l.city : null} />
                  ))}
                </div>
              )}
              {chosen === "DELIVERY" && (
                <div className="rise mt-4">
                  <Field label="Город и адрес доставки" htmlFor="point" required error={fields.deliveryPoint}>
                    <Input id="point" value={point} onChange={(e) => setPoint(e.target.value)} placeholder="Минск, ул. Притыцкого, 29, кв. 12" error={fields.deliveryPoint} />
                  </Field>
                </div>
              )}
            </fieldset>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <Field label="Телефон для связи" htmlFor="phone" hint="Покажем продавцу только после подтверждения">
                <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375 29 …" />
              </Field>
              <Field label="Комментарий продавцу" htmlFor="comment" error={fields.buyerComment} hint={`Придёт продавцу первым сообщением в чате · ${comment.length}/300`}>
                <Textarea id="comment" maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Могу забрать сегодня после 18:00" className="min-h-11" />
              </Field>
            </div>
          </div>
        )}

        <aside className="rise flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start" style={{ animationDelay: "100ms" }}>
          <Link href={`/item/${l.id}`} className="flex gap-4 rounded-[28px] bg-surface p-4 shadow-[var(--shadow-paper)]">
            <div className="w-24 shrink-0 overflow-hidden rounded-2xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {cover && <img src={cover.urls.s} alt="" className="size-full object-contain" />}
            </div>
            <div className="min-w-0">
              <p className="font-medium">{l.title}</p>
              <p className="mt-1 text-sm text-ink-2">{[(size ?? l.size) && `Размер ${size ?? l.size}`, l.condition && conditionLabel(l.condition, l.hasTags)].filter(Boolean).join(" · ")}</p>
              <p className="mt-1 text-sm text-muted">@{l.seller.username}</p>
            </div>
          </Link>
          {!reserved && (
            <div className="flex flex-col gap-4 rounded-[28px] bg-surface p-5 shadow-[var(--shadow-paper)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-ink-2">
                  К оплате
                  <span className="block text-sm text-muted">при получении</span>
                </span>
                <PriceTag>{formatPrice(price)}</PriceTag>
              </div>
              {confirming && price !== l.price && (
                <p className="-mt-2 text-right text-sm">
                  <span className="text-ok">согласовано</span> <s className="ml-1 text-muted">{formatPrice(l.price)}</s>
                </p>
              )}
              {error && !Object.keys(fields).length && (
                <div role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                  {error.message}
                  {error.requestId && (
                    <Link href={`/deals/${error.requestId}`} className="ml-2 font-semibold underline">
                      Открыть переписку
                    </Link>
                  )}
                </div>
              )}
              <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:static lg:border-0 lg:bg-transparent lg:p-0">
                <Button type="submit" size="lg" block loading={busy} disabled={!chosen}>
                  {busy ? "Отправляем…" : confirming ? "Подтвердить способ получения" : "Отправить запрос"}
                </Button>
              </div>
              <p className="text-xs text-muted">{confirming ? "Выберите способ получения в течение 48 часов, иначе резерв снимется." : "Продавец ответит в течение 48 часов."}</p>
            </div>
          )}
        </aside>
      </form>
    </div>
  );
}
