"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useSession } from "@/components/session";
import { api } from "@/lib/api";
import { setTheme } from "@/lib/theme";
import type { UiPrefs } from "@/lib/types";

/**
 * Settings of how the site looks (card style, theme). They live on this device first, so a guest can change them and
 * they apply at once; with an account they are kept in it too (User.uiPrefs) and follow the person to every device:
 * signing in copies the account's values here, a first sign-in with nothing in the account sends the device's values
 * up (components/prefs-sync.tsx), and every change goes to both. The device copy always mirrors the account, so it
 * is what the pages read — no wait for the API, no flicker.
 */
export const DEFAULT_PREFS: Required<UiPrefs> = { cardStyle: "minimal", theme: "system" };

const KEY = "ichiba:prefs";
const EVENT = "ichiba:prefs-change";
const EMPTY: UiPrefs = {};

export function sanitizePrefs(v: unknown): UiPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: UiPrefs = {};
  if (o.cardStyle === "minimal" || o.cardStyle === "detailed") out.cardStyle = o.cardStyle;
  if (o.theme === "system" || o.theme === "light" || o.theme === "dark") out.theme = o.theme;
  return out;
}

let cache: UiPrefs | null = null;

/** What this device remembers; a stable object until something is written (useSyncExternalStore compares by identity). */
export function readDevicePrefs(): UiPrefs {
  if (cache) return cache;
  try {
    cache = sanitizePrefs(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    cache = {};
  }
  return cache;
}

export function writeDevicePrefs(patch: UiPrefs) {
  cache = { ...readDevicePrefs(), ...sanitizePrefs(patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private mode or storage blocked: the value lives until the page is closed.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null; // changed in another tab: read again
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The look settings in effect and a setter. Before hydration the defaults apply (server HTML has no device), so a
 * page may re-render once right after load for someone who chose otherwise.
 */
export function usePrefs() {
  const device = useSyncExternalStore(subscribe, readDevicePrefs, () => EMPTY);
  const { me, refresh } = useSession();
  const prefs: Required<UiPrefs> = { ...DEFAULT_PREFS, ...sanitizePrefs(me?.uiPrefs), ...device };
  const set = useCallback(
    async (patch: UiPrefs) => {
      writeDevicePrefs(patch);
      if (patch.theme) setTheme(patch.theme);
      if (!me) return;
      try {
        await api("/users/me", { method: "PATCH", body: { uiPrefs: patch } });
        await refresh();
      } catch {
        // Offline or signed out meanwhile: the device keeps the choice; the next sign-in sends it up.
      }
    },
    [me, refresh],
  );
  return { prefs, set, inAccount: !!me };
}
