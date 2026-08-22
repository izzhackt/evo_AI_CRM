import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_STOP_FACTOR_CREATE_FIELDS,
  PLATFORM_STOP_FACTOR_RESOLVE_FIELDS,
  decidePlatformStopFactorCreate,
  decidePlatformStopFactorResolve,
  hasExactPlatformStopFactorFormKeys,
} from "../src/lib/platform-stop-factor-forms.ts";
import {
  PlatformStopFactorRepositoryError,
  listPlatformStopFactorObligations,
  listPlatformStopFactorOwners,
  listPlatformStopFactorPaymentEvents,
  listPlatformStopFactors,
  normalizePlatformStopFactor,
  normalizePlatformStopFactorObligation,
  normalizePlatformStopFactorOwnerOptions,
  normalizePlatformStopFactorPaymentEvent,
} from "../src/lib/platform-stop-factors.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const CASE = "22222222-2222-4222-8222-222222222222";
const OBLIGATION = "33333333-3333-4333-8333-333333333333";
const STOP = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";
const PROFILE = "66666666-6666-4666-8666-666666666666";
const EVENT = "77777777-7777-4777-8777-777777777777";
const REQUEST = "88888888-8888-4888-8888-888888888888";
const AT = "2026-08-13T01:00:00+00:00";

function activeRow(overrides = {}) {
  return {
    id: STOP,
    organization_id: ORG,
    student_case_id: CASE,
    payment_obligation_id: OBLIGATION,
    status: "active",
    reason: "Service fee unpaid",
    owner_membership_id: OWNER,
    blocked_action: "University application submission",
    next_action: "Confirm the service fee payment",
    created_at: AT,
    resolution_kind: null,
    resolution_reason: null,
    resolved_at: null,
    ...overrides,
  };
}

function resolvedRow(overrides = {}) {
  return activeRow({
    status: "resolved",
    resolution_kind: "payment_event",
    resolution_reason: "Payment confirmed",
    resolved_at: AT,
    ...overrides,
  });
}

function obligationRow(overrides = {}) {
  return {
    id: OBLIGATION,
    organization_id: ORG,
    student_case_id: CASE,
    label: "Service fee",
    category: "evo_service_fee",
    amount_minor: 100000,
    currency: "KGS",
    due_at: AT,
    total_paid_minor: 25000,
    total_refunded_minor: 0,
    ...overrides,
  };
}

function paymentRow(overrides = {}) {
  return {
    id: EVENT,
    organization_id: ORG,
    student_case_id: CASE,
    payment_obligation_id: OBLIGATION,
    event_type: "payment",
    amount_minor: 25000,
    currency: "KGS",
    occurred_at: AT,
    ...overrides,
  };
}

function createFields(overrides = {}) {
  return {
    payment_obligation_id: OBLIGATION,
    owner_membership_id: OWNER,
    reason: "Service fee unpaid",
    blocked_action: "University application submission",
    next_action: "Confirm the service fee payment",
    evidence_ref: "invoice-2026-08-13",
    request_id: REQUEST,
    ...overrides,
  };
}

function resolveFields(overrides = {}) {
  return {
    stop_factor_id: STOP,
    resolution_kind: "payment_event",
    payment_event_id: EVENT,
    reason: "Payment confirmed",
    evidence_ref: "",
    request_id: REQUEST,
    ...overrides,
  };
}

function actor(platformRole = "finance") {
  return {
    authUserId: PROFILE,
    profileId: PROFILE,
    membershipId: OWNER,
    organizationId: ORG,
    displayName: "Finance",
    platformRole,
    platformAccessVersion: 1,
    role: platformRole,
  };
}

function stubClient(handlers) {
  return {
    schema(name) {
      assert.equal(name, "platform");
      return {
        from(table) {
          const handler = handlers[table];
          assert.ok(handler, `unexpected table ${table}`);
          return handler();
        },
      };
    },
  };
}

