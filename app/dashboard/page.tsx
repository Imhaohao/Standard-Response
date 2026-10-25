import type { Metadata } from "next";
import { CallFloor } from "@/components/floor/call-floor";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} call floor` };

export default function Page() {
  return <CallFloor />;
}
