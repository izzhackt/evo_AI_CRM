import type { ActivePlatformActor } from "@/lib/platform-auth";
import { randomUUID } from "node:crypto";
import { isStaffPreview, staffCan, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import Link from "next/link";

import { Pill } from "@/components/v3/Pill";
import { TaskComposerDialog } from "@/components/v3/tasks/TaskComposerDialog";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { studentPortalProvisioningRequestId } from "@/lib/server/student-portal-command-ids";
import { personState } from "@/lib/v3/wording";

import { Documents } from "./Documents";
import { ProfileContractWorkspace } from "./ProfileContractWorkspace";
import { ProfileNotes } from "./ProfileNotes";
import { StudentPortalAccessControls } from "./StudentPortalAccessCard";
import { profileNotesSubjectKey } from "./profile-notes-view";
import { Anketa, History, Money, Overview, PlatformAccessCard } from "./tabs";
import { QueueTabStrip } from "../queue/QueueTabStrip";
import { HandoffGateForms } from "./ProfileSalesTransition";
import { LEAD_GATE_ANCHOR, hasHandoffGateForms } from "./lead-work-view";
import {
  profileTabAccess,
  tabsFor,
  type PersonProfile,
  type ProfileDraft,
  type ProfileNotesSnapshot,
  type ProfileContractRetry,
  type ProfileSalesRequestIds,
  type ProfileSalesSnapshot,
  type TabKey,
} from "./types";
import type { PlatformContractMutationOutcome } from "@/lib/platform-contract-workflow";

/**
 * Профиль человека — один на всех, лид он или уже студент.
 *
 * Вкладки, а не одна длинная страница: полей около сорока, и на одном полотне
 * они превращаются в свалку. У каждого поля есть очевидный ящик, и вкладку
 * можно наполнять годами, не переверстывая экран.
 *
 * ВКЛАДКИ — ССЫЛКИ, А НЕ ВИДЖЕТ. Адрес несёт `?tab=`, поэтому вкладку можно
 * переслать, вернуться назад кнопкой браузера и открыть без JavaScript. Роли
 * `tablist`/`tab` здесь были бы неправдой: это переходы по страницам, и
 * читалка должна назвать их ссылками. Текущая помечена `aria-current`.
 *
 * «Файлы» отдельной вкладкой нет намеренно: она перечисляла бы те же файлы,
 * что уже стоят в строках чеклиста документов. Файл живёт при своём пункте.
 *
 * Обзор — маршрутизатор, а не сводка всего: он говорит, что с человеком
 * сейчас и куда идти, но не повторяет содержимое вкладок.
 *
 * НАБОР ВКЛАДОК ЗАВИСИТ ОТ ЧЕЛОВЕКА. Документы заводятся на дело студента,
 * поэтому у лида вкладки «Документы» нет вовсе — ни пустой, ни с
 * объяснением, почему она пустая. Список считает `tabsFor`, он же страхует:
 * вкладка, которой у этого человека нет, показывает обзор.
 */
export function Profile({
  profile,
  draft,
  sales,
  actor,
  organizationId,
  studentPortalCurators,
  studentPortalCuratorsAvailable,
  requestIds,
  noteRequestId,
  notes,
  notesOlderHref,
  notesLatestHref,
  contractResult,
  contractRetry,
  tab,
  hrefFor,
  universityProgramsTab,
  caseHeader,
  caseOverview,
  headerMenu,
}: {
  profile: PersonProfile;
  /** «Вузы и программы» (unified workflow S4) — replaces the old «Маршрут» tab content. */
  universityProgramsTab?: React.ReactNode;
  /**
   * Сводка над вкладками — дела (`?case=`) или лида (`?id=`, Lead 360 Э4:
   * `leadWorkParts`); заменяет обычную шапку профиля.
   */
  caseHeader?: React.ReactNode;
  /**
   * «Обзор» дела студента (`?case=`, решение владельца 26.09.2026): сначала
   * работа. Вид лида (`?id=`) с Э4 (27.09.2026) получает свой — `leadWorkParts`.
   */
  caseOverview?: React.ReactNode;
  /** «⋯» лида в шапке (`?id=`): «Закрыть лид» (миграция 246). */
  headerMenu?: React.ReactNode;
  /** Canonical projections not represented directly in `PersonProfile`. */
  draft: ProfileDraft;
  sales: ProfileSalesSnapshot | null;
  actor: ActivePlatformActor;
  organizationId: string;
  studentPortalCurators: readonly Readonly<{
    membershipId: string;
    displayName: string;
  }>[];
  studentPortalCuratorsAvailable: boolean;
  requestIds: ProfileSalesRequestIds;
  noteRequestId: string;
  notes: ProfileNotesSnapshot;
  notesOlderHref: string | null;
  notesLatestHref: string | null;
  contractResult?: PlatformContractMutationOutcome;
  contractRetry?: ProfileContractRetry;
  tab: TabKey;
  hrefFor: (tab: string) => string;
}) {
  // Вид лида (`?id=`): формы подтверждения вручную — наверху «Договора и
  // оплаты» (Э8.4), и вкладка есть у каждого, у кого они есть.
  const leadGate = sales !== null && draft.routeTarget.leadId !== null && hasHandoffGateForms(sales.gate, isStaffPreview(actor))
    ? sales.gate : null;
  const tabAccess = profileTabAccess(draft.access, {
    financeConfirm: !isStaffPreview(actor) && !!sales?.handoff.caseId && staffHasPermission(actor, "finance.event.confirm"),
    gateForms: leadGate !== null,
  });
  const tabs = tabsFor(profile.student, tabAccess, draft.admissions !== null);
  // Лид без дела: договора и платежей дела нет — пустой блок «Все обязательства по делу» не рисуется.
  const leadWithoutCase = draft.routeTarget.leadId !== null && !profile.student;
  const current = tabs.some((entry) => entry.key === tab) ? tab : "overview";
  if (current === "money" && draft.access.contract && draft.contract === null) {
    throw new Error("V3 contract section has no canonical contract workspace.");
  }

  const state = personState({
    hasCase: profile.student,
    caseStatus: profile.caseStatus,
    leadStage: profile.stage,
  });
  // Э7: тот же диалог «Новая задача» с делом, что у «+ Задача» дела; команда
  // создания требует `task.create` (одного `task.manage` для неё мало).
  const taskCaseId = !isStaffPreview(actor) && staffHasPermission(actor, "task.create") ? draft.admissions?.studentCaseId ?? null : null;
  const uploadAccess = draft.admissions?.caseState !== "active"
    ? "closed" as const
    : !isStaffPreview(actor) && staffHasPermission(actor, "document.upload")
      ? "allowed" as const
      : "forbidden" as const;

  return (
    <div
      className="flex flex-col gap-4"
      data-lead-id={profile.leadId}
      data-testid="v3-profile"
    >
      {caseHeader ?? (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="t-record-title min-w-0 text-fg">
            {profile.person}
          </h2>
          <p className="text-sm text-fg-3">{state}</p>
          {profile.financeStop ? (
            <Pill tone="danger">финансовый стоп</Pill>
          ) : null}
          {taskCaseId ? (
            <span className="ms-auto">
              <TaskComposerDialog
                actor={actor} actorMembershipId={actor.membershipId} day={dayInOrganizationTimezone(new Date())}
                staffAllowed={false} caseAllowed
                initialCase={{ id: taskCaseId, name: profile.person }}
                triggerLabel="Задача по студенту"
                triggerClassName="inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              />
            </span>
          ) : null}
          {headerMenu ? <div className={taskCaseId ? "self-center" : "ms-auto self-center"}>{headerMenu}</div> : null}
        </header>
      )}

      {/* Вкладки — тот же ряд, что у вкладок-видов очередей (`QueueTabStrip`,
          Э8.4): 44 px, не переносится, лишнее прокручивается вбок без полосы
          прокрутки, у края с продолжением ряд гаснет, текущая вкладка видна.
          Прокрутка обрезает внешнюю рамку фокуса — `focusable` рисует её
          внутри вкладки (v3.css). */}
      <QueueTabStrip label="Разделы профиля" focusable testId="v3-profile-tabs">
        <ul className="flex min-w-max items-center gap-1 border-b border-border pb-2">
          {tabs.map((entry) => (
            <li key={entry.key}>
              <Link
                href={hrefFor(entry.key)}
                aria-current={entry.key === current ? "page" : undefined}
                className="v3-choice inline-flex min-h-11 items-center whitespace-nowrap rounded-nav px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg"
              >
                {entry.title}
              </Link>
            </li>
          ))}
        </ul>
      </QueueTabStrip>

      {current === "route" ? universityProgramsTab : null}
      {current === "overview" && caseOverview ? caseOverview : null}
      {current === "overview" && !caseOverview ? (
        <div className="space-y-4">
          {sales || draft.admissions || draft.studentApplication ? (
            <PlatformAccessCard
              application={draft.studentApplication}
              requestId={requestIds.platformAccess}
              readOnly={isStaffPreview(actor) || sales === null}
              leadId={sales?.lead.leadId ?? null}
              leadCabinetCase={draft.admissions ? {
                studentCaseId: draft.admissions.studentCaseId,
                state: draft.admissions.caseState,
              } : draft.leadCabinetCase}
              prepareRequestId={requestIds.prepareLeadCabinet}
              caseLink={staffPresentationCan(actor, "admissions.read")}
            >
              {!isStaffPreview(actor) &&
              profile.student &&
              draft.admissions &&
              (actor.systemRole === "admin" ||
                (draft.admissions.isCabinetCase && staffCan(actor, "sales.write"))) ? (
                <StudentPortalAccessControls
                  organizationId={organizationId}
                  studentCaseId={draft.admissions.studentCaseId}
                  email={profile.email}
                  displayName={profile.person}
                  caseState={draft.admissions.caseState}
                  isCabinetCase={draft.admissions.isCabinetCase}
                  requestId={studentPortalProvisioningRequestId(
                    organizationId,
                    draft.admissions.studentCaseId,
                  )}
                  curatorOptions={studentPortalCurators}
                  curatorOptionsAvailable={studentPortalCuratorsAvailable}
                />
              ) : !isStaffPreview(actor) && !draft.admissions && draft.leadCabinetCase?.cabinetInvite ? (
                // Решение владельца C (миграция 248): ожидающий кабинет лида —
                // приглашение отсюда же, у Sales с правом на этот лид.
                <StudentPortalAccessControls
                  organizationId={organizationId}
                  studentCaseId={draft.leadCabinetCase.studentCaseId}
                  email={profile.email}
                  displayName={profile.person}
                  caseState="pending"
                  isCabinetCase
                  requestId={studentPortalProvisioningRequestId(
                    organizationId,
                    draft.leadCabinetCase.studentCaseId,
                  )}
                  curatorOptions={[]}
                  curatorOptionsAvailable
                />
              ) : null}
            </PlatformAccessCard>
          ) : null}
          <Overview
            profile={profile}
            draft={draft}
            sales={sales}
            actor={actor}
            requestIds={requestIds}
            tabHref={hrefFor}
          />
          <ProfileNotes
            key={profileNotesSubjectKey(notes.subject)}
            notes={notes}
            requestId={noteRequestId}
            olderHref={notesOlderHref}
            latestHref={notesLatestHref}
          />
        </div>
      ) : null}
      {current === "anketa" ? <Anketa profile={profile} draft={draft}
        fieldsRequestId={randomUUID()}
        fieldsReadOnly={isStaffPreview(actor) || !staffHasPermission(actor, "profile.manage")}
        documentsHref={draft.access.documents ? hrefFor("documents") : null} /> : null}
      {current === "documents" ? (
        <Documents
          groups={draft.documents}
          uploadAccess={uploadAccess}
          studentCaseId={draft.admissions?.studentCaseId ?? null}
          actor={actor}
          recognition={!isStaffPreview(actor) && ["admin", "staff"].includes(actor.systemRole)
            && draft.admissions && ["case.read.full", "profile.read.full", "document.read.full"].every(key => staffHasPermission(actor, key))
            ? { studentCaseId: draft.admissions.studentCaseId, profileRevision: draft.profileFields?.profile?.revision ?? null,
              canEnqueue: draft.admissions.caseState === "active" && draft.profileFields?.canReview === true
                && ["profile.manage", "document.download", "document.extract"].every(key => staffHasPermission(actor, key)),
              reviewHref: hrefFor("anketa") } : null}
        />
      ) : null}
      {current === "money" && leadGate ? (
        // Подтверждение вручную (Э8.4) — одно место для договора и оплаты лида
        // вместе с полосой «Передача»: туда ведёт её «Изменить».
        <section id={LEAD_GATE_ANCHOR} aria-labelledby={`${LEAD_GATE_ANCHOR}-title`} className="max-w-3xl scroll-mt-4" data-testid="v3-lead-gate">
          <h2 id={`${LEAD_GATE_ANCHOR}-title`} className="t-section text-fg">Подтверждение вручную</h2>
          <p className="mt-1 t-body-compact text-fg-2">
            Договор, затем первый платёж — доказательства передачи в поступление, если их нет в деле и в отчёте продаж.
          </p>
          <div className="mt-3 border-t border-border pt-3">
            <HandoffGateForms actor={actor} gate={leadGate} requestIds={requestIds} bare />
          </div>
        </section>
      ) : null}
      {current === "money" && leadWithoutCase && !leadGate ? (
        <p className="t-body-compact text-fg-2" data-testid="v3-lead-money-empty">
          Договор и платежи ведутся в деле студента; у этого лида дела пока нет.
        </p>
      ) : null}
      {current === "money" && !leadWithoutCase ? (
        <Money profile={profile} draft={draft} actor={actor} salesCaseId={sales?.handoff.caseId}
          // На деле студента условия продажи лежат в свёрнутом разделе «Данные продажи»: `panel=sales` раскрывает его.
          // В Lead 360 (Э4) якорь `#sale-conditions` раскрывает свою группу правки сам.
          saleConditionsHref={draft.saleConditions ? `${hrefFor("overview")}${caseOverview && draft.routeTarget.studentCaseId ? "&panel=sales" : ""}#sale-conditions` : null}
          financeVisible={!profile.student || tabAccess.finance}
          contractWorkspace={draft.access.contract && draft.contract ? (
            <ProfileContractWorkspace
              snapshot={draft.contract}
              actor={actor}
              organizationId={organizationId}
              result={contractResult}
              retry={contractRetry}
            />
          ) : null} />
      ) : null}
      {current === "history" ? <History profile={profile} /> : null}
    </div>
  );
}
