import clsx from "clsx";

/**
 * Nefuda 値札, a shop's paper price tag: a kraft card with a punched eyelet, tied on with a cinnabar thread,
 * hanging slightly askew. The head (cut corners, eyelet, thread) keeps its shape; the body stretches with the text.
 * The price is real text (selectable, read by screen readers).
 */
/** `longThread`: the thread runs well past the left side, for tags pinned near a photo edge that clips it there. */
export function Nefuda({ children, className, longThread }: { children: React.ReactNode; className?: string; longThread?: boolean }) {
  const edge = "color-mix(in srgb, var(--kraft-ink) 20%, transparent)";
  return (
    <span className={clsx("relative inline-flex origin-left -rotate-2 items-stretch", className)}>
      <svg viewBox="0 0 44 80" preserveAspectRatio="none" className="-mr-px w-[1.1em] shrink-0 overflow-visible" aria-hidden>
        {/* The thread is looped through the eyelet: one strand runs behind the card (seen through the hole and
            past the edge), the other comes out of the hole over the front. */}
        <path d={longThread ? "M24 40C8 47 -12 62 -70 72" : "M24 40C10 46 0 60 -16 66"} fill="none" stroke="var(--shu)" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d="M44 1H16L2 15V65L16 79H44ZM30.5 40A6.5 5.5 0 1 0 17.5 40A6.5 5.5 0 1 0 30.5 40Z" fill="var(--kraft)" fillRule="evenodd" />
        <path d="M44 1H16L2 15V65L16 79H44" fill="none" stroke={edge} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <ellipse cx="24" cy="40" rx="8.5" ry="7.5" fill="none" stroke={edge} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <ellipse cx="24" cy="40" rx="6.5" ry="5.5" fill="none" stroke={edge} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={longThread ? "M23 41C8 30 -12 14 -70 2" : "M23 41C10 30 2 16 -14 8"} fill="none" stroke="var(--shu)" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The card is as tall as its head; the figures sit centred on it (a 1em line, nudged for cap height vs. descenders). */}
      <span className="relative flex items-center rounded-r-[6px] bg-kraft pl-[0.25em] pr-[0.6em] pt-[0.07em] leading-none text-kraft-ink" style={{ boxShadow: `inset 0 1px 0 ${edge}, inset -1px 0 0 ${edge}, inset 0 -1px 0 ${edge}` }}>
        {children}
      </span>
    </span>
  );
}
