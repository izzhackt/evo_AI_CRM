import { defineConfig, devices } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = __dirname;

type Identity = Readonly<{ email: string; password: string }>;
type Fixture = Readonly<{
  apiUrl: string;
  publishableKey: string;
  p5b: Readonly<{
    organizationId: string;
    intakeSalesMembershipId: string;
    supabaseSecretKey: string;
    ingressHmacSecret: string;
    workerTriggerSecret: string;
  }>;
  p5c: Readonly<{
    wahaApiKey: string;
    historyTriggerSecret: string;
  }>;
  p5d: Readonly<{
    organizationId: string;
    intakeSalesMembershipId: string;
    supabaseSecretKey: string;
    ingressHmacSecret: string;
    workerTriggerSecret: string;
    wahaApiKey: string;
    mediaTriggerSecret: string;
  }>;
  identities: Readonly<Record<string, Identity>>;
}>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fixturePath = process.env.EVO_PLATFORM_AUTH_FIXTURE_PATH;
if (!fixturePath || !path.isAbsolute(fixturePath)) {
  throw new Error("EVO_PLATFORM_AUTH_FIXTURE_PATH must be an absolute path");
}
if ((statSync(fixturePath).mode & 0o777) !== 0o600) {
  throw new Error("Platform Auth fixture must use mode 0600");
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const p5bBrowserProofFlag = process.env.EVO_P5B_BROWSER_PROOF;
if (
  p5bBrowserProofFlag !== undefined &&
  p5bBrowserProofFlag !== "0" &&
  p5bBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5B_BROWSER_PROOF must be 0 or 1");
}
const p5bBrowserProof = p5bBrowserProofFlag === "1";
const p5cBrowserProofFlag = process.env.EVO_P5C_BROWSER_PROOF;
if (
  p5cBrowserProofFlag !== undefined &&
  p5cBrowserProofFlag !== "0" &&
  p5cBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5C_BROWSER_PROOF must be 0 or 1");
}
const p5cBrowserProof = p5cBrowserProofFlag === "1";
const p5dBrowserProofFlag = process.env.EVO_P5D_BROWSER_PROOF;
if (
  p5dBrowserProofFlag !== undefined &&
  p5dBrowserProofFlag !== "0" &&
  p5dBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5D_BROWSER_PROOF must be 0 or 1");
}
const p5dBrowserProof = p5dBrowserProofFlag === "1";
const p5eBrowserProofFlag = process.env.EVO_P5E_BROWSER_PROOF;
if (
  p5eBrowserProofFlag !== undefined &&
  p5eBrowserProofFlag !== "0" &&
  p5eBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5E_BROWSER_PROOF must be 0 or 1");
}
const p5eBrowserProof = p5eBrowserProofFlag === "1";
const platformAuthDevRunKey = process.env.EVO_PLATFORM_AUTH_DEV_RUN_KEY;
const platformAuthBrowserPartition =
  process.env.EVO_PLATFORM_AUTH_BROWSER_PARTITION;
const platformAuthTsconfigPath =
  process.env.EVO_PLATFORM_AUTH_TSCONFIG_PATH;
const platformAuthTsconfigAbsolutePath = platformAuthTsconfigPath
  ? path.resolve(projectRoot, platformAuthTsconfigPath)
  : undefined;
if (
  !platformAuthDevRunKey ||
  !/^[A-Za-z0-9_-]{1,96}$/.test(platformAuthDevRunKey)
) {
  throw new Error("EVO_PLATFORM_AUTH_DEV_RUN_KEY is invalid");
}
if (
  !platformAuthBrowserPartition ||
  !["provider", "p5b", "p5c", "p5d", "p5e", "remaining"].includes(
    platformAuthBrowserPartition,
  )
) {
  throw new Error("EVO_PLATFORM_AUTH_BROWSER_PARTITION is invalid");
}
if ((platformAuthBrowserPartition === "p5c") !== p5cBrowserProof) {
  throw new Error(
    "EVO_P5C_BROWSER_PROOF must be enabled only for the p5c browser partition",
  );
}
if (p5bBrowserProof && p5cBrowserProof) {
  throw new Error(
    "P5B and P5C browser proof partitions are mutually exclusive",
  );
}
if (
  Number(p5bBrowserProof) +
    Number(p5cBrowserProof) +
    Number(p5dBrowserProof) +
    Number(p5eBrowserProof) >
  1
) {
  throw new Error(
    "P5B, P5C, P5D and P5E browser proof partitions are mutually exclusive",
  );
}
if (
  (platformAuthBrowserPartition === "p5b") !== p5bBrowserProof
) {
  throw new Error(
    "EVO_P5B_BROWSER_PROOF must be enabled only for the p5b browser partition",
  );
}
if ((platformAuthBrowserPartition === "p5d") !== p5dBrowserProof) {
  throw new Error(
    "EVO_P5D_BROWSER_PROOF must be enabled only for the p5d browser partition",
  );
}
if ((platformAuthBrowserPartition === "p5e") !== p5eBrowserProof) {
  throw new Error(
    "EVO_P5E_BROWSER_PROOF must be enabled only for the p5e browser partition",
  );
}
if (
  !platformAuthTsconfigPath ||
  path.isAbsolute(platformAuthTsconfigPath) ||
  !platformAuthTsconfigAbsolutePath ||
  path.dirname(platformAuthTsconfigAbsolutePath) !==
    path.join(projectRoot, ".next", "platform-auth", platformAuthDevRunKey) ||
  path.basename(platformAuthTsconfigPath) !==
    "tsconfig-platform-auth-" + platformAuthBrowserPartition + ".json" ||
  (statSync(platformAuthTsconfigAbsolutePath).mode & 0o777) !== 0o600
) {
  throw new Error("EVO_PLATFORM_AUTH_TSCONFIG_PATH is invalid");
}
if (
  !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(fixture.apiUrl) ||
  !fixture.publishableKey.startsWith("sb_publishable_")
) {
  throw new Error("Platform Auth fixture must target disposable local Supabase");
}
if (
  p5bBrowserProof &&
  (!uuidPattern.test(fixture.p5b.organizationId) ||
    !uuidPattern.test(fixture.p5b.intakeSalesMembershipId) ||
    fixture.p5b.supabaseSecretKey.length === 0 ||
    fixture.p5b.ingressHmacSecret.length < 32 ||
    fixture.p5b.workerTriggerSecret.length < 32)
) {
  throw new Error("P5B browser proof fixture is invalid");
}
if (
  p5cBrowserProof &&
  (!uuidPattern.test(fixture.p5b.organizationId) ||
    !uuidPattern.test(fixture.p5b.intakeSalesMembershipId) ||
    fixture.p5b.supabaseSecretKey.length === 0 ||
    fixture.p5c.wahaApiKey.length < 32 ||
    fixture.p5c.historyTriggerSecret.length < 32)
) {
  throw new Error("P5C browser proof fixture is invalid");
}
if (
  p5dBrowserProof &&
  (!uuidPattern.test(fixture.p5d.organizationId) ||
    !uuidPattern.test(fixture.p5d.intakeSalesMembershipId) ||
    fixture.p5d.supabaseSecretKey.length === 0 ||
    fixture.p5d.ingressHmacSecret.length < 32 ||
    fixture.p5d.workerTriggerSecret.length < 32 ||
    fixture.p5d.wahaApiKey.length < 32 ||
    fixture.p5d.mediaTriggerSecret.length < 32)
) {
  throw new Error("P5D browser proof fixture is invalid");
}
if (
  p5eBrowserProof &&
  (!uuidPattern.test(fixture.p5b.organizationId) ||
    !uuidPattern.test(fixture.p5b.intakeSalesMembershipId) ||
    fixture.p5b.supabaseSecretKey.length === 0 ||
    fixture.p5b.ingressHmacSecret.length < 32 ||
    fixture.p5b.workerTriggerSecret.length < 32)
) {
  throw new Error("P5E browser proof fixture is invalid");
}

const platformMessagingProof =
  p5bBrowserProof || p5cBrowserProof || p5dBrowserProof || p5eBrowserProof;

const port = 3311;
const baseURL = `http://127.0.0.1:${port}`;
const legacySentinel =
  process.env.EVO_PLATFORM_LEGACY_DB_SENTINEL ??
  path.join(path.dirname(fixturePath), "legacy-must-not-exist.db");

export default defineConfig({
  testDir: "./tests/platform-auth",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "output/playwright/platform-auth",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "platform-auth-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      EVO_PLATFORM_AUTH_DEV_RUN_KEY: platformAuthDevRunKey,
      EVO_PLATFORM_AUTH_BROWSER_PARTITION: platformAuthBrowserPartition,
      EVO_PLATFORM_AUTH_TSCONFIG_PATH: platformAuthTsconfigPath,
      NEXT_PUBLIC_SUPABASE_URL: fixture.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fixture.publishableKey,
      EVO_UI_CONTRACT_FIXTURES: "0",
      EVO_DB_PATH: legacySentinel,
      EVO_PLATFORM_WAHA_INGRESS_ENABLED:
        p5bBrowserProof || p5dBrowserProof || p5eBrowserProof ? "1" : "0",
      EVO_PLATFORM_WAHA_WORKER_ENABLED:
        p5bBrowserProof || p5dBrowserProof || p5eBrowserProof ? "1" : "0",
      EVO_PLATFORM_ORGANIZATION_ID: platformMessagingProof
        ? p5dBrowserProof
          ? fixture.p5d.organizationId
          : fixture.p5b.organizationId
        : "",
      EVO_PLATFORM_SUPABASE_SECRET_KEY: platformMessagingProof
        ? p5dBrowserProof
          ? fixture.p5d.supabaseSecretKey
          : fixture.p5b.supabaseSecretKey
        : "",
      EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET:
        p5bBrowserProof || p5dBrowserProof || p5eBrowserProof
        ? p5dBrowserProof
          ? fixture.p5d.ingressHmacSecret
          : fixture.p5b.ingressHmacSecret
        : "",
      EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: platformMessagingProof
        ? p5dBrowserProof
          ? fixture.p5d.intakeSalesMembershipId
          : fixture.p5b.intakeSalesMembershipId
        : "",
      EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET:
        p5bBrowserProof || p5dBrowserProof || p5eBrowserProof
        ? p5dBrowserProof
          ? fixture.p5d.workerTriggerSecret
          : fixture.p5b.workerTriggerSecret
        : "",
      EVO_PLATFORM_WAHA_HISTORY_ENABLED: p5cBrowserProof ? "1" : "0",
      EVO_PLATFORM_WAHA_HISTORY_BASE_URL: p5cBrowserProof
        ? "http://127.0.0.1:3312"
        : "",
      EVO_PLATFORM_WAHA_HISTORY_API_KEY: p5cBrowserProof
        ? fixture.p5c.wahaApiKey
        : "",
      EVO_PLATFORM_WAHA_HISTORY_TRIGGER_SECRET: p5cBrowserProof
        ? fixture.p5c.historyTriggerSecret
        : "",
      EVO_PLATFORM_WAHA_MEDIA_ENABLED: p5dBrowserProof ? "1" : "0",
      EVO_PLATFORM_WAHA_MEDIA_BASE_URL: p5dBrowserProof
        ? "http://127.0.0.1:3313"
        : "",
      EVO_PLATFORM_WAHA_MEDIA_API_KEY: p5dBrowserProof
        ? fixture.p5d.wahaApiKey
        : "",
      EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET: p5dBrowserProof
        ? fixture.p5d.mediaTriggerSecret
        : "",
    },
  },
});
