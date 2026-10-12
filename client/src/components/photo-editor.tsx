"use client";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Spinner } from "./ui";

/**
 * Full-screen editor for one listing photo, over the blurred page: crop (free or a fixed ratio), quarter turns,
 * straightening, mirroring, and drawing on the photo (circle a defect, point at a detail). On «Готово» the
 * photo is rendered in full size (up to 2560 px) into a JPEG and handed back as a File for a normal upload.
 */

type Pt = [number, number]; // share of the frame, 0…1
type Crop = { x: number; y: number; w: number; h: number };
interface Stroke {
  color: string;
  width: number; // share of the frame's shorter side
  points: Pt[];
}
interface Edit {
  quarter: number; // quarter turns clockwise, 0…3
  straighten: number; // degrees, −15…15
  flipH: boolean;
  flipV: boolean;
  aspect: number | null; // width / height in pixels; null = free
  crop: Crop;
  strokes: Stroke[];
}

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const START: Edit = { quarter: 0, straighten: 0, flipH: false, flipV: false, aspect: null, crop: FULL, strokes: [] };
const ASPECTS: Array<[string, number | null]> = [
  ["Свободно", null],
  ["4:5", 4 / 5],
  ["1:1", 1],
  ["3:4", 3 / 4],
];
/** The site's own colours (globals.css): cinnabar, indigo, sumi ink, washi, amber. */
const COLORS: Array<[string, string]> = [
  ["#c8102e", "Красный"],
  ["#23395b", "Синий"],
  ["#1c1a17", "Чёрный"],
  ["#fbf8f2", "Белый"],
  ["#e2b457", "Жёлтый"],
];
const WIDTHS: Array<[number, string]> = [
  [0.006, "Тонкая"],
  [0.012, "Средняя"],
  [0.022, "Толстая"],
];
const MIN_CROP = 0.08;
const MAX_SIDE = 2560;

/** Size of the frame after quarter turns. */
const frameSize = (img: HTMLImageElement, quarter: number) => (quarter % 2 ? { w: img.naturalHeight, h: img.naturalWidth } : { w: img.naturalWidth, h: img.naturalHeight });

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  const side = Math.min(w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width * side;
    if (s.points.length === 1) {
      ctx.beginPath();
      ctx.arc(s.points[0][0] * w, s.points[0][1] * h, (s.width * side) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    ctx.stroke();
  }
}

/** The turned, straightened and mirrored photo filling the frame (no empty corners), with the drawing on top. */
function renderFrame(img: HTMLImageElement, e: Edit, scale: number) {
  const { w: fw, h: fh } = frameSize(img, e.quarter);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(fw * scale));
  canvas.height = Math.max(1, Math.round(fh * scale));
  const ctx = canvas.getContext("2d")!;
  const t = (Math.abs(e.straighten) * Math.PI) / 180;
  // Straightening turns the photo inside a frame of the same size: zoom in just enough to cover it.
  const cover = Math.max((fw * Math.cos(t) + fh * Math.sin(t)) / fw, (fw * Math.sin(t) + fh * Math.cos(t)) / fh);
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.rotate(((e.quarter * 90 + e.straighten) * Math.PI) / 180);
  ctx.scale(scale * cover, scale * cover);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
  drawStrokes(ctx, e.strokes, canvas.width, canvas.height);
  return canvas;
}

/** Largest centred crop of the given pixel ratio inside a frame of fw × fh. */
function fitAspect(aspect: number | null, fw: number, fh: number): Crop {
  if (!aspect) return FULL;
  const r = (aspect * fh) / fw; // the same ratio in frame shares
  return r > 1 ? { x: 0, y: (1 - 1 / r) / 2, w: 1, h: 1 / r } : { x: (1 - r) / 2, y: 0, w: r, h: 1 };
}

