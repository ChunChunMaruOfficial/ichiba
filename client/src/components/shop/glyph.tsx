import { GLYPHS } from "./glyphs";

/** A brush glyph placed by the centre of its ink and its larger side, so kanji and kana sit optically centred. */
export function Glyph({ ch, cx, cy, size, fill = "currentColor" }: { ch: string; cx: number; cy: number; size: number; fill?: string }) {
  const g = GLYPHS[ch];
  if (!g) return null;
  const [x0, y0, x1, y1] = g.box;
  const w = x1 - x0;
  const h = y1 - y0;
  const s = size / Math.max(w, h);
  return <path d={g.d} fill={fill} transform={`translate(${(cx - (x0 + w / 2) * s).toFixed(2)} ${(cy - (y0 + h / 2) * s).toFixed(2)}) scale(${s.toFixed(4)})`} />;
}
