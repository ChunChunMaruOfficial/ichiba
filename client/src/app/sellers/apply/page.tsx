"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BrandApplicationPage } from "@/components/brand-application";
import { RequireAuth } from "@/components/require-auth";
import { TitleWithKanji } from "@/components/sections";
import { Spinner } from "@/components/ui";

/** /sellers/apply: the brand's or the original-items shop's form; ?kind=CATALOG opens it on «Магазин оригиналов». */
export default function ApplyPage() {
  return (
    <div className="mx-auto max-w-[860px] px-4 pb-16 pt-4 md:px-6">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-muted">
        <Link href="/sellers" className="hover:text-ink">
          Открыть лавку
        </Link>{" "}
        / <span className="text-ink-2">Анкета</span>
      </nav>
      <header className="mb-8">
        <TitleWithKanji kanji="商い">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Анкета бренда или магазина</h1>
        </TitleWithKanji>
        <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-2">Расскажите о себе и дайте ссылку на соцсеть или сайт. Проверим за пару дней — ответ придёт на почту.</p>
      </header>
      <Suspense
        fallback={
          <div className="flex justify-center py-16 text-muted">
            <Spinner />
          </div>
        }
      >
        <RequireAuth reason="чтобы заполнить анкету бренда">{(me) => <WithKind me={me} />}</RequireAuth>
      </Suspense>
    </div>
  );
}

function WithKind({ me }: { me: Parameters<typeof BrandApplicationPage>[0]["me"] }) {
  const kind = useSearchParams().get("kind") === "CATALOG" ? "CATALOG" : "BRAND";
  return <BrandApplicationPage me={me} initialKind={kind} />;
}
