import "server-only";

import { createHash } from "node:crypto";

import type { CanonicalAmoCrmCommandConfig } from "./canonical-amocrm-command-config.ts";
import {
  CanonicalAmoCrmDiscoveryRepositoryError,
  createCanonicalAmoCrmDiscoveryRepository,
  type CanonicalAmoCrmDiscoveryRepository,
  type CanonicalAmoCrmSanitizedCatalog,
} from "./canonical-amocrm-discovery-repository.ts";
import type { CanonicalAmoCrmReadProvider } from "./canonical-amocrm-provider.ts";
import type { CanonicalAmoCrmProviderConfig } from "./canonical-amocrm-provider-config.ts";

const PROVIDER_ID_PATTERN = /^[1-9][0-9]{0,9}$/u;
const MAX_PROVIDER_ID = "2147483647";
const ACCOUNT_DOMAIN_PATTERN =
  /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(amocrm\.ru|kommo\.com)$/u;
const MAX_COLLECTION_ITEMS = 10_000;
const MAX_CATALOG_BYTES = 1_048_576;
const MAX_NAME_BYTES = 512;
const MAX_FIELD_TYPE_BYTES = 128;
const MAX_CORRELATION_ID_BYTES = 255;

type ReadyProviderConfig = Extract<
  CanonicalAmoCrmProviderConfig,
  Readonly<{ status: "ready" }>
>;

export type CanonicalAmoCrmDiscoveryErrorCode =
  | "provider_configuration_invalid"
  | "provider_response_invalid"
  | "account_mismatch"
  | "mapping_invalid"
  | "contact_field_mapping_invalid"
  | "catalog_too_large"
  | "invalid_correlation_id"
  | "persistence_failed";

export class CanonicalAmoCrmDiscoveryError extends Error {
  readonly code: CanonicalAmoCrmDiscoveryErrorCode;

  constructor(code: CanonicalAmoCrmDiscoveryErrorCode) {
    const messages: Record<CanonicalAmoCrmDiscoveryErrorCode, string> = {
      provider_configuration_invalid:
        "Canonical amoCRM provider configuration is not ready for discovery.",
      provider_response_invalid:
        "The connected amoCRM account returned invalid discovery data.",
      account_mismatch:
        "The connected amoCRM account does not match the configured V2 account.",
      mapping_invalid:
        "The configured amoCRM role routing does not match the discovered account.",
      contact_field_mapping_invalid:
        "The connected amoCRM account does not expose one exact PHONE and EMAIL contact field.",
      catalog_too_large:
        "The sanitized amoCRM discovery catalog exceeds the persistence boundary.",
      invalid_correlation_id:
        "The amoCRM discovery correlation identifier is invalid.",
      persistence_failed:
        "The canonical amoCRM discovery evidence could not be persisted.",
    };
    super(messages[code]);
    this.name = "CanonicalAmoCrmDiscoveryError";
    this.code = code;
  }
}

type SanitizedStatus = Readonly<{
  id: string;
  name: string;
  sort: number;
  type: number | null;
  isEditable: boolean | null;
}>;

type SanitizedPipeline = Readonly<{
  id: string;
  name: string;
  isMain: boolean;
  isArchive: boolean;
  statuses: readonly SanitizedStatus[];
}>;

type SanitizedUser = Readonly<{
  id: string;
  name: string;
  isActive: boolean;
}>;

type SanitizedTag = Readonly<{
  id: string;
  name: string;
}>;

type SanitizedCustomField = Readonly<{
  id: string;
  name: string;
  code: string | null;
  type: string;
  enums: readonly Readonly<{
    id: string;
    value: string;
    sort: number;
  }>[];
}>;

type SanitizedAccount = Readonly<{
  providerAccountId: string;
  accountBaseUrl: string;
  accountSubdomain: string;
  accountName: string;
  timezone: string;
  country: string | null;
}>;

export type CanonicalAmoCrmResolvedRoleCommandRoute = Readonly<{
  pipelineId: string;
  statusId: string;
  responsibleUserId: string;
  tagId: string;
  tagName: string;
}>;

