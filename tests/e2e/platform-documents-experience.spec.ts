import fs from "fs";
import path from "path";
import { expect, test as base, type Page } from "@playwright/test";

const screenshotDir = path.join(
  process.cwd(),
  "docs",
  "design",
  "evo-platform",
  "implementation-screenshots",
  "documents-experience",
);

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: async ({ page }, fixtureUse) => {
    const errors: string[] = [];
    page.on("pageerror", (error) =>
      errors.push(`pageerror: ${error.message}`),
    );
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console: ${message.text()}`);
      }
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
    .toEqual({
      viewport: page.viewportSize()?.width,
      document: page.viewportSize()?.width,
    });
}

async function saveScreenshot(page: Page, filename: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, filename),
    animations: "disabled",
  });
}

test("documents journey persists decisions and stops honestly at missing storage", async ({
  page,
  runtimeErrors,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "This stateful journey covers desktop, tablet, and mobile viewports once.",
  );
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/documents");

  await expect(
    page.getByText("Статусы работают, файлы пока не подключены"),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Статусы документов" }),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await saveScreenshot(page, "queue-desktop-1440x1024.png");

  const reviewLink = page.locator('a[href="/documents/3"]:visible').first();
  await expect(reviewLink).toBeVisible();
  await reviewLink.focus();
  await expect(reviewLink).toBeFocused();
  await Promise.all([
    page.waitForURL(/\/documents\/3$/),
    reviewLink.press("Enter"),
  ]);

  await expect(
    page.getByRole("heading", { name: "Файл не прикреплён к этой записи" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Открыть файл" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Загрузить новую версию" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Отправить версию на проверку" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Отклонить" }),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await saveScreenshot(page, "review-desktop-1440x1024.png");
  await page.getByRole("button", { name: "Отклонить" }).scrollIntoViewIfNeeded();
  await saveScreenshot(page, "decision-desktop-1440x1024.png");

  const decisionReason = page.getByLabel("Причина для студента");
  await page.getByRole("button", { name: "На доработку" }).click();
  await expect(decisionReason).toBeFocused();
  await expect(page.locator("#document-decision-comment:invalid")).toBeVisible();
  await expect(page).toHaveURL(/\/documents\/3$/);

  await Promise.all([
    page.waitForURL(/\/documents\/3\?updated=approved$/),
    page.getByRole("button", { name: "Принять документ" }).click(),
  ]);
  await expect(
    page.getByText("Решение «Принят» сохранено в карточке."),
  ).toBeVisible();

  await page
    .getByPlaceholder("Почему принятое решение нужно пересмотреть?")
    .fill("Повторная проверка по обновлённому внутреннему критерию.");
  await Promise.all([
    page.waitForURL(/\/documents\/3\?updated=review$/),
    page.getByRole("button", { name: "Пересмотреть решение" }).click(),
  ]);

  const correctionReason =
    "Сократите письмо до одной страницы и добавьте конкретные учебные проекты.";
  await page.getByLabel("Причина для студента").fill(correctionReason);
  await Promise.all([
    page.waitForURL(/\/documents\/3\?updated=required$/),
    page.getByRole("button", { name: "На доработку" }).click(),
  ]);
  await expect(
    page.getByText("Запрос корректировки и причина сохранены в карточке."),
  ).toBeVisible();
  await expect(page.getByText(correctionReason).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Решение сейчас недоступно" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отправить версию на проверку" }),
  ).toBeDisabled();

  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto("/documents");
  await expectNoPageOverflow(page);
  await saveScreenshot(page, "queue-tablet-834x1194.png");

  await page.goto("/documents?status=uploaded");
  await expect(
    page.getByRole("heading", { name: "В этом статусе документов нет" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Показать всю очередь" }),
  ).toBeVisible();
  await expectNoPageOverflow(page);

  await page.locator('button[title="Кыргызча"]:visible').click();
  await expect(
    page.getByText("Статустар иштейт, файлдар азырынча туташкан эмес"),
  ).toBeVisible();
  await page.locator('button[title="English"]:visible').click();
  await expect(
    page.getByText("Statuses work; files are not connected yet"),
  ).toBeVisible();
  await page.locator('button[title="Русский"]:visible').click();
  await expect(
    page.getByText("Статусы работают, файлы пока не подключены"),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/documents/3");
  const blockedHeading = page.getByRole("heading", {
    name: "Решение сейчас недоступно",
  });
  await expect(blockedHeading).toBeVisible();
  await expectNoPageOverflow(page);
  await saveScreenshot(page, "detail-mobile-390x844.png");
  await blockedHeading.scrollIntoViewIfNeeded();
  await saveScreenshot(page, "correction-blocked-mobile-390x844.png");

  expect(runtimeErrors).toEqual([]);
});

test("document routes preserve staff and client authorization boundaries", async ({
  page,
  runtimeErrors,
}) => {
  await login(page, "finance@demo.kg", "finance123", /\/finance$/);
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fdocuments$/);
  await expect(
    page.getByRole("heading", { name: "Нет доступа к разделу" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Мотивационное письмо");

  await page.context().clearCookies();
  await login(page, "client@demo.kg", "client123", /\/portal$/);
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.locator("body")).not.toContainText("Диплом бакалавра");
  expect(runtimeErrors).toEqual([]);
});
