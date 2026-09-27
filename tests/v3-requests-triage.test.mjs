import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseRequestSelection } from "../src/lib/requests-queue-contract.ts";
import { requestLatestLine, requestReceived, requestTabs, requestTriage } from "../src/lib/v3/requests-view.ts";
import { buildTodayQueue, todayRequestItems } from "../src/lib/v3/today-queue.ts";

/**
 * «Заявки» (Э3, 27.09.2026): очередь разбора с «Взять себе». Логика
 * представления проверяется напрямую, разметка — настоящей страницей в
 * AppShell с синтетическим ответом `staff_requests_queue_v2`
 * (tests/e2e/requests-static-render.cjs --json, отдельный node-процесс).
 * Права и строки на настоящем Postgres — набор 250
 * (supabase/tests/platform_requests_queue_triage.sql). Это не живая проверка
 * Supabase или данных EVO.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const render = (look) => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/requests-static-render.cjs", import.meta.url)), "--json", ...(look ? ["--look=next"] : [])],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const surfaces = render(false);
const next = render(true);
/** Содержимое страницы без оболочки: от `<main data-testid="v3-requests">` до конца main. */
const main = (html) => {
  const start = html.indexOf('data-testid="v3-requests"');
  assert.ok(start > 0, "the page renders its own main");
  return html.slice(html.lastIndexOf("<main", start), html.indexOf("</main>", start));
};
const count = (html, pattern) => [...html.matchAll(pattern)].length;
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
  // Разметка: два не взятых лида — две кнопки; без права (чтение без «take») и в просмотре роли — ни одной.
  assert.equal(count(main(surfaces.get("populated")), />Взять себе</gu), 2);
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
  assert.equal(count(html, /data-queue-row=/gu), 9);
  assert.match(html, new RegExp(`href="/v3/profile\\?id=${LEAD_1}&amp;returnTo=%2Fv3%2Frequests%3Fstatus%3Dall"`, "u"));
  assert.equal(count(html, /data-queue-open=""/gu), 9, "one open action per row");
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
  for (const [name, html] of [...surfaces, ...next]) {
    if (name === "preview") continue;
    assert.equal(count(main(html), /border-accent bg-accent/gu), 1, `${name}: one solid red`);
  }
  const empty = main(surfaces.get("empty"));
  assert.match(empty, /Новых заявок нет/u);
  assert.match(empty, /Сюда приходят заявки с сайта и из WhatsApp, анкеты поступающих и запросы консультаций из кабинета студента\./u);
  assert.match(empty, /Последняя пришла вчера в 19:05\./u);
  // Второй вход в ту же форму — тихий, а не второй красный.
  assert.equal(count(empty, /aria-controls="manual-lead-panel"/gu), 2);
  assert.equal(requestLatestLine(null, NOW), null);
  assert.equal(requestLatestLine("2026-09-24T08:10:00.000000Z", NOW), "Последняя пришла 24.09 в 14:10 (3 дн назад).");
  assert.match(main(surfaces.get("sales-empty")), /Последняя пришла 24\.09 в 16:00 \(3 дн назад\)\./u);
});

test("the right panel holds the full questionnaire and the existing decision, quiet and flat", () => {
  const html = main(surfaces.get("drawer"));
  const panel = html.slice(html.indexOf('data-testid="queue-detail-panel"'));
  assert.match(panel, /data-testid="requests-detail-panel"/u);
  assert.match(panel, /Заполнено поступающим/u);
  assert.match(panel, /Китай, Малайзия/u);
  assert.match(panel, /aria-label="Решение по заявке"/u);
  assert.match(panel, /Одобрить и открыть кабинет/u);
  assert.doesNotMatch(panel, /bg-accent/u, "the decision is quiet: the page's red stays in the header");
  assert.match(html, /aria-current="true"/u, "the open row is marked");
  const lead = main(surfaces.get("drawer-lead"));
  const leadPanel = lead.slice(lead.indexOf('data-testid="queue-detail-panel"'));
  assert.match(leadPanel, /Телефон<\/dt><dd[^>]*>\+996 555 000 101<\/dd><dt[^>]*>Почта<\/dt><dd[^>]*>elmira\.forma@example\.invalid/u);
  assert.match(leadPanel, /Взять себе/u);
  assert.match(leadPanel, /Открыть карточку лида/u);
});

test("«Сегодня»: website and WhatsApp requests open «Заявки», other unowned leads keep the board panel", () => {
  const lead = (n, source) => ({
    id: `ffffffff-2222-4222-8222-${String(n).padStart(12, "0")}`, name: `Лид ${n}`, stageKey: "new", source, nextAction: null, nextActionAt: null,
    due: "none", stageAgeDays: 0, latestNote: null, href: "",
    workflow: { leadId: `ffffffff-2222-4222-8222-${String(n).padStart(12, "0")}`, currentOwnerMembershipId: null, currentOwnerDisplayName: null,
      stageKey: "new", nextActionText: null, nextActionDueDate: null, workflowVersion: "1" },
  });
  const items = todayRequestItems([lead(1, "website"), lead(2, "whatsapp"), lead(3, "phone_call")]);
  assert.deepEqual(items.map((item) => item.openHref), [
    "/v3/requests?source=website", "/v3/requests?source=whatsapp", `/v3/pipeline?lead=${lead(3).id}`,
  ]);
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
  assert.match(read("src/lib/v3/requests-queue-source.ts"), /rpc\("staff_requests_queue_v2",/u);
  assert.match(read("scripts/test-postgres-authorization.sh"), /250_\*[\s\S]*platform_requests_queue_triage\.sql/u);
});
