"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { fixedRoleCan } from "./fixed-role-policy";
import type { PlatformAdmissionsActionStatus } from "./platform-admissions-task-actions";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9]\d*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

const CREATE_FOLDER_FIELDS = ["parent_folder_id", "name", "request_id"] as const;
const RENAME_FOLDER_FIELDS = [
  "folder_id",
  "expected_version",
  "name",
  "request_id",
] as const;
const MOVE_FOLDER_FIELDS = [
  "folder_id",
  "expected_version",
  "new_parent_folder_id",
  "request_id",
] as const;
const ARCHIVE_FOLDER_FIELDS = [
  "folder_id",
  "expected_version",
  "request_id",
] as const;
const CREATE_FILE_FIELDS = ["folder_id", "display_name", "request_id"] as const;
const RENAME_FILE_FIELDS = [
  "company_file_id",
  "expected_version",
  "display_name",
  "request_id",
] as const;
const MOVE_FILE_FIELDS = [
  "company_file_id",
  "expected_version",
  "folder_id",
  "request_id",
] as const;
const ARCHIVE_FILE_FIELDS = [
  "company_file_id",
  "expected_version",
  "request_id",
] as const;

export type PlatformCompanyFileActionState = Readonly<{
  status: PlatformAdmissionsActionStatus;
  requestId: string;
  itemKind: "folder" | "file" | null;
  itemId: string | null;
  version: string | null;
  archivedAt: string | null;
}>;

type Fields = ReadonlyMap<string, string>;

function field(fields: Fields, key: string): string {
  return fields.get(key)?.trim() ?? "";
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function optionalUuid(value: string): string | null | undefined {
  return value === "" ? null : (uuid(value) ?? undefined);
}

function text(value: string, maximum: number): string | null {
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= maximum &&
      new TextEncoder().encode(normalized).byteLength <= 1_024 &&
      !CONTROL_CHARACTER_PATTERN.test(normalized)
    ? normalized
    : null;
}

function version(value: unknown): string | null {
  return typeof value === "string" && POSITIVE_BIGINT_PATTERN.test(value)
    ? value
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && TIMESTAMPTZ_PATTERN.test(value)
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function errorStatus(error: unknown): Exclude<
  PlatformAdmissionsActionStatus,
  "idle" | "saved"
> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "42501") return "forbidden";
  if (
    code === "40001" ||
    (code === "PT409" && /changed|version_conflict/i.test(message))
  ) {
    return "stale";
  }
  if ((code === "22023" || code === "23505") && /request_id/i.test(message)) {
    return "request_conflict";
  }
  if (code === "22023") return "invalid";
  return "unavailable";
}

function submittedRequestId(form: FormData): string | null {
  const direct = form.getAll("request_id");
  const enveloped = form.getAll("_1_request_id");
  const values = direct.length > 0 ? direct : enveloped;
  const candidate = values.length === 1 ? values[0] : null;
  return uuid(candidate);
}

function failureState(
  form: FormData,
  status: Exclude<PlatformAdmissionsActionStatus, "idle" | "saved">,
  itemKind: "folder" | "file" | null = null,
  itemId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformCompanyFileActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    itemKind,
    itemId,
    version: null,
    archivedAt: null,
  });
}

function successState(
  itemKind: "folder" | "file",
  itemId: string,
  versionValue: string,
  archivedAt: string | null,
): PlatformCompanyFileActionState {
  revalidatePath("/v3/knowledge");
  return Object.freeze({
    status: "saved",
    requestId: randomUUID(),
    itemKind,
    itemId,
    version: versionValue,
    archivedAt,
  });
}

const FOLDER_RESULT_KEYS = [
  "organization_id",
  "folder_id",
  "parent_folder_id",
  "name",
  "version",
  "archived_at",
  "created_at",
  "updated_at",
] as const;

const FILE_RESULT_KEYS = [
  "organization_id",
  "company_file_id",
  "folder_id",
  "display_name",
  "current_version_id",
  "version",
  "archived_at",
  "created_at",
  "updated_at",
] as const;

