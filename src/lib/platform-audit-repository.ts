import {
  normalizePlatformAuditExportResult,
  normalizePlatformAuditSearchResult,
  PlatformAuditContractError,
  type PlatformAuditExportInput,
  type PlatformAuditExportResult,
  type PlatformAuditFilters,
  type PlatformAuditSearchInput,
  type PlatformAuditSearchResult,
} from "./platform-audit.ts";

type PlatformAuditRpcResponse = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type PlatformAuditRpcClient = Readonly<{
  schema(name: "platform"): Readonly<{
    rpc(name: string, args: Record<string, unknown>): PromiseLike<PlatformAuditRpcResponse>;
  }>;
}>;

export type PlatformAuditRepository = Readonly<{
  search(input: PlatformAuditSearchInput): Promise<PlatformAuditSearchResult>;
  export(input: PlatformAuditExportInput): Promise<PlatformAuditExportResult>;
}>;

export type PlatformAuditRepositoryErrorKind =
  | "unauthorized"
  | "invalid"
  | "too_large"
  | "unavailable"
  | "invalid_response";

export class PlatformAuditRepositoryError extends Error {
  readonly kind: PlatformAuditRepositoryErrorKind;

  constructor(kind: PlatformAuditRepositoryErrorKind) {
    super("Platform audit request failed");
    this.name = "PlatformAuditRepositoryError";
    this.kind = kind;
  }
}

function repositoryError(kind: PlatformAuditRepositoryErrorKind): never {
  throw new PlatformAuditRepositoryError(kind);
}

function providerErrorKind(error: unknown): PlatformAuditRepositoryErrorKind {
  if (typeof error !== "object" || error === null) return "unavailable";
  const code = (error as { code?: unknown }).code;
  if (code === "42501") return "unauthorized";
  if (code === "22023") return "invalid";
  if (code === "54000") return "too_large";
  return "unavailable";
}

function sameNullableList(
  left: readonly string[] | null,
  right: readonly string[] | null,
): boolean {
  return (
    (left === null && right === null) ||
    (left !== null &&
      right !== null &&
      left.length === right.length &&
      left.every((item, index) => item === right[index]))
  );
}

function sameFilters(
  result: PlatformAuditFilters,
  input: PlatformAuditFilters,
): boolean {
  return (
    result.startAt === input.startAt &&
    result.endAt === input.endAt &&
    sameNullableList(result.actions, input.actions) &&
    sameNullableList(result.resourceTypes, input.resourceTypes) &&
    result.resourceId === input.resourceId
  );
}

async function callRpc(
  client: PlatformAuditRpcClient,
  name: "search_audit_events" | "export_audit_events",
  args: Record<string, unknown>,
): Promise<unknown> {
  let response: PlatformAuditRpcResponse;
  try {
    response = await client.schema("platform").rpc(name, args);
  } catch {
    return repositoryError("unavailable");
  }
  if (response.error) return repositoryError(providerErrorKind(response.error));
  return response.data;
}

export function createPlatformAuditRepository(
  client: PlatformAuditRpcClient,
): PlatformAuditRepository {
  return {
    async search(input) {
      const data = await callRpc(client, "search_audit_events", {
        p_start_at: input.startAt,
        p_end_at: input.endAt,
        p_actions: input.actions,
        p_resource_types: input.resourceTypes,
        p_resource_id: input.resourceId,
        p_page_size: input.pageSize,
        p_snapshot_created_at: input.snapshotCreatedAt,
        p_snapshot_id: input.snapshotId,
        p_cursor_created_at: input.cursorCreatedAt,
        p_cursor_id: input.cursorId,
      });
      try {
        const result = normalizePlatformAuditSearchResult(data);
        if (
          !sameFilters(result.filters, input) ||
          (input.snapshotCreatedAt !== null &&
            (result.snapshotCreatedAt !== input.snapshotCreatedAt ||
              result.snapshotId !== input.snapshotId))
        ) {
          return repositoryError("invalid_response");
        }
        return result;
      } catch (error) {
        if (error instanceof PlatformAuditRepositoryError) throw error;
        if (error instanceof PlatformAuditContractError) {
          return repositoryError("invalid_response");
        }
        return repositoryError("unavailable");
      }
    },

    async export(input) {
      const data = await callRpc(client, "export_audit_events", {
        p_request_id: input.requestId,
        p_start_at: input.startAt,
        p_end_at: input.endAt,
        p_actions: input.actions,
        p_resource_types: input.resourceTypes,
        p_resource_id: input.resourceId,
        p_snapshot_created_at: input.snapshotCreatedAt,
        p_snapshot_id: input.snapshotId,
      });
      try {
        const result = normalizePlatformAuditExportResult(data);
        if (
          result.requestId !== input.requestId ||
          !sameFilters(result.filters, input) ||
          (input.snapshotCreatedAt !== null &&
            (result.snapshotCreatedAt !== input.snapshotCreatedAt ||
              result.snapshotId !== input.snapshotId))
        ) {
          return repositoryError("invalid_response");
        }
        return result;
      } catch (error) {
        if (error instanceof PlatformAuditRepositoryError) throw error;
        if (error instanceof PlatformAuditContractError) {
          return repositoryError("invalid_response");
        }
        return repositoryError("unavailable");
      }
    },
  };
}

export async function createAuthenticatedPlatformAuditRepository(): Promise<PlatformAuditRepository> {
  const { createSupabaseServerClient } = await import("./supabase/server");
  const client = await createSupabaseServerClient();
  return createPlatformAuditRepository(client as unknown as PlatformAuditRpcClient);
}
