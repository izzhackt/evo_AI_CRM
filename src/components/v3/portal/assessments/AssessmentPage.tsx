import { notFound } from "next/navigation";
import { PortalPage } from "../PortalPage";
import { AssessmentRunner } from "./AssessmentRunner";
import { isAssessmentUuid, type StudentAssessmentKey } from "@/lib/student-assessment-contract";
import { readStudentAssessmentAttempt, readStudentAssessments } from "@/lib/v3/student-assessment-source";

export async function AssessmentPage({ instrumentKey, searchParams }: { instrumentKey: StudentAssessmentKey; searchParams: Promise<{ attempt?: string; new?: string }> }) {
  const [catalog, search] = await Promise.all([readStudentAssessments(), searchParams]);
  const instrument = catalog.instruments.find(i => i.instrumentKey === instrumentKey);
  if (!instrument) return <PortalPage title="Тест пока недоступен" description="Мы готовим задания. Ваши предыдущие результаты сохранены."><p className="text-sm text-fg-2">Вернитесь к разделу «Тесты» позже.</p></PortalPage>;
  const attemptId = search.attempt ?? (search.new === "1" ? null : instrument.draftAttemptId);
  if (attemptId && !isAssessmentUuid(attemptId)) notFound();
  const attempt = attemptId ? await readStudentAssessmentAttempt(attemptId) : null;
  if (attempt && attempt.instrumentKey !== instrumentKey) notFound();
  return <PortalPage title={attempt?.metadata.title ?? instrument.metadata.title} description={attempt?.metadata.description ?? instrument.metadata.description}>
    <AssessmentRunner key={attempt?.attemptId ?? `${instrumentKey}-new`} instrument={instrument} initialAttempt={attempt} />
  </PortalPage>;
}
