import assert from "node:assert/strict";
import test from "node:test";

import {
  listPlatformSalesStageEntries,
  normalizePlatformSalesStageEntry,
  parsePlatformSalesStageEntryCursor,
  PlatformSalesStageEntryError,
} from "../src/lib/platform-sales-stage-entries.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const LEAD_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

const ACTOR = Object.freeze({
  organizationId: ORGANIZATION_ID,
  platformRole: "admin",
});

function row(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    stage_key: "qualified",
    entered_at: "2026-09-03T06:00:00+00:00",
    entered_on: "2026-09-03",
    request_id: REQUEST_ID,
    ...overrides,
  };
}

function rpcClient(data, error = null) {
  const calls = [];
  return {
    calls,
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args, options) {
          calls.push([name, args, options]);
          return { data, error };
        },
      };
    },
  };
}

test("normalizes one exact tenant-bound stage-entry proof", () => {
  assert.deepEqual(normalizePlatformSalesStageEntry(row(), ORGANIZATION_ID.toUpperCase()), {
    organizationId: ORGANIZATION_ID,
    leadId: LEAD_ID,
    stageKey: "qualified",
    enteredAt: "2026-09-03T06:00:00+00:00",
    enteredOn: "2026-09-03",
    requestId: REQUEST_ID,
  });
});

test("parses the stable stage-entry cursor", () => {
  assert.deepEqual(
    parsePlatformSalesStageEntryCursor(
      "2026-09-03T06:00:00+00:00",
      REQUEST_ID.toUpperCase(),
    ),
    {
      enteredAt: "2026-09-03T06:00:00+00:00",
      requestId: REQUEST_ID,
    },
  );
});

test("rejects extra fields, another tenant, invalid stage, UUID, date, and timestamp", () => {
  for (const invalidRow of [
    row({ extra: true }),
    row({ organization_id: "10000000-0000-4000-8000-000000000002" }),
    row({ stage_key: "won" }),
    row({ entered_on: "2026-02-30" }),
    row({ entered_on: "2026-09-04" }),
    row({ entered_at: "not-a-timestamp" }),
    row({ request_id: "not-a-uuid" }),
    row({ request_id: "00000000-0000-0000-0000-000000000000" }),
  ]) {
    assert.throws(
      () => normalizePlatformSalesStageEntry(invalidRow, ORGANIZATION_ID),
      PlatformSalesStageEntryError,
    );
  }
});

test("reads one bounded page and exposes the next cursor from the last kept row", async () => {
  const secondRequestId = "30000000-0000-4000-8000-000000000002";
  const client = rpcClient([
    row(),
    row({
      lead_id: "20000000-0000-4000-8000-000000000002",
      request_id: secondRequestId,
      entered_at: "2026-09-03T07:00:00+00:00",
      entered_on: "2026-09-03",
    }),
  ]);
  const result = await listPlatformSalesStageEntries(
    ACTOR,
    { from: "2026-09-01", to: "2026-09-04", pageSize: 1 },
    { client },
  );
  assert.deepEqual(result, {
    rows: [normalizePlatformSalesStageEntry(row(), ORGANIZATION_ID)],
    nextCursor: {
      enteredAt: "2026-09-03T06:00:00+00:00",
      requestId: REQUEST_ID,
    },
    hasNext: true,
  });
  assert.deepEqual(client.calls, [[
    "staff_sales_stage_entry_cohort",
    { p_from_date: "2026-09-01", p_to_date: "2026-09-04", p_limit: 2 },
    { get: true },
  ]]);
});

test("passes an explicit cursor and rejects duplicate lead-stage facts inside one page", async () => {
  const cursorClient = rpcClient([]);
  await listPlatformSalesStageEntries(
    ACTOR,
    {
      from: "2026-09-01",
      to: "2026-09-04",
      cursor: {
        enteredAt: "2026-09-03T06:00:00+00:00",
        requestId: REQUEST_ID,
      },
    },
    { client: cursorClient },
  );
  assert.deepEqual(cursorClient.calls[0], [
    "staff_sales_stage_entry_cohort",
    {
      p_from_date: "2026-09-01",
      p_to_date: "2026-09-04",
      p_limit: 101,
      p_cursor_entered_at: "2026-09-03T06:00:00+00:00",
      p_cursor_request_id: REQUEST_ID,
    },
    { get: true },
  ]);

  await assert.rejects(
    listPlatformSalesStageEntries(
      ACTOR,
      { from: "2026-09-01", to: "2026-09-04" },
      { client: rpcClient([row(), row()]) },
    ),
    PlatformSalesStageEntryError,
  );

  const distinctStages = await listPlatformSalesStageEntries(
    ACTOR,
    { from: "2026-09-01", to: "2026-09-04" },
    {
      client: rpcClient([
        row(),
        row({
          stage_key: "meeting_completed",
          request_id: "30000000-0000-4000-8000-000000000002",
        }),
      ]),
    },
  );
  assert.equal(distinctStages.rows.length, 2);
  assert.equal(distinctStages.hasNext, false);
  assert.equal(distinctStages.nextCursor, null);
});

