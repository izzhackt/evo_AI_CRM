export type ProviderDisplayStatus =
  | "not_configured"
  | "configured_not_verified"
  | "blocked";

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
