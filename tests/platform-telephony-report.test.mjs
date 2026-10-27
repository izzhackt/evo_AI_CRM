// «Телефония Beeline KG», срез T10 (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §10, §11, §12;
// миграция 301): блок «Звонки» в «Отчёте продаж». Проверки без сети и без базы: строгий разбор
// ответа `platform.telephony_report_v1` (чужая форма, расхождение арифметики, утечка номера — ошибка,
// а не пустой блок), слова ячеек, чтение страницы с поддельной базой (права, просмотр роли, 42501,
// сбой, чужой период), проводка в странице «Отчёт продаж» и настоящий компонент статическим рендером
// (tests/e2e/numbers-static-render.cjs --json-telephony-report). Данные синтетические: ни настоящего
// номера, имени или записи. Что видит сотрудник и какие цифры в строках, решает база:
// supabase/tests/platform_telephony_report.sql.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TelephonyReportShapeError,
  answeredCell,
  callsCell,
  firstCallCell,
  missedCell,
  normalizeTelephonyReport,
  reportCells,
  reportDuration,
  reportIsEmpty,
  reportMoment,
  reportPercent,
  reportPlural,
  reportRowIsIdle,
  reportSummary,
  resultCell,
  talkCell,
  telephonyReportState,
  unassignedCells,
} from "../src/lib/v3/telephony-report.ts";
import { SALES_CALLS_ANCHOR, SALES_DYNAMICS_ANCHOR, salesDynamicsHref } from "../src/lib/sales-register-navigation.ts";

