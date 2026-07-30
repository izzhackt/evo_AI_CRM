import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformCommunicationsRepositoryError,
  getPlatformConversationThread,
  isPlatformConversationId,
  listPlatformConversations,
  normalizePlatformConversationMessage,
  normalizePlatformConversationSummary,
  parsePlatformRouteUuid,
} from "../src/lib/platform-communications.ts";

const CONVERSATION_ID = "A120B6DB-2E3E-4A84-8873-073F4D2D33C3";
const MESSAGE_ID = "7be22cc5-0316-4bbc-9d91-e3d1d5775ddb";
const STUDENT_CASE_ID = "eec32b28-a106-4421-8802-7a50bcb416ef";

const PLATFORM_COMMUNICATIONS_RUNTIME_FILES = [
  "../src/app/(staff)/whatsapp/page.tsx",
  "../src/app/(staff)/whatsapp/[id]/page.tsx",
  "../src/components/platform/communications/PlatformWaList.tsx",
  "../src/components/platform/communications/PlatformConversationView.tsx",
  "../src/lib/platform-communications.ts",
];

function validConversationRow(overrides = {}) {
  return {
    conversation_id: CONVERSATION_ID,
    student_case_id: STUDENT_CASE_ID,
    queue: "sales",
    status: "open",
    subject: "Admissions enquiry",
    waha_session_name: "evo-inbox",
    kommo_account_id: "9223372036854775807",
    kommo_conversation_id: "kommo-conversation-42",
    amocrm_account_id: 1234,
    amocrm_lead_id: "5678",
    amocrm_contact_id: 9012,
    created_at: "2026-07-30T09:15:30.123456+06:00",
    ...overrides,
  };
}

function validMessageRow(overrides = {}) {
  return {
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    direction: "inbound",
    body_text: "Здравствуйте",
    language: "ru",
    student_visible: true,
    waha_session_name: " evo-inbox ",
    waha_message_id: "message-42",
    kommo_account_id: "9223372036854775807",
    kommo_conversation_id: null,
    kommo_message_id: "kommo-message-42",
    amocrm_account_id: 1234,
    amocrm_lead_id: "5678",
    amocrm_contact_id: 9012,
    created_at: "2026-07-30T03:15:30Z",
    ...overrides,
  };
}

test("validates and canonicalizes non-nil route UUIDs", () => {
  assert.equal(
    parsePlatformRouteUuid(CONVERSATION_ID),
    CONVERSATION_ID.toLowerCase(),
  );
  assert.equal(isPlatformConversationId(CONVERSATION_ID), true);
  assert.equal(
    isPlatformConversationId("00000000-0000-0000-0000-000000000000"),
    false,
  );
  assert.equal(isPlatformConversationId("conversation-123"), false);
  assert.equal(parsePlatformRouteUuid(null), null);
});

test("keeps Platform communications runtime imports outside the legacy data plane", () => {
  for (const relativePath of PLATFORM_COMMUNICATIONS_RUNTIME_FILES) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /(?:from\s+|import\(\s*)["']@\/lib\/(?:actions|db|queries)["']/,
      relativePath,
    );
    assert.doesNotMatch(
      source,
      /(?:from\s+|import\(\s*)["']@\/components\/WaList["']/,
      relativePath,
    );
  }

  const listPage = readFileSync(
    new URL("../src/app/(staff)/whatsapp/page.tsx", import.meta.url),
    "utf8",
  );
  const threadPage = readFileSync(
    new URL("../src/app/(staff)/whatsapp/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    listPage,
    /await import\(\s*["']\.\/LegacyWhatsAppPage["']\s*\)/,
  );
  assert.match(
    threadPage,
    /await import\(\s*["']\.\/LegacyConversationPage["']\s*\)/,
  );
});

test("normalizes a strict conversation projection without losing bigint IDs", () => {
  assert.deepEqual(
    normalizePlatformConversationSummary(validConversationRow()),
    {
      id: CONVERSATION_ID.toLowerCase(),
      studentCaseId: STUDENT_CASE_ID,
      queue: "sales",
      status: "open",
      subject: "Admissions enquiry",
      wahaSessionName: "evo-inbox",
      kommoAccountId: "9223372036854775807",
      kommoConversationId: "kommo-conversation-42",
      amocrmAccountId: "1234",
      amocrmLeadId: "5678",
      amocrmContactId: "9012",
      createdAt: "2026-07-30T09:15:30.123456+06:00",
    },
  );
});

test("normalizes message enums, visibility and nullable provider references", () => {
  assert.deepEqual(normalizePlatformConversationMessage(validMessageRow()), {
    id: MESSAGE_ID,
    conversationId: CONVERSATION_ID.toLowerCase(),
    direction: "inbound",
    bodyText: "Здравствуйте",
    language: "ru",
    studentVisible: true,
    wahaSessionName: "evo-inbox",
    wahaMessageId: "message-42",
    kommoAccountId: "9223372036854775807",
    kommoConversationId: null,
    kommoMessageId: "kommo-message-42",
    amocrmAccountId: "1234",
    amocrmLeadId: "5678",
    amocrmContactId: "9012",
    createdAt: "2026-07-30T03:15:30Z",
  });
});

test("rejects malformed PostgREST rows with one safe error", () => {
  const malformedRows = [
    validConversationRow({ queue: "finance" }),
    validConversationRow({ student_case_id: "not-a-uuid" }),
    validConversationRow({ amocrm_lead_id: Number.MAX_SAFE_INTEGER + 1 }),
    validConversationRow({ amocrm_lead_id: "9223372036854775808" }),
    validConversationRow({ created_at: "30 July 2026" }),
    validConversationRow({ subject: "   " }),
  ];

  for (const row of malformedRows) {
    assert.throws(
      () => normalizePlatformConversationSummary(row),
      (error) =>
        error instanceof PlatformCommunicationsRepositoryError &&
        error.message === "Platform communications are unavailable.",
    );
  }

  assert.throws(
    () =>
      normalizePlatformConversationMessage(
        validMessageRow({ student_visible: "true" }),
      ),
    PlatformCommunicationsRepositoryError,
  );
});

test("rejects finance and student actors before any repository read", async () => {
  function actor(platformRole) {
    return {
      authUserId: "84660516-5a65-40b8-b5b1-4230cf9c31da",
      profileId: "e4a65b55-b781-4fe9-90ce-c62bd1ff67dd",
      membershipId: "75418598-7b40-4b62-ac03-bf72fdd14e21",
      organizationId: "fc0a2c8d-91bb-4323-9dd2-f4057067012d",
      displayName: "Restricted actor",
      platformRole,
      platformAccessVersion: 1,
      role: platformRole === "student" ? "client" : platformRole,
    };
  }

  await assert.rejects(
    () => listPlatformConversations(actor("finance")),
    PlatformCommunicationsRepositoryError,
  );
  await assert.rejects(
    () => getPlatformConversationThread(actor("student"), "not-a-uuid"),
    PlatformCommunicationsRepositoryError,
  );
});
