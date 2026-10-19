import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AppEnvironmentContractError,
  sealCandidateEnvironmentSnapshot,
  sealPrivateEnvironmentSnapshot,
  verifyRuntimeEnvironmentIdentity,
  validateAppEnvironmentContract,
  verifySupabaseProjectCredentials,
} from "../scripts/evo-app-env-contract.mjs";

const TEST_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const TEST_SALES_MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const TEST_SECRET_KEY = "sb_secret_ssssssssssssssssssssssss";
const TEST_SUPABASE_PROJECT_REF = "aaaaaaaaaaaaaaaaaaaa";

const example = `
EVO_CRM_DOMAIN=crm.evoadmissions.com
EVO_CADDY_NETWORK=evo_public_web
NEXT_PUBLIC_SUPABASE_URL=https://replace-with-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=replace-with-publishable-key
EVO_PLATFORM_ORGANIZATION_ID=replace-with-organization-uuid
EVO_PLATFORM_SUPABASE_SECRET_KEY=replace-with-server-secret-key
EVO_PLATFORM_WAHA_INGRESS_ENABLED=0
EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET=
EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID=
EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0
EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=
ANTHROPIC_API_KEY=
`;

function valid(overrides = {}) {
  const values = {
    EVO_CRM_DOMAIN: "crm.evoadmissions.com",
    EVO_CADDY_NETWORK: "evo_public_web",
    NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_runtime_safe",
    EVO_PLATFORM_ORGANIZATION_ID: TEST_ORGANIZATION_ID,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: TEST_SECRET_KEY,
    EVO_PLATFORM_WAHA_INGRESS_ENABLED: "0",
    EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "",
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: "",
    EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "0",
    EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "",
    ANTHROPIC_API_KEY: "",
    ...overrides,
  };
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.synthetic-signature`;
}

function expectInvalid(actual, code) {
  assert.throws(
    () => validateAppEnvironmentContract({
      exampleText: example,
      actualText: actual,
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    }),
    (error) => error instanceof AppEnvironmentContractError && error.code === code,
  );
}

test("accepts the Supabase successor runtime while allowing disabled optional integrations to stay empty", () => {
  assert.deepEqual(
    validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid(),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    }),
    { ok: true, code: "valid" },
  );
});

test("binds both runtime keys to the exact Supabase project without reading response bodies", async () => {
  const requests = [];
  const result = await verifySupabaseProjectCredentials({
    actualText: valid(),
    expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response("private-response-must-not-be-read", { status: 200 });
    },
  });

  assert.deepEqual(result, { ok: true, code: "verified" });
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co/auth/v1/settings`,
      `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co/auth/v1/admin/users?page=1&per_page=1`,
    ],
  );
  assert.equal(requests[0].init.headers.apikey, "sb_publishable_runtime_safe");
  assert.equal("Authorization" in requests[0].init.headers, false);
  assert.equal(requests[1].init.headers.apikey, TEST_SECRET_KEY);
  assert.equal("Authorization" in requests[1].init.headers, false);
  assert.equal(requests.every(({ init }) => init.redirect === "error"), true);
  assert.equal(requests.every(({ init }) => init.method === "GET"), true);
});

test("fails closed when either key is rejected by the exact Supabase project", async () => {
  await assert.rejects(
    verifySupabaseProjectCredentials({
      actualText: valid(),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
      fetchImpl: async (url) => new Response("", {
        status: String(url).endsWith("/auth/v1/settings") ? 401 : 200,
      }),
    }),
    (error) => error instanceof AppEnvironmentContractError &&
      error.code === "public_supabase_key_project_mismatch",
  );

  await assert.rejects(
    verifySupabaseProjectCredentials({
      actualText: valid(),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
      fetchImpl: async (url) => new Response("", {
        status: String(url).includes("/admin/users") ? 403 : 200,
      }),
    }),
    (error) => error instanceof AppEnvironmentContractError &&
      error.code === "secret_supabase_key_project_mismatch",
  );
});

test("fails closed without leaking keys when Supabase verification is unavailable", async () => {
  await assert.rejects(
    verifySupabaseProjectCredentials({
      actualText: valid(),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
      fetchImpl: async () => {
        throw new Error("network down");
      },
    }),
    (error) => error instanceof AppEnvironmentContractError &&
      error.code === "supabase_key_verification_unavailable" &&
      !error.message.includes(TEST_SECRET_KEY),
  );
});

test("rejects missing names, duplicate names, empty Supabase authority, and known placeholders", () => {
  expectInvalid(valid().replace(/^EVO_CRM_DOMAIN=.*\n/mu, ""), "required_env_name_missing");
  expectInvalid(`${valid()}EVO_CRM_DOMAIN=duplicate.example\n`, "duplicate_env_name");
  for (const EVO_CRM_DOMAIN of [
    "evo-crm.72.62.119.112.sslip.io",
    "app.evoadmissions.com",
    "crm.evoadmissions.com.attacker.invalid",
    "https://crm.evoadmissions.com",
  ]) {
    expectInvalid(valid({ EVO_CRM_DOMAIN }), "crm_domain_invalid");
  }
  expectInvalid(
    valid({ EVO_PLATFORM_ORGANIZATION_ID: "" }),
    "required_env_value_missing",
  );
  expectInvalid(
    valid({ EVO_PLATFORM_SUPABASE_SECRET_KEY: "" }),
    "required_env_value_missing",
  );
  expectInvalid(
    valid({ EVO_PLATFORM_SUPABASE_SECRET_KEY: "replace-with-a-real-secret" }),
    "placeholder_env_value_rejected",
  );
  expectInvalid(
    valid({ ANTHROPIC_API_KEY: "change-me-before-release" }),
    "placeholder_env_value_rejected",
  );
});

