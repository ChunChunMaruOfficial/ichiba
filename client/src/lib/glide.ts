/**
 * The page glides to its top — two thirds of a second, easing in and out, the way a «наверх» button does. Longer for
 * a longer way, within reason. Resolves when the top is reached (at once with reduced motion, or when the page is
 * already there). Used by the footer links and by a second tap on «Главная».
 */
export function glideToTop() {
  return new Promise<void>((resolve) => {
    const from = window.scrollY;
    if (from <= 0) return resolve();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo(0, 0);
      return resolve();
    }
    // A short page takes half a second, a long one just under one.
    const duration = Math.min(900, Math.max(500, from / 3));
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      window.scrollTo(0, Math.round(from * (1 - eased)));
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** A second tap on «Главная» while on the home feed: the feed listens and loads itself afresh. */
export const HOME_REFRESH = "ichiba:home-refresh";