export type CanonicalAmoCrmCommandRoutingSnapshot = Readonly<{
  canonicalAccountId: string;
  discoverySnapshotId: string;
  providerAccountId: string;
  accountBaseUrl: string;
  snapshotSha256: string;
  discoveredAt: string;
  sales: CanonicalAmoCrmResolvedRoleCommandRoute;
  admissions: CanonicalAmoCrmResolvedRoleCommandRoute;
  contactCustomFields: Readonly<{
    phoneFieldId: string;
    emailFieldId: string;
  }>;
}>;

export type DiscoverCanonicalAmoCrmCommandRoutingInput = Readonly<{
  providerConfig: ReadyProviderConfig;
  commandConfig: CanonicalAmoCrmCommandConfig;
  provider: CanonicalAmoCrmReadProvider;
  repository?: CanonicalAmoCrmDiscoveryRepository;
  correlationId: string;
  now?: () => Date;
}>;

function invalidResponse(): never {
  throw new CanonicalAmoCrmDiscoveryError("provider_response_invalid");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidResponse();
  }
  return value as Record<string, unknown>;
}

function collection(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    return invalidResponse();
  }
  return value;
}

function embeddedCollection(value: unknown, name: string): unknown[] {
  const response = record(value);
  const embedded = record(response._embedded);
  return collection(embedded[name]);
}

function boundedExactText(value: unknown, maximumBytes = MAX_NAME_BYTES): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    return invalidResponse();
  }
  return value;
}

function providerId(value: unknown): string {
  const parsed =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : invalidResponse();
  if (
    !PROVIDER_ID_PATTERN.test(parsed) ||
    parsed.length > MAX_PROVIDER_ID.length ||
    (parsed.length === MAX_PROVIDER_ID.length && parsed > MAX_PROVIDER_ID)
  ) {
    return invalidResponse();
  }
  return parsed;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) return invalidResponse();
  return value as number;
}

function optionalInteger(value: unknown): number | null {
  return value === undefined || value === null ? null : integer(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalidResponse();
  return value;
}

function optionalBoolean(value: unknown): boolean | null {
  return value === undefined || value === null ? null : boolean(value);
}

function compareProviderIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

function uniqueSorted<T extends Readonly<{ id: string }>>(values: T[]): T[] {
  const sorted = values.sort((left, right) =>
    compareProviderIds(left.id, right.id),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]!.id === sorted[index]!.id) return invalidResponse();
  }
  return sorted;
}

function parseAccount(
  value: unknown,
  config: ReadyProviderConfig,
): SanitizedAccount {
  const configuredDomain = ACCOUNT_DOMAIN_PATTERN.exec(config.accountDomain);
  if (
    config.status !== "ready" ||
    config.accountOrigin !== `https://${config.accountDomain}` ||
    !configuredDomain ||
    configuredDomain[1] !== config.accountSubdomain
  ) {
    throw new CanonicalAmoCrmDiscoveryError(
      "provider_configuration_invalid",
    );
  }

  const source = record(value);
  const links = record(source._links);
  const self = record(links.self);
  const href = boundedExactText(self.href, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return invalidResponse();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/api/v4/account" ||
    parsed.origin !== config.accountOrigin ||
    parsed.hostname !== config.accountDomain
  ) {
    throw new CanonicalAmoCrmDiscoveryError("account_mismatch");
  }

  const accountSubdomain = boundedExactText(source.subdomain, 63).toLowerCase();
  if (accountSubdomain !== config.accountSubdomain) {
    throw new CanonicalAmoCrmDiscoveryError("account_mismatch");
  }

  const rawCountry = source.country;
  const country =
    rawCountry === undefined || rawCountry === null
      ? null
      : boundedExactText(rawCountry, 128);
  return Object.freeze({
    providerAccountId: providerId(source.id),
    accountBaseUrl: config.accountOrigin,
    accountSubdomain,
    accountName: boundedExactText(source.name, 255),
    timezone: boundedExactText(source.timezone, 128),
    country,
  });
}

function parseStatus(value: unknown): SanitizedStatus {
  const source = record(value);
  return Object.freeze({
    id: providerId(source.id),
    name: boundedExactText(source.name),
    sort: integer(source.sort),
    type: optionalInteger(source.type),
    isEditable: optionalBoolean(source.is_editable),
  });
}

