import Link from "next/link";
import { getT } from "@/lib/i18n";
import { allDocuments, type DocumentQueueRow } from "@/lib/queries";
import { DOC_STATUSES } from "@/lib/db";
import { setDocumentStatusAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, btnGhostCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  ContextBanner,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";

const selectCls =
  "h-10 rounded-nav border border-border-strong bg-surface px-2 text-[12px] text-fg focus-visible:border-accent";

function ReviewForm({
  doc,
  t,
}: {
  doc: DocumentQueueRow;
  t: (key: string) => string;
}) {
  return (
    <form action={setDocumentStatusAction} className="flex min-w-0 items-center gap-1.5">
      <input type="hidden" name="id" value={doc.id} />
      <input type="hidden" name="client_id" value={doc.client_id} />
      <label className="sr-only" htmlFor={`document-status-${doc.id}`}>
        {t("status")}
      </label>
      <select
        id={`document-status-${doc.id}`}
        name="status"
        defaultValue={doc.status}
        className={cn(selectCls, "min-w-0 flex-1")}
      >
        {DOC_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`doc.${value}`)}
          </option>
        ))}
      </select>
      <button type="submit" className={btnGhostCls}>
        {t("save")}
      </button>
    </form>
  );
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireStaffRoute("/documents");
  const { t } = await getT();
  const { status } = await searchParams;
  const selectedStatus =
    status && (DOC_STATUSES as readonly string[]).includes(status) ? status : undefined;
  const documents = allDocuments({ status: selectedStatus });
  const allRows = selectedStatus ? allDocuments() : documents;
  const statusCount = (value: string) => allRows.filter((doc) => doc.status === value).length;
  const needsAttention = allRows.filter((doc) => doc.status === "required" || doc.status === "rejected").length;
  const review = statusCount("review");
  const approved = statusCount("approved");

  const pills = [
    { value: "", label: t("all"), count: allRows.length, active: !selectedStatus, href: "/documents" },
    ...DOC_STATUSES.map((value) => ({
      value,
      label: t(`doc.${value}`),
      count: statusCount(value),
      active: selectedStatus === value,
      href: `/documents?status=${value}`,
    })),
  ];

  return (
    <div className="space-y-5">
      <ContextBanner
        title={t("metadataOnly")}
        description={t("metadataOnlyHint")}
        tone="warning"
      />

      <QueueMetrics
        items={[
          { label: t("documents"), value: allRows.length, tone: "accent" },
          { label: t("attentionRequired"), value: needsAttention, tone: needsAttention ? "danger" : "ok" },
          { label: t("documentsInReview"), value: review, tone: review ? "warn" : "ok" },
          { label: t("doc.approved"), value: approved, tone: "ok" },
        ]}
      />

      <nav aria-label={t("documentStatuses")} className="flex flex-wrap gap-2">
        {pills.map((pill) => (
          <Link
            key={pill.value || "all"}
            href={pill.href}
            aria-current={pill.active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color]",
              pill.active ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg",
            )}
          >
            {pill.label}
            <span className={cn("font-mono text-[11.5px]", pill.active ? "text-on-accent/80" : "text-fg-3")}>
              {pill.count}
            </span>
          </Link>
        ))}
      </nav>

      {documents.length === 0 ? (
        <Card>
          <EmptyState text={selectedStatus ? t("noFilteredDocuments") : t("noDocuments")} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {documents.map((doc) => (
              <article key={doc.id} className="rounded-card border border-border bg-surface p-4 shadow-evo">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-nav bg-surface-2 text-fg-3">
                    <Icon name="file-check" size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/documents/${doc.id}`} className="font-bold text-fg hover:text-accent">
                      {doc.name}
                    </Link>
                    <Link href={`/clients/${doc.client_id}`} className="mt-1 block text-[12.5px] font-medium text-fg-2 hover:text-accent">
                      {doc.client_name}
                    </Link>
                  </div>
                  <Badge value={doc.status} label={t(`doc.${doc.status}`)} />
                </div>
                {doc.comment && (
                  <p className="mt-3 rounded-nav bg-surface-2 px-3 py-2 text-[12px] leading-5 text-fg-2">
                    {doc.comment}
                  </p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <span className="text-fg-3">{t("applications")}</span>
                    <p className="mt-0.5 font-semibold text-fg">{doc.active_applications}/{doc.application_total}</p>
                  </div>
                  <div>
                    <span className="text-fg-3">{t("openTasks")}</span>
                    <p className="mt-0.5 font-semibold text-fg">{doc.open_tasks}</p>
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-3">
                  <ReviewForm doc={doc} t={t} />
                </div>
              </article>
            ))}
          </div>

          <Card bodyClassName="px-0 py-0" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
                  <tr>
                    <th className="px-5 py-3 font-semibold">{t("document")}</th>
                    <th className="px-4 py-3 font-semibold">{t("client")}</th>
                    <th className="px-4 py-3 font-semibold">{t("readiness")}</th>
                    <th className="px-4 py-3 font-semibold">{t("updated")}</th>
                    <th className="px-5 py-3 font-semibold">{t("status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="align-middle transition-[background-color] hover:bg-surface-2">
                      <td className="px-5 py-3">
                        <Link href={`/documents/${doc.id}`} className="flex items-center gap-3 font-semibold text-fg hover:text-accent">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-nav bg-surface-2 text-fg-3">
                            <Icon name="file-check" size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block">{doc.name}</span>
                            {doc.comment && <span className="block max-w-64 truncate text-[11.5px] font-normal text-fg-3">{doc.comment}</span>}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/clients/${doc.client_id}`} className="font-semibold text-fg hover:text-accent">
                          {doc.client_name}
                        </Link>
                        <div className="mt-1">
                          <Badge value={doc.stage} label={t(`stage.${doc.stage}`)} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        <div className="font-mono text-fg">{doc.active_applications}/{doc.application_total} {t("applications")}</div>
                        <div className="mt-1 text-fg-3">{doc.open_tasks} {t("openTasks")}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-fg-2">{doc.updated_at}</td>
                      <td className="px-5 py-3">
                        <ReviewForm doc={doc} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
