const UI_CONTRACT_FIXTURE_FLAG = "EVO_UI_CONTRACT_FIXTURES";

/**
 * Keeps the retired UI-contract flag fail-closed while old deployment
 * templates are preserved as rollback evidence. No fixture data source is
 * available to the successor runtime.
 */
export function isUiContractFixtureMode(): boolean {
  const enabled = process.env[UI_CONTRACT_FIXTURE_FLAG] === "1";
  if (enabled && process.env.NODE_ENV === "production") {
    throw new Error(
      `${UI_CONTRACT_FIXTURE_FLAG} cannot be enabled in production`,
    );
  }
  return enabled;
}
