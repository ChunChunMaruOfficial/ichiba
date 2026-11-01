import type { Metadata, Viewport } from "next";
import { Spectral, Yuji_Syuku } from "next/font/google";
import { Analytics } from "@/components/analytics";
import { CookieNotice } from "@/components/cookie-notice";
import { Footer } from "@/components/footer";
import { BottomNav, Header, Main } from "@/components/header";
import { PhotoFlight } from "@/components/photo-flight";
import { Providers } from "@/components/providers";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Brand type (design/brand): Spectral serif for everything — titles, text, buttons, prices; Yuji Syuku brush for
// kanji on seals only (loaded on demand: its Japanese glyphs come in unicode-range chunks).
const spectral = Spectral({ variable: "--font-spectral", subsets: ["latin", "cyrillic"], weight: ["400", "500", "600", "700", "800"], display: "swap" });
const yuji = Yuji_Syuku({ variable: "--font-yuji", subsets: ["latin"], weight: "400", display: "swap", preload: false });


const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "ichiba — вещи из открытых гардеробов", template: "%s · ichiba" },
  description: "Маркетплейс одежды, обуви и аксессуаров из гардеробов людей в Беларуси: покупайте и продавайте б/у вещи, торгуйтесь, участвуйте в аукционах.",
  applicationName: "ichiba",
  openGraph: { type: "website", siteName: "ichiba", locale: "ru_RU", url: SITE_URL, title: "ichiba — вещи из открытых гардеробов", description: "Покупайте и продавайте вещи из гардеробов людей в Беларуси." },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#f4efe6",
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout viewport (Chrome on Android), so bottom sheets, the chat composer and
  // fixed bars stay above it instead of under it.
  interactiveWidget: "resizes-content",
};

/**
 * Who the site is, once for every page: the organisation and the site itself with its search. Search engines and AI
 * answers tie every Product, Article and ItemList on the site to this one entity; `sameAs` names the same ichiba on
 * other platforms (set NEXT_PUBLIC_SOCIAL_LINKS to a comma-separated list of profile URLs).
 */
const SOCIAL = (process.env.NEXT_PUBLIC_SOCIAL_LINKS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => /^https?:\/\//.test(s));
const ORGANIZATION_LD = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "ichiba",
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.svg` },
    description: "Маркетплейс открытых гардеробов в Беларуси: одежда, обувь и аксессуары от людей, винтажных магазинов и локальных брендов — б/у, винтаж и новое.",
    areaServed: { "@type": "Country", name: "Беларусь" },
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: `${SITE_URL}/contacts`, availableLanguage: "ru" },
    ...(SOCIAL.length ? { sameAs: SOCIAL } : {}),
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "ichiba",
    url: SITE_URL,
    inLanguage: "ru",
    publisher: { "@id": `${SITE_URL}/#organization` },
    potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/search?q={search_term_string}` }, "query-input": "required name=search_term_string" },
  },
];
const organizationLd = { __html: JSON.stringify(ORGANIZATION_LD).replace(/</g, "\\u003c") };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${spectral.variable} ${yuji.variable}`} suppressHydrationWarning>
      <head>
        {THEME_SCRIPT && <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />}
        <script type="application/ld+json" dangerouslySetInnerHTML={organizationLd} />
      </head>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only z-[90] rounded-lg bg-ink px-4 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Перейти к содержимому
        </a>
        <Providers>
          <Header />
          <Main>{children}</Main>
          <Footer />
          <BottomNav />
          <CookieNotice />
          <Analytics />
          <PhotoFlight />
        </Providers>
      </body>
    </html>
  );
}
