"use client";

import { useEffect } from "react";

/** A press that moves less than this is still a click on what is under it. */
const SLOP = 6;

/** The nearest ancestor that scrolls sideways and has something to scroll. */
function horizontalScroller(el: Element | null): HTMLElement | null {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (!(node instanceof HTMLElement) || node.scrollWidth <= node.clientWidth + 1) continue;
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * Every sideways row on the site (cards, wardrobes, chips, galleries) can be dragged with the mouse, the way a finger
 * swipes it on a phone: grab, pull, let go and it glides on a little, then snaps where the row snaps. A drag never
 * becomes a click on the card it started on. Touch and pens keep the browser's own scrolling.
 */
export function DragScroll() {
  useEffect(() => {
    let row: HTMLElement | null = null;
    let startX = 0;
    let startLeft = 0;
    let dragged = false;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let snap = "";

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest("input, textarea, select, [contenteditable], [data-no-drag]")) return;
      row = horizontalScroller(target);
      if (!row) return;
      startX = lastX = e.clientX;
      startLeft = row.scrollLeft;
      lastT = performance.now();
      velocity = 0;
      dragged = false;
    };

    const onMove = (e: PointerEvent) => {
      if (!row) return;
      const dx = e.clientX - startX;
      if (!dragged) {
        if (Math.abs(dx) < SLOP) return;
        dragged = true;
        // Snapping would fight the hand: off while dragging, back on release.
        snap = row.style.scrollSnapType;
        row.style.scrollSnapType = "none";
        row.style.scrollBehavior = "auto";
        row.dataset.dragging = "";
        document.documentElement.dataset.dragScrolling = "";
      }
      e.preventDefault();
      row.scrollLeft = startLeft - dx;
      const now = performance.now();
      velocity = (e.clientX - lastX) / Math.max(1, now - lastT);
      lastX = e.clientX;
      lastT = now;
    };

    const onUp = () => {
      const r = row;
      row = null;
      if (!r || !dragged) return;
      delete r.dataset.dragging;
      delete document.documentElement.dataset.dragScrolling;
      // A flick carries on a little, then the row's own snapping takes over.
      const glide = performance.now() - lastT < 80 ? -velocity * 220 : 0;
      r.style.scrollBehavior = "";
      r.style.scrollSnapType = snap;
      if (Math.abs(glide) > 4) r.scrollBy({ left: glide, behavior: "smooth" });
      // The click that ends a drag doesn't open the card under the cursor.
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };

    // Links and pictures would start the browser's own drag-and-drop instead.
    const onDragStart = (e: DragEvent) => {
      if (horizontalScroller(e.target as Element)) e.preventDefault();
    };

    document.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("dragstart", onDragStart);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("dragstart", onDragStart);
    };
  }, []);
  return null;
}
