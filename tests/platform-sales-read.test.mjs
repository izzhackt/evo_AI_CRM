import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  PLATFORM_SALES_DUE_FILTERS,
  PLATFORM_SALES_STAGES,
  PlatformSalesRepositoryError,
  PlatformSalesWorkflowMutationError,
  getPlatformSalesLead,
  isPlatformLeadConversationLinked,
  listPlatformSalesOwnerOptions,
  listPlatformSalesLeads,
  mutatePlatformSalesLeadWorkflow,
  parsePlatformSalesCursor,
  parsePlatformSalesDueFilter,
  parsePlatformSalesStage,
  parsePlatformSalesUuid,
  readPlatformSalesPipeline,
} from "../src/lib/platform-sales.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const AUTH_USER_ID = "10000000-0000-4000-8000-000000000002";
const PROFILE_ID = "10000000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "10000000-0000-4000-8000-000000000004";
const LEAD_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_LEAD_ID = "20000000-0000-4000-8000-000000000002";
const THIRD_LEAD_ID = "20000000-0000-4000-8000-000000000003";
const CLIENT_ID = "30000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "40000000-0000-4000-8000-000000000001";
const SECOND_MEMBERSHIP_ID = "10000000-0000-4000-8000-000000000006";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const UPDATED_AT = "2026-09-02T12:34:56.123456+00:00";

const actor = Object.freeze({
  authUserId: AUTH_USER_ID,
  profileId: PROFILE_ID,
  membershipId: MEMBERSHIP_ID,
  organizationId: ORGANIZATION_ID,
  displayName: "Sales User",
  email: "sales@example.test",
  systemRole: "staff",
  assignments: [],
  permissionKeys: ["lead.read", "lead.sales.workflow.manage"],
  presentationRole: null,
  platformAccessVersion: 1,
});

function validQueueRow(overrides = {}) {
  return {
    sort_at: UPDATED_AT,
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    client_id: CLIENT_ID,
    client_display_name: "Aijan Student",
    client_email: "aijan@example.test",
    client_phone: "+996555000001",
    current_owner_membership_id: MEMBERSHIP_ID,
    current_owner_display_name: "Sales User",
    stage_key: "contacting",
    source_key: "whatsapp",
    lifecycle_state: "open",
    next_action_text: "Confirm consultation time",
    next_action_due_date: "2026-09-03",
    workflow_version: "7",
    is_connected: true,
    open_duplicate_candidate_count: "0",
    linked_student_case_count: 1,
    linked_conversation_count: "1",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: UPDATED_AT,
    stage_entered_at: "2026-09-02T09:00:00Z",
    latest_note_id: null,
    latest_note_body: null,
    latest_note_author_display_name: null,
    latest_note_created_at: null,
    ...overrides,
  };
}

function validDetailRow(overrides = {}) {
  const queueRow = Object.fromEntries(
    Object.entries(validQueueRow()).filter(
      ([key]) =>
        key !== "sort_at" &&
        key !== "stage_entered_at" &&
        !key.startsWith("latest_note_"),
    ),
  );
  return {
    ...queueRow,
    external_identifiers: [],
    provenance: [],
    linked_student_cases: [],
    linked_conversations: [
      {
        conversation_id: CONVERSATION_ID,
        subject: "WhatsApp consultation",
        queue: "sales",
        status: "open",
        updated_at: UPDATED_AT,
      },
    ],
    ...overrides,
  };
}

function recordingClient(responseFor) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schema) {
        calls.push({ kind: "schema", schema });
        return {
          rpc(functionName, args, options) {
            calls.push({ kind: "rpc", functionName, args, options });
            return Promise.resolve(responseFor(functionName, args, options));
          },
        };
      },
    },
  };
}

function staticClient(data, error = null) {
  return recordingClient(() => ({ data, error }));
}

