import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  P8V2F,
  P8V2G_READINESS,
  bootstrapP8V2FOrganization,
  classifyP8V2FState,
  configureP8V2FHermes,
  createP8V2FClient,
  createP8V2FHermesScript,
  patchP8V2FPostgrest,
  publishP8V2FResult,
  runP8V2FSupabaseBootstrap,
  validateInitialState,
  validateP8V2FResult,
  validatePreparedState,
  verifyP8V2FProjectKey,
} from "../scripts/p8v2f-supabase-bootstrap.mjs";

const AUTH = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION = "33333333-3333-4333-8333-333333333333";
const PUBLISHABLE = `sb_publishable_${"p".repeat(30)}`;
const SECRET = `sb_secret_${"s".repeat(30)}`;
const EXECUTION = { commit: "a".repeat(40), tree: "b".repeat(40), ci_run_id: 7 };

function row(kind, id, overrides = {}) {
  return { kind, id, name: "", related_id: "", role: "", status: "", audit_count: 0, ...overrides };
}

function state(prepared = false) {
  return {
    project: { ref_match: true, status: "ACTIVE_HEALTHY" },
    postgrest: prepared ? P8V2F.afterSchemas : P8V2F.beforeSchemas,
    grouped: {
      auth: [row("auth", AUTH)],
      account: [row("account", ACCOUNT)],
      organization: prepared ? [row("organization", ORGANIZATION, { name: P8V2F.organizationName, related_id: AUTH, role: "admin", status: "active", audit_count: 1 })] : [],
    },
    counts: prepared ? { organizations: 1, profiles: 1, memberships: 1 } : { organizations: 0, profiles: 0, memberships: 0 },
    ledger: { count: 76, first: "001", last: "076" },
  };
}

function successResult() {
  return {
    version: P8V2F.version,
    result_code: "supabase_prepared",
    execution: EXECUTION,
    project: { ref_match: true, status: "ACTIVE_HEALTHY" },
    migration_ledger: { status: "verified_unchanged", count: 76, first: "001", last: "076", pending: "077" },
    data_api: { before: P8V2F.beforeSchemas, after: P8V2F.afterSchemas, status: "verified", platform_access: "verified" },
    identity: { auth_users: "exactly_one", active_accounts: "exactly_one", active_organizations: "exactly_one", organization_name: P8V2F.organizationName, admin_memberships: "exactly_one", bootstrap_audit: "exactly_one" },
    hermes_configuration: { status: "updated", settings: 5, file: "root_root_0600", rollback_sha256: "c".repeat(64), feature_enables: 0 },
    effects: { migrations_applied: 0, knowledge_imports: 0, deployments: 0, restarts: 0, provider_calls: 0, outbound_sends: 0 },
  };
}

test("closed result accepts success and rejects UUID/private material", () => {
  assert.equal(validateP8V2FResult(successResult()).result_code, "supabase_prepared");
  const leaked = structuredClone(successResult());
  leaked.execution.commit = AUTH;
  assert.throws(() => validateP8V2FResult(leaked));
});

test("real evidence publisher proves root mode and sole-file allowlist", () => {
  const toolRoot = realpathSync(mkdtempSync(join(tmpdir(), "p8v2f-evidence-")));
  const published = publishP8V2FResult(toolRoot, successResult());
  const root = join(toolRoot, P8V2F.resultRoot);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(root), [P8V2F.resultName]);
  assert.equal(existsSync(published.path), true);

  const extraRoot = realpathSync(mkdtempSync(join(tmpdir(), "p8v2f-extra-")));
  assert.throws(() => publishP8V2FResult(extraRoot, successResult(), {
    beforeFinalVerify: ({ root: evidenceRoot }) => writeFileSync(join(evidenceRoot, "unexpected"), "x", { mode: 0o600 }),
  }));
  const retained = join(extraRoot, P8V2F.resultRoot);
  assert.deepEqual(readdirSync(retained), ["unexpected"], "owned partial result is removed without deleting a foreign entry");

  const modeRoot = realpathSync(mkdtempSync(join(tmpdir(), "p8v2f-mode-")));
  assert.throws(() => publishP8V2FResult(modeRoot, successResult(), {
    beforeFinalVerify: ({ root: evidenceRoot }) => chmodSync(evidenceRoot, 0o755),
  }));
  assert.equal(existsSync(join(modeRoot, P8V2F.resultRoot)), false);
});