// Чтение страницы: подмена клиента базы (его открывает `open`, а не «supabase/server»), `server-only`
// проходит под условием react-server.
globalThis.__t10 = { calls: [], answer: null };
registerHooks({ resolve(specifier, context, next) {
  if (!context.parentURL?.endsWith("/telephony-report-source.ts")) return next(specifier, context);
  if (specifier === "../supabase/server.ts") {
    return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent("export async function createSupabaseServerClient(){throw new Error('the real client must not be opened by this test');}")}` };
  }
  return next(specifier, context);
} });
const { canReadTelephonyReport, readTelephonyReport } = await import("../src/lib/v3/telephony-report-source.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
const solidRed = (html) => html.match(/(?<![\w:-])bg-accent(?![\w-])/gu)?.length ?? 0;
const PERIOD = { from: "2026-09-01", to: "2026-09-26" };
const ID = (n) => `30100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Идентификатор с буквами: в нём видно, что разбор приводит id к нижнему регистру. */
const HEX = "30100000-0000-4000-8000-0000000000ab";

// --------------------------------------------------------------- fixtures (the shape the database gives)
const ZERO_FIRST = { leads: 0, called: 0, reached: 0, inTime: 0, late: 0, pending: 0, medianCallSeconds: null, medianReachSeconds: null };
const ZERO_MISSED = { total: 0, inTime: 0, late: 0, pending: 0, without: 0 };
const zero = () => ({
  calls: { in: 0, out: 0 }, answered: { in: 0, out: 0 }, talk: { seconds: 0, calls: 0 }, result: { eligible: 0, set: 0 },
  firstCall: { ...ZERO_FIRST }, missed: { ...ZERO_MISSED },
});
const TEAM = {
  calls: { in: 8, out: 7 }, answered: { in: 2, out: 4 }, talk: { seconds: 430, calls: 6 }, result: { eligible: 4, set: 2 },
  firstCall: { leads: 6, called: 4, reached: 3, inTime: 1, late: 5, pending: 0, medianCallSeconds: 4350, medianReachSeconds: 11100 },
  missed: { total: 4, inTime: 1, late: 1, pending: 0, without: 2 },
};
const manager = (n, fields = {}) => ({ membershipId: ID(300 + n), name: `Менеджер ${n}`, ...zero(), ...fields });
const A = manager(2, {
  calls: { in: 5, out: 5 }, answered: { in: 1, out: 3 }, talk: { seconds: 280, calls: 4 }, result: { eligible: 2, set: 2 },
  firstCall: { leads: 2, called: 1, reached: 1, inTime: 0, late: 2, pending: 0, medianCallSeconds: 3600, medianReachSeconds: 3600 },
  missed: { total: 1, inTime: 0, late: 1, pending: 0, without: 0 },
});
const B = manager(4, { calls: { in: 2, out: 0 }, missed: { total: 1, inTime: 0, late: 0, pending: 0, without: 1 } });
const UNASSIGNED = {
  firstCall: { leads: 1, called: 0, reached: 0, inTime: 0, late: 1, pending: 0, medianCallSeconds: null, medianReachSeconds: null },
  missed: { total: 1, inTime: 0, late: 0, pending: 0, without: 1 },
};
const item = (n, fields = {}) => ({ callId: ID(7000 + n), startedAt: "2026-09-25T10:00:00.000000+00:00", phone: "+996 ••• 00 00 04", leadId: ID(5000 + n), ownerName: "Менеджер 4", ...fields });
const all = (fields = {}) => ({
  enabled: true, scope: "all", from: PERIOD.from, to: PERIOD.to, slaMinutes: 15, team: TEAM, managers: [A, B], unassigned: UNASSIGNED,
  missedList: [item(1), item(2, { leadId: null, ownerName: null })], missedMore: false, ...fields,
});
const own = (fields = {}) => ({
  enabled: true, scope: "own", from: PERIOD.from, to: PERIOD.to, slaMinutes: 15, team: null, managers: [A], unassigned: null,
  missedList: [], missedMore: false, ...fields,
});
const rejects = (value, message) => assert.throws(() => normalizeTelephonyReport(value, PERIOD), TelephonyReportShapeError, message);
const clone = (value) => JSON.parse(JSON.stringify(value));
/** Копия ответа с одной правкой по пути («team.calls.in» → 99). */
function mutated(base, path, value) {
  const copy = clone(base);
  const keys = path.split(".");
  let target = copy;
  for (const key of keys.slice(0, -1)) target = target[/^\d+$/u.test(key) ? Number(key) : key];
  const last = keys.at(-1);
  if (value === undefined) delete target[last]; else target[/^\d+$/u.test(last) ? Number(last) : last] = value;
  return copy;
}

// ------------------------------------------------------------ contract

test("contract: a well-formed answer is normalised, frozen and keeps the database's order", () => {
  const report = normalizeTelephonyReport(all(), PERIOD);
  assert.equal(report.scope, "all");
  assert.equal(report.slaMinutes, 15);
  assert.deepEqual(report.managers.map((row) => row.name), ["Менеджер 2", "Менеджер 4"]);
  assert.deepEqual(report.missedList.map((entry) => entry.callId), [ID(7001), ID(7002)]);
  assert.equal(report.missedList[1].leadId, null);
  assert.ok([report, report.team, report.team.calls, report.team.firstCall, report.managers, report.managers[0], report.managers[0].missed,
    report.unassigned, report.missedList, report.missedList[0]].every(Object.isFrozen), "everything is frozen");
  const ownReport = normalizeTelephonyReport(own(), PERIOD);
  assert.equal(ownReport.scope, "own");
  assert.equal(ownReport.team, null);
  assert.equal(ownReport.unassigned, null);
  assert.equal(ownReport.managers.length, 1);
  assert.equal(normalizeTelephonyReport(all({ managers: [{ ...A, membershipId: HEX.toUpperCase() }, B] }), PERIOD).managers[0].membershipId, HEX, "ids are lower-cased");
});

test("contract: a duplicate manager after lower-casing is a foreign shape", () => {
  rejects(all({ managers: [{ ...A, membershipId: HEX }, { ...B, membershipId: HEX.toUpperCase() }] }));
});

test("contract: the off answer is null, a foreign off answer is not", () => {
  assert.equal(normalizeTelephonyReport({ enabled: false }, PERIOD), null);
  rejects({ enabled: false, scope: "all" });
  rejects({ enabled: true });
  rejects({});
  rejects(null); rejects([]); rejects("report"); rejects(5);
});

test("contract: keys are exact — a missing or extra key anywhere is an error", () => {
  rejects({ ...all(), extra: 1 });
  rejects(mutated(all(), "scope", undefined));
  rejects(mutated(all(), "team.extra", 1));
  rejects(mutated(all(), "team.calls.total", 1));
  rejects(mutated(all(), "team.firstCall.extra", 1));
  rejects(mutated(all(), "team.missed.extra", 1));
  rejects(mutated(all(), "managers.0.phone", "+996700000001"));
  rejects(mutated(all(), "managers.0.name", undefined));
  rejects(mutated(all(), "unassigned.calls", { in: 0, out: 0 }));
  rejects(mutated(all(), "missedList.0.recording_link", "https://example.invalid/a.mp3"));
  rejects(mutated(all(), "missedList.0.phone", undefined));
});

test("contract: counts are whole non-negative numbers", () => {
  for (const bad of [-1, 1.5, "3", null, Number.NaN, Number.POSITIVE_INFINITY, 1e12]) {
    rejects(mutated(all(), "team.calls.in", bad));
    rejects(mutated(all(), "team.talk.seconds", bad));
  }
  rejects(mutated(all(), "slaMinutes", 0));
  rejects(mutated(all(), "slaMinutes", 481));
  rejects(mutated(all(), "slaMinutes", "15"));
});

test("contract: arithmetic that cannot be true is an error, not a number on screen", () => {
  rejects(mutated(all(), "team.answered.in", 9), "more answered than calls");
  rejects(mutated(all(), "team.answered.out", 8), "more answered than calls");
  rejects(mutated(all(), "team.talk.calls", 7), "time known for more calls than were answered");
  rejects(mutated(all(), "team.result.eligible", 7), "more result buttons than answered calls");
  rejects(mutated(all(), "team.result.set", 5), "more results than buttons");
  rejects(mutated(all(), "team.firstCall.inTime", 2), "in time + late + pending must equal the leads");
  rejects(mutated(all(), "team.firstCall.called", 7), "more touched than leads");
  rejects(mutated(all(), "team.firstCall.reached", 5), "more reached than touched");
  rejects(mutated(all(), "team.firstCall.medianCallSeconds", null), "a median is missing although leads were touched");
  rejects(mutated(all(), "unassigned.firstCall.medianCallSeconds", 60), "a median without any touched lead");
  rejects(mutated(all(), "unassigned.firstCall.medianReachSeconds", 60), "a median without any reached lead");
  rejects(mutated(all(), "team.missed.late", 2), "the missed shares must add up to the total");
  rejects(mutated(all(), "managers.0.answered.out", 6));
  rejects(mutated(all(), "managers.0.firstCall.pending", 1));
});

test("contract: the period must be the one that was asked for", () => {
  rejects(all({ from: "2026-09-02" }));
  rejects(all({ to: "2026-09-25" }));
  assert.throws(() => normalizeTelephonyReport(all(), { from: "2026-08-01", to: "2026-09-26" }), TelephonyReportShapeError);
  rejects(all({ from: "2026-02-30", to: "2026-02-30" }));
  rejects(all({ from: "26-09-01" }));
});

test("contract: scope decides which blocks exist", () => {
  rejects(all({ team: null }), "all without a team");
  rejects(all({ unassigned: null }), "all without the unassigned row");
  rejects(own({ team: TEAM }), "own with a team");
  rejects(own({ unassigned: UNASSIGNED }), "own with an unassigned row");
  rejects(own({ managers: [A, B] }), "own with two rows");
  rejects(own({ managers: [] }), "own with no row");
  rejects(all({ scope: "everyone" }));
  rejects(all({ scope: null }));
});

test("contract: a number that is not a mask is a leak, not text to show", () => {
  for (const phone of ["+996700000004", "996700000004", "+996 700 000 004", "0700000004", "+996 ••• 123 456 789", "", null, 5, "+996 ••• 12 46 64 11"]) {
    rejects(mutated(all(), "missedList.0.phone", phone), String(phone));
  }
  assert.doesNotThrow(() => normalizeTelephonyReport(mutated(all(), "missedList.0.phone", "+996 ••• 12 46 64"), PERIOD));
  assert.doesNotThrow(() => normalizeTelephonyReport(mutated(all(), "missedList.0.phone", "+7 ••• 64"), PERIOD));
});

test("contract: the missed list is the without-callback figure, at most fifty, with a flag for the rest", () => {
  const fifty = Array.from({ length: 50 }, (_, index) => item(index + 1));
  const many = (n) => all({ team: { ...TEAM, missed: { total: n, inTime: 0, late: 0, pending: 0, without: n } },
    unassigned: { ...UNASSIGNED }, missedList: fifty, missedMore: n > 50 });
  assert.doesNotThrow(() => normalizeTelephonyReport(many(50), PERIOD));
  assert.doesNotThrow(() => normalizeTelephonyReport(many(51), PERIOD));
  rejects({ ...many(51), missedMore: false }, "more than fifty without the flag");
  rejects({ ...many(50), missedMore: true }, "the flag without more");
  rejects({ ...many(60), missedList: [...fifty, item(51)] }, "more than fifty items");
  rejects(all({ missedList: [item(1)] }), "the list must hold every without-callback call up to the limit");
  rejects(all({ missedList: [item(1), item(1)] }), "a call twice in the list");
  rejects(own({ missedList: [item(1)] }), "an own list longer than the own figure");
  assert.doesNotThrow(() => normalizeTelephonyReport(own({ managers: [B], missedList: [item(1)] }), PERIOD));
});

test("contract: names, ids and moments are checked", () => {
  rejects(mutated(all(), "managers.0.name", ""));
  rejects(mutated(all(), "managers.0.name", "Имя\u0000"));
  rejects(mutated(all(), "managers.0.name", "я".repeat(201)));
  rejects(mutated(all(), "managers.0.membershipId", "not-a-uuid"));
  rejects(mutated(all(), "missedList.0.callId", "not-a-uuid"));
  rejects(mutated(all(), "missedList.0.startedAt", "2026-09-25"));
  rejects(mutated(all(), "missedList.0.startedAt", "yesterday"));
  rejects(mutated(all(), "missedList.0.leadId", "lead"));
  rejects(mutated(all(), "missedList.0.ownerName", ""));
});

test("state: the database's answer becomes off, ready or unavailable — never a guess", () => {
  assert.deepEqual(telephonyReportState({ enabled: false }, PERIOD), { status: "off" });
  const ready = telephonyReportState(all(), PERIOD);
  assert.equal(ready.status, "ready");
  assert.equal(ready.report.team.calls.in, 8);
  assert.deepEqual(telephonyReportState({ ...all(), extra: 1 }, PERIOD), { status: "unavailable" });
  assert.deepEqual(telephonyReportState(null, PERIOD), { status: "unavailable" });
  assert.deepEqual(telephonyReportState(all(), { from: "2026-09-02", to: "2026-09-26" }), { status: "unavailable" });
  assert.ok(Object.isFrozen(ready) && Object.isFrozen(telephonyReportState({ enabled: false }, PERIOD)));
});

// ------------------------------------------------------------ words

test("words: percent, duration, plural and moment", () => {
  assert.equal(reportPercent(1, 3), "33 %");
  assert.equal(reportPercent(2, 3), "67 %");
  assert.equal(reportPercent(0, 5), "0 %");
  assert.equal(reportPercent(5, 5), "100 %");
  assert.equal(reportPercent(0, 0), null, "nothing to divide by is no percent, not 0 or 100");
  assert.equal(reportPercent(1, -1), null);
  assert.equal(reportPercent(Number.NaN, 4), null);
  assert.equal(reportDuration(0), "0 с");
  assert.equal(reportDuration(45), "45 с");
  assert.equal(reportDuration(125), "2 мин 05 с");
  assert.equal(reportDuration(120), "2 мин");
  assert.equal(reportDuration(3900), "1 ч 05 мин");
  assert.equal(reportDuration(3600), "1 ч");
  assert.equal(reportDuration(107100), "29 ч 45 мин");
  assert.equal(reportDuration(-5), "0 с");
  assert.equal(reportPlural(1, "звонок", "звонка", "звонков"), "звонок");
  assert.equal(reportPlural(2, "звонок", "звонка", "звонков"), "звонка");
  assert.equal(reportPlural(5, "звонок", "звонка", "звонков"), "звонков");
  assert.equal(reportPlural(11, "звонок", "звонка", "звонков"), "звонков");
  assert.equal(reportPlural(21, "звонок", "звонка", "звонков"), "звонок");
  // Бишкек — UTC+6: 10:00 UTC — это 16:00.
  assert.match(reportMoment("2026-09-25T10:00:00.000000+00:00"), /^25\.09, 16:00$/u);
  assert.match(reportMoment("2026-09-25T20:30:00Z"), /^26\.09, 02:30$/u, "a moment after midnight in Bishkek is the next day");
});

// A cell is its words: the label, the figure (or a quiet word where there is no number), the notes. The hint is a sentence shown on hover.
const plain = ({ label, figure, quiet, notes }) => ({ label, figure, quiet, notes });

test("words: the six cells of a row", () => {
  const cells = reportCells(TEAM, 15);
  assert.deepEqual(cells.map((cell) => cell.label), ["Звонки", "Отвечено", "Время разговора", "До первого звонка", "Пропущенные без перезвона", "Результат проставлен"]);
  assert.ok(cells.every((cell) => cell.hint.length > 20 && !cell.quiet), "every cell explains itself on hover; a cell with a number is not quiet");
  assert.deepEqual(plain(callsCell(TEAM)), { label: "Звонки", figure: "15", quiet: false, notes: ["8 входящих · 7 исходящих"] });
  assert.deepEqual(plain(answeredCell(TEAM)), { label: "Отвечено", figure: "40 %", quiet: false, notes: ["входящие 2 из 8", "исходящие 4 из 7"] });
  assert.deepEqual(plain(talkCell(TEAM)), { label: "Время разговора", figure: "7 мин 10 с", quiet: false, notes: ["в среднем 1 мин 12 с"] });
  assert.deepEqual(plain(firstCallCell(TEAM.firstCall, 15)), {
    label: "До первого звонка", figure: "1 ч 12 мин", quiet: false,
    notes: ["новых лидов: 6", "в срок 15 мин: 1 из 6", "до разговора 3 ч 05 мин"],
  });
  // A zero beside «пропущено входящих» read as a contradiction: «из 4 пропущенных» says what the zero is out of.
  assert.deepEqual(plain(missedCell(TEAM.missed)), {
    label: "Пропущенные без перезвона", figure: "2", quiet: false,
    notes: ["из 4 пропущенных входящих", "перезвонили в срок: 1", "перезвонили позже срока: 1"],
  });
  assert.deepEqual(plain(resultCell(TEAM.result)), { label: "Результат проставлен", figure: "50 %", quiet: false, notes: ["2 из 4 отвеченных"] });
});

test("words: nothing is invented where there is nothing to say — a quiet word, not a dash and not a zero", () => {
  const empty = zero();
  assert.deepEqual(plain(callsCell(empty)), { label: "Звонки", figure: "0", quiet: false, notes: [] });
  assert.deepEqual(plain(answeredCell(empty)), { label: "Отвечено", figure: "нет звонков", quiet: true, notes: [] }, "no calls is no percent");
  assert.deepEqual(plain(talkCell(empty)), { label: "Время разговора", figure: "нет разговоров", quiet: true, notes: [] });
  assert.deepEqual(plain(firstCallCell(empty.firstCall, 15)), { label: "До первого звонка", figure: "нет новых лидов", quiet: true, notes: [] });
  assert.deepEqual(plain(missedCell(empty.missed)), { label: "Пропущенные без перезвона", figure: "0", quiet: false, notes: [] });
  assert.deepEqual(plain(resultCell(empty.result)), { label: "Результат проставлен", figure: "нет отвеченных", quiet: true, notes: [] });
  // Отвечено, но время из сверки ещё не пришло: не ноль минут, а честное «ещё не пришло».
  const young = { ...zero(), calls: { in: 0, out: 3 }, answered: { in: 0, out: 3 }, talk: { seconds: 60, calls: 1 } };
  assert.deepEqual(plain(talkCell(young)), {
    label: "Время разговора", figure: "1 мин", quiet: false, notes: ["в среднем 1 мин", "время ещё не пришло: 2 звонка"],
  });
  const none = { ...zero(), calls: { in: 0, out: 2 }, answered: { in: 0, out: 2 } };
  assert.deepEqual(plain(talkCell(none)), { label: "Время разговора", figure: "уточняется", quiet: true, notes: ["время ещё не пришло: 2 звонка"] });
  // The deadline has not come yet: «ждём», not a dash.
  assert.deepEqual(plain(firstCallCell({ ...ZERO_FIRST, leads: 2, pending: 2 }, 30)), {
    label: "До первого звонка", figure: "ждём", quiet: true, notes: ["новых лидов: 2", "срок ещё не вышел: 2"],
  });
  assert.equal(firstCallCell({ ...ZERO_FIRST, leads: 3, late: 3 }, 30).figure, "не звонили", "the deadline passed and nobody called");
  assert.deepEqual(missedCell({ total: 3, inTime: 0, late: 0, pending: 3, without: 0 }).notes, ["из 3 пропущенных входящих", "срок ещё не вышел: 3"]);
  assert.deepEqual(unassignedCells(UNASSIGNED, 15).map((cell) => cell.label), ["До первого звонка", "Пропущенные без перезвона"]);
  assert.equal(reportIsEmpty(normalizeTelephonyReport(all({ team: zero(), managers: [manager(2)], unassigned: { firstCall: ZERO_FIRST, missed: ZERO_MISSED }, missedList: [] }), PERIOD)), true);
  assert.equal(reportIsEmpty(normalizeTelephonyReport(all(), PERIOD)), false);
  assert.equal(reportIsEmpty(normalizeTelephonyReport(own({ managers: [manager(2)] }), PERIOD)), true);
  assert.equal(reportIsEmpty(normalizeTelephonyReport(own(), PERIOD)), false);
});

test("words: the collapsed block says the main thing itself; an employee of zeros is one line, not a row", () => {
  const report = normalizeTelephonyReport(all(), PERIOD);
  assert.equal(reportSummary(report), "15 звонков · отвечено 40 % · без перезвона: 2");
  assert.equal(reportSummary(normalizeTelephonyReport(own(), PERIOD)), "10 звонков · отвечено 40 % · без перезвона: 0");
  assert.equal(reportSummary(normalizeTelephonyReport(all({ team: zero(), managers: [manager(2)], unassigned: { firstCall: ZERO_FIRST, missed: ZERO_MISSED }, missedList: [] }), PERIOD)), "звонков за период нет");
  assert.equal(reportRowIsIdle(zero()), true);
  assert.equal(reportRowIsIdle({ ...zero(), firstCall: { ...ZERO_FIRST, leads: 1, pending: 1 } }), false, "a new lead waiting for a call is not idle");
  assert.equal(reportRowIsIdle({ ...zero(), calls: { in: 1, out: 0 } }), false);
});

// ------------------------------------------------------------ the page's read

const reader = (answer, calls = []) => async () => ({
  schema(name) {
    return {
      async rpc(fn, args) {
        calls.push({ schema: name, fn, args });
        if (answer instanceof Error) throw answer;
        return answer;
      },
    };
  },
});
const actor = (fields = {}) => ({
  systemRole: "staff", presentationRole: null, organizationId: ID(1), permissionKeys: ["telephony.report.read.own"], ...fields,
});

test("read: only a holder of a report right asks the database, and never in a role preview", async () => {
  assert.equal(canReadTelephonyReport(actor()), true);
  assert.equal(canReadTelephonyReport(actor({ permissionKeys: ["telephony.report.read.all"] })), true);
  assert.equal(canReadTelephonyReport(actor({ systemRole: "admin", permissionKeys: [] })), true, "an Admin holds every key");
  assert.equal(canReadTelephonyReport(actor({ permissionKeys: ["telephony.call.dial", "telephony.manage", "sales.read"] })), false);
  assert.equal(canReadTelephonyReport(actor({ permissionKeys: [] })), false);
  assert.equal(canReadTelephonyReport(actor({ systemRole: "admin", presentationRole: "sales" })), false, "an Admin previewing a role does not see the role's blocks through his own rights");
  const calls = [];
  assert.deepEqual(await readTelephonyReport(actor({ permissionKeys: ["telephony.call.dial"] }), PERIOD, reader(all(), calls)), { status: "off" });
  assert.deepEqual(await readTelephonyReport(actor({ systemRole: "admin", presentationRole: "sales" }), PERIOD, reader(all(), calls)), { status: "off" });
  assert.equal(calls.length, 0, "no right, no question to the database");
});

test("read: the call carries the organization of the session and the period, nothing else", async () => {
  const calls = [];
  const state = await readTelephonyReport(actor(), PERIOD, reader({ data: own(), error: null }, calls));
  assert.equal(state.status, "ready");
  assert.deepEqual(calls, [{ schema: "platform", fn: "telephony_report_v1", args: { p_organization_id: ID(1), p_from: PERIOD.from, p_to: PERIOD.to } }]);
});

test("read: switched off, refused by the database, failed, foreign shape, wrong period — each says the right thing", async () => {
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, reader({ data: { enabled: false }, error: null })), { status: "off" });
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, reader({ data: null, error: { code: "42501", message: "telephony_report_forbidden" } })), { status: "off" },
    "a stale session is quietly «no block», not an alarm");
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, reader({ data: null, error: { code: "22023", message: "telephony_report_invalid" } })), { status: "unavailable" });
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, reader({ data: null, error: { message: "boom" } })), { status: "unavailable" });
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, reader(new Error("private provider detail"))), { status: "unavailable" });
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, async () => { throw new Error("no client"); }), { status: "unavailable" });
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, reader({ data: { ...own(), extra: 1 }, error: null })), { status: "unavailable" });
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, reader({ data: { ...own(), from: "2026-09-02" }, error: null })), { status: "unavailable" });
  assert.deepEqual(await readTelephonyReport(actor(), PERIOD, reader({ data: null, error: null })), { status: "unavailable" });
});

