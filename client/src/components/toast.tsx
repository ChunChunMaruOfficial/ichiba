"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  tone?: "default" | "error";
  /** The same message shown again while this one was up. */
  repeat?: number;
}

type ToastFn = (message: string, opts?: { action?: Toast["action"]; tone?: Toast["tone"]; duration?: number }) => void;

const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

/**
 * Toasts at the top, just under the header (it may be tucked away: --header-offset). At the bottom they covered the
 * price and the buttons of the card being looked at — on «Свайп» three of them stacked over it. The same message again
 * restarts its timer instead of stacking a copy; a tap or a flick up puts a toast away. 4 s by default.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // What is on screen, readable from the callbacks without making them depend on it.
  const shown = useRef<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const show = useCallback((next: Toast[]) => {
    for (const x of shown.current) {
      if (next.some((y) => y.id === x.id)) continue;
      clearTimeout(timers.current.get(x.id));
      timers.current.delete(x.id);
    }
    shown.current = next;
    setToasts(next);
  }, []);

  const dismiss = useCallback((id: number) => show(shown.current.filter((x) => x.id !== id)), [show]);

  const toast = useCallback<ToastFn>(
    (message, opts = {}) => {
      // A toast with an action («Отменить», «Избранное») stays at least 10 s: 5 s is too short to read it and reach the
      // button (WCAG 2.2.1), and an undo that is gone before the reader gets to it is no undo at all.
      const ms = opts.action ? Math.max(opts.duration ?? 0, 10_000) : (opts.duration ?? 4000);
      const same = !opts.action && shown.current.find((x) => !x.action && x.message === message && x.tone === opts.tone);
      const id = same ? same.id : ++seq.current;
      show(
        same
          ? shown.current.map((x) => (x === same ? { ...x, repeat: (x.repeat ?? 1) + 1 } : x))
          : [...shown.current.slice(-1), { id, message, action: opts.action, tone: opts.tone }],
      );
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss, show],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* data-modal-keep: an open modal makes the rest of the page inert, but an undo toast must stay clickable. */}
      <div
        data-modal-keep
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(var(--header-offset,0px)+0.5rem)] z-[70] flex flex-col items-center gap-1.5 px-4 transition-[top] duration-300"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [dy, setDy] = useState(0);
  const from = useRef<number | null>(null);
  return (
    <div
      role="status"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        from.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (from.current != null) setDy(Math.min(0, e.clientY - from.current));
      }}
      onPointerUp={() => {
        if (from.current == null) return;
        from.current = null;
        // A flick up, or a plain tap, puts it away.
        if (dy < -16 || dy > -4) onDismiss();
        else setDy(0);
      }}
      onPointerCancel={() => {
        from.current = null;
        setDy(0);
      }}
      style={{ transform: dy ? `translateY(${dy}px)` : undefined, opacity: dy ? Math.max(0, 1 + dy / 60) : undefined }}
      className={`toast-down pointer-events-auto flex max-w-md touch-none select-none items-center gap-3 rounded-full py-2 pl-4 pr-4 text-[13px] leading-5 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.45)] ${
        t.tone === "error" ? "bg-danger text-accent-ink" : "bg-ink text-accent-ink"
      } ${t.action ? "pr-2" : ""}`}
    >
      <span>
        {t.message}
        {t.repeat && t.repeat > 1 && <span className="tabular ml-1.5 opacity-60">×{t.repeat}</span>}
      </span>
      {t.action && (
        <button
          className="shrink-0 rounded-full px-2.5 py-1 font-semibold underline-offset-4 hover:underline"
          onClick={() => {
            t.action!.onClick();
            onDismiss();
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}
