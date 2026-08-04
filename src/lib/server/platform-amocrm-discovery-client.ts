import {
  buildPlatformAmoCrmMappingSnapshot,
  normalizePlatformAmoCrmAccountDomain,
  type PlatformAmoCrmAccountDomain,
  type PlatformAmoCrmMappingSnapshot,
} from "../platform-amocrm-discovery-contract.ts";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MINIMUM_INTERVAL_MS = 160;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 100;
const PAGE_LIMIT = 250;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type DiscoveryClientOptions = Readonly<{
  fetchImplementation?: FetchImplementation;
  minimumIntervalMs?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxPages?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

type DiscoveryInput = Readonly<{
  accountDomain: string;
  accessToken: string;
}>;

export type PlatformAmoCrmDiscoveryFailureCode =
  | "invalid_configuration"
  | "provider_rejected"
  | "provider_response_invalid"
  | "provider_response_too_large"
  | "request_timeout"
  | "transport_failure";

export class PlatformAmoCrmDiscoveryClientError extends Error {
  readonly code: PlatformAmoCrmDiscoveryFailureCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: PlatformAmoCrmDiscoveryFailureCode,
    options: Readonly<{
      status?: number | null;
      retryAfterSeconds?: number | null;
    }> = {},
  ) {
    super("amoCRM mapping discovery is unavailable.");
    this.name = "PlatformAmoCrmDiscoveryClientError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function invalidConfiguration(): never {
  throw new PlatformAmoCrmDiscoveryClientError("invalid_configuration");
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
    value.length === 0 ||
    value.length > 16_384 ||
    value.trim() !== value ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    return invalidConfiguration();
  }
  return value;
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 86_400 ? seconds : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pageRows(value: unknown, key: string): readonly unknown[] {
  if (!isRecord(value) || !isRecord(value._embedded)) {
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_invalid");
  }
  const rows = value._embedded[key];
  if (!Array.isArray(rows) || rows.length > PAGE_LIMIT) {
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_invalid");
  }
  return rows;
}

function hasNextPage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const links = value._links;
  return isRecord(links) && isRecord(links.next);
}

function paginatedEnvelope(key: string, rows: readonly unknown[]): unknown {
  return { _embedded: { [key]: rows } };
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_invalid");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes) {
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_too_large");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_invalid");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PlatformAmoCrmDiscoveryClientError("provider_response_too_large");
    }
    chunks.push(next.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_invalid");
  }

  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_invalid");
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Performs only read-only amoCRM discovery requests. The caller supplies the
 * short-lived access token; this module neither stores nor refreshes OAuth
 * material and intentionally has no provider write or retry behavior.
 */
export async function discoverPlatformAmoCrmMappingSnapshot(
  input: DiscoveryInput,
  options: DiscoveryClientOptions = {},
): Promise<PlatformAmoCrmMappingSnapshot> {
  let accountDomain: PlatformAmoCrmAccountDomain;
  try {
    accountDomain = normalizePlatformAmoCrmAccountDomain(input.accountDomain);
  } catch {
    return invalidConfiguration();
  }
  const accessToken = normalizeAccessToken(input.accessToken);
  const minimumIntervalMs = integerOption(
    options.minimumIntervalMs,
    DEFAULT_MINIMUM_INTERVAL_MS,
    0,
    60_000,
  );
  const timeoutMs = integerOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 60_000);
  const maxResponseBytes = integerOption(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1_024,
    20 * 1024 * 1024,
  );
  const maxPages = integerOption(options.maxPages, DEFAULT_MAX_PAGES, 1, 1_000);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  let requestCount = 0;

  async function get(pathname: string): Promise<unknown> {
    if (requestCount > 0 && minimumIntervalMs > 0) {
      await sleep(minimumIntervalMs);
    }
    requestCount += 1;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImplementation(
        new URL(pathname, `${accountDomain.origin}/`),
        {
          method: "GET",
          headers: {
            Accept: "application/hal+json, application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new PlatformAmoCrmDiscoveryClientError("provider_rejected", {
          status: response.status,
          retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
        });
      }
      return await readBoundedJson(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof PlatformAmoCrmDiscoveryClientError) throw error;
      if (controller.signal.aborted) {
        throw new PlatformAmoCrmDiscoveryClientError("request_timeout");
      }
      throw new PlatformAmoCrmDiscoveryClientError("transport_failure");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getAll(pathname: string, key: string): Promise<unknown> {
    const rows: unknown[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = pathname.includes("?") ? "&" : "?";
      const response = await get(
        `${pathname}${separator}limit=${PAGE_LIMIT}&page=${page}`,
      );
      const currentRows = pageRows(response, key);
      rows.push(...currentRows);
      if (!hasNextPage(response) && currentRows.length < PAGE_LIMIT) {
        return paginatedEnvelope(key, rows);
      }
      if (!hasNextPage(response) && currentRows.length === 0) {
        return paginatedEnvelope(key, rows);
      }
    }
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_invalid");
  }

  const account = await get("/api/v4/account");
  const pipelines = await get("/api/v4/leads/pipelines");
  const users = await getAll("/api/v4/users", "users");
  const leadCustomFields = await getAll(
    "/api/v4/leads/custom_fields",
    "custom_fields",
  );
  const contactCustomFields = await getAll(
    "/api/v4/contacts/custom_fields",
    "custom_fields",
  );

  try {
    return buildPlatformAmoCrmMappingSnapshot({
      accountDomain: accountDomain.domain,
      account,
      pipelines,
      users,
      leadCustomFields,
      contactCustomFields,
    });
  } catch {
    throw new PlatformAmoCrmDiscoveryClientError("provider_response_invalid");
  }
}
