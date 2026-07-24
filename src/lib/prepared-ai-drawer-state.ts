import type {
  PreparedAiBundle,
  PreparedAiScenarioId,
} from "./prepared-ai";

export type PreparedAiSelectionState = {
  fingerprint: string;
  selectedId: PreparedAiScenarioId;
};

export type PreparedAiStreamState = {
  fingerprint: string;
  scenarioId: PreparedAiScenarioId;
  length: number;
};

export function preparedAiBundleFingerprint(bundle: PreparedAiBundle): string {
  return JSON.stringify({
    label: bundle.label,
    selectedScenarioId: bundle.selectedScenarioId,
    promptLibrary: bundle.promptLibrary,
    scenarios: bundle.scenarios,
    facts: bundle.facts,
  });
}

export function resolvePreparedAiSelection(
  bundle: PreparedAiBundle,
  fingerprint: string,
  state: PreparedAiSelectionState,
): PreparedAiScenarioId {
  const stateStillMatches =
    state.fingerprint === fingerprint &&
    bundle.scenarios.some((scenario) => scenario.id === state.selectedId);

  return stateStillMatches ? state.selectedId : bundle.selectedScenarioId;
}

export function resolvePreparedAiStreamLength(
  fingerprint: string,
  scenarioId: PreparedAiScenarioId,
  responseLength: number,
  state: PreparedAiStreamState,
): number {
  if (state.fingerprint !== fingerprint || state.scenarioId !== scenarioId) {
    return 0;
  }

  return Math.min(Math.max(state.length, 0), responseLength);
}
