"use client";

import { RequireAuth } from "@/components/require-auth";
import { Chochin } from "@/components/shop/chochin";
import { ThreadList } from "@/components/thread-list";

export default function MessagesPage() {
  return <RequireAuth reason="чтобы открыть сообщения">{() => <Threads />}</RequireAuth>;
}

/** All conversations; on wide screens the list sits on the left with room for the open chat beside it. */
function Threads() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">Сообщения</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
        <ThreadList />
        <div className="hidden min-h-[60vh] flex-col items-center justify-center rounded-[28px] border border-dashed border-line-strong text-center lg:flex">
          <Chochin ch="話" className="h-44" />
          <p className="mt-6 text-lg font-semibold">Выберите переписку</p>
          <p className="mt-1 text-sm text-muted">Слева — все разговоры о вещах</p>
        </div>
      </div>
    </div>
  );
}
