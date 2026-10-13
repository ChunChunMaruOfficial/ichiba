"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/api";
import { DialogProvider } from "./dialog";
import { MiniChat } from "./mini-chat";
import { SessionProvider } from "./session";
import { ToastProvider } from "./toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true }}>
      <ToastProvider>
        <DialogProvider>
          <SessionProvider>
            {children}
            <MiniChat />
          </SessionProvider>
        </DialogProvider>
      </ToastProvider>
    </SWRConfig>
  );
}
