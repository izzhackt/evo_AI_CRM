import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getPlatformConversationCommandContext,
  normalizePlatformConversationCommandContext,
  normalizePlatformConversationMessage,
  normalizePlatformConversationSummary,
  parsePlatformWahaSessionName,
  PlatformCommunicationsRepositoryError,
} from "../src/lib/platform-communications.ts";
import {
  platformWahaHealthDisplayStatus,
  readPlatformGeminiProviderAvailability,
} from "../src/lib/server/platform-provider-readiness.ts";

const COMMAND_CONTEXT_IDS = Object.freeze({
  organization: "54600000-0000-4000-8000-000000000001",
  authUser: "54600000-0000-4000-8000-000000000002",
  profile: "54600000-0000-4000-8000-000000000003",
  membership: "54600000-0000-4000-8000-000000000004",
  bundle: "54600000-0000-4000-8000-000000000005",
  conversation: "54600000-0000-4000-8000-000000000006",
  lead: "54600000-0000-4000-8000-000000000007",
  client: "54600000-0000-4000-8000-000000000008",
  studentCase: "54600000-0000-4000-8000-000000000009",
});

const commandContextActor = Object.freeze({
  authUserId: COMMAND_CONTEXT_IDS.authUser,
  profileId: COMMAND_CONTEXT_IDS.profile,
  membershipId: COMMAND_CONTEXT_IDS.membership,
  organizationId: COMMAND_CONTEXT_IDS.organization,
  displayName: "Sales User",
  email: "sales@example.test",
  platformRole: "sales",
  authorityRole: "sales",
  presentationRole: "sales",
  platformAccessVersion: 1,
  platformBundleId: COMMAND_CONTEXT_IDS.bundle,
  platformBundleVersion: 1,
});

