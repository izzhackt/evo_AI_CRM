import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  Badge,
  Card,
  PageHeader,
  btnCls,
  btnGhostCls,
  cn,
} from "@/components/ui";
import { DocumentDecisionPanel } from "@/components/platform/documents/DocumentDecisionPanel";
import { DocumentJourney } from "@/components/platform/documents/DocumentJourney";
import {
  getDocumentExperienceCopy,
  getDocumentGuidance,
} from "@/components/platform/documents/document-copy";
import {
  ContextBanner,
  DetailBackLink,
  KeyValueGrid,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";
import { DOC_STATUSES } from "@/lib/db";
import type { DocumentStatus } from "@/lib/domain";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { getDocument } from "@/lib/queries";

type DocumentUpdate = "approved" | "required" | "rejected" | "review";
type DocumentError =
  | "comment_required"
  | "comment_too_long"
  | "invalid_transition";

function statusOf(value: string): DocumentStatus {
  return (DOC_STATUSES as readonly string[]).includes(value)
    ? (value as DocumentStatus)
    : "required";
}

function formatTimestamp(
  value: string,
  locale: "ru" | "ky" | "en",
): string {
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(
    { ru: "ru-RU", ky: "ky-KG", en: "en-US" }[locale],
    {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bishkek",
    },
  ).format(parsed);
}

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  await requireStaffRoute("/documents");
  const { t, locale } = await getT();
  const copy = getDocumentExperienceCopy(locale);
  const { id } = await params;
  const { updated, error } = await searchParams;
  const document = getDocument(Number(id));
  if (!document) notFound();

  const status = statusOf(document.status);
  const correctionRequested =
    status === "required" && Boolean(document.comment?.trim());
  const guidance = getDocumentGuidance(
    status,
    Boolean(document.comment?.trim()),
    copy,
  );
  const updatedKey = (
    ["approved", "required", "rejected", "review"] as const
  ).includes(updated as DocumentUpdate)
    ? (updated as DocumentUpdate)
    : null;
  const errorKey = (
    ["comment_required", "comment_too_long", "invalid_transition"] as const
  ).includes(error as DocumentError)
    ? (error as DocumentError)
    : null;
  const updatedAt = formatTimestamp(document.updated_at, locale);
  const statusTone =
    status === "rejected" || correctionRequested
      ? "danger"
      : status === "required" || status === "review"
        ? "warning"
        : "info";

  return (
    <div className="space-y-5">
      <DetailBackLink href="/documents" label={copy.backToQueue} />

      <PageHeader
        eyebrow={t("documentDetail")}
        title={document.name}
        description={document.client_name}
        action={<Badge value={status} label={t(`doc.${status}`)} />}
      />

      {updatedKey && (
        <ContextBanner
          title={copy.updateMessages[updatedKey]}
          description={copy.mutationBoundary}
          tone="info"
        />
      )}

      {errorKey && (
        <ContextBanner
          title={copy.errorMessages[errorKey]}
          description={copy.decisionReasonHelp}
          tone="danger"
        />
      )}

      <ContextBanner
        title={guidance.title}
        description={guidance.description}
        tone={statusTone}
        action={
          <Link href={`/clients/${document.client_id}`} className={btnGhostCls}>
            {t("openStudent360")}
          </Link>
        }
      />

      <QueueMetrics
        items={[
          {
            label: t("applications"),
            value: document.active_applications,
            meta: `/ ${document.application_total}`,
            tone: "info",
          },
          {
            label: t("openTasks"),
            value: document.open_tasks,
            tone: document.open_tasks ? "warn" : "ok",
          },
          {
            label: t("pendingPayments"),
            value: document.pending_payments,
            tone: document.pending_payments ? "warn" : "ok",
          },
          {
            label: t("status"),
            value: t(`doc.${status}`),
            tone:
              status === "approved"
                ? "ok"
                : status === "rejected" || correctionRequested
                  ? "danger"
                  : "warn",
          },
        ]}
      />

      <DocumentJourney
        status={status}
        correctionRequested={correctionRequested}
        copy={copy}
      />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.78fr)]">
        <div className="min-w-0 space-y-5">
          <DocumentDecisionPanel id={document.id} status={status} copy={copy} />

          <Card title={copy.fileWorkspace}>
            <div className="rounded-card border border-dashed border-border-strong bg-surface-2 px-4 py-8 text-center sm:px-6 sm:py-10">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-card bg-surface text-fg-3 shadow-evo">
                <Icon name="folder" size={21} />
              </span>
              <h2 className="mt-4 text-[15px] font-bold text-fg">
                {copy.noFileTitle}
              </h2>
              <p className="mx-auto mt-1.5 max-w-xl text-[12.5px] leading-5 text-fg-2">
                {copy.noFileDescription}
              </p>
              <p className="mx-auto mt-2 max-w-xl font-mono text-[10.5px] leading-4 text-fg-3">
                {copy.noFileTechnicalNote}
              </p>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled
                title={copy.storageBlockReason}
                className={btnGhostCls}
              >
                <Icon name="file-check" size={15} />
                {copy.openFile}
              </button>
              <button
                type="button"
                disabled
                title={copy.storageBlockReason}
                className={btnGhostCls}
              >
                <Icon name="download" size={15} />
                {copy.downloadFile}
              </button>
              <button
                type="button"
                disabled
                title={copy.storageBlockReason}
                className={cn(btnCls, "sm:col-span-2")}
              >
                <Icon name="upload" size={15} />
                {copy.uploadNewVersion}
              </button>
            </div>
            <p className="mt-3 text-[11.5px] leading-4 text-fg-3">
              {copy.storageUnknownLimits}
            </p>
          </Card>

          <Card title={t("recordDetails")}>
            <KeyValueGrid
              items={[
                { label: t("document"), value: document.name },
                { label: t("client"), value: document.client_name },
                {
                  label: t("operationalStageNotice"),
                  value: (
                    <Badge
                      value={document.stage}
                      label={t(`stage.${document.stage}`)}
                    />
                  ),
                },
                {
                  label: t("owner"),
                  value: document.manager_name ?? copy.noOwner,
                },
                { label: copy.updatedAt, value: updatedAt },
                { label: t("comment"), value: document.comment },
              ]}
            />
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card title={copy.ownerAndNextStep}>
            <dl className="space-y-4">
              <div>
                <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                  {copy.ownerLabel}
                </dt>
                <dd className="mt-1 text-[13.5px] font-semibold text-fg">
                  {document.manager_name ?? copy.noOwner}
                </dd>
              </div>
              <div className="border-t border-border pt-4">
                <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                  {copy.nextStepLabel}
                </dt>
                <dd className="mt-1 text-[12.5px] leading-5 text-fg-2">
                  {guidance.nextStep}
                </dd>
              </div>
              <div className="border-t border-border pt-4">
                <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                  {copy.blockedReasonLabel}
                </dt>
                <dd className="mt-1 text-[12.5px] leading-5 text-warn">
                  {copy.storageBlockReason}
                </dd>
              </div>
            </dl>
            <Link
              href={`/clients/${document.client_id}#documents`}
              className={cn(btnGhostCls, "mt-5 w-full")}
            >
              {t("openStudent360")}
            </Link>
          </Card>

          <Card title={copy.currentRecordHistory}>
            <div className="rounded-nav border border-warn/30 bg-warn-weak p-3 text-warn">
              <h3 className="text-[12.5px] font-bold">
                {copy.historyUnavailableTitle}
              </h3>
              <p className="mt-1 text-[11.5px] leading-4 opacity-85">
                {copy.historyUnavailableDescription}
              </p>
            </div>

            <ol className="mt-4" aria-label={copy.currentRecordHistory}>
              <li className="grid grid-cols-[12px_minmax(0,1fr)] gap-3">
                <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-info ring-4 ring-info-weak" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-fg">
                      {copy.currentRecord}
                    </h3>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-fg-3">
                      {copy.currentRecordNotVersion}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-2 text-[11.5px]">
                    <div>
                      <dt className="text-fg-3">{copy.recordedStatus}</dt>
                      <dd className="mt-0.5">
                        <Badge
                          value={status}
                          label={t(`doc.${status}`)}
                        />
                      </dd>
                    </div>
                    {document.comment && (
                      <div>
                        <dt className="text-fg-3">
                          {copy.recordedComment}
                        </dt>
                        <dd className="mt-0.5 break-words leading-4 text-fg-2">
                          {document.comment}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-fg-3">{copy.updatedAt}</dt>
                      <dd className="mt-0.5 font-mono text-fg-2">
                        {updatedAt}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            </ol>

            <div className="mt-5 border-t border-border pt-4">
              <button
                type="button"
                disabled
                title={copy.storageBlockReason}
                className={cn(btnGhostCls, "w-full")}
              >
                <Icon name="upload" size={15} />
                {copy.resubmitVersion}
              </button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
