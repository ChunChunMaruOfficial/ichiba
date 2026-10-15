import { api } from "./api";
import type { Card } from "./types";

/** Result of a search by photo, kept for the /search?photo=… page (the photo itself never leaves the device again). */
export interface PhotoSearchResult {
  id: string;
  label: string | null;
  items: Card[];
  notClothing: boolean;
  /** Object URL of the picked photo; lost on reload, the results are not. */
  preview?: string;
}

const KEY = "ichiba:photo-search";
let last: PhotoSearchResult | null = null;

/** `market`: the search stays in the market it started from (brands unless on «Вторичка»). */
export async function searchByPhoto(file: File, market: "brands" | "resale" = "brands"): Promise<PhotoSearchResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await api<Omit<PhotoSearchResult, "id" | "preview">>(`/ai/photo-search?market=${market}`, { body: form });
  const result: PhotoSearchResult = { ...res, id: Date.now().toString(36), preview: URL.createObjectURL(file) };
  if (last?.preview) URL.revokeObjectURL(last.preview);
  last = result;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...result, preview: undefined }));
  } catch {
    /* storage blocked: results live until reload */
  }
  return result;
}

export function photoSearchResult(id: string): PhotoSearchResult | null {
  if (last?.id === id) return last;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as PhotoSearchResult | null;
    return saved?.id === id ? saved : null;
  } catch {
    return null;
  }
}
