import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getDocument } from "@/lib/queries";
import { DOC_STATUSES } from "@/lib/db";
import { setDocumentStatusAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, PageHeader, btnCls, inputCls } from "@/components/ui";
import {
  ContextBanner,
  DetailBackLink,
  KeyValueGrid,
  QueueMetrics,
  WorkflowStepper,
} from "@/components/platform/operations/OperationsPrimitives";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaffRoute("/documents");
  const { t } = await getT();
  const { id } = await params;
  const document = getDocument(Number(id));
  if (!document) notFound();

  const workflowValues =
    document.status === "rejected"
      ? ["required", "uploaded", "review", "rejected"]
      : ["required", "uploaded", "review", "approved"];
  const workflow = workflowValues.map((value) => ({
    value,
    label: t(`doc.${value}`),
  }));
  const needsAttention = document.status === "required" || document.status === "rejected";

  return (
    <div className="space-y-5">
      <DetailBackLink href="/documents" label={t("backToQueue")} />

      <PageHeader
        eyebrow={t("documentDetail")}
        title={document.name}
        description={document.comment || t("documentDetailHint")}
        action={<Badge value={document.status} label={t(`doc.${document.status}`)} />}
      />

      {needsAttention ? (
        <ContextBanner
          title={document.status === "rejected" ? t("correctionRequired") : t("attentionRequired")}
          description={document.comment || t("metadataOnlyHint")}
          tone="danger"
          action={
            <Link href={`/clients/${document.client_id}`} className={btnCls}>
              {t("openStudent360")}
            </Link>
          }
        />
      ) : (
        <ContextBanner
          title={t("sourceBoundary")}
          description={t("localRecordHint")}
          tone="info"
        />
      )}

      <QueueMetrics
        items={[
          { label: t("applications"), value: document.active_applications, meta: `/ ${document.application_total}`, tone: "info" },
          { label: t("openTasks"), value: document.open_tasks, tone: document.open_tasks ? "warn" : "ok" },
          { label: t("pendingPayments"), value: document.pending_payments, tone: document.pending_payments ? "warn" : "ok" },
          { label: t("status"), value: t(`doc.${document.status}`), tone: document.status === "approved" ? "ok" : document.status === "rejected" ? "danger" : "warn" },
        ]}
      />

      <Card title={t("caseProgress")}>
        <WorkflowStepper
          label={t("caseProgress")}
          steps={workflow}
          current={document.status}
          terminalDanger={document.status === "rejected"}
        />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-5">
          <Card title={t("recordDetails")}>
            <KeyValueGrid
              items={[
                { label: t("document"), value: document.name },
                { label: t("client"), value: document.client_name },
                { label: t("operationalStageNotice"), value: <Badge value={document.stage} label={t(`stage.${document.stage}`)} /> },
                { label: t("owner"), value: document.manager_name ?? t("notAssigned") },
                { label: t("updated"), value: document.updated_at },
                { label: t("comment"), value: document.comment },
              ]}
            />
          </Card>

          <Card title={t("status")}>
            <form action={setDocumentStatusAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <input type="hidden" name="id" value={document.id} />
              <input type="hidden" name="client_id" value={document.client_id} />
              <div>
                <label htmlFor="document-status-select" className="mb-1 block text-[12px] font-medium text-fg-2">
                  {t("status")}
                </label>
                <select id="document-status-select" name="status" defaultValue={document.status} className={inputCls}>
                  {DOC_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`doc.${value}`)}
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

        <aside className="space-y-5">
          <ContextBanner
            title={t("fileStorageUnavailable")}
            description={t("fileStorageUnavailableHint")}
            tone="warning"
          />
          <Card title={t("history")}>
            <p className="text-[13px] leading-6 text-fg-2">{t("noRecordedHistory")}</p>
            <p className="mt-3 font-mono text-[11.5px] text-fg-3">
              {t("updated")}: {document.updated_at}
            </p>
          </Card>
          <Link href={`/clients/${document.client_id}`} className={`${btnCls} w-full`}>
            {t("openStudent360")}
          </Link>
        </aside>
      </div>
    </div>
  );
}
