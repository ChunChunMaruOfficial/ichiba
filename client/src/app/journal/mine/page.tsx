"use client";

import Link from "next/link";
import useSWR from "swr";
import { useDialog } from "@/components/dialog";
import { RequireAuth } from "@/components/require-auth";
import { useToast } from "@/components/toast";
import { Badge, ButtonLink, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { ARTICLE_STATUS, type MyArticle } from "@/lib/journal-drafts";
import { rubricOrOwn } from "@/lib/journal-rubrics";

/** «Мои статьи»: every article the reader started, where each one stands, and the way back into the editor. */
export default function MyArticlesPage() {
  return <RequireAuth reason="чтобы писать статьи в журнал">{() => <List />}</RequireAuth>;
}

function List() {
  const { data, error, mutate } = useSWR<{ items: MyArticle[] }>("/journal/mine");
  const { confirm } = useDialog();
  const toast = useToast();

  const remove = async (a: MyArticle) => {
    const ok = await confirm({
      title: `Удалить «${a.title || "Без названия"}»?`,
      message: a.status === "PUBLISHED" ? "Статья пропадёт из журнала. Вернуть её не получится." : "Черновик удалится насовсем.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/journal/mine/${a.id}`, { method: "DELETE" });
      void mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось удалить", { tone: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-[960px] px-4 pb-16 pt-4 md:px-6">
      <nav aria-label="Хлебные крошки" className="mb-3 text-sm text-muted">
        <Link href="/journal" className="hover:text-ink">
          Журнал
        </Link>{" "}
        / <span className="text-ink-2">Мои статьи</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Мои статьи</h1>
          <p className="mt-2 max-w-xl text-[15px] text-ink-2">Черновики, статьи на проверке и опубликованные. ИИ смотрит только тему, текст читает редактор.</p>
        </div>
        <ButtonLink href="/journal/write" variant="primary">
          Написать статью
        </ButtonLink>
      </header>

      <div className="mt-8">
        {error ? (
          <ErrorState message="Не удалось загрузить статьи" onRetry={() => void mutate()} />
        ) : !data ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-3xl" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState kanji="読物" title="Вы ещё не писали в журнал" hint="Расскажите, как продали или нашли вещь, разберите бренд или поделитесь уходом за любимой курткой.">
            <ButtonLink href="/journal/write" variant="primary">
              Написать первую статью
            </ButtonLink>
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.items.map((a) => {
              const s = ARTICLE_STATUS[a.status];
              const href = a.status === "PUBLISHED" ? `/journal/${a.slug}` : `/journal/write?id=${a.id}`;
              return (
                <li key={a.id} className="flex gap-4 rounded-3xl bg-surface p-4 shadow-[var(--shadow-paper)] md:p-5">
                  <Link href={href} className="w-24 shrink-0 overflow-hidden rounded-2xl bg-kraft/60 md:w-32" style={{ aspectRatio: "3 / 2" }} aria-hidden tabIndex={-1}>
                    {a.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.cover.urls.s} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center font-brush text-2xl text-shu/70">{rubricOrOwn(a.rubric)?.kanji ?? "読"}</span>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {a.rubric && <span className="text-xs text-muted">{rubricOrOwn(a.rubric)!.name}</span>}
                    </div>
                    <Link href={href} className="mt-1.5 line-clamp-2 text-lg font-semibold leading-snug hover:underline">
                      {a.title || "Без названия"}
                    </Link>
                    {a.rejectReason && (a.status === "AI_REJECTED" || a.status === "REJECTED") ? (
                      <p className="mt-1 line-clamp-2 text-sm text-ink-2">{a.rejectReason}</p>
                    ) : (
                      <p className="mt-1 text-sm text-muted">
                        {a.words} {a.words % 10 === 1 && a.words % 100 !== 11 ? "слово" : "слов"} · изменена {new Date(a.updatedAt).toLocaleDateString("ru", { day: "numeric", month: "long" })}
                      </p>
                    )}
                    <div className="mt-2 flex gap-4 text-sm">
                      <Link href={href} className="font-medium text-indigo hover:underline">
                        {a.status === "PUBLISHED" ? "Открыть в журнале" : a.status === "PENDING" ? "Посмотреть" : "Редактировать"}
                      </Link>
                      <button type="button" onClick={() => void remove(a)} className="text-muted hover:text-danger">
                        Удалить
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
