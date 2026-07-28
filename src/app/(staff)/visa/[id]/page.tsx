import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getVisaCaseForActor } from "@/lib/queries";
import { VISA_STATUSES } from "@/lib/db";
import { upsertVisaCaseAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, PageHeader, btnCls, inputCls, labelCls } from "@/components/ui";
import {
  ContextBanner,
  DetailBackLink,
  KeyValueGrid,
  QueueMetrics,
  WorkflowStepper,
} from "@/components/platform/operations/OperationsPrimitives";

export default async function VisaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireStaffRoute("/visa");
  const { t } = await getT();
  const { id } = await params;
  const visaCase = getVisaCaseForActor(user, Number(id));
  if (!visaCase) notFound();

  const workflowValues =
    visaCase.status === "rejected"
      ? ["not_started", "docs", "appointment", "submitted", "rejected"]
      : ["not_started", "docs", "appointment", "submitted", "approved"];
  const workflow = workflowValues.map((value) => ({
    value,
    label: t(`visa.${value}`),
  }));
  const readyDocuments = Math.max(0, visaCase.document_total - visaCase.document_open);
  const readinessPercent =
    visaCase.document_total === 0
      ? 0
      : Math.round((readyDocuments / visaCase.document_total) * 100);
  const needsAttention = visaCase.status === "rejected" || visaCase.document_open > 0;

  return (
    <div className="space-y-5">
      <DetailBackLink href="/visa" label={t("backToQueue")} />

      <PageHeader
        eyebrow={t("visaDetail")}
        title={visaCase.client_name}
        description={[visaCase.country, visaCase.target_country].filter(Boolean).join(" · ") || t("visaDetailHint")}
        action={<Badge value={visaCase.status} label={t(`visa.${visaCase.status}`)} />}
      />

      {needsAttention ? (
        <ContextBanner
          title={visaCase.status === "rejected" ? t("correctionRequired") : t("attentionRequired")}
          description={
            visaCase.notes ||
            `${visaCase.document_open} · ${t("documents")} · ${t("nextAction")}`
          }
          tone={visaCase.status === "rejected" ? "danger" : "warning"}
          action={
            <Link href={`/clients/${visaCase.client_id}`} className={btnCls}>
              {t("openStudent360")}
            </Link>
          }
        />
      ) : (
        <ContextBanner
          title={t("noActiveBlockers")}
          description={t("visaDetailHint")}
          tone="info"
        />
      )}

      <QueueMetrics
        items={[
          { label: t("readiness"), value: readinessPercent, meta: "%", tone: readinessPercent === 100 ? "ok" : "warn" },
          { label: t("documents"), value: `${readyDocuments}/${visaCase.document_total}`, tone: visaCase.document_open ? "warn" : "ok" },
          { label: t("applications"), value: visaCase.active_applications, tone: "info" },
          { label: t("openTasks"), value: visaCase.open_tasks, tone: visaCase.open_tasks ? "danger" : "ok" },
        ]}
      />

      <Card title={t("caseProgress")}>
        <WorkflowStepper
          label={t("caseProgress")}
          steps={workflow}
          current={visaCase.status}
          terminalDanger={visaCase.status === "rejected"}
        />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-5">
          <Card title={t("recordDetails")}>
            <form action={upsertVisaCaseAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="client_id" value={visaCase.client_id} />
              <div>
                <label htmlFor="visa-detail-country" className={labelCls}>{t("country")}</label>
                <input id="visa-detail-country" name="country" defaultValue={visaCase.country} className={inputCls} />
              </div>
              <div>
                <label htmlFor="visa-detail-status" className={labelCls}>{t("status")}</label>
                <select id="visa-detail-status" name="status" defaultValue={visaCase.status} className={inputCls}>
                  {VISA_STATUSES.map((value) => (
                    <option key={value} value={value}>{t(`visa.${value}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="visa-detail-appointment" className={labelCls}>{t("appointment")}</label>
                <input
                  id="visa-detail-appointment"
                  name="appointment_at"
                  type="datetime-local"
                  defaultValue={visaCase.appointment_at ?? ""}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="visa-detail-notes" className={labelCls}>{t("notes")}</label>
                <input id="visa-detail-notes" name="notes" defaultValue={visaCase.notes ?? ""} className={inputCls} />
              </div>
              <button type="submit" className={btnCls}>
                {t("save")}
              </button>
            </form>
          </Card>

          <ContextBanner
            title={t("sourceBoundary")}
            description={t("localRecordHint")}
            tone="neutral"
          />
        </div>

        <aside className="space-y-5">
          <Card title={t("owner")}>
            <KeyValueGrid
              items={[
                { label: t("manager"), value: visaCase.manager_name ?? t("notAssigned") },
                { label: t("curator"), value: visaCase.curator_name ?? t("notAssigned") },
                { label: t("operationalStageNotice"), value: <Badge value={visaCase.stage} label={t(`stage.${visaCase.stage}`)} /> },
                { label: t("appointment"), value: visaCase.appointment_at },
                { label: t("updated"), value: visaCase.updated_at },
              ]}
            />
            <Link href={`/clients/${visaCase.client_id}`} className={`${btnCls} mt-4 w-full`}>
              {t("openStudent360")}
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
