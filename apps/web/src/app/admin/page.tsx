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
      <AiStatus />
    </div>
  );
}

interface AiStatusData {
  providers: Array<{
    id: string;
    configured: boolean;
    available: boolean;
    disabledUntil: string | null;
    calls: number;
    failures: number;
    avgLatencyMs: number | null;
    lastError: { kind: string; model?: string; message: string; at: string } | null;
    disabledModels: Array<{ model: string; until: string }>;
  }>;
  last24h: Array<{ feature: string; runs: number; avgLatencyMs: number }>;
}

const PROVIDER_LABEL: Record<string, string> = { gemini: "Google Gemini", mistral: "Mistral", glm: "Z.ai GLM" };
const FEATURE_LABEL: Record<string, string> = {
  listing_autofill: "Автозаполнение",
  listing_describe: "Описание",
  price_suggest: "Подсказка цены",
  photo_check: "Проверка фото",
  negotiation_advice: "Советы в торге",
  nl_search: "Умный поиск",
  listing_moderation: "Модерация",
  chat_antifraud: "Антифрод чата",
};
const ERROR_LABEL: Record<string, string> = { auth: "ключ не принят", quota: "нет квоты / баланса", rate: "лимит запросов", overloaded: "перегружен", timeout: "таймаут", network: "сеть", bad_request: "модель отклонила запрос" };

/** Health of the AI ensemble: which providers vote right now and how the features are used. */
function AiStatus() {
  const { data } = useSWR<AiStatusData>("/ai/status", { refreshInterval: 30_000 });
  if (!data) return null;
  return (
    <section className="rounded-2xl bg-surface p-5">
      <h2 className="mb-4 font-semibold">ИИ-ансамбль</h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {data.providers.map((p) => (
          <li key={p.id} className="rounded-xl border border-line p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <span className={`size-2.5 rounded-full ${!p.configured ? "bg-muted" : p.available ? "bg-ok" : "bg-danger"}`} />
              {PROVIDER_LABEL[p.id] ?? p.id}
            </p>
            <p className="mt-1 text-ink-2">
              {!p.configured ? "Нет ключа" : p.available ? "Голосует" : `Отключён до ${new Date(p.disabledUntil!).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`}
            </p>
            <p className="tabular mt-1 text-xs text-muted">
              {p.calls} вызовов · {p.failures} ошибок{p.avgLatencyMs != null && ` · ~${(p.avgLatencyMs / 1000).toFixed(1)} с`}
            </p>
            {p.disabledModels.length > 0 && <p className="mt-1 text-xs text-muted">Пауза: {p.disabledModels.map((m) => m.model).join(", ")}</p>}
            {p.lastError && (
              <p className="mt-1 text-xs text-danger">
                Последняя ошибка: {ERROR_LABEL[p.lastError.kind] ?? p.lastError.kind}
                {p.lastError.model && ` (${p.lastError.model})`}
              </p>
            )}
          </li>
        ))}
      </ul>
      {data.last24h.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          {data.last24h.map((f) => (
            <div key={f.feature}>
              <dt className="text-muted">{FEATURE_LABEL[f.feature] ?? f.feature}</dt>
              <dd className="tabular">
                {f.runs} за сутки · ~{(f.avgLatencyMs / 1000).toFixed(1)} с
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
