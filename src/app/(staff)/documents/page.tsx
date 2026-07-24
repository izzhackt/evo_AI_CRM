import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  Badge,
  Card,
  btnGhostCls,
  cn,
} from "@/components/ui";
import {
  ContextBanner,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";
import {
  getDocumentExperienceCopy,
  getDocumentGuidance,
} from "@/components/platform/documents/document-copy";
import { DOC_STATUSES } from "@/lib/db";
import type { DocumentStatus } from "@/lib/domain";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { allDocuments, type DocumentQueueRow } from "@/lib/queries";

function statusOf(document: DocumentQueueRow): DocumentStatus {
  return (DOC_STATUSES as readonly string[]).includes(document.status)
    ? (document.status as DocumentStatus)
    : "required";
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireStaffRoute("/documents");
  const { t, locale } = await getT();
  const copy = getDocumentExperienceCopy(locale);
  const { status } = await searchParams;
  const selectedStatus =
    status && (DOC_STATUSES as readonly string[]).includes(status)
      ? (status as DocumentStatus)
      : undefined;
  const documents = allDocuments({ status: selectedStatus });
  const allRows = selectedStatus ? allDocuments() : documents;
  const statusCount = (value: string) =>
    allRows.filter((document) => document.status === value).length;
  const needsAttention = allRows.filter(
    (document) => document.status === "required" || document.status === "rejected",
  ).length;
  const review = statusCount("review");
  const approved = statusCount("approved");

  const filters = [
    {
      value: "",
      label: t("all"),
      count: allRows.length,
      active: !selectedStatus,
      href: "/documents",
    },
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
        title={copy.queueBoundaryTitle}
        description={copy.queueBoundaryDescription}
        tone="warning"
      />

      <QueueMetrics
        items={[
          { label: t("documents"), value: allRows.length, tone: "accent" },
          {
            label: t("attentionRequired"),
            value: needsAttention,
            tone: needsAttention ? "danger" : "ok",
          },
          {
            label: t("documentsInReview"),
            value: review,
            tone: review ? "warn" : "ok",
          },
          { label: t("doc.approved"), value: approved, tone: "ok" },
        ]}
      />

      <nav
        aria-label={t("documentStatuses")}
        className="flex flex-wrap gap-2"
      >
        {filters.map((filter) => (
          <Link
            key={filter.value || "all"}
            href={filter.href}
            aria-current={filter.active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color] motion-reduce:transition-none",
              filter.active
                ? "bg-accent text-on-accent"
                : "bg-surface-2 text-fg-2 hover:text-fg",
            )}
          >
            {filter.label}
            <span
              className={cn(
                "font-mono text-[11.5px]",
                filter.active ? "text-on-accent/80" : "text-fg-3",
              )}
            >
              {filter.count}
            </span>
          </Link>
        ))}
      </nav>

      {documents.length === 0 ? (
        <Card>
          <div className="mx-auto flex max-w-md flex-col items-center py-7 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-card bg-surface-2 text-fg-3">
              <Icon name="folder" size={21} />
            </span>
            <h2 className="mt-4 text-[15px] font-bold text-fg">
              {selectedStatus ? copy.filteredEmptyTitle : copy.emptyTitle}
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-5 text-fg-3">
              {selectedStatus
                ? copy.filteredEmptyDescription
                : copy.emptyDescription}
            </p>
            {selectedStatus && (
              <Link href="/documents" className={cn(btnGhostCls, "mt-4")}>
                {copy.clearFilter}
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {documents.map((document) => {
              const documentStatus = statusOf(document);
              const guidance = getDocumentGuidance(
                documentStatus,
                Boolean(document.comment?.trim()),
                copy,
              );
              return (
                <article
                  key={document.id}
                  className="min-w-0 rounded-card border border-border bg-surface p-4 shadow-evo"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-nav bg-surface-2 text-fg-3">
                      <Icon name="file-check" size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/documents/${document.id}`}
                        className="break-words font-bold text-fg hover:text-accent"
                      >
                        {document.name}
                      </Link>
                      <Link
                        href={`/clients/${document.client_id}`}
                        className="mt-1 block break-words text-[12.5px] font-medium text-fg-2 hover:text-accent"
                      >
                        {document.client_name}
                      </Link>
                    </div>
                    <Badge
                      value={documentStatus}
                      label={t(`doc.${documentStatus}`)}
                    />
                  </div>

                  <div className="mt-3 rounded-nav bg-surface-2 px-3 py-2.5">
                    <p className="text-[12px] font-semibold text-fg">
                      {guidance.title}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-4 text-fg-3">
                      {guidance.nextStep}
                    </p>
                  </div>

                  {document.comment && (
                    <p className="mt-3 border-l-2 border-danger/40 pl-3 text-[12px] leading-5 text-fg-2">
                      {document.comment}
                    </p>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                    <p className="min-w-0 text-[11.5px] text-fg-3">
                      {copy.assignedOwner}:{" "}
                      <span className="font-medium text-fg-2">
                        {document.manager_name ?? copy.noOwner}
                      </span>
                    </p>
                    <Link
                      href={`/documents/${document.id}`}
                      className={cn(btnGhostCls, "shrink-0")}
                    >
                      {copy.openReview}
                      <Icon name="chevron-right" size={15} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>

          <Card
            bodyClassName="px-0 py-0"
            className="hidden min-w-0 overflow-hidden md:block"
          >
            <table className="w-full table-fixed text-left text-[13px]">
              <caption className="sr-only">{t("documentQueue")}</caption>
              <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="w-[36%] px-4 py-3 font-semibold lg:w-[30%] xl:w-[22%]">
                    {t("document")}
                  </th>
                  <th className="w-[27%] px-3 py-3 font-semibold lg:w-[22%] xl:w-[16%]">
                    {t("client")}
                  </th>
                  <th className="w-[20%] px-3 py-3 font-semibold lg:w-[18%] xl:w-[13%]">
                    {t("status")}
                  </th>
                  <th className="hidden w-[26%] px-3 py-3 font-semibold xl:table-cell">
                    {copy.ownerNextStep}
                  </th>
                  <th className="hidden w-[15%] px-3 py-3 font-semibold lg:table-cell xl:w-[10%]">
                    {t("updated")}
                  </th>
                  <th className="w-[17%] px-4 py-3 text-right font-semibold lg:w-[15%] xl:w-[13%]">
                    <span className="sr-only">{copy.openReview}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.map((document) => {
                  const documentStatus = statusOf(document);
                  const guidance = getDocumentGuidance(
                    documentStatus,
                    Boolean(document.comment?.trim()),
                    copy,
                  );
                  return (
                    <tr
                      key={document.id}
                      className="align-middle transition-[background-color] hover:bg-surface-2 motion-reduce:transition-none"
                    >
                      <td className="min-w-0 px-4 py-3.5">
                        <Link
                          href={`/documents/${document.id}`}
                          className="flex min-w-0 items-center gap-3 font-semibold text-fg hover:text-accent"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-nav bg-surface-2 text-fg-3">
                            <Icon name="file-check" size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate">{document.name}</span>
                            {document.comment && (
                              <span className="mt-0.5 block truncate text-[11.5px] font-normal text-danger">
                                {document.comment}
                              </span>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td className="min-w-0 px-3 py-3.5">
                        <Link
                          href={`/clients/${document.client_id}`}
                          className="block truncate font-semibold text-fg hover:text-accent"
                        >
                          {document.client_name}
                        </Link>
                        <div className="mt-1">
                          <Badge
                            value={document.stage}
                            label={t(`stage.${document.stage}`)}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <Badge
                          value={documentStatus}
                          label={t(`doc.${documentStatus}`)}
                        />
                        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-fg-3">
                          {guidance.title}
                        </p>
                      </td>
                      <td className="hidden min-w-0 px-3 py-3.5 xl:table-cell">
                        <p className="truncate text-[11.5px] font-semibold text-fg-2">
                          {document.manager_name ?? copy.noOwner}
                        </p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-fg-3">
                          {guidance.nextStep}
                        </p>
                      </td>
                      <td className="hidden px-3 py-3.5 font-mono text-[11px] text-fg-3 lg:table-cell">
                        {document.updated_at}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/documents/${document.id}`}
                          aria-label={`${copy.openReview}: ${document.name}`}
                          className={cn(btnGhostCls, "max-w-full px-2.5 xl:px-3")}
                        >
                          <span className="hidden truncate xl:inline">
                            {copy.reviewActionShort}
                          </span>
                          <Icon name="chevron-right" size={15} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
