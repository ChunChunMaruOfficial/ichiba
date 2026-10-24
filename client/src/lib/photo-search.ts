import { api } from "./api";
import type { Zone } from "./market";
import { shrink } from "./upload";

/**
 * Result of a search by photo, kept for the /search?photo=… page (the photo itself never leaves the device again):
 * the item ids ranked by likeness. The page pages, refines, filters and sorts them through /search?ids=….
 */
export interface PhotoSearchResult {
  id: string;
  /** What the AI saw («Шапка, чёрный, с пламенем»), for the thumbnail's description. */
  label: string | null;
  ids: string[];
  /** The same search in the other market, for the «Бренды / Вторичка» switch (older saved results have none). */
  other?: { market: Zone; ids: string[] } | null;
  notClothing: boolean;
  market: Zone;
  /** A small JPEG of the picked photo for the search bar; kept with the result, so a reload still shows it. */
  thumb: string | null;
}

const KEY = "ichiba:photo-search";
/** Searches kept for back/forward and reloads: a few, so sessionStorage (≈5 MB) never fills up with thumbnails. */
const KEEP = 5;
/** What is sent for the search: plenty for recognising a garment, and a 12-MP phone photo becomes ~300 KB. */
const SEARCH_SIDE = 1600;
let last: PhotoSearchResult | null = null;

/** A ~160 px JPEG data URL of the photo, or null when the browser can't draw it (HEIC in Chrome and Firefox). */
async function thumbnail(file: Blob): Promise<string | null> {
  const canvas = document.createElement("canvas");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = 160 / Math.min(bitmap.width, bitmap.height);
    canvas.width = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
    canvas.height = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function readSaved(): PhotoSearchResult[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as PhotoSearchResult[] | PhotoSearchResult | null;
    // Older tabs kept a single result instead of a list.
    return Array.isArray(saved) ? saved : saved ? [saved] : [];
  } catch {
    return [];
  }
}

/** `market`: the search stays in the market it started from (brands unless on «Вторичка»). */
export async function searchByPhoto(file: File, market: Zone = "brands", signal?: AbortSignal): Promise<PhotoSearchResult> {
  // Shrunk before upload: a full-size photo over a phone connection took long and could hit the API's size limit.
  const small = await shrink(file, 0, { maxSide: SEARCH_SIDE, anyType: true, quality: 0.85 });
  const form = new FormData();
  form.append("file", small, small === file ? file.name : "photo.jpg");
  const [res, thumb] = await Promise.all([api<{ label: string | null; ids: string[]; other: { market: Zone; ids: string[] } | null; notClothing: boolean }>(`/ai/photo-search?market=${market}`, { body: form, signal }), thumbnail(small)]);
  const result: PhotoSearchResult = { id: Date.now().toString(36), label: res.label, ids: res.ids, other: res.other, notClothing: res.notClothing, market, thumb };
  last = result;
  try {
    sessionStorage.setItem(KEY, JSON.stringify([result, ...readSaved().filter((r) => r.id !== result.id)].slice(0, KEEP)));
  } catch {
    /* storage blocked or full: results live until reload */
  }
  return result;
}

/** The same object for the same id (useSyncExternalStore needs a stable snapshot). */
export function photoSearchResult(id: string): PhotoSearchResult | null {
  if (last?.id === id) return last;
  const saved = readSaved().find((r) => r.id === id) ?? null;
  if (saved) last = saved;
  return saved;
}
