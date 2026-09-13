import { ADMISSIONS_DIRECTIONS, type AdmissionsDirection } from "../platform-admissions-playbook-contract.ts";
import { parseStaffRoleScope, type StaffRoleScope } from "./staff-roles-contract.ts";
export type StaffWorkspaceMember = Readonly<{
  membershipId: string; displayName: string; status: string; version: number;
  metadata: Readonly<{
    version: number; departmentId: string | null; jobTitle: string | null;
    directions: readonly AdmissionsDirection[];
  }>;
}>;
export type StaffDepartment = Readonly<{
  id: string; name: string; description: string | null;
  status: "active" | "archived"; version: number; memberCount: number;
}>;
export type StaffAuthRequest = Readonly<{
  requestId: string; operation: "invite" | "recovery"; displayName: string;
  status: "dispatching" | "reconciliation_required" | "completed" | "rejected"; createdAt: string;
  rejectionCode: string | null;
}>;
export type StaffWorkspaceData = Readonly<{
  members: readonly StaffWorkspaceMember[]; requests: readonly StaffAuthRequest[]; available: boolean;
  departments: readonly StaffDepartment[];
}>;
export type StaffWorkspaceActionState = Readonly<{
  status: "idle" | "success" | "error"; message: string;
  retryAllowed?: boolean;
  metadataOutcome?: "unknown";
  preparation?: StaffAuthPreparation;
  outcome?: "unknown";
  requestId?: string;
  conflictCode?: string;
}>;
export const STAFF_WORKSPACE_INITIAL_STATE: StaffWorkspaceActionState = { status: "idle", message: "" };
export const STAFF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isStaffCommandVersionRejection(operation: "status" | "preparation", error: { code?: string; message: string }): boolean {
  // These exact 157 exceptions occur only after the immutable command receipt
  // lookup. A committed replay returns its receipt before checking versions.
  // Do not use this for Auth claims, authorization failures or request conflicts.
  return error.code === "40001" && error.message === (operation === "status"
    ? "staff_workspace_version_conflict" : "staff_workspace_preparation_version_conflict");
}
export type StaffInviteAssignmentInput = Readonly<{ roleId: string; roleVersion: number; scope: StaffRoleScope }>;
export type StaffPreparedAssignment = StaffInviteAssignmentInput & Readonly<{
  bundleId: string; bundleVersion: number; label: string; permissionKeys: readonly string[];
}>;
export type StaffAuthPreparation = Readonly<{
  schemaVersion: 1; requestId: string; operation: StaffAuthRequest["operation"];
  status: StaffAuthRequest["status"]; displayName: string; preparationVersion: number;
  conflictCode: string | null; noAccess: boolean; targetMembershipId: string | null;
  assignments: readonly StaffPreparedAssignment[];
}>;
export type StaffAuthInput = Readonly<{ requestId: string }> & (
  | Readonly<{ operation: "reconcile" }>
  | Readonly<{ operation: "invite"; email: string; displayName: string; assignments: readonly StaffInviteAssignmentInput[]; noAccess: boolean; reason: string }>
  | Readonly<{ operation: "recovery"; membershipId: string; expectedAccessVersion: number; reason: string }>
);
export type StaffPendingAccessInput = Readonly<{
  requestId: string; commandRequestId: string; expectedPreparationVersion: number;
  assignments: readonly StaffInviteAssignmentInput[]; noAccess: boolean; reason: string;
}>;
export type StaffAuthResult = Readonly<{
  status: "completed" | "rejected" | "reconciliation_required";
  operation: StaffAuthRequest["operation"]; rejectionCode: string | null; conflictCode: string | null;
}>;

