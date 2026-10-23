import { openImage } from './image.js';

/**
 * Colour signature of a photo for search by photo: a coarse histogram of the item's colours — four neutrals
 * (black, dark grey, light grey, white) and twelve hues, each dark and bright. Pixels near the centre count
 * more, where the item usually is, so a background matters less. Stored as 28 base-36 digits (square-root
 * scale, so small but telling patches — a red print on a black beanie — keep their weight).
 */

const HUES = 12;
export const PALETTE_BINS = 4 + HUES * 2;
const SIDE = 32;

function bin(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  if (s < 0.2 || v < 0.15) return v < 0.2 ? 0 : v < 0.45 ? 1 : v < 0.75 ? 2 : 3;
  let h: number;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const hue = Math.min(HUES - 1, Math.floor((h / 6) * HUES));
  return 4 + hue * 2 + (v < 0.55 ? 0 : 1);
}

/** Histogram (sums to 1) of raw RGB pixels of a `side`×`side` image. */
export function paletteOf(rgb: Uint8Array, side = SIDE): number[] {
  const hist = new Array<number>(PALETTE_BINS).fill(0);
  const c = (side - 1) / 2;
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const i = (y * side + x) * 3;
      const d = Math.hypot(x - c, y - c) / (c * Math.SQRT2);
      hist[bin(rgb[i], rgb[i + 1], rgb[i + 2])] += 1 - 0.8 * d;
    }
  const total = hist.reduce((a, b) => a + b, 0);
  return hist.map((v) => (total ? v / total : 0));
}

export const encodePalette = (hist: number[]) => hist.map((p) => Math.round(Math.sqrt(p) * 35).toString(36)).join('');

export function decodePalette(code: string): number[] | null {
  if (code.length !== PALETTE_BINS) return null;
  const hist = [...code].map((ch) => (parseInt(ch, 36) / 35) ** 2);
  const total = hist.reduce((a, b) => a + b, 0);
  return total ? hist.map((v) => v / total) : null;
}

/** Callers hold a slot of `withSharp` (media/image.ts); this only decodes, with the input limits. */
export async function colorPalette(image: Buffer): Promise<string> {
  const rgb = await openImage(image).rotate().resize(SIDE, SIDE, { fit: 'cover' }).removeAlpha().raw().toBuffer();
  return encodePalette(paletteOf(rgb));
}

/** A quarter of each hue spills to the neighbouring hues of the same brightness: red and orange are close, red and blue are not. */
function soften(hist: number[]): number[] {
  const out = hist.slice(0, 4);
  for (let i = 0; i < HUES * 2; i++) {
    const hue = i >> 1;
    const level = i & 1;
    const at = (h: number) => hist[4 + (((h + HUES) % HUES) << 1) + level];
    out.push(at(hue) * 0.5 + (at(hue - 1) + at(hue + 1)) * 0.25);
  }
  return out;
}

/** 0..1: how much of the two colour signatures overlaps (histogram intersection). */
export function paletteSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ha = a ? decodePalette(a) : null;
  const hb = b ? decodePalette(b) : null;
  if (!ha || !hb) return 0;
  const sa = soften(ha);
  const sb = soften(hb);
  return sa.reduce((s, v, i) => s + Math.min(v, sb[i]), 0);
}
