"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The photo flies between a card and the item page. A tap on a card's photo lifts that photo into a fixed layer
 * above the page; when the item page is in, the layer glides into the gallery's photo (marked data-fly-target) and
 * hands over to it, while the rest of the page fades in (<Main>'s fade). Going back flies the gallery photo into
 * its card the same way. The pages themselves don't change: the layer only covers the hand-over.
 *
 * Works on every link to /item/<id> that holds a photo, so every card on the site takes part. Skipped for reduced
 * motion, for a link opened in a new tab, and after an iOS edge swipe (Safari animates that one itself).
 */

const ITEM = /^\/item\/([0-9a-f-]{36})$/i;
const DURATION = 300;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const LIFT = 1.03;
const SHADOW = "0 18px 40px rgb(0 0 0 / 0.18)";

type Box = { left: number; top: number; width: number; height: number };

let flight: {
  id: string;
  dir: "open" | "back";
  layer: HTMLImageElement;
  from: Box;
  radius: string;
  /** The photo the layer stands in for; shown again when the flight ends. */
  source: HTMLImageElement;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the picture itself is drawn: an object-contain photo leaves bands inside its box. */
function drawnBox(img: HTMLImageElement): Box {
  const r = img.getBoundingClientRect();
  const w = Number(img.dataset.flyW) || img.naturalWidth;
  const h = Number(img.dataset.flyH) || img.naturalHeight;
  if (getComputedStyle(img).objectFit !== "contain" || !w || !h) return { left: r.left, top: r.top, width: r.width, height: r.height };
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
const css = (b: Box) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });

/** The card photo inside a link: the biggest loaded <img> that isn't a blurred backdrop. */
function photoIn(link: HTMLAnchorElement) {
  let best: HTMLImageElement | null = null;
  let area = 0;
  for (const img of link.querySelectorAll<HTMLImageElement>("img")) {
    const hidden = img.closest("[aria-hidden='true']");
    if ((hidden && hidden !== link) || !img.complete || !img.naturalWidth) continue;
    const r = img.getBoundingClientRect();
    if (r.width * r.height > area) [best, area] = [img, r.width * r.height];
  }
  return best;
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
  });
  document.body.appendChild(layer);
  source.style.visibility = "hidden";
  // Answers the tap at once, while the next page is still on its way: the photo lifts off the page a little.
  layer.animate([{ transform: "none", boxShadow: "none" }, { transform: `scale(${LIFT})`, boxShadow: SHADOW }], { duration: 160, easing: EASE, fill: "forwards" });
  // A navigation that never comes (cancelled, failed, very slow) must not leave the photo hanging over the page.
  const timer = setTimeout(land, 4000);
  flight = { id, dir, layer, from, radius, source, timer };
}

/** Ends the flight at once: the layer goes, every photo it covered is shown again. */
function land() {
  if (!flight) return;
  clearTimeout(flight.timer);
  flight.layer.remove();
  flight.source.style.visibility = "";
  flight = null;
}

/** Glides the layer onto `target`, shows the target and lets the layer go. */
function glide(target: HTMLImageElement) {
  const f = flight;
  if (!f) return;
  clearTimeout(f.timer);
  const to = drawnBox(target);
  if (!visible(to)) return fadeAway();
  target.style.visibility = "hidden";
  const anim = f.layer.animate(
    [
      { ...css(f.from), borderRadius: f.radius, transform: `scale(${LIFT})`, boxShadow: SHADOW },
      { ...css(to), borderRadius: radiusOf(target), transform: "none", boxShadow: "none" },
    ],
    { duration: DURATION, easing: EASE, fill: "forwards" },
  );
  const done = () => {
    if (flight !== f) return;
    target.style.visibility = "";
    // A breath of overlap hides the moment the full-size photo takes over from the card-size one.
    f.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" }).onfinish = () => {
      if (flight === f) land();
    };
  };
  anim.onfinish = () => (target.complete && target.naturalWidth ? done() : ((target.onload = done), (f.timer = setTimeout(done, 800))));
}

/** No place to land (the card scrolled away, another page): the photo just fades. */
function fadeAway() {
  const f = flight;
  if (!f) return;
  f.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" }).onfinish = () => {
    if (flight === f) land();
  };
}

/** The gallery photo on screen (phones and desktop each have their own; the other one is display:none). */
function galleryPhoto() {
  return [...document.querySelectorAll<HTMLImageElement>("img[data-fly-target]")].find((img) => img.getClientRects().length > 0) ?? null;
}

/** Looks for the landing place for a few frames: the new page may still be mounting or restoring its scroll. */
function seek(find: () => HTMLImageElement | null, frames: number, settle = 0) {
  const f = flight;
  let n = 0;
  const step = () => {
    if (flight !== f) return;
    const el = n >= settle ? find() : null;
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
      const target = galleryPhoto();
      if (target && target.complete && target.naturalWidth) lift(id, "back", target);
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
      seek(galleryPhoto, 90);
    } else {
      if (pathname === `/item/${f.id}`) return land();
      // Two frames for the restored scroll position, then the card itself.
      seek(() => {
        const links = document.querySelectorAll<HTMLAnchorElement>(`a[href="/item/${f.id}"]`);
        for (const a of links) {
          const img = photoIn(a);
          if (img && visible(drawnBox(img))) return img;
        }
        return null;
      }, 40, 2);
    }
  }, [pathname]);

  return null;
}
