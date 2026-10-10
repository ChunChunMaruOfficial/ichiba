"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { FormSection } from "@/components/form-section";
import { DetailFields, HandoverFields, ItemFields, PriceFields, SizeConditionFields } from "@/components/listing-fields";
import { PhotoManager } from "@/components/photo-manager";
import { SchedulePicker, scheduleLabel } from "@/components/schedule-picker";
import { usePriceSuggestion } from "@/components/ai-hints";
import { RequireAuth } from "@/components/require-auth";
import { useMeta } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, ButtonLink, Hanko, IconCheck, IconChevronLeft, IconSparkle, IconX, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { type AiState, applySuggestion, emptyValues, type ListingValues, type PhotoDraft, photosFromListing, similarValues, toPayload, validate, valuesFromListing } from "@/lib/listing-form";
import type { AiSuggestion, Card, ListingDetail, ListingResponse, Me } from "@/lib/types";

type Step = 1 | 2 | 3;
/** Numbered steps after the photo screen (step 1 is the upload itself and has no number). */
const STEPS = ["Информация", "Цена"];
const AI_MANUAL_AFTER_MS = 10_000;

export default function SellPage() {
  return (
    <RequireAuth reason="чтобы выставить вещь">
      {(me) => (
        <Suspense>
          <SimilarLoader me={me} />
        </Suspense>
      )}
    </RequireAuth>
  );
}

/** "/sell?similar=<id>": starts from one of the seller's listings ("Выставить похожую", eBay "Sell similar"). */
/** "?draft=<id>" continues an unfinished listing in this same flow, with everything filled in so far. */
function SimilarLoader({ me }: { me: Me }) {
  const params = useSearchParams();
  const similar = params.get("similar");
  const draftParam = params.get("draft");
  const ref = draftParam ?? similar;
  const { data, error } = useSWR<ListingResponse>(ref ? `/listings/${ref}` : null, { revalidateOnFocus: false });
  if (ref && !data && !error) return <div className="flex justify-center py-24 text-muted"><Spinner /></div>;
  const own = data && !("unavailable" in data) && data.isOwner ? data : null;
  const draft = draftParam && own?.status === "DRAFT" ? own : null;
  const source = !draftParam ? own : null;
  // "?new=…" remounts the form for "Добавить ещё" without a full reload.
  return <Sell key={draft?.id ?? source?.id ?? params.get("new") ?? "new"} me={me} source={source} draft={draft} />;
}

/** Shown on an empty /sell when an unfinished draft exists, so work isn't lost or duplicated. */
function DraftReminder({ me }: { me: Me }) {
  const { data } = useSWR<{ drafts: Card[] }>(`/wardrobes/${me.username}`, { revalidateOnFocus: false });
  const draft = data?.drafts.find((d) => !d.scheduledAt);
  if (!draft) return null;
  return (
    <Link href={`/sell?draft=${draft.id}`} className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:border-ink">
      <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-skeleton">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {draft.cover && <img src={draft.cover.urls.s} alt="" className="size-full object-contain" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-muted">Незаконченный черновик</span>
        <span className="block truncate font-medium">{draft.title || "Без названия"}</span>
      </span>
      <span className="shrink-0 text-sm font-medium">Продолжить →</span>
    </Link>
  );
}

const STEP_KANJI = ["一", "二"];

