import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformCaseBlockRepositoryError,
  listPlatformCaseBlocks,
  normalizePlatformCaseFinanceSummaryBlocks,
  normalizePlatformStopFactorBlock,
} from "../src/lib/platform-case-blocks.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const OTHER_CASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OBLIGATION = "33333333-3333-4333-8333-333333333333";
const OTHER_OBLIGATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BLOCKED = "University application submission";

function stopFactorRow(overrides = {}) {
  return {
    organization_id: ORG,
    student_case_id: CASE,
    payment_obligation_id: OBLIGATION,
    status: "active",
    blocked_action: BLOCKED,
    ...overrides,
  };
}

function summaryRow(overrides = {}) {
  return {
    case_id: CASE,
    payment_obligation_id: OBLIGATION,
    obligation_label: "Service fee",
    category: "evo_service_fee",
    amount_minor: 100000,
    currency: "KGS",
    due_at: "2026-08-13T01:00:00+00:00",
    derived_status: "pending",
    overdue: false,
    next_action: "Confirm the payment",
    has_active_stop_factor: true,
    blocked_action: BLOCKED,
    ...overrides,
  };
}

function actor(platformRole) {
  return {
    authUserId: ORG,
    profileId: ORG,
    membershipId: ORG,
    organizationId: ORG,
    displayName: "Staff",
    platformRole,
    platformAccessVersion: 1,
    role: platformRole,
  };
}

function tableClient(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => Promise.resolve(result),
  };
  return {
    schema: () => ({
      from: () => builder,
      rpc: () => {
        throw new Error("a finance-full role must not use the summary RPC");
      },
    }),
  };
}

function rpcClient(result) {
  return {
    schema: () => ({
      rpc: (name, args, options) => {
        assert.equal(name, "case_finance_summaries");
        assert.deepEqual(args, {});
        assert.deepEqual(options, { get: true });
        return Promise.resolve(result);
      },
      from: () => {
        throw new Error("a summary role must not read stop_factors directly");
      },
    }),
  };
}

test("normalizePlatformStopFactorBlock accepts an active block", () => {
  assert.deepEqual(normalizePlatformStopFactorBlock(stopFactorRow(), ORG, CASE), {
    paymentObligationId: OBLIGATION,
    blockedAction: BLOCKED,
  });
});

test("normalizePlatformStopFactorBlock rejects a resolved block", () => {
  assert.throws(
    () =>
      normalizePlatformStopFactorBlock(
        stopFactorRow({ status: "resolved" }),
        ORG,
        CASE,
      ),
    PlatformCaseBlockRepositoryError,
  );
});

test("normalizePlatformStopFactorBlock rejects another case", () => {
  assert.throws(
    () =>
      normalizePlatformStopFactorBlock(
        stopFactorRow({ student_case_id: OTHER_CASE }),
        ORG,
        CASE,
      ),
    PlatformCaseBlockRepositoryError,
  );
});

test("normalizePlatformCaseFinanceSummaryBlocks keeps only blocked obligations", () => {
  const blocks = normalizePlatformCaseFinanceSummaryBlocks(
    [
      summaryRow(),
      summaryRow({
        payment_obligation_id: OTHER_OBLIGATION,
        has_active_stop_factor: false,
        blocked_action: null,
      }),
    ],
    CASE,
  );
  assert.deepEqual(blocks, [
    { paymentObligationId: OBLIGATION, blockedAction: BLOCKED },
  ]);
});

test("normalizePlatformCaseFinanceSummaryBlocks ignores other cases", () => {
  const blocks = normalizePlatformCaseFinanceSummaryBlocks(
    [summaryRow({ case_id: OTHER_CASE })],
    CASE,
  );
  assert.deepEqual(blocks, []);
});

test("normalizePlatformCaseFinanceSummaryBlocks rejects a contradictory row", () => {
  assert.throws(
    () =>
      normalizePlatformCaseFinanceSummaryBlocks(
        [summaryRow({ has_active_stop_factor: false })],
        CASE,
      ),
    PlatformCaseBlockRepositoryError,
  );
  assert.throws(
    () =>
      normalizePlatformCaseFinanceSummaryBlocks(
        [summaryRow({ blocked_action: null })],
        CASE,
      ),
    PlatformCaseBlockRepositoryError,
  );
});

test("normalizePlatformCaseFinanceSummaryBlocks rejects a duplicate obligation", () => {
  assert.throws(
    () =>
      normalizePlatformCaseFinanceSummaryBlocks([summaryRow(), summaryRow()], CASE),
    PlatformCaseBlockRepositoryError,
  );
});

test("a finance-full role reads stop factors directly", async () => {
  for (const role of ["admin", "finance"]) {
    const blocks = await listPlatformCaseBlocks(actor(role), CASE, {
      client: tableClient({ data: [stopFactorRow()], error: null }),
    });
    assert.deepEqual(blocks, [
      { paymentObligationId: OBLIGATION, blockedAction: BLOCKED },
    ]);
  }
});

test("a case-scoped role reads the summary RPC instead", async () => {
  for (const role of ["sales", "curator"]) {
    const blocks = await listPlatformCaseBlocks(actor(role), CASE, {
      client: rpcClient({ data: [summaryRow()], error: null }),
    });
    assert.deepEqual(blocks, [
      { paymentObligationId: OBLIGATION, blockedAction: BLOCKED },
    ]);
  }
});

test("a role with no finance visibility fails closed", async () => {
  for (const role of ["student", "client"]) {
    await assert.rejects(
      () =>
        listPlatformCaseBlocks(actor(role), CASE, {
          client: rpcClient({ data: [], error: null }),
        }),
      PlatformCaseBlockRepositoryError,
    );
  }
});

test("a transport error fails closed rather than reporting no blocks", async () => {
  await assert.rejects(
    () =>
      listPlatformCaseBlocks(actor("admin"), CASE, {
        client: tableClient({ data: null, error: { message: "denied" } }),
      }),
    PlatformCaseBlockRepositoryError,
  );
  await assert.rejects(
    () =>
      listPlatformCaseBlocks(actor("curator"), CASE, {
        client: rpcClient({ data: null, error: { message: "denied" } }),
      }),
    PlatformCaseBlockRepositoryError,
  );
});

test("an unblocked case returns an empty list on both paths", async () => {
  assert.deepEqual(
    await listPlatformCaseBlocks(actor("admin"), CASE, {
      client: tableClient({ data: [], error: null }),
    }),
    [],
  );
  assert.deepEqual(
    await listPlatformCaseBlocks(actor("sales"), CASE, {
      client: rpcClient({ data: [], error: null }),
    }),
    [],
  );
});
