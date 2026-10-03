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

export const uploadPhoto = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api<{ id: string; width: number; height: number; urls: PhotoUrls }>("/media/photos", { body: form });
};

export interface PhotoUrls {
  s: string;
  m: string;
  l: string;
}
