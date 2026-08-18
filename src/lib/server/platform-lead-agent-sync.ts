import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadPlatformLeadAgentSyncConfig,
  type PlatformLeadAgentSyncConfig,
} from "./platform-lead-agent-sync-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CHAT_ID_PATTERN = /^[0-9]{5,20}@c[.]us$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type PlatformLeadAgentSyncInput = Readonly<{
  session: string;
  providerMessageId: string;
  chatId: string;
  bodyText: string;
  pushName: string | null;
  providerOccurredAt: string;
  amoAccountId: number;
  amoLeadId: number;
  amoContactId: number;
  payloadSha256: string;
}>;

type PersistedEvent = Readonly<{
  providerWebhookEventId: string;
  deduplicated: boolean;
}>;
type ProjectedEvent = Readonly<{
  conversationId: string;
  communicationMessageId: string;
  deduplicated: boolean;
}>;

export type PlatformLeadAgentSyncRepository = Readonly<{
  persistVerifiedEvent(input: Readonly<Record<string, unknown>>): Promise<PersistedEvent>;
  projectVerifiedEvent(input: Readonly<Record<string, unknown>>): Promise<ProjectedEvent>;
}>;

export class PlatformLeadAgentSyncError extends Error {
  constructor() {
    super("Signed Lead-Agent event could not be bound to Platform.");
    this.name = "PlatformLeadAgentSyncError";
  }
}

function fail(): never {
  throw new PlatformLeadAgentSyncError();
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return fail();
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : fail();
}

function optionalText(value: unknown, max: number): string | null {
  return value === null || value === undefined ? null : text(value, max);
}

function providerId(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail();
}

function uuid(value: unknown): string {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : fail();
}

function normalizeInput(input: PlatformLeadAgentSyncInput) {
  const session = text(input.session, 128);
  const providerMessageId = text(input.providerMessageId, 256);
  const chatId = text(input.chatId, 64).toLowerCase();
  const bodyText = text(input.bodyText, 4_000);
  const pushName = optionalText(input.pushName, 160);
  const providerOccurredAt = text(input.providerOccurredAt, 32);
  const payloadSha256 = text(input.payloadSha256, 64).toLowerCase();
  if (
    session !== "crm_primary" ||
    !CHAT_ID_PATTERN.test(chatId) ||
    !TIMESTAMP_PATTERN.test(providerOccurredAt) ||
    Number.isNaN(Date.parse(providerOccurredAt)) ||
    !SHA256_PATTERN.test(payloadSha256)
  ) {
    return fail();
  }
  return Object.freeze({
    session,
    providerMessageId,
    chatId,
    bodyText,
    pushName,
    providerOccurredAt,
    amoAccountId: providerId(input.amoAccountId),
    amoLeadId: providerId(input.amoLeadId),
    amoContactId: providerId(input.amoContactId),
    payloadSha256,
  });
}

function normalizePersisted(value: unknown): PersistedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  return Object.freeze({
    providerWebhookEventId: uuid(row.provider_webhook_event_id ?? row.providerWebhookEventId),
    deduplicated:
      typeof (row.deduplicated) === "boolean" ? row.deduplicated : fail(),
  });
}

function normalizeProjected(value: unknown): ProjectedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  return Object.freeze({
    conversationId: uuid(row.conversation_id ?? row.conversationId),
    communicationMessageId: uuid(
      row.communication_message_id ?? row.communicationMessageId,
    ),
    deduplicated:
      typeof row.deduplicated === "boolean" ? row.deduplicated : fail(),
  });
}

export function createPlatformLeadAgentSyncRepository(
  client: SupabaseClient,
): PlatformLeadAgentSyncRepository {
  return Object.freeze({
    async persistVerifiedEvent(input) {
      const { data, error } = await client.schema("platform").rpc(
        "persist_provider_webhook_event",
        {
          p_organization_id: input.organizationId,
          p_provider: "waha",
          p_provider_account_ref: input.providerAccountRef,
          p_provider_conversation_ref: null,
          p_provider_event_variant_ref: null,
          p_provider_request_id: input.providerRequestId,
          p_waha_session_name: input.sessionName,
          p_payload_id: input.payloadId,
          p_event_type: input.eventType,
          p_provider_occurred_at: input.providerOccurredAt,
          p_verification_status: "verified",
          p_raw_payload: input.rawPayload,
          p_verification_headers: {
            source: "lead_agent_signed_sync",
            signature_algorithm: "sha256",
          },
          p_verification_evidence_ref: input.verificationEvidenceRef,
          p_payload_sha256: input.payloadSha256,
          p_request_id: input.requestId,
        },
      );
      if (error) return fail();
      return normalizePersisted(data);
    },
    async projectVerifiedEvent(input) {
      const { data, error } = await client.schema("platform").rpc(
        "sync_lead_agent_whatsapp",
        {
          p_organization_id: input.organizationId,
          p_provider_webhook_event_id: input.providerWebhookEventId,
          p_intake_sales_membership_id: input.intakeSalesMembershipId,
          p_amocrm_account_id: input.amoAccountId,
          p_amocrm_lead_id: input.amoLeadId,
          p_amocrm_contact_id: input.amoContactId,
          p_request_id: input.requestId,
        },
      );
      if (error) return fail();
      return normalizeProjected(data);
    },
  });
}

export async function syncPlatformLeadAgentWhatsApp(
  rawInput: PlatformLeadAgentSyncInput,
  dependencies: Readonly<{
    config?: PlatformLeadAgentSyncConfig;
    repository?: PlatformLeadAgentSyncRepository;
    requestIds?: () => readonly [string, string];
  }> = {},
): Promise<Readonly<{ enabled: boolean; deduplicated?: boolean }>> {
  const config = dependencies.config ?? loadPlatformLeadAgentSyncConfig();
  if (!config.enabled) return Object.freeze({ enabled: false });
  const input = normalizeInput(rawInput);
  const requestIds = dependencies.requestIds?.() ?? [randomUUID(), randomUUID()];
  if (requestIds.length !== 2) return fail();
  const persistRequestId = uuid(requestIds[0]);
  const projectRequestId = uuid(requestIds[1]);
  const repository = dependencies.repository ?? createPlatformLeadAgentSyncRepository(
    createPlatformSupabaseServiceClient(config),
  );

  const persisted = await repository.persistVerifiedEvent({
    organizationId: config.organizationId,
    providerAccountRef: "waha:crm_primary",
    providerRequestId: `lead-agent:${input.providerMessageId}`,
    sessionName: input.session,
    payloadId: input.providerMessageId,
    eventType: "message.any",
    providerOccurredAt: input.providerOccurredAt,
    rawPayload: {
      event: "message.any",
      session: input.session,
      payload: {
        id: input.providerMessageId,
        from: input.chatId,
        body: input.bodyText,
        pushName: input.pushName,
        fromMe: false,
      },
    },
    verificationEvidenceRef: `lead-agent-sync-sha256:${input.payloadSha256}`,
    payloadSha256: input.payloadSha256,
    requestId: persistRequestId,
  });
  const projected = await repository.projectVerifiedEvent({
    organizationId: config.organizationId,
    providerWebhookEventId: persisted.providerWebhookEventId,
    intakeSalesMembershipId: config.intakeSalesMembershipId,
    amoAccountId: input.amoAccountId,
    amoLeadId: input.amoLeadId,
    amoContactId: input.amoContactId,
    requestId: projectRequestId,
  });
  return Object.freeze({
    enabled: true,
    deduplicated: persisted.deduplicated || projected.deduplicated,
  });
}