test("Sales readers require the permission of each exact RPC before making a request", async () => {
  for (const permissionKeys of [[], ["pipeline.read"], ["lead.sales.workflow.manage"]]) {
    const current = { ...actor, permissionKeys };
    const unused = staticClient([]);
    await assert.rejects(listPlatformSalesLeads(current, {}, { client: unused.client }), PlatformSalesRepositoryError);
    await assert.rejects(getPlatformSalesLead(current, LEAD_ID, { client: unused.client }), PlatformSalesRepositoryError);
    await assert.rejects(isPlatformLeadConversationLinked(current, LEAD_ID, CONVERSATION_ID,
      { client: unused.client }), PlatformSalesRepositoryError);
    assert.deepEqual(unused.calls, []);
  }
  const readOnly = { ...actor, permissionKeys: ["lead.read"] };
  const unused = staticClient([]);
  await assert.rejects(listPlatformSalesOwnerOptions(readOnly, {}, { client: unused.client }), PlatformSalesRepositoryError);
  await assert.rejects(mutatePlatformSalesLeadWorkflow(readOnly, validWorkflowMutation(), { client: unused.client }),
    (error) => error instanceof PlatformSalesWorkflowMutationError && error.reason === "forbidden");
  assert.deepEqual(unused.calls, []);
});

test("Pipeline coordinator separates readable leads from optional workflow owners and creation", async () => {
  const board = { leads: [{ id: LEAD_ID }], truncated: false };
  const owners = { rows: [], hasNext: false, nextCursor: null };
  for (const [name, current, expectedCalls, canCreateLead] of [
    ["read-only", { ...actor, permissionKeys: ["lead.read"] }, ["board"], false],
    ["read and workflow", actor, ["board", "owners"], true],
    ["system Admin", { ...actor, systemRole: "admin", permissionKeys: [] }, ["board", "owners"], true],
    ["Admin Sales preview", { ...actor, systemRole: "admin", presentationRole: "sales", permissionKeys: [] }, ["board", "owners"], false],
  ]) {
    const calls = [];
    const result = await readPlatformSalesPipeline(current, {
      board: async actual => { assert.equal(actual, current); calls.push("board"); return board; },
      owners: async actual => { assert.equal(actual, current); calls.push("owners"); return owners; },
    });
    assert.deepEqual(calls, expectedCalls, name);
    assert.equal(result.board, board, name);
    assert.equal(result.ownerOptions, expectedCalls.includes("owners") ? owners : null, name);
    assert.equal(result.canCreateLead, canCreateLead, name);
  }
});

test("Pipeline coordinator does not read queues for workflow-only, pipeline-only or Admissions preview", async () => {
  for (const current of [
    { ...actor, permissionKeys: ["lead.sales.workflow.manage"] },
    { ...actor, permissionKeys: ["pipeline.read"] },
    { ...actor, permissionKeys: [] },
    { ...actor, systemRole: "admin", presentationRole: "admissions" },
  ]) {
    const unused = async () => { assert.fail("No pipeline RPC is permitted for this view"); };
    await assert.rejects(readPlatformSalesPipeline(current, { board: unused, owners: unused }), PlatformSalesRepositoryError);
  }
});

test("Pipeline coordinator propagates authorized read failures instead of returning empty data", async () => {
  for (const branch of ["board", "owners"]) {
    const failure = new Error(`synthetic ${branch} read failure`);
    const readers = { board: async () => [], owners: async () => [] };
    readers[branch] = async () => { throw failure; };
    await assert.rejects(readPlatformSalesPipeline(actor, readers), error => error === failure);
  }
});

test("Workflow-only permission can read owner options without granting lead-read or creation scope", async () => {
  const recorded = staticClient([]);
  const page = await listPlatformSalesOwnerOptions({ ...actor, permissionKeys: ["lead.sales.workflow.manage"] },
    {}, { client: recorded.client });
  assert.deepEqual(page.rows, []);
  assert.deepEqual(recorded.calls.map(call => call.kind), ["schema", "rpc"]);
  assert.equal(recorded.calls[1].functionName, "staff_sales_owner_options");
});