function selectStub(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return () => builder;
}

test("normalizePlatformStopFactor accepts an active row", () => {
  const row = normalizePlatformStopFactor(activeRow(), ORG);
  assert.equal(row.stopFactorId, STOP);
  assert.equal(row.status, "active");
  assert.equal(row.resolutionKind, null);
  assert.equal(row.blockedAction, "University application submission");
});

test("normalizePlatformStopFactor accepts a resolved row", () => {
  const row = normalizePlatformStopFactor(resolvedRow(), ORG);
  assert.equal(row.status, "resolved");
  assert.equal(row.resolutionKind, "payment_event");
  assert.equal(row.resolvedAt, AT);
});

test("normalizePlatformStopFactor rejects a row from another organization", () => {
  assert.throws(
    () => normalizePlatformStopFactor(activeRow({ organization_id: OTHER_ORG }), ORG),
    PlatformStopFactorRepositoryError,
  );
});

test("normalizePlatformStopFactor rejects a half-resolved row", () => {
  for (
    const overrides of [
      { status: "resolved", resolution_kind: "payment_event" },
      { status: "resolved", resolution_kind: null, resolved_at: AT },
      { resolution_kind: "admin_override" },
      { resolved_at: AT },
    ]
  ) {
    assert.throws(
      () => normalizePlatformStopFactor(activeRow(overrides), ORG),
      PlatformStopFactorRepositoryError,
    );
  }
});

test("normalizePlatformStopFactor rejects an unknown column set", () => {
  const extra = { ...activeRow(), unexpected: true };
  assert.throws(
    () => normalizePlatformStopFactor(extra, ORG),
    PlatformStopFactorRepositoryError,
  );
  const missing = activeRow();
  delete missing.reason;
  assert.throws(
    () => normalizePlatformStopFactor(missing, ORG),
    PlatformStopFactorRepositoryError,
  );
});

test("normalizePlatformStopFactorObligation derives the outstanding amount", () => {
  const row = normalizePlatformStopFactorObligation(obligationRow(), ORG);
  assert.equal(row.outstandingMinor, 75000);
  assert.equal(row.amountMinor, 100000);
});

test("normalizePlatformStopFactorObligation reports a settled obligation as zero", () => {
  const row = normalizePlatformStopFactorObligation(
    obligationRow({ total_paid_minor: 120000, total_refunded_minor: 0 }),
    ORG,
  );
  assert.equal(row.outstandingMinor, 0);
});

test("normalizePlatformStopFactorObligation rejects refunds beyond payments", () => {
  assert.throws(
    () =>
      normalizePlatformStopFactorObligation(
        obligationRow({ total_paid_minor: 1000, total_refunded_minor: 2000 }),
        ORG,
      ),
    PlatformStopFactorRepositoryError,
  );
});

test("normalizePlatformStopFactorObligation accepts bigint amounts sent as text", () => {
  const row = normalizePlatformStopFactorObligation(
    obligationRow({ amount_minor: "100000", total_paid_minor: "25000" }),
    ORG,
  );
  assert.equal(row.outstandingMinor, 75000);
});

test("normalizePlatformStopFactorPaymentEvent refuses a non-payment event", () => {
  assert.throws(
    () => normalizePlatformStopFactorPaymentEvent(paymentRow({ event_type: "refund" }), ORG),
    PlatformStopFactorRepositoryError,
  );
});

test("normalizePlatformStopFactorPaymentEvent accepts a confirmed payment", () => {
  const row = normalizePlatformStopFactorPaymentEvent(paymentRow(), ORG);
  assert.equal(row.paymentEventId, EVENT);
  assert.equal(row.paymentObligationId, OBLIGATION);
});

test("normalizePlatformStopFactorOwnerOptions joins memberships to profiles", () => {
  const options = normalizePlatformStopFactorOwnerOptions(
    [
      {
        id: OWNER,
        organization_id: ORG,
        profile_id: PROFILE,
        status: "active",
        current_role: "finance",
      },
    ],
    [{ id: PROFILE, display_name: "Aida", status: "active" }],
    ORG,
  );
  assert.deepEqual(options, [{ membershipId: OWNER, displayName: "Aida" }]);
});

