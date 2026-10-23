"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  tone?: "default" | "error";
}

type ToastFn = (message: string, opts?: { action?: Toast["action"]; tone?: Toast["tone"]; duration?: number }) => void;

const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

/** Bottom toasts, 4 s by default (frame 05). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback<ToastFn>(
    (message, opts = {}) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, message, action: opts.action, tone: opts.tone }]);
      // A toast with an action («Отменить», «Избранное») stays at least 10 s: 5 s is too short to read it and reach the
      // button (WCAG 2.2.1), and an undo that is gone before the reader gets to it is no undo at all.
      setTimeout(() => dismiss(id), opts.action ? Math.max(opts.duration ?? 0, 10_000) : (opts.duration ?? 4000));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* data-modal-keep: an open modal makes the rest of the page inert, but an undo toast must stay clickable. */}
      <div
        data-modal-keep
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`sheet-up pointer-events-auto flex max-w-md items-center gap-4 rounded-xl px-4 py-3 text-sm shadow-lg ${
              t.tone === "error" ? "bg-danger text-accent-ink" : "bg-ink text-accent-ink"
            }`}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                className="shrink-0 font-semibold underline-offset-4 hover:underline"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
