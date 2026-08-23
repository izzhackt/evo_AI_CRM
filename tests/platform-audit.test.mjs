import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_RESOURCE_TYPES,
  PlatformAuditContractError,
  normalizePlatformAuditExportInput,
  normalizePlatformAuditExportResult,
  normalizePlatformAuditSearchInput,
  normalizePlatformAuditSearchResult,
} from "../src/lib/platform-audit.ts";
import {
  createPlatformAuditRepository,
  PlatformAuditRepositoryError,
} from "../src/lib/platform-audit-repository.ts";
import {
  searchPlatformAudit,
  PlatformAuditActionError,
} from "../src/lib/platform-audit-actions.ts";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const RESOURCE_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";
const CURSOR_ID = "55555555-5555-4555-8555-555555555555";

const MIGRATION_SOURCE = readFileSync(
  new URL("../supabase/migrations/071_platform_audit_search_export.sql", import.meta.url),
  "utf8",
);
const U1_MIGRATION_SOURCE = readFileSync(
  new URL("../supabase/migrations/083_platform_unified_staff_access.sql", import.meta.url),
  "utf8",
);

const SAFE_ROW = {
  audit_event_id: EVENT_ID,
  created_at: "2026-08-13T08:15:00.000Z",
  action: "case.curator.set",
  resource_type: "student_case",
  resource_id: RESOURCE_ID,
  actor_kind: "user",
  actor_display_label: "Staff",
  request_id: REQUEST_ID,
  reason_code: "restricted",
  changed_field_codes: ["case_assignment"],
};

function assertContractError(callback) {
  assert.throws(callback, PlatformAuditContractError);
}

function sqlTextArray(functionName) {
  const startMarker = `CREATE OR REPLACE FUNCTION platform_private.${functionName}()`;
  const start = MIGRATION_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `${functionName} must exist in migration 071`);

  const bodyEnd = MIGRATION_SOURCE.indexOf("$$;", start);
  assert.notEqual(bodyEnd, -1, `${functionName} must have a complete SQL body`);

  const functionBody = MIGRATION_SOURCE.slice(start, bodyEnd);
  const arrayStart = functionBody.indexOf("SELECT ARRAY[");
  const arrayEnd = functionBody.indexOf("]::TEXT[]", arrayStart);
  assert.notEqual(arrayStart, -1, `${functionName} must select one text array`);
  assert.notEqual(arrayEnd, -1, `${functionName} must cast one text array`);

  return [...functionBody.slice(arrayStart, arrayEnd).matchAll(/'([^']+)'/g)].map(
    ([, value]) => value,
  );
}

test("browser-safe allowlists match migration 071 plus the bounded U1 extension", () => {
  assert.match(U1_MIGRATION_SOURCE, /'membership\.permission\.change'/);
  assert.deepEqual(
    PLATFORM_AUDIT_ACTIONS,
    [...sqlTextArray("p7a_safe_audit_actions"), "membership.permission.change"].sort(),
  );
  assert.deepEqual(
    PLATFORM_AUDIT_RESOURCE_TYPES,
    sqlTextArray("p7a_safe_audit_resource_types"),
  );
});

test("search input canonicalizes exact allowlisted filters and stable cursor pairs", () => {
  assert.deepEqual(
    normalizePlatformAuditSearchInput({
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00.000Z",
      actions: "case.curator.set,audit.export,case.curator.set",
      resource_types: "student_case,audit_export",
      resource_id: RESOURCE_ID.toUpperCase(),
      page_size: "25",
      snapshot_created_at: "2026-08-13T09:00:00Z",
      snapshot_id: SNAPSHOT_ID.toUpperCase(),
      cursor_created_at: "2026-08-13T08:30:00.000Z",
      cursor_id: CURSOR_ID,
    }),
    {
      startAt: "2026-08-01T00:00:00.000000Z",
      endAt: "2026-08-14T00:00:00.000000Z",
      actions: ["audit.export", "case.curator.set"],
      resourceTypes: ["audit_export", "student_case"],
      resourceId: RESOURCE_ID,
      pageSize: 25,
      snapshotCreatedAt: "2026-08-13T09:00:00.000000Z",
      snapshotId: SNAPSHOT_ID,
      cursorCreatedAt: "2026-08-13T08:30:00.000000Z",
      cursorId: CURSOR_ID,
    },
  );
});

