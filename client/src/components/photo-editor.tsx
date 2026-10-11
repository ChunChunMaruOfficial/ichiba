"use client";

import clsx from "clsx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Modal, Spinner } from "./ui";

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

  const filter = `brightness(${1 + edit.brightness / 100}) contrast(${1 + edit.contrast / 100}) saturate(${1 + edit.saturation / 100})`;
  const cropped = edit.crop.x > 0.001 || edit.crop.y > 0.001 || edit.crop.w < 0.999 || edit.crop.h < 0.999;
  const changed = cropped || !!edit.quarter || !!edit.straighten || edit.flipH || edit.flipV || !!edit.brightness || !!edit.contrast || !!edit.saturation;
  const c = edit.crop;

  return (
    <Modal open={open} onClose={onClose} title="Редактировать фото" width="max-w-2xl">
      {failed ? (
        <p className="py-10 text-center text-ink-2">Не получилось открыть фото для редактирования. Попробуйте загрузить его заново.</p>
      ) : !img ? (
        <div className="grid h-72 place-items-center text-muted">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Photo with the crop box; the dimmed part is what gets cut off. */}
          <div className="grid place-items-center rounded-2xl bg-ink/5 p-3">
            <div ref={box} className="relative max-w-full touch-none select-none" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <canvas ref={preview} className="block max-h-[48vh] max-w-full" style={{ filter }} />
              {/* What gets cut off stays dimmed on both tabs; the box and handles only on «Кадр». */}
              <div className="pointer-events-none absolute inset-0 bg-black/45" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${c.x * 100}% ${c.y * 100}%,${c.x * 100}% ${(c.y + c.h) * 100}%,${(c.x + c.w) * 100}% ${(c.y + c.h) * 100}%,${(c.x + c.w) * 100}% ${c.y * 100}%,${c.x * 100}% ${c.y * 100}%)` }} />
              {tab === "crop" && (
                <>
                  <div
                    className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]"
                    style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                    data-mode="move"
                    onPointerDown={onDown}
                  >
                    {/* Rule-of-thirds guides. */}
                    <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/50" />
                    <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/50" />
                    <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/50" />
                    <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/50" />
                    {(["nw", "ne", "sw", "se"] as const).map((k) => (
                      <span
                        key={k}
                        aria-hidden
                        data-mode={k}
                        onPointerDown={onDown}
                        className={clsx(
                          "absolute size-7 touch-none",
                          k.includes("n") ? "-top-3.5" : "-bottom-3.5",
                          k.includes("w") ? "-left-3.5" : "-right-3.5",
                          k === "nw" || k === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize",
                        )}
                      >
                        <span className="absolute inset-2 rounded-full border-2 border-ink bg-white" />
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div role="tablist" className="flex gap-1 rounded-full bg-ink/5 p-1 text-sm">
            {(
              [
                ["crop", "Кадр"],
                ["light", "Свет и цвет"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={clsx("h-9 flex-1 rounded-full font-medium", tab === id ? "bg-surface text-ink shadow-sm" : "text-ink-2")}>
                {label}
              </button>
            ))}
          </div>

          {tab === "crop" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {ASPECTS.map(([label, a]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => reframe({ aspect: a })}
                    className={clsx("h-9 rounded-full px-3.5 text-sm", edit.aspect === a ? "bg-ink text-accent-ink" : "shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-ink/5")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
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
              <Slider label="Выровнять горизонт" value={edit.straighten} min={-15} max={15} step={0.5} unit="°" onChange={(v) => update({ straighten: v })} />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => update({ brightness: 6, contrast: 10, saturation: 12 })}>
                ✨ Авто-улучшение
              </Button>
              <Slider label="Яркость" value={edit.brightness} min={-50} max={50} onChange={(v) => update({ brightness: v })} />
              <Slider label="Контраст" value={edit.contrast} min={-50} max={50} onChange={(v) => update({ contrast: v })} />
              <Slider label="Насыщенность" value={edit.saturation} min={-50} max={50} onChange={(v) => update({ saturation: v })} />
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" size="sm" disabled={!changed} onClick={() => setEdit({ ...START, crop: FULL })}>
              Сбросить
            </Button>
            <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
              Отмена
            </Button>
            <Button type="button" loading={saving} disabled={!changed} onClick={save}>
              Сохранить
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={clsx("grid size-11 place-items-center rounded-full", active ? "bg-ink text-accent-ink" : "shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-ink/5")}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function Slider({ label, value, min, max, step = 1, unit = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex justify-between">
        <span className="text-ink-2">{label}</span>
        <button type="button" className="tabular text-muted hover:text-ink" onClick={() => onChange(0)} title="Сбросить">
          {value > 0 ? "+" : ""}
          {value}
          {unit}
        </button>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </label>
  );
}