test("Pipeline page uses the tested coordinator and manual creation keeps the actual SQL action permission", () => {
  const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const page = source("src/app/(v3)/v3/pipeline/page.tsx");
  const adapter = source("src/lib/v3/pipeline-source.ts");
  assert.match(page, /readPipelineWorkspace\(actor, filters\)/);
  assert.match(adapter, /readPlatformSalesPipeline\(actor, \{/);
  assert.match(adapter, /board: \(current\) => readPipelineLeads\(current, filters\)/);
  assert.match(adapter, /owners: readPipelineOwnerOptions/);
  assert.match(page, /canCreateLead \? <ManualLeadForm/);
  assert.match(page, /!ownerSelectShown && query\.owner !== null/);
  assert.match(page, /name="owner" value=\{query\.owner\}/);
  const action = source("src/lib/platform-manual-lead-actions.ts");
  const manual = source("src/lib/v3/manual-lead-source.ts");
  assert.match(action, /isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "lead\.sales\.workflow\.manage"\)/);
  assert.match(manual, /!staffHasPermission\(actor, "lead\.sales\.workflow\.manage"\)/);
  assert.doesNotMatch(action + manual, /"lead\.manual\.create"/);
  const sql = source("supabase/migrations/156_platform_scoped_staff_consumers.sql");
  assert.match(sql, /staff_can_create_for_owner\(a\.organization_id,a\.membership_id,\s*'lead\.sales\.workflow\.manage','lead',p_owner_membership_id\)/);
  assert.match(sql, /staff_can_receive_assignment\(p_organization_id,p_owner_membership_id,\s*'lead\.read','lead',NULL\)/);
});

test("Sales read constants and public parsers accept only the reviewed contract", () => {
  assert.deepEqual(PLATFORM_SALES_STAGES, [
    "new",
    "contacting",
    "qualified",
    "meeting_scheduled",
    "meeting_completed",
    "potential",
  ]);
  assert.deepEqual(PLATFORM_SALES_DUE_FILTERS, [
    "all",
    "scheduled",
    "unscheduled",
    "due_today",
    "overdue",
  ]);
  assert.equal(parsePlatformSalesStage("qualified"), "qualified");
  assert.equal(parsePlatformSalesStage("handoff_ready"), null);
  assert.equal(parsePlatformSalesDueFilter("due_today"), "due_today");
  assert.equal(parsePlatformSalesDueFilter("tomorrow"), null);
  assert.equal(parsePlatformSalesUuid(LEAD_ID.toUpperCase()), LEAD_ID);
  assert.equal(
    parsePlatformSalesUuid("00000000-0000-0000-0000-000000000000"),
    null,
  );
  assert.deepEqual(parsePlatformSalesCursor(UPDATED_AT, LEAD_ID), {
    updatedAt: UPDATED_AT,
    id: LEAD_ID,
  });
  assert.equal(parsePlatformSalesCursor("2026-02-30T00:00:00Z", LEAD_ID), null);
  assert.equal(parsePlatformSalesCursor(UPDATED_AT, "not-a-uuid"), null);
});

test("listPlatformSalesLeads uses the cookie-bound platform RPC contract and pageSize plus one", async () => {
  const first = validQueueRow();
  const second = validQueueRow({
    lead_id: SECOND_LEAD_ID,
    sort_at: "2026-09-02T11:00:00Z",
    updated_at: "2026-09-02T11:00:00Z",
    client_id: null,
    client_display_name: null,
    client_email: null,
    client_phone: null,
    current_owner_membership_id: null,
    current_owner_display_name: null,
    stage_key: "new",
    next_action_text: null,
    next_action_due_date: null,
    workflow_version: 1,
    is_connected: false,
    linked_student_case_count: "0",
    linked_conversation_count: 0,
  });
  const extra = validQueueRow({
    lead_id: THIRD_LEAD_ID,
    sort_at: "2026-09-02T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
  });
  const recorded = staticClient([first, second, extra]);

  const result = await listPlatformSalesLeads(
    actor,
    {
      pageSize: 2,
      cursor: { updatedAt: UPDATED_AT, id: LEAD_ID },
      connectionFilter: "connected",
      stageFilter: "contacting",
      assignmentFilter: "mine",
      ownerMembershipId: MEMBERSHIP_ID,
      dueFilter: "scheduled",
      query: "  Aijan  ",
    },
    { client: recorded.client },
  );

  assert.equal(recorded.calls[0].schema, "platform");
  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "staff_sales_lead_page",
    args: {
      p_limit: 3,
      p_cursor_updated_at: UPDATED_AT,
      p_cursor_id: LEAD_ID,
      p_connection_filter: "connected",
      p_stage_filter: "contacting",
      p_assignment_filter: "mine",
      p_owner_membership_id: MEMBERSHIP_ID,
      p_due_filter: "scheduled",
      p_query: "Aijan",
    },
    options: { get: true },
  });
  assert.equal("p_actor_role" in recorded.calls[1].args, false);
  assert.equal("p_organization_id" in recorded.calls[1].args, false);
  assert.equal(result.hasNext, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.nextCursor, {
    updatedAt: "2026-09-02T11:00:00Z",
    id: SECOND_LEAD_ID,
  });
  assert.deepEqual(result.rows[0], {
    organizationId: ORGANIZATION_ID,
    leadId: LEAD_ID,
    clientId: CLIENT_ID,
    clientDisplayName: "Aijan Student",
    clientEmail: "aijan@example.test",
    clientPhone: "+996555000001",
    currentOwnerMembershipId: MEMBERSHIP_ID,
    currentOwnerDisplayName: "Sales User",
    stageKey: "contacting",
    sourceKey: "whatsapp",
    lifecycleState: "open",
    nextActionText: "Confirm consultation time",
    nextActionDueDate: "2026-09-03",
    workflowVersion: "7",
    isConnected: true,
    openDuplicateCandidateCount: 0,
    linkedStudentCaseCount: 1,
    linkedConversationCount: 1,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: UPDATED_AT,
    stageEnteredAt: "2026-09-02T09:00:00Z",
    latestNote: null,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rows), true);
});

