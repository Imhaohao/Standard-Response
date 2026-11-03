import type { Metadata } from "next";
import { Kiosk } from "@/components/claim/kiosk";
import { PRODUCT_NAME, SITE_URL } from "@/lib/brand";

const title = `${PRODUCT_NAME}: calling every home in an evacuation zone`;
const description = `${PRODUCT_NAME} calls every household in an evacuation zone at the same time, finds out who needs help, and routes neighbors and first responders to them.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/`,
    siteName: PRODUCT_NAME,
    type: "website",
    images: [{ url: `${SITE_URL}/devpost/census.jpg`, width: 2000, height: 1222, alt: "Every home in a simulated evacuation zone over west Altadena, colored by who needs help" }],
  },
};

// The public kiosk judges walk up to. The call floor lives at /dashboard.
export default function Page() {
  return <Kiosk />;
}
