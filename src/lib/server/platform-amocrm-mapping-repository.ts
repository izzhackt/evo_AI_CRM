import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizePersistedPlatformAmoCrmMappingSnapshot,
  normalizePlatformAmoCrmAccountDomain,
  parsePlatformAmoCrmProviderId,
  type PlatformAmoCrmMappingSnapshot,
} from "../platform-amocrm-discovery-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_EVIDENCE_REFERENCE_LENGTH = 512;

export type PlatformAmoCrmDiscoveryEvidenceKind =
  | "local_non_provider"
  | "provider_observed";

export type PlatformAmoCrmMappingDiscoveryVersion = Readonly<{
  discoveryVersionId: string;
  organizationId: string;
  amocrmAccountId: string;
  accountDomain: string;
  accountSubdomain: string;
  version: number;
  snapshotSchemaVersion: 1;
  sanitizedSnapshot: PlatformAmoCrmMappingSnapshot;
  snapshotSha256: string;
  evidenceKind: PlatformAmoCrmDiscoveryEvidenceKind;
  evidenceRef: string;
  requestId: string;
  discoveredAt: string;
  createdAt: string;
}>;

type PersistDiscoveryInput = Readonly<{
  organizationId: string;
  snapshot: PlatformAmoCrmMappingSnapshot;
  evidenceKind: PlatformAmoCrmDiscoveryEvidenceKind;
  evidenceRef: string;
  discoveredAt: string;
  requestId: string;
}>;

type ReadDiscoveryInput = Readonly<{
  organizationId: string;
  amocrmAccountId: string;
  version?: number | null;
}>;

export class PlatformAmoCrmMappingRepositoryError extends Error {
  constructor() {
    super("amoCRM mapping discovery is unavailable.");
    this.name = "PlatformAmoCrmMappingRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformAmoCrmMappingRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAmoCrmMappingRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalidShape();
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function requiredProviderId(value: unknown): string {
  return parsePlatformAmoCrmProviderId(value) ?? invalidShape();
}

function requiredPositiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
  return Number.isSafeInteger(parsed) && Number(parsed) > 0
    ? Number(parsed)
    : invalidShape();
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function requiredEvidenceKind(value: unknown): PlatformAmoCrmDiscoveryEvidenceKind {
  return value === "local_non_provider" || value === "provider_observed"
    ? value
    : invalidShape();
}

function requiredEvidenceRef(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_EVIDENCE_REFERENCE_LENGTH) {
    return invalidShape();
  }
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return invalidShape();
  }
  return normalized;
}

function normalizeRow(value: unknown): PlatformAmoCrmMappingDiscoveryVersion {
  if (!isRecord(value)) return invalidShape();
  const domain = normalizePlatformAmoCrmAccountDomain(value.account_domain);
  const accountSubdomain = typeof value.account_subdomain === "string"
    ? value.account_subdomain.trim().toLowerCase()
    : invalidShape();
  if (accountSubdomain !== domain.subdomain) return invalidShape();
  if (value.snapshot_schema_version !== 1) return invalidShape();
  if (typeof value.snapshot_sha256 !== "string") return invalidShape();
  const snapshotSha256 = value.snapshot_sha256.toLowerCase();
  if (!SHA256_PATTERN.test(snapshotSha256)) return invalidShape();

  const amocrmAccountId = requiredProviderId(value.amocrm_account_id);
  const sanitizedSnapshot = normalizePersistedPlatformAmoCrmMappingSnapshot(
    value.sanitized_snapshot,
  );
  if (
    sanitizedSnapshot.account.id !== amocrmAccountId ||
    sanitizedSnapshot.account.domain !== domain.domain ||
    sanitizedSnapshot.account.subdomain !== accountSubdomain
  ) {
    return invalidShape();
  }

  return {
    discoveryVersionId: requiredUuid(value.discovery_version_id),
    organizationId: requiredUuid(value.organization_id),
    amocrmAccountId,
    accountDomain: domain.domain,
    accountSubdomain,
    version: requiredPositiveInteger(value.version),
    snapshotSchemaVersion: 1,
    sanitizedSnapshot,
    snapshotSha256,
    evidenceKind: requiredEvidenceKind(value.evidence_kind),
    evidenceRef: requiredEvidenceRef(value.evidence_ref),
    requestId: requiredUuid(value.request_id),
    discoveredAt: requiredTimestamp(value.discovered_at),
    createdAt: requiredTimestamp(value.created_at),
  };
}

