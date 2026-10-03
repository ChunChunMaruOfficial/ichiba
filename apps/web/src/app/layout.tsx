import type { Metadata, Viewport } from "next";
import { Geologica } from "next/font/google";
import { BottomNav, Header } from "@/components/header";
import { Providers } from "@/components/providers";
import "./globals.css";

const geologica = Geologica({ variable: "--font-geologica", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: { default: "ichiba — вещи из открытых гардеробов", template: "%s · ichiba" },
  description: "Маркетплейс одежды, обуви и аксессуаров из гардеробов людей.",
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
