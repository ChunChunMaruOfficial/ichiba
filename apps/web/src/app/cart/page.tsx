"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { RequireAuth } from "@/components/require-auth";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Badge, Button, ButtonLink, EmptyState, ErrorState, Field, IconX, Input, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CONDITION_LABEL, DELIVERY_LABEL, formatPrice, items as itemsLabel, plural } from "@/lib/labels";
import type { CartGroup, Deal, DeliveryMethod, Me } from "@/lib/types";

export default function CartPage() {
  return <RequireAuth reason="чтобы открыть корзину">{(me) => <Cart me={me} />}</RequireAuth>;
}

/** Cart (frame 12): grouped by seller, one buy request per seller, no quantities or coupons. */
function Cart({ me }: { me: Me }) {
  const { data, error, mutate } = useSWR<{ groups: CartGroup[]; count: number }>("/cart");
  const { refresh } = useSession();
  const toast = useToast();
  const [sent, setSent] = useState<Deal[]>([]);

  const remove = async (listingId: string) => {
    await mutate((d) => d && { ...d, groups: d.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== listingId) })).filter((g) => g.items.length) }, { revalidate: false });
    try {
      await api(`/cart/${listingId}`, { method: "DELETE" });
      void refresh();
    } catch {
      toast("Не удалось удалить", { tone: "error" });
      void mutate();
    }
  };

  if (error) return <ErrorState message="Не удалось загрузить корзину" onRetry={() => mutate()} />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">
        Корзина{data && data.count > 0 && <span className="ml-2 text-xl font-normal text-muted">· {itemsLabel(data.count)}</span>}
      </h1>
      {data && data.groups.length > 1 && <p className="mt-2 text-ink-2">Вещи от {data.groups.length} {plural(data.groups.length, "продавца", "продавцов", "продавцов")} — запросы уйдут каждому отдельно.</p>}

      {sent.length > 0 && (
        <div className="mt-6 rounded-2xl bg-ok-soft p-4 text-sm text-ok">
          {sent.length === 1 ? "Запрос отправлен продавцу." : `Отправлено запросов: ${sent.length}.`} Мы сообщим, когда продавец ответит.{" "}
          <Link href="/purchases" className="font-semibold underline">
            Мои покупки
          </Link>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-10">
        {!data ? (
          [0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-3xl" />)
        ) : data.groups.length === 0 ? (
          <EmptyState title="Корзина пуста" hint="Собирайте вещи одного продавца в один запрос — так проще договориться о передаче">
            <ButtonLink href="/">Смотреть вещи</ButtonLink>
          </EmptyState>
        ) : (
          data.groups.map((g) => (
            <SellerGroup
              key={g.seller.id}
              group={g}
              me={me}
              onRemove={remove}
              onSent={(d) => {
                setSent((s) => [...s, d]);
                void mutate();
                void refresh();
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SellerGroup({ group: g, me, onRemove, onSent }: { group: CartGroup; me: Me; onRemove: (id: string) => void; onSent: (d: Deal) => void }) {
  const [method, setMethod] = useState<DeliveryMethod | null>(null);
  const [point, setPoint] = useState("");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const chosen = method ?? g.deliveryOptions[0] ?? null;
  const available = g.items.filter((i) => i.status === "PUBLISHED");

  const submit = async () => {
    if (!chosen) return;
    setBusy(true);
    setFields({});
    setError(null);
    try {
      const d = await api<Deal>("/requests", {
        body: { listingIds: available.map((i) => i.id), deliveryMethod: chosen, deliveryPoint: chosen === "DELIVERY" ? point : null, contactPhone: phone || null, buyerComment: comment || null },
      });
      onSent(d);
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(e.fields);
        setError(Object.keys(e.fields).length ? null : e.message);
      } else setError("Не удалось отправить запрос. Проверьте соединение");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-line pt-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">
          <Link href={`/u/${g.seller.username}`} className="hover:underline">
            @{g.seller.username}
          </Link>
          {g.seller.city && <span className="ml-2 text-sm font-normal text-muted">{g.seller.city}</span>}
        </h2>
        <span className="tabular text-lg font-semibold">{formatPrice(g.total)}</span>
      </div>
      <ul className="flex flex-col gap-3">
        {g.items.map((i) => (
          <li key={i.id} className={clsx("flex gap-4 rounded-2xl bg-surface p-3", i.status !== "PUBLISHED" && "opacity-70")}>
            <Link href={`/item/${i.id}`} className="w-18 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.cover && <img src={i.cover.urls.s} alt="" width={72} height={90} className="size-full object-cover" />}
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/item/${i.id}`} className="block truncate font-medium hover:underline">
                {i.title}
              </Link>
              <p className="text-sm text-ink-2">{[i.size, i.condition && CONDITION_LABEL[i.condition]].filter(Boolean).join(" · ")}</p>
              <p className="tabular mt-1 font-semibold">{formatPrice(i.price)}</p>
              {i.status !== "PUBLISHED" && <StatusBadge status={i.status} className="mt-1" />}
            </div>
            <button aria-label={`Убрать «${i.title}» из корзины`} onClick={() => onRemove(i.id)} className="grid size-9 shrink-0 place-items-center self-start rounded-full text-ink-2 hover:bg-black/5">
              <IconX className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      {available.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Эти вещи сейчас недоступны для покупки.</p>
      ) : !g.deliveryOptions.length ? (
        <p className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">У этих вещей нет общего способа получения — купите их по отдельности.</p>
      ) : !open ? (
        <Button size="lg" block className="mt-5" onClick={() => setOpen(true)}>
          Запросить покупку · {itemsLabel(available.length)}
        </Button>
      ) : (
        <form
          className="mt-6 flex flex-col gap-5 rounded-2xl bg-surface p-4 md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset>
            <legend className="mb-2 font-medium">Способ получения</legend>
            <div className="flex flex-wrap gap-2">
              {g.deliveryOptions.map((d) => (
                <label key={d} className={clsx("flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm", chosen === d ? "border-ink" : "border-line")}>
                  <input type="radio" name={`delivery-${g.seller.id}`} className="accent-[var(--accent)]" checked={chosen === d} onChange={() => setMethod(d)} />
                  {DELIVERY_LABEL[d]}
                </label>
              ))}
            </div>
          </fieldset>
          {chosen === "DELIVERY" && (
            <Field label="Город и пункт выдачи или адрес" htmlFor={`point-${g.seller.id}`} required error={fields.deliveryPoint}>
              <Input id={`point-${g.seller.id}`} name="deliveryPoint" autoComplete="street-address" value={point} onChange={(e) => setPoint(e.target.value)} error={fields.deliveryPoint} placeholder="Минск, постамат на ул. Притыцкого, 29…" />
            </Field>
          )}
          <Field label="Телефон для связи" htmlFor={`phone-${g.seller.id}`} hint="Покажем продавцу только после подтверждения">
            <Input id={`phone-${g.seller.id}`} name="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Комментарий продавцу" htmlFor={`comment-${g.seller.id}`} hint={`${comment.length}/300`}>
            <Textarea id={`comment-${g.seller.id}`} maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-20" />
          </Field>
          <div className="flex items-baseline justify-between">
            <span className="text-ink-2">К оплате при получении</span>
            <span className="tabular text-xl font-semibold">{formatPrice(g.total)}</span>
          </div>
          {error && (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" block loading={busy}>
            {busy ? "Отправляем запрос…" : "Отправить запрос продавцу"}
          </Button>
          <p className="text-xs text-muted">
            <Badge tone="muted">48 ч</Badge> на ответ продавца. До подтверждения вещи не резервируются.
          </p>
        </form>
      )}
    </section>
  );
}
