import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
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
  validateControlledStagingAppEnvironment,
} from "../scripts/evo-app-env-contract.mjs";

const STAGING_PROJECT_REF = "stageabcdefghijklmno";
const PRODUCTION_PROJECT_REF = "iosckaqtovbbnssqcpde";
const STAGING_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STAGING_PUBLISHABLE_KEY = "sb_publishable_staging_runtime_safe";
const STAGING_SECRET_KEY = "sb_secret_ssssssssssssssssssssssss";
const STAGING_PUBLISHABLE_KEY_SHA256 =
  "a60af6352f3db89b0417d63be712be8f25446094d92ad4e0800c039bad43912a";
const STAGING_SECRET_KEY_SHA256 =
  "35dfc49fa06de41c9b335c236455ece5fa7c48e674dfd5edf079000de7b144bf";
const PRODUCTION_PUBLISHABLE_KEY_SHA256 =
  "12c6ee77b503075e3c585d15ce3a9e5f58c4ae043d041edd781aff9a0fb186ec";
const PRODUCTION_SECRET_KEY_SHA256 =
  "c41f89ee15ffcb680cc9280437549d3cea84c18a6abdfd7d934ebb9bc6735004";

const example = `
EVO_CRM_DOMAIN=crm.evoadmissions.com
EVO_CADDY_NETWORK=evo_public_web
NEXT_PUBLIC_SUPABASE_URL=https://replace-with-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=replace-with-publishable-key
EVO_UI_CONTRACT_FIXTURES=0
EVO_PLATFORM_WAHA_INGRESS_ENABLED=0
EVO_PLATFORM_ORGANIZATION_ID=
EVO_PLATFORM_SUPABASE_SECRET_KEY=
EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET=
EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0
EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=
AUTH_SECRET=replace-with-auth-secret
EVO_SECRET_ENCRYPTION_KEY=replace-with-encryption-key
EVO_DB_PATH=/app/data/edu-admin.db
EVO_BACKUP_DIR=/app/backups
EVO_ALLOW_DEMO_SEED=0
ANTHROPIC_API_KEY=
`;

function valid(overrides = {}) {
  const values = {
    EVO_CRM_DOMAIN: "crm.evoadmissions.com",
    EVO_CADDY_NETWORK: "evo_public_web",
    NEXT_PUBLIC_SUPABASE_URL: "https://staging.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_runtime_safe",
    EVO_UI_CONTRACT_FIXTURES: "0",
    EVO_PLATFORM_WAHA_INGRESS_ENABLED: "0",
    EVO_PLATFORM_ORGANIZATION_ID: "",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "",
    EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "",
    EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "0",
    EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "",
    AUTH_SECRET: "a".repeat(48),
    EVO_SECRET_ENCRYPTION_KEY: "b".repeat(43),
    EVO_DB_PATH: "/app/data/edu-admin.db",
    EVO_BACKUP_DIR: "/app/backups",
    EVO_ALLOW_DEMO_SEED: "0",
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
    () => validateAppEnvironmentContract({ exampleText: example, actualText: actual }),
    (error) => error instanceof AppEnvironmentContractError && error.code === code,
  );
}

function controlledStaging(actualText) {
  return validateControlledStagingAppEnvironment({
    exampleText: example,
    actualText,
    stagingProjectRef: STAGING_PROJECT_REF,
    productionProjectRef: PRODUCTION_PROJECT_REF,
    stagingOrganizationId: STAGING_ORGANIZATION_ID,
    stagingPublishableKeySha256: STAGING_PUBLISHABLE_KEY_SHA256,
    stagingSecretKeySha256: STAGING_SECRET_KEY_SHA256,
    productionPublishableKeySha256: PRODUCTION_PUBLISHABLE_KEY_SHA256,
    productionSecretKeySha256: PRODUCTION_SECRET_KEY_SHA256,
    stagingHostname: "staging.crm.evoadmissions.com",
  });
}