function verifiedFolderResult(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    folderId?: string;
    parentFolderId?: string | null;
    name?: string;
    previousVersion?: string;
    archived: boolean;
  }>,
): Readonly<{ folderId: string; version: string; archivedAt: string | null }> | null {
  if (!isRecord(value) || !hasExactKeys(value, FOLDER_RESULT_KEYS)) return null;
  const organizationId = uuid(value.organization_id);
  const folderId = uuid(value.folder_id);
  const parentFolderId = value.parent_folder_id === null
    ? null
    : uuid(value.parent_folder_id);
  const nextVersion = version(value.version);
  const archivedAt = value.archived_at === null ? null : timestamp(value.archived_at);
  if (
    organizationId !== expected.organizationId || !folderId || !nextVersion ||
    (value.parent_folder_id !== null && !parentFolderId) ||
    (expected.folderId !== undefined && folderId !== expected.folderId) ||
    (expected.parentFolderId !== undefined &&
      parentFolderId !== expected.parentFolderId) ||
    (expected.name !== undefined && value.name !== expected.name) ||
    typeof value.name !== "string" || !text(value.name, 255) ||
    !timestamp(value.created_at) || !timestamp(value.updated_at) ||
    (expected.archived ? archivedAt === null : archivedAt !== null) ||
    (expected.previousVersion !== undefined &&
      BigInt(nextVersion) !== BigInt(expected.previousVersion) + BigInt(1))
  ) {
    return null;
  }
  return Object.freeze({ folderId, version: nextVersion, archivedAt });
}

function verifiedFileResult(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    companyFileId?: string;
    folderId?: string | null;
    displayName?: string;
    currentVersionId?: string | null;
    previousVersion?: string;
    archived: boolean;
  }>,
): Readonly<{
  companyFileId: string;
  version: string;
  currentVersionId: string | null;
  archivedAt: string | null;
}> | null {
  if (!isRecord(value) || !hasExactKeys(value, FILE_RESULT_KEYS)) return null;
  const organizationId = uuid(value.organization_id);
  const companyFileId = uuid(value.company_file_id);
  const folderId = value.folder_id === null ? null : uuid(value.folder_id);
  const currentVersionId = value.current_version_id === null
    ? null
    : uuid(value.current_version_id);
  const nextVersion = version(value.version);
  const archivedAt = value.archived_at === null ? null : timestamp(value.archived_at);
  if (
    organizationId !== expected.organizationId || !companyFileId || !nextVersion ||
    (value.folder_id !== null && !folderId) ||
    (value.current_version_id !== null && !currentVersionId) ||
    (expected.companyFileId !== undefined &&
      companyFileId !== expected.companyFileId) ||
    (expected.folderId !== undefined && folderId !== expected.folderId) ||
    (expected.displayName !== undefined &&
      value.display_name !== expected.displayName) ||
    (expected.currentVersionId !== undefined &&
      currentVersionId !== expected.currentVersionId) ||
    typeof value.display_name !== "string" || !text(value.display_name, 255) ||
    !timestamp(value.created_at) || !timestamp(value.updated_at) ||
    (expected.archived ? archivedAt === null : archivedAt !== null) ||
    (expected.previousVersion !== undefined &&
      BigInt(nextVersion) !== BigInt(expected.previousVersion) + BigInt(1))
  ) {
    return null;
  }
  return Object.freeze({
    companyFileId,
    version: nextVersion,
    currentVersionId,
    archivedAt,
  });
}

async function writableActor(form: FormData) {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "documents.write")) {
    return { actor: null, failure: failureState(form, "forbidden") } as const;
  }
  return { actor, failure: null } as const;
}

export async function createPlatformCompanyFileFolderAction(
  _previous: PlatformCompanyFileActionState,
  form: FormData,
): Promise<PlatformCompanyFileActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, CREATE_FOLDER_FIELDS);
  if (!fields) return failureState(form, "invalid", "folder");
  const parentFolderId = optionalUuid(field(fields, "parent_folder_id"));
  const name = text(field(fields, "name"), 255);
  const requestId = uuid(field(fields, "request_id"));
  if (parentFolderId === undefined || !name || !requestId) {
    return failureState(form, "invalid", "folder", null, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "create_company_file_folder",
      {
        p_organization_id: authorization.actor.organizationId,
        p_parent_folder_id: parentFolderId,
        p_name: name,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(form, errorStatus(response.error), "folder", null, requestId);
    }
    const result = verifiedFolderResult(response.data, {
      organizationId: authorization.actor.organizationId,
      parentFolderId,
      name,
      archived: false,
    });
    if (!result || result.version !== "1") {
      return failureState(form, "unavailable", "folder", null, requestId);
    }
    return successState("folder", result.folderId, result.version, null);
  } catch {
    return failureState(form, "unavailable", "folder", null, requestId);
  }
}

