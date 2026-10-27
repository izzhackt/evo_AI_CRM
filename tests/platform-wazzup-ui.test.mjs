// WhatsApp через Wazzup, срез W3 (интерфейс сотрудника): строгие разборы принимают строки Wazzup, а прежние строки
// WAHA читаются как раньше; чаты Wazzup в «Продажи → WhatsApp» только для чтения; подпись эха продавца; «Скопировать
// текст» у черновиков агента; «Настройки» говорят о канале Wazzup и не показывают кнопку подключения WAHA.
// Все номера, идентификаторы и тексты ниже выдуманы. Что считает база, проверяют её наборы (325); здесь - значения и
// исходники приложения.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getPlatformWhatsAppChatState,
  getPlatformWhatsAppThread,
  listPlatformConversations,
  normalizePlatformConversationMessage,
  normalizePlatformConversationSummary,
  normalizePlatformWhatsAppChatMessage,
  normalizePlatformWhatsAppChatState,
} from "../src/lib/platform-communications.ts";
import { parsePlatformWhatsAppTransport } from "../src/lib/platform-whatsapp-transport.ts";
import { settingsIntegrations, settingsBlockingIntegrations } from "../src/lib/v3/settings-health.ts";
import {
  REPLY_ACCESS_COPY,
  SEND_REFUSAL_COPY,
  WAZZUP_ECHO_LABEL,
  chatMessageOrigin,
  conversationIsReceiveOnly,
  originWord,
  replyAccessFor,
  speakerPrefix,
} from "../src/lib/v3/whatsapp-chat.ts";
import {
  WAZZUP_FALLBACK_LINE,
  WAZZUP_READ_ONLY_LINE,
  WAZZUP_STATE_MAX_AGE_MS,
  capitalizeRu,
  isFreshWazzupState,
  wazzupCardRows,
  wazzupChannelWords,
  wazzupInboxChannelState,
} from "../src/lib/v3/wazzup-words.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = (n) => `73000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = ID(1);

const actor = Object.freeze({
  authUserId: ID(2), profileId: ID(3), membershipId: ID(4), organizationId: ORG, displayName: "Sales User",
  email: "sales@example.test", systemRole: "staff", assignments: [], permissionKeys: ["communication.read.full"],
  presentationRole: null, platformAccessVersion: 1,
});

// ---------------------------------------------------------------- строгие разборы

const summary = (overrides = {}) => ({
  conversation_id: ID(10), student_case_id: null, queue: "sales", status: "open", subject: "WhatsApp ••••0042",
  waha_session_name: null, kommo_account_id: null, kommo_conversation_id: null, amocrm_account_id: null,
  amocrm_lead_id: null, amocrm_contact_id: null, created_at: "2026-10-27T08:00:00+00:00",
  sort_at: "2026-10-27T09:00:00+00:00", last_message_direction: "inbound", last_message_at: "2026-10-27T09:00:00+00:00",
  waiting_since: "2026-10-27T09:00:00+00:00", ...overrides,
});

test("the conversation row: a Wazzup chat has no WAHA session (null); every legacy session word reads as before", () => {
  assert.equal(normalizePlatformConversationSummary(summary()).wahaSessionName, null);
  assert.equal(normalizePlatformConversationSummary(summary({ waha_session_name: "crm_primary" })).wahaSessionName, "crm_primary");
  assert.equal(normalizePlatformConversationSummary(summary({ waha_session_name: "evo-inbox" })).wahaSessionName, "evo-inbox");
  // Всё остальное строгое, как было: чужое слово, потерянный и лишний ключ, нарушенный порядок времени.
  const withoutSession = Object.fromEntries(Object.entries(summary()).filter(([key]) => key !== "waha_session_name"));
  for (const bad of [
    summary({ waha_session_name: "unknown-session" }),
    summary({ waha_session_name: "" }),
    summary({ waha_session_name: undefined }),
    withoutSession,
    { ...summary(), wazzup_channel_id: ID(77) },
    summary({ waiting_since: "2026-10-27T10:00:00+00:00" }),
    summary({ last_message_direction: "outbound" }),
  ]) {
    assert.throws(() => normalizePlatformConversationSummary(bad), /communications are unavailable/u, JSON.stringify(bad));
  }
  // Ответ сообщения без сессии принимался и раньше.
  assert.equal(normalizePlatformConversationMessage({
    message_id: ID(11), conversation_id: ID(10), direction: "inbound", body_text: "Здравствуйте", language: "ru",
    student_visible: false, waha_session_name: null, waha_message_id: null, kommo_account_id: null,
    kommo_conversation_id: null, kommo_message_id: null, amocrm_account_id: null, amocrm_lead_id: null,
    amocrm_contact_id: null, created_at: "2026-10-27T09:00:00+00:00", media: [], waha_ack_name: null, waha_ack_observed_at: null,
  }).wahaSessionName, null);
});

