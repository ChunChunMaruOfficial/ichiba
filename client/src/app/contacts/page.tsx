import { TitleWithKanji } from "@/components/sections";
import type { Metadata } from "next";
import Link from "next/link";
import { jsonLd, SITE_URL } from "@/lib/server";
import { LEGAL } from "@/lib/legal";
import { og } from "@/lib/og";

export const metadata: Metadata = {
  title: "Контакты",
  description: "Как связаться с ichiba — маркетплейсом одежды в Беларуси: почта, вопросы по сделкам, жалобы и сотрудничество с брендами.",
  alternates: { canonical: "/contacts" },
  openGraph: og("/contacts", { title: "Контакты ichiba", description: "Почта, вопросы по сделкам, жалобы и сотрудничество с брендами — как связаться с ichiba." }),
};

/**
 * Who runs ichiba and how to reach them: what buyers look for before trusting a shop, and the page Yandex Webmaster
 * takes as proof of the site's region (Беларусь).
 */
export default function ContactsPage() {
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    // The same entity as the one every page describes (app/layout.tsx): this page adds its requisites to it.
    "@id": `${SITE_URL}/#organization`,
    name: "ichiba",
    url: SITE_URL,
    email: LEGAL.emailShown,
    telephone: LEGAL.phone.shown,
    legalName: LEGAL.operatorFull,
    taxID: LEGAL.unp,
    foundingDate: LEGAL.registered.iso,
    address: {
      "@type": "PostalAddress",
      addressCountry: "BY",
      postalCode: LEGAL.addressParts.postalCode,
      addressLocality: LEGAL.addressParts.locality,
      streetAddress: LEGAL.addressParts.street,
    },
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
            {LEGAL.emailShown}
          </a>
          <br />
          Отвечаем в рабочие дни, обычно в течение суток.
        </dd>

        <dt className="font-semibold text-ink">Телефон</dt>
        <dd>
          <a href={LEGAL.phone.href} className="font-medium text-ink underline underline-offset-4">
            {LEGAL.phone.shown}
          </a>
          <br />
          Режим работы: {LEGAL.hours.shown}.
        </dd>

        <dt className="font-semibold text-ink">Вопрос по сделке</dt>
        <dd>
          Пишите продавцу или покупателю в чате сделки — в <Link href="/purchases" className="underline underline-offset-4">«Покупках»</Link> или{" "}
          <Link href="/sales" className="underline underline-offset-4">«Продажах»</Link>. Если договориться не получилось, откройте спор там же: его разберёт модератор.
        </dd>

        <dt className="font-semibold text-ink">Жалоба</dt>
        <dd>
          На вещь, продавца или сообщение — кнопкой «Пожаловаться» рядом с ними: модераторы видят её сразу. На сделку, продавца или работу сайта —{" "}
          <Link href="/complaint" className="font-medium text-ink underline underline-offset-4">
            через форму жалобы
          </Link>
          , ответим на почту в течение 15 дней. Телефон для жалоб покупателей:{" "}
          <a href={LEGAL.complaintsPhone.href} className="whitespace-nowrap underline underline-offset-4">
            {LEGAL.complaintsPhone.shown}
          </a>
          .
        </dd>

        <dt className="font-semibold text-ink">Брендам</dt>
        <dd>
          Хотите продавать на ichiba как бренд или магазин оригиналов —{" "}
          <Link href="/sellers/apply" className="font-medium text-ink underline underline-offset-4">
            заполните анкету
          </Link>
          : после проверки откроем лавку с печатью «Бренд».
        </dd>

        <dt className="font-semibold text-ink">Оператор сайта</dt>
        <dd>
          {LEGAL.operatorFull}
          <br />
          УНП {LEGAL.unp}, дата государственной регистрации {LEGAL.registered.shown}
          <br />
          Юридический адрес: {LEGAL.address}
        </dd>

        <dt className="font-semibold text-ink">Обращения граждан</dt>
        <dd>
          О нарушениях в торговле можно сообщить и в местный орган власти по месту регистрации ichiba — {LEGAL.authority.name}:{" "}
          {LEGAL.authority.phones.map((p, i) => (
            <span key={p.href}>
              {i > 0 && ", "}
              <a href={p.href} className="whitespace-nowrap underline underline-offset-4">
                {p.shown}
              </a>
            </span>
          ))}
          .
        </dd>
      </dl>

      <p className="mt-10 text-sm text-muted">
        Как устроена площадка — в <Link href="/rules" className="underline">Правилах площадки</Link> и{" "}
        <Link href="/terms" className="underline">Пользовательском соглашении</Link>, обработка данных — в{" "}
        <Link href="/privacy" className="underline">Политике конфиденциальности</Link>.
      </p>
    </div>
  );
}