test("normalizePlatformStopFactorOwnerOptions drops a membership without a profile", () => {
  const options = normalizePlatformStopFactorOwnerOptions(
    [
      {
        id: OWNER,
        organization_id: ORG,
        profile_id: PROFILE,
        status: "active",
        current_role: "admin",
      },
    ],
    [],
    ORG,
  );
  assert.deepEqual(options, []);
});

test("normalizePlatformStopFactorOwnerOptions rejects a role that cannot own a block", () => {
  assert.throws(
    () =>
      normalizePlatformStopFactorOwnerOptions(
        [
          {
            id: OWNER,
            organization_id: ORG,
            profile_id: PROFILE,
            status: "active",
            current_role: "curator",
          },
        ],
        [{ id: PROFILE, display_name: "Aida", status: "active" }],
        ORG,
      ),
    PlatformStopFactorRepositoryError,
  );
});

test("stop factor reads refuse a role the finance policy does not admit", async () => {
  for (const role of ["sales", "curator", "student"]) {
    await assert.rejects(
      () => listPlatformStopFactors(actor(role)),
      PlatformStopFactorRepositoryError,
    );
    await assert.rejects(
      () => listPlatformStopFactorObligations(actor(role)),
      PlatformStopFactorRepositoryError,
    );
    await assert.rejects(
      () => listPlatformStopFactorPaymentEvents(actor(role)),
      PlatformStopFactorRepositoryError,
    );
    await assert.rejects(
      () => listPlatformStopFactorOwners(actor(role)),
      PlatformStopFactorRepositoryError,
    );
  }
});

test("listPlatformStopFactors returns normalized rows for an admitted role", async () => {
  const client = stubClient({
    stop_factors: selectStub({ data: [activeRow()], error: null }),
  });
  for (const role of ["admin", "finance"]) {
    const rows = await listPlatformStopFactors(actor(role), { client });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stopFactorId, STOP);
  }
});

test("listPlatformStopFactors fails closed on a duplicate id", async () => {
  const client = stubClient({
    stop_factors: selectStub({ data: [activeRow(), activeRow()], error: null }),
  });
  await assert.rejects(
    () => listPlatformStopFactors(actor("admin"), { client }),
    PlatformStopFactorRepositoryError,
  );
});

test("listPlatformStopFactors fails closed on a transport error", async () => {
  const client = stubClient({
    stop_factors: selectStub({ data: null, error: { message: "denied" } }),
  });
  await assert.rejects(
    () => listPlatformStopFactors(actor("admin"), { client }),
    PlatformStopFactorRepositoryError,
  );
});

