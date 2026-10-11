"use client";

import clsx from "clsx";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useState } from "react";
import useSWR from "swr";
import { useToast } from "@/components/toast";
import { Button, EmptyState, ErrorState, Field, Input, Modal, Skeleton, Spinner, Textarea } from "@/components/ui";
import { api, ApiError, qs } from "@/lib/api";

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  enumValues: string[] | null;
  pk: boolean;
  secret: boolean;
}
type Row = Record<string, unknown>;
interface Page {
  table: string;
  columns: Column[];
  total: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  rows: Row[];
}

const isJson = (c: Column) => /^jsonb?$/.test(c.type) || c.type.endsWith("[]");
const isDate = (c: Column) => c.type.startsWith("timestamp") || c.type === "date";

function cell(v: unknown, c: Column) {
  if (v === null || v === undefined) return <span className="text-muted">null</span>;
  if (isDate(c) && typeof v === "string") return new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  if (typeof v === "object") return <span className="font-mono text-xs">{JSON.stringify(v)}</span>;
  return String(v);
}

/** The value as the editor shows it: JSON for objects/arrays, plain text otherwise. */
const toText = (v: unknown, c: Column) => (v === null || v === undefined ? "" : isJson(c) ? JSON.stringify(v, null, 2) : String(v));

export default function AdminDbPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <DbBrowser />
    </Suspense>
  );
}

