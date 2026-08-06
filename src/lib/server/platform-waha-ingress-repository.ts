import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  getPlatformWahaIngressConfig,
  PlatformWahaIngressConfigurationError,
  type PlatformWahaIngressConfig,
  type PlatformWahaIngressEnabledConfig,
} from "./platform-waha-ingress-config.ts";
import {
  parsePlatformWahaWebhookEvent,
  platformWahaVerificationHeaders,
  readPlatformWahaRawBody,
  sha256PlatformWahaRawBody,
  verifyPlatformWahaWebhookAuthentication,
  PlatformWahaWebhookRequestError,
} from "./platform-waha-webhook.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PROCESSING_ATTEMPTS = 8;

export type PersistPlatformWahaVerifiedEventInput = Readonly<{
  organizationId: string;
  providerRequestId: string;
  sessionName: string;
  payloadId: string;
  eventType: string;
  providerOccurredAt: string;
  providerEventVariantRef: string | null;
  rawPayload: Record<string, unknown>;
  verificationHeaders: Readonly<Record<string, string | boolean>>;
  verificationEvidenceRef: string;
  payloadSha256: string;
  requestId: string;
}>;

export type PersistPlatformWahaVerifiedEventResult = Readonly<{
  providerWebhookEventId: string;
  deduplicated: boolean;
}>;

export type EnqueuePlatformWahaVerifiedEventInput = Readonly<{
  organizationId: string;
  providerWebhookEventId: string;
  businessKeySha256: string;
  requestId: string;
}>;

export type EnqueuePlatformWahaVerifiedEventResult = Readonly<{
  workItemId: string;
  deduplicated: boolean;
}>;

export interface PlatformWahaIngressRepository {
  persistVerifiedEvent(
    input: PersistPlatformWahaVerifiedEventInput,
  ): Promise<PersistPlatformWahaVerifiedEventResult>;
  enqueueVerifiedEvent(
    input: EnqueuePlatformWahaVerifiedEventInput,
  ): Promise<EnqueuePlatformWahaVerifiedEventResult>;
}

export type PlatformWahaIngressHandlerDependencies = Readonly<{
  config?: PlatformWahaIngressConfig;
  repository?: PlatformWahaIngressRepository;
  now?: () => number;
  generateRequestId?: () => string;
}>;

export class PlatformWahaIngressRepositoryError extends Error {
  constructor() {
    super("Platform WAHA ingress persistence is unavailable.");
    this.name = "PlatformWahaIngressRepositoryError";
  }
}

function invalidResult(): never {
  throw new PlatformWahaIngressRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalidResult();
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidResult() : normalized;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalidResult();
  return value;
}

function sameInstant(value: unknown, expected: string): boolean {
  if (typeof value !== "string") return false;
  const actualTime = Date.parse(value);
  const expectedTime = Date.parse(expected);
  return Number.isFinite(actualTime) && actualTime === expectedTime;
}

export function createPlatformWahaIngressRepository(
  client: SupabaseClient,
): PlatformWahaIngressRepository {
  return Object.freeze({
    async persistVerifiedEvent(
      input: PersistPlatformWahaVerifiedEventInput,
    ): Promise<PersistPlatformWahaVerifiedEventResult> {
      const response = await client.schema("platform").rpc(
        "persist_provider_webhook_event",
        {
          p_organization_id: input.organizationId,
          p_provider: "waha",
          p_provider_account_ref: `waha:${input.sessionName}`,
          p_provider_conversation_ref: null,
          p_provider_event_variant_ref: input.providerEventVariantRef,
          p_provider_request_id: input.providerRequestId,
          p_waha_session_name: input.sessionName,
          p_payload_id: input.payloadId,
          p_event_type: input.eventType,
          p_provider_occurred_at: input.providerOccurredAt,
          p_verification_status: "verified",
          p_raw_payload: input.rawPayload,
          p_verification_headers: input.verificationHeaders,
          p_verification_evidence_ref: input.verificationEvidenceRef,
          p_payload_sha256: input.payloadSha256,
          p_request_id: input.requestId,
        },
      );

      if (response.error || !isRecord(response.data)) return invalidResult();
      if (
        response.data.organization_id !== input.organizationId ||
        response.data.provider !== "waha" ||
        response.data.provider_account_ref !== `waha:${input.sessionName}` ||
        response.data.provider_conversation_ref !== null ||
        response.data.provider_event_variant_ref !==
          input.providerEventVariantRef ||
        response.data.observed_provider_request_id !== input.providerRequestId ||
        response.data.waha_session_name !== input.sessionName ||
        response.data.payload_id !== input.payloadId ||
        response.data.event_type !== input.eventType ||
        !sameInstant(
          response.data.provider_occurred_at,
          input.providerOccurredAt,
        ) ||
        response.data.verification_status !== "verified" ||
        response.data.verification_evidence_ref !==
          input.verificationEvidenceRef ||
        response.data.payload_sha256 !== input.payloadSha256 ||
        response.data.persisted_before_processing !== true
      ) {
        return invalidResult();
      }

      return Object.freeze({
        providerWebhookEventId: requiredUuid(
          response.data.provider_webhook_event_id,
        ),
        deduplicated: requiredBoolean(response.data.deduplicated),
      });
    },

    async enqueueVerifiedEvent(
      input: EnqueuePlatformWahaVerifiedEventInput,
    ): Promise<EnqueuePlatformWahaVerifiedEventResult> {
      if (!SHA256_PATTERN.test(input.businessKeySha256)) return invalidResult();
      const response = await client.schema("platform").rpc(
        "enqueue_verified_webhook_work",
        {
          p_organization_id: input.organizationId,
          p_source_webhook_event_id: input.providerWebhookEventId,
          p_business_key_sha256: input.businessKeySha256,
          p_max_attempts: MAX_PROCESSING_ATTEMPTS,
          p_request_id: input.requestId,
        },
      );

      if (response.error || !isRecord(response.data)) return invalidResult();
      if (
        response.data.organization_id !== input.organizationId ||
        response.data.kind !== "provider_webhook_process" ||
        response.data.source_webhook_event_id !== input.providerWebhookEventId ||
        response.data.business_key_sha256 !== input.businessKeySha256 ||
        response.data.max_attempts !== MAX_PROCESSING_ATTEMPTS ||
        response.data.queue_payload_is_pointer_only !== true
      ) {
        return invalidResult();
      }

      return Object.freeze({
        workItemId: requiredUuid(response.data.work_item_id),
        deduplicated: requiredBoolean(response.data.deduplicated),
      });
    },
  });
}

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

