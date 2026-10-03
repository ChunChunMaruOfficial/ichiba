"use client";

import clsx from "clsx";
import Link from "next/link";
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
  const toast = useToast();
  const { label, urgent, over } = useCountdown(a.endsAt);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const amount = Number(value) || a.minBid;
  const active = a.status === "ACTIVE" && !over;

  const placeBid = (bid: number) =>
    requireAuth(
      async () => {
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ auction: AuctionView }>(`/auctions/${a.id}/bids`, { body: { amount: bid } });
          onChange(r.auction);
          setValue("");
          void refresh();
          toast(`Ставка ${bid} BYN принята — вы лидируете`);
        } catch (e) {
          setError(e instanceof ApiError ? (e.fields.amount ?? e.message) : "Не удалось сделать ставку. Проверьте соединение");
        } finally {
          setBusy(false);
        }
      },
      { reason: `чтобы сделать ставку на «${title}»` },
    );

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
            <p className="rounded-xl bg-ok-soft px-4 py-2.5 text-sm text-ok">Вы лидируете со ставкой {formatPrice(a.myMaxBid)}</p>
          ) : a.myMaxBid != null ? (
            <p className="rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">Вашу ставку {formatPrice(a.myMaxBid)} перебили</p>
          ) : null}
          {!a.leaderIsMe && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                placeBid(amount);
              }}
            >
              <label htmlFor="bid-amount" className="text-sm font-medium">
                Ваша ставка — от {formatPrice(a.minBid)}
              </label>
              <div className="flex gap-2">
                <Input id="bid-amount" name="amount" autoComplete="off" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={String(a.minBid)} className="tabular h-12 text-lg font-semibold" error={error ?? undefined} />
                <Button type="submit" size="lg" loading={busy} className="shrink-0">
                  Сделать ставку
                </Button>
              </div>
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
              {error && <p className="text-sm text-danger">{error}</p>}
              <p className="text-xs text-muted">Шаг {a.step} BYN. Ставка в последние 5 минут продлевает аукцион. Победитель выбирает способ получения в течение 48 часов, оплата при получении.</p>
            </form>
          )}
        </>
      )}

      {/* Ended states */}
      {!active && a.status === "SOLD" && (a.winnerIsMe ? (
        <div className="rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">
          Вы выиграли за {formatPrice(a.currentBid)}.{" "}
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
        <p className="text-sm text-muted">Аукцион завершён — вещь ушла победителю.</p>
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
                <span>
                  {i === 0 && <span className="mr-1.5 text-heart">●</span>}@{b.bidder}
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
