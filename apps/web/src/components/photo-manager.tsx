"use client";

import clsx from "clsx";
import { useRef, useState } from "react";
import { ApiError, uploadPhoto } from "@/lib/api";
import type { PhotoDraft } from "@/lib/listing-form";
import { IconCamera, IconChevronLeft, IconChevronRight, IconPlus, IconX, Spinner } from "./ui";

const MAX_PHOTOS = 10;
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

let seq = 0;

/** Upload zone + thumbnails with progress, remove and reorder; first photo is the cover (frame 10 STEP 1). */
export function PhotoManager({
  photos,
  onChange,
  big,
  error,
}: {
  photos: PhotoDraft[];
  onChange: (update: (prev: PhotoDraft[]) => PhotoDraft[]) => void;
  big?: boolean;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const add = (files: FileList | File[]) => {
    const room = MAX_PHOTOS - photos.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    for (const file of list) {
      const key = `p${++seq}`;
      const preview = URL.createObjectURL(file);
      if (file.size > MAX_BYTES) {
        onChange((prev) => [...prev, { key, preview, status: "error", error: "Больше 15 МБ", isDefect: false }]);
        continue;
      }
      onChange((prev) => [...prev, { key, preview, status: "uploading", isDefect: false }]);
      uploadPhoto(file)
        .then((r) => onChange((prev) => prev.map((p) => (p.key === key ? { ...p, id: r.id, status: "done", width: r.width, height: r.height } : p))))
        .catch((e) =>
          onChange((prev) =>
            prev.map((p) => (p.key === key ? { ...p, status: "error", error: e instanceof ApiError ? (e.code === "TOO_SMALL" ? "Фото слишком маленькое" : e.message) : "Не загрузилось" } : p)),
          ),
        );
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
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => (e.target.files && add(e.target.files), (e.target.value = ""))} />
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
            "flex min-h-[55vh] flex-col items-center justify-center gap-5 rounded-3xl border-2 border-dashed p-8 text-center transition-colors",
            dragOver ? "border-accent bg-accent-soft" : error ? "border-danger" : "border-line-strong bg-surface",
          )}
        >
          <span className="grid size-16 place-items-center rounded-full bg-paper">
            <IconCamera className="size-8 text-ink-2" />
          </span>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => input.current?.click()} className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 font-semibold text-accent-ink hover:bg-accent-hover">
              <IconPlus className="size-5" /> Добавить фото
            </button>
            <button type="button" onClick={() => camera.current?.click()} className="inline-flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-6 font-semibold md:hidden">
              <IconCamera className="size-5" /> Сделать фото
            </button>
          </div>
          <p className="max-w-sm text-sm text-muted">До 10 фото. Первое станет обложкой. Лучше при дневном свете, вещь целиком. Можно перетащить файлы сюда.</p>
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
            className={clsx("group relative h-[120px] w-24 overflow-hidden rounded-xl bg-skeleton", p.status === "error" && "ring-2 ring-danger", dragKey === p.key && "opacity-50")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.preview} alt={`Фото ${i + 1}`} className="size-full object-cover" />
            {p.status === "uploading" && (
              <span className="absolute inset-0 grid place-items-center bg-white/60" aria-label="Загружается">
                <Spinner className="size-6 text-ink" />
              </span>
            )}
            {p.status === "error" && <span className="absolute inset-x-0 bottom-0 bg-danger px-1 py-0.5 text-center text-[10px] font-medium text-white">{p.error}</span>}
            {i === 0 && p.status !== "error" && <span className="absolute left-1 top-1 rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">Обложка</span>}
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
        {photos.length < MAX_PHOTOS && (
          <li>
            <button type="button" onClick={() => input.current?.click()} className="flex h-[120px] w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line-strong text-sm text-ink-2 hover:border-ink">
              <IconPlus /> Фото
            </button>
          </li>
        )}
      </ul>
      <p className="mt-3 text-sm text-muted">Вещь целиком · Этикетка с размером · Дефекты крупно (если есть)</p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
