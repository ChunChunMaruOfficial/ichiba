// Category pages: /c/<category>, /c/<category>/<subcategory> (components/landing-view.tsx).
import { LandingPage, landingMetadata } from "@/components/landing-view";

type Props = { params: Promise<{ path: string[] }> };

/**
 * Cached and rebuilt in the background at most every five minutes (ISR): the page reads no cookie or header, so one copy
 * serves everyone, Cloudflare keeps it at the edge (s-maxage) and the browser's back button restores it from bfcache
 * instead of rendering again. Without this a dynamic segment is rendered per request and sent with no-store. The empty
 * generateStaticParams is what lets Next cache paths it meets at runtime.
 */
export const revalidate = 300;
export const generateStaticParams = () => [];

export const generateMetadata = ({ params }: Props) => landingMetadata("c", params);

export default function Page({ params }: Props) {
  return <LandingPage root="c" params={params} />;
}
