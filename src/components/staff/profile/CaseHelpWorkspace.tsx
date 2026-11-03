import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { ActiveStudentPortalActor } from "@/lib/student-portal-auth";
import { readCaseHelp } from "@/lib/v3/case-operations-source";
import { CaseHelpPanel } from "./CaseHelpPanel";

export async function CaseHelpWorkspace({ actor, caseId, student = false }: {
  actor: ActivePlatformActor | ActiveStudentPortalActor; caseId: string; student?: boolean;
}) {
  const page = await readCaseHelp(actor, caseId).catch(() => null);
  if (!page) return student
    ? <section id="case-help" className="rounded-card border border-border bg-surface p-4"><h3 className="font-semibold text-fg">Помощь по делу</h3><p role="alert" className="mt-2 text-sm text-danger">Обращения пока недоступны. Обновите страницу, чтобы повторить чтение.</p></section>
    : <section id="case-help" className="border-y border-border py-3"><h3 className="text-sm font-semibold text-fg">Обращения студента</h3><p role="alert" className="mt-1 text-sm text-danger">Обращения не загрузились. Обновите страницу.</p></section>;
  return <CaseHelpPanel key={`${actor.organizationId}:${actor.authUserId}:${caseId}:${student ? "student" : "staff"}`} initialPage={page} student={student} />;
}
