"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useCountdown } from "@/lib/countdown";
import { formatPrice, plural, timeAgo } from "@/lib/labels";
import type { AuctionView, Card } from "@/lib/types";
import { useSession } from "./session";
import { useToast } from "./toast";
import { Badge, Button, ButtonLink, Chip, Input } from "./ui";

/** Small live timer used on cards and the product page. */
export function AuctionTimer({ endsAt, className }: { endsAt: string; className?: string }) {
  const { label, urgent, over } = useCountdown(endsAt);
  return (
    <span className={clsx("tabular inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", over ? "bg-black/60 text-white" : urgent ? "bg-heart text-white" : "bg-ink/80 text-white", className)}>
      <span aria-hidden>⏱</span>
      {over ? "Завершён" : label}
    </span>
  );
}

/** Price label for an auction card: current bid or the start price. */
export const auctionPrice = (a: NonNullable<Card["auction"]>) => (a.currentBid != null ? `Ставка ${formatPrice(a.currentBid)}` : `Старт ${formatPrice(a.startPrice)}`);

/**
 * Bidding panel on the product page (decision D16): current bid, live countdown, min next bid,
 * quick steps, bid history. Bidding is personal, so guests are asked to sign in.
 */
export function AuctionPanel({ auction: a, listingId, title, isOwner, onChange }: { auction: AuctionView; listingId: string; title: string; isOwner: boolean; onChange: (a: AuctionView) => void }) {
  const { requireAuth, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const { label, urgent, over } = useCountdown(a.endsAt);
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"bid" | "auto">("bid");
  const [busy, setBusy] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const amount = Number(value) || a.minBid;
  const active = a.status === "ACTIVE" && !over;
  // The leader can only raise their auto-bid limit; others choose between a bid and an auto-bid.
  const effectiveMode = a.leaderIsMe ? "auto" : mode;
  const autoFloor = a.leaderIsMe && a.currentBid != null ? a.currentBid + a.step : a.minBid;

  const placeBid = () =>
    requireAuth(
      async () => {
        setBusy(true);
        setError(null);
        const auto = effectiveMode === "auto";
        const v = auto ? Number(value) : amount;
        try {
          const r = await api<{ auction: AuctionView }>(`/auctions/${a.id}/bids`, { body: auto ? { maxAmount: v } : { amount: v } });
          onChange(r.auction);
          setValue("");
          void refresh();
          if (!r.auction.leaderIsMe) toast("Вашу ставку сразу перебила автоставка другого участника", { tone: "error" });
          else toast(auto ? `Автоставка до ${v} BYN включена — вы лидируете с ${r.auction.currentBid} BYN` : `Ставка ${v} BYN принята — вы лидируете`);
        } catch (e) {
          if (e instanceof ApiError && e.code === "USE_BUY_NOW") setError(e.message);
          else setError(e instanceof ApiError ? (e.fields.amount ?? e.fields.maxAmount ?? e.message) : "Не удалось сделать ставку. Проверьте соединение");
        } finally {
          setBusy(false);
        }
      },
      { reason: `чтобы сделать ставку на «${title}»` },
    );

  const buyNow = () =>
    requireAuth(
      async () => {
        if (!window.confirm(`Купить «${title}» сейчас за ${a.buyNowPrice} BYN? Аукцион завершится, вещь зарезервируют за вами.`)) return;
        setBuying(true);
        try {
          const r = await api<{ requestId: string; auction: AuctionView }>(`/auctions/${a.id}/buy-now`, { method: "POST" });
          onChange(r.auction);
          void refresh();
          toast("Вещь ваша — выберите способ получения");
          router.push(`/buy/${listingId}?request=${r.requestId}`);
        } catch (e) {
          toast(e instanceof ApiError ? e.message : "Не удалось выкупить. Проверьте соединение", { tone: "error" });
        } finally {
          setBuying(false);
        }
      },
      { reason: `чтобы купить «${title}»` },
    );

  const cancelAuto = async () => {
    try {
      const r = await api<{ auction: AuctionView }>(`/auctions/${a.id}/autobid`, { method: "DELETE" });
      onChange(r.auction);
      toast("Автоставка отключена");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось отключить", { tone: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line-strong bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{a.currentBid != null ? "Текущая ставка" : "Стартовая цена"}</p>
          <p className="tabular text-3xl font-semibold">{formatPrice(a.currentBid ?? a.startPrice)}</p>
          <p className="text-sm text-ink-2">
            {a.bidsCount ? `${a.bidsCount} ${plural(a.bidsCount, "ставка", "ставки", "ставок")} · ${a.bidders} ${plural(a.bidders, "участник", "участника", "участников")}` : "Ставок пока нет"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted">{active ? "До конца" : "Аукцион"}</p>
          <p className={clsx("tabular text-xl font-semibold", urgent && active && "text-heart")}>{active ? label : "завершён"}</p>
          {a.extendedTimes > 0 && active && <p className="text-xs text-muted">продлён {a.extendedTimes}×</p>}
        </div>
      </div>

      {a.buyNowPrice != null && active && (
        a.buyNowAvailable ? (
          !isOwner ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft px-4 py-3">
              <div>
                <p className="font-semibold">Купить сейчас — {formatPrice(a.buyNowPrice)}</p>
                <p className="text-xs text-ink-2">Без торга: аукцион закончится, вещь сразу ваша</p>
              </div>
              <Button loading={buying} onClick={buyNow}>
                Купить сейчас
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-2">«Купить сейчас» за {formatPrice(a.buyNowPrice)} доступна, пока ставка ниже {Math.ceil(a.buyNowPrice * 0.75)} BYN</p>
          )
        ) : (
          <p className="text-sm text-muted">«Купить сейчас» больше недоступна — торги подошли к цене выкупа</p>
        )
      )}

      {a.reserveSet && (
        <p className="text-sm">
          {a.reserveMet ? <Badge tone="ok">Резерв достигнут</Badge> : <Badge tone="warn">Резервная цена не достигнута</Badge>}
          {isOwner && a.reservePrice != null && <span className="ml-2 text-muted">ваш резерв — {formatPrice(a.reservePrice)}</span>}
        </p>
      )}

      {/* Buyer state */}
      {!isOwner && active && (
        <>
          {a.leaderIsMe ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ok-soft px-4 py-2.5 text-sm text-ok">
              <span>
                Вы лидируете со ставкой {formatPrice(a.currentBid)}
                {a.myAutoMax != null && ` · автоставка до ${formatPrice(a.myAutoMax)}`}
              </span>
              {a.myAutoMax != null && (
                <button type="button" className="font-medium underline underline-offset-4" onClick={cancelAuto}>
                  Отключить
                </button>
              )}
            </div>
          ) : a.myMaxBid != null ? (
            <p className="rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">Вашу ставку {formatPrice(a.myMaxBid)} перебили</p>
          ) : null}

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (effectiveMode === "auto" && (!value || Number(value) < autoFloor)) return setError(`Лимит — от ${autoFloor} BYN`);
              placeBid();
            }}
          >
            {!a.leaderIsMe && (
              <div role="tablist" aria-label="Тип ставки" className="grid grid-cols-2 gap-1 rounded-xl bg-black/5 p-1 text-sm">
                {(
                  [
                    ["bid", "Ставка"],
                    ["auto", "Автоставка"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => (setMode(k), setError(null))} className={clsx("h-9 rounded-lg font-medium", mode === k ? "bg-surface shadow-sm" : "text-ink-2")}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            <label htmlFor="bid-amount" className="text-sm font-medium">
              {effectiveMode === "auto" ? (a.leaderIsMe ? `${a.myAutoMax != null ? "Новый лимит" : "Включить автоставку"} — от ${formatPrice(autoFloor)}` : `Максимум, который готовы заплатить — от ${formatPrice(autoFloor)}`) : `Ваша ставка — от ${formatPrice(a.minBid)}`}
            </label>
            <div className="flex gap-2">
              <Input
                id="bid-amount"
                name="amount"
                autoComplete="off"
                inputMode="numeric"
                value={value}
                onChange={(e) => (setValue(e.target.value.replace(/\D/g, "").slice(0, 6)), setError(null))}
                placeholder={String(effectiveMode === "auto" ? autoFloor + a.step * 2 : a.minBid)}
                className="tabular h-12 text-lg font-semibold"
                error={error ?? undefined}
              />
              <Button type="submit" size="lg" loading={busy} className="shrink-0">
                {effectiveMode === "auto" ? (a.leaderIsMe ? "Сохранить" : "Включить") : "Сделать ставку"}
              </Button>
            </div>
            {effectiveMode === "bid" && (
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2].map((k) => {
                  const v = a.minBid + k * a.step;
                  return (
                    <Chip key={k} active={amount === v && !!value} onClick={() => setValue(String(v))}>
                      {v} BYN
                    </Chip>
                  );
                })}
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <p className="text-xs text-muted">
              {effectiveMode === "auto"
                ? "Мы будем повышать ставку за вас на один шаг, только когда вас перебивают, и не выше лимита. Лимит не видит никто, кроме вас."
                : `Шаг ${a.step} BYN. Ставка в последние 5 минут продлевает аукцион. Победитель выбирает способ получения в течение 48 часов, оплата при получении.`}
            </p>
          </form>
        </>
      )}

      {/* Ended states */}
      {!active && a.status === "SOLD" && (a.winnerIsMe ? (
        <div className="rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">
          {a.boughtOut ? "Вы выкупили вещь" : "Вы выиграли"} за {formatPrice(a.currentBid)}.{" "}
          {a.requestId && (
            <Link href={`/buy/${listingId}?request=${a.requestId}`} className="font-semibold underline">
              Выбрать способ получения
            </Link>
          )}
        </div>
      ) : isOwner && a.requestId ? (
        <ButtonLink href={`/deals/${a.requestId}`} variant="secondary">
          Открыть сделку с победителем
        </ButtonLink>
      ) : (
        <p className="text-sm text-muted">{a.boughtOut ? "Вещь выкупили по цене «Купить сейчас»." : "Аукцион завершён — вещь ушла победителю."}</p>
      ))}
      {!active && a.status === "NO_SALE" && <p className="text-sm text-muted">Аукцион завершился без продажи — вещь продаётся по фиксированной цене.</p>}
      {!active && a.status === "ACTIVE" && <p className="text-sm text-muted">Подводим итоги…</p>}

      {isOwner && active && a.bidsCount === 0 && (
        <Button
          variant="ghost"
          loading={cancelling}
          onClick={async () => {
            if (!window.confirm("Отменить аукцион? Вещь останется в продаже по стартовой цене.")) return;
            setCancelling(true);
            try {
              await api(`/auctions/${a.id}/cancel`, { method: "POST" });
              toast("Аукцион отменён — вещь продаётся по фиксированной цене");
              onChange({ ...a, status: "CANCELLED" });
            } catch (e) {
              toast(e instanceof ApiError ? e.message : "Не удалось отменить", { tone: "error" });
            } finally {
              setCancelling(false);
            }
          }}
        >
          Отменить аукцион
        </Button>
      )}

      {a.bids.length > 0 && (
        <details className="group" open={a.bids.length <= 5}>
          <summary className="cursor-pointer list-none text-sm font-medium text-ink-2 hover:text-ink">История ставок ({a.bidsCount})</summary>
          <ol className="mt-2 flex flex-col divide-y divide-line text-sm">
            {a.bids.map((b, i) => (
              <li key={`${b.at}-${i}`} className={clsx("flex items-center justify-between py-1.5", b.mine && "font-medium")}>
                <span className="flex items-center gap-1.5">
                  {i === 0 && <span className="text-heart">●</span>}@{b.bidder}
                  {b.auto && <span className="rounded bg-black/5 px-1.5 text-[11px] font-medium text-ink-2">авто</span>}
                  {b.buyNow && <span className="rounded bg-ink px-1.5 text-[11px] font-medium text-white">выкуп</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted">{timeAgo(b.at)}</span>
                  <span className="tabular">{formatPrice(b.amount)}</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
