import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n";
import {
  getPlatformStudentCaseView,
  listPlatformApplicationsForStudentCase,
  parsePlatformAdmissionsUuid,
  PLATFORM_APPLICATION_STATUSES,
  summarizePlatformStudentCaseApplicationPreview,
} from "@/lib/platform-admissions";
import { getPlatformAdmissionsCaseWorkspace } from "@/lib/platform-admissions-case-workspace";
import { getPlatformStudentCaseAdmissionsHandoff } from "@/lib/platform-admissions-handoff";
import {
  assignPlatformStudentCaseCuratorAction,
  changePlatformStudentCaseStateAction,
  changePlatformUniversityApplicationAction,
  createPlatformUniversityApplicationAction,
  updatePlatformStudentCaseRouteAction,
} from "@/lib/platform-admissions-actions";
import {
  getPlatformStudentCaseAssignmentState,
  listPlatformActiveCurators,
} from "@/lib/platform-case-assignment";
import {
  getPlatformCaseVisa,
  PLATFORM_VISA_STATUSES,
} from "@/lib/platform-case-operations";
import {
  createPlatformFinanceStopFactorAction,
  createPlatformPaymentObligationAction,
  resolvePlatformFinanceStopFactorAction,
  settlePlatformPaymentObligationAction,
  upsertPlatformCaseVisaAction,
} from "@/lib/platform-case-operations-actions";
import { getPlatformCaseFinanceControl } from "@/lib/platform-finance-control";
import {
  getPlatformPilotWriteBoundary,
  getPlatformStudentCasePilotCohort,
} from "@/lib/platform-pilot-cohort";
import {
  approvePlatformContractTemplateVersionAction,
  createPlatformContractTemplateVersionAction,
  generatePlatformPostContractReportAction,
  generatePlatformStudentCaseContractDraftAction,
  retirePlatformContractTemplateVersionAction,
  reviewPlatformPostContractReportAction,
  reviewPlatformStudentCaseContractDraftAction,
  seedPlatformPostContractItemsAction,
  updatePlatformPostContractItemAction,
} from "@/lib/platform-contract-actions";
import {
  getPlatformCaseContractWorkspace,
  PLATFORM_CONTRACT_MUTATION_OUTCOMES,
} from "@/lib/platform-contract-workflow";
import { reviewPlatformDocumentVersionAction } from "@/lib/platform-document-review-actions";
import { requirePlatformClientsActor } from "@/lib/platform-guards";
import {
  getPlatformStudentProfile,
  listPlatformCountryRequirementVersions,
  listPlatformStudentCaseDocuments,
} from "@/lib/platform-student-profile";
import {
  applyPlatformCountryRequirementVersionAction,
  updatePlatformStudentProfileAction,
} from "@/lib/platform-student-profile-actions";
import {
  appendPlatformCaseUpdateAction,
  changePlatformCaseTaskAction,
  createPlatformCaseTaskAction,
  reviewPlatformCaseDocumentVersionAction,
} from "@/lib/platform-admissions-case-workspace-actions";
import { isPlatformP6BPortalNotificationsEnabled } from "@/lib/server/platform-p6b-portal-notifications";

import FixtureClientPage, {
  type ClientPagePresentationData,
} from "./FixtureClientPage";
import type { ContractDraftReportResult } from "./ContractDraftReportWorkspace";

