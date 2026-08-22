import Link from "next/link";

import {
  ContextBanner,
  DetailBackLink,
  KeyValueGrid,
  QueueMetrics,
  WorkflowStepper,
} from "@/components/platform/operations/OperationsPrimitives";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  btnCls,
  btnGhostCls,
  cn,
  inputCls,
  labelCls,
} from "@/components/ui";

import {
  CatalogImportWorkspace,
  type CatalogImportWorkspaceModel,
} from "./CatalogImportWorkspace";
import { ApplicationInstitutionFields } from "./ApplicationInstitutionFields";

export type ApplicationsSearchParams = Readonly<{
  status?: string;
  before_at?: string | string[];
  before_id?: string | string[];
  case_q?: string;
  result?: string;
  student_case_id?: string;
  retry_request_id?: string;
  catalog_result?: string;
  catalog_batch_id?: string;
  catalog_page?: string | string[];
  catalog_retry_request_id?: string;
  catalog_retry_op?: string;
}>;

export type ApplicationDetailSearchParams = Readonly<{
  result?: string;
  retry_request_id?: string;
}>;

export type ApplicationFormAction = (
  formData: FormData,
) => void | Promise<void>;

export type ApplicationStatusOption = Readonly<{
  value: string;
  label: string;
}>;

export type PresenterBanner = Readonly<{
  title: string;
  description: string;
  tone: "neutral" | "warning" | "danger" | "info";
}>;

export type ApplicationsPresenterCopy = Readonly<{
  all: string;
  search: string;
  activeApplications: string;
  attentionRequired: string;
  documentsInReview: string;
  readiness: string;
  status: string;
  applicationStatuses: string;
  client: string;
  deadline: string;
  documents: string;
  openTasks: string;
  pendingPayments: string;
  university: string;
  payments: string;
  save: string;
  addApplication: string;
  notes: string;
  backToQueue: string;
  applicationDetail: string;
  applicationDetailHint: string;
  caseProgress: string;
  recordDetails: string;
  program: string;
  degree: string;
  country: string;
  updated: string;
  owner: string;
  manager: string;
  notAssigned: string;
  openStudent360: string;
  operationalStageNotice: string;
  operationalStageHint: string;
  sourceBoundary: string;
  localRecordHint: string;
}>;

export function createApplicationsPresenterCopy(
  t: (key: string) => string,
): ApplicationsPresenterCopy {
  return {
    all: t("all"),
    search: t("search"),
    activeApplications: t("activeApplications"),
    attentionRequired: t("attentionRequired"),
    documentsInReview: t("documentsInReview"),
    readiness: t("readiness"),
    status: t("status"),
    applicationStatuses: t("applicationStatuses"),
    client: t("client"),
    deadline: t("deadline"),
    documents: t("documents"),
    openTasks: t("openTasks"),
    pendingPayments: t("pendingPayments"),
    university: t("university"),
    payments: t("payments"),
    save: t("save"),
    addApplication: t("addApplication"),
    notes: t("notes"),
    backToQueue: t("backToQueue"),
    applicationDetail: t("applicationDetail"),
    applicationDetailHint: t("applicationDetailHint"),
    caseProgress: t("caseProgress"),
    recordDetails: t("recordDetails"),
    program: t("program"),
    degree: t("degree"),
    country: t("country"),
    updated: t("updated"),
    owner: t("owner"),
    manager: t("manager"),
    notAssigned: t("notAssigned"),
    openStudent360: t("openStudent360"),
    operationalStageNotice: t("operationalStageNotice"),
    operationalStageHint: t("operationalStageHint"),
    sourceBoundary: t("sourceBoundary"),
    localRecordHint: t("localRecordHint"),
  };
}

export type ApplicationQueuePresenterRow = Readonly<{
  id: string;
  studentCaseId: string;
  studentDisplayName: string;
  caseStage: Readonly<{ value: string; label: string }> | null;
  institutionName: string;
  programName: string | null;
  degree: string | null;
  country: string | null;
  status: string;
  statusLabel: string;
  deadline: string | null;
  documentCount: number;
  openDocumentCount: number;
  openTaskCount: number;
  pendingPaymentCount: number;
  needsAttention: boolean;
  readyForDecision: boolean;
  statusHiddenFields: readonly Readonly<{
    name: string;
    value: string;
  }>[];
}>;

