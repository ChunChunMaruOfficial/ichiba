"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { CoreFields, MoreFields, PriceFields } from "@/components/listing-fields";
import { PhotoManager } from "@/components/photo-manager";
import { SchedulePicker, scheduleLabel } from "@/components/schedule-picker";
import { VideoField } from "@/components/video-field";
import { issuesById, PhotoAdvice, PriceHint, usePhotoCheck } from "@/components/ai-hints";
import { RequireAuth } from "@/components/require-auth";
import { useMeta } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, ButtonLink, EmptyState, ErrorState, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { type AiState, type ListingValues, type PhotoDraft, toPayload, validate, valuesFromListing } from "@/lib/listing-form";
import { useListingActions } from "@/lib/listing-actions";
import type { ListingDetail, ListingResponse } from "@/lib/types";

export default function EditPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth reason="чтобы редактировать вещь">{() => <Loader id={id} />}</RequireAuth>;
}

function Loader({ id }: { id: string }) {
  const { data, error, mutate } = useSWR<ListingResponse>(`/listings/${id}`, { revalidateOnFocus: false });
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
  return <Editor listing={data} onSaved={() => mutate()} />;
}

const photosFrom = (l: ListingDetail): PhotoDraft[] =>
  l.photos.map((p) => ({ key: p.id, id: p.id, preview: p.urls.m, status: "done", isDefect: p.isDefect, width: p.width, height: p.height }));

function Editor({ listing, onSaved }: { listing: ListingDetail; onSaved: () => void }) {
  const meta = useMeta()!;
  const router = useRouter();
  const toast = useToast();
  const initial = useMemo(() => ({ values: valuesFromListing(listing), photos: photosFrom(listing) }), [listing]);
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
      toast(err instanceof ApiError ? err.message : "Не удалось сохранить · Повторите", { tone: "error" });
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
  const photoCheck = usePhotoCheck(photos, values.category);
  const makeCover = (photoId: string) =>
    setPhotos((prev) => {
      const i = prev.findIndex((p) => p.id === photoId);
      return i > 0 ? [prev[i], ...prev.slice(0, i), ...prev.slice(i + 1)] : prev;
    });
  const fieldProps = { values, set, ai, setAi: setAi, errors, meta, photos, setPhotos, locked, mode: "edit" as const, multiSize: draft };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-4 md:pb-16 md:pt-8">
      <Link href={`/item/${listing.id}`} className="text-sm text-ink-2 hover:text-ink">
        ← К вещи
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{draft ? "Черновик" : "Редактировать вещь"}</h1>
      {locked && <p className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">Идёт сделка — цену, размер, состояние и дефекты менять нельзя.</p>}
      {draft && scheduledAt && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          Опубликуется {scheduleLabel(scheduledAt)}. Изменения сохраняются автоматически.
          <button type="button" onClick={unschedule} className="font-medium underline underline-offset-4">
            Отменить
          </button>
        </p>
      )}

      <div className="mt-8 grid gap-10 md:grid-cols-[260px_1fr]">
        <div className="md:sticky md:top-24 md:self-start">
          <p className="mb-3 text-sm font-medium">Фото</p>
          <PhotoManager photos={photos} onChange={setPhotos} error={errors.photos} issues={issuesById(photoCheck.check)} />
          <p className="mt-2 text-xs text-muted">Первое фото — обложка. Перетащите, чтобы поменять порядок.</p>
          <div className="mt-4">
            <PhotoAdvice check={photoCheck.check} loading={photoCheck.loading} photos={photos} onMakeCover={makeCover} />
          </div>
          <div className="mt-4">
            <VideoField value={values.video} onChange={(video) => set({ video })} />
          </div>
        </div>
        <div className="flex flex-col gap-10">
          <CoreFields {...fieldProps} />
          <div className="flex flex-col gap-4">
            {!locked && listing.auction?.status !== "ACTIVE" && <PriceHint values={values} photos={photos} listingId={listing.id} set={set} />}
            <PriceFields values={values} set={set} errors={errors} locked={locked} auctionLocked={listing.auction?.status === "ACTIVE"} />
          </div>
          <MoreFields {...fieldProps} />
          {!draft && (
            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
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
