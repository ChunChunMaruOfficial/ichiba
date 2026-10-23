"use client";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHydrated } from "@/lib/countdown";
import type { Card } from "@/lib/types";
import { ItemCard } from "./item-card";
import { Skeleton } from "./ui";

/** Columns for a list this wide: the last breakpoint it reaches. */
const columnsFor = (breakpoints: [number, number][], width: number) => breakpoints.filter(([min]) => width >= min).at(-1)?.[1] ?? breakpoints[0][1];

function useColumns(breakpoints: [number, number][]) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(breakpoints[0][1]);
  // Measured before the first paint: otherwise a list shown again (back, a tab switch) is painted in the default
  // columns first and then rearranged under the reader's eyes.
  useLayoutEffect(() => {
    const w = ref.current?.getBoundingClientRect().width;
    if (w) setCols(columnsFor(breakpoints, w));
  }, [breakpoints]);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setCols(columnsFor(breakpoints, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [breakpoints]);
  return { ref, cols };
}

const DEFAULT_BREAKPOINTS: [number, number][] = [[0, 2], [700, 3], [1000, 4], [1400, 5]];
/**
 * The same breakpoints as container queries, for the server HTML: the list's width is unknown until the browser
 * measures it, and rendering 2 columns that then become 4 shifted the whole page (CLS). Literal strings so Tailwind
 * generates them; custom breakpoints fall back to their first column count.
 */
const CSS_COLUMNS = "columns-2 @[700px]:columns-3 @[1000px]:columns-4 @[1400px]:columns-5";
const cssColumns = (breakpoints: [number, number][]) => (breakpoints === DEFAULT_BREAKPOINTS ? CSS_COLUMNS : undefined);

/**
 * Masonry that keeps reading order: each item goes to the currently shortest column
 * (photos keep their original proportions — frame 07 "порядок результатов важен").
 */
export function Masonry({
  items,
  variant = "grid",
  source,
  breakpoints = DEFAULT_BREAKPOINTS,
  gap = 16,
  overlay,
}: {
  items: Card[];
  variant?: "feed" | "grid";
  source?: "feed" | "search" | "wardrobe";
  breakpoints?: [number, number][];
  gap?: number;
  /** Extra control pinned to a card's top-right corner (the owner's menu in a wardrobe). */
  overlay?: (card: Card) => React.ReactNode;
}) {
  const { ref, cols } = useColumns(breakpoints);
  const hydrated = useHydrated();
  const card = (item: Card, eager: boolean) =>
    overlay ? (
      <div key={item.id} className="relative">
        <ItemCard card={item} variant={variant} source={source} eager={eager} />
        <div className="absolute right-2.5 top-2.5">{overlay(item)}</div>
      </div>
    ) : (
      <ItemCard key={item.id} card={item} variant={variant} source={source} eager={eager} />
    );
  const rowGap = variant === "grid" ? gap * 1.5 : gap;
  // Server HTML and hydration: CSS columns sized by container queries, so the first paint already has the right
  // number of columns; right after hydration the measured shortest-column layout below takes over.
  if (!hydrated) {
    return (
      <div ref={ref} className="@container">
        <div className={cssColumns(breakpoints)} style={{ columnGap: gap, columnCount: cssColumns(breakpoints) ? undefined : breakpoints[0][1] }}>
          {items.map((item, i) => (
            <div key={item.id} className="break-inside-avoid" style={{ marginBottom: rowGap }}>
              {card(item, i < 4)}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const columns: Array<{ items: Card[]; h: number }> = Array.from({ length: cols }, () => ({ items: [], h: 0 }));
  // Text block under grid cards adds roughly the height of 0.45 of a square photo.
  const extra = variant === "grid" ? 0.45 : 0.08;
  for (const item of items) {
    const ratio = item.cover ? item.cover.height / item.cover.width : 1.25;
    const target = columns.reduce((min, c) => (c.h < min.h ? c : min), columns[0]);
    target.items.push(item);
    target.h += ratio + extra;
  }
  return (
    <div ref={ref} className="flex items-start" style={{ gap }}>
      {/* Column wrappers are keyed by position; the cards inside keep their own id keys, so a card that stays in its
          column is never remounted when items are added. */}
      {columns.map((c, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap: rowGap }}>
          {c.items.map((item, j) => card(item, j < 2))}
        </div>
      ))}
    </div>
  );
}

const SKELETON_RATIOS = [1.33, 1, 1.25, 1.4, 1.1, 1.33, 1.25, 1, 1.4, 1.2, 1.33, 1.1];

export function MasonrySkeleton({ count = 12, breakpoints = DEFAULT_BREAKPOINTS }: { count?: number; breakpoints?: [number, number][] }) {
  const { ref, cols } = useColumns(breakpoints);
  const hydrated = useHydrated();
  // Server HTML: the same container-query columns as Masonry, so the skeleton doesn't jump from 2 to 4 columns.
  if (!hydrated) {
    return (
      <div ref={ref} role="status" className="@container" aria-busy aria-label="Загружаем вещи">
        <div className={clsx("gap-4", cssColumns(breakpoints))} style={{ columnCount: cssColumns(breakpoints) ? undefined : breakpoints[0][1] }}>
          {SKELETON_RATIOS.slice(0, count).map((r, i) => (
            <Skeleton key={i} className="mb-4 w-full break-inside-avoid rounded-2xl" style={{ aspectRatio: `1 / ${r}` }} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} role="status" className="flex items-start gap-4" aria-busy aria-label="Загружаем вещи">
      {Array.from({ length: cols }, (_, c) => (
        <div key={c} className="flex flex-1 flex-col gap-4">
          {SKELETON_RATIOS.slice(0, count)
            .filter((_, i) => i % cols === c)
            .map((r, i) => (
              <Skeleton key={i} className="w-full rounded-2xl" style={{ aspectRatio: `1 / ${r}` }} />
            ))}
        </div>
      ))}
    </div>
  );
}
