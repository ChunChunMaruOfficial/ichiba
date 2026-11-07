import type { Metadata } from "next";

/** The form needs an account; the public story is /sellers. */
export const metadata: Metadata = {
  title: "Анкета бренда или магазина",
  description: "Откройте лавку бренда или магазина оригиналов на ichiba: расскажите о себе, укажите соцсеть или сайт — проверим за пару дней.",
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