const message = (overrides = {}) => ({
  message_id: ID(20), direction: "inbound", body_text: "Здравствуйте", created_at: "2026-10-27T09:00:01+00:00",
  media: [], waha_ack_name: null, waha_ack_observed_at: null, origin: "client", sender_name: null, sender_membership_id: null,
  ...overrides,
});

test("the chat message row: a seller echo comes back as origin «other»; a deleted-by-client message keeps its text, like WAHA", () => {
  const echo = normalizePlatformWhatsAppChatMessage(message({ direction: "outbound", origin: "other" }));
  assert.deepEqual([echo.direction, echo.origin, echo.senderName, echo.senderMembershipId, echo.wahaAckName], ["outbound", "other", null, null, null]);
  // Удалённое клиентом сообщение в ленте сотрудника - обычная строка с прежним текстом (план §19): нового ключа нет,
  // а лишний ключ по-прежнему ломает строгий разбор, поэтому прежнее приложение не сломается до выпуска.
  const deleted = normalizePlatformWhatsAppChatMessage(message({ body_text: "Текст, который клиент потом удалил у себя" }));
  assert.equal(deleted.bodyText, "Текст, который клиент потом удалил у себя");
  assert.throws(() => normalizePlatformWhatsAppChatMessage({ ...message(), deleted: true }), /communications are unavailable/u);
  // Прежние строки: ни одна проверка согласованности не ослаблена.
  for (const bad of [
    message({ origin: "crm" }),
    message({ direction: "outbound", origin: "client" }),
    message({ direction: "outbound", origin: "other", sender_name: "Айгерим" }),
    message({ direction: "outbound", origin: "wazzup" }),
  ]) {
    assert.throws(() => normalizePlatformWhatsAppChatMessage(bad), /communications are unavailable/u, JSON.stringify(bad));
  }
});

test("the chat state of a Wazzup chat has no WAHA key and parses as before", () => {
  const state = normalizePlatformWhatsAppChatState({
    latest_inbound_message_id: ID(20), latest_inbound_at: "2026-10-27T09:00:01+00:00",
    newest_message_id: ID(21), newest_message_at: "2026-10-27T09:05:00+00:00", attempts: [],
  });
  assert.equal(state.latestInboundMessageId, ID(20));
  assert.deepEqual(state.attempts, []);
});

function routedClient(routes) {
  const calls = [];
  return {
    calls,
    client: {
      schema() {
        return {
          rpc(name, args) {
            calls.push({ name, args });
            if (!(name in routes)) return Promise.resolve({ data: null, error: { code: "PGRST202" } });
            return Promise.resolve({ data: routes[name], error: null });
          },
        };
      },
    },
  };
}

