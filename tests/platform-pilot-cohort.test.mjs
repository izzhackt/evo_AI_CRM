import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformPilotCohortContractError,
  buildPlatformPilotConfigurationRpcArgs,
  buildPlatformPilotMembershipRpcArgs,
  configurePlatformPilotCohort,
  getPlatformPilotWriteBoundary,
  getPlatformStudentCasePilotCohort,
  normalizePlatformPilotConfigurationReceipt,
  normalizePlatformPilotMembershipReceipt,
  normalizePlatformPilotWriteBoundary,
  normalizePlatformStudentCasePilotCohort,
  parsePlatformPilotConfigurationForm,
  parsePlatformPilotMembershipForm,
  reconcilePlatformPilotMutation,
  setPlatformStudentCasePilotMembership,
} from "../src/lib/platform-pilot-cohort.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const FOREIGN_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000002";
const STUDENT_CASE_ID = "20000000-0000-4000-8000-000000000001";
const CONFIGURATION_ID = "30000000-0000-4000-8000-000000000001";
const EVENT_ID = "40000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const FOREIGN_REQUEST_ID = "50000000-0000-4000-8000-000000000002";
const MEMBERSHIP_ID = "60000000-0000-4000-8000-000000000001";
const CUTOFF_AT = "2026-08-27T00:00:00Z";
const CHANGED_AT = "2026-08-27T01:00:00Z";
const CONFIG_PROVENANCE = Object.freeze({
  source: "staff_configuration",
  request_id: REQUEST_ID,
  configuration_version: 2,
});
const AUTOMATIC_PROVENANCE = Object.freeze({
  source: "automatic_cutoff",
  configuration_version: 2,
});
const MANUAL_PROVENANCE = Object.freeze({
  source: "staff_manual_decision",
  reference: "approval=OPS-387",
});

const actor = Object.freeze({
  authUserId: "70000000-0000-4000-8000-000000000001",
  profileId: "80000000-0000-4000-8000-000000000001",
  membershipId: MEMBERSHIP_ID,
  organizationId: ORGANIZATION_ID,
  displayName: "Admissions Admin",
  platformRole: "admin",
  platformAccessVersion: 1,
  platformBundleId: "90000000-0000-4000-8000-000000000001",
  platformBundleVersion: 1,
  role: "admin",
});

function configuration(overrides = {}) {
  return {
    configuration_id: CONFIGURATION_ID,
    version: 2,
    state: "active",
    cutoff_at: CUTOFF_AT,
    reason: "Start the bounded net-new pilot",
    provenance: CONFIG_PROVENANCE,
    changed_by_membership_id: MEMBERSHIP_ID,
    changed_by_name: "Admissions Admin",
    changed_at: CHANGED_AT,
    ...overrides,
  };
}

function boundary(target = "evo_supabase", overrides = {}) {
  const legacy = target === "legacy_crm";
  return {
    requested_target: target,
    allowed: !legacy,
    reason_code: legacy ? "legacy_write_forbidden" : "canonical_write_allowed",
    authority: "evo_supabase_only",
    fallback_allowed: false,
    ...overrides,
  };
}

function history(overrides = {}) {
  return {
    event_id: EVENT_ID,
    action: "automatic_include",
    basis: "cutoff_rule",
    reason: "Eligible canonical case created after the cutoff",
    provenance: AUTOMATIC_PROVENANCE,
    changed_by_membership_id: MEMBERSHIP_ID,
    changed_by_name: "Admissions Admin",
    changed_at: CHANGED_AT,
    ...overrides,
  };
}

function cohortRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    membership_status: "included",
    membership_basis: "cutoff_rule",
    reason: "Eligible canonical case created after the cutoff",
    provenance: AUTOMATIC_PROVENANCE,
    changed_by_membership_id: MEMBERSHIP_ID,
    changed_by_name: "Admissions Admin",
    changed_at: CHANGED_AT,
    configuration: configuration(),
    counts: { outside: 3, included: 1, excluded: 1, total: 5 },
    history: [history()],
    write_boundary: boundary(),
    ...overrides,
  };
}

