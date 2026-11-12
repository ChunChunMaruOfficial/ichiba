"use client";

import clsx from "clsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { useDialog } from "@/components/dialog";
import { MdPreview } from "@/components/journal/md-preview";
import { useToast } from "@/components/toast";
import { Badge, Button, Chip, EmptyState, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { ARTICLE_STATUS, type MyArticle } from "@/lib/journal-drafts";
import { rubricBySlug } from "@/lib/journal-rubrics";

interface Row extends MyArticle {
  body: string;
  aiVerdict: { checked?: boolean; fits?: boolean; topic?: string | null; reasons?: string[]; providers?: string[]; offShare?: number } | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  author: { id: string; username: string; blockedAt: string | null; deletedAt: string | null; listingsHiddenAt: string | null };
}

const TABS = [
  ["PENDING", "На проверке"],
  ["PUBLISHED", "Опубликованы"],
  ["REJECTED", "Возвращены"],
  ["AI_REJECTED", "Отсеял ИИ"],
  ["all", "Все"],
] as const;

const date = (s: string | null) => (s ? new Date(s).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—");

/**
 * Readers' articles waiting for a person: the AI has looked at the topic only, here someone reads the text and
 * publishes it to /journal or returns it with a reason the author sees (server/src/journal/journal.ts).
 */
export default function AdminJournalPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Queue />
    </Suspense>
  );
}

function Queue() {
  const params = useSearchParams();
  // A link from Telegram (?id=) opens that article under «Все», whatever happened to it since.
  const [tab, setTab] = useState<(typeof TABS)[number][0]>(params.get("id") ? "all" : "PENDING");
  const [open, setOpen] = useState<string | null>(params.get("id"));
  const { data, mutate } = useSWR<{ items: Row[]; pending: number }>(`/admin/journal?status=${tab}`);
  const { prompt } = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const publish = async (r: Row) => {
    setBusy(r.id);
    try {
      const res = await api<{ slug: string }>(`/admin/journal/${r.id}/publish`, { method: "POST" });
      toast("Опубликовано — в журнале появится в течение 10 минут", { action: { label: "Открыть", onClick: () => window.open(`/journal/${res.slug}`, "_blank") } });
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не получилось", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const reject = async (r: Row) => {
    const unpublish = r.status === "PUBLISHED";
    const reason = await prompt({
      title: unpublish ? `Снять «${r.title}» с журнала?` : `Вернуть «${r.title}» автору?`,
      message: "Причину увидит автор — напишите, что поправить.",
      label: "Причина",
      multiline: true,
      confirmLabel: unpublish ? "Снять с журнала" : "Вернуть",
      danger: unpublish,
    });
    if (!reason || reason.trim().length < 3) return;
    setBusy(r.id);
    try {
      await api(`/admin/journal/${r.id}/reject`, { body: { reason: reason.trim() } });
      toast(unpublish ? "Снято с журнала" : "Возвращено автору");
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не получилось", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {TABS.map(([key, label]) => (
          <Chip key={key} active={tab === key} onClick={() => setTab(key)}>
            {label}
            {key === "PENDING" && data?.pending ? <span className="rounded-full bg-shu px-1.5 text-[11px] font-semibold text-on-shu">{data.pending}</span> : null}
          </Chip>
        ))}
      </div>

      {!data ? (
        <div className="flex justify-center py-16 text-muted">
          <Spinner />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState kanji="読物" title={tab === "PENDING" ? "Статей на проверке нет" : "Здесь пусто"} />
      ) : (
        <ul className="flex flex-col gap-4">
          {data.items.map((r) => {
            const expanded = open === r.id;
            const s = ARTICLE_STATUS[r.status];
            const v = r.aiVerdict;
            return (
              <li key={r.id} className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-paper)]">
                <div className="flex gap-4">
                  {r.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.cover.urls.s} alt="" className="hidden aspect-[3/2] w-32 shrink-0 rounded-xl object-cover sm:block" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <span>{rubricBySlug(r.rubric)?.name ?? `«${r.rubric}» (своя рубрика)`}</span>·
                      <Link href={`/u/${r.author.username}`} target="_blank" className="font-medium text-ink-2 hover:underline">
                        @{r.author.username}
                      </Link>
                      {(r.author.blockedAt || r.author.deletedAt || r.author.listingsHiddenAt) && <Badge tone="danger">{r.author.deletedAt ? "удалён" : r.author.blockedAt ? "заблокирован" : "аккаунт скрыт"}</Badge>}
                      <span>· отправлена {date(r.submittedAt)}</span>
                      <span>· {r.words} слов</span>
                    </div>
                    <p className="mt-1.5 text-lg font-semibold leading-snug">{r.title}</p>
                    <p className="mt-1 text-[15px] text-ink-2">{r.description}</p>
                    {/* What the AI said about the topic: advice for the reader of the queue, never the decision. */}
                    <p className={clsx("mt-2 rounded-xl px-3 py-2 text-sm", !v?.checked ? "bg-warn-soft" : v.fits ? "bg-ai-soft" : "bg-danger-soft")}>
                      <b className="font-semibold">ИИ:</b>{" "}
                      {!v ? "не проверял" : !v.checked ? "ни одна модель не ответила — проверьте тему сами" : v.fits ? `тема подходит${v.topic ? ` — «${v.topic}»` : ""}` : `тема не подходит${v.reasons?.length ? `: ${v.reasons[0]}` : ""}`}
                      {v?.providers?.length ? <span className="text-muted"> · {v.providers.join(", ")}</span> : null}
                    </p>
                    {r.rejectReason && r.status !== "AI_REJECTED" && (
                      <p className="mt-2 text-sm text-ink-2">
                        <b className="font-semibold">Причина возврата:</b> {r.rejectReason} {r.reviewedBy && <span className="text-muted">· {r.reviewedBy}, {date(r.reviewedAt)}</span>}
                      </p>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="mt-5 border-t border-line pt-5">
                    {r.cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.cover.urls.l} alt="" className="mb-5 aspect-[3/2] w-full max-w-2xl rounded-2xl object-cover" />
                    )}
                    <div className="max-w-2xl">
                      <MdPreview source={r.body} />
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setOpen(expanded ? null : r.id)}>
                    {expanded ? "Свернуть текст" : "Читать текст"}
                  </Button>
                  {r.status !== "PUBLISHED" && (
                    <Button size="sm" loading={busy === r.id} onClick={() => void publish(r)}>
                      Опубликовать
                    </Button>
                  )}
                  {r.status === "PUBLISHED" && (
                    <Link href={`/journal/${r.slug}`} target="_blank" className="px-2 text-sm font-medium text-indigo hover:underline">
                      Открыть в журнале
                    </Link>
                  )}
                  {(r.status === "PENDING" || r.status === "PUBLISHED" || r.status === "AI_REJECTED") && (
                    <Button size="sm" variant={r.status === "PUBLISHED" ? "danger" : "secondary"} disabled={busy === r.id} onClick={() => void reject(r)}>
                      {r.status === "PUBLISHED" ? "Снять с журнала" : "Вернуть автору"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
