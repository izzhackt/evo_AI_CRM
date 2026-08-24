import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformSalesWorkflowRepositoryError,
  getPlatformSalesLeadDetail,
  listPlatformSalesLeads,
  listPlatformSalesOwnerOptions,
  mutatePlatformSalesLeadWorkflow,
  normalizePlatformSalesLeadWorkflow,
  parsePlatformSalesDate,
  parsePlatformSalesWorkflowCursor,
} from "../src/lib/platform-sales-workflow.ts";

const ORGANIZATION_ID = "fc0a2c8d-91bb-4323-9dd2-f4057067012d";
const LEAD_ID = "a120b6db-2e3e-4a84-8873-073f4d2d33c3";
const SECOND_LEAD_ID = "dca013ca-52bb-42dd-8044-4fbb171c6c28";
const CLIENT_ID = "7be22cc5-0316-4bbc-9d91-e3d1d5775ddb";
const MEMBERSHIP_ID = "75418598-7b40-4b62-ac03-bf72fdd14e21";
const OTHER_MEMBERSHIP_ID = "aa2143d1-b677-4aec-a8c8-7248f26ba762";
const REQUEST_ID = "feec5db8-645a-4c0d-9cf6-09ca68efda50";

function actor(platformRole = "sales", overrides = {}) {
  return {
    authUserId: "84660516-5a65-40b8-b5b1-4230cf9c31da",
    profileId: "e4a65b55-b781-4fe9-90ce-c62bd1ff67dd",
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    displayName: "Platform operator",
    platformRole,
    platformAccessVersion: 13,
    platformBundleId: "00000000-0000-4000-8000-000000001202",
    platformBundleVersion: 13,
    role: platformRole,
    ...overrides,
  };
}

function rpcClient(responses = {}, errors = {}) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schemaName) {
        assert.equal(schemaName, "platform");
        return {
          async rpc(functionName, args, options) {
            calls.push({ functionName, args, options });
            return {
              data: responses[functionName] ?? null,
              error: errors[functionName] ?? null,
            };
          },
        };
      },
    },
  };
}

function sequencedRpcClient(responses = {}) {
  const calls = [];
  const positions = new Map();
  return {
    calls,
    client: {
      schema(schemaName) {
        assert.equal(schemaName, "platform");
        return {
          async rpc(functionName, args, options) {
            calls.push({ functionName, args, options });
            const position = positions.get(functionName) ?? 0;
            positions.set(functionName, position + 1);
            return {
              data: responses[functionName]?.[position] ?? null,
              error: null,
            };
          },
        };
      },
    },
  };
}

function leadRow(overrides = {}) {
  return {
    sort_at: "2026-08-24T10:20:30.123456+06:00",
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    client_id: CLIENT_ID,
    client_display_name: "Айжан Токтосунова",
    client_email: "aizhan@example.com",
    client_phone: "+996 555 123 456",
    current_owner_membership_id: MEMBERSHIP_ID,
    current_owner_display_name: "Sales operator",
    stage_key: "qualified",
    source_key: "website",
    lifecycle_state: "open",
    next_action_text: "Позвонить после обеда",
    next_action_due_date: "2026-08-25",
    workflow_version: 3,
    is_connected: true,
    open_duplicate_candidate_count: 0,
    linked_student_case_count: 1,
    linked_conversation_count: 2,
    created_at: "2026-08-23T10:20:30.123456+06:00",
    updated_at: "2026-08-24T10:20:30.123456+06:00",
    ...overrides,
  };
}

