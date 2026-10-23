import type { Metadata } from "next";
import { Suspense } from "react";
import LookClient from "./look-client";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Образ",
    description: "Образ из вещей на ichiba: все предметы комплекта с ценами — можно купить целиком или по отдельности.",
    alternates: { canonical: `/looks/${encodeURIComponent(id)}` },
  };
}

export default function LookPage() {
  return (
    <Suspense>
      <LookClient />
    </Suspense>
  );
}