test("rejects malformed organization and server-only Supabase authority even when optional integrations are disabled", () => {
  for (const EVO_PLATFORM_ORGANIZATION_ID of [
    "not-a-uuid",
    "00000000-0000-0000-0000-000000000000",
  ]) {
    expectInvalid(
      valid({ EVO_PLATFORM_ORGANIZATION_ID }),
      "required_env_value_invalid",
    );
  }
  for (const EVO_PLATFORM_SUPABASE_SECRET_KEY of [
    "server-only-key-material",
    "sb_publishable_wrong-boundary",
    jwt("anon"),
  ]) {
    expectInvalid(
      valid({ EVO_PLATFORM_SUPABASE_SECRET_KEY }),
      "required_env_value_invalid",
    );
  }
});

test("rejects superseded SQLite, development-auth, and worker environment names", () => {
  for (const [name, value] of [
    ["AUTH_SECRET", "a".repeat(48)],
    ["EVO_SECRET_ENCRYPTION_KEY", "b".repeat(43)],
    ["EVO_DB_PATH", "/app/data/edu-admin.db"],
    ["EVO_BACKUP_DIR", "/app/backups"],
    ["EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED", "0"],
    ["EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET", "m".repeat(32)],
    ["EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED", "0"],
    ["EVO_LEAD_AGENT_SYNC_SECRET", "l".repeat(32)],
    ["EVO_AGENT_WAHA_SESSION", "crm_primary"],
    ["EVO_PLATFORM_WAHA_SESSION_NAME", "crm_primary"],
  ]) {
    expectInvalid(
      valid({ [name]: value }),
      "superseded_env_name_forbidden",
    );
  }
});

test("rejects unsafe production flags and malformed public Supabase configuration", () => {
  expectInvalid(
    valid({ NEXT_PUBLIC_SUPABASE_URL: "http://staging.supabase.co" }),
    "public_supabase_url_invalid",
  );
  expectInvalid(
    valid({ NEXT_PUBLIC_SUPABASE_URL: `https://${"b".repeat(20)}.supabase.co` }),
    "public_supabase_project_mismatch",
  );
  expectInvalid(
    valid({ NEXT_PUBLIC_SUPABASE_URL: "https://unrelated.example.com" }),
    "public_supabase_project_mismatch",
  );
  expectInvalid(
    valid({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden" }),
    "public_supabase_key_invalid",
  );
  expectInvalid(
    valid({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "not-a-publishable-key" }),
    "public_supabase_key_invalid",
  );
  expectInvalid(
    valid({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }),
    "public_supabase_key_invalid",
  );
  assert.deepEqual(
    validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    }),
    { ok: true, code: "valid" },
  );
});

// docs/runbooks/selfhosted-cutover.md: the "project" of the self-hosted stack is the word `selfhosted`,
// and its only accepted origin is exactly https://supabase.evoadmissions.com.
const SELFHOSTED_IDENTITY = "selfhosted";
const SELFHOSTED_ORIGIN = "https://supabase.evoadmissions.com";

test("self-hosted: accepts exactly the self-hosted origin and refuses the cloud origin, and the other way round", () => {
  assert.deepEqual(
    validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid({ NEXT_PUBLIC_SUPABASE_URL: SELFHOSTED_ORIGIN }),
      expectedSupabaseProjectRef: SELFHOSTED_IDENTITY,
    }),
    { ok: true, code: "valid" },
  );
  const refused = (url, identity, code) => assert.throws(
    () => validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid({ NEXT_PUBLIC_SUPABASE_URL: url }),
      expectedSupabaseProjectRef: identity,
    }),
    (error) => error instanceof AppEnvironmentContractError && error.code === code,
    `${identity} / ${url}`,
  );
  // the mode and the env must agree: a leftover cloud address never passes as self-hosted
  refused(`https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`, SELFHOSTED_IDENTITY, "public_supabase_project_mismatch");
  refused(SELFHOSTED_ORIGIN, TEST_SUPABASE_PROJECT_REF, "public_supabase_project_mismatch");
  // exact origin, no patterns: neighbours of the one allowed host never pass
  for (const url of [
    `${SELFHOSTED_ORIGIN}/`, `${SELFHOSTED_ORIGIN}.attacker.invalid`, "https://evoadmissions.com",
    "https://x.supabase.evoadmissions.com", "https://supabase.evoadmissions.co", "https://SUPABASE.evoadmissions.com",
    "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  ]) {
    assert.throws(
      () => validateAppEnvironmentContract({
        exampleText: example,
        actualText: valid({ NEXT_PUBLIC_SUPABASE_URL: url }),
        expectedSupabaseProjectRef: SELFHOSTED_IDENTITY,
      }),
      (error) => error instanceof AppEnvironmentContractError && error.code === "public_supabase_project_mismatch",
      url,
    );
  }
  refused("http://supabase.evoadmissions.com", SELFHOSTED_IDENTITY, "public_supabase_url_invalid");
  refused("https://supabase.evoadmissions.com/rest/v1", SELFHOSTED_IDENTITY, "public_supabase_url_invalid");
  refused("https://user:pass@supabase.evoadmissions.com", SELFHOSTED_IDENTITY, "public_supabase_url_invalid");
  refused("https://supabase.evoadmissions.com?x=1", SELFHOSTED_IDENTITY, "public_supabase_url_invalid");
  // only the 20-character ref and the single word are identities
  for (const identity of ["Selfhosted", "self-hosted", "selfhosted ", "", "supabase.evoadmissions.com", undefined, null]) {
    assert.throws(
      () => validateAppEnvironmentContract({
        exampleText: example,
        actualText: valid({ NEXT_PUBLIC_SUPABASE_URL: SELFHOSTED_ORIGIN }),
        expectedSupabaseProjectRef: identity,
      }),
      (error) => error instanceof AppEnvironmentContractError && error.code === "expected_supabase_project_invalid",
      String(identity),
    );
  }
});