test("listPlatformSalesLeads omits nullable arguments from its GET RPC", async () => {
  const recorded = staticClient([]);

  await listPlatformSalesLeads(actor, {}, { client: recorded.client });

  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "staff_sales_lead_page",
    args: {
      p_limit: 51,
      p_connection_filter: "all",
      p_stage_filter: "all",
      p_assignment_filter: "all",
      p_due_filter: "all",
    },
    options: { get: true },
  });
  assert.equal(Object.values(recorded.calls[1].args).includes(null), false);
});

test("latest Sales note body uses the canonical Unicode code-point contract", async () => {
  const body = "📝".repeat(4_000);
  const recorded = staticClient([
    validQueueRow({
      latest_note_id: SECOND_LEAD_ID,
      latest_note_body: body,
      latest_note_author_display_name: "Exact Author",
      latest_note_created_at: UPDATED_AT,
    }),
  ]);

  const result = await listPlatformSalesLeads(actor, {}, { client: recorded.client });
  assert.equal(result.rows[0]?.latestNote?.body, body);

  for (const invalidBody of ["📝".repeat(4_001), "broken\ud800unicode"])
  {
    const invalid = staticClient([
      validQueueRow({
        latest_note_id: SECOND_LEAD_ID,
        latest_note_body: invalidBody,
        latest_note_author_display_name: "Exact Author",
        latest_note_created_at: UPDATED_AT,
      }),
    ]);
    await assert.rejects(
      listPlatformSalesLeads(actor, {}, { client: invalid.client }),
      PlatformSalesRepositoryError,
    );
  }
});

