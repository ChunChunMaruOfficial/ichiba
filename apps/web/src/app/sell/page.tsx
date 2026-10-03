"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CoreFields, MoreFields, PriceFields } from "@/components/listing-fields";
import { PhotoManager } from "@/components/photo-manager";
import { RequireAuth } from "@/components/require-auth";
import { useMeta } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, ButtonLink, IconCheck, IconSparkle, IconX, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CONDITION_LABEL, DELIVERY_LABEL, formatPrice } from "@/lib/labels";
import { type AiState, applySuggestion, emptyValues, type ListingValues, type PhotoDraft, toPayload, validate } from "@/lib/listing-form";
import type { AiSuggestion, ListingDetail, Me, Meta } from "@/lib/types";

type Step = 1 | 2 | 3 | 4;
const STEPS = ["Фото", "Описание", "Цена", "Превью"];
const AI_MANUAL_AFTER_MS = 10_000;

export default function SellPage() {
  return <RequireAuth reason="чтобы выставить вещь">{(me) => <Sell me={me} />}</RequireAuth>;
}

function StepIndicator({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  return (
    <ol className="flex items-center gap-1.5 text-sm" aria-label="Шаги">
      {STEPS.map((label, i) => {
        const n = (i + 1) as Step;
        const done = n < step;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-3 bg-line-strong sm:w-6" aria-hidden />}
            <button type="button" disabled={!done} onClick={() => onStep(n)} aria-current={n === step ? "step" : undefined} className={clsx("flex items-center gap-1.5", n === step ? "font-semibold text-ink" : done ? "text-ink-2 hover:text-ink" : "text-muted")}>
              <span className={clsx("grid size-6 place-items-center rounded-full text-xs", n === step ? "bg-ink text-white" : done ? "bg-accent-soft text-accent" : "bg-black/5")}>{done ? <IconCheck className="size-3.5" /> : n}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function AiScanning({ cover, lines, slow, onManual }: { cover?: string; lines: string[]; slow: boolean; onManual: () => void }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <div className="relative w-48 overflow-hidden rounded-2xl bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cover && <img src={cover} alt="" className="size-full object-cover" />}
        <span className="absolute inset-x-0 h-12 animate-[scan_1.5s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-ai/30 to-transparent" aria-hidden />
      </div>
      <p className="mt-6 flex items-center gap-2 text-lg font-semibold" role="status">
        <IconSparkle className="size-5 text-ai" filled /> Определяем вещь…
      </p>
      <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {slow && (
        <Button variant="secondary" className="mt-6" onClick={onManual}>
          Заполнить вручную
        </Button>
      )}
      <style>{`@keyframes scan { 0% { top: -15% } 50% { top: 95% } 100% { top: -15% } }`}</style>
    </div>
  );
}

function EditLink({ step, onEdit }: { step: Step; onEdit: (s: Step) => void }) {
  return (
    <button type="button" onClick={() => onEdit(step)} className="text-sm text-ink-2 underline underline-offset-4 hover:text-ink">
      Изменить
    </button>
  );
}

function Preview({ values, photos, meta, onEdit }: { values: ListingValues; photos: PhotoDraft[]; meta: Meta; onEdit: (s: Step) => void }) {
  const category = meta.categories.find((c) => c.slug === values.category);
  const color = meta.colors.find((c) => c.value === values.color);
  const cover = photos.find((p) => p.status === "done");
  return (
    <div className="grid gap-8 md:grid-cols-[2fr_3fr]">
      <div>
        <div className="overflow-hidden rounded-3xl bg-skeleton" style={{ aspectRatio: cover?.width ? `${cover.width} / ${cover.height}` : "4 / 5" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover && <img src={cover.preview} alt="" className="size-full object-cover" />}
        </div>
        <div className="mt-2 flex items-center justify-between text-sm text-muted">
          {photos.filter((p) => p.status === "done").length} фото <EditLink step={1} onEdit={onEdit} />
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold">{values.title}</h2>
          <EditLink step={2} onEdit={onEdit} />
        </div>
        <div className="flex items-center justify-between">
          <p className="tabular text-3xl font-semibold">
            {values.saleType === "AUCTION" && <span className="mr-2 text-base font-normal text-muted">Аукцион · старт</span>}
            {formatPrice(Number(values.price))}
            {values.saleType === "AUCTION" && <span className="ml-2 text-base font-normal text-muted">· {values.auctionHours === 24 ? "1 день" : values.auctionHours === 72 ? "3 дня" : "7 дней"}</span>}
          </p>
          <EditLink step={3} onEdit={onEdit} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
          {(
            [
              ["Размер", values.sizeValue],
              ["Бренд", values.brand],
              ["Состояние", values.condition && CONDITION_LABEL[values.condition]],
              ["Цвет", color?.label],
              ["Материал", values.material],
              ["Категория", category?.subcategories.find((s) => s.slug === values.subcategory)?.label ?? category?.label],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        <p className="flex items-start gap-2">
          <span className={clsx("mt-2 size-2 shrink-0 rounded-full", values.defectsPresent ? "bg-[#d97a00]" : "bg-ok")} />
          {values.defectsPresent ? `Есть дефекты: ${values.defectsDescription}` : "Нет дефектов"}
        </p>
        {values.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{values.description}</p>}
        <p className="text-sm text-muted">{[values.city, values.deliveryOptions.map((d) => DELIVERY_LABEL[d]).join(", ")].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );
}

function Sell({ me }: { me: Me }) {
  const meta = useMeta();
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>(1);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [values, setValues] = useState<ListingValues>(() => emptyValues(me.city));
  const [ai, setAi] = useState<AiState>({});
  const [aiModel, setAiModel] = useState<string>();
  const [aiPhase, setAiPhase] = useState<"idle" | "running" | "done" | "failed" | "disabled">("idle");
  const [aiSlow, setAiSlow] = useState(false);
  const [aiFlags, setAiFlags] = useState<AiSuggestion["flags"] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<ListingDetail | null>(null);
  const autoAdvanced = useRef(false);
  const aiRun = useRef(0);

  const set = useCallback((patch: Partial<ListingValues>) => setValues((v) => ({ ...v, ...patch })), []);
  const uploaded = photos.filter((p) => p.status === "done");
  const uploading = photos.some((p) => p.status === "uploading");

  /** In-flight draft creation, shared so concurrent saves never create two drafts. */
  const creating = useRef<Promise<string> | null>(null);

  /** Draft is created after the first photo and saved after each step (frame 10 DRAFT). */
  const saveDraft = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      const payload = toPayload(values, photos, ai, aiModel);
      try {
        const existing = draftId ?? (creating.current ? await creating.current : null);
        if (existing) {
          await api(`/listings/${existing}`, { method: "PATCH", body: payload });
          return existing;
        }
        creating.current = api<ListingDetail>("/listings", { body: payload }).then((l) => l.id);
        const id = await creating.current;
        setDraftId(id);
        return id;
      } catch (e) {
        creating.current = null;
        if (!opts.quiet) toast(e instanceof ApiError ? e.message : "Не удалось сохранить черновик", { tone: "error" });
        return null;
      }
    },
    [values, photos, ai, aiModel, draftId, toast],
  );

  const runAi = useCallback(async () => {
    const ids = photos.filter((p) => p.status === "done" && p.id).map((p) => p.id!);
    if (!ids.length) return;
    const run = ++aiRun.current;
    setAiPhase("running");
    setAiSlow(false);
    const slowTimer = setTimeout(() => setAiSlow(true), AI_MANUAL_AFTER_MS);
    try {
      const r = await api<{ status: "ok" | "failed" | "disabled"; suggestion?: AiSuggestion }>("/ai/analyze", { body: { photoIds: ids } });
      if (run !== aiRun.current) return; // user chose "Заполнить вручную" meanwhile
      if (r.status === "ok" && r.suggestion) {
        const applied = applySuggestion(values, r.suggestion);
        setValues(applied.values);
        setAi(applied.ai);
        setAiModel(r.suggestion.model);
        setAiFlags(r.suggestion.flags);
        setAiPhase("done");
      } else setAiPhase(r.status === "disabled" ? "disabled" : "failed");
    } catch {
      if (run === aiRun.current) setAiPhase("failed");
    } finally {
      clearTimeout(slowTimer);
    }
  }, [photos, values]);

  // First photo uploaded → create draft; auto-advance to step 2 after 1 s if the user is idle.
  useEffect(() => {
    if (step !== 1 || !uploaded.length || autoAdvanced.current) return;
    const t = setTimeout(() => {
      if (!draftId && !creating.current) void saveDraft({ quiet: true });
      if (uploading) return;
      autoAdvanced.current = true;
      setStep(2);
      void runAi();
    }, 1000);
    return () => clearTimeout(t);
  }, [step, uploaded.length, uploading, draftId, saveDraft, runAi]);

  // Leaving with unsaved progress.
  useEffect(() => {
    if (published || !photos.length) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [photos.length, published]);

  const scrollToError = () => requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>("[data-error]"); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
  });

  const next = async () => {
    if (step === 1) {
      if (!uploaded.length) return setErrors({ photos: "Добавьте хотя бы одно фото" });
      autoAdvanced.current = true;
      setStep(2);
      if (aiPhase === "idle") void runAi();
      void saveDraft({ quiet: true });
      return;
    }
    if (step === 2) {
      const e = validate(values, meta, photos, "describe");
      setErrors(e);
      if (Object.keys(e).length) return scrollToError();
      setStep(3);
      void saveDraft({ quiet: true });
      return;
    }
    if (step === 3) {
      const e = validate(values, meta, photos, "price");
      setErrors(e);
      if (Object.keys(e).length) return scrollToError();
      setStep(4);
      void saveDraft({ quiet: true });
    }
  };

  const publish = async () => {
    const e = validate(values, meta, photos, "all");
    if (Object.keys(e).length) {
      setErrors(e);
      setStep(e.price ? 3 : 2);
      return scrollToError();
    }
    setPublishing(true);
    try {
      const id = await saveDraft();
      if (!id) return;
      const l = await api<ListingDetail>(`/listings/${id}/publish`, { method: "POST" });
      setPublished(l);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
        setStep(err.fields.price ? 3 : 2);
      } else toast("Не удалось опубликовать. Черновик сохранён", { tone: "error", action: { label: "Повторить", onClick: () => void publish() } });
    } finally {
      setPublishing(false);
    }
  };

  const exit = async () => {
    if (!photos.length) return router.push("/");
    const choice = window.confirm("Сохранить черновик?\n\nОК — сохранить и выйти, Отмена — остаться");
    if (!choice) return;
    await saveDraft();
    router.push("/wardrobe");
  };

  if (!meta) return <div className="flex justify-center py-24 text-muted"><Spinner /></div>;

  if (published) {
    const cover = published.photos[0];
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        <div className="sheet-up w-40 overflow-hidden rounded-2xl shadow-xl" style={{ aspectRatio: cover ? `${cover.width} / ${cover.height}` : "4 / 5" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover && <img src={cover.urls.m} alt="" className="size-full object-cover" />}
        </div>
        <h1 className="mt-8 text-2xl font-semibold">Вещь опубликована</h1>
        <p className="mt-2 text-ink-2">Она уже в каталоге, в вашем гардеробе и в «Новинках».</p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <ButtonLink href={`/item/${published.id}`} size="lg" block>
            Посмотреть вещь
          </ButtonLink>
          <Button variant="secondary" block onClick={() => window.location.reload()}>
            Добавить ещё
          </Button>
          <Link href="/wardrobe" className="py-2 text-sm font-medium text-ink-2 hover:text-ink">
            Открыть гардероб
          </Link>
        </div>
      </div>
    );
  }

  const fieldProps = { values, set, ai, setAi, errors, meta, photos, setPhotos, mode: "create" as const };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-4 md:pb-16 md:pt-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <button onClick={exit} aria-label="Выйти" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-black/5">
          <IconX />
        </button>
        <StepIndicator step={step} onStep={setStep} />
        <span className="w-10" />
      </div>

      {step === 1 && (
        <section>
          <h1 className="mb-6 text-3xl font-semibold tracking-tight">Что продаём?</h1>
          <PhotoManager photos={photos} onChange={setPhotos} big error={errors.photos} />
        </section>
      )}

      {step === 2 && (
        <section>
          {aiPhase === "running" ? (
            <AiScanning
              cover={uploaded[0]?.preview}
              lines={["Категория…", "Цвет…", "Бренд…"]}
              slow={aiSlow}
              onManual={() => {
                aiRun.current++;
                setAiPhase("failed");
              }}
            />
          ) : (
            <div className="grid gap-8 md:grid-cols-[200px_1fr]">
              <div className="md:sticky md:top-24 md:self-start">
                <PhotoManager photos={photos} onChange={setPhotos} error={errors.photos} />
              </div>
              <div className="flex flex-col gap-7">
                <h1 className="text-2xl font-semibold tracking-tight">Проверьте описание</h1>
                {aiPhase === "done" && (
                  <p className="flex items-start gap-2 rounded-xl bg-ai-soft px-4 py-3 text-sm text-ai">
                    <IconSparkle className="mt-0.5 size-4 shrink-0" filled />
                    AI заполнил часть полей по фото. Размер, состояние и дефекты укажите сами — их по фото не определить.
                  </p>
                )}
                {aiPhase === "failed" && <p className="rounded-xl bg-black/5 px-4 py-3 text-sm text-ink-2">Не получилось определить вещь автоматически. Заполните поля сами — это займёт минуту.</p>}
                {aiFlags?.not_clothing && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">На фото не видно вещи. Можно заменить фото или продолжить вручную.</p>}
                <CoreFields {...fieldProps} />
                <MoreFields {...fieldProps} />
              </div>
            </div>
          )}
        </section>
      )}

      {step === 3 && (
        <section>
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">Цена и формат продажи</h1>
          <PriceFields values={values} set={set} errors={errors} />
        </section>
      )}

      {step === 4 && (
        <section>
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">Так покупатели увидят вещь</h1>
          <Preview values={values} photos={photos} meta={meta} onEdit={setStep} />
        </section>
      )}

      {!(step === 2 && aiPhase === "running") && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:mt-10 md:justify-end md:border-0 md:bg-transparent md:p-0">
          {step > 1 && (
            <Button variant="secondary" onClick={() => setStep((s) => (s - 1) as Step)}>
              Назад
            </Button>
          )}
          {step === 4 ? (
            <>
              <Button variant="ghost" onClick={async () => (await saveDraft()) && (toast("Черновик сохранён"), router.push("/wardrobe"))}>
                Сохранить черновик
              </Button>
              <Button size="lg" className="flex-1 md:flex-none md:px-10" loading={publishing} onClick={publish}>
                {publishing ? "Публикуем…" : "Опубликовать"}
              </Button>
            </>
          ) : (
            <Button size="lg" className="flex-1 md:flex-none md:px-10" disabled={step === 1 && (!uploaded.length || uploading)} onClick={next}>
              Далее
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