test("self-hosted: both keys are verified against the self-hosted origin with the same two requests, and a rejection fails closed", async () => {
  const requests = [];
  const accepted = await verifySupabaseProjectCredentials({
    actualText: valid({ NEXT_PUBLIC_SUPABASE_URL: SELFHOSTED_ORIGIN }),
    expectedSupabaseProjectRef: SELFHOSTED_IDENTITY,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response("private-response-must-not-be-read", { status: 200 });
    },
  });
  assert.deepEqual(accepted, { ok: true, code: "verified" });
  assert.deepEqual(requests.map(({ url }) => url), [
    `${SELFHOSTED_ORIGIN}/auth/v1/settings`,
    `${SELFHOSTED_ORIGIN}/auth/v1/admin/users?page=1&per_page=1`,
  ]);
  assert.equal(requests[0].init.headers.apikey, "sb_publishable_runtime_safe");
  assert.equal(requests[1].init.headers.apikey, TEST_SECRET_KEY);
  assert.equal(requests.every(({ init }) => init.redirect === "error" && init.method === "GET"), true);

  // legacy JWT keys of the self-hosted stack carry no `ref`: they are accepted by role, the server checks the signature
  const legacyRequests = [];
  await verifySupabaseProjectCredentials({
    actualText: valid({
      NEXT_PUBLIC_SUPABASE_URL: SELFHOSTED_ORIGIN,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
      EVO_PLATFORM_SUPABASE_SECRET_KEY: jwt("service_role"),
    }),
    expectedSupabaseProjectRef: SELFHOSTED_IDENTITY,
    fetchImpl: async (url, init) => { legacyRequests.push({ url: String(url), init }); return new Response("", { status: 200 }); },
  });
  assert.equal(legacyRequests[1].init.headers.Authorization, `Bearer ${jwt("service_role")}`);

  await assert.rejects(
    verifySupabaseProjectCredentials({
      actualText: valid({ NEXT_PUBLIC_SUPABASE_URL: SELFHOSTED_ORIGIN }),
      expectedSupabaseProjectRef: SELFHOSTED_IDENTITY,
      fetchImpl: async (url) => new Response("", { status: String(url).endsWith("/auth/v1/settings") ? 401 : 200 }),
    }),
    (error) => error instanceof AppEnvironmentContractError && error.code === "public_supabase_key_project_mismatch",
  );
  await assert.rejects(
    verifySupabaseProjectCredentials({
      actualText: valid({ NEXT_PUBLIC_SUPABASE_URL: SELFHOSTED_ORIGIN }),
      expectedSupabaseProjectRef: SELFHOSTED_IDENTITY,
      fetchImpl: async (url) => new Response("", { status: String(url).includes("/admin/users") ? 403 : 200 }),
    }),
    (error) => error instanceof AppEnvironmentContractError && error.code === "secret_supabase_key_project_mismatch",
  );
  // an unreachable self-hosted stack stops the release; it never falls back to the cloud project
  const attempted = [];
  await assert.rejects(
    verifySupabaseProjectCredentials({
      actualText: valid({ NEXT_PUBLIC_SUPABASE_URL: SELFHOSTED_ORIGIN }),
      expectedSupabaseProjectRef: SELFHOSTED_IDENTITY,
      fetchImpl: async (url) => { attempted.push(String(url)); throw new Error("network down"); },
    }),
    (error) => error instanceof AppEnvironmentContractError && error.code === "supabase_key_verification_unavailable",
  );
  assert.ok(attempted.every((url) => url.startsWith(`${SELFHOSTED_ORIGIN}/`)));
});

