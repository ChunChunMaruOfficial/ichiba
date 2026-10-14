"use client";

import { useParams } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { BlurBackdrop } from "@/components/blur-backdrop";
import { desktopFrame } from "@/components/gallery";
import { flyingPhoto } from "@/components/photo-flight";
import { Skeleton } from "@/components/ui";

/** The gallery's blurred backdrop, shown only as the photo lands: a blur of it under a photo still in flight reads as a second photo. */
function ArrivingBackdrop({ src }: { src: string }) {
  return (
    <span className="shell-backdrop absolute inset-0">
      <BlurBackdrop src={src} />
    </span>
  );
}

/**
 * The item page while the server prepares it, shown the moment a card is tapped. Laid out like the page itself:
 * the gallery's frame and the text as skeletons. When the card's photo is flying in (photo-flight.tsx), the frame
 * is sized for that photo exactly as the gallery will be, with the same blurred backdrop, so the photo lands at once
 * and the real gallery takes its place unnoticed; the text then fades in over the skeletons.
 */
export default function ItemLoading() {
  const { id } = useParams<{ id: string }>();
  const [photo] = useState(() => flyingPhoto(id));
  const fly = photo && { "data-fly-target": "", "data-fly-w": photo.width, "data-fly-h": photo.height };
  // The phone carousel's frame is shaped like the cover within sane bounds (gallery.tsx).
  const frame = photo ? Math.min(Math.max(photo.width / photo.height, 0.6), 1.5) : 0.8;
  // The page opens at its top, and before the first paint: the shell is short, so the browser would otherwise
  // keep the old scroll as far as it goes (the photo's frame off screen).
  useLayoutEffect(() => window.scrollTo(0, 0), []);
  return (
    // Taller than the screen, so the footer (and the branch over it) stays below until the page itself is in.
    <div className="mx-auto min-h-[140dvh] max-w-[1280px] px-4 pb-8 pt-4 md:px-6 md:pb-16" aria-busy aria-label="Загружаем вещь">
      {/* The breadcrumbs' line. */}
      <div className="mb-4 hidden h-5 md:block" />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] md:gap-12">
        <div>
          {/* Phones: the carousel's frame. */}
          <div className="-mx-4 md:hidden">
            <div className="relative w-full overflow-hidden bg-skeleton" style={{ aspectRatio: frame }}>
              {photo && <ArrivingBackdrop src={photo.src} />}
              {photo && <div className="relative size-full" {...fly} />}
            </div>
          </div>
          {/* Desktop: the main photo's frame and the thumbnails under it. */}
          <div className="hidden md:block">
            {/* The gallery's frame as far as the flying photo tells (the gallery shapes it by its widest photo). */}
            <div className="relative mx-auto overflow-hidden rounded-3xl bg-skeleton" style={desktopFrame(photo ? [photo] : [])}>
              {photo && <ArrivingBackdrop src={photo.src} />}
              {photo && <div className="absolute inset-0" {...fly} />}
            </div>
            <div className="mx-auto mt-3 flex gap-2" style={{ width: desktopFrame(photo ? [photo] : []).width }}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="size-18 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
        {/* The text: title, price tag, details, the buttons. */}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="mt-2 h-11 w-36 rounded-lg" />
          <div className="mt-3 flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-12 rounded-lg" />
            ))}
          </div>
          {[0.55, 0.45, 0.6, 0.4, 0.5].map((w, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${w * 100}%` }} />
          ))}
          <Skeleton className="mt-4 h-13 w-full rounded-full" />
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
