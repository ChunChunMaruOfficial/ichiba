import clsx from "clsx";

const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八"];

/**
 * A block of a long form on washi: a brushed kanji down the side with a numbered title, the fields beside it.
 * Blocks rise into place one after another (`index` staggers them).
 */
export function FormSection({ kanji, title, index = 0, className, children }: { kanji: string; title: string; index?: number; className?: string; children: React.ReactNode }) {
  return (
    <section
      className={clsx("rise relative border-t border-line pt-8 focus-within:z-20 md:grid md:grid-cols-[176px_minmax(0,1fr)] md:gap-10 md:pt-10", className)}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* the big kanji as a faint watermark on the right; the fields keep clear of it (clipped here, so the sticky header still follows the page) */}
      <span aria-hidden className="pointer-events-none absolute inset-0 select-none overflow-hidden">
        <span className="absolute right-0 top-4 font-brush text-[140px] leading-none text-ink opacity-[0.035]">{kanji}</span>
      </span>
      <header className="mb-6 flex items-start gap-3 md:sticky md:top-28 md:mb-0 md:self-start">
        <span aria-hidden className="font-brush text-[28px] leading-none text-shu [writing-mode:vertical-rl]">
          {kanji}
        </span>
        <div>
          <p aria-hidden className="font-brush text-sm leading-none text-muted">
            {NUMERALS[index] ?? index + 1}
          </p>
          <h2 className="mt-1.5 text-xl font-bold leading-tight">{title}</h2>
        </div>
      </header>
      <div className="relative flex min-w-0 flex-col gap-7 lg:pr-56">{children}</div>
    </section>
  );
}
