import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { isStaffPreview, staffCan, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CaseClosure } from "@/lib/platform-closure-contract";
import { caseDocumentsAwaitCurator } from "@/lib/v3/case-access-contract";

import { ApplicationDecision } from "../admissions/StudentApplications";
import { studentsHandoffPending, type NextStepAccess } from "../students/students-queue-view";
import { TaskComposerDialog } from "../tasks/TaskComposerDialog";
import { TaskComposerContextMark } from "../tasks/task-composer-context";
import { DIRECTION_LABELS } from "./admissions-view";
import { CaseAcceptDrawer } from "./CaseAcceptDrawer";
import { CaseHeader, type CaseHeaderInput } from "./CaseHeader";
import { CaseMoreMenu } from "./CaseMoreMenu";
import { CaseHelpNoAccess, CaseOverview, type CaseOverviewInput } from "./CaseOverview";
import { CaseSaleData, CaseSaleUnavailable } from "./CaseSaleData";
import { LeadNoteComposer } from "./LeadNoteComposer";
import { StudentPortalAccessControls } from "./StudentPortalAccessCard";
import {
  CASE_PORTAL_GROUP_ID,
  caseApplicationLines,
  caseChecklistCounts,
  caseContacts,
  caseFeed,
  caseMomentLabel,
  casePortalStatus,
  casePrimaryAction,
  caseSaleBlocks,
  caseSaleSummary,
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
  requestIds: ProfileSalesRequestIds & Readonly<{ step: string; assignCurator: string; portal: string; note: string; direction?: string }>;
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
}>;

/**
 * То, из чего «Новый вид» собирает карточку дела: те же входы шапки и «Обзора» и отметка контекста задач, что
 * получает прежний вид. Чтений и прав здесь нет - данные одни, меняется только разметка (`CaseNext`).
 */
export type CaseNextSource = Readonly<{
  name: string;
  /** `TaskComposerContextMark`: «Создать задачу» меню и Ctrl+K на странице дела - с этим делом. */
  mark: ReactNode;
  header: CaseHeaderInput;
  overview: CaseOverviewInput;
}>;

/**
 * Student 360 (`?case=`, Э4, 27.09.2026) по образцу Lead 360 (#1078) из уже
 * прочитанных данных — три части страницы:
 *
 * - `actions` — у заголовка: одно главное действие по состоянию
 *   (`casePrimaryAction`: «Принять дело» с панелью ответа на передачу),
 *   «Написать», «Задача по делу» и «⋯» («Доступ к порталу», «Завершить дело»);
 * - `header` — над вкладками: этап (дорожка этапа), «Что дальше»,
 *   состояние, назначение куратора делу, которое его ждёт;
 * - `overview` — «Обзор»: работа и лента слева, «Сведения» и группы правки справа.
 *
 * Права — подсказки интерфейса, те же, что у прежних блоков этих команд;
 * каждую запись проверяет сервер. Сборка без запросов: её вызывают страница и
 * статический рендер с синтетикой.
 */
