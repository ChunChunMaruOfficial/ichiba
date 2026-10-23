import clsx from "clsx";
import type { ReactNode } from "react";

/** Where each cell sits for 1–4 photos: the frame is always filled, never an empty grey cell. */
const LAYOUT: Record<number, string[]> = {
  1: ["col-span-2 row-span-2"],
  2: ["row-span-2", "row-span-2"],
  3: ["row-span-2", "", ""],
  4: ["", "", "", ""],
};

/**
 * A square-ish 2×2 frame for up to four photos that adapts to how many there are: one fills it, two split it,
 * three are one tall and two small. `cells` are the photos already drawn; with none, `empty` is shown.
 */
export function Collage({ cells, empty, className, cellClassName }: { cells: ReactNode[]; empty?: ReactNode; className?: string; cellClassName?: string }) {
  const shown = cells.slice(0, 4);
  return (
    <div className={clsx("grid grid-cols-2 grid-rows-2 gap-1 overflow-hidden", className)}>
      {shown.length ? (
        shown.map((cell, i) => (
          <div key={i} className={clsx("min-h-0 min-w-0 overflow-hidden bg-skeleton", LAYOUT[shown.length][i], cellClassName)}>
            {cell}
          </div>
        ))
      ) : (
        <div className="col-span-2 row-span-2 min-h-0 bg-skeleton">{empty}</div>
      )}
    </div>
  );
}
