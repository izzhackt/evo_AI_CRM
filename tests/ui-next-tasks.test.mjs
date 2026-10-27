// «Новый вид», экран «Задачи» (решение владельца 27.10.2026): таблица задач и панель задачи из набора виджетов.
// Данные — синтетические. Вёрстку, адаптив, фокус, «Отменить», панель и доступность на деле меряет
// tests/e2e/tasks-next-static-render.cjs (Chromium); здесь — правила, которые не зависят от браузера: чистые модели строк,
// меню фильтров, данные панели, СТРАНИЦА `/v3/tasks` целиком (настоящий файл, границы сервера подменены) в четырёх режимах
// переключателя и границы файлов. Прежний вид проверяют tests/v3-tasks-queue.test.mjs и tests/v3-tasks-unified.test.mjs
// (разметка списка и панели байт в байт) и сравнение страницы с её прежним файлом (см. отчёт).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { buildTaskQueue, parseTaskQueueFilters } from "../src/lib/v3/task-queue.ts";
import { caseSheetData, staffSheetData } from "../src/components/v3/tasks/next/task-sheet-data.ts";
import { taskFilterBar } from "../src/components/v3/tasks/next/task-filter-menus.ts";
import { exceptionWord, sameTaskRows, taskRows } from "../src/components/v3/tasks/next/task-table-model.ts";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NEXT_DIR = "src/components/v3/tasks/next";