function outsideRow(overrides = {}) {
  return cohortRow({
    membership_status: "outside",
    membership_basis: null,
    reason: null,
    provenance: null,
    changed_by_membership_id: null,
    changed_by_name: null,
    changed_at: null,
    history: [],
    write_boundary: boundary("evo_supabase", {
      allowed: false,
      reason_code: "pilot_membership_required",
    }),
    ...overrides,
  });
}

function configurationReceipt(overrides = {}) {
  return {
    request_id: REQUEST_ID,
    organization_id: ORGANIZATION_ID,
    ...configuration(),
    replayed: false,
    ...overrides,
  };
}

function membershipReceipt(overrides = {}) {
  return {
    request_id: REQUEST_ID,
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    event_id: EVENT_ID,
    membership_status: "included",
    membership_basis: "manual_include",
    reason: "Approved bounded exception",
    provenance: MANUAL_PROVENANCE,
    changed_by_membership_id: MEMBERSHIP_ID,
    changed_by_name: "Admissions Admin",
    changed_at: CHANGED_AT,
    replayed: false,
    ...overrides,
  };
}

function clientWith(handler) {
  return {
    schema(name) {
      assert.equal(name, "platform");
      return { rpc: handler };
    },
  };
}

test("U10 normalizes the exact tenant-bound case, config, counts, history, and EVO boundary", () => {
  const normalized = normalizePlatformStudentCasePilotCohort(
    cohortRow(),
    ORGANIZATION_ID,
    STUDENT_CASE_ID,
    20,
  );

  assert.equal(normalized.membershipStatus, "included");
  assert.equal(normalized.membershipBasis, "cutoff_rule");
  assert.equal(normalized.configuration?.version, 2);
  assert.equal(normalized.counts.total, 5);
  assert.equal(normalized.history[0].action, "automatic_include");
  assert.deepEqual(normalized.writeBoundary, {
    requestedTarget: "evo_supabase",
    allowed: true,
    reasonCode: "canonical_write_allowed",
    authority: "evo_supabase_only",
    fallbackAllowed: false,
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.history), true);
});

