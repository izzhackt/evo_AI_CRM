// Э7 плана редизайна (27.09.2026): один способ создать задачу, массовые
// действия, Ctrl+K и окно «?». Настоящие компоненты и чистые модули со
// СИНТЕТИЧЕСКИМИ данными: серверные действия заменены записывающими
// заглушками, базы и Auth здесь нет. Браузерная проверка (фокус, клавиши,
// частичный отказ в окне) — tests/e2e/e7-static-render.cjs --screenshots.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as access from "../src/lib/platform-access.ts";
import * as taskContract from "../src/lib/platform-admissions-task-contract.ts";
import * as taskDeadline from "../src/lib/platform-task-deadline.ts";
import * as calendarTypes from "../src/components/v3/calendar/types.ts";
import * as dueBucket from "../src/components/v3/queue/due-bucket.ts";
import * as queueButtons from "../src/components/v3/queue/queue-buttons.ts";
import * as bulkRun from "../src/components/v3/queue/bulk-run.ts";
import * as taskCommands from "../src/components/v3/tasks/task-commands.ts";
import * as composerRequestId from "../src/components/v3/tasks/composer-request-id.ts";
import * as composerDraft from "../src/components/v3/tasks/composer-draft.ts";
import * as nextStepInput from "../src/components/v3/students/next-step-input.ts";
import * as studentsView from "../src/components/v3/students/students-queue-view.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import {
  PALETTE_GROUP_LIMIT,
  isPaletteShortcut,
  paletteDestinations,
  paletteMatches,
  paletteQuery,
  searchCommandPalette,
} from "../src/lib/v3/command-palette.ts";
import { LIST_KEYS, PALETTE_KEY, PALETTE_MAC_KEY, QUEUE_KEYS, SELECT_KEY, SHELL_KEYS } from "../src/components/v3/queue/keyboard-keys.ts";

const require = createRequire(import.meta.url);
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js");
const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

function compile(path, resolve) {
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(resolve, compiled, compiled.exports);
  return compiled.exports;
}

/** Серверное действие-заглушка: записывает FormData и отвечает по очереди из списка. */
function recorder(name, answers) {
  const calls = [];
  const action = async (_previous, form) => {
    calls.push(Object.fromEntries(form.entries()));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(form) : answer;
  };
  return { name, calls, action };
}
function forbiddenAction() {
  throw new Error("this render must not call a server action");
}

const icons = compile("src/components/icons.tsx", (id) => require(id));
const bulk = compile("src/components/v3/queue/Bulk.tsx", (id) => {
  if (id === "@/components/icons") return icons;
  if (id === "../calendar/types") return calendarTypes;
  if (id === "./bulk-run") return bulkRun;
  if (id === "./due-bucket") return dueBucket;
  if (id === "./queue-buttons") return queueButtons;
  return require(id);
});
const casePicker = compile("src/components/v3/tasks/TaskCasePicker.tsx", (id) => {
  if (id === "@/lib/v3/task-case-actions") return { searchTaskCasesAction: forbiddenAction };
  return require(id);
});
const deadlineField = compile("src/components/v3/tasks/ComposerDeadlineField.tsx", (id) => {
  if (id === "../queue/due-bucket") return dueBucket;
  if (id === "../queue/queue-buttons") return queueButtons;
  if (id === "../calendar/types") return calendarTypes;
  return require(id);
});
const composer = compile("src/components/v3/tasks/TaskComposerDialog.tsx", (id) => {
  if (id === "@/components/icons") return icons;
  if (id === "@/lib/platform-access") return access;
  if (id === "@/lib/platform-admissions-task-contract") return taskContract;
  if (id === "@/lib/platform-staff-task-actions") return { mutateStaffTaskAction: forbiddenAction };
  if (id === "@/lib/platform-admissions-task-actions") return { createPlatformAdmissionsTaskAction: forbiddenAction };
  if (id === "@/lib/v3/task-case-actions") return { readTaskCaseAssigneesAction: forbiddenAction };
  if (id === "@/lib/v3/task-composer-actions") return { readTaskComposerAssigneesAction: forbiddenAction };
  if (id === "./ComposerDeadlineField") return deadlineField;
  if (id === "./TaskCasePicker") return casePicker;
  if (id === "./composer-request-id") return composerRequestId;
  if (id === "./composer-draft") return composerDraft;
  if (id === "../queue/queue-buttons") return queueButtons;
  return require(id);
});

const ME = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const CASE = { id: "20000000-0000-4000-8000-000000000001", name: "Синтетический студент" };
const LEAD = { id: "30000000-0000-4000-8000-000000000001", version: "7", name: "Синтетический лид" };
const admin = { systemRole: "admin", presentationRole: null, membershipId: ME, assignments: [], permissionKeys: [] };
const staffActor = (permissionKeys, extra = {}) => ({ systemRole: "staff", presentationRole: null, membershipId: ME, assignments: [], permissionKeys, ...extra });

function renderComposer(props) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh: forbiddenAction } },
    createElement(composer.TaskComposerDialog, {
      participants: [{ membershipId: ME, displayName: "Сотрудник А", role: "admissions" }],
      actorMembershipId: ME, actor: admin, day: "2026-09-24", staffAllowed: true, caseAllowed: true,
      hideTrigger: true, openIntent: "test", ...props,
    })));
}

function sourceFiles(dir) {
  return readdirSync(new URL(dir, ROOT)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(new URL(path, ROOT)).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/u.test(name) ? [path] : [];
  });
}
const SOURCES = sourceFiles("src").map((path) => ({ path, text: read(path) }));

// --- один способ создать задачу -------------------------------------------------

