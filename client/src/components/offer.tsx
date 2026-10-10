"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatPrice, hoursLeft } from "@/lib/labels";
import { usePresence } from "@/lib/presence";
import type { Offer } from "@/lib/types";
import { NegotiationHint, OpeningHint } from "./ai-hints";
import { useSession } from "./session";
import { useToast } from "./toast";
import { Badge, Button, Chip, Field, Input, Modal } from "./ui";

const QUICK = [10, 15, 20];

/** "Предложить цену" sheet (frame 13 OFFER — FIRST VIEW / VALIDATION). */
export function OfferSheet({
  open,
  onClose,
  listing,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  listing: { id: string; title: string; price: number; cover?: string };
  onSent: (o: Offer) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Number(value);
  const tooHigh = !!value && amount >= listing.price;
  const tooLow = !!value && amount > 0 && amount < Math.ceil(listing.price * 0.3);

  const submit = async () => {
    if (!value || !amount) return setError("Введите сумму");
    setBusy(true);
    setError(null);
    try {
      const o = await api<Offer>("/offers", { body: { listingId: listing.id, amount } });
      if (o.status === "DECLINED") toast(`Продавец не готов продать за ${amount} BYN — попробуйте другую цену позже`, { tone: "error" });
      else toast(`Предложение ${amount} BYN отправлено`);
      onSent(o);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.amount ?? e.message) : "Не удалось отправить предложение. Проверьте соединение");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Предложить цену" width="max-w-[420px]">
      <div className="flex items-center gap-3">
        {listing.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.cover} alt="" width={56} height={70} className="h-[70px] w-14 rounded-lg object-contain" />
        )}
        <div className="min-w-0">
          <p className="truncate font-medium">{listing.title}</p>
          <p className="text-sm text-ink-2">
            Цена продавца: <b className="tabular text-ink">{formatPrice(listing.price)}</b>
          </p>
        </div>
      </div>
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Ваше предложение, BYN" htmlFor="offer-amount" error={error ?? (tooLow ? "Слишком низкое предложение" : undefined)}>
          <Input
            id="offer-amount"
            name="amount"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="tabular h-14 text-2xl font-semibold"
            placeholder={String(Math.round(listing.price * 0.85))}
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK.map((p) => {
            const v = Math.round(listing.price * (1 - p / 100));
            return (
              <Chip key={p} active={amount === v} onClick={() => setValue(String(v))}>
                −{p}% ({v})
              </Chip>
            );
          })}
        </div>
        <OpeningHint listingId={listing.id} onPick={(v) => setValue(String(v))} />
        {tooHigh && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-4 py-3 text-sm">
            Это не меньше цены — просто купите
            <Button type="button" size="sm" onClick={() => (onClose(), router.push(`/buy/${listing.id}`))}>
              Купить
            </Button>
          </div>
        )}
        <p className="mt-4 text-sm text-muted">Предложение действует 48 часов. Если продавец примет — вещь будет зарезервирована за вами.</p>
        <Button type="submit" size="lg" block className="mt-5" loading={busy} disabled={tooHigh || tooLow || !value}>
          {busy ? "Отправляем предложение…" : "Отправить предложение"}
        </Button>
      </form>
    </Modal>
  );
}

/** Mounts the counter dialog while `value` is set (plus its exit animation); each opening starts from `value`. */
function CounterDialogHost({ value, ...rest }: { offer: Offer; value: string | null; onClose: () => void; onDone: (o: Offer) => void }) {
  const { mounted } = usePresence(value !== null);
  return mounted ? <CounterDialog {...rest} open={value !== null} initial={value ?? ""} /> : null;
}

