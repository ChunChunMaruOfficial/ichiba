"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { consentReopened, readConsent, subscribeConsent } from "@/lib/analytics";
import { focusedFlow } from "./header";
import { useSession } from "./session";

const KEY = "ichiba:wip-note";

/**
 * «Сайт ещё в разработке»: a small washi note taped in the bottom-right corner, so an unfinished corner of the site
 * reads as work in progress rather than a broken shop. For guests only (an account holder knows, and the mini chat
 * lives in that corner), after the cookie notice is answered (it sits at the bottom too), never in a flow with its own
 * bottom bar. Closed with ×, remembered on this device.
 */
export function WipNote() {
  const { me, loading } = useSession();
  const pathname = usePathname();
  // Server render and hydration: pending, so nothing is drawn until the client knows.
  const consentPending = useSyncExternalStore(subscribeConsent, () => consentReopened() || readConsent() === null, () => true);
  const [state, setState] = useState<"waiting" | "shown" | "leaving" | "closed">("waiting");

  useEffect(() => {
    let closed = false;
    try {
      closed = localStorage.getItem(KEY) === "1";
    } catch {
      /* private mode: show it */
    }
    // A moment after the page settles: it never competes with the first screen.
    const t = setTimeout(() => setState(closed ? "closed" : "shown"), closed ? 0 : 1500);
    return () => clearTimeout(t);
  }, []);

  if (state === "waiting" || state === "closed" || loading || me || consentPending || focusedFlow(pathname)) return null;

  const close = () => {
    setState("leaving");
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* not remembered: it comes back next visit */
    }
    setTimeout(() => setState("closed"), 260);
  };

  return (
    <aside aria-label="Сайт в разработке" data-closing={state === "leaving" || undefined} className="wip-note fixed bottom-[calc(var(--tabbar-h)+14px+env(safe-area-inset-bottom))] right-3 z-40 w-64 max-w-[calc(100vw-1.5rem)] md:bottom-6 md:right-6 md:w-72">
      <div className="washi-slip-paper flex items-start gap-3 py-3.5 pl-3.5 pr-9 md:py-4 md:pl-4">
        <span aria-hidden lang="ja" className="wip-stamp">
          作
        </span>
        <p className="min-w-0 text-[13px] leading-snug">
          <b className="block text-[14px] font-bold">Сайт ещё в разработке</b>
          но вы уже можете тут осмотреться :)
        </p>
      </div>
      <button type="button" onClick={close} aria-label="Закрыть" className="wip-close">
        <svg viewBox="0 0 16 16" aria-hidden className="size-3.5">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </aside>
  );
}