test("U10 accepts a truthful outside state only when all membership evidence is null", () => {
  const normalized = normalizePlatformStudentCasePilotCohort(
    outsideRow(),
    ORGANIZATION_ID,
    STUDENT_CASE_ID,
  );
  assert.equal(normalized.membershipStatus, "outside");
  assert.equal(normalized.membershipBasis, null);
  assert.equal(normalized.writeBoundary.allowed, false);

  assert.throws(
    () => normalizePlatformStudentCasePilotCohort(
      outsideRow({ reason: "smuggled" }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformPilotCohortContractError,
  );
});

test("U10 fails closed on cross-tenant, extra-key, count, history, and boundary drift", () => {
  const cases = [
    [cohortRow({ organization_id: FOREIGN_ORGANIZATION_ID }), ORGANIZATION_ID],
    [{ ...cohortRow(), raw_payload: "secret" }, ORGANIZATION_ID],
    [cohortRow({ counts: { outside: 3, included: 1, excluded: 1, total: 99 } }), ORGANIZATION_ID],
    [cohortRow({ history: [history({ action: "manual_include", basis: "cutoff_rule" })] }), ORGANIZATION_ID],
    [cohortRow({ write_boundary: boundary("evo_supabase", { fallback_allowed: true }) }), ORGANIZATION_ID],
  ];
  for (const [row, expectedOrganizationId] of cases) {
    assert.throws(
      () => normalizePlatformStudentCasePilotCohort(
        row,
        expectedOrganizationId,
        STUDENT_CASE_ID,
      ),
      PlatformPilotCohortContractError,
    );
  }
});

test("U10 provenance is scalar, bounded, sourced, and secret-key free", () => {
  for (const invalidProvenance of [
    {},
    { reference: "missing source" },
    {
      source: "staff_manual_decision",
      ["api" + "_key"]: "invalid-provenance-field",
    },
    { source: "staff_manual_decision", nested: { not: "scalar" } },
    { source: " staff_manual_decision" },
  ]) {
    assert.throws(
      () => normalizePlatformStudentCasePilotCohort(
        cohortRow({ provenance: invalidProvenance }),
        ORGANIZATION_ID,
        STUDENT_CASE_ID,
      ),
      PlatformPilotCohortContractError,
    );
  }
});

test("U10 enforces bounded unique newest-first membership history", () => {
  const olderId = "40000000-0000-4000-8000-000000000002";
  const valid = cohortRow({
    history: [
      history(),
      history({ event_id: olderId, changed_at: "2026-08-27T00:30:00Z" }),
    ],
  });
  assert.equal(
    normalizePlatformStudentCasePilotCohort(valid, ORGANIZATION_ID, STUDENT_CASE_ID, 2).history.length,
    2,
  );
  assert.throws(
    () => normalizePlatformStudentCasePilotCohort(
      cohortRow({ history: [history(), history()] }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
      2,
    ),
    PlatformPilotCohortContractError,
  );
  assert.throws(
    () => normalizePlatformStudentCasePilotCohort(valid, ORGANIZATION_ID, STUDENT_CASE_ID, 1),
    PlatformPilotCohortContractError,
  );
});

test("U10 validates canonical and legacy write-boundary truth without fallback", () => {
  assert.equal(normalizePlatformPilotWriteBoundary(boundary(), "evo_supabase").allowed, true);
  const legacy = normalizePlatformPilotWriteBoundary(
    boundary("legacy_crm"),
    "legacy_crm",
  );
  assert.equal(legacy.allowed, false);
  assert.equal(legacy.reasonCode, "legacy_write_forbidden");
  assert.equal(legacy.fallbackAllowed, false);

  assert.throws(
    () => normalizePlatformPilotWriteBoundary(
      boundary("legacy_crm", { allowed: true }),
      "legacy_crm",
    ),
    PlatformPilotCohortContractError,
  );
});

test("U10 case repository uses one exact bounded GET RPC row", async () => {
  const calls = [];
  const value = await getPlatformStudentCasePilotCohort(
    actor,
    STUDENT_CASE_ID,
    20,
    {
      client: clientWith(async (name, args, options) => {
        calls.push({ name, args, options });
        return { data: [cohortRow()], error: null };
      }),
    },
  );
  assert.equal(value.studentCaseId, STUDENT_CASE_ID);
  assert.deepEqual(calls, [{
    name: "staff_student_case_pilot_cohort",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_student_case_id: STUDENT_CASE_ID,
      p_history_limit: 20,
    },
    options: { get: true },
  }]);
});

test("U10 read repository rejects missing or duplicate result rows", async () => {
  for (const data of [[], [cohortRow(), cohortRow()]]) {
    await assert.rejects(
      getPlatformStudentCasePilotCohort(actor, STUDENT_CASE_ID, 20, {
        client: clientWith(async () => ({ data, error: null })),
      }),
      PlatformPilotCohortContractError,
    );
  }
});

test("U10 legacy evaluator calls only the exact read-safe boundary RPC", async () => {
  const calls = [];
  const value = await getPlatformPilotWriteBoundary(
    actor,
    STUDENT_CASE_ID,
    "legacy_crm",
    {
      client: clientWith(async (name, args, options) => {
        calls.push({ name, args, options });
        return { data: [boundary("legacy_crm")], error: null };
      }),
    },
  );
  assert.equal(value.reasonCode, "legacy_write_forbidden");
  assert.deepEqual(calls, [{
    name: "staff_pilot_write_boundary",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_student_case_id: STUDENT_CASE_ID,
      p_target: "legacy_crm",
    },
    options: { get: true },
  }]);
});

test("U10 builds exact admin configuration and membership RPC arguments", () => {
  assert.deepEqual(buildPlatformPilotConfigurationRpcArgs(actor, {
    studentCaseId: STUDENT_CASE_ID,
    cutoffAt: CUTOFF_AT,
    state: "active",
    reason: "Start the bounded net-new pilot",
    requestId: REQUEST_ID,
  }), {
    p_organization_id: ORGANIZATION_ID,
    p_cutoff_at: CUTOFF_AT,
    p_state: "active",
    p_reason: "Start the bounded net-new pilot",
    p_request_id: REQUEST_ID,
  });
  assert.deepEqual(buildPlatformPilotMembershipRpcArgs(actor, {
    studentCaseId: STUDENT_CASE_ID,
    action: "include",
    reason: "Approved bounded exception",
    provenance: MANUAL_PROVENANCE,
    requestId: REQUEST_ID,
  }), {
    p_organization_id: ORGANIZATION_ID,
    p_student_case_id: STUDENT_CASE_ID,
    p_membership_action: "include",
    p_reason: "Approved bounded exception",
    p_provenance: MANUAL_PROVENANCE,
    p_request_id: REQUEST_ID,
  });
});

test("U10 mutation receipts are exact, tenant-bound, actor-bound, and replay-aware", () => {
  const config = normalizePlatformPilotConfigurationReceipt(
    configurationReceipt({ cutoff_at: "2026-08-27T00:00:00+00:00", replayed: true }),
    {
      actor,
      requestId: REQUEST_ID,
      cutoffAt: CUTOFF_AT,
      state: "active",
      reason: "Start the bounded net-new pilot",
    },
  );
  assert.equal(config.requestId, REQUEST_ID);
  assert.equal(config.replayed, true);
  const membership = normalizePlatformPilotMembershipReceipt(
    membershipReceipt({ replayed: true }),
    {
      actor,
      requestId: REQUEST_ID,
      studentCaseId: STUDENT_CASE_ID,
      action: "include",
      reason: "Approved bounded exception",
      provenance: MANUAL_PROVENANCE,
    },
  );
  assert.equal(membership.requestId, REQUEST_ID);
  assert.equal(membership.replayed, true);

  const withoutRequestId = (receipt) => {
    const rest = { ...receipt };
    delete rest.request_id;
    return rest;
  };
  const configurationExpected = {
    actor,
    requestId: REQUEST_ID,
    cutoffAt: CUTOFF_AT,
    state: "active",
    reason: "Start the bounded net-new pilot",
  };
  const membershipExpected = {
    actor,
    requestId: REQUEST_ID,
    studentCaseId: STUDENT_CASE_ID,
    action: "include",
    reason: "Approved bounded exception",
    provenance: MANUAL_PROVENANCE,
  };
  for (const invalidReceipt of [
    withoutRequestId(configurationReceipt()),
    configurationReceipt({ request_id: FOREIGN_REQUEST_ID }),
  ]) {
    assert.throws(
      () => normalizePlatformPilotConfigurationReceipt(
        invalidReceipt,
        configurationExpected,
      ),
      PlatformPilotCohortContractError,
    );
  }
  for (const invalidReceipt of [
    withoutRequestId(membershipReceipt()),
    membershipReceipt({ request_id: FOREIGN_REQUEST_ID }),
    membershipReceipt({ organization_id: FOREIGN_ORGANIZATION_ID }),
  ]) {
    assert.throws(
      () => normalizePlatformPilotMembershipReceipt(
        invalidReceipt,
        membershipExpected,
      ),
      PlatformPilotCohortContractError,
    );
  }
});

test("U10 configuration repository accepts only the exact immutable receipt", async () => {
  const calls = [];
  const input = {
    studentCaseId: STUDENT_CASE_ID,
    cutoffAt: CUTOFF_AT,
    state: "active",
    reason: "Start the bounded net-new pilot",
    requestId: REQUEST_ID,
  };
  const receipt = await configurePlatformPilotCohort(actor, input, {
    client: clientWith(async (name, args, options) => {
      calls.push({ name, args, options });
      return { data: configurationReceipt(), error: null };
    }),
  });
  assert.equal(receipt.configurationId, CONFIGURATION_ID);
  assert.equal(receipt.requestId, REQUEST_ID);
  assert.equal(receipt.replayed, false);
  assert.deepEqual(calls, [{
    name: "configure_pilot_cohort",
    args: buildPlatformPilotConfigurationRpcArgs(actor, input),
    options: undefined,
  }]);
});

test("U10 membership repository accepts only the exact request-bound receipt", async () => {
  const calls = [];
  const input = {
    studentCaseId: STUDENT_CASE_ID,
    action: "include",
    reason: "Approved bounded exception",
    provenance: MANUAL_PROVENANCE,
    requestId: REQUEST_ID,
  };
  const receipt = await setPlatformStudentCasePilotMembership(actor, input, {
    client: clientWith(async (name, args, options) => {
      calls.push({ name, args, options });
      return { data: membershipReceipt(), error: null };
    }),
  });
  assert.equal(receipt.membershipStatus, "included");
  assert.equal(receipt.requestId, REQUEST_ID);
  assert.deepEqual(calls, [{
    name: "set_student_case_pilot_membership",
    args: buildPlatformPilotMembershipRpcArgs(actor, input),
    options: undefined,
  }]);
});

test("U10 mutation helpers deny non-admin callers before any RPC", async () => {
  let called = false;
  const salesActor = { ...actor, platformRole: "sales", role: "manager" };
  await assert.rejects(
    setPlatformStudentCasePilotMembership(salesActor, {
      studentCaseId: STUDENT_CASE_ID,
      action: "include",
      reason: "Approved bounded exception",
      provenance: MANUAL_PROVENANCE,
      requestId: REQUEST_ID,
    }, {
      client: clientWith(async () => {
        called = true;
        return { data: membershipReceipt(), error: null };
      }),
    }),
    PlatformPilotCohortContractError,
  );
  assert.equal(called, false);
});

test("U10 response-loss reconciliation retries the exact invocation once", async () => {
  let attempts = 0;
  const value = await reconcilePlatformPilotMutation(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("response lost after commit");
    return membershipReceipt({ replayed: true });
  });
  assert.equal(attempts, 2);
  assert.equal(value?.request_id, REQUEST_ID);
  assert.equal(value?.replayed, true);

  let failedAttempts = 0;
  const unavailable = await reconcilePlatformPilotMutation(async () => {
    failedAttempts += 1;
    throw new Error("unavailable");
  });
  assert.equal(failedAttempts, 2);
  assert.equal(unavailable, null);
});

