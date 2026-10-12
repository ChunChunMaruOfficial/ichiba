import { api, ApiError, type PhotoUrls } from "./api";

export interface UploadedPhoto {
  id: string;
  width: number;
  height: number;
  urls: PhotoUrls;
}

type Ticket = { provider: "local" } | { provider: "cloudinary"; uploadUrl: string; fields: Record<string, string | number> };

/** Cloudinary's free plan takes images up to 10 MB: bigger JPG/PNG/WebP are shrunk in the browser first. */
const CLOUD_MAX_BYTES = 9.5 * 1024 * 1024;
/** Uploads through the API: serverless hosts cap request bodies (Vercel: 4.5 MB). */
const API_MAX_BYTES = 4 * 1024 * 1024;
const SHRINK_TO = 2560;

async function shrink(file: File, maxBytes = CLOUD_MAX_BYTES): Promise<Blob> {
  if (file.size <= maxBytes || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    // createImageBitmap applies the EXIF orientation, so the photo stays the right way up.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SHRINK_TO / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.9));
  } catch {
    return file;
  }
}

/** POST a form with upload progress (fetch can't report it). */
export function postForm(url: string, form: FormData, onProgress?: (share: number) => void, signal?: AbortSignal) {
  return new Promise<{ status: number; body: Record<string, unknown> | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ApiError(0, "Нет соединения. Проверьте интернет и повторите"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

/**
 * Listing photo upload. With Cloudinary configured the file goes straight from the browser to Cloudinary
 * (signed by our API, the secret never leaves the server), then the API checks and saves it. Without it,
 * the file is posted to the API as before. Either way the result is the same photo record.
 */
export async function uploadPhoto(file: File, onProgress?: (share: number) => void, signal?: AbortSignal, purpose: "listing" | "chat" | "avatar" = "listing"): Promise<UploadedPhoto> {
  // Chat photos skip the listing-only rules (minimum size).
  const usage = purpose === "listing" ? "" : `?for=${purpose}`;
  const ticket = await api<Ticket>("/media/photos/ticket", { method: "POST", signal });

  if (ticket.provider === "local") {
    const form = new FormData();
    const blob = await shrink(file, API_MAX_BYTES);
    form.append("file", blob, blob === file ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg");
    const res = await postForm(`/api/media/photos${usage}`, form, onProgress, signal);
    if (res.status >= 400 || !res.body) {
      const b = res.body ?? {};
      throw new ApiError(res.status, typeof b.message === "string" ? b.message : "Не загрузилось", {}, typeof b.code === "string" ? b.code : undefined);
    }
    return res.body as unknown as UploadedPhoto;
  }

  const form = new FormData();
  for (const [k, v] of Object.entries(ticket.fields)) form.append(k, String(v));
  form.append("file", await shrink(file), file.name);
  const res = await postForm(ticket.uploadUrl, form, (s) => onProgress?.(s * 0.95), signal);
  const body = res.body as { public_id?: string; version?: number; signature?: string; error?: { message?: string } } | null;
  if (res.status >= 400 || !body?.public_id) {
    const msg = body?.error?.message ?? "";
    if (/file size too large/i.test(msg)) throw new ApiError(res.status, "Фото больше 10 МБ");
    if (/format/i.test(msg)) throw new ApiError(res.status, "Поддерживаются JPG, PNG, HEIC и WEBP");
    throw new ApiError(res.status, "Не загрузилось. Повторите");
  }
  const photo = await api<UploadedPhoto>(`/media/photos/cloudinary${usage}`, { body: { publicId: body.public_id, version: body.version, signature: body.signature }, signal });
  onProgress?.(1);
  return photo;
}
