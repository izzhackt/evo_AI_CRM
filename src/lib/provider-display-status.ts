export type ProviderDisplayStatus =
  | "not_configured"
  | "configured_not_verified"
  | "ready"
  | "blocked";

const WAHA_READY_MAX_AGE_MS = 5 * 60 * 1000;
const WAHA_READY_MAX_FUTURE_SKEW_MS = 60 * 1000;

export function isFreshWorkingWahaSession(
  health: Readonly<{ status: string; observedAt: string }> | null,
  nowMs: number = Date.now(),
): boolean {
  if (health?.status !== "WORKING" || !Number.isFinite(nowMs)) return false;
  const observedAtMs = Date.parse(health.observedAt);
  if (!Number.isFinite(observedAtMs)) return false;
  return (
    observedAtMs >= nowMs - WAHA_READY_MAX_AGE_MS &&
    observedAtMs <= nowMs + WAHA_READY_MAX_FUTURE_SKEW_MS
  );
}

type ProviderAvailability = Readonly<{
  status: "ready" | "configured" | "blocked";
  reason?:
    | "feature_disabled"
    | "provider_not_authorized"
    | "configuration_missing"
    | "configuration_invalid";
}>;

export function providerDisplayStatus(
  availability: ProviderAvailability,
): ProviderDisplayStatus {
  if (availability.status === "ready" || availability.status === "configured") {
    return "configured_not_verified";
  }

  if (
    availability.reason === "feature_disabled" ||
    availability.reason === "configuration_missing"
  ) {
    return "not_configured";
  }

  return "blocked";
}
