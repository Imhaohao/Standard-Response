import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { RemoteControl } from "@/components/present/remote/remote-control";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} clicker` };
export const viewport: Viewport = { themeColor: "#1a1714", userScalable: false };

type Params = Record<string, string | string[] | undefined>;

async function RemoteForRoom({ searchParams }: { searchParams: Promise<Params> }) {
  const { room } = await searchParams;
  return <RemoteControl room={typeof room === "string" ? room : null} />;
}

export default function RemotePage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <Suspense>
      <RemoteForRoom searchParams={searchParams} />
    </Suspense>
  );
}
