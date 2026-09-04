import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformFinanceControlRepositoryError,
  getPlatformCaseFinanceControl,
  listPlatformFinanceControlQueue,
  normalizePlatformCaseFinanceControl,
  normalizePlatformFinanceControlQueueRow,
} from "../src/lib/platform-finance-control.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const FOREIGN_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000002";
const STUDENT_CASE_ID = "20000000-0000-4000-8000-000000000001";
const FOREIGN_STUDENT_CASE_ID = "20000000-0000-4000-8000-000000000002";
const OBLIGATION_ID = "30000000-0000-4000-8000-000000000001";
const STOP_FACTOR_ID = "40000000-0000-4000-8000-000000000001";
const AUDIT_EVENT_ID = "50000000-0000-4000-8000-000000000001";

const actor = Object.freeze({
  authUserId: "60000000-0000-4000-8000-000000000001",
  profileId: "70000000-0000-4000-8000-000000000001",
  membershipId: "80000000-0000-4000-8000-000000000001",
  organizationId: ORGANIZATION_ID,
  displayName: "Admissions Admin",
  platformRole: "admissions",
  platformAccessVersion: 1,
  platformBundleId: "90000000-0000-4000-8000-000000000001",
  platformBundleVersion: 1,
  role: "admin",
});

function validStopFactor(overrides = {}) {
  return {
    stop_factor_id: STOP_FACTOR_ID,
    version: "1",
    reason: "Первый взнос просрочен",
    blocked_action: "Подача заявления в университет",
    next_action: "Подтвердить оплату или согласовать исключение",
    owner_display_name: "Admissions Admin",
    created_at: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

function validObligation(overrides = {}) {
  return {
    payment_obligation_id: OBLIGATION_ID,
    label: "Первый взнос",
    category: "evo_service_fee",
    amount_minor: 10_000,
    currency: "USD",
    due_at: "2026-09-20T10:00:00Z",
    total_paid_minor: 4_000,
    total_refunded_minor: 1_000,
    outstanding_minor: 7_000,
    derived_status: "partially_paid",
    overdue: false,
    next_action: "Получить оставшуюся сумму",
    payment_confirmation_count: 1,
    last_payment_at: "2026-08-24T10:00:00Z",
    active_stop_factors: [validStopFactor()],
    ...overrides,
  };
}

function validHistory(overrides = {}) {
  return {
    audit_event_id: AUDIT_EVENT_ID,
    action: "finance.stop.create",
    resource_type: "stop_factor",
    resource_id: STOP_FACTOR_ID,
    actor_display_name: "Admissions Admin",
    reason: "Первый взнос просрочен",
    created_at: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

function validPayload(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    obligations: [validObligation()],
    history: [validHistory()],
    ...overrides,
  };
}

function validQueueRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    overdue_obligation_count: 1,
    outstanding_obligation_count: 1,
    active_stop_factor_count: 1,
    blocked_action: "Подача заявления в университет",
    stop_reason: "Первый взнос просрочен",
    stop_next_action: "Подтвердить оплату или согласовать исключение",
    ...overrides,
  };
}

test("U8 case finance control normalizes exact canonical payment and stop state", () => {
  const result = normalizePlatformCaseFinanceControl(
    validPayload(),
    ORGANIZATION_ID,
    STUDENT_CASE_ID,
    10,
  );

  assert.equal(result.organizationId, ORGANIZATION_ID);
  assert.equal(result.studentCaseId, STUDENT_CASE_ID);
  assert.equal(result.obligations[0].outstandingMinor, 7_000);
  assert.equal(result.obligations[0].activeStopFactors[0].blockedAction,
    "Подача заявления в университет");
  assert.equal(result.history[0].action, "finance.stop.create");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.obligations));
});

