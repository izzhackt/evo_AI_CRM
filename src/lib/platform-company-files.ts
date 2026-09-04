import { fixedRoleCan } from "./fixed-role-policy.ts";
import type { PlatformActor } from "./platform-auth.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9]\d*$/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform company-file data is unavailable.";

export const PLATFORM_COMPANY_FILE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export type PlatformCompanyFileMimeType =
  (typeof PLATFORM_COMPANY_FILE_MIME_TYPES)[number];

export type PlatformCompanyFileFolder = Readonly<{
  kind: "folder";
  folderId: string;
  parentFolderId: string | null;
  name: string;
  version: string;
  archivedAt: string | null;
  updatedAt: string;
}>;

export type PlatformCompanyFileVersionSummary = Readonly<{
  companyFileVersionId: string;
  versionNumber: string;
  originalFilename: string;
  declaredMimeType: PlatformCompanyFileMimeType;
  byteSize: number;
  sha256Hex: string;
  finalizedAt: string;
}>;

export type PlatformCompanyFile = Readonly<{
  kind: "file";
  companyFileId: string;
  folderId: string | null;
  displayName: string;
  version: string;
  archivedAt: string | null;
  currentVersion: PlatformCompanyFileVersionSummary | null;
  downloadReady: boolean;
  updatedAt: string;
}>;

export type PlatformCompanyFileWorkspace = Readonly<{
  folders: readonly PlatformCompanyFileFolder[];
  files: readonly PlatformCompanyFile[];
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformCompanyFilesRpcClient = Readonly<{
  schema(name: "platform"): Readonly<{
    rpc(
      name: "staff_company_file_workspace",
      args: Readonly<{ p_organization_id: string }>,
      options: Readonly<{ get: true }>,
    ): Promise<RpcResponse>;
  }>;
}>;

export type PlatformCompanyFilesDependencies = Readonly<{
  client?: PlatformCompanyFilesRpcClient;
}>;

export class PlatformCompanyFilesRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCompanyFilesRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformCompanyFilesRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformCompanyFilesRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  return value.toLowerCase();
}

function optionalUuid(value: unknown): string | null {
  if (value === null) return null;
  return requiredUuid(value);
}

function boundedText(value: unknown, maximum = 255): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > maximum ||
    new TextEncoder().encode(value).byteLength > 1_024 ||
    value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

function positiveBigint(value: unknown): string {
  if (typeof value !== "string" || !POSITIVE_BIGINT_PATTERN.test(value)) {
    return invalidShape();
  }
  return value;
}

function positiveSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return invalidShape();
  }
  return value as number;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMPTZ_PATTERN.test(value)) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return timestamp(value);
}

function companyMimeType(value: unknown): PlatformCompanyFileMimeType {
  if (
    typeof value !== "string" ||
    !(PLATFORM_COMPANY_FILE_MIME_TYPES as readonly string[]).includes(value)
  ) {
    return invalidShape();
  }
  return value as PlatformCompanyFileMimeType;
}

const WORKSPACE_ROW_KEYS = [
  "item_kind",
  "item_id",
  "parent_folder_id",
  "display_name",
  "entity_version",
  "archived_at",
  "current_version_id",
  "current_version_no",
  "original_filename",
  "declared_mime_type",
  "byte_size",
  "sha256_hex",
  "finalized_at",
  "updated_at",
] as const;

