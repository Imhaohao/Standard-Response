import type { Metadata } from "next";
import { ReadySignUp } from "@/components/ready/sign-up";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} Ready check sign-up` };

export default function Page() {
  return <ReadySignUp />;
}
