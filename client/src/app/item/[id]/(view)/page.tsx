import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { conditionLabel } from "@/lib/labels";
import { itemIdFrom, itemSegment } from "@/lib/item-path";
import { itemLandings, landingHref, type ItemLandings, type LandingEntry } from "@/lib/landing";
import { jsonLd, serverFetch, SITE_URL, truncate } from "@/lib/server";
import type { ListingDetail, ListingResponse } from "@/lib/types";
import { ItemView } from "./item-view";

type Props = { params: Promise<{ id: string }> };

/** A sold item's page stays in search this long, then leaves it (server: seo.service SOLD_INDEXED_DAYS). */
const SOLD_INDEXED_DAYS = 60;

async function load(param: string) {
  const id = itemIdFrom(param);
  if (!id) return null;
  return serverFetch<ListingResponse>(`/listings/${encodeURIComponent(id)}`);
}

const isDetail = (l: ListingResponse | null | undefined): l is ListingDetail => !!l && !("unavailable" in l);

/** For an API that doesn't send the snippet yet: the old short description. */
function describe(l: ListingDetail) {
  const facts = [l.size && l.sizeSystem !== "OTHER" && `размер ${l.size}`, l.brand, l.condition && conditionLabel(l.condition, l.hasTags).toLowerCase(), l.city].filter(Boolean).join(", ");
  const price = l.auction?.status === "ACTIVE" ? `аукцион, ставка от ${l.auction.currentBid ?? l.auction.startPrice} BYN` : l.price != null ? `${l.price} BYN` : "";
  return truncate([price && `${l.title} — ${price}`, facts, l.description].filter(Boolean).join(". "), 160);
}

const priceOf = (l: ListingDetail) => (l.auction?.status === "ACTIVE" ? (l.auction.currentBid ?? l.auction.startPrice) : l.priceNegotiable ? null : l.price);

/** Sold long enough ago that the page is kept out of search (it stays reachable from links). */
const soldLongAgo = (l: ListingDetail) => l.status === "SOLD" && (!l.soldAt || Date.now() - new Date(l.soldAt).getTime() > SOLD_INDEXED_DAYS * 86_400_000);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = await load((await params).id);
  // Metadata is resolved before the stream starts, so an unknown id becomes a real 404 status here;
  // the same call inside the page (under its loading boundary) would already have sent a 200.
  if (l === null) notFound();
  if (!l) return {};
  if (!isDetail(l)) return { title: "Объявление недоступно", robots: { index: false, follow: true } };
  const url = `${SITE_URL}/item/${itemSegment(l)}`;
  const cover = l.photos[0];
  const name = l.seo?.name ?? l.title;
  const description = l.seo?.description ?? describe(l);
  const price = priceOf(l);
  return {
    title: l.seo?.title ?? `${l.title}${price != null ? ` — ${price} BYN` : ""}`,
    description,
    alternates: { canonical: url },
    // A sold item stays in search for a while (people look for it, the page offers similar ones), then leaves it.
    robots: soldLongAgo(l) ? { index: false, follow: true } : { index: true, follow: true, "max-image-preview": "large" },
    openGraph: {
      type: "website",
      url,
      title: name,
      description,
      images: cover ? [{ url: cover.urls.l, width: cover.width, height: cover.height, alt: name }] : undefined,
    },
    twitter: { card: cover ? "summary_large_image" : "summary", title: name, description, images: cover ? [cover.urls.l] : undefined },
    other: price != null ? { "product:price:amount": String(price), "product:price:currency": "BYN" } : undefined,
  };
}

const CONDITION_SCHEMA: Record<NonNullable<ListingDetail["condition"]>, string> = {
  NEW_WITH_TAGS: "NewCondition",
  LIKE_NEW: "UsedCondition",
  GOOD: "UsedCondition",
  VISIBLE_WEAR: "UsedCondition",
};

/**
 * Product + Offer (Google product snippets, Yandex): name, photos, brand, colour, size, material, audience, condition,
 * price and availability, all as the page shows them. Fields the listing doesn't have are left out, never empty.
 */
function productLd(l: ListingDetail, pages: ItemLandings) {
  const url = `${SITE_URL}/item/${itemSegment(l)}`;
  const price = priceOf(l);
  const availability = l.status === "SOLD" ? "SoldOut" : l.status === "RESERVED" ? "LimitedAvailability" : "InStock";
  const name = l.seo?.name ?? l.title;
  const brand = l.seo?.brand ?? l.brand;
  const sellerUrl = `${SITE_URL}/u/${encodeURIComponent(l.seller.username)}`;
  const market = l.market === "resale" ? { name: "Вторичка", item: `${SITE_URL}/resale` } : { name: "Бренды", item: SITE_URL };
  // The item's category and subcategory pages when they are indexed; the market section when there is none.
  const trail = [pages.category, pages.subcategory].filter((p): p is LandingEntry => !!p).map((p) => ({ name: p.name, item: `${SITE_URL}${landingHref(p.path)}` }));
  const sizes = l.stockSizes?.length ? l.stockSizes.join(", ") : l.sizeSystem !== "OTHER" ? l.size : null;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name,
      url,
      sku: l.id,
      image: l.photos.length ? l.photos.filter((p) => !p.isDefect).map((p) => p.urls.l) : undefined,
      description: l.description || l.seo?.description || undefined,
      category: [l.categoryLabel, l.subcategoryLabel].filter(Boolean).join(" > ") || undefined,
      brand: brand ? { "@type": "Brand", name: brand, ...(l.seo?.brandRu ? { alternateName: l.seo.brandRu } : {}) } : undefined,
      size: sizes || undefined,
      color: l.seo?.color ?? undefined,
      material: l.material && l.material !== "Другое" ? l.material : undefined,
      audience: l.gender === "MALE" || l.gender === "FEMALE" ? { "@type": "PeopleAudience", suggestedGender: l.gender === "MALE" ? "male" : "female" } : undefined,
      // A negotiable price («Договорная») has no amount to offer: the Product goes without an Offer.
      offers:
        price != null
          ? {
              "@type": "Offer",
              url,
              price,
              priceCurrency: "BYN",
              availability: `https://schema.org/${availability}`,
              itemCondition: l.condition ? `https://schema.org/${CONDITION_SCHEMA[l.condition]}` : undefined,
              // availableDeliveryMethod is left out: schema.org expects DeliveryMethod enum URLs there, not Russian words.
              seller: l.seller.brand
                ? { "@type": "Organization", name: l.seller.brand, url: sellerUrl }
                : { "@type": "Person", name: l.seller.username, url: sellerUrl },
              ...(l.city ? { availableAtOrFrom: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: l.city, addressCountry: "BY" } } } : {}),
            }
          : undefined,
    },
    // Every step is a page search engines index: the category pages (or the section), then the item.
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [{ name: "ichiba", item: SITE_URL }, ...(trail.length ? trail : [market]), { name, item: url }].map((c, i) => ({ "@type": "ListItem", position: i + 1, ...c })),
    },
  ];
}

export default async function ItemPage({ params }: Props) {
  const segment = (await params).id;
  const [l, landings] = await Promise.all([load(segment), serverFetch<LandingEntry[]>("/seo/landings", 900)]);
  // Unknown id → a real 404 status for crawlers; API trouble → the client shell retries on its own.
  if (l === null) notFound();
  const pages = itemLandings(landings, isDetail(l) ? l : { category: null, brand: null });
  return (
    <>
      {isDetail(l) && <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(productLd(l, pages))} />}
      <ItemView id={itemIdFrom(segment)!} initial={l} landings={pages} />
    </>
  );
}
