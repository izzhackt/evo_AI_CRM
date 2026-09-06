import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformAdmissionsWorkspaceRepositoryError,
  listPlatformAdmissionsTaskQueue,
  normalizePlatformAdmissionsTaskQueueRow,
  parsePlatformAdmissionsTaskQueueCursor,
} from "../src/lib/platform-admissions-workspace.ts";
import {
  PlatformCommunicationsRepositoryError,
  listPlatformConversations,
  normalizePlatformConversationSummary,
} from "../src/lib/platform-communications.ts";
import {
  PlatformSalesRepositoryError,
  getPlatformSalesLead,
  listPlatformSalesLeads,
} from "../src/lib/platform-sales.ts";

const ORGANIZATION_ID = "61000000-0000-4000-8000-000000000001";
const AUTH_USER_ID = "61000000-0000-4000-8000-000000000002";
const PROFILE_ID = "61000000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "61000000-0000-4000-8000-000000000004";
const BUNDLE_ID = "61000000-0000-4000-8000-000000000005";
const LEAD_ID = "62000000-0000-4000-8000-000000000001";
const CLIENT_ID = "62000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "62000000-0000-4000-8000-000000000003";
const STUDENT_CASE_ID = "62000000-0000-4000-8000-000000000004";
const CASE_TASK_ID = "63000000-0000-4000-8000-000000000001";
const SECOND_CASE_TASK_ID = "63000000-0000-4000-8000-000000000002";
const THIRD_CASE_TASK_ID = "63000000-0000-4000-8000-000000000003";
const SORT_AT = "2026-09-07T09:00:00+00:00";

const salesActor = Object.freeze({
  authUserId: AUTH_USER_ID,
  profileId: PROFILE_ID,
  membershipId: MEMBERSHIP_ID,
  organizationId: ORGANIZATION_ID,
  displayName: "Sales User",
  email: "sales@example.test",
  platformRole: "sales",
  authorityRole: "sales",
  presentationRole: "sales",
  platformAccessVersion: 1,
  platformBundleId: BUNDLE_ID,
  platformBundleVersion: 1,
});

const admissionsActor = Object.freeze({
  ...salesActor,
  displayName: "Admissions User",
  email: "admissions@example.test",
  platformRole: "admissions",
  authorityRole: "admissions",
  presentationRole: "admissions",
});

function recordingClient(data, error = null) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schema) {
        calls.push({ kind: "schema", schema });
        return {
          rpc(functionName, args, options) {
            calls.push({ kind: "rpc", functionName, args, options });
            return Promise.resolve({ data, error });
          },
        };
      },
    },
  };
}

function withoutKey(record, omittedKey) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== omittedKey),
  );
}

function validConversationRow(overrides = {}) {
  return {
    conversation_id: CONVERSATION_ID,
    student_case_id: null,
    queue: "sales",
    status: "open",
    subject: "Aijan WhatsApp",
    waha_session_name: "crm_primary",
    kommo_account_id: null,
    kommo_conversation_id: null,
    amocrm_account_id: null,
    amocrm_lead_id: null,
    amocrm_contact_id: null,
    created_at: "2026-09-06T09:00:00+00:00",
    sort_at: SORT_AT,
    last_message_direction: "inbound",
    last_message_at: SORT_AT,
    ...overrides,
  };
}

function validSalesQueueRow(overrides = {}) {
  return {
    sort_at: SORT_AT,
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
    next_action_due_date: "2026-09-08",
    workflow_version: "7",
    is_connected: true,
    open_duplicate_candidate_count: "0",
    linked_student_case_count: "0",
    linked_conversation_count: "1",
    created_at: "2026-09-06T09:00:00+00:00",
    updated_at: SORT_AT,
    stage_entered_at: "2026-09-06T10:00:00+00:00",
    ...overrides,
  };
}

function validSalesDetailRow(overrides = {}) {
  return {
    ...withoutKey(withoutKey(validSalesQueueRow(), "sort_at"), "stage_entered_at"),
    external_identifiers: [],
    provenance: [],
    linked_student_cases: [],
    linked_conversations: [
      {
        conversation_id: CONVERSATION_ID,
        subject: "Aijan WhatsApp",
        queue: "sales",
        status: "open",
        updated_at: SORT_AT,
      },
    ],
    ...overrides,
  };
}

