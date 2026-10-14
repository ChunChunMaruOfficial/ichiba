"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The photo flies between a card and the item page. A tap on a card's photo lifts that photo into a fixed layer
 * above the page and, at once, glides it into the photo frame of the item page's loading shell (item/[id]/loading,
 * shown before the server answers); when the page itself is in, the layer settles on the gallery photo and hands
 * over to it, and the page fades in around it. Going back flies the gallery photo into its card the same way.
 * The pages themselves don't change: the layer only covers the hand-over.
 *
 * Every element marked data-fly-target (with the photo's data-fly-w / data-fly-h) is a landing place; every link to
 * /item/<id> that holds a photo is a take-off place, so every card on the site takes part. Only transform and
 * opacity are animated, so the compositor runs the flight even while the new page is being laid out.
 *
 * Skipped for reduced motion, for a link opened in a new tab, and after an iOS edge swipe (Safari animates that one
 * itself).
 */

const ITEM = /^\/item\/([0-9a-f-]{36})$/i;
const DURATION = 300;
const SETTLE = 200;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const LIFT = 1.03;
const SHADOW = "0 18px 40px rgb(0 0 0 / 0.18)";

type Box = { left: number; top: number; width: number; height: number };

let flight: {
  id: string;
  dir: "open" | "back";
  layer: HTMLImageElement;
  /** Where the layer is drawn right now (its transform included). */
  at: Box;
  radius: string;
  /** The photo's own size, for the loading shell's frame. */
  photo: { width: number; height: number };
  /** The photo the layer stands in for; shown again when the flight ends. */
  source: HTMLElement;
  /** The landing place the layer currently covers. */
  target: HTMLElement | null;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

/** The photo flying into /item/<id>, for that page's loading shell to frame it the way the gallery will. */
export function flyingPhoto(id: string) {
  return flight?.dir === "open" && flight.id === id ? flight.photo : null;
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The photo's own size: from data-fly-w/h (known before it loads) or the loaded image. */
function photoSize(el: HTMLElement) {
  const img = el instanceof HTMLImageElement ? el : null;
  return { width: Number(el.dataset.flyW) || img?.naturalWidth || 0, height: Number(el.dataset.flyH) || img?.naturalHeight || 0 };
}

/** Where the picture itself is drawn: a photo fitted inside its frame (object-contain) leaves bands around it. */
function drawnBox(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const { width: w, height: h } = photoSize(el);
  const contain = !!el.dataset.flyW || getComputedStyle(el).objectFit === "contain";
  if (!contain || !w || !h) return { left: r.left, top: r.top, width: r.width, height: r.height };
  const s = Math.min(r.width / w, r.height / h);
  return { left: r.left + (r.width - w * s) / 2, top: r.top + (r.height - h * s) / 2, width: w * s, height: h * s };
}

/** The rounding of the frame the photo sits in (the card's or the gallery's). */
function radiusOf(el: HTMLElement) {
  for (let n: HTMLElement | null = el, i = 0; n && i < 4; n = n.parentElement, i++) {
    const r = getComputedStyle(n).borderTopLeftRadius;
    if (r && r !== "0px") return r;
  }
  return "0px";
}

const visible = (b: Box) => b.width > 8 && b.height > 8 && b.top < innerHeight && b.top + b.height > 0 && b.left < innerWidth && b.left + b.width > 0;
const same = (a: Box, b: Box) => Math.abs(a.left - b.left) + Math.abs(a.top - b.top) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height) < 2;
const css = (b: Box) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
/** The transform that draws a layer laid out at `base` over `at` (transform origin: its top-left corner). */
const mapTo = (base: Box, at: Box) => `translate(${at.left - base.left}px, ${at.top - base.top}px) scale(${at.width / base.width}, ${at.height / base.height})`;
const loaded = (el: HTMLElement) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0;

/** The card photo inside a link: the biggest loaded <img> that isn't a blurred backdrop. */
function photoIn(link: HTMLAnchorElement) {
  let best: HTMLImageElement | null = null;
  let area = 0;
  for (const img of link.querySelectorAll<HTMLImageElement>("img")) {
    const hidden = img.closest("[aria-hidden='true']");
    if ((hidden && hidden !== link) || !loaded(img)) continue;
    const r = img.getBoundingClientRect();
    if (r.width * r.height > area) [best, area] = [img, r.width * r.height];
  }
  return best;
}

/** The landing place on screen: the gallery photo or the loading shell's frame (phones and desktop each have one). */
function landingPlace() {
  return [...document.querySelectorAll<HTMLElement>("[data-fly-target]")].find((el) => el.getClientRects().length > 0) ?? null;
}

function lift(id: string, dir: "open" | "back", source: HTMLImageElement) {
  land();
  const from = drawnBox(source);
  if (!visible(from)) return;
  const layer = document.createElement("img");
  layer.src = source.currentSrc || source.src;
  layer.alt = "";
  layer.setAttribute("aria-hidden", "true");
  const radius = radiusOf(source);
  Object.assign(layer.style, css(from), {
    position: "fixed",
    zIndex: "95",
    objectFit: "cover",
    pointerEvents: "none",
    borderRadius: radius,
    margin: "0",
    transformOrigin: "0 0",
    willChange: "transform, opacity",
  });
  document.body.appendChild(layer);
  source.style.visibility = "hidden";
  // The next page's text waits for the photo to get going (<Main> and the item page read this for their fade).
  document.documentElement.dataset.photoFlight = "";
  // Answers the tap at once: the photo lifts off the page a little, grown around its centre.
  const at = { left: from.left - (from.width * (LIFT - 1)) / 2, top: from.top - (from.height * (LIFT - 1)) / 2, width: from.width * LIFT, height: from.height * LIFT };
  layer.animate([{ transform: "none", boxShadow: "none" }, { transform: mapTo(from, at), boxShadow: SHADOW }], { duration: 140, easing: EASE, fill: "forwards" });
  // A navigation that never comes (cancelled, failed) must not leave the photo hanging over the page.
  const timer = setTimeout(fadeAway, 3000);
  flight = { id, dir, layer, at, radius, photo: photoSize(source), source, target: null, timer };
}

/** Ends the flight at once: the layer goes, every photo it covered is shown again. */
function land() {
  if (!flight) return;
  clearTimeout(flight.timer);
  flight.layer.remove();
  flight.source.style.visibility = "";
  if (flight.target) flight.target.style.visibility = "";
  delete document.documentElement.dataset.photoFlight;
  flight = null;
}

/** Glides the layer onto `target`; then hands over to it, or waits on the loading shell for the real photo. */
function glide(target: HTMLElement, duration = DURATION) {
  const f = flight;
  if (!f) return;
  clearTimeout(f.timer);
  const to = drawnBox(target);
  if (!visible(to)) return fadeAway();
  const first = !f.target;
  if (f.target && f.target !== target) f.target.style.visibility = "";
  f.target = target;
  target.style.visibility = "hidden";
  const from = f.at;
  const radius = radiusOf(target);
  for (const a of f.layer.getAnimations()) a.cancel();
  // The layer takes the landing place's box and starts drawn where it is now: only its transform moves.
  Object.assign(f.layer.style, css(to), { borderRadius: radius });
  const r = parseFloat(f.radius) || 0;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  f.at = to;
  f.layer.animate(
    [
      { transform: mapTo(to, from), borderRadius: `${r / sx}px / ${r / sy}px`, boxShadow: first ? SHADOW : "none" },
      { transform: "none", borderRadius: radius, boxShadow: "none" },
    ],
    { duration, easing: EASE, fill: "forwards" },
  ).onfinish = () => {
    if (flight !== f) return;
    f.radius = radius;
    if (target instanceof HTMLImageElement) return settle(target);
    // On the loading shell: the page comes in under the layer, then the layer settles on its gallery photo.
    awaitPage();
  };
}

/** On the shell's frame until the item page is in; then onto its gallery photo (a short glide if it sits apart). */
function awaitPage() {
  const f = flight;
  if (!f) return;
  f.timer = setTimeout(fadeAway, 10_000);
  const step = () => {
    if (flight !== f) return;
    const el = landingPlace();
    if (el instanceof HTMLImageElement && visible(drawnBox(el))) {
      clearTimeout(f.timer);
      if (!same(drawnBox(el), f.at)) return glide(el, SETTLE);
      f.target!.style.visibility = "";
      f.target = el;
      el.style.visibility = "hidden";
      return settle(el);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** The layer covers the gallery photo until it has loaded, then dissolves into it. */
function settle(target: HTMLImageElement) {
  const f = flight;
  if (!f) return;
  const done = () => {
    if (flight !== f) return;
    clearTimeout(f.timer);
    target.style.visibility = "";
    f.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" }).onfinish = () => {
      if (flight === f) land();
    };
  };
  if (loaded(target)) return done();
  target.addEventListener("load", done, { once: true });
  f.timer = setTimeout(done, 1500);
}

/** No place to land (the card scrolled away, another page): the photo just fades. */
function fadeAway() {
  const f = flight;
  if (!f) return;
  clearTimeout(f.timer);
  f.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).onfinish = () => {
    if (flight === f) land();
  };
}

/** Looks for the landing place for a few frames: the new page may still be mounting or restoring its scroll. */
function seek(find: () => HTMLElement | null, frames: number, settleFrames = 0) {
  const f = flight;
  let n = 0;
  const step = () => {
    if (flight !== f) return;
    const el = n >= settleFrames ? find() : null;
    if (el && visible(drawnBox(el))) return glide(el);
    if (++n > frames) return fadeAway();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function PhotoFlight() {
  const pathname = usePathname();

  useEffect(() => {
    let edgeSwipeAt = 0;
    const onTouch = (e: TouchEvent) => {
      const x = e.touches[0]?.clientX ?? 100;
      if (x < 30 || x > innerWidth - 30) edgeSwipeAt = Date.now();
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reduced()) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== location.origin) return;
      const id = ITEM.exec(a.pathname)?.[1];
      if (!id || location.pathname === a.pathname) return;
      const img = photoIn(a);
      if (img) lift(id, "open", img);
    };
    // Back (or forward) from an item page: the gallery photo flies to its card, if the next page has one.
    const onPop = () => {
      const id = ITEM.exec(location.pathname) ? null : ITEM.exec(document.documentElement.dataset.flyFrom ?? "")?.[1];
      if (!id || reduced() || Date.now() - edgeSwipeAt < 1500) return;
      const photo = landingPlace();
      if (photo instanceof HTMLImageElement && loaded(photo)) lift(id, "back", photo);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("touchstart", onTouch, { passive: true, capture: true });
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("touchstart", onTouch, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    // The page being left, for the back flight (popstate fires with location already changed).
    document.documentElement.dataset.flyFrom = pathname;
    const f = flight;
    if (!f) return;
    if (f.dir === "open") {
      if (pathname !== `/item/${f.id}`) return land();
      seek(landingPlace, 90);
    } else {
      if (pathname === `/item/${f.id}`) return land();
      // Two frames for the restored scroll position, then the card itself.
      seek(
        () => {
          for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[href="/item/${f.id}"]`)) {
            const img = photoIn(a);
            if (img && visible(drawnBox(img))) return img;
          }
          return null;
        },
        40,
        2,
      );
    }
  }, [pathname]);

  return null;
}
