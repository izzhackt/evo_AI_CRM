import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";

const evidenceDir = path.join(
  process.cwd(),
  "docs",
  "design",
  "evo-platform",
  "implementation-screenshots",
  "portal",
);

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

test.beforeEach(({ browserName }, testInfo) => {
  expect(browserName).toBe("chromium");
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Portal evidence uses explicit desktop, tablet, and mobile viewports in one Chromium project.",
  );
});

async function login(page: Page, email: string, password: string, target: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL(target),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document - dimensions.viewport).toBeLessThanOrEqual(2);
}

async function saveEvidence(page: Page, testInfo: TestInfo, name: string) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const filePath = path.join(evidenceDir, `${name}.png`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.querySelectorAll("nextjs-portal").forEach((element) => element.remove());
  });
  await page.screenshot({ path: filePath, fullPage: false, animations: "disabled" });
  await testInfo.attach(name, { path: filePath, contentType: "image/png" });
}

test("nested portal routes enforce anonymous and staff boundaries", async ({ page, runtimeErrors }) => {
  await page.goto("/portal/documents");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "sales@demo.kg", "sales123", /\/sales$/);
  for (const route of [
    "/portal",
    "/portal/documents",
    "/portal/applications",
    "/portal/messages",
    "/portal/profile",
    "/portal/visa",
    "/portal/payments",
    "/portal/team",
    "/portal/notifications",
  ]) {
    await page.goto(route);
    await expect(page, route).toHaveURL(/\/dashboard$/);
  }

  expect(runtimeErrors).toEqual([]);
});

test("student sees only the signed-in case across every portal route", async ({ page, runtimeErrors }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  await expect(page.getByText("Нурлан Абдыкадыров").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Айжан Мамытова");
  await expect(page.getByText("Нужен документ")).toBeVisible();
  await expect(
    page
      .getByText(/^(?:Рекомендательное|Мотивационное) письмо$/)
      .first(),
  ).toBeVisible();

  const routes: Array<[string, string]> = [
    ["/portal?clientId=2", "Главная"],
    ["/portal/documents?clientId=2", "Документы"],
    ["/portal/applications", "Заявки"],
    ["/portal/messages", "Сообщения"],
    ["/portal/profile", "Профиль"],
    ["/portal/visa", "Виза"],
    ["/portal/payments", "Оплаты"],
    ["/portal/team", "Моя команда"],
    ["/portal/notifications", "Уведомления"],
  ];

  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.locator("#portal-main h1")).toHaveText(heading);
    await expect(page.getByText("Нурлан Абдыкадыров").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Айжан Мамытова");
  }

  await page.goto("/portal/documents");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.goto("/portal/messages");
  await expect(page.locator("textarea")).toHaveCount(0);
  await page.goto("/portal/payments");
  await expect(page.getByRole("button", { name: /оплатить/i })).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test("desktop portal matches the accepted shell and preserves real data states", async (
  { page, runtimeErrors },
  testInfo,
) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  await expect(page.locator("#portal-main").getByRole("heading", { name: "Главная" })).toBeVisible();
  await expect(page.getByText("Ваш прогресс поступления")).toBeVisible();
  await expect(page.getByText("Следующее действие")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Навигация кабинета" }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "overview-desktop-1440x1024");

  await page.goto("/portal/payments");
  await expect(page.getByText("Просрочен").first()).toBeVisible();
  await expect(page.getByText("Онлайн-оплата в кабинете не подключена")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "payments-desktop-1440x1024");
  expect(runtimeErrors).toEqual([]);
});

test("tablet portal keeps nested workflows readable without overflow", async (
  { page, runtimeErrors },
  testInfo,
) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  await page.goto("/portal/documents");
  await expect(page.getByText("Загрузка в кабинете пока недоступна")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "documents-tablet-834x1194");

  await page.goto("/portal/applications");
  await expect(page.getByText("TU München")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "applications-tablet-834x1194");

  await page.goto("/portal/profile");
  await expect(page.getByText("Профиль только для чтения")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "profile-tablet-834x1194");
  expect(runtimeErrors).toEqual([]);
});

test("mobile portal behaves like a native five-tab workspace", async (
  { page, runtimeErrors },
  testInfo,
) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  const mobileNavigation = page.getByRole("navigation", { name: "Навигация кабинета" });
  await expect(mobileNavigation.getByRole("link", { name: "Главная" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Документы" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Заявки" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Сообщения" })).toBeVisible();
  await expect(mobileNavigation.getByRole("button", { name: "Ещё" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "overview-mobile-390x844");

  await page.goto("/portal/documents");
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "documents-mobile-390x844");

  await page.goto("/portal/messages");
  await expect(page.getByText("Лента обновлений")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "messages-mobile-390x844");

  await page.goto("/portal/notifications");
  await expect(page.getByText("Отметка «прочитано» пока не синхронизируется")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saveEvidence(page, testInfo, "notifications-mobile-390x844");
  expect(runtimeErrors).toEqual([]);
});

test("mobile More navigation exposes every portal destination and restores focus", async ({
  page,
  runtimeErrors,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  const bottomNavigation = page.getByRole("navigation", { name: "Навигация кабинета" });
  const moreButton = bottomNavigation.getByRole("button", { name: "Ещё" });
  await moreButton.focus();
  await moreButton.press("Enter");

  const moreDialog = page.getByRole("dialog", { name: "Другие разделы" });
  await expect(moreDialog).toBeVisible();
  await expect(moreDialog.getByRole("link", { name: "Виза" })).toBeFocused();
  await expect(moreDialog.getByRole("link", { name: "Оплаты" })).toBeVisible();
  await expect(moreDialog.getByRole("link", { name: "Моя команда" })).toBeVisible();
  await expect(moreDialog.getByRole("link", { name: "Профиль" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(moreDialog).not.toBeVisible();
  await expect(moreButton).toBeFocused();

  await moreButton.press("Enter");
  await moreDialog.getByRole("link", { name: "Виза" }).click();
  await expect(page).toHaveURL(/\/portal\/visa$/);
  await expect(page.locator("#portal-main h1")).toHaveText("Виза");

  const activeMoreButton = bottomNavigation.getByRole("button", { name: "Ещё: Виза" });
  await expect(activeMoreButton).toHaveClass(/bottomLinkActive/);
  await activeMoreButton.click();
  await expect(moreDialog.getByRole("link", { name: "Виза" })).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("portal copy switches between English and Kyrgyz", async ({ page, runtimeErrors }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  await page.getByRole("button", { name: "en", exact: true }).click();
  await expect(page.locator("#portal-main h1")).toHaveText("Home");
  await page.goto("/portal/documents");
  await expect(page.getByText("Portal upload is not available yet")).toBeVisible();

  await page.getByRole("button", { name: "ky", exact: true }).click();
  await expect(page.locator("#portal-main h1")).toHaveText("Документтер");
  await expect(page.getByText("Кабинеттен жүктөө азырынча жеткиликсиз")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const kyrgyzNavigation = page.getByRole("navigation", { name: "Кабинеттин навигациясы" });
  await kyrgyzNavigation.getByRole("button", { name: "Дагы" }).click();
  await expect(page.getByRole("dialog", { name: "Башка бөлүмдөр" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(runtimeErrors).toEqual([]);
});
