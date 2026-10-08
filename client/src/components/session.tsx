"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { notificationHref, notificationText, type NotificationRow } from "@/lib/notifications";
import { connectRealtime, type RealtimeStatus } from "@/lib/realtime";
import type { ChatMessage, Me, MessageRisk, Meta } from "@/lib/types";
import { AuthModal } from "./auth-modal";
import { useToast } from "./toast";

interface AuthContext {
  /** Short reason shown under the modal title, e.g. "чтобы сохранить Levi's 501". */
  reason?: string;
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
  /** Runs `action` now if signed in; otherwise opens the auth modal and runs it after sign-in (frame 18). */
  requireAuth: (action: (me: Me) => void | Promise<void>, ctx?: AuthContext) => void;
  openAuth: (ctx?: AuthContext) => void;
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
  const { mutate: globalMutate } = useSWRConfig();
  const toast = useToast();
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);
  const [ctx, setCtx] = useState<AuthContext>({});
  const pending = useRef<((me: Me) => void | Promise<void>) | null>(null);

  const openAuth = useCallback((c: AuthContext = {}) => {
    setCtx(c);
    setAuthOpen(true);
  }, []);

  const user = data?.user ?? null;
  const userId = user?.id;
  const requireAuth = useCallback<SessionValue["requireAuth"]>(
    (action, c) => {
      if (user) {
        void action(user);
        return;
      }
      pending.current = action;
      openAuth(c);
    },
    [user, openAuth],
  );

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

  const onSignedIn = useCallback(
    async (me: Me, isNew?: boolean) => {
      await mutate({ user: me }, { revalidate: false });
      // Personalised data (♡ flags, "Для вас") must refetch for the new user.
      await globalMutate((key) => typeof key === "string" && key !== "/auth/me", undefined, { revalidate: true });
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
    [mutate, globalMutate, toast, router],
  );

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" });
    await mutate({ user: null }, { revalidate: false });
    await globalMutate((key) => typeof key === "string" && key !== "/auth/me", undefined, { revalidate: true });
  }, [mutate, globalMutate]);

  return (
    <SessionContext.Provider value={{ me: user, loading: isLoading, refresh: () => mutate(), logout, requireAuth, openAuth, realtime }}>
      {children}
      <AuthModal
        open={authOpen}
        reason={ctx.reason}
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
