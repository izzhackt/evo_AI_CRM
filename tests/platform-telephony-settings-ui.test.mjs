import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as telephonyHealth from "../src/lib/v3/telephony-health.ts";
import * as telephonySettings from "../src/lib/v3/telephony-settings.ts";

/**
 * «Настройки → Телефония» (срез T4b), экран: разметка раздела, таблицы
 * сопоставления и формы настроек рисуется настоящими компонентами на сервере
 * (без браузера и без базы), а правила страницы и маршрутов проверяются по
 * исходникам. Поведение в браузере (нажатия, запись) не проверяется: здесь
 * только то, что видит человек в готовой разметке, и контракт вокруг неё.
 */

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const refreshes = [];
function compile(path, extra = {}) {
  const code = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiled = { exports: {} };
  const boundary = {
    "next/navigation": { useRouter: () => ({ refresh: () => refreshes.push(1) }) },
    "@/components/icons": { Icon: ({ name }) => React.createElement("i", { "data-icon": name }) },
    "@/components/ui": { btnCls: "btn-primary" },
    "@/components/v3/blocks/StatusChip": { StatusChip: ({ label, tone }) => React.createElement("span", { "data-chip": tone }, label) },
    "@/components/v3/queue/queue-buttons": { QUEUE_CONFIRM: "queue-confirm", QUEUE_SECONDARY: "queue-secondary" },
    "@/lib/v3/telephony-settings": telephonySettings,
    "@/lib/v3/telephony-health": telephonyHealth,
    ...extra,
  };
  new Function("require", "module", "exports", code)((id) => boundary[id] ?? require(id), compiled, compiled.exports);
  return compiled.exports;
}
const render = (element) => renderToStaticMarkup(element);

const ORG = "10000000-0000-4000-8000-000000000001";
const A = "20000000-0000-4000-8000-000000000002";
const B = "20000000-0000-4000-8000-000000000003";
const C = "20000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-10-17T10:00:00.000Z");
const KEY_PROBE = "a1b2c3d4-e5f6-4a8b-9c0d-1234567890ab";

function overview({ flags = {}, escalation = null, escalationMembershipId = null, extensions, health = {}, version = 3 } = {}) {
  return telephonySettings.normalizeTelephonyOverview({
    schemaVersion: 1,
    organizationId: ORG,
    now: "2026-10-17T10:00:00.000Z",
    settings: {
      version, updatedAt: null,
      flags: { projectionEnabled: false, uiEnabled: false, dialEnabled: false, missedTaskEnabled: false, unknownLeadEnabled: false, backfillEnabled: false, outboundPaused: false, ...flags },
      hours: { timezone: "Asia/Bishkek", workingDays: [1, 2, 3, 4, 5, 6], workFrom: "10:00", workTo: "20:00", callbackWorkMinutes: 15 },
      escalationMembershipId,
      dial: { prefixes: ["+996"], limitUserDay: 150, limitUserGapSeconds: 5, limitOrgHour: 60, limitOrgDay: 400 },
      ceilings: { leadsHour: 10, leadsDay: 40, tasksHour: 30, tasksDay: 120 },
    },
    escalation,
    health: {
      status: "ok", now: "2026-10-17T10:00:00.000Z", flags: { projection_enabled: false, outbound_paused: false, backfill_enabled: false },
      directory: { active: 3, inactive: 1, unmapped: 2, last_seen_at: null },
      schedule: {
        retry_run_at: null, settle_run_at: null, users_sync_run_at: null, users_sync_success_at: null, reconcile_run_at: null,
        reconcile_success_at: null, reconcile_cursor_at: null, reconcile_lag_seconds: null, reconcile_daily_run_at: null,
        reconcile_daily_success_at: null, backfill_run_at: null, backfill_cursor_at: null, backfill_done_at: null, probe_run_at: null, probe_success_at: null,
      },
      pbx: { last_ok_at: null, last_error_at: null, last_error_code: null, facts: null },
      last_event_at: null, internal_calls_total: 0,
      evidence: { window_hours: 24, received: 0, rejected: 0, incomplete: 0 },
      automation_stop: { stopped_at: null, code: null }, summaries: {},
      divergence: { window_hours: 24, reconciled_calls: 0, calls: 0 }, work: {},
      ...health,
    },
    extensions: extensions ?? [
      { id: "50000000-0000-4000-8000-000000000001", login: "u901", extension: "901", name: "PBX user 1", active: true, membershipId: A, membershipName: "Staff A", lastSeenAt: null, legsWithoutStaff: 0 },
      { id: "50000000-0000-4000-8000-000000000002", login: "u902", extension: "902", name: "PBX user 2", active: true, membershipId: null, membershipName: null, lastSeenAt: null, legsWithoutStaff: 3 },
      { id: "50000000-0000-4000-8000-000000000003", login: "u903", extension: null, name: null, active: false, membershipId: null, membershipName: null, lastSeenAt: null, legsWithoutStaff: 0 },
    ],
    staff: [
      { membershipId: A, name: "Staff A", canManage: true },
      { membershipId: B, name: "Staff B", canManage: false },
      { membershipId: C, name: "Staff C", canManage: true },
    ],
  });
}
const SERVER_ON = { ingestEnabled: true, crmKey: "configured", crmKeyRotating: false, pbx: "ready" };
const SERVER_OFF = { ingestEnabled: false, crmKey: "missing", crmKeyRotating: false, pbx: "not_configured" };
const INBOUND = "https://crm.evoadmissions.com/api/v2/telephony/beeline/inbound";
const flat = (markup) => markup.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");

