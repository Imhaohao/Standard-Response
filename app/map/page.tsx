import type { Metadata } from "next";
import { RescueMap } from "@/components/rescue/rescue-map";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} rescue map` };

export default function Page() {
  return <RescueMap />;
}