export async function renamePlatformCompanyFileFolderAction(
  _previous: PlatformCompanyFileActionState,
  form: FormData,
): Promise<PlatformCompanyFileActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, RENAME_FOLDER_FIELDS);
  if (!fields) return failureState(form, "invalid", "folder");
  const folderId = uuid(field(fields, "folder_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const name = text(field(fields, "name"), 255);
  const requestId = uuid(field(fields, "request_id"));
  if (!folderId || !expectedVersion || !name || !requestId) {
    return failureState(form, "invalid", "folder", folderId, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "rename_company_file_folder",
      {
        p_organization_id: authorization.actor.organizationId,
        p_folder_id: folderId,
        p_expected_version: expectedVersion,
        p_name: name,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(form, errorStatus(response.error), "folder", folderId, requestId);
    }
    const result = verifiedFolderResult(response.data, {
      organizationId: authorization.actor.organizationId,
      folderId,
      name,
      previousVersion: expectedVersion,
      archived: false,
    });
    return result
      ? successState("folder", folderId, result.version, null)
      : failureState(form, "unavailable", "folder", folderId, requestId);
  } catch {
    return failureState(form, "unavailable", "folder", folderId, requestId);
  }
}

export async function movePlatformCompanyFileFolderAction(
  _previous: PlatformCompanyFileActionState,
  form: FormData,
): Promise<PlatformCompanyFileActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, MOVE_FOLDER_FIELDS);
  if (!fields) return failureState(form, "invalid", "folder");
  const folderId = uuid(field(fields, "folder_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const parentFolderId = optionalUuid(field(fields, "new_parent_folder_id"));
  const requestId = uuid(field(fields, "request_id"));
  if (!folderId || !expectedVersion || parentFolderId === undefined || !requestId) {
    return failureState(form, "invalid", "folder", folderId, requestId);
  }
  if (folderId === parentFolderId) {
    return failureState(form, "invalid", "folder", folderId, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "move_company_file_folder",
      {
        p_organization_id: authorization.actor.organizationId,
        p_folder_id: folderId,
        p_expected_version: expectedVersion,
        p_new_parent_folder_id: parentFolderId,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(form, errorStatus(response.error), "folder", folderId, requestId);
    }
    const result = verifiedFolderResult(response.data, {
      organizationId: authorization.actor.organizationId,
      folderId,
      parentFolderId,
      previousVersion: expectedVersion,
      archived: false,
    });
    return result
      ? successState("folder", folderId, result.version, null)
      : failureState(form, "unavailable", "folder", folderId, requestId);
  } catch {
    return failureState(form, "unavailable", "folder", folderId, requestId);
  }
}

export async function archivePlatformCompanyFileFolderAction(
  _previous: PlatformCompanyFileActionState,
  form: FormData,
): Promise<PlatformCompanyFileActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, ARCHIVE_FOLDER_FIELDS);
  if (!fields) return failureState(form, "invalid", "folder");
  const folderId = uuid(field(fields, "folder_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!folderId || !expectedVersion || !requestId) {
    return failureState(form, "invalid", "folder", folderId, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "archive_company_file_folder",
      {
        p_organization_id: authorization.actor.organizationId,
        p_folder_id: folderId,
        p_expected_version: expectedVersion,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return failureState(form, errorStatus(response.error), "folder", folderId, requestId);
    }
    const result = verifiedFolderResult(response.data, {
      organizationId: authorization.actor.organizationId,
      folderId,
      previousVersion: expectedVersion,
      archived: true,
    });
    return result
      ? successState("folder", folderId, result.version, result.archivedAt)
      : failureState(form, "unavailable", "folder", folderId, requestId);
  } catch {
    return failureState(form, "unavailable", "folder", folderId, requestId);
  }
}

export async function createPlatformCompanyFileAction(
  _previous: PlatformCompanyFileActionState,
  form: FormData,
): Promise<PlatformCompanyFileActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, CREATE_FILE_FIELDS);
  if (!fields) return failureState(form, "invalid", "file");
  const folderId = optionalUuid(field(fields, "folder_id"));
  const displayName = text(field(fields, "display_name"), 255);
  const requestId = uuid(field(fields, "request_id"));
  if (folderId === undefined || !displayName || !requestId) {
    return failureState(form, "invalid", "file", null, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("create_company_file", {
      p_organization_id: authorization.actor.organizationId,
      p_folder_id: folderId,
      p_display_name: displayName,
      p_request_id: requestId,
    });
    if (response.error) {
      return failureState(form, errorStatus(response.error), "file", null, requestId);
    }
    const result = verifiedFileResult(response.data, {
      organizationId: authorization.actor.organizationId,
      folderId,
      displayName,
      currentVersionId: null,
      archived: false,
    });
    if (!result || result.version !== "1") {
      return failureState(form, "unavailable", "file", null, requestId);
    }
    return successState("file", result.companyFileId, result.version, null);
  } catch {
    return failureState(form, "unavailable", "file", null, requestId);
  }
}

export async function renamePlatformCompanyFileAction(
  _previous: PlatformCompanyFileActionState,
  form: FormData,
): Promise<PlatformCompanyFileActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, RENAME_FILE_FIELDS);
  if (!fields) return failureState(form, "invalid", "file");
  const companyFileId = uuid(field(fields, "company_file_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const displayName = text(field(fields, "display_name"), 255);
  const requestId = uuid(field(fields, "request_id"));
  if (!companyFileId || !expectedVersion || !displayName || !requestId) {
    return failureState(form, "invalid", "file", companyFileId, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("rename_company_file", {
      p_organization_id: authorization.actor.organizationId,
      p_company_file_id: companyFileId,
      p_expected_version: expectedVersion,
      p_display_name: displayName,
      p_request_id: requestId,
    });
    if (response.error) {
      return failureState(form, errorStatus(response.error), "file", companyFileId, requestId);
    }
    const result = verifiedFileResult(response.data, {
      organizationId: authorization.actor.organizationId,
      companyFileId,
      displayName,
      previousVersion: expectedVersion,
      archived: false,
    });
    return result
      ? successState("file", companyFileId, result.version, null)
      : failureState(form, "unavailable", "file", companyFileId, requestId);
  } catch {
    return failureState(form, "unavailable", "file", companyFileId, requestId);
  }
}

export async function movePlatformCompanyFileAction(
  _previous: PlatformCompanyFileActionState,
  form: FormData,
): Promise<PlatformCompanyFileActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, MOVE_FILE_FIELDS);
  if (!fields) return failureState(form, "invalid", "file");
  const companyFileId = uuid(field(fields, "company_file_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const folderId = optionalUuid(field(fields, "folder_id"));
  const requestId = uuid(field(fields, "request_id"));
  if (!companyFileId || !expectedVersion || folderId === undefined || !requestId) {
    return failureState(form, "invalid", "file", companyFileId, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("move_company_file", {
      p_organization_id: authorization.actor.organizationId,
      p_company_file_id: companyFileId,
      p_expected_version: expectedVersion,
      p_new_folder_id: folderId,
      p_request_id: requestId,
    });
    if (response.error) {
      return failureState(form, errorStatus(response.error), "file", companyFileId, requestId);
    }
    const result = verifiedFileResult(response.data, {
      organizationId: authorization.actor.organizationId,
      companyFileId,
      folderId,
      previousVersion: expectedVersion,
      archived: false,
    });
    return result
      ? successState("file", companyFileId, result.version, null)
      : failureState(form, "unavailable", "file", companyFileId, requestId);
  } catch {
    return failureState(form, "unavailable", "file", companyFileId, requestId);
  }
}

export async function archivePlatformCompanyFileAction(
  _previous: PlatformCompanyFileActionState,
  form: FormData,
): Promise<PlatformCompanyFileActionState> {
  const authorization = await writableActor(form);
  if (!authorization.actor) return authorization.failure;
  const fields = exactActionStringFields(form, ARCHIVE_FILE_FIELDS);
  if (!fields) return failureState(form, "invalid", "file");
  const companyFileId = uuid(field(fields, "company_file_id"));
  const expectedVersion = version(field(fields, "expected_version"));
  const requestId = uuid(field(fields, "request_id"));
  if (!companyFileId || !expectedVersion || !requestId) {
    return failureState(form, "invalid", "file", companyFileId, requestId);
  }
  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("archive_company_file", {
      p_organization_id: authorization.actor.organizationId,
      p_company_file_id: companyFileId,
      p_expected_version: expectedVersion,
      p_request_id: requestId,
    });
    if (response.error) {
      return failureState(form, errorStatus(response.error), "file", companyFileId, requestId);
    }
    const result = verifiedFileResult(response.data, {
      organizationId: authorization.actor.organizationId,
      companyFileId,
      previousVersion: expectedVersion,
      archived: true,
    });
    return result
      ? successState("file", companyFileId, result.version, result.archivedAt)
      : failureState(form, "unavailable", "file", companyFileId, requestId);
  } catch {
    return failureState(form, "unavailable", "file", companyFileId, requestId);
  }
}
