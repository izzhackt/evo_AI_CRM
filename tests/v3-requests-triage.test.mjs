import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseRequestSelection, requestsHref } from "../src/lib/requests-queue-contract.ts";
import { requestClosedLine, requestDisplayName, requestEmptyWhat, requestLatestLine, requestReceived, requestTabs, requestTriage } from "../src/lib/v3/requests-view.ts";
import { buildTodayQueue, todayRequestItems } from "../src/lib/v3/today-queue.ts";


/**
 * «Заявки» (Э3, 27.09.2026): очередь разбора с «Взять себе». Логика
 * представления проверяется напрямую, разметка — настоящей страницей в
 * AppShell с синтетическим ответом `staff_requests_queue_v3`
 * (tests/e2e/requests-static-render.cjs --json, отдельный node-процесс).
 * Права и строки на настоящем Postgres — набор 250
 * (supabase/tests/platform_requests_queue_triage.sql). Это не живая проверка
 * Supabase или данных EVO.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/requests-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
/** Содержимое страницы без оболочки: от `<main data-testid="v3-requests">` до конца main. */
const main = (html) => {
  const start = html.indexOf('data-testid="v3-requests"');
  assert.ok(start > 0, "the page renders its own main");
  return html.slice(html.lastIndexOf("<main", start), html.indexOf("</main>", start));
};
const count = (html, pattern) => [...html.matchAll(pattern)].length;
/** Строки таблицы «Нового вида» (с #1327 единственного вида): `tr` внутри `tbody`; карточки телефона — отдельный список с теми же записями. */
const tableRows = (html) => {
  const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
  return count(body, /<tr[ >]/gu);
};
/** Подписи вкладок с числами: «Все 9», «Сайт 4»… */
const tabs = (html) => {
  const page = main(html);
  const start = page.indexOf('data-testid="queue-view-tabs"');
  const nav = page.slice(start, page.indexOf("</nav>", start));
  return [...nav.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/gu)].map((match) => match[1].replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim());
};

const ME = "bbbbbbbb-7777-4777-8777-000000000003";
const LEAD_1 = "dddddddd-3333-4333-8333-000000000001";
const NOW = new Date("2026-09-27T06:00:00.000Z");

test("«Взять себе» is the existing owner command: the board's form action, its exact fields, the same permission", () => {
  const take = read("src/components/v3/requests/TakeLead.tsx");
  const actions = read("src/lib/platform-sales-actions.ts");
  // Та же серверная функция, что у формы решения доски, — новой нет.
  const importLine = /import \{ updatePlatformSalesWorkflowAction, type PlatformSalesWorkflowActionState \} from "@\/lib\/platform-sales-actions";/u;
  assert.match(take, importLine);
  assert.match(read("src/components/v3/PipelineDecisionForm.tsx"), /updatePlatformSalesWorkflowAction,/u);
  assert.match(take, /useActionState\(updatePlatformSalesWorkflowAction,/u);
  for (const path of ["src/components/v3/requests/TakeLead.tsx", "src/components/v3/requests/RequestsQueueView.tsx", "src/lib/requests-queue-contract.ts", "src/lib/v3/requests-view.ts"]) {
    assert.doesNotMatch(read(path), /^"use server"/mu, `${path} adds no server action`);
    assert.doesNotMatch(read(path), /\.rpc\(|createSupabase|from "@\/lib\/platform-sales"/u, `${path} calls no command of its own`);
  }
  // Поля формы — ровно поля действия (exactActionStringFields требует точный набор).
  const expected = [...actions.match(/const WORKFLOW_FORM_FIELDS = \[([\s\S]*?)\] as const;/u)[1].matchAll(/"([a-z_]+)"/gu)].map((m) => m[1]).sort();
  const posted = [...take.matchAll(/<input type="hidden" name="([a-z_]+)"/gu)].map((m) => m[1]).sort();
  assert.deepEqual(posted, expected);
  // Право — то же: действие требует sales.write, команда — mutate_sales_lead_workflow.
  assert.match(actions, /export async function updatePlatformSalesWorkflowAction[\s\S]*?requirePlatformMutationCapability\("sales\.write", "\/v3\/pipeline"\)[\s\S]*?mutatePlatformSalesLeadWorkflow\(actor, input\)/u);
  assert.match(read("src/lib/platform-sales.ts"), /"mutate_sales_lead_workflow",/u);
  // «Можно взять» в чтении 250 — ровно проверки смены ответственного команды (086 в редакции 156).
  const migration = read("supabase/migrations/250_platform_requests_queue_triage.sql");
  const rule156 = read("supabase/migrations/156_platform_scoped_staff_consumers.sql");
  for (const check of [
    "staff_can_access(l.organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',l.id)",
    "staff_can_access(l.organization_id,actor.membership_id,'lead.sales.owner.assign','lead',l.id)",
    "staff_can_receive_assignment(l.organization_id,actor.membership_id,'lead.read','lead',l.id)",
    "staff_can_receive_assignment(l.organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',l.id)",
  ]) assert.ok(migration.includes(check), check);
  assert.match(rule156, /'lead\.sales\.owner\.assign', 'lead', lead_record\.id\)[\s\S]*?staff_can_receive_assignment\(actor\.organization_id,p_owner_membership_id,\s*'lead\.read','lead',lead_record\.id\)[\s\S]*?'lead\.sales\.workflow\.manage','lead',lead_record\.id\)/u);
  assert.match(rule156, /platform_private\.staff_can_access\(authority\.organization_id, authority\.membership_id,\s*'lead\.sales\.workflow\.manage', 'lead', p_lead_id\)/u);
});

