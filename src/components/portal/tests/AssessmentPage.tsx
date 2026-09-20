import { notFound } from "next/navigation";

import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { isAssessmentUuid, type StudentAssessmentKey } from "@/lib/student-assessment-contract";
import { readStudentAssessmentAttempt, readStudentAssessments } from "@/lib/v3/student-assessment-source";

import { AssessmentRunner } from "./AssessmentRunner";

/**
 * Серверная сборка экрана теста в «Атласе» (PORT-8c): та же выборка
 * catalog/attempt и те же guard'ы, что у прежнего v3-экрана; заголовок и
 * описание — контент read model, подписи — неймспейс tests (RU/KY).
 */
export async function AssessmentPage({ instrumentKey, searchParams }: {
  instrumentKey: StudentAssessmentKey;
  searchParams: Promise<{ attempt?: string; new?: string }>;
}) {
  const [catalog, search, locale] = await Promise.all([readStudentAssessments(), searchParams, getLocale()]);
  const strings = getPortalStrings("tests", locale);
  const instrument = catalog.instruments.find(i => i.instrumentKey === instrumentKey);
  if (!instrument) {
    return (
      <main className="pt-page">
        <header className="pt-page-header">
          <p className="pt-page-kicker">{strings.kicker}</p>
          <h1 className="pt-page-title">{strings.unavailableTitle}</h1>
          <p className="pt-page-lead">{strings.unavailableLead}</p>
        </header>
        <p className="pt-run-text">{strings.unavailableBody}</p>
      </main>
    );
  }
  const attemptId = search.attempt ?? (search.new === "1" ? null : instrument.draftAttemptId);
  if (attemptId && !isAssessmentUuid(attemptId)) notFound();
  const attempt = attemptId ? await readStudentAssessmentAttempt(attemptId) : null;
  if (attempt && attempt.instrumentKey !== instrumentKey) notFound();
  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{attempt?.metadata.title ?? instrument.metadata.title}</h1>
        <p className="pt-page-lead">{attempt?.metadata.description ?? instrument.metadata.description}</p>
      </header>
      <AssessmentRunner
        key={attempt?.attemptId ?? `${instrumentKey}-new`}
        instrument={instrument}
        initialAttempt={attempt}
        locale={locale}
      />
    </main>
  );
}