test("getPlatformSalesLead accepts exactly one row and parses linked conversations", async () => {
  const recorded = staticClient([validDetailRow()]);
  const detail = await getPlatformSalesLead(actor, LEAD_ID, {
    client: recorded.client,
  });

  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "staff_sales_lead_detail",
    args: { p_lead_id: LEAD_ID },
    options: { get: true },
  });
  assert.equal(detail?.workflowVersion, "7");
  assert.deepEqual(detail?.linkedConversations, [
    {
      conversationId: CONVERSATION_ID,
      subject: "WhatsApp consultation",
      queue: "sales",
      status: "open",
      updatedAt: UPDATED_AT,
    },
  ]);
  assert.equal(Object.isFrozen(detail), true);
  assert.equal(Object.isFrozen(detail?.linkedConversations), true);

  const empty = staticClient([]);
  assert.equal(
    await getPlatformSalesLead(actor, LEAD_ID, { client: empty.client }),
    null,
  );
});

test("the documented scoped lead-read denial becomes an unavailable profile without hiding other failures", async () => {
  // The SQL read contract raises this exact code/message; a missing row already
  // returns null. This is repository outcome coverage, not live authorization proof.
  const denied = staticClient(null, { code: "42501", message: "sales_workflow_forbidden" });
  assert.equal(await getPlatformSalesLead(actor, LEAD_ID, { client: denied.client }), null);
  for (const error of [
    { code: "42501", message: "permission denied for schema platform" },
    { code: "42501", message: "unexpected_denial" },
    { code: "PGRST202", message: "RPC missing from schema cache" },
    { code: "08006", message: "Connection failure" },
    { code: "XX000", message: "sales_workflow_forbidden" },
  ]) {
    await assert.rejects(getPlatformSalesLead(actor, LEAD_ID, { client: staticClient(null, error).client }), PlatformSalesRepositoryError);
  }
  const network = recordingClient(() => { throw new TypeError("Network unavailable"); });
  await assert.rejects(getPlatformSalesLead(actor, LEAD_ID, { client: network.client }), PlatformSalesRepositoryError);
  await assert.rejects(getPlatformSalesLead(actor, LEAD_ID, { client: staticClient({}).client }), PlatformSalesRepositoryError);
});

test("isPlatformLeadConversationLinked uses the exact cookie-bound canonical link RPC", async () => {
  const linkedResponse = staticClient([{ linked: true }]);

  assert.equal(
    await isPlatformLeadConversationLinked(actor, LEAD_ID, CONVERSATION_ID, {
      client: linkedResponse.client,
    }),
    true,
  );
  assert.deepEqual(linkedResponse.calls[1], {
    kind: "rpc",
    functionName: "staff_canonical_lead_conversation_link",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_lead_id: LEAD_ID,
      p_conversation_id: CONVERSATION_ID,
    },
    options: { get: true },
  });

  const unlinkedResponse = staticClient([{ linked: false }]);
  assert.equal(
    await isPlatformLeadConversationLinked(actor, LEAD_ID, CONVERSATION_ID, {
      client: unlinkedResponse.client,
    }),
    false,
  );
});

test("isPlatformLeadConversationLinked fails closed on non-exact cardinality, shape, boolean, or provider errors", async (t) => {
  const invalidResponses = [
    ["non-array", null, null],
    ["empty", [], null],
    ["duplicate", [{ linked: true }, { linked: true }], null],
    ["non-record row", [null], null],
    ["missing key", [{}], null],
    ["extra key", [{ linked: true, lead_id: LEAD_ID }], null],
    ["non-boolean", [{ linked: "true" }], null],
    ["provider error", null, { message: "sensitive detail" }],
  ];

  for (const [name, data, error] of invalidResponses) {
    await t.test(name, async () => {
      const recorded = staticClient(data, error);
      await assert.rejects(
        isPlatformLeadConversationLinked(actor, LEAD_ID, CONVERSATION_ID, {
          client: recorded.client,
        }),
        PlatformSalesRepositoryError,
      );
    });
  }
});

