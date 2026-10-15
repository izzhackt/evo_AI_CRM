import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getPlatformWhatsAppContacts,
  listPlatformConversations,
  normalizePlatformWhatsAppContact,
  parsePlatformConversationCursor,
  PlatformCommunicationsRepositoryError,
} from "../src/lib/platform-communications.ts";
import { buildV3InboxHref } from "../src/lib/v3/inbox-href.ts";
import { whatsAppChatLabel, whatsAppChatTitle } from "../src/lib/v3/whatsapp-contact.ts";

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
  assert.match(adapter, /unansweredFirst: options\.sort === "unanswered"/u);
  assert.doesNotMatch(adapter, /waitingOnly/u, "«Только ждут ответа» is replaced by «Сортировка» (08.10.2026)");
  assert.match(adapter, /buildV3InboxHref/u);

  assert.match(page, /conversation\?: string \| string\[\]/u);
  assert.match(page, /parsePlatformRouteUuid/u);
  assert.match(page, /parsePlatformConversationCursor/u);
  assert.match(page, /conversationId === null && messageCursor !== null/u);
  assert.match(page, /conversationId !== null && messageCursor !== null\) \{\s*redirect\(/u, "an old message-page link opens the chat");
  assert.match(page, /conversationId !== null && view\.selected === null/u);
  assert.match(page, /q\?: string \| string\[\]/u);
  assert.match(page, /waiting\?: string \| string\[\]/u);
  assert.match(page, /sort\?: string \| string\[\]/u);
  assert.match(page, /before_waiting\?: string \| string\[\]/u);
  assert.match(page, /value !== "1"/u);
  assert.match(page, /value !== "unanswered"/u);
  assert.match(page, /if \(parseLegacyWaiting\(query\.waiting\)\) \{\s*redirect\(/u, "an old «Только ждут ответа» link opens «Неотвеченные»");
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
    filters: { query: "Иван Петров", sort: "unanswered" },
    queueCursor: {
      sortAt: "2026-09-07T09:00:00.000Z",
      id: "62000000-0000-4000-8000-000000000001",
      waiting: true,
    },
    conversationId: "62000000-0000-4000-8000-000000000002",
    messageCursor: {
      sortAt: "2026-09-07T08:00:00.000Z",
      id: "62000000-0000-4000-8000-000000000003",
    },
  });

  assert.equal(
    href,
    "/v3/inbox?q=%D0%98%D0%B2%D0%B0%D0%BD+%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2&sort=unanswered&before_at=2026-09-07T09%3A00%3A00.000Z&before_id=62000000-0000-4000-8000-000000000001&before_waiting=1&conversation=62000000-0000-4000-8000-000000000002&messages_before_at=2026-09-07T08%3A00%3A00.000Z&messages_before_id=62000000-0000-4000-8000-000000000003",
  );
});

test("V3 Inbox href produces q-only, both sort orders and newest states", () => {
  assert.equal(
    buildV3InboxHref({
      filters: { query: "Анна", sort: "newest" },
    }),
    "/v3/inbox?q=%D0%90%D0%BD%D0%BD%D0%B0",
  );
  assert.equal(
    buildV3InboxHref({
      filters: { query: "Анна", sort: "unanswered" },
    }),
    "/v3/inbox?q=%D0%90%D0%BD%D0%BD%D0%B0&sort=unanswered",
  );
  assert.equal(
    buildV3InboxHref({
      filters: { query: null, sort: "unanswered" },
      conversationId: "62000000-0000-4000-8000-000000000002",
    }),
    "/v3/inbox?sort=unanswered&conversation=62000000-0000-4000-8000-000000000002",
  );
  // «Неотвеченные»: the cursor carries its row's group, «0» included.
  assert.equal(
    buildV3InboxHref({
      filters: { query: null, sort: "unanswered" },
      queueCursor: { sortAt: "2026-09-07T09:00:00.000Z", id: "62000000-0000-4000-8000-000000000001", waiting: false },
    }),
    "/v3/inbox?sort=unanswered&before_at=2026-09-07T09%3A00%3A00.000Z&before_id=62000000-0000-4000-8000-000000000001&before_waiting=0",
  );
  // «Сначала новые» is the address without a parameter: the section always opens there.
  assert.equal(
    buildV3InboxHref({ filters: { query: null, sort: "newest" } }),
    "/v3/inbox",
  );
});

