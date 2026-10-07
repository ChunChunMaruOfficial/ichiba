"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useBrandSuggestions } from "@/components/brand-picker";
import { Masonry, MasonrySkeleton } from "@/components/masonry";
import { CardRow, CategoryTiles, SectionHeader } from "@/components/sections";
import { useMeta, useSession } from "@/components/session";
import { Button, Chip, EmptyState, ErrorState, IconChevronDown, IconFilter, IconSearch, IconSparkle, IconX, Input, Spinner } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { useInfiniteCards, useSentinel } from "@/lib/hooks";
import { CONDITION_LABEL, items as itemsLabel } from "@/lib/labels";
import { usePresence } from "@/lib/presence";
import { pushRecent } from "@/lib/recent-searches";
import type { Card, Meta, SearchInterpretation } from "@/lib/types";

const LIST_KEYS = ["category", "subcategory", "style", "gender", "size", "condition", "color", "brand"] as const;
type ListKey = (typeof LIST_KEYS)[number];
type Filters = Record<ListKey, string[]> & { city?: string; seller?: string; price_min?: string; price_max?: string; available: "0" | "1"; my_size?: "1" };

const SORTS = [
  ["new", "Сначала новые"],
  ["cheap", "Дешевле"],
  ["expensive", "Дороже"],
  ["popular", "Популярные"],
  ["for_you", "Для вас"],
] as const;

// Items without a chosen gender fit anyone and show up under both «Женское» and «Мужское».
const GENDERS = [
  ["FEMALE", "Женское"],
  ["MALE", "Мужское"],
] as const;

function readFilters(sp: URLSearchParams): Filters {
  const list = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  return {
    category: list("category"),
    subcategory: list("subcategory"),
    style: list("style"),
    gender: list("gender"),
    size: list("size"),
    condition: list("condition"),
    color: list("color"),
    brand: list("brand"),
    city: sp.get("city") ?? undefined,
    seller: sp.get("seller") ?? undefined,
    price_min: sp.get("price_min") ?? undefined,
    price_max: sp.get("price_max") ?? undefined,
    available: sp.get("available") === "0" ? "0" : "1",
    my_size: sp.get("my_size") === "1" ? "1" : undefined,
  };
}

const filterQuery = (f: Filters, extra: Record<string, string | undefined> = {}) =>
  qs({ ...extra, ...Object.fromEntries(LIST_KEYS.map((k) => [k, f[k]])), city: f.city, seller: f.seller, price_min: f.price_min, price_max: f.price_max, available: f.available === "0" ? "0" : undefined, my_size: f.my_size });

