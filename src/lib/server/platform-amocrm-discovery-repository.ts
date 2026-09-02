import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  CanonicalAmoCrmDiscoveryRepositoryError,
  type CanonicalAmoCrmDiscoveryPersistenceInput,
  type CanonicalAmoCrmDiscoveryPersistenceResult,
  type CanonicalAmoCrmDiscoveryRepository,
} from "./canonical-amocrm-discovery-contract.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROVIDER_ID_PATTERN = /^[1-9][0-9]{0,18}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const EVIDENCE_PREFIX = "provider:amocrm:api-v4:routing-v2:";

export type PlatformAmoCrmDiscoveryRpcClient = Readonly<{
  schema: (schema: string) => Readonly<{
    rpc: (
      name: string,
      args: Readonly<Record<string, unknown>>,
    ) => PromiseLike<Readonly<{ data: unknown; error: unknown }>>;
  }>;
}>;

type RepositoryOptions = Readonly<{
  organizationId: string;
  client?: PlatformAmoCrmDiscoveryRpcClient;
}>;

function persistenceFailure(): never {
  throw new CanonicalAmoCrmDiscoveryRepositoryError("persistence_failed");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return persistenceFailure();
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  if (!isDeepStrictEqual(actual, [...expected].sort())) persistenceFailure();
}

function exactText(value: unknown, maximumBytes = 512): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    return persistenceFailure();
  }
  return value;
}

function providerId(value: unknown): string {
  const parsed = exactText(value, 19);
  if (!PROVIDER_ID_PATTERN.test(parsed)) return persistenceFailure();
  return parsed;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return persistenceFailure();
  return value;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return persistenceFailure();
  }
  return value as number;
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}

function nullableText(value: unknown, maximumBytes = 512): string | null {
  return value === null ? null : exactText(value, maximumBytes);
}

function catalog(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > 10_000) persistenceFailure();
  return value;
}

function sanitizedStatuses(value: unknown): readonly Record<string, unknown>[] {
  return Object.freeze(
    catalog(value).map((entry) => {
      const source = record(entry);
      exactKeys(source, ["id", "name", "sort", "type", "isEditable"]);
      return Object.freeze({
        id: providerId(source.id),
        name: exactText(source.name),
        sort: integer(source.sort),
        type: nullableInteger(source.type),
        is_editable:
          source.isEditable === null ? null : boolean(source.isEditable),
      });
    }),
  );
}

function sanitizedPipelines(value: unknown): readonly Record<string, unknown>[] {
  return Object.freeze(
    catalog(value).map((entry) => {
      const source = record(entry);
      exactKeys(source, ["id", "name", "isMain", "isArchive", "statuses"]);
      return Object.freeze({
        id: providerId(source.id),
        name: exactText(source.name),
        is_main: boolean(source.isMain),
        is_archive: boolean(source.isArchive),
        statuses: sanitizedStatuses(source.statuses),
      });
    }),
  );
}

function sanitizedTags(value: unknown): readonly Record<string, unknown>[] {
  return Object.freeze(
    catalog(value).map((entry) => {
      const source = record(entry);
      exactKeys(source, ["id", "name"]);
      return Object.freeze({
        id: providerId(source.id),
        name: exactText(source.name),
      });
    }),
  );
}

function sanitizedUsers(value: unknown): readonly Record<string, unknown>[] {
  return Object.freeze(
    catalog(value).map((entry) => {
      const source = record(entry);
      exactKeys(source, ["id", "name", "isActive"]);
      return Object.freeze({
        id: providerId(source.id),
        name: exactText(source.name),
        is_active: boolean(source.isActive),
      });
    }),
  );
}

function sanitizedEnums(value: unknown): readonly Record<string, unknown>[] {
  return Object.freeze(
    catalog(value).map((entry) => {
      const source = record(entry);
      exactKeys(source, ["id", "value", "sort"]);
      return Object.freeze({
        id: providerId(source.id),
        value: exactText(source.value),
        sort: integer(source.sort),
      });
    }),
  );
}

function sanitizedCustomFields(value: unknown): readonly Record<string, unknown>[] {
  return Object.freeze(
    catalog(value).map((entry) => {
      const source = record(entry);
      exactKeys(source, ["id", "name", "code", "type", "enums"]);
      return Object.freeze({
        id: providerId(source.id),
        name: exactText(source.name),
        code: nullableText(source.code, 512),
        type: exactText(source.type, 128),
        enums: sanitizedEnums(source.enums),
      });
    }),
  );
}

function accountDomain(accountBaseUrl: string, expectedSubdomain: string): string {
  let parsed: URL;
  try {
    parsed = new URL(accountBaseUrl);
  } catch {
    return persistenceFailure();
  }
  const domain = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (domain !== `${expectedSubdomain}.amocrm.ru` &&
      domain !== `${expectedSubdomain}.kommo.com`)
  ) {
    return persistenceFailure();
  }
  return domain;
}

