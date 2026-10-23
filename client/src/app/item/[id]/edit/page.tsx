"use client";

import { TitleWithKanji } from "@/components/sections";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { FormSection } from "@/components/form-section";
import { DetailFields, HandoverFields, ItemFields, LabelFields, PriceFields, SizeConditionFields } from "@/components/listing-fields";
import { PhotoManager } from "@/components/photo-manager";
import { SchedulePicker, scheduleLabel } from "@/components/schedule-picker";
import { usePriceSuggestion } from "@/components/ai-hints";
import { RequireAuth } from "@/components/require-auth";
import { useMeta, useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, ButtonLink, EmptyState, ErrorState, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { type AiState, type ListingValues, type PhotoDraft, photosFromListing, toPayload, validate, valuesFromListing } from "@/lib/listing-form";
import { useListingActions } from "@/lib/listing-actions";
import type { ListingDetail, ListingResponse } from "@/lib/types";

export default function EditPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth reason="чтобы редактировать вещь">{() => <Loader id={id} />}</RequireAuth>;
}

function Loader({ id }: { id: string }) {
  const { data, error, mutate } = useSWR<ListingResponse>(`/listings/${encodeURIComponent(id)}`, { revalidateOnFocus: false });
  const meta = useMeta();
  if (error) return <ErrorState message="Не удалось загрузить вещь" onRetry={() => mutate()} />;
  if (!data || !meta) return <div className="flex justify-center py-24 text-muted"><Spinner /></div>;
  if ("unavailable" in data || !data.isOwner) {
    return (
      <EmptyState title="Нет доступа" hint="Редактировать вещь может только её владелец">
        <ButtonLink href={`/item/${id}`}>Открыть вещь</ButtonLink>
      </EmptyState>
    );
  }
  if (data.status === "DRAFT") return <DraftRedirect id={data.id} />;
  return <Editor listing={data} onSaved={() => mutate()} />;
}

/** Drafts are finished in /sell, the same flow they were started in. */
function DraftRedirect({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => router.replace(`/sell?draft=${id}`), [id, router]);
  return <div className="flex justify-center py-24 text-muted"><Spinner /></div>;
}

