"use client";

import { useEffect } from "react";

/**
 * The on-screen keyboard, for the CSS (globals.css, «Keyboard»).
 *
 * Chrome on Android shrinks the page under the keyboard (interactive-widget=resizes-content in layout.tsx), but Safari
 * on iOS does not: it lays the keyboard over the page and slides the visible part (the visual viewport) up and down.
 * Bottom sheets, the chat composer and anything fixed to the bottom then end up under the keys. So:
 *
 * - html[data-typing]: a text field has focus on a touch screen. The tab bar and the fixed action bars step aside —
 *   on Android they would otherwise ride on top of the keyboard and cover the field being typed in.
 * - html[data-keyboard] with --kb (its height), --vvh and --vv-top (the part of the page still visible): sheets and
 *   the chat are fitted into what is left above the keys.
 */

const TEXT = /^(text|search|email|tel|url|password|number|date|datetime-local|time|month|week)$/;

function isTextField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return TEXT.test(el.type) && !el.readOnly;
  return el.isContentEditable;
}

export function useKeyboardInsets() {
  useEffect(() => {
    const root = document.documentElement;
    const coarse = window.matchMedia("(pointer: coarse)");
    const vv = window.visualViewport;

    const typing = () => root.toggleAttribute("data-typing", coarse.matches && isTextField(document.activeElement));

    let open = false;
    const measure = () => {
      if (!vv) return;
      // Pinch-zoomed in, the visual viewport is small for another reason: leave the page as it is.
      const kb = vv.scale > 1.01 ? 0 : Math.round(window.innerHeight - vv.height - vv.offsetTop);
      const now = kb > 80 && isTextField(document.activeElement);
      if (now) {
        root.style.setProperty("--kb", `${kb}px`);
        root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
        root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      } else if (open) {
        for (const v of ["--kb", "--vvh", "--vv-top"]) root.style.removeProperty(v);
      }
      root.toggleAttribute("data-keyboard", now);
      // The field being typed in stays in sight once the sheet around it has shrunk.
      if (now && !open) {
        const el = document.activeElement as HTMLElement;
        requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" }));
      }
      open = now;
    };

    // focusout fires before focus lands on the next field: wait a tick, or moving between fields flickers the bars.
    let t: ReturnType<typeof setTimeout> | undefined;
    const onFocus = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        typing();
        measure();
      }, 0);
    };

    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      clearTimeout(t);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, []);
}