test("search input rejects extras, invalid allowlist values, invalid pages and incomplete pairs", () => {
  for (const input of [
    { unknown: "value" },
    { actions: "case.curator.set,not.allowed" },
    { resource_types: "student_case,phone_number" },
    { resource_id: "not-a-uuid" },
    { page_size: "0" },
    { page_size: "101" },
    { snapshot_created_at: "2026-08-13T09:00:00Z" },
    { snapshot_id: SNAPSHOT_ID },
    { cursor_created_at: "2026-08-13T08:00:00Z", cursor_id: CURSOR_ID },
  ]) {
    assertContractError(() => normalizePlatformAuditSearchInput(input));
  }
});

test("export requires an explicit UTC window of no more than 31 days and a request UUID", () => {
  assert.deepEqual(
    normalizePlatformAuditExportInput({
      request_id: REQUEST_ID.toUpperCase(),
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00Z",
      actions: "audit.export",
      resource_types: "audit_export",
    }),
    {
      requestId: REQUEST_ID,
      startAt: "2026-08-01T00:00:00.000000Z",
      endAt: "2026-08-14T00:00:00.000000Z",
      actions: ["audit.export"],
      resourceTypes: ["audit_export"],
      resourceId: null,
      snapshotCreatedAt: null,
      snapshotId: null,
    },
  );

  for (const input of [
    { request_id: REQUEST_ID, start_at: "", end_at: "2026-08-14T00:00:00Z" },
    { request_id: REQUEST_ID, start_at: "2026-08-14T00:00:00Z", end_at: "2026-08-14T00:00:00Z" },
    { request_id: REQUEST_ID, start_at: "2026-07-01T00:00:00Z", end_at: "2026-08-14T00:00:00Z" },
    { request_id: "not-a-uuid", start_at: "2026-08-01T00:00:00Z", end_at: "2026-08-14T00:00:00Z" },
  ]) {
    assertContractError(() => normalizePlatformAuditExportInput(input));
  }
});

test("search result accepts only the exact safe projection and stable page metadata", () => {
  const normalized = normalizePlatformAuditSearchResult({
    filters: {
      start_at: "2026-08-01T00:00:00+00:00",
      end_at: "2026-08-14T00:00:00+00:00",
      actions: ["case.curator.set"],
      resource_types: ["student_case"],
      resource_id: RESOURCE_ID,
    },
    snapshot_created_at: "2026-08-13T09:00:00+00:00",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: "2026-08-13T08:15:00+00:00",
    next_cursor_id: EVENT_ID,
    has_more: true,
    rows: [SAFE_ROW],
  });

  assert.equal(normalized.rows[0].actorDisplayLabel, "Staff");
  assert.equal(normalized.rows[0].resourceId, RESOURCE_ID);
  assert.deepEqual(normalized.rows[0].changedFieldCodes, ["case_assignment"]);
  assert.equal(normalized.snapshotId, SNAPSHOT_ID);
  assert.equal(normalized.hasMore, true);
});

