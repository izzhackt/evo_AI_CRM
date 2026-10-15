// «Продажи → WhatsApp» — полноценный чат (решение владельца 06.10.2026,
// миграция 266). Узел-слой: чистая логика ленты и очереди отправки, разбор
// ответов базы, два GET-маршрута (подписи опроса и ранние сообщения) и
// контракт исходников. Что сотрудник видит, отправляет и проверяет, решает
// база: supabase/tests/platform_whatsapp_chat_replies.sql.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizePlatformWhatsAppChatMessage,
  normalizePlatformWhatsAppChatState,
} from "../src/lib/platform-communications.ts";
import {
  createPlatformInboxOlderMessagesHandler,
  createPlatformInboxPulseHandler,
} from "../src/lib/server/platform-inbox-route-handlers.ts";
import {
  REPLY_ACCESS_COPY,
  SEND_REFUSAL_COPY,
  WHATSAPP_CHAT_LEASE_OVER_MS,
  WHATSAPP_CHAT_QUEUED_RETRY_LIMIT,
  WHATSAPP_CHAT_STALL_MS,
  ackWord,
  chatDayLabel,
  chatTime,
  inboxPulseSignature,
  isRefusal,
  normalizeChatText,
  originWord,
  outgoingBubbles,
  queuedRetryDelay,
  settledLocalSends,
  speakerPrefix,
  unresolvedLocalCount,
} from "../src/lib/v3/whatsapp-chat.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = (n) => `66000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- time and words

test("times and day separators are Bishkek time; «Сегодня», «Вчера», a date, the year only when not current", () => {
  const readAt = "2026-10-06T08:00:00.000Z"; // 14:00 in Bishkek
  assert.equal(chatTime("2026-10-06T08:05:00.000Z"), "14:05");
  assert.equal(chatDayLabel("2026-10-06T00:30:00.000Z", readAt), "Сегодня");
  // 23:30 UTC on 05.10 is already 06.10 in Bishkek.
  assert.equal(chatDayLabel("2026-10-05T23:30:00.000Z", readAt), "Сегодня");
  assert.equal(chatDayLabel("2026-10-05T10:00:00.000Z", readAt), "Вчера");
  assert.equal(chatDayLabel("2026-10-01T10:00:00.000Z", readAt), "1 октября");
  assert.equal(chatDayLabel("2025-12-31T10:00:00.000Z", readAt), "31 декабря 2025");
  assert.equal(chatTime("not a time"), "");
});

test("our messages say where they came from; history carries no mark; ticks have words", () => {
  const crm = { inbound: false, origin: "crm", senderName: "Айгерим", senderIsViewer: false };
  assert.equal(originWord(crm), "из CRM, Айгерим");
  assert.equal(originWord({ ...crm, senderIsViewer: true }), "из CRM, вы");
  assert.equal(originWord({ inbound: false, origin: "phone", senderName: null, senderIsViewer: false }), "с телефона");
  assert.equal(originWord({ inbound: false, origin: "history", senderName: null, senderIsViewer: false }), null);
  assert.equal(originWord({ inbound: true, origin: "client", senderName: null, senderIsViewer: false }), null);
  assert.equal(speakerPrefix({ inbound: true, origin: "client", senderName: null, senderIsViewer: false }), "Клиент:");
  assert.equal(speakerPrefix({ ...crm, senderIsViewer: true }), "Вы, из CRM:");
  assert.equal(speakerPrefix({ inbound: false, origin: "phone", senderName: null, senderIsViewer: false }), "С телефона продаж:");
  assert.deepEqual(["SERVER", "DEVICE", "READ", "PLAYED", "ERROR", null].map(ackWord),
    ["отправлено", "доставлено", "прочитано", "прочитано", "не доставлено", null]);
});

test("the text that leaves: line feeds kept, CR and tabs normalized, other control characters dropped, edges trimmed", () => {
  assert.equal(normalizeChatText("  Добрый день!\r\nДокументы\tполучили.\u0007  "), "Добрый день!\nДокументы получили.");
  assert.equal(normalizeChatText(" \n\t "), "");
});

