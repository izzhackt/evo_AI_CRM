// «Телефония Beeline KG», срез T5 (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §9.4, §12;
// миграция 295): строки звонков в «Ленте» лида и результат звонка одним нажатием.
// Чистый контракт, слова, лента, маршрут результата с поддельной базой и настоящая
// страница лида статическим рендером (tests/e2e/numbers-static-render.cjs
// --json-telephony). Данные синтетические: ни одного настоящего номера, имени или
// ссылки на запись. Что видит и может сотрудник, решает база:
// supabase/tests/platform_telephony_lead_feed.sql.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { leadCallRow, leadFeed, leadLastContact } from "../src/components/v3/profile/lead-work-view.ts";
import { isConnectedPlatformApi } from "../src/lib/platform-route-contract.ts";
import {
  createTelephonyResultHandler,
  parseTelephonyResultBody,
  telephonyResultReceipt,
  telephonyResultRefusal,
} from "../src/lib/server/telephony-result-route-handlers.ts";
import {
  TelephonyShapeError,
  addDaysToDay,
  callContact,
  callDuration,
  callOutcomeText,
  callPeopleText,
  callRecordingText,
  callResultText,
  callTalkText,
  callTitle,
  callbackDayBounds,
  isCalendarDay,
  leadCallsState,
  leadCallsWindow,
  normalizeLeadCallsRead,
} from "../src/lib/v3/telephony-lead-calls.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
const solidRed = (html) => html.match(/(?<![\w:-])bg-accent(?![\w-])/gu)?.length ?? 0;
const ID = (n) => `29500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PHONE = "+996 ••• 00 00 01";
/** Идентификатор с буквами: в нём видно, что маршрут приводит id к нижнему регистру. */
const HEX_ID = "29500000-0000-4000-8000-00000000abcd";

/** Строка, как её отдаёт platform.telephony_lead_calls_v1 (jsonb). */
const row = (n, fields = {}) => ({
  callId: ID(n), direction: "out", state: "ended", outcome: "answered", outcomeSource: "webhook",
  startedAt: "2031-01-05T08:00:00.123456+00:00", answeredAt: "2031-01-05T08:00:05+00:00", endedAt: "2031-01-05T08:03:00+00:00",
  talkSeconds: 125, phone: PHONE, managerName: "Менеджер Первый",
  participants: [{ name: "Менеджер Первый", state: "completed" }], recording: "none",
  resultCode: null, resultAt: null, resultByName: null, callbackOn: null, resultEditable: false, ...fields,
});
const payload = (calls = [row(1)], fields = {}) => ({ enabled: true, canSetResult: true, hasMore: false, calls, ...fields });
const rejects = (value, message) => assert.throws(() => normalizeLeadCallsRead(value), TelephonyShapeError, message);

// ------------------------------------------------------------ contract

test("contract: a well-formed answer is normalised, frozen and keeps the database's order", () => {
  const read1 = normalizeLeadCallsRead(payload([row(1), row(2, { direction: "in", outcome: "missed", outcomeSource: "webhook", answeredAt: null, talkSeconds: null })]));
  assert.equal(read1.enabled, true);
  assert.deepEqual(read1.calls.map((call) => call.callId), [ID(1), ID(2)]);
  assert.equal(read1.calls[0].phone, PHONE);
  assert.ok(Object.isFrozen(read1) && Object.isFrozen(read1.calls) && Object.isFrozen(read1.calls[0]) && Object.isFrozen(read1.calls[0].participants));
  assert.equal(normalizeLeadCallsRead(payload([row(1, { callId: ID(1).toUpperCase() })])).calls[0].callId, ID(1), "ids are lower-cased");
  // A ringing call has no outcome and no source; a callback carries its day; a result carries its time.
  const ringing = row(3, { state: "ringing", outcome: null, outcomeSource: null, answeredAt: null, endedAt: null, talkSeconds: null });
  const callback = row(4, { resultCode: "callback", callbackOn: "2031-01-09", resultAt: "2031-01-05T09:00:00+00:00", resultByName: "Менеджер Первый" });
  const auto = row(5, { resultCode: "no_answer", resultAt: "2031-01-05T09:00:00+00:00" });
  assert.equal(normalizeLeadCallsRead(payload([ringing, callback, auto])).calls.length, 3);
  // Off: nothing at all.
  assert.deepEqual(normalizeLeadCallsRead({ enabled: false, canSetResult: false, hasMore: false, calls: [] }),
    { enabled: false, canSetResult: false, hasMore: false, calls: [] });
});

test("contract: a foreign shape is an error, never an empty feed", () => {
  rejects(null); rejects([]); rejects("calls"); rejects({});
  rejects({ ...payload(), extra: 1 });
  rejects({ enabled: true, canSetResult: true, hasMore: false });
  rejects(payload([row(1)], { enabled: "yes" }));
  rejects(payload([row(1)], { calls: "none" }));
  rejects(payload(Array.from({ length: 101 }, (_, index) => row(index + 1))));
  // The off switch carries nothing.
  rejects({ enabled: false, canSetResult: false, hasMore: false, calls: [row(1)] });
  rejects({ enabled: false, canSetResult: true, hasMore: false, calls: [] });
  rejects({ enabled: false, canSetResult: false, hasMore: true, calls: [] });
  // Nothing can be pressed when the switch says nothing can be set.
  rejects(payload([row(1, { resultEditable: true })], { canSetResult: false }));
  // Row keys: exact set, no key more or less.
  const keys = Object.keys(row(1));
  assert.equal(keys.length, 18);
  for (const key of keys) {
    const without = Object.fromEntries(Object.entries(row(1)).filter(([name]) => name !== key));
    rejects(payload([without]), `missing ${key}`);
  }
  rejects(payload([{ ...row(1), recording_link: "https://example.invalid/x.mp3" }]));
  rejects(payload([{ ...row(1), clientPhone: "+996700000001" }]));
});

test("contract: values are checked one by one", () => {
  const bad = (fields, why) => rejects(payload([row(1, fields)]), why);
  bad({ callId: "not-a-uuid" }, "id");
  bad({ direction: "sideways" }, "direction");
  bad({ state: "paused" }, "state");
  bad({ outcome: "ok" }, "outcome");
  bad({ outcomeSource: "guess" }, "source");
  bad({ outcome: null }, "an outcome without a source");
  bad({ outcomeSource: null }, "a source without an outcome");
  bad({ startedAt: "yesterday" }, "time");
  bad({ startedAt: "2031-01-05" }, "date without time");
  bad({ startedAt: null }, "no start");
  bad({ talkSeconds: -1 }, "negative talk");
  bad({ talkSeconds: 1.5 }, "fractional talk");
  bad({ talkSeconds: 86_401 }, "talk over a day");
  bad({ talkSeconds: "125" }, "talk as text");
  bad({ recording: "playable" }, "recording state");
  bad({ resultCode: "done" }, "result code");
  bad({ resultCode: "reached" }, "a result without time");
  bad({ resultAt: "2031-01-05T09:00:00+00:00" }, "a time without a result");
  bad({ resultCode: "callback", resultAt: "2031-01-05T09:00:00+00:00" }, "a callback without its day");
  bad({ resultCode: "reached", resultAt: "2031-01-05T09:00:00+00:00", callbackOn: "2031-01-09" }, "a day without a callback");
  bad({ resultCode: "callback", resultAt: "2031-01-05T09:00:00+00:00", callbackOn: "2031-02-30" }, "an impossible day");
  bad({ resultCode: "callback", resultAt: "2031-01-05T09:00:00+00:00", callbackOn: "2019-12-31" }, "a day before the database range");
  bad({ resultEditable: "yes" }, "editable as text");
  bad({ managerName: "" }, "blank name");
  bad({ managerName: "Имя\nс переводом" }, "control character in a name");
  bad({ managerName: "я".repeat(201) }, "long name");
  bad({ participants: "none" }, "participants as text");
  bad({ participants: Array.from({ length: 7 }, () => ({ name: "Имя", state: "missed" })) }, "too many participants");
  bad({ participants: [{ name: "Имя", state: "dancing" }] }, "participant state");
  bad({ participants: [{ name: "Имя", state: "missed", phone: "+996700000001" }] }, "extra participant key");
});

test("contract: the phone is only ever a mask — anything that looks like a number is a leak and a foreign shape", () => {
  for (const masked of ["+996 ••• 00 00 01", "+7 ••• 1 23 45", "+1 ••• 2 34 56", "+971 ••• 5 66 77", "+86 ••• 12 34"]) {
    assert.equal(normalizeLeadCallsRead(payload([row(1, { phone: masked })])).calls[0].phone, masked, masked);
  }
  assert.equal(normalizeLeadCallsRead(payload([row(1, { phone: null })])).calls[0].phone, null, "a call without a number has none");
  for (const leaked of ["+996700000001", "996700000001", "+996 700 000 001", "0700 000 001", "+996 ••• 700000001", "+996 •••", "••• 00 00 01",
    "+996 ••• 00 00 01 22", "tel:+996700000001", "https://example.invalid/rec.mp3", 996700000001, ""]) {
    rejects(payload([row(1, { phone: leaked })]), String(leaked));
  }
});

test("state: off, ready and unavailable are told apart", () => {
  assert.deepEqual(leadCallsState({ enabled: false, canSetResult: false, hasMore: false, calls: [] }), { status: "off" });
  const ready = leadCallsState(payload([row(1)], { hasMore: true }));
  assert.equal(ready.status, "ready");
  assert.equal(ready.hasMore, true);
  assert.equal(ready.canSetResult, true);
  assert.equal(ready.calls.length, 1);
  for (const garbage of [null, undefined, {}, "x", payload([row(1, { phone: "+996700000001" })])]) {
    assert.deepEqual(leadCallsState(garbage), { status: "unavailable" });
  }
});

test("window: a notes page reads the calls of its own period and the pages tile the time without overlap", () => {
  const notes = (...times) => ({ rows: times.map((createdAt) => ({ createdAt })), hasNext: false });
  // Everything on one page: no bounds.
  assert.deepEqual(leadCallsWindow(notes("2031-01-05T09:00:00.000001+00:00"), null), { since: null, until: null });
  // First page with more notes behind it: from its oldest note on, no upper bound.
  assert.deepEqual(leadCallsWindow({ ...notes("2031-01-05T09:00:00+00:00", "2031-01-03T09:00:00.123456+00:00"), hasNext: true }, null),
    { since: "2031-01-03T09:00:00.123456+00:00", until: null });
  // A middle page: between its oldest note and the boundary of the previous page — as received, microseconds kept.
  assert.deepEqual(leadCallsWindow({ ...notes("2031-01-02T09:00:00+00:00", "2030-12-20T09:00:00+00:00"), hasNext: true },
    { createdAt: "2031-01-03T09:00:00.123456+00:00" }), { since: "2030-12-20T09:00:00+00:00", until: "2031-01-03T09:00:00.123456+00:00" });
  // The last page: nothing older than its boundary is cut off below.
  assert.deepEqual(leadCallsWindow(notes("2030-12-10T09:00:00+00:00"), { createdAt: "2030-12-20T09:00:00+00:00" }),
    { since: null, until: "2030-12-20T09:00:00+00:00" });
  // No notes at all: the whole history.
  assert.deepEqual(leadCallsWindow({ rows: [], hasNext: false }, null), { since: null, until: null });
});

// ------------------------------------------------------------ words

test("words: direction, outcome, talk time, people, recording and result are plain Russian", () => {
  assert.equal(callTitle({ direction: "in" }), "Входящий звонок");
  assert.equal(callTitle({ direction: "out" }), "Исходящий звонок");
  // Число и единица не рвутся на узком экране: между ними неразрывный пробел.
  const nb = (value) => value.replaceAll(/(?<=\d) (?=[а-я])/gu, "\u00A0");
  assert.deepEqual([0, 7, 59, 60, 61, 125, 3599, 3600, 3660, 7325].map(callDuration),
    ["0 с", "7 с", "59 с", "1 мин", "1 мин 01 с", "2 мин 05 с", "59 мин 59 с", "1 ч", "1 ч 01 мин", "2 ч 02 мин"].map(nb));
  assert.equal(callDuration(125), "2\u00A0мин 05\u00A0с");
  assert.equal(callDuration(-5), nb("0 с"));
  const outcomes = (direction, outcomeSource = "webhook") => ["answered", "missed", "cancelled", "busy", "unavailable", "not_found", "not_allowed", "no_answer_unknown"]
    .map((outcome) => callOutcomeText({ direction, state: "ended", outcome, outcomeSource }));
  assert.deepEqual(outcomes("in", "webhook"), ["разговор", "пропущен", "отменён", "занято", "недоступен", "номер не найден", "направление закрыто", "без ответа"]);
  assert.equal(callOutcomeText({ direction: "out", state: "ended", outcome: "missed", outcomeSource: "webhook" }), "не ответили");
  // An outcome from reconciliation is inexact: the words do not claim «занято» or «пропущен».
  assert.deepEqual(outcomes("in", "pull").slice(1), Array(7).fill("без ответа"));
  assert.equal(callOutcomeText({ direction: "in", state: "ended", outcome: "answered", outcomeSource: "pull" }), "разговор");
  assert.equal(callOutcomeText({ direction: "in", state: "ringing", outcome: null, outcomeSource: null }), "идёт вызов");
  assert.equal(callOutcomeText({ direction: "in", state: "answered", outcome: null, outcomeSource: null }), "идёт разговор");
  // Talk time: only an answered call has it, and an unknown one is «—», never zero.
  assert.equal(callTalkText({ outcome: "answered", talkSeconds: 125 }), "2\u00A0мин 05\u00A0с");
  assert.equal(callTalkText({ outcome: "answered", talkSeconds: null }), "—");
  assert.equal(callTalkText({ outcome: "answered", talkSeconds: 0 }), "0\u00A0с");
  assert.equal(callTalkText({ outcome: "missed", talkSeconds: null }), null);
  assert.equal(callTalkText({ outcome: null, talkSeconds: null }), null);
  assert.deepEqual(["none", "available", "unavailable", "expired"].map(callRecordingText),
    [null, "Есть запись", "Запись временно недоступна", "Запись удалена по сроку хранения"]);
  assert.equal(callPeopleText({ managerName: "Менеджер Первый", participants: [], outcome: "answered" }), "Менеджер Первый");
  assert.equal(callPeopleText({ managerName: null, participants: [{ name: "А", state: "missed" }, { name: "Б", state: "missed" }, { name: "А", state: "missed" }], outcome: "missed" }),
    "вызывали: А, Б");
  assert.equal(callPeopleText({ managerName: null, participants: [], outcome: "busy" }), null);
  assert.equal(callPeopleText({ managerName: null, participants: [{ name: "А", state: "completed" }], outcome: "answered" }), null, "an answered call is never described by who was rung");
  const day = (value) => value.slice(8, 10) + "." + value.slice(5, 7);
  assert.deepEqual([
    callResultText({ resultCode: null, callbackOn: null }, day),
    callResultText({ resultCode: "reached", callbackOn: null }, day),
    callResultText({ resultCode: "callback", callbackOn: "2031-01-09" }, day),
    callResultText({ resultCode: "not_interested", callbackOn: null }, day),
    callResultText({ resultCode: "no_answer", callbackOn: null }, day),
  ], [null, "Дозвонился", "Перезвонить 09.01", "Не интересно", "Недозвон"]);
});

test("words: «Последний контакт» counts a talk and a client's missed call, not our unanswered attempts", () => {
  const at = "2031-01-05T08:00:00+00:00";
  assert.deepEqual(callContact({ direction: "out", outcome: "answered", startedAt: at }), { at, what: "звонок" });
  assert.deepEqual(callContact({ direction: "in", outcome: "answered", startedAt: at }), { at, what: "звонок" });
  assert.deepEqual(callContact({ direction: "in", outcome: "missed", startedAt: at }), { at, what: "пропущенный звонок" });
  assert.deepEqual(callContact({ direction: "in", outcome: "cancelled", startedAt: at }), { at, what: "пропущенный звонок" });
  assert.equal(callContact({ direction: "out", outcome: "missed", startedAt: at }), null);
  assert.equal(callContact({ direction: "out", outcome: "busy", startedAt: at }), null);
  assert.equal(callContact({ direction: "in", outcome: null, startedAt: at }), null, "a call that is still ringing is not a contact yet");
});

test("days: callback bounds are today..today+365 and the default is tomorrow", () => {
  assert.equal(addDaysToDay("2031-01-31", 1), "2031-02-01");
  assert.equal(addDaysToDay("2031-12-31", 1), "2032-01-01");
  assert.equal(addDaysToDay("2032-02-28", 1), "2032-02-29");
  assert.equal(addDaysToDay("2031-03-01", -1), "2031-02-28");
  assert.deepEqual(callbackDayBounds("2031-01-05"), { min: "2031-01-05", max: "2032-01-05", fallback: "2031-01-06" });
  assert.throws(() => addDaysToDay("2031-02-30", 1));
  assert.equal(isCalendarDay("2031-02-28"), true);
  for (const wrong of ["2031-02-30", "2031-2-3", "2031-13-01", "2019-12-31", "2201-01-01", "", null, 20310105, "2031-01-05T00:00:00Z"]) {
    assert.equal(isCalendarDay(wrong), false, String(wrong));
  }
});

// ------------------------------------------------------------ the feed

const note = (body, createdAt) => ({ body, authorDisplayName: "Автор", createdAt });
const event = (key, at) => ({ key, at, text: key });
const call = (n, startedAt, fields = {}) => normalizeLeadCallsRead(payload([row(n, { startedAt, ...fields })])).calls[0];

test("feed: calls stand among notes and events by time, newest first, ties keep note, event, call", () => {
  const notes = [note("n-new", "2031-01-05T12:00:00+00:00"), note("n-old", "2031-01-02T12:00:00+00:00")];
  const events = [event("created", "2031-01-01T08:00:00+00:00")];
  const calls = [call(1, "2031-01-05T13:00:00+00:00"), call(2, "2031-01-03T08:00:00+00:00"), call(3, "2031-01-01T08:00:00+00:00")];
  const key = (item) => item.kind === "note" ? item.note.body : item.kind === "event" ? item.event.key : `call-${item.call.callId.slice(-1)}`;
  assert.deepEqual(leadFeed(notes, events, true, calls).map(key), ["call-1", "n-new", "call-2", "n-old", "created", "call-3"]);
  // Events are first-page only; calls come from the window of their own page and are never dropped.
  assert.deepEqual(leadFeed(notes, events, false, calls).map(key), ["call-1", "n-new", "call-2", "n-old", "call-3"]);
  // Without calls the feed is exactly the old one.
  assert.deepEqual(leadFeed(notes, events, true).map(key), ["n-new", "n-old", "created"]);
  assert.deepEqual(leadFeed(notes, events, true, []).map(key), ["n-new", "n-old", "created"]);
  assert.deepEqual(leadFeed([], [], true, [call(4, "2031-01-05T12:00:00+00:00")]).map(key), ["call-4"], "a lead with only calls has a feed");
});

test("feed: «Последний контакт» takes the newest of note, chat and call and names it", () => {
  const answered = call(1, "2031-01-05T13:00:00+00:00");
  const missedIn = call(2, "2031-01-05T14:00:00+00:00", { direction: "in", outcome: "missed", answeredAt: null, talkSeconds: null });
  const triedOut = call(3, "2031-01-05T15:00:00+00:00", { outcome: "busy", answeredAt: null, talkSeconds: null });
  const ringing = call(4, "2031-01-05T16:00:00+00:00", { state: "ringing", outcome: null, outcomeSource: null, answeredAt: null, endedAt: null, talkSeconds: null });
  assert.deepEqual(leadLastContact("2031-01-05T12:00:00+00:00", [], [answered]), { at: answered.startedAt, what: "звонок" });
  assert.deepEqual(leadLastContact("2031-01-05T12:00:00+00:00", [], [answered, missedIn]), { at: missedIn.startedAt, what: "пропущенный звонок" });
  assert.deepEqual(leadLastContact("2031-01-05T12:00:00+00:00", [], [answered, missedIn, triedOut, ringing]), { at: missedIn.startedAt, what: "пропущенный звонок" },
    "our unanswered attempt and a ringing call are newer but are not contact");
  assert.deepEqual(leadLastContact("2031-01-05T17:00:00+00:00", [{ updatedAt: "2031-01-05T18:00:00+00:00" }], [answered]),
    { at: "2031-01-05T18:00:00+00:00", what: "переписка" });
  assert.deepEqual(leadLastContact("2031-01-05T19:00:00+00:00", [], [answered]), { at: "2031-01-05T19:00:00+00:00", what: "заметка" });
  assert.equal(leadLastContact(null, [], [triedOut, ringing]), null);
  assert.deepEqual(leadLastContact(null, []), null, "the old two-argument call still works");
});

test("row: the words of one call row come from what the database gave, nothing is made up", () => {
  const now = new Date("2031-01-06T06:00:00.000Z");
  const talked = leadCallRow(call(1, "2031-01-05T08:00:00+00:00", { recording: "available" }), now);
  assert.deepEqual(talked, {
    title: "Исходящий звонок", outcome: "разговор 2\u00A0мин 05\u00A0с", details: `${PHONE} · Менеджер Первый · Есть запись`,
    result: null, callbackLabel: null,
  });
  const unknownTalk = leadCallRow(call(2, "2031-01-05T08:00:00+00:00", { direction: "in", talkSeconds: null, recording: "expired" }), now);
  assert.equal(unknownTalk.outcome, "разговор —", "talk time is «—» until reconciliation brings it, not zero");
  assert.equal(unknownTalk.details, `${PHONE} · Менеджер Первый · Запись удалена по сроку хранения`);
  const missed = leadCallRow(call(3, "2031-01-05T08:00:00+00:00", {
    direction: "in", outcome: "missed", answeredAt: null, talkSeconds: null, managerName: null,
    participants: [{ name: "Менеджер Первый", state: "missed" }, { name: "Менеджер Второй", state: "missed" }],
  }), now);
  assert.deepEqual([missed.outcome, missed.details], ["пропущен", `${PHONE} · вызывали: Менеджер Первый, Менеджер Второй`]);
  const noNumber = leadCallRow(call(4, "2031-01-05T08:00:00+00:00", { outcome: "busy", answeredAt: null, talkSeconds: null, managerName: null, participants: [], phone: null }), now);
  assert.deepEqual([noNumber.outcome, noNumber.details], ["занято", null]);
  const withResult = leadCallRow(call(5, "2031-01-05T08:00:00+00:00", {
    resultCode: "callback", callbackOn: "2031-01-09", resultAt: "2031-01-05T09:10:00+00:00", resultByName: "Менеджер Первый",
  }), now);
  assert.equal(withResult.result, "Результат: Перезвонить 09.01 · Менеджер Первый · 05.01 15:10");
  assert.equal(withResult.callbackLabel, "Перезвонить 09.01");
  const auto = leadCallRow(call(6, "2031-01-05T08:00:00+00:00", { resultCode: "no_answer", resultAt: "2031-01-05T09:10:00+00:00" }), now);
  assert.equal(auto.result, "Результат: Недозвон · 05.01 15:10", "the system's press has no author");
  assert.equal(auto.callbackLabel, null);
});

// ------------------------------------------------------------ the route

const ACTOR = Object.freeze({ organizationId: ID(90), membershipId: ID(91) });
const origin = { origin: "https://crm.test", host: "crm.test" };
const post = (callId, body, headers = {}, query = "") => new Request(`https://crm.test/api/v3/telephony/calls/${callId}/result${query}`, {
  method: "POST", headers: { "content-type": "application/json", ...origin, ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const context = (callId = ID(1)) => ({ params: Promise.resolve({ callId }) });
function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    authorize: async () => ({ status: "authorized", actor: ACTOR }),
    setResult: async (actor, callId, input) => {
      calls.push([actor, callId, input]);
      return { status: "saved", resultCode: input.result, resultAt: "2031-01-05T09:00:00.123456+00:00", callbackOn: input.callbackOn };
    },
    ...overrides,
  };
}

