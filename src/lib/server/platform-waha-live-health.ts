import "server-only";

import type { PlatformWahaSessionHealth } from "../platform-communications";
import {
  PLATFORM_WAHA_SESSION_NAME,
  resolveManualSendWahaRuntime,
  type PlatformManualSendWahaRuntime,
} from "../platform-provider-workflows.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

/**
 * Live WAHA session probe for the connection status shown to staff.
 *
 * Nothing polls WAHA, and `session.status` webhooks arrive only when the
 * session changes, so the recorded status goes stale after five minutes even
 * while WhatsApp works. This asks WAHA directly:
 * `GET /api/sessions/{session}` returns `name` and `status`, one of STOPPED,
 * STARTING, SCAN_QR_CODE, WORKING or FAILED
 * (https://waha.devlike.pro/docs/how-to/sessions/).
 *
 * The API key comes from the same Vault-backed runtime binding the manual
 * send uses. It never leaves this module: the result is a status word only.
 */

/** A status the live probe invents when WAHA cannot be reached at all. */
export const PLATFORM_WAHA_UNREACHABLE_STATUS = "UNREACHABLE" as const;

export const PLATFORM_WAHA_LIVE_PROBE_TIMEOUT_MS = 2_500;
export const PLATFORM_WAHA_LIVE_PROBE_TTL_MS = 10_000;

const MAX_RESPONSE_BYTES = 64 * 1_024;
const STATUS_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

type LiveProbeDependencies = Readonly<{
  resolveRuntime?: (
    organizationId: string,
  ) => Promise<PlatformManualSendWahaRuntime>;
  fetch?: typeof fetch;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
  now?: () => Date;
}>;

const cache = new Map<
  string,
  { expiresAt: number; result: Promise<PlatformWahaSessionHealth | null> }
>();

function defaultResolveRuntime(
  organizationId: string,
): Promise<PlatformManualSendWahaRuntime> {
  return resolveManualSendWahaRuntime(
    createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
    organizationId,
  );
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("too large");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function probe(
  organizationId: string,
  dependencies: LiveProbeDependencies,
): Promise<PlatformWahaSessionHealth | null> {
  const now = dependencies.now ?? (() => new Date());
  let runtime: PlatformManualSendWahaRuntime;
  try {
    runtime = await (dependencies.resolveRuntime ?? defaultResolveRuntime)(
      organizationId,
    );
  } catch {
    // No usable runtime binding or backend configuration: nothing was asked of
    // WAHA, so nothing is claimed about it. The recorded status stays.
    return null;
  }

  const fetchImpl = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ??
    ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const unreachable = (): PlatformWahaSessionHealth =>
    Object.freeze({
      sessionName: PLATFORM_WAHA_SESSION_NAME,
      status: PLATFORM_WAHA_UNREACHABLE_STATUS,
      observedAt: now().toISOString(),
    });

  let response: Response;
  try {
    response = await fetchImpl(
      `${runtime.wahaBaseUrl}/api/sessions/${encodeURIComponent(runtime.wahaSessionName)}`,
      {
        method: "GET",
        headers: Object.freeze({
          Accept: "application/json",
          "X-Api-Key": runtime.wahaApiKey,
        }),
        cache: "no-store",
        redirect: "error",
        signal: createTimeoutSignal(PLATFORM_WAHA_LIVE_PROBE_TIMEOUT_MS),
      },
    );
  } catch {
    return unreachable();
  }

  // The service answered but refused or does not know the session (a rejected
  // key, no such session): that is not proof about the connection either way.
  if (response.status >= 500) return unreachable();
  if (!response.ok) return null;

  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch {
    return null;
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    (body as { name?: unknown }).name !== runtime.wahaSessionName
  ) {
    return null;
  }
  const status = (body as { status?: unknown }).status;
  if (typeof status !== "string" || !STATUS_PATTERN.test(status)) return null;

  return Object.freeze({
    sessionName: PLATFORM_WAHA_SESSION_NAME,
    status,
    observedAt: now().toISOString(),
  });
}

/**
 * The session status WAHA reports right now, or null when the probe cannot say
 * (no runtime binding, a refused key, an unknown session, a malformed reply).
 * An unreachable or failing WAHA is reported as `UNREACHABLE`. The answer is
 * shared for a few seconds so page renders do not each call WAHA.
 */
export function probePlatformWahaSessionLive(
  organizationId: string,
  dependencies: LiveProbeDependencies = {},
): Promise<PlatformWahaSessionHealth | null> {
  const nowMs = (dependencies.now ?? (() => new Date()))().getTime();
  const cached = cache.get(organizationId);
  if (cached !== undefined && cached.expiresAt > nowMs) return cached.result;

  const result = probe(organizationId, dependencies);
  cache.set(organizationId, {
    expiresAt: nowMs + PLATFORM_WAHA_LIVE_PROBE_TTL_MS,
    result,
  });
  return result;
}

/**
 * Prefers what WAHA says now over the recorded status, which only describes
 * the last time the session changed. Falls back to the recorded status when
 * the probe cannot answer.
 */
export async function withLivePlatformWahaHealth(
  organizationId: string,
  recorded: PlatformWahaSessionHealth | null,
  dependencies: LiveProbeDependencies = {},
): Promise<PlatformWahaSessionHealth | null> {
  return (
    (await probePlatformWahaSessionLive(organizationId, dependencies)) ??
    recorded
  );
}

export function resetPlatformWahaLiveProbeCacheForTests(): void {
  cache.clear();
}
