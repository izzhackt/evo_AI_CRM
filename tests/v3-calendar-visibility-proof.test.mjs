import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as access from "../src/lib/platform-access.ts";
import * as taskContract from "../src/lib/platform-admissions-task-contract.ts";
import * as calendarTypes from "../src/components/v3/calendar/types.ts";
import * as dueBucket from "../src/components/v3/queue/due-bucket.ts";
import * as queueButtons from "../src/components/v3/queue/queue-buttons.ts";

/*
 * Э7 «Один способ создать задачу»: календарь создаёт задачу тем же диалогом
 * «Новая задача» (`TaskComposerDialog`), что и остальные входы. Доказательство
 * видимости задачи студенту переезжает с прежней формы календаря на этот
 * диалог: без `task.visibility.manage` выбора видимости нет и команда получает
 * `student_visible=false`; с правом и у System Admin — выбор «Скрыта / Видна».
 */
const require = createRequire(import.meta.url);
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js");
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
let actionCalls = 0;
function unavailableAction() {
  actionCalls += 1;
  throw new Error("SSR markup proof must not execute navigation or server actions");
}
function compile(path, resolve) {
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(resolve, compiled, compiled.exports);
  return compiled.exports;
}
// Actual React, components and permission helper. Only nonexecuted server-action
// references fail fast; no Auth/API/DB outcome or permission evaluator is replaced.
const icons = compile("src/components/icons.tsx", id => require(id));
const casePicker = compile("src/components/v3/tasks/TaskCasePicker.tsx", id => {
  if (id === "@/lib/v3/task-case-actions") return { searchTaskCasesAction: unavailableAction };
  return require(id);
});
const deadline = compile("src/components/v3/tasks/ComposerDeadlineField.tsx", id => {
  if (id === "../queue/due-bucket") return dueBucket;
  if (id === "../queue/queue-buttons") return queueButtons;
  if (id === "../calendar/types") return calendarTypes;
  return require(id);
});
const composer = compile("src/components/v3/tasks/TaskComposerDialog.tsx", id => {
  if (id === "@/components/icons") return icons;
  if (id === "@/lib/platform-access") return access;
  if (id === "@/lib/platform-admissions-task-contract") return taskContract;
  if (id === "@/lib/platform-staff-task-actions") return { mutateStaffTaskAction: unavailableAction };
  if (id === "@/lib/platform-admissions-task-actions") return { createPlatformAdmissionsTaskAction: unavailableAction };
  if (id === "@/lib/v3/task-case-actions") return { readTaskCaseAssigneesAction: unavailableAction };
  if (id === "@/lib/v3/task-composer-actions") return { readTaskComposerAssigneesAction: unavailableAction };
  if (id === "./ComposerDeadlineField") return deadline;
  if (id === "./TaskCasePicker") return casePicker;
  if (id === "../queue/queue-buttons") return queueButtons;
  return require(id);
});

const ID = "10000000-0000-4000-8000-000000000001";
const CASE = { id: "10000000-0000-4000-8000-000000000002", name: "Synthetic student" };
const scopedAdmissions = { systemRole: "staff", presentationRole: null, membershipId: ID,
  permissionKeys: ["case.read.full", "task.create", "task.manage"] };
/** The calendar's own gates (Calendar.tsx): case task and staff task. */
function render(actor) {
  const caseAllowed = access.staffPresentationCan(actor, "admissions.read") && !access.isStaffPreview(actor)
    && access.staffHasPermission(actor, "task.create");
  const staffAllowed = !access.isStaffPreview(actor) && access.staffHasPermission(actor, "staff.task.create");
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh: unavailableAction } },
    createElement(composer.TaskComposerDialog, {
      participants: [], actorMembershipId: ID, actor, day: "2099-09-12", defaultDueDay: "2099-09-12",
      staffAllowed, caseAllowed, initialCase: CASE,
      initialCaseAssignees: [{ membershipId: ID, displayName: "Synthetic curator" }],
      hideTrigger: true, openIntent: "calendar",
    }),
  ));
  assert.equal(actionCalls, 0, "SSR must not call server actions or navigation");
  return html;
}

