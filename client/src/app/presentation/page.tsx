import { TitleWithKanji } from "@/components/sections";
import type { Metadata } from "next";
import { og } from "@/lib/og";
import { SLIDES, slideId, slideSrc } from "@/lib/presentation";

export const metadata: Metadata = {
  title: "Презентация ichiba",
  description: "Презентация ichiba — маркетплейса одежды Беларуси: какую проблему решаем, что видим на рынке локальных брендов, как устроены поиск, пошив по меркам, сделка и монетизация.",
  alternates: { canonical: "/presentation" },
  openGraph: og("/presentation", {
    title: "Презентация ichiba",
    description: "Как устроен маркетплейс открытых гардеробов Беларуси и что он даёт продавцам, покупателям и локальным брендам.",
    images: [{ url: slideSrc(1), width: 1600, height: 900, alt: SLIDES[0].alt }],
  }),
};

/**
 * The company deck (lib/presentation.ts) as a list of slides, one under another: each has its own anchor, so the
 * footer links straight to a slide. The alt text carries what the slide says, for screen readers and search.
 */
export default function PresentationPage() {
  return (
    <div className="mx-auto max-w-[1120px] px-4 py-8 md:px-6 md:py-12">
      <TitleWithKanji kanji="市場">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Презентация ichiba</h1>
      </TitleWithKanji>

      <ol className="mt-8 flex flex-col gap-10">
        {SLIDES.map((s) => (
          <li key={s.n} id={slideId(s.n)} className="scroll-mt-24">
            <figure>
              {/* Static WebP already sized for the column: next/image would only re-encode it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slideSrc(s.n)}
                alt={s.alt}
                width={1600}
                height={900}
                loading={s.n === 1 ? "eager" : "lazy"}
                fetchPriority={s.n === 1 ? "high" : undefined}
                className="h-auto w-full rounded-[18px] bg-surface-sunk shadow-[var(--shadow-paper)]"
              />
              <figcaption className="mt-3 text-sm text-muted">
                <span className="tabular">{String(s.n).padStart(2, "0")}</span> · {s.title}
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>
    </div>
  );
}