test("U4 lead normalization requires an exact stage and paired action date", () => {
  const lead = normalizePlatformSalesLeadWorkflow(leadRow());
  assert.equal(lead.stage, "qualified");
  assert.equal(lead.isConnected, true);
  assert.equal(lead.workflowVersion, 3);

  assert.throws(
    () => normalizePlatformSalesLeadWorkflow(leadRow({ stage_key: "contract_signed" })),
    PlatformSalesWorkflowRepositoryError,
  );
  assert.throws(
    () =>
      normalizePlatformSalesLeadWorkflow(
        leadRow({ lifecycle_state: "converted" }),
      ),
    PlatformSalesWorkflowRepositoryError,
  );
  assert.throws(
    () =>
      normalizePlatformSalesLeadWorkflow(
        leadRow({ next_action_due_date: null }),
      ),
    PlatformSalesWorkflowRepositoryError,
  );
  assert.equal(parsePlatformSalesDate("2026-02-29"), null);
  assert.equal(parsePlatformSalesDate("2028-02-29"), "2028-02-29");
});

test("U4 list sends every bounded filter before keyset pagination", async () => {
  const { client, calls } = rpcClient({
    staff_sales_lead_page: [
      leadRow(),
      leadRow({
        sort_at: "2026-08-24T10:20:29.000000+06:00",
        lead_id: SECOND_LEAD_ID,
        updated_at: "2026-08-24T10:20:29.000000+06:00",
        is_connected: false,
      }),
    ],
  });
  const cursor = parsePlatformSalesWorkflowCursor(
    "2026-08-24T11:00:00Z",
    "11111111-1111-4111-8111-111111111111",
  );
  const page = await listPlatformSalesLeads(
    actor(),
    {
      pageSize: 1,
      cursor,
      connection: "connected",
      stage: "qualified",
      assignment: "mine",
      due: "due_today",
      query: " Айжан ",
    },
    { client },
  );

  assert.equal(page.rows.length, 1);
  assert.equal(page.hasNext, true);
  assert.deepEqual(page.nextCursor, {
    updatedAt: "2026-08-24T10:20:30.123456+06:00",
    leadId: LEAD_ID,
  });
  assert.deepEqual(calls, [
    {
      functionName: "staff_sales_lead_page",
      args: {
        p_limit: 2,
        p_cursor_updated_at: "2026-08-24T11:00:00Z",
        p_cursor_id: "11111111-1111-4111-8111-111111111111",
        p_connection_filter: "connected",
        p_stage_filter: "qualified",
        p_assignment_filter: "mine",
        p_due_filter: "due_today",
        p_query: "Айжан",
      },
      options: { get: true },
    },
  ]);
});

