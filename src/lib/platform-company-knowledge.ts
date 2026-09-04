import { fixedRoleCan } from "./fixed-role-policy.ts";
import type { PlatformActor } from "./platform-auth.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform company knowledge is unavailable.";

export const PLATFORM_COMPANY_KNOWLEDGE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export type PlatformCompanyKnowledgeMimeType =
  (typeof PLATFORM_COMPANY_KNOWLEDGE_MIME_TYPES)[number];

export type PlatformCompanyKnowledgeFolder = Readonly<{
  organizationId: string;
  folderId: string;
  parentFolderId: string | null;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformCompanyKnowledgeFile = Readonly<{
  organizationId: string;
  fileId: string;
  folderId: string | null;
  name: string;
  version: number;
  currentFileVersionId: string;
  currentVersionNumber: number;
  contentType: PlatformCompanyKnowledgeMimeType;
  byteSize: number;
  sha256Hex: string;
  createdAt: string;
  updatedAt: string;
  currentVersionCreatedAt: string;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
export type PlatformCompanyKnowledgeRpcClient = Readonly<{
  schema(schema: "platform"): Readonly<{
    rpc(
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ): PromiseLike<RpcResponse>;
  }>;
}>;
export type PlatformCompanyKnowledgeDependencies = Readonly<{
  client?: PlatformCompanyKnowledgeRpcClient;
}>;

export class PlatformCompanyKnowledgeRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCompanyKnowledgeRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformCompanyKnowledgeRepositoryError();
}
function failClosed(error: unknown): never {
  if (error instanceof PlatformCompanyKnowledgeRepositoryError) throw error;
  return invalidShape();
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
function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalidShape();
  const normalized = value.toLowerCase();
  return normalized === "00000000-0000-0000-0000-000000000000"
    ? invalidShape()
    : normalized;
}
function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}
function boundedText(value: unknown, maximum = 255): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)
  ) return invalidShape();
  return value;
}
function positiveInteger(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : invalidShape();
}
function timestamp(value: unknown): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : invalidShape();
}
function contentType(value: unknown): PlatformCompanyKnowledgeMimeType {
  return typeof value === "string"
      && (PLATFORM_COMPANY_KNOWLEDGE_MIME_TYPES as readonly string[]).includes(value)
    ? value as PlatformCompanyKnowledgeMimeType
    : invalidShape();
}
function sha256(value: unknown): string {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value
    : invalidShape();
}

function normalizeFolder(
  value: unknown,
  organizationId: string,
): PlatformCompanyKnowledgeFolder {
  if (!isRecord(value) || !exact(value, [
    "organization_id", "folder_id", "parent_folder_id", "name", "version",
    "created_at", "updated_at",
  ])) return invalidShape();
  const folderId = requiredUuid(value.folder_id);
  const parentFolderId = optionalUuid(value.parent_folder_id);
  if (requiredUuid(value.organization_id) !== organizationId || parentFolderId === folderId) {
    return invalidShape();
  }
  return Object.freeze({
    organizationId,
    folderId,
    parentFolderId,
    name: boundedText(value.name, 160),
    version: positiveInteger(value.version),
    createdAt: timestamp(value.created_at),
    updatedAt: timestamp(value.updated_at),
  });
}

function normalizeFile(
  value: unknown,
  organizationId: string,
): PlatformCompanyKnowledgeFile {
  if (!isRecord(value) || !exact(value, [
    "organization_id", "file_id", "folder_id", "name", "version",
    "current_file_version_id", "current_version_no", "content_type", "byte_size",
    "sha256_hex", "created_at", "updated_at", "current_version_created_at",
  ])) return invalidShape();
  if (requiredUuid(value.organization_id) !== organizationId) return invalidShape();
  return Object.freeze({
    organizationId,
    fileId: requiredUuid(value.file_id),
    folderId: optionalUuid(value.folder_id),
    name: boundedText(value.name),
    version: positiveInteger(value.version),
    currentFileVersionId: requiredUuid(value.current_file_version_id),
    currentVersionNumber: positiveInteger(value.current_version_no),
    contentType: contentType(value.content_type),
    byteSize: positiveInteger(value.byte_size),
    sha256Hex: sha256(value.sha256_hex),
    createdAt: timestamp(value.created_at),
    updatedAt: timestamp(value.updated_at),
    currentVersionCreatedAt: timestamp(value.current_version_created_at),
  });
}

function requireReader(actor: PlatformActor): string {
  if (!fixedRoleCan(actor.authorityRole, "documents.read")) return invalidShape();
  return requiredUuid(actor.organizationId);
}
async function platformClient(): Promise<PlatformCompanyKnowledgeRpcClient> {
  const { createSupabaseServerClient } = await import("./supabase/server.ts");
  return createSupabaseServerClient();
}
function normalizeRows<T>(
  value: unknown,
  normalize: (row: unknown) => T,
  identity: (row: T) => string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > 10_000) return invalidShape();
  const rows = Object.freeze(value.map(normalize));
  const ids = rows.map(identity);
  if (new Set(ids).size !== ids.length) return invalidShape();
  return rows;
}

export async function listPlatformCompanyKnowledgeFolders(
  actor: PlatformActor,
  dependencies: PlatformCompanyKnowledgeDependencies = {},
): Promise<readonly PlatformCompanyKnowledgeFolder[]> {
  try {
    const organizationId = requireReader(actor);
    const client = dependencies.client ?? await platformClient();
    const response = await client.schema("platform").rpc(
      "list_company_knowledge_folders", {}, { get: true },
    );
    if (response.error) return invalidShape();
    return normalizeRows(
      response.data,
      (row) => normalizeFolder(row, organizationId),
      (row) => row.folderId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformCompanyKnowledgeFiles(
  actor: PlatformActor,
  dependencies: PlatformCompanyKnowledgeDependencies = {},
): Promise<readonly PlatformCompanyKnowledgeFile[]> {
  try {
    const organizationId = requireReader(actor);
    const client = dependencies.client ?? await platformClient();
    const response = await client.schema("platform").rpc(
      "list_company_knowledge_files", {}, { get: true },
    );
    if (response.error) return invalidShape();
    return normalizeRows(
      response.data,
      (row) => normalizeFile(row, organizationId),
      (row) => row.fileId,
    );
  } catch (error) {
    return failClosed(error);
  }
}