test("one composer: only TaskComposerDialog builds the create commands; the calendar form is gone", () => {
  const createCase = SOURCES.filter(({ path, text }) => /createPlatformAdmissionsTaskAction\(/u.test(text) && path !== "src/lib/platform-admissions-task-actions.ts");
  assert.deepEqual(createCase.map(({ path }) => path), ["src/components/v3/tasks/TaskComposerDialog.tsx"]);
  const createStaff = SOURCES.filter(({ text }) => /form\.set\("operation", "create"\)/u.test(text));
  assert.deepEqual(createStaff.map(({ path }) => path), ["src/components/v3/tasks/TaskComposerDialog.tsx"]);
  assert.deepEqual(SOURCES.filter(({ text }) => /CalendarCreateTaskForm|create-lifecycle/u.test(text)).map(({ path }) => path), []);
});

test("a retry after an unconfirmed save keeps its request id; only a spent key rotates", () => {
  // Правило прежней формы календаря (удалённый тест «only confirmed saved state
  // can offer a new attempt…»): «не подтверждено» — задача могла сохраниться,
  // повтор с тем же ключом вернёт её же, а не создаст вторую.
  const { nextComposerRequestId } = composerRequestId;
  const kept = "40000000-0000-4000-8000-000000000001";
  const fresh = () => "40000000-0000-4000-8000-000000000002";
  for (const status of ["unavailable", "invalid", "forbidden", "stale", "idle"]) {
    assert.equal(nextComposerRequestId(status, kept, fresh), kept, status);
  }
  for (const status of ["saved", "request_conflict"]) {
    assert.equal(nextComposerRequestId(status, kept, fresh), fresh(), status);
  }
  assert.match(nextComposerRequestId("request_conflict", kept), /^[0-9a-f-]{36}$/u);
  assert.notEqual(nextComposerRequestId("request_conflict", kept), kept);

  // Обе команды диалога идут через это правило; безусловный новый ключ — только
  // «Создать ещё» после подтверждённого сохранения; брошенная ошибка ключ не меняет.
  const source = read("src/components/v3/tasks/TaskComposerDialog.tsx");
  assert.equal([...source.matchAll(/requestId\.current = nextComposerRequestId\(shown, requestId\.current\);/gu)].length, 2);
  assert.equal([...source.matchAll(/requestId\.current = crypto\.randomUUID\(\);/gu)].length, 1);
  const createAnother = source.match(/function createAnother\(\) \{[\s\S]*?\n {2}\}/u)?.[0] ?? "";
  assert.match(createAnother, /setState\(\{ status: "idle", href: null \}\);[\s\S]*requestId\.current = crypto\.randomUUID\(\);/u);
  assert.match(source, /\} catch \{\s*(?:\/\/[^\n]*\n\s*)?setState\(\{ status: "unavailable", href: null \}\);\s*\} finally/u);

  // Сервер отвечает тем же ключом на «не подтверждено»: дело — failureState, рабочая задача — failed().
  const caseActions = read("src/lib/platform-admissions-task-actions.ts");
  assert.match(caseActions, /status === "request_conflict"\s*\? randomUUID\(\)\s*: \(requestId \?\? randomUUID\(\)\)/u);
  assert.match(caseActions, /return failureState\(form, "unavailable", null, requestId\);/u);
  const staffActions = read("src/lib/platform-staff-task-actions.ts");
  assert.match(staffActions, /const failed = \(status: StaffTaskActionState\["status"\]\): StaffTaskActionState => \(\{ status, requestId, taskId: null, version: null \}\);/u);
});

/** Хранилище черновиков в памяти: то же, что `localStorage`, с журналом записей. */
function memoryDrafts(entries = {}) {
  const map = new Map(Object.entries(entries));
  const writes = [];
  return {
    map, writes,
    read: (context) => map.get(context) ?? null,
    write(context, draft) {
      writes.push(context);
      if (composerDraft.composerDraftIsEmpty(draft)) map.delete(context);
      else map.set(context, { title: draft.title, description: draft.description });
    },
  };
}

test("composer drafts are keyed by the task a submit would create now", () => {
  const { composerDraftContext } = composerDraft;
  assert.equal(composerDraftContext({ caseId: CASE.id }), `case:${CASE.id}`);
  assert.equal(composerDraftContext({ caseId: CASE.id, sourceLeadId: LEAD.id }), `case:${CASE.id}`);
  assert.equal(composerDraftContext({ caseId: "", sourceMessageId: "m-1" }), "chat:m-1");
  assert.equal(composerDraftContext({ caseId: "", sourceLeadId: LEAD.id }), `lead:${LEAD.id}`);
  assert.equal(composerDraftContext({ caseId: "" }), "general");
  // Дело считается, только пока задача идёт по делу: свёрнутый раздел «Студент/дело» — рабочая задача.
  const source = read("src/components/v3/tasks/TaskComposerDialog.tsx");
  assert.match(source, /const draftContext = composerDraftContext\(\{ caseId: caseMode \? caseId : "", sourceMessageId, sourceLeadId \}\);/u);
  // Ключи прежние: черновики, набранные до этого среза, читаются.
  assert.match(read("src/components/v3/tasks/composer-draft.ts"), /const STORAGE_PREFIX = "evo-task-composer-draft:";/u);
});

test("opening the composer: a title typed before opening beats the draft; otherwise the entry's own draft", () => {
  const { openComposerDraft } = composerDraft;
  const store = memoryDrafts({ general: { title: "Черновик меню", description: "Описание черновика" } });
  assert.deepEqual(openComposerDraft(store, "general", "  Набрано в строке  "), { title: "Набрано в строке", description: "Описание черновика" });
  assert.deepEqual(openComposerDraft(store, "general", ""), { title: "Черновик меню", description: "Описание черновика" });
  assert.deepEqual(openComposerDraft(store, `case:${CASE.id}`, ""), { title: "", description: "" });
  assert.deepEqual(store.writes, []);
});

test("switching the case keeps typed text: type → pick a case, and type → «Без дела», with stale drafts present", () => {
  const { switchComposerDraft } = composerDraft;
  const caseKey = `case:${CASE.id}`;
  const otherKey = "case:20000000-0000-4000-8000-000000000099";
  const stale = { title: "Старый черновик дела", description: "" };
  const unrelated = { title: "Черновик другого дела", description: "" };

  // Календарь / меню: набрали название, затем выбрали дело (у дела лежит старый черновик).
  const typed = { title: "Позвонить семье", description: "Уточнить дату" };
  const store = memoryDrafts({ general: typed, [caseKey]: stale, [otherKey]: unrelated });
  const afterPick = switchComposerDraft(store, "general", caseKey, typed);
  assert.equal(afterPick, typed, "typed fields are returned as they are — the caller does not touch them");
  assert.deepEqual(store.map.get(caseKey), typed, "the typed text moves to the case key and replaces the stale draft");
  assert.equal(store.map.has("general"), false, "the key the user left no longer holds the same text");
  assert.deepEqual(store.map.get(otherKey), unrelated, "another case's draft is never touched");

  // Страница дела: набрали название, затем «Без дела» (у рабочей задачи лежит старый черновик).
  const caseTyped = { title: "Отправить перевод паспорта", description: "" };
  const detach = memoryDrafts({ [caseKey]: caseTyped, general: { title: "Старый рабочий черновик", description: "Старое описание" } });
  const afterDetach = switchComposerDraft(detach, caseKey, "general", caseTyped);
  assert.equal(afterDetach, caseTyped);
  assert.deepEqual(detach.map.get("general"), caseTyped);
  assert.equal(detach.map.has(caseKey), false);

  // Набрано только описание или только пробел — это тоже ввод: черновик нового ключа его не заменяет.
  for (const current of [{ title: "", description: "Только описание" }, { title: " ", description: "" }]) {
    const partial = memoryDrafts({ [caseKey]: stale });
    assert.equal(switchComposerDraft(partial, "general", caseKey, current), current);
    assert.deepEqual(partial.map.get(caseKey), current);
  }
});