export type ApplicationsQueuePresenterModel = Readonly<{
  testId?: string;
  copy: ApplicationsPresenterCopy;
  operationalNotice: PresenterBanner;
  resultBanner?: PresenterBanner;
  rows: readonly ApplicationQueuePresenterRow[];
  allRows: readonly ApplicationQueuePresenterRow[];
  selectedStatus?: string;
  statusOptions: readonly ApplicationStatusOption[];
  emptyText: string;
  filteredEmptyText: string;
  pageScopedMetricsLabel?: string;
  scopeStudentCaseId?: string;
  pagination?: Readonly<{
    resetHref: string | null;
    nextHref: string | null;
    resetLabel: string;
    nextLabel: string;
  }>;
  queueStatusAction?: ApplicationFormAction;
  create?: Readonly<{
    action: ApplicationFormAction;
    requestId: string;
    selectedStudentCaseId: string | undefined;
    caseSearchValue?: string;
    caseScopeStudentCaseId?: string;
    studentCases: readonly Readonly<{
      id: string;
      label: string;
    }>[];
    statusOptions: readonly ApplicationStatusOption[];
    catalogInstitutions?: readonly Readonly<{
      id: string;
      label: string;
    }>[];
    copy: Readonly<{
      summaryLabel: string;
      emptyTitle: string;
      emptyDescription: string;
      evidenceLabel: string;
      evidenceHint: string;
      submitLabel: string;
      catalogLabel?: string;
      catalogManualOption?: string;
      manualInstitutionLabel?: string;
      catalogHint?: string;
    }>;
  }>;
  catalog?: CatalogImportWorkspaceModel;
}>;

const selectCls =
  "h-10 rounded-nav border border-border-strong bg-surface px-2 text-[12px] text-fg focus-visible:border-accent";

function ResultBanner({ banner }: { banner?: PresenterBanner }) {
  return banner ? (
    <ContextBanner
      title={banner.title}
      description={banner.description}
      tone={banner.tone}
    />
  ) : null;
}

