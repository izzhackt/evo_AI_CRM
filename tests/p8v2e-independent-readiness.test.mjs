import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  P8V2E,
  P8V2E_CONFIGURATION_REMOTE_COMMAND,
  P8V2E_VAULTS,
  createP8V2EConfigurationScript,
  fixedBashSeuCommand,
  observeP8V2EConfiguration,
  observeP8V2EIdentity,
  publishP8V2EResult,
  runP8V2EReadiness,
  validateP8V2EReadinessResult,
  verifyP8V2EExecution,
} from "../scripts/p8v2e-independent-readiness.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";

function source() {
  return {
    application_commit: P8V2E.applicationCommit,
    application_tree: P8V2E.applicationTree,
    execution_commit: "a".repeat(40),
    execution_tree: "b".repeat(40),
    execution_ci_run_id: 32132550619,
  };
}

function verifiedVault(spec) {
  return {
    audience: spec.audience,
    status: "verified",
    document_count: spec.document_count,
    source_set_sha256: spec.source_set_sha256,
    pii_gate: "passed",
    forbidden_root_gate: "passed",
  };
}

function blockedResult() {
  return {
    version: P8V2E.version,
    generated_at: "2026-08-18T12:00:00.000Z",
    result_code: "readiness_blocked",
    blockers: ["organization_not_singular", "root_crm_settings_missing"],
    source: source(),
    retained_p8v2d: { status: "verified", result_sha256: P8V2E.retainedResultSha256 },
    vaults: P8V2E_VAULTS.map(verifiedVault),
    identity: { status: "blocked", account: "exactly_one_active", organization: "none_active", project_ref_match: true, project_status: "ACTIVE_HEALTHY" },
    configuration: {
      status: "blocked",
      root_crm: "blocked",
      lead_agent: "blocked",
      manual_worker: "blocked",
      configured_account_match: false,
      configured_organization_match: "not_comparable",
      supabase_project_match: false,
      blockers: ["root_crm_settings_missing"],
    },
  };
}