test("an empty composer takes the new key's own draft; nothing else ever fills the fields", () => {
  const { switchComposerDraft, EMPTY_COMPOSER_DRAFT } = composerDraft;
  const caseKey = `case:${CASE.id}`;
  const own = { title: "Черновик этого дела", description: "" };
  const store = memoryDrafts({ [caseKey]: own, "case:20000000-0000-4000-8000-000000000099": { title: "Черновик другого дела", description: "" } });
  // Выбрали дело до ввода: пустые поля получают черновик того же дела, записи не меняются.
  assert.deepEqual(switchComposerDraft(store, "general", caseKey, EMPTY_COMPOSER_DRAFT), own);
  assert.deepEqual(store.writes, []);
  // У нового ключа черновика нет — поля остаются пустыми, а не берут чужой.
  assert.equal(switchComposerDraft(store, caseKey, "general", EMPTY_COMPOSER_DRAFT), EMPTY_COMPOSER_DRAFT);
  // Тот же ключ — не смена.
  const typed = { title: "x", description: "" };
  assert.equal(switchComposerDraft(store, caseKey, caseKey, typed), typed);
  assert.deepEqual(store.writes, []);
});

test("the dialog moves drafts only through switchComposerDraft and never overwrites typed fields", () => {
  const source = read("src/components/v3/tasks/TaskComposerDialog.tsx");
  const effect = source.match(/useEffect\(\(\) => \{\n\s+if \(state\.status === "saved"\) return;[\s\S]*?\n {2}\}, \[draftContext, title, description, state\.status\]\);/u)?.[0] ?? "";
  assert.ok(effect, "the draft effect is present");
  assert.match(effect, /const next = switchComposerDraft\(drafts, from, draftContext, \{ title, description \}\);/u);
  assert.match(effect, /if \(next\.title !== title\) setTitle\(next\.title\);/u);
  assert.match(effect, /if \(next\.description !== description\) setDescription\(next\.description\);/u);
  // Прежняя ошибка: поля при смене дела заполнялись черновиком нового ключа или пустотой.
  assert.doesNotMatch(source, /setTitle\(next\?\.title \?\? ""\)|readDraft\(/u);
  assert.match(source, /const \[opened\] = useState\(\(\) => openComposerDraft\(drafts, draftContext, initialTitle\)\);/u);
});

test("without staff.task.create the case search is open and cannot be folded away (spec: «без него поиск дела открыт сразу»)", () => {
  const caseOnly = renderComposer({ staffAllowed: false });
  assert.match(caseOnly, /data-composer-mode="case"/u);
  assert.match(caseOnly, /<div class="grid gap-3 sm:grid-cols-2" data-composer-context="case-search">/u);
  assert.match(caseOnly, /<select id="[^"]+" name="student_case_id" required=""/u);
  assert.doesNotMatch(caseOnly, /<summary[^>]*>Студент\/дело/u, "a required case is not an optional, foldable section");
  // С правом на рабочую задачу дело — необязательный раздел, как прежде.
  assert.match(renderComposer({}), /<summary[^>]*>Студент\/дело · необязательно/u);
});

test("the browser draft store tolerates a blocked or corrupt localStorage", () => {
  const { browserComposerDraftStore: store } = composerDraft;
  const previous = globalThis.window;
  const data = new Map();
  try {
    globalThis.window = { localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, String(value)); },
      removeItem: (key) => { data.delete(key); },
    } };
    store.write("general", { title: "Черновик", description: "" });
    assert.equal(data.get("evo-task-composer-draft:general"), JSON.stringify({ title: "Черновик", description: "" }));
    assert.deepEqual(store.read("general"), { title: "Черновик", description: "" });
    store.write("general", { title: "", description: "" });
    assert.equal(data.has("evo-task-composer-draft:general"), false);
    data.set("evo-task-composer-draft:general", "{not json");
    assert.equal(store.read("general"), null);
    data.set("evo-task-composer-draft:general", JSON.stringify({ title: 1, description: "" }));
    assert.equal(store.read("general"), null);
    globalThis.window = { localStorage: {
      getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); },
    } };
    assert.equal(store.read("general"), null);
    assert.doesNotThrow(() => store.write("general", { title: "x", description: "" }));
    assert.doesNotThrow(() => store.write("general", { title: "", description: "" }));
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