test("U4 keyset pagination traverses more than 1,000 filtered leads exactly once", async () => {
  const total = 1_001;
  const pageSize = 50;
  const newestTimestamp = Date.parse("2026-08-24T18:00:00.000Z");
  const rows = Array.from({ length: total }, (_, index) => {
    const timestamp = new Date(newestTimestamp - index * 1_000).toISOString();
    return leadRow({
      lead_id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`,
      sort_at: timestamp,
      updated_at: timestamp,
    });
  });
  const responses = [];
  for (let start = 0; start < total; start += pageSize) {
    responses.push(rows.slice(start, start + pageSize + 1));
  }
  const { client, calls } = sequencedRpcClient({
    staff_sales_lead_page: responses,
  });

  const seen = [];
  let cursor = null;
  let hasNext = true;
  while (hasNext) {
    const page = await listPlatformSalesLeads(
      actor(),
      {
        pageSize,
        cursor,
        connection: "connected",
        stage: "qualified",
        assignment: "mine",
        due: "due_today",
        query: " Айжан ",
      },
      { client },
    );
    seen.push(...page.rows.map((row) => row.leadId));
    cursor = page.nextCursor;
    hasNext = page.hasNext;
  }

  assert.equal(seen.length, total);
  assert.equal(new Set(seen).size, total);
  assert.deepEqual(seen, rows.map((row) => row.lead_id));
  assert.equal(calls.length, Math.ceil(total / pageSize));
  for (const [index, call] of calls.entries()) {
    assert.equal(call.functionName, "staff_sales_lead_page");
    assert.equal(call.args.p_limit, pageSize + 1);
    assert.equal(call.args.p_connection_filter, "connected");
    assert.equal(call.args.p_stage_filter, "qualified");
    assert.equal(call.args.p_assignment_filter, "mine");
    assert.equal(call.args.p_due_filter, "due_today");
    assert.equal(call.args.p_query, "Айжан");
    assert.deepEqual(call.options, { get: true });

    if (index === 0) {
      assert.equal("p_cursor_updated_at" in call.args, false);
      assert.equal("p_cursor_id" in call.args, false);
    } else {
      const previousLastVisible = rows[index * pageSize - 1];
      assert.equal(
        call.args.p_cursor_updated_at,
        previousLastVisible.updated_at,
      );
      assert.equal(call.args.p_cursor_id, previousLastVisible.lead_id);
    }
  }
});

test("Sales cannot widen owner filters and Curator cannot call U4 reads", async () => {
  const { client, calls } = rpcClient({ staff_sales_lead_page: [] });
  await assert.rejects(
    listPlatformSalesLeads(
      actor(),
      { ownerMembershipId: OTHER_MEMBERSHIP_ID },
      { client },
    ),
    (error) =>
      error instanceof PlatformSalesWorkflowRepositoryError &&
      error.kind === "invalid",
  );
  await assert.rejects(
    listPlatformSalesLeads(actor("curator"), {}, { client }),
    (error) =>
      error instanceof PlatformSalesWorkflowRepositoryError &&
      error.kind === "forbidden",
  );
  assert.equal(calls.length, 0);
});

test("U4 detail rejects cross-organization or malformed result rows", async () => {
  const { client } = rpcClient({
    staff_sales_lead_detail: [
      {
        ...leadRow(),
        external_identifiers: [],
        provenance: [],
        linked_student_cases: [],
        linked_conversations: [],
      },
    ],
  });
  const detail = await getPlatformSalesLeadDetail(actor(), LEAD_ID, { client });
  assert.equal(detail?.leadId, LEAD_ID);

  const crossOrg = rpcClient({
    staff_sales_lead_detail: [
      {
        ...leadRow({ organization_id: OTHER_MEMBERSHIP_ID }),
        external_identifiers: [],
        provenance: [],
        linked_student_cases: [],
        linked_conversations: [],
      },
    ],
  });
  await assert.rejects(
    getPlatformSalesLeadDetail(actor(), LEAD_ID, { client: crossOrg.client }),
    PlatformSalesWorkflowRepositoryError,
  );
});

test("owner options stay ordered and Sales receives only their own membership", async () => {
  const { client, calls } = rpcClient({
    staff_sales_owner_options: [
      {
        sort_label: "sales operator",
        membership_id: MEMBERSHIP_ID,
        display_label: "Sales operator",
      },
    ],
  });
  const page = await listPlatformSalesOwnerOptions(
    actor(),
    { pageSize: 10 },
    { client },
  );
  assert.equal(page.rows[0]?.membershipId, MEMBERSHIP_ID);
  assert.deepEqual(calls, [
    {
      functionName: "staff_sales_owner_options",
      args: { p_limit: 11 },
      options: { get: true },
    },
  ]);

  const leaked = rpcClient({
    staff_sales_owner_options: [
      {
        sort_label: "other sales",
        membership_id: OTHER_MEMBERSHIP_ID,
        display_label: "Other Sales",
      },
    ],
  });
  await assert.rejects(
    listPlatformSalesOwnerOptions(actor(), {}, { client: leaked.client }),
    PlatformSalesWorkflowRepositoryError,
  );
});

test("mutation posts one normalized desired snapshot and validates its receipt", async () => {
  const { client, calls } = rpcClient({
    mutate_sales_lead_workflow: {
      request_id: REQUEST_ID,
      organization_id: ORGANIZATION_ID,
      lead_id: LEAD_ID,
      stage_key: "meeting_scheduled",
      current_owner_membership_id: MEMBERSHIP_ID,
      next_action_text: "Подтвердить встречу",
      next_action_due_date: "2026-08-26",
      workflow_version: 4,
      changed_at: "2026-08-24T12:00:00.000000+06:00",
    },
  });
  const receipt = await mutatePlatformSalesLeadWorkflow(
    actor(),
    {
      leadId: LEAD_ID,
      expectedWorkflowVersion: 3,
      requestId: REQUEST_ID,
      stage: "meeting_scheduled",
      ownerMembershipId: MEMBERSHIP_ID,
      nextActionText: "  Подтвердить встречу  ",
      nextActionDueDate: "2026-08-26",
      clearNextAction: false,
      reason: "  Клиент выбрал время  ",
    },
    { client },
  );

  assert.equal(receipt.workflowVersion, 4);
  assert.deepEqual(calls[0], {
    functionName: "mutate_sales_lead_workflow",
    args: {
      p_lead_id: LEAD_ID,
      p_expected_workflow_version: 3,
      p_request_id: REQUEST_ID,
      p_stage_key: "meeting_scheduled",
      p_owner_membership_id: MEMBERSHIP_ID,
      p_next_action_text: "Подтвердить встречу",
      p_next_action_due_date: "2026-08-26",
      p_clear_next_action: false,
      p_reason: "Клиент выбрал время",
    },
    options: undefined,
  });
});

test("explicit clear requires a null pair and stable SQL failures stay distinct", async () => {
  const { client } = rpcClient(
    {},
    {
      mutate_sales_lead_workflow: {
        code: "PT409",
        message: "workflow_version_conflict",
      },
    },
  );
  await assert.rejects(
    mutatePlatformSalesLeadWorkflow(
      actor(),
      {
        leadId: LEAD_ID,
        expectedWorkflowVersion: 3,
        requestId: REQUEST_ID,
        stage: "qualified",
        ownerMembershipId: MEMBERSHIP_ID,
        nextActionText: null,
        nextActionDueDate: null,
        clearNextAction: true,
        reason: null,
      },
      { client },
    ),
    (error) =>
      error instanceof PlatformSalesWorkflowRepositoryError &&
      error.kind === "stale",
  );

  await assert.rejects(
    mutatePlatformSalesLeadWorkflow(
      actor(),
      {
        leadId: LEAD_ID,
        expectedWorkflowVersion: 3,
        requestId: REQUEST_ID,
        stage: "qualified",
        ownerMembershipId: MEMBERSHIP_ID,
        nextActionText: "Нельзя отправить при clear",
        nextActionDueDate: null,
        clearNextAction: true,
        reason: null,
      },
      { client },
    ),
    (error) =>
      error instanceof PlatformSalesWorkflowRepositoryError &&
      error.kind === "invalid",
  );
});

test("every stable mutation failure remains distinguishable from an outage", async () => {
  const cases = [
    ["workflow_not_found_or_forbidden", "42501", "forbidden"],
    ["request_id_conflict", "23505", "request_conflict"],
    ["workflow_no_change", "22000", "no_change"],
    ["workflow_reason_required", "22023", "invalid"],
    ["internal database detail", "XX000", "unavailable"],
  ];

  for (const [message, code, expectedKind] of cases) {
    const { client } = rpcClient({}, {
      mutate_sales_lead_workflow: { message, code },
    });
    await assert.rejects(
      mutatePlatformSalesLeadWorkflow(
        actor(),
        {
          leadId: LEAD_ID,
          expectedWorkflowVersion: 3,
          requestId: REQUEST_ID,
          stage: "qualified",
          ownerMembershipId: MEMBERSHIP_ID,
          nextActionText: null,
          nextActionDueDate: null,
          clearNextAction: true,
          reason: null,
        },
        { client },
      ),
      (error) =>
        error instanceof PlatformSalesWorkflowRepositoryError &&
        error.kind === expectedKind,
    );
  }
});
