import { notFound } from "next/navigation";

import { setApplicationStatusAction } from "@/lib/actions";
import { APP_STATUSES } from "@/lib/db";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { getApplicationForActor } from "@/lib/queries";

import {
  createApplicationsPresenterCopy,
  type ApplicationDetailPresenterModel,
  type ApplicationDetailSearchParams,
} from "../ApplicationsPresenter";

export async function loadLegacyApplicationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ApplicationDetailSearchParams>;
}): Promise<ApplicationDetailPresenterModel> {
  const [user, { t }, { id }] = await Promise.all([
    requireStaffRoute("/applications"),
    getT(),
    params,
  ]);
  const application = getApplicationForActor(user, Number(id));
  if (!application) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const isTerminal =
    application.status === "enrolled" || application.status === "rejected";
  const isOverdue =
    application.deadline !== null &&
    application.deadline < today &&
    !isTerminal;
  const workflowValues =
    application.status === "rejected"
      ? ["preparing", "submitted", "rejected"]
      : ["preparing", "submitted", "offer", "enrolled"];
  const readyDocuments = Math.max(
    0,
    application.document_total - application.document_open,
  );
  const readinessPercent =
    application.document_total === 0
      ? 0
      : Math.round((readyDocuments / application.document_total) * 100);
  const attention = isOverdue
    ? {
        title: t("deadlinePassed"),
        description: application.deadline ?? "—",
        actionHref: "#application-status",
        actionLabel: t("status"),
        tone: "danger" as const,
      }
    : application.document_open > 0
      ? {
          title: t("correctionRequired"),
          description: `${application.document_open} · ${t("documents")}`,
          actionHref: "/documents",
          actionLabel: t("documents"),
          tone: "warning" as const,
        }
      : application.open_tasks > 0
        ? {
            title: t("nextAction"),
            description: `${application.open_tasks} · ${t("openTasks")}`,
            actionHref: "/tasks",
            actionLabel: t("tasks"),
            tone: "warning" as const,
          }
        : {
            title: t("noActiveBlockers"),
            description: t("applicationDetailHint"),
            actionHref: `/clients/${application.client_id}`,
            actionLabel: t("openStudent360"),
            tone: "info" as const,
          };

  return {
    copy: createApplicationsPresenterCopy(t),
    studentCaseId: String(application.client_id),
    institutionName: application.university,
    description:
      [application.program, application.degree, application.country]
        .filter(Boolean)
        .join(" · ") || t("applicationDetailHint"),
    status: application.status,
    statusLabel: t(`app.${application.status}`),
    attention,
    readinessPercent,
    documentCount: application.document_total,
    openDocumentCount: application.document_open,
    openTaskCount: application.open_tasks,
    pendingPaymentCount: application.pending_payments,
    workflow: workflowValues.map((value) => ({
      value,
      label: t(`app.${value}`),
    })),
    terminalDanger: application.status === "rejected",
    recordItems: [
      { label: t("client"), value: application.client_name },
      { label: t("university"), value: application.university },
      { label: t("program"), value: application.program },
      { label: t("degree"), value: application.degree },
      { label: t("country"), value: application.country },
      { label: t("deadline"), value: application.deadline },
      { label: t("updated"), value: application.updated_at },
      { label: t("notes"), value: application.notes },
    ],
    ownerItems: [
      {
        label: t("manager"),
        value: application.manager_name,
      },
      {
        label: t("operationalStageNotice"),
        value: null,
        badge: {
          value: application.stage,
          label: t(`stage.${application.stage}`),
        },
      },
    ],
    sourceBoundary: {
      title: t("sourceBoundary"),
      description: t("localRecordHint"),
      tone: "neutral",
    },
    statusForm: {
      action: setApplicationStatusAction,
      hiddenFields: [
        { name: "id", value: String(application.id) },
        { name: "client_id", value: String(application.client_id) },
      ],
      statusOptions: APP_STATUSES.map((value) => ({
        value,
        label: t(`app.${value}`),
      })),
      submitLabel: t("save"),
    },
  };
}
