import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getApplicationForActor } from "@/lib/queries";
import { APP_STATUSES } from "@/lib/db";
import { setApplicationStatusAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, PageHeader, btnCls, btnGhostCls, inputCls } from "@/components/ui";
import {
  ContextBanner,
  DetailBackLink,
  KeyValueGrid,
  QueueMetrics,
  WorkflowStepper,
} from "@/components/platform/operations/OperationsPrimitives";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireStaffRoute("/applications");
  const { t } = await getT();
  const { id } = await params;
  const application = getApplicationForActor(user, Number(id));
  if (!application) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const isTerminal = application.status === "enrolled" || application.status === "rejected";
  const isOverdue = !!application.deadline && application.deadline < today && !isTerminal;
  const workflowValues =
    application.status === "rejected"
      ? ["preparing", "submitted", "rejected"]
      : ["preparing", "submitted", "offer", "enrolled"];
  const workflow = workflowValues.map((value) => ({
    value,
    label: t(`app.${value}`),
  }));
  const readyDocuments = Math.max(0, application.document_total - application.document_open);
  const readinessPercent =
    application.document_total === 0
      ? 0
      : Math.round((readyDocuments / application.document_total) * 100);

  const attention = isOverdue
    ? { title: t("deadlinePassed"), detail: application.deadline ?? "—", href: "#application-status", label: t("status"), tone: "danger" as const }
    : application.document_open > 0
      ? { title: t("correctionRequired"), detail: `${application.document_open} · ${t("documents")}`, href: `/documents`, label: t("documents"), tone: "warning" as const }
      : application.open_tasks > 0
        ? { title: t("nextAction"), detail: `${application.open_tasks} · ${t("openTasks")}`, href: "/tasks", label: t("tasks"), tone: "warning" as const }
        : { title: t("noActiveBlockers"), detail: t("applicationDetailHint"), href: `/clients/${application.client_id}`, label: t("openStudent360"), tone: "info" as const };

  return (
    <div className="space-y-5">
      <DetailBackLink href="/applications" label={t("backToQueue")} />

      <PageHeader
        eyebrow={t("applicationDetail")}
        title={application.university}
        description={[application.program, application.degree, application.country].filter(Boolean).join(" · ") || t("applicationDetailHint")}
        action={<Badge value={application.status} label={t(`app.${application.status}`)} />}
      />

      <ContextBanner
        title={attention.title}
        description={attention.detail}
        tone={attention.tone}
        action={
          <Link href={attention.href} className={btnGhostCls}>
            {attention.label}
          </Link>
        }
      />

      <QueueMetrics
        items={[
          { label: t("readiness"), value: readinessPercent, meta: "%", tone: readinessPercent === 100 ? "ok" : "warn" },
          { label: t("documents"), value: `${readyDocuments}/${application.document_total}`, tone: application.document_open ? "warn" : "ok" },
          { label: t("openTasks"), value: application.open_tasks, tone: application.open_tasks ? "danger" : "ok" },
          { label: t("pendingPayments"), value: application.pending_payments, tone: application.pending_payments ? "warn" : "ok" },
        ]}
      />

      <Card title={t("caseProgress")}>
        <WorkflowStepper
          label={t("caseProgress")}
          steps={workflow}
          current={application.status}
          terminalDanger={application.status === "rejected"}
        />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-5">
          <Card title={t("recordDetails")}>
            <KeyValueGrid
              items={[
                { label: t("client"), value: application.client_name },
                { label: t("university"), value: application.university },
                { label: t("program"), value: application.program },
                { label: t("degree"), value: application.degree },
                { label: t("country"), value: application.country },
                { label: t("deadline"), value: application.deadline },
                { label: t("updated"), value: application.updated_at },
                { label: t("notes"), value: application.notes },
              ]}
            />
          </Card>

          <div id="application-status">
            <Card title={t("status")}>
              <form action={setApplicationStatusAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <input type="hidden" name="id" value={application.id} />
                <input type="hidden" name="client_id" value={application.client_id} />
                <div>
                  <label htmlFor="application-status-select" className="mb-1 block text-[12px] font-medium text-fg-2">
                    {t("status")}
                  </label>
                  <select id="application-status-select" name="status" defaultValue={application.status} className={inputCls}>
                    {APP_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {t(`app.${value}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className={btnCls}>
                  {t("save")}
                </button>
              </form>
            </Card>
          </div>
        </div>

        <aside className="space-y-5">
          <Card title={t("owner")}>
            <KeyValueGrid
              items={[
                { label: t("manager"), value: application.manager_name ?? t("notAssigned") },
                { label: t("operationalStageNotice"), value: <Badge value={application.stage} label={t(`stage.${application.stage}`)} /> },
              ]}
            />
            <Link href={`/clients/${application.client_id}`} className={`${btnCls} mt-4 w-full`}>
              {t("openStudent360")}
            </Link>
          </Card>

          <ContextBanner
            title={t("sourceBoundary")}
            description={t("localRecordHint")}
            tone="neutral"
          />
        </aside>
      </div>
    </div>
  );
}
