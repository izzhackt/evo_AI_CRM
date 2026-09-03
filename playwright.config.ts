import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();

if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL is required. Start the real configured application through its validation harness; the default Playwright config never starts a fixture server.",
  );
}

let parsedBaseURL: URL;
try {
  parsedBaseURL = new URL(baseURL);
} catch {
  throw new Error("PLAYWRIGHT_BASE_URL must be a valid absolute URL.");
}

if (
  parsedBaseURL.protocol !== "http:" ||
  (parsedBaseURL.hostname !== "127.0.0.1" &&
    parsedBaseURL.hostname !== "localhost") ||
  parsedBaseURL.username ||
  parsedBaseURL.password ||
  parsedBaseURL.pathname !== "/" ||
  parsedBaseURL.search ||
  parsedBaseURL.hash
) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL must be a credential-free loopback HTTP origin.",
  );
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
});
