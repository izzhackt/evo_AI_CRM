import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { NextRequest } from "next/server.js";

import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { isConnectedPlatformApi, isConnectedPlatformPage, isConnectedPlatformPrivateApi, isRetiredPlatformRoute } from "../src/lib/platform-route-contract.ts";
import { settingsIntegrations } from "../src/lib/v3/settings-health.ts";
import {
  formatTelephonyTime,
  lowerFirstWord,
  telephonyIntegrationRow,
  telephonyIssues,
  telephonyStatusLines,
} from "../src/lib/v3/telephony-health.ts";
import {
  TELEPHONY_BOUNDS,
  TELEPHONY_PATCH_KEYS,
  isTelephonyPatchShape,
  normalizeTelephonyMapReceipt,
  normalizeTelephonyOverview,
  normalizeTelephonySaveReceipt,
  parseTelephonyPrefixes,
  telephonyDraftFrom,
  telephonyDraftIssues,
  telephonyErrorMessage,
  telephonyOpeningFlags,
  telephonyPatchFrom,
} from "../src/lib/v3/telephony-settings.ts";
import {
  mapTelephonyExtension,
  readTelephonyAdmin,
  readTelephonyServerFacts,
  saveTelephonySettings,
  telephonyCommandFailure,
  telephonyIntegrationFactsFrom,
} from "../src/lib/server/platform-telephony-admin.ts";
import {
  createTelephonyExtensionHandler,
  createTelephonySettingsHandler,
} from "../src/lib/server/platform-telephony-admin-route-handlers.ts";

/**
 * «Настройки → Телефония» (срез T4b): разбор ответа базы, черновик формы, слова
 * состояния, серверные чтения и команды, два маршрута и доступ. Настоящую базу
 * проверяет supabase/tests/platform_telephony_settings.sql; здесь — всё, что
 * живёт в коде приложения. Ключей, номеров и адресов настоящей ВАТС нет.
 */

const ORG = "10000000-0000-4000-8000-000000000001";
const ME = "20000000-0000-4000-8000-000000000002";
const OTHER = "20000000-0000-4000-8000-000000000003";
const EXT = "30000000-0000-4000-8000-000000000004";
const REQ = "40000000-0000-4000-8000-000000000005";
const NOW = new Date("2026-10-17T10:00:00.000Z");

function settingsSample(overrides = {}) {
  return {
    version: 3,
    updatedAt: "2026-10-17T09:00:00.000Z",
    flags: {
      projectionEnabled: false, uiEnabled: false, dialEnabled: false, missedTaskEnabled: false,
      unknownLeadEnabled: false, backfillEnabled: false, outboundPaused: false,
    },
    hours: { timezone: "Asia/Bishkek", workingDays: [1, 2, 3, 4, 5, 6], workFrom: "10:00", workTo: "20:00", callbackWorkMinutes: 15 },
    escalationMembershipId: null,
    dial: { prefixes: ["+996"], limitUserDay: 150, limitUserGapSeconds: 5, limitOrgHour: 60, limitOrgDay: 400 },
    ceilings: { leadsHour: 10, leadsDay: 40, tasksHour: 30, tasksDay: 120 },
    ...overrides,
  };
}
function healthSample(overrides = {}) {
  return {
    status: "ok",
    now: "2026-10-17T10:00:00.000Z",
    flags: { projection_enabled: false, outbound_paused: false, backfill_enabled: false },
    directory: { active: 0, inactive: 0, unmapped: 0, last_seen_at: null },
    schedule: {
      retry_run_at: null, settle_run_at: null, users_sync_run_at: null, users_sync_success_at: null, reconcile_run_at: null,
      reconcile_success_at: null, reconcile_cursor_at: null, reconcile_lag_seconds: null, reconcile_daily_run_at: null,
      reconcile_daily_success_at: null, backfill_run_at: null, backfill_cursor_at: null, backfill_done_at: null,
      probe_run_at: null, probe_success_at: null,
    },
    pbx: { last_ok_at: null, last_error_at: null, last_error_code: null, facts: null },
    last_event_at: null,
    internal_calls_total: 0,
    evidence: { window_hours: 24, received: 0, rejected: 0, incomplete: 0 },
    automation_stop: { stopped_at: null, code: null },
    summaries: {},
    divergence: { window_hours: 24, reconciled_calls: 0, calls: 0 },
    work: {},
    ...overrides,
  };
}
function overviewSample({ settings = {}, health = {}, extensions, staff, escalation = null } = {}) {
  return {
    schemaVersion: 1,
    organizationId: ORG,
    now: "2026-10-17T10:00:00.000Z",
    settings: settingsSample(settings),
    escalation,
    health: healthSample(health),
    extensions: extensions ?? [
      { id: EXT, login: "u901", extension: "901", name: "PBX user 1", active: true, membershipId: null, membershipName: null, lastSeenAt: "2026-10-17T09:50:00.000Z", legsWithoutStaff: 2 },
    ],
    staff: staff ?? [
      { membershipId: ME, name: "Staff A", canManage: true },
      { membershipId: OTHER, name: "Staff B", canManage: false },
    ],
  };
}
const overview = (input) => normalizeTelephonyOverview(overviewSample(input));
const SERVER_ON = Object.freeze({ ingestEnabled: true, crmKey: "configured", crmKeyRotating: false, pbx: "ready" });
const SERVER_OFF = Object.freeze({ ingestEnabled: false, crmKey: "missing", crmKeyRotating: false, pbx: "not_configured" });
const FLAGS_ON = { projectionEnabled: true, uiEnabled: true, dialEnabled: false, missedTaskEnabled: false, unknownLeadEnabled: false, backfillEnabled: false, outboundPaused: false };

/* ------------------------------------------------------------ разбор */

test("the overview parser accepts the exact database answer and freezes it", () => {
  const parsed = overview();
  assert.ok(parsed);
  assert.equal(parsed.organizationId, ORG);
  assert.equal(parsed.settings.version, 3);
  assert.deepEqual(parsed.settings.hours.workingDays, [1, 2, 3, 4, 5, 6]);
  assert.equal(parsed.extensions[0].legsWithoutStaff, 2);
  assert.equal(parsed.health.pbx.facts.recordService, null);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.settings.flags), true);
  assert.equal(parsed.health.automationStop, null);
});

