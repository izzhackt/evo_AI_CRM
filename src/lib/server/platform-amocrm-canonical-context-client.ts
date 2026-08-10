import "server-only";

import {
  buildPlatformAmoCrmCanonicalContext,
  parsePlatformAmoCrmCanonicalProviderId,
  type PlatformAmoCrmCanonicalContext,
  type PlatformAmoCrmCanonicalContextReasonCode,
} from "../platform-amocrm-canonical-context.ts";
import { normalizePlatformAmoCrmAccountDomain } from "../platform-amocrm-discovery-contract.ts";
import {
  PLATFORM_AMOCRM_READ_MAX_RESPONSE_BYTES,
  PLATFORM_AMOCRM_READ_REQUEST_INTERVAL_MS,
  PLATFORM_AMOCRM_READ_TIMEOUT_MS,
} from "./platform-amocrm-read-config.ts";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type RequestPacer = () => Promise<void>;

type RequestOptions = Readonly<{
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
  maxResponseBytes?: number;
  requestPacer?: RequestPacer;
}>;

export type PlatformAmoCrmCanonicalContextInput = Readonly<{
  accountDomain: string;
  accessToken: string;
  amocrmAccountId: string;
  amocrmContactId: string;
  amocrmLeadId: string;
}>;

export type PlatformAmoCrmCanonicalContextFailureCode =
  | "invalid_configuration"
  | "provider_rejected"
  | "provider_not_found"
  | "provider_relationship_mismatch"
  | "provider_rate_limited"
  | "provider_http_error"
  | "provider_response_invalid"
  | "provider_response_too_large"
  | "request_timeout"
  | "transport_failure";

export class PlatformAmoCrmCanonicalContextClientError extends Error {
  readonly code: PlatformAmoCrmCanonicalContextFailureCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: PlatformAmoCrmCanonicalContextFailureCode,
    options: Readonly<{
      status?: number | null;
      retryAfterSeconds?: number | null;
    }> = {},
  ) {
    super("amoCRM canonical context is unavailable.");
    this.name = "PlatformAmoCrmCanonicalContextClientError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function invalidConfiguration(): never {
  throw new PlatformAmoCrmCanonicalContextClientError("invalid_configuration");
}

function providerResponseInvalid(): never {
  throw new PlatformAmoCrmCanonicalContextClientError("provider_response_invalid");
}

function providerRelationshipMismatch(): never {
  throw new PlatformAmoCrmCanonicalContextClientError("provider_relationship_mismatch");
}

function integerOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) {
    return invalidConfiguration();
  }
  return selected;
}

function normalizeAccessToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 4096 ||
    value !== value.trim()
  ) {
    return invalidConfiguration();
  }
  return value;
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return providerResponseInvalid();
  }
  return value as Record<string, unknown>;
}

function requiredName(value: unknown): string {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value.length > 255
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return providerResponseInvalid();
  }
  return value.trim();
}

function requiredProviderId(value: unknown): string {
  const normalized = parsePlatformAmoCrmCanonicalProviderId(value);
  if (normalized === null) return providerResponseInvalid();
  return normalized;
}

function optionalRetryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

async function parseJsonWithBounds(
  response: Response,
  maxResponseBytes: number,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    return response.json();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      throw new PlatformAmoCrmCanonicalContextClientError("provider_response_too_large");
    }
    chunks.push(value);
  }

  try {
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    return JSON.parse(body) as unknown;
  } catch {
    return providerResponseInvalid();
  }
}

function normalizeLinks(
  response: Record<string, unknown>,
  key: "contacts" | "leads",
): readonly string[] {
  const embedded = requiredRecord(response._embedded);
  const rows = embedded[key];
  if (!Array.isArray(rows)) return providerResponseInvalid();
  return rows.map((row) => {
    const current = requiredRecord(row);
    return requiredProviderId(current.id);
  });
}

function findPipelineStatus(
  response: unknown,
  pipelineId: string,
  statusId: string,
): Readonly<{
  pipelineName: string;
  stageName: string;
}> {
  const pipeline = requiredRecord(response);
  if (requiredProviderId(pipeline.id) !== pipelineId) return providerResponseInvalid();
  const pipelineName = requiredName(pipeline.name);
  const embedded = requiredRecord(pipeline._embedded);
  const statuses = embedded.statuses;
  if (!Array.isArray(statuses)) return providerResponseInvalid();
  const stage = statuses.find((current) => {
    const row = requiredRecord(current);
    return requiredProviderId(row.id) === statusId;
  });
  if (!stage) return providerResponseInvalid();
  return {
    pipelineName,
    stageName: requiredName(requiredRecord(stage).name),
  };
}

