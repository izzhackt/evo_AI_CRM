import {
  ADMISSIONS_STEPS,
  isPreDeliveryStage,
  resolveAdmissionsStep,
  type AdmissionsCaseInput,
} from "./platform-admissions-overview.ts";

/**
 * Date and owner filters over the admissions funnel, plus the CSV the owner
 * asked to be able to take out of the screen.
 *
 * Both are pure. The screen and the export route parse the same query string
 * through the same function, so what is exported is exactly what was on
 * screen — an export that quietly differs from the view is worse than none.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_CURATOR_LENGTH = 200;

export const ADMISSIONS_FILTER_FIELDS = ["from", "to", "curator"] as const;

export type AdmissionsFilter = Readonly<{
  from: string | null;
  to: string | null;
  curator: string | null;
}>;

export const EMPTY_ADMISSIONS_FILTER: AdmissionsFilter = {
  from: null,
  to: null,
  curator: null,
};

/**
 * The owner filter matches on display name because that is what the queue
 * exposes; a case with no curator is addressed by this sentinel rather than by
 * an empty string, which would be indistinguishable from "no filter".
 */
export const ADMISSIONS_NO_CURATOR = "__none__";

function date(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!DATE_PATTERN.test(candidate)) return null;
  const parsed = Date.parse(`${candidate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  // Rejects a well-formed but non-existent date such as 2026-02-31, which
  // Date.parse would silently roll forward into March.
  return new Date(parsed).toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}

function curatorName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    candidate.length < 1
    || candidate.length > MAX_CURATOR_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function parseAdmissionsFilter(
  params: Readonly<Record<string, string | string[] | undefined>>,
): AdmissionsFilter {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  const from = date(single("from"));
  const to = date(single("to"));
  // An inverted range would silently return nothing. Dropping it keeps the
  // screen honest about showing everything rather than showing an empty funnel.
  if (from && to && from > to) {
    return { from: null, to: null, curator: curatorName(single("curator")) };
  }
  return { from, to, curator: curatorName(single("curator")) };
}

export function isEmptyAdmissionsFilter(filter: AdmissionsFilter): boolean {
  return filter.from === null && filter.to === null && filter.curator === null;
}

export function admissionsFilterQuery(filter: AdmissionsFilter): string {
  const params = new URLSearchParams();
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.curator) params.set("curator", filter.curator);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function matchesCurator(
  row: AdmissionsCaseInput,
  curator: string,
): boolean {
  if (curator === ADMISSIONS_NO_CURATOR) {
    return row.currentCuratorDisplayName === null;
  }
  return row.currentCuratorDisplayName === curator;
}

export function filterAdmissionsCases(
  rows: readonly AdmissionsCaseInput[],
  filter: AdmissionsFilter,
): readonly AdmissionsCaseInput[] {
  if (isEmptyAdmissionsFilter(filter)) return rows;
  return rows.filter((row) => {
    if (filter.curator && !matchesCurator(row, filter.curator)) return false;
    if (filter.from || filter.to) {
      // A row without a creation date cannot satisfy a date range. Keeping it
      // would make the filter look applied while it was not.
      if (row.createdAt === null) return false;
      const day = row.createdAt.slice(0, 10);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
    }
    return true;
  });
}

export function admissionsCuratorOptions(
  rows: readonly AdmissionsCaseInput[],
): readonly string[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (row.currentCuratorDisplayName !== null) {
      names.add(row.currentCuratorDisplayName);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right, "ru"));
}

export const ADMISSIONS_CSV_COLUMNS = [
  "student_case_id",
  "student",
  "country",
  "step",
  "stage",
  "state",
  "curator",
  "intake",
  "created_at",
  "overdue_tasks",
  "overdue_obligations",
  "rejected_documents",
] as const;

function safeSpreadsheetCell(value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, " ");
  return /^\s*[=+\-@]/u.test(singleLine) ? `'${singleLine}` : singleLine;
}

function csvCell(value: string): string {
  return `"${safeSpreadsheetCell(value).replaceAll('"', '""')}"`;
}

/**
 * `step` reports the funnel position the screen shows, including the two
 * out-of-funnel answers, so a reader of the file cannot mistake a case that
 * has not started for one sitting in document collection.
 */
function stepCell(row: AdmissionsCaseInput): string {
  if (row.state === "closed") return "closed";
  const step = resolveAdmissionsStep(row.operationalStage);
  if (step) return step;
  return isPreDeliveryStage(row.operationalStage)
    ? "before_delivery"
    : "unknown";
}

export function serializeAdmissionsCsv(
  rows: readonly AdmissionsCaseInput[],
): string {
  const lines = [
    ADMISSIONS_CSV_COLUMNS.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.studentCaseId,
        row.studentDisplayName,
        row.targetCountry,
        stepCell(row),
        row.operationalStage,
        row.state,
        row.currentCuratorDisplayName ?? "",
        row.intake ?? "",
        row.createdAt ?? "",
        String(row.overdueTaskCount),
        String(row.overdueObligationCount),
        String(row.rejectedDocumentCount),
      ].map(csvCell).join(",")
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function admissionsCsvOrder(
  rows: readonly AdmissionsCaseInput[],
): readonly AdmissionsCaseInput[] {
  const stepRank = new Map<string, number>(
    ADMISSIONS_STEPS.map((step, index) => [step, index]),
  );
  return rows.slice().sort((left, right) => {
    const byCountry = left.targetCountry.localeCompare(right.targetCountry, "ru");
    if (byCountry !== 0) return byCountry;
    const leftRank = stepRank.get(stepCell(left)) ?? ADMISSIONS_STEPS.length;
    const rightRank = stepRank.get(stepCell(right)) ?? ADMISSIONS_STEPS.length;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.studentDisplayName.localeCompare(right.studentDisplayName, "ru");
  });
}
