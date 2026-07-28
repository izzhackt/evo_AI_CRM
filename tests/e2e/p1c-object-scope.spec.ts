import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const databasePath =
  process.env.EVO_PLAYWRIGHT_DB_PATH
  ?? path.join(process.cwd(), "output", "playwright", "runtime", "edu-admin-e2e.db");

const OTHER_CURATOR_EMAIL = "p1c.other.curator@example.test";
const OTHER_SALES_EMAIL = "p1c.other.sales@example.test";
const PENDING_APPLICATION = "P1C Pending Scope University";

function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "desktop-chromium", "stateful object-scope coverage runs once");
}

function openDatabase() {
  return new Database(databasePath, { fileMustExist: true });
}

function prepareObjectScopeFixtures() {
  const database = openDatabase();
  try {
    database.prepare("DELETE FROM applications WHERE university = ?").run(PENDING_APPLICATION);
    database.prepare("DELETE FROM users WHERE lower(email) = ?").run(OTHER_CURATOR_EMAIL);
    database.prepare("DELETE FROM users WHERE lower(email) = ?").run(OTHER_SALES_EMAIL);
    database.prepare(`
      INSERT INTO users (email, phone, password_hash, name, role)
      SELECT ?, NULL, password_hash, 'P1C Other Curator', 'curator'
      FROM users
      WHERE lower(email) = 'curator@demo.kg'
    `).run(OTHER_CURATOR_EMAIL);
    database.prepare(`
      INSERT INTO users (email, phone, password_hash, name, role)
      SELECT ?, NULL, password_hash, 'P1C Other Sales', 'sales'
      FROM users
      WHERE lower(email) = 'sales@demo.kg'
    `).run(OTHER_SALES_EMAIL);
    const application = database.prepare(`
      INSERT INTO applications (
        client_id, university, country, program, degree, deadline, status
      ) VALUES (2, ?, 'США', 'Scope Safety', 'Магистратура', '2026-09-30', 'preparing')
    `).run(PENDING_APPLICATION);
    return Number(application.lastInsertRowid);
  } finally {
    database.close();
  }
}

function cleanupObjectScopeFixtures() {
  const database = openDatabase();
  try {
    database.prepare("UPDATE applications SET status = 'submitted' WHERE id = 1").run();
    database.prepare("DELETE FROM applications WHERE university = ?").run(PENDING_APPLICATION);
    database.prepare("DELETE FROM users WHERE lower(email) = ?").run(OTHER_CURATOR_EMAIL);
    database.prepare("DELETE FROM users WHERE lower(email) = ?").run(OTHER_SALES_EMAIL);
  } finally {
    database.close();
  }
}

