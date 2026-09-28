// OTH-1 «Воронка поступления» — source-contract pins only. No Supabase
// credentials in this environment (same convention as
// tests/platform-lead-sale-conditions-migration.test.mjs): the migration is
// read and pattern-matched, not applied or executed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The client-safe contract lives in its own module so the client board never
// traces supabase/server into the bundle (Build gate); the server module
// re-exports it.
const contract = source("src/lib/platform-admissions-pipeline-contract.ts");
const serverModule = source("src/lib/platform-admissions-pipeline.ts");
const board = source("src/components/v3/AdmissionsPipelineBoard.tsx");
const boardPrimitive = source("src/components/v3/board/Board.tsx");
const actions = source("src/lib/platform-admissions-pipeline-actions.ts");
const page = source("src/app/(v3)/v3/admissions-pipeline/page.tsx");
const migration = source("supabase/migrations/187_platform_admissions_pipeline_board.sql");
const fixedRolePolicy = source("src/lib/fixed-role-policy.ts");
const navigation = source("src/lib/v3/navigation.ts");

const STAGE_KEYS = [
  "new",
  "shortlist",
  "documents",
  "ready_to_submit",
  "awaiting_decision",
  "confirmed",
  "visa",
  "predeparture",
  "arrived",
];

test("the 9 pipeline stage keys exist exactly once each, in order, in ADMISSIONS_PIPELINE_STAGES", () => {
  const arrayText = contract.slice(
    contract.indexOf("export const ADMISSIONS_PIPELINE_STAGES = ["),
    contract.indexOf("] as const;", contract.indexOf("export const ADMISSIONS_PIPELINE_STAGES = [")),
  );
  for (const key of STAGE_KEYS) {
    const matches = arrayText.match(new RegExp(`"${key}"`, "gu")) ?? [];
    assert.equal(matches.length, 1, `"${key}" should appear exactly once in ADMISSIONS_PIPELINE_STAGES: found ${matches.length}`);
  }
  assert.deepEqual([...arrayText.matchAll(/"([a-z_]+)"/gu)].map((m) => m[1]), STAGE_KEYS);
});

