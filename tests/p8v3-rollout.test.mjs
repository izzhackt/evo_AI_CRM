import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { runP8V3Preflight, validateP8V3Preflight } from "../scripts/p8v3-preflight.mjs";
import {
  renderP8V3ShellContractsForTest,
  validateCandidateComposeForTest,
  validateP8V3EvidencePrivacy,
} from "../scripts/p8v3-production-operations.mjs";
import {
  P8V3,
  runP8V3Rollout,
  validateP8V3Result,
} from "../scripts/p8v3-rollout.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const IMAGE_A = `sha256:${SHA_A}`;
const IMAGE_B = `sha256:${SHA_B}`;
const WAHA_IMAGE = `sha256:${SHA_C}`;

function container(name, index, image = IMAGE_A) {
  return {
    name,
    container_id: `${index}`.repeat(64),
    image_id: image,
    health: "healthy",
    restart_count: 0,
    networks: ["private"],
  };
}

function operations(overrides = {}) {
  const calls = [];
  const preState = [
    container("evo-crm-app-1", 1),
    container("evo-crm-waha-1", 2, WAHA_IMAGE),
    container("evo-crm-lead-agent-1", 3),
    container("evo-inbox-app-1", 4),
    container("evo-inbox-waha", 5, WAHA_IMAGE),
  ];
  const waha = {
    crm_container_id: preState[1].container_id,
    crm_image_id: WAHA_IMAGE,
    inbox_container_id: preState[4].container_id,
    inbox_image_id: WAHA_IMAGE,
    unchanged: false,
  };
  const execution = { commit: "d".repeat(40), tree: "e".repeat(40), ci_run_id: 123 };
  const preflight = {
    version: "p8v3-production-preflight/v1",
    generated_at: "2026-08-20T05:55:00.000Z",
    expires_at: "2026-08-20T06:25:00.000Z",
    execution,
    application: { commit: P8V3.applicationCommit, tree: P8V3.applicationTree },
    containers: preState,
    waha,
    migration: { versions: Array.from({ length: 76 }, (_, index) => String(index + 1).padStart(3, "0")), range: "001-076", count: 76 },
    archives: ["crm", "inbox", "lead_agent"].map((name) => ({ name, sha256: SHA_A, size: 1, index: IMAGE_A, platform: IMAGE_B })),
    compose_validated: true,
    prerequisites_verified: true,
  };
  const adapter = {
    calls,
    preflight,
    async executionIdentity() { calls.push("executionIdentity"); return execution; },
    async verifyPreflight() { calls.push("verifyPreflight"); return { status: "verified" }; },
    async configure() { calls.push("configure"); return { status: "verified", installed_names: [...P8V3.requiredConfigurationNames], backup_sha256: SHA_A, worker_file_verified: true }; },
    async restoreConfiguration() { calls.push("restoreConfiguration"); return { configuration_restored: true }; },
    async migrate() { calls.push("migrate"); return { status: "verified", before_range: "001-076", before_count: 76, after_range: "001-077", after_count: 77, applied_versions: ["077"] }; },
    async importKnowledge(name) {
      calls.push(`importKnowledge:${name}`);
      return { name, status: "verified", document_count: name === "client" ? 11 : 291, chunk_count: name === "client" ? 20 : 400, bundle_sha256: SHA_A, manifest_sha256: SHA_B, database_revision_sha256: SHA_C };
    },
    async cleanupKnowledge() { calls.push("cleanupKnowledge"); return { status: "verified" }; },
    async deploy(name, { before }) {
      calls.push(`deploy:${name}`);
      const original = before.find((item) => item.name === ({ crm: "evo-crm-app-1", inbox: "evo-inbox-app-1", lead_agent: "evo-crm-lead-agent-1" })[name]);
      return { name, status: "verified", before_image_id: original.image_id, after_image_id: IMAGE_B, container_id: "f".repeat(64), health: "healthy", restart_count: 0, networks: ["private"], disabled_state: true, manual_worker: name === "crm" ? "verified" : "not_applicable" };
    },
    async verifyWaha() { calls.push("verifyWaha"); return { ...waha, unchanged: true }; },
    async rollback(names) { calls.push(`rollback:${names.join(",")}`); return { status: "verified", configuration_restored: true }; },
    async publishEvidence(result) { calls.push(`publishEvidence:${result.result_code}`); },
    async cleanupEvidence() { calls.push("cleanupEvidence"); },
    ...overrides,
  };
  return adapter;
}