/** Counter-offer dialog: price must sit strictly between the last two offers. */
function CounterDialog({ offer, open, onClose, onDone, initial = "" }: { offer: Offer; open: boolean; onClose: () => void; onDone: (o: Offer) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const range = offer.counterRange;
  const last = offer.round + 1 >= 3;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const o = await api<Offer>(`/offers/${offer.id}/counter`, { body: { amount: Number(value) } });
      toast(`Предложили ${value} BYN`);
      onDone(o);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.amount ?? e.message) : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={offer.role === "seller" ? "Своя цена" : "Новая цена"} width="max-w-[420px]">
      <p className="text-sm text-ink-2">
        {offer.role === "seller" ? "Покупатель предложил" : "Продавец предлагает"} <b className="tabular text-ink">{formatPrice(offer.amount)}</b>
        {range && (
          <>
            . Ваша цена — от {range.min} до {range.max} BYN.
          </>
        )}
      </p>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Ваша цена, BYN" htmlFor="counter-amount" error={error ?? undefined} hint={last ? "Это последний раунд: дальше можно только принять или отклонить" : `Раунд ${offer.round + 1} из 3`}>
          <Input id="counter-amount" name="amount" autoComplete="off" inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} className="tabular h-14 text-2xl font-semibold" placeholder={range ? String(Math.round((range.min + range.max) / 2)) : ""} />
        </Field>
        <Button type="submit" block size="lg" className="mt-5" loading={busy} disabled={!value}>
          Отправить
        </Button>
      </form>
    </Modal>
  );
}