// ------------------------------------------------------------ the page's wiring

test("wiring: the block sits under «Динамика по дням», shares its period, and is closed without a right", () => {
  const page = read("src/app/(v3)/v3/main/page.tsx");
  assert.match(page, /canReadTelephonyReport\(actor\) \?/u, "the block exists only for a holder of a report right");
  assert.match(page, /readTelephonyReport\(actor, \{ from: period\.from, to: period\.to \}\)/u, "the same period as the dynamics section");
  assert.match(page, /const section = <>\{dynamicsSection\}\{callsSection\}<\/>;/u);
  assert.match(page, /<Suspense fallback=\{null\}>\s*<StreamedSalesCalls/u, "nothing flashes while it loads for a person whose telephony is off");
  assert.match(page, /if \(!canReadReport\) return next \? <SalesDynamicsNextView dynamics=\{section\} \/> : <SalesDynamicsReport dynamics=\{section\} \/>;/u, "a manager without the register still sees the block");
  assert.match(page, /return next \? <SalesRegisterNextView actor=\{actor\} query=\{query\} dynamics=\{section\} \/> : <SalesRegisterView actor=\{actor\} query=\{query\} dynamics=\{section\} \/>;/u);
  assert.match(page, /formAction=\{`\/v3\/main#\$\{SALES_CALLS_ANCHOR\}`\}/u);
  assert.equal(SALES_CALLS_ANCHOR, "sales-calls");
  assert.notEqual(SALES_CALLS_ANCHOR, SALES_DYNAMICS_ANCHOR);
  const query = { view: "sales", year: "2026", month: "9" };
  assert.equal(salesDynamicsHref(query, { key: "week" }), `/v3/main?view=sales&year=2026&month=9&period=week#${SALES_DYNAMICS_ANCHOR}`, "the dynamics link is unchanged");
  assert.equal(salesDynamicsHref(query, { key: "week" }, SALES_CALLS_ANCHOR), "/v3/main?view=sales&year=2026&month=9&period=week#sales-calls");
  assert.equal(salesDynamicsHref(query, { key: "custom", from: "2026-09-01", to: "2026-09-26" }, SALES_CALLS_ANCHOR),
    "/v3/main?view=sales&year=2026&month=9&period=custom&from=2026-09-01&to=2026-09-26#sales-calls");
  const source = read("src/lib/v3/telephony-report-source.ts");
  assert.match(source, /rpc\("telephony_report_v1"/u);
  assert.doesNotMatch(source, /recording|phone/iu, "the reader names neither a recording nor a number");
  assert.match(read("supabase/migrations/301_platform_telephony_report.sql"), /telephony\.report\.read\.all/u);
});

// ------------------------------------------------------------ the rendered block

const pages = new Map(JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL("./e2e/numbers-static-render.cjs", import.meta.url)), "--json-telephony-report"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).map((page) => [page.name, page.html]));
// The block is a <details>, and a row folds its other cells into a nested <details>: the end is where the depth returns to zero.
const block = (html) => {
  const start = html.indexOf('<details id="sales-calls"');
  if (start === -1) return "";
  let depth = 0;
  for (const match of html.slice(start).matchAll(/<details[\s>]|<\/details>/gu)) {
    depth += match[0] === "</details>" ? -1 : 1;
    if (depth === 0) return html.slice(start, start + match.index + "</details>".length);
  }
  return html.slice(start);
};

