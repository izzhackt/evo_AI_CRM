import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL is required for the V2 accessibility gate. It runs against the real local PostgreSQL runtime and never starts a fixture server.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "platform-accessibility.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "output/playwright-accessibility/report", open: "never" },
    ],
  ],
  outputDir: "output/playwright-accessibility/test-results",
  use: {
    baseURL,
    locale: "ru-RU",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
    // Both themes. Every assertion here used to run in Playwright's default
    // light scheme, so a dark-only regression could not fail the gate.
    {
      name: "desktop-chromium-dark",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
  ],
});
