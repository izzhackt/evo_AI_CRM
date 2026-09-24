import { parseRequestsReturnTo } from "@/lib/requests-queue-contract";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import { Suspense } from "react";

import type { Metadata } from "next";
import Link from "next/link";

import { PartShell } from "@/components/v3/PartShell";
import { Profile } from "@/components/v3/profile/Profile";
import { CaseHeader } from "@/components/v3/profile/CaseHeader";
import { WebsiteLeadSubmissions } from "@/components/v3/profile/WebsiteLeadSubmissions";
import { StudentsWorkspace } from "@/components/v3/profile/StudentsWorkspace";
import { withDocsSection } from "@/components/v3/profile/admissions-view";
import type { StudentsCoverage, StudentsSummary } from "@/components/v3/profile/students-facets";
import { UniversityProgramsTab } from "@/components/v3/profile/UniversityProgramsTab";
import { toProfileNotesSnapshot } from "@/components/v3/profile/profile-notes-view";
import {
  buildV3ProfileHref,
  resolveTab,
  type ProfileContractRetry,
  type ProfileRouteTarget,
} from "@/components/v3/profile/types";
import {
  PLATFORM_CONTRACT_MUTATION_OUTCOMES,
  PLATFORM_CONTRACT_RETRY_OPERATIONS,
  parsePlatformContractUuid,
  type PlatformContractMutationOutcome,
} from "@/lib/platform-contract-workflow";
import {
  parsePlatformCaseNoteCursor,
  type PlatformCaseNoteCursor,
} from "@/lib/platform-case-notes";
import { requireV3PageActor } from "@/lib/platform-guards";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { readAdmissionsSummary } from "@/lib/v3/admissions-source";
import { v3SectionTitle } from "@/lib/v3/navigation";
import { parseProfileActivityCursor } from "@/lib/v3/profile-activity-source";
import {
  listStudentPortalActiveCurators,
  type StudentPortalCuratorOption,
} from "@/lib/server/student-portal-curator-options";
import {
  parseV3ProfileCaseDirectoryParams,
  readProfileTarget,
  readV3ProfileCaseDirectory,
} from "@/lib/v3/profile-source";
import {
  loadV3ProfileRoute,
  type V3ProfileRouteLoadMode,
} from "@/lib/v3/profile-route-load";
import { loadStudentsCoverage } from "@/lib/v3/students-coverage-source";

export const dynamic = "force-dynamic";