test("every entry point opens that one composer: menu, Ctrl+K, «Новая задача…», calendar, case, quick view, Lead 360", () => {
  const source = (path) => SOURCES.find((file) => file.path === path)?.text ?? "";
  // «Создать задачу» меню (одна оболочка с Э1.5): прежняя ссылка, обычное нажатие — диалог на месте.
  const shell = source("src/components/v3/AppShell.tsx");
  assert.match(shell, /href="\/v3\/tasks\?create=staff"/u);
  assert.match(shell, /onCreateTaskClick\(event,/u);
  assert.match(shell, /<ShellCommands actor=\{actor\} navigation=\{navigation\} \/>/u);
  const shellCommands = source("src/components/v3/palette/ShellCommands.tsx");
  assert.match(shellCommands, /<TaskComposerHost actor=\{actor\} \/>/u);
  assert.match(shellCommands, /if \(!openTaskComposer\(undefined, returnFocus\)\) fallback\(\);/u);
  assert.match(source("src/components/v3/tasks/TaskComposerHost.tsx"), /<TaskComposerDialog\s/u);
  assert.match(source("src/components/v3/palette/CommandPalette.tsx"), /openTaskComposer\(\);/u);
  assert.match(source("src/components/v3/tasks/TaskQuickAdd.tsx"), /<TaskComposerDialog\s+\{\.\.\.composer\}\s+hideTrigger/u);
  assert.match(source("src/components/v3/calendar/Calendar.tsx"), /<TaskComposerDialog[\s\S]*?defaultDueDay=\{day\}/u);
  for (const path of ["src/components/v3/profile/CaseWorkParts.tsx", "src/components/v3/profile/CaseTasksPanel.tsx",
    "src/components/v3/profile/Profile.tsx", "src/components/v3/profile/LeadWorkParts.tsx"]) {
    assert.match(source(path), /<TaskComposerDialog\s/u, path);
  }
  assert.match(source("src/components/v3/students/StudentQuickView.tsx"), /openTaskComposer\(\{ case: \{ id: row\.studentCaseId, name: row\.studentDisplayName \}, caseFixed: true \}\)/u);
  // «Сегодня» своей кнопки не получает: одна кнопка на экран — «Создать задачу» меню.
  assert.doesNotMatch(source("src/app/(v3)/v3/main/page.tsx"), /TaskComposer/u);
  // Контекст страницы для кнопки меню и Ctrl+K: дело, лид, день календаря.
  assert.match(source("src/components/v3/profile/CaseWorkParts.tsx"), /<TaskComposerContextMark value=\{\{\s*case: \{ id: caseId, name: profile\.person \}/u);
  assert.match(source("src/components/v3/profile/LeadWorkParts.tsx"), /\{ lead: \{ id: leadId, version: sales\.lead\.workflowVersion, name: profile\.person \} \}/u);
  assert.match(source("src/components/v3/calendar/Calendar.tsx"), /<TaskComposerContextMark value=\{\{ dueDay: day, cases, casesHaveMore \}\} \/>/u);
});

test("the composer is prefilled by its entry point: case, page case, lead, calendar day, typed title", () => {
  // «+ Задача» дела: дело входа, без поиска и без «Без дела».
  const caseEntry = renderComposer({ staffAllowed: false, initialCase: CASE, initialCaseAssignees: [{ membershipId: ME, displayName: "Сотрудник А" }] });
  assert.match(caseEntry, /data-composer-mode="case"/u);
  assert.match(caseEntry, /Студент\/дело: <\/span>Синтетический студент/u);
  assert.doesNotMatch(caseEntry, /Без дела|name="student_case_id"/u);
  // Кнопка меню на странице дела: дело из страницы, его можно убрать и поставить рабочую задачу.
  const pageCase = renderComposer({ initialCase: CASE, caseRemovable: true });
  assert.match(pageCase, /Студент\/дело: <\/span>Синтетический студент[\s\S]*>Без дела<\/button>/u);
  // Lead 360: рабочая задача по лиду, дело не предлагается.
  const lead = renderComposer({ caseAllowed: false, sourceLeadId: LEAD.id, sourceLeadVersion: LEAD.version, sourceLeadName: LEAD.name });
  assert.match(lead, /data-composer-mode="staff"/u);
  assert.match(lead, /data-composer-context="lead"><span class="text-fg-2">Лид: <\/span>Синтетический лид/u);
  assert.doesNotMatch(lead, /Студент\/дело/u);
  // Календарь: срок по умолчанию — выбранный день, не сегодня.
  const calendar = renderComposer({ defaultDueDay: "2026-09-29" });
  assert.match(calendar, /<input type="hidden" name="due_on" value="2026-09-29"\/>/u);
  assert.match(calendar, /aria-pressed="true"[^>]*>Дата…<\/button>/u);
  assert.match(renderComposer({}), /aria-pressed="true"[^>]*>Сегодня<\/button>/u);
  // «Новая задача…»: набранное название.
  assert.match(renderComposer({ initialTitle: "Позвонить семье" }), /name="title"[^>]*value="Позвонить семье"/u);
  // Просмотр роли и сотрудник без прав на создание диалога не получают.
  assert.equal(renderComposer({ actor: { ...admin, presentationRole: "admissions" } }), "");
  assert.equal(renderComposer({ staffAllowed: false, caseAllowed: false }), "");
});

// --- массовые действия --------------------------------------------------------------

test("bulk runs each item through its own command in order and reports partial failures honestly", async () => {
  const seen = [];
  const outcomes = await bulkRun.runBulk(
    [{ key: "a", label: "А" }, { key: "b", label: "Б" }, { key: "c", label: "В" }],
    async (item) => {
      seen.push(item.key);
      if (item.key === "b") return "Задача уже изменена.";
      if (item.key === "c") throw new Error("network");
      return null;
    },
  );
  assert.deepEqual(seen, ["a", "b", "c"], "one command per item, in the order of selection");
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["saved", "failed", "failed"]);
  assert.equal(outcomes[2].reason, bulkRun.BULK_UNCONFIRMED, "a thrown command is never «saved»");
  const summary = bulkRun.bulkSummary([...outcomes, ...bulkRun.bulkSkipped([{ key: "d", label: "Г" }], "не подходит")]);
  assert.deepEqual(summary, { saved: 1, failed: 2, skipped: 1, total: 4 });
  assert.equal(bulkRun.bulkSummaryText(summary, { one: "дело", few: "дела", many: "дел" }), "Сохранено 1 из 3. Не сохранено 2. Не подошло 1 дело.");
  // Несохранённые остаются выбранными для повтора; сохранённые и неподошедшие снимаются.
  assert.deepEqual(bulkRun.keysToKeep([...outcomes, { key: "d", label: "Г", status: "skipped", reason: "x" }]), ["b", "c"]);
  const dialog = read("src/components/v3/queue/Bulk.tsx");
  assert.match(dialog, /data-bulk-outcome=\{outcome\.status\}/u);
  assert.match(dialog, /Несохранённые остались выбранными: их можно повторить\./u);
  assert.match(dialog, /selection\.set\(keysToKeep\(all\)\)/u);
});

test("«Перенести срок» sends each task through its existing command with its own version and request id", async () => {
  const staff = recorder("mutateStaffTaskAction", [
    { status: "saved", requestId: "r", taskId: "t", version: "4" },
    { status: "stale", requestId: "r", taskId: null, version: null },
    { status: "unavailable", requestId: "r", taskId: null, version: null },
  ]);
  const caseAction = recorder("changePlatformAdmissionsTaskAction", [{ status: "forbidden", requestId: "r", caseTaskId: null, version: null, changedAt: null }]);
  const tasksBulk = compile("src/components/v3/tasks/TaskBulkActions.tsx", (id) => {
    if (id === "@/lib/platform-staff-task-actions") return { mutateStaffTaskAction: staff.action };
    if (id === "@/lib/platform-admissions-task-actions") return { changePlatformAdmissionsTaskAction: caseAction.action };
    if (id === "@/lib/platform-task-deadline") return taskDeadline;
    if (id === "../queue/Bulk") return bulk;
    if (id === "../queue/queue-buttons") return queueButtons;
    if (id === "./task-commands") return taskCommands;
    return require(id);
  });
  const now = new Date("2026-09-24T04:00:00.000Z");
  const staffTask = { kind: "staff", key: "staff:1", id: "40000000-0000-4000-8000-000000000001", title: "Рабочая", description: null, status: "open",
    priority: "normal", dueOn: "2026-09-22", dueAt: null, version: "3", assigneeMembershipId: ME, assigneeDisplayName: "А",
    creatorMembershipId: ME, studentCaseId: null, studentDisplayName: null, caseState: null, studentVisible: null, fromChat: false, updatedAt: "x" };
  const timed = { ...staffTask, id: "40000000-0000-4000-8000-000000000002", dueOn: null, dueAt: "2026-09-24T09:00:00.000Z", version: "8" };
  assert.deepEqual(await tasksBulk.rescheduleTask(staffTask, "2026-09-25", "", "50000000-0000-4000-8000-000000000001", now), { error: null, unconfirmed: false });
  assert.deepEqual(staff.calls[0], {
    operation: "edit", request_id: "50000000-0000-4000-8000-000000000001", expected_version: "3", task_id: staffTask.id,
    source_message_id: "", source_message_version: "", source_lead_id: "", source_lead_version: "", status: "open",
    completion_note: "", title: "Рабочая", assignee_membership_id: ME, description: "", priority: "normal",
    deadline_kind: "all_day", due_on: "2026-09-25", due_at: "",
  });
  // Срок со временем переносится с тем же временем по Бишкеку (15:00 = 09:00 UTC + 6).
  const stale = await tasksBulk.rescheduleTask(timed, "2026-09-25", "", "50000000-0000-4000-8000-000000000002", now);
  assert.deepEqual(staff.calls[1].deadline_kind + " " + staff.calls[1].due_at + " " + staff.calls[1].expected_version, "timed 2026-09-25T15:00 8");
  assert.equal(stale.unconfirmed, false);
  assert.match(stale.error, /Задача уже изменена/u);
  // «Не подтверждено»: ключ запроса держится для повтора того же запроса.
  assert.equal((await tasksBulk.rescheduleTask(staffTask, null, "", "50000000-0000-4000-8000-000000000003", now)).unconfirmed, true);
  assert.equal(staff.calls[2].deadline_kind, "none");
  const caseTask = { ...staffTask, kind: "case", key: "case:1", id: "60000000-0000-4000-8000-000000000001", version: "5",
    studentCaseId: CASE.id, studentDisplayName: CASE.name, caseState: "active", studentVisible: false, creatorMembershipId: null };
  const refused = await tasksBulk.rescheduleTask(caseTask, "2026-09-25", "Семья перенесла встречу", "50000000-0000-4000-8000-000000000004", now);
  assert.match(refused.error, /Нет доступа/u);
  assert.deepEqual(
    [caseAction.calls[0].case_task_id, caseAction.calls[0].student_case_id, caseAction.calls[0].expected_version, caseAction.calls[0].reason, caseAction.calls[0].request_id, caseAction.calls[0].due_on],
    [caseTask.id, CASE.id, "5", "Семья перенесла встречу", "50000000-0000-4000-8000-000000000004", "2026-09-25"],
  );
  // Выбрать можно только то, что сотрудник может править (та же подсказка, что у «⋯» строки).
  const list = read("src/components/v3/tasks/TaskQueueList.tsx");
  assert.match(list, /taskRowAbilities\(task, permissions, open, now\)\.edit/u);
});

test("«Назначить куратора» and «Изменить срок шага» use the single-case commands with their own checks", async () => {
  const curator = recorder("assignCaseCuratorAction", [{ status: "saved", requestId: "n" }, { status: "stale", requestId: "r" }]);
  const step = recorder("saveCaseNextActionAction", [{ status: "stale", requestId: "r", message: "m", receipt: null }]);
  const studentsBulk = compile("src/components/v3/students/StudentsBulkActions.tsx", (id) => {
    if (id === "@/lib/platform-case-curator-assignment-actions") return { assignCaseCuratorAction: curator.action };
    if (id === "@/lib/platform-case-next-action-actions") return { saveCaseNextActionAction: step.action };
    if (id === "../queue/Bulk") return bulk;
    if (id === "../queue/queue-buttons") return queueButtons;
    if (id === "./next-step-input") return nextStepInput;
    if (id === "./students-queue-view") return studentsView;
    return require(id);
  });
  const row = (n, fields) => ({ studentCaseId: `70000000-0000-4000-8000-00000000000${n}`, studentDisplayName: `Студент ${n}`, state: "active",
    isMine: true, nextAction: null, nextActionDueOn: null, admissionsVersion: "9", attentionFlags: [], ...fields });
  const waiting = row(1, { state: "pending", attentionFlags: ["needs_curator"] });
  const stepped = row(2, { nextAction: "Собрать апостиль", nextActionDueOn: "2026-09-22" });
  const noStep = row(3, {});
  const closed = row(4, { state: "closed", nextAction: "Выдать документы" });
  const manager = { curators: [{ membershipId: OTHER, displayName: "Куратор Б" }],
    editor: { admin: false, preview: false, routeManage: true, broadScope: false }, recordScopes: [] };
  assert.deepEqual([waiting, stepped, noStep, closed].map((item) => studentsBulk.curatorAssignable(manager, item)), [true, false, false, false]);
  assert.deepEqual([waiting, stepped, noStep, closed].map((item) => studentsBulk.stepDueEditable(manager, item)), [false, true, false, false]);
  // Без права назначать кураторов (null) и в просмотре роли действий нет.
  assert.equal(studentsBulk.curatorAssignable({ ...manager, curators: null }, waiting), false);
  assert.equal(studentsBulk.stepDueEditable({ ...manager, editor: { ...manager.editor, preview: true } }, stepped), false);

  assert.deepEqual(await studentsBulk.assignCuratorToCase(waiting, OTHER, " Отпуск ", "80000000-0000-4000-8000-000000000001"), { error: null, unconfirmed: false });
  assert.deepEqual(curator.calls[0], { student_case_id: waiting.studentCaseId, curator_membership_id: OTHER, reason: "Отпуск", request_id: "80000000-0000-4000-8000-000000000001" });
  const again = await studentsBulk.assignCuratorToCase(waiting, OTHER, "Отпуск", "80000000-0000-4000-8000-000000000002");
  assert.match(again.error, /уже назначено/u);

  const moved = await studentsBulk.moveStepDue(stepped, "2026-09-30", "80000000-0000-4000-8000-000000000003");
  assert.match(moved.error, /Шаг уже изменили/u);
  // Текст шага прежний, ожидаемая версия — версия строки из чтения, срок новый.
  assert.deepEqual(step.calls[0], { student_case_id: stepped.studentCaseId, expected_version: "9", next_action: "Собрать апостиль",
    next_action_due_on: "2026-09-30", request_id: "80000000-0000-4000-8000-000000000003" });
  // Гейт кнопки «Назначить куратора» — то же право, что у команды (`case.curator.assign`), список — у кого оно есть.
  assert.match(read("src/components/v3/students/StudentsQueueScreen.tsx"), /curators=\{input\.actor\.coverage \? input\.curatorNames : null\}/u);
  assert.match(read("src/lib/platform-case-curator-assignment-actions.ts"), /!staffHasPermission\(actor, "case\.curator\.assign"\)/u);
});

// --- Ctrl+K ------------------------------------------------------------------------

function readers(log, overrides = {}) {
  const student = (n, accessMode = "full") => ({ access: accessMode, studentCaseId: `90000000-0000-4000-8000-00000000000${n}`,
    studentDisplayName: `Студент ${n}`, targetCountry: "Китай", targetDegree: null, state: n === 2 ? "pending" : "active" });
  return {
    students: async (_actor, query, limit) => {
      log.push(["students", query, limit]);
      if (overrides.students) return overrides.students();
      return { rows: [student(1), student(2), student(3, "sales_summary")], hasNext: false };
    },
    leads: async (_actor, query, limit) => {
      log.push(["leads", query, limit]);
      if (overrides.leads) return overrides.leads();
      return { rows: [{ leadId: "a0000000-0000-4000-8000-000000000001", clientDisplayName: null }], hasNext: false };
    },
  };
}

test("Ctrl+K search never returns what the role cannot open", async () => {
  const sales = staffActor(["lead.read", "lead.sales.workflow.manage"]);
  const admissions = staffActor(["case.read.full", "profile.read.full", "task.create"]);
  const tasksOnly = staffActor(["staff.task.read", "staff.task.create"]);

  let log = [];
  const forSales = await searchCommandPalette(sales, "Ст", readers(log));
  assert.equal(forSales.students.status, "hidden");
  assert.deepEqual(log.map(([group]) => group), ["leads"], "the students read is never called for Sales");
  assert.deepEqual(forSales.leads.rows, [{ id: "a0000000-0000-4000-8000-000000000001", label: "Лид без имени", meta: null, href: "/v3/profile?id=a0000000-0000-4000-8000-000000000001" }]);

  log = [];
  const forAdmissions = await searchCommandPalette(admissions, "Ст", readers(log));
  assert.equal(forAdmissions.leads.status, "hidden");
  assert.deepEqual(log.map(([group]) => group), ["students"]);
  // Только дела с полным доступом: краткая сводка продаж дело не открывает.
  assert.deepEqual(forAdmissions.students.rows.map((row) => row.href), [
    "/v3/profile?case=90000000-0000-4000-8000-000000000001", "/v3/profile?case=90000000-0000-4000-8000-000000000002"]);
  assert.equal(forAdmissions.students.rows[1].meta, "Китай · ожидает начала");

  log = [];
  const none = await searchCommandPalette(tasksOnly, "Ст", readers(log));
  assert.deepEqual([none.students.status, none.leads.status, log.length], ["hidden", "hidden", 0], "no /v3/profile route — no people at all");

  // Просмотр роли: группы — по правам роли, как у страниц.
  for (const [role, students, leads] of [["sales", "hidden", "ready"], ["admissions", "ready", "hidden"]]) {
    const preview = await searchCommandPalette({ ...admin, presentationRole: role }, "Ст", readers([]));
    assert.deepEqual([preview.students.status, preview.leads.status], [students, leads], role);
  }

  // Короткий запрос не читает ничего; сбой одной группы не гасит другую; «есть ещё» — честно.
  log = [];
  assert.equal((await searchCommandPalette(admin, " С ", readers(log))).status, "invalid");
  assert.equal(log.length, 0);
  const failing = await searchCommandPalette(admin, "Ст", readers([], { students: async () => { throw new Error("down"); } }));
  assert.deepEqual([failing.students.status, failing.leads.status], ["unavailable", "ready"]);
  const many = await searchCommandPalette(admin, "Ст", readers([], { leads: async () => ({
    rows: Array.from({ length: PALETTE_GROUP_LIMIT + 1 }, (_, n) => ({ leadId: `b0000000-0000-4000-8000-00000000000${n}`, clientDisplayName: `Лид ${n}` })),
    hasNext: false }) }));
  assert.equal(many.leads.rows.length, PALETTE_GROUP_LIMIT);
  assert.equal(many.leads.more, true);
  assert.equal(paletteQuery("\u0000ab"), null);
  assert.equal(paletteQuery("  Ай  бек "), "Ай бек");
});

test("Ctrl+K destinations are exactly the menu links the role can open", () => {
  const query = new URLSearchParams();
  const sales = staffActor(["lead.read", "lead.sales.workflow.manage", "sales.register.read", "staff.task.read"]);
  const admissions = staffActor(["case.read.full", "profile.read.full", "task.create", "task.manage", "catalog.read"]);
  const hrefs = (actor) => paletteDestinations(buildV3Navigation(actor, "/v3/main", query)).map((entry) => entry.href);
  assert.ok(hrefs(sales).includes("/v3/pipeline"));
  assert.ok(!hrefs(sales).includes("/v3/admissions-pipeline"));
  assert.ok(!hrefs(sales).includes("/v3/settings"));
  assert.ok(hrefs(admissions).includes("/v3/admissions-pipeline"));
  assert.ok(!hrefs(admissions).includes("/v3/pipeline"));
  for (const actor of [sales, admissions, admin]) {
    for (const entry of paletteDestinations(buildV3Navigation(actor, "/v3/main", query))) {
      const route = entry.href.split("?")[0];
      assert.ok(access.staffCanAccessRoute(actor, route), `${entry.label}: ${route}`);
    }
  }
  assert.ok(hrefs(admin).includes("/v3/settings"));
  assert.equal(paletteMatches("зад", "Задачи", "Общее"), true);
  assert.equal(paletteMatches("прод", "Воронка продаж", "Продажи"), true);
  assert.equal(paletteMatches("ежд", "Задачи", "Общее"), false, "matches word starts, not the middle of a word");
  assert.equal(paletteMatches("воронка пр", "Воронка продаж", ""), true);
});

// --- клавиши и фокус ----------------------------------------------------------------

test("keys: Ctrl+K / ⌘K on any layout, and the «?» windows list /, j/k, Enter, Esc, x and Ctrl+K", () => {
  const event = (fields) => ({ key: "k", code: "KeyK", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...fields });
  assert.equal(isPaletteShortcut(event({ ctrlKey: true })), true);
  assert.equal(isPaletteShortcut(event({ metaKey: true })), true);
  assert.equal(isPaletteShortcut(event({ ctrlKey: true, key: "л" })), true, "Russian layout: the same physical key");
  assert.equal(isPaletteShortcut(event({ ctrlKey: true, shiftKey: true })), false);
  assert.equal(isPaletteShortcut(event({})), false);
  const combos = (keys) => keys.map(([combo]) => combo.join(" "));
  assert.deepEqual(combos(QUEUE_KEYS), ["/", "↑ ↓", "j k", "Enter", "Esc"]);
  assert.deepEqual(combos(SHELL_KEYS), ["Ctrl K", "⌘ K", "?", "Esc"]);
  assert.deepEqual(combos(LIST_KEYS), ["/", "↑ ↓", "j k", "Enter", "x"]);
  assert.deepEqual(SELECT_KEY[0], ["x"]);
  const help = read("src/components/v3/queue/QueueKeyboardHelp.tsx");
  assert.match(help, /<KeyList keys=\{\[\.\.\.QUEUE_KEYS, \.\.\.extra, PALETTE_KEY, PALETTE_MAC_KEY\]\}/u);
  assert.ok(PALETTE_KEY && PALETTE_MAC_KEY);
  // «x» в окне «?» — только там, где у роли есть массовые действия.
  assert.match(read("src/components/v3/tasks/TasksWorkspace.tsx"), /\? \[SELECT_KEY\] : \[\]/u);
  assert.match(read("src/components/v3/students/StudentsQueueHead.tsx"), /\.\.\.\(selectKey \? \[SELECT_KEY\] : \[\]\)/u);
  // Окно «?» оболочки уступает окну очереди.
  assert.match(read("src/components/v3/palette/KeyboardHelpDialog.tsx"), /if \(document\.getElementById\(QUEUE_HELP_ID\)\) return;/u);
});

test("focus: top-layer windows trap and return focus; «x» marks the focused row; a checkbox does not silence the queue keys", () => {
  const keyboard = read("src/components/v3/queue/useQueueKeyboard.ts");
  assert.match(keyboard, /event\.key === "x" \|\| event\.code === "KeyX"/u);
  assert.match(keyboard, /row\?\.querySelector<HTMLInputElement>\(QUEUE_SELECT_SELECTOR\)/u);
  assert.match(keyboard, /\["checkbox", "radio", "button", "submit", "reset"\]\.includes\(target\.type\)\) return false;/u);

  const palette = read("src/components/v3/palette/CommandPalette.tsx");
  assert.match(palette, /if \(!dialog\.open\) dialog\.showModal\(\);/u, "a modal <dialog> in the top layer: the page is inert");
  assert.match(palette, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); hide\(\); \}\}/u, "Esc closes through hide()");
  assert.match(palette, /dialogRef\.current\?\.close\(\);\s*const target = returnTo\.current;\s*if \(restoreFocus && target\?\.isConnected\) target\.focus\(\);/u);
  assert.match(palette, /if \(event\.key === "Tab"\) \{\s*event\.preventDefault\(\);\s*inputRef\.current\?\.focus\(\);/u, "Tab stays in the field");
  assert.match(palette, /role="combobox"[\s\S]*aria-activedescendant=/u);
  assert.match(palette, /role="listbox"/u);
  assert.match(palette, /role="option"\s+aria-selected=\{selected\}/u);
  // Диалог задачи закрывается до возврата фокуса: иначе страница ещё инертна.
  assert.match(read("src/components/v3/tasks/TaskComposerDialog.tsx"), /function close\(\) \{\s*dialogRef\.current\?\.close\(\);\s*onClose\(\);\s*\}/u);
  const bulkSource = read("src/components/v3/queue/Bulk.tsx");
  assert.match(bulkSource, /if \(phase\.kind === "done"\) doneRef\.current\?\.focus\(\);/u, "the result keeps focus inside the window");
  // Кнопка действия остаётся — фокус на неё; выбор опустел (всё сохранено) — на отправленную строку, не на body.
  assert.match(bulkSource, /const triggerStays = selection\.count > 0 && trigger !== null && !trigger\.disabled && trigger\.getClientRects\(\)\.length > 0;/u);
  assert.match(bulkSource, /setOpen\(false\);\s*onOpenChange\(false\);\s*dialogRef\.current\?\.close\(\);\s*setPhase\(\{ kind: "form" \}\);\s*setError\(null\);\s*if \(trigger && triggerStays\) trigger\.focus\(\);\s*else focusAfterBulk\(sentKeys\.current\);/u);
  // Строка выбора — настоящий чекбокс с именем строки, нейтральный цвет выбора.
  const html = renderToStaticMarkup(createElement(bulk.RowSelect, { label: "Задача А", checked: true, onToggle() {} }));
  assert.match(html, /<input type="checkbox" data-queue-select="" aria-label="Выбрать: Задача А" class="size-\[18px\] cursor-pointer accent-fg" checked=""\/>/u);
  assert.match(html, /^<label class="relative z-10 grid size-11 /u, "a 44 px target above the row link");
});

