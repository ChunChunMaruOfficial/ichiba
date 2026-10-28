import type { Metadata } from "next";
import { Suspense } from "react";
import { itemIdFrom } from "@/lib/item-path";
import SimilarClient from "./similar-client";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const param = (await params).id;
  const id = itemIdFrom(param) ?? param;
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