test("route: sameOrigin first, then the session, then the body; the database sees only a clean press", async () => {
  const d = deps();
  const handler = createTelephonyResultHandler(d);
  const ok = await handler(post(ID(1), { result: "reached" }), context());
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ok.json(), { status: "saved", resultCode: "reached", resultAt: "2031-01-05T09:00:00.123456+00:00", callbackOn: null });
  const callback = await handler(post(ID(2), { result: "callback", callbackOn: "2031-01-09" }), context(ID(2)));
  assert.deepEqual(await callback.json(), { status: "saved", resultCode: "callback", resultAt: "2031-01-05T09:00:00.123456+00:00", callbackOn: "2031-01-09" });
  const lower = await handler(post(HEX_ID, { result: "not_interested" }), context(HEX_ID.toUpperCase()));
  assert.equal(lower.status, 200);
  assert.deepEqual(d.calls, [
    [ACTOR, ID(1), { result: "reached", callbackOn: null }],
    [ACTOR, ID(2), { result: "callback", callbackOn: "2031-01-09" }],
    [ACTOR, HEX_ID, { result: "not_interested", callbackOn: null }],
  ], "ids are lower-cased and a plain press carries no day");
});

test("route: a foreign origin, a missing origin and a forged host are refused before anything else", async () => {
  const d = deps({ authorize: async () => { throw new Error("must not authorize"); } });
  const handler = createTelephonyResultHandler(d);
  const body = { result: "reached" };
  const refused = [
    await handler(post(ID(1), body, { origin: "https://evil.test" }), context()),
    await handler(post(ID(1), body, { origin: "http://crm.test" }), context()),
    await handler(new Request(`https://crm.test/api/v3/telephony/calls/${ID(1)}/result`, {
      method: "POST", headers: { "content-type": "application/json", host: "crm.test" }, body: JSON.stringify(body) }), context()),
    await handler(post(ID(1), body, { host: "evil.test" }), context()),
    await handler(post(ID(1), body, { origin: "null" }), context()),
  ];
  for (const response of refused) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: "forbidden" } });
  }
  assert.equal(d.calls.length, 0);
});

