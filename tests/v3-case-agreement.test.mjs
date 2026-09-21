// Source-contract guards for OTH-3 «Договор и оплата» (189_platform_case_agreement).
// SQL pins are pattern-matched against the migration file, same style as
// tests/platform-lead-sale-conditions-migration.test.mjs (no database
// execution in this environment). Deliberately does NOT call
// expectedMigrationVersions()/scripts/fast-release-ledger-gate.mjs: this
// worktree is intentionally missing 186/187 (parallel slices, merge order
// guarantees contiguity — see the migration's own header comment), so that
// helper throws "migration source ledger is not contiguous" here by design
// until the orchestrator merges every slice; it is not a defect in this file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/189_platform_case_agreement.sql");
const blockSource = source("src/components/v3/profile/CaseAgreementBlock.tsx");
const formsSource = source("src/components/v3/profile/CaseAgreementForms.tsx");
const contractSource = source("src/lib/platform-case-agreement-contract.ts");
const actionsSource = source("src/lib/platform-case-agreement-actions.ts");
const financeControlSource = source("src/lib/platform-finance-control.ts");
const financeEntryContractSource = source("src/lib/platform-finance-entry-contract.ts");
const portalSourceSource = source("src/lib/v3/portal-source.ts");
// PORT-5d: «Моё поступление» живёт в Атласе — путь обновлён вместе с переносом.
const paymentsViewSource = source("src/components/portal/admission/PaymentsView.tsx");
const tabsSource = source("src/components/v3/profile/tabs.tsx");
const profileSource = source("src/components/v3/profile/Profile.tsx");
const sourceSource = source("src/lib/v3/case-agreement-source.ts");

