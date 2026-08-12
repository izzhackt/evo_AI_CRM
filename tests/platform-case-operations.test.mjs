import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformCaseOperationsRepositoryError,
  hasExactPlatformCaseOperationFormKeys,
  normalizePlatformCaseFinanceRow,
  normalizePlatformCaseVisa,
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
});

test("Student 360 uses distinct Platform evidence forms and never prefills private evidence", () => {
  const pageSource = readFileSync(
    new URL(
      "../src/app/(staff)/clients/[id]/ClientPageContent.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(pageSource, /data-testid="platform-visa-form"/);
  assert.match(pageSource, /data-testid="platform-payment-create-form"/);
  assert.match(
    pageSource,
    /data-testid=\{`platform-payment-settle-form-\$\{p\.id\}`\}/,
  );
  assert.match(
    pageSource,
    /name="evidence_reference"[\s\S]*required[\s\S]*autoComplete="off"/,
  );
  assert.doesNotMatch(pageSource, /name="evidence_reference"[^>]*defaultValue/);
  assert.doesNotMatch(pageSource, /name="evidence_ref"[^>]*defaultValue/);
});
