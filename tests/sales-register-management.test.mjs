import assert from "node:assert/strict";
import test from "node:test";
import { parseSalesRegisterManagement } from "../src/lib/sales-register-management.ts";

// Pure wire-contract inputs; these do not represent database/Auth acceptance.
const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const targetId = "33333333-3333-4333-8333-333333333333";
const month = "2026-09-01";
const envelope = (changes = {}) => ({
  schema_version: 1, organization_id: org, report_month: month,
  can_manage_target: true, can_import: false, target: null, ...changes,
});
const target = (changes = {}) => ({
  id: targetId, version: "1", report_month: month, manager_label: null, target_count: 0, ...changes,
});
const parse = raw => parseSalesRegisterManagement(raw, org, month);

test("denied management flags remain distinct from an authorized missing target", () => {
  assert.deepEqual(parse(envelope()), {
    reportMonth: month, canManageTarget: true, canImport: false, target: null,
  });
  assert.deepEqual(parse(envelope({ can_manage_target: false, can_import: true })), {
    reportMonth: month, canManageTarget: false, canImport: true, target: null,
  });
  assert.deepEqual(parse(envelope({ can_manage_target: false })), {
    reportMonth: month, canManageTarget: false, canImport: false, target: null,
  });
  assert.throws(() => parse(null), /unavailable/);
});

test("a real zero target and maximum safe version are preserved without empty-value coercion", () => {
  assert.deepEqual(parse(envelope({ target: target() })).target, {
    id: targetId, version: 1, reportMonth: month, managerLabel: null, targetCount: 0,
  });
  assert.deepEqual(parse(envelope({ target: target({ version: "9007199254740991", target_count: 1_000_000 }) })).target, {
    id: targetId, version: Number.MAX_SAFE_INTEGER, reportMonth: month, managerLabel: null, targetCount: 1_000_000,
  });
});

test("rights-only reads preserve independent flags and never carry an unrequested monthly target", () => {
  for (const canManageTarget of [true, false]) {
    for (const canImport of [true, false]) {
      assert.deepEqual(parseSalesRegisterManagement(envelope({
        report_month: null, can_manage_target: canManageTarget, can_import: canImport,
      }), org, null), { reportMonth: null, canManageTarget, canImport, target: null });
    }
  }
  assert.throws(() => parseSalesRegisterManagement(envelope({ report_month: null, target: target() }), org, null), /unavailable/);
  assert.throws(() => parseSalesRegisterManagement(envelope(), org, null), /unavailable/);
  assert.throws(() => parse(envelope({ report_month: null })), /unavailable/);
});

test("response identity must match a valid tenant and exact requested calendar month", () => {
  assert.throws(() => parse(envelope({ organization_id: otherOrg })), /unavailable/);
  assert.throws(() => parse(envelope({ report_month: "2026-10-01" })), /unavailable/);
  for (const badOrg of ["", "not-a-uuid", null, undefined]) {
    assert.throws(() => parseSalesRegisterManagement(envelope({ organization_id: badOrg }), badOrg, month), /unavailable/);
  }
  for (const badMonth of ["2026-09-02", "2026-13-01", "2026-9-01", "1899-12-01", "2101-01-01", "infinity", "null", "", undefined]) {
    assert.throws(() => parseSalesRegisterManagement(envelope({ report_month: badMonth }), org, badMonth), /unavailable/);
  }
  for (const boundary of ["1900-01-01", "2100-12-01"]) {
    assert.equal(parseSalesRegisterManagement(envelope({ report_month: boundary }), org, boundary).reportMonth, boundary);
  }
});

test("management response requires exactly the versioned schema with boolean capabilities", () => {
  for (const malformed of [[], {}, "ready", { ...envelope(), extra: true },
    envelope({ schema_version: "1" }), envelope({ schema_version: 2 }),
    ...[null, 0, 1, "false", "true", undefined].flatMap(value => [
      envelope({ can_manage_target: value }), envelope({ can_import: value }),
    ])]) assert.throws(() => parse(malformed), /unavailable/);
  for (const key of Object.keys(envelope())) {
    const missing = envelope();
    delete missing[key];
    assert.throws(() => parse(missing), /unavailable/);
  }
});

test("a withheld target cannot be relabeled as authorized by an inconsistent payload", () => {
  assert.throws(() => parse(envelope({ can_manage_target: false, target: target() })), /unavailable/);
  for (const malformedTarget of [undefined, false, 0, "", [], {}, { ...target(), extra: true }]) {
    assert.throws(() => parse(envelope({ target: malformedTarget })), /unavailable/);
  }
  for (const key of Object.keys(target())) {
    const missing = target();
    delete missing[key];
    assert.throws(() => parse(envelope({ target: missing })), /unavailable/);
  }
});

test("target versions remain exact positive BIGINT strings within JavaScript's safe range", () => {
  for (const version of [0, 1, null, true, "0", "-1", "01", "+1", " 1", "1 ", "1.0", "1e3", "9007199254740992", "99999999999999999", "1".repeat(1000)]) {
    assert.throws(() => parse(envelope({ target: target({ version }) })), /unavailable/);
  }
});

test("only a department target for this month with an integral bounded count is accepted", () => {
  for (const changed of [
    { id: "invalid" }, { id: null }, { report_month: "2026-10-01" }, { report_month: null },
    { manager_label: "" }, { manager_label: "Sales" },
    ...[-1, 1.5, 1_000_001, NaN, Infinity, "0", null, undefined].map(target_count => ({ target_count })),
  ]) assert.throws(() => parse(envelope({ target: target(changed) })), /unavailable/);
});