function invalid(): never { throw new Error("staff_workspace_invalid_input"); }
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(row, key)) || Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))) return invalid();
  return row;
}
function boundedText(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/u.test(value)) return invalid();
  return value;
}
function uuid(value: unknown): string { return typeof value === "string" && STAFF_UUID.test(value) ? value.toLowerCase() : invalid(); }
function integer(value: unknown, minimum = 1): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : invalid();
}
function rows(value: unknown, maximum = 100): unknown[] { return Array.isArray(value) && value.length <= maximum ? value : invalid(); }
function code(value: unknown): string | null {
  return value === null ? null : typeof value === "string" && /^[a-z][a-z0-9_]{0,99}$/u.test(value) ? value : invalid();
}
function operation(value: unknown): StaffAuthRequest["operation"] { return value === "invite" || value === "recovery" ? value : invalid(); }
function status(value: unknown): StaffAuthRequest["status"] {
  return value === "dispatching" || value === "reconciliation_required" || value === "completed" || value === "rejected" ? value : invalid();
}
function scope(value: unknown, organizationId?: string): StaffRoleScope {
  const result = parseStaffRoleScope(value);
  if (result.kind === "direction" && !(ADMISSIONS_DIRECTIONS as readonly unknown[]).includes(result.key)) return invalid();
  if (result.kind === "organization" && organizationId && result.key?.toLowerCase() !== uuid(organizationId)) return invalid();
  return { ...result, key: result.key !== null && ["organization", "department", "record"].includes(result.kind) ? uuid(result.key) : result.key };
}
function uniqueAssignments<T extends StaffInviteAssignmentInput>(assignments: readonly T[]): readonly T[] {
  const keys = assignments.map((entry) => JSON.stringify([entry.roleId, entry.scope.kind, entry.scope.key, entry.scope.resourceKind]));
  return new Set(keys).size === keys.length ? assignments : invalid();
}
export function parseStaffInviteAssignmentInputs(value: unknown, noAccess: boolean, organizationId?: string): readonly StaffInviteAssignmentInput[] {
  const assignments = rows(value).map((value) => {
    const row = object(value, ["roleId", "roleVersion", "scope"]);
    return { roleId: uuid(row.roleId), roleVersion: integer(row.roleVersion), scope: scope(row.scope, organizationId) };
  });
  if (typeof noAccess !== "boolean" || noAccess !== (assignments.length === 0)) return invalid();
  return uniqueAssignments(assignments);
}
export function parseStaffAuthPreparation(value: unknown, expected?: Readonly<{ requestId: string; organizationId: string }>): StaffAuthPreparation {
  const row = object(value, ["schemaVersion", "requestId", "operation", "status", "displayName", "preparationVersion", "conflictCode", "noAccess", "targetMembershipId", "assignments"]);
  if (row.schemaVersion !== 1 || typeof row.noAccess !== "boolean") return invalid();
  const assignments = uniqueAssignments(rows(row.assignments).map((value) => {
    const entry = object(value, ["roleId", "roleVersion", "bundleId", "bundleVersion", "label", "permissionKeys", "scope"]);
    const permissionKeys = rows(entry.permissionKeys, 1000).map((key) => {
      if (typeof key !== "string" || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u.test(key)) return invalid();
      return key;
    });
    if (new Set(permissionKeys).size !== permissionKeys.length) return invalid();
    return { roleId: uuid(entry.roleId), roleVersion: integer(entry.roleVersion), bundleId: uuid(entry.bundleId),
      bundleVersion: integer(entry.bundleVersion), label: boundedText(entry.label, 160), permissionKeys,
      scope: scope(entry.scope, expected?.organizationId) };
  }));
  const result: StaffAuthPreparation = { schemaVersion: 1, requestId: uuid(row.requestId), operation: operation(row.operation),
    status: status(row.status), displayName: boundedText(row.displayName, 160), preparationVersion: integer(row.preparationVersion, 0),
    conflictCode: code(row.conflictCode), noAccess: row.noAccess, targetMembershipId: row.targetMembershipId === null ? null : uuid(row.targetMembershipId), assignments };
  if (expected && result.requestId !== uuid(expected.requestId)) return invalid();
  if (result.status === "completed" && result.targetMembershipId === null) return invalid();
  if ((result.noAccess && assignments.length > 0) || (result.preparationVersion === 0 && assignments.length > 0)) return invalid();
  if (result.operation === "recovery" && (result.preparationVersion !== 0 || result.noAccess || assignments.length > 0 || !result.targetMembershipId)) return invalid();
  if (result.operation === "invite" && result.preparationVersion > 0 && !result.noAccess && !assignments.some((entry) => entry.permissionKeys.length > 0)) return invalid();
  return result;
}
function field(form: FormData, name: string, maximum = 160): string {
  const value = form.get(name);
  if (form.getAll(name).length !== 1) return invalid();
  return boundedText(value, maximum).trim();
}
export function staffAuthRequestId(form: FormData): string { return uuid(field(form, "request_id", 36)); }
function formVersion(form: FormData, name: string, minimum = 1): number {
  const value = field(form, name, 16);
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) return invalid();
  return integer(Number(value), minimum);
}
function accessInput(form: FormData, organizationId?: string) {
  if (field(form, "rights_confirmed", 3) !== "yes") throw new Error("staff_workspace_rights_required");
  const rawNoAccess = field(form, "no_access", 3);
  if (rawNoAccess !== "yes" && rawNoAccess !== "no") return invalid();
  const noAccess = rawNoAccess === "yes";
  let value: unknown;
  try { value = JSON.parse(field(form, "assignments", 64000)); } catch { return invalid(); }
  return { noAccess, assignments: parseStaffInviteAssignmentInputs(value, noAccess, organizationId) };
}
export function parseStaffAuthInput(form: FormData, organizationId?: string): StaffAuthInput {
  const requestId = staffAuthRequestId(form);
  const action = field(form, "operation", 12);
  if (action === "reconcile") return { operation: action, requestId };
  if (form.has("role")) return invalid();
  if (field(form, "recipient_confirmed", 3) !== "yes") throw new Error("staff_workspace_recipient_required");
  const reason = field(form, "reason", 500);
  if (action === "recovery") return { operation: action, requestId, reason,
    membershipId: uuid(field(form, "membership_id", 36)), expectedAccessVersion: formVersion(form, "expected_version") };
  if (action !== "invite") return invalid();
  const email = field(form, "email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return invalid();
  return { operation: action, requestId, reason, email, displayName: field(form, "display_name", 160), ...accessInput(form, organizationId) };
}
export function parseStaffPendingAccessInput(form: FormData, organizationId?: string): StaffPendingAccessInput {
  const requestId = staffAuthRequestId(form);
  const commandRequestId = uuid(field(form, "command_request_id", 36));
  if (commandRequestId === requestId) return invalid();
  return { requestId, commandRequestId, expectedPreparationVersion: formVersion(form, "expected_preparation_version", 0),
    reason: field(form, "reason", 500), ...accessInput(form, organizationId) };
}
export function parseStaffAuthClaim(value: unknown, requestId: string, expectedEmail?: string) {
  const row = object(value, ["id", "dispatch", "status"], ["email"]);
  if (uuid(row.id) !== uuid(requestId) || typeof row.dispatch !== "boolean") return invalid();
  const claimStatus = status(row.status);
  if (!row.dispatch) {
    if (Object.hasOwn(row, "email")) return invalid();
    return { dispatch: false as const, status: claimStatus };
  }
  const email = boundedText(row.email, 320);
  if (claimStatus !== "dispatching" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || (expectedEmail && email !== expectedEmail)) return invalid();
  return { dispatch: true as const, status: claimStatus, email };
}
export function parseStaffAuthResult(value: unknown, expectedOperation?: StaffAuthRequest["operation"]): StaffAuthResult {
  const row = object(value, ["status", "operation"], ["rejection_code", "conflict_code"]);
  const resultStatus = status(row.status);
  const resultOperation = operation(row.operation);
  if (resultStatus === "dispatching" || (expectedOperation && expectedOperation !== resultOperation)) return invalid();
  const rejectionCode = Object.hasOwn(row, "rejection_code") ? code(row.rejection_code) : null;
  const conflictCode = Object.hasOwn(row, "conflict_code") ? code(row.conflict_code) : null;
  if ((rejectionCode !== null && resultStatus !== "rejected") || (conflictCode !== null && resultStatus !== "reconciliation_required")) return invalid();
  return { status: resultStatus, operation: resultOperation, rejectionCode, conflictCode };
}
export function parseStaffPendingAccessReceipt(value: unknown, requestId: string, expectedVersion: number): void {
  const row = object(value, ["status", "requestId", "preparationVersion"]);
  if (row.status !== "applied" || uuid(row.requestId) !== uuid(requestId) || integer(row.preparationVersion) !== expectedVersion + 1) return invalid();
}
export function parseStaffStatusInput(form: FormData) {
  if (field(form, "operation", 12) !== "status") return invalid();
  const memberStatus = field(form, "value", 12);
  if (memberStatus !== "active" && memberStatus !== "suspended") return invalid();
  return { requestId: staffAuthRequestId(form), membershipId: uuid(field(form, "membership_id", 36)),
    expectedVersion: formVersion(form, "expected_version"), status: memberStatus, reason: field(form, "reason", 500) };
}
export function parseStaffStatusReceipt(value: unknown, expected: Readonly<{
  organizationId: string; membershipId: string; expectedVersion: number; status: string;
}>): void {
  const row = object(value, ["organization_id", "membership_id", "profile_id", "role", "bundle_id", "status", "access_version"]);
  if (uuid(row.organization_id) !== uuid(expected.organizationId) || uuid(row.membership_id) !== uuid(expected.membershipId) ||
    integer(row.access_version) !== expected.expectedVersion + 1 || row.status !== expected.status) return invalid();
  uuid(row.profile_id);
  if (row.bundle_id !== null) uuid(row.bundle_id);
  // Historical metadata only: custom staff need neither a coarse role nor bundle.
  if (row.role !== null && row.role !== "admin" && row.role !== "sales" && row.role !== "curator") return invalid();
}

export function staffAuthRejectionMessage(code: string | null | undefined): string {
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return "Сервис входа отклонил запрос из-за ограничения частоты. Подождите перед новым запросом.";
  if (code === "email_address_not_authorized") return "Почтовый сервис не разрешает отправку этому адресату. Администратору нужно проверить настройки SMTP.";
  if (code === "email_address_invalid") return "Сервис входа отклонил email. Проверьте рабочий адрес сотрудника.";
  if (code === "email_exists") return "Этот email уже зарегистрирован. Проверьте существующий аккаунт перед новым запросом.";
  if (code === "not_admin" || code === "bad_jwt" || code === "no_authorization") return "Сервис входа отклонил серверные полномочия. Администратору нужно проверить настройку доступа к Auth.";
  return "Сервис входа отклонил запрос. Администратору нужно проверить настройки Auth перед новым запросом.";
}
