import type { Metadata } from "next";

import { OverviewView } from "@/components/v3/portal/OverviewView";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { readStudentPortalOverview } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Моё поступление — EVO Admissions",
};

export default async function StudentPortalOverviewPage() {
  const view = await readStudentPortalOverview();

  return (
    <PortalPage
      title="Моё поступление"
      description="Текущий этап, ближайшее действие и человек, который сопровождает ваше дело."
    >
      <OverviewView view={view} />
    </PortalPage>
  );
}
