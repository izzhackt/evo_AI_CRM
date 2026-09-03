import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePlatformConversationMessage,
  normalizePlatformConversationSummary,
  parsePlatformWahaSessionName,
  PlatformCommunicationsRepositoryError,
} from "../src/lib/platform-communications.ts";
import {
  platformWahaHealthDisplayStatus,
  readPlatformGeminiProviderAvailability,
} from "../src/lib/server/platform-provider-readiness.ts";

test("current WAHA paths accept crm_primary and reject the historical inbox session", () => {
  assert.equal(parsePlatformWahaSessionName("crm_primary"), "crm_primary");
  assert.equal(parsePlatformWahaSessionName("evo-inbox"), null);
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
