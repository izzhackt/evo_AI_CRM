import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AppEnvironmentContractError,
  validateAppEnvironmentContract,
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
