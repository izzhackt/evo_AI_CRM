import "server-only";

import { randomUUID } from "node:crypto";

import {
  composePlatformReadiness,
  type PlatformReadiness,
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
import { collectPlatformOperationalSignals } from "./platform-operational-signals-repository.ts";
import {
  loadPlatformRecoveryEvidence,
  type PlatformRecoveryEvidence,
} from "./platform-recovery-evidence.ts";

type PlatformOperationsReadinessDependencies = Readonly<{
  loadConfig?: () => PlatformObservabilityConfig;
  collectSignals?: (
    config: PlatformObservabilityEnabledConfig,
    requestId: string,
  ) => Promise<PlatformOperationalSignals>;
  requestId?: () => string;
  now?: () => number;
  loadRecoveryEvidence?: () => Promise<PlatformRecoveryEvidence>;
}>;

export async function loadPlatformOperationsReadiness(
  dependencies: PlatformOperationsReadinessDependencies = {},
): Promise<PlatformReadiness> {
  const requestId = (dependencies.requestId ?? randomUUID)();
  const fallbackObservedAt = new Date(
    (dependencies.now ?? Date.now)(),
  ).toISOString();
  let recovery: PlatformRecoveryEvidence;
  try {
    recovery = await (
      dependencies.loadRecoveryEvidence ?? loadPlatformRecoveryEvidence
    )();
  } catch {
    recovery = {
      source: "failed",
      resultCode: null,
      observedAt: null,
      database: { status: "failed", age_seconds: null },
      storage: { status: "failed", age_seconds: null },
    };
  }
  const unavailable = () =>
    composePlatformReadiness({
      signals: null,
      requestId,
      fallbackObservedAt,
      restoreDatabase: recovery.database,
      restoreStorage: recovery.storage,
    });

  let config: PlatformObservabilityConfig;
  try {
    config = (dependencies.loadConfig ?? loadPlatformObservabilityConfig)();
  } catch {
    return unavailable();
  }
  if (!config.enabled) return unavailable();

  try {
    const collect =
      dependencies.collectSignals ?? collectPlatformOperationalSignals;
    const signals = parsePlatformOperationalSignals(
      await collect(config, requestId),
    );
    return composePlatformReadiness({
      signals,
      requestId,
      fallbackObservedAt,
      restoreDatabase: recovery.database,
      restoreStorage: recovery.storage,
    });
  } catch {
    return unavailable();
  }
}