test("the rendered take repeats the lead's stage and next action and names the viewer as the owner", () => {
  const html = main(surfaces.get("populated"));
  const form = html.slice(html.indexOf('data-testid="requests-take"'), html.indexOf("</form>", html.indexOf('data-testid="requests-take"')));
  const value = (name) => form.match(new RegExp(`name="${name}" value="([^"]*)"`, "u"))?.[1];
  assert.equal(value("lead_id"), LEAD_1);
  assert.equal(value("current_owner_membership_id"), ME);
  assert.equal(value("expected_version"), "1");
  assert.equal(value("stage_key"), "new");
  assert.equal(value("clear_next_action"), "true");
  assert.equal(value("next_action_text"), "");
  assert.equal(value("reason"), "");
  assert.match(form, /aria-label="Взять себе: Эльмира Формова"/u);
});

test("«Взять себе» only where the read says the server allows and the viewer is not previewing a role", () => {
  const lead = {
    kind: "lead", id: LEAD_1, source: "website", occurredAt: "2026-09-27T03:12:00.000000Z", personName: "x", email: null, phone: null,
    leadId: LEAD_1, owner: null, handedOff: false, take: { workflowVersion: "1", stageKey: "new", nextActionText: null, nextActionDueDate: null },
  };
  assert.deepEqual(requestTriage(lead, { actorMembershipId: ME, canAct: true }), { kind: "take" });
  assert.deepEqual(requestTriage(lead, { actorMembershipId: ME, canAct: false }), { kind: "untaken" });
  assert.deepEqual(requestTriage({ ...lead, take: null }, { actorMembershipId: ME, canAct: true }), { kind: "untaken" });
  assert.deepEqual(requestTriage({ ...lead, take: null, handedOff: true }, { actorMembershipId: ME, canAct: true }), { kind: "handed" });
  assert.deepEqual(requestTriage({ ...lead, take: null, owner: { membershipId: ME, name: "Я" } }, { actorMembershipId: ME, canAct: true }),
    { kind: "owner", name: "Вы", mine: true });
  assert.deepEqual(requestTriage({ ...lead, take: null, owner: { membershipId: "aaaaaaaa-1111-4111-8111-000000000002", name: null } }, { actorMembershipId: ME, canAct: true }),
    { kind: "owner", name: "Назначен", mine: false });
  // Разметка: два не взятых лида — по кнопке в строке таблицы и в карточке телефона (4); без права (чтение без «take») и в просмотре роли — ни одной.
  assert.equal(count(main(surfaces.get("populated")), />Взять себе</gu), 4);
  const untakeable = main(surfaces.get("sales-untakeable"));
  assert.equal(count(untakeable, /Взять себе/gu), 0);
  assert.match(untakeable, /Без ответственного/u);
  const preview = main(surfaces.get("preview"));
  assert.equal(count(preview, /Взять себе/gu), 0);
  assert.doesNotMatch(preview, /Добавить лида/u, "role preview cannot add a lead");
  assert.match(preview, /Без ответственного/u);
});

