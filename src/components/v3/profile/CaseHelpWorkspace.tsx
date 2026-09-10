import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { ActiveStudentPortalActor } from "@/lib/student-portal-auth";
import { readCaseHelp } from "@/lib/v3/case-operations-source";
import { CaseHelpPanel } from "./CaseHelpPanel";

export async function CaseHelpWorkspace({ actor, caseId, student = false }: {
  actor: ActivePlatformActor | ActiveStudentPortalActor; caseId: string; student?: boolean;
}) {
  const page = await readCaseHelp(actor, caseId).catch(() => null);
  if (!page) return <section id="case-help" className="rounded-card border border-border bg-surface p-4"><h3 className="font-semibold text-fg">Помощь по делу</h3><p role="alert" className="mt-2 text-sm text-danger">Обращения пока недоступны. Обновите страницу, чтобы повторить чтение.</p></section>;
  return <CaseHelpPanel initialPage={page} student={student} />;
}