type Query = {
  result?: string;
  retry_request_id?: string;
  bw6_result?: string;
  bw6_retry_request_id?: string;
  bw6_retry_operation?: string;
  bw6_subject_id?: string;
  p6d_result?: string;
  p6d_retry_request_id?: string;
  p6d_retry_operation?: string;
  p6d_subject_id?: string;
  u8_result?: string;
  u8_retry_request_id?: string;
  u8_retry_operation?: string;
  u8_subject_id?: string;
  u10_result?: string;
  u10_retry_request_id?: string;
  u10_retry_operation?: string;
  u10_subject_id?: string;
};

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
const NOT_SET = "Не указано";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeQuery(searchParams: SearchParams): Query {
  return {
    result: first(searchParams.result),
    retry_request_id: first(searchParams.retry_request_id),
    bw6_result: first(searchParams.bw6_result),
    bw6_retry_request_id: first(searchParams.bw6_retry_request_id),
    bw6_retry_operation: first(searchParams.bw6_retry_operation),
    bw6_subject_id: first(searchParams.bw6_subject_id),
    p6d_result: first(searchParams.p6d_result),
    p6d_retry_request_id: first(searchParams.p6d_retry_request_id),
    p6d_retry_operation: first(searchParams.p6d_retry_operation),
    p6d_subject_id: first(searchParams.p6d_subject_id),
    u8_result: first(searchParams.u8_result),
    u8_retry_request_id: first(searchParams.u8_retry_request_id),
    u8_retry_operation: first(searchParams.u8_retry_operation),
    u8_subject_id: first(searchParams.u8_subject_id),
    u10_result: first(searchParams.u10_result),
    u10_retry_request_id: first(searchParams.u10_retry_request_id),
    u10_retry_operation: first(searchParams.u10_retry_operation),
    u10_subject_id: first(searchParams.u10_subject_id),
  };
}

function result(value: string | undefined) {
  return value === "saved" || value === "invalid" || value === "unavailable"
    ? value
    : undefined;
}

function contractResult(
  value: string | undefined,
): ContractDraftReportResult | undefined {
  return value && PLATFORM_CONTRACT_MUTATION_OUTCOMES.includes(
    value as ContractDraftReportResult,
  )
    ? (value as ContractDraftReportResult)
    : undefined;
}

/**
 * Connected Supabase adapter for the accepted Student 360 renderer.
 * It returns only repository-authorized fields; Sales handoff summaries never
 * receive the full case object.
 */