test("listPlatformStopFactorPaymentEvents normalizes confirmed payments", async () => {
  const client = stubClient({
    payment_events: selectStub({ data: [paymentRow()], error: null }),
  });
  const rows = await listPlatformStopFactorPaymentEvents(actor("finance"), {
    client,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountMinor, 25000);
});

test("listPlatformStopFactorOwners returns an empty list when nobody is eligible", async () => {
  const client = stubClient({
    organization_memberships: selectStub({ data: [], error: null }),
  });
  const owners = await listPlatformStopFactorOwners(actor("admin"), { client });
  assert.deepEqual(owners, []);
});

test("decidePlatformStopFactorCreate accepts a complete form", () => {
  const input = decidePlatformStopFactorCreate(createFields());
  assert.ok(input);
  assert.equal(input.paymentObligationId, OBLIGATION);
  assert.equal(input.evidenceRef, "invoice-2026-08-13");
});

test("decidePlatformStopFactorCreate requires every field the RPC requires", () => {
  for (const key of PLATFORM_STOP_FACTOR_CREATE_FIELDS) {
    assert.equal(
      decidePlatformStopFactorCreate(createFields({ [key]: "" })),
      null,
      `missing ${key} must be rejected`,
    );
  }
});

test("decidePlatformStopFactorCreate rejects a reason under three characters", () => {
  assert.equal(decidePlatformStopFactorCreate(createFields({ reason: "ab" })), null);
});

test("decidePlatformStopFactorCreate rejects a control character", () => {
  assert.equal(
    decidePlatformStopFactorCreate(createFields({ blocked_action: "sub\u0007mit" })),
    null,
  );
});

test("decidePlatformStopFactorResolve accepts a payment resolution", () => {
  const input = decidePlatformStopFactorResolve(resolveFields(), "finance");
  assert.ok(input);
  assert.equal(input.resolutionKind, "payment_event");
  assert.equal(input.paymentEventId, EVENT);
  assert.equal(input.evidenceRef, null);
});

test("decidePlatformStopFactorResolve refuses a payment resolution carrying evidence", () => {
  assert.equal(
    decidePlatformStopFactorResolve(
      resolveFields({ evidence_ref: "note" }),
      "finance",
    ),
    null,
  );
});

test("decidePlatformStopFactorResolve refuses a payment resolution without an event", () => {
  assert.equal(
    decidePlatformStopFactorResolve(
      resolveFields({ payment_event_id: "" }),
      "finance",
    ),
    null,
  );
});

test("decidePlatformStopFactorResolve accepts an Admin override", () => {
  const input = decidePlatformStopFactorResolve(
    resolveFields({
      resolution_kind: "admin_override",
      payment_event_id: "",
      evidence_ref: "board-decision-12",
    }),
    "admin",
  );
  assert.ok(input);
  assert.equal(input.resolutionKind, "admin_override");
  assert.equal(input.paymentEventId, null);
  assert.equal(input.evidenceRef, "board-decision-12");
});

test("decidePlatformStopFactorResolve refuses an override from a non-Admin", () => {
  assert.equal(
    decidePlatformStopFactorResolve(
      resolveFields({
        resolution_kind: "admin_override",
        payment_event_id: "",
        evidence_ref: "board-decision-12",
      }),
      "finance",
    ),
    null,
  );
});

test("decidePlatformStopFactorResolve refuses an override carrying a payment", () => {
  assert.equal(
    decidePlatformStopFactorResolve(
      resolveFields({
        resolution_kind: "admin_override",
        evidence_ref: "board-decision-12",
      }),
      "admin",
    ),
    null,
  );
});

test("decidePlatformStopFactorResolve refuses an unknown resolution kind", () => {
  assert.equal(
    decidePlatformStopFactorResolve(
      resolveFields({ resolution_kind: "manager_override" }),
      "admin",
    ),
    null,
  );
});

test("hasExactPlatformStopFactorFormKeys pins both form contracts", () => {
  const create = new FormData();
  for (const key of PLATFORM_STOP_FACTOR_CREATE_FIELDS) create.append(key, "x");
  assert.equal(
    hasExactPlatformStopFactorFormKeys(create, PLATFORM_STOP_FACTOR_CREATE_FIELDS),
    true,
  );
  create.append("smuggled", "x");
  assert.equal(
    hasExactPlatformStopFactorFormKeys(create, PLATFORM_STOP_FACTOR_CREATE_FIELDS),
    false,
  );

  const resolve = new FormData();
  for (const key of PLATFORM_STOP_FACTOR_RESOLVE_FIELDS) resolve.append(key, "x");
  assert.equal(
    hasExactPlatformStopFactorFormKeys(resolve, PLATFORM_STOP_FACTOR_RESOLVE_FIELDS),
    true,
  );
  resolve.append("reason", "second");
  assert.equal(
    hasExactPlatformStopFactorFormKeys(resolve, PLATFORM_STOP_FACTOR_RESOLVE_FIELDS),
    false,
  );
});
