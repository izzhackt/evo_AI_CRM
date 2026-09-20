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

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function visaRow(overrides = {}) {
  return {
    visa_case_id: VISA_ID,
    version: "1",
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
    version: "1",
    studentCaseId: CASE_ID,
    status: "docs",
    note: "Checklist reviewed",
    updatedAt: AT,
  });
});

test("V3 Admissions operations client imports only client-safe contracts", () => {
  const panelSource = source(
    "src/components/v3/profile/ProfileAdmissionsWorkspace.tsx",
  );
  const applicationContract = source("src/lib/platform-application-contract.ts");
  const caseOperationsContract = source(
    "src/lib/platform-case-operations-contract.ts",
  );

  assert.match(panelSource, /@\/lib\/platform-application-contract/);
  // Unified workflow S4: the visa-case CRUD Card (and its
  // PlatformCaseVisa/PLATFORM_VISA_STATUSES import from
  // platform-case-operations-contract) is retired from this client
  // component — it no longer needs that contract module at all. The finance
  // stop actions it still renders come from platform-case-operations-actions
  // (a server-action module, safe for a client component to import).
  assert.doesNotMatch(panelSource, /@\/lib\/platform-case-operations-contract/);
  assert.match(panelSource, /@\/lib\/platform-case-operations-actions/);
  assert.doesNotMatch(
    panelSource,
    /@\/lib\/platform-(?:admissions|case-operations)["']/,
  );
  assert.doesNotMatch(
    `${applicationContract}\n${caseOperationsContract}`,
    /next\/headers|supabase\/server|createSupabaseServerClient/,
  );
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

test("V3 finance actions expose only the canonical stop and release commands", () => {
  const actionSource = readFileSync(
    new URL("../src/lib/platform-case-operations-actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(actionSource, /export async function createPlatformFinanceStopFactorAction/);
  assert.match(actionSource, /export async function resolvePlatformFinanceStopFactorAction/);
  assert.doesNotMatch(
    actionSource,
    /(?:create|settle)PlatformPaymentObligationAction|rpc\(\s*["'](?:create|settle)_payment_obligation["']/,
  );
  assert.doesNotMatch(actionSource, /p_occurred_at|p_amount_minor/);
});

test("P4 stop-factor assertions are permission-scoped and exact-case bound", () => {
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

  assert.match(
    createSource,
    /staffHasPermission\(actor, "finance\.stop\.create"\)/,
  );
  assert.match(resolveSource, /staffHasPermission\(actor, "finance\.stop\.manage"\)/);
  assert.match(
    createSource,
    /rpc\(\s*["']assert_case_finance_stop_factor["'][\s\S]*p_student_case_id:\s*studentCaseId/,
  );
  assert.match(
    createSource,
    /!uuid\(String\(data\.owner_membership_id \?\? ""\)\)/,
  );
  assert.match(
    resolveSource,
    /rpc\(\s*["']resolve_case_stop_factor["'][\s\S]*p_student_case_id:\s*studentCaseId[\s\S]*p_resolution_kind:\s*"admin_override"/,
  );
  assert.doesNotMatch(resolveSource, /activeStopFactors\.some/);
  assert.match(createSource, /revalidateCaseOperations\(studentCaseId\)/);
  assert.match(resolveSource, /revalidateCaseOperations\(studentCaseId\)/);
  assert.match(actionSource, /revalidatePath\("\/v3\/profile"\)/);
  assert.doesNotMatch(createSource + resolveSource, /redirect\(/);
  assert.doesNotMatch(actionSource, /amoCRM|WhatsApp|WAHA/);
});
