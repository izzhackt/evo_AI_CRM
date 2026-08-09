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
  !["provider", "p5b", "remaining"].includes(
    platformAuthBrowserPartition,
  )
) {
  throw new Error("EVO_PLATFORM_AUTH_BROWSER_PARTITION is invalid");
}
if (
  (platformAuthBrowserPartition === "p5b") !== p5bBrowserProof
) {
  throw new Error(
    "EVO_P5B_BROWSER_PROOF must be enabled only for the p5b browser partition",
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
      EVO_PLATFORM_WAHA_INGRESS_ENABLED: p5bBrowserProof ? "1" : "0",
      EVO_PLATFORM_WAHA_WORKER_ENABLED: p5bBrowserProof ? "1" : "0",
      EVO_PLATFORM_ORGANIZATION_ID: p5bBrowserProof
        ? fixture.p5b.organizationId
        : "",
      EVO_PLATFORM_SUPABASE_SECRET_KEY: p5bBrowserProof
        ? fixture.p5b.supabaseSecretKey
        : "",
      EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: p5bBrowserProof
        ? fixture.p5b.ingressHmacSecret
        : "",
      EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: p5bBrowserProof
        ? fixture.p5b.intakeSalesMembershipId
        : "",
      EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET: p5bBrowserProof
        ? fixture.p5b.workerTriggerSecret
        : "",
    },
  },
});
