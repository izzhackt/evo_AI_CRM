"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { fixedRoleCan } from "./fixed-role-policy";
import { parsePlatformAdmissionsUuid } from "./platform-admissions";
import type { PlatformAdmissionsActionStatus } from "./platform-admissions-task-actions";
import { requirePlatformStaffActor } from "./platform-guards";
import {
  PLATFORM_DOCUMENT_SLOT_CASE_LINK_TARGETS,
  PLATFORM_DOCUMENT_SLOT_INTENTS,
  PLATFORM_DOCUMENT_SLOT_STATUSES,
  type PlatformDocumentSlotCaseLinkTargetKind,
} from "./platform-private-documents";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const CREATE_SLOT_FIELDS = [
  "student_case_id",
  "label",
  "group_label",
  "request_id",
] as const;
const CHANGE_SLOT_FIELDS = [
  "student_case_id",
  "document_slot_id",
  "label",
  "group_label",
  "expected_version",
  "reason",
  "request_id",
] as const;
const REMOVE_SLOT_FIELDS = [
  "student_case_id",
  "document_slot_id",
  "expected_version",
  "reason",
  "request_id",
] as const;
const SET_SLOT_CASE_LINK_FIELDS = [
  "student_case_id",
  "document_slot_id",
  "target_kind",
  "target_id",
  "enabled",
  "expected_version",
  "reason",
  "request_id",
] as const;

export type PlatformDocumentChecklistActionState = Readonly<{
  status: PlatformAdmissionsActionStatus;
  requestId: string;
  documentSlotId: string | null;
  version: string | null;
}>;

export type PlatformDocumentCaseLinkActionState = Readonly<{
  status: PlatformAdmissionsActionStatus;
  requestId: string;
  documentSlotId: string | null;
  targetKind: PlatformDocumentSlotCaseLinkTargetKind | null;
  targetId: string | null;
  version: string | null;
}>;

type ChecklistStringFields = ReadonlyMap<string, string>;

function field(fields: ChecklistStringFields, key: string): string {
  return fields.get(key)?.trim() ?? "";
}

function uuid(value: string): string | null {
  return parsePlatformAdmissionsUuid(value);
}

function boundedText(value: string, maximum: number): string | null {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function version(value: string): string | null {
  if (!/^\d+$/.test(value)) return null;
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (
    normalized === "0" ||
    normalized.length > POSTGRES_BIGINT_MAX.length ||
    (normalized.length === POSTGRES_BIGINT_MAX.length &&
      normalized > POSTGRES_BIGINT_MAX)
  ) {
    return null;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  return actual.length === normalizedExpected.length &&
    actual.every((key, index) => key === normalizedExpected[index]);
}

function isDocumentRequirementId(value: unknown): boolean {
  return value === null ||
    (typeof value === "string" && uuid(value) === value.toLowerCase());
}

function isSlotIntent(value: unknown): boolean {
  return typeof value === "string" &&
    (PLATFORM_DOCUMENT_SLOT_INTENTS as readonly string[]).includes(value);
}

function isSlotStatus(value: unknown): boolean {
  return typeof value === "string" &&
    (PLATFORM_DOCUMENT_SLOT_STATUSES as readonly string[]).includes(value);
}

function caseLinkTargetKind(
  value: string,
): PlatformDocumentSlotCaseLinkTargetKind | null {
  return (PLATFORM_DOCUMENT_SLOT_CASE_LINK_TARGETS as readonly string[]).includes(value)
    ? value as PlatformDocumentSlotCaseLinkTargetKind
    : null;
}

function actionBoolean(value: string): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function isTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function submittedRequestId(form: FormData): string | null {
  const direct = form.getAll("request_id");
  const enveloped = form.getAll("_1_request_id");
  const values = direct.length > 0 ? direct : enveloped;
  const candidate = values.length === 1 ? values[0] : null;
  return typeof candidate === "string" ? uuid(candidate.trim()) : null;
}

function errorStatus(error: unknown): Exclude<
  PlatformAdmissionsActionStatus,
  "idle" | "saved"
> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string"
    ? error.message.trim()
    : "";
  if (code === "42501") return "forbidden";
  if (code === "PT409" && message === "document_slot_version_conflict") {
    return "stale";
  }
  if ((code === "22023" || code === "23505") && /request_id/i.test(message)) {
    return "request_conflict";
  }
  if (code === "22023") return "invalid";
  return "unavailable";
}

function failureState(
  form: FormData,
  status: Exclude<PlatformAdmissionsActionStatus, "idle" | "saved">,
  documentSlotId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformDocumentChecklistActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "stale" || status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    documentSlotId,
    version: null,
  });
}

function caseLinkFailureState(
  form: FormData,
  status: Exclude<PlatformAdmissionsActionStatus, "idle" | "saved">,
  documentSlotId: string | null = null,
  targetKind: PlatformDocumentSlotCaseLinkTargetKind | null = null,
  targetId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformDocumentCaseLinkActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "stale" || status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    documentSlotId,
    targetKind,
    targetId,
    version: null,
  });
}

