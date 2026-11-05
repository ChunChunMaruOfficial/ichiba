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
    cta: ["/settings#brand", "Подать заявку бренда"],
  },
  {
    seal: "正",
    title: "Магазин оригиналов",
    who: "Продаёте новые оригинальные вещи других марок",
    gets: ["После проверки новые вещи с бирками попадают в основной каталог", "Несколько размеров в одном объявлении", "Скидка за комплект и автопринятие предложений"],
    cta: ["/settings#brand", "Подать заявку магазина"],
  },
  {
    seal: "古",
    title: "Свой гардероб",
    who: "Продаёте то, что больше не носите",
    gets: ["Раздел «Вторичка» с лентой, поиском и подписками", "ИИ заполнит описание по фото и подскажет цену", "Торг, аукционы и личная скидка тем, кто сохранил вещь"],
    cta: ["/sell", "Продать вещь"],
  },
];

/** What every shop gets: only what the site does today (brand-acquisition/ICHIBA_FACTS.md keeps the same list). */
const TOOLS: Array<[string, string]> = [
  ["Покупатель видит, подойдёт ли размер", "По его замерам и замерам вещи: «скорее всего подойдёт» или «будет мала» — меньше вопросов в чате."],
  ["Вещь находят по фото", "Поиск по фотографии сравнивает снимок со всеми фото на сайте — даже скриншот из соцсетей."],
  ["Статистика по каждой вещи", "Просмотры, сохранения, корзины, чаты, предложения и продажи по дням, с воронкой и советами."],
  ["Заказы приходят в Telegram", "Новый запрос, предложение цены или сообщение — сразу в Telegram-бот и на почту."],
  ["Подписчики видят новинки", "На лавку подписываются: её новые вещи попадают в ленту подписок."],
  ["Вещи ищутся в Google и Яндексе", "У каждой вещи своя страница с описанием и разметкой товара — поисковики показывают её отдельно."],
];

const STEPS: Array<[string, string, string]> = [
  ["一", "Войдите", "По телефону, почте, Google или Telegram — минута."],
  ["二", "Расскажите о лавке", "Бренду и магазину — короткая заявка в настройках, её проверяет модератор. Своему гардеробу заявка не нужна."],
  ["三", "Выставьте вещи", "Сами за пару минут на вещь — или мы перенесём ассортимент за вас."],
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
          <ButtonLink href="/settings#brand" size="lg">
            Подать заявку бренда
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
          Что есть у каждой лавки
        </h2>
        <dl className="mt-6 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map(([title, text]) => (
            <div key={title} className="border-t border-line pt-4">
              <dt className="text-lg font-semibold">{title}</dt>
              <dd className="mt-1 text-[15px] leading-relaxed text-ink-2">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-10 md:mt-20 md:grid-cols-2" aria-labelledby="start">
        <div>
          <h2 id="start" className="text-2xl font-semibold tracking-tight md:text-3xl">
            Как начать
          </h2>
          <ol className="mt-6 flex flex-col gap-6">
            {STEPS.map(([n, title, text]) => (
              <li key={n} className="flex items-start gap-5">
                <span aria-hidden className="w-9 shrink-0 text-center font-brush text-4xl leading-none text-shu">
                  {n}
                </span>
                <div className="border-b border-line pb-5">
                  <p className="text-xl font-bold">{title}</p>
                  <p className="mt-1 text-[15px] text-ink-2">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Условия</h2>
          <div className="mt-6 flex flex-col gap-3 text-[15px] leading-relaxed text-ink-2">
            <p>
              <b className="font-semibold text-ink">Сейчас размещение и продажи бесплатны.</b> Покупатель платит при получении — лично или при доставке,
              которую вы отправляете сами.
            </p>
            <p>
              Вместе с онлайн-оплатой появится комиссия — <b className="font-semibold text-ink">5% с цены проданной вещи</b>. Только с завершённых сделок;
              размещение, поднятие в ленте и статистика останутся бесплатными. Дату начала объявим не меньше чем за 15 дней, как требуют{" "}
              <Link href="/rules" className={link}>
                правила площадки
              </Link>
              .
            </p>
            <p>
              Как проходит заказ — шаг за шагом на странице{" "}
              <Link href="/how-it-works" className={link}>
                «Как работает сделка»
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
