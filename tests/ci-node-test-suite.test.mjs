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

test("D5 metadata planner and readonly snapshot reader run exactly once in focused, unit and CI plans", () => {
  for (const entryScripts of [DEFAULT_ENTRY_SCRIPTS, UNIT_ENTRY_SCRIPTS, ["test:document-import-manifest"]]) {
    const plan = resolveNodeTestPlan({ packageJson, repositoryRoot, entryScripts });
    for (const file of ["tests/document-import-manifest.test.mjs", "tests/document-import-snapshot.test.mjs"]) {
      assert.equal(plan.files.filter(candidate => candidate === file).length, 1);
      assert.equal(plan.groups.filter(group => group.stripTypes && group.conditions.includes("react-server") && group.files.includes(file)).length, 1);
    }
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
    "test:document-import-manifest",
  ]);
  assert.match(packageJson.scripts["pretest:unit"], /--suite unit --validate-only/u);
  assert.match(packageJson.scripts["test:ci:node"], /run-node-test-suite\.mjs --suite ci/u);
  assert.equal(plan.occurrenceCount, 310);
  assert.equal(plan.uniqueFileCount, 171);
  assert.equal(plan.duplicateCount, 139);
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
    "tests/student-profile-export-route.test.mjs",
    "tests/student-profile-fields-browser-harness.test.mjs",
    "tests/v3-student-profile-fields.test.mjs",
  ]) {
    assert.ok(plan.files.includes(requiredD2Test), requiredD2Test);
  }

  const special = plan.groups.find((group) => group.stripTypes);
  const plain = plan.groups.find((group) => !group.stripTypes);
  const bounded = plan.groups.find((group) => group.stripTypes && group.concurrency === 4);
  const serial = plan.groups.find((group) => group.stripTypes && group.concurrency === 1);
  assert.equal(bounded.files.length, 142);
  assert.equal(serial.files.length, 21);
  assert.deepEqual(special.conditions, ["react-server"]);
  assert.deepEqual(plain.files, ["tests/clean-next-dev-types.test.mjs", "tests/v3-trend-chart.test.mjs",
    "tests/staff-role-controls.test.mjs", "tests/staff-disclosure.test.mjs",
    "tests/staff-metadata-feedback.test.mjs", "tests/v3-handoff-navigation.test.mjs",
    "tests/v3-calendar-visibility-proof.test.mjs", "tests/v3-student-profile-fields.test.mjs"]);
  assert.equal(plain.concurrency, 1);
});

test("local unit command preserves its full logical surface without hidden hooks", () => {
  const plan = resolveNodeTestPlan({
    packageJson,
    repositoryRoot,
    entryScripts: UNIT_ENTRY_SCRIPTS,
  });
  assert.match(packageJson.scripts["test:unit"], /run-node-test-suite\.mjs --suite unit/u);
  assert.equal(plan.occurrenceCount, 208);
  assert.equal(plan.uniqueFileCount, 166);
  assert.equal(plan.duplicateCount, 42);
  assert.ok(plan.files.includes("tests/staff-auth-failure.test.mjs"));
});

test("D4 university form tests run once with the server TypeScript runtime in focused, CI and unit plans", () => {
  const requiredFiles = [
    "tests/university-form-fields.test.mjs",
    "tests/university-form-docx.test.mjs",
    "tests/university-form-pdf.test.mjs",
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
    if (entryScripts.length === 1) assert.deepEqual(plan.files, requiredFiles);
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
