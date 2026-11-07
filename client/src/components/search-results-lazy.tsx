"use client";

import dynamic from "next/dynamic";
import { MasonrySkeleton } from "./masonry";

/**
 * The search results and the swipe deck are loaded only when the page shows them: a guest's first paint of the home
 * page or «Вторичка» is the chip row and the feed, and neither needs the 700 lines of filters, the photo-search
 * flow or the deck. They stay in search-view.tsx and swipe-deck.tsx with their helpers; this file only tells the
 * bundler to split them off (Lighthouse mobile: the home page's main-thread work was 7 s, most of it hydration).
 */
const skeleton = () => (
  <div className="pt-2">
    <MasonrySkeleton />
  </div>
);

export const SearchResults = dynamic(() => import("./search-view").then((m) => m.SearchResults), { loading: skeleton });
export const PhotoResults = dynamic(() => import("./search-view").then((m) => m.PhotoResults), { loading: skeleton });
export const SwipeDeck = dynamic(() => import("./swipe-deck").then((m) => m.SwipeDeck), { loading: skeleton });
