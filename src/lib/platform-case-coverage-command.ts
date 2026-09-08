import {
  parseCoverageDate,
  parseCoverageUuid,
  parseCoverageVersion,
} from "./platform-case-coverage-contract.ts";

export const COVERAGE_COMMAND_FIELDS = [
  "operation", "student_case_id", "expected_owner", "expected_scope_version",
  "substitute_membership_id", "planned_end_on", "coverage_id",
  "expected_coverage_version", "task_snapshot", "reason", "request_id",
] as const;

export type CoverageTaskSnapshot = Readonly<{ id: string; version: string }>;
export type CoverageCommand = Readonly<{
  operation: "start" | "return";
  caseId: string;
  ownerId: string;
  scopeVersion: string;
  substituteId: string | null;
  plannedEndOn: string | null;
  coverageId: string | null;
  coverageVersion: string;
  tasks: readonly Readonly<CoverageTaskSnapshot & { selected: boolean }>[];
  reason: string;
  requestId: string;
}>;

export function parseCoverageTaskSnapshot(raw: unknown): readonly CoverageTaskSnapshot[] | null {
  if (typeof raw !== "string" || raw.length > 200_000) return null;
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(decoded) || decoded.length > 1000) return null;
  const seen = new Set<string>();
  const tasks: CoverageTaskSnapshot[] = [];
  for (const item of decoded) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 2) return null;
    const id = parseCoverageUuid(item.id);
    const version = parseCoverageVersion(item.version);
    if (!id || !version || seen.has(id)) return null;
    seen.add(id);
    tasks.push({ id, version });
  }
  return tasks;
}

export function parseCoverageCommand(fields: ReadonlyMap<string, string>): CoverageCommand | null {
  const get = (key: string) => fields.get(key) ?? "";
  const operation = get("operation");
  const caseId = parseCoverageUuid(get("student_case_id"));
  const ownerId = parseCoverageUuid(get("expected_owner"));
  const scopeVersion = parseCoverageVersion(get("expected_scope_version"));
  const requestId = parseCoverageUuid(get("request_id"));
  const snapshot = parseCoverageTaskSnapshot(get("task_snapshot"));
  const reason = get("reason").trim();
  if ((operation !== "start" && operation !== "return") || !caseId || !ownerId ||
    !scopeVersion || !requestId || !snapshot || !reason || reason.length > 1000 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(reason)) return null;
  const expected = new Set<string>([...COVERAGE_COMMAND_FIELDS, ...snapshot.map((task) => `task_${task.id}`)]);
  if (fields.size !== expected.size || [...fields.keys()].some((key) => !expected.has(key))) return null;
  const tasks: Array<CoverageTaskSnapshot & { selected: boolean }> = [];
  for (const task of snapshot) {
    const selected = get(`task_${task.id}`);
    if (selected !== "true" && selected !== "false") return null;
    tasks.push({ ...task, selected: selected === "true" });
  }
  const substituteId = operation === "start" ? parseCoverageUuid(get("substitute_membership_id")) : null;
  const plannedEndOn = operation === "start" ? parseCoverageDate(get("planned_end_on")) : null;
  const coverageId = operation === "return" ? parseCoverageUuid(get("coverage_id")) : null;
  const coverageVersion = operation === "return" ? parseCoverageVersion(get("expected_coverage_version")) : "0";
  if (operation === "start" && (!substituteId || substituteId === ownerId || !plannedEndOn ||
    get("coverage_id") !== "" || get("expected_coverage_version") !== "0")) return null;
  if (operation === "return" && (!coverageId || !coverageVersion ||
    get("substitute_membership_id") !== "" || get("planned_end_on") !== "")) return null;
  return { operation, caseId, ownerId, scopeVersion, requestId, tasks, reason,
    substituteId, plannedEndOn, coverageId, coverageVersion: coverageVersion! };
}