// --- финальная проверка Э7: окно, строка действий, телефон, одна кнопка --------

test("the composer keeps «Создать задачу» in a pinned footer and speaks in type roles", () => {
  const html = renderComposer({ defaultDueDay: "2026-09-29" });
  // Поля прокручиваются, главная кнопка — в закреплённом низу окна (телефон с «Датой» и «Временем»).
  assert.match(html, /<form class="flex min-h-0 flex-col" data-composer-mode="staff"><div class="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4">/u);
  const footer = 'class="shrink-0 space-y-2 border-t border-border p-4"';
  assert.doesNotMatch(html.slice(html.indexOf("overflow-y-auto"), html.indexOf(footer)), /type="submit"/u, "the submit is not inside the scroll");
  assert.match(html, /class="shrink-0 space-y-2 border-t border-border p-4"><div class="flex flex-wrap gap-3"><button type="submit"[^>]*>Создать задачу<\/button>/u);
  // Роли текста: подписи — t-label, ни text-sm, ни text-xs во всём окне (и в поиске дела).
  const withCase = renderComposer({ initialCase: CASE, caseRemovable: true });
  const withPicker = renderComposer({ staffAllowed: false });
  for (const markup of [html, withCase, withPicker]) assert.doesNotMatch(markup, /\btext-(?:sm|xs)\b/u);
  assert.match(html, /<label class="block t-label text-fg">Название/u);
  assert.match(withPicker, /class="t-label text-fg-2">Найти активное дело студента<\/label>/u);
});

