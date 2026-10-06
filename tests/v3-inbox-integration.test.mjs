import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildV3InboxHref } from "../src/lib/v3/inbox-href.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 Inbox reads one URL-selected canonical chat; older messages load inside the chat", () => {
  const adapter = source("src/lib/v3/inbox-source.ts");
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const inbox = source("src/components/v3/Inbox.tsx");
  const chat = source("src/components/v3/inbox/InboxChat.tsx");

  assert.match(adapter, /listPlatformConversations\(actor,/u);
  // 06.10.2026: the queue filter of the role preview lives in inbox-access.ts
  // (behaviour: platform-whatsapp-team-inbox.test.mjs).
  assert.match(adapter, /const presentationQueue = inboxPresentationQueue\(actor\);/u);
  assert.match(adapter, /queue: presentationQueue/u);
  assert.match(adapter, /resolvedThread\.conversation\.queue === presentationQueue/u);
  assert.match(adapter, /getPlatformWhatsAppThread\(actor, options\.conversationId,/u);
  assert.match(
    adapter,
    /getPlatformConversationCommandContext\(actor, thread\.conversation\.id\)/u,
  );
  // The reply source is the chat state's latest customer message, on every page.
  assert.match(adapter, /latestInboundMessageId: state\.latestInboundMessageId/u);
  assert.match(adapter, /query: options\.query \?\? undefined/u);
  assert.match(adapter, /waitingOnly: options\.waitingOnly/u);
  assert.match(adapter, /buildV3InboxHref/u);

  assert.match(page, /conversation\?: string \| string\[\]/u);
  assert.match(page, /parsePlatformRouteUuid/u);
  assert.match(page, /parsePlatformConversationCursor/u);
  assert.match(page, /conversationId === null && messageCursor !== null/u);
  assert.match(page, /conversationId !== null && messageCursor !== null\) \{\s*redirect\(/u, "an old message-page link opens the chat");
  assert.match(page, /conversationId !== null && view\.selected === null/u);
  assert.match(page, /q\?: string \| string\[\]/u);
  assert.match(page, /waiting\?: string \| string\[\]/u);
  assert.match(page, /value !== "1"/u);
  assert.match(page, /normalized\.length > 200/u);
  assert.match(page, /if \(Array\.isArray\(value\)\) notFound\(\)/u);
  assert.match(
    page,
    /if \(Object\.keys\(params\)\.some\(\(key\) => !allowed\.has\(key\)\)\) notFound\(\)/u,
  );
  assert.match(
    page,
    /if \(sortAt === undefined \|\| id === undefined\) notFound\(\)/u,
  );
  // The list and its pages stay server links; the chat is the one client island.
  assert.doesNotMatch(inbox, /useState|onClick=/u);
  assert.match(inbox, /href=\{conversation\.href\}/u);
  assert.match(inbox, /href=\{view\.queueOlderHref\}/u);
  assert.match(inbox, /<InboxChat\s+key=\{open\.id\}/u);
  assert.match(chat, /\/api\/v3\/inbox\/conversations\/\$\{conversationId\}\/messages\?/u);
  assert.match(chat, /Показать ранее/u);
});

test("V3 Inbox href preserves filters and both cursor pairs behaviorally", () => {
  const href = buildV3InboxHref({
    filters: { query: "Иван Петров", waitingOnly: true },
    queueCursor: {
      sortAt: "2026-09-07T09:00:00.000Z",
      id: "62000000-0000-4000-8000-000000000001",
    },
    conversationId: "62000000-0000-4000-8000-000000000002",
    messageCursor: {
      sortAt: "2026-09-07T08:00:00.000Z",
      id: "62000000-0000-4000-8000-000000000003",
    },
  });

  assert.equal(
    href,
    "/v3/inbox?q=%D0%98%D0%B2%D0%B0%D0%BD+%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2&waiting=1&before_at=2026-09-07T09%3A00%3A00.000Z&before_id=62000000-0000-4000-8000-000000000001&conversation=62000000-0000-4000-8000-000000000002&messages_before_at=2026-09-07T08%3A00%3A00.000Z&messages_before_id=62000000-0000-4000-8000-000000000003",
  );
});

test("V3 Inbox href produces q-only, waiting-toggle and newest states", () => {
  assert.equal(
    buildV3InboxHref({
      filters: { query: "Анна", waitingOnly: false },
    }),
    "/v3/inbox?q=%D0%90%D0%BD%D0%BD%D0%B0",
  );
  assert.equal(
    buildV3InboxHref({
      filters: { query: "Анна", waitingOnly: true },
    }),
    "/v3/inbox?q=%D0%90%D0%BD%D0%BD%D0%B0&waiting=1",
  );
  assert.equal(
    buildV3InboxHref({
      filters: { query: null, waitingOnly: true },
      conversationId: "62000000-0000-4000-8000-000000000002",
    }),
    "/v3/inbox?waiting=1&conversation=62000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    buildV3InboxHref({ filters: { query: null, waitingOnly: false } }),
    "/v3/inbox",
  );
});

test("V3 Inbox search and waiting UI use the server waiting_since projection", () => {
  const adapter = source("src/lib/v3/inbox-source.ts");
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(adapter, /summary\.waitingSince/u);
  assert.match(adapter, /formatWaitingRu\(summary\.waitingSince\)/u);
  assert.doesNotMatch(adapter, /function awaitingReplyFor/u);
  assert.match(adapter, /waitingToggleHref/u);
  assert.match(inbox, /name="q"/u);
  assert.match(inbox, /name="waiting" value="1"/u);
  assert.match(inbox, /Только ждут ответа/u);
  assert.match(inbox, /Ждёт ответа с \{conversation\.waitingSince\}/u);
  assert.match(inbox, /Ждёт ответа\{open\.awaitingReplyFor \? ` · \$\{open\.awaitingReplyFor\}` : ""\}/u);
  assert.doesNotMatch(`${adapter}\n${inbox}`, /lastMessageAt.*formatWaitingRu/su);
});

test("V3 Inbox loads exact-audience reply snippets only for a chat the member may answer", () => {
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const picker = source("src/components/v3/reply-snippets/ReplySnippetPicker.tsx");

  assert.match(page, /if \(view\.selected\)[\s\S]*canReply \? readSnippets\(actor\)/u);
  assert.match(page, /if \(!staffPresentationCan\(actor, "messaging\.send"\)\) return null;\s*const snippets = await readV3ReplySnippets\(actor\);/u);
  assert.match(page, /\(\{ replySnippetId, title, body \}\) => \(\{ replySnippetId, title, body \}\)/u);
  assert.match(page, /replySnippets=\{replySnippets\}/u);
  assert.match(picker, /type="button"/u);
  assert.match(picker, /role="alert"/u);
  assert.doesNotMatch(picker, /sendPlatform|type="submit"|form action/u);
});

test("V3 Inbox surfaces current WhatsApp readiness without a channel setup flow", () => {
  const adapter = source("src/lib/v3/inbox-source.ts");
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(adapter, /wahaSessionName === "crm_primary"/u);
  assert.match(adapter, /getPlatformWahaSessionHealth\(actor, "crm_primary"\)/u);
  assert.match(adapter, /isFreshWorkingWahaSession/u);
  assert.match(inbox, /WhatsApp подключён/u);
  assert.match(inbox, /WhatsApp требует проверки/u);
  assert.match(inbox, /Состояние WhatsApp не подтверждено/u);
  assert.doesNotMatch(inbox, /WAHA|crm_primary|QR|подключить канал/iu);
});
