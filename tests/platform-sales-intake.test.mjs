import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformSalesIntakeRepositoryError,
  isPlatformLeadConversationLinked,
  listPlatformSalesIntake,
  normalizePlatformSalesIntakeRow,
  parsePlatformSalesIntakeCursor,
} from "../src/lib/platform-sales-intake.ts";

const ORGANIZATION_ID = "fc0a2c8d-91bb-4323-9dd2-f4057067012d";
const MEMBERSHIP_ID = "75418598-7b40-4b62-ac03-bf72fdd14e21";
const WORK_ITEM_ID = "a120b6db-2e3e-4a84-8873-073f4d2d33c3";
const LEAD_ID = "7be22cc5-0316-4bbc-9d91-e3d1d5775ddb";
const CLIENT_ID = "61318db8-645a-4c0d-9cf6-09ca68efda50";
const CONVERSATION_ID = "2240b9e7-9387-44f9-b120-08743098226e";

function actor(overrides = {}) {
  return {
    authUserId: "84660516-5a65-40b8-b5b1-4230cf9c31da",
    profileId: "e4a65b55-b781-4fe9-90ce-c62bd1ff67dd",
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    displayName: "Platform operator",
    platformRole: "sales",
    platformAccessVersion: 12,
    platformBundleId: "00000000-0000-4000-8000-000000000802",
    platformBundleVersion: 12,
    role: "sales",
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

function validRow(overrides = {}) {
  return {
    sort_at: "2026-08-24T10:20:30.123456+06:00",
    work_item_id: WORK_ITEM_ID,
    intake_state: "received",
    attempt_count: 1,
    available_at: "2026-08-24T10:20:00Z",
    provider_occurred_at: "2026-08-24T10:19:59Z",
    conversation_id: CONVERSATION_ID,
    canonical_lead_id: LEAD_ID,
    canonical_client_id: CLIENT_ID,
    client_display_name: "WhatsApp ••••0199",
    subject: "WhatsApp ••••0199",
    message_preview: "Здравствуйте",
    error_code: null,
    created_at: "2026-08-24T10:20:00Z",
    updated_at: "2026-08-24T10:20:30.123456+06:00",
    ...overrides,
  };
}

test("normalizes only safe explicit receive-only intake states", () => {
  assert.deepEqual(normalizePlatformSalesIntakeRow(validRow()), {
    sortAt: "2026-08-24T10:20:30.123456+06:00",
    workItemId: WORK_ITEM_ID,
    state: "received",
    attemptCount: 1,
    availableAt: "2026-08-24T10:20:00Z",
    providerOccurredAt: "2026-08-24T10:19:59Z",
    conversationId: CONVERSATION_ID,
    canonicalLeadId: LEAD_ID,
    canonicalClientId: CLIENT_ID,
    clientDisplayName: "WhatsApp ••••0199",
    subject: "WhatsApp ••••0199",
    messagePreview: "Здравствуйте",
    errorCode: null,
    createdAt: "2026-08-24T10:20:00Z",
    updatedAt: "2026-08-24T10:20:30.123456+06:00",
  });

  for (const invalid of [
    validRow({ intake_state: "sent" }),
    validRow({ attempt_count: -1 }),
    validRow({ message_preview: "x".repeat(501) }),
    validRow({ work_item_id: "not-a-uuid" }),
    validRow({ canonical_lead_id: null }),
  ]) {
    assert.throws(
      () => normalizePlatformSalesIntakeRow(invalid),
      PlatformSalesIntakeRepositoryError,
    );
  }

  assert.equal(
    normalizePlatformSalesIntakeRow(
      validRow({
        intake_state: "unsupported",
        conversation_id: null,
        canonical_lead_id: null,
        canonical_client_id: null,
        client_display_name: null,
        subject: null,
        message_preview: null,
        error_code: "waha_inbound_unsupported_chat",
      }),
    ).state,
    "unsupported",
  );
});

test("accepts only complete stable Sales intake cursors", () => {
  assert.deepEqual(
    parsePlatformSalesIntakeCursor(
      "2026-08-24T10:20:30.123456+06:00",
      WORK_ITEM_ID.toUpperCase(),
    ),
    {
      sortAt: "2026-08-24T10:20:30.123456+06:00",
      workItemId: WORK_ITEM_ID,
    },
  );
  assert.equal(parsePlatformSalesIntakeCursor(undefined, undefined), null);
  assert.throws(
    () => parsePlatformSalesIntakeCursor("2026-08-24T10:20:30Z", undefined),
    PlatformSalesIntakeRepositoryError,
  );
});

test("requests a capped filtered keyset page and exposes one explicit next cursor", async () => {
  const secondWorkItemId = "dca013ca-52bb-42dd-8044-4fbb171c6c28";
  const { client, calls } = rpcClient({
    staff_waha_sales_intake_page: [
      validRow({ intake_state: "retrying" }),
      validRow({
        work_item_id: secondWorkItemId,
        sort_at: "2026-08-24T10:20:29.000000+06:00",
        intake_state: "retrying",
      }),
    ],
  });

  const page = await listPlatformSalesIntake(
    actor(),
    {
      pageSize: 1,
      state: "retrying",
      query: "Айжан",
      cursor: {
        sortAt: "2026-08-24T11:00:00Z",
        workItemId: "11111111-1111-4111-8111-111111111111",
      },
    },
    { client },
  );

  assert.equal(page.rows.length, 1);
  assert.equal(page.hasNext, true);
  assert.deepEqual(page.nextCursor, {
    sortAt: "2026-08-24T10:20:30.123456+06:00",
    workItemId: WORK_ITEM_ID,
  });
  assert.deepEqual(calls, [
    {
      functionName: "staff_waha_sales_intake_page",
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_limit: 2,
        p_before_sort_at: "2026-08-24T11:00:00Z",
        p_before_work_item_id: "11111111-1111-4111-8111-111111111111",
        p_state: "retrying",
        p_query: "Айжан",
      },
      options: { get: true },
    },
  ]);
});

test("fails closed on malformed pages and verifies the exact lead conversation link", async () => {
  const malformed = rpcClient({
    staff_waha_sales_intake_page: [validRow({ intake_state: "outbound" })],
  });
  await assert.rejects(
    () => listPlatformSalesIntake(actor(), undefined, { client: malformed.client }),
    PlatformSalesIntakeRepositoryError,
  );

  const linked = rpcClient({
    staff_canonical_lead_conversation_link: [{ linked: true }],
  });
  assert.equal(
    await isPlatformLeadConversationLinked(
      actor(),
      LEAD_ID,
      CONVERSATION_ID,
      { client: linked.client },
    ),
    true,
  );
  assert.deepEqual(linked.calls[0], {
    functionName: "staff_canonical_lead_conversation_link",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_lead_id: LEAD_ID,
      p_conversation_id: CONVERSATION_ID,
    },
    options: { get: true },
  });
});
