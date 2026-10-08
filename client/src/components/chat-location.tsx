"use client";

import "leaflet/dist/leaflet.css";
import clsx from "clsx";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CENTER, distance, mapLinks, TILE_ATTRIBUTION, TILE_URL, tilesAround } from "@/lib/map";
import { usePresence } from "@/lib/presence";
import type { ChatLocation } from "@/lib/types";
import { Button, IconLocate, IconPin, Modal } from "./ui";

/**
 * Location messages in chat, as in Telegram: the sender picks a point (their device fix or any spot on the map),
 * the chat shows a small map with the pin, and tapping it opens a full map with links to Yandex/Google Maps.
 */

const PIN_SVG =
  '<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 40.5S2.5 26 2.5 15.5a13.5 13.5 0 0 1 27 0C29.5 26 16 40.5 16 40.5Z" fill="#c8102e" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15.5" r="5" fill="#fff"/></svg>';

const ME_COLOR = "#2f6fdb";

const accuracyText = (m?: number | null) => (m ? `точность ±${m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1)} км`}` : null);

/** Leaflet is loaded on demand (it touches `window` on import) and torn down with the component. */
function useLeaflet(el: React.RefObject<HTMLDivElement | null>, setup: (L: typeof Leaflet, map: Leaflet.Map) => void) {
  const setupRef = useRef(setup);
  useEffect(() => {
    let map: Leaflet.Map | undefined;
    let cancelled = false;
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { attributionControl: true });
      map.attributionControl.setPrefix(false);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      setupRef.current(L, map);
      // The modal animates in; measure again once it has settled.
      setTimeout(() => map?.invalidateSize(), 250);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [el]);
}

const pinIcon = (L: typeof Leaflet) => L.divIcon({ html: PIN_SVG, className: "", iconSize: [32, 42], iconAnchor: [16, 41] });

function drawMe(L: typeof Leaflet, map: Leaflet.Map, p: ChatLocation) {
  const layers: Leaflet.Layer[] = [];
  if (p.accuracy) layers.push(L.circle([p.lat, p.lng], { radius: p.accuracy, color: ME_COLOR, weight: 1, fillColor: ME_COLOR, fillOpacity: 0.12, interactive: false }));
  layers.push(L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2.5, fillColor: ME_COLOR, fillOpacity: 1, interactive: false }));
  layers.forEach((l) => l.addTo(map));
  return layers;
}

// ---------- in the message list ----------

/** A small static map (plain tiles, no library) with the pin in the middle. */
export function LocationBubble({ location, mine, time, onOpen, embedded }: { location: ChatLocation; mine: boolean; time: React.ReactNode; onOpen: () => void; embedded?: boolean }) {
  const w = 248;
  const h = 150;
  const tiles = tilesAround(location.lat, location.lng, 16, w, h);
  const acc = accuracyText(location.accuracy);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Открыть местоположение на карте"
      className={clsx(
        "overflow-hidden text-left",
        // Inside a chat bubble the bubble draws the shape and colour.
        embedded ? "block w-full rounded-xl" : ["rounded-2xl shadow-[inset_0_0_0_1px_var(--line)]", mine ? "self-end rounded-br-md bg-accent text-accent-ink" : "self-start rounded-bl-md bg-surface"],
      )}
    >
      <span className="relative block overflow-hidden bg-skeleton" style={{ width: w, height: h }}>
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element -- map tiles from the tile server, positioned by hand
          <img key={t.key} src={t.src} alt="" width={256} height={256} loading="lazy" draggable={false} className="absolute max-w-none select-none" style={{ left: t.x, top: t.y }} />
        ))}
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full drop-shadow-[0_2px_3px_rgb(0_0_0/0.35)]" dangerouslySetInnerHTML={{ __html: PIN_SVG }} />
      </span>
      <span className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
        <span className="flex items-center gap-1.5 font-medium">
          <IconPin className="size-4" /> Местоположение
        </span>
        <span className={clsx("flex items-center gap-1 text-[11px]", mine ? "text-accent-ink/60" : "text-muted")}>{time}</span>
      </span>
      {acc && <span className={clsx("block px-3 pb-1.5 text-[11px]", mine ? "text-accent-ink/70" : "text-muted")}>{acc}</span>}
    </button>
  );
}

// ---------- full map ----------

export function LocationViewer({ location, title, onClose }: { location: ChatLocation | null; title: string; onClose: () => void }) {
  // Keep the last point on screen while the modal animates out.
  const [shown, setShown] = useState(location);
  if (location && location !== shown) setShown(location);
  const { mounted } = usePresence(!!location);
  if (!mounted || !shown) return null;
  return (
    <Modal open={!!location} onClose={onClose} title={title} width="max-w-2xl">
      <ViewerBody location={shown} />
    </Modal>
  );
}

function ViewerBody({ location }: { location: ChatLocation }) {
  const el = useRef<HTMLDivElement>(null);
  useLeaflet(el, (L, map) => {
    map.setView([location.lat, location.lng], 16);
    if (location.accuracy) L.circle([location.lat, location.lng], { radius: location.accuracy, color: "#c8102e", weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
    L.marker([location.lat, location.lng], { icon: pinIcon(L), keyboard: false }).addTo(map);
  });
  const links = mapLinks(location.lat, location.lng);
  const app = "grid size-12 shrink-0 place-items-center rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)] transition-transform hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_var(--line-control)]";
  return (
    <>
      <div className="relative -mx-6 h-[min(60vh,440px)] overflow-hidden md:mx-0 md:rounded-2xl">
        <div ref={el} className="size-full bg-skeleton" />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <a href={links.route} target="_blank" rel="noreferrer" className="btn-wa btn-wa-ink inline-flex h-12 flex-1 items-center justify-center rounded-xl px-4 text-sm font-semibold">
          Маршрут
        </a>
        <a href={links.yandex} target="_blank" rel="noreferrer" aria-label="Открыть в Яндекс Картах" title="Яндекс Карты" className={app}>
          <YandexMapsIcon />
        </a>
        <a href={links.google} target="_blank" rel="noreferrer" aria-label="Открыть в Google Maps" title="Google Maps" className={app}>
          <GoogleMapsIcon />
        </a>
      </div>
    </>
  );
}

const PIN = "M12 1.5C7.3 1.5 3.5 5.2 3.5 9.8c0 6 7 12 8 12.7.3.2.7.2 1 0 1-.7 8-6.7 8-12.7 0-4.6-3.8-8.3-8.5-8.3Z";

/** Map apps as their recognisable pins: Yandex's red one, Google's four-colour one. */
function YandexMapsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
      <path d={PIN} fill="#fc3f1d" />
      <circle cx="12" cy="9.8" r="3.3" fill="#fff" />
    </svg>
  );
}

function GoogleMapsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
      <defs>
        <clipPath id="gm-pin">
          <path d={PIN} />
        </clipPath>
      </defs>
      <g clipPath="url(#gm-pin)">
        <rect x="0" y="0" width="12" height="10" fill="#1a73e8" />
        <rect x="12" y="0" width="12" height="10" fill="#ea4335" />
        <rect x="0" y="10" width="12" height="14" fill="#34a853" />
        <rect x="12" y="10" width="12" height="14" fill="#fbbc04" />
      </g>
      <circle cx="12" cy="9.8" r="3.3" fill="#fff" />
    </svg>
  );
}

// ---------- picking a point to send ----------

type Status = "locating" | "ok" | "denied" | "unavailable" | "error";

export function LocationPicker({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (p: ChatLocation) => void }) {
  const { mounted } = usePresence(open);
  if (!mounted) return null;
  return (
    <Modal open={open} onClose={onClose} title="Отправить местоположение" width="max-w-2xl">
      <PickerBody onSend={onSend} />
    </Modal>
  );
}

function PickerBody({ onSend }: { onSend: (p: ChatLocation) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ L: typeof Leaflet; map: Leaflet.Map; me: Leaflet.Layer[] } | null>(null);
  const [status, setStatus] = useState<Status>("locating");
  const [fix, setFix] = useState<ChatLocation | null>(null);
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);

  const locate = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || !window.isSecureContext) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        setFix(p);
        setStatus("ok");
        const m = mapRef.current;
        if (m) {
          m.me.forEach((l) => l.remove());
          m.me = drawMe(m.L, m.map, p);
          m.map.setView([p.lat, p.lng], 17);
        }
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };

  useLeaflet(el, (L, map) => {
    map.setView(DEFAULT_CENTER, 12);
    mapRef.current = { L, map, me: [] };
    const sync = () => {
      const c = map.getCenter();
      setCenter([c.lat, c.lng]);
    };
    map.on("move", sync);
    sync();
    locate();
  });

  // The pin marks the map centre; at the device fix the point carries its accuracy, anywhere else it's a picked spot.
  const atFix = !!fix && distance(center, [fix.lat, fix.lng]) < 8;
  const point: ChatLocation = atFix && fix ? fix : { lat: center[0], lng: center[1] };
  const hint: Record<Status, string> = {
    locating: "Определяем, где вы…",
    ok: atFix ? `Вы здесь — ${accuracyText(fix?.accuracy)}. Сдвиньте карту, чтобы выбрать другое место` : "Отправится точка под меткой",
    denied: "Доступ к геолокации запрещён — разрешите его в настройках браузера или выберите точку на карте",
    unavailable: "Браузер не может определить местоположение — выберите точку на карте",
    error: "Не удалось определить местоположение — выберите точку на карте или попробуйте ещё раз",
  };

  return (
    <>
      <div className="relative -mx-6 h-[min(60vh,440px)] overflow-hidden md:mx-0 md:rounded-2xl">
        <div ref={el} className="size-full bg-skeleton" />
        {/* The pin stays in the middle while the map moves under it. */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-full drop-shadow-[0_3px_4px_rgb(0_0_0/0.35)]" dangerouslySetInnerHTML={{ __html: PIN_SVG }} />
        <button
          type="button"
          onClick={locate}
          aria-label="Где я"
          className={clsx("on-photo absolute bottom-4 right-4 z-[1000] grid size-11 place-items-center rounded-full", atFix ? "text-[#2f6fdb]" : "text-ink")}
        >
          <IconLocate className={clsx("size-5", status === "locating" && "animate-pulse")} />
        </button>
      </div>
      <p className="mt-3 min-h-10 text-sm text-ink-2" aria-live="polite">
        {hint[status]}
      </p>
      <Button size="lg" block className="mt-2" onClick={() => onSend(point)}>
        {atFix ? "Отправить моё местоположение" : "Отправить эту точку"}
      </Button>
    </>
  );
}
