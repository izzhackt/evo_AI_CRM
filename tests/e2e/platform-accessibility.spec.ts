import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const wcagTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

async function login(
  page: Page,
  email: string,
  password: string,
  target: RegExp,
) {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(target);
}

async function expectNoAutomatedWcagViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();

  expect(
    results.violations,
    results.violations
      .map(
        ({ id, impact, help, nodes }) =>
          `${id} (${impact ?? "unknown"}): ${help}\n${nodes
            .map(({ target, failureSummary }) => {
              const selector = target.join(" ");
              return `  ${selector}: ${failureSummary ?? "No failure summary"}`;
            })
            .join("\n")}`,
      )
      .join("\n\n"),
  ).toEqual([]);
}

test("core staff routes have no automatically detectable WCAG A/AA violations", async ({
  page,
}) => {
  await login(page, "admin@demo.kg", "admin123", /\/dashboard$/);

  for (const route of ["/dashboard", "/whatsapp", "/settings"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expectNoAutomatedWcagViolations(page);
  }

  await page.goto("/whatsapp/1?mode=first_presentation");
  await expect(page.getByRole("textbox", { name: "Ответ в WhatsApp" })).toBeVisible();
  await expectNoAutomatedWcagViolations(page);

  await page.getByRole("button", { name: "Черновик ответа" }).click();
  await expect(page.getByRole("dialog", { name: "AI-черновик" })).toBeVisible();
  await expectNoAutomatedWcagViolations(page);
});

test("core student portal routes have no automatically detectable WCAG A/AA violations", async ({
  page,
}) => {
  await login(page, "client@demo.kg", "client123", /\/portal$/);

  for (const route of ["/portal", "/portal/documents", "/portal/messages"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expectNoAutomatedWcagViolations(page);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/portal");
  const portalNavigation = page.getByRole("navigation", {
    name: "Навигация кабинета",
  });
  await portalNavigation.getByRole("button", { name: "Ещё" }).click();
  await expect(page.getByRole("dialog", { name: "Другие разделы" })).toBeVisible();
  await expectNoAutomatedWcagViolations(page);
});
