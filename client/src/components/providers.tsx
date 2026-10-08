"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/api";
import { MiniChat } from "./mini-chat";
import { SessionProvider } from "./session";
import { ToastProvider } from "./toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true }}>
      <ToastProvider>
        <SessionProvider>
          {children}
          <MiniChat />
        </SessionProvider>
      </ToastProvider>
    </SWRConfig>
  );
}
