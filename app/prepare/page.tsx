import type { Metadata } from "next";
import { SurveyPhoneView } from "@/components/prepare/survey-phone";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${PRODUCT_NAME} readiness survey` };

export default function Page() {
  return <SurveyPhoneView />;
}