test("counts come only from the read: tabs show the read's numbers, hide a kind the role cannot read, and have none on failure", () => {
  assert.deepEqual(tabs(surfaces.get("populated")), ["Все 9", "Сайт 4", "WhatsApp 1", "Анкеты 2", "Консультации 2"]);
  assert.deepEqual(tabs(surfaces.get("waiting")), ["Все 4", "Сайт 2", "WhatsApp 0", "Анкеты 1", "Консультации 1"]);
  // Анкеты роли закрыты: вкладки нет, «Все» — сумма читаемых видов.
  assert.deepEqual(tabs(surfaces.get("sales-empty")), ["Все 0", "Сайт 0", "WhatsApp 0", "Консультации 0"]);
  const error = main(surfaces.get("error"));
  assert.deepEqual(tabs(surfaces.get("error")), ["Все", "Сайт", "WhatsApp", "Анкеты", "Консультации"]);
  assert.match(error, /data-testid="queue-error"/u);
  assert.match(error, /Заявки не загрузились\. Список и числа сейчас неизвестны\./u);
  assert.equal(count(error, /data-queue-row=/gu), 0);
  // Без чтения вкладки не выдумывают числа; вкладка текущего вида остаётся.
  const selection = parseRequestSelection({ source: "platform_application" });
  assert.deepEqual(requestTabs(selection, null).map((tab) => tab.count), [null, null, null, null, null]);
  // Прежней строки счётчиков и «Применить» больше нет.
  for (const html of [main(surfaces.get("populated")), main(surfaces.get("empty"))]) {
    assert.doesNotMatch(html, /На странице|Всего по фильтру|Применить|Анкет ожидают решения|Открытых консультаций/u);
  }
});

test("rows: name to Lead 360 with the way back, source, when it came without SLA colour, triage, one «Открыть»", () => {
  const html = main(surfaces.get("populated"));
  assert.equal(tableRows(html), 9);
  assert.match(html, new RegExp(`href="/v3/profile\\?id=${LEAD_1}&amp;returnTo=%2Fv3%2Frequests%3Fstatus%3Dall"`, "u"));
  // Строка открывается нажатием (`onRowClick` → `openHref`), поэтому адрес «Открыть» лежит в данных строки, а не в разметке.
  assert.match(read("src/components/v3/requests-next/requests-next-rows.tsx"), /openHref: requestsHref\(props\.selection, key\),/u, "one open address per row, with the tab kept");
  assert.match(html, /<time dateTime="2026-09-27T03:12:00.000000Z" class="font-mono tabular-nums text-fg">27\.09 09:12<\/time>/u);
  assert.doesNotMatch(html, /Больше 2 ч|text-danger/u, "no SLA group and no overdue colour on requests");
  for (const word of ["ждёт решения", "Бекболот Примеров", "открыта", "Вы", "Передан в поступление", "отклонена", "обработана"]) {
    assert.ok(html.includes(word), word);
  }
  assert.equal(requestReceived("2026-09-26T19:30:00.000000Z", NOW).word, "сегодня", "Bishkek day: 01:30 on 27.09");
  assert.equal(requestReceived("2026-09-26T13:05:00.000000Z", NOW).word, "вчера");
  assert.deepEqual(requestReceived("2026-09-20T04:00:00.000000Z", NOW), { dateTime: "2026-09-20T04:00:00.000000Z", text: "20.09 10:00", word: "7 дн назад" });
});

