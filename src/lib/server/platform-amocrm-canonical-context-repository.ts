import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizePersistedPlatformAmoCrmCanonicalContext,
  parsePlatformAmoCrmCanonicalProviderId,
  type PlatformAmoCrmCanonicalContext,
  type PlatformAmoCrmCanonicalContextReasonCode,
} from "../platform-amocrm-canonical-context.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const SAFE_REASON_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const PLATFORM_AMOCRM_CANONICAL_CONTEXT_STAFF_RPC =
  "staff_amocrm_canonical_context";
export const PLATFORM_AMOCRM_CANONICAL_CONTEXT_RECORD_RPC =
  "record_amocrm_canonical_context_observation";

export type PlatformAmoCrmCanonicalObservationOutcome = "available" | "degraded" | "failed";

export type PlatformAmoCrmCanonicalContextCurrentRecord = Readonly<{
  current: PlatformAmoCrmCanonicalContext;
}>;

export type PlatformAmoCrmCanonicalObservationReceipt = Readonly<{
  outcome: PlatformAmoCrmCanonicalObservationOutcome;
  reasonCode: PlatformAmoCrmCanonicalContextReasonCode | null;
  attemptedAt: string;
  observedAt: string | null;
  current: PlatformAmoCrmCanonicalContext;
}>;

export type RecordPlatformAmoCrmCanonicalObservationInput = Readonly<{
  organizationId: string;
  conversationId: string;
  amocrmAccountId: string;
  amocrmContactId: string;
  amocrmLeadId: string;
  pipelineId: string | null;
  statusId: string | null;
  responsibleUserId: string | null;
  requestId: string;
  outcome: PlatformAmoCrmCanonicalObservationOutcome;
  reasonCode: PlatformAmoCrmCanonicalContextReasonCode | null;
  attemptedAt: string;
  observedAt: string | null;
  observedCapabilities: readonly string[];
  current: PlatformAmoCrmCanonicalContext;
}>;

export class PlatformAmoCrmCanonicalContextRepositoryError extends Error {
  constructor() {
    super("amoCRM canonical context repository is unavailable.");
    this.name = "PlatformAmoCrmCanonicalContextRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformAmoCrmCanonicalContextRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAmoCrmCanonicalContextRepositoryError) throw error;
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
  const normalized = parsePlatformAmoCrmCanonicalProviderId(value);
  if (normalized === null) return invalidShape();
  return normalized;
}

function optionalProviderId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredProviderId(value);
}

function parseOutcome(value: unknown): PlatformAmoCrmCanonicalObservationOutcome {
  if (value === "available" || value === "degraded" || value === "failed") return value;
  return invalidShape();
}

function optionalReasonCode(value: unknown): PlatformAmoCrmCanonicalContextReasonCode | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !SAFE_REASON_PATTERN.test(value)) return invalidShape();
  return value as PlatformAmoCrmCanonicalContextReasonCode;
}

function normalizeCurrentRow(value: unknown): PlatformAmoCrmCanonicalContextCurrentRecord {
  return Object.freeze({
    current: normalizePersistedPlatformAmoCrmCanonicalContext(value),
  });
}

function normalizeObservationReceipt(value: unknown): PlatformAmoCrmCanonicalObservationReceipt {
  const current = normalizePersistedPlatformAmoCrmCanonicalContext(value);
  return Object.freeze({
    outcome: current.state === "degraded"
      ? "degraded"
      : current.state === "available"
      ? "available"
      : "failed",
    reasonCode: current.reason_code,
    attemptedAt: current.last_attempt_at ?? invalidShape(),
    observedAt: current.provider_observed_at,
    current,
  });
}

export async function readPlatformAmoCrmCanonicalContextCurrent(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    conversationId: string;
  }>,
): Promise<PlatformAmoCrmCanonicalContextCurrentRecord | null> {
  try {
    const organizationId = requiredUuid(input.organizationId);
    const conversationId = requiredUuid(input.conversationId);
    const response = await client.schema("platform").rpc(
      PLATFORM_AMOCRM_CANONICAL_CONTEXT_STAFF_RPC,
      {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
      },
      { get: true },
    );
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1) return invalidShape();
    return normalizeCurrentRow(response.data[0]);
  } catch (error) {
    return failClosed(error);
  }
}

export async function recordPlatformAmoCrmCanonicalObservation(
  client: SupabaseClient,
  input: RecordPlatformAmoCrmCanonicalObservationInput,
): Promise<PlatformAmoCrmCanonicalObservationReceipt> {
  try {
    const organizationId = requiredUuid(input.organizationId);
    const conversationId = requiredUuid(input.conversationId);
    const response = await client.schema("platform").rpc(
      PLATFORM_AMOCRM_CANONICAL_CONTEXT_RECORD_RPC,
      {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
        p_request_id: requiredUuid(input.requestId),
        p_state: parseOutcome(input.outcome),
        p_reason_code: optionalReasonCode(input.reasonCode),
        p_amocrm_account_id: requiredProviderId(input.amocrmAccountId),
        p_amocrm_contact_id: requiredProviderId(input.amocrmContactId),
        p_amocrm_lead_id: requiredProviderId(input.amocrmLeadId),
        p_contact_name: input.current.contact_name,
        p_lead_name: input.current.lead_name,
        p_responsible_user_id: optionalProviderId(input.responsibleUserId),
        p_responsible_user_name: input.current.responsible_user_name,
        p_responsible_user_active: input.current.responsible_user_active,
        p_responsible_user_resolution:
          input.current.responsible_user_resolution,
        p_pipeline_id: optionalProviderId(input.pipelineId),
        p_pipeline_name: input.current.pipeline_name,
        p_status_id: optionalProviderId(input.statusId),
        p_status_name: input.current.status_name,
        p_observed_capabilities: [...input.observedCapabilities],
        p_provider_observed_at: input.current.provider_observed_at,
        p_adapter_contract_version: input.current.adapter_contract_version,
      },
    );
    if (response.error || !isRecord(response.data)) {
      return invalidShape();
    }
    return normalizeObservationReceipt(response.data);
  } catch (error) {
    return failClosed(error);
  }
}
