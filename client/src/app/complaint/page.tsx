import type { Metadata } from "next";
import Link from "next/link";
import { ComplaintForm } from "@/components/complaint-form";
import { TitleWithKanji } from "@/components/sections";
import { LEGAL } from "@/lib/legal";
import { og } from "@/lib/og";

export const metadata: Metadata = {
  title: "Жалобы и обращения",
  description: "Жалоба на сделку, продавца или работу сайта ichiba: напишите — ответим на почту в течение 15 дней.",
  alternates: { canonical: "/complaint" },
  openGraph: og("/complaint", { title: "Жалобы и обращения · ichiba", description: "Жалоба на сделку, продавца или работу сайта: ответим на почту в течение 15 дней." }),
};

/**
 * «Жалобы и обращения»: the electronic complaint form with an answer (Правила дистанционной торговли, п. 14.4), and
 * beside it the faster ways for what has its own button.
 */
export default function ComplaintPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12">
      <header className="max-w-3xl">
        <TitleWithKanji kanji="申立">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Жалобы и обращения</h1>
        </TitleWithKanji>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Если что-то пошло не так со сделкой, продавцом или сайтом, расскажите. Каждое обращение получает номер, а ответ придёт на почту в течение 15 дней, обычно быстрее.
        </p>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1fr)_18rem] lg:gap-16">
        <div className="max-w-2xl">
          <ComplaintForm />
        </div>

        <aside className="flex flex-col gap-5 text-[15px] leading-relaxed text-ink-2 md:pt-1">
          <p className="text-sm font-semibold text-ink">Иногда быстрее так</p>
          <p>
            <b className="font-semibold text-ink">Спор по сделке</b> — прямо в ней, в{" "}
            <Link href="/purchases" className="underline underline-offset-4 hover:text-ink">
              «Покупках»
            </Link>{" "}
            или{" "}
            <Link href="/sales" className="underline underline-offset-4 hover:text-ink">
              «Продажах»
            </Link>
            : модератор видит переписку и решает быстрее.
          </p>
          <p>
            <b className="font-semibold text-ink">Вещь, профиль или сообщение</b> — кнопка «Пожаловаться» рядом с ними.
          </p>
          <p>
            <b className="font-semibold text-ink">Позвонить</b> —{" "}
            <a href={LEGAL.complaintsPhone.href} className="whitespace-nowrap underline underline-offset-4 hover:text-ink">
              {LEGAL.complaintsPhone.shown}
            </a>
            , {LEGAL.hours.shown}.
          </p>
          <p className="border-t border-line pt-5 text-sm text-muted">
            Как мы разбираем жалобы и что отвечает продавец, а что ichiba, — в{" "}
            <Link href="/rules#complaints" className="underline underline-offset-4 hover:text-ink">
              Правилах площадки
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  );
}
