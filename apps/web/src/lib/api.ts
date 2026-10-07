/** Thin fetch wrapper for the Nest API, proxied at /api (see next.config.ts). */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
    public code?: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function api<T>(path: string, init: { method?: string; body?: Body; signal?: AbortSignal } = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: init.body && !isForm ? { "content-type": "application/json" } : undefined,
      body: isForm ? (init.body as FormData) : init.body ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Нет соединения. Проверьте интернет и повторите");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = typeof data?.message === "string" ? data.message : "Что-то пошло не так. Повторите";
    throw new ApiError(res.status, message, data?.fields ?? {}, data?.code, data ?? {});
  }
  return data as T;
}

/** SWR fetcher. */
export const fetcher = <T,>(path: string) => api<T>(path);

export function qs(params: Record<string, string | number | boolean | string[] | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    sp.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Serverless request bodies are capped (Vercel: 4.5 MB), so photos are shrunk in the browser first. */
const UPLOAD_LIMIT = 4 * 1024 * 1024;
const MAX_SIDE = 2560;

async function shrink(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // The browser cannot decode it (e.g. HEIC outside Safari): send as is if it fits.
    if (file.size <= UPLOAD_LIMIT) return file;
    throw new ApiError(413, "Фото слишком большое — сохраните его как JPG и попробуйте снова");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= UPLOAD_LIMIT && file.type !== "image/heic" && file.type !== "image/heif") {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.9, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= UPLOAD_LIMIT) return blob;
  }
  throw new ApiError(413, "Фото слишком большое");
}

export const uploadPhoto = async (file: File) => {
  const blob = await shrink(file);
  const form = new FormData();
  form.append("file", blob, blob === file ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg");
  return api<{ id: string; width: number; height: number; urls: PhotoUrls }>("/media/photos", { body: form });
};

export interface PhotoUrls {
  s: string;
  m: string;
  l: string;
}
