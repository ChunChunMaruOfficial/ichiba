"use client";

import clsx from "clsx";
import { usePrefs } from "@/lib/prefs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

/** Items dealt to the columns: each goes to the currently shortest one (photos keep their proportions). */
function dealColumns(items: Card[], cols: number, extra: number): Card[][] {
  const columns = Array.from({ length: cols }, () => ({ items: [] as Card[], h: 0 }));
  for (const item of items) {
    const ratio = item.cover ? item.cover.height / item.cover.width : 1.25;
    const target = columns.reduce((min, c) => (c.h < min.h ? c : min), columns[0]);
    target.items.push(item);
    target.h += ratio + extra;
  }
  return columns.map((c) => c.items);
}

/**
 * Masonry that keeps reading order: each item goes to the currently shortest column
 * (photos keep their original proportions — frame 07 "порядок результатов важен").
 *
 * One CSS multi-column box whose children are the cards, column after column, with a forced column break before the
 * first card of each column (globals.css, .masonry-break). Every card stays a child of the same box under its own key
 * whatever the column count, so a new count, a resize or hydration only moves cards: none is mounted again, and a
 * photo already on screen is never replaced by a fresh copy. (Before, the server's CSS columns were swapped for
 * per-column wrappers after hydration: every card and photo was created anew, and the largest paint waited for the
 * page's JavaScript.)
 *
 * The server can't measure the list, so its HTML deals the cards for the first breakpoint (two columns on the default
 * grid, a phone's) with breaks that hold only while the list is that narrow (.masonry-break-narrow); wider lists
 * balance the same order into their container-query column count until the measured layout takes over.
 */
export function Masonry({
  items,
  source,
  breakpoints = DEFAULT_BREAKPOINTS,
  gap = 16,
  overlay,
  eager = true,
}: {
  items: Card[];
  source?: "feed" | "search" | "wardrobe";
  breakpoints?: [number, number][];
  gap?: number;
  /** Extra control pinned to a card's top-right corner (the owner's menu in a wardrobe). */
  overlay?: (card: Card) => React.ReactNode;
  /** The first cards of each column load first and at high priority. Off for a list that starts below the fold. */
  eager?: boolean;
}) {
  const { ref, cols } = useColumns(breakpoints);
  const hydrated = useHydrated();
  // Detailed cards carry a caption: a little more room between rows, and the caption's height in the column balance.
  const detailed = usePrefs().prefs.cardStyle === "detailed";
  const rowGap = detailed ? gap * 1.5 : gap;
  // Text block under grid cards adds roughly the height of 0.45 of a square photo.
  const extra = detailed ? 0.45 : 0.08;
  // Server HTML and hydration: the first breakpoint's count, laid out by container queries; then the measured one.
  const responsive = !hydrated && !!cssColumns(breakpoints);
  const count = hydrated ? cols : breakpoints[0][1];
  const columns = useMemo(() => dealColumns(items, count, extra), [items, count, extra]);
  const card = (item: Card, eager: boolean) =>
    overlay ? (
      <div className="relative">
        <ItemCard card={item} source={source} eager={eager} />
        <div className="absolute right-2.5 top-2.5">{overlay(item)}</div>
      </div>
    ) : (
      <ItemCard card={item} source={source} eager={eager} />
    );
  return (
    <div ref={ref} className="@container">
      <div className={responsive ? CSS_COLUMNS : undefined} style={{ columnGap: gap, columnCount: responsive ? undefined : count }}>
        {columns.map((column, c) =>
          column.map((item, j) => (
            <div
              key={item.id}
              className={clsx("break-inside-avoid", c > 0 && j === 0 && (responsive ? "masonry-break-narrow" : "masonry-break"))}
              style={{ marginBottom: rowGap }}
            >
              {card(item, eager && j < 2)}
            </div>
          )),
        )}
      </div>
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
