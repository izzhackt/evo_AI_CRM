import Link from "next/link";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readAdmissionsPlaybooks, readAdmissionsWorkspace } from "@/lib/v3/admissions-source";
import { AdmissionsRoutePanel } from "./AdmissionsRoutePanel";
import { ProfileAdmissionsWorkspacePanel } from "./ProfileAdmissionsWorkspace";
import { ProfileHandoffAcknowledgement } from "./ProfileSalesTransition";
import type { ProfileDraft } from "./types";
import { PartnerPacketsPanel } from "./PartnerPacketsPanel";
import { CaseHelpWorkspace } from "./CaseHelpWorkspace";

export async function ProfileAdmissionsRoute({ actor, draft, studentName }: { actor: ActivePlatformActor; draft: ProfileDraft; studentName: string }) {
  const caseId = draft.admissions?.studentCaseId;
  if (!caseId || actor.presentationRole === "sales") return null;
  const data = await Promise.all([readAdmissionsWorkspace(actor, caseId), readAdmissionsPlaybooks(actor)]).catch(() => null);
  if (!data) return <section role="alert" className="space-y-3 rounded-card border border-border bg-surface p-5"><h3 className="font-semibold text-fg">Не удалось загрузить маршрут</h3><p className="text-sm text-fg-2">Проверьте доступ или повторите загрузку. Данные дела не изменены.</p><Link className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline" href={`/v3/profile?case=${caseId}&tab=route`}>Повторить</Link></section>;
    const [workspace, playbooks] = data;
    const documents = draft.documents.flatMap((group) => group.kind === "active" ? group.items.map((item) => ({ id: item.id, name: item.name, applicationIds: item.caseLinkTargets.filter((target) => target.linked && target.kind === "university_application").map((target) => target.id) })) : []);
    return <div className="space-y-5">
      {draft.handoffAcknowledgement ? <ProfileHandoffAcknowledgement snapshot={draft.handoffAcknowledgement} /> : null}
      <AdmissionsRoutePanel workspace={workspace} playbooks={playbooks} documents={documents} studentName={studentName}>
      <details className="rounded-card border border-border bg-surface p-4 sm:p-5">
        <summary className="min-h-11 cursor-pointer font-semibold text-fg">Заявки, статусы и визовое дело</summary>
        <p className="my-3 text-sm leading-6 text-fg-2">Создайте заявку или визовое дело здесь. Подтверждения партнёра и страны заполняются в маршруте выше. Загруженные документы сами по себе не подтверждают подачу.</p>
        <ProfileAdmissionsWorkspacePanel actorRole={actor.presentationRole} workspace={draft.admissions} />
      </details>
      </AdmissionsRoutePanel>
      <PartnerPacketsPanel actor={actor} caseId={caseId} active={workspace.case.state === "active"} applications={workspace.applications.map(application => ({ id: application.id, name: `${application.institutionName} · ${application.programName}` }))} />
      <CaseHelpWorkspace actor={actor} caseId={caseId} />
    </div>;
}