function commandContextClient(data, error = null) {
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

function validCommandContextRow(overrides = {}) {
  return {
    conversation_id: COMMAND_CONTEXT_IDS.conversation,
    canonical_lead_id: COMMAND_CONTEXT_IDS.lead,
    canonical_client_id: COMMAND_CONTEXT_IDS.client,
    student_case_id: COMMAND_CONTEXT_IDS.studentCase,
    ...overrides,
  };
}

test("current WAHA paths accept crm_primary and reject the historical inbox session", () => {
  assert.equal(parsePlatformWahaSessionName("crm_primary"), "crm_primary");
  assert.equal(parsePlatformWahaSessionName("evo-inbox"), null);
});

test("selected conversation command context exposes only exact stored canonical bindings", async () => {
  const recorded = commandContextClient([validCommandContextRow()]);

  const context = await getPlatformConversationCommandContext(
    commandContextActor,
    COMMAND_CONTEXT_IDS.conversation.toUpperCase(),
    { client: recorded.client },
  );

  assert.deepEqual(recorded.calls, [
    { kind: "schema", schema: "platform" },
    {
      kind: "rpc",
      functionName: "staff_communication_command_context",
      args: {
        p_organization_id: COMMAND_CONTEXT_IDS.organization,
        p_conversation_id: COMMAND_CONTEXT_IDS.conversation,
      },
      options: { get: true },
    },
  ]);
  assert.deepEqual(context, {
    conversationId: COMMAND_CONTEXT_IDS.conversation,
    canonicalLeadId: COMMAND_CONTEXT_IDS.lead,
    canonicalClientId: COMMAND_CONTEXT_IDS.client,
    studentCaseId: COMMAND_CONTEXT_IDS.studentCase,
  });
  assert.equal(Object.isFrozen(context), true);
});

test("selected conversation command context keeps missing canonical scope explicit", async () => {
  assert.deepEqual(
    normalizePlatformConversationCommandContext(validCommandContextRow({
      canonical_lead_id: null,
      canonical_client_id: null,
      student_case_id: null,
    })),
    {
      conversationId: COMMAND_CONTEXT_IDS.conversation,
      canonicalLeadId: null,
      canonicalClientId: null,
      studentCaseId: null,
    },
  );

  const absent = commandContextClient([]);
  assert.equal(
    await getPlatformConversationCommandContext(
      commandContextActor,
      COMMAND_CONTEXT_IDS.conversation,
      { client: absent.client },
    ),
    null,
  );
});

test("selected conversation command context fails closed on malformed or mismatched rows", async () => {
  for (const row of [
    validCommandContextRow({ canonical_lead_id: "900001" }),
    validCommandContextRow({ canonical_client_id: undefined }),
    { ...validCommandContextRow(), unexpected_key: "drift" },
    validCommandContextRow({ conversation_id: COMMAND_CONTEXT_IDS.lead }),
  ]) {
    const recorded = commandContextClient([row]);
    await assert.rejects(
      getPlatformConversationCommandContext(
        commandContextActor,
        COMMAND_CONTEXT_IDS.conversation,
        { client: recorded.client },
      ),
      PlatformCommunicationsRepositoryError,
    );
  }

  const providerFailure = commandContextClient(null, { message: "private" });
  await assert.rejects(
    getPlatformConversationCommandContext(
      commandContextActor,
      COMMAND_CONTEXT_IDS.conversation,
      { client: providerFailure.client },
    ),
    PlatformCommunicationsRepositoryError,
  );
});

test("communication command projection is authenticated, role-scoped and provider-id free", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/106_platform_communication_command_context.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /platform_private\.require_domain_actor_read\(/);
  assert.match(migration, /platform\.current_actor_authority\(\)/);
  assert.match(migration, /private\.platform_can_read_communication_full\(/);
  assert.match(migration, /conversation\.canonical_lead_id/);
  assert.match(migration, /conversation\.canonical_client_id/);
  assert.match(migration, /conversation\.student_case_id/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE[\s\S]*TO authenticated;/,
  );
  assert.doesNotMatch(migration, /conversation\.(?:amo|kommo|waha)_/);
});

test("projections preserve immutable session evidence while active selection remains crm_primary-only", () => {
  const conversation = {
    conversation_id: "54600000-0000-4000-8000-000000000007",
    student_case_id: null,
    queue: "sales",
    status: "open",
    subject: "Provider boundary proof",
    waha_session_name: "crm_primary",
    kommo_account_id: null,
    kommo_conversation_id: null,
    amocrm_account_id: null,
    amocrm_lead_id: null,
    amocrm_contact_id: null,
    created_at: "2026-09-03T12:00:00.000Z",
    sort_at: "2026-09-03T12:00:00.000Z",
  };
  const message = {
    message_id: "54600000-0000-4000-8000-000000000008",
    conversation_id: conversation.conversation_id,
    direction: "inbound",
    body_text: "Provider boundary proof",
    language: "en",
    student_visible: false,
    waha_session_name: "crm_primary",
    waha_message_id: "provider-boundary-proof",
    kommo_account_id: null,
    kommo_conversation_id: null,
    kommo_message_id: null,
    amocrm_account_id: null,
    amocrm_lead_id: null,
    amocrm_contact_id: null,
    created_at: "2026-09-03T12:00:00.000Z",
    media: [],
    waha_ack_name: null,
    waha_ack_observed_at: null,
  };

  assert.equal(
    normalizePlatformConversationSummary(conversation).wahaSessionName,
    "crm_primary",
  );
  assert.equal(
    normalizePlatformConversationMessage(message).wahaSessionName,
    "crm_primary",
  );
  assert.equal(
    normalizePlatformConversationSummary({
      ...conversation,
      waha_session_name: "evo-inbox",
    }).wahaSessionName,
    "evo-inbox",
  );
  assert.equal(
    normalizePlatformConversationMessage({
      ...message,
      waha_session_name: "evo-inbox",
    }).wahaSessionName,
    "evo-inbox",
  );
  assert.throws(
    () =>
      normalizePlatformConversationSummary({
        ...conversation,
        waha_session_name: "unknown-session",
      }),
    PlatformCommunicationsRepositoryError,
  );
  assert.throws(
    () =>
      normalizePlatformConversationMessage({
        ...message,
        waha_session_name: "unknown-session",
      }),
    PlatformCommunicationsRepositoryError,
  );
});

test("Gemini readiness uses only the one server-side platform key", () => {
  assert.deepEqual(readPlatformGeminiProviderAvailability({}), {
    status: "blocked",
    reason: "configuration_missing",
  });
  assert.deepEqual(
    readPlatformGeminiProviderAvailability({
      EVO_PLATFORM_GEMINI_API_KEY: " short-or-padded-secret ",
      EVO_V2_GEMINI_API_KEY: "legacy-key-that-must-not-count",
    }),
    { status: "blocked", reason: "configuration_invalid" },
  );
  assert.deepEqual(
    readPlatformGeminiProviderAvailability({
      EVO_PLATFORM_GEMINI_API_KEY: "platform-test-key-1234567890",
    }),
    { status: "configured" },
  );
});

test("WhatsApp readiness comes from the exact Supabase session health", () => {
  const nowMs = Date.parse("2026-09-02T10:00:00Z");
  assert.equal(platformWahaHealthDisplayStatus(null), "not_configured");
  assert.equal(
    platformWahaHealthDisplayStatus({
      sessionName: "crm_primary",
      status: "WORKING",
      observedAt: "2026-09-02T10:00:00Z",
    }, nowMs),
    "ready",
  );
  assert.equal(
    platformWahaHealthDisplayStatus({
      sessionName: "crm_primary",
      status: "STOPPED",
      observedAt: "2026-09-02T10:00:00Z",
    }, nowMs),
    "blocked",
  );
  assert.equal(
    platformWahaHealthDisplayStatus({
      sessionName: "crm_primary",
      status: "WORKING",
      observedAt: "2026-09-02T09:54:59Z",
    }, nowMs),
    "blocked",
  );
  assert.equal(
    platformWahaHealthDisplayStatus({
      sessionName: "crm_primary",
      status: "WORKING",
      observedAt: "2026-09-02T10:01:01Z",
    }, nowMs),
    "blocked",
  );
});
