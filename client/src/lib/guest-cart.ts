"use client";

import { useSyncExternalStore } from "react";

/**
 * A guest's cart, kept in this browser (localStorage) until they sign in; then SessionProvider moves it into the
 * account. Items carry the size picked on a «Несколько размеров» listing.
 */
export interface GuestCartItem {
  listingId: string;
  size?: string | null;
}

const KEY = "ichiba.guestCart";
const EMPTY: GuestCartItem[] = [];
const listeners = new Set<() => void>();
let cache: GuestCartItem[] | null = null;

function read(): GuestCartItem[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(raw) ? raw.filter((i) => i && typeof i.listingId === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: GuestCartItem[]) {
  cache = items;
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the cart lives until the tab closes */
  }
  for (const l of listeners) l();
}

export const guestCart = {
  items: read,
  has: (listingId: string) => read().some((i) => i.listingId === listingId),
  add: (listingId: string, size?: string | null) => write([{ listingId, size: size ?? null }, ...read().filter((i) => i.listingId !== listingId)].slice(0, 50)),
  remove: (listingId: string) => write(read().filter((i) => i.listingId !== listingId)),
  clear: () => write([]),
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Another tab changed the cart.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** The guest cart, re-rendering on every change (also from other tabs). Empty on the server. */
export function useGuestCart() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
