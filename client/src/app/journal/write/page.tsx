"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MdPreview } from "@/components/journal/md-preview";
import { RequireAuth } from "@/components/require-auth";
import { useToast } from "@/components/toast";
import { Badge, Button, ButtonLink, IconCamera, IconCheck, IconX, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { ARTICLE_LIMITS, ARTICLE_STATUS, editable, type MyArticle } from "@/lib/journal-drafts";
import { RUBRICS, rubricBySlug } from "@/lib/journal-rubrics";
import type { Me } from "@/lib/types";
import { uploadPhoto } from "@/lib/upload";

/**
 * The article editor (/journal/write, /journal/write?id=…). It saves by itself a second after the author stops
 * typing; the toolbar writes Markdown into the text; «Как увидят читатели» shows the page as it will be. Sending runs
 * the AI topic check right away and then waits for an admin (server/src/journal/journal.ts).
 */

type Fields = {
  rubric: string;
  title: string;
  description: string;
  body: string;
  coverId: string | null;
};
type Cover = MyArticle["cover"];
const EMPTY: Fields = {
  rubric: "",
  title: "",
  description: "",
  body: "",
  coverId: null,
};
const SAVE_AFTER_MS = 1200;

const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** A textarea that grows with its text instead of scrolling inside the page. */
function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

export default function WritePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24 text-muted">
          <Spinner />
        </div>
      }
    >
      <RequireAuth reason="чтобы написать статью в журнал">{(me) => <Editor me={me} />}</RequireAuth>
    </Suspense>
  );
}