test("the copy of every state is the owner's wording", () => {
  assert.equal(REPLY_ACCESS_COPY.no_client_message, "Клиент ещё не писал в этот чат. Из CRM можно только отвечать — первое сообщение отправьте с телефона продаж.");
  assert.equal(REPLY_ACCESS_COPY.no_permission, "Только просмотр: у вашей роли нет права отвечать в WhatsApp.");
  assert.equal(REPLY_ACCESS_COPY.preview, "Просмотр роли — отправка отключена.");
  assert.equal(REPLY_ACCESS_COPY.old_session, "Чат пришёл через прежний номер WhatsApp — ответить из CRM нельзя.");
  assert.equal(REPLY_ACCESS_COPY.attention, "WhatsApp требует проверки — сообщение может не уйти.");
  assert.equal(SEND_REFUSAL_COPY.duplicate, "Такое же сообщение выше ещё не дошло до итога — дождитесь его или нажмите «Проверить» у него.");
  assert.equal(SEND_REFUSAL_COPY.closed, "Диалог закрыли — ответить из CRM нельзя. Текст остался в поле.");
  assert.notEqual(SEND_REFUSAL_COPY.closed, SEND_REFUSAL_COPY.stale_source, "a closed chat is not «the client wrote again»");
  for (const status of ["stale_source", "closed", "duplicate", "not_ready", "forbidden", "invalid"]) assert.equal(isRefusal(status), true, status);
  for (const status of ["sent", "queued", "sending", "unknown", "rejected", "unavailable"]) assert.equal(isRefusal(status), false, status);
});

// ---------------------------------------------------------------- the send queue

const local = (n, state, extra = {}) => ({
  requestId: ID(100 + n), text: `Сообщение ${n}`, sourceMessageId: ID(1), createdAt: `2026-10-06T08:0${n}:00.000Z`,
  state, messageId: null, attemptId: null, refusal: null, queuedAnswers: 0, ...extra,
});
const attempt = (n, status, extra = {}) => ({
  attemptId: status === "queued" ? null : ID(200 + n), workItemId: ID(300 + n), requestId: ID(100 + n), status,
  reconciliationRequired: status === "unknown", text: `Сообщение ${n}`, authorName: "Айгерим", authorIsViewer: true,
  at: `2026-10-06T08:0${n}:00.000Z`, claimedAt: status === "queued" ? null : `2026-10-06T08:0${n}:01.000Z`,
  sourceMessageId: ID(1), failureCode: status === "rejected" ? "message_rejected" : null, readback: null,
  readbackSettled: false, ...extra,
});

test("outgoing bubbles: the server's state wins for a known request id, a live send is «Отправляется…», an accepted one waits for its message", () => {
  const bubbles = outgoingBubbles(
    [attempt(1, "unknown"), attempt(2, "queued"), attempt(4, "rejected", { requestId: ID(999), authorIsViewer: false })],
    [local(1, "unknown"), local(2, "queued"), local(3, "sent", { messageId: ID(503) }), local(5, "lost"), local(6, "refused", { refusal: "stale_source" })],
    new Set(),
    new Set([ID(102)]),
  );
  assert.deepEqual(bubbles.map((bubble) => [bubble.text, bubble.state, bubble.localRequestId !== null]), [
    ["Сообщение 1", "unknown", true],
    ["Сообщение 2", "sending", true],
    ["Сообщение 3", "sent", true],
    ["Сообщение 4", "rejected", false],
    ["Сообщение 5", "lost", true],
    ["Сообщение 6", "refused", true],
  ]);
  // Once the refreshed transcript carries the accepted message, its bubble goes.
  assert.equal(outgoingBubbles([], [local(3, "sent", { messageId: ID(503) })], new Set([ID(503)])).length, 0);
});