test("rendered: switched off or no right — the report is byte-for-byte the one without telephony", () => {
  assert.equal(block(pages.get("report-off")), "");
  assert.doesNotMatch(text(pages.get("report-off")), /Звонки/u);
  assert.doesNotMatch(pages.get("report-off"), /sales-calls|v3-sales-calls/u);
});

test("rendered: the supervisor's block — the team, every manager, the unassigned row and the missed list, in words", () => {
  const html = block(pages.get("report-all"));
  assert.match(html, /^<details id="sales-calls" open="" class="group mt-8 scroll-mt-4 border-t border-border pt-2" data-testid="v3-sales-calls">/u);
  const words = text(html);
  // Collapsed, the block already says the main thing, with its own period (it is not the month of the report above).
  assert.match(words, /^Звонки 1 сен — 26 сен · 15 звонков · отвечено 40 % · без перезвона: 2 Звонки за период 1 сен — 26 сен · первый звонок и перезвон — в течение 15 мин рабочего времени Сегодня Вчера Неделя 30 дней Период/u);
  assert.match(words, /Вся команда Звонки 15 8 входящих · 7 исходящих Отвечено 40 % входящие 2 из 8 исходящие 4 из 7 Время разговора 7 мин 10 с в среднем 1 мин 12 с/u);
  assert.match(words, /До первого звонка 1 ч 12 мин новых лидов: 6 в срок 15 мин: 1 из 6 до разговора 3 ч 05 мин Пропущенные без перезвона 2 из 4 пропущенных входящих перезвонили в срок: 1 перезвонили позже срока: 1 Результат проставлен 50 % 2 из 4 отвеченных/u);
  const rows = html.match(/<li [^>]*data-calls-manager="[^"]+"[\s\S]*?<\/li>/gu) ?? [];
  assert.equal(rows.length, 3, "three manager rows; the employee of zeros is one line, not a row");
  assert.match(text(rows[0]), /^Санжар Эскизов Звонки 10 5 входящих · 5 исходящих Отвечено 40 %/u);
  assert.match(text(rows[2]), /Бакыт Пробный Звонки 2 2 входящих · 0 исходящих Отвечено 0 % входящие 0 из 2 Время разговора нет разговоров До первого звонка 29 ч 45 мин/u);
  assert.match(text(html.match(/<li [^>]*data-calls-idle=""[\s\S]*?<\/li>/u)?.[0] ?? ""), /^Без звонков за период: Нурия Тестова$/u,
    "an idle employee is named in one line, never drawn as a row of zeros or an invented percentage");
  // On a phone a row is three cells and «Все показатели»: the rest sits behind it, not in a wall of figures.
  assert.equal((html.match(/data-calls-all=""/gu) ?? []).length, 4, "the team and the three rows each fold their other three cells");
  assert.match(rows[0], /<div class="min-w-0 max-sm:hidden"[^>]*><dt class="t-caption text-fg-2">Время разговора<\/dt>/u, "the other three cells leave the phone row");
  // Nothing is lost on a phone: the main cells show one note, and the second and later ones (the outgoing split, the call-back
  // breakdown) stand in «Все показатели» next to the other three cells — the hidden lines of the row are not hidden everywhere.
  const folded = (row) => text(row.match(/<details class="mt-1 sm:hidden" data-calls-all="">[\s\S]*?<\/details>/u)?.[0] ?? "");
  assert.match(folded(html.match(/<section[^>]*data-calls-team=""[\s\S]*?<\/section>/u)?.[0] ?? ""),
    /^Все показатели Отвечено входящие 2 из 8 исходящие 4 из 7 Время разговора .* Пропущенные без перезвона из 4 пропущенных входящих перезвонили в срок: 1 перезвонили позже срока: 1 Результат проставлен/u);
  assert.match(folded(rows[0]), /Отвечено входящие \d+ из \d+ исходящие \d+ из \d+/u, "a manager's row folds the same breakdown");
  assert.doesNotMatch(folded(rows[0]), /Звонки \d/u, "the first cell has one note only: nothing of it is hidden, so it is not repeated");
  const unassigned = html.match(/<li [^>]*data-calls-unassigned=""[\s\S]*?<\/li>/u)?.[0] ?? "";
  assert.match(text(unassigned), /^Без ответственного Лиды и пропущенные звонки, у которых нет владельца\. До первого звонка не звонили новых лидов: 1 в срок 15\sмин: 0 из 1 Пропущенные без перезвона 1 из 1 пропущенных входящих$/u, "the deadline passed with nobody calling: «не звонили», not a dash");
  const list = html.match(/<section[^>]*data-calls-missed-list=""[\s\S]*?<\/section>/u)?.[0] ?? "";
  const items = list.match(/<li [^>]*data-missed-call="[^"]+"[\s\S]*?<\/li>/gu) ?? [];
  assert.equal(items.length, 2);
  assert.match(text(items[0]), /^25\.09, 16:00 \+996 ••• 00 00 04 Бакыт Пробный Открыть лид$/u);
  assert.match(items[0], /href="\/v3\/profile\?id=dddddddd-3333-4333-8333-000000000001"/u);
  assert.match(text(items[1]), /^24\.09, 15:00 \+996 ••• 00 00 03 Без ответственного$/u, "no owner and no lead: nobody to name, nothing to open");
  assert.doesNotMatch(items[1], /<a /u);
  assert.doesNotMatch(list, /Показаны последние/u);
});