function createDefaultRepository(
  config: PlatformWahaIngressEnabledConfig,
): PlatformWahaIngressRepository {
  return createPlatformWahaIngressRepository(
    createPlatformSupabaseServiceClient(config),
  );
}

/**
 * Injectable orchestration seam for the route and focused Node tests.
 * Production leaves dependencies unset, so config and service credentials stay
 * server-owned and request-local.
 */
export function createPlatformWahaIngressHandler(
  dependencies: PlatformWahaIngressHandlerDependencies = {},
): (request: Request) => Promise<Response> {
  return async function platformWahaIngressHandler(
    request: Request,
  ): Promise<Response> {
    let config: PlatformWahaIngressConfig;
    try {
      config = dependencies.config ?? getPlatformWahaIngressConfig();
    } catch (error) {
      if (error instanceof PlatformWahaIngressConfigurationError) {
        return jsonError("not_configured", 503);
      }
      return jsonError("temporarily_unavailable", 503);
    }

    if (!config.enabled) return jsonError("ingress_disabled", 503);

    try {
      const rawBody = await readPlatformWahaRawBody(request, config.maxBodyBytes);
      const authentication = verifyPlatformWahaWebhookAuthentication(
        request,
        rawBody,
        config,
        dependencies.now?.() ?? Date.now(),
      );
      const event = parsePlatformWahaWebhookEvent(rawBody, config.sessionName);

      if (event.ignoredAsDuplicateAlias) {
        return Response.json(
          {
            ok: true,
            persisted: false,
            persistDeduplicated: null,
            enqueued: false,
            enqueueDeduplicated: null,
            ignoredReason: "message_alias_use_message_any",
          },
          { status: 202 },
        );
      }

      const payloadSha256 = sha256PlatformWahaRawBody(rawBody);
      const verificationEvidenceRef = `waha-raw-sha256:${payloadSha256}`;
      const generateRequestId = dependencies.generateRequestId ?? randomUUID;
      const repository =
        dependencies.repository ?? createDefaultRepository(config);

      const persisted = await repository.persistVerifiedEvent({
        organizationId: config.organizationId,
        providerRequestId: authentication.providerRequestId,
        sessionName: event.sessionName,
        payloadId: event.payloadId,
        eventType: event.eventType,
        providerOccurredAt: event.providerOccurredAt,
        providerEventVariantRef: event.providerEventVariantRef,
        rawPayload: event.rawPayload,
        verificationHeaders: platformWahaVerificationHeaders(),
        verificationEvidenceRef,
        payloadSha256,
        requestId: generateRequestId(),
      });

      let enqueueDeduplicated: boolean | null = null;
      if (event.processable) {
        const businessKeySha256 = createHash("sha256")
          .update(
            `provider_webhook_process:${config.organizationId}:${persisted.providerWebhookEventId}`,
          )
          .digest("hex");
        const enqueued = await repository.enqueueVerifiedEvent({
          organizationId: config.organizationId,
          providerWebhookEventId: persisted.providerWebhookEventId,
          businessKeySha256,
          requestId: generateRequestId(),
        });
        enqueueDeduplicated = enqueued.deduplicated;
      }

      return Response.json(
        {
          ok: true,
          persisted: true,
          persistDeduplicated: persisted.deduplicated,
          enqueued: event.processable,
          enqueueDeduplicated,
        },
        { status: 202 },
      );
    } catch (error) {
      if (error instanceof PlatformWahaWebhookRequestError) {
        return jsonError(error.code, error.status);
      }
      if (error instanceof PlatformWahaIngressRepositoryError) {
        return jsonError("temporarily_unavailable", 503);
      }
      return jsonError("temporarily_unavailable", 503);
    }
  };
}