/** Any table of the live database: search, sort, filter by exact values, edit or delete one row. */
function DbBrowser() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const table = params.get("table") ?? "User";
  const filter = params.get("filter");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const query = useDeferredValue(q);

  const tables = useSWR<{ tables: Array<{ name: string }> }>("/admin/db");
  const key = `/admin/db/${encodeURIComponent(table)}${qs({ q: query, page, sort: sort?.col, dir: sort?.dir, filter })}`;
  const { data, error, mutate, isValidating } = useSWR<Page>(key, { keepPreviousData: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const open = (name: string, f?: string | null) => {
    setQ("");
    setPage(1);
    setSort(null);
    router.push(`${pathname}${qs({ table: name, filter: f ?? undefined })}`);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Таблицы" className="lg:sticky lg:top-24 lg:self-start">
        <select aria-label="Таблица" className="h-11 w-full rounded-xl border border-line bg-surface px-3 lg:hidden" value={table} onChange={(e) => open(e.target.value)}>
          {tables.data?.tables.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <ul className="hidden max-h-[calc(100vh-8rem)] flex-col overflow-y-auto text-sm lg:flex">
          {tables.data?.tables.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => open(t.name)}
                className={clsx("block w-full rounded-lg px-3 py-1.5 text-left", t.name === table ? "bg-ink text-accent-ink" : "text-ink-2 hover:bg-ink/5")}
              >
                <span className="truncate">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{table}</h1>
          {data && <span className="text-sm text-muted tabular">{data.total.toLocaleString("ru-RU")} строк</span>}
          {isValidating && <Spinner className="text-muted" />}
          <Input aria-label="Поиск" placeholder="Поиск по текстовым полям…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="ml-auto w-full max-w-xs" />
        </div>
        {filter && (
          <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-ink/5 px-3 py-1 font-mono text-xs">{filter}</span>
            <button type="button" className="text-ink-2 hover:underline" onClick={() => open(table)}>
              Сбросить фильтр
            </button>
          </p>
        )}

        {error ? (
          <ErrorState message={error instanceof ApiError ? error.message : "Не удалось загрузить"} onRetry={() => mutate()} />
        ) : !data ? (
          <Skeleton className="h-96 rounded-2xl" />
        ) : data.rows.length === 0 ? (
          <EmptyState title="Пусто" hint={q || filter ? "Попробуйте другой запрос" : undefined} />
        ) : (
          <div className="overflow-auto rounded-2xl bg-surface" style={{ maxHeight: "calc(100vh - 14rem)" }}>
            <table className="w-max min-w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface text-xs text-muted">
                <tr className="border-b border-line">
                  {data.columns.map((c) => (
                    <th key={c.name} className="whitespace-nowrap px-3 py-2.5 font-medium">
                      <button
                        type="button"
                        className="hover:text-ink"
                        title={c.type}
                        onClick={() => setSort({ col: c.name, dir: data.sort === c.name && data.dir === "desc" ? "asc" : "desc" })}
                      >
                        {c.pk && "🔑 "}
                        {c.name}
                        {data.sort === c.name && (data.dir === "desc" ? " ↓" : " ↑")}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r, i) => (
                  <tr key={i} onClick={() => setEditing(r)} className="cursor-pointer hover:bg-ink/[0.03]">
                    {data.columns.map((c) => (
                      <td key={c.name} className="max-w-[280px] truncate whitespace-nowrap px-3 py-2">
                        {cell(r[c.name], c)}
                      </td>
                    ))}
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
      </div>

      {editing && data && (
        <RowEditor
          table={table}
          columns={data.columns}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function RowEditor({ table, columns, row, onClose, onSaved }: { table: string; columns: Column[]; row: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(columns.map((c) => [c.name, toText(row[c.name], c)])));
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const key = Object.fromEntries(columns.filter((c) => c.pk).map((c) => [c.name, row[c.name]]));
  const changed = columns.filter((c) => !c.pk && !c.secret && draft[c.name] !== toText(row[c.name], c));

  const save = async () => {
    const set: Record<string, unknown> = {};
    const errs: Record<string, string> = {};
    for (const c of changed) {
      const text = draft[c.name];
      if (text === "" && c.nullable) set[c.name] = null;
      else if (isJson(c)) {
        try {
          set[c.name] = JSON.parse(text);
        } catch {
          errs[c.name] = "Неверный JSON";
        }
      } else set[c.name] = text;
    }
    setFieldError(errs);
    if (Object.keys(errs).length) return;
    setBusy("save");
    try {
      await api(`/admin/db/${encodeURIComponent(table)}`, { method: "PATCH", body: { key, set } });
      toast("Сохранено");
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить строку из ${table}? Это необратимо.`)) return;
    setBusy("delete");
    try {
      await api(`/admin/db/${encodeURIComponent(table)}`, { method: "DELETE", body: { key } });
      toast("Строка удалена");
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось удалить");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${table} · ${Object.values(key).join(" · ")}`} width="max-w-2xl">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {columns.map((c) => {
          const id = `col-${c.name}`;
          const readOnly = c.pk || c.secret;
          const hint = `${c.type}${c.nullable ? " · пусто = null" : ""}${c.pk ? " · ключ" : ""}${c.secret ? " · скрыто" : ""}`;
          const set = (v: string) => setDraft({ ...draft, [c.name]: v });
          return (
            <Field key={c.name} label={c.name} htmlFor={id} hint={hint} error={fieldError[c.name]}>
              {c.enumValues ? (
                <select id={id} disabled={readOnly} className="h-11 rounded-xl border border-line bg-surface px-3" value={draft[c.name]} onChange={(e) => set(e.target.value)}>
                  {c.nullable && <option value="">null</option>}
                  {c.enumValues.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : c.type === "boolean" ? (
                <select id={id} disabled={readOnly} className="h-11 rounded-xl border border-line bg-surface px-3" value={draft[c.name]} onChange={(e) => set(e.target.value)}>
                  {c.nullable && <option value="">null</option>}
                  <option>true</option>
                  <option>false</option>
                </select>
              ) : isJson(c) || draft[c.name].length > 80 ? (
                <Textarea id={id} readOnly={readOnly} rows={Math.min(10, draft[c.name].split("\n").length + 1)} className="font-mono text-xs" value={draft[c.name]} onChange={(e) => set(e.target.value)} />
              ) : (
                <Input id={id} readOnly={readOnly} value={draft[c.name]} onChange={(e) => set(e.target.value)} className={clsx(readOnly && "text-muted")} />
              )}
            </Field>
          );
        })}
        <div className="sticky bottom-0 -mx-1 flex items-center gap-2 bg-surface px-1 py-3">
          <Button type="submit" loading={busy === "save"} disabled={!changed.length}>
            Сохранить{changed.length ? ` (${changed.length})` : ""}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button type="button" variant="danger" className="ml-auto" loading={busy === "delete"} onClick={remove}>
            Удалить строку
          </Button>
        </div>
      </form>
    </Modal>
  );
}
