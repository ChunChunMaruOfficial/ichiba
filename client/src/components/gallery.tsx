"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePresence } from "@/lib/presence";
import type { Photo, VideoView } from "@/lib/types";
import { IconChevronLeft, IconChevronRight, IconExpand, IconX } from "./ui";

function VideoSlide({ video, className, style }: { video: VideoView; className?: string; style?: React.CSSProperties }) {
  return <video src={video.url} poster={video.poster} controls playsInline preload="metadata" className={clsx("bg-black object-contain", className)} style={style} />;
}

function PlayBadge() {
  return (
    <span className="absolute inset-0 grid place-items-center bg-black/25" aria-hidden>
      <span className="grid size-7 place-items-center rounded-full bg-white/90 text-[11px] text-ink">▶</span>
    </span>
  );
}

/**
 * Product gallery: main photo + thumbnails (desktop), swipe carousel (mobile), fullscreen viewer (frame 08).
 * A listing video, if any, is the last slide.
 */
export function Gallery({ photos, video, title, index, onIndex, overlay }: { photos: Photo[]; video?: VideoView | null; title: string; index: number; onIndex: (i: number) => void; overlay?: React.ReactNode }) {
  const [fullscreen, setFullscreen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const count = photos.length + (video ? 1 : 0);
  const onVideo = !!video && index === photos.length;
  const viewer = usePresence(fullscreen && !onVideo);
  const go = useCallback((i: number) => onIndex((i + count) % count), [onIndex, count]);

  // Keep the mobile carousel in sync when the index changes from outside (e.g. "Смотреть на фото" for defects).
  useEffect(() => {
    const el = strip.current;
    if (el && Math.round(el.scrollLeft / el.clientWidth) !== index) el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }, [index]);

  if (!count) return <div className="aspect-[4/5] rounded-3xl bg-skeleton" />;
  const current = photos[index] ?? photos[0];
  // Phone carousel: one frame for every slide, shaped like the cover (within sane bounds); each photo is shown whole.
  const first = photos[0];
  const frame = first ? Math.min(Math.max(first.width / first.height, 0.6), 1.5) : 0.8;
  const dots = [...photos.map((p) => p.id), ...(video ? [video.id] : [])];

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
            <button key={p.id} className="relative w-full shrink-0 snap-center overflow-hidden bg-skeleton" style={{ aspectRatio: frame }} onClick={() => setFullscreen(true)} aria-label={`Фото ${i + 1} из ${count}, открыть во весь экран`}>
              <BlurBackdrop src={p.urls.s} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.urls.l} alt={i === 0 ? title : ""} className="relative size-full object-contain" loading={i === 0 ? "eager" : "lazy"} />
            </button>
          ))}
          {video && (
            <div className="w-full shrink-0 snap-center">
              <VideoSlide video={video} className="w-full" style={{ aspectRatio: frame }} />
            </div>
          )}
        </div>
        {overlay}
        {count > 1 && (
          <div className={clsx("pointer-events-none absolute inset-x-0 flex justify-center gap-1.5", onVideo ? "top-3" : "bottom-3")} aria-hidden>
            {dots.map((id, i) => (
              <span key={id} className={clsx("size-1.5 rounded-full", i === index ? "bg-white" : "bg-white/50")} />
            ))}
          </div>
        )}
      </div>

      {/* Desktop: main photo + thumbnails */}
      <div className="hidden md:block">
        <div className="group relative overflow-hidden rounded-3xl bg-skeleton">
          {onVideo ? (
            <VideoSlide video={video} className="mx-auto max-h-[80vh] w-full" />
          ) : (
            <button className="block w-full cursor-zoom-in" onClick={() => setFullscreen(true)} aria-label="Открыть во весь экран">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={current.id} src={current.urls.l} alt={title} className="fade-in mx-auto max-h-[80vh] w-full object-contain" style={{ aspectRatio: `${current.width} / ${current.height}` }} />
            </button>
          )}
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
          {!onVideo && (
            <span className="tabular absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white">
              {index + 1} / {count}
              <IconExpand className="size-3.5" />
            </span>
          )}
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
                <img src={p.urls.s} alt="" className="size-full object-contain" />
                {p.isDefect && <span className="absolute inset-x-0 bottom-0 bg-warn-soft py-0.5 text-[10px] font-semibold text-warn">дефект</span>}
              </button>
            ))}
            {video && (
              <button
                onClick={() => onIndex(photos.length)}
                aria-label="Видео"
                aria-current={onVideo}
                className={clsx("relative size-18 overflow-hidden rounded-xl border-2", onVideo ? "border-ink" : "border-transparent opacity-80 hover:opacity-100")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={video.poster} alt="" className="size-full object-contain" />
                <PlayBadge />
              </button>
            )}
          </div>
        )}
      </div>

      {viewer.mounted && <Fullscreen photos={photos} index={Math.min(index, photos.length - 1)} onIndex={(i) => onIndex((i + photos.length) % photos.length)} onClose={() => setFullscreen(false)} closing={viewer.closing} />}
    </div>
  );
}

function Fullscreen({ photos, index, onIndex, onClose, closing }: { photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void; closing: boolean }) {
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
      data-closing={closing || undefined}
      className="fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black"
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

/** The same photo, blurred, filling the frame around a photo shown whole (as Instagram and Telegram do). */
export function BlurBackdrop({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-2xl" />;
}
