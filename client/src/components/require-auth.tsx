"use client";

import type { Me } from "@/lib/types";
import { useSession } from "./session";
import { Button, EmptyState, Spinner } from "./ui";

/** Gate for pages that only make sense signed in (My Wardrobe, Purchases, Sales…). */
export function RequireAuth({ children, reason }: { children: (me: Me) => React.ReactNode; reason?: string }) {
  const { me, loading, openAuth } = useSession();
  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner />
      </div>
    );
  }
  if (!me) {
    return (
      <EmptyState title="Войдите, чтобы продолжить" hint={reason ? `Нужно войти ${reason}` : undefined}>
        <Button onClick={() => openAuth()}>Войти</Button>
      </EmptyState>
    );
  }
  return <>{children(me)}</>;
}
