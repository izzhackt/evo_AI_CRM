import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const QUEUE_CURSOR_ID = "44444444-4444-4444-8444-444444444444";
const MESSAGE_CURSOR_ID = "55555555-5555-4555-8555-555555555555";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("staff WhatsApp pages use only the authenticated Platform communication read model", () => {
  const listPage = source("src/app/(staff)/whatsapp/page.tsx");
  const threadPage = source("src/app/(staff)/whatsapp/[id]/page.tsx");

  for (const page of [listPage, threadPage]) {
    assert.match(page, /requirePlatformMessagingActor\(\)/);
    assert.match(page, /@\/lib\/platform-communications/);
    assert.match(page, /PlatformStaffWhatsAppWorkspace/);
    assert.doesNotMatch(page, /canonical-crm-repository/);
    assert.doesNotMatch(page, /CanonicalStaffWhatsApp/);
  }

  assert.match(
    listPage,
    /listPlatformConversations\(actor,\s*\{[\s\S]*?cursor,?[\s\S]*?pageSize:\s*50/,
  );
  assert.match(threadPage, /getPlatformConversationThread\(actor,/);
  assert.match(threadPage, /getPlatformWahaSessionHealth\(actor,\s*"evo-inbox"\)/);
  assert.match(threadPage, /listPlatformConversations\(actor,/);
  assert.match(threadPage, /parsePlatformRouteUuid\(id\)/);
  assert.match(threadPage, /if \([^\n]*=== null\) notFound\(\)/);

  for (const page of [listPage, threadPage]) {
    assert.match(page, /parsePlatformConversationCursor/);
    assert.match(page, /if \(cursor === null\) notFound\(\)/);
    assert.match(page, /before_at:\s*cursor\.sortAt/);
    assert.match(page, /before_id:\s*cursor\.id/);
    assert.doesNotMatch(page, /\.updatedAt|\.occurredAt/);
  }
});

test("Platform WhatsApp workspace keeps queue, thread, pagination, locale, and workflow controls without exposing provider identifiers", async () => {
  const { PlatformStaffWhatsAppWorkspace } = await import(
    "../src/components/platform/communications/PlatformStaffWhatsApp.tsx"
  );

  const conversation = {
    id: CONVERSATION_ID,
    studentCaseId: CASE_ID,
    queue: "sales",
    status: "open",
    subject: "Amina Student",
    wahaSessionName: "evo-inbox",
    kommoAccountId: "SECRET-KOMMO-ACCOUNT",
    kommoConversationId: "SECRET-KOMMO-CONVERSATION",
    amocrmAccountId: "SECRET-AMO-ACCOUNT",
    amocrmLeadId: "SECRET-AMO-LEAD",
    amocrmContactId: "SECRET-AMO-CONTACT",
    createdAt: "2026-09-01T08:00:00Z",
    sortAt: "2026-09-02T09:00:00Z",
  };
  const message = {
    id: MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    direction: "inbound",
    bodyText: "Can you help with my application?",
    language: "en",
    studentVisible: true,
    wahaSessionName: "SECRET-MESSAGE-SESSION",
    wahaMessageId: "SECRET-WAHA-MESSAGE",
    kommoAccountId: "SECRET-MESSAGE-KOMMO-ACCOUNT",
    kommoConversationId: "SECRET-MESSAGE-KOMMO-CONVERSATION",
    kommoMessageId: "SECRET-KOMMO-MESSAGE",
    amocrmAccountId: "SECRET-MESSAGE-AMO-ACCOUNT",
    amocrmLeadId: "SECRET-MESSAGE-AMO-LEAD",
    amocrmContactId: "SECRET-MESSAGE-AMO-CONTACT",
    createdAt: "2026-09-02T08:59:00Z",
    media: [],
    wahaAckName: null,
    wahaAckObservedAt: null,
  };
  const queueCursor = {
    sortAt: "2026-09-01T09:00:00Z",
    id: QUEUE_CURSOR_ID,
  };
  const queueQuery = new URLSearchParams({
    before_at: queueCursor.sortAt,
    before_id: queueCursor.id,
  }).toString();
  const messageQuery = new URLSearchParams({
    before_at: queueCursor.sortAt,
    before_id: queueCursor.id,
    messages_before_at: "2026-09-01T07:00:00Z",
    messages_before_id: MESSAGE_CURSOR_ID,
  }).toString();

  const markup = renderToStaticMarkup(
    React.createElement(PlatformStaffWhatsAppWorkspace, {
      locale: "en",
      actorRole: "admin",
      conversations: [conversation],
      queueCursor,
      queueResetHref: "/whatsapp",
      queueNextHref: `/whatsapp?${queueQuery}`,
      selectedConversationId: CONVERSATION_ID,
      thread: {
        conversation,
        messages: [message],
        wahaSessionHealth: {
          sessionName: "evo-inbox",
          status: "WORKING",
          observedAt: "2026-09-02T09:01:00Z",
        },
        newestMessagesHref: `/whatsapp/${CONVERSATION_ID}?${queueQuery}`,
        olderMessagesHref: `/whatsapp/${CONVERSATION_ID}?${messageQuery}`,
      },
      workflowControls: React.createElement(
        "section",
        { "data-testid": "workflow-controls" },
        "Review and send controls",
      ),
    }),
  );

  assert.match(markup, /data-testid="platform-staff-whatsapp-page"/);
  assert.match(markup, /data-testid="platform-staff-whatsapp-thread"/);
  assert.match(markup, /Amina Student/);
  assert.match(markup, /Can you help with my application\?/);
  assert.match(markup, /Review and send controls/);
  assert.match(markup, /Newest conversations/);
  assert.match(markup, /Older conversations/);
  assert.match(markup, /Newest messages/);
  assert.match(markup, /Older messages/);
  assert.match(markup, new RegExp(QUEUE_CURSOR_ID));
  assert.match(markup, new RegExp(MESSAGE_CURSOR_ID));

  for (const secret of [
    "evo-inbox",
    "SECRET-KOMMO-ACCOUNT",
    "SECRET-KOMMO-CONVERSATION",
    "SECRET-AMO-ACCOUNT",
    "SECRET-AMO-LEAD",
    "SECRET-AMO-CONTACT",
    "SECRET-MESSAGE-SESSION",
    "SECRET-WAHA-MESSAGE",
    "SECRET-MESSAGE-KOMMO-ACCOUNT",
    "SECRET-MESSAGE-KOMMO-CONVERSATION",
    "SECRET-KOMMO-MESSAGE",
    "SECRET-MESSAGE-AMO-ACCOUNT",
    "SECRET-MESSAGE-AMO-LEAD",
    "SECRET-MESSAGE-AMO-CONTACT",
  ]) {
    assert.doesNotMatch(markup, new RegExp(secret));
  }
});
