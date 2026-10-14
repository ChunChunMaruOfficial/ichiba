"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { DealActions } from "@/components/deal-actions";
import { DealReview } from "@/components/reviews";
import { useToast } from "@/components/toast";
import { DeliveryLabel } from "@/components/delivery-label";
import { Button, ButtonLink, DealBadge, Field, IconCheck, IconChevronDown, Modal, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatPrice } from "@/lib/labels";
import type { Deal, RequestStatus } from "@/lib/types";

/*
 * The deal lives in its conversation: a panel under the chat header shows where the deal is, what to do next and
 * the buttons for it; "Подробнее" opens the items, the status timeline, the review and "Проблема со сделкой?".
 */

/** Tracker steps: delivery branch vs in-person/pickup branch (frame 14 BUYER ORDER PAGE). */
function steps(deal: Deal): Array<{ status: RequestStatus[]; label: string }> {
  const head = [
    { status: ["PENDING_SELLER", "CREATED"] as RequestStatus[], label: deal.source === "OFFER" ? "Предложение цены" : deal.source === "AUCTION" ? "Аукцион" : "Запрос отправлен" },
    { status: ["ACCEPTED"] as RequestStatus[], label: deal.source === "OFFER" ? "Цена согласована" : deal.source === "AUCTION" ? "Победа в аукционе" : "Продавец согласился" },
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
          <li key={s.label} className="relative flex gap-3 pb-3.5 text-sm last:pb-0">
            {i < all.length - 1 && <span className={clsx("absolute left-[9px] top-5 h-[calc(100%-20px)] w-0.5", done ? "bg-accent" : "bg-line")} aria-hidden />}
            <span
              className={clsx(
                "z-10 grid size-5 shrink-0 place-items-center rounded-full border-2 text-[10px]",
                isFailure ? "border-danger bg-danger text-accent-ink" : done ? "border-accent bg-accent text-accent-ink" : current ? "border-accent bg-surface" : "border-line-strong bg-surface",
              )}
              aria-hidden
            >
              {isFailure ? "✕" : done ? <IconCheck className="size-3" /> : current ? <span className="size-1.5 rounded-full bg-accent" /> : null}
            </span>
            <div className={clsx("flex flex-wrap items-baseline gap-x-2", !done && !current && "text-muted")}>
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

function whatNext(deal: Deal): string | null {
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
  return text[deal.status] ?? null;
}


export function DealPanel({ deal, onChange }: { deal: Deal; onChange: (d?: Deal) => void }) {
  // Links to a deal's review (notifications, emails) land here with #review. The panel renders only after the
  // deal has loaded in the browser, so reading the hash here is safe.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#review");
  const [dispute, setDispute] = useState(false);
  const next = whatNext(deal);
  const item = deal.items[0];
  const negotiated = deal.priceTotal < deal.listPriceTotal;
  const wantsReview = deal.canReview && !deal.review;

  return (
    <section aria-label="Сделка" className="border-b border-line bg-surface/70">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <DealBadge status={deal.status} role={deal.role} />
        <p className="min-w-0 flex-1 truncate text-sm text-ink-2" title={next ?? undefined}>
          <span className="tabular font-semibold text-ink">{formatPrice(deal.priceTotal)}</span>
          {next && !open && <span className="max-sm:hidden"> · {next}</span>}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium text-ink-2 hover:bg-ink/5 hover:text-ink"
        >
          {open ? "Свернуть" : "Подробнее"}
          <IconChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {!open && (
        <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">
          {next && <p className="text-sm text-ink-2 sm:hidden">{next}</p>}
          <DealActions deal={deal} onChange={onChange} compact />
          {wantsReview && (
            <button type="button" onClick={() => setOpen(true)} className="self-start text-sm font-semibold underline underline-offset-4">
              Оставить отзыв
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="fade-in flex max-h-[min(60vh,560px)] flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-4">
          {next && <p className="text-[15px]">{next}</p>}
          <DealActions deal={deal} onChange={onChange} />

          <div className="flex flex-col gap-1 text-sm">
            {deal.items.length > 1 ? (
              <ul className="flex flex-col divide-y divide-line border-y border-line">
                {deal.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 py-2">
                    <Link href={`/item/${it.id}`} className="w-9 shrink-0 overflow-hidden rounded-md bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {it.cover && <img src={it.cover.urls.s} alt="" className="size-full object-contain" />}
                    </Link>
                    <Link href={`/item/${it.id}`} className="min-w-0 flex-1 truncate hover:underline">
                      {it.title}
                    </Link>
                    <span className="tabular shrink-0">{formatPrice(it.dealPrice)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p>
              <span className="tabular font-semibold">{formatPrice(deal.priceTotal)}</span>
              {negotiated && <s className="ml-2 text-muted">{formatPrice(deal.subtotal ?? deal.listPriceTotal)}</s>}
              {deal.discountPercent > 0 && <span className="ml-2 text-ok">скидка за комплект −{deal.discountPercent}%</span>}
              <span className="text-muted"> · оплата при получении</span>
            </p>
            <p className="text-muted">
              <DeliveryLabel method={deal.deliveryMethod} />
              {deal.deliveryPoint ? ` · ${deal.deliveryPoint}` : deal.sellerCity ? ` · ${deal.sellerCity}` : ""}
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold">Как идёт сделка</h3>
            <Tracker deal={deal} />
          </div>

          {(deal.canReview || deal.review) && (
            <div id="review">
              <DealReview deal={deal} onChange={() => onChange()} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {deal.status === "COMPLETED" && deal.role === "buyer" && (
              <ButtonLink href={`/u/${deal.counterpart.username}`} variant="secondary" size="sm">
                Гардероб продавца
              </ButtonLink>
            )}
            {deal.status === "DECLINED" && deal.role === "buyer" && (
              <ButtonLink href={`/search?category=${item?.category ?? ""}`} size="sm">
                Похожие вещи
              </ButtonLink>
            )}
            {["WAITING_HANDOVER", "HANDED_OVER", "IN_TRANSIT"].includes(deal.status) && (
              <button type="button" className="text-sm text-ink-2 underline underline-offset-4 hover:text-ink" onClick={() => setDispute(true)}>
                Проблема со сделкой?
              </button>
            )}
          </div>
        </div>
      )}
      <DisputeDialog open={dispute} deal={deal} onClose={() => setDispute(false)} onDone={onChange} />
    </section>
  );
}

function DisputeDialog({ open, deal, onClose, onDone }: { open: boolean; deal: Deal; onClose: () => void; onDone: (d: Deal) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string>();
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Проблема со сделкой">
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
            onDone(d);
            onClose();
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
  );
}
