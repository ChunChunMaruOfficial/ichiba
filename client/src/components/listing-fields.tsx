"use client";

import { DeliveryLabel } from "./delivery-label";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { type AiField, type AiState, type ListingValues, markEdited, type PhotoDraft } from "@/lib/listing-form";
import type { Meta, SizeSystem } from "@/lib/types";
import { BrandPicker } from "./brand-picker";
import { MeasureFields, measureKind } from "./measure-guide";
import { Nefuda } from "./shop/nefuda";
import { Button, Chip, Field, IconSparkle, Input, OptionCard, Seal, SEALS, type SealKind, Textarea } from "./ui";
import { Select } from "./select";

/** Condition as the rank stamp of a Japanese second-hand shop: 新 new, 美 as new, 良 good, 並 ordinary wear. */
const CONDITION_GRADE = { NEW_WITH_TAGS: "新", LIKE_NEW: "美", GOOD: "良", VISIBLE_WEAR: "並" } as const;

type GridSystem = Exclude<SizeSystem, "OTHER">;
const SIZE_SYSTEM_LABEL: Record<GridSystem, string> = { ALPHA: "Международный", RU: "Российский", SHOE_EU: "Обувь EU", JEANS_W: "Джинсы W" };

export interface FieldsProps {
  values: ListingValues;
  set: (patch: Partial<ListingValues>) => void;
  ai: AiState;
  setAi: (ai: AiState) => void;
  errors: Record<string, string>;
  meta: Meta;
  photos: PhotoDraft[];
  setPhotos: (update: (prev: PhotoDraft[]) => PhotoDraft[]) => void;
  /** Fields frozen during a deal (frame 10 EDIT ITEM). */
  locked?: boolean;
  mode: "create" | "edit";
}

const lockedHint = (locked?: boolean) => (locked ? "Идёт сделка — поле нельзя изменить" : undefined);

/** Fields AI may have filled: editing one marks it as the seller's own (the AI value stays for analytics). */
function useAiSetter({ set, ai, setAi }: Pick<FieldsProps, "set" | "ai" | "setAi">) {
  return (field: AiField, patch: Partial<ListingValues>, value: unknown) => {
    set(patch);
    setAi(markEdited(ai, field, value));
  };
}

/** What the thing is: category, who it's for, title, brand. */
export function ItemFields(props: FieldsProps) {
  const { values, set, errors, meta, locked } = props;
  const setAiValue = useAiSetter(props);
  const category = meta.categories.find((c) => c.slug === values.category);
  return (
    <>
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
        <Field label="Категория" required error={errors.category}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              aria-label="Категория"
              value={values.category ?? ""}
              onChange={(v) => {
                const c = v || null;
                setAiValue("category", { category: c, subcategory: null, sizeValue: null, sizeSystem: null }, c);
              }}
              error={errors.category}
              options={[{ value: "", label: "Выберите" }, ...meta.categories.map((c) => ({ value: c.slug, label: c.label }))]}
            />
            <Select
              aria-label="Подкатегория"
              value={values.subcategory ?? ""}
              disabled={!category}
              onChange={(v) => setAiValue("subcategory", { subcategory: v || null }, v || null)}
              options={[{ value: "", label: "Подкатегория" }, ...(category?.subcategories ?? []).map((s) => ({ value: s.slug, label: s.label }))]}
            />
          </div>
        </Field>
        <Field label="Для кого">
          <div className="flex flex-wrap gap-2">
            {meta.genders.map((g) => (
              <Chip key={g.value} disabled={locked} active={values.gender === g.value} onClick={() => set({ gender: values.gender === g.value ? null : g.value })}>
                {g.label}
              </Chip>
            ))}
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
        <Field label="Название" required error={errors.title} hint={`${values.title.length}/80`}>
          <Input maxLength={80} value={values.title} onChange={(e) => setAiValue("title", { title: e.target.value }, e.target.value)} error={errors.title} placeholder="Чёрная кожаная куртка Zara" />
        </Field>
        <Field label="Бренд" htmlFor="listing-brand">
          <BrandPicker id="listing-brand" value={values.brand} onChange={(brand) => setAiValue("brand", { brand }, brand)} />
          {!values.brand.trim() && <BrandFromTitle title={values.title} onPick={(brand) => setAiValue("brand", { brand }, brand)} />}
        </Field>
      </div>
    </>
  );
}

