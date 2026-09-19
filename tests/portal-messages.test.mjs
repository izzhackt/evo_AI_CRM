import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  mergePortalCaseMessages,
  parsePortalCaseMessage,
  parsePortalCaseMessagePostReceipt,
  parsePortalCaseMessagesPage,
} from "../src/lib/portal/messages.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { isConnectedStudentPortalPage } from "../src/lib/platform-route-contract.ts";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const message = (n, overrides = {}) => ({
  id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  sequenceId: String(n),
  mine: n % 2 === 0,
  authorName: n % 2 === 0 ? "Студент" : "Куратор EVO",
  body: `Сообщение ${n}`,
  createdAt: "2026-09-19T10:00:00+00:00",
  attachmentKind: null,
  attachmentLabel: null,
  quotedBodyPreview: null,
  ...overrides,
});

test("the page parser accepts the exact RPC shape and fails closed on drift", () => {
  const page = parsePortalCaseMessagesPage({
    messages: [message(12), message(11)],
    cursor: "11",
    hasMore: true,
    awaitState: "needs_reply",
  });
  assert.ok(page);
  assert.equal(page.messages.length, 2);
  assert.equal(page.messages[0].sequenceId, "12");
  assert.equal(page.awaitState, "needs_reply");
  assert.equal(page.hasMore, true);

  // Any shape drift is a null, never a partial page.
  assert.equal(parsePortalCaseMessagesPage(null), null);
  assert.equal(parsePortalCaseMessagesPage([]), null);
  assert.equal(
    parsePortalCaseMessagesPage({ messages: [], cursor: "0", hasMore: false }),
    null,
  );
  assert.equal(
    parsePortalCaseMessagesPage({
      messages: [], cursor: "0", hasMore: false, awaitState: "unexpected",
    }),
    null,
  );
  // Non-descending sequence ids violate the RPC ordering contract.
  assert.equal(
    parsePortalCaseMessagesPage({
      messages: [message(11), message(12)],
      cursor: "11",
      hasMore: false,
      awaitState: "none",
    }),
    null,
  );
  // Duplicate sequence ids are refused too.
  assert.equal(
    parsePortalCaseMessagesPage({
      messages: [message(11), message(11)],
      cursor: "11",
      hasMore: false,
      awaitState: "none",
    }),
    null,
  );
  // The RPC caps a page at 30 rows.
  assert.equal(
    parsePortalCaseMessagesPage({
      messages: Array.from({ length: 31 }, (_, index) => message(100 - index)),
      cursor: "70",
      hasMore: true,
      awaitState: "none",
    }),
    null,
  );
});

test("the message parser enforces attachment pairing and field shapes", () => {
  assert.ok(parsePortalCaseMessage(message(5)));
  assert.ok(parsePortalCaseMessage(message(5, {
    attachmentKind: "document",
    attachmentLabel: "Копия паспорта",
  })));
  // A label without a kind (or an unknown kind) is refused.
  assert.equal(
    parsePortalCaseMessage(message(5, { attachmentLabel: "Копия паспорта" })),
    null,
  );
  assert.equal(
    parsePortalCaseMessage(message(5, { attachmentKind: "photo", attachmentLabel: "x" })),
    null,
  );
  assert.equal(parsePortalCaseMessage(message(5, { sequenceId: "05" })), null);
  assert.equal(parsePortalCaseMessage(message(5, { mine: "yes" })), null);
  assert.equal(parsePortalCaseMessage(message(5, { extra: true })), null);
});

test("the post receipt parser pins the portal_post mode", () => {
  const receipt = {
    requestId: "20000000-0000-4000-8000-000000000001",
    studentCaseId: "20000000-0000-4000-8000-000000000002",
    mode: "portal_post",
    messageId: "20000000-0000-4000-8000-000000000003",
    sequenceId: "7",
    createdAt: "2026-09-19T10:00:00+00:00",
  };
  const parsed = parsePortalCaseMessagePostReceipt(receipt);
  assert.ok(parsed);
  assert.equal(parsed.messageId, receipt.messageId);
  assert.equal(parsePortalCaseMessagePostReceipt({ ...receipt, mode: "post" }), null);
  assert.equal(parsePortalCaseMessagePostReceipt({ ...receipt, sequenceId: "x" }), null);
});

