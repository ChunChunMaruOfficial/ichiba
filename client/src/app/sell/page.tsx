"use client";

import { TitleWithKanji } from "@/components/sections";
import { useDialog } from "@/components/dialog";
import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { FormSection } from "@/components/form-section";
import { DetailFields, HandoverFields, ItemFields, LabelFields, PriceFields, SizeConditionFields } from "@/components/listing-fields";
import { PhotoManager } from "@/components/photo-manager";
import { SchedulePicker, scheduleLabel } from "@/components/schedule-picker";
import { usePriceSuggestion } from "@/components/ai-hints";
import { RequireAuth } from "@/components/require-auth";
import { useMeta, useSession } from "@/components/session";
import { IconTrash } from "@/components/chat/icons";
import { useToast } from "@/components/toast";
import { Button, ButtonLink, Hanko, IconCheck, IconChevronLeft, IconSparkle, IconX, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { type AiState, applySuggestionToEmpty, emptyValues, type ListingValues, type PhotoDraft, photosFromListing, toPayload, validate, valuesFromListing } from "@/lib/listing-form";
import type { AiSuggestion, Card, ListingDetail, ListingResponse, Me } from "@/lib/types";

type Step = 1 | 2 | 3;
/** Numbered steps after the photo screen (step 1 is the upload itself and has no number). */
const STEPS = ["Информация", "Цена"];

export default function SellPage() {
  const { me } = useSession();
  return (
    <RequireAuth reason="чтобы выставить вещь на продажу">
      {(me) => (
        <Suspense>
          <DraftLoader me={me} />
        </Suspense>
      )}
    </RequireAuth>
  );
}

/** "?draft=<id>" continues an unfinished listing in this same flow, with everything filled in so far. */
function DraftLoader({ me }: { me: Me }) {
  const params = useSearchParams();
  const draftParam = params.get("draft");
  const { data, error } = useSWR<ListingResponse>(draftParam ? `/listings/${encodeURIComponent(draftParam)}` : null, { revalidateOnFocus: false });
  if (draftParam && !data && !error) return <div className="flex justify-center py-24 text-muted"><Spinner /></div>;
  const own = data && !("unavailable" in data) && data.isOwner ? data : null;
  const draft = own?.status === "DRAFT" ? own : null;
  // "?new=…" remounts the form for "Добавить ещё" without a full reload.
  return <Sell key={draft?.id ?? params.get("new") ?? "new"} me={me} draft={draft} />;
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

/** Under the photos while the AI reads them; the fields stay open and editable meanwhile. */
function AiStatus() {
  return (
    <p className="mt-3 flex items-center gap-2 text-sm font-medium text-ai" role="status">
      <IconSparkle className="size-4 animate-pulse" filled /> Определяем вещь по фото — поля заполнятся сами
    </p>
  );
}

function Sell({ me, draft }: { me: Me; draft: ListingDetail | null }) {
  const meta = useMeta();
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useDialog();
  // A continued draft starts on the description step with its photos and fields in place.
  const [step, setStep] = useState<Step>(draft ? 2 : 1);
  const [photos, setPhotos] = useState<PhotoDraft[]>(() => (draft ? photosFromListing(draft) : []));
  const [values, setValues] = useState<ListingValues>(() => (draft ? valuesFromListing(draft) : emptyValues(me.city)));
  const [ai, setAi] = useState<AiState>(() => ((draft?.owner?.aiAttributes ?? {}) as AiState));
  const [aiModel, setAiModel] = useState<string>();
  const [aiPhase, setAiPhase] = useState<"idle" | "running" | "done" | "failed" | "disabled">(draft ? "disabled" : "idle");
  const [aiFlags, setAiFlags] = useState<AiSuggestion["flags"] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<ListingDetail | null>(null);
  const [scheduled, setScheduled] = useState<string | null>(null);
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
    try {
      const r = await api<{ status: "ok" | "failed" | "disabled"; suggestion?: AiSuggestion }>("/ai/analyze", { body: { photoIds: ids } });
      if (run !== aiRun.current) return;
      if (r.status === "ok" && r.suggestion) {
        const s = r.suggestion;
        // Fields typed while the photo was being read stay as the seller left them.
        let filled: AiState = {};
        setValues((cur) => {
          const applied = applySuggestionToEmpty(cur, s);
          filled = applied.ai;
          return applied.values;
        });
        setAi((cur) => ({ ...cur, ...filled }));
        setAiModel(s.model);
        setAiFlags(r.suggestion.flags);
        setAiPhase("done");
      } else setAiPhase(r.status === "disabled" ? "disabled" : "failed");
    } catch {
      if (run === aiRun.current) setAiPhase("failed");
    }
  }, [photos]);

  // Picking a photo opens the form at once with empty fields; photos keep uploading in the background.
  useEffect(() => {
    if (step !== 1 || !photos.length || autoAdvanced.current) return;
    autoAdvanced.current = true;
    setStep(2);
  }, [step, photos.length]);

  // As soon as the first photo is uploaded the draft is created and the AI reads the photo to fill the fields.
  useEffect(() => {
    if (aiPhase !== "idle" || !uploaded.length) return;
    if (!draftId && !creating.current) void saveDraft({ quiet: true });
    const t = setTimeout(() => void runAi(), 0);
    return () => clearTimeout(t);
  }, [aiPhase, uploaded.length, draftId, saveDraft, runAi]);

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

  /** Moving between steps starts the new one from the top (the price tag is the first thing on step 3). */
  const goTo = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const next = async () => {
    if (step === 2) {
      const e = validate(values, meta, photos, "describe");
      setErrors(e);
      if (Object.keys(e).length) return scrollToError();
      goTo(3);
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

  /** Trash in the top bar: the draft (photos and fields) is deleted, not kept in the wardrobe. */
  const discard = async () => {
    if (!(await confirm({ title: "Удалить черновик?", message: "Фото и заполненные поля пропадут.", confirmLabel: "Удалить", danger: true }))) return;
    const id = draftId ?? (creating.current ? await creating.current : null);
    if (id) await api(`/listings/${id}`, { method: "DELETE" }).catch(() => undefined);
    toast("Черновик удалён");
    router.push("/");
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
        <StepIndicator step={step} onStep={goTo} />
        {photos.length > 0 || draftId ? (
          <button type="button" onClick={discard} aria-label="Удалить черновик" title="Удалить черновик" className="-mr-2 grid size-10 place-items-center rounded-full text-ink-2 hover:bg-danger-soft hover:text-danger">
            <IconTrash className="size-5" />
          </button>
        ) : (
          <span className="w-10" />
        )}
      </div>

      {step === 1 && (
        <section key="s1">
          <TitleWithKanji kanji="出品" className="mb-6">
            <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">Что продаём?</h1>
          </TitleWithKanji>
          {!photos.length && <DraftReminder me={me} />}
          <PhotoManager photos={photos} onChange={setPhotos} big error={errors.photos} />
        </section>
      )}

      {step === 2 && (
        <div key="s2">
          <div className="flex flex-col gap-8 md:gap-10">
            {aiFlags?.not_clothing && <p className="rise rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">На фото не видно вещи — можно заменить фото или продолжить вручную.</p>}
            <FormSection kanji="写" title="Фото и видео" index={0}>
              <PhotoManager photos={photos} onChange={setPhotos} error={errors.photos} big video={values.video} onVideo={(video) => set({ video })} />
              {(aiPhase === "running" || (aiPhase === "idle" && photos.length > 0)) && <AiStatus />}
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
        </div>
      )}

      {step === 3 && (
        <div key="s3" className="flex flex-col gap-8 md:gap-10">
          <FormSection kanji="値" title="Цена и формат продажи" index={0}>
            <PriceFields values={values} set={set} errors={errors} market={market} />
          </FormSection>
          {me?.isBrand && (
            <FormSection kanji="判" title="Печати" index={1}>
              <LabelFields values={values} set={set} />
            </FormSection>
          )}
        </div>
      )}


      {/* No bar on the photo screen: the first photo moves on by itself. */}
      {step !== 1 && (
        <div className="sheet-up fixed inset-x-0 bottom-0 z-40 flex gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:mt-10 md:justify-end md:border-0 md:bg-transparent md:p-0">
          {/* Desktop: equal buttons of one width. Phone: "Назад" and "Запланировать" shrink to icons so the main action fits. */}
          {step > 2 && (
            <Button variant="secondary" size="lgTight" aria-label="Назад" className="w-13 shrink-0 md:w-48" onClick={() => goTo((step - 1) as Step)}>
              <IconChevronLeft className="size-6 shrink-0 md:hidden" />
              <span className="hidden md:inline">Назад</span>
            </Button>
          )}
          {step === 3 ? (
            <>
              <SchedulePicker disabled={publishing} onSchedule={schedule} className="w-13 shrink-0 md:w-48" buttonClassName="w-full" compact />
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