test("rendered: the manager's block is one row with no team and no unassigned row", () => {
  const html = block(pages.get("report-own"));
  const words = text(html);
  assert.match(words, /Ваши звонки за период 1 сен — 26 сен/u);
  assert.match(words, /Ваши цифры Звонки 10 5 входящих · 5 исходящих Отвечено 40 %/u);
  assert.match(words, /^Звонки 1 сен — 26 сен · 10 звонков · отвечено 40 % · без перезвона: 0 /u, "the summary is the manager's own row");
  assert.doesNotMatch(words, /Вся команда|Менеджеры|Без ответственного|Санжар/u, "the manager's own name is not repeated as a stranger's row");
  assert.doesNotMatch(html, /data-calls-team|data-calls-managers|data-calls-unassigned|data-calls-missed-list/u);
  assert.match(html, /data-calls-own=""/u);
  const mine = block(pages.get("report-own-missed"));
  assert.match(mine, /data-calls-missed-list=""/u, "his own missed calls without a callback are listed for him");
  assert.match(text(mine), /25\.09, 16:00 \+996 ••• 00 00 04 Бакыт Пробный Открыть лид/u);
});

test("rendered: an empty period, a long list, calls still within their time, a failed read", () => {
  assert.match(text(block(pages.get("report-empty"))), /За этот период звонков, новых лидов и пропущенных нет\.$/u);
  assert.doesNotMatch(block(pages.get("report-empty")), /data-calls-team|data-calls-managers/u, "an empty period is not a table of zeros");
  const more = block(pages.get("report-more"));
  assert.equal((more.match(/data-missed-call=/gu) ?? []).length, 50);
  assert.match(text(more), /Показаны последние 50\./u);
  assert.match(text(more), /Менеджеры Нет сотрудников со звонками за период\./u);
  const pending = text(block(pages.get("report-pending")));
  assert.match(pending, /До первого звонка ждём новых лидов: 1 срок ещё не вышел: 1 Пропущенные без перезвона 0 из 1 пропущенных входящих срок ещё не вышел: 1/u,
    "a call still within its time is not counted as a failure");
  const failed = block(pages.get("report-unavailable"));
  assert.match(failed, /role="alert"/u);
  assert.match(text(failed), /Не удалось загрузить звонки за выбранный период\. Повторить$/u);
  assert.match(failed, /href="\/v3\/main\?view=sales&amp;period=custom&amp;from=2026-09-01&amp;to=2026-09-26#sales-calls"/u, "retry returns to this block with the same period");
  // Метка периода «30 дней» сама содержит «0»: ноль считается нулём, только если он не часть числа.
  assert.doesNotMatch(text(failed), /Вся команда|(?<!\d)0(?!\d)/u, "no zeros are drawn for a failed read");
});

