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
  parsePlatformConversationCursor,
  parsePlatformRouteUuid,
  parsePlatformWahaSessionName,
} from "../src/lib/platform-communications.ts";
import {
  derivePlatformBusinessKey,
  derivePlatformSemanticRequestId,
  normalizePlatformConversationWorkflow,
  normalizePlatformKnowledgeCatalogItem,
  normalizePlatformMessageText,
  normalizePlatformMutationReason,
  PlatformMessagingWorkflowError,
} from "../src/lib/platform-messaging-workflow.ts";

const CONVERSATION_ID = "A120B6DB-2E3E-4A84-8873-073F4D2D33C3";
const MESSAGE_ID = "7be22cc5-0316-4bbc-9d91-e3d1d5775ddb";
const STUDENT_CASE_ID = "eec32b28-a106-4421-8802-7a50bcb416ef";
const KNOWLEDGE_VERSION_ID = "b47254eb-c856-456d-9cb7-2888c3ae59a6";
const DRAFT_REQUEST_ID = "61318db8-645a-4c0d-9cf6-09ca68efda50";
const OUTBOX_WORK_ITEM_ID = "2240b9e7-9387-44f9-b120-08743098226e";
const PAGED_READ_MIGRATION_URL = new URL(
  "../supabase/migrations/078_platform_paged_read_models.sql",
  import.meta.url,
);

const PLATFORM_COMMUNICATIONS_RUNTIME_FILES = [
  "../src/app/(staff)/whatsapp/page.tsx",
  "../src/app/(staff)/whatsapp/[id]/page.tsx",
  "../src/components/platform/communications/PlatformWaList.tsx",
  "../src/components/platform/communications/PlatformConversationView.tsx",
  "../src/lib/platform-communications.ts",
];

function platformActor(platformRole = "sales") {
  return {
    authUserId: "84660516-5a65-40b8-b5b1-4230cf9c31da",
    profileId: "e4a65b55-b781-4fe9-90ce-c62bd1ff67dd",
    membershipId: "75418598-7b40-4b62-ac03-bf72fdd14e21",
    organizationId: "fc0a2c8d-91bb-4323-9dd2-f4057067012d",
    displayName: "Platform operator",
    platformRole,
    platformAccessVersion: 1,
    role: platformRole === "student" ? "client" : platformRole,
  };
}

function getRpcClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schemaName) {
        assert.equal(schemaName, "platform");
        return {
          async rpc(functionName, args, options) {
            calls.push({ functionName, args, options });
            if (
              options?.get === true &&
              Object.values(args ?? {}).some((value) => value === null)
            ) {
              return {
                data: null,
                error: {
                  code: "22P02",
                  message: 'invalid input syntax for type uuid: "null"',
                },
              };
            }
            return { data: responses[functionName] ?? null, error: null };
          },
        };
      },
    },
  };
}

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
    sort_at: "2026-07-31T10:16:31.654321+06:00",
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
    waha_ack_name: null,
    waha_ack_observed_at: null,
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
      sortAt: "2026-07-31T10:16:31.654321+06:00",
    },
  );
  assert.equal(
    normalizePlatformConversationSummary(
      validConversationRow({ waha_session_name: "crm_primary" }),
    ).wahaSessionName,
    "crm_primary",
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
    media: [],
    wahaAckName: null,
    wahaAckObservedAt: null,
  });
});