function Editor({ me }: { me: Me }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const idParam = params.get("id");

  const [article, setArticle] = useState<MyArticle | null>(null);
  const [loading, setLoading] = useState(!!idParam);
  const [f, setF] = useState<Fields>(EMPTY);
  const [cover, setCover] = useState<Cover>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState<number | null>(null);

  const id = useRef<string | null>(idParam);
  /** The article whose fields are in the form: opened by its id once, or created here (then nothing to load). */
  const loaded = useRef<string | null>(null);
  const dirty = useRef<Partial<Fields>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const titleRef = useAutosize(f.title);
  const leadRef = useAutosize(f.description);
  const bodyRef = useAutosize(f.body);
  const fileInput = useRef<HTMLInputElement>(null);

  const status = article?.status ?? "DRAFT";
  const canEdit = editable(status);

  // An article opened by its id: the fields come from the server once.
  // Loaded once per id (not cancelled on cleanup: a second effect run in development must not lose the answer).
  useEffect(() => {
    if (!idParam || loaded.current === idParam) return;
    loaded.current = idParam;
    id.current = idParam;
    api<MyArticle>(`/journal/mine/${idParam}`)
      .then((a) => {
        setArticle(a);
        setF({
          rubric: a.rubric,
          title: a.title,
          description: a.description,
          body: a.body ?? "",
          coverId: a.cover?.id ?? null,
        });
        setCover(a.cover);
      })
      .catch((e) =>
        toast(e instanceof ApiError ? e.message : "Не удалось открыть статью", {
          tone: "error",
        }),
      )
      .finally(() => setLoading(false));
  }, [idParam, toast]);

  /**
   * Sends what changed since the last save, one save at a time (what was typed during one goes out right after it);
   * the first save creates the article and puts its id in the address. A failed save keeps its changes for the next.
   */
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    for (;;) {
      if (running.current) {
        await running.current;
        continue;
      }
      const changes = dirty.current;
      if (!Object.keys(changes).length) return;
      dirty.current = {};
      setSave("saving");
      let ok = true;
      const job = (async () => {
        try {
          const saved = id.current
            ? await api<MyArticle>(`/journal/mine/${id.current}`, {
                method: "PATCH",
                body: changes,
              })
            : await api<MyArticle>("/journal/mine", { body: changes });
          if (!id.current) {
            id.current = saved.id;
            loaded.current = saved.id;
            router.replace(`/journal/write?id=${saved.id}`, { scroll: false });
          }
          setArticle(saved);
          setSave("saved");
          setSavedAt(new Date());
        } catch (e) {
          ok = false;
          dirty.current = { ...changes, ...dirty.current };
          setSave("error");
          if (e instanceof ApiError && e.status !== 0) toast(e.message, { tone: "error" });
        }
      })();
      running.current = job;
      await job;
      running.current = null;
      if (!ok) return;
    }
  }, [router, toast]);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    dirty.current = { ...dirty.current, [k]: v };
    setErrors((e) => ({ ...e, [k]: "" }));
    setSave("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  };

  // Leaving with unsaved words: the browser asks first; the save also goes out when the tab is hidden.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.keys(dirty.current).length || running.current) e.preventDefault();
    };
    const onHide = () => document.visibilityState === "hidden" && void flush();
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setUpload(0);
    try {
      const photo = await uploadPhoto(file, (share) => setUpload(share));
      setCover({
        id: photo.id,
        width: photo.width,
        height: photo.height,
        urls: photo.urls,
      });
      set("coverId", photo.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось загрузить фото", {
        tone: "error",
      });
    } finally {
      setUpload(null);
    }
  };

  // ---------- the toolbar: Markdown written around the selection ----------

  const edit = (next: string, start: number, end: number) => {
    set("body", next);
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  };
  const wrap = (mark: string, placeholder: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const inner = value.slice(a, b) || placeholder;
    edit(`${value.slice(0, a)}${mark}${inner}${mark}${value.slice(b)}`, a + mark.length, a + mark.length + inner.length);
  };
  const prefixLines = (prefix: (i: number) => string, placeholder: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const from = value.lastIndexOf("\n", a - 1) + 1;
    const toRaw = value.indexOf("\n", b);
    const to = toRaw === -1 ? value.length : toRaw;
    const lines = (value.slice(from, to) || placeholder).split("\n");
    const block = lines.map((l, i) => `${prefix(i)}${l.replace(/^(#{2,3}\s+|>\s?|[-*]\s+|\d+[.)]\s+)/, "")}`).join("\n");
    // A heading, a list or a quote stands apart from the paragraphs around it.
    const before = value.slice(0, from);
    const after = value.slice(to);
    const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const trail = after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    const start = before.length + lead.length;
    edit(`${before}${lead}${block}${trail}${after}`, start, start + block.length);
  };
  const link = () => {
    const el = bodyRef.current;
    if (!el) return;
    const url = window.prompt("Ссылка (https://…)", "https://");
    if (!url || !/^https?:\/\/\S+$/i.test(url.trim())) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const text = value.slice(a, b) || "текст ссылки";
    edit(`${value.slice(0, a)}[${text}](${url.trim()})${value.slice(b)}`, a + 1, a + 1 + text.length);
  };
  const onBodyKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b" || k === "и") {
      e.preventDefault();
      wrap("**", "жирный текст");
    } else if (k === "i" || k === "ш") {
      e.preventDefault();
      wrap("*", "курсив");
    } else if (k === "k" || k === "л") {
      e.preventDefault();
      link();
    }
  };

  // ---------- sending ----------

  const checks = [
    { key: "rubric", ok: !!rubricBySlug(f.rubric), text: "Рубрика выбрана" },
    {
      key: "title",
      ok: f.title.trim().length >= ARTICLE_LIMITS.title[0],
      text: `Заголовок — от ${ARTICLE_LIMITS.title[0]} символов`,
    },
    {
      key: "description",
      ok: f.description.trim().length >= ARTICLE_LIMITS.description[0],
      text: `Подводка — от ${ARTICLE_LIMITS.description[0]} символов`,
    },
    {
      key: "body",
      ok: f.body.trim().length >= ARTICLE_LIMITS.body[0],
      text: `Текст — от ${ARTICLE_LIMITS.body[0]} символов (сейчас ${f.body.trim().length})`,
    },
  ];
  const ready = checks.every((c) => c.ok);

  const submit = async () => {
    setSubmitting(true);
    try {
      await flush();
      if (!id.current) return;
      const a = await api<MyArticle>(`/journal/mine/${id.current}/submit`, {
        method: "POST",
      });
      setArticle(a);
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (a.status === "PENDING") toast("Тема подходит — статья ушла редактору");
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        toast(e.message, { tone: "error" });
      } else toast("Не удалось отправить статью", { tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (!id.current) return;
    try {
      setArticle(
        await api<MyArticle>(`/journal/mine/${id.current}/withdraw`, {
          method: "POST",
        }),
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не получилось", {
        tone: "error",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner />
      </div>
    );
  }

  const words = countWords(f.body);
  const rubric = rubricBySlug(f.rubric);

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-16 pt-4 md:px-6">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-muted">
        <Link href="/journal" className="hover:text-ink">
          Журнал
        </Link>{" "}
        /{" "}
        <Link href="/journal/mine" className="hover:text-ink">
          Мои статьи
        </Link>{" "}
        / <span className="text-ink-2">{article ? "Статья" : "Новая статья"}</span>
      </nav>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
        <div className="min-w-0">
          {/* The bar that stays: where the article is, whether it is saved, and the two views. */}
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={ARTICLE_STATUS[status].tone}>{ARTICLE_STATUS[status].label}</Badge>
            <span className="text-xs text-muted" aria-live="polite">
              {save === "saving"
                ? "Сохраняем…"
                : save === "error"
                  ? "Не сохранилось — попробуем ещё раз"
                  : savedAt
                    ? `Сохранено в ${savedAt.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}`
                    : article
                      ? "Сохранено"
                      : "Черновик сохранится сам"}
            </span>
            <div role="radiogroup" aria-label="Вид" className="ml-auto flex rounded-full bg-surface p-0.5 text-sm shadow-[inset_0_0_0_1px_var(--line-strong)]">
              {(
                [
                  ["edit", "Текст"],
                  ["preview", "Как увидят читатели"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={clsx("h-8 rounded-full px-3.5 font-medium transition-colors", mode === m ? "bg-ink text-accent-ink" : "text-ink-2 hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <StatusBanner article={article} onWithdraw={withdraw} />

          {mode === "preview" ? (
            <article className="mx-auto max-w-[42rem]">
              {rubric && <p className="text-sm font-medium text-indigo">{rubric.name}</p>}
              <h1 className="mt-2 text-3xl font-semibold leading-[1.1] tracking-tight [text-wrap:balance] md:text-[2.75rem]">
                {f.title || "Заголовок статьи"}
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-ink-2 md:text-[19px]">{f.description || "Подводка: о чём статья, в двух-трёх предложениях."}</p>
              <p className="mt-5 text-sm text-muted">
                @{me.username} · {Math.max(1, Math.round(words / 180))} мин чтения
              </p>
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover.urls.l} alt="" className="mt-8 aspect-[3/2] w-full rounded-3xl object-cover" />
              )}
              <div className="mt-8">
                <MdPreview source={f.body} />
              </div>
            </article>
          ) : (
            <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-7 disabled:opacity-80">
              <div>
                <p className="mb-2 text-sm font-medium text-ink-2">Рубрика</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Рубрика">
                  {RUBRICS.map((r) => (
                    <button
                      key={r.slug}
                      type="button"
                      role="radio"
                      aria-checked={f.rubric === r.slug}
                      onClick={() => set("rubric", r.slug)}
                      className={clsx("chip inline-flex h-9 items-center gap-2 px-4 text-sm font-medium", f.rubric === r.slug && "bg-ink text-accent-ink")}
                    >
                      <span aria-hidden className={clsx("font-brush text-xs", f.rubric === r.slug ? "text-accent-ink" : "text-shu")}>
                        {r.kanji}
                      </span>
                      {r.name}
                    </button>
                  ))}
                </div>
                {errors.rubric && <p className="mt-2 text-sm text-danger">{errors.rubric}</p>}
              </div>

              {/* The cover: one photo, shown 3:2 at the top of the article and on its card. */}
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="sr-only"
                  onChange={(e) => void pickCover(e.target.files?.[0])}
                  tabIndex={-1}
                  aria-hidden
                />
                {cover ? (
                  <div className="group relative overflow-hidden rounded-3xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cover.urls.l} alt="Обложка статьи" className="aspect-[3/2] w-full object-cover" />
                    {canEdit && (
                      <div className="absolute right-3 top-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => fileInput.current?.click()}
                          className="on-photo rounded-full px-3 py-1.5 text-sm font-medium text-ink"
                        >
                          Заменить
                        </button>
                        <button
                          type="button"
                          aria-label="Убрать обложку"
                          onClick={() => {
                            setCover(null);
                            set("coverId", null);
                          }}
                          className="on-photo grid size-8 place-items-center rounded-full text-ink"
                        >
                          <IconX className="size-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void pickCover(e.dataTransfer.files?.[0]);
                    }}
                    className="waves flex aspect-[3/1] w-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-line-strong text-ink-2 transition-colors hover:border-ink hover:text-ink"
                  >
                    {upload !== null ? (
                      <>
                        <Spinner />
                        <span className="text-sm">Загружаем… {Math.round(upload * 100)}%</span>
                      </>
                    ) : (
                      <>
                        <IconCamera className="size-7" />
                        <span className="text-sm font-medium">Обложка — нажмите или перетащите фото</span>
                        <span className="text-xs text-muted">Горизонтальное, от 1200 px по ширине. Можно и без обложки</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* The sizes sit on the wrappers: on touch screens a field's own size is max(16px, 1em) of its parent
                  (globals.css, against iOS zoom), so a text-3xl on the textarea itself would shrink to 16px. */}
              <div>
                <label htmlFor="a-title" className="sr-only">
                  Заголовок
                </label>
                <div className="text-3xl md:text-[2.75rem]">
                  <textarea
                    id="a-title"
                    ref={titleRef}
                    rows={1}
                    maxLength={ARTICLE_LIMITS.title[1]}
                    value={f.title}
                    onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
                    placeholder="Заголовок"
                    className="w-full resize-none overflow-hidden bg-transparent text-[length:inherit] font-semibold leading-[1.1] tracking-tight outline-none placeholder:text-ink/25"
                  />
                </div>
                {errors.title && <p className="mt-1 text-sm text-danger">{errors.title}</p>}
                <label htmlFor="a-lead" className="sr-only">
                  Подводка
                </label>
                <div className="mt-4 text-lg md:text-[19px]">
                  <textarea
                    id="a-lead"
                    ref={leadRef}
                    rows={2}
                    maxLength={ARTICLE_LIMITS.description[1]}
                    value={f.description}
                    onChange={(e) => set("description", e.target.value.replace(/\n/g, " "))}
                    placeholder="Подводка: о чём статья и кому она пригодится, в двух-трёх предложениях"
                    className="w-full resize-none overflow-hidden bg-transparent text-[length:inherit] leading-relaxed text-ink-2 outline-none placeholder:text-ink/30"
                  />
                </div>
                <p className="text-right text-xs text-muted">
                  {f.description.length}/{ARTICLE_LIMITS.description[1]}
                </p>
                {errors.description && <p className="text-sm text-danger">{errors.description}</p>}
              </div>

              <div className="rounded-3xl bg-surface shadow-[var(--shadow-paper)] ring-1 ring-line">
                {/* Stays under the site header (which slides away on the way down, as the chips row does) through a long text. */}
                <div
                  role="toolbar"
                  aria-label="Оформление текста"
                  className="no-scrollbar sticky z-10 flex items-center gap-1 overflow-x-auto rounded-t-3xl border-b border-line bg-surface px-3 py-2 transition-transform duration-300"
                  style={{
                    top: "var(--header-h, 57px)",
                    transform: "translateY(calc(var(--header-offset, var(--header-h, 57px)) - var(--header-h, 57px)))",
                  }}
                >
                  <Tool label="Заголовок раздела" onClick={() => prefixLines(() => "## ", "Заголовок раздела")}>
                    H2
                  </Tool>
                  <Tool label="Подзаголовок" onClick={() => prefixLines(() => "### ", "Подзаголовок")}>
                    H3
                  </Tool>
                  <span aria-hidden className="mx-1 h-5 w-px bg-line" />
                  <Tool label="Жирный (Ctrl+B)" onClick={() => wrap("**", "жирный текст")}>
                    <b>Ж</b>
                  </Tool>
                  <Tool label="Курсив (Ctrl+I)" onClick={() => wrap("*", "курсив")}>
                    <i className="font-serif">К</i>
                  </Tool>
                  <span aria-hidden className="mx-1 h-5 w-px bg-line" />
                  <Tool label="Список" onClick={() => prefixLines(() => "- ", "пункт списка")}>
                    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
                      <path d="M9 6h11M9 12h11M9 18h11" />
                      <circle cx="4.5" cy="6" r="1" fill="currentColor" />
                      <circle cx="4.5" cy="12" r="1" fill="currentColor" />
                      <circle cx="4.5" cy="18" r="1" fill="currentColor" />
                    </svg>
                  </Tool>
                  <Tool label="Нумерованный список" onClick={() => prefixLines((i) => `${i + 1}. `, "первый шаг")}>
                    <span className="text-xs font-semibold tabular">1.</span>
                  </Tool>
                  <Tool label="Цитата" onClick={() => prefixLines(() => "> ", "цитата")}>
                    <span className="font-serif text-lg leading-none">«»</span>
                  </Tool>
                  <Tool label="Ссылка (Ctrl+K)" onClick={link}>
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
                      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                    </svg>
                  </Tool>
                  <span className="ml-auto shrink-0 whitespace-nowrap pl-2 pr-1 text-xs text-muted tabular">
                    {words}{" "}
                    {words % 10 === 1 && words % 100 !== 11
                      ? "слово"
                      : words % 10 >= 2 && words % 10 <= 4 && (words % 100 < 10 || words % 100 >= 20)
                        ? "слова"
                        : "слов"}{" "}
                    · {Math.max(1, Math.round(words / 180))} мин
                  </span>
                </div>
                <label htmlFor="a-body" className="sr-only">
                  Текст статьи
                </label>
                <div className="text-[17px]">
                  <textarea
                    id="a-body"
                    ref={bodyRef}
                    value={f.body}
                    maxLength={ARTICLE_LIMITS.body[1]}
                    onChange={(e) => set("body", e.target.value)}
                    onKeyDown={onBodyKey}
                    placeholder={
                      "Начните с главного: что случилось, что вы узнали, чем это поможет читателю.\n\nРазделы отмечайте кнопкой H2, списки — кнопкой списка. Пустая строка начинает новый абзац."
                    }
                    className="block min-h-[24rem] w-full resize-none overflow-hidden rounded-b-3xl bg-transparent px-5 py-5 text-[length:inherit] leading-relaxed outline-none placeholder:text-ink/30 md:px-7"
                  />
                </div>
              </div>
              {errors.body && <p className="-mt-4 text-sm text-danger">{errors.body}</p>}
            </fieldset>
          )}

          {canEdit && (
            <div className="mt-8 flex flex-col gap-4 rounded-3xl bg-kraft/40 p-5 md:flex-row md:items-center md:justify-between md:p-6">
              <ul className="flex flex-col gap-1.5 text-sm">
                {checks.map((c) => (
                  <li key={c.key} className={clsx("flex items-center gap-2", c.ok ? "text-ink" : "text-ink-2")}>
                    <span className={clsx("grid size-5 shrink-0 place-items-center rounded-full", c.ok ? "bg-ok text-accent-ink" : "ring-1 ring-line-strong")}>
                      {c.ok && <IconCheck className="size-3.5" />}
                    </span>
                    {c.text}
                  </li>
                ))}
              </ul>
              <div className="flex shrink-0 flex-col items-stretch gap-2 md:items-end">
                <Button size="lg" loading={submitting} disabled={!ready} onClick={() => void submit()}>
                  {submitting ? "Проверяем тему…" : status === "DRAFT" ? "Отправить на проверку" : "Отправить снова"}
                </Button>
                <p className="max-w-xs text-xs text-muted md:text-right">ИИ проверит, подходит ли тема журналу, затем статью прочитает редактор.</p>
              </div>
            </div>
          )}
        </div>

        <aside className="mt-10 lg:mt-0">
          <div className="flex flex-col gap-5 lg:sticky lg:top-24">
            <section className="rounded-3xl bg-surface p-5">
              <h2 className="text-base font-semibold">Как статья попадает в журнал</h2>
              <ol className="mt-3 flex flex-col gap-3 text-sm text-ink-2">
                {[
                  ["Пишете", "Черновик сохраняется сам, вернуться к нему можно из «Моих статей»."],
                  ["ИИ смотрит тему", "Только тему: одежда, мода, покупка и продажа вещей, уход, бренды. Текст он не правит и не оценивает."],
                  ["Редактор читает", "Публикует или возвращает с комментарием. Об этом придёт уведомление."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-accent-ink tabular">{i + 1}</span>
                    <span>
                      <b className="font-semibold text-ink">{t}.</b> {d}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section className="rounded-3xl bg-surface p-5 text-sm text-ink-2">
              <h2 className="text-base font-semibold text-ink">О чём писать</h2>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Как вы продали или нашли вещь и что поняли</li>
                <li>Гид по бренду, материалу, посадке</li>
                <li>Уход, ремонт, хранение</li>
                <li>Винтаж: как отличить, где искать</li>
              </ul>
              <p className="mt-3">Пишите от себя и по делу. Ссылки можно, рекламу чужих сервисов — нельзя.</p>
            </section>
            <section className="hidden rounded-3xl bg-surface p-5 text-sm text-ink-2 lg:block">
              <h2 className="text-base font-semibold text-ink">Разметка руками</h2>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[13px]">
                <dt>## Раздел</dt>
                <dd className="font-sans">заголовок</dd>
                <dt>**слово**</dt>
                <dd className="font-sans">жирный</dd>
                <dt>*слово*</dt>
                <dd className="font-sans">курсив</dd>
                <dt>- пункт</dt>
                <dd className="font-sans">список</dd>
                <dt>&gt; текст</dt>
                <dd className="font-sans">цитата</dd>
                <dt>[текст](https://…)</dt>
                <dd className="font-sans">ссылка</dd>
              </dl>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // The textarea keeps its selection: a mousedown on the button would take the focus first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="grid h-9 min-w-9 place-items-center rounded-xl px-2 text-sm font-semibold text-ink-2 transition-colors hover:bg-ink/[0.06] hover:text-ink"
    >
      {children}
    </button>
  );
}

/** Where the article stands, said in words, with the one thing the author can do about it. */
function StatusBanner({ article, onWithdraw }: { article: MyArticle | null; onWithdraw: () => void }) {
  if (!article || article.status === "DRAFT") return null;
  const box = "mb-6 rounded-2xl px-5 py-4 text-[15px] leading-relaxed";
  switch (article.status) {
    case "PENDING":
      return (
        <div className={clsx(box, "bg-ai-soft text-ink")}>
          <p className="font-semibold">Статья у редактора</p>
          <p className="mt-1 text-ink-2">
            Тема подходит журналу
            {article.aiTopic ? ` («${article.aiTopic}»)` : ""}. Редактор прочитает текст и опубликует его или вернёт с комментарием — придёт уведомление.
          </p>
          <button type="button" onClick={onWithdraw} className="mt-2 text-sm font-medium underline underline-offset-4">
            Вернуть в черновики, чтобы поправить
          </button>
        </div>
      );
    case "AI_REJECTED":
      return (
        <div className={clsx(box, "bg-danger-soft text-ink")}>
          <p className="font-semibold">Тема не подошла журналу</p>
          <p className="mt-1 text-ink-2">{article.rejectReason}</p>
          <p className="mt-1 text-sm text-ink-2">Журнал — про одежду, моду, покупку и продажу вещей. Поправьте статью и отправьте снова.</p>
        </div>
      );
    case "REJECTED":
      return (
        <div className={clsx(box, "bg-warn-soft text-ink")}>
          <p className="font-semibold">Редактор вернул статью</p>
          <p className="mt-1 text-ink-2">{article.rejectReason}</p>
          <p className="mt-1 text-sm text-ink-2">Поправьте текст и отправьте снова.</p>
        </div>
      );
    case "PUBLISHED":
      return (
        <div className={clsx(box, "bg-ok-soft text-ink")}>
          <p className="font-semibold">Статья опубликована</p>
          <p className="mt-1 text-ink-2">Опубликованный текст не правится. Нашли ошибку — напишите нам через «Контакты».</p>
          <ButtonLink href={`/journal/${article.slug}`} size="sm" variant="secondary" className="mt-3">
            Открыть в журнале
          </ButtonLink>
        </div>
      );
  }
}
