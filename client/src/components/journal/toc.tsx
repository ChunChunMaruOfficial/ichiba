"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import type { Heading } from "@/lib/journal";

/**
 * The article's outline: sticky beside the text on wide screens, a folding list under the lead on narrow ones.
 * The heading on screen is underlined in indigo; the list itself is plain links, so it works before hydration.
 */
export function Toc({ headings, className }: { headings: Heading[]; className?: string }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!headings.length) return;
    const els = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => !!el);
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = headings.find((h) => visible.has(h.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [headings]);
  if (headings.length < 2) return null;
  return (
    <nav aria-label="Содержание" className={className}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Содержание</p>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {headings.map((h) => (
          <li key={h.id} className={clsx(h.depth === 3 && "pl-4")}>
            <a
              href={`#${h.id}`}
              className={clsx("block leading-snug transition-colors hover:text-ink", active === h.id ? "text-ink underline decoration-indigo underline-offset-4" : "text-ink-2")}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The same outline folded under the lead on phones. */
export function TocMobile({ headings }: { headings: Heading[] }) {
  if (headings.length < 2) return null;
  return (
    <details className="rounded-2xl bg-surface px-5 py-3 lg:hidden">
      <summary className="cursor-pointer list-none text-sm font-medium [&::-webkit-details-marker]:hidden">Содержание</summary>
      <ol className="mt-3 flex flex-col gap-2 pb-1 text-sm">
        {headings.map((h) => (
          <li key={h.id} className={clsx(h.depth === 3 && "pl-4")}>
            <a href={`#${h.id}`} className="block leading-snug text-ink-2 hover:text-ink">
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
