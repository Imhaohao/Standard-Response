import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinPhone } from "@/components/claim/join-phone";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} judge sign-in` };

type Params = Record<string, string | string[] | undefined>;

// Opened from the kiosk's QR code: /join?k=<sign-in code>.
async function JoinWithCode({ searchParams }: { searchParams: Promise<Params> }) {
  const { k } = await searchParams;
  return <JoinPhone code={typeof k === "string" ? k : null} />;
}

export default function Page({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <Suspense>
      <JoinWithCode searchParams={searchParams} />
    </Suspense>
  );
}
