import { api } from "./api";
import type { VideoView } from "./types";

/** One short video per listing (Depop/Avito): up to 30 s, shown in the gallery after the photos. */
export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";
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

/** Checks the limits in the browser, then uploads the video with its poster frame. Throws with a message to show. */
export async function uploadVideo(file: File): Promise<VideoView> {
  if (file.size > MAX_BYTES) throw new Error("Видео больше 40 МБ — сократите его или снимите в меньшем качестве");
  const meta = await probe(file);
  if (meta.durationMs > MAX_SECONDS * 1000 + 500) throw new Error(`Видео длиннее ${MAX_SECONDS} секунд — обрежьте его`);
  const form = new FormData();
  form.append("file", file);
  form.append("poster", meta.poster, "poster.jpg");
  form.append("durationMs", String(meta.durationMs));
  form.append("width", String(meta.width));
  form.append("height", String(meta.height));
  return api<VideoView>("/media/videos", { body: form });
}