test("the readers: a list with Wazzup and WAHA chats, the open Wazzup chat and its state are read end to end", async () => {
  const wazzup = summary();
  const legacy = summary({ conversation_id: ID(12), waha_session_name: "crm_primary", subject: "WhatsApp ••••0099", sort_at: "2026-10-27T08:30:00+00:00" });
  const list = routedClient({ staff_communication_page: [wazzup, legacy] });
  const page = await listPlatformConversations(actor, { pageSize: 50 }, { client: list.client });
  assert.deepEqual(page.rows.map((row) => row.wahaSessionName), [null, "crm_primary"]);

  const thread = routedClient({
    staff_communication_snapshot: [wazzup],
    staff_whatsapp_message_page: [
      message({ message_id: ID(22), direction: "outbound", origin: "other", created_at: "2026-10-27T09:05:00+00:00" }),
      message(),
    ],
  });
  const opened = await getPlatformWhatsAppThread(actor, ID(10), { pageSize: 50 }, { client: thread.client });
  assert.equal(opened.conversation.wahaSessionName, null);
  assert.deepEqual(opened.messages.map((item) => item.origin), ["client", "other"]);

  const state = routedClient({ staff_whatsapp_chat_state: [{
    latest_inbound_message_id: ID(20), latest_inbound_at: "2026-10-27T09:00:01+00:00",
    newest_message_id: ID(22), newest_message_at: "2026-10-27T09:05:00+00:00", attempts: [],
  }] });
  assert.equal((await getPlatformWhatsAppChatState(actor, ID(10), { client: state.client })).newestMessageId, ID(22));
});

const transport = (channel, overrides = {}) => ({
  activeTransport: "wazzup", canReply: false, replyMode: "receive_only", lastInboundAt: "2026-10-27T10:05:00+00:00", channel,
  ...overrides,
});
const channel3 = { transport: "whatsapp", state: "active", observedAt: "2026-10-27T10:00:00+00:00" };

test("the transport read: the 325 answer (three channel keys) is unchanged; four last digits are optional and nothing longer", () => {
  assert.deepEqual(parsePlatformWhatsAppTransport(transport(channel3)).channel, channel3);
  assert.equal(parsePlatformWhatsAppTransport(transport({ ...channel3, last4: "0042" })).channel.last4, "0042");
  for (const bad of [
    { ...channel3, last4: "00420" }, { ...channel3, last4: 42 }, { ...channel3, last4: "00a2" }, { ...channel3, last4: null },
    { ...channel3, phone: "+996555000042" }, { ...channel3, last4: "0042", phone: "x" },
  ]) {
    assert.equal(parsePlatformWhatsAppTransport(transport(bad)), null, JSON.stringify(bad));
  }
  assert.equal(parsePlatformWhatsAppTransport(transport(null)).channel, null);
});

// ---------------------------------------------------------------- только чтение

const base = { role: "allowed", sessionName: "crm_primary", receiveOnly: false, open: true, hasClientMessage: true, channelState: "ready" };

test("reply access: Wazzup is read-only for every chat; a Wazzup chat stays read-only after a return to WAHA", () => {
  // Путь Wazzup: все чаты, в том числе прежние WAHA и закрытые.
  assert.equal(replyAccessFor({ ...base, receiveOnly: true }), "receive_only");
  assert.equal(replyAccessFor({ ...base, receiveOnly: true, sessionName: "evo-inbox" }), "receive_only");
  assert.equal(replyAccessFor({ ...base, receiveOnly: true, open: false }), "receive_only");
  assert.equal(replyAccessFor({ ...base, receiveOnly: true, hasClientMessage: false, channelState: "not_connected" }), "receive_only");
  // Беседа без сессии WAHA - беседа Wazzup: ворота базы закрыты для неё и при пути WAHA.
  assert.equal(replyAccessFor({ ...base, sessionName: null }), "receive_only");
  // Причина роли идёт первой: тому, у кого нет права, говорят о праве, а не о пути.
  assert.equal(replyAccessFor({ ...base, role: "no_permission", receiveOnly: true }), "no_permission");
  assert.equal(replyAccessFor({ ...base, role: "preview", sessionName: null }), "preview");
});

