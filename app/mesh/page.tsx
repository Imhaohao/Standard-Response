import type { Metadata } from "next";
import { PhoneMesh } from "@/components/mesh/phone-mesh";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} on your phone` };

export default function Page() {
  return <PhoneMesh />;
}
