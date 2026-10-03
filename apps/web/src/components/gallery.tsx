"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Photo } from "@/lib/types";
import { IconChevronLeft, IconChevronRight, IconExpand, IconX } from "./ui";

/** Product gallery: main photo + thumbnails (desktop), swipe carousel (mobile), fullscreen viewer (frame 08). */
export function Gallery({ photos, title, index, onIndex, overlay }: { photos: Photo[]; title: string; index: number; onIndex: (i: number) => void; overlay?: React.ReactNode }) {
  const [fullscreen, setFullscreen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const count = photos.length;
  const go = useCallback((i: number) => onIndex((i + count) % count), [onIndex, count]);

  // Keep the mobile carousel in sync when the index changes from outside (e.g. "Смотреть на фото" for defects).
  useEffect(() => {
    const el = strip.current;
    if (el && Math.round(el.scrollLeft / el.clientWidth) !== index) el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }, [index]);

  if (!count) return <div className="aspect-[4/5] rounded-3xl bg-skeleton" />;
  const current = photos[index] ?? photos[0];

  return (
    <div>
      {/* Mobile: swipe carousel */}
      <div className="relative -mx-4 md:hidden">
        <div
          ref={strip}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            const i = Math.round(el.scrollLeft / el.clientWidth);
            if (i !== index) onIndex(i);
          }}
        >
          {photos.map((p, i) => (
            <button key={p.id} className="w-full shrink-0 snap-center" onClick={() => setFullscreen(true)} aria-label={`Фото ${i + 1} из ${count}, открыть во весь экран`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.urls.l} alt={i === 0 ? title : ""} className="aspect-[4/5] w-full object-cover" loading={i === 0 ? "eager" : "lazy"} />
            </button>
          ))}
        </div>
        {overlay}
        {count > 1 && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden>
            {photos.map((p, i) => (
              <span key={p.id} className={clsx("size-1.5 rounded-full", i === index ? "bg-white" : "bg-white/50")} />
            ))}
          </div>
        )}
      </div>

      {/* Desktop: main photo + thumbnails */}
      <div className="hidden md:block">
        <div className="group relative overflow-hidden rounded-3xl bg-skeleton">
          <button className="block w-full cursor-zoom-in" onClick={() => setFullscreen(true)} aria-label="Открыть во весь экран">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={current.id} src={current.urls.l} alt={title} className="fade-in mx-auto max-h-[80vh] w-full object-contain" style={{ aspectRatio: `${current.width} / ${current.height}` }} />
          </button>
          {overlay}
          {count > 1 && (
            <>
              <button aria-label="Предыдущее фото" onClick={() => go(index - 1)} className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow transition group-hover:opacity-100 focus:opacity-100">
                <IconChevronLeft />
              </button>
              <button aria-label="Следующее фото" onClick={() => go(index + 1)} className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow transition group-hover:opacity-100 focus:opacity-100">
                <IconChevronRight />
              </button>
            </>
          )}
          <span className="tabular absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white">
            {index + 1} / {count}
            <IconExpand className="size-3.5" />
          </span>
        </div>
        {count > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <button
                key={p.id}
                onMouseEnter={() => onIndex(i)}
                onClick={() => onIndex(i)}
                aria-label={`Фото ${i + 1}${p.isDefect ? ", дефект" : ""}`}
                aria-current={i === index}
                className={clsx("relative size-18 overflow-hidden rounded-xl border-2", i === index ? "border-ink" : "border-transparent opacity-80 hover:opacity-100")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.urls.s} alt="" className="size-full object-cover" />
                {p.isDefect && <span className="absolute inset-x-0 bottom-0 bg-warn-soft py-0.5 text-[10px] font-semibold text-warn">дефект</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {fullscreen && <Fullscreen photos={photos} index={index} onIndex={go} onClose={() => setFullscreen(false)} />}
    </div>
  );
}

function Fullscreen({ photos, index, onIndex, onClose }: { photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [zoomFor, setZoomFor] = useState(index);
  if (zoomFor !== index) {
    setZoomFor(index);
    setZoom(1);
  }
  const touchX = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndex(index - 1);
      if (e.key === "ArrowRight") onIndex(index + 1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [index, onIndex, onClose]);
  const p = photos[index];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр фото"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black"
      onWheel={(e) => setZoom((z) => Math.min(3, Math.max(1, z - e.deltaY * 0.002)))}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null || zoom > 1) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) onIndex(index + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={p.urls.l}
        alt=""
        onClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
        className={clsx("max-h-full max-w-full object-contain transition-transform", zoom > 1 ? "cursor-zoom-out" : "cursor-zoom-in")}
        style={{ transform: `scale(${zoom})` }}
      />
      <button aria-label="Закрыть" onClick={onClose} className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
        <IconX />
      </button>
      {photos.length > 1 && (
        <>
          <button aria-label="Предыдущее фото" onClick={() => onIndex(index - 1)} className="absolute left-4 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 md:grid">
            <IconChevronLeft />
          </button>
          <button aria-label="Следующее фото" onClick={() => onIndex(index + 1)} className="absolute right-4 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 md:grid">
            <IconChevronRight />
          </button>
          <span className="tabular absolute bottom-6 left-1/2 -translate-x-1/2 text-sm text-white/80">
            {index + 1} / {photos.length}
          </span>
        </>
      )}
    </div>
  );
}
