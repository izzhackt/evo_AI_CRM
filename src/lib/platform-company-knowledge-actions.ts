"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { fixedRoleCan } from "./fixed-role-policy";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const CREATE_FOLDER_FIELDS = ["parent_folder_id", "name", "request_id"] as const;
const RENAME_FOLDER_FIELDS = ["folder_id", "name", "expected_version", "request_id"] as const;
const MOVE_FOLDER_FIELDS = ["folder_id", "parent_folder_id", "expected_version", "request_id"] as const;
const REMOVE_FOLDER_FIELDS = ["folder_id", "expected_version", "request_id"] as const;
const RENAME_FILE_FIELDS = ["file_id", "name", "expected_version", "request_id"] as const;
const MOVE_FILE_FIELDS = ["file_id", "folder_id", "expected_version", "request_id"] as const;
const REMOVE_FILE_FIELDS = ["file_id", "expected_version", "request_id"] as const;

export type PlatformCompanyKnowledgeActionStatus =
  | "idle" | "saved" | "invalid" | "forbidden" | "stale"
  | "request_conflict" | "unavailable";
export type PlatformCompanyKnowledgeActionState = Readonly<{
  status: PlatformCompanyKnowledgeActionStatus;
  requestId: string;
  itemId: string | null;
  version: string | null;
}>;

type StringFields = ReadonlyMap<string, string>;
type ReceiptKind = "folder" | "file";

function field(fields: StringFields, key: string): string {
  return fields.get(key)?.trim() ?? "";
}
function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === "00000000-0000-0000-0000-000000000000" ? null : normalized;
}
function optionalUuid(value: string): string | null | undefined {
  return value === "" ? null : (uuid(value) ?? undefined);
}
function itemName(value: string, maximum: 160 | 255): string | null {
  return value.length >= 1 && value.length <= maximum && value === value.trim()
      && !CONTROL_CHARACTER_PATTERN.test(value)
      && !value.includes("/") && !value.includes("\\")
    ? value : null;
}
function version(value: unknown): string | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  return value.length < POSTGRES_BIGINT_MAX.length
      || (value.length === POSTGRES_BIGINT_MAX.length && value <= POSTGRES_BIGINT_MAX)
    ? value : null;
}
function responseVersion(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? String(value) : version(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
function timestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function submittedRequestId(form: FormData): string | null {
  const direct = form.getAll("request_id");
  const enveloped = form.getAll("_1_request_id");
  const values = direct.length > 0 ? direct : enveloped;
  return values.length === 1 && typeof values[0] === "string"
    ? uuid(values[0].trim()) : null;
}
function errorStatus(error: unknown): Exclude<PlatformCompanyKnowledgeActionStatus, "idle" | "saved"> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (code === "42501") return "forbidden";
  if (code === "PT409" && /version_conflict/i.test(message)) return "stale";
  if (code === "23505" && /request/i.test(message)) return "request_conflict";
  if (code === "22023" || code === "23503" || code === "23505" || /folder_not_empty|cycle/i.test(message)) {
    return "invalid";
  }
  return "unavailable";
}
function failureState(
  form: FormData,
  status: Exclude<PlatformCompanyKnowledgeActionStatus, "idle" | "saved">,
  itemId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformCompanyKnowledgeActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "stale" || status === "request_conflict"
      ? randomUUID() : (requestId ?? randomUUID()),
    itemId,
    version: null,
  });
}
function successState(itemId: string, nextVersion: string): PlatformCompanyKnowledgeActionState {
  revalidatePath("/v3/knowledge");
  return Object.freeze({ status: "saved", requestId: randomUUID(), itemId, version: nextVersion });
}

