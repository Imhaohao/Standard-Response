import type { Metadata } from "next";
import { PhonePanel } from "@/components/phone/phone-panel";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} simulated phone` };

export default function Page() {
  return <PhonePanel />;
}
