const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const MAX_POSTGRES_BIGINT = "9223372036854775807";
const ACCOUNT_DOMAIN_PATTERN =
  /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(amocrm\.ru|kommo\.com)$/;

const MAX_NAME_LENGTH = 512;
const MAX_FIELD_TYPE_LENGTH = 128;
const MAX_ITEMS_PER_COLLECTION = 10_000;

export type PlatformAmoCrmAccountDomain = Readonly<{
  domain: string;
  origin: string;
  subdomain: string;
}>;

export type PlatformAmoCrmMappingEnum = Readonly<{
  id: string;
  value: string;
  sort: number;
}>;

export type PlatformAmoCrmMappingCustomField = Readonly<{
  id: string;
  name: string;
  code: string | null;
  type: string;
  enums: readonly PlatformAmoCrmMappingEnum[];
}>;

export type PlatformAmoCrmMappingStatus = Readonly<{
  id: string;
  name: string;
  sort: number;
  is_editable: boolean | null;
  type: number | null;
}>;

export type PlatformAmoCrmMappingPipeline = Readonly<{
  id: string;
  name: string;
  is_main: boolean;
  is_archive: boolean;
  statuses: readonly PlatformAmoCrmMappingStatus[];
}>;

export type PlatformAmoCrmMappingUser = Readonly<{
  id: string;
  name: string;
  is_active: boolean;
}>;

export type PlatformAmoCrmMappingSnapshot = Readonly<{
  schema_version: 1;
  account: Readonly<{
    id: string;
    domain: string;
    subdomain: string;
  }>;
  pipelines: readonly PlatformAmoCrmMappingPipeline[];
  users: readonly PlatformAmoCrmMappingUser[];
  lead_custom_fields: readonly PlatformAmoCrmMappingCustomField[];
  contact_custom_fields: readonly PlatformAmoCrmMappingCustomField[];
}>;

type SnapshotSource = Readonly<{
  accountDomain: string;
  account: unknown;
  pipelines: unknown;
  users: unknown;
  leadCustomFields: unknown;
  contactCustomFields: unknown;
}>;

export class PlatformAmoCrmDiscoveryContractError extends Error {
  constructor() {
    super("amoCRM discovery data is invalid.");
    this.name = "PlatformAmoCrmDiscoveryContractError";
  }
}

function invalidShape(): never {
  throw new PlatformAmoCrmDiscoveryContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalidShape();
}

function requiredCollection(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_COLLECTION) {
    return invalidShape();
  }
  return value;
}

function embeddedCollection(value: unknown, key: string): readonly unknown[] {
  const envelope = requiredRecord(value);
  const embedded = requiredRecord(envelope._embedded);
  return requiredCollection(embedded[key]);
}

function requiredText(value: unknown, maximum = MAX_NAME_LENGTH): string {
  if (typeof value !== "string" || value.length > maximum) return invalidShape();
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return invalidShape();
  }
  return normalized;
}

function optionalCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredText(value, 128);
}

function requiredBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalidShape();
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return requiredBoolean(value);
}

function requiredInteger(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    return invalidShape();
  }
  return Number(value);
}

function optionalInteger(value: unknown, minimum = 0): number | null {
  if (value === null || value === undefined) return null;
  return requiredInteger(value, minimum);
}

export function parsePlatformAmoCrmProviderId(value: unknown): string | null {
  const normalized = typeof value === "number"
    ? Number.isSafeInteger(value) && value > 0
      ? String(value)
      : null
    : typeof value === "string" && POSITIVE_INTEGER_PATTERN.test(value)
      ? value
      : null;

  if (!normalized) return null;
  if (
    normalized.length > MAX_POSTGRES_BIGINT.length ||
    (normalized.length === MAX_POSTGRES_BIGINT.length &&
      normalized > MAX_POSTGRES_BIGINT)
  ) {
    return null;
  }
  return normalized;
}

function requiredProviderId(value: unknown): string {
  return parsePlatformAmoCrmProviderId(value) ?? invalidShape();
}

function compareProviderIds(left: { id: string }, right: { id: string }): number {
  if (left.id.length !== right.id.length) return left.id.length - right.id.length;
  return left.id.localeCompare(right.id);
}

function uniqueSorted<T extends { id: string }>(rows: readonly T[]): readonly T[] {
  const sorted = [...rows].sort(compareProviderIds);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]?.id === sorted[index]?.id) return invalidShape();
  }
  return sorted;
}

export function normalizePlatformAmoCrmAccountDomain(
  value: unknown,
): PlatformAmoCrmAccountDomain {
  if (typeof value !== "string" || value.length > 253) return invalidShape();
  const trimmed = value.trim();
  if (!trimmed) return invalidShape();

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return invalidShape();
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    return invalidShape();
  }

  const domain = parsed.hostname.toLowerCase();
  const match = ACCOUNT_DOMAIN_PATTERN.exec(domain);
  if (!match) return invalidShape();

  return {
    domain,
    origin: `https://${domain}`,
    subdomain: match[1] ?? invalidShape(),
  };
}

function normalizeStatus(value: unknown): PlatformAmoCrmMappingStatus {
  const row = requiredRecord(value);
  return {
    id: requiredProviderId(row.id),
    name: requiredText(row.name),
    sort: requiredInteger(row.sort),
    is_editable: optionalBoolean(row.is_editable),
    type: optionalInteger(row.type),
  };
}

