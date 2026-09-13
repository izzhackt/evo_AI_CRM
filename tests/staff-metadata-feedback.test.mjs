import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const initial = { status: "idle", message: "" };
const saved = { status: "success", message: "Рабочие сведения сохранены." };
const member = { membershipId: "member", displayName: "Проверка интерфейса", status: "active",
  metadata: { version: 7, departmentId: "sales", jobTitle: "Менеджер", directions: ["CN"] } };
const departments = [{ id: "sales", name: "Продажи", status: "active" },
  { id: "admissions", name: "Поступление", status: "active" }];

function compile(path, boundary) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)((id) => boundary(id) ?? require(id), compiled, compiled.exports);
  return compiled.exports;
}
function component(react) {
  return compile("../src/components/v3/settings/StaffMemberDetails.tsx", (id) => {
    if (id === "react") return react;
    if (id === "next/link") return { default: ({ children, ...props }) => createElement("a", props, children) };
    if (id === "@/components/ui") return { btnCls: "button", btnGhostCls: "button", inputCls: "input" };
    if (id === "@/components/v3/profile/admissions-view") return { DIRECTION_LABELS: { CN: "Китай", MY: "Малайзия" } };
    if (id === "@/lib/platform-admissions-playbook-contract") return { ADMISSIONS_DIRECTIONS: ["CN", "MY"] };
    if (id === "@/lib/staff-workspace-actions") return { staffOrganizationalDetailsAction: async () => saved };
    if (id === "@/lib/v3/staff-workspace-contract") return { STAFF_WORKSPACE_INITIAL_STATE: initial };
    if (id === "@/lib/v3/wording") return { staffDirectoryAccessSummary: () => "Сотрудник" };
  }).StaffMemberDetails;
}

// Production component/state handlers with hook boundaries, not a DOM/browser substitute.
function editor() {
  const instances = new Map(), effects = []; let active, cursor, result = initial;
  const useState = (value) => {
    const state = active, index = cursor++;
    if (!(index in state)) state[index] = typeof value === "function" ? value() : value;
    return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
  };
  const Component = component({ useState, useRef: (value) => useState({ current: value })[0],
    useId: () => useState("department-change-note")[0], useEffect: (effect) => effects.push(effect),
    useActionState: () => [result, () => {}, false] });
  function expand(node, path = "root") {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${index}`));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const key = `${path}/${node.type.name}`;
      if (!instances.has(key)) instances.set(key, []);
      active = instances.get(key); cursor = 0;
      return expand(node.type(node.props), `${key}/result`);
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}/children`) } };
  }
  return { render: (current = member) => expand(createElement(Component, { member: current, departments }, null)),
    mountEffects: () => effects.splice(0).map((effect) => effect()).filter((cleanup) => typeof cleanup === "function"),
    saved: () => { result = saved; } };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((node) => nodes(node, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const field = (tree, name) => nodes(tree, (node) => node.props.name === name)[0];
const notes = (tree) => nodes(tree, (node) => node.props.role === "note");
function openEditor(harness, current = member) {
  const tree = harness.render(current);
  nodes(tree, (node) => node.type === "button" && node.props.children === "Редактировать")[0].props.onClick();
  return harness.render(current);
}

test("staff metadata explains that the job title does not grant access in real React SSR", () => {
  const html = renderToStaticMarkup(createElement(component(), { member, departments }, null));
  assert.match(html, /Должность не даёт прав доступа/);
  assert.doesNotMatch(html, /role="note"/);
});

test("department warning appears only for a changed selection and does not clear drafts", () => {
  const harness = editor(); let tree = openEditor(harness);
  assert.equal(notes(tree).length, 0);
  field(tree, "job_title").props.onChange({ target: { value: "Новая должность" } });
  field(tree, "reason").props.onChange({ target: { value: "Перевод команды" } });
  tree = harness.render(); assert.equal(notes(tree).length, 0);
  field(tree, "department_id").props.onChange({ target: { value: "admissions" } });
  tree = harness.render(); assert.equal(notes(tree).length, 1);
  assert.match(notes(tree)[0].props.children, /доступные записи будут пересчитаны/);
  assert.equal(field(tree, "department_id").props["aria-describedby"], notes(tree)[0].props.id);
  assert.equal(field(tree, "job_title").props.value, "Новая должность");
  assert.equal(field(tree, "reason").props.value, "Перевод команды");
  const refreshed = { ...member, metadata: { ...member.metadata, version: 8, departmentId: "admissions" } };
  tree = harness.render(refreshed);
  assert.equal(notes(tree).length, 1, "a background refresh never silently rebases the open command");
  assert.equal(field(tree, "expected_version").props.value, 7);
  field(tree, "department_id").props.onChange({ target: { value: "sales" } });
  tree = harness.render(refreshed); assert.equal(notes(tree).length, 0);
  assert.equal(field(tree, "reason").props.value, "Перевод команды");
});

test("clearing a department warns, but a saved change has only its confirmed feedback", () => {
  const harness = editor(); let tree = openEditor(harness);
  field(tree, "department_id").props.onChange({ target: { value: "" } });
  tree = harness.render(); assert.equal(notes(tree).length, 1);
  harness.saved(); tree = harness.render(); assert.equal(notes(tree).length, 0);
  assert.equal(nodes(tree, (node) => node.props.role === "status")[0].props.children, saved.message);
});

test("an employee without a department is warned only when a department is selected", () => {
  const current = { ...member, metadata: { ...member.metadata, departmentId: null } };
  const harness = editor(); let tree = openEditor(harness, current);
  assert.equal(notes(tree).length, 0);
  field(tree, "department_id").props.onChange({ target: { value: "sales" } });
  tree = harness.render(current); assert.equal(notes(tree).length, 1);
  field(tree, "department_id").props.onChange({ target: { value: "" } });
  tree = harness.render(current); assert.equal(notes(tree).length, 0);
});

test("metadata form prevents a native action reset from discarding its controlled draft", () => {
  const harness = editor(); let tree = openEditor(harness);
  field(tree, "department_id").props.onChange({ target: { value: "admissions" } });
  tree = harness.render();
  const form = nodes(tree, (node) => node.type === "form")[0];
  const target = new EventTarget();
  if (form.props.ref) form.props.ref.current = target;
  const cleanups = harness.mountEffects();
  assert.equal(target.dispatchEvent(new Event("reset", { cancelable: true })), false,
    "commit-time native reset must be prevented without a React delegated event");
  assert.equal(field(harness.render(), "department_id").props.value, "admissions");
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(target.dispatchEvent(new Event("reset", { cancelable: true })), true,
    "unmount removes the native listener");
});

test("confirmed metadata action returns neutral feedback and preserves the submitted command", async () => {
  const calls = [], paths = [];
  const actions = compile("../src/lib/staff-workspace-actions.ts", (id) => {
    if (id === "next/cache") return { revalidatePath: (path) => paths.push(path) };
    if (id === "./server/staff-workspace-service") return { saveStaffOrganizationalDetails: async (form) => calls.push(form) };
    if (id === "./v3/staff-workspace-contract") return {};
  });
  const form = new FormData(); form.set("expected_version", "7"); form.set("department_id", "admissions");
  assert.deepEqual(await actions.staffOrganizationalDetailsAction(initial, form), saved);
  assert.equal(calls.length, 1); assert.equal(calls[0], form); assert.deepEqual(paths, ["/v3/settings"]);
});