test("time decides two states: a send nobody took for over a minute «did not leave», a taken one past its lease is «unknown»", () => {
  const at = Date.parse("2026-10-06T08:01:00.000Z");
  const stalledAt = at + WHATSAPP_CHAT_STALL_MS + 1;
  const states = (attempts, locals, now, inFlight = new Set()) =>
    outgoingBubbles(attempts, locals, new Set(), inFlight, now).map((bubble) => bubble.state);
  // Fresh: waits; over a minute and not retried here: stalled (the server no longer lets it hold the chat).
  assert.deepEqual(states([attempt(1, "queued")], [], at + 1_000), ["queued"]);
  assert.deepEqual(states([attempt(1, "queued")], [], stalledAt), ["stalled"]);
  // This browser still retries it: it waits; the retries gave up: stuck; the answer was lost: lost.
  assert.deepEqual(states([attempt(1, "queued")], [local(1, "queued", { queuedAnswers: 3 })], stalledAt), ["queued"]);
  assert.deepEqual(states([attempt(1, "queued")], [local(1, "stuck")], stalledAt), ["stuck"]);
  assert.deepEqual(states([attempt(1, "queued")], [local(1, "lost")], at + 1_000), ["lost"]);
  assert.deepEqual(states([attempt(1, "queued")], [local(1, "sending")], stalledAt, new Set([ID(101)])), ["sending"]);
  // Without a clock (server render before hydration) nothing is called stalled.
  assert.deepEqual(states([attempt(1, "queued")], [], Number.NaN), ["queued"]);
  // Taken: sending until the lease (and a margin) is over, then unknown with a check.
  const claimed = Date.parse("2026-10-06T08:01:01.000Z");
  assert.deepEqual(states([attempt(1, "prepared")], [], claimed + 10_000), ["sending"]);
  const over = outgoingBubbles([attempt(1, "prepared")], [], new Set(), new Set(), claimed + WHATSAPP_CHAT_LEASE_OVER_MS + 1);
  assert.deepEqual([over[0].state, over[0].attemptId], ["unknown", ID(201)]);
});

test("only the author may send a stalled message again, with the same request id and source, from any device", () => {
  const now = Date.parse("2026-10-06T08:01:00.000Z") + WHATSAPP_CHAT_STALL_MS + 1;
  const [mine] = outgoingBubbles([attempt(1, "queued", { sourceMessageId: ID(7) })], [], new Set(), new Set(), now);
  assert.deepEqual(mine.resend, { requestId: ID(101), sourceMessageId: ID(7) });
  const [theirs] = outgoingBubbles([attempt(1, "queued", { authorIsViewer: false })], [], new Set(), new Set(), now);
  assert.equal(theirs.resend, null);
  // A settled «not found» travels to the bubble (only then may the text go back into the field).
  const [settled] = outgoingBubbles([attempt(2, "unknown", { readback: "message_not_found", readbackSettled: true })], [], new Set());
  assert.deepEqual([settled.state, settled.readback, settled.readbackSettled], ["unknown", "message_not_found", true]);
});

test("a send the chat's queue holds is asked again less and less often, then only by hand", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 8].map(queuedRetryDelay), [5_000, 10_000, 20_000, 30_000, 30_000, 30_000]);
  assert.equal(WHATSAPP_CHAT_QUEUED_RETRY_LIMIT, 8);
  const chat = read("src/components/v3/inbox/InboxChat.tsx");
  assert.match(chat, /queuedAnswers >= WHATSAPP_CHAT_QUEUED_RETRY_LIMIT \? "stuck" : "queued"/u);
  assert.match(chat, /queuedRetryDelay\(Math\.min\(\.\.\.waiting\.map\(\(item\) => item\.queuedAnswers\)\)\)/u);
});

test("an unknown result keeps «Проверить» after «not found»; the text returns to the field only after a settled check", () => {
  const chat = read("src/components/v3/inbox/InboxChat.tsx");
  assert.match(chat, /action=\{notFound && bubble\.readbackSettled && returnAction[\s\S]{0,120}?\? <span[^>]*>\{checkAction\}\{returnAction\}<\/span>\s*: checkAction\}/u);
  assert.match(chat, /"В WhatsApp пока не найдено — проверьте ещё раз через несколько минут"/u);
  assert.doesNotMatch(chat, /bubble\.readback === "message_not_found"\) \{\s*return <StatusRow tone="muted" action=\{returnAction\}>/u);
});

test("settled local sends: shown by the server (unknown/rejected) or delivered into the transcript", () => {
  const settled = settledLocalSends(
    [local(1, "unknown"), local(2, "queued"), local(3, "sent", { messageId: ID(503) }), local(4, "sent")],
    [attempt(1, "unknown"), attempt(2, "queued")],
    new Set([ID(503)]),
  );
  assert.deepEqual(settled, [ID(101), ID(103), ID(104)]);
  assert.equal(unresolvedLocalCount([local(1, "sending"), local(2, "queued"), local(3, "lost"), local(4, "sent"), local(5, "refused"),
    local(6, "stuck")]), 4);
});

