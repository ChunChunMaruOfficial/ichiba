/**
 * Scroll positions kept by the site instead of the browser. On back/forward the browser would restore the scroll at
 * once, while the page being left is still on screen (it jumps), and before the router has rendered the page coming
 * back. Here each page's scroll is remembered as it changes, and on back/forward it is restored as soon as that page
 * is in the DOM (the photo flight relies on it: the card is where it was).
 *
 * Positions live in sessionStorage, so a reload keeps them; around a reload the browser's own restoration is back on.
 */

const KEY = "scroll-positions";
let positions: Record<string, number> = {};
/** Set while a navigation is under way: the scroll then belongs to neither page. */
let navigatingUntil = 0;

const here = () => location.pathname + location.search;

function load() {
  try {
    positions = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    positions = {};
  }
}

function save() {
  try {
    // The newest few hundred pages are plenty; older ones go first.
    const entries = Object.entries(positions);
    if (entries.length > 300) positions = Object.fromEntries(entries.slice(-300));
    sessionStorage.setItem(KEY, JSON.stringify(positions));
  } catch {
    /* private mode: positions live in memory only */
  }
}

/** Remembers the current page's scroll right now (before leaving it). */
export function rememberScroll() {
  rememberScrollOf(here(), scrollY);
}

/** Remembers a page's scroll by its key (path and query): on back/forward the location has already changed. */
export function rememberScrollOf(key: string, y: number) {
  if (!key) return;
  positions[key] = y;
  save();
}

/** A navigation starts: scroll events of the next moment are not this page's. */
export function navigationStarts() {
  navigatingUntil = performance.now() + 600;
}

/**
 * After back/forward: scrolls the page that came back to where it was, once it is rendered (`rendered` says so)
 * and tall enough, and holds it there while its layout settles (columns measured, images sized), until the reader
 * scrolls or a second passes. The browser's scroll anchoring is off meanwhile: it would follow some element through
 * the settling layout instead of keeping the position.
 */
export function restoreScroll(rendered: () => boolean) {
  const target = positions[here()];
  if (target == null) return;
  const root = document.documentElement;
  const until = performance.now() + 1000;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    mutations.disconnect();
    sizes.disconnect();
    root.style.overflowAnchor = "";
    removeEventListener("wheel", stop);
    removeEventListener("touchstart", stop);
    removeEventListener("keydown", stop);
  };
  const apply = () => {
    if (done) return;
    if (performance.now() > until) return stop();
    if (!rendered()) return;
    root.style.overflowAnchor = "none";
    if (Math.abs(scrollY - target) > 1 && root.scrollHeight - innerHeight >= target - 1) scrollTo(0, target);
  };
  const mutations = new MutationObserver(apply);
  mutations.observe(document.body, { childList: true, subtree: true });
  const sizes = new ResizeObserver(apply);
  sizes.observe(document.body);
  addEventListener("wheel", stop, { passive: true });
  addEventListener("touchstart", stop, { passive: true });
  addEventListener("keydown", stop);
  setTimeout(stop, 1000);
  apply();
}

/** Takes scroll restoration over from the browser; returns the cleanup. */
export function startScrollMemory() {
  load();
  history.scrollRestoration = "manual";
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (performance.now() < navigatingUntil) return;
      positions[here()] = scrollY;
      save();
    });
  };
  // A reload or a visit elsewhere gets the browser's own restoration; coming back from the bfcache, it is ours again.
  const onHide = () => {
    rememberScroll();
    history.scrollRestoration = "auto";
  };
  const onShow = () => (history.scrollRestoration = "manual");
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("pagehide", onHide);
  addEventListener("pageshow", onShow);
  return () => {
    removeEventListener("scroll", onScroll);
    removeEventListener("pagehide", onHide);
    removeEventListener("pageshow", onShow);
    history.scrollRestoration = "auto";
  };
}