test("one create button per calendar screen: the shell opens the composer with the day and the cases already read", () => {
  const calendar = read("src/components/v3/calendar/Calendar.tsx");
  assert.match(calendar, /<TaskComposerContextMark value=\{\{ dueDay: day, cases, casesHaveMore \}\} \/>/u);
  // Своя кнопка — только у того, у кого нет «Создать задачу» оболочки (`staff.task.create`); имя то же.
  assert.match(calendar, /canCreate && !canCreateStaff \? <TaskComposerDialog[\s\S]*?triggerChildren=\{<><Icon name="plus" size=\{16\} \/>Создать задачу<\/>\}/u);
  assert.doesNotMatch(calendar, /Новая задача<\/>/u);
  const host = read("src/components/v3/tasks/TaskComposerHost.tsx");
  assert.match(host, /initialCases=\{access\.case \? context\.cases \?\? \[\] : \[\]\}/u);
  assert.match(host, /casesHaveMore=\{access\.case \? context\.casesHaveMore \?\? false : false\}/u);
  // Кнопка оболочки — у того же права, что и рабочая задача календаря.
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell, /const canCreateTask = !previewing && staffHasPermission\(actor, "staff\.task\.create"\);/u);
  assert.match(shell, /\{canCreateTask \? \(\s*<Link\s*href="\/v3\/tasks\?create=staff"/u);
});

const NOUN = { one: "дело", few: "дела", many: "дел" };
function fakeSelection(keys, revealed = true) {
  return { keys, count: keys.length, has: (key) => keys.includes(key), toggle() {}, set() {}, clear() {}, revealed, pick() {} };
}

test("bulk bar: spaced «Выбрать все · N», a ground band down to the tab bar, and a reason next to an action that fits no row", () => {
  const selection = fakeSelection(["a", "b"]);
  const html = renderToStaticMarkup(createElement(bulk.BulkBar, { selection, allKeys: ["a", "b", "c"], noun: NOUN },
    createElement(bulk.BulkActionDialog, {
      title: "Назначить куратора", triggerLabel: "Назначить куратора", testId: "t", items: [],
      skipped: [{ key: "a", label: "А", reason: "дело не ждёт куратора" }], noun: NOUN, selection,
      emptyReason: "Нет дел, ждущих куратора", validate: () => null, command: async () => null, onFinished() {}, onOpenChange() {},
    }, "поля")));
  assert.match(html, /^<div class="v3-bulk-dock sticky z-30 bg-bg pt-2 pb-3" data-bulk-dock=""><div role="region" aria-label="Действия с выбранными" data-testid="queue-bulk-bar"/u);
  // Один строчный span: пробелы вокруг «·» не схлопываются во flex-кнопке.
  assert.match(html, /data-bulk-select-all=""[^>]*><span><span class="sm:hidden">[\s\S]*?<span class="hidden sm:inline">Выбрать все на странице<\/span> · <span class="tabular-nums">3<\/span><\/span><\/button>/u);
  // Недоступное действие: причина словами рядом с кнопкой; на телефоне его нет.
  assert.match(html, /<span class="inline-flex items-center gap-1\.5 me-3 max-sm:hidden"><button [^>]*disabled=""[^>]*aria-describedby="([^"]+)"[^>]*>Назначить куратора<\/button><span id="\1" class="t-meta text-fg-2" data-testid="t-unavailable">Нет дел, ждущих куратора<\/span><\/span>/u);
  const css = read("src/app/(v3)/v3.css");
  assert.match(css, /\.v3-world \.v3-bulk-dock \{\s*bottom: calc\(var\(--shell-tabbar, 0px\) \+ var\(--shell-safe-bottom, 0px\)\);\s*\}/u, "no gap above the phone tab bar");
  assert.doesNotMatch(css, /v3-bulk-bar/u);
  const students = read("src/components/v3/students/StudentsBulkActions.tsx");
  assert.match(students, /emptyReason="Нет дел, ждущих куратора"/u);
  assert.match(students, /emptyReason="Нет дел с шагом, доступным вам"/u);
  assert.match(students, /disabledReason="Некого назначить: список кураторов пуст"/u);
});