test("closed schema and runtime accept truthful blocked independent progression", async () => {
  const schema = JSON.parse(await readFile(new URL("../docs/schemas/p8v2e-independent-readiness-result.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: false, formats: false }).compile(schema);
  const result = blockedResult();
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  assert.equal(validateP8V2EReadinessResult(result), result);
});

test("false verified result is rejected by schema and runtime", async () => {
  const schema = JSON.parse(await readFile(new URL("../docs/schemas/p8v2e-independent-readiness-result.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: false, formats: false }).compile(schema);
  const result = { ...blockedResult(), result_code: "readiness_verified", blockers: [] };
  assert.equal(validate(result), false);
  assert.throws(() => validateP8V2EReadinessResult(result));
});

test("Management API identity uses exact GET 200 and read-only POST 201 contracts", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(JSON.stringify({ ref: P8V2E.projectRef, status: "ACTIVE_HEALTHY", name: "ignored" }), { status: 200 });
    return new Response(JSON.stringify([{ kind: "account", id: A }, { kind: "organization", id: O }]), { status: 201 });
  };
  const identity = await observeP8V2EIdentity("process-only-token", fetchImpl);
  assert.deepEqual(identity.safe, { status: "verified", account: "exactly_one_active", organization: "exactly_one_active", project_ref_match: true, project_status: "ACTIVE_HEALTHY" });
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.redirect, "error");
  assert.deepEqual(Object.keys(JSON.parse(calls[1].options.body)), ["query"]);
  assert.match(JSON.parse(calls[1].options.body).query, /public\.ai_configs/);
  assert.match(JSON.parse(calls[1].options.body).query, /platform\.organizations/);
  assert.doesNotMatch(JSON.stringify(identity.safe), new RegExp(`${A}|${O}`));
});

test("Management API rejects deprecated-id-only project, wrong POST status and open rows", async () => {
  await assert.rejects(
    observeP8V2EIdentity("token", async () => new Response(JSON.stringify({ id: P8V2E.projectRef, status: "ACTIVE_HEALTHY" }), { status: 200 })),
    /project drifted/,
  );
  let call = 0;
  await assert.rejects(
    observeP8V2EIdentity("token", async () => ++call === 1
      ? new Response(JSON.stringify({ ref: P8V2E.projectRef, status: "ACTIVE_HEALTHY" }), { status: 200 })
      : new Response("[]", { status: 200 })),
    /HTTP status drifted/,
  );
  call = 0;
  await assert.rejects(
    observeP8V2EIdentity("token", async () => ++call === 1
      ? new Response(JSON.stringify({ ref: P8V2E.projectRef, status: "ACTIVE_HEALTHY" }), { status: 200 })
      : new Response(JSON.stringify([{ kind: "account", id: A, extra: true }]), { status: 201 })),
    /identity row keys drifted/,
  );
});

test("non-singular organization remains a safe blocker without inventing a UUID", async () => {
  let call = 0;
  const identity = await observeP8V2EIdentity("token", async () => ++call === 1
    ? new Response(JSON.stringify({ ref: P8V2E.projectRef, status: "ACTIVE_HEALTHY" }), { status: 200 })
    : new Response(JSON.stringify([{ kind: "account", id: A }]), { status: 201 }));
  assert.equal(identity.safe.organization, "none_active");
  assert.deepEqual(identity.blockers, ["organization_not_singular"]);
  assert.equal(identity.organizationId, "");
});

test("Management API enforces the per-kind row cap and streaming byte cap", async () => {
  let call = 0;
  await assert.rejects(
    observeP8V2EIdentity("token", async () => ++call === 1
      ? new Response(JSON.stringify({ ref: P8V2E.projectRef, status: "ACTIVE_HEALTHY" }), { status: 200 })
      : new Response(JSON.stringify([
          { kind: "account", id: A },
          { kind: "account", id: "33333333-3333-4333-8333-333333333333" },
          { kind: "account", id: "44444444-4444-4444-8444-444444444444" },
          { kind: "organization", id: O },
        ]), { status: 201 })),
    /kind cardinality/,
  );
  await assert.rejects(
    observeP8V2EIdentity("token", async () => new Response(JSON.stringify({ ref: P8V2E.projectRef, status: "ACTIVE_HEALTHY", padding: "x".repeat(70_000) }), { status: 200 })),
    /byte limit/,
  );
});

test("Hermes identity transport is stdin-only and UUID-free in argv/output", () => {
  let observed;
  const result = observeP8V2EConfiguration({ accountId: A, organizationId: O }, (command, args, options) => {
    observed = { command, args, options };
    return { status: 0, stdout: JSON.stringify({ status: "blocked", root_crm: "blocked", lead_agent: "blocked", manual_worker: "blocked", configured_account_match: false, configured_organization_match: false, supabase_project_match: false, blockers: ["root_crm_settings_missing"] }), stderr: "" };
  });
  assert.equal(observed.command, "ssh");
  assert.match(observed.options.input, new RegExp(A));
  assert.match(observed.options.input, new RegExp(O));
  assert.doesNotMatch(JSON.stringify(observed.args), new RegExp(`${A}|${O}`));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${A}|${O}`));
  assert.equal(observed.args.length, 4);
  assert.equal(observed.args[3], P8V2E_CONFIGURATION_REMOTE_COMMAND);
  assert.throws(() => observeP8V2EConfiguration({ accountId: A, organizationId: O }, () => ({ status: 0, stdout: "{}", stderr: A })), /observation failed/);
});

test("fixed bash-seu wrapper preserves framed stdin and one remote command boundary", () => {
  const command = fixedBashSeuCommand("IFS= read -r value\nprintf %s \"$value\"");
  const result = spawnSync("bash", ["-c", command], { input: "framed-value\n", encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "framed-value");
  assert.match(command, /^bash -seu -c /);
});

test("configuration parser rejects malformed/duplicate env and unsafe token files", async () => {
  const root = await mkdtemp(join(tmpdir(), "p8v2e-config-"));
  const crm = join(root, "crm.env"); const lead = join(root, "lead.env"); const worker = join(root, "worker.env"); const secrets = join(root, "secrets");
  mkdirSync(secrets, { mode: 0o700 });
  const uid = process.getuid(); const gid = process.getgid();
  const script = (overrides = {}) => fixedBashSeuCommand(createP8V2EConfigurationScript({ crmPath: crm, leadPath: lead, workerPath: worker, tokenRoot: secrets, requiredUid: uid, requiredGid: gid, ...overrides }));
  writeFileSync(crm, "BROKEN\n", { mode: 0o600 }); writeFileSync(lead, "BROKEN\n", { mode: 0o600 }); writeFileSync(worker, "BROKEN\n", { mode: 0o600 });
  let result = spawnSync("bash", ["-c", script()], { input: `${A}\n${O}\nhttps://${P8V2E.projectRef}.supabase.co\n`, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  writeFileSync(crm, "DUP=x\nDUP=y\n", { mode: 0o600 });
  result = spawnSync("bash", ["-c", script()], { input: `${A}\n${O}\nhttps://${P8V2E.projectRef}.supabase.co\n`, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const token = join(secrets, "amo-token.json"); writeFileSync(token, "{}\n", { mode: 0o644 });
  const rootRows = [
    `NEXT_PUBLIC_SUPABASE_URL=https://${P8V2E.projectRef}.supabase.co`, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abcdefgh", "EVO_PLATFORM_SUPABASE_SECRET_KEY=sb_secret_abcdefgh",
    `EVO_PLATFORM_ORGANIZATION_ID=${O}`, `EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID=${A}`, "EVO_PLATFORM_GEMINI_API_KEY=abcdefghijklmnop",
    "EVO_PLATFORM_STAFF_ASSISTANT_ENABLED=1", "EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED=1", `EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET=${"m".repeat(32)}`,
    "EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED=1", `EVO_LEAD_AGENT_SYNC_SECRET=${"s".repeat(32)}`,
  ];
  const leadNames = ["EVO_AGENT_AMO_BASE_URL", "EVO_AGENT_AMO_CLIENT_ID", "EVO_AGENT_AMO_CLIENT_SECRET", "EVO_AGENT_AMO_REDIRECT_URI", "EVO_AGENT_AMO_PIPELINE_ID", "EVO_AGENT_AMO_STATUS_ID", "EVO_AGENT_AMO_RESPONSIBLE_USER_ID", "EVO_AGENT_CRM_BASE_URL", "EVO_AGENT_CRM_SYNC_PATH", "EVO_AGENT_CRM_SYNC_SECRET", "EVO_AGENT_WAHA_BASE_URL", "EVO_AGENT_WAHA_API_KEY", "EVO_AGENT_WAHA_SESSION", "EVO_AGENT_WAHA_WEBHOOK_SECRET"];
  writeFileSync(crm, `${rootRows.join("\n")}\n`, { mode: 0o600 });
  writeFileSync(lead, `${leadNames.map((name) => `${name}=safe-value`).join("\n")}\nEVO_AGENT_AMO_TOKEN_FILE=${token}\n`, { mode: 0o600 });
  writeFileSync(worker, `EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET=${"w".repeat(32)}\n`, { mode: 0o600 });
  result = spawnSync("bash", ["-c", script()], { input: `${A}\n${O}\nhttps://${P8V2E.projectRef}.supabase.co\n`, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).blockers.includes("lead_agent_amocrm_credentials_missing"));
});

test("execution gate rejects stale GitHub main and unrelated successful workflow", () => {
  const head = "a".repeat(40); const tree = "b".repeat(40);
  function fake({ liveMain = head, workflowName = "EVO platform CI" } = {}) {
    return (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      if (key.includes("status --porcelain")) return { status: 0, stdout: "", stderr: "" };
      if (key.includes("rev-parse HEAD^{tree}") && key.includes("/source")) return { status: 0, stdout: `${P8V2E.applicationTree}\n`, stderr: "" };
      if (key.includes("rev-parse HEAD") && key.includes("/source")) return { status: 0, stdout: `${P8V2E.applicationCommit}\n`, stderr: "" };
      if (key.includes("rev-parse HEAD^{tree}")) return { status: 0, stdout: `${tree}\n`, stderr: "" };
      if (key.includes("rev-parse origin/main") || key.includes("rev-parse HEAD")) return { status: 0, stdout: `${head}\n`, stderr: "" };
      if (key.includes("api repos/izzhackt/evo_AI_CRM/commits/main")) return { status: 0, stdout: `${liveMain}\n`, stderr: "" };
      if (key.includes("run list")) return { status: 0, stdout: JSON.stringify([{ databaseId: 1, headSha: head, status: "completed", conclusion: "success", workflowName }]), stderr: "" };
      throw new Error(`unexpected command: ${key}`);
    };
  }
  assert.deepEqual(verifyP8V2EExecution("/tool", "/source", fake()), { application_commit: P8V2E.applicationCommit, application_tree: P8V2E.applicationTree, execution_commit: head, execution_tree: tree, execution_ci_run_id: 1 });
  assert.throws(() => verifyP8V2EExecution("/tool", "/source", fake({ liveMain: "c".repeat(40) })), /checkout drifted/);
  assert.throws(() => verifyP8V2EExecution("/tool", "/source", fake({ workflowName: "Other CI" })), /CI drifted/);
});

test("orchestrator keeps vault and configuration evidence after identity blocker", async () => {
  const calls = [];
  const published = await runP8V2EReadiness({
    toolRoot: "/tool",
    sourceRoot: "/source",
    environment: { EVO_P8V2E_AUTHORIZATION: P8V2E.authorization, SUPABASE_ACCESS_TOKEN: "token" },
    verifyExecution: async () => { calls.push("execution"); return source(); },
    verifyRetained: async () => { calls.push("retained"); return { status: "verified", result_sha256: P8V2E.retainedResultSha256 }; },
    auditVault: async (_tool, spec) => { calls.push(`vault:${spec.audience}`); return verifiedVault(spec); },
    observeIdentity: async () => { calls.push("identity"); return { safe: { status: "blocked", account: "exactly_one_active", organization: "none_active", project_ref_match: true, project_status: "ACTIVE_HEALTHY" }, accountId: A, organizationId: "", blockers: ["organization_not_singular"] }; },
    observeConfiguration: async () => { calls.push("configuration"); return { status: "blocked", root_crm: "blocked", lead_agent: "blocked", manual_worker: "blocked", configured_account_match: false, configured_organization_match: "not_comparable", supabase_project_match: false, blockers: ["root_crm_settings_missing", "lead_agent_amocrm_credentials_missing", "manual_worker_secret_missing"] }; },
    publishResult: async (_root, result) => { calls.push("publish"); return { result }; },
    generatedAt: "2026-08-18T12:00:00.000Z",
  });
  assert.deepEqual(calls, ["execution", "retained", "vault:client", "vault:internal", "identity", "configuration", "publish"]);
  assert.equal(published.result.result_code, "readiness_blocked");
  assert.equal(published.result.vaults.every((item) => item.status === "verified"), true);
  assert.equal(published.result.configuration.status, "blocked");
  assert.deepEqual(published.result.blockers, ["lead_agent_amocrm_credentials_missing", "manual_worker_secret_missing", "organization_not_singular", "root_crm_settings_missing"]);
});

test("retained and vault drift are independent closed blockers", async () => {
  const published = await runP8V2EReadiness({
    toolRoot: "/tool",
    sourceRoot: "/source",
    environment: { EVO_P8V2E_AUTHORIZATION: P8V2E.authorization },
    verifyExecution: async () => source(),
    verifyRetained: async () => { throw new Error("drift"); },
    auditVault: async (_tool, spec) => { if (spec.audience === "client") throw new Error("drift"); return verifiedVault(spec); },
    observeIdentity: async () => { throw new Error("blocked"); },
    observeConfiguration: async () => ({ status: "blocked", root_crm: "blocked", lead_agent: "blocked", manual_worker: "blocked", configured_account_match: "not_comparable", configured_organization_match: "not_comparable", supabase_project_match: false, blockers: ["root_crm_settings_missing"] }),
    publishResult: async (_root, result) => ({ result }),
    generatedAt: "2026-08-18T12:00:00.000Z",
  });
  assert.equal(published.result.vaults[1].status, "verified");
  assert.deepEqual(published.result.blockers, ["client_vault_drift", "management_query_failed", "retained_result_drift", "root_crm_settings_missing"]);
});

test("publication failure is retried only as a closed evidence_failed result", async () => {
  const attempts = [];
  const output = await runP8V2EReadiness({
    toolRoot: "/tool",
    sourceRoot: "/source",
    environment: { EVO_P8V2E_AUTHORIZATION: P8V2E.authorization },
    verifyExecution: async () => source(),
    verifyRetained: async () => ({ status: "verified", result_sha256: P8V2E.retainedResultSha256 }),
    auditVault: async (_tool, spec) => verifiedVault(spec),
    observeIdentity: async () => ({ safe: { status: "blocked", account: "exactly_one_active", organization: "none_active", project_ref_match: true, project_status: "ACTIVE_HEALTHY" }, accountId: A, organizationId: "", blockers: ["organization_not_singular"] }),
    observeConfiguration: async () => ({ status: "blocked", root_crm: "blocked", lead_agent: "blocked", manual_worker: "blocked", configured_account_match: false, configured_organization_match: "not_comparable", supabase_project_match: false, blockers: ["root_crm_settings_missing"] }),
    publishResult: async (_root, result) => {
      attempts.push(structuredClone(result));
      if (attempts.length === 1) throw new Error("synthetic write failure");
      return { result };
    },
    generatedAt: "2026-08-18T12:00:00.000Z",
  });
  assert.equal(attempts[0].result_code, "readiness_blocked");
  assert.equal(attempts[1].result_code, "evidence_failed");
  assert.ok(attempts[1].blockers.includes("evidence_publication_failed"));
  assert.equal(output.result.result_code, "evidence_failed");
});

test("atomic publication retains one mode-0600 closed result and rejects symlink parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "p8v2e-publication-"));
  const evidence = join(root, ".evo-release-evidence");
  mkdirSync(evidence, { mode: 0o700 }); chmodSync(evidence, 0o700);
  const published = publishP8V2EResult(root, blockedResult());
  assert.equal((await stat(published.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(published.path, "utf8")), blockedResult());

  const escaped = await mkdtemp(join(tmpdir(), "p8v2e-escaped-"));
  const linkedRoot = await mkdtemp(join(tmpdir(), "p8v2e-linked-"));
  symlinkSync(escaped, join(linkedRoot, ".evo-release-evidence"));
  assert.throws(() => publishP8V2EResult(linkedRoot, blockedResult()), /unsafe directory/);
});

test("real CLI fails before effects without the exact authorization", () => {
  const environment = { ...process.env };
  delete environment.EVO_P8V2E_AUTHORIZATION;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/p8v2e-independent-readiness-cli.mjs", import.meta.url)), "--application-root", tmpdir()], { encoding: "utf8", env: environment });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "p8v2e_failed:operation_failed\n");
});

test("real frozen vault golden hashes pass when the local vaults are available", { skip: !P8V2E_VAULTS.every((spec) => { try { return readFileSync(join(spec.audience === "internal" ? join(spec.path, "..") : spec.path, ".evo-vault.json")); } catch { return false; } }) }, () => {
  for (const spec of P8V2E_VAULTS) {
    const result = spawnSync("python3", [fileURLToPath(new URL("../scripts/p8v2e-vault-audit.py", import.meta.url)), "--vault", spec.path, "--audience", spec.audience], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(result.stdout);
    assert.equal(record.document_count, spec.document_count);
    assert.equal(record.source_set_sha256, spec.source_set_sha256);
  }
});