test("rejects invalid actor shape, role, range, page size, cursor, and RPC failures", async () => {
  for (const [actor, options] of [
    [null, { from: "2026-09-01", to: "2026-09-04" }],
    [{ organizationId: ORGANIZATION_ID, platformRole: "admissions" }, { from: "2026-09-01", to: "2026-09-04" }],
    [ACTOR, { from: "bad", to: "2026-09-04" }],
    [ACTOR, { from: "2026-09-01", to: "bad" }],
    [ACTOR, { from: "2026-09-05", to: "2026-09-04" }],
    [ACTOR, { from: "2025-09-03", to: "2026-09-04" }],
    [ACTOR, { from: "2026-09-01", to: "2026-09-04", pageSize: 0 }],
    [ACTOR, { from: "2026-09-01", to: "2026-09-04", pageSize: 101 }],
    [ACTOR, { from: "2026-09-01", to: "2026-09-04", cursor: { enteredAt: "bad", requestId: REQUEST_ID } }],
    [ACTOR, { from: "2026-09-01", to: "2026-09-04", cursor: { enteredAt: "2026-09-03T06:00:00+00:00", requestId: "bad" } }],
    [ACTOR, { from: "2026-09-01", to: "2026-09-04", cursor: { enteredAt: "2026-09-03T06:00:00+00:00" } }],
  ]) {
    await assert.rejects(
      listPlatformSalesStageEntries(actor, options, { client: rpcClient([]) }),
      PlatformSalesStageEntryError,
    );
  }

  await assert.rejects(
    listPlatformSalesStageEntries(
      ACTOR,
      { from: "2026-09-01", to: "2026-09-04" },
      { client: rpcClient(null, { code: "42501" }) },
    ),
    PlatformSalesStageEntryError,
  );

  await assert.rejects(
    listPlatformSalesStageEntries(
      ACTOR,
      { from: "2026-09-01", to: "2026-09-04", pageSize: 1 },
      {
        client: rpcClient([
          row(),
          row({
            stage_key: "meeting_completed",
            request_id: "30000000-0000-4000-8000-000000000002",
          }),
          row({
            stage_key: "potential",
            request_id: "30000000-0000-4000-8000-000000000003",
          }),
        ]),
      },
    ),
    PlatformSalesStageEntryError,
  );

  const boundaryClient = rpcClient([]);
  assert.deepEqual(
    await listPlatformSalesStageEntries(
      ACTOR,
      { from: "2025-09-04", to: "2026-09-04" },
      { client: boundaryClient },
    ),
    { rows: [], nextCursor: null, hasNext: false },
  );
  assert.equal(boundaryClient.calls.length, 1);

  const throwingClient = rpcClient([]);
  throwingClient.schema = () => ({
    async rpc() {
      throw new Error("transport failed");
    },
  });
  await assert.rejects(
    listPlatformSalesStageEntries(
      ACTOR,
      { from: "2026-09-01", to: "2026-09-04" },
      { client: throwingClient },
    ),
    PlatformSalesStageEntryError,
  );
});

test("rejects non-advancing and out-of-order stage-entry cursors", async () => {
  await assert.rejects(
    listPlatformSalesStageEntries(
      ACTOR,
      {
        from: "2026-09-01",
        to: "2026-09-04",
        pageSize: 2,
        cursor: {
          enteredAt: "2026-09-03T06:00:00+00:00",
          requestId: REQUEST_ID,
        },
      },
      {
        client: rpcClient([
          row(),
        ]),
      },
    ),
    PlatformSalesStageEntryError,
  );

  await assert.rejects(
    listPlatformSalesStageEntries(
      ACTOR,
      {
        from: "2026-09-01",
        to: "2026-09-04",
        pageSize: 2,
      },
      {
        client: rpcClient([
          row({
            request_id: "30000000-0000-4000-8000-000000000002",
            entered_at: "2026-09-03T07:00:00+00:00",
            entered_on: "2026-09-03",
          }),
          row({
            stage_key: "meeting_completed",
            request_id: "30000000-0000-4000-8000-000000000003",
            entered_at: "2026-09-03T06:30:00+00:00",
            entered_on: "2026-09-03",
          }),
        ]),
      },
    ),
    PlatformSalesStageEntryError,
  );
});

test("preserves PostgreSQL microsecond cursor ordering", async () => {
  const firstRequestId = "f0000000-0000-4000-8000-000000000001";
  const secondRequestId = "10000000-0000-4000-8000-000000000002";
  const result = await listPlatformSalesStageEntries(
    ACTOR,
    { from: "2026-09-01", to: "2026-09-04", pageSize: 2 },
    {
      client: rpcClient([
        row({
          request_id: firstRequestId,
          entered_at: "2026-09-03T06:00:00.000001+00:00",
          entered_on: "2026-09-03",
        }),
        row({
          stage_key: "meeting_completed",
          request_id: secondRequestId,
          entered_at: "2026-09-03T06:00:00.000002+00:00",
          entered_on: "2026-09-03",
        }),
      ]),
    },
  );

  assert.deepEqual(result.rows.map((entry) => entry.requestId), [
    firstRequestId,
    secondRequestId,
  ]);
});