test("actual scoped Admissions dialog renders no visibility selector and the command sends false", () => {
  assert.equal(access.staffHasPermission(scopedAdmissions, "task.create"), true);
  assert.equal(access.staffHasPermission(scopedAdmissions, "task.visibility.manage"), false);
  const html = render(scopedAdmissions);
  assert.match(html, /data-testid="v3-task-composer-dialog"/);
  assert.match(html, /data-composer-mode="case"/);
  assert.doesNotMatch(html, /name="student_visible"/);
  assert.match(html, /Студент\/дело: <\/span>Synthetic student/);
  // The command form is built by the dialog itself: hidden unless the grant is held.
  assert.match(read("src/components/v3/tasks/TaskComposerDialog.tsx"),
    /form\.set\("student_visible", canChangeVisibility && studentVisible \? "true" : "false"\);/);
  // The calendar's chosen day is the default deadline: all day on 12.09.2099.
  assert.match(html, /<input type="hidden" name="deadline_kind" value="all_day"\/>/);
  assert.match(html, /<input type="hidden" name="due_on" value="2099-09-12"\/>/);
});

test("the actual dialog retains visibility selection for its explicit permission and System Admin", () => {
  for (const actor of [
    { ...scopedAdmissions, permissionKeys: [...scopedAdmissions.permissionKeys, "task.visibility.manage"] },
    { systemRole: "admin", presentationRole: null, membershipId: ID, permissionKeys: [] },
  ]) {
    const html = render(actor);
    assert.equal([...html.matchAll(/name="student_visible"/g)].length, 1);
    assert.match(html, /<select name="student_visible"/);
    assert.match(html, /<option value="false" selected="">Скрыта<\/option>/);
    assert.match(html, /<option value="true">Видна<\/option>/);
    assert.doesNotMatch(html, /<input type="hidden" name="student_visible"/);
  }
});

test("preview and staff without task.create do not receive a create dialog", () => {
  assert.equal(render({ systemRole: "admin", presentationRole: "admissions", membershipId: ID, permissionKeys: [] }), "");
  assert.equal(render({ ...scopedAdmissions, permissionKeys: ["case.read.full"] }), "");
});

test("the real Auth scenario binds current Admissions rights and expects no visibility selector", () => {
  const source = read("tests/e2e/supabase-staff-auth.spec.ts");
  const begin = source.indexOf('test("real contract, payment and handoff open one Supabase Student 360 with role-safe access"');
  const end = source.indexOf('test("D2 media stays opaque', begin);
  assert.ok(begin >= 0 && end > begin);
  const scenario = source.slice(begin, end);
  const createBegin = scenario.indexOf('const createTask = page.getByTestId("v3-task-composer-dialog")');
  const createEnd = scenario.indexOf("const createdTask = page", createBegin);
  assert.ok(createBegin >= 0 && createEnd > createBegin);
  const creation = scenario.slice(createBegin, createEnd);
  // Э7: «Создать задачу» оболочки (с днём календаря), а у кого её нет — своя кнопка календаря.
  assert.match(scenario, /page\.locator\('a\[href="\/v3\/tasks\?create=staff"\], \[data-testid="v3-calendar-new-task"\]'\)\.filter\(\{ visible: true \}\)\.first\(\)\.click\(\)/);
  assert.doesNotMatch(render(scopedAdmissions), /name="student_visible"/);
  assert.ok(/expect\(createTask\.locator\('select\[name="student_visible"\]'\)\)\.toHaveCount\(0\)/.test(creation));
  assert.equal(/locator\('select\[name="student_visible"\]'\)[\s\S]*?\.selectOption/.test(creation), false);
  assert.ok(/locator\('button\[type="submit"\]'\)\.click\(\)/.test(creation));
  assert.ok(/expect\(admissionsAuthorityRow\.permissions\)\.toContain\("task\.create"\)/.test(scenario));
  assert.ok(/expect\(admissionsAuthorityRow\.permissions\)\.not\.toContain\("task\.visibility\.manage"\)/.test(scenario));
});
