"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/session";
import { ButtonLink, EmptyState, Spinner } from "@/components/ui";

const NAV = [
  ["/admin", "Обзор"],
  ["/admin/moderation", "Модерация"],
  ["/admin/listings", "Заблокированные"],
];

/** Internal admin section of the same app (frame 30): role ADMIN only. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  const pathname = usePathname();
  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner />
      </div>
    );
  }
  if (me?.role !== "ADMIN") {
    return (
      <EmptyState title="Раздел только для администраторов">
        <ButtonLink href="/">На главную</ButtonLink>
      </EmptyState>
    );
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <nav aria-label="Админка" className="mb-8 flex gap-1 border-b border-line">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className={clsx("-mb-px border-b-2 px-4 py-2.5 text-sm font-medium", pathname === href ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
