"use client";

import clsx from "clsx";
import useEmblaCarousel from "embla-carousel-react";
import { useRef } from "react";
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures";

/**
 * A sideways row (cards, wardrobes, looks, chips) on Embla: dragged with the mouse as smoothly as a finger swipes it,
 * with momentum; a trackpad's sideways swipe and Shift + wheel scroll it too. A drag never clicks what it started on.
 * `snap`: card rows settle on a card; chip rows (the default) stop wherever they are let go.
 * The outer element clips (pass the bleed, e.g. -mx-4, there); the inner one lays the items out (gap, padding).
 */
export function DragRow({
  children,
  className,
  viewportClassName,
  snap = false,
  ...rest
}: { children: React.ReactNode; className?: string; viewportClassName?: string; snap?: boolean } & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const [ref] = useEmblaCarousel({ align: "start", containScroll: "trimSnaps", dragFree: !snap, skipSnaps: true }, [WheelGesturesPlugin()]);
  // Embla cancels the click that ends a drag, but listeners on the whole page (the photo flight) hear it first: the
  // row says it was dragged (data-dragged) until that click has gone by.
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      ref={ref}
      className={clsx("overflow-hidden", viewportClassName)}
      onPointerDownCapture={(e) => (start.current = { x: e.clientX, y: e.clientY })}
      onPointerUpCapture={(e) => {
        const from = start.current;
        start.current = null;
        if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) < 6) return;
        const row = e.currentTarget;
        row.dataset.dragged = "";
        setTimeout(() => delete row.dataset.dragged, 0);
      }}
      {...rest}
    >
      <div className={clsx("flex touch-pan-y *:shrink-0", className)}>{children}</div>
    </div>
  );
}
