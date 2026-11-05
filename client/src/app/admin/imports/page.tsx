"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Badge, Button, ErrorState, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";

interface Source {
  username: string;
  enabled: boolean;
  lastSyncAt: string | null;
  live: number;
  all: number;
}
interface TgRow extends Source {
  channel: string;
  posts: Record<string, number>;
}
interface ShopRow extends Source {
  key: string;
  products: Record<string, number>;
}
interface HandRow {
  username: string;
  account: { createdAt: string; hasPassword: boolean; hasAvatar: boolean; own: boolean } | null;
  brand: string | null;
  items: number;
  listed: number;
  missing: string[];
  live: number;
  all: number;
}
interface Data {
  tg: TgRow[];
  shops: ShopRow[];
  hand: HandRow[];
}

const when = (v: string | null) => (v ? new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "ещё не было");
/** Hours since a sync that runs every three: more than six means it has stopped. */
const stale = (v: string | null) => !v || Date.now() - new Date(v).getTime() > 6 * 3600_000;

const POST_LABEL: Record<string, string> = { imported: "выставлено", skipped: "пропущено", failed: "не удалось", removed: "снято", listed: "выставлено", out: "нет в наличии" };

function Counts({ data }: { data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {rows.map(([k, n]) => (
        <span key={k} className={clsx("tabular whitespace-nowrap", k === "failed" && n > 0 ? "text-danger" : "text-ink-2")}>
          {n} {POST_LABEL[k] ?? k}
        </span>
      ))}
    </span>
  );
}

function Seller({ username }: { username: string }) {
  return (
    <Link href={`/u/${username}`} target="_blank" className="font-medium hover:underline">
      @{username}
    </Link>
  );
}

/** A mirrored channel or shop: its state and a switch that pauses or resumes the sync. */
function SourceRow({ row, name, href, counts, toggle, onToggled }: { row: Source; name: string; href: string; counts: Record<string, number>; toggle: string; onToggled: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <tr className="hover:bg-ink/[0.03]">
      <td className="px-4 py-3">
        <a href={href} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {name}
        </a>
        <div className="mt-0.5 text-xs text-muted">
          <Seller username={row.username} />
        </div>
      </td>
      <td className="px-4 py-3">
        {!row.enabled ? <Badge tone="muted">на паузе</Badge> : stale(row.lastSyncAt) ? <Badge tone="danger">не синхронизируется</Badge> : <Badge tone="ok">в работе</Badge>}
      </td>
      <td className={clsx("whitespace-nowrap px-4 py-3 tabular", row.enabled && stale(row.lastSyncAt) ? "text-danger" : "text-ink-2")}>{when(row.lastSyncAt)}</td>
      <td className="px-4 py-3">
        <Counts data={counts} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 tabular">
        <span className="font-medium">{row.live}</span> <span className="text-muted">/ {row.all}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(toggle, { method: "PATCH", body: { enabled: !row.enabled } });
              onToggled();
            } finally {
              setBusy(false);
            }
          }}
        >
          {row.enabled ? "Пауза" : "Возобновить"}
        </Button>
      </td>
    </tr>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <thead className="text-xs uppercase tracking-wide text-muted">
      <tr className="border-b border-line">{children}</tr>
    </thead>
  );
}
const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => <th className={clsx("px-4 py-3 font-medium", className)}>{children}</th>;

/** Every outside source the site lists from: Telegram channels, brand web shops and the hand batches. */
export default function AdminImportsPage() {
  const { data, error, mutate } = useSWR<Data>("/admin/imports", { refreshInterval: 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorState message="Не удалось загрузить" onRetry={() => mutate()} />;
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;

  const missingTotal = data.hand.reduce((s, b) => s + b.missing.length, 0);
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="mb-1 font-semibold">Telegram-каналы</h2>
        <p className="mb-4 text-sm text-muted">Зеркала каналов (server/src/tg): новые посты разбирает ИИ, удалённый пост снимает вещь, синхронизация каждые три часа.</p>
        {data.tg.length === 0 ? (
          <p className="text-sm text-muted">Каналов нет.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-surface">
            <table className="w-full min-w-[820px] text-left text-sm">
              <Head>
                <Th>Канал</Th>
                <Th>Состояние</Th>
                <Th>Последняя синхронизация</Th>
                <Th>Посты</Th>
                <Th>В продаже / всего</Th>
                <Th />
              </Head>
              <tbody className="divide-y divide-line">
                {data.tg.map((r) => (
                  <SourceRow key={r.channel} row={r} name={`@${r.channel}`} href={`https://t.me/${r.channel}`} counts={r.posts} toggle={`/admin/imports/tg/${r.channel}`} onToggled={() => mutate()} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Сайты брендов</h2>
        <p className="mb-4 text-sm text-muted">Каталоги магазинов (server/src/shops): цена, наличие и размеры следуют за сайтом.</p>
        {data.shops.length === 0 ? (
          <p className="text-sm text-muted">Магазинов нет.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-surface">
            <table className="w-full min-w-[820px] text-left text-sm">
              <Head>
                <Th>Магазин</Th>
                <Th>Состояние</Th>
                <Th>Последняя синхронизация</Th>
                <Th>Товары</Th>
                <Th>В продаже / всего</Th>
                <Th />
              </Head>
              <tbody className="divide-y divide-line">
                {data.shops.map((r) => (
                  <SourceRow key={r.key} row={r} name={r.key} href={`/u/${r.username}`} counts={r.products} toggle={`/admin/imports/shops/${r.key}`} onToggled={() => mutate()} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Ручные партии</h2>
        <p className="mb-4 text-sm text-muted">
          Вещи, переданные владельцами и выставленные один раз после деплоя (server/src/listings/hand-batches.ts). «Не выставлено» — позиции партии, которых у продавца нет: не прошли модерацию или проверку, смотрите логи сервера.
          {missingTotal > 0 && <span className="ml-1 text-danger">Сейчас таких {missingTotal}.</span>}
        </p>
        <div className="overflow-x-auto rounded-2xl bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <Head>
              <Th>Продавец</Th>
              <Th>Аккаунт</Th>
              <Th>В партии</Th>
              <Th>Выставлено</Th>
              <Th>Не выставлено</Th>
              <Th>В продаже / всего</Th>
            </Head>
            <tbody className="divide-y divide-line">
              {data.hand.map((b) => (
                <tr key={b.username} className="align-top hover:bg-ink/[0.03]">
                  <td className="px-4 py-3">
                    <Seller username={b.username} />
                    {b.brand && (
                      <Badge tone="dark" className="ml-2">
                        {b.brand}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-2">
                    {!b.account ? (
                      <Badge tone="danger">нет</Badge>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        <Badge tone="ok">{b.account.own ? "создан импортом" : "свой"}</Badge>
                        {!b.account.hasPassword && <Badge tone="warn">без пароля</Badge>}
                        {!b.account.hasAvatar && <Badge tone="muted">без фото</Badge>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular">{b.items}</td>
                  <td className="px-4 py-3 tabular">{b.listed}</td>
                  <td className="px-4 py-3">
                    {b.missing.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <div>
                        <button type="button" className="tabular text-danger underline-offset-4 hover:underline" onClick={() => setOpen(open === b.username ? null : b.username)}>
                          {b.missing.length}
                        </button>
                        {open === b.username && (
                          <ul className="mt-2 max-w-md list-disc pl-4 text-xs text-ink-2">
                            {b.missing.map((t) => (
                              <li key={t}>{t}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular">
                    <span className="font-medium">{b.live}</span> <span className="text-muted">/ {b.all}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