function mapProviderError(
  response: Response,
): PlatformAmoCrmCanonicalContextClientError {
  const retryAfterSeconds = optionalRetryAfterSeconds(response);
  if (response.status === 401 || response.status === 402 || response.status === 403) {
    return new PlatformAmoCrmCanonicalContextClientError("provider_rejected", {
      status: response.status,
      retryAfterSeconds,
    });
  }
  if (response.status === 404) {
    return new PlatformAmoCrmCanonicalContextClientError("provider_not_found", {
      status: response.status,
      retryAfterSeconds,
    });
  }
  if (response.status === 429) {
    return new PlatformAmoCrmCanonicalContextClientError("provider_rate_limited", {
      status: response.status,
      retryAfterSeconds,
    });
  }
  return new PlatformAmoCrmCanonicalContextClientError("provider_http_error", {
    status: response.status,
    retryAfterSeconds,
  });
}

export function createPlatformAmoCrmCanonicalContextRequestPacer(): RequestPacer {
  let nextStart = 0;
  return async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextStart - now);
    nextStart = Math.max(nextStart, now) + PLATFORM_AMOCRM_READ_REQUEST_INTERVAL_MS;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };
}

const processRequestPacer = createPlatformAmoCrmCanonicalContextRequestPacer();

function toReasonCode(
  error: PlatformAmoCrmCanonicalContextClientError,
): PlatformAmoCrmCanonicalContextReasonCode {
  switch (error.code) {
    case "provider_not_found":
      return "provider_not_found";
    case "provider_relationship_mismatch":
      return "provider_relationship_mismatch";
    case "provider_rate_limited":
      return "provider_rate_limited";
    case "provider_http_error":
      return "provider_http_error";
    case "request_timeout":
      return "provider_timeout";
    case "transport_failure":
      return "provider_unreachable";
    case "provider_response_invalid":
    case "provider_response_too_large":
      return "provider_invalid_response";
    case "provider_rejected":
      return "provider_auth_failed";
    case "invalid_configuration":
      return "invalid_configuration";
    default:
      return "unknown";
  }
}

export type PlatformAmoCrmCanonicalContextObserved = Readonly<{
  state: "available" | "degraded";
  reasonCode: PlatformAmoCrmCanonicalContextReasonCode | null;
  attemptedAt: string;
  observedAt: string;
  responsibleUserResolution: "resolved" | "permission_denied" | "not_assigned";
  relationshipIds: Readonly<{
    amocrmAccountId: string;
    amocrmContactId: string;
    amocrmLeadId: string;
    pipelineId: string;
    statusId: string;
    responsibleUserId: string | null;
  }>;
  responsibleUserActive: boolean | null;
  observedCapabilities: readonly string[];
  context: PlatformAmoCrmCanonicalContext;
}>;

