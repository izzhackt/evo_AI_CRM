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
  await expect(page.getByRole("heading", { name: "Командный центр" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Поступление" })).toBeVisible();
  await saveScreenshot(page, testInfo, "dashboard");
  await page.locator('a[href="/sales?risk=no_task"]').click();
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
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
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
  await expect(page.getByRole("link", { name: leadName })).toBeVisible();
  await saveScreenshot(page, testInfo, "sales-created-lead");
  await page.getByRole("link", { name: leadName }).click();
  await expect(page.getByRole("heading", { name: leadName })).toBeVisible();
  await expect(page.getByText("Следующая задача").first()).toBeVisible();
  const taskTitle = `Follow up ${Date.now()}`;
  const taskCard = page.locator("section").filter({ hasText: "Следующая задача" });
  await taskCard.locator('input[name="title"]').fill(taskTitle);
  await taskCard.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText(taskTitle)).toBeVisible();
  const noteText = `Browser note ${Date.now()}`;
  await page.locator('input[name="text"]').fill(noteText);
  await page.getByRole("button", { name: "+" }).click();
  await expect(page.getByText(noteText)).toBeVisible();
  const stageForm = page.locator("form").filter({ has: page.locator('select[name="status"]') }).first();
  await stageForm.locator('select[name="status"]').selectOption("meeting_scheduled");
  await stageForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator("body")).toContainText("Назначена встреча");
  await saveScreenshot(page, testInfo, "sales-lead-detail");
  await page.goto("/clients/1");
  await expect(page.getByText("Заявки").first()).toBeVisible();
  await expect(page.getByText("Документы").first()).toBeVisible();
  await expect(page.getByText("Платежи").first()).toBeVisible();
  await saveScreenshot(page, testInfo, "student-360-detail");
  expect(runtimeErrors).toEqual([]);
});

test("student portal renders scoped client dashboard", async ({ page, runtimeErrors }, testInfo) => {
  await login(page, "client@demo.kg", "client123", /\/portal$/);
  await expect(page.getByText("Мой кабинет").first()).toBeVisible();
  await expect(page.getByText("Ваш этап поступления")).toBeVisible();
  await expect(page.getByText("Команда сопровождения")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Runtime Error");
  await saveScreenshot(page, testInfo, "student-portal");
  expect(runtimeErrors).toEqual([]);
});

test("mobile staff dashboard stays within viewport", async ({ page, runtimeErrors }, testInfo) => {
  await login(page, "sales@demo.kg", "sales123", /\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Командный центр" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Student 360" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await saveScreenshot(page, testInfo, "mobile-dashboard");
  expect(runtimeErrors).toEqual([]);
});

test("mobile sales cockpit remains usable without page overflow", async ({ page, runtimeErrors }, testInfo) => {
  await login(page, "sales@demo.kg", "sales123", /\/dashboard$/);
  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Воронка поступления" })).toBeVisible();
  await expect(page.getByText("Быстрое добавление")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await saveScreenshot(page, testInfo, "mobile-sales-cockpit");
  expect(runtimeErrors).toEqual([]);
});
