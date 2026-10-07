"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { useSession } from "@/components/session";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

const NAV = [
  ["/admin", "Обзор"],
  ["/admin/moderation", "Модерация"],
  ["/admin/listings", "Заблокированные"],
];

/**
 * Admin sign-in: login and password of an ADMIN account. Opens a separate 8-hour admin session, so the
 * panel asks for the password even when the admin is already signed in on the site (e.g. with Google).
 */
function AdminLogin({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto flex max-w-sm flex-col px-4 py-16 md:py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Вход в админку</h1>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/auth/admin-login", { body: { login, password } });
            onDone();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Не удалось войти");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Логин" htmlFor="admin-login">
          <Input id="admin-login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Email или телефон" autoFocus />
        </Field>
        <Field label="Пароль" htmlFor="admin-password" error={error ?? undefined}>
          <Input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error ?? undefined} />
        </Field>
        <Button type="submit" size="lg" loading={busy} disabled={!login || !password}>
          Войти
        </Button>
      </form>
    </div>
  );
}

/** Internal admin section of the same app (frame 30): not linked anywhere, opened by URL, password-protected. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, refresh } = useSession();
  const pathname = usePathname();
  const admin = me?.role === "ADMIN";
  const session = useSWR<{ ok: boolean }>(admin ? "/admin/session" : null, { shouldRetryOnError: false, revalidateOnFocus: false });

  if (loading || (admin && session.isLoading)) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner />
      </div>
    );
  }
  if (!admin || !session.data?.ok) {
    return (
      <AdminLogin
        onDone={async () => {
          await refresh();
          await session.mutate();
        }}
      />
    );
  }
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <nav aria-label="Админка" className="mb-8 flex items-center gap-1 border-b border-line">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className={clsx("-mb-px border-b-2 px-4 py-2.5 text-sm font-medium", pathname === href ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
        <button
          type="button"
          className="ml-auto px-2 py-2.5 text-sm text-muted hover:text-ink"
          onClick={async () => {
            await api("/auth/admin-logout", { method: "POST" }).catch(() => {});
            await session.mutate(undefined, { revalidate: true });
          }}
        >
          Выйти из админки
        </button>
      </nav>
      {children}
    </div>
  );
}
