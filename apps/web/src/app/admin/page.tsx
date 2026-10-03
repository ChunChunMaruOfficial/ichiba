"use client";

import Link from "next/link";
import useSWR from "swr";
import { ErrorState, Skeleton } from "@/components/ui";
import { DEAL_STATUS, formatPrice, LISTING_BADGE } from "@/lib/labels";
import type { ListingStatus, RequestStatus } from "@/lib/types";

interface Stats {
  completedWeek: number;
  gmvWeek: number;
  users: number;
  newUsers: number;
  publishedWeek: number;
  openReports: number;
  listingsByStatus: Partial<Record<ListingStatus, number>>;
  dealsByStatus: Partial<Record<RequestStatus, number>>;
}

const LISTING_LABEL: Record<ListingStatus, string> = {
  PUBLISHED: "В продаже",
  RESERVED: LISTING_BADGE.RESERVED!.label,
  SOLD: LISTING_BADGE.SOLD!.label,
  HIDDEN: LISTING_BADGE.HIDDEN!.label,
  BLOCKED: LISTING_BADGE.BLOCKED!.label,
  DRAFT: LISTING_BADGE.DRAFT!.label,
  DELETED: "Удалено",
};

function Breakdown<K extends string>({ title, data, label }: { title: string; data: Partial<Record<K, number>>; label: (k: K) => string }) {
  const rows = (Object.entries(data) as Array<[K, number]>).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <section className="rounded-3xl bg-surface p-5">
      <h2 className="mb-4 font-semibold">{title}</h2>
      <ul className="flex flex-col gap-2.5">
        {rows.map(([k, n]) => (
          <li key={k} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm">
            <span className="truncate text-ink-2">{label(k)}</span>
            <span className="h-2 rounded-full bg-paper">
              <span className="block h-full rounded-full bg-ink" style={{ width: `${(n / max) * 100}%` }} />
            </span>
            <span className="tabular text-right font-medium">{n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AdminDashboard() {
  const { data, error, mutate } = useSWR<Stats>("/admin/stats");
  if (error) return <ErrorState message="Не удалось загрузить статистику" onRetry={() => mutate()} />;
  if (!data) return <Skeleton className="h-64 rounded-3xl" />;

  return (
    <div className="flex flex-col gap-8">
      {/* North-star metric from frame 01 leads; the rest supports it. */}
      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted">Завершённые сделки за 7 дней</p>
          <p className="tabular text-6xl font-semibold tracking-tight">{data.completedWeek}</p>
          <p className="mt-1 text-ink-2">на {formatPrice(data.gmvWeek)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:grid-cols-4">
          {(
            [
              ["Пользователи", data.users],
              ["Новые за неделю", data.newUsers],
              ["Опубликовано за неделю", data.publishedWeek],
              ["Открытые жалобы", data.openReports],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="tabular text-2xl font-semibold">{k === "Открытые жалобы" && v > 0 ? <Link href="/admin/moderation" className="text-danger hover:underline">{v}</Link> : v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <Breakdown title="Вещи по статусам" data={data.listingsByStatus} label={(k) => LISTING_LABEL[k]} />
        <Breakdown title="Сделки по статусам" data={data.dealsByStatus} label={(k) => DEAL_STATUS[k].seller} />
      </div>
    </div>
  );
}