test("Sales reads fail closed on provider failures, duplicates and non-exact detail cardinality", async () => {
  const duplicate = staticClient([validQueueRow(), validQueueRow()]);
  await assert.rejects(
    listPlatformSalesLeads(actor, { pageSize: 2 }, { client: duplicate.client }),
    (error) => {
      assert.equal(error instanceof PlatformSalesRepositoryError, true);
      assert.equal(error.message, "Platform sales data is unavailable.");
      assert.equal(error.reason, "unavailable");
      return true;
    },
  );

  const providerFailure = staticClient(null, { message: "sensitive detail" });
  await assert.rejects(
    listPlatformSalesLeads(actor, {}, { client: providerFailure.client }),
    PlatformSalesRepositoryError,
  );

  const tooManyDetails = staticClient([validDetailRow(), validDetailRow()]);
  await assert.rejects(
    getPlatformSalesLead(actor, LEAD_ID, { client: tooManyDetails.client }),
    PlatformSalesRepositoryError,
  );
});

test("Sales reads validate UUIDs, timestamps, dates, bigints, booleans, enums and JSONB projections", async (t) => {
  const invalidQueueCases = [
    ["organization UUID", { organization_id: "not-a-uuid" }],
    ["lead UUID", { lead_id: "not-a-uuid" }],
    ["timestamp", { updated_at: "not-a-timestamp" }],
    ["cursor timestamp agreement", { sort_at: "2026-09-02T12:00:00Z" }],
    ["date", { next_action_due_date: "2026-02-30" }],
    ["workflow bigint", { workflow_version: "9223372036854775808" }],
    ["count bigint", { linked_conversation_count: "9007199254740992" }],
    ["boolean", { is_connected: "true" }],
    ["stage enum", { stage_key: "handoff_ready" }],
    ["lifecycle enum", { lifecycle_state: "converted" }],
    ["next action pair", { next_action_due_date: null }],
    ["client projection", { client_display_name: null }],
    ["owner projection", { current_owner_display_name: null }],
    ["extra key", { unexpected: true }],
  ];

  for (const [name, overrides] of invalidQueueCases) {
    await t.test(name, async () => {
      const recorded = staticClient([validQueueRow(overrides)]);
      await assert.rejects(
        listPlatformSalesLeads(actor, {}, { client: recorded.client }),
        PlatformSalesRepositoryError,
      );
    });
  }

  const invalidConversation = validDetailRow({
    linked_conversations: [
      {
        conversation_id: CONVERSATION_ID,
        subject: "WhatsApp consultation",
        queue: "unknown",
        status: "open",
        updated_at: UPDATED_AT,
      },
    ],
  });
  const badDetail = staticClient([invalidConversation]);
  await assert.rejects(
    getPlatformSalesLead(actor, LEAD_ID, { client: badDetail.client }),
    PlatformSalesRepositoryError,
  );
});

test("Sales read input validation stops before an RPC call", async () => {
  const recorded = staticClient([]);
  for (const options of [
    { pageSize: 0 },
    { pageSize: 101 },
    { dueFilter: "tomorrow" },
    { stageFilter: "handoff_ready" },
    { cursor: { updatedAt: UPDATED_AT, id: "not-a-uuid" } },
    { ownerMembershipId: "not-a-uuid" },
    { query: "x".repeat(201) },
  ]) {
    await assert.rejects(
      listPlatformSalesLeads(actor, options, { client: recorded.client }),
      PlatformSalesRepositoryError,
    );
  }
  await assert.rejects(
    getPlatformSalesLead(actor, "not-a-uuid", { client: recorded.client }),
    PlatformSalesRepositoryError,
  );
  await assert.rejects(
    isPlatformLeadConversationLinked(actor, "not-a-uuid", CONVERSATION_ID, {
      client: recorded.client,
    }),
    PlatformSalesRepositoryError,
  );
  await assert.rejects(
    isPlatformLeadConversationLinked(actor, LEAD_ID, "not-a-uuid", {
      client: recorded.client,
    }),
    PlatformSalesRepositoryError,
  );
  assert.equal(recorded.calls.length, 0);
});

