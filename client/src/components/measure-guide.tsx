"use client";

import clsx from "clsx";
import { useState } from "react";
import type { ListingValues } from "@/lib/listing-form";
import type { MeasurementKey } from "@/lib/types";
import { Input } from "./ui";

type Kind = "top" | "dress" | "bottom" | "skirt" | "shoes";

const LABEL: Record<MeasurementKey, string> = {
  shoulders: "Плечи",
  chest: "Грудь (ПОГ)",
  waist: "Талия",
  hips: "Бёдра",
  length: "Длина",
  sleeve: "Рукав",
  inseam: "Шаговый шов",
  foot_length: "Длина стельки",
};

/** How to measure each field, shown while it's focused. */
const HOW: Record<MeasurementKey, string> = {
  shoulders: "От шва до шва по плечам, по прямой",
  chest: "Подмышка до подмышки в разложенном виде — полуобхват",
  waist: "По поясу от края до края в разложенном виде",
  hips: "По самой широкой части, от края до края",
  length: "От верхней точки (у ворота или пояса) до низа",
  sleeve: "От плечевого шва до края манжеты",
  inseam: "От шва в паху до низа штанины",
  foot_length: "Достаньте стельку и измерьте от пятки до носка",
};

const FIELDS: Record<Kind, MeasurementKey[]> = {
  top: ["shoulders", "chest", "length", "sleeve"],
  dress: ["shoulders", "chest", "waist", "length"],
  bottom: ["waist", "hips", "length", "inseam"],
  skirt: ["waist", "hips", "length"],
  shoes: ["foot_length"],
};

export function measureKind(category: string | null): Kind | null {
  if (!category) return null;
  if (["trousers", "jeans", "shorts"].includes(category)) return "bottom";
  if (category === "skirts") return "skirt";
  if (category === "dresses") return "dress";
  if (category === "shoes") return "shoes";
  if (["bags", "accessories"].includes(category)) return null;
  return "top";
}

/** Arrow with end ticks; highlighted when its field is active. */
function Arrow({ d, active }: { d: [number, number, number, number]; active: boolean }) {
  const [x1, y1, x2, y2] = d;
  const nx = y2 - y1;
  const ny = x1 - x2;
  const len = Math.hypot(nx, ny) || 1;
  const tx = (nx / len) * 4;
  const ty = (ny / len) * 4;
  return (
    <g className={clsx("transition-colors", active ? "text-accent" : "text-muted")} stroke="currentColor" strokeWidth={active ? 2.4 : 1.4} strokeLinecap="round">
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray={active ? undefined : "3 3"} />
      <line x1={x1 - tx} y1={y1 - ty} x2={x1 + tx} y2={y1 + ty} />
      <line x1={x2 - tx} y1={y2 - ty} x2={x2 + tx} y2={y2 + ty} />
    </g>
  );
}

const ARROWS: Record<Kind, Partial<Record<MeasurementKey, [number, number, number, number]>>> = {
  top: { shoulders: [44, 26, 116, 26], chest: [46, 58, 114, 58], length: [130, 18, 130, 148], sleeve: [118, 26, 152, 84] },
  dress: { shoulders: [52, 22, 108, 22], chest: [50, 50, 110, 50], waist: [56, 78, 104, 78], length: [134, 16, 134, 152] },
  bottom: { waist: [48, 18, 112, 18], hips: [44, 46, 116, 46], length: [130, 14, 130, 152], inseam: [84, 64, 96, 150] },
  skirt: { waist: [54, 22, 106, 22], hips: [46, 52, 114, 52], length: [128, 20, 128, 130] },
  shoes: { foot_length: [52, 150, 108, 16] },
};

function Silhouette({ kind }: { kind: Kind }) {
  const common = { fill: "var(--surface)", stroke: "var(--ink-2)", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  if (kind === "top") return <path {...common} d="M60 18 Q80 30 100 18 L120 24 L154 78 L136 90 L118 62 L118 148 L42 148 L42 62 L24 90 L6 78 L40 24 Z" />;
  if (kind === "dress") return <path {...common} d="M64 14 Q80 26 96 14 L110 20 L112 52 L104 78 L126 152 L34 152 L56 78 L48 52 L50 20 Z" />;
  if (kind === "bottom") return <path {...common} d="M46 14 L114 14 L120 150 L94 150 L82 66 L78 66 L66 150 L40 150 Z" />;
  if (kind === "skirt") return <path {...common} d="M54 18 L106 18 L124 130 L36 130 Z" />;
  return <path {...common} d="M80 10 C102 10 112 36 110 70 C108 104 104 128 96 146 C90 158 66 158 62 146 C54 124 48 96 50 64 C52 34 60 10 80 10 Z" />;
}

/**
 * Measurement inputs with a garment diagram (Depop/Grailed): only the measurements that make sense for the
 * category, and the arrow for the focused field is highlighted with a one-line "how to measure".
 */
export function MeasureFields({ values, set }: { values: ListingValues; set: (patch: Partial<ListingValues>) => void }) {
  const kind = measureKind(values.category);
  const [active, setActive] = useState<MeasurementKey | null>(null);
  if (!kind) return null;
  const fields = FIELDS[kind];
  const shown = active && fields.includes(active) ? active : fields[0];
  return (
    <div className="grid items-start gap-4 sm:grid-cols-[160px_1fr]">
      <svg viewBox="0 0 160 160" className="mx-auto w-36 sm:w-40" aria-hidden>
        <Silhouette kind={kind} />
        {fields.map((f) => ARROWS[kind][f] && <Arrow key={f} d={ARROWS[kind][f]!} active={f === shown} />)}
      </svg>
      <div className="flex flex-col gap-3">
        <div className={clsx("grid gap-3", fields.length > 1 ? "grid-cols-2" : "max-w-48 grid-cols-1")}>
          {fields.map((k) => (
            <label key={k} className={clsx("flex flex-col gap-1 text-xs", k === shown ? "text-accent" : "text-muted")}>
              {LABEL[k]}
              <Input
                inputMode="decimal"
                value={values.measurements[k] ?? ""}
                onFocus={() => setActive(k)}
                onChange={(e) => set({ measurements: { ...values.measurements, [k]: e.target.value.replace(",", ".").replace(/[^\d.]/g, "").slice(0, 5) } })}
                className="h-10 px-2.5"
                placeholder="см"
              />
            </label>
          ))}
        </div>
        <p className="rounded-xl bg-paper px-3 py-2 text-sm text-ink-2">
          <span className="font-medium text-ink">{LABEL[shown]}:</span> {HOW[shown].toLowerCase()}
        </p>
      </div>
    </div>
  );
}

export const MEASURE_LABEL = LABEL;
