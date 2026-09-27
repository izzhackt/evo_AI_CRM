import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { isStaffPreview, staffCan, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CaseClosure } from "@/lib/platform-closure-contract";

import { ApplicationDecision } from "../admissions/StudentApplications";
import type { V3Look } from "../blocks/look";
import { studentsHandoffPending, type NextStepAccess } from "../students/students-queue-view";
import { TaskComposerDialog } from "../tasks/TaskComposerDialog";
import { TaskComposerContextMark } from "../tasks/task-composer-context";
import { DIRECTION_LABELS } from "./admissions-view";
import { CaseAcceptDrawer } from "./CaseAcceptDrawer";
import { CaseHeader } from "./CaseHeader";
import { CaseMoreMenu } from "./CaseMoreMenu";
import { CaseOverview } from "./CaseOverview";
import { LeadNoteComposer } from "./LeadNoteComposer";
import { StudentPortalAccessControls } from "./StudentPortalAccessCard";
import {
  CASE_PORTAL_GROUP_ID,
  caseApplicationLines,
  caseChecklistCounts,
  caseFeed,
  caseMomentLabel,
  casePortalStatus,
  casePrimaryAction,
  type CaseWorkRead,
} from "./case-work-view";
import { SalesOverview } from "./tabs";
import { tabsFor, type PersonProfile, type ProfileDraft, type ProfileNotesSnapshot, type ProfileSalesRequestIds, type ProfileSalesSnapshot } from "./types";

/** Переход, который выглядит как спокойная кнопка: 44 px, рамка контрола, без красного (как у Lead 360). */
const ACTION_LINK = "inline-flex min-h-11 items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";
/** Вторичное действие у заголовка: на телефоне — значок 44 px (имя остаётся для чтения с экрана), от `sm` — со словом. */
const ICON_ACTION = `${ACTION_LINK} min-w-11 justify-center`;

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
  /** Закрытие дела (246) для шапки и «⋯»; null — не прочитано. */
  closure?: CaseClosure | null;
  hrefFor: (tab: string) => string;
  /** `?panel=sales`: раскрыть «Данные продажи» (переход из «Договор и оплата»). */
  salesDataOpen: boolean;
  /** «Обращения студента» (`CaseHelpWorkspace` — своё чтение); null — не показываются. */
  help: ReactNode;
  /** Новый облик (Э1.3–Э1.4, предпросмотр Admin): дорожка этапа, срок словом, инициалы, полоса документов. */
  look?: V3Look;
}>;

/**
 * Student 360 (`?case=`, Э4, 27.09.2026) по образцу Lead 360 (#1078) из уже
 * прочитанных данных — три части страницы:
 *
 * - `actions` — у заголовка: одно главное действие по состоянию
 *   (`casePrimaryAction`: «Принять дело» с панелью ответа на передачу),
 *   «Написать», «Задача по делу» и «⋯» («Доступ к порталу», «Завершить дело»);
 * - `header` — над вкладками: этап (дорожка — в новом облике), «Что дальше»,
 *   состояние, назначение куратора делу, которое его ждёт;
 * - `overview` — «Обзор»: работа и лента слева, «Сведения» и группы правки справа.
 *
 * Права — подсказки интерфейса, те же, что у прежних блоков этих команд;
 * каждую запись проверяет сервер. Сборка без запросов: её вызывают страница и
 * статический рендер с синтетикой.
 */