export function caseWorkParts(input: CaseWorkPartsInput): Readonly<{ header: ReactNode; overview: ReactNode; actions: ReactNode; next: CaseNextSource | null }> {
  const { actor, profile, draft, sales, work } = input;
  const admissions = draft.admissions;
  if (!admissions) return { header: null, overview: null, actions: null, next: null };
  const caseId = admissions.studentCaseId;
  const preview = isStaffPreview(actor);
  // Читатель «Ждут куратора» (248/281): назначает куратора, а задачи и заметки дела база ему не даст.
  const assignOnly = draft.assignOnly === true;
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
  const taskAllowed = !preview && !assignOnly && staffHasPermission(actor, "task.create");
  const closable = input.closure?.state === "active" && input.closure.canChange;
  // Направление дела словом - из снимка дела (290: он отдаёт `admissions_direction`); не выбрано - null.
  const direction = admissions.direction ? DIRECTION_LABELS[admissions.direction] : null;
  // «Задать направление» / «Сменить» (292): тому, кто назначает кураторов (Admin и руководитель поступления,
  // `case.curator.assign`), у дела не закрытого и с версией из строки очереди (без неё записать нечем -
  // версия не выдумывается); просмотр роли ничего не пишет. Читатель «Ждут куратора» (`assignOnly`, 248/281)
  // дело читает ради назначения куратора, права `case.read.full` на само дело у него нет, а команда начинается с
  // этого права: ему действие не показывается (сервер ответил бы отказом). Регламент, право и версию проверяет сервер.
  const directionAction = !preview && !assignOnly && staffHasPermission(actor, "case.curator.assign") && input.requestIds.direction
    && work.row !== null && admissions.caseState !== "closed"
    ? { current: admissions.direction ?? null, expectedVersion: work.row.admissionsVersion, requestId: input.requestIds.direction }
    : null;
  // Контекст панели «Принять дело» — из уже прочитанного (передача, направление, шаг, продажа).
  const acceptContext = {
    handedOffBy: draft.handedOffBy ? { ...draft.handedOffBy, label: caseMomentLabel(draft.handedOffBy.at, work.today) } : null,
    direction,
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

  const mark = (
    <TaskComposerContextMark value={{
      case: { id: caseId, name: profile.person },
      caseAssignees: caseAssignees.map(({ membershipId, displayName }) => ({ membershipId, displayName })),
    }} />
  );
  const headerInput: CaseHeaderInput = {
    studentCaseId: caseId,
    state: admissions.caseState,
    fallbackStep: profile.nextAction,
    financeStop: profile.financeStop,
    work,
    stepAccess: input.stepAccess,
    stepRequestId: input.requestIds.step,
    coverage: !preview && staffHasPermission(actor, "case.curator.assign"),
    curators: input.curators,
    assignCuratorRequestId: input.requestIds.assignCurator,
    closure: input.closure ?? null,
    acceptShown: primary === "accept" && handoff !== null,
  };
  const header = (<>
    {mark}
    <CaseHeader {...headerInput} />
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

  // «Данные продажи»: у дела с лидом продаж - прежние формы; у дела прямого студента лид для чтения закрыт
  // (`converted`), условия приходят отдельным чтением дела (290) и видны только чтением, пустое не рисуется.
  const saleBlocks = salesVisible && sales ? [] : draft.saleConditions ? caseSaleBlocks(draft.saleConditions) : [];
  const salesData = salesVisible && sales
    ? <SalesOverview profile={profile} sales={sales} draft={draft} actor={actor} requestIds={input.requestIds} quiet groups />
    : saleBlocks.length > 0 ? <CaseSaleData blocks={saleBlocks} />
      : draft.saleConditionsUnavailable === true ? <CaseSaleUnavailable /> : null;
  const salesDataSummary = salesVisible && sales
    ? sales.lead.currentOwnerDisplayName ?? "менеджер не назначен"
    : saleBlocks.length > 0 ? caseSaleSummary(saleBlocks) : "не прочитаны";

  const overviewInput: CaseOverviewInput = {
    studentCaseId: caseId,
    work,
    handoff,
    taskPermissions: {
      actorMembershipId: actor.membershipId, admin, preview,
      staffComplete: staffHasPermission(actor, "staff.task.complete"), staffEdit: staffHasPermission(actor, "staff.task.edit"),
      caseManage: staffHasPermission(actor, "task.manage"), caseAssign: staffHasPermission(actor, "task.assign"),
    },
    documents: draft.access.documents ? caseChecklistCounts(draft.documents) : null,
    documentsAwaitCurator: caseDocumentsAwaitCurator(admissions.caseState),
    applications: applicationLines,
    payment: draft.access.finance ? { percent: draft.paidPercent, remaining: draft.remaining, financeStop: profile.financeStop } : null,
    // Клиент лида, если лид прочитан; дело прямого студента лида для чтения не имеет — тогда поля анкеты.
    contacts: caseContacts({ phone: profile.phone, email: profile.email }, draft.profileFields),
    direction,
    directionAction,
    curator: {
      name: draft.responsible,
      membershipId: work.row?.currentCuratorMembershipId ?? null,
      coverage: !preview && staffHasPermission(actor, "case.curator.assign"),
    },
    handedOffBy: draft.handedOffBy ?? null,
    portal,
    sales: salesVisible && sales ? { manager: sales.lead.currentOwnerDisplayName, nextAction: sales.lead.nextActionText } : null,
    salesData,
    salesDataSummary,
    salesDataOpen: input.salesDataOpen,
    help: assignOnly ? <CaseHelpNoAccess /> : input.help,
    feed,
    // Та же заметка, что у Lead 360 (Э4): то же действие, субъект и предел; просмотр роли не пишет,
    // читатель «Ждут куратора» тоже (`create_case_note` ему отвечает 42501).
    noteComposer: preview || assignOnly ? null : (
      <LeadNoteComposer key={`${input.notes.subject.leadId ?? ""}:${input.notes.subject.studentCaseId ?? ""}`}
        subject={input.notes.subject} requestId={input.requestIds.note} />
    ),
    notesOlderHref: input.notesOlderHref,
    notesLatestHref: input.notesLatestHref,
    hrefs: {
      documents: tabHref("documents"),
      route: tabHref("route"),
      money: tabHref("money"),
      messages: messagesHref,
      history: input.hrefFor("history"),
    },
  };
  const overview = <CaseOverview {...overviewInput} />;
  return { header, overview, actions, next: { name: profile.person, mark, header: headerInput, overview: overviewInput } };
}
