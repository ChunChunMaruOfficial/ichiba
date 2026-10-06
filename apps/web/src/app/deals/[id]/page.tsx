"use client";

import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { DealActions } from "@/components/deal-actions";
import { RequireAuth } from "@/components/require-auth";
import { DealReview } from "@/components/reviews";
import { useToast } from "@/components/toast";
import { Button, ButtonLink, DealBadge, EmptyState, ErrorState, Field, IconCheck, Modal, Skeleton, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { DELIVERY_LABEL, formatDateTime, formatPrice } from "@/lib/labels";
import type { Deal, RequestStatus } from "@/lib/types";

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth reason="чтобы открыть сделку">{() => <DealView id={id} />}</RequireAuth>;
}

/** Tracker steps: delivery branch vs in-person/pickup branch (frame 14 BUYER ORDER PAGE). */
function steps(deal: Deal): Array<{ status: RequestStatus[]; label: string }> {
  const head = [
    { status: ["PENDING_SELLER", "CREATED"] as RequestStatus[], label: deal.source === "OFFER" ? "Предложение цены" : deal.source === "AUCTION" ? "Аукцион" : "Запрос отправлен" },
    { status: ["ACCEPTED"] as RequestStatus[], label: deal.source === "OFFER" ? "Цена согласована" : deal.source === "AUCTION" ? "Победа в аукционе" : "Продавец подтвердил" },
  ];
  const tail =
    deal.deliveryMethod === "DELIVERY"
      ? [
          { status: ["WAITING_HANDOVER"] as RequestStatus[], label: "Передача в доставку" },
          { status: ["IN_TRANSIT"] as RequestStatus[], label: deal.trackingNumber ? `В пути · трек ${deal.trackingNumber}` : "В пути" },
        ]
      : [
          { status: ["WAITING_HANDOVER"] as RequestStatus[], label: "Ожидает передачи" },
          { status: ["HANDED_OVER"] as RequestStatus[], label: "Передано" },
        ];
  return [...head, ...tail, { status: ["RECEIVED"], label: "Получено" }, { status: ["COMPLETED"], label: "Завершено" }];
}