function sanitizedSnapshot(
  input: CanonicalAmoCrmDiscoveryPersistenceInput,
): Readonly<Record<string, unknown>> {
  const accountId = providerId(input.account.providerAccountId);
  const accountSubdomain = exactText(input.account.accountSubdomain, 63).toLowerCase();
  const domain = accountDomain(input.account.accountBaseUrl, accountSubdomain);
  return Object.freeze({
    schema_version: 2,
    account: Object.freeze({
      id: accountId,
      domain,
      subdomain: accountSubdomain,
      name: exactText(input.account.accountName),
      timezone: exactText(input.account.timezone, 128),
      country: nullableText(input.account.country, 16),
    }),
    pipelines: sanitizedPipelines(input.snapshot.pipelineCatalog),
    lead_tags: sanitizedTags(input.snapshot.leadTagCatalog),
    users: sanitizedUsers(input.snapshot.userCatalog),
    lead_custom_fields: sanitizedCustomFields(
      input.snapshot.leadCustomFieldCatalog,
    ),
    contact_custom_fields: sanitizedCustomFields(
      input.snapshot.contactCustomFieldCatalog,
    ),
  });
}

function uuid(value: unknown): string {
  const parsed = exactText(value, 36).toLowerCase();
  if (!UUID_PATTERN.test(parsed)) return persistenceFailure();
  return parsed;
}

function sha256(value: unknown): string {
  const parsed = exactText(value, 64);
  if (!SHA256_PATTERN.test(parsed)) return persistenceFailure();
  return parsed;
}

function exactTimestamp(value: unknown, expected: Date): Date {
  if (typeof value !== "string") return persistenceFailure();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() !== expected.getTime()) {
    return persistenceFailure();
  }
  return parsed;
}

function timestamp(value: unknown): Date {
  if (typeof value !== "string") return persistenceFailure();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return persistenceFailure();
  return parsed;
}

export function createPlatformAmoCrmDiscoveryRepository(
  options: RepositoryOptions,
): CanonicalAmoCrmDiscoveryRepository {
  const organizationId = uuid(options.organizationId);
  const client =
    options.client ??
    (createPlatformSupabaseServiceClient(
      getPlatformSupabaseBackendConfig(),
    ) as PlatformAmoCrmDiscoveryRpcClient);

  return Object.freeze({
    persist: async (
      input: CanonicalAmoCrmDiscoveryPersistenceInput,
    ): Promise<CanonicalAmoCrmDiscoveryPersistenceResult> => {
      try {
        const snapshot = sanitizedSnapshot(input);
        const requestId = uuid(input.snapshot.correlationId);
        const catalogSha256 = sha256(input.snapshot.snapshotSha256);
        if (
          !(input.snapshot.discoveredAt instanceof Date) ||
          !Number.isFinite(input.snapshot.discoveredAt.getTime())
        ) {
          return persistenceFailure();
        }
        const account = record(snapshot.account);
        const providerAccountId = providerId(account.id);
        const accountDomainValue = exactText(account.domain, 255);
        const accountSubdomain = exactText(account.subdomain, 63);
        const evidenceRef = `${EVIDENCE_PREFIX}${catalogSha256}`;
        const response = await client.schema("platform").rpc(
          "persist_amocrm_mapping_discovery",
          {
            p_organization_id: organizationId,
            p_amocrm_account_id: Number(providerAccountId),
            p_account_domain: accountDomainValue,
            p_account_subdomain: accountSubdomain,
            p_sanitized_snapshot: snapshot,
            p_evidence_kind: "provider_observed",
            p_evidence_ref: evidenceRef,
            p_discovered_at: input.snapshot.discoveredAt.toISOString(),
            p_request_id: requestId,
          },
        );
        if (response.error !== null) return persistenceFailure();
        if (!Array.isArray(response.data) || response.data.length !== 1) {
          return persistenceFailure();
        }
        const row = record(response.data[0]);
        exactKeys(row, [
          "discovery_version_id",
          "organization_id",
          "amocrm_account_id",
          "account_domain",
          "account_subdomain",
          "version",
          "snapshot_schema_version",
          "sanitized_snapshot",
          "snapshot_sha256",
          "evidence_kind",
          "evidence_ref",
          "request_id",
          "discovered_at",
          "created_at",
        ]);
        if (
          uuid(row.organization_id) !== organizationId ||
          providerId(String(row.amocrm_account_id)) !== providerAccountId ||
          exactText(row.account_domain, 255) !== accountDomainValue ||
          exactText(row.account_subdomain, 63) !== accountSubdomain ||
          row.snapshot_schema_version !== 2 ||
          uuid(row.request_id) !== requestId ||
          exactText(row.evidence_kind, 32) !== "provider_observed" ||
          exactText(row.evidence_ref, 512) !== evidenceRef ||
          integer(row.version) < 1 ||
          timestamp(row.created_at).getTime() <
            input.snapshot.discoveredAt.getTime() ||
          !isDeepStrictEqual(row.sanitized_snapshot, snapshot)
        ) {
          return persistenceFailure();
        }
        return Object.freeze({
          accountId: organizationId,
          snapshotId: uuid(row.discovery_version_id),
          snapshotSha256: sha256(row.snapshot_sha256),
          discoveredAt: exactTimestamp(
            row.discovered_at,
            input.snapshot.discoveredAt,
          ),
        });
      } catch (error) {
        if (error instanceof CanonicalAmoCrmDiscoveryRepositoryError) {
          throw error;
        }
        throw new CanonicalAmoCrmDiscoveryRepositoryError("persistence_failed");
      }
    },
  });
}
