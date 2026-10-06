import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  D1_ENTRY_SCRIPTS,
  DEFAULT_ENTRY_SCRIPTS,
  SERIAL_PROVIDER_TEST_FILES,
  UNIT_ENTRY_SCRIPTS,
  resolveNodeTestPlan,
} from "../scripts/run-node-test-suite.mjs";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));

test("source preflight input-boundary tests run once in focused, unit and CI plans", () => {
  for (const entryScripts of [DEFAULT_ENTRY_SCRIPTS, UNIT_ENTRY_SCRIPTS, ["test:document-source-preflight"]]) {
    const plan = resolveNodeTestPlan({ packageJson, repositoryRoot, entryScripts });
    const file = "tests/document-source-preflight.test.mjs";
    assert.ok(plan.files.includes(file));
    assert.equal(plan.groups.filter(group => group.stripTypes && group.conditions.includes("react-server") && group.files.includes(file)).length, 1);
  }
});

test("package engine tests are real entries in focused, unit and CI plans", () => {
  for (const entryScripts of [DEFAULT_ENTRY_SCRIPTS, UNIT_ENTRY_SCRIPTS, ["test:document-packages"]]) {
    const plan = resolveNodeTestPlan({ packageJson, repositoryRoot, entryScripts });
    for (const file of ["tests/document-package.test.mjs", "tests/document-package-zip.test.mjs"]) {
      assert.ok(plan.files.includes(file), file);
      assert.equal(plan.groups.filter(group => group.stripTypes && group.conditions.includes("react-server") && group.files.includes(file)).length, 1);
    }
  }
});

