import type { Metadata } from "next";
import { CountyView } from "@/components/prepare/county-view";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} readiness: what the county learns` };

export default function Page() {
  return <CountyView />;
}
