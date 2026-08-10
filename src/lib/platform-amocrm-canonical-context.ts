const POSITIVE_INTEGER_PATTERN = /^\d+$/;
const MAX_POSTGRES_BIGINT = "9223372036854775807";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SAFE_REASON_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_NAME_LENGTH = 255;

export const PLATFORM_AMOCRM_CANONICAL_CONTEXT_CONTRACT_VERSION = 1 as const;
export const PLATFORM_AMOCRM_CANONICAL_CONTEXT_REFRESH_TTL_MS = 60_000;
export const PLATFORM_AMOCRM_CANONICAL_CONTEXT_STALE_TTL_MS = 15 * 60_000;

export const PLATFORM_AMOCRM_CANONICAL_CONTEXT_STATES = [
  "available",
  "degraded",
  "stale",
  "unavailable",
  "disabled",
  "not_linked",
] as const;

export type PlatformAmoCrmCanonicalContextState =
  (typeof PLATFORM_AMOCRM_CANONICAL_CONTEXT_STATES)[number];

export const PLATFORM_AMOCRM_CANONICAL_CONTEXT_REASON_CODES = [
  "disabled_by_config",
  "missing_configuration",
  "invalid_configuration",
  "configuration_scope_mismatch",
  "missing_binding",
  "provider_rejected",
  "provider_not_found",
  "provider_rate_limited",
  "provider_timeout",
  "provider_transport_failure",
  "provider_response_invalid",
  "provider_relationship_mismatch",
  "provider_auth_failed",
  "provider_binding_mismatch",
  "provider_http_error",
  "provider_invalid_response",
  "provider_unreachable",
  "responsible_user_forbidden",
  "refresh_failed",
  "unknown",
] as const;

export type PlatformAmoCrmCanonicalContextReasonCode =
  (typeof PLATFORM_AMOCRM_CANONICAL_CONTEXT_REASON_CODES)[number];

export type PlatformAmoCrmResponsibleUserResolution =
  | "resolved"
  | "permission_denied"
  | "not_assigned"
  | null;

export type PlatformAmoCrmCanonicalContext = Readonly<{
  state: PlatformAmoCrmCanonicalContextState;
  reason_code: PlatformAmoCrmCanonicalContextReasonCode | null;
  contact_name: string | null;
  lead_name: string | null;
  responsible_user_name: string | null;
  responsible_user_active: boolean | null;
  responsible_user_resolution: PlatformAmoCrmResponsibleUserResolution;
  pipeline_name: string | null;
  status_name: string | null;
  provider_observed_at: string | null;
  last_attempt_at: string | null;
  adapter_contract_version: typeof PLATFORM_AMOCRM_CANONICAL_CONTEXT_CONTRACT_VERSION;
  version: number;
}>;

export class PlatformAmoCrmCanonicalContextContractError extends Error {
  constructor() {
    super("amoCRM canonical context is invalid.");
    this.name = "PlatformAmoCrmCanonicalContextContractError";
  }
}

function invalidShape(): never {
  throw new PlatformAmoCrmCanonicalContextContractError();
}

function requiredPositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return invalidShape();
  }
  return value;
}

function parseState(value: unknown): PlatformAmoCrmCanonicalContextState {
  if (
    typeof value !== "string" ||
    !(PLATFORM_AMOCRM_CANONICAL_CONTEXT_STATES as readonly string[]).includes(value)
  ) {
    return invalidShape();
  }
  return value as PlatformAmoCrmCanonicalContextState;
}

function parseOptionalReasonCode(
  value: unknown,
): PlatformAmoCrmCanonicalContextReasonCode | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !SAFE_REASON_PATTERN.test(value)) return invalidShape();
  if (
    (PLATFORM_AMOCRM_CANONICAL_CONTEXT_REASON_CODES as readonly string[]).includes(value)
  ) {
    return value as PlatformAmoCrmCanonicalContextReasonCode;
  }
  return invalidShape();
}

function parseOptionalName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_NAME_LENGTH) return invalidShape();
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return invalidShape();
  return normalized;
}

function parseOptionalTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !TIMESTAMPTZ_PATTERN.test(value)) return invalidShape();
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return invalidShape();
  return value;
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") return invalidShape();
  return value;
}

function parseResponsibleUserResolution(
  value: unknown,
): PlatformAmoCrmResponsibleUserResolution {
  if (value === null || value === undefined) return null;
  if (
    value === "resolved" ||
    value === "permission_denied" ||
    value === "not_assigned"
  ) {
    return value;
  }
  return invalidShape();
}

function namesPresent(value: PlatformAmoCrmCanonicalContext): boolean {
  return (
    value.contact_name !== null
    && value.lead_name !== null
    && value.pipeline_name !== null
    && value.status_name !== null
  );
}

export function parsePlatformAmoCrmCanonicalProviderId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== "string" || !POSITIVE_INTEGER_PATTERN.test(value)) return null;
  const normalized = value.replace(/^0+/, "");
  const selected = normalized.length === 0 ? "0" : normalized;
  if (selected === "0" || BigInt(selected) > BigInt(MAX_POSTGRES_BIGINT)) return null;
  return selected;
}