test("SQL microsecond timestamps round-trip without weakening snapshot or cursor precision", () => {
  const result = normalizePlatformAuditSearchResult({
    filters: {
      start_at: "2026-08-01T00:00:00.123400+00:00",
      end_at: "2026-08-14T00:00:00.654321+00:00",
      actions: null,
      resource_types: null,
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00.123456+00:00",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: "2026-08-13T08:15:00.654321+00:00",
    next_cursor_id: CURSOR_ID,
    has_more: true,
    rows: [{ ...SAFE_ROW, created_at: "2026-08-13T08:15:00.999999+00:00" }],
  });

  assert.equal(result.filters.startAt, "2026-08-01T00:00:00.123400Z");
  assert.equal(result.filters.endAt, "2026-08-14T00:00:00.654321Z");
  assert.equal(result.snapshotCreatedAt, "2026-08-13T09:00:00.123456Z");
  assert.equal(result.nextCursorCreatedAt, "2026-08-13T08:15:00.654321Z");
  assert.equal(result.rows[0].createdAt, "2026-08-13T08:15:00.999999Z");
});

test("microsecond filter ordering compares numeric time instead of variable-length text", () => {
  assert.deepEqual(
    normalizePlatformAuditSearchInput({
      start_at: "2026-08-13T08:15:00.12Z",
      end_at: "2026-08-13T08:15:00.123Z",
    }).startAt,
    "2026-08-13T08:15:00.120000Z",
  );
  assertContractError(() =>
    normalizePlatformAuditSearchInput({
      start_at: "2026-08-13T08:15:00.123Z",
      end_at: "2026-08-13T08:15:00.12Z",
    }),
  );
});

test("safe row parsing rejects unknown private fields, unsafe labels and non-allowlisted codes", () => {
  const base = {
    filters: {
      start_at: null,
      end_at: null,
      actions: null,
      resource_types: null,
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00Z",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: null,
    next_cursor_id: null,
    has_more: false,
    rows: [SAFE_ROW],
  };

  for (const row of [
    { ...SAFE_ROW, before_state: { secret: true } },
    { ...SAFE_ROW, actor_display_label: "Administrator +996 555 000 000" },
    { ...SAFE_ROW, actor_kind: "provider" },
    { ...SAFE_ROW, reason_code: "free text" },
    { ...SAFE_ROW, changed_field_codes: ["phone_number"] },
  ]) {
    assertContractError(() => normalizePlatformAuditSearchResult({ ...base, rows: [row] }));
  }
});

test("empty search uses a null snapshot and export result verifies exact safe receipt shape", () => {
  assert.deepEqual(
    normalizePlatformAuditSearchResult({
      filters: {
        start_at: null,
        end_at: null,
        actions: null,
        resource_types: null,
        resource_id: null,
      },
      snapshot_created_at: null,
      snapshot_id: null,
      next_cursor_created_at: null,
      next_cursor_id: null,
      has_more: false,
      rows: [],
    }).rows,
    [],
  );

  const result = normalizePlatformAuditExportResult({
    request_id: REQUEST_ID,
    filters: {
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00Z",
      actions: ["audit.export"],
      resource_types: ["audit_export"],
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00Z",
    snapshot_id: SNAPSHOT_ID,
    row_count: 1,
    row_set_sha256: "a".repeat(64),
    rows: [{
      ...SAFE_ROW,
      action: "audit.export",
      resource_type: "audit_export",
      reason_code: "audit_export_requested",
      changed_field_codes: [
        "export_filters",
        "export_row_count",
        "export_row_set_sha256",
      ],
    }],
  });
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.rowCount, 1);
  assert.equal(result.rowSetSha256, "a".repeat(64));
});

test("safe rows require the exact fixed reason and changed-code mapping for their action", () => {
  const base = {
    filters: {
      start_at: null,
      end_at: null,
      actions: null,
      resource_types: null,
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00Z",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: null,
    next_cursor_id: null,
    has_more: false,
  };
  const organizationRow = {
    ...SAFE_ROW,
    action: "organization.bootstrap",
    resource_type: "organization",
    changed_field_codes: ["record_status", "actor_role", "assignment"],
  };
  assert.equal(
    normalizePlatformAuditSearchResult({ ...base, rows: [organizationRow] })
      .rows[0].action,
    "organization.bootstrap",
  );
  for (const row of [
    { ...organizationRow, changed_field_codes: ["actor_role", "assignment", "record_status"] },
    { ...organizationRow, reason_code: "audit_export_requested" },
  ]) {
    assertContractError(() =>
      normalizePlatformAuditSearchResult({ ...base, rows: [row] }),
    );
  }
});

function rpcClient(response, calls) {
  return {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(name, args) {
          calls.push({ name, args });
          return response;
        },
      };
    },
  };
}

test("search repository passes only frozen actor-derived RPC arguments and parses exact output", async () => {
  const calls = [];
  const response = {
    data: {
      filters: {
        start_at: null,
        end_at: null,
        actions: ["case.curator.set"],
        resource_types: ["student_case"],
        resource_id: RESOURCE_ID,
      },
      snapshot_created_at: "2026-08-13T09:00:00Z",
      snapshot_id: SNAPSHOT_ID,
      next_cursor_created_at: null,
      next_cursor_id: null,
      has_more: false,
      rows: [SAFE_ROW],
    },
    error: null,
  };
  const repository = createPlatformAuditRepository(rpcClient(response, calls));
  const result = await repository.search(
    normalizePlatformAuditSearchInput({
      actions: "case.curator.set",
      resource_types: "student_case",
      resource_id: RESOURCE_ID,
      page_size: "10",
    }),
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(calls, [
    {
      name: "search_audit_events",
      args: {
        p_start_at: null,
        p_end_at: null,
        p_actions: ["case.curator.set"],
        p_resource_types: ["student_case"],
        p_resource_id: RESOURCE_ID,
        p_page_size: 10,
        p_snapshot_created_at: null,
        p_snapshot_id: null,
        p_cursor_created_at: null,
        p_cursor_id: null,
      },
    },
  ]);
  assert.equal("p_organization_id" in calls[0].args, false);
  assert.equal("p_membership_id" in calls[0].args, false);
});

test("export repository binds request replay input and rejects response drift", async () => {
  const input = normalizePlatformAuditExportInput({
    request_id: REQUEST_ID,
    start_at: "2026-08-01T00:00:00Z",
    end_at: "2026-08-14T00:00:00Z",
    actions: "audit.export",
    resource_types: "audit_export",
  });
  const baseData = {
    request_id: REQUEST_ID,
    filters: {
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00Z",
      actions: ["audit.export"],
      resource_types: ["audit_export"],
      resource_id: null,
    },
    snapshot_created_at: null,
    snapshot_id: null,
    row_count: 0,
    row_set_sha256: "0".repeat(64),
    rows: [],
  };
  const calls = [];
  const repository = createPlatformAuditRepository(
    rpcClient({ data: baseData, error: null }, calls),
  );
  const receipt = await repository.export(input);
  assert.equal(receipt.rowCount, 0);
  assert.deepEqual(calls[0], {
    name: "export_audit_events",
    args: {
      p_request_id: REQUEST_ID,
      p_start_at: "2026-08-01T00:00:00.000000Z",
      p_end_at: "2026-08-14T00:00:00.000000Z",
      p_actions: ["audit.export"],
      p_resource_types: ["audit_export"],
      p_resource_id: null,
      p_snapshot_created_at: null,
      p_snapshot_id: null,
    },
  });

  const drifted = createPlatformAuditRepository(
    rpcClient(
      {
        data: { ...baseData, request_id: "66666666-6666-4666-8666-666666666666" },
        error: null,
      },
      [],
    ),
  );
  await assert.rejects(() => drifted.export(input), PlatformAuditRepositoryError);
});

test("repository maps SQL validation classes without exposing provider details", async () => {
  const input = normalizePlatformAuditSearchInput({});
  for (const [code, kind] of [
    ["42501", "unauthorized"],
    ["22023", "invalid"],
    ["54000", "too_large"],
    ["XX000", "unavailable"],
  ]) {
    const repository = createPlatformAuditRepository(
      rpcClient({ data: null, error: { code, message: "private provider detail" } }, []),
    );
    await assert.rejects(
      () => repository.search(input),
      (error) => {
        assert.ok(error instanceof PlatformAuditRepositoryError);
        assert.equal(error.kind, kind);
        assert.doesNotMatch(error.message, /provider detail/);
        return true;
      },
    );
  }
});

test("search action fails closed for disabled or non-Admin actors before repository access", async () => {
  let repositoryCalls = 0;
  const dependencies = {
    env: { EVO_PLATFORM_P7A_AUDIT_ENABLED: "1" },
    async requireActor() {
      return { platformRole: "sales" };
    },
    async createRepository() {
      repositoryCalls += 1;
      throw new Error("should not run");
    },
  };

  await assert.rejects(
    () => searchPlatformAudit({}, dependencies),
    (error) => error instanceof PlatformAuditActionError && error.kind === "unauthorized",
  );
  assert.equal(repositoryCalls, 0);

  await assert.rejects(
    () => searchPlatformAudit({}, { ...dependencies, env: {} }),
    (error) => error instanceof PlatformAuditActionError && error.kind === "unavailable",
  );
  assert.equal(repositoryCalls, 0);
});

test("search action uses the authenticated Admin repository and returns no actor authority fields", async () => {
  const result = await searchPlatformAudit(
    { actions: "case.curator.set", page_size: "10" },
    {
      env: { EVO_PLATFORM_P7A_AUDIT_ENABLED: "1" },
      async requireActor() {
        return {
          platformRole: "admin",
          organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
      },
      async createRepository() {
        return {
          async search(input) {
            assert.equal("organizationId" in input, false);
            assert.equal("membershipId" in input, false);
            assert.deepEqual(input.actions, ["case.curator.set"]);
            return {
              filters: {
                startAt: null,
                endAt: null,
                actions: ["case.curator.set"],
                resourceTypes: null,
                resourceId: null,
              },
              snapshotCreatedAt: null,
              snapshotId: null,
              nextCursorCreatedAt: null,
              nextCursorId: null,
              hasMore: false,
              rows: [],
            };
          },
          async export() {
            throw new Error("should not run");
          },
        };
      },
    },
  );
  assert.deepEqual(result.rows, []);
});
