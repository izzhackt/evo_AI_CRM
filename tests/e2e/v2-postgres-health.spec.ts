import { expect, test } from "@playwright/test";

test("api health stays live only when the V2 Postgres foundation is healthy", async ({ page }) => {
  const response = await page.goto("/api/health");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toContainText(
    '{"ok":true,"status":"live","service":"evo-crm"}',
  );
});
