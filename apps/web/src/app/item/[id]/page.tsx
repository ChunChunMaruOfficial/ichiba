import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CONDITION_LABEL, DELIVERY_LABEL } from "@/lib/labels";
import { jsonLd, serverFetch, SITE_URL, truncate } from "@/lib/server";
import type { ListingDetail, ListingResponse } from "@/lib/types";
import { ItemView } from "./item-view";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID.test(id)) return null;
  return serverFetch<ListingResponse>(`/listings/${id}`);
}

const isDetail = (l: ListingResponse | null | undefined): l is ListingDetail => !!l && !("unavailable" in l);

function describe(l: ListingDetail) {
  const facts = [l.size && `размер ${l.size}`, l.brand, l.condition && CONDITION_LABEL[l.condition].toLowerCase(), l.city].filter(Boolean).join(", ");
  const price = l.auction?.status === "ACTIVE" ? `аукцион, ставка от ${l.auction.currentBid ?? l.auction.startPrice} BYN` : l.price != null ? `${l.price} BYN` : "";
  const text = [price && `${l.title} — ${price}`, facts, l.description].filter(Boolean).join(". ");
  return truncate(text, 160);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const l = await load(id);
  if (l === null) return { title: "Вещь не найдена", robots: { index: false } };
  if (!l) return {};
  if (!isDetail(l)) return { title: "Объявление недоступно", robots: { index: false, follow: true } };
  const url = `${SITE_URL}/item/${l.id}`;
  const cover = l.photos[0];
  const price = l.auction?.status === "ACTIVE" ? (l.auction.currentBid ?? l.auction.startPrice) : l.price;
  return {
    title: `${l.title}${price != null ? ` — ${price} BYN` : ""}`,
    description: describe(l),
    alternates: { canonical: url },
    // Sold items stay reachable from links, but no longer compete in search results.
    robots: l.status === "SOLD" ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "website",
      url,
      title: l.title,
      description: describe(l),
      images: cover ? [{ url: cover.urls.l, width: cover.width, height: cover.height, alt: l.title }] : undefined,
    },
    twitter: { card: cover ? "summary_large_image" : "summary", title: l.title, description: describe(l), images: cover ? [cover.urls.l] : undefined },
    other: price != null ? { "product:price:amount": String(price), "product:price:currency": "BYN" } : undefined,
  };
}

function productLd(l: ListingDetail) {
  const url = `${SITE_URL}/item/${l.id}`;
  const price = l.auction?.status === "ACTIVE" ? (l.auction.currentBid ?? l.auction.startPrice) : l.price;
  const availability = l.status === "SOLD" ? "SoldOut" : l.status === "RESERVED" ? "LimitedAvailability" : "InStock";
  return [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: l.title,
      url,
      sku: l.id,
      image: l.photos.map((p) => p.urls.l),
      description: l.description ?? describe(l),
      category: l.subcategoryLabel ?? l.categoryLabel ?? undefined,
      brand: l.brand ? { "@type": "Brand", name: l.brand } : undefined,
      size: l.size ?? undefined,
      color: l.color ?? undefined,
      material: l.material ?? undefined,
      offers:
        price != null
          ? {
              "@type": "Offer",
              url,
              price,
              priceCurrency: "BYN",
              availability: `https://schema.org/${availability}`,
              itemCondition: l.condition === "NEW_WITH_TAGS" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
              availableDeliveryMethod: l.deliveryOptions.map((d) => DELIVERY_LABEL[d]).join(", "),
              seller: { "@type": "Person", name: l.seller.username, url: `${SITE_URL}/u/${l.seller.username}` },
            }
          : undefined,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: SITE_URL },
        ...(l.categoryLabel ? [{ "@type": "ListItem", position: 2, name: l.categoryLabel, item: `${SITE_URL}/search?category=${l.category}` }] : []),
        { "@type": "ListItem", position: l.categoryLabel ? 3 : 2, name: l.title, item: url },
      ],
    },
  ];
}

export default async function ItemPage({ params }: Props) {
  const { id } = await params;
  const l = await load(id);
  // Unknown id → a real 404 status for crawlers; API trouble → the client shell retries on its own.
  if (l === null) notFound();
  return (
    <>
      {isDetail(l) && <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(productLd(l))} />}
      <ItemView id={id} initial={l} />
    </>
  );
}