test("initial and prepared identity state are exact", () => {
  assert.deepEqual(validateInitialState(state(false)), { authUserId: AUTH, accountId: ACCOUNT });
  assert.deepEqual(validatePreparedState(state(true), AUTH, ACCOUNT), { organizationId: ORGANIZATION });
  assert.equal(classifyP8V2FState(state(false)).mode, "initial");
  assert.equal(classifyP8V2FState(state(true)).mode, "prepared");
  const wrong = state(true); wrong.grouped.organization[0].role = "sales";
  assert.throws(() => validatePreparedState(wrong, AUTH, ACCOUNT), /prepared identity/);
  const hiddenInactive = state(false); hiddenInactive.counts.profiles = 1;
  assert.throws(() => classifyP8V2FState(hiddenInactive), /initial identity/);
});

test("Management client is project-bound and PostgREST patch is exact", async () => {
  const calls = [];
  const client = createP8V2FClient({
    accessToken: `sbp_${"x".repeat(30)}`,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ db_schema: P8V2F.afterSchemas }), { status: 200 });
    },
  });
  await patchP8V2FPostgrest(client, P8V2F.afterSchemas);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), { db_schema: P8V2F.afterSchemas });
  await assert.rejects(client("/v1/projects/another/postgrest"), /escaped project/);
});

test("bootstrap uses only the reviewed RPC projection", async () => {
  let call;
  const output = await bootstrapP8V2FOrganization(SECRET, AUTH, async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify({ organization_name: P8V2F.organizationName, admin_auth_user_id: AUTH, role: "admin", status: "active" }), { status: 200 });
  });
  assert.deepEqual(output, { status: "created", attempts: 1 });
  assert.equal(call.url, `${P8V2F.projectUrl}/rest/v1/rpc/bootstrap_organization_admin`);
  const body = JSON.parse(call.options.body);
  assert.deepEqual(Object.keys(body).sort(), ["p_admin_auth_user_id", "p_admin_display_name", "p_organization_name", "p_reason", "p_request_id"]);
  assert.equal(body.p_admin_auth_user_id, AUTH);
  assert.equal(call.options.headers.apikey, SECRET);
  assert.equal(call.options.headers.Authorization, undefined);
});

test("bootstrap retries only exact PGRST106 with byte-identical requests", async () => {
  let clock = 0;
  const calls = [];
  const waits = [];
  const responses = [
    responseJson({ code: "PGRST106", message: "schema not ready" }, 406),
    responseJson({ code: "PGRST106", message: "schema still not ready" }, 406),
    responseJson({ organization_name: P8V2F.organizationName, admin_auth_user_id: AUTH, role: "admin", status: "active" }),
  ];
  const output = await bootstrapP8V2FOrganization(SECRET, AUTH, async (url, options) => {
    calls.push({ url, method: options.method, headers: { ...options.headers }, body: options.body });
    return responses.shift();
  }, {
    now: () => clock,
    wait: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
  });
  assert.deepEqual(output, { status: "created", attempts: 3 });
  assert.deepEqual(waits, [P8V2G_READINESS.delayMs, P8V2G_READINESS.delayMs]);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((call) => JSON.stringify(call))).size, 1);
});

test("bootstrap stops after the twelfth exact readiness response", async () => {
  let clock = 0;
  let calls = 0;
  let waits = 0;
  await assert.rejects(bootstrapP8V2FOrganization(SECRET, AUTH, async () => {
    calls += 1;
    return responseJson({ code: "PGRST106" }, 406);
  }, {
    now: () => clock,
    wait: async (milliseconds) => { waits += 1; clock += milliseconds; },
  }), /attempts exhausted/);
  assert.equal(calls, P8V2G_READINESS.maxAttempts);
  assert.equal(waits, P8V2G_READINESS.maxAttempts - 1);
});