test("reply access: the WAHA rules are exactly as before", () => {
  assert.equal(replyAccessFor(base), "allowed");
  assert.equal(replyAccessFor({ ...base, channelState: "attention" }), "attention");
  assert.equal(replyAccessFor({ ...base, channelState: "not_connected" }), "not_connected");
  assert.equal(replyAccessFor({ ...base, channelState: "unknown" }), "allowed");
  assert.equal(replyAccessFor({ ...base, channelState: "intake_off" }), "allowed");
  assert.equal(replyAccessFor({ ...base, hasClientMessage: false }), "no_client_message");
  assert.equal(replyAccessFor({ ...base, open: false }), "closed");
  assert.equal(replyAccessFor({ ...base, sessionName: "evo-inbox" }), "old_session");
  assert.equal(replyAccessFor({ ...base, role: "no_permission" }), "no_permission");
});

test("the read-only line is one short sentence, shared by the chat, the table and the draft card; no composer for it", () => {
  assert.equal(WAZZUP_READ_ONLY_LINE, "Только чтение: отвечайте в amoCRM или Wazzup.");
  assert.equal(REPLY_ACCESS_COPY.receive_only, WAZZUP_READ_ONLY_LINE);
  assert.ok(WAZZUP_READ_ONLY_LINE.length <= 60);
  // Поле ответа есть только при allowed/attention: receive_only показывает строку (data-reason), а не поле.
  const chat = read("src/components/v3/inbox/InboxChat.tsx");
  assert.match(chat, /const canSend = chat\.replyAccess === "allowed" \|\| chat\.replyAccess === "attention";/u);
  assert.match(chat, /data-reason=\{chat\.replyAccess\}/u);
  assert.match(read("src/app/(v3)/v3/inbox/page.tsx"), /const canReply = selected\.chat\.replyAccess === "allowed" \|\| selected\.chat\.replyAccess === "attention";/u);
  // Отказ при гонке (путь переключили, пока сотрудник писал) прежний: текст остаётся в поле.
  assert.match(SEND_REFUSAL_COPY.receive_only, /Текст остался в поле/u);
});

// ---------------------------------------------------------------- подпись эха продавца

const outbound = (origin) => ({ inbound: false, origin, senderName: null, senderIsViewer: false });

test("a seller echo in a Wazzup chat is signed «отправлено в amoCRM/Wazzup»; no other outgoing message is", () => {
  assert.equal(chatMessageOrigin("other", false, true), "wazzup");
  assert.equal(chatMessageOrigin("other", false, false), "other", "a WAHA chat keeps its outgoing «other» without a label");
  assert.equal(chatMessageOrigin("other", true, true), "other", "an incoming message is never an echo");
  for (const origin of ["crm", "autoreply", "phone", "history", "client"]) {
    assert.equal(chatMessageOrigin(origin, false, true), origin);
  }
  assert.equal(WAZZUP_ECHO_LABEL, "отправлено в amoCRM/Wazzup");
  assert.equal(originWord(outbound("wazzup")), WAZZUP_ECHO_LABEL);
  assert.equal(originWord(outbound("other")), null);
  assert.equal(speakerPrefix(outbound("wazzup")), "Продавец, из amoCRM или Wazzup:");
  assert.equal(speakerPrefix(outbound("other")), "Продажи:");
  assert.equal(originWord({ inbound: true, origin: "client", senderName: null, senderIsViewer: false }), null);
  assert.equal(originWord({ ...outbound("phone") }), "с телефона");
});

// ---------------------------------------------------------------- слова канала

test("channel words: only «active» is working; an unknown or unseen state is neither working nor named broken", () => {
  assert.deepEqual(wazzupChannelWords("active"), { label: "подключён", tone: "ok", working: true });
  assert.deepEqual(wazzupChannelWords("ACTIVE"), { label: "подключён", tone: "ok", working: true });
  assert.equal(wazzupChannelWords("qr").label, "ждёт QR-код");
  assert.equal(wazzupChannelWords("qrIdle").label, "ждёт QR-код");
  assert.equal(wazzupChannelWords("openElsewhere").tone, "warn");
  assert.equal(wazzupChannelWords("openelsewhere").label, "открыт на другом устройстве");
  assert.deepEqual([wazzupChannelWords("notEnoughMoney").label, wazzupChannelWords("notEnoughMoney").tone], ["тариф не оплачен", "danger"]);
  assert.equal(wazzupChannelWords("blocked").tone, "danger");
  assert.deepEqual(wazzupChannelWords("somethingNew"), { label: "состояние не распознано", tone: "warn", working: false });
  assert.deepEqual(wazzupChannelWords(null), { label: "состояние не получено", tone: "warn", working: false });
  assert.equal(capitalizeRu("ждёт QR-код"), "Ждёт QR-код");
});

