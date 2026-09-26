import { parseRequestsReturnTo } from "@/lib/requests-queue-contract";
import { isStaffPreview, staffCanAccessRoute, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import { Suspense } from "react";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PartShell } from "@/components/v3/PartShell";
import { Profile } from "@/components/v3/profile/Profile";
import { CaseHeader } from "@/components/v3/profile/CaseHeader";
import { WebsiteLeadSubmissions } from "@/components/v3/profile/WebsiteLeadSubmissions";
import { withDocsSection } from "@/components/v3/profile/admissions-view";
import { buildStudentsQueueScreen } from "@/components/v3/students/StudentsQueueScreen";
import { StudentsDirectoryFallback } from "@/components/v3/students/StudentsDirectoryFallback";
import { parseStudentsQueueParams, parseStudentsReturnTo } from "@/components/v3/students/students-queue-view";
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
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { v3SectionTitle } from "@/lib/v3/navigation";
import { PIPELINE_PATH, parsePipelineReturnTo } from "@/lib/v3/pipeline-return";
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
import { readStudentsHandoff, readStudentsOpenTasks, readStudentsQueue } from "@/lib/v3/students-queue-source";

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


/**
 * Кто открывает очередь: Admin в своём интерфейсе и тот, кто назначает и
 * замещает кураторов (`case.curator.assign` — то же условие, что у чтения
 * нагрузки и команды замещения). Просмотр роли — ни то, ни другое.
 */
function studentsQueueActor(actor: ActivePlatformActor) {
  const preview = isStaffPreview(actor);
  return { admin: actor.systemRole === "admin" && !preview, coverage: !preview && staffHasPermission(actor, "case.curator.assign") };
}

/**
 * «Студенты» и EVO Docs как рабочая очередь (миграция 241, PLAN_CHANGES
 * «Студенты» PR 2): страница читает очередь, числа, задачи открытого дела и
 * нагрузку кураторов, а экран собирает `buildStudentsQueueScreen`.
 */