test("phone: no checkbox beside the completion circle until «Выбрать»; «Снять выбор» hides them again", () => {
  assert.match(renderToStaticMarkup(createElement(bulk.BulkPickToggle, { selection: fakeSelection([], false) })),
    /^<div class="flex justify-end sm:hidden"><button type="button" data-testid="queue-bulk-pick"[^>]*>Выбрать<\/button><\/div>$/u);
  assert.match(renderToStaticMarkup(createElement(bulk.BulkPickToggle, { selection: fakeSelection([], true) })), />Отмена<\/button>/u);
  assert.match(renderToStaticMarkup(createElement(bulk.RowSelect, { label: "А", checked: false, onToggle() {}, phoneHidden: true })), /^<label class="relative z-10 grid size-11 [^"]* max-sm:hidden">/u);
  assert.doesNotMatch(renderToStaticMarkup(createElement(bulk.RowSelect, { label: "А", checked: false, onToggle() {} })), /max-sm:hidden/u);
  const source = read("src/components/v3/queue/Bulk.tsx");
  assert.match(source, /clear: \(\) => \{ setSelected\(\[\]\); setPicking\(false\); \}/u);
  assert.match(source, /revealed: picking \|\| live\.length > 0/u);
  // Обе очереди: «Выбрать» над списком, строки знают, видны ли отметки на телефоне.
  assert.match(read("src/components/v3/tasks/TaskQueueList.tsx"), /\{bulk \? <BulkPickToggle selection=\{selection\} \/> : null\}/u);
  assert.match(read("src/components/v3/tasks/TaskQueueList.tsx"), /revealed: selection\.revealed \}/u);
  assert.match(read("src/components/v3/students/StudentsQueueBody.tsx"), /\{bulk && !empty \? <BulkPickToggle selection=\{selection\} \/> : null\}/u);
  assert.match(read("src/components/v3/tasks/TaskQueueRow.tsx"), /"\[--row-lead:5\.5rem\] max-sm:\[--row-lead:2\.75rem\]"/u);
});

