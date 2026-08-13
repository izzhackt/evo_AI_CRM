import { createHmac, timingSafeEqual } from 'node:crypto';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NON_NIL_UUID = /[1-9a-f]/;
const TIMESTAMP = /^\d{13}$/;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const MAX_CLOCK_SKEW_MS = 300_000;

export type AuthenticatedObservabilityRequest = Readonly<{
  requestId: string;
}>;

function exactlyOneHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  return value && !value.includes(',') ? value : null;
}

function isBodyless(request: Request): boolean {
  if (request.body !== null || request.headers.has('transfer-encoding')) {
    return false;
  }

  const contentLength = request.headers.get('content-length');
  return contentLength === null || contentLength === '0';
}

export function authenticateReadinessRequest(
  request: Request,
  secret: string,
  nowMs: number
): AuthenticatedObservabilityRequest | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }

  if (
    request.method !== 'GET' ||
    url.pathname !== '/api/readiness' ||
    url.search !== '' ||
    url.hash !== '' ||
    !isBodyless(request)
  ) {
    return null;
  }

  const requestId = exactlyOneHeader(request, 'x-evo-observability-request-id');
  const timestamp = exactlyOneHeader(request, 'x-evo-observability-timestamp');
  const algorithm = exactlyOneHeader(
    request,
    'x-evo-observability-hmac-algorithm'
  );
  const suppliedHmac = exactlyOneHeader(request, 'x-evo-observability-hmac');

  if (
    !requestId ||
    !CANONICAL_UUID.test(requestId) ||
    !NON_NIL_UUID.test(requestId) ||
    !timestamp ||
    !TIMESTAMP.test(timestamp) ||
    algorithm !== 'sha256' ||
    !suppliedHmac ||
    !LOWERCASE_SHA256.test(suppliedHmac)
  ) {
    return null;
  }

  const timestampMs = Number(timestamp);
  if (Math.abs(nowMs - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return null;
  }

  const expected = createHmac('sha256', secret)
    .update(`GET\n/api/readiness\n${requestId}\n${timestamp}`)
    .digest();
  const supplied = Buffer.from(suppliedHmac, 'hex');

  if (
    supplied.byteLength !== expected.byteLength ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }

  return Object.freeze({ requestId });
}
