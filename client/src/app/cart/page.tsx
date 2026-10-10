"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { RequireAuth } from "@/components/require-auth";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { ManekiNeko } from "@/components/shop/maneki-neko";
import { Badge, Button, ButtonLink, EmptyState, ErrorState, Field, IconX, Input, OptionCard, PriceTag, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CONDITION_LABEL, DELIVERY_WAY, type DeliveryWay, deliveryWays, formatPrice, items as itemsLabel, plural } from "@/lib/labels";
import type { CartGroup, Deal, Me } from "@/lib/types";

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
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">
        Корзина{data && data.count > 0 && <span className="ml-2 text-xl font-normal text-muted">· {itemsLabel(data.count)}</span>}
      </h1>
      {data && data.groups.length > 1 && <p className="mt-2 text-ink-2">Вещи от {data.groups.length} {plural(data.groups.length, "продавца", "продавцов", "продавцов")} — запросы уйдут каждому отдельно.</p>}

      {sent.length > 0 && (
        <div className="mt-6 rounded-2xl bg-ok-soft p-4 text-sm text-ok">
          {sent.length === 1 ? "Запрос отправлен продавцу." : `Отправлено запросов: ${sent.length}.`} Мы сообщим, когда продавец ответит.{" "}
          {sent.length === 1 ? (
            <Link href={sent[0].threadId ? `/messages/${sent[0].threadId}` : `/deals/${sent[0].id}`} className="font-semibold underline">
              Открыть переписку
            </Link>
          ) : (
            <Link href="/purchases" className="font-semibold underline">
              Мои покупки
            </Link>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-col gap-10">
        {!data ? (
          [0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-3xl" />)
        ) : data.groups.length === 0 ? (
          <EmptyState art={<ManekiNeko className="mb-2 h-44" />} title="Корзина пуста" hint="Собирайте вещи одного продавца в один запрос — так проще договориться о передаче">
            <ButtonLink href="/">Смотреть вещи</ButtonLink>
          </EmptyState>
        ) : (
          data.groups.map((g, i) => (
            <SellerGroup
              index={i}
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

function SellerGroup({ group: g, me, index, onRemove, onSent }: { group: CartGroup; me: Me; index: number; onRemove: (id: string) => void; onSent: (d: Deal) => void }) {
  const [method, setMethod] = useState<DeliveryWay | null>(null);
  const [point, setPoint] = useState("");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const ways = deliveryWays(g.deliveryOptions);
  const chosen = method ?? ways[0] ?? null;
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
    <section className="rise grid grid-cols-1 gap-6 border-t border-line pt-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10" style={{ animationDelay: `${index * 80}ms` }}>
      <div className="min-w-0">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">
          <Link href={`/u/${g.seller.username}`} className="hover:underline">
            @{g.seller.username}
          </Link>
          {g.seller.city && <span className="ml-2 text-sm font-normal text-muted">{g.seller.city}</span>}
        </h2>
        <span className="tabular text-lg font-semibold">
          {g.discountPercent > 0 && <s className="mr-2 text-sm font-normal text-muted">{g.subtotal}</s>}
          {formatPrice(g.total)}
        </span>
      </div>
      {(g.discountPercent > 0 || g.nextTier) && (
        <p className={clsx("mb-3 rounded-xl px-4 py-2.5 text-sm", g.discountPercent > 0 ? "bg-ok-soft text-ok" : "bg-kraft/60")}>
          {g.discountPercent > 0 && (
            <b className="font-semibold">
              Скидка за комплект −{g.discountPercent}%: −{formatPrice(g.discount)}.{" "}
            </b>
          )}
          {g.nextTier && (
            <>
              Добавьте ещё {itemsLabel(g.nextTier.needItems)} от @{g.seller.username} — скидка {g.nextTier.percent}%.{" "}
              <Link href={`/u/${g.seller.username}`} className="underline underline-offset-4">
                В гардероб
              </Link>
            </>
          )}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {g.items.map((i) => (
          <li key={i.id} className={clsx("pop flex gap-4 rounded-2xl bg-surface p-3", i.status !== "PUBLISHED" && "opacity-70")}>
            <Link href={`/item/${i.id}`} className="w-18 shrink-0 overflow-hidden rounded-xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.cover && <img src={i.cover.urls.s} alt="" width={72} height={90} className="size-full object-contain" />}
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/item/${i.id}`} className="block truncate font-medium hover:underline">
                {i.title}
              </Link>
              <p className="text-sm text-ink-2">{[i.size, i.condition && CONDITION_LABEL[i.condition]].filter(Boolean).join(" · ")}</p>
              <p className="tabular mt-1 font-semibold">{formatPrice(i.price)}</p>
              {i.status !== "PUBLISHED" && <StatusBadge status={i.status} className="mt-1" />}
            </div>
            <button aria-label={`Убрать «${i.title}» из корзины`} onClick={() => onRemove(i.id)} className="grid size-9 shrink-0 place-items-center self-start rounded-full text-ink-2 hover:bg-ink/5">
              <IconX className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
      {available.length === 0 ? (
        <p className="text-sm text-muted">Эти вещи сейчас недоступны для покупки.</p>
      ) : !ways.length ? (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">У этих вещей нет общего способа получения — купите их по отдельности.</p>
      ) : !open ? (
        <div className="flex flex-col gap-4 rounded-3xl bg-surface p-5 shadow-[var(--shadow-paper)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-ink-2">Итого</span>
            <PriceTag>{formatPrice(g.total)}</PriceTag>
          </div>
          <Button size="lg" block onClick={() => setOpen(true)}>
            Запросить покупку · {itemsLabel(available.length)}
          </Button>
        </div>
      ) : (
        <form
          className="rise flex flex-col gap-5 rounded-3xl bg-surface p-4 shadow-[var(--shadow-paper)] md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset>
            <legend className="mb-2 font-medium">Способ получения</legend>
            {ways.length === 1 ? (
              // One way only: a fact, not a choice.
              <OptionCard fixed seal={DELIVERY_WAY[ways[0]].seal} title={DELIVERY_WAY[ways[0]].only} hint={DELIVERY_WAY[ways[0]].hint} />
            ) : (
              <div role="radiogroup" aria-label="Способ получения" className="grid grid-cols-2 gap-2">
                {ways.map((d) => (
                  <OptionCard key={d} name={`delivery-${g.seller.id}`} checked={chosen === d} onChange={() => setMethod(d)} seal={DELIVERY_WAY[d].seal} title={DELIVERY_WAY[d].title} hint={d === "IN_PERSON" ? "Обсудите в чате" : "Оплачивается отдельно"} />
                ))}
              </div>
            )}
          </fieldset>
          {chosen === "DELIVERY" && (
            <Field label="Город и адрес доставки" htmlFor={`point-${g.seller.id}`} required error={fields.deliveryPoint}>
              <Input id={`point-${g.seller.id}`} name="deliveryPoint" autoComplete="street-address" value={point} onChange={(e) => setPoint(e.target.value)} error={fields.deliveryPoint} placeholder="Минск, ул. Притыцкого, 29, кв. 12" />
            </Field>
          )}
          <Field label="Телефон для связи" htmlFor={`phone-${g.seller.id}`} hint="Покажем продавцу только после подтверждения">
            <Input id={`phone-${g.seller.id}`} name="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Комментарий продавцу" htmlFor={`comment-${g.seller.id}`} hint={`Придёт продавцу первым сообщением в чате · ${comment.length}/300`}>
            <Textarea id={`comment-${g.seller.id}`} maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-20" />
          </Field>
          {g.discountPercent > 0 && (
            <div className="flex items-baseline justify-between text-sm text-ok">
              <span>Скидка за комплект −{g.discountPercent}%</span>
              <span className="tabular">−{formatPrice(g.discount)}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-ink-2">
              К оплате
              <span className="block text-sm text-muted">при получении</span>
            </span>
            <PriceTag>{formatPrice(g.total)}</PriceTag>
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
      </div>
    </section>
  );
}
