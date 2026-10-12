"use client";

import clsx from "clsx";
import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { uploadPhoto } from "@/lib/upload";
import type { PhotoDraft } from "@/lib/listing-form";
import type { VideoView } from "@/lib/types";
import { uploadVideo, VIDEO_ACCEPT } from "@/lib/video";
import { PhotoEditor } from "./photo-editor";
import { Furoshiki } from "./shop/furoshiki";
import { IconCamera, IconChevronLeft, IconChevronRight, IconPlus, IconX, Spinner } from "./ui";

const MAX_PHOTOS = 10;
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

let seq = 0;

/**
 * Upload zone + thumbnails with progress, remove and reorder; first photo is the cover (frame 10 STEP 1).
 * With `onVideo`, the same «+» tile also takes the listing's one short video, shown as the last tile.
 */
export function PhotoManager({
  photos,
  onChange,
  big,
  error,
  video,
  onVideo,
}: {
  photos: PhotoDraft[];
  onChange: (update: (prev: PhotoDraft[]) => PhotoDraft[]) => void;
  big?: boolean;
  error?: string;
  video?: VideoView | null;
  onVideo?: (v: VideoView | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PhotoDraft | null>(null);
  const takesVideo = !!onVideo && !video && !videoBusy;

  const addVideo = (file: File) => {
    setVideoError(null);
    setVideoBusy(true);
    uploadVideo(file)
      .then((v) => onVideo?.(v))
      .catch((e) => setVideoError(e instanceof Error ? e.message : "Не удалось загрузить видео"))
      .finally(() => setVideoBusy(false));
  };

  /** Uploads a file into the draft `key` (a new tile, or an edited photo replacing its old version in place). */
  const upload = (key: string, file: File) =>
    uploadPhoto(file, (progress) => onChange((prev) => prev.map((p) => (p.key === key && p.status === "uploading" ? { ...p, progress } : p))))
      .then((r) => onChange((prev) => prev.map((p) => (p.key === key ? { ...p, id: r.id, status: "done", progress: undefined, width: r.width, height: r.height } : p))))
      .catch((e) =>
        onChange((prev) =>
          prev.map((p) => (p.key === key ? { ...p, status: "error", error: e instanceof ApiError ? (e.code === "TOO_SMALL" ? "Фото слишком маленькое" : e.message) : "Не загрузилось" } : p)),
        ),
      );

  const replace = (old: PhotoDraft, file: File) => {
    const key = `p${++seq}`;
    const preview = URL.createObjectURL(file);
    onChange((prev) => prev.map((p) => (p.key === old.key ? { key, preview, original: preview, status: "uploading", isDefect: p.isDefect } : p)));
    void upload(key, file);
  };

  const add = (files: FileList | File[]) => {
    const all = Array.from(files);
    const clip = all.find((f) => f.type.startsWith("video/"));
    if (clip && takesVideo) addVideo(clip);
    const room = MAX_PHOTOS - photos.length;
    const list = all.filter((f) => !f.type.startsWith("video/")).slice(0, Math.max(0, room));
    for (const file of list) {
      const key = `p${++seq}`;
      const preview = URL.createObjectURL(file);
      if (file.size > MAX_BYTES) {
        onChange((prev) => [...prev, { key, preview, status: "error", error: "Больше 15 МБ", isDefect: false }]);
        continue;
      }
      onChange((prev) => [...prev, { key, preview, original: preview, status: "uploading", isDefect: false }]);
      void upload(key, file);
    }
  };

  const move = (key: string, delta: number) =>
    onChange((prev) => {
      const i = prev.findIndex((p) => p.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const moveTo = (key: string, targetKey: string) =>
    onChange((prev) => {
      const from = prev.findIndex((p) => p.key === key);
      const to = prev.findIndex((p) => p.key === targetKey);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  const pickers = (
    <>
      <input ref={input} type="file" accept={takesVideo ? `${ACCEPT},${VIDEO_ACCEPT}` : ACCEPT} multiple hidden onChange={(e) => (e.target.files && add(e.target.files), (e.target.value = ""))} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (e.target.files && add(e.target.files), (e.target.value = ""))} />
    </>
  );

  if (!photos.length && big) {
    return (
      <div>
        {pickers}
        <div
          onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            add(e.dataTransfer.files);
          }}
          className={clsx(
            "rise pattern-asanoha flex min-h-[52vh] flex-col items-center justify-center gap-6 rounded-[28px] border-2 border-dashed p-8 text-center transition-[border-color,background-color,transform] duration-300",
            dragOver ? "scale-[1.01] border-indigo bg-indigo-soft" : error ? "border-danger" : "border-line-strong bg-surface",
          )}
        >
          <Furoshiki className={clsx("h-36 transition-transform duration-500", dragOver ? "-translate-y-2 rotate-[-4deg]" : "sway")} />
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => input.current?.click()} className="btn-wa btn-wa-ink inline-flex h-12 items-center gap-2 px-7 font-semibold">
              <IconPlus className="size-5" /> Добавить фото
            </button>
            <button type="button" onClick={() => camera.current?.click()} className="btn-wa btn-wa-paper inline-flex h-12 items-center gap-2 px-7 font-semibold md:hidden">
              <IconCamera className="size-5" /> Сделать фото
            </button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      {pickers}
      <ul className="flex flex-wrap gap-3">
        {photos.map((p, i) => (
          <li
            key={p.key}
            draggable
            onDragStart={() => setDragKey(p.key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey) moveTo(dragKey, p.key);
              setDragKey(null);
            }}
            className={clsx("pop group relative overflow-hidden rounded-2xl bg-skeleton shadow-[var(--shadow-paper)] transition-transform duration-200 hover:-translate-y-1", big ? "h-[200px] w-40" : "h-[150px] w-[120px]", p.status === "error" && "ring-2 ring-danger", dragKey === p.key && "opacity-50")}
          >
            {p.status === "done" ? (
              // Tapping the photo opens the editor (crop, turn, draw).
              <button type="button" aria-label={`Редактировать фото ${i + 1}`} title="Нажмите, чтобы обрезать, повернуть или нарисовать" onClick={() => setEditing(p)} className="block size-full cursor-pointer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={`Фото ${i + 1}`} className="size-full object-contain" />
                {/* A pencil in the corner says the photo can be edited by tapping it. */}
                <span aria-hidden className="absolute right-1 top-8 grid size-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h4L19 9l-4-4L4 16Z" />
                    <path d="m13.5 6.5 4 4" />
                  </svg>
                </span>
              </button>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.preview} alt={`Фото ${i + 1}`} className="size-full object-contain" />
            )}
            {p.status === "uploading" && (
              <span className="absolute inset-0 grid place-items-center bg-surface/60" aria-label="Загружается">
                <Spinner className="size-6 text-ink" />
                {p.progress != null && (
                  <span className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-ink/10">
                    <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                  </span>
                )}
              </span>
            )}
            {p.status === "error" && <span className="absolute inset-x-0 bottom-0 bg-danger px-1 py-0.5 text-center text-[10px] font-medium text-on-danger">{p.error}</span>}
            {i === 0 && p.status !== "error" && <span className="absolute left-1.5 top-1.5 rounded-md bg-shu px-1.5 py-0.5 text-[10px] font-semibold text-on-shu">Обложка</span>}
            {p.isDefect && i !== 0 && <span className="absolute left-1 top-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">Дефект</span>}
            <button type="button" aria-label="Удалить фото" onClick={() => onChange((prev) => prev.filter((x) => x.key !== p.key))} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white">
              <IconX className="size-3.5" />
            </button>
            <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button type="button" aria-label="Сдвинуть влево" disabled={i === 0} onClick={() => move(p.key, -1)} className="grid size-6 place-items-center rounded-full bg-white/90 disabled:invisible">
                <IconChevronLeft className="size-3.5" />
              </button>
              <button type="button" aria-label="Сдвинуть вправо" disabled={i === photos.length - 1} onClick={() => move(p.key, 1)} className="grid size-6 place-items-center rounded-full bg-white/90 disabled:invisible">
                <IconChevronRight className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
        {video && (
          <li className={clsx("pop group relative overflow-hidden rounded-2xl bg-black shadow-[var(--shadow-paper)]", big ? "h-[200px] w-40" : "h-[150px] w-[120px]")}>
            <video src={video.url} poster={video.poster} muted playsInline preload="metadata" className="size-full object-cover" onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
            <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">▶ {Math.round(video.durationMs / 1000)} с</span>
            <button type="button" aria-label="Убрать видео" onClick={() => onVideo?.(null)} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white">
              <IconX className="size-3.5" />
            </button>
          </li>
        )}
        {videoBusy && (
          <li className={clsx("pop grid place-items-center rounded-2xl bg-skeleton text-xs text-ink-2", big ? "h-[200px] w-40" : "h-[150px] w-[120px]")} aria-label="Загружаем видео">
            <span className="flex flex-col items-center gap-2">
              <Spinner className="size-6" /> видео…
            </span>
          </li>
        )}
        {(photos.length < MAX_PHOTOS || takesVideo) && (
          <li>
            <button type="button" onClick={() => input.current?.click()} className={clsx("flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong text-sm text-ink-2 transition-colors hover:border-indigo hover:text-indigo", big ? "h-[200px] w-40" : "h-[150px] w-[120px]")}>
              <IconPlus /> {takesVideo ? "Фото, видео" : "Фото"}
            </button>
          </li>
        )}
      </ul>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      {videoError && <p className="mt-1 text-sm text-danger">{videoError}</p>}
      {editing && (
        <PhotoEditor
          key={editing.key}
          src={editing.original ?? editing.preview}
          open
          onClose={() => setEditing(null)}
          onSave={(file) => {
            replace(editing, file);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
