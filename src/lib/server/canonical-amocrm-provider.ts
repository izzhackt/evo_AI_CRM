import "server-only";

import { createHash } from "node:crypto";

import type { CanonicalAmoCrmProviderConfig } from "./canonical-amocrm-provider-config.ts";
import {
  parseCanonicalAmoCrmTokenSet,
  readCanonicalAmoCrmTokenFile,
  rotateCanonicalAmoCrmTokenFile,
  type CanonicalAmoCrmTokenSet,
} from "./canonical-amocrm-token-store.ts";

type CanonicalAmoCrmReadyConfig = Extract<
  CanonicalAmoCrmProviderConfig,
  { status: "ready" }
>;

export type CanonicalAmoCrmProviderErrorCode =
  | "invalid_request"
  | "token_unavailable"
  | "token_refresh_failed"
  | "authentication_failed"
  | "provider_rejected"
  | "provider_unavailable"
  | "request_timeout"
  | "response_too_large"
  | "invalid_response"
  | "discovery_incomplete";

export class CanonicalAmoCrmProviderError extends Error {
  readonly code: CanonicalAmoCrmProviderErrorCode;
  readonly status: number | null;
  readonly providerRequestId: string | null;

  constructor(
    code: CanonicalAmoCrmProviderErrorCode,
    options: Readonly<{
      status?: number;
      providerRequestId?: string | null;
    }> = {},
  ) {
    super("Canonical amoCRM provider request did not complete.");
    this.name = "CanonicalAmoCrmProviderError";
    this.code = code;
    this.status = options.status ?? null;
    this.providerRequestId = options.providerRequestId ?? null;
  }
}

export type CanonicalAmoCrmMutationOutcome = "rejected" | "unknown";

export type CanonicalAmoCrmRequestMetadata = Readonly<{
  method: "POST" | "PATCH";
  path: string;
  requestId: string | null;
}>;

export type CanonicalAmoCrmResponseMetadata = Readonly<{
  status: number;
  providerRequestId: string | null;
}>;

export class CanonicalAmoCrmMutationError extends CanonicalAmoCrmProviderError {
  readonly outcome: CanonicalAmoCrmMutationOutcome;
  readonly request: CanonicalAmoCrmRequestMetadata;
  readonly response: CanonicalAmoCrmResponseMetadata | null;

  constructor(
    code: CanonicalAmoCrmProviderErrorCode,
    options: Readonly<{
      outcome: CanonicalAmoCrmMutationOutcome;
      request: CanonicalAmoCrmRequestMetadata;
      response?: CanonicalAmoCrmResponseMetadata;
    }>,
  ) {
    super(code, {
      status: options.response?.status,
      providerRequestId: options.response?.providerRequestId,
    });
    this.name = "CanonicalAmoCrmMutationError";
    this.outcome = options.outcome;
    this.request = options.request;
    this.response = options.response ?? null;
  }
}

export type CanonicalAmoCrmProviderDependencies = Readonly<{
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}>;

export type CanonicalAmoCrmReadProvider = Readonly<{
  getAccount: () => Promise<unknown>;
  getPipelines: () => Promise<unknown>;
  getLeadTags: () => Promise<unknown>;
  getUsers: () => Promise<unknown>;
  getLeadCustomFields: () => Promise<unknown>;
  getContactCustomFields: () => Promise<unknown>;
}>;

type CanonicalAmoCrmScalar = string | number | boolean;

export type CanonicalAmoCrmCustomFieldValue = Readonly<{
  value: CanonicalAmoCrmScalar;
  enumId?: string | number;
  enumCode?: string;
}>;

export type CanonicalAmoCrmCustomField = Readonly<{
  fieldId: string | number;
  values: readonly CanonicalAmoCrmCustomFieldValue[];
}>;

export type CanonicalAmoCrmMutationResult = Readonly<{
  entityId: string;
  request: CanonicalAmoCrmRequestMetadata;
  response: CanonicalAmoCrmResponseMetadata;
}>;

export type CanonicalAmoCrmContactMutationInput = Readonly<{
  requestId: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  responsibleUserId?: string | number;
  customFieldsValues?: readonly CanonicalAmoCrmCustomField[];
}>;

export type CanonicalAmoCrmLeadMutationInput = Readonly<{
  requestId: string;
  name?: string;
  pipelineId?: string | number;
  statusId?: string | number;
  responsibleUserId?: string | number;
  price?: number;
  customFieldsValues?: readonly CanonicalAmoCrmCustomField[];
}>;

export type CanonicalAmoCrmUpdateContactInput =
  CanonicalAmoCrmContactMutationInput & Readonly<{ contactId: string | number }>;

export type CanonicalAmoCrmCreateLeadInput =
  CanonicalAmoCrmLeadMutationInput &
    Readonly<{
      name: string;
      pipelineId: string | number;
      statusId: string | number;
      responsibleUserId: string | number;
    }>;

