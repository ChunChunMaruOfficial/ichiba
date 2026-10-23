"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronLeft, IconChevronRight, IconX, useModalFocus } from "@/components/ui";
import type { ChatMedia } from "@/lib/types";
import { IconDownload } from "./icons";

/** Full-screen photos and videos of one message: arrows / swipe to flip, Esc or swipe down to close. */
export function MediaViewer({ media, start, title, onClose }: { media: ChatMedia[]; start: number; title: string; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Mounted only while shown: the chat behind is inert and Tab stays on the viewer's buttons.
  useModalFocus(true, root);
  const item = media[at];
  const go = (d: number) => setAt((i) => Math.min(media.length - 1, Math.max(0, i + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;
  const href = item.type === "photo" ? item.urls.l : item.url;
  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fade-in fixed inset-0 z-[80] flex flex-col bg-black/95 text-white"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
        else if (dy > 100 && Math.abs(dy) > Math.abs(dx)) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <p className="min-w-0 truncate text-sm text-white/80">
          {title}
          {media.length > 1 && <span className="ml-2 tabular text-white/60">{at + 1} из {media.length}</span>}
        </p>
        <div className="flex items-center gap-1">
          <a href={href} target="_blank" rel="noopener noreferrer" download aria-label="Скачать" title="Скачать" className="grid size-10 place-items-center rounded-full hover:bg-white/10">
            <IconDownload />
          </a>
          <button type="button" data-autofocus onClick={onClose} aria-label="Закрыть" className="grid size-10 place-items-center rounded-full hover:bg-white/10">
            <IconX />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {item.type === "photo" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={item.id} src={item.urls.l} alt="" width={item.width} height={item.height} className="fade-in max-h-full max-w-full select-none object-contain" draggable={false} />
        ) : (
          <video key={item.id} src={item.url} poster={item.poster || undefined} controls autoPlay playsInline className="fade-in max-h-full max-w-full" />
        )}
        {at > 0 && (
          <button type="button" onClick={() => go(-1)} aria-label="Предыдущее" className="absolute left-3 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:grid">
            <IconChevronLeft className="size-6" />
          </button>
        )}
        {at < media.length - 1 && (
          <button type="button" onClick={() => go(1)} aria-label="Следующее" className="absolute right-3 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:grid">
            <IconChevronRight className="size-6" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
