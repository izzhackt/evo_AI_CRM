import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformCaseOperationsRepositoryError,
  hasExactPlatformCaseOperationFormKeys,
  normalizePlatformCaseFinanceRow,
  normalizePlatformCaseVisa,
  resolvePlatformFinanceStopFactorWithReconciliation,
} from "../src/lib/platform-case-operations.ts";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const VISA_ID = "22222222-2222-4222-8222-222222222222";
const OBLIGATION_ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-08-13T01:00:00+00:00";

function visaRow(overrides = {}) {
  return {
    visa_case_id: VISA_ID,
    case_id: CASE_ID,
    visa_status: "docs",
    note: "Checklist reviewed",
    updated_at: AT,
    ...overrides,
  };
}

function financeRow(overrides = {}) {
  return {
    case_id: CASE_ID,
    payment_obligation_id: OBLIGATION_ID,
    obligation_label: "EVO service fee",
    category: "evo_service_fee",
    amount_minor: "125000",
    currency: "KGS",
    due_at: AT,
    derived_status: "overdue",
    overdue: true,
    outstanding_minor: "125000",
    next_action: "Confirm payment evidence",
    ...overrides,
  };
}

test("normalizes exact case-scoped visa rows", () => {
  assert.deepEqual(normalizePlatformCaseVisa(visaRow(), CASE_ID), {
    visaCaseId: VISA_ID,
    studentCaseId: CASE_ID,
    status: "docs",
    note: "Checklist reviewed",
    updatedAt: AT,
  });
});

test("form contracts accept only their fields plus Next Server Action metadata", () => {
  const form = new FormData();
  form.set("student_case_id", CASE_ID);
  form.set("request_id", VISA_ID);
  form.set("$ACTION_REF_1", "framework-metadata");
  assert.equal(
    hasExactPlatformCaseOperationFormKeys(
      form,
      ["student_case_id", "request_id"],
    ),
    true,
  );
  form.set("unexpected", "no");
  assert.equal(
    hasExactPlatformCaseOperationFormKeys(
      form,
      ["student_case_id", "request_id"],
    ),
    false,
  );
  form.delete("unexpected");
  form.append("request_id", VISA_ID);
  assert.equal(
    hasExactPlatformCaseOperationFormKeys(
      form,
      ["student_case_id", "request_id"],
    ),
    false,
  );
});

test("U8 reconciles one committed stop resolution after its first response is lost", async () => {
  let calls = 0;
  let auditEvents = 0;

  const resolved = await resolvePlatformFinanceStopFactorWithReconciliation(
    async () => {
      calls += 1;
      if (auditEvents === 0) auditEvents += 1;
      if (calls === 1) throw new Error("transport response was lost");
      return { stopFactorId: VISA_ID, replayed: true };
    },
    (response) => response.stopFactorId === VISA_ID,
  );

  assert.equal(resolved, true);
  assert.equal(calls, 2);
  assert.equal(auditEvents, 1);
});

test("visa rows fail closed on another case or extra keys", () => {
  for (const row of [
    visaRow({ case_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    visaRow({ raw_provider_id: "must-not-pass" }),
  ]) {
    assert.throws(
      () => normalizePlatformCaseVisa(row, CASE_ID),
      PlatformCaseOperationsRepositoryError,
    );
  }
});

test("normalizes exact finance summaries without exposing evidence metadata", () => {
  assert.deepEqual(normalizePlatformCaseFinanceRow(financeRow(), CASE_ID), {
    studentCaseId: CASE_ID,
    paymentObligationId: OBLIGATION_ID,
    label: "EVO service fee",
    category: "evo_service_fee",
    amountMinor: 125000,
    currency: "KGS",
    dueAt: AT,
    status: "overdue",
    overdue: true,
    outstandingMinor: 125000,
    nextAction: "Confirm payment evidence",
  });
});

test("finance summaries reject inconsistent status, unsafe integers and DTO drift", () => {
  for (const row of [
    financeRow({ overdue: false }),
    financeRow({ amount_minor: "9007199254740992" }),
    financeRow({ derived_status: "paid", outstanding_minor: "1" }),
    financeRow({ provider_reference: "private" }),
  ]) {
    assert.throws(
      () => normalizePlatformCaseFinanceRow(row, CASE_ID),
      PlatformCaseOperationsRepositoryError,
    );
  }
});

test("P6D actions bind the exact case and never accept browser amount or time for settlement", () => {
  const actionSource = readFileSync(
    new URL("../src/lib/platform-case-operations-actions.ts", import.meta.url),
    "utf8",
  );
  const settleSource = actionSource.slice(
    actionSource.indexOf("export async function settlePlatformPaymentObligationAction"),
  );
  assert.match(
    actionSource,
    /rpc\(\s*["']settle_payment_obligation["'][\s\S]*p_student_case_id:\s*studentCaseId/,
  );
  assert.doesNotMatch(settleSource, /p_occurred_at/);
  assert.doesNotMatch(settleSource, /p_amount_minor/);
  assert.match(actionSource, /hasExactPlatformCaseOperationFormKeys\(form,/);
  assert.match(actionSource, /listPlatformCaseFinance\(actor, studentCaseId\)/);
  assert.match(
    actionSource,
    /const anchor = operation === "visa" \? "visa" : "payments";/,
  );
  assert.match(
    actionSource,
    /redirect\(`\$\{path\}\?\$\{params\.toString\(\)\}#\$\{anchor\}`\);/,
  );
});

test("U8 stop-factor actions stay admin-only, case-bound, and provider-free", () => {
  const actionSource = readFileSync(
    new URL("../src/lib/platform-case-operations-actions.ts", import.meta.url),
    "utf8",
  );
  const createSource = actionSource.slice(
    actionSource.indexOf("export async function createPlatformFinanceStopFactorAction"),
    actionSource.indexOf("export async function resolvePlatformFinanceStopFactorAction"),
  );
  const resolveSource = actionSource.slice(
    actionSource.indexOf("export async function resolvePlatformFinanceStopFactorAction"),
  );

  assert.match(createSource, /actor\.platformRole !== "admin"/);
  assert.match(resolveSource, /actor\.platformRole !== "admin"/);
  assert.match(createSource, /listPlatformCaseFinance\(actor, studentCaseId\)/);
  assert.match(
    createSource,
    /rpc\(\s*["']create_stop_factor["'][\s\S]*p_student_case_id:\s*studentCaseId/,
  );
  assert.match(
    resolveSource,
    /const rpcArguments = \{[\s\S]*p_student_case_id:\s*studentCaseId[\s\S]*p_resolution_kind:\s*"admin_override"/,
  );
  assert.match(
    resolveSource,
    /resolvePlatformFinanceStopFactorWithReconciliation\([\s\S]*rpc\(\s*["']resolve_case_stop_factor["'],\s*rpcArguments/,
  );
  assert.doesNotMatch(resolveSource, /activeStopFactors\.some/);
  assert.match(createSource, /revalidatePath\("\/applications"\)/);
  assert.match(resolveSource, /revalidatePath\("\/applications"\)/);
  assert.match(actionSource, /if \(!studentCaseId\) \{\s*redirect\("\/clients"\);\s*\}/);
  assert.doesNotMatch(actionSource, /amoCRM|WhatsApp|WAHA/);
});
