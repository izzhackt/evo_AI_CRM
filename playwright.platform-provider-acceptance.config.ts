import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL is required for Platform provider acceptance",
  );
}

const parsedBaseUrl = new URL(baseURL);
if (
  parsedBaseUrl.protocol !== "http:" ||
  (parsedBaseUrl.hostname !== "127.0.0.1" &&
    parsedBaseUrl.hostname !== "localhost") ||
  parsedBaseUrl.username ||
  parsedBaseUrl.password ||
  parsedBaseUrl.pathname !== "/" ||
  parsedBaseUrl.search ||
  parsedBaseUrl.hash
) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL must be a credential-free loopback HTTP origin",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "platform-provider-acceptance.spec.ts",
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["line"]],
  outputDir: "output/playwright-platform-provider-acceptance/test-results",
  use: {
    baseURL,
    locale: "ru-RU",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
