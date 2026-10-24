import type { Metadata } from "next";
import { FlowLab } from "@/components/mesh/flow-lab";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} crowd flow` };

export default function Page() {
  return <FlowLab />;
}
