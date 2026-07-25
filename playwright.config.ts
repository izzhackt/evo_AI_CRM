import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3310);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const outputRoot = path.join(process.cwd(), "output", "playwright");
const runtimeDir = path.join(outputRoot, "runtime");
const e2eDb = process.env.EVO_PLAYWRIGHT_DB_PATH ?? path.join(runtimeDir, "edu-admin-e2e.db");
const startsOwnServer = !process.env.PLAYWRIGHT_BASE_URL;

if (startsOwnServer) {
  process.env.EVO_PLAYWRIGHT_DB_PATH = e2eDb;
  fs.mkdirSync(runtimeDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${e2eDb}${suffix}`, { force: true });
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/playwright/report", open: "never" }],
  ],
  outputDir: "output/playwright/test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: startsOwnServer
    ? {
        command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: false,
        env: {
          ...process.env,
          AUTH_SECRET: "playwright-e2e-secret",
          EVO_DB_PATH: e2eDb,
          PATH: `/Users/iskhak.tazhibaev/.hermes/node/bin:${process.env.PATH ?? ""}`,
        },
      }
    : undefined,
});