/* ------------------------------------------------------------- раздел */

function sectionModule() {
  return compile("src/components/v3/settings/TelephonySection.tsx", {
    "./TelephonyCopyValue": { TelephonyCopyValue: ({ value }) => React.createElement("code", { "data-copy": true }, value) },
    "./TelephonyExtensions": { TelephonyExtensions: ({ extensions, readOnly }) => React.createElement("div", { "data-extensions": extensions.length, "data-readonly": String(readOnly) }) },
    "./TelephonySettingsForm": { TelephonySettingsForm: ({ overview: o, readOnly }) => React.createElement("div", { "data-form-version": o.settings.version, "data-readonly": String(readOnly) }) },
  });
}

test("the section says plainly when it cannot be shown: no right, no data", () => {
  const { TelephonySection } = sectionModule();
  for (const read of [null, { status: "forbidden" }]) {
    const text = flat(render(React.createElement(TelephonySection, { read, readOnly: false, now: NOW })));
    assert.match(text, /Нет права открывать настройки телефонии/u);
  }
  const text = flat(render(React.createElement(TelephonySection, { read: { status: "unavailable", server: SERVER_ON }, readOnly: false, now: NOW })));
  assert.match(text, /Не удалось прочитать настройки телефонии/u);
  assert.doesNotMatch(text, /Состояние|Подключение «Ваша CRM»/u);
});

test("switched off: the section says «Выключено» and shows the four blocks with their facts", () => {
  const { TelephonySection } = sectionModule();
  const markup = render(React.createElement(TelephonySection, {
    read: { status: "ready", overview: overview(), server: SERVER_OFF, inboundUrl: INBOUND }, readOnly: false, now: NOW,
  }));
  assert.match(markup, /data-testid="v3-settings-telephony"[^>]*data-switched-off="true"/u);
  assert.match(markup, /data-testid="v3-telephony-off"/u);
  assert.match(flat(markup), /Выключено: ни один включатель не включён, сотрудникам телефония ничего не показывает/u);
  const lineIds = [...markup.matchAll(/data-line="([a-z_]+)"/gu)].map((match) => match[1]);
  // The line that needs attention comes first, the rest follow in their usual order (and are folded away).
  assert.deepEqual(lineIds, ["directory", "intake", "crm_key", "pbx_key", "pbx_link", "last_event", "reconcile", "evidence", "divergence", "record", "backfill", "automation"]);
  assert.match(flat(markup), /Состояние Требует внимания: 1 из 12/u, "one sentence says how many lines need a look");
  assert.match(markup, /<details class="group mt-2" data-testid="v3-telephony-status-rest"/u, "the lines that are fine or off are folded");
  assert.match(flat(markup), /Остальные строки: 11/u);
  assert.ok(markup.indexOf('data-line="directory"') < markup.indexOf('data-testid="v3-telephony-status-rest"'), "the attention line stands above the fold");
  assert.ok(markup.indexOf('data-line="intake"') > markup.indexOf('data-testid="v3-telephony-status-rest"'), "the quiet lines are inside it");
  assert.match(flat(markup), /Звонки этих пользователей ВАТС сохраняются без сотрудника\./u, "what does not work because of the line stands under it");
  assert.match(markup, /data-line="intake" data-tone="off"/u);
  assert.match(flat(markup), /Приём событий на сервере.{0,40}выключен/u);
  assert.match(flat(markup), /Меняет технический специалист на сервере; в CRM это не переключается/u);
  assert.match(markup, /data-extensions="3" data-readonly="false"/u);
  assert.match(markup, /data-form-version="3" data-readonly="false"/u);
  assert.doesNotMatch(flat(markup), /работает/u);
});