test("after a full success focus goes to a sent row still on the page, then the first row — never body", () => {
  const focused = [];
  const element = (name, shown = true) => ({ focus: () => focused.push(name), getClientRects: () => (shown ? [{}] : []) });
  const rows = new Map([
    ["hidden", { querySelector: (selector) => (selector === "[data-queue-open]" ? element("link-hidden", false) : null) }],
    ["b", { querySelector: (selector) => (selector === "[data-queue-open]" ? element("link-b") : null) }],
  ]);
  const saved = { document: globalThis.document, CSS: globalThis.CSS };
  globalThis.CSS = { escape: (value) => value };
  globalThis.document = {
    querySelector(selector) {
      const key = /^\[data-queue-row="([^"]+)"\]$/u.exec(selector)?.[1];
      if (key !== undefined) return rows.get(key) ?? null;
      if (selector === "[data-queue-row] [data-queue-open]") return element("first-row");
      if (selector === "[data-shell-content], main") return element("content");
      return null;
    },
  };
  try {
    bulk.focusAfterBulk(["gone", "hidden", "b"]);
    bulk.focusAfterBulk(["gone"]);
    assert.deepEqual(focused, ["link-b", "first-row"]);
  } finally {
    globalThis.document = saved.document;
    globalThis.CSS = saved.CSS;
  }
  // Браузерная проверка того же пути с клавиатуры — tests/e2e/e7-static-render.cjs (bulkFocusProbe).
  assert.match(read("tests/e2e/e7-static-render.cjs"), /full success: the bar is gone and focus is on the sent row, not body/u);
});

test("palette footer hides on phone without a status; the «?» window lists two groups on one key column", () => {
  const palette = read("src/components/v3/palette/CommandPalette.tsx");
  assert.match(palette, /border-t border-border px-4 py-2\$\{status \? "" : " max-md:sr-only"\}/u, "the live status stays in the tree");
  const help = read("src/components/v3/palette/KeyboardHelpDialog.tsx");
  assert.match(help, /<div className="p-4 \[--key-column:5\.5rem\]">/u);
  assert.match(help, /<h3 className="mt-3 t-item text-fg">Везде<\/h3>\s*<KeyList keys=\{SHELL_KEYS\}/u);
  assert.match(help, /<h3 className="mt-4 t-item text-fg">В списках<\/h3>/u);
  assert.match(read("src/components/v3/queue/KeyList.tsx"), /grid-cols-\[var\(--key-column,auto\)_1fr\]/u);
});
