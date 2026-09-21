import type { ActivePlatformActor } from "@/lib/platform-auth";
import { randomUUID } from "node:crypto";
import { isStaffPreview, staffCan, staffHasPermission } from "@/lib/platform-access";
import Link from "next/link";

import { Pill } from "@/components/v3/Pill";
import { studentPortalProvisioningRequestId } from "@/lib/server/student-portal-command-ids";
import { personState } from "@/lib/v3/wording";

import { Documents } from "./Documents";
import { ProfileContractWorkspace } from "./ProfileContractWorkspace";
import { ProfileNotes } from "./ProfileNotes";
import { StudentPortalAccessControls } from "./StudentPortalAccessCard";
import { profileNotesSubjectKey } from "./profile-notes-view";
import { Anketa, History, Money, Overview, PlatformAccessCard } from "./tabs";
import {
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
}: {
  profile: PersonProfile;
  /** «Вузы и программы» (unified workflow S4) — replaces the old «Маршрут» tab content. */
  universityProgramsTab?: React.ReactNode;
  /** Сводка дела над вкладками для `?case=`-целей; заменяет обычную шапку профиля. */
  caseHeader?: React.ReactNode;
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
  const tabAccess = {
    ...draft.access,
    finance: draft.access.finance || (!isStaffPreview(actor) && !!sales?.handoff.caseId
      && staffHasPermission(actor, "finance.event.confirm")),
  };
  const tabs = tabsFor(profile.student, tabAccess, draft.admissions !== null);
  const current = tabs.some((entry) => entry.key === tab) ? tab : "overview";
  if (current === "money" && draft.access.contract && draft.contract === null) {
    throw new Error("V3 contract section has no canonical contract workspace.");
  }

  const state = personState({
    hasCase: profile.student,
    caseStatus: profile.caseStatus,
    leadStage: profile.stage,
  });
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
          <h2 className="min-w-0 text-xl font-semibold tracking-[-0.02em] text-fg">
            {profile.person}
          </h2>
          <p className="text-sm text-fg-3">{state}</p>
          {profile.financeStop ? (
            <Pill tone="danger">финансовый стоп</Pill>
          ) : null}
          {!isStaffPreview(actor) && staffHasPermission(actor, "task.manage") && draft.admissions ? (
            <Link
              href={`/v3/tasks?create=case&case=${encodeURIComponent(draft.admissions.studentCaseId)}`}
              className="ms-auto inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Создать задачу по студенту
            </Link>
          ) : null}
        </header>
      )}

      {/* Полоса вкладок прокручивается на узком экране: названия разделов не
          помещаются в 393px, а переносить их в две строки — терять шапку. */}
      <nav
        aria-label="Разделы профиля"
        tabIndex={0}
        className="max-w-full overflow-x-auto border-b border-border"
      >
        <ul className="flex w-max gap-1">
          {tabs.map((entry) => {
            const active = entry.key === current;
            return (
              <li key={entry.key}>
                <Link
                  href={hrefFor(entry.key)}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-10 items-center whitespace-nowrap border-b-2 px-3 text-sm ${
                    active
                      ? "border-accent font-semibold text-fg"
                      : "border-transparent text-fg-3 hover:text-fg-2"
                  }`}
                >
                  {entry.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {current === "route" ? universityProgramsTab : null}
      {current === "overview" ? (
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
      {current === "money" ? (
        <Money profile={profile} draft={draft} actor={actor} salesCaseId={sales?.handoff.caseId}
          saleConditionsHref={draft.saleConditions ? `${hrefFor("overview")}#sale-conditions` : null}
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
