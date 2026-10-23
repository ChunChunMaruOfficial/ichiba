import type { Metadata } from "next";
import { Suspense } from "react";
import SimilarClient from "./similar-client";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Похожие вещи",
    description: "Вещи, похожие на выбранную: тот же фасон, цвет и стиль от других продавцов ichiba.",
    alternates: { canonical: `/item/${encodeURIComponent(id)}/similar` },
  };
}

export default function SimilarPage() {
  return (
    <Suspense>
      <SimilarClient />
    </Suspense>
  );
}
