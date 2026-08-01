import { setApplicationStatusAction } from "@/lib/actions";
import { APP_STATUSES } from "@/lib/db";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { listApplicationsForActor } from "@/lib/queries";

import {
  createApplicationsPresenterCopy,
  type ApplicationQueuePresenterRow,
  type ApplicationsQueuePresenterModel,
  type ApplicationsSearchParams,
} from "./ApplicationsPresenter";

export async function loadLegacyApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<ApplicationsSearchParams>;
}): Promise<ApplicationsQueuePresenterModel> {
  const [user, { t }, query] = await Promise.all([
    requireStaffRoute("/applications"),
    getT(),
    searchParams,
  ]);
  const selectedStatus =
    query.status &&
    (APP_STATUSES as readonly string[]).includes(query.status)
      ? query.status
      : undefined;
  const applications = listApplicationsForActor(user, {
    status: selectedStatus,
  });
  const allApplications = selectedStatus
    ? listApplicationsForActor(user)
    : applications;
  const today = new Date().toISOString().slice(0, 10);
  const statusOptions = APP_STATUSES.map((value) => ({
    value,
    label: t(`app.${value}`),
  }));

  const present = (
    application: (typeof allApplications)[number],
  ): ApplicationQueuePresenterRow => {
    const isTerminal =
      application.status === "enrolled" ||
      application.status === "rejected";
    const isOverdue =
      application.deadline !== null &&
      application.deadline < today &&
      !isTerminal;
    return {
      id: String(application.id),
      studentCaseId: String(application.client_id),
      studentDisplayName: application.client_name,
      caseStage: {
        value: application.stage,
        label: t(`stage.${application.stage}`),
      },
      institutionName: application.university,
      programName: application.program,
      degree: application.degree,
      country: application.country,
      status: application.status,
      statusLabel: t(`app.${application.status}`),
      deadline: application.deadline,
      documentCount: application.document_total,
      openDocumentCount: application.document_open,
      openTaskCount: application.open_tasks,
      pendingPaymentCount: application.pending_payments,
      needsAttention: isOverdue,
      readyForDecision:
        application.status === "submitted" ||
        application.status === "offer",
      statusHiddenFields: [
        { name: "id", value: String(application.id) },
        { name: "client_id", value: String(application.client_id) },
      ],
    };
  };

  return {
    copy: createApplicationsPresenterCopy(t),
    operationalNotice: {
      title: t("operationalStageNotice"),
      description: t("operationalStageHint"),
      tone: "info",
    },
    rows: applications.map(present),
    allRows: allApplications.map(present),
    selectedStatus,
    statusOptions,
    emptyText: t("noApplications"),
    filteredEmptyText: t("noFilteredApplications"),
    queueStatusAction: setApplicationStatusAction,
  };
}