test("CI Node suite runs the former security and unit surface once", () => {
  const plan = resolveNodeTestPlan({ packageJson, repositoryRoot });

  assert.deepEqual(DEFAULT_ENTRY_SCRIPTS, [
    "test:sales-register",
    "test:security",
    "test:frontend",
    "test:e3",
    "test:u1",
    "test:u2",
    "test:u4",
    "test:u7",
    "test:u8",
    "test:u9",
    "test:u11",
    "test:unit:supplemental",
    "test:unit:core",
    "test:student-profile-fields",
    "test:university-forms",
    "test:document-packages",
    "test:document-source-preflight",
    "test:document-export-artifacts",
  ]);
  assert.match(packageJson.scripts["pretest:unit"], /--suite unit --validate-only/u);
  assert.match(packageJson.scripts["test:ci:node"], /run-node-test-suite\.mjs --suite ci/u);
  assert.equal(plan.occurrenceCount, 379); // + Э8.1 case documents (tests/v3-case-documents.test.mjs), + PORT-9a, + PORT-9d (tests/university-photo-storage.test.mjs), + «Студенты» UI (tests/v3-students-queue-ui.test.mjs, ex-facets), + «Задачи» queue (tests/v3-tasks-queue.test.mjs), + «Студенты» queue backend (tests/v3-students-queue.test.mjs), + boards (tests/v3-boards.test.mjs), + «Сообщения» order (tests/v3-case-chat-order.test.mjs), + one staff look (tests/v3-staff-look.test.mjs, ex look preview), + truthful state (tests/v3-truthful-state.test.mjs), + access by permissions 244 (tests/platform-access-by-permissions.test.mjs), + case work (tests/v3-case-work.test.mjs), + shell Э1.2 (tests/v3-shell.test.mjs), + «Сегодня» (tests/v3-today-queue.test.mjs), + closure 246 (tests/v3-lead-case-closure.test.mjs), + honest numbers 247 (tests/v3-honest-numbers.test.mjs), + access owner defaults 248 (tests/platform-access-owner-defaults.test.mjs), + shared blocks Э1.3 (tests/v3-blocks.test.mjs), + admissions board harness (tests/v3-admissions-pipeline.test.mjs), + «Переписки» Э5 (tests/v3-conversations.test.mjs), + Э4 Lead 360 and «Отчёт продаж» (tests/v3-e4-work-surfaces.test.mjs), + Э6 reference pages (tests/v3-reference-pages.test.mjs), + Э3 EVO Docs and university deadlines (tests/v3-e3-docs-deadlines.test.mjs), + Э3 «Заявки» (tests/v3-requests-triage.test.mjs, tests/requests-queue.test.mjs), + Э7 polish (tests/v3-e7-polish.test.mjs), + Э4 Student 360 (tests/v3-e4-student360.test.mjs), + Э7 one side panel (tests/v3-e7-side-panel.test.mjs), + Э8.2 universities (tests/v3-e8-universities.test.mjs), + Э8.3 case money (tests/v3-case-money.test.mjs), + Э8.11 critical fixes (tests/v3-e8-critical-fixes.test.mjs), + «Маркетинг» М1 (tests/marketing-m1.test.mjs, tests/website-lead-attribution.test.mjs)
  // Один assert на пин: задвоенная строка была случайной (дедуплицирована в PORT-5c).
  assert.equal(plan.uniqueFileCount, 240); // + Э8.1 case documents, + PORT-9a, + PORT-9d, + «Студенты» UI (ex-facets), + «Задачи» queue, + «Студенты» queue backend, + boards, + «Сообщения» order, + one staff look (ex look preview), + truthful state, + access by permissions 244, + case work, + shell (Э1.2), + «Сегодня», + closure 246 (tests/v3-lead-case-closure.test.mjs), + honest numbers 247 (tests/v3-honest-numbers.test.mjs), + access owner defaults 248 (tests/platform-access-owner-defaults.test.mjs), + shared blocks (Э1.3), + admissions board harness, + «Переписки» (Э5), + Э4 work surfaces, + Э6 reference pages, + Э3 docs and deadlines, + Э3 «Заявки» (triage and the v2 contract), + Э7 polish, + Э4 Student 360, + Э7 one side panel, + Э8.2 universities, + Э8.3 case money, + Э8.11 critical fixes, + «Маркетинг» М1 (tests/marketing-m1.test.mjs, tests/website-lead-attribution.test.mjs)
  assert.equal(plan.duplicateCount, 139);
  assert.equal(plan.files.includes("tests/student-portal-assessment-preview.test.mjs"), false);
  assert.equal(new Set(plan.files).size, plan.files.length);
  assert.ok(plan.files.includes("tests/staff-auth-failure.test.mjs"));
  for (const requiredD1Test of [
    "tests/platform-case-notes.test.mjs",
    "tests/platform-admissions.test.mjs",
    "tests/v3-profile-admissions.test.mjs",
    "tests/platform-queue-read-extensions.test.mjs",
    "tests/platform-reply-snippets.test.mjs",
    "tests/platform-message-media-case-attach.test.mjs",
  ]) {
    assert.ok(plan.files.includes(requiredD1Test), requiredD1Test);
  }
  for (const requiredD2Test of [
    "tests/v3-reply-snippets-ui.test.mjs",
    "tests/v3-profile-pipeline-notes.test.mjs",
    "tests/v3-calendar-d2.test.mjs",
    "tests/platform-media-route.test.mjs",
    "tests/v3-inbox-media-ui.test.mjs",
    "tests/student-profile-fields.test.mjs",
    "tests/platform-student-profile-fields.test.mjs",
    "tests/platform-student-profile-field-actions.test.mjs",
    "tests/student-profile-field-sql.test.mjs",
    "tests/student-profile-template.test.mjs",
    "tests/student-profile-fields-browser-harness.test.mjs",
    "tests/v3-student-profile-fields.test.mjs",
    "tests/document-recognition.test.mjs",
    "tests/platform-document-recognition.test.mjs",
    "tests/document-recognition-queue-sql.test.mjs",
    "tests/gemini-document-recognition.test.mjs",
    "tests/document-recognition-source.test.mjs",
    "tests/document-recognition-worker.test.mjs",
    "tests/document-recognition-worker-cli.test.mjs",
    "tests/document-recognition-cleanup.test.mjs",
    "tests/document-recognition-route.test.mjs",
    "tests/platform-document-recognition-history.test.mjs",
    "tests/document-recognition-client.test.mjs",
    "tests/v3-document-recognition-jobs.test.mjs",
  ]) {
    assert.ok(plan.files.includes(requiredD2Test), requiredD2Test);
  }

  const special = plan.groups.find((group) => group.stripTypes);
  const plain = plan.groups.find((group) => !group.stripTypes);
  const bounded = plan.groups.find((group) => group.stripTypes && group.concurrency === 4);
  const serial = plan.groups.find((group) => group.stripTypes && group.concurrency === 1);
  assert.equal(bounded.files.length, 202); // + Э8.1 case documents (tests/v3-case-documents.test.mjs), + PORT-9a, + PORT-9d (tests/university-photo-storage.test.mjs), + «Студенты» facets, + «Задачи» queue, + «Студенты» queue backend, + boards, + «Сообщения» order, + one staff look (ex look preview), + truthful state, + access by permissions 244, + case work, + shell (Э1.2), + «Сегодня», + closure 246 (tests/v3-lead-case-closure.test.mjs), + access owner defaults 248 (tests/platform-access-owner-defaults.test.mjs), + shared blocks (Э1.3), + admissions board harness, + «Переписки» (Э5), + Э6 reference pages, + Э3 docs and deadlines, + Э3 «Заявки» (triage and the v2 contract), + Э7 one side panel (tests/v3-e7-side-panel.test.mjs), + Э8.2 universities (tests/v3-e8-universities.test.mjs), + Э8.3 case money (tests/v3-case-money.test.mjs), + «Маркетинг» М1 (tests/website-lead-attribution.test.mjs; tests/marketing-m1.test.mjs runs without the server condition)
  assert.equal(serial.files.length, 21);
  assert.deepEqual(special.conditions, ["react-server"]);
  assert.deepEqual(plain.files, ["tests/clean-next-dev-types.test.mjs", "tests/v3-trend-chart.test.mjs",
    "tests/staff-role-controls.test.mjs", "tests/staff-disclosure.test.mjs",
    "tests/staff-metadata-feedback.test.mjs", "tests/v3-handoff-navigation.test.mjs",
    "tests/v3-calendar-visibility-proof.test.mjs", "tests/v3-honest-numbers.test.mjs", "tests/marketing-m1.test.mjs",
    "tests/v3-e4-work-surfaces.test.mjs", "tests/v3-e7-polish.test.mjs", "tests/v3-e4-student360.test.mjs", "tests/v3-e8-critical-fixes.test.mjs", "tests/v3-student-profile-fields.test.mjs", "tests/v3-document-recognition-jobs.test.mjs",
    "tests/university-form-controls.test.mjs", "tests/document-export-client.test.mjs"]);
  assert.equal(plain.concurrency, 1);
});