test("rejects malformed PostgREST rows with one safe error", () => {
  const malformedRows = [
    validConversationRow({ queue: "finance" }),
    validConversationRow({ student_case_id: "not-a-uuid" }),
    validConversationRow({ amocrm_lead_id: Number.MAX_SAFE_INTEGER + 1 }),
    validConversationRow({ amocrm_lead_id: "9223372036854775808" }),
    validConversationRow({ created_at: "30 July 2026" }),
    validConversationRow({ sort_at: "31 July 2026" }),
    validConversationRow({ waha_session_name: "other" }),
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

test("accepts only complete deterministic communication cursors", () => {
  assert.deepEqual(
    parsePlatformConversationCursor(
      "2026-07-31T10:16:31.654321+06:00",
      CONVERSATION_ID,
    ),
    {
      sortAt: "2026-07-31T10:16:31.654321+06:00",
      id: CONVERSATION_ID.toLowerCase(),
    },
  );
  assert.equal(parsePlatformConversationCursor(undefined, CONVERSATION_ID), null);
  assert.equal(
    parsePlatformConversationCursor("2026-07-31T10:16:31Z", "not-a-uuid"),
    null,
  );
});

test("accepts only the two unified WAHA session names", () => {
  assert.equal(parsePlatformWahaSessionName("evo-inbox"), "evo-inbox");
  assert.equal(parsePlatformWahaSessionName("crm_primary"), "crm_primary");
  assert.equal(parsePlatformWahaSessionName(" evo-inbox "), null);
  assert.equal(parsePlatformWahaSessionName("other"), null);
  assert.equal(parsePlatformWahaSessionName(undefined), null);
});

test("conversation queue recency follows the latest persisted message", () => {
  const migration = readFileSync(PAGED_READ_MIGRATION_URL, "utf8");
  const communicationPage = migration.split(
    "CREATE OR REPLACE FUNCTION platform.staff_communication_page",
  )[1]?.split(
    "CREATE OR REPLACE FUNCTION platform.staff_communication_snapshot",
  )[0];
  assert.ok(communicationPage);
  assert.match(
    communicationPage,
    /SELECT message\.created_at[\s\S]*ORDER BY message\.created_at DESC, message\.id DESC/,
  );
  assert.doesNotMatch(communicationPage, /source_event\.received_at/);
});

test("conversation pages omit absent GET RPC filters so PostgREST applies SQL defaults", async () => {
  const repository = getRpcClient({
    staff_communication_page: [validConversationRow()],
  });

  const page = await listPlatformConversations(
    platformActor(),
    undefined,
    { client: repository.client },
  );

  assert.deepEqual(page, {
    rows: [
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
        sortAt: "2026-07-31T10:16:31.654321+06:00",
      },
    ],
    nextCursor: null,
    hasNext: false,
  });
  assert.deepEqual(repository.calls, [
    {
      functionName: "staff_communication_page",
      args: {
        p_organization_id: platformActor().organizationId,
        p_limit: 51,
      },
      options: { get: true },
    },
  ]);
});

test("message pages omit absent GET RPC cursors so PostgREST applies SQL defaults", async () => {
  const repository = getRpcClient({
    staff_communication_snapshot: [validConversationRow()],
    staff_conversation_message_page: [validMessageRow()],
  });

  const thread = await getPlatformConversationThread(
    platformActor(),
    CONVERSATION_ID,
    undefined,
    { client: repository.client },
  );

  assert.equal(thread?.conversation.id, CONVERSATION_ID.toLowerCase());
  assert.equal(thread?.messages.length, 1);
  assert.equal(thread?.messages[0]?.id, MESSAGE_ID);
  assert.deepEqual(repository.calls, [
    {
      functionName: "staff_communication_snapshot",
      args: {
        p_organization_id: platformActor().organizationId,
        p_conversation_id: CONVERSATION_ID.toLowerCase(),
      },
      options: { get: true },
    },
    {
      functionName: "staff_conversation_message_page",
      args: {
        p_organization_id: platformActor().organizationId,
        p_conversation_id: CONVERSATION_ID.toLowerCase(),
        p_limit: 101,
      },
      options: { get: true },
    },
  ]);
});

test("rejects finance and student actors before any repository read", async () => {
  await assert.rejects(
    () => listPlatformConversations(platformActor("finance")),
    PlatformCommunicationsRepositoryError,
  );
  await assert.rejects(
    () =>
      getPlatformConversationThread(platformActor("student"), "not-a-uuid"),
    PlatformCommunicationsRepositoryError,
  );
});

function validWorkflowRow(overrides = {}) {
  return {
    conversation_id: CONVERSATION_ID,
    latest_inbound_message_id: MESSAGE_ID,
    latest_inbound_body_text: "Какие документы нужны?",
    latest_inbound_language: "ru",
    latest_inbound_created_at: "2026-07-31T08:00:00Z",
    selected_knowledge_version_id: KNOWLEDGE_VERSION_ID,
    selected_knowledge_key: "admissions.documents",
    selected_knowledge_version: "12",
    selected_knowledge_title: "Required admissions documents",
    selected_knowledge_content_sha256: "a".repeat(64),
    ai_readiness: "ready",
    ai_readiness_evidence_kind: "provider_observed",
    ai_readiness_fresh: true,
    ai_readiness_observed_at: "2026-07-31T07:55:00Z",
    waha_readiness: "ready",
    waha_readiness_evidence_kind: "local_non_provider",
    waha_readiness_fresh: false,
    waha_readiness_observed_at: "2026-07-31T07:54:00Z",
    latest_ai_draft_request_id: DRAFT_REQUEST_ID,
    latest_ai_draft_request_created_at: "2026-07-31T08:01:00Z",
    latest_ai_draft_request_reason: "Prepare a grounded draft",
    latest_ai_draft_requested_language: null,
    latest_ai_draft_id: null,
    latest_ai_draft_state: null,
    latest_ai_draft_detection_status: null,
    latest_ai_draft_selected_language: null,
    latest_ai_draft_generated_text: null,
    latest_ai_draft_reviewed_text: null,
    latest_ai_draft_created_at: null,
    latest_ai_draft_updated_at: null,
    latest_ai_draft_failure_outcome: null,
    latest_manual_send_authorization_id: null,
    latest_manual_send_final_text: null,
    latest_manual_send_authorized_at: null,
    latest_outbox_work_item_id: null,
    latest_outbox_kind: null,
    latest_outbox_work_state: null,
    latest_outbox_attempt_count: null,
    latest_outbox_max_attempts: null,
    latest_outbox_available_at: null,
    latest_outbox_updated_at: null,
    latest_outbox_work_review_case_id: null,
    latest_outbox_work_review_status: null,
    latest_outbox_observation_kind: null,
    latest_outbox_observed_at: null,
    latest_audit_action: "ai.draft.request.knowledge",
    latest_audit_at: "2026-07-31T08:01:00Z",
    ...overrides,
  };
}

test("normalizes approved knowledge without losing bigint precision", () => {
  const item = normalizePlatformKnowledgeCatalogItem({
    knowledge_version_id: KNOWLEDGE_VERSION_ID,
    knowledge_key: " admissions.documents ",
    title: " Required documents ",
    version: "9223372036854775807",
    content_text: "Bring a passport and transcript.",
    content_sha256: "b".repeat(64),
    provenance_ref: "policy/admissions/documents",
    approved_at: "2026-07-31T07:00:00Z",
  });

  assert.equal(item.id, KNOWLEDGE_VERSION_ID);
  assert.equal(item.key, "admissions.documents");
  assert.equal(item.version, "9223372036854775807");
  assert.throws(
    () =>
      normalizePlatformKnowledgeCatalogItem({
        knowledge_version_id: KNOWLEDGE_VERSION_ID,
        knowledge_key: "admissions.documents",
        title: "Required documents",
        version: Number.MAX_SAFE_INTEGER + 1,
        content_text: "Bring a passport.",
        content_sha256: "b".repeat(64),
        provenance_ref: "policy/admissions/documents",
        approved_at: "2026-07-31T07:00:00Z",
      }),
    PlatformMessagingWorkflowError,
  );
});

test("keeps provider proof distinct from local integration evidence", () => {
  const workflow = normalizePlatformConversationWorkflow(
    validWorkflowRow(),
    CONVERSATION_ID,
  );

  assert.equal(workflow.integrations.aiProvider.readiness, "ready");
  assert.equal(workflow.integrations.aiProvider.providerProved, true);
  assert.equal(
    workflow.integrations.aiProvider.evidenceKind,
    "provider_observed",
  );
  assert.equal(
    workflow.integrations.waha.readiness,
    "configured_unverified",
  );
  assert.equal(workflow.integrations.waha.providerProved, false);
  assert.equal(workflow.draft?.state, "requested");
  assert.equal(workflow.health.draftPersisted, true);
  assert.equal(workflow.health.draftStaged, true);
  assert.equal(workflow.health.status, "in_progress");
  assert.equal(workflow.latestAuditAction, "ai.draft.request.knowledge");
});

test("accepts configured-but-unverified integration health from SQL", () => {
  const workflow = normalizePlatformConversationWorkflow(
    validWorkflowRow({
      ai_readiness: "configured_unverified",
      ai_readiness_evidence_kind: "configuration_check",
      ai_readiness_fresh: false,
      ai_readiness_observed_at: "2026-07-30T07:55:00Z",
      waha_readiness: "configured_unverified",
      waha_readiness_evidence_kind: "local_non_provider",
      waha_readiness_fresh: false,
      waha_readiness_observed_at: "2026-07-30T07:54:00Z",
    }),
    CONVERSATION_ID,
  );

  assert.equal(
    workflow.integrations.aiProvider.readiness,
    "configured_unverified",
  );
  assert.equal(
    workflow.integrations.aiProvider.evidenceKind,
    "configuration_check",
  );
  assert.equal(workflow.integrations.aiProvider.providerProved, false);
  assert.equal(
    workflow.integrations.waha.readiness,
    "configured_unverified",
  );
  assert.equal(
    workflow.integrations.waha.evidenceKind,
    "local_non_provider",
  );
  assert.equal(workflow.health.canRequestAiDraft, false);
  assert.equal(workflow.health.canAuthorizeManualSend, false);
});

test("keeps staff-written manual send available when AI is unavailable", () => {
  const workflow = normalizePlatformConversationWorkflow(
    validWorkflowRow({
      selected_knowledge_version_id: null,
      selected_knowledge_key: null,
      selected_knowledge_version: null,
      selected_knowledge_title: null,
      selected_knowledge_content_sha256: null,
      ai_readiness: "configured_unverified",
      ai_readiness_evidence_kind: "configuration_check",
      ai_readiness_fresh: false,
      latest_ai_draft_request_id: null,
      latest_ai_draft_request_created_at: null,
      latest_ai_draft_request_reason: null,
      latest_ai_draft_requested_language: null,
      waha_readiness: "ready",
      waha_readiness_evidence_kind: "provider_observed",
      waha_readiness_fresh: true,
    }),
    CONVERSATION_ID,
  );

  assert.equal(workflow.draft, null);
  assert.equal(workflow.integrations.aiProvider.providerProved, false);
  assert.equal(workflow.integrations.waha.providerProved, true);
  assert.equal(workflow.health.canRequestAiDraft, false);
  assert.equal(workflow.health.canAuthorizeManualSend, true);
});

test("downgrades expired provider observations without exposing private evidence", () => {
  const workflow = normalizePlatformConversationWorkflow(
    validWorkflowRow({
      ai_readiness: "configured_unverified",
      ai_readiness_evidence_kind: "provider_observed",
      ai_readiness_fresh: false,
    }),
    CONVERSATION_ID,
  );

  assert.equal(workflow.integrations.aiProvider.readiness, "configured_unverified");
  assert.equal(workflow.integrations.aiProvider.fresh, false);
  assert.equal(workflow.integrations.aiProvider.providerProved, false);
  assert.equal("reason" in workflow.integrations.aiProvider, false);
  assert.equal("evidenceRef" in workflow.integrations.aiProvider, false);
});

test("surfaces a failed AI generation outbox as operator attention", () => {
  const workflow = normalizePlatformConversationWorkflow(
    validWorkflowRow({
      latest_outbox_work_item_id: OUTBOX_WORK_ITEM_ID,
      latest_outbox_kind: "ai_draft_generate",
      latest_outbox_work_state: "dead_lettered",
      latest_outbox_attempt_count: 1,
      latest_outbox_max_attempts: 1,
      latest_outbox_available_at: "2026-07-31T08:01:00Z",
      latest_outbox_updated_at: "2026-07-31T08:02:00Z",
    }),
    CONVERSATION_ID,
  );

  assert.equal(workflow.outbox[0]?.kind, "ai_draft_generate");
  assert.equal(workflow.outbox[0]?.state, "dead_lettered");
  assert.equal(workflow.health.status, "attention_required");
});

test("treats a fully-null left-joined health group as unconfigured", () => {
  const workflow = normalizePlatformConversationWorkflow(
    validWorkflowRow({
      ai_readiness: null,
      ai_readiness_evidence_kind: null,
      ai_readiness_fresh: null,
      ai_readiness_observed_at: null,
      waha_readiness: null,
      waha_readiness_evidence_kind: null,
      waha_readiness_fresh: null,
      waha_readiness_observed_at: null,
    }),
    CONVERSATION_ID,
  );

  assert.deepEqual(workflow.integrations.aiProvider, {
    readiness: "unconfigured",
    evidenceKind: "none",
    fresh: false,
    providerProved: false,
    observedAt: null,
  });
  assert.deepEqual(
    workflow.integrations.waha,
    workflow.integrations.aiProvider,
  );
});

test("derives stable server request IDs and work business keys", () => {
  const organizationId = "fc0a2c8d-91bb-4323-9dd2-f4057067012d";
  const parts = [CONVERSATION_ID.toLowerCase(), DRAFT_REQUEST_ID];
  const first = derivePlatformSemanticRequestId(
    "review_ai_draft",
    organizationId,
    parts,
  );
  const replay = derivePlatformSemanticRequestId(
    "review_ai_draft",
    organizationId,
    parts,
  );
  const changed = derivePlatformSemanticRequestId(
    "review_ai_draft",
    organizationId,
    [...parts, "changed"],
  );
  const businessKey = derivePlatformBusinessKey([
    "manual_whatsapp_send",
    organizationId,
    DRAFT_REQUEST_ID,
  ]);

  assert.equal(first, replay);
  assert.notEqual(first, changed);
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.match(businessKey, /^[0-9a-f]{64}$/);
});

test("normalizes staff reasons and final message text at action boundaries", () => {
  assert.equal(normalizePlatformMutationReason("  retry safely  "), "retry safely");
  assert.equal(normalizePlatformMutationReason("no"), null);
  assert.equal(normalizePlatformMutationReason("x".repeat(501)), null);
  assert.equal(
    normalizePlatformMessageText("  Отправить после проверки.  "),
    "Отправить после проверки.",
  );
  assert.equal(normalizePlatformMessageText("x".repeat(5_001)), null);
});

test("manual messaging actions stay server-only and use authenticated RPCs", () => {
  const actionsSource = readFileSync(
    new URL("../src/lib/platform-messaging-actions.ts", import.meta.url),
    "utf8",
  );

  assert.match(actionsSource, /^"use server";/);
  assert.equal(
    actionsSource.match(/await requirePlatformMessagingActor\(\)/g)?.length,
    3,
  );
  assert.match(actionsSource, /\.rpc\("request_ai_draft_with_knowledge"/);
  assert.match(actionsSource, /\.rpc\("review_ai_draft"/);
  assert.match(
    actionsSource,
    /\.rpc\("request_manual_whatsapp_send_with_authorization"/,
  );
  assert.match(actionsSource, /revalidatePath\("\/whatsapp"\)/);
  assert.match(
    actionsSource,
    /latestInbound\?\.\s*id\s*!==\s*sourceMessageId/,
  );
  assert.match(actionsSource, /p_conversation_id:\s*conversationId/);
  assert.match(actionsSource, /p_source_message_id:\s*sourceMessageId/);
  assert.doesNotMatch(
    actionsSource,
    /workflow\.health\.can(?:RequestAiDraft|ReviewAiDraft|AuthorizeManualSend)/,
  );
  assert.doesNotMatch(actionsSource, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(actionsSource, /better-sqlite3|@anthropic-ai|waha.*send/i);
});

test("manual-send text keeps an explicit accessible label", () => {
  const panelSource = readFileSync(
    new URL(
      "../src/components/platform/communications/PlatformMessagingWorkflowPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    panelSource,
    /<label htmlFor="platform-manual-send-text"[^>]*>[\s\S]*?platformManualSendMessage[\s\S]*?<\/label>/,
  );
  assert.match(
    panelSource,
    /<textarea[\s\S]*?id="platform-manual-send-text"[\s\S]*?name="finalText"/,
  );
  assert.match(
    panelSource,
    /latestInboundMessageId !== null && !workflow\.manualSend/,
  );
  assert.match(
    panelSource,
    /draft\?\.aiDraftId && draft\.state === "ready_for_manual_send"/,
  );
});

test("local browser handoff refreshes expiring synthetic AI readiness", () => {
  const authHookSource = readFileSync(
    new URL("../scripts/test-supabase-auth-hook.mjs", import.meta.url),
    "utf8",
  );
  const browserSpecSource = readFileSync(
    new URL("./platform-auth/platform-auth.spec.ts", import.meta.url),
    "utf8",
  );
  const browserHandoff = authHookSource.slice(
    authHookSource.indexOf("if (browserFixturePath)"),
  );

  assert.match(
    browserHandoff,
    /recordHealthEvent\(\{[\s\S]*?organizationId: adminBMembership\.organization_id,[\s\S]*?target: "ai",[\s\S]*?readiness: "ready",[\s\S]*?evidenceKind: "provider_observed",[\s\S]*?stage: "p3c-org-b-ai-browser-ready"[\s\S]*?\}\);[\s\S]*?writeFileSync\(/,
  );
  const languageScenarioIndex = browserSpecSource.indexOf(
    'test("RU and EN draft requests work while uncertain language stops for manual selection"',
  );
  assert.ok(languageScenarioIndex > 0);
  assert.equal(languageScenarioIndex, browserSpecSource.indexOf('test("'));
});
