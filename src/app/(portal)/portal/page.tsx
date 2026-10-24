import Link from "next/link";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import type { Metadata } from "next";
import { PreparationList } from "@/components/portal/admissionPreparations/PreparationList";
import { readStudentCatalogPreparations } from "@/lib/portal/catalog-preparations-source";

import { OverviewView } from "@/components/portal/admission/OverviewView";
import { AiConsentSlot } from "@/components/portal/consent/AiConsentSlot";
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
 * /portal/messages (PORT-5c). Согласие на ИИ-помощников (25.10.2026) стоит
 * над обзором: после логина студент попадает сюда, не на «Главную»; карточка
 * сама исчезает, когда для текущей версии текста есть решение.
 */
export default async function StudentPortalOverviewPage() {
  const [actor, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  const strings = getPortalStrings("admission", locale);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kickerCabinet}</p>
        <h1 className="pt-page-title">{strings.overviewTitle}</h1>
        <p className="pt-page-lead">{strings.overviewLead}</p>
      </header>
      <AiConsentSlot locale={locale} />
      {/* Обзор с подготовками и обращения — соседние серверные компоненты:
          их чтения идут одновременно, а не одно после другого (план A). */}
      <AdmissionOverview actor={actor} locale={locale} />
      <Link className="pt-btn-ghost" href="/portal/package-recovery">{packageStrings(locale).pendingTitle}</Link>
      {/* Якорь #case-help — у самой панели (CaseHelpPanel); на обёртке id нет (#1115). */}
      <div className="pt-adm-case-help"><CaseHelpWorkspace actor={actor} caseId={actor.studentCaseId} student /></div>
    </main>
  );
}

async function AdmissionOverview({ actor, locale }: Readonly<{
  actor: Awaited<ReturnType<typeof requireStudentPortalActor>>;
  locale: Awaited<ReturnType<typeof getLocale>>;
}>) {
  const [overview, preparations] = await Promise.all([
    readStudentPortalOverview().catch(() => undefined),
    readStudentCatalogPreparations(actor.studentCaseId).catch(() => null),
  ]);
  const preparationStrings = getPortalStrings("preparations", locale);
  return (
    <>
      {overview === undefined ? <p className="pt-prep-error" role="status">{preparationStrings.overviewUnavailable}</p> : <OverviewView overview={overview} pending={actor.caseState === "pending"} locale={locale} />}
      <PreparationList items={preparations} strings={preparationStrings} />
    </>
  );
}