test("P8V3 executes the reviewed success order and produces closed evidence", async () => {
  const adapter = operations();
  const now = () => Date.parse("2026-08-20T06:00:00.000Z");
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now });
  assert.equal(result.result_code, "rollout_verified");
  assert.deepEqual(adapter.calls, [
    "executionIdentity", "verifyPreflight", "configure", "migrate",
    "importKnowledge:client", "importKnowledge:internal", "cleanupKnowledge",
    "deploy:crm", "deploy:inbox", "deploy:lead_agent", "verifyWaha",
    "publishEvidence:rollout_verified",
  ]);
  assert.equal(result.effects.waha_recreates, 0);
  assert.equal(result.effects.amo_writes, 0);
  assert.equal(result.effects.whatsapp_sends, 0);
  assert.equal(validateP8V3Result(result), result);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("P8V3 preflight produces the closed short-lived handoff consumed by rollout", async () => {
  const adapter = operations();
  const result = await runP8V3Preflight({
    operations: {
      executionIdentity: () => adapter.preflight.execution,
      preflight: () => ({
        containers: adapter.preflight.containers,
        waha: adapter.preflight.waha,
        migration: adapter.preflight.migration,
        archives: adapter.preflight.archives,
        compose_validated: true,
        prerequisites_verified: true,
      }),
    },
    now: () => Date.parse("2026-08-20T05:55:00.000Z"),
  });
  assert.equal(validateP8V3Preflight(result), result);
  assert.equal(result.expires_at, "2026-08-20T06:25:00.000Z");
});

