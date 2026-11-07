import type { Metadata } from "next";
import Link from "next/link";
import { TitleWithKanji } from "@/components/sections";
import { ButtonLink } from "@/components/ui";
import { LEGAL } from "@/lib/legal";
import { og } from "@/lib/og";

export const metadata: Metadata = {
  title: "Открыть лавку на ichiba",
  description: "Как продавать на ichiba брендам, магазинам и частным продавцам: каталог брендов отдельно от б/у, пошив по меркам, перенос ассортимента из Telegram или с сайта, статистика и условия.",
  alternates: { canonical: "/sellers" },
  openGraph: og("/sellers", { title: "Открыть лавку на ichiba", description: "Для брендов, магазинов и всех, кто продаёт одежду: что даёт площадка, как начать и на каких условиях." }),
};

/** The three kinds of seller ichiba has, each with its own place on the site (listings/market.ts). */
const SHOPS: Array<{ seal: string; title: string; who: string; gets: string[]; cta: [string, string] }> = [
  {
    seal: "銘",
    title: "Бренд",
    who: "Шьёте под своим именем: свой дизайн, свои коллекции",
    gets: ["Отдельный каталог брендов — не вперемешку с б/у", "Печать «Бренд» на профиле и вещах, метки «Новинка», «Хит»", "Пошив по меркам: покупатель заказывает модель по своим меркам"],
    cta: ["/sellers/apply", "Заполнить анкету"],
  },
  {
    seal: "正",
    title: "Магазин оригиналов",
    who: "Продаёте новые оригинальные вещи других марок",
    gets: ["После проверки новые вещи с бирками попадают в основной каталог", "Несколько размеров в одном объявлении", "Скидка за комплект и автопринятие предложений"],
    cta: ["/sellers/apply?kind=CATALOG", "Заполнить анкету"],
  },
  {
    seal: "古",
    title: "Свой гардероб",
    who: "Продаёте то, что больше не носите",
    gets: ["Раздел «Вторичка» с лентой, поиском и подписками", "ИИ заполнит описание по фото и подскажет цену", "Торг, аукционы и личная скидка тем, кто сохранил вещь"],
    cta: ["/sell", "Продать вещь"],
  },
];

/** What every shop gets, in a word each: only what the site does today (brand-acquisition/ICHIBA_FACTS.md has the long list). */
const TOOLS = ["Подбор по размеру", "Поиск по фото", "Статистика по вещам", "Заказы в Telegram", "Подписчики видят новинки", "Вещи в Google и Яндексе"];

const STEPS: Array<[string, string, string]> = [
  ["一", "Войдите", "за минуту"],
  ["二", "Заполните анкету", "если вы бренд или магазин"],
  ["三", "Выставьте вещи", "сами или перенесём за вас"],
];

const link = "font-semibold text-ink underline underline-offset-4";

/**
 * «Открыть лавку»: the page for everyone who sells — brands, shops of originals, private wardrobes. The header's
 * button leads here on the brands' side of the site (on «Вторичка» it is «Продать вещь»).
 */
export default function SellersPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12">
      <header className="max-w-3xl">
        <TitleWithKanji kanji="商い">
          <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">Откройте лавку на ichiba</h1>
        </TitleWithKanji>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
          Ichiba по-японски — рынок. Здесь своя лавка есть у белорусских брендов, у магазинов оригиналов и у всех, кто продаёт свои вещи. Покупатели
          находят одежду по фото и размеру, а сделка проходит на площадке.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <ButtonLink href="/sellers/apply" size="lg">
            Открыть лавку бренда
          </ButtonLink>
          <ButtonLink href="/sell" variant="secondary" size="lg">
            Продать вещь
          </ButtonLink>
        </div>
      </header>

      <section className="mt-14 md:mt-20" aria-labelledby="shops">
        <h2 id="shops" className="text-2xl font-semibold tracking-tight md:text-3xl">
          Три вида лавок
        </h2>
        <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {SHOPS.map((s) => (
            <li key={s.title} className="flex flex-col rounded-[28px] bg-surface p-6 shadow-[var(--shadow-paper)]">
              <span aria-hidden className="font-brush text-4xl leading-none text-shu">
                {s.seal}
              </span>
              <h3 className="mt-4 text-xl font-bold">{s.title}</h3>
              <p className="mt-1 text-[15px] text-ink-2">{s.who}</p>
              <ul className="mt-4 flex flex-1 list-disc flex-col gap-1.5 pl-5 text-[15px] text-ink-2">
                {s.gets.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
              <ButtonLink href={s.cta[0]} variant="secondary" className="mt-6 self-start">
                {s.cta[1]}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-8 rounded-[28px] bg-surface-sunk p-6 md:mt-20 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:p-10" aria-labelledby="move">
        <div>
          <h2 id="move" className="text-2xl font-semibold tracking-tight md:text-3xl">
            Перенесём ассортимент сами
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Брендам и магазинам не нужно заполнять каждую вещь: мы переносим ассортимент из Telegram-канала или с сайта и держим его в синхроне — новые
            вещи появляются, проданные скрываются, цены и размеры обновляются.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 text-[15px] text-ink-2">
          <p>
            Напишите на{" "}
            <a href={`mailto:${LEGAL.email}`} className={link}>
              {LEGAL.email}
            </a>{" "}
            или позвоните{" "}
            <a href={LEGAL.phone.href} className={`${link} whitespace-nowrap`}>
              {LEGAL.phone.shown}
            </a>
            : пришлите ссылку на канал или сайт, и мы скажем, сколько времени займёт перенос.
          </p>
        </div>
      </section>

      <section className="mt-14 md:mt-20" aria-labelledby="tools">
        <h2 id="tools" className="text-2xl font-semibold tracking-tight md:text-3xl">
          У каждой лавки
        </h2>
        <ul className="mt-5 flex flex-wrap gap-2">
          {TOOLS.map((t) => (
            <li key={t} className="rounded-full bg-surface px-4 py-2 text-[15px] font-medium shadow-[var(--shadow-paper)]">
              {t}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-10 md:mt-20 md:grid-cols-2" aria-labelledby="start">
        <div>
          <h2 id="start" className="text-2xl font-semibold tracking-tight md:text-3xl">
            Как начать
          </h2>
          <ol className="mt-6 flex flex-col gap-4">
            {STEPS.map(([n, title, text]) => (
              <li key={n} className="flex items-baseline gap-4">
                <span aria-hidden className="w-8 shrink-0 text-center font-brush text-3xl leading-none text-shu">
                  {n}
                </span>
                <p>
                  <b className="text-lg font-bold">{title}</b> <span className="text-[15px] text-ink-2">— {text}</span>
                </p>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Условия</h2>
          <div className="mt-6 flex flex-col gap-3 text-[15px] leading-relaxed text-ink-2">
            <p>
              <b className="font-semibold text-ink">Сейчас всё бесплатно.</b> Покупатель платит вам при получении.
            </p>
            <p>
              С онлайн-оплатой появится комиссия <b className="font-semibold text-ink">5%</b> с проданной вещи — объявим за 15 дней (
              <Link href="/rules" className={link}>
                правила
              </Link>
              ,{" "}
              <Link href="/how-it-works" className={link}>
                как проходит сделка
              </Link>
              ).
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
