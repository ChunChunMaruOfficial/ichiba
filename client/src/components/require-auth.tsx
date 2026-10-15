"use client";

import type { Me } from "@/lib/types";
import { useSession } from "./session";
import { Button, EmptyState, Spinner } from "./ui";

/**
 * Pages that only work signed in (My Wardrobe, Favorites, Purchases…) still open for guests: they say what signing in
 * gives here («Чтобы добавлять вещи в избранное, войдите…») instead of throwing a sign-in window at the tab tap.
 */
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
    const why = reason ? reason[0].toUpperCase() + reason.slice(1) : "Чтобы продолжить";
    return (
      <EmptyState title={`${why}, войдите в аккаунт`} hint="Вход по почте, через Google или Telegram — это займёт минуту. Смотреть вещи и собирать корзину можно и без него.">
        <Button onClick={() => openAuth()}>Войти или зарегистрироваться</Button>
      </EmptyState>
    );
  }
  return <>{children(me)}</>;
}
