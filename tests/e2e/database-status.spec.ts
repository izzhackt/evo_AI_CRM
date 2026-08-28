import { expect, test } from "@playwright/test";

test("database status route reports the exact requested foundation state", async ({ page }) => {
  const expectedStatus = Number(process.env.EVO_EXPECT_STATUS ?? "200");
  const expectedCode = process.env.EVO_EXPECT_DATABASE_CODE;

  const expectedBody = expectedCode
    ? {
        ok: false,
        status: "blocked",
        database: "postgresql",
        code: expectedCode,
      }
    : {
        ok: true,
        status: "ready",
        database: "postgresql",
        contractVersion: 2,
      };

  if ((expectedStatus === 200) !== !expectedCode) {
    throw new Error("EVO_EXPECT_STATUS and EVO_EXPECT_DATABASE_CODE disagree");
  }

  const response = await page.goto("/api/database/status");
  expect(response?.status()).toBe(expectedStatus);
  const responseBody = await page.locator("body").innerText();
  expect(JSON.parse(responseBody)).toEqual(expectedBody);
});

test("database status lookalike paths stay hidden", async ({ page }) => {
  const response = await page.goto("/api/database/status/extra");
  expect(response?.status()).toBe(404);
  await expect(page.locator("body")).toHaveText("");
});
