/**
 * Analytics with consent: Yandex Metrica (NEXT_PUBLIC_YM_ID) and Google Analytics 4 (NEXT_PUBLIC_GA_ID) load only
 * after the visitor allowed analytics cookies in the cookie notice (Закон № 99-З: consent for anything not strictly
 * necessary). Without either id nothing is asked and nothing loads: the notice only informs, as before.
 */

export const YM_ID = process.env.NEXT_PUBLIC_YM_ID?.trim() || null;
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID?.trim() || null;
/** Some analytics is configured, so the notice asks instead of informing. */
export const ANALYTICS = !!(YM_ID || GA_ID);

export type Consent = "all" | "necessary";

/** The choice is kept on this device; bump the version when the set of cookies changes, so everyone is asked again. */
const KEY = "ichiba:consent";
const VERSION = "1";
const listeners = new Set<() => void>();
let reopened = false;

export function readConsent(): Consent | null {
  try {
    const [version, value] = (localStorage.getItem(KEY) ?? "").split(":");
    if (version === VERSION && (value === "all" || value === "necessary")) return value;
    // Closed the earlier, inform-only notice: nothing new to ask while there is no analytics.
    return !ANALYTICS && localStorage.getItem("ichiba:cookie-notice") ? "necessary" : null;
  } catch {
    // Storage blocked (private mode): treated as «necessary only», and the notice doesn't nag on every page.
    return "necessary";
  }
}

export function saveConsent(value: Consent) {
  try {
    localStorage.setItem(KEY, `${VERSION}:${value}`);
  } catch {
    /* storage blocked — the choice holds for this page view */
  }
  reopened = false;
  listeners.forEach((l) => l());
}

/** «Настройки cookie» in the footer: the notice comes back to change the choice. */
export function reopenConsent() {
  reopened = true;
  listeners.forEach((l) => l());
}
export const consentReopened = () => reopened;

export function subscribeConsent(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

type Ym = (id: number, method: string, ...args: unknown[]) => void;
type Gtag = (...args: unknown[]) => void;
const w = () => (typeof window === "undefined" ? null : (window as unknown as { ym?: Ym; gtag?: Gtag }));

/** Goals counted in both systems; a no-op until the visitor allowed analytics (the scripts aren't there). */
export type Goal = "buy_request" | "ask_seller" | "offer" | "listing_published" | "sign_up";

export function track(goal: Goal, params?: Record<string, string | number>) {
  const win = w();
  if (!win) return;
  if (YM_ID && win.ym) win.ym(Number(YM_ID), "reachGoal", goal, params);
  if (GA_ID && win.gtag) win.gtag("event", goal, params ?? {});
}

/** A page view after a navigation inside the app (the first one is sent when the scripts start). */
export function pageView(url: string) {
  const win = w();
  if (!win) return;
  if (YM_ID && win.ym) win.ym(Number(YM_ID), "hit", url, { title: document.title, referer: document.referrer });
  if (GA_ID && win.gtag) win.gtag("event", "page_view", { page_location: url, page_title: document.title });
}