function activeChips(f: Filters, meta?: Meta): Array<{ key: string; label: string; remove: (f: Filters) => Filters }> {
  const out: Array<{ key: string; label: string; remove: (f: Filters) => Filters }> = [];
  const without = (k: ListKey, v: string) => (x: Filters) => ({ ...x, [k]: x[k].filter((y) => y !== v) });
  for (const v of f.category) out.push({ key: `c:${v}`, label: meta?.categories.find((c) => c.slug === v)?.label ?? v, remove: without("category", v) });
  for (const v of f.subcategory) out.push({ key: `sc:${v}`, label: meta?.categories.flatMap((c) => c.subcategories).find((x) => x.slug === v)?.label ?? v, remove: without("subcategory", v) });
  for (const v of f.style) out.push({ key: `st:${v}`, label: v, remove: without("style", v) });
  for (const v of f.gender) out.push({ key: `g:${v}`, label: GENDERS.find(([g]) => g === v)?.[1] ?? v, remove: without("gender", v) });
  for (const v of f.size) out.push({ key: `s:${v}`, label: v, remove: without("size", v) });
  for (const v of f.condition) out.push({ key: `q:${v}`, label: CONDITION_LABEL[v as keyof typeof CONDITION_LABEL] ?? v, remove: without("condition", v) });
  for (const v of f.color) out.push({ key: `col:${v}`, label: meta?.colors.find((c) => c.value === v)?.label ?? v, remove: without("color", v) });
  for (const v of f.brand) out.push({ key: `b:${v}`, label: v, remove: without("brand", v) });
  if (f.price_min || f.price_max) {
    const label = f.price_min && f.price_max ? `${f.price_min}–${f.price_max} BYN` : f.price_max ? `до ${f.price_max} BYN` : `от ${f.price_min} BYN`;
    out.push({ key: "price", label, remove: (x) => ({ ...x, price_min: undefined, price_max: undefined }) });
  }
  if (f.city) out.push({ key: "city", label: f.city, remove: (x) => ({ ...x, city: undefined }) });
  if (f.seller) out.push({ key: "seller", label: `@${f.seller}`, remove: (x) => ({ ...x, seller: undefined }) });
  if (f.my_size) out.push({ key: "my_size", label: "Мой размер", remove: (x) => ({ ...x, my_size: undefined }) });
  return out;
}

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// Defined outside FilterPanel so inputs inside keep focus between renders.
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-b border-line py-5 last:border-0">
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function FilterPanel({ value, onChange, meta }: { value: Filters; onChange: (f: Filters) => void; meta: Meta }) {
  const shoes = value.category.includes("shoes");
  const [brandQuery, setBrandQuery] = useState("");
  const suggestions = useBrandSuggestions(brandQuery, !!brandQuery.trim(), 16);
  const brands = useMemo(
    () => Array.from(new Set([...value.brand, ...(brandQuery.trim() ? suggestions.items : meta.brands.slice(0, 20))])),
    [meta.brands, value.brand, brandQuery, suggestions.items],
  );
  const pills = (key: ListKey, options: ReadonlyArray<readonly [string, string]>) => (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <Chip key={v} active={value[key].includes(v)} onClick={() => onChange({ ...value, [key]: toggle(value[key], v) })}>
          {label}
        </Chip>
      ))}
    </div>
  );

  return (
    <div>
      <Group title="Категория">{pills("category", meta.categories.map((c) => [c.slug, c.label] as const))}</Group>
      <Group title="Для кого">{pills("gender", GENDERS)}</Group>
      <Group title="Цена, BYN">
        <div className="flex items-center gap-3">
          <Input inputMode="numeric" placeholder="от" aria-label="Цена от" value={value.price_min ?? ""} onChange={(e) => onChange({ ...value, price_min: e.target.value.replace(/\D/g, "") || undefined })} />
          <span className="text-muted">—</span>
          <Input inputMode="numeric" placeholder="до" aria-label="Цена до" value={value.price_max ?? ""} onChange={(e) => onChange({ ...value, price_max: e.target.value.replace(/\D/g, "") || undefined })} />
        </div>
      </Group>
      <Group title="Размер">
        <div className="flex flex-col gap-3">
          {pills("size", meta.sizes.ALPHA.map((s) => [s, s] as const))}
          {shoes && pills("size", meta.sizes.SHOE_EU.map((s) => [s, s] as const))}
          {(value.category.includes("jeans") || value.category.includes("trousers")) && pills("size", meta.sizes.JEANS_W.map((s) => [s, s] as const))}
        </div>
      </Group>
      <Group title="Состояние">{pills("condition", meta.conditions.map((c) => [c.value, c.label] as const))}</Group>
      <Group title="Цвет">
        {/* Auto-fill columns wide enough for the longest label ("Разноцветный"), so names never overlap. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-2 gap-y-4">
          {meta.colors.map((c) => {
            const active = value.color.includes(c.value);
            return (
              <button key={c.value} type="button" aria-pressed={active} onClick={() => onChange({ ...value, color: toggle(value.color, c.value) })} className="flex min-w-0 flex-col items-center gap-1.5 text-xs">
                <span className={clsx("size-8 rounded-full border", active ? "ring-2 ring-ink ring-offset-2" : "border-line-strong")} style={{ background: c.hex }} />
                <span className={clsx("w-full text-center leading-tight [overflow-wrap:anywhere]", active ? "font-semibold" : "text-ink-2")}>{c.label}</span>
              </button>
            );
          })}
        </div>
      </Group>
      <Group title="Бренд">
        <Input placeholder="Найти среди 5 000 брендов…" value={brandQuery} onChange={(e) => setBrandQuery(e.target.value)} className="mb-3" />
        <div className="flex flex-wrap gap-2">
          {brands.map((b) => (
            <Chip key={b} active={value.brand.includes(b)} onClick={() => onChange({ ...value, brand: toggle(value.brand, b) })}>
              {b}
            </Chip>
          ))}
          {brandQuery && !brands.some((b) => b.toLowerCase() === brandQuery.toLowerCase()) && (
            <Chip onClick={() => (onChange({ ...value, brand: [...value.brand, brandQuery] }), setBrandQuery(""))}>+ «{brandQuery}»</Chip>
          )}
        </div>
      </Group>
      <Group title="Город">
        <select className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3" value={value.city ?? ""} onChange={(e) => onChange({ ...value, city: e.target.value || undefined })}>
          <option value="">Любой</option>
          {meta.cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Group>
      <Group title="Продавец">
        <Input placeholder="@alex…" value={value.seller ?? ""} onChange={(e) => onChange({ ...value, seller: e.target.value.replace(/^@/, "") || undefined })} />
      </Group>
      <label className="flex items-center justify-between py-5 text-sm font-semibold">
        Только доступные
        <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={value.available === "1"} onChange={(e) => onChange({ ...value, available: e.target.checked ? "1" : "0" })} />
      </label>
    </div>
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  initial: Filters;
  onApply: (f: Filters) => void;
  q: string;
  meta: Meta;
}

/** Mounted only while open (plus its exit animation), so the draft always starts from the current filters. */
function FilterDrawer(props: DrawerProps) {
  const { mounted, closing } = usePresence(props.open);
  return mounted ? <FilterDrawerPanel {...props} closing={closing} /> : null;
}

function FilterDrawerPanel({ open, onClose, initial, onApply, q, meta, closing }: DrawerProps & { closing: boolean }) {
  const [draft, setDraft] = useState(initial);
  const [count, setCount] = useState<number | null>(null);
  // Live "Показать N вещей" with 300 ms debounce (frame 07).
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ total: number }>(`/search${filterQuery(draft, { q: q || undefined, limit: "1" })}`, { signal: ctrl.signal })
        .then((r) => setCount(r.total))
        .catch(() => {});
    }, 300);
    return () => (clearTimeout(t), ctrl.abort());
  }, [draft, q, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  return (
    <div data-closing={closing || undefined} className="fade-in fixed inset-0 z-[60] flex items-end bg-black/40 md:items-stretch md:justify-end" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Фильтры" onMouseDown={(e) => e.stopPropagation()} className="sheet-up flex h-[90vh] w-full flex-col rounded-t-3xl bg-surface md:h-full md:w-[420px] md:rounded-none">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">Фильтры</h2>
          <button aria-label="Закрыть" onClick={onClose} className="-m-2 rounded-full p-2 hover:bg-ink/5">
            <IconX />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5">
          <FilterPanel value={draft} onChange={setDraft} meta={meta} />
        </div>
        <div className="flex gap-3 border-t border-line px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button variant="secondary" onClick={() => setDraft(readFilters(new URLSearchParams()))}>
            Сбросить
          </Button>
          <Button block onClick={() => (onApply(draft), onClose())}>
            {count == null ? "Показать" : count === 0 ? "Ничего не найдено" : `Показать ${itemsLabel(count)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SortMenu({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative inline-flex h-9 items-center gap-1 rounded-full border border-line-strong bg-surface pl-4 pr-8 text-sm focus-within:border-ink focus-within:ring-3 focus-within:ring-accent/15">
      <span className="sr-only">Сортировка</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="appearance-none bg-transparent outline-none">
        {SORTS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <IconChevronDown className="pointer-events-none absolute right-3 size-4" />
    </label>
  );
}

function SearchLanding({ meta }: { meta: Meta }) {
  const home = useSWR<{ categories: Array<{ slug: string; label: string; count: number; cover: Card["cover"] }>; fresh: Card[] }>("/home");
  return (
    <div className="flex flex-col gap-12 py-6">
      {home.data && home.data.categories.length > 0 && (
        <section>
          <SectionHeader title="Популярные категории" />
          <CategoryTiles categories={home.data.categories} />
        </section>
      )}
      <section>
        <SectionHeader title="Популярные бренды" />
        <div className="flex flex-wrap gap-2">
          {meta.brands.slice(0, 10).map((b) => (
            <Link key={b} href={`/search?brand=${encodeURIComponent(b)}`} className="rounded-full border border-line-strong bg-surface px-4 py-2 text-sm hover:border-ink">
              {b}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SearchView() {
  const router = useRouter();
  const sp = useSearchParams();
  const meta = useMeta();
  const { me, requireAuth } = useSession();
  const hasSizes = !!me?.sizes && Object.values(me.sizes).some((v) => v?.length);
  const q = sp.get("q") ?? "";
  const sort = sp.get("sort") ?? "new";
  const filters = useMemo(() => readFilters(new URLSearchParams(sp.toString())), [sp]);
  const [drawer, setDrawer] = useState(sp.get("filters") === "1");
  const [input, setInput] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setInput(q);
  }
  const inputRef = useRef<HTMLInputElement>(null);

  const chips = activeChips(filters, meta);
  const hasQuery = !!q || chips.length > 0 || sp.has("sort");
  const base = filterQuery(filters, { q: q || undefined, sort: sort !== "new" ? sort : undefined });

  // Natural-language search: a phrase is turned into filters first («платье на свадьбу до 50» → Платья · Classic · до 50 BYN).
  const nlFrom = sp.get("nl");
  const wantsParse = !!q && sp.get("raw") !== "1" && !nlFrom && q.trim().split(/\s+/).length >= 2;
  const parse = useSWR(wantsParse ? (["/ai/search-parse", q] as const) : null, ([url, text]) => api<SearchInterpretation>(url, { body: { q: text } }), { revalidateOnFocus: false, dedupingInterval: 3_600_000, keepPreviousData: false });
  const interpreted = wantsParse && parse.data?.status === "ok" ? parse.data : null;
  const parsing = wantsParse && !parse.data && !parse.error;
  useEffect(() => {
    if (!interpreted) return;
    const p = interpreted.filters;
    const merged: Filters = {
      ...filters,
      ...Object.fromEntries(LIST_KEYS.map((k) => [k, p[k].length ? p[k] : filters[k]])),
      city: p.city ?? filters.city,
      price_min: p.price_min != null ? String(p.price_min) : filters.price_min,
      price_max: p.price_max != null ? String(p.price_max) : filters.price_max,
    } as Filters;
    router.replace(`/search${filterQuery(merged, { q: p.q || undefined, nl: q, sort: sort !== "new" ? sort : undefined })}`, { scroll: false });
  }, [interpreted, filters, q, sort, router]);

  const results = useInfiniteCards<{ items: Card[]; total: number; relax: { filter: string; label: string; count: number } | null }>((offset) =>
    hasQuery && !parsing && !interpreted ? `/search${base}${base ? "&" : "?"}offset=${offset}&limit=24` : null,
  );
  const sentinel = useSentinel(results.loadMore, !results.done);
  const fresh = useSWR<{ items: Card[] }>(hasQuery && results.data && results.total === 0 ? "/feed?chip=new&limit=8" : null);

  const navigate = (f: Filters, extra: { q?: string; sort?: string } = {}) => {
    const nextQ = extra.q ?? q;
    const nextSort = extra.sort ?? sort;
    router.replace(`/search${filterQuery(f, { q: nextQ || undefined, sort: nextSort !== "new" ? nextSort : undefined })}`, { scroll: false });
  };

  const relax = results.pages[0]?.relax;

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6">
      {/* Mobile search field (desktop uses the header search) */}
      <form
        role="search"
        className="pt-3 md:hidden"
        onSubmit={(e) => {
          e.preventDefault();
          pushRecent(input);
          inputRef.current?.blur();
          navigate(filters, { q: input.trim() });
        }}
      >
        <label className="flex h-12 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 focus-within:border-ink">
          <IconSearch className="size-5 shrink-0 text-muted" />
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Что ищете?" className="h-full flex-1 bg-transparent outline-none" enterKeyHint="search" aria-label="Поиск" />
        </label>
      </form>

      <div className="sticky top-[var(--header-offset,57px)] z-30 transition-[top] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none -mx-4 bg-paper px-4 py-3 md:-mx-6 md:px-6">
        <div className="flex items-center gap-2">
          <div className="no-scrollbar flex flex-1 gap-2 overflow-x-auto">
            <Chip onClick={() => setDrawer(true)}>
              <IconFilter className="size-4" /> Все фильтры{chips.length ? ` · ${chips.length}` : ""}
            </Chip>
            <Chip
              active={!!filters.my_size}
              onClick={() =>
                requireAuth(() => (hasSizes || filters.my_size ? navigate({ ...filters, my_size: filters.my_size ? undefined : "1" }) : router.push("/settings#sizes")), { reason: "чтобы искать вещи вашего размера" })
              }
            >
              Мой размер
            </Chip>
            {meta?.categories.slice(0, 6).map((c) => (
              <Chip key={c.slug} active={filters.category.includes(c.slug)} onClick={() => navigate({ ...filters, category: toggle(filters.category, c.slug) })}>
                {c.label}
              </Chip>
            ))}
          </div>
          <div className="hidden shrink-0 md:block">
            <SortMenu value={sort} onChange={(v) => navigate(filters, { sort: v })} />
          </div>
        </div>
        {chips.length > 0 && (
          <div className="no-scrollbar mt-3 flex items-center gap-2 overflow-x-auto">
            {chips.map((c) => (
              <button key={c.key} onClick={() => navigate(c.remove(filters))} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-ink px-3 text-sm text-accent-ink">
                {c.label} <IconX className="size-3.5" />
                <span className="sr-only">убрать фильтр</span>
              </button>
            ))}
            <button className="shrink-0 px-2 text-sm text-ink-2 underline underline-offset-4" onClick={() => navigate(readFilters(new URLSearchParams()))}>
              Сбросить всё
            </button>
          </div>
        )}
      </div>

      {nlFrom && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-ai-soft/70 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-1.5 text-ai">
            <IconSparkle className="size-4" filled />
            Подобрали фильтры по запросу «{nlFrom}»
          </span>
          <Link href={`/search?q=${encodeURIComponent(nlFrom)}&raw=1`} className="ml-auto font-medium text-ink-2 underline underline-offset-4">
            Искать как текст
          </Link>
        </div>
      )}

      {!hasQuery ? (
        meta && <SearchLanding meta={meta} />
      ) : results.error ? (
        <ErrorState message="Не удалось загрузить результаты" onRetry={() => results.mutate()} />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-4 pb-4 pt-2">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              {nlFrom ? `Результаты для «${nlFrom}»` : q ? `Результаты для «${q}»` : "Вещи"}
              {results.data && <span className="ml-2 text-base font-normal text-muted">{itemsLabel(results.total)}</span>}
            </h1>
            <div className="md:hidden">
              <SortMenu value={sort} onChange={(v) => navigate(filters, { sort: v })} />
            </div>
          </div>
          {parsing ? (
            <div className="flex items-center gap-2 pb-4 text-sm text-ai">
              <IconSparkle className="size-4 animate-pulse" filled /> Разбираем запрос…
            </div>
          ) : null}
          {!results.data ? (
            <MasonrySkeleton />
          ) : results.total === 0 ? (
            <>
              <EmptyState
                title={nlFrom || q ? `Мы ничего не нашли по запросу «${nlFrom ?? q}»` : "Ничего не нашли"}
                hint={relax ? `Без ${relax.filter === "q" ? "" : "фильтра "}${relax.label} — ${itemsLabel(relax.count)}` : "Попробуйте изменить запрос или фильтры"}
              >
                <Button variant="secondary" onClick={() => setDrawer(true)}>
                  Изменить фильтры
                </Button>
                {relax && (
                  <Button
                    onClick={() => {
                      const f = { ...filters } as Filters & Record<string, unknown>;
                      if (relax.filter === "q") return navigate(f, { q: "" });
                      if ((LIST_KEYS as readonly string[]).includes(relax.filter)) f[relax.filter as ListKey] = [];
                      else if (relax.filter === "price_max") Object.assign(f, { price_min: undefined, price_max: undefined });
                      else f[relax.filter] = undefined;
                      navigate(f);
                    }}
                  >
                    {relax.filter === "q" ? "Искать без слов" : "Убрать фильтр"}
                  </Button>
                )}
              </EmptyState>
              {fresh.data && fresh.data.items.length > 0 && (
                <section className="pb-12">
                  <SectionHeader title="Посмотрите новинки" href="/?chip=new" />
                  <CardRow items={fresh.data.items} />
                </section>
              )}
            </>
          ) : (
            <div className={clsx("transition-opacity", results.isValidating && !results.loadingMore && "opacity-50")}>
              <Masonry items={results.items} variant="grid" source="search" />
              <div ref={sentinel} className="flex h-24 flex-col items-center justify-center gap-2 text-sm text-muted">
                {results.loadingMore ? <Spinner /> : `Показано ${results.items.length} из ${results.total}`}
              </div>
            </div>
          )}
        </>
      )}

      {meta && <FilterDrawer open={drawer} onClose={() => setDrawer(false)} initial={filters} onApply={(f) => navigate(f)} q={q} meta={meta} />}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
