import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMISSIONS_STEPS,
  buildAdmissionsOverview,
  isPreDeliveryStage,
  resolveAdmissionsStep,
} from "../src/lib/platform-admissions-overview.ts";

function row(overrides = {}) {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    studentCaseId: "22222222-2222-4222-8222-222222222222",
    studentDisplayName: "Студент",
    targetCountry: "Малайзия",
    targetDegree: "Бакалавриат",
    programDirection: null,
    intake: "2026-09",
    languageAssumption: null,
    fundingAssumption: null,
    routeApprovalStatus: "approved",
    operationalStage: "documents",
    state: "active",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    handoffAt: null,
    nextAction: null,
    responsibleSalesDisplayName: "Продажи",
    currentCuratorDisplayName: "Куратор",
    appliedOzoWorkflowContractVersionId: null,
    overdueTaskCount: 0,
    overdueObligationCount: 0,
    rejectedDocumentCount: 0,
    ...overrides,
  };
}

test("the funnel is the five delivery steps the owner named", () => {
  assert.deepEqual(ADMISSIONS_STEPS, [
    "documents",
    "applications",
    "decisions",
    "visa",
    "enrolled",
  ]);
});

test("known stages map onto their step", () => {
  assert.equal(resolveAdmissionsStep("documents"), "documents");
  assert.equal(resolveAdmissionsStep("applications"), "applications");
  assert.equal(resolveAdmissionsStep("decisions"), "decisions");
  assert.equal(resolveAdmissionsStep("visa_predeparture"), "visa");
  assert.equal(resolveAdmissionsStep("completed"), "enrolled");
  assert.equal(resolveAdmissionsStep("  DOCUMENTS  "), "documents");
});

test("an unrecognised stage is refused rather than guessed", () => {
  // Stage keys live in a versioned workflow contract, so a new one can appear
  // without a migration. Forcing it into the nearest step would read as
  // confident and wrong.
  assert.equal(resolveAdmissionsStep("negotiation"), null);
  assert.equal(resolveAdmissionsStep(""), null);
});

test("pre-delivery stages are not funnel positions", () => {
  assert.equal(isPreDeliveryStage("intake"), true);
  assert.equal(isPreDeliveryStage("profile_route"), true);
  assert.equal(isPreDeliveryStage("documents"), false);
});

test("cases group by country and step", () => {
  const overview = buildAdmissionsOverview([
    row({ targetCountry: "Малайзия", operationalStage: "documents" }),
    row({ targetCountry: "Малайзия", operationalStage: "applications" }),
    row({ targetCountry: "Китай", operationalStage: "decisions" }),
  ]);
  assert.equal(overview.totalCases, 3);
  assert.equal(overview.countries.length, 2);
  const malaysia = overview.countries.find((item) => item.country === "Малайзия");
  assert.equal(malaysia.totalCases, 2);
  assert.equal(
    malaysia.steps.find((step) => step.step === "documents").cases.length,
    1,
  );
  assert.equal(
    malaysia.steps.find((step) => step.step === "enrolled").cases.length,
    0,
  );
});

test("a closed case is reported but never occupies a funnel step", () => {
  const overview = buildAdmissionsOverview([
    row({ state: "closed", operationalStage: "applications" }),
  ]);
  const country = overview.countries[0];
  assert.equal(country.closedCount, 1);
  assert.equal(country.totalCases, 1);
  for (const step of country.steps) assert.equal(step.cases.length, 0);
});

test("an unknown stage is counted separately and surfaced at the top level", () => {
  const overview = buildAdmissionsOverview([
    row({ operationalStage: "negotiation" }),
    row({ operationalStage: "intake" }),
  ]);
  const country = overview.countries[0];
  assert.equal(country.unknownStageCount, 1);
  assert.equal(country.beforeDeliveryCount, 1);
  assert.equal(overview.unknownStageCount, 1);
  // Every case is accounted for exactly once.
  const inSteps = country.steps.reduce((sum, step) => sum + step.cases.length, 0);
  assert.equal(
    inSteps + country.beforeDeliveryCount + country.unknownStageCount + country.closedCount,
    country.totalCases,
  );
});

test("any overdue signal marks a case for attention", () => {
  for (const field of [
    "overdueTaskCount",
    "overdueObligationCount",
    "rejectedDocumentCount",
  ]) {
    const overview = buildAdmissionsOverview([row({ [field]: 2 })]);
    assert.equal(overview.totalAttention, 1, field);
    assert.equal(overview.countries[0].steps[0].cases[0].hasAttention, true, field);
  }
});

test("countries needing attention are listed first", () => {
  const overview = buildAdmissionsOverview([
    row({ targetCountry: "Китай" }),
    row({ targetCountry: "Китай" }),
    row({ targetCountry: "Польша", overdueTaskCount: 1 }),
  ]);
  // Poland has one case against China's two, but it needs attention.
  assert.equal(overview.countries[0].country, "Польша");
});

test("students are ordered by name so the table is stable", () => {
  const overview = buildAdmissionsOverview([
    row({ studentDisplayName: "Ясмина", studentCaseId: "33333333-3333-4333-8333-333333333333" }),
    row({ studentDisplayName: "Азамат" }),
  ]);
  const names = overview.countries[0].steps[0].cases.map((item) => item.studentDisplayName);
  assert.deepEqual(names, ["Азамат", "Ясмина"]);
});
