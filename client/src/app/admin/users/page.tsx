"use client";

import { useDialog } from "@/components/dialog";
import clsx from "clsx";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import { useToast } from "@/components/toast";
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, Skeleton, Textarea } from "@/components/ui";
import { dbLink } from "@/lib/admin";
import { api, ApiError, qs } from "@/lib/api";
import { formatPrice } from "@/lib/labels";

interface Row {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: "USER" | "ADMIN";
  city: string | null;
  blockedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  listings: number;
  via: string[];
}

interface Detail {
  user: Record<string, unknown> & { id: string; username: string; email: string | null; phone: string | null; city: string | null; bio: string | null; role: "USER" | "ADMIN"; blockedAt: string | null; deletedAt: string | null; listingsHiddenAt: string | null; hasPassword: boolean };
  stats: { listings: Record<string, number>; asBuyer: number; asSeller: number; reportsAgainst: number };
  recentListings: Array<{ id: string; title: string; status: string; price: number; updatedAt: string }>;
  actions: Array<{ id: string; action: string; reason: string | null; at: string }>;
}

const FILTERS = [
  ["all", "Все"],
  ["blocked", "Заблокированные"],
  ["admins", "Админы"],
  ["deleted", "Удалённые"],
] as const;

const date = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—");

/** Every account: search by nick, email, phone or id; open one to edit, block or delete it. */
export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const query = useDeferredValue(q);
  const { data, error, mutate } = useSWR<{ total: number; pageSize: number; items: Row[] }>(`/admin/users${qs({ q: query, filter, page })}`, { keepPreviousData: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          aria-label="Поиск"
          placeholder="Ник, почта, телефон или id…"
          value={q}
          onChange={(e) => (setQ(e.target.value), setPage(1))}
          className="w-full max-w-sm"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => (setFilter(id), setPage(1))}
              className={clsx("rounded-full px-3 py-1.5 text-sm", filter === id ? "bg-ink text-accent-ink" : "text-ink-2 hover:bg-ink/5")}
            >
              {label}
            </button>
          ))}
        </div>
        {data && <span className="ml-auto text-sm text-muted tabular">{data.total.toLocaleString("ru-RU")} чел.</span>}
      </div>

      {error ? (
        <ErrorState message="Не удалось загрузить" onRetry={() => mutate()} />
      ) : !data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Никого не нашли" />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">Ник</th>
                <th className="px-4 py-3 font-medium">Почта / телефон</th>
                <th className="px-4 py-3 font-medium">Город</th>
                <th className="px-4 py-3 text-right font-medium">Вещей</th>
                <th className="px-4 py-3 font-medium">Создан</th>
                <th className="px-4 py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((u) => (
                <tr key={u.id} onClick={() => setOpen(u.id)} className="cursor-pointer hover:bg-ink/[0.03]">
                  <td className="px-4 py-3 font-medium">
                    @{u.username}
                    {u.via.length > 0 && <span className="ml-2 text-xs font-normal text-muted">{u.via.join(", ")}</span>}
                  </td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-ink-2">{[u.email, u.phone].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3 text-ink-2">{u.city ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular">{u.listings}</td>
                  <td className="px-4 py-3 text-ink-2 tabular">{date(u.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {u.role === "ADMIN" && <Badge tone="dark">админ</Badge>}
                      {u.blockedAt && <Badge tone="danger">заблокирован</Badge>}
                      {u.deletedAt && <Badge tone="muted">удалён</Badge>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Назад
          </Button>
          <span className="tabular text-muted">
            {page} / {pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Дальше
          </Button>
        </div>
      )}

      {open && <UserPanel id={open} onClose={() => setOpen(null)} onChanged={() => mutate()} />}
    </div>
  );
}

function UserPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, mutate } = useSWR<Detail>(`/admin/users/${id}`);
  const toast = useToast();
  const { prompt, confirm } = useDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const u = data?.user;
  const values = form ?? (u ? { username: u.username, email: u.email ?? "", phone: u.phone ?? "", city: u.city ?? "", bio: u.bio ?? "", role: u.role } : null);

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setErrors({});
    try {
      await fn();
      toast(done);
      await mutate();
      onChanged();
      return true;
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        toast(e.message);
      }
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run(
      "save",
      () => {
        const body: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(values!)) {
          const before = k === "username" || k === "role" ? u![k] : ((u![k] as string | null) ?? "");
          if (v !== before) body[k] = k === "username" || k === "role" ? v : v.trim() || null;
        }
        return Object.keys(body).length ? api(`/admin/users/${id}`, { method: "PATCH", body }) : Promise.resolve();
      },
      "Сохранено",
    ).then((ok) => ok && setForm(null));

  return (
    <Modal open onClose={onClose} title={u ? `@${u.username}` : "Пользователь"} width="max-w-2xl">
      {error ? (
        <ErrorState message="Не удалось загрузить" onRetry={() => mutate()} />
      ) : !data || !values || !u ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            {[
              ["Вещей", Object.values(data.stats.listings).reduce((a, b) => a + b, 0)],
              ["Покупок", data.stats.asBuyer],
              ["Продаж", data.stats.asSeller],
              ["Жалоб на него", data.stats.reportsAgainst],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="text-lg font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span>id {u.id}</span>·<span>создан {date(u.createdAt as string)}</span>·<span>{u.hasPassword ? "есть пароль" : "без пароля"}</span>
            {typeof u.googleSub === "string" && <>· <span>Google</span></>}
            {typeof u.telegramId === "string" && <>· <span>Telegram</span></>}
            {u.blockedAt && <>· <span className="text-danger">заблокирован {date(u.blockedAt)}</span></>}
            {u.listingsHiddenAt && <>· <span className="text-warn">объявления скрыты {date(u.listingsHiddenAt)}</span></>}
            {u.deletedAt && <>· <span>удалён {date(u.deletedAt)}</span></>}
          </div>

          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {(
              [
                ["username", "Ник"],
                ["email", "Почта"],
                ["phone", "Телефон"],
                ["city", "Город"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`u-${k}`} error={errors[k]}>
                <Input id={`u-${k}`} value={values[k]} onChange={(e) => setForm({ ...values, [k]: e.target.value })} error={errors[k]} />
              </Field>
            ))}
            <Field label="О себе" htmlFor="u-bio" error={errors.bio}>
              <Textarea id="u-bio" rows={2} value={values.bio} onChange={(e) => setForm({ ...values, bio: e.target.value })} />
            </Field>
            <Field label="Роль" htmlFor="u-role">
              <select id="u-role" className="h-11 rounded-xl border border-line bg-surface px-3" value={values.role} onChange={(e) => setForm({ ...values, role: e.target.value })}>
                <option value="USER">Пользователь</option>
                <option value="ADMIN">Админ</option>
              </select>
            </Field>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button type="submit" loading={busy === "save"} disabled={!form}>
                Сохранить
              </Button>
              {form && (
                <Button type="button" variant="ghost" onClick={() => (setForm(null), setErrors({}))}>
                  Отменить
                </Button>
              )}
            </div>
          </form>

          {data.recentListings.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="font-semibold">Вещи</h3>
                <Link href={dbLink("Listing", { sellerId: u.id })} className="text-sm text-ink-2 hover:underline">
                  Все в базе →
                </Link>
              </div>
              <ul className="divide-y divide-line text-sm">
                {data.recentListings.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2">
                    <Link href={`/item/${l.id}`} target="_blank" className="min-w-0 flex-1 truncate hover:underline">
                      {l.title}
                    </Link>
                    <span className="text-muted">{l.status}</span>
                    <span className="tabular">{formatPrice(l.price)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.actions.length > 0 && (
            <section>
              <h3 className="mb-2 font-semibold">История модерации</h3>
              <ul className="flex flex-col gap-1 text-sm text-ink-2">
                {data.actions.map((a) => (
                  <li key={a.id}>
                    <span className="tabular text-muted">{date(a.at)}</span> · {a.action}
                    {a.reason && ` — ${a.reason}`}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
            <Link href={dbLink("User", { id: u.id })} className="mr-auto text-sm text-ink-2 hover:underline">
              Открыть строку в базе →
            </Link>
            {u.listingsHiddenAt ? (
              <Button variant="secondary" loading={busy === "listings"} onClick={() => run("listings", () => api(`/admin/users/${id}/show-listings`, { method: "POST" }), "Объявления снова видны")}>
                Показать объявления
              </Button>
            ) : (
              <Button
                variant="secondary"
                loading={busy === "listings"}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Скрыть объявления @${u.username}?`,
                      message: "Все вещи в продаже пропадут из ленты и поиска, но не удалятся. Аккаунт продолжит работать, сделки в процессе завершатся. Новые вещи тоже будут скрыты, пока вы не покажете объявления снова.",
                      confirmLabel: "Скрыть объявления",
                    })
                  )
                    void run("listings", () => api(`/admin/users/${id}/hide-listings`, { method: "POST" }), "Объявления скрыты");
                }}
              >
                Скрыть объявления
              </Button>
            )}
            {u.blockedAt ? (
              <Button variant="secondary" loading={busy === "block"} onClick={() => run("block", () => api(`/admin/users/${id}/unblock`, { method: "POST" }), "Разблокирован. Скрытые вещи остались скрытыми")}>
                Разблокировать
              </Button>
            ) : (
              <Button
                variant="secondary"
                loading={busy === "block"}
                onClick={async () => {
                  const reason = await prompt({ title: `Заблокировать @${u.username}?`, message: "Вещи пользователя скроются, войти он не сможет.", label: "Причина (видна только в журнале)", multiline: true, confirmLabel: "Заблокировать", danger: true });
                  if (reason && reason.trim().length >= 3) void run("block", () => api(`/admin/users/${id}/block`, { body: { reason } }), "Заблокирован, его вещи скрыты");
                }}
              >
                Заблокировать
              </Button>
            )}
            {!u.deletedAt && (
              <Button
                variant="danger"
                loading={busy === "delete"}
                onClick={async () => {
                  if ((await prompt({ title: "Удалить аккаунт?", message: "Удаление необратимо: контакты и профиль сотрутся.", label: `Введите ник ${u.username}, чтобы подтвердить`, placeholder: u.username, mustEqual: u.username, confirmLabel: "Удалить навсегда", danger: true })) === u.username) {
                    void run("delete", () => api(`/admin/users/${id}`, { method: "DELETE" }), "Аккаунт удалён");
                  }
                }}
              >
                Удалить аккаунт
              </Button>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
