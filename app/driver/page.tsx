import type { Metadata } from "next";
import { DriverPage } from "@/components/driver/driver-page";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} driver` };

export default function Page() {
  return <DriverPage />;
}