test("bootstrap never retries non-readiness, malformed, oversized, or transport failures", async () => {
  const cases = [
    async () => responseJson({ code: "PGRST107" }, 406),
    async () => responseJson({ code: "PGRST106" }, 500),
    async () => new Response("not-json", { status: 406 }),
    async () => new Response(JSON.stringify({ code: "PGRST106", padding: "x".repeat(65 * 1024) }), { status: 406 }),
    async () => { throw new Error("transport ambiguous"); },
  ];
  for (const fetchImpl of cases) {
    let calls = 0;
    let waits = 0;
    await assert.rejects(bootstrapP8V2FOrganization(SECRET, AUTH, async (...args) => {
      calls += 1;
      return fetchImpl(...args);
    }, { now: () => 0, wait: async () => { waits += 1; } }));
    assert.equal(calls, 1);
    assert.equal(waits, 0);
  }
});

test("bootstrap refuses a readiness delay that cannot fit the deadline", async () => {
  let clock = 0;
  let waits = 0;
  await assert.rejects(bootstrapP8V2FOrganization(SECRET, AUTH, async () => {
    clock = P8V2G_READINESS.deadlineMs - P8V2G_READINESS.delayMs;
    return responseJson({ code: "PGRST106" }, 406);
  }, { now: () => clock, wait: async () => { waits += 1; } }), /cannot cover delay/);
  assert.equal(waits, 0);
});

test("bootstrap rejects late complete 200 and PGRST106 responses without waiting", async () => {
  const cases = [
    responseJson({ organization_name: P8V2F.organizationName, admin_auth_user_id: AUTH, role: "admin", status: "active" }),
    responseJson({ code: "PGRST106" }, 406),
  ];
  for (const response of cases) {
    let clock = 0;
    let calls = 0;
    let waits = 0;
    await assert.rejects(bootstrapP8V2FOrganization(SECRET, AUTH, async () => {
      calls += 1;
      clock = P8V2G_READINESS.deadlineMs;
      return response;
    }, { now: () => clock, wait: async () => { waits += 1; } }), /deadline exhausted/);
    assert.equal(calls, 1);
    assert.equal(waits, 0);
  }
});

test("publishable and secret keys are bound to the exact project before effects", async () => {
  for (const [key, kind] of [[PUBLISHABLE, "publishable"], [SECRET, "secret"]]) {
    let call;
    assert.equal(await verifyP8V2FProjectKey(key, kind, async (url, options) => {
      call = { url, options };
      return responseJson({ external: { email: true } });
    }), "verified");
    assert.equal(call.url, `${P8V2F.projectUrl}/auth/v1/settings`);
    assert.equal(call.options.headers.apikey, key);
    assert.equal(call.options.redirect, "error");
  }
  await assert.rejects(verifyP8V2FProjectKey(PUBLISHABLE, "publishable", async () => responseJson({ message: "Invalid API key" }, 401)), /HTTP 401/);
  await assert.rejects(verifyP8V2FProjectKey(PUBLISHABLE, "publishable", async () => new Response("x".repeat(65 * 1024), { status: 200 })), /too large/);
});

test("Hermes transport keeps every private value in stdin", () => {
  const payload = {
    NEXT_PUBLIC_SUPABASE_URL: P8V2F.projectUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION,
    EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID: ACCOUNT,
  };
  let observed;
  const result = configureP8V2FHermes(payload, (command, args, options) => {
    observed = { command, args, options };
    return { status: 0, signal: null, error: null, stderr: "", stdout: JSON.stringify({ status: "updated", settings: 5, file: "root_root_0600", rollback_sha256: "d".repeat(64), feature_enables: 0 }) };
  }, "print('{}')");
  assert.equal(result.status, "updated");
  assert.equal(observed.command, "ssh");
  const argv = observed.args.join(" ");
  for (const value of Object.values(payload)) assert.equal(argv.includes(value), false);
  assert.deepEqual(JSON.parse(observed.options.input), payload);
});

