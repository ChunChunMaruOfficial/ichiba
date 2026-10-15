import type { Metadata, Viewport } from "next";
import { Spectral, Yuji_Syuku } from "next/font/google";
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
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${spectral.variable} ${yuji.variable}`} suppressHydrationWarning>
      {THEME_SCRIPT && (
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        </head>
      )}
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
          <PhotoFlight />
        </Providers>
      </body>
    </html>
  );
}