test("the verdict counts the line of an issue: intake open and the PBX key missing is not «Замечаний нет»", () => {
  const { TelephonySection } = sectionModule();
  const noUnmapped = { directory: { active: 3, inactive: 1, unmapped: 0, last_seen_at: null } };
  const view = (server, input = {}) => render(React.createElement(TelephonySection, {
    read: { status: "ready", overview: overview({ health: noUnmapped, ...input }), server, inboundUrl: INBOUND }, readOnly: false, now: NOW,
  }));
  const noPbxKey = view({ ...SERVER_ON, pbx: "not_configured" });
  assert.deepEqual(telephonyHealth.telephonyIssues({ ...SERVER_ON, pbx: "not_configured" }, overview({ health: noUnmapped }), NOW).map((issue) => issue.id), ["pbx_key"],
    "the same state is an issue in «Интеграции»");
  assert.match(flat(noPbxKey), /Состояние Требует внимания: 1 из 12/u);
  assert.doesNotMatch(flat(noPbxKey), /Замечаний нет/u);
  assert.match(noPbxKey, /data-line="pbx_key" data-tone="warn"/u);
  // The line and its hand-off stand above the fold, not in the folded list.
  assert.ok(noPbxKey.indexOf('data-line="pbx_key"') < noPbxKey.indexOf('data-testid="v3-telephony-status-rest"'));
  assert.match(flat(noPbxKey), /Сверка с историей ВАТС, список пользователей и звонок из CRM выключены\./u);
  assert.match(noPbxKey, /data-testid="v3-telephony-handoff">Передать техническому специалисту: внести ключ ВАТС на сервер</u);
  // A state with nothing to look at still says so.
  const quiet = view(SERVER_ON);
  assert.match(flat(quiet), /Состояние Замечаний нет/u);
  assert.doesNotMatch(quiet, /v3-telephony-handoff/u);
  // Intake off: no such issue, the key line is quiet (the intake line is the one to look at only if a switch is on).
  const off = view({ ...SERVER_OFF });
  assert.match(flat(off), /Состояние Замечаний нет/u);
  assert.match(off, /data-line="pbx_key" data-tone="off"/u);
});

test("when something is on the «Выключено» line disappears, and a preview passes read-only down", () => {
  const { TelephonySection } = sectionModule();
  const markup = render(React.createElement(TelephonySection, {
    read: { status: "ready", overview: overview({ flags: { projectionEnabled: true } }), server: SERVER_ON, inboundUrl: INBOUND }, readOnly: true, now: NOW,
  }));
  assert.doesNotMatch(markup, /v3-telephony-off|data-switched-off/u);
  assert.equal([...markup.matchAll(/data-readonly="true"/gu)].length, 2, "the table and the form both get read-only");
  assert.match(markup, /data-line="intake" data-tone="ok"/u);
});

