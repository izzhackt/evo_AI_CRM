import { randomUUID } from "node:crypto";

import { changePlatformStudentCaseStateAction } from "@/lib/platform-admissions-actions";
import {
  getPlatformStudentCaseView,
  listPlatformApplications,
  parsePlatformAdmissionsUuid,
} from "@/lib/platform-admissions";
import { requirePlatformClientsActor } from "@/lib/platform-guards";

import type { ClientPagePresentationData } from "./ClientPageContent";

type Query = { result?: string; retry_request_id?: string };

function result(value: string | undefined) {
  return value === "saved" || value === "invalid" || value === "unavailable"
    ? value
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
  const applications = (await listPlatformApplications(actor))
    .filter((application) => application.studentCaseId === studentCase.studentCaseId)
    .map((application) => ({
      id: application.universityApplicationId,
      university: application.institutionName,
      country: application.targetCountry,
      program: application.programName,
      deadline: null,
      status: application.status,
    }));
  const lifecycleRequestId =
    parsePlatformAdmissionsUuid(query.retry_request_id) ?? randomUUID();
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
    documents: [],
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
      documents: [],
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
    actions: { changePlatformState: changePlatformStudentCaseStateAction },
    canManageLifecycle,
    canViewCaseAudit: false,
    canMutatePayments: false,
    canUseAiSummary: false,
    sourceHint:
      "Операционный этап и команда читаются из аудируемого кейса EVO Platform. Этап продаж ведётся отдельно.",
    metrics: {
      activeApplications: applications.filter((application) =>
        application.status !== "rejected"
        && application.status !== "withdrawn"
        && application.status !== "closed",
      ).length,
      openDocuments: studentCase.rejectedDocumentCount,
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
      : undefined,
    connected: true,
    testId: "platform-client-detail-page",
  };
}
