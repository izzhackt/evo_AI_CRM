// «Сообщения» (/v3/messages): страницы переписки приходят от новых к старым
// (191: ORDER BY sequence_id DESC). «Показать более ранние» должно ставить
// более раннюю страницу после загруженной, чтобы лента после разворота для
// показа читалась от старых к новым. Раньше ранняя страница вставала впереди,
// и после разворота старые сообщения оказывались ниже новых.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendOlderCaseChatPage } from "../src/lib/platform-case-chat-contract.ts";

const message = (sequence) => ({
  id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  sequenceId: String(sequence), authorMembershipId: "a", authorName: "Автор",
  body: `Сообщение ${sequence}`, createdAt: "2026-09-25T00:00:00.000Z",
  quotedMessageId: null, quotedPreview: null, attachmentKind: null, attachmentId: null, attachmentLabel: null,
});

// Страница как из чтения: от новых к старым, курсор — самое раннее сообщение.
const page = (newest, oldest, hasMore) => ({
  messages: Array.from({ length: newest - oldest + 1 }, (_, index) => message(newest - index)),
  cursor: String(oldest), hasMore,
  thread: { awaitState: "none", lastMessageAt: null, lastMessageSequenceId: null },
  readSequenceId: "0",
});

const shown = (value) => [...value.messages].reverse().map((item) => Number(item.sequenceId));

test("более ранняя страница встаёт после загруженной, и лента идёт от старых к новым", () => {
  const merged = appendOlderCaseChatPage(page(100, 51, true), page(50, 1, false));
  assert.deepEqual(shown(merged), Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(merged.cursor, "1");
  assert.equal(merged.hasMore, false);
});

test("третья страница продолжает ту же ленту", () => {
  const twice = appendOlderCaseChatPage(appendOlderCaseChatPage(page(150, 101, true), page(100, 51, true)), page(50, 1, false));
  assert.deepEqual(shown(twice), Array.from({ length: 150 }, (_, index) => index + 1));
});

test("переписка склеивает страницы только через appendOlderCaseChatPage", () => {
  const component = readFileSync(new URL("../src/components/v3/case-chat/CaseChatThread.tsx", import.meta.url), "utf8");
  assert.match(component, /appendOlderCaseChatPage\(previous, result\.page\)/u);
  assert.doesNotMatch(component, /\.\.\.result\.page\.messages,\s*\.\.\.previous\.messages/u);
});