test("one solid red: «Добавить лида» in the header; the empty queue says what comes here and when the last came", () => {
  for (const [name, html] of surfaces) {
    if (name === "preview") continue;
    assert.ok(count(main(html), /border-accent bg-accent/gu) <= 1, `${name}: at most one solid red`);
  }
  const empty = main(surfaces.get("empty"));
  assert.match(empty, /Новых заявок нет/u);
  // «Что сюда приходит» ушло за «?» шапки: страница отдаёт его в `help` (чистая функция `requestEmptyWhat` проверена ниже).
  assert.match(read("src/app/(v3)/v3/requests/page.tsx"), /requestEmptyWhat\(read\.queue, selection\.source\)/u);
  assert.match(empty, /Последняя пришла вчера в 19:05\./u);
  assert.equal(count(empty, /aria-controls="manual-lead-panel"/gu), 1, "one entry to the manual-lead form");
  assert.equal(requestLatestLine(null, NOW), null);
  assert.equal(requestLatestLine("2026-09-24T08:10:00.000000Z", NOW), "Последняя пришла 24.09 в 14:10 (3 дн назад).");
  assert.match(main(surfaces.get("sales-empty")), /Последняя пришла 24\.09 в 16:00 \(3 дн назад\)\./u);
});

test("a role that cannot read every kind: «Все» names the closed kinds and the empty queue promises only what it reads", () => {
  // Ревью PR #1084: у Sales Manager анкеты закрыты (набор 250 — application_ready = FALSE
  // у каждого Sales Manager), а пустое «Все» обещало «анкеты поступающих» и молчало,
  // что «Анкеты» роли недоступны.
  const salesEmpty = main(surfaces.get("sales-empty"));
  assert.doesNotMatch(salesEmpty, /анкеты поступающих/u);
  const closedLine = /<p class="[^"]*" data-testid="requests-closed-kinds">Анкеты вашей роли недоступны: список и числа ниже — без них\.<\/p>/u;
  assert.match(salesEmpty, closedLine);
  // Строка стоит над очередью и остаётся, когда строки есть.
  assert.ok(salesEmpty.indexOf('data-testid="requests-closed-kinds"') >= 0);
  const untakeable = main(surfaces.get("sales-untakeable"));
  assert.match(untakeable, closedLine);
  assert.ok(untakeable.indexOf('data-testid="requests-closed-kinds"') < untakeable.indexOf("<tbody"));
  // Всё читается — строки нет, пустое «Все» перечисляет все три вида.
  for (const name of ["empty", "populated", "waiting", "preview", "error"]) {
    assert.doesNotMatch(main(surfaces.get(name)), /requests-closed-kinds/u, name);
  }
  // Чистые функции: только читаемые виды; вкладка своего вида — своя фраза; закрыто всё — ничего не обещаем.
  const queue = (lead, application, consultation) => ({ states: { lead, application, consultation } });
  assert.equal(requestEmptyWhat(queue("ready", "forbidden", "ready"), "all"),
    "Сюда приходят заявки с сайта и из WhatsApp, а также запросы консультаций из кабинета студента.");
  assert.equal(requestEmptyWhat(queue("ready", "forbidden", "forbidden"), "all"), "Сюда приходят заявки с сайта и из WhatsApp.");
  assert.equal(requestEmptyWhat(queue("forbidden", "forbidden", "forbidden"), "all"), null);
  assert.equal(requestEmptyWhat(queue("ready", "forbidden", "ready"), "platform_application"), null);
  assert.equal(requestEmptyWhat(queue("ready", "ready", "ready"), "website"), "Сюда приходят заявки с формы сайта.");
  assert.equal(requestClosedLine(queue("ready", "ready", "ready")), null);
  assert.equal(requestClosedLine(queue("ready", "forbidden", "forbidden")),
    "Анкеты и консультации из кабинета вашей роли недоступны: список и числа ниже — без них.");
  // Закрытая вкладка своего вида — пустота «… вашей роли недоступны», без обещаний (экран нового вида).
  assert.match(read("src/components/v3/requests-next/RequestsNextEmpty.tsx"), /вашей роли недоступны/u);
});

