import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";

const screenshotDir = path.join(process.cwd(), "output", "playwright", "screenshots");

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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function saveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const filePath = path.join(screenshotDir, `${slug(testInfo.project.name)}-${slug(name)}.png`);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: filePath, fullPage: true });
  await testInfo.attach(name, { path: filePath, contentType: "image/png" });
}

async function login(page: Page, email: string, password: string, target: RegExp) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL(target),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

async function openMobileStaffMenu(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) >= 768) return false;
  await page.getByRole("button", { name: "Ещё" }).click();
  await expect(page.getByRole("dialog", { name: "Все разделы" })).toBeVisible();
  return true;
}

test("rejects invalid login without server overlay", async ({ page, runtimeErrors }) => {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill("missing@example.com");
  await page.getByLabel("Пароль").fill("wrong-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.locator("#login-error")).toContainText("Неверная почта или пароль");
  await expect(page.locator("body")).not.toContainText("Runtime Error");
  expect(runtimeErrors).toEqual([]);
});

test("staff can log in, navigate core pages, and create a real lead", async ({ page, runtimeErrors }, testInfo) => {
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await expect(page.locator("#staff-main").getByRole("heading", { name: "Командный центр" })).toBeVisible();
  await expect(page.locator(".provider-status:visible", { hasText: "amoCRM: не настроено" })).toBeVisible();
  await expect(page.locator(".provider-status:visible", { hasText: "WhatsApp: не настроено" })).toBeVisible();
  await expect(page.locator(".provider-status:visible", { hasText: "AI: только черновики" })).toBeVisible();
  const mobileMenuOpen = await openMobileStaffMenu(page);
  await expect(page.getByRole("link", { name: "Поступление" })).toBeVisible();
  if (mobileMenuOpen) {
    await page.getByRole("button", { name: "Закрыть меню" }).click();
  }
  await saveScreenshot(page, testInfo, "dashboard");
  await page.locator('a[href="/sales?risk=no_task"]').first().click();
  await expect(page).toHaveURL(/\/sales\?risk=no_task$/);
  await expect(page.locator('select[name="risk"]')).toHaveValue("no_task");
  await saveScreenshot(page, testInfo, "sales-filtered-no-task");
  await page.goto("/dashboard");
  await page.locator('a[href="/sales?status=processing_mp"]').click();
  await expect(page).toHaveURL(/\/sales\?status=processing_mp$/);
  await expect(page.locator('select[name="status"]')).toHaveValue("processing_mp");

  const pages = [
    ["/sales", "Воронка поступления"],
    ["/clients", "Student 360"],
    ["/applications", "Очередь заявок"],
    ["/documents", "Очередь документов"],
    ["/finance", "Финансовый обзор"],
    ["/reports", "Отчётность продаж"],
    ["/settings", "Настройки"],
    ["/whatsapp", /WhatsApp ·/],
  ] as const;

  for (const [route, heading] of pages) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, level: 1 }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Runtime Error");
    if (route === "/settings") {
      await expect(page.locator('input[name="wa_token"]')).toHaveValue("");
      await expect(page.locator('input[name="tel_api_key"]')).toHaveValue("");
      await expect(page.locator('input[name="anthropic_api_key"]')).toHaveValue("");
      await saveScreenshot(page, testInfo, "settings-masked-secrets");
    }
  }

  await page.goto("/sales");
  await expect(page.locator("section header").filter({ hasText: "В обработке МП" })).toBeVisible();
  await expect(page.locator("section header").filter({ hasText: "Лид квалифицирован" })).toBeVisible();
  await expect(page.locator("div").filter({ hasText: /^Сделки без задач$/ }).first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Темирлан Касымов" })).toContainText("Звонки: 1");
  await expect(page.locator("article").filter({ hasText: "Темирлан Касымов" })).toContainText("Сообщения: 1");
  await expect(page.locator("article").filter({ hasText: "Темирлан Касымов" })).toContainText("Непрочитано: 1");
  await expect(page.getByText("Синхронизация не проверена").first()).toBeVisible();
  const salesView = page.getByRole("navigation", { name: "Вид воронки продаж" });
  await salesView.getByRole("link", { name: "Список" }).click();
  await expect(page).toHaveURL(/\/sales\?view=list$/);
  await expect(page.getByRole("table", { name: "Лиды по этапам продаж" })).toBeVisible();
  await page.getByRole("navigation", { name: "Вид воронки продаж" }).getByRole("link", { name: "Канбан" }).click();
  await expect(page).toHaveURL(/\/sales\?view=board$/);
  await saveScreenshot(page, testInfo, "sales-cockpit-board");
  const leadName = `PW Lead ${Date.now()}`;
  const addLeadForm = page.locator("form").filter({ has: page.locator("input[name='amount']") });
  await addLeadForm.locator("input[name='name']").fill(leadName);
  await addLeadForm.locator("input[name='phone']").fill("+996700123456");
  await addLeadForm.locator("input[name='email']").fill(`${slug(leadName)}@example.com`);
  await addLeadForm.locator("input[name='source']").fill("Playwright");
  await addLeadForm.locator("input[name='target_country']").fill("Canada");
  await addLeadForm.locator("input[name='amount']").fill("120000");
  await addLeadForm.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("link", { name: leadName, exact: true })).toBeVisible();
  await saveScreenshot(page, testInfo, "sales-created-lead");
  await page.getByRole("link", { name: leadName, exact: true }).click();
  await expect(page.getByRole("heading", { name: leadName })).toBeVisible();
  await expect(page.getByText("актуальность живой синхронизации не проверена")).toBeVisible();
  await expect(page.getByRole("button", { name: "Создать Student 360" }).first()).toBeVisible();
  await expect(page.getByText("Следующая задача").first()).toBeVisible();
  const taskTitle = `Follow up ${Date.now()}`;
  const taskCard = page.locator("section").filter({ hasText: "Следующая задача" });
  await taskCard.locator('input[name="title"]').fill(taskTitle);
  await taskCard.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText(taskTitle)).toBeVisible();
  const noteText = `Browser note ${Date.now()}`;
  const noteForm = page.locator("form").filter({ has: page.locator('input[name="text"]') });
  await noteForm.locator('input[name="text"]').fill(noteText);
  await noteForm.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText(noteText)).toBeVisible();
  const stageForm = page.locator("form").filter({ has: page.locator('select[name="status"]') }).first();
  await stageForm.locator('select[name="status"]').selectOption("meeting_scheduled");
  await stageForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator("body")).toContainText("Назначена встреча");
  await saveScreenshot(page, testInfo, "sales-lead-detail");
  await page.goto("/clients");
  await expect(page.getByText("Операционный этап и команда читаются из локальной карточки EVO CRM.")).toBeVisible();
  await expect(
    page.locator("span:visible", { hasText: "Просрочено: 1 · Просроченные платежи: 1" }).first(),
  ).toBeVisible();
  await saveScreenshot(page, testInfo, "student-360-list");
  await page.goto("/clients/1");
  await expect(page.getByText("Операционный этап и команда читаются из локальной карточки EVO CRM.")).toBeVisible();
  await expect(page.getByText("Следующее действие").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Прогресс поступления", exact: true })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Разделы дела студента" }).getByRole("link", { name: "Профиль студента" }),
  ).toBeVisible();
  await expect(page.locator("#applications").getByRole("heading", { name: "Заявки в вузы", exact: true })).toBeVisible();
  await expect(page.locator("#documents").getByRole("heading", { name: "Документы", exact: true })).toBeVisible();
  await expect(page.locator("#payments").getByRole("heading", { name: "Платежи", exact: true })).toBeVisible();
  await saveScreenshot(page, testInfo, "student-360-detail");
  expect(runtimeErrors).toEqual([]);
});

