import { randomUUID } from "node:crypto";

import {
  changePlatformStudentCaseStateAction,
  updatePlatformStudentCaseRouteAction,
} from "@/lib/platform-admissions-actions";
import {
  applyPlatformCountryRequirementVersionAction,
  updatePlatformStudentProfileAction,
} from "@/lib/platform-student-profile-actions";
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
  getPlatformStudentCaseView,
  listPlatformApplications,
  parsePlatformAdmissionsUuid,
} from "@/lib/platform-admissions";
import {
  getPlatformStudentProfile,
  listPlatformCountryRequirementVersions,
  listPlatformStudentCaseDocuments,
} from "@/lib/platform-student-profile";
import {
  getPlatformCaseContractWorkspace,
  PLATFORM_CONTRACT_MUTATION_OUTCOMES,
} from "@/lib/platform-contract-workflow";
import { requirePlatformClientsActor } from "@/lib/platform-guards";

import type { ClientPagePresentationData } from "./ClientPageContent";
import type { ContractDraftReportResult } from "./ContractDraftReportWorkspace";

type Query = {
  result?: string;
  retry_request_id?: string;
  bw6_result?: string;
  bw6_retry_request_id?: string;
  bw6_retry_operation?: string;
  bw6_subject_id?: string;
};

function result(value: string | undefined) {
  return value === "saved" || value === "invalid" || value === "unavailable"
    ? value
    : undefined;
}

function contractResult(value: string | undefined): ContractDraftReportResult | undefined {
  return value && PLATFORM_CONTRACT_MUTATION_OUTCOMES.includes(
    value as ContractDraftReportResult,
  )
    ? value as ContractDraftReportResult
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
  const [
    applicationRows,
    profileSnapshot,
    documentRows,
    countryRequirementVersions,
    contractWorkspace,
  ] =
    await Promise.all([
      listPlatformApplications(actor),
      getPlatformStudentProfile(actor, studentCase.studentCaseId),
      listPlatformStudentCaseDocuments(actor, studentCase.studentCaseId),
      listPlatformCountryRequirementVersions(actor, studentCase.studentCaseId),
      canReadContractWorkspace
        ? getPlatformCaseContractWorkspace(actor, studentCase.studentCaseId)
        : Promise.resolve(null),
    ]);
  const appliedCountryRequirement =
    countryRequirementVersions.find((version) => version.isApplied) ?? null;
  const applications = applicationRows
    .filter((application) => application.studentCaseId === studentCase.studentCaseId)
    .map((application) => ({
      id: application.universityApplicationId,
      university: application.institutionName,
      country: application.targetCountry,
      program: application.programName,
      deadline: null,
      status: application.status,
    }));
  const documents = documentRows.map((document) => ({
    id: document.documentSlotId,
    name: document.requirementLabel,
    status: document.slotStatus === "submitted"
      ? "uploaded"
      : document.slotStatus === "correction_required"
          ? "rejected"
          : document.slotStatus,
    comment: document.reworkReason ?? document.nextAction ?? document.instructions,
    connected: false,
  }));
  const retryRequestId = parsePlatformAdmissionsUuid(query.retry_request_id);
  const profileRequestId = retryRequestId ?? randomUUID();
  const checklistRequestId = retryRequestId ?? randomUUID();
  const lifecycleRequestId = retryRequestId ?? randomUUID();
  const routeRequestId = retryRequestId ?? randomUUID();
  const contractRetryRequestId = parsePlatformAdmissionsUuid(query.bw6_retry_request_id);
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
  ].filter((value): value is string => Boolean(value)).join(" · ");
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
      target_country: studentCase.targetCountry,
      target_degree: studentCase.targetDegree,
      case_state: studentCase.state,
      contract_confirmed_at: studentCase.handoff?.createdAt ?? null,
      contract_confirmation_ref: studentCase.handoff?.studentCaseOpHandoffId ?? null,
      portal_activated_at: null,
      handoff_at: studentCase.handoffAt,
      curator_id: null,
      curator_name: studentCase.currentCuratorDisplayName,
      manager_name: studentCase.responsibleSalesDisplayName,
      notes,
    },
    applications,
    documents,
    visa: null,
    payments: [],
    tasks: [],
    updates: [],
    taskAssignees: [],
    curators: [],
    audit: [],
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
      documents: documents.map((document) => ({
        name: document.name,
        status: document.status,
      })),
      payments: [],
      visa: null,
    },
    stageItems: [
      { key: "pending", label: "Ожидает назначения" },
      { key: "active", label: "Активно" },
      { key: "closed", label: "Закрыто" },
    ],
    applicationStatuses: [],
    taskColumns: [],
    taskPriorities: [],
    visaStatuses: [],
    actions: {
      changePlatformState: changePlatformStudentCaseStateAction,
      updateStudentRoute: updatePlatformStudentCaseRouteAction,
      updateStudentProfile: updatePlatformStudentProfileAction,
      applyCountryRequirementVersion: applyPlatformCountryRequirementVersionAction,
    },
    canManageLifecycle,
    canViewCaseAudit: false,
    canMutatePayments: false,
    canUseAiSummary: false,
    studentRoute: {
      targetCountry: studentCase.targetCountry,
      targetDegree: studentCase.targetDegree,
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
    countryRequirementVersions: countryRequirementVersions.map((version) => ({
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
    canApplyCountryRequirements: actor.platformRole === "admin",
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
      activeApplications: applications.filter((application) =>
        application.status !== "rejected"
        && application.status !== "withdrawn"
        && application.status !== "closed",
      ).length,
      openDocuments: documents.filter((document) => document.status !== "approved").length,
      openTasks: studentCase.overdueTaskCount,
      pendingPayments: studentCase.overdueObligationCount,
      nextDeadline: studentCase.handoff?.dueAt ?? "—",
    },
    blocker: riskSignals.length > 0
      ? { label: "Требует внимания", detail: riskSignals.join(" · "), href: "#overview" }
      : null,
    result: result(query.result),
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
