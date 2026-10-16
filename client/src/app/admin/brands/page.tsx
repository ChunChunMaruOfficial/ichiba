"use client";

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import { LEGAL_FORM_LABEL, type BrandApplication } from "@/components/brand-application";
import { useDialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, Chip, EmptyState, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type Row = BrandApplication & {
  user: { id: string; username: string; email: string | null; createdAt: string; brandVerifiedAt: string | null; catalogApprovedAt: string | null; _count: { listings: number } };
};

const TABS = [
  ["PENDING", "Новые"],
  ["APPROVED", "Одобренные"],
  ["REJECTED", "Отклонённые"],
  ["all", "Все"],
] as const;

const date = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });

/** Brand applications from Settings: who asked, their details and contacts; approve or decline with a reason. */
export default function AdminBrandsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("PENDING");
  const { data, mutate } = useSWR<{ items: Row[] }>(`/admin/brand-applications?status=${tab}`);
  const { prompt, confirm } = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (r: Row, approve: boolean) => {
    const catalog = r.kind === "CATALOG";
    const note = approve
      ? (await confirm(
          catalog
            ? { title: `Допустить @${r.user.username} в основной каталог?`, message: "Новые вещи с биркой этого продавца будут в каталоге, поношенные и без бирки — на вторичке. Проверьте происхождение товаров.", confirmLabel: "Допустить" }
            : { title: `Дать статус бренда «${r.brandName}»?`, message: `@${r.user.username} получит печать «Бренд», новые вещи встанут в основной каталог.`, confirmLabel: "Одобрить" },
        ))
        ? ""
        : null
      : await prompt({ title: `Отклонить «${r.brandName}»?`, label: "Причина — её увидит пользователь", multiline: true, confirmLabel: "Отклонить", danger: true });
    if (note === null || (!approve && !note)) return;
    setBusy(r.id);
    try {
      await api(`/admin/brand-applications/${r.id}/${approve ? "approve" : "reject"}`, { body: { note: note || null } });
      toast(approve ? (catalog ? "Продавец допущен в каталог" : "Статус бренда выдан") : "Заявка отклонена");
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Заявки брендов и продавцов</h1>
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
        <EmptyState title={tab === "PENDING" ? "Новых заявок нет" : "Пусто"} />
      ) : (
        <ul className="flex flex-col gap-4">
          {data.items.map((r) => (
            <li key={r.id} className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-paper)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">
                    {r.brandName}{" "}
                    {r.kind === "CATALOG" && <Badge tone="muted">допуск в каталог</Badge>}{" "}
                    {r.status === "PENDING" ? <Badge tone="warn">новая</Badge> : r.status === "APPROVED" ? <Badge tone="ok">одобрена</Badge> : <Badge tone="danger">отклонена</Badge>}
                  </p>
                  <p className="text-sm text-ink-2">
                    <Link href={`/u/${r.user.username}`} className="font-medium text-ink underline underline-offset-4">
                      @{r.user.username}
                    </Link>{" "}
                    · {r.user._count.listings} вещей в продаже · на ichiba с {date(r.user.createdAt)} · заявка {date(r.createdAt)}
                  </p>
                </div>
                {r.status === "PENDING" && (
                  <div className="flex gap-2">
                    <Button size="sm" loading={busy === r.id} onClick={() => act(r, true)}>
                      Одобрить
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => act(r, false)}>
                      Отклонить
                    </Button>
                  </div>
                )}
              </div>
              <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted">Форма</dt>
                <dd>
                  {LEGAL_FORM_LABEL[r.legalForm]}
                  {r.legalName && ` · ${r.legalName}`}
                  {r.unp && ` · УНП ${r.unp}`}
                </dd>
                <dt className="text-muted">Контакт</dt>
                <dd>{[r.contactName, r.email, r.phone, r.telegram].filter(Boolean).join(" · ")}</dd>
                {r.links.length > 0 && (
                  <>
                    <dt className="text-muted">Ссылки</dt>
                    <dd className="flex flex-col">
                      {r.links.map((u) => (
                        <a key={u} href={/^https?:\/\//.test(u) ? u : `https://${u}`} target="_blank" rel="noreferrer noopener" className="truncate underline underline-offset-4">
                          {u}
                        </a>
                      ))}
                    </dd>
                  </>
                )}
                {r.adminNote && (
                  <>
                    <dt className="text-muted">Комментарий</dt>
                    <dd>{r.adminNote}</dd>
                  </>
                )}
              </dl>
              <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{r.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
