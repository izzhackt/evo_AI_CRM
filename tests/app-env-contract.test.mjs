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
  sealPrivateEnvironmentSnapshot,
  validateAppEnvironmentContract,
  verifySupabaseProjectCredentials,
} from "../scripts/evo-app-env-contract.mjs";

const TEST_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
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