async function login(
  context: BrowserContext,
  page: Page,
  email: string,
  password: string,
  target: RegExp,
) {
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL(target),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

async function browserFetch(page: Page, url: string, init?: RequestInit) {
  return page.evaluate(
    async ({ requestUrl, requestInit }) => {
      const response = await fetch(requestUrl, requestInit);
      return {
        status: response.status,
        body: await response.text(),
      };
    },
    { requestUrl: url, requestInit: init },
  );
}

test.describe("P1C staff object scope", () => {
  test("Admin has full access while Sales, Curator, and Finance receive only their case projection", async ({
    context,
    page,
  }, testInfo) => {
    desktopOnly(testInfo);
    await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
    prepareObjectScopeFixtures();

    try {
      await page.goto("/clients");
      await expect(page.locator('a[href="/clients/1"]').first()).toBeVisible();
      await expect(page.locator('a[href="/clients/2"]').first()).toBeVisible();
      await page.goto("/clients/1");
      await expect(page.getByTestId("client-full-detail")).toBeVisible();

      await login(context, page, "sales@demo.kg", "sales123", /\/sales$/);
      await page.goto("/clients/1");
      await expect(page.getByTestId("sales-handoff-summary")).toBeVisible();
      await expect(page.getByTestId("client-full-detail")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Сильный английский");
      await expect(page.locator("body")).not.toContainText("Мотивационное письмо");
      await expect(page.locator("body")).not.toContainText("Консалтинговый пакет");

      await page.goto("/clients/2");
      await expect(page.getByTestId("client-full-detail")).toBeVisible();
      await expect(page.getByText("Нужна стипендия, рассматривает Fulbright")).toBeVisible();

      await login(context, page, "curator@demo.kg", "curator123", /\/clients$/);
      await expect(page.locator('a[href="/clients/1"]').first()).toBeVisible();
      await expect(page.locator('a[href="/clients/2"]')).toHaveCount(0);
      const preHandoffResponse = await page.goto("/clients/2");
      expect(preHandoffResponse?.status()).toBe(404);

      await login(context, page, OTHER_CURATOR_EMAIL, "curator123", /\/clients$/);
      await expect(page.locator('a[href="/clients/1"]')).toHaveCount(0);
      const otherCuratorResponse = await page.goto("/clients/1");
      expect(otherCuratorResponse?.status()).toBe(404);

      await login(context, page, "finance@demo.kg", "finance123", /\/finance$/);
      await page.goto("/clients");
      await expect(page).toHaveURL(/\/access-denied\?from=%2Fclients$/);
      await page.goto("/finance");
      await expect(page.locator('a[href="/finance/1"]:visible')).toContainText(
        "Консалтинговый пакет — 1-й взнос",
      );
      await expect(page.locator('a[href="/clients/1"]')).toHaveCount(0);
    } finally {
      cleanupObjectScopeFixtures();
    }
  });

  test("queue and direct-object reads are scoped in SQL to the responsible case owner", async ({
    context,
    page,
  }, testInfo) => {
    desktopOnly(testInfo);
    await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
    const pendingApplicationId = prepareObjectScopeFixtures();

    try {
      await login(context, page, "sales@demo.kg", "sales123", /\/sales$/);
      await page.goto("/applications");
      await expect(page.locator("body")).toContainText(PENDING_APPLICATION);
      await expect(page.locator("body")).not.toContainText("TU München");
      expect((await page.goto("/applications/1"))?.status()).toBe(404);
      await page.goto(`/applications/${pendingApplicationId}`);
      await expect(page.getByRole("heading", { name: PENDING_APPLICATION })).toBeVisible();

      await page.goto("/documents");
      await expect(page.locator("body")).toContainText("Диплом бакалавра");
      await expect(page.locator("body")).not.toContainText("Мотивационное письмо");
      expect((await page.goto("/documents/1"))?.status()).toBe(404);

      await page.goto("/tasks");
      await expect(page.locator("body")).toContainText("Подготовить договор для Айжан");
      await expect(page.locator("body")).not.toContainText("Проверить мотивационное письмо");

      await page.goto("/visa");
      await expect(page).toHaveURL(/\/access-denied\?from=%2Fvisa$/);

      await login(context, page, "curator@demo.kg", "curator123", /\/clients$/);
      await page.goto("/applications");
      await expect(page.locator("body")).toContainText("TU München");
      await expect(page.locator("body")).not.toContainText(PENDING_APPLICATION);
      expect((await page.goto(`/applications/${pendingApplicationId}`))?.status()).toBe(404);

      await page.goto("/documents");
      await expect(page.locator("body")).toContainText("Мотивационное письмо");
      await expect(page.locator("body")).not.toContainText("Диплом бакалавра");
      expect((await page.goto("/documents/5"))?.status()).toBe(404);

      await page.goto("/tasks");
      await expect(page.locator("body")).toContainText("Проверить мотивационное письмо");
      await expect(page.locator("body")).not.toContainText("Подготовить договор для Айжан");

      await page.goto("/visa");
      await expect(page.locator("body")).toContainText("Нурлан Абдыкадыров");

      await login(context, page, OTHER_CURATOR_EMAIL, "curator123", /\/clients$/);
      await page.goto("/documents");
      await expect(page.locator("body")).not.toContainText("Мотивационное письмо");
      expect((await page.goto("/documents/1"))?.status()).toBe(404);
    } finally {
      cleanupObjectScopeFixtures();
    }
  });

  test("AI summary rejects post-handoff and unrelated staff before the provider boundary", async ({
    context,
    page,
  }, testInfo) => {
    desktopOnly(testInfo);
    await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
    prepareObjectScopeFixtures();

    const requestSummary = () => browserFetch(page, "/api/ai/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: 1 }),
    });

    try {
      await login(context, page, "sales@demo.kg", "sales123", /\/sales$/);
      let response = await requestSummary();
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: "not_found" });

      await login(context, page, OTHER_SALES_EMAIL, "sales123", /\/sales$/);
      response = await requestSummary();
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: "not_found" });

      await login(context, page, OTHER_CURATOR_EMAIL, "curator123", /\/clients$/);
      response = await requestSummary();
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: "not_found" });
    } finally {
      cleanupObjectScopeFixtures();
    }
  });

  test("a replayed Server Action cannot mutate a post-handoff case", async ({
    context,
    page,
  }, testInfo) => {
    desktopOnly(testInfo);
    await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
    prepareObjectScopeFixtures();

    try {
      await login(context, page, "curator@demo.kg", "curator123", /\/clients$/);
      await page.goto("/applications/1");
      const statusForm = page.locator("#application-status form");
      await statusForm.locator("select[name='status']").selectOption("offer");

      const attacker = await context.newPage();
      await login(context, attacker, "sales@demo.kg", "sales123", /\/sales$/);
      await Promise.all([
        page.waitForResponse((response) => response.request().method() === "POST"),
        statusForm.getByRole("button", { name: "Сохранить" }).click(),
      ]);
      await attacker.close();

      const verification = openDatabase();
      expect(
        verification
          .prepare("SELECT status FROM applications WHERE id = 1")
          .pluck()
          .get(),
      ).toBe("submitted");
      verification.close();

      await login(context, page, "curator@demo.kg", "curator123", /\/clients$/);
      await page.goto("/applications/1");
      await page.locator("#application-status select[name='status']").selectOption("offer");
      await Promise.all([
        page.waitForResponse((response) => response.request().method() === "POST"),
        page.locator("#application-status").getByRole("button", { name: "Сохранить" }).click(),
      ]);

      const positiveVerification = openDatabase();
      expect(
        positiveVerification
          .prepare("SELECT status FROM applications WHERE id = 1")
          .pluck()
          .get(),
      ).toBe("offer");
      positiveVerification.close();

      await login(context, page, "sales@demo.kg", "sales123", /\/sales$/);
      const taskVerification = openDatabase();
      const personalTask = taskVerification.prepare(`
        SELECT t.id, t.status
        FROM tasks t
        JOIN users u ON u.id = t.assignee_id
        WHERE t.client_id IS NULL
          AND lower(u.email) = 'sales@demo.kg'
        ORDER BY t.id
        LIMIT 1
      `).get() as { id: number; status: string } | undefined;
      taskVerification.close();
      expect(personalTask).toBeTruthy();

      await page.goto("/tasks");
      const taskStatusForm = page.locator(
        `form:has(input[name="id"][value="${personalTask!.id}"]):has(select[name="status"])`,
      ).first();
      await expect(taskStatusForm).toBeVisible();
      await taskStatusForm.locator("select[name='status']").selectOption("review");

      const financeAttacker = await context.newPage();
      await context.clearCookies();
      await login(context, financeAttacker, "finance@demo.kg", "finance123", /\/finance$/);
      const [forgedTaskResponse] = await Promise.all([
        page.waitForResponse((response) => response.request().method() === "POST"),
        taskStatusForm.getByRole("button", { name: "Сохранить" }).click(),
      ]);
      expect(forgedTaskResponse.status()).toBe(404);
      await financeAttacker.close();

      const rejectedTaskVerification = openDatabase();
      expect(
        rejectedTaskVerification
          .prepare("SELECT status FROM tasks WHERE id = ?")
          .pluck()
          .get(personalTask!.id),
      ).toBe(personalTask!.status);
      rejectedTaskVerification.close();
    } finally {
      cleanupObjectScopeFixtures();
    }
  });
});