function validTaskQueueRow(overrides = {}) {
  return {
    sort_at: SORT_AT,
    organization_id: ORGANIZATION_ID,
    case_task_id: CASE_TASK_ID,
    version: "3",
    student_case_id: STUDENT_CASE_ID,
    student_display_name: "Aijan Student",
    case_state: "active",
    task_type: "document_review",
    title: "Review passport",
    status: "open",
    priority: "normal",
    due_on: null,
    due_at: SORT_AT,
    student_visible: false,
    assignee_membership_id: MEMBERSHIP_ID,
    assignee_display_name: "Admissions User",
    created_at: "2026-09-06T09:00:00+00:00",
    updated_at: "2026-09-06T10:00:00+00:00",
    ...overrides,
  };
}

test("119 communication summaries require the exact last-message pair", () => {
  const summary = normalizePlatformConversationSummary(validConversationRow());
  assert.equal(summary.lastMessageDirection, "inbound");
  assert.equal(summary.lastMessageAt, SORT_AT);

  const emptySummary = normalizePlatformConversationSummary(
    validConversationRow({
      last_message_direction: null,
      last_message_at: null,
    }),
  );
  assert.equal(emptySummary.lastMessageDirection, null);
  assert.equal(emptySummary.lastMessageAt, null);

  for (const invalidRow of [
    withoutKey(validConversationRow(), "last_message_at"),
    { ...validConversationRow(), unexpected: true },
    validConversationRow({ last_message_direction: null }),
    validConversationRow({ last_message_at: null }),
    validConversationRow({ last_message_direction: "sideways" }),
    validConversationRow({ last_message_at: "2026-02-30T09:00:00+00:00" }),
  ]) {
    assert.throws(
      () => normalizePlatformConversationSummary(invalidRow),
      PlatformCommunicationsRepositoryError,
    );
  }
});

test("119 communication search trims, bounds and passes p_query exactly", async () => {
  const recorded = recordingClient([]);
  await listPlatformConversations(
    salesActor,
    { pageSize: 25, query: "  +996 555  " },
    { client: recorded.client },
  );
  assert.deepEqual(recorded.calls, [
    { kind: "schema", schema: "platform" },
    {
      kind: "rpc",
      functionName: "staff_communication_page",
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_limit: 26,
        p_query: "+996 555",
      },
      options: { get: true },
    },
  ]);

  for (const query of ["x".repeat(201), 119]) {
    const invalid = recordingClient([]);
    await assert.rejects(
      listPlatformConversations(
        salesActor,
        { query },
        { client: invalid.client },
      ),
      PlatformCommunicationsRepositoryError,
    );
    assert.deepEqual(invalid.calls, []);
  }
});

