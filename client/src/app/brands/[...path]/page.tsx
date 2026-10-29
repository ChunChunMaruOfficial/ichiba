// Brand pages: /brands/<brand>, /brands/<brand>/<category>[/<subcategory>] (components/landing-view.tsx).
import { LandingPage, landingMetadata } from "@/components/landing-view";

type Props = { params: Promise<{ path: string[] }> };

export const generateMetadata = ({ params }: Props) => landingMetadata("brands", params);

export default function Page({ params }: Props) {
  return <LandingPage root="brands" params={params} />;
}