test("student portal renders scoped client dashboard", async ({ page, runtimeErrors }, testInfo) => {
  await login(page, "client@demo.kg", "client123", /\/portal$/);
  await expect(page.locator("#portal-main").getByRole("heading", { name: "Главная" })).toBeVisible();
  await expect(page.getByText("Ваш прогресс поступления")).toBeVisible();
  await expect(page.getByText("Следующее действие")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Навигация кабинета" }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Runtime Error");
  await saveScreenshot(page, testInfo, "student-portal");
  expect(runtimeErrors).toEqual([]);
});

test("mobile staff dashboard stays within viewport", async ({ page, runtimeErrors }, testInfo) => {
  await login(page, "sales@demo.kg", "sales123", /\/sales$/);
  await page.goto("/dashboard");
  await expect(page.locator("#staff-main").getByRole("heading", { name: "Командный центр" })).toBeVisible();
  const mobileMenuOpen = await openMobileStaffMenu(page);
  await expect(page.getByRole("link", { name: "Student 360" })).toBeVisible();
  if (mobileMenuOpen) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Все разделы" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Ещё" })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Ещё" }).click();
    await expect(page.getByRole("dialog", { name: "Все разделы" })).toBeVisible();
    await page.getByRole("button", { name: "Закрыть меню" }).click();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await saveScreenshot(page, testInfo, "mobile-dashboard");
  expect(runtimeErrors).toEqual([]);
});

