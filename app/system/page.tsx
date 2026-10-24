import type { Metadata } from "next";
import { SystemScreen } from "@/components/system/system-screen";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} under the hood` };

export default function Page() {
  return <SystemScreen />;
}
