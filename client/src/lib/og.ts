import type { Metadata } from "next";
import { SITE_URL } from "./server";

/**
 * Open Graph for one page. Next replaces the layout's openGraph as a whole whenever a page sets its own, so a page
 * that sets only its title lost the site name, the locale and the default preview picture (app/opengraph-image.tsx),
 * and a page that set nothing showed the home page's address as its og:url. Every public page builds its block here:
 * its own address, the shared fields, and the default picture when it has no photo of its own.
 */
export const OG_IMAGE = { url: `${SITE_URL}/opengraph-image`, width: 1200, height: 630, alt: "ichiba — вещи с историей. Маркетплейс одежды из открытых гардеробов Беларуси" };

type Og = NonNullable<Metadata["openGraph"]>;
type Image = { url: string; width?: number; height?: number; alt?: string };
/** Next's type is a union per og:type (article adds publishedTime, section, tags…): the extra fields pass through. */
type Fields = { title: string; description?: string; type?: "website" | "article" | "profile"; images?: Image[]; [field: string]: unknown };

export function og(path: string, o: Fields): Og {
  const { images, type = "website", ...rest } = o;
  return {
    siteName: "ichiba",
    locale: "ru_RU",
    ...rest,
    type,
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    images: images?.length ? images : [OG_IMAGE],
  } as Og;
}
