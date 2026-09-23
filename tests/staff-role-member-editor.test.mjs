import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const componentPath = new URL("../src/components/v3/settings/StaffRoleAssignments.tsx", import.meta.url);
const code = ts.transpileModule(readFileSync(componentPath, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

// Exercise the production component's state/event handlers with pure hook and form
// boundaries. This is not React DOM, server-action, Auth or browser acceptance.
function editorHarness() {
  const instances = new Map();
  let active;
  let cursor;
  const hooks = { useState(initial) {
    const instance = active;
    const index = cursor++;
    if (!(index in instance)) instance[index] = typeof initial === "function" ? initial() : initial;
    return [instance[index], (value) => { instance[index] = typeof value === "function" ? value(instance[index]) : value; }];
  } };
  const compiledModule = { exports: {} };
  const boundaryRequire = (id) => {
    if (id === "react") return hooks;
    if (id === "./StaffRoleForms") return { StaffRoleCommandForm: "command-form" };
    if (id === "@/components/ui") return { btnGhostCls: "button", inputCls: "input" };
    if (id === "@/lib/platform-admissions-playbook-contract") return { ADMISSIONS_DIRECTIONS: ["CN", "MY"] };
    if (id === "@/components/v3/profile/admissions-view") return { DIRECTION_LABELS: { CN: "Китай", MY: "Малайзия" } };
    if (id === "@/lib/v3/wording") return { staffScopeLabel: (kind) => ({ own: "Свои записи", organization: "Вся организация",
      department: "Отдел", direction: "Направление", record: "Отдельная запись" })[kind] ?? null };
    if (id === "@/lib/v3/staff-roles-contract") return { STAFF_SCOPE_KINDS: ["own", "organization", "department", "direction", "record"] };
    return require(id);
  };
  new Function("require", "module", "exports", code)(boundaryRequire, compiledModule, compiledModule.exports);
  function expand(node, path = "root") {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${index}`));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const key = `${path}/${node.type.name}:${node.key ?? ""}`;
      if (!instances.has(key)) instances.set(key, []);
      active = instances.get(key); cursor = 0;
      return expand(node.type(node.props), `${key}/result`);
    }
    return { ...node, props: { ...node.props, children: typeof node.props.children === "function"
      ? node.props.children : expand(node.props.children, `${path}/children`) } };
  }
  return { render: (props) => expand({ type: compiledModule.exports.StaffRoleAssignments, props }) };
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const formOf = (tree) => {
  const forms = nodes(tree, (node) => node.type === "command-form");
  assert.equal(forms.length, 1, "one active command prevents adjacent stale member mutations");
  return forms[0].props;
};
const field = (tree, name) => nodes(tree, (node) => node.type === "input" && node.props.name === name)[0]?.props.value;
const click = (tree, text) => {
  const button = nodes(tree, (node) => node.type === "button" && node.props.children === text)[0];
  assert.ok(button, text); assert.ok(!button.props.disabled, `${text} enabled`); button.props.onClick();
};
const role = { id: "role", version: 3, bundleId: "bundle", bundleVersion: 2, label: "Работа", status: "active", permissionKeys: ["task.manage"] };
const member = { membershipId: "member", displayName: "Сотрудник", systemRole: "staff", accessVersion: 7,
  assignments: [{ id: "assignment", roleId: "role", scope: { kind: "own", key: null, resourceKind: null } }] };
const workspace = { roles: [role], permissions: [{ key: "task.manage", allowedScopes: ["own", "organization"] }], departments: [] };
const props = (value = member, source = workspace) => ({ member: value, workspace: source, organizationId: "org" });
const saved = (version) => ({ status: "success", message: "Сохранено", membershipId: "member", accessVersion: version });

test("confirmed assignments and Admin changes explicitly restart with the latest member version", () => {
  const harness = editorHarness();
  let form = formOf(harness.render(props()));
  assert.equal(field(form.children(false, {}), "expected_version"), 7);
  const updated = { ...member, accessVersion: 8 };
  form = formOf(harness.render(props(updated)));
  assert.equal(field(form.children(false, {}), "expected_version"), 7, "props alone never remount a command");
  click(form.onComplete(saved(8)), "Изменить доступ Admin");
  form = formOf(harness.render(props(updated)));
  assert.equal(field(form.children(false, {}), "expected_version"), 8);
  assert.equal(field(form.children(false, {}), "operation"), "admin");
  assert.equal(field(form.children(false, {}), "enabled"), "true");
  const admin = { ...updated, systemRole: "admin", accessVersion: 9 };
  form = formOf(harness.render(props(admin)));
  click(form.onComplete(saved(9)), "Изменить назначения");
  form = formOf(harness.render(props(admin)));
  assert.equal(field(form.children(false, {}), "expected_version"), 9);
  assert.equal(field(form.children(false, {}), "operation"), "assignments");
});

test("unknown, unconfirmed and not-yet-refreshed commands cannot start a new editor", () => {
  const harness = editorHarness();
  const form = formOf(harness.render(props()));
  for (const state of [{ status: "error", outcome: "unknown" }, { ...saved(8), outcome: "unknown" }, saved(8),
    { status: "success" }, { ...saved(7), membershipId: "other" }]) {
    const next = nodes(form.onComplete(state), (node) => node.type === "button");
    assert.ok(next.every((node) => node.props.disabled), "a confirmed matching receipt and fresh member are required");
  }
  const controls = nodes(form.children(true, { status: "error", outcome: "unknown" }), (node) => node.type === "button");
  assert.ok(controls.every((node) => node.props.disabled), "pending/unknown cannot switch modes or modify rows");
});

test("selected-role bindings and member payload remain pinned across incoming workspace updates", () => {
  const harness = editorHarness();
  formOf(harness.render(props()));
  const changed = { ...workspace, roles: [{ ...role, version: 4, bundleId: "new-bundle", bundleVersion: 3 }] };
  const form = formOf(harness.render(props({ ...member, accessVersion: 8 }, changed)));
  const inputs = form.children(false, {});
  assert.equal(field(inputs, "expected_version"), 7);
  assert.deepEqual(JSON.parse(field(inputs, "expected_role_bindings")), [{ roleId: "role", roleVersion: 3, bundleId: "bundle", bundleVersion: 2 }]);
  assert.deepEqual(JSON.parse(field(inputs, "assignments")), [{ roleId: "role", scope: member.assignments[0].scope }]);
  click(form.onComplete(saved(8)), "Изменить назначения");
  const next = formOf(harness.render(props({ ...member, accessVersion: 8 }, changed)));
  assert.deepEqual(JSON.parse(field(next.children(false, {}), "expected_role_bindings")), [{ roleId: "role", roleVersion: 4, bundleId: "new-bundle", bundleVersion: 3 }]);
});

test("one reviewed role binding covers multiple paired scopes and empty assignments send none", () => {
  const harness = editorHarness();
  const multiple = { ...member, assignments: [...member.assignments, { ...member.assignments[0], id: "second",
    scope: { kind: "organization", key: "org", resourceKind: null } }] };
  let form = formOf(harness.render(props(multiple)));
  assert.equal(JSON.parse(field(form.children(false, {}), "expected_role_bindings")).length, 1);
  const scopes = JSON.parse(field(form.children(false, {}), "assignments")).map((row) => row.scope);
  assert.deepEqual(scopes, multiple.assignments.map((row) => row.scope));
  for (let index = 0; index < 2; index++) {
    click(form.children(false, {}), "Убрать назначение");
    form = formOf(harness.render(props(multiple)));
  }
  assert.equal(field(form.children(false, {}), "assignments"), "[]");
  assert.equal(field(form.children(false, {}), "expected_role_bindings"), "[]");
});

test("switching unsent editor mode preserves draft assignments and never exposes two commands", () => {
  const harness = editorHarness();
  let form = formOf(harness.render(props()));
  click(form.children(false, {}), "Убрать назначение");
  form = formOf(harness.render(props()));
  click(form.children(false, {}), "Системный доступ администратора");
  form = formOf(harness.render(props()));
  assert.equal(field(form.children(false, {}), "operation"), "admin");
  assert.equal(field(form.children(false, {}), "assignments"), undefined);
  click(form.children(false, {}), "Назначения ролей");
  form = formOf(harness.render(props()));
  assert.equal(field(form.children(false, {}), "assignments"), "[]");
  assert.equal(field(form.children(false, {}), "enabled"), undefined);
});

test("existing command hook keeps the original request payload after an unknown result", async () => {
  const source = readFileSync(new URL("../src/components/v3/settings/StaffRoleForms.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const attempts = [];
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    if (id === "react") return { useRef: (current) => ({ current }), useActionState: (action) => action };
    if (id === "@/components/ui") return {};
    if (id === "@/lib/v3/staff-roles-contract") return { STAFF_ROLES_INITIAL_STATE: { status: "idle", message: "" } };
    if (id === "@/lib/staff-roles-actions") return { staffRolesAction: async (_, form) => {
      attempts.push([...form.entries()]);
      return attempts.length === 1 ? { status: "error", outcome: "unknown" } : saved(8);
    } };
    return require(id);
  }, compiledModule, compiledModule.exports);
  const action = compiledModule.exports.useStaffRoleForm();
  const original = new FormData();
  original.set("operation", "assignments"); original.set("expected_version", "7");
  original.set("expected_role_bindings", JSON.stringify([{ roleId: "role", roleVersion: 3, bundleId: "bundle", bundleVersion: 2 }]));
  const unknown = await action({ status: "idle" }, original);
  const changed = new FormData(); changed.set("operation", "admin"); changed.set("expected_version", "8");
  await action(unknown, changed);
  assert.deepEqual(attempts[1], attempts[0]);
  assert.ok(attempts[0].some(([key, value]) => key === "request_id" && value));
});

const textOf = (node) => node === null || node === undefined || typeof node === "boolean" ? ""
  : typeof node === "string" || typeof node === "number" ? String(node)
  : Array.isArray(node) ? node.map(textOf).join("") : textOf(node.props?.children);

test("a saved assignment command shows the server readback, never its reset draft or version jargon", () => {
  const harness = editorHarness();
  let form = formOf(harness.render(props()));
  assert.equal(form.keepDraftOnReset, true, "a failed command keeps the reviewed selects instead of the form's reset defaults");
  assert.equal(form.children(true, saved(8)), null, "no draft rows (and no empty «Выберите роль») beside the saved message");
  assert.notEqual(form.children(true, { status: "error", outcome: "unknown" }), null, "an unknown outcome keeps the original command visible");

  let done = form.onComplete(saved(8));
  assert.match(textOf(nodes(done, (node) => node.props?.role === "status")), /^Загружаем сохранённый доступ\. Если он не появился, обновите страницу\.$/u);
  assert.equal(nodes(done, (node) => node.type === "li").length, 0, "the stale pre-save snapshot is not presented as saved");
  assert.doesNotMatch(textOf(done), /верси/u);

  const fresh = { ...member, accessVersion: 8, assignments: [
    { id: "a1", roleId: "role", label: "Работа", bundleId: "bundle", bundleVersion: 2, scope: { kind: "direction", key: "CN", resourceKind: null } },
    { id: "a2", roleId: "role", label: "Работа", bundleId: "bundle", bundleVersion: 2, scope: { kind: "department", key: "dep", resourceKind: null } },
  ] };
  const freshWorkspace = { ...workspace, departments: [{ id: "dep", name: "Продажи", status: "active" }] };
  form = formOf(harness.render(props(fresh, freshWorkspace)));
  done = form.onComplete(saved(8));
  assert.deepEqual(nodes(done, (node) => node.type === "li").map(textOf), ["Работа · Направление: Китай", "Работа · Отдел: Продажи"]);
  assert.equal(nodes(done, (node) => node.props?.role === "status").length, 0);
  click(done, "Изменить назначения");
  form = formOf(harness.render(props(fresh, freshWorkspace)));
  assert.equal(field(form.children(false, {}), "expected_version"), 8, "the next edit starts from the same readback");
  assert.deepEqual(JSON.parse(field(form.children(false, {}), "assignments")).map((row) => row.scope.kind), ["direction", "department"]);

  for (const [readback, lines] of [[{ ...member, accessVersion: 8, assignments: [] }, ["Роли не назначены"]],
    [{ ...member, systemRole: "admin", accessVersion: 8, assignments: [] }, ["Системный доступ администратора"]]]) {
    const next = editorHarness();
    formOf(next.render(props()));
    const summary = formOf(next.render(props(readback))).onComplete(saved(8));
    assert.deepEqual(nodes(summary, (node) => node.type === "li").map(textOf), lines);
  }
  const editorSource = readFileSync(componentPath, "utf8");
  assert.doesNotMatch(editorSource, /подтверждения версии|Ожидаем актуальные данные/u);
});

test("the reset guard is opt-in and only cancels the form's own reset", () => {
  const source = readFileSync(new URL("../src/components/v3/settings/StaffRoleForms.tsx", import.meta.url), "utf8");
  assert.match(source, /keepDraftOnReset = false/u);
  assert.match(source, /if \(!keepDraftOnReset \|\| !form\) return;/u);
  assert.match(source, /form\.addEventListener\("reset", preserveDraft\)/u);
  assert.match(source, /return \(\) => form\.removeEventListener\("reset", preserveDraft\)/u);
});

// StaffSection with its import boundaries replaced; element tree only.
function staffSectionHarness() {
  const instances = new Map();
  let active;
  let cursor;
  const slot = (initial) => {
    const instance = active;
    const index = cursor++;
    if (!(index in instance)) instance[index] = typeof initial === "function" ? initial() : initial;
    return [instance, index];
  };
  const hooks = {
    useState(initial) {
      const [instance, index] = slot(initial);
      return [instance[index], (value) => { instance[index] = typeof value === "function" ? value(instance[index]) : value; }];
    },
    useRef(initial) { const [instance, index] = slot(() => ({ current: initial })); return instance[index]; },
    useId() { const [instance, index] = slot(() => `id-${instances.size}-${cursor}`); return instance[index]; },
    useCallback: (callback) => callback,
    useActionState: (action, initial) => [initial, action, false],
  };
  const idle = { status: "idle", message: "" };
  const boundary = {
    react: hooks,
    "next/link": { default: "a" },
    "@/lib/staff-workspace-actions": { staffAuthAction: "auth-action", staffMemberAction: "member-action" },
    "@/lib/v3/staff-workspace-contract": { STAFF_WORKSPACE_INITIAL_STATE: idle, staffAuthRejectionMessage: () => "" },
    "@/components/ui": { btnGhostCls: "ghost-button", btnDangerGhostCls: "danger-button", inputCls: "input" },
    "./StaffDirectoryList": { StaffDirectoryList: "directory" },
    "./StaffMemberDetails": { StaffMemberDetails: "member-details" },
    "./DepartmentsSection": { DepartmentsSection: "departments" },
    "./StaffRolesSection": { StaffRolesSection: "roles" },
    "./StaffRoleAssignments": { StaffRoleAssignments: "role-assignments" },
    "./StaffInviteForm": { StaffInviteForm: "invite", StaffPasswordForm: "password" },
    "./StaffPendingAccess": { StaffPendingAccess: "pending" },
    "./StaffDisclosure": { StaffDisclosure: "disclosure" },
    "./useStaffCommandForm": { useStaffCommandForm: () => [idle, "command", false], StaffCommandFeedback: "feedback" },
    "@/lib/v3/staff-invitation-access": { staffReconcileAllowsPreparation: () => true },
  };
  const sectionCode = ts.transpileModule(readFileSync(new URL("../src/components/v3/settings/StaffSection.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", sectionCode)((id) => boundary[id] ?? require(id), compiled, compiled.exports);
  function expand(node, path = "root") {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${index}`));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const key = `${path}/${node.type.name}:${node.key ?? ""}`;
      if (!instances.has(key)) instances.set(key, []);
      active = instances.get(key); cursor = 0;
      return expand(node.type(node.props), `${key}/result`);
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}/children`) } };
  }
  return (status) => expand({ type: compiled.exports.StaffSection, props: {
    data: { available: true, departments: [], requests: [], members: [{ membershipId: "member", displayName: "Сотрудник", status, version: 7,
      metadata: { jobTitle: null, departmentId: null, directions: [], version: 1 } }] },
    roles: { ...workspace, members: [member] }, organizationId: "org", view: "people", selectedMemberId: "member",
  } });
}

test("block/restore and sign-in recovery sit in a separate «Опасные действия» zone after the assignments", () => {
  const render = staffSectionHarness();
  for (const [status, actions] of [["active", ["Заблокировать доступ", "Отправить восстановление входа"]], ["suspended", ["Восстановить доступ"]]]) {
    const tree = render(status);
    const [panel] = nodes(tree, (node) => node.type === "disclosure" && node.props.label === "Доступ");
    const [zone] = nodes(panel, (node) => node.type === "section");
    assert.ok(zone, status);
    const [heading] = nodes(zone, (node) => node.type === "h4");
    assert.equal(textOf(heading), "Опасные действия");
    assert.equal(zone.props["aria-labelledby"], heading.props.id, "the zone is a named region");
    assert.match(zone.props.className, /\bborder-danger\/40\b/u);
    assert.match(heading.props.className, /\btext-danger\b/u);
    const submits = nodes(zone, (node) => node.type === "button" && node.props.type === "submit");
    assert.deepEqual(submits.map((node) => textOf(node)), actions);
    assert.ok(submits.every((node) => node.props.className === "danger-button"), "existing danger button styling");
    assert.equal(nodes(zone, (node) => node.type === "role-assignments").length, 0, "routine assignments stay outside the zone");
    const order = nodes(panel, (node) => node.type === "role-assignments" || node === zone);
    assert.deepEqual(order.map((node) => node.type), ["role-assignments", "section"], "«Сохранить назначения» comes first, danger last");
    assert.ok(nodes(zone, (node) => node.type === "input" && node.props.name === "reason").every((input) => input.props.required));
  }
});