const wazzupTransport = (state, overrides = {}) => parsePlatformWhatsAppTransport(transport(
  state === undefined ? null : { transport: "whatsapp", state, observedAt: "2026-10-27T10:00:00+00:00" }, overrides));

// Отметка канала в `wazzupTransport` - 10:00Z; «сейчас» на пять минут позже: отметка свежая.
const OBSERVED_MS = Date.parse("2026-10-27T10:00:00Z");
const FRESH_NOW = OBSERVED_MS + 5 * 60_000;

test("the chat list banner: a working channel is not announced; trouble, a missing state and a stopped intake are", () => {
  assert.equal(wazzupInboxChannelState(wazzupTransport("active"), true, FRESH_NOW), "ready");
  assert.equal(wazzupInboxChannelState(wazzupTransport("active"), false, FRESH_NOW), "intake_off");
  assert.equal(wazzupInboxChannelState(wazzupTransport("qr"), true, FRESH_NOW), "attention");
  assert.equal(wazzupInboxChannelState(wazzupTransport("neverSeenBefore"), true, FRESH_NOW), "attention");
  assert.equal(wazzupInboxChannelState(wazzupTransport(null), true, FRESH_NOW), "unavailable");
  assert.equal(wazzupInboxChannelState(wazzupTransport(undefined), true, FRESH_NOW), "unavailable");
});

test("freshness: «работает» holds for 15 minutes of the timer's mark (three passes), not a minute longer; trouble words do not age", () => {
  assert.equal(WAZZUP_STATE_MAX_AGE_MS, 15 * 60_000);
  assert.equal(isFreshWazzupState("2026-10-27T10:00:00Z", OBSERVED_MS + WAZZUP_STATE_MAX_AGE_MS), true, "exactly 15 minutes is still fresh");
  assert.equal(isFreshWazzupState("2026-10-27T10:00:00Z", OBSERVED_MS + WAZZUP_STATE_MAX_AGE_MS + 1), false);
  assert.equal(isFreshWazzupState("2026-10-27T10:00:30Z", OBSERVED_MS), true, "a small clock skew forward is tolerated");
  assert.equal(isFreshWazzupState("2026-10-27T10:05:00Z", OBSERVED_MS), false, "a mark from the future is not a mark");
  for (const bad of [null, "", "not a date"]) assert.equal(isFreshWazzupState(bad, OBSERVED_MS), false, String(bad));
  assert.equal(isFreshWazzupState("2026-10-27T10:00:00Z", Number.NaN), false);
  const stale = { observedAt: "2026-10-27T10:00:00Z", nowMs: OBSERVED_MS + 16 * 60_000 };
  const fresh = { observedAt: "2026-10-27T10:00:00Z", nowMs: OBSERVED_MS + 14 * 60_000 };
  assert.deepEqual(wazzupChannelWords("active", fresh), { label: "подключён", tone: "ok", working: true });
  assert.deepEqual(wazzupChannelWords("active", stale), { label: "состояние не подтверждено", tone: "warn", working: false });
  assert.deepEqual(wazzupChannelWords("active", { observedAt: null, nowMs: OBSERVED_MS }), { label: "состояние не подтверждено", tone: "warn", working: false });
  // Слова неполадок от возраста не зависят: тревога остаётся тревогой.
  assert.deepEqual(wazzupChannelWords("notEnoughMoney", stale), wazzupChannelWords("notEnoughMoney"));
  assert.deepEqual(wazzupChannelWords("qr", stale), wazzupChannelWords("qr"));
  assert.deepEqual(wazzupChannelWords("somethingNew", stale), wazzupChannelWords("somethingNew"));
});