function useOfferActions(offer: Offer, onChange: (o: Offer | null, requestId?: string) => void) {
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: "accept" | "decline" | "cancel") => {
    setBusy(key);
    try {
      const r = await api<Offer & { requestId?: string }>(`/offers/${offer.id}/${key}`, { method: "POST" });
      void refresh();
      if (key === "accept") {
        toast(offer.role === "seller" ? "Предложение принято — вещь зарезервирована за покупателем" : "Цена согласована — выберите способ получения");
        onChange({ ...offer, status: "ACCEPTED", requestId: r.requestId ?? null, myTurn: false }, r.requestId);
      } else {
        toast(key === "decline" ? "Предложение отклонено" : "Предложение отменено");
        onChange({ ...offer, status: key === "decline" ? "DECLINED" : "CANCELLED", myTurn: false });
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось · Повторите", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** What the buyer sees on Product once a negotiation exists (frame 13 "ПОСЛЕ ОТПРАВКИ" / COUNTER OFFER). */
export function OfferStatusPanel({ offer, listingId, onChange, onNewOffer }: { offer: Offer; listingId: string; onChange: (o: Offer | null) => void; onNewOffer: () => void }) {
  const router = useRouter();
  const { busy, run } = useOfferActions(offer, (o, requestId) => {
    onChange(o);
    if (requestId) router.push(`/buy/${listingId}?request=${requestId}`);
  });
  /** Counter dialog: null = closed, otherwise the prefilled amount. */
  const [counter, setCounter] = useState<string | null>(null);
  const left = hoursLeft(offer.expiresAt);

  if (offer.status === "ACCEPTED") {
    return (
      <div className="rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">
        Цена {formatPrice(offer.amount)} согласована.{" "}
        {offer.requestId && (
          <Link href={`/deals/${offer.requestId}`} className="font-semibold underline">
            Открыть переписку
          </Link>
        )}
      </div>
    );
  }
  if (offer.status === "PENDING" && offer.from === "BUYER") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm">
        <span>
          Ваше предложение <b className="tabular">{formatPrice(offer.amount)}</b> · ожидает ответа{left != null && ` · ${left} ч`}
        </span>
        <button className="font-medium text-ink-2 underline underline-offset-4" disabled={!!busy} onClick={() => run("cancel")}>
          Отменить
        </button>
      </div>
    );
  }
  if (offer.status === "PENDING" && offer.from === "SELLER") {
    return (
      <div className="rounded-xl border border-ink bg-surface p-4">
        {offer.fromLikers ? (
          <>
            <p className="text-sm">
              ♡ Скидка для вас: <b className="tabular text-lg">{formatPrice(offer.amount)}</b>
              {offer.listPrice != null && <s className="ml-2 text-muted">{formatPrice(offer.listPrice)}</s>}
            </p>
            <p className="mt-0.5 text-xs text-muted">Вы сохранили вещь — @{offer.counterpart.username} снизил цену лично для вас{left != null && ` · осталось ${left} ч`}</p>
          </>
        ) : (
          <>
            <p className="text-sm">
              @{offer.counterpart.username} предлагает <b className="tabular text-lg">{formatPrice(offer.amount)}</b>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Раунд {offer.round} из 3{left != null && ` · осталось ${left} ч`}
            </p>
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" loading={busy === "accept"} onClick={() => run("accept")}>
            Принять
          </Button>
          <Button size="sm" variant="secondary" loading={busy === "decline"} onClick={() => run("decline")}>
            Отклонить
          </Button>
          {offer.canCounter && (
            <Button size="sm" variant="ghost" onClick={() => setCounter("")}>
              Предложить новую цену
            </Button>
          )}
        </div>
        {!offer.fromLikers && (
          <div className="mt-3">
            <NegotiationHint offer={offer} onAccept={() => run("accept")} onDecline={() => run("decline")} onCounter={(v) => setCounter(String(v))} compact />
          </div>
        )}
        <CounterDialogHost offer={offer} value={counter} onClose={() => setCounter(null)} onDone={(o) => onChange(o)} />
      </div>
    );
  }
  const text = offer.status === "DECLINED" ? "Продавец отклонил предложение" : offer.status === "EXPIRED" ? "Предложение истекло" : "Предложение отменено";
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-ink/5 px-4 py-3 text-sm text-ink-2">
      {text} ({formatPrice(offer.amount)})
      {offer.status !== "DECLINED" && (
        <button className="font-medium text-ink underline underline-offset-4" onClick={onNewOffer}>
          Новое предложение
        </button>
      )}
    </div>
  );
}

/** Offer card for the seller's "Требует действия" and for lists (frame 13 SELLER OFFER SCREEN). */
export function OfferCard({ offer, onChange }: { offer: Offer; onChange: () => void }) {
  const { busy, run } = useOfferActions(offer, () => onChange());
  const [counter, setCounter] = useState<string | null>(null);
  const left = hoursLeft(offer.expiresAt);
  const discount = offer.listPrice ? Math.round((1 - offer.amount / offer.listPrice) * 100) : 0;
  const cover = offer.listing.cover?.urls.s;
  return (
    <article className={`rise flex gap-4 rounded-3xl bg-surface p-4 shadow-[var(--shadow-paper)] transition-transform duration-200 hover:-translate-y-0.5 md:p-5`}>
      <Link href={`/item/${offer.listing.id}`} className="w-20 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cover && <img src={cover} alt="" width={80} height={100} className="size-full object-contain" />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={offer.myTurn ? "warn" : offer.status === "ACCEPTED" ? "ok" : "muted"}>
            {offer.myTurn ? "Предложение цены" : offer.status === "ACCEPTED" ? "Принято" : offer.status === "PENDING" ? "Ждём ответа" : offer.status === "DECLINED" ? "Отклонено" : "Истекло"}
          </Badge>
          {offer.status === "PENDING" && left != null && <span className="text-xs text-muted">осталось {left} ч</span>}
        </div>
        <Link href={`/item/${offer.listing.id}`} className="truncate font-medium hover:underline">
          {offer.listing.title}
        </Link>
        <p className="text-sm text-ink-2">
          {(offer.from === "BUYER") === (offer.role === "buyer") ? "Вы предложили" : `@${offer.counterpart.username} предлагает`} <b className="tabular text-ink">{formatPrice(offer.amount)}</b>
          {offer.listPrice && (
            <>
              {" "}
              вместо {formatPrice(offer.listPrice)} <span className="text-muted">(−{discount}%)</span>
            </>
          )}
        </p>
        <p className="text-xs text-muted">{offer.fromLikers ? "Скидка лайкнувшим" : `Раунд ${offer.round} из 3`}</p>
        {offer.myTurn && (
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" loading={busy === "accept"} onClick={() => run("accept")}>
              Принять
            </Button>
            <Button size="sm" variant="secondary" loading={busy === "decline"} onClick={() => run("decline")}>
              Отклонить
            </Button>
            {offer.canCounter && (
              <Button size="sm" variant="ghost" onClick={() => setCounter("")}>
                Своя цена
              </Button>
            )}
          </div>
        )}
        {offer.myTurn && !offer.fromLikers && (
          <div className="mt-2">
            <NegotiationHint offer={offer} onAccept={() => run("accept")} onDecline={() => run("decline")} onCounter={(v) => setCounter(String(v))} />
          </div>
        )}
        {offer.status === "ACCEPTED" && offer.requestId && (
          <Link href={`/deals/${offer.requestId}`} className="text-sm font-medium text-ink underline underline-offset-4">
            Открыть переписку
          </Link>
        )}
      </div>
      <CounterDialogHost offer={offer} value={counter} onClose={() => setCounter(null)} onDone={() => onChange()} />
    </article>
  );
}
