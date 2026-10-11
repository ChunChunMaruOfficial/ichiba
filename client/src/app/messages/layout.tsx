"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { useSession } from "@/components/session";
import { ThreadList } from "@/components/thread-list";

/**
 * Open conversation: on wide screens all conversations stay on the left, like a messenger. The shell lives in
 * the layout, so switching chats keeps the list (and its scroll) in place; only the chat column reloads.
 */
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const id = useSelectedLayoutSegment();
  const { me } = useSession();
  if (!id) return children;
  return (
    <div className="mx-auto grid h-dvh max-w-[1280px] grid-cols-[minmax(0,1fr)] max-lg:pt-[env(safe-area-inset-top)] lg:h-[calc(100dvh-65px)] lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-6 lg:px-6 lg:py-4">
      {me && (
        <aside className="hidden min-h-0 overflow-y-auto overscroll-contain pr-1 lg:block">
          <ThreadList activeId={id} compact />
        </aside>
      )}
      {children}
    </div>
  );
}