test("a stale WORKING row (key revoked, API down or the timer stopped - nothing rewrites the column) is never «Все ответы даны» and never green", () => {
  const STALE_NOW = OBSERVED_MS + 16 * 60_000;
  // «Продажи → WhatsApp»: плашка «Состояние WhatsApp не подтверждено» (`unknown`), не `ready` и не молчание.
  assert.equal(wazzupInboxChannelState(wazzupTransport("active"), true, STALE_NOW), "unknown");
  assert.equal(wazzupInboxChannelState(wazzupTransport("active"), false, STALE_NOW), "unknown", "unconfirmed outranks the stopped intake");
  assert.equal(wazzupInboxChannelState(wazzupTransport("qr"), true, STALE_NOW), "attention", "trouble stays trouble");
  assert.match(read("src/components/v3/Inbox.tsx"), /return "Состояние WhatsApp не подтверждено";/u, "the banner for `unknown` says it");
  assert.match(read("src/components/v3/Inbox.tsx"), /wholeListRead = view\.channelState === "ready"/u, "«Все ответы даны» needs `ready`");
  // «Настройки»: строка и чип не «подключён» и не зелёные.
  const stale = (settingsNow) => settingsIntegrations(facts({ wazzup: { channelState: "active", observedAt: "2026-10-27T10:00:00+00:00", intakeEnabled: true } }), settingsNow).find((row) => row.key === "whatsapp");
  const row = stale(new Date("2026-10-27T10:16:00Z"));
  assert.deepEqual([row.name, row.state, row.tone, row.blocksWork], ["WhatsApp · Wazzup", "состояние не подтверждено", "warn", false]);
  assert.match(row.without, /^Не подтверждено/u);
  assert.notEqual(row.tone, "ok");
  assert.equal(stale(new Date("2026-10-27T10:14:00Z")).state, "подключён", "inside the window the row is as before");
  // Карточка канала берёт то же слово с тем же «сейчас» (чип «Подключён» без проверки возраста был бы неправдой).
  const card = read("src/components/v3/settings/WhatsAppTransportCard.tsx");
  assert.match(card, /wazzupChannelWords\(transport\.channel\?\.state \?\? null, \{\s*observedAt: transport\.channel\?\.observedAt \?\? null,\s*nowMs: now\.getTime\(\),\s*\}\)/u);
});

test("the night autoresponder chip is off in a read-only chat: Wazzup path or a Wazzup chat, whatever the autosend settings say", () => {
  assert.equal(conversationIsReceiveOnly(true, "crm_primary"), true, "Wazzup path, a legacy WAHA chat");
  assert.equal(conversationIsReceiveOnly(false, null), true, "a chat without a WAHA session is a Wazzup chat");
  assert.equal(conversationIsReceiveOnly(true, null), true);
  assert.equal(conversationIsReceiveOnly(false, "crm_primary"), false, "the WAHA path as before");
  const source = read("src/lib/v3/inbox-source.ts");
  assert.match(source, /const receiveOnly = conversationIsReceiveOnly\(channelStatus\.receiveOnly === true, thread\.conversation\.wahaSessionName\);/u);
  assert.match(source, /readAutoreplyAtNight\(actor, thread\.conversation\.id, receiveOnly\)/u);
  assert.match(source, /if \(receiveOnly \|\| !staffHasPermission\(actor, "ai\.agent\.use"\)\) return false;/u, "no read of the autosend settings at all");
});