export type CanonicalAmoCrmUpdateLeadInput =
  CanonicalAmoCrmLeadMutationInput & Readonly<{ leadId: string | number }>;

export type CanonicalAmoCrmLeadPipelineStatusInput = Readonly<{
  requestId: string;
  leadId: string | number;
  pipelineId: string | number;
  statusId: string | number;
}>;

export type CanonicalAmoCrmLeadResponsibleUserInput = Readonly<{
  requestId: string;
  leadId: string | number;
  responsibleUserId: string | number;
}>;

export type CanonicalAmoCrmContactLeadLinkInput = Readonly<{
  requestId: string;
  leadId: string | number;
  contactId: string | number;
}>;

export type CanonicalAmoCrmLeadNoteInput = Readonly<{
  requestId: string;
  leadId: string | number;
  text: string;
}>;

export type CanonicalAmoCrmLeadTagsInput = Readonly<{
  requestId: string;
  leadId: string | number;
  add?: readonly Readonly<{ id: string | number }>[];
  remove?: readonly Readonly<{ id: string | number }>[];
}>;

export type CanonicalAmoCrmEnsureLeadTagInput = Readonly<{
  requestId: string;
  name: string;
}>;

export type CanonicalAmoCrmPreparedMutation = Readonly<{
  request: CanonicalAmoCrmRequestMetadata;
  body: unknown;
  bodyJson: string;
  bodySha256: string;
  requestSha256: string;
  dispatch: () => Promise<CanonicalAmoCrmMutationResult>;
}>;

