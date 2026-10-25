import type { Metadata } from "next";
import { Suspense } from "react";
import { Deck } from "@/components/present/deck";
import { parsePosition } from "@/components/present/timeline";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} pitch` };

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The URL says which slide and beat to open on, so a reload lands where the presenter was.
async function DeckAtPosition({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  return <Deck initial={parsePosition(first(params.slide), first(params.beat))} />;
}

export default function PresentPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <Suspense>
      <DeckAtPosition searchParams={searchParams} />
    </Suspense>
  );
}