test("local unit command preserves its full logical surface without hidden hooks", () => {
  const plan = resolveNodeTestPlan({
    packageJson,
    repositoryRoot,
    entryScripts: UNIT_ENTRY_SCRIPTS,
  });
  assert.match(packageJson.scripts["test:unit"], /run-node-test-suite\.mjs --suite unit/u);
  assert.equal(plan.occurrenceCount, 277); // + Э8.1 case documents (tests/v3-case-documents.test.mjs), + PORT-9a, + PORT-9d (tests/university-photo-storage.test.mjs), + «Студенты» facets, + «Задачи» queue, + «Студенты» queue backend, + boards, + «Сообщения» order, + one staff look (ex look preview), + truthful state, + access by permissions 244, + case work, + shell (Э1.2), + «Сегодня», + closure 246 (tests/v3-lead-case-closure.test.mjs), + honest numbers 247 (tests/v3-honest-numbers.test.mjs), + access owner defaults 248 (tests/platform-access-owner-defaults.test.mjs), + shared blocks (Э1.3), + admissions board harness, + «Переписки» (Э5), + Э4 Lead 360 and «Отчёт продаж» (tests/v3-e4-work-surfaces.test.mjs), + Э6 reference pages (tests/v3-reference-pages.test.mjs), + Э3 EVO Docs and university deadlines (tests/v3-e3-docs-deadlines.test.mjs), + Э3 «Заявки» (tests/v3-requests-triage.test.mjs, tests/requests-queue.test.mjs), + Э7 polish (tests/v3-e7-polish.test.mjs), + Э4 Student 360 (tests/v3-e4-student360.test.mjs), + Э7 one side panel (tests/v3-e7-side-panel.test.mjs), + Э8.2 universities (tests/v3-e8-universities.test.mjs), + Э8.3 case money (tests/v3-case-money.test.mjs), + Э8.11 critical fixes (tests/v3-e8-critical-fixes.test.mjs), + «Маркетинг» М1 (tests/marketing-m1.test.mjs, tests/website-lead-attribution.test.mjs)
  // Один assert на пин: задвоенная строка была случайной (дедуплицирована в PORT-5c).
  assert.equal(plan.uniqueFileCount, 235); // + Э8.1 case documents, + PORT-9a, + PORT-9d, + «Студенты» facets, + «Задачи» queue, + «Студенты» queue backend, + boards, + «Сообщения» order, + one staff look (ex look preview), + truthful state, + access by permissions 244, + case work, + shell (Э1.2), + «Сегодня», + closure 246 (tests/v3-lead-case-closure.test.mjs), + honest numbers 247 (tests/v3-honest-numbers.test.mjs), + access owner defaults 248 (tests/platform-access-owner-defaults.test.mjs), + shared blocks (Э1.3), + admissions board harness, + «Переписки» (Э5), + Э4 work surfaces, + Э6 reference pages, + Э3 docs and deadlines, + Э3 «Заявки» (triage and the v2 contract), + Э7 polish, + Э4 Student 360, + Э7 one side panel, + Э8.2 universities, + Э8.3 case money, + Э8.11 critical fixes, + «Маркетинг» М1 (tests/marketing-m1.test.mjs, tests/website-lead-attribution.test.mjs)
  assert.equal(plan.duplicateCount, 42);
  assert.equal(plan.files.includes("tests/student-portal-assessment-preview.test.mjs"), false);
  assert.ok(plan.files.includes("tests/staff-auth-failure.test.mjs"));
});

