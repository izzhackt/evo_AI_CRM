import type { ReactNode } from "react";

import { isStaffPreview, staffCan, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CaseClosure } from "@/lib/platform-closure-contract";

import { ApplicationDecision } from "../admissions/StudentApplications";
import type { NextStepAccess } from "../students/students-queue-view";
import { TaskComposerDialog } from "../tasks/TaskComposerDialog";
import { CaseHeader } from "./CaseHeader";
import { CaseOverview } from "./CaseOverview";
import { ProfileNotes } from "./ProfileNotes";
import { StudentPortalAccessControls } from "./StudentPortalAccessCard";
import { caseApplicationLines, caseChecklistCounts, casePortalStatus, type CaseWorkRead } from "./case-work-view";
import { profileNotesSubjectKey } from "./profile-notes-view";
import { SalesOverview } from "./tabs";
import { tabsFor, type PersonProfile, type ProfileDraft, type ProfileNotesSnapshot, type ProfileSalesRequestIds, type ProfileSalesSnapshot } from "./types";

const TASK_TRIGGER = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

export type CaseWorkPartsInput = Readonly<{
  actor: ActivePlatformActor;
  profile: PersonProfile;
  draft: ProfileDraft;
  sales: ProfileSalesSnapshot | null;
  work: CaseWorkRead;
  stepAccess: NextStepAccess;
  requestIds: ProfileSalesRequestIds & Readonly<{ step: string; assignCurator: string; portal: string; note: string }>;
  notes: ProfileNotesSnapshot;
  notesOlderHref: string | null;
  notesLatestHref: string | null;
  curators: readonly Readonly<{ membershipId: string; displayName: string }>[];
  curatorsAvailable: boolean;
  /** Закрытие дела (246) для строки фактов; null — не прочитано. */
  closure?: CaseClosure | null;
  hrefFor: (tab: string) => string;
  /** `?panel=sales`: раскрыть «Данные продажи» (переход из «Договор и оплата»). */
  salesDataOpen: boolean;
  /** «Обращения студента» (`CaseHelpWorkspace` — своё чтение); null — не показываются. */
  help: ReactNode;
}>;

/**
 * Дело студента (`?case=`) из прочитанных данных: строка фактов под именем и
 * «Обзор» «сначала работа» (решение владельца 26.09.2026). Права здесь —
 * подсказки интерфейса, те же, что у прежних блоков этих команд; каждую
 * запись проверяет сервер. Сборка без запросов: её вызывает страница и
 * статический рендер с синтетикой.
 */
export function caseWorkParts(input: CaseWorkPartsInput): Readonly<{ header: ReactNode; overview: ReactNode }> {
  const { actor, profile, draft, sales, work } = input;
  const admissions = draft.admissions;
  if (!admissions) return { header: null, overview: null };
  const caseId = admissions.studentCaseId;
  const preview = isStaffPreview(actor);
  const admin = actor.systemRole === "admin" && !preview;
  const tabs = tabsFor(profile.student, {
    ...draft.access,
    finance: draft.access.finance || (!preview && !!sales?.handoff.caseId && staffHasPermission(actor, "finance.event.confirm")),
  }, true).map((tab) => tab.key);
  const salesVisible = sales !== null && staffPresentationCan(actor, "sales.read");

  const portalControls = !preview && (actor.systemRole === "admin" || (admissions.isCabinetCase && staffCan(actor, "sales.write")));
  const application = draft.studentApplication;
  const portalSettings = portalControls || application?.status === "pending" || (application?.status === "rejected" && application.decisionReason) ? (
    <div className="space-y-3 rounded-ctl border border-border">
      {application?.status === "pending" && !preview && sales !== null ? (
        <div className="p-4"><ApplicationDecision application={application} requestId={input.requestIds.platformAccess} /></div>
      ) : null}
      {application?.status === "rejected" && application.decisionReason ? (
        <p className="whitespace-pre-wrap break-words p-4 t-body-compact text-fg-2">{application.decisionReason}</p>
      ) : null}
      {portalControls ? (
        <StudentPortalAccessControls
          organizationId={actor.organizationId}
          studentCaseId={caseId}
          email={profile.email}
          displayName={profile.person}
          caseState={admissions.caseState}
          isCabinetCase={admissions.isCabinetCase}
          requestId={input.requestIds.portal}
          curatorOptions={input.curators}
          curatorOptionsAvailable={input.curatorsAvailable}
        />
      ) : null}
    </div>
  ) : null;

  const header = (
    <CaseHeader
      studentCaseId={caseId}
      state={admissions.caseState}
      direction={admissions.direction}
      curatorName={draft.responsible}
      fallbackStep={profile.nextAction}
      financeStop={profile.financeStop}
      work={work}
      stepAccess={input.stepAccess}
      stepRequestId={input.requestIds.step}
      coverage={admin && staffHasPermission(actor, "case.curator.assign")}
      curators={input.curators}
      assignCuratorRequestId={input.requestIds.assignCurator}
      closure={input.closure ?? null}
    />
  );

  const overview = (
    <CaseOverview
      studentCaseId={caseId}
      work={work}
      handoff={draft.handoffAcknowledgement}
      taskPermissions={{
        actorMembershipId: actor.membershipId, admin, preview,
        staffComplete: staffHasPermission(actor, "staff.task.complete"), staffEdit: staffHasPermission(actor, "staff.task.edit"),
        caseManage: staffHasPermission(actor, "task.manage"), caseAssign: staffHasPermission(actor, "task.assign"),
      }}
      createTask={!preview && staffHasPermission(actor, "task.create") ? (
        <TaskComposerDialog
          participants={[]} actorMembershipId={actor.membershipId} actor={actor} day={work.today}
          staffAllowed={false} caseAllowed
          initialCase={{ id: caseId, name: profile.person }}
          initialCaseAssignees={work.tasks.kind === "ready" ? work.tasks.assignees : []}
          triggerLabel="+ Задача"
          triggerClassName={TASK_TRIGGER}
        />
      ) : null}
      documents={draft.access.documents ? caseChecklistCounts(draft.documents) : null}
      applications={caseApplicationLines(admissions.applications)}
      payment={draft.access.finance ? { percent: draft.paidPercent, remaining: draft.remaining, financeStop: profile.financeStop } : null}
      contacts={{ phone: profile.phone, email: profile.email }}
      portal={application !== null || portalControls ? { ...casePortalStatus(application), settings: portalSettings } : null}
      sales={salesVisible && sales ? { manager: sales.lead.currentOwnerDisplayName, nextAction: sales.lead.nextActionText } : null}
      salesData={salesVisible && sales ? <SalesOverview profile={profile} sales={sales} draft={draft} actor={actor} requestIds={input.requestIds} quiet /> : null}
      salesDataOpen={input.salesDataOpen}
      help={input.help}
      notes={(
        <ProfileNotes
          key={profileNotesSubjectKey(input.notes.subject)}
          notes={input.notes}
          requestId={input.requestIds.note}
          olderHref={input.notesOlderHref}
          latestHref={input.notesLatestHref}
          quiet
        />
      )}
      hrefs={{
        documents: tabs.includes("documents") ? input.hrefFor("documents") : null,
        route: tabs.includes("route") ? input.hrefFor("route") : null,
        money: tabs.includes("money") ? input.hrefFor("money") : null,
        messages: `/v3/messages?case=${encodeURIComponent(caseId)}`,
      }}
    />
  );
  return { header, overview };
}