function normalizeSingleRow(value: unknown): PlatformAmoCrmMappingDiscoveryVersion {
  return Array.isArray(value) && value.length === 1
    ? normalizeRow(value[0])
    : invalidShape();
}

function snapshotsMatch(
  left: PlatformAmoCrmMappingSnapshot,
  right: PlatformAmoCrmMappingSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Service-only persistence adapter. Client creation and service-role secret
 * handling remain outside this module so it cannot silently become a browser
 * or globally configured integration surface.
 */
export async function persistPlatformAmoCrmMappingDiscovery(
  client: SupabaseClient,
  input: PersistDiscoveryInput,
): Promise<PlatformAmoCrmMappingDiscoveryVersion> {
  try {
    const organizationId = requiredUuid(input.organizationId);
    const requestId = requiredUuid(input.requestId);
    const snapshot = normalizePersistedPlatformAmoCrmMappingSnapshot(input.snapshot);
    const domain = normalizePlatformAmoCrmAccountDomain(snapshot.account.domain);
    const evidenceKind = requiredEvidenceKind(input.evidenceKind);
    const evidenceRef = requiredEvidenceRef(input.evidenceRef);
    const discoveredAt = requiredTimestamp(input.discoveredAt);

    const response = await client.schema("platform").rpc(
      "persist_amocrm_mapping_discovery",
      {
        p_organization_id: organizationId,
        p_amocrm_account_id: snapshot.account.id,
        p_account_domain: domain.domain,
        p_account_subdomain: domain.subdomain,
        p_sanitized_snapshot: snapshot,
        p_evidence_kind: evidenceKind,
        p_evidence_ref: evidenceRef,
        p_discovered_at: discoveredAt,
        p_request_id: requestId,
      },
    );
    if (response.error) return invalidShape();
    const row = normalizeSingleRow(response.data);
    if (
      row.organizationId !== organizationId ||
      row.amocrmAccountId !== snapshot.account.id ||
      row.requestId !== requestId ||
      row.evidenceKind !== evidenceKind ||
      row.evidenceRef !== evidenceRef ||
      !snapshotsMatch(row.sanitizedSnapshot, snapshot)
    ) {
      return invalidShape();
    }
    return row;
  } catch (error) {
    return failClosed(error);
  }
}

/** Admin-only read RPC; live organization/role authority is enforced in SQL. */
export async function readPlatformAmoCrmMappingDiscoveryVersion(
  client: SupabaseClient,
  input: ReadDiscoveryInput,
): Promise<PlatformAmoCrmMappingDiscoveryVersion | null> {
  try {
    const organizationId = requiredUuid(input.organizationId);
    const amocrmAccountId = requiredProviderId(input.amocrmAccountId);
    const version = input.version === null || input.version === undefined
      ? null
      : requiredPositiveInteger(input.version);
    const response = await client.schema("platform").rpc(
      "admin_amocrm_mapping_discovery_versions",
      {
        p_organization_id: organizationId,
        p_amocrm_account_id: amocrmAccountId,
        p_version: version,
      },
      { get: true },
    );
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    if (response.data.length === 0) return null;
    const row = normalizeSingleRow(response.data);
    if (
      row.organizationId !== organizationId ||
      row.amocrmAccountId !== amocrmAccountId ||
      (version !== null && row.version !== version)
    ) {
      return invalidShape();
    }
    return row;
  } catch (error) {
    return failClosed(error);
  }
}