test("V3 Inbox search and «Сортировка» use the server waiting_since projection", () => {
  const adapter = source("src/lib/v3/inbox-source.ts");
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(adapter, /summary\.waitingSince/u);
  assert.match(adapter, /formatWaitingRu\(summary\.waitingSince\)/u);
  assert.doesNotMatch(adapter, /function awaitingReplyFor/u);
  assert.match(adapter, /sortHrefs: Object\.freeze\(\{/u);
  assert.match(inbox, /name="q"/u);
  // Search keeps the order; the order is the shared «Сортировка» menu (as in «Студентах»).
  assert.match(inbox, /name="sort" value="unanswered"/u);
  assert.match(inbox, /<FilterMenu\s+label="Сортировка"/u);
  assert.match(inbox, /label: "Сначала новые"/u);
  assert.match(inbox, /label: "Неотвеченные"/u);
  assert.doesNotMatch(inbox, /Только ждут ответа|name="waiting"/u);
  assert.match(inbox, /Ждёт ответа с \{conversation\.waitingSince\}/u);
  assert.match(inbox, /Ждёт ответа\{open\.awaitingReplyFor \? ` · \$\{open\.awaitingReplyFor\}` : ""\}/u);
  assert.doesNotMatch(`${adapter}\n${inbox}`, /lastMessageAt.*formatWaitingRu/su);
});

// «Сортировка» (owner request 08.10.2026). The order itself is the database's
// (migration 279, proven on the real WAHA chain by
// supabase/tests/platform_inbox_unanswered_first.sql); here the application
// side: the arguments it sends, the cursor it keeps, the cursor's trip through
// the page URL and back, page after page. The fake answers each call the way
// 279 does: ORDER BY (waiting) DESC only in «Неотвеченные», then sort_at DESC,
// id DESC, keyset below the cursor tuple.
const SORT_ORG = "64000000-0000-4000-8000-000000000001";
const sortActor = Object.freeze({
  authUserId: "64000000-0000-4000-8000-000000000002",
  profileId: "64000000-0000-4000-8000-000000000003",
  membershipId: "64000000-0000-4000-8000-000000000004",
  organizationId: SORT_ORG,
  displayName: "Sales (синтетика)",
  email: "sales@example.test",
  systemRole: "staff", assignments: [], permissionKeys: ["communication.read.full"],
  presentationRole: null,
  platformAccessVersion: 1,
});
const chatId = (n) => `64000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
// name, minute of the latest message, the customer wrote last (= awaits our answer)
const SORT_CHATS = [
  ["answered-newest", 12 * 60, false, 1],
  ["waiting-11", 11 * 60, true, 2],
  ["waiting-10", 10 * 60, true, 3],
  ["answered-0930", 9 * 60 + 30, false, 4],
  ["waiting-09-low-id", 9 * 60, true, 5],
  ["waiting-09-high-id", 9 * 60, true, 6],
  ["answered-oldest", 8 * 60, false, 7],
];
const minuteAt = (minute) => new Date(Date.UTC(2026, 9, 8, 0, minute)).toISOString().replace(".000Z", "+00:00");
const SORT_ROWS = SORT_CHATS.map(([, minute, waiting, n]) => ({
  conversation_id: chatId(n), student_case_id: null, queue: "sales", status: "open", subject: `WhatsApp ••••00${n}0`,
  waha_session_name: "crm_primary", kommo_account_id: null, kommo_conversation_id: null, amocrm_account_id: null,
  amocrm_lead_id: null, amocrm_contact_id: null, created_at: minuteAt(0), sort_at: minuteAt(minute),
  last_message_direction: waiting ? "inbound" : "outbound", last_message_at: minuteAt(minute),
  waiting_since: waiting ? minuteAt(minute - 5) : null,
}));
const nameOf = Object.fromEntries(SORT_CHATS.map(([name, , , n]) => [chatId(n), name]));

function sortingClient(rows) {
  const calls = [];
  const less = (a, b) => {
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] < b[index];
    }
    return false;
  };
  return {
    calls,
    client: {
      schema: () => ({
        rpc(functionName, args) {
          calls.push(args);
          const unanswered = args.p_unanswered_first === true;
          const key = (row) => [unanswered && row.waiting_since !== null ? 1 : 0, Date.parse(row.sort_at), row.conversation_id];
          let page = [...rows].sort((a, b) => (less(key(a), key(b)) ? 1 : less(key(b), key(a)) ? -1 : 0));
          if (args.p_before_sort_at !== undefined) {
            const cursor = [unanswered ? (args.p_before_waiting ? 1 : 0) : 0, Date.parse(args.p_before_sort_at), args.p_before_conversation_id];
            page = page.filter((row) => less(key(row), cursor));
          }
          return Promise.resolve({ data: page.slice(0, args.p_limit), error: null });
        },
      }),
    },
  };
}

// The page's own reading of «Ранее →»: before_at/before_id, and before_waiting in «Неотвеченные».
function cursorFromHref(href) {
  const params = new URL(href, "https://crm.test").searchParams;
  const cursor = parsePlatformConversationCursor(params.get("before_at"), params.get("before_id"));
  const waiting = params.get("before_waiting");
  return cursor && waiting !== null ? { ...cursor, waiting: waiting === "1" } : cursor;
}

async function walkPages(sort, pageSize) {
  const recorded = sortingClient(SORT_ROWS);
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await listPlatformConversations(sortActor, { cursor, pageSize, unansweredFirst: sort === "unanswered" }, { client: recorded.client });
    seen.push(...page.rows.map((row) => nameOf[row.id]));
    if (page.nextCursor === null) return { seen, calls: recorded.calls };
    cursor = cursorFromHref(buildV3InboxHref({ filters: { query: null, sort }, queueCursor: page.nextCursor }));
  }
  throw new Error("the pages did not end");
}

test("«Неотвеченные»: awaiting chats first, freshest first, then the rest, freshest first — page by page with no duplicate and no gap", async () => {
  const unanswered = ["waiting-11", "waiting-10", "waiting-09-high-id", "waiting-09-low-id", "answered-newest", "answered-0930", "answered-oldest"];
  const newest = ["answered-newest", "waiting-11", "waiting-10", "answered-0930", "waiting-09-high-id", "waiting-09-low-id", "answered-oldest"];
  for (const pageSize of [1, 2, 3, 4, 7, 50]) {
    const sorted = await walkPages("unanswered", pageSize);
    assert.deepEqual(sorted.seen, unanswered, `«Неотвеченные», ${pageSize} per page`);
    assert.equal(new Set(sorted.seen).size, SORT_ROWS.length, "every chat exactly once");
    // Every «Ранее» call names the group of the previous page's last row.
    for (const call of sorted.calls.slice(1)) {
      assert.equal(call.p_unanswered_first, true);
      assert.equal(typeof call.p_before_waiting, "boolean");
    }
    const plain = await walkPages("newest", pageSize);
    assert.deepEqual(plain.seen, newest, `«Сначала новые», ${pageSize} per page`);
  }
  // The group border inside a page: 2 per page, the second page ends the awaiting chats.
  const border = await walkPages("unanswered", 2);
  assert.deepEqual(border.calls.map((call) => call.p_before_waiting ?? null), [null, true, true, false]);
});

test("«Сортировка» sends its arguments only in «Неотвеченные»; the default call is the running one", async () => {
  const plain = sortingClient(SORT_ROWS);
  await listPlatformConversations(sortActor, { pageSize: 50 }, { client: plain.client });
  await listPlatformConversations(sortActor, { pageSize: 50, unansweredFirst: false }, { client: plain.client });
  for (const call of plain.calls) {
    assert.deepEqual(Object.keys(call).sort(), ["p_limit", "p_organization_id", "p_waiting_only"], "no 279 argument by default");
  }
  const sorted = sortingClient(SORT_ROWS);
  const first = await listPlatformConversations(sortActor, { pageSize: 2, unansweredFirst: true }, { client: sorted.client });
  assert.deepEqual(sorted.calls[0], { p_organization_id: SORT_ORG, p_limit: 3, p_waiting_only: false, p_unanswered_first: true });
  assert.deepEqual(first.nextCursor, { sortAt: minuteAt(10 * 60), id: chatId(3), waiting: true });
  const defaultPage = await listPlatformConversations(sortActor, { pageSize: 2 }, { client: plain.client });
  assert.equal("waiting" in defaultPage.nextCursor, false, "the default cursor names no group");

  // A cursor that does not match its order is refused before any call.
  for (const options of [
    { unansweredFirst: true, cursor: { sortAt: minuteAt(60), id: chatId(1) } },
    { unansweredFirst: false, cursor: { sortAt: minuteAt(60), id: chatId(1), waiting: true } },
    { cursor: { sortAt: minuteAt(60), id: chatId(1), waiting: false } },
    { unansweredFirst: "yes" },
  ]) {
    const refused = sortingClient(SORT_ROWS);
    await assert.rejects(listPlatformConversations(sortActor, options, { client: refused.client }), PlatformCommunicationsRepositoryError);
    assert.deepEqual(refused.calls, [], JSON.stringify(options));
  }
});

test("«Сортировка» in the page and the poll: «Сначала новые» every time the section opens, the order kept by search, pages and polling", () => {
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  const adapter = source("src/lib/v3/inbox-source.ts");
  const pulse = source("src/components/v3/inbox/useInboxPulse.ts");
  // No parameter — «Сначала новые»; nothing remembers the last choice.
  assert.match(page, /if \(value === undefined\) return "newest";/u);
  assert.doesNotMatch(`${page}\n${adapter}\n${pulse}`, /localStorage|sessionStorage|cookies\(/u);
  // The cursor of «Неотвеченные» needs its group; the default one refuses it.
  assert.match(page, /if \(sort === "newest" \|\| cursor === null\) \{\s*if \(waiting !== undefined\) notFound\(\);/u);
  assert.match(page, /if \(waiting !== "1" && waiting !== "0"\) notFound\(\);/u);
  // The poll reads the first page in the order it shows.
  assert.match(pulse, /if \(sort === "unanswered"\) params\.set\("sort", "unanswered"\);/u);
  assert.match(adapter, /readInboxPulse[\s\S]*unansweredFirst: options\.sort === "unanswered"/u);
  // Both menu links start from the first page with the same search and open chat.
  assert.match(adapter, /newest: buildV3InboxHref\(\{\s*conversationId: selected\?\.id,\s*filters: Object\.freeze\(\{ query: options\.query, sort: "newest" \}\),/u);
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

test("V3 Inbox warns about a WhatsApp problem only; a working channel is not announced (07.10.2026)", () => {
  const adapter = source("src/lib/v3/inbox-source.ts");
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(adapter, /wahaSessionName === "crm_primary"/u);
  assert.match(adapter, /getPlatformWahaSessionHealth\(actor, "crm_primary"\)/u);
  assert.match(adapter, /isFreshWorkingWahaSession/u);
  // «WhatsApp подключён · проверено 07.10 12:40» — «уберем давай это».
  assert.doesNotMatch(`${adapter}\n${inbox}`, /WhatsApp подключён|[Пп]роверено|channelObservedAt|observedAt\)/u);
  assert.match(inbox, /if \(state === "ready"\) return null;/u);
  assert.match(inbox, /WhatsApp требует проверки/u);
  assert.match(inbox, /Состояние WhatsApp не подтверждено/u);
  assert.match(inbox, /Приём сообщений выключен на сервере/u);
  assert.match(inbox, /Не удалось получить состояние WhatsApp/u);
  assert.doesNotMatch(inbox, /WAHA|crm_primary|QR|подключить канал/iu);
});

// ---------------------------------------------------------------------------
// Имя из профиля WhatsApp и больше цифр номера (просьба владельца 07.10.2026,
// миграция 278). Все номера и имена ниже выдуманы.
// ---------------------------------------------------------------------------
const CONTACT_ORG = "27800000-0000-4000-8000-000000000001";
const CHAT_A = "27800000-0000-4000-8000-0000000000a1";
const CHAT_B = "27800000-0000-4000-8000-0000000000b1";
const contactActor = Object.freeze({
  authUserId: "27800000-0000-4000-8000-000000000101", profileId: "27800000-0000-4000-8000-000000000201",
  membershipId: "27800000-0000-4000-8000-000000000301", organizationId: CONTACT_ORG,
  displayName: "Синтетический сотрудник", email: "n278@example.test",
  systemRole: "staff", assignments: [], permissionKeys: ["communication.read.full"], presentationRole: null,
  platformAccessVersion: 1,
});
function contactClient(data, error = null) {
  const calls = [];
  return {
    calls,
    client: { schema: () => ({ rpc: (name, args, options) => { calls.push({ name, args, options }); return Promise.resolve({ data, error }); } }) },
  };
}

test("WhatsApp chat names: the 278 row is exact — a name or null, the number masked to the country code and six digits", () => {
  assert.deepEqual(
    normalizePlatformWhatsAppContact({ conversation_id: CHAT_A.toUpperCase(), contact_name: "Айгуль", contact_phone: "+996 ••• 12 46 64" }),
    { conversationId: CHAT_A, name: "Айгуль", phone: "+996 ••• 12 46 64" },
  );
  assert.deepEqual(
    normalizePlatformWhatsAppContact({ conversation_id: CHAT_B, contact_name: null, contact_phone: "+7 ••• 23 45 67" }),
    { conversationId: CHAT_B, name: null, phone: "+7 ••• 23 45 67" },
  );
  for (const row of [
    { conversation_id: CHAT_A, contact_name: "Айгуль", contact_phone: "+996700124664" },
    { conversation_id: CHAT_A, contact_name: "Айгуль", contact_phone: "WhatsApp ••••4664" },
    { conversation_id: CHAT_A, contact_name: "Айгуль", contact_phone: null },
    { conversation_id: CHAT_A, contact_name: "  ", contact_phone: "+996 ••• 12 46 64" },
    { conversation_id: CHAT_A, contact_name: "Айгуль", contact_phone: "+996 ••• 12 46 64", phone: "+996700124664" },
    { conversation_id: "not-a-uuid", contact_name: "Айгуль", contact_phone: "+996 ••• 12 46 64" },
  ]) {
    assert.throws(() => normalizePlatformWhatsAppContact(row), PlatformCommunicationsRepositoryError, JSON.stringify(row));
  }
});

test("WhatsApp chat names: one GET read for the shown chats; a foreign or repeated row, no permission or more than 60 ids fail closed; one unusable row is skipped", async () => {
  const read = contactClient([
    { conversation_id: CHAT_A, contact_name: "Айгуль", contact_phone: "+996 ••• 12 46 64" },
    { conversation_id: CHAT_B, contact_name: null, contact_phone: "+996 ••• 90 46 64" },
  ]);
  const contacts = await getPlatformWhatsAppContacts(contactActor, [CHAT_A, CHAT_B, CHAT_A], { client: read.client });
  assert.deepEqual(read.calls, [{
    name: "staff_whatsapp_contacts",
    args: { p_organization_id: CONTACT_ORG, p_conversation_ids: [CHAT_A, CHAT_B] },
    options: { get: true },
  }]);
  assert.equal(contacts.get(CHAT_A)?.phone, "+996 ••• 12 46 64");
  assert.notEqual(contacts.get(CHAT_A)?.phone, contacts.get(CHAT_B)?.phone, "same last four digits, different titles");

  const none = contactClient([]);
  assert.equal((await getPlatformWhatsAppContacts(contactActor, [], { client: none.client })).size, 0);
  assert.equal(none.calls.length, 0, "nothing shown — nothing read");

  const oneBad = contactClient([
    { conversation_id: CHAT_A, contact_name: "Я".repeat(501), contact_phone: "+996 ••• 12 46 64" },
    { conversation_id: CHAT_B, contact_name: null, contact_phone: "+996 ••• 90 46 64" },
  ]);
  const partial = await getPlatformWhatsAppContacts(contactActor, [CHAT_A, CHAT_B], { client: oneBad.client });
  assert.deepEqual([...partial.keys()], [CHAT_B], "an unusable name drops only its own row; the other chat keeps its number");
  const repeated = contactClient([
    { conversation_id: CHAT_A, contact_name: "Я".repeat(501), contact_phone: "+996 ••• 12 46 64" },
    { conversation_id: CHAT_A, contact_name: "Айгуль", contact_phone: "+996 ••• 12 46 64" },
  ]);
  await assert.rejects(getPlatformWhatsAppContacts(contactActor, [CHAT_A], { client: repeated.client }), PlatformCommunicationsRepositoryError,
    "a repeated chat still fails closed, even after a dropped row");

  const foreign = contactClient([{ conversation_id: CHAT_B, contact_name: null, contact_phone: "+996 ••• 90 46 64" }]);
  await assert.rejects(getPlatformWhatsAppContacts(contactActor, [CHAT_A], { client: foreign.client }), PlatformCommunicationsRepositoryError);
  await assert.rejects(getPlatformWhatsAppContacts(contactActor, [CHAT_A], { client: contactClient(null, { code: "42501" }).client }),
    PlatformCommunicationsRepositoryError);
  await assert.rejects(getPlatformWhatsAppContacts({ ...contactActor, permissionKeys: [] }, [CHAT_A], { client: read.client }),
    PlatformCommunicationsRepositoryError);
  const many = Array.from({ length: 61 }, (_, index) => `27800000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  await assert.rejects(getPlatformWhatsAppContacts(contactActor, many, { client: read.client }), PlatformCommunicationsRepositoryError);
  assert.equal(read.calls.length, 1);
});

