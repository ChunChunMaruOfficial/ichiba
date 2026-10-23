import { api, ApiError } from "./api";
import { postForm } from "./upload";
import type { VideoView } from "./types";

/** One short video per listing (Depop/Avito): up to 30 s, shown in the gallery after the photos. */
export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";
const MAX_SECONDS = 30;
/** Videos sent in chat may be longer. */
const MAX_CHAT_SECONDS = 180;
const MAX_BYTES = 40 * 1024 * 1024;

/** How long the browser gets to open a video before we give up (some codecs never fire an event). */
const PROBE_TIMEOUT_MS = 10_000;

/** Reads duration and size, and grabs a frame at ~0.5 s as the poster (the server never decodes video). */
function probe(file: File): Promise<{ durationMs: number; width: number; height: number; poster: Blob }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    let settled = false;
    /** Runs once: detaches the video, frees the file URL and the decoder. */
    const finish = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      v.onerror = v.onloadedmetadata = v.onseeked = null;
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      return true;
    };
    const fail = (msg: string) => finish() && reject(new Error(msg));
    // Safari with an HEVC file it can't decode, or a damaged file, may never answer: the «+» tile spun forever.
    const timer = setTimeout(() => fail("Браузер не смог открыть это видео. Попробуйте MP4"), PROBE_TIMEOUT_MS);
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
      const meta = { durationMs: Math.round(v.duration * 1000), width: v.videoWidth, height: v.videoHeight };
      canvas.toBlob(
        (poster) => {
          canvas.width = canvas.height = 0;
          if (!poster) return fail("Не удалось получить кадр из видео");
          if (finish()) resolve({ ...meta, poster });
        },
        "image/jpeg",
        0.85,
      );
    };
    v.src = url;
    // iOS Safari doesn't start loading a detached video's metadata until asked to.
    v.load();
  });
}

type Ticket = { provider: "local" } | { provider: "cloudinary"; uploadUrl: string; fields: Record<string, string | number> };

/**
 * Checks the limits in the browser, then uploads the video. With Cloudinary configured the file goes straight from
 * the browser to Cloudinary (signed by our API) and Cloudinary makes the poster; otherwise it is posted to the API
 * with a poster frame grabbed here. Throws with a message to show.
 */
export async function uploadVideo(file: File, opts: { purpose?: "listing" | "chat"; onProgress?: (share: number) => void; signal?: AbortSignal } = {}): Promise<VideoView> {
  const chat = opts.purpose === "chat";
  const usage = chat ? "?for=chat" : "";
  if (file.size > MAX_BYTES) throw new Error("Видео больше 40 МБ — сократите его или снимите в меньшем качестве");
  const max = chat ? MAX_CHAT_SECONDS : MAX_SECONDS;
  const tooLong = chat ? "Видео длиннее 3 минут — обрежьте его" : `Видео длиннее ${MAX_SECONDS} секунд — обрежьте его`;
  const ticket = await api<Ticket>("/media/videos/ticket", { method: "POST", signal: opts.signal });

  if (ticket.provider === "cloudinary") {
    // The browser may not decode the file (an iPhone's HEVC .mov in Chrome): then Cloudinary checks the duration.
    const meta = await probe(file).catch(() => null);
    if (meta && meta.durationMs > max * 1000 + 500) throw new Error(tooLong);
    const form = new FormData();
    for (const [k, v] of Object.entries(ticket.fields)) form.append(k, String(v));
    form.append("file", file, file.name);
    const res = await postForm(ticket.uploadUrl, form, (s) => opts.onProgress?.(s * 0.95), opts.signal);
    const body = res.body as { public_id?: string; version?: number; signature?: string; error?: { message?: string } } | null;
    if (res.status >= 400 || !body?.public_id) {
      const msg = body?.error?.message ?? "";
      if (/too large/i.test(msg)) throw new ApiError(res.status, "Видео слишком большое");
      if (/format/i.test(msg)) throw new ApiError(res.status, "Поддерживаются видео MP4, MOV и WEBM");
      throw new ApiError(res.status, "Видео не загрузилось. Повторите");
    }
    const video = await api<VideoView>(`/media/videos/cloudinary${usage}`, { body: { publicId: body.public_id, version: body.version, signature: body.signature }, signal: opts.signal });
    opts.onProgress?.(1);
    return video;
  }

  const meta = await probe(file);
  if (meta.durationMs > max * 1000 + 500) throw new Error(tooLong);
  const form = new FormData();
  form.append("file", file);
  form.append("poster", meta.poster, "poster.jpg");
  form.append("durationMs", String(meta.durationMs));
  form.append("width", String(meta.width));
  form.append("height", String(meta.height));
  const res = await postForm(`/api/media/videos${usage}`, form, opts.onProgress, opts.signal);
  if (res.status >= 400 || !res.body) {
    const b = res.body ?? {};
    throw new ApiError(res.status, typeof b.message === "string" ? b.message : "Видео не загрузилось. Повторите", {}, typeof b.code === "string" ? b.code : undefined);
  }
  return res.body as unknown as VideoView;
}