export function normalizePlatformCompanyFileWorkspaceRow(
  value: unknown,
): PlatformCompanyFileFolder | PlatformCompanyFile {
  if (!isRecord(value) || !exactKeys(value, WORKSPACE_ROW_KEYS)) {
    return invalidShape();
  }
  const kind = value.item_kind;
  const itemId = requiredUuid(value.item_id);
  const parentFolderId = optionalUuid(value.parent_folder_id);
  const displayName = boundedText(value.display_name);
  const version = positiveBigint(value.entity_version);
  const archivedAt = optionalTimestamp(value.archived_at);
  const updatedAt = timestamp(value.updated_at);

  if (kind === "folder") {
    if (
      value.current_version_id !== null || value.current_version_no !== null ||
      value.original_filename !== null || value.declared_mime_type !== null ||
      value.byte_size !== null || value.sha256_hex !== null ||
      value.finalized_at !== null
    ) {
      return invalidShape();
    }
    return Object.freeze({
      kind,
      folderId: itemId,
      parentFolderId,
      name: displayName,
      version,
      archivedAt,
      updatedAt,
    });
  }

  if (kind !== "file") return invalidShape();
  const currentVersionFields = [
    value.current_version_id,
    value.current_version_no,
    value.original_filename,
    value.declared_mime_type,
    value.byte_size,
    value.sha256_hex,
    value.finalized_at,
  ];
  const hasNoCurrentVersion = currentVersionFields.every((field) => field === null);
  const hasCompleteCurrentVersion = currentVersionFields.every(
    (field) => field !== null,
  );
  if (!hasNoCurrentVersion && !hasCompleteCurrentVersion) return invalidShape();

  const currentVersion = hasNoCurrentVersion
    ? null
    : Object.freeze({
      companyFileVersionId: requiredUuid(value.current_version_id),
      versionNumber: positiveBigint(value.current_version_no),
      originalFilename: boundedText(value.original_filename),
      declaredMimeType: companyMimeType(value.declared_mime_type),
      byteSize: positiveSafeInteger(value.byte_size),
      sha256Hex: typeof value.sha256_hex === "string" &&
          SHA256_PATTERN.test(value.sha256_hex)
        ? value.sha256_hex
        : invalidShape(),
      finalizedAt: timestamp(value.finalized_at),
    });

  return Object.freeze({
    kind,
    companyFileId: itemId,
    folderId: parentFolderId,
    displayName,
    version,
    archivedAt,
    currentVersion,
    downloadReady: currentVersion !== null && archivedAt === null,
    updatedAt,
  });
}

export function normalizePlatformCompanyFileWorkspace(
  value: unknown,
): PlatformCompanyFileWorkspace {
  if (!Array.isArray(value)) return invalidShape();
  const folders: PlatformCompanyFileFolder[] = [];
  const files: PlatformCompanyFile[] = [];
  const ids = new Set<string>();
  for (const rawRow of value) {
    const row = normalizePlatformCompanyFileWorkspaceRow(rawRow);
    const id = row.kind === "folder" ? row.folderId : row.companyFileId;
    if (ids.has(id)) return invalidShape();
    ids.add(id);
    if (row.kind === "folder") folders.push(row);
    else files.push(row);
  }

  const folderIds = new Set(folders.map((folder) => folder.folderId));
  const parentByFolderId = new Map(
    folders.map((folder) => [folder.folderId, folder.parentFolderId] as const),
  );
  for (const folder of folders) {
    if (
      folder.parentFolderId === folder.folderId ||
      (folder.parentFolderId !== null && !folderIds.has(folder.parentFolderId))
    ) {
      return invalidShape();
    }
    const visited = new Set<string>([folder.folderId]);
    let parentId = folder.parentFolderId;
    while (parentId !== null) {
      if (visited.has(parentId)) return invalidShape();
      visited.add(parentId);
      parentId = parentByFolderId.get(parentId) ?? null;
    }
  }
  for (const file of files) {
    if (file.folderId !== null && !folderIds.has(file.folderId)) {
      return invalidShape();
    }
  }

  return Object.freeze({
    folders: Object.freeze(folders),
    files: Object.freeze(files),
  });
}

function requireCompanyFileReader(actor: PlatformActor): string {
  if (!fixedRoleCan(actor.authorityRole, "documents.read")) {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

async function getPlatformClient(): Promise<PlatformCompanyFilesRpcClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as PlatformCompanyFilesRpcClient;
}

export async function getPlatformCompanyFileWorkspace(
  actor: PlatformActor,
  dependencies: PlatformCompanyFilesDependencies = {},
): Promise<PlatformCompanyFileWorkspace> {
  try {
    const organizationId = requireCompanyFileReader(actor);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_company_file_workspace",
      { p_organization_id: organizationId },
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizePlatformCompanyFileWorkspace(response.data);
  } catch (error) {
    return failClosed(error);
  }
}
