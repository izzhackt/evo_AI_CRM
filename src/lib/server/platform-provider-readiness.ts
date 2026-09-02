import "server-only";

import {
  isFreshWorkingWahaSession,
  type ProviderDisplayStatus,
} from "../provider-display-status.ts";
import type { PlatformWahaSessionHealth } from "../platform-communications";

const GEMINI_API_KEY_PATTERN = /^[A-Za-z0-9_-]{16,4096}$/u;

export type PlatformGeminiProviderAvailability =
  | Readonly<{ status: "configured" }>
  | Readonly<{
      status: "blocked";
      reason: "configuration_missing" | "configuration_invalid";
    }>;

export function readPlatformGeminiProviderAvailability(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlatformGeminiProviderAvailability {
  const apiKey = environment.EVO_PLATFORM_GEMINI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    return Object.freeze({
      status: "blocked" as const,
      reason: "configuration_missing" as const,
    });
  }

  if (!GEMINI_API_KEY_PATTERN.test(apiKey)) {
    return Object.freeze({
      status: "blocked" as const,
      reason: "configuration_invalid" as const,
    });
  }

  return Object.freeze({ status: "configured" as const });
}

export function platformWahaHealthDisplayStatus(
  health: PlatformWahaSessionHealth | null,
  nowMs: number = Date.now(),
): ProviderDisplayStatus {
  if (health === null) return "not_configured";
  return isFreshWorkingWahaSession(health, nowMs) ? "ready" : "blocked";
}