test("a failed current boundary rolls back apps but retains forward-only reconciliation", async () => {
  const adapter = operations({
    async deploy(name, context) {
      this.calls.push(`deploy:${name}`);
      if (name === "lead_agent") { const error = new Error("lead failed"); error.code = "deployment_failed"; throw error; }
      return operations().deploy(name, context);
    },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.result_code, "rollout_failed_reconciliation_required");
  assert.deepEqual(result.rollback.boundaries, ["lead_agent", "inbox", "crm"]);
  assert.equal(adapter.calls.includes("rollback:lead_agent,inbox,crm"), true);
  assert.equal(result.steps[6].status, "failed");
  assert.equal(result.effects.application_recreates, 2);
});

test("configuration failure is recorded inside pre-state and restoration is attempted", async () => {
  const adapter = operations({
    async configure() { this.calls.push("configure"); const error = new Error("config failed"); error.code = "configuration_failed"; throw error; },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.result_code, "rollout_failed_rolled_back");
  assert.equal(result.steps[0].status, "failed");
  assert.equal(result.failure.code, "configuration_failed");
  assert.equal(adapter.calls.includes("restoreConfiguration"), true);
  assert.equal(adapter.calls.some((item) => item.startsWith("deploy:")), false);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("failure identity must match the one failed progression step", async () => {
  const adapter = operations({
    async configure() { this.calls.push("configure"); const error = new Error("config failed"); error.code = "configuration_failed"; throw error; },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const contradictory = structuredClone(result);
  contradictory.failure.step = "crm";
  assert.throws(() => validateP8V3Result(contradictory), /failure step does not match progression/);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(contradictory), false);
});

test("schema rejects false success and failed results without failure evidence", async () => {
  const adapter = operations();
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);

  const falseSuccess = structuredClone(result);
  falseSuccess.steps.forEach((step) => { step.status = "not_run"; });
  assert.throws(() => validateP8V3Result(falseSuccess), /false rollout success/);
  assert.equal(validate(falseSuccess), false);

  const missingFailure = structuredClone(result);
  missingFailure.result_code = "rollout_failed_reconciliation_required";
  assert.throws(() => validateP8V3Result(missingFailure), /missing failure evidence/);
  assert.equal(validate(missingFailure), false);
});

test("success evidence requires every verified record proof", async () => {
  const adapter = operations();
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const mutations = [
    (value) => { value.configuration.backup_sha256 = null; },
    (value) => { value.knowledge.audiences[0].bundle_sha256 = null; },
    (value) => { value.migration.after_count = null; },
    (value) => { value.boundaries[0].container_id = null; },
  ];
  for (const mutate of mutations) {
    const contradictory = structuredClone(result);
    mutate(contradictory);
    assert.throws(() => validateP8V3Result(contradictory), /drifted/);
    assert.equal(validate(contradictory), false);
  }
});

test("evidence failure cannot hide skipped rollout progression", async () => {
  const adapter = operations();
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  const contradictory = structuredClone(result);
  contradictory.result_code = "evidence_failed";
  contradictory.failure = { step: "evidence", code: "evidence_publication_failed" };
  contradictory.steps[1].status = "not_run";
  assert.throws(() => validateP8V3Result(contradictory), /step progression skipped a boundary/);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(contradictory), false);
});

test("an ambiguous migration failure remains reconciliation-required after config restore", async () => {
  const adapter = operations({
    async migrate() {
      this.calls.push("migrate");
      const error = new Error("response lost");
      error.code = "migration_failed";
      error.migrationRecord = { status: "observed_applied", before_range: "001-076", before_count: 76, after_range: "001-077", after_count: 77, applied_versions: ["077"] };
      throw error;
    },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.result_code, "rollout_failed_reconciliation_required");
  assert.equal(result.failure.step, "migration");
  assert.equal(result.migration.status, "observed_applied");
  assert.equal(result.effects.migration_applied, 1);
  assert.equal(result.rollback.configuration_restored, true);
  assert.equal(adapter.calls.some((item) => item.startsWith("deploy:")), false);
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("knowledge failure cleans temporary artifacts before any application deployment", async () => {
  const adapter = operations({
    async importKnowledge(name) { this.calls.push(`importKnowledge:${name}`); const error = new Error("transfer failed"); error.code = "knowledge_failed"; throw error; },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.failure.step, "client_import");
  assert.equal(adapter.calls.includes("cleanupKnowledge"), true);
  assert.equal(adapter.calls.some((item) => item.startsWith("deploy:")), false);
});

test("forward-only failures cannot be relabeled as fully rolled back", async () => {
  const scenarios = [
    operations({
      async importKnowledge(name) { this.calls.push(`importKnowledge:${name}`); const error = new Error("transfer failed"); error.code = "knowledge_failed"; throw error; },
    }),
    operations({
      async deploy(name, context) {
        this.calls.push(`deploy:${name}`);
        if (name === "crm") { const error = new Error("deploy failed"); error.code = "deployment_failed"; throw error; }
        return operations().deploy(name, context);
      },
    }),
  ];
  const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8v-v1-rollout-result.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  for (const adapter of scenarios) {
    const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
    const contradictory = structuredClone(result);
    contradictory.result_code = "rollout_failed_rolled_back";
    assert.throws(() => validateP8V3Result(contradictory), /false fully rolled-back result/);
    assert.equal(validate(contradictory), false);
  }
});

test("evidence publication failure cannot retain a false success result", async () => {
  const adapter = operations({
    async publishEvidence(result) { this.calls.push(`publishEvidence:${result.result_code}`); const error = new Error("publish failed"); error.code = "evidence_publication_failed"; throw error; },
  });
  const result = await runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:00:00.000Z") });
  assert.equal(result.result_code, "evidence_failed");
  assert.deepEqual(result.failure, { step: "evidence", code: "evidence_publication_failed" });
  assert.equal(adapter.calls.at(-1), "cleanupEvidence");
});

test("evidence privacy rejects a UUID embedded inside retained JSON", () => {
  assert.throws(
    () => validateP8V3EvidencePrivacy('{"account":"550e8400-e29b-41d4-a716-446655440000"}'),
    /privacy validation failed/,
  );
  assert.doesNotThrow(() => validateP8V3EvidencePrivacy('{"account_bound":true}'));
});

test("wrong authorization stops before identity or production access", async () => {
  const adapter = operations();
  await assert.rejects(runP8V3Rollout({ operations: adapter, authorization: "wrong", preflight: adapter.preflight, preflightSha256: SHA_A, now: Date.now }), /exact P8V3 authorization/);
  assert.deepEqual(adapter.calls, []);
});

test("expired preflight stops before identity or production access", async () => {
  const adapter = operations();
  await assert.rejects(runP8V3Rollout({ operations: adapter, authorization: P8V3.authorization, preflight: adapter.preflight, preflightSha256: SHA_A, now: () => Date.parse("2026-08-20T06:25:00.000Z") }), /expired or drifted/);
  assert.deepEqual(adapter.calls, []);
});

test("production adapter keeps staging, rollback and evidence cleanup narrowly ordered", () => {
  const source = readFileSync(join(process.cwd(), "scripts/p8v3-production-operations.mjs"), "utf8");
  assert.ok(source.indexOf("remote(run, stagePrepareScript()") < source.indexOf("repository transfer"));
  assert.ok(source.indexOf("label: \"configuration rollback\"") < source.indexOf("for (const name of boundaries)"));
  assert.equal(source.includes(".p8v3-result-*"), false);
  assert.match(source, /EVO_CRM_WAHA_ENV_FILE/);
  assert.match(source, /EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE: envPaths\.worker/);
  assert.match(source, /EVO_INBOX_WAHA_ENV_FILE/);
  assert.match(source, /\["crm", "lead", "crmWaha", "worker", "inbox", "inboxWaha"\]\.map/);
  assert.match(source, /input: `\$\{accountId\}\\n`/);
  assert.match(source, /for \(const args of commands\) \{\n\s+verifyOrbStack\(run\);\n\s+runChecked\(run, "candidate Compose validation", "docker"/);
  assert.match(source, /verifyPortableArchive\(path, \{ name: spec\.name, index: spec\.index, manifest: spec\.platform \}/);
  assert.match(source, /"-seu", "-c", shellQuote\(importCommand\(item\)\)/);
  assert.match(source, /account=sys\.stdin\.readline\(\)\.strip\(\)/);
  assert.doesNotMatch(source, /vault, accountId, audience/);
  assert.match(source, /os\.umask\(0o077\)/);
  assert.ok(source.indexOf("renameSync(temporary, localResultPath)") < source.indexOf('runChecked(run, "result transfer"'));
  assert.match(source, /if \(state\.localEvidenceWritten\) rmSync\(localResultPath/);
});

test("candidate Compose validation binds a disposable mode-0600 env for every service", () => {
  const composeCalls = [];
  const observedPaths = new Set();
  const run = (command, args, options = {}) => {
    if (command === "orb") return { stdout: "Running\n", stderr: "" };
    if (command === "docker" && args[0] === "context") return { stdout: "orbstack\n", stderr: "" };
    if (command === "docker" && args[0] === "compose") {
      const names = [
        "EVO_CRM_APP_ENV_FILE",
        "EVO_CRM_LEAD_AGENT_ENV_FILE",
        "EVO_CRM_WAHA_ENV_FILE",
        "EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE",
        "EVO_INBOX_APP_ENV_FILE",
        "EVO_INBOX_WAHA_ENV_FILE",
      ];
      for (const name of names) {
        const path = options.env[name];
        observedPaths.add(path);
        const metadata = lstatSync(path);
        assert.equal(metadata.isFile(), true, name);
        assert.equal(metadata.isSymbolicLink(), false, name);
        assert.equal(metadata.mode & 0o777, 0o600, name);
        const expected = name === "EVO_INBOX_APP_ENV_FILE"
          ? [
              "P8V3_COMPOSE_VALIDATION=1",
              "NEXT_PUBLIC_SUPABASE_URL=https://p8v3.invalid",
              "NEXT_PUBLIC_SUPABASE_ANON_KEY=p8v3-compose-validation-not-a-key",
              "NEXT_PUBLIC_SITE_URL=https://p8v3.invalid",
              "",
            ].join("\n")
          : "P8V3_COMPOSE_VALIDATION=1\n";
        assert.equal(readFileSync(path, "utf8"), expected, name);
      }
      composeCalls.push(args);
    }
    return { stdout: "", stderr: "" };
  };

  validateCandidateComposeForTest(run, process.cwd());
  assert.equal(composeCalls.length, 2);
  assert.equal(observedPaths.size, 6);
  for (const path of observedPaths) assert.equal(existsSync(path), false, path);
  assert.equal(existsSync(dirname([...observedPaths][0])), false);
});

test("candidate Compose validation removes every disposable env after failure", () => {
  const observedPaths = new Set();
  const run = (command, args, options = {}) => {
    if (command === "orb") return { stdout: "Running\n", stderr: "" };
    if (command === "docker" && args[0] === "context") return { stdout: "orbstack\n", stderr: "" };
    if (command === "docker" && args[0] === "compose") {
      for (const name of [
        "EVO_CRM_APP_ENV_FILE",
        "EVO_CRM_LEAD_AGENT_ENV_FILE",
        "EVO_CRM_WAHA_ENV_FILE",
        "EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE",
        "EVO_INBOX_APP_ENV_FILE",
        "EVO_INBOX_WAHA_ENV_FILE",
      ]) observedPaths.add(options.env[name]);
      throw new Error("forced Compose failure");
    }
    return { stdout: "", stderr: "" };
  };

  assert.throws(() => validateCandidateComposeForTest(run, process.cwd()), /forced Compose failure/);
  assert.equal(observedPaths.size, 6);
  for (const path of observedPaths) assert.equal(existsSync(path), false, path);
  assert.equal(existsSync(dirname([...observedPaths][0])), false);
});

test("every reviewed remote shell contract parses under bash", () => {
  for (const [name, script] of Object.entries(renderP8V3ShellContractsForTest())) {
    const parsed = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(parsed.status, 0, `${name}: ${parsed.stderr}`);
  }
});
