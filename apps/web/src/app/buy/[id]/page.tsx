"use client";

import clsx from "clsx";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { RequireAuth } from "@/components/require-auth";
import { Badge, Button, ButtonLink, EmptyState, ErrorState, Field, IconChevronLeft, Input, Skeleton, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CONDITION_LABEL, DELIVERY_LABEL, formatPrice } from "@/lib/labels";
import type { Deal, DeliveryMethod, ListingDetail, ListingResponse, Me } from "@/lib/types";

const DELIVERY_HINT: Record<DeliveryMethod, string> = {
  IN_PERSON: "Договоритесь о месте и времени после подтверждения",
  PICKUP: "Адрес продавца покажем после подтверждения",
  DELIVERY: "Продавец отправит сам и пришлёт трек-номер. Доставка оплачивается отдельно",
};

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
  const { data, error: loadError, mutate } = useSWR<ListingResponse>(`/listings/${id}`);
  // After an accepted offer the deal already exists (ACCEPTED): the buyer only picks delivery (frame 13).
  const requestId = useSearchParams().get("request");
  const { data: agreed } = useSWR<Deal>(requestId ? `/requests/${requestId}` : null);
  const [method, setMethod] = useState<DeliveryMethod | null>(null);
  const [point, setPoint] = useState("");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; code?: string; requestId?: string } | null>(null);
  const [sent, setSent] = useState<Deal | null>(null);

  if (loadError) return <ErrorState message="Не удалось загрузить вещь" onRetry={() => mutate()} />;
  if (!data || (requestId && !agreed)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="mt-6 h-36 w-full rounded-2xl" />
      </div>
    );
  }
  const confirming = !!agreed && agreed.status === "ACCEPTED" && agreed.role === "buyer";
  if (agreed && !confirming) {
    return (
      <EmptyState title="Способ получения уже выбран">
        <ButtonLink href={`/deals/${agreed.id}`}>Открыть сделку</ButtonLink>
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
  const chosen = method ?? l.deliveryOptions[0] ?? null;
  const cover = l.photos[0];

  if (sent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        <div className="w-32 overflow-hidden rounded-2xl" style={{ aspectRatio: "4 / 5" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover && <img src={cover.urls.m} alt="" className="size-full object-cover" />}
        </div>
        <h1 className="mt-6 text-2xl font-semibold">Запрос отправлен продавцу</h1>
        <Badge tone="warn" className="mt-3">
          Ожидает подтверждения
        </Badge>
        <p className="mt-4 text-ink-2">Мы сообщим, когда @{l.seller.username} ответит. Продавец отвечает в течение 48 часов.</p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <ButtonLink href={`/deals/${sent.id}`} size="lg" block>
            Открыть сделку
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
        router.push(`/deals/${deal.id}`);
        return;
      }
      const deal = await api<Deal>("/requests", { body: { listingId: l.id, ...body } });
      setSent(deal);
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(e.fields);
        setError({ message: e.message, code: e.code, requestId: e.data.requestId as string | undefined });
      } else setError({ message: "Не удалось отправить запрос. Проверьте соединение" });
    } finally {
      setBusy(false);
    }
  };

  const reserved = !confirming && (l.status === "RESERVED" || error?.code === "RESERVED");
  const price = confirming ? agreed.priceTotal : l.price;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-4 md:pb-16 md:pt-8">
      <button onClick={() => router.back()} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <IconChevronLeft className="size-4" /> Назад
      </button>
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{confirming ? (agreed.source === "AUCTION" ? "Вы выиграли аукцион" : "Цена согласована") : "Запрос на покупку"}</h1>
      {confirming && <p className="mt-2 text-ink-2">Вещь зарезервирована за вами. Выберите, как её получить — после этого откроются контакты продавца.</p>}

      <Link href={`/item/${l.id}`} className="mt-6 flex gap-4 rounded-2xl bg-surface p-4">
        <div className="w-24 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover && <img src={cover.urls.s} alt="" className="size-full object-cover" />}
        </div>
        <div className="min-w-0">
          <p className="font-medium">{l.title}</p>
          <p className="mt-1 text-sm text-ink-2">{[l.size && `Размер ${l.size}`, l.condition && CONDITION_LABEL[l.condition]].filter(Boolean).join(" · ")}</p>
          <p className="tabular mt-2 text-xl font-semibold">
            {formatPrice(price)}
            {confirming && price !== l.price && (
              <>
                <span className="ml-2 text-sm font-normal text-ok">согласовано</span>
                <s className="ml-2 text-sm font-normal text-muted">{formatPrice(l.price)}</s>
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-muted">@{l.seller.username}</p>
        </div>
      </Link>

      {reserved ? (
        <div className="mt-8 rounded-2xl bg-warn-soft p-5">
          <p className="font-semibold text-warn">Пока вы оформляли, вещь зарезервировали</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href={`/search?category=${l.category ?? ""}`}>Похожие вещи</ButtonLink>
          </div>
        </div>
      ) : (
        <form
          className="mt-8 flex flex-col gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset>
            <legend className="mb-3 text-lg font-semibold">Способ получения</legend>
            <div className="flex flex-col gap-2">
              {l.deliveryOptions.map((d) => (
                <label key={d} className={clsx("flex cursor-pointer gap-3 rounded-2xl border bg-surface p-4", chosen === d ? "border-ink" : "border-line")}>
                  <input type="radio" name="delivery" className="mt-1 accent-[var(--accent)]" checked={chosen === d} onChange={() => setMethod(d)} />
                  <span>
                    <span className="font-medium">
                      {d === "DELIVERY" ? "Доставка в постамат / курьер" : DELIVERY_LABEL[d]}
                      {d !== "DELIVERY" && l.city && <span className="font-normal text-ink-2"> · {l.city}</span>}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">{DELIVERY_HINT[d]}</span>
                  </span>
                </label>
              ))}
            </div>
            {chosen === "DELIVERY" && (
              <div className="mt-4">
                <Field label="Город и пункт выдачи или адрес" htmlFor="point" required error={fields.deliveryPoint}>
                  <Input id="point" value={point} onChange={(e) => setPoint(e.target.value)} placeholder="Минск, постамат на ул. Притыцкого, 29" error={fields.deliveryPoint} />
                </Field>
              </div>
            )}
          </fieldset>

          <Field label="Телефон для связи" htmlFor="phone" hint="Покажем продавцу только после подтверждения">
            <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375 29 …" />
          </Field>

          <Field label="Комментарий продавцу" htmlFor="comment" error={fields.buyerComment} hint={`${comment.length}/300`}>
            <Textarea id="comment" maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Могу забрать сегодня после 18:00" />
          </Field>

          <div className="rounded-2xl bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-ink-2">К оплате при получении</span>
              <span className="tabular text-2xl font-semibold">{formatPrice(price)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {confirming ? "Выберите способ получения в течение 48 часов, иначе резерв снимется." : "Продавец ответит в течение 48 часов. До подтверждения вещь не резервируется."}
            </p>
          </div>

          {error && !Object.keys(fields).length && (
            <div role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {error.message}
              {error.requestId && (
                <Link href={`/deals/${error.requestId}`} className="ml-2 font-semibold underline">
                  Открыть сделку
                </Link>
              )}
            </div>
          )}

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:border-0 md:bg-transparent md:p-0">
            <Button type="submit" size="lg" block loading={busy} disabled={!chosen}>
              {busy ? "Отправляем…" : confirming ? "Подтвердить способ получения" : "Отправить запрос на покупку"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
