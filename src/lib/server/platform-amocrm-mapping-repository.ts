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
const MAX_REASON_LENGTH = 1_000;
const MAX_BINDINGS_PER_ENTITY = 100;
const BINDING_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

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

export type PlatformAmoCrmMappingState =
  | "not_approved"
  | "approved_configured_unverified";

export type PlatformAmoCrmMappingBinding = Readonly<{
  bindingKey: string;
  fieldId: string;
}>;

export type PlatformAmoCrmSelectedBindings = Readonly<{
  pipelineId: string;
  signedContractStatusId: string;
  responsibleUserSource: "lead.responsible_user_id";
  leadCustomFields: readonly PlatformAmoCrmMappingBinding[];
  contactCustomFields: readonly PlatformAmoCrmMappingBinding[];
}>;

export type PlatformAmoCrmMappingStateForConversation = Readonly<{
  organizationId: string;
  conversationId: string;
  mappingUse: "messaging";
  mappingState: PlatformAmoCrmMappingState;
}>;

export type PlatformAmoCrmMappingReviewDiscovery = Readonly<{
  discoveryVersionId: string;
  version: number;
  accountDomain: string;
  accountSubdomain: string;
  sanitizedSnapshot: PlatformAmoCrmMappingSnapshot;
  snapshotSha256: string;
  evidenceKind: PlatformAmoCrmDiscoveryEvidenceKind;
  evidenceRef: string;
  discoveredAt: string;
}>;

export type PlatformAmoCrmMappingDecision = Readonly<{
  eventId: string;
  eventKind: "approved" | "revoked";
  discoveryVersionId: string;
  discoveryVersion: number;
  selectedBindings: PlatformAmoCrmSelectedBindings;
  reason: string;
  actorProfileId: string;
  requestId: string;
  createdAt: string;
}>;

export type PlatformAmoCrmMappingApprovalWorkspace = Readonly<{
  organizationId: string;
  conversationId: string;
  amocrmAccountId: string;
  mappingUse: "messaging";
  mappingState: PlatformAmoCrmMappingState;
  reviewDiscovery: PlatformAmoCrmMappingReviewDiscovery | null;
  latestDecision: PlatformAmoCrmMappingDecision | null;
}>;

export type PlatformAmoCrmMappingApprovalEvent = Readonly<{
  approvalEventId: string;
  organizationId: string;
  amocrmAccountId: string;
  mappingUse: "messaging";
  eventVersion: number;
  eventKind: "approved" | "revoked";
  discoveryVersionId: string;
  discoveryVersion: number;
  selectedBindings: PlatformAmoCrmSelectedBindings;
  priorEventId: string | null;
  actorProfileId: string;
  reason: string;
  requestId: string;
  createdAt: string;
  // Current tuple projection at response time. An idempotent replay returns
  // the original immutable event, so this may differ from eventKind after a
  // later approval or revocation.
  mappingState: PlatformAmoCrmMappingState;
}>;

type ReadMappingStateInput = Readonly<{
  organizationId: string;
  conversationId: string;
}>;

type ReadApprovalWorkspaceInput = ReadMappingStateInput & Readonly<{
  discoveryVersionId?: string | null;
}>;

export type ApprovePlatformAmoCrmMappingInput = Readonly<{
  organizationId: string;
  conversationId: string;
  amocrmAccountId: string;
  discoveryVersionId: string;
  selectedBindings: PlatformAmoCrmSelectedBindings;
  expectedPriorEventId: string | null;
  reason: string;
  requestId: string;
}>;

export type RevokePlatformAmoCrmMappingInput = Readonly<{
  organizationId: string;
  conversationId: string;
  amocrmAccountId: string;
  expectedPriorEventId: string;
  reason: string;
  requestId: string;
}>;

export class PlatformAmoCrmMappingRepositoryError extends Error {
  readonly code: "22023" | "PT409" | null;

  constructor(code: "22023" | "PT409" | null = null) {
    super("amoCRM mapping discovery is unavailable.");
    this.name = "PlatformAmoCrmMappingRepositoryError";
    this.code = code;
  }
}

