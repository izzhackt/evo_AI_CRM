import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 300_000;
const LOWERCASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMP_PATTERN = /^\d{13}$/;
const HMAC_PATTERN = /^[0-9a-f]{64}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export const PLATFORM_OBSERVABILITY_PATHS = Object.freeze({
  readiness: "/api/readiness",
  metrics: "/metrics",
} as const);

export const PLATFORM_OBSERVABILITY_HEADER_NAMES = Object.freeze({
  requestId: "x-evo-observability-request-id",
  timestamp: "x-evo-observability-timestamp",
  algorithm: "x-evo-observability-hmac-algorithm",
  hmac: "x-evo-observability-hmac",
} as const);

export type PlatformObservabilityPath =
  (typeof PLATFORM_OBSERVABILITY_PATHS)[keyof typeof PLATFORM_OBSERVABILITY_PATHS];

export type AuthenticatedPlatformObservabilityRequest = Readonly<{
  requestId: string;
}>;

type SignatureInput = Readonly<{
  path: PlatformObservabilityPath;
  requestId: string;
  timestamp: string;
  secret: string;
}>;

function isOneHeaderValue(value: string | null): value is string {
  return value !== null && !value.includes(",");
}

function isCanonicalRequestId(value: string): boolean {
  return value !== NIL_UUID && LOWERCASE_UUID_PATTERN.test(value);
}

function isExactPath(path: string): path is PlatformObservabilityPath {
  return (
    path === PLATFORM_OBSERVABILITY_PATHS.readiness ||
    path === PLATFORM_OBSERVABILITY_PATHS.metrics
  );
}

export function platformObservabilitySignedBytes(
  path: PlatformObservabilityPath,
  requestId: string,
  timestamp: string,
): string {
  return `GET\n${path}\n${requestId}\n${timestamp}`;
}

export function createPlatformObservabilityHmac(input: SignatureInput): string {
  if (
    !isExactPath(input.path) ||
    !isCanonicalRequestId(input.requestId) ||
    !TIMESTAMP_PATTERN.test(input.timestamp)
  ) {
    throw new TypeError("Invalid Platform observability signature input.");
  }
  return createHmac("sha256", input.secret)
    .update(
      platformObservabilitySignedBytes(
        input.path,
        input.requestId,
        input.timestamp,
      ),
      "utf8",
    )
    .digest("hex");
}

export function createPlatformObservabilitySignedHeaders(
  input: SignatureInput,
): Headers {
  return new Headers({
    [PLATFORM_OBSERVABILITY_HEADER_NAMES.requestId]: input.requestId,
    [PLATFORM_OBSERVABILITY_HEADER_NAMES.timestamp]: input.timestamp,
    [PLATFORM_OBSERVABILITY_HEADER_NAMES.algorithm]: "sha256",
    [PLATFORM_OBSERVABILITY_HEADER_NAMES.hmac]:
      createPlatformObservabilityHmac(input),
  });
}

export function authenticatePlatformObservabilityRequest(
  request: Request,
  expectedPath: PlatformObservabilityPath,
  secret: string,
  nowMs = Date.now(),
): AuthenticatedPlatformObservabilityRequest | null {
  if (request.method !== "GET" || !isExactPath(expectedPath)) return null;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (
    url.pathname !== expectedPath ||
    url.search !== "" ||
    url.hash !== "" ||
    request.body !== null ||
    request.headers.has("transfer-encoding") ||
    ![null, "0"].includes(request.headers.get("content-length"))
  ) {
    return null;
  }

  const requestId = request.headers.get(
    PLATFORM_OBSERVABILITY_HEADER_NAMES.requestId,
  );
  const timestamp = request.headers.get(
    PLATFORM_OBSERVABILITY_HEADER_NAMES.timestamp,
  );
  const algorithm = request.headers.get(
    PLATFORM_OBSERVABILITY_HEADER_NAMES.algorithm,
  );
  const receivedHmac = request.headers.get(
    PLATFORM_OBSERVABILITY_HEADER_NAMES.hmac,
  );
  if (
    !isOneHeaderValue(requestId) ||
    !isOneHeaderValue(timestamp) ||
    !isOneHeaderValue(algorithm) ||
    !isOneHeaderValue(receivedHmac) ||
    !isCanonicalRequestId(requestId) ||
    !TIMESTAMP_PATTERN.test(timestamp) ||
    algorithm !== "sha256" ||
    !HMAC_PATTERN.test(receivedHmac)
  ) {
    return null;
  }

  const timestampMs = Number(timestamp);
  if (
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(nowMs - timestampMs) > MAX_CLOCK_SKEW_MS
  ) {
    return null;
  }

  const expectedHmac = createPlatformObservabilityHmac({
    path: expectedPath,
    requestId,
    timestamp,
    secret,
  });
  const receivedBytes = Buffer.from(receivedHmac, "hex");
  const expectedBytes = Buffer.from(expectedHmac, "hex");
  if (
    receivedBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    return null;
  }

  return Object.freeze({ requestId });
}

export function emptyPlatformObservabilityNotFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}
