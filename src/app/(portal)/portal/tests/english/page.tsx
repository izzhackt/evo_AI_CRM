import type { Metadata } from "next";

import { AssessmentPage } from "@/components/portal/tests/AssessmentPage";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("tests", await getLocale());
  return { title: `${strings.historyEnglish} — EVO Admissions` };
}

export default function EnglishTestPage({ searchParams }: { searchParams: Promise<{ attempt?: string; new?: string }> }) {
  return <AssessmentPage instrumentKey="english36" searchParams={searchParams} />;
}