function revalidateChecklist(studentCaseId: string): void {
  void studentCaseId;
  revalidatePath("/v3/profile");
  revalidatePath("/v3/knowledge");
}

export async function createPlatformCustomDocumentSlotAction(
  _previous: PlatformDocumentChecklistActionState,
  form: FormData,
): Promise<PlatformDocumentChecklistActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "documents.write")) {
    return failureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, CREATE_SLOT_FIELDS);
  if (!fields) return failureState(form, "invalid");

  const studentCaseId = uuid(field(fields, "student_case_id"));
  const label = boundedText(field(fields, "label"), 500);
  const groupLabel = boundedText(field(fields, "group_label"), 200);
  const requestId = uuid(field(fields, "request_id"));
  if (!studentCaseId || !label || !groupLabel || !requestId) {
    return failureState(form, "invalid", null, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "create_custom_document_slot",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_label: label,
        p_group_label: groupLabel,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(form, errorStatus(response.error), null, requestId);
    }
    const data = response.data;
    const documentSlotId = isRecord(data) &&
        typeof data.document_slot_id === "string"
      ? uuid(data.document_slot_id)
      : null;
    if (
      !isRecord(data) || !documentSlotId ||
      !hasExactKeys(data, [
        "organization_id", "student_case_id", "document_slot_id",
        "document_requirement_id", "requirement_label", "group_label",
        "intent_kind", "slot_status", "version", "request_id",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.student_case_id !== studentCaseId ||
      data.document_slot_id !== documentSlotId ||
      data.document_requirement_id !== null ||
      data.requirement_label !== label || data.group_label !== groupLabel ||
      data.intent_kind !== "custom" || data.slot_status !== "required" ||
      data.version !== "1" || data.request_id !== requestId
    ) {
      return failureState(form, "unavailable", documentSlotId, requestId);
    }
    revalidateChecklist(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      documentSlotId,
      version: "1",
    });
  } catch {
    return failureState(form, "unavailable", null, requestId);
  }
}

export async function changePlatformDocumentSlotMetadataAction(
  _previous: PlatformDocumentChecklistActionState,
  form: FormData,
): Promise<PlatformDocumentChecklistActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "documents.write")) {
    return failureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, CHANGE_SLOT_FIELDS);
  if (!fields) return failureState(form, "invalid");

  const studentCaseId = uuid(field(fields, "student_case_id"));
  const documentSlotId = uuid(field(fields, "document_slot_id"));
  const label = boundedText(field(fields, "label"), 500);
  const groupLabel = boundedText(field(fields, "group_label"), 200);
  const expectedVersion = version(field(fields, "expected_version"));
  const reason = boundedText(field(fields, "reason"), 1_000);
  const requestId = uuid(field(fields, "request_id"));
  if (
    !studentCaseId || !documentSlotId || !label || !groupLabel ||
    !expectedVersion || !reason || !requestId
  ) {
    return failureState(form, "invalid", documentSlotId, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "change_document_slot_metadata",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_document_slot_id: documentSlotId,
        p_label: label,
        p_group_label: groupLabel,
        p_expected_version: expectedVersion,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(
        form,
        errorStatus(response.error),
        documentSlotId,
        requestId,
      );
    }
    const data = response.data;
    const nextVersion = isRecord(data) && typeof data.version === "string"
      ? version(data.version)
      : null;
    if (
      !isRecord(data) || !nextVersion ||
      !hasExactKeys(data, [
        "organization_id", "student_case_id", "document_slot_id",
        "document_requirement_id", "requirement_label", "group_label",
        "intent_kind", "slot_status", "expected_version", "version",
        "changed_at", "request_id",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.student_case_id !== studentCaseId ||
      data.document_slot_id !== documentSlotId ||
      !isDocumentRequirementId(data.document_requirement_id) ||
      data.requirement_label !== label || data.group_label !== groupLabel ||
      !isSlotIntent(data.intent_kind) || !isSlotStatus(data.slot_status) ||
      data.expected_version !== expectedVersion ||
      BigInt(nextVersion) !== BigInt(expectedVersion) + BigInt(1) ||
      !isTimestamp(data.changed_at) || data.request_id !== requestId
    ) {
      return failureState(form, "unavailable", documentSlotId, requestId);
    }
    revalidateChecklist(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      documentSlotId,
      version: nextVersion,
    });
  } catch {
    return failureState(form, "unavailable", documentSlotId, requestId);
  }
}

