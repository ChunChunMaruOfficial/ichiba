"use client";

import clsx from "clsx";
import { useState } from "react";
import { api } from "@/lib/api";
import { type AiField, type AiState, type ListingValues, markEdited, type PhotoDraft } from "@/lib/listing-form";
import type { Meta, SizeSystem } from "@/lib/types";
import { Button, Chip, Field, IconChevronDown, IconSparkle, Input, inputClass, Textarea } from "./ui";

/** "AI" badge, or a yellow "check this" hint for 0.5–0.8 confidence (frame 22 UNCERTAINTY). */
function AiMark({ ai, field }: { ai: AiState; field: AiField }) {
  const a = ai[field];
  if (!a || a.edited_by_user) return null;
  if (a.confidence < 0.8) return <span className="ml-2 inline-flex items-center rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">⚠ Не уверен — проверьте</span>;
  return (
    <span className="ml-2 inline-flex items-center gap-0.5 rounded-md bg-ai-soft px-1.5 py-0.5 text-xs font-semibold text-ai">
      <IconSparkle className="size-3" filled /> AI
    </span>
  );
}

const aiFrame = (ai: AiState, field: AiField) => {
  const a = ai[field];
  if (!a || a.edited_by_user) return "";
  return a.confidence < 0.8 ? "!border-[#d9a100] bg-warn-soft/40" : "!border-ai/50";
};

const MEASUREMENTS = [
  ["shoulders", "Плечи"],
  ["chest", "Грудь"],
  ["waist", "Талия"],
  ["length", "Длина"],
  ["sleeve", "Рукав"],
  ["foot_length", "Длина стопы"],
] as const;

const SIZE_SYSTEM_LABEL: Record<SizeSystem, string> = { ALPHA: "Одежда", SHOE_EU: "Обувь EU", JEANS_W: "Джинсы W", OTHER: "Другой" };

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
  /** Edit page shows everything expanded and no AI marks. */
  mode: "create" | "edit";
}

