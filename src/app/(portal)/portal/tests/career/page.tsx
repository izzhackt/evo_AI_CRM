import type { Metadata } from "next";

import { AssessmentPage } from "@/components/portal/tests/AssessmentPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Карта интересов — EVO Admissions" };

export default function CareerTestPage({ searchParams }: { searchParams: Promise<{ attempt?: string; new?: string }> }) {
  return <AssessmentPage instrumentKey="orvis92" searchParams={searchParams} />;
}