function parsePipeline(value: unknown): SanitizedPipeline {
  const source = record(value);
  const embedded = record(source._embedded);
  const statuses = uniqueSorted(collection(embedded.statuses).map(parseStatus));
  if (statuses.length === 0) return invalidResponse();
  return Object.freeze({
    id: providerId(source.id),
    name: boundedExactText(source.name),
    isMain: boolean(source.is_main),
    isArchive: boolean(source.is_archive),
    statuses: Object.freeze(statuses),
  });
}

function parsePipelines(value: unknown): readonly SanitizedPipeline[] {
  const pipelines = uniqueSorted(
    embeddedCollection(value, "pipelines").map(parsePipeline),
  );
  if (pipelines.length === 0) return invalidResponse();
  return Object.freeze(pipelines);
}

function parseUser(value: unknown): SanitizedUser {
  const source = record(value);
  const rights = record(source.rights);
  return Object.freeze({
    id: providerId(source.id),
    name: boundedExactText(source.name),
    isActive: boolean(rights.is_active),
  });
}

function parseUsers(value: unknown): readonly SanitizedUser[] {
  const users = uniqueSorted(embeddedCollection(value, "users").map(parseUser));
  if (users.length === 0) return invalidResponse();
  return Object.freeze(users);
}

function parseTag(value: unknown): SanitizedTag {
  const source = record(value);
  return Object.freeze({
    id: providerId(source.id),
    name: boundedExactText(source.name, 128),
  });
}

function parseLeadTags(value: unknown): readonly SanitizedTag[] {
  return Object.freeze(
    uniqueSorted(embeddedCollection(value, "tags").map(parseTag)),
  );
}

function parseFieldCode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const code = boundedExactText(value, MAX_FIELD_TYPE_BYTES);
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(code)) return invalidResponse();
  return code;
}

function parseCustomField(value: unknown): SanitizedCustomField {
  const source = record(value);
  const rawEnums = source.enums;
  const enums =
    rawEnums === undefined || rawEnums === null
      ? []
      : uniqueSorted(
          collection(rawEnums).map((rawEnum) => {
            const enumSource = record(rawEnum);
            return Object.freeze({
              id: providerId(enumSource.id),
              value: boundedExactText(enumSource.value),
              sort: integer(enumSource.sort),
            });
          }),
        );
  const rawType = source.type;
  const type =
    typeof rawType === "number"
      ? String(integer(rawType))
      : boundedExactText(rawType, MAX_FIELD_TYPE_BYTES);
  return Object.freeze({
    id: providerId(source.id),
    name: boundedExactText(source.name),
    code: parseFieldCode(source.code),
    type,
    enums: Object.freeze(enums),
  });
}

function parseCustomFields(value: unknown): readonly SanitizedCustomField[] {
  return Object.freeze(
    uniqueSorted(
      embeddedCollection(value, "custom_fields").map(parseCustomField),
    ),
  );
}

function resolveRoute(
  route: CanonicalAmoCrmCommandConfig["sales"],
  pipelines: readonly SanitizedPipeline[],
  users: readonly SanitizedUser[],
  leadTags: readonly SanitizedTag[],
): CanonicalAmoCrmResolvedRoleCommandRoute {
  const pipeline = pipelines.find(
    (candidate) => candidate.id === route.pipelineId,
  );
  const user = users.find(
    (candidate) => candidate.id === route.responsibleUserId,
  );
  const matchingTags = leadTags.filter(
    (candidate) => candidate.name === route.tagName,
  );
  if (
    !pipeline ||
    pipeline.isArchive ||
    !pipeline.statuses.some((status) => status.id === route.statusId) ||
    !user ||
    !user.isActive ||
    matchingTags.length !== 1
  ) {
    throw new CanonicalAmoCrmDiscoveryError("mapping_invalid");
  }
  return Object.freeze({
    ...route,
    tagId: matchingTags[0]!.id,
  });
}

