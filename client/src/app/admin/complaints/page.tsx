"use client";

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import { COMPLAINT_TOPICS, type ComplaintTopic } from "@/components/complaint-form";
import { useDialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, Chip, EmptyState, Spinner, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

interface Row {
  id: string;
  number: number;
  userId: string | null;
  username: string | null;
  name: string;
  email: string;
  topic: ComplaintTopic;
  about: string | null;
  text: string;
  status: "NEW" | "ANSWERED";
  answer: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
  createdAt: string;
}

const TABS = [
  ["NEW", "Новые"],
  ["ANSWERED", "Отвеченные"],
  ["all", "Все"],
] as const;

/** The answer is due within 15 days of the complaint (Правила площадки, the user agreement). */
const DUE_DAYS = 15;
const DAY = 86_400_000;
const date = (s: string | number) => new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });

/** Complaints from /complaint: who wrote, about what, and the answer that goes to their email. */
export default function AdminComplaintsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("NEW");
  const { data, mutate } = useSWR<{ items: Row[] }>(`/admin/complaints?status=${tab}`);
  const { confirm } = useDialog();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Deadlines are counted from when the page was opened.
  const [now] = useState(() => Date.now());

  const send = async (r: Row) => {
    const answer = (drafts[r.id] ?? "").trim();
    if (answer.length < 10) return toast("Напишите ответ", { tone: "error" });
    if (!(await confirm({ title: `Отправить ответ на обращение № ${r.number}?`, message: `Письмо уйдёт на ${r.email}. Изменить ответ потом будет нельзя.`, confirmLabel: "Отправить" }))) return;
    setBusy(r.id);
    try {
      await api(`/admin/complaints/${r.id}/answer`, { body: { answer } });
      toast("Ответ отправлен");
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== r.id)));
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? (e.fields.answer ?? e.message) : "Не удалось", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Жалобы и обращения</h1>
        <div className="flex flex-wrap gap-2">
          {TABS.map(([k, l]) => (
            <Chip key={k} active={tab === k} onClick={() => setTab(k)}>
              {l}
            </Chip>
          ))}
        </div>
      </div>
      {!data ? (
        <Spinner className="text-muted" />
      ) : data.items.length === 0 ? (
        <EmptyState title={tab === "NEW" ? "Новых обращений нет" : "Пусто"} />
      ) : (
        <ul className="flex flex-col gap-4">
          {data.items.map((r) => {
            const due = new Date(r.createdAt).getTime() + DUE_DAYS * DAY;
            const daysLeft = Math.ceil((due - now) / DAY);
            return (
              <li key={r.id} className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-paper)]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-lg font-semibold">
                    № {r.number} · {COMPLAINT_TOPICS[r.topic] ?? r.topic}{" "}
                    {r.status === "ANSWERED" ? <Badge tone="ok">отвечено</Badge> : <Badge tone={daysLeft <= 3 ? "danger" : "warn"}>{daysLeft > 0 ? `ответить до ${date(due)}` : "срок ответа прошёл"}</Badge>}
                  </p>
                  <p className="text-sm text-muted">{date(r.createdAt)}</p>
                </div>
                <p className="mt-1 text-sm text-ink-2">
                  {r.name} ·{" "}
                  <a href={`mailto:${r.email}`} className="underline underline-offset-4">
                    {r.email}
                  </a>
                  {r.username && (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={`/u/${r.username}`} className="font-medium text-ink underline underline-offset-4">
                        @{r.username}
                      </Link>
                    </>
                  )}
                </p>
                {r.about && <p className="mt-3 break-words text-sm text-ink-2">О чём: {r.about}</p>}
                <p className="mt-3 whitespace-pre-line break-words text-[15px] leading-relaxed">{r.text}</p>
                {r.status === "ANSWERED" ? (
                  <div className="mt-4 rounded-xl bg-surface-sunk p-4 text-[15px] leading-relaxed">
                    <p className="text-sm text-muted">
                      Ответ{r.answeredBy && ` @${r.answeredBy}`}
                      {r.answeredAt && `, ${date(r.answeredAt)}`}
                    </p>
                    <p className="mt-1 whitespace-pre-line">{r.answer}</p>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    <Textarea
                      aria-label={`Ответ на обращение № ${r.number}`}
                      rows={4}
                      value={drafts[r.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      placeholder="Ответ уйдёт автору на почту. Приветствие и номер обращения письмо добавит само."
                    />
                    <Button size="sm" className="self-start" loading={busy === r.id} onClick={() => send(r)}>
                      Отправить ответ
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