export async function readPlatformAmoCrmCanonicalContext(
  input: PlatformAmoCrmCanonicalContextInput,
  options: RequestOptions = {},
): Promise<PlatformAmoCrmCanonicalContextObserved> {
  const accountDomain = normalizePlatformAmoCrmAccountDomain(input.accountDomain);
  const accessToken = normalizeAccessToken(input.accessToken);
  const amocrmAccountId = requiredProviderId(input.amocrmAccountId);
  const amocrmContactId = requiredProviderId(input.amocrmContactId);
  const amocrmLeadId = requiredProviderId(input.amocrmLeadId);
  const timeoutMs = integerOption(options.timeoutMs, PLATFORM_AMOCRM_READ_TIMEOUT_MS, 100, 60_000);
  const maxResponseBytes = integerOption(
    options.maxResponseBytes,
    PLATFORM_AMOCRM_READ_MAX_RESPONSE_BYTES,
    32,
    1024 * 1024,
  );
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const pace = options.requestPacer ?? processRequestPacer;

  async function get(pathname: string): Promise<unknown> {
    await pace();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImplementation(`${accountDomain.origin}${pathname}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });

      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        return providerResponseInvalid();
      }
      if (!response.ok) throw mapProviderError(response);
      return parseJsonWithBounds(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof PlatformAmoCrmCanonicalContextClientError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new PlatformAmoCrmCanonicalContextClientError("request_timeout");
      }
      throw new PlatformAmoCrmCanonicalContextClientError("transport_failure");
    } finally {
      clearTimeout(timeout);
    }
  }

  const attemptedAt = new Date().toISOString();
  try {
    const account = requiredRecord(await get("/api/v4/account"));
    if (requiredProviderId(account.id) !== amocrmAccountId) {
      return providerRelationshipMismatch();
    }

    const contact = requiredRecord(
      await get(`/api/v4/contacts/${amocrmContactId}?with=leads`),
    );
    if (requiredProviderId(contact.id) !== amocrmContactId) {
      return providerRelationshipMismatch();
    }

    const lead = requiredRecord(await get(`/api/v4/leads/${amocrmLeadId}?with=contacts`));
    if (requiredProviderId(lead.id) !== amocrmLeadId) {
      return providerRelationshipMismatch();
    }

    const contactLeadIds = normalizeLinks(contact, "leads");
    const leadContactIds = normalizeLinks(lead, "contacts");
    if (!contactLeadIds.includes(amocrmLeadId) || !leadContactIds.includes(amocrmContactId)) {
      return providerRelationshipMismatch();
    }

    const pipelineId = requiredProviderId(lead.pipeline_id);
    const statusId = requiredProviderId(lead.status_id);
    const responsibleUserId = lead.responsible_user_id === null
      ? null
      : requiredProviderId(lead.responsible_user_id);

    const pipeline = await get(`/api/v4/leads/pipelines/${pipelineId}`);
    const { pipelineName, stageName } = findPipelineStatus(pipeline, pipelineId, statusId);

    let responsibleUserName: string | null = null;
    let responsibleUserActive: boolean | null = null;
    let state: "available" | "degraded" = "available";
    let reasonCode: PlatformAmoCrmCanonicalContextReasonCode | null = null;
    let responsibleUserResolution: "resolved" | "permission_denied" | "not_assigned" =
      "not_assigned";
    const observedCapabilities = [
      "account.read",
      "contact.read",
      "lead.read",
      "pipeline.read",
    ];

    if (responsibleUserId !== null) {
      try {
        const user = requiredRecord(await get(`/api/v4/users/${responsibleUserId}`));
        if (requiredProviderId(user.id) !== responsibleUserId) return providerResponseInvalid();
        responsibleUserName = requiredName(user.name);
        responsibleUserResolution = "resolved";
        observedCapabilities.push("user.read");
        const rights = requiredRecord(user.rights);
        if (typeof rights.is_active !== "boolean") return providerResponseInvalid();
        responsibleUserActive = rights.is_active;
      } catch (error) {
        if (
          error instanceof PlatformAmoCrmCanonicalContextClientError &&
          error.code === "provider_rejected" &&
          error.status === 403
        ) {
          state = "degraded";
          reasonCode = "responsible_user_forbidden";
          responsibleUserResolution = "permission_denied";
        } else {
          throw error;
        }
      }
    }

    const observedAt = new Date().toISOString();
    return Object.freeze({
      state,
      reasonCode,
      attemptedAt,
      observedAt,
      responsibleUserResolution,
      observedCapabilities,
      relationshipIds: Object.freeze({
        amocrmAccountId,
        amocrmContactId,
        amocrmLeadId,
        pipelineId,
        statusId,
        responsibleUserId,
      }),
      responsibleUserActive,
      context: buildPlatformAmoCrmCanonicalContext({
        state,
        reason_code: reasonCode,
        contact_name: requiredName(contact.name),
        lead_name: requiredName(lead.name),
        responsible_user_name: responsibleUserName,
        responsible_user_active: responsibleUserActive,
        responsible_user_resolution: responsibleUserResolution,
        pipeline_name: pipelineName,
        status_name: stageName,
        provider_observed_at: observedAt,
        last_attempt_at: attemptedAt,
      }),
    });
  } catch (error) {
    if (error instanceof PlatformAmoCrmCanonicalContextClientError) {
      throw new PlatformAmoCrmCanonicalContextClientError(error.code, {
        status: error.status,
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    throw new PlatformAmoCrmCanonicalContextClientError("provider_response_invalid");
  }
}

export function buildUnavailableCanonicalContextFromError(
  error: PlatformAmoCrmCanonicalContextClientError,
  attemptedAt: string,
): PlatformAmoCrmCanonicalContext {
  return buildPlatformAmoCrmCanonicalContext({
    state: "unavailable",
    reason_code: toReasonCode(error),
    responsible_user_resolution: null,
    last_attempt_at: attemptedAt,
  });
}
