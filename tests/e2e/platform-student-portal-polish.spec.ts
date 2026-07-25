import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string, target: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL(target),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

test.beforeEach(({ browserName }, testInfo) => {
  expect(browserName).toBe("chromium");
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "This focused polish suite drives explicit desktop behavior in Chromium.",
  );
});

test("Student 360 presents section links and keeps add forms collapsed until requested", async ({
  page,
}) => {
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/clients/1");

  const sectionNavigation = page.getByRole("navigation", { name: "Разделы дела студента" });
  await expect(sectionNavigation).toBeVisible();
  await expect(sectionNavigation.getByRole("link", { name: "Заявки" })).toHaveAttribute(
    "href",
    "#applications",
  );
  await expect(sectionNavigation.getByRole("link", { name: "Документы" })).toHaveAttribute(
    "href",
    "#documents",
  );
  await sectionNavigation.getByRole("link", { name: "Документы" }).click();
  await expect(page).toHaveURL(/#documents$/);
  await expect(page.locator("#documents")).toBeInViewport();

  for (const label of [
    "Добавить заявку",
    "Добавить документ",
    "Добавить задачу",
    "Добавить платёж",
  ]) {
    const disclosure = page.locator("details").filter({ hasText: label });
    await expect(disclosure).toHaveCount(1);
    await expect(disclosure).not.toHaveAttribute("open", "");
  }

  const applicationDisclosure = page
    .locator("details")
    .filter({ hasText: "Добавить заявку" });
  await expect(applicationDisclosure.locator('input[name="university"]')).not.toBeVisible();
  await applicationDisclosure.locator("summary").click();
  await expect(applicationDisclosure.locator('input[name="university"]')).toBeVisible();
});

test("the roles matrix uses semantic icons for allowed access and an explicit denied dash", async ({
  page,
}) => {
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/settings?tab=roles");

  const allowed = page.getByLabel("Доступ разрешён");
  const denied = page.getByLabel("Доступ запрещён");
  const allowedCount = await allowed.count();
  const deniedCount = await denied.count();
  expect(allowedCount).toBeGreaterThan(0);
  expect(deniedCount).toBeGreaterThan(0);
  for (let index = 0; index < allowedCount; index += 1) {
    await expect(allowed.nth(index).locator("svg")).toHaveCount(1);
    await expect(allowed.nth(index)).not.toContainText("✓");
  }
  for (let index = 0; index < deniedCount; index += 1) {
    await expect(denied.nth(index)).toContainText("—");
    await expect(denied.nth(index).locator("svg")).toHaveCount(0);
  }
});

test("portal overview fills the desktop rail with real case milestones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  const milestones = page.getByRole("region", { name: "Важное по делу" });
  await expect(milestones).toBeVisible();
  await expect(milestones.getByRole("link")).toHaveCount(3);
  await expect(milestones.getByRole("link", { name: /Документы/ })).toHaveAttribute(
    "href",
    "/portal/documents",
  );
  await expect(milestones.getByRole("link", { name: /Оплаты/ })).toHaveAttribute(
    "href",
    "/portal/payments",
  );
  await expect(milestones.getByRole("link", { name: /Заявки/ })).toHaveAttribute(
    "href",
    "/portal/applications",
  );
  await expect(milestones.getByRole("link", { name: /Документы: .+/ })).toBeVisible();
  await expect(milestones.getByRole("link", { name: /Оплаты: .+/ })).toBeVisible();
  await expect(milestones.getByRole("link", { name: /Заявки: .+/ })).toBeVisible();
  await expect(milestones).not.toContainText(/amoCRM|WhatsApp|подключен/i);
});
