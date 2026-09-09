import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || new URL(baseURL).hostname !== "127.0.0.1") {
  throw new Error("E5 requires its isolated 127.0.0.1 origin");
}
const outputRoot = process.env.EVO_ADMISSIONS_SCREENSHOT_DIR;
if (!outputRoot) throw new Error("E5 private evidence directory required");

export default defineConfig({
  testDir: ".", testMatch: "admissions.spec.ts", timeout: 180_000,
  expect: { timeout: 20_000 }, fullyParallel: false, workers: 1,
  reporter: "list", outputDir: resolve(outputRoot, "../test-results"),
  use: { baseURL, locale: "ru-RU", actionTimeout: 20_000, navigationTimeout: 30_000, trace: "off", video: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 1000 } } },
    { name: "mobile-393-chromium", use: { ...devices["Pixel 5"], viewport: { width: 393, height: 852 } } },
  ],
});
