import type { Metadata } from "next";
import { AssessmentPage } from "@/components/v3/portal/assessments/AssessmentPage";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Английский — EVO Admissions" };
export default function EnglishTestPage({ searchParams }: { searchParams: Promise<{ attempt?: string; new?: string }> }) {
  return <AssessmentPage instrumentKey="english36" searchParams={searchParams} />;
}