test("119 Sales queue requires stage_entered_at without changing detail", async () => {
  const queueClient = recordingClient([validSalesQueueRow()]);
  const page = await listPlatformSalesLeads(
    salesActor,
    {},
    { client: queueClient.client },
  );
  assert.equal(page.rows[0].stageEnteredAt, "2026-09-06T10:00:00+00:00");
  assert.deepEqual(queueClient.calls[1], {
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

  for (const invalidRow of [
    withoutKey(validSalesQueueRow(), "stage_entered_at"),
    { ...validSalesQueueRow(), unexpected: true },
    validSalesQueueRow({ stage_entered_at: null }),
    validSalesQueueRow({ stage_entered_at: "2026-02-30T09:00:00+00:00" }),
  ]) {
    const invalid = recordingClient([invalidRow]);
    await assert.rejects(
      listPlatformSalesLeads(salesActor, {}, { client: invalid.client }),
      PlatformSalesRepositoryError,
    );
  }

  const detailClient = recordingClient([validSalesDetailRow()]);
  const detail = await getPlatformSalesLead(salesActor, LEAD_ID, {
    client: detailClient.client,
  });
  assert.equal(Object.hasOwn(detail ?? {}, "stageEnteredAt"), false);

  const contaminatedDetail = recordingClient([
    { ...validSalesDetailRow(), stage_entered_at: SORT_AT },
  ]);
  await assert.rejects(
    getPlatformSalesLead(salesActor, LEAD_ID, {
      client: contaminatedDetail.client,
    }),
    PlatformSalesRepositoryError,
  );
});

test("119 Admissions task queue passes cursor and due bounds and returns the included-row cursor", async () => {
  const secondSortAt = "2026-09-08T09:00:00+00:00";
  const recorded = recordingClient([
    validTaskQueueRow(),
    validTaskQueueRow({
      sort_at: secondSortAt,
      case_task_id: SECOND_CASE_TASK_ID,
      due_at: secondSortAt,
    }),
    validTaskQueueRow({
      sort_at: "2026-09-09T09:00:00+00:00",
      case_task_id: THIRD_CASE_TASK_ID,
      due_at: "2026-09-09T09:00:00+00:00",
    }),
  ]);

  const page = await listPlatformAdmissionsTaskQueue(
    admissionsActor,
    {
      pageSize: 2,
      cursor: { sortAt: SORT_AT, caseTaskId: CASE_TASK_ID },
      dueFrom: "2026-09-07",
      dueTo: "2026-09-09",
    },
    { client: recorded.client },
  );
  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "staff_case_task_queue",
    args: {
      p_limit: 3,
      p_after_sort_at: SORT_AT,
      p_after_case_task_id: CASE_TASK_ID,
      p_due_from: "2026-09-07",
      p_due_to: "2026-09-09",
    },
    options: { get: true },
  });
  assert.deepEqual(
    page.rows.map((row) => row.caseTaskId),
    [CASE_TASK_ID, SECOND_CASE_TASK_ID],
  );
  assert.deepEqual(page.nextCursor, {
    sortAt: secondSortAt,
    caseTaskId: SECOND_CASE_TASK_ID,
  });
  assert.equal(page.hasNext, true);
});

test("119 Admissions task queue preserves no-options calls and rejects malformed input", async () => {
  assert.deepEqual(
    parsePlatformAdmissionsTaskQueueCursor(SORT_AT, CASE_TASK_ID),
    { sortAt: SORT_AT, caseTaskId: CASE_TASK_ID },
  );
  assert.equal(
    parsePlatformAdmissionsTaskQueueCursor(
      "2026-02-30T09:00:00+00:00",
      CASE_TASK_ID,
    ),
    null,
  );

  const empty = recordingClient([]);
  const page = await listPlatformAdmissionsTaskQueue(
    admissionsActor,
    undefined,
    { client: empty.client },
  );
  assert.deepEqual(empty.calls[1], {
    kind: "rpc",
    functionName: "staff_case_task_queue",
    args: { p_limit: 51 },
    options: { get: true },
  });
  assert.deepEqual(page, { rows: [], nextCursor: null, hasNext: false });

  for (const options of [
    { cursor: { sortAt: "not-a-timestamp", caseTaskId: CASE_TASK_ID } },
    { cursor: { sortAt: SORT_AT, caseTaskId: "not-a-uuid" } },
    { cursor: { sortAt: SORT_AT } },
    { cursor: { sortAt: SORT_AT, caseTaskId: CASE_TASK_ID, extra: true } },
    { dueFrom: "2026-02-30" },
    { dueTo: "09/09/2026" },
    { dueFrom: "2026-09-09", dueTo: "2026-09-07" },
  ]) {
    const invalid = recordingClient([]);
    await assert.rejects(
      listPlatformAdmissionsTaskQueue(admissionsActor, options, {
        client: invalid.client,
      }),
      PlatformAdmissionsWorkspaceRepositoryError,
    );
    assert.deepEqual(invalid.calls, []);
  }

  for (const invalidRow of [
    withoutKey(validTaskQueueRow(), "sort_at"),
    { ...validTaskQueueRow(), unexpected: true },
  ]) {
    assert.throws(
      () =>
        normalizePlatformAdmissionsTaskQueueRow(
          invalidRow,
          ORGANIZATION_ID,
        ),
      PlatformAdmissionsWorkspaceRepositoryError,
    );
  }
});
