import type { Metadata, Viewport } from "next";
import { Geologica } from "next/font/google";
import { BottomNav, Header } from "@/components/header";
import { Providers } from "@/components/providers";
import "./globals.css";

const geologica = Geologica({ variable: "--font-geologica", subsets: ["latin", "cyrillic"] });

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
  themeColor: "#eeefec",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={geologica.variable}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only z-[90] rounded-lg bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Перейти к содержимому
        </a>
        <Providers>
          <Header />
          <main id="main" tabIndex={-1} className="pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
