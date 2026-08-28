import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL is required for private document browser tests",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "private-document-storage.spec.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "output/playwright-private-documents/report", open: "never" },
    ],
  ],
  outputDir: "output/playwright-private-documents/test-results",
  use: {
    baseURL,
    locale: "ru-RU",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
