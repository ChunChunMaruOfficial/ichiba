import type { Metadata } from "next";
import { Suspense } from "react";
import ResaleClient from "./resale-client";

export const metadata: Metadata = {
  title: "Вторичка — б/у одежда от частных продавцов",
  description: "Вещи из гардеробов людей в Беларуси: б/у одежда, обувь и аксессуары по честным ценам, аукционы и торг с продавцом.",
  alternates: { canonical: "/resale" },
};

export default function ResalePage() {
  return (
    <>
      <h1 className="sr-only">Вторичка — вещи с историей</h1>
      <Suspense>
        <ResaleClient />
      </Suspense>
    </>
  );
}
