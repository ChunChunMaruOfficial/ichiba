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
  const before = readConsent();
  try {
    localStorage.setItem(KEY, `${VERSION}:${value}`);
  } catch {
    /* storage blocked — the choice holds for this page view */
  }
  reopened = false;
  // Withdrawn: the counters' cookies go, and a reload unloads the scripts already running (a script can't be
  // unloaded in place; without the reload Webvisor would keep recording this page).
  if (before === "all" && value !== "all") {
    clearAnalyticsCookies();
    location.reload();
    return;
  }
  listeners.forEach((l) => l());
}

/** First-party cookies Metrica and GA set on our domain (_ym_uid, _ym_d, _ym_isad, _ym_visorc, _ga, _ga_<id>, _gid…). */
function clearAnalyticsCookies() {
  const host = location.hostname;
  const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0].trim();
    if (!/^(_ym|_ga|_gid|_gat)/.test(name)) continue;
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ""}`;
  }
}

/** Analytics may run now: the visitor allowed it (checked on every call, so a withdrawal stops sending at once). */
const allowed = () => readConsent() === "all";

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
export type Goal =
  | "buy_request"
  | "ask_seller"
  | "offer"
  | "listing_published"
  | "sign_up"
  // The journal (components/journal/article-tracker.tsx): read to 70 %, the sell CTA, an item from an article, a FAQ opened.
  | "article_read"
  | "article_cta_sell"
  | "article_item_click"
  | "article_faq_open";

export function track(goal: Goal, params?: Record<string, string | number>) {
  const win = w();
  if (!win || !allowed()) return;
  if (YM_ID && win.ym) win.ym(Number(YM_ID), "reachGoal", goal, params);
  if (GA_ID && win.gtag) win.gtag("event", goal, params ?? {});
}

/** A page view after a navigation inside the app (the first one is sent when the scripts start). */
export function pageView(url: string) {
  const win = w();
  if (!win || !allowed()) return;
  if (YM_ID && win.ym) win.ym(Number(YM_ID), "hit", url, { title: document.title, referer: document.referrer });
  if (GA_ID && win.gtag) win.gtag("event", "page_view", { page_location: url, page_title: document.title });
}

/** One Core Web Vitals reading from a real visitor's browser (next/web-vitals), the shape both systems need. */
export type WebVital = { id: string; name: string; value: number; delta: number; rating: string };

/**
 * Real visitors' speed (RUM): every LCP, INP, CLS, FCP and TTFB reading goes to GA4 as an event (the web-vitals
 * recipe: value in ms, CLS ×1000) and to Metrica as visit parameters «web_vitals → LCP → good|needs-improvement|poor»,
 * so both reports show the share of slow visits by page. Only with consent; a reading that comes before the counters
 * finished loading waits for them a little.
 */
export function webVital(m: WebVital, tries = 0) {
  const win = w();
  if (!win || !allowed()) return;
  const ready = (!YM_ID || win.ym) && (!GA_ID || win.gtag);
  if (!ready) {
    if (tries < 5) setTimeout(() => webVital(m, tries + 1), 2000);
    return;
  }
  if (GA_ID && win.gtag) {
    win.gtag("event", m.name, {
      value: Math.round(m.name === "CLS" ? m.delta * 1000 : m.delta),
      metric_id: m.id,
      metric_value: m.value,
      metric_delta: m.delta,
      metric_rating: m.rating,
      non_interaction: true,
    });
  }
  if (YM_ID && win.ym) win.ym(Number(YM_ID), "params", { web_vitals: { [m.name]: m.rating } });
}