test("D4 university form tests run once with the server TypeScript runtime in focused, CI and unit plans", () => {
  const requiredFiles = [
    "tests/university-form-fields.test.mjs",
    "tests/university-form-docx.test.mjs",
    "tests/university-form-pdf.test.mjs",
    "tests/university-form-registry.test.mjs",
    "tests/university-template-preflight.test.mjs",
    "tests/university-template-page.test.mjs",
    "tests/university-template-ingress.test.mjs",
    "tests/platform-university-forms.test.mjs",
    "tests/university-form-action-input.test.mjs",
    "tests/university-form-management-input.test.mjs",
    "tests/university-template-runtime-identity.test.mjs",
    "tests/university-template-source-storage.test.mjs",
    "tests/university-template-ingress-route.test.mjs",
    "tests/configure-university-template-storage.test.mjs",
    "tests/university-template-ingress-acceptance.test.mjs",
    "tests/university-template-mapping-proof.test.mjs",
  ];
  for (const entryScripts of [DEFAULT_ENTRY_SCRIPTS, UNIT_ENTRY_SCRIPTS, ["test:university-forms"]]) {
    const plan = resolveNodeTestPlan({ packageJson, repositoryRoot, entryScripts });
    for (const file of requiredFiles) {
      assert.equal(plan.files.filter(candidate => candidate === file).length, 1, file);
      const groups = plan.groups.filter(group => group.files.includes(file));
      assert.equal(groups.length, 1, file);
      assert.deepEqual(groups[0].nodeArgs, ["--conditions=react-server", "--experimental-strip-types"], file);
      assert.equal(groups[0].concurrency, 4, file);
    }
    const control = "tests/university-form-controls.test.mjs";
    assert.equal(plan.files.filter(file => file === control).length, 1);
    const controlGroup = plan.groups.find(group => group.files.includes(control));
    assert.deepEqual(controlGroup.nodeArgs, []);
    if (entryScripts.length === 1) assert.deepEqual(plan.files, [...requiredFiles, control]);
  }
});

test("focused D1 command validates every required test before execution", () => {
  assert.deepEqual(D1_ENTRY_SCRIPTS, ["test:d1"]);
  assert.match(packageJson.scripts["pretest:d1"], /--suite d1 --validate-only/u);
  const plan = resolveNodeTestPlan({
    packageJson,
    repositoryRoot,
    entryScripts: D1_ENTRY_SCRIPTS,
  });
  assert.deepEqual(plan.files, [
    "tests/platform-case-notes.test.mjs",
    "tests/platform-admissions.test.mjs",
    "tests/v3-profile-admissions.test.mjs",
    "tests/platform-queue-read-extensions.test.mjs",
    "tests/platform-reply-snippets.test.mjs",
    "tests/platform-message-media-case-attach.test.mjs",
  ]);
});

