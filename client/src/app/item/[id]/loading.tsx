"use client";

import { useParams } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { flyingPhoto } from "@/components/photo-flight";
import { Skeleton } from "@/components/ui";

/**
 * The item page while the server prepares it, shown the moment a card is tapped. When the card's photo is flying
 * in (photo-flight.tsx), the shell holds only the gallery's frame, sized for that photo exactly as the gallery will
 * be, so the photo lands at once and the page fades in around it; otherwise it is the usual skeleton.
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
    <div className="mx-auto min-h-[140dvh] max-w-[1280px] px-4 pb-8 pt-4 md:px-6 md:pb-16">
      {/* The breadcrumbs' line. */}
      <div className="mb-4 hidden h-5 md:block" />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] md:gap-12">
        <div>
          <div className="-mx-4 md:hidden">
            <div className={photo ? "w-full" : "w-full bg-skeleton"} style={{ aspectRatio: frame }} {...fly} />
          </div>
          <div className="hidden overflow-hidden rounded-3xl md:block">
            {photo ? <div className="mx-auto max-h-[80vh] w-full" style={{ aspectRatio: `${photo.width} / ${photo.height}` }} {...fly} /> : <Skeleton className="aspect-[4/5] rounded-3xl" />}
          </div>
        </div>
        {!photo && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-10 w-1/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="mt-4 h-13 w-full rounded-xl" />
          </div>
        )}
      </div>
    </div>
  );
}
