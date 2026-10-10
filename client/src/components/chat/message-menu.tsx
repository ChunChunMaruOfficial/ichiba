"use client";

import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/lib/presence";
import type { ChatReaction } from "@/lib/types";

/** Kept in sync with REACTIONS on the server (chat.ts). */
const REACTIONS = ["👍", "❤️", "🔥", "😂", "😮", "😢", "🙏", "👎"] as const;

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
  /** Long press: the held bubble, shown lifted above the dimmed chat while the menu is open. */
  el?: HTMLElement;
  touch: boolean;
}

const GAP = 8;
/** Space kept free at the screen edges on phones (status bar, home indicator). */
const EDGE = 12;
/** Preview flight to and from its place in the chat. A slight overshoot, like iOS context menus. */
const FLY_IN = "transform 320ms cubic-bezier(0.32, 1.25, 0.5, 1)";
const FLY_OUT = "transform 200ms cubic-bezier(0.4, 0, 0.6, 1)";

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
  const { mounted, closing } = usePresence(!!anchor, 200);
  const [last, setLast] = useState(anchor);
  if (anchor && anchor !== last) setLast(anchor);
  if (!mounted || !last) return null;
  const props = { closing, actions, reactions, onReact, onClose };
  return createPortal(last.touch && last.el ? <TouchMenu el={last.el} {...props} /> : <MenuBody anchor={last} {...props} />, document.body);
}

interface TouchLayout {
  /** Final box of the lifted message (top-left corner, scale). */
  left: number;
  top: number;
  scale: number;
  barTop: number;
  listTop: number;
  /** Reactions and actions line up with this edge of the message: right for mine, left for theirs. */
  edge: { left: number } | { right: number };
}

/**
 * Phones, as in Telegram for iOS: the held message is lifted out of the blurred chat — reactions above it, actions
 * below. A message too tall for both (a photo) shrinks so everything fits on the screen; it flies there from its place
 * in the chat and back on close.
 */
function TouchMenu({
  el,
  closing,
  actions,
  reactions,
  onReact,
  onClose,
}: {
  el: HTMLElement;
  closing: boolean;
  actions: MenuAction[];
  reactions?: ChatReaction[];
  onReact?: (emoji: string) => void;
  onClose: () => void;
}) {
  const preview = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [rect] = useState(() => el.getBoundingClientRect());
  const [layout, setLayout] = useState<TouchLayout | null>(null);
  const [flown, setFlown] = useState(false);

  // The lifted copy; the original stays in place, hidden by the bubble itself while its menu is open on a phone.
  useLayoutEffect(() => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-bubble");
    Object.assign(copy.style, { width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", transform: "none", scale: "1", boxShadow: "none", visibility: "visible" });
    preview.current?.replaceChildren(copy);
  }, [el, rect]);

  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const barH = bar.current ? bar.current.offsetHeight + GAP : 0;
    const listH = list.current?.offsetHeight ?? 0;
    const scale = Math.min(1, (vh - 2 * EDGE - barH - GAP - listH) / rect.height, (vw - 2 * GAP) / rect.width);
    const w = rect.width * scale;
    const h = rect.height * scale;
    const mine = rect.left + rect.width / 2 > vw / 2;
    const left = Math.min(Math.max(GAP, mine ? rect.right - w : rect.left), vw - w - GAP);
    // Keep the message where it was when everything fits; otherwise slide the whole stack onto the screen.
    const stackTop = Math.min(Math.max(EDGE, rect.top - barH), vh - EDGE - (barH + h + GAP + listH));
    const top = stackTop + barH;
    setLayout({ left, top, scale, barTop: stackTop, listTop: top + h + GAP, edge: mine ? { right: vw - left - w } : { left } });
  }, [rect]);

  // Start where the message is in the chat, then fly to the menu position (and back when closing).
  useLayoutEffect(() => {
    if (!layout) return;
    const id = requestAnimationFrame(() => setFlown(true));
    return () => cancelAnimationFrame(id);
  }, [layout]);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("resize", onClose);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onClose);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const atRest = layout ? `translate(${rect.left - layout.left}px, ${rect.top - layout.top}px)` : "none";
  const right = !!layout && "right" in layout.edge;
  const hidden = { left: -9999, top: -9999 };

  return (
    <div
      data-closing={closing || undefined}
      className="fade-in fixed inset-0 z-[70] bg-[var(--scrim)] backdrop-blur-md"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={preview}
        aria-hidden
        onPointerDown={onClose}
        className="fixed origin-top-left drop-shadow-[0_12px_32px_rgba(0,0,0,0.22)]"
        style={{
          ...(layout ? { left: layout.left, top: layout.top } : hidden),
          width: rect.width,
          height: rect.height,
          transform: flown && !closing ? `scale(${layout?.scale ?? 1})` : atRest,
          transition: closing ? FLY_OUT : flown ? FLY_IN : "none",
        }}
      />
      {onReact && (
        <div
          ref={bar}
          className={clsx("menu-pop fixed max-w-[calc(100vw-16px)] overflow-x-auto", right ? "origin-bottom-right" : "origin-bottom-left")}
          style={layout ? { top: layout.barTop, ...layout.edge } : hidden}
        >
          <Reactions reactions={reactions} onReact={onReact} onClose={onClose} />
        </div>
      )}
      <div
        ref={list}
        role="menu"
        aria-label="Действия с сообщением"
        className={clsx("menu-pop fixed w-60 max-w-[calc(100vw-16px)]", right ? "origin-top-right" : "origin-top-left")}
        style={layout ? { top: layout.listTop, ...layout.edge } : hidden}
      >
        <Actions actions={actions} touch onClose={onClose} />
      </div>
    </div>
  );
}

function Reactions({ reactions, onReact, onClose }: { reactions?: ChatReaction[]; onReact: (emoji: string) => void; onClose: () => void }) {
  return (
    <div className="flex w-max items-center gap-0.5 rounded-full bg-surface p-1 shadow-[var(--shadow-float)] ring-1 ring-line">
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
  );
}

function Actions({ actions, touch, onClose }: { actions: MenuAction[]; touch: boolean; onClose: () => void }) {
  return (
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
            touch ? "py-3" : "py-2",
            a.danger ? "text-danger" : "text-ink",
          )}
        >
          <span className={clsx("shrink-0", a.danger ? "text-danger" : "text-ink-2")}>{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  );
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
          <div className="self-start">
            <Reactions reactions={reactions} onReact={onReact} onClose={onClose} />
          </div>
        )}
        <Actions actions={actions} touch={anchor.touch} onClose={onClose} />
      </div>
    </div>
  );
}
