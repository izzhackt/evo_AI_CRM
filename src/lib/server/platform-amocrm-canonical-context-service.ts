import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildPlatformAmoCrmCanonicalContext,
  requirePlatformAmoCrmCanonicalBinding,
  PLATFORM_AMOCRM_CANONICAL_CONTEXT_REFRESH_TTL_MS,
  PLATFORM_AMOCRM_CANONICAL_CONTEXT_STALE_TTL_MS,
  type PlatformAmoCrmCanonicalContext,
} from "../platform-amocrm-canonical-context.ts";
import type { PlatformActor } from "../platform-auth";
import {
  buildUnavailableCanonicalContextFromError,
  readPlatformAmoCrmCanonicalContext,
  type PlatformAmoCrmCanonicalContextClientError,
} from "./platform-amocrm-canonical-context-client.ts";
import {
  getPlatformAmoCrmReadConfig,
  PlatformAmoCrmReadConfigurationError,
  type PlatformAmoCrmReadConfig,
} from "./platform-amocrm-read-config.ts";
import {
  readPlatformAmoCrmCanonicalContextCurrent,
  recordPlatformAmoCrmCanonicalObservation,
} from "./platform-amocrm-canonical-context-repository.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

type ServiceConversation = Readonly<{
  id: string;
  organizationId?: string | null;
  amocrmAccountId: string | number | null;
  amocrmContactId: string | number | null;
  amocrmLeadId: string | number | null;
}>;

type ServiceDependencies = Readonly<{
  getConfig?: () => PlatformAmoCrmReadConfig;
  createStaffClient?: () => Promise<SupabaseClient>;
  createServiceClient?: (config: {
    supabaseUrl: string;
    supabaseSecretKey: string;
  }) => SupabaseClient;
  readCurrent?: typeof readPlatformAmoCrmCanonicalContextCurrent;
  recordObservation?: typeof recordPlatformAmoCrmCanonicalObservation;
  readProvider?: typeof readPlatformAmoCrmCanonicalContext;
  now?: () => number;
}>;

const refreshInflight = new Map<string, Promise<PlatformAmoCrmCanonicalContext>>();

function invalidShape(): never {
  throw new Error("Platform amoCRM canonical context input is invalid.");
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalidShape();
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) return invalidShape();
  return normalized;
}

function requireActor(actor: PlatformActor): Readonly<{
  organizationId: string;
}> {
  if (
    actor.platformRole !== "admin" &&
    actor.platformRole !== "sales" &&
    actor.platformRole !== "admissions"
  ) {
    return invalidShape();
  }
  return Object.freeze({
    organizationId: requiredUuid(actor.organizationId),
  });
}

function requireConversation(
  conversation: ServiceConversation,
  organizationId: string,
) {
  const id = requiredUuid(conversation.id);
  if (conversation.organizationId !== undefined && conversation.organizationId !== null) {
    if (requiredUuid(conversation.organizationId) !== organizationId) return invalidShape();
  }
  return Object.freeze({
    id,
    ...requirePlatformAmoCrmCanonicalBinding({
      amocrmAccountId: conversation.amocrmAccountId,
      amocrmContactId: conversation.amocrmContactId,
      amocrmLeadId: conversation.amocrmLeadId,
    }),
  });
}

function requireConversationScope(
  conversation: ServiceConversation,
  organizationId: string,
): string {
  const id = requiredUuid(conversation.id);
  if (conversation.organizationId !== undefined && conversation.organizationId !== null) {
    if (requiredUuid(conversation.organizationId) !== organizationId) return invalidShape();
  }
  return id;
}

function isFresh(context: PlatformAmoCrmCanonicalContext, nowMs: number): boolean {
  if (context.provider_observed_at === null) return false;
  return nowMs - Date.parse(context.provider_observed_at)
    < PLATFORM_AMOCRM_CANONICAL_CONTEXT_REFRESH_TTL_MS;
}

function canServeStale(context: PlatformAmoCrmCanonicalContext, nowMs: number): boolean {
  if (context.provider_observed_at === null || context.contact_name === null) return false;
  return nowMs - Date.parse(context.provider_observed_at)
    < PLATFORM_AMOCRM_CANONICAL_CONTEXT_STALE_TTL_MS;
}

function disabledContext(): PlatformAmoCrmCanonicalContext {
  return buildPlatformAmoCrmCanonicalContext({
    state: "disabled",
    reason_code: "disabled_by_config",
  });
}

function notLinkedContext(): PlatformAmoCrmCanonicalContext {
  return buildPlatformAmoCrmCanonicalContext({
    state: "not_linked",
    reason_code: "missing_binding",
  });
}

function configurationContext(
  reasonCode:
    | "missing_configuration"
    | "invalid_configuration"
    | "configuration_scope_mismatch",
): PlatformAmoCrmCanonicalContext {
  return buildPlatformAmoCrmCanonicalContext({
    state: "disabled",
    reason_code: reasonCode,
  });
}

