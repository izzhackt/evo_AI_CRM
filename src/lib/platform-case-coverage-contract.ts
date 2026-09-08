/** Narrow, fail-closed Admin coverage projection; never a permission source. */
export type CoverageDeadline = Readonly<{ due_on: string | null; due_at: string | null }>;
export type CoverageCurator = Readonly<{
  id: string; name: string; active: boolean; active_case_count: number;
  open_task_count: number; nearest_due: CoverageDeadline | null;
}>;
export type CoverageTask = CoverageDeadline & Readonly<{
  id: string; version: string; title: string; status: "open" | "in_progress" | "blocked";
  assignee_id: string; assignee_name: string; tracked: boolean; required: boolean;
  can_transfer: boolean; return_assignee_id: string | null; return_assignee_name: string | null;
  conflict: "task_reassigned" | "original_assignee_unavailable" | "unrelated_assignee" | null;
}>;
export type CoveragePreview = Readonly<{
  id: string; name: string; owner_id: string; scope_version: string;
  tasks: readonly CoverageTask[];
  conflicts: readonly ("assignment_changed" | "original_curator_unavailable")[];
  coverage: Readonly<{
    id: string; version: string; original_curator_id: string; substitute_curator_id: string;
    planned_end_on: string;
  }> | null;
}>;
export type CoverageWorkspace = Readonly<{
  organization_id: string; curators: readonly CoverageCurator[];
  cases: readonly Readonly<{ id: string; name: string }>[];
  next_case_id: string | null; preview: CoveragePreview | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_VERSION = BigInt("9223372036854775807");

export function parseCoverageUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) && value !== "00000000-0000-0000-0000-000000000000"
    ? value.toLowerCase() : null;
}
export function parseCoverageVersion(value: unknown): string | null {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_VERSION
    ? value : null;
}
export function parseCoverageDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function invalid(): never { throw new Error("Curator coverage is unavailable."); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return invalid();
  return row;
}
function id(value: unknown): string { return parseCoverageUuid(value) ?? invalid(); }
function version(value: unknown): string { return parseCoverageVersion(value) ?? invalid(); }
function name(value: unknown, max = 500): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value)
    ? value : invalid();
}
function taskTitle(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : invalid();
}
function flag(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function list<T>(value: unknown, maximum: number, parse: (entry: unknown) => T): T[] {
  return Array.isArray(value) && value.length <= maximum ? value.map(parse) : invalid();
}
function unique<T extends { id: string }>(rows: T[]): T[] {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return invalid();
  return rows;
}
function deadline(row: Record<string, unknown>, required = false): CoverageDeadline {
  const due_on = row.due_on === null ? null : parseCoverageDate(row.due_on) ?? invalid();
  const raw = row.due_at;
  const due_at = raw === null ? null : typeof raw === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
    && parseCoverageDate(raw.slice(0, 10)) !== null
    && Number.isFinite(Date.parse(raw)) ? raw : invalid();
  if ((due_on && due_at) || (required && !due_on && !due_at)) return invalid();
  return { due_on, due_at };
}
function task(value: unknown): CoverageTask {
  const row = record(value, ["id", "version", "title", "status", "due_on", "due_at", "assignee_id", "assignee_name", "tracked", "required", "can_transfer", "return_assignee_id", "return_assignee_name", "conflict"]);
  const status = row.status;
  if (status !== "open" && status !== "in_progress" && status !== "blocked") return invalid();
  const conflict = row.conflict;
  if (conflict !== null && conflict !== "task_reassigned" && conflict !== "original_assignee_unavailable" && conflict !== "unrelated_assignee") return invalid();
  return {
    id: id(row.id), version: version(row.version), title: taskTitle(row.title), status, ...deadline(row),
    assignee_id: id(row.assignee_id), assignee_name: name(row.assignee_name), tracked: flag(row.tracked),
    required: flag(row.required), can_transfer: flag(row.can_transfer),
    return_assignee_id: row.return_assignee_id === null ? null : id(row.return_assignee_id),
    return_assignee_name: row.return_assignee_name === null ? null : name(row.return_assignee_name), conflict,
  };
}
function preview(value: unknown): CoveragePreview {
  const row = record(value, ["id", "name", "owner_id", "scope_version", "tasks", "conflicts", "coverage"]);
  const coverage = row.coverage === null ? null : record(row.coverage, ["id", "version", "original_curator_id", "substitute_curator_id", "planned_end_on"]);
  const conflicts = list(row.conflicts, 2, (entry) => {
    if (entry !== "assignment_changed" && entry !== "original_curator_unavailable") return invalid();
    return entry;
  });
  return {
    id: id(row.id), name: name(row.name), owner_id: id(row.owner_id), scope_version: version(row.scope_version),
    tasks: unique(list(row.tasks, 1000, task)), conflicts,
    coverage: coverage === null ? null : {
      id: id(coverage.id), version: version(coverage.version), original_curator_id: id(coverage.original_curator_id),
      substitute_curator_id: id(coverage.substitute_curator_id), planned_end_on: parseCoverageDate(coverage.planned_end_on) ?? invalid(),
    },
  };
}
export function parseCoverageWorkspace(value: unknown, organizationId: string): CoverageWorkspace {
  const row = record(value, ["organization_id", "curators", "cases", "next_case_id", "preview"]);
  if (id(row.organization_id) !== id(organizationId)) return invalid();
  const workspace: CoverageWorkspace = {
    organization_id: id(row.organization_id),
    curators: unique(list(row.curators, 500, (entry) => {
      const curator = record(entry, ["id", "name", "active", "active_case_count", "open_task_count", "nearest_due"]);
      return {
        id: id(curator.id), name: name(curator.name), active: flag(curator.active),
        active_case_count: count(curator.active_case_count), open_task_count: count(curator.open_task_count),
        nearest_due: curator.nearest_due === null ? null : deadline(record(curator.nearest_due, ["due_on", "due_at"]), true),
      };
    })),
    cases: unique(list(row.cases, 50, (entry) => {
      const item = record(entry, ["id", "name"]); return { id: id(item.id), name: name(item.name) };
    })),
    next_case_id: row.next_case_id === null ? null : id(row.next_case_id),
    preview: row.preview === null ? null : preview(row.preview),
  };
  if (workspace.next_case_id !== null && workspace.cases.at(-1)?.id !== workspace.next_case_id) return invalid();
  if (workspace.preview && !workspace.curators.some((curator) => curator.id === workspace.preview!.owner_id)) return invalid();
  return workspace;
}

/** Date-only stays date-only; timed work uses the organisation's Bishkek zone. */
export function coverageDeadlineLabel(value: CoverageDeadline | null): string {
  if (!value || (!value.due_on && !value.due_at)) return "Без срока";
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bishkek" };
  if (value.due_on) return new Intl.DateTimeFormat("ru-RU", options).format(new Date(`${value.due_on}T00:00:00Z`));
  return `${new Intl.DateTimeFormat("ru-RU", { ...options, hour: "2-digit", minute: "2-digit" }).format(new Date(value.due_at!))} · Бишкек`;
}