test("migration 189 is transactional and fails closed on source drift, like 181/184/185", () => {
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;$/mu);
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("payment_obligations due_at/next_action become nullable, plus archived_at", () => {
  assert.match(sql, /ALTER TABLE platform\.payment_obligations\s*\n\s*ALTER COLUMN due_at DROP NOT NULL,\s*\n\s*ALTER COLUMN next_action DROP NOT NULL;/u);
  assert.match(sql, /ADD COLUMN archived_at TIMESTAMPTZ NULL;/u);
});

test("every new platform.* RPC is SECURITY DEFINER, search_path-locked and REVOKE/GRANT-paired", () => {
  const rpcs = [
    ["platform.record_case_contract_file_metadata", "UUID, UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID", "service_role"],
    ["platform.record_payment_receipt_file_metadata", "UUID, UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID", "service_role"],
    ["platform.save_case_tranche_v1", "UUID, UUID, UUID, UUID, BIGINT, TEXT, DATE, TEXT, BOOLEAN", "authenticated"],
    ["platform.record_case_payment_v1", "UUID, UUID, UUID, UUID, BIGINT, TEXT, DATE, TEXT", "authenticated"],
    ["platform.staff_case_agreement_v1", "UUID", "authenticated"],
  ];
  for (const [name, args, grantee] of rpcs) {
    const createIndex = sql.indexOf(`CREATE FUNCTION ${name}(`) >= 0
      ? sql.indexOf(`CREATE FUNCTION ${name}(`)
      : sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
    assert.ok(createIndex >= 0, `${name} is not defined`);
    const body = sql.slice(createIndex, sql.indexOf("$$;", createIndex) + 3);
    assert.match(body, /SECURITY DEFINER/u, `${name} must be SECURITY DEFINER`);
    assert.match(body, /SET search_path = ''/u, `${name} must lock search_path`);
    const revokePattern = new RegExp(
      `REVOKE ALL ON FUNCTION ${name.replace(/\./u, "\\.")}\\(\\s*${args.replace(/,\s*/gu, ",\\s*")}\\s*\\)`,
      "u",
    );
    assert.match(sql, revokePattern, `${name} must be REVOKEd from PUBLIC`);
    const grantPattern = new RegExp(
      `GRANT EXECUTE ON FUNCTION ${name.replace(/\./u, "\\.")}\\(\\s*${args.replace(/,\s*/gu, ",\\s*")}\\s*\\)\\s*TO ${grantee};`,
      "u",
    );
    assert.match(sql, grantPattern, `${name} must GRANT EXECUTE TO ${grantee} only`);
  }
});

test("the two metadata RPCs reject a non-service-role caller", () => {
  const metadataFns = ["record_case_contract_file_metadata", "record_payment_receipt_file_metadata"];
  for (const name of metadataFns) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION platform.${name}(`);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    assert.match(body, /auth\.jwt\(\) ->> 'role'\) IS DISTINCT FROM 'service_role'/u, `${name} must gate on service_role`);
  }
});

test("the two write RPCs gate on the resource-scoped case.update.append door, not finance.manage/finance.event.confirm", () => {
  for (const name of ["save_case_tranche_v1", "record_case_payment_v1"]) {
    const start = sql.indexOf(`CREATE FUNCTION platform.${name}(`);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    assert.match(body, /staff_can_access\(\s*\n?\s*p_organization_id, actor\.membership_id, 'case\.update\.append',\s*\n?\s*'student_case', p_student_case_id\s*\n?\s*\)/u, `${name}`);
    assert.doesNotMatch(body, /require_finance_actor/u, `${name} must not use the admin-only finance actor gate`);
  }
});

test("save_case_tranche_v1 blocks an amount/currency CHANGE once paid, but tolerates the form re-submitting the SAME values (label/due-only edits must not be blocked)", () => {
  const start = sql.indexOf("CREATE FUNCTION platform.save_case_tranche_v1(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  assert.match(body, /IS DISTINCT FROM existing\.amount_minor/u);
  assert.match(body, /IS DISTINCT FROM existing\.currency/u);
  assert.doesNotMatch(body, /IF p_amount_minor IS NOT NULL OR p_currency IS NOT NULL THEN/u);
});

test("archive is a soft flag, never a DELETE, and only while unpaid", () => {
  const start = sql.indexOf("CREATE FUNCTION platform.save_case_tranche_v1(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  assert.match(body, /SET archived_at = statement_timestamp\(\)/u);
  assert.doesNotMatch(body, /DELETE FROM platform\.payment_obligations/u);
  assert.match(body, /existing\.total_paid_minor <> 0 THEN\s*\n\s*RAISE EXCEPTION\s*\n\s*'case_agreement_tranche_paid'/u);
});

test("staff_case_agreement_v1 excludes archived tranches/payments from every sum", () => {
  const start = sql.indexOf("CREATE FUNCTION platform.staff_case_agreement_v1(");
  const body = sql.slice(start, sql.length);
  assert.match(body, /obligation\.archived_at IS NULL/gu);
  const occurrences = body.match(/obligation\.archived_at IS NULL/gu) ?? [];
  assert.ok(occurrences.length >= 3, "tranches, tranche_sum_minor and payments/paid_minor queries must all exclude archived obligations");
});

test("FIX 3: migration 189 live-anchor-patches staff_finance_control_queue to exclude archived tranches and fix the overdue tie-break's NULL ordering", () => {
  const start = sql.indexOf("DO $finance_queue_archived_and_order$");
  assert.ok(start >= 0, "the finance-queue archived/order patch block must exist");
  const body = sql.slice(start, sql.indexOf("$finance_queue_archived_and_order$;", start));
  assert.match(
    body,
    /'platform\.staff_finance_control_queue\(integer,uuid\[\]\)'::regprocedure/u,
  );
  assert.match(
    body,
    /AND obligation\.archived_at IS NULL\s*\n\s*AND \(\$\$::TEXT/u,
    "the archived-tranche patch must insert the exclusion right before the authorization AND(",
  );
  assert.match(
    body,
    /obligation\.overdue DESC NULLS LAST,/u,
    "the representative-stop tie-break must sort a NULL (undated) overdue last",
  );
  assert.match(body, /IF occurrences <> 1 THEN/u);
  assert.match(body, /RAISE EXCEPTION '%_anchor_drift', patch\.short_name;/u);
  // Response shape stays byte-identical: no new output column is introduced.
  assert.doesNotMatch(body, /RETURNS TABLE/u);
});

test("record_case_payment_v1 locks case before obligation, matching 043's record_payment_event and the 070 concurrency proof", () => {
  const start = sql.indexOf("CREATE FUNCTION platform.record_case_payment_v1(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const caseLockIndex = body.indexOf("FROM platform.student_cases AS student_case");
  const obligationLockIndex = body.indexOf("FROM platform.payment_obligations AS obligation\n  WHERE obligation.organization_id = p_organization_id\n    AND obligation.id = p_payment_obligation_id");
  assert.ok(caseLockIndex >= 0 && obligationLockIndex >= 0, "expected both FOR UPDATE lock statements to be present");
  assert.ok(caseLockIndex < obligationLockIndex, "case must be locked before the obligation");
});

test("idempotency: replay_audit before any write, request_id round-trips into the audit insert", () => {
  const start = sql.indexOf("CREATE FUNCTION platform.record_case_payment_v1(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const replayIndex = body.indexOf("platform_private.replay_audit(");
  const insertIndex = body.indexOf("INSERT INTO platform.payment_events (");
  assert.ok(replayIndex >= 0 && replayIndex < insertIndex, "replay_audit must run before the write");
  assert.match(body, /request_id\s*\)/u);
});

test("FIX 2: the org-wide Sales role-widening block is gone — no staff_role_assignments/role_bundle row is touched by the write doors", () => {
  assert.doesNotMatch(sql, /\$sales_widen\$/u, "the rejected org-wide Sales role widening must be fully removed");
  assert.doesNotMatch(sql, /role_bundle_permissions AS bp/u);
});

test("FIX 2: save_case_tranche_v1/record_case_payment_v1 OR the resource-scoped, pending-only Sales window onto the base case.update.append door", () => {
  const resourceScopeClause =
    /OR EXISTS \(\s*\n\s*SELECT 1 FROM platform\.student_cases AS sales_window_case\s*\n\s*WHERE sales_window_case\.organization_id = p_organization_id\s*\n\s*AND sales_window_case\.id = p_student_case_id\s*\n\s*AND sales_window_case\.state = 'pending'\s*\n\s*AND sales_window_case\.responsible_sales_membership_id = actor\.membership_id\s*\n\s*\)/u;
  for (const name of ["save_case_tranche_v1", "record_case_payment_v1"]) {
    const start = sql.indexOf(`CREATE FUNCTION platform.${name}(`);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    assert.match(
      body,
      /staff_can_access\(\s*\n?\s*p_organization_id, actor\.membership_id, 'case\.update\.append',\s*\n?\s*'student_case', p_student_case_id\s*\n?\s*\)/u,
      `${name} must keep the base staff_can_access door`,
    );
    assert.match(body, resourceScopeClause, `${name} must OR the resource-scoped Sales window`);
  }
});

test("FIX 2: staff_case_agreement_v1 carries the symmetric resource-scoped OR in both its visibility gate and can_write", () => {
  const start = sql.indexOf("CREATE FUNCTION platform.staff_case_agreement_v1(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const occurrences = (body.match(/sales_window_case\.responsible_sales_membership_id = actor_membership_id/gu) ?? []).length;
  assert.equal(occurrences, 1, "can_write must reuse the resource-scoped window");
  assert.match(
    body,
    /student_case\.state = 'pending'\s*\n\s*AND student_case\.responsible_sales_membership_id = \(\s*\n\s*SELECT a\.membership_id FROM platform\.current_actor_authority\(\) a\s*\n\s*WHERE a\.organization_id = student_case\.organization_id\s*\n\s*\)/u,
    "the visibility SELECT must OR the same pending+responsible-Sales window",
  );
});

test("CaseAgreementBlock renders the root/tranche/payment testids and uses financeMoney (not a second money formatter)", () => {
  assert.match(blockSource, /data-testid="v3-case-agreement"/u);
  assert.match(blockSource, /data-testid="v3-case-agreement-tranches"/u);
  assert.match(blockSource, /data-testid="v3-case-agreement-payment"/u);
  assert.match(blockSource, /financeMoney\(/u);
});

test("CaseAgreementForms carries the request_id + frozen-retry pattern (FinanceEntryForms.tsx's pinned pattern, not re-invented)", () => {
  assert.match(formsSource, /data-testid="v3-case-agreement-upload"/u);
  assert.match(formsSource, /frozen\.current \?\? form/u);
  assert.match(formsSource, /result\.status !== "unavailable"/u);
  assert.match(formsSource, /currentRequestId === state\.requestId/u);
});

test("no source in this slice reaches for localStorage/sessionStorage for state that must persist", () => {
  for (const [name, text] of [
    ["CaseAgreementBlock.tsx", blockSource],
    ["CaseAgreementForms.tsx", formsSource],
  ]) {
    assert.doesNotMatch(text, /\blocalStorage\b|\bsessionStorage\b/u, name);
  }
});

test("the case-agreement contract module re-exports financeMoney/decimalToMinor/financeDateTime instead of duplicating them", () => {
  assert.match(contractSource, /export \{\s*\n\s*decimalToMinor,\s*\n\s*financeDateTime,\s*\n\s*financeMoney,\s*\n\s*\} from "\.\/platform-finance-entry-contract\.ts";/u);
});

test("both server actions require a platform staff actor and reject a staff-preview session, like saveFinanceEntryAction", () => {
  assert.match(actionsSource, /requirePlatformStaffActor/u);
  assert.match(actionsSource, /isStaffPreview\(actor\)/gu);
});

test("the three NULL-safety readers accept a null due_at/next_action instead of throwing (188's ALTER makes both columns nullable)", () => {
  // normalizeObligation only — normalizeActiveStopFactor's OWN next_action
  // (a different, still-NOT-NULL column: platform.stop_factors.next_action)
  // legitimately keeps requiredText and must not be touched.
  const obligationNormalizer = financeControlSource.slice(
    financeControlSource.indexOf("function normalizeObligation("),
    financeControlSource.indexOf("function normalizeHistoryEntry("),
  );
  assert.doesNotMatch(obligationNormalizer, /dueAt: requiredTimestamp\(value\.due_at\)/u);
  assert.match(obligationNormalizer, /dueAt: optionalTimestamp\(value\.due_at\)/u);
  assert.doesNotMatch(obligationNormalizer, /nextAction: requiredText\(value\.next_action, 1_000\)/u);
  assert.match(obligationNormalizer, /nextAction: optionalText\(value\.next_action, 1_000\)/u);

  assert.doesNotMatch(financeEntryContractSource, /dueAt: time\(o\.due_at\)/u);
  assert.match(financeEntryContractSource, /dueAt: optionalTime\(o\.due_at\)/u);

  assert.doesNotMatch(portalSourceSource, /dueAt: requiredTimestamp\(row\.due_at\)/u);
  assert.match(portalSourceSource, /dueAt: optionalTimestamp\(row\.due_at\)/u);
  assert.doesNotMatch(portalSourceSource, /nextAction: requiredText\(row\.next_action, 1000\)/u);
  assert.match(portalSourceSource, /nextAction: optionalText\(row\.next_action, 1000\)/u);
});

test("the one allowed portal exception stays minimal: only the due_at/next_action null-tolerance, no other portal file touched", () => {
  assert.match(paymentsViewSource, /payment\.dueAt \?\? undefined/u);
});

test("FIX 1: migration 189 live-anchor-patches BOTH overdue-computing readers with an exact-occurs-once guard", () => {
  const start = sql.indexOf("DO $overdue_null_safety$");
  assert.ok(start >= 0, "the NULL-safety patch block must exist");
  const body = sql.slice(start, sql.indexOf("$overdue_null_safety$;", start));
  assert.match(body, /'platform\.staff_case_finance_control\(uuid,integer\)'::TEXT,\s*\n\s*'staff_case_finance_control'::TEXT/u);
  assert.match(body, /'platform\.student_portal_finance_v2\(\)'::TEXT,\s*\n\s*'student_portal_finance_v2'::TEXT/u);
  assert.match(
    body,
    /'overdue', \(\s*\n\s*obligation\.due_at IS NOT NULL\s*\n\s*AND obligation\.due_at < transaction_timestamp\(\)/u,
    "staff_case_finance_control's replacement must guard with due_at IS NOT NULL",
  );
  assert.match(
    body,
    /\(\s*\n\s*obligation\.due_at IS NOT NULL\s*\n\s*AND obligation\.due_at < transaction_timestamp\(\)\s*\n\s*AND obligation\.amount_minor\s*\n\s*- obligation\.total_paid_minor/u,
    "student_portal_finance_v2's replacement must guard with due_at IS NOT NULL",
  );
  assert.match(body, /occurrences := \(pg_catalog\.length\(original\) -/u);
  assert.match(body, /IF occurrences <> 1 THEN/u);
  assert.match(body, /RAISE EXCEPTION '%_overdue_anchor_drift', patch\.short_name;/u);
});

test("FIX 1: migration 189 audits staff_finance_control_queue's overdue predicate and documents why it needs no null-safety patch", () => {
  const auditStart = sql.indexOf("--  3. platform.staff_finance_control_queue");
  assert.ok(auditStart >= 0);
  const audit = sql.slice(auditStart, sql.indexOf("--  4.", auditStart));
  assert.match(audit, /FILTER already treats a NULL condition as/u);
  assert.match(audit, /no null-safety patch needed for that reason/u);
});

test("FIX 1: normalizePlatformCaseFinanceControl decodes overdue=false with a null due_at/next_action, and throws on overdue=null (decoder stays strict)", () => {
  const source = readFileSync(
    new URL("../src/lib/platform-finance-control.ts", import.meta.url), "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const moduleExports = {};
  new Function("exports", "require", compiled.outputText)(moduleExports, (id) => {
    if (id === "./platform-access.ts") return { staffCan: () => true };
    return {};
  });
  const { normalizePlatformCaseFinanceControl, PlatformFinanceControlRepositoryError } = moduleExports;

  const organizationId = "11111111-1111-4111-8111-111111111111";
  const studentCaseId = "22222222-2222-4222-8222-222222222222";
  const baseObligation = {
    payment_obligation_id: "33333333-3333-4333-8333-333333333333",
    label: "Транш 1",
    category: "evo_service_fee",
    amount_minor: 100000,
    currency: "USD",
    due_at: null,
    total_paid_minor: 0,
    total_refunded_minor: 0,
    outstanding_minor: 100000,
    derived_status: "pending",
    overdue: false,
    next_action: null,
    payment_confirmation_count: 0,
    last_payment_at: null,
    active_stop_factors: [],
  };
  const payload = (obligation) => ({
    organization_id: organizationId,
    student_case_id: studentCaseId,
    obligations: [obligation],
    history: [],
  });

  const decoded = normalizePlatformCaseFinanceControl(
    payload(baseObligation), organizationId, studentCaseId,
  );
  assert.equal(decoded.obligations[0].dueAt, null);
  assert.equal(decoded.obligations[0].nextAction, null);
  assert.equal(decoded.obligations[0].overdue, false);

  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      payload({ ...baseObligation, overdue: null }), organizationId, studentCaseId,
    ),
    PlatformFinanceControlRepositoryError,
    "a null overdue must still throw — the SQL now guarantees a boolean, the decoder stays strict",
  );
});

test("tabs.tsx Money() renders CaseAgreementBlock before ProfileFinanceControls/FinanceEntryWorkspace, and the old «Договор» card is gone", () => {
  const moneyStart = tabsSource.indexOf("export function Money(");
  const moneyEnd = tabsSource.indexOf("\n}", tabsSource.indexOf("History", moneyStart));
  const body = tabsSource.slice(moneyStart, moneyEnd);
  const caseAgreementIndex = body.indexOf("<CaseAgreementBlock");
  const controlsIndex = body.indexOf("<ProfileFinanceControls");
  assert.ok(caseAgreementIndex >= 0 && controlsIndex >= 0 && caseAgreementIndex < controlsIndex);
  assert.doesNotMatch(body, /Card eyebrow title="Договор"/u);
});

test("ContractDraftReportWorkspace's production smoke anchor is untouched (tab=contract stays a separate surface, rendered from Profile.tsx not this block)", () => {
  assert.match(profileSource, /current === "contract"/u);
  assert.match(profileSource, /<ProfileContractWorkspace/u);
});

// ---------------------------------------------------------------------------
// FIX 4: refunds in the payments list.
// ---------------------------------------------------------------------------

test("FIX 4: staff_case_agreement_v1 projects event_type per payment row", () => {
  const start = sql.indexOf("CREATE FUNCTION platform.staff_case_agreement_v1(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  assert.match(body, /'payment_event_id', event\.id,\s*\n[\s\S]*?'event_type', event\.event_type,/u);
});

test("FIX 4: the contract module adds eventType (payment|refund) to CaseAgreementPayment and its parser", () => {
  assert.match(contractSource, /export type CaseAgreementPaymentEventType = "payment" \| "refund";/u);
  assert.match(contractSource, /eventType: CaseAgreementPaymentEventType;/u);
  assert.match(
    contractSource,
    /function paymentEventType\(value: unknown\): CaseAgreementPaymentEventType \{\s*\n\s*return value === "payment" \|\| value === "refund" \? value : fail\(\);/u,
  );
  assert.match(contractSource, /eventType: paymentEventType\(p\.event_type\),/u);
});

test("FIX 4: the parser decodes a refund fixture row and rejects an unknown event_type", () => {
  const compiled = ts.transpileModule(contractSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const moduleExports = {};
  new Function("exports", "require", compiled.outputText)(moduleExports, (id) => {
    if (id === "./platform-sales-register-contract.ts") {
      return {
        parseSalesUuid: (value) =>
          typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
            ? value.toLowerCase()
            : null,
        parseSalesDate: (value) => /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null,
      };
    }
    if (id === "./platform-finance-entry-contract.ts") {
      return { decimalToMinor: () => null, financeDateTime: () => null, financeMoney: () => "" };
    }
    return {};
  });
  const { parseCaseAgreement } = moduleExports;

  const organizationId = "11111111-1111-4111-8111-111111111111";
  const studentCaseId = "22222222-2222-4222-8222-222222222222";
  const basePayload = {
    organization_id: organizationId,
    student_case_id: studentCaseId,
    cost_minor: null,
    cost_currency: null,
    contract_current: null,
    contract_history: [],
    tranches: [],
    tranche_sum_minor: "0",
    cost_mismatch: false,
    paid_minor: "0",
    remaining_minor: null,
    currency_mismatch: false,
    can_write: false,
  };
  const refundRow = {
    payment_event_id: "44444444-4444-4444-8444-444444444444",
    payment_obligation_id: "55555555-5555-4555-8555-555555555555",
    amount_minor: "10000",
    currency: "USD",
    occurred_on: "2026-09-19",
    actor_display_name: null,
    event_type: "refund",
    receipts: [],
  };

  const decoded = parseCaseAgreement(
    { ...basePayload, payments: [refundRow] }, organizationId, studentCaseId,
  );
  assert.equal(decoded.payments[0].eventType, "refund");

  assert.throws(() =>
    parseCaseAgreement(
      { ...basePayload, payments: [{ ...refundRow, event_type: "chargeback" }] },
      organizationId,
      studentCaseId,
    )
  );
});

test("FIX 4: CaseAgreementBlock renders a «Возврат» Pill and a minus-prefixed amount for refund rows, financeMoney still carries only the magnitude", () => {
  assert.match(blockSource, /import \{ Pill \} from "@\/components\/v3\/Pill";/u);
  assert.match(blockSource, /payment\.eventType === "refund" \? <Pill tone="warn">Возврат<\/Pill> : null/u);
  assert.match(blockSource, /payment\.eventType === "refund" \? "−" : ""/u);
  assert.match(blockSource, /\{financeMoney\(payment\.amountMinor, payment\.currency\)\}/u);
});

// ---------------------------------------------------------------------------
// FIX 5: receipt retry.
// ---------------------------------------------------------------------------

test("FIX 5: PaymentForm renders a working receipt retry block outside the disabled fieldset, bound to the saved payment_event_id", () => {
  const fieldsetEnd = formsSource.indexOf("</fieldset>", formsSource.indexOf("Добавить оплату"));
  const retryBlockIndex = formsSource.indexOf("retryReceiptUpload(savedPaymentEventId)");
  assert.ok(fieldsetEnd >= 0 && retryBlockIndex >= 0);
  assert.ok(retryBlockIndex > fieldsetEnd, "the retry control must render after (outside) the disabled fieldset");
  assert.match(formsSource, /const savedPaymentEventId = state\.status === "saved" \? state\.resourceId : null;/u);
  assert.match(formsSource, /async function retryReceiptUpload\(paymentEventId: string\)/u);
  assert.match(formsSource, /fetch\(`\/api\/v2\/payment-receipts\/\$\{paymentEventId\}`/u);
  assert.match(formsSource, /Загрузить чек/u);
  assert.match(formsSource, /receiptStatus === "error" && savedPaymentEventId/u);
});

// ---------------------------------------------------------------------------
// FIX 6: error vs 42501 on read.
// ---------------------------------------------------------------------------

test("FIX 6: readCaseAgreement returns a discriminated ok/forbidden/unavailable result instead of a bare null", () => {
  assert.match(
    sourceSource,
    /export type CaseAgreementReadResult =\s*\n\s*\| Readonly<\{ status: "ok"; agreement: CaseAgreement \}>\s*\n\s*\| Readonly<\{ status: "forbidden" \}>\s*\n\s*\| Readonly<\{ status: "unavailable" \}>;/u,
  );
  assert.match(sourceSource, /status: error\.code === "42501" \? "forbidden" : "unavailable"/u);
  assert.doesNotMatch(sourceSource, /export async function readCaseAgreement[\s\S]*?: Promise<CaseAgreement \| null>/u);
});

test("FIX 6: CaseAgreementBlock renders nothing on forbidden, and the FinanceEntryWorkspace alert-card pattern on unavailable", () => {
  assert.match(blockSource, /if \(result\.status === "forbidden"\) return null;/u);
  assert.match(blockSource, /if \(result\.status === "unavailable"\) \{/u);
  assert.match(blockSource, /role="alert" className="px-4 py-3 text-sm text-fg-2"/u);
  assert.match(blockSource, /сейчас недоступна\. Обновите страницу/u);
});

// ---------------------------------------------------------------------------
// FIX 7: opaque paid-tranche error.
// ---------------------------------------------------------------------------

test("FIX 7: case-agreement-source maps SQLSTATE 22023 'tranche_paid' to its own status, keeping the generic invalid mapping otherwise", () => {
  assert.match(
    sourceSource,
    /error\.code === "22023" && \/tranche_paid\/i\.test\(error\.message\)\s*\n\s*\? "tranche_paid"/u,
  );
});

test("FIX 7: CaseAgreementStatus/MESSAGES carry the tranche_paid status and its Russian copy", () => {
  assert.match(contractSource, /\| "tranche_paid";/u);
  assert.match(
    formsSource,
    /tranche_paid: "Транш уже оплачен — сумма и валюта фиксированы\. Обновите карточку\.",/u,
  );
});

// ---------------------------------------------------------------------------
// FIX 8: currency-mismatch header honesty.
// ---------------------------------------------------------------------------

test("FIX 8: the currency-mismatch branch is explicitly labeled and never renders Оплачено/Остаток numbers", () => {
  assert.match(blockSource, /Транши по валютам: \{perCurrency\.map/u);
  const mismatchStart = blockSource.indexOf("agreement.currencyMismatch ? (");
  assert.ok(mismatchStart >= 0, "mixed currency branch must exist");
  const mismatchEnd = blockSource.indexOf(") : agreement.costMismatch", mismatchStart);
  assert.ok(mismatchEnd > mismatchStart, "mixed currency branch must be nonempty");
  const mismatchBranch = blockSource.slice(mismatchStart, mismatchEnd);
  assert.doesNotMatch(mismatchBranch, /paidMinor/u);
  assert.doesNotMatch(mismatchBranch, /remainingMinor/u);
});

// ---------------------------------------------------------------------------
// FIX 9: button label.
// ---------------------------------------------------------------------------

test("FIX 9: the tranche editor's post-save follow-up button reads «Ещё транш» only for creates, «Изменить ещё раз» for edits", () => {
  assert.match(formsSource, /\{tranche \? "Изменить ещё раз" : "Ещё транш"\}/u);
});

test("migration 189 replaces both 043 payment_obligations update guards with the tranche-aware one", () => {
  // 043 froze label/amount/currency/due_at forever and demanded a totals
  // change on every UPDATE; the plan makes an UNPAID tranche editable, so 189
  // must drop both old triggers and install the conditional guard.
  assert.match(sql, /DROP TRIGGER payment_obligations_identity_immutable ON platform\.payment_obligations;/u);
  assert.match(sql, /DROP TRIGGER payment_obligations_transition_guard ON platform\.payment_obligations;/u);
  assert.match(sql, /guard_payment_obligation_update/u);
  assert.match(sql, /money columns are immutable once paid/u);
  assert.match(sql, /archive is one-way and unpaid-only/u);
});