export async function setPlatformDocumentCaseLinkAction(
  _previous: PlatformDocumentCaseLinkActionState,
  form: FormData,
): Promise<PlatformDocumentCaseLinkActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "documents.write")) {
    return caseLinkFailureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, SET_SLOT_CASE_LINK_FIELDS);
  if (!fields) return caseLinkFailureState(form, "invalid");

  const studentCaseId = uuid(field(fields, "student_case_id"));
  const documentSlotId = uuid(field(fields, "document_slot_id"));
  const targetKind = caseLinkTargetKind(field(fields, "target_kind"));
  const targetId = uuid(field(fields, "target_id"));
  const enabled = actionBoolean(field(fields, "enabled"));
  const expectedVersion = version(field(fields, "expected_version"));
  const reason = boundedText(field(fields, "reason"), 1000);
  const requestId = uuid(field(fields, "request_id"));
  if (!studentCaseId || !documentSlotId || !targetKind || !targetId ||
    enabled === null || !expectedVersion || !reason || !requestId) {
    return caseLinkFailureState(
      form,
      "invalid",
      documentSlotId,
      targetKind,
      targetId,
      requestId,
    );
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "set_document_slot_case_link",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_document_slot_id: documentSlotId,
        p_target_kind: targetKind,
        p_target_id: targetId,
        p_enabled: enabled,
        p_expected_version: expectedVersion,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return caseLinkFailureState(
        form,
        errorStatus(response.error),
        documentSlotId,
        targetKind,
        targetId,
        requestId,
      );
    }

    const data = response.data;
    const documentSlotCaseLinkId = isRecord(data) &&
      data.document_slot_case_link_id !== null &&
      typeof data.document_slot_case_link_id === "string"
      ? uuid(data.document_slot_case_link_id)
      : null;
    const targetMatches = isRecord(data) && (
      targetKind === "university_application"
        ? data.university_application_id === targetId && data.visa_case_id === null
        : data.university_application_id === null && data.visa_case_id === targetId
    );
    if (
      !isRecord(data) ||
      !hasExactKeys(data, [
        "organization_id", "student_case_id", "document_slot_id",
        "target_kind", "target_id", "university_application_id",
        "visa_case_id", "linked", "document_slot_case_link_id",
        "expected_version", "version", "changed_at", "reason", "request_id",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.student_case_id !== studentCaseId ||
      data.document_slot_id !== documentSlotId ||
      data.target_kind !== targetKind ||
      data.target_id !== targetId ||
      data.linked !== enabled ||
      !targetMatches ||
      (enabled ? !documentSlotCaseLinkId : data.document_slot_case_link_id !== null) ||
      data.expected_version !== expectedVersion ||
      typeof data.version !== "string" || version(data.version) !== data.version ||
      BigInt(data.version) !== BigInt(expectedVersion) + BigInt(1) ||
      !isTimestamp(data.changed_at) || data.reason !== reason ||
      data.request_id !== requestId
    ) {
      return caseLinkFailureState(
        form,
        "unavailable",
        documentSlotId,
        targetKind,
        targetId,
        requestId,
      );
    }

    revalidateChecklist(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      documentSlotId,
      targetKind,
      targetId,
      version: data.version,
    });
  } catch {
    return caseLinkFailureState(
      form,
      "unavailable",
      documentSlotId,
      targetKind,
      targetId,
      requestId,
    );
  }
}

export async function removePlatformDocumentSlotAction(
  _previous: PlatformDocumentChecklistActionState,
  form: FormData,
): Promise<PlatformDocumentChecklistActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "documents.write")) {
    return failureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, REMOVE_SLOT_FIELDS);
  if (!fields) return failureState(form, "invalid");

  const studentCaseId = uuid(field(fields, "student_case_id"));
  const documentSlotId = uuid(field(fields, "document_slot_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const reason = boundedText(field(fields, "reason"), 1_000);
  const requestId = uuid(field(fields, "request_id"));
  if (
    !studentCaseId || !documentSlotId || !expectedVersion || !reason ||
    !requestId
  ) {
    return failureState(form, "invalid", documentSlotId, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "remove_document_slot",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_document_slot_id: documentSlotId,
        p_expected_version: expectedVersion,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(
        form,
        errorStatus(response.error),
        documentSlotId,
        requestId,
      );
    }
    const data = response.data;
    const nextVersion = isRecord(data) && typeof data.version === "string"
      ? version(data.version)
      : null;
    if (
      !isRecord(data) || !nextVersion ||
      !hasExactKeys(data, [
        "organization_id", "student_case_id", "document_slot_id",
        "intent_kind", "expected_version", "version", "removed_at",
        "removal_reason", "request_id",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.student_case_id !== studentCaseId ||
      data.document_slot_id !== documentSlotId ||
      !isSlotIntent(data.intent_kind) ||
      data.expected_version !== expectedVersion ||
      BigInt(nextVersion) !== BigInt(expectedVersion) + BigInt(1) ||
      !isTimestamp(data.removed_at) || data.removal_reason !== reason ||
      data.request_id !== requestId
    ) {
      return failureState(form, "unavailable", documentSlotId, requestId);
    }
    revalidateChecklist(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      documentSlotId,
      version: nextVersion,
    });
  } catch {
    return failureState(form, "unavailable", documentSlotId, requestId);
  }
}