/** Moves the drawing along with a turn or a mirror, so it stays on the same spot of the photo. */
function moveStrokes(strokes: Stroke[], f: (p: Pt) => Pt) {
  return strokes.map((s) => ({ ...s, points: s.points.map(f) }));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function PhotoEditor({ src, open, onClose, onSave }: { src: string; open: boolean; onClose: () => void; onSave: (file: File) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<Edit>(START);
  const [tab, setTab] = useState<"crop" | "draw">("crop");
  const [color, setColor] = useState(COLORS[0][0]);
  const [width, setWidth] = useState(WIDTHS[1][0]);
  const [saving, setSaving] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  /** Free room for the photo, measured: CSS max-width + max-height on a canvas sizes its wrapper differently in Safari. */
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setRoom({ w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = new Image();
    // Stored photos come from the media host (CORS on): without this the canvas could not be exported.
    if (!src.startsWith("blob:") && !src.startsWith("data:")) el.crossOrigin = "anonymous";
    el.onload = () => setImg(el);
    el.onerror = () => setFailed(true);
    el.src = src;
    return () => {
      el.onload = null;
      el.onerror = null;
    };
  }, [src, open]);

  // Esc cancels; the page underneath doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  // Live preview at screen size.
  useLayoutEffect(() => {
    const target = preview.current;
    if (!img || !target) return;
    const { w, h } = frameSize(img, edit.quarter);
    const frame = renderFrame(img, edit, Math.min(1, 1100 / Math.max(w, h)));
    target.width = frame.width;
    target.height = frame.height;
    target.getContext("2d")!.drawImage(frame, 0, 0);
  }, [img, edit]);

  /** Turns and mirrors change the frame: the crop starts over at the chosen ratio, the drawing moves along. */
  const reframe = (patch: Partial<Edit>, move?: (p: Pt) => Pt) =>
    setEdit((e) => {
      const next = { ...e, ...patch, strokes: move ? moveStrokes(e.strokes, move) : e.strokes };
      if (!img) return next;
      const { w, h } = frameSize(img, next.quarter);
      return { ...next, crop: fitAspect(next.aspect, w, h) };
    });
  // On screen a turn is always the same; in the photo's own coordinates it goes the other way when mirrored once.
  const turn = (dir: 1 | -1) =>
    reframe({ quarter: (((edit.quarter + (edit.flipH !== edit.flipV ? -dir : dir)) % 4) + 4) % 4 }, dir === 1 ? ([x, y]) => [1 - y, x] : ([x, y]) => [y, 1 - x]);

  // ---------- pointer: crop box or brush ----------
  const drag = useRef<{ mode: string; x: number; y: number; start: Crop } | null>(null);
  const at = (e: React.PointerEvent): Pt => {
    const r = box.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
  };
  /** Crop: the box (data-mode="move") or a corner (data-mode="nw" …). Drawing: anywhere on the photo. */
  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tab === "draw") {
      drag.current = { mode: "draw", x: 0, y: 0, start: edit.crop };
      const p = at(e);
      setEdit((s) => ({ ...s, strokes: [...s.strokes, { color, width, points: [p] }] }));
      return;
    }
    drag.current = { mode: e.currentTarget.dataset.mode ?? "move", x: e.clientX, y: e.clientY, start: edit.crop };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = box.current;
    if (!d || !el || !img) return;
    // A missed pointerup (released outside the window) must not keep drawing or dragging on plain moves.
    if (e.pointerType === "mouse" && !(e.buttons & 1)) {
      drag.current = null;
      return;
    }
    if (d.mode === "draw") {
      const p = at(e);
      setEdit((s) => {
        const strokes = [...s.strokes];
        const last = strokes[strokes.length - 1];
        strokes[strokes.length - 1] = { ...last, points: [...last.points, p] };
        return { ...s, strokes };
      });
      return;
    }
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - d.x) / rect.width;
    const dy = (e.clientY - d.y) / rect.height;
    const s = d.start;
    let c: Crop;
    if (d.mode === "move") c = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
    else {
      // A corner moves two sides, an edge one; the sides that aren't dragged stay put.
      const [l, r, t, b] = (["w", "e", "n", "s"] as const).map((k) => d.mode.includes(k));
      let x0 = l ? clamp(s.x + dx, 0, s.x + s.w - MIN_CROP) : s.x;
      let x1 = r ? clamp(s.x + s.w + dx, s.x + MIN_CROP, 1) : s.x + s.w;
      let y0 = t ? clamp(s.y + dy, 0, s.y + s.h - MIN_CROP) : s.y;
      let y1 = b ? clamp(s.y + s.h + dy, s.y + MIN_CROP, 1) : s.y + s.h;
      if (edit.aspect) {
        const { w: fw, h: fh } = frameSize(img, edit.quarter);
        const ratio = (edit.aspect * fh) / fw; // width / height in frame shares
        if ((l || r) && (t || b)) {
          // Corner: follow the width; the height comes from the ratio, shrunk back if it would leave the frame.
          let w = x1 - x0;
          let h = w / ratio;
          const room = t ? y1 : 1 - y0;
          if (h > room) {
            h = room;
            w = h * ratio;
          }
          if (l) x0 = x1 - w;
          else x1 = x0 + w;
          if (t) y0 = y1 - h;
          else y1 = y0 + h;
        } else if (l || r) {
          // Side edge: the height follows, growing evenly up and down around the box's middle.
          const cy = s.y + s.h / 2;
          let w = x1 - x0;
          const h = Math.min(w / ratio, 2 * Math.min(cy, 1 - cy));
          w = h * ratio;
          if (l) x0 = x1 - w;
          else x1 = x0 + w;
          y0 = cy - h / 2;
          y1 = cy + h / 2;
        } else {
          // Top or bottom edge: the width follows, evenly left and right.
          const cx = s.x + s.w / 2;
          let h = y1 - y0;
          const w = Math.min(h * ratio, 2 * Math.min(cx, 1 - cx));
          h = w / ratio;
          if (t) y0 = y1 - h;
          else y1 = y0 + h;
          x0 = cx - w / 2;
          x1 = cx + w / 2;
        }
      }
      c = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    setEdit((st) => ({ ...st, crop: c }));
  };
  const onUp = () => (drag.current = null);

  const save = async () => {
    if (!img) return;
    setSaving(true);
    try {
      const { w, h } = frameSize(img, edit.quarter);
      const scale = Math.min(1, MAX_SIDE / Math.max(w * edit.crop.w, h * edit.crop.h));
      const frame = renderFrame(img, edit, scale);
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(frame.width * edit.crop.w));
      out.height = Math.max(1, Math.round(frame.height * edit.crop.h));
      out.getContext("2d")!.drawImage(frame, -Math.round(frame.width * edit.crop.x), -Math.round(frame.height * edit.crop.y));
      const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.92));
      onSave(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  // The photo's on-screen size: as large as the free room allows, its own proportions kept.
  const fit = (() => {
    if (!img || !room || room.w <= 0 || room.h <= 0) return null;
    const { w, h } = frameSize(img, edit.quarter);
    const k = Math.min(room.w / w, room.h / h, 1100 / Math.max(w, h));
    return { w: Math.floor(w * k), h: Math.floor(h * k) };
  })();
  const c = edit.crop;
  const cropped = c.x > 0.001 || c.y > 0.001 || c.w < 0.999 || c.h < 0.999;
  const changed = cropped || !!edit.quarter || !!edit.straighten || edit.flipH || edit.flipV || edit.strokes.length > 0;

  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Редактировать фото" className="fade-in fixed inset-0 z-[70] flex flex-col bg-paper/75 text-ink backdrop-blur-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-2 pt-[env(safe-area-inset-top)] sm:px-4">
        <button type="button" onClick={onClose} className="h-10 rounded-full px-4 text-[15px] font-medium text-ink-2 hover:bg-ink/5">
          Отмена
        </button>
        {changed && (
          <button type="button" onClick={() => setEdit(START)} className="h-10 rounded-full px-4 text-sm text-muted hover:bg-ink/5">
            Сбросить
          </button>
        )}
        <Button size="sm" className="px-5" loading={saving} disabled={!changed || !img} onClick={save}>
          Готово
        </Button>
      </div>

      {/* The photo, as large as the screen allows; the dimmed part is what gets cut off. */}
      <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5 sm:p-8">
        {failed ? (
          <p className="max-w-xs text-center text-ink-2">Не получилось открыть фото для редактирования. Попробуйте загрузить его заново.</p>
        ) : !img ? (
          <Spinner className="text-muted" />
        ) : (
          <div
            ref={box}
            className={clsx("relative touch-none select-none rounded-sm shadow-[var(--shadow-float)]", tab === "draw" && "cursor-crosshair")}
            onPointerDown={tab === "draw" ? onDown : undefined}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
          >
            <canvas ref={preview} className="block" style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }} />
            <div
              className="pointer-events-none absolute inset-0 bg-paper/70"
              style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${c.x * 100}% ${c.y * 100}%,${c.x * 100}% ${(c.y + c.h) * 100}%,${(c.x + c.w) * 100}% ${(c.y + c.h) * 100}%,${(c.x + c.w) * 100}% ${c.y * 100}%,${c.x * 100}% ${c.y * 100}%)` }}
            />
            {tab === "crop" && (
              <div
                data-mode="move"
                onPointerDown={onDown}
                className="absolute cursor-move outline outline-2 outline-white drop-shadow-[0_0_1px_rgb(0_0_0/0.6)]"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
              >
                {/* Rule-of-thirds guides. */}
                <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/60" />
                <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/60" />
                <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/60" />
                <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/60" />
                {/* Edges: drag one side only. The whole side is grabbable (between the corners); a short bar marks it. */}
                {(["n", "s", "w", "e"] as const).map((k) => (
                  <span
                    key={k}
                    aria-hidden
                    data-mode={k}
                    onPointerDown={onDown}
                    className={clsx(
                      "absolute grid touch-none place-items-center",
                      k === "n" && "inset-x-5 -top-4 h-8 cursor-ns-resize",
                      k === "s" && "inset-x-5 -bottom-4 h-8 cursor-ns-resize",
                      k === "w" && "inset-y-5 -left-4 w-8 cursor-ew-resize",
                      k === "e" && "inset-y-5 -right-4 w-8 cursor-ew-resize",
                    )}
                  >
                    <span className={clsx("rounded-full bg-white shadow-[0_0_2px_rgb(0_0_0/0.5)]", k === "n" || k === "s" ? "h-1 w-7" : "h-7 w-1")} />
                  </span>
                ))}
                {/* Corner brackets, the way phone editors draw them; the hit area is larger than the mark. */}
                {(["nw", "ne", "sw", "se"] as const).map((k) => (
                  <span
                    key={k}
                    aria-hidden
                    data-mode={k}
                    onPointerDown={onDown}
                    className={clsx(
                      "absolute size-10 touch-none",
                      k.includes("n") ? "-top-5" : "-bottom-5",
                      k.includes("w") ? "-left-5" : "-right-5",
                      k === "nw" || k === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize",
                    )}
                  >
                    <span
                      className={clsx(
                        "absolute size-5 border-white",
                        k.includes("n") ? "top-[17px] border-t-[3px]" : "bottom-[17px] border-b-[3px]",
                        k.includes("w") ? "left-[17px] border-l-[3px]" : "right-[17px] border-r-[3px]",
                      )}
                    />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tools of the current mode, then the mode switch, like Photos on a phone. */}
      <div className="mx-auto flex w-full max-w-xl shrink-0 flex-col gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
        {tab === "crop" ? (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-center gap-2 text-[13px]">
                <span className="uppercase tracking-[0.12em] text-muted">Выровнять</span>
                <button type="button" onClick={() => setEdit((s) => ({ ...s, straighten: 0 }))} title="Сбросить" className={clsx("tabular font-semibold", edit.straighten ? "text-shu" : "text-ink-2")}>
                  {edit.straighten > 0 ? "+" : ""}
                  {edit.straighten}°
                </button>
              </div>
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-ink/30" />
                <input type="range" aria-label="Выровнять горизонт" min={-15} max={15} step={0.5} value={edit.straighten} onChange={(e) => setEdit((s) => ({ ...s, straighten: Number(e.target.value) }))} className="relative w-full accent-[var(--shu)]" />
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
              <div className="flex gap-1">
                <ToolButton label="Повернуть влево" onClick={() => turn(-1)}>
                  <path d="M4 9a8 8 0 1 1 2 7" />
                  <path d="M4 4v5h5" />
                </ToolButton>
                <ToolButton label="Повернуть вправо" onClick={() => turn(1)}>
                  <path d="M20 9a8 8 0 1 0-2 7" />
                  <path d="M20 4v5h-5" />
                </ToolButton>
                <ToolButton label="Отразить по горизонтали" active={edit.flipH} onClick={() => reframe({ flipH: !edit.flipH }, ([x, y]) => [1 - x, y])}>
                  <path d="M12 3v18" strokeDasharray="2 2" />
                  <path d="M9 7 4 17h5Z" />
                  <path d="m15 7 5 10h-5Z" />
                </ToolButton>
                <ToolButton label="Отразить по вертикали" active={edit.flipV} onClick={() => reframe({ flipV: !edit.flipV }, ([x, y]) => [x, 1 - y])}>
                  <path d="M3 12h18" strokeDasharray="2 2" />
                  <path d="M7 9 17 4v5Z" />
                  <path d="m7 15 10 5v-5Z" />
                </ToolButton>
              </div>
              <div className="flex gap-1">
                {ASPECTS.map(([label, a]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => reframe({ aspect: a })}
                    className={clsx("h-9 shrink-0 rounded-full px-3 text-[13px] font-medium", edit.aspect === a ? "bg-ink text-accent-ink" : "text-ink-2 hover:bg-ink/5")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2.5">
              {COLORS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={label}
                  aria-pressed={color === value}
                  onClick={() => setColor(value)}
                  className={clsx("size-8 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] transition-transform", color === value ? "scale-110 ring-2 ring-ink ring-offset-2 ring-offset-paper" : "hover:scale-105")}
                  style={{ background: value }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              {WIDTHS.map(([w, label]) => (
                <button key={w} type="button" aria-label={label} title={label} aria-pressed={width === w} onClick={() => setWidth(w)} className={clsx("grid size-11 place-items-center rounded-full", width === w ? "bg-ink text-accent-ink" : "text-ink-2 hover:bg-ink/5")}>
                  <span className="rounded-full bg-current" style={{ width: 4 + w * 600, height: 4 + w * 600 }} />
                </button>
              ))}
              <span className="mx-1 h-6 w-px bg-line" aria-hidden />
              <ToolButton label="Отменить штрих" disabled={!edit.strokes.length} onClick={() => setEdit((s) => ({ ...s, strokes: s.strokes.slice(0, -1) }))}>
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
              </ToolButton>
              <ToolButton label="Стереть всё" disabled={!edit.strokes.length} onClick={() => setEdit((s) => ({ ...s, strokes: [] }))}>
                <path d="M4 7h16M10 11v6M14 11v6" />
                <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
              </ToolButton>
            </div>
          </div>
        )}
        <div role="tablist" className="mx-auto flex gap-6 text-[13px] font-semibold uppercase tracking-[0.12em]">
          {(
            [
              ["crop", "Кадр"],
              ["draw", "Рисовать"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={clsx("py-1", tab === id ? "text-shu" : "text-muted hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={clsx("grid size-11 place-items-center rounded-full disabled:opacity-30", active ? "bg-ink text-accent-ink" : "text-ink-2 hover:bg-ink/5")}
    >
      <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
