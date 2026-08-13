import "server-only";

import {
  composePlatformReadiness,
  renderPlatformMetrics,
} from "../platform-observability.ts";
import {
  parsePlatformOperationalSignals,
  type PlatformOperationalSignals,
} from "../platform-operational-signals.ts";
import {
  loadPlatformObservabilityConfig,
  type PlatformObservabilityConfig,
  type PlatformObservabilityEnabledConfig,
} from "./platform-observability-config.ts";
import {
  authenticatePlatformObservabilityRequest,
  emptyPlatformObservabilityNotFound,
  PLATFORM_OBSERVABILITY_PATHS,
  type PlatformObservabilityPath,
} from "./platform-observability-request.ts";
import { collectPlatformOperationalSignals } from "./platform-operational-signals-repository.ts";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const PLATFORM_METRICS_CONTENT_TYPE =
  "text/plain; version=0.0.4; charset=utf-8";

type PlatformObservabilityCompletion = Readonly<{
  path: PlatformObservabilityPath;
  requestId: string;
  status: number;
  startedAtMs: number;
  completedAtMs: number;
}>;

type RouteDependencies = Readonly<{
  loadConfig?: () => PlatformObservabilityConfig;
  collectSignals?: (
    config: PlatformObservabilityEnabledConfig,
    requestId: string,
  ) => Promise<PlatformOperationalSignals>;
  logCompletion?: (completion: PlatformObservabilityCompletion) => void;
  now?: () => number;
}>;

export type PlatformObservabilityRoute = (
  request: Request,
) => Promise<Response>;

function authenticatedHeaders(contentType: string): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
}

function emptyServiceUnavailable(): Response {
  return new Response(null, {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function logPlatformObservabilityRequest(
  completion: PlatformObservabilityCompletion,
): void {
  console.info(JSON.stringify({
    event_code:
      completion.path === PLATFORM_OBSERVABILITY_PATHS.readiness
        ? "p7b_readiness_request"
        : "p7b_metrics_request",
    service: "evo-crm",
    request_id: completion.requestId,
    method: "GET",
    route_template: completion.path,
    status_class: `${Math.floor(completion.status / 100)}xx`,
    elapsed_ms: Math.max(
      0,
      Math.floor(completion.completedAtMs - completion.startedAtMs),
    ),
  }));
}

function completedResponse(
  response: Response,
  path: PlatformObservabilityPath,
  authenticated: Readonly<{ requestId: string; nowMs: number }>,
  dependencies: RouteDependencies,
): Response {
  let completedAtMs = authenticated.nowMs;
  try {
    completedAtMs = (dependencies.now ?? Date.now)();
  } catch {
    // Logging is operational evidence, never part of the response authority.
  }
  try {
    (dependencies.logCompletion ?? logPlatformObservabilityRequest)({
      path,
      requestId: authenticated.requestId,
      status: response.status,
      startedAtMs: authenticated.nowMs,
      completedAtMs,
    });
  } catch {
    // A logging sink failure must not change the private route response.
  }
  return response;
}

function resolveAuthenticatedRequest(
  request: Request,
  path: PlatformObservabilityPath,
  dependencies: RouteDependencies,
): Readonly<{
  config: PlatformObservabilityEnabledConfig;
  requestId: string;
  nowMs: number;
}> | null {
  let config: PlatformObservabilityConfig;
  try {
    config = (dependencies.loadConfig ?? loadPlatformObservabilityConfig)();
  } catch {
    return null;
  }
  if (!config.enabled) return null;

  const nowMs = (dependencies.now ?? Date.now)();
  const authentication = authenticatePlatformObservabilityRequest(
    request,
    path,
    config.observabilitySecret,
    nowMs,
  );
  if (!authentication) return null;

  return Object.freeze({
    config,
    requestId: authentication.requestId,
    nowMs,
  });
}

async function collectReadiness(
  dependencies: RouteDependencies,
  authenticated: Readonly<{
    config: PlatformObservabilityEnabledConfig;
    requestId: string;
    nowMs: number;
  }>,
) {
  const collect =
    dependencies.collectSignals ?? collectPlatformOperationalSignals;
  let signals: PlatformOperationalSignals | null = null;
  try {
    signals = parsePlatformOperationalSignals(
      await collect(authenticated.config, authenticated.requestId),
    );
  } catch {
    signals = null;
  }
  return composePlatformReadiness({
    signals,
    requestId: authenticated.requestId,
    fallbackObservedAt: new Date(authenticated.nowMs).toISOString(),
  });
}

export function createPlatformReadinessRoute(
  dependencies: RouteDependencies = {},
): PlatformObservabilityRoute {
  return async (request) => {
    const authenticated = resolveAuthenticatedRequest(
      request,
      PLATFORM_OBSERVABILITY_PATHS.readiness,
      dependencies,
    );
    if (!authenticated) return emptyPlatformObservabilityNotFound();

    try {
      const readiness = await collectReadiness(dependencies, authenticated);
      return completedResponse(
        new Response(JSON.stringify(readiness), {
          status: readiness.ok ? 200 : 503,
          headers: authenticatedHeaders(JSON_CONTENT_TYPE),
        }),
        PLATFORM_OBSERVABILITY_PATHS.readiness,
        authenticated,
        dependencies,
      );
    } catch {
      return completedResponse(
        emptyServiceUnavailable(),
        PLATFORM_OBSERVABILITY_PATHS.readiness,
        authenticated,
        dependencies,
      );
    }
  };
}

export function createPlatformMetricsRoute(
  dependencies: RouteDependencies = {},
): PlatformObservabilityRoute {
  return async (request) => {
    const authenticated = resolveAuthenticatedRequest(
      request,
      PLATFORM_OBSERVABILITY_PATHS.metrics,
      dependencies,
    );
    if (!authenticated) return emptyPlatformObservabilityNotFound();

    try {
      const readiness = await collectReadiness(dependencies, authenticated);
      const body = renderPlatformMetrics(readiness);
      return completedResponse(
        new Response(body, {
          status: 200,
          headers: authenticatedHeaders(PLATFORM_METRICS_CONTENT_TYPE),
        }),
        PLATFORM_OBSERVABILITY_PATHS.metrics,
        authenticated,
        dependencies,
      );
    } catch {
      return completedResponse(
        emptyServiceUnavailable(),
        PLATFORM_OBSERVABILITY_PATHS.metrics,
        authenticated,
        dependencies,
      );
    }
  };
}

export const platformReadinessRoute = createPlatformReadinessRoute();
export const platformMetricsRoute = createPlatformMetricsRoute();
