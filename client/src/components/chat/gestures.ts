"use client";

import { useEffect, useRef } from "react";

/** Long press opens the menu; how far a swipe must travel to reply. */
const LONG_PRESS_MS = 420;
const SWIPE_REPLY_PX = 56;
const SWIPE_MAX_PX = 72;
/** Leave the screen edge to the browser's own back gesture (iOS Safari). */
const EDGE_PX = 24;
const DOUBLE_TAP_MS = 280;

const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

/**
 * Touch gestures on a message, as in Telegram mobile: hold to open the menu, swipe right to reply,
 * double tap for a quick reaction. Mouse input is left alone (right click opens the menu instead).
 * `target` is the element that slides; `hint` is the reply arrow that fades in behind it.
 */
export function useMessageGestures(opts: {
  disabled?: boolean;
  onLongPress: () => void;
  onSwipeReply: () => void;
  onDoubleTap?: () => void;
  onContextMenu: (at: { x: number; y: number }) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });
  const s = useRef({ id: -1, x: 0, y: 0, mode: "idle" as "idle" | "press" | "swipe" | "scroll", timer: 0, offset: 0, armed: false, suppressClick: false, lastTap: 0, lastPointer: "mouse" });

  const paint = (offset: number, animate: boolean) => {
    const el = target.current;
    if (el) {
      el.style.transition = animate ? "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
      el.style.transform = offset ? `translateX(${offset}px)` : "";
    }
    const h = hint.current;
    if (h) {
      const share = Math.min(1, offset / SWIPE_REPLY_PX);
      h.style.transition = animate ? "opacity 200ms, transform 200ms" : "none";
      h.style.opacity = String(share);
      h.style.transform = `scale(${0.6 + share * 0.4})`;
    }
  };

  const reset = () => {
    clearTimeout(s.current.timer);
    if (s.current.offset) paint(0, true);
    s.current.mode = "idle";
    s.current.offset = 0;
    s.current.armed = false;
    s.current.id = -1;
  };

  useEffect(() => () => clearTimeout(s.current.timer), []);

  const onPointerDown = (e: React.PointerEvent) => {
    s.current.lastPointer = e.pointerType;
    if (e.pointerType !== "touch" || cb.current.disabled || !e.isPrimary) return;
    s.current.id = e.pointerId;
    s.current.x = e.clientX;
    s.current.y = e.clientY;
    s.current.mode = "press";
    s.current.suppressClick = false;
    clearTimeout(s.current.timer);
    s.current.timer = window.setTimeout(() => {
      if (s.current.mode !== "press") return;
      s.current.mode = "idle";
      s.current.suppressClick = true;
      vibrate(12);
      cb.current.onLongPress();
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = s.current;
    if (e.pointerId !== st.id || st.mode === "idle" || st.mode === "scroll") return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (st.mode === "press") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      clearTimeout(st.timer);
      // Mostly sideways and to the right → reply swipe; anything else is the list scrolling.
      if (dx > 0 && dx > Math.abs(dy) * 1.4 && st.x > EDGE_PX) st.mode = "swipe";
      else {
        st.mode = "scroll";
        return;
      }
    }
    // Rubber band past the maximum.
    const offset = dx <= 0 ? 0 : dx < SWIPE_MAX_PX ? dx : SWIPE_MAX_PX + (dx - SWIPE_MAX_PX) * 0.2;
    st.offset = offset;
    paint(offset, false);
    if (!st.armed && offset >= SWIPE_REPLY_PX) {
      st.armed = true;
      vibrate(8);
    } else if (st.armed && offset < SWIPE_REPLY_PX) st.armed = false;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const st = s.current;
    if (e.pointerId !== st.id) return;
    const mode = st.mode;
    const armed = st.armed;
    reset();
    if (mode === "swipe") {
      st.suppressClick = true;
      if (armed) cb.current.onSwipeReply();
      return;
    }
    if (mode === "press" && cb.current.onDoubleTap) {
      const now = Date.now();
      if (now - st.lastTap < DOUBLE_TAP_MS) {
        st.lastTap = 0;
        cb.current.onDoubleTap();
      } else st.lastTap = now;
    }
  };

  return {
    target,
    hint,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: reset,
      // Android also fires contextmenu on a long press: the timer above handles touch.
      onContextMenu: (e: React.MouseEvent) => {
        if (cb.current.disabled) return;
        e.preventDefault();
        if (s.current.lastPointer === "touch") return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        // Keyboard (menu key / Shift+F10) reports 0,0: open next to the message instead.
        cb.current.onContextMenu(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left + r.width / 2, y: r.top + 24 });
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (!s.current.suppressClick) return;
        s.current.suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}
