"use client";

import clsx from "clsx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "./ui";

/**
 * Photo editor for one listing photo: crop (free or a fixed ratio), quarter turns, straightening, mirroring,
 * and light / contrast / colour. Everything is previewed live; on save the photo is rendered in full size
 * (up to 2560 px) into a JPEG and handed back as a File for a normal upload.
 */

type Crop = { x: number; y: number; w: number; h: number }; // share of the frame, 0…1
interface Edit {
  quarter: number; // quarter turns clockwise, 0…3
  straighten: number; // degrees, −15…15
  flipH: boolean;
  flipV: boolean;
  aspect: number | null; // width / height in pixels; null = free
  crop: Crop;
  brightness: number; // −50…50 (%)
  contrast: number;
  saturation: number;
}

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const START: Edit = { quarter: 0, straighten: 0, flipH: false, flipV: false, aspect: null, crop: FULL, brightness: 0, contrast: 0, saturation: 0 };
const ASPECTS: Array<[string, number | null]> = [
  ["Свободно", null],
  ["4:5", 4 / 5],
  ["1:1", 1],
  ["3:4", 3 / 4],
];
const MIN_CROP = 0.08;
const MAX_SIDE = 2560;

/** Size of the frame after quarter turns. */
const frameSize = (img: HTMLImageElement, quarter: number) => (quarter % 2 ? { w: img.naturalHeight, h: img.naturalWidth } : { w: img.naturalWidth, h: img.naturalHeight });

/** Draws the turned, straightened and mirrored photo so it fills the frame (no empty corners) at `scale`. */
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
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.rotate(((e.quarter * 90 + e.straighten) * Math.PI) / 180);
  ctx.scale(scale * cover, scale * cover);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas;
}

/** Same maths as the CSS filters used for the preview (brightness → contrast → saturate). */
function adjust(canvas: HTMLCanvasElement, e: Edit) {
  if (!e.brightness && !e.contrast && !e.saturation) return;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const b = 1 + e.brightness / 100;
  const c = 1 + e.contrast / 100;
  const s = 1 + e.saturation / 100;
  const m = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] * b;
    let g = px[i + 1] * b;
    let bl = px[i + 2] * b;
    r = (r - 127.5) * c + 127.5;
    g = (g - 127.5) * c + 127.5;
    bl = (bl - 127.5) * c + 127.5;
    px[i] = m[0] * r + m[1] * g + m[2] * bl;
    px[i + 1] = m[3] * r + m[4] * g + m[5] * bl;
    px[i + 2] = m[6] * r + m[7] * g + m[8] * bl;
  }
  ctx.putImageData(data, 0, 0);
}

