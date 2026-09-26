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
import { databaseFact, settingsHealth } from "../src/lib/v3/settings-health.ts";

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
const PRODUCTION_26_09 = Object.freeze({
  waha: { display: "not_configured", sessionStatus: undefined, observed: "Время проверки неизвестно." },
  gemini: "not_configured",
  amo: { status: "blocked", reason: "configuration_missing" },
  database: { checked: false, status: "unavailable", observed: OBSERVED },
});
const byName = (rows) => Object.fromEntries(rows.map((row) => [row.name, row]));

test("settings: an unchecked database and unconfigured providers are facts, not attention", () => {
  const rows = byName(settingsHealth(PRODUCTION_26_09));
  const database = rows["База данных"];
  assert.equal(database.state, "не проверялось");
  assert.equal(database.blocker, null);
  assert.equal(database.tone, "off");
  assert.doesNotMatch(database.detail, /Данные на/u, "no check ran: no observation time is claimed");
  for (const name of ["Gemini · черновики ответов", "amoCRM"]) {
    assert.equal(rows[name].state, "не используется", name);
    assert.equal(rows[name].blocker, null, name);
    assert.equal(rows[name].tone, "off", name);
  }
  assert.equal(rows.WhatsApp.state, "не подключён");
  assert.equal(rows.WhatsApp.blocker, "Нужно подключить WhatsApp к CRM.");
  // Production 26.09 showed «Требует внимания 4»; only WhatsApp is real work.
  assert.deepEqual(settingsHealth(PRODUCTION_26_09).filter((row) => row.blocker !== null).map((row) => row.name), ["WhatsApp"]);
  assert.equal(databaseFact(PRODUCTION_26_09.database), "не проверялось");
});

test("settings: configured-but-broken or unverified still counts, with the reason", () => {
  const rows = byName(settingsHealth({
    waha: { display: "blocked", sessionStatus: "FAILED", observed: OBSERVED },
    gemini: "blocked",
    amo: { status: "blocked", reason: "token_unavailable" },
    database: { checked: true, status: "unavailable", observed: OBSERVED },
  }));
  assert.equal(rows.WhatsApp.state, "заблокирована");
  assert.equal(rows.WhatsApp.blocker, "Нужна актуальная проверка подключения.");
  assert.equal(rows["Gemini · черновики ответов"].state, "заблокирован");
  assert.equal(rows["Gemini · черновики ответов"].blocker, "Нужно проверить настройки подключения.");
  assert.equal(rows.amoCRM.state, "заблокирована");
  assert.equal(rows.amoCRM.blocker, "Нужно проверить настройки синхронизации.");
  assert.equal(rows["База данных"].state, "состояние недоступно");
  assert.equal(rows["База данных"].blocker, "Проверка подключения к базе данных не прошла.");
  assert.equal(rows["База данных"].detail, OBSERVED);

  const ready = byName(settingsHealth({
    waha: { display: "ready", sessionStatus: "WORKING", observed: OBSERVED },
    gemini: "configured_not_verified",
    amo: { status: "ready" },
    database: { checked: true, status: "ready", observed: OBSERVED },
  }));
  assert.equal(ready.WhatsApp.blocker, null);
  assert.equal(ready["База данных"].state, "доступна");
  assert.equal(ready["База данных"].blocker, null);
  assert.equal(ready["Gemini · черновики ответов"].blocker, "Нужна проверка работы сервиса.");
  assert.equal(ready.amoCRM.blocker, "Нужна проверка синхронизации.");
  assert.equal(databaseFact({ checked: true, status: "ready", observed: OBSERVED }), `доступна · ${OBSERVED}`);
  // A disabled feature is «не используется» too.
  const disabled = byName(settingsHealth({ ...PRODUCTION_26_09, amo: { status: "blocked", reason: "feature_disabled" } }));
  assert.equal(disabled.amoCRM.blocker, null);
});

test("settings: «Требует внимания» has no alarm badge when nothing needs attention", () => {
  const { StateSection } = compile("src/components/v3/settings/sections.tsx", (id) => {
    if (id === "next/link") return { default: () => null };
    if (id === "@/components/icons") return { Icon: () => null };
    if (id === "@/components/ui") return { btnGhostCls: "" };
    if (id === "@/components/v3/Pill") return { Pill: function Pill() { return null; } };
    if (id === "@/lib/v3/look-preview-actions") return { setLookPreviewAction: () => null };
    if (id === "@/lib/v3/wording") return { journalActor: String, journalEvent: String, journalObject: String };
    return undefined;
  });
  const quiet = settingsHealth({ ...PRODUCTION_26_09, waha: { display: "ready", sessionStatus: "WORKING", observed: OBSERVED } });
  const tree = StateSection({ health: quiet });
  const attention = findElements(tree, (node) => node.props?.title === "Требует внимания");
  assert.equal(attention.length, 1);
  assert.equal(attention[0].props.aside, undefined, "no «0» warn pill");
  assert.match(textOf(attention[0]), /Ничего не требует внимания\./u);

  const alarmed = findElements(StateSection({ health: settingsHealth(PRODUCTION_26_09) }),
    (node) => node.props?.title === "Требует внимания")[0];
  assert.equal(alarmed.props.aside.props.tone, "warn");
  assert.equal(alarmed.props.aside.props.children, 1);
});

test("settings source tells an unchecked database from a failed check by the switch itself", () => {
  const settings = source("src/lib/v3/settings-source.ts");
  assert.match(settings, /checked: isPlatformP7BObservabilityEnabled\(\),/u);
  assert.match(settings, /return settingsHealth\(healthFacts\(facts, readiness\)\);/u);
  assert.doesNotMatch(settings, /Нужна актуальная проверка подключения к базе данных/u);
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
  assert.match(pipeline, /<Link href=\{withPipelineReturn\(lead\.href, returnTo\)\}[^>]*>\s*Открыть карточку лида/u);
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
