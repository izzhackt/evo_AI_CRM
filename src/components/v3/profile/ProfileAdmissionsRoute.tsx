import Link from "next/link";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readAdmissionsPlaybooks, readAdmissionsWorkspace } from "@/lib/v3/admissions-source";
import { AdmissionsRoutePanel } from "./AdmissionsRoutePanel";
import { ProfileAdmissionsWorkspacePanel } from "./ProfileAdmissionsWorkspace";
import { ProfileHandoffAcknowledgement } from "./ProfileSalesTransition";
import type { ProfileDraft } from "./types";
import { PartnerPacketsPanel } from "./PartnerPacketsPanel";
import { withDocsSection } from "./admissions-view";

function retryHref(caseId: string, docsMode: boolean, packetsInitiallyOpen: boolean): string {
  return withDocsSection(`/v3/profile?case=${caseId}&tab=route${packetsInitiallyOpen ? "&panel=packets#partner-packets" : ""}`, docsMode);
}

/**
 * Вкладка «Маршрут» — независимые разделы, не одно чтение на всех.
 *
 * Этап и плейбук (`AdmissionsRoutePanel`), заявки/виза (уже в `draft.admissions`,
 * без нового чтения) и пакеты партнёру (`PartnerPacketsPanel`) читаются и падают
 * порознь: недоступный этап маршрута не гасит уже загруженные заявки, а
 * недоступные пакеты не гасят этап. Раньше один `Promise.all` с одним `catch`
 * превращал любой частичный сбой в пустую вкладку.
 *
 * При успешном чтении этапа канонические формы заявок/визы остаются внутри
 * панели маршрута: открытый редактор этапа или идущий refresh блокируют их
 * (fieldset), чтобы параллельная правка не ловила stale-version. Только при
 * сбое чтения этапа раздел рендерится самостоятельно.
 */
export async function ProfileAdmissionsRoute({ actor, draft, studentName, docsMode = false, packetsInitiallyOpen = false }: { actor: ActivePlatformActor; draft: ProfileDraft; studentName: string; docsMode?: boolean; packetsInitiallyOpen?: boolean }) {
  const caseId = draft.admissions?.studentCaseId;
  if (!caseId || actor.presentationRole === "sales") return null;
  const [workspace, playbooks] = await Promise.all([
    readAdmissionsWorkspace(actor, caseId).catch(() => null),
    readAdmissionsPlaybooks(actor).catch(() => []),
  ]);
  const documents = draft.documents.flatMap((group) => group.kind === "active" ? group.items.map((item) => ({ id: item.id, name: item.name, applicationIds: item.caseLinkTargets.filter((target) => target.linked && target.kind === "university_application").map((target) => target.id) })) : []);

  const workspaceIntro = <>
    <h3 className="font-semibold text-fg">Заявки, статусы и визовое дело</h3>
    <p className="text-sm leading-6 text-fg-2">Создайте заявку или визовое дело здесь. Подтверждения партнёра и страны заполняются в этапе маршрута выше. Загруженные документы сами по себе не подтверждают подачу.</p>
  </>;

  return <div className="space-y-5">
    {draft.handoffAcknowledgement ? <ProfileHandoffAcknowledgement snapshot={draft.handoffAcknowledgement} /> : null}

    {workspace ? (
      <AdmissionsRoutePanel workspace={workspace} playbooks={playbooks} documents={documents} studentName={studentName}>
        <section id="admissions-workspace" className="space-y-3">
          {workspaceIntro}
          <ProfileAdmissionsWorkspacePanel actor={actor} workspace={draft.admissions} />
        </section>
      </AdmissionsRoutePanel>
    ) : (
      <>
        <section role="alert" className="space-y-3 rounded-card border border-border bg-surface p-5">
          <h3 className="font-semibold text-fg">Не удалось загрузить этап маршрута</h3>
          <p className="text-sm text-fg-2">Заявки, виза и пакеты партнёру ниже читаются отдельно и могут быть доступны. Данные дела не изменены.</p>
          <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline" href={retryHref(caseId, docsMode, packetsInitiallyOpen)}>Повторить</Link>
        </section>
        <section id="admissions-workspace" className="space-y-3">
          {workspaceIntro}
          <ProfileAdmissionsWorkspacePanel actor={actor} workspace={draft.admissions} />
        </section>
      </>
    )}

    <PartnerPacketsPanel actor={actor} caseId={caseId} active={draft.admissions?.caseState === "active"} initiallyOpen={packetsInitiallyOpen} applications={(draft.admissions?.applications ?? []).map((application) => ({ id: application.universityApplicationId, name: `${application.institutionName} · ${application.programName}` }))} />
  </div>;
}