test("merging pages deduplicates by sequence id and keeps bigint order", () => {
  const merged = mergePortalCaseMessages(
    [message(9), message(10)],
    [message(10, { body: "обновлённая копия" }), message(2)],
  );
  assert.deepEqual(merged.map((item) => item.sequenceId), ["2", "9", "10"]);
  // The freshest copy of a duplicate wins (poll refresh over stale state).
  assert.equal(merged[2].body, "обновлённая копия");
});

test("the messages screen is a connected assisted-only portal route", () => {
  assert.equal(isConnectedStudentPortalPage("/portal/messages"), true);
  assert.equal(isConnectedStudentPortalPage("/portal/messages/child"), false);

  const shell = source("src/components/portal/Shell.tsx");
  assert.match(
    shell,
    /\{ href: "\/portal\/messages", key: "nav\.messages", tiers: \["assisted"\] \}/u,
  );

  const page = source("src/app/(portal)/portal/messages/page.tsx");
  assert.match(page, /if \(actor\.caseState === "pending"\) redirect\("\/portal"\)/u);
  assert.match(page, /readPortalCaseMessages\(\)/u);
  // The screen marks the one-off Q&A difference and links the existing block.
  assert.match(page, /strings\.differenceNote/u);
  assert.match(page, /href="\/portal#case-help"/u);
  assert.match(page, /role="alert"/u);
  assert.doesNotMatch(page, /createClient|supabase|fixture|demo/iu);
});

test("the thread polls moderately and keeps the request id stable per attempt", () => {
  const thread = source("src/components/portal/messages/MessagesThread.tsx");
  // The PortalNotificationUpdates polling pattern: 30s, visible tab only,
  // resume on visibility/focus/online, full cleanup.
  assert.match(thread, /setInterval\(\(\) => \{ void refresh\(\); \}, 30_000\)/u);
  assert.match(thread, /document\.visibilityState !== "visible"/u);
  for (const event of ["visibilitychange", "focus", "online"]) {
    assert.ok(thread.includes(`addEventListener("${event}", resume)`), event);
    assert.ok(thread.includes(`removeEventListener("${event}", resume)`), event);
  }
  // Honest send states: the same request id is retried for the same text and
  // regenerated when the text changes after a failure.
  assert.match(thread, /useState\(\(\) => crypto\.randomUUID\(\)\)/u);
  assert.match(thread, /sendPortalCaseMessageAction\(requestId, body\)/u);
  assert.match(thread, /if \(sendFailed\) \{\s*setRequestId\(crypto\.randomUUID\(\)\);/u);
  assert.match(thread, /strings\.sendError/u);
  assert.match(thread, /strings\.retry/u);
  assert.match(thread, /mergePortalCaseMessages/u);
  assert.doesNotMatch(thread, /fetch\(|\.rpc\(|supabase/iu);
});

test("the messages dictionary ships both locales through the shared registry", () => {
  assert.ok(PORTAL_DICTIONARIES.messages);
  assert.equal(PORTAL_DICTIONARIES.messages.ru.title, "Сообщения");
  assert.equal(PORTAL_DICTIONARIES.messages.ky.title, "Билдирүүлөр");
  assert.equal(PORTAL_DICTIONARIES.shell.ru["nav.messages"], "Сообщения");
  assert.equal(PORTAL_DICTIONARIES.shell.ky["nav.messages"], "Билдирүүлөр");
});

test("the portal chat test file is registered exactly once", () => {
  const packageJson = JSON.parse(source("package.json"));
  const registrations = Object.values(packageJson.scripts)
    .filter((command) => command.includes("tests/portal-messages.test.mjs"));
  assert.equal(registrations.length, 1);
  assert.match(packageJson.scripts["test:frontend"], /tests\/portal-messages\.test\.mjs/u);
});