function QueueStatusForm({
  action,
  row,
  statusOptions,
  statusLabel,
  saveLabel,
}: {
  action: ApplicationFormAction;
  row: ApplicationQueuePresenterRow;
  statusOptions: readonly ApplicationStatusOption[];
  statusLabel: string;
  saveLabel: string;
}) {
  return (
    <form action={action} className="flex min-w-0 items-center gap-1.5">
      {row.statusHiddenFields.map((field) => (
        <input
          key={field.name}
          type="hidden"
          name={field.name}
          value={field.value}
        />
      ))}
      <label className="sr-only" htmlFor={`application-status-${row.id}`}>
        {statusLabel}
      </label>
      <select
        id={`application-status-${row.id}`}
        name="status"
        defaultValue={row.status}
        className={cn(selectCls, "min-w-0 flex-1")}
      >
        {statusOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="submit" className={btnGhostCls}>
        {saveLabel}
      </button>
    </form>
  );
}

function CreateApplicationPanel({
  model,
  copy,
}: {
  model: NonNullable<ApplicationsQueuePresenterModel["create"]>;
  copy: ApplicationsPresenterCopy;
}) {
  return (
    <details id="add" className="rounded-card border border-border bg-surface shadow-evo">
      <summary className="cursor-pointer px-5 py-4 text-[13px] font-bold text-fg">
        {model.copy.summaryLabel}
      </summary>
      <div className="border-t border-border p-5">
        <form action="/applications" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className={cn(labelCls, "min-w-0 flex-1")}>
            {copy.search} · {copy.client}
            <input
              name="case_q"
              defaultValue={model.caseSearchValue}
              className={`${inputCls} mt-1`}
            />
          </label>
          {model.caseScopeStudentCaseId ? (
            <input type="hidden" name="student_case_id" value={model.caseScopeStudentCaseId} />
          ) : null}
          <button type="submit" className={btnGhostCls}>{copy.search}</button>
        </form>
        {model.studentCases.length === 0 ? (
          <ContextBanner
            tone="warning"
            title={model.copy.emptyTitle}
            description={model.copy.emptyDescription}
          />
        ) : (
          <form action={model.action} className="grid gap-4 lg:grid-cols-2">
            <input type="hidden" name="request_id" value={model.requestId} />
            <label className={labelCls}>
              {copy.client}
              <select
                name="student_case_id"
                required
                defaultValue={model.selectedStudentCaseId}
                className={`${inputCls} mt-1`}
              >
                {model.studentCases.map((studentCase) => (
                  <option key={studentCase.id} value={studentCase.id}>
                    {studentCase.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              {copy.status}
              <select
                name="status"
                defaultValue="preparation"
                className={`${inputCls} mt-1`}
              >
                {model.statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <ApplicationInstitutionFields
              catalogInstitutions={model.catalogInstitutions ?? []}
              catalogLabel={model.copy.catalogLabel ?? copy.university}
              catalogManualOption={
                model.copy.catalogManualOption ?? "Manual entry"
              }
              manualInstitutionLabel={
                model.copy.manualInstitutionLabel ?? copy.university
              }
              catalogHint={model.copy.catalogHint}
            />
            <label className={labelCls}>
              {copy.program}
              <input
                name="program_name"
                required
                maxLength={300}
                className={`${inputCls} mt-1`}
              />
            </label>
            <label className={cn(labelCls, "lg:col-span-2")}>
              {model.copy.evidenceLabel}
              <input
                name="evidence_reference"
                maxLength={1000}
                placeholder="Ссылка или проверяемый идентификатор"
                className={`${inputCls} mt-1`}
              />
              <span className="mt-1 block text-[11px] font-normal text-fg-3">
                {model.copy.evidenceHint}
              </span>
            </label>
            <label className={cn(labelCls, "lg:col-span-2")}>
              {copy.notes}
              <textarea
                name="note"
                maxLength={1000}
                rows={3}
                className={`${inputCls} mt-1 h-auto py-3`}
              />
            </label>
            <div className="lg:col-span-2">
              <button type="submit" className={btnCls}>
                {model.copy.submitLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

export function ApplicationsQueuePresenter({
  model,
}: {
  model: ApplicationsQueuePresenterModel;
}) {
  const statusCount = (value: string) =>
    model.allRows.filter((row) => row.status === value).length;
  const attentionCount = model.allRows.filter(
    (row) => row.needsAttention,
  ).length;
  const readyForDecision = model.allRows.filter(
    (row) => row.readyForDecision,
  ).length;
  const openDocuments = model.allRows.reduce(
    (sum, row) => sum + row.openDocumentCount,
    0,
  );
  const pills = [
    {
      value: "",
      label: model.copy.all,
      count: model.allRows.length,
      active: !model.selectedStatus,
      href: applicationQueueHref(model.scopeStudentCaseId),
    },
    ...model.statusOptions.map((option) => ({
      value: option.value,
      label: option.label,
      count: statusCount(option.value),
      active: model.selectedStatus === option.value,
      href: applicationQueueHref(model.scopeStudentCaseId, option.value),
    })),
  ];

  return (
    <div className="space-y-5" data-testid={model.testId}>
      <ContextBanner
        title={model.operationalNotice.title}
        description={model.operationalNotice.description}
        tone={model.operationalNotice.tone}
      />
      <ResultBanner banner={model.resultBanner} />

      {model.pageScopedMetricsLabel ? (
        <p className="text-[12px] text-fg-3" data-testid="page-scoped-metrics-note">
          {model.pageScopedMetricsLabel}
        </p>
      ) : null}

      <QueueMetrics
        items={[
          {
            label: model.copy.activeApplications,
            value: model.allRows.length,
            tone: "accent",
          },
          {
            label: model.copy.attentionRequired,
            value: attentionCount,
            tone: attentionCount ? "danger" : "ok",
          },
          {
            label: model.copy.documentsInReview,
            value: openDocuments,
            tone: openDocuments ? "warn" : "ok",
          },
          {
            label: model.copy.readiness,
            value: readyForDecision,
            meta: model.copy.status,
            tone: "info",
          },
        ]}
      />

      <nav
        aria-label={model.copy.applicationStatuses}
        className="flex flex-wrap gap-2"
      >
        {pills.map((pill) => (
          <Link
            key={pill.value || "all"}
            href={pill.href}
            aria-current={pill.active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color]",
              pill.active
                ? "bg-accent text-on-accent"
                : "bg-surface-2 text-fg-2 hover:text-fg",
            )}
          >
            {pill.label}
            <span
              className={cn(
                "font-mono text-[11.5px]",
                pill.active ? "text-on-accent/80" : "text-fg-3",
              )}
            >
              {pill.count}
            </span>
          </Link>
        ))}
      </nav>

      {model.rows.length === 0 ? (
        <Card>
          <EmptyState
            text={
              model.selectedStatus
                ? model.filteredEmptyText
                : model.emptyText
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {model.rows.map((row) => (
              <article
                key={row.id}
                className="rounded-card border border-border bg-surface p-4 shadow-evo"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/applications/${row.id}`}
                      className="font-bold text-fg hover:text-accent"
                    >
                      {row.institutionName}
                    </Link>
                    <p className="mt-1 text-[12.5px] text-fg-3">
                      {[row.programName, row.degree, row.country]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <Badge value={row.status} label={row.statusLabel} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <span className="text-fg-3">{model.copy.client}</span>
                    <Link
                      href={`/clients/${row.studentCaseId}`}
                      className="mt-0.5 block font-semibold text-fg hover:text-accent"
                    >
                      {row.studentDisplayName}
                    </Link>
                  </div>
                  <div>
                    <span className="text-fg-3">{model.copy.deadline}</span>
                    <p
                      className={cn(
                        "mt-0.5 font-mono font-semibold",
                        row.needsAttention && row.deadline
                          ? "text-danger"
                          : "text-fg",
                      )}
                    >
                      {row.deadline ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-fg-3">{model.copy.documents}</span>
                    <p className="mt-0.5 font-semibold text-fg">
                      {row.documentCount - row.openDocumentCount}/
                      {row.documentCount}
                    </p>
                  </div>
                  <div>
                    <span className="text-fg-3">{model.copy.openTasks}</span>
                    <p className="mt-0.5 font-semibold text-fg">
                      {row.openTaskCount}
                    </p>
                  </div>
                </div>
                {model.queueStatusAction ? (
                  <div className="mt-4 border-t border-border pt-3">
                    <QueueStatusForm
                      action={model.queueStatusAction}
                      row={row}
                      statusOptions={model.statusOptions}
                      statusLabel={model.copy.status}
                      saveLabel={model.copy.save}
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <Card bodyClassName="px-0 py-0" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
                  <tr>
                    <th className="px-5 py-3 font-semibold">
                      {model.copy.client}
                    </th>
                    <th className="px-4 py-3 font-semibold">
                      {model.copy.university}
                    </th>
                    <th className="px-4 py-3 font-semibold">
                      {model.copy.readiness}
                    </th>
                    <th className="px-4 py-3 font-semibold">
                      {model.copy.deadline}
                    </th>
                    <th className="px-5 py-3 font-semibold">
                      {model.copy.status}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {model.rows.map((row) => (
                    <tr
                      key={row.id}
                      className="align-middle transition-[background-color] hover:bg-surface-2"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/clients/${row.studentCaseId}`}
                          className="font-semibold text-fg hover:text-accent"
                        >
                          {row.studentDisplayName}
                        </Link>
                        {row.caseStage ? (
                          <div className="mt-1">
                            <Badge
                              value={row.caseStage.value}
                              label={row.caseStage.label}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/applications/${row.id}`}
                          className="font-semibold text-fg hover:text-accent"
                        >
                          {row.institutionName}
                        </Link>
                        <div className="mt-0.5 text-[12px] text-fg-3">
                          {[row.programName, row.degree, row.country]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-[12px] text-fg">
                          {row.documentCount - row.openDocumentCount}/
                          {row.documentCount} {model.copy.documents}
                        </div>
                        <div className="mt-1 text-[11.5px] text-fg-3">
                          {row.openTaskCount} {model.copy.openTasks} ·{" "}
                          {row.pendingPaymentCount} {model.copy.payments}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 font-mono text-[12.5px]",
                          row.needsAttention && row.deadline
                            ? "font-bold text-danger"
                            : "text-fg-2",
                        )}
                      >
                        {row.deadline ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        {model.queueStatusAction ? (
                          <QueueStatusForm
                            action={model.queueStatusAction}
                            row={row}
                            statusOptions={model.statusOptions}
                            statusLabel={model.copy.status}
                            saveLabel={model.copy.save}
                          />
                        ) : (
                          <Badge value={row.status} label={row.statusLabel} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {model.pagination && (model.pagination.resetHref || model.pagination.nextHref) ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {model.pagination.resetHref ? (
            <Link href={model.pagination.resetHref} className={btnGhostCls}>
              ← {model.pagination.resetLabel}
            </Link>
          ) : <span />}
          {model.pagination.nextHref ? (
            <Link href={model.pagination.nextHref} className={btnGhostCls}>
              {model.pagination.nextLabel} →
            </Link>
          ) : null}
        </nav>
      ) : null}

      {model.create ? (
        <CreateApplicationPanel model={model.create} copy={model.copy} />
      ) : null}
      {model.catalog ? <CatalogImportWorkspace model={model.catalog} /> : null}
    </div>
  );
}

function applicationQueueHref(
  studentCaseId?: string,
  status?: string,
  beforeAt?: string,
  beforeId?: string,
): string {
  const params = new URLSearchParams();
  if (studentCaseId) params.set("student_case_id", studentCaseId);
  if (status) params.set("status", status);
  if (beforeAt && beforeId) {
    params.set("before_at", beforeAt);
    params.set("before_id", beforeId);
  }
  const serialized = params.toString();
  return serialized ? `/applications?${serialized}` : "/applications";
}

export type ApplicationDetailPresenterModel = Readonly<{
  testId?: string;
  copy: ApplicationsPresenterCopy;
  studentCaseId: string;
  institutionName: string;
  description: string;
  status: string;
  statusLabel: string;
  resultBanner?: PresenterBanner;
  attention: PresenterBanner &
    Readonly<{ actionHref: string; actionLabel: string }>;
  readinessPercent: number;
  documentCount: number;
  openDocumentCount: number;
  openTaskCount: number;
  pendingPaymentCount: number;
  workflow: readonly ApplicationStatusOption[];
  terminalDanger: boolean;
  recordItems: readonly Readonly<{ label: string; value: string | null }>[];
  ownerItems: readonly Readonly<{
    label: string;
    value: string | null;
    badge?: Readonly<{ value: string; label: string }>;
  }>[];
  sourceBoundary: PresenterBanner;
  statusForm: Readonly<{
    action: ApplicationFormAction;
    hiddenFields: readonly Readonly<{ name: string; value: string }>[];
    statusOptions: readonly ApplicationStatusOption[];
    evidence?: Readonly<{
      label: string;
      value: string;
      hint: string;
    }>;
    note?: Readonly<{ label: string }>;
    submitLabel: string;
  }>;
}>;

export function ApplicationDetailPresenter({
  model,
}: {
  model: ApplicationDetailPresenterModel;
}) {
  const readyDocuments = Math.max(
    0,
    model.documentCount - model.openDocumentCount,
  );

  return (
    <div className="space-y-5" data-testid={model.testId}>
      <DetailBackLink href="/applications" label={model.copy.backToQueue} />
      <ResultBanner banner={model.resultBanner} />

      <PageHeader
        eyebrow={model.copy.applicationDetail}
        title={model.institutionName}
        description={model.description || model.copy.applicationDetailHint}
        action={<Badge value={model.status} label={model.statusLabel} />}
      />

      <ContextBanner
        title={model.attention.title}
        description={model.attention.description}
        tone={model.attention.tone}
        action={
          <Link href={model.attention.actionHref} className={btnGhostCls}>
            {model.attention.actionLabel}
          </Link>
        }
      />

      <QueueMetrics
        items={[
          {
            label: model.copy.readiness,
            value: model.readinessPercent,
            meta: "%",
            tone: model.readinessPercent === 100 ? "ok" : "warn",
          },
          {
            label: model.copy.documents,
            value: `${readyDocuments}/${model.documentCount}`,
            tone: model.openDocumentCount ? "warn" : "ok",
          },
          {
            label: model.copy.openTasks,
            value: model.openTaskCount,
            tone: model.openTaskCount ? "danger" : "ok",
          },
          {
            label: model.copy.pendingPayments,
            value: model.pendingPaymentCount,
            tone: model.pendingPaymentCount ? "warn" : "ok",
          },
        ]}
      />

      <Card title={model.copy.caseProgress}>
        <WorkflowStepper
          label={model.copy.caseProgress}
          steps={[...model.workflow]}
          current={model.status}
          terminalDanger={model.terminalDanger}
        />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-5">
          <Card title={model.copy.recordDetails}>
            <KeyValueGrid items={[...model.recordItems]} />
          </Card>

          <div id="application-status">
            <Card title={model.copy.status}>
              <form
                action={model.statusForm.action}
                className={cn(
                  "grid gap-3",
                  !model.statusForm.evidence &&
                    "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end",
                )}
              >
                {model.statusForm.hiddenFields.map((field) => (
                  <input
                    key={field.name}
                    type="hidden"
                    name={field.name}
                    value={field.value}
                  />
                ))}
                <div>
                  <label
                    htmlFor="application-status-select"
                    className="mb-1 block text-[12px] font-medium text-fg-2"
                  >
                    {model.copy.status}
                  </label>
                  <select
                    id="application-status-select"
                    name="status"
                    defaultValue={model.status}
                    className={inputCls}
                  >
                    {model.statusForm.statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {model.statusForm.evidence ? (
                  <label className={labelCls}>
                    {model.statusForm.evidence.label}
                    <input
                      name="evidence_reference"
                      defaultValue={model.statusForm.evidence.value}
                      maxLength={1000}
                      placeholder="Ссылка или проверяемый идентификатор"
                      className={`${inputCls} mt-1`}
                    />
                    <span className="mt-1 block text-[11px] font-normal text-fg-3">
                      {model.statusForm.evidence.hint}
                    </span>
                  </label>
                ) : null}
                {model.statusForm.note ? (
                  <label className={labelCls}>
                    {model.statusForm.note.label}
                    <textarea
                      name="note"
                      maxLength={1000}
                      rows={4}
                      className={`${inputCls} mt-1 h-auto py-3`}
                    />
                  </label>
                ) : null}
                <button type="submit" className={btnCls}>
                  {model.statusForm.submitLabel}
                </button>
              </form>
            </Card>
          </div>
        </div>

        <aside className="space-y-5">
          <Card title={model.copy.owner}>
            <KeyValueGrid
              items={model.ownerItems.map((item) => ({
                label: item.label,
                value: item.badge ? (
                  <Badge value={item.badge.value} label={item.badge.label} />
                ) : (
                  item.value ?? model.copy.notAssigned
                ),
              }))}
            />
            <Link
              href={`/clients/${model.studentCaseId}`}
              className={`${btnCls} mt-4 w-full`}
            >
              {model.copy.openStudent360}
            </Link>
          </Card>

          <ContextBanner
            title={model.sourceBoundary.title}
            description={model.sourceBoundary.description}
            tone={model.sourceBoundary.tone}
          />
        </aside>
      </div>
    </div>
  );
}