test("rendered: the block is closed until a period is chosen, shares the period form and carries no red", () => {
  assert.doesNotMatch(block(pages.get("report-closed")).slice(0, 120), /open=""/u);
  assert.match(block(pages.get("report-all")).slice(0, 80), /open=""/u);
  const html = block(pages.get("report-all"));
  assert.match(html, /<form [^>]*action="\/v3\/main#sales-calls" method="get"/u);
  assert.match(html, /<input type="hidden" name="view" value="sales"\/>/u);
  assert.match(html, /<input type="hidden" name="period" value="custom"\/>/u);
  assert.match(html, /<nav aria-label="Период"[^>]*>/u);
  assert.match(html, /href="\/v3\/main\?view=sales&amp;period=week#sales-calls"/u, "the period links lead back to this block, not to the dynamics section");
  for (const name of ["report-all", "report-own", "report-empty", "report-more", "report-pending", "report-unavailable"]) {
    assert.equal(solidRed(block(pages.get(name))), 0, `${name}: no solid red in the block`);
  }
  // One level-2 heading, and the headings below it go 3 → 4 without skipping.
  assert.equal((html.match(/<h2/gu) ?? []).length, 1);
  assert.ok(!/<h4[\s\S]*<h2/u.test(html));
});

test("rendered: no number, link, email or recording in any block", () => {
  for (const [name, html] of pages) {
    const shown = block(html);
    assert.doesNotMatch(shown, /\+996\s?\d{3}\s?\d/u, `${name}: a full number`);
    assert.doesNotMatch(shown, /https?:|recording|\.mp3|@/iu, `${name}: a link, a recording or an email`);
    assert.doesNotMatch(shown, /undefined|null|NaN|\[object/u, `${name}: a leaked placeholder`);
  }
});