test("the overview parser refuses every deviation: unknown keys, wrong kinds, bad values", () => {
  const mutations = {
    "extra top key": (o) => { o.extra = 1; },
    "missing top key": (o) => { delete o.staff; },
    "schema version": (o) => { o.schemaVersion = 2; },
    "organization id": (o) => { o.organizationId = "nope"; },
    "now": (o) => { o.now = "yesterday"; },
    "settings extra key": (o) => { o.settings.extra = 1; },
    "settings version zero": (o) => { o.settings.version = 0; },
    "flag kind": (o) => { o.settings.flags.uiEnabled = "yes"; },
    "flag missing": (o) => { delete o.settings.flags.outboundPaused; },
    "days empty": (o) => { o.settings.hours.workingDays = []; },
    "days out of range": (o) => { o.settings.hours.workingDays = [1, 8]; },
    "days duplicate": (o) => { o.settings.hours.workingDays = [1, 1]; },
    "clock": (o) => { o.settings.hours.workFrom = "25:00"; },
    "prefix": (o) => { o.settings.dial.prefixes = ["996"]; },
    "prefix empty": (o) => { o.settings.dial.prefixes = []; },
    "limit kind": (o) => { o.settings.dial.limitOrgDay = "400"; },
    "ceiling zero": (o) => { o.settings.ceilings.tasksDay = 0; },
    "escalation id": (o) => { o.settings.escalationMembershipId = "x"; },
    "escalation shape": (o) => { o.escalation = { membershipId: ME, name: "A" }; },
    "health status": (o) => { o.health.status = "error"; },
    "health count": (o) => { o.health.directory.unmapped = -1; },
    "health time": (o) => { o.health.last_event_at = "soon"; },
    "health error code": (o) => { o.health.pbx.last_error_code = "Has Spaces"; },
    "health facts kind": (o) => { o.health.pbx.facts = { record_service: "yes" }; },
    "health stop code": (o) => { o.health.automation_stop = { stopped_at: "2026-10-17T09:00:00.000Z", code: "whatever" }; },
    "health stop without time": (o) => { o.health.automation_stop = { stopped_at: null, code: "tasks_day" }; },
    "extension extra key": (o) => { o.extensions[0].phone = "123"; },
    "extension id": (o) => { o.extensions[0].id = "x"; },
    "extension legs": (o) => { o.extensions[0].legsWithoutStaff = -1; },
    "extension active": (o) => { o.extensions[0].active = "yes"; },
    "staff shape": (o) => { o.staff[0].extra = true; },
    "staff name": (o) => { o.staff[0].name = ""; },
    "extensions kind": (o) => { o.extensions = {}; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const sample = overviewSample();
    mutate(sample);
    assert.equal(normalizeTelephonyOverview(sample), null, name);
  }
  for (const value of [null, undefined, "x", 5, [], {}]) assert.equal(normalizeTelephonyOverview(value), null);
});

test("known health facts and the automation stop mark are parsed; unknown fact names are tolerated only by the database lock", () => {
  const parsed = overview({
    health: healthSample({
      pbx: { last_ok_at: "2026-10-17T09:59:00.000Z", last_error_at: null, last_error_code: null, facts: { record_service: true, record_external: true, record_exceptions: 2, users_used: 4, users_total: 5, timezone_name: "Asia/Bishkek" } },
      automation_stop: { stopped_at: "2026-10-17T08:00:00.000Z", code: "tasks_hour" },
    }),
  });
  assert.equal(parsed.health.pbx.facts.recordExceptions, 2);
  assert.equal(parsed.health.pbx.facts.usersTotal, 5);
  assert.deepEqual(parsed.health.automationStop, { stoppedAt: "2026-10-17T08:00:00.000Z", code: "tasks_hour" });
});

test("receipts parse only their own shapes", () => {
  assert.deepEqual(normalizeTelephonySaveReceipt({ status: "saved", version: 4, changed: ["uiEnabled"], automationStopCleared: true, replayed: false, settings: {} }),
    { status: "saved", version: 4, changed: ["uiEnabled"], automationStopCleared: true, replayed: false });
  assert.equal(normalizeTelephonySaveReceipt({ status: "unchanged", version: 4, changed: [], replayed: false })?.automationStopCleared, false);
  for (const bad of [null, [], { status: "applied", version: 1, changed: [], replayed: false }, { status: "saved", version: 0, changed: [], replayed: false },
    { status: "saved", version: 2, changed: ["nope"], replayed: false }, { status: "saved", version: 2, changed: [], replayed: "no" },
    { status: "saved", version: 2, changed: "uiEnabled", replayed: false }]) {
    assert.equal(normalizeTelephonySaveReceipt(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(normalizeTelephonyMapReceipt({ status: "saved", extensionId: EXT, membershipId: ME, unmapped: 1, replayed: true }),
    { status: "saved", extensionId: EXT, membershipId: ME, unmapped: 1, replayed: true });
  assert.equal(normalizeTelephonyMapReceipt({ status: "saved", extensionId: EXT, membershipId: null, unmapped: 0, replayed: false })?.membershipId, null);
  for (const bad of [null, { status: "saved", extensionId: "x", membershipId: null, unmapped: 0, replayed: false },
    { status: "saved", extensionId: EXT, membershipId: "x", unmapped: 0, replayed: false },
    { status: "saved", extensionId: EXT, membershipId: null, unmapped: -1, replayed: false },
    { status: "gone", extensionId: EXT, membershipId: null, unmapped: 0, replayed: false }]) {
    assert.equal(normalizeTelephonyMapReceipt(bad), null, JSON.stringify(bad));
  }
});

/* ---------------------------------------------------- черновик формы */

test("the draft round-trips the settings and an untouched draft makes no patch", () => {
  const { settings } = overview();
  const draft = telephonyDraftFrom(settings);
  assert.deepEqual(telephonyDraftIssues(draft), []);
  assert.equal(telephonyPatchFrom(settings, draft), null);
  assert.equal(draft.prefixes, "+996");
  assert.deepEqual(telephonyOpeningFlags(settings, draft), []);
});

test("the patch carries only changed fields, with parsed numbers, sorted days and normalized prefixes", () => {
  const { settings } = overview();
  const draft = {
    ...telephonyDraftFrom(settings),
    flags: { ...settings.flags, projectionEnabled: true, uiEnabled: true },
    workingDays: [5, 1, 3],
    workFrom: "09:30",
    numbers: { ...telephonyDraftFrom(settings).numbers, limitUserDay: " 120 ", ceilingLeadsHour: "5" },
    prefixes: "7  +996, 992; +7",
    escalationMembershipId: ME,
  };
  assert.deepEqual(telephonyDraftIssues(draft), []);
  const patch = telephonyPatchFrom(settings, draft);
  assert.deepEqual(patch, {
    projectionEnabled: true, uiEnabled: true, limitUserDay: 120, ceilingLeadsHour: 5,
    workingDays: [1, 3, 5], workFrom: "09:30", dialPrefixes: ["+7", "+996", "+992"], escalationMembershipId: ME,
  });
  assert.equal(isTelephonyPatchShape(patch), true);
  // The escalation recipient can be cleared.
  const withRecipient = { ...settings, escalationMembershipId: ME };
  assert.deepEqual(telephonyPatchFrom(withRecipient, { ...telephonyDraftFrom(withRecipient), escalationMembershipId: "" }), { escalationMembershipId: null });
});

test("the draft issues repeat the table's CHECKs and the projection rule, and say what is wrong", () => {
  const { settings } = overview();
  const base = telephonyDraftFrom(settings);
  const fields = (draft) => telephonyDraftIssues(draft).map((issue) => issue.field);
  for (const [key, bounds] of Object.entries(TELEPHONY_BOUNDS)) {
    assert.deepEqual(fields({ ...base, numbers: { ...base.numbers, [key]: String(bounds.min) } }).filter((field) => field === key), [], `${key} min`);
    assert.deepEqual(fields({ ...base, numbers: { ...base.numbers, [key]: String(bounds.max) } }).filter((field) => field === key).length > 0
      && key !== "limitOrgHour" && key !== "ceilingLeadsHour" && key !== "ceilingTasksHour", false, `${key} max`);
    for (const bad of [String(bounds.min - 1), String(bounds.max + 1), "", "abc", "1.5", "-3"]) {
      assert.ok(fields({ ...base, numbers: { ...base.numbers, [key]: bad } }).includes(key), `${key}=${bad}`);
    }
  }
  assert.ok(fields({ ...base, numbers: { ...base.numbers, limitOrgHour: "500", limitOrgDay: "100" } }).includes("limitOrgHour"));
  assert.ok(fields({ ...base, numbers: { ...base.numbers, ceilingLeadsHour: "50", ceilingLeadsDay: "20" } }).includes("ceilingLeadsHour"));
  assert.ok(fields({ ...base, numbers: { ...base.numbers, ceilingTasksHour: "200", ceilingTasksDay: "100" } }).includes("ceilingTasksHour"));
  assert.ok(fields({ ...base, workFrom: "20:00", workTo: "10:00" }).includes("workTo"));
  assert.ok(fields({ ...base, workFrom: "10:00", workTo: "10:00" }).includes("workTo"));
  assert.ok(fields({ ...base, workFrom: "" }).includes("workFrom"));
  assert.ok(fields({ ...base, workingDays: [] }).includes("workingDays"));
  assert.ok(fields({ ...base, prefixes: "" }).includes("dialPrefixes"));
  assert.ok(fields({ ...base, prefixes: "+0, abc" }).includes("dialPrefixes"));
  assert.ok(fields({ ...base, prefixes: Array.from({ length: 21 }, (_, index) => `+${100 + index}`).join(" ") }).includes("dialPrefixes"));
  for (const flag of ["missedTaskEnabled", "unknownLeadEnabled", "backfillEnabled"]) {
    const draft = { ...base, flags: { ...base.flags, [flag]: true } };
    assert.ok(fields(draft).includes("projectionEnabled"), flag);
    assert.equal(fields({ ...draft, flags: { ...draft.flags, projectionEnabled: true } }).includes("projectionEnabled"), false, flag);
  }
  for (const issue of telephonyDraftIssues({ ...base, workingDays: [], prefixes: "x" })) assert.match(issue.message, /[А-Яа-я]/u);
});

test("prefixes: digits get a plus, duplicates collapse, anything else is reported", () => {
  assert.deepEqual(parseTelephonyPrefixes("996 +996,  7;;+7 998"), { list: ["+996", "+7", "+998"], invalid: [] });
  assert.deepEqual(parseTelephonyPrefixes("+0 12345 abc +99"), { list: ["+99"], invalid: ["+0", "12345", "abc"] });
  assert.deepEqual(parseTelephonyPrefixes("   "), { list: [], invalid: [] });
});

test("opening flags: turning something on, or taking the pause off, needs the confirmation; turning off does not", () => {
  const { settings } = overview({ settings: { flags: { ...FLAGS_ON, outboundPaused: true } } });
  const draft = telephonyDraftFrom(settings);
  assert.deepEqual(telephonyOpeningFlags(settings, draft), []);
  assert.deepEqual(telephonyOpeningFlags(settings, { ...draft, flags: { ...draft.flags, dialEnabled: true, outboundPaused: false } }), ["dialEnabled", "outboundPaused"]);
  assert.deepEqual(telephonyOpeningFlags(settings, { ...draft, flags: { ...draft.flags, uiEnabled: false, projectionEnabled: false } }), []);
  assert.deepEqual(telephonyOpeningFlags(settings, { ...draft, flags: { ...draft.flags, outboundPaused: true } }), []);
});

test("the patch shape check is the route's first gate: known keys, right kinds, no extras", () => {
  const good = [{ uiEnabled: true }, { limitUserDay: 10 }, { workingDays: [1, 2] }, { dialPrefixes: ["+996"] }, { workFrom: "09:00" },
    { escalationMembershipId: null }, { escalationMembershipId: ME }];
  for (const patch of good) assert.equal(isTelephonyPatchShape(patch), true, JSON.stringify(patch));
  const bad = [null, [], "x", {}, { nope: true }, { uiEnabled: "yes" }, { uiEnabled: 1 }, { limitUserDay: "10" }, { limitUserDay: 1.5 }, { limitUserDay: -1 },
    { limitUserDay: 100000 }, { workingDays: [] }, { workingDays: [0] }, { workingDays: [1.5] }, { workingDays: "1" }, { dialPrefixes: [] },
    { dialPrefixes: ["996"] }, { dialPrefixes: [996] }, { workFrom: "9:00" }, { workTo: 5 }, { escalationMembershipId: "x" },
    { escalationMembershipId: "ABCDEF00-0000-4000-8000-000000000002" }, { escalationMembershipId: 5 }, { uiEnabled: true, nope: 1 }];
  for (const patch of bad) assert.equal(isTelephonyPatchShape(patch), false, JSON.stringify(patch));
  assert.equal(TELEPHONY_PATCH_KEYS.length, 21);
  assert.equal(new Set(TELEPHONY_PATCH_KEYS).size, 21);
});

test("every API error code has a Russian sentence; an unknown one is the safe retry text", () => {
  const codes = ["version_conflict", "request_conflict", "mapping_changed", "membership_taken", "membership_invalid", "extension_inactive",
    "projection_required", "escalation_invalid", "not_found", "forbidden", "preview", "authentication_required", "settings_invalid", "invalid_request"];
  for (const code of codes) assert.match(telephonyErrorMessage(code), /[А-Яа-я]{4}/u, code);
  assert.match(telephonyErrorMessage("settings_invalid", "telephony_settings_hours_check"), /кончаться позже/u);
  assert.match(telephonyErrorMessage("settings_invalid", "telephony_settings_dial_limits_check"), /в час/u);
  assert.match(telephonyErrorMessage("settings_invalid", "telephony_settings_ceilings_check"), /Потолок/u);
  assert.match(telephonyErrorMessage("unavailable"), /безопасно повторите/u);
  assert.equal(telephonyErrorMessage(undefined), telephonyErrorMessage("anything_else"));
});

/* ----------------------------------------------------------- состояние */

test("formatTelephonyTime is Bishkek time, year only when it is not the current one", () => {
  assert.equal(formatTelephonyTime("2026-10-17T06:05:00.000Z", NOW), "17.10 12:05");
  assert.equal(formatTelephonyTime("2025-10-16T06:05:00.000Z", NOW), "16.10.25 12:05");
  assert.equal(formatTelephonyTime("2025-12-31T20:30:00.000Z", NOW), "01.01 02:30", "Bishkek is already in the new year");
  assert.equal(formatTelephonyTime(null, NOW), null);
  assert.equal(formatTelephonyTime("never", NOW), null);
});

test("everything off, nothing on the server: «выключено», no work claimed, no issue", () => {
  const parsed = overview();
  assert.deepEqual(telephonyIssues(SERVER_OFF, parsed, NOW), []);
  const row = telephonyIntegrationRow({ server: SERVER_OFF, overview: parsed }, NOW);
  assert.equal(row.key, "telephony");
  assert.equal(row.state, "выключено");
  assert.equal(row.tone, "off");
  assert.equal(row.blocksWork, false);
  assert.equal(row.action.link.href, "/v3/settings?section=telephony");
  const lines = telephonyStatusLines(SERVER_OFF, parsed, NOW);
  assert.deepEqual(lines.map((line) => line.id), ["intake", "crm_key", "pbx_key", "pbx_link", "last_event", "reconcile", "directory", "evidence", "divergence", "record", "backfill", "automation"]);
  assert.equal(lines.find((line) => line.id === "intake").value, "выключен");
  assert.equal(lines.find((line) => line.id === "intake").tone, "off");
  assert.equal(lines.every((line) => line.tone === "off"), true);
  assert.doesNotMatch(JSON.stringify([row, lines]), /работает|готов/u);
});

test("the plan's honest states, each from its own fact", () => {
  const states = (server, input, now = NOW) => telephonyIssues(server, overview(input), now).map((issue) => issue.text);

  // Flags on but the server does not receive.
  assert.deepEqual(states(SERVER_OFF, { settings: { flags: FLAGS_ON } }), ["Приём выключен на сервере"]);
  // Intake on, key missing.
  assert.deepEqual(states({ ...SERVER_ON, crmKey: "missing" }, {}), ["Ключ не задан"]);
  // Intake on, PBX group missing / invalid.
  assert.deepEqual(states({ ...SERVER_ON, pbx: "not_configured" }, {}), ["Ключ ВАТС не задан"]);
  assert.deepEqual(states({ ...SERVER_ON, pbx: "invalid" }, {}), ["Ключ ВАТС задан неверно"]);
  // The PBX said no.
  const err = (code) => ({ health: healthSample({ pbx: { last_ok_at: "2026-10-17T08:00:00.000Z", last_error_at: "2026-10-17T09:00:00.000Z", last_error_code: code, facts: null } }) });
  assert.deepEqual(states(SERVER_ON, err("pbx_invalid_token")), ["ВАТС отклонила ключ"]);
  assert.deepEqual(states(SERVER_ON, err("pbx_unauthorized")), ["ВАТС отклонила ключ"]);
  assert.deepEqual(states(SERVER_ON, err("pbx_crm_switched_off")), ["Подключение выключено в кабинете"]);
  assert.deepEqual(states(SERVER_ON, err("pbx_crm_disabled")), ["Подключение выключено в кабинете"]);
  assert.deepEqual(states(SERVER_ON, err("pbx_forbidden")), ["У ключа ВАТС нет прав на метод"]);
  assert.deepEqual(states(SERVER_ON, err("pbx_timeout")), ["ВАТС не ответила на последний запрос"]);
  // A success after the error cleans it.
  assert.deepEqual(states(SERVER_ON, { health: healthSample({ pbx: { last_ok_at: "2026-10-17T09:30:00.000Z", last_error_at: "2026-10-17T09:00:00.000Z", last_error_code: "pbx_forbidden", facts: null } }) }), []);
  // No PBX group: the old error is not shown as a current one.
  assert.deepEqual(states({ ...SERVER_ON, pbx: "not_configured" }, err("pbx_forbidden")), ["Ключ ВАТС не задан"]);
  // Quiet intake: two days or more, only with intake open and a key.
  const quiet = { health: healthSample({ last_event_at: "2026-10-14T10:00:00.000Z" }) };
  assert.deepEqual(states(SERVER_ON, quiet), ["Событий не было 3 дн."]);
  assert.deepEqual(states(SERVER_ON, { health: healthSample({ last_event_at: "2026-10-16T10:30:00.000Z" }) }), []);
  assert.deepEqual(states(SERVER_OFF, quiet), []);
  // Directory, divergence, rejected, recording.
  assert.deepEqual(states(SERVER_ON, { health: healthSample({ directory: { active: 3, inactive: 0, unmapped: 2, last_seen_at: null } }) }), ["Не сопоставлено пользователей: 2"]);
  assert.deepEqual(states(SERVER_ON, { health: healthSample({ divergence: { window_hours: 24, reconciled_calls: 4, calls: 30 } }) }), ["Расхождений со сверкой за сутки: 4"]);
  assert.deepEqual(states(SERVER_ON, { health: healthSample({ evidence: { window_hours: 24, received: 9, rejected: 3, incomplete: 0 } }) }), ["Отклонённых после проверки ключа: 3"]);
  const record = (facts) => ({ health: healthSample({ pbx: { last_ok_at: null, last_error_at: null, last_error_code: null, facts } }) });
  assert.deepEqual(states(SERVER_ON, record({ record_service: false })), ["Запись в ВАТС выключена"]);
  assert.deepEqual(states(SERVER_ON, record({ record_service: true, record_external: false })), ["Запись в ВАТС выключена"]);
  assert.deepEqual(states(SERVER_ON, record({ record_service: true, record_external: true, record_exceptions: 2 })), ["Сотрудников без записи разговоров: 2"]);
  assert.deepEqual(states(SERVER_ON, record({ record_service: true, record_external: true, record_exceptions: 0 })), []);
  // The ceiling stop.
  assert.deepEqual(states(SERVER_ON, { health: healthSample({ automation_stop: { stopped_at: "2026-10-17T08:00:00.000Z", code: "leads_day" } }) }),
    ["Автоматика остановлена по потолку (потолок новых лидов в сутки)"]);
});

test("the integrations row names the heaviest issue first, keeps the rest in the detail and never claims 'works'", () => {
  const parsed = overview({
    settings: { flags: FLAGS_ON },
    health: healthSample({
      directory: { active: 3, inactive: 0, unmapped: 1, last_seen_at: null },
      automation_stop: { stopped_at: "2026-10-17T08:00:00.000Z", code: "tasks_hour" },
      pbx: { last_ok_at: "2026-10-17T08:00:00.000Z", last_error_at: "2026-10-17T09:00:00.000Z", last_error_code: "pbx_forbidden", facts: null },
    }),
  });
  const row = telephonyIntegrationRow({ server: SERVER_ON, overview: parsed }, NOW);
  assert.equal(row.state, "автоматика остановлена по потолку (потолок задач в час)");
  assert.equal(row.tone, "blocked");
  assert.match(row.detail, /У ключа ВАТС нет прав на метод\./u);
  assert.match(row.detail, /Не сопоставлено пользователей: 1\./u);
  assert.equal(row.blocksWork, false);
  assert.equal(row.checkedText, "17.10 14:00");
  assert.ok(row.without);

  const running = telephonyIntegrationRow({ server: SERVER_ON, overview: overview({ settings: { flags: FLAGS_ON } }) }, NOW);
  assert.equal(running.state, "приём включён");
  assert.equal(running.tone, "ok");
  assert.equal(running.without, null);

  const missingKey = telephonyIntegrationRow({ server: { ...SERVER_OFF, ingestEnabled: true }, overview: overview() }, NOW);
  assert.equal(missingKey.state, "ключ не задан");
  assert.match(missingKey.action.handoff, /техническому специалисту/u);

  const unreadable = telephonyIntegrationRow({ server: SERVER_ON, overview: null }, NOW);
  assert.equal(unreadable.state, "нет данных");
  assert.equal(unreadable.tone, "warn");
  assert.equal(unreadable.checkedAt, null);
});

test("the integrations table gets a fourth row only when telephony facts are passed", () => {
  const facts = {
    waha: { display: "not_configured", sessionStatus: undefined, observedAt: null },
    gemini: "not_configured",
    amo: { status: "blocked", reason: "configuration_missing" },
  };
  assert.deepEqual(settingsIntegrations(facts, NOW).map((row) => row.key), ["whatsapp", "amocrm", "gemini"]);
  const withTelephony = settingsIntegrations({ ...facts, telephony: { server: SERVER_OFF, overview: overview() } }, NOW);
  assert.deepEqual(withTelephony.map((row) => row.key), ["whatsapp", "amocrm", "gemini", "telephony"]);
  assert.equal(withTelephony.some((row) => row.blocksWork), false);
});

test("status lines say the facts of the screen: keys are 'set' or 'not set', never a value", () => {
  const parsed = overview({
    settings: { flags: { ...FLAGS_ON, backfillEnabled: true } },
    health: healthSample({
      directory: { active: 3, inactive: 1, unmapped: 2, last_seen_at: "2026-10-17T09:50:00.000Z" },
      schedule: { ...healthSample().schedule, reconcile_success_at: "2026-10-17T09:55:00.000Z", reconcile_cursor_at: "2026-10-17T09:55:00.000Z", reconcile_lag_seconds: 300, backfill_cursor_at: "2026-02-01T00:00:00.000Z" },
      pbx: { last_ok_at: "2026-10-17T09:59:00.000Z", last_error_at: null, last_error_code: null, facts: { record_service: true, record_external: true, record_exceptions: 1 } },
      last_event_at: "2026-10-17T09:58:00.000Z",
      evidence: { window_hours: 24, received: 12, rejected: 1, incomplete: 2 },
      divergence: { window_hours: 24, reconciled_calls: 1, calls: 20 },
    }),
  });
  const lines = Object.fromEntries(telephonyStatusLines({ ...SERVER_ON, crmKeyRotating: true }, parsed, NOW).map((line) => [line.id, line]));
  assert.equal(lines.intake.value, "включён");
  assert.equal(lines.crm_key.value, "задан, идёт замена");
  assert.equal(lines.pbx_key.value, "задан");
  assert.equal(lines.pbx_link.value, "на связи");
  assert.match(lines.pbx_link.note, /17\.10 15:59/u);
  assert.equal(lines.last_event.tone, "ok");
  assert.equal(lines.reconcile.tone, "ok");
  assert.equal(lines.directory.value, "3 в ВАТС, не сопоставлено 2");
  assert.equal(lines.directory.tone, "warn");
  assert.equal(lines.evidence.value, "принято 12, отклонено после проверки ключа 1, неполных 2");
  assert.equal(lines.divergence.value, "1 из 20 звонков");
  assert.equal(lines.record.value, "включена, у 1 сотрудника выключена");
  assert.equal(lines.backfill.tone, "warn");
  assert.match(lines.backfill.value, /идёт, дошёл до 01\.02/u);
  const text = JSON.stringify(lines);
  assert.doesNotMatch(text, /[A-Za-z0-9-]{32,}/u, "no key-like value anywhere");
  // Case endings after a number: 1 and 21 take the singular genitive, 2, 5 and 11 the plural.
  const worded = (reconciled, calls, exceptions) => Object.fromEntries(telephonyStatusLines(SERVER_ON, overview({
    health: healthSample({
      divergence: { window_hours: 24, reconciled_calls: reconciled, calls },
      pbx: { last_ok_at: null, last_error_at: null, last_error_code: null, facts: { record_service: true, record_external: true, record_exceptions: exceptions } },
    }),
  }), NOW).map((item) => [item.id, item]));
  assert.equal(worded(1, 21, 21).divergence.value, "1 из 21 звонка");
  assert.equal(worded(1, 11, 11).divergence.value, "1 из 11 звонков");
  assert.equal(worded(2, 2, 2).record.value, "включена, у 2 сотрудников выключена");
  assert.equal(worded(2, 2, 21).record.value, "включена, у 21 сотрудника выключена");
  assert.equal(worded(2, 2, 11).record.value, "включена, у 11 сотрудников выключена");
  const paused = Object.fromEntries(telephonyStatusLines(SERVER_ON, overview({ settings: { flags: { ...FLAGS_ON, outboundPaused: true } } }), NOW).map((line) => [line.id, line]));
  assert.equal(paused.pbx_link.value, "исходящие запросы на паузе");
  const noKey = Object.fromEntries(telephonyStatusLines({ ...SERVER_ON, crmKey: "missing", pbx: "invalid" }, overview(), NOW).map((line) => [line.id, line]));
  assert.equal(noKey.crm_key.tone, "blocked");
  assert.equal(noKey.pbx_key.value, "задан неверно");
});

test("health words: an abbreviation keeps its capitals, automation says «включена» with the ok mark, a line that needs a look carries what is lost and who fixes it", () => {
  assert.equal(lowerFirstWord("ВАТС отклонила ключ"), "ВАТС отклонила ключ", "not «вАТС отклонила ключ»");
  assert.equal(lowerFirstWord("Приём выключен на сервере"), "приём выключен на сервере");
  assert.equal(lowerFirstWord("У ключа ВАТС нет прав на метод"), "у ключа ВАТС нет прав на метод", "a one-letter word is not an abbreviation");
  assert.equal(lowerFirstWord("Подключение выключено в кабинете"), "подключение выключено в кабинете");
  const rejected = overview({
    settings: { flags: FLAGS_ON },
    health: healthSample({ pbx: { last_ok_at: null, last_error_at: "2026-10-17T09:59:00.000Z", last_error_code: "pbx_unauthorized", facts: null } }),
  });
  const row = telephonyIntegrationRow({ server: SERVER_ON, overview: rejected }, NOW);
  assert.equal(row.state, "ВАТС отклонила ключ", "the integrations table does not lowercase the abbreviation either");
  const lines = Object.fromEntries(telephonyStatusLines(SERVER_ON, rejected, NOW).map((line) => [line.id, line]));
  assert.equal(lines.pbx_link.value, "ВАТС отклонила ключ");
  assert.equal(lines.pbx_link.tone, "blocked");
  assert.match(lines.pbx_link.without, /Запросы CRM к ВАТС не проходят/u, "what stops stands on the line itself");
  // A line that is fine or off carries nothing extra.
  assert.equal(lines.intake.without, null);
  assert.equal(lines.intake.handoff, null);
  // Server work is handed over by name on the line it concerns.
  const off = Object.fromEntries(telephonyStatusLines(SERVER_OFF, overview({ settings: { flags: FLAGS_ON } }), NOW).map((line) => [line.id, line]));
  assert.equal(off.intake.tone, "warn");
  assert.match(off.intake.handoff, /^Передать техническому специалисту: включить приём телефонии на сервере$/u);
  // Automation: a switch on is an ok mark with the word «включена» (an empty circle beside «включена» read as a contradiction); off stays off.
  const on = Object.fromEntries(telephonyStatusLines(SERVER_ON, overview({ settings: { flags: { ...FLAGS_ON, missedTaskEnabled: true } } }), NOW).map((line) => [line.id, line]));
  assert.deepEqual([on.automation.value, on.automation.tone], ["включена", "ok"]);
  const none = Object.fromEntries(telephonyStatusLines(SERVER_ON, overview(), NOW).map((line) => [line.id, line]));
  assert.deepEqual([none.automation.value, none.automation.tone], ["выключена", "off"]);
});

/* -------------------------------------------------------------- сервер */

test("server facts are booleans and words; no env value reaches them", () => {
  const crmKeyProbe = "a1b2c3d4-e5f6-4a8b-9c0d-1234567890ab";
  const pbxKeyProbe = "pbx-secret-token-value-123456";
  const env = {
    EVO_PLATFORM_TELEPHONY_ENABLED: "1",
    EVO_PLATFORM_TELEPHONY_CRM_TOKEN: crmKeyProbe,
    EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: "b1b2c3d4-e5f6-4a8b-9c0d-1234567890ab",
    EVO_PLATFORM_TELEPHONY_PBX_TOKEN: pbxKeyProbe,
    EVO_PLATFORM_TELEPHONY_PBX_URL: "https://tenant.ats.beeline.kg/crmapi/v1",
    EVO_PLATFORM_TELEPHONY_PBX_HOST: "tenant.ats.beeline.kg",
  };
  const facts = readTelephonyServerFacts(env);
  assert.deepEqual(facts, { ingestEnabled: true, crmKey: "configured", crmKeyRotating: true, pbx: "ready" });
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(`${crmKeyProbe}|${pbxKeyProbe}|tenant`, "u"));
  assert.deepEqual(readTelephonyServerFacts({}), { ingestEnabled: false, crmKey: "missing", crmKeyRotating: false, pbx: "not_configured" });
  assert.equal(readTelephonyServerFacts({ ...env, EVO_PLATFORM_TELEPHONY_ENABLED: "0" }).ingestEnabled, false);
  assert.equal(readTelephonyServerFacts({ ...env, EVO_PLATFORM_TELEPHONY_ENABLED: "true" }).ingestEnabled, false);
  assert.equal(readTelephonyServerFacts({ ...env, EVO_PLATFORM_TELEPHONY_CRM_TOKEN: "short" }).crmKey, "missing");
  assert.equal(readTelephonyServerFacts({ ...env, EVO_PLATFORM_TELEPHONY_PBX_HOST: "" }).pbx, "invalid");
  assert.equal(readTelephonyServerFacts({ ...env, EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: undefined }).crmKeyRotating, false);
});

const ADMIN = { systemRole: "admin", presentationRole: null, organizationId: ORG, permissionKeys: [], platformAccessVersion: 1 };
const SUPERVISOR = { systemRole: "staff", presentationRole: null, organizationId: ORG, permissionKeys: ["telephony.manage"], platformAccessVersion: 1 };
const MANAGER = { systemRole: "staff", presentationRole: null, organizationId: ORG, permissionKeys: ["telephony.call.dial"], platformAccessVersion: 1 };

test("reading the screen: ready, unavailable and forbidden — and the database is not asked without the right", async () => {
  const calls = [];
  const rpc = async (name, args) => { calls.push([name, args]); return { data: overviewSample(), error: null }; };
  const ready = await readTelephonyAdmin(SUPERVISOR, { rpc, environment: {} });
  assert.equal(ready.status, "ready");
  assert.equal(ready.inboundUrl, "https://crm.evoadmissions.com/api/v2/telephony/beeline/inbound");
  assert.deepEqual(calls, [["telephony_manage_overview_v1", { p_organization_id: ORG }]]);
  assert.equal((await readTelephonyAdmin(ADMIN, { rpc, environment: {} })).status, "ready");
  calls.length = 0;
  assert.deepEqual(await readTelephonyAdmin(MANAGER, { rpc, environment: {} }), { status: "forbidden" });
  assert.equal(calls.length, 0);
  assert.deepEqual(await readTelephonyAdmin(SUPERVISOR, { rpc: async () => ({ data: null, error: { code: "42501", message: "telephony_manage_forbidden" } }), environment: {} }), { status: "forbidden" });
  assert.equal((await readTelephonyAdmin(SUPERVISOR, { rpc: async () => ({ data: null, error: { code: "57014" } }), environment: {} })).status, "unavailable");
  assert.equal((await readTelephonyAdmin(SUPERVISOR, { rpc: async () => ({ data: { schemaVersion: 2 }, error: null }), environment: {} })).status, "unavailable");
  assert.equal((await readTelephonyAdmin(SUPERVISOR, { rpc: async () => { throw new Error("boom"); }, environment: {} })).status, "unavailable");
  const facts = telephonyIntegrationFactsFrom(ready);
  assert.equal(facts.overview.settings.version, 3);
  assert.equal(telephonyIntegrationFactsFrom({ status: "unavailable", server: SERVER_ON }).overview, null);
  assert.equal(telephonyIntegrationFactsFrom({ status: "forbidden" }), undefined);
  assert.equal(telephonyIntegrationFactsFrom(null), undefined);
});

test("database errors become route words by SQLSTATE and message, never by text", () => {
  const cases = [
    [{ code: "42501", message: "telephony_manage_forbidden" }, 403, "forbidden"],
    [{ code: "P0002", message: "telephony_extension_not_found" }, 404, "not_found"],
    [{ code: "23505", message: "telephony_request_conflict" }, 409, "request_conflict"],
    [{ code: "PT409", message: "telephony_settings_version_conflict" }, 409, "version_conflict"],
    [{ code: "PT409", message: "telephony_membership_taken" }, 409, "membership_taken"],
    [{ code: "PT409", message: "telephony_mapping_changed" }, 409, "mapping_changed"],
    [{ code: "PT412", message: "telephony_projection_required" }, 412, "projection_required"],
    [{ code: "PT412", message: "telephony_extension_inactive" }, 412, "extension_inactive"],
    [{ code: "22023", message: "telephony_escalation_invalid" }, 422, "escalation_invalid"],
    [{ code: "22023", message: "telephony_membership_invalid" }, 422, "membership_invalid"],
    [{ code: "22023", message: "telephony_settings_invalid", details: "telephony_settings_hours_check" }, 422, "settings_invalid"],
    [{ code: "22023", message: "telephony_settings_invalid" }, 422, "settings_invalid"],
    [{ code: "57014", message: "canceling statement" }, 503, "unavailable"],
    [{}, 503, "unavailable"],
  ];
  for (const [error, http, code] of cases) {
    const failure = telephonyCommandFailure(error);
    assert.equal(failure.http, http, JSON.stringify(error));
    assert.equal(failure.code, code, JSON.stringify(error));
  }
  assert.equal(telephonyCommandFailure({ code: "22023", message: "telephony_settings_invalid", details: "telephony_settings_hours_check" }).constraint, "telephony_settings_hours_check");
  // A detail that is not a constraint name (it could be a value) is dropped.
  assert.equal(telephonyCommandFailure({ code: "22023", message: "telephony_settings_invalid", details: "Failing row contains (+996555000111)" }).constraint, undefined);
  assert.equal(JSON.stringify(telephonyCommandFailure({ code: "22023", message: "x", details: "+996555000111" })).includes("996555"), false);
});

test("saving and mapping call the database with the exact arguments and parse the receipt", async () => {
  const calls = [];
  const rpc = (answer) => async (name, args) => { calls.push([name, args]); return answer; };
  const saved = await saveTelephonySettings(SUPERVISOR, { requestId: REQ, expectedVersion: 3, patch: { uiEnabled: true } },
    rpc({ data: { status: "saved", version: 4, changed: ["uiEnabled"], automationStopCleared: false, replayed: false, settings: {} }, error: null }));
  assert.deepEqual(saved, { status: "ok", receipt: { status: "saved", version: 4, changed: ["uiEnabled"], automationStopCleared: false, replayed: false } });
  assert.deepEqual(calls[0], ["telephony_settings_save_v1", { p_organization_id: ORG, p_expected_version: 3, p_patch: { uiEnabled: true }, p_request_id: REQ }]);
  assert.deepEqual(await saveTelephonySettings(SUPERVISOR, { requestId: REQ, expectedVersion: 3, patch: { uiEnabled: true } },
    rpc({ data: null, error: { code: "PT409", message: "telephony_settings_version_conflict" } })), { status: "failed", http: 409, code: "version_conflict" });
  assert.equal((await saveTelephonySettings(SUPERVISOR, { requestId: REQ, expectedVersion: 3, patch: { uiEnabled: true } }, rpc({ data: { status: "weird" }, error: null }))).code, "unavailable");
  assert.equal((await saveTelephonySettings(SUPERVISOR, { requestId: REQ, expectedVersion: 3, patch: { uiEnabled: true } }, async () => { throw new Error("x"); })).code, "unavailable");

  calls.length = 0;
  const mapped = await mapTelephonyExtension(ADMIN, { requestId: REQ, extensionId: EXT, previousMembershipId: null, membershipId: ME },
    rpc({ data: { status: "saved", extensionId: EXT, membershipId: ME, unmapped: 0, replayed: false }, error: null }));
  assert.deepEqual(mapped, { status: "ok", receipt: { status: "saved", extensionId: EXT, membershipId: ME, unmapped: 0, replayed: false } });
  assert.deepEqual(calls[0], ["telephony_extension_map_v1", {
    p_organization_id: ORG, p_extension_id: EXT, p_previous_membership_id: null, p_membership_id: ME, p_request_id: REQ,
  }]);
  assert.equal((await mapTelephonyExtension(ADMIN, { requestId: REQ, extensionId: EXT, previousMembershipId: null, membershipId: ME },
    rpc({ data: null, error: { code: "PT409", message: "telephony_membership_taken" } }))).code, "membership_taken");
});

/* ------------------------------------------------------------ маршруты */

function post(path, body, headers = {}) {
  return new Request(`https://crm.evoadmissions.com${path}`, {
    method: "POST",
    headers: { origin: "https://crm.evoadmissions.com", host: "crm.evoadmissions.com", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function handlers(overrides = {}) {
  const log = { save: [], map: [] };
  const dependencies = {
    authorize: async () => ({ status: "authorized", actor: SUPERVISOR }),
    save: async (actor, input) => { log.save.push([actor, input]); return { status: "ok", receipt: { status: "saved", version: 4, changed: ["uiEnabled"], automationStopCleared: false, replayed: false } }; },
    map: async (actor, input) => { log.map.push([actor, input]); return { status: "ok", receipt: { status: "saved", extensionId: EXT, membershipId: ME, unmapped: 0, replayed: false } }; },
    ...overrides,
  };
  return { log, save: createTelephonySettingsHandler(dependencies), map: createTelephonyExtensionHandler(dependencies) };
}
const SETTINGS_BODY = { requestId: REQ, expectedVersion: 3, patch: { uiEnabled: true } };
const MAP_BODY = { requestId: REQ, extensionId: EXT, previousMembershipId: null, membershipId: ME };

test("both routes: same-origin first, then session, preview and the right — the database is never reached otherwise", async () => {
  for (const [path, body, pick] of [["/api/v3/telephony/settings", SETTINGS_BODY, "save"], ["/api/v3/telephony/extensions", MAP_BODY, "map"]]) {
    const { log, ...routes } = handlers();
    const handler = routes[pick];
    for (const headers of [{ origin: "" }, { origin: "https://evil.example" }, { origin: "https://crm.evoadmissions.com.evil.example" }, { host: "other.example" }]) {
      const request = post(path, body, headers);
      if (headers.origin === "") request.headers.delete("origin");
      const response = await handler(request);
      assert.equal(response.status, 403, `${path} ${JSON.stringify(headers)}`);
      assert.deepEqual(await response.json(), { error: { code: "forbidden" } });
    }
    assert.equal(log.save.length + log.map.length, 0);
    const wordFor = { anonymous: [401, "authentication_required"], preview: [403, "preview"], forbidden: [403, "forbidden"], unavailable: [503, "unavailable"] };
    for (const [status, [http, code]] of Object.entries(wordFor)) {
      const refused = handlers({ authorize: async () => ({ status, actor: null }) });
      const response = await refused[pick](post(path, body));
      assert.equal(response.status, http, status);
      assert.deepEqual(await response.json(), { error: { code } }, status);
      assert.equal(refused.log.save.length + refused.log.map.length, 0, status);
    }
    const broken = handlers({ authorize: async () => { throw new Error("auth down"); } });
    assert.equal((await broken[pick](post(path, body))).status, 503);
  }
});

test("the settings route accepts one exact JSON shape and forwards exactly it", async () => {
  const { log, save } = handlers();
  const response = await save(post("/api/v3/telephony/settings", SETTINGS_BODY));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { receipt: { status: "saved", version: 4, changed: ["uiEnabled"], automationStopCleared: false, replayed: false } });
  assert.deepEqual(log.save, [[SUPERVISOR, { requestId: REQ, expectedVersion: 3, patch: { uiEnabled: true } }]]);

  const bad = [
    ["text", "not json"],
    ["array", "[]"],
    ["extra key", { ...SETTINGS_BODY, actor: "me" }],
    ["no request id", { expectedVersion: 3, patch: { uiEnabled: true } }],
    ["bad request id", { ...SETTINGS_BODY, requestId: "nope" }],
    ["upper request id", { ...SETTINGS_BODY, requestId: "ABCDEF00-0000-4000-8000-000000000005" }],
    ["no version", { requestId: REQ, patch: { uiEnabled: true } }],
    ["version zero", { ...SETTINGS_BODY, expectedVersion: 0 }],
    ["version string", { ...SETTINGS_BODY, expectedVersion: "3" }],
    ["version fraction", { ...SETTINGS_BODY, expectedVersion: 1.5 }],
    ["empty patch", { ...SETTINGS_BODY, patch: {} }],
    ["unknown patch key", { ...SETTINGS_BODY, patch: { crmToken: "x" } }],
    ["wrong patch kind", { ...SETTINGS_BODY, patch: { uiEnabled: "yes" } }],
    ["oversized", { ...SETTINGS_BODY, patch: { dialPrefixes: Array.from({ length: 2000 }, () => "+996") } }],
  ];
  for (const [name, body] of bad) {
    const probe = handlers();
    const response = await probe.save(post("/api/v3/telephony/settings", body));
    assert.equal(response.status, 400, name);
    assert.deepEqual(await response.json(), { error: { code: "invalid_request" } }, name);
    assert.equal(probe.log.save.length, 0, name);
  }
  const probe = handlers();
  assert.equal((await probe.save(post("/api/v3/telephony/settings", SETTINGS_BODY, { "content-type": "text/plain" }))).status, 400);
  assert.equal((await probe.save(post("/api/v3/telephony/settings?x=1", SETTINGS_BODY))).status, 400);
  assert.equal(probe.log.save.length, 0);
});

test("the extension route accepts the PBX user, what the person saw and the new member (or nobody)", async () => {
  const { log, map } = handlers();
  const ok = await map(post("/api/v3/telephony/extensions", MAP_BODY));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { receipt: { status: "saved", extensionId: EXT, membershipId: ME, unmapped: 0, replayed: false } });
  assert.deepEqual(log.map[0][1], { requestId: REQ, extensionId: EXT, previousMembershipId: null, membershipId: ME });
  await map(post("/api/v3/telephony/extensions", { ...MAP_BODY, previousMembershipId: OTHER, membershipId: null }));
  assert.deepEqual(log.map[1][1], { requestId: REQ, extensionId: EXT, previousMembershipId: OTHER, membershipId: null });
  const bad = [
    ["extra key", { ...MAP_BODY, login: "u901" }],
    ["no extension", { requestId: REQ, previousMembershipId: null, membershipId: ME }],
    ["bad extension", { ...MAP_BODY, extensionId: "u901" }],
    ["previous omitted", { requestId: REQ, extensionId: EXT, membershipId: ME }],
    ["previous bad", { ...MAP_BODY, previousMembershipId: "x" }],
    ["member omitted", { requestId: REQ, extensionId: EXT, previousMembershipId: null }],
    ["member bad", { ...MAP_BODY, membershipId: 5 }],
    ["bad request id", { ...MAP_BODY, requestId: "x" }],
  ];
  for (const [name, body] of bad) {
    const probe = handlers();
    const response = await probe.map(post("/api/v3/telephony/extensions", body));
    assert.equal(response.status, 400, name);
    assert.equal(probe.log.map.length, 0, name);
  }
});

test("database refusals reach the browser as a status, a code and (for CHECKs) the constraint name — nothing else", async () => {
  const failures = [
    [{ status: "failed", http: 409, code: "version_conflict" }, 409, { error: { code: "version_conflict" } }],
    [{ status: "failed", http: 412, code: "projection_required" }, 412, { error: { code: "projection_required" } }],
    [{ status: "failed", http: 422, code: "settings_invalid", constraint: "telephony_settings_hours_check" }, 422, { error: { code: "settings_invalid", constraint: "telephony_settings_hours_check" } }],
    [{ status: "failed", http: 403, code: "forbidden" }, 403, { error: { code: "forbidden" } }],
    [{ status: "failed", http: 503, code: "unavailable" }, 503, { error: { code: "unavailable" } }],
  ];
  for (const [result, status, body] of failures) {
    const probe = handlers({ save: async () => result, map: async () => result });
    for (const [pick, path, payload] of [["save", "/api/v3/telephony/settings", SETTINGS_BODY], ["map", "/api/v3/telephony/extensions", MAP_BODY]]) {
      const response = await probe[pick](post(path, payload));
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }
  }
  const throwing = handlers({ save: async () => { throw new Error("rpc exploded with +996555000111"); }, map: async () => { throw new Error("x"); } });
  const response = await throwing.save(post("/api/v3/telephony/settings", SETTINGS_BODY));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /996555/u);
});

/* -------------------------------------------------- доступ и маршруты */

test("the settings page opens for the Admin and for a telephony.manage holder, for nobody else", () => {
  const staff = (...permissionKeys) => ({ systemRole: "staff", presentationRole: null, permissionKeys, platformAccessVersion: 1 });
  assert.equal(staffCanAccessRoute(ADMIN, "/v3/settings"), true);
  assert.equal(staffCanAccessRoute(staff("telephony.manage"), "/v3/settings"), true);
  for (const keys of [[], ["telephony.call.dial"], ["telephony.recording.listen.all", "telephony.report.read.all"], ["lead.read", "case.read.full", "ai.agent.use"]]) {
    assert.equal(staffCanAccessRoute(staff(...keys), "/v3/settings"), false, keys.join());
  }
  // Role preview never inherits the right: the previewed role decides.
  for (const role of ["sales", "admissions"]) {
    assert.equal(staffCanAccessRoute({ ...ADMIN, presentationRole: role }, "/v3/settings"), false, role);
  }
  // The right opens nothing else.
  for (const route of ["/v3/knowledge", "/v3/marketing", "/v3/main", "/v3/requests", "/v3/profile"]) {
    assert.equal(staffCanAccessRoute(staff("telephony.manage"), route), false, route);
  }
});

test("navigation shows «Настройки» to the holder and to nobody without the right", () => {
  const nav = (permissionKeys, systemRole = "staff") => buildV3Navigation({ systemRole, presentationRole: null, permissionKeys, platformAccessVersion: 1 }, "/v3/settings", new URLSearchParams());
  assert.equal(nav(["telephony.manage"]).settings?.href, "/v3/settings");
  assert.equal(nav(["telephony.call.dial"]).settings, null);
  assert.equal(nav([], "admin").settings?.href, "/v3/settings");
  assert.deepEqual([nav(["telephony.manage"]).home, ...nav(["telephony.manage"]).groups, ...nav(["telephony.manage"]).common].filter(Boolean), []);
});

test("the two commands are exact connected staff APIs; everything near them stays closed", () => {
  for (const path of ["/api/v3/telephony/settings", "/api/v3/telephony/extensions"]) {
    assert.equal(isConnectedPlatformApi(path), true, path);
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
    assert.equal(isConnectedPlatformPage(path), false, path);
    assert.equal(isRetiredPlatformRoute(path), false, path);
  }
  // The recordings stream (GET /api/v3/telephony/recordings/<leg>) is connected by slice T6 and checked strictly in
  // tests/platform-telephony-recordings.test.mjs; only its bare prefix stays in this list. The dial route
  // (POST /api/v3/telephony/dial) is connected by slice T7 and checked in tests/platform-telephony-dial.test.mjs.
  const near = ["/api/v3/telephony", "/api/v3/telephony/", "/api/v3/telephony/settings/", "/api/v3/telephony/settings/x", "/api/v3/telephony/settings.json",
    "/api/v3/telephony/Settings", "/API/v3/telephony/settings", "/api/v3/telephony/extension", "/api/v3/telephony/extensions/", "/api/v3/telephony/extensions/x",
    "/api/v3/telephony/dial/", "/api/v3/telephony/dial/x", "/api/v3/telephony/pulse", "/api/v3/telephony/recordings", "/api/v2/telephony/settings", "/api/internal/telephony/settings",
    "/api/v3/telephony/settings%2f", "/api/v3/telephony//settings"];
  for (const path of near) assert.equal(isConnectedPlatformApi(path), false, path);
});

async function loadBundledProxy() {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL("../src/proxy.ts", import.meta.url))],
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports.proxy;
}

test("the real proxy sends the two commands through the staff session gate and refuses their near misses", async () => {
  const proxy = await loadBundledProxy();
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:45421";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_routing-boundary-only";
  const request = (path, method = "POST") => new NextRequest(`https://crm.evoadmissions.com${path}`, { method, headers: { host: "crm.evoadmissions.com" } });
  try {
    for (const path of ["/api/v3/telephony/settings", "/api/v3/telephony/extensions"]) {
      for (const method of ["POST", "GET"]) {
        const response = await proxy(request(path, method));
        // Connected: an anonymous caller reaches the live session gate (401), not the 403 refusal.
        assert.equal(response.status, 401, `${method} ${path}`);
        assert.equal(response.headers.get("x-middleware-next"), null, `${method} ${path}`);
        assert.deepEqual(await response.json(), { error: "authentication_required" }, `${method} ${path}`);
      }
    }
    for (const path of ["/api/v3/telephony/settings/x", "/api/v3/telephony/dial/x", "/api/v3/telephony"]) {
      const response = await proxy(request(path));
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error, "platform_route_not_connected", path);
    }
  } finally {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key;
  }
});
