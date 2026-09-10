import type { Metadata } from "next";

import { OverviewView } from "@/components/v3/portal/OverviewView";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { readStudentPortalOverview } from "@/lib/v3/portal-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { CaseHelpWorkspace } from "@/components/v3/profile/CaseHelpWorkspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Моё поступление — EVO Admissions",
};

export default async function StudentPortalOverviewPage() {
  const [overview, actor] = await Promise.all([readStudentPortalOverview(), requireStudentPortalActor()]);

  return (
    <PortalPage
      title="Моё поступление"
      description="Ваш следующий шаг и работа команды — под рукой."
    >
      <OverviewView overview={overview} />
      <div className="mt-8"><CaseHelpWorkspace actor={actor} caseId={actor.studentCaseId} student /></div>
    </PortalPage>
  );
}
