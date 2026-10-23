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

/**
 * Paths are built from route params and query values: "/deals/../admin/db/User" (or "%2e%2e", which fetch
 * treats the same) would reach another endpoint with the visitor's session. Such a path is never sent.
 */
export function assertApiPath(path: string) {
  const pathname = path.split(/[?#]/, 1)[0];
  if (!pathname.startsWith("/") || pathname.includes("\\") || pathname.split("/").some((s) => /^(\.|%2e){1,2}$/i.test(s))) {
    throw new ApiError(400, "Некорректный адрес");
  }
}

export async function api<T>(path: string, init: { method?: string; body?: Body; signal?: AbortSignal } = {}): Promise<T> {
  assertApiPath(path);
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
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A proxy in front of the API answers 502/504 with an HTML page: never show the reader a raw SyntaxError.
    throw new ApiError(res.status, res.ok ? "Некорректный ответ сервера" : "Сервер недоступен. Повторите через минуту");
  }
  if (!res.ok) {
    const message = typeof data?.message === "string" ? ruMessage(data.message) : "Что-то пошло не так. Повторите";
    throw new ApiError(res.status, message, data?.fields ?? {}, data?.code, data ?? {});
  }
  return data as T;
}

/** English messages that come straight from libraries on the API (multer), shown to the reader in Russian. */
const LIBRARY_MESSAGES: Record<string, string> = {
  "File too large": "Файл слишком большой (до 15 МБ)",
};
const ruMessage = (m: string) => LIBRARY_MESSAGES[m] ?? m;

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

export interface PhotoUrls {
  s: string;
  m: string;
  l: string;
}