function normalizeMutationReceipt(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    kind: ReceiptKind;
    itemId?: string;
    expectedVersion?: string;
    name?: string;
    parentId?: string | null;
    removed?: boolean;
  }>,
): Readonly<{ itemId: string; version: string }> | null {
  const idKey = expected.kind === "folder" ? "folder_id" : "file_id";
  const parentKey = expected.kind === "folder" ? "parent_folder_id" : "folder_id";
  const baseKeys = expected.kind === "folder"
    ? ["organization_id", "folder_id", "parent_folder_id", "name", "version", "created_at", "updated_at"]
    : ["organization_id", "file_id", "folder_id", "name", "version", "current_file_version_id", "current_version_no", "created_at", "updated_at"];
  const keys = expected.removed ? [...baseKeys, "removed_at"] : baseKeys;
  if (!isRecord(value) || !exact(value, keys)) return null;
  const itemId = uuid(value[idKey]);
  const parentId = value[parentKey] === null ? null : uuid(value[parentKey]);
  const nextVersion = responseVersion(value.version);
  if (
    value.organization_id !== expected.organizationId || !itemId || !nextVersion
    || typeof value.name !== "string"
    || !itemName(value.name, expected.kind === "folder" ? 160 : 255)
    || !timestamp(value.created_at) || !timestamp(value.updated_at)
    || (expected.itemId !== undefined && itemId !== expected.itemId)
    || (expected.name !== undefined && value.name !== expected.name)
    || (expected.parentId !== undefined && parentId !== expected.parentId)
    || (expected.expectedVersion !== undefined
      && BigInt(nextVersion) !== BigInt(expected.expectedVersion) + BigInt(1))
    || (expected.expectedVersion === undefined && nextVersion !== "1")
    || (expected.removed === true && !timestamp(value.removed_at))
  ) return null;
  if (expected.kind === "file"
    && (!uuid(value.current_file_version_id) || !responseVersion(value.current_version_no))) {
    return null;
  }
  return Object.freeze({ itemId, version: nextVersion });
}

async function mutate(
  form: FormData,
  input: Readonly<{
    rpc: string;
    args: Readonly<Record<string, unknown>>;
    requestId: string;
    kind: ReceiptKind;
    itemId?: string;
    expectedVersion?: string;
    name?: string;
    parentId?: string | null;
    removed?: boolean;
  }>,
): Promise<PlatformCompanyKnowledgeActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "documents.write")) {
    return failureState(form, "forbidden", input.itemId ?? null, input.requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(input.rpc, input.args);
    if (response.error) {
      return failureState(form, errorStatus(response.error), input.itemId ?? null, input.requestId);
    }
    const receipt = normalizeMutationReceipt(response.data, {
      organizationId: actor.organizationId,
      kind: input.kind,
      itemId: input.itemId,
      expectedVersion: input.expectedVersion,
      name: input.name,
      parentId: input.parentId,
      removed: input.removed,
    });
    return receipt ? successState(receipt.itemId, receipt.version)
      : failureState(form, "unavailable", input.itemId ?? null, input.requestId);
  } catch {
    return failureState(form, "unavailable", input.itemId ?? null, input.requestId);
  }
}

