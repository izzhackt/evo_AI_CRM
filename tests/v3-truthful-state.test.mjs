import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

import { calendarUndatedOpenCount } from "../src/components/v3/calendar/types.ts";
import { caseMessageNotificationCopy } from "../src/components/v3/staff-notification-copy.ts";
import { isBoardRoute, isFillRoute } from "../src/lib/v3/board-layout.ts";
import {
  parsePipelineReturnTo,
  pipelineReturnHref,
  withPipelineReturn,
} from "../src/lib/v3/pipeline-return.ts";
import { databaseFact, formatSettingsCheck, settingsBlockingIntegrations, settingsIntegrations } from "../src/lib/v3/settings-health.ts";

/**
 * Трек A2 «честное состояние» (аудит production 26.09 только чтением): экран
 * считает то, что показывает, а «не проверялось», «не используется» и «не
 * подключён» — факты, а не тревога и не выдуманное число. Чистая логика
 * проверяется напрямую, компоненты — их деревом элементов без браузера и
 * без живого backend.
 */

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function compile(path, boundary) {
  const code = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)((id) => boundary(id) ?? require(id), compiled, compiled.exports);
  return compiled.exports;
}

function findElements(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found);
    return found;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return found;
  if (predicate(node)) found.push(node);
  findElements(node.props.children, predicate, found);
  return found;
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

/* ------------------------------------------------------------ Настройки */

const OBSERVED = "Данные на 26.09.2026, 12:00 (Бишкек).";
const NOW = new Date("2026-09-27T04:00:00.000Z");
// Production 26–27.09: вебхук WAHA снят, Gemini и amoCRM не настраивали.
const PRODUCTION_26_09 = Object.freeze({
  waha: { display: "not_configured", sessionStatus: undefined, observedAt: null },
  gemini: "not_configured",
  amo: { status: "blocked", reason: "configuration_missing" },
});
const byKey = (rows) => Object.fromEntries(rows.map((row) => [row.key, row]));

// Э6 (27.09.2026): one «Интеграции» table instead of the «Состояние» cards,
// the «Требует внимания» list and the «Интеграции» cards; one warning on top —
// only when a configured provider is broken and work stops.
test("settings: unconfigured providers, an unchecked check and a deliberately unconnected WhatsApp are facts, not a warning", () => {
  const rows = byKey(settingsIntegrations(PRODUCTION_26_09, NOW));
  assert.deepEqual(Object.keys(rows), ["whatsapp", "amocrm", "gemini"], "one row per provider, WhatsApp first");
  assert.equal(rows.whatsapp.state, "не подключён");
  assert.equal(rows.whatsapp.tone, "off");
  assert.equal(rows.whatsapp.checkedText, null, "no session read: no check time is claimed");
  assert.equal(rows.whatsapp.checkable, true, "WhatsApp has a check — «нет данных», not «—»");
  assert.match(rows.whatsapp.without, /не приходят в CRM/u);
  // Review #1079: who connects it, and the WhatsApp page that says the same.
  assert.deepEqual(rows.whatsapp.action, {
    handoff: "Подключает технический специалист на сервере: вебхук и вход по QR",
    link: { label: "Открыть WhatsApp", href: "/v3/inbox" },
  });
  for (const key of ["gemini", "amocrm"]) {
    assert.equal(rows[key].state, "не используется", key);
    assert.equal(rows[key].tone, "off", key);
    assert.equal(rows[key].checkable, false, key);
    assert.equal(rows[key].action, null, key);
  }
  // Production 26.09 showed «Требует внимания 4»; nothing here stops work.
  assert.deepEqual(settingsBlockingIntegrations(settingsIntegrations(PRODUCTION_26_09, NOW)), []);
  assert.equal(databaseFact({ checked: false, status: "unavailable", observed: OBSERVED }), "не проверялось");
  assert.equal(databaseFact({ checked: true, status: "ready", observed: OBSERVED }), `доступна · ${OBSERVED}`);
  // A disabled feature is «не используется» too.
  assert.equal(byKey(settingsIntegrations({ ...PRODUCTION_26_09, amo: { status: "blocked", reason: "feature_disabled" } }, NOW)).amocrm.blocksWork, false);
});

