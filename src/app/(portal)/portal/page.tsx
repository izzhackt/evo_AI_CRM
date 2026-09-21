import type { Metadata } from "next";
import { PreparationList } from "@/components/portal/admissionPreparations/PreparationList";
import { readStudentCatalogPreparations } from "@/lib/portal/catalog-preparations-source";

import { OverviewView } from "@/components/portal/admission/OverviewView";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readStudentPortalOverview } from "@/lib/v3/portal-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { CaseHelpWorkspace } from "@/components/v3/profile/CaseHelpWorkspace";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("admission", await getLocale());
  return { title: `${strings.overviewTitle} — EVO Admissions` };
}

/**
 * «Моё поступление» в Атласе (PORT-5d). Смоук-якорь production: заголовок
 * «Моё поступление» — байт-в-байт (PORT-6a: RU-значение живёт ключом
 * admission.overviewTitle, смоук-аккаунт — language=ru). CaseHelpWorkspace
 * (разовый вопрос-ответ) остаётся как есть — переписка живёт в
 * /portal/messages (PORT-5c).
 */
export default async function StudentPortalOverviewPage() {
  const [actor, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  const [overview, preparations] = await Promise.all([
    readStudentPortalOverview().catch(() => undefined),
    readStudentCatalogPreparations(actor.studentCaseId).catch(() => null),
  ]);
  const strings = getPortalStrings("admission", locale);
  const preparationStrings = getPortalStrings("preparations", locale);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kickerCabinet}</p>
        <h1 className="pt-page-title">{strings.overviewTitle}</h1>
        <p className="pt-page-lead">{strings.overviewLead}</p>
      </header>
      {overview === undefined ? <p className="pt-prep-error" role="status">{preparationStrings.overviewUnavailable}</p> : <OverviewView overview={overview} pending={actor.caseState === "pending"} locale={locale} />}
      <PreparationList items={preparations} strings={preparationStrings} />
      <div id="case-help" className="pt-adm-case-help"><CaseHelpWorkspace actor={actor} caseId={actor.studentCaseId} student /></div>
    </main>
  );
}