export async function createPlatformCompanyKnowledgeFolderAction(
  _previous: PlatformCompanyKnowledgeActionState,
  form: FormData,
): Promise<PlatformCompanyKnowledgeActionState> {
  const fields = exactActionStringFields(form, CREATE_FOLDER_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const parentId = optionalUuid(field(fields, "parent_folder_id"));
  const folderName = itemName(field(fields, "name"), 160);
  const requestId = uuid(field(fields, "request_id"));
  if (parentId === undefined || !folderName || !requestId) return failureState(form, "invalid", null, requestId);
  return mutate(form, {
    rpc: "create_company_knowledge_folder",
    args: { p_parent_folder_id: parentId, p_name: folderName, p_request_id: requestId },
    requestId, kind: "folder", name: folderName, parentId,
  });
}

export async function renamePlatformCompanyKnowledgeFolderAction(
  _previous: PlatformCompanyKnowledgeActionState,
  form: FormData,
): Promise<PlatformCompanyKnowledgeActionState> {
  const fields = exactActionStringFields(form, RENAME_FOLDER_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const folderId = uuid(field(fields, "folder_id"));
  const folderName = itemName(field(fields, "name"), 160);
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!folderId || !folderName || !expectedVersion || !requestId) return failureState(form, "invalid", folderId, requestId);
  return mutate(form, {
    rpc: "rename_company_knowledge_folder",
    args: { p_folder_id: folderId, p_name: folderName, p_expected_version: expectedVersion, p_request_id: requestId },
    requestId, kind: "folder", itemId: folderId, expectedVersion, name: folderName,
  });
}

export async function movePlatformCompanyKnowledgeFolderAction(
  _previous: PlatformCompanyKnowledgeActionState,
  form: FormData,
): Promise<PlatformCompanyKnowledgeActionState> {
  const fields = exactActionStringFields(form, MOVE_FOLDER_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const folderId = uuid(field(fields, "folder_id"));
  const parentId = optionalUuid(field(fields, "parent_folder_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!folderId || parentId === undefined || !expectedVersion || !requestId) return failureState(form, "invalid", folderId, requestId);
  return mutate(form, {
    rpc: "move_company_knowledge_folder",
    args: { p_folder_id: folderId, p_parent_folder_id: parentId, p_expected_version: expectedVersion, p_request_id: requestId },
    requestId, kind: "folder", itemId: folderId, expectedVersion, parentId,
  });
}

export async function removePlatformCompanyKnowledgeFolderAction(
  _previous: PlatformCompanyKnowledgeActionState,
  form: FormData,
): Promise<PlatformCompanyKnowledgeActionState> {
  const fields = exactActionStringFields(form, REMOVE_FOLDER_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const folderId = uuid(field(fields, "folder_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!folderId || !expectedVersion || !requestId) return failureState(form, "invalid", folderId, requestId);
  return mutate(form, {
    rpc: "remove_company_knowledge_folder",
    args: { p_folder_id: folderId, p_expected_version: expectedVersion, p_request_id: requestId },
    requestId, kind: "folder", itemId: folderId, expectedVersion, removed: true,
  });
}

export async function renamePlatformCompanyKnowledgeFileAction(
  _previous: PlatformCompanyKnowledgeActionState,
  form: FormData,
): Promise<PlatformCompanyKnowledgeActionState> {
  const fields = exactActionStringFields(form, RENAME_FILE_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const fileId = uuid(field(fields, "file_id"));
  const fileName = itemName(field(fields, "name"), 255);
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!fileId || !fileName || !expectedVersion || !requestId) return failureState(form, "invalid", fileId, requestId);
  return mutate(form, {
    rpc: "rename_company_knowledge_file",
    args: { p_file_id: fileId, p_name: fileName, p_expected_version: expectedVersion, p_request_id: requestId },
    requestId, kind: "file", itemId: fileId, expectedVersion, name: fileName,
  });
}

export async function movePlatformCompanyKnowledgeFileAction(
  _previous: PlatformCompanyKnowledgeActionState,
  form: FormData,
): Promise<PlatformCompanyKnowledgeActionState> {
  const fields = exactActionStringFields(form, MOVE_FILE_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const fileId = uuid(field(fields, "file_id"));
  const folderId = optionalUuid(field(fields, "folder_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!fileId || folderId === undefined || !expectedVersion || !requestId) return failureState(form, "invalid", fileId, requestId);
  return mutate(form, {
    rpc: "move_company_knowledge_file",
    args: { p_file_id: fileId, p_folder_id: folderId, p_expected_version: expectedVersion, p_request_id: requestId },
    requestId, kind: "file", itemId: fileId, expectedVersion, parentId: folderId,
  });
}

export async function removePlatformCompanyKnowledgeFileAction(
  _previous: PlatformCompanyKnowledgeActionState,
  form: FormData,
): Promise<PlatformCompanyKnowledgeActionState> {
  const fields = exactActionStringFields(form, REMOVE_FILE_FIELDS);
  if (!fields) return failureState(form, "invalid");
  const fileId = uuid(field(fields, "file_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!fileId || !expectedVersion || !requestId) return failureState(form, "invalid", fileId, requestId);
  return mutate(form, {
    rpc: "remove_company_knowledge_file",
    args: { p_file_id: fileId, p_expected_version: expectedVersion, p_request_id: requestId },
    requestId, kind: "file", itemId: fileId, expectedVersion, removed: true,
  });
}