test("the pulse signature changes with any id, time or state and never carries text", () => {
  const base = inboxPulseSignature([ID(1), "2026-10-06T08:00:00.000Z", "unknown"]);
  assert.match(base, /^[0-9a-f]{16}$/u);
  assert.equal(inboxPulseSignature([ID(1), "2026-10-06T08:00:00.000Z", "unknown"]), base, "stable");
  assert.notEqual(inboxPulseSignature([ID(1), "2026-10-06T08:00:00.000Z", "rejected"]), base);
  assert.notEqual(inboxPulseSignature([ID(2), "2026-10-06T08:00:00.000Z", "unknown"]), base);
  assert.notEqual(inboxPulseSignature([ID(1), null, "unknown"]), inboxPulseSignature([ID(1), "", "unknown"]));
});

// ---------------------------------------------------------------- the 266 readers

const message = (overrides = {}) => ({
  message_id: ID(1), direction: "inbound", body_text: "Здравствуйте", created_at: "2026-10-06T07:00:01+00:00",
  media: [], waha_ack_name: null, waha_ack_observed_at: null, origin: "client", sender_name: null, sender_membership_id: null,
  ...overrides,
});

test("a v2 page row: exact keys, consistent origin and author, no provider identity", () => {
  assert.equal(normalizePlatformWhatsAppChatMessage(message()).origin, "client");
  const crm = normalizePlatformWhatsAppChatMessage(message({
    direction: "outbound", origin: "crm", sender_name: "Айгерим", sender_membership_id: ID(9),
    waha_ack_name: "READ", waha_ack_observed_at: "2026-10-06T07:00:05+00:00",
  }));
  assert.deepEqual([crm.origin, crm.senderName, crm.senderMembershipId, crm.wahaAckName], ["crm", "Айгерим", ID(9), "READ"]);
  for (const bad of [
    { ...message(), waha_message_id: "true_79990000000@c.us_X" },
    message({ origin: "crm" }),
    message({ direction: "outbound", origin: "client" }),
    message({ direction: "outbound", origin: "crm", sender_name: "Айгерим", sender_membership_id: null }),
    message({ direction: "outbound", origin: "phone", sender_name: "Айгерим" }),
    message({ origin: "bot" }),
  ]) {
    assert.throws(() => normalizePlatformWhatsAppChatMessage(bad), /communications are unavailable/u, JSON.stringify(bad));
  }
});

test("the chat state: latest inbound, attempts with request id; queued has no attempt; bad shapes fail closed", () => {
  const row = {
    latest_inbound_message_id: ID(1), latest_inbound_at: "2026-10-06T07:00:01+00:00",
    newest_message_id: ID(2), newest_message_at: "2026-10-06T07:00:02+00:00",
    attempts: [{
      attempt_id: null, work_item_id: ID(3), request_id: ID(4), status: "queued", reconciliation_required: false,
      final_text: "Ответ", authorized_by_membership_id: ID(5), authorized_by_name: "Айгерим",
      authorized_at: "2026-10-06T07:00:03.123456+00:00", claimed_at: null, failure_code: null,
      latest_reconciliation_outcome: null, last_reconciled_at: null, source_message_id: ID(1), readback_settled: false,
    }],
  };
  const state = normalizePlatformWhatsAppChatState(row);
  assert.equal(state.latestInboundMessageId, ID(1));
  assert.equal(state.attempts[0].status, "queued");
  assert.equal(state.attempts[0].requestId, ID(4));
  assert.equal(state.attempts[0].sourceMessageId, ID(1));
  assert.equal(state.attempts[0].readbackSettled, false);
  assert.deepEqual(normalizePlatformWhatsAppChatState({ ...row, latest_inbound_message_id: null, latest_inbound_at: null, attempts: [] }).attempts, []);
  for (const bad of [
    { ...row, attempts: [{ ...row.attempts[0], attempt_id: ID(6) }] },
    { ...row, attempts: [{ ...row.attempts[0], status: "accepted" }] },
    { ...row, attempts: [{ ...row.attempts[0], raw_chat_id: "79990000000@c.us" }] },
    { ...row, latest_inbound_at: null },
    { ...row, attempts: [row.attempts[0], row.attempts[0]] },
    { ...row, attempts: [{ ...row.attempts[0], readback_settled: true }] },
    { ...row, attempts: [{ ...row.attempts[0], source_message_id: null }] },
  ]) {
    assert.throws(() => normalizePlatformWhatsAppChatState(bad), /communications are unavailable/u);
  }
});

