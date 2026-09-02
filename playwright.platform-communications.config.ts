import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL is required for Platform communications browser tests",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "platform-communications.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "output/playwright-platform-communications/report",
        open: "never",
      },
    ],
  ],
  outputDir: "output/playwright-platform-communications/test-results",
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
