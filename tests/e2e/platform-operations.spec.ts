import { expect, test as base, type Page } from "@playwright/test";

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: async ({ page }, fixtureUse) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await fixtureUse(errors);
    expect(errors).toEqual([]);
  },
});

async function login(
  page: Page,
  email: string,
  password: string,
  target: RegExp,
) {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL(target),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

async function expectNoPageOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      })),
    )
    .toMatchObject({
      viewport: page.viewportSize()?.width,
      document: page.viewportSize()?.width,
    });
}

async function openFirstDetail(page: Page, route: string) {
  const link = page.locator(`a[href^="${route}/"]:visible`).first();
  await expect(link).toBeVisible();
  await link.focus();
  await expect(link).toBeFocused();
  await Promise.all([
    page.waitForURL(new RegExp(`${route}/\\d+$`)),
    link.press("Enter"),
  ]);
  await expect(page.getByRole("link", { name: "Назад в очередь" })).toBeVisible();
  await expectNoPageOverflow(page);
}

test("operations queues and records work on responsive staff surfaces", async ({
  page,
  runtimeErrors,
}) => {
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);

  for (const route of ["/applications", "/documents", "/visa", "/finance"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator(".provider-status:visible", { hasText: "AI: только черновики" })).toBeVisible();
    await expectNoPageOverflow(page);
    await openFirstDetail(page, route);
  }

  expect(runtimeErrors).toEqual([]);
});

test("visa specialist lands in the visa queue and cannot open finance", async ({
  page,
  runtimeErrors,
}) => {
  await login(page, "visa@demo.kg", "visa123", /\/visa$/);
  await expect(page).toHaveURL(/\/visa$/);
  await expect(page.locator('a[href^="/visa/"]:visible').first()).toBeVisible();

  await page.goto("/finance");
  await expect(page).toHaveURL(/\/visa$/);
  await expectNoPageOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("sales cannot forge a visa mutation through Student 360", async ({
  page,
  runtimeErrors,
}) => {
  const forgedCountry = "FORGED-VISA-COUNTRY";
  await login(page, "sales@demo.kg", "sales123", /\/sales$/);
  await page.goto("/clients/1");

  const visaForm = page.locator('form:has(input[name="appointment_at"])').first();
  await expect(visaForm).toBeVisible();
  await visaForm.locator('input[name="country"]').fill(forgedCountry);
  await visaForm.locator('select[name="status"]').selectOption("approved");
  await Promise.all([
    page.waitForURL(/\/sales$/),
    visaForm.getByRole("button", { name: "Сохранить" }).click(),
  ]);

  await page.context().clearCookies();
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/visa");
  await expect(page.locator("body")).not.toContainText(forgedCountry);
  expect(runtimeErrors).toEqual([]);
});
