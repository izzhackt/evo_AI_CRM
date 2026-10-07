import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getPlatformWhatsAppContacts,
  normalizePlatformWhatsAppContact,
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
