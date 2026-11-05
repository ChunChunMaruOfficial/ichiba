import type { Metadata } from "next";
import Link from "next/link";
import { TitleWithKanji } from "@/components/sections";
import { og } from "@/lib/og";

export const metadata: Metadata = {
  title: "Как работает сделка",
  description: "Как купить и продать на ichiba: запрос или предложение цены, ответ продавца за 48 часов, резерв вещи, способ получения, оплата при получении, споры и пошив по меркам.",
  alternates: { canonical: "/how-it-works" },
  openGraph: og("/how-it-works", { title: "Как работает сделка на ichiba", description: "От запроса до «Я получил»: сроки, резерв, контакты, оплата и что делать, если что-то пошло не так." }),
};

/**
 * The deal as the code runs it (server/src/requests): a request or an accepted offer, 48 hours for each answer, the
 * item reserved on acceptance, contacts opened once the way of receiving is chosen, completion by the buyer or
 * 7 days after the handover. Change it here when the flow changes.
 */
const STEPS: Array<[string, string, string]> = [
  ["一", "Запрос или своя цена", "Нажмите «Купить», выберите, как получить вещь — лично или доставкой, — и отправьте запрос. Или предложите свою цену: торг до трёх раундов, на каждый ответ 48 часов."],
  ["二", "Продавец подтверждает", "У продавца 48 часов. Подтвердил — вещь резервируется за вами, запросы других покупателей отклоняются. Не ответил — запрос отменится сам."],
  ["三", "Контакты", "Когда продавец подтвердил и способ получения выбран (после принятой цены — в течение 48 часов), обоим открываются телефоны. До этого общение идёт в чате площадки."],
  ["四", "Передача", "Встречаетесь или продавец отправляет вещь сам и присылает трек-номер. До передачи сделку может отменить любая сторона — резерв снимется."],
  ["五", "«Я получил»", "Подтвердите получение — сделка завершена, можно оставить отзыв. Если забыли, она завершится сама через 7 дней после передачи."],
];

const link = "font-semibold text-ink underline underline-offset-4";

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12">
      <header className="max-w-3xl">
        <TitleWithKanji kanji="渡">
          <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">Как работает сделка</h1>
        </TitleWithKanji>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
          Вся сделка — на площадке: запрос, ответ, резерв, переписка и подтверждение. У каждого шага свой срок, поэтому ничего не зависает.
        </p>
      </header>

      <ol className="mt-10 flex max-w-3xl flex-col gap-6 md:mt-14">
        {STEPS.map(([n, title, text]) => (
          <li key={n} className="flex items-start gap-5">
            <span aria-hidden className="w-9 shrink-0 text-center font-brush text-4xl leading-none text-shu">
              {n}
            </span>
            <div className="flex-1 border-b border-line pb-5">
              <h2 className="text-xl font-bold">{title}</h2>
              <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-14 grid grid-cols-1 gap-4 md:mt-20 md:grid-cols-3">
        <section className="rounded-[28px] bg-surface p-6 shadow-[var(--shadow-paper)]">
          <h2 className="text-xl font-bold">Оплата</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
            Сейчас — при получении, напрямую продавцу. Не переводите предоплату незнакомым: чат предупредит, если вас об этом попросят. Онлайн-оплату делаем как
            безопасную сделку — деньги будут храниться у площадки до «Я получил».
          </p>
        </section>
        <section className="rounded-[28px] bg-surface p-6 shadow-[var(--shadow-paper)]">
          <h2 className="text-xl font-bold">Если что-то не так</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
            Вещь не пришла или не похожа на описание — откройте спор на странице сделки до подтверждения получения. Сделка замрёт, её разберёт модератор.
            Жалобу на продавца или сайт можно отправить{" "}
            <Link href="/complaint" className={link}>
              через форму
            </Link>
            .
          </p>
        </section>
        <section className="rounded-[28px] bg-surface p-6 shadow-[var(--shadow-paper)]">
          <h2 className="text-xl font-bold">Пошив по меркам</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
            Некоторые бренды шьют модель по вашим меркам. На странице такой вещи нажмите «Сшить по моим меркам» — мерки из{" "}
            <Link href="/settings#sizes" className={link}>
              профиля
            </Link>{" "}
            уйдут бренду вместе с заказом, дальше всё как в обычной сделке.
          </p>
        </section>
      </div>

      <p className="mt-10 max-w-3xl text-[15px] leading-relaxed text-ink-2">
        Подробно — в{" "}
        <Link href="/rules" className={link}>
          правилах площадки
        </Link>{" "}
        и{" "}
        <Link href="/terms" className={link}>
          пользовательском соглашении
        </Link>
        . Хотите продавать сами —{" "}
        <Link href="/sellers" className={link}>
          откройте лавку
        </Link>
        .
      </p>
    </div>
  );
}