test("U10 parses only exact bounded configuration forms", () => {
  const form = new FormData();
  form.set("student_case_id", STUDENT_CASE_ID);
  form.set("cutoff_at", CUTOFF_AT);
  form.set("state", "active");
  form.set("reason", " Start the bounded net-new pilot ");
  form.set("request_id", REQUEST_ID);
  assert.deepEqual(parsePlatformPilotConfigurationForm(form), {
    studentCaseId: STUDENT_CASE_ID,
    cutoffAt: CUTOFF_AT,
    state: "active",
    reason: "Start the bounded net-new pilot",
    requestId: REQUEST_ID,
  });

  form.set("legacy_write", "true");
  assert.equal(parsePlatformPilotConfigurationForm(form), null);
});

test("U10 parses only exact bounded include/exclude forms", () => {
  const form = new FormData();
  form.set("student_case_id", STUDENT_CASE_ID);
  form.set("membership_action", "exclude");
  form.set("reason", "Remove this case from the bounded pilot");
  form.set("provenance", "approval=OPS-388");
  form.set("request_id", REQUEST_ID);
  assert.deepEqual(parsePlatformPilotMembershipForm(form), {
    studentCaseId: STUDENT_CASE_ID,
    action: "exclude",
    reason: "Remove this case from the bounded pilot",
    provenance: {
      source: "staff_manual_decision",
      reference: "approval=OPS-388",
    },
    requestId: REQUEST_ID,
  });

  form.set("membership_action", "copy_from_legacy");
  assert.equal(parsePlatformPilotMembershipForm(form), null);
  form.set("membership_action", "include");
  form.append("request_id", REQUEST_ID);
  assert.equal(parsePlatformPilotMembershipForm(form), null);
});

test("U10 TS/UI slice contains no provider, outbox, message-send, or legacy-write effect", () => {
  const paths = [
    "../src/lib/platform-pilot-cohort.ts",
  ];
  const source = paths.map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /\.from\s*\(/);
  assert.doesNotMatch(source, /WAHA|Gemini|Anthropic|sendMessage|outbox/i);
  assert.match(source, /staff_pilot_write_boundary/);
  assert.match(source, /legacy_write_forbidden/);
});
