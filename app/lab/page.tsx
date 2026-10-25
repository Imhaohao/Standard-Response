import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/brand";
import { MapLab } from "./map-lab";

export const metadata: Metadata = { title: `${PRODUCT_NAME} map lab` };

export default function Page() {
  return <MapLab />;
}
