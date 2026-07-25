import { expect, test, type Page } from "@playwright/test";

import {
  dashboardAttentionIsClear,
  orderDashboardAttentionItems,
  type DashboardAttentionItem,
} from "../../src/components/platform/core/DashboardAttention";
import { getDashboardCopy } from "../../src/components/platform/core/DashboardCopy";

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

test("attention queue orders actions first and has truthful all-clear copy", () => {
  const copy = getDashboardCopy("ru");
  const items: DashboardAttentionItem[] = [
    {
      href: "/tasks",
      label: "Срочные задачи",
      value: 0,
      icon: "check-square",
      tone: "violet",
    },
    {
      href: "/sales?risk=overdue",
      label: "Просроченные задачи",
      value: 3,
      icon: "alert",
      tone: "danger",
    },
    {
      href: "/whatsapp",
      label: "Непрочитано",
      value: 0,
      icon: "message-circle",
      tone: "info",
    },
  ];

  expect(orderDashboardAttentionItems(items).map((item) => item.label)).toEqual([
    "Просроченные задачи",
    "Срочные задачи",
    "Непрочитано",
  ]);
  expect(dashboardAttentionIsClear(items)).toBe(false);
  expect(
    dashboardAttentionIsClear(items.map((item) => ({ ...item, value: 0 }))),
  ).toBe(true);
  expect(copy.allClearTitle).toBe("Всё под контролем");
  expect(copy.allClearHint).toBe(
    "На сегодня срочных задач, просрочек и непрочитанных нет.",
  );
});
