"use client";

import { useSyncExternalStore } from "react";
import type { PhotoUrls } from "./api";

/**
 * Accounts this browser signed out of and may come back to with one tap («Войти как @nick» in the sign-in popup,
 * «Сменить аккаунт» in the account menu). Each holds a device key the server issued at sign-out (auth
 * device-key / device-login); the key lives only here, in localStorage, and the server keeps its hash.
 */
export interface RememberedAccount {
  id: string;
  username: string;
  avatar: PhotoUrls | null;
  key: string;
  expiresAt: string;
  rememberedAt: string;
}

const KEY = "ichiba:accounts";
const EVENT = "ichiba:accounts";
const EMPTY: RememberedAccount[] = [];
let cached: { raw: string | null; list: RememberedAccount[] } = { raw: null, list: EMPTY };

function read(): RememberedAccount[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cached.raw) return cached.list;
  let list: RememberedAccount[] = EMPTY;
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) {
      const now = Date.now();
      list = parsed.filter((a): a is RememberedAccount => !!a && typeof a.username === "string" && typeof a.key === "string" && Date.parse(a.expiresAt) > now);
    }
  } catch {
    list = EMPTY;
  }
  cached = { raw, list };
  return list;
}

function write(list: RememberedAccount[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode): nothing to remember with.
  }
  window.dispatchEvent(new Event(EVENT));
}

export const rememberedAccounts = () => (typeof window === "undefined" ? EMPTY : read());

/** Adds or refreshes an account; the newest first. */
export function rememberAccount(a: Omit<RememberedAccount, "rememberedAt">) {
  const rest = read().filter((x) => x.id !== a.id);
  write([{ ...a, rememberedAt: new Date().toISOString() }, ...rest].slice(0, 8));
}

export function forgetAccount(id: string) {
  write(read().filter((x) => x.id !== id));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

/** The remembered accounts, live: a component re-renders when the list changes (this tab or another). */
export function useRememberedAccounts() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