function normalizePipeline(value: unknown): PlatformAmoCrmMappingPipeline {
  const row = requiredRecord(value);
  const embedded = requiredRecord(row._embedded);
  const statuses = uniqueSorted(
    requiredCollection(embedded.statuses).map(normalizeStatus),
  );
  if (statuses.length === 0) return invalidShape();

  return {
    id: requiredProviderId(row.id),
    name: requiredText(row.name),
    is_main: requiredBoolean(row.is_main),
    is_archive: requiredBoolean(row.is_archive),
    statuses,
  };
}

function normalizeUser(value: unknown): PlatformAmoCrmMappingUser {
  const row = requiredRecord(value);
  const rights = requiredRecord(row.rights);
  return {
    id: requiredProviderId(row.id),
    name: requiredText(row.name),
    is_active: requiredBoolean(rights.is_active),
  };
}

function normalizeEnum(value: unknown): PlatformAmoCrmMappingEnum {
  const row = requiredRecord(value);
  return {
    id: requiredProviderId(row.id),
    value: requiredText(row.value),
    sort: requiredInteger(row.sort),
  };
}

function normalizeCustomField(value: unknown): PlatformAmoCrmMappingCustomField {
  const row = requiredRecord(value);
  const enums = row.enums === undefined || row.enums === null
    ? []
    : uniqueSorted(requiredCollection(row.enums).map(normalizeEnum));

  const fieldType = typeof row.type === "number"
    ? String(requiredInteger(row.type))
    : requiredText(row.type, MAX_FIELD_TYPE_LENGTH);

  return {
    id: requiredProviderId(row.id),
    name: requiredText(row.name),
    code: optionalCode(row.code),
    type: fieldType,
    enums,
  };
}

/**
 * Converts read-only provider responses into the only JSON shape that may be
 * persisted by the Platform. Selecting fields explicitly is intentional: raw
 * responses, OAuth material, staff emails/phones and customer records never
 * cross this boundary.
 */
export function buildPlatformAmoCrmMappingSnapshot(
  source: SnapshotSource,
): PlatformAmoCrmMappingSnapshot {
  const accountDomain = normalizePlatformAmoCrmAccountDomain(source.accountDomain);
  const account = requiredRecord(source.account);
  const accountSubdomain = requiredText(account.subdomain, 63).toLowerCase();
  if (accountSubdomain !== accountDomain.subdomain) return invalidShape();

  const pipelines = uniqueSorted(
    embeddedCollection(source.pipelines, "pipelines").map(normalizePipeline),
  );
  const users = uniqueSorted(
    embeddedCollection(source.users, "users").map(normalizeUser),
  );
  if (pipelines.length === 0 || users.length === 0) return invalidShape();

  return {
    schema_version: 1,
    account: {
      id: requiredProviderId(account.id),
      domain: accountDomain.domain,
      subdomain: accountSubdomain,
    },
    pipelines,
    users,
    lead_custom_fields: uniqueSorted(
      embeddedCollection(source.leadCustomFields, "custom_fields").map(
        normalizeCustomField,
      ),
    ),
    contact_custom_fields: uniqueSorted(
      embeddedCollection(source.contactCustomFields, "custom_fields").map(
        normalizeCustomField,
      ),
    ),
  };
}

function normalizePersistedPipeline(value: unknown): PlatformAmoCrmMappingPipeline {
  const row = requiredRecord(value);
  const statuses = uniqueSorted(requiredCollection(row.statuses).map(normalizeStatus));
  if (statuses.length === 0) return invalidShape();
  return {
    id: requiredProviderId(row.id),
    name: requiredText(row.name),
    is_main: requiredBoolean(row.is_main),
    is_archive: requiredBoolean(row.is_archive),
    statuses,
  };
}

function normalizePersistedUser(value: unknown): PlatformAmoCrmMappingUser {
  const row = requiredRecord(value);
  return {
    id: requiredProviderId(row.id),
    name: requiredText(row.name),
    is_active: requiredBoolean(row.is_active),
  };
}

function normalizePersistedCustomField(
  value: unknown,
): PlatformAmoCrmMappingCustomField {
  const row = requiredRecord(value);
  return {
    id: requiredProviderId(row.id),
    name: requiredText(row.name),
    code: optionalCode(row.code),
    type: requiredText(row.type, MAX_FIELD_TYPE_LENGTH),
    enums: uniqueSorted(requiredCollection(row.enums).map(normalizeEnum)),
  };
}

/** Revalidates the JSON returned by the private Supabase RPC boundary. */
export function normalizePersistedPlatformAmoCrmMappingSnapshot(
  value: unknown,
): PlatformAmoCrmMappingSnapshot {
  const row = requiredRecord(value);
  if (row.schema_version !== 1) return invalidShape();
  const account = requiredRecord(row.account);
  const domain = normalizePlatformAmoCrmAccountDomain(account.domain);
  const subdomain = requiredText(account.subdomain, 63).toLowerCase();
  if (subdomain !== domain.subdomain) return invalidShape();

  const pipelines = uniqueSorted(
    requiredCollection(row.pipelines).map(normalizePersistedPipeline),
  );
  const users = uniqueSorted(
    requiredCollection(row.users).map(normalizePersistedUser),
  );
  if (pipelines.length === 0 || users.length === 0) return invalidShape();

  return {
    schema_version: 1,
    account: {
      id: requiredProviderId(account.id),
      domain: domain.domain,
      subdomain,
    },
    pipelines,
    users,
    lead_custom_fields: uniqueSorted(
      requiredCollection(row.lead_custom_fields).map(normalizePersistedCustomField),
    ),
    contact_custom_fields: uniqueSorted(
      requiredCollection(row.contact_custom_fields).map(
        normalizePersistedCustomField,
      ),
    ),
  };
}
