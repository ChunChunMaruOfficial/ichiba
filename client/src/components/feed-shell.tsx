"use client";

import { MasonrySkeleton } from "./masonry";

/**
 * What a feed page's HTML holds before the client takes over. It is the fallback of the feed's own Suspense boundary
 * (the nearest one above useSearchParams, where the prerender bails out to the browser): a fallback on the page's
 * outer boundary never reaches the HTML. The feeds read the address (search params), so
 * Next renders them only in the browser: without this the server HTML had an empty <main>, the footer sat right
 * under the header and was pushed a screen's worth down once the cards arrived — a layout shift of ~0.9 on every
 * first visit. The skeleton keeps the footer where the content will be; the feed's own skeleton then takes over
 * in place, unnoticed.
 */
export function FeedShell({ wide = true }: { wide?: boolean }) {
  return (
    <div className={wide ? "mx-auto max-w-[1440px] px-4 md:px-6" : "mx-auto max-w-[1280px] px-4 md:px-6"}>
      {/* The discovery bar's row (chips) */}
      <div className="h-16" aria-hidden />
      <MasonrySkeleton />
    </div>
  );
}