test("the settings card: type, last four digits only when given, last incoming, intake, no replies; no key, address or number", () => {
  const format = (iso) => (iso ? "27.10 16:05" : null);
  const plain = wazzupCardRows(wazzupTransport("active"), true, format);
  assert.deepEqual(plain, [
    { label: "Тип", value: "Обычный WhatsApp" },
    { label: "Последнее входящее", value: "27.10 16:05" },
    { label: "Приём", value: "включён" },
    { label: "Ответы из EVO", value: "нет" },
  ]);
  const waba = parsePlatformWhatsAppTransport(transport({ transport: "wapi", state: "active", observedAt: "2026-10-27T10:00:00+00:00", last4: "0042" }));
  const rows = wazzupCardRows(waba, false, format);
  assert.equal(rows[0].value, "WABA (WhatsApp Business API)");
  assert.deepEqual(rows[1], { label: "Номер", value: "••••0042" });
  assert.equal(rows.find((row) => row.label === "Приём").value, "выключен на сервере");
  assert.equal(wazzupCardRows(wazzupTransport("active", { lastInboundAt: null }), true, format).find((row) => row.label === "Последнее входящее").value, "нет за 30 дней");
  assert.doesNotMatch(JSON.stringify(rows), /\d{5}|https?:|token|key|webhook/iu);
  assert.equal(WAZZUP_FALLBACK_LINE, "Запасной путь WAHA выключен, пока работает Wazzup.");
});

// ---------------------------------------------------------------- таблица «Интеграции»

const facts = (overrides = {}) => ({
  waha: { display: "blocked", sessionStatus: "STOPPED", observedAt: null },
  gemini: "not_configured", amo: { status: "blocked", reason: "feature_disabled" }, ...overrides,
});
const NOW = new Date("2026-10-27T12:00:00Z");
const whatsappRow = (input) => settingsIntegrations(input, NOW).find((row) => row.key === "whatsapp");

test("the integrations table: the WhatsApp row speaks about the Wazzup channel and never offers the WAHA connect link", () => {
  const working = whatsappRow(facts({ wazzup: { channelState: "active", observedAt: "2026-10-27T11:55:00+00:00", intakeEnabled: true } }));
  assert.deepEqual([working.name, working.state, working.tone, working.blocksWork, working.without], ["WhatsApp · Wazzup", "подключён", "ok", false, null]);
  assert.equal(working.detail, null, "the read-only fact is in the card and in the chat, not repeated in the row");
  assert.equal(working.checkedText, "27.10 17:55");
  const broken = whatsappRow(facts({ wazzup: { channelState: "notEnoughMoney", observedAt: "2026-10-27T10:00:00+00:00", intakeEnabled: true } }));
  assert.deepEqual([broken.state, broken.tone, broken.blocksWork], ["тариф не оплачен", "blocked", true]);
  const waiting = whatsappRow(facts({ wazzup: { channelState: "qr", observedAt: null, intakeEnabled: true } }));
  assert.deepEqual([waiting.tone, waiting.blocksWork], ["warn", false]);
  const stopped = whatsappRow(facts({ wazzup: { channelState: "active", observedAt: "2026-10-27T11:55:00+00:00", intakeEnabled: false } }));
  assert.deepEqual([stopped.state, stopped.tone, stopped.blocksWork], ["приём выключен", "warn", false]);
  for (const row of [working, broken, waiting, stopped]) {
    assert.doesNotMatch(JSON.stringify(row.action), /whatsapp-connect|Подключить WhatsApp/u);
    assert.equal(row.action?.link?.href, "/v3/inbox");
  }
  assert.deepEqual(settingsBlockingIntegrations(settingsIntegrations(facts({ wazzup: { channelState: "notEnoughMoney", observedAt: null, intakeEnabled: true } }), NOW)).map((row) => row.name), ["WhatsApp · Wazzup"]);
});