/**
 * Вкладка называет подсвеченный пункт меню: «Студенты» (включая профиль и
 * прежний адрес сводки `?section=summary`) или «EVO Docs».
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ProfileSearchParams>;
}): Promise<Metadata> {
  return { title: v3SectionTitle("/v3/profile", await searchParams) };
}

type ProfileSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function singleSearchParam(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseContractResult(
  searchParams: ProfileSearchParams,
): PlatformContractMutationOutcome | undefined {
  const candidate = singleSearchParam(searchParams.bw6_result);
  return PLATFORM_CONTRACT_MUTATION_OUTCOMES.find(
    (outcome) => outcome === candidate,
  );
}

function parseContractRetry(
  searchParams: ProfileSearchParams,
  result: PlatformContractMutationOutcome | undefined,
): ProfileContractRetry | undefined {
  if (result !== "invalid" && result !== "unavailable") return undefined;
  const requestId = parsePlatformContractUuid(
    singleSearchParam(searchParams.bw6_retry_request_id),
  );
  const operationCandidate = singleSearchParam(
    searchParams.bw6_retry_operation,
  );
  const operation = PLATFORM_CONTRACT_RETRY_OPERATIONS.find(
    (value) => value === operationCandidate,
  );
  const subjectCandidate = singleSearchParam(searchParams.bw6_subject_id);
  const subjectId = subjectCandidate
    ? parsePlatformContractUuid(subjectCandidate)
    : undefined;

  if (!requestId || !operation || (subjectCandidate && !subjectId)) {
    return undefined;
  }
  return subjectId
    ? { requestId, operation, subjectId }
    : { requestId, operation };
}

function buildProfileNotesHref(
  target: ProfileRouteTarget,
  cursor: PlatformCaseNoteCursor | null = null,
): string {
  const query = new URLSearchParams();
  if (target.leadId) query.set("id", target.leadId);
  if (target.studentCaseId) query.set("case", target.studentCaseId);
  query.set("tab", "overview");
  if (cursor) {
    query.set("note_before_at", cursor.createdAt);
    query.set("note_before_id", cursor.id);
  }
  return `/v3/profile?${query.toString()}`;
}

export default async function ProfilePart({
  searchParams,
}: {
  searchParams: Promise<ProfileSearchParams>;
}) {
  const actor = await requireV3PageActor("/v3/profile");
  const params = await searchParams;
  const directoryParams = parseV3ProfileCaseDirectoryParams(params);
  const docsMode = singleSearchParam(params.section) === "docs"
    && staffPresentationCan(actor, "admissions.read")
    && (isStaffPreview(actor) || staffHasPermission(actor, "profile.read.full"));
  const requestsReturnTo = parseRequestsReturnTo(singleSearchParam(params.returnTo));
  const directoryHref = withDocsSection("/v3/profile", docsMode);
  const withRequestsReturn = (href: string) => requestsReturnTo
    ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(requestsReturnTo)}` : href;

  // Lead and Student Case are different canonical identities. A requested
  // value is never substituted with the first picker row, and the two query
  // parameters are never interpreted as each other.
  const leadParam = singleSearchParam(params.id);
  const caseParam = singleSearchParam(params.case);
  const hasLeadParam = params.id !== undefined;
  const hasCaseParam = params.case !== undefined;
  const hasNoteBeforeAt = params.note_before_at !== undefined;
  const hasNoteBeforeId = params.note_before_id !== undefined;
  const noteBeforeAt = singleSearchParam(params.note_before_at);
  const noteBeforeId = singleSearchParam(params.note_before_id);
  const noteCursor = noteBeforeAt && noteBeforeId
    ? parsePlatformCaseNoteCursor(noteBeforeAt, noteBeforeId)
    : null;
  const invalidNoteCursor =
    hasNoteBeforeAt !== hasNoteBeforeId ||
    ((hasNoteBeforeAt || hasNoteBeforeId) &&
      (noteCursor === null || (!hasLeadParam && !hasCaseParam)));
  const hasActivityAt = params.activity_before_at !== undefined;
  const hasActivityId = params.activity_before_id !== undefined;
  const activityAt = singleSearchParam(params.activity_before_at);
  const activityId = singleSearchParam(params.activity_before_id);
  const activityCursor = activityAt && activityId
    ? parseProfileActivityCursor(activityAt, activityId) : null;
  const invalidActivityCursor = hasActivityAt !== hasActivityId ||
    ((hasActivityAt || hasActivityId) && (!activityCursor || (!hasLeadParam && !hasCaseParam)
      || singleSearchParam(params.tab) !== "history" || actor.presentationRole === "sales"));
  const invalidIdentityShape =
    (hasLeadParam && hasCaseParam) ||
    (hasLeadParam && !leadParam) ||
    (hasCaseParam && !caseParam) ||
    ((hasLeadParam || hasCaseParam) && directoryParams.active) ||
    invalidNoteCursor || invalidActivityCursor;
  const explicitTarget: ProfileRouteTarget | null = !invalidIdentityShape && leadParam
    ? { leadId: leadParam, studentCaseId: null }
    : !invalidIdentityShape && caseParam
      ? { leadId: null, studentCaseId: caseParam }
      : null;
  const hasExplicitTarget = hasLeadParam || hasCaseParam;
  const routeMode: V3ProfileRouteLoadMode<
    typeof directoryParams,
    ProfileRouteTarget
  > = invalidIdentityShape
    ? { kind: "invalid" }
    : explicitTarget
      ? { kind: "target", target: explicitTarget }
      : { kind: "directory", params: directoryParams };
  // «Студенты» (24.09.2026): числа фасетов и нагрузка кураторов читаются
  // вместе со списком, а не отдельными панелями. Сводка берётся по всем
  // направлениям (только куратор сужает её), чтобы у каждого направления было
  // своё число; нет чтения — нет числа.
  const directoryMode = routeMode.kind === "directory";
  const summaryRead: Promise<StudentsSummary> = directoryMode && !docsMode && !directoryParams.invalid
    && staffPresentationCan(actor, "admissions.read")
    ? readAdmissionsSummary(actor, { curatorMembershipId: directoryParams.curatorMembershipId })
      .catch(() => "unavailable" as const)
    : Promise.resolve(null);
  const coverageRead: Promise<StudentsCoverage> = directoryMode && !docsMode
    ? loadStudentsCoverage(actor, params, directoryParams.curatorMembershipId)
    : Promise.resolve({ kind: "hidden" });
  const { directory, view } = await loadV3ProfileRoute(routeMode, {
    readDirectory: (nextParams) =>
      readV3ProfileCaseDirectory(actor, nextParams),
    readTarget: (target) => readProfileTarget(actor, target, noteCursor,
      singleSearchParam(params.tab) === "history" ? { cursor: activityCursor } : undefined),
  });
  const missing = hasExplicitTarget && !view;
  // Вкладка приходит адресом, поэтому её нельзя брать на веру: чужое слово и
  // вкладка, которой у этого человека нет (`?tab=documents` у лида), открывают
  // обзор.
  const tab = resolveTab(
    singleSearchParam(params.tab),
    Boolean(view?.profile.student),
    view ? {
      ...view.details.access,
      finance: view.details.access.finance || (!isStaffPreview(actor) && !!view.sales?.handoff.caseId
        && staffHasPermission(actor, "finance.event.confirm")),
    } : { documents: false, finance: false, studentProfile: false, contract: false },
    Boolean(view?.details.admissions),
  );
  const hrefFor = (next: string) => view
    ? withRequestsReturn(withDocsSection(buildV3ProfileHref(view.details.routeTarget, next), docsMode))
    : directoryHref;
  const requestIds = {
    contract: randomUUID(),
    firstPayment: randomUUID(),
    override: randomUUID(),
    handoff: randomUUID(),
    platformAccess: randomUUID(),
    saleConditions: randomUUID(),
    prepareLeadCabinet: randomUUID(),
    wishesCard: randomUUID(),
    educationCard: randomUUID(),
    conditionsCard: randomUUID(),
  };
  const contractResult = parseContractResult(params);
  const contractRetry = parseContractRetry(params, contractResult);
  const notesOlderHref = view?.notes.page.nextCursor
    ? withDocsSection(buildProfileNotesHref(view.details.routeTarget, view.notes.page.nextCursor), docsMode)
    : null;
  const notesLatestHref = view && noteCursor
    ? withDocsSection(buildProfileNotesHref(view.details.routeTarget), docsMode)
    : null;
  let studentPortalCurators: readonly StudentPortalCuratorOption[] = [];
  let studentPortalCuratorsAvailable = true;
  if (
    actor.systemRole === "admin" && !isStaffPreview(actor) &&
    (directory || view?.details.admissions?.caseState === "pending")
  ) {
    try {
      studentPortalCurators = await listStudentPortalActiveCurators(actor);
    } catch {
      studentPortalCuratorsAvailable = false;
    }
  }
  const [facetSummary, coverage] = await Promise.all([summaryRead, coverageRead]);

  return (
    <PartShell title={docsMode ? "EVO Docs" : view ? "Профиль" : "Студенты"}>
      <div className="space-y-6">
        {docsMode && directory && !isStaffPreview(actor) && staffHasPermission(actor, "catalog.import.manage") ? <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/v3/universities" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">Университеты и бланки</Link>
        </div> : null}
        {directory ? (
          <StudentsWorkspace
            directory={directory}
            params={directoryParams}
            docsMode={docsMode}
            allowAdmissionsFilters={staffPresentationCan(actor, "admissions.read")}
            summary={facetSummary}
            curators={studentPortalCurators}
            coverage={coverage}
            today={dayInOrganizationTimezone(new Date())}
            coverageRequestId={randomUUID()}
          />
        ) : null}
        {view ? (
          <>
            <Link
              className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline"
              href={requestsReturnTo ?? directoryHref}
            >
              {requestsReturnTo ? "К списку заявок" : docsMode ? "К списку EVO Docs" : "К списку студентов"}
            </Link>
            {view.details.routeTarget.leadId && !isStaffPreview(actor) ? <Suspense fallback={<p role="status" className="text-sm text-fg-2">Загружаем заявки с сайта…</p>}>
              <WebsiteLeadSubmissions actor={actor} leadId={view.details.routeTarget.leadId} />
            </Suspense> : null}
            <Profile
              key={[actor.organizationId, actor.authUserId, actor.systemRole, actor.presentationRole,
                view.details.routeTarget.studentCaseId ? `case:${view.details.routeTarget.studentCaseId}` : `lead:${view.details.routeTarget.leadId}`].join(":")}
              profile={view.profile}
              universityProgramsTab={tab === "route" ? <UniversityProgramsTab actor={actor} draft={view.details}
                packetsInitiallyOpen={singleSearchParam(params.panel) === "packets"} /> : undefined}
              caseHeader={view.details.routeTarget.studentCaseId ? (
                <Suspense fallback={<p role="status" className="text-sm text-fg-2">Загружаем сводку дела…</p>}>
                  <CaseHeader
                    actor={actor}
                    profile={view.profile}
                    draft={view.details}
                    curators={studentPortalCurators}
                    assignCuratorRequestId={randomUUID()}
                  />
                </Suspense>
              ) : undefined}
              draft={view.details}
              sales={view.sales}
              actor={actor}
              organizationId={actor.organizationId}
              studentPortalCurators={studentPortalCurators}
              studentPortalCuratorsAvailable={studentPortalCuratorsAvailable}
              requestIds={requestIds}
              noteRequestId={randomUUID()}
              notes={toProfileNotesSnapshot(view.notes.subject, view.notes.page)}
              notesOlderHref={notesOlderHref}
              notesLatestHref={notesLatestHref}
              contractResult={contractResult}
              contractRetry={contractRetry}
              tab={tab}
              hrefFor={hrefFor}
            />
          </>
        ) : invalidIdentityShape || missing ? (
          <p className="border-t border-border px-4 py-5 text-sm leading-relaxed text-fg-2">
            {invalidIdentityShape
              ? "Ссылка на профиль некорректна. Найдите студента через поиск."
              : "Профиль не найден или недоступен вам. Найдите студента через поиск."}
            <Link href={requestsReturnTo ?? directoryHref} className="mt-3 flex min-h-11 w-fit items-center font-medium text-accent underline underline-offset-4">
              {requestsReturnTo ? "К списку заявок" : "Найти студента"}
            </Link>
          </p>
        ) : null}
      </div>
    </PartShell>
  );
}
