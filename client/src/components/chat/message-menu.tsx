"use client";

import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/lib/presence";
import type { ChatReaction } from "@/lib/types";

/** Kept in sync with REACTIONS on the server (chat.ts). */
export const REACTIONS = ["👍", "❤️", "🔥", "😂", "😮", "😢", "🙏", "👎"] as const;

export interface MenuAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

export interface MenuAnchor {
  /** Right click: the cursor. Long press: the message itself. */
  point?: { x: number; y: number };
  rect?: DOMRect;
  touch: boolean;
}

const GAP = 8;

/**
 * The message menu, as in Telegram: quick reactions on top, actions below. On desktop it opens at the cursor;
 * on touch screens over a dimmed chat, next to the held message. Esc, a click outside or scrolling closes it.
 */
export function MessageMenu({
  anchor,
  actions,
  reactions,
  onReact,
  onClose,
}: {
  anchor: MenuAnchor | null;
  actions: MenuAction[];
  reactions?: ChatReaction[];
  onReact?: (emoji: string) => void;
  onClose: () => void;
}) {
  const { mounted, closing } = usePresence(!!anchor, 120);
  const [last, setLast] = useState(anchor);
  if (anchor && anchor !== last) setLast(anchor);
  if (!mounted || !last) return null;
  return createPortal(<MenuBody anchor={last} closing={closing} actions={actions} reactions={reactions} onReact={onReact} onClose={onClose} />, document.body);
}

function MenuBody({
  anchor,
  closing,
  actions,
  reactions,
  onReact,
  onClose,
}: {
  anchor: MenuAnchor;
  closing: boolean;
  actions: MenuAction[];
  reactions?: ChatReaction[];
  onReact?: (emoji: string) => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);

  // Place the menu once its size is known, inside the viewport.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    let origin = "top left";
    if (anchor.point) {
      left = anchor.point.x;
      top = anchor.point.y;
      if (left + w > vw - GAP) {
        left = Math.max(GAP, left - w);
        origin = "top right";
      }
      if (top + h > vh - GAP) {
        top = Math.max(GAP, top - h);
        origin = origin.replace("top", "bottom");
      }
    } else {
      const r = anchor.rect!;
      left = Math.min(Math.max(GAP, r.left), vw - w - GAP);
      if (r.bottom + GAP + h <= vh - GAP) top = r.bottom + GAP;
      else if (r.top - GAP - h >= GAP) {
        top = r.top - GAP - h;
        origin = "bottom left";
      } else top = Math.max(GAP, vh - h - GAP);
    }
    setPos({ left, top, origin });
  }, [anchor]);

  // Focus the first item; arrows move between items, Esc closes.
  useLayoutEffect(() => {
    if (!anchor.touch) card.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(card.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    document.addEventListener("wheel", onScroll, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("wheel", onScroll);
    };
  }, [anchor, onClose]);

  return (
    <div
      data-closing={closing || undefined}
      className={clsx("fade-in fixed inset-0 z-[70]", anchor.touch && "bg-[var(--scrim)] backdrop-blur-[2px]")}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={card}
        role="menu"
        aria-label="Действия с сообщением"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, transformOrigin: pos?.origin }}
        className="menu-pop fixed flex w-max min-w-56 max-w-[calc(100vw-16px)] flex-col gap-2"
      >
        {onReact && (
          <div className="flex items-center gap-0.5 self-start rounded-full bg-surface p-1 shadow-[var(--shadow-float)] ring-1 ring-line">
            {REACTIONS.map((emoji) => {
              const mine = reactions?.some((r) => r.emoji === emoji && r.mine);
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Реакция ${emoji}`}
                  aria-pressed={mine}
                  onClick={() => {
                    onReact(emoji);
                    onClose();
                  }}
                  className={clsx("grid size-10 place-items-center rounded-full text-[22px] transition-transform hover:scale-125 active:scale-95", mine && "bg-accent-soft")}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        )}
        <div className="overflow-hidden rounded-2xl bg-surface py-1.5 shadow-[var(--shadow-float)] ring-1 ring-line">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                a.onSelect();
              }}
              className={clsx(
                "flex w-full items-center gap-3 px-4 text-left text-[15px] outline-none hover:bg-ink/5 focus-visible:bg-ink/5",
                anchor.touch ? "py-3" : "py-2",
                a.danger ? "text-danger" : "text-ink",
              )}
            >
              <span className={clsx("shrink-0", a.danger ? "text-danger" : "text-ink-2")}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
