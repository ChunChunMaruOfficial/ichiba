import { TitleWithKanji } from "@/components/sections";
import type { Metadata } from "next";
import Link from "next/link";
import { jsonLd, SITE_URL } from "@/lib/server";
import { LEGAL, operatorLine } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Контакты",
  description: "Как связаться с ichiba — маркетплейсом одежды в Беларуси: почта, вопросы по сделкам, жалобы и сотрудничество с брендами.",
  alternates: { canonical: "/contacts" },
};

/**
 * Who runs ichiba and how to reach them: what buyers look for before trusting a shop, and the page Yandex Webmaster
 * takes as proof of the site's region (Беларусь).
 */
export default function ContactsPage() {
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ichiba",
    url: SITE_URL,
    email: LEGAL.email,
    ...(LEGAL.operator ? { legalName: LEGAL.operator } : {}),
    ...(LEGAL.unp ? { taxID: LEGAL.unp } : {}),
    address: { "@type": "PostalAddress", addressCountry: "BY", ...(LEGAL.address ? { streetAddress: LEGAL.address } : {}) },
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(organization)} />
      <TitleWithKanji kanji="連絡">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Контакты</h1>
      </TitleWithKanji>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">ichiba — маркетплейс одежды, обуви и аксессуаров из гардеробов людей и от брендов Беларуси.</p>

      <dl className="mt-8 grid gap-6 text-[15px] leading-relaxed text-ink-2 sm:grid-cols-[12rem_1fr]">
        <dt className="font-semibold text-ink">Почта</dt>
        <dd>
          <a href={`mailto:${LEGAL.email}`} className="font-medium text-ink underline underline-offset-4">
            {LEGAL.email}
          </a>
          <br />
          Отвечаем в рабочие дни, обычно в течение суток.
        </dd>

        <dt className="font-semibold text-ink">Вопрос по сделке</dt>
        <dd>
          Пишите продавцу или покупателю в чате сделки — в <Link href="/purchases" className="underline underline-offset-4">«Покупках»</Link> или{" "}
          <Link href="/sales" className="underline underline-offset-4">«Продажах»</Link>. Если договориться не получилось, откройте спор там же: его разберёт модератор.
        </dd>

        <dt className="font-semibold text-ink">Жалоба</dt>
        <dd>На вещь, продавца или сообщение — кнопкой «Пожаловаться» рядом с ними. Модераторы видят жалобу сразу.</dd>

        <dt className="font-semibold text-ink">Брендам</dt>
        <dd>
          Хотите продавать на ichiba как бренд — напишите на почту выше или подайте заявку в <Link href="/settings" className="underline underline-offset-4">настройках</Link> аккаунта.
        </dd>

        <dt className="font-semibold text-ink">Оператор сайта</dt>
        <dd>
          {operatorLine()}
          <br />
          Республика Беларусь
        </dd>
      </dl>

      <p className="mt-10 text-sm text-muted">
        Правила площадки — в <Link href="/terms" className="underline">Пользовательском соглашении</Link>, обработка данных — в{" "}
        <Link href="/privacy" className="underline">Политике конфиденциальности</Link>.
      </p>
    </div>
  );
}