test("route: no session, no right, a role preview and a broken session never reach the database", async () => {
  for (const [status, http, code] of [["anonymous", 401, "authentication_required"], ["forbidden", 403, "forbidden"],
    ["preview", 403, "preview"], ["unavailable", 503, "unavailable"]]) {
    const d = deps({ authorize: async () => ({ status, actor: null }) });
    const response = await createTelephonyResultHandler(d)(post(ID(1), { result: "reached" }), context());
    assert.equal(response.status, http, status);
    assert.deepEqual(await response.json(), { error: { code } });
    assert.equal(d.calls.length, 0, status);
  }
  const throwing = deps({ authorize: async () => { throw new Error("db"); } });
  assert.equal((await createTelephonyResultHandler(throwing)(post(ID(1), { result: "reached" }), context())).status, 503);
});

test("route: the body is exact — result, and callbackOn only for «Перезвонить»", async () => {
  const d = deps();
  const handler = createTelephonyResultHandler(d);
  const invalid = [
    {}, { result: "no_answer" }, { result: "busy" }, { result: 1 }, { result: null }, { result: "reached", callbackOn: "2031-01-09" },
    { result: "not_interested", callbackOn: "2031-01-09" }, { result: "callback" }, { result: "callback", callbackOn: null },
    { result: "callback", callbackOn: "2031-02-30" }, { result: "callback", callbackOn: "09.01.2031" }, { result: "callback", callbackOn: 20310109 },
    { result: "callback", callbackOn: "2031-01-09T10:00:00Z" }, { result: "reached", extra: 1 }, { result: "reached", callId: ID(1) },
    [], "reached", "{broken", "null", "[]",
  ];
  for (const body of invalid) {
    const response = await handler(post(ID(1), typeof body === "string" ? body : body), context());
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: { code: "invalid_request" } });
  }
  for (const callId of ["not-a-uuid", "00000000-0000-0000-0000-000000000000", `${ID(1)}x`, "1"]) {
    assert.equal((await handler(post(ID(1), { result: "reached" }), context(callId))).status, 400, callId);
  }
  assert.equal((await handler(post(ID(1), { result: "reached" }, {}, "?force=1"), context())).status, 400, "a query string is refused");
  assert.equal((await handler(post(ID(1), { result: "reached" }, { "content-type": "text/plain" }), context())).status, 400);
  assert.equal((await handler(post(ID(1), JSON.stringify({ result: "reached", pad: "x".repeat(2000) })), context())).status, 400, "the body is small");
  assert.equal(d.calls.length, 0, "no invalid request reached the database");
  // The parser on its own.
  assert.deepEqual(parseTelephonyResultBody({ result: "callback", callbackOn: "2031-01-09" }), { result: "callback", callbackOn: "2031-01-09" });
  assert.deepEqual(parseTelephonyResultBody({ result: "reached", callbackOn: null }), { result: "reached", callbackOn: null });
  assert.equal(parseTelephonyResultBody(null), null);
});