test("real remote writer atomically adds exact settings and preserves rollback", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p8v2f-")));
  const envPath = join(root, ".env.production");
  const rollbackRoot = join(root, "rollback");
  writeFileSync(envPath, "EXISTING=value\n", { mode: 0o600 }); chmodSync(envPath, 0o600);
  const uid = statSync(envPath).uid; const gid = statSync(envPath).gid;
  const payload = {
    NEXT_PUBLIC_SUPABASE_URL: P8V2F.projectUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION,
    EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID: ACCOUNT,
  };
  const script = createP8V2FHermesScript({ envPath, rollbackRoot, requiredUid: uid, requiredGid: gid, requiredParentMode: statSync(root).mode & 0o777 });
  const duplicate = JSON.stringify(payload).replace(`"NEXT_PUBLIC_SUPABASE_URL":`, `"NEXT_PUBLIC_SUPABASE_URL":"duplicate","NEXT_PUBLIC_SUPABASE_URL":`);
  assert.throws(() => execFileSync("python3", ["-c", script], { input: duplicate, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
  assert.equal(readFileSync(envPath, "utf8"), "EXISTING=value\n");
  const first = JSON.parse(execFileSync("python3", ["-c", script], { input: JSON.stringify(payload), encoding: "utf8" }));
  assert.equal(first.status, "updated");
  assert.equal(readFileSync(join(rollbackRoot, "crm-env.production.before"), "utf8"), "EXISTING=value\n");
  const second = JSON.parse(execFileSync("python3", ["-c", script], { input: JSON.stringify(payload), encoding: "utf8" }));
  assert.equal(second.status, "already_verified");
  const keys = readFileSync(envPath, "utf8").split("\n").filter(Boolean).map((line) => line.split("=", 1)[0]);
  assert.equal(new Set(keys).size, keys.length);
  writeFileSync(join(rollbackRoot, "crm-env.production.before"), "TAMPERED=value\n", { mode: 0o600 });
  assert.throws(() => execFileSync("python3", ["-c", script], { input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
});

test("remote writer verifies restoration and fails closed when restoration itself fails", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p8v2f-restore-")));
  const envPath = join(root, ".env.production");
  const rollbackRoot = join(root, "rollback");
  const original = "EXISTING=value\n";
  writeFileSync(envPath, original, { mode: 0o600 }); chmodSync(envPath, 0o600);
  const uid = statSync(envPath).uid; const gid = statSync(envPath).gid;
  const payload = {
    NEXT_PUBLIC_SUPABASE_URL: P8V2F.projectUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION,
    EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID: ACCOUNT,
  };
  const base = createP8V2FHermesScript({ envPath, rollbackRoot, requiredUid: uid, requiredGid: gid, requiredParentMode: statSync(root).mode & 0o777 });
  const postWriteFailure = base.replace(" print(json.dumps({'status':status", " raise RuntimeError('post-write verification failed')\n # print(json.dumps({'status':status");
  assert.throws(() => execFileSync("python3", ["-c", postWriteFailure], { input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
  assert.equal(readFileSync(envPath, "utf8"), original);

  const secondRoot = realpathSync(mkdtempSync(join(tmpdir(), "p8v2f-restore-fail-")));
  const secondEnv = join(secondRoot, ".env.production");
  writeFileSync(secondEnv, original, { mode: 0o600 }); chmodSync(secondEnv, 0o600);
  const failingRestore = createP8V2FHermesScript({ envPath: secondEnv, rollbackRoot: join(secondRoot, "rollback"), requiredUid: statSync(secondEnv).uid, requiredGid: statSync(secondEnv).gid, requiredParentMode: statSync(secondRoot).mode & 0o777 })
    .replace(" print(json.dumps({'status':status", " raise RuntimeError('post-write verification failed')\n # print(json.dumps({'status':status")
    .replace("  shutil.copyfile(BACK,temp);", "  raise RuntimeError('restore failed')\n  # shutil.copyfile(BACK,temp);");
  assert.throws(() => execFileSync("python3", ["-c", failingRestore], { input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
  assert.notEqual(readFileSync(secondEnv, "utf8"), original);
});

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

function orchestrationFetch({ initiallyPrepared = false, counters = {}, rejectKey = null, loseFirstRpcResponse = false } = {}) {
  let prepared = initiallyPrepared;
  return async (url, options = {}) => {
    if (url.endsWith("/postgrest") && options.method === "PATCH") { counters.patches = (counters.patches ?? 0) + 1; prepared = options.body.includes(P8V2F.afterSchemas); return responseJson({ db_schema: prepared ? P8V2F.afterSchemas : P8V2F.beforeSchemas }); }
    if (url.endsWith("/auth/v1/settings")) {
      counters.keyProbes = (counters.keyProbes ?? 0) + 1;
      if (options.headers.apikey === rejectKey) return responseJson({ message: "Invalid API key" }, 401);
      return responseJson({ external: {} });
    }
    if (url.includes("/rpc/bootstrap_organization_admin")) {
      counters.rpc = (counters.rpc ?? 0) + 1;
      if (loseFirstRpcResponse && counters.rpc === 1) { prepared = true; throw new Error("response lost after commit"); }
      return responseJson({ organization_name: P8V2F.organizationName, admin_auth_user_id: AUTH, role: "admin", status: "active" });
    }
    if (url.endsWith(`/projects/${P8V2F.projectRef}`)) return responseJson({ ref: P8V2F.projectRef, status: "ACTIVE_HEALTHY" });
    if (url.endsWith("/postgrest")) return responseJson({ db_schema: prepared ? P8V2F.afterSchemas : P8V2F.beforeSchemas });
    if (url.endsWith("/database/query/read-only")) {
      const query = JSON.parse(options.body).query;
      if (query.includes("schema_migrations")) return responseJson([{ count: 76, first: "001", last: "076" }], 201);
      if (query.includes("platform.organization_memberships) as memberships")) return responseJson([{ organizations: prepared ? 1 : 0, profiles: prepared ? 1 : 0, memberships: prepared ? 1 : 0 }], 201);
      const rows = [row("account", ACCOUNT), row("auth", AUTH)];
      if (prepared) rows.push(row("organization", ORGANIZATION, { name: P8V2F.organizationName, related_id: AUTH, role: "admin", status: "active", audit_count: 1 }));
      return responseJson(rows, 201);
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

test("orchestration reaches safe success without migration/provider/deploy effects", async () => {
  let published;
  const output = await runP8V2FSupabaseBootstrap({
    toolRoot: "/safe/tool",
    reviewedCommit: EXECUTION.commit,
    environment: {
      EVO_P8V2G_AUTHORIZATION: P8V2F.authorization,
      SUPABASE_ACCESS_TOKEN: `sbp_${"x".repeat(30)}`,
      EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    },
    fetchImpl: orchestrationFetch(),
    verifyExecution: () => EXECUTION,
    configureHermes: () => ({ status: "updated", settings: 5, file: "root_root_0600", rollback_sha256: "e".repeat(64), feature_enables: 0 }),
    publish: (_root, result) => { published = result; return { path: "safe", sha256: "f".repeat(64) }; },
  });
  assert.equal(output.result.result_code, "supabase_prepared");
  assert.deepEqual(output.result.effects, { migrations_applied: 0, knowledge_imports: 0, deployments: 0, restarts: 0, provider_calls: 0, outbound_sends: 0 });
  assert.equal(JSON.stringify(published).includes(AUTH), false);
  assert.equal(JSON.stringify(published).includes(SECRET), false);
});

test("exact prepared state resumes without repatching or creating a second organization", async () => {
  const counters = {};
  const output = await runP8V2FSupabaseBootstrap({
    toolRoot: "/safe/tool",
    reviewedCommit: EXECUTION.commit,
    environment: {
      EVO_P8V2G_AUTHORIZATION: P8V2F.authorization,
      SUPABASE_ACCESS_TOKEN: `sbp_${"x".repeat(30)}`,
      EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    },
    fetchImpl: orchestrationFetch({ initiallyPrepared: true, counters }),
    verifyExecution: () => EXECUTION,
    configureHermes: () => ({ status: "already_verified", settings: 5, file: "root_root_0600", rollback_sha256: "e".repeat(64), feature_enables: 0 }),
    publish: () => ({ path: "safe", sha256: "f".repeat(64) }),
  });
  assert.equal(output.result.result_code, "supabase_prepared");
  assert.equal(counters.patches ?? 0, 0);
  assert.equal(counters.rpc, 1);
  assert.equal(counters.keyProbes, 2);
});

test("wrong-project publishable key stops before every mutation", async () => {
  const counters = {};
  await assert.rejects(runP8V2FSupabaseBootstrap({
    toolRoot: "/safe/tool",
    reviewedCommit: EXECUTION.commit,
    environment: {
      EVO_P8V2G_AUTHORIZATION: P8V2F.authorization,
      SUPABASE_ACCESS_TOKEN: `sbp_${"x".repeat(30)}`,
      EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    },
    fetchImpl: orchestrationFetch({ counters, rejectKey: PUBLISHABLE }),
    verifyExecution: () => EXECUTION,
    configureHermes: () => { throw new Error("must not configure"); },
    publish: () => ({ path: "safe", sha256: "f".repeat(64) }),
  }), (error) => error.code === "configuration_failed");
  assert.equal(counters.patches ?? 0, 0);
  assert.equal(counters.rpc ?? 0, 0);
});

test("lost bootstrap response preserves canonical schemas and records reconciliation", async () => {
  const counters = {};
  let published;
  await assert.rejects(runP8V2FSupabaseBootstrap({
    toolRoot: "/safe/tool",
    reviewedCommit: EXECUTION.commit,
    environment: {
      EVO_P8V2G_AUTHORIZATION: P8V2F.authorization,
      SUPABASE_ACCESS_TOKEN: `sbp_${"x".repeat(30)}`,
      EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    },
    fetchImpl: orchestrationFetch({ counters, loseFirstRpcResponse: true }),
    verifyExecution: () => EXECUTION,
    configureHermes: () => { throw new Error("must not configure after ambiguous response"); },
    publish: (_root, result) => { published = result; return { path: "safe", sha256: "f".repeat(64) }; },
  }), (error) => error.code === "configuration_reconciliation_required");
  assert.equal(counters.patches, 1, "canonical schemas are not rolled back after committed bootstrap readback");
  assert.equal(published.data_api.status, "patched");
  assert.equal(published.identity.active_organizations, "exactly_one");
});

test("publication failure produces a truthful evidence_failed terminal attempt", async () => {
  const published = [];
  await assert.rejects(runP8V2FSupabaseBootstrap({
    toolRoot: "/safe/tool",
    reviewedCommit: EXECUTION.commit,
    environment: {
      EVO_P8V2G_AUTHORIZATION: P8V2F.authorization,
      SUPABASE_ACCESS_TOKEN: `sbp_${"x".repeat(30)}`,
      EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    },
    fetchImpl: orchestrationFetch(),
    verifyExecution: () => EXECUTION,
    configureHermes: () => ({ status: "updated", settings: 5, file: "root_root_0600", rollback_sha256: "e".repeat(64), feature_enables: 0 }),
    publish: (_root, result) => {
      published.push(result.result_code);
      if (published.length === 1) throw new Error("atomic publication failed");
      return { path: "safe", sha256: "f".repeat(64) };
    },
  }), (error) => error.code === "evidence_failed");
  assert.deepEqual(published, ["supabase_prepared", "evidence_failed"]);
});

test("post-bootstrap Hermes failure is retained as reconciliation required", async () => {
  let published;
  await assert.rejects(runP8V2FSupabaseBootstrap({
    toolRoot: "/safe/tool",
    reviewedCommit: EXECUTION.commit,
    environment: {
      EVO_P8V2G_AUTHORIZATION: P8V2F.authorization,
      SUPABASE_ACCESS_TOKEN: `sbp_${"x".repeat(30)}`,
      EVO_PLATFORM_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET,
    },
    fetchImpl: orchestrationFetch(),
    verifyExecution: () => EXECUTION,
    configureHermes: () => { throw new Error("remote stopped"); },
    publish: (_root, result) => { published = result; return { path: "safe", sha256: "f".repeat(64) }; },
  }), (error) => error.code === "configuration_reconciliation_required");
  assert.equal(published.result_code, "configuration_reconciliation_required");
  assert.equal(published.identity.active_organizations, "exactly_one");
  assert.equal(JSON.stringify(published).includes(ORGANIZATION), false);
});

test("missing exact authorization stops before every effect", async () => {
  await assert.rejects(runP8V2FSupabaseBootstrap({
    toolRoot: "/safe/tool",
    reviewedCommit: EXECUTION.commit,
    environment: {},
    verifyExecution: () => { throw new Error("must not run"); },
  }), /authorization/);
});
