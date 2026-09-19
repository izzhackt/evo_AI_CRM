import type { Metadata } from "next";

import { OverviewView } from "@/components/portal/admission/OverviewView";
import { readStudentPortalOverview } from "@/lib/v3/portal-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { CaseHelpWorkspace } from "@/components/v3/profile/CaseHelpWorkspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Моё поступление — EVO Admissions",
};

/**
 * «Моё поступление» в Атласе (PORT-5d). Смоук-якорь production: заголовок
 * «Моё поступление» — байт-в-байт. CaseHelpWorkspace (разовый вопрос-ответ)
 * остаётся как есть — переписка живёт в /portal/messages (PORT-5c).
 */
export default async function StudentPortalOverviewPage() {
  const [overview, actor] = await Promise.all([readStudentPortalOverview(), requireStudentPortalActor()]);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">Кабинет студента</p>
        <h1 className="pt-page-title">Моё поступление</h1>
        <p className="pt-page-lead">Ваш следующий шаг и работа команды — под рукой.</p>
      </header>
      <OverviewView overview={overview} pending={actor.caseState === "pending"} />
      <div id="case-help" className="pt-adm-case-help"><CaseHelpWorkspace actor={actor} caseId={actor.studentCaseId} student /></div>
    </main>
  );
}