test("U8 case finance control rejects foreign tenants, extra keys, and inconsistent derived money", () => {
  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      validPayload({ organization_id: FOREIGN_ORGANIZATION_ID }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformFinanceControlRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      validPayload({ obligations: [validObligation({ unexpected: true })] }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformFinanceControlRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      validPayload({ obligations: [validObligation({ outstanding_minor: 6_999 })] }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformFinanceControlRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      validPayload({ obligations: [validObligation({
        derived_status: "overdue",
        overdue: false,
      })] }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformFinanceControlRepositoryError,
  );
});

test("U8 case finance control rejects duplicate obligations, stops, and history events", () => {
  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      validPayload({ obligations: [validObligation(), validObligation()] }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformFinanceControlRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      validPayload({ obligations: [validObligation({
        active_stop_factors: [validStopFactor(), validStopFactor()],
      })] }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformFinanceControlRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      validPayload({ history: [validHistory(), validHistory()] }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformFinanceControlRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseFinanceControl(
      validPayload({ history: [validHistory({ resource_type: "payment_event" })] }),
      ORGANIZATION_ID,
      STUDENT_CASE_ID,
    ),
    PlatformFinanceControlRepositoryError,
  );
});

test("U8 queue row requires tenant binding and an all-or-none stop interpretation", () => {
  const active = normalizePlatformFinanceControlQueueRow(
    validQueueRow(),
    ORGANIZATION_ID,
  );
  assert.equal(active.activeStopFactorCount, 1);
  assert.equal(active.stopReason, "Первый взнос просрочен");

  const clear = normalizePlatformFinanceControlQueueRow(
    validQueueRow({
      overdue_obligation_count: 0,
      outstanding_obligation_count: 0,
      active_stop_factor_count: 0,
      blocked_action: null,
      stop_reason: null,
      stop_next_action: null,
    }),
    ORGANIZATION_ID,
  );
  assert.equal(clear.blockedAction, null);

  for (const malformed of [
    validQueueRow({ organization_id: FOREIGN_ORGANIZATION_ID }),
    validQueueRow({ active_stop_factor_count: 0 }),
    validQueueRow({ stop_reason: null }),
    validQueueRow({ overdue_obligation_count: 2 }),
    { ...validQueueRow(), extra: "leak" },
  ]) {
    assert.throws(
      () => normalizePlatformFinanceControlQueueRow(malformed, ORGANIZATION_ID),
      PlatformFinanceControlRepositoryError,
    );
  }
});

test("U8 loaders call bounded read-only RPC contracts with actor organization checks", async () => {
  const calls = [];
  const client = {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        rpc(functionName, args, options) {
          calls.push({ functionName, args, options });
          if (functionName === "staff_case_finance_control") {
            return Promise.resolve({ data: validPayload(), error: null });
          }
          if (functionName === "staff_finance_control_queue") {
            return Promise.resolve({ data: [validQueueRow()], error: null });
          }
          throw new Error(`unexpected RPC ${functionName}`);
        },
      };
    },
  };

  const control = await getPlatformCaseFinanceControl(
    actor,
    STUDENT_CASE_ID,
    25,
    { client },
  );
  const queue = await listPlatformFinanceControlQueue(
    actor,
    { limit: 40, studentCaseIds: [STUDENT_CASE_ID] },
    { client },
  );
  const unscopedQueue = await listPlatformFinanceControlQueue(
    actor,
    {},
    { client },
  );
  assert.equal(control.studentCaseId, STUDENT_CASE_ID);
  assert.equal(queue.length, 1);
  assert.equal(unscopedQueue.length, 1);
  assert.deepEqual(calls, [
    {
      functionName: "staff_case_finance_control",
      args: { p_student_case_id: STUDENT_CASE_ID, p_history_limit: 25 },
      options: { get: true },
    },
    {
      functionName: "staff_finance_control_queue",
      args: {
        p_limit: 40,
        p_student_case_ids: [STUDENT_CASE_ID],
      },
      options: { get: true },
    },
    {
      functionName: "staff_finance_control_queue",
      args: { p_limit: 100 },
      options: { get: true },
    },
  ]);
});

test("U8 queue loader rejects duplicate cases, unbounded limits, and unauthorized roles", async () => {
  const duplicateClient = {
    schema() {
      return {
        rpc() {
          return Promise.resolve({
            data: [validQueueRow(), validQueueRow()],
            error: null,
          });
        },
      };
    },
  };
  await assert.rejects(
    listPlatformFinanceControlQueue(
      actor,
      { limit: 10, studentCaseIds: [STUDENT_CASE_ID] },
      { client: duplicateClient },
    ),
    PlatformFinanceControlRepositoryError,
  );
  await assert.rejects(
    listPlatformFinanceControlQueue(
      actor,
      { limit: 101, studentCaseIds: [STUDENT_CASE_ID] },
      { client: duplicateClient },
    ),
    PlatformFinanceControlRepositoryError,
  );
  await assert.rejects(
    listPlatformFinanceControlQueue(
      { ...actor, platformRole: "student" },
      { limit: 10, studentCaseIds: [STUDENT_CASE_ID] },
      { client: duplicateClient },
    ),
    PlatformFinanceControlRepositoryError,
  );
  await assert.rejects(
    listPlatformFinanceControlQueue(
      actor,
      { studentCaseIds: [STUDENT_CASE_ID, STUDENT_CASE_ID] },
      { client: duplicateClient },
    ),
    PlatformFinanceControlRepositoryError,
  );
  const outOfScopeClient = {
    schema() {
      return {
        rpc() {
          return Promise.resolve({
            data: [validQueueRow({ student_case_id: FOREIGN_STUDENT_CASE_ID })],
            error: null,
          });
        },
      };
    },
  };
  await assert.rejects(
    listPlatformFinanceControlQueue(
      actor,
      { studentCaseIds: [STUDENT_CASE_ID] },
      { client: outOfScopeClient },
    ),
    PlatformFinanceControlRepositoryError,
  );
});