test("mobile sales cockpit remains usable without page overflow", async ({ page, runtimeErrors }, testInfo) => {
  await login(page, "sales@demo.kg", "sales123", /\/sales$/);
  await expect(page.locator("#staff-main").getByRole("heading", { name: "Воронка поступления" })).toBeVisible();
  await expect(page.getByText("Быстрое добавление")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await saveScreenshot(page, testInfo, "mobile-sales-cockpit");
  expect(runtimeErrors).toEqual([]);
});

test("wide core staff routes are polished at 1440", async ({ page, runtimeErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The 1440 viewport is covered once from the desktop project.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);

  const routes = [
    ["/dashboard", "wide-dashboard"],
    ["/sales", "wide-sales"],
    ["/sales/1", "wide-lead-360"],
    ["/clients", "wide-student-360-list"],
    ["/clients/1", "wide-student-360-detail"],
  ] as const;

  for (const [route, screenshot] of routes) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${route} should not create horizontal page overflow`).toBeLessThanOrEqual(2);
    await saveScreenshot(page, testInfo, screenshot);
  }

  expect(runtimeErrors).toEqual([]);
});

test("tablet core staff routes stay within the viewport", async ({ page, runtimeErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Tablet viewport is covered once from the desktop project.");
  await page.setViewportSize({ width: 834, height: 1112 });
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);

  for (const route of ["/dashboard", "/sales", "/sales/1", "/clients", "/clients/1"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${route} should not create horizontal page overflow`).toBeLessThanOrEqual(2);
  }

  await expect(page.getByRole("heading", { name: "Прогресс поступления", exact: true })).toBeVisible();
  await saveScreenshot(page, testInfo, "tablet-student-360-detail");
  expect(runtimeErrors).toEqual([]);
});

test("mobile Student 360 list and detail keep real work reachable", async ({ page, runtimeErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Phone layout is covered once from the mobile project.");
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);

  await page.goto("/clients");
  await expect(page.getByText("Операционный этап и команда читаются из локальной карточки EVO CRM.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Нурлан Абдыкадыров" })).toBeVisible();
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await saveScreenshot(page, testInfo, "mobile-student-360-list");

  await page.goto("/clients/1");
  await expect(page.getByRole("navigation", { name: "Разделы дела студента" })).toBeVisible();
  await expect(page.locator("#applications").getByRole("heading", { name: "Заявки в вузы", exact: true })).toBeVisible();
  await expect(page.locator('form input[name="message"]')).toBeVisible();
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await saveScreenshot(page, testInfo, "mobile-student-360-detail");
  expect(runtimeErrors).toEqual([]);
});
