import { isUiContractFixtureMode } from "./runtime-mode";

/**
 * Keeps the historical UI-contract flag fail-closed until the student portal
 * is replaced in #432. No fixture data source remains available to V2.
 */
export async function getFixturePortalPageData(): Promise<never> {
  if (!isUiContractFixtureMode()) {
    throw new Error("Portal fixture data is disabled");
  }

  throw new Error(
    "The legacy portal fixture runtime was removed; the V2 student portal is not available yet",
  );
}
