import type { Metadata } from "next";
import { AgencyView } from "@/components/mesh/agency-view";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} mesh uploads` };

export default function Page() {
  return <AgencyView />;
}
