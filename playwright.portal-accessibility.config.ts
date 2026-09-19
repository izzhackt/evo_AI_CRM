import { defineConfig, devices } from "@playwright/test";

/**
 * Портальный a11y-гейт (PORT-6a) — компактный статический axe-прогон.
 *
 * В отличие от playwright.accessibility.config.ts (staff V3, живой runtime и
 * PLAYWRIGHT_BASE_URL), этот конфиг не требует сервера вовсе: спека рендерит
 * реальные портальные компоненты в статический HTML (react-dom/server) с
 * настоящим src/app/(portal)/portal.css и гоняет axe-core через
 * page.setContent(). Это дополнение к живому E5-гейту, не замена: живой
 * рендер с данными Supabase здесь сознательно не проверяется.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "portal-accessibility.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "output/playwright-portal-accessibility/report", open: "never" },
    ],
  ],
  outputDir: "output/playwright-portal-accessibility/test-results",
  use: {
    locale: "ru-RU",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
