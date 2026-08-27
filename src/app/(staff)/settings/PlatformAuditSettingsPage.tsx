import { randomUUID } from "node:crypto";
import Link from "next/link";

import { ContextBanner } from "@/components/platform/operations/OperationsPrimitives";
import {
  EmptyState,
  PageHeader,
  btnCls,
  btnGhostCls,
  cn,
  filterBarCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { getT, type Locale } from "@/lib/i18n";
import {
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_RESOURCE_TYPES,
  type PlatformAuditSearchResult,
} from "@/lib/platform-audit";
import {
  PlatformAuditActionError,
  searchPlatformAudit,
} from "@/lib/platform-audit-actions";
import { requirePlatformAuditAdminActor } from "@/lib/platform-guards";

type SettingsSearchParams = Record<string, string | string[] | undefined>;

function singleValue(
  params: SettingsSearchParams,
  key: string,
): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function localeTag(locale: Locale): string {
  if (locale === "ky") return "ky-KG";
  if (locale === "en") return "en-GB";
  return "ru-RU";
}

function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function appendFilters(
  target: URLSearchParams,
  result: PlatformAuditSearchResult,
  pageSize: string,
) {
  if (result.filters.startAt) target.set("start_at", result.filters.startAt);
  if (result.filters.endAt) target.set("end_at", result.filters.endAt);
  if (result.filters.actions) target.set("actions", result.filters.actions.join(","));
  if (result.filters.resourceTypes) {
    target.set("resource_types", result.filters.resourceTypes.join(","));
  }
  if (result.filters.resourceId) target.set("resource_id", result.filters.resourceId);
  if (pageSize) target.set("page_size", pageSize);
}

function nextPageHref(
  result: PlatformAuditSearchResult,
  pageSize: string,
): string | null {
  if (
    !result.hasMore ||
    !result.snapshotCreatedAt ||
    !result.snapshotId ||
    !result.nextCursorCreatedAt ||
    !result.nextCursorId
  ) {
    return null;
  }
  const query = new URLSearchParams({ tab: "audit" });
  appendFilters(query, result, pageSize);
  query.set("snapshot_created_at", result.snapshotCreatedAt);
  query.set("snapshot_id", result.snapshotId);
  query.set("cursor_created_at", result.nextCursorCreatedAt);
  query.set("cursor_id", result.nextCursorId);
  return `/settings?${query.toString()}`;
}

function errorCopy(
  error: unknown,
  t: (key: string) => string,
): { title: string; body: string } {
  if (error instanceof PlatformAuditActionError && error.kind === "invalid") {
    return { title: t("platformAuditInvalidTitle"), body: t("platformAuditInvalidHint") };
  }
  if (error instanceof PlatformAuditActionError && error.kind === "too_large") {
    return { title: t("platformAuditTooLargeTitle"), body: t("platformAuditTooLargeHint") };
  }
  return { title: t("platformAuditUnavailableTitle"), body: t("platformAuditUnavailableHint") };
}

export default async function PlatformAuditSettingsPage({
  searchParams,
}: {
  searchParams: SettingsSearchParams;
}) {
  await requirePlatformAuditAdminActor();
  const { t, locale } = await getT();
  let result: PlatformAuditSearchResult | null = null;
  let loadError: unknown = null;
  try {
    result = await searchPlatformAudit(
      Object.fromEntries(
        Object.entries(searchParams).filter(([key]) => key !== "tab"),
      ),
    );
  } catch (error) {
    loadError = error;
  }

  const startAt = singleValue(searchParams, "start_at");
  const endAt = singleValue(searchParams, "end_at");
  const actions = singleValue(searchParams, "actions");
  const resourceTypes = singleValue(searchParams, "resource_types");
  const resourceId = singleValue(searchParams, "resource_id");
  const pageSize = singleValue(searchParams, "page_size") || "50";
  const nextHref = result ? nextPageHref(result, pageSize) : null;
  const exportRequestId = randomUUID();
  const error = loadError ? errorCopy(loadError, t) : null;
  const exportData =
    result?.filters.startAt && result.filters.endAt
      ? {
          result,
          startAt: result.filters.startAt,
          endAt: result.filters.endAt,
        }
      : null;

  return (
    <div
      className="mx-auto max-w-[1280px] space-y-5"
      data-testid="platform-audit-settings"
    >
      <PageHeader
        eyebrow={t("platformAuditEyebrow")}
        title={t("platformAuditTitle")}
        description={t("platformAuditDescription")}
      />
      <nav aria-label="Разделы настроек" className="flex flex-wrap gap-2">
        <Link className={btnGhostCls} href="/settings?tab=staff">
          Доступ сотрудников
        </Link>
        <span aria-current="page" className={btnCls}>Журнал аудита</span>
        <Link className={btnGhostCls} href="/settings?tab=operations">
          Операции
        </Link>
      </nav>

      <ContextBanner
        title={t("platformAuditSafeProjectionTitle")}
        description={t("platformAuditSafeProjectionHint")}
        tone="info"
      />

      <form
        action="/settings"
        method="get"
        className={cn(filterBarCls, "lg:grid-cols-4")}
        aria-label={t("platformAuditSearchLabel")}
      >
        <input type="hidden" name="tab" value="audit" />
        <label className={labelCls}>
          {t("platformAuditStartAt")}
          <input
            name="start_at"
            defaultValue={startAt}
            placeholder="2026-08-01T00:00:00Z"
            className={cn(inputCls, "mt-1 font-mono")}
            autoComplete="off"
          />
        </label>
        <label className={labelCls}>
          {t("platformAuditEndAt")}
          <input
            name="end_at"
            defaultValue={endAt}
            placeholder="2026-08-14T00:00:00Z"
            className={cn(inputCls, "mt-1 font-mono")}
            autoComplete="off"
          />
        </label>
        <label className={labelCls}>
          {t("platformAuditAction")}
          <select name="actions" defaultValue={actions} className={cn(inputCls, "mt-1")}>
            <option value="">{t("platformAuditAnyAction")}</option>
            {PLATFORM_AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          {t("platformAuditResourceType")}
          <select
            name="resource_types"
            defaultValue={resourceTypes}
            className={cn(inputCls, "mt-1")}
          >
            <option value="">{t("platformAuditAnyResource")}</option>
            {PLATFORM_AUDIT_RESOURCE_TYPES.map((resourceType) => (
              <option key={resourceType} value={resourceType}>{resourceType}</option>
            ))}
          </select>
        </label>
        <label className={cn(labelCls, "lg:col-span-2")}>
          {t("platformAuditResourceId")}
          <input
            name="resource_id"
            defaultValue={resourceId}
            placeholder="11111111-1111-4111-8111-111111111111"
            className={cn(inputCls, "mt-1 font-mono")}
            autoComplete="off"
          />
        </label>
        <label className={labelCls}>
          {t("platformAuditPageSize")}
          <input
            name="page_size"
            type="number"
            min="1"
            max="100"
            step="1"
            defaultValue={pageSize}
            className={cn(inputCls, "mt-1")}
          />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnCls}>{t("platformAuditSearch")}</button>
          <Link href="/settings?tab=audit" className={btnGhostCls}>
            {t("platformAuditClear")}
          </Link>
        </div>
      </form>

      {error ? (
        <ContextBanner title={error.title} description={error.body} tone="warning" />
      ) : null}

      <section
        className="overflow-hidden rounded-card border border-border bg-surface shadow-evo"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[14px] font-bold text-fg">{t("platformAuditResults")}</h2>
            <p className="mt-1 text-[12px] text-fg-3">
              {result
                ? t("platformAuditRowsOnPage").replace("{count}", String(result.rows.length))
                : t("platformAuditNoResult")}
            </p>
          </div>
          {exportData ? (
            <form
              action="/api/platform-audit/export"
              method="post"
              encType="application/x-www-form-urlencoded"
              className="flex flex-wrap items-end gap-2"
              aria-label={t("platformAuditExportLabel")}
            >
              <input type="hidden" name="request_id" value={exportRequestId} />
              <input type="hidden" name="start_at" value={exportData.startAt} />
              <input type="hidden" name="end_at" value={exportData.endAt} />
              {exportData.result.filters.actions ? (
                <input
                  type="hidden"
                  name="actions"
                  value={exportData.result.filters.actions.join(",")}
                />
              ) : null}
              {exportData.result.filters.resourceTypes ? (
                <input
                  type="hidden"
                  name="resource_types"
                  value={exportData.result.filters.resourceTypes.join(",")}
                />
              ) : null}
              {exportData.result.filters.resourceId ? (
                <input
                  type="hidden"
                  name="resource_id"
                  value={exportData.result.filters.resourceId}
                />
              ) : null}
              {exportData.result.snapshotCreatedAt ? (
                <input
                  type="hidden"
                  name="snapshot_created_at"
                  value={exportData.result.snapshotCreatedAt}
                />
              ) : null}
              {exportData.result.snapshotId ? (
                <input
                  type="hidden"
                  name="snapshot_id"
                  value={exportData.result.snapshotId}
                />
              ) : null}
              <button type="submit" className={btnGhostCls}>
                {t("platformAuditExportCsv")}
              </button>
            </form>
          ) : (
            <p className="max-w-sm text-[12px] text-fg-3">
              {t("platformAuditExportWindowRequired")}
            </p>
          )}
        </div>

        {result && result.rows.length > 0 ? (
          <div
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            tabIndex={0}
          >
            <table className="min-w-[1400px] w-full border-collapse text-left text-[12px]">
              <caption className="sr-only">{t("platformAuditTableCaption")}</caption>
              <thead className="bg-surface-2 text-fg-2">
                <tr>
                  {[
                    t("platformAuditOccurredAt"),
                    t("platformAuditAction"),
                    t("platformAuditResource"),
                    t("platformAuditActor"),
                    t("platformAuditReasonCode"),
                    t("platformAuditChangedFields"),
                    t("platformAuditEventId"),
                    t("platformAuditRequestId"),
                  ].map((label) => (
                    <th key={label} scope="col" className="px-3 py-2.5 font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.rows.map((row) => (
                  <tr key={row.auditEventId}>
                    <td className="whitespace-nowrap px-3 py-3 text-fg-2">
                      <time dateTime={row.createdAt}>{formatDate(row.createdAt, locale)}</time>
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-fg">{row.action}</td>
                    <td className="px-3 py-3">
                      <span className="block text-fg">{row.resourceType}</span>
                      <code className="font-mono text-[10px] text-fg-3">{row.resourceId}</code>
                    </td>
                    <td className="px-3 py-3">
                      <span className="block text-fg">{row.actorDisplayLabel}</span>
                      <span className="text-fg-3">{row.actorKind}</span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-fg-2">{row.reasonCode}</td>
                    <td className="px-3 py-3 font-mono text-[11px] text-fg-2">
                      {row.changedFieldCodes.join(", ") || "—"}
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] text-fg-3">{row.auditEventId}</td>
                    <td className="px-3 py-3 font-mono text-[10px] text-fg-3">{row.requestId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text={t("platformAuditEmpty")} />
        )}
      </section>

      {nextHref ? (
        <div className="flex justify-end">
          <Link href={nextHref} className={btnGhostCls}>
            {t("platformAuditNextPage")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