function exactContactField(
  fields: readonly SanitizedCustomField[],
  code: "PHONE" | "EMAIL",
): SanitizedCustomField {
  const matches = fields.filter((field) => field.code === code);
  if (matches.length !== 1) {
    throw new CanonicalAmoCrmDiscoveryError(
      "contact_field_mapping_invalid",
    );
  }
  return matches[0]!;
}

function catalog<T extends Readonly<{ id: string }>>(
  value: readonly T[],
): CanonicalAmoCrmSanitizedCatalog {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CATALOG_BYTES) {
    throw new CanonicalAmoCrmDiscoveryError("catalog_too_large");
  }
  return value as CanonicalAmoCrmSanitizedCatalog;
}

function correlationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > MAX_CORRELATION_ID_BYTES
  ) {
    throw new CanonicalAmoCrmDiscoveryError("invalid_correlation_id");
  }
  return value;
}

function discoveryTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return invalidResponse();
  }
  return new Date(value.getTime());
}

function discoveryHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export async function discoverCanonicalAmoCrmCommandRouting(
  input: DiscoverCanonicalAmoCrmCommandRoutingInput,
): Promise<CanonicalAmoCrmCommandRoutingSnapshot> {
  const safeCorrelationId = correlationId(input.correlationId);
  const discoveredAt = discoveryTime(input.now);
  const accountResponse = await input.provider.getAccount();
  const account = parseAccount(accountResponse, input.providerConfig);
  const pipelineResponse = await input.provider.getPipelines();
  const leadTagResponse = await input.provider.getLeadTags();
  const userResponse = await input.provider.getUsers();
  const leadFieldResponse = await input.provider.getLeadCustomFields();
  const contactFieldResponse = await input.provider.getContactCustomFields();

  const pipelines = parsePipelines(pipelineResponse);
  const leadTags = parseLeadTags(leadTagResponse);
  const users = parseUsers(userResponse);
  const leadCustomFields = parseCustomFields(leadFieldResponse);
  const contactCustomFields = parseCustomFields(contactFieldResponse);

  const sales = resolveRoute(
    input.commandConfig.sales,
    pipelines,
    users,
    leadTags,
  );
  const admissions = resolveRoute(
    input.commandConfig.admissions,
    pipelines,
    users,
    leadTags,
  );
  const phoneField = exactContactField(contactCustomFields, "PHONE");
  const emailField = exactContactField(contactCustomFields, "EMAIL");

  const pipelineCatalog = catalog(pipelines);
  const leadTagCatalog = catalog(leadTags);
  const userCatalog = catalog(users);
  const leadCustomFieldCatalog = catalog(leadCustomFields);
  const contactCustomFieldCatalog = catalog(contactCustomFields);
  const snapshotSha256 = discoveryHash({
    schemaVersion: 2,
    account,
    pipelineCatalog,
    leadTagCatalog,
    userCatalog,
    leadCustomFieldCatalog,
    contactCustomFieldCatalog,
  });

  const repository =
    input.repository ?? createCanonicalAmoCrmDiscoveryRepository();
  let persisted: Awaited<ReturnType<CanonicalAmoCrmDiscoveryRepository["persist"]>>;
  try {
    persisted = await repository.persist({
      account,
      snapshot: Object.freeze({
        snapshotSha256,
        pipelineCatalog,
        leadTagCatalog,
        userCatalog,
        leadCustomFieldCatalog,
        contactCustomFieldCatalog,
        correlationId: safeCorrelationId,
        discoveredAt,
      }),
    });
  } catch (error) {
    if (
      error instanceof CanonicalAmoCrmDiscoveryRepositoryError &&
      error.code === "account_mismatch"
    ) {
      throw new CanonicalAmoCrmDiscoveryError("account_mismatch");
    }
    throw new CanonicalAmoCrmDiscoveryError("persistence_failed");
  }

  return Object.freeze({
    canonicalAccountId: persisted.accountId,
    discoverySnapshotId: persisted.snapshotId,
    providerAccountId: account.providerAccountId,
    accountBaseUrl: account.accountBaseUrl,
    snapshotSha256,
    discoveredAt: persisted.discoveredAt.toISOString(),
    sales,
    admissions,
    contactCustomFields: Object.freeze({
      phoneFieldId: phoneField.id,
      emailFieldId: emailField.id,
    }),
  });
}