test("settings: a configured but broken provider is the one warning, with its reason; unverified is not", () => {
  const rows = byKey(settingsIntegrations({
    waha: { display: "blocked", sessionStatus: "SCAN_QR_CODE", observedAt: "2026-09-26T08:15:00.000Z" },
    gemini: "blocked",
    amo: { status: "blocked", reason: "token_unavailable" },
  }, NOW));
  assert.equal(rows.whatsapp.state, "заблокирован");
  assert.equal(rows.whatsapp.detail, "Требуется подключение WhatsApp по QR-коду.");
  assert.equal(rows.whatsapp.checkedText, "26.09 14:15", "Bishkek time, no year in the current year");
  assert.equal(rows.gemini.state, "заблокирован");
  assert.equal(rows.gemini.detail, "Параметры подключения некорректны.");
  assert.equal(rows.amocrm.state, "заблокирована");
  assert.equal(rows.amocrm.detail, "Доступ к аккаунту amoCRM не подтверждён.");
  assert.deepEqual(settingsBlockingIntegrations(Object.values(rows)).map((row) => row.key), ["whatsapp", "amocrm", "gemini"]);
  // Every server-side step names who does it; none is left as bare «… на сервере».
  assert.deepEqual(rows.whatsapp.action, {
    handoff: "Передать техническому специалисту: проверить подключение на сервере",
    link: { label: "Открыть WhatsApp", href: "/v3/inbox" },
  });
  for (const key of ["amocrm", "gemini"]) {
    assert.deepEqual(rows[key].action, { handoff: "Передать техническому специалисту: исправить параметры на сервере", link: null }, key);
  }

  const unverified = byKey(settingsIntegrations({
    waha: { display: "ready", sessionStatus: "WORKING", observedAt: "2026-09-27T03:59:00.000Z" },
    gemini: "configured_not_verified",
    amo: { status: "ready" },
  }, NOW));
  assert.equal(unverified.whatsapp.state, "подключён");
  assert.deepEqual(unverified.whatsapp.action, { handoff: null, link: { label: "Открыть WhatsApp", href: "/v3/inbox" } });
  assert.equal(unverified.gemini.action.handoff, "Передать техническому специалисту: проверить работу сервиса на сервере");
  assert.equal(unverified.amocrm.action.handoff, "Передать техническому специалисту: проверить синхронизацию на сервере");
  for (const row of [...Object.values(rows), ...Object.values(unverified)]) {
    if (row.action) assert.ok(row.action.link || /технический специалист|техническому специалисту/u.test(row.action.handoff), `${row.key}: a path or an owner`);
  }
  assert.equal(unverified.whatsapp.without, null);
  assert.equal(unverified.gemini.state, "настроен, не проверен");
  assert.equal(unverified.amocrm.state, "настроена, не проверена");
  assert.deepEqual(settingsBlockingIntegrations(Object.values(unverified)), [], "unverified is not blocked");
  assert.equal(formatSettingsCheck("2025-12-31T10:00:00.000Z", NOW), "31.12.25 16:00", "another year is named");
  assert.equal(formatSettingsCheck("not a date", NOW), null);
});

test("settings: the warning above the sections exists only when work stops, and the table has no side stripes", () => {
  const { IntegrationsBanner, IntegrationsSection } = compile("src/components/v3/settings/sections.tsx", (id) => {
    if (id === "next/link") return { default: function Link() { return null; } };
    if (id === "@/components/icons") return { Icon: () => null };
    if (id === "@/components/ui") return { btnGhostCls: "" };
    if (id === "@/components/v3/Pill") return { Pill: function Pill() { return null; } };
    if (id === "@/lib/v3/look-preview-actions") return { setLookPreviewAction: () => null };
    if (id === "@/lib/v3/wording") return { journalActor: String, journalEvent: String, journalObject: String };
    return undefined;
  });
  assert.equal(IntegrationsBanner({ rows: settingsIntegrations(PRODUCTION_26_09, NOW), href: "/v3/settings?section=integrations" }), null);
  const blocked = settingsIntegrations({ ...PRODUCTION_26_09, amo: { status: "blocked", reason: "configuration_invalid" } }, NOW);
  const banner = IntegrationsBanner({ rows: blocked, href: "/v3/settings?section=integrations" });
  assert.match(textOf(banner), /Не работает: amoCRM — параметры подключения некорректны\./u);
  assert.equal(findElements(banner, (node) => node.type?.name === "Link")[0].props.href, "/v3/settings?section=integrations");
  const table = IntegrationsSection({ rows: blocked });
  const rows = findElements(table, (node) => node.props?.["data-integration"]);
  assert.deepEqual(rows.map((row) => row.props["data-integration"]), ["whatsapp", "amocrm", "gemini"]);
  // «Что сделать» never ends at bare «… на сервере»: the owner, and for WhatsApp its page.
  const whatsappCell = findElements(rows[0], (node) => node.type === "td").at(-1);
  assert.match(textOf(whatsappCell), /Подключает технический специалист на сервере: вебхук и вход по QR/u);
  assert.equal(findElements(whatsappCell, (node) => node.type?.name === "Link")[0].props.href, "/v3/inbox");
  assert.match(textOf(findElements(rows[1], (node) => node.type === "td").at(-1)), /Передать техническому специалисту: исправить параметры на сервере/u);
  const settings = source("src/components/v3/settings/sections.tsx");
  assert.doesNotMatch(settings, /v3-edge-|border-s-2|Требует внимания/u, "no side-stripe cards, no second attention list");
  assert.doesNotMatch(source("src/components/v3/settings/Settings.tsx"), /виден только администратору|>\s*админ\s*</u);
});

