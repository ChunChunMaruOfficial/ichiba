"use client";

import { useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/types";
import { ItemCard } from "./item-card";
import { Skeleton } from "./ui";

function useColumns(breakpoints: [number, number][]) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(breakpoints[0][1]);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      setCols(breakpoints.filter(([min]) => w >= min).at(-1)?.[1] ?? breakpoints[0][1]);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [breakpoints]);
  return { ref, cols };
}

const DEFAULT_BREAKPOINTS: [number, number][] = [[0, 2], [700, 3], [1000, 4], [1400, 5]];

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
      {columns.map((c, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap: variant === "grid" ? gap * 1.5 : gap }}>
          {c.items.map((item, j) => (
            overlay ? (
              <div key={item.id} className="relative">
                <ItemCard card={item} variant={variant} source={source} eager={j < 2} />
                <div className="absolute right-2.5 top-2.5">{overlay(item)}</div>
              </div>
            ) : (
              <ItemCard key={item.id} card={item} variant={variant} source={source} eager={j < 2} />
            )
          ))}
        </div>
      ))}
    </div>
  );
}

const SKELETON_RATIOS = [1.33, 1, 1.25, 1.4, 1.1, 1.33, 1.25, 1, 1.4, 1.2, 1.33, 1.1];

export function MasonrySkeleton({ count = 12, breakpoints = DEFAULT_BREAKPOINTS }: { count?: number; breakpoints?: [number, number][] }) {
  const { ref, cols } = useColumns(breakpoints);
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