function Tracker({ deal }: { deal: Deal }) {
  const events = deal.events ?? [];
  const all = steps(deal);
  const failed = ["DECLINED", "CANCELLED", "DISPUTED"].includes(deal.status);
  const reachedIdx = all.reduce((max, s, i) => (events.some((e) => s.status.includes(e.status)) ? i : max), -1);
  const currentIdx = failed ? reachedIdx + 1 : all.findIndex((s) => s.status.includes(deal.status));

  return (
    <ol className="flex flex-col">
      {all.map((s, i) => {
        const ev = [...events].reverse().find((e) => s.status.includes(e.status));
        const done = i <= reachedIdx && !(i === currentIdx && !failed && deal.status !== "COMPLETED");
        const current = i === currentIdx;
        const isFailure = failed && current;
        return (
          <li key={s.label} className="relative flex gap-4 pb-6 last:pb-0">
            {i < all.length - 1 && <span className={clsx("absolute left-[11px] top-6 h-[calc(100%-24px)] w-0.5", done ? "bg-accent" : "bg-line")} aria-hidden />}
            <span
              className={clsx(
                "z-10 grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs",
                isFailure ? "border-danger bg-danger text-white" : done ? "border-accent bg-accent text-white" : current ? "border-accent bg-surface" : "border-line-strong bg-surface",
              )}
              aria-hidden
            >
              {isFailure ? "✕" : done ? <IconCheck className="size-3.5" /> : current ? <span className="size-2 rounded-full bg-accent" /> : null}
            </span>
            <div className={clsx("-mt-0.5", !done && !current && "text-muted")}>
              <p className={clsx(current && "font-semibold")}>
                {isFailure ? { DECLINED: "Продавец отклонил", CANCELLED: "Отменено", DISPUTED: "Открыт спор" }[deal.status as "DECLINED"] : s.label}
              </p>
              {isFailure && deal.reason && <p className="text-sm text-danger">{deal.reason}</p>}
              {ev && !isFailure && <p className="tabular text-xs text-muted">{formatDateTime(ev.at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function WhatNext({ deal }: { deal: Deal }) {
  const buyer = deal.role === "buyer";
  const phone = deal.counterpart.phone;
  const text: Partial<Record<RequestStatus, string>> = buyer
    ? {
        ACCEPTED:
          deal.source === "AUCTION"
            ? "Вы выиграли аукцион, вещь зарезервирована за вами. Выберите способ получения в течение 48 часов — после этого откроются контакты продавца"
            : "Цена согласована, вещь зарезервирована за вами. Выберите способ получения — после этого откроются контакты продавца",
        PENDING_SELLER: deal.expiresAt ? `Продавец ответит до ${new Date(deal.expiresAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "Ждём ответа продавца",
        WAITING_HANDOVER: phone ? `Свяжитесь с продавцом: ${phone}` : "Свяжитесь с продавцом и договоритесь о передаче",
        HANDED_OVER: "Продавец отметил, что передал вещь. Подтвердите получение",
        IN_TRANSIT: deal.trackingNumber ? `Трек-номер: ${deal.trackingNumber}` : "Вещь в пути",
        COMPLETED: "Сделка завершена",
        DECLINED: "Продавец отклонил запрос. Посмотрите похожие вещи",
        CANCELLED: deal.cancelledByMe ? "Вы отменили сделку" : "Сделка отменена",
        DISPUTED: "Поддержка рассмотрит спор и свяжется с вами",
      }
    : {
        PENDING_SELLER: "Покупатель ждёт ответа. Примите или отклоните запрос",
        ACCEPTED: deal.source === "AUCTION" ? "Аукцион завершён. Ждём, когда победитель выберет способ получения (до 48 часов)" : "Вы приняли предложение цены. Ждём, когда покупатель выберет способ получения",
        WAITING_HANDOVER:
          deal.deliveryMethod === "DELIVERY"
            ? `Отправьте вещь${deal.deliveryPoint ? ` по адресу: ${deal.deliveryPoint}` : ""} и введите трек-номер`
            : phone
              ? `Договоритесь о передаче: ${phone}`
              : "Договоритесь с покупателем о передаче",
        HANDED_OVER: "Ждём, когда покупатель подтвердит получение. Сделка завершится автоматически через 7 дней",
        IN_TRANSIT: "Ждём, когда покупатель подтвердит получение. Сделка завершится автоматически через 7 дней",
        COMPLETED: "Продано",
        CANCELLED: deal.cancelledByMe ? "Вы отменили сделку" : "Покупатель отменил сделку",
        DECLINED: "Вы отклонили запрос",
        DISPUTED: "Поддержка рассмотрит спор и свяжется с вами",
      };
  return text[deal.status] ? <p className="text-[15px]">{text[deal.status]}</p> : null;
}

function DealView({ id }: { id: string }) {
  const { data: deal, error, mutate } = useSWR<Deal>(`/requests/${id}`);
  const [dispute, setDispute] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string>();
  const toast = useToast();

  if (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return (
        <EmptyState title="Сделка не найдена">
          <ButtonLink href="/purchases">Мои покупки</ButtonLink>
        </EmptyState>
      );
    }
    return <ErrorState message="Не удалось загрузить сделку" onRetry={() => mutate()} />;
  }
  if (!deal) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </div>
    );
  }
  const item = deal.items[0];
  const negotiated = deal.priceTotal < deal.listPriceTotal;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <Link href={deal.role === "buyer" ? "/purchases" : "/sales"} className="text-sm text-ink-2 hover:text-ink">
        ← {deal.role === "buyer" ? "Мои покупки" : "Мои продажи"}
      </Link>

      <div className="mt-4 flex gap-4 rounded-3xl bg-surface p-4 md:p-6">
        <Link href={`/item/${item.id}`} className="w-24 shrink-0 overflow-hidden rounded-xl bg-skeleton md:w-28" style={{ aspectRatio: "4 / 5" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {item.cover && <img src={item.cover.urls.s} alt="" className="size-full object-cover" />}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DealBadge status={deal.status} role={deal.role} />
            <span className="text-xs text-muted">№ {deal.number}</span>
          </div>
          <Link href={`/item/${item.id}`} className="mt-2 block font-medium hover:underline">
            {item.title}
          </Link>
          {deal.items.length > 1 && <p className="text-sm text-ink-2">и ещё {deal.items.length - 1} — комплект из {deal.items.length} вещей</p>}
          <p className="tabular mt-1 text-xl font-semibold">
            {formatPrice(deal.priceTotal)}
            {negotiated && <s className="ml-2 text-sm font-normal text-muted">{deal.subtotal ?? deal.listPriceTotal}</s>}
          </p>
          {deal.discountPercent > 0 && <p className="text-sm font-medium text-ok">Скидка за комплект −{deal.discountPercent}%</p>}
          <p className="mt-1 text-sm text-ink-2">
            {deal.role === "buyer" ? "Продавец" : "Покупатель"}:{" "}
            <Link href={`/u/${deal.counterpart.username}`} className="font-medium hover:underline">
              @{deal.counterpart.username}
            </Link>
          </p>
          <p className="text-sm text-muted">
            {DELIVERY_LABEL[deal.deliveryMethod]}
            {deal.deliveryPoint ? ` · ${deal.deliveryPoint}` : deal.sellerCity ? ` · ${deal.sellerCity}` : ""} · оплата при получении
          </p>
        </div>
      </div>

      {deal.items.length > 1 && (
        <ul className="mt-3 flex flex-col divide-y divide-line rounded-2xl bg-surface px-4">
          {deal.items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 py-2.5 text-sm">
              <Link href={`/item/${it.id}`} className="w-10 shrink-0 overflow-hidden rounded-lg bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.cover && <img src={it.cover.urls.s} alt="" className="size-full object-cover" />}
              </Link>
              <Link href={`/item/${it.id}`} className="min-w-0 flex-1 truncate hover:underline">
                {it.title}
              </Link>
              <span className="tabular shrink-0">
                {formatPrice(it.dealPrice)}
                {it.price != null && it.price > it.dealPrice && <s className="ml-1.5 text-xs text-muted">{it.price}</s>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1fr]">
        <section className="rounded-3xl bg-surface p-5 md:p-6">
          <h2 className="mb-5 font-semibold">Статус</h2>
          <Tracker deal={deal} />
        </section>
        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5 md:p-6">
          <h2 className="font-semibold">Что дальше</h2>
          <WhatNext deal={deal} />
          {deal.buyerComment && (
            <p className="rounded-xl bg-paper px-4 py-3 text-sm text-ink-2">
              Комментарий покупателя: «{deal.buyerComment}»
            </p>
          )}
          <DealActions deal={deal} onChange={(d) => mutate(d, { revalidate: true })} />
          {deal.status === "COMPLETED" && deal.role === "buyer" && (
            <ButtonLink href={`/u/${deal.counterpart.username}`} variant="secondary">
              Смотреть гардероб продавца
            </ButtonLink>
          )}
          {deal.status === "DECLINED" && deal.role === "buyer" && <ButtonLink href={`/search?category=${item.category ?? ""}`}>Похожие вещи</ButtonLink>}
        </section>
      </div>

      {(deal.canReview || deal.review) && (
        <div className="mt-6">
          <DealReview deal={deal} onChange={() => mutate()} />
        </div>
      )}

      {["WAITING_HANDOVER", "HANDED_OVER", "IN_TRANSIT"].includes(deal.status) && (
        <button className="mt-8 text-sm text-ink-2 underline underline-offset-4 hover:text-ink" onClick={() => setDispute(true)}>
          Проблема со сделкой?
        </button>
      )}

      <Modal open={dispute} onClose={() => setDispute(false)} title="Проблема со сделкой">
        <p className="mb-4 text-sm text-ink-2">Опишите, что случилось. Поддержка свяжется с обеими сторонами.</p>
        <Field label="Что случилось" htmlFor="dispute" error={fieldError}>
          <Textarea id="dispute" value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} />
        </Field>
        <Button
          block
          className="mt-6"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const d = await api<Deal>(`/requests/${deal.id}/dispute`, { body: { reason } });
              await mutate(d);
              setDispute(false);
              toast("Спор открыт — поддержка свяжется с вами");
            } catch (e) {
              if (e instanceof ApiError) setFieldError(Object.values(e.fields)[0] ?? e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Отправить в поддержку
        </Button>
      </Modal>
    </div>
  );
}
