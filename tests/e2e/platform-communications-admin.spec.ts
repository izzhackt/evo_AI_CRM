import fs from "fs";
import path from "path";

import { expect, test as base, type Page } from "@playwright/test";
import {
  getConversationStatePresentation,
  getDeliveryPresentation,
  getHandoffReasonLabelKey,
} from "../../src/components/platform/communications/whatsapp-state";

const evidenceDir = path.join(
  process.cwd(),
  "docs",
  "design",
  "evo-platform",
  "implementation-screenshots",
  "communications-admin",
);
fs.mkdirSync(evidenceDir, { recursive: true });

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

async function login(page: Page, email = "admin@demo.kg", password = "admin123") {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL(/\/(dashboard|sales|finance|clients)$/),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

async function expectNoPageOverflow(page: Page) {
  const viewportWidth = page.viewportSize()?.width;
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ viewport: viewportWidth, document: viewportWidth });
}

test("stored WhatsApp statuses map without inventing delivery", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "pure status contract");

  expect(getDeliveryPresentation("in", "demo")).toEqual({
    labelKey: "providerDeliveryReceived",
    state: "received",
  });
  expect(getDeliveryPresentation("out", "sent").state).toBe("sent");
  expect(getDeliveryPresentation("out", "delivered").state).toBe("delivered");
  expect(getDeliveryPresentation("out", "read").state).toBe("read");
  expect(getDeliveryPresentation("out", "failed").state).toBe("failed");
  expect(getDeliveryPresentation("out", "demo")).toEqual({
    labelKey: "providerDeliveryUnknown",
    state: "unknown",
  });

  expect(getConversationStatePresentation("handoff_required")).toMatchObject({
    labelKey: "agentStateHandoffRequired",
    nextActionKey: "agentNextReviewHandoff",
  });
  expect(getConversationStatePresentation("unrecognized_provider_state")).toMatchObject({
    labelKey: "agentStateRecorded",
    nextActionKey: "agentNextVerifyInAmo",
  });
  expect(getConversationStatePresentation(null)).toBeNull();
  expect(getHandoffReasonLabelKey("operator_takeover")).toBe(
    "handoffReasonOperatorTakeover",
  );
  expect(getHandoffReasonLabelKey("unrecognized_reason")).toBeNull();
});

