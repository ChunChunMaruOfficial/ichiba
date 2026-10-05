"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { formatPrice, plural } from "@/lib/labels";
import { useToast } from "./toast";
import { Button, Field, Input, Modal } from "./ui";

const PRESETS = [10, 15, 20, 30];

/**
 * "Скидка лайкнувшим" (Poshmark/Depop "offer to likers"): the seller sends everyone who saved the item a
 * personal price, valid 48 h. Buyers accept it in one tap; nobody else sees the lower price.
 */
export function LikersOfferButton({ listingId, price }: { listingId: string; price: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { data, mutate } = useSWR<{ count: number; nextAt: string | null }>(`/offers/likers/${listingId}`);
  const [percent, setPercent] = useState(15);
  const [custom, setCustom] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data || (!data.count && !data.nextAt)) return null;

  const amount = custom ? Number(custom) : Math.max(1, Math.floor(price * (1 - percent / 100)));
  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const r = await api<{ sent: number }>(`/offers/likers/${listingId}`, { body: { amount } });
      toast(`Скидку получили ${r.sent} ${plural(r.sent, "человек", "человека", "человек")}`);
      setOpen(false);
      void mutate();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.amount ?? e.message) : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  if (data.nextAt) {
    return <p className="text-sm text-muted">Скидку лайкнувшим можно отправить снова {new Date(data.nextAt).toLocaleDateString("ru", { day: "numeric", month: "long" })}</p>;
  }

  return (
    <>
      <Button variant="secondary" block onClick={() => setOpen(true)}>
        ♡ Скидка лайкнувшим · {data.count}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Скидка тем, кто сохранил вещь">
        <p className="text-sm text-ink-2">
          {data.count} {plural(data.count, "человек получит", "человека получат", "человек получат")} личное предложение — его можно принять в один клик в течение 48 часов. Цена для остальных не меняется.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => (setPercent(p), setCustom(""))}
              aria-pressed={!custom && percent === p}
              className={!custom && percent === p ? "rounded-full bg-ink px-4 py-2 text-sm font-medium text-white" : "rounded-full border border-line-strong px-4 py-2 text-sm hover:border-ink"}
            >
              −{p}%
            </button>
          ))}
        </div>
        <div className="mt-4">
          <Field label="Цена для лайкнувших, BYN" error={error ?? undefined} hint={`Сейчас ${formatPrice(price)}. Не ниже ${formatPrice(Math.ceil(price / 2))}`}>
            <Input inputMode="numeric" value={custom || String(amount)} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 6))} error={error ?? undefined} className="max-w-40" />
          </Field>
        </div>
        <Button block size="lg" className="mt-5" loading={sending} disabled={!amount || amount >= price} onClick={send}>
          Отправить {formatPrice(amount)}
        </Button>
        <p className="mt-2 text-center text-xs text-muted">Отправлять можно раз в 3 дня</p>
      </Modal>
    </>
  );
}