// ---------------------------------------------------------------- the two GET routes

const ACTOR = Object.freeze({ organizationId: ID(90), membershipId: ID(91) });
const deps = (overrides = {}) => ({
  authorize: async () => ({ status: "authorized", actor: ACTOR }),
  readPulse: async () => ({ list: "aaaaaaaaaaaaaaaa", chat: "bbbbbbbbbbbbbbbb" }),
  readOlder: async () => ({ messages: [], hasOlder: false, attachmentContext: null }),
  ...overrides,
});

test("pulse: signatures only, no-store, exact parameters, honest refusals", async () => {
  const calls = [];
  const handler = createPlatformInboxPulseHandler(deps({ readPulse: async (actor, options) => { calls.push(options); return { list: "aaaaaaaaaaaaaaaa", chat: null }; } }));
  const ok = await handler(new Request(`https://crm.test/api/v3/inbox/pulse?list=1&q=%20Анна%20&sort=unanswered`));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ok.json(), { list: "aaaaaaaaaaaaaaaa", chat: null });
  // «Сортировка» (08.10.2026): the list is read in the order it is shown;
  // no parameter is «Сначала новые»; a tab opened before the release still
  // polls with `waiting=1` and reads «Неотвеченные», so it refreshes and the
  // page moves it to `sort=unanswered`.
  await handler(new Request(`https://crm.test/api/v3/inbox/pulse?list=1`));
  await handler(new Request(`https://crm.test/api/v3/inbox/pulse?list=1&waiting=1`));
  assert.deepEqual(calls, [
    { conversationId: null, query: "Анна", sort: "unanswered", list: true },
    { conversationId: null, query: null, sort: "newest", list: true },
    { conversationId: null, query: null, sort: "unanswered", list: true },
  ]);

  for (const query of ["", "conversation=bad", "list=2", "list=1&list=1", "list=1&extra=1", `conversation=${ID(1)}&waiting=0`,
    "list=1&sort=newest", "list=1&sort=unanswered&sort=unanswered", "list=1&sort="]) {
    assert.equal((await handler(new Request(`https://crm.test/api/v3/inbox/pulse?${query}`))).status, 400, query);
  }
  for (const [status, code] of [["anonymous", 401], ["forbidden", 403], ["unavailable", 503]]) {
    const refused = createPlatformInboxPulseHandler(deps({ authorize: async () => ({ status, actor: null }) }));
    assert.equal((await refused(new Request(`https://crm.test/api/v3/inbox/pulse?conversation=${ID(1)}`))).status, code);
  }
  const failing = createPlatformInboxPulseHandler(deps({ readPulse: async () => { throw new Error("42501"); } }));
  assert.equal((await failing(new Request(`https://crm.test/api/v3/inbox/pulse?conversation=${ID(1)}`))).status, 503);
});

const ATTACH = Object.freeze({
  conversationId: ID(1), studentCaseId: ID(50),
  slots: [{ documentSlotId: ID(51), label: "Документы · Паспорт", expectedVersion: "1" }],
  requestIdsByMediaId: { [ID(52)]: ID(53) },
});

test("older messages: an exact keyset cursor of the chat, 404 when the chat is not readable", async () => {
  const calls = [];
  const handler = createPlatformInboxOlderMessagesHandler(deps({
    readOlder: async (actor, id, cursor) => {
      calls.push([id, cursor]);
      return id === ID(1) ? { messages: [], hasOlder: true, attachmentContext: ATTACH } : null;
    },
  }));
  const context = (id) => ({ params: Promise.resolve({ conversationId: id }) });
  const url = (id, query) => new Request(`https://crm.test/api/v3/inbox/conversations/${id}/messages?${query}`);
  const cursor = `before_at=${encodeURIComponent("2026-10-06T07:00:01+00:00")}&before_id=${ID(7)}`;
  const ok = await handler(url(ID(1), cursor), context(ID(1)));
  assert.equal(ok.status, 200);
  // The page's «В дело студента» context travels with it (request ids for exactly its attachments).
  assert.deepEqual(await ok.json(), { messages: [], hasOlder: true, attachmentContext: ATTACH });
  assert.deepEqual(calls[0], [ID(1), { sortAt: "2026-10-06T07:00:01+00:00", id: ID(7) }]);
  assert.equal((await handler(url(ID(2), cursor), context(ID(2)))).status, 404);
  assert.equal((await handler(url(ID(1), "before_at=x&before_id=y"), context(ID(1)))).status, 400);
  assert.equal((await handler(url("not-a-uuid", cursor), context("not-a-uuid"))).status, 400);
  assert.equal((await handler(url(ID(1), `${cursor}&q=1`), context(ID(1)))).status, 400);
});

