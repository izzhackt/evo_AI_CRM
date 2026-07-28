import { expect, test as base, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { scryptSync } from "node:crypto";
import path from "node:path";

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
  await expect(
    page.getByRole("link", { name: /(?:Назад|Вернуться) в очередь/ }),
  ).toBeVisible();
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

test("visa module stays available to curators while other roles remain denied", async ({
  page,
  runtimeErrors,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "role matrix is covered once");
  await login(page, "curator@demo.kg", "curator123", /\/clients$/);
  await page.goto("/visa");
  await expect(page).toHaveURL(/\/visa$/);
  await expect(page.locator('a[href^="/visa/"]:visible').first()).toBeVisible();

  await page.context().clearCookies();
  await login(page, "sales@demo.kg", "sales123", /\/sales$/);
  await page.goto("/visa");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fvisa$/);

  await page.context().clearCookies();
  await login(page, "finance@demo.kg", "finance123", /\/finance$/);
  await page.goto("/visa");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fvisa$/);

  await page.context().clearCookies();
  await login(page, "client@demo.kg", "client123", /\/portal$/);
  await page.goto("/visa");
  await expect(page).toHaveURL(/\/portal$/);
  await page.goto("/portal/visa");
  await expect(page).toHaveURL(/\/portal\/visa$/);

  await page.context().clearCookies();
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/settings?tab=roles");
  await expect(page.locator("table thead th")).toHaveText([
    "Раздел",
    "Руководство",
    "Продажи",
    "Куратор",
    "Финансы",
  ]);
  await expect(page.locator("main")).not.toContainText("Визовый отдел");

  await page.goto("/finance");
  await expect(page).toHaveURL(/\/finance$/);
  await expectNoPageOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("runtime database rejects the deprecated visa role", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "database policy is covered once");
  const databasePath =
    process.env.EVO_PLAYWRIGHT_DB_PATH
    ?? path.join(process.cwd(), "output", "playwright", "runtime", "edu-admin-e2e.db");
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    expect(() =>
      database
        .prepare("UPDATE users SET role = 'visa' WHERE lower(email) = 'curator@demo.kg'")
        .run(),
    ).toThrow(/unsupported user role/);
    expect(
      database
        .prepare("SELECT role FROM users WHERE lower(email) = 'curator@demo.kg'")
        .pluck()
        .get(),
    ).toBe("curator");
    expect(
      database.prepare("SELECT COUNT(*) FROM users WHERE role = 'visa'").pluck().get(),
    ).toBe(0);
  } finally {
    database.close();
  }
});

test("legacy visa account fails closed until the explicit migration runs", async ({
  page,
  runtimeErrors,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "legacy auth is covered once");
  const databasePath =
    process.env.EVO_PLAYWRIGHT_DB_PATH
    ?? path.join(process.cwd(), "output", "playwright", "runtime", "edu-admin-e2e.db");
  const database = new Database(databasePath, { fileMustExist: true });
  const email = "legacy-visa@example.test";
  const password = "legacy123";
  const salt = "0123456789abcdef0123456789abcdef";
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  try {
    database.exec("DROP TRIGGER IF EXISTS users_role_insert_guard");
    database.pragma("ignore_check_constraints = ON");
    database
      .prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'visa')")
      .run(email, passwordHash, "Synthetic Legacy Visa");
  } finally {
    database.pragma("ignore_check_constraints = OFF");
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS users_role_insert_guard
      BEFORE INSERT ON users
      WHEN NEW.role NOT IN ('admin', 'sales', 'curator', 'finance', 'client')
      BEGIN
        SELECT RAISE(ABORT, 'unsupported user role');
      END;
    `);
    database.close();
  }

  try {
    await page.goto("/login");
    await page.getByLabel("Эл. почта").fill(email);
    await page.getByLabel("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("#login-error")).toContainText("Роль этого аккаунта устарела");
    expect(runtimeErrors).toEqual([]);
  } finally {
    const cleanup = new Database(databasePath, { fileMustExist: true });
    try {
      cleanup.prepare("DELETE FROM users WHERE lower(email) = ?").run(email);
    } finally {
      cleanup.close();
    }
  }
});

test("a replayed Sales session cannot forge a Curator visa mutation", async ({
  page,
  runtimeErrors,
}) => {
  const forgedCountry = "FORGED-VISA-COUNTRY";
  await login(page, "curator@demo.kg", "curator123", /\/clients$/);
  await page.goto("/clients/1");

  const visaForm = page.locator('form:has(input[name="appointment_at"])').first();
  await expect(visaForm).toBeVisible();
  await visaForm.locator('input[name="country"]').fill(forgedCountry);
  await visaForm.locator('select[name="status"]').selectOption("approved");

  const attackerPage = await page.context().newPage();
  await page.context().clearCookies();
  await login(attackerPage, "sales@demo.kg", "sales123", /\/sales$/);
  const [forgedResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    visaForm.getByRole("button", { name: "Сохранить" }).click(),
  ]);
  expect(forgedResponse.status()).toBe(303);
  await attackerPage.close();

  await page.context().clearCookies();
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/visa");
  await expect(page.locator("body")).not.toContainText(forgedCountry);
  expect(runtimeErrors).toEqual([]);
});