export function caseWorkParts(input: CaseWorkPartsInput): Readonly<{ header: ReactNode; overview: ReactNode; actions: ReactNode }> {
  const { actor, profile, draft, sales, work } = input;
  const admissions = draft.admissions;
  if (!admissions) return { header: null, overview: null, actions: null };
  const caseId = admissions.studentCaseId;
  const preview = isStaffPreview(actor);
  const admin = actor.systemRole === "admin" && !preview;
  const tabs = tabsFor(profile.student, {
    ...draft.access,
    finance: draft.access.finance || (!preview && !!sales?.handoff.caseId && staffHasPermission(actor, "finance.event.confirm")),
  }, true).map((tab) => tab.key);
  const salesVisible = sales !== null && staffPresentationCan(actor, "sales.read");
  const messagesHref = `/v3/messages?case=${encodeURIComponent(caseId)}`;

  const portalControls = !preview && (actor.systemRole === "admin" || (admissions.isCabinetCase && staffCan(actor, "sales.write")));
  const application = draft.studentApplication;
  const portalSettings = portalControls || application?.status === "pending" || (application?.status === "rejected" && application.decisionReason) ? (
    <div className="space-y-3">
      {application?.status === "pending" && !preview && sales !== null ? (
        <ApplicationDecision application={application} requestId={input.requestIds.platformAccess} quiet />
      ) : null}
      {application?.status === "rejected" && application.decisionReason ? (
        <p className="whitespace-pre-wrap break-words t-body-compact text-fg-2">{application.decisionReason}</p>
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
          quiet
        />
      ) : null}
    </div>
  ) : null;
  const portal = application !== null || portalControls ? { ...casePortalStatus(application), settings: portalSettings } : null;

  // --- Действия у заголовка ------------------------------------------------
  const handoff = draft.handoffAcknowledgement;
  const primary = casePrimaryAction({ handoffPending: handoff !== null && studentsHandoffPending(handoff), preview });
  // «Создать задачу» меню и Ctrl+K на странице дела — с этим делом (Э7).
  const caseAssignees = work.tasks.kind === "ready" ? work.tasks.assignees : [];
  const taskAllowed = !preview && staffHasPermission(actor, "task.create");
  const closable = input.closure?.state === "active" && input.closure.canChange;
  // Контекст панели «Принять дело» — из уже прочитанного (передача, направление, шаг, продажа).
  const acceptContext = {
    handedOffBy: draft.handedOffBy ? { ...draft.handedOffBy, label: caseMomentLabel(draft.handedOffBy.at, work.today) } : null,
    direction: admissions.direction ? DIRECTION_LABELS[admissions.direction] : null,
    step: work.row ? work.row.nextAction : profile.nextAction,
    sale: salesVisible && sales ? { manager: sales.lead.currentOwnerDisplayName, nextAction: sales.lead.nextActionText } : null,
  };
  const actions = (
    <div className="flex flex-wrap items-center gap-2" data-testid="v3-case-actions">
      {primary === "accept" && handoff ? <CaseAcceptDrawer name={profile.person} snapshot={handoff} context={acceptContext} /> : null}
      {work.chat.kind !== "forbidden" ? (
        <Link href={messagesHref} className={ICON_ACTION} title="Написать">
          <Icon name="message-circle" size={18} className="shrink-0" />
          <span className="sr-only sm:not-sr-only">Написать</span>
        </Link>
      ) : null}
      {taskAllowed ? (
        // Не «Создать задачу»: так называется общее действие меню в том же экране.
        <TaskComposerDialog
          participants={[]} actorMembershipId={actor.membershipId} actor={actor} day={work.today}
          staffAllowed={false} caseAllowed
          initialCase={{ id: caseId, name: profile.person }}
          initialCaseAssignees={caseAssignees}
          triggerClassName={ICON_ACTION} triggerTitle="Задача по делу" triggerTestId="v3-case-task"
          triggerChildren={<>
            <Icon name="check-square" size={18} className="shrink-0" />
            <span className="sr-only sm:not-sr-only">Задача по делу</span>
          </>}
        />
      ) : null}
      <CaseMoreMenu
        studentCaseId={caseId}
        name={profile.person}
        expectedVersion={closable && input.closure ? input.closure.admissionsVersion : ""}
        closable={closable}
        // Задачи «Обзор» уже прочитал; на других вкладках числа нет — окно скажет правило без числа.
        openTasks={work.tasks.kind === "ready" ? work.tasks.tasks.length : null}
        portalGroupId={portal?.settings ? CASE_PORTAL_GROUP_ID : null}
        portalHref={`${input.hrefFor("overview")}#${CASE_PORTAL_GROUP_ID}`}
      />
    </div>
  );

  const header = (<>
    <TaskComposerContextMark value={{
      case: { id: caseId, name: profile.person },
      caseAssignees: caseAssignees.map(({ membershipId, displayName }) => ({ membershipId, displayName })),
    }} />
    <CaseHeader
      studentCaseId={caseId}
      state={admissions.caseState}
      fallbackStep={profile.nextAction}
      financeStop={profile.financeStop}
      work={work}
      stepAccess={input.stepAccess}
      stepRequestId={input.requestIds.step}
      coverage={!preview && staffHasPermission(actor, "case.curator.assign")}
      curators={input.curators}
      assignCuratorRequestId={input.requestIds.assignCurator}
      closure={input.closure ?? null}
      look={input.look}
    />
  </>);

  // --- Лента ---------------------------------------------------------------
  const firstNotesPage = input.notesLatestHref === null;
  const tabHref = (tab: (typeof tabs)[number]) => tabs.includes(tab) ? input.hrefFor(tab) : null;
  const applicationLines = caseApplicationLines(admissions.applications);
  const feed = caseFeed({
    notes: input.notes.rows,
    firstPage: firstNotesPage,
    activity: work.activity ?? { kind: "not_read" },
    documents: draft.access.documents ? draft.documents : null,
    handoffAnswer: handoff?.current ? { decision: handoff.current.decision, createdAt: handoff.current.createdAt } : null,
    chat: work.chat,
    // Строка ленты ведёт к своему объекту: те же адреса вкладок с возвратом, что у «Сведений».
    links: { route: tabHref("route"), money: tabHref("money"), documents: tabHref("documents"), messages: messagesHref },
    applications: applicationLines,
  });

  const overview = (
    <CaseOverview
      studentCaseId={caseId}
      work={work}
      handoff={handoff}
      taskPermissions={{
        actorMembershipId: actor.membershipId, admin, preview,
        staffComplete: staffHasPermission(actor, "staff.task.complete"), staffEdit: staffHasPermission(actor, "staff.task.edit"),
        caseManage: staffHasPermission(actor, "task.manage"), caseAssign: staffHasPermission(actor, "task.assign"),
      }}
      documents={draft.access.documents ? caseChecklistCounts(draft.documents) : null}
      applications={applicationLines}
      payment={draft.access.finance ? { percent: draft.paidPercent, remaining: draft.remaining, financeStop: profile.financeStop } : null}
      contacts={{ phone: profile.phone, email: profile.email }}
      direction={admissions.direction}
      curator={{
        name: draft.responsible,
        membershipId: work.row?.currentCuratorMembershipId ?? null,
        coverage: !preview && staffHasPermission(actor, "case.curator.assign"),
      }}
      handedOffBy={draft.handedOffBy ?? null}
      portal={portal}
      sales={salesVisible && sales ? { manager: sales.lead.currentOwnerDisplayName, nextAction: sales.lead.nextActionText } : null}
      salesData={salesVisible && sales ? <SalesOverview profile={profile} sales={sales} draft={draft} actor={actor} requestIds={input.requestIds} quiet /> : null}
      salesDataOpen={input.salesDataOpen}
      help={input.help}
      look={input.look}
      feed={feed}
      // Та же заметка, что у Lead 360 (Э4): то же действие, субъект и предел; просмотр роли не пишет.
      noteComposer={preview ? null : (
        <LeadNoteComposer key={`${input.notes.subject.leadId ?? ""}:${input.notes.subject.studentCaseId ?? ""}`}
          subject={input.notes.subject} requestId={input.requestIds.note} />
      )}
      notesOlderHref={input.notesOlderHref}
      notesLatestHref={input.notesLatestHref}
      hrefs={{
        documents: tabHref("documents"),
        route: tabHref("route"),
        money: tabHref("money"),
        messages: messagesHref,
        history: input.hrefFor("history"),
      }}
    />
  );
  return { header, overview, actions };
}
