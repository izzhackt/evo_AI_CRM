const UI_CONTRACT_FIXTURE_FLAG = "EVO_UI_CONTRACT_FIXTURES";

/**
 * Keeps the pre-Platform SQLite experience available only to the existing
 * visual-regression suite. The greenfield Platform runtime must never fall
 * back to this data plane.
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