test("route: the database's refusals become the documented statuses, with codes that do not reveal why", async () => {
  const table = [
    ["forbidden", 403, "forbidden"], ["not_found", 404, "not_found"], ["not_answered", 409, "not_answered"], ["closed", 409, "result_closed"],
    ["off", 409, "telephony_off"], ["invalid_date", 422, "invalid_date"], ["invalid", 400, "invalid_request"], ["unavailable", 503, "unavailable"],
  ];
  for (const [status, http, code] of table) {
    const response = await createTelephonyResultHandler(deps({ setResult: async () => ({ status }) }))(post(ID(1), { result: "reached" }), context());
    assert.equal(response.status, http, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }
  const failing = createTelephonyResultHandler(deps({ setResult: async () => { throw new Error("db password=secret"); } }));
  const response = await failing(post(ID(1), { result: "reached" }), context());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "unavailable" } }, "an exception text never reaches the browser");
});

test("route: SQLSTATEs of migration 295 map to outcomes; the receipt must be the documented shape", () => {
  assert.deepEqual(telephonyResultRefusal({ code: "42501", message: "telephony_result_forbidden" }), { status: "forbidden" });
  assert.deepEqual(telephonyResultRefusal({ code: "P0002", message: "telephony_call_unavailable" }), { status: "not_found" });
  assert.deepEqual(telephonyResultRefusal({ code: "55000", message: "telephony_result_disabled" }), { status: "off" });
  assert.deepEqual(telephonyResultRefusal({ code: "PT409", message: "telephony_result_not_answered" }), { status: "not_answered" });
  assert.deepEqual(telephonyResultRefusal({ code: "PT409", message: "telephony_result_closed" }), { status: "closed" });
  assert.deepEqual(telephonyResultRefusal({ code: "22023", message: "telephony_result_date_invalid" }), { status: "invalid_date" });
  assert.deepEqual(telephonyResultRefusal({ code: "22023", message: "telephony_result_invalid" }), { status: "invalid" });
  assert.deepEqual(telephonyResultRefusal({ code: "XX000", message: "boom" }), { status: "unavailable" });
  assert.deepEqual(telephonyResultRefusal({}), { status: "unavailable" });
  // The messages the route keys on exist in the migration, once each.
  const migration = read("supabase/migrations/295_platform_telephony_lead_feed.sql");
  for (const message of ["telephony_result_forbidden", "telephony_call_unavailable", "telephony_result_disabled",
    "telephony_result_not_answered", "telephony_result_closed", "telephony_result_date_invalid", "telephony_result_invalid"]) {
    assert.match(migration, new RegExp(`RAISE EXCEPTION '${message}'`, "u"), message);
  }
  const good = { status: "saved", callId: ID(1), resultCode: "reached", resultAt: "2031-01-05T09:00:00+00:00", callbackOn: null };
  assert.deepEqual(telephonyResultReceipt(good), { status: "saved", resultCode: "reached", resultAt: "2031-01-05T09:00:00+00:00", callbackOn: null });
  assert.equal(telephonyResultReceipt({ ...good, status: "unchanged" }).status, "unchanged");
  assert.equal(telephonyResultReceipt({ ...good, resultCode: "callback", callbackOn: "2031-01-09" }).callbackOn, "2031-01-09");
  for (const bad of [null, [], "saved", {}, { ...good, status: "queued" }, { ...good, resultCode: "no_answer" }, { ...good, resultCode: "callback" },
    { ...good, callbackOn: "2031-01-09" }, { ...good, resultAt: "soon" }, { ...good, resultAt: null }, { ...good, callbackOn: "2031-02-30", resultCode: "callback" }]) {
    assert.deepEqual(telephonyResultReceipt(bad), { status: "unavailable" }, JSON.stringify(bad));
  }
});

