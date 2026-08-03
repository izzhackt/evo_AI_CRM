import Link from "next/link";

import {
  Badge,
  Card,
  EmptyState,
  btnCls,
  btnGhostCls,
  cn,
  inputCls,
  labelCls,
} from "@/components/ui";
import { ContextBanner } from "@/components/platform/operations/OperationsPrimitives";
import type {
  PlatformCatalogImportBatch,
  PlatformCatalogImportCandidate,
  PlatformCatalogInstitution,
  PlatformCatalogSource,
} from "@/lib/platform-catalog";

export type CatalogFormAction = (
  formData: FormData,
) => void | Promise<void>;

export type CatalogWorkspaceBanner = Readonly<{
  title: string;
  description: string;
  tone: "neutral" | "warning" | "danger" | "info";
}>;

export type CatalogImportWorkspaceCopy = Readonly<{
  title: string;
  description: string;
  approvedTitle: string;
  approvedEmptyTitle: string;
  approvedEmptyDescription: string;
  sourceBoundaryTitle: string;
  sourceBoundaryDescription: string;
  blockedTitle: string;
  blockedDescription: string;
  registerSource: string;
  sourceKind: string;
  sourceUrl: string;
  sourceRevision: string;
  reason: string;
  register: string;
  sources: string;
  review: string;
  reject: string;
  createBatch: string;
  institutionKind: string;
  university: string;
  college: string;
  create: string;
  batches: string;
  batchDetail: string;
  candidates: string;
  sourceRecordReference: string;
  sourceRecordHint: string;
  institutionName: string;
  countryCode: string;
  city: string;
  stageCandidate: string;
  validate: string;
  approve: string;
  validationErrors: string;
  noCandidates: string;
  noSources: string;
  noBatches: string;
  open: string;
  status: string;
  provenance: string;
}>;

export type CatalogImportWorkspaceModel = Readonly<{
  copy: CatalogImportWorkspaceCopy;
  resultBanner?: CatalogWorkspaceBanner;
  institutions: readonly PlatformCatalogInstitution[];
  admin?: Readonly<{
    sources: readonly Readonly<{
      source: PlatformCatalogSource;
      reviewRequestId: string;
    }>[];
    batches: readonly PlatformCatalogImportBatch[];
    selected?: Readonly<{
      batch: PlatformCatalogImportBatch;
      candidates: readonly PlatformCatalogImportCandidate[];
      stageRequestId: string;
      validateRequestId: string;
      approveRequestId: string;
      rejectRequestId: string;
    }>;
    requestIds: Readonly<{
      registerSource: string;
      createBatch: string;
    }>;
    actions: Readonly<{
      registerSource: CatalogFormAction;
      reviewSource: CatalogFormAction;
      createBatch: CatalogFormAction;
      stageCandidate: CatalogFormAction;
      validateBatch: CatalogFormAction;
      reviewBatch: CatalogFormAction;
    }>;
  }>;
}>;

const SOURCE_KIND_LABELS: Readonly<Record<string, string>> = {
  google_spreadsheet: "Google Sheet",
  google_drive_file: "Google Drive file",
  notion_database: "Notion database",
};

const VALIDATION_ERROR_LABELS: Readonly<Record<string, string>> = {
  institution_name_invalid: "institution name",
  country_code_invalid: "country code",
  duplicate_in_batch: "duplicate in batch",
  source_record_already_approved: "source record already approved",
  institution_already_approved: "institution already approved",
};

