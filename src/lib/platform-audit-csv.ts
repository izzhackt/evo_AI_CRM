export const PLATFORM_AUDIT_CSV_COLUMNS = [
  "audit_event_id",
  "created_at",
  "action",
  "resource_type",
  "resource_id",
  "actor_kind",
  "actor_display_label",
  "request_id",
  "reason_code",
  "changed_field_codes",
] as const;

export type PlatformAuditCsvRow = Readonly<{
  auditEventId: string;
  createdAt: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorKind: string;
  actorDisplayLabel: string;
  requestId: string;
  reasonCode: string;
  changedFieldCodes: readonly string[];
}>;

function safeSpreadsheetCell(value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, " ");
  return /^\s*[=+\-@]/u.test(singleLine) ? `'${singleLine}` : singleLine;
}

function csvCell(value: string): string {
  return `"${safeSpreadsheetCell(value).replaceAll('"', '""')}"`;
}

function rowCells(row: PlatformAuditCsvRow): readonly string[] {
  return [
    row.auditEventId,
    row.createdAt,
    row.action,
    row.resourceType,
    row.resourceId ?? "",
    row.actorKind,
    row.actorDisplayLabel,
    row.requestId,
    row.reasonCode,
    row.changedFieldCodes.join("|"),
  ];
}

/**
 * Produces deterministic RFC-style CSV text. Every value is quoted, embedded
 * line breaks are flattened, and spreadsheet formula prefixes are neutralized
 * even when an unsafe prefix follows leading whitespace.
 */
export function serializePlatformAuditCsv(
  rows: readonly PlatformAuditCsvRow[],
): string {
  const lines = [
    PLATFORM_AUDIT_CSV_COLUMNS.map(csvCell).join(","),
    ...rows.map((row) => rowCells(row).map(csvCell).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
