import type { Metadata } from "next";
import { Kiosk } from "@/components/claim/kiosk";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} judge sign-in` };

// The public kiosk judges walk up to. The call floor lives at /dashboard.
export default function Page() {
  return <Kiosk />;
}
