import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V2-8B has no SQLite application, visa, or finance mutation entry points", () => {
  const actions = source("src/lib/actions.ts");

  for (const exportName of [
    "addApplicationAction",
    "setApplicationStatusAction",
    "upsertVisaCaseAction",
    "addPaymentAction",
    "markPaymentPaidAction",
  ]) {
    assert.doesNotMatch(actions, new RegExp(`export async function ${exportName}\\b`));
  }
  assert.doesNotMatch(
    actions,
    /(?:INSERT INTO|UPDATE)\s+(?:applications|visa_cases|payments)\b/i,
  );
});

test("V2-8B has no superseded SQLite staff queue repository", () => {
  const queries = source("src/lib/queries.ts");

  for (const exportName of [
    "allApplications",
    "getApplication",
    "allVisaCases",
    "getVisaCase",
    "allPayments",
    "getPayment",
    "listApplicationsForActor",
    "getApplicationForActor",
    "listVisaCasesForActor",
    "getVisaCaseForActor",
    "listFinanceClientsForActor",
    "listPaymentsForActor",
    "getPaymentForActor",
  ]) {
    assert.doesNotMatch(queries, new RegExp(`export function ${exportName}\\b`));
  }
});

test("V2-8B does not seed fake application, visa, or payment records", () => {
  const database = source("src/lib/db.ts");

  assert.doesNotMatch(database, /export const (?:APP|VISA|PAYMENT)_STATUSES\b/);
  assert.doesNotMatch(
    database,
    /INSERT INTO\s+(?:applications|visa_cases|payments)\b/i,
  );
});