// The recordings stream path (GET) is connected by slice T6 and checked strictly in
// tests/platform-telephony-recordings.test.mjs; this list is about the result path only.
test("route contract: exactly the strict POST path is connected; its near misses are not", () => {
  const path = `/api/v3/telephony/calls/${ID(1)}/result`;
  assert.equal(isConnectedPlatformApi(path), true);
  assert.equal(isConnectedPlatformApi(`/api/v3/telephony/calls/${HEX_ID}/result`), true);
  for (const wrong of [
    `${path}/`, `${path}/x`, `/api/v3/telephony/calls/${ID(1)}`, `/api/v3/telephony/calls/${HEX_ID.toUpperCase()}/result`,
    "/api/v3/telephony/calls/not-a-uuid/result", `/api/v3/telephony/calls/${ID(1)}/results`, `/api/v3/telephony/calls//result`,
    `/api/v3/telephony/calls/${ID(1)}%2fresult`, `/api/v3/telephony/call/${ID(1)}/result`, `/api/v3/telephony/dial`,
    `/api/v2/telephony/calls/${ID(1)}/result`, `/api/v3/telephony/calls/${ID(1)}/result.json`,
  ]) {
    assert.equal(isConnectedPlatformApi(wrong), false, wrong);
  }
});

// ------------------------------------------------------------ files and wiring

