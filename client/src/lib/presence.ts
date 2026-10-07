"use client";

import { useEffect, useState } from "react";

/** How long overlays play their exit animation (keep in sync with the *-out keyframes in globals.css). */
export const EXIT_MS = 180;

/**
 * Keeps an overlay mounted while it animates out. Render while `mounted`; put `data-closing` on the
 * overlay's root while `closing` so the .fade-in / .sheet-up / .slide-in-left inside play in reverse.
 */
export function usePresence(open: boolean, ms = EXIT_MS) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) return;
    const t = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(t);
  }, [open, shown, ms]);
  return { mounted: open || shown, closing: !open && shown };
}