test("WhatsApp chat titles: profile name or «WhatsApp» with the number; no 278 row keeps the subject; list, header, journal and lead card share it", () => {
  assert.deepEqual(whatsAppChatTitle("WhatsApp ••••4664", { conversationId: CHAT_A, name: "Айгуль", phone: "+996 ••• 12 46 64" }),
    { name: "Айгуль", phone: "+996 ••• 12 46 64" });
  assert.deepEqual(whatsAppChatTitle("WhatsApp ••••4664", { conversationId: CHAT_B, name: null, phone: "+996 ••• 90 46 64" }),
    { name: "WhatsApp", phone: "+996 ••• 90 46 64" });
  assert.deepEqual(whatsAppChatTitle("Аружан Примерова", undefined), { name: "Аружан Примерова", phone: null });
  assert.equal(whatsAppChatLabel({ name: "WhatsApp", phone: "+996 ••• 90 46 64" }), "WhatsApp · +996 ••• 90 46 64");
  assert.equal(whatsAppChatLabel({ name: "Аружан Примерова", phone: null }), "Аружан Примерова");

  const adapter = source("src/lib/v3/inbox-source.ts");
  assert.match(adapter, /const title = whatsAppChatTitle\(summary\.subject, contact\);\s*return Object\.freeze\(\{\s*id: summary\.id,\s*person: title\.name,\s*phone: title\.phone,/u);
  assert.match(adapter, /readWhatsAppContacts\(actor, \[\s*\.\.\.queue\.rows\.map\(\(row\) => row\.id\),\s*\.\.\.\(thread \? \[thread\.conversation\.id\] : \[\]\),\s*\]\)/u);
  const contactSource = source("src/lib/v3/whatsapp-contact-source.ts");
  assert.match(contactSource, /\} catch \{\s*return new Map\(\);\s*\}/u, "a failed or not yet applied read falls back to the subject");
  assert.match(source("src/lib/v3/ai-agent-autosend-source.ts"), /whatsAppChatLabel\(whatsAppChatTitle\(subject, contacts\.get\(id\)\)\)/u);
  assert.match(source("src/lib/v3/profile-source.ts"), /linkedConversations: await linkedConversationsRead,/u);
  // The masked number is built by the database; the full number never reaches the page.
  assert.doesNotMatch(`${adapter}\n${contactSource}\n${source("src/components/v3/Inbox.tsx")}`, /normalized_phone|clients\.phone|\.phone\.slice/u);
});