// ---------------------------------------------------------------- source contracts

test("the chat imports no Gemini or amoCRM code; the AI window fills the slot only where the composer is", () => {
  const files = ["src/components/v3/inbox/InboxChat.tsx", "src/components/v3/inbox/InboxComposer.tsx",
    "src/components/v3/inbox/useInboxPulse.ts", "src/components/v3/inbox/chat-store.ts", "src/components/v3/Inbox.tsx",
    "src/app/(v3)/v3/inbox/page.tsx", "src/lib/v3/inbox-source.ts", "src/components/v3/inbox/InboxAiAssistant.tsx"];
  for (const file of files) {
    assert.doesNotMatch(read(file), /from "[^"]*(gemini|amocrm)[^"]*"/iu, file);
  }
  // «ИИ-агент» P1 (план §12.1): окно — у того, у кого есть ai.agent.use, не в просмотре роли.
  assert.match(read("src/app/(v3)/v3/inbox/page.tsx"), /const assistant = !isStaffPreview\(actor\) && staffHasPermission\(actor, "ai\.agent\.use"\)/u);
  assert.match(read("src/app/(v3)/v3/inbox/page.tsx"), /assistant=\{assistant\}/u);
  assert.match(read("src/components/v3/inbox/InboxChat.tsx"), /\{assistant && canSend \? \(/u, "no window without the composer");
});

test("the request id is frozen until a definite answer: retries and reloads reuse it", () => {
  const chat = read("src/components/v3/inbox/InboxChat.tsx");
  // A new id is minted only when a new message is written.
  assert.equal(chat.match(/requestId: crypto\.randomUUID\(\)/gu)?.length, 2, "one for a new message, one per readback click");
  assert.match(chat, /requestId: next\.requestId/u);
  assert.match(chat, /item\.state === "queued" \? \{ \.\.\.item, state: "sending" as const \}/u, "a queued send is asked again with the same id");
  assert.match(read("src/components/v3/inbox/chat-store.ts"), /localStorage/u);
});

test("the pulse pauses when hidden, slows without focus, never refreshes mid-send and carries no text", () => {
  const pulse = read("src/components/v3/inbox/useInboxPulse.ts");
  assert.match(pulse, /const FOCUSED_MS = 5_000;/u);
  assert.match(pulse, /const VISIBLE_MS = 20_000;/u);
  assert.match(pulse, /document\.visibilityState !== "visible"/u);
  assert.match(pulse, /if \(busyRef\.current\) \{ owed\.current = true; return; \}/u);
  assert.match(pulse, /FAILURES_BEFORE_STALL = 3/u);
  assert.match(pulse, /window\.addEventListener\("online", onOnline\)/u);
  assert.match(pulse, /cache: "no-store"/u);
  const handlers = read("src/lib/server/platform-inbox-route-handlers.ts");
  assert.match(handlers, /return json\(200, \{ list: pulse\.list, chat: pulse\.chat \}\);/u);
});

test("one solid red: only «Отправить»; our bubbles are the neutral selection, not red", () => {
  const chat = read("src/components/v3/inbox/InboxChat.tsx");
  const composer = read("src/components/v3/inbox/InboxComposer.tsx");
  assert.equal(`${chat}\n${composer}`.match(/\bbg-accent\b(?!-)/gu)?.length, 1);
  assert.match(composer, /aria-label="Отправить"[\s\S]*?bg-accent text-on-accent/u);
  assert.match(chat, /message\.inbound \? "border border-border bg-surface" : "bg-accent-weak"/u);
  assert.match(chat, /role="log"/u);
});
