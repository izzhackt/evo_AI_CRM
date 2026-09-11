import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL is required for the local Student Portal browser gate",
  );
}

const outputRoot = resolve(process.cwd(), "output/playwright-student-portal");

export default defineConfig({
  testDir: ".",
  testMatch: ["student-portal.spec.ts", "student-assessments.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: resolve(outputRoot, "report"), open: "never" }],
  ],
  outputDir: resolve(outputRoot, "test-results"),
  use: {
    baseURL,
    locale: "ru-RU",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-320-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 320, height: 740 },
      },
    },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1360, height: 1000 },
      },
    },
    {
      name: "mobile-393-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 393, height: 852 },
      },
    },
    {
      name: "forced-dark-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1360, height: 1000 },
        colorScheme: "dark",
      },
    },
  ],
});
