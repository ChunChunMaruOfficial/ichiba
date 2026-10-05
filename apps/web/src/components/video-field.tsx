"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { VideoView } from "@/lib/types";
import { Button, IconX, Spinner } from "./ui";

const MAX_SECONDS = 30;
const MAX_BYTES = 40 * 1024 * 1024;

/** Reads duration and size, and grabs a frame at ~0.5 s as the poster (the server never decodes video). */
function probe(file: File): Promise<{ durationMs: number; width: number; height: number; poster: Blob }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    const fail = (msg: string) => {
      URL.revokeObjectURL(url);
      reject(new Error(msg));
    };
    v.onerror = () => fail("Браузер не смог открыть это видео. Попробуйте MP4");
    v.onloadedmetadata = () => {
      if (!Number.isFinite(v.duration)) return fail("Не удалось определить длительность видео");
      v.currentTime = Math.min(0.5, v.duration / 2);
    };
    v.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d")?.drawImage(v, 0, 0);
      canvas.toBlob(
        (poster) => {
          URL.revokeObjectURL(url);
          if (!poster) return reject(new Error("Не удалось получить кадр из видео"));
          resolve({ durationMs: Math.round(v.duration * 1000), width: v.videoWidth, height: v.videoHeight, poster });
        },
        "image/jpeg",
        0.85,
      );
    };
    v.src = url;
  });
}

/** One short video per listing (Depop/Avito): up to 30 s, shown in the gallery after the photos. */
export function VideoField({ value, onChange, disabled }: { value: VideoView | null; onChange: (v: VideoView | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) return setError("Видео больше 40 МБ — сократите его или снимите в меньшем качестве");
    setBusy(true);
    try {
      const meta = await probe(file);
      if (meta.durationMs > MAX_SECONDS * 1000 + 500) throw new Error(`Видео длиннее ${MAX_SECONDS} секунд — обрежьте его`);
      const form = new FormData();
      form.append("file", file);
      form.append("poster", meta.poster, "poster.jpg");
      form.append("durationMs", String(meta.durationMs));
      form.append("width", String(meta.width));
      form.append("height", String(meta.height));
      onChange(await api<VideoView>("/media/videos", { body: form }));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Не удалось загрузить видео");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="relative w-fit overflow-hidden rounded-xl bg-black">
          <video src={value.url} poster={value.poster} controls muted playsInline preload="metadata" className="max-h-56 w-auto" />
          {!disabled && (
            <button type="button" aria-label="Убрать видео" onClick={() => onChange(null)} className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80">
              <IconX className="size-4" />
            </button>
          )}
        </div>
      ) : (
        <Button type="button" variant="secondary" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()} className="w-fit">
          {busy ? (
            <>
              <Spinner /> Загружаем видео…
            </>
          ) : (
            "▶ Добавить видео"
          )}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : !value && <p className="text-xs text-muted">До 30 секунд: покажите посадку, ткань, детали</p>}
    </div>
  );
}