function invalidShape(): never {
  throw new PlatformAmoCrmMappingRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAmoCrmMappingRepositoryError) throw error;
  return invalidShape();
}

function rpcMutationFailure(value: unknown): never {
  if (isRecord(value) && (value.code === "22023" || value.code === "PT409")) {
    throw new PlatformAmoCrmMappingRepositoryError(value.code);
  }
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

function optionalUuid(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredUuid(value);
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

function requiredReason(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_REASON_LENGTH) {
    return invalidShape();
  }
  const normalized = value.trim();
  if (!normalized || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    return invalidShape();
  }
  return normalized;
}

function requiredMappingState(value: unknown): PlatformAmoCrmMappingState {
  return value === "not_approved" || value === "approved_configured_unverified"
    ? value
    : invalidShape();
}

function requiredMappingUse(value: unknown): "messaging" {
  return value === "messaging" ? value : invalidShape();
}

function requiredEventKind(value: unknown): "approved" | "revoked" {
  return value === "approved" || value === "revoked" ? value : invalidShape();
}

function requiredBinding(value: unknown): PlatformAmoCrmMappingBinding {
  if (!isRecord(value) || !BINDING_KEY_PATTERN.test(String(value.binding_key ?? ""))) {
    return invalidShape();
  }
  return {
    bindingKey: String(value.binding_key),
    fieldId: requiredProviderId(value.field_id),
  };
}

function requiredBindingCollection(value: unknown): readonly PlatformAmoCrmMappingBinding[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_BINDINGS_PER_ENTITY
  ) {
    return invalidShape();
  }
  return value.map(requiredBinding);
}

export function normalizePlatformAmoCrmSelectedBindings(
  value: unknown,
): PlatformAmoCrmSelectedBindings {
  if (!isRecord(value)) return invalidShape();
  const leadCustomFields = requiredBindingCollection(value.lead_custom_fields);
  const contactCustomFields = requiredBindingCollection(
    value.contact_custom_fields,
  );
  const keys = [
    ...leadCustomFields.map((binding) => binding.bindingKey),
    ...contactCustomFields.map((binding) => binding.bindingKey),
  ];
  if (new Set(keys).size !== keys.length) return invalidShape();
  if (value.responsible_user_source !== "lead.responsible_user_id") {
    return invalidShape();
  }
  return {
    pipelineId: requiredProviderId(value.pipeline_id),
    signedContractStatusId: requiredProviderId(
      value.signed_contract_status_id,
    ),
    responsibleUserSource: "lead.responsible_user_id",
    leadCustomFields,
    contactCustomFields,
  };
}