/** Steps as round seals with brush numerals; the current one is stamped in cinnabar, done ones carry a tick. */
function StepIndicator({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Шаги">
      {STEPS.map((label, i) => {
        const n = (i + 2) as Step;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && (
              <span className="relative h-0.5 w-5 overflow-hidden rounded-full bg-line-strong sm:w-10" aria-hidden>
                <span className={clsx("absolute inset-y-0 left-0 bg-shu transition-[width] duration-500 ease-out", n <= step ? "w-full" : "w-0")} />
              </span>
            )}
            <button type="button" disabled={!done} onClick={() => onStep(n)} aria-current={current ? "step" : undefined} className={clsx("flex items-center gap-2", current ? "font-semibold text-ink" : done ? "text-ink-2 hover:text-ink" : "text-muted")}>
              <span
                key={current ? `on-${n}` : n}
                className={clsx(
                  "grid size-8 place-items-center rounded-full font-brush text-[15px] leading-none transition-colors",
                  current ? "stamp bg-shu text-on-shu shadow-[0_0_0_3px_var(--paper),0_0_0_4px_var(--shu)]" : done ? "bg-indigo text-[#f4efe6]" : "border border-line-strong text-muted",
                )}
              >
                {done ? <IconCheck className="size-4" /> : STEP_KANJI[i]}
              </span>
              <span className="hidden md:inline">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function AiScanning({ cover, slow, onManual }: { cover?: string; slow: boolean; onManual: () => void }) {
  return (
    <div className="rise flex flex-col items-center py-16 text-center">
      <div className="relative w-56 overflow-hidden rounded-3xl bg-skeleton shadow-[var(--shadow-float)]" style={{ aspectRatio: "4 / 5" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cover && <img src={cover} alt="" className="size-full object-contain" />}
        <span className="absolute inset-x-0 h-12 animate-[scan_1.5s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-ai/30 to-transparent" aria-hidden />
      </div>
      <p className="mt-6 flex items-center gap-2 text-lg font-semibold" role="status">
        <IconSparkle className="size-5 text-ai" filled /> Определяем вещь…
      </p>
      {slow && (
        <Button variant="secondary" className="mt-6" onClick={onManual}>
          Заполнить вручную
        </Button>
      )}
      <style>{`@keyframes scan { 0% { top: -15% } 50% { top: 95% } 100% { top: -15% } }`}</style>
    </div>
  );
}

function Sell({ me, source, draft }: { me: Me; source: ListingDetail | null; draft: ListingDetail | null }) {
  const meta = useMeta();
  const router = useRouter();
  const toast = useToast();
  // A continued draft starts on the description step with its photos and fields in place.
  const [step, setStep] = useState<Step>(draft ? 2 : 1);
  const [photos, setPhotos] = useState<PhotoDraft[]>(() => (draft ? photosFromListing(draft) : []));
  const [values, setValues] = useState<ListingValues>(() => (draft ? valuesFromListing(draft) : source ? similarValues(source) : emptyValues(me.city)));
  const [ai, setAi] = useState<AiState>(() => ((draft?.owner?.aiAttributes ?? {}) as AiState));
  const [aiModel, setAiModel] = useState<string>();
  // A "similar" listing already has its description: AI autofill would overwrite it.
  const [aiPhase, setAiPhase] = useState<"idle" | "running" | "done" | "failed" | "disabled">(source || draft ? "disabled" : "idle");
  const [aiSlow, setAiSlow] = useState(false);
  const [aiFlags, setAiFlags] = useState<AiSuggestion["flags"] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<ListingDetail | null>(null);
  const [scheduled, setScheduled] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const autoAdvanced = useRef(!!draft);
  const aiRun = useRef(0);

  const set = useCallback((patch: Partial<ListingValues>) => setValues((v) => ({ ...v, ...patch })), []);
  const market = usePriceSuggestion(values, photos, draftId, step >= 3);
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
          setSavedAt(new Date());
          return existing;
        }
        creating.current = api<ListingDetail>("/listings", { body: payload }).then((l) => l.id);
        const id = await creating.current;
        setDraftId(id);
        setSavedAt(new Date());
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

  // The first uploaded photo starts everything at once: the draft is created and AI analyses the photo while the
  // form opens (other photos keep uploading in the background).
  useEffect(() => {
    if (step !== 1 || !uploaded.length || autoAdvanced.current) return;
    autoAdvanced.current = true;
    if (!draftId && !creating.current) void saveDraft({ quiet: true });
    setStep(2);
    void runAi();
  }, [step, uploaded.length, draftId, saveDraft, runAi]);

  // Leaving with unsaved progress.
  useEffect(() => {
    if (published || !photos.length) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [photos.length, published]);

  // Autosave: once the draft exists, every change is saved quietly a moment after typing stops.
  const lastSaved = useRef("");
  useEffect(() => {
    if (!draftId || published || scheduled || uploading) return;
    const snapshot = JSON.stringify(toPayload(values, photos, ai, aiModel));
    if (snapshot === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = snapshot;
      void saveDraft({ quiet: true });
    }, 2500);
    return () => clearTimeout(t);
  }, [draftId, published, scheduled, uploading, values, photos, ai, aiModel, saveDraft]);

  const scrollToError = () => requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>("[data-error]"); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
  });

  const next = async () => {
    if (step === 2) {
      const e = validate(values, meta, photos, "describe");
      setErrors(e);
      if (Object.keys(e).length) return scrollToError();
      setStep(3);
      void saveDraft({ quiet: true });
      return;
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
        // Automatic moderation explains what to fix next to the field itself.
        if (err.code === "MODERATION") toast(`${err.message}: исправьте отмеченные поля`, { tone: "error" });
        // One item = one listing: point the seller to the listing they already have.
        if (err.code === "DUPLICATE" && typeof err.data.duplicateOf === "string") {
          const existing = err.data.duplicateOf;
          toast(err.message, { tone: "error", action: { label: "Открыть", onClick: () => router.push(`/item/${existing}`) } });
        }
        scrollToError();
      } else toast("Не удалось опубликовать. Черновик сохранён", { tone: "error", action: { label: "Повторить", onClick: () => void publish() } });
    } finally {
      setPublishing(false);
    }
  };

  const schedule = async (at: Date) => {
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
      await api(`/listings/${id}/schedule`, { body: { at: at.toISOString() } });
      setScheduled(at.toISOString());
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length && !err.fields.scheduledAt) {
        setErrors(err.fields);
        setStep(err.fields.price ? 3 : 2);
        scrollToError();
      }
      toast(err instanceof ApiError ? err.message : "Не удалось запланировать", { tone: "error" });
    } finally {
      setPublishing(false);
    }
  };

  const exit = async () => {
    if (!photos.length) return router.push("/");
    // Progress is autosaved; leaving just flushes the latest changes.
    await saveDraft();
    toast("Черновик сохранён — он в вашем гардеробе");
    router.push("/wardrobe");
  };

  if (!meta) return <div className="flex justify-center py-24 text-muted"><Spinner /></div>;

  if (scheduled) {
    const cover = uploaded[0];
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        <div className="sheet-up w-40 overflow-hidden rounded-2xl shadow-xl" style={{ aspectRatio: cover?.width ? `${cover.width} / ${cover.height}` : "4 / 5" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover && <img src={cover.preview} alt="" className="size-full object-contain" />}
        </div>
        <h1 className="mt-8 text-2xl font-semibold">Публикация запланирована</h1>
        <p className="mt-2 text-ink-2">Вещь появится в каталоге {scheduleLabel(scheduled)}. До этого её видите только вы — в черновиках гардероба.</p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <ButtonLink href="/wardrobe" size="lg" block>
            Открыть гардероб
          </ButtonLink>
          <Button variant="secondary" block onClick={() => router.push(`/sell?new=${Date.now()}`)}>
            Добавить ещё
          </Button>
        </div>
      </div>
    );
  }

  if (published) {
    const cover = published.photos[0];
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        <div className="relative">
          <div className="rise w-48 overflow-hidden rounded-3xl shadow-[var(--shadow-float)]" style={{ aspectRatio: cover ? `${cover.width} / ${cover.height}` : "4 / 5" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {cover && <img src={cover.urls.m} alt="" className="size-full object-contain" />}
          </div>
          <span className="stamp-down absolute -right-6 -top-4 block" style={{ animationDelay: "350ms" }}>
            <Hanko kind="listed" className="scale-125" />
          </span>
        </div>
        <h1 className="mt-8 text-2xl font-semibold">{published.sizes ? `Опубликовано в ${published.sizes.length} размерах` : "Вещь опубликована"}</h1>
        <div className="mt-8 flex w-full flex-col gap-3">
          <ButtonLink href={`/item/${published.id}`} size="lg" block>
            Посмотреть вещь
          </ButtonLink>
          <Button variant="secondary" block onClick={() => router.push(`/sell?new=${Date.now()}`)}>
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
    <div className="mx-auto max-w-[1280px] px-4 pb-32 pt-2 md:px-6 md:pb-16 md:pt-8">
      <div className="mb-3 flex items-center justify-between gap-4 md:mb-8">
        <button onClick={exit} aria-label="Выйти" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-ink/5">
          <IconX />
        </button>
        <StepIndicator step={step} onStep={setStep} />
        <span className="w-10 text-right text-xs text-muted" aria-live="polite" title={savedAt ? `Черновик сохранён в ${savedAt.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}` : undefined}>
          {savedAt && <IconCheck key={savedAt.getTime()} className="pop ml-auto size-4 text-ok" aria-label="Черновик сохранён" />}
        </span>
      </div>

      {step === 1 && (
        <section key="s1">
          <h1 className="rise mb-6 text-3xl font-bold tracking-tight md:text-4xl">{source ? "Похожая вещь: добавьте фото" : "Что продаём?"}</h1>
          {!source && !photos.length && <DraftReminder me={me} />}
          <PhotoManager photos={photos} onChange={setPhotos} big error={errors.photos} />
        </section>
      )}

      {step === 2 && (
        <div key="s2">
          {aiPhase === "running" ? (
            <AiScanning
              cover={uploaded[0]?.preview}
              slow={aiSlow}
              onManual={() => {
                aiRun.current++;
                setAiPhase("failed");
              }}
            />
          ) : (
            <div className="flex flex-col gap-8 md:gap-10">
              {aiFlags?.not_clothing && <p className="rise rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">На фото не видно вещи — можно заменить фото или продолжить вручную.</p>}
              <FormSection kanji="写" title="Фото и видео" index={0}>
                <PhotoManager photos={photos} onChange={setPhotos} error={errors.photos} big video={values.video} onVideo={(video) => set({ video })} />
              </FormSection>
              <FormSection kanji="品" title="Что за вещь" index={1}>
                <ItemFields {...fieldProps} />
              </FormSection>
              <FormSection kanji="寸" title="Размер и состояние" index={2}>
                <SizeConditionFields {...fieldProps} />
              </FormSection>
              <FormSection kanji="詳" title="Детали" index={3}>
                <DetailFields {...fieldProps} />
              </FormSection>
              <FormSection kanji="渡" title="Передача" index={4}>
                <HandoverFields {...fieldProps} />
              </FormSection>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div key="s3" className="flex flex-col gap-8 md:gap-10">
          <FormSection kanji="値" title="Цена и формат продажи" index={0}>
            <PriceFields values={values} set={set} errors={errors} market={market} />
          </FormSection>
        </div>
      )}


      {/* No bar on the photo screen (the first photo moves on by itself) or while AI is reading the photo. */}
      {step !== 1 && !(step === 2 && aiPhase === "running") && (
        <div className="sheet-up fixed inset-x-0 bottom-0 z-40 flex gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:mt-10 md:justify-end md:border-0 md:bg-transparent md:p-0">
          {/* Desktop: equal buttons of one width. Phone: "Назад" and "Запланировать" shrink to icons so the main action fits. */}
          {step > 2 && (
            <Button variant="secondary" size="lg" aria-label="Назад" className="w-13 shrink-0 px-0 md:w-48" onClick={() => setStep((s) => (s - 1) as Step)}>
              <IconChevronLeft className="size-5 md:hidden" />
              <span className="hidden md:inline">Назад</span>
            </Button>
          )}
          {step === 3 ? (
            <>
              <SchedulePicker disabled={publishing} onSchedule={schedule} className="w-13 shrink-0 md:w-48" buttonClassName="w-full px-0" compact />
              <Button size="lg" className="flex-1 md:w-48 md:flex-none" loading={publishing} onClick={publish}>
                {publishing ? "Публикуем…" : "Опубликовать"}
              </Button>
            </>
          ) : (
            <Button size="lg" className="flex-1 md:w-48 md:flex-none" onClick={next}>
              Далее
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
