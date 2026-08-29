import "server-only";

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

  constructor(
    code: CanonicalAmoCrmProviderErrorCode,
    options: Readonly<{ status?: number }> = {},
  ) {
    super("Canonical amoCRM provider request did not complete.");
    this.name = "CanonicalAmoCrmProviderError";
    this.code = code;
    this.status = options.status ?? null;
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
  getUsers: () => Promise<unknown>;
  getLeadCustomFields: () => Promise<unknown>;
  getContactCustomFields: () => Promise<unknown>;
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
}>;

async function providerFetch(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies,
  path: string,
  init: RequestInit,
): Promise<ProviderResponse> {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ?? ((milliseconds) => AbortSignal.timeout(milliseconds));
  const signal = createTimeoutSignal(config.timeoutMs);

  let response: Response;
  try {
    response = await paced(config, dependencies, () =>
      fetchImplementation(`${config.accountOrigin}${path}`, {
        ...init,
        redirect: "error",
        signal,
      }),
    );
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
    if (error instanceof CanonicalAmoCrmProviderError) throw error;
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
    } catch (error) {
      if (response.status >= 200 && response.status < 300) throw error;
    }
  } else if (response.status >= 200 && response.status < 300) {
    throw new CanonicalAmoCrmProviderError("invalid_response");
  }
  return Object.freeze({
    status: response.status,
    json: parsed,
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

export function createCanonicalAmoCrmReadProvider(
  config: CanonicalAmoCrmReadyConfig,
  dependencies: CanonicalAmoCrmProviderDependencies = {},
): CanonicalAmoCrmReadProvider {
  return Object.freeze({
    getAccount: () => canonicalRead(config, dependencies, "/api/v4/account"),
    getPipelines: () =>
      canonicalListRead(config, dependencies, "/api/v4/leads/pipelines"),
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