/** Границы сервера и браузера подменяются по ИМЕНИ ФАЙЛА (а не по тому, как его назвали при импорте); остальное — настоящий код. */
function loader(stubs = {}) {
  const cache = new Map();
  const files = (base) => [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`, `${base}/index.tsx`];
  const resolveFile = (base) => files(base).find((file) => existsSync(new URL(`../${file}`, import.meta.url)) && /\.tsx?$/.test(file));
  function load(path) {
    if (path in stubs) return stubs[path];
    if (cache.has(path)) return cache.get(path).exports;
    const code = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const compiled = { exports: {} };
    cache.set(path, compiled);
    new Function("require", "module", "exports", code)((id) => {
      if (id in stubs) return stubs[id];
      if (id === "server-only") return {};
      if (id.endsWith(".css")) return {};
      if (id.endsWith(".json") && id.startsWith(".")) return JSON.parse(read(join(dirname(path), id)));
      const file = id.startsWith("@/") ? resolveFile(join("src", id.slice(2))) : id.startsWith(".") ? resolveFile(join(dirname(path), id)) : null;
      if (file) return file in stubs ? stubs[file] : load(file);
      if (id.startsWith("@/") || id.startsWith(".")) assert.fail(`${path}: ${id}`);
      return require(id);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

const link = { __esModule: true, default: ({ href, children, ...props }) => {
  for (const key of ["scroll", "prefetch", "replace", "onNavigate"]) delete props[key];
  return createElement("a", { href, ...props }, children);
} };
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const navigation = { useRouter: () => router, usePathname: () => "/v3/tasks", useSearchParams: () => new URLSearchParams(), notFound: () => { throw new Error("NEXT_NOT_FOUND"); } };
const serverActions = new Proxy({}, { get: (_target, name) => (name === "__esModule" ? false : async () => ({ status: "unavailable" })) });
const browserStubs = { "next/link": link, "next/navigation": navigation, "next/image": { __esModule: true, default: () => null } };

/* ---------------------------------------------------------------- данные */

const NOW = new Date("2026-09-24T04:00:00.000Z");
const DAY = "2026-09-24";
const ORG = "10000000-0000-4000-8000-000000000001";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const OTHER = "aaaaaaaa-1111-4111-8111-000000000002";
const NAMES = { [ME]: "Айгүл Осмонова", [OTHER]: "Эрмек Токтосунов" };
const sid = (n) => `bbbbbbbb-5555-4555-8555-${String(n).padStart(12, "0")}`;
const cid = (n) => `cccccccc-6666-4666-8666-${String(n).padStart(12, "0")}`;

const staffTask = (n, fields = {}) => ({
  id: sid(n), organizationId: ORG, creatorMembershipId: fields.creator ?? ME, creatorDisplayName: NAMES[fields.creator ?? ME],
  assigneeMembershipId: fields.assignee ?? ME, assigneeDisplayName: NAMES[fields.assignee ?? ME], title: fields.title ?? `Рабочая задача ${n}`,
  description: null, status: fields.status ?? "open", priority: "normal", dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, version: "3",
  sourceMessageId: fields.fromChat ? sid(90 + n) : null, createdAt: "2026-09-20T05:00:00.000Z", updatedAt: "2026-09-23T05:00:00.000Z",
});
const caseRow = (n, fields = {}) => ({
  sortAt: "9999-12-31T00:00:00+00:00", organizationId: ORG, caseTaskId: cid(n), version: "5", studentCaseId: `dddddddd-2222-4222-8222-${String(n).padStart(12, "0")}`,
  studentDisplayName: fields.student ?? `Студент Синтетический ${n}`, caseState: fields.caseState ?? "active", taskType: "follow_up", title: fields.title ?? `Задача по студенту ${n}`,
  status: fields.status ?? "open", priority: "normal", dueOn: fields.dueOn ?? null, dueAt: null, studentVisible: false,
  assigneeMembershipId: fields.assignee ?? ME, assigneeDisplayName: NAMES[fields.assignee ?? ME], createdAt: "2026-09-18T05:00:00.000Z", updatedAt: "2026-09-22T05:00:00.000Z",
});

const STAFF = [
  staffTask(1, { title: "Отправить пакет партнёру", dueOn: "2026-09-22", fromChat: true }),
  staffTask(2, { title: "Согласовать шаблон письма", dueAt: "2026-09-24T09:00:00.000Z" }),
  staffTask(3, { title: "Проверить договор", dueOn: "2026-09-21", assignee: OTHER }),
  staffTask(4, { title: "Памятка по нострификации", dueOn: "2026-09-27", status: "blocked" }),
  staffTask(5, { title: "Без срока" }),
  staffTask(6, { title: "Закрытая задача", status: "done", dueOn: "2026-09-19" }),
];
const CASES = [
  caseRow(1, { title: "Подтвердить подачу", student: "Тимур Абдылдаев", dueOn: "2026-09-20" }),
  caseRow(2, { title: "Перевести паспорт", student: "Санжар Алиев", dueOn: "2026-09-24" }),
  caseRow(3, { title: "Дело закрыто", student: "Алина Ким", caseState: "closed", dueOn: "2026-09-25" }),
];
const queueFor = (search, { complete = true } = {}) => {
  const params = new URLSearchParams(search);
  const filters = parseTaskQueueFilters((key) => params.get(key) ?? undefined, { teamView: true });
  return { filters, queue: buildTaskQueue({ staff: STAFF, cases: CASES, filters, actorMembershipId: ME, now: NOW, complete }) };
};

/* ---------------------------------------------------------------- чистые модели */

test("строки таблицы: те же задачи и порядок, что у очереди; срок для сортировки; поиск по названию, студенту, клиенту и исполнителю", () => {
  const { queue } = queueFor("view=all");
  const bands = queue.bands.map((band) => ({ key: band.bucket, label: band.bucket, count: band.rows.length, danger: band.bucket === "overdue", rows: band.rows }));
  const lead = { leadId: "ffffffff-7777-4777-8777-000000000001", name: "Айдар Условный", href: "/v3/profile?id=x" };
  const rows = taskRows(bands, { [`staff:${sid(2)}`]: lead });
  assert.deepEqual(rows.map((row) => row.key), queue.bands.flatMap((band) => band.rows.map((task) => task.key)), "порядок очереди не меняется");
  assert.equal(rows.length, queue.rows.length);
  const callback = rows.find((row) => row.key === `staff:${sid(2)}`);
  assert.equal(callback.lead, lead);
  assert.match(callback.search, /Согласовать шаблон письма.*Айдар Условный.*Айгүл Осмонова/u);
  const student = rows.find((row) => row.key === `case:${cid(1)}`);
  assert.match(student.search, /Подтвердить подачу.*Тимур Абдылдаев/u);
  const sorted = [...rows].sort((a, b) => a.dueSort - b.dueSort).map((row) => row.key);
  assert.equal(sorted.at(-1), `staff:${sid(5)}`, "без срока — в конце");
  assert.ok(rows.find((row) => row.key === `case:${cid(1)}`).dueSort < rows.find((row) => row.key === `case:${cid(2)}`).dueSort);
  assert.equal(taskRows([], null).length, 0);
});

test("sameTaskRows: тот же набор (ключ, версия, клиент) — тот же массив для таблицы, иначе страница сбросилась бы при каждом обновлении", () => {
  const { queue } = queueFor("");
  const bands = [{ key: "all", label: "x", count: null, danger: false, rows: queue.rows }];
  const first = taskRows(bands, null);
  assert.equal(sameTaskRows(first, taskRows(bands, null)), true);
  assert.equal(sameTaskRows(first, first.slice(1)), false, "строка ушла");
  assert.equal(sameTaskRows(first, [...first].reverse()), false, "порядок изменился");
  const bumped = taskRows([{ ...bands[0], rows: queue.rows.map((task, index) => (index === 0 ? { ...task, version: "4" } : task)) }], null);
  assert.equal(sameTaskRows(first, bumped), false, "версия задачи изменилась");
});

test("слово-исключение строки: заблокирована и отменена всегда, завершённая — только в открытом виде (как у прежней строки)", () => {
  assert.equal(exceptionWord({ status: "blocked" }, true), "blocked");
  assert.equal(exceptionWord({ status: "cancelled" }, false), "cancelled");
  assert.equal(exceptionWord({ status: "done" }, true), "done");
  assert.equal(exceptionWord({ status: "done" }, false), null, "в «Завершённых» состояние говорит кружок");
  assert.equal(exceptionWord({ status: "open" }, true), null);
  assert.equal(exceptionWord({ status: "in_progress" }, true), null);
});

const href = (search) => `/v3/tasks${search ? `?${search}` : ""}`;
const filtersOf = (search) => queueFor(search).filters;

test("меню фильтров: те же «Срок», «Тип», «Состояние» и те же адреса, что у прежней строки инструментов; вид и поиск сохраняются", () => {
  const bar = taskFilterBar(filtersOf(""), { canReadStaffTasks: true, canReadCaseTasks: true });
  assert.deepEqual(bar.menus.map((menu) => menu.key), ["due", "type", "state"]);
  const due = bar.menus[0];
  assert.deepEqual(due.options.map((option) => [option.label, option.href]), [
    ["Любой срок", href("")], ["Просрочено", href("due=overdue")], ["Сегодня", href("due=today")], ["Завтра", href("due=tomorrow")],
    ["На этой неделе", href("due=week")], ["Позже", href("due=later")], ["Без срока", href("due=none")],
  ]);
  assert.equal(due.valueLabel, null);
  assert.deepEqual(bar.menus[1].options.map((option) => option.href), [href(""), href("type=case"), href("type=staff")]);
  assert.deepEqual(bar.menus[2].options.map((option) => [option.label, option.href]), [["Открытые", href("")], ["Завершённые", href("status=done")]]);
  assert.equal(bar.menus[2].valueLabel, "Открытые");
  assert.equal(bar.query, null);
  assert.equal(bar.resetHref, null, "ничего не выбрано — сбрасывать нечего");

  const team = taskFilterBar(filtersOf("view=all&type=case&due=overdue&q=Тимур&window=2"), { canReadStaffTasks: true, canReadCaseTasks: true });
  assert.equal(team.menus[0].valueLabel, "Просрочено");
  assert.equal(team.menus[1].valueLabel, "По студентам");
  assert.ok(team.menus[0].options.every((option) => option.href.includes("view=all") && option.href.includes("window=2") && option.href.includes("q=%D0%A2")), "вид, окно чтения и поиск остаются в адресах");
  assert.equal(team.menus[0].options[0].href, href("view=all&type=case&q=%D0%A2%D0%B8%D0%BC%D1%83%D1%80&window=2"));
  assert.deepEqual(team.query, { text: "Тимур", clearHref: href("view=all&type=case&due=overdue&window=2") });
  assert.equal(team.resetHref, href("view=all"), "«Сбросить» убирает фильтры и поиск, но остаётся в том же виде");

  const done = taskFilterBar(filtersOf("status=done"), { canReadStaffTasks: true, canReadCaseTasks: true });
  assert.deepEqual(done.menus.map((menu) => menu.key), ["type", "state"], "срок у завершённых не применяется — меню «Срок» нет");
  assert.equal(done.menus[1].valueLabel, "Завершённые");
  assert.equal(done.resetHref, href(""));
  assert.equal(done.menus[1].options[0].href, href(""), "«Открытые» снимает status");
  assert.equal(taskFilterBar(filtersOf("due=today"), { canReadStaffTasks: true, canReadCaseTasks: true }).menus[2].options[1].href, href("status=done"), "«Завершённые» заодно снимает срок");

  const staffOnly = taskFilterBar(filtersOf(""), { canReadStaffTasks: true, canReadCaseTasks: false });
  assert.deepEqual(staffOnly.menus.map((menu) => menu.key), ["due", "state"], "«Тип» только когда читаются оба вида");
});

test("данные панели задачи: ключ как у прежней панели, «нет данных» честно, лид и обсуждение — только когда они есть", () => {
  const task = STAFF[0];
  const participants = [{ membershipId: ME, displayName: NAMES[ME], role: "admissions" }];
  const base = { task, participants, day: DAY, nowIso: NOW.toISOString(), leadId: null, lead: null, sourceHref: null, sourceUnavailable: false, outcomes: [] };
  const plain = staffSheetData(base);
  assert.equal(plain.key, `staff:${task.id}`);
  assert.equal(plain.kind, "staff");
  assert.deepEqual(plain.extra, { leadHref: null, lead: null, sourceHref: null, sourceUnavailable: false, outcomes: [], outcomesUnavailable: false });

  const linked = staffSheetData({ ...base, leadId: "ffffffff-7777-4777-8777-000000000001", lead: { leadId: "ffffffff-7777-4777-8777-000000000001", name: "Айдар", href: "/v3/profile?id=x", mapped: true },
    sourceHref: "/v3/team-chat?channel=sales&message=m", outcomes: [{ requestId: "r", note: "готово", author: "Эрмек", createdAt: "2026-09-22T09:15:00.000Z" }] });
  assert.equal(linked.extra.leadHref, "/v3/tasks?lead=ffffffff-7777-4777-8777-000000000001");
  assert.equal(linked.extra.sourceHref, "/v3/team-chat?channel=sales&message=m");
  assert.equal(linked.extra.outcomes.length, 1);

  const failed = staffSheetData({ ...base, outcomes: null });
  assert.equal(failed.extra.outcomesUnavailable, true, "чтение связи и результатов не удалось — сказано об этом, а не «результатов нет»");
  assert.deepEqual(failed.extra.outcomes, []);
  // «Обсуждение недоступно» — только у задачи из чата, у которой не удалось прочитать ссылку.
  assert.equal(staffSheetData({ ...base, sourceUnavailable: true }).extra.sourceUnavailable, true, "задача из чата без ссылки");
  assert.equal(staffSheetData({ ...base, task: STAFF[1], sourceUnavailable: true }).extra.sourceUnavailable, false, "задача не из чата");
  assert.equal(staffSheetData({ ...base, sourceHref: "/v3/team-chat?x=1", sourceUnavailable: true }).extra.sourceUnavailable, false, "ссылка есть");

  const row = CASES[0];
  const caseTask = { kind: "case", key: `case:${row.caseTaskId}`, id: row.caseTaskId, studentCaseId: row.studentCaseId, taskType: "follow_up", title: row.title, details: null, dueOn: row.dueOn, dueAt: null,
    day: row.dueOn, minutes: null, overdue: false, state: "open", cancelReason: null, person: row.studentDisplayName, priority: "normal", studentVisible: false,
    assigneeMembershipId: ME, assigneeDisplayName: NAMES[ME], caseState: "active", version: row.version };
  const forCase = caseSheetData({ task: caseTask, caseId: row.studentCaseId, assignees: [], capabilities: { taskId: row.caseTaskId, studentCaseId: row.studentCaseId, canAssign: false, canChangeVisibility: false, canReadCase: true }, day: DAY, nowIso: NOW.toISOString() });
  assert.equal(forCase.key, `case:${row.caseTaskId}`);
  assert.equal(forCase.kind, "case");
  assert.equal(forCase.caseId, row.studentCaseId);
});

/* ---------------------------------------------------------------- вид: список, лид, сообщение, пустота, право */

const actorOf = (over = {}) => ({
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002", membershipId: ME, organizationId: ORG,
  systemRole: "admin", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: [], displayName: "Администратор Синтетический", email: "x@example.invalid", ...over,
});
const PERMISSIONS = { actorMembershipId: ME, admin: true, preview: false, staffComplete: true, staffEdit: true, caseManage: true, caseAssign: true };
const composer = { participants: [], actorMembershipId: ME, actor: actorOf(), day: DAY, staffAllowed: true, caseAllowed: true, initialCase: null, initialCaseAssignees: [] };

function nextProps(search, over = {}) {
  const { filters, queue } = queueFor(search, { complete: over.complete ?? true });
  return {
    filters, queue, cutOff: [], day: DAY, nowIso: NOW.toISOString(), canReadStaffTasks: true, canReadCaseTasks: true, teamView: true, createdExcludesCases: false,
    composer, composerKey: "standalone", canCreate: true, urlIntent: null, permissions: PERMISSIONS, taskLeads: null, dial: null, count: null,
    sheet: null, closeHref: "/v3/tasks", moveOpen: false, sourceMessage: null, sourceLead: null, leadTasks: null, ...over,
  };
}
const renderNext = (props) => {
  const { TasksNext } = loader({ ...browserStubs, "src/lib/platform-staff-task-actions.ts": serverActions, "src/lib/platform-admissions-task-actions.ts": serverActions,
    "src/lib/v3/task-case-actions.ts": serverActions, "src/lib/v3/task-composer-actions.ts": serverActions })("src/components/v3/tasks/next/TasksNext.tsx");
  return renderToStaticMarkup(createElement(TasksNext, props));
};

test("список: заголовок «Задачи» с «?» и красной «Новая задача», вкладки-ссылки видов, таблица с прежним порядком и три колонки; никаких пояснений на экране", () => {
  const html = renderNext(nextProps("view=all"));
  assert.match(html, /data-testid="v3-tasks-next"/);
  assert.match(html, /<h1 class="t-page-title text-fg">Задачи/);
  assert.match(html, /aria-label="Пояснение: Задачи"/);
  assert.match(html, /<button[^>]*aria-haspopup="dialog"[^>]*>Новая задача<\/button>/);
  assert.match(html, /aria-label="Чьи задачи"/);
  assert.match(html, /<a[^>]*href="\/v3\/tasks\?view=all"[^>]*aria-current="page"[^>]*>Вся команда/);
  assert.match(html, /href="\/v3\/tasks"[^>]*>Мои/);
  assert.match(html, /href="\/v3\/tasks\?view=created"[^>]*>Поставил я/);
  assert.match(html, /role="region" aria-label="Задачи"/);
  for (const header of ["Задача", "Срок", "Исполнитель"]) assert.match(html, new RegExp(`>${header}<`));
  // строки — в порядке очереди: просроченные, сегодняшние, дальше
  const titles = [...html.matchAll(/data-queue-open="" title="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(titles.slice(0, 3), ["Подтвердить подачу", "Проверить договор", "Отправить пакет партнёру"], "первыми — просроченные по сроку");
  assert.equal(new Set(titles).size, queueFor("view=all").queue.rows.length, "каждая открытая задача очереди — одна строка (таблица и карточки телефона рисуют одно и то же)");
  assert.equal(titles.length, 2 * queueFor("view=all").queue.rows.length, "таблица и список карточек");
  // право завершать: рабочая — круг на месте, по студенту — «с результатом»
  assert.match(html, /aria-label="Завершить: Согласовать шаблон письма"/);
  assert.match(html, /aria-label="Завершить с результатом: Перевести паспорт"/);
  assert.match(html, /aria-label="Действия: Согласовать шаблон письма"/);
  // сроки словами, слово-исключение чипом, закрытое дело
  assert.match(html, /прошёл 4 дн/);
  assert.match(html, /заблокирована/);
  assert.match(html, /дело закрыто/);
  assert.match(html, /из чата/);
  assert.match(html, /<a href="\/v3\/profile\?case=/, "имя студента — ссылка на дело");
  // пояснения прежнего экрана уехали за «?»: на экране их нет
  for (const gone of ["Здесь только рабочие задачи", "Рабочие задачи и задачи по студентам — одним списком", "Новая задача…"]) assert.ok(!html.includes(gone), gone);
});

test("честные числа: неполное чтение скрывает числа вкладок и говорит об этом; полное — числа; число в заголовке — только когда его дали", () => {
  const complete = renderNext(nextProps("", { count: null }));
  assert.match(complete, />Мои<\/a>|>Мои<span[^>]*>\d+<\/span>/);
  assert.match(complete, /tabular-nums[^>]*>\d+</, "число вкладки «Мои» по данным");
  const partial = renderNext(nextProps("", { complete: false }));
  assert.match(partial, /Показаны не все задачи, числа скрыты\./);
  assert.doesNotMatch(partial, /tabular-nums text-fg-3">\d+<\/span><\/a>/, "у вкладок чисел нет");
  assert.match(partial, /Показать больше задач/);
  assert.match(renderNext(nextProps("", { count: 7 })), /<h1[^>]*>Задачи<span[^>]*>7<\/span>/);
  assert.doesNotMatch(renderNext(nextProps("", { count: null })), /<h1[^>]*>Задачи<span/);
});

test("пустота и права: пустой список называет, что пусто, и даёт одно действие; без права читать — так и сказано; ошибка чтения остаётся на виду", () => {
  const { filters } = queueFor("due=today&type=staff");
  const empty = renderNext(nextProps("due=today&type=staff", { queue: buildTaskQueue({ staff: [], cases: [], filters, actorMembershipId: ME, now: NOW, complete: true }) }));
  assert.match(empty, /На сегодня задач нет/);
  assert.match(empty, /<a[^>]*href="\/v3\/tasks\?type=staff"[^>]*>Показать все открытые/);
  assert.match(empty, /Сбросить/, "выбран срок и тип — есть «Сбросить»");
  const none = renderNext(nextProps("", { canReadStaffTasks: false, canReadCaseTasks: false, teamView: false }));
  assert.match(none, /В вашей роли нет права на просмотр задач\./);
  assert.match(none, /Новую задачу можно создать кнопкой выше\./);
  assert.doesNotMatch(none, /role="region" aria-label="Задачи"|aria-label="Чьи задачи"/, "таблицы и вкладок нет");
  const noCreate = renderNext(nextProps("", { canReadStaffTasks: false, canReadCaseTasks: false, teamView: false, canCreate: false }));
  assert.doesNotMatch(noCreate, /Новая задача<|Новую задачу можно/);
  const { TasksNextFailure } = loader(browserStubs)("src/components/v3/tasks/next/TasksNextFailure.tsx");
  const failure = renderToStaticMarkup(createElement(TasksNextFailure, { text: "Не удалось загрузить задачи и доступных сотрудников.", retryHref: "/v3/tasks?view=all" }));
  assert.match(failure, /role="alert"[^>]*data-testid="queue-error"/);
  assert.match(failure, /text-danger[^>]*>Не удалось загрузить задачи/);
  assert.match(failure, /<a[^>]*href="\/v3\/tasks\?view=all"[^>]*>Повторить/);
});

test("«Задачи по лиду» и «Задача из сообщения»: те же данные, что у прежних блоков; кнопка «Новая задача по лиду» — только если диалог может открыться", () => {
  const lead = { leadId: "ffffffff-7777-4777-8777-000000000001", clientDisplayName: "Айдар Условный", nextActionText: null, nextActionDueDate: "2026-09-28", canOpenPipeline: true };
  const leadTasks = { rows: [{ id: sid(21), title: "Перезвонить клиенту", status: "open" }, { id: sid(22), title: "Перезвонить клиенту: недозвон", status: "blocked" }], truncated: true };
  const html = renderNext(nextProps("lead=x", { sourceLead: lead, leadTasks }));
  assert.match(html, /<h2[^>]*>Айдар Условный<\/h2>/);
  assert.match(html, /Следующее действие воронки[\s\S]*Не назначено/);
  assert.match(html, /2026-09-28/);
  assert.match(html, /href="\/v3\/pipeline\?q=%D0%90%D0%B9%D0%B4%D0%B0%D1%80[^"]*"[^>]*>Открыть в воронке/);
  assert.match(html, /<h2[^>]*>Связанные рабочие задачи<\/h2>/);
  assert.match(html, /href="\/v3\/tasks\?task=bbbbbbbb-5555-4555-8555-000000000021"/);
  assert.match(html, /Показаны последние 50\./);
  assert.match(html, /href="\/v3\/tasks"[^>]*>Все мои задачи/);
  assert.match(html, />Новая задача по лиду<\/button>/);
  assert.doesNotMatch(html, /role="region" aria-label="Задачи"/, "на странице лида списка нет");
  const unknown = renderNext(nextProps("lead=x", { sourceLead: { ...lead, clientDisplayName: "Имя клиента не указано", canOpenPipeline: false }, leadTasks: { rows: [], truncated: false } }));
  assert.match(unknown, /Связанных задач нет\./);
  assert.doesNotMatch(unknown, /Открыть в воронке/);
  const closedComposer = renderNext(nextProps("lead=x", { sourceLead: lead, leadTasks, composer: { ...composer, staffAllowed: false, caseAllowed: false } }));
  assert.doesNotMatch(closedComposer, /Новая задача по лиду/, "диалог молчит без права — и кнопки нет");
  const preview = renderNext(nextProps("lead=x", { sourceLead: lead, leadTasks, composer: { ...composer, actor: actorOf({ presentationRole: "sales" }) } }));
  assert.doesNotMatch(preview, /Новая задача по лиду/, "в просмотре роли создавать нельзя");

  const message = renderNext(nextProps("", { sourceMessage: { id: "11111111-2222-4222-8222-000000000001", channelKey: "sales", authorName: "Эрмек Токтосунов", body: "Нужно собрать копии аттестата." } }));
  assert.match(message, /<h2[^>]*>Задача из сообщения · Эрмек Токтосунов<\/h2>/);
  assert.match(message, /Нужно собрать копии аттестата\./);
  assert.match(message, /href="\/v3\/team-chat\?channel=sales&amp;message=11111111-2222-4222-8222-000000000001"[^>]*>Вернуться к сообщению/);
  assert.ok(!message.includes("Доступ к каналу не меняется"), "пояснение — за «?»");
});

/* ---------------------------------------------------------------- страница целиком: переключатель */

const page = (cookie, who, params = {}, overrides = {}) => {
  const seen = { guards: [], reads: 0 };
  const workspace = {
    canReadStaffTasks: true, canReadCaseTasks: true, canReadCases: true, createdExcludesCases: false, assignees: [{ membershipId: ME, displayName: NAMES[ME], role: "admissions" }],
    caseAssignees: [], selectedTask: null, selectedCase: null, queue: { staff: STAFF, cases: CASES, cutOff: [], complete: true },
  };
  const stubs = {
    ...browserStubs,
    "next/headers": { cookies: async () => ({ get: (name) => (name === "evo_ui" && cookie !== undefined ? { name, value: cookie } : undefined) }) },
    "src/lib/platform-guards.ts": { requireV3PageActor: async (route) => { seen.guards.push(route); return who; } },
    "src/lib/v3/staff-task-source.ts": { taskQueueAccess: () => ({ teamView: true }), readStaffTaskWorkspace: async () => { seen.reads += 1; return workspace; } },
    "src/lib/v3/calendar-source.ts": { readCalendarTaskTarget: async () => { throw new Error("not used"); } },
    "src/lib/server/platform-team-chat-repository.ts": { readTeamChatPage: async () => { throw new Error("not used"); }, TeamChatReadError: class extends Error {} },
    "src/lib/server/platform-staff-task-repository.ts": { readStaffTaskContext: async () => { throw new Error("not used"); }, readStaffTaskLeadContext: async () => null, readLeadTaskLinks: async () => ({ rows: [], truncated: false }), readStaffTaskChatSource: async () => null },
    "src/lib/v3/telephony-dial-source.ts": { readDialOptions: async () => ({ status: "off" }) },
    "src/lib/v3/telephony-task-leads-source.ts": { readLeadRef: async () => null, readQueueTaskLeads: async () => ({}) },
    "src/lib/platform-staff-task-actions.ts": serverActions, "src/lib/platform-admissions-task-actions.ts": serverActions,
    "src/lib/v3/task-case-actions.ts": serverActions, "src/lib/v3/task-composer-actions.ts": serverActions, ...overrides,
  };
  const load = loader(stubs);
  const run = async () => renderToStaticMarkup(await load("src/app/(v3)/v3/tasks/page.tsx").default({ searchParams: Promise.resolve(params) }));
  return { run, seen };
};

const ADMIN = actorOf();
const STAFF_ACTOR = actorOf({ systemRole: "staff", permissionKeys: ["staff.task.read", "staff.task.create"] });
const PREVIEW_ACTOR = actorOf({ presentationRole: "sales" });

test("страница «Задачи»: «Новый вид» только настоящему администратору с переключателем; всем остальным — прежний вид и прежняя разметка", async () => {
  const on = await page("next", ADMIN).run();
  assert.match(on, /data-testid="v3-tasks-next"/);
  assert.match(on, /data-slot="data-table"/);
  assert.doesNotMatch(on, /data-testid="task-queue"/, "прежней очереди нет");

  const off = await page(undefined, ADMIN).run();
  assert.match(off, /data-testid="task-queue"/, "переключатель выключен — прежний вид");
  assert.doesNotMatch(off, /v3-tasks-next|data-slot="data-table"/);
  assert.match(off, /<h1 class="t-page-title[^>]*>Задачи/);
  assert.match(off, /data-queue-row=/);

  for (const [label, who] of [["сотрудник", STAFF_ACTOR], ["администратор в просмотре роли", PREVIEW_ACTOR]]) {
    for (const cookie of ["next", undefined]) {
      const html = await page(cookie, who).run();
      assert.match(html, /data-testid="task-queue"/, `${label}, cookie=${cookie}: прежний вид`);
      assert.doesNotMatch(html, /v3-tasks-next|data-slot="data-table"/, `${label}, cookie=${cookie}: нового вида нет`);
    }
  }
});

test("страница: данные читаются одним и тем же путём в обоих видах (маршрут, чтение очереди), а ошибка чтения называется в обоих", async () => {
  for (const cookie of ["next", undefined]) {
    const run = page(cookie, ADMIN);
    await run.run();
    assert.deepEqual(run.seen.guards, ["/v3/tasks"], `cookie=${cookie}: тот же маршрут`);
    assert.equal(run.seen.reads, 1, `cookie=${cookie}: одно чтение очереди`);
  }
  for (const cookie of ["next", undefined]) {
    const broken = page(cookie, ADMIN, {}, { "src/lib/v3/staff-task-source.ts": { taskQueueAccess: () => ({ teamView: true }), readStaffTaskWorkspace: async () => { throw new Error("db"); } } });
    const html = await broken.run();
    assert.match(html, /data-testid="queue-error"/, `cookie=${cookie}`);
    assert.match(html, /Не удалось загрузить задачи и доступных сотрудников\./);
    assert.match(html, /href="\/v3\/tasks"[^>]*>Повторить/);
    assert.equal(cookie === "next", /v3-tasks-next/.test(html), `cookie=${cookie}: рамка ошибки — своего вида`);
  }
});

test("страница: панель выбранной задачи читается теми же чтениями и попадает в новый вид; в прежнем — в прежнюю панель", async () => {
  const task = STAFF[1];
  const workspace = { canReadStaffTasks: true, canReadCaseTasks: true, canReadCases: true, createdExcludesCases: false, assignees: [{ membershipId: ME, displayName: NAMES[ME], role: "admissions" }], caseAssignees: [],
    selectedTask: task, selectedCase: null, queue: { staff: STAFF, cases: CASES, cutOff: [], complete: true } };
  const overrides = {
    "src/lib/v3/staff-task-source.ts": { taskQueueAccess: () => ({ teamView: true }), readStaffTaskWorkspace: async () => workspace },
    "src/lib/server/platform-staff-task-repository.ts": {
      readStaffTaskContext: async () => ({ leadId: null, outcomes: [{ requestId: "r1", note: "Готов черновик", author: "Эрмек", createdAt: "2026-09-22T09:15:00.000Z" }] }),
      readStaffTaskLeadContext: async () => null, readLeadTaskLinks: async () => ({ rows: [], truncated: false }), readStaffTaskChatSource: async () => null,
    },
  };
  const on = await page("next", ADMIN, { task: task.id }, overrides).run();
  assert.match(on, /data-testid="v3-tasks-next"/);
  const off = await page(undefined, ADMIN, { task: task.id }, overrides).run();
  assert.match(off, /data-testid="v3-task-detail-panel"/, "прежняя панель");
  assert.match(off, /Готов черновик/);
  assert.doesNotMatch(off, /data-slot="sheet/);
});

/* ---------------------------------------------------------------- границы файлов */

const nextFiles = () => readdirSync(new URL(`../${NEXT_DIR}`, import.meta.url)).map((name) => `${NEXT_DIR}/${name}`);

test("файлы нового вида «Задач»: каждый до 150 строк, без собственных серверных действий и без тёмной темы; команды — прежние", () => {
  const files = nextFiles();
  assert.ok(files.length >= 15);
  const commands = new Set();
  for (const file of files) {
    const source = read(file);
    assert.ok(source.split("\n").length <= 150, `${file}: ${source.split("\n").length} строк`);
    assert.doesNotMatch(source, /["']use server["']/, `${file}: серверных действий нет`);
    assert.doesNotMatch(source, /\bdark:/, `${file}: тёмной темы нет`);
    for (const match of source.matchAll(/import \{([^}]+)\} from "@\/lib\/[^"]*(?:-actions|actions)"/g)) for (const name of match[1].split(",")) commands.add(name.trim());
  }
  assert.deepEqual([...commands].sort(), ["changePlatformAdmissionsTaskAction", "mutateStaffTaskAction"], "только прежние команды: рабочая и по студенту");
  for (const file of ["tests/e2e/tasks-next-static-render.cjs"]) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)));
});

test("в странице прежний вид остаётся прежним текстом: чтения, права и разметка, на которые опираются остальные тесты, не тронуты", () => {
  const source = read("src/app/(v3)/v3/tasks/page.tsx");
  assert.match(source, /const nextUi = await isNextUi\(actor\);/);
  assert.match(source, /if \(nextUi\) \{/);
  assert.match(source, /<TasksWorkspace\s/);
  assert.match(source, /<TaskDetailPanel key=\{`staff:\$\{selected\.id\}`\}/);
  assert.match(source, /readCalendarTaskTarget\(actor, selectedCaseId, taskId\)/);
  assert.match(source, /<h2 className="t-section">\{callerDisplayName\(sourceLead\.clientDisplayName \?\? "Имя клиента не указано"\)\}<\/h2>/);
  // новый вид получает те же данные, что прежний: те же права строки и то же число в заголовке
  assert.match(source, /permissions=\{permissions\}/);
  assert.match(source, /count=\{headerCount\}/);
  assert.match(source, /staffAllowed = !preview && staffHasPermission\(actor, "staff\.task\.create"\) && !sourceLeadId;/);
});

test("новые копирайты: на экране только заголовки, данные и кнопки; пояснения собраны в «?», предупреждения остаются на виду", () => {
  const view = read(`${NEXT_DIR}/TasksNext.tsx`);
  assert.match(view, /help=\{<>/, "пояснение страницы — в «?» шапки");
  assert.match(view, /Показаны не все задачи, числа скрыты\./, "предупреждение о неполных числах на виду");
  assert.match(view, /В вашей роли нет права на просмотр задач\./);
  assert.match(read(`${NEXT_DIR}/TaskSourceCards.tsx`), /help="Проверьте название и исполнителя\. Доступ к каналу не меняется\."/);
  assert.match(read(`${NEXT_DIR}/TaskSheetBody.tsx`), /<HelpTip label="Пояснение: Позвонить">\{DIAL_TOUCH_HINT\}<\/HelpTip>/, "подсказка про набор — за «?»");
  assert.match(read(`${NEXT_DIR}/TaskSheetBody.tsx`), /Не удалось загрузить связь с лидом и результаты\. Обновите страницу\./, "ошибка чтения остаётся на виду");
  assert.match(read(`${NEXT_DIR}/TaskSheetBody.tsx`), /Обсуждение недоступно\./);
  assert.match(read(`${NEXT_DIR}/useTaskSheetCommands.ts`), /Напишите результат: без него задача по студенту не завершается\./);
  assert.match(read(`${NEXT_DIR}/useTaskQuickCommands.ts`), /Не удалось сохранить\. Повторите\./);
});