test("wiring: the route file, the source, the page and the migration agree", () => {
  const migration = read("supabase/migrations/295_platform_telephony_lead_feed.sql");
  const source = read("src/lib/v3/telephony-lead-calls-source.ts");
  const handlers = read("src/lib/server/telephony-result-route-handlers.ts");
  const route = read("src/app/api/v3/telephony/calls/[callId]/result/route.ts");
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  const parts = read("src/components/v3/profile/LeadWorkParts.tsx");
  const control = read("src/components/v3/profile/LeadCallResult.tsx");
  // The route: one POST, node runtime, no cache.
  assert.match(route, /export const POST = createTelephonyResultHandler\(\);/u);
  assert.match(route, /export const runtime = "nodejs";/u);
  assert.match(route, /export const dynamic = "force-dynamic";/u);
  assert.doesNotMatch(route, /export (?:const|async function) (?:GET|PUT|PATCH|DELETE)\b/u);
  // The RPC parameter names in TypeScript are the SQL parameter names, in both directions.
  const params = (name) => [...migration.match(new RegExp(`FUNCTION platform\\.${name}\\(([^)]*)\\)`, "u"))[1].matchAll(/\bp_[a-z_]+/gu)].map((match) => match[0]).sort();
  const used = (file, name) => [...file.match(new RegExp(`rpc\\("${name}", \\{([^}]*)\\}`, "u"))[1].matchAll(/\bp_[a-z_]+/gu)].map((match) => match[0]).sort();
  assert.deepEqual(used(source, "telephony_lead_calls_v1"), params("telephony_lead_calls_v1"));
  assert.deepEqual(used(handlers, "telephony_set_result_v1"), params("telephony_set_result_v1"));
  // The switch lives in the database; the page reads only the overview tab of a lead and hands the answer down.
  assert.match(page, /leadSales && tab === "overview" && view && view\.details\.routeTarget\.leadId/u);
  assert.match(page, /readLeadCalls\(actor, view\.details\.routeTarget\.leadId, leadCallsWindow\(view\.notes\.page, noteCursor\)\)/u);
  assert.match(page, /calls: leadCalls,/u);
  assert.match(parts, /leadFeed\(input\.notes\.rows, events, firstNotesPage, callRows\)/u);
  assert.match(parts, /!preview && item\.call\.resultEditable/u, "a role preview writes nothing");
  // The client control talks to the one route with a same-origin POST.
  assert.match(control, /fetch\(`\/api\/v3\/telephony\/calls\/\$\{callId\}\/result`, \{\s*method: "POST"/u);
  assert.match(control, /credentials: "same-origin"/u);
  // Nothing new knows a recording link or a full client number.
  for (const [name, file] of Object.entries({ source, handlers, route, parts, control, contract: read("src/lib/v3/telephony-lead-calls.ts"),
    view: read("src/components/v3/profile/lead-work-view.ts"), row: read("src/components/v3/profile/FeedRow.tsx") })) {
    assert.doesNotMatch(file, /recording_link|client_phone|recordingLink|clientPhone/u, name);
  }
  // «Перезвонить» promises no reminder: the task comes with slice T8.
  assert.doesNotMatch(control, /напомн/u);
  assert.match(migration, /Задачу «Перезвонить» из этой даты создаёт срез T8/u);
});

// ------------------------------------------------------------ the rendered page

const pages = new Map(JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL("./e2e/numbers-static-render.cjs", import.meta.url)), "--json-telephony"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).map((page) => [page.name, page.html]));
const callRows = (html) => html.match(/<li [^>]*data-feed="call"[^>]*>[\s\S]*?<\/li>/gu) ?? [];

