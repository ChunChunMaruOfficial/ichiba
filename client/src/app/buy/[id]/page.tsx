"use client";

import Link from "next/link";
import { Breadcrumbs, itemCrumbs } from "@/components/breadcrumbs";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { RequireAuth } from "@/components/require-auth";
import { Furoshiki } from "@/components/shop/furoshiki";
import { Badge, Button, ButtonLink, EmptyState, ErrorState, Field, Input, OptionCard, PriceTag, Skeleton, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { canSewTo, conditionLabel, DELIVERY_WAY, type DeliveryWay, deliveryWays, formatPrice, plural, PRICE_ON_REQUEST, tailorLines } from "@/lib/labels";
import type { Deal, ListingDetail, ListingResponse, Me } from "@/lib/types";
import { track } from "@/lib/analytics";

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
  /** «Сшить по моим меркам» chosen on the item page (the buyer can still switch here). */
  const [sewChoice, setSewChoice] = useState(params.get("sewn") === "1");
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
  // Made to measure: only a brand's model that offers it, and not on a deal already agreed for the ready piece.
  const sewable = !!l.madeToMeasure && !confirming;
  const sewn = sewable && sewChoice;
  const measured = canSewTo(me.bodyMeasurements);
  // Bought on the item page, not with this form: a negotiable price (offer or chat), an auction (a bid), or a size
  // still to pick. The server refuses such a request anyway; this sends the buyer where they can go on.
  const pickOnItemPage = !confirming && (l.priceNegotiable || l.saleType === "AUCTION" || (!sewn && (l.stockSizes?.length ?? 0) > 1 && !(size && l.stockSizes?.includes(size))));
  if (pickOnItemPage) {
    return (
      <EmptyState
        title={l.priceNegotiable ? PRICE_ON_REQUEST : l.saleType === "AUCTION" ? "Это аукцион" : "Выберите размер"}
        hint={l.priceNegotiable ? "Узнайте цену у продавца или предложите свою на странице вещи" : l.saleType === "AUCTION" ? "Сделайте ставку на странице вещи" : "Размер выбирается на странице вещи"}
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
        <h1 className="rise mt-10 text-2xl font-bold">{sewn ? "Заказ на пошив отправлен" : "Запрос отправлен продавцу"}</h1>
        <Badge tone="warn" className="mt-3">
          Ожидает ответа
        </Badge>
        <p className="mt-4 text-ink-2">
          {sewn ? "Ваши мерки уже у бренда. " : ""}Мы сообщим, когда @{l.seller.username} ответит. Продавец отвечает в течение 48 часов
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
      const deal = await api<Deal>("/requests", { body: { listingId: l.id, ...(sewn ? { madeToMeasure: true } : size ? { size } : {}), ...(l.price != null ? { expectedTotal: l.price } : {}), ...body } });
      setSent(deal);
      track("buy_request", { price: l.price ?? 0 });
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

  // A reserved ready piece doesn't stop a made-to-measure order: the brand sews a new one.
  const reserved = !confirming && !sewn && (l.status === "RESERVED" || error?.code === "RESERVED");
  const price = confirming ? agreed.priceTotal : l.price;

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-32 pt-4 md:px-6 md:pb-16 md:pt-8">
      <Breadcrumbs className="mb-4" items={[...itemCrumbs(l, undefined, l.market === "resale" ? "resale" : "brands"), { label: confirming ? "Получение" : "Покупка" }]} />
      <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">{confirming ? (agreed.source === "AUCTION" ? "Вы выиграли аукцион" : "Цена согласована") : sewn ? "Пошив по меркам" : "Запрос на покупку"}</h1>
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
            {sewable && (
              <fieldset>
                <legend className="mb-3 text-lg font-semibold">Что заказываете</legend>
                <div role="radiogroup" aria-label="Что заказываете" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <OptionCard name="sew" checked={!sewn} onChange={() => setSewChoice(false)} seal="品" title="Готовую вещь" hint={(size ?? l.size) ? `Размер ${size ?? l.size}` : "Как на фото"} />
                  <OptionCard
                    name="sew"
                    checked={sewn}
                    onChange={() => setSewChoice(true)}
                    seal="仕"
                    title="Сшить по моим меркам"
                    hint={l.madeToMeasure?.days ? `Бренд шьёт за ${l.madeToMeasure.days} ${plural(l.madeToMeasure.days, "день", "дня", "дней")}` : "Срок бренд назовёт в чате"}
                  />
                </div>
                {sewn && (
                  <div className="rise mt-4 rounded-2xl bg-surface p-4 md:p-5">
                    {measured ? (
                      <>
                        <p className="font-medium">Эти мерки уйдут бренду вместе с заказом</p>
                        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
                          {tailorLines(me.bodyMeasurements).map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-ink-2">{label}</dt>
                              <dd className="font-semibold">{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <Link href="/settings#sizes" className="mt-3 inline-block text-sm text-ink-2 underline underline-offset-4 hover:text-ink">
                          Изменить мерки
                        </Link>
                      </>
                    ) : (
                      <>
                        <p className="font-medium">В профиле пока нет мерок</p>
                        <p className="mt-1 text-sm text-ink-2">Укажите хотя бы обхват груди, талии или бёдер — бренд сошьёт по ним.</p>
                        <ButtonLink href="/settings#sizes" variant="secondary" className="mt-3">
                          Указать мерки
                        </ButtonLink>
                      </>
                    )}
                  </div>
                )}
              </fieldset>
            )}
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
              <p className="mt-1 text-sm text-ink-2">{sewn ? "Пошив по вашим меркам" : [(size ?? l.size) && `Размер ${size ?? l.size}`, l.condition && conditionLabel(l.condition, l.hasTags)].filter(Boolean).join(" · ")}</p>
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
                  {error.code === "NO_MEASUREMENTS" && (
                    <Link href="/settings#sizes" className="ml-2 font-semibold underline">
                      Указать мерки
                    </Link>
                  )}
                </div>
              )}
              <div data-chrome="action-bar" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:static lg:border-0 lg:bg-transparent lg:p-0">
                <Button type="submit" size="lg" block loading={busy} disabled={!chosen || (sewn && !measured)}>
                  {busy ? "Отправляем…" : confirming ? "Подтвердить способ получения" : sewn ? "Заказать пошив" : "Отправить запрос"}
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
