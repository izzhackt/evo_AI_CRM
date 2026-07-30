import { defineConfig, devices } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

type Identity = Readonly<{ email: string; password: string }>;
type Fixture = Readonly<{
  apiUrl: string;
  publishableKey: string;
  identities: Readonly<Record<string, Identity>>;
}>;

const fixturePath = process.env.EVO_PLATFORM_AUTH_FIXTURE_PATH;
if (!fixturePath || !path.isAbsolute(fixturePath)) {
  throw new Error("EVO_PLATFORM_AUTH_FIXTURE_PATH must be an absolute path");
}
if ((statSync(fixturePath).mode & 0o777) !== 0o600) {
  throw new Error("Platform Auth fixture must use mode 0600");
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
if (
  !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(fixture.apiUrl) ||
  !fixture.publishableKey.startsWith("sb_publishable_")
) {
  throw new Error("Platform Auth fixture must target disposable local Supabase");
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
      NEXT_PUBLIC_SUPABASE_URL: fixture.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fixture.publishableKey,
      EVO_UI_CONTRACT_FIXTURES: "0",
      EVO_DB_PATH: legacySentinel,
    },
  },
});
