"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatPrice, timeAgo } from "@/lib/labels";
import type { Deal } from "@/lib/types";
import { useSession } from "./session";
import { useToast } from "./toast";
import { DeliveryLabel } from "./delivery-label";
import { Button, ButtonLink, DealBadge, Field, Input, Modal } from "./ui";

const DECLINE_REASONS = ["Уже продано", "Передумал продавать", "Не подходит способ получения", "Другое"];

/** The conversation is where a deal lives: opens (or creates) the chat tied to it. */
function useOpenDealChat() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = async (deal: { id: string; threadId?: string | null }) => {
    if (deal.threadId) return router.push(`/messages/${deal.threadId}`);
    setBusy(true);
    try {
      const t = await api<{ id: string }>("/threads", { body: { requestId: deal.id } });
      router.push(`/messages/${t.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось открыть переписку", { tone: "error" });
      setBusy(false);
    }
  };
  return { open, busy };
}

/** Every deal action for the current role and status (frames 13–14). Calls `onChange` with the updated deal. */
export function DealActions({ deal, onChange, compact }: { deal: Deal; onChange: (d: Deal) => void; compact?: boolean }) {
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "accept" | "decline" | "tracking" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [tracking, setTracking] = useState("");
  const [fieldError, setFieldError] = useState<string>();

  const run = async (key: string, path: string, body?: Record<string, unknown>, success?: string) => {
    setBusy(key);
    setFieldError(undefined);
    try {
      const d = await api<Deal>(`/requests/${deal.id}/${path}`, { method: "POST", body });
      onChange(d);
      setDialog(null);
      void refresh();
      if (success) toast(success);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setFieldError(Object.values(e.fields)[0]);
      else toast(e instanceof ApiError ? e.message : "Не удалось сохранить · Повторите", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const size = compact ? "sm" : "md";
  const seller = deal.role === "seller";
  const buttons: React.ReactNode[] = [];

  if (seller && deal.status === "PENDING_SELLER") {
    buttons.push(
      <Button key="accept" size={size} onClick={() => setDialog("accept")}>
        Принять
      </Button>,
      <Button key="decline" size={size} variant="secondary" onClick={() => setDialog("decline")}>
        Отклонить
      </Button>,
    );
  }
  if (seller && deal.status === "WAITING_HANDOVER") {
    if (deal.deliveryMethod === "DELIVERY")
      buttons.push(
        <Button key="track" size={size} onClick={() => setDialog("tracking")}>
          Ввести трек-номер
        </Button>,
      );
    else
      buttons.push(
        <Button key="handed" size={size} loading={busy === "handed"} onClick={() => run("handed", "handed-over", undefined, "Отмечено: передано")}>
          Передано
        </Button>,
      );
  }
  if (!seller && deal.status === "ACCEPTED") {
    buttons.push(
      <ButtonLink key="delivery" size={size} href={`/buy/${deal.items[0]?.id}?request=${deal.id}`}>
        Выбрать способ получения
      </ButtonLink>,
    );
  }
  if (!seller && ["WAITING_HANDOVER", "HANDED_OVER", "IN_TRANSIT"].includes(deal.status)) {
    buttons.push(
      <Button key="received" size={size} variant={deal.status === "WAITING_HANDOVER" ? "secondary" : "primary"} loading={busy === "received"} onClick={() => run("received", "received", undefined, "Сделка завершена")}>
        Я получил вещь
      </Button>,
    );
  }
  const canCancel = (deal.status === "PENDING_SELLER" && !seller) || deal.status === "WAITING_HANDOVER" || deal.status === "ACCEPTED";
  if (canCancel && !compact) {
    buttons.push(
      <Button key="cancel" size={size} variant="ghost" onClick={() => setDialog("cancel")}>
        {deal.status === "PENDING_SELLER" ? "Отменить запрос" : "Отменить сделку"}
      </Button>,
    );
  }

  return (
    <>
      {buttons.length > 0 && <div className="flex flex-wrap gap-2">{buttons}</div>}

      <Modal open={dialog === "accept"} onClose={() => setDialog(null)} title="Принять запрос?">
        <p className="text-sm text-ink-2">Вещь станет «Зарезервировано» и пропадёт из покупки у других. Другие запросы по ней будут отклонены.</p>
        <div className="mt-6 flex gap-3">
          <Button block loading={busy === "accept"} onClick={() => run("accept", "accept", undefined, "Запрос принят — договоритесь о передаче")}>
            Принять
          </Button>
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Отмена
          </Button>
        </div>
      </Modal>

      <Modal open={dialog === "decline"} onClose={() => setDialog(null)} title="Отклонить запрос">
        <p className="mb-3 text-sm text-ink-2">Причина — необязательно. Покупатель её увидит.</p>
        <div className="flex flex-col gap-2">
          {DECLINE_REASONS.map((r) => (
            <label key={r} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm has-[:checked]:border-ink">
              <input type="radio" name="reason" className="accent-[var(--accent)]" checked={reason === r} onChange={() => setReason(r)} />
              {r}
            </label>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <Button block variant="danger" loading={busy === "decline"} onClick={() => run("decline", "decline", { reason: reason || null }, "Запрос отклонён")}>
            Отклонить
          </Button>
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Отмена
          </Button>
        </div>
      </Modal>

      <Modal open={dialog === "tracking"} onClose={() => setDialog(null)} title="Трек-номер">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("tracking", "tracking", { trackingNumber: tracking }, "Трек-номер отправлен покупателю");
          }}
        >
          <Field label="Номер отправления" htmlFor="tracking" error={fieldError} hint="Покупатель увидит его в переписке">
            <Input id="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} error={fieldError} />
          </Field>
          <Button type="submit" block className="mt-6" loading={busy === "tracking"}>
            Отправить
          </Button>
        </form>
      </Modal>

      <Modal open={dialog === "cancel"} onClose={() => setDialog(null)} title={deal.status === "PENDING_SELLER" ? "Отменить запрос?" : "Отменить сделку?"}>
        {deal.status === "WAITING_HANDOVER" && <p className="mb-3 text-sm text-ink-2">Вещь вернётся в продажу.</p>}
        <Field label="Причина (необязательно)" htmlFor="cancel-reason">
          <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="mt-6 flex gap-3">
          <Button block variant="danger" loading={busy === "cancel"} onClick={() => run("cancel", "cancel", { reason: reason || null }, "Отменено")}>
            Отменить
          </Button>
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Назад
          </Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * Deal card used in My Purchases / My Sales / "Требует действия" (frame 14 ORDER CARD).
 * The whole card opens the conversation, where the deal's status and actions live.
 */
export function DealCard({ deal, onChange, plain }: { deal: Deal; onChange: (d: Deal) => void; plain?: boolean }) {
  const item = deal.items[0];
  const chat = useOpenDealChat();
  const title = `${item?.title ?? "Сделка"}${deal.items.length > 1 ? ` и ещё ${deal.items.length - 1}` : ""}`;
  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={`${title} — открыть переписку`}
      aria-busy={chat.busy}
      onClick={() => void chat.open(deal)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          void chat.open(deal);
        }
      }}
      className={clsx(
        "flex cursor-pointer gap-4 outline-none focus-visible:ring-3 focus-visible:ring-indigo/40",
        // `plain`: a row in a list (wardrobe "Требует действия"), not a raised card; the status goes without saying there.
        plain ? "py-4" : "rise rounded-3xl bg-surface p-4 shadow-[var(--shadow-paper)] transition-transform duration-200 hover:-translate-y-0.5 md:p-5",
        chat.busy && "opacity-70",
      )}
    >
      <div className={clsx("shrink-0 overflow-hidden rounded-xl bg-skeleton", plain ? "w-16" : "w-20")} style={{ aspectRatio: "4 / 5" }}>
        {item?.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.cover.urls.s} alt="" className="size-full object-contain" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {!plain && (
          <div className="flex flex-wrap items-center gap-2">
            <DealBadge status={deal.status} role={deal.role} />
          </div>
        )}
        <p className="truncate font-medium">
          {title}
          {deal.items.length === 1 && item?.size && <span className="text-ink-2">, {item.size}</span>}
        </p>
        <p className="text-sm text-ink-2">
          {deal.role === "seller" ? (
            <>
              @{deal.counterpart.username} хочет купить за <b className="tabular text-ink">{formatPrice(deal.priceTotal)}</b>
            </>
          ) : (
            <>
              <b className="tabular text-ink">{formatPrice(deal.priceTotal)}</b> · @{deal.counterpart.username}
            </>
          )}
        </p>
        <p className="text-xs text-muted">
          <DeliveryLabel method={deal.deliveryMethod} />
          {deal.sellerCity ? `, ${deal.sellerCity}` : ""} · {timeAgo(deal.createdAt)}
        </p>
        {/* Quick actions answer right here; they must not also open the chat. */}
        <div className="mt-1 empty:hidden" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <DealActions deal={deal} onChange={onChange} compact />
        </div>
      </div>
    </article>
  );
}
