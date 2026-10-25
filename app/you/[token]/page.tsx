import type { Metadata } from "next";
import { Suspense } from "react";
import { HouseStatus } from "@/components/claim/house-status";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: your house tonight`, robots: { index: false } };

// Where a judge's phone lands after taking a house on the kiosk: /you/<status token>. Public, like
// /join; the token is the only key, and it stops working when the claim is cleared.
async function StatusForToken({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <HouseStatus token={token} />;
}

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense>
      <StatusForToken params={params} />
    </Suspense>
  );
}