test("«Ваша CRM»: the address to paste, and the intake key only as set/not set — never its value", () => {
  const { TelephonySection } = sectionModule();
  const view = (server) => render(React.createElement(TelephonySection, {
    read: { status: "ready", overview: overview(), server, inboundUrl: INBOUND }, readOnly: false, now: NOW,
  }));
  const set = view(SERVER_ON);
  const text = flat(set);
  assert.match(text, /Подключение «Ваша CRM» в кабинете ВАТС/u);
  assert.match(set, /<code data-copy="true">https:\/\/crm\.evoadmissions\.com\/api\/v2\/telephony\/beeline\/inbound<\/code>/u);
  for (const label of ["Имя вашей CRM", "Адрес вашей CRM", "Ключ для авторизации в вашей CRM", "Адрес АТС и ключ для авторизации в АТС", "Права доступа к управлению ВАТС", "Сценарий", "Статус обработки пропущенного звонка в CRM", "Звонки клиентов ответственному менеджеру"]) {
    assert.ok(text.includes(label), label);
  }
  assert.match(text, /Ключ для авторизации в вашей CRM задан на сервере/u);
  assert.match(text, /заданы на сервере/u);
  // Ключи и адрес АТС — только «задан / не задан»: ни значения, ни пояснения о том, кто его вносит.
  assert.doesNotMatch(text, /Значение здесь не показывается|Их показывает сам кабинет/u);
  assert.match(text, /Для всех номеров/u);
  // Ключи заданы, ВАТС отвечает: подключение сделано, значения нужны только тому, кто создаёт его заново — блок свёрнут; не задан ключ — открыт, с предупреждением о тихом времени.
  assert.match(set, /<details class="group" data-testid="v3-telephony-connection-folded">/u);
  assert.doesNotMatch(text, /Подключение создают в тихое время/u);
  assert.doesNotMatch(view(SERVER_OFF), /v3-telephony-connection-folded/u);
  assert.match(flat(view(SERVER_OFF)), /Подключение создают в тихое время, когда владелец рядом/u);
  assert.doesNotMatch(text, /второй фазы|определяет сама/u, "no roadmap words in the guide");
  const unset = flat(view(SERVER_OFF));
  assert.match(unset, /Ключ для авторизации в вашей CRM не задан на сервере/u);
  assert.match(unset, /не заданы на сервере/u);
  for (const markup of [set, view(SERVER_OFF)]) {
    assert.ok(!markup.includes(KEY_PROBE));
    assert.doesNotMatch(markup, /type="(password|text)"|crm_token=|EVO_PLATFORM_TELEPHONY/u);
  }
});

/* -------------------------------------------------- сопоставление */

test("the mapping list: one row per PBX user, the state in words, a choice of staff, the stored-legs warning", () => {
  const { TelephonyExtensions } = compile("src/components/v3/settings/TelephonyExtensions.tsx");
  const { extensions, staff } = overview();
  const markup = render(React.createElement(TelephonyExtensions, { extensions, staff, readOnly: false }));
  const text = flat(markup);
  assert.match(text, /Пользователи ВАТС и сотрудники/u);
  assert.match(text, /Звонки пользователя без сопоставления сохраняются без сотрудника\. Сопоставление действует на новые звонки\./u);
  assert.equal([...markup.matchAll(/data-testid="v3-telephony-extension"/gu)].length, 3);
  assert.match(markup, /data-extension="u901"[^>]*data-mapped="yes"/u);
  assert.match(markup, /data-extension="u902"[^>]*data-mapped="no"/u);
  assert.match(markup, /<span data-chip="ok">Сопоставлен<\/span>/u);
  assert.match(markup, /<span data-chip="warn">Не сопоставлен<\/span>/u);
  assert.match(markup, /<span data-chip="neutral">Выключен в ВАТС<\/span>/u);
  assert.match(text, /внутр\. 901 · логин u901/u);
  assert.match(text, /Сотрудник: Staff A Изменить/u, "a mapped row says who and offers «Изменить» instead of a list");
  assert.match(text, /Звонков без сотрудника: 3/u);
  assert.doesNotMatch(text, /Они сотруднику не переносятся/u, "said once in the section lead, not under every row");
  // Staff A is taken by u901: the other rows list them as taken and disabled; the owner row does not.
  const rows = markup.split('data-testid="v3-telephony-extension"').slice(1);
  assert.match(rows[1], /<option value="20000000-0000-4000-8000-000000000002" disabled="">Staff A · уже сопоставлен<\/option>/u);
  assert.doesNotMatch(rows[0], /<select/u, "a mapped row has no list until «Изменить» is pressed");
  assert.match(rows[0], /data-testid="v3-telephony-extension-edit">Изменить<\/button>/u);
  // The button repeats in every row: its name starts with the visible word and says whose mapping it is (label in name).
  assert.match(rows[0], /<button [^>]*aria-label="Изменить сопоставление: PBX user 1"[^>]*>Изменить<\/button>/u);
  // The same name on both sides is not repeated, and the button then reads in full — still containing its own aria-label start.
  const same = overview({ extensions: [{ ...extensions[0], name: "Staff A" }] });
  const sameRow = render(React.createElement(TelephonyExtensions, { extensions: same.extensions, staff, readOnly: false }));
  assert.doesNotMatch(flat(sameRow), /Сотрудник: Staff A/u);
  assert.match(sameRow, /<button [^>]*aria-label="Изменить сопоставление: Staff A"[^>]*>Изменить сопоставление<\/button>/u);
  // The switched-off, unmapped PBX user has nothing to map: no controls, one sentence; the others have a choice.
  assert.doesNotMatch(rows[2], /<select|<button/u);
  assert.match(flat(rows[2]), /Пользователь выключен в ВАТС: сопоставлять нечего\./u);
  assert.match(rows[1], /<select/u);
  assert.doesNotMatch(rows[1], /<select[^>]* disabled=""/u);
  // The change is a request, not a save: «Сопоставить…» appears only when the choice differs — not as a grey dead button on every row.
  assert.doesNotMatch(rows[1], /Сопоставить…/u);
  assert.doesNotMatch(markup, /data-testid="v3-telephony-extension-confirm"/u);
});