test("the integrations table without Wazzup is the WAHA table as before", () => {
  const row = whatsappRow(facts());
  assert.deepEqual([row.name, row.state, row.tone, row.blocksWork], ["WhatsApp", "заблокирован", "blocked", true]);
  assert.match(row.action.link.href, /#whatsapp-connect$/u);
  assert.equal(whatsappRow(facts({ waha: { display: "ready", sessionStatus: "WORKING", observedAt: "2026-10-27T11:59:00Z" } })).state, "подключён");
});

// ---------------------------------------------------------------- исходники

test("Settings: the WAHA connect block gives way to the Wazzup card; the WAHA session is not probed while Wazzup is active", () => {
  const settings = read("src/components/v3/settings/Settings.tsx");
  assert.match(settings, /whatsappConnect\.wazzup\s*\? <WhatsAppTransportCard/u);
  assert.match(settings, /: <WhatsAppConnectSection initialStatus=/u);
  assert.match(read("src/app/(v3)/v3/settings/page.tsx"), /wazzup: whatsappConnection\.wazzup/u);
  const source = read("src/lib/v3/settings-source.ts");
  assert.match(source, /readPlatformWhatsAppTransport\(actor\)/u);
  assert.match(source, /const recordedWaha = wazzupPath \? null : await getPlatformWahaSessionHealth\(actor, "crm_primary"\);/u, "no WAHA read on the Wazzup path");
  assert.match(source, /const waha = wazzupPath\s*\? null\s*: await withLivePlatformWahaHealth\(/u, "no WAHA probe on the Wazzup path");
  const card = read("src/components/v3/settings/WhatsAppTransportCard.tsx");
  assert.ok(card.split("\n").length <= 150);
  assert.doesNotMatch(card, /"use client"|onClick|<button|<form|fetch\(|WHATSAPP_CONNECT_PATH/u, "a read-only block: no action in it");
});

test("the sales chat reads the way once, probes WAHA only on the WAHA path and gates every chat on Wazzup", () => {
  const source = read("src/lib/v3/inbox-source.ts");
  assert.match(source, /readPlatformWhatsAppTransport\(actor\)/u);
  assert.match(source, /transport\?\.activeTransport === "wazzup"/u);
  assert.match(source, /sessionName: conversation\.wahaSessionName/u);
  assert.match(source, /receiveOnly,/u);
  assert.match(source, /chatMessageOrigin\(message\.origin, message\.direction === "inbound", viaWazzup\)/u);
  assert.match(source, /const viaWazzup = thread\.conversation\.wahaSessionName === null;/u);
  assert.equal((source.match(/const viaWazzup = /gu) ?? []).length, 2, "the first page and «Показать ранее» sign the echo alike");
  // Вид страницы получает только слово канала, не внутреннее поле.
  assert.match(source, /channelState: channelStatus\.channelState,\s*conversations:/u);
});

test("agent drafts: «Скопировать текст» appears for a draft the base kept with receive_only; the send stays", () => {
  const card = read("src/components/v3/ai-agents/DraftCard.tsx");
  assert.match(card, /const receiveOnly = draft\.channel === "whatsapp" && failure === "receive_only" && effective;/u);
  assert.match(card, /<CopyTextButton text=\{canManage \? text : draft\.editedText \?\? draft\.text\} \/>/u, "the edited text is what is copied");
  assert.match(card, /className=\{receiveOnly \? QUEUE_SECONDARY : QUEUE_CONFIRM\}/u);
  assert.match(card, /data-testid="v3-aia-approve"/u);
  const button = read("src/components/v3/ai-agents/CopyTextButton.tsx");
  assert.ok(button.split("\n").length <= 150);
  assert.match(button, /navigator\.clipboard\.writeText\(text\.trim\(\)\)/u);
  assert.match(button, /"Скопировать текст"/u);
  assert.match(button, /"Не скопировалось — выделите текст вручную"/u);
  assert.match(button, /role="status"/u);
  assert.match(read("src/lib/v3/ai-agents-view.ts"), /receive_only: "WhatsApp подключён только на чтение/u);
});

test("new UI files stay within 150 lines and carry no key, address or number", () => {
  for (const file of ["src/lib/v3/wazzup-words.ts", "src/components/v3/settings/WhatsAppTransportCard.tsx", "src/components/v3/ai-agents/CopyTextButton.tsx"]) {
    const text = read(file);
    assert.ok(text.split("\n").length <= 150, file);
    assert.doesNotMatch(text, /Bearer|crmKey|api\.wazzup24|EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN|\+\d{6,}/u, file);
  }
});