test("saved export and bucket configuration tests run once in actual focused, CI and unit plans", () => {
  const files = ["tests/document-export-artifacts.test.mjs", "tests/configure-document-export-storage.test.mjs"];
  for (const entryScripts of [["test:document-export-artifacts"], DEFAULT_ENTRY_SCRIPTS, UNIT_ENTRY_SCRIPTS]) {
    const plan = resolveNodeTestPlan({ packageJson, repositoryRoot, entryScripts });
    for (const file of files) {
      assert.equal(plan.files.filter(value => value === file).length, 1);
      const groups = plan.groups.filter(group => group.files.includes(file));
      assert.equal(groups.length, 1);
      assert.deepEqual(groups[0].nodeArgs, ["--conditions=react-server", "--experimental-strip-types"]);
    }
    const clientFile = "tests/document-export-client.test.mjs";
    assert.equal(plan.files.filter(value => value === clientFile).length, 1);
    const clientGroups = plan.groups.filter(group => group.files.includes(clientFile));
    assert.equal(clientGroups.length, 1);
    assert.deepEqual(clientGroups[0].nodeArgs, []);
  }
});

test("CI Node suite retains every test that requires serial shared-state execution", () => {
  const plan = resolveNodeTestPlan({ packageJson, repositoryRoot });
  const serialTests = [
    "platform-gemini-provider",
    "platform-provider-action-contract",
    "platform-provider-orchestrator",
    "platform-provider-readiness",
    "platform-provider-workflows",
    "platform-provider-actions",
    "platform-provider-controls",
    "v3-inbox-integration",
    "platform-waha-local-fetch",
    "platform-waha-provider",
    "platform-waha-webhook",
    "platform-waha-projector",
    "platform-waha-projector-recovery",
    "platform-provider-acceptance-harness",
    "platform-whatsapp-pages",
    "platform-communications-local-provisioner",
    "platform-amocrm-discovery-repository",
    "platform-amocrm-runtime",
    "platform-amocrm-command-service",
    "platform-amocrm-command-rpc",
  ].map((name) => `tests/${name}.test.mjs`);
  serialTests.push("tests/v3-student-portal-exact-http-routes.test.mjs");

  for (const file of serialTests) {
    assert.equal(plan.files.filter((candidate) => candidate === file).length, 1, file);
  }
  assert.deepEqual(new Set(serialTests), SERIAL_PROVIDER_TEST_FILES);
  const serialGroup = plan.groups.find((group) => group.stripTypes && group.concurrency === 1);
  assert.deepEqual(new Set(serialGroup.files), SERIAL_PROVIDER_TEST_FILES);
});

test("CI Node suite fails closed for a missing file and conflicting flags", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-ci-node-suite-"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "tests", "present.test.mjs"), "", "utf8");

  assert.throws(
    () => resolveNodeTestPlan({
      packageJson: { scripts: { root: "node --test tests/missing.test.mjs" } },
      repositoryRoot: root,
      entryScripts: ["root"],
    }),
    /Missing test file/u,
  );

  assert.throws(
    () => resolveNodeTestPlan({
      packageJson: {
        scripts: {
          root: "npm run plain && npm run typed",
          plain: "node --test tests/present.test.mjs",
          typed: "node --conditions=react-server --experimental-strip-types --test tests/present.test.mjs",
        },
      },
      repositoryRoot: root,
      entryScripts: ["root"],
    }),
    /Conflicting Node flags/u,
  );
});

test("targeted local suite names remain available", () => {
  for (const scriptName of [
    "test:frontend",
    "test:u1",
    "test:u2",
    "test:u4",
    "test:u7",
    "test:u8",
    "test:u9",
    "test:u11",
    "test:security",
    "test:security:node",
    "test:typecheck-stability",
    "test:d1",
    "test:unit",
  ]) {
    assert.equal(typeof packageJson.scripts[scriptName], "string", scriptName);
  }
  assert.equal(
    packageJson.scripts["test:database:migration-boundaries"],
    "bash scripts/test-postgres-authorization.sh",
  );
});
