import type { Metadata } from "next";

/** The author's own list: never indexed. */
export const metadata: Metadata = {
  title: "Мои статьи",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