test("listPlatformSalesOwnerOptions uses the bounded cookie RPC and validates its cursor", async () => {
  const recorded = staticClient([
    {
      sort_label: "sales user",
      membership_id: MEMBERSHIP_ID,
      display_label: "Sales User",
    },
    {
      sort_label: "second sales",
      membership_id: SECOND_MEMBERSHIP_ID,
      display_label: "Second Sales",
    },
  ]);

  const page = await listPlatformSalesOwnerOptions(
    actor,
    { pageSize: 1, query: "sales" },
    { client: recorded.client },
  );
  assert.deepEqual(page, {
    rows: [{ membershipId: MEMBERSHIP_ID, displayLabel: "Sales User" }],
    nextCursor: { sortLabel: "sales user", membershipId: MEMBERSHIP_ID },
    hasNext: true,
  });
  assert.deepEqual(recorded.calls, [
    { kind: "schema", schema: "platform" },
    {
      kind: "rpc",
      functionName: "staff_sales_owner_options",
      args: { p_limit: 2, p_query: "sales" },
      options: { get: true },
    },
  ]);

  const cursorClient = staticClient([]);
  await listPlatformSalesOwnerOptions(
    actor,
    {
      cursor: { sortLabel: "Sales User", membershipId: MEMBERSHIP_ID },
      pageSize: 100,
    },
    { client: cursorClient.client },
  );
  assert.deepEqual(cursorClient.calls[1].args, {
    p_limit: 101,
    p_cursor_label: "sales user",
    p_cursor_id: MEMBERSHIP_ID,
  });
});

test("owner-option validation rejects malformed or duplicate provider data", async () => {
  const malformedResponses = [
    [{ sort_label: "sales user", membership_id: MEMBERSHIP_ID }],
    [{
      sort_label: "wrong sort",
      membership_id: MEMBERSHIP_ID,
      display_label: "Sales User",
    }],
    [
      {
        sort_label: "sales user",
        membership_id: MEMBERSHIP_ID,
        display_label: "Sales User",
      },
      {
        sort_label: "sales user",
        membership_id: MEMBERSHIP_ID,
        display_label: "Sales User",
      },
    ],
  ];
  for (const data of malformedResponses) {
    await assert.rejects(
      listPlatformSalesOwnerOptions(actor, {}, { client: staticClient(data).client }),
      PlatformSalesRepositoryError,
    );
  }

  const neverCalled = staticClient([]);
  for (const options of [
    { pageSize: 0 },
    { pageSize: 101 },
    { query: "x".repeat(201) },
    { cursor: { sortLabel: " ", membershipId: MEMBERSHIP_ID } },
    { cursor: { sortLabel: "sales user", membershipId: "not-a-uuid" } },
  ]) {
    await assert.rejects(
      listPlatformSalesOwnerOptions(actor, options, { client: neverCalled.client }),
      PlatformSalesRepositoryError,
    );
  }
  assert.equal(neverCalled.calls.length, 0);
});

function validWorkflowMutation(overrides = {}) {
  return {
    leadId: LEAD_ID,
    expectedWorkflowVersion: "7",
    requestId: REQUEST_ID,
    stageKey: "qualified",
    ownerMembershipId: MEMBERSHIP_ID,
    nextActionText: "Send contract checklist",
    nextActionDueDate: "2026-09-04",
    clearNextAction: false,
    reason: null,
    ...overrides,
  };
}

function validWorkflowReceipt(overrides = {}) {
  return {
    request_id: REQUEST_ID,
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    stage_key: "qualified",
    current_owner_membership_id: MEMBERSHIP_ID,
    next_action_text: "Send contract checklist",
    next_action_due_date: "2026-09-04",
    workflow_version: "8",
    changed_at: UPDATED_AT,
    ...overrides,
  };
}