/** Size, condition and defects. */
export function SizeConditionFields({ values, set, errors, meta, photos, setPhotos, locked }: FieldsProps) {
  const category = meta.categories.find((c) => c.slug === values.category);
  const systems = (category?.sizeSystems ?? []).filter((s): s is GridSystem => s !== "OTHER");
  const activeSystem = systems.find((s) => s === values.sizeSystem) ?? systems[0];
  const sizeList = (s: GridSystem) => meta.sizes[s];
  // «Несколько размеров»: chips pick several sizes of one listing; the buyer chooses one when buying.
  const [multi, setMulti] = useState(values.sizes.length > 1);
  const pick = (system: GridSystem, s: string) => {
    if (!multi) return set({ sizeSystem: system, sizeValue: s, sizes: [] });
    const order = sizeList(system);
    const next = (values.sizes.includes(s) ? values.sizes.filter((x) => x !== s) : [...values.sizes, s]).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    set({ sizeSystem: system, sizes: next, sizeValue: next[0] ?? null });
  };
  const toggleMulti = () => {
    const on = !multi;
    setMulti(on);
    if (on) set({ sizes: values.sizeValue && values.sizeSystem !== "OTHER" ? [values.sizeValue] : [] });
    else set({ sizes: [], sizeValue: values.sizes[0] ?? values.sizeValue });
  };

  return (
    <>
      {systems.length > 0 && activeSystem ? (
        // Only the grids: a size is picked, never typed (free text once let anything through as a «size»).
        <Field label="Размер" required error={errors.size} hint={lockedHint(locked)}>
          {systems.length > 1 && (
            <div className="flex gap-4 text-sm">
              {systems.map((s) => (
                <button key={s} type="button" disabled={locked} onClick={() => set({ sizeSystem: s, sizeValue: null, sizes: [] })} className={clsx(activeSystem === s ? "font-semibold underline underline-offset-4" : "text-ink-2")}>
                  {SIZE_SYSTEM_LABEL[s]}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {sizeList(activeSystem).map((s) => (
              <Chip key={s} disabled={locked} active={values.sizeSystem === activeSystem && (multi ? values.sizes.includes(s) : values.sizeValue === s)} onClick={() => pick(activeSystem, s)} className="min-w-12 justify-center">
                {s}
              </Chip>
            ))}
          </div>
          <label className={clsx("mt-1 flex items-center gap-2.5 text-sm", locked && "opacity-60")}>
            <input type="checkbox" className="size-4 accent-[var(--accent)]" disabled={locked} checked={multi} onChange={toggleMulti} />
            <span>
              Несколько размеров
              <span className="block text-xs text-muted">
                {multi ? (values.sizes.length > 1 ? `В наличии: ${values.sizes.join(" · ")} — покупатель выберет свой. Размер закончился — снимите его здесь` : "Отметьте все размеры, что есть в наличии") : "Одна модель в разных размерах — одним объявлением"}
              </span>
            </span>
          </label>
        </Field>
      ) : (
        <p className="text-sm text-muted">Сначала выберите категорию — появятся размеры</p>
      )}

      <Field label="Состояние" required error={errors.condition} hint={lockedHint(locked)}>
        <div role="radiogroup" aria-label="Состояние" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {meta.conditions.map((c, i) => (
            <OptionCard
              key={c.value}
              name="condition"
              checked={values.condition === c.value}
              onChange={() => set({ condition: c.value, ...(c.value === "NEW_WITH_TAGS" ? {} : { hasTags: null }) })}
              disabled={locked}
              seal={CONDITION_GRADE[c.value as keyof typeof CONDITION_GRADE] ?? "品"}
              title={c.label}
              hint={c.hint}
              // wear scale: how much of the life is used, new → worn
              aside={
                <span aria-hidden className="flex gap-1">
                  {[0, 1, 2, 3].map((d) => (
                    <span key={d} className={clsx("h-1.5 w-3 rounded-full", d <= i ? "bg-current opacity-70" : "bg-current opacity-15")} />
                  ))}
                </span>
              }
            />
          ))}
        </div>
      </Field>

      {values.condition === "NEW_WITH_TAGS" && (
        <Field label="Бирка" required error={errors.hasTags} hint={lockedHint(locked)}>
          <div className="flex gap-2">
            <Chip disabled={locked} active={values.hasTags === true} onClick={() => set({ hasTags: true })}>
              Есть
            </Chip>
            <Chip disabled={locked} active={values.hasTags === false} onClick={() => set({ hasTags: false })}>
              Нет
            </Chip>
          </div>
        </Field>
      )}

      <Field label="Дефекты" required error={errors.defects} hint={lockedHint(locked)}>
        <div className="flex gap-2">
          <Chip disabled={locked} active={values.defectsPresent === false} onClick={() => set({ defectsPresent: false })}>
            Нет
          </Chip>
          <Chip disabled={locked} active={values.defectsPresent === true} onClick={() => set({ defectsPresent: true })}>
            Есть
          </Chip>
        </div>
        {values.defectsPresent && (
          <div className="rise mt-2 flex flex-col gap-3">
            <Textarea aria-label="Опишите дефекты" placeholder="Например: небольшая затяжка на левом рукаве" disabled={locked} value={values.defectsDescription} onChange={(e) => set({ defectsDescription: e.target.value })} error={errors.defectsDescription} className="min-h-20" />
            {errors.defectsDescription && <p className="text-sm text-danger">{errors.defectsDescription}</p>}
            {photos.filter((p) => p.status === "done").length > 1 && (
              <div>
                <p className="mb-2 text-sm text-ink-2">На каком фото видно дефект?</p>
                <div className="flex flex-wrap gap-2">
                  {photos.map((p, i) =>
                    p.status === "done" && i > 0 ? (
                      <button
                        key={p.key}
                        type="button"
                        aria-pressed={p.isDefect}
                        onClick={() => setPhotos((prev) => prev.map((x) => (x.key === p.key ? { ...x, isDefect: !x.isDefect } : x)))}
                        className={clsx("relative h-16 w-13 overflow-hidden rounded-lg border-2", p.isDefect ? "border-amber" : "border-transparent opacity-70")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.preview} alt={`Фото ${i + 1}`} className="size-full object-contain" />
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Field>
    </>
  );
}

/** "Бренд в названии: Nike — указать" when the title names a catalogue brand and the brand field is empty. */
function BrandFromTitle({ title, onPick }: { title: string; onPick: (brand: string) => void }) {
  const [found, setFound] = useState<{ title: string; brand: string | null } | null>(null);
  useEffect(() => {
    const text = title.trim();
    if (text.length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ brand: string | null }>(`/brands/detect?text=${encodeURIComponent(text)}`, { signal: ctrl.signal })
        .then((r) => setFound({ title: text, brand: r.brand }))
        .catch(() => {});
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [title]);
  if (!found?.brand || found.title !== title.trim()) return null;
  return (
    <button type="button" onClick={() => onPick(found.brand!)} className="pop mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-sm text-accent hover:brightness-95">
      В названии бренд <span className="font-semibold">{found.brand}</span> — указать
    </button>
  );
}

/** Colour, material, measurements and the description. */
export function DetailFields(props: FieldsProps) {
  const { values, set, ai, setAi, errors, meta } = props;
  const setAiValue = useAiSetter(props);
  const [regenerating, setRegenerating] = useState(false);

  const regenerate = async () => {
    setRegenerating(true);
    const defects = values.defectsPresent ? values.defectsDescription : null;
    const r = await api<{ description: string | null }>("/ai/describe", {
      body: { title: values.title || "Вещь", category: values.category, brand: values.brand || null, color: values.color, size: values.sizeValue, condition: values.condition, defects, material: values.material },
    }).catch(() => ({ description: null }));
    setRegenerating(false);
    if (r.description) {
      set({ description: r.description });
      setAi({ ...ai, description: { value: r.description, confidence: 1, accepted_by_user: true, edited_by_user: false } });
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Field label="Цвет">
          <div className="flex flex-wrap gap-2">
            {meta.colors.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={values.color === c.value}
                onClick={() => setAiValue("color", { color: values.color === c.value ? null : c.value }, c.value)}
                className={clsx("flex items-center gap-2 rounded-full border bg-surface py-1 pl-1 pr-3 text-sm transition-transform duration-200 hover:-translate-y-0.5", values.color === c.value ? "border-ink" : "border-line")}
              >
                <span className="size-6 rounded-full border border-black/10" style={{ background: c.hex }} />
                {c.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Материал">
          <Select aria-label="Материал" value={values.material ?? ""} onChange={(v) => set({ material: v || null })} options={[{ value: "", label: "Не указан" }, ...meta.materials.map((m) => ({ value: m, label: m }))]} />
        </Field>
      </div>

      {measureKind(values.category) && (
        <Field label="Замеры, см">
          <MeasureFields values={values} set={set} />
        </Field>
      )}

      <Field label="Описание" htmlFor="listing-description" error={errors.description} hint={`${values.description.length}/2000`}>
        <Textarea id="listing-description" maxLength={2000} value={values.description} onChange={(e) => setAiValue("description", { description: e.target.value }, e.target.value)} className="min-h-32" placeholder="Фасон, посадка, детали…" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" loading={regenerating} onClick={regenerate} disabled={!values.title}>
            <IconSparkle className="size-4" /> {values.description ? "Переписать" : "Написать за меня"}
          </Button>
        </div>
      </Field>
    </>
  );
}

/** Where the seller is and how the thing changes hands. */
export function HandoverFields({ values, set, errors, meta }: FieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
      <Field label="Город">
        <Select aria-label="Город" value={values.city ?? ""} onChange={(v) => set({ city: v || null })} options={[{ value: "", label: "Не указан" }, ...meta.cities.map((c) => ({ value: c, label: c }))]} />
      </Field>
      <Field label="Способ передачи" required error={errors.deliveryOptions}>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["IN_PERSON", "Передача лично"],
              ["DELIVERY", "Доставка"],
            ] as const
          ).map(([v, label]) => (
            <Chip key={v} active={values.deliveryOptions.includes(v)} onClick={() => set({ deliveryOptions: values.deliveryOptions.includes(v) ? values.deliveryOptions.filter((x) => x !== v) : [...values.deliveryOptions, v] })}>
              {v === "DELIVERY" ? <DeliveryLabel method="DELIVERY" /> : label}
            </Chip>
          ))}
        </div>
      </Field>
    </div>
  );
}

export function PriceFields({
  values,
  set,
  errors,
  locked,
  auctionLocked,
  market,
}: Pick<FieldsProps, "values" | "set" | "errors" | "locked"> & { auctionLocked?: boolean; market?: { recommended: number; low: number; high: number } | null }) {
  const auction = values.saleType === "AUCTION";
  const negotiable = !auction && values.priceNegotiable;
  const price = Number(values.price) || 0;
  const autoStep = price ? Math.max(1, Math.round(price * 0.05)) : null;
  return (
    <div className="flex flex-col gap-7">
      {/* The price is written on the shop's paper tag itself; how it's sold is chosen beside it. */}
      <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3" data-error={errors.price ? "" : undefined}>
          <label className={clsx("block pl-8 text-[56px] font-bold md:text-[64px]", (locked || auctionLocked) && "opacity-60")}>
            <Nefuda className={clsx("tabular w-full [&>span:last-child]:flex-1", errors.price && "[&>span:last-child]:shadow-[inset_0_0_0_2px_var(--danger)]")}>
              <span className="flex w-full flex-col gap-1.5 py-[0.28em]">
                <span className="text-[13px] font-semibold uppercase tracking-[0.18em] opacity-60">
                  {auction ? "Стартовая цена" : "Цена"}
                  <span className="text-danger"> ★</span>
                </span>
                {negotiable ? (
                  <span className="text-[0.5em] leading-[1.6]">Договорная</span>
                ) : (
                <span className="flex items-baseline gap-2">
                  <input
                    inputMode="numeric"
                    disabled={locked || auctionLocked}
                    value={values.price}
                    onChange={(e) => set({ price: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    placeholder="0"
                    aria-label={auction ? "Стартовая цена, BYN" : "Цена, BYN"}
                    aria-invalid={!!errors.price}
                    style={{ width: `${Math.max(values.price.length, 1) + 0.4}ch` }}
                    className="min-w-0 bg-transparent text-inherit outline-none placeholder:text-kraft-ink/30"
                  />
                  <span className="text-[0.45em] opacity-70">BYN</span>
                </span>
                )}
              </span>
            </Nefuda>
          </label>
          {!auction && (
            <label className={clsx("flex items-center gap-2.5 pl-8 text-sm", (locked || auctionLocked) && "opacity-60")}>
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                disabled={locked || auctionLocked}
                checked={values.priceNegotiable}
                onChange={(e) => set({ priceNegotiable: e.target.checked, ...(e.target.checked ? { acceptsOffers: true } : {}) })}
              />
              <span>
                Цена договорная
                <span className="block text-xs text-muted">Покупатели предложат свою цену или напишут вам</span>
              </span>
            </label>
          )}
          {errors.price ? (
            <p className="pl-8 text-sm text-danger">{errors.price}</p>
          ) : locked ? (
            <p className="pl-8 text-sm text-muted">Идёт сделка — цену нельзя изменить</p>
          ) : (
            market &&
            !auctionLocked &&
            !negotiable && (
              <p className="pop pl-8 text-sm text-muted">
                Рыночная цена:{" "}
                <button type="button" onClick={() => set({ price: String(market.recommended) })} className="tabular font-semibold text-ink underline decoration-dotted underline-offset-4 hover:text-indigo" title="Поставить эту цену">
                  {market.recommended} BYN
                </button>
                <span className="tabular"> · обычно {market.low}–{market.high} BYN</span>
              </p>
            )
          )}
        </div>

        <fieldset disabled={auctionLocked} className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Как продаём?</legend>
          {(
            [
              ["FIXED", "定", "Фиксированная цена", "«Купить» или предложение цены"],
              ["AUCTION", "競", "Аукцион", "Ставки, вещь уйдёт тому, кто больше"],
            ] as const
          ).map(([v, seal, label, hint]) => (
            <OptionCard key={v} name="saleType" checked={values.saleType === v} onChange={() => set({ saleType: v })} disabled={auctionLocked} seal={seal} title={label} hint={hint} />
          ))}
          {auctionLocked && <p className="col-span-2 mt-1 text-sm text-muted">Идёт аукцион — условия торгов менять нельзя.</p>}
        </fieldset>
      </div>

      {auction ? (
        <div className="rise flex flex-col gap-6 rounded-2xl bg-surface p-4 md:p-5">
          <Field label="Длительность">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  [24, "1 день"],
                  [72, "3 дня"],
                  [168, "7 дней"],
                ] as const
              ).map(([h, label]) => (
                <Chip key={h} disabled={auctionLocked} active={values.auctionHours === h} onClick={() => set({ auctionHours: h })}>
                  {label}
                </Chip>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Field label="Шаг ставки, BYN" error={errors.auctionStep} hint={autoStep ? `По умолчанию ${autoStep} BYN` : undefined}>
              <Input inputMode="numeric" disabled={auctionLocked} value={values.auctionStep} onChange={(e) => set({ auctionStep: e.target.value.replace(/\D/g, "") })} error={errors.auctionStep} placeholder={autoStep ? String(autoStep) : ""} />
            </Field>
            <Field label="Резервная цена" error={errors.auctionReserve} hint="Не видна покупателям">
              <Input inputMode="numeric" disabled={auctionLocked} value={values.auctionReserve} onChange={(e) => set({ auctionReserve: e.target.value.replace(/\D/g, "") })} error={errors.auctionReserve} placeholder="Необязательно" />
            </Field>
            <Field label="Цена «Купить сейчас», BYN" error={errors.auctionBuyNow}>
              <Input inputMode="numeric" disabled={auctionLocked} value={values.auctionBuyNow} onChange={(e) => set({ auctionBuyNow: e.target.value.replace(/\D/g, "") })} error={errors.auctionBuyNow} placeholder="Необязательно" />
            </Field>
          </div>
        </div>
      ) : negotiable ? null : (
        <div className="rounded-2xl bg-surface p-4 md:p-5">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block font-medium">Готовы торговаться?</span>
                          </span>
            <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={values.acceptsOffers} onChange={(e) => set({ acceptsOffers: e.target.checked })} />
          </label>
          {values.acceptsOffers && (
            <div className="rise mt-4">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Автоотказ ниже, BYN" error={errors.minOfferPrice}>
                  <Input inputMode="numeric" value={values.minOfferPrice} onChange={(e) => set({ minOfferPrice: e.target.value.replace(/\D/g, "") })} error={errors.minOfferPrice} placeholder="Необязательно" />
                </Field>
                <Field label="Автопринятие от, BYN" error={errors.autoAcceptPrice}>
                  <Input inputMode="numeric" value={values.autoAcceptPrice} onChange={(e) => set({ autoAcceptPrice: e.target.value.replace(/\D/g, "") })} error={errors.autoAcceptPrice} placeholder="Необязательно" />
                </Field>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * «Печати» (brands only): which seals go on the item's card — бренд, новинка, хит, оригинал. Each tile shows the seal
 * itself; picked, it is pressed in and the tile is inked. One at most: tap it again to take it off.
 */
export function LabelFields({ values, set }: Pick<FieldsProps, "values" | "set">) {
  const toggle = (k: SealKind) => set({ labels: values.labels.includes(k) ? [] : [k] });
  const hints: Record<SealKind, string> = {
    brand: "Вещь вашего бренда",
    new: "Свежая коллекция или дроп",
    hit: "То, что берут чаще всего",
    original: "Подлинник с бирками",
  };
  return (
    <Field label="Печати на карточке" hint="Одна печать в углу фото — или без неё">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(SEALS) as SealKind[]).map((k) => {
          const on = values.labels.includes(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(k)}
              className={clsx(
                "flex flex-col items-center gap-3 rounded-[18px] border bg-surface px-3 pb-3 pt-4 text-center transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5",
                on ? "border-ink shadow-[0_6px_16px_-10px_rgb(0_0_0/0.5)]" : "border-line",
              )}
            >
              <span className={clsx("grid h-16 place-items-center transition-[filter,opacity] duration-300", !on && "opacity-45 grayscale")}>
                {/* Keyed on «on»: picking it presses the seal in again. */}
                <Seal key={String(on)} kind={k} />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">{SEALS[k].label}</span>
                <span className="mt-0.5 block text-xs text-ink-2">{hints[k]}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}