test("the board never calls the fact-gated admissions playbook RPC or imports its actions", () => {
  // The board's OWN module (contract) never calls the playbook transition RPC
  // by name and never imports the playbook's server actions — the specific,
  // checkable claim the task asks for (a bare textual ban on the words
  // "operational_stage"/"admissions_version" would also flag this file's own
  // header comment explaining that it does NOT touch them).
  for (const file of [contract, serverModule, board, actions, page]) {
    assert.doesNotMatch(file, /\.rpc\(\s*"transition_case_admissions_v1"/u);
  }
  assert.doesNotMatch(board, /from "@\/lib\/platform-admissions-playbook/u);
  assert.doesNotMatch(board, /platform-admissions-actions/u);
  assert.doesNotMatch(actions, /platform-admissions-playbook/u);
});

test("the card menu offers «Переместить в…» and «Убрать из воронки», grouped by tab", () => {
  assert.match(board, /Переместить в…/u);
  assert.match(board, /Убрать из воронки/u);
  // Boards 25.09: the menu is a top-layer popover (TopLayerMenu) carrying the same test id.
  assert.match(board, /testId="v3-admissions-pipeline-move"/u);
  assert.match(board, /data-testid="v3-admissions-pipeline-board"/u);
  assert.match(board, /data-testid="v3-admissions-pipeline-card"/u);
  assert.match(board, /ADMISSIONS_PIPELINE_TAB_STAGES\[tabKey\]\.filter\(\(stage\) => stage !== row\.pipelineStage\)/u);
  assert.match(board, /tabTargets\(tab\)\.map/u, "this tab's stages first");
  assert.match(board, /Другой раздел/u);
  assert.match(board, /tabTargets\(otherTab\)\.map/u, "the other tab's stages behind «Другой раздел»");
});

test("a failed move renders a role=\"alert\" error and reverts the optimistic move", () => {
  assert.match(board, /role="alert"/u);
  assert.match(board, /studentCaseId === studentCaseId \? \{ \.\.\.row, pipelineStage: previousStage \}/u);
  assert.match(board, /if \(result\.status !== "saved"\)/u);
});

test("quiet UI: no explanatory helper paragraph, empty column is one quiet shared line, empty board is one line", () => {
  assert.doesNotMatch(board, /Пусто/u);
  // Boards 25.09: both boards share the empty-column line of the Board primitive.
  assert.match(board, /emptyText=\{BOARD_EMPTY\.cases\}/u);
  assert.match(boardPrimitive, /BOARD_EMPTY = \{ leads: "Нет лидов", cases: "Нет дел" \}/u);
  assert.match(board, /Дел в работе нет\./u);
});

test("moving to the other tab offers a same-card inline link to switch tabs", () => {
  assert.match(board, /crossTabHint/u);
  assert.match(board, /Открыть в «\{admissionsPipelineTab\(hint\.tab\)\}»/u);
});

test("the route is registered as admissions.read-gated in fixed-role-policy", () => {
  assert.match(fixedRolePolicy, /"\/v3\/admissions-pipeline",/u);
  const anyOf = fixedRolePolicy.slice(
    fixedRolePolicy.indexOf("const ROUTE_CAPABILITY_ANY_OF"),
    fixedRolePolicy.indexOf("} as const satisfies Record<FixedRoleRoute", fixedRolePolicy.indexOf("const ROUTE_CAPABILITY_ANY_OF")),
  );
  assert.match(anyOf, /"\/v3\/admissions-pipeline":\s*\["admissions\.read"\]/u);
});

test("the navigation entry is the first item of the Поступление group", () => {
  const group = navigation.slice(navigation.indexOf('id: "admissions",'), navigation.indexOf('id: "sales-report"') > -1 ? navigation.length : navigation.length);
  const admissionsGroupStart = navigation.indexOf('id: "admissions",');
  const linksStart = navigation.indexOf("links: [", admissionsGroupStart);
  const firstLinkEnd = navigation.indexOf("},", linksStart);
  const firstLink = navigation.slice(linksStart, firstLinkEnd);
  assert.match(firstLink, /id: "admissions-pipeline"/u);
  assert.match(firstLink, /href: "\/v3\/admissions-pipeline"/u);
  assert.match(firstLink, /label: "Воронка поступления"/u);
  void group;
});

test("migration 187 continues the contiguous source ledger", async () => {
  const { expectedMigrationVersions } = await import("../scripts/fast-release-ledger-gate.mjs");
  const { fileURLToPath } = await import("node:url");
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("185") && versions.includes("186"));
});

test("migration is transactional and fails closed on source drift, like 181/182/185", () => {
  assert.match(migration, /^BEGIN;$/mu);
  assert.match(migration, /^COMMIT;\s*$/mu);
  assert.match(migration, /RAISE EXCEPTION/u);
  assert.doesNotMatch(migration, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("student_cases gains exactly the 9-key pipeline_stage CHECK plus pipeline_hidden_at", () => {
  assert.match(migration, /ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'new' CHECK \(pipeline_stage IN \(/u);
  const checkBlock = migration.slice(
    migration.indexOf("CHECK (pipeline_stage IN ("),
    migration.indexOf("ADD COLUMN pipeline_hidden_at"),
  );
  for (const key of STAGE_KEYS) {
    assert.match(checkBlock, new RegExp(`'${key}'`), key);
  }
  assert.match(migration, /ADD COLUMN pipeline_hidden_at TIMESTAMPTZ NULL;/u);
});

test("the migration proves pipeline_stage/pipeline_hidden_at never trip admissions_case_command_guard (137)", () => {
  assert.match(migration, /admissions_case_command_guard/u);
  assert.match(migration, /never (?:trip|need)s? an admissions_version bump|never (?:trips|needs) an admissions_version bump/iu);
});

test("move_case_pipeline_v1 is SECURITY DEFINER, search_path-locked and REVOKE/GRANT-paired to authenticated only", () => {
  assert.match(migration, /CREATE FUNCTION platform\.move_case_pipeline_v1\(\s*p_organization_id UUID, p_student_case_id UUID, p_stage TEXT, p_remove BOOLEAN, p_request_id UUID\s*\)/u);
  const fn = migration.slice(
    migration.indexOf("CREATE FUNCTION platform.move_case_pipeline_v1("),
    migration.indexOf("REVOKE ALL ON FUNCTION platform.move_case_pipeline_v1"),
  );
  assert.match(fn, /SECURITY DEFINER/u);
  assert.match(fn, /SET search_path = ''/u);
  assert.match(fn, /platform_private\.staff_can_access\(p_organization_id, actor\.membership_id, 'case\.update\.append', 'student_case', p_student_case_id\)/u);
  assert.match(fn, /'Case is not active in this pipeline' USING ERRCODE = '22023'/u);
  assert.match(fn, /INSERT INTO platform\.audit_events/u);
  assert.match(fn, /'case\.pipeline\.move'/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION platform\.move_case_pipeline_v1\(UUID, UUID, TEXT, BOOLEAN, UUID\)\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION platform\.move_case_pipeline_v1\(UUID, UUID, TEXT, BOOLEAN, UUID\)\s*TO authenticated;/u,
  );
});

test("move_case_pipeline_v1 replays by (organization_id,request_id) receipt, not by re-running the mutation", () => {
  const fn = migration.slice(
    migration.indexOf("CREATE FUNCTION platform.move_case_pipeline_v1("),
    migration.indexOf("REVOKE ALL ON FUNCTION platform.move_case_pipeline_v1"),
  );
  assert.match(fn, /pg_advisory_xact_lock\(hashtextextended\('case-pipeline:' \|\| p_organization_id::TEXT \|\| ':' \|\| p_student_case_id::TEXT, 0\)\)/u);
  assert.match(fn, /fingerprint := md5\(jsonb_build_object\(/u);
  assert.match(fn, /RETURN prior\.receipt;/u);
  assert.match(fn, /'case_pipeline_request_id_conflict' USING ERRCODE = '22023'/u);
});

test("no optimistic version on the pipeline field — the one-line last-write-wins decision is documented", () => {
  const fn = migration.slice(
    migration.indexOf("CREATE FUNCTION platform.move_case_pipeline_v1("),
    migration.indexOf("REVOKE ALL ON FUNCTION platform.move_case_pipeline_v1"),
  );
  assert.doesNotMatch(fn, /p_expected_version|expected_version/u);
  assert.match(migration, /Deliberately no optimistic version check/u);
});

test("staff_admissions_pipeline_board_v1 is a NEW read RPC and does not widen staff_student_case_page", () => {
  assert.match(
    migration,
    /CREATE FUNCTION platform\.staff_admissions_pipeline_board_v1\(\s*p_curator_membership_id UUID DEFAULT NULL, p_direction TEXT DEFAULT NULL,\s*p_country TEXT DEFAULT NULL, p_query TEXT DEFAULT NULL\s*\)/u,
  );
  assert.doesNotMatch(migration, /ALTER FUNCTION platform\.staff_student_case_page|CREATE OR REPLACE FUNCTION platform\.staff_student_case_page/u);
  const fn = migration.slice(
    migration.indexOf("CREATE FUNCTION platform.staff_admissions_pipeline_board_v1("),
    migration.indexOf("REVOKE ALL ON FUNCTION platform.staff_admissions_pipeline_board_v1"),
  );
  assert.match(fn, /SECURITY DEFINER/u);
  assert.match(fn, /SET search_path = ''/u);
  assert.match(fn, /private\.platform_can_read_student_case\(c\.organization_id, c\.id\)/u);
  assert.match(fn, /platform_private\.admissions_attention_flags\(c\.id\)/u);
  assert.match(fn, /c\.state = 'active'/u);
  assert.match(fn, /c\.pipeline_hidden_at IS NULL/u);
  assert.match(fn, /LIMIT 401/u);
  assert.match(fn, /LIMIT 400/u);
  assert.match(fn, /'truncated', \(SELECT count\(\*\) FROM visible\) > 400/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION platform\.staff_admissions_pipeline_board_v1\(UUID, TEXT, TEXT, TEXT\)\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION platform\.staff_admissions_pipeline_board_v1\(UUID, TEXT, TEXT, TEXT\)\s*TO authenticated;/u,
  );
});

test("the new audit action is added to the p7a_safe_audit_actions allowlist, same rename-and-replace pattern as 179/181", () => {
  assert.match(migration, /RENAME TO p7a_safe_audit_actions_pre_admissions_pipeline_board;/u);
  assert.match(migration, /ARRAY\['case\.pipeline\.move'\]::TEXT\[\]/u);
});

// UX quick win 1 (Impeccable harden, 2026-09-24): the production board source is
// compiled with its import boundaries replaced and its element tree driven
// through pure hooks. Not React DOM, a browser, Auth or the live server action.
function boardHarness(moveAction) {
  const require = createRequire(import.meta.url);
  const compile = (path, boundary, globals = {}) => {
    const code = ts.transpileModule(source(path), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const compiled = { exports: {} };
    new Function("require", "module", "exports", ...Object.keys(globals), code)(
      (id) => boundary(id) ?? require(id), compiled, compiled.exports, ...Object.values(globals));
    return compiled.exports;
  };
  const pipelineContract = compile("src/lib/platform-admissions-pipeline-contract.ts", () => undefined);
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
    useTransition() { return [false, (run) => run()]; },
    useEffect() {},
    useCallback(callback) { return callback; },
  };
  const ui = { btnGhostCls: "ghost-button", cn: (...classes) => classes.filter(Boolean).join(" ") };
  const icons = { Icon: "svg" };
  // The shared Board primitive and the top-layer menu are production sources
  // too (boards 25.09): compiled with the same boundaries, not stubbed away.
  const boardTracks = compile("src/components/v3/board/board-tracks.ts", () => undefined);
  const boardPrimitive = compile("src/components/v3/board/Board.tsx", (id) => ({
    "next/link": { default: "a" }, "@/components/icons": icons, "@/components/ui": ui,
    "@/components/v3/board/board-tracks": boardTracks,
  })[id]);
  const menuPosition = compile("src/components/v3/board/menu-position.ts", () => undefined);
  const topLayerMenu = compile("src/components/v3/board/TopLayerMenu.tsx", (id) => ({
    react: hooks, "@/components/v3/board/menu-position": menuPosition,
  })[id]);
  // The shared blocks (Э1.3) are production sources as well: compiled, not stubbed.
  const personName = compile("src/components/v3/queue/person-name.ts", () => undefined);
  const initials = compile("src/components/v3/blocks/Initials.tsx", (id) => ({
    "../queue/person-name": personName,
  })[id]);
  const statusChip = compile("src/components/v3/blocks/StatusChip.tsx", () => undefined);
  // «Отменить» (Э7, 251): строка верхнего слоя, срок после паузы и правила отмены — настоящие.
  const undoToast = compile("src/components/v3/blocks/UndoToast.tsx", (id) => ({ react: hooks })[id]);
  const undoDeadline = compile("src/components/v3/tasks/undo-deadline.ts", () => undefined);
  const boardUndo = compile("src/components/v3/board/board-undo.ts", () => undefined);
  // Адрес страницы (Э8.11): этап телефона пишется в `?stage=` через
  // history.replaceState — здесь запись только запоминается.
  const addresses = [];
  const address = {
    location: { pathname: "/v3/admissions-pipeline", search: "" },
    history: { replaceState(_state, _unused, url) {
      addresses.push(url);
      address.location.search = url.slice(url.indexOf("?"));
    } },
  };
  const board = compile("src/components/v3/AdmissionsPipelineBoard.tsx", (id) => ({
    react: hooks,
    "@/components/v3/blocks/Initials": initials,
    "@/components/v3/blocks/StatusChip": statusChip,
    "@/components/v3/blocks/UndoToast": undoToast,
    "@/components/v3/tasks/undo-deadline": undoDeadline,
    "@/components/v3/board/board-undo": boardUndo,
    "next/link": { default: "a" },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/components/ui": ui,
    "@/components/icons": icons,
    "@/components/v3/board/Board": boardPrimitive,
    "@/components/v3/board/TopLayerMenu": topLayerMenu,
    "@/components/v3/Pill": { Pill: "pill" },
    "@/lib/platform-admissions-pipeline-actions": { moveCasePipelineAction: moveAction },
    "@/lib/platform-admissions-pipeline-contract": pipelineContract,
    "@/lib/v3/wording": {
      admissionsPipelineStage: (stage) => `stage:${stage}`, admissionsPipelineTab: (tab) => `tab:${tab}`,
      caseChatAwaitState: () => "Ждёт ответа", country: (code) => code,
    },
  })[id], { window: address });
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
  const render = (props) => expand({ type: board.AdmissionsPipelineBoard, props });
  render.addresses = addresses;
  render.location = address.location;
  return render;
}
function allNodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => allNodes(item, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...allNodes(tree.props?.children, predicate)];
}
function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}
const buttonsNamed = (tree, name) => allNodes(tree, (node) => node.type === "button" && textOf(node).trim() === name);
function press(tree, name) {
  const [button] = buttonsNamed(tree, name);
  assert.ok(button, `button «${name}»`);
  button.props.onClick();
}
const statusText = (tree) => textOf(allNodes(tree, (node) => node.props?.role === "status")).trim();
const cardIds = (tree) => allNodes(tree, (node) => node.props?.["data-testid"] === "v3-admissions-pipeline-card")
  .map((node) => node.props["data-student-case-id"]);
const flush = () => new Promise((resolve) => setImmediate(resolve));

const CASE_ID = "7d1f0c3a-5b2e-4c1d-9a8b-0e6f5d4c3b2a";
// Boards 25.09: one DOM for the narrow list and the wide grid, so exactly one card menu renders.
const boardRow = {
  studentCaseId: CASE_ID, studentDisplayName: "Студент Синтетический", targetCountry: "CN", primaryInstitutionName: null,
  currentCuratorMembershipId: null, currentCuratorDisplayName: null, pipelineStage: "documents",
  awaitingAck: false, overdue: false, needsReply: false,
};
const boardProps = { rows: [boardRow], truncated: false, boardUnavailable: false, tab: "admission",
  query: { q: null, country: null, curator: null } };

test("«Убрать из воронки» only opens a confirmation; «Отмена» and Escape keep the case", () => {
  const calls = [];
  const render = boardHarness(async (input) => { calls.push(input); return { status: "saved" }; });
  let tree = render(boardProps);
  press(tree, "Убрать из воронки");
  assert.equal(calls.length, 0, "the menu item alone never removes the case");
  tree = render(boardProps);
  const [confirm] = allNodes(tree, (node) => node.props?.role === "group" && node.props["aria-labelledby"]);
  assert.ok(confirm, "an inline confirmation group replaces the item");
  assert.match(textOf(confirm), /Убрать «Студент Синтетический» из воронки\? Дело останется в «Студентах»\./u);
  assert.equal(buttonsNamed(tree, "Убрать из воронки").length, 0);
  press(tree, "Отмена");
  tree = render(boardProps);
  assert.equal(buttonsNamed(tree, "Убрать").length, 0, "cancel closes the confirmation");
  assert.equal(buttonsNamed(tree, "Убрать из воронки").length, 1);

  press(tree, "Убрать из воронки");
  tree = render(boardProps);
  const [menu] = allNodes(tree, (node) => node.props?.["data-testid"] === "v3-admissions-pipeline-move");
  assert.equal(menu.props.popover, "auto", "the menu lives in the top layer, not inside the column");
  let prevented = 0;
  menu.props.onKeyDown({ key: "Escape", preventDefault() { prevented += 1; }, stopPropagation() {} });
  tree = render(boardProps);
  assert.equal(prevented, 1, "Escape cancels the confirmation instead of closing the popover");
  assert.equal(buttonsNamed(tree, "Убрать").length, 0, "Escape cancels the confirmation");
  assert.deepEqual(cardIds(tree), [CASE_ID]);
  assert.equal(calls.length, 0);
});

test("a confirmed removal reports its server outcome in role=status and «Вернуть в воронку» restores the stage", async () => {
  const calls = [];
  const render = boardHarness(async (input) => { calls.push(input); return { status: "saved" }; });
  let tree = render(boardProps);
  press(tree, "Убрать из воронки");
  tree = render(boardProps);
  press(tree, "Убрать");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].studentCaseId, CASE_ID);
  assert.equal(calls[0].remove, true);
  assert.equal(calls[0].stage, undefined, "no invented reason or stage on the remove command");
  assert.match(calls[0].requestId, /^[0-9a-f-]{36}$/u);
  tree = render(boardProps);
  assert.deepEqual(cardIds(tree), []);
  assert.equal(statusText(tree), "Убираем дело «Студент Синтетический» из воронки…", "not reported as done before the server");
  await flush();
  tree = render(boardProps);
  assert.equal(statusText(tree), "Дело «Студент Синтетический» убрано из воронки.");
  press(tree, "Вернуть в воронку");
  assert.deepEqual(Object.keys(calls[1]).sort(), ["requestId", "stage", "studentCaseId"]);
  assert.equal(calls[1].stage, "documents", "undo is the existing move to the previous stage");
  assert.notEqual(calls[1].requestId, calls[0].requestId);
  await flush();
  tree = render(boardProps);
  assert.equal(statusText(tree), "Дело «Студент Синтетический» снова в воронке.");
  assert.deepEqual(cardIds(tree), [CASE_ID]);
});

test("a refused or lost removal restores the card, alerts and leaves no success status", async () => {
  for (const [outcome, message] of [
    [async () => ({ status: "forbidden" }), "У вашей роли нет прав на это перемещение."],
    [async () => { throw new Error("network"); }, "Ответ сервера не получен. Перемещение не подтверждено — обновите страницу."],
  ]) {
    const render = boardHarness(outcome);
    let tree = render(boardProps);
    press(tree, "Убрать из воронки");
    tree = render(boardProps);
    press(tree, "Убрать");
    await flush();
    tree = render(boardProps);
    assert.deepEqual(cardIds(tree), [CASE_ID]);
    assert.equal(statusText(tree), "");
    const [alert] = allNodes(tree, (node) => node.props?.role === "alert");
    assert.equal(textOf(alert), message);
  }
});

test("card menu targets are at least 44px, labels at least 12px, and removal is styled apart", () => {
  const render = boardHarness(async () => ({ status: "saved" }));
  const tree = render(boardProps);
  const [trigger] = allNodes(tree, (node) => node.type === "button" && node.props["aria-label"] === "Действия с делом");
  const [menu] = allNodes(tree, (node) => node.props?.["data-testid"] === "v3-admissions-pipeline-move");
  assert.equal(trigger.props.popoverTarget, menu.props.id, "the trigger opens the top-layer menu");
  assert.match(trigger.props.className, /\bsize-11\b/u, "44px trigger");
  const targets = allNodes(menu, (node) => node.type === "button" || node.type === "a");
  // 4 stage moves in this tab, «Другой раздел», 4 moves of the other tab, «Открыть дело», the removal.
  assert.equal(targets.length, 11);
  for (const target of targets) assert.match(target.props.className, /\bmin-h-11\b/u, textOf(target));
  assert.doesNotMatch(JSON.stringify(allNodes(menu, (node) => node.type === "p").map((node) => node.props.className)), /text-2xs/u);
  const [other] = buttonsNamed(menu, "Другой раздел");
  const otherGroup = allNodes(menu, (node) => node.props?.id === other.props["aria-controls"])[0];
  assert.equal(otherGroup.props.hidden, true, "the other tab's stages stay folded until asked");
  assert.deepEqual(allNodes(otherGroup, (node) => node.type === "button").map(textOf),
    ["stage:confirmed", "stage:visa", "stage:predeparture", "stage:arrived"]);
  const [remove] = buttonsNamed(menu, "Убрать из воронки");
  assert.match(remove.props.className, /\btext-danger\b/u);
  const menuChildren = [menu.props.children].flat(Infinity).flatMap((child) => child?.props?.children ?? []).flat(Infinity)
    .filter((child) => child && typeof child === "object");
  assert.equal(menuChildren.at(-2).type, "hr", "a separator sets removal apart from moves and «Открыть дело»");
  assert.equal(menuChildren.at(-1), remove);
});

// --- «Отменить» с проверкой версии (Э7, миграция 251) -------------------------

const undoMigration = source("supabase/migrations/251_platform_pipeline_move_undo.sql");
const undoSuite = source("supabase/tests/platform_pipeline_move_undo.sql");
const accessMigration = source("supabase/migrations/244_platform_access_by_permissions.sql");

/** Сервер 251 в миниатюре: версия положения, отказ `moved` при чужом перемещении. */
function fakeServer(initial = { stage: "documents", hidden: false, version: 7 }) {
  const position = { ...initial };
  const calls = [];
  const action = async (input) => {
    calls.push(input);
    const base = { requestId: input.requestId, studentCaseId: input.studentCaseId };
    if (input.expectedVersion !== undefined && input.expectedVersion !== position.version) {
      return { ...base, status: "moved", pipelineStage: position.stage, pipelineHidden: position.hidden, pipelineVersion: position.version };
    }
    const changed = input.remove ? !position.hidden : position.hidden || position.stage !== input.stage;
    if (input.remove) position.hidden = true; else { position.stage = input.stage; position.hidden = false; }
    if (changed) position.version += 1;
    return { ...base, status: "saved", pipelineStage: position.stage, pipelineHidden: position.hidden, pipelineVersion: position.version };
  };
  /** Другой сотрудник переместил дело. */
  const elsewhere = (stage, hidden = false) => { position.stage = stage; position.hidden = hidden; position.version += 1; };
  return { action, calls, elsewhere, position };
}
const stageCount = (tree, stage) => {
  const [option] = allNodes(tree, (node) => node.type === "option" && node.props.value === stage);
  return Number(textOf(option).match(/\((\d+)\)$/u)[1]);
};
const alertText = (tree) => allNodes(tree, (node) => node.props?.role === "alert").map(textOf).join("");
/** Слова строки отказа без ссылки «Открыть в «…»» (она в той же строке). */
const alertWords = (tree) => allNodes(tree, (node) => node.props?.role === "alert")
  .flatMap((alert) => allNodes(alert, (node) => node.type === "p")).map(textOf).join("");
const alertLinks = (tree) => allNodes(tree, (node) => node.props?.role === "alert")
  .flatMap((alert) => allNodes(alert, (node) => node.type === "a")).map(textOf);
const pickerStage = (tree) => allNodes(tree, (node) => node.type === "select")[0].props.value;
const shownStatus = (tree) => allNodes(tree, (node) => node.props?.role === "status" && textOf(node) !== "" && node.props.className !== "sr-only")
  .map(textOf);
const toastNode = (tree) => allNodes(tree, (node) => node.props?.["data-testid"] === "v3-undo-toasts")[0];
// Фокус в браузере ставят эффекты; здесь `document` нужен только для чтения
// activeElement (и меню верхнего слоя ищет себя по id — здесь его нет).
globalThis.document ??= { activeElement: null, body: {}, getElementById: () => null };

test("a confirmed menu move offers «Отменить»; it sends the reverse move with the receipt's version and the card returns", async () => {
  const server = fakeServer();
  const render = boardHarness(server.action);
  let tree = render(boardProps);
  press(tree, "stage:ready_to_submit");
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].stage, "ready_to_submit");
  assert.equal("expectedVersion" in server.calls[0], false, "an ordinary move sends no version: last write wins, as before");
  tree = render(boardProps);
  assert.equal(buttonsNamed(tree, "Отменить").length, 0, "no undo before the server confirmed the move");
  await flush();
  tree = render(boardProps);
  // Слова перемещения — вежливой живой областью доски; «Отменить» — строкой в верхнем слое (UndoToast, Э1.3).
  assert.equal(statusText(tree), "Дело «Студент Синтетический» перемещено в «stage:ready_to_submit».");
  const [undoButton] = buttonsNamed(tree, "Отменить");
  assert.equal(undoButton.props["data-queue-undo"], "", "the top-layer undo row");
  // A quiet neutral action of the dark undo row, not the page's red.
  assert.equal(undoButton.props.className, "v3-toast-action t-label");
  assert.equal(stageCount(tree, "ready_to_submit"), 1);
  press(tree, "Отменить");
  assert.deepEqual(server.calls[1], { studentCaseId: CASE_ID, requestId: server.calls[1].requestId, stage: "documents", expectedVersion: 8 },
    "the reverse move carries the version of the own move's receipt");
  assert.notEqual(server.calls[1].requestId, server.calls[0].requestId);
  tree = render(boardProps);
  // Карточка не прыгает до ответа: отмена может не пройти (дело переместили).
  assert.equal(stageCount(tree, "ready_to_submit"), 1, "the card stays until the server answers");
  assert.equal(stageCount(tree, "documents"), 0, "not moved back before the server");
  assert.equal(buttonsNamed(tree, "Отменить")[0].props.disabled, true, "the button carries the wait");
  await flush();
  tree = render(boardProps);
  assert.equal(statusText(tree), "Перемещение отменено: дело «Студент Синтетический» снова в «stage:documents».");
  assert.equal(stageCount(tree, "documents"), 1, "back where the receipt says");
  assert.equal(pickerStage(tree), "documents", "the phone picker shows the stage the card came back to");
  assert.deepEqual(render.addresses, ["/v3/admissions-pipeline?stage=documents"], "and the address names it: a reload opens the same stage");
  assert.equal(buttonsNamed(tree, "Отменить").length, 0);
  assert.equal(alertText(tree), "");
  assert.equal(server.position.stage, "documents");
});

test("an undo answer that arrives after the user left the board does not write ?stage= into the new page's address", async () => {
  const server = fakeServer();
  const render = boardHarness(server.action);
  let tree = render(boardProps);
  press(tree, "stage:ready_to_submit");
  await flush();
  tree = render(boardProps);
  press(tree, "Отменить");
  // Сотрудник ушёл в «Студенты» до ответа: там `?stage=` — фильтр «Этап».
  render.location.pathname = "/v3/profile";
  render.location.search = "?view=all";
  await flush();
  assert.equal(server.position.stage, "documents", "the undo itself went through");
  assert.deepEqual(render.addresses, [], "no address written on a page the board no longer owns");
  assert.equal(render.location.search, "?view=all");
});

test("a drag move offers «Отменить» too", async () => {
  const server = fakeServer();
  const render = boardHarness(server.action);
  let tree = render(boardProps);
  const [column] = allNodes(tree, (node) => typeof node.props?.onDrop === "function"
    && textOf(node).includes("stage:shortlist"));
  assert.ok(column, "the shortlist column takes drops");
  column.props.onDrop({ preventDefault() {}, dataTransfer: { getData: () => CASE_ID } });
  await flush();
  tree = render(boardProps);
  assert.equal(statusText(tree), "Дело «Студент Синтетический» перемещено в «stage:shortlist».");
  press(tree, "Отменить");
  assert.equal(server.calls[1].expectedVersion, 8);
  assert.equal(server.calls[1].stage, "documents");
});

test("someone moved the case in between: the undo is refused, the card sits where the server says, nothing is claimed", async () => {
  const refused = "Дело уже переместили — отмена не выполнена.";
  for (const [label, move, where, expect] of [
    ["another stage of this tab", (server) => server.elsewhere("awaiting_decision"),
      "Сейчас дело «Студент Синтетический» — в «stage:awaiting_decision».", (tree, addresses) => {
        assert.equal(stageCount(tree, "awaiting_decision"), 1);
        assert.deepEqual(cardIds(tree), [CASE_ID]);
        assert.equal(pickerStage(tree), "awaiting_decision", "the phone picker shows the stage the server named");
        assert.deepEqual(addresses, ["/v3/admissions-pipeline?stage=awaiting_decision"], "the address names that stage");
        assert.deepEqual(alertLinks(tree), []);
      }],
    ["removed from the board", (server) => server.elsewhere("ready_to_submit", true),
      "Сейчас дело «Студент Синтетический» убрано из воронки.", (tree) => {
        assert.deepEqual(cardIds(tree), [], "a hidden case leaves the board");
        assert.deepEqual(alertLinks(tree), []);
      }],
    ["the other tab", (server) => server.elsewhere("visa"),
      "Сейчас дело «Студент Синтетический» — в «stage:visa».", (tree) => {
        assert.deepEqual(cardIds(tree), [], "the case is on the other tab now, not on this one");
        assert.deepEqual(alertLinks(tree), ["Открыть в «tab:visa»"], "the link to where the case is now sits in the same line");
        assert.equal(allNodes(tree, (node) => node.type === "a" && textOf(node) === "Открыть в «tab:visa»").length, 1,
          "no second notice with the same link");
      }],
  ]) {
    const server = fakeServer();
    const render = boardHarness(server.action);
    let tree = render(boardProps);
    press(tree, "stage:ready_to_submit");
    await flush();
    tree = render(boardProps);
    move(server);
    press(tree, "Отменить");
    assert.equal(server.calls[1].expectedVersion, 8, label);
    await flush();
    tree = render(boardProps);
    // Одна строка на событие: отказ и где дело сейчас; второй строки нет.
    assert.equal(alertWords(tree), `${refused} ${where}`, label);
    assert.equal(statusText(tree), "", `${label}: no second notice, no success claimed`);
    assert.equal(buttonsNamed(tree, "Отменить").length, 0, label);
    expect(tree, render.addresses);
  }
});

test("an undo without an answer is not reported as done: the card stays where the confirmed move left it", async () => {
  let call = 0;
  const render = boardHarness(async (input) => {
    call += 1;
    if (call > 1) throw new Error("network");
    return { status: "saved", requestId: input.requestId, studentCaseId: input.studentCaseId, pipelineStage: input.stage, pipelineHidden: false, pipelineVersion: 3 };
  });
  let tree = render(boardProps);
  press(tree, "stage:ready_to_submit");
  await flush();
  tree = render(boardProps);
  press(tree, "Отменить");
  await flush();
  tree = render(boardProps);
  assert.equal(alertText(tree), "Ответ сервера не получен. Перемещение не подтверждено — обновите страницу.");
  assert.equal(stageCount(tree, "ready_to_submit"), 1);
});

test("a receipt without a version (the v1 command replayed) offers no «Отменить»", async () => {
  const render = boardHarness(async (input) => ({ status: "saved", requestId: input.requestId, studentCaseId: input.studentCaseId,
    pipelineStage: input.stage, pipelineHidden: false, pipelineVersion: null }));
  let tree = render(boardProps);
  press(tree, "stage:ready_to_submit");
  await flush();
  tree = render(boardProps);
  assert.equal(buttonsNamed(tree, "Отменить").length, 0);
});

test("the board shows «Дело «…» перемещено в «…» · Отменить» as the top-layer UndoToast, the words for the reader stay in the board", async () => {
  const server = fakeServer();
  const render = boardHarness(server.action);
  const props = boardProps;
  let tree = render(props);
  assert.equal(toastNode(tree).props.popover, "manual", "the undo row lives in the top layer");
  assert.equal(allNodes(toastNode(tree), (node) => node.type === "li").length, 0, "empty until a move is confirmed");
  press(tree, "stage:ready_to_submit");
  await flush();
  tree = render(props);
  const toast = toastNode(tree);
  const [row] = allNodes(toast, (node) => node.type === "li");
  // Строка называет дело, как «Задачи» — свою задачу.
  assert.equal(textOf(row), "Дело «Студент Синтетический» перемещено в «stage:ready_to_submit».Отменить");
  assert.equal(buttonsNamed(tree, "Отменить").length, 1, "one «Отменить»: in the toast, not in the board line");
  const [status] = allNodes(tree, (node) => node.props?.role === "status" && textOf(node) !== "");
  assert.equal(status.props.className, "sr-only", "announced politely, not shown twice");
  assert.equal(textOf(status), "Дело «Студент Синтетический» перемещено в «stage:ready_to_submit».");
  press(toast, "Отменить");
  assert.equal(server.calls[1].expectedVersion, 8);
  tree = render(props);
  assert.equal(stageCount(tree, "ready_to_submit"), 1, "the card waits for the server");
  assert.equal(buttonsNamed(toastNode(tree), "Отменить")[0].props.disabled, true);
  await flush();
  tree = render(props);
  assert.equal(allNodes(toastNode(tree), (node) => node.type === "li").length, 0);
  assert.equal(stageCount(tree, "documents"), 1);
  // Итог отмены виден строкой доски, а не только читалке.
  assert.deepEqual(shownStatus(tree), ["Перемещение отменено: дело «Студент Синтетический» снова в «stage:documents»."]);
});

test("«Вернуть в воронку» carries the removal receipt's version; a later move by someone else refuses it", async () => {
  const server = fakeServer();
  const render = boardHarness(server.action);
  let tree = render(boardProps);
  press(tree, "Убрать из воронки");
  tree = render(boardProps);
  press(tree, "Убрать");
  await flush();
  tree = render(boardProps);
  server.elsewhere("shortlist");
  press(tree, "Вернуть в воронку");
  assert.deepEqual(server.calls[1], { studentCaseId: CASE_ID, requestId: server.calls[1].requestId, stage: "documents", expectedVersion: 8 });
  await flush();
  tree = render(boardProps);
  assert.equal(alertWords(tree), "Дело уже переместили — отмена не выполнена. Сейчас дело «Студент Синтетический» — в «stage:shortlist».");
  assert.equal(pickerStage(tree), "shortlist");
  assert.equal(buttonsNamed(tree, "Вернуть в воронку").length, 0);
  assert.deepEqual(cardIds(tree), [CASE_ID], "back on the board where the server says");
  assert.equal(stageCount(tree, "shortlist"), 1);
});

test("the undo rules: the card goes where the server says, else where the confirmed move left it", () => {
  const require = createRequire(import.meta.url);
  void require;
  const code = ts.transpileModule(source("src/components/v3/board/board-undo.ts"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", code)(mod, mod.exports);
  const { BOARD_UNDO_MS, boardUndoOffer, placeAfterRefusedUndo } = mod.exports;
  assert.equal(BOARD_UNDO_MS, 6000, "about 6 seconds, as «Задачи»");
  const offer = boardUndoOffer({ key: "k", row: boardRow, toStage: "visa", version: 4, focus: true }, 1_000);
  assert.deepEqual({ pending: offer.pending, completedAt: offer.completedAt, expiresAt: offer.expiresAt }, { pending: false, completedAt: 1_000, expiresAt: 7_000 });
  const other = { ...boardRow, studentCaseId: "00000000-0000-4000-8000-000000000002", pipelineStage: "new" };
  const moved = [{ ...boardRow, pipelineStage: "documents" }, other];
  assert.deepEqual(placeAfterRefusedUndo(moved, offer, { stage: "arrived", hidden: false }).map((row) => row.pipelineStage), ["arrived", "new"]);
  assert.deepEqual(placeAfterRefusedUndo(moved, offer, { stage: "arrived", hidden: true }), [other]);
  assert.deepEqual(placeAfterRefusedUndo(moved, offer, null).map((row) => row.pipelineStage), ["visa", "new"]);
  assert.deepEqual(placeAfterRefusedUndo([other], offer, { stage: "visa", hidden: false }).map((row) => row.studentCaseId), [other.studentCaseId, CASE_ID]);
});

test("the conflict refusal decodes the current position; the pre-check refuses a bad version locally", async () => {
  const pipelineModule = await import("../src/lib/platform-admissions-pipeline.ts");
  const moved = pipelineModule.moveCasePipelineErrorFromRpc({ code: "PT409", message: "case_pipeline_moved",
    details: JSON.stringify({ pipeline_stage: "visa", pipeline_hidden: false, pipeline_version: 6 }) });
  assert.equal(moved.status, "moved");
  assert.deepEqual({ ...moved.current }, { pipelineStage: "visa", pipelineHidden: false, pipelineVersion: 6 });
  for (const details of [null, "not json", JSON.stringify({ pipeline_stage: "bogus", pipeline_hidden: false, pipeline_version: 6 }),
    JSON.stringify({ pipeline_stage: "visa", pipeline_hidden: false, pipeline_version: 0 })]) {
    const error = pipelineModule.moveCasePipelineErrorFromRpc({ code: "PT409", message: "case_pipeline_moved", details });
    assert.equal(error.status, "moved");
    assert.equal(error.current, null, `undecodable detail: ${details}`);
  }
  assert.equal(pipelineModule.moveCasePipelineErrorFromRpc({ code: "PT409", message: "other" }).status, "unavailable");
  assert.equal(pipelineModule.moveCasePipelineErrorFromRpc({ code: "42501", message: "case_pipeline_forbidden" }).status, "forbidden");
  const actor = { organizationId: "25100000-0000-4000-8000-000000000001", systemRole: "staff", permissionKeys: ["case.read.full", "case.update.append"] };
  for (const expectedVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(pipelineModule.moveCasePipeline(actor, { studentCaseId: CASE_ID, requestId: "25100000-0000-4000-8000-000000003001",
      stage: "documents", expectedVersion }), (error) => error.status === "unavailable", String(expectedVersion));
  }
});

test("the board writes only through v2 (251); the action checks the version and revalidates a stale board", () => {
  assert.match(serverModule, /\.rpc\("move_case_pipeline_v2", \{[\s\S]*p_expected_version: expectedVersion,/u);
  assert.doesNotMatch(serverModule, /move_case_pipeline_v1"/u);
  assert.match(actions, /Number\.isSafeInteger\(input\.expectedVersion\) \|\| input\.expectedVersion < 1/u);
  assert.match(actions, /if \(error\.status === "moved"\) \{\s*\/\/[^\n]*\n\s*revalidatePath\("\/v3\/admissions-pipeline"\);/u);
  assert.match(board, /moveCasePipelineAction\(\{ studentCaseId, requestId, stage: fromStage, expectedVersion: offer\.version \}\)/u);
  assert.match(board, /<UndoToast items=\{toasts\} onHold=\{hold\} \/>/u);
  assert.match(board, /expiresAt: resumedUndoDeadline\(current, since, now\)/u, "the deadline stands still while held (WCAG 2.2.1)");
  assert.match(board, /if \(!undo \|\| undo\.pending \|\| held\) return;/u);
  assert.match(board, /focus: via === "menu"/u, "a menu move puts focus on «Отменить», a drag does not");
});

test("after an undo answer focus goes to the card, else the inline link, else the line — never a browser ring", () => {
  // Порядок целей: карточка там, где её назвал сервер → «Открыть в «…»» в строке
  // отказа → сама строка отказа → строка уведомлений, только если в ней есть слова.
  const effect = board.slice(board.indexOf("if (!refocus) return;"), board.indexOf("}, [refocus]);"));
  const order = ["[data-student-case-id=", 'errorRef.current?.querySelector<HTMLElement>("a")', "errorRef.current,", "noticeRef.current?.textContent ? noticeRef.current : null"]
    .map((needle) => effect.indexOf(needle));
  assert.ok(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1])), `refocus order: ${order}`);
  assert.equal((board.match(/setRefocus\(\{ studentCaseId \}\)/gu) ?? []).length, 3, "undo success, undo refusal and «Вернуть в воронку» refusal");
  assert.doesNotMatch(board, /setRefocus\(\{ studentCaseId: null \}\)/u);
  // Цели с tabIndex=-1: рамка строки отказа без кольца браузера; строка
  // уведомлений — кольцо токенов доски.
  assert.match(board, /role="alert"\s+className="[^"]*\boutline-none\b[^"]*"/u);
  assert.match(board, /"outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:shadow-\[0_0_0_3px_var\(--focus-halo\)\]"/u);
  // Телефон: выбор этапа следует за карточкой после ответа, и адрес называет его (Э8.11).
  assert.match(board, /if \(admissionsPipelineTabOf\(stage\) === tab\) chooseNarrowStage\(stage\);/u);
});

test("migration 251 is forward-only and additive: a version column with its trigger and v2 beside the untouched v1", () => {
  assert.match(undoMigration, /^BEGIN;$/mu);
  assert.match(undoMigration, /^COMMIT;\s*$/mu);
  // Outside the function bodies: no data change — the column default is the backfill.
  const statements = undoMigration.replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/gu, "");
  assert.doesNotMatch(statements, /\bDROP\s+(?:FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b|\bTRUNCATE\b|^\s*UPDATE\b|^\s*DELETE\b|^\s*INSERT\b/imu,
    "no data change: the column default is the backfill");
  assert.match(statements, /ALTER TABLE platform\.student_cases\s+ADD COLUMN pipeline_version/u);
  assert.doesNotMatch(undoMigration, /CREATE OR REPLACE FUNCTION platform\.move_case_pipeline_v1/u, "v1 keeps working for the running release");
  assert.match(undoMigration, /ADD COLUMN pipeline_version BIGINT NOT NULL DEFAULT 1\s+CONSTRAINT student_cases_pipeline_version_check CHECK \(pipeline_version >= 1\);/u);
  assert.match(undoMigration, /CREATE TRIGGER student_cases_pipeline_version\s+BEFORE UPDATE ON platform\.student_cases\s+FOR EACH ROW\s+WHEN \(/u);
  assert.match(undoMigration, /NEW\.pipeline_version := OLD\.pipeline_version \+ 1;/u);
  assert.match(undoMigration, /NEW\.pipeline_version := OLD\.pipeline_version;/u);
  assert.match(undoMigration, /a251_pipeline_move_source_drift/u, "fails closed if v1's body drifted");
  const fn = undoMigration.slice(undoMigration.indexOf("CREATE FUNCTION platform.move_case_pipeline_v2("),
    undoMigration.indexOf("REVOKE ALL ON FUNCTION platform.move_case_pipeline_v2"));
  assert.match(fn, /p_expected_version BIGINT DEFAULT NULL\s*\) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS \$\$/u);
  // The gate and the lock are v1's after 244, byte for byte.
  for (const line of [
    "AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'case.update.append');",
    "PERFORM pg_advisory_xact_lock(hashtextextended('case-pipeline:' || p_organization_id::TEXT || ':' || p_student_case_id::TEXT, 0));",
    "'actor', actor.membership_id, 'case', p_student_case_id, 'stage', p_stage, 'remove', p_remove",
  ]) {
    assert.ok(fn.includes(line), line);
    assert.ok(accessMigration.includes(line), `244: ${line}`);
  }
  assert.doesNotMatch(fn, /platform_role\s*(?:NOT\s+)?IN\s*\(|platform_role\s*<>|platform_role\s*=/u);
  // Replay first, then the case check, then the version: a refused caller learns no position.
  const replay = fn.indexOf("RETURN prior.receipt;");
  const access = fn.indexOf("platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.update.append', 'student_case', p_student_case_id)");
  const moved = fn.indexOf("RAISE EXCEPTION 'case_pipeline_moved' USING ERRCODE = 'PT409',");
  assert.ok(replay > 0 && access > replay && moved > access, "replay → per-case access → version");
  assert.match(fn, /DETAIL = jsonb_build_object\(\s*'pipeline_stage', case_row\.pipeline_stage,\s*'pipeline_hidden', case_row\.pipeline_hidden_at IS NOT NULL,\s*'pipeline_version', case_row\.pipeline_version\s*\)::TEXT;/u);
  assert.match(fn, /'pipeline_version', case_row\.pipeline_version, 'request_id', p_request_id/u);
  assert.match(undoMigration, /REVOKE ALL ON FUNCTION platform\.move_case_pipeline_v2\(UUID, UUID, TEXT, BOOLEAN, UUID, BIGINT\)\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
  assert.match(undoMigration, /GRANT EXECUTE ON FUNCTION platform\.move_case_pipeline_v2\(UUID, UUID, TEXT, BOOLEAN, UUID, BIGINT\)\s*TO authenticated;/u);
  assert.doesNotMatch(undoMigration, /GRANT [A-Z ,]+ TO (anon|service_role|PUBLIC)/u);
});

test("migration 251 continues the contiguous source ledger and runs its real-Postgres suite at its checkpoint", async () => {
  const { expectedMigrationVersions } = await import("../scripts/fast-release-ledger-gate.mjs");
  const { fileURLToPath } = await import("node:url");
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("250") && versions.includes("251"));
  assert.match(source("scripts/test-postgres-authorization.sh"),
    /== 251_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_pipeline_move_undo\.sql/u);
  assert.match(undoSuite, /^BEGIN;$/mu);
  assert.match(undoSuite, /^ROLLBACK;\s*$/mu);
  assert.match(undoSuite, /N251_PIPELINE_MOVE_UNDO_SUITE_PASS/u);
  assert.match(undoSuite, /= ARRAY\[35, 36, 23, 12, 16\], 'role bundles have the production key counts/u);
  assert.match(undoSuite, /"current_role" IS NULL AND current_bundle_id IS NULL/u);
  assert.doesNotMatch(undoSuite, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]/iu, "synthetic addresses only");
  for (const claim of ["'case_pipeline_moved'", "away and back", "a direct write of the version is put back",
    "an accepted undo replays its receipt before the version check", "a v1 move bumps the version (trigger)",
    "'the Sales Manager cannot move (no case.update.append), even the case it sold'", "'anon cannot execute v2'"]) {
    assert.ok(undoSuite.includes(claim), claim);
  }
});
