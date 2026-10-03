"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { notificationHref, notificationText, type NotificationRow } from "@/lib/notifications";
import type { Me, Meta } from "@/lib/types";
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
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

export interface LiveMessage {
  threadId: string;
  message: { id: string; body: string; mine: boolean; createdAt: string; from: string; title: string };
}

/** Pages subscribe to live chat messages through this window event. */
export const LIVE_MESSAGE_EVENT = "ichiba:message";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, mutate } = useSWR<{ user: Me | null }>("/auth/me", { revalidateOnFocus: true });
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

  // Real-time: notifications and chat messages over SSE (frame 30). Counters refresh on every event.
  useEffect(() => {
    if (!userId) return;
    const es = new EventSource("/api/events");
    es.addEventListener("notification", (e) => {
      void mutate();
      const n = JSON.parse((e as MessageEvent).data) as NotificationRow;
      if (n.type) toast(notificationText(n), { action: { label: "Открыть", onClick: () => router.push(notificationHref(n)) } });
      // Deals, offers and lists may have changed.
      void globalMutate((key) => typeof key === "string" && /^\/(sales|purchases|offers|requests|notifications|listings|cart)/.test(key));
    });
    es.addEventListener("message", (e) => {
      void mutate();
      const m = JSON.parse((e as MessageEvent).data) as LiveMessage;
      window.dispatchEvent(new CustomEvent(LIVE_MESSAGE_EVENT, { detail: m }));
      void globalMutate("/threads");
      if (!window.location.pathname.startsWith(`/messages/${m.threadId}`)) {
        toast(`@${m.message.from}: ${m.message.body.slice(0, 60)}`, { action: { label: "Ответить", onClick: () => router.push(`/messages/${m.threadId}`) } });
      }
    });
    return () => es.close();
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
    <SessionContext.Provider value={{ me: user, loading: isLoading, refresh: () => mutate(), logout, requireAuth, openAuth }}>
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