test("the manual-lead form tells an owner-read failure apart from «no available owner»", () => {
  // Ревью PR #1084: сбой чтения ответственных превращался в пустой список, и форма
  // говорила «Нет доступного ответственного… Проверьте доступ сотрудников».
  const owners = JSON.parse(execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./e2e/requests-static-render.cjs", import.meta.url)), "--manual-lead-owners"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ));
  assert.equal(owners.read.length, 2);
  assert.equal(owners.failed, null, "a failed read reaches the form as null, not as an empty list");
  assert.match(read("src/components/v3/ManualLeadForm.tsx"),
    /props\.owners === null\s*\? <p role="status"[^>]*>Список ответственных не загрузился, поэтому добавить лида сейчас нельзя\. Обновите страницу\.<\/p>\s*: props\.owners\.length \? <ManualLeadEditor/u);
});

test("the record panel holds the full questionnaire and the existing decision, quiet and flat; a role preview gets no decision and no «Взять себе»", () => {
  // «Новый вид» (#1327): панель открывается нажатием и собирается на клиенте из `requestSheetContent`, поэтому её содержимое проверяется по исходнику.
  const sheet = read("src/components/v3/requests-next/RequestSheetBody.tsx");
  assert.match(sheet, /Заполнено поступающим/u);
  assert.match(sheet, /<ApplicationDecision application=\{row\.application\} requestId=\{props\.decisionRequestId\} quiet flat \/>/u, "the existing decision form, quiet and flat");
  assert.match(sheet, /props\.readOnly\s*\? <p className="t-body-compact text-fg-2">В режиме просмотра решения недоступны\.<\/p>/u, "role preview: no decision");
  assert.match(sheet, /<TakeLeadButton/u);
  assert.match(sheet, /Открыть карточку лида/u);
  assert.match(sheet, /Сведения со слов поступающего, их нужно проверить\./u, "the risk warning stays visible");
  assert.doesNotMatch(sheet, /bg-accent|bg-primary/u, "the decision is quiet: the page's red stays in the header");
});

test("switching records gives the panel a new instance: no draft, conflict or take error carries to another record", () => {
  // Ревью PR #1084: без ключа панель при «Открыть» другой записи оставалась тем же экземпляром, и причина отказа анкеты A уходила с
  // application_id анкеты B, конфликт B запирал A, ошибка «Взять себе» лида X с его request_id — у лида Y. React пересоздаёт панель и её формы,
  // только когда меняется ключ элемента; в «Новом виде» (#1327) ключ — `requestOpenKey` записи, на которую смотрит панель.
  const content = read("src/components/v3/requests-next/RequestSheetBody.tsx");
  assert.match(content, /key: requestOpenKey\(row\),/u, "each panel content carries its record's key");
  const table = read("src/components/v3/requests-next/RequestsNextTable.tsx");
  assert.match(table, /<Fragment key=\{shown\.key\}>\{shown\.body\}<\/Fragment>/u, "the panel body is keyed by that record");
  // Доступное имя «Взять себе» начинается с видимой надписи и в «Берём…», и во «Взято».
  const take = read("src/components/v3/requests/TakeLead.tsx");
  assert.match(take, /const label = pending \? "Берём…" : saved \? "Взято" : "Взять себе";/u);
  assert.match(take, /aria-label=\{inPanel \? undefined : `\$\{label\}: \$\{personName\}`\}[^>]*>\s*\{label\}\s*<\/button>/u);
});

test("«Сегодня»: website and WhatsApp requests open «Заявки», a phone call does so only while the «Звонки» tab is readable, other unowned leads keep the board panel", () => {
  const lead = (n, source) => ({
    id: `ffffffff-2222-4222-8222-${String(n).padStart(12, "0")}`, name: `Лид ${n}`, stageKey: "new", source, nextAction: null, nextActionAt: null,
    due: "none", stageAgeDays: 0, latestNote: null, href: "",
    workflow: { leadId: `ffffffff-2222-4222-8222-${String(n).padStart(12, "0")}`, currentOwnerMembershipId: null, currentOwnerDisplayName: null,
      stageKey: "new", nextActionText: null, nextActionDueDate: null, workflowVersion: "1" },
  });
  const items = todayRequestItems([lead(1, "website"), lead(2, "whatsapp"), lead(3, "phone_call")]);
  assert.deepEqual(items.map((item) => item.openHref), [
    `/v3/requests?source=website&open=lead%3A${lead(1).id}`, `/v3/requests?source=whatsapp&open=lead%3A${lead(2).id}`, `/v3/pipeline?lead=${lead(3).id}`,
  ]);
  // Телефония включена для сотрудников: звонок с неизвестного номера открывает вкладку «Звонки», где его берут себе.
  assert.deepEqual(todayRequestItems([lead(3, "phone_call")], { callsTab: true }).map((item) => item.openHref),
    [`/v3/requests?source=phone_call&open=lead%3A${lead(3).id}`]);
  assert.deepEqual(todayRequestItems([lead(3, "phone_call")], { callsTab: false }).map((item) => item.openHref), [`/v3/pipeline?lead=${lead(3).id}`]);
  // Тот же адрес, что у «Открыть» строки «Заявок»: панель этого лида.
  assert.equal(items[0].openHref, requestsHref(parseRequestSelection({ source: "website" }), `lead:${lead(1).id}`));
  const queue = buildTodayQueue([{ source: "requests", state: "partial", items }], NOW);
  assert.deepEqual(queue.notices.find((notice) => notice.source === "requests").link, { label: "Все заявки", href: "/v3/requests" });
});

test("migration 250 is forward-only, definer with an empty search path, and keeps v1 for the previous release", () => {
  const sql = read("supabase/migrations/250_platform_requests_queue_triage.sql");
  assert.match(sql, /CREATE FUNCTION platform\.staff_requests_queue_v2\(/u);
  assert.match(sql, /STABLE SECURITY DEFINER SET search_path = ''/u);
  assert.doesNotMatch(sql, /DROP FUNCTION|CREATE OR REPLACE FUNCTION platform\.staff_requests_queue_v1/u);
  assert.match(sql, /actor\.platform_role IS NOT DISTINCT FROM 'student'/u);
  assert.doesNotMatch(sql, /platform_role\s*(?:NOT\s+)?IN\s*\(|platform_role\s*<>|platform_role\s*=/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.staff_requests_queue_v2\(UUID,TEXT,TEXT,INTEGER,JSONB\) TO authenticated;/u);
  assert.match(read("scripts/test-runners/test-postgres-authorization.sh"), /250_\*[\s\S]*platform_requests_queue_triage\.sql/u);
});

test("«Звонки» (телефония T9): the page reads v3 only, v3 is the v2 body plus phone_call behind ui_enabled, and v2 stays for the previous release", () => {
  const source = read("src/lib/v3/requests-queue-source.ts");
  assert.match(source, /rpc\("staff_requests_queue_v3",/u);
  assert.doesNotMatch(source, /staff_requests_queue_v2/u, "no parallel adapter: the page reads one version");
  const file = readdirSync(new URL("../supabase/migrations/", import.meta.url)).find((name) => name.endsWith("_platform_telephony_unknown_leads.sql"));
  assert.ok(file, "the migration is found by name, not by number");
  const sql = read(`supabase/migrations/${file}`);
  assert.match(sql, /CREATE FUNCTION platform\.staff_requests_queue_v3\(/u);
  assert.doesNotMatch(sql, /DROP FUNCTION|CREATE OR REPLACE FUNCTION platform\.staff_requests_queue_v[12]/u, "v1 and v2 stay for the previous release");
  assert.match(sql, /STABLE SECURITY DEFINER SET search_path = ''/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.staff_requests_queue_v3\(UUID,TEXT,TEXT,INTEGER,JSONB\) TO authenticated;/u);
  assert.match(sql, /actor\.platform_role IS NOT DISTINCT FROM 'student'/u);
  // The calls are in the read only with telephony ui_enabled, and a missing settings row is «off».
  assert.match(sql, /telephony_ui := COALESCE\(\(SELECT s\.ui_enabled FROM platform_private\.telephony_settings s\s+WHERE s\.organization_id=actor\.organization_id\), FALSE\);/u);
  assert.match(sql, /\(l\.source_key IN \('website','whatsapp'\) OR \(telephony_ui AND l\.source_key='phone_call'\)\)/u);
  // Everything else of the read is the 250 text: the same gates, only the names, the version and the new tab differ.
  const v2 = read("supabase/migrations/250_platform_requests_queue_triage.sql");
  const body = (text, version) => text.slice(text.indexOf(`CREATE FUNCTION platform.staff_requests_queue_v${version}(`), text.indexOf(`REVOKE ALL ON FUNCTION platform.staff_requests_queue_v${version}`));
  for (const gate of [
    "platform_private.staff_has_permission(actor.organization_id,actor.membership_id,'lead.read')",
    "PERFORM private.staff_sales_lead_page(1);",
    "platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.read','lead',l.id)",
    "platform_private.sales_lead_handoffs(actor.organization_id,",
    "platform_private.student_application_staff_org()",
  ]) {
    assert.ok(body(v2, 2).includes(gate) && body(sql, 3).includes(gate), gate);
  }
  assert.match(read("scripts/test-runners/test-postgres-authorization.sh"), /\*_platform_telephony_unknown_leads\.sql[\s\S]*platform_telephony_unknown_leads\.sql/u);
});

test("«Звонки»: the tab, its number and its rows exist only when the read carries phone calls; «Все» adds them; an old link says so in words", () => {
  // Телефония включена: вкладка с числом, строки с источником «Звонок», «Взять себе» как у любого лида.
  assert.deepEqual(tabs(surfaces.get("calls")), ["Все 12", "Сайт 4", "WhatsApp 1", "Звонки 3", "Анкеты 2", "Консультации 2"]);
  assert.deepEqual(tabs(surfaces.get("calls-waiting")), ["Все 6", "Сайт 2", "WhatsApp 0", "Звонки 2", "Анкеты 1", "Консультации 1"]);
  const waiting = main(surfaces.get("calls-waiting"));
  assert.equal(tableRows(waiting), 2, "only the two unowned calls wait");
  assert.equal(count(waiting, />Взять себе</gu), 4, "a button in the table row and in the phone card, for each of the two");
  // The database names a lead made by an unknown number «Звонок …»; the column already says «Звонок», so the row says «Номер …» (short: the digits that tell leads apart must stay on a 390 px line).
  assert.match(waiting, /Номер ••••4521/u);
  assert.doesNotMatch(waiting, />Звонок ••••/u);
  // «Взять себе» speaks the same name (its accessible name, and the receipt line after taking, come from one prop).
  assert.match(waiting, /aria-label="Взять себе: Номер ••••4521"/u);
  assert.doesNotMatch(waiting, /aria-label="Взять себе: Звонок/u);
  const nextSources = ["requests-next-rows.tsx", "RequestSheetBody.tsx"].map((file) => read(`src/components/v3/requests-next/${file}`)).join("\n");
  assert.match(nextSources, /personName=\{requestDisplayName\(row\)\}/u, "the row button");
  assert.match(nextSources, /const name = requestDisplayName\(row\)/u, "the panel button speaks the same name");
  assert.doesNotMatch(nextSources, /personName=\{row\.personName\}/u);
  // The page reads the dial options together with the queue, not as a second wait on every visit.
  assert.match(read("src/app/(v3)/v3/requests/page.tsx"), /const \[read, owners, dial\] = await Promise\.all\(\[[\s\S]*?readDialOptions\(actor\),\s*\]\);/u);
  assert.doesNotMatch(read("src/app/(v3)/v3/requests/page.tsx"), /const dial = await readDialOptions/u);
  assert.equal(requestsHref(parseRequestSelection({ source: "phone_call" }), "lead:ffffffff-2222-4222-8222-000000000001"), "/v3/requests?source=phone_call&open=lead%3Affffffff-2222-4222-8222-000000000001", "«Открыть» keeps the tab in the address");
  assert.equal(count(waiting, />Звонок</gu) >= 2, true, "the source column says «Звонок»");
  const all = main(surfaces.get("calls"));
  assert.equal(tableRows(all), 12);
  assert.match(all, /Номер ••••7788/u);
  // A name staff already changed stays as it is, and only phone calls are renamed.
  assert.equal(requestDisplayName({ source: "phone_call", personName: "Звонок +996 ••• 00 02 01" }), "Номер +996 ••• 00 02 01");
  assert.equal(requestDisplayName({ source: "phone_call", personName: "Звонок ••••4521" }), "Номер ••••4521", "the number without a country code has the shorter mask");
  assert.equal(requestDisplayName({ source: "phone_call", personName: "Новый Клиент" }), "Новый Клиент");
  assert.equal(requestDisplayName({ source: "phone_call", personName: "Звонок родителей" }), "Звонок родителей", "only the name the database wrote («Звонок» + the mask) is renamed, not any name that begins with the word");
  assert.equal(requestDisplayName({ source: "phone_call", personName: "Звонок +996 ••• 00 02 01 Айгерим" }), "Звонок +996 ••• 00 02 01 Айгерим");
  assert.equal(requestDisplayName({ source: "website", personName: "Звонок консультанту" }), "Звонок консультанту");
  // The small line of a call row is made of pieces («Звонок», the outcome, «когда»): a separator never hangs at the end of a wrapped line.
  const dialled = main(surfaces.get("calls-dial"));
  assert.equal(count(dialled, /data-testid="requests-call-outcome"/gu), 4, "two of the three rows are unowned and wait; each carries the outcome of its newest call (table row and phone card)");
  assert.match(dialled, /data-testid="requests-call-outcome">Пропущен</u, "the newest call's outcome");
  assert.doesNotMatch(dialled, /<span aria-hidden="true">·<\/span>/u, "no loose «·» spans between the pieces");
  assert.equal(count(dialled, /data-testid="v3-dial-button"/gu) >= 2, true, "«Позвонить» sits by the pieces' row");
  // Телефония выключена: звонки есть в базе, но ни вкладки, ни строк, ни числа; «Все» — как раньше.
  assert.deepEqual(tabs(surfaces.get("calls-hidden")), ["Все 9", "Сайт 4", "WhatsApp 1", "Анкеты 2", "Консультации 2"]);
  assert.equal(tableRows(main(surfaces.get("calls-hidden"))), 9);
  assert.doesNotMatch(main(surfaces.get("calls-hidden")), /Звонок ••••|Номер ••••/u);
  // Устаревшая ссылка на «Звонки»: вкладка остаётся (выбранная), числа нет, слова вместо «пусто».
  const link = main(surfaces.get("calls-off-link"));
  assert.deepEqual(tabs(surfaces.get("calls-off-link")), ["Все 4", "Сайт 2", "WhatsApp 0", "Звонки", "Анкеты 1", "Консультации 1"]);
  assert.match(link, /Звонки пока не подключены\./u);
  assert.equal(tableRows(link), 0);
  // Чистые функции представления: без чтения «Звонков» нет; пустая очередь не обещает звонков, пока они выключены.
  const selection = parseRequestSelection({ source: "website" });
  assert.deepEqual(requestTabs(selection, null).map((tab) => tab.key), ["all", "website", "whatsapp", "platform_application", "portal_consultation"]);
  const queue = (phoneCalls) => ({
    rows: [], states: { lead: "ready", application: "ready", consultation: "ready" }, phoneCalls,
    counts: { website: 0, whatsapp: 0, phone_call: phoneCalls ? 0 : null, application: 0, consultation: 0 }, latestAt: null, nextCursor: null, previousCursor: null,
  });
  assert.match(requestEmptyWhat(queue(true), "all"), /звонки с неизвестных номеров/u);
  assert.doesNotMatch(requestEmptyWhat(queue(false), "all"), /звонки/u);
  assert.match(requestEmptyWhat(queue(true), "phone_call"), /звонки с неизвестных номеров/u);
  assert.deepEqual(requestTabs(parseRequestSelection({ source: "phone_call" }), queue(false)).map((tab) => tab.key),
    ["all", "website", "whatsapp", "phone_call", "platform_application", "portal_consultation"]);
  assert.deepEqual(requestTabs(selection, queue(true)).map((tab) => tab.key),
    ["all", "website", "whatsapp", "phone_call", "platform_application", "portal_consultation"]);
  assert.deepEqual(requestTabs(selection, queue(false)).map((tab) => tab.key),
    ["all", "website", "whatsapp", "platform_application", "portal_consultation"]);
  // «Сегодня» не меняется: неразобранный лид по звонку по-прежнему открывается панелью доски (его вкладка бывает выключена);
  // это держит тест выше «website and WhatsApp requests open «Заявки», other unowned leads keep the board panel».
});
