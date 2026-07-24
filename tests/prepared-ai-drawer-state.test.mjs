import assert from "node:assert/strict";
import test from "node:test";

import {
  preparedAiBundleFingerprint,
  resolvePreparedAiSelection,
  resolvePreparedAiStreamLength,
} from "../src/lib/prepared-ai-drawer-state.ts";

function bundle({
  selectedScenarioId = "price-boundary",
  priceResponse = "Initial price response",
} = {}) {
  return {
    mode: "prepared_first_presentation",
    label: "Подготовленный AI",
    selectedScenarioId,
    promptLibrary: [
      {
        id: "wa-price-boundary",
        title: "Цена",
        purpose: "Не выдумывать цену",
        instructions: ["Использовать только данные CRM"],
      },
      {
        id: "wa-consultation-booking",
        title: "Консультация",
        purpose: "Предложить следующий шаг",
        instructions: ["Не выдумывать свободные слоты"],
      },
    ],
    scenarios: [
      {
        id: "price-boundary",
        title: "Цена",
        promptId: "wa-price-boundary",
        trigger: "Клиент спрашивает цену",
        response: priceResponse,
        checks: [],
      },
      {
        id: "consultation-booking",
        title: "Консультация",
        promptId: "wa-consultation-booking",
        trigger: "Клиент просит консультацию",
        response: "Fresh consultation response",
        checks: [],
      },
    ],
    facts: [],
  };
}

test("keeps the operator selection while the prepared bundle is unchanged", () => {
  const currentBundle = bundle();
  const fingerprint = preparedAiBundleFingerprint(currentBundle);

  assert.equal(
    resolvePreparedAiSelection(currentBundle, fingerprint, {
      fingerprint,
      selectedId: "consultation-booking",
    }),
    "consultation-booking",
  );
  assert.equal(
    resolvePreparedAiStreamLength(
      fingerprint,
      "consultation-booking",
      27,
      {
        fingerprint,
        scenarioId: "consultation-booking",
        length: 12,
      },
    ),
    12,
  );
});

test("drops stale selection and streamed text when refreshed CRM context changes the bundle", () => {
  const oldBundle = bundle();
  const oldFingerprint = preparedAiBundleFingerprint(oldBundle);
  const refreshedBundle = bundle({
    selectedScenarioId: "consultation-booking",
    priceResponse: "Updated response from the refreshed conversation context",
  });
  const refreshedFingerprint = preparedAiBundleFingerprint(refreshedBundle);

  assert.notEqual(refreshedFingerprint, oldFingerprint);
  assert.equal(
    resolvePreparedAiSelection(refreshedBundle, refreshedFingerprint, {
      fingerprint: oldFingerprint,
      selectedId: "price-boundary",
    }),
    "consultation-booking",
  );
  assert.equal(
    resolvePreparedAiStreamLength(
      refreshedFingerprint,
      "consultation-booking",
      27,
      {
        fingerprint: oldFingerprint,
        scenarioId: "price-boundary",
        length: 18,
      },
    ),
    0,
  );
});
