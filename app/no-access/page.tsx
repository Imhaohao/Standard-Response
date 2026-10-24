import type { Metadata } from "next";
import { NoAccess } from "@/components/account/no-access";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: dispatchers only` };

export default function Page() {
  return <NoAccess />;
}
