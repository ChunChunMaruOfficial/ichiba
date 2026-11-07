import type { Metadata } from "next";

/** The editor is the author's own page: never indexed. */
export const metadata: Metadata = {
  title: "Написать статью в журнал",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