function ApprovedCatalog({
  model,
}: {
  model: CatalogImportWorkspaceModel;
}) {
  return (
    <Card data-testid="platform-approved-catalog">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-[13px] font-bold text-fg">
          {model.copy.approvedTitle}
        </h3>
      </div>
      {model.institutions.length === 0 ? (
        <div className="p-5">
          <div className="space-y-2">
            <h4 className="text-[13px] font-bold text-fg">
              {model.copy.approvedEmptyTitle}
            </h4>
            <EmptyState text={model.copy.approvedEmptyDescription} />
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[12px]">
            <thead className="bg-surface-2 text-fg-3">
              <tr>
                <th className="px-5 py-3 font-bold">{model.copy.institutionName}</th>
                <th className="px-4 py-3 font-bold">{model.copy.institutionKind}</th>
                <th className="px-4 py-3 font-bold">{model.copy.countryCode}</th>
                <th className="px-4 py-3 font-bold">{model.copy.provenance}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {model.institutions.map((institution) => (
                <tr
                  key={institution.catalogInstitutionId}
                  data-catalog-institution-id={institution.catalogInstitutionId}
                >
                  <td className="px-5 py-3 font-semibold text-fg">
                    {institution.institutionName}
                    {institution.city ? (
                      <span className="mt-0.5 block font-normal text-fg-3">
                        {institution.city}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      value={institution.institutionKind}
                      label={
                        institution.institutionKind === "university"
                          ? model.copy.university
                          : model.copy.college
                      }
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-fg-2">
                    {institution.countryCode}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-fg-3">
                    {institution.sourceRevision}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SourceRegistry({
  model,
  admin,
}: {
  model: CatalogImportWorkspaceModel;
  admin: NonNullable<CatalogImportWorkspaceModel["admin"]>;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <details className="rounded-card border border-border bg-surface shadow-evo">
        <summary className="cursor-pointer px-5 py-4 text-[13px] font-bold text-fg">
          {model.copy.registerSource}
        </summary>
        <form
          action={admin.actions.registerSource}
          data-testid="platform-catalog-register-source-form"
          className="grid gap-4 border-t border-border p-5"
        >
          <input
            type="hidden"
            name="request_id"
            value={admin.requestIds.registerSource}
          />
          <label className={labelCls}>
            {model.copy.sourceKind}
            <select name="source_kind" className={`${inputCls} mt-1`}>
              {Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            {model.copy.sourceUrl}
            <input
              name="source_url"
              type="url"
              required
              maxLength={512}
              placeholder="https://..."
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className={labelCls}>
            {model.copy.sourceRevision}
            <input
              name="source_revision"
              required
              minLength={7}
              maxLength={128}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className={labelCls}>
            {model.copy.reason}
            <input
              name="reason"
              required
              minLength={3}
              maxLength={500}
              className={`${inputCls} mt-1`}
            />
          </label>
          <button type="submit" className={btnCls}>
            {model.copy.register}
          </button>
        </form>
      </details>

      <Card>
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-[13px] font-bold text-fg">{model.copy.sources}</h3>
        </div>
        {admin.sources.length === 0 ? (
          <div className="p-5 text-[12px] text-fg-3">{model.copy.noSources}</div>
        ) : (
          <div className="divide-y divide-border">
            {admin.sources.map(({ source, reviewRequestId }) => (
              <div key={source.sourceRegistryId} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-fg">
                      {SOURCE_KIND_LABELS[source.sourceKind]}
                    </div>
                    <div className="truncate font-mono text-[10.5px] text-fg-3">
                      {source.sourceUrl}
                    </div>
                    <div className="font-mono text-[10.5px] text-fg-3">
                      {source.sourceRevision ?? "revision required"}
                    </div>
                  </div>
                  <Badge value={source.reviewStatus} label={source.reviewStatus} />
                </div>
                {source.reviewStatus === "pending" ? (
                  <form
                    action={admin.actions.reviewSource}
                    data-testid="platform-catalog-source-review-form"
                    data-source-registry-id={source.sourceRegistryId}
                    className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
                  >
                    <input type="hidden" name="request_id" value={reviewRequestId} />
                    <input
                      type="hidden"
                      name="source_registry_id"
                      value={source.sourceRegistryId}
                    />
                    <label className="sr-only" htmlFor={`source-review-reason-${source.sourceRegistryId}`}>
                      {model.copy.reason}
                    </label>
                    <input
                      id={`source-review-reason-${source.sourceRegistryId}`}
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      placeholder={model.copy.reason}
                      className={inputCls}
                    />
                    <button
                      type="submit"
                      name="decision"
                      value="reviewed"
                      className={btnCls}
                    >
                      {model.copy.review}
                    </button>
                    <button
                      type="submit"
                      name="decision"
                      value="rejected"
                      className={btnGhostCls}
                    >
                      {model.copy.reject}
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function BatchList({
  model,
  admin,
}: {
  model: CatalogImportWorkspaceModel;
  admin: NonNullable<CatalogImportWorkspaceModel["admin"]>;
}) {
  const reviewedSources = admin.sources.filter(
    ({ source }) =>
      source.reviewStatus === "reviewed" && source.sourceRevision !== null,
  );
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Card>
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-[13px] font-bold text-fg">{model.copy.createBatch}</h3>
        </div>
        {reviewedSources.length === 0 ? (
          <div className="p-5">
            <ContextBanner
              tone="warning"
              title={model.copy.blockedTitle}
              description={model.copy.blockedDescription}
            />
          </div>
        ) : (
          <form
            action={admin.actions.createBatch}
            data-testid="platform-catalog-create-batch-form"
            className="grid gap-4 p-5"
          >
            <input
              type="hidden"
              name="request_id"
              value={admin.requestIds.createBatch}
            />
            <label className={labelCls}>
              {model.copy.sources}
              <select name="source_registry_id" className={`${inputCls} mt-1`}>
                {reviewedSources.map(({ source }) => (
                  <option key={source.sourceRegistryId} value={source.sourceRegistryId}>
                    {SOURCE_KIND_LABELS[source.sourceKind]} · {source.sourceRevision}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              {model.copy.institutionKind}
              <select name="institution_kind" className={`${inputCls} mt-1`}>
                <option value="university">{model.copy.university}</option>
                <option value="college">{model.copy.college}</option>
              </select>
            </label>
            <label className={labelCls}>
              {model.copy.reason}
              <input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                className={`${inputCls} mt-1`}
              />
            </label>
            <button type="submit" className={btnCls}>
              {model.copy.create}
            </button>
          </form>
        )}
      </Card>
      <Card>
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-[13px] font-bold text-fg">{model.copy.batches}</h3>
        </div>
        {admin.batches.length === 0 ? (
          <div className="p-5 text-[12px] text-fg-3">{model.copy.noBatches}</div>
        ) : (
          <div className="divide-y divide-border">
            {admin.batches.map((batch) => (
              <div
                key={batch.catalogImportBatchId}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Badge value={batch.status} label={batch.status} />
                    <span className="text-[12px] font-semibold text-fg">
                      {batch.institutionKind === "university"
                        ? model.copy.university
                        : model.copy.college}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-fg-3">
                    {batch.sourceRevision} · {batch.candidateCount} {model.copy.candidates}
                  </div>
                </div>
                <Link
                  href={`/applications?catalog_batch_id=${batch.catalogImportBatchId}#catalog-import`}
                  className={btnGhostCls}
                >
                  {model.copy.open}
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SelectedBatch({
  model,
  admin,
}: {
  model: CatalogImportWorkspaceModel;
  admin: NonNullable<CatalogImportWorkspaceModel["admin"]>;
}) {
  if (!admin.selected) return null;
  const { batch, candidates } = admin.selected;
  const canApprove =
    batch.status === "validated" &&
    batch.candidateCount > 0 &&
    batch.invalidCandidateCount === 0 &&
    batch.validCandidateCount === batch.candidateCount;
  return (
    <Card data-testid="platform-catalog-batch-detail">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="text-[13px] font-bold text-fg">{model.copy.batchDetail}</h3>
          <div className="mt-1 font-mono text-[10.5px] text-fg-3">
            {batch.catalogImportBatchId} · {batch.sourceRevision}
          </div>
        </div>
        <Badge value={batch.status} label={batch.status} />
      </div>

      {batch.status === "staging" ? (
        <form
          action={admin.actions.stageCandidate}
          data-testid="platform-catalog-stage-candidate-form"
          className="grid gap-4 border-b border-border p-5 lg:grid-cols-2"
        >
          <input
            type="hidden"
            name="catalog_import_batch_id"
            value={batch.catalogImportBatchId}
          />
          <input
            type="hidden"
            name="request_id"
            value={admin.selected.stageRequestId}
          />
          <label className={labelCls}>
            {model.copy.sourceRecordReference}
            <input
              name="source_record_reference"
              required
              maxLength={500}
              className={`${inputCls} mt-1`}
            />
            <span className="mt-1 block text-[10.5px] font-normal text-fg-3">
              {model.copy.sourceRecordHint}
            </span>
          </label>
          <label className={labelCls}>
            {model.copy.institutionName}
            <input name="institution_name" maxLength={300} className={`${inputCls} mt-1`} />
          </label>
          <label className={labelCls}>
            {model.copy.countryCode}
            <input name="country_code" maxLength={8} className={`${inputCls} mt-1`} />
          </label>
          <label className={labelCls}>
            {model.copy.city}
            <input name="city" maxLength={200} className={`${inputCls} mt-1`} />
          </label>
          <label className={cn(labelCls, "lg:col-span-2")}>
            {model.copy.reason}
            <input
              name="reason"
              required
              minLength={3}
              maxLength={500}
              className={`${inputCls} mt-1`}
            />
          </label>
          <button type="submit" className={cn(btnCls, "lg:col-span-2")}>
            {model.copy.stageCandidate}
          </button>
        </form>
      ) : null}

      <div className="divide-y divide-border">
        {candidates.length === 0 ? (
          <div className="p-5 text-[12px] text-fg-3">{model.copy.noCandidates}</div>
        ) : (
          candidates.map((candidate) => (
            <div
              key={candidate.catalogImportCandidateId}
              className="grid gap-2 p-4 md:grid-cols-[1fr_auto]"
            >
              <div>
                <div className="text-[12px] font-semibold text-fg">
                  {candidate.institutionName || "—"}
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-fg-3">
                  {candidate.countryCode || "—"}
                  {candidate.city ? ` · ${candidate.city}` : ""} · {candidate.sourceRecordKey}
                </div>
                {candidate.validationErrors.length > 0 ? (
                  <div className="mt-2 text-[11px] text-danger">
                    {model.copy.validationErrors}: {candidate.validationErrors
                      .map((error) => VALIDATION_ERROR_LABELS[error] ?? error)
                      .join(", ")}
                  </div>
                ) : null}
              </div>
              <Badge
                value={candidate.validationStatus}
                label={candidate.validationStatus}
              />
            </div>
          ))
        )}
      </div>

      {batch.status === "staging" && candidates.length > 0 ? (
        <form
          action={admin.actions.validateBatch}
          data-testid="platform-catalog-validate-batch-form"
          className="flex flex-wrap items-end gap-3 border-t border-border p-5"
        >
          <input
            type="hidden"
            name="catalog_import_batch_id"
            value={batch.catalogImportBatchId}
          />
          <input
            type="hidden"
            name="request_id"
            value={admin.selected.validateRequestId}
          />
          <label className={cn(labelCls, "min-w-[240px] flex-1")}>
            {model.copy.reason}
            <input
              name="reason"
              required
              minLength={3}
              maxLength={500}
              className={`${inputCls} mt-1`}
            />
          </label>
          <button type="submit" className={btnCls}>
            {model.copy.validate}
          </button>
        </form>
      ) : null}

      {batch.status === "staging" || batch.status === "validated" ? (
        <div className="grid gap-3 border-t border-border p-5 md:grid-cols-2">
          {canApprove ? (
            <form
              action={admin.actions.reviewBatch}
              data-testid="platform-catalog-approve-batch-form"
              className="grid gap-2"
            >
              <input type="hidden" name="catalog_import_batch_id" value={batch.catalogImportBatchId} />
              <input type="hidden" name="request_id" value={admin.selected.approveRequestId} />
              <input type="hidden" name="decision" value="approve" />
              <label className="sr-only" htmlFor={`catalog-approve-reason-${batch.catalogImportBatchId}`}>
                {model.copy.reason}
              </label>
              <input
                id={`catalog-approve-reason-${batch.catalogImportBatchId}`}
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder={model.copy.reason}
                className={inputCls}
              />
              <button type="submit" className={btnCls}>{model.copy.approve}</button>
            </form>
          ) : (
            <ContextBanner
              tone="warning"
              title={model.copy.validate}
              description={model.copy.blockedDescription}
            />
          )}
          <form
            action={admin.actions.reviewBatch}
            data-testid="platform-catalog-reject-batch-form"
            className="grid gap-2"
          >
            <input type="hidden" name="catalog_import_batch_id" value={batch.catalogImportBatchId} />
            <input type="hidden" name="request_id" value={admin.selected.rejectRequestId} />
            <input type="hidden" name="decision" value="reject" />
            <label className="sr-only" htmlFor={`catalog-reject-reason-${batch.catalogImportBatchId}`}>
              {model.copy.reason}
            </label>
            <input
              id={`catalog-reject-reason-${batch.catalogImportBatchId}`}
              name="reason"
              required
              minLength={3}
              maxLength={500}
              placeholder={model.copy.reason}
              className={inputCls}
            />
            <button type="submit" className={btnGhostCls}>{model.copy.reject}</button>
          </form>
        </div>
      ) : null}
    </Card>
  );
}

export function CatalogImportWorkspace({
  model,
}: {
  model: CatalogImportWorkspaceModel;
}) {
  return (
    <section
      id="catalog-import"
      data-testid="platform-catalog-import-workspace"
      className="space-y-4"
    >
      <div>
        <h2 className="text-[17px] font-black tracking-[-0.02em] text-fg">
          {model.copy.title}
        </h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-fg-3">
          {model.copy.description}
        </p>
      </div>
      {model.resultBanner ? (
        <ContextBanner
          tone={model.resultBanner.tone}
          title={model.resultBanner.title}
          description={model.resultBanner.description}
        />
      ) : null}
      <ContextBanner
        tone="info"
        title={model.copy.sourceBoundaryTitle}
        description={model.copy.sourceBoundaryDescription}
      />
      <ApprovedCatalog model={model} />
      {model.admin ? (
        <>
          <SourceRegistry model={model} admin={model.admin} />
          <BatchList model={model} admin={model.admin} />
          <SelectedBatch model={model} admin={model.admin} />
        </>
      ) : null}
    </section>
  );
}