export function normalizePersistedPlatformAmoCrmCanonicalContext(
  value: unknown,
): PlatformAmoCrmCanonicalContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidShape();
  const row = value as Record<string, unknown>;
  const adapterContractVersion = requiredPositiveInteger(row.adapter_contract_version);
  if (adapterContractVersion !== PLATFORM_AMOCRM_CANONICAL_CONTEXT_CONTRACT_VERSION) {
    return invalidShape();
  }
  const normalized: PlatformAmoCrmCanonicalContext = Object.freeze({
    state: parseState(row.state),
    reason_code: parseOptionalReasonCode(row.reason_code),
    contact_name: parseOptionalName(row.contact_name),
    lead_name: parseOptionalName(row.lead_name),
    responsible_user_name: parseOptionalName(row.responsible_user_name),
    responsible_user_active: parseOptionalBoolean(row.responsible_user_active),
    responsible_user_resolution: parseResponsibleUserResolution(
      row.responsible_user_resolution,
    ),
    pipeline_name: parseOptionalName(row.pipeline_name),
    status_name: parseOptionalName(row.status_name),
    provider_observed_at: parseOptionalTimestamp(row.provider_observed_at),
    last_attempt_at: parseOptionalTimestamp(row.last_attempt_at),
    adapter_contract_version: PLATFORM_AMOCRM_CANONICAL_CONTEXT_CONTRACT_VERSION,
    version: requiredPositiveInteger(row.version),
  });

  if (
    (normalized.state === "available"
      || normalized.state === "degraded"
      || normalized.state === "stale")
    && !namesPresent(normalized)
  ) {
    return invalidShape();
  }

  if (
    normalized.state === "available"
    && (
      normalized.provider_observed_at === null
      || normalized.last_attempt_at === null
      || !(
        (
          normalized.responsible_user_resolution === "resolved"
          && normalized.responsible_user_name !== null
          && normalized.responsible_user_active !== null
        )
        || (
          normalized.responsible_user_resolution === "not_assigned"
          && normalized.responsible_user_name === null
          && normalized.responsible_user_active === null
        )
      )
    )
  ) {
    return invalidShape();
  }

  if (
    normalized.state === "stale"
    && (
      normalized.reason_code === null
      || normalized.provider_observed_at === null
      || normalized.last_attempt_at === null
      || !(
        (
          normalized.responsible_user_resolution === "resolved"
          && normalized.responsible_user_name !== null
          && normalized.responsible_user_active !== null
        )
        || (
          (normalized.responsible_user_resolution === "not_assigned"
            || normalized.responsible_user_resolution === "permission_denied")
          && normalized.responsible_user_name === null
          && normalized.responsible_user_active === null
        )
      )
    )
  ) {
    return invalidShape();
  }

  if (
    normalized.state === "degraded"
    && (
      normalized.reason_code !== "responsible_user_forbidden"
      || normalized.provider_observed_at === null
      || normalized.last_attempt_at === null
      || normalized.responsible_user_name !== null
      || normalized.responsible_user_active !== null
      || normalized.responsible_user_resolution !== "permission_denied"
    )
  ) {
    return invalidShape();
  }

  if (
    (normalized.state === "disabled"
      || normalized.state === "not_linked"
      || normalized.state === "unavailable")
    && normalized.reason_code === null
  ) {
    return invalidShape();
  }

  if (
    (normalized.state === "disabled"
      || normalized.state === "not_linked"
      || normalized.state === "unavailable")
    && (
      normalized.contact_name !== null
      || normalized.lead_name !== null
      || normalized.pipeline_name !== null
      || normalized.status_name !== null
      || normalized.responsible_user_name !== null
      || normalized.responsible_user_active !== null
      || normalized.responsible_user_resolution !== null
      || normalized.provider_observed_at !== null
    )
  ) {
    return invalidShape();
  }

  if (normalized.state === "unavailable" && normalized.last_attempt_at === null) {
    return invalidShape();
  }

  return normalized;
}

export function buildPlatformAmoCrmCanonicalContext(
  input: Readonly<Partial<PlatformAmoCrmCanonicalContext>>
    & Pick<PlatformAmoCrmCanonicalContext, "state">,
): PlatformAmoCrmCanonicalContext {
  return normalizePersistedPlatformAmoCrmCanonicalContext({
    state: input.state,
    reason_code: input.reason_code ?? null,
    contact_name: input.contact_name ?? null,
    lead_name: input.lead_name ?? null,
    responsible_user_name: input.responsible_user_name ?? null,
    responsible_user_active: input.responsible_user_active ?? null,
    responsible_user_resolution: input.responsible_user_resolution ?? null,
    pipeline_name: input.pipeline_name ?? null,
    status_name: input.status_name ?? null,
    provider_observed_at: input.provider_observed_at ?? null,
    last_attempt_at: input.last_attempt_at ?? null,
    adapter_contract_version: PLATFORM_AMOCRM_CANONICAL_CONTEXT_CONTRACT_VERSION,
    version: input.version ?? 1,
  });
}

export function requirePlatformAmoCrmCanonicalBinding(
  value: Readonly<{
    amocrmAccountId: unknown;
    amocrmContactId: unknown;
    amocrmLeadId: unknown;
  }>,
): Readonly<{
  amocrmAccountId: string;
  amocrmContactId: string;
  amocrmLeadId: string;
}> {
  const amocrmAccountId = parsePlatformAmoCrmCanonicalProviderId(value.amocrmAccountId);
  const amocrmContactId = parsePlatformAmoCrmCanonicalProviderId(value.amocrmContactId);
  const amocrmLeadId = parsePlatformAmoCrmCanonicalProviderId(value.amocrmLeadId);
  if (amocrmAccountId === null || amocrmContactId === null || amocrmLeadId === null) {
    return invalidShape();
  }
  return Object.freeze({
    amocrmAccountId,
    amocrmContactId,
    amocrmLeadId,
  });
}
