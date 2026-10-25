import type { Metadata, Viewport } from "next";
import { RemoteControl } from "@/components/present/remote/remote-control";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} clicker` };
export const viewport: Viewport = { themeColor: "#1a1714", userScalable: false };

type Params = Record<string, string | string[] | undefined>;

export default async function RemotePage({ searchParams }: { searchParams: Promise<Params> }) {
  const { room } = await searchParams;
  return <RemoteControl room={typeof room === "string" ? room : null} />;
}