export function serializePlatformAmoCrmSelectedBindings(
  value: PlatformAmoCrmSelectedBindings,
): Readonly<Record<string, unknown>> {
  const normalized = normalizePlatformAmoCrmSelectedBindings({
    pipeline_id: value.pipelineId,
    signed_contract_status_id: value.signedContractStatusId,
    responsible_user_source: value.responsibleUserSource,
    lead_custom_fields: value.leadCustomFields.map((binding) => ({
      binding_key: binding.bindingKey,
      field_id: binding.fieldId,
    })),
    contact_custom_fields: value.contactCustomFields.map((binding) => ({
      binding_key: binding.bindingKey,
      field_id: binding.fieldId,
    })),
  });
  return {
    pipeline_id: normalized.pipelineId,
    signed_contract_status_id: normalized.signedContractStatusId,
    responsible_user_source: normalized.responsibleUserSource,
    lead_custom_fields: normalized.leadCustomFields.map((binding) => ({
      binding_key: binding.bindingKey,
      field_id: binding.fieldId,
    })),
    contact_custom_fields: normalized.contactCustomFields.map((binding) => ({
      binding_key: binding.bindingKey,
      field_id: binding.fieldId,
    })),
  };
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

function normalizeMappingStateRow(
  value: unknown,
): PlatformAmoCrmMappingStateForConversation {
  if (!isRecord(value)) return invalidShape();
  return {
    organizationId: requiredUuid(value.organization_id),
    conversationId: requiredUuid(value.conversation_id),
    mappingUse: requiredMappingUse(value.mapping_use),
    mappingState: requiredMappingState(value.mapping_state),
  };
}

function normalizeMappingReviewDiscovery(
  row: Record<string, unknown>,
  amocrmAccountId: string,
): PlatformAmoCrmMappingReviewDiscovery | null {
  const values = [
    row.review_discovery_version_id,
    row.review_discovery_version,
    row.review_account_domain,
    row.review_account_subdomain,
    row.review_sanitized_snapshot,
    row.review_snapshot_sha256,
    row.review_evidence_kind,
    row.review_evidence_ref,
    row.review_discovered_at,
  ];
  if (values.every((value) => value === null || value === undefined)) return null;
  if (values.some((value) => value === null || value === undefined)) {
    return invalidShape();
  }
  const domain = normalizePlatformAmoCrmAccountDomain(row.review_account_domain);
  const accountSubdomain = typeof row.review_account_subdomain === "string"
    ? row.review_account_subdomain.trim().toLowerCase()
    : invalidShape();
  const sanitizedSnapshot = normalizePersistedPlatformAmoCrmMappingSnapshot(
    row.review_sanitized_snapshot,
  );
  if (
    domain.subdomain !== accountSubdomain ||
    sanitizedSnapshot.account.id !== amocrmAccountId ||
    sanitizedSnapshot.account.domain !== domain.domain ||
    sanitizedSnapshot.account.subdomain !== accountSubdomain
  ) {
    return invalidShape();
  }
  if (typeof row.review_snapshot_sha256 !== "string") return invalidShape();
  const snapshotSha256 = row.review_snapshot_sha256.toLowerCase();
  if (!SHA256_PATTERN.test(snapshotSha256)) return invalidShape();
  return {
    discoveryVersionId: requiredUuid(row.review_discovery_version_id),
    version: requiredPositiveInteger(row.review_discovery_version),
    accountDomain: domain.domain,
    accountSubdomain,
    sanitizedSnapshot,
    snapshotSha256,
    evidenceKind: requiredEvidenceKind(row.review_evidence_kind),
    evidenceRef: requiredEvidenceRef(row.review_evidence_ref),
    discoveredAt: requiredTimestamp(row.review_discovered_at),
  };
}

function normalizeMappingDecision(
  row: Record<string, unknown>,
): PlatformAmoCrmMappingDecision | null {
  const values = [
    row.current_event_id,
    row.current_event_kind,
    row.current_discovery_version_id,
    row.current_discovery_version,
    row.current_selected_bindings,
    row.current_reason,
    row.current_actor_profile_id,
    row.current_request_id,
    row.current_created_at,
  ];
  if (values.every((value) => value === null || value === undefined)) return null;
  if (values.some((value) => value === null || value === undefined)) {
    return invalidShape();
  }
  return {
    eventId: requiredUuid(row.current_event_id),
    eventKind: requiredEventKind(row.current_event_kind),
    discoveryVersionId: requiredUuid(row.current_discovery_version_id),
    discoveryVersion: requiredPositiveInteger(row.current_discovery_version),
    selectedBindings: normalizePlatformAmoCrmSelectedBindings(
      row.current_selected_bindings,
    ),
    reason: requiredReason(row.current_reason),
    actorProfileId: requiredUuid(row.current_actor_profile_id),
    requestId: requiredUuid(row.current_request_id),
    createdAt: requiredTimestamp(row.current_created_at),
  };
}

export function normalizePlatformAmoCrmMappingApprovalWorkspace(
  value: unknown,
): PlatformAmoCrmMappingApprovalWorkspace {
  if (!isRecord(value)) return invalidShape();
  const amocrmAccountId = requiredProviderId(value.amocrm_account_id);
  const mappingState = requiredMappingState(value.mapping_state);
  const latestDecision = normalizeMappingDecision(value);
  if (
    (mappingState === "approved_configured_unverified" &&
      latestDecision?.eventKind !== "approved") ||
    (mappingState === "not_approved" && latestDecision?.eventKind === "approved")
  ) {
    return invalidShape();
  }
  return {
    organizationId: requiredUuid(value.organization_id),
    conversationId: requiredUuid(value.conversation_id),
    amocrmAccountId,
    mappingUse: requiredMappingUse(value.mapping_use),
    mappingState,
    reviewDiscovery: normalizeMappingReviewDiscovery(value, amocrmAccountId),
    latestDecision,
  };
}

export function normalizePlatformAmoCrmMappingApprovalEvent(
  value: unknown,
): PlatformAmoCrmMappingApprovalEvent {
  if (!isRecord(value)) return invalidShape();
  const eventKind = requiredEventKind(value.event_kind);
  const mappingState = requiredMappingState(value.mapping_state);
  return {
    approvalEventId: requiredUuid(value.approval_event_id),
    organizationId: requiredUuid(value.organization_id),
    amocrmAccountId: requiredProviderId(value.amocrm_account_id),
    mappingUse: requiredMappingUse(value.mapping_use),
    eventVersion: requiredPositiveInteger(value.event_version),
    eventKind,
    discoveryVersionId: requiredUuid(value.discovery_version_id),
    discoveryVersion: requiredPositiveInteger(value.discovery_version),
    selectedBindings: normalizePlatformAmoCrmSelectedBindings(
      value.selected_bindings,
    ),
    priorEventId: optionalUuid(value.prior_event_id),
    actorProfileId: requiredUuid(value.actor_profile_id),
    reason: requiredReason(value.reason),
    requestId: requiredUuid(value.request_id),
    createdAt: requiredTimestamp(value.created_at),
    mappingState,
  };
}

function normalizeOneRpcRow(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : invalidShape();
}

export async function readPlatformAmoCrmMappingStateForConversation(
  client: SupabaseClient,
  input: ReadMappingStateInput,
): Promise<PlatformAmoCrmMappingStateForConversation> {
  try {
    const organizationId = requiredUuid(input.organizationId);
    const conversationId = requiredUuid(input.conversationId);
    const response = await client.schema("platform").rpc(
      "amocrm_mapping_state_for_conversation",
      {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
      },
      { get: true },
    );
    if (response.error) return invalidShape();
    const state = normalizeMappingStateRow(normalizeOneRpcRow(response.data));
    if (
      state.organizationId !== organizationId ||
      state.conversationId !== conversationId
    ) {
      return invalidShape();
    }
    return state;
  } catch (error) {
    return failClosed(error);
  }
}

export async function readPlatformAmoCrmMappingApprovalWorkspace(
  client: SupabaseClient,
  input: ReadApprovalWorkspaceInput,
): Promise<PlatformAmoCrmMappingApprovalWorkspace> {
  try {
    const organizationId = requiredUuid(input.organizationId);
    const conversationId = requiredUuid(input.conversationId);
    const discoveryVersionId = optionalUuid(input.discoveryVersionId);
    // PostgREST resolves defaulted RPC arguments by omission. Sending the
    // literal string `null` in a GET query is not equivalent to SQL NULL and
    // makes the otherwise valid two-argument function unavailable.
    const parameters = discoveryVersionId === null
      ? {
          p_organization_id: organizationId,
          p_conversation_id: conversationId,
        }
      : {
          p_organization_id: organizationId,
          p_conversation_id: conversationId,
          p_discovery_version_id: discoveryVersionId,
        };
    const response = await client.schema("platform").rpc(
      "admin_amocrm_mapping_approval_workspace",
      parameters,
      { get: true },
    );
    if (response.error) return invalidShape();
    const workspace = normalizePlatformAmoCrmMappingApprovalWorkspace(
      normalizeOneRpcRow(response.data),
    );
    if (
      workspace.organizationId !== organizationId ||
      workspace.conversationId !== conversationId ||
      (discoveryVersionId !== null &&
        workspace.reviewDiscovery?.discoveryVersionId !== discoveryVersionId)
    ) {
      return invalidShape();
    }
    return workspace;
  } catch (error) {
    return failClosed(error);
  }
}

function selectedBindingsMatch(
  left: PlatformAmoCrmSelectedBindings,
  right: PlatformAmoCrmSelectedBindings,
): boolean {
  return JSON.stringify(serializePlatformAmoCrmSelectedBindings(left)) ===
    JSON.stringify(serializePlatformAmoCrmSelectedBindings(right));
}

export async function approvePlatformAmoCrmMappingSelection(
  client: SupabaseClient,
  input: ApprovePlatformAmoCrmMappingInput,
): Promise<PlatformAmoCrmMappingApprovalEvent> {
  try {
    const organizationId = requiredUuid(input.organizationId);
    const conversationId = requiredUuid(input.conversationId);
    const amocrmAccountId = requiredProviderId(input.amocrmAccountId);
    const discoveryVersionId = requiredUuid(input.discoveryVersionId);
    const selectedBindings = normalizePlatformAmoCrmSelectedBindings(
      serializePlatformAmoCrmSelectedBindings(input.selectedBindings),
    );
    const expectedPriorEventId = optionalUuid(input.expectedPriorEventId);
    const reason = requiredReason(input.reason);
    const requestId = requiredUuid(input.requestId);
    // Approval is a mutation with an idempotency receipt. Never let a client
    // library retry a transport or PT409 conflict response implicitly.
    const response = await client
      .schema("platform")
      .rpc("approve_amocrm_mapping_selection", {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
        p_discovery_version_id: discoveryVersionId,
        p_selected_bindings: serializePlatformAmoCrmSelectedBindings(
          selectedBindings,
        ),
        p_expected_prior_event_id: expectedPriorEventId,
        p_reason: reason,
        p_request_id: requestId,
      })
      .retry(false);
    if (response.error) return rpcMutationFailure(response.error);
    const event = normalizePlatformAmoCrmMappingApprovalEvent(
      normalizeOneRpcRow(response.data),
    );
    if (
      event.organizationId !== organizationId ||
      event.amocrmAccountId !== amocrmAccountId ||
      event.eventKind !== "approved" ||
      event.discoveryVersionId !== discoveryVersionId ||
      event.priorEventId !== expectedPriorEventId ||
      event.reason !== reason ||
      event.requestId !== requestId ||
      !selectedBindingsMatch(event.selectedBindings, selectedBindings)
    ) {
      return invalidShape();
    }
    return event;
  } catch (error) {
    return failClosed(error);
  }
}

export async function revokePlatformAmoCrmMappingSelection(
  client: SupabaseClient,
  input: RevokePlatformAmoCrmMappingInput,
): Promise<PlatformAmoCrmMappingApprovalEvent> {
  try {
    const organizationId = requiredUuid(input.organizationId);
    const conversationId = requiredUuid(input.conversationId);
    const amocrmAccountId = requiredProviderId(input.amocrmAccountId);
    const expectedPriorEventId = requiredUuid(input.expectedPriorEventId);
    const reason = requiredReason(input.reason);
    const requestId = requiredUuid(input.requestId);
    // Revocation has the same explicit no-retry boundary as approval.
    const response = await client
      .schema("platform")
      .rpc("revoke_amocrm_mapping_selection", {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
        p_expected_prior_event_id: expectedPriorEventId,
        p_reason: reason,
        p_request_id: requestId,
      })
      .retry(false);
    if (response.error) return rpcMutationFailure(response.error);
    const event = normalizePlatformAmoCrmMappingApprovalEvent(
      normalizeOneRpcRow(response.data),
    );
    if (
      event.organizationId !== organizationId ||
      event.amocrmAccountId !== amocrmAccountId ||
      event.eventKind !== "revoked" ||
      event.priorEventId !== expectedPriorEventId ||
      event.reason !== reason ||
      event.requestId !== requestId
    ) {
      return invalidShape();
    }
    return event;
  } catch (error) {
    return failClosed(error);
  }
}