test("rendered lead: with the switch off or no answer the feed is byte-for-byte the old one", () => {
  const none = pages.get("lead-none");
  assert.equal(pages.get("lead-off"), none, "«off» draws nothing at all");
  assert.equal(callRows(none).length, 0);
  assert.doesNotMatch(text(none), /Звонки не загрузились|звонков\./u);
  assert.match(none, /data-testid="v3-lead-feed-items"/u);
  assert.match(text(none), /Последний контакт 25\.09 15:40 · заметка/u);
});

test("rendered lead: call rows stand in the feed by time with the words, the mask and the result strip", () => {
  const html = pages.get("lead-ready");
  const rows = callRows(html);
  assert.equal(rows.length, 5);
  const feed = html.slice(html.indexOf('data-testid="v3-lead-feed-items"'), html.indexOf("</ol>", html.indexOf('data-testid="v3-lead-feed-items"')));
  const order = [...feed.matchAll(/data-feed="(call|note|event)"/gu)].map((match) => match[1]);
  assert.deepEqual(order, ["call", "call", "call", "note", "call", "note", "call", "event"], "calls and notes interleave by time, the lead's creation last");
  const [first, missed, unknownTalk, , , ] = rows.map(text);
  assert.match(first, /^Исходящий звонок · разговор 2 мин 05 с 26\.09 14:00 \+996 ••• 00 00 01 · Санжар Эскизов · Есть запись/u);
  assert.match(missed, /^Входящий звонок · пропущен 26\.09 13:00 \+996 ••• 00 00 01 · вызывали: Санжар Эскизов, Алия Учебная$/u);
  assert.match(unknownTalk, /^Входящий звонок · разговор — 25\.09 16:00 .*Запись удалена по сроку хранения Результат: Дозвонился · Санжар Эскизов · 25\.09 16:05$/u);
  assert.match(text(feed), /Исходящий звонок · занято 24\.09 15:00 \+996 ••• 00 00 01 Лид создан/u, "an unanswered attempt with no people and no recording");
  assert.match(text(html), /Последний контакт 26\.09 14:00 · звонок/u, "the newest call is the last contact");
  // The one-tap strip only where the database allowed it: rows 1 and 4, three buttons each, no player, no link.
  assert.equal((html.match(/data-testid="v3-call-result"/gu) ?? []).length, 2);
  for (const control of html.match(/<div class="mt-1" data-testid="v3-call-result">[\s\S]*?<\/div>\s*<\/div>/gu) ?? []) {
    assert.deepEqual([...control.matchAll(/<button[^>]*>([^<]+)<\/button>/gu)].map((match) => match[1]).length, 3);
    assert.match(control, /min-h-11/u, "targets are 44 px");
    assert.match(control, /role="group" aria-label="Результат звонка"/u);
  }
  assert.equal((html.match(/aria-pressed="true"/gu) ?? []).length, 1, "only the pressed result is pressed");
  assert.match(html, /aria-pressed="true" aria-expanded="false">Перезвонить 30\.09<\/button>/u, "the saved day shows on the pressed button");
  assert.doesNotMatch(html, /<audio|Слушать|recording_link|700000001/u, "no player, no listen button, no link field, no full number anywhere on the page");
  assert.doesNotMatch(feed, /https?:|\.mp3|<input/u, "no link and no field in the feed: the callback day stays closed until «Перезвонить» is pressed");
  assert.equal(solidRed(html), solidRed(pages.get("lead-none")), "the strip adds no solid red");
});

test("rendered lead: the read-only database answer shows results as words and no buttons", () => {
  const html = pages.get("lead-readonly");
  assert.equal(callRows(html).length, 5);
  assert.doesNotMatch(html, /data-testid="v3-call-result"/u);
  assert.match(text(html), /Результат: Дозвонился · Санжар Эскизов · 25\.09 16:05/u);
  assert.match(text(html), /Результат: Перезвонить 30\.09 · Санжар Эскизов · 25\.09 15:10/u);
});

test("rendered lead: an unreadable answer says so and leaves the notes alone; a long history says it is cut", () => {
  const unavailable = pages.get("lead-unavailable");
  assert.equal(callRows(unavailable).length, 0);
  assert.match(unavailable, /data-testid="v3-calls-unavailable"/u);
  assert.match(text(unavailable), /Звонки не загрузились\. Обновите страницу\./u);
  assert.match(text(unavailable), /Созвонились: интересует Малайзия/u, "the notes are still there");
  const more = pages.get("lead-more");
  assert.match(text(more), /Показаны последние 5 звонков\./u);
  assert.match(more, /data-testid="v3-calls-more"/u);
  assert.doesNotMatch(pages.get("lead-ready"), /v3-calls-more|v3-calls-unavailable/u);
});