test("settings source reads the integrations once and tells an unchecked database from a failed check by the switch", () => {
  const settings = source("src/lib/v3/settings-source.ts");
  assert.match(settings, /checked: isPlatformP7BObservabilityEnabled\(\),/u);
  assert.match(settings, /return settingsIntegrations\(\{/u);
  assert.doesNotMatch(settings, /readHealth|settingsHealth/u);
  const page = source("src/app/(v3)/v3/settings/page.tsx");
  assert.match(page, /if \(params\.section === "state"\) redirect\("\/v3\/settings\?section=integrations"\);/u);
  assert.match(page, /const section = isSectionKey\(params\.section\) \? params\.section : "staff";/u, "settings open on «Сотрудники»");
});

/* ------------------------------------------------------------ WhatsApp */

function inboxModule() {
  return compile("src/components/v3/Inbox.tsx", (id) => {
    if (id === "next/link") return { default: function Link() { return null; } };
    if (id === "@/components/icons") return { Icon: () => null };
    if (id === "@/components/ui") return { btnGhostCls: "" };
    if (id === "@/components/v3/inbox/InboxMessageMedia") return { InboxMessageMedia: () => null };
    if (id === "@/components/v3/Pill") return { Pill: () => null };
    return undefined;
  });
}

const EMPTY_VIEW = Object.freeze({
  conversations: [], selected: null, queueCurrentHref: "/v3/inbox", queueNewestHref: null, queueOlderHref: null,
  searchQuery: null, waitingOnly: false, waitingToggleHref: "/v3/inbox?waiting=1",
  channelState: "not_connected", channelObservedAt: null,
});

test("WhatsApp not connected: one honest state instead of «не подтверждено» and an empty list", () => {
  const { Inbox, inboxNotConnected } = inboxModule();
  const admin = Inbox({ view: EMPTY_VIEW, profileHref: null, settingsHref: "/v3/settings?section=integrations" });
  assert.equal(admin.props["data-testid"], "v3-inbox-not-connected");
  assert.match(textOf(admin), /^WhatsApp не подключён к CRM — подключает Администратор/u);
  assert.doesNotMatch(textOf(admin), /не подтверждено|Пока нет доступных диалогов|Найти/u);
  const [settings] = findElements(admin, (node) => node.type?.name === "Link");
  assert.equal(settings.props.href, "/v3/settings?section=integrations");
  assert.equal(textOf(settings), "Открыть настройки");
  assert.doesNotMatch(settings.props.className, /bg-accent/u, "a quiet link, not a second red action");

  // Everyone else gets the same fact without a link they cannot use.
  const staff = Inbox({ view: EMPTY_VIEW, profileHref: null, settingsHref: null });
  assert.equal(findElements(staff, (node) => node.type?.name === "Link").length, 0);

  // Filters, older pages, existing conversations or another state keep the list.
  assert.equal(inboxNotConnected(EMPTY_VIEW), true);
  for (const view of [
    { ...EMPTY_VIEW, searchQuery: "Имя" },
    { ...EMPTY_VIEW, waitingOnly: true },
    { ...EMPTY_VIEW, queueNewestHref: "/v3/inbox" },
    { ...EMPTY_VIEW, channelState: "unknown" },
    { ...EMPTY_VIEW, channelState: "unavailable" },
    { ...EMPTY_VIEW, conversations: [{ id: "c", person: "Абитуриент", href: "/v3/inbox?conversation=c" }] },
  ]) {
    assert.equal(inboxNotConnected(view), false, JSON.stringify(view));
    assert.equal(Inbox({ view, profileHref: null, settingsHref: null }).props["data-testid"], "v3-inbox");
  }
});

test("WhatsApp page: settings link only for Admin outside role preview, no count when there is nothing to count", () => {
  const page = source("src/app/(v3)/v3/inbox/page.tsx");
  assert.match(page, /const settingsHref = actor\.systemRole === "admin" && actor\.presentationRole === null\s*\? "\/v3\/settings\?section=integrations"\s*: null;/u);
  assert.match(page, /count=\{notConnected \? null : view\.conversations\.length\}/u);
  const adapter = source("src/lib/v3/inbox-source.ts");
  // No session row is «not connected»; a failed read stays «unavailable».
  assert.match(adapter, /health === null\s*\? "not_connected"/u);
  assert.match(adapter, /return Object\.freeze\(\{ channelState: "unavailable", channelObservedAt: null \}\);/u);
});

test("WhatsApp fills the window under the top bar instead of 100dvh below it", () => {
  assert.equal(isFillRoute("/v3/inbox"), true);
  assert.equal(isBoardRoute("/v3/inbox"), false, "no icon rail on WhatsApp");
  for (const board of ["/v3/pipeline", "/v3/admissions-pipeline"]) assert.equal(isFillRoute(board), true);
  for (const other of ["/v3/profile", "/v3/inbox/x", null]) assert.equal(isFillRoute(other), false);
  const shell = source("src/components/v3/PartShell.tsx");
  assert.doesNotMatch(shell, /h-dvh/u);
  assert.match(shell, /fill \? "flex flex-col py-6 md:min-h-0 md:flex-1"/u);
  const app = source("src/components/v3/AppShell.tsx");
  assert.match(app, /fill && "md:flex md:h-dvh md:flex-col"/u);
  assert.match(app, /fill && "md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto"/u);
  assert.match(app, /rail=\{board\}/u);
});

/* ----------------------------------------------------------- Календарь */

test("calendar «Без срока»: only open tasks, a lower bound with more pages, no number on a continuation", () => {
  const tasks = [
    { day: null, state: "open" }, { day: null, state: "in_progress" }, { day: null, state: "blocked" },
    { day: null, state: "done" }, { day: null, state: "cancelled" }, { day: "2026-09-26", state: "open" },
  ];
  assert.equal(calendarUndatedOpenCount(tasks, false, false), "3");
  // Audit 26.09: one undated task marked «выполнена» read «Без срока — 1».
  assert.equal(calendarUndatedOpenCount([{ day: null, state: "done" }], false, false), "0");
  assert.equal(calendarUndatedOpenCount(tasks, false, true), "3+");
  assert.equal(calendarUndatedOpenCount([{ day: null, state: "done" }], false, true), null);
  assert.equal(calendarUndatedOpenCount(tasks, true, false), null);
  const calendar = source("src/components/v3/calendar/Calendar.tsx");
  assert.match(calendar, /calendarUndatedOpenCount\(unscheduled, undatedContinuationPage, undatedNextHref !== null\)/u);
  assert.match(calendar, /undatedOpen === null \? "Без срока" : `Без срока — \$\{undatedOpen\}`/u);
  assert.doesNotMatch(calendar, /undatedCount/u, "the read's total counts closed tasks too");
});

/* ------------------------------------------------------------ Lead 360 */

const LEAD = "aaaaaaaa-1111-4111-8111-000000000005";
const OWNER = "bbbbbbbb-2222-4222-8222-000000000002";

test("lead card from the board panel returns to the same board state", () => {
  const board = pipelineReturnHref(new URLSearchParams(`q=Тимур&due=unscheduled&owner=${OWNER}&handed=all&lead=${LEAD}&evil=1&due=today`));
  assert.equal(board, `/v3/pipeline?q=${encodeURIComponent("Тимур").replace(/%20/gu, "+")}&due=unscheduled&owner=${OWNER}&handed=all&lead=${LEAD}`);
  assert.equal(pipelineReturnHref(null), "/v3/pipeline");
  assert.equal(parsePipelineReturnTo(board), board);
  assert.equal(parsePipelineReturnTo("/v3/pipeline"), "/v3/pipeline");
  assert.equal(parsePipelineReturnTo("/v3/pipeline?stage=handed_off"), "/v3/pipeline?stage=handed_off");
  for (const bad of [
    "/v3/pipeline?evil=1", "/v3/pipeline?due=later", "/v3/pipeline?stage=nope", "/v3/pipeline?lead=x",
    "/v3/pipeline?due=today&due=overdue", "/v3/pipeline?owner=", "/v3/pipeline#x", "/v3/pipelines",
    "/v3/profile?id=1", "https://evil.example/v3/pipeline", "//evil.example/v3/pipeline", `/v3/pipeline?q=${"я".repeat(201)}`, 42, null,
  ]) {
    assert.equal(parsePipelineReturnTo(bad), null, String(bad));
  }
  assert.equal(withPipelineReturn(`/v3/profile?id=${LEAD}`, board), `/v3/profile?id=${LEAD}&returnTo=${encodeURIComponent(board)}`);

  const pipeline = source("src/components/v3/Pipeline.tsx");
  // Э7: «Открыть карточку лида» — ссылка шапки общей боковой панели (`SidePanel`).
  assert.match(pipeline, /open=\{\{ href: withPipelineReturn\(lead\.href, returnTo\), label: "Открыть карточку лида", prefetch: false \}\}/u);
  assert.match(pipeline, /returnTo=\{pipelineReturnHref\(search\)\}/u);
  const profile = source("src/app/(v3)/v3/profile/page.tsx");
  assert.match(profile, /const pipelineReturnTo = requestsReturnTo \|\| studentsReturnTo \? null : parsePipelineReturnTo\(singleSearchParam\(params\.returnTo\)\);/u);
  assert.match(profile, /const listReturnTo = requestsReturnTo \?\? studentsReturnTo \?\? pipelineReturnTo;/u);
  // A lead opened without a return address goes back to the board it lives on.
  assert.match(profile, /listReturnTo === null && leadParam && !hasCaseParam && !docsMode && staffCanAccessRoute\(actor, PIPELINE_PATH\)/u);
  assert.match(profile, /\{requestsReturnTo \? "К списку заявок" : pipelineBackHref \? "К воронке продаж" : docsMode \? "К списку EVO Docs" : "К списку студентов"\}/u);
  assert.match(profile, /href=\{requestsReturnTo \?\? pipelineBackHref \?\? directoryHref\}/u);
  // The English «Sales» card title is gone.
  const tabs = source("src/components/v3/profile/tabs.tsx");
  assert.doesNotMatch(tabs, /title="Sales"/u);
  assert.match(tabs, /title="Продажи"/u);
});

/* ------------------------------------------------ Уведомления и подписи */

test("a case message notification does not repeat the author as the case", () => {
  assert.equal(caseMessageNotificationCopy("Абитуриент Тестов", "Абитуриент Тестов"), "Абитуриент Тестов написал(а) в переписке");
  assert.equal(caseMessageNotificationCopy("Абитуриент Тестов ", "абитуриент тестов"), "Абитуриент Тестов написал(а) в переписке");
  assert.equal(caseMessageNotificationCopy("  ", "Абитуриент Тестов"), "Новое сообщение в переписке по делу");
  assert.equal(caseMessageNotificationCopy("Куратор Первый", "Абитуриент Тестов"), "Куратор Первый написал(а) в переписке · Абитуриент Тестов");
  assert.equal(caseMessageNotificationCopy(null, "Абитуриент Тестов"), "Новое сообщение в переписке по делу");
  assert.equal(caseMessageNotificationCopy("Куратор Первый", null), "Новое сообщение в переписке по делу");
  assert.match(source("src/components/v3/StaffNotifications.tsx"), /return caseMessageNotificationCopy\(item\.actorDisplayName, item\.studentDisplayName\);/u);
});

test("placeholders say what is missing: an unconfirmed deadline, an unknown country", () => {
  const catalogue = source("src/components/v3/universities/UniversityCatalogue.tsx");
  assert.match(catalogue, />Срок не подтверждён<\/p>/u);
  assert.doesNotMatch(catalogue, /Сроки подачи — в карточке/u);
  for (const file of ["src/components/v3/students/StudentsQueueTable.tsx", "src/components/v3/students/StudentsDirectoryFallback.tsx"]) {
    const text = source(file);
    assert.match(text, /row\.targetCountry \?\? "Страна не указана"/u, file);
    assert.doesNotMatch(text, /"не указано"/u, file);
  }
});
