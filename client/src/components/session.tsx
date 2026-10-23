"use client";

import { guestCart } from "@/lib/guest-cart";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { notificationHref, notificationText, type NotificationRow } from "@/lib/notifications";
import { connectRealtime, type RealtimeStatus } from "@/lib/realtime";
import type { ChatMessage, Me, MessageRisk, Meta } from "@/lib/types";
import { AuthModal } from "./auth-modal";
import { useToast } from "./toast";

interface SessionValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
  /** Runs `action` now if signed in; otherwise opens the auth modal and runs it after sign-in (frame 18). */
  requireAuth: (action: (me: Me) => void | Promise<void>) => void;
  openAuth: () => void;
  /** "live" when the socket is up; otherwise pages poll for fresh data. */
  realtime: RealtimeStatus;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

export interface LiveMessage {
  threadId: string;
  /** The message as the recipient sees it, plus a preview line and who sent it for the toast. */
  message: ChatMessage & { from: string; title: string; preview?: string };
}

export interface LiveMessageUpdate {
  threadId: string;
  message: ChatMessage;
}

export interface LiveMessageDelete {
  threadId: string;
  ids: string[];
}

export interface LiveRisk {
  threadId: string;
  messageId: string;
  risk: MessageRisk | null;
}

/** Pages subscribe to live chat messages through this window event. */
export const LIVE_MESSAGE_EVENT = "ichiba:message";
/** Antifraud verdict for a message that arrived earlier. */
export const LIVE_RISK_EVENT = "ichiba:message-risk";
/** The other side read the thread / is typing. */
export const LIVE_READ_EVENT = "ichiba:thread-read";
export const LIVE_TYPING_EVENT = "ichiba:typing";
/** A message was edited or its reactions changed / messages were deleted for both / pins changed. */
export const LIVE_UPDATE_EVENT = "ichiba:message-update";
export const LIVE_DELETE_EVENT = "ichiba:message-delete";
export const LIVE_PINS_EVENT = "ichiba:thread-pins";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [realtime, setRealtime] = useState<RealtimeStatus>("connecting");
  // Without a live channel the header counters are refreshed by polling.
  const { data, isLoading, mutate } = useSWR<{ user: Me | null }>("/auth/me", { revalidateOnFocus: true, refreshInterval: (d) => (d?.user && realtime !== "live" ? 30_000 : 0) });
  const { cache, mutate: globalMutate } = useSWRConfig();
  const toast = useToast();
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);
  const pending = useRef<((me: Me) => void | Promise<void>) | null>(null);

  const openAuth = useCallback(() => setAuthOpen(true), []);

  const user = data?.user ?? null;
  const userId = user?.id;
  const requireAuth = useCallback<SessionValue["requireAuth"]>(
    (action) => {
      if (user) {
        void action(user);
        return;
      }
      pending.current = action;
      openAuth();
    },
    [user, openAuth],
  );

  // Signed in with things in the guest cart: they move into the account (sizes too), then the cart is emptied.
  useEffect(() => {
    if (!userId) return;
    const items = guestCart.items();
    if (!items.length) return;
    void (async () => {
      for (const i of [...items].reverse()) {
        await api(`/cart/${i.listingId}`, { body: { size: i.size ?? undefined } }).catch(() => undefined);
      }
      guestCart.clear();
      void mutate();
      void globalMutate("/cart");
    })();
  }, [userId, mutate, globalMutate]);

  // Real-time: notifications and chat over WebSocket / Pusher (frame 30). Counters refresh on every event.
  useEffect(() => {
    if (!userId) return;
    return connectRealtime(
      userId,
      (type, data) => {
        if (type === "notification") {
          void mutate();
          const n = data as NotificationRow;
          if (n.type) toast(notificationText(n), { action: { label: "Открыть", onClick: () => router.push(notificationHref(n)) } });
          // Deals, offers and lists may have changed.
          void globalMutate((key) => typeof key === "string" && /^\/(sales|purchases|offers|requests|notifications|listings|cart|auctions)/.test(key));
        } else if (type === "message") {
          void mutate();
          const m = data as LiveMessage;
          window.dispatchEvent(new CustomEvent(LIVE_MESSAGE_EVENT, { detail: m }));
          void globalMutate("/threads");
          // Outside the chat a new message pops up as the mini chat in the corner (mini-chat.tsx).
        } else if (type === "message_risk") {
          const r = data as LiveRisk;
          window.dispatchEvent(new CustomEvent(LIVE_RISK_EVENT, { detail: r }));
          if (r.risk?.level === "high" && !window.location.pathname.startsWith(`/messages/${r.threadId}`)) {
            toast("Подозрительное сообщение в чате — будьте осторожны", { tone: "error", action: { label: "Открыть", onClick: () => router.push(`/messages/${r.threadId}`) } });
          }
        } else if (type === "thread_read") {
          window.dispatchEvent(new CustomEvent(LIVE_READ_EVENT, { detail: data }));
        } else if (type === "typing") {
          window.dispatchEvent(new CustomEvent(LIVE_TYPING_EVENT, { detail: data }));
        } else if (type === "message_update" || type === "message_delete") {
          window.dispatchEvent(new CustomEvent(type === "message_update" ? LIVE_UPDATE_EVENT : LIVE_DELETE_EVENT, { detail: data }));
          // The preview line in the list may have changed (edited or deleted last message).
          void globalMutate("/threads");
          if (type === "message_delete") void mutate();
        } else if (type === "thread_pins") {
          window.dispatchEvent(new CustomEvent(LIVE_PINS_EVENT, { detail: data }));
        }
      },
      setRealtime,
    );
  }, [userId, mutate, globalMutate, toast, router]);

  // Who the cached data belongs to, read by onSignedIn without making it depend on every /auth/me refresh.
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  /**
   * Forgets every cached answer but /auth/me and the static /meta, so the next person on this browser never sees
   * the previous one's notifications, feed or ♡ — not even for a frame. SWR's filter form of mutate() skips the
   * useSWRInfinite keys ($inf$…), which is how lists used to survive a logout; here each key is dropped from the
   * cache and then mutated by name, which reaches the infinite hooks too and makes mounted lists refetch.
   */
  const resetCache = useCallback(async () => {
    const keys = [...cache.keys()].filter((k) => k !== "/auth/me" && k !== "/meta");
    for (const k of keys) cache.delete(k);
    await Promise.all(keys.filter((k) => !k.startsWith("$sub$")).map((k) => globalMutate(k, undefined, { revalidate: true }).catch(() => undefined)));
  }, [cache, globalMutate]);

  const onSignedIn = useCallback(
    async (me: Me, isNew?: boolean) => {
      const switched = userIdRef.current !== me.id;
      await mutate({ user: me }, { revalidate: false });
      // Personalised data (♡ flags, "Для вас") must refetch for the new user, and nothing of another account may stay.
      if (switched) await resetCache();
      setAuthOpen(false);
      const action = pending.current;
      pending.current = null;
      // New accounts go through the optional swipe onboarding first (frame 18), then the original action.
      if (isNew && !me.onboardedAt) {
        router.push("/welcome");
        return;
      }
      if (action) await action(me);
      else toast("Вы вошли");
    },
    [mutate, resetCache, toast, router],
  );

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" });
    await mutate({ user: null }, { revalidate: false });
    await resetCache();
    // Unsent chat drafts are personal too (composer.tsx keeps them per thread).
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("ichiba:chat-draft:")) localStorage.removeItem(k);
    } catch {
      // Storage blocked (private mode): nothing was saved either.
    }
    // Ask the API who is signed in now rather than trusting the optimistic null.
    void mutate();
  }, [mutate, resetCache]);

  const refresh = useCallback(() => mutate(), [mutate]);
  // A stable value: every consumer of useSession() re-renders only when something in it actually changes.
  const value = useMemo<SessionValue>(
    () => ({ me: user, loading: isLoading, refresh, logout, requireAuth, openAuth, realtime }),
    [user, isLoading, refresh, logout, requireAuth, openAuth, realtime],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      <AuthModal
        open={authOpen}
        onClose={() => {
          pending.current = null;
          setAuthOpen(false);
        }}
        onSignedIn={onSignedIn}
      />
    </SessionContext.Provider>
  );
}

/** Catalog reference data; never changes during a session. */
export function useMeta() {
  return useSWR<Meta>("/meta", { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 3600_000 }).data;
}
