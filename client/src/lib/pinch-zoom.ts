"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Pinch a photo in a feed, as on Wildberries and Instagram: two fingers lift the photo out of its card, it grows and
 * follows the fingers over a darkening page, and on release it springs back into place. The browser's own pinch
 * (which zoomed the whole page) is switched off on the photo; one finger still scrolls and taps as before.
 *
 * The floating copy lives outside React (a fixed layer on <body>): it moves on every touchmove, and a re-render per
 * frame would stutter on phones.
 */

const MAX_SCALE = 4;
/** Pinching in below 1× gives way only a little, like a rubber band. */
const MIN_SCALE = 0.85;
const BACK_MS = 280;
/** Grown this much, the pinch counts as a look worth remembering (onZoom). */
const LOOK_SCALE = 1.4;

interface Options {
  /** A sharper copy to swap in once loaded (the card shows a small variant). */
  hiRes?: string;
  /** Once per pinch that really zoomed in. */
  onZoom?: () => void;
  enabled?: boolean;
}

type Pt = { x: number; y: number };
const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const mid = (a: Touch, b: Touch): Pt => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

/** Where an `object-contain` image actually shows inside its box. */
function shownRect(img: HTMLImageElement) {
  const r = img.getBoundingClientRect();
  const nw = img.naturalWidth || r.width;
  const nh = img.naturalHeight || r.height;
  const k = Math.min(r.width / nw, r.height / nh);
  const w = nw * k;
  const h = nh * k;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
}

/** A ref for the element around a photo (its visible <img> is the one lifted). */
export function usePinchZoom<T extends HTMLElement>({ hiRes, onZoom, enabled = true }: Options = {}) {
  const opts = useRef({ hiRes, onZoom });
  useEffect(() => {
    opts.current = { hiRes, onZoom };
  });
  const cleanup = useRef<(() => void) | null>(null);

  const ref = useCallback(
    (el: T | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!el || !enabled) return;
      // Pan stays with the browser (scrolling, carousels); pinch is ours.
      el.style.touchAction = "pan-x pan-y";

      let g: {
        d0: number;
        m0: Pt;
        img: HTMLImageElement;
        layer: HTMLDivElement;
        shade: HTMLDivElement;
        photo: HTMLImageElement;
        scale: number;
        looked: boolean;
        frame: number;
      } | null = null;
      let last: { s: number; t: Pt } = { s: 1, t: { x: 0, y: 0 } };

      const paint = () => {
        if (!g) return;
        g.frame = 0;
        g.photo.style.transform = `translate3d(${last.t.x}px, ${last.t.y}px, 0) scale(${last.s})`;
        g.shade.style.opacity = String(Math.min(0.72, Math.max(0, (last.s - 1) * 0.9)));
      };

      const begin = (a: Touch, b: Touch) => {
        // The photo itself, not the blurred copy behind it (BlurBackdrop, aria-hidden).
        const img = [...el.querySelectorAll("img")].find((i) => {
          const hidden = i.closest("[aria-hidden]");
          return !hidden || !el.contains(hidden);
        });
        if (!img || !img.complete || !img.naturalWidth) return;
        const r = shownRect(img);
        const m0 = mid(a, b);
        const layer = document.createElement("div");
        layer.setAttribute("aria-hidden", "true");
        layer.setAttribute("data-modal-keep", "");
        layer.style.cssText = "position:fixed;inset:0;z-index:95;pointer-events:none;";
        const shade = document.createElement("div");
        shade.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;";
        const photo = document.createElement("img");
        photo.src = img.currentSrc || img.src;
        photo.alt = "";
        photo.draggable = false;
        photo.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;object-fit:cover;border-radius:14px;box-shadow:0 18px 50px -12px rgb(0 0 0/.55);transform-origin:${m0.x - r.left}px ${m0.y - r.top}px;will-change:transform;`;
        layer.append(shade, photo);
        document.body.append(layer);
        const sharp = opts.current.hiRes;
        if (sharp && sharp !== photo.src) {
          const pre = new Image();
          pre.onload = () => {
            if (g?.photo === photo) photo.src = sharp;
          };
          pre.src = sharp;
        }
        // The card keeps an empty slot while its photo is up, as if it really left.
        img.style.visibility = "hidden";
        last = { s: 1, t: { x: 0, y: 0 } };
        g = { d0: Math.max(1, dist(a, b)), m0, img, layer, shade, photo, scale: 1, looked: false, frame: 0 };
      };

      const end = () => {
        if (!g) return;
        const { layer, shade, photo, img, frame } = g;
        if (frame) cancelAnimationFrame(frame);
        g = null;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const ms = reduce ? 120 : BACK_MS;
        photo.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow ${ms}ms`;
        shade.style.transition = `opacity ${ms}ms ease-out`;
        photo.style.transform = "none";
        photo.style.boxShadow = "none";
        shade.style.opacity = "0";
        window.setTimeout(() => {
          img.style.visibility = "";
          layer.remove();
        }, ms);
        // Lifting two fingers off a link must not open it. Caught on window, ahead of the document-level listeners
        // (photo-flight.tsx opens cards from there).
        const swallow = (e: Event) => {
          if (!el.contains(e.target as Node)) return;
          e.preventDefault();
          e.stopPropagation();
        };
        window.addEventListener("click", swallow, true);
        window.setTimeout(() => window.removeEventListener("click", swallow, true), 400);
      };

      const onStart = (e: TouchEvent) => {
        if (e.targetTouches.length < 2) return;
        if (e.cancelable) e.preventDefault();
        if (!g) begin(e.targetTouches[0], e.targetTouches[1]);
      };
      const onMove = (e: TouchEvent) => {
        if (!g || e.touches.length < 2) return;
        if (e.cancelable) e.preventDefault();
        const [a, b] = [e.touches[0], e.touches[1]];
        const r = dist(a, b) / g.d0;
        const s = r >= 1 ? Math.min(MAX_SCALE, r) : Math.max(MIN_SCALE, 1 - (1 - r) * 0.35);
        const m = mid(a, b);
        last = { s, t: { x: m.x - g.m0.x, y: m.y - g.m0.y } };
        if (!g.looked && s >= LOOK_SCALE) {
          g.looked = true;
          opts.current.onZoom?.();
        }
        g.frame ||= requestAnimationFrame(paint);
      };
      const onEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) end();
      };
      // iOS Safari's own pinch events: cancelled so the page itself doesn't zoom.
      const onGesture = (e: Event) => e.preventDefault();

      el.addEventListener("touchstart", onStart, { passive: false });
      el.addEventListener("touchmove", onMove, { passive: false });
      el.addEventListener("touchend", onEnd);
      el.addEventListener("touchcancel", onEnd);
      el.addEventListener("gesturestart", onGesture);
      cleanup.current = () => {
        end();
        el.style.touchAction = "";
        el.removeEventListener("touchstart", onStart);
        el.removeEventListener("touchmove", onMove);
        el.removeEventListener("touchend", onEnd);
        el.removeEventListener("touchcancel", onEnd);
        el.removeEventListener("gesturestart", onGesture);
      };
    },
    [enabled],
  );
  return ref;
}