test("accepts required runtime values while allowing disabled optional integrations to stay empty", () => {
  assert.deepEqual(
    validateAppEnvironmentContract({ exampleText: example, actualText: valid() }),
    { ok: true, code: "valid" },
  );
});

test("the committed staging template is intentionally non-deployable until secrets are injected", () => {
  const template = readFileSync("deploy/env.staging.example", "utf8");
  expectInvalid(template, "placeholder_env_value_rejected");
});

test("controlled staging binds the concrete Compose app environment to the approved non-production Supabase identity", () => {
  const actual = valid({
    EVO_CRM_DOMAIN: "staging.crm.evoadmissions.com",
    NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: STAGING_PUBLISHABLE_KEY,
    EVO_PLATFORM_ORGANIZATION_ID: STAGING_ORGANIZATION_ID,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: STAGING_SECRET_KEY,
    EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
    EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "o".repeat(32),
  });

  assert.deepEqual(controlledStaging(actual), {
    ok: true,
    code: "controlled_staging_env_valid",
  });

  for (const [overrides, code] of [
    [
      { NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` },
      "staging_supabase_url_collision",
    ],
    [
      { EVO_PLATFORM_SUPABASE_SECRET_KEY: `sb_secret_${"x".repeat(24)}` },
      "staging_supabase_secret_key_mismatch",
    ],
    [
      { EVO_PLATFORM_ORGANIZATION_ID: "22222222-2222-4222-8222-222222222222" },
      "staging_organization_identity_mismatch",
    ],
  ]) {
    assert.throws(
      () => controlledStaging(valid({
        EVO_CRM_DOMAIN: "staging.crm.evoadmissions.com",
        NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: STAGING_PUBLISHABLE_KEY,
        EVO_PLATFORM_ORGANIZATION_ID: STAGING_ORGANIZATION_ID,
        EVO_PLATFORM_SUPABASE_SECRET_KEY: STAGING_SECRET_KEY,
        EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "o".repeat(32),
        ...overrides,
      })),
      (error) => error instanceof AppEnvironmentContractError && error.code === code,
      code,
    );
  }
});

test("rejects missing names, duplicate names, empty critical values, and known placeholders", () => {
  expectInvalid(valid().replace(/^EVO_CRM_DOMAIN=.*\n/mu, ""), "required_env_name_missing");
  expectInvalid(`${valid()}AUTH_SECRET=${"c".repeat(48)}\n`, "duplicate_env_name");
  expectInvalid(valid({ AUTH_SECRET: "" }), "required_env_value_missing");
  expectInvalid(
    valid({ AUTH_SECRET: "replace-with-a-real-secret" }),
    "placeholder_env_value_rejected",
  );
  expectInvalid(
    valid({ ANTHROPIC_API_KEY: "change-me-before-release" }),
    "placeholder_env_value_rejected",
  );
});

test("rejects unsafe production flags and malformed public Supabase configuration", () => {
  expectInvalid(valid({ EVO_UI_CONTRACT_FIXTURES: "1" }), "unsafe_runtime_flag");
  expectInvalid(valid({ EVO_ALLOW_DEMO_SEED: "1" }), "unsafe_runtime_flag");
  expectInvalid(
    valid({ NEXT_PUBLIC_SUPABASE_URL: "http://staging.supabase.co" }),
    "public_supabase_url_invalid",
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
    EVO_PLATFORM_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: `sb_secret_${"s".repeat(16)}`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${"a".repeat(20)}.supabase.co`,
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
    }),
    { ok: true, code: "valid" },
  );

  for (const unsafeServerKey of [
    "server-only-key-material",
    "sb_publishable_wrong-boundary",
    jwt("anon"),
  ]) {
    expectInvalid(
      valid({
        ...platform,
        EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "o".repeat(32),
        EVO_PLATFORM_SUPABASE_SECRET_KEY: unsafeServerKey,
      }),
      "enabled_feature_configuration_missing",
    );
  }

  assert.deepEqual(
    validateAppEnvironmentContract({
      exampleText: example,
      actualText: valid({
        ...platform,
        EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
        EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "o".repeat(32),
        EVO_PLATFORM_SUPABASE_SECRET_KEY: jwt("service_role"),
      }),
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
      ["scripts/evo-app-env-contract.mjs", "--example", examplePath, "--env", actualPath],
      { encoding: "utf8" },
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, '{"ok":true,"code":"valid"}\n');
    assert.equal(accepted.stderr, "");

    writeFileSync(
      actualPath,
      valid({ AUTH_SECRET: "never-print-this-value-change-me" }),
      { mode: 0o600 },
    );
    const rejected = spawnSync(
      process.execPath,
      ["scripts/evo-app-env-contract.mjs", "--example", examplePath, "--env", actualPath],
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

test("controlled staging CLI validates the private Compose env without printing identities or keys", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-staging-env-contract-")));
  const examplePath = join(root, "env.example");
  const actualPath = join(root, ".env.staging");
  const identityEnvironment = {
    ...process.env,
    EVO_RELEASE_SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
    EVO_PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_PROJECT_REF,
    EVO_RELEASE_PLATFORM_ORGANIZATION_ID: STAGING_ORGANIZATION_ID,
    EVO_RELEASE_SUPABASE_PUBLISHABLE_KEY_SHA256: STAGING_PUBLISHABLE_KEY_SHA256,
    EVO_RELEASE_SUPABASE_SECRET_KEY_SHA256: STAGING_SECRET_KEY_SHA256,
    EVO_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SHA256: PRODUCTION_PUBLISHABLE_KEY_SHA256,
    EVO_PRODUCTION_SUPABASE_SECRET_KEY_SHA256: PRODUCTION_SECRET_KEY_SHA256,
    EVO_RELEASE_PUBLIC_HOSTNAME: "staging.crm.evoadmissions.com",
  };
  const actual = (supabaseUrl) => valid({
    EVO_CRM_DOMAIN: "staging.crm.evoadmissions.com",
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: STAGING_PUBLISHABLE_KEY,
    EVO_PLATFORM_ORGANIZATION_ID: STAGING_ORGANIZATION_ID,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: STAGING_SECRET_KEY,
    EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
    EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "o".repeat(32),
  });
  try {
    writeFileSync(examplePath, example, { mode: 0o600 });
    writeFileSync(
      actualPath,
      actual(`https://${STAGING_PROJECT_REF}.supabase.co`),
      { mode: 0o600 },
    );
    chmodSync(examplePath, 0o600);
    chmodSync(actualPath, 0o600);

    const accepted = spawnSync(
      process.execPath,
      [
        "scripts/evo-app-env-contract.mjs",
        "--controlled-staging",
        "--example",
        examplePath,
        "--env",
        actualPath,
      ],
      { encoding: "utf8", env: identityEnvironment },
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, '{"ok":true,"code":"controlled_staging_env_valid"}\n');
    assert.equal(accepted.stdout.includes(STAGING_ORGANIZATION_ID), false);
    assert.equal(accepted.stdout.includes(STAGING_SECRET_KEY), false);
    assert.equal(accepted.stderr, "");

    writeFileSync(
      actualPath,
      actual(`https://${PRODUCTION_PROJECT_REF}.supabase.co`),
      { mode: 0o600 },
    );
    const rejected = spawnSync(
      process.execPath,
      [
        "scripts/evo-app-env-contract.mjs",
        "--controlled-staging",
        "--example",
        examplePath,
        "--env",
        actualPath,
      ],
      { encoding: "utf8", env: identityEnvironment },
    );
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, "");
    assert.equal(rejected.stderr, '{"ok":false,"code":"app_env_contract_invalid"}\n');
    assert.equal(rejected.stderr.includes(STAGING_SECRET_KEY), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