test("the mapping list: empty directory and a preview", () => {
  const { TelephonyExtensions } = compile("src/components/v3/settings/TelephonyExtensions.tsx");
  const empty = render(React.createElement(TelephonyExtensions, { extensions: [], staff: [], readOnly: false }));
  assert.match(empty, /data-testid="v3-telephony-extensions-empty"/u);
  assert.match(flat(empty), /Пользователей ВАТС пока нет\. Список появится после того, как на сервере задан ключ ВАТС/u);
  const { extensions, staff } = overview();
  const preview = render(React.createElement(TelephonyExtensions, { extensions, staff, readOnly: true }));
  assert.doesNotMatch(preview, /<select|<button/u, "a preview shows the list and changes nothing");
  // A read-only mapped row whose employee has the same name as the PBX user has nothing to say or press: no empty 44 px line.
  const quiet = overview({ extensions: [{ ...extensions[0], name: "Staff A" }] });
  const quietRow = render(React.createElement(TelephonyExtensions, { extensions: quiet.extensions, staff, readOnly: true }));
  assert.doesNotMatch(quietRow, /<p class="mt-1 flex min-h-11/u, "no empty line under a read-only mapped row");
  assert.match(preview, /<p class="mt-1 flex min-h-11[^"]*">[^]*?Сотрудник: <span class="text-fg">Staff A<\/span>/u, "a read-only row with a different name still says who");
});

test("the mapping client confirms against what the person saw and sends only ids", () => {
  const code = source("src/components/v3/settings/TelephonyExtensions.tsx");
  assert.match(code, /^"use client";/u);
  assert.match(code, /fetch\("\/api\/v3\/telephony\/extensions", \{\s*method: "POST",\s*credentials: "same-origin"/u);
  assert.match(code, /previousMembershipId: extension\.membershipId,\s*membershipId: choice \|\| null/u);
  assert.match(code, /extensionId: extension\.id/u);
  assert.doesNotMatch(code, /login:|pbx_user|body: JSON\.stringify\(\{[^}]*(name|phone)/u);
  assert.match(code, /QUEUE_CONFIRM/u, "the confirm button is the dark neutral one, not the page's red");
  assert.match(code, /Уже сохранённые звонки не меняются/u);
  // An unknown outcome keeps the request id so a retry is the same request; a definite refusal draws a new one.
  assert.match(code, /setRequestId\(null\);\s*setConfirming\(false\);\s*setEditing\(false\);\s*setMessage\(\{ tone: "ok"/u);
  assert.match(code, /confirming \|\| !changed \? null/u, "the request button is there only for a changed choice");
  assert.match(code, /Результат неизвестен: повтор уйдёт с тем же id/u);
  assert.match(code, /router\.refresh\(\)/u);
  // Keyboard: «Изменить», «Сопоставить…», «Отмена» and the save each remove the pressed control; focus goes to a named target, never <body>.
  assert.match(code, /type Refocus = "select" \| "confirm" \| "settle" \| HTMLElement;/u);
  assert.match(code, /want\("select"\); setEditing\(true\);/u, "«Изменить» -> the list");
  assert.match(code, /want\("confirm"\); setConfirming\(true\);/u, "«Сопоставить…» -> the confirmation");
  assert.equal((code.match(/want\("settle"\)/gu) ?? []).length, 4, "both «Отмена» buttons and both outcomes of a save settle on «Изменить» or the list");
  assert.match(code, /expected\.current = choice \|\| null;/u, "after a save the page refreshes later: focus is set again once the mapping arrives");
  assert.match(code, /ref=\{confirmRef\} tabIndex=\{-1\}/u);
});

/* ---------------------------------------------------------- настройки */

test("the settings form: seven switches with their words, hours, days, dial, ceilings and recipients", () => {
  const { TelephonySettingsForm } = compile("src/components/v3/settings/TelephonySettingsForm.tsx");
  const markup = render(React.createElement(TelephonySettingsForm, { overview: overview(), server: SERVER_ON, readOnly: false }));
  const text = flat(markup);
  for (const key of ["projectionEnabled", "uiEnabled", "dialEnabled", "missedTaskEnabled", "unknownLeadEnabled", "backfillEnabled", "outboundPaused"]) {
    assert.match(markup, new RegExp(`data-flag="${key}"`, "u"), key);
    assert.match(markup, new RegExp(`id="tel-flag-${key}"[^>]*role="switch"`, "u"), key);
  }
  for (const key of ["projectionEnabled", "uiEnabled", "dialEnabled", "missedTaskEnabled", "unknownLeadEnabled", "backfillEnabled", "outboundPaused"]) {
    const toggle = markup.match(new RegExp(`<button id="tel-flag-${key}"[^>]*>`, "u"))[0];
    assert.match(toggle, /aria-checked="false"/u, `${key} ships off`);
    assert.match(toggle, /class="v3-switch/u, `${key} is a real switch (track and thumb), not a checkbox`);
  }
  assert.doesNotMatch(markup, /<input id="tel-flag-/u, "no checkbox look for a switch");
  assert.equal([...markup.matchAll(/data-testid="v3-telephony-flag-state">Выключено</gu)].length, 7, "each switch says its state in a word");
  for (const phrase of ["Разбор звонков", "Звонки видны сотрудникам", "Кнопка «Позвонить» и результат звонка", "Задачи «Перезвонить» и «Недозвон»", "Лиды «Звонок» по неизвестным номерам", "Первичный импорт за 30 дней", "Пауза исходящих запросов к ВАТС"]) {
    assert.ok(text.includes(phrase), phrase);
  }
  assert.match(text, /Пока включатель не включён здесь, сотрудникам ничего не показывается/u);
  assert.doesNotMatch(text, /Слияние кода/u, "no build-process talk in the screen");
  // Days and times.
  const tag = (id) => markup.match(new RegExp(`<input id="${id}"[^>]*>`, "u"))?.[0] ?? "";
  for (const day of ["понедельник", "суббота", "воскресенье"]) assert.match(markup, new RegExp(`aria-label="${day}"`, "u"));
  const days = [...markup.matchAll(/<input type="checkbox" class="sr-only"[^>]*>/gu)].map((match) => match[0]);
  assert.equal(days.length, 7);
  assert.equal(days.filter((day) => day.includes('checked=""')).length, 6, "Monday to Saturday are the default working days");
  assert.ok(!days.find((day) => day.includes('aria-label="воскресенье"')).includes('checked=""'));
  // Native time fields: a phone's numeric keypad has no «:» and a text field would lock touch users out; the value is always HH:MM.
  for (const piece of ['type="time"', 'value="10:00"']) assert.ok(tag("tel-work-from").includes(piece), piece);
  for (const piece of ['type="time"', 'value="20:00"']) assert.ok(tag("tel-work-to").includes(piece), piece);
  for (const id of ["tel-work-from", "tel-work-to"]) assert.doesNotMatch(tag(id), /inputMode|maxLength|type="text"/u, `${id} is not a text field`);
  assert.doesNotMatch(text, /24-часовом виде/u, "no claim about the 24-hour display: the device language decides it");
  // Numbers carry the table's bounds.
  for (const [id, min, max, value] of [["callbackWorkMinutes", 1, 480, 15], ["limitUserDay", 1, 1000, 150], ["limitUserGapSeconds", 1, 3600, 5],
    ["limitOrgHour", 1, 1000, 60], ["limitOrgDay", 1, 5000, 400], ["ceilingLeadsHour", 1, 100, 10], ["ceilingLeadsDay", 1, 400, 40],
    ["ceilingTasksHour", 1, 300, 30], ["ceilingTasksDay", 1, 1200, 120]]) {
    const input = tag(`tel-${id}`);
    for (const piece of ['type="number"', 'inputMode="numeric"', `min="${min}"`, `max="${max}"`, 'step="1"', `value="${value}"`]) {
      assert.ok(input.includes(piece), `${id}: ${piece}`);
    }
    assert.match(markup, new RegExp(`<label for="tel-${id}"`, "u"), `${id} has a label`);
  }
  for (const piece of ['type="text"', 'value="+996"']) assert.ok(tag("tel-prefixes").includes(piece), piece);
  assert.match(text, /Сейчас: \+996\./u);
  // Recipients: those who hold the right, plus "nobody"; Staff B (no right) is not offered.
  const select = markup.match(/<select id="tel-escalation"[\s\S]*?<\/select>/u)[0];
  assert.match(select, /Не назначен: решает директор/u);
  assert.match(select, /Staff A/u);
  assert.match(select, /Staff C/u);
  assert.doesNotMatch(select, /Staff B/u);
  // Not dirty yet: the button is idle (aria-disabled), no confirmation, no "unsaved" line.
  assert.match(markup, /class="btn-primary[^"]*"[^>]*aria-disabled="true"[^>]*>Сохранить настройки<\/button>/u);
  assert.doesNotMatch(markup, /v3-telephony-opening/u);
});

test("the settings form tells the truth about what the server cannot do yet", () => {
  const { TelephonySettingsForm } = compile("src/components/v3/settings/TelephonySettingsForm.tsx");
  const off = flat(render(React.createElement(TelephonySettingsForm, { overview: overview(), server: SERVER_OFF, readOnly: false })));
  assert.match(off, /Приём событий выключен на сервере: звонков для разбора нет, пока технический специалист его не включит/u);
  assert.match(off, /Ключ ВАТС на сервере не задан: запросы к ВАТС не идут, пока его не внесут/u);
  const invalid = flat(render(React.createElement(TelephonySettingsForm, { overview: overview(), server: { ...SERVER_ON, pbx: "invalid" }, readOnly: false })));
  assert.match(invalid, /Параметры ВАТС на сервере заданы неверно/u);
  const on = flat(render(React.createElement(TelephonySettingsForm, { overview: overview(), server: SERVER_ON, readOnly: false })));
  assert.doesNotMatch(on, /выключен на сервере|не задан: запросы|заданы неверно/u);
});

test("a recipient who lost the right is shown with a warning and can be replaced; a preview is read-only", () => {
  const { TelephonySettingsForm } = compile("src/components/v3/settings/TelephonySettingsForm.tsx");
  const lost = overview({
    escalationMembershipId: B,
    escalation: { membershipId: B, name: "Staff B", allowed: false },
  });
  const markup = render(React.createElement(TelephonySettingsForm, { overview: lost, server: SERVER_ON, readOnly: false }));
  assert.match(markup, /data-testid="v3-telephony-escalation-lost"/u);
  assert.match(flat(markup), /У получателя «Staff B» больше нет права на телефонию\. Выберите другого\./u);
  assert.match(markup, /<option value="20000000-0000-4000-8000-000000000003" selected="">Staff B · права больше нет<\/option>/u);
  const preview = render(React.createElement(TelephonySettingsForm, { overview: overview(), server: SERVER_ON, readOnly: true }));
  assert.match(preview, /<fieldset disabled="" class="@container min-w-0">/u);
  assert.doesNotMatch(preview, /Сохранить настройки/u);
  assert.match(flat(preview), /В просмотре роли настройки не меняются/u);
});

test("the settings client sends one versioned patch, asks for a confirmation before opening anything and repeats nothing blindly", () => {
  const code = source("src/components/v3/settings/TelephonySettingsForm.tsx");
  assert.match(code, /^"use client";/u);
  assert.match(code, /fetch\("\/api\/v3\/telephony\/settings", \{\s*method: "POST",\s*credentials: "same-origin"/u);
  assert.match(code, /JSON\.stringify\(\{ requestId: id, expectedVersion: settings\.version, patch \}\)/u);
  assert.match(code, /telephonyOpeningFlags\(settings, draft\)/u);
  assert.match(code, /Это сохранение откроет:/u);
  assert.match(code, /Понимаю и подтверждаю/u);
  assert.match(code, /opening\.length > 0 && !understood/u);
  assert.match(code, /Результат неизвестен: повтор уйдёт с тем же id/u);
  assert.match(code, /router\.refresh\(\)/u);
  assert.match(code, /const issues = useMemo\(\(\) => telephonyDraftIssues\(draft\), \[draft\]\)/u);
  // The page re-keys the form by version so it restarts from the saved settings.
  assert.match(source("src/components/v3/settings/TelephonySection.tsx"), /<TelephonySettingsForm key=\{overview\.settings\.version\}/u);
});

test("the draft check in the form is the same function the lib tests pin, and the form owns no CHECK of its own", () => {
  const code = source("src/components/v3/settings/TelephonySettingsForm.tsx");
  assert.doesNotMatch(code, /localStorage|sessionStorage|process\.env|server-only|NEXT_PUBLIC/u);
  for (const file of ["TelephonySection", "TelephonyExtensions", "TelephonySettingsForm", "TelephonyCopyValue"]) {
    const text = source(`src/components/v3/settings/${file}.tsx`);
    assert.doesNotMatch(text, /process\.env|from "server-only"|import "server-only"|EVO_PLATFORM_TELEPHONY|crm_token|X-API-KEY/u, file);
    assert.equal(/^"use client";/u.test(text), file !== "TelephonySection", `${file} is a client component only when it needs hooks`);
  }
});

/* ---------------------------------------------------- страница и разделы */

test("the page keeps the Admin sections as they were and gives a non-Admin holder one section only", () => {
  const page = source("src/app/(v3)/v3/settings/page.tsx");
  assert.match(page, /const section = isSectionKey\(params\.section\) \? params\.section : "staff";/u, "settings still open on «Сотрудники»");
  assert.match(page, /const isAdmin = actor\.systemRole === "admin" && actor\.presentationRole === null;/u);
  const early = page.indexOf('if (actor.systemRole !== "admin") {');
  assert.ok(early > page.indexOf("requireV3PageActor"), "after the route guard");
  for (const read of ["readIntegrations(", "readGateFacts(", "readJournal(", "readJournalFacets(", "readStaffWorkspace(", "readStaffRoles(", "readPlatformFact(", "readAccountDeletionQueue(", "readSalesRegisterManagement("]) {
    assert.ok(page.indexOf(read) > early, `${read} comes only after the non-Admin early return`);
  }
  const earlyBlock = page.slice(early, page.indexOf("const telephonyRead"));
  assert.match(earlyBlock, /<TelephonySection read=\{await readTelephonyAdmin\(actor\)\} readOnly=\{false\}/u);
  assert.doesNotMatch(earlyBlock, /<Settings\b|readIntegrations|salesImportHref/u);
  assert.match(page, /telephonyReadOnly=\{isStaffPreview\(actor\)\}/u);
  assert.match(page, /section === "telephony" \|\| section === "integrations" \? readTelephonyAdmin\(actor\)/u, "the read happens only for the two sections that show it");
});

test("the sections list gets «Телефония» right after «Интеграции»; the list is otherwise as before", () => {
  const types = source("src/components/v3/settings/types.ts");
  const keys = [...types.matchAll(/\{ key: "([a-z]+)", view: (?:"[a-z]+"|null), title: "([^"]+)" \}/gu)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(keys, ["staff:Сотрудники", "staff:Роли и доступ", "staff:Отделы", "integrations:Интеграции", "telephony:Телефония", "journal:Журнал действий",
    "deletion:Запросы на удаление", "documents:Документы и передача", "platform:Платформа"]);
  const settings = source("src/components/v3/settings/Settings.tsx");
  assert.match(settings, /current\.key === "telephony" \? <TelephonySection read=\{telephony \?\? null\} readOnly=\{telephonyReadOnly \?\? false\}/u);
  assert.doesNotMatch(settings, /виден только администратору|>\s*админ\s*</u);
});

test("the two route files export POST only, on the Node runtime, never cached", () => {
  for (const [file, factory] of [["settings", "createTelephonySettingsHandler"], ["extensions", "createTelephonyExtensionHandler"]]) {
    const code = source(`src/app/api/v3/telephony/${file}/route.ts`);
    assert.match(code, new RegExp(`export const POST = ${factory}\\(\\);`, "u"));
    assert.doesNotMatch(code, /export const (GET|PUT|PATCH|DELETE|HEAD)\b/u);
    assert.match(code, /export const runtime = "nodejs";/u);
    assert.match(code, /export const dynamic = "force-dynamic";/u);
  }
  const handlers = source("src/lib/server/platform-telephony-admin-route-handlers.ts");
  assert.equal([...handlers.matchAll(/if \(!sameOrigin\(request\)\) return failure\(403, "forbidden"\);/gu)].length, 2, "both POST handlers check the origin first");
  assert.match(handlers, /isStaffPreview\(result\.actor\)\) return \{ status: "preview"/u);
  assert.match(handlers, /staffHasPermission\(result\.actor, "telephony\.manage"\)/u);
});

test("the new suites are in the unit manifest so they run with the rest", () => {
  const manifest = source("package.json");
  for (const file of ["tests/platform-telephony-admin.test.mjs", "tests/platform-telephony-settings-ui.test.mjs"]) {
    assert.ok(manifest.includes(file), file);
  }
});