export async function getPlatformAmoCrmCanonicalContext(
  actor: PlatformActor,
  conversation: ServiceConversation,
  dependencies: ServiceDependencies = {},
): Promise<PlatformAmoCrmCanonicalContext> {
  const authority = requireActor(actor);
  requireConversationScope(conversation, authority.organizationId);
  const getConfig = dependencies.getConfig ?? (() => getPlatformAmoCrmReadConfig());
  let config: PlatformAmoCrmReadConfig;
  try {
    config = getConfig();
  } catch (error) {
    if (error instanceof PlatformAmoCrmReadConfigurationError) {
      return configurationContext(
        error.code.startsWith("missing_")
          ? "missing_configuration"
          : "invalid_configuration",
      );
    }
    throw error;
  }
  if (!config.enabled) return disabledContext();
  const enabledConfig = config;

  let binding;
  try {
    binding = requireConversation(conversation, authority.organizationId);
  } catch {
    if (
      conversation.amocrmAccountId === null ||
      conversation.amocrmContactId === null ||
      conversation.amocrmLeadId === null
    ) {
      return notLinkedContext();
    }
    throw invalidShape();
  }

  if (enabledConfig.organizationId !== authority.organizationId) {
    return configurationContext("configuration_scope_mismatch");
  }

  const now = dependencies.now ?? Date.now;
  const staffClientFactory =
    dependencies.createStaffClient
    ?? (async () => {
      const { createSupabaseServerClient } = await import("../supabase/server.ts");
      return createSupabaseServerClient();
    });
  const readCurrent = dependencies.readCurrent ?? readPlatformAmoCrmCanonicalContextCurrent;
  const recordObservation =
    dependencies.recordObservation ?? recordPlatformAmoCrmCanonicalObservation;
  const readProvider = dependencies.readProvider ?? readPlatformAmoCrmCanonicalContext;

  async function createServiceClient() {
    if (dependencies.createServiceClient) {
      return dependencies.createServiceClient({
        supabaseUrl: enabledConfig.supabaseUrl,
        supabaseSecretKey: enabledConfig.supabaseSecretKey,
      });
    }
    const { createPlatformSupabaseServiceClient } = await import(
      "./platform-supabase-service-client.ts"
    );
    return createPlatformSupabaseServiceClient({
      supabaseUrl: enabledConfig.supabaseUrl,
      supabaseSecretKey: enabledConfig.supabaseSecretKey,
    });
  }

  const durable = await readCurrent(await staffClientFactory(), {
    organizationId: authority.organizationId,
    conversationId: binding.id,
  });
  const current = durable?.current ?? null;
  const nowMs = now();
  if (current && isFresh(current, nowMs)) return current;

  const inflightKey = [
    authority.organizationId,
    binding.id,
    binding.amocrmAccountId,
    binding.amocrmContactId,
    binding.amocrmLeadId,
  ].join(":");
  const existing = refreshInflight.get(inflightKey);
  if (existing) return existing;

  const requestId = randomUUID();
  const refreshPromise = (async () => {
    try {
      let observed: Awaited<ReturnType<typeof readProvider>>;
      try {
        observed = await readProvider({
          accountDomain: enabledConfig.accountDomain,
          accessToken: enabledConfig.accessToken,
          amocrmAccountId: binding.amocrmAccountId,
          amocrmContactId: binding.amocrmContactId,
          amocrmLeadId: binding.amocrmLeadId,
        });
      } catch (error) {
        const attemptedAt = new Date(nowMs).toISOString();
        const failure = buildUnavailableCanonicalContextFromError(
          error as PlatformAmoCrmCanonicalContextClientError,
          attemptedAt,
        );
        await recordObservation(await createServiceClient(), {
          organizationId: authority.organizationId,
          conversationId: binding.id,
          amocrmAccountId: binding.amocrmAccountId,
          amocrmContactId: binding.amocrmContactId,
          amocrmLeadId: binding.amocrmLeadId,
          pipelineId: null,
          statusId: null,
          responsibleUserId: null,
          requestId,
          outcome: "failed",
          reasonCode: failure.reason_code,
          attemptedAt: failure.last_attempt_at ?? attemptedAt,
          observedAt: null,
          observedCapabilities: [],
          current: failure,
        });
        if (current && canServeStale(current, nowMs)) {
          return buildPlatformAmoCrmCanonicalContext({
            state: "stale",
            reason_code: failure.reason_code ?? "refresh_failed",
            contact_name: current.contact_name,
            lead_name: current.lead_name,
            responsible_user_name: current.responsible_user_name,
            responsible_user_active: current.responsible_user_active,
            responsible_user_resolution: current.responsible_user_resolution,
            pipeline_name: current.pipeline_name,
            status_name: current.status_name,
            last_attempt_at: failure.last_attempt_at,
            provider_observed_at: current.provider_observed_at,
          });
        }
        return failure;
      }

      await recordObservation(await createServiceClient(), {
        organizationId: authority.organizationId,
        conversationId: binding.id,
        amocrmAccountId: observed.relationshipIds.amocrmAccountId,
        amocrmContactId: observed.relationshipIds.amocrmContactId,
        amocrmLeadId: observed.relationshipIds.amocrmLeadId,
        pipelineId: observed.relationshipIds.pipelineId,
        statusId: observed.relationshipIds.statusId,
        responsibleUserId: observed.relationshipIds.responsibleUserId,
        requestId,
        outcome: observed.state,
        reasonCode: observed.reasonCode,
        attemptedAt: observed.attemptedAt,
        observedAt: observed.observedAt,
        observedCapabilities: observed.observedCapabilities,
        current: observed.context,
      });
      return observed.context;
    } finally {
      refreshInflight.delete(inflightKey);
    }
  })();

  refreshInflight.set(inflightKey, refreshPromise);
  return refreshPromise;
}
