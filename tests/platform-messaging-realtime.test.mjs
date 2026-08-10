import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformCommunicationsRepositoryError,
  normalizePlatformConversationMessage,
  normalizePlatformWahaSessionHealth,
} from "../src/lib/platform-communications.ts";
import {
  getWahaAckPresentation,
  getWahaSessionHealthPresentation,
} from "../src/components/platform/communications/whatsapp-state.ts";

const MESSAGE_ID = "7be22cc5-0316-4bbc-9d91-e3d1d5775ddb";
const CONVERSATION_ID = "a120b6db-2e3e-4a84-8873-073f4d2d33c3";

function validMessageRow(overrides = {}) {
  return {
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    direction: "outbound",
    body_text: "We will contact you shortly.",
    language: "en",
    student_visible: true,
    waha_session_name: "evo-inbox",
    waha_message_id: null,
    kommo_account_id: null,
    kommo_conversation_id: null,
    kommo_message_id: null,
    amocrm_account_id: null,
    amocrm_lead_id: null,
    amocrm_contact_id: null,
    created_at: "2026-08-10T08:00:00Z",
    media: [],
    waha_ack_name: "READ",
    waha_ack_observed_at: "2026-08-10T08:01:00Z",
    ...overrides,
  };
}

test("accepts only complete outbound public ACK pairs", () => {
  const message = normalizePlatformConversationMessage(validMessageRow());
  assert.equal(message.wahaAckName, "READ");
  assert.equal(message.wahaAckObservedAt, "2026-08-10T08:01:00Z");

  for (const ackName of [
    "ERROR",
    "PENDING",
    "SERVER",
    "DEVICE",
    "READ",
    "PLAYED",
  ]) {
    assert.equal(
      normalizePlatformConversationMessage(
        validMessageRow({ waha_ack_name: ackName }),
      ).wahaAckName,
      ackName,
    );
  }

  for (const malformed of [
    validMessageRow({ waha_ack_name: "UNKNOWN" }),
    validMessageRow({ waha_ack_name: null, waha_ack_observed_at: "2026-08-10T08:01:00Z" }),
    validMessageRow({ waha_ack_name: "READ", waha_ack_observed_at: null }),
    validMessageRow({ direction: "inbound" }),
    validMessageRow({ waha_ack_observed_at: "10 August 2026" }),
    validMessageRow({ waha_ack_name: undefined }),
  ]) {
    assert.throws(
      () => normalizePlatformConversationMessage(malformed),
      PlatformCommunicationsRepositoryError,
    );
  }

  assert.deepEqual(
    normalizePlatformConversationMessage(
      validMessageRow({ waha_ack_name: null, waha_ack_observed_at: null }),
    ),
    {
      ...normalizePlatformConversationMessage(validMessageRow()),
      wahaAckName: null,
      wahaAckObservedAt: null,
    },
  );
});

test("normalizes only the bounded current WAHA session health tuple", () => {
  assert.deepEqual(
    normalizePlatformWahaSessionHealth({
      waha_session_name: "evo-inbox",
      status: "WORKING",
      observed_at: "2026-08-10T08:01:00Z",
    }),
    {
      sessionName: "evo-inbox",
      status: "WORKING",
      observedAt: "2026-08-10T08:01:00Z",
    },
  );

  for (const malformed of [
    { waha_session_name: "other", status: "WORKING", observed_at: "2026-08-10T08:01:00Z" },
    { waha_session_name: "evo-inbox", status: "working", observed_at: "2026-08-10T08:01:00Z" },
    { waha_session_name: "evo-inbox", status: "WORKING", observed_at: "invalid" },
  ]) {
    assert.throws(
      () => normalizePlatformWahaSessionHealth(malformed),
      PlatformCommunicationsRepositoryError,
    );
  }
});

test("maps safe ACK and WAHA health states truthfully", () => {
  assert.deepEqual(getWahaAckPresentation("ERROR"), {
    labelKey: "platformWahaAckError",
    tone: "danger",
  });
  assert.deepEqual(getWahaAckPresentation("READ"), {
    labelKey: "platformWahaAckRead",
    tone: "ok",
  });
  assert.deepEqual(getWahaAckPresentation(null), {
    labelKey: "platformWahaAckUnknown",
    tone: "warning",
  });
  assert.deepEqual(getWahaSessionHealthPresentation("WORKING"), {
    labelKey: "platformWahaSessionWorking",
    tone: "ok",
  });
  assert.deepEqual(getWahaSessionHealthPresentation("CONNECTING"), {
    labelKey: "platformWahaSessionTransitioning",
    tone: "warning",
  });
  assert.deepEqual(getWahaSessionHealthPresentation("FAILED"), {
    labelKey: "platformWahaSessionUnhealthy",
    tone: "danger",
  });
  assert.deepEqual(getWahaSessionHealthPresentation("UNRECOGNIZED"), {
    labelKey: "platformWahaSessionUnknown",
    tone: "danger",
  });
});

test("uses a private invalidation-only Realtime channel with reconnect fallback and cleanup", () => {
  const realtime = readFileSync(
    new URL(
      "../src/components/platform/communications/PlatformMessagingRealtime.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const repository = readFileSync(
    new URL("../src/lib/platform-communications.ts", import.meta.url),
    "utf8",
  );
  const listPage = readFileSync(
    new URL("../src/app/(staff)/whatsapp/page.tsx", import.meta.url),
    "utf8",
  );
  const threadPage = readFileSync(
    new URL("../src/app/(staff)/whatsapp/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const threadView = readFileSync(
    new URL(
      "../src/components/platform/communications/PlatformConversationView.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(realtime, /createSupabaseBrowserClient\(\)/);
  assert.match(realtime, /channel\(`platform-messaging:\$\{organizationId\}`/);
  assert.match(realtime, /config:\s*\{\s*private:\s*true\s*\}/);
  assert.match(realtime, /\.on\("broadcast",\s*\{\s*event:\s*"invalidate"\s*\},\s*\(\)\s*=>\s*refresh\(\)\)/);
  assert.match(realtime, /status === "SUBSCRIBED"/);
  assert.match(realtime, /data-testid="platform-messaging-realtime"/);
  assert.match(realtime, /data-realtime-state=\{realtimeState\}/);
  assert.match(realtime, /document\.addEventListener\("visibilitychange"/);
  assert.match(realtime, /!connected && document\.visibilityState === "visible"/);
  assert.match(realtime, /clearInterval\(fallbackTimer\)/);
  assert.match(realtime, /clearTimeout\(refreshTimer\)/);
  assert.match(realtime, /removeEventListener\("visibilitychange"/);
  assert.match(realtime, /client\.removeChannel\(channel\)/);
  assert.doesNotMatch(realtime, /payload|postgres_changes|\.send\(/);

  assert.match(repository, /\.rpc\("staff_waha_session_health"/);
  assert.match(repository, /p_organization_id: organizationId/);
  assert.match(listPage, /PlatformMessagingRealtime organizationId=\{actor\.organizationId\}/);
  assert.match(threadPage, /PlatformMessagingRealtime organizationId=\{actor\.organizationId\}/);
  assert.doesNotMatch(listPage, /AutoRefresh/);
  assert.match(threadView, /data-session-status=\{wahaSessionHealth\?\.status \?\? "UNKNOWN"\}/);
  assert.match(threadView, /data-waha-ack-name=/);
  assert.match(threadView, /platformConversationId/);
  assert.match(threadView, /platformStudentCase/);
  assert.match(threadView, /platformWahaSession/);
  assert.doesNotMatch(threadView, /AutoRefresh|data-message-id/);
});