test("communications and admin workflows remain truthful and drill down", async ({
  page,
  runtimeErrors,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop evidence");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);

  await page.goto("/whatsapp");
  await expect(page.getByText("Источник данных коммуникаций", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "AI создаёт только черновик. Отправка всегда выполняется сотрудником вручную.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.locator('.staff-topbar__actions a[href="/whatsapp#add"]').click();
  await expect(page.locator("details#add")).toHaveAttribute("open", "");
  await expect(page.getByLabel("Телефон")).toBeFocused();
  await expect(page.getByLabel("Имя и фамилия")).toBeVisible();
  await page.locator("details#add > summary").click();
  const conversation = page.getByRole("link", {
    name: /Открыть диалог: Асель Бекова/,
  });
  await expect(conversation).toBeVisible();
  await expect(conversation).toHaveAttribute("aria-label", /Открыть диалог:/);
  await conversation.click();
  await expect(page.getByText("Контекст диалога", { exact: true })).toBeVisible();
  await expect(page.getByText(/Офлайн-статус и конфликты/)).toBeVisible();
  await expect(page.locator("[data-delivery-status]").first()).toHaveAttribute(
    "data-delivery-status",
    /received|sent|delivered|read|failed|unknown/,
  );
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: path.join(evidenceDir, "01-whatsapp-desktop-1440.png"),
    fullPage: false,
  });

  await page.goto("/calls");
  await expect(page.getByText("Звонки и встречи", { exact: true })).toBeVisible();
  await expect(page.getByText(/Журнал работает как ручная запись фактов/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Запланировать следующий контакт" })).toHaveAttribute(
    "href",
    "/tasks?view=calendar",
  );
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: path.join(evidenceDir, "05-calls-desktop-1440.png"),
    fullPage: false,
  });

  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat\/\d+$/);
  await expect(page.getByPlaceholder("Написать сообщение…")).toBeVisible();
  await expectNoPageOverflow(page);

  await page.goto("/reports?period=30d");
  await expect(page.getByRole("link", { name: "30 дней" })).toHaveAttribute("aria-current", "page");
  const managerDrilldown = page.locator('a[href^="/sales?view=list&manager="]').first();
  await expect(managerDrilldown).toBeVisible();
  const managerHref = await managerDrilldown.getAttribute("href");
  await managerDrilldown.click();
  await expect(page).toHaveURL(new RegExp(String(managerHref).replace("?", "\\?")));
  await page.goBack();
  const sourceDrilldown = page.locator('a[href^="/sales?view=list&source="]').first();
  await expect(sourceDrilldown).toBeVisible();
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: path.join(evidenceDir, "06-reports-desktop-1440.png"),
    fullPage: false,
  });

  await page.goto("/settings?tab=overview");
  await expect(page.getByTestId("settings-page").getByRole("heading", { name: "Управление и готовность" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Живое соединение не проверено" })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: path.join(evidenceDir, "07-settings-readiness-desktop-1440.png"),
    fullPage: false,
  });

  await page.getByRole("link", { name: "Пользователи" }).click();
  await expect(page.getByText(/Приглашение, блокировка и смена роли/)).toBeVisible();
  await page.getByRole("link", { name: "Роли" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("link", { name: "Аудит" }).click();
  await expect(page.getByText("Выделенный журнал безопасности пока отсутствует.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Интеграции" }).click();
  await expect(page.locator("main")).not.toContainText("Подключено");

  await page.goto("/finance");
  await page.locator('.staff-topbar__actions a[href="/finance#add"]').click();
  await expect(page.locator("details#add")).toHaveAttribute("open", "");
  await expect(page.locator('details#add select[name="client_id"]')).toBeFocused();

  expect(runtimeErrors).toEqual([]);
});

test("tablet task calendar keeps the meeting journey visible", async ({
  page,
  runtimeErrors,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "tablet evidence");
  await page.setViewportSize({ width: 834, height: 1112 });
  await login(page);
  await page.goto("/tasks?view=calendar&month=2026-06");
  await expect(page.getByTestId("task-calendar")).toBeVisible();
  await expect(page.getByText("Повестка и встречи", { exact: true })).toBeVisible();
  await expect(page.getByText("Встречи и следующие контакты", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: path.join(evidenceDir, "02-tasks-calendar-tablet-834.png"),
    fullPage: true,
  });
  expect(runtimeErrors).toEqual([]);
});

test("urgent notifications and tasks have reachable 390px actions", async ({
  page,
  runtimeErrors,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile evidence");
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.goto("/notifications");
  await expect(page.getByTestId("notifications-page")).toBeVisible();
  const urgentNotification = page.getByTestId("notification-card").first();
  await expect(urgentNotification).toBeVisible();
  const urgentNotificationAction = urgentNotification.getByRole("link", { name: "Открыть" });
  await urgentNotificationAction.evaluate((element) =>
    element.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await expect(urgentNotificationAction).toBeVisible();
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: path.join(evidenceDir, "03-notifications-mobile-390.png"),
    fullPage: false,
  });

  const financeNotificationAction = page
    .locator('[data-testid="notification-card"] a[href="/finance"]')
    .first();
  await expect(financeNotificationAction).toBeVisible();
  await financeNotificationAction.click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(page.getByText("Просроченные платежи", { exact: true })).toBeVisible();

  await page.goto("/tasks?view=list");
  const urgentTask = page.getByTestId("urgent-task-card").first();
  await expect(urgentTask).toBeVisible();
  const urgentTaskAction = urgentTask.getByRole("button", { name: "Сохранить" });
  await urgentTaskAction.evaluate((element) =>
    element.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await expect(urgentTaskAction).toBeVisible();
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: path.join(evidenceDir, "04-tasks-mobile-390.png"),
    fullPage: false,
  });

  await page.goto("/whatsapp");
  await page.locator('a[href^="/whatsapp/"]:visible').first().click();
  await expect(page.locator('.staff-topbar__actions a[href="/whatsapp#add"]')).toHaveCount(0);
  const backToInbox = page.getByRole("link", { name: "Диалоги" });
  await expect(backToInbox).toBeVisible();
  await backToInbox.click();
  await page.locator('.staff-topbar__actions a[href="/whatsapp#add"]').click();
  await expect(page.locator("details#add")).toHaveAttribute("open", "");
  await expect(page.locator('details#add input[name="phone"]')).toBeFocused();

  expect(runtimeErrors).toEqual([]);
});

test("server role checks remain hard while finance reports stay aggregate-only", async ({
  page,
  runtimeErrors,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "role coverage");
  await login(page, "sales@demo.kg", "sales123");
  await page.goto("/calls");
  await expect(page.locator('a[href^="/settings"]')).toHaveCount(0);
  await page.goto("/settings");
  await expect(page).toHaveURL(
    /\/access-denied\?from=%2Fsettings$/,
  );
  await expect(
    page.getByRole("heading", { name: "Нет доступа к разделу" }),
  ).toBeVisible();

  await page.context().clearCookies();
  await login(page, "finance@demo.kg", "finance123");
  await page.goto("/reports");
  await expect(page.getByText(/Финансовая роль видит агрегаты/)).toBeVisible();
  await expect(page.locator('a[href^="/sales?view=list&manager="]')).toHaveCount(0);

  await page.context().clearCookies();
  await login(page, "curator@demo.kg", "curator123");
  await page.goto("/tasks?view=list");
  await expect(page.locator('main a[href="/calls"]')).toHaveCount(0);
  await expect(page.locator('main a[href^="/sales/"]')).toHaveCount(0);
  await page.goto("/whatsapp");
  await expect(page.locator('main a[href^="/sales/"]')).toHaveCount(0);
  await expect(page.locator('.staff-topbar__actions a[href="/whatsapp#add"]')).toHaveCount(0);
  await expect(page.locator("details#add")).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});
