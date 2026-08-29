import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";

const coreEvidenceDir = path.join(
  process.cwd(),
  "docs",
  "design",
  "evo-platform",
  "implementation-screenshots",
  "core",
);

type StatusRow = { id: number; status: string };

function replaceDashboardStateWithAllClear() {
  const databasePath =
    process.env.EVO_PLAYWRIGHT_DB_PATH ??
    path.join(process.cwd(), "output", "playwright", "runtime", "edu-admin-e2e.db");
  const database = new Database(databasePath);
  const previous = {
    leads: database.prepare("SELECT id, status FROM leads").all() as StatusRow[],
    tasks: database.prepare("SELECT id, status FROM tasks").all() as StatusRow[],
    payments: database.prepare("SELECT id, status FROM payments").all() as StatusRow[],
  };
  database.transaction(() => {
    database.prepare("UPDATE leads SET status = 'no_request'").run();
    database.prepare("UPDATE tasks SET status = 'done'").run();
    database.prepare("UPDATE payments SET status = 'paid'").run();
  })();
  database.close();

  return () => {
    const restoreDatabase = new Database(databasePath);
    restoreDatabase.transaction(() => {
      const restoreLead = restoreDatabase.prepare("UPDATE leads SET status = ? WHERE id = ?");
      const restoreTask = restoreDatabase.prepare("UPDATE tasks SET status = ? WHERE id = ?");
      const restorePayment = restoreDatabase.prepare("UPDATE payments SET status = ? WHERE id = ?");
      previous.leads.forEach((row) => restoreLead.run(row.status, row.id));
      previous.tasks.forEach((row) => restoreTask.run(row.status, row.id));
      previous.payments.forEach((row) => restorePayment.run(row.status, row.id));
    })();
    restoreDatabase.close();
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill("admin@demo.kg");
  await page.getByLabel("Пароль").fill("admin123");
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

test("tablet navigation keeps every destination label visible and distinguishes visa", async ({
  page,
}) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await login(page);

  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  const applications = nav.getByRole("link", {
    name: "Заявки в вузы",
    exact: true,
  });
  const visa = nav.getByRole("link", { name: "Виза", exact: true });

  await expect(applications).toHaveAttribute("title", "Заявки в вузы");
  await expect(visa).toHaveAttribute("title", "Виза");
  expect(await applications.locator("svg").innerHTML()).not.toBe(
    await visa.locator("svg").innerHTML(),
  );

  for (const link of await nav.getByRole("link").all()) {
    const name = await link.getAttribute("aria-label");
    expect(name).toBeTruthy();
    await expect(link.locator(".staff-nav-link__label")).toBeVisible();
    await expect(link.locator(".staff-nav-link__label")).toHaveText(name ?? "");
  }

  await visa.focus();
  await expect(visa).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await visa.press("Enter");
  await expect(page).toHaveURL(/\/visa$/);
  await expect(
    page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Виза", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("dashboard has one attention label and exposes the action queue", async ({
  page,
}) => {
  await login(page);

  await expect(page.getByText("Сегодня требует внимания", { exact: true })).toHaveCount(1);
  const attention = page.getByRole("region", { name: "Требует внимания сейчас" });
  const values = await attention.locator("ul > li > a > span:nth-of-type(3)").allTextContents();
  const counts = values.map((value) => Number(value.replace(/\D/g, "")));
  const firstZero = counts.findIndex((count) => count === 0);
  if (firstZero >= 0) {
    expect(counts.slice(firstZero).every((count) => count === 0)).toBe(true);
  }
});

test("dashboard renders truthful all-clear copy when no action requires attention", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop all-clear contract");
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page);
  const restore = replaceDashboardStateWithAllClear();
  try {
    await page.goto("/dashboard");
    const attention = page.getByRole("region", { name: "Требует внимания сейчас" });
    await expect(
      attention.getByRole("heading", { name: "Всё под контролем" }),
    ).toBeVisible();
    await expect(
      attention.getByText(
        "На сегодня срочных задач, просрочек и непрочитанных нет.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(attention.locator("ul")).toHaveCount(0);
    await page.screenshot({
      path: path.join(
        coreEvidenceDir,
        "design-polish-dashboard-all-clear-desktop-1440x1024.png",
      ),
      fullPage: false,
      animations: "disabled",
    });
  } finally {
    restore();
  }
});
