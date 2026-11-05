"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { readDevicePrefs, sanitizePrefs, writeDevicePrefs } from "@/lib/prefs";
import { setTheme } from "@/lib/theme";
import { useSession } from "./session";

/**
 * Keeps the device's look settings and the account's the same (lib/prefs.ts): when the session appears or the
 * account's values change (set on another device), they are copied here and applied; an account that has none yet
 * gets what this device chose while signed out.
 */
export function PrefsSync() {
  const { me } = useSession();
  const id = me?.id ?? null;
  const account = JSON.stringify(sanitizePrefs(me?.uiPrefs));
  useEffect(() => {
    if (!id) return;
    const fromAccount = sanitizePrefs(JSON.parse(account));
    if (Object.keys(fromAccount).length) {
      writeDevicePrefs(fromAccount);
      if (fromAccount.theme) setTheme(fromAccount.theme);
      return;
    }
    const fromDevice = readDevicePrefs();
    if (Object.keys(fromDevice).length) void api("/users/me", { method: "PATCH", body: { uiPrefs: fromDevice } }).catch(() => undefined);
  }, [id, account]);
  return null;
}