function Editor({ listing, onSaved }: { listing: ListingDetail; onSaved: () => void }) {
  const { me } = useSession();
  const meta = useMeta()!;
  const router = useRouter();
  const toast = useToast();
  const initial = useMemo(() => ({ values: valuesFromListing(listing), photos: photosFromListing(listing) }), [listing]);
  const [values, setValues] = useState<ListingValues>(initial.values);
  const [photos, setPhotos] = useState<PhotoDraft[]>(initial.photos);
  const [ai, setAi] = useState<AiState>((listing.owner?.aiAttributes ?? {}) as AiState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const actions = useListingActions(onSaved);
  const locked = listing.status === "RESERVED";
  const draft = listing.status === "DRAFT";
  const [scheduledAt, setScheduledAt] = useState(listing.owner?.scheduledAt ?? null);

  const dirty = JSON.stringify(values) !== JSON.stringify(initial.values) || JSON.stringify(photos.map((p) => [p.id, p.isDefect])) !== JSON.stringify(initial.photos.map((p) => [p.id, p.isDefect]));

  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  const save = async (andPublish = false) => {
    const e = validate(values, meta, photos, "all");
    if (Object.keys(e).length && (andPublish || !draft)) {
      setErrors(e);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>("[data-error]"); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
      });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const payload = toPayload(values, photos, {}, undefined);
      // AI provenance is kept as stored; only the "edited" flags change.
      await api(`/listings/${listing.id}`, { method: "PATCH", body: { ...payload, aiAttributes: Object.keys(ai).length ? ai : undefined } });
      if (andPublish) await api(`/listings/${listing.id}/publish`, { method: "POST" });
      onSaved();
      toast(andPublish ? "Вещь опубликована" : "Изменения сохранены");
      router.push(`/item/${listing.id}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      const existing = err instanceof ApiError && err.code === "DUPLICATE" && typeof err.data.duplicateOf === "string" ? err.data.duplicateOf : null;
      toast(err instanceof ApiError ? err.message : "Не удалось сохранить · Повторите", {
        tone: "error",
        ...(existing ? { action: { label: "Открыть", onClick: () => router.push(`/item/${existing}`) } } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<ListingValues>) => setValues((v) => ({ ...v, ...patch }));

  // Drafts autosave quietly, like on /sell; live listings keep the explicit "Сохранить".
  const lastAutosave = useRef("");
  useEffect(() => {
    if (!draft || !dirty || saving || photos.some((p) => p.status === "uploading")) return;
    const payload = { ...toPayload(values, photos, {}, undefined), aiAttributes: Object.keys(ai).length ? ai : undefined };
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastAutosave.current) return;
    const t = setTimeout(() => {
      lastAutosave.current = snapshot;
      api(`/listings/${listing.id}`, { method: "PATCH", body: payload }).catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [draft, dirty, saving, values, photos, ai, listing.id]);

  const schedule = async (at: Date) => {
    const e = validate(values, meta, photos, "all");
    if (Object.keys(e).length) return setErrors(e);
    setSaving(true);
    try {
      await api(`/listings/${listing.id}`, { method: "PATCH", body: { ...toPayload(values, photos, {}, undefined), aiAttributes: Object.keys(ai).length ? ai : undefined } });
      await api(`/listings/${listing.id}/schedule`, { body: { at: at.toISOString() } });
      setScheduledAt(at.toISOString());
      onSaved();
      toast(`Опубликуем ${scheduleLabel(at.toISOString())}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      toast(err instanceof ApiError ? err.message : "Не удалось запланировать", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const unschedule = async () => {
    await api(`/listings/${listing.id}/schedule`, { method: "DELETE" }).catch(() => {});
    setScheduledAt(null);
    onSaved();
  };
  const market = usePriceSuggestion(values, photos, listing.id, !locked && listing.auction?.status !== "ACTIVE");
  const fieldProps = { values, set, ai, setAi: setAi, errors, meta, photos, setPhotos, locked, mode: "edit" as const };

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-32 pt-4 md:px-6 md:pb-16 md:pt-8">
      <Link href={`/item/${listing.id}`} className="text-sm text-ink-2 hover:text-ink">
        ← К вещи
      </Link>
      <TitleWithKanji kanji="編集" className="mt-3">
        <h1 className="rise text-3xl font-bold tracking-tight md:text-4xl">{draft ? "Черновик" : "Редактировать вещь"}</h1>
      </TitleWithKanji>
      {locked && <p className="rise mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">Идёт сделка — цену, размер, состояние и дефекты менять нельзя.</p>}
      {draft && scheduledAt && (
        <p className="rise mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          Опубликуется {scheduleLabel(scheduledAt)}.
          <button type="button" onClick={unschedule} className="font-medium underline underline-offset-4">
            Отменить
          </button>
        </p>
      )}

      <div className="mt-8 flex flex-col gap-10">
        <FormSection kanji="写" title="Фото и видео" index={0}>
          <PhotoManager photos={photos} onChange={setPhotos} error={errors.photos} big video={values.video} onVideo={(video) => set({ video })} />
        </FormSection>
        <FormSection kanji="品" title="Что за вещь" index={1}>
          <ItemFields {...fieldProps} />
        </FormSection>
        <FormSection kanji="寸" title="Размер и состояние" index={2}>
          <SizeConditionFields {...fieldProps} />
        </FormSection>
        <FormSection kanji="値" title="Цена" index={3}>
          <PriceFields values={values} set={set} errors={errors} locked={locked} auctionLocked={listing.auction?.status === "ACTIVE"} market={market} />
        </FormSection>
        {me?.isBrand && (
          <FormSection kanji="判" title="Печати" index={4}>
            <LabelFields values={values} set={set} />
          </FormSection>
        )}
        <FormSection kanji="詳" title="Детали" index={4}>
          <DetailFields {...fieldProps} />
        </FormSection>
        <FormSection kanji="渡" title="Передача" index={5}>
          <HandoverFields {...fieldProps} />
        </FormSection>
        {!draft && (
          <div className="flex flex-wrap gap-3 pt-2">
            {listing.status === "PUBLISHED" && (
              <Button variant="secondary" onClick={() => actions.hide(listing.id)}>
                Снять с продажи
              </Button>
            )}
            {listing.status === "HIDDEN" && (
              <Button variant="secondary" onClick={() => actions.unhide(listing.id)}>
                Вернуть в продажу
              </Button>
            )}
            {!locked && listing.status !== "SOLD" && (
              <Button variant="secondary" onClick={() => actions.markSold(listing.id)}>
                Пометить как проданное
              </Button>
            )}
            {!locked && (
              <button className="ml-auto text-sm text-danger hover:underline" onClick={async () => (await actions.remove(listing.id)) && router.push("/wardrobe")}>
                Удалить
              </button>
            )}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 flex gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:sticky md:bottom-4 md:mt-10 md:justify-end md:rounded-2xl md:border md:shadow-lg">
        {draft ? (
          <>
            <Button variant="secondary" loading={saving} disabled={!dirty} onClick={() => save(false)}>
              Сохранить
            </Button>
            {!scheduledAt && <SchedulePicker disabled={saving} onSchedule={schedule} />}
            <Button className="flex-1 md:flex-none md:px-10" loading={saving} onClick={() => save(true)}>
              Опубликовать
            </Button>
          </>
        ) : (
          <Button className="flex-1 md:flex-none md:px-10" size="lg" loading={saving} disabled={!dirty || photos.some((p) => p.status === "uploading")} onClick={() => save(false)}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
        )}
      </div>
    </div>
  );
}