/** The core listing fields (frame 10 STEP 3 — HUMAN CONFIRMATION). */
export function CoreFields({ values, set, ai, setAi, errors, meta, photos, setPhotos, locked }: FieldsProps) {
  const category = meta.categories.find((c) => c.slug === values.category);
  const systems = category?.sizeSystems ?? [];
  const activeSystem = values.sizeSystem && systems.includes(values.sizeSystem) ? values.sizeSystem : systems[0];
  const [otherSize, setOtherSize] = useState(values.sizeSystem === "OTHER");
  const lockedHint = locked ? "Идёт сделка — поле нельзя изменить" : undefined;

  const setAiValue = (field: AiField, patch: Partial<ListingValues>, value: unknown) => {
    set(patch);
    setAi(markEdited(ai, field, value));
  };

  return (
    <div className="flex flex-col gap-7">
      <Field label="Категория" required error={errors.category}>
        <span className="-mt-1">
          <AiMark ai={ai} field="category" />
        </span>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            aria-label="Категория"
            value={values.category ?? ""}
            onChange={(e) => {
              const c = e.target.value || null;
              setAiValue("category", { category: c, subcategory: null, sizeValue: null, sizeSystem: null }, c);
            }}
            className={clsx(inputClass(errors.category), aiFrame(ai, "category"))}
          >
            <option value="">Выберите</option>
            {meta.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Подкатегория"
            value={values.subcategory ?? ""}
            disabled={!category}
            onChange={(e) => setAiValue("subcategory", { subcategory: e.target.value || null }, e.target.value || null)}
            className={clsx(inputClass(), aiFrame(ai, "subcategory"), "disabled:opacity-50")}
          >
            <option value="">Подкатегория</option>
            {category?.subcategories.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </Field>

      {systems.length > 0 && (
        <Field label="Размер" required error={errors.size} hint={lockedHint ?? "Посмотрите на этикетку"}>
          {systems.length > 1 && (
            <div className="flex gap-4 text-sm">
              {systems.map((s) => (
                <button key={s} type="button" disabled={locked} onClick={() => (setOtherSize(false), set({ sizeSystem: s, sizeValue: null }))} className={clsx(activeSystem === s && !otherSize ? "font-semibold underline underline-offset-4" : "text-ink-2")}>
                  {SIZE_SYSTEM_LABEL[s]}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {activeSystem && activeSystem !== "OTHER" &&
              meta.sizes[activeSystem].map((s) => (
                <Chip key={s} disabled={locked} active={!otherSize && values.sizeValue === s} onClick={() => (setOtherSize(false), set({ sizeSystem: activeSystem, sizeValue: s }))} className="min-w-12 justify-center">
                  {s}
                </Chip>
              ))}
            <Chip disabled={locked} active={otherSize} onClick={() => (setOtherSize(true), set({ sizeSystem: "OTHER", sizeValue: null }))}>
              Другой
            </Chip>
          </div>
          {otherSize && <Input aria-label="Свой размер" placeholder="Например, 44 RU или One size" disabled={locked} value={values.sizeValue ?? ""} onChange={(e) => set({ sizeSystem: "OTHER", sizeValue: e.target.value || null })} className="max-w-xs" />}
        </Field>
      )}

      <Field label="Состояние" required error={errors.condition} hint={lockedHint}>
        <div className="grid gap-2 sm:grid-cols-2">
          {meta.conditions.map((c) => (
            <label key={c.value} className={clsx("flex cursor-pointer gap-3 rounded-xl border bg-surface p-3.5", values.condition === c.value ? "border-ink" : "border-line", locked && "cursor-not-allowed opacity-60")}>
              <input type="radio" name="condition" disabled={locked} className="mt-1 accent-[var(--accent)]" checked={values.condition === c.value} onChange={() => set({ condition: c.value })} />
              <span>
                <span className="block font-medium">{c.label}</span>
                <span className="text-sm text-muted">{c.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Дефекты" required error={errors.defects} hint={lockedHint}>
        <div className="flex gap-2">
          <Chip disabled={locked} active={values.defectsPresent === false} onClick={() => set({ defectsPresent: false })}>
            Нет
          </Chip>
          <Chip disabled={locked} active={values.defectsPresent === true} onClick={() => set({ defectsPresent: true })}>
            Есть
          </Chip>
        </div>
        {values.defectsPresent && (
          <div className="mt-2 flex flex-col gap-3">
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
                        className={clsx("relative h-16 w-13 overflow-hidden rounded-lg border-2", p.isDefect ? "border-[#d9a100]" : "border-transparent opacity-70")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.preview} alt={`Фото ${i + 1}`} className="size-full object-cover" />
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Field>

      <Field label="Название" required error={errors.title} hint={`${values.title.length}/80`}>
        <span className="-mt-1">
          <AiMark ai={ai} field="title" />
        </span>
        <Input maxLength={80} value={values.title} onChange={(e) => setAiValue("title", { title: e.target.value }, e.target.value)} error={errors.title} className={aiFrame(ai, "title")} placeholder="Чёрная кожаная куртка Zara" />
      </Field>
    </div>
  );
}

export function MoreFields(props: FieldsProps) {
  const { values, set, ai, setAi, errors, meta, mode } = props;
  const [open, setOpen] = useState(mode === "edit");
  const [regenerating, setRegenerating] = useState(false);
  const setAiValue = (field: AiField, patch: Partial<ListingValues>, value: unknown) => {
    set(patch);
    setAi(markEdited(ai, field, value));
  };

  const regenerate = async () => {
    setRegenerating(true);
    const defects = values.defectsPresent ? values.defectsDescription : null;
    const r = await api<{ description: string | null }>("/ai/describe", {
      body: {
        title: values.title || "Вещь",
        category: values.category,
        brand: values.brand || null,
        color: values.color,
        size: values.sizeValue,
        condition: values.condition,
        defects,
        material: values.material,
      },
    }).catch(() => ({ description: null }));
    setRegenerating(false);
    if (r.description) {
      set({ description: r.description });
      setAi({ ...ai, description: { value: r.description, confidence: 1, accepted_by_user: true, edited_by_user: false } });
    }
  };

  const body = (
    <div className="flex flex-col gap-7">
      <div className="grid gap-7 sm:grid-cols-2">
        <Field label="Бренд" hint={ai.brand && !ai.brand.edited_by_user ? "Определён по логотипу или бирке" : undefined}>
          <span className="-mt-1">
            <AiMark ai={ai} field="brand" />
          </span>
          <Input list="brands" value={values.brand} onChange={(e) => setAiValue("brand", { brand: e.target.value }, e.target.value)} className={aiFrame(ai, "brand")} placeholder="Например, Zara" />
          <datalist id="brands">
            {meta.brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
        <Field label="Материал">
          <select value={values.material ?? ""} onChange={(e) => set({ material: e.target.value || null })} className={inputClass()}>
            <option value="">Не указан</option>
            {meta.materials.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Цвет">
        <span className="-mt-1">
          <AiMark ai={ai} field="color" />
        </span>
        <div className="flex flex-wrap gap-2">
          {meta.colors.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={values.color === c.value}
              onClick={() => setAiValue("color", { color: values.color === c.value ? null : c.value }, c.value)}
              className={clsx("flex items-center gap-2 rounded-full border bg-surface py-1 pl-1 pr-3 text-sm", values.color === c.value ? "border-ink" : "border-line")}
            >
              <span className="size-6 rounded-full border border-black/10" style={{ background: c.hex }} />
              {c.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Замеры, см" hint="Помогают покупателю понять посадку">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {MEASUREMENTS.map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-muted">
              {label}
              <Input inputMode="numeric" value={values.measurements[k] ?? ""} onChange={(e) => set({ measurements: { ...values.measurements, [k]: e.target.value.replace(/[^\d.]/g, "") } })} className="h-10 px-2.5" />
            </label>
          ))}
        </div>
      </Field>

      <Field label="Описание" error={errors.description} hint={`${values.description.length}/2000`}>
        <span className="-mt-1">
          <AiMark ai={ai} field="description" />
        </span>
        <Textarea maxLength={2000} value={values.description} onChange={(e) => setAiValue("description", { description: e.target.value }, e.target.value)} className={aiFrame(ai, "description")} placeholder="Фасон, посадка, детали…" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" loading={regenerating} onClick={regenerate} disabled={!values.title}>
            <IconSparkle className="size-4" /> {values.description ? "Перегенерировать" : "Составить с AI"}
          </Button>
        </div>
      </Field>

      <div className="grid gap-7 sm:grid-cols-2">
        <Field label="Город">
          <select value={values.city ?? ""} onChange={(e) => set({ city: e.target.value || null })} className={inputClass()}>
            <option value="">Не указан</option>
            {meta.cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Способ передачи" required error={errors.deliveryOptions}>
          <div className="flex flex-col gap-2">
            {(
              [
                ["IN_PERSON", "Передача лично"],
                ["PICKUP", "Самовывоз"],
                ["DELIVERY", "Доставка (отправляете сами, вводите трек)"],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex items-center gap-3 text-[15px]">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={values.deliveryOptions.includes(v)}
                  onChange={(e) => set({ deliveryOptions: e.target.checked ? [...values.deliveryOptions, v] : values.deliveryOptions.filter((x) => x !== v) })}
                />
                {label}
              </label>
            ))}
          </div>
        </Field>
      </div>
    </div>
  );

  if (mode === "edit") return body;
  return (
    <div className="rounded-2xl border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3.5 text-left font-medium">
        Ещё детали
        <span className="flex items-center gap-2 text-sm font-normal text-muted">
          бренд, цвет, замеры, описание, передача
          <IconChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="border-t border-line p-4">{body}</div>}
    </div>
  );
}

export function PriceFields({ values, set, errors, locked, auctionLocked }: Pick<FieldsProps, "values" | "set" | "errors" | "locked"> & { auctionLocked?: boolean }) {
  const auction = values.saleType === "AUCTION";
  const price = Number(values.price) || 0;
  const autoStep = price ? Math.max(1, Math.round(price * 0.05)) : null;
  return (
    <div className="flex flex-col gap-7">
      <fieldset disabled={auctionLocked}>
        <legend className="mb-2 text-sm font-medium">Как продаём?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["FIXED", "Фиксированная цена", "Покупатель жмёт «Купить» или предлагает свою цену"],
              ["AUCTION", "Аукцион", "Ставки по времени — вещь уйдёт тому, кто предложит больше"],
            ] as const
          ).map(([v, label, hint]) => (
            <label key={v} className={clsx("flex cursor-pointer gap-3 rounded-xl border bg-surface p-3.5", values.saleType === v ? "border-ink" : "border-line", auctionLocked && "cursor-not-allowed opacity-60")}>
              <input type="radio" name="saleType" className="mt-1 accent-[var(--accent)]" checked={values.saleType === v} onChange={() => set({ saleType: v })} />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="text-sm text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {auctionLocked && <p className="mt-2 text-sm text-muted">Идёт аукцион — условия торгов менять нельзя.</p>}
      </fieldset>

      <Field label={auction ? "Стартовая цена, BYN" : "Цена, BYN"} required error={errors.price} hint={locked ? "Идёт сделка — цену нельзя изменить" : auction ? "С неё начнутся ставки" : undefined}>
        <div className="relative max-w-xs">
          <Input
            inputMode="numeric"
            disabled={locked || auctionLocked}
            value={values.price}
            onChange={(e) => set({ price: e.target.value.replace(/\D/g, "").slice(0, 6) })}
            error={errors.price}
            className="tabular h-16 pr-16 text-3xl font-semibold"
            placeholder="0"
            aria-label={auction ? "Стартовая цена, BYN" : "Цена, BYN"}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg text-muted">BYN</span>
        </div>
      </Field>

      {auction ? (
        <div className="flex flex-col gap-6 rounded-2xl bg-surface p-4">
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
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Шаг ставки, BYN" error={errors.auctionStep} hint={autoStep ? `Если не указать — ${autoStep} BYN (5% от старта)` : "По умолчанию 5% от старта"}>
              <Input inputMode="numeric" disabled={auctionLocked} value={values.auctionStep} onChange={(e) => set({ auctionStep: e.target.value.replace(/\D/g, "") })} error={errors.auctionStep} placeholder={autoStep ? String(autoStep) : ""} />
            </Field>
            <Field label="Резервная цена (не видна покупателям)" error={errors.auctionReserve} hint="Ниже неё вещь не продаётся — останется в продаже по стартовой цене">
              <Input inputMode="numeric" disabled={auctionLocked} value={values.auctionReserve} onChange={(e) => set({ auctionReserve: e.target.value.replace(/\D/g, "") })} error={errors.auctionReserve} placeholder="Необязательно" />
            </Field>
          </div>
          <p className="text-sm text-muted">Ставка в последние 5 минут продлевает аукцион. Победитель выбирает способ получения в течение 48 часов, иначе вещь предложим следующему участнику. Отменить аукцион можно до первой ставки.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-surface p-4">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block font-medium">Готовы торговаться?</span>
              <span className="text-sm text-muted">Покупатели смогут предложить свою цену</span>
            </span>
            <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={values.acceptsOffers} onChange={(e) => set({ acceptsOffers: e.target.checked })} />
          </label>
          {values.acceptsOffers && (
            <div className="mt-4">
              <Field label="Минимальная цена (не видна покупателям)" error={errors.minOfferPrice} hint="Предложения ниже будут отклоняться автоматически">
                <Input inputMode="numeric" value={values.minOfferPrice} onChange={(e) => set({ minOfferPrice: e.target.value.replace(/\D/g, "") })} error={errors.minOfferPrice} className="max-w-xs" placeholder="Необязательно" />
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