test("mutatePlatformSalesLeadWorkflow sends one JWT-bound idempotent RPC and verifies its receipt", async () => {
  const recorded = staticClient(validWorkflowReceipt());
  const receipt = await mutatePlatformSalesLeadWorkflow(
    actor,
    validWorkflowMutation(),
    { client: recorded.client },
  );
  assert.deepEqual(receipt, {
    requestId: REQUEST_ID,
    organizationId: ORGANIZATION_ID,
    leadId: LEAD_ID,
    stageKey: "qualified",
    currentOwnerMembershipId: MEMBERSHIP_ID,
    nextActionText: "Send contract checklist",
    nextActionDueDate: "2026-09-04",
    workflowVersion: "8",
    changedAt: UPDATED_AT,
  });
  assert.deepEqual(recorded.calls, [
    { kind: "schema", schema: "platform" },
    {
      kind: "rpc",
      functionName: "mutate_sales_lead_workflow",
      args: {
        p_lead_id: LEAD_ID,
        p_expected_workflow_version: "7",
        p_request_id: REQUEST_ID,
        p_stage_key: "qualified",
        p_owner_membership_id: MEMBERSHIP_ID,
        p_next_action_text: "Send contract checklist",
        p_next_action_due_date: "2026-09-04",
        p_clear_next_action: false,
        p_reason: null,
      },
      options: undefined,
    },
  ]);
});

test("workflow mutation input validation fails before touching Supabase", async () => {
  const recorded = staticClient(validWorkflowReceipt());
  const invalidInputs = [
    validWorkflowMutation({ leadId: "not-a-uuid" }),
    validWorkflowMutation({ expectedWorkflowVersion: "0" }),
    validWorkflowMutation({
      requestId: "50000000-0000-1000-8000-000000000001",
    }),
    validWorkflowMutation({ stageKey: "handoff_ready" }),
    validWorkflowMutation({ ownerMembershipId: "not-a-uuid" }),
    validWorkflowMutation({ nextActionText: null }),
    validWorkflowMutation({ nextActionDueDate: "2026-02-30" }),
    validWorkflowMutation({ clearNextAction: true }),
    validWorkflowMutation({ reason: "x".repeat(501) }),
    validWorkflowMutation({ unexpected: true }),
  ];
  for (const input of invalidInputs) {
    await assert.rejects(
      mutatePlatformSalesLeadWorkflow(actor, input, { client: recorded.client }),
      (error) =>
        error instanceof PlatformSalesWorkflowMutationError &&
        error.reason === "invalid",
    );
  }
  assert.equal(recorded.calls.length, 0);
});

test("workflow mutation maps only reviewed SQL failures and fails closed otherwise", async () => {
  const cases = [
    ["42501", "workflow_not_found_or_forbidden", "forbidden"],
    ["PT409", "workflow_version_conflict", "stale"],
    ["23505", "request_id_conflict", "request_conflict"],
    ["22000", "workflow_no_change", "invalid"],
    ["22023", "workflow_invalid_owner", "invalid"],
    ["42501", "some_other_denial", "unavailable"],
    ["08006", "connection_failure", "unavailable"],
  ];
  for (const [code, message, reason] of cases) {
    const client = staticClient(null, { code, message });
    await assert.rejects(
      mutatePlatformSalesLeadWorkflow(actor, validWorkflowMutation(), {
        client: client.client,
      }),
      (error) =>
        error instanceof PlatformSalesWorkflowMutationError &&
        error.reason === reason,
    );
  }
});

test("workflow mutation rejects an unverified or mismatched receipt", async () => {
  for (const receipt of [
    validWorkflowReceipt({ workflow_version: "9" }),
    validWorkflowReceipt({ organization_id: SECOND_LEAD_ID }),
    validWorkflowReceipt({ request_id: "50000000-0000-4000-8000-000000000002" }),
    validWorkflowReceipt({ next_action_text: "A different action" }),
    { ...validWorkflowReceipt(), extra: true },
  ]) {
    await assert.rejects(
      mutatePlatformSalesLeadWorkflow(actor, validWorkflowMutation(), {
        client: staticClient(receipt).client,
      }),
      (error) =>
        error instanceof PlatformSalesWorkflowMutationError &&
        error.reason === "unavailable",
    );
  }
});
