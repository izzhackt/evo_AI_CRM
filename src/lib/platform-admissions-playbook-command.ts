import { ADMISSIONS_DIRECTIONS, ADMISSIONS_STAGES, ADMISSIONS_CASE_FIELDS, ADMISSIONS_APPLICATION_FIELDS, ADMISSIONS_VISA_FIELDS, validateAdmissionsFields, type AdmissionsDirection, type AdmissionsStage, type AdmissionsOutcome, type AdmissionsMutationReceipt } from "./platform-admissions-playbook-contract.ts";

type Base = { caseId: string; expectedVersion: string; requestId: string };
export type AdmissionsCommand = Base & (
  | { operation: "configure"; direction: AdmissionsDirection; playbookVersionId: string | null; nextAction: string; nextActionDueOn: string }
  | { operation: "facts"; facts: Record<string, string>; primaryApplicationId: string | null; routeApprovalStatus: "draft" | "approved" | "rework"; nextAction: string; nextActionDueOn: string }
  | { operation: "transition"; stage: AdmissionsStage; outcome: AdmissionsOutcome; reason: string }
  | { operation: "application"; applicationId: string; details: Record<string, string> }
  | { operation: "visa"; visaCaseId: string; details: Record<string, string> }
);
export type AdmissionsCommandResult = { ok: true; receipt: AdmissionsMutationReceipt } | {
  ok: false; code: "invalid" | "stale" | "denied" | "request_conflict" | "unavailable"; message: string;
};
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const BASE_KEYS = ["operation", "caseId", "expectedVersion", "requestId"];
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function id(value: unknown): string { if (typeof value !== "string" || !UUID.test(value) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) throw Error(); return value; }
function nullableId(value: unknown): string | null { return value === null ? null : id(value); }
function text(value: unknown, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error(); return value.trim(); }
function date(value: unknown): string { const s = text(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw Error(); return s; }
function oneOf<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== "string" || !values.includes(value as T)) throw Error(); return value as T; }
function exact(value: Record<string, unknown>, fields: string[]): void { const names = [...BASE_KEYS, ...fields]; if (Object.keys(value).length !== names.length || Object.keys(value).some((key) => !names.includes(key))) throw Error(); }

export function parseAdmissionsCommand(input: unknown): AdmissionsCommand | null {
  try {
    if (!isRecord(input) || JSON.stringify(input).length > 100_000) return null;
    const version = input.expectedVersion;
    if (typeof version !== "string" || !/^(0|[1-9]\d{0,18})$/.test(version) || BigInt(version) > BigInt("9223372036854775807")) return null;
    const base: Base = { caseId: id(input.caseId), expectedVersion: version, requestId: id(input.requestId) };
    switch (input.operation) {
      case "configure": {
        exact(input, ["direction", "playbookVersionId", "nextAction", "nextActionDueOn"]);
        const direction = oneOf(input.direction, ADMISSIONS_DIRECTIONS), playbookVersionId = nullableId(input.playbookVersionId);
        if ((direction === "CN" || direction === "MY") !== (playbookVersionId !== null)) return null;
        return { ...base, operation: "configure", direction, playbookVersionId, nextAction: text(input.nextAction, 1000), nextActionDueOn: date(input.nextActionDueOn) };
      }
      case "facts":
        exact(input, ["facts", "primaryApplicationId", "routeApprovalStatus", "nextAction", "nextActionDueOn"]);
        return { ...base, operation: "facts", facts: validateAdmissionsFields(input.facts, ADMISSIONS_CASE_FIELDS), primaryApplicationId: nullableId(input.primaryApplicationId), routeApprovalStatus: oneOf(input.routeApprovalStatus, ["draft", "approved", "rework"]), nextAction: text(input.nextAction, 1000), nextActionDueOn: date(input.nextActionDueOn) };
      case "transition":
        exact(input, ["stage", "outcome", "reason"]);
        return { ...base, operation: "transition", stage: oneOf(input.stage, ADMISSIONS_STAGES), outcome: oneOf(input.outcome, ["active", "arrived", "cancelled"]), reason: text(input.reason, 1000) };
      case "application":
        exact(input, ["applicationId", "details"]);
        return { ...base, operation: "application", applicationId: id(input.applicationId), details: validateAdmissionsFields(input.details, ADMISSIONS_APPLICATION_FIELDS) };
      case "visa":
        exact(input, ["visaCaseId", "details"]);
        return { ...base, operation: "visa", visaCaseId: id(input.visaCaseId), details: validateAdmissionsFields(input.details, ADMISSIONS_VISA_FIELDS) };
      default: return null;
    }
  } catch { return null; }
}

export function admissionsCommandRpc(command: AdmissionsCommand): { name: string; args: Record<string, unknown> } {
  const common = { p_student_case_id: command.caseId, p_expected_version: command.expectedVersion, p_request_id: command.requestId };
  switch (command.operation) {
    case "configure": return { name: "configure_case_admissions_v1", args: { ...common, p_direction: command.direction, p_playbook_version_id: command.playbookVersionId, p_next_action: command.nextAction, p_next_action_due_on: command.nextActionDueOn } };
    case "facts": return { name: "update_case_admissions_facts_v1", args: { ...common, p_facts: command.facts, p_primary_application_id: command.primaryApplicationId, p_route_approval_status: command.routeApprovalStatus, p_next_action: command.nextAction, p_next_action_due_on: command.nextActionDueOn } };
    case "transition": return { name: "transition_case_admissions_v1", args: { ...common, p_stage: command.stage, p_outcome: command.outcome, p_reason: command.reason } };
    case "application": return { name: "update_application_admissions_details_v1", args: { ...common, p_application_id: command.applicationId, p_details: command.details } };
    case "visa": return { name: "update_visa_admissions_details_v1", args: { ...common, p_visa_case_id: command.visaCaseId, p_details: command.details } };
  }
}
