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
import * as createLifecycle from "../src/components/v3/calendar/create-lifecycle.ts";
import * as wording from "../src/lib/v3/wording.ts";

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
const casePicker = compile("src/components/v3/tasks/TaskCasePicker.tsx", id => {
  if (id === "@/lib/v3/task-case-actions") return { searchTaskCasesAction: unavailableAction };
  return require(id);
});
const controls = compile("src/components/v3/calendar/TaskControls.tsx", id => {
  if (id === "@/lib/platform-access") return access;
  if (id === "@/lib/platform-admissions-task-contract") return taskContract;
  if (id === "@/lib/v3/wording") return wording;
  if (id === "./types") return calendarTypes;
  if (id === "./create-lifecycle") return createLifecycle;
  if (id === "../tasks/TaskCasePicker") return casePicker;
  if (id === "@/lib/platform-admissions-task-actions") return {
    createPlatformAdmissionsTaskAction: unavailableAction,
    changePlatformAdmissionsTaskAction: unavailableAction,
  };
  if (id === "@/lib/v3/task-case-actions") return { readTaskCaseAssigneesAction: unavailableAction };
  return require(id);
});

const ID = "10000000-0000-4000-8000-000000000001";
const CASE = { id: "10000000-0000-4000-8000-000000000002", name: "Synthetic student" };
const scopedAdmissions = { systemRole: "staff", presentationRole: null,
  permissionKeys: ["case.read.full", "task.create", "task.manage"] };
function render(actor) {
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh: unavailableAction } },
    createElement(controls.CalendarCreateTaskForm, {
      cases: [CASE], casesHaveMore: false, selectedCase: CASE,
      assignees: [{ membershipId: ID, displayName: "Synthetic curator" }],
      actorMembershipId: ID, actor, day: "2099-09-12", requestId: ID,
    }),
  ));
  assert.equal(actionCalls, 0, "SSR must not call server actions or navigation");
  return html;
}

test("actual scoped Admissions form submits one hidden false control, not a visibility selector", () => {
  assert.equal(access.staffHasPermission(scopedAdmissions, "task.create"), true);
  assert.equal(access.staffHasPermission(scopedAdmissions, "task.visibility.manage"), false);
  const html = render(scopedAdmissions);
  assert.match(html, /data-testid="v3-calendar-task-create-form"/);
  assert.equal([...html.matchAll(/name="student_visible"/g)].length, 1);
  assert.match(html, /<input type="hidden" name="student_visible" value="false"\/>/);
  assert.doesNotMatch(html, /<select\b[^>]*name="student_visible"/);
  assert.match(html, /name="student_case_id" value="10000000-0000-4000-8000-000000000002"/);
});

test("the actual component retains visibility selection for its explicit permission and System Admin", () => {
  for (const actor of [
    { ...scopedAdmissions, permissionKeys: [...scopedAdmissions.permissionKeys, "task.visibility.manage"] },
    { systemRole: "admin", presentationRole: null, permissionKeys: [] },
  ]) {
    const html = render(actor);
    assert.equal([...html.matchAll(/name="student_visible"/g)].length, 1);
    assert.match(html, /<select name="student_visible"/);
    assert.match(html, /<option value="false" selected="">Скрыта<\/option>/);
    assert.match(html, /<option value="true">Видна<\/option>/);
    assert.doesNotMatch(html, /<input type="hidden" name="student_visible"/);
  }
});

test("preview and staff without task.create do not receive a create form", () => {
  assert.equal(render({ systemRole: "admin", presentationRole: "admissions", permissionKeys: [] }), "");
  assert.equal(render({ ...scopedAdmissions, permissionKeys: ["case.read.full"] }), "");
});

test("the real Auth scenario binds current Admissions rights and expects the same rendered hidden control", () => {
  const source = read("tests/e2e/supabase-staff-auth.spec.ts");
  const begin = source.indexOf('test("real contract, payment and handoff open one Supabase Student 360 with role-safe access"');
  const end = source.indexOf('test("D2 media stays opaque', begin);
  assert.ok(begin >= 0 && end > begin);
  const scenario = source.slice(begin, end);
  const createBegin = scenario.indexOf('const createTask = page.getByTestId("v3-calendar-task-create-form")');
  const createEnd = scenario.indexOf("const createdTask = page", createBegin);
  assert.ok(createBegin >= 0 && createEnd > createBegin);
  const creation = scenario.slice(createBegin, createEnd);
  assert.match(render(scopedAdmissions), /<input type="hidden" name="student_visible" value="false"\/>/);
  assert.ok(/expect\(createTask\.locator\('input\[type="hidden"\]\[name="student_visible"\]'\)\)\.toHaveValue\("false"\)/.test(creation),
    "The real Auth test must assert the hidden false control rendered for scoped Admissions");
  assert.ok(/expect\(createTask\.locator\('select\[name="student_visible"\]'\)\)\.toHaveCount\(0\)/.test(creation));
  assert.equal(/locator\('select\[name="student_visible"\]'\)[\s\S]*?\.selectOption/.test(creation), false);
  assert.ok(/locator\('button\[type="submit"\]'\)\.click\(\)/.test(creation));
  assert.ok(/expect\(admissionsAuthorityRow\.permissions\)\.toContain\("task\.create"\)/.test(scenario));
  assert.ok(/expect\(admissionsAuthorityRow\.permissions\)\.not\.toContain\("task\.visibility\.manage"\)/.test(scenario));
});