test("self-hosted: the closed CLI takes the word as the project argument and checks the same file contract", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-env-selfhosted-")));
  try {
    const examplePath = join(root, "example.env");
    const envPath = join(root, "app.env");
    writeFileSync(examplePath, example, { mode: 0o600 });
    writeFileSync(envPath, valid({ NEXT_PUBLIC_SUPABASE_URL: SELFHOSTED_ORIGIN }), { mode: 0o600 });
    chmodSync(examplePath, 0o600);
    chmodSync(envPath, 0o600);
    const run = (identity) => spawnSync(process.execPath, [
      "scripts/evo-app-env-contract.mjs", "--example", examplePath, "--env", envPath, "--supabase-project-ref", identity,
    ], { encoding: "utf8", timeout: 30_000 });
    const accepted = run(SELFHOSTED_IDENTITY);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.deepEqual(JSON.parse(accepted.stdout), { ok: true, code: "valid" });
    const mismatched = run(TEST_SUPABASE_PROJECT_REF);
    assert.equal(mismatched.status, 1);
    assert.equal(mismatched.stdout, "");
    assert.equal(mismatched.stderr, '{"ok":false,"code":"app_env_contract_invalid"}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enabled observability and WAHA ingress require complete server-only configuration", () => {
  expectInvalid(
    valid({ EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1" }),
    "enabled_feature_configuration_missing",
  );
  expectInvalid(
    valid({ EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1" }),
    "enabled_feature_configuration_missing",
  );

  const platform = {
    NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`,
  };
  assert.deepEqual(
    validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid({
        ...platform,
        EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "o".repeat(32),
        EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1",
        EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "w".repeat(32),
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: TEST_SALES_MEMBERSHIP_ID,
      }),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    }),
    { ok: true, code: "valid" },
  );

  assert.deepEqual(
    validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid({
        ...platform,
        EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "o".repeat(32),
        EVO_PLATFORM_SUPABASE_SECRET_KEY: jwt("service_role"),
      }),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    }),
    { ok: true, code: "valid" },
  );
});

test("enabled WAHA ingress requires the intake Sales membership UUID, and the example lists its name", () => {
  const ingress = {
    EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1",
    EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "w".repeat(32),
  };
  for (const membership of [
    undefined,
    "",
    "not-a-uuid",
    "00000000-0000-0000-0000-000000000000",
  ]) {
    expectInvalid(
      valid({
        ...ingress,
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: membership ?? "",
      }),
      "enabled_feature_configuration_missing",
    );
  }
  assert.deepEqual(
    validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid({
        ...ingress,
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: TEST_SALES_MEMBERSHIP_ID,
      }),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    }),
    { ok: true, code: "valid" },
  );

  // A staged setup is valid: the secret and the intake owner are in place while
  // the runtime switch is still off.
  assert.deepEqual(
    validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid({
        EVO_PLATFORM_WAHA_INGRESS_ENABLED: "0",
        EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "w".repeat(32),
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: TEST_SALES_MEMBERSHIP_ID,
      }),
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    }),
    { ok: true, code: "valid" },
  );

  // Ingress off: the name must still be present (empty is fine).
  expectInvalid(
    valid().replace(/^EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID=.*\n/mu, ""),
    "required_env_name_missing",
  );
  // The shipped example carries the name, so a production env file without it
  // is rejected before release.
  const shipped = readFileSync("deploy/env.production.example", "utf8");
  assert.match(shipped, /^EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID=$/mu);
});

test("closed CLI validates private files without printing their values", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-app-env-contract-")));
  const examplePath = join(root, "env.example");
  const actualPath = join(root, ".env.production");
  try {
    writeFileSync(examplePath, example, { mode: 0o600 });
    writeFileSync(actualPath, valid(), { mode: 0o600 });
    chmodSync(examplePath, 0o600);
    chmodSync(actualPath, 0o600);
    const accepted = spawnSync(
      process.execPath,
      [
        "scripts/evo-app-env-contract.mjs",
        "--example",
        examplePath,
        "--env",
        actualPath,
        "--supabase-project-ref",
        TEST_SUPABASE_PROJECT_REF,
      ],
      { encoding: "utf8" },
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, '{"ok":true,"code":"valid"}\n');
    assert.equal(accepted.stderr, "");

    writeFileSync(
      actualPath,
      valid({
        EVO_PLATFORM_SUPABASE_SECRET_KEY: "never-print-this-value-change-me",
      }),
      { mode: 0o600 },
    );
    const rejected = spawnSync(
      process.execPath,
      [
        "scripts/evo-app-env-contract.mjs",
        "--example",
        examplePath,
        "--env",
        actualPath,
        "--supabase-project-ref",
        TEST_SUPABASE_PROJECT_REF,
      ],
      { encoding: "utf8" },
    );
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, "");
    assert.equal(
      rejected.stderr,
      '{"ok":false,"code":"app_env_contract_invalid"}\n',
    );
    assert.equal(rejected.stderr.includes("never-print-this-value"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("seals exact private environment bytes once with mode 0600 and digest-only CLI output", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-env-snapshot-")));
  const source = join(root, ".env.production");
  const snapshot = join(root, "candidate-app.env");
  const cliSnapshot = join(root, "cli-app.env");
  const bytes = Buffer.from(valid(), "utf8");
  try {
    writeFileSync(source, bytes, { mode: 0o640 });
    chmodSync(source, 0o640);
    const sealed = sealPrivateEnvironmentSnapshot(source, snapshot);
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.deepEqual(sealed, { ok: true, sha256: digest });
    assert.deepEqual(readFileSync(snapshot), bytes);
    assert.equal(Number(lstatSync(snapshot).mode & 0o777), 0o600);

    const cli = spawnSync(
      process.execPath,
      [
        "scripts/evo-app-env-contract.mjs",
        "--seal-private-env",
        source,
        "--snapshot",
        cliSnapshot,
      ],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, `${JSON.stringify({ ok: true, sha256: digest })}\n`);
    assert.equal(cli.stderr, "");
    assert.equal(cli.stdout.includes("EVO_PLATFORM_SUPABASE_SECRET_KEY"), false);
    assert.deepEqual(readFileSync(cliSnapshot), bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate CLI seals controller image identity without modifying operator env or historical copies", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-env-identity-")));
  const source = join(root, ".env.production");
  const snapshot = join(root, "candidate-app.env");
  const historical = join(root, "rollback-app.env");
  const imageId = `sha256:${"a".repeat(64)}`;
  const sourceText = valid().trimEnd();
  try {
    writeFileSync(source, sourceText, { mode: 0o600 });
    const cli = spawnSync(process.execPath, [
      "scripts/evo-app-env-contract.mjs", "--seal-candidate-env", source,
      "--snapshot", snapshot, "--runtime-image-id", imageId,
    ], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    const expected = `${sourceText}\nEVO_RUNTIME_IMAGE_ID=${imageId}\n`;
    assert.equal(readFileSync(snapshot, "utf8"), expected);
    assert.equal(readFileSync(source, "utf8"), sourceText);
    assert.equal(lstatSync(snapshot).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(cli.stdout), {
      ok: true, sha256: createHash("sha256").update(expected).digest("hex"),
    });
    assert.equal(cli.stdout.includes(imageId), false);
    sealPrivateEnvironmentSnapshot(snapshot, historical);
    assert.equal(readFileSync(historical, "utf8"), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime identity CLI binds sealed snapshot, actual container ID and revision without exposing other env", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-runtime-identity-")));
  const snapshot = join(root, "candidate-app.env");
  const imageId = `sha256:${"a".repeat(64)}`;
  const revision = "b".repeat(40);
  try {
    writeFileSync(snapshot, `EVO_RUNTIME_IMAGE_ID=${imageId}\n`, { mode: 0o600 });
    const cli = spawnSync(process.execPath, [
      "scripts/evo-app-env-contract.mjs", "--verify-runtime-identity",
      "--snapshot", snapshot, "--runtime-image-id", imageId,
      "--release-revision", revision,
    ], {
      encoding: "utf8", input: JSON.stringify([
        `EVO_RUNTIME_IMAGE_ID=${imageId}`, `EVO_RELEASE_REVISION=${revision}`,
        "PRIVATE_TEST_KEY=never-print-this-value",
      ]),
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), { ok: true });
    assert.equal(cli.stderr, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate seal rejects reserved identity, invalid IDs and source races before creating a snapshot", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-env-identity-deny-")));
  const source = join(root, ".env.production");
  const snapshot = join(root, "candidate-app.env");
  const imageId = `sha256:${"a".repeat(64)}`;
  try {
    for (const text of [
      `${valid()}EVO_RUNTIME_IMAGE_ID=${imageId}\n`,
      `${valid()}  EVO_RUNTIME_IMAGE_ID = ''\n`,
      `${valid()}EVO_RUNTIME_IMAGE_ID=x\nEVO_RUNTIME_IMAGE_ID=y\n`,
    ]) {
      writeFileSync(source, text, { mode: 0o600 });
      assert.throws(() => sealCandidateEnvironmentSnapshot(source, snapshot, imageId));
      assert.equal(lstatSync(snapshot, { throwIfNoEntry: false }), undefined);
      assert.equal(readFileSync(source, "utf8"), text);
    }
    writeFileSync(source, valid(), { mode: 0o600 });
    for (const invalid of ["", "a".repeat(64), imageId.toUpperCase(), `${imageId}\n`, null]) {
      assert.throws(() => sealCandidateEnvironmentSnapshot(source, snapshot, invalid));
      assert.equal(lstatSync(snapshot, { throwIfNoEntry: false }), undefined);
    }
    assert.throws(() => sealCandidateEnvironmentSnapshot(source, snapshot, imageId, {
      afterSourceRead() { writeFileSync(source, `${valid()}# changed\n`); },
    }), (error) => error.code === "snapshot_source_changed");
    assert.equal(lstatSync(snapshot, { throwIfNoEntry: false }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime identity denies missing, duplicate, malformed and mismatched actual or sealed values", () => {
  const imageId = `sha256:${"a".repeat(64)}`;
  const revision = "b".repeat(40);
  const identity = `EVO_RUNTIME_IMAGE_ID=${imageId}`;
  const revisionEntry = `EVO_RELEASE_REVISION=${revision}`;
  const validInput = {
    snapshotText: `${identity}\n`, containerEnvironment: [identity, revisionEntry],
    runtimeImageId: imageId, releaseRevision: revision,
  };
  for (const overrides of [
    { containerEnvironment: [revisionEntry] },
    { containerEnvironment: [identity, identity, revisionEntry] },
    { containerEnvironment: [identity, revisionEntry, revisionEntry] },
    { containerEnvironment: [identity] },
    { containerEnvironment: [`${identity}x`, revisionEntry] },
    { containerEnvironment: [identity, `EVO_RELEASE_REVISION=${"c".repeat(40)}`] },
    { containerEnvironment: [null] },
    { snapshotText: "OTHER=allowed\n" },
    { snapshotText: `${identity}\n${identity}\n` },
    { snapshotText: `EVO_RUNTIME_IMAGE_ID=sha256:${"c".repeat(64)}\n` },
    { runtimeImageId: imageId.toUpperCase() },
    { releaseRevision: "not-a-revision" },
  ]) {
    assert.throws(() => verifyRuntimeEnvironmentIdentity({ ...validInput, ...overrides }));
  }
});

test("historical previous compatibility requires absence in both frozen snapshot and actual container", () => {
  const imageId = `sha256:${"a".repeat(64)}`;
  const revision = "b".repeat(40);
  const legacy = {
    snapshotText: "OTHER=allowed\n", containerEnvironment: [`EVO_RELEASE_REVISION=${revision}`],
    runtimeImageId: imageId, releaseRevision: revision,
  };
  assert.throws(() => verifyRuntimeEnvironmentIdentity(legacy));
  assert.deepEqual(verifyRuntimeEnvironmentIdentity({ ...legacy, historicalPrevious: true }), { ok: true });
  for (const overrides of [
    { snapshotText: `EVO_RUNTIME_IMAGE_ID=${imageId}\n` },
    { containerEnvironment: [...legacy.containerEnvironment, `EVO_RUNTIME_IMAGE_ID=${imageId}`] },
    { containerEnvironment: [] },
    { snapshotText: "EVO_RUNTIME_IMAGE_ID=\n" },
  ]) {
    assert.throws(() => verifyRuntimeEnvironmentIdentity({ ...legacy, historicalPrevious: true, ...overrides }));
  }
});

test("snapshot seal rejects symlinks and destination collisions without overwriting", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-env-snapshot-")));
  const source = join(root, ".env.production");
  const sourceLink = join(root, ".env.link");
  const snapshot = join(root, "candidate-app.env");
  try {
    writeFileSync(source, valid(), { mode: 0o600 });
    chmodSync(source, 0o600);
    symlinkSync(source, sourceLink);
    assert.throws(
      () => sealPrivateEnvironmentSnapshot(sourceLink, snapshot),
      (error) =>
        error instanceof AppEnvironmentContractError &&
        error.code === "snapshot_source_invalid",
    );

    writeFileSync(snapshot, "do-not-overwrite\n", { mode: 0o600 });
    assert.throws(
      () => sealPrivateEnvironmentSnapshot(source, snapshot),
      (error) =>
        error instanceof AppEnvironmentContractError &&
        error.code === "snapshot_seal_failed",
    );
    assert.equal(readFileSync(snapshot, "utf8"), "do-not-overwrite\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot seal deterministically rejects in-place mutation and path replacement", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-env-snapshot-")));
  const source = join(root, ".env.production");
  const replacement = join(root, ".env.replacement");
  const snapshot = join(root, "candidate-app.env");
  try {
    writeFileSync(source, valid(), { mode: 0o600 });
    chmodSync(source, 0o600);
    assert.throws(
      () => sealPrivateEnvironmentSnapshot(source, snapshot, {
        afterSourceRead() {
          writeFileSync(source, `${valid()}# changed\n`, { mode: 0o600 });
        },
      }),
      (error) =>
        error instanceof AppEnvironmentContractError &&
        error.code === "snapshot_source_changed",
    );
    assert.equal(lstatSync(snapshot, { throwIfNoEntry: false }), undefined);

    writeFileSync(source, valid(), { mode: 0o600 });
    writeFileSync(replacement, valid(), { mode: 0o600 });
    chmodSync(source, 0o600);
    chmodSync(replacement, 0o600);
    assert.throws(
      () => sealPrivateEnvironmentSnapshot(source, snapshot, {
        afterSourceRead() {
          renameSync(replacement, source);
        },
      }),
      (error) =>
        error instanceof AppEnvironmentContractError &&
        error.code === "snapshot_source_changed",
    );
    assert.equal(lstatSync(snapshot, { throwIfNoEntry: false }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot implementation opens the protected source descriptor exactly once", () => {
  const implementation = readFileSync("scripts/evo-app-env-contract.mjs", "utf8");
  const seal = implementation.slice(
    implementation.indexOf("export function sealPrivateEnvironmentSnapshot"),
    implementation.indexOf("function parseCli"),
  );
  assert.equal((seal.match(/sourceDescriptor = openSync\(/gu) ?? []).length, 1);
  assert.match(seal, /O_NOFOLLOW/u);
  assert.match(seal, /O_CLOEXEC/u);
  assert.match(seal, /O_EXCL/u);
  assert.match(seal, /fsyncSync\(snapshotDescriptor\)/u);
});

// -------------------------------------------------------------- telephony (T3)
// docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.5: every telephony name is OPTIONAL, so
// a release never fails on missing telephony env; a present value must be
// well-formed and the keys are distinct from every other value.

const TELEPHONY_CRM_TOKEN = "3f1c9a52-7d44-4c0e-9b1a-5e2d8f6a7c10";
const TELEPHONY_NEXT_TOKEN = "c8e0b7f4-1a2d-4f63-8a95-0d7e4b3c6a21";
const TELEPHONY_PBX = {
  EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "synthetic-cabinet-key-0001",
  EVO_PLATFORM_TELEPHONY_PBX_URL: "https://tenant.ats.example.test/crmapi/v1",
  EVO_PLATFORM_TELEPHONY_PBX_HOST: "tenant.ats.example.test",
};

function telephonyHarness() {
  // The shipped example (it carries the telephony names) against a complete,
  // otherwise valid production env that may or may not carry them.
  const shipped = readFileSync("deploy/env.production.example", "utf8");
  const base = {
    EVO_CRM_DOMAIN: "crm.evoadmissions.com",
    EVO_CADDY_NETWORK: "evo_public_web",
    NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_runtime_safe",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: TEST_SECRET_KEY,
    EVO_PLATFORM_ORGANIZATION_ID: TEST_ORGANIZATION_ID,
    EVO_STAFF_ADMIN_LOGIN_EMAIL: "",
    EVO_PLATFORM_WAHA_INGRESS_ENABLED: "0",
    EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "",
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: "",
    EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "0",
    EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "",
    ANTHROPIC_API_KEY: "",
    ZAI_API_KEY: "",
    NEXT_PUBLIC_TRANSCRIPTION_SPLINE_SCENE_URL: "",
    EVO_ENABLE_LOCAL_TRANSCRIPTION: "0",
  };
  const text = (extra = {}) =>
    Object.entries({ ...base, ...extra })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
  const check = (actualText) =>
    validateAppEnvironmentContract({
      exampleText: shipped,
      actualText,
      expectedSupabaseProjectRef: TEST_SUPABASE_PROJECT_REF,
    });
  return { shipped, text, check };
}

test("telephony env: the shipped example documents the names and an env without them still releases", () => {
  const { shipped, text, check } = telephonyHarness();
  for (const name of [
    "EVO_PLATFORM_TELEPHONY_ENABLED",
    "EVO_PLATFORM_TELEPHONY_CRM_TOKEN",
    "EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT",
    "EVO_PLATFORM_TELEPHONY_PBX_TOKEN",
    "EVO_PLATFORM_TELEPHONY_PBX_URL",
    "EVO_PLATFORM_TELEPHONY_PBX_HOST",
  ]) {
    assert.match(shipped, new RegExp(`^${name}=`, "mu"), `${name} is documented`);
  }
  assert.match(shipped, /^EVO_PLATFORM_TELEPHONY_ENABLED=0$/mu);
  const valid = { ok: true, code: "valid" };
  // A production env file from before this slice: no telephony name at all.
  assert.deepEqual(check(text()), valid);
  // Every name present and empty, and the switch explicitly off.
  assert.deepEqual(
    check(
      text({
        EVO_PLATFORM_TELEPHONY_ENABLED: "0",
        EVO_PLATFORM_TELEPHONY_CRM_TOKEN: "",
        EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: "",
        EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "",
        EVO_PLATFORM_TELEPHONY_PBX_URL: "",
        EVO_PLATFORM_TELEPHONY_PBX_HOST: "",
      }),
    ),
    valid,
  );
  assert.deepEqual(check(text({ EVO_PLATFORM_TELEPHONY_ENABLED: "" })), valid);
  // The unrelated required names are still required.
  assert.throws(
    () => check(text({ EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: undefined })),
    /required_env_name_missing/u,
  );
});

test("telephony env: the switch is '', 0 or 1; 1 needs a well-formed intake key", () => {
  const { text, check } = telephonyHarness();
  const valid = { ok: true, code: "valid" };
  // (The env parser trims the padding of a value, so «1 » is «1».)
  for (const flag of ["true", "yes", "2", "on", "01", "1 0", "TRUE"]) {
    assert.throws(
      () => check(text({ EVO_PLATFORM_TELEPHONY_ENABLED: flag })),
      /unsafe_runtime_flag/u,
      JSON.stringify(flag),
    );
  }
  // A staged key with the switch off is fine.
  assert.deepEqual(
    check(text({ EVO_PLATFORM_TELEPHONY_ENABLED: "0", EVO_PLATFORM_TELEPHONY_CRM_TOKEN: TELEPHONY_CRM_TOKEN })),
    valid,
  );
  assert.deepEqual(
    check(text({ EVO_PLATFORM_TELEPHONY_ENABLED: "1", EVO_PLATFORM_TELEPHONY_CRM_TOKEN: TELEPHONY_CRM_TOKEN })),
    valid,
  );
  for (const absent of [undefined, ""]) {
    assert.throws(
      () => check(text({ EVO_PLATFORM_TELEPHONY_ENABLED: "1", EVO_PLATFORM_TELEPHONY_CRM_TOKEN: absent })),
      /enabled_feature_configuration_missing/u,
      "1 without a key",
    );
  }
  // NEXT alone is not a key.
  assert.throws(
    () => check(text({ EVO_PLATFORM_TELEPHONY_ENABLED: "1", EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: TELEPHONY_NEXT_TOKEN })),
    /optional_feature_configuration_invalid/u,
  );
});

test("telephony env: the intake key is 32-64 characters of [A-Za-z0-9-], and NEXT only joins it for a rotation", () => {
  const { text, check } = telephonyHarness();
  const valid = { ok: true, code: "valid" };
  assert.deepEqual(check(text({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: "a".repeat(32) })), valid);
  assert.deepEqual(check(text({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: "a".repeat(64) })), valid);
  for (const bad of ["a".repeat(31), "a".repeat(65), `${TELEPHONY_CRM_TOKEN} x`, `${TELEPHONY_CRM_TOKEN.slice(0, 35)}_`, `${TELEPHONY_CRM_TOKEN.slice(0, 35)}.`, `${TELEPHONY_CRM_TOKEN.slice(0, 35)}я`]) {
    assert.throws(
      () => check(text({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: bad })),
      /optional_feature_configuration_invalid/u,
      bad,
    );
  }
  // A placeholder is refused like for every other value.
  assert.throws(
    () => check(text({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: "replace-with-the-real-intake-key-0000" })),
    /placeholder_env_value_rejected/u,
  );
  // Rotation: both keys.
  assert.deepEqual(
    check(text({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: TELEPHONY_CRM_TOKEN, EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: TELEPHONY_NEXT_TOKEN })),
    valid,
  );
  for (const next of [TELEPHONY_CRM_TOKEN, "short", `${TELEPHONY_NEXT_TOKEN} x`]) {
    assert.throws(
      () => check(text({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: TELEPHONY_CRM_TOKEN, EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: next })),
      /optional_feature_configuration_invalid/u,
      next,
    );
  }
});

test("telephony env: the outbound group is all or nothing and each member is well-formed", () => {
  const { text, check } = telephonyHarness();
  const valid = { ok: true, code: "valid" };
  assert.deepEqual(check(text(TELEPHONY_PBX)), valid);
  for (const name of Object.keys(TELEPHONY_PBX)) {
    for (const absent of [undefined, ""]) {
      assert.throws(
        () => check(text({ ...TELEPHONY_PBX, [name]: absent })),
        /optional_feature_configuration_invalid/u,
        `${name} ${JSON.stringify(absent)}`,
      );
      assert.throws(
        () => check(text({ [name]: TELEPHONY_PBX[name] })),
        /optional_feature_configuration_invalid/u,
        `only ${name}`,
      );
    }
  }
  const withUrl = (url) => text({ ...TELEPHONY_PBX, EVO_PLATFORM_TELEPHONY_PBX_URL: url });
  for (const url of [
    "https://tenant.ats.example.test/crmapi/v1/",
    "http://tenant.ats.example.test/crmapi/v1",
    "https://user:pw@tenant.ats.example.test/crmapi/v1",
    "https://tenant.ats.example.test/crmapi/v1?x=1",
    "https://tenant.ats.example.test/crmapi/v1#f",
    "https://Tenant.ats.example.test/crmapi/v1",
    "https://tenant.ats.example.test",
    "https://tenant.ats.example.test:443/crmapi/v1",
    "tenant.ats.example.test/crmapi/v1",
    "not a url",
  ]) {
    assert.throws(() => check(withUrl(url)), /optional_feature_configuration_invalid/u, url);
  }
  assert.deepEqual(check(withUrl("https://tenant.ats.example.test:8443/crmapi/v1")), valid);
  const withHost = (host) => text({ ...TELEPHONY_PBX, EVO_PLATFORM_TELEPHONY_PBX_HOST: host });
  for (const host of ["Tenant.ats.example.test", "tenant", "tenant_x.example.test", "tenant.ats.example.test/", "tenant.ats.example.test:443", "-tenant.example.test", "tenant..example.test", "tenant example.test"]) {
    assert.throws(() => check(withHost(host)), /optional_feature_configuration_invalid/u, host);
  }
  for (const token of ["short", "synthetic cabinet key 01", "x".repeat(257)]) {
    assert.throws(
      () => check(text({ ...TELEPHONY_PBX, EVO_PLATFORM_TELEPHONY_PBX_TOKEN: token })),
      /optional_feature_configuration_invalid/u,
      token,
    );
  }
});

test("telephony env: each key is its own value, distinct from every other secret in the file", () => {
  const { text, check } = telephonyHarness();
  const secret = TELEPHONY_CRM_TOKEN;
  for (const other of [
    { EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: secret },
    { EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: secret },
    { EVO_AI_AGENT_INTERNAL_SECRET: secret },
    { EVO_AI_AGENT_STORAGE_SECRET: secret },
    { ANTHROPIC_API_KEY: secret },
    { EVO_PLATFORM_TELEPHONY_PBX_TOKEN: secret, EVO_PLATFORM_TELEPHONY_PBX_URL: TELEPHONY_PBX.EVO_PLATFORM_TELEPHONY_PBX_URL, EVO_PLATFORM_TELEPHONY_PBX_HOST: TELEPHONY_PBX.EVO_PLATFORM_TELEPHONY_PBX_HOST },
  ]) {
    assert.throws(
      () => check(text({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: secret, ...other })),
      /optional_feature_configuration_invalid/u,
      Object.keys(other)[0],
    );
  }
  // The outbound key is held to the same rule.
  assert.throws(
    () => check(text({ ...TELEPHONY_PBX, EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "w".repeat(32), EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "w".repeat(32) })),
    /optional_feature_configuration_invalid/u,
  );
  // The NEXT key too.
  assert.throws(
    () => check(text({ EVO_PLATFORM_TELEPHONY_CRM_TOKEN: secret, EVO_PLATFORM_TELEPHONY_CRM_TOKEN_NEXT: TELEPHONY_NEXT_TOKEN, ANTHROPIC_API_KEY: TELEPHONY_NEXT_TOKEN })),
    /optional_feature_configuration_invalid/u,
  );
});
