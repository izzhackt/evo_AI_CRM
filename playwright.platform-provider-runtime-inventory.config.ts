import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL is required for Platform provider runtime inventory browser tests",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "platform-provider-runtime-inventory.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "output/playwright-platform-provider-runtime-inventory/report",
        open: "never",
      },
    ],
  ],
  outputDir: "output/playwright-platform-provider-runtime-inventory/test-results",
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