export async function loadPlatformClientPageData(
  id: string,
  query: Query,
): Promise<ClientPagePresentationData | null> {
  const actor = await requirePlatformClientsActor();
  const view = await getPlatformStudentCaseView(actor, id);
  if (!view) return null;

  if (view.access === "sales_summary") {
    const summary = view.studentCase;
    return {
      access: "summary",
      client: {
        access_mode: "sales_post_handoff_summary",
        id: summary.studentCaseId,
        name: summary.studentDisplayName,
        stage: summary.state,
        target_country: summary.targetCountry,
        target_degree: summary.targetDegree,
        case_state: summary.state,
        curator_name: summary.assignedCuratorDisplayName,
        handoff_at: summary.handoffAt,
      },
      testId: "platform-sales-handoff-summary",
    };
  }

  const studentCase = view.studentCase;
  const canReadContractWorkspace = actor.platformRole === "admin"
    || actor.platformRole === "sales"
    || actor.platformRole === "curator";
  const canReadAdmissionsHandoffContext = actor.platformRole === "admin"
    || actor.platformRole === "curator";
  const canReadCaseWorkspace = actor.platformRole === "admin"
    || actor.platformRole === "curator";
  const [
    applicationRows,
    profileSnapshot,
    documentRows,
    countryRequirementVersions,
    contractWorkspace,
    assignmentState,
    curatorOptions,
    caseVisa,
    caseFinanceControl,
    handoffState,
    caseWorkspace,
    pilotCohortRead,
    legacyWriteBoundaryRead,
  ] = await Promise.all([
    listPlatformApplicationsForStudentCase(actor, studentCase.studentCaseId, {
      pageSize: 100,
    }),
    getPlatformStudentProfile(actor, studentCase.studentCaseId),
    listPlatformStudentCaseDocuments(actor, studentCase.studentCaseId),
    listPlatformCountryRequirementVersions(actor, studentCase.studentCaseId),
    canReadContractWorkspace
      ? getPlatformCaseContractWorkspace(actor, studentCase.studentCaseId)
      : Promise.resolve(null),
    getPlatformStudentCaseAssignmentState(actor, studentCase.studentCaseId),
    actor.platformRole === "admin"
      ? listPlatformActiveCurators(actor)
      : Promise.resolve([]),
    getPlatformCaseVisa(actor, studentCase.studentCaseId),
    getPlatformCaseFinanceControl(actor, studentCase.studentCaseId, 50),
    canReadAdmissionsHandoffContext
      ? getPlatformStudentCaseAdmissionsHandoff(actor, studentCase.studentCaseId)
      : Promise.resolve(null),
    canReadCaseWorkspace
      ? getPlatformAdmissionsCaseWorkspace({
          studentCaseId: studentCase.studentCaseId,
          limit: 20,
        })
      : Promise.resolve(null),
    getPlatformStudentCasePilotCohort(actor, studentCase.studentCaseId, 20)
      .then(
        (value) => ({ value, unavailable: false as const }),
        () => ({ value: null, unavailable: true as const }),
      ),
    getPlatformPilotWriteBoundary(actor, studentCase.studentCaseId, "legacy_crm")
      .then(
        (value) => ({ value, unavailable: false as const }),
        () => ({ value: null, unavailable: true as const }),
      ),
  ]);
  if (!assignmentState || (canReadCaseWorkspace && !caseWorkspace)) return null;

  const appliedCountryRequirement =
    countryRequirementVersions.find(
      (version: (typeof countryRequirementVersions)[number]) => version.isApplied,
    ) ?? null;
  const applications = applicationRows.rows.map((application: (typeof applicationRows.rows)[number]) => ({
    id: application.universityApplicationId,
    university: application.institutionName,
    country: application.targetCountry ?? NOT_SET,
    program: application.programName,
    deadline: null,
    status: application.status,
  }));
  const applicationSummary = summarizePlatformStudentCaseApplicationPreview(
    applications,
    applicationRows.hasNext,
    studentCase.studentCaseId,
  );
  const canReviewDocuments =
    actor.platformRole === "admin" || actor.platformRole === "curator";
  const usePortalNotificationDocumentReview =
    canReviewDocuments && isPlatformP6BPortalNotificationsEnabled();
  const documents = documentRows.map((document: (typeof documentRows)[number]) => ({
    id: document.documentSlotId,
    name: document.requirementLabel,
    status: document.slotStatus === "submitted"
      ? "uploaded"
      : document.slotStatus === "correction_required"
          ? "rejected"
          : document.slotStatus,
    comment: document.reworkReason ?? document.nextAction ?? document.instructions,
    connected: false,
    documentVersionId: document.documentVersionId,
    reviewRequestId:
      canReviewDocuments
      && document.slotStatus === "submitted"
      && document.documentVersionId
        ? randomUUID()
        : null,
    canReview:
      canReviewDocuments
      && document.slotStatus === "submitted"
      && document.documentVersionId !== null,
  }));
  const retryRequestId = parsePlatformAdmissionsUuid(query.retry_request_id);
  const profileRequestId = retryRequestId ?? randomUUID();
  const checklistRequestId = retryRequestId ?? randomUUID();
  const lifecycleRequestId = retryRequestId ?? randomUUID();
  const routeRequestId = retryRequestId ?? randomUUID();
  const p6dRetryRequestId = parsePlatformAdmissionsUuid(
    query.p6d_retry_request_id,
  );
  const p6dRetrySubjectId = parsePlatformAdmissionsUuid(query.p6d_subject_id);
  const p6dRequestIdFor = (
    operation: "visa" | "payment-create" | "payment-settle",
    subjectId: string,
  ): string => query.p6d_retry_operation === operation
    && p6dRetryRequestId
    && p6dRetrySubjectId === subjectId
      ? p6dRetryRequestId
      : randomUUID();
  const platformVisaMutationId = query.p6d_retry_operation === "visa"
    && p6dRetryRequestId
    && p6dRetrySubjectId === studentCase.studentCaseId
      ? null
      : caseVisa?.visaCaseId ?? null;
  const platformVisaRequestId = p6dRequestIdFor(
    "visa",
    platformVisaMutationId ?? studentCase.studentCaseId,
  );
  const platformPaymentCreateRequestId = p6dRequestIdFor(
    "payment-create",
    studentCase.studentCaseId,
  );
  const u8RetryRequestId = parsePlatformAdmissionsUuid(
    query.u8_retry_request_id,
  );
  const u8RetrySubjectId = parsePlatformAdmissionsUuid(query.u8_subject_id);
  const u8RequestIdFor = (
    operation: "stop-create" | "stop-resolve",
    subjectId: string,
  ): string => query.u8_retry_operation === operation
    && u8RetryRequestId
    && u8RetrySubjectId === subjectId
      ? u8RetryRequestId
      : randomUUID();
  const u10RetryRequestId = parsePlatformAdmissionsUuid(
    query.u10_retry_request_id,
  );
  const u10RetrySubjectId = parsePlatformAdmissionsUuid(query.u10_subject_id);
  const u10RequestIdFor = (
    operation: "configuration" | "include" | "exclude",
  ): string => query.u10_retry_operation === operation
    && u10RetryRequestId
    && u10RetrySubjectId === studentCase.studentCaseId
      ? u10RetryRequestId
      : randomUUID();
  const payments = caseFinanceControl.obligations.map((payment) => ({
    id: payment.paymentObligationId,
    title: payment.label,
    amount: payment.amountMinor / 100,
    currency: payment.currency,
    due_date: payment.dueAt.slice(0, 10),
    status: payment.status,
    category: payment.category,
    next_action: payment.nextAction,
    total_paid_minor: payment.totalPaidMinor,
    total_refunded_minor: payment.totalRefundedMinor,
    outstanding_minor: payment.outstandingMinor,
    payment_confirmation_count: payment.paymentConfirmationCount,
    last_payment_at: payment.lastPaymentAt,
    active_stop_factors: payment.activeStopFactors.map((stop) => ({
      id: stop.stopFactorId,
      reason: stop.reason,
      blocked_action: stop.blockedAction,
      next_action: stop.nextAction,
      owner_name: stop.ownerDisplayName,
      created_at: stop.createdAt,
      resolution_request_id: u8RequestIdFor(
        "stop-resolve",
        stop.stopFactorId,
      ),
      resolution_retry: query.u8_retry_operation === "stop-resolve"
        && u8RetryRequestId !== null
        && u8RetrySubjectId === stop.stopFactorId,
    })),
    stop_create_request_id: u8RequestIdFor(
      "stop-create",
      payment.paymentObligationId,
    ),
    stop_create_retry: query.u8_retry_operation === "stop-create"
      && u8RetryRequestId !== null
      && u8RetrySubjectId === payment.paymentObligationId,
    settlement_request_id: p6dRequestIdFor(
      "payment-settle",
      payment.paymentObligationId,
    ),
    settlement_retry: query.p6d_retry_operation === "payment-settle"
      && p6dRetryRequestId !== null
      && p6dRetrySubjectId === payment.paymentObligationId,
  }));
  const contractRetryRequestId = parsePlatformAdmissionsUuid(
    query.bw6_retry_request_id,
  );
  const contractRetrySubjectId = parsePlatformAdmissionsUuid(query.bw6_subject_id);
  const contractRequestIdFor = (operation: string, subjectId?: string): string => {
    const retryMatches = query.bw6_retry_operation === operation
      && contractRetryRequestId
      && (subjectId === undefined
        ? contractRetrySubjectId === null
        : subjectId === contractRetrySubjectId);
    return retryMatches ? contractRetryRequestId : randomUUID();
  };
  const riskSignals = [
    studentCase.overdueTaskCount > 0
      ? `Просроченные задачи: ${studentCase.overdueTaskCount}`
      : null,
    studentCase.overdueObligationCount > 0
      ? `Просроченные оплаты: ${studentCase.overdueObligationCount}`
      : null,
    caseFinanceControl.obligations.some(
      (payment) => payment.activeStopFactors.length > 0,
    )
      ? `Финансовый стоп: ${caseFinanceControl.obligations
        .flatMap((payment) => payment.activeStopFactors)
        .map((stop) => `${stop.blockedAction} — ${stop.reason}`)
        .join(", ")}`
      : null,
    studentCase.rejectedDocumentCount > 0
      ? `Документы на доработке: ${studentCase.rejectedDocumentCount}`
      : null,
  ].filter((value): value is string => Boolean(value));
  const notes = [
    `OZO: ${studentCase.operationalStage}`,
    studentCase.programDirection ? `Направление: ${studentCase.programDirection}` : null,
    studentCase.intake ? `Набор: ${studentCase.intake}` : null,
    studentCase.languageAssumption ? `Язык: ${studentCase.languageAssumption}` : null,
    studentCase.fundingAssumption ? `Финансирование: ${studentCase.fundingAssumption}` : null,
    handoffState?.handoffMode
      ? `U6: ${handoffState.handoffMode === "normal" ? "normal" : "exceptional_override"}`
      : null,
    handoffState?.handoffReason ? `Причина handoff: ${handoffState.handoffReason}` : null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const tasks = caseWorkspace
    ? caseWorkspace.tasks.map((task) => ({
        id: task.caseTaskId,
        title: task.title,
        due_date: task.dueAt?.slice(0, 10) ?? null,
        status: task.status,
        priority: task.priority,
        assignee_name: task.assigneeDisplayName,
        assignee_membership_id: task.assigneeMembershipId,
        student_visible: task.studentVisible,
        task_type: task.taskType,
        request_id: randomUUID(),
      }))
    : handoffState?.starterTasks.map((task) => ({
        id: task.taskId,
        title: task.title,
        due_date: task.dueAt,
        status: task.status,
        priority: task.priority,
        assignee_name: task.assigneeDisplayName,
        assignee_membership_id: null,
        student_visible: false,
        task_type: "admissions_case_task",
        request_id: randomUUID(),
      }));
  const workspaceUpdates = caseWorkspace?.updates ?? [];
  const workspaceAudit = caseWorkspace?.audit ?? [];
  const workspaceAssignees = (caseWorkspace?.taskAssignees ?? []).filter(
    (assignee) =>
      actor.platformRole === "admin"
      || assignee.membershipId === actor.membershipId,
  );
  const inheritedHandoff = handoffState?.inheritedContext ?? null;
  const handoffContext =
    inheritedHandoff &&
    handoffState?.handoffMode &&
    handoffState.handoffReason &&
    handoffState.handedOffAt &&
    handoffState.admissionsOwnerDisplayName
      ? {
          mode: handoffState.handoffMode,
          reason: handoffState.handoffReason,
          handedOffAt: handoffState.handedOffAt,
          actorName: inheritedHandoff.actorDisplayName,
          ownerName: handoffState.admissionsOwnerDisplayName,
          clientName: inheritedHandoff.client.displayName,
          salesStage: inheritedHandoff.sales.stageKey,
          nextAction: inheritedHandoff.sales.nextAction,
          nextActionDueDate: inheritedHandoff.sales.nextActionDueDate,
          conversations: inheritedHandoff.conversations.map((conversation) => ({
            id: conversation.conversationId,
            subject: conversation.subject,
            queue: conversation.queue,
            status: conversation.status,
            updatedAt: conversation.updatedAt,
          })),
          provenance: inheritedHandoff.provenance.map((source) => ({
            id: source.provenanceId,
            sourceSystem: source.sourceSystem,
            evidenceType: source.evidenceType,
            sourceReference: source.sourceReference,
            observedAt: source.observedAt,
          })),
        }
      : null;
  const hasStudentRouteFacts =
    studentCase.targetCountry !== null && studentCase.targetDegree !== null;
  const canManageLifecycle =
    (actor.platformRole === "admin" || actor.platformRole === "curator")
    && (studentCase.state === "active" || studentCase.state === "closed");

  return {
    access: "full",
    actor: { id: actor.profileId, role: actor.platformRole },
    client: {
      access_mode: "full",
      id: studentCase.studentCaseId,
      name: studentCase.studentDisplayName,
      email: "",
      phone: null,
      stage: studentCase.state,
      target_country: studentCase.targetCountry ?? NOT_SET,
      target_degree: studentCase.targetDegree ?? NOT_SET,
      case_state: studentCase.state,
      contract_confirmed_at: studentCase.handoff?.createdAt ?? null,
      contract_confirmation_ref: studentCase.handoff?.studentCaseOpHandoffId ?? null,
      portal_activated_at: assignmentState.portalActivatedAt,
      handoff_at: studentCase.handoffAt,
      curator_id: assignmentState.currentCuratorMembershipId,
      curator_name: studentCase.currentCuratorDisplayName,
      manager_name: studentCase.responsibleSalesDisplayName,
      notes,
    },
    applications,
    applicationPreview: applicationSummary.preview,
    documents,
    visa: caseVisa ? {
      id: caseVisa.visaCaseId,
      country: studentCase.targetCountry ?? NOT_SET,
      status: caseVisa.status,
      appointment_at: null,
      notes: caseVisa.note,
    } : null,
    payments,
    financeHistory: caseFinanceControl.history.map((event) => ({
      id: event.auditEventId,
      action: event.action,
      resource_kind: event.resourceType,
      actor_name: event.actorDisplayName ?? "—",
      reason: event.reason ?? "—",
      occurred_at: event.createdAt,
    })),
    pilotCohort: pilotCohortRead.value,
    pilotLegacyWriteBoundary: legacyWriteBoundaryRead.value,
    pilotCohortUnavailable:
      pilotCohortRead.unavailable || legacyWriteBoundaryRead.unavailable,
    canManagePilotCohort: actor.platformRole === "admin",
    pilotConfigurationRequestId: u10RequestIdFor("configuration"),
    pilotIncludeRequestId: u10RequestIdFor("include"),
    pilotExcludeRequestId: u10RequestIdFor("exclude"),
    pilotResult: result(query.u10_result),
    tasks: tasks ?? [],
    handoffContext,
    updates: workspaceUpdates.map((update) => ({
      id: update.studentCaseUpdateId,
      message: update.body,
      author_name: update.authorDisplayName,
      created_at: update.occurredAt,
    })),
    taskAssignees: workspaceAssignees.map((assignee) => ({
      id: assignee.membershipId,
      name: assignee.displayName,
    })),
    taskMutationScope: actor.platformRole === "admin" ? "full" : "status_only",
    curators: curatorOptions.map((curator: (typeof curatorOptions)[number]) => ({
      id: curator.membershipId,
      name: curator.displayName,
    })),
    audit: workspaceAudit.map((event) => ({
      id: event.auditEventId,
      event_type: event.action,
      reason: event.reason ?? event.changeSummary ?? "—",
      actor_name: event.actorDisplayName ?? "—",
      before_curator_name: null,
      after_curator_name: null,
      occurred_at: event.eventAt,
      resource_kind: event.resourceKind,
      change_summary: event.changeSummary,
      headline: null,
    })),
    snapshot: {
      stageTimeline: [
        { stage: "pending", labelKey: "caseState.pending" },
        { stage: "active", labelKey: "caseState.active" },
        { stage: "closed", labelKey: "caseState.closed" },
      ],
      nextAction: studentCase.nextAction
        ? {
            labelKey: "portalNextTask",
            detail: studentCase.nextAction,
            dueDate: studentCase.handoff?.dueAt ?? null,
          }
        : null,
      manager: {
        name: studentCase.responsibleSalesDisplayName,
        email: "—",
        phone: null,
      },
      curator: studentCase.currentCuratorDisplayName
        ? {
            name: studentCase.currentCuratorDisplayName,
            email: "—",
            phone: null,
          }
        : null,
      documents: documents.map((document: (typeof documents)[number]) => ({
        name: document.name,
        status: document.status,
      })),
      payments: payments.map((payment: (typeof payments)[number]) => ({
        title: payment.title,
        status: payment.status,
      })),
      visa: caseVisa ? {
        country: studentCase.targetCountry ?? NOT_SET,
        status: caseVisa.status,
      } : null,
    },
    stageItems: [
      { key: "pending", label: "Ожидает назначения" },
      { key: "active", label: "Активно" },
      { key: "closed", label: "Закрыто" },
    ],
    applicationStatuses: [...PLATFORM_APPLICATION_STATUSES],
    taskColumns: ["open", "in_progress", "blocked", "done", "cancelled"],
    taskPriorities: ["low", "normal", "high", "urgent"],
    visaStatuses: [...PLATFORM_VISA_STATUSES],
    actions: {
      addApplication:
        actor.platformRole === "admin" || actor.platformRole === "curator"
          ? createPlatformUniversityApplicationAction
          : undefined,
      setApplicationStatus:
        actor.platformRole === "admin" || actor.platformRole === "curator"
          ? changePlatformUniversityApplicationAction
          : undefined,
      assignCurator: actor.platformRole === "admin"
        ? assignPlatformStudentCaseCuratorAction
        : undefined,
      changePlatformState: changePlatformStudentCaseStateAction,
      updateStudentRoute: updatePlatformStudentCaseRouteAction,
      updateStudentProfile: updatePlatformStudentProfileAction,
      applyCountryRequirementVersion: applyPlatformCountryRequirementVersionAction,
      reviewPlatformDocument: canReviewDocuments
        ? usePortalNotificationDocumentReview
          ? reviewPlatformDocumentVersionAction
          : reviewPlatformCaseDocumentVersionAction
        : undefined,
      addTask: canReadCaseWorkspace
        ? createPlatformCaseTaskAction
        : undefined,
      moveTask: canReadCaseWorkspace
        ? changePlatformCaseTaskAction
        : undefined,
      postUpdate: canReadCaseWorkspace
        ? appendPlatformCaseUpdateAction
        : undefined,
      upsertPlatformVisa:
        actor.platformRole === "admin" || actor.platformRole === "curator"
          ? upsertPlatformCaseVisaAction
          : undefined,
      addPlatformPayment: actor.platformRole === "admin"
        ? createPlatformPaymentObligationAction
        : undefined,
      markPlatformPaymentPaid: actor.platformRole === "admin"
        ? settlePlatformPaymentObligationAction
        : undefined,
      createPlatformFinanceStop: actor.platformRole === "admin"
        ? createPlatformFinanceStopFactorAction
        : undefined,
      resolvePlatformFinanceStop: actor.platformRole === "admin"
        ? resolvePlatformFinanceStopFactorAction
        : undefined,
    },
    canManageLifecycle,
    canViewCaseAudit: workspaceAudit.length > 0 || canReadCaseWorkspace,
    canMutatePayments: actor.platformRole === "admin",
    canMutateFinanceStops: actor.platformRole === "admin",
    canUseAiSummary: false,
    studentRoute: {
      targetCountry: studentCase.targetCountry ?? "",
      targetDegree: studentCase.targetDegree ?? "",
      programDirection: studentCase.programDirection,
      intake: studentCase.intake,
      languageAssumption: studentCase.languageAssumption,
      fundingAssumption: studentCase.fundingAssumption,
      routeApprovalStatus: studentCase.routeApprovalStatus,
      operationalStage: studentCase.operationalStage,
      nextAction: studentCase.nextAction,
    },
    studentProfile: {
      revision: profileSnapshot?.profileRevision ?? 0,
      preferredDisplayName: profileSnapshot?.preferredDisplayName ?? null,
      legalDisplayName: profileSnapshot?.legalDisplayName ?? null,
      communicationLanguage: profileSnapshot?.communicationLanguage ?? null,
      dateOfBirth: profileSnapshot?.dateOfBirth ?? null,
      citizenshipCountry: profileSnapshot?.citizenshipCountry ?? null,
      residencyCountry: profileSnapshot?.residencyCountry ?? null,
      currentEducationSummary: profileSnapshot?.currentEducationSummary ?? null,
      academicSummary: profileSnapshot?.academicSummary ?? null,
      languageSummary: profileSnapshot?.languageSummary ?? null,
      budgetBand: profileSnapshot?.budgetBand ?? null,
      decisionParticipantLabels: profileSnapshot?.decisionParticipantLabels ?? [],
      consentStatus: profileSnapshot?.consentStatus ?? "not_recorded",
      consentEvidenceRef: profileSnapshot?.consentEvidenceRef ?? null,
      nextStep: profileSnapshot?.profileNextStep ?? null,
      appliedCountryRequirementVersionId:
        profileSnapshot?.appliedCountryRequirementVersionId
        ?? appliedCountryRequirement?.countryRequirementVersionId
        ?? null,
      checklistVersion:
        profileSnapshot?.checklistVersion ?? appliedCountryRequirement?.version ?? null,
      requiredProfileFields:
        profileSnapshot?.requiredProfileFields
        ?? appliedCountryRequirement?.requiredProfileFields
        ?? [],
    },
    countryRequirementVersions: countryRequirementVersions.map((version: (typeof countryRequirementVersions)[number]) => ({
      id: version.countryRequirementVersionId,
      checklistVersion: version.version,
      status: version.status,
      sourceCount: version.sourceCount,
    })),
    canEditStudentProfile: Boolean(appliedCountryRequirement)
      && (
        actor.platformRole === "admin"
        || actor.platformRole === "sales"
        || actor.platformRole === "curator"
      ),
    canApplyCountryRequirements:
      actor.platformRole === "admin" && hasStudentRouteFacts,
    canEditStudentRoute:
      !appliedCountryRequirement
      && (
        actor.platformRole === "admin"
        || actor.platformRole === "sales"
        || actor.platformRole === "curator"
      ),
    routeRequestId,
    profileRequestId,
    checklistRequestId,
    platformVisaRequestId,
    platformVisaMutationId,
    platformPaymentCreateRequestId,
    contractWorkspace: contractWorkspace ?? undefined,
    contractActions: contractWorkspace ? {
      createTemplate: createPlatformContractTemplateVersionAction,
      approveTemplate: approvePlatformContractTemplateVersionAction,
      retireTemplate: retirePlatformContractTemplateVersionAction,
      generateDraft: generatePlatformStudentCaseContractDraftAction,
      reviewDraft: reviewPlatformStudentCaseContractDraftAction,
      seedItems: seedPlatformPostContractItemsAction,
      updateItem: updatePlatformPostContractItemAction,
      generateReport: generatePlatformPostContractReportAction,
      reviewReport: reviewPlatformPostContractReportAction,
    } : undefined,
    contractRequestIdFor: contractWorkspace ? contractRequestIdFor : undefined,
    contractResult: contractWorkspace ? contractResult(query.bw6_result) : undefined,
    contractRetrySubjectId: contractWorkspace ? contractRetrySubjectId ?? undefined : undefined,
    sourceHint:
      "Операционный этап и команда читаются из аудируемого кейса EVO Platform. Этап продаж ведётся отдельно.",
    metrics: {
      activeApplications: applicationSummary.activeApplications,
      openDocuments: documents.filter((document) => document.status !== "approved").length,
      openTasks: studentCase.overdueTaskCount,
      pendingPayments: caseFinanceControl.obligations.filter(
        (payment) => payment.status !== "paid",
      ).length,
      nextDeadline: studentCase.handoff?.dueAt ?? "—",
    },
    blocker: riskSignals.length > 0
      ? { label: "Требует внимания", detail: riskSignals.join(" · "), href: "#overview" }
      : null,
    result:
      result(query.u8_result)
      ?? result(query.p6d_result)
      ?? result(query.result),
    lifecycleRequestId,
    warning: !studentCase.appliedOzoWorkflowContractVersionId
      ? {
          title: "Версия OZO ещё не привязана",
          description:
            "Переходы по утверждённому OZO-контракту остаются заблокированы до явной привязки версии.",
        }
      : !appliedCountryRequirement
        ? {
            title: "Страновой чек-лист ещё не назначен",
            description:
              "Администратор должен применить утверждённую версию с проверенными источниками до сбора дополнительных персональных данных.",
          }
        : undefined,
    connected: true,
    testId: "platform-client-detail-page",
  };
}

export async function ConnectedStudentCaseDetail({
  id,
  searchParams,
}: Readonly<{
  id: string;
  searchParams?: Promise<SearchParams>;
}>) {
  const [queryInput, { t, locale }] = await Promise.all([
    searchParams ?? Promise.resolve({}),
    getT(),
  ]);
  const data = await loadPlatformClientPageData(id, normalizeQuery(queryInput));
  if (!data) notFound();

  return <FixtureClientPage data={data} locale={locale} t={t} />;
}
