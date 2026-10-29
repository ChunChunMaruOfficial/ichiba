// Category pages: /c/<category>, /c/<category>/<subcategory> (components/landing-view.tsx).
import { LandingPage, landingMetadata } from "@/components/landing-view";

type Props = { params: Promise<{ path: string[] }> };

export const generateMetadata = ({ params }: Props) => landingMetadata("c", params);

export default function Page({ params }: Props) {
  return <LandingPage root="c" params={params} />;
}
