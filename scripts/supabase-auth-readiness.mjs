import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const LOCAL_API_URL = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/;

export class LocalSupabaseAuthReadinessError extends Error {
  constructor(stage) {
    super(stage);
    this.name = "LocalSupabaseAuthReadinessError";
    this.stage = stage;
  }
}

const fail = (stage) => {
  throw new LocalSupabaseAuthReadinessError(stage);
};

/**
 * Wait for the DB-backed local Auth Admin API without retrying any mutation.
 * Provider response bodies and credentials are deliberately discarded.
 */
export async function waitForLocalSupabaseAuthAdmin({
  apiUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
  delayImpl = delay,
  maxAttempts = 360,
  retryDelayMs = 250,
  requestTimeoutMs = 2_000,
  readinessTimeoutMs = 90_000,
  nowImpl = () => performance.now(),
}) {
  if (
    typeof apiUrl !== "string" ||
    !LOCAL_API_URL.test(apiUrl) ||
    typeof serviceRoleKey !== "string" ||
    serviceRoleKey.length === 0 ||
    typeof fetchImpl !== "function" ||
    typeof delayImpl !== "function" ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 0 ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    !Number.isSafeInteger(readinessTimeoutMs) ||
    readinessTimeoutMs < 1 ||
    typeof nowImpl !== "function"
  ) {
    fail("auth-admin-readiness-config");
  }

  const url = `${apiUrl}/auth/v1/admin/users?page=1&per_page=1`;
  const startedAt = nowImpl();
  if (!Number.isFinite(startedAt)) {
    fail("auth-admin-readiness-config");
  }
  const deadline = startedAt + readinessTimeoutMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remainingBeforeRequest = deadline - nowImpl();
    if (remainingBeforeRequest <= 0) break;

    let status = null;

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(requestTimeoutMs, remainingBeforeRequest)),
        ),
      });
      status = response.status;
      await response.text();
    } catch {
      // A refused connection, reset connection or request timeout is safe to
      // retry because this probe is read-only.
    }

    if (status === 200) {
      return;
    }

    if (status !== null && !RETRYABLE_STATUSES.has(status)) {
      fail(`auth-admin-readiness-http-${status}`);
    }

    const remainingAfterRequest = deadline - nowImpl();
    if (attempt < maxAttempts && remainingAfterRequest > 0) {
      await delayImpl(Math.min(retryDelayMs, remainingAfterRequest));
    }
  }

  fail("auth-admin-readiness-timeout");
}