async function studentsQueuePage(
  actor: ActivePlatformActor,
  parse: Exclude<ReturnType<typeof parseStudentsQueueParams>, Readonly<{ kind: "redirect" }>>,
  query: ProfileSearchParams,
  curatorsRead: Promise<readonly StudentPortalCuratorOption[]>,
) {
  const params = parse.params;
  const [reads, curators] = await Promise.all([
    parse.kind === "invalid" ? null : Promise.all([
      readStudentsQueue(actor, params),
      params.open ? readStudentsOpenTasks(actor, params.open) : Promise.resolve(null),
      params.view === "curators" ? loadStudentsCoverage(actor, { ...query, ...params.coverage }, undefined) : Promise.resolve(null),
      // Просмотр роли не отвечает на передачу (действие его отклоняет) — блок не читаем.
      params.open && !isStaffPreview(actor) ? readStudentsHandoff(actor, params.open) : Promise.resolve(null),
    ]),
    curatorsRead,
  ]);
  const scopes = actor.assignments.map((assignment) => assignment.scope);
  return buildStudentsQueueScreen({
    params,
    invalid: parse.kind === "invalid",
    read: reads?.[0] ?? { page: null, counts: null, forbidden: false },
    actor: studentsQueueActor(actor),
    openTasks: reads?.[1] ?? null,
    coverage: reads?.[2] ?? null,
    handoff: reads?.[3] ?? null,
    today: dayInOrganizationTimezone(new Date()),
    curatorNames: curators.map(({ membershipId, displayName }) => ({ membershipId, displayName })),
    editor: {
      admin: actor.systemRole === "admin" && !isStaffPreview(actor),
      preview: isStaffPreview(actor),
      routeManage: staffHasPermission(actor, "case.route.manage"),
      broadScope: scopes.some((scope) => scope.kind === "organization" || scope.kind === "department" || scope.kind === "direction"),
    },
    recordScopes: scopes.filter((scope) => scope.kind === "record" && scope.resourceKind === "student_case" && scope.key).map((scope) => scope.key!),
    createTask: !isStaffPreview(actor) && staffHasPermission(actor, "task.create"),
    requestIds: { nextStep: randomUUID(), coverage: randomUUID() },
  });
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
  // «К списку студентов» возвращает тот же вид очереди, фильтры, страницу и строку.
  const studentsReturnTo = requestsReturnTo ? null : parseStudentsReturnTo(singleSearchParam(params.returnTo));
  // Карточка лида из панели доски возвращает на доску в то же состояние.
  const pipelineReturnTo = requestsReturnTo || studentsReturnTo ? null : parsePipelineReturnTo(singleSearchParam(params.returnTo));
  const listReturnTo = requestsReturnTo ?? studentsReturnTo ?? pipelineReturnTo;
  const directoryHref = studentsReturnTo ?? withDocsSection("/v3/profile", docsMode);
  const withRequestsReturn = (href: string) => listReturnTo
    ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(listReturnTo)}` : href;

  // Lead and Student Case are different canonical identities. A requested
  // value is never substituted with the first picker row, and the two query
  // parameters are never interpreted as each other.
  const leadParam = singleSearchParam(params.id);
  const caseParam = singleSearchParam(params.case);
  const hasLeadParam = params.id !== undefined;
  const hasCaseParam = params.case !== undefined;
  // Лид (не дело) без адреса возврата — назад на доску, где лиды и живут; в
  // меню подсвечена та же «Воронка продаж» (navigation.ts).
  const pipelineBackHref = pipelineReturnTo
    ?? (listReturnTo === null && leadParam && !hasCaseParam && !docsMode && staffCanAccessRoute(actor, PIPELINE_PATH)
      ? PIPELINE_PATH : null);
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
  // «Студенты» (25.09.2026): очередь дел миграции 241 для Admin и куратора с
  // полным чтением дел; Sales и просмотр роли «Продажи» (241 их не пускает)
  // остаются на прежнем чтении с ограниченным итогом передачи.
  const directoryMode = routeMode.kind === "directory";
  const queueMode = staffPresentationCan(actor, "admissions.read") && staffHasPermission(actor, "case.read.full");
  const queueParse = directoryMode && queueMode
    ? parseStudentsQueueParams(params, docsMode ? "docs" : "queue", studentsQueueActor(actor))
    : null;
  // Прежние адреса (фасеты, сводка) и поиск по номеру дела — на новый адрес.
  if (queueParse?.kind === "redirect") redirect(queueParse.href);
  const { directory, view } = await loadV3ProfileRoute(routeMode, {
    readDirectory: (nextParams) => queueMode ? Promise.resolve(null) : readV3ProfileCaseDirectory(actor, nextParams),
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
  // Имена кураторов (Admin) нужны и делу, и меню «Куратор ▾» очереди: очередь
  // читается параллельно с ними.
  const curatorsRead: Promise<Readonly<{ curators: readonly StudentPortalCuratorOption[]; available: boolean }>> =
    actor.systemRole === "admin" && !isStaffPreview(actor) &&
    (directoryMode || view?.details.admissions?.caseState === "pending")
      ? listStudentPortalActiveCurators(actor).then((curators) => ({ curators, available: true }), () => ({ curators: [], available: false }))
      : Promise.resolve({ curators: [], available: true });
  const [curatorOptions, queuePage] = await Promise.all([
    curatorsRead,
    queueParse ? studentsQueuePage(actor, queueParse, params, curatorsRead.then((read) => read.curators)) : null,
  ]);
  const studentPortalCurators = curatorOptions.curators;
  const studentPortalCuratorsAvailable = curatorOptions.available;
  // «Университеты и бланки» — редкий путь: тихая ссылка справа от заголовка, не красная.
  const docsAction = docsMode && directoryMode && !isStaffPreview(actor) && staffHasPermission(actor, "catalog.import.manage")
    ? <Link href="/v3/universities" className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">Университеты и бланки</Link>
    : undefined;

  return (
    <PartShell title={docsMode ? "EVO Docs" : view ? "Профиль" : "Студенты"} count={queuePage?.count ?? null} action={docsAction} dense={queuePage !== null}>
      <div className="space-y-6">
        {queuePage?.content ?? null}
        {directory ? (
          <StudentsDirectoryFallback directory={directory} params={directoryParams} docsMode={docsMode} />
        ) : null}
        {view ? (
          <>
            <Link
              className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline"
              href={requestsReturnTo ?? pipelineBackHref ?? directoryHref}
            >
              {requestsReturnTo ? "К списку заявок" : pipelineBackHref ? "К воронке продаж" : docsMode ? "К списку EVO Docs" : "К списку студентов"}
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