export type CanonicalAmoCrmWriteProvider = Readonly<{
  prepareCreateContact: (
    input: CanonicalAmoCrmContactMutationInput,
  ) => CanonicalAmoCrmPreparedMutation;
  createContact: (
    input: CanonicalAmoCrmContactMutationInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareUpdateContact: (
    input: CanonicalAmoCrmUpdateContactInput,
  ) => CanonicalAmoCrmPreparedMutation;
  updateContact: (
    input: CanonicalAmoCrmUpdateContactInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareCreateLead: (
    input: CanonicalAmoCrmCreateLeadInput,
  ) => CanonicalAmoCrmPreparedMutation;
  createLead: (
    input: CanonicalAmoCrmCreateLeadInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareUpdateLead: (
    input: CanonicalAmoCrmUpdateLeadInput,
  ) => CanonicalAmoCrmPreparedMutation;
  updateLead: (
    input: CanonicalAmoCrmUpdateLeadInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareUpdateLeadPipelineStatus: (
    input: CanonicalAmoCrmLeadPipelineStatusInput,
  ) => CanonicalAmoCrmPreparedMutation;
  updateLeadPipelineStatus: (
    input: CanonicalAmoCrmLeadPipelineStatusInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareUpdateLeadResponsibleUser: (
    input: CanonicalAmoCrmLeadResponsibleUserInput,
  ) => CanonicalAmoCrmPreparedMutation;
  updateLeadResponsibleUser: (
    input: CanonicalAmoCrmLeadResponsibleUserInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareLinkContactToLead: (
    input: CanonicalAmoCrmContactLeadLinkInput,
  ) => CanonicalAmoCrmPreparedMutation;
  linkContactToLead: (
    input: CanonicalAmoCrmContactLeadLinkInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareCreateLeadNote: (
    input: CanonicalAmoCrmLeadNoteInput,
  ) => CanonicalAmoCrmPreparedMutation;
  createLeadNote: (
    input: CanonicalAmoCrmLeadNoteInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareUpdateLeadTags: (
    input: CanonicalAmoCrmLeadTagsInput,
  ) => CanonicalAmoCrmPreparedMutation;
  updateLeadTags: (
    input: CanonicalAmoCrmLeadTagsInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  prepareEnsureLeadTag: (
    input: CanonicalAmoCrmEnsureLeadTagInput,
  ) => CanonicalAmoCrmPreparedMutation;
  ensureLeadTag: (
    input: CanonicalAmoCrmEnsureLeadTagInput,
  ) => Promise<CanonicalAmoCrmMutationResult>;
  getContactById: (contactId: string | number) => Promise<unknown>;
  getLeadById: (leadId: string | number) => Promise<unknown>;
  getLeadLinks: (leadId: string | number) => Promise<unknown>;
  getLeadNoteById: (
    leadId: string | number,
    noteId: string | number,
  ) => Promise<unknown>;
}>;

type PaceState = {
  nextStartMs: number;
  tail: Promise<void>;
};

const PACE_BY_ACCOUNT_ORIGIN = new Map<string, PaceState>();
const REFRESH_BY_TOKEN_FILE = new Map<
  string,
  Promise<CanonicalAmoCrmTokenSet>
>();

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function paced<T>(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  operation: () => Promise<T>,
): Promise<T> {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? defaultSleep;
  const state = PACE_BY_ACCOUNT_ORIGIN.get(config.accountOrigin) ?? {
    nextStartMs: 0,
    tail: Promise.resolve(),
  };
  PACE_BY_ACCOUNT_ORIGIN.set(config.accountOrigin, state);

  let release: () => void = () => undefined;
  const predecessor = state.tail;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await predecessor;

  try {
    const waitMs = Math.max(0, state.nextStartMs - now());
    if (waitMs > 0) await sleep(waitMs);
    state.nextStartMs = Math.max(state.nextStartMs, now()) + config.requestIntervalMs;
    const result = operation();
    release();
    return await result;
  } catch (error) {
    release();
    throw error;
  }
}

async function boundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new CanonicalAmoCrmProviderError("response_too_large");
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new CanonicalAmoCrmProviderError("response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

function parseJsonResponse(raw: string): unknown {
  if (raw === "") {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  return parsed;
}

type ProviderResponse = Readonly<{
  status: number;
  json: unknown | null;
  providerRequestId: string | null;
}>;

function providerRequestId(response: Response): string | null {
  for (const header of ["x-request-id", "x-correlation-id"]) {
    const value = response.headers.get(header)?.trim();
    if (value && value.length <= 255 && /^[A-Za-z0-9._:-]+$/u.test(value)) {
      return value;
    }
  }
  return null;
}

async function providerFetch(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  path: string,
  init: RequestInit,
  onDispatch?: () => void,
): Promise<ProviderResponse> {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ?? ((milliseconds) => AbortSignal.timeout(milliseconds));
  const signal = createTimeoutSignal(config.timeoutMs);

  let response: Response;
  try {
    response = await paced(config, dependencies, () => {
      onDispatch?.();
      return fetchImplementation(`${config.accountOrigin}${path}`, {
        ...init,
        redirect: "error",
        signal,
      });
    });
  } catch (error) {
    if (error instanceof CanonicalAmoCrmProviderError) throw error;
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
    if (signal.aborted || name === "AbortError" || name === "TimeoutError") {
      throw new CanonicalAmoCrmProviderError("request_timeout");
    }
    throw new CanonicalAmoCrmProviderError("provider_unavailable");
  }

  let raw: string;
  try {
    raw = await boundedBody(response, config.maxResponseBytes);
  } catch (error) {
    if (error instanceof CanonicalAmoCrmProviderError) {
      throw new CanonicalAmoCrmProviderError(error.code, {
        status: response.status,
        providerRequestId: providerRequestId(response),
      });
    }
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
    if (signal.aborted || name === "AbortError" || name === "TimeoutError") {
      throw new CanonicalAmoCrmProviderError("request_timeout");
    }
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  let parsed: unknown | null = null;
  if (raw !== "") {
    try {
      parsed = parseJsonResponse(raw);
    } catch {
      if (response.status >= 200 && response.status < 300) {
        throw new CanonicalAmoCrmProviderError("invalid_response", {
          status: response.status,
          providerRequestId: providerRequestId(response),
        });
      }
    }
  } else if (response.status >= 200 && response.status < 300) {
    throw new CanonicalAmoCrmProviderError("invalid_response", {
      status: response.status,
      providerRequestId: providerRequestId(response),
    });
  }
  return Object.freeze({
    status: response.status,
    json: parsed,
    providerRequestId: providerRequestId(response),
  });
}

async function refreshToken(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  failedAccessToken: string,
): Promise<CanonicalAmoCrmTokenSet> {
  const existing = REFRESH_BY_TOKEN_FILE.get(config.tokenFilePath);
  if (existing) return existing;

  const work = (async () => {
    let current: CanonicalAmoCrmTokenSet;
    try {
      current = await readCanonicalAmoCrmTokenFile(config.tokenFilePath);
    } catch {
      throw new CanonicalAmoCrmProviderError("token_refresh_failed");
    }
    if (current.accessToken !== failedAccessToken) return current;

    let response: ProviderResponse;
    try {
      response = await providerFetch(
        config,
        dependencies,
        "/oauth2/access_token",
        {
          method: "POST",
          headers: Object.freeze({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "refresh_token",
            refresh_token: current.refreshToken,
            redirect_uri: config.redirectUri,
          }),
        },
      );
    } catch {
      throw new CanonicalAmoCrmProviderError("token_refresh_failed");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new CanonicalAmoCrmProviderError("token_refresh_failed");
    }

    let refreshed: CanonicalAmoCrmTokenSet;
    try {
      refreshed = parseCanonicalAmoCrmTokenSet(response.json);
      await rotateCanonicalAmoCrmTokenFile(config.tokenFilePath, refreshed);
    } catch {
      throw new CanonicalAmoCrmProviderError("token_refresh_failed");
    }
    return refreshed;
  })();

  REFRESH_BY_TOKEN_FILE.set(config.tokenFilePath, work);
  try {
    return await work;
  } finally {
    if (REFRESH_BY_TOKEN_FILE.get(config.tokenFilePath) === work) {
      REFRESH_BY_TOKEN_FILE.delete(config.tokenFilePath);
    }
  }
}

async function readWithToken(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  path: string,
  accessToken: string,
): Promise<ProviderResponse> {
  return providerFetch(config, dependencies, path, {
    method: "GET",
    headers: Object.freeze({
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    }),
  });
}

async function canonicalRead(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  path: string,
): Promise<unknown> {
  let initialToken: CanonicalAmoCrmTokenSet;
  try {
    initialToken = await readCanonicalAmoCrmTokenFile(config.tokenFilePath);
  } catch {
    throw new CanonicalAmoCrmProviderError("token_unavailable");
  }

  const first = await readWithToken(
    config,
    dependencies,
    path,
    initialToken.accessToken,
  );
  if (first.status >= 200 && first.status < 300) return first.json;
  if (first.status !== 401) {
    throw new CanonicalAmoCrmProviderError("provider_rejected", {
      status: first.status,
    });
  }

  const refreshed = await refreshToken(
    config,
    dependencies,
    initialToken.accessToken,
  );
  const replay = await readWithToken(
    config,
    dependencies,
    path,
    refreshed.accessToken,
  );
  if (replay.status >= 200 && replay.status < 300) return replay.json;
  if (replay.status === 401) {
    throw new CanonicalAmoCrmProviderError("authentication_failed", {
      status: replay.status,
    });
  }
  throw new CanonicalAmoCrmProviderError("provider_rejected", {
    status: replay.status,
  });
}

function requireCompleteFirstDiscoveryPage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const links = (value as Record<string, unknown>)._links;
  if (links === undefined) return value;
  if (!links || typeof links !== "object" || Array.isArray(links)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  if (!Object.prototype.hasOwnProperty.call(links, "next")) return value;
  const next = (links as Record<string, unknown>).next;
  if (next === null) return value;
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const href = (next as Record<string, unknown>).href;
  if (typeof href !== "string" || href.trim() === "") {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  throw new CanonicalAmoCrmProviderError("discovery_incomplete");
}

async function canonicalListRead(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  path: string,
): Promise<unknown> {
  return requireCompleteFirstDiscoveryPage(
    await canonicalRead(config, dependencies, `${path}?limit=250&page=1`),
  );
}

const CANONICAL_AMOCRM_MAX_MUTATION_BYTES = 65_536;
// Kommo's current API v4 OpenAPI schemas declare entity and mapping IDs int32.
// https://developers.kommo.com/reference/getting-a-lead-by-its-id
const CANONICAL_AMOCRM_MAX_PROVIDER_ID = 2_147_483_647;

function invalidMutationRequest(): never {
  throw new CanonicalAmoCrmProviderError("invalid_request");
}

function boundedMutationText(
  value: unknown,
  maximumLength: number,
  options: Readonly<{ allowEmpty?: boolean }> = {},
): string {
  if (typeof value !== "string" || value !== value.trim()) {
    return invalidMutationRequest();
  }
  if ((!options.allowEmpty && value.length === 0) || value.length > maximumLength) {
    return invalidMutationRequest();
  }
  return value;
}

function commandRequestId(value: unknown): string {
  const parsed = boundedMutationText(value, 255);
  if (!/^[A-Za-z0-9._:-]+$/u.test(parsed)) return invalidMutationRequest();
  return parsed;
}

function providerEntityId(value: unknown): Readonly<{ json: number; text: string }> {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(numeric) ||
    numeric <= 0 ||
    numeric > CANONICAL_AMOCRM_MAX_PROVIDER_ID
  ) {
    return invalidMutationRequest();
  }
  return Object.freeze({ json: numeric, text: String(numeric) });
}

function boundedPrice(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return invalidMutationRequest();
  }
  return Number(value);
}

function customFields(
  value: readonly CanonicalAmoCrmCustomField[] | undefined,
): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) {
    return invalidMutationRequest();
  }
  return Object.freeze(
    value.map((field) => {
      if (!field || typeof field !== "object") return invalidMutationRequest();
      const fieldId = providerEntityId(field.fieldId).json;
      if (
        !Array.isArray(field.values) ||
        field.values.length === 0 ||
        field.values.length > 10
      ) {
        return invalidMutationRequest();
      }
      return Object.freeze({
        field_id: fieldId,
        values: Object.freeze(
          field.values.map((item: CanonicalAmoCrmCustomFieldValue) => {
            if (!item || typeof item !== "object") return invalidMutationRequest();
            const scalar = item.value;
            if (
              !(
                typeof scalar === "boolean" ||
                (typeof scalar === "number" && Number.isFinite(scalar)) ||
                (typeof scalar === "string" && scalar.length <= 4_096)
              )
            ) {
              return invalidMutationRequest();
            }
            if (item.enumId !== undefined && item.enumCode !== undefined) {
              return invalidMutationRequest();
            }
            const enumCode =
              item.enumCode === undefined
                ? undefined
                : boundedMutationText(item.enumCode, 64);
            if (enumCode !== undefined && !/^[A-Za-z0-9_-]+$/u.test(enumCode)) {
              return invalidMutationRequest();
            }
            return Object.freeze({
              value: scalar,
              ...(item.enumId === undefined
                ? {}
                : { enum_id: providerEntityId(item.enumId).json }),
              ...(enumCode === undefined ? {} : { enum_code: enumCode }),
            });
          }),
        ),
      });
    }),
  );
}

function immutableJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(immutableJson));
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableJson(entry)]),
      ),
    );
  }
  return invalidMutationRequest();
}

function encodedMutationBody(value: unknown): string {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > CANONICAL_AMOCRM_MAX_MUTATION_BYTES) {
    return invalidMutationRequest();
  }
  return body;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function responseMetadata(response: ProviderResponse): CanonicalAmoCrmResponseMetadata {
  return Object.freeze({
    status: response.status,
    providerRequestId: response.providerRequestId,
  });
}

function providerResponseEntity(
  value: unknown,
  collection: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const record = value as Record<string, unknown>;
  if (record.id !== undefined) return record;

  const embedded = record._embedded;
  if (!embedded || typeof embedded !== "object" || Array.isArray(embedded)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const entities = (embedded as Record<string, unknown>)[collection];
  if (!Array.isArray(entities) || entities.length !== 1) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const entity = entities[0];
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  return entity as Record<string, unknown>;
}

function providerResponseEntityId(value: unknown, collection: string): string {
  return providerEntityId(providerResponseEntity(value, collection).id).text;
}

function providerCreatedEntityId(
  value: unknown,
  collection: string,
  expectedRequestId: string,
  expectedParentId?: Readonly<{ field: string; id: string }>,
): string {
  const entity = providerResponseEntity(value, collection);
  if (entity.request_id !== expectedRequestId) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  if (
    expectedParentId &&
    providerEntityId(entity[expectedParentId.field]).text !== expectedParentId.id
  ) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  return providerEntityId(entity.id).text;
}

function leadTagName(value: unknown): string {
  const name = boundedMutationText(value, 255);
  if (/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(name)) {
    return invalidMutationRequest();
  }
  return name;
}

function providerEnsuredLeadTagId(
  value: unknown,
  expectedName: string,
  expectedRequestId: string,
): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const record = value as Record<string, unknown>;
  const embedded = record._embedded;
  if (
    record._total_items !== 1 ||
    !embedded ||
    typeof embedded !== "object" ||
    Array.isArray(embedded)
  ) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const tags = (embedded as Record<string, unknown>).tags;
  if (!Array.isArray(tags) || tags.length !== 1) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const tag = tags[0];
  if (!tag || typeof tag !== "object" || Array.isArray(tag)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const tagRecord = tag as Record<string, unknown>;
  if (
    typeof tagRecord.id !== "number" ||
    tagRecord.name !== expectedName ||
    tagRecord.request_id !== expectedRequestId
  ) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  return providerEntityId(tagRecord.id).text;
}

function exactEntityReadback(value: unknown, expectedId: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  let actualId: string;
  try {
    actualId = providerEntityId((value as Record<string, unknown>).id).text;
  } catch {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  if (actualId !== expectedId) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  return value;
}

function exactLinksReadback(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  const embedded = (value as Record<string, unknown>)._embedded;
  const links =
    embedded && typeof embedded === "object" && !Array.isArray(embedded)
      ? (embedded as Record<string, unknown>).links
      : undefined;
  if (!Array.isArray(links) || links.length > 250) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  try {
    for (const link of links) {
      if (!link || typeof link !== "object" || Array.isArray(link)) {
        throw new Error("invalid link");
      }
      providerEntityId((link as Record<string, unknown>).to_entity_id);
      if (
        !["contacts", "companies", "catalog_elements"].includes(
          String((link as Record<string, unknown>).to_entity_type),
        )
      ) {
        throw new Error("invalid link type");
      }
    }
  } catch {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  return value;
}

async function canonicalMutation(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  request: CanonicalAmoCrmRequestMetadata,
  bodyJson: string,
  extractEntityId: (value: unknown) => string,
): Promise<CanonicalAmoCrmMutationResult> {
  let initialToken: CanonicalAmoCrmTokenSet;
  try {
    initialToken = await readCanonicalAmoCrmTokenFile(config.tokenFilePath);
  } catch {
    throw new CanonicalAmoCrmMutationError("token_unavailable", {
      outcome: "rejected",
      request,
    });
  }

  let dispatched = false;
  let response: ProviderResponse;
  try {
    response = await providerFetch(
      config,
      dependencies,
      request.path,
      {
        method: request.method,
        headers: Object.freeze({
          Accept: "application/json",
          Authorization: `Bearer ${initialToken.accessToken}`,
          "Content-Type": "application/json",
        }),
        body: bodyJson,
      },
      () => {
        dispatched = true;
      },
    );
  } catch (error) {
    if (!dispatched) throw error;
    const code =
      error instanceof CanonicalAmoCrmProviderError
        ? error.code
        : "provider_unavailable";
    throw new CanonicalAmoCrmMutationError(code, {
      outcome: "unknown",
      request,
      ...(error instanceof CanonicalAmoCrmProviderError && error.status !== null
        ? {
            response: Object.freeze({
              status: error.status,
              providerRequestId: error.providerRequestId,
            }),
          }
        : {}),
    });
  }

  const metadata = responseMetadata(response);
  if (response.status < 200 || response.status >= 300) {
    const authenticationFailed = response.status === 401;
    const unknown = response.status >= 500;
    throw new CanonicalAmoCrmMutationError(
      authenticationFailed
        ? "authentication_failed"
        : unknown
          ? "provider_unavailable"
          : "provider_rejected",
      {
        outcome: unknown ? "unknown" : "rejected",
        request,
        response: metadata,
      },
    );
  }

  let entityId: string;
  try {
    entityId = extractEntityId(response.json);
  } catch {
    throw new CanonicalAmoCrmMutationError("invalid_response", {
      outcome: "unknown",
      request,
      response: metadata,
    });
  }
  return Object.freeze({ entityId, request, response: metadata });
}

function prepareCanonicalMutation(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  method: "POST" | "PATCH",
  path: string,
  requestIdValue: string,
  bodyValue: unknown,
  extractEntityId: (value: unknown) => string,
): CanonicalAmoCrmPreparedMutation {
  const request = Object.freeze({
    method,
    path,
    requestId: commandRequestId(requestIdValue),
  });
  const body = immutableJson(bodyValue);
  const bodyJson = encodedMutationBody(body);
  const bodySha256 = sha256(bodyJson);
  const requestSha256 = sha256(
    JSON.stringify({
      method: request.method,
      path: request.path,
      request_id: request.requestId,
      body,
    }),
  );
  let consumed = false;
  return Object.freeze({
    request,
    body,
    bodyJson,
    bodySha256,
    requestSha256,
    dispatch: async () => {
      if (consumed) {
        throw new CanonicalAmoCrmMutationError("invalid_request", {
          outcome: "rejected",
          request,
        });
      }
      consumed = true;
      return canonicalMutation(
        config,
        dependencies,
        request,
        bodyJson,
        extractEntityId,
      );
    },
  });
}

function contactMutationBody(
  input: Readonly<{
    requestId: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    responsibleUserId?: string | number;
    customFieldsValues?: readonly CanonicalAmoCrmCustomField[];
  }>,
): Readonly<Record<string, unknown>> {
  const fields = customFields(input.customFieldsValues);
  const body = Object.freeze({
    request_id: commandRequestId(input.requestId),
    ...(input.name === undefined ? {} : { name: boundedMutationText(input.name, 255) }),
    ...(input.firstName === undefined
      ? {}
      : { first_name: boundedMutationText(input.firstName, 255) }),
    ...(input.lastName === undefined
      ? {}
      : { last_name: boundedMutationText(input.lastName, 255) }),
    ...(input.responsibleUserId === undefined
      ? {}
      : { responsible_user_id: providerEntityId(input.responsibleUserId).json }),
    ...(fields === undefined ? {} : { custom_fields_values: fields }),
  });
  if (Object.keys(body).length === 1) return invalidMutationRequest();
  return body;
}

function leadMutationBody(
  input: Readonly<{
    requestId: string;
    name?: string;
    pipelineId?: string | number;
    statusId?: string | number;
    responsibleUserId?: string | number;
    price?: number;
    customFieldsValues?: readonly CanonicalAmoCrmCustomField[];
  }>,
): Readonly<Record<string, unknown>> {
  const fields = customFields(input.customFieldsValues);
  const body = Object.freeze({
    request_id: commandRequestId(input.requestId),
    ...(input.name === undefined ? {} : { name: boundedMutationText(input.name, 255) }),
    ...(input.pipelineId === undefined
      ? {}
      : { pipeline_id: providerEntityId(input.pipelineId).json }),
    ...(input.statusId === undefined
      ? {}
      : { status_id: providerEntityId(input.statusId).json }),
    ...(input.responsibleUserId === undefined
      ? {}
      : { responsible_user_id: providerEntityId(input.responsibleUserId).json }),
    ...(input.price === undefined ? {} : { price: boundedPrice(input.price) }),
    ...(fields === undefined ? {} : { custom_fields_values: fields }),
  });
  if (Object.keys(body).length === 1) return invalidMutationRequest();
  return body;
}

function tagList(
  value: readonly Readonly<{ id: string | number }>[] | undefined,
): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return invalidMutationRequest();
  }
  return Object.freeze(
    value.map((tag) => {
      if (
        !tag ||
        typeof tag !== "object" ||
        Array.isArray(tag) ||
        Object.keys(tag).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(tag, "id")
      ) {
        return invalidMutationRequest();
      }
      return Object.freeze({ id: providerEntityId(tag.id).json });
    }),
  );
}

// Kommo API v4 contracts used below:
// https://developers.kommo.com/reference/add-contacts
// https://developers.kommo.com/reference/adding-leads
// https://developers.kommo.com/reference/linking-entities
// https://developers.kommo.com/reference/add-notes
// https://developers.kommo.com/reference/add-tags
export function createCanonicalAmoCrmWriteProvider(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies = {},
): CanonicalAmoCrmWriteProvider {
  const prepare = (
    method: "POST" | "PATCH",
    path: string,
    requestId: string,
    body: unknown,
    extractEntityId: (value: unknown) => string,
  ) =>
    prepareCanonicalMutation(
      config,
      dependencies,
      method,
      path,
      requestId,
      body,
      extractEntityId,
    );

  const provider: CanonicalAmoCrmWriteProvider = Object.freeze({
    prepareCreateContact: (input) =>
      prepare(
        "POST",
        "/api/v4/contacts",
        input.requestId,
        [contactMutationBody(input)],
        (value) =>
          providerCreatedEntityId(value, "contacts", input.requestId),
      ),
    prepareUpdateContact: (input) => {
      const contactId = providerEntityId(input.contactId);
      return prepare(
        "PATCH",
        `/api/v4/contacts/${contactId.text}`,
        input.requestId,
        contactMutationBody(input),
        (value) => {
          const result = providerResponseEntityId(value, "contacts");
          if (result !== contactId.text) {
            throw new CanonicalAmoCrmProviderError("invalid_response");
          }
          return result;
        },
      );
    },
    prepareCreateLead: (input) =>
      prepare(
        "POST",
        "/api/v4/leads",
        input.requestId,
        [
          leadMutationBody({
            ...input,
            name: boundedMutationText(input.name, 255),
            pipelineId: providerEntityId(input.pipelineId).text,
            statusId: providerEntityId(input.statusId).text,
            responsibleUserId: providerEntityId(input.responsibleUserId).text,
          }),
        ],
        (value) => providerCreatedEntityId(value, "leads", input.requestId),
      ),
    prepareUpdateLead: (input) => {
      const leadId = providerEntityId(input.leadId);
      return prepare(
        "PATCH",
        `/api/v4/leads/${leadId.text}`,
        input.requestId,
        leadMutationBody(input),
        (value) => {
          const result = providerResponseEntityId(value, "leads");
          if (result !== leadId.text) {
            throw new CanonicalAmoCrmProviderError("invalid_response");
          }
          return result;
        },
      );
    },
    prepareUpdateLeadPipelineStatus: (input) => {
      const leadId = providerEntityId(input.leadId);
      return prepare(
        "PATCH",
        `/api/v4/leads/${leadId.text}`,
        input.requestId,
        leadMutationBody({
          requestId: input.requestId,
          pipelineId: input.pipelineId,
          statusId: input.statusId,
        }),
        (value) => {
          const result = providerResponseEntityId(value, "leads");
          if (result !== leadId.text) {
            throw new CanonicalAmoCrmProviderError("invalid_response");
          }
          return result;
        },
      );
    },
    prepareUpdateLeadResponsibleUser: (input) => {
      const leadId = providerEntityId(input.leadId);
      return prepare(
        "PATCH",
        `/api/v4/leads/${leadId.text}`,
        input.requestId,
        leadMutationBody({
          requestId: input.requestId,
          responsibleUserId: input.responsibleUserId,
        }),
        (value) => {
          const result = providerResponseEntityId(value, "leads");
          if (result !== leadId.text) {
            throw new CanonicalAmoCrmProviderError("invalid_response");
          }
          return result;
        },
      );
    },
    prepareLinkContactToLead: (input) => {
      const leadId = providerEntityId(input.leadId);
      const contactId = providerEntityId(input.contactId);
      return prepare(
        "POST",
        `/api/v4/leads/${leadId.text}/link`,
        input.requestId,
        [
          {
            to_entity_id: contactId.json,
            to_entity_type: "contacts",
            metadata: { is_main: true },
          },
        ],
        () => leadId.text,
      );
    },
    prepareCreateLeadNote: (input) => {
      const leadId = providerEntityId(input.leadId);
      return prepare(
        "POST",
        "/api/v4/leads/notes",
        input.requestId,
        [
          {
            entity_id: leadId.json,
            note_type: "common",
            params: { text: boundedMutationText(input.text, 10_000) },
            request_id: commandRequestId(input.requestId),
            is_need_to_trigger_digital_pipeline: false,
          },
        ],
        (value) =>
          providerCreatedEntityId(value, "notes", input.requestId, {
            field: "entity_id",
            id: leadId.text,
          }),
      );
    },
    prepareUpdateLeadTags: (input) => {
      const leadId = providerEntityId(input.leadId);
      const add = tagList(input.add);
      const remove = tagList(input.remove);
      if (add === undefined && remove === undefined) return invalidMutationRequest();
      return prepare(
        "PATCH",
        `/api/v4/leads/${leadId.text}`,
        input.requestId,
        {
          request_id: commandRequestId(input.requestId),
          ...(add === undefined ? {} : { tags_to_add: add }),
          ...(remove === undefined ? {} : { tags_to_delete: remove }),
        },
        (value) => {
          const result = providerResponseEntityId(value, "leads");
          if (result !== leadId.text) {
            throw new CanonicalAmoCrmProviderError("invalid_response");
          }
          return result;
        },
      );
    },
    prepareEnsureLeadTag: (input) => {
      const name = leadTagName(input.name);
      const requestId = commandRequestId(input.requestId);
      return prepare(
        "POST",
        "/api/v4/leads/tags",
        requestId,
        [{ name, request_id: requestId }],
        (value) => providerEnsuredLeadTagId(value, name, requestId),
      );
    },
    createContact: (input) => provider.prepareCreateContact(input).dispatch(),
    updateContact: (input) => provider.prepareUpdateContact(input).dispatch(),
    createLead: (input) => provider.prepareCreateLead(input).dispatch(),
    updateLead: (input) => provider.prepareUpdateLead(input).dispatch(),
    updateLeadPipelineStatus: (input) =>
      provider.prepareUpdateLeadPipelineStatus(input).dispatch(),
    updateLeadResponsibleUser: (input) =>
      provider.prepareUpdateLeadResponsibleUser(input).dispatch(),
    linkContactToLead: (input) =>
      provider.prepareLinkContactToLead(input).dispatch(),
    createLeadNote: (input) => provider.prepareCreateLeadNote(input).dispatch(),
    updateLeadTags: (input) => provider.prepareUpdateLeadTags(input).dispatch(),
    ensureLeadTag: (input) => provider.prepareEnsureLeadTag(input).dispatch(),
    getContactById: async (value) => {
      const contactId = providerEntityId(value);
      return exactEntityReadback(
        await canonicalRead(
          config,
          dependencies,
          `/api/v4/contacts/${contactId.text}?with=leads`,
        ),
        contactId.text,
      );
    },
    getLeadById: async (value) => {
      const leadId = providerEntityId(value);
      return exactEntityReadback(
        await canonicalRead(
          config,
          dependencies,
          `/api/v4/leads/${leadId.text}?with=contacts`,
        ),
        leadId.text,
      );
    },
    getLeadLinks: async (value) => {
      const leadId = providerEntityId(value);
      return exactLinksReadback(
        await canonicalRead(
          config,
          dependencies,
          `/api/v4/leads/${leadId.text}/links`,
        ),
      );
    },
    getLeadNoteById: async (leadValue, noteValue) => {
      const leadId = providerEntityId(leadValue);
      const noteId = providerEntityId(noteValue);
      const result = exactEntityReadback(
        await canonicalRead(
          config,
          dependencies,
          `/api/v4/leads/notes/${noteId.text}`,
        ),
        noteId.text,
      );
      const entityId = providerEntityId(
        (result as Record<string, unknown>).entity_id,
      ).text;
      if (entityId !== leadId.text) {
        throw new CanonicalAmoCrmProviderError("invalid_response");
      }
      return result;
    },
  });
  return provider;
}

export function createCanonicalAmoCrmReadProvider(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies = {},
): CanonicalAmoCrmReadProvider {
  return Object.freeze({
    getAccount: () => canonicalRead(config, dependencies, "/api/v4/account"),
    getPipelines: () =>
      canonicalListRead(config, dependencies, "/api/v4/leads/pipelines"),
    getLeadTags: () =>
      canonicalListRead(config, dependencies, "/api/v4/leads/tags"),
    getUsers: () => canonicalListRead(config, dependencies, "/api/v4/users"),
    getLeadCustomFields: () =>
      canonicalListRead(config, dependencies, "/api/v4/leads/custom_fields"),
    getContactCustomFields: () =>
      canonicalListRead(
        config,
        dependencies,
        "/api/v4/contacts/custom_fields",
      ),
  });
}