/** Largest centred crop of the given pixel ratio inside a frame of fw × fh. */
function fitAspect(aspect: number | null, fw: number, fh: number): Crop {
  if (!aspect) return FULL;
  const r = (aspect * fh) / fw; // the same ratio in frame shares
  return r > 1 ? { x: 0, y: (1 - 1 / r) / 2, w: 1, h: 1 / r } : { x: (1 - r) / 2, y: 0, w: r, h: 1 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function PhotoEditor({ src, open, onClose, onSave }: { src: string; open: boolean; onClose: () => void; onSave: (file: File) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<Edit>(START);
  const [tab, setTab] = useState<"crop" | "light">("crop");
  const [param, setParam] = useState<"brightness" | "contrast" | "saturation">("brightness");
  const [saving, setSaving] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

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

  // Live preview: the frame at screen size; colour changes are a CSS filter on top.
  useLayoutEffect(() => {
    const target = preview.current;
    if (!img || !target) return;
    const { w, h } = frameSize(img, edit.quarter);
    const scale = Math.min(1, 900 / Math.max(w, h));
    const frame = renderFrame(img, { ...edit }, scale);
    target.width = frame.width;
    target.height = frame.height;
    target.getContext("2d")!.drawImage(frame, 0, 0);
  }, [img, edit.quarter, edit.straighten, edit.flipH, edit.flipV]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<Edit>) => setEdit((e) => ({ ...e, ...patch }));
  /** Turns and mirrors change the frame: the crop starts over at the chosen ratio. */
  const reframe = (patch: Partial<Edit>) =>
    setEdit((e) => {
      const next = { ...e, ...patch };
      if (!img) return next;
      const { w, h } = frameSize(img, next.quarter);
      return { ...next, crop: fitAspect(next.aspect, w, h) };
    });
  // A turn on a mirrored photo goes the other way round in the photo's own coordinates.
  const turn = (dir: 1 | -1) => reframe({ quarter: (((edit.quarter + (edit.flipH !== edit.flipV ? -dir : dir)) % 4) + 4) % 4 });

  // ---------- crop box dragging ----------
  const drag = useRef<{ mode: string; x: number; y: number; start: Crop } | null>(null);
  /** Pointer down on the box (data-mode="move") or a corner handle (data-mode="nw" …). */
  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: e.currentTarget.dataset.mode ?? "move", x: e.clientX, y: e.clientY, start: edit.crop };
  };
  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      const el = box.current;
      if (!d || !el || !img) return;
      const rect = el.getBoundingClientRect();
      const dx = (e.clientX - d.x) / rect.width;
      const dy = (e.clientY - d.y) / rect.height;
      const s = d.start;
      let c: Crop;
      if (d.mode === "move") c = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
      else {
        // Corner drag: the opposite corner stays put.
        const left = d.mode.includes("w");
        const top = d.mode.includes("n");
        let x0 = left ? clamp(s.x + dx, 0, s.x + s.w - MIN_CROP) : s.x;
        let y0 = top ? clamp(s.y + dy, 0, s.y + s.h - MIN_CROP) : s.y;
        let x1 = left ? s.x + s.w : clamp(s.x + s.w + dx, s.x + MIN_CROP, 1);
        let y1 = top ? s.y + s.h : clamp(s.y + s.h + dy, s.y + MIN_CROP, 1);
        if (edit.aspect) {
          const { w: fw, h: fh } = frameSize(img, edit.quarter);
          const r = (edit.aspect * fh) / fw;
          // Follow the width; the height comes from the ratio, shrunk back if it would leave the frame.
          let w = x1 - x0;
          let h = w / r;
          const room = top ? y1 : 1 - y0;
          if (h > room) {
            h = room;
            w = h * r;
          }
          if (left) x0 = x1 - w;
          else x1 = x0 + w;
          if (top) y0 = y1 - h;
          else y1 = y0 + h;
        }
        c = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      setEdit((e) => ({ ...e, crop: c }));
    },
    [img, edit.aspect, edit.quarter],
  );
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
      adjust(out, edit);
      const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.92));
      onSave(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  // Full screen, like the phone's own photo editor: Esc cancels, the page underneath doesn't scroll.
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

  const filter = `brightness(${1 + edit.brightness / 100}) contrast(${1 + edit.contrast / 100}) saturate(${1 + edit.saturation / 100})`;
  const cropped = edit.crop.x > 0.001 || edit.crop.y > 0.001 || edit.crop.w < 0.999 || edit.crop.h < 0.999;
  const changed = cropped || !!edit.quarter || !!edit.straighten || edit.flipH || edit.flipV || !!edit.brightness || !!edit.contrast || !!edit.saturation;
  const c = edit.crop;
  const light = LIGHT.find(([k]) => k === param)!;

  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Редактировать фото" className="fade-in fixed inset-0 z-[70] flex flex-col bg-[#111113] text-white">
      <div className="flex h-14 shrink-0 items-center justify-between px-2 pt-[env(safe-area-inset-top)] sm:px-4">
        <button type="button" onClick={onClose} className="h-10 rounded-full px-4 text-[15px] text-white/80 hover:bg-white/10">
          Отмена
        </button>
        {changed && (
          <button type="button" onClick={() => setEdit({ ...START, crop: FULL })} className="h-10 rounded-full px-4 text-sm text-white/60 hover:bg-white/10">
            Сбросить
          </button>
        )}
        <button type="button" disabled={!changed || saving || !img} onClick={save} className="flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-[#111113] disabled:opacity-40">
          {saving && <Spinner />} Готово
        </button>
      </div>

      {/* The photo, as large as the screen allows; the dimmed part is what gets cut off. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
        {failed ? (
          <p className="max-w-xs text-center text-white/70">Не получилось открыть фото для редактирования. Попробуйте загрузить его заново.</p>
        ) : !img ? (
          <Spinner className="text-white/60" />
        ) : (
          <div ref={box} className="relative touch-none select-none" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <canvas ref={preview} className="block max-h-[calc(100dvh-17rem)] max-w-[calc(100vw-2rem)] sm:max-w-[min(calc(100vw-4rem),1100px)]" style={{ filter }} />
            <div
              className="pointer-events-none absolute inset-0 bg-black/60"
              style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${c.x * 100}% ${c.y * 100}%,${c.x * 100}% ${(c.y + c.h) * 100}%,${(c.x + c.w) * 100}% ${(c.y + c.h) * 100}%,${(c.x + c.w) * 100}% ${c.y * 100}%,${c.x * 100}% ${c.y * 100}%)` }}
            />
            {tab === "crop" && (
              <div
                data-mode="move"
                onPointerDown={onDown}
                className="absolute cursor-move outline outline-1 outline-white/90"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
              >
                {/* Rule-of-thirds guides. */}
                <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/40" />
                <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/40" />
                <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/40" />
                <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/40" />
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
            <Dial label="Выровнять" value={edit.straighten} min={-15} max={15} step={0.5} unit="°" onChange={(v) => update({ straighten: v })} />
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
                <ToolButton label="Отразить по горизонтали" active={edit.flipH} onClick={() => reframe({ flipH: !edit.flipH })}>
                  <path d="M12 3v18" strokeDasharray="2 2" />
                  <path d="M9 7 4 17h5Z" />
                  <path d="m15 7 5 10h-5Z" />
                </ToolButton>
                <ToolButton label="Отразить по вертикали" active={edit.flipV} onClick={() => reframe({ flipV: !edit.flipV })}>
                  <path d="M3 12h18" strokeDasharray="2 2" />
                  <path d="M7 9 17 4v5Z" />
                  <path d="m7 15 10 5v-5Z" />
                </ToolButton>
              </div>
              <div className="no-scrollbar flex gap-1 overflow-x-auto">
                {ASPECTS.map(([label, a]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => reframe({ aspect: a })}
                    className={clsx("h-9 shrink-0 rounded-full px-3 text-[13px] font-medium", edit.aspect === a ? "bg-white text-[#111113]" : "text-white/70 hover:bg-white/10")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <Dial label={light[1]} value={edit[light[0]]} min={-50} max={50} onChange={(v) => update({ [light[0]]: v })} />
            <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:justify-center">
              <button type="button" onClick={() => update({ brightness: 6, contrast: 10, saturation: 12 })} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-white/80 hover:bg-white/10">
                ✨ Авто
              </button>
              {LIGHT.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setParam(k)}
                  className={clsx("relative h-9 shrink-0 rounded-full px-3 text-[13px] font-medium", param === k ? "bg-white text-[#111113]" : "text-white/70 hover:bg-white/10")}
                >
                  {label}
                  {edit[k] !== 0 && param !== k && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#e8b04b]" aria-hidden />}
                </button>
              ))}
            </div>
          </>
        )}
        <div role="tablist" className="mx-auto flex gap-6 text-[13px] font-semibold uppercase tracking-[0.12em]">
          {(
            [
              ["crop", "Кадр"],
              ["light", "Свет"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={clsx("py-1", tab === id ? "text-[#e8b04b]" : "text-white/50 hover:text-white/80")}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const LIGHT = [
  ["brightness", "Яркость"],
  ["contrast", "Контраст"],
  ["saturation", "Насыщенность"],
] as const;

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick} className={clsx("grid size-11 place-items-center rounded-full", active ? "bg-white text-[#111113]" : "text-white/80 hover:bg-white/10")}>
      <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** One adjustment at a time: its name and value over a slider with a centre mark; tap the value to reset. */
function Dial({ label, value, min, max, step = 1, unit = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-center gap-2 text-[13px]">
        <span className="uppercase tracking-[0.12em] text-white/50">{label}</span>
        <button type="button" onClick={() => onChange(0)} title="Сбросить" className={clsx("tabular font-semibold", value ? "text-[#e8b04b]" : "text-white/80")}>
          {value > 0 ? "+" : ""}
          {value}
          {unit}
        </button>
      </div>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-white/40" />
        <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="relative w-full accent-[#e8b04b]" />
      </div>
    </div>
  );
}
