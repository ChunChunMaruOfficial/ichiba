"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal, Spinner } from "./ui";

/**
 * The profile photo's crop, in a popup: the photo under a round window (the avatar is round everywhere on the
 * site), dragged to frame the face and zoomed with the slider or the wheel. «Сохранить» renders the window at
 * 640 × 640 into a JPEG and hands it back as a File for a normal upload. Nothing else: no turns, no drawing.
 */

const OUT = 640;
const MAX_ZOOM = 3;

export function AvatarCropper({ src, open, onClose, onSave }: { src: string; open: boolean; onClose: () => void; onSave: (file: File) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  /** The photo's shift from the centre, in window pixels. */
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  /** The window's side on screen, measured: the popup's whole width, less on a narrow phone. */
  const [side, setSide] = useState(336);

  useEffect(() => {
    if (!open) return;
    const el = new Image();
    // Stored photos come from the media host (CORS on): without this the canvas could not be exported.
    if (!src.startsWith("blob:") && !src.startsWith("data:")) el.crossOrigin = "anonymous";
    el.onload = () => setImg(el);
    el.onerror = () => setFailed("Не получилось открыть фото. Попробуйте выбрать его заново.");
    el.src = src;
    return () => {
      el.onload = null;
      el.onerror = null;
    };
  }, [src, open]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSide(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  if (!open) return null;

  // The photo covers the window at zoom 1; a shift never shows the window's edge past the photo.
  const base = img ? side / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = base * zoom;
  const shown = img ? { w: img.naturalWidth * scale, h: img.naturalHeight * scale } : { w: side, h: side };
  const clampOffset = (o: { x: number; y: number }, z = zoom) => {
    if (!img) return o;
    const s = base * z;
    const mx = Math.max(0, (img.naturalWidth * s - side) / 2);
    const my = Math.max(0, (img.naturalHeight * s - side) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };
  const setZoomAt = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    // Zooming keeps the point under the window's centre where it is.
    setOffset((o) => clampOffset({ x: (o.x * next) / zoom, y: (o.y * next) / zoom }, next));
    setZoom(next);
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (e.pointerType === "mouse" && !(e.buttons & 1)) {
      drag.current = null;
      return;
    }
    setOffset(clampOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
  };
  const onUp = () => (drag.current = null);

  const save = async () => {
    if (!img) return;
    setSaving(true);
    const out = document.createElement("canvas");
    try {
      out.width = out.height = OUT;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("Не хватает памяти для обработки фото. Закройте другие вкладки и попробуйте снова");
      const k = OUT / side;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (OUT - shown.w * k) / 2 + offset.x * k, (OUT - shown.h * k) / 2 + offset.y * k, shown.w * k, shown.h * k);
      const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.9));
      onSave(new File([blob], "avatar.jpg", { type: "image/jpeg" }));
    } catch (err) {
      setFailed(err instanceof Error && err.message.startsWith("Не хватает") ? err.message : "Не получилось сохранить фото. Попробуйте ещё раз.");
    } finally {
      out.width = out.height = 0;
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Фото профиля" width="max-w-sm">
      <div className="flex flex-col items-center gap-5">
        {failed ? (
          <p role="alert" className="py-6 text-center text-sm text-ink-2">
            {failed}
          </p>
        ) : (
          <div
            ref={frame}
            className="relative aspect-square w-full cursor-grab touch-none select-none overflow-hidden rounded-[22px] bg-skeleton active:cursor-grabbing"
            onPointerDown={img ? onDown : undefined}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
            onWheel={(e) => setZoomAt(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          >
            {!img ? (
              <span className="absolute inset-0 grid place-items-center">
                <Spinner className="text-muted" />
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
                style={{ width: shown.w, height: shown.h, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
              />
            )}
            {/* The round window: everything outside it is dimmed and will be cut off. */}
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(28_26_23/0.55)] ring-1 ring-inset ring-white/70" />
          </div>
        )}
        {!failed && <input type="range" aria-label="Масштаб" min={1} max={MAX_ZOOM} step={0.01} value={zoom} disabled={!img} onChange={(e) => setZoomAt(Number(e.target.value))} className="w-full accent-[var(--shu)]" />}
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={saving} disabled={!img || !!failed} onClick={save}>
            Сохранить
          </Button>
        </div>
      </div>
    </Modal>
  );
}
